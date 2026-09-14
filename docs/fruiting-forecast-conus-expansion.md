# Fruiting Forecast CONUS expansion — authoritative handoff

Work in progress, 2026-09-14. Existing implementation notes describe the legacy app; this document records the expansion and supersedes conflicting coverage/offline claims. Revision 2 (commit after `e1ccb64`) records the Southern Rockies / Colorado milestone: four regional targets, the first real western bulk GIS publication, MTBS burn evidence, per-sector ecological arbitration and state-scoped collecting rules.

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
- Raw bulk adapters live in `tools/fruiting_bulk_adapters.py`: pinned source products are downloaded once into a cache and sampled or clipped locally, never re-downloaded per tile.
- Existing IndexedDB `FruitingForecastDB/cache` stores static tile bytes. Harden this path instead of adding another database. OPFS metadata alone must never skip registering actual Parquet bytes.
- Publication requires explicit per-layer status. A missing normalized source is UNBUILT, never verified empty.
- Collecting-rule and geometry loading stay independent.

## Baseline

`npx playwright test tests/fruiting-forecast.spec.js --reporter=line --workers=2`: 7 passed (8.3 s), before changes.
Previous checkpoint (`e1ccb64`): 68 browser tests passed, 1 opted-out live test skipped.

## Completed in this pass (Colorado / Southern Rockies milestone)

1. Regional biology contract extended with western host keys, elevation bands, a qualitative precipitation band, a disturbance component and an explicit evidence-gap rule.
2. Four Southern Rockies targets moved from RESEARCH_ONLY to PROVISIONAL_FORECAST with per-assertion provenance (see `data/fruiting-forecast/biology-research.json`).
3. First real western GIS publication: tile `n40_w106` (lat 40–41, lon −106..−105, Never Summer / north Front Range) built from pinned local rasters through the normalized-source → publisher → manifest → browser path.
4. MTBS burn perimeters ingested for that tile and a provisional burn-morel disturbance component wired end to end.
5. Per-sector ecological arbitration implemented and regression-tested on a real boundary (see below).
6. Collecting rules scoped by authoritative state jurisdiction with deterministic tests; Indiana behavior unchanged.
7. 23 deterministic CONUS/Colorado browser tests and 10 Python adapter/publication tests added.

## In progress

Nothing is committed mid-refactor. The Colorado milestone is complete; the next pass should begin with raw national bulk adapters (see "Exact next recommended task").

## Remaining / next task

Regional architecture is complete and tested for two profiles (Central & Eastern Hardwood, Southern Rockies). Raw bulk adapters exist for forest type groups, 3DEP elevation, MTBS and PAD-US, but only one Colorado tile has been published. National GIS bulk generation, historical occurrence aggregation and a snowmelt dataset are not implemented. Do not generate hundreds of service-sampled tiles. The 41-tile manifest is 40 legacy Ohio/Tennessee samples plus one real Colorado tile.

## Progress checkpoint — previous revision (checkpoint `e1ccb64`)

Kept for continuity; superseded by "Completed in this pass" above where they differ.

- All 7 Indiana baseline tests passed after regionalization.
- All 12 initial CONUS tests passed: 8 EPA representative locations, Indiana→Colorado→unsupported UI transition, deterministic elevation scoring, coverage semantics, cache version invalidation/storage failure.
- Full run: 65 passed, 1 skipped (opt-in live Princeton), 1 expected old-contract failure: malformed-rules test expected hidden geometry. Updated that assertion to require retained geometry and all UNKNOWN_VERIFY.
- Real Parquet publication integration test passes: checkpoint/resume byte determinism, missing layers, corrupted source retaining previous release, explicit verified-empty.
- EPA release supplied by EPA's current download page contains July 2015 shapefile members. Recorded archive checksum in generated geography. 85 Level III regions, simplification 0.01 degrees and 5-decimal coordinates, ~1.21 MB uncompressed. JS is the file-preview companion to authoritative JSON; only JS is downloaded by the app.
- Colorado UI screenshot reviewed. Removed misleading “exceptional” band from the sparse porcini model; it is explicitly “Provisional season/elevation.” Fixed pre-existing null-moisture comparison that described missing data as unfavorable.
- No national habitat/public-land/access tiles have been generated or fabricated. The bulk publisher consumes normalized source products; raw bulk adapters are still required.

