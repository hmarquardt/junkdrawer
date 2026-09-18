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
    dem_downloads = 0
    dem_seconds = 0.0
    dem_reclaimed = 0
    disk_min = None
    dem_peak = 0
    first = last = None
    built = []
    publishes = []
    service_hosts = defaultdict(int)
    service_seconds = defaultdict(float)
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
        elif kind in {'service-retry', 'download-retry'}:
            retries[(kind, e.get('status'))] += 1
        elif kind == 'download':
            url = e.get('url') or ''
            if 'prd-tnm.s3.amazonaws.com' in url and '/Elevation/1/TIFF/' in url:
                dem_downloads += 1
                dem_bytes += e.get('bytes', 0)
                dem_seconds += e.get('seconds', 0) or 0
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
        elif kind == 'service':
            url = e.get('url') or ''
            host = url.split('/')[2] if '://' in url else url
            service_hosts[host] += 1
            service_seconds[host] += e.get('seconds', 0) or 0
    out = {'spanSeconds': round((last - first), 1) if first and last else None,
           'stageStats': {k: {'n': len(v), 'median': round(statistics.median(v), 1),
                              'p75': round(sorted(v)[min(len(v) - 1, int(len(v) * 0.75))], 1),
                              'sum': round(sum(v), 1)} for k, v in sorted(stages.items())},
           'retries': {f'{kind}:{st}': n for (kind, st), n in sorted(retries.items())},
           'hostedRetryCount': sum(retries.values()),
           'serviceCalls': dict(sorted(service_hosts.items())),
           'serviceSeconds': {k: round(v, 1) for k, v in sorted(service_seconds.items())},
           'demDownloads': dem_downloads,
           'demDownloadedBytes': dem_bytes, 'demDownloadSeconds': round(dem_seconds, 1),
           'demReclaimedBytes': dem_reclaimed,
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
