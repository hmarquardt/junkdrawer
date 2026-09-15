#!/usr/bin/env python3
"""Bounded PNW regional release: derive tiles for a state from the pinned EPA Level III
geometry, plan the build from real published measurements, and orchestrate the
existing prepare/build/publish pipeline deterministically.

uv run tools/fruiting_pnw_release.py plan  --state OR|WA [--source-cache DIR] [--access-cache DIR]
uv run tools/fruiting_pnw_release.py run   --state OR|WA [--access-states OR,WA] [--source-cache DIR] [--access-cache DIR]
    [--out DIR] [--resume] [--only TID[,TID...]] [--dry-run]

Tile selection is reproducible from repository data (ecoregions.json, states.json):
a tile is CORE when at least CORE_PCT percent of its area is Pacific Northwest
Maritime ecology (EPA codes 1/2/3/4); a tile between HALO_PCT and CORE_PCT is a
HALO only when it is four-connected to the selected set, so search radii near the
release edge load real neighboring evidence instead of ending abruptly. Candidates
must be predominantly inside the selected state (state share >= STATE_SHARE of tile
area), so each state's release stays administrative-bounded while the ecological
selection itself is state-independent. The same derivation produced the Oregon
release and produces Washington; no rectangle and no hand-maintained list.

Tiles near a shared boundary (e.g. the Columbia River) can contain meaningful land
in more than one prepared OSM state; per tile, access evidence is composed from
exactly the prepared states whose geometry intersects the tile (deduplicated by
stable OSM identity), and soil already composes per point by exact MUKEY state
membership. No parallel Washington architecture.
"""
import argparse
import json
import math
import os
import sys
import time
from collections import deque
from pathlib import Path

from shapely.geometry import box
from shapely.ops import transform as shp_transform
from shapely.ops import unary_union
from shapely.validation import make_valid
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/fruiting-forecast'
sys.path.insert(0, str(ROOT / 'tools'))

CORE_PCT = 50.0
HALO_PCT = 25.0
STATE_SHARE = 25.0
PROFILE_CODES = {'pnw': ('1', '2', '3', '4')}
METRIC_CRS = 'EPSG:5070'


def _projected(geom, transformer):
    return shp_transform(lambda x, y: transformer.transform(x, y), geom)


def _load_geometries(state_code='OR'):
    eco = json.loads((DATA / 'ecoregions.json').read_text())
    pnw_parts, profiles = [], {}
    for feature in eco['features']:
        code = str(feature['properties']['code'])
        geometry = make_valid(shape_of(feature['geometry']))
        if code in PROFILE_CODES['pnw']:
            pnw_parts.append(geometry)
        for profile, codes in PROFILE_CODES.items():
            if code in codes:
                profiles.setdefault(profile, []).append(geometry)
    states = json.loads((DATA / 'states.json').read_text())
    state_geometry = None
    for feature in states['features']:
        if feature['properties'].get('code') == state_code:
            state_geometry = make_valid(shape_of(feature['geometry']))
    if state_geometry is None:
        raise SystemExit(f'State {state_code} not found in pinned states.json')
    return pnw_parts, profiles, state_geometry


def shape_of(geometry):
    from shapely.geometry import shape
    return shape(geometry)


def tile_id_of(lat, lon):
    return f'n{lat:02d}_w{abs(lon):03d}'


def _search_window(state_geometry):
    """Candidate 1-degree tiles around the state: state bounds expanded by one
    tile in every direction, so shared-boundary tiles stay candidates."""
    west, south, east, north = state_geometry.bounds
    latitudes = range(max(24, math.floor(south) - 1), min(50, math.ceil(north) + 1) + 1)
    longitudes = range(math.floor(west) - 1, math.ceil(east) + 1)
    if any(value < 24 for value in latitudes) or any(value >= 0 for value in longitudes):
        raise SystemExit('Only CONUS (north/west) tile addressing is supported')
    return latitudes, longitudes


