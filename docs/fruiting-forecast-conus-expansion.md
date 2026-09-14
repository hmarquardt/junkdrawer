# Fruiting Forecast CONUS expansion — authoritative handoff

Work in progress, 2026-09-14. Existing implementation notes describe the legacy app; this document records the expansion and supersedes conflicting coverage/offline claims.

## Decisions

- Preserve deterministic Indiana scoring. Split stable taxon identity from regional parameters, with explicit applicability and maturity. No universal Midwest fallback.
- EPA Level III polygon geography, simplified offline, supplies coordinate lookup. Profile mapping is data, not rectangular climate zones.
- Southern Rockies porcini is the first additional forecast target. Quantitative unsupported physiology remains missing; literature-based calendar/elevation evidence is provisional.
- Existing IndexedDB `FruitingForecastDB/cache` stores static tile bytes. Harden this path instead of adding another database. OPFS metadata alone must never skip registering actual Parquet bytes.
- Publication requires explicit per-layer status. Existing zero-row placeholders are UNBUILT, not verified empty.
- Collecting rules load independently of geometry; unverified rules remain UNKNOWN_VERIFY.

## Baseline

`npx playwright test tests/fruiting-forecast.spec.js --reporter=line --workers=2`: 7 passed (8.3 s), before changes.

## In progress

EPA geography preparation, regional biology contract and Southern Rockies source review; then coverage/cache/legal fixes and deterministic tests.

## Remaining / next task

Complete and test regional architecture first. National GIS bulk ingestion, historical occurrence aggregation and fire predictors are not yet implemented. Do not generate hundreds of service-sampled tiles. Current 955-land-tile catalog is addressing metadata, not evidence of data publication.

## Progress checkpoint (implementation, before final verification)

- All 7 Indiana baseline tests passed after regionalization.
- All 12 initial CONUS tests passed: 8 EPA representative locations, Indiana→Colorado→unsupported UI transition, deterministic elevation scoring, coverage semantics, cache version invalidation/storage failure.
- Full run: 65 passed, 1 skipped (opt-in live Princeton), 1 expected old-contract failure: malformed-rules test expected hidden geometry. Updated that assertion to require retained geometry and all UNKNOWN_VERIFY.
- Real Parquet publication integration test passes: checkpoint/resume byte determinism, missing layers, corrupted source retaining previous release, explicit verified-empty.
- EPA release supplied by EPA's current download page contains July 2015 shapefile members. Recorded archive checksum in generated geography. 85 Level III regions, simplification 0.01 degrees and 5-decimal coordinates, ~1.21 MB uncompressed. JS is the file-preview companion to authoritative JSON; only JS is downloaded by the app.
- Colorado UI screenshot reviewed. Removed misleading “exceptional” band from the sparse porcini model; it is explicitly “Provisional season/elevation.” Fixed pre-existing null-moisture comparison that described missing data as unfavorable.
- No national habitat/public-land/access tiles have been generated or fabricated. The bulk publisher consumes normalized source products; raw bulk adapters are still required.

## Files and contracts

