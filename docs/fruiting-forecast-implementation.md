# Fruiting Forecast implementation note

Research checked 2026-09-01. This note records the static artifact/data-preparation boundary. It is an engineering decision log, not a claim that any data source can locate mushrooms precisely.

## Ship browser-side now

| Need | Source / contract | Browser fit | Resolution, limits, attribution, caching |
| --- | --- | --- | --- |
| Place search | [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) | JSON, no user key; suitable for explicit city/ZIP searches. Coordinates entered by the user bypass it. | Cache resolved places for 30 days. Attribute Open-Meteo. Failure leaves coordinate entry and browser geolocation usable. |
| Recent and forecast weather | [Open-Meteo Forecast API](https://open-meteo.com/en/docs) | CORS-friendly JSON and supports multiple coordinates in one request. Variables used: precipitation, 2 m temperature/humidity/dew point, VPD, wind, ET0, shallow soil moisture and soil temperature. | Model-grid estimates, not a sensor at the hunt zone. Batch at most 9 zone centroids. Cache successful analyses 3 hours; keep no more than 24 cached responses. No API key for the public non-commercial endpoint; attribution required. |
| Longer historical reconstruction | [Open-Meteo Historical Weather](https://open-meteo.com/en/docs/historical-weather-api) / [Historical Forecast](https://open-meteo.com/en/docs/historical-forecast-api) | Technically browser-queryable and exposes soil/ET0/VPD. | ERA5-Land is about 9 km; historical forecast data is closer to observed day-to-day conditions but begins around 2021/22. Deferred from the live v1 path because `past_days=30` is sufficient for tactical scoring; use for later personal calibration and reproducibility. |
| Regional observations | [iNaturalist v1 API](https://api.inaturalist.org/v1/docs/) | Public reads work browser-side. v1 requests one aggregated, radius-limited query per supported taxon, in sequence. | iNaturalist asks clients to stay near 1 request/second and roughly 10,000/day. Cache 6 hours. Only counts and time buckets are retained; no observation coordinates, usernames, or photos are stored or mapped. Respect [geoprivacy](https://help.inaturalist.org/en/support/solutions/articles/151000169938-what-is-geoprivacy-what-does-it-mean-for-an-observation-to-be-obscured-). Attribution and links stay visible. |
| Basemap | [OpenStreetMap standard raster tiles](https://operations.osmfoundation.org/policies/tiles/) through pinned Leaflet 1.9.4 | Works on static hosting and has a mature no-build client. | Browser HTTP caching is left intact; no prefetch/offline tile scraping. Visible OpenStreetMap attribution is mandatory. The map degrades to a sector list if Leaflet/CDN/tiles fail. |

## GIS evidence: artifact-native decision

The initial note anticipated a lightweight Python API for GIS joins. That runtime-backend direction was evaluated and rejected for this phase: it would make a working static Junkdrawer page dependent on operating, securing, and paying for a service even though the underlying land-cover and soils evidence changes slowly. Fruiting Forecast instead uses this flow:

```text
authoritative GIS releases / services
  → offline Python preparation
  → compact 1° ordinary-Parquet cell tiles + manifest
  → static hosting
  → DuckDB-Wasm query in the browser
  → deterministic species habitat score
```

Python may be used as an offline GIS preparation tool, but Fruiting Forecast has no required application backend. Weather, iNaturalist, hunt logs, and OpenRouter remain usable when WebAssembly or GIS assets are unavailable.

### DuckDB-Wasm deployment

- The page pins `@duckdb/duckdb-wasm` 1.30.0 and imports its prebuilt ES module, worker, and matching EH/MVP Wasm bundle from jsDelivr only when GIS is needed. The EH engine is about 32 MiB compressed-transfer dependent and its worker is about 0.75 MiB. A future fully self-hosted deployment can copy the same pinned distribution files alongside the page without changing provider contracts.
- Ordinary GitHub Pages is not cross-origin isolated, so Fruiting Forecast intentionally uses the single-threaded EH/MVP bundle. The threaded COI bundle would require COOP/COEP headers and could conflict with existing cross-origin weather, map, and intelligence dependencies.
- `INSTALL spatial; LOAD spatial;` is attempted and diagnostics report the result. Current cell tiles use latitude/longitude columns and do not need polygon geometry, so a Spatial-extension failure does not invalidate the simpler distance aggregation path.
- DuckDB-Wasm has browser-specific HTTP behavior and remote Parquet range-read regressions have occurred. Fruiting Forecast therefore selects small tiles in the manifest before download, stores complete tile bytes in IndexedDB, registers those bytes with DuckDB, and queries local registered Parquet files. It does not depend on partial reads of a giant remote state file.
- The application requires HTTP(S) hosting for GIS assets. Direct `file://` preview remains Basic mode because browsers block relative `fetch()` from a null origin. GitHub Pages and `python3 -m http.server` work.
- Wasm memory is browser-managed and less capable of out-of-core work than native DuckDB. Initial files are deliberately small and only intersecting tiles are registered. Safari/Firefox/Chrome are supported by DuckDB-Wasm, but lower-memory mobile browsers may fall back to Basic mode.

Primary DuckDB documentation: [Wasm overview](https://duckdb.org/docs/current/clients/wasm/overview), [instantiation and CDN bundles](https://duckdb.org/docs/current/clients/wasm/instantiation), [deployment assets and threading](https://duckdb.org/docs/current/clients/wasm/deploying_duckdb_wasm), [Wasm extensions](https://duckdb.org/docs/current/clients/wasm/extensions), and [Spatial](https://duckdb.org/docs/current/core_extensions/spatial/overview).

### Static tile layout and selection

`data/fruiting-forecast/manifest.json` records schema version, build timestamp, source provenance, coverage, cell spacing, and each tile's bounding box, byte size, checksum, and row count. Files use a deterministic 1° key such as `n38_w088.parquet`. A radius query first intersects its latitude/longitude bounding box with the manifest and fetches only matching files. It then aggregates cells within a real great-circle distance of each sector.

The initial Southern Indiana build covers approximately 37.5–39.25° N and 89.25–85.25° W, including Princeton/Evansville, Patoka/Pike, and the western/southern Hoosier region. Its 2,800-cell, 0.05° preparation grid is a regional screening surface, not 30 m local precision. The 15 checked-in tiles total about 183 KiB; a Princeton 50-mile analysis selects nine tiles (about 110 KiB) and aggregates roughly 46–50 cells per sector. The manifest preserves native source resolution separately from sample spacing. Broader builds can move to raster-window aggregation without changing the browser schema.

Ordinary Parquet is used because each row is already a pre-aggregated/sample cell. GeoParquet geometry would add bytes without improving the current circular-zone summaries. Polygonal forest-block candidate generation is deferred; the stable 5/9-sector weather architecture is enriched first.

### Authoritative GIS source decisions

| Evidence | Provider / dataset | Native detail and update | Preparation/query method | License / attribution and caveats | Cache policy |
| --- | --- | --- | --- | --- | --- |
| Land cover | USGS/MRLC Annual NLCD 2025 Land Cover | 30 m, annual CONUS series | WMS `GetFeatureInfo` during offline builds; class 41/42/43/90 is forest, open/crop classes remain distinct | U.S. Government public data; credit USGS/MRLC. Classification is modeled land cover, not a stand survey. | Static tile + 30-day browser manifest/tile cache; refresh annually. |
| Tree canopy | USDA Forest Service FIA/Geospatial Office + MRLC Annual Tree Canopy Cover | 30 m percent cover, annual | MRLC WMS point samples | Public federal data; credit USDA Forest Service/MRLC. Canopy is percent cover, not maturity or tree identity. | Refresh annually. |
| Forest/host group | USDA Forest Service FIA/GTAC, Forest Type Groups of the United States | 250 m modeled raster; source publication is older and overall group accuracy is reported around 65% | One-time ~160 MiB national ZIP cached by the build utility, then locally sampled and reduced to oak/hickory, maple/beech/birch, and elm/ash/cottonwood signals | No access constraints; acknowledge USDA FS FIA/GTAC. This is a regional composition signal, never proof that a named host tree occurs at a point. | Refresh when a replacement authoritative product is selected; host quality is deterministically discounted. |
| Soils | USDA NRCS SSURGO via Soil Data Access | Survey mapping commonly 1:12,000–1:63,360; irregular update | SDA point-to-map-unit SQL selects dominant drainage class, available water capacity, flooding, hydrologic group, and representative slope only | Public USDA data; cite NRCS. Map-unit values contain inclusions and are unsuitable for parcel-scale certainty. Missing fields remain null. | Refresh yearly or with a documented SSURGO snapshot. |
| Terrain | USGS 3DEP Elevation Point Query Service | Returns source resolution; often 1/3 arc-second coverage | Offline point query; elevation retained. SSURGO representative slope supplies the initial slope field. | Public USGS data. A cell median is a screening summary; current bootstrap does not claim a terrain-wetness index or aspect. | Effectively permanent unless source/version changes. |
| Public access | USGS GAP PAD-US public-access service | National protected-area polygons; hosted layer edition is not declared in its metadata and uses the PAD-US 3.0-era field schema | ArcGIS FeatureServer polygons are fetched by tile and intersected locally; category, property, and manager are retained | Public federal data; cite the edition recorded at build time. PAD-US notes local gaps and categorical assignments that may not be locally reviewed. Public does not mean mushroom collecting is allowed. | Verify the hosted layer against the current PAD-US release before each rebuild; refresh with releases. |

Official source pages: [MRLC data services](https://www.mrlc.gov/data-services-page), [Forest Type Groups](https://data.fs.usda.gov/geodata/rastergateway/forest_type/), [SSURGO](https://www.nrcs.usda.gov/resources/data-and-reports/soil-survey-geographic-database-ssurgo), [Soil Data Access](https://sdmdataaccess.nrcs.usda.gov/WebServiceHelp.aspx), [USGS elevation services](https://www.usgs.gov/the-national-map-data-delivery/gis-data-download), and [PAD-US web services](https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-web-services).

### Offline refresh workflow

Run from the repository root:

```bash
UV_CACHE_DIR=/tmp/fruiting-uv-cache uv run \
  --with duckdb --with requests --with rasterio \
  tools/build-fruiting-gis.py
```

The utility downloads/caches the FIA forest-group raster outside the repository, queries public authoritative services, writes Zstandard-compressed Parquet tiles, and regenerates the manifest with checksums and actual sizes. `--bbox`, `--step`, and `--workers` make the same pipeline reusable outside Indiana. Build failures do not affect the deployed page because only completed static outputs are committed.

The build utility never emits credentials and no selected provider currently requires an API key. It should be run politely and infrequently; bulk raster-window acquisition is the next optimization before national expansion.

### Deterministic habitat and access boundary

- Species configuration now declares forest/open-cover bands, canopy bands, host-group affinities, relevant soil/drainage fields, slope relevance, and habitat subweights. `scoreHabitat()` applies those declarations; no LLM participates.
- Missing habitat subcomponents remain `null`, are omitted from the habitat weighted mean, and lower habitat confidence. The application never inserts a neutral 50.
- The biological Opportunity score consumes Habitat when available. The original weather-only score is unchanged when habitat is unavailable because the existing missing-component behavior is preserved.
- PAD-US-derived Access / Hunt Utility is always separate. Changing access evidence cannot change Opportunity, rankings, component scores, or season gates.
- Each normalized zone retains source records, dataset version, sampled-cell count, aggregation radius, coverage, and quality modifiers. The OpenRouter evidence digest receives these immutable values for explanation only.

## Deliberately not treated as live browser evidence

- **Raw national rasters/polygons:** the browser never queries entire NLCD, SSURGO, FIA, 3DEP, or PAD-US releases. Offline preparation selects relevant attributes and partitions the result.
- **Tree-level host presence:** forest-type groups are broad modeled evidence with known accuracy limitations. TreeMap or newer species-biomass products may later refine host signals, but the UI must continue to label them as probability/association rather than observed trees.
- **Collecting legality:** PAD-US says something about protected-area/public-access categorization, not harvest permission, parking, closures, limits, or property-line accuracy. State DNR rule links can enrich properties later without changing biological scoring.
- **Aspect and terrain wetness:** the initial data does not support reliable fine-scale values, so those fields remain absent rather than being synthesized.
- **GBIF observations:** the [GBIF occurrence API](https://techdocs.gbif.org/en/openapi/v1/occurrence) is appropriate for historical baselines and reproducible DOI-backed downloads. Live search has load-dependent throttling and overlaps heavily with research-grade iNaturalist data. Use it later for historical phenology baselines behind an aggregator, not as a duplicate live feed.

## Data and scoring boundaries

- `WeatherProvider`, `ObservationProvider`, and `HabitatProvider` return small source-stamped contracts. They do not score species.
- The deterministic scorer consumes a species definition plus normalized zone evidence. Missing components are omitted from the weighted mean and reduce confidence in proportion to missing model weight. Seasonality applies a hard gate so good rain cannot rescue an out-of-season species.
- A forecast record stores model version, generated time, source timestamps, normalized evidence, component scores, weights, penalties, and missing-data notes. This is enough to explain and approximately reproduce score changes.
- Zone circles represent sampled weather-model sectors, not exact fruiting patches. Observation coordinates are never rendered.

## Persistence and retention

- `localStorage`: one guarded, kilobyte-scale preferences object (`fruitingForecast.preferences.v1`) containing preferred location/radius/focus/depth and UI settings.
- IndexedDB `FruitingForecastDB`: `cache` (re-creatable, 3-hour weather / 6-hour observations / 30-day geocodes, hard cap 24), `analyses` (age-pruned to 90 days and capped at 60), `hunts` (user-managed), and `photos` (user-managed blobs cascade-deleted with hunts).
- Cache clearing and hunt-history clearing are separate explicit actions. API failures never overwrite a last successful cached record.

## Future service compatibility

There is no runtime service today. Provider return values nevertheless retain `provider`, `dataset`, `generated_at`, `effective_year`, `resolution`, source URL, sampled-cell coverage, and uncertainty so the same normalized contract could later be supplied by a cache or API if static data proves insufficient. Such a service would be an optional provider swap, not a reason to rebuild the scorer or UI.

## Optional OpenRouter intelligence boundary

Added 2026-08-31. OpenRouter is an explicitly invoked interpretation and research layer; it is not part of the opportunity model.

- `scoreSpecies()`, component values, species weights, the season gate, observation scoring, confidence, zone scores, and `analysis.ranked` remain the only forecast/ranking path. OpenRouter responses are stored only under `analysis.intelligence` and are never parsed into deterministic fields.
- The browser sends a compact evidence digest: immutable rankings and components, broad zones, normalized weather metrics, short forecast arrays, aggregate observation signals, relevant species configuration, missing-input flags, and model version. It does not send raw hourly arrays.
- Analyst Brief and contextual Q&A use `POST https://openrouter.ai/api/v1/chat/completions` only after a user action. Online Intelligence additionally enables OpenRouter's server-operated `openrouter:web_search` and `openrouter:web_fetch` tools; there is no browser-side scraper.
- Current-report provenance is retained from OpenRouter's standardized `url_citation` annotations and recoverable URLs in the response. A missing source list is surfaced as a verification failure, not silently hidden.
- OpenRouter settings are a small guarded preference inside `fruitingForecast.preferences.v1`. The selected model defaults to `openai/gpt-4.1-mini`; the current catalog is fetched from `GET /api/v1/models`, grouped by provider, and cached as one re-creatable IndexedDB record. Catalog failure exposes a manual model-ID fallback.
- Generated briefs, research, and up to 20 Q&A records are attached to the analysis they describe. They inherit the analysis store's 90-day / 60-record retention. Current online research records include a six-hour freshness timestamp and require an explicit refresh.
- Diagnostics include model, request type, duration, status, web-tool state, and returned usage/cost. API keys and authorization headers are redacted and never logged.
- The UI labels all output as AI interpretation of deterministic data and shows deterministic opportunity separately from supporting/neutral/conflicting/insufficient online evidence.

OpenRouter's server-tool APIs are currently beta and may change. Relevant primary documentation: [models schema](https://openrouter.ai/docs/guides/overview/models), [server tools](https://openrouter.ai/docs/guides/features/server-tools/overview), [web search](https://openrouter.ai/docs/guides/features/server-tools/web-search), [web fetch](https://openrouter.ai/docs/guides/features/server-tools/web-fetch), and [usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting).
