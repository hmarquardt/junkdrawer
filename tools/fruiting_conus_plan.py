#!/usr/bin/env python3
"""Deterministic CONUS production planner for Fruiting Forecast.

Enumerates one-degree CONUS land tiles from pinned repository geography
(tile catalog, EPA Level III ecoregions, Census states) plus the current
release manifest, and reports per-tile and per-profile work remaining:

    uv run --with shapely --with pyproj --with duckdb tools/fruiting_conus_plan.py plan --scope conus
    uv run --with ... tools/fruiting_conus_plan.py plan --profile northernForests
    uv run --with ... tools/fruiting_conus_plan.py plan --state MI
    uv run --with ... tools/fruiting_conus_plan.py coverage
    uv run --with ... tools/fruiting_conus_plan.py run --tiles n45_w085,n45_w070 [--out DIR]

Nothing here infers a tile's state or ecology from its center: multi-state and
multi-profile tiles are first-class, and every share is an equal-area (EPSG:5070)
polygon intersection against pinned geometry. Land share is tile ∩ (union of
pinned states), so ocean and Great Lakes water are excluded without inventing a
land mask. Byte estimates are derived from the published manifest's own
per-tile distributions, never hardcoded.
"""
import argparse
import json
import math
import statistics
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

from shapely.geometry import box
from shapely.ops import transform as shp_transform
from shapely.ops import unary_union
from shapely.validation import make_valid
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/fruiting-forecast'
sys.path.insert(0, str(ROOT / 'tools'))
METRIC_CRS = 'EPSG:5070'
LAYERS = ('habitat', 'publicLands', 'fireHistory', 'accessPoints')
# A state must meaningfully occupy a tile to require its soil/PBF preparation.
SOURCE_STATE_SHARE = 5.0
# A tile's dominant profile needs at least this share to claim it.
DOMINANT_PROFILE_SHARE = 50.0


def shape_of(geometry):
    from shapely.geometry import shape
    return shape(geometry)


def _projected(geom, transformer):
    return shp_transform(lambda x, y: transformer.transform(x, y), geom)


def re_iter_profiles(html):
    import re
    return re.finditer(r"([a-zA-Z]+):\{name:'([^']+)',maturity:'(MODELED_SPARSE|MODELED|PROVISIONAL|UNSUPPORTED|PROVISIONAL_FORECAST|VALIDATED)'", html)


def load_geography():
    from fruiting_tile_publish import ECO_PROFILE_GROUPS
    eco = json.loads((DATA / 'ecoregions.json').read_text())
    profiles = {}
    for feature in eco['features']:
        code = str(feature['properties']['code'])
        profile = next((name for name, codes in ECO_PROFILE_GROUPS.items()
                        if code in [str(c) for c in codes]), None)
        if profile:
            profiles.setdefault(profile, []).append(make_valid(shape_of(feature['geometry'])))
    states = json.loads((DATA / 'states.json').read_text())
    state_geoms = {}
    for feature in states['features']:
        code = feature['properties'].get('code')
        if code:
            state_geoms[code] = make_valid(shape_of(feature['geometry']))
    catalog = json.loads((DATA / 'tile-catalog-full.json').read_text())
    return profiles, state_geoms, catalog


def _profile_maturity_map():
    """Profile maturity read from the browser file."""
    html = (ROOT / 'fruiting-forecast.html').read_text()
    out = {}
    for match in re_iter_profiles(html):
        out[match.group(1)] = match.group(3)
    return out


