# ISS field-incident presentation repair — 2026.09.08.10

## Finding, reproduced before the presentation patch

The ISS did not expire. **The UI buried an in-progress, score-zero pass at rank 136 behind the six-row render limit.** The recommendation briefing instead selected **SL-8 R/B at 4:18:14 AM CDT, score 83**. There was no independent current-event awareness surface. “Poor recommendation” therefore became “not rendered,” even with the default minimum score of zero.

The September 8 field observation at approximately 8:21 PM provisionally validates the useful timing for this incident. No propagation, sunlight, parsing or timing code was changed in this repair.

Before changing presentation, a real Chrome browser loaded the .9 implementation with fresh CelesTrak and Open-Meteo sources, while its clock was fixed to September 9 01:18, 01:20 and 01:21 UTC (September 8 local). Instrumentation exposed `displayPasses()` and `candidates()` without changing their behavior. The trace compared the intermediate filter outputs with actual `displayPasses()` IDs and inspected actual DOM nodes. All three instants produced the same suppression:

| Captured field | Value at 8:18, 8:20 and 8:21 PM CDT |
| --- | --- |
| NORAD | 25544 |
| presentInResults | true |
| groups | `["stations", "visual"]` |
| likely | true |
| lifecycle | in-progress |
| recommendationEligible | true |
| displayEligible | true |
| score / recomputed scorePass | 0 / 0 |
| provisional | false |
| brightness | 1 |
| settings.show | likely |
| settings.score | 0 |
| ISS category enabled | true |
| favoriteOnly | false |
| objectInCandidates | true |
| rankBeforeFilters | 136 |
| rankAfterScoreFilter | 136 |
| rankAfterShowFilter | 136 |
| initial row limit | 6 |
| rankAfterLimit | null (excluded) |
| renderedInDOM | false |
| happeningNowInDOM, before fix | false |
| best() | SL-8 R/B, NORAD 21088, 4:18:14 AM September 9 CDT, score 83 |

Ranks are one-based positions among lifecycle-retained, likely-visible passes in the selected window, ordered with the actual recommendation comparator before quality thresholds. Neither category selection, favorites, minimum score nor show mode removed this ISS in the capture. The six-row slice was the decisive DOM exclusion. “Show more” could eventually expose it, but a person outside could not immediately see that it was happening.

The trace is a fresh-source reconstruction, not a recovered copy of the user's original browser cache. It directly reproduces the reported **4:18 AM recommendation / hidden overhead ISS** behavior without inventing malformed times. This resolves the previously unconfirmed *presentation mechanism*; it does not establish the exact minute at which the original device's forecast or UI state changed earlier that evening.

## Score zero: correct weather association, pessimistic forecast-based recommendation

The captured pass peak was `1788916821316.7773` milliseconds: **2026-09-09T01:20:21.316Z**, or September 8 **8:20:21 PM CDT**. Elevation: **67.965°**, not the illustrative 79° from the request.

