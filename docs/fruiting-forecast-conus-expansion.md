# Fruiting Forecast CONUS expansion — authoritative handoff

Work in progress, 2026-09-15. Existing implementation notes describe the legacy app; this document records the expansion and supersedes conflicting coverage/offline claims. Revision 2 recorded the Southern Rockies / Colorado milestone: four regional targets, the first real western bulk GIS publication, MTBS burn evidence, per-sector ecological arbitration and state-scoped collecting rules. Revision 3 completed the core habitat stack for Colorado: pinned Annual NLCD land cover and NLCD tree canopy adapters, a second independently built Colorado tile, explicit habitat component completeness, a robust national-source cache, and a tested gSSURGO adapter path. Revision 4 resolved real authoritative NRCS soil (SSURGO via Soil Data Access), unified the soil source contract so gSSURGO/gNATSGO packages are drop-in alternates, resolved per-tile 3DEP DEM releases, and executed a bounded 11-tile Colorado release. **Revision 5 proves the whole pipeline in a second state: New Mexico soil is prepared and consumed through the same contract with independent state caches, a real canary (Taos / Carson NF) and a three-tile northern New Mexico extension are published, cross-state soil is resolved point-by-point rather than by tile or search center, public-land identity and jurisdiction are conservative at the state line, MTBS identities survive cross-tile publication, and coverage metadata now separates administrative, ecological and layer dimensions.**

## Decisions

- Preserve deterministic Indiana scoring. Split stable taxon identity from regional parameters, with explicit applicability and maturity. No universal Midwest fallback.
- EPA Level III polygon geography, simplified offline, supplies coordinate lookup. Profile mapping is data, not rectangular climate zones.
- Every sector uses the biological profile of its own location. A search radius may cross an ecoregion boundary, so the search center never imposes its targets on other sectors. This is state-independent: the New Mexico extension is scored by EPA ecology, not by state, and neighboring EPA regions remain unsupported.
- Southern Rockies now has four provisional targets: Rocky Mountain king bolete (`Boletus rubriceps`), rainbow chanterelle (`Cantharellus roseocanus`), natural (non-burn) morels and burn morels. All four are PROVISIONAL, none VALIDATED.
- Western host evidence comes from mapped USDA FS FIA forest-type-group classes (spruce/fir, fir/spruce/mountain hemlock, lodgepole, ponderosa, Douglas-fir, aspen/birch). Eastern classes are unchanged and are never overloaded with western meaning; New Mexico additionally maps pinyon-juniper and western-oak classes without inventing signals or model weights for them.
- Missing physiology stays missing. Western targets carry no thermal or soil-moisture response because the reviewed sources do not support one; the declared weight is retained so missing evidence lowers confidence instead of being renormalised away.
- Qualitative precipitation is permitted but must be labelled: western targets use a declared engineering band (14-day accumulation, wet-day count, rain recency) with provenance stating it is not a measured threshold.
- Burn evidence comes from real MTBS burned-area boundaries published per tile. MTBS publishes no per-perimeter severity class, so severity is NULL and applies no penalty. Absence of a perimeter is never a negative biological signal; a disturbance-dependent target declares `requiresDisturbance` and an explicit `evidenceGapCap` so it cannot rank highly without fire evidence. A perimeter crossing a tile or state boundary keeps its stable `perimeter_id` and the browser deduplicates the biological event.
- Collecting rules are state-scoped. Rules declare `jurisdiction`, and a rule applies only when the property's jurisdiction is known and matches. Unknown jurisdiction keeps UNKNOWN_VERIFY. PAD-US `ST_Name` is unusable for jurisdiction (it reads "Not Applicable" for federal units), so jurisdiction is assigned by point-in-polygon against US Census state boundaries. A point inside the 0.02-degree simplification band of a state boundary is published as `jurisdiction_confidence = ambiguous-near-boundary` with no state, so geometry remains visible but no state-scoped rule can leak; properties outside every state are kept as `unresolved` for the same reason.
- Public-land identity is `sha1(property_name|manager|source_category|source_designation|state_code)`. PAD-US publishes no usable stable unit id (BndryID and ST_Name both read "Not Applicable"), so name alone must never merge two properties. One unit clipped into two same-state tiles keeps one identity and is deduplicated by the browser; the same name in two states is two legitimate jurisdiction-scoped records.
- Raw bulk adapters live in `tools/fruiting_bulk_adapters.py`: pinned source products are prepared once into a cache and sampled, queried or clipped locally, never re-downloaded per tile. Preparation scope is explicit: `prepare national` for national products, `prepare state` for soil, `prepare tile` for the per-tile 3DEP DEM.
- **Soil has one normalized contract regardless of upstream packaging**: `mukey -> {drainage_class, awc_25_cm, awc_50_cm, flood_frequency, hydrologic_group, slope_deg}`. The default 2026 source is the authoritative NRCS Soil Data Access (SSURGO) tabular service: one query per state for the mapunit attribute table and one batched point-to-MUKEY query per tile. A gSSURGO or gNATSGO state package is a drop-in alternate through the same contract. STATSGO2 gap filling is deliberately not applied, so coarse state-level data is never presented as survey-grade soil.
- **State soil caches are independent and restart-safe.** `ssurgo_sda:CO` and `ssurgo_sda:NM` are separate entries with their own normalized Parquet, query fingerprint, row count, survey vintages and MUKEY range; an unchanged ready state is reused without re-querying, a failed refresh of one state cannot invalidate another, and a tile build that crosses a line auto-includes a neighbouring prepared state only when that state's table actually contains one of the tile's resolved mukeys (an exact membership check, because MUKEY numeric ranges overlap).
- **3DEP DEM releases are resolved per tile** from the public TNM bucket listing; a single pinned national release date does not exist for every tile. A cached tile keeps the release it was fetched with, and the release is recorded in provenance. Mixed releases across the release are explicit, not silently normalized.
- Canopy is a separate signal from mapped forest type. `canopy` is NLCD Tree Canopy Cover stored as a 0..1 fraction; it can support "forest structure exists" but never substitutes for a spruce-specific mapped host class in the porcini/chanterelle models.
- Land cover is Annual NLCD, sampled at the 0.05-degree cell center. `forest`, `deciduous`, `open_land` reuse the legacy NLCD class mapping so eastern semantics are unchanged; `evergreen`, `mixed_forest` and `wetland` are additive western-era columns. Legacy tiles lack these fields and read them as NULL.
- Habitat completeness is explicit. `habitat.components` declares forestType/elevation/landCover/canopy/soil as AVAILABLE or UNBUILT; `habitat.status` is AVAILABLE only when every required component is present, and soil additionally reports AVAILABLE when real soil evidence was composed. A Parquet file existing is never completeness.
- The source cache is manifest-backed with version, bytes, SHA256 and a READY marker written only after download + validation. A corrupted or partial download is FAILED and is never treated as ready; large downloads resume from a `.part` file when the server supports ranges.
- Existing IndexedDB `FruitingForecastDB/cache` stores static tile bytes. Harden this path instead of adding another database. OPFS metadata alone must never skip registering actual Parquet bytes.
- Publication requires explicit per-layer status. A missing normalized source is UNBUILT, never verified empty.
- Collecting-rule and geometry loading stay independent.
- Coverage metadata keeps three dimensions separate: `publishedTiles` (every tile with a populated layer, including legacy), `coverageTiles` (release tiles whose habitat declares all components AVAILABLE), and `states` / `ecologicalProfiles` derived from pinned boundary bounding boxes. Administrative, ecological and layer availability are never conflated.
- The bounded release is 14 one-degree tiles in two states, not CONUS. Access points remain UNBUILT and the manifest and UI say so rather than inventing pins.