def shares_for_tiles(state_code='OR', latitudes=None, longitudes=None,
                     profile_groups=None):
    """Per-tile PNW/state/adjacent-profile area shares in an equal-area CRS.

    The candidate window is derived from the pinned state geometry, so the same
    contract generalizes to any state without a hardcoded grid.
    """
    from fruiting_tile_publish import ECO_PROFILE_GROUPS
    pnw_parts, _, state_geometry = _load_geometries(state_code)
    if latitudes is None or longitudes is None:
        latitudes, longitudes = _search_window(state_geometry)
    eco = json.loads((DATA / 'ecoregions.json').read_text())
    others = {}
    for feature in eco['features']:
        code = str(feature['properties']['code'])
        if code in PROFILE_CODES['pnw']:
            continue
        profile = next((name for name, codes in ECO_PROFILE_GROUPS.items() if code in [str(c) for c in codes]), None)
        if profile:
            others.setdefault(profile, []).append(make_valid(shape_of(feature['geometry'])))
    transformer = Transformer.from_crs('EPSG:4326', METRIC_CRS, always_xy=True)
    pnw = _projected(unary_union(pnw_parts), transformer)
    state = _projected(state_geometry, transformer)
    profile_areas = {name: _projected(unary_union(parts), transformer) for name, parts in others.items()}
    rows = []
    for lat in latitudes:
        for lon in longitudes:
            tile = _projected(box(lon, lat, lon + 1, lat + 1), transformer)
            total = tile.area
            state_share = tile.intersection(state).area / total * 100
            pnw_share = tile.intersection(pnw).area / total * 100
            adjacent = {}
            for name, geometry in profile_areas.items():
                share = tile.intersection(geometry).area / total * 100
                if share >= 5.0:
                    adjacent[name] = round(share, 1)
            rows.append({
                'tile': tile_id_of(lat, lon), 'lat': lat, 'lon': lon,
                'stateSharePct': round(state_share, 1),
                'pnwSharePct': round(pnw_share, 1),
                'adjacentProfiles': dict(sorted(adjacent.items(), key=lambda kv: -kv[1])),
            })
    return [row for row in rows if row['stateSharePct'] >= 1.0]


def _parse_tile(tid):
    return int(tid[1:3]), -int(tid[5:8])


def select_tiles(shares, core_pct=CORE_PCT, halo_pct=HALO_PCT, state_share=STATE_SHARE):
    """Core = PNW >= core_pct; halo = 25..core_pct, four-connected to the selection.

    Deterministic: candidates are sorted, the core set seeds a BFS, and halo tiles
    join only through a four-neighbor chain so the release stays a coherent region.
    """
    eligible = [row for row in shares if row['stateSharePct'] >= state_share]
    by_id = {row['tile']: row for row in eligible}
    core = sorted(row['tile'] for row in eligible if row['pnwSharePct'] >= core_pct)
    selected = set(core)
    queue = deque(core)
    while queue:
        lat, lon = _parse_tile(queue[0])
        for lat2, lon2 in ((lat + 1, lon), (lat - 1, lon), (lat, lon + 1), (lat, lon - 1)):
            neighbor = tile_id_of(lat2, lon2)
            if neighbor in selected or neighbor not in by_id:
                continue
            if halo_pct <= by_id[neighbor]['pnwSharePct'] < core_pct:
                selected.add(neighbor)
                queue.append(neighbor)
        queue.popleft()
    for row in eligible:
        row['role'] = ('core' if row['tile'] in set(core)
                       else 'halo' if row['tile'] in selected else None)
    ordered = sorted((r for r in eligible if r['tile'] in selected),
                     key=lambda r: (*_parse_tile(r['tile']), r['tile']))
    return [row['tile'] for row in ordered], {row['tile']: row for row in eligible}


def _canary_measurements(manifest, tile_ids):
    """Real published per-tile bytes from the existing release, never invented."""
    tiles = {t['id']: t for t in manifest['tiles']}
    out = {}
    for tile_id in tile_ids:
        tile = tiles.get(tile_id) or {}
        out[tile_id] = {key: (tile.get(key) or {}).get('bytes') for key in ('habitat', 'publicLands', 'fireHistory', 'accessPoints')}
    return out


