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
    a.output.mkdir(parents=True,exist_ok=True)
    # Exclusive lock prevents concurrent manifest lost updates. Remove only after
    # verifying the recorded PID is no longer running following hard interruption.
    lock=a.output/'.publish.lock'
    fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
    os.write(fd,str(os.getpid()).encode());os.close(fd)
    try:
        path=a.output/'manifest.json'
        manifest=json.loads(path.read_text()) if path.exists() else {'schemaVersion':4,'tiles':[]}
        entries={t['id']:t for t in manifest['tiles']}
        con=duckdb.connect()
        failures=0
        for tid in sorted(tids):
            entry=entries.setdefault(tid,{'id':tid,'bbox':bounds(tid)})
            for layer in layers:
                sub,count_key,required=LAYERS[layer];key=KEYS[layer]
                source=a.source_dir/sub/(tid+'.parquet');sidecar=source.with_suffix('.parquet.json')
                old=entry.get(key,{})
                try:
                    if not source.exists() or not sidecar.exists():
                        if not old.get('url'): entry[key]={'status':'UNBUILT','statusNote':'Normalized source and provenance sidecar required.'}
                        continue
                    meta=json.loads(sidecar.read_text())
                    if meta.get('status') not in {'AVAILABLE','PARTIAL','VERIFIED_EMPTY'} or not meta.get('datasetVersion') or not meta.get('sourceUrl'):
                        raise ValueError('Source must declare version, URL and coverage status')
                    digest=hashlib.sha256(source.read_bytes()).hexdigest()
                    if a.resume and old.get('sha256')==digest and old.get('datasetVersion')==meta['datasetVersion'] and old.get('status')==meta['status'] and (a.output/old.get('url','missing')).is_file():
                        if hashlib.sha256((a.output/old['url']).read_bytes()).hexdigest()==digest: continue
                    columns={row[0] for row in con.execute('DESCRIBE SELECT * FROM read_parquet(?)',[str(source)]).fetchall()}
                    if not required<=columns: raise ValueError('Missing normalized columns: '+str(sorted(required-columns)))
                    count=con.execute('SELECT count(*) FROM read_parquet(?)',[str(source)]).fetchone()[0]
                    if (count==0)!=(meta['status']=='VERIFIED_EMPTY'): raise ValueError('Row count contradicts declared coverage')
                    # Content-addressed output keeps old manifest assets valid until commit.
                    target=a.output/sub/(tid+'-'+digest[:16]+'.parquet')
                    target.parent.mkdir(parents=True,exist_ok=True)
                    tmp=target.with_suffix('.tmp');shutil.copyfile(source,tmp);os.replace(tmp,target)
                    entry[key]={**meta,'url':target.relative_to(a.output).as_posix(),count_key:count,'bytes':target.stat().st_size,'sha256':digest}
                except Exception as exc:
                    failures+=1
                    if old.get('url'): entry[key]={**old,'lastBuildAttempt':{'status':'FAILED','error':str(exc)}}
                    else: entry[key]={'status':'FAILED','error':str(exc)}
                finally:
                    manifest['schemaVersion']=4
                    manifest['tiles']=[entries[k] for k in sorted(entries)]
                    manifest['summary']={**(manifest.get('summary') or {}), **summary_of(manifest['tiles'])}
                    manifest.setdefault('tileSchema',{})['subdirs']={layer: LAYERS[layer][0]+'/' for layer in LAYERS}
                    # Deterministic release identifier; no wall-clock bytes in output.
                    manifest['datasetVersion']='content-'+hashlib.sha256(json.dumps(manifest['tiles'],sort_keys=True).encode()).hexdigest()[:16]
                    atomic_json(path,manifest)
        con.close()
        print(f'Published/checkpointed {len(tids)} tiles × {len(layers)} layers; {failures} failures')
        if failures: raise SystemExit(1)
    finally:
        lock.unlink()