## Baseline

`npx playwright test tests/fruiting-forecast.spec.js --reporter=line --workers=2`: 7 passed (8.3 s), before changes.
Previous checkpoint (`271806c`): 79 browser tests passed, 1 opted-out live test skipped; 33 Python adapter tests and 2 publication integration tests passed.

## Completed in this pass (revision 5 — second state: New Mexico)

1. **Canary selection from EPA geometry, not a rectangle.** Tile/profile intersections were computed from the pinned EPA Level III polygons by point sampling: `n36_w107` is 86.2% Southern Rockies (13.8% Southwest; Taos, Carson NF, Wheeler Peak, Rio Grande del Norte), `n36_w106` is 64.2% Southern Rockies (33.1% Southwest, 2.7% Plains; Pecos/Santa Fe NF), `n35_w106` is 36.6% Southern Rockies (55.6% Plains, 7.6% Southwest; Santa Fe/Sandia). The canary is `n36_w107`; the bounded extension adds `n36_w106` and `n35_w106`. All three touch the existing Colorado release across the 37th-parallel line.
2. **Second-state soil preparation.** `prepare state --state NM` fetched one SDA attribute query for 4,550 New Mexico mapunits across 46 survey areas, survey vintage 2025-09-08/09, 417,573-byte response in 0.66 s, normalized to a 48 KB Parquet. Colorado was refreshed in place with the current 78-survey-area table (7,740 mapunits, vintage through 2025-09-19, 719,174-byte response in 0.74 s, 77 KB Parquet). A second unchanged `prepare` for either state returns `reused: true` without an SDA query. A failed New Mexico refresh leaves the Colorado entry READY and independent.
3. **Point-level cross-state soil.** A tile's 400 points resolve to mukeys through one batched query (18 KB request, 11.8 KB response, 400 rows, 3.6 s); each point is joined against its own state's attribute table. A caller building a boundary tile with `--soil-states CO` still gets New Mexico evidence for New Mexico points because any prepared state owning one of the tile's mukeys is included automatically and exactly (MUKEY ranges overlap between states, so a range test would be wrong). Missing mapunits and attributes stay NULL.
4. **Conservative jurisdiction at the state line.** The documented 0.02-degree simplification tolerance is now enforced: a property whose representative point lies within the tolerance of a state boundary is published with `jurisdiction_confidence = ambiguous-near-boundary` and no state instead of inheriting the neighbour's jurisdiction. Unresolved rows are kept (geometry visible) rather than dropped. Across the 14-tile release, 7,502 rows are authoritative, 51 are ambiguous-near-boundary and none contradict the rule.
5. **Public-land identity.** Property identity now includes manager, category, designation and the resolved state, and unresolved boundaries no longer vanish. The hosted PAD-US layer exposes no usable stable unit id, so this composite is the documented identity. Across the release no `property_id` maps to two states or names, and real cross-state units (`Rio Grande National Forest`, `Carson National Forest`, `Tres Rios Field Office`, ...) keep one identity while the same name in two states stays two records.
6. **MTBS identity across tiles and states.** Eleven release perimeters appear in more than one tile and two appear on both sides of the Colorado–New Mexico line; `perimeter_id` is stable, no tile duplicates an id internally, and the browser deduplicates the biological event.
7. **Bounded two-state release.** Fourteen tiles are published: the 11 Colorado tiles plus `n36_w107`, `n36_w106`, `n35_w106`. Every tile has all five habitat components AVAILABLE, public-land AVAILABLE and fire AVAILABLE; access stays explicitly UNBUILT. Soil coverage is 388–399 of 400 cells in the New Mexico tiles (better than the Colorado mountain tiles) and pinyon-juniper/shrup evidence gives the extension a distinct ecological signature.
8. **Coverage metadata.** `summary.publishedTiles` (54 tiles with any populated layer), `summary.coverageTiles` (the 14 complete release tiles, derived from components rather than hand-maintained), `summary.states` (16 states touched, including CO 13 and NM 6 tile intersections) and `summary.ecologicalProfiles` (southernRockies 14, southwest 10, plains 10, ...) are recomputed by the publisher on every checkpoint, with a `coverageSemantics` note and a test that the profile roster cannot drift from the browser's mapping.
9. **Tests.** 45 adapter tests (up from 33), 5 publication tests (up from 2) and 82 browser tests (up from 79, 1 opt-in skipped). New coverage includes state-scoped SDA preparation with independent caches and restart reuse, exact cross-state mukey inclusion, a failed point query that writes no cache and recovers, conservative jurisdiction and identity, a two-state release audit, a real interstate search with per-sector ecology and jurisdiction isolation, real cross-tile DuckDB identity reads, and deterministic browser dedupe fixtures for public land and fire.

## In progress

Nothing is committed mid-refactor. Revision 5 is complete and verified; the two-state release is deliberately bounded and must not be scaled to CONUS until more states and the access layer are proven.

## Remaining / next task

The pipeline is now proven in two states at point-level soil resolution with conservative jurisdiction and stable cross-tile identity. What remains before national generation: the OSM regional-PBF access adapter (design below), one more state or a larger multi-state batch to validate the state-scoped paths under load, and the Pacific Northwest biological region as the next model-development track. National GIS bulk generation, historical occurrence aggregation and a snowmelt dataset remain unimplemented.

## Progress checkpoint — previous revision (checkpoint `271806c`)

Kept for continuity; superseded by "Completed in this pass" above where they differ.

Revision 4 completion summary (commits `7c1020e`, `271806c`):

- Resolved authoritative NRCS soil through Soil Data Access: one state mapunit/attribute query plus one batched point-to-MUKEY query per tile; gSSURGO/gNATSGO packages (FileGDB, GeoPackage/SQLite, CSV) normalize to the same contract.
- Resolved 3DEP DEM releases per tile from the TNM bucket listing and built the bounded 11-tile Colorado release with five-component habitat, public land and fire; access explicitly UNBUILT.
- Manifest gained derived component coverage and the real `ssurgo_sda` descriptor; 33 adapter tests, 2 publication tests, 79 browser tests.

