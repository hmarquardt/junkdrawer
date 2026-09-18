# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb", "requests", "shapely", "pyproj", "rasterio", "osmium", "pyshp"]
# ///
"""National GIS Batch 2: prepare states, rerun the planner, freeze and execute.

Stages (each restartable and idempotent):

    prepare  --states AL,AR,...    Serial state preparation (SDA soil + OSM PBF).
    plan                           Rerun the planner and freeze batch2-scope.json.
    run      --scope ... --chunk N One checkpoint chunk (<=10 tiles) executed with
                                   at most two concurrent local/DEM tile workers.

Serialized lanes (enforced by locks in fruiting_bulk_adapters and here):
SDA and other hosted per-tile services; R2 publication; manifest mutation;
publisher-ledger mutation; the journal. Only DEM downloads and local
per-tile computation run concurrently (two workers maximum).
"""
import argparse
from collections import Counter
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import sys
import threading
import time

from fruiting_conus_plan import build_tiles, coverage, ROOT, DATA
from fruiting_bulk_adapters import (CACHE_LOCK, load_cache_manifest, prepare_national,
                                    prepare_state, save_cache_manifest, dem_path, usgs_dem_tile_id)
from fruiting_tile_publish import atomic_json
from fruiting_remote import references  # noqa: F401  (preflight import)
sys.path.insert(0, str(ROOT / 'tools'))

SOURCE_CACHE = Path('/tmp/ffsrc')
ACCESS_CACHE = Path('/tmp/fruiting-forecast-gis-sources')
OUT = Path('/tmp/ff-batch2-normalized')
PROD = DATA / 'production'


def complete(row):
    return all(v in {'AVAILABLE', 'VERIFIED_EMPTY'} for v in row['layerStatus'].values())


def derive(cohort):
    """Planner truth: eligible incomplete tiles whose required states are prepared."""
    rows = build_tiles(source_cache=SOURCE_CACHE, access_cache=ACCESS_CACHE)
    ready_soil = {k.split(':')[1] for k, v in load_cache_manifest(SOURCE_CACHE).get('sources', {}).items()
                  if k.startswith('ssurgo_sda:') and v.get('status') == 'READY'}
    ready_pbf = {k.split(':')[1] for k, v in load_cache_manifest(ACCESS_CACHE).get('sources', {}).items()
                 if k.startswith('osm_access:') and v.get('status') == 'READY'}
    eligible = [r for r in rows if r['soilStatesRequired'] and r['soilPrepared'] and r['pbfPrepared']]
    requested = [r for r in eligible if not complete(r)]
    return {
        'schemaVersion': 1,
        'startingCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
        'requestedCohort': cohort,
        'sourceCache': str(SOURCE_CACHE), 'accessCache': str(ACCESS_CACHE),
        'coverageBefore': coverage(rows),
        'readySoilStates': sorted(ready_soil), 'readyPbfStates': sorted(ready_pbf),
        'readyStates': sorted(ready_soil & ready_pbf),
        'eligibleTiles': len(eligible), 'alreadyComplete': len(eligible) - len(requested),
        'tiles': [r['id'] for r in requested],
        'tileDetail': {r['id']: {'soilStatesRequired': r['soilStatesRequired'],
                                 'dominantProfile': r['dominantProfile']} for r in requested},
        'layerWork': dict(Counter(k for r in requested for k, v in r['layerStatus'].items()
                                  if v not in {'AVAILABLE', 'VERIFIED_EMPTY'})),
        'stateTileCounts': dict(Counter(s for r in eligible for s in r['soilStatesRequired'])),
        'demTilesNeeded': [r['id'] for r in requested if not r['demPrepared']],
        'preexistingDemTiles': [r['id'] for r in rows if r['demPrepared']],
    }


