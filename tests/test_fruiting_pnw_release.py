"""Deterministic checks for the bounded Oregon PNW release tooling.

The tile selection must be reproducible from pinned repository geography
(EPA Level III + Census states), never a rectangle or a hand-maintained list.
    uv run --with shapely --with pyproj --with duckdb tests/test_fruiting_pnw_release.py
"""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pnw_release', ROOT / 'tools/fruiting_pnw_release.py')
pnw_release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pnw_release)

DATA = ROOT / 'data/fruiting-forecast'
MANIFEST = json.loads((DATA / 'manifest.json').read_text())


def _shares(rows):
    return [{'tile': tid, 'stateSharePct': state, 'pnwSharePct': pnw, 'adjacentProfiles': {}}
            for tid, state, pnw in rows]


class SelectionAlgorithm(unittest.TestCase):
    def test_thresholds_connectivity_and_state_gate_on_synthetic_shares(self):
        shares = _shares([
            ('n44_w123', 100.0, 60.0),   # core seed
            ('n44_w124', 100.0, 30.0),   # halo, four-connected to the core
            ('n43_w123', 100.0, 30.0),   # halo, connected only through n44_w124
            ('n41_w124', 100.0, 45.0),   # high-PNW halo but not connected -> excluded
            ('n44_w126', 100.0, 55.0),   # would be core but off the grid edge? still core (no adjacency needed)
            ('n44_w125', 8.0, 70.0),     # PNW-rich but state share below the gate
            ('n42_w123', 100.0, 5.0),    # too little PNW
        ])
        derived, eligible = pnw_release.select_tiles(shares)
        # Deterministic south-to-north, west-to-east order.
        self.assertEqual(derived, ['n43_w123', 'n44_w126', 'n44_w124', 'n44_w123'])
        self.assertEqual(eligible['n44_w123']['role'], 'core')
        self.assertEqual(eligible['n44_w124']['role'], 'halo')
        self.assertEqual(eligible['n43_w123']['role'], 'halo')
        self.assertEqual(eligible['n44_w126']['role'], 'core')
        self.assertNotIn('n41_w124', derived, 'unconnected halo must be excluded')
        self.assertNotIn('n44_w125', eligible, 'state-share gate must exclude non-Oregon tiles')
        self.assertNotIn('n42_w123', derived)
        self.assertIsNone(eligible['n41_w124']['role'])
        self.assertIsNone(eligible['n42_w123']['role'])

    def test_core_without_halo_needs_no_connectivity(self):
        derived, eligible = pnw_release.select_tiles(_shares([('n45_w120', 100.0, 80.0)]))
        self.assertEqual(derived, ['n45_w120'])
        self.assertEqual(eligible['n45_w120']['role'], 'core')

    def test_real_selection_is_deterministic_and_matches_the_published_release(self):
        first = pnw_release.shares_for_tiles('OR')
        second = pnw_release.shares_for_tiles('OR')
        self.assertEqual(first, second, 'selection input must be deterministic')
        derived, eligible = pnw_release.select_tiles(first)
        expected = ['n42_w123', 'n42_w125', 'n43_w123', 'n43_w124', 'n43_w125', 'n44_w122',
                    'n44_w123', 'n44_w124', 'n45_w122', 'n45_w123', 'n45_w124']
        self.assertEqual(sorted(derived), expected,
                         'the Oregon footprint must not drift after state generalization')
        # Every published PNW tile is exactly the derived release; roles and shares
        # stay inside the documented thresholds.
        published_pnw = sorted(t['id'] for t in MANIFEST['tiles']
                               if t['id'] in expected and t['publicLands'].get('status') in {'AVAILABLE', 'VERIFIED_EMPTY'})
        self.assertEqual(published_pnw, expected)
        for tile_id in expected:
            row = eligible[tile_id]
            self.assertGreaterEqual(row['stateSharePct'], 25.0, tile_id)
            self.assertGreaterEqual(row['pnwSharePct'], 25.0, tile_id)
            if row['role'] == 'core':
                self.assertGreaterEqual(row['pnwSharePct'], 50.0, tile_id)
            else:
                self.assertLess(row['pnwSharePct'], 50.0, tile_id)
                # A halo tile must be four-connected to the release.
                lat, lon = int(tile_id[1:3]), -int(tile_id[5:8])
                neighbors = {pnw_release.tile_id_of(lat + dlat, lon + dlon)
                             for dlat, dlon in ((1, 0), (-1, 0), (0, 1), (0, -1))}
                self.assertTrue(neighbors & set(expected), tile_id)

    def test_washington_derivation_from_the_same_contract(self):
        shares = pnw_release.shares_for_tiles('WA')
        derived, eligible = pnw_release.select_tiles(shares)
        expected = ['n45_w122', 'n45_w123', 'n46_w122', 'n46_w123', 'n46_w124',
                    'n47_w122', 'n47_w123', 'n47_w124', 'n47_w125', 'n48_w123']
        self.assertEqual(sorted(derived), expected)
        roles = {t: eligible[t]['role'] for t in expected}
        self.assertEqual(sorted(t for t, r in roles.items() if r == 'core'),
                         ['n45_w123', 'n46_w122', 'n46_w123', 'n46_w124', 'n47_w123', 'n47_w124'])
        self.assertEqual(sorted(t for t, r in roles.items() if r == 'halo'),
                         ['n45_w122', 'n47_w122', 'n47_w125', 'n48_w123'])
        # Interior Washington stays excluded; no Canada-border tile sneaks in.
        for tile_id in ('n46_w121', 'n47_w121', 'n48_w121', 'n48_w122', 'n49_w123', 'n45_w121'):
            self.assertNotIn(tile_id, derived, tile_id)
        # The two shared Columbia tiles are also Oregon release tiles; no other
        # Oregon tile appears in the Washington derivation.
        self.assertEqual(sorted(set(derived) & {'n42_w123', 'n43_w123', 'n44_w123', 'n45_w124'}), [])
        self.assertEqual(sorted(set(derived) & {'n45_w122', 'n45_w123'}), ['n45_w122', 'n45_w123'])

    def test_per_tile_access_states_follow_geography(self):
        """Boundary tiles compose exactly the prepared states that reach them."""
        self.assertEqual(pnw_release._access_states_for_tile('n45_w123', ['OR', 'WA']), ['OR', 'WA'])
        self.assertEqual(pnw_release._access_states_for_tile('n45_w122', ['OR', 'WA']), ['OR', 'WA'])
        self.assertEqual(pnw_release._access_states_for_tile('n46_w124', ['OR', 'WA']), ['OR', 'WA'])
        self.assertEqual(pnw_release._access_states_for_tile('n47_w123', ['OR', 'WA']), ['WA'])
        self.assertEqual(pnw_release._access_states_for_tile('n48_w123', ['OR', 'WA']), ['WA'])
        self.assertEqual(pnw_release._access_states_for_tile('n44_w123', ['OR']), ['OR'])