Revision 3 completion summary (commit `e48d02b`):

- Pinned Annual NLCD 2023 land cover (C1V2) and NLCD tree canopy 2021 v2021-4 with SHA256, legends and units; downloaded once, sampled locally per tile, canopy converted once to a 0..1 fraction.
- Added additive habitat fields `evergreen`, `mixed_forest`, `wetland` and `habitat.components` completeness; a tile is AVAILABLE only when forest type, elevation, canopy and land cover are present; soil was UNBUILT pending a real source.
- Built and published `n39_w106` (Summit/Eagle/White River NF) independently from raw sources and republished `n40_w106` with real canopy/land-cover evidence.
- Reworked the bulk CLI into `prepare national|state|tile` with a source-cache manifest, checksum-gated resumable downloads and READY markers; composed habitat in one build call; publisher summary gained available tiles and per-component coverage.
- 24 Python adapter tests, 2 publication tests, 26 CONUS browser tests; full run 79 passed, 1 skipped.

Earlier `e1ccb64`-era notes:

- All 7 Indiana baseline tests passed after regionalization.
- All 12 initial CONUS tests passed: 8 EPA representative locations, Indiana→Colorado→unsupported UI transition, deterministic elevation scoring, coverage semantics, cache version invalidation/storage failure.
- Full run: 65 passed, 1 skipped (opt-in live Princeton), 1 expected old-contract failure: malformed-rules test expected hidden geometry. Updated that assertion to require retained geometry and all UNKNOWN_VERIFY.
- Real Parquet publication integration test passes: checkpoint/resume byte determinism, missing layers, corrupted source retaining previous release, explicit verified-empty.
- EPA release supplied by EPA's current download page contains July 2015 shapefile members. Recorded archive checksum in generated geography. 85 Level III regions, simplification 0.01 degrees and 5-decimal coordinates, ~1.21 MB uncompressed. JS is the file-preview companion to authoritative JSON; only JS is downloaded by the app.
- Colorado UI screenshot reviewed. Removed misleading “exceptional” band from the sparse porcini model; it is explicitly “Provisional season/elevation.” Fixed pre-existing null-moisture comparison that described missing data as unfavorable.
- No national habitat/public-land/access tiles have been generated or fabricated. The bulk publisher consumes normalized source products; raw bulk adapters are still required.

## Files and contracts

- fruiting-forecast.html: FF-1.6.0; base taxon / regional-profile composition, EPA lookup, per-sector biology arbitration, applicability suppression, western host/elevation/precipitation/disturbance components, canopy + land-cover habitat evidence, evidence-gap rule, state-scoped collecting rules with conservative near-boundary jurisdiction, regional model evidence panel, habitat component completeness in About/diagnostics, safe IndexedDB byte cache, explicit coverage, independent rule errors. Mixed-schema tile reads use `union_by_name=true`; legacy eastern tiles and new western tiles load together. A property published as `ambiguous-near-boundary` or `unresolved` resolves to UNKNOWN_VERIFY without a Census fallback, so no state-scoped rule can leak across a simplified state line.
- data/fruiting-forecast/ecoregions.json and generated ecoregions.js: identical EPA data (only JS loaded in browser for file preview); JSON is build/interchange artifact.
- data/fruiting-forecast/states.json and generated states.js: US Census cartographic state boundaries (1:20,000,000, 2023), simplified to 0.02° (118 KB). Used **only** for collecting-rule jurisdiction. The 0.02-degree tolerance is now enforced in the adapter, not just documented: a property point within the band is published with `jurisdiction_confidence = ambiguous-near-boundary` and no state, and the browser honours that marker instead of falling back to the same simplified lookup.
- tools/build-fruiting-ecoregions.py: EPA Level III geography builder.
- tools/build-fruiting-states.py: US Census state geography builder (`window.FF_STATES`).
- tools/fruiting_bulk_adapters.py: raw bulk adapters. Pinned sources (forest type groups, Annual NLCD land cover, NLCD tree canopy, per-tile 3DEP, MTBS, PAD-US, Census states, and soil via NRCS Soil Data Access or a gSSURGO/gNATSGO state package); `prepare national|state|tile` prepares once into a manifest-backed cache, `build` composes a tile into publisher inputs. Soil uses one normalized contract keyed by MUKEY, state caches are independent and restart-reusable, and a tile auto-includes a neighbouring prepared state only on an exact mukey-membership match. Property identity and conservative jurisdiction live here. The forest-type-group legend is the authoritative product metadata legend; class 0 means "no forest type group mapped", never missing.
- data/fruiting-forecast/biology-research.json: 25 sources, 12 candidates, 4 southernRockies entries marked `implemented: true`. Every entry carries `supports` / `doesNotSupport` / `missing`. Revision 4 added the `ssurgoSda` source entry: soil is published as environmental evidence but no Southern Rockies model weights it, because the reviewed sources do not support a calibrated soil-moisture response.
- data/fruiting-forecast/manifest.json: schema 4 with publisher-recomputed `summary.layers` (populated / verifiedEmpty / unbuilt / failed, `available`, per-component coverage for habitat, consistent with tileCount), `summary.publishedTiles` (every tile with a populated layer), `summary.coverageTiles` (release tiles whose habitat declares every component AVAILABLE, derived rather than hand-maintained), `summary.states` and `summary.ecologicalProfiles` (pinned-boundary intersections, explicitly separate dimensions), retained human-readable coverage fields, `habitatSchema` and `publicLandSchema` descriptions (soil units, missing semantics, identity composite, jurisdiction confidence), and the biology descriptor.
- tools/build-fruiting-gis.py: legacy sampler plus `build` (publisher) and `bulk` (adapters) dispatch.
- tools/fruiting_tile_publish.py: network-free publication boundary. Four layers (habitat, public-land, access, fire), per-layer source sidecars, schema/count checks, checksums, content-addressed assets, atomic manifest replacement after each layer, incremental merge, lock, and completeness-aware summary maintenance.
- tests/fruiting-forecast-conus.spec.js: 29 deterministic tests: Colorado species cases, fire-evidence cases, geographic suppression, jurisdiction scoping, per-sector boundary arbitration, the bounded two-state 14-tile release declaration with digest checks, a real DuckDB-Wasm load of western tiles plus a legacy eastern tile (including soil differentiation and real cross-tile public-land/MTBS identity reads), deterministic cross-tile dedupe fixtures, a real interstate search with per-sector ecology and jurisdiction isolation, canopy/land-cover scoring behavior, and habitat completeness semantics.
- tests/test_fruiting_bulk_adapters.py: 45 deterministic tests for adapter contracts, the cache manifest/checksum/corruption path, the Soil Data Access and package soil paths (normalized contract, batched point join, ambiguity, explicit failure/empty, gSSURGO/FileGDB and gNATSGO/GeoPackage packaging equivalence), DEM release resolution, habitat composition with optional sources absent, state-scoped SDA preparation with independent caches/restart reuse and a failing refresh that cannot invalidate another state, exact cross-state mukey inclusion, failure/retry of a batched point query, property identity, legacy-tile backward compatibility, and the committed two-state release (component/layer completeness, real SSURGO values with explicit gaps, conservative jurisdiction, cross-tile MTBS identity, release-scope manifest assertions).
- tests/test_fruiting_tile_publish.py: 5 publication tests (incremental integrity/empty/failure, completeness components, coverage dimensions, profile-roster drift guard against the browser mapping, and coverage refresh on publication).
- junk-drawer.json and footer: 2026.09.15.1 (the browser gained the conservative jurisdiction-confidence handling and revision 5 published the New Mexico extension).

