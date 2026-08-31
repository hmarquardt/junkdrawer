# Fruiting Forecast v1 implementation note

Research checked 2026-08-31. This note records the browser/backend boundary for the first static release. It is an engineering decision log, not a claim that any data source can locate mushrooms precisely.

## Ship browser-side now

| Need | Source / contract | Browser fit | Resolution, limits, attribution, caching |
| --- | --- | --- | --- |
| Place search | [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) | JSON, no user key; suitable for explicit city/ZIP searches. Coordinates entered by the user bypass it. | Cache resolved places for 30 days. Attribute Open-Meteo. Failure leaves coordinate entry and browser geolocation usable. |
| Recent and forecast weather | [Open-Meteo Forecast API](https://open-meteo.com/en/docs) | CORS-friendly JSON and supports multiple coordinates in one request. Variables used: precipitation, 2 m temperature/humidity/dew point, VPD, wind, ET0, shallow soil moisture and soil temperature. | Model-grid estimates, not a sensor at the hunt zone. Batch at most 9 zone centroids. Cache successful analyses 3 hours; keep no more than 24 cached responses. No API key for the public non-commercial endpoint; attribution required. |
| Longer historical reconstruction | [Open-Meteo Historical Weather](https://open-meteo.com/en/docs/historical-weather-api) / [Historical Forecast](https://open-meteo.com/en/docs/historical-forecast-api) | Technically browser-queryable and exposes soil/ET0/VPD. | ERA5-Land is about 9 km; historical forecast data is closer to observed day-to-day conditions but begins around 2021/22. Deferred from the live v1 path because `past_days=30` is sufficient for tactical scoring; use for later personal calibration and reproducibility. |
| Regional observations | [iNaturalist v1 API](https://api.inaturalist.org/v1/docs/) | Public reads work browser-side. v1 requests one aggregated, radius-limited query per supported taxon, in sequence. | iNaturalist asks clients to stay near 1 request/second and roughly 10,000/day. Cache 6 hours. Only counts and time buckets are retained; no observation coordinates, usernames, or photos are stored or mapped. Respect [geoprivacy](https://help.inaturalist.org/en/support/solutions/articles/151000169938-what-is-geoprivacy-what-does-it-mean-for-an-observation-to-be-obscured-). Attribution and links stay visible. |
| Basemap | [OpenStreetMap standard raster tiles](https://operations.osmfoundation.org/policies/tiles/) through pinned Leaflet 1.9.4 | Works on static hosting and has a mature no-build client. | Browser HTTP caching is left intact; no prefetch/offline tile scraping. Visible OpenStreetMap attribution is mandatory. The map degrades to a sector list if Leaflet/CDN/tiles fail. |

## Deliberately not treated as live v1 evidence

- **Forest type and host-tree composition:** NLCD canopy/land-cover rasters are useful screening layers but do not establish the oak, hickory, elm, ash, or beech composition required by species models. Forest Inventory and Analysis products can add regional priors, but point-level host inference needs preprocessing. Until that exists, habitat is displayed as missing and lowers confidence; it is never assigned a made-up neutral score.
- **Soils and drainage:** [NRCS SSURGO](https://www.nrcs.usda.gov/resources/data-and-reports/soil-survey-geographic-database-ssurgo) is authoritative and detailed (source mapping commonly 1:12,000–1:63,360), but its normalized schema and spatial joins are too expensive and brittle for repeated ad-hoc browser queries. A backend should preselect drainage, flooding frequency, available water capacity, slope, and woodland-relevant fields, cache polygons, and return a compact zone summary.
- **Public access:** [USGS PAD-US web services](https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-web-services) expose useful fee-manager and public-access layers through ArcGIS. Ownership, easements, designations, and actual access rules are not interchangeable. v1 therefore says “unknown — verify access”; a future service should combine PAD-US with state/local authoritative sources and retain source dates.
- **Tree species probability / biomass:** potentially valuable Forest Service products require regional raster preprocessing and careful interpretation. This is a backend batch job, not a per-click browser workload.
- **GBIF observations:** the [GBIF occurrence API](https://techdocs.gbif.org/en/openapi/v1/occurrence) is appropriate for historical baselines and reproducible DOI-backed downloads. Live search has load-dependent throttling and overlaps heavily with research-grade iNaturalist data. Use it later for historical phenology baselines behind an aggregator, not as a duplicate live feed.

## Data and scoring boundaries

- `WeatherProvider`, `ObservationProvider`, and future `HabitatProvider` / `AccessProvider` return small source-stamped contracts. They do not score species.
- The deterministic scorer consumes a species definition plus normalized zone evidence. Missing components are omitted from the weighted mean and reduce confidence in proportion to missing model weight. Seasonality applies a hard gate so good rain cannot rescue an out-of-season species.
- A forecast record stores model version, generated time, source timestamps, normalized evidence, component scores, weights, penalties, and missing-data notes. This is enough to explain and approximately reproduce score changes.
- Zone circles represent sampled weather-model sectors, not exact fruiting patches. Observation coordinates are never rendered.

## Persistence and retention

- `localStorage`: one guarded, kilobyte-scale preferences object (`fruitingForecast.preferences.v1`) containing preferred location/radius/focus/depth and UI settings.
- IndexedDB `FruitingForecastDB`: `cache` (re-creatable, 3-hour weather / 6-hour observations / 30-day geocodes, hard cap 24), `analyses` (age-pruned to 90 days and capped at 60), `hunts` (user-managed), and `photos` (user-managed blobs cascade-deleted with hunts).
- Cache clearing and hunt-history clearing are separate explicit actions. API failures never overwrite a last successful cached record.

## Backend expansion contract

A future Python service can implement the same conceptual calls:

```text
GET /v1/environment?lat=&lon=&radius_miles=&depth=
GET /v1/observations/signal?taxa=&lat=&lon=&radius_miles=&days=
GET /v1/zones?lat=&lon=&radius_miles=
```

Responses should retain `provider`, `dataset`, `queried_at`, `effective_at`, `resolution`, `license`, `cache_status`, and per-field uncertainty. The browser scorer can then remain deterministic and unchanged while raw GIS joins, scheduled ingestion, sensitive keys, and cross-device persistence move server-side.

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