## Files and contracts

- fruiting-forecast.html: FF-1.6.0; base taxon / regional-profile composition, EPA lookup, per-sector biology arbitration, applicability suppression, western host/elevation/precipitation/disturbance components, evidence-gap rule, state-scoped collecting rules, regional model evidence panel, safe IndexedDB byte cache, explicit coverage, independent rule errors.
- data/fruiting-forecast/ecoregions.json and generated ecoregions.js: identical EPA data (only JS loaded in browser for file preview); JSON is build/interchange artifact.
- data/fruiting-forecast/states.json and generated states.js: US Census cartographic state boundaries (1:20,000,000, 2023), simplified to 0.02° (118 KB). Used **only** for collecting-rule jurisdiction. Simplified boundaries mean a property within roughly the tolerance of a state line can resolve to the neighbor state, which fails conservatively to UNKNOWN_VERIFY rather than inheriting a rule.
- tools/build-fruiting-ecoregions.py: EPA Level III geography builder.
- tools/build-fruiting-states.py: US Census state geography builder (`window.FF_STATES`).
- tools/fruiting_bulk_adapters.py: raw bulk adapters. Pinned sources (forest type groups, 3DEP, MTBS, PAD-US, Census states); `prepare` downloads once into a cache, `build` normalizes a tile into publisher inputs. The forest-type-group legend is the authoritative product metadata legend; class 0 means "no forest type group mapped", never missing.
- data/fruiting-forecast/biology-research.json: 22 sources, 12 candidates, 4 southernRockies entries marked `implemented: true`. Every entry carries `supports` / `doesNotSupport` / `missing`.
- data/fruiting-forecast/manifest.json: schema 4 with publisher-recomputed `summary.layers` (populated / verifiedEmpty / unbuilt / failed per layer, consistent with tileCount) plus retained human-readable coverage fields and the biology descriptor.
- tools/build-fruiting-gis.py: legacy sampler plus `build` (publisher) and `bulk` (adapters) dispatch.
- tools/fruiting_tile_publish.py: network-free publication boundary. Four layers (habitat, public-land, access, fire), per-layer source sidecars, schema/count checks, checksums, content-addressed assets, atomic manifest replacement after each layer, incremental merge, lock, and summary maintenance.
- tests/fruiting-forecast-conus.spec.js: 23 deterministic tests: Colorado species cases, fire-evidence cases, geographic suppression, jurisdiction scoping, per-sector boundary arbitration and a hosted artifact/digest check for the real published tile.
- tests/test_fruiting_bulk_adapters.py: 10 deterministic tests for adapter contracts and the committed Colorado publication.
- junk-drawer.json and footer: 2026.09.14.2.

## Rebuild commands

From repository root. Preparation Python only; no browser/server dependency:

    curl -L --fail -o /tmp/us_eco_l3.zip https://dmap-prod-oms-edc.s3.us-east-1.amazonaws.com/ORD/Ecoregions/us/us_eco_l3.zip
    uv run --with pyshp --with shapely --with pyproj tools/build-fruiting-ecoregions.py /tmp/us_eco_l3.zip
    curl -L --fail -o /tmp/cb_2023_us_state_20m.zip https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_20m.zip
    uv run --with pyshp --with shapely --with pyproj tools/build-fruiting-states.py /tmp/cb_2023_us_state_20m.zip

Build and publish one real Colorado tile (the source cache is reused, never re-downloaded per tile):

    uv run --with rasterio --with duckdb --with requests --with shapely --with pyshp tools/build-fruiting-gis.py bulk prepare --tile n40_w106 --cache /tmp/ffsrc
    uv run --with rasterio --with duckdb --with requests --with shapely --with pyshp tools/build-fruiting-gis.py bulk build --tile n40_w106 --cache /tmp/ffsrc --out /tmp/ff-norm --layers habitat,public-land,fire
    uv run --with duckdb tools/build-fruiting-gis.py build tile n40_w106 --source-dir /tmp/ff-norm --resume

Publisher planning and tests:

    uv run --with duckdb --with requests tools/build-fruiting-gis.py build conus --plan
    uv run --with duckdb --with requests tools/build-fruiting-gis.py build bbox -108 37 -105 40 --layer habitat --plan
    uv run --with duckdb tests/test_fruiting_tile_publish.py
    uv run --with duckdb --with rasterio tests/test_fruiting_bulk_adapters.py