## Rebuild commands

From repository root. Preparation Python only; no browser/server dependency:

    curl -L --fail -o /tmp/us_eco_l3.zip https://dmap-prod-oms-edc.s3.us-east-1.amazonaws.com/ORD/Ecoregions/us/us_eco_l3.zip
    uv run --with pyshp --with shapely --with pyproj tools/build-fruiting-ecoregions.py /tmp/us_eco_l3.zip
    curl -L --fail -o /tmp/cb_2023_us_state_20m.zip https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_20m.zip
    uv run --with pyshp --with shapely --with pyproj tools/build-fruiting-states.py /tmp/cb_2023_us_state_20m.zip

Prepare the national products once, then the state soil attribute table once, then the per-tile DEMs, then compose and publish each tile. A prepared source is never re-downloaded per tile, and a DEM release is resolved per tile from the TNM bucket listing:

    uv run --with rasterio --with duckdb --with requests --with shapely --with pyshp tools/build-fruiting-gis.py bulk prepare national --sources forest-type,land-cover,canopy,states --cache /tmp/ffsrc
    uv run --with rasterio --with duckdb --with requests --with shapely --with pyshp tools/build-fruiting-gis.py bulk prepare state --state CO --cache /tmp/ffsrc
    uv run --with rasterio --with duckdb --with requests --with shapely --with pyshp tools/build-fruiting-gis.py bulk prepare state --state NM --cache /tmp/ffsrc
    for t in n37_w106 n37_w107 n37_w108 n38_w106 n38_w107 n38_w108 n39_w106 n39_w107 n39_w108 n40_w106 n40_w107 n36_w107 n36_w106 n35_w106; do
      uv run --with rasterio --with duckdb --with requests --with shapely --with pyshp tools/build-fruiting-gis.py bulk prepare tile --tile "$t" --cache /tmp/ffsrc
      uv run --with rasterio --with duckdb --with requests --with shapely --with pyshp tools/build-fruiting-gis.py bulk build --tile "$t" --soil-states CO,NM --cache /tmp/ffsrc --out /tmp/ff-norm --layers habitat,public-land,fire
      uv run --with duckdb tools/build-fruiting-gis.py build tile "$t" --source-dir /tmp/ff-norm --resume
    done

Listing both soil states is safe for every tile: a state that does not own any of the tile's mukeys is skipped, and a prepared neighbouring state is included automatically when it does (exact membership, not a range guess). A gSSURGO/gNATSGO state package can replace the SDA attribute table: `bulk prepare state --state CO --source gssurgo --archive /path/gSSURGO_CO.zip` (the same normalized contract is used by `build --soil-states CO`).

`bulk sources --cache /tmp/ffsrc` prints the pinned registry plus the cache readiness manifest. Corrupted archives remain FAILED until replaced. `bulk prepare state --state CO` fetches the normalized SSURGO attribute table through Soil Data Access and `bulk build --soil-states CO` composes it into habitat; a gSSURGO/gNATSGO package prepared with `--source gssurgo|gnatsgo` is consumed identically.

The original hosted land-cover/canopy archives were retrieved from the MRLC product pages (URLs recorded in the source registry and the cache manifest). The MRLC download links move between releases; the pinned archive name, byte count and SHA256 in `tools/fruiting_bulk_adapters.py` are authoritative, and an operator may place a byte-identical archive in the cache when a hosted link changes.

Publisher planning and tests:

    uv run --with duckdb --with requests tools/build-fruiting-gis.py build conus --plan
    uv run --with duckdb --with requests tools/build-fruiting-gis.py build bbox -108 37 -105 40 --plan
    uv run --with duckdb tests/test_fruiting_tile_publish.py
    uv run --with duckdb --with rasterio tests/test_fruiting_bulk_adapters.py

State bounds: JSON object with state names and authoritative west/south/east/north bounds. State mode selects intersecting tiles, not state-clipped polygons. CONUS plan selects 955 approximate catalog land tiles, zero network requests. The catalog omits some small/coastal land areas; use bbox/tile until a definitive national footprint replaces it.

Normalized inputs: `<habitat|pl|ap|fire>/<tile>.parquet` plus a `<tile>.parquet.json` sidecar with datasetVersion, sourceUrl, status and (for habitat) components. WGS84; habitat `elevation_ft` is feet and the 3DEP source is meters, converted once in the adapter; `canopy` is a 0..1 fraction derived once from TCC percent; Open-Meteo elevation stays meters. VERIFIED_EMPTY requires a successful complete source query and zero-row schema-correct Parquet. Missing input stays UNBUILT; invalid input becomes FAILED or records a failed attempt alongside intact prior evidence.

Two source-behaviour traps found earlier, both worth remembering for national expansion:
1. **ArcGIS envelopes must be JSON objects.** A `"west,south,east,north"` string is silently ignored and the service returns whole-layer results. Both vector adapters pass `{"xmin":…,"ymin":…,"xmax":…,"ymax":…}` **and** run `clip_to_tile()` locally, because a service-side filter is not a guarantee.
2. **USGS 1-degree DEM tiles are named by their north edge.** Fruiting Forecast tile IDs use the south edge, so `usgs_dem_tile_id('n40_w106') == 'n41w106'`. Getting this wrong silently samples the neighbouring tile.

Also note the hosted PAD-US service aggregates same-named units across the conterminous U.S. into single multipart records, so `build_public_land` validifies and clips every geometry to the tile before grouping; without that, a tile inherits nationwide polygons.

Locking prevents concurrent manifest lost updates. After SIGKILL, verify the PID in .publish.lock is dead before removing the lock and resuming. Old content-addressed assets remain intentionally available.

**Do not run the legacy default sampler for full CONUS.** It still uses per-point remote services and region-wide side products; use the bulk adapters plus the publisher instead.

## Regional model maturity

