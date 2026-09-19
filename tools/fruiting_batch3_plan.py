#!/usr/bin/env python3
"""Derive (never execute) the remaining national tiles for the final Batch 3 pass.

Writes production/batch3-scope.json with exact remaining tiles, the zero-state
edge fallback/blocked classification, the blocking states per tile, and required
state preparation. Also refreshes the batch2/batch3 summary in
production/remaining-batches.json.
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
    edge_fallback = [r for r in remaining if r.get('stateResolution') == 'cell-fallback']
    edge_blocked = [r for r in remaining if r.get('stateResolution') == 'blocked-no-us-cells']
    blocking = {}
    for r in remaining:
        if r['soilStatesRequired'] and not (r['soilPrepared'] and r['pbfPrepared']):
            blocking[r['id']] = r['soilStatesRequired']
    ready_soil = {k.split(':')[1] for k, v in load_cache_manifest(SOURCE).get('sources', {}).items()
                  if k.startswith('ssurgo_sda:') and v.get('status') == 'READY'}
    ready_pbf = {k.split(':')[1] for k, v in load_cache_manifest(ACCESS).get('sources', {}).items()
                 if k.startswith('osm_access:') and v.get('status') == 'READY'}
    # Unprepared states only: a blocked tile may co-require states that are
    # already prepared, and those are not work for the next pass. Edge-fallback
    # tiles contribute their resolved fallback states too.
    blocked_states = {s for states in blocking.values() for s in states}
    fallback_states = {s for r in edge_fallback for s in r['soilStatesRequired']}
    needed_states = sorted(s for s in (blocked_states | fallback_states)
                           if s not in ready_soil or s not in ready_pbf)
    state_counts = Counter(s for states in blocking.values() for s in states)
    out = {
        'schemaVersion': 1,
        'startingCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
        'coverage': coverage(rows),
        'remainingRelevantTiles': len(remaining),
        'buildableNow': [r['id'] for r in buildable],
        'buildableAfterPreparation': len(buildable) + len(blocking),
        'stateBlockedTiles': {'count': len(blocking), 'statesPerTile': blocking},
        'edgeFallbackTiles': {
            'count': len(edge_fallback),
            'tiles': [r['id'] for r in edge_fallback],
            'stateCellCounts': {r['id']: r.get('fallbackStateCellCounts') for r in edge_fallback},
            'note': ('Zero-normal-state tiles whose real US sample cells resolve one or more pinned US '
                     'states. The fallback is restricted to tiles the normal 5% rule resolves to zero '
                     'states and is derived only from actual state geometry at the habitat sample-cell '
                     'centers; multi-state edge tiles keep every genuine state source.'),
        },
        'edgeBlockedTiles': {
            'count': len(edge_blocked),
            'tiles': [r['id'] for r in edge_blocked],
            'reasons': {r['id']: r.get('edgeBlockedReason') for r in edge_blocked},
            'note': ('Zero-normal-state tiles with no habitat sample cell inside any US state. Their '
                     '>=1% planner land share is a 1:20M Census cartographic-boundary simplification '
                     'sliver at the 45/49-degree international border (<=0.019 degrees past the line); '
                     'building them would publish foreign-only evidence as national coverage. They are '
                     'explicitly blocked, never silently dropped.'),
        },
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
    frozen = set()
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
        'candidateTiles': len(buildable) + len(blocking) + len(edge_fallback),
        'buildableWithoutPreparation': len(buildable),
        'stateBlockedTiles': len(blocking),
        'edgeFallbackTiles': len(edge_fallback),
        'edgeBlockedTiles': len(edge_blocked),
        'newStatePreparation': needed_states,
        'selection': ('Planner-derived after Batch 2 with the zero-state cell fallback: state-blocked tiles plus '
                      'edge-fallback tiles become buildable once the named states are prepared; edge-blocked '
                      'tiles stay explicit. See batch3-scope.json. Derivation only, not authorization.'),
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
                      'stateBlocked': len(blocking), 'edgeFallback': len(edge_fallback),
                      'edgeBlocked': len(edge_blocked),
                      'statesNeedingPreparation': needed_states}, indent=2))


if __name__ == '__main__':
    main()
