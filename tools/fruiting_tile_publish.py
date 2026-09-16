"""Incremental publication of normalized bulk-source tiles (no network calls).

Adapters must provide one normalized Parquet and a provenance sidecar per tile:
<source-dir>/<habitat|pl|ap|fire>/<tile>.parquet[.json]. Sidecar requires datasetVersion,
sourceUrl, status AVAILABLE/PARTIAL/VERIFIED_EMPTY. Empty data is never inferred
from a missing file or a failed query. This is the bulk ingestion boundary, not
an adapter claiming to read raw NLCD/PAD-US/SSURGO/MTBS formats; the raw adapters
live in tools/fruiting_bulk_adapters.py.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import duckdb

LAYERS = {'habitat': ('habitat', 'cells', {'lat','lon','forest','canopy','elevation_ft'}),
          'public-land': ('pl', 'properties', {'property_id','geometry_json','min_lon','min_lat','max_lon','max_lat'}),
          'access': ('ap', 'points', {'access_id','property_id','lat','lon'}),
          'fire': ('fire', 'perimeters', {'perimeter_id','fire_year','geometry_json','min_lon','min_lat','max_lon','max_lat'})}
KEYS = {'habitat':'habitat','public-land':'publicLands','access':'accessPoints','fire':'fireHistory'}

def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name('.'+path.name+'.tmp')
    tmp.write_text(json.dumps(value, indent=2)+'\n')
    os.replace(tmp, path)

def bounds(tid):
    if not re.fullmatch(r'n\d{2}_w\d{3}', tid):
        raise ValueError('Invalid tile ID: '+tid)
    south, west = int(tid[1:3]), -int(tid[5:8])
    return [west,south,west+1,south+1]

def tiles_for_bbox(box):
    w,s,e,n=box
    if not (-125<=w<e<=-66 and 24<=s<n<=50):
        raise ValueError('Expected a valid CONUS west south east north bbox')
    return [f'n{lat:02d}_w{abs(lon):03d}' for lat in range(math.floor(s), math.ceil(n)) for lon in range(math.floor(w),math.ceil(e))]

def _bbox_intersects(a, b):
    return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])


# Explicit roster from fruiting-forecast.html (ECO_PROFILE_GROUPS). A Python test
# parses the HTML and fails if this copy drifts from the browser's mapping.
ECO_PROFILE_GROUPS = {
    'pnw': [1, 2, 3, 4, 77, 78], 'california': [6, 7, 8, 85],
    'sierraNevada': [5], 'interiorMountains': [9, 11, 15, 16, 17, 19, 41],
    'southernRockies': [21, 23], 'madrean': [20, 22, 79], 'coldBasins': [10, 12, 13, 18, 80], 'warmDesert': [14, 24, 81],
    'northernForests': [48, 49, 50, 51, 58, 59, 82, 83, 84],
    'hardwood': [40, 45, 47, 52, 53, 54, 55, 56, 57, 61, 62, 63, 64, 72, 74],
    'appalachians': [36, 37, 38, 39, 66, 67, 68, 69, 70, 71],
    'southeast': [34, 35, 65, 73, 75, 76],
    'plains': [25, 26, 27, 28, 29, 30, 31, 32, 33, 42, 43, 44, 46, 60],
}


def coverage_of(tiles, root):
    """Lightweight derived coverage summary. Three separate dimensions:

    * publishedTiles: every tile with at least one populated layer (includes legacy);
    * coverageTiles: release tiles whose habitat declares all components AVAILABLE;
    * states / ecologicalProfiles: which administrative and EPA Level III boundaries
      intersect published tiles, from the pinned boundary bounding boxes. This is
      approximate addressing metadata, not a clipping audit, and it is deliberately
      not conflated with layer availability or model maturity.
    """
    def populated(tile):
        for key in KEYS.values():
            asset = tile.get(key) or {}
            if asset.get('url') and asset.get('status') in {'AVAILABLE', 'PARTIAL'}:
                return True
        return False

    published = sorted(tile['id'] for tile in tiles if populated(tile))
    complete = sorted(tile['id'] for tile in tiles
                      if (tile.get('habitat') or {}).get('status') == 'AVAILABLE'
                      and (tile.get('habitat') or {}).get('components')
                      and all(status == 'AVAILABLE'
                              for status in ((tile.get('habitat') or {}).get('components') or {}).values()))
    geo_dir = root / 'data/fruiting-forecast'
    state_features = json.loads((geo_dir / 'states.json').read_text())['features'] if (geo_dir / 'states.json').exists() else []
    eco_features = json.loads((geo_dir / 'ecoregions.json').read_text())['features'] if (geo_dir / 'ecoregions.json').exists() else []
    code_profile = {str(code): name for name, codes in ECO_PROFILE_GROUPS.items() for code in codes}
    states, profiles = {}, {}
    for tile in tiles:
        if tile['id'] not in published:
            continue
        bbox = tile.get('bbox')
        if not bbox or len(bbox) != 4:
            continue
        for feature in state_features:
            if _bbox_intersects(bbox, feature['bbox']):
                code = feature['properties'].get('code')
                states[code] = states.get(code, 0) + 1
        seen = set()
        for feature in eco_features:
            if not _bbox_intersects(bbox, feature['bbox']):
                continue
            name = code_profile.get(str(feature['properties'].get('code')))
            if name:
                seen.add(name)
        for name in seen:
            profiles[name] = profiles.get(name, 0) + 1
    return {
        'publishedTiles': published,
        'coverageTiles': complete,
        'states': dict(sorted(states.items())),
        'ecologicalProfiles': dict(sorted(profiles.items())),
        'coverageSemantics': ('publishedTiles covers every tile with a populated layer including legacy samples; '
                              'coverageTiles covers release tiles whose habitat declares every component AVAILABLE; '
                              'states and ecologicalProfiles come from pinned boundary bounding boxes that intersect '
                              'published tiles. Administrative, ecological and layer availability are separate '
                              'dimensions and are not interchangeable.'),
    }


def summary_of(tiles):
    """Recomputed on every checkpoint so About/diagnostics never show stale counts."""
    out = {'tileCount': len(tiles), 'layers': {}}
    for layer in LAYERS:
        stat = {'populated': 0, 'verifiedEmpty': 0, 'unbuilt': 0, 'failed': 0, 'bytes': 0, 'rows': 0}
        key, count_key = KEYS[layer], LAYERS[layer][1]
        for tile in tiles:
            asset = tile.get(key) or {}
            status = asset.get('status')
            if status in {'AVAILABLE', 'PARTIAL'} and asset.get('url'):
                stat['populated'] += 1
                stat['bytes'] += asset.get('bytes') or 0
                stat['rows'] += asset.get(count_key) or 0
                if status == 'AVAILABLE':
                    stat['available'] = stat.get('available', 0) + 1
            elif status == 'VERIFIED_EMPTY':
                stat['verifiedEmpty'] += 1
            elif status == 'FAILED':
                stat['failed'] += 1
            else:
                stat['unbuilt'] += 1
        out['layers'][layer] = stat
    # Habitat completeness is explicit component coverage, never inferred from a
    # Parquet file existing. Counts describe publication declarations only.
    components = {}
    for tile in tiles:
        asset = tile.get('habitat') or {}
        if asset.get('status') not in {'AVAILABLE', 'PARTIAL'} or not asset.get('url'):
            continue
        for name, component_status in sorted((asset.get('components') or {}).items()):
            bucket = components.setdefault(name, {'AVAILABLE': 0, 'UNBUILT': 0, 'MISSING': 0})
            bucket[component_status] = bucket.get(component_status, 0) + 1
    if components:
        out['layers']['habitat']['components'] = components
    return out


def validate_access(con, source, meta, columns):
    """Additive v2 contract: genuine source identity and explicit start eligibility.

    Legacy sources retain their original minimum schema. The publisher cannot
    independently verify OSM mapping quality, but rejects incompatible claims.
    """
    if meta.get('schemaVersion', 1) < 2:
        return
    required = {'osm_type', 'osm_id', 'geometry_json', 'location_method', 'property_ids_json',
                'evidence_grade', 'start_eligible', 'restriction', 'source_version', 'type'}
    if not required <= columns:
        raise ValueError('Missing access v2 columns: ' + str(sorted(required - columns)))
    if meta.get('license') != 'ODbL-1.0' or not meta.get('attribution'):
        raise ValueError('OSM access requires ODbL and contributor attribution')
    rows = con.execute('SELECT access_id, osm_type, osm_id, start_eligible, evidence_grade, type, '
                       'location_method, restriction, property_ids_json, source_version, geometry_json '
                       'FROM read_parquet(?)', [str(source)]).fetchall()
    seen = set()
    for ident, osm_type, osm_id, start, grade, kind, method, restriction, properties, version, geometry in rows:
        if not re.fullmatch(r'osm:(node|way|relation):[0-9]+', ident or '') or ident != f'osm:{osm_type}:{osm_id}' or ident in seen:
            raise ValueError('Access requires unique stable OSM identity')
        seen.add(ident)
        if not version or not isinstance(json.loads(properties), list) or not json.loads(properties):
            raise ValueError('Access requires source version and property associations')
        geom = json.loads(geometry)
        if not isinstance(geom, dict) or not geom.get('coordinates'):
            raise ValueError('Access requires mapped geometry')
        if start and (grade not in {'HIGH', 'MEDIUM'} or kind not in {'TRAILHEAD', 'PARKING'}
                      or method not in {'osm-node', 'mapped-area-representative-point'} or restriction):
            raise ValueError('Suggested Start requires eligible mapped access evidence')


def publish_tiles(root, tids, layers, source_dir, output=None, resume=False):
    """Publish one normalized source directory into the release manifest.

    Deterministic sorted tile order; a failed tile keeps its previous evidence
    and never corrupts successful ones; the manifest is atomically replaced
    after every layer so an interrupted run leaves a valid release behind.
    Returns the failure count.
    """
    output = output or root/'data/fruiting-forecast'
    output.mkdir(parents=True,exist_ok=True)
    # Exclusive lock prevents concurrent manifest lost updates. Remove only after
    # verifying the recorded PID is no longer running following hard interruption.
    lock=output/'.publish.lock'
    fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
    os.write(fd,str(os.getpid()).encode());os.close(fd)
    try:
        path=output/'manifest.json'
        manifest=json.loads(path.read_text()) if path.exists() else {'schemaVersion':4,'tiles':[]}
        entries={t['id']:t for t in manifest['tiles']}
        con=duckdb.connect()
        failures=0
        for tid in sorted(tids):
            entry=entries.setdefault(tid,{'id':tid,'bbox':bounds(tid)})
            for layer in layers:
                sub,count_key,required=LAYERS[layer];key=KEYS[layer]
                source=source_dir/sub/(tid+'.parquet');sidecar=source.with_suffix('.parquet.json')
                old=entry.get(key,{})
                try:
                    if not source.exists() or not sidecar.exists():
                        if not old.get('url'): entry[key]={'status':'UNBUILT','statusNote':'Normalized source and provenance sidecar required.'}
                        continue
                    meta=json.loads(sidecar.read_text())
                    if meta.get('status') not in {'AVAILABLE','PARTIAL','VERIFIED_EMPTY'} or not meta.get('datasetVersion') or not meta.get('sourceUrl'):
                        raise ValueError('Source must declare version, URL and coverage status')
                    digest=hashlib.sha256(source.read_bytes()).hexdigest()
                    if resume and old.get('sha256')==digest and old.get('datasetVersion')==meta['datasetVersion'] and old.get('status')==meta['status'] and (output/old.get('url','missing')).is_file():
                        if hashlib.sha256((output/old['url']).read_bytes()).hexdigest()==digest: continue
                    columns={row[0] for row in con.execute('DESCRIBE SELECT * FROM read_parquet(?)',[str(source)]).fetchall()}
                    if not required<=columns: raise ValueError('Missing normalized columns: '+str(sorted(required-columns)))
                    if layer == 'access': validate_access(con, source, meta, columns)
                    count=con.execute('SELECT count(*) FROM read_parquet(?)',[str(source)]).fetchone()[0]
                    if (count==0)!=(meta['status']=='VERIFIED_EMPTY'): raise ValueError('Row count contradicts declared coverage')
                    # Content-addressed output keeps old manifest assets valid until commit.
                    target=output/sub/(tid+'-'+digest[:16]+'.parquet')
                    target.parent.mkdir(parents=True,exist_ok=True)
                    tmp=target.with_suffix('.tmp');shutil.copyfile(source,tmp);os.replace(tmp,target)
                    entry[key]={**meta,'url':target.relative_to(output).as_posix(),count_key:count,'bytes':target.stat().st_size,'sha256':digest}
                except Exception as exc:
                    failures+=1
                    if old.get('url'): entry[key]={**old,'lastBuildAttempt':{'status':'FAILED','error':str(exc)}}
                    else: entry[key]={'status':'FAILED','error':str(exc)}
                finally:
                    if entry.get('accessPoints', {}).get('status') in {'AVAILABLE', 'VERIFIED_EMPTY'} and 'unbuilt' in entry.get('habitat', {}):
                        entry['habitat']['unbuilt'] = [x for x in entry['habitat']['unbuilt'] if x != 'access']
                    manifest['schemaVersion']=4
                    manifest['tiles']=[entries[k] for k in sorted(entries)]
                    manifest['summary']={**(manifest.get('summary') or {}), **summary_of(manifest['tiles']), **coverage_of(manifest['tiles'], root)}
                    manifest.setdefault('tileSchema',{})['subdirs']={layer: LAYERS[layer][0]+'/' for layer in LAYERS}
                    # Deterministic release identifier; no wall-clock bytes in output.
                    manifest['datasetVersion']='content-'+hashlib.sha256(json.dumps(manifest['tiles'],sort_keys=True).encode()).hexdigest()[:16]
                    atomic_json(path,manifest)
        con.close()
        print(f'Published/checkpointed {len(tids)} tiles × {len(layers)} layers; {failures} failures')
        return failures
    finally:
        lock.unlink()


def main(root):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('scope', choices=['tile','bbox','state','conus'])
    p.add_argument('area', nargs='*')
    p.add_argument('--layer', choices=[*LAYERS,'all'], default='all')
    p.add_argument('--source-dir',type=Path)
    p.add_argument('--output',type=Path,default=root/'data/fruiting-forecast')
    p.add_argument('--state-bounds',type=Path,help='JSON mapping state names to authoritative [west,south,east,north] bounds')
    p.add_argument('--plan',action='store_true')
    p.add_argument('--resume',action='store_true')
    a=p.parse_args(__import__('sys').argv[2:])
    if a.scope=='tile':
        if len(a.area)!=1: p.error('tile requires one tile ID')
        tids=a.area;bounds(tids[0])
    elif a.scope=='bbox':
        if len(a.area)!=4: p.error('bbox requires west south east north')
        tids=tiles_for_bbox(list(map(float,a.area)))
    elif a.scope=='state':
        if not a.state_bounds: p.error('state requires --state-bounds with source-derived state bounds')
        tids=tiles_for_bbox(json.loads(a.state_bounds.read_text())[' '.join(a.area)])
    else:
        # Catalog is approximate addressing, not verified land or publication coverage.
        catalog=json.loads((root/'data/fruiting-forecast/tile-catalog-full.json').read_text())
        tids=[t['id'] for t in catalog['tiles'] if t.get('land')]
    layers=list(LAYERS) if a.layer=='all' else [a.layer]
    if a.plan:
        print(json.dumps({'tiles':len(tids),'layers':layers,'jobs':len(tids)*len(layers),'networkRequests':0,'tileIds':sorted(tids)}));return
    if not a.source_dir: p.error('publication requires --source-dir of normalized bulk-source tiles')
    failures=publish_tiles(root, tids, layers, a.source_dir, a.output, a.resume)
    if failures: raise SystemExit(1)