def measured_per_tile_bytes(manifest):
    """Per-layer published byte distributions from the real manifest.

    Only AVAILABLE (modern bulk-built) layers count: the legacy sampler tiles
    carry tiny PARTIAL assets that would bias the national median downward."""
    per_layer = defaultdict(list)
    for tile in manifest['tiles']:
        for layer in LAYERS:
            entry = tile.get(layer) or {}
            if entry.get('status') == 'AVAILABLE' and entry.get('bytes'):
                per_layer[layer].append(entry['bytes'])
    stats = {}
    for layer, values in per_layer.items():
        values.sort()
        stats[layer] = {
            'n': len(values),
            'median': int(statistics.median(values)),
            'p25': int(values[max(0, len(values) // 4)]),
            'p75': int(values[min(len(values) - 1, 3 * len(values) // 4)]),
            'total': sum(values),
        }
    return stats


def tile_states_and_profiles(tile_geom, state_areas, profile_areas, transformer):
    states = {code: _projected(tile_geom, transformer).intersection(_projected(g, transformer)).area
              for code, g in state_areas.items()}
    total = tile_geom.area
    state_shares = {code: round(area / total * 100, 2) for code, area in states.items() if area / total >= 0.005}
    profile_shares = {}
    for name, g in profile_areas.items():
        share = _projected(tile_geom, transformer).intersection(_projected(g, transformer)).area / total * 100
        if share >= 1.0:
            profile_shares[name] = round(share, 1)
    return state_shares, profile_shares


def build_tiles(scope='conus', profile=None, state=None, source_cache=None, min_land=1.0, access_cache=None):
    """Enumerate tiles with derived state/profile shares and publication status."""
    profiles, state_geoms, catalog = load_geography()
    maturity = _profile_maturity_map()
    manifest = json.loads((DATA / 'manifest.json').read_text())
    published = {t['id']: t for t in manifest['tiles']}
    transformer = Transformer.from_crs('EPSG:4326', METRIC_CRS, always_xy=True)
    profile_u = {name: _projected(unary_union(parts), transformer) for name, parts in profiles.items()}
    state_u = {code: _projected(g, transformer) for code, g in state_geoms.items()}
    source_cache = Path(source_cache) if source_cache else None
    cache_sources = {}
    if source_cache and source_cache.exists():
        from fruiting_bulk_adapters import load_cache_manifest
        cache_sources = load_cache_manifest(source_cache).get('sources', {})

    access_sources = cache_sources
    if access_cache:
        from fruiting_bulk_adapters import load_cache_manifest
        access_sources = load_cache_manifest(Path(access_cache)).get('sources', {})
    rows = []
    for entry in catalog['tiles']:
        lat, lon = int(entry['id'][1:3]), -int(entry['id'][5:8])
        tile = _projected(box(lon, lat, lon + 1, lat + 1), transformer)
        # States are disjoint, so the pinned-geometry land share is the sum of
        # state intersections — the catalog's legacy land flag is not trusted
        # (it misses coastal tiles the production release already publishes).
        state_shares = {}
        state_area = 0.0
        total = tile.area
        for code, g in state_u.items():
            area = tile.intersection(g).area
            if area:
                state_area += area
                share = area / total * 100
                if share >= 1.0:
                    state_shares[code] = round(share, 1)
        land_share = state_area / total * 100
        if land_share < min_land:
            continue
        profile_shares = {name: round(tile.intersection(g).area / total * 100, 1)
                          for name, g in profile_u.items() if tile.intersects(g)}
        profile_shares = {name: share for name, share in profile_shares.items() if share >= 1.0}
        dominant = max(profile_shares, key=profile_shares.get) if profile_shares else None
        tile_entry = published.get(entry['id']) or {}
        layer_status = {layer: (tile_entry.get(layer) or {}).get('status', 'UNBUILT') for layer in LAYERS}
        required_states = sorted(code for code, share in state_shares.items() if share >= SOURCE_STATE_SHARE)
        dem_key = f'3dep_1arcsecond:n{lat + 1:02d}w{abs(lon):03d}'
        dem = (cache_sources.get(dem_key) or {}).get('status', 'unknown')
        pbf_ready = all((access_sources.get('osm_access:' + code) or {}).get('status') == 'READY'
                        for code in required_states)
        soil_ready = all((cache_sources.get('ssurgo_sda:' + code) or {}).get('status') == 'READY'
                         for code in required_states)
        rows.append({
            'id': entry['id'],
            'landSharePct': round(land_share, 1),
            'stateShares': state_shares,
            'profileShares': profile_shares,
            'dominantProfile': dominant,
            'dominantProfileShare': profile_shares.get(dominant),
            'biology': maturity.get(dominant, 'UNASSIGNED') if dominant else 'UNASSIGNED',
            'published': bool(tile_entry),
            'layerStatus': layer_status,
            'soilStatesRequired': required_states,
            'soilPrepared': soil_ready,
            'pbfStatesRequired': required_states,
            'pbfPrepared': pbf_ready,
            'demPrepared': dem == 'READY',
            'demStatus': dem,
        })
    if profile:
        rows = [r for r in rows if r['profileShares'].get(profile, 0) >= 1.0]
    if state:
        rows = [r for r in rows if r['stateShares'].get(state, 0) >= SOURCE_STATE_SHARE]
    return sorted(rows, key=lambda r: (r['id'],))


def coverage(rows=None, scope='conus'):
    """Derived national coverage: tiles, land area, biology and GIS production by profile."""
    if rows is None:
        rows = build_tiles(scope=scope)
    profiles, state_geoms, _ = load_geography()
    maturity = _profile_maturity_map()
    transformer = Transformer.from_crs('EPSG:4326', METRIC_CRS, always_xy=True)
    profile_u = {name: _projected(unary_union(parts), transformer) for name, parts in profiles.items()}
    state_u = {code: _projected(g, transformer) for code, g in state_geoms.items()}
    land_u = unary_union(list(state_u.values()))
    land_area = land_u.area / 1e6
    per_profile = {}
    for name in sorted(profile_u):
        area = profile_u[name].intersection(land_u).area / 1e6
        tiles_p = [r for r in rows if r['profileShares'].get(name, 0) >= 1.0]
        complete = [r for r in tiles_p if all(r['layerStatus'][layer] in {'AVAILABLE', 'PARTIAL', 'VERIFIED_EMPTY'}
                                              for layer in LAYERS)]
        per_profile[name] = {
            'biologyMaturity': maturity.get(name, 'UNASSIGNED'),
            'tilesIntersecting': len(tiles_p),
            'tilesGisComplete': len(complete),
            'approxLandAreaKm2': int(area),
            'approxTilesForFullCoverage': int(math.ceil(area / ((111.32 * 111.32) * 0.9))),
        }
    multi_profile = sum(1 for r in rows if len(r['profileShares']) > 1)
    multi_state = sum(1 for r in rows if len(r['stateShares']) > 1)
    return {
        'scope': scope,
        'landAreaKm2': int(land_area),
        'relevantLandTiles': len(rows),
        'tilesPublished': sum(1 for r in rows if r['published']),
        'tilesGisComplete': sum(1 for r in rows if all(r['layerStatus'][layer] in {'AVAILABLE', 'PARTIAL', 'VERIFIED_EMPTY'} for layer in LAYERS)),
        'tilesMultipleProfiles': multi_profile,
        'tilesMultipleStates': multi_state,
        'profiles': per_profile,
        'coverageSemantics': ('GIS coverage counts tiles with real per-layer publication status; biological '
                              'coverage is the pinned EPA profile maturity declared by the browser. A GIS-complete '
                              'tile under an UNSUPPORTED profile is not finished national mushroom coverage.'),
    }


def projection(rows, bytes_stats):
    """National source-load projection from measured distributions."""
    land_tiles = len(rows)
    per_layer_est, per_layer_p25, per_layer_p75 = {}, {}, {}
    for layer in LAYERS:
        stat = bytes_stats.get(layer) or {'median': 0, 'p25': 0, 'p75': 0}
        per_layer_est[layer] = stat['median'] * land_tiles
        per_layer_p25[layer] = stat['p25'] * land_tiles
        per_layer_p75[layer] = stat['p75'] * land_tiles
    total = sum(per_layer_est.values())
    states_needed = sorted({code for r in rows for code in r['soilStatesRequired']})
    dems_needed = sum(1 for r in rows if not r['demPrepared'])
    return {
        'relevantLandTiles': land_tiles,
        'estimatedPublishedBytes': per_layer_est,
        'estimatedPublishedBytesTotal': total,
        'estimatedPublishedBytesTotalP25P75': [sum(per_layer_p25.values()), sum(per_layer_p75.values())],
        'estimatedAssets': land_tiles * len(LAYERS),
        'statesNeedingSoilAndPbf': states_needed,
        'stateCount': len(states_needed),
        'demsToDownload': dems_needed,
        'basis': 'per-tile medians of currently published tiles (manifest-derived); PBF sizes depend on state area and are measured only after download',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    plan_p = sub.add_parser('plan')
    plan_p.add_argument('--scope', default='conus', choices=['conus'])
    plan_p.add_argument('--profile', default=None)
    plan_p.add_argument('--state', default=None)
    plan_p.add_argument('--source-cache', type=Path, default=None)
    plan_p.add_argument('--access-cache', type=Path, default=None)
    plan_p.add_argument('--limit', type=int, default=None, help='Truncate tile list output for humans')
    plan_p.add_argument('--out', type=Path, default=None, help='Write full JSON to a file')
    cov = sub.add_parser('coverage')
    run_p = sub.add_parser('run')
    run_p.add_argument('--tiles', required=True, help='Comma-separated tile IDs (derived sets come from plan)')
    run_p.add_argument('--out', type=Path, default=Path('/tmp/ff-pnw-norm'))
    run_p.add_argument('--source-cache', type=Path, default=Path('/tmp/fruiting-forecast-gis-sources'))
    run_p.add_argument('--access-cache', type=Path, default=None)
    run_p.add_argument('--resume', action='store_true')
    args = parser.parse_args()
    if args.command == 'coverage':
        print(json.dumps(coverage(), indent=2))
        return
    if args.command == 'plan':
        rows = build_tiles(profile=args.profile, state=args.state, source_cache=args.source_cache, access_cache=args.access_cache)
        manifest = json.loads((DATA / 'manifest.json').read_text())
        result = {'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                  'scope': args.scope, 'profileFilter': args.profile, 'stateFilter': args.state,
                  'coverage': coverage(rows), 'projection': projection(rows, measured_per_tile_bytes(manifest))}
        if args.out:
            result['tiles'] = rows
            args.out.write_text(json.dumps(result, indent=2, sort_keys=False) + '\n')
            print(f'wrote {len(rows)} tiles to {args.out}')
            return
        if args.limit:
            result['tiles'] = rows[:args.limit]
            result['tilesTruncated'] = (len(rows), args.limit)
        else:
            result['tiles'] = rows
        print(json.dumps(result, indent=2))
        return
    if args.command == 'run':
        from fruiting_pnw_release import run as run_release
        tiles = [t.strip() for t in args.tiles.split(',') if t.strip()]
        run_release('TILES', Path(args.source_cache), args.access_cache, Path(args.out),
                    ','.join(tiles), args.resume, tiles=tiles)
        return


if __name__ == '__main__':
    main()
