#!/usr/bin/env python3
"""National four-layer storage statistics from the current release manifest.

Counts only modern AVAILABLE bulk-built layers (PARTIAL legacy assets excluded),
per complete tile, and derives per-tile distributions plus profile-weighted and
simple-mean national projections from pinned profile tile counts.
"""
import json
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from fruiting_conus_plan import build_tiles, LAYERS  # noqa: E402

DATA = ROOT / 'data/fruiting-forecast'


def pct(values, q):
    values = sorted(values)
    idx = (len(values) - 1) * q
    lo, hi = math.floor(idx), math.ceil(idx)
    return values[lo] if lo == hi else int(values[lo] + (values[hi] - values[lo]) * (idx - lo))


def main():
    manifest = json.loads((DATA / 'manifest.json').read_text())
    rows = build_tiles(source_cache=Path('/tmp/ffsrc'), access_cache=Path('/tmp/fruiting-forecast-gis-sources'))
    published = {t['id']: t for t in manifest['tiles']}
    per_tile, per_layer = [], defaultdict(int)
    per_profile = defaultdict(lambda: [0, 0, 0])  # tiles, completeTiles, bytes
    for r in rows:
        entry = published.get(r['id']) or {}
        tile_bytes = 0
        complete_tile = True
        for layer in LAYERS:
            asset = entry.get(layer) or {}
            if asset.get('status') == 'AVAILABLE' and asset.get('bytes'):
                tile_bytes += asset['bytes']
                per_layer[layer] += asset['bytes']
            elif asset.get('status') != 'VERIFIED_EMPTY':
                complete_tile = False
        if complete_tile and tile_bytes:
            per_tile.append(tile_bytes)
            prof = r['dominantProfile']
            per_profile[prof][0] += 1
            per_profile[prof][1] += 1
            per_profile[prof][2] += tile_bytes
    total = sum(per_tile)
    n = len(per_tile)
    mean = total / n
    # Profile-weighted projection: each profile's measured mean bytes/tile applied
    # to its approxTilesForFullCoverage from the planner's own coverage output.
    sys.path.insert(0, str(ROOT / 'tools'))
    from fruiting_conus_plan import coverage as plan_coverage
    cov = plan_coverage()
    weighted = 0.0
    simple = 0.0
    simple_n = 0
    for name, info in cov['profiles'].items():
        tiles_needed = info['approxTilesForFullCoverage']
        mine = per_profile.get(name)
        avg = (mine[2] / mine[1]) if mine and mine[1] else mean
        weighted += avg * tiles_needed
        simple += mean * tiles_needed
        simple_n += tiles_needed
    out = {
        'completeTiles': n,
        'totalBytes': total,
        'meanBytesPerTile': int(mean),
        'medianBytesPerTile': int(statistics.median(per_tile)),
        'p25': pct(per_tile, 0.25), 'p75': pct(per_tile, 0.75), 'p90': pct(per_tile, 0.90),
        'layerTotals': dict(sorted(per_layer.items())),
        'profileTileStats': {str(p): {'completeTiles': v[1], 'bytes': v[2], 'meanBytesPerTile': int(v[2] / v[1]) if v[1] else None}
                             for p, v in sorted(per_profile.items(), key=lambda kv: str(kv[0]))},
        'profileWeightedNationalProjectionBytes': int(weighted),
        'simpleMeanNationalProjectionBytes': int(simple),
        'simpleMeanBasisTiles': simple_n,
    }
    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    main()