State bounds: JSON object with state names and authoritative west/south/east/north bounds. State mode selects intersecting tiles, not state-clipped polygons. CONUS plan selects 955 approximate catalog land tiles, zero network requests. The catalog omits some small/coastal land areas; use bbox/tile until a definitive national footprint replaces it.

Normalized inputs: `<habitat|pl|ap|fire>/<tile>.parquet` plus a `<tile>.parquet.json` sidecar with datasetVersion, sourceUrl and status. WGS84; habitat `elevation_ft` is feet and the 3DEP source is meters, converted once in the adapter; Open-Meteo elevation stays meters. VERIFIED_EMPTY requires a successful complete source query and zero-row schema-correct Parquet. Missing input stays UNBUILT; invalid input becomes FAILED or records a failed attempt alongside intact prior evidence.

Two source-behaviour traps found in this pass, both worth remembering for national expansion:
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

Ingested for tile `n40_w106`: 11 real perimeters (1988–2012 in the current clip), including the Fourmile Canyon, High Park, Picnic Rock and Overland fires. No national burn tiles are published yet.

## Source datasets / versions

- EPA: current official [Level III download page](https://www.epa.gov/eco-research/level-iii-and-iv-ecoregions-continental-united-states); archive members dated 2015-07-17; exact SHA256 in JSON.
- US Census state boundaries: `cb_2023_us_state_20m.zip`, SHA256 `0fd2d6562708ff8182c00d5d25b5556d049ecf2794d97b89ed2dac4d5e9e2c8d`, 186,432 bytes; simplified to 0.02° for the browser.
- USDA FS FIA/GTAC Forest Type Groups: `conus_forestgroup.zip`, SHA256 `5ef0fa8212764e5337f4aeb94569cce144e5cb5a598314bb4f6ac23bf0f7dfbf`, 168,022,806 bytes, archive dated 2012-04-26, ground condition 2004, 28 classes, 250 m, EPSG:5069. Producer reports 65% overall conterminous class accuracy.
- USGS 3DEP 1 arc-second 1°×1° GeoTIFF: `USGS_1_n41w106_20220216.tif`, 51,165,120 bytes, EPSG:4269, meters, nodata −999999. Per-tile release dates vary, so the adapter pins the release per tile and `prepare` reuses the cached file.
- MTBS burned area boundaries: `EDW_MTBS_01/63`, queried with a JSON envelope; retrieval date recorded in the sidecar datasetVersion.
- PAD-US: Esri-hosted public-access FeatureServer (edition not stated by the service, still not freshly audited) plus Census states for jurisdiction.
- Existing NLCD/canopy, forest group, SSURGO, 3DEP and PAD-US legacy samples remain as recorded in the manifest. The 40 legacy Ohio/Tennessee habitat tiles still carry NLCD land cover sampled per point and have no western host signals.
- No national GIS release, occurrence DOI export or national MTBS subset published in this pass.

## Known limitations / remaining work

1. Colorado is credible but sparse in three specific ways: one published tile, no canopy layer, and no soil or access evidence for that tile. The tile status is therefore PARTIAL and says so.
2. `spruce_fir` (class 120) is absent from tile `n40_w106`; the spruce/fir signal there comes from `fir_spruce_mountain_hemlock` (class 260). Both classes are weighted, but a tile where only class 120 occurs has not been exercised.
3. Remaining western profiles (PNW, California, Northern Rockies, Great Plains, Southwest, Southeast, Northern Forests) still have no forecasts.
4. Habitat geometry is clipped at tile edges for public land, and the hosted PAD-US service merges same-named units, so two different parks sharing a name inside one tile become one record.
5. Legacy 40 tiles were produced by the old per-point sampler: they lack western host signals, canopy variation and state jurisdiction. Rules are still correct there only because jurisdiction is derived from the Census lookup when a record has no published state.
6. `evidenceGapCap` is an explicit engineering rule, not a scientific finding: it stops a disturbance-dependent target from ranking normally without burn evidence. It is declared in the target data and surfaced in the UI.
7. Snowmelt is a proxy (elevation + season), not a dataset. No degree-day or snowmelt-date source is ingested.
8. Observation support is unavailable for three of the four Southern Rockies targets by design: `porcini`, `morelNatural` and `morelBurn` have no single iNaturalist taxon that avoids aggregating biologically different taxa, so `inat` stays null and the observation component is omitted. Only `chanterelleRoseocanus` has a verified taxon (iNaturalist 499666).
9. OPFS remains experimental legacy infrastructure. Actual evidence always registers bytes; metadata-only VERIFIED cannot bypass registration.
10. Manifest `datasetVersion` is now content-addressed (`content-<hash>`) because the publisher owns it. Anything asserting a literal date should read the manifest instead.
11. The safety/access surfaces are unchanged: a forecast never establishes identity, edibility, access or legality.

## Final verification (2026-09-14, revision 2)

    npx playwright test tests/fruiting-forecast.spec.js tests/fruiting-forecast-gis.spec.js tests/fruiting-forecast-huntability.spec.js tests/fruiting-forecast-access-theme.spec.js tests/fruiting-forecast-openrouter.spec.js tests/fruiting-forecast-about.spec.js tests/fruiting-forecast-conus.spec.js --reporter=line --workers=3

**76 passed, 1 skipped (55.8 s at `--workers=3`; 39.2 s and identical results on the final `--workers=2` run).** The skipped test is the opt-in live Princeton GIS run (`FF_LIVE_GIS=1`). Two runs under heavier parallel load reported a 30-second browser-context *launch* timeout (`browser.newContext: Test ended`) on a different test each time; every affected test passed on the next clean run, including 10/10 when the access/theme spec was rerun alone. This matches the previous checkpoint's note that Chrome must run outside the filesystem sandbox, so treat context-launch timeouts as environmental, not functional.

    uv run --with duckdb tests/test_fruiting_tile_publish.py
    uv run --with duckdb --with rasterio tests/test_fruiting_bulk_adapters.py

**1 publication integration test passed** (four scenarios: byte-deterministic resume, missing layers, corrupted source retaining previous evidence, explicit verified-empty) and **10 adapter/publication tests passed** covering the forest-type-group legend, DEM naming/units, sampling grid, envelope/clip behaviour, and the committed Colorado tile: western host columns present, 400 real elevations between 4,893 and 13,186 ft, MTBS rows with integer fire years and NULL severity, every public-land row state-scoped and inside the tile, four declared layers, and state-scoped collecting rules.

    python3 -m py_compile tools/build-fruiting-gis.py tools/fruiting_tile_publish.py tools/build-fruiting-ecoregions.py tools/build-fruiting-states.py tools/fruiting_bulk_adapters.py
    .agents/skills/junkdrawer-compliance-audit/scripts/audit.sh fruiting-forecast.html
    git diff --check

Colorado desktop screenshot reviewed at `/private/tmp/ff-colorado.png`: header reads "Southern Rockies · PROVISIONAL"; the Regional model evidence panel lists the four regional targets and marks Mapped habitat / Thermal physiology / Recent reports as not available with an explicit "missing evidence is never scored as a negative biological signal" note; ranked cards show Porcini and Rainbow Chanterelle at 100 (season + elevation only, confidence Low) and both morel targets at 0 with "Fire evidence unavailable" and "out of season". The file:// preview correctly shows habitat as unavailable because static GIS requires HTTP hosting.

## Exact next recommended task

Extend the raw bulk adapters to a second real region and then to a bounded national pass, in this order:

1. **Canopy** (NLCD tree canopy) into the habitat adapter, so `canopy` stops being NULL and the porcini/chanterelle canopy weight becomes real evidence rather than a missing component.
2. **NLCD land cover** into the habitat adapter so `land_class`, `deciduous` and `open_land` are populated for western tiles instead of NULL.
3. **A second Colorado tile** (for example `n39_w106`, Summit/Eagle/White River National Forest) to exercise `spruce_fir` class 120 and a different fire history, and to prove the adapters are restartable across a bbox rather than a single tile.
4. **SSURGO** bulk soil (NRCS gSSURGO by state) so soil drainage and available water capacity are real for western tiles.
5. Only then a bounded regional build (a Colorado bbox) through the publisher, followed by national generation.

Also still open: a snowmelt/degree-day source for the morel targets; a reconciled Rocky Mountain `Cantharellus` taxon concept; and public-land publication for a second state to exercise the jurisdiction model beyond Indiana plus one Colorado tile.
