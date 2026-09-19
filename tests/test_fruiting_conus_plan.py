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

    def test_relevant_tiles_are_evidence_cell_derived(self):
        """Relevance is normalized evidence, not the legacy coarse area sliver."""
        self.assertEqual(len(self.rows), 922)
        for tile_id in COASTAL_PUBLISHED:
            self.assertIn(tile_id, self.by_id,
                          'coastal production tiles must not disappear behind a stale land flag')
        # The normalized denominator is exactly the tiles with real U.S. land cells;
        # the legacy 1%-of-tile-area gate is no longer the admission rule.
        for row in self.rows:
            self.assertTrue(row['normalizedRelevant'], row['id'])
            self.assertGreater(row['usLandCells'], 0, row['id'])
            self.assertGreater(row['usStateCells'], 0, row['id'])
        for tile_id in ('n27_w097', 'n29_w089', 'n31_w114', 'n36_w123', 'n38_w075'):
            row = self.by_id[tile_id]
            self.assertLess(row['landSharePct'], 1.0,
                            'the newly relevant tiles are exactly the ones the coarse area gate missed')
            self.assertGreater(row['usLandCells'], 0, tile_id)

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
            self.assertEqual(row['biology'], 'PROVISIONAL', row['id'])

    def test_layer_status_and_publication_come_from_the_manifest(self):
        self.assertTrue(self.by_id['n44_w123']['published'])
        self.assertEqual(self.by_id['n44_w123']['layerStatus']['accessPoints'], 'AVAILABLE')
        unbuilt = self.by_id['n38_w106']
        self.assertIn(unbuilt['layerStatus']['accessPoints'], ['UNBUILT','AVAILABLE','VERIFIED_EMPTY'])
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
                                                'madrean', 'coldBasins', 'warmDesert',
                                                'southernRockies', 'northernForests', 'hardwood',
                                                'appalachians', 'southeast', 'plains'})
        self.assertEqual(cov['profiles']['pnw']['biologyMaturity'], 'PROVISIONAL')
        self.assertEqual(cov['profiles']['northernForests']['biologyMaturity'], 'PROVISIONAL')
        self.assertEqual(cov['profiles']['southeast']['biologyMaturity'], 'PROVISIONAL')
        self.assertEqual(cov['profiles']['california']['biologyMaturity'], 'PROVISIONAL')
        self.assertEqual(cov['profiles']['sierraNevada']['biologyMaturity'], 'PROVISIONAL')
        self.assertEqual(cov['profiles']['madrean']['biologyMaturity'], 'PROVISIONAL')
        self.assertEqual(cov['profiles']['coldBasins']['biologyMaturity'], 'MODELED_SPARSE')
        self.assertEqual(cov['profiles']['warmDesert']['biologyMaturity'], 'MODELED_SPARSE')
        self.assertEqual(cov['profiles']['interiorMountains']['biologyMaturity'], 'PROVISIONAL')
        self.assertEqual(cov['profiles']['plains']['biologyMaturity'], 'PROVISIONAL')
        self.assertGreaterEqual(cov['profiles']['pnw']['tilesGisComplete'], 19)
        self.assertGreaterEqual(cov['tilesGisComplete'], 35)  # 28 + 4 California + 3 Southwest canaries
        # Coverage never exceeds the normalized denominator, and the normalized
        # denominator is smaller than the historical coarse roster.
        self.assertLessEqual(cov['tilesGisComplete'], cov['relevantLandTiles'])
        self.assertEqual(cov['relevantLandTiles'], 922)
        self.assertEqual(cov['legacyCoarseRosterTiles'], 940)
        self.assertEqual(cov['normalizedIrrelevantLegacyTiles'], 23)
        self.assertEqual(cov['newlyRelevantTiles'], 5)
        self.assertEqual(cov['normalizationAlgorithm'], 'us-land-evidence-cells-v1')
        self.assertIn('normalized evidence rule', cov['coverageSemantics'])
        self.assertIn('not finished national mushroom coverage', cov['coverageSemantics'])

    def test_zero_state_fallback_resolves_real_us_land_cells(self):
        """Zero-normal-state edge tiles resolve from the normalized land-cell states."""
        canaries = {
            'n24_w081': {'FL': 1},             # Florida Keys
            'n32_w119': {'CA': 6},             # Channel Islands
            'n42_w081': {'PA': 14},            # Lake Erie shoreline
            'n47_w090': {'MI': 9, 'MN': 15},   # Lake Superior / Keweenaw
            'n48_w089': {'MI': 11},            # Isle Royale
            'n47_w068': {'ME': 11},            # Downeast coast
        }
        for tile_id, counts in canaries.items():
            row = self.by_id[tile_id]
            self.assertEqual(row['stateResolution'], 'cell-fallback', tile_id)
            self.assertEqual(row['fallbackStateCellCounts'], counts, tile_id)
            self.assertEqual(row['soilStatesRequired'], sorted(counts), tile_id)
            self.assertEqual(row['normalizedStates'], counts, tile_id)
            self.assertTrue(row['soilStatesRequired'], 'fallback tiles must resolve a source')

    def test_normalized_exclusions_are_explicit_and_zero_cell(self):
        """Every legacy-roster tile with no U.S. land cell is an explicit exclusion."""
        excluded = ('n45_w073', 'n49_w099', 'n49_w100', 'n49_w101', 'n49_w102', 'n49_w103',
                    'n49_w104', 'n49_w105', 'n49_w106', 'n49_w107', 'n49_w108', 'n49_w109',
                    'n49_w110', 'n49_w111', 'n49_w112', 'n49_w113', 'n49_w114', 'n49_w115',
                    'n49_w116', 'n49_w119', 'n49_w120', 'n49_w121', 'n49_w122')
        summary = planner.normalization_summary()
        records = {item['tile']: item for item in summary['exclusions']}
        self.assertEqual(sorted(records), sorted(excluded))
        for tile_id in excluded:
            self.assertNotIn(tile_id, self.by_id, 'an excluded tile must not be relevant')
            record = records[tile_id]
            self.assertEqual(record['stateCells'], 0, tile_id)
            self.assertEqual(record['landCells'], 0, tile_id)
            self.assertTrue(record['reason'], tile_id)

    def test_normalization_inclusions_are_present(self):
        """Tiles the coarse area gate missed but that hold real U.S. land cells."""
        summary = planner.normalization_summary()
        included = {item['tile']: item for item in summary['inclusions']}
        self.assertEqual(sorted(included), ['n27_w097', 'n29_w089', 'n31_w114', 'n36_w123', 'n38_w075'])
        for tile_id, record in included.items():
            self.assertIn(tile_id, self.by_id, tile_id)
            self.assertGreater(record['landCells'], 0, tile_id)
            self.assertEqual(self.by_id[tile_id]['normalizedStates'], record['states'], tile_id)

    def test_every_relevant_tile_resolves_exactly_one_way(self):
        """National invariant: no normalized-relevant tile falls between planner semantics."""
        normal = fallback = blocked = 0
        for row in self.rows:
            resolution = row['stateResolution']
            self.assertIn(resolution, {'normal', 'cell-fallback', 'blocked-no-us-cells'}, row['id'])
            if resolution in {'normal', 'cell-fallback'}:
                self.assertTrue(row['soilStatesRequired'], row['id'])
                self.assertTrue(set(row['soilStatesRequired']) <= set(planner.load_geography()[1]), row['id'])
                if resolution == 'normal':
                    normal += 1
                    for state in row['soilStatesRequired']:
                        self.assertGreaterEqual(row['stateShares'].get(state, 0), planner.SOURCE_STATE_SHARE, row['id'])
                else:
                    fallback += 1
                    self.assertEqual(row['soilStatesRequired'], sorted(row['fallbackStateCellCounts']), row['id'])
                    for state in row['soilStatesRequired']:
                        self.assertLess(row['stateShares'].get(state, 0), planner.SOURCE_STATE_SHARE, row['id'])
            else:
                blocked += 1
                self.assertEqual(row['soilStatesRequired'], [], row['id'])
        self.assertEqual(normal + fallback + blocked, len(self.rows))
        self.assertEqual(fallback, self.coverage['tilesFallbackResolved'])
        self.assertEqual(blocked, self.coverage['tilesEdgeBlocked'])
        # Normalized relevance guarantees an evidence cell, so no relevant row is
        # blocked and every row carries at least one land cell.
        self.assertEqual(blocked, 0)
        self.assertEqual(fallback, 22)
        self.assertEqual(normal, 900)

    def test_fallback_never_imports_foreign_jurisdiction(self):
        """Only pinned US states can ever be a source, fallback included."""
        us_states = set(planner.load_geography()[1])
        for row in self.rows:
            for state in row['soilStatesRequired'] + list((row['fallbackStateCellCounts'] or {})):
                self.assertIn(state, us_states, row['id'])
        # Tiles entirely inside Canada are excluded by normalization, never built.
        self.assertNotIn('n49_w099', self.by_id)
        self.assertNotIn('n49_w122', self.by_id)
        # A real border tile with genuine U.S. land cells stays relevant.
        self.assertEqual(self.by_id['n49_w095']['normalizedStates'], {'MN': 4})
        self.assertEqual(self.by_id['n49_w096']['normalizedStates'], {'MN': 11})

    def test_projection_uses_measured_distributions(self):
        bytes_stats = planner.measured_per_tile_bytes(MANIFEST)
        proj = planner.projection(self.rows, bytes_stats)
        self.assertGreater(proj['relevantLandTiles'], 900)
        # Post-completion the per-tile medians cover the full national sample, so
        # the simple projection is smaller than the pre-Batch-3 estimate; it must
        # still be a sane national order of magnitude.
        self.assertGreater(proj['estimatedPublishedBytesTotal'], 100_000_000)
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
