# Fruiting Forecast CONUS expansion — authoritative handoff

Work in progress, 2026-09-14. Existing implementation notes describe the legacy app; this document records the expansion and supersedes conflicting coverage/offline claims. Revision 2 recorded the Southern Rockies / Colorado milestone: four regional targets, the first real western bulk GIS publication, MTBS burn evidence, per-sector ecological arbitration and state-scoped collecting rules. Revision 3 completes the core habitat stack for Colorado: pinned Annual NLCD land cover and NLCD tree canopy adapters, a second independently built Colorado tile, explicit habitat component completeness, a robust national-source cache, and a tested (but not yet fed with a real archive) gSSURGO soil adapter path.

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
- Raw bulk adapters live in `tools/fruiting_bulk_adapters.py`: pinned source products are downloaded once into a cache and sampled or clipped locally, never re-downloaded per tile. Preparation scope is explicit: `prepare national` for national products, `prepare state` for gSSURGO, `prepare tile` for the per-tile 3DEP DEM.
- Canopy is a separate signal from mapped forest type. `canopy` is NLCD Tree Canopy Cover stored as a 0..1 fraction; it can support "forest structure exists" but never substitutes for a spruce-specific mapped host class in the porcini/chanterelle models.
- Land cover is Annual NLCD, sampled at the 0.05-degree cell center. `forest`, `deciduous`, `open_land` reuse the legacy NLCD class mapping so eastern semantics are unchanged; `evergreen`, `mixed_forest` and `wetland` are additive western-era columns. Legacy tiles lack these fields and read them as NULL.
- Habitat completeness is explicit. `habitat.components` declares forestType/elevation/landCover/canopy/soil as AVAILABLE or UNBUILT; `habitat.status` is AVAILABLE only when every required component is present (soil is optional). A Parquet file existing is never completeness.
- The source cache is manifest-backed with version, bytes, SHA256 and a READY marker written only after download + validation. A corrupted or partial download is FAILED and is never treated as ready; large downloads resume from a `.part` file when the server supports ranges.
- Existing IndexedDB `FruitingForecastDB/cache` stores static tile bytes. Harden this path instead of adding another database. OPFS metadata alone must never skip registering actual Parquet bytes.
- Publication requires explicit per-layer status. A missing normalized source is UNBUILT, never verified empty.
- Collecting-rule and geometry loading stay independent.

## Baseline

`npx playwright test tests/fruiting-forecast.spec.js --reporter=line --workers=2`: 7 passed (8.3 s), before changes.
Previous checkpoint (`01aad16`): 76 browser tests passed, 1 opted-out live test skipped; 10 Python adapter tests and 1 publication integration test passed.

## Completed in this pass (revision 3 — canopy, land cover, second tile, soil path)