- fruiting-forecast.html: FF-1.5.0; base taxon / regional-profile composition, EPA lookup, applicability suppression, saved regional configurations, sparse porcini elevation scorer, model diagnostics, safe IndexedDB byte cache, explicit coverage, independent rule errors.
- data/fruiting-forecast/ecoregions.json and generated ecoregions.js: identical EPA data (only JS loaded in browser for file preview); JSON is build/interchange artifact. Generation is explained in source headers.
- tools/build-fruiting-ecoregions.py: union EPA parts by code, transform original CRS to WGS84, topology-preserving per-region simplification, deterministic rounding. Adjacent simplified polygons can have small gaps/overlaps; unmatched coordinates remain unsupported.
- data/fruiting-forecast/biology-research.json: inspectable candidate/source decisions. Only rubriceps is added to scored taxa.
- data/fruiting-forecast/manifest.json: schema 4, PARTIAL / UNBUILT legacy audit and biology descriptor. GIS source release version retained because bytes were not rebuilt; biology version is independent.
- tools/build-fruiting-gis.py: new build dispatch and explicit PAD-US HTTP/service-error handling. Legacy sampling remains with its old limitations.
- tools/fruiting_tile_publish.py: network-free publication boundary. Per-layer source sidecars, schema/count checks, checksums, content-addressed assets, atomic manifest replacement after each layer, incremental merge and lock.
- tests/fruiting-forecast-conus.spec.js and tests/test_fruiting_tile_publish.py: deterministic regional/cache/empty/rule-outage and real-Parquet publication tests.
- Existing About and huntability regressions updated for populated count / retained geometry.
- junk-drawer.json and footer: 2026.09.14.1.
- Existing FruitingForecastDB/cache ownership already registered in Storage Manager. No new DB/store or persistent app introduced.

## Rebuild commands

From repository root. Preparation Python only; no browser/server dependency:

    curl -L --fail -o /tmp/us_eco_l3.zip https://dmap-prod-oms-edc.s3.us-east-1.amazonaws.com/ORD/Ecoregions/us/us_eco_l3.zip
    uv run --with pyshp --with shapely --with pyproj tools/build-fruiting-ecoregions.py /tmp/us_eco_l3.zip
    uv run --with duckdb --with requests tools/build-fruiting-gis.py build conus --plan
    uv run --with duckdb --with requests tools/build-fruiting-gis.py build bbox -108 37 -105 40 --layer habitat --plan
    uv run --with duckdb --with requests tools/build-fruiting-gis.py build tile n38_w088 --source-dir /path/to/normalized --output /tmp/ff-publish --resume
    uv run --with duckdb --with requests tools/build-fruiting-gis.py build state Indiana --state-bounds /path/to/state-bounds.json --source-dir /path/to/normalized --layer public-land --resume
    uv run --with duckdb tests/test_fruiting_tile_publish.py

State bounds: JSON object with state names and authoritative west/south/east/north bounds. State mode selects intersecting tiles, not state-clipped polygons. CONUS plan selects 955 approximate catalog land tiles, 2,865 jobs for three layers, zero network requests. The catalog omits some small/coastal land areas; use bbox/tile until a definitive national footprint replaces it.

Normalized inputs: habitat/<tile>.parquet, pl/<tile>.parquet, ap/<tile>.parquet, each with <tile>.parquet.json sidecar containing datasetVersion, sourceUrl, status. Use existing browser row schemas, WGS84, correct units (habitat elevation feet; Open-Meteo elevation meters), null missing values. VERIFIED_EMPTY requires a successful complete source query and zero-row schema-correct Parquet. AVAILABLE requires completeness review; legacy samples remain PARTIAL. Missing input stays UNBUILT; invalid input becomes FAILED or records a failed attempt alongside intact prior evidence.

Locking prevents concurrent manifest lost updates. After SIGKILL, verify the PID in .publish.lock is dead before removing the lock and resuming. Normal interruption cleans it automatically. Old content-addressed assets remain intentionally available; future release cleanup must only remove files unreferenced by retained manifests.

**Do not run the legacy default sampler for full CONUS.** It still uses per-point remote services and region-wide side products; the new publisher does not convert raw source datasets.

## Regional model maturity

| Profile | Targets / status |
|---|---|
| Central & Eastern Hardwood | Seven legacy targets, original numerical behavior; PROVISIONAL |
| Appalachians / Ozarks | Same seven, provisional transfer preserving Ohio/Tennessee corridor; independent validation pending |
| Southern Rockies | B. rubriceps only; PROVISIONAL season/elevation screening, not calibrated weather forecasting |
| Pacific Northwest Maritime | Assigned; unsupported forecasting; candidates researched |
| California Mediterranean | Assigned; unsupported forecasting; live-oak chanterelle / regional porcini candidates |
| Northern Rockies / Interior Mountains | Assigned; unsupported forecasting |
| Northern Forests / Great Lakes | Assigned; unsupported forecasting |
| Southeast / Coastal Plain | Assigned; unsupported forecasting |
| Great Plains | Assigned; unsupported forecasting |
| Southwest / Arid Interior | Assigned; unsupported forecasting |

