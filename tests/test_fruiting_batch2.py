"""Two-worker scheduler semantics for the national production runner.

Batch 2 lost a builder worker to an ArcGIS body-level 429 and the checkpoint
hung on ``work.join()`` forever. These tests pin the fixed contract: the work
queue is always drained, a failed tile is recorded and never hangs the
checkpoint, and the serialized publisher lane survives an exception.

    uv run --with duckdb --with requests --with shapely --with pyproj --with rasterio \
        --with osmium --with pyshp tests/test_fruiting_batch2.py
"""
import importlib.util
import json
import queue
import tempfile
import threading
import unittest
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fruiting_batch2', ROOT / 'tools/fruiting_batch2.py')
batch2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(batch2)


class StubRunner(batch2.Batch2Runner):
    """Batch2Runner with tile building stubbed; no network, cache or journal."""

    def __init__(self, fail=()):
        self.scope = {}
        self.out = Path(tempfile.mkdtemp(prefix='ff-batch2-test-'))
        self.checkpoint = 0
        self.journal_path = self.out / 'journal.json'
        self.journal = {}
        self.journal_lock = threading.Lock()
        self.publish_queue = queue.Queue()
        self.stats = Counter()
        self.stats_lock = threading.Lock()
        self.fail = set(fail)
        self.built = []

    def build_tile(self, tile, phase):
        if tile in self.fail:
            raise RuntimeError('stub failure ' + tile)
        self.built.append((tile, phase))
        self.publish_queue.put((phase, tile))


class QueueFailurePropagation(unittest.TestCase):
    def _run_builders(self, runner, tiles, workers=2):
        work = queue.Queue()
        for tile in tiles:
            work.put(tile)
        threads = [threading.Thread(target=runner.builder, args=(work, 'A')) for _ in range(workers)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
        # The contract under test: join returns even after a failure, and no
        # worker thread survives.
        work.join()
        self.assertTrue(all(not thread.is_alive() for thread in threads), 'a builder worker hung')

    def test_failed_tile_is_recorded_and_queue_still_drains(self):
        runner = StubRunner(fail=('n01_w001',))
        self._run_builders(runner, ['n01_w001', 'n02_w002', 'n03_w003'])
        self.assertEqual(runner.stats['tileFailures'], 1)
        self.assertEqual(sorted(runner.built), [('n02_w002', 'A'), ('n03_w003', 'A')])
        self.assertEqual(runner.publish_queue.qsize(), 2)

    def test_multiple_failures_do_not_starve_other_tiles(self):
        runner = StubRunner(fail=('n01_w001', 'n02_w002'))
        self._run_builders(runner, ['n01_w001', 'n02_w002', 'n03_w003', 'n04_w004'])
        self.assertEqual(runner.stats['tileFailures'], 2)
        self.assertEqual(runner.publish_queue.qsize(), 2)

    def test_every_tile_failing_still_terminates(self):
        runner = StubRunner(fail=('n01_w001', 'n02_w002', 'n03_w003'))
        self._run_builders(runner, ['n01_w001', 'n02_w002', 'n03_w003'])
        self.assertEqual(runner.stats['tileFailures'], 3)
        self.assertEqual(runner.publish_queue.qsize(), 0)

    def test_publisher_lane_survives_exception(self):
        import fruiting_pnw_release
        real_publish = fruiting_pnw_release._publish
        fruiting_pnw_release._publish = lambda *a, **k: (_ for _ in ()).throw(RuntimeError('publish boom'))
        try:
            runner = StubRunner()
            for tile in ('n01_w001', 'n02_w002'):
                runner.publish_queue.put(('A', tile))
            runner.publish_queue.put(None)
            thread = threading.Thread(target=runner.publisher)
            thread.start()
            runner.publish_queue.join()
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive(), 'the publisher lane died')
            self.assertEqual(runner.stats['publishFailures'], 2)
        finally:
            fruiting_pnw_release._publish = real_publish

    def test_publisher_exit_sentinel_still_works(self):
        runner = StubRunner()
        runner.publish_queue.put(None)
        thread = threading.Thread(target=runner.publisher)
        thread.start()
        thread.join(timeout=10)
        self.assertFalse(thread.is_alive())
        self.assertEqual(runner.stats['publishFailures'], 0)


class PlannerRunnerAgreement(unittest.TestCase):
    def test_unresolved_helper_flags_blocked_tiles(self):
        scope = {
            'tiles': ['n49_w099', 'n24_w081'],
            'tileDetail': {
                'n49_w099': {'soilStatesRequired': [], 'stateResolution': 'blocked-no-us-cells'},
                'n24_w081': {'soilStatesRequired': ['FL'], 'stateResolution': 'cell-fallback'},
            },
        }
        self.assertEqual(batch2.unresolved_state_tiles(scope, scope['tiles']), ['n49_w099'])

    def test_unresolved_helper_accepts_normal_and_fallback_tiles(self):
        scope = {
            'tiles': ['n44_w123', 'n47_w090'],
            'tileDetail': {
                'n44_w123': {'soilStatesRequired': ['OR', 'WA'], 'stateResolution': 'normal'},
                'n47_w090': {'soilStatesRequired': ['MI', 'MN'], 'stateResolution': 'cell-fallback'},
            },
        }
        self.assertEqual(batch2.unresolved_state_tiles(scope, scope['tiles']), [])

    def test_unresolved_helper_flags_missing_tile_detail(self):
        scope = {'tiles': ['n01_w001'], 'tileDetail': {}}
        self.assertEqual(batch2.unresolved_state_tiles(scope, scope['tiles']), ['n01_w001'])

    def test_cmd_run_refuses_a_frozen_scope_with_an_unresolved_tile(self):
        scope = {
            'tiles': ['n49_w099'],
            'tileDetail': {'n49_w099': {'soilStatesRequired': [], 'stateResolution': 'blocked-no-us-cells'}},
            'requestedCohort': [],
            'readyStates': [],
            'sourceCache': '/tmp/ffsrc',
            'preexistingDemTiles': [],
        }
        with tempfile.TemporaryDirectory(prefix='ff-batch2-scope-') as tmp:
            path = Path(tmp) / 'scope.json'
            path.write_text(json.dumps(scope))
            with self.assertRaises(SystemExit) as ctx:
                batch2.cmd_run(path, 0, 10, Path(tmp))
        self.assertIn('planner/runner disagreement', str(ctx.exception))


if __name__ == '__main__':
    unittest.main()
