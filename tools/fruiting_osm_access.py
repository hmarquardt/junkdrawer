#!/usr/bin/env python3
# /// script
# dependencies = ["duckdb", "requests", "osmium==4.3.1", "shapely>=2,<3", "pyproj"]
# ///
"""Prepare Geofabrik state PBF once; build access tiles through the existing publisher.

uv run tools/fruiting_osm_access.py prepare --state CO --cache /tmp/ffsrc
uv run tools/fruiting_osm_access.py build --state CO --tile n39_w106 --cache /tmp/ffsrc --out /tmp/ffaccess
No network requests during build. No contributor metadata is retained.
"""
import argparse
from collections import Counter
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import time

import duckdb
import osmium
from pyproj import Transformer
import requests
from shapely.geometry import Point, box, mapping, shape
from shapely.ops import transform
from shapely.strtree import STRtree

from fruiting_bulk_adapters import (_sha256, load_cache_manifest, save_cache_manifest,
                                   tile_bbox, write_parquet)

VERSION = 'osm-access-v1'
STATES = {'CO': 'colorado', 'OR': 'oregon', 'NM': 'new-mexico', 'WA': 'washington'}
ATTRIBUTION = '© OpenStreetMap contributors'
LICENSE = 'https://www.openstreetmap.org/copyright'
TAGS = ('name operator access motor_vehicle vehicle foot bicycle surface smoothness tracktype '
        'parking informal fee locked seasonal opening_hours highway service barrier amenity '
        'building covered footway access:conditional motor_vehicle:conditional vehicle:conditional foot:conditional').split()
DRIVABLE = {'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service', 'track', 'road',
            'primary_link', 'secondary_link', 'tertiary_link', 'living_street'}
PATHS = {'path', 'footway', 'bridleway', 'steps', 'cycleway'}
DENIED = {'no', 'private', 'customers', 'permit', 'delivery', 'agricultural', 'forestry'}
PERMITTED = {'yes', 'public', 'permissive', 'designated'}
COLUMNS = [(k, 'VARCHAR') for k in ['access_id', 'property_id', 'property_name', 'name']] + [
    ('lat', 'DOUBLE'), ('lon', 'DOUBLE')] + [(k, 'VARCHAR') for k in [
    'type', 'source', 'source_url', 'confidence']] + [('official', 'BOOLEAN'), ('operator', 'VARCHAR'),
    ('notes', 'VARCHAR'), ('verified_at', 'DATE')] + [(k, 'VARCHAR') for k in [
    'feature_type', 'osm_type', 'osm_id', 'geometry_json', 'location_method', 'property_ids_json',
    'associations_json', 'association_method', 'evidence_grade', 'evidence_reason', 'source_version',
    'access', 'motor_vehicle', 'vehicle', 'foot', 'bicycle', 'surface', 'smoothness', 'tracktype',
    'parking_type', 'informal', 'fee', 'parking', 'barrier', 'locked', 'seasonal', 'conditions_json',
    'road_id', 'road_tags_json', 'road_quality', 'connectivity', 'restriction']] + [
    ('recreation_context', 'BOOLEAN'), ('association_distance_m', 'DOUBLE'), ('road_distance_m', 'DOUBLE'), ('start_eligible', 'BOOLEAN')]


def feature_type(tags):
    # Barriers win over double-tagged trailheads: a locked gate is never a start.
    if tags.get('barrier') in {'gate', 'lift_gate', 'swing_gate', 'kissing_gate', 'bollard', 'chain', 'block', 'entrance'}:
        return 'GATE'
    if tags.get('highway') == 'trailhead':
        return 'TRAILHEAD'
    if tags.get('amenity') == 'parking':
        return 'PARKING'
    return None


