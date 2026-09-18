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
    needed_states = sorted({s for states in blocking.values() for s in states})
    ready_soil = {k.split(':')[1] for k, v in load_cache_manifest(SOURCE).get('sources', {}).items()
                  if k.startswith('ssurgo_sda:') and v.get('status') == 'READY'}
    ready_pbf = {k.split(':')[1] for k, v in load_cache_manifest(ACCESS).get('sources', {}).items()
                 if k.startswith('osm_access:') and v.get('status') == 'READY'}
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
    rb['batch2'] = {**rb.get('batch2', {}), 'authorized': True, 'completedTiles': completed_batch2,
                    'total': len(frozen) if scope2_path.exists() else None}
    rb['batch3'] = {
        'authorized': False,
        'candidateTiles': len(buildable),
        'newStatePreparation': needed_states,
        'noStateThresholdTiles': len(nostate),
        'selection': 'Planner-derived after Batch 2: incomplete tiles whose required prepared states make them buildable; see batch3-scope.json.',
    }
    rb_path.write_text(json.dumps(rb, indent=2) + '\n')
    print(json.dumps({'remaining': len(remaining), 'buildableNow': len(buildable),
                      'noStateTiles': len(nostate), 'stateBlocked': len(blocking),
                      'statesNeedingPreparation': needed_states}, indent=2))


if __name__ == '__main__':
    main()
