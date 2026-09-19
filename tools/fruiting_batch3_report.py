#!/usr/bin/env python3
"""Machine-readable final national (Batch 3) report.

Reads the frozen scope, the state-preparation record, the durable chunk/journal
artifacts and the live metrics journal, and writes a report with enough state for
a fresh session to audit national completion without conversation history.

    python3 tools/fruiting_batch3_report.py [--out data/fruiting-forecast/production/batch3-report.json]
"""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
DATA = ROOT / 'data/fruiting-forecast'
PROD = DATA / 'production'
B3 = PROD / 'batch3'
WORK = Path('/tmp/ff-batch3-normalized')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', type=Path, default=PROD / 'batch3-report.json')
    ap.add_argument('--scope', type=Path, default=PROD / 'batch3-final-scope.json')
    ap.add_argument('--metrics', type=Path, default=WORK / 'metrics.jsonl')
    a = ap.parse_args()
    scope = json.loads(a.scope.read_text())
    prep = json.loads((PROD / 'batch3-state-prep.json').read_text())
    chunk_paths = sorted(B3.glob('chunk-*.json'))
    chunks = [json.loads(p.read_text()) for p in chunk_paths]
    manifest = json.loads((DATA / 'manifest.json').read_text())
    tiles = manifest['tiles']
    complete = [t for t in tiles if all((t.get(k) or {}).get('status') in {'AVAILABLE', 'VERIFIED_EMPTY'}
                                        for k in ('habitat', 'publicLands', 'fireHistory', 'accessPoints'))]
    frozen = set(scope['tiles'])
    done_frozen = [t for t in tiles if t['id'] in frozen and
                   all((t.get(k) or {}).get('status') in {'AVAILABLE', 'VERIFIED_EMPTY'}
                       for k in ('habitat', 'publicLands', 'fireHistory', 'accessPoints'))]
    refs = {}

    def walk(v):
        if isinstance(v, dict):
            u = v.get('url', '')
            if isinstance(u, str) and u.endswith('.parquet'):
                refs[u] = (v.get('bytes') or 0, v.get('sha256'))
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)
    walk(tiles)
    stats = {'retries': {}, 'demDownloadedBytes': 0, 'demReclaimedBytes': 0,
             'minFreeDiskBytes': None, 'peakDemCacheBytes': 0}
    if a.metrics.exists():
        import fruiting_stage_stats as S
        import io
        import contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            S.main(str(a.metrics))
        stats = json.loads(buf.getvalue())
    audit = PROD / 'remote-audit.json'
    report = {
        'schemaVersion': 1,
        'startingCommit': scope.get('startingCommit'),
        'frozenTiles': len(scope['tiles']),
        'frozenTileList': scope['tiles'],
        'edgeFallbackTiles': scope.get('edgeFallbackTiles', []),
        'edgeBlockedTiles': scope.get('edgeBlockedTiles', []),
        'coverageBefore': scope.get('coverageBefore'),
        'readyStates': scope.get('readyStates'),
        'statePrep': prep,
        'chunks': [{'chunk': i, 'requested': c.get('requested'), 'incomplete': c.get('incomplete'),
                    'elapsedSeconds': c.get('elapsedSeconds'), 'startedAt': c.get('startedAt'),
                    'endedAt': c.get('endedAt'), 'stats': c.get('stats')}
                   for i, c in enumerate(chunks)],
        'newlyComplete': len(done_frozen),
        'frozenRemaining': sorted(frozen - {t['id'] for t in done_frozen}),
        'nationalComplete': len(complete),
        'nationalRemaining': 940 - len(complete),
        'edgeBlockedRemaining': scope.get('edgeBlockedTiles', []),
        'r2': {'activeObjects': len(refs), 'activeBytes': sum(b for b, _ in refs.values())},
        'metrics': stats,
        'remoteAudit': json.loads(audit.read_text()) if audit.exists() else None,
        'resume': {'command': 'bash /tmp/ff-batch3-resume.sh <nextChunk>',
                   'nextChunk': len(chunks),
                   'scope': str(a.scope),
                   'chunksDir': str(B3),
                   'runState': str(B3 / 'run-state.json'),
                   'journal': str(B3 / 'journal.json')},
    }
    a.out.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ('frozenTiles', 'newlyComplete', 'nationalComplete',
                                             'nationalRemaining')}, default=str))


if __name__ == '__main__':
    main()
