#!/usr/bin/env python3
"""National tile relevance normalization: one evidence-based definition.

The legacy coarse roster admitted a tile when a generalized (1:20M + ~2 km
simplification) state polygon covered at least 1% of the tile's projected area.
That produced 940 "relevant" tiles, of which 23 contain no U.S. land at the
production 0.05-degree habitat sample lattice (13 unbuilt border slivers plus 10
already-published Montana 49-degree tiles), while 5 tiles outside the roster do
contain genuine U.S. land cells.

The normalized rule is:

    A tile is relevant CONUS GIS coverage when at least one 0.05-degree habitat
    sample-cell center lies inside a U.S. state (Census cb_2023_us_state_500k,
    raw, territories excluded) AND on terrestrial land (Annual NLCD 2023 land
    cover present and not class 11 open water).

Both inputs are official, pinned products. This tool builds a compact derived
product (data/fruiting-forecast/national-relevance-v2.json) that the planner,
runner, release audit and reporting all read, so the denominator cannot drift.

    uv run --with pyshp --with shapely --with pyproj --with rasterio \
        tools/fruiting_relevance.py build
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/fruiting-forecast'
DEFAULT_OUT = DATA / 'national-relevance-v2.json'

ALGORITHM = 'us-land-evidence-cells-v1'
SAMPLE_STEP_DEGREES = 0.05

STATE_BOUNDARY = {
    'id': 'us_census_states_500k',
    'provider': 'U.S. Census Bureau',
    'product': 'Cartographic Boundary File, State, 1:500,000 (cb_2023_us_state_500k)',
    'edition': '2023',
    'url': 'https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_500k.zip',
    'sha256': '4a9b4f5cf993cd23738ac49b58fbb556f1f097fcf5e404a9dc10348dd41f7432',
    'bytes': 3249332,
    'member': 'cb_2023_us_state_500k.shp',
    'crs': 'NAD83 (EPSG:4269); reprojected to EPSG:4326 for point tests',
    'caveat': ('Cartographic boundary generalized to 1:500,000; materially finer than the legacy '
               '1:20,000,000 roster geometry and its ~2 km simplification. Shoreline-clipped, so a '
               'point inside the polygon is jurisdictional; the NLCD non-water test supplies the '
               'terrestrial requirement.'),
}
TIGER_CROSSCHECK = {
    'id': 'us_census_tiger_state_2023',
    'product': 'TIGER/Line Shapefile, State (tl_2023_us_state)',
    'url': 'https://www2.census.gov/geo/tiger/TIGER2023/STATE/tl_2023_us_state.zip',
    'sha256': '8ded0ef036e205e246ae4b03a66873f7e1eed50285b993702ce5aca674283a2e',
    'role': ('Independent full-resolution legal-boundary cross-check of the classification. It agreed on '
             'every reclassified tile (zero U.S. land cells for all 23 exclusions, real land cells for all '
             '5 inclusions and every fallback/coastal canary). Not used at runtime.'),
}


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_archive(path, url, expected_sha256, expected_bytes=None):
    """Download to `path` only when absent or checksum-mismatched; verify always."""
    path = Path(path)
    if not path.exists() or _sha256(path) != expected_sha256:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + '.part')
        with urllib.request.urlopen(url, timeout=600) as response, open(tmp, 'wb') as output:
            shutil.copyfileobj(response, output)
        digest = _sha256(tmp)
        if digest != expected_sha256:
            raise SystemExit(f'Boundary archive checksum mismatch: got {digest}, expected {expected_sha256}')
        tmp.replace(path)
    if expected_bytes and path.stat().st_size != expected_bytes:
        raise SystemExit(f'Boundary archive size mismatch: {path.stat().st_size} != {expected_bytes}')
    return path


def _load_states(archive):
    import shapefile
    from pyproj import CRS, Transformer
    from shapely.geometry import shape
    from shapely.ops import transform as shp_transform
    exclude = {'60', '66', '69', '72', '78'}  # territories, matching the project roster
    with zipfile.ZipFile(archive) as bundle:
        reader = shapefile.Reader(shp=bundle.open('cb_2023_us_state_500k.shp'),
                                  shx=bundle.open('cb_2023_us_state_500k.shx'),
                                  dbf=bundle.open('cb_2023_us_state_500k.dbf'), encoding='latin1')
        crs = CRS.from_wkt(bundle.read('cb_2023_us_state_500k.prj').decode())
        project = Transformer.from_crs(crs, 4326, always_xy=True).transform
        geoms = {}
        for record in reader.iterShapeRecords():
            props = record.record.as_dict()
            if props['GEOID'] in exclude:
                continue
            geoms[props['STUSPS']] = shp_transform(project, shape(record.shape.__geo_interface__))
    return geoms


def _load_nlcd(path):
    import rasterio
    return rasterio.open(path)


def legacy_coarse_roster():
    """Reproduce the legacy 1%-of-tile-area roster independently of the planner.

    Frozen to the historical definition (generalized states.json geometry, projected
    tile area) so the product builder cannot be affected by later planner changes.
    """
    from fruiting_conus_plan import load_geography, _projected, METRIC_CRS
    from pyproj import Transformer
    from shapely.geometry import box
    _, state_geoms, catalog = load_geography()
    transformer = Transformer.from_crs('EPSG:4326', METRIC_CRS, always_xy=True)
    state_u = {code: _projected(geom, transformer) for code, geom in state_geoms.items()}
    roster = set()
    for entry in catalog['tiles']:
        lat, lon = int(entry['id'][1:3]), -int(entry['id'][5:8])
        tile = _projected(box(lon, lat, lon + 1, lat + 1), transformer)
        state_area = sum(tile.intersection(geom).area for geom in state_u.values())
        if state_area / tile.area * 100 >= 1.0:
            roster.add(entry['id'])
    return roster


def build(state_archive, nlcd_path, catalog_path, out_path, nlcd_source):
    from fruiting_bulk_adapters import sample_points, NLCD_LANDCOVER, _sample_raster
    from rasterio.warp import transform as warp_transform
    from shapely import STRtree
    from shapely.geometry import Point
    from shapely.prepared import prep

    geoms = _load_states(state_archive)
    codes = sorted(geoms)
    tree = STRtree([geoms[code] for code in codes])
    prepared = {code: prep(geom) for code, geom in geoms.items()}
    nlcd = _load_nlcd(nlcd_path)
    nodata = tuple(NLCD_LANDCOVER['noDataValues'])
    catalog = json.loads(Path(catalog_path).read_text())

    def state_at(point):
        for index in tree.query(point):
            code = codes[int(index)]
            if prepared[code].covers(point):
                return code
        return None

    tiles = {}
    for entry in catalog['tiles']:
        tile_id = entry['id']
        points = sample_points(tile_id, SAMPLE_STEP_DEGREES)
        state_cells = {}
        land_cells = {}
        cover = _sample_raster(nlcd, warp_transform, points, extra_nodata=nodata)
        for (lat, lon), value in zip(points, cover):
            point = Point(lon, lat)
            code = state_at(point)
            if code is None:
                continue
            state_cells[code] = state_cells.get(code, 0) + 1
            if value is not None and int(value) != 11:  # 11 = open water
                land_cells[code] = land_cells.get(code, 0) + 1
        tiles[tile_id] = {
            'relevant': sum(land_cells.values()) > 0,
            'stateCells': sum(state_cells.values()),
            'landCells': sum(land_cells.values()),
            'states': dict(sorted(land_cells.items())),
            'statePolygonCells': dict(sorted(state_cells.items())),
        }

    # The legacy roster is the planner's historical coarse 1%-area set, reproduced
    # locally so this builder is independent of current planner semantics.
    coarse = legacy_coarse_roster()
    normalized = {tile_id for tile_id, record in tiles.items() if record['relevant']}
    exclusions = sorted(coarse - normalized)
    inclusions = sorted(normalized - coarse)
    product = {
        'schemaVersion': 2,
        'algorithm': ALGORITHM,
        'definition': ('A tile is relevant CONUS GIS coverage when at least one 0.05-degree habitat '
                       'sample-cell center lies inside a U.S. state (cb_2023_us_state_500k, raw) and on '
                       'terrestrial land (Annual NLCD 2023 land cover present and not class 11 open water).'),
        'sampleLattice': {'stepDegrees': SAMPLE_STEP_DEGREES, 'cellsPerTile': 400},
        'sources': {'state_boundary': STATE_BOUNDARY, 'land_cover': nlcd_source,
                    'cross_check': TIGER_CROSSCHECK},
        'summary': {
            'catalogTiles': len(tiles),
            'legacyCoarseRosterTiles': len(coarse),
            'normalizedRelevantTiles': len(normalized),
            'normalizedIrrelevantLegacyTiles': len(exclusions),
            'newlyRelevantTiles': len(inclusions),
        },
        'exclusions': [
            {'tile': tile_id,
             'legacyRelevant': True,
             'reason': ('No 0.05-degree sample-cell center lies inside a U.S. state on terrestrial land; '
                        'the legacy 1:20M+2km-simplified boundary share was a cartographic sliver.'),
             'stateCells': tiles[tile_id]['stateCells'],
             'landCells': tiles[tile_id]['landCells']}
            for tile_id in exclusions
        ],
        'inclusions': [
            {'tile': tile_id,
             'legacyRelevant': False,
             'reason': ('Genuine U.S. land evidence cells exist but the legacy 1%-of-tile-area threshold '
                        'excluded the tile.'),
             'states': tiles[tile_id]['states'],
             'landCells': tiles[tile_id]['landCells']}
            for tile_id in inclusions
        ],
        'tiles': tiles,
    }
    Path(out_path).write_text(json.dumps(product, indent=1, sort_keys=True) + '\n')
    return product


def load_product(path=DEFAULT_OUT):
    return json.loads(Path(path).read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    build_p = sub.add_parser('build', help='Build the normalized relevance product')
    build_p.add_argument('--state-archive', type=Path, default=Path('/tmp/cb_2023_us_state_500k.zip'))
    build_p.add_argument('--nlcd', type=Path,
                         default=Path('/tmp/ffsrc/extracted/da50297bc65c/Annual_NLCD_LndCov_2023_CU_C1V2.tif'))
    build_p.add_argument('--catalog', type=Path, default=DATA / 'tile-catalog-full.json')
    build_p.add_argument('--out', type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    archive = ensure_archive(args.state_archive, STATE_BOUNDARY['url'], STATE_BOUNDARY['sha256'],
                             STATE_BOUNDARY['bytes'])
    nlcd_source = {'id': 'nlcd_land_cover',
                   'product': 'Annual NLCD Land Cover, CONUS, 2023, Collection 1 Version 2',
                   'sha256': 'da50297bc65c07a8210999d20e2b59e69a8d1470273e1ed9344884988fd47aaf',
                   'role': 'Terrestrial mask: a sample cell is land when its NLCD class is present and not 11 (open water).'}
    product = build(archive, args.nlcd, args.catalog, args.out, nlcd_source)
    print(json.dumps(product['summary'], indent=2))
    print('exclusions:', [e['tile'] for e in product['exclusions']])
    print('inclusions:', [i['tile'] for i in product['inclusions']])


if __name__ == '__main__':
    main()