class Plan(unittest.TestCase):
    def test_oregon_plan_estimates_use_real_published_measurements(self):
        plan = pnw_release.build_plan('OR')
        self.assertEqual(sorted(plan['tiles']),
                         ['n42_w123', 'n42_w125', 'n43_w123', 'n43_w124', 'n43_w125', 'n44_w122',
                          'n44_w123', 'n44_w124', 'n45_w122', 'n45_w123', 'n45_w124'])
        self.assertEqual(plan['estimates']['basis'], 'measured published PNW tiles')
        for key in ('habitatBytesPerTile', 'publicLandsBytesPerTile', 'fireHistoryBytesPerTile', 'accessPointsBytesPerTile'):
            self.assertGreater(plan['estimates'][key], 0, key)
        self.assertEqual(set(plan['estimates']['estimatedNewBytes']),
                         {'habitat', 'publicLands', 'fireHistory', 'accessPoints'})
        # The union of existing and new tiles is always the whole derived release;
        # every Oregon release tile is published, so no tile remains new.
        self.assertEqual(sorted(set(plan['newTiles']) | set(plan['existingTiles'])), sorted(plan['tiles']))
        self.assertTrue({'n43_w123', 'n44_w124'} <= set(plan['existingTiles']))
        self.assertEqual(plan['newTiles'], [])
        shares = plan['shares']
        self.assertGreater(shares['n44_w123']['pnwSharePct'], shares['n44_w122']['pnwSharePct'])
        self.assertIn('interiorMountains', shares['n44_w122']['adjacentProfiles'],
                      'the eastern halo must record its unsupported interior adjacency')
        self.assertIn('southeast', shares['n42_w123']['adjacentProfiles'],
                      'the southern core must record its Klamath adjacency')

    def test_washington_plan_reports_shared_and_new_tiles(self):
        plan = pnw_release.build_plan('WA')
        # Every Washington release tile is now published; the plan reports them
        # as existing, never as new work.
        self.assertEqual(sorted(set(plan['newTiles']) | set(plan['existingTiles'])), sorted(plan['tiles']))
        self.assertEqual(plan['newTiles'], [])
        self.assertTrue({'n45_w122', 'n45_w123'} <= set(plan['existingTiles']))
        self.assertEqual(plan['roles']['n48_w123'], 'halo')
        self.assertGreater(plan['estimates']['accessPointsBytesPerTile'], 0)

    def test_plan_reports_missing_caches_without_inventing_readiness(self):
        plan = pnw_release.build_plan('OR', source_cache=Path('/nonexistent-pnw-cache'))
        self.assertFalse(plan['sourceCache']['exists'])
        self.assertEqual(plan['sourceCache']['demMissingForRelease'], sorted(plan['tiles']))

    def test_access_cache_status_reports_the_prepared_source(self):
        plan = pnw_release.build_plan('OR', access_cache=Path('/nonexistent-pnw-access'))
        self.assertFalse(plan['accessCache']['ready'])
        self.assertIn('prepare', plan['accessCache']['note'])


class Journal(unittest.TestCase):
    def test_resume_requires_a_matching_published_digest(self):
        published = next(t for t in MANIFEST['tiles'] if t['id'] == 'n44_w124')
        sha = published['habitat']['sha256']
        self.assertTrue(pnw_release._published_matches('n44_w124', {'sha256': sha}, 'habitat'))
        self.assertFalse(pnw_release._published_matches('n44_w124', {'sha256': '0' * 64}, 'habitat'))
        self.assertFalse(pnw_release._published_matches('n44_w124', {}, 'habitat'))
        self.assertFalse(pnw_release._published_matches('n44_w124', {'sha256': sha}, 'accessPoints'))
        self.assertIsNone(pnw_release._published_sha256('n47_w130', 'habitat'))


if __name__ == '__main__':
    unittest.main()
