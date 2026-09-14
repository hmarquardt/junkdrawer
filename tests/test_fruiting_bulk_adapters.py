"""Deterministic checks for the bulk adapters and the published Colorado tile.

No network access: source identifiers, unit conversions and the committed
publication artifacts are verified directly.
    uv run --with duckdb --with rasterio tests/test_fruiting_bulk_adapters.py
"""
import importlib.util
import json
from pathlib import Path
import unittest

import duckdb

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bulk', ROOT / 'tools/fruiting_bulk_adapters.py')
bulk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bulk)

DATA = ROOT / 'data/fruiting-forecast'
TILE = 'n40_w106'


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

    def test_dem_tile_naming_and_units_are_explicit(self):
        # USGS 1-degree tiles are named by the NORTH edge; Fruiting Forecast uses the south edge.
        self.assertEqual(bulk.usgs_dem_tile_id('n40_w106'), 'n41w106')
        self.assertIn('USGS_1_n41w106', bulk.dem_tile_url('n40_w106'))
        self.assertEqual(bulk.meters_to_feet(4341), 14242.13)
        self.assertIsNone(bulk.meters_to_feet(None))

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
class PublishedColoradoTile(unittest.TestCase):
    """The committed artifact must match what the adapters promise."""

    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((DATA / 'manifest.json').read_text())
        tiles = [tile for tile in cls.manifest['tiles'] if tile['id'] == TILE]
        if not tiles:
            raise unittest.SkipTest('Colorado tile is not present in this manifest')
        cls.tile = tiles[0]
        cls.con = duckdb.connect()

    def rows_of(self, asset):
        table = self.con.execute('SELECT * FROM read_parquet(?)', [str(DATA / asset['url'])])
        columns = [description[0] for description in table.description]
        return columns, [dict(zip(columns, row)) for row in table.fetchall()]

    def test_habitat_layer_carries_western_host_evidence_and_real_elevation(self):
        habitat = self.tile['habitat']
        self.assertEqual(habitat['status'], 'PARTIAL')
        self.assertEqual(habitat['cells'], 400)
        self.assertEqual(habitat['units'], {'elevation_ft': 'feet', 'sourceElevation': 'meters'})
        self.assertIn('canopy', habitat['unbuilt'])
        columns, records = self.rows_of(habitat)
        for column in ('spruce_fir_signal', 'fir_spruce_mountain_hemlock_signal', 'lodgepole_pine_signal',
                       'ponderosa_pine_signal', 'douglas_fir_signal', 'aspen_birch_signal', 'forest_mapped',
                       'elevation_ft', 'forest_type_code'):
            self.assertIn(column, columns)
        elevations = [record['elevation_ft'] for record in records if record['elevation_ft'] is not None]
        self.assertEqual(len(elevations), 400)
        # Colorado Front Range / Never Summer country: a broad but real sanity band.
        self.assertGreater(min(elevations), 3000)
        self.assertLess(max(elevations), 15000)
        self.assertGreater(max(elevations) - min(elevations), 3000)
        conifers = sum((record['fir_spruce_mountain_hemlock_signal'] or 0) + (record['lodgepole_pine_signal'] or 0)
                       for record in records)
        self.assertGreater(conifers, 0)
        # Missing optional evidence stays null rather than zero.
        self.assertTrue(all(record['canopy'] is None for record in records))
        self.assertTrue(all(record['deciduous'] is None for record in records))

    def test_fire_layer_holds_real_mtbs_perimeters(self):
        fire = self.tile['fireHistory']
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
            # Fires are intentionally not clipped: a perimeter straddling the tile edge is
            # real evidence for the sectors inside it, so require overlap, not containment.
            self.assertLessEqual(record['min_lon'], -105)
            self.assertGreaterEqual(record['max_lon'], -106)
            self.assertLessEqual(record['min_lat'], 41)
            self.assertGreaterEqual(record['max_lat'], 40)

    def test_public_land_rows_are_tile_local_and_state_scoped(self):
        public = self.tile['publicLands']
        self.assertEqual(public['status'], 'AVAILABLE')
        columns, records = self.rows_of(public)
        self.assertEqual(len(records), public['properties'])
        self.assertIn('state_code', columns)
        self.assertIn('jurisdiction_source', columns)
        for record in records:
            self.assertTrue(record['state_code'], 'every published property needs an authoritative state')
            self.assertGreaterEqual(record['min_lon'], -106.01)
            self.assertLessEqual(record['max_lon'], -104.99)
            self.assertGreaterEqual(record['min_lat'], 39.99)
            self.assertLessEqual(record['max_lat'], 41.01)
        self.assertTrue(any(record['state_code'] == 'CO' for record in records))

    def test_manifest_declares_four_layers_and_no_fabricated_empty(self):
        summary = self.manifest['summary']['layers']
        tile_count = self.manifest['summary']['tileCount']
        self.assertEqual(set(summary), {'habitat', 'public-land', 'access', 'fire'})
        self.assertEqual(tile_count, len(self.manifest['tiles']))
        # Every layer accounts for every tile, and an empty asset is never inferred.
        for layer, stat in summary.items():
            self.assertEqual(sum(stat[key] for key in ('populated', 'verifiedEmpty', 'unbuilt', 'failed')), tile_count, layer)
            self.assertEqual(stat['verifiedEmpty'], 0, layer)
        self.assertGreaterEqual(summary['fire']['populated'], 1)
        # A populated habitat entry must declare a real asset URL, never a bare count.
        for tile in self.manifest['tiles']:
            asset = tile.get('habitat') or {}
            if asset.get('status') in {'AVAILABLE', 'PARTIAL'}:
                self.assertTrue(asset.get('url'))
                self.assertTrue(asset.get('sha256'))
                self.assertGreater(asset.get('cells') or 0, 0)

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


if __name__ == '__main__':
    unittest.main()