def build_plan(state_code='OR', source_cache=None, access_cache=None, core_pct=CORE_PCT,
               halo_pct=HALO_PCT, state_share=STATE_SHARE, only=None):
    shares_all = shares_for_tiles(state_code)
    tiles, eligible = select_tiles(shares_all, core_pct, halo_pct, state_share)
    if only:
        wanted = {t.strip() for t in only.split(',') if t.strip()}
        missing = wanted - set(tiles)
        if missing:
            raise SystemExit(f'Tiles not in the derived release: {sorted(missing)}')
        tiles = sorted(wanted)
    manifest = json.loads((DATA / 'manifest.json').read_text())
    published = {t['id'] for t in manifest['tiles']}
    new_tiles = [t for t in tiles if t not in published]
    canaries = [t for t in tiles if t in published]
    measured = _canary_measurements(manifest, [t for t in tiles if t in published]) or {}
    # Estimates use only real published PNW measurements; if none exist yet the
    # plan says so instead of guessing.
    known = [m for m in measured.values() if m.get('habitat')]
    est = {'basis': 'measured published PNW tiles' if known else 'no published PNW tile yet'}
    if known:
        per_layer = {key: sum((m.get(key) or 0) for m in known) // len(known)
                     for key in ('habitat', 'publicLands', 'fireHistory', 'accessPoints')}
        est.update({key + 'BytesPerTile': value for key, value in per_layer.items()})
        est['estimatedNewBytes'] = {key: value * len(new_tiles) for key, value in per_layer.items()}
        est['estimatedNewBytesTotal'] = sum(per_layer.values()) * len(new_tiles)
    plan = {
        'state': state_code,
        'derivedFrom': 'pinned EPA Level III (ecoregions.json) + Census states (states.json), equal-area EPSG:5070',
        'thresholds': {'corePct': core_pct, 'haloPct': halo_pct, 'stateSharePct': state_share},
        'tiles': tiles,
        'roles': {t: eligible[t]['role'] for t in tiles},
        'shares': {t: {'pnwSharePct': eligible[t]['pnwSharePct'], 'stateSharePct': eligible[t]['stateSharePct'],
                       'adjacentProfiles': eligible[t]['adjacentProfiles']} for t in tiles},
        'existingTiles': sorted(canaries),
        'newTiles': sorted(new_tiles),
        'estimates': est,
    }
    if source_cache:
        plan['sourceCache'] = _cache_status(Path(source_cache), tiles)
    if access_cache:
        plan['accessCache'] = _access_status(Path(access_cache), state_code)
    return plan


def _cache_status(cache, tiles):
    from fruiting_bulk_adapters import load_cache_manifest, usgs_dem_tile_id
    if not cache.exists():
        return {'path': str(cache), 'exists': False, 'nationalReady': [], 'soilReady': [],
                'demPrepared': [], 'demMissingForRelease': sorted(tiles)}
    manifest = load_cache_manifest(cache).get('sources', {})
    dem_missing = [t for t in tiles if f'3dep_1arcsecond:{usgs_dem_tile_id(t)}' not in manifest]
    return {
        'path': str(cache), 'exists': True,
        'nationalReady': sorted(k for k in manifest if not k.startswith(('ssurgo', '3dep')) and manifest[k].get('status') == 'READY'),
        'soilReady': sorted(k for k in manifest if k.startswith('ssurgo') and manifest[k].get('status') == 'READY'),
        'demPrepared': sorted(k.split(':')[1] for k in manifest if k.startswith('3dep') and manifest[k].get('status') == 'READY'),
        'demMissingForRelease': sorted(dem_missing),
    }


def _access_status(cache, state_code='OR'):
    from fruiting_bulk_adapters import load_cache_manifest
    entry = load_cache_manifest(cache).get('sources', {}).get('osm_access:' + state_code)
    if not entry:
        return {'path': str(cache), 'ready': False,
                'note': f'run tools/fruiting_osm_access.py prepare --state {state_code}'}
    return {'path': str(cache), 'ready': entry.get('status') == 'READY',
            'sourceUrl': entry.get('sourceUrl'), 'extractTimestamp': entry.get('extractTimestamp'),
            'sha256': entry.get('sha256'), 'bytes': entry.get('bytes')}


def _publish(root, tile_ids, layers, source_dir):
    """Publish through the existing publisher boundary (lock/checkpoint/resume)."""
    from fruiting_tile_publish import publish_tiles
    return publish_tiles(root, tile_ids, layers, source_dir, output=DATA)


def _journal(path):
    return json.loads(path.read_text()) if path.exists() else {}


def _save_journal(path, journal):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(journal, indent=2, sort_keys=True) + '\n')
    os.replace(tmp, path)


def _access_states_for_tile(tile_id, prepared_states, tolerance=0.01):
    """Prepared OSM states whose geometry reaches the tile: boundary tiles merge
    evidence from every state they actually contain (deduplicated by stable OSM
    identity downstream), interior tiles stay single-state."""
    from fruiting_bulk_adapters import tile_bbox
    needed = []
    for code in prepared_states:
        _, _, geometry = _load_geometries(code)
        if geometry.intersects(box(tile_bbox(tile_id)[0] - tolerance, tile_bbox(tile_id)[1] - tolerance,
                                   tile_bbox(tile_id)[2] + tolerance, tile_bbox(tile_id)[3] + tolerance)):
            needed.append(code)
    return sorted(needed)


