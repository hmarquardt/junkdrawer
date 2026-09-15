# Fruiting Forecast CONUS expansion — authoritative handoff

Work in progress, 2026-09-14. Existing implementation notes describe the legacy app; this document records the expansion and supersedes conflicting coverage/offline claims. Revision 2 recorded the Southern Rockies / Colorado milestone: four regional targets, the first real western bulk GIS publication, MTBS burn evidence, per-sector ecological arbitration and state-scoped collecting rules. Revision 3 completed the core habitat stack for Colorado: pinned Annual NLCD land cover and NLCD tree canopy adapters, a second independently built Colorado tile, explicit habitat component completeness, a robust national-source cache, and a tested gSSURGO adapter path. **Revision 4 resolves real authoritative NRCS soil (SSURGO via Soil Data Access), unifies the soil source contract so gSSURGO/gNATSGO packages are drop-in alternates, resolves per-tile 3DEP DEM releases, and executes a bounded 11-tile Southern Rockies production release with complete five-component habitat and real public-land/fire evidence.**

## Decisions

- Preserve deterministic Indiana scoring. Split stable taxon identity from regional parameters, with explicit applicability and maturity. No universal Midwest fallback.
- EPA Level III polygon geography, simplified offline, supplies coordinate lookup. Profile mapping is data, not rectangular climate zones.
- Every sector uses the biological profile of its own location. A search radius may cross an ecoregion boundary, so the search center never imposes its targets on other sectors.
- Southern Rockies now has four provisional targets: Rocky Mountain king bolete (`Boletus rubriceps`), rainbow chanterelle (`Cantharellus roseocanus`), natural (non-burn) morels and burn morels. All four are PROVISIONAL, none VALIDATED.
- Western host evidence comes from mapped USDA FS FIA forest-type-group classes (spruce/fir, fir/spruce/mountain hemlock, lodgepole, ponderosa, Douglas-fir, aspen/birch). Eastern classes are unchanged and are never overloaded with western meaning.
- Missing physiology stays missing. Western targets carry no thermal or soil-moisture response because the reviewed sources do not support one; the declared weight is retained so missing evidence lowers confidence instead of being renormalised away.
- Qualitative precipitation is permitted but must be labelled: western targets use a declared engineering band (14-day accumulation, wet-day count, rain recency) with provenance stating it is not a measured threshold.
- Burn evidence comes from real MTBS burned-area boundaries published per tile. MTBS publishes no per-perimeter severity class, so severity is NULL and applies no penalty. Absence of a perimeter is never a negative biological signal; a disturbance-dependent target declares `requiresDisturbance` and an explicit `evidenceGapCap` so it cannot rank highly without fire evidence.
- Collecting rules are state-scoped. Rules declare `jurisdiction`, and a rule applies only when the property's jurisdiction is known and matches. Unknown jurisdiction keeps UNKNOWN_VERIFY. PAD-US `ST_Name` is unusable for jurisdiction (it reads "Not Applicable" for federal units), so jurisdiction is assigned by point-in-polygon against US Census state boundaries.
- Raw bulk adapters live in `tools/fruiting_bulk_adapters.py`: pinned source products are prepared once into a cache and sampled, queried or clipped locally, never re-downloaded per tile. Preparation scope is explicit: `prepare national` for national products, `prepare state` for soil, `prepare tile` for the per-tile 3DEP DEM.
- **Soil has one normalized contract regardless of upstream packaging**: `mukey -> {drainage_class, awc_25_cm, awc_50_cm, flood_frequency, hydrologic_group, slope_deg}`. The default 2026 source is the authoritative NRCS Soil Data Access (SSURGO) tabular service: one query per state for the mapunit attribute table and one batched point-to-MUKEY query per tile. A gSSURGO or gNATSGO state package is a drop-in alternate through the same contract. STATSGO2 gap filling is deliberately not applied, so coarse state-level data is never presented as survey-grade soil.
- **3DEP DEM releases are resolved per tile** from the public TNM bucket listing; a single pinned national release date does not exist for every tile. A cached tile keeps the release it was fetched with, and the release is recorded in provenance. Mixed releases across the release are explicit, not silently normalized.
- Canopy is a separate signal from mapped forest type. `canopy` is NLCD Tree Canopy Cover stored as a 0..1 fraction; it can support "forest structure exists" but never substitutes for a spruce-specific mapped host class in the porcini/chanterelle models.
- Land cover is Annual NLCD, sampled at the 0.05-degree cell center. `forest`, `deciduous`, `open_land` reuse the legacy NLCD class mapping so eastern semantics are unchanged; `evergreen`, `mixed_forest` and `wetland` are additive western-era columns. Legacy tiles lack these fields and read them as NULL.
- Habitat completeness is explicit. `habitat.components` declares forestType/elevation/landCover/canopy/soil as AVAILABLE or UNBUILT; `habitat.status` is AVAILABLE only when every required component is present, and soil additionally reports AVAILABLE when real soil evidence was composed. A Parquet file existing is never completeness.
- The source cache is manifest-backed with version, bytes, SHA256 and a READY marker written only after download + validation. A corrupted or partial download is FAILED and is never treated as ready; large downloads resume from a `.part` file when the server supports ranges.
- Existing IndexedDB `FruitingForecastDB/cache` stores static tile bytes. Harden this path instead of adding another database. OPFS metadata alone must never skip registering actual Parquet bytes.
- Publication requires explicit per-layer status. A missing normalized source is UNBUILT, never verified empty.
- Collecting-rule and geometry loading stay independent.
- The bounded release is 11 one-degree Colorado tiles, not CONUS. Access points remain UNBUILT and the manifest and UI say so rather than inventing pins.