def cmd_prepare(states):
    """Serialized, restartable state preparation: SDA soil then OSM access PBF."""
    results = {}
    for code in states:
        t0 = time.time()
        soil = prepare_state(SOURCE_CACHE, code)
        results.setdefault(code, {})['soil'] = {k: soil.get(k) for k in
                                                ('status', 'reused', 'rows', 'datasetVersion', 'error')}
        print(f"{code} soil: {soil.get('status')} ({time.time()-t0:.1f}s)", flush=True)
        t1 = time.time()
        from fruiting_osm_access import prepare as prepare_access
        access = prepare_access(ACCESS_CACHE, code, False, 'latest', None)
        results[code]['access'] = {k: access.get(k) for k in
                                   ('status', 'reused', 'sourceUrl', 'bytes', 'normalizedBytes', 'error')}
        print(f"{code} access: {access.get('status')} ({time.time()-t1:.1f}s)", flush=True)
        results[code]['seconds'] = round(time.time() - t0, 1)
    atomic_json(PROD / 'batch2-state-prep.json', {
        'schemaVersion': 1, 'cohort': states, 'states': results,
        'totalSeconds': round(sum(v['seconds'] for v in results.values()), 1)})
    failed = [c for c in states if results[c]['soil'].get('status') != 'READY'
              or results[c]['access'].get('status') != 'READY']
    print(json.dumps({c: results[c]['seconds'] for c in states}, indent=2))
    if failed:
        raise SystemExit('State preparation failed for: ' + ','.join(failed))


def cmd_plan(cohort, out):
    scope = derive(cohort)
    if out.exists():
        raise SystemExit('Refusing to overwrite frozen scope: ' + str(out))
    atomic_json(out, scope)
    print(json.dumps({k: scope[k] for k in ('eligibleTiles', 'alreadyComplete', 'readyStates')}, indent=2))
    print('frozen tiles:', len(scope['tiles']))
    print(json.dumps(scope['tiles']))


# ── two-worker run machinery ──────────────────────────────────────────