def extract_pbf(pbf, destination):
    """Libosmium resolves way nodes and multipolygon relations; stream only whitelisted tags."""
    started = time.monotonic()
    factory = osmium.geom.GeoJSONFactory()
    counts = Counter()
    with open(destination / 'candidates.jsonl', 'w') as candidates, open(destination / 'roads.jsonl', 'w') as roads:
        class Handler(osmium.SimpleHandler):
            def emit(self, obj, geom, kind, osm_type, osm_id):
                geometry = shape(geom)
                if geometry.is_empty or not geometry.is_valid:
                    counts['invalid_geometry'] += 1
                    return
                tags = {k: obj.tags[k] for k in TAGS if k in obj.tags}
                record = {'id': f'osm:{osm_type}:{osm_id}', 'osm_type': osm_type, 'osm_id': str(osm_id),
                          'kind': kind, 'tags_json': json.dumps(tags), 'geometry_json': json.dumps(geom),
                          **dict(zip(('min_lon', 'min_lat', 'max_lon', 'max_lat'), geometry.bounds))}
                (roads if kind == 'ROAD' else candidates).write(json.dumps(record, separators=(',', ':')) + '\n')
                counts[kind] += 1

            def node(self, n):
                kind = feature_type(n.tags)
                if kind and n.location.valid():
                    self.emit(n, {'type': 'Point', 'coordinates': [n.location.lon, n.location.lat]}, kind, 'node', n.id)

            def way(self, w):
                kind = feature_type(w.tags)
                if kind and w.is_closed():
                    return  # area callback supplies the full polygon, never its bbox midpoint
                if w.tags.get('highway') in DRIVABLE | PATHS:
                    kind = 'ROAD'
                if kind:
                    try:
                        self.emit(w, json.loads(factory.create_linestring(w)), kind, 'way', w.id)
                    except (RuntimeError, osmium.InvalidLocationError):
                        counts['invalid_geometry'] += 1

            def area(self, a):
                kind = feature_type(a.tags)
                if kind:
                    try:
                        self.emit(a, json.loads(factory.create_multipolygon(a)), kind,
                                  'way' if a.from_way() else 'relation', a.orig_id())
                    except (RuntimeError, osmium.InvalidLocationError):
                        counts['invalid_geometry'] += 1
        Handler().apply_file(str(pbf), locations=True, idx='flex_mem')
    if not counts['ROAD'] or not sum(counts[k] for k in ('TRAILHEAD', 'PARKING', 'GATE')):
        raise ValueError('PBF did not yield roads and access candidates')
    # Compact reusable local tables. Browser never sees these state-wide files.
    with duckdb.connect() as con:
        for name in ('candidates', 'roads'):
            source = str(destination / (name + '.jsonl')).replace("'", "''")
            con.execute("COPY (SELECT * FROM read_json_auto('" + source + "', maximum_object_size=33554432)) TO ? (FORMAT PARQUET, COMPRESSION ZSTD)",
                        [str(destination / (name + '.parquet'))])
            (destination / (name + '.jsonl')).unlink()
    return {'counts': dict(counts), 'extractionSeconds': round(time.monotonic() - started, 3)}


def validate_ready(cache, entry):
    if not entry or entry.get('status') != 'READY' or entry.get('adapterVersion') != VERSION:
        raise ValueError('Access source is not prepared; run prepare explicitly')
    folder = cache / entry['directory']
    marker = folder / 'READY'
    if not marker.exists() or marker.read_text().strip() != entry['sha256']:
        raise ValueError('Access READY marker missing or invalid')
    for name, info in entry['files'].items():
        path = folder / name
        if not path.is_file() or path.stat().st_size != info['bytes'] or _sha256(path) != info['sha256']:
            raise ValueError('Corrupt prepared access source: ' + name)
    return folder