1. **Tree canopy adapter.** Pinned `nlcd_tcc_conus_2021_v2021-4.zip` (NLCD Tree Canopy Cover CONUS v2021-4, 30 m, values 0–100 percent, 254 = non-processing, 255 = background). SHA256 `7afe3a6856eacd30eb557515e821ab9a491df0e18231b107a2fe129e27541fb0`, 3,740,022,899 bytes. Downloaded once, cached, sampled locally for each tile, converted once to a 0..1 fraction; 254/255 stay NULL.
2. **NLCD land-cover adapter.** Pinned `Annual_NLCD_LndCov_2023_CU_C1V2.zip` (Annual NLCD Land Cover CONUS 2023, Collection 1 Version 2, 30 m, 16-class legend, nodata 250). SHA256 `da50297bc65c07a8210999d20e2b59e69a8d1470273e1ed9344884988fd47aaf`, 1,427,423,034 bytes. Point-sampled at cell centers; `land_class` plus derived cover signals; the full class legend and derivation are recorded in the habitat sidecar and the manifest `habitatSchema`.
3. **Habitat schema v2.** Added additive fields `evergreen`, `mixed_forest`, `wetland` (appended after the original columns so positional reads of legacy tiles still work; mixed-schema reads use `union_by_name`). Browser aggregation exposes them and the habitat panel shows evergreen cover. Legacy Indiana files are unchanged and still readable.
4. **Second independently built Colorado tile.** `n39_w106` (lat 39–40, lon −106..−105; Summit/Eagle/White River National Forest, Dillon/Silverthorne/Vail, Gore Range, Flat Tops approaches). Chosen because it differs meaningfully from `n40_w106`: different elevation distribution (5,177–13,296 ft vs 4,893–13,186 ft), different conifer composition (ponderosa 81, Douglas-fir 54, lodgepole 54, fir/spruce/mountain hemlock 62, aspen 12 cells vs `n40_w106`'s spruce/fir-heavy mix), more land-cover variety (183 evergreen, 73 grass, 70 shrub, 14 developed-medium), no `fir_spruce_mountain_hemlock`-only host composition, and a different fire history (15 MTBS perimeters vs 11, including larger burn scars). Built from the raw cached sources through the same adapter → normalized → publisher → manifest → browser path with no copied normalized data.
5. **Explicit habitat completeness.** Every bulk habitat sidecar and manifest entry now carries `components` and `requiredComponents`; the publisher recomputes `summary.layers.habitat.available` and per-component coverage; About/Data & diagnostics shows complete vs partial tiles and per-component availability.
6. **National-source cache manifest.** `source-manifest.json` records status/scope/archive/bytes/SHA256/datasetVersion/member metadata per source. `prepare national` validates and marks READY, FAILED stays FAILED, and `_prepared_member` refuses to extract an unready source. The CLI no longer implies that a tile build downloads national products.
7. **Composed habitat build.** `bulk build --tile … --layers habitat,public-land,fire` composes forest type + elevation + land cover + canopy (+ optional gSSURGO soil) in one habitat call. The caller never stitches intermediate fragments; the publisher stays network-free.
8. **gSSURGO soil adapter path.** State-scoped `prepare state` + mapunit-raster/`muaggatt` join with explicit units and NULL-preserving semantics, tested against a synthetic gSSURGO-shaped package. No Colorado state package was obtained in this pass, so both Colorado tiles declare `soil: UNBUILT` and keep soil columns NULL (documented limitation, not fabricated).
9. **Tests.** 26 deterministic CONUS/Colorado browser tests (up from 23), including a real DuckDB-Wasm load of both western tiles plus a legacy eastern tile; 24 adapter unit tests (up from 10); 2 publication integration tests (up from 1).

## In progress

Nothing is committed mid-refactor. Revision 3 is complete and verified. The soil adapter is implemented and tested but has not consumed a real NRCS state archive yet (see Known limitations).

## Remaining / next task

The core habitat stack is complete for two Colorado tiles. What remains before regional scaling: a real gSSURGO Colorado state package for soil evidence, a third tile to exercise a different state/host mix, and the bounded Southern Rockies batch below. National GIS bulk generation, historical occurrence aggregation and a snowmelt dataset remain unimplemented. Do not generate hundreds of service-sampled tiles.

## Progress checkpoint — previous revision (checkpoint `01aad16`)


Kept for continuity; superseded by "Completed in this pass" above where they differ.

Revision 2 completion summary (commit `01aad16`):

- Regional biology contract extended with western host keys, elevation bands, a qualitative precipitation band, a disturbance component and an explicit evidence-gap rule.
- Four Southern Rockies targets moved from RESEARCH_ONLY to PROVISIONAL_FORECAST with per-assertion provenance.
- First real western GIS publication: tile `n40_w106` (Never Summer / north Front Range) built from pinned local rasters through the normalized-source → publisher → manifest → browser path; 400 cells, 11 real MTBS perimeters, state-scoped public land.
- Per-sector ecological arbitration implemented and regression-tested on a real boundary; collecting rules scoped by authoritative state jurisdiction.
- 23 deterministic CONUS/Colorado browser tests and 10 Python adapter/publication tests added; full run 76 passed, 1 skipped.

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
- tools/fruiting_bulk_adapters.py: raw bulk adapters. Pinned sources (forest type groups, Annual NLCD land cover, NLCD tree canopy, 3DEP, MTBS, PAD-US, Census states, gSSURGO); `prepare national|state|tile` prepares once into a manifest-backed cache, `build` composes a tile into publisher inputs. The forest-type-group legend is the authoritative product metadata legend; class 0 means "no forest type group mapped", never missing.
- data/fruiting-forecast/biology-research.json: 22 sources, 12 candidates, 4 southernRockies entries marked `implemented: true`. Every entry carries `supports` / `doesNotSupport` / `missing`. Unchanged in revision 3.
- data/fruiting-forecast/manifest.json: schema 4 with publisher-recomputed `summary.layers` (populated / verifiedEmpty / unbuilt / failed, `available`, per-component coverage for habitat, consistent with tileCount) plus retained human-readable coverage fields, a `habitatSchema` description, and the biology descriptor.
- tools/build-fruiting-gis.py: legacy sampler plus `build` (publisher) and `bulk` (adapters) dispatch.
- tools/fruiting_tile_publish.py: network-free publication boundary. Four layers (habitat, public-land, access, fire), per-layer source sidecars, schema/count checks, checksums, content-addressed assets, atomic manifest replacement after each layer, incremental merge, lock, and completeness-aware summary maintenance.
- tests/fruiting-forecast-conus.spec.js: 26 deterministic tests: Colorado species cases, fire-evidence cases, geographic suppression, jurisdiction scoping, per-sector boundary arbitration, hosted artifact/digest checks for both real Colorado tiles, a real DuckDB-Wasm load of both western tiles plus a legacy eastern tile, canopy/land-cover scoring behavior, and habitat completeness semantics.
- tests/test_fruiting_bulk_adapters.py: 24 deterministic tests for adapter contracts, the cache manifest/checksum/corruption path, the gSSURGO soil path (synthetic package), habitat composition with missing optional sources, legacy-tile backward compatibility, and both committed Colorado publications.
- tests/test_fruiting_tile_publish.py: 2 publication integration tests (incremental integrity/empty/failure and completeness components).
- junk-drawer.json and footer: 2026.09.14.3.

## Rebuild commands

From repository root. Preparation Python only; no browser/server dependency:

    curl -L --fail -o /tmp/us_eco_l3.zip https://dmap-prod-oms-edc.s3.us-east-1.amazonaws.com/ORD/Ecoregions/us/us_eco_l3.zip
    uv run --with pyshp --with shapely --with pyproj tools/build-fruiting-ecoregions.py /tmp/us_eco_l3.zip
    curl -L --fail -o /tmp/cb_2023_us_state_20m.zip https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_20m.zip
    uv run --with pyshp --with shapely --with pyproj tools/build-fruiting-states.py /tmp/cb_2023_us_state_20m.zip

Prepare the national products once (forest type groups, Annual NLCD land cover, NLCD tree canopy, Census states), then the per-tile DEM, then compose and publish each tile. A prepared source is never re-downloaded per tile:

    uv run --with rasterio --with duckdb --with requests --with shapely --with pyshp tools/build-fruiting-gis.py bulk prepare national --sources forest-type,land-cover,canopy,states --cache /tmp/ffsrc
    uv run --with rasterio --with duckdb --with requests --with shapely --with pyshp tools/build-fruiting-gis.py bulk prepare tile --tile n40_w106 --cache /tmp/ffsrc
    uv run --with rasterio --with duckdb --with requests --with shapely --with pyshp tools/build-fruiting-gis.py bulk prepare tile --tile n39_w106 --cache /tmp/ffsrc
    uv run --with rasterio --with duckdb --with requests --with shapely --with pyshp tools/build-fruiting-gis.py bulk build --tile n40_w106 --cache /tmp/ffsrc --out /tmp/ff-norm --layers habitat,public-land,fire
    uv run --with rasterio --with duckdb --with requests --with shapely --with pyshp tools/build-fruiting-gis.py bulk build --tile n39_w106 --cache /tmp/ffsrc --out /tmp/ff-norm --layers habitat,public-land,fire
    uv run --with duckdb tools/build-fruiting-gis.py build tile n40_w106 --source-dir /tmp/ff-norm --resume
    uv run --with duckdb tools/build-fruiting-gis.py build tile n39_w106 --source-dir /tmp/ff-norm --resume

`bulk sources --cache /tmp/ffsrc` prints the pinned registry plus the cache readiness manifest. Corrupted archives remain FAILED until replaced. `bulk prepare state --state CO` prepares a gSSURGO state package when one is present; `bulk build --soil-states CO` composes it into habitat.

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

Ingested for tile `n40_w106`: 11 real perimeters (1988–2012 in the current clip), including the Fourmile Canyon, High Park, Picnic Rock and Overland fires. Ingested for tile `n39_w106`: 15 real perimeters in the Summit/Eagle/White River country. No national burn tiles are published yet.

## Source datasets / versions

- EPA: current official [Level III download page](https://www.epa.gov/eco-research/level-iii-and-iv-ecoregions-continental-united-states); archive members dated 2015-07-17; exact SHA256 in JSON.
- US Census state boundaries: `cb_2023_us_state_20m.zip`, SHA256 `0fd2d6562708ff8182c00d5d25b5556d049ecf2794d97b89ed2dac4d5e9e2c8d`, 186,432 bytes; simplified to 0.02° for the browser.
- USDA FS FIA/GTAC Forest Type Groups: `conus_forestgroup.zip`, SHA256 `5ef0fa8212764e5337f4aeb94569cce144e5cb5a598314bb4f6ac23bf0f7dfbf`, 168,022,806 bytes, archive dated 2012-04-26, ground condition 2004, 28 classes, 250 m, EPSG:5069. Producer reports 65% overall conterminous class accuracy.
- Annual NLCD Land Cover 2023: `Annual_NLCD_LndCov_2023_CU_C1V2.zip`, SHA256 `da50297bc65c07a8210999d20e2b59e69a8d1470273e1ed9344884988fd47aaf`, 1,427,423,034 bytes, member `Annual_NLCD_LndCov_2023_CU_C1V2.tif`, 30 m, 16 classes (11–95), nodata 250, CONUS Albers (EPSG:5070 parameters). Product page `https://www.mrlc.gov/data/nlcd-2023-land-cover-conus`; the archive was retrieved from the MRLC data-bundles URL recorded in the source registry.
- NLCD Tree Canopy Cover CONUS v2021-4: `nlcd_tcc_conus_2021_v2021-4.zip`, SHA256 `7afe3a6856eacd30eb557515e821ab9a491df0e18231b107a2fe129e27541fb0`, 3,740,022,899 bytes, member `nlcd_tcc_conus_2021_v2021-4.tif`, 30 m, values 0–100 percent, 254 = non-processing area, 255 = background, CONUS Albers. Product page `https://www.mrlc.gov/data/nlcd-2021-tree-canopy-cover-conus`. The canopy vintage is 2021 while land cover is 2023; the two-year difference is documented, not corrected.
- USGS 3DEP 1 arc-second 1°×1° GeoTIFF: `USGS_1_n41w106_20220216.tif` (tile `n40_w106`) and `USGS_1_n40w106_20220216.tif` (tile `n39_w106`), ~51 MB each, EPSG:4269, meters, nodata −999999. Per-tile release dates vary, so the adapter pins the release per tile and `prepare tile` reuses the cached file.
- MTBS burned area boundaries: `EDW_MTBS_01/63`, queried with a JSON envelope; retrieval date recorded in the sidecar datasetVersion. `n40_w106` 11 perimeters, `n39_w106` 15 perimeters.
- PAD-US: Esri-hosted public-access FeatureServer (edition not stated by the service, still not freshly audited) plus Census states for jurisdiction.
- gSSURGO: NRCS state package; no Colorado archive obtained in this pass, adapter path tested with a synthetic package. Product page `https://www.nrcs.usda.gov/resources/data-and-reports/gridded-soil-survey-geographic-gssurgo-database`.
- The 40 legacy Ohio/Tennessee habitat tiles still carry NLCD land cover sampled per point, forest-group signals from the old sampler and no western host signals; they are unchanged and readable.

## Habitat data size measurements (revision 3)

Measured on the committed assets (`data/fruiting-forecast/`), not estimates:

| Asset | n40_w106 | n39_w106 | Legacy tiles (min / median / max) |
|---|---|---|---|
| habitat Parquet | 11,020 B | 11,148 B | 6,669 / 13,299 / 16,816 B |
| public-land Parquet | 474,064 B | 545,978 B | 412 / 21,030 / 545,978 B |
| fire Parquet | 44,980 B | 156,854 B | 44,980 B (n40) |
| habitat schema growth | the three additive land-cover columns plus canopy/land-class evidence add about 2 KB per 400-cell tile (9,001 B before → 11,020 B after for `n40_w106`); the new fields did not explode file size |

Representative browser search measured with a real 25-mile analysis at Frisco, Colorado (39.62, −106.07), fetching through the app's own cache path:

| Requested asset | Bytes |
|---|---|
| manifest.json | 70,901 B |
| habitat/n39_w106 | 11,148 B |
| public-land-rules.json | 3,999 B |
| pl/n39_w106 | 545,978 B |
| fire/n39_w106 | 156,854 B |
| **GIS total** | **788,880 B (~770 KB)** |

Second run of the same analysis: **zero GIS network requests** (`gisHits 4`, `gisMisses` unchanged), so the IndexedDB byte cache reuses all four assets. Core app assets (`states.js` 118 KB, `ecoregions.js` 1.21 MB) are loaded once per page, independent of region. Public-land geometry dominates the per-search cost; habitat itself is negligible.

## Bounded Colorado build plan (dry run, revision 3)

Publisher dry run for the Southern Rockies bbox `-108 37 -105 40` (`build bbox -108 37 -105 40 --plan`): **9 one-degree tiles, 0 network requests**, ids `n37_w106 n37_w107 n37_w108 n38_w106 n38_w107 n38_w108 n39_w106 n39_w107 n39_w108`. Adding the two verified tiles above the line (`n40_w106`, `n40_w107`) gives a bounded 11-tile Colorado region.

- **Source preparation needed once:** forest type groups (168 MB), Annual NLCD land cover (1.43 GB), NLCD TCC (3.74 GB), Census states (186 KB) — already prepared and checksum-verified for this pass.
- **Per tile:** one 3DEP DEM (~50 MB download, cached), one PAD-US query (cached per tile), one MTBS query (cached per tile). No national product is downloaded per tile.
- **Estimated output size from the two real tiles:** habitat ~11 KB/tile; public land 0.4–0.55 MB/tile in these mountain tiles; fire 45–157 KB/tile. A conservative 11-tile region is roughly **6–10 MB** of published assets. A 50-mile search spanning ~4 tiles would fetch on the order of **1.5–3 MB** of GIS bytes once; subsequent searches reuse the byte cache.
- **Component expectation:** habitat AVAILABLE (all core components) for every tile built after national preparation; soil UNBUILT until a real gSSURGO state package is prepared; access UNBUILT (no adapter run).
- Recommended order: (1) prepare a real gSSURGO `CO` package and rebuild the two verified tiles with soil; (2) build `n39_w107` and `n38_w107` (Sawatch/Sangre de Cristo, different host and fire mix); (3) then the remaining nine tiles as a bounded batch through the same commands.

## Access points: design, not priority (revision 3)

Access remains UNBUILT for the real Colorado tiles and is deliberately not allowed to block habitat work. The scalable design when it is implemented: ingest a regional OSM extract (Geofabrik `.osm.pbf`, e.g. Colorado) and parse it locally with `pyosmium`, selecting the same genuine access features the legacy Overpass adapter used (parking, trailheads, boat ramps, public/permissive gates, visitor information) plus access roads/entrances where mapped. Associate each candidate with a published PAD-US property by local point-in-polygon, keep OSM tags as provenance, and publish per-tile `ap/` Parquet through the existing publisher. No Suggested Start location is manufactured: if no verified feature exists, the tile stays empty and the UI continues to say so. A regional PBF is one bounded download per region, not a per-tile Overpass call, which is what makes the eventual national pass tractable.

## Known limitations / remaining work

1. Colorado now has two fully built tiles with real forest type, elevation, canopy and land-cover evidence. Soil and access remain UNBUILT for both; the habitat sidecars declare `soil: UNBUILT` and keep soil columns NULL.
2. The gSSURGO adapter is implemented and fixture-tested (state package discovery, mapunit raster sampling, `muaggatt` join, missing attributes stay missing) but no real NRCS Colorado archive was obtained in this pass, so soil evidence is not yet real. The national strategy (one state package per state, mukey raster + `muaggatt`) is documented in the adapter.
3. `spruce_fir` (class 120) is still not present in either Colorado tile; the spruce/fir signal comes from `fir_spruce_mountain_hemlock` (class 260). Both classes are weighted; a tile where only class 120 occurs has not been exercised.
4. Canopy (TCC 2021) and land cover (Annual NLCD 2023) use different vintages. They are separate signals, and the difference is documented; it is not corrected.
5. Remaining western profiles (PNW, California, Northern Rockies, Great Plains, Southwest, Southeast, Northern Forests) still have no forecasts.
6. Habitat geometry is clipped at tile edges for public land, and the hosted PAD-US service merges same-named units, so two different parks sharing a name inside one tile become one record. The second tile has 2,088 grouped properties (546 KB) — public-land geometry is the largest per-search asset.
7. Legacy 40 tiles were produced by the old per-point sampler: they lack western host signals, the added land-cover fields and published state jurisdiction. They remain readable (schema union) and rules fall back to the Census lookup.
8. `evidenceGapCap` is an explicit engineering rule, not a scientific finding: it stops a disturbance-dependent target from ranking normally without burn evidence. It is declared in the target data and surfaced in the UI.
9. Snowmelt is a proxy (elevation + season), not a dataset. No degree-day or snowmelt-date source is ingested.
10. Observation support is unavailable for three of the four Southern Rockies targets by design: `porcini`, `morelNatural` and `morelBurn` have no single iNaturalist taxon that avoids aggregating biologically different taxa, so `inat` stays null and the observation component is omitted. Only `chanterelleRoseocanus` has a verified taxon (iNaturalist 499666).
11. OPFS remains experimental legacy infrastructure. Actual evidence always registers bytes; metadata-only VERIFIED cannot bypass registration.
12. Manifest `datasetVersion` is content-addressed (`content-<hash>`) because the publisher owns it. Anything asserting a literal date should read the manifest instead.
13. The safety/access surfaces are unchanged: a forecast never establishes identity, edibility, access or legality.

## Final verification (2026-09-14, revision 3)

    npx playwright test tests/fruiting-forecast.spec.js tests/fruiting-forecast-gis.spec.js tests/fruiting-forecast-huntability.spec.js tests/fruiting-forecast-access-theme.spec.js tests/fruiting-forecast-openrouter.spec.js tests/fruiting-forecast-about.spec.js tests/fruiting-forecast-conus.spec.js --reporter=line --workers=3

**79 passed, 1 skipped (39.0 s at `--workers=3`).** The skipped test is the opt-in live Princeton GIS run (`FF_LIVE_GIS=1`). The 26-test CONUS/Colorado spec includes a real DuckDB-Wasm query that loads both western tiles plus a legacy eastern tile with `union_by_name=true`.

    uv run --with duckdb tests/test_fruiting_tile_publish.py
    uv run --with duckdb --with rasterio tests/test_fruiting_bulk_adapters.py

**2 publication integration tests passed** (four integrity/failure scenarios plus completeness components) and **24 adapter tests passed**: forest-type and land-cover legends, canopy percent conversion, component contract, DEM naming/units, sampling grid, envelope/clip behaviour, source-cache readiness/corruption/partial-download/checksum gating, the synthetic gSSURGO path, habitat composition with optional sources absent, legacy-tile backward compatibility and both committed Colorado tiles (400 cells each; canopy 0–1 all present; land classes inside the pinned legend; elevation 4,893–13,186 ft and 5,177–13,296 ft; host/land-cover/canopy distributions demonstrably different between the two tiles; fire rows integer years with NULL severity; public land state-scoped and tile-local).

    python3 -m py_compile tools/build-fruiting-gis.py tools/fruiting_tile_publish.py tools/build-fruiting-ecoregions.py tools/build-fruiting-states.py tools/fruiting_bulk_adapters.py
    .agents/skills/junkdrawer-compliance-audit/scripts/audit.sh fruiting-forecast.html
    git diff --check

All clean: `py_compile` OK; compliance audit 0 errors / 0 warnings with footer and JSON both at 2026.09.14.3; `git diff --check` OK.

## Exact next recommended task

Feed the soil adapter with real data, then scale one bounded step:

1. **Obtain a real gSSURGO Colorado state package** (NRCS product page; place the archive in the cache and run `bulk prepare state --state CO`), rebuild `n40_w106` and `n39_w106` with `--soil-states CO`, and republish. This turns `soil: UNBUILT` into real drainage/AWC evidence and exercises the one adapter path that is implemented but not yet fed.
2. **Build `n39_w107` and `n38_w107`** through the exact same commands to prove the pipeline across a bbox and exercise a different host/fire mix (Sawatch and Sangre de Cristo).
3. **Then the bounded 11-tile Southern Rockies batch** planned above, followed by national generation only after that verifies.

Also still open: a snowmelt/degree-day source for the morel targets; a reconciled Rocky Mountain `Cantharellus` taxon concept; public-land publication for a second state beyond the legacy tiles plus the two Colorado tiles; and the OSM regional-PBF access adapter design above.
