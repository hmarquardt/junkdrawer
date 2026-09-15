"""Deterministic checks for the bulk adapters and the published Colorado tiles.

No external network access: source identifiers, unit conversions, local cache
contracts and the committed publication artifacts are verified directly. One
test spins up a loopback HTTP server to exercise the resumable/checksum-gated
download path.
    uv run --with duckdb --with rasterio tests/test_fruiting_bulk_adapters.py
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import tempfile
import threading
import unittest
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial

import duckdb

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bulk', ROOT / 'tools/fruiting_bulk_adapters.py')
bulk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bulk)

DATA = ROOT / 'data/fruiting-forecast'
TILE = 'n40_w106'
TILE_2 = 'n39_w106'
# The bounded Southern Rockies release: the 3x3 southern bbox plus the two
# verified Front Range / Never Summer tiles above it.
RELEASE_TILES = ('n37_w106', 'n37_w107', 'n37_w108', 'n38_w106', 'n38_w107', 'n38_w108',
                 'n39_w106', 'n39_w107', 'n39_w108', 'n40_w106', 'n40_w107')


class AdapterContracts(unittest.TestCase):
    def test_forest_group_legend_is_authoritative_and_never_fabricates(self):
        spruce = bulk.forest_group_record(120)
        self.assertEqual(spruce['forest_group'], 'spruce_fir')
        self.assertEqual(spruce['spruce_fir_signal'], 1.0)
        self.assertEqual(spruce['lodgepole_pine_signal'], 0.0)
        self.assertEqual(spruce['forest'], 1.0)
        mixed = bulk.forest_group_record(260)
        self.assertEqual(mixed['fir_spruce_mountain_hemlock_signal'], 1.0)
        self.assertEqual(mixed['spruce_fir_signal'], 0.0)
        self.assertEqual(bulk.forest_group_record(280)['lodgepole_pine_signal'], 1.0)
        # 0 means "no forest type group mapped here", which is a real reading, not null.
        unmapped = bulk.forest_group_record(0)
        self.assertEqual(unmapped['forest'], 0.0)
        self.assertEqual(unmapped['forest_mapped'], 0.0)
        self.assertIsNone(unmapped['forest_group'])
        # Unknown codes and missing samples must stay missing rather than become zero.
        unknown = bulk.forest_group_record(777)
        self.assertIsNone(unknown['forest'])
        self.assertIsNone(unknown['spruce_fir_signal'])
        missing = bulk.forest_group_record(None)
        self.assertIsNone(missing['forest'])
        self.assertIsNone(missing['forest_type_code'])
        self.assertIsNone(missing['lodgepole_pine_signal'])

    def test_eastern_classes_are_not_overloaded_with_western_meaning(self):
        oak = bulk.forest_group_record(500)
        self.assertEqual(oak['oak_hickory_signal'], 1.0)
        self.assertEqual(oak['spruce_fir_signal'], 0.0)
        self.assertEqual(oak['fir_spruce_mountain_hemlock_signal'], 0.0)

    def test_land_cover_legend_and_derivation_are_explicit(self):
        legend = bulk.NLCD_LANDCOVER['legend']
        self.assertEqual(len(legend), 16)
        self.assertEqual(legend[41], 'deciduous_forest')
        self.assertEqual(legend[42], 'evergreen_forest')
        self.assertEqual(legend[43], 'mixed_forest')
        self.assertEqual(legend[90], 'woody_wetlands')
        deciduous = bulk.land_cover_record(41)
        self.assertEqual(deciduous['land_class'], 'deciduous_forest')
        self.assertEqual(deciduous['forest'], 1.0)
        self.assertEqual(deciduous['deciduous'], 1.0)
        self.assertEqual(deciduous['evergreen'], 0.0)
        self.assertEqual(deciduous['mixed_forest'], 0.0)
        self.assertEqual(deciduous['open_land'], 0.0)
        evergreen = bulk.land_cover_record(42)
        self.assertEqual(evergreen['forest'], 1.0)
        self.assertEqual(evergreen['evergreen'], 1.0)
        self.assertEqual(evergreen['deciduous'], 0.0)
        wetland = bulk.land_cover_record(95)
        self.assertEqual(wetland['wetland'], 1.0)
        self.assertEqual(wetland['forest'], 0.0)
        open_class = bulk.land_cover_record(71)
        self.assertEqual(open_class['open_land'], 1.0)
        # Unknown/absent classes stay missing; they are never coerced into a class.
        for code in (0, 51, 999, None):
            record = bulk.land_cover_record(code)
            self.assertIsNone(record['land_class'], code)
            self.assertIsNone(record['forest'], code)
            self.assertIsNone(record['evergreen'], code)

    def test_canopy_percent_conversion_and_nodata(self):
        self.assertEqual(bulk.canopy_fraction(0), 0.0)
        self.assertEqual(bulk.canopy_fraction(63), 0.63)
        self.assertEqual(bulk.canopy_fraction(100), 1.0)
        # TCC 254 is non-processing area and 255 the background; both stay missing.
        for value in (254, 255, -1, 101, None):
            self.assertIsNone(bulk.canopy_fraction(value), value)

    def test_component_completeness_contract(self):
        components = bulk.habitat_components(True, True, True, False, False)
        self.assertEqual(components['canopy'], 'UNBUILT')
        self.assertEqual(components['soil'], 'UNBUILT')
        self.assertEqual(bulk.HABITAT_REQUIRED_COMPONENTS, ('forestType', 'elevation', 'canopy', 'landCover'))
        self.assertNotIn('soil', bulk.HABITAT_REQUIRED_COMPONENTS)

    def test_dem_tile_naming_and_units_are_explicit(self):
        # USGS 1-degree tiles are named by the NORTH edge; Fruiting Forecast uses the south edge.
        self.assertEqual(bulk.usgs_dem_tile_id('n40_w106'), 'n41w106')
        self.assertIn('USGS_1_n41w106', bulk.dem_tile_url('n40_w106'))
        self.assertEqual(bulk.meters_to_feet(4341), 14242.13)
        self.assertIsNone(bulk.meters_to_feet(None))

    def test_second_tile_dem_resolves_independently(self):
        self.assertEqual(bulk.usgs_dem_tile_id('n39_w106'), 'n40w106')
        self.assertEqual(bulk.tile_bbox('n39_w106'), [-106, 39, -105, 40])
        self.assertTrue(str(bulk.dem_path(Path('/tmp/cache'), 'n39_w106')).endswith('dem_n40w106.tif'))

    def test_sample_grid_matches_the_repository_tile_contract(self):
        points = bulk.sample_points(TILE)
        self.assertEqual(len(points), 400)
        lats = sorted({lat for lat, _ in points})
        self.assertEqual(len(lats), 20)
        self.assertAlmostEqual(lats[0], 40.025, places=5)
        self.assertAlmostEqual(lats[-1], 40.975, places=5)
        self.assertEqual(bulk.tile_bbox(TILE), [-106, 40, -105, 41])

    def test_esri_envelope_and_local_clip(self):
        self.assertEqual(json.loads(bulk.esri_envelope([-106, 40, -105, 41])),
                         {'xmin': -106, 'ymin': 40, 'xmax': -105, 'ymax': 41})
        inside = {'geometry': {'type': 'Polygon', 'coordinates': [[[-105.5, 40.5], [-105.4, 40.5], [-105.4, 40.6], [-105.5, 40.5]]]}}
        outside = {'geometry': {'type': 'Polygon', 'coordinates': [[[-99, 38], [-98, 38], [-98, 39], [-99, 38]]]}}
        straddling = {'geometry': {'type': 'Polygon', 'coordinates': [[[-106.5, 40.5], [-105.5, 40.5], [-105.5, 40.6], [-106.5, 40.5]]]}}
        kept = bulk.clip_to_tile([inside, outside, straddling], TILE)
        self.assertEqual(len(kept), 2)


class SourceCache(unittest.TestCase):
    """The cache must prepare a source once and never treat a broken file as ready."""

    def _fixture_source(self, archive: Path) -> dict:
        return {"id": "fixture_land_cover", "scope": "national", "url": "https://example.gov/fixture.zip",
                "archiveName": archive.name, "member": "fixture.bin", "sha256": bulk._sha256(archive),
                "datasetVersion": "fixture-v1", "productPage": "https://example.gov/product"}

    def test_prepare_national_validates_completion_and_rejects_corruption(self):
        with tempfile.TemporaryDirectory() as temp:
            cache = Path(temp)
            archive = cache / 'fixture.zip'
            with zipfile.ZipFile(archive, 'w') as bundle:
                bundle.writestr('fixture.bin', b'fixture payload')
            source = self._fixture_source(archive)
            original = bulk.NLCD_LANDCOVER
            bulk.NLCD_LANDCOVER = source
            try:
                entry = bulk.prepare_national(cache, ['land-cover'])['land-cover']
                self.assertEqual(entry['status'], 'READY')
                self.assertTrue(entry['sha256Matches'])
                self.assertEqual(entry['memberBytes'], len(b'fixture payload'))
                self.assertEqual(bulk._prepared_member(cache, source), cache / 'extracted' / source['sha256'][:12] / 'fixture.bin')
                # A corrupted archive is FAILED and is never extracted or reused.
                archive.write_bytes(archive.read_bytes() + b'corruption')
                entry = bulk.prepare_national(cache, ['land-cover'])['land-cover']
                self.assertEqual(entry['status'], 'FAILED')
                self.assertFalse(entry['sha256Matches'])
                self.assertIsNone(bulk._prepared_member(cache, source))
            finally:
                bulk.NLCD_LANDCOVER = original

    def test_a_partial_download_is_never_ready(self):
        with tempfile.TemporaryDirectory() as temp:
            cache = Path(temp)
            archive = cache / 'fixture.zip'
            with zipfile.ZipFile(archive, 'w') as bundle:
                bundle.writestr('fixture.bin', b'payload')
            source = self._fixture_source(archive)
            archive.rename(cache / 'fixture.zip.part')
            self.assertIsNone(bulk._prepared_member(cache, source))
            self.assertEqual(bulk.load_cache_manifest(cache)['sources'], {})

    def test_download_is_checksum_gated_and_no_part_file_survives_success(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            served = root / 'served'
            served.mkdir()
            payload = b'authoritative bytes' * 1000
            (served / 'fixture.bin').write_bytes(payload)
            digest = hashlib.sha256(payload).hexdigest()
            handler = partial(SimpleHTTPRequestHandler, directory=str(served))
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                url = f'http://127.0.0.1:{server.server_address[1]}/fixture.bin'
                destination = root / 'downloaded.bin'
                with self.assertRaises(SystemExit):
                    bulk._download(url, destination, expected_sha256='0' * 64)
                self.assertFalse(destination.exists())
                self.assertTrue(destination.with_suffix('.bin.part.mismatch').exists())
                self.assertEqual(bulk._download(url, destination, expected_sha256=digest), digest)
                self.assertEqual(destination.read_bytes(), payload)
                self.assertFalse(destination.with_suffix('.bin.part').exists())
            finally:
                server.shutdown()
                server.server_close()


class SoilAdapter(unittest.TestCase):
    """Soil has one normalized contract for the SDA and package sources alike."""

    ATTRIBUTE_HEADER = ["mukey", "musym", "areasymbol", "drclassdcd", "aws025wta", "aws050wta",
                        "flodfreqdcd", "hydgrpdcd", "slopegraddcp"]

    def _package(self, root: Path) -> Path:
        import rasterio
        from rasterio.transform import from_origin

        data = [[1, 2, 255, 255], [3, 4, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255]]
        import numpy
        with rasterio.open(root / 'mukey.tif', 'w', driver='GTiff', width=4, height=4, count=1,
                           dtype='uint16', crs='EPSG:4326', nodata=255,
                           transform=from_origin(-106.2, 39.6, 0.05, 0.05)) as sink:
            sink.write(numpy.array(data, dtype='uint16'), 1)
        (root / 'muaggatt.csv').write_text(
            'mukey,drclassdcd,aws025wta,aws050wta,flodfreqdcd,hydgrpdcd,slopegraddcp\n'
            '1,Well drained,9.5,18.2,None,B,5\n'
            '2,Somewhat poorly drained,4.1,8.0,Frequent,C,2\n'
            '3,Well drained,,12.0,None,A,9\n'
            '4,Excessively drained,6.2,11.5,None,A,15\n')
        archive = root / 'gSSURGO_CO.zip'
        with zipfile.ZipFile(archive, 'w') as bundle:
            bundle.write(root / 'mukey.tif', 'mukey.tif')
            bundle.write(root / 'muaggatt.csv', 'muaggatt.csv')
        return archive

    def _fake_sda(self, attribute_rows=None):
        """Deterministic stand-in for Soil Data Access (no network in tests)."""
        header = self.ATTRIBUTE_HEADER
        rows = attribute_rows or [
            [100, '1', 'CO001', 'Well drained', '9.5', '18.2', 'None', 'B', '5'],
            [200, '2', 'CO001', 'Poorly drained', '4.1', '8.0', 'Frequent', 'C', '2'],
            [50, '3', 'CO001', 'Excessively drained', '6.2', '11.5', 'None', 'A', '15'],
            [300, '4', 'CO001', 'Well drained', None, '12.0', 'None', 'A', '9'],
        ]

        def fake_query(query: str, timeout: int = 300):
            if 'CROSS APPLY' in query:
                ids = re.findall(r"\('([\d.\-_]+)','point", query)
                table = [["point_id", "mukey"]]
                for index, point_id in enumerate(ids):
                    if index == len(ids) - 1:
                        continue  # last point deliberately unresolved
                    table.append([point_id, "100" if index < len(ids) // 2 else "200"])
                table.append([ids[0], "50"])  # boundary ambiguity: smallest mukey must win
                return table
            return [header] + rows

        return fake_query

    def test_sda_state_prepare_and_batched_point_join(self):
        with tempfile.TemporaryDirectory() as temp:
            cache = Path(temp)
            original = bulk._sda_query
            bulk._sda_query = self._fake_sda()
            try:
                entry = bulk.prepare_state(cache, 'co', source='sda')
                self.assertEqual(entry['status'], 'READY')
                self.assertEqual(entry['rows'], 4)
                self.assertTrue((cache / entry['attributesPath']).exists())
                points = bulk.sample_points('n39_w106')
                prepared = bulk.soil_inputs(cache, ['CO'], tile_id='n39_w106')
                self.assertEqual(len(prepared), 1)
                self.assertEqual(prepared[0]['kind'], 'sda')
                # The batched point query is cached for reuse; the smallest MUKEY wins boundaries.
                cache_file = json.loads((cache / 'soil' / 'n39_w106-points.json').read_text())
                self.assertEqual(cache_file['resolved'], len(points) - 1)
                self.assertEqual(cache_file['ambiguous'][f'{points[0][0]:.3f}_{points[0][1]:.3f}'], [50, 100])
                columns = bulk.merge_soil_samples(prepared, points)
                self.assertEqual(columns['drainage_class'][0], 'Excessively drained')  # mukey 50
                self.assertEqual(columns['awc_25_cm'][0], 6.2)
                self.assertEqual(columns['drainage_class'][len(points) // 2], 'Poorly drained')  # mukey 200
                # The unresolved final point stays missing, never neutral.
                self.assertIsNone(columns['drainage_class'][-1])
                self.assertIsNone(columns['awc_25_cm'][-1])
            finally:
                bulk._sda_query = original

    def test_sda_failure_is_explicit_and_not_ready(self):
        with tempfile.TemporaryDirectory() as temp:
            cache = Path(temp)
            original = bulk._sda_query
            bulk._sda_query = lambda query, timeout=300: (_ for _ in ()).throw(RuntimeError('SDA offline'))
            try:
                entry = bulk.prepare_state(cache, 'CO', source='sda')
                self.assertEqual(entry['status'], 'FAILED')
                self.assertIn('SDA offline', entry['error'])
                self.assertEqual(bulk.soil_inputs(cache, ['CO']), [])
            finally:
                bulk._sda_query = original

    def test_sda_empty_state_is_not_ready(self):
        with tempfile.TemporaryDirectory() as temp:
            cache = Path(temp)
            original = bulk._sda_query
            bulk._sda_query = lambda query, timeout=300: [self.ATTRIBUTE_HEADER]
            try:
                entry = bulk.prepare_state(cache, 'CO', source='sda')
                self.assertEqual(entry['status'], 'EMPTY')
                self.assertEqual(bulk.soil_inputs(cache, ['CO']), [])
            finally:
                bulk._sda_query = original

    def test_package_discovery_and_point_join_use_the_same_contract(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = self._package(root)
            cache = root / 'cache'
            cache.mkdir()
            shutil.copyfile(archive, cache / archive.name)
            entry = bulk.prepare_state(cache, 'CO', source='gssurgo')
            self.assertEqual(entry['status'], 'READY')
            self.assertEqual(entry['source'], 'gssurgo')
            prepared = bulk.soil_inputs(cache, ['CO'])
            self.assertEqual(len(prepared), 1)
            self.assertEqual(prepared[0]['kind'], 'package')
            points = [(39.575, -106.175), (39.575, -106.125), (39.525, -106.175),
                      (39.525, -106.125), (39.45, -106.150)]
            columns = bulk.merge_soil_samples(prepared, points)
            self.assertEqual(columns['drainage_class'][:4],
                             ['Well drained', 'Somewhat poorly drained', 'Well drained', 'Excessively drained'])
            self.assertEqual(columns['awc_50_cm'][0], 18.2)
            # A missing attribute on a present map unit stays missing, never a neutral value.
            self.assertIsNone(columns['awc_25_cm'][2])
            self.assertEqual(columns['drainage_class'][2], 'Well drained')
            # A point outside the survey raster stays missing.
            self.assertIsNone(columns['drainage_class'][4])
            self.assertIsNone(columns['awc_25_cm'][4])

    def test_gnatsgo_geopackage_package_uses_the_same_contract(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._package(root)  # provides the mukey raster fixture
            connection = sqlite3.connect(root / 'soil.gpkg')
            connection.execute('CREATE TABLE muaggatt (mukey INTEGER, drclassdcd TEXT, aws025wta REAL, '
                               'aws050wta REAL, flodfreqdcd TEXT, hydgrpdcd TEXT, slopegraddcp REAL)')
            connection.executemany('INSERT INTO muaggatt VALUES (?,?,?,?,?,?,?)', [
                (1, 'Well drained', 9.5, 18.2, 'None', 'B', 5),
                (2, 'Poorly drained', 4.1, 8.0, 'Frequent', 'C', 2),
                (3, 'Well drained', None, 12.0, 'None', 'A', 9),
                (4, 'Excessively drained', 6.2, 11.5, 'None', 'A', 15)])
            connection.commit()
            connection.close()
            cache = root / 'cache'
            cache.mkdir()
            with zipfile.ZipFile(cache / 'gNATSGO_CO.zip', 'w') as bundle:
                bundle.write(root / 'mukey.tif', 'mukey.tif')
                bundle.write(root / 'soil.gpkg', 'soil.gpkg')
            entry = bulk.prepare_state(cache, 'CO', source='gnatsgo')
            self.assertEqual(entry['status'], 'READY')
            self.assertEqual(entry['source'], 'gnatsgo')
            prepared = bulk.soil_inputs(cache, ['CO'])
            self.assertEqual(len(prepared), 1)
            self.assertEqual(prepared[0]['source']['id'], 'gnatsgo')
            points = [(39.575, -106.175), (39.575, -106.125), (39.525, -106.175), (39.525, -106.125)]
            columns = bulk.merge_soil_samples(prepared, points)
            self.assertEqual(columns['drainage_class'][0], 'Well drained')
            self.assertEqual(columns['awc_50_cm'][0], 18.2)
            self.assertEqual(columns['hydrologic_group'][1], 'C')
            self.assertIsNone(columns['awc_25_cm'][2])
            self.assertEqual(columns['hydrologic_group'][2], 'A')
            self.assertEqual(columns['drainage_class'][3], 'Excessively drained')

    def test_missing_state_package_is_failed_not_invented(self):
        with tempfile.TemporaryDirectory() as temp:
            cache = Path(temp)
            entry = bulk.prepare_state(cache, 'CO', source='gssurgo')
            self.assertEqual(entry['status'], 'FAILED')
            self.assertIn('No soil archive', entry['error'])
            self.assertEqual(bulk.soil_inputs(cache, ['CO']), [])

    def test_raster_free_archive_without_mapunit_data_is_not_ready(self):
        with tempfile.TemporaryDirectory() as temp:
            cache = Path(temp)
            with zipfile.ZipFile(cache / 'gSSURGO_CO.zip', 'w') as bundle:
                bundle.writestr('README.txt', 'no soil here')
            entry = bulk.prepare_state(cache, 'CO', source='gssurgo')
            self.assertEqual(entry['status'], 'FAILED')

    def test_both_sources_normalize_to_the_same_columns(self):
        sda = bulk.normalize_soil_attribute({'drclassdcd': 'Well drained', 'aws025wta': '9.5',
                                             'aws050wta': '18.2', 'flodfreqdcd': 'None',
                                             'hydgrpdcd': 'B', 'slopegraddcp': '5'})
        package = bulk.normalize_soil_attribute({'drclassdcd': 'Well drained', 'aws025wta': '9.5',
                                                 'aws050wta': '18.2', 'flodfreqdcd': 'None',
                                                 'hydgrpdcd': 'B', 'slopegraddcp': '5'})
        self.assertEqual(sda, package)
        self.assertEqual(set(sda), set(bulk.SOIL_COLUMNS))


class HabitatComposition(unittest.TestCase):
    """Composition without optional sources must stay PARTIAL with NULL fields."""

    def test_unprepared_canopy_and_land_cover_stay_missing_not_zero(self):
        import numpy
        import rasterio
        from rasterio.transform import from_origin

        with tempfile.TemporaryDirectory() as temp:
            cache = Path(temp) / 'cache'
            cache.mkdir()
            out = Path(temp) / 'out'
            forest_tif = Path(temp) / 'fixture_forest.img'
            codes = [[260, 0, 260, 0], [0, 260, 0, 260], [260, 260, 0, 0], [0, 0, 260, 260]]
            with rasterio.open(forest_tif, 'w', driver='GTiff', width=4, height=4, count=1, dtype='int16',
                               crs='EPSG:4326', nodata=255,
                               transform=from_origin(-106.0, 40.0, 0.25, 0.25)) as sink:
                sink.write(numpy.array(codes, dtype='int16'), 1)
            archive = cache / 'conus_forestgroup.zip'
            with zipfile.ZipFile(archive, 'w') as bundle:
                bundle.write(forest_tif, 'fixture_forest.img')
            fixture = {'id': 'forest_type_groups', 'scope': 'national', 'url': 'https://example.gov/forest.zip',
                       'archiveName': 'conus_forestgroup.zip', 'member': 'fixture_forest.img',
                       'sha256': bulk._sha256(archive), 'datasetVersion': 'fixture-forest-v1',
                       'provider': 'fixture', 'dataset': 'fixture', 'crs': 'EPSG:4326', 'resolutionM': 250,
                       'citation': 'fixture', 'caveat': 'fixture'}
            dem = cache / 'dem_n40w106.tif'
            with rasterio.open(dem, 'w', driver='GTiff', width=4, height=4, count=1, dtype='float32',
                               crs='EPSG:4326', nodata=-999999.0,
                               transform=from_origin(-106.0, 40.0, 0.25, 0.25)) as sink:
                sink.write(numpy.full((4, 4), 3000.0, dtype='float32'), 1)
            original = bulk.FOREST_GROUP
            bulk.FOREST_GROUP = fixture
            try:
                entry = bulk.prepare_national(cache, ['forest-type'])['forest-type']
                self.assertEqual(entry['status'], 'READY')
                result = bulk.build_habitat('n39_w106', cache, out)
            finally:
                bulk.FOREST_GROUP = original
            self.assertEqual(result['status'], 'PARTIAL')
            self.assertEqual(result['components']['canopy'], 'UNBUILT')
            self.assertEqual(result['components']['landCover'], 'UNBUILT')
            self.assertEqual(result['components']['forestType'], 'AVAILABLE')
            self.assertIn('canopy', result['unbuilt'])
            self.assertIn('nlcdLandCover', result['unbuilt'])
            con = duckdb.connect()
            table = con.execute('SELECT * FROM read_parquet(?)', [str(out / 'habitat' / 'n39_w106.parquet')])
            columns = [description[0] for description in table.description]
            rows = [dict(zip(columns, row)) for row in table.fetchall()]
            con.close()
            self.assertEqual(len(rows), 400)
            self.assertTrue(all(row['canopy'] is None for row in rows))
            self.assertTrue(all(row['deciduous'] is None for row in rows))
            self.assertTrue(all(row['evergreen'] is None for row in rows))
            self.assertTrue(all(row['elevation_ft'] is not None for row in rows))
            # The forest-type fallback keeps the legacy land_class vocabulary for a
            # forest-only tile instead of inventing a land-cover class.
            classes = {row['land_class'] for row in rows}
            self.assertTrue(classes <= {'fir_spruce_mountain_hemlock', 'not_forest_mapped', None}, classes)


class PublishedColoradoTiles(unittest.TestCase):
    """The committed artifacts must match what the adapters promise."""

    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((DATA / 'manifest.json').read_text())
        cls.tiles = {tile['id']: tile for tile in cls.manifest['tiles']}
        cls.con = duckdb.connect()

    def rows_of(self, asset):
        table = self.con.execute('SELECT * FROM read_parquet(?)', [str(DATA / asset['url'])])
        columns = [description[0] for description in table.description]
        return columns, [dict(zip(columns, row)) for row in table.fetchall()]

    def test_both_tiles_declare_required_components_and_no_fabricated_completeness(self):
        for tile_id in (TILE, TILE_2):
            habitat = self.tiles[tile_id]['habitat']
            self.assertEqual(habitat['status'], 'AVAILABLE', tile_id)
            self.assertEqual(habitat['cells'], 400)
            self.assertEqual(habitat['components'],
                             {'forestType': 'AVAILABLE', 'elevation': 'AVAILABLE', 'landCover': 'AVAILABLE',
                              'canopy': 'AVAILABLE', 'soil': 'AVAILABLE'})
            self.assertEqual(habitat['unbuilt'], ['access'])
            self.assertEqual(habitat['units']['elevation_ft'], 'feet')
            self.assertIn('fraction', habitat['units']['canopy'])
            source_ids = {source['id'] for source in habitat['sources']}
            self.assertEqual(source_ids, {'forest_type_groups', '3dep_1arcsecond',
                                          'nlcd_land_cover', 'nlcd_tree_canopy', 'ssurgo_sda'})
            soil = next(source for source in habitat['sources'] if source['id'] == 'ssurgo_sda')
            self.assertIn('Soil Data Access', soil['dataset'])
            self.assertEqual(soil['units']['awc_25_cm'], 'centimeters')
            self.assertTrue(soil['attributes'])

    def test_habitat_carries_real_canopy_land_cover_and_west_host_evidence(self):
        for tile_id in (TILE, TILE_2):
            habitat = self.tiles[tile_id]['habitat']
            columns, records = self.rows_of(habitat)
            for column in ('canopy', 'land_class', 'forest', 'deciduous', 'open_land',
                           'evergreen', 'mixed_forest', 'wetland', 'spruce_fir_signal',
                           'fir_spruce_mountain_hemlock_signal', 'lodgepole_pine_signal',
                           'ponderosa_pine_signal', 'douglas_fir_signal', 'aspen_birch_signal',
                           'forest_mapped', 'elevation_ft', 'forest_type_code',
                           'drainage_class', 'awc_25_cm', 'awc_50_cm', 'flood_frequency',
                           'hydrologic_group', 'slope_deg'):
                self.assertIn(column, columns, (tile_id, column))
            canopies = [record['canopy'] for record in records]
            self.assertEqual(len(canopies), 400)
            self.assertTrue(all(value is not None and 0 <= value <= 1 for value in canopies), tile_id)
            classes = {record['land_class'] for record in records}
            self.assertTrue(classes <= set(bulk.NLCD_LANDCOVER['legend'].values()), (tile_id, classes))
            self.assertIn('evergreen_forest', classes, tile_id)
            # Land cover and forest type are separate signals: both mapped, neither replaces the other.
            self.assertTrue(any(record['forest'] == 1.0 for record in records))
            self.assertTrue(any(record['forest_mapped'] == 1.0 for record in records))
            elevations = [record['elevation_ft'] for record in records if record['elevation_ft'] is not None]
            self.assertEqual(len(elevations), 400)
            self.assertGreater(min(elevations), 3000)
            self.assertLess(max(elevations), 15000)
            # Example western host class must be real for at least one of the two tiles.
            self.assertTrue(any((record['fir_spruce_mountain_hemlock_signal'] or 0) > 0
                                or (record['spruce_fir_signal'] or 0) > 0 for record in records), tile_id)

    def test_second_tile_is_biologically_distinguishable_from_the_first(self):
        columns_a, records_a = self.rows_of(self.tiles[TILE]['habitat'])
        columns_b, records_b = self.rows_of(self.tiles[TILE_2]['habitat'])
        self.assertEqual(columns_a, columns_b)
        elevations_a = [record['elevation_ft'] for record in records_a]
        elevations_b = [record['elevation_ft'] for record in records_b]
        self.assertNotEqual(min(elevations_a), min(elevations_b))
        canopy_a = sorted(record['canopy'] for record in records_a)
        canopy_b = sorted(record['canopy'] for record in records_b)
        self.assertNotEqual(canopy_a, canopy_b)
        classes_a = sorted({record['land_class'] for record in records_a})
        classes_b = sorted({record['land_class'] for record in records_b})
        self.assertNotEqual(classes_a, classes_b)
        host_totals = lambda records: {name: sum(record[name] or 0 for record in records)
                                       for name in ('ponderosa_pine_signal', 'lodgepole_pine_signal',
                                                    'douglas_fir_signal', 'aspen_birch_signal')}
        self.assertNotEqual(host_totals(records_a), host_totals(records_b))
        self.assertGreater(host_totals(records_b)['ponderosa_pine_signal'], 0)

    def test_second_tile_public_land_and_fire_are_tile_local_and_state_scoped(self):
        public = self.tiles[TILE_2]['publicLands']
        self.assertEqual(public['status'], 'AVAILABLE')
        columns, records = self.rows_of(public)
        self.assertEqual(len(records), public['properties'])
        self.assertIn('state_code', columns)
        for record in records:
            self.assertTrue(record['state_code'], 'every published property needs an authoritative state')
            self.assertGreaterEqual(record['min_lon'], -106.01)
            self.assertLessEqual(record['max_lon'], -104.99)
            self.assertGreaterEqual(record['min_lat'], 38.99)
            self.assertLessEqual(record['max_lat'], 40.01)
        self.assertTrue(any(record['state_code'] == 'CO' for record in records))
        fire = self.tiles[TILE_2]['fireHistory']
        self.assertEqual(fire['status'], 'AVAILABLE')
        fire_columns, perimeters = self.rows_of(fire)
        self.assertEqual(len(perimeters), fire['perimeters'])
        self.assertGreater(len(perimeters), 0)
        for record in perimeters:
            self.assertIsInstance(record['fire_year'], int)
            self.assertIsNone(record['severity'])
            self.assertLessEqual(record['min_lon'], -105)
            self.assertGreaterEqual(record['max_lon'], -106)
            self.assertLessEqual(record['min_lat'], 40)
            self.assertGreaterEqual(record['max_lat'], 39)

    def test_fire_layer_holds_real_mtbs_perimeters(self):
        fire = self.tiles[TILE]['fireHistory']
        self.assertEqual(fire['status'], 'AVAILABLE')
        self.assertGreater(fire['perimeters'], 0)
        columns, records = self.rows_of(fire)
        self.assertEqual(len(records), fire['perimeters'])
        for record in records:
            self.assertIsInstance(record['fire_year'], int)
            self.assertGreaterEqual(record['fire_year'], 1984)
            self.assertLessEqual(record['fire_year'], 2100)
            self.assertTrue(record['perimeter_id'])
            self.assertTrue(record['geometry_json'])
            # MTBS publishes no per-perimeter severity class, so severity must stay missing.
            self.assertIsNone(record['severity'])
            self.assertIn('MTBS', record['source_id'])

    def test_manifest_declares_four_layers_and_component_completeness(self):
        summary = self.manifest['summary']['layers']
        tile_count = self.manifest['summary']['tileCount']
        self.assertEqual(set(summary), {'habitat', 'public-land', 'access', 'fire'})
        self.assertEqual(tile_count, len(self.manifest['tiles']))
        for layer, stat in summary.items():
            self.assertEqual(sum(stat[key] for key in ('populated', 'verifiedEmpty', 'unbuilt', 'failed')), tile_count, layer)
            self.assertEqual(stat['verifiedEmpty'], 0, layer)
        self.assertGreaterEqual(summary['habitat']['available'], len(RELEASE_TILES))
        self.assertEqual(summary['habitat']['components']['canopy']['AVAILABLE'], len(RELEASE_TILES))
        self.assertEqual(summary['habitat']['components']['landCover']['AVAILABLE'], len(RELEASE_TILES))
        self.assertEqual(summary['habitat']['components']['soil']['AVAILABLE'], len(RELEASE_TILES))
        self.assertEqual(summary['habitat']['components']['soil']['UNBUILT'], 0)
        self.assertGreaterEqual(summary['fire']['populated'], len(RELEASE_TILES))
        for tile in self.manifest['tiles']:
            asset = tile.get('habitat') or {}
            if asset.get('status') in {'AVAILABLE', 'PARTIAL'}:
                self.assertTrue(asset.get('url'))
                self.assertTrue(asset.get('sha256'))
                self.assertGreater(asset.get('cells') or 0, 0)

    def test_legacy_indiana_tiles_remain_readable_without_the_new_columns(self):
        legacy = self.tiles['n37_w088']['habitat']
        columns, records = self.rows_of(legacy)
        for column in ('land_class', 'forest', 'canopy', 'elevation_ft', 'oak_hickory_signal'):
            self.assertIn(column, columns)
        for column in ('evergreen', 'mixed_forest', 'wetland'):
            self.assertNotIn(column, columns)
        self.assertGreater(len(records), 0)
        # A union that prefers names keeps both schemas readable; missing western fields are NULL.
        union = self.con.execute(
            'SELECT count(*) n, sum(evergreen) evergreen FROM read_parquet([?, ?], union_by_name=true)',
            [str(DATA / legacy['url']), str(DATA / self.tiles[TILE]['habitat']['url'])]).fetchone()
        self.assertEqual(union[0], len(records) + 400)
        self.assertGreater(union[1], 0)

    def test_collecting_rules_are_state_scoped(self):
        rules = json.loads((DATA / 'public-land-rules.json').read_text())
        self.assertEqual(rules['schemaVersion'], 2)
        self.assertTrue(rules['rules'])
        for rule in rules['rules']:
            self.assertIn('jurisdiction', rule, 'a rule without jurisdiction could leak across state lines')
            self.assertEqual(rule['jurisdiction']['state'], 'IN')
            self.assertTrue(rule['jurisdiction']['basis'])
        descriptor = self.manifest['collectingRules']
        self.assertEqual(descriptor['schemaVersion'], 2)
        self.assertEqual(descriptor['datasetVersion'], rules['datasetVersion'])


class BoundedSouthernRockiesRelease(unittest.TestCase):
    """The 11-tile release must be complete, differentiated and honestly gapped."""

    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((DATA / 'manifest.json').read_text())
        cls.tiles = {tile['id']: tile for tile in cls.manifest['tiles']}
        cls.con = duckdb.connect()

    def habitat_path(self, tile_id):
        return str(DATA / self.tiles[tile_id]['habitat']['url'])

    def test_every_release_tile_has_all_five_components_and_all_four_layers(self):
        for tile_id in RELEASE_TILES:
            tile = self.tiles[tile_id]
            habitat = tile['habitat']
            self.assertEqual(habitat['status'], 'AVAILABLE', tile_id)
            self.assertEqual(habitat['cells'], 400, tile_id)
            self.assertEqual(habitat['components'], {'forestType': 'AVAILABLE', 'elevation': 'AVAILABLE',
                                                     'landCover': 'AVAILABLE', 'canopy': 'AVAILABLE',
                                                     'soil': 'AVAILABLE'}, tile_id)
            self.assertEqual(tile['publicLands']['status'], 'AVAILABLE', tile_id)
            self.assertGreater(tile['publicLands']['properties'], 0, tile_id)
            self.assertEqual(tile['fireHistory']['status'], 'AVAILABLE', tile_id)
            self.assertGreater(tile['fireHistory']['perimeters'], 0, tile_id)
            self.assertEqual(tile['accessPoints']['status'], 'UNBUILT', tile_id)

    def test_real_ssurgo_soil_evidence_is_present_with_explicit_gaps(self):
        known_drainage = ('well drained', 'moderately well drained', 'somewhat excessively drained',
                          'excessively drained', 'somewhat poorly drained', 'poorly drained',
                          'very poorly drained')
        for tile_id in RELEASE_TILES:
            row = self.con.execute(f"""
                SELECT count(*), count(drainage_class), count(awc_25_cm), count(awc_50_cm),
                       count(hydrologic_group), min(awc_25_cm), max(awc_25_cm), min(slope_deg), max(slope_deg)
                FROM read_parquet('{self.habitat_path(tile_id)}')""").fetchone()
            cells, drainage, awc25, awc50, groups, min_awc, max_awc, min_slope, max_slope = row
            self.assertEqual(cells, 400, tile_id)
            self.assertGreaterEqual(drainage, 300, f'{tile_id} has implausibly sparse soil coverage')
            self.assertEqual(awc25, awc50, tile_id)
            self.assertGreaterEqual(groups, 300, tile_id)
            self.assertGreaterEqual(min_awc, 0.0, tile_id)
            self.assertLessEqual(max_awc, 25.0, tile_id)
            self.assertGreaterEqual(min_slope, 0.0, tile_id)
            self.assertLessEqual(max_slope, 200.0, tile_id)
            classes = {value.lower() for (value,) in self.con.execute(
                f"SELECT DISTINCT drainage_class FROM read_parquet('{self.habitat_path(tile_id)}') "
                "WHERE drainage_class IS NOT NULL").fetchall()}
            self.assertTrue(classes <= set(known_drainage), (tile_id, classes))
            # Missing evidence stays missing instead of becoming a neutral value.
            self.assertGreater(400 - drainage, 0, f'{tile_id} unexpectedly has no missing soil cells')

    def test_soil_evidence_differs_across_the_region(self):
        classes = self.con.execute("""
            SELECT drainage_class, count(*) FROM read_parquet(?)
            WHERE drainage_class IS NOT NULL GROUP BY 1 ORDER BY 2 DESC""",
            [[self.habitat_path(tile_id) for tile_id in RELEASE_TILES]]).fetchall()
        self.assertGreaterEqual(len(classes), 5)
        self.assertEqual(classes[0][0], 'Well drained')
        # Wet valley soils exist somewhere in the release; the region is not one uniform class.
        self.assertTrue(any(name and 'poorly drained' in name.lower() for name, _ in classes))

    def test_release_manifest_declares_the_bounded_extent_not_conus(self):
        coverage = self.manifest['summary']['coverage']
        self.assertIn('Southern Rockies', coverage)
        self.assertNotIn('955', coverage)
        self.assertEqual(sorted(self.manifest['summary'].get('coverageTiles', [])), sorted(RELEASE_TILES))


if __name__ == '__main__':
    unittest.main()