| Profile | Targets / status |
|---|---|
| Central & Eastern Hardwood | Seven legacy targets, original numerical behavior; PROVISIONAL |
| Appalachians / Ozarks | Same seven, provisional transfer preserving Ohio/Tennessee corridor; independent validation pending |
| Southern Rockies | Four targets (`porcini`, `chanterelleRoseocanus`, `morelNatural`, `morelBurn`); PROVISIONAL season/elevation/host screening with mapped western conifer classes, a provisional precipitation band and MTBS burn evidence; not calibrated weather forecasting |
| Pacific Northwest Maritime | Assigned; unsupported forecasting; candidates researched |
| California Mediterranean | Assigned; unsupported forecasting; live-oak chanterelle / regional porcini candidates |
| Northern Rockies / Interior Mountains | Assigned; unsupported forecasting |
| Northern Forests / Great Lakes | Assigned; unsupported forecasting |
| Southeast / Coastal Plain | Assigned; unsupported forecasting |
| Great Plains | Assigned; unsupported forecasting |
| Southwest / Arid Interior | Assigned; unsupported forecasting |

EPA crosswalk is explicit data in HTML, not coordinate rectangles. Southern Rockies = EPA 21. Unmatched polygons/coordinates are unsupported.

**Per-sector arbitration (Task 10).** `analyze()` resolves a biology profile for every sector, not just the center, and each sector is scored only with its own profile's targets. `analysis.zoneBiology`, `analysis.sectorBiologyCount` and `analysis.suppressedTargets` record what happened. Deterministic regression: a 100-mile search centered at 37.5, −104.0 (Great Plains, unsupported) has a western sector inside EPA 21, so the analysis surfaces the four Southern Rockies targets with the plains center still resolving to `plains` and the eastern sector scoring nothing.

### Southern Rockies model assertions and limits

All four targets are PROVISIONAL. Weights, elevation belts and calendar bands are engineering values unless the provenance says otherwise.

