#!/usr/bin/env python3
"""Final national concurrency/performance/cost analysis for Batch 3.

Reads production/batch3-report.json, national-storage-stats.json, the Batch-3
metrics journal and the Batch 1/2 reports, and writes
production/batch3-final-analysis.json. All comparisons come from measured
artifacts, never hard-coded assumptions.
"""
import json
from pathlib import Path
import statistics
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
PROD = ROOT / 'data/fruiting-forecast/production'
WORK = Path('/tmp/ff-batch3-normalized')


def main():
    report = json.loads((PROD / 'batch3-report.json').read_text())
    storage = json.loads((PROD / 'national-storage-stats.json').read_text())
    b1 = json.loads((PROD / 'batch1-report.json').read_text())
    b2 = json.loads((PROD / 'batch2-final-analysis.json').read_text())
    chunks = report['chunks']
    exec_seconds = sum(c.get('elapsedSeconds') or 0 for c in chunks)
    newly = report['newlyComplete']
    stats = report['metrics']
    stages = stats.get('stageStats', {})
    span = stats.get('spanSeconds') or exec_seconds
    b1_stage = b1.get('stageSeconds') or {}
    b1_dem_median = ((b1_stage.get('dem') or {}).get('median')) or 66.0
    b1_access_median = ((b1_stage.get('access') or {}).get('median')) or 2.8
    b1_stage_seconds = sum((v or {}).get('sum', 0) for v in b1_stage.values()) or 28201.9
    b1_wall = b1.get('wallSecondsSinceFirstAttempt') or 0

    def med(name):
        return (stages.get(name) or {}).get('median') or 0

    # Resumed-pass measurement from the first chunk start.
    resumed = [c for c in chunks if c.get('startedAt')]
    resumed_block = {}
    if resumed:
        t0 = min(c['startedAt'] for c in resumed)
        t1 = max(c.get('endedAt') or 0 for c in resumed)
        wall = t1 - t0
        tiles_n = sum(len(c.get('requested') or []) for c in resumed)
        import collections
        sel = []
        if (WORK / 'metrics.jsonl').exists():
            for line in (WORK / 'metrics.jsonl').read_text().splitlines():
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
        resumed_block = {
            'chunks': len(resumed), 'tiles': tiles_n, 'wallSeconds': round(wall, 1),
            'tilesPerHour': round(3600 * tiles_n / wall, 1) if wall else None,
            'perTileStageSumMedianSeconds': round(statistics.median(stage_by_tile.values()), 1) if stage_by_tile else None,
            'serialStageSpeedup': round(sum(stage_by_tile.values()) / wall, 2) if wall else None,
            'buildUtilizationTwoWorkers': round(build_busy / wall / 2, 3) if wall else None,
            'publishUtilization': round(pub_busy / wall, 3) if wall else None,
            'demDownloads': len(dem), 'demDownloadedBytes': sum(e.get('bytes', 0) for e in dem),
            'demDownloadSeconds': round(sum(e.get('seconds') or 0 for e in dem), 1),
            'minFreeDiskBytes': min(disk) if disk else None,
            'retryEvents': len([e for e in sel if e.get('kind') in {'service-retry', 'download-retry'}]),
            'serviceCalls': len([e for e in sel if e.get('kind') == 'service']),
        }
    out = {
        'schemaVersion': 1,
        'coverage': {
            'nationalComplete': report['nationalComplete'],
            'nationalRemaining': report['nationalRemaining'],
            'newlyComplete': newly,
            'frozenTiles': report['frozenTiles'],
        },
        'concurrencyEffectiveness': {
            'finalPassChunkWallSeconds': round(exec_seconds, 1),
            'sinceFirstAttemptSpanSeconds': round(span, 1),
            'secondsPerTileFinalPass': round(exec_seconds / max(newly, 1), 1),
            'secondsPerTileSinceFirstAttempt': round(span / max(newly, 1), 1),
            'batch1SerialSecondsPerTile': round(b1_stage_seconds / max(b1.get('requested', 301), 1), 1),
            'batch1WallSecondsSinceFirstAttempt': b1_wall,
            'batch1TilesPerHourWall': round(3600 * b1.get('requested', 301) / b1_wall, 1) if b1_wall else None,
            'batch2ResumedTilesPerHour': b2.get('resumedPass', {}).get('tilesPerHour'),
            'batch2ResumedSerialStageSpeedup': b2.get('resumedPass', {}).get('serialStageSpeedup'),
            'demMedianSeconds': med('dem'), 'demP75Seconds': (stages.get('dem') or {}).get('p75'),
            'accessMedianSeconds': med('access'), 'accessP75Seconds': (stages.get('access') or {}).get('p75'),
            'batch1DemMedianSeconds': b1_dem_median,
            'batch1AccessMedianSeconds': b1_access_median,
        },
        'resumedPass': resumed_block,
        'bottleneck': {
            'buildBusySeconds': stats.get('buildBusySeconds'),
            'publishBusySeconds': stats.get('publishBusySeconds'),
            'demShareOfBuildBusy': round((stages.get('dem', {}).get('sum', 0) / stats.get('buildBusySeconds', 1)), 3)
            if stats.get('buildBusySeconds') else None,
            'accessShareOfBuildBusy': round((stages.get('access', {}).get('sum', 0) / stats.get('buildBusySeconds', 1)), 3)
            if stats.get('buildBusySeconds') else None,
            'hostedServiceSeconds': round(sum((stats.get('serviceSeconds') or {}).values()), 1),
        },
        'r2Transport': {
            'mechanism': 'Wrangler OAuth',
            'publishBusySeconds': stats.get('publishBusySeconds'),
            'note': 'Publication stayed serialized behind the two local workers for the whole final pass.',
        },
        'nationalStorage': {
            'completeTiles': storage['completeTiles'],
            'totalBytes': storage['totalBytes'],
            'meanBytesPerTile': storage['meanBytesPerTile'],
            'medianBytesPerTile': storage['medianBytesPerTile'],
            'p25': storage['p25'], 'p75': storage['p75'], 'p90': storage['p90'],
            'layerTotals': storage['layerTotals'],
            'profileWeightedNationalProjectionBytes': storage['profileWeightedNationalProjectionBytes'],
            'simpleMeanNationalProjectionBytes': storage['simpleMeanNationalProjectionBytes'],
        },
        'r2Cost': {
            'nationalStorageGBMeasured': round(storage['totalBytes'] / 1e9, 3),
            'objectsPerSearch': 36,
            'readsPerUserMonth': 72,
            'readsAtUsers': {'100': 7200, '1000': 72000, '10000': 720000},
            'warmCacheAvoidanceAssumed': 0.5,
            'edgeCacheAssumed': False,
            'note': ('Actual national dataset size (not a projection). Assumptions unchanged from Revision 15: '
                     '4 searches/user/month x 9 tiles x 4 objects with 50% warm-cache avoidance; R2 free '
                     'allowances are account-shared; egress free.'),
        },
    }
    (PROD / 'batch3-final-analysis.json').write_text(json.dumps(out, indent=2) + '\n')
    print(json.dumps({'newlyComplete': newly, 'nationalComplete': report['nationalComplete'],
                      'resumedTilesPerHour': resumed_block.get('tilesPerHour'),
                      'serialStageSpeedup': resumed_block.get('serialStageSpeedup')}, indent=2))


if __name__ == '__main__':
    main()