def run(state_code='OR', source_cache=Path('/tmp/fruiting-forecast-gis-sources'),
        access_cache=None, out=Path('/tmp/ff-pnw-norm'), only=None, resume=False,
        core_pct=CORE_PCT, halo_pct=HALO_PCT, state_share=STATE_SHARE, access_states=None):
    started = time.monotonic()
    access_cache = Path(access_cache) if access_cache else Path(source_cache)
    source_cache, out = Path(source_cache), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    journal_path = out / f'pnw-release-journal-{state_code}.json'
    journal = _journal(journal_path)
    access_cache_manifest = None

    shares_all = shares_for_tiles(state_code)
    tiles, eligible = select_tiles(shares_all, core_pct, halo_pct, state_share)
    if only:
        wanted = {t.strip() for t in only.split(',') if t.strip()}
        missing = wanted - set(tiles)
        if missing:
            raise SystemExit(f'Tiles not in the derived release: {sorted(missing)}')
        tiles = sorted(wanted)
    print(f'Derived {len(tiles)} release tiles for {state_code}: {", ".join(tiles)}', flush=True)

    from fruiting_bulk_adapters import (build_fire, build_habitat, build_public_land,
                                        load_cache_manifest, prepare_national, prepare_state,
                                        prepare_tile, soil_inputs, tile_bbox)
    from fruiting_osm_access import build as build_access, validate_ready as validate_access_ready

    # 1. Reusable sources: national products and state soil are prepared once; a
    #    READY entry is reused and never re-downloaded.
    print('preparing national sources (reused when already READY)', flush=True)
    prepare_national(source_cache, ['forest-type', 'land-cover', 'canopy', 'states'])
    print(f'preparing {state_code} soil (reused when already READY)', flush=True)
    prepare_state(source_cache, state_code)
    prepared_states = [state_code] + [s.strip().upper() for s in (access_states or '').split(',') if s.strip()]
    prepared_states = sorted(dict.fromkeys(prepared_states))
    for code in prepared_states:
        entry = load_cache_manifest(access_cache).get('sources', {}).get('osm_access:' + code)
        if not entry:
            raise SystemExit(f'Prepared {code} OSM access source not found; run '
                             'tools/fruiting_osm_access.py prepare --state ' + code + ' first (never per tile)')
        validate_access_ready(access_cache, entry)
        print(f"{code} access source validated: {entry.get('sourceUrl')}", flush=True)

    manifest = json.loads((DATA / 'manifest.json').read_text())
    published_tiles = {t['id']: t for t in manifest['tiles']}

    # 2. Phase A: habitat + public land + fire, published per tile so habitat
    #    completeness (and coverageTiles) precedes the access proof pass. Tiles
    #    already published complete are never rebuilt by another state's run.
    phase_a = [t for t in tiles
               if (published_tiles.get(t, {}).get('habitat') or {}).get('status') != 'AVAILABLE'
               and not (resume and (journal.get(t, {}).get('habitat') and _published_matches(t, journal[t]['habitat'], 'habitat')))]
    for t in tiles:
        if t not in phase_a:
            journal.setdefault(t, {}).setdefault('habitat', {})
            if (published_tiles.get(t, {}).get('habitat') or {}).get('sha256'):
                journal[t]['habitat'] = {'sha256': published_tiles[t]['habitat']['sha256'], 'previouslyPublished': True}
    if phase_a:
        print(f'phase A (habitat/public-land/fire): {", ".join(phase_a)}', flush=True)
    for tile in phase_a:
        tile_started = time.monotonic()
        try:
            prepare_tile(source_cache, tile)
            soil = soil_inputs(source_cache, [state_code], tile)
            results = {
                'habitat': build_habitat(tile, source_cache, out, soil_prepared=soil),
                'public-land': build_public_land(tile, source_cache, out),
                'fire': build_fire(tile, source_cache, out),
            }
            failures = _publish(ROOT, [tile], ['habitat', 'public-land', 'fire'], out)
            if failures:
                raise RuntimeError(f'{failures} publication failures for {tile}')
            journal[tile] = {'habitat': {'sha256': _published_sha256(tile, 'habitat'),
                                         'seconds': round(time.monotonic() - tile_started, 1)}}
        except Exception as exc:
            journal.setdefault(tile, {})['habitat'] = {'error': str(exc)}
            print(f'FAILED {tile} phase A: {exc}', flush=True)
        _save_journal(journal_path, journal)

    # 3. Phase B: access proof for every tile whose habitat is complete (the
    #    access builder requires the tile to be inside the release coverage).
    #    Per tile, evidence is composed from exactly the prepared states that
    #    geographically reach the tile.
    manifest = json.loads((DATA / 'manifest.json').read_text())
    coverage = set(manifest['summary'].get('coverageTiles', []))
    phase_b = [t for t in tiles if t in coverage and not (resume and (journal.get(t, {}).get('access') and _published_matches(t, journal[t]['access'], 'accessPoints')))]
    if phase_b:
        print(f'phase B (access): {", ".join(phase_b)}', flush=True)
    for tile in phase_b:
        tile_started = time.monotonic()
        tile_access_states = _access_states_for_tile(tile, prepared_states)
        try:
            build_access(access_cache, tile_access_states, tile, out)
            failures = _publish(ROOT, [tile], ['access'], out)
            if failures:
                raise RuntimeError(f'{failures} publication failures for {tile}')
            journal.setdefault(tile, {})['access'] = {'sha256': _published_sha256(tile, 'accessPoints'),
                                                      'states': tile_access_states,
                                                      'seconds': round(time.monotonic() - tile_started, 1)}
        except Exception as exc:
            journal.setdefault(tile, {})['access'] = {'error': str(exc)}
            print(f'FAILED {tile} phase B: {exc}', flush=True)
        _save_journal(journal_path, journal)

    blocked = [t for t in tiles if t not in coverage and journal.get(t, {}).get('habitat', {}).get('sha256')]
    summary = {'state': state_code, 'tiles': tiles,
               'habitatComplete': sorted(t for t in tiles if journal.get(t, {}).get('habitat', {}).get('sha256')),
               'accessComplete': sorted(t for t in tiles if journal.get(t, {}).get('access', {}).get('sha256')),
               'habitatFailed': sorted(t for t in tiles if journal.get(t, {}).get('habitat', {}).get('error')),
               'accessFailed': sorted(t for t in tiles if journal.get(t, {}).get('access', {}).get('error')),
               'accessBlockedIncompleteHabitat': sorted(blocked),
               'accessStatesByTile': {t: _access_states_for_tile(t, prepared_states) for t in tiles if t in coverage},
               'seconds': round(time.monotonic() - started, 1)}
    print(json.dumps(summary, indent=2), flush=True)
    if summary['habitatFailed'] or summary['accessFailed']:
        raise SystemExit(1)
    return summary


