#!/usr/bin/env python3
"""Machine-readable Batch 2 report from scope, state-prep, chunks, metrics, manifest.

Usage: python3 tools/fruiting_batch2_report.py [--out data/fruiting-forecast/production/batch2-report.json]
Enough state lands in the report for a fresh session to resume or audit without
conversation history: frozen scope, prepared states, chunks, metrics, R2 totals.
"""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
DATA = ROOT / 'data/fruiting-forecast'
PROD = DATA / 'production'
WORK = Path('/tmp/ff-batch2-normalized')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', type=Path, default=PROD / 'batch2-report.json')
    a = ap.parse_args()
    scope = json.loads((PROD / 'batch2-scope.json').read_text())
    prep = json.loads((PROD / 'batch2-state-prep.json').read_text())
    chunks = sorted(PROD.glob('chunk-*.json')) + sorted(WORK.glob('chunk-*.json'))
    seen, chunk_records = set(), []
    for p in chunks:
        if p.name.startswith('chunk-') and p.stem[6:].isdigit() and p.stem not in seen:
            seen.add(p.stem)
            chunk_records.append(json.loads(p.read_text()))
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
    metrics = WORK / 'metrics.jsonl'
    stats = {'retries': {}, 'demDownloadedBytes': 0, 'demReclaimedBytes': 0,
             'minFreeDiskBytes': None, 'peakDemCacheBytes': 0}
    batch_started_at = None
    if metrics.exists():
        sys.path.insert(0, str(ROOT / 'tools'))
        import fruiting_stage_stats as S
        import io, contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            S.main(str(metrics))
        stats = json.loads(buf.getvalue())
        for line in metrics.read_text().splitlines():
            try:
                batch_started_at = json.loads(line).get('at')
                break
            except ValueError:
                continue
    # R2 transport accounting from the append-only publisher ledger, scoped to
    # this batch by the first recorded metrics event (never a bucket listing).
    inv_path = DATA / '.r2-inventory.jsonl'
    uploaded, uploaded_bytes, intents, reused = {}, {}, 0, 0
    if inv_path.exists():
        for line in inv_path.read_text().splitlines():
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if batch_started_at and (e.get('at') or 0) < batch_started_at:
                continue
            if e.get('event') == 'upload-intent':
                intents += 1
            if e.get('event') == 'verified' and e.get('url'):
                if e.get('uploaded'):
                    uploaded[e['url']] = e.get('bytes', 0)
                else:
                    reused[e['url']] = e.get('bytes', 0)
    audit = PROD / 'remote-audit.json'
    report = {
        'schemaVersion': 1,
        'startingCommit': scope['startingCommit'],
        'frozenTiles': len(scope['tiles']),
        'frozenTileList': scope['tiles'],
        'candidateExplanation': ('Planner-derived after the 19-state cohort was prepared. The Revision-15 '
                                 'estimate of 309 included 30 incomplete tiles with no state at or above the '
                                 '5% source threshold; the production runner cannot resolve soil states for '
                                 'those tiles, so the authoritative planner froze 279.'),
        'coverageBefore': scope['coverageBefore'],
        'readyStates': scope['readyStates'],
        'statePrep': prep,
        'chunks': [{'chunk': i, 'requested': c.get('requested'), 'incomplete': c.get('incomplete'),
                    'elapsedSeconds': c.get('elapsedSeconds'), 'stats': c.get('stats')}
                   for i, c in enumerate(chunk_records)],
        'newlyComplete': len(done_frozen),
        'frozenRemaining': sorted(frozen - {t['id'] for t in done_frozen}),
        'nationalComplete': len(complete),
        'nationalRemaining': 940 - len(complete),
        'r2': {'activeObjects': len(refs), 'activeBytes': sum(b for b, _ in refs.values()),
               'uploadedObjects': len(uploaded), 'uploadedBytes': sum(uploaded.values()),
               'uploadIntents': intents, 'verifiedReusedObjects': len(reused),
               'ledgerScope': 'publisher upload-intent ledger since the first Batch-2 metrics event; not a bucket listing'},
        'metrics': stats,
        'remoteAudit': json.loads(audit.read_text()) if audit.exists() else None,
        'resume': {'command': 'uv run tools/fruiting_batch2.py run --scope data/fruiting-forecast/production/batch2-scope.json --chunk <n>',
                   'nextChunk': len(chunk_records),
                   'journal': 'data/fruiting-forecast/production/pnw-release-journal-batch2.json'},
    }
    a.out.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ('frozenTiles', 'newlyComplete', 'nationalComplete', 'nationalRemaining', 'nextChunk' if 'nextChunk' in report else 'r2')}, default=str))


if __name__ == '__main__':
    main()
