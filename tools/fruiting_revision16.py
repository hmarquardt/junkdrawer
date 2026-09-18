#!/usr/bin/env python3
"""Compose the Revision 16 section of the CONUS handoff from measured artifacts.

Prepends a Revision 16 section to docs/fruiting-forecast-conus-expansion.md using
production/batch2-*.json, remote-audit.json and batch3-scope.json. Idempotent: refuses
to add a second Revision 16.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/fruiting-forecast'
PROD = DATA / 'production'
DOC = ROOT / 'docs/fruiting-forecast-conus-expansion.md'


def mb(b):
    return round(b / 1e6, 2)


def sec(src, path):
    if not path.exists():
        return None
    return {'source': src, 'value': json.loads(path.read_text())}


def main():
    text = DOC.read_text()
    if '## Revision 16' in text:
        raise SystemExit('Revision 16 already present')
    report = json.loads((PROD / 'batch2-report.json').read_text())
    analysis = json.loads((PROD / 'batch2-final-analysis.json').read_text())
    storage = json.loads((PROD / 'batch2-storage-stats.json').read_text())
    audit = json.loads((PROD / 'remote-audit.json').read_text())
    b3 = json.loads((PROD / 'batch3-scope.json').read_text())
    prep = json.loads((PROD / 'batch2-state-prep.json').read_text())
    m = report['metrics']
    ce = analysis['concurrencyEffectiveness']
    rp = analysis['runtimeProjectionRemaining']
    ready_new = [c for c in prep['cohort'] if prep['states'][c]['soil'].get('status') == 'READY'
                 and prep['states'][c]['access'].get('status') == 'READY']
    reused = [c for c in prep['cohort'] if prep['states'][c]['soil'].get('reused')
              or prep['states'][c]['access'].get('reused')]
    layer = storage['layerTotals']
    lines = [
        '## Revision 16 — National GIS Batch 2 complete (2026-09-18)',
        '',
        f"Started from `{report['startingCommit']}`. **National GIS Batch 2 only** was executed; Batch 3 remains "
        'unauthorized and unstarted. The application and manifest remain at '
        '`https://hmarquardt.github.io/junkdrawer/`; immutable content-addressed Parquet is served from R2 at '
        '`https://data.hanksjunkdrawer.com/`. No Worker, VM, API service, backend or database was added.',
        '',
        '### Starting state',
        '',
        f"- Verified start: Revision 15 closed at `a0e02c9`; Batch-2 tooling was committed at "
        f"`{report['startingCommit']}` two commits later (one unrelated Junkdrawer page plus the Batch-2 runner). "
        'No Fruiting Forecast production file changed between `a0e02c9` and the scope freeze; the difference is '
        'recorded rather than assumed away.',
        f"- National four-layer coverage before Batch 2: **{report['coverageBefore']['tilesGisComplete']} / "
        f"{report['coverageBefore']['relevantLandTiles']}**.",
        '',
        '### State preparation',
        '',
        f"- Requested cohort: 19 states — {', '.join(prep['cohort'])}.",
        f"- Ready after preparation: **{len(ready_new)} / 19**; verified caches reused: {len(reused)} (Alabama soil "
        'was already READY; every other state-level prerequisite was prepared in this pass).',
        f"- Measured preparation time: **{prep['totalSeconds']:,} s** total (SDA soil plus Geofabrik PBF download, "
        'validation and osmium extraction per state, strictly serialized). Duration is dominated by PBF downloads '
        'and extraction; soil attribute queries are seconds each.',
        '- Restartable and idempotent: a READY state revalidates and reuses; a failed refresh never overwrites '
        'verified bytes.',
        '',
        '### Frozen Batch 2',
        '',
        f"- Planner-derived, frozen in `production/batch2-scope.json`: **{report['frozenTiles']} tiles** "
        f"(eligible {json.loads((PROD / 'batch2-scope.json').read_text())['eligibleTiles']}, "
        f"already complete {json.loads((PROD / 'batch2-scope.json').read_text())['alreadyComplete']}).",
        f"- Derivation criteria: every incomplete tile whose required states are all READY for both soil and OSM "
        'preparation. The planner, not a hand list, is authoritative.',
        f"- Revision 15 estimated 309. The {report['frozenTiles']}-tile result differs because 30 incomplete tiles "
        'have no state at or above the planner 5% source threshold; the production runner cannot resolve soil '
        'states for such tiles, so they were never buildable in this pass. Criteria were not adjusted to '
        'reproduce 309.',
        '',
        '### Execution',
        '',
        f"- Two concurrent local/DEM tile workers (`tools/fruiting_batch2.py`), one serialized publisher lane, "
        f"{len(report['chunks'])} checkpoints of ten tiles or fewer.",
        '- Strictly serialized: SDA and all hosted per-tile services (PAD-US and MTBS ArcGIS), R2 publication, '
        'manifest mutation, publisher-ledger mutation, journal writes and git checkpoints. Only DEM download and '
        'local per-tile computation overlap.',
        f"- Newly complete: **{report['newlyComplete']} / {report['frozenTiles']}** frozen tiles; "
        f"{len(report['frozenRemaining'])} remaining in the frozen set ({', '.join(report['frozenRemaining']) or 'none'}).",
        f"- Hosted-service retries observed: {m.get('retries') or 'none'} "
        f"({m.get('hostedRetryCount', 0)} retry events total). No failed request produced neutral or invented "
        'evidence; missing stayed missing.',
        '- Two real defects surfaced under Batch-2 load and were fixed without touching biology: (1) an invalid '
        'source ring crashed the OSM access phase with a GEOS side-location conflict on a KY/TN boundary tile; the '
        'adapter now repairs topology at every load site (`make_valid`), which changes geometry validity only, '
        'never mapped evidence. (2) An ArcGIS-hosted quota response arrived as HTTP 200 with a body-level 429, '
        'killed a builder worker and hung the checkpoint queue on `work.join()`; the adapter now retries '
        'body-level 429/5xx with bounded backoff (honoring the service retry hint) on a paced hosted lane, and a '
        'failed tile is recorded and no longer hangs or kills the queue. Both fixes are regression-tested.',
        '- Published checkpoints stayed resumable: each checkpoint was generated by the runner only after '
        're-reading the manifest and confirming zero incomplete tiles in the chunk, then committed and pushed.',
        '',
        '### Result',
        '',
        f"- National four-layer coverage: **{report['nationalComplete']} / 940**; "
        f"**{report['nationalRemaining']}** remain.",
        f"- Exact remaining tiles for the next pass: **{b3['remainingRelevantTiles']}** relevant "
        f"({len(b3['buildableNow'])} buildable with current preparation, {b3['noStateThresholdTiles']['count']} with "
        f"no state above the source threshold, {b3['stateBlockedTiles']['count']} blocked on unprepared states).",
        '- **Batch 2 completion is not national completion: Fruiting Forecast is NOT nationally launch-ready.**',
        '',
        '### R2',
        '',
        f"- Batch-2 uploads (publisher ledger since the first metrics event): "
        f"**{report['r2'].get('uploadedObjects')} objects / {report['r2'].get('uploadedBytes'):,} bytes**; "
        f"{report['r2'].get('uploadIntents')} upload intents, "
        f"{report['r2'].get('verifiedReusedObjects')} objects verified and reused without re-upload. Scope: "
        f"{report['r2'].get('ledgerScope')}.",
        f"- Active manifest: **{audit['manifestReferences']} objects / {audit['manifestBytes']:,} bytes**.",
        f"- Final remote audit: {audit['remoteValid']} remotely valid, {audit['remoteMissing']} missing, "
        f"{audit['remoteInvalid']} invalid, {audit['localOnly']} local-only (reported, not deleted), "
        f"{audit['remoteOrphans']} publisher-ledger remote orphans.",
        f"- Audit scope is precise: {audit['inventoryScope']}. Wrangler cannot exhaustively list the bucket, so "
        'this is not a claim that the bucket contains no other objects.',
        '- Publication transport remained the proven Wrangler OAuth path. No bucket-scoped R2 S3 credentials were '
        'present in the environment (checked only through normal environment mechanisms; no values printed, no '
        'secret search performed), so the S3-compatible uploader was neither required nor benchmarked.',
        '',
        '### Performance',
        '',
        f"- Final authoritative pass wall time across checkpoints: **{ce['finalPassChunkWallSeconds']:,} s** for "
        f"{ce['newlyComplete']} tiles (**{ce['secondsPerTileFinalPass']} s/tile**). The full since-first-attempt "
        f"span was **{ce['sinceFirstAttemptSpanSeconds']:,} s** (**{ce['secondsPerTileSinceFirstAttempt']} s/tile**), "
        'including earlier interrupted generations, duplicate work and stopped time; it is not an execution rate.',
        f"- Batch 1 ran 301 tiles in {ce['batch1WallSecondsSinceFirstAttempt']:,} s wall "
        f"({ce['batch1TilesPerHourWall']} tiles/hour including stopped time) at "
        f"{ce['batch1SerialSecondsPerTile']} s/tile of fully serial stage time. Batch 2 completed "
        f"{ce['batch2TilesPerHourFinalPass']} tiles/hour in the final pass and "
        f"{ce['batch2TilesPerHourSinceFirstAttempt']} tiles/hour since first attempt.",
        f"- DEM median {m['stageStats']['dem']['median']} s/tile (p75 {m['stageStats']['dem']['p75']}) vs Batch-1 "
        f"serial median {ce['batch1DemMedianSeconds']} s/tile. Access median {ce['accessMedianSeconds']} s/tile "
        f"(p75 {ce['accessP75Seconds']}) vs Batch-1 {ce['batch1AccessMedianSeconds']} s/tile: dense eastern OSM "
        'access computation is materially heavier than the western Batch-1 tiles.',
        f"- Concurrency effectiveness: {ce['interpretation']}",
        f"- Bottleneck analysis: {analysis['bottleneck']['verdict']}",
        f"- R2 transport: {analysis['r2Transport']['mechanism']}; {analysis['r2Transport']['uploadedObjects']} "
        f"objects / {analysis['r2Transport']['uploadedBytes']:,} bytes uploaded in this batch, "
        f"{analysis['r2Transport']['verifiedReusedObjects']} objects verified and reused without re-upload, "
        f"publish lane busy {analysis['r2Transport']['publishBusySeconds']:,} s "
        f"({ce['publishUtilization']} utilization). {analysis['r2Transport']['note']}",
        f"- Resource floors: minimum free disk {m.get('minFreeDiskBytes'):,} bytes; peak DEM cache "
        f"{m.get('peakDemCacheBytes'):,} bytes; DEM downloads {m.get('demDownloads')} / "
        f"{m.get('demDownloadedBytes'):,} bytes; DEM bytes reclaimed "
        f"{m.get('demReclaimedBytes'):,}. The documented minimum-free-space guard stayed in force and was never "
        'lowered.',
        '',
        '### Projections',
        '',
        f"- National storage across {storage['completeTiles']} complete tiles: mean "
        f"{storage['meanBytesPerTile']:,} bytes/tile, median {storage['medianBytesPerTile']:,}, p25 "
        f"{storage['p25']:,}, p75 {storage['p75']:,}, p90 {storage['p90']:,}. Layer totals: habitat "
        f"{mb(layer['habitat'])} MB, public land {mb(layer['publicLands'])} MB, fire {mb(layer['fireHistory'])} MB, "
        f"access {mb(layer['accessPoints'])} MB. Profile-weighted national projection "
        f"**{mb(storage['profileWeightedNationalProjectionBytes'])} MB**; simple-mean "
        f"{mb(storage['simpleMeanNationalProjectionBytes'])} MB.",
        f"- Remaining runtime: two-worker expectation **{rp['twoWorkerExpectationSeconds'] / 3600:.2f} h** for the "
        f"{rp['remainingBuildableTiles']} currently buildable tiles, serial-equivalent "
        f"{rp['serialEquivalentSeconds'] / 3600:.2f} h. Components: DEM {rp['components']['demTwoWorker'] / 3600:.2f} h, "
        f"hosted {rp['components']['hostedSerialized'] / 3600:.2f} h, local compute "
        f"{rp['components']['localComputeTwoWorker'] / 3600:.2f} h, publication "
        f"{rp['components']['publicationSerialized'] / 3600:.2f} h; state preparation for "
        f"{rp['components']['statePreparationStates']} states is estimated separately at "
        f"{rp['components']['statePreparationEstimate'] / 3600:.2f} h from the measured Batch-2 per-state mean. "
        f"{rp['excludes']}",
        f"- R2 cost model (assumptions unchanged and explicit): {analysis['r2Cost']['note']} Projected national "
        f"storage {analysis['r2Cost']['nationalStorageGB']} GB (profile-weighted) / "
        f"{analysis['r2Cost']['nationalStorageGBSimpleMean']} GB (simple mean); ~72 Class B reads/user/month gives "
        '7,200 / 72,000 / 720,000 reads at 100 / 1,000 / 10,000 monthly users, all inside the account-shared free '
        'allowances in isolation. Edge caching was not configured and was not assumed; `CF-Cache-Status: DYNAMIC` '
        'remains acceptable and no Worker is warranted.',
        '',
        '### Batch-3 recommendation',
        '',
        f"- Next pass would be **National GIS Batch 3**: {len(b3['buildableNow'])} buildable tiles, requiring "
        f"preparation of {len(b3['statesNeedingPreparation'])} additional states "
        f"({', '.join(b3['statesNeedingPreparation'])}).",
        f"- Two workers are recommended again (the same bounded two-worker scheduler, one serialized hosted lane, "
        f"one serialized publisher). Measured bottleneck: {analysis['bottleneck']['verdict']}",
        '- Batch-2 evidence argues for keeping the phased A/B execution but measuring an A/B pipeline in Batch 3: '
        'phase A is DEM/network-bound while phase B is CPU-bound OSM access, so the two phases currently alternate '
        'rather than overlap. This is a recommendation for measurements, not a change made in this pass.',
        '- No R2 transport change is justified without measurement; Wrangler remained correct, serialized and '
        'remote-verified on every object.',
        f"- The {b3['noStateThresholdTiles']['count']} no-state-threshold tiles are a planner/runner design "
        'question, not a data-preparation task, and are documented in `production/batch3-scope.json` rather than '
        'silently excluded.',
        '',
        '### Biology',
        '',
        'Biology is unchanged and was asserted before and after: **13 profiles, 11 PROVISIONAL, 2 MODELED_SPARSE, '
        '0 UNSUPPORTED**. No profile, taxon, EPA crosswalk, calendar, weather model, host model, scoring weight or '
        'permanent canary changed.',
        '',
        '### Authorization',
        '',
        'The next possible production pass is **National GIS Batch 3**. Revision 16 does **not** authorize it and '
        'does not imply it has started. Batch 2 only is complete.',
        '',
    ]
    new = '\n'.join(lines) + '\n'
    marker = '## Revision 15'
    idx = text.index(marker)
    DOC.write_text(text[:idx] + new + text[idx:])
    print('Revision 16 written:', len(lines), 'lines')


if __name__ == '__main__':
    main()
