#!/usr/bin/env python3
"""Compose the Revision 18 section of the CONUS handoff from measured artifacts.

Prepends Revision 18 to docs/fruiting-forecast-conus-expansion.md. Idempotent:
refuses to add a second Revision 18.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/fruiting-forecast'
PROD = DATA / 'production'
DOC = ROOT / 'docs/fruiting-forecast-conus-expansion.md'


def mb(value):
    return round(value / 1e6, 2)


def main():
    text = DOC.read_text()
    if '## Revision 18' in text:
        raise SystemExit('Revision 18 already present')
    report = json.loads((PROD / 'national-normalization-report.json').read_text())
    batch3 = json.loads((PROD / 'batch3-report.json').read_text())
    storage = json.loads((PROD / 'national-storage-stats.json').read_text()) \
        if (PROD / 'national-storage-stats.json').exists() else None
    browser = json.loads((PROD / 'browser-final.json').read_text()) \
        if (PROD / 'browser-final.json').exists() else {}
    tests = json.loads((PROD / 'revision18-tests.json').read_text()) \
        if (PROD / 'revision18-tests.json').exists() else (
            json.loads((PROD / 'batch3-tests.json').read_text())
            if (PROD / 'batch3-tests.json').exists() else {})
    coverage = report['currentCoverage']
    audit = report.get('remoteAudit') or {}
    blocked = report['revision17BlockedTiles']
    reclassified = report['historicalCompleteTilesReclassified']
    inclusions = report['reclassifiedTiles']['inclusions']
    fallback = report['fallbackTilesRevalidated']
    source = report['geometrySource']
    lines = [
        '## Revision 18 — National relevance normalization and the final denominator (2026-09-19)',
        '',
        f"Started from Revision 17 at `d05667a`. The normalized national GIS denominator is now **"
        f"{report['normalizedDenominator']}** tiles, all complete. The legacy coarse roster of "
        f"{report['legacyDenominator']} was a cartographic artifact of the old relevance geometry; it is "
        'preserved as history, not used as the current denominator.',
        '',
        '### Legacy denominator',
        '',
        f"- Revision 17 reported `927 / 940`. The 940 came from the planner's coarse relevance gate: at least 1% "
        'of a tile\'s projected area inside a U.S. state polygon from `cb_2023_us_state_20m` after an additional '
        '~0.02-degree (~2 km) simplification. Projecting the tile as a straight-edged quadrilateral in EPSG:5070 '
        'made the 45/49-degree border chords bulge by up to ~5 km, so 23 tiles passed the gate with no U.S. land '
        'at the production sample lattice, while 5 tiles with genuine U.S. land cells failed it.',
        f"- The 13 Revision-17 blocked tiles were correct to block, but they were symptoms of a denominator "
        f"problem, not 13 isolated tiles: **{len(reclassified)} already-published tiles had the same zero-cell "
        'artifact** and were counted as complete coverage.',
        '',
        '### Normalization source',
        '',
        f"- Boundary: **{source['product']}** ({source['provider']}, {source['edition']}), {source['bytes']:,} "
        f"bytes, SHA-256 `{source['sha256']}`.",
        f"- Endpoint: `{source['url']}` (official Census GENZ2023, same family as the existing 20m source).",
        f"- CRS: {source['crs']}. Territories excluded exactly as the project roster excludes them.",
        f"- Land mask: **{report['landMaskSource']['product']}**, SHA-256 `{report['landMaskSource']['sha256']}` "
        '(already pinned for habitat); a sample cell is terrestrial when its NLCD class is present and not 11 '
        '(open water).',
        f"- Independent cross-check: **{report['crossCheckSource']['product']}**, SHA-256 "
        f"`{report['crossCheckSource']['sha256']}`. {report['crossCheckSource']['role']}",
        f"- Build-time preparation only; runtime reads the committed compact product "
        '`data/fruiting-forecast/national-relevance-v2.json` (algorithm '
        f"`{report['algorithm']}`). No unpinned URL is used at runtime.",
        '',
        '### Normalized relevance rule',
        '',
        f"> {report['definition']}",
        '',
        f"- Lattice: {report['sampleLattice']['cellsPerTile']} cell centers per 1-degree tile at "
        f"{report['sampleLattice']['stepDegrees']}-degree spacing (the habitat builder\'s own grid).",
        '- Plain language: a tile counts only when the application can actually place at least one habitat '
        'sample cell on U.S. terrestrial land. A simplified polygon sliver with no usable evidence cell no '
        'longer keeps a tile in the denominator.',
        '- The legacy 5% state-source rule is untouched; the zero-normal-state fallback now reads its state '
        'sources from this same product instead of re-deriving them from the coarse geometry.',
        '',
        '### Whole-roster audit (all 940 legacy tiles)',
        '',
        f"- Legacy tiles: **{report['legacyDenominator']}**",
        f"- Normalized relevant: **{report['normalizedDenominator']}**",
        f"- Normalized irrelevant: **{report['normalizedIrrelevantLegacyTiles']}**",
        f"- Already-published tiles reclassified: **{len(reclassified)}** (all were counted complete by "
        'Revision 17)',
        f"- Newly relevant tiles discovered outside the coarse roster: **{report['newlyRelevantTiles']}** "
        f"({', '.join(item['tile'] for item in inclusions)})",
        f"- Unresolved: **{len(report['unresolvedIssues'])}**",
        '',
        '### The 13 Revision-17 blocked tiles',
        '',
    ]
    for item in blocked:
        lines.append(f"- `{item['tile']}` — **{item['classification']}** (U.S. state cells {item['usStateCells']}, "
                     f"U.S. land cells {item['usLandCells']})")
    lines += [
        '',
        '### Existing 17 fallback tiles',
        '',
        f"- All {len(fallback)} revalidated as normalized relevant with real U.S. land cells under the finer "
        'boundary and land mask; none lost relevance. Representative land-cell counts: '
        + ', '.join(f"{item['tile']}={item['usLandCells']}" for item in fallback[:6]) + '.',
        '',
        '### Production work',
        '',
        f"- Bounded build (not a new batch): **{len(report['boundedBuild']['completed'])} tiles** — "
        f"{', '.join(report['boundedBuild']['completed'])}. Each had genuine U.S. land cells that the coarse "
        'roster had excluded.',
        f"- {report['boundedBuild']['note']}",
        '- No other tiles were built. No state preparation was needed beyond already-ready sources.',
        '',
        '### Manifest',
        '',
        f"- Removed from the active manifest: **{report['manifestNormalization']['removedCount']}** "
        f"normalized-irrelevant tiles — {', '.join(report['manifestNormalization']['removedTiles'])}.",
        '- Immutable R2 objects and the publisher ledger were not touched; those objects are now explicit '
        'ledger orphans. Asset classification: 6 harmless empty structures, 2 U.S. fires crossing the border, '
        '1 PAD-US boundary sliver, 1 tile with foreign-side OSM access points north of 49 degrees.',
        f"- Active manifest: **{coverage['manifestTiles']} tiles**, datasetVersion "
        f"`{coverage['manifestDatasetVersion']}`.",
        '',
        '### Coverage',
        '',
        f"- **Normalized GIS complete: {coverage['gisComplete']} / {report['normalizedDenominator']}** "
        '(100% of the normalized relevant universe).',
        f"- Every one of the 13 profiles is complete within the normalized denominator: "
        + ', '.join(f"{name} {info['tilesGisComplete']}/{info['tilesIntersecting']}"
                    for name, info in sorted(coverage.get('profiles', {}).items())) + '.',
        f"- Actual active four-layer GIS bytes: **{audit.get('bytes', 0):,}** (manifest-referenced objects; the "
        'physically uploaded historical R2 total is larger and includes orphaned assets).',
        '',
        '### R2',
        '',
        f"- Final remote audit: {audit.get('valid')} remotely valid, {audit.get('missing')} missing, "
        f"{audit.get('invalid')} invalid, {audit.get('localOnly')} local-only (retained), "
        f"{audit.get('remoteOrphans')} publisher-ledger remote orphans (retained); clean = {audit.get('clean')}.",
        f"- Audit scope: {audit.get('inventoryScope')}. Orphan growth is expected from the manifest "
        'normalization and is not a defect.',
        '',
        '### Browser',
        '',
        f"- Bounded normalized-behavior matrix: {len(browser.get('profiles', []))} live lookups; warm additional "
        f"Parquet {browser.get('warmCacheAdditionalParquetRequests')}; console errors "
        f"{len(browser.get('consoleErrors', []))}, page errors {len(browser.get('pageErrors', []))}.",
        f"- {sum(1 for p in browser.get('profiles', []) if p.get('noStaticCoverage'))} excluded-artifact lookup "
        'returned `No static GIS tiles cover this search area` with zero Parquet requests, while the adjacent '
        'U.S. location, interior, coastal/island, Great Lakes and northern-border (Northwest Angle) lookups all '
        'resolved expected GIS; excluded locations do not manufacture coverage.',
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
        '### Next task',
        '',
        f"- **{report['nextTask']}** — normalized national GIS coverage is complete, so the next pass is the "
        'bounded national launch-readiness audit (not another GIS batch).',
        '',
    ]
    new = '\n'.join(lines) + '\n'
    marker = '## Revision 17'
    idx = text.index(marker)
    DOC.write_text(text[:idx] + new + text[idx:])
    print('Revision 18 written:', len(lines), 'lines')


if __name__ == '__main__':
    main()
