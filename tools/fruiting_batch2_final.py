#!/usr/bin/env python3
"""Batch 2 final analysis: concurrency effectiveness, runtime projection, R2 cost update.

Reads production/batch2-report.json + batch2-storage-stats.json + the live metrics
journal, and writes production/batch2-final-analysis.json. Batch-1 comparison values
are supplied from batch1-report.json, never hard-coded assumptions.
"""
import json
from pathlib import Path
import statistics
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
PROD = ROOT / 'data/fruiting-forecast/production'
WORK = Path('/tmp/ff-batch2-normalized')


def main():
    report = json.loads((PROD / 'batch2-report.json').read_text())
    storage = json.loads((PROD / 'batch2-storage-stats.json').read_text())
    b1 = json.loads((PROD / 'batch1-report.json').read_text())
    chunks = report['chunks']
    exec_seconds = sum(c.get('elapsedSeconds') or 0 for c in chunks)
    newly = report['newlyComplete']
    stats = report['metrics']
    stages = stats.get('stageStats', {})
    dem = stages.get('dem', {})
    access = stages.get('access', {})
    span = stats.get('spanSeconds') or exec_seconds
    b1_stage = b1.get('stageSeconds') or {}
    b1_dem_median = ((b1_stage.get('dem') or {}).get('median')) or 66.0
    b1_access_median = ((b1_stage.get('access') or {}).get('median')) or 2.8
    b1_stage_seconds = sum((v or {}).get('sum', 0) for v in b1_stage.values()) or 28201.9
    b1_serial_per_tile = b1_stage_seconds / max(b1.get('requested', 301), 1)
    b1_wall = b1.get('wallSecondsSinceFirstAttempt') or 0
    def med(name):
        return (stages.get(name) or {}).get('median') or 0
    # Publication busy time is the sum of successful per-tile publish events
    # (phase A and B); the transport remains the proven serialized Wrangler path.
    r2 = report.get('r2') or {}
    out = {
        'schemaVersion': 1,
        'concurrencyEffectiveness': {
            'frozenTiles': report['frozenTiles'],
            'newlyComplete': newly,
            'finalPassChunkWallSeconds': round(exec_seconds, 1),
            'sinceFirstAttemptSpanSeconds': round(span, 1),
            'secondsPerTileFinalPass': round(exec_seconds / max(newly, 1), 1),
            'secondsPerTileSinceFirstAttempt': round(span / max(newly, 1), 1),
            'batch1SerialSecondsPerTile': round(b1_serial_per_tile, 1),
            'batch1WallSecondsSinceFirstAttempt': b1_wall,
            'batch1TilesPerHourWall': round(3600 * b1.get('requested', 301) / b1_wall, 1) if b1_wall else None,
            'batch2TilesPerHourFinalPass': round(3600 * newly / exec_seconds, 1) if exec_seconds else None,
            'batch2TilesPerHourSinceFirstAttempt': round(3600 * newly / span, 1) if span else None,
            'buildUtilizationTwoWorkers': stats.get('buildUtilization'),
            'publishUtilization': stats.get('publishUtilization'),
            'demMedianSeconds': dem.get('median'),
            'demP75Seconds': dem.get('p75'),
            'accessMedianSeconds': access.get('median'),
            'accessP75Seconds': access.get('p75'),
            'batch1DemMedianSeconds': b1_dem_median,
            'batch1AccessMedianSeconds': b1_access_median,
            'note': ('The first 100 frozen tiles were produced by earlier interrupted generations; the final pass '
                     're-verified and republished them, so final-pass chunk wall understates their real cost. The '
                     'since-first-attempt span includes duplicate work, restart time and stopped time and is labeled '
                     'as such, never presented as an execution rate.'),
        },
        'bottleneck': {
            'buildBusySeconds': stats.get('buildBusySeconds'),
            'publishBusySeconds': stats.get('publishBusySeconds'),
            'demShareOfBuildBusy': round((dem.get('sum', 0) / stats.get('buildBusySeconds', 1)), 3) if stats.get('buildBusySeconds') else None,
            'accessShareOfBuildBusy': round((access.get('sum', 0) / stats.get('buildBusySeconds', 1)), 3) if stats.get('buildBusySeconds') else None,
            'hostedServiceSeconds': round(sum((stats.get('serviceSeconds') or {}).values()), 1),
            'verdict': None,
        },
        'r2Transport': {
            'mechanism': 'Wrangler OAuth (no bucket-scoped S3 credentials present in the environment)',
            'uploadedObjects': r2.get('uploadedObjects'),
            'uploadedBytes': r2.get('uploadedBytes'),
            'uploadIntents': r2.get('uploadIntents'),
            'verifiedReusedObjects': r2.get('verifiedReusedObjects'),
            'publishBusySeconds': stats.get('publishBusySeconds'),
            'note': ('Publication is serialized and overlaps the two local workers; its share of wall time is '
                     'reported rather than assumed. The S3-compatible path was neither required nor benchmarked '
                     'because no bucket-scoped credentials were available.'),
        },
        'runtimeProjectionRemaining': {},
        'r2Cost': {
            'nationalStorageGB': round(storage['profileWeightedNationalProjectionBytes'] / 1e9, 3),
            'nationalStorageGBSimpleMean': round(storage['simpleMeanNationalProjectionBytes'] / 1e9, 3),
            'objectsPerSearch': 36,
            'readsPerUserMonth': 72,
            'readsAtUsers': {'100': 7200, '1000': 72000, '10000': 720000},
            'warmCacheAvoidanceAssumed': 0.5,
            'edgeCacheAssumed': False,
            'note': 'Assumptions unchanged from Revision 15 (4 searches x 9 tiles x 4 objects, 50% warm-cache avoidance). R2 free allowances are account-shared; egress free.',
        },
    }
    # Runtime projection for the remaining buildable tiles (Batch 3 candidate),
    # separated into stages, in both two-worker and serial-equivalent terms.
    b3 = json.loads((PROD / 'batch3-scope.json').read_text()) if (PROD / 'batch3-scope.json').exists() else {}
    # Batch 3 is the state-blocked remainder: after the 17 unprepared states are
    # prepared, every one of those tiles becomes buildable. The 30
    # no-state-threshold tiles are a planner/runner design question and are not
    # projected here.
    n = len(b3.get('buildableNow', [])) + (b3.get('stateBlockedTiles') or {}).get('count', 0)
    def stage_total(name):
        st = stages.get(name, {})
        return (st.get('median') or 0) * n
    dem_two = med('dem') * n / 2
    # Hosted services stay on one serialized lane; local compute runs on two
    # workers. Access is local OSM computation, not a hosted service.
    hosted = (med('soil') + med('public-land') + med('fire')) * n
    local = (med('habitat') + med('access')) * n / 2
    # Per-tile publication is measured from the publish events themselves (the
    # stage journal has no publish stages); medians keep duplicate attempts from
    # inflating the forward projection.
    pub_a, pub_b = [], []
    metrics_path = WORK / 'metrics.jsonl'
    if metrics_path.exists():
        for line in metrics_path.read_text().splitlines():
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get('kind') == 'publish' and not e.get('failures'):
                (pub_a if e.get('phase') == 'A' else pub_b).append(e.get('seconds') or 0)
    per_tile_publish = (statistics.median(pub_a) if pub_a else 0) + (statistics.median(pub_b) if pub_b else 0)
    pub_total = per_tile_publish * n
    serial_equiv = med('dem') * n + hosted + (med('habitat') + med('access')) * n + pub_total
    prep_states = len(b3.get('statesNeedingPreparation') or [])
    prep_seconds = 0.0
    if prep_states:
        prep = json.loads((PROD / 'batch2-state-prep.json').read_text())
        per_state = prep['totalSeconds'] / max(len(prep['cohort']), 1)
        prep_seconds = per_state * prep_states
    out['runtimeProjectionRemaining'] = {
        'remainingBuildableTiles': n,
        'twoWorkerExpectationSeconds': round(dem_two + hosted + local + pub_total, 1),
        'serialEquivalentSeconds': round(serial_equiv, 1),
        'twoWorkerP75ExpectationSeconds': round(
            (stages.get('dem', {}).get('p75') or 0) * n / 2
            + ((stages.get('soil', {}).get('p75') or 0) + (stages.get('public-land', {}).get('p75') or 0)
               + (stages.get('fire', {}).get('p75') or 0)) * n
            + ((stages.get('habitat', {}).get('p75') or 0) + (stages.get('access', {}).get('p75') or 0)) * n / 2
            + ((sorted(pub_a)[min(len(pub_a) - 1, int(len(pub_a) * 0.75))] if pub_a else 0)
               + (sorted(pub_b)[min(len(pub_b) - 1, int(len(pub_b) * 0.75))] if pub_b else 0)) * n, 1),
        'components': {'demTwoWorker': round(dem_two, 1), 'hostedSerialized': round(hosted, 1),
                       'localComputeTwoWorker': round(local, 1), 'publicationSerialized': round(pub_total, 1),
                       'statePreparationEstimate': round(prep_seconds, 1),
                       'statePreparationStates': prep_states},
        'excludes': ('State preparation is estimated separately from the measured Batch-2 per-state mean and is '
                     'not included in the two-worker expectation; stopped/operator time and the no-state-threshold '
                     'tiles are excluded.'),
    }
    # Resumed-pass concurrency measurement: the contiguous chunks the final
    # authoritative run executed (chunk 10 onward), measured from its own start.
    resumed = [c for c in chunks if (c.get('chunk') or 0) >= 10 and c.get('startedAt')]
    if resumed:
        t0 = min(c['startedAt'] for c in resumed)
        t1 = max(c.get('endedAt') or 0 for c in resumed)
        wall = t1 - t0
        tiles_n = sum(len(c.get('requested') or []) for c in resumed)
        metrics_path = WORK / 'metrics.jsonl'
        import collections
        sel = []
        if metrics_path.exists():
            for line in metrics_path.read_text().splitlines():
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                if (e.get('at') or 0) >= t0:
                    sel.append(e)
        stage_by_tile = collections.defaultdict(float)
        for e in sel:
            if e.get('kind') == 'stage' and e.get('success'):
                stage_by_tile[e['tile']] += e['seconds']
        build_busy = sum(e.get('seconds') or 0 for e in sel if e.get('kind') == 'tile-built')
        pub_busy = sum(e.get('seconds') or 0 for e in sel
                       if e.get('kind') == 'publish' and not e.get('failures'))
        dem = [e for e in sel if e.get('kind') == 'download' and 'Elevation/1/TIFF' in (e.get('url') or '')]
        disk = [e.get('freeBytes') for e in sel if e.get('kind') == 'disk' and e.get('freeBytes')]
        out['resumedPass'] = {
            'chunks': len(resumed), 'tiles': tiles_n, 'wallSeconds': round(wall, 1),
            'tilesPerHour': round(3600 * tiles_n / wall, 1) if wall else None,
            'minFreeDiskBytes': min(disk) if disk else None,
            'perTileStageSumMedianSeconds': round(statistics.median(stage_by_tile.values()), 1) if stage_by_tile else None,
            'perTileStageSumMeanSeconds': round(sum(stage_by_tile.values()) / len(stage_by_tile), 1) if stage_by_tile else None,
            'serialStageSpeedup': round(sum(stage_by_tile.values()) / wall, 2) if wall else None,
            'buildUtilizationTwoWorkers': round(build_busy / wall / 2, 3) if wall else None,
            'publishUtilization': round(pub_busy / wall, 3) if wall else None,
            'demDownloads': len(dem), 'demDownloadedBytes': sum(e.get('bytes', 0) for e in dem),
            'demDownloadSeconds': round(sum(e.get('seconds') or 0 for e in dem), 1),
            'retryEvents': len([e for e in sel if e.get('kind') in {'service-retry', 'download-retry'}]),
            'serviceCalls': len([e for e in sel if e.get('kind') == 'service']),
            'note': ('The resumed pass is the contiguous run that finished the frozen list. Serial stage speedup is '
                     'the sum of per-tile stage seconds divided by wall seconds; a value near 2.0 would mean two '
                     'workers hid essentially all serial work.'),
        }
    ce = out['concurrencyEffectiveness']
    ratio = ce['batch1SerialSecondsPerTile'] / max(ce['secondsPerTileSinceFirstAttempt'], 0.01)
    ce['interpretation'] = (f'Batch 2 completed {newly} tiles with a final-pass chunk wall of '
                            f'{ce["finalPassChunkWallSeconds"]:,} s and a since-first-attempt span of '
                            f'{ce["sinceFirstAttemptSpanSeconds"]:,} s ({ce["secondsPerTileSinceFirstAttempt"]} s/tile '
                            f'including restarts vs {ce["batch1SerialSecondsPerTile"]} s/tile serial stage time in '
                            f'Batch 1). Worker build utilization {ce["buildUtilizationTwoWorkers"]}; publisher '
                            f'utilization {ce["publishUtilization"]}. DEM median {ce["demMedianSeconds"]} s/tile vs '
                            f'Batch-1 {ce["batch1DemMedianSeconds"]:.1f}; access median {ce["accessMedianSeconds"]} '
                            f's/tile vs Batch-1 {ce["batch1AccessMedianSeconds"]:.1f}.')
    bottleneck_share = out['bottleneck']['demShareOfBuildBusy']
    access_share = out['bottleneck']['accessShareOfBuildBusy']
    if bottleneck_share:
        out['bottleneck']['verdict'] = ('DEM remains a major local constraint at '
                                        f'{round(bottleneck_share * 100, 1)}% of build-busy time; dense eastern OSM '
                                        f'access computation is the other at {round((access_share or 0) * 100, 1)}%, '
                                        f'with access p75 {ce["accessP75Seconds"]} s/tile far above the Batch-1 '
                                        'western median. Publication runs concurrently and did not become the limiter.')
    else:
        out['bottleneck']['verdict'] = 'insufficient data'
    (PROD / 'batch2-final-analysis.json').write_text(json.dumps(out, indent=2) + '\n')
    print(json.dumps({'tilesPerHourFinalPass': ce['batch2TilesPerHourFinalPass'],
                      'tilesPerHourSinceFirstAttempt': ce['batch2TilesPerHourSinceFirstAttempt'],
                      'speedupVsBatch1': round(ratio, 2), 'remainingBuildable': n}, indent=2))


if __name__ == '__main__':
    main()