## Baseline

`npx playwright test tests/fruiting-forecast.spec.js --reporter=line --workers=2`: 7 passed (8.3 s), before changes.
Previous checkpoint (`01aad16`): 76 browser tests passed, 1 opted-out live test skipped; 10 Python adapter tests and 1 publication integration test passed.

## Completed in this pass (revision 4 — real soil and the bounded Southern Rockies release)

1. **Resolved the soil source.** NRCS bulk state packages (gSSURGO/gNATSGO) were investigated first; in this environment their distribution hosts (NRCS Box folders, Geospatial Data Gateway, Web Soil Survey cart) were not reproducibly reachable and the official gNATSGO page's direct links could not be resolved. The authoritative NRCS **Soil Data Access (SSDA) SSURGO tabular service** was reachable, stable and current (Colorado survey areas save-dated 2025): one state query returns all 7,740 Colorado mapunits with `muaggatt` attributes, and one batched `CROSS APPLY SDA_Get_Mukey_from_intersection_with_WktWgs84` query resolves 400 grid points per tile. That is one or two remote calls per tile, not one per point, and no geometry transfer at all.
2. **Normalized soil contract.** The soil section now defines one contract (`mukey -> drainage_class, awc_25_cm, awc_50_cm, flood_frequency, hydrologic_group, slope_deg`) shared by three sources: `sda` (default), `gssurgo`, and `gnatsgo` (operator-supplied state packages, validated by SHA256 and discovered by mapunit raster + `muaggatt` table). GeoPackage/SQLite packaging (gNATSGO 2026) is read directly with stdlib `sqlite3`, FileGDB packaging through pyogrio, and fixtures through CSV; the habitat build consumes normalized rows and never inspects packaging.
3. **Per-tile DEM release resolution.** The pinned 3DEP release `20220216` does not exist for most new tiles; `prepare tile` now lists releases from the public TNM bucket and takes the latest, while cached tiles keep their original release. All per-tile releases are recorded in the cache manifest and in each habitat sidecar's 3DEP source entry. The 11 release tiles span releases 20220216–20260708; this is explicit and documented.
4. **Bounded Southern Rockies production release.** Eleven one-degree Colorado tiles (`n37_w106 n37_w107 n37_w108 n38_w106 n38_w107 n38_w108 n39_w106 n39_w107 n39_w108 n40_w106 n40_w107`) were built through the same raw-source → normalized → publisher → manifest → browser path. Every tile has habitat (forest type, elevation, canopy, land cover, real soil), public-land and fire AVAILABLE; access is explicitly UNBUILT.
5. **Real soil values.** 338–387 of 400 cells per tile carry a drainage class; 363–398 carry available water storage. Region-wide the release contains 3,040 Well drained, 563 Somewhat excessively drained, 169 Poorly drained, 134 Excessively drained, 78 Somewhat poorly drained, 60 Moderately well drained and 36 Very poorly drained cells; the remaining 320 cells are NULL (no mapunit or no published attribute) and never a neutral value.
6. **Manifest and completeness.** `summary.coverageTiles` declares the exact 11-tile extent; `summary.layers.habitat.available` is 11 and per-component coverage shows all five components AVAILABLE for all 11; the manifest `sources` list now carries the real `ssurgo_sda` descriptor and a per-tile-release note for 3DEP.
7. **Tests.** 32 adapter tests (up from 24): SDA prepare/point-join/failure/empty paths, package path, source normalization equivalence, real release soil values, explicit gaps, multi-tile component/layer completeness and release-scope assertions. Browser suite unchanged at 79 passed + 1 opt-in skipped with the CONUS spec now covering the bounded release declaration and DuckDB-Wasm soil differentiation.

