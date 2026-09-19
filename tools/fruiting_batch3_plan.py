#!/usr/bin/env python3
"""Derive (never execute) the remaining national tiles after Batch 2.

Writes production/batch3-scope.json with exact remaining tiles, the blocking
states per tile, and required state preparation. Also refreshes the batch2/batch3
summary in production/remaining-batches.json.
"""
import json
from collections import Counter
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from fruiting_conus_plan import build_tiles, coverage, DATA  # noqa: E402
from fruiting_bulk_adapters import load_cache_manifest  # noqa: E402

PROD = DATA / 'production'
SOURCE = Path('/tmp/ffsrc')
ACCESS = Path('/tmp/fruiting-forecast-gis-sources')


def main():
    rows = build_tiles(source_cache=SOURCE, access_cache=ACCESS)
    def complete(r):
        return all(v in {'AVAILABLE', 'VERIFIED_EMPTY'} for v in r['layerStatus'].values())
    remaining = [r for r in rows if not complete(r)]
    buildable = [r for r in remaining if r['soilStatesRequired'] and r['soilPrepared'] and r['pbfPrepared']]
    nostate = [r for r in remaining if not r['soilStatesRequired']]
    blocking = {}
    for r in remaining:
        if r['soilStatesRequired'] and not (r['soilPrepared'] and r['pbfPrepared']):
            blocking[r['id']] = r['soilStatesRequired']
    ready_soil = {k.split(':')[1] for k, v in load_cache_manifest(SOURCE).get('sources', {}).items()
                  if k.startswith('ssurgo_sda:') and v.get('status') == 'READY'}
    ready_pbf = {k.split(':')[1] for k, v in load_cache_manifest(ACCESS).get('sources', {}).items()
                 if k.startswith('osm_access:') and v.get('status') == 'READY'}
    # Unprepared states only: a blocked tile may co-require states that are
    # already prepared, and those are not work for the next pass.
    needed_states = sorted({s for states in blocking.values() for s in states
                            if s not in ready_soil or s not in ready_pbf})
    state_counts = Counter(s for states in blocking.values() for s in states)
    out = {
        'schemaVersion': 1,
        'startingCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
        'coverage': coverage(rows),
        'remainingRelevantTiles': len(remaining),
        'buildableNow': [r['id'] for r in buildable],
        'noStateThresholdTiles': {
            'count': len(nostate),
            'tiles': [r['id'] for r in nostate],
            'note': ('Tiles whose required states all fall below the planner 5% source threshold. '
                     'The production runner cannot resolve soil for them (pnw_release: No soil states '
                     'resolved); building them requires a planner/runner design decision, not a data fix.'),
        },
        'stateBlockedTiles': {'count': len(remaining) - len(buildable) - len(nostate),
                              'statesPerTile': blocking},
        'statesNeedingPreparation': needed_states,
        'allStatesOnBlockedTiles': sorted(state_counts),
        'preparedSoilStates': sorted(ready_soil), 'preparedPbfStates': sorted(ready_pbf),
        'stateTileCounts': dict(state_counts),
        'authorization': 'NOT AUTHORIZED - derivation only; Batch 3 has not been approved or started.',
    }
    (PROD / 'batch3-scope.json').write_text(json.dumps(out, indent=2) + '\n')
    # Refresh the high-level remaining-batches summary.
    rb_path = PROD / 'remaining-batches.json'
    rb = json.loads(rb_path.read_text())
    complete_ids = {r['id'] for r in rows if complete(r)}
    scope2_path = PROD / 'batch2-scope.json'
    completed_batch2 = None
    if scope2_path.exists():
        frozen = set(json.loads(scope2_path.read_text())['tiles'])
        completed_batch2 = len(frozen & complete_ids)
    old_b2 = rb.get('batch2', {})
    rb['batch2'] = {
        'authorized': True,
        'preFreezeEstimate': old_b2.get('candidateTiles', 309),
        'frozenTiles': len(frozen) if scope2_path.exists() else None,
        'completedTiles': completed_batch2,
        'total': len(frozen) if scope2_path.exists() else None,
        'newStatePreparation': old_b2.get('newStatePreparation', []),
        'selection': old_b2.get('selection'),
    }
    rb['derivedFromCompleteTiles'] = len(complete_ids)
    rb['remainingTiles'] = len(remaining)
    rb['batch3'] = {
        'authorized': False,
        'candidateTiles': len(buildable) + len(blocking),
        'buildableWithoutPreparation': len(buildable),
        'stateBlockedTiles': len(blocking),
        'newStatePreparation': needed_states,
        'noStateThresholdTiles': len(nostate),
        'selection': 'Planner-derived after Batch 2: the state-blocked remainder becomes buildable once the named states are prepared; see batch3-scope.json. Derivation only, not authorization.',
    }
    rb['concurrencyRecommendation'] = {
        'tileWorkers': 2,
        'design': 'At most two concurrent DEM downloads/local raster builds; serialize SDA and other hosted-service requests, R2 publication, manifest mutation and checkpoints.',
        'reason': ('Measured Batch 2: the resumed pass ran 179 tiles in 14,188 s (45.4 tiles/hour) with a '
                   'serial-stage speedup of 1.84x and 92% two-worker build utilization; DEM downloads alone '
                   'totalled 17,693 s, so overlapping them is the dominant gain. Dense eastern OSM access '
                   'computation (median 17.6 s/tile, p75 32.3 s/tile vs 2.8 s/tile in Batch 1) is now the second '
                   'constraint; publication stayed serialized at 18% utilization. Hosted ArcGIS services share a '
                   'documented 60 large-geometry requests/minute quota, so the hosted lane stays paced and '
                   'serialized. See production/batch2-final-analysis.json.'),
    }
    rb_path.write_text(json.dumps(rb, indent=2) + '\n')
    print(json.dumps({'remaining': len(remaining), 'buildableNow': len(buildable),
                      'noStateTiles': len(nostate), 'stateBlocked': len(blocking),
                      'statesNeedingPreparation': needed_states}, indent=2))


if __name__ == '__main__':
    main()
