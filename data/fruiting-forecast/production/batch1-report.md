# Fruiting Forecast National GIS Batch 1

Batch 1 started from `92e968ede9df96312721b559d9a5a5c3062142cc`. The planner froze 301 incomplete tiles from 336 eligible tiles whose state-level prerequisites were ready; 35 were already complete. The derived states were AZ, CA, CO, FL, GA, ID, ME, MI, MT, OR, WA and WY. NM was not in the planner's ready eligible set at the checkpoint, despite the older planning estimate, so it was not added by hand.

## Result

- Requested/newly complete: **301 / 301**.
- National four-layer coverage: **336 / 940**; **604** remain.
- Layer work completed: 292 habitat, 292 public-land, 292 fire-history and 301 access layers.
- Execution was fully serial in 31 ten-tile-or-smaller checkpoints. Batch 2 was not started.
- Total elapsed wall clock since the first attempt: **70,058.6 s (19 h 27 m 39 s)**, including stopped time during SDA's scheduled maintenance window and operator-safe resumptions.
- Successful measured stage time: 28,201.9 s. DEM dominated at 19,066.5 s (median 66.0 s/tile; p75 89.1); soil 1,039.7 s; habitat 421.8 s; public land 1,047.2 s; fire 362.9 s; access 2,317.3 s; phase-A publication 2,974.2 s; phase-B publication 972.4 s.
- Hosted-service request time was 1,907.8 s and overlaps the stage totals. There were 15 bounded retries, all HTTP 500 from one high-complexity MTBS query; no 429 throttling was observed. The fixed query used deterministic pagination and bounded geometry precision.
- A scheduled SDA maintenance page interrupted ten tiles. Resume reused completed work after the maintenance period. Nine 49°N boundary tiles returned an empty SDA point result; the adapter now preserves those cells as unknown rather than inventing soil data. Earlier one-off public-land and partial DEM-download failures also recovered on resume.

## Storage and publication

- Initial migration: **250 objects / 28,189,181 bytes**, all uploaded and full-payload verified before cutover.
- Batch 1 uploads: **1,177 objects / 110,412,522 bytes**.
- Active manifest: **1,427 objects / 138,601,703 bytes**.
- Wrangler upload wall time: 3,102.3 s; post-upload verification: 705.9 s. Per-object Wrangler startup is material, so Batch 2 should use bucket-scoped R2 S3 credentials/client tooling if it can preserve the same full-payload verification and serialized manifest contract. Interactive Wrangler OAuth remains correct for recovery and administration.
- Full final audit: 1,427 valid, 0 missing, 0 corrupt, 0 publisher-ledger remote orphans. Seventeen local-only content-addressed artifacts remain and were not deleted automatically. Wrangler 4.133.0 cannot exhaustively list bucket objects, so orphan scope is the append-only publisher ledger.
- DEM downloads: 290 downloads / 13,585,638,384 bytes / 18,949.1 s; 13,647,282,109 bytes reclaimed after dependent publication. Peak additional DEM cache was 494,513,115 bytes. Minimum observed free disk was 12,649,365,504 bytes; peak observed volume-use swing was 4,904,349,696 bytes. Volume figures include unrelated machine activity.

## Browser delivery

The deployed GitHub Pages app loaded its manifest from `https://hmarquardt.github.io/junkdrawer/` and immutable Parquet from `https://data.hanksjunkdrawer.com/`. Real Chrome/DuckDB-Wasm cold/warm tests passed on newly completed PNW, California, Southern Rockies, Plains, cold-basin and warm-desert tiles. Cold lookups made three or four R2 Parquet requests (three where fire is verified empty); immediate warm lookups made zero additional Parquet requests. SHA-256/length checks, CORS and SQL passed with no console/page errors. Suggested starts were returned only from eligible, unrestricted mapped evidence.

## Projections

Across 336 complete tiles, four-layer bytes total 136,020,076: mean 404,822 bytes/tile, median 304,788, p25 148,991, p75 508,178 and p90 887,298. Layer totals are habitat 5.38 MB, public land 36.03 MB, fire 83.46 MB and access 13.73 MB. The profile-weighted national projection is **328.9 MB**; the simple mean projection is 380.5 MB. The measured p25/p75 scenarios are **140.1–477.7 MB** and describe tile-size spread, not confidence bounds.

The measured median-stage serial projection is **23.54 h for all 940 tiles**, or **15.12 h for the remaining 604**. The p75-stage projection is 31.20 h total / 20.05 h remaining. These exclude future state preparation and should be combined with a fresh preflight rather than treated as a schedule guarantee.

Cost estimates assume four searches/user/month, nine tiles/search, four objects/tile and 50% of reads avoided by warm browser cache: 72 Class B reads/user/month. That is 7,200, 72,000 and 720,000 reads at 100, 1,000 and 10,000 monthly users. Projected national storage is 0.329 GB. In isolation all three cases fit R2's documented monthly free allowances (10 GB storage, 10 million Class B reads); the allowance is shared across the account. Egress is free. Edge caching was not assumed, so `CF-Cache-Status: DYNAMIC` is acceptable. A narrow immutable-Parquet cache rule may reduce origin reads but is not currently necessary; no Worker is warranted.

## Next batch design

The measured bottleneck supports **two concurrent DEM/local-compute workers**, with SDA/other hosted-service calls, R2 uploads, manifest mutation and checkpoints kept serial. This can overlap the dominant download wait while limiting disk and service pressure. The final planner state yields a 309-tile central/eastern candidate Batch 2 and 295 tiles for later Batch 3, documented in `remaining-batches.json`. The Batch-2 pass must prepare its named state cohort, rerun the planner and freeze the exact tile list before any build. Only Batch 2 is the next authorized production pass.

Biology remained frozen: 13 profiles, 11 PROVISIONAL, 2 MODELED_SPARSE, 0 UNSUPPORTED. No profile, taxon, crosswalk, calendar, weather model, host model, scoring weight or permanent canary changed.