## In progress

Nothing is committed mid-refactor. Revision 4 is complete and verified; the release is deliberately bounded and must not be scaled to CONUS until the next pass validates a second state.

## Remaining / next task

The pipeline now produces real five-component habitat at regional scale from pinned/cached sources with explicit missing data. What remains before national generation: a second state to prove the state-scoped soil and jurisdiction paths (for example northern New Mexico or Utah tiles on the same Southern Rockies boundary), the OSM regional-PBF access adapter, and a province-by-province expansion plan with measured costs. National GIS bulk generation, historical occurrence aggregation and a snowmelt dataset remain unimplemented.

## Progress checkpoint — previous revision (checkpoint `e48d02b`)

Kept for continuity; superseded by "Completed in this pass" above where they differ.

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

- fruiting-forecast.html: FF-1.6.0; base taxon / regional-profile composition, EPA lookup, per-sector biology arbitration, applicability suppression, western host/elevation/precipitation/disturbance components, canopy + land-cover habitat evidence, evidence-gap rule, state-scoped collecting rules, regional model evidence panel, habitat component completeness in About/diagnostics, safe IndexedDB byte cache, explicit coverage, independent rule errors. Mixed-schema tile reads use `union_by_name=true`; legacy eastern tiles and new western tiles load together.
- data/fruiting-forecast/ecoregions.json and generated ecoregions.js: identical EPA data (only JS loaded in browser for file preview); JSON is build/interchange artifact.
- data/fruiting-forecast/states.json and generated states.js: US Census cartographic state boundaries (1:20,000,000, 2023), simplified to 0.02° (118 KB). Used **only** for collecting-rule jurisdiction. Simplified boundaries mean a property within roughly the tolerance of a state line can resolve to the neighbor state, which fails conservatively to UNKNOWN_VERIFY rather than inheriting a rule.
- tools/build-fruiting-ecoregions.py: EPA Level III geography builder.
- tools/build-fruiting-states.py: US Census state geography builder (`window.FF_STATES`).
- tools/fruiting_bulk_adapters.py: raw bulk adapters. Pinned sources (forest type groups, Annual NLCD land cover, NLCD tree canopy, per-tile 3DEP, MTBS, PAD-US, Census states, and soil via NRCS Soil Data Access or a gSSURGO/gNATSGO state package); `prepare national|state|tile` prepares once into a manifest-backed cache, `build` composes a tile into publisher inputs. Soil uses one normalized contract keyed by MUKEY. The forest-type-group legend is the authoritative product metadata legend; class 0 means "no forest type group mapped", never missing.
- data/fruiting-forecast/biology-research.json: 25 sources, 12 candidates, 4 southernRockies entries marked `implemented: true`. Every entry carries `supports` / `doesNotSupport` / `missing`. Revision 4 added the `ssurgoSda` source entry: soil is published as environmental evidence but no Southern Rockies model weights it, because the reviewed sources do not support a calibrated soil-moisture response.
- data/fruiting-forecast/manifest.json: schema 4 with publisher-recomputed `summary.layers` (populated / verifiedEmpty / unbuilt / failed, `available`, per-component coverage for habitat, consistent with tileCount) plus `summary.coverageTiles` (the exact bounded release extent), retained human-readable coverage fields, a `habitatSchema` description (including soil units and missing semantics), and the biology descriptor.
- tools/build-fruiting-gis.py: legacy sampler plus `build` (publisher) and `bulk` (adapters) dispatch.
- tools/fruiting_tile_publish.py: network-free publication boundary. Four layers (habitat, public-land, access, fire), per-layer source sidecars, schema/count checks, checksums, content-addressed assets, atomic manifest replacement after each layer, incremental merge, lock, and completeness-aware summary maintenance.
- tests/fruiting-forecast-conus.spec.js: 26 deterministic tests: Colorado species cases, fire-evidence cases, geographic suppression, jurisdiction scoping, per-sector boundary arbitration, the bounded 11-tile release declaration with digest checks, a real DuckDB-Wasm load of western tiles plus a legacy eastern tile (including soil differentiation), canopy/land-cover scoring behavior, and habitat completeness semantics.
- tests/test_fruiting_bulk_adapters.py: 33 deterministic tests for adapter contracts, the cache manifest/checksum/corruption path, the Soil Data Access and package soil paths (normalized contract, batched point join, ambiguity, explicit failure/empty, gSSURGO/FileGDB and gNATSGO/GeoPackage packaging equivalence), DEM release resolution, habitat composition with optional sources absent, legacy-tile backward compatibility, and the committed bounded release (component/layer completeness, real SSURGO values, explicit soil gaps, release-scope manifest assertions).
- tests/test_fruiting_tile_publish.py: 2 publication integration tests (incremental integrity/empty/failure and completeness components).
- junk-drawer.json and footer: 2026.09.14.3 (the app code is unchanged in revision 4; only data, adapters, tests and docs changed).

