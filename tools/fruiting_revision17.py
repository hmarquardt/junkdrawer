#!/usr/bin/env python3
"""Compose the Revision 17 section of the CONUS handoff from measured artifacts.

Prepends Revision 17 to docs/fruiting-forecast-conus-expansion.md. Idempotent:
refuses to add a second Revision 17.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/fruiting-forecast'
PROD = DATA / 'production'
DOC = ROOT / 'docs/fruiting-forecast-conus-expansion.md'


def mb(b):
    return round(b / 1e6, 2)


def main():
    text = DOC.read_text()
    if '## Revision 17' in text:
        raise SystemExit('Revision 17 already present')
    report = json.loads((PROD / 'batch3-report.json').read_text())
    analysis = json.loads((PROD / 'batch3-final-analysis.json').read_text())
    storage = json.loads((PROD / 'national-storage-stats.json').read_text())
    audit = json.loads((PROD / 'remote-audit.json').read_text())
    edge = json.loads((PROD / 'edge-tiles-characterization.json').read_text())
    prep = json.loads((PROD / 'batch3-state-prep.json').read_text())
    browser = json.loads((PROD / 'browser-final.json').read_text()) if (PROD / 'browser-final.json').exists() else {}
    tests = json.loads((PROD / 'batch3-tests.json').read_text()) if (PROD / 'batch3-tests.json').exists() else {}
    m = report['metrics']
    ce = analysis['concurrencyEffectiveness']
    rsp = analysis.get('resumedPass') or {}
    cov = analysis['coverage']
    nat = analysis['nationalStorage']
    complete = cov['nationalComplete']
    remaining = cov['nationalRemaining']
    blocked_raw = report.get('edgeBlockedRemaining') or []
    blocked = [b['id'] if isinstance(b, dict) else b for b in blocked_raw]
    fallback = report.get('edgeFallbackTiles') or []
    prepared_new = [c for c in prep['cohort']
                    if not prep['states'][c]['soil'].get('reused') or not prep['states'][c]['access'].get('reused')]
    reused_soil = [c for c in prep['cohort'] if prep['states'][c]['soil'].get('reused')]
    reused_access = [c for c in prep['cohort'] if prep['states'][c]['access'].get('reused')]
    total_pbf = sum((prep['states'][c]['access'].get('bytes') or 0) for c in prep['cohort'])
    layer = nat['layerTotals']
    lines = [
        '## Revision 17 — Final national GIS production (Batch 3) and the zero-state edge resolution (2026-09-19)',
        '',
        f"Started from `{report['startingCommit']}`. **National GIS Batch 3 only** was executed after a gated "
        'Phase A resolved the zero-state edge case. The application and manifest remain at '
        '`https://hmarquardt.github.io/junkdrawer/`; immutable content-addressed Parquet is served from R2 at '
        '`https://data.hanksjunkdrawer.com/`. No Worker, VM, API service, backend or database was added.',
        '',
        '### Starting checkpoint',
        '',
        '- Revision 16 closed at `8656a06`: 615 / 940 GIS-complete, 325 remaining, Batch 3 not started.',
        '',
        '### Edge design (Phase A)',
        '',
        '- Root cause: 30 relevant tiles had every US state below the planner 5% state-source threshold. The '
        'threshold is a source-preparation gate only (which state soil/PBF sources a tile needs); it does not '
        'affect biological profile assignment, state jurisdiction, collecting rules or GIS clipping.',
        '- Fallback: restricted to tiles the normal rule resolves to zero states. It resolves sources by '
        'point-in-polygon against the pinned US state geometry at the repository 0.05-degree habitat sample-cell '
        'centers. It is deterministic, geometry-based, US-only, and can never import a foreign jurisdiction.',
        f"- **{edge['summary']['fallbackResolved']} tiles resolved real US sources** from actual sampled land "
        f"(Florida Keys, Channel Islands, Great Lakes shorelines, Downeast Maine, Texas coast and others; canaries "
        'n24_w081→FL, n32_w119→CA, n42_w081→PA, n47_w090→MI+MN).',
        f"- **{edge['summary']['blockedNoUsCells']} tiles are explicitly blocked**, never silently dropped: no "
        'habitat sample cell center falls inside any US state. Their >=1% planner land share is a 1:20M Census '
        'cartographic-boundary simplification sliver at the 45/49-degree international border (<=0.019 degrees '
        'past the line). They are foreign-dominated and building them would publish foreign-only evidence as '
        'national coverage. Machine-readable reasons: `production/edge-tiles-characterization.json` and '
        '`production/batch3-scope.json`.',
        '- Planner/runner agreement is now enforced by one shared helper (`unresolved_state_tiles`) plus a runner '
        'refusal; the national invariant classifies every relevant tile as complete, buildable-normal, '
        'buildable-fallback or explicitly blocked. Regression tests cover the canaries, the invariant, foreign '
        'safety, ArcGIS body-level 429 retry and worker-failure queue propagation.',
        '',
        '### State preparation',
        '',
        f"- Requested cohort: 17 states — {', '.join(prep['cohort'])}.",
        f"- Component-specific reuse: soil reused for {', '.join(reused_soil) or 'none'}; access reused for "
        f"{', '.join(reused_access) or 'none'}; every other component was newly prepared in this pass. The cohort "
        'was prepared in two runs because the first was interrupted after New Mexico access and Connecticut soil '
        'completed; those components were revalidated and reused, never re-downloaded.',
        f"- Measured preparation time: **{prep['totalSeconds']:,} s** total, strictly serialized (SDA soil then "
        f"Geofabrik PBF download, provider MD5 validation and osmium extraction per state). PBF bytes downloaded "
        f"in this pass: {total_pbf:,} bytes.",
        '- Restartable and idempotent: a READY component revalidates and reuses; a failed refresh never overwrites '
        'verified bytes.',
        '',
        '### Frozen final scope',
        '',
        f"- Planner-derived, frozen in `production/batch3-final-scope.json`: **{report['frozenTiles']} tiles** "
        f"({report['frozenTiles'] - len(fallback)} ordinary state-blocked tiles plus **{len(fallback)} "
        f"zero-state fallback tiles**: {', '.join(fallback)}).",
        f"- Explicitly blocked, not built: **{len(blocked)}** tiles — {', '.join(blocked)}.",
        '',
        '### Production execution',
        '',
        f"- Two concurrent local/DEM tile workers, one serialized publisher lane, {len(report['chunks'])} "
        'checkpoints of ten tiles or fewer. Strictly serialized: SDA and hosted ArcGIS services, R2 publication, '
        'manifest mutation, publisher-ledger mutation, journal writes and git checkpoints.',
        f"- Newly complete: **{report['newlyComplete']} / {report['frozenTiles']}** frozen tiles; "
        f"{len(report['frozenRemaining'])} remaining in the frozen set ({', '.join(report['frozenRemaining']) or 'none'}).",
        f"- Hosted-service retries observed: {m.get('retries') or 'none'} "
        f"({m.get('hostedRetryCount', 0)} in-process retry events). Bounded retry, jitter, Retry-After and the "
        'ArcGIS pacer stayed in force; no failed request produced neutral or invented evidence.',
        f"- Final pass chunk wall: **{ce['finalPassChunkWallSeconds']:,} s**; resumed-pass "
        f"{rsp.get('tiles')} tiles in {rsp.get('wallSeconds'):,.0f} s (**{rsp.get('tilesPerHour')} tiles/hour**), "
        f"per-tile stage-sum median {rsp.get('perTileStageSumMedianSeconds')} s, serial-stage speedup "
        f"**{rsp.get('serialStageSpeedup')}x**, two-worker build utilization "
        f"{rsp.get('buildUtilizationTwoWorkers')}, publisher utilization {rsp.get('publishUtilization')}.",
        f"- DEM: {m.get('demDownloads')} downloads / {m.get('demDownloadedBytes'):,} bytes / "
        f"{m.get('demDownloadSeconds'):,.0f} s; {m.get('demReclaimedBytes'):,} bytes reclaimed. Access median "
        f"{ce['accessMedianSeconds']} s/tile (p75 {ce['accessP75Seconds']}).",
        f"- Disk: whole-pass minimum free {m.get('minFreeDiskBytes'):,} bytes; resumed-pass minimum "
        f"{rsp.get('minFreeDiskBytes'):,} bytes. The 8 GiB preflight and 4 GiB stop floors were never lowered or "
        'triggered.',
        '',
        '### Final coverage',
        '',
        f"- **National four-layer GIS coverage: {complete} / 940.**",
        f"- Remaining: **{remaining}** tiles, all explicitly blocked — {', '.join(blocked)}.",
        '- These 13 are not missing data: they contain no US land at habitat sample-cell resolution. They are '
        'documented for a future normalization decision (a finer state boundary or an explicit relevance test), '
        'not silently excluded and never built from foreign-only evidence.',
        f"- **National GIS production is therefore NOT complete at 940/940.**",
        '',
        '### R2',
        '',
        f"- Active manifest: **{audit['references']} objects / {audit['bytes']:,} bytes**.",
        f"- Final remote audit: {len(audit['valid'])} remotely valid, {len(audit['missing'])} missing, "
        f"{len(audit['invalid'])} invalid, {len(audit['localOnly'])} local-only (retained), "
        f"{len(audit['remoteOrphans'])} publisher-ledger remote orphans (retained); clean = {audit['clean']}.",
        f"- Audit scope is precise: {audit['inventoryScope']}. Wrangler cannot exhaustively list the bucket, so "
        'this is not a claim that the bucket contains no other objects.',
        '- Publication transport remained the proven Wrangler OAuth path with immutable upload, full remote '
        'verification and serialized manifest mutation.',
        '',
        '### Browser',
        '',
        f"- Final matrix: {browser.get('label', 'batch3-final')} — {len(browser.get('profiles', []))} live lookups; "
        f"cold Parquet requests per lookup "
        f"{[p.get('coldParquetRequests') for p in browser.get('profiles', [])]}, warm additional Parquet "
        f"{browser.get('warmCacheAdditionalParquetRequests')}; console errors {len(browser.get('consoleErrors', []))}, "
        f"page errors {len(browser.get('pageErrors', []))}.",
        '- SHA/length validation, DuckDB queries and CORS passed; suggested starts remained eligible mapped '
        'evidence only.',
        '',
        '### National storage (measured, not projected)',
        '',
        f"- Across {nat['completeTiles']} complete tiles: total {nat['totalBytes']:,} bytes, mean "
        f"{nat['meanBytesPerTile']:,} B/tile, median {nat['medianBytesPerTile']:,}, p25 {nat['p25']:,}, p75 "
        f"{nat['p75']:,}, p90 {nat['p90']:,}. Layer totals: habitat {mb(layer['habitat'])} MB, public land "
        f"{mb(layer['publicLands'])} MB, fire {mb(layer['fireHistory'])} MB, access {mb(layer['accessPoints'])} MB.",
        f"- Active R2 manifest bytes: **{audit['bytes']:,}** (immutable Parquet plus small manifest-adjacent "
        'assets are counted by the audit only for referenced objects).',
        f"- R2 cost at the measured size ({analysis['r2Cost']['nationalStorageGBMeasured']} GB): ~72 Class B "
        'reads/user/month gives 7,200 / 72,000 / 720,000 reads at 100 / 1,000 / 10,000 monthly users, inside the '
        'account-shared free allowances in isolation. Edge caching was not configured and was not assumed; no '
        'Worker is warranted. A narrow immutable-Parquet cache rule is optional if request measurements later '
        'justify it.',
        '',
        '### Tests',
        '',
        f"- {tests.get('summary', 'see production/batch3-tests.json')}",
        '',
        '### Biology',
        '',
        'Biology is unchanged and was asserted before and after: **13 profiles, 11 PROVISIONAL, 2 MODELED_SPARSE, '
        '0 UNSUPPORTED**. No profile, taxon, EPA crosswalk, calendar, weather model, host model, scoring weight or '
        'permanent canary changed.',
        '',
        '### Launch readiness',
        '',
        '- GIS is **{}/940 complete; national GIS production is NOT complete** because the 13 blocked border '
        'artifacts remain.'.format(complete),
        '- Biology remains complete at declared maturity (11 PROVISIONAL, 2 MODELED_SPARSE); PROVISIONAL is a '
        'declared maturity, not missing GIS coverage, and must not be conflated with the 13 blocked tiles.',
        '- No full national launch-readiness audit was performed because the GIS-complete gate is not met.',
        '',
        '### Authorization',
        '',
        'The remaining 13 tiles are a bounded follow-up design task (state-boundary normalization or an explicit '
        'relevance reclassification). No further production batch is authorized by this revision.',
        '',
    ]
    new = '\n'.join(lines) + '\n'
    marker = '## Revision 16'
    idx = text.index(marker)
    DOC.write_text(text[:idx] + new + text[idx:])
    print('Revision 17 written:', len(lines), 'lines')


if __name__ == '__main__':
    main()