def _published_sha256(tile, key):
    manifest = json.loads((DATA / 'manifest.json').read_text())
    entry = next((t for t in manifest['tiles'] if t['id'] == tile), {})
    return (entry.get(key) or {}).get('sha256')


def _published_matches(tile, record, key):
    """A journal entry counts as done only while the manifest still agrees."""
    sha = record.get('sha256')
    return bool(sha) and _published_sha256(tile, key) == sha


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('plan', 'run'):
        p = sub.add_parser(name)
        p.add_argument('--state', default='OR')
        p.add_argument('--source-cache', default=Path('/tmp/fruiting-forecast-gis-sources'), type=Path)
        p.add_argument('--access-cache', default=None, type=Path)
        p.add_argument('--core-pct', type=float, default=CORE_PCT)
        p.add_argument('--halo-pct', type=float, default=HALO_PCT)
        p.add_argument('--state-share', type=float, default=STATE_SHARE)
        p.add_argument('--only', default=None, help='Restrict to a comma-separated subset of the derived tiles')
        if name == 'run':
            p.add_argument('--out', default=Path('/tmp/ff-pnw-norm'), type=Path)
            p.add_argument('--resume', action='store_true')
            p.add_argument('--access-states', default=None,
                           help='Extra prepared OSM states to merge for boundary tiles (e.g. OR,WA); '
                                'each tile still composes only the states that geographically reach it')
            p.add_argument('--dry-run', action='store_true', help='Print the plan and exit without building')
    args = parser.parse_args()
    if args.command == 'plan':
        print(json.dumps(build_plan(args.state, args.source_cache, args.access_cache,
                                    args.core_pct, args.halo_pct, args.state_share, args.only), indent=2))
        return
    if args.dry_run:
        print(json.dumps(build_plan(args.state, args.source_cache, args.access_cache,
                                    args.core_pct, args.halo_pct, args.state_share, args.only), indent=2))
        return
    run(args.state, args.source_cache, args.access_cache, args.out, args.only, args.resume,
        args.core_pct, args.halo_pct, args.state_share, args.access_states)


if __name__ == '__main__':
    main()