## Rebuild commands

From repository root. Preparation Python only; no browser/server dependency:

    curl -L --fail -o /tmp/us_eco_l3.zip https://dmap-prod-oms-edc.s3.us-east-1.amazonaws.com/ORD/Ecoregions/us/us_eco_l3.zip
    uv run --with pyshp --with shapely --with pyproj tools/build-fruiting-ecoregions.py /tmp/us_eco_l3.zip
    curl -L --fail -o /tmp/cb_2023_us_state_20m.zip https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_20m.zip
    uv run --with pyshp --with shapely --with pyproj tools/build-fruiting-states.py /tmp/cb_2023_us_state_20m.zip

Prepare the national products once, then the state soil attribute table once, then the per-tile DEMs, then compose and publish each tile. A prepared source is never re-downloaded per tile, and a DEM release is resolved per tile from the TNM bucket listing:

    uv run --with rasterio --with duckdb --with requests --with shapely --with pyshp tools/build-fruiting-gis.py bulk prepare national --sources forest-type,land-cover,canopy,states --cache /tmp/ffsrc
    uv run --with rasterio --with duckdb --with requests --with shapely --with pyshp tools/build-fruiting-gis.py bulk prepare state --state CO --cache /tmp/ffsrc
    for t in n37_w106 n37_w107 n37_w108 n38_w106 n38_w107 n38_w108 n39_w106 n39_w107 n39_w108 n40_w106 n40_w107; do
      uv run --with rasterio --with duckdb --with requests --with shapely --with pyshp tools/build-fruiting-gis.py bulk prepare tile --tile "$t" --cache /tmp/ffsrc
      uv run --with rasterio --with duckdb --with requests --with shapely --with pyshp tools/build-fruiting-gis.py bulk build --tile "$t" --soil-states CO --cache /tmp/ffsrc --out /tmp/ff-norm --layers habitat,public-land,fire
      uv run --with duckdb tools/build-fruiting-gis.py build tile "$t" --source-dir /tmp/ff-norm --resume
    done

