# Overhead

Overhead is a static, local-first evening observing dashboard. Open [overhead.html](../overhead.html) on the Junkdrawer site. No build, npm installation, backend, account, or API key is needed. Opening the file directly also works, with a cooperative main-thread fallback when the browser disallows workers on `file://`.

## Files and architecture

- `overhead.html`: responsive interface, location, weather, bounded persistence, deterministic briefing, timeline, polar sky chart, and optional map.
- `overhead-engine.js`: pure OMM/TLE parsing, SGP4 sampling, horizon crossings, solar illumination, useful visible intervals, scoring, timezone conversion, and night windows.
- `overhead-worker.js`: background pass calculations with incremental results and cancellation when the observing request changes.
- `vendor/overhead/`: unmodified, pinned satellite.js 6.0.1 and SunCalc 1.9.0, with their MIT and BSD licenses. SunCalc's browser-global export is adapted in the worker host.
- `tests/overhead-engine.cjs`, `tests/overhead.spec.js`: scientific regression checks and browser behavior tests.
- `docs/overhead-validation.json`: results of the broader external ISS comparison.

The existing `index.html` remains the collection landing page; Overhead is registered in `junk-drawer.json`. Its storage ownership is registered in Storage Manager.

## What ships

Tonight is the default. Now covers the next two hours, including daylight orbital geometry when All passes is selected. Next 7 Days shows seven observing nights, each scored by its best remaining likely visible satellite pass among the selected objects. An early-morning visit before sunrise retains the preceding evening's night. Selecting a day reveals its events.

Recommendations are sorted by score, then brightness confidence, then time. Six events appear initially, with explicit pagination. All orbital passes are sorted by time and bypass the minimum-score filter. The night score intentionally describes the best available selected-category opportunity, even when the list's score threshold hides it. Favoriting does not enable an otherwise disabled object category.

Each detail view separates geometric horizon rise/set and full orbital maximum from the displayed, potentially shorter visible segment. The sky chart uses a compass convention: north at the top and east at the right. Start, peak, end, and travel direction are marked. Rings show 30° and 60°; the center is 90°. The trajectory shown is the longest continuous visible interval, while duration sums every useful interval. A pass with fewer than 20 useful seconds is shown as orbital-only.

The timeline includes up to 20 highest-scoring likely visible passes, half-hour cloud samples, twilight shading, precipitation dots, and Moon presence. The astronomy panel adds Moon illumination and position, approximate rise/set within the viewing window, nautical twilight, astronomical darkness, and sunrise. It makes no unsupported planet, meteor, or comet predictions.

Manual coordinates, no-key place search, geolocation, and 12 saved sites are supported. Saving never overwrites an existing saved site; deletion is explicit. Up to 100 spacecraft favorites and small settings remain local.

## Sources and external dependencies