EPA crosswalk is explicit data in HTML, not coordinate rectangles. Southern Rockies = EPA 21. Unmatched polygons/coordinates are unsupported. Search center chooses biology; mixed-region radius searches still need per-sector/profile arbitration.

### Porcini assertions and limits

[Arora & Frank 2014](https://doi.org/10.2509/naf2014.009.006) supports July–September summer-storm fruiting in montane conifer habitat, mainly spruce, with pine and possibly fir. It documents recreational/commercial importance, justifying addition. The 8,000–12,000-foot plateau / 3,000-foot soft falloff is an explicitly provisional engineering host-belt approximation informed by qualitative high elevation and the type locality; **not a measured species range**. Elevation carries 30/100 model weight. Weather thresholds, host GIS and observation ID remain missing. A high sparse score means matching season/elevation, not fruiting probability; confidence is discounted and the band describes that limited model.

Legacy numeric settings remain operational hypotheses for regression continuity. Their source URLs support ecology, not every coefficient. No profile is VALIDATED.

## Historical occurrence prior: reproducible design / interface

Use a cited, fixed GBIF occurrence download with DOI and predicate JSON, not browser searches. Official [download documentation](https://techdocs.gbif.org/en/data-use/api-downloads) and [formats](https://techdocs.gbif.org/en/data-use/download-formats) define reproducible exports. Authentication belongs only in offline preparation.

1. Curate taxon-ID mappings with synonym/version provenance; never combine all Boletus or Craterellus into one target.
2. Reject invalid coordinates, geospatial issues, unsuitable obscured/generalized locations and excessive/unknown uncertainty from strong support. Keep exclusion counts; exclusions are not absences.
3. Join to the same EPA polygons; aggregate species × ecoregion then profile. Deduplicate occurrence IDs and known cross-published records.
4. Publish counts, distinct years, dataset counts, time span, filter counts, DOI and geography/taxon versions. No observer identities or point coordinates.
5. Contract: status, records, distinctYears, sourceUrl. Implemented historicalPlausibility() labels repeated documentation at ≥3 records over ≥2 years. This engineering label is not statistical occupancy. Sparse/zero/missing records impose **zero absence penalty**.
6. Prior, current 21-day reports and weather remain distinct. No historical dataset has been built or included in scores.

## Fire ecology: source and interface

[MTBS](https://www.mtbs.gov/) maps perimeters/severity from 1984 onward. [USGS product documentation](https://burnseverity.cr.usgs.gov/products/mtbs) and [mapping methods](https://www.mtbs.gov/mapping-methods) describe national/state bulk products. It covers large mapped fires, not every disturbance; absence of a polygon cannot mean no fire.

The implemented interface accepts status AVAILABLE, fireYear, sourceUrl, perimeterId, severity, preFireForest, elevationM, snowmeltDate; derives years since fire, retains unknown attributes as null and returns null for unavailable/invalid evidence. No burn suitability score, national burn tiles or validated proof-of-concept is shipped. Rubriceps disturbance weight is zero. A burn-morel profile must provide sourced responses and substantial disturbance weight after validating a real fire. Idaho/Montana prior-year spruce/fir research supports research design, **not Colorado validation**.

## Source datasets / versions

- EPA: current official [Level III download page](https://www.epa.gov/eco-research/level-iii-and-iv-ecoregions-continental-united-states); archive members dated 2015-07-17; exact SHA256 in JSON.
- Existing NLCD/canopy, forest group, SSURGO, 3DEP and PAD-US samples remain as recorded in manifest / implementation notes. Edition claims were not freshly audited. Hosted PAD-US edition remains uncertain.
- Preferred adapters: local NLCD land-cover/canopy rasters; existing national forest-group raster; NRCS bulk SSURGO surveys; local 3DEP; official PAD-US national/state release; OSM regional PBF extracts. Pin versions and distinguish failed processing from valid empty output.
- No national GIS release, occurrence DOI export or MTBS subset published in this pass.

## Known limitations / remaining work

1. Colorado is deliberately sparse: one scored species, no thermal/rain response or spruce-host tiles. This is concrete progress, **not completion of the strong Colorado milestone**.
2. Colorado chanterelles, natural/burn morels, matsutake, regional puffballs and lobster are researched candidates, not forecast models. Lobster Colorado relevance was not established from sufficient primary evidence.
3. Seven geographic profiles have no forecasts; keep unsupported until sourced assertions exist.
4. Raw bulk adapters, source completeness validation and national generation remain pending. Publisher validates minimal schema/counts, not scientific correctness or clipping.
5. Search-center regionalization needs boundary-crossing sector treatment.
6. Old broad Indiana legal rules use manager/type labels without state IDs. Before publishing interstate PAD-US assets, add authoritative jurisdiction fields and constrain state rules. Do not generalize Indiana permission.
7. OPFS remains experimental legacy infrastructure. Actual evidence always registers bytes; metadata-only VERIFIED cannot bypass registration. Engine availability still limits offline reuse.
8. Manifest cache can persist one hour. Force refresh rechecks it. Legacy assets lacking per-asset version use global version; publisher sidecars supply specific versions.
9. Approximate land catalog, independent polygon simplification and profile crosswalk need boundary-focused review.
10. History/weather cache writes beyond the hardened GIS byte cache may still fail during quota exhaustion.

## Final verification (2026-09-14)

    npx playwright test tests/fruiting-forecast.spec.js tests/fruiting-forecast-gis.spec.js tests/fruiting-forecast-huntability.spec.js tests/fruiting-forecast-access-theme.spec.js tests/fruiting-forecast-openrouter.spec.js tests/fruiting-forecast-about.spec.js tests/fruiting-forecast-conus.spec.js --reporter=line --workers=3

**68 passed, 1 skipped, 37.4 seconds.** Only opt-in live Princeton skipped. Existing real DuckDB/Parquet geometry tests ran and passed. Includes 15 added CONUS tests, Indiana regression, correct geometry retention on malformed rules, and unsupported-map transition. Chrome required execution outside the filesystem sandbox; earlier launch failures were environment failures before page code ran.

    uv run --with duckdb tests/test_fruiting_tile_publish.py

**1 integration test passed** (last run 0.048 seconds), covering four publication scenarios. Actual run used an already installed uv environment's Python with DuckDB; the portable equivalent is above.

    python3 -m py_compile tools/build-fruiting-gis.py tools/fruiting_tile_publish.py tools/build-fruiting-ecoregions.py
    .agents/skills/junkdrawer-compliance-audit/scripts/audit.sh fruiting-forecast.html
    git diff --check

Python compilation passed. Deploy audit: **0 errors, 0 warnings**. Diff whitespace check passed. Colorado desktop screenshot reviewed at /private/tmp/ff-colorado.png; existing suite also exercised mobile themes/layout. No user-owned pre-existing untracked files were included.

## Exact next recommended task

Finish the Southern Rockies milestone before generating national tiles: resolve specimen-backed regional chanterelle taxa and natural versus burn-morel groups; obtain sources for their seasonal/host/elevation assertions; add regional models with explicitly missing uncalibrated physiology. In parallel as a subsequent implementation step, add local conifer-host/elevation sampling from pinned national rasters for one Colorado tile and feed it through the tested publisher. Validate Colorado species ordering against deterministic wet/dry, elevation and seasonal cases without copying Midwest numeric thresholds. Jurisdiction-scope the old Indiana rules before publishing any new interstate public-land geometry.