class Batch2Runner:
    """Bounded scheduler: two builder workers, one publisher, serialized lanes."""

    def __init__(self, scope, out, checkpoint):
        self.scope = scope
        self.out = out
        self.checkpoint = checkpoint
        self.journal_path = out / 'pnw-release-journal-batch2.json'
        self.journal = json.loads(self.journal_path.read_text()) if self.journal_path.exists() else {}
        self.journal_lock = threading.Lock()
        self.publish_queue = queue.Queue()
        self.stats = Counter()
        self.stats_lock = threading.Lock()

    def save_journal(self):
        with self.journal_lock:
            tmp = self.journal_path.with_suffix('.tmp')
            tmp.write_text(json.dumps(self.journal, indent=2, sort_keys=True) + '\n')
            os.replace(tmp, self.journal_path)

    def reclaim_dem(self, tile):
        if os.environ.get('FF_RECLAIM_DEM') != '1':
            return
        preserve = set(json.loads(os.environ['FF_PRESERVE_DEMS'])) if 'FF_PRESERVE_DEMS' in os.environ else set()
        if tile in preserve:
            return
        from fruiting_metrics import emit
        dem = dem_path(SOURCE_CACHE, tile)
        if dem.exists():
            reclaimed = dem.stat().st_size
            dem.unlink()
            with CACHE_LOCK:
                cache_meta = load_cache_manifest(SOURCE_CACHE)
                cache_meta['sources']['3dep_1arcsecond:' + usgs_dem_tile_id(tile)]['status'] = 'RECLAIMED'
                save_cache_manifest(SOURCE_CACHE, cache_meta)
            emit('dem-reclaimed', tile=tile, bytes=reclaimed)
            with self.stats_lock:
                self.stats['demReclaimedBytes'] += reclaimed

    def publisher(self):
        from fruiting_pnw_release import _publish, _published_sha256
        from fruiting_metrics import emit
        while True:
            item = self.publish_queue.get()
            phase, tile = item if item is not None else (None, None)
            try:
                if item is None:
                    return
                layers = ['habitat', 'public-land', 'fire'] if phase == 'A' else ['access']
                t0 = time.time()
                failures = _publish(ROOT, [tile], layers, self.out)
                elapsed = time.time() - t0
                emit('publish', tile=tile, phase=phase, seconds=elapsed, failures=failures)
                with self.stats_lock:
                    self.stats[f'publish{phase}Seconds'] += elapsed
                    self.stats['publishedTiles'] += 1
                if failures:
                    key = 'habitat' if phase == 'A' else 'access'
                    self.journal.setdefault(tile, {})[key] = {'error': f'{failures} publication failures'}
                    print(f'PUBLISH FAILED {tile} phase {phase}: {failures}', flush=True)
                else:
                    sha = _published_sha256(tile, 'habitat' if phase == 'A' else 'accessPoints')
                    key = 'habitat' if phase == 'A' else 'access'
                    self.journal.setdefault(tile, {})[key] = {'sha256': sha, 'seconds': round(elapsed, 1)}
                    if phase == 'A':
                        self.reclaim_dem(tile)
                self.save_journal()
            except BaseException as exc:
                # A publisher exception must not kill the lane; the tile stays
                # incomplete and the checkpoint verification fails safely.
                with self.stats_lock:
                    self.stats['publishFailures'] += 1
                self.journal.setdefault(tile or 'unknown', {})['publishError'] = {'error': repr(exc)}
                self.save_journal()
                print(f'PUBLISH ERROR {tile}: {exc!r}', flush=True)
            finally:
                self.publish_queue.task_done()

    def builder(self, work, phase):
        """One tile at a time; hosted non-DEM services serialize on module locks.

        A failed tile is recorded and the worker continues with the next tile;
        the chunk still reports it as incomplete so a resume re-runs it. The
        queue is always drained (task_done in finally), so one tile failure can
        never hang the checkpoint."""
        while True:
            try:
                tile = work.get_nowait()
            except queue.Empty:
                return
            try:
                self.build_tile(tile, phase)
            except BaseException as exc:
                print(f'TILE FAILED {tile} phase {phase}: {exc!r}', flush=True)
                with self.stats_lock:
                    self.stats['tileFailures'] += 1
            finally:
                work.task_done()

    def build_tile(self, tile, phase):
        from fruiting_metrics import emit, stage
        started = time.monotonic()
        try:
            import shutil as _sh
            if _sh.disk_usage(SOURCE_CACHE).free < 4 * 1024 ** 3:
                raise RuntimeError('Less than 4 GiB free; stopped safely before tile download')
            if phase == 'A':
                from fruiting_bulk_adapters import (build_fire, build_habitat, build_public_land,
                                                    prepare_tile, soil_inputs)
                from fruiting_tile_publish import LAYERS

                def have(layer):
                    artifact = self.out / LAYERS[layer][0] / (tile + '.parquet')
                    return artifact.exists() and artifact.with_suffix('.parquet.json').exists()

                results = {}
                if all(have(l) for l in ('habitat', 'public-land', 'fire')):
                    # Resume fast path: normalized artifacts survived a previous run;
                    # never re-download a reclaimed DEM just to re-verify a checkpoint.
                    for layer in ('habitat', 'public-land', 'fire'):
                        emit('reuse-normalized', tile=tile, layer=layer)
                else:
                    states_for_soil = self.planned[tile]['soilStatesRequired']
                    with stage(tile, 'dem'):
                        prepare_tile(SOURCE_CACHE, tile)
                    with stage(tile, 'soil'):
                        soil = soil_inputs(SOURCE_CACHE, states_for_soil, tile)
                    for layer, builder in [
                            ('habitat', lambda: build_habitat(tile, SOURCE_CACHE, self.out, soil_prepared=soil)),
                            ('public-land', lambda: build_public_land(tile, SOURCE_CACHE, self.out)),
                            ('fire', lambda: build_fire(tile, SOURCE_CACHE, self.out))]:
                        artifact = self.out / LAYERS[layer][0] / (tile + '.parquet')
                        side = artifact.with_suffix('.parquet.json')
                        with stage(tile, layer):
                            if artifact.exists() and side.exists():
                                results[layer] = json.loads(side.read_text())
                                emit('reuse-normalized', tile=tile, layer=layer)
                            else:
                                results[layer] = builder()
                emit('tile-built', tile=tile, phase=phase, seconds=round(time.monotonic() - started, 1))
                self.publish_queue.put(('A', tile))
            else:
                from fruiting_osm_access import build as build_access
                from fruiting_tile_publish import LAYERS
                artifact = self.out / LAYERS['access'][0] / (tile + '.parquet')
                if artifact.exists() and artifact.with_suffix('.parquet.json').exists():
                    emit('reuse-normalized', tile=tile, layer='access')
                else:
                    with stage(tile, 'access'):
                        build_access(ACCESS_CACHE, self.access_states_for(tile), tile, self.out)
                emit('tile-built', tile=tile, phase=phase, seconds=round(time.monotonic() - started, 1))
                self.publish_queue.put(('B', tile))
            with self.stats_lock:
                self.stats['builtTiles'] += 1
                self.stats['buildSeconds'] += time.monotonic() - started
        except BaseException as exc:
            self.journal.setdefault(tile, {})['habitat' if phase == 'A' else 'access'] = {'error': str(exc)}
            self.save_journal()
            print(f'FAILED {tile} phase {phase}: {exc}', flush=True)
            raise

    def access_states_for(self, tile):
        from fruiting_pnw_release import _access_states_for_tile
        return _access_states_for_tile(tile, self.prepared_access_states)

    def run_chunk(self, tiles):
        from fruiting_metrics import emit
        planned_rows = {r['id']: r for r in build_tiles(source_cache=SOURCE_CACHE, access_cache=ACCESS_CACHE)}
        self.planned = planned_rows
        self.preexisting_dems = {t for t, r in planned_rows.items() if r['demPrepared']}
        self.prepared_access_states = sorted(
            k.split(':')[1] for k, v in load_cache_manifest(ACCESS_CACHE).get('sources', {}).items()
            if k.startswith('osm_access:') and v.get('status') == 'READY')
        from fruiting_osm_access import validate_ready as validate_access_ready
        for code in self.prepared_access_states:
            entry = load_cache_manifest(ACCESS_CACHE)['sources']['osm_access:' + code]
            validate_access_ready(ACCESS_CACHE, entry)
        os.environ.setdefault('FF_METRICS_PATH', str(self.out / 'metrics.jsonl'))
        self.out.mkdir(parents=True, exist_ok=True)

        disk_stop = threading.Event()

        def monitor():
            while not disk_stop.is_set():
                disk = shutil.disk_usage(self.out)
                dems = sum(p.stat().st_size for p in Path(self.scope['sourceCache']).glob('dem_*.tif') if p.exists())
                emit('disk', freeBytes=disk.free, usedBytes=disk.used, demBytes=dems)
                with self.stats_lock:
                    self.stats['minFreeDisk'] = min(self.stats.get('minFreeDisk', disk.free), disk.free)
                    self.stats['peakDemCache'] = max(self.stats.get('peakDemCache', 0), dems)
                if disk.free < 4 * 1024 ** 3:
                    print('DISK STOP THRESHOLD REACHED; checkpoint is durable, resume re-runs this chunk', flush=True)
                    os._exit(3)
                disk_stop.wait(2)

        watcher = threading.Thread(target=monitor, daemon=True)
        watcher.start()
        start = time.time()
        pub = threading.Thread(target=self.publisher, daemon=True)
        pub.start()

        def run_phase(phase, tl):
            work = queue.Queue()
            for t in tl:
                work.put(t)
            workers = [threading.Thread(target=self.builder, args=(work, phase), daemon=True)
                       for _ in range(2)]
            for w in workers:
                w.start()
            work.join()
            self.publish_queue.join()
            worker_errors = [w for w in workers if not w.is_alive() and self.stats.get('workerDeaths')]
            if worker_errors:
                raise SystemExit('A builder worker died; checkpoint state is durable, resume with --chunk '
                                 + str(self.checkpoint))

        run_phase('A', tiles)
        # Phase B: access for tiles whose habitat is now complete in the manifest.
        manifest = json.loads((DATA / 'manifest.json').read_text())
        cov = set(manifest['summary'].get('coverageTiles', []))
        run_phase('B', [t for t in tiles if t in cov])
        self.publish_queue.put(None)
        pub.join()
        disk_stop.set()
        elapsed = time.time() - start
        # Verify the checkpoint against current manifest truth: re-read from disk;
        # the serialized publisher mutated it after this process read it earlier.
        manifest = json.loads((DATA / 'manifest.json').read_text())
        published = {t['id']: t for t in manifest['tiles']}
        incomplete = [t for t in tiles if any(
            published.get(t, {}).get(k, {}).get('status') not in {'AVAILABLE', 'VERIFIED_EMPTY'}
            for k in ('habitat', 'publicLands', 'fireHistory', 'accessPoints'))]
        result = {'startedAt': start, 'endedAt': time.time(), 'elapsedSeconds': round(elapsed, 1),
                  'requested': tiles, 'incomplete': incomplete, 'stats': dict(self.stats)}
        atomic_json(self.out / f'chunk-{self.checkpoint:03d}.json', result)
        print(json.dumps({'requested': result['requested'], 'incomplete': incomplete,
                          'stats': result['stats'], 'elapsedSeconds': result['elapsedSeconds']}, indent=2))
        if incomplete:
            raise SystemExit('Checkpoint incomplete; preserved for resume: ' + ','.join(incomplete))


