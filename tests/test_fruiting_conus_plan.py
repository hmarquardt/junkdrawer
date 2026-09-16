"""Deterministic checks for the CONUS production planner.

The planner derives national tile relevance, state/profile shares and coverage
from pinned repository geography — never from tile centers or hand-maintained
lists.
    uv run --with shapely --with pyproj --with duckdb tests/test_fruiting_conus_plan.py
"""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('conus_plan', ROOT / 'tools/fruiting_conus_plan.py')
planner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(planner)

DATA = ROOT / 'data/fruiting-forecast'
MANIFEST = json.loads((DATA / 'manifest.json').read_text())

# Published modern release tiles whose coastal land share the legacy catalog
# estimator misses; the planner must still enumerate them.
COASTAL_PUBLISHED = ('n42_w125', 'n43_w125', 'n47_w125')


class Planner(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = planner.build_tiles()
        cls.by_id = {r['id']: r for r in cls.rows}
        cls.coverage = planner.coverage(cls.rows)

    def test_planner_is_deterministic(self):
        second = planner.build_tiles()
        self.assertEqual(self.rows, second)

    def test_relevant_land_tiles_are_geometry_derived(self):
        self.assertGreater(len(self.rows), 900, 'CONUS has roughly a thousand 1-degree land tiles')
        self.assertLess(len(self.rows), 1000)
        for tile_id in COASTAL_PUBLISHED:
            self.assertIn(tile_id, self.by_id,
                          'coastal production tiles must not disappear behind a stale land flag')
        # No tile is included that is essentially all water.
        for row in self.rows:
            self.assertGreaterEqual(row['landSharePct'], 1.0, row['id'])

    def test_shares_are_multi_state_and_multi_profile_aware(self):
        """Boundary tiles record every state and profile they actually contain."""
        columbia = self.by_id['n45_w123']
        self.assertIn('OR', columbia['stateShares'])
        self.assertIn('WA', columbia['stateShares'])
        self.assertGreater(len(columbia['profileShares']), 0)
        klamath = self.by_id['n42_w123']
        self.assertIn('pnw', klamath['profileShares'],
                      'the Klamath Mountains share must map to the pnw profile (revision 12), not southeast')
        self.assertNotIn('southeast', klamath['profileShares'])
        self.assertGreater(self.coverage['tilesMultipleProfiles'], 250)
        self.assertGreater(self.coverage['tilesMultipleStates'], 200)

    def test_dominant_profile_and_biology_follow_the_browser_declaration(self):
        """Maturity is parsed from the browser file, never hardcoded here."""
        self.assertEqual(self.by_id['n44_w123']['dominantProfile'], 'pnw')
        self.assertEqual(self.by_id['n44_w123']['biology'], 'PROVISIONAL')
        self.assertEqual(self.by_id['n45_w085']['dominantProfile'], 'northernForests')
        self.assertEqual(self.by_id['n45_w085']['biology'], 'PROVISIONAL')
        self.assertEqual(self.by_id['n32_w084']['dominantProfile'], 'southeast')
        self.assertEqual(self.by_id['n32_w084']['biology'], 'PROVISIONAL')
        plains = [r for r in self.rows if r['dominantProfile'] == 'plains']
        self.assertTrue(plains)
        for row in plains:
            self.assertEqual(row['biology'], 'UNSUPPORTED', row['id'])

    def test_layer_status_and_publication_come_from_the_manifest(self):
        self.assertTrue(self.by_id['n44_w123']['published'])
        self.assertEqual(self.by_id['n44_w123']['layerStatus']['accessPoints'], 'AVAILABLE')
        unbuilt = self.by_id['n38_w106']
        self.assertEqual(unbuilt['layerStatus']['accessPoints'], 'UNBUILT')
        self.assertTrue(unbuilt['published'])

    def test_profile_filters_and_state_filters(self):
        nf_rows = planner.build_tiles(profile='northernForests')
        self.assertTrue(all(r['profileShares'].get('northernForests', 0) >= 1.0 for r in nf_rows))
        self.assertGreater(len(nf_rows), 80)
        mi_rows = planner.build_tiles(state='MI')
        self.assertTrue(all(r['stateShares'].get('MI', 0) >= planner.SOURCE_STATE_SHARE for r in mi_rows))
        self.assertIn('n45_w085', {r['id'] for r in mi_rows})

    def test_coverage_separates_gis_production_from_biology(self):
        cov = self.coverage
        self.assertEqual(set(cov['profiles']), {'pnw', 'california', 'sierraNevada', 'interiorMountains',
                                                'southernRockies', 'southwest', 'northernForests', 'hardwood',
                                                'appalachians', 'southeast', 'plains'})
        self.assertEqual(cov['profiles']['pnw']['biologyMaturity'], 'PROVISIONAL')
        self.assertEqual(cov['profiles']['northernForests']['biologyMaturity'], 'PROVISIONAL')
        self.assertEqual(cov['profiles']['southeast']['biologyMaturity'], 'PROVISIONAL')
        self.assertEqual(cov['profiles']['california']['biologyMaturity'], 'PROVISIONAL')
        self.assertEqual(cov['profiles']['sierraNevada']['biologyMaturity'], 'PROVISIONAL')
        self.assertEqual(cov['profiles']['interiorMountains']['biologyMaturity'], 'PROVISIONAL')
        self.assertEqual(cov['profiles']['southwest']['biologyMaturity'], 'UNSUPPORTED')
        self.assertEqual(cov['profiles']['plains']['biologyMaturity'], 'UNSUPPORTED')
        self.assertEqual(cov['profiles']['pnw']['tilesGisComplete'], 19)
        self.assertEqual(cov['tilesGisComplete'], 32)  # 28 + the four California canaries
        # GIS-complete coverage under an unsupported profile must stay small and honest.
        self.assertLess(cov['tilesGisComplete'], cov['relevantLandTiles'])
        self.assertIn('not finished national mushroom coverage', cov['coverageSemantics'])

    def test_projection_uses_measured_distributions(self):
        bytes_stats = planner.measured_per_tile_bytes(MANIFEST)
        proj = planner.projection(self.rows, bytes_stats)
        self.assertGreater(proj['relevantLandTiles'], 900)
        self.assertGreater(proj['estimatedPublishedBytesTotal'], 200_000_000)
        self.assertLess(proj['estimatedPublishedBytesTotal'], 4_000_000_000)
        lo, hi = proj['estimatedPublishedBytesTotalP25P75']
        self.assertLess(lo, proj['estimatedPublishedBytesTotal'])
        self.assertGreater(hi, proj['estimatedPublishedBytesTotal'])
        self.assertGreater(proj['stateCount'], 30)
        self.assertIn('MI', proj['statesNeedingSoilAndPbf'])
        self.assertIn('ME', proj['statesNeedingSoilAndPbf'])
        self.assertIn('FL', proj['statesNeedingSoilAndPbf'])
        self.assertEqual(proj['estimatedAssets'], proj['relevantLandTiles'] * 4)
        self.assertGreater(proj['demsToDownload'], 800)
        for layer in ('habitat', 'publicLands', 'fireHistory', 'accessPoints'):
            self.assertGreater(bytes_stats[layer]['median'], 0, layer)


if __name__ == '__main__':
    unittest.main()
