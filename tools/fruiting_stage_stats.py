#!/usr/bin/env python3
"""Summarize a production metrics.jsonl: per-stage medians, concurrency, retries.

Usage: python3 tools/fruiting_stage_stats.py /tmp/ff-batch2-normalized/metrics.jsonl
Reports per-stage seconds (median/p75/sum), DEM wait vs local compute overlap,
publish busy time, wall span, and hosted-service retry counts by kind/status.
"""
import json
import statistics
import sys
from collections import defaultdict


def main(path):
    stages = defaultdict(list)
    events = []
    retries = defaultdict(int)
    dem_bytes = 0
    dem_reclaimed = 0
    disk_min = None
    dem_peak = 0
    first = last = None
    built = []
    publishes = []
    for line in open(path):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        kind = e.get('kind')
        at = e.get('at')
        if at and (first is None or at < first):
            first = at
        if at and (last is None or at > last):
            last = at
        if kind == 'stage' and e.get('success'):
            stages[e['stage']].append(e['seconds'])
        elif kind == 'retry':
            retries[(e.get('source'), e.get('status'))] += 1
        elif kind == 'dem-downloaded':
            dem_bytes += e.get('bytes', 0)
        elif kind == 'dem-reclaimed':
            dem_reclaimed += e.get('bytes', 0)
        elif kind == 'disk':
            free = e.get('freeBytes')
            dems = e.get('demBytes', 0)
            disk_min = free if disk_min is None else min(disk_min, free)
            dem_peak = max(dem_peak, dems)
        elif kind == 'tile-built':
            built.append((at, e.get('tile'), e.get('seconds')))
        elif kind == 'publish' and e.get('failures', 0) == 0:
            publishes.append((at, e.get('tile'), e.get('seconds')))
    out = {'spanSeconds': round((last - first), 1) if first and last else None,
           'stageStats': {k: {'n': len(v), 'median': round(statistics.median(v), 1),
                              'p75': round(sorted(v)[min(len(v) - 1, int(len(v) * 0.75))], 1),
                              'sum': round(sum(v), 1)} for k, v in sorted(stages.items())},
           'retries': {f'{s}:{st}': n for (s, st), n in sorted(retries.items())},
           'demDownloadedBytes': dem_bytes, 'demReclaimedBytes': dem_reclaimed,
           'minFreeDiskBytes': disk_min, 'peakDemCacheBytes': dem_peak,
           'tilesBuilt': len(built), 'publishBusySeconds': round(sum(p[2] or 0 for p in publishes), 1),
           'buildBusySeconds': round(sum(b[2] or 0 for b in built), 1)}
    # Simple concurrency signal: overlap of build busy-time with publish busy-time.
    if out['spanSeconds']:
        out['buildUtilization'] = round(out['buildBusySeconds'] / out['spanSeconds'] / 2, 3)
        out['publishUtilization'] = round(out['publishBusySeconds'] / out['spanSeconds'], 3)
    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    main(sys.argv[1])