def cmd_run(scope_path, chunk, checkpoint_size, out):
    scope = json.loads(scope_path.read_text())
    tiles = scope['tiles'][chunk * checkpoint_size:(chunk + 1) * checkpoint_size]
    if not tiles:
        raise SystemExit('No tiles in requested chunk')
    current = derive(scope.get('requestedCohort', []))
    if not set(scope['readyStates']) <= set(current['readyStates']):
        raise SystemExit('Prepared states changed; preflight again')
    if shutil.disk_usage(out.parent).free < 8 * 1024 ** 3:
        raise SystemExit('Less than 8 GiB free; stopping before downloads')
    os.environ['FF_RECLAIM_DEM'] = '1'
    os.environ['FF_PRESERVE_DEMS'] = json.dumps(scope.get('preexistingDemTiles') or [])
    # Soil states for this chunk, prepared serially and idempotently (reuses READY).
    needed = sorted({s for t in tiles for s in scope['tileDetail'][t]['soilStatesRequired']})
    for code in needed:
        prepare_state(SOURCE_CACHE, code)
    # National products revalidated (reused when READY); never re-downloaded.
    prepare_national(SOURCE_CACHE, ['forest-type', 'land-cover', 'canopy', 'states'])
    runner = Batch2Runner(scope, out, chunk)
    runner.run_chunk(tiles)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    prep = sub.add_parser('prepare')
    prep.add_argument('--states', required=True)
    plan = sub.add_parser('plan')
    plan.add_argument('--cohort', default='')
    plan.add_argument('--out', type=Path, default=PROD / 'batch2-scope.json')
    run_p = sub.add_parser('run')
    run_p.add_argument('--scope', type=Path, default=PROD / 'batch2-scope.json')
    run_p.add_argument('--chunk', type=int, required=True)
    run_p.add_argument('--checkpoint-size', type=int, default=10)
    run_p.add_argument('--out', type=Path, default=OUT)
    a = p.parse_args()
    if a.command == 'prepare':
        cmd_prepare([s.strip().upper() for s in a.states.split(',') if s.strip()])
    elif a.command == 'plan':
        cmd_plan([s.strip().upper() for s in a.cohort.split(',') if s.strip()], a.out)
    else:
        cmd_run(a.scope, a.chunk, a.checkpoint_size, a.out)


if __name__ == '__main__':
    main()