A gSSURGO/gNATSGO state package can replace the SDA attribute table: `bulk prepare state --state CO --source gssurgo --archive /path/gSSURGO_CO.zip` (the same normalized contract is used by `build --soil-states CO`).

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

Ingested for tile `n40_w106`: 11 real perimeters (1988–2012 in the current clip), including the Fourmile Canyon, High Park, Picnic Rock and Overland fires. Ingested for tile `n39_w106`: 15 real perimeters in the Summit/Eagle/White River country. The revision-4 release adds perimeters for nine more Colorado tiles (4–23 each, up to 438 KB of geometry for `n40_w107`). No national burn tiles are published yet.

## Source datasets / versions

- EPA: current official [Level III download page](https://www.epa.gov/eco-research/level-iii-and-iv-ecoregions-continental-united-states); archive members dated 2015-07-17; exact SHA256 in JSON.
- US Census state boundaries: `cb_2023_us_state_20m.zip`, SHA256 `0fd2d6562708ff8182c00d5d25b5556d049ecf2794d97b89ed2dac4d5e9e2c8d`, 186,432 bytes; simplified to 0.02° for the browser.
- USDA FS FIA/GTAC Forest Type Groups: `conus_forestgroup.zip`, SHA256 `5ef0fa8212764e5337f4aeb94569cce144e5cb5a598314bb4f6ac23bf0f7dfbf`, 168,022,806 bytes, archive dated 2012-04-26, ground condition 2004, 28 classes, 250 m, EPSG:5069. Producer reports 65% overall conterminous class accuracy.
- Annual NLCD Land Cover 2023: `Annual_NLCD_LndCov_2023_CU_C1V2.zip`, SHA256 `da50297bc65c07a8210999d20e2b59e69a8d1470273e1ed9344884988fd47aaf`, 1,427,423,034 bytes, member `Annual_NLCD_LndCov_2023_CU_C1V2.tif`, 30 m, 16 classes (11–95), nodata 250, CONUS Albers (EPSG:5070 parameters). Product page `https://www.mrlc.gov/data/nlcd-2023-land-cover-conus`; the archive was retrieved from the MRLC data-bundles URL recorded in the source registry.
- NLCD Tree Canopy Cover CONUS v2021-4: `nlcd_tcc_conus_2021_v2021-4.zip`, SHA256 `7afe3a6856eacd30eb557515e821ab9a491df0e18231b107a2fe129e27541fb0`, 3,740,022,899 bytes, member `nlcd_tcc_conus_2021_v2021-4.tif`, 30 m, values 0–100 percent, 254 = non-processing area, 255 = background, CONUS Albers. Product page `https://www.mrlc.gov/data/nlcd-2021-tree-canopy-cover-conus`. The canopy vintage is 2021 while land cover is 2023; the two-year difference is documented, not corrected.
- USGS 3DEP 1 arc-second 1°×1° GeoTIFF: per-tile releases 20220216–20260708 for the 11 release tiles (~45–53 MB each), EPSG:4269, meters, nodata −999999. The release is resolved per tile from the public TNM bucket listing (`https://prd-tnm.s3.amazonaws.com/?list-type=2&prefix=StagedProducts/Elevation/1/TIFF/historical/<tile>/`), because the previously pinned global date does not exist for most tiles. Cached tiles keep their fetched release; every release is recorded in the cache manifest and habitat sidecar.
- NRCS SSURGO via Soil Data Access: state attribute query (`mapunit` + `legend` + `muaggatt`, 7,740 Colorado mapunits fetched 2026-09-14, 77 KB normalized Parquet) plus batched point lookup (`SDA_Get_Mukey_from_intersection_with_WktWgs84`). Attributes: `drclassdcd`, `aws025wta`, `aws050wta`, `flodfreqdcd`, `hydgrpdcd`, `slopegraddcp`. Endpoint `https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest`; product page `https://sdmdataaccess.sc.egov.usda.gov/`. gSSURGO and gNATSGO state packages remain supported alternates through the same normalized contract; neither was obtainable from this environment (NRCS Box folder links 404, Geospatial Data Gateway 403, Web Soil Survey cart requires an interactive session).
- MTBS burned area boundaries: `EDW_MTBS_01/63`, queried with a JSON envelope; retrieval date recorded in the sidecar datasetVersion. The 11 release tiles hold 4–23 perimeters each (n37_w108 22, n39_w108 23, n40_w107 15, n39_w106 15, n40_w106 11).
- PAD-US: Esri-hosted public-access FeatureServer (edition not stated by the service, still not freshly audited) plus Census states for jurisdiction.
- The 40 legacy Ohio/Tennessee habitat tiles still carry NLCD land cover sampled per point, forest-group signals from the old sampler and no western host signals; they are unchanged and readable.

## Bounded Southern Rockies release — measurements (revision 4)

Measured on the committed assets (`data/fruiting-forecast/`), not estimates. Eleven tiles, 4,400 habitat cells:

| Asset class | Total | Per-tile range |
|---|---|---|
| habitat Parquet | 160,304 B | 14,258–14,764 B (400 cells each) |
| public-land Parquet | 2,936,309 B | 93,545–545,978 B (180–2,088 grouped properties) |
| fire Parquet | 1,566,695 B | 17,720–438,387 B (4–23 MTBS perimeters) |
| manifest.json | 180,296 B | — |
| **release total** | **4,843,604 B (~4.6 MB)** | — |

Composition cost: the five habitat components add about 5.5 KB per 400-cell tile over a forest-type-only tile (9,001 B → ~14,500 B), dominated by real soil rows; public-land geometry remains the largest published asset class.

Representative browser searches measured through the app's own fetch/cache path (cold first run, then a repeat run):

| Search | Tiles selected | Cold GIS bytes | Repeat run |
|---|---|---|---|
| Frisco, CO (39.62, −106.07), 25 mi | n39_w106, n39_w107 | 1,337,407 B (~1.28 MB) | 0 requests, 7 cache hits |
| Regional (38.5, −107.0), 100 mi | 9 tiles (n37–n39 × w106–w108) | ~3.70 MB combined when cold (manifest 180 KB, habitat 131 KB, public land 2.30 MB, fire 1.08 MB, rules 4 KB) | 0 requests after the two searches; gisHits 42 / gisMisses 28 cumulative |

Public-land geometry dominates both searches (62% of the regional cold bytes), fire is 29%, habitat is under 4%, and the manifest is ~5%. A repeated analysis makes **zero GIS network requests**, so the IndexedDB byte cache reuses every asset. Core app assets (`states.js` 118 KB, `ecoregions.js` 1.21 MB) load once per page and are region-independent.

## Bounded expansion plan (post-revision 4)

The revision-4 release is exactly the 11 tiles declared in `summary.coverageTiles`, and it is verified end to end. The next bounded steps, in order:

1. **A second state on the same boundary.** Add northern New Mexico and southern Utah/Colorado Plateau tiles (for example `n36_w106`–`n36_w108`, `n37_w109`, `n36_w109`) using `prepare state --state NM` / `--state UT`. This proves state-scoped soil and collecting-rule jurisdiction beyond one state, and exercises different host/fire regimes.
2. **Extend the Southern Rockies block east/north** (`n38_w105`, `n39_w105`, `n40_w105`, `n40_w106`, `n40_w107` already exist in cache for some) only after the second-state proof, since eastern-plains tiles have different land cover and sparse forest.
3. **Access points** through the regional OSM PBF design below, one bounded region at a time.
4. **National generation only after** a multi-state regional batch verifies with the same commands and measured costs.

Cost model from the real release: 11 tiles required 10 DEM downloads (~50 MB each, cached forever), 11 PAD-US queries and 11 MTBS queries (cached per tile), one national source set, one state soil attribute query and 11 batched point queries. Published output was ~4.6 MB. A 50–100-mile regional search costs ~1.3–3.7 MB once and zero on repeat.

## Access points: design, not priority (revision 4)

Access remains UNBUILT for every release tile and is deliberately not allowed to block habitat work; the manifest, the About coverage panel, the analysis status and the artifact tests all assert it. The scalable design when it is implemented: ingest a regional OSM extract (Geofabrik `.osm.pbf`, e.g. Colorado) and parse it locally with `pyosmium`, selecting the same genuine access features the legacy Overpass adapter used (parking, trailheads, boat ramps, public/permissive gates, visitor information) plus access roads/entrances where mapped. Associate each candidate with a published PAD-US property by local point-in-polygon, keep OSM tags as provenance, and publish per-tile `ap/` Parquet through the existing publisher. No Suggested Start location is manufactured: if no verified feature exists, the tile stays empty and the UI continues to say so. A regional PBF is one bounded download per region, not a per-tile Overpass call, which is what makes the eventual national pass tractable.

## Known limitations / remaining work

1. The bounded release covers 11 Colorado tiles with all five habitat components, public land and fire. Access remains UNBUILT for all of them by design. No other state is published beyond the 40 legacy Ohio/Tennessee tiles.
2. Soil coverage is explicit rather than complete: 26–62 of 400 sampled cells per tile have no drainage class because the sampled mapunit is absent or the attribute is not published. Those cells stay NULL and lower the confidence coverage; no neutral value is invented. Nationally, SSURGO-only coverage means STATSGO2-mapped areas (some western rangeland) would stay NULL rather than being filled with coarse data.
3. gSSURGO/gNATSGO state packages are supported through the same normalized contract (FileGDB, GeoPackage/SQLite and CSV packaging all normalize identically and are tested) but no real package was obtainable from this environment (NRCS Box links 404, GDG 403, Web Soil Survey cart needs a session). The SDA path is the verified production source; a future pass can validate a real package drop-in.
4. 3DEP releases differ per tile (20220216 for the two original tiles, 20260701/20260708 for most new ones) because the older pinned date simply does not exist for every tile. Each release is recorded; mixed-release elevation evidence across tile edges is documented, not normalized away.
5. `spruce_fir` (class 120) is still not present in the release tiles; the spruce/fir signal comes from `fir_spruce_mountain_hemlock` (class 260). Both classes are weighted; a tile where only class 120 occurs has not been exercised.
6. Canopy (TCC 2021) and land cover (Annual NLCD 2023) use different vintages. They are separate signals, and the difference is documented; it is not corrected.
7. Remaining western profiles (PNW, California, Northern Rockies, Great Plains, Southwest, Southeast, Northern Forests) still have no forecasts.
8. Habitat geometry is clipped at tile edges for public land, and the hosted PAD-US service merges same-named units, so two different parks sharing a name inside one tile become one record. `n39_w106` has 2,088 grouped properties (546 KB) — public-land geometry is still the largest per-search asset.
9. Legacy 40 tiles were produced by the old per-point sampler: they lack western host signals, the added land-cover fields and published state jurisdiction. They remain readable (schema union) and rules fall back to the Census lookup.
10. `evidenceGapCap` is an explicit engineering rule, not a scientific finding: it stops a disturbance-dependent target from ranking normally without burn evidence. It is declared in the target data and surfaced in the UI.
11. Snowmelt is a proxy (elevation + season), not a dataset. No degree-day or snowmelt-date source is ingested.
12. Observation support is unavailable for three of the four Southern Rockies targets by design: `porcini`, `morelNatural` and `morelBurn` have no single iNaturalist taxon that avoids aggregating biologically different taxa, so `inat` stays null and the observation component is omitted. Only `chanterelleRoseocanus` has a verified taxon (iNaturalist 499666).
13. Soil is published as environmental evidence; no Southern Rockies model weights it yet because the reviewed sources do not support a calibrated soil-moisture response. Drainage and available water storage therefore raise habitat confidence coverage and display in the habitat panel, but do not change a target score.
14. OPFS remains experimental legacy infrastructure. Actual evidence always registers bytes; metadata-only VERIFIED cannot bypass registration.
15. Manifest `datasetVersion` is content-addressed (`content-<hash>`) because the publisher owns it. Anything asserting a literal date should read the manifest instead.
16. The safety/access surfaces are unchanged: a forecast never establishes identity, edibility, access or legality.

## Final verification (2026-09-14, revision 4)

    npx playwright test tests/fruiting-forecast.spec.js tests/fruiting-forecast-gis.spec.js tests/fruiting-forecast-huntability.spec.js tests/fruiting-forecast-access-theme.spec.js tests/fruiting-forecast-openrouter.spec.js tests/fruiting-forecast-about.spec.js tests/fruiting-forecast-conus.spec.js --reporter=line --workers=3

**79 passed, 1 skipped (58.8 s at `--workers=3`).** The skipped test is the opt-in live Princeton GIS run (`FF_LIVE_GIS=1`). The 26-test CONUS/Colorado spec now asserts the bounded 11-tile release: every release tile has all five habitat components (soil AVAILABLE) and all four declared layers, representative asset digests match the manifest, `summary.coverageTiles` is exact, and DuckDB-Wasm loads the western tiles plus a legacy eastern tile with real soil evidence differing between tiles.

    uv run --with duckdb tests/test_fruiting_tile_publish.py
    uv run --with duckdb --with rasterio tests/test_fruiting_bulk_adapters.py

**2 publication integration tests passed** and **33 adapter tests passed**: forest-type and land-cover legends, canopy conversion, component contract, DEM naming/units plus per-tile release resolution, sampling grid, envelope/clip, cache readiness/corruption/partial-download/checksum gating, Soil Data Access prepare/point-join/ambiguity/failure/empty paths, package soil path, cross-source normalization equivalence, habitat composition with optional sources absent, legacy-tile backward compatibility, and the committed bounded release (component/layer completeness, real SSURGO values with explicit gaps, release-scope manifest assertions).

    python3 -m py_compile tools/build-fruiting-gis.py tools/fruiting_tile_publish.py tools/build-fruiting-ecoregions.py tools/build-fruiting-states.py tools/fruiting_bulk_adapters.py
    .agents/skills/junkdrawer-compliance-audit/scripts/audit.sh fruiting-forecast.html
    git diff --check

All clean: `py_compile` OK; compliance audit 0 errors / 0 warnings with footer and JSON both at 2026.09.14.3; `git diff --check` OK.

## Exact next recommended task

Prove the multi-state path with one bounded batch, then keep scaling only after it verifies:

1. **Add a second state on the same ecological boundary.** Prepare `bulk prepare state --state NM` (and `UT` if the tile set crosses it), then build the northern New Mexico / Colorado Plateau tiles that touch the existing release (`n36_w106`, `n36_w107`, `n36_w108`, `n37_w109`, `n36_w109`) with `--soil-states CO,NM` where a tile spans the line. This exercises state-scoped soil joins, per-state collecting-rule jurisdiction and a different forest/fire regime without leaving the Southern Rockies.
2. **Verify missing data stays honest across the boundary.** Confirm cells in STATSGO2-only or unsurveyed areas stay NULL rather than being gap-filled, and that the manifest component coverage reflects the difference.
3. **Then** extend the block east/north (`n38_w105`, `n39_w105`, `n40_w105`; some DEMs are already cached) and only after that start a national plan.

Also still open: the OSM regional-PBF access adapter (design above), a snowmelt/degree-day source for the morel targets, a reconciled Rocky Mountain `Cantharellus` taxon concept, and validation of a gSSURGO/gNATSGO package drop-in when an operator can obtain one.