def record_source(cache, key, entry):
    # Independent state preparations may finish together; do not lose other entries.
    with open(cache / '.osm-manifest.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        manifest = load_cache_manifest(cache)
        manifest['sources'][key] = entry
        save_cache_manifest(cache, manifest)


def prepare(cache, state, refresh=False, snapshot='latest', local_pbf=None):
    state = state.upper()
    if state not in STATES or not re.fullmatch(r'latest|\d{6}', snapshot):
        raise ValueError('Expected supported state and latest or YYMMDD snapshot')
    key = 'osm_access:' + state
    old = load_cache_manifest(cache)['sources'].get(key)
    if old and old.get('status') == 'READY' and not refresh:
        validate_ready(cache, old)
        return {**old, 'reused': True}
    url = f'https://download.geofabrik.de/north-america/us/{STATES[state]}-{snapshot}.osm.pbf'
    cache.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    try:
        # Build a replacement in isolation. Failed refresh never overwrites old READY bytes.
        with tempfile.TemporaryDirectory(prefix='osm-preparing-', dir=cache) as temp:
            folder = Path(temp)
            pbf = folder / 'source.osm.pbf'
            md5response = requests.get(url + '.md5', timeout=60)
            md5response.raise_for_status()
            expected = md5response.text.split()[0]
            if not re.fullmatch('[a-f0-9]{32}', expected):
                raise ValueError('Invalid provider checksum')
            md5 = hashlib.md5()
            if local_pbf:
                shutil.copyfile(local_pbf, pbf)
                with open(pbf, 'rb') as source:
                    for chunk in iter(lambda: source.read(1 << 20), b''):
                        md5.update(chunk)
            else:
                with requests.get(url, stream=True, timeout=(30, 180)) as response:
                    response.raise_for_status()
                    with open(pbf, 'wb') as output:
                        for chunk in response.iter_content(1 << 20):
                            output.write(chunk)
                            md5.update(chunk)
            if md5.hexdigest() != expected:
                raise ValueError('PBF provider checksum mismatch; retry explicit preparation')
            digest = _sha256(pbf)
            with osmium.io.Reader(str(pbf)) as reader:
                extract_date = reader.header().get('osmosis_replication_timestamp')
            if not extract_date:
                raise ValueError('PBF missing replication snapshot timestamp')
            metrics = extract_pbf(pbf, folder)
            files = {p.name: {'bytes': p.stat().st_size, 'sha256': _sha256(p)} for p in folder.iterdir()}
            directory = f'osm-{state}-{digest[:16]}-{VERSION}'
            entry = {'id': key, 'status': 'READY', 'adapterVersion': VERSION, 'scope': 'state:' + state,
                     'provider': 'Geofabrik', 'sourceUrl': url, 'extractTimestamp': extract_date,
                     'retrievedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                     'sha256': digest, 'providerMD5': expected, 'bytes': pbf.stat().st_size,
                     'attribution': ATTRIBUTION, 'license': 'ODbL-1.0', 'licenseUrl': LICENSE,
                     'directory': directory, 'files': files, **metrics,
                     'prepareSeconds': round(time.monotonic() - started, 3)}
            (folder / 'READY').write_text(digest + '\n')
            target = cache / directory
            if target.exists():
                try:
                    validate_ready(cache, entry)
                except ValueError:
                    # A same-snapshot refresh can repair corruption without
                    # deleting the old generation before the replacement commits.
                    entry['directory'] = directory + '-repair-' + str(time.time_ns())
                    os.replace(folder, cache / entry['directory'])
            else:
                os.replace(folder, target)
            record_source(cache, key, entry)
            return entry
    except Exception as exc:
        record_source(cache, key, ({**old, 'lastBuildAttempt': {'status': 'FAILED', 'error': str(exc)}}
                                 if old else {'status': 'FAILED', 'error': str(exc)}))
        raise


def metric_transform(bbox):
    lon = (bbox[0] + bbox[2]) / 2
    lat = (bbox[1] + bbox[3]) / 2
    return Transformer.from_crs('EPSG:4326', f'+proj=aeqd +lat_0={lat} +lon_0={lon} +datum=WGS84 +units=m', always_xy=True).transform


def restrictions(tags, driving=False):
    # Conservative: explicit denials anywhere in the hierarchy are retained even
    # if another tag grants a narrower exception. We do not resolve local law.
    keys = ['access', 'foot'] + (['vehicle', 'motor_vehicle'] if driving else [])
    blocked = [f'{k}={tags[k]}' for k in keys if tags.get(k) in DENIED]
    if tags.get('locked') == 'yes':
        blocked.append('locked=yes')
    return blocked


def road_quality(tags):
    if restrictions(tags, True):
        return 'RESTRICTED'
    if tags.get('highway') == 'track':
        if tags.get('tracktype') != 'grade1' or tags.get('surface') not in {'asphalt', 'paved', 'concrete'}:
            return 'TRACK_UNCERTAIN'
    if tags.get('smoothness') in {'bad', 'very_bad', 'horrible', 'very_horrible', 'impassable'}:
        return 'ROUGH'
    return 'MAPPED_ROAD_QUALITY_UNVERIFIED'


def normalize(candidate, roads, properties, project, source_version):
    """Deterministic, bounded local evidence; no routing or inferred starts."""
    geom = shape(candidate['geometry'])
    # Points are literal OSM nodes; areas use a point on the *mapped access area*.
    point = geom if geom.geom_type == 'Point' else geom.representative_point()
    g = transform(project, geom)
    p = transform(project, point)
    kind, tags = candidate['kind'], candidate['tags']
    nearby = roads.near(g, 30)
    connected = [(r, rg, d) for r, rg, d in nearby if roads.connected(r, rg)]
    vehicles = [(r, rg, d) for r, rg, d in connected if r['tags'].get('highway') in DRIVABLE]
    closest_vehicle = min((d for _, _, d in vehicles), default=0)
    usable = [(r, rg, d) for r, rg, d in vehicles if not restrictions(r['tags'], True) and d <= closest_vehicle + 3]
    paths = [(r, rg, d) for r, rg, d in connected if r['tags'].get('highway') in PATHS and not restrictions(r['tags'])]
    # Pick by distance and source identity, not feature name; preserve the road tags.
    choices = usable or vehicles or paths or connected
    selected = min(choices, key=lambda x: (x[2], x[0]['id'])) if choices else None
    associations = []
    for prop, pg in (properties.near(p) if isinstance(properties, PropertyIndex) else properties):
        distance = pg.distance(p)
        inside = pg.covers(p)
        connection = any(rg.intersects(pg) and not restrictions(r['tags']) for r, rg, _ in connected)
        if inside or (distance <= 50 and connection):
            associations.append({'property_id': prop['property_id'], 'property_name': prop['property_name'],
                                 'method': 'inside' if inside else 'boundary-road-connection',
                                 'distance_m': round(distance, 1)})
    associations.sort(key=lambda x: x['property_id'])
    text = (tags.get('name', '') + ' ' + tags.get('operator', '')).lower()
    recreation = bool(re.search(r'\b(?:trails?|trailhead|hiking|picnic|recreation|day.use|campground|forest service|usfs)\b', text))
    context = kind != 'PARKING' or recreation or any(r['tags'].get('highway') in {'path', 'bridleway'} for r, _, _ in paths)
    grade, reasons = 'LOW', []
    blocked = restrictions(tags, kind == 'PARKING')
    conditions = {k: v for k, v in tags.items() if ':conditional' in k or k in {'seasonal', 'opening_hours'}}
    irrelevant = kind == 'PARKING' and (tags.get('parking') in {'multi-storey', 'underground', 'rooftop', 'garage', 'carports'}
                  or tags.get('building') not in {None, 'no'} or tags.get('covered') == 'yes'
                  or bool(re.search(r'supermarket|walmart|costco|apartment|resident|employee|hospital|garage', text))
                  # Regional-scale audit: institutional lots (schools, colleges,
                  # campuses, office/parent/staff lots) are not credible starts
                  # for public-land mushroom access. Name-word matches are
                  # deliberately PARKING-only: an explicit mapped trailhead
                  # stays evidence even when a place is named "School Canyon".
                  or bool(re.search(r'\b(?:school|college|university|campus|academy)\b', text))
                  or bool(re.search(r'\b(?:parent|student|staff|customer|office)\s+parking\b', tags.get('name', ''), re.I))
                  # Washington-scale audit: transit/ferry park-and-ride lots are
                  # transportation facilities, not forest access (Trimet needs
                  # its own word; other agencies carry "transit").
                  or bool(re.search(r"park(?:ing)?\s*['&+-]?\s*(?:and|&)\s*ride\b|\bp\s*[&+]r\b|transit\s+(?:center|station|mall)|commuter\s+(?:parking|lot)|\bferr(?:y|ies)\b|\btransit\b|\btrimet\b", text))
                  or any(re.search(r'\b(?:school|college|university|campus)\b', a['property_name'] or '', re.I)
                         for a in associations))
    if irrelevant:
        grade, reasons = 'REJECTED', ['Structured, institutional, transit or non-recreation parking']
    elif blocked:
        grade, reasons = 'RESTRICTED', blocked
    elif not associations:
        grade, reasons = 'REVIEW', ['No conservative property association']
    elif not connected:
        grade, reasons = 'REVIEW', ['No connected mapped road/path within 30 m']
    elif kind == 'GATE':
        grade = 'MEDIUM' if tags.get('foot') in PERMITTED or tags.get('access') in PERMITTED else 'LOW'
        reasons = ['Mapped barrier; passage must be checked']
    elif kind == 'PARKING' and not context:
        grade, reasons = 'REVIEW', ['Parking lacks mapped recreation/trail context']
    elif kind == 'PARKING' and not usable:
        grade = 'RESTRICTED' if vehicles else 'REVIEW'
        reasons = ['No unrestricted mapped vehicle approach']
    elif kind == 'TRAILHEAD' and not usable and not paths:
        grade, reasons = 'RESTRICTED', ['Mapped approach has explicit restrictions']
    else:
        grade = 'HIGH' if usable and road_quality(selected[0]['tags']) == 'MAPPED_ROAD_QUALITY_UNVERIFIED' else 'MEDIUM'
        reasons = ['Mapped trailhead' if kind == 'TRAILHEAD' else 'Mapped parking with recreation/trail context']
    if grade in {'HIGH', 'MEDIUM'}:
        if conditions or tags.get('informal') == 'yes' or any(a['method'] != 'inside' for a in associations) or len(associations) > 1:
            grade = 'MEDIUM'
        if selected and (road_quality(selected[0]['tags']) in {'TRACK_UNCERTAIN', 'ROUGH'} or any(':conditional' in k or k == 'seasonal' for k in selected[0]['tags'])):
            grade = 'LOW'
            reasons.append('Approach quality or conditional access needs review')
    eligible = grade in {'HIGH', 'MEDIUM'} and kind in {'TRAILHEAD', 'PARKING'} and not conditions and tags.get('informal') != 'yes'
    if geom.geom_type not in {'Point', 'Polygon', 'MultiPolygon'}:
        eligible = False  # no geometric midpoint of a linear barrier/road as start
    if restrictions(tags, True):
        eligible = False
    if selected and any(':conditional' in k or k == 'seasonal' for k in selected[0]['tags']):
        eligible = False
    ids = [a['property_id'] for a in associations]
    row = {'access_id': candidate['id'], 'property_id': ids[0] if len(ids) == 1 else None,
           'property_name': associations[0]['property_name'] if len(ids) == 1 else None,
           'name': tags.get('name') or 'Unnamed mapped ' + kind.lower(), 'lat': point.y, 'lon': point.x,
           'type': kind, 'feature_type': kind, 'osm_type': candidate['osm_type'], 'osm_id': candidate['osm_id'],
           'source': 'OpenStreetMap / Geofabrik', 'source_url': f"https://www.openstreetmap.org/{candidate['osm_type']}/{candidate['osm_id']}",
           'confidence': grade, 'official': False, 'verified_at': None, 'source_version': source_version,
           'geometry_json': json.dumps(candidate['geometry'], separators=(',', ':')),
           'location_method': 'osm-node' if geom.geom_type == 'Point' else 'mapped-area-representative-point' if geom.geom_type in {'Polygon', 'MultiPolygon'} else 'mapped-line-display-only',
           'property_ids_json': json.dumps(ids), 'associations_json': json.dumps(associations),
           'association_method': 'ambiguous-multiple-properties' if len(ids) > 1 else associations[0]['method'] if ids else 'unassociated',
           'association_distance_m': min((a['distance_m'] for a in associations), default=None),
           'recreation_context': context, 'evidence_grade': grade, 'evidence_reason': '; '.join(reasons), 'start_eligible': eligible,
           'road_id': selected[0]['id'] if selected else None, 'road_distance_m': round(selected[2], 1) if selected else None,
           'road_tags_json': json.dumps(selected[0]['tags']) if selected else None,
           'road_quality': road_quality(selected[0]['tags']) if selected else None,
           'connectivity': 'local-network-proximity' if connected else 'ISOLATED_OR_UNMAPPED',
           'restriction': '; '.join(blocked + (restrictions(selected[0]['tags'], kind == 'PARKING') if selected else [])) or None,
           'parking_type': tags.get('parking'), 'conditions_json': json.dumps(conditions),
           'notes': '; '.join(reasons + [f'{k}: {tags[k]}' for k in ('access', 'vehicle', 'motor_vehicle', 'foot', 'fee', 'seasonal', 'locked') if k in tags]) + '. Public access not independently verified; check current restrictions.'}
    row.update({k: tags.get(k) for k in TAGS if k in dict(COLUMNS) and k != 'name'})
    if row['start_eligible'] and row['restriction']:
        row.update(start_eligible=False, evidence_grade='RESTRICTED', confidence='RESTRICTED',
                   evidence_reason='Selected mapped approach has explicit restrictions')
        row['notes'] = row['evidence_reason'] + ': ' + row['restriction'] + '. Verify any alternative approach independently.'
    return row


class PropertyIndex:
    def __init__(self, entries):
        self.entries = entries
        self.tree = STRtree([g for _, g in entries])

    def near(self, point):
        return [self.entries[int(i)] for i in self.tree.query(point, predicate='dwithin', distance=50)]


class RoadIndex:
    def __init__(self, records, project):
        self.records = records
        self.geometries = [transform(project, shape(r['geometry'])) for r in records]
        self.tree = STRtree(self.geometries)
        self._connected = {}

    def near(self, g, distance):
        return [(self.records[int(i)], self.geometries[int(i)], self.geometries[int(i)].distance(g))
                for i in self.tree.query(g, predicate='dwithin', distance=distance)]

    def connected(self, road, geom):
        # Require a second mapped way nearby. A lone short driveway cannot prove
        # access; proximity is a sanity check, not a claim of routability.
        if road['id'] not in self._connected:
            self._connected[road['id']] = any(r['id'] != road['id'] for r, _, _ in self.near(geom, 3))
        return self._connected[road['id']]


def read_local(path, bbox):
    # DuckDB applies the numeric bounds before Python geometry work.
    with duckdb.connect() as con:
        rows = con.execute('SELECT id, osm_type, osm_id, kind, tags_json, geometry_json FROM read_parquet(?) WHERE min_lon <= ? AND max_lon >= ? AND min_lat <= ? AND max_lat >= ?',
                           [str(path), bbox[2], bbox[0], bbox[3], bbox[1]]).fetchall()
    result = []
    tile = box(*bbox)
    for ident, osm_type, osm_id, kind, tags, geometry in rows:
        g = json.loads(geometry)
        if shape(g).intersects(tile):
            result.append({'id': ident, 'osm_type': osm_type, 'osm_id': osm_id, 'kind': kind,
                           'tags': json.loads(tags), 'geometry': g})
    return result


def representative_point(candidate):
    """Display/association location: the node coordinate, or a point on a mapped
    area. Used for the single-tile assignment so an edge-crossing polygon is
    published exactly once with its full geometry."""
    geometry = candidate['geometry'] if isinstance(candidate, dict) else candidate
    shape_geom = shape(geometry)
    return shape_geom if shape_geom.geom_type == 'Point' else shape_geom.representative_point()


def in_tile(candidate, bbox):
    """Half-open tile membership [west, east) x [south, north): a feature on an
    integer-degree edge belongs to exactly one tile, never two."""
    point = representative_point(candidate)
    return bbox[0] <= point.x < bbox[2] and bbox[1] <= point.y < bbox[3]


def build(cache, states, tile_id, out, root=Path(__file__).resolve().parents[1]):
    started = time.monotonic()
    manifest = json.loads((root / 'data/fruiting-forecast/manifest.json').read_text())
    tiles = {t['id']: t for t in manifest['tiles']}
    if tile_id not in manifest['summary']['coverageTiles']:
        raise ValueError('Access proof is limited to existing release geography')
    bbox = tile_bbox(tile_id)
    # Use neighbouring published property polygons to avoid artificial tile-boundary associations.
    halo = [bbox[0] - .01, bbox[1] - .01, bbox[2] + .01, bbox[3] + .01]
    project = metric_transform(bbox)
    from shapely.ops import unary_union
    grouped = {}
    with duckdb.connect() as con:
        for tile in tiles.values():
            if not box(*tile['bbox']).intersects(box(*halo)) or not tile.get('publicLands', {}).get('url'):
                continue
            path = root / 'data/fruiting-forecast' / tile['publicLands']['url']
            for pid, name, ownership, geometry in con.execute('SELECT property_id, property_name, ownership_class, geometry_json FROM read_parquet(?)', [str(path)]).fetchall():
                if ownership in {'PRIVATE', 'LIKELY_PRIVATE'}:
                    continue
                entry = grouped.setdefault(pid, {'property_id': pid, 'property_name': name, 'geoms': []})
                entry['geoms'].append(shape(json.loads(geometry)))
    properties = PropertyIndex([(r, transform(project, unary_union(r['geoms']))) for r in grouped.values()])
    candidates, roads, sources = {}, {}, []
    for state in states:
        entry = load_cache_manifest(cache)['sources'].get('osm_access:' + state.upper())
        folder = validate_ready(cache, entry)
        sources.append({k: v for k, v in entry.items() if k not in {'files', 'directory'}})
        candidates.update({r['id']: r for r in read_local(folder / 'candidates.parquet', bbox) if in_tile(r, bbox)})
        roads.update({r['id']: r for r in read_local(folder / 'roads.parquet', halo)})
    index = RoadIndex(list(roads.values()), project)
    source_version = VERSION + ':' + ':'.join(s['sha256'][:16] for s in sources)
    normalized = [normalize(r, index, properties, project, source_version) for r in sorted(candidates.values(), key=lambda x: x['id'])]
    barriers = [r for r in candidates.values() if r['kind'] == 'GATE' and restrictions(r['tags'], True)]
    for row in normalized:
        if not row['start_eligible'] or not row['road_id']:
            continue
        road_geom = transform(project, shape(roads[row['road_id']]['geometry']))
        start_geom = transform(project, shape(json.loads(row['geometry_json'])))
        blocked = [r for r in barriers if transform(project, shape(r['geometry'])).distance(start_geom) <= 100
                   and transform(project, shape(r['geometry'])).distance(road_geom) <= 3]
        if blocked:
            row.update(start_eligible=False, evidence_grade='REVIEW', confidence='REVIEW',
                       restriction='Nearby restricted barrier on mapped approach',
                       evidence_reason='Restricted barrier within 100 m: ' + ', '.join(r['id'] for r in blocked))
            row['notes'] = row['evidence_reason'] + '. Passage must be checked; this is not a routed approach.'
    # Unassociated city parking is audited locally, not sent to every browser.
    published = [r for r in normalized if json.loads(r['property_ids_json']) and r['recreation_context'] and r['evidence_grade'] != 'REJECTED']
    stats = {'candidates': len(normalized), 'roads': len(roads), 'published': len(published),
             'grades': dict(Counter(r['evidence_grade'] for r in normalized)),
             'publishedGrades': dict(Counter(r['evidence_grade'] for r in published)),
             'starts': sum(r['start_eligible'] for r in published), 'processingSeconds': round(time.monotonic() - started, 3)}
    meta = {'datasetVersion': source_version, 'sourceUrl': sources[0]['sourceUrl'], 'sources': sources,
            'schemaVersion': 2, 'status': 'AVAILABLE' if published else 'VERIFIED_EMPTY',
            'statusNote': 'Mapped OSM evidence only. No suitable mapped feature does not mean inaccessible. Public ownership and collecting permission are separate.',
            'attribution': ATTRIBUTION, 'license': 'ODbL-1.0', 'licenseUrl': LICENSE,
            'preparationScope': [s['scope'] for s in sources], 'metrics': stats}
    write_parquet(out / 'ap' / (tile_id + '.parquet'), published, COLUMNS, meta)
    (out / 'ap' / (tile_id + '.audit.json')).write_text(json.dumps(normalized, indent=2) + '\n')
    return {**stats, 'bytes': (out / 'ap' / (tile_id + '.parquet')).stat().st_size}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    prep = sub.add_parser('prepare')
    prep.add_argument('--state', required=True, choices=STATES)
    prep.add_argument('--snapshot', default='latest')
    prep.add_argument('--refresh', action='store_true')
    prep.add_argument('--pbf', type=Path, help='Local copy of this provider snapshot; still checked against provider MD5')
    tile = sub.add_parser('build')
    tile.add_argument('--state', required=True, help='Comma-separated prepared state codes')
    tile.add_argument('--tile', required=True)
    tile.add_argument('--out', type=Path, default=Path('/tmp/fruiting-access-normalized'))
    for p in (prep, tile):
        p.add_argument('--cache', type=Path, default=Path('/tmp/fruiting-forecast-gis-sources'))
    args = parser.parse_args()
    result = prepare(args.cache, args.state, args.refresh, args.snapshot, args.pbf) if args.command == 'prepare' else build(args.cache, args.state.split(','), args.tile, args.out)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