**Porcini (`Boletus rubriceps`).** [Arora & Frank 2014](https://doi.org/10.2509/naf2014.009.006) supports July–September summer-storm fruiting in montane conifer habitat, mainly spruce, with pine and possibly fir, and documents recreational/commercial importance. Habitat now uses mapped FIA forest-type-group classes with a heavy spruce/fir weight rather than elevation alone. The 8,000–12,000 ft belt / 3,000 ft soft falloff remains an explicitly provisional host-belt approximation, **not a measured range**. Thermal and soil-moisture response stay missing and are reported as missing.

**Chanterelle (`Cantharellus roseocanus`).** [PNW-GTR-576](https://research.fs.usda.gov/treesearch/5298) supports the taxon (named there as `Cantharellus cibarius var. roseocanus`), its spruce association ("appears to associate only with spruce"; Sitka spruce on the coast, Engelmann spruce at higher elevations) and that it is not found in pure Douglas-fir or hemlock stands. GBIF accepts the species (usageKey 7443622); iNaturalist taxon 499666 has 201 Colorado records concentrated in July–September (Jul 28 / Aug 146 / Sep 27). **Colorado-specific evidence is explicitly weaker than Idaho/Montana/Pacific Northwest evidence**: no Colorado published phenology, host weights or elevation limits were located, so the Colorado application is an inference from host association plus observational range data and is not claimed as validation.

**Natural (non-burn) morels.** PNW-GTR-710 separates fire-associated from non-burn morels and describes the Interior West including Colorado (forest habitat at higher elevations, more continuously distributed in Colorado, winter snowpacks, sporadic heavy summer convection rainfall, morels in moist microsites, and "the morel season progresses upwards in elevation as summer weather warms" — Miller 2003). The June–July calendar is an engineering calendar derived from that progression and is **not a published Colorado phenology**. Snowmelt is represented only by an elevation-and-season proxy; no snowmelt dataset is published.

**Burn morels.** [McFarlane et al. 2005](https://research.fs.usda.gov/treesearch/33858) found gray morels fruiting exclusively in high-elevation `Picea`/`Abies` stands burned the preceding summer, predominantly at moderate fire intensity (Idaho and Montana). PNW-GTR-710 reports fire morels fruiting mostly one year after fire, occasionally two. The recency response is engineering weighting of a sourced direction. MTBS publishes no per-perimeter severity class, so severity is NULL and applies no penalty. The target declares `requiresDisturbance` with `evidenceGapCap` so it cannot rank as a normal forecast without fire evidence; the band reads "Fire evidence unavailable" and the reason states that a burn site cannot be confirmed.

Legacy numeric settings remain operational hypotheses for regression continuity. Their source URLs support ecology, not every coefficient. No profile is VALIDATED.

## Historical occurrence prior: reproducible design / interface

Use a cited, fixed GBIF occurrence download with DOI and predicate JSON, not browser searches. Official [download documentation](https://techdocs.gbif.org/en/data-use/api-downloads) and [formats](https://techdocs.gbif.org/en/data-use/download-formats) define reproducible exports. Authentication belongs only in offline preparation.

1. Curate taxon-ID mappings with synonym/version provenance; never combine all Boletus or Craterellus into one target.
2. Reject invalid coordinates, geospatial issues, unsuitable obscured/generalized locations and excessive/unknown uncertainty from strong support. Keep exclusion counts; exclusions are not absences.
3. Join to the same EPA polygons; aggregate species × ecoregion then profile. Deduplicate occurrence IDs and known cross-published records.
4. Publish counts, distinct years, dataset counts, time span, filter counts, DOI and geography/taxon versions. No observer identities or point coordinates.
5. Contract: status, records, distinctYears, sourceUrl. Implemented historicalPlausibility() labels repeated documentation at ≥3 records over ≥2 years. This engineering label is not statistical occupancy. Sparse/zero/missing records impose **zero absence penalty**.
6. Prior, current 21-day reports and weather remain distinct. No historical dataset has been built or included in scores.

## Fire ecology: source, ingestion and interface

[MTBS](https://www.mtbs.gov/) maps perimeters/severity from 1984 onward. [USGS product documentation](https://burnseverity.cr.usgs.gov/products/mtbs) and [mapping methods](https://www.mtbs.gov/mapping-methods) describe national/state bulk products. It covers large mapped fires (>1000 acres in the western U.S.), not every disturbance; absence of a polygon cannot mean no fire.

**Now implemented.** `tools/fruiting_bulk_adapters.py` queries the pinned MTBS burned-area-boundaries layer (`EDW_MTBS_01/63`) once per tile with a JSON envelope, keeps the returned features, and clips nothing (a fire straddling a tile edge is real evidence for the sectors inside it). Output rows carry `perimeter_id`, `fire_name`, `fire_year`, `acres`, `severity` (always NULL: the polygon layer publishes dNBR offset and thresholds, not one severity class), `geometry_json`, bbox, center, `source_id`, `source_url` and `retrieved_at`. The publisher treats it as a fourth layer (`fire`/`fireHistory`).

The browser reads the per-tile fire asset, reports `AVAILABLE` / `MAP_AVAILABLE_NO_MATCH` / `UNAVAILABLE`, and derives per-sector disturbance evidence (a perimeter containing the sector point is distance 0; otherwise distance is measured to the perimeter bbox, with a threshold of `max(6 mi, 30% of the search radius)`). `burnResponseScore` converts years-since-fire and severity into a component. Missing or non-matching evidence leaves the component null, drops confidence and triggers the declared `evidenceGapCap` for disturbance-dependent targets.

Ingested for tile `n40_w106`: 11 real perimeters (1988–2012 in the current clip), including the Fourmile Canyon, High Park, Picnic Rock and Overland fires. Ingested for tile `n39_w106`: 15 real perimeters in the Summit/Eagle/White River country. The revision-4 release added perimeters for nine more Colorado tiles, and revision 5 adds the three New Mexico tiles (`n36_w107` 35, `n36_w106` 34, `n35_w106` 23). Two perimeters cross the Colorado–New Mexico line and are deduplicated by stable id. No national burn tiles are published yet.

## Source datasets / versions

- EPA: current official [Level III download page](https://www.epa.gov/eco-research/level-iii-and-iv-ecoregions-continental-united-states); archive members dated 2015-07-17; exact SHA256 in JSON.
- US Census state boundaries: `cb_2023_us_state_20m.zip`, SHA256 `0fd2d6562708ff8182c00d5d25b5556d049ecf2794d97b89ed2dac4d5e9e2c8d`, 186,432 bytes; simplified to 0.02° for the browser.
- USDA FS FIA/GTAC Forest Type Groups: `conus_forestgroup.zip`, SHA256 `5ef0fa8212764e5337f4aeb94569cce144e5cb5a598314bb4f6ac23bf0f7dfbf`, 168,022,806 bytes, archive dated 2012-04-26, ground condition 2004, 28 classes, 250 m, EPSG:5069. Producer reports 65% overall conterminous class accuracy.
- Annual NLCD Land Cover 2023: `Annual_NLCD_LndCov_2023_CU_C1V2.zip`, SHA256 `da50297bc65c07a8210999d20e2b59e69a8d1470273e1ed9344884988fd47aaf`, 1,427,423,034 bytes, member `Annual_NLCD_LndCov_2023_CU_C1V2.tif`, 30 m, 16 classes (11–95), nodata 250, CONUS Albers (EPSG:5070 parameters). Product page `https://www.mrlc.gov/data/nlcd-2023-land-cover-conus`; the archive was retrieved from the MRLC data-bundles URL recorded in the source registry.
- NLCD Tree Canopy Cover CONUS v2021-4: `nlcd_tcc_conus_2021_v2021-4.zip`, SHA256 `7afe3a6856eacd30eb557515e821ab9a491df0e18231b107a2fe129e27541fb0`, 3,740,022,899 bytes, member `nlcd_tcc_conus_2021_v2021-4.tif`, 30 m, values 0–100 percent, 254 = non-processing area, 255 = background, CONUS Albers. Product page `https://www.mrlc.gov/data/nlcd-2021-tree-canopy-cover-conus`. The canopy vintage is 2021 while land cover is 2023; the two-year difference is documented, not corrected.
- USGS 3DEP 1 arc-second 1°×1° GeoTIFF: per-tile releases for the 14 release tiles (~45–53 MB each), EPSG:4269, meters, nodata −999999. New Mexico: `n36_w107` release 20220801, `n36_w106` and `n35_w106` release 20250311. The release is resolved per tile from the public TNM bucket listing (`https://prd-tnm.s3.amazonaws.com/?list-type=2&prefix=StagedProducts/Elevation/1/TIFF/historical/<tile>/`), because the previously pinned global date does not exist for most tiles. Cached tiles keep their fetched release; every release is recorded in the cache manifest and habitat sidecar.
- NRCS SSURGO via Soil Data Access: state attribute query (`mapunit` + `legend` + `sacatalog` + `muaggatt`) plus batched point lookup (`SDA_Get_Mukey_from_intersection_with_WktWgs84`). Attributes: `drclassdcd`, `aws025wta`, `aws050wta`, `flodfreqdcd`, `hydgrpdcd`, `slopegraddcp`, plus `saverest` for the recorded survey vintage. Endpoint `https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest`; product page `https://sdmdataaccess.sc.egov.usda.gov/`. Revision 5 prepared both states independently (fetched 2026-09-15):
  - Colorado: 7,740 mapunits, 78 survey areas, survey vintage through 2025-09-19, 719,174-byte response in 0.74 s, 77 KB normalized Parquet, mukey range 57,543–3,457,847.
  - New Mexico: 4,550 mapunits, 46 survey areas, survey vintage 2025-09-08/09, 417,573-byte response in 0.66 s, 48 KB normalized Parquet, mukey range 55,617–3,295,843.
  - Point lookup: one batched query per tile, 18,126-character request, 11,801-byte response, 400 rows in 3.59 s, cached as ~12.5 KB JSON.
  - gSSURGO and gNATSGO state packages remain supported alternates through the same normalized contract; neither was obtainable from this environment (NRCS Box folder links 404, Geospatial Data Gateway 403, Web Soil Survey cart requires an interactive session).
- MTBS burned area boundaries: `EDW_MTBS_01/63`, queried with a JSON envelope; retrieval date recorded in the sidecar datasetVersion. The 14 release tiles hold 4–35 perimeters each; eleven perimeters appear in more than one tile and two appear on both sides of the Colorado–New Mexico line, always with the same stable `perimeter_id`.
- PAD-US: Esri-hosted public-access FeatureServer (edition not stated by the service, still not freshly audited) plus Census states for jurisdiction. The hosted layer publishes no usable stable unit id (`BndryID` and `ST_Name` both read "Not Applicable"), so property identity is the authoritative `name|manager|Category|DesTp_Desc|state` composite and near-boundary jurisdiction is withheld with an explicit confidence marker rather than guessed.
- The 40 legacy Ohio/Tennessee habitat tiles still carry NLCD land cover sampled per point, forest-group signals from the old sampler and no western host signals; they are unchanged and readable.

## Two-state release — measurements (revision 5)

Measured on the committed assets (`data/fruiting-forecast/`), not estimates. Fourteen tiles in two states, 5,600 habitat cells:

| Asset class | Total | Per-tile range |
|---|---|---|
| habitat Parquet | 203,219 B | 14,182–14,764 B (400 cells each) |
| public-land Parquet | 3,203,810 B | 71,787–550,548 B (73–2,137 grouped properties) |
| fire Parquet | 2,500,990 B | 17,720–445,215 B (4–35 MTBS perimeters) |
| manifest.json | 226,896 B | — |
| **release total** | **6,134,915 B (~5.9 MB)** | Colorado side 4.70 MB · New Mexico side 1.21 MB |

New Mexico per-tile soil coverage is 388–399 of 400 cells (n36_w107 394, n36_w106 388, n35_w106 399), better than the Colorado mountain tiles. New Mexico evidence is ecologically distinct: pinyon-juniper forest groups appear in all three NM tiles (96/51/101 cells) and average less than 20 cells in the Colorado reference tile, shrub/grass cover dominates `n35_w106` (206 shrub + 49 grass), and elevation ranges span 5,051–12,191 ft.

Representative browser searches measured through the app's own fetch/cache path (cold first run, then a repeat run):

| Search | Tiles selected | Cold GIS bytes | Cold / cached analysis | Repeat run |
|---|---|---|---|---|
| Frisco, CO (39.62, −106.07), 25 mi | n39_w106, n39_w107 | 1,391,298 B (~1.33 MB) incl. 227 KB manifest | 4.1 s / 3.3 s | 0 requests, 7 cache hits |
| Interstate (36.90, −105.25), 100 mi | 9 tiles across CO and NM | 3,075,218 B (~2.93 MB) of tiles (manifest already cached) | 6.3 s / 4.6 s | 0 requests, gisHits 36 / gisMisses 34 cumulative |

Composition cost: the five habitat components add about 5.5 KB per 400-cell tile over a forest-type-only tile (9,001 B → ~14,500 B). Public-land geometry and fire perimeters dominate the per-search cost (both ≈48% of the interstate cold bytes); habitat is ~4%. A repeated analysis makes **zero GIS network requests**, so the IndexedDB byte cache reuses every asset. Core app assets (`states.js` 118 KB, `ecoregions.js` 1.21 MB) load once per page and are region-independent.

## SDA scaling characteristics (revision 5)

Measured production behavior, not a benchmark claim:

| Operation | Measured | Cache |
|---|---|---|
| State attribute query (CO) | 719,174-byte response, 7,740 rows, 0.74 s | 77 KB Parquet + sidecar |
| State attribute query (NM) | 417,573-byte response, 4,550 rows, 0.66 s | 48 KB Parquet + sidecar |
| Batched point→MUKEY (400 points) | 18,126-char request, 11,801-byte response, 400 rows, 3.59 s | ~12.5 KB JSON per tile |
| Unchanged `prepare state` re-run | no SDA query (`reused: true`) | — |

Projection from those measurements, assuming one point query per tile, one state query per state prepared once, and no throttling (none was observed across ~25 production calls; no 429s):

- **50 tiles:** ~50 point queries (~3 min serial), ~0.6 MB of point responses, ~0.6 MB of point caches, plus 1–3 state tables.
- **250 tiles:** ~250 point queries (~15 min serial), ~3 MB of point responses, ~3.2 MB of point caches, ~5 state tables (~0.3 MB).
- **955 CONUS land tiles:** ~955 point queries (~57 min serial), ~11 MB of point responses, ~12 MB of point caches, ~48 state tables (~2.5 MB), ~35 s of state queries. All of it is one-time; rebuilds reuse the caches. Batch size is 400 points per query; the request is ~18 KB, well below any practical URL limit, and no batch-size failure has been observed (a larger batch would reduce call count if needed).

Failure/retry behavior: `_sda_query` has no automatic retry; a failed call raises, writes no cache marker, and the next run retries cleanly. The publisher keeps the previous good asset and records `lastBuildAttempt: FAILED` rather than producing a false AVAILABLE.

## Bounded expansion plan (post-revision 5)

The revision-5 release is exactly the 14 tiles declared in `summary.coverageTiles`, verified end to end. Next bounded steps, in order:

1. **A third state or a larger multi-state batch** to validate the state-scoped paths under load — for example southern Utah/Colorado Plateau tiles (`n37_w109`, `n36_w109`, `n37_w110`) with `prepare state --state UT`, or the eastern Colorado plains tiles (`n38_w105`, `n39_w105`, `n40_w105`) that exercise sparse-forest habitat and a different rule jurisdiction.
2. **Access points** through the regional OSM PBF design below, one bounded region (Colorado + New Mexico) at a time.
3. **National generation only after** a multi-state batch verifies with the same commands and measured costs, and after the access layer is either implemented or explicitly deferred.

Cost model from the real two-state release: 14 tiles required 13 DEM downloads (~50 MB each, cached forever), 14 PAD-US queries and 14 MTBS queries (cached per tile), one national source set, two state soil attribute queries and 14 batched point queries. Published output was ~5.9 MB. A 25–100-mile regional search costs ~1.3–3.3 MB once and zero on repeat.

## Access points: design, not priority (revision 5)

Access remains UNBUILT for every release tile and is deliberately not allowed to block habitat work; the manifest, the About coverage panel, the analysis status and the artifact tests all assert it. The scalable design when it is implemented: ingest a regional OSM extract (Geofabrik `.osm.pbf`, e.g. Colorado) and parse it locally with `pyosmium`, selecting the same genuine access features the legacy Overpass adapter used (parking, trailheads, boat ramps, public/permissive gates, visitor information) plus access roads/entrances where mapped. Associate each candidate with a published PAD-US property by local point-in-polygon, keep OSM tags as provenance, and publish per-tile `ap/` Parquet through the existing publisher. No Suggested Start location is manufactured: if no verified feature exists, the tile stays empty and the UI continues to say so. A regional PBF is one bounded download per region, not a per-tile Overpass call, which is what makes the eventual national pass tractable.

## Known limitations / remaining work

1. The bounded release covers 14 tiles in two states (11 Colorado, 3 New Mexico) with all five habitat components, public land and fire. Access remains UNBUILT for all of them by design. No other state has published evidence beyond the 40 legacy Ohio/Tennessee tiles.
2. Soil coverage is explicit rather than complete: 1–62 of 400 sampled cells per tile have no drainage class because the sampled mapunit is absent or the attribute is not published. Those cells stay NULL and lower the confidence coverage; no neutral value is invented. Nationally, SSURGO-only coverage means STATSGO2-mapped areas (some western rangeland) would stay NULL rather than being filled with coarse data.
3. Near-boundary jurisdiction is deliberately withheld: 51 properties across the release are published with `jurisdiction_confidence = ambiguous-near-boundary` and no state. They remain visible on the map and resolve to UNKNOWN_VERIFY; they can never inherit a neighbouring state's collecting rule. This is conservative by design, not a missing-data bug.
4. The hosted PAD-US public-access layer publishes no usable stable unit id (`BndryID` reads "Not Applicable"), so identity is a composite of name, manager, category, designation and resolved state. Two genuinely different units with identical composites inside one state would still merge; no observed case exists in the release, and the schema records the fields that define identity so a future source with a real id can replace the composite.
5. gSSURGO/gNATSGO state packages are supported through the same normalized contract (FileGDB, GeoPackage/SQLite and CSV packaging all normalize identically and are tested) but no real package was obtainable from this environment (NRCS Box links 404, GDG 403, Web Soil Survey cart needs a session). The SDA path is the verified production source; a future pass can validate a real package drop-in.
6. 3DEP releases differ per tile (20220216 for the two original tiles, 20250311 for two New Mexico tiles, 20220801 for the canary, 20260701/20260708 for most Colorado ones) because a single pinned date does not exist for every tile. Each release is recorded; mixed-release elevation evidence across tile edges is documented, not normalized away.
7. `spruce_fir` (class 120) is still not present in the release tiles; the spruce/fir signal comes from `fir_spruce_mountain_hemlock` (class 260). Both classes are weighted; a tile where only class 120 occurs has not been exercised. Pinyon-juniper and western-oak classes are recorded but have no host signal or model weight, by design.
8. Canopy (TCC 2021) and land cover (Annual NLCD 2023) use different vintages. They are separate signals, and the difference is documented; it is not corrected.
9. Remaining western profiles (PNW, California, Northern Rockies, Great Plains, Southwest, Southeast, Northern Forests) still have no forecasts. The northern New Mexico extension is scored only where EPA Southern Rockies polygons apply; its plains and Southwest sectors remain unsupported, which the interstate test asserts.
10. Habitat geometry is clipped at tile edges for public land, and the hosted PAD-US service merges same-named units, so same-named same-state units inside one tile are grouped. `n39_w106` has 2,137 grouped properties (550 KB) — public-land geometry is still the largest per-search asset.
11. Legacy 40 tiles were produced by the old per-point sampler: they lack western host signals, the added land-cover fields and published state jurisdiction. They remain readable (schema union) and rules fall back to the Census lookup; note that legacy rows have no jurisdiction-confidence marker, so the browser's Conservative check applies only to rows that carry it.
12. `evidenceGapCap` is an explicit engineering rule, not a scientific finding: it stops a disturbance-dependent target from ranking normally without burn evidence. It is declared in the target data and surfaced in the UI.
13. Snowmelt is a proxy (elevation + season), not a dataset. No degree-day or snowmelt-date source is ingested.
14. Observation support is unavailable for three of the four Southern Rockies targets by design: `porcini`, `morelNatural` and `morelBurn` have no single iNaturalist taxon that avoids aggregating biologically different taxa, so `inat` stays null and the observation component is omitted. Only `chanterelleRoseocanus` has a verified taxon (iNaturalist 499666).
15. Soil is published as environmental evidence; no Southern Rockies model weights it yet because the reviewed sources do not support a calibrated soil-moisture response. Drainage and available water storage therefore raise habitat confidence coverage and display in the habitat panel, but do not change a target score.
16. OPFS remains experimental legacy infrastructure. Actual evidence always registers bytes; metadata-only VERIFIED cannot bypass registration.
17. Manifest `datasetVersion` is content-addressed (`content-<hash>`) because the publisher owns it. Anything asserting a literal date should read the manifest instead.
18. The safety/access surfaces are unchanged: a forecast never establishes identity, edibility, access or legality.

## Final verification (2026-09-15, revision 5)

    npx playwright test tests/fruiting-forecast.spec.js tests/fruiting-forecast-gis.spec.js tests/fruiting-forecast-huntability.spec.js tests/fruiting-forecast-access-theme.spec.js tests/fruiting-forecast-openrouter.spec.js tests/fruiting-forecast-about.spec.js tests/fruiting-forecast-conus.spec.js --reporter=line --workers=3

**82 passed, 1 skipped (43.9 s at `--workers=3`).** The skipped test is the opt-in live Princeton GIS run (`FF_LIVE_GIS=1`). The 29-test CONUS/Colorado spec now covers the two-state 14-tile release (digest checks, component completeness, `coverageTiles`), real cross-tile DuckDB-Wasm public-land/MTBS identity reads, deterministic browser dedupe fixtures, and a real interstate search that lazy-loads tiles from both states, proves per-sector ecology (2 profiles across sectors), and proves jurisdiction isolation with ambiguous rows.

    uv run --with duckdb tests/test_fruiting_tile_publish.py
    uv run --with duckdb --with rasterio tests/test_fruiting_bulk_adapters.py

**5 publication tests passed** (incremental integrity/empty/failure, completeness components, coverage dimensions, profile-roster drift guard, coverage refresh) and **45 adapter tests passed**: contracts, cache/checksum paths, SDA state preparation with independent caches/restart reuse/failure isolation, exact cross-state mukey inclusion, point-query failure and recovery, gSSURGO/gNATSGO/GeoPackage packaging equivalence, DEM release resolution, private identity helper, habitat composition, legacy compatibility, and the committed two-state release (real SSURGO values and gaps, conservative jurisdiction, cross-tile MTBS identity, release scope).

    python3 -m py_compile tools/build-fruiting-gis.py tools/fruiting_tile_publish.py tools/build-fruiting-ecoregions.py tools/build-fruiting-states.py tools/fruiting_bulk_adapters.py
    .agents/skills/junkdrawer-compliance-audit/scripts/audit.sh fruiting-forecast.html
    git diff --check

All clean: `py_compile` OK; compliance audit 0 errors / 0 warnings with footer and JSON both at 2026.09.15.1; `git diff --check` OK.

Manual inspections (screenshots at `/tmp/ff-nm-canary.png` and `/tmp/ff-co-nm-boundary.png`): the 25-mile Taos-area search shows Southwest/Arid Interior as the center profile with the four Southern Rockies targets surfaced from Southern Rockies sectors (`2 regional models across sectors`), provisional porcini at 88/Low; the 50-mile boundary search at 36.90, −105.25 shows Southern Rockies/PROVISIONAL with four targets, tiles from both states, properties in CO, NM and unresolved near-boundary jurisdiction, and "no property has both mapped public access and a rule that makes it actionable" (no CO/NM rules are published).

## Exact next recommended task

Pick one track; both are ready:

1. **OSM regional-PBF access layer** (preferred if the goal is completing the evidence stack): implement the design above for the Colorado+New Mexico region first — prepare one bounded `.osm.pbf` once, extract trailheads/parking/public gates/entrances locally, associate with PAD-US properties by point-in-polygon, publish `ap/` tiles through the existing publisher, and keep "no verified feature means no suggested start". Then re-measure the per-search bytes, which will grow by the access assets.
2. **Pacific Northwest biological region** (preferred if the goal is model breadth): reuse the same five-component habitat stack and add PNW host evidence and provisional targets with the same provenance discipline; do not transfer Southern Rockies weights.

Either way, keep the release bounded: the next production step is one more state or a 3–5 tile batch through the exact commands above, then a CONUS plan only after the access layer is implemented or explicitly deferred.