Open-Meteo was requested with `timeformat=unixtime`, `timezone=auto`, `past_days=1`, and the configured latitude/longitude. Its [official API documentation](https://open-meteo.com/en/docs) specifies UNIX seconds in UTC for unixtime responses. The app divides the pass's milliseconds by 1000; it does **not** add the local offset to hourly epoch values.

- First hourly timestamp: `1788757200` = September 7 05:00 UTC, midnight CDT.
- Selected zero-based index: `floor((1788916821.3167773 − 1788757200) / 3600) = 44`.
- Selected raw timestamp: **`1788915600`** = **September 9 01:00 UTC / September 8 8:00 PM CDT**.
- Returned timezone: **America/Chicago**; offset: **−18000 seconds** (CDT).
- Every adjacent timestamp in the captured 240-hour response is separated by exactly 3600 seconds. The peak belongs inside index 44's hour. No double offset, DST ambiguity or seconds/milliseconds mismatch occurred.

| Raw field | Previous hour, index 43 | Selected hour, index 44 | Next hour, index 45 |
| --- | --- | --- | --- |
| UTC, September 9 | 00:00 | 01:00 | 02:00 |
| CDT, September 8 | 7:00 PM | 8:00 PM | 9:00 PM |
| UNIX seconds | 1788912000 | 1788915600 | 1788919200 |
| cloud_cover % | 100 | **100** | 47 |
| cloud_cover_low % | 0 | **0** | 0 |
| cloud_cover_mid % | 0 | **0** | 0 |
| cloud_cover_high % | 100 | **100** | 47 |
| visibility, meters | 43500 | **37600** | 30100 |
| precipitation, mm | 0 | **0** | 0 |
| weather_code | 3 | **3** | 1 |

The weather record was fresh and non-cached (`cache=false`, `stale=false`). Requested observer: 38.3553, −87.5675. Source key: `weather:38.355,-87.567`. Returned weather grid coordinate: 38.348194, −87.58019, the nearby model grid cell—not another saved observing site. No location change occurred during the capture. All selected scoring fields were finite numbers, not coerced null/undefined values.

Exact score arithmetic:

```text
elevation 24.2173700511 + duration 13.7916666667
+ illumination 10 + darkness 14.0140259854
+ brightness 10 + clouds 0 + visibility 5
= 77.0230627031 base points

ISS brightness multiplier = 1
cloud multiplier = (1 − 100/100)^1.2 = 0
visibility multiplier = 1
precipitation multiplier = 1
final rounded score = 0
```

**Conclusion A, not B:** no weather-association or scoring implementation bug was found. The correct raw forecast drove the existing heuristic to zero. Successful visibility despite this forecast means the recommendation was overly pessimistic for the observer; it does not prove the forecast's *high-cloud area fraction* itself was false. Cloud fraction is not optical opacity. The existing heuristic ignores that distinction. Per scope, neither the forecast interpretation nor score weights were changed in this release.

## Presentation repair

`happeningPasses(now)` consumes existing results using shared lifecycle semantics. Enabled-category events with `in-progress` and `displayEligible` status appear in **HAPPENING NOW**, above the regular briefing and weekly card. This path:

- does not apply the minimum score, “great only” filter or six-row limit;
- does not alter `best()`, weekly ranking, score or exceptional classification;
- puts prominent spacecraft first, deduplicating overlapping Tonight/Now records by NORAD;
- respects the dedicated ISS category toggle, even if the generic Stations category remains enabled;
- scans already calculated windows, so selecting a future night does not conceal a current calculated ISS pass;
- shows the real score, predicted geometry, useful interval end and a forecast caution;
- reuses the existing directions/sky-chart dialog;
- preserves button focus on unchanged minute renders and lets a just-after-end click open the retained details.

For score zero the text reads: **“Orbital opportunity is happening now; forecast conditions may make it difficult to see. Sighting score 0/100.”** It makes no claim of observed visibility. Orbital-only/daylight passes are explicitly marked not predicted visible. The panel disappears after viewing ends; the .9 normal-feed grace behavior remains unchanged.

Scope limitation: this feature consumes calculated records. A location/category/favorites choice that prevents a spacecraft from being calculated still limits coverage; there is no additional propagation or hidden API fetch. A calculated, enabled-category current ISS record bypasses presentation-only favorites/quality filtering in the awareness surface.

Diagnostics now expose the presentation trace for selected, weekly-best and happening-now records: lifecycle, score/recomputed score, raw weather timestamp and adjacent hours, source key/freshness, filters, ranks and separate normal-feed/awareness DOM presence.

## Evidence and validation

The [captured fixture](../tests/fixtures/overhead-incident-2026-09-08.json) contains all three full-pool traces, the raw 240-hour weather response, the actual ISS pass/path, and its six actual top-ranked competitors. The compact deterministic replay intentionally retains only those seven records; ISS is therefore seventh in the replay while the preserved full-source trace records rank 136. Non-ISS paths are reduced to their recorded entry/peak/exit; no orbital timings, coordinates or forecast values are fabricated.

- `tests/overhead-weather-incident.cjs`: exact selected hour/index, every returned field, adjacent records, multiplier arithmetic, null/undefined safety, and repeated Chicago 1 AM DST-hour disambiguation. Passed.
- `tests/overhead-awareness.spec.js`: 8:18/8:20/8:21 replay; zero-score ISS prominent despite unchanged 4:18 AM best recommendation; accessible detail/sky path; score 99 and all three show modes; selected future night; category suppression; unchanged results; focus retention; just-ended click. Passed.
- Responsive QA: 390, 768, 1024, 1440, 1920 px, both themes. Awareness panel visible above the briefing, no horizontal overflow, no theme-induced layout/state changes, visible keyboard focus. Mobile light screenshot deliberately reviewed. Existing palette and typography tokens retained.
- Full deterministic Chrome suite: **16 passed** (including the two awareness tests); the focused awareness tests were rerun after the last focus/click hardening and passed again.
- Existing Node suites passed: 116 orbital passes/four external archived comparisons; 16 weekly scenarios plus 576 score combinations; 20 Train Watch scenarios; 14 metadata scenarios; .9 lifecycle boundaries.

Live-source checks were explicit and separate from fixture QA. The pre-patch full-catalog trace succeeded and captured rank 136 at all three instants. The first post-patch attempt timed out on CelesTrak; it was not counted as a pass. One retry succeeded with fresh stations/weather but reduced catalog coverage: ISS had rank 3 in the smaller normal feed, score still 0, and HAPPENING NOW was present at 8:18, 8:20 and 8:21. Its existing sky-path dialog opened successfully. That partial-source live success is **not** substituted for the full-pool pagination regression; the captured seven-event replay separately proves the six-row-limit fix with the actual 4:18 AM competitor.

## Release scope

Version **2026.09.08.10**. Runtime changes are confined to `overhead.html` presentation/diagnostics. No changes to `overhead-engine.js`, `overhead-weekly.js`, `overhead-lifecycle.js`, Train Watch, metadata, weather fetching, source/cache behavior or maps. No new external dependencies or persistent data.

Files also added/updated: `junk-drawer.json`, this report, `docs/overhead.md`, the historical lifecycle report's follow-up link, the three awareness/weather test files and captured JSON fixture. Frontend-design guidance kept the new surface restrained and consistent; Junkdrawer testing/versioning/compliance skills govern the regression checks and release metadata.