| Source | Use | Network behavior |
| --- | --- | --- |
| [CelesTrak GP data](https://celestrak.org/NORAD/documentation/gp-data-formats.php) | JSON OMM groups `stations`, `visual`, `last-30-days`, and optional `starlink`; OMM supports newer catalog IDs | Default stations and visual; optional catalogs only when selected. Four-hour cache; manual refresh available. |
| [Open-Meteo Forecast](https://open-meteo.com/en/docs) | Hourly total/low/mid/high cloud, visibility, precipitation, humidity, weather code, temperature, and observer timezone | Selected coordinates sent for forecast; timestamps requested as Unix seconds; 30-minute cache. |
| [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api) | City/place names and IANA timezone | Explicit search only. |
| [satellite.js](https://github.com/shashwatak/satellite-js) 6.0.1 | SGP4, Earth-fixed coordinates, observer look angles, solar vector | Vendored; no runtime CDN requirement. |
| [SunCalc](https://github.com/mourner/suncalc) 1.9.0 | Solar/lunar positions, twilight, lunar phase | Vendored; no runtime CDN requirement. |
| [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) 5.6.1 | Optional geographic ground-track map | Pinned JS/CSS from jsDelivr, loaded only on opening the map. |
| [OpenStreetMap tiles](https://operations.osmfoundation.org/policies/tiles/) | Raster map basemap | Loaded on demand with visible attribution; no tile prefetch or persistent tile cache. |
| Repository Analytics Lite | Required Junkdrawer page instrumentation | Existing local script and repository collection endpoint; this page is not tracking-free. |

No commercial satellite-pass service or LLM is used. Free source availability and usage terms still apply; these endpoints are not a commercial service-level guarantee. Site coordinates go to the forecast provider, search text goes to the geocoder, and opening the map exposes tile requests to its provider.

## Sighting score

Let `clamp(x)` constrain a value to 0–1. The deterministic base score is:

| Factor | Points |
| --- | --- |
| Maximum elevation within the displayed visible interval | `25 × clamp((elevation − 5) / 65)` |
| Total time above the chosen minimum, dark, and sunlit | `15 × clamp(seconds / 360)` |
| At least 20 useful sunlit seconds | 10 |
| Observer darkness | `15 × clamp((−SunAltitude − 3) / 12)` |
| Brightness category | `10 × B` |
| Total cloud | `20 × (1 − cloud/100)` |
| Atmospheric visibility | `5 × clamp(visibilityMetres / 20000)` |

`B` is 1 for ISS, 0.88 for Tiangong (NORAD 48274), 0.68 for the CelesTrak visual pool, and 0.35 for otherwise uncertain objects. The sum is multiplied by `0.55 + 0.45 × B` to reduce confidence for objects without a reliably bright category. This is an observing heuristic, not apparent magnitude or a calibrated probability.

With complete cloud, visibility and precipitation data, further multiply by:

```text
(1 − cloud/100)^1.2
× clamp(visibilityMetres / 10000, 0.15, 1)
× (0.35 if precipitation > 0, otherwise 1)
```

Round to an integer in 0–100. Invisible passes score zero. Weather penalties deliberately compound the base weather points so overcast or rainy skies cannot retain a high geometry-only recommendation. If any required weather factor is unavailable, the weather points are zero, weather multipliers are omitted, and the score is visibly provisional. A provisional score is not permission to assume clear skies. Weather is sampled at the segment peak, not interpolated into false minute-level precision.

Labels: 90–100 Don't miss it; 75–89 Excellent; 60–74 Good; 40–59 Possible; 20–39 Poor; 0–19 Not worth it. A night with loaded data and no useful passes is zero; absent orbital data is unknown (—). Moon information does not inflate the satellite opportunity score.

## Geometry, time, and performance

The engine samples geometric horizon elevation every 30 seconds, refines horizon crossings to 250 ms, rejects passes below the configured elevation, then samples viable passes every 2 seconds. It refines useful-visibility transitions to 250 ms and optimizes peak elevation. Numerical resolution is not an accuracy guarantee.

A visible sample must be above the chosen elevation and have observer Sun altitude ≤ −6°. Illumination compares the apparent angular Earth and solar discs from the spacecraft, requiring the full Sun to clear a spherical Earth limb. The Earth radius is 6378.137 km; the Sun's position comes from satellite.js. Penumbra is conservatively excluded. Terrain, atmospheric bending/extinction, Earth oblateness in the shadow model, and spacecraft phase/orientation are not modeled.

Calculations run in a dedicated worker on HTTP(S). Seven nights plus a two-hour Now window are returned incrementally. Large optional catalogs are capped at 200 candidates, with a hard 450-object total ceiling, newest element epochs first; omitted counts are disclosed. Exact orbital-element duplicates of the main stations are suppressed to avoid recommending docked modules separately. Nothing is propagated on an animation frame. Failed workers fall back to yielding between small object batches.

All event instants are UTC milliseconds; selected-location IANA timezones are used for display and evening boundaries. Weather uses Unix seconds. Manual coordinates can resolve their timezone through Open-Meteo or use an explicitly entered IANA timezone. There is no silent browser-timezone fallback. Polar nights/days use 18:00–06:00 local windows when normal sunset/sunrise is absent, and still evaluate actual Sun altitude.

## Cache and failure behavior

IndexedDB contains at most 12 response records, pruned to seven days on writes; an old record is never used beyond seven days. The small volume is appropriate for multiple OMM catalogs and hourly forecasts and avoids the shared localStorage budget. Session memory is also capped at 12 records. Malformed responses do not replace a valid cached copy. No large response goes to localStorage.

Failed refreshes use an eligible cached response with a visible stale warning. If there is no orbital source, no satellite event is invented. Missing weather makes scores provisional. Quota/IndexedDB failure falls back to session memory. Cache clearing preserves preferences, favorites, and sites. There is no background polling of APIs. Entered/imported orbital records remain session-only and are not automatically refreshed.

Elements more than 14 days from a prediction are rejected; elements older than three days produce a caution. Imported OMM arrays and two-/three-line TLE files are supported, with a 2 MB import limit. Refreshing source data does not erase imported records.

## Accuracy validation — September 7, 2026

Compared the ISS epoch `2026-09-07T11:57:47.376864Z` with independent Heavens-Above tables for September 7–13 at sea level:

- [Princeton, Indiana](https://www.heavens-above.com/PassSummary.aspx?satid=25544&lat=38.3553&lng=-87.5675&loc=Princeton&alt=0&tz=UCT)
- [London](https://www.heavens-above.com/PassSummary.aspx?satid=25544&lat=51.5074&lng=-0.1278&loc=London&alt=0&tz=UCT)
- [Cape Town](https://www.heavens-above.com/PassSummary.aspx?satid=25544&lat=-33.9249&lng=18.4241&loc=CapeTown&alt=0&tz=UCT)
- [Equatorial Atlantic, 0° / 0°](https://www.heavens-above.com/PassSummary.aspx?satid=25544&lat=0&lng=0&loc=Equator&alt=0&tz=UCT)

26 of 27 reference sightings match an orbital pass with a useful Overhead interval. The London September 8 interval lasts approximately 17 seconds in this model and is intentionally rejected by the 20-second minimum. A twilight pass in Princeton is retained only after the −6° darkness threshold; its start is 328 seconds later and its displayed visible maximum is consequently lower. These are different visibility definitions, not timing errors silently accepted as accurate.

| Location / UTC date | Reference visible start → peak → end | Reference peak | Result |
| --- | --- | --- | --- |
| Princeton, September 9 | 01:17:02 → 01:20:22 → 01:22:35 | 68°, SE | Within 1 second at all three points; 0.05° peak difference; entry/peak/exit directions match. |
| London, September 9 | 19:56:10 → 19:58:44 → 19:58:44 | 23°, SSE | Within 3 seconds; under 0.5° difference; directions match. |
| Cape Town, September 10 | 04:20:28 → 04:22:09 → 04:23:51 | 13°, NE | Within 1 second; under 0.2° difference; directions match. |
| Equator, September 7 | 04:55:50 → 04:57:38 → 04:59:25 | 14°, NE | Within 1 second; under 0.3° difference; directions match. |

For Princeton's September 9 pass, the [full Heavens-Above pass detail](https://www.heavens-above.com/passdetails.aspx?lat=38.3553&lng=-87.5675&loc=Princeton&alt=0&tz=UCT&cul=en&satid=25544&mjd=61292.0558151772&type=A) gives geometric rise 01:14:57 and set 01:25:48 UTC; both agree within one second. The regression tolerance is 10 seconds for comparable geometric/pass boundaries and 1° for the four selected reference peaks.

The broader comparison is deliberately retained, including less favorable results: London's latest shadow-limited ends differ by up to 6 seconds and its partial-pass maximum by up to 1.5°. Equatorial shadow emergence differs by 22–30 seconds, producing up to 2.75° difference in the visible maximum and adjacent compass-bin differences. Cape Town's September 12 morning segment ends 63 seconds earlier because the Sun reaches −6°. Princeton's September 12 evening start is 46 seconds later for the same darkness rule. Across comparable non-shadow-limited maxima, timing stays within two seconds and elevation within about 0.6°. See [every comparison](overhead-validation.json); do not interpret the four representative rows as a universal bound.

Operational guidance: arrive two minutes early. For equal visibility definitions and fresh elements, 10 seconds / 1° is the regression target. Shadow-edge differences up to 30 seconds are disclosed model uncertainty; differences caused by the darkness cutoff must be explained explicitly. Predictions several days out, and maneuvering/recently launched craft, can diverge further. This is validation against a public predictor, not field-observed photometric validation.

## QA results

`node tests/overhead-engine.cjs` passes with no external network or npm: 116 orbital passes across four sites, including 37 daylight passes, 48 shadowed peaks, 9 passes above 85°, and 22 between 10° and 15°. Assertions cover four external ISS cases, geometric rise/set, monotonic cloud penalties, missing weather, illumination on both sides of Earth, expired elements, local midnight, US and European daylight saving transitions, and polar summer windows.

`npx playwright test tests/overhead.spec.js --reporter=line --workers=1` passes all three Chrome tests. The tests use fixed time and explicit source fixtures, separate from the live-source accuracy checks. They cover the seven-night selector, sky-chart details, favorites, settings recalculation, saved-site deduplication and deletion, Now, source failure without fabricated events, real-element import, stale cache reuse, and cache clearing.

Live-source Chrome QA also loaded 176 objects and calculated roughly 2,400 passes over the eight windows in about 5.2 seconds on the development machine, with no application exceptions or reported source errors. The map loaded and displayed the selected track and observer. This is desktop performance evidence, not a physical-phone benchmark.

| Viewport width | Horizontal overflow | Review |
| --- | --- | --- |
| 390 px | None | Single column, readable compass and event details, collapsible secondary panels. |
| 768 px | None | Two-column content fits; seven-day cards and controls remain usable. |
| 1024 px | None | Recommendations and sky chart visible together. |
| 1440 px | None | Clear briefing, event list, sidebar and timeline hierarchy. |
| 1920 px | None | Bounded content width; no stretched text or chart. |

The map disables wheel, pinch, double-click and rotation zoom. Mouse dragging pans; touch gestures default to page scrolling, with an explicit touch-panning toggle plus zoom, center and fit controls. A separate live Chrome check verified mouse dragging changes the map center, zoom buttons change zoom, observer centering and pass fitting work, wheel motion preserves zoom, and the touch toggle changes the canvas gesture policy. The map is secondary, inside event details, and loads on demand. Physical mobile devices and every browser/assistive-technology combination have not been tested.

Both Overhead and the updated Storage Manager pass the repository compliance audit with zero errors and zero warnings.

## Known limitations

1. A catalog brightness category does not guarantee naked-eye visibility. No modeled magnitude, spacecraft phase, tumbling, light pollution, horizon obstruction, observer elevation input, or empirical photometric calibration yet.
2. Shadow geometry is a spherical approximation. First/last visible seconds and eclipse-limited peak directions can differ from other predictors. See the full validation above.
3. The pass optimizer assumes a single elevation maximum in each short pass. Very long or unusual high-orbit imported passes are less well validated than the LEO MVP.
4. Optional catalogs are deliberately capped. Recent-launch labels come from the source group; no launch time, train/cluster identification, or guaranteed Starlink-train claim is made.
5. Hourly weather is a model forecast, not local sky measurement. Forecast availability and orbital freshness limit seven-day confidence. Weather condition, temperature and humidity are context; cloud, visibility and precipitation determine the weather component of the score.
6. MapLibre requires WebGL and an optional CDN request. Its failure does not disable the sky chart. Touch panning requires an explicit toggle so casual page scrolling does not accidentally move the map.
7. No installable PWA or service worker yet. Vendored calculation libraries and cached data improve resilience, but reopening the hosted page fully offline depends on normal browser caching.
8. No notification scheduling, calendar exports, planets, showers, aurora, comets, or launch feeds in this version. The app does not invent these events.

## Phase 2

Prioritize better observing confidence and notification reliability before adding many feeds:

- Calibrate brightness by known standard magnitude, range and phase; add horizon masks, site elevation, local light pollution, and atmospheric extinction.
- Add a common event-provider interface so NOAA SWPC aurora forecasts, JPL Horizons ephemerides, comets, meteor-shower calendars, planetary observing quality, conjunctions and launch events can return provenance, uncertainty and observing windows without changing satellite propagation.
- Add an explicit “Best event this week” comparison and unusually-interesting-event detection using geometry, rarity, brightness confidence and weather improvements. Treat possible recent-launch clusters as uncertain until launch membership and spacing support the claim.
- Add user-enabled notifications for unusually good passes, including rescheduling after refreshed elements/forecasts. Document browser background limits rather than promise alarms from a closed static tab.
- Expand the already-shipped multiple saved sites with side-by-side forecasts, horizon profiles, import/export, and per-site preferences.
- Add PWA installation and offline application-shell caching, with visible stale-data age and no offline tile hoarding. Keep all optional sources isolated so one failed provider cannot destabilize the satellite briefing.

The frontend-design skill informed the restrained night palette, typographic hierarchy, compact briefing and sky-chart emphasis. The new-page, page-testing, compliance-audit and version-bump skills supplied registration, storage ownership, verification and synchronized release metadata.
