# Overhead — Celestial Observation Planner

Technical documentation for the planetary, meteor-shower, comet and special-event capabilities added to
`overhead.html`. It covers the calculation libraries, external source contracts, data pipeline,
event-detection rules, thresholds, ranking, validation fixtures with **measured** tolerances, build and
test procedures, and every known limitation.

Claims are graded throughout:

- **[exact]** deterministic astronomy, validated against JPL Horizons and asserted by tests.
- **[sourced]** copied or derived from a published authoritative dataset with recorded provenance.
- **[estimate]** model output with a measured, stated uncertainty.
- **[unknown]** explicitly not known; shown as unknown instead of being invented.

---

## 1. Architecture

```
overhead.html                      UI: satellite dashboard + 4 observing categories x 3 horizons
overhead-engine.js                 satellites: SGP4 geometry, pass detection, scoring, nights        (unchanged)
overhead-lifecycle.js              satellite event display lifecycle                              (unchanged)
overhead-weekly.js                 satellite weekly ranking                                       (unchanged)
overhead-trains.js                 Starlink train detection                                       (unchanged)
overhead-objects.js                satellite mission metadata                                     (unchanged)
overhead-astro.js          NEW     astronomical layer: positions, alt/az, twilight, windows,
                                   risings/settings, apparition and eclipse searches, catalogue path
overhead-opportunities.js  NEW     unified opportunity model: normalisation, validation, scoring,
                                   dedup, consolidation, ranking, tonight/7-day/90-day plans
overhead-planets.js        NEW     planetary events: visibility, parades, conjunctions, oppositions,
                                   elongations, Moon pairings, eclipses
overhead-meteors.js        NEW     meteor showers: IMO dataset handling, solar-longitude peaks, radiant
                                   geometry, moonlight, local windows
overhead-comets.js         NEW     comets: Kepler propagation, published-ephemeris interpolation, measured
                                   vs predicted brightness, candidates, noteworthy changes
overhead-celestial-plan.js NEW     plan assembly shared by the worker and the inline fallback
overhead-celestial-worker.js NEW   worker entry point
vendor/overhead/astronomy-2.1.19.min.js   pinned Astronomy Engine (MIT, 116 kB)
data/overhead/meteor-showers.json         IMO-derived shower calendar (calendar-year scoped)
data/overhead/comets.json                 comet candidates: elements, brightness, provenance
data/overhead/comet-ephemerides.json      JPL Horizons ephemeris samples
tools/overhead_horizons_fixtures.py       generates the planet/Moon validation fixtures
tools/overhead_meteors_build.py           IMO calendar -> dataset (+ IAU MDC cross-check)
tools/overhead_comets_build.py            SBDB + Horizons + COBS -> datasets (+ independent fixture)
.github/workflows/overhead-data.yml       scheduled refresh, validation gate, commit when changed
```

All astronomy runs in the browser; there is no runtime backend and no API key. The build pipeline exists
only because JPL and COBS send no CORS headers, so their data cannot be fetched from a GitHub Pages
origin.

The celestial calculation runs in `overhead-celestial-worker.js` when workers are available (a 90-day
meteor plan takes about 3.4 s, a 90-day planetary plan about 2.3 s). If workers are unavailable — for
example on `file://` — the identical code in `overhead-celestial-plan.js` runs inline. A test asserts
both paths produce byte-identical plans.

### Calculation library

`Astronomy Engine 2.1.19` (https://github.com/cosinekitty/astronomy), MIT licence, vendored minified
browser build. It supplies DE-derived solar-system positions, topocentric `Equator`/`Horizon` with the
standard refraction model, `SearchRiseSet`/`SearchAltitude`, eclipse searches (`SearchLunarEclipse`,
`SearchLocalSolarEclipse`), apparition searches (`SearchRelativeLongitude`, `SearchMaxElongation`),
`Illumination` (model visual magnitude) and frame rotations (EQJ/ECL/HOR). Satellite work continues to
use satellite.js, and SunCalc remains for the pre-existing satellite panels.

One library function is deliberately not used: `SearchSunLongitude` returns `null` for part of the
year (verified for ecliptic longitudes near 107°–119°, where the Sun's apparent motion is slowest, and
for 281°–297° it converges on the wrong occurrence). `overhead-astro.js` implements the inverse of the
solar longitude by scanning and bisecting on the wrapped residual instead; a test round-trips all 360
integer longitudes to within 0.01°.

### Time, coordinates and units

| Item | Convention |
|---|---|
| Library input | JavaScript `Date` (UTC instants). Local wall clock appears only at the display layer. |
| Zoned wall clock | `OverheadEngine.zonedTime(day, hour, tz)` (existing DST-correct helper). |
| Element epochs / `tp` | TDB Julian dates as published by JPL SBDB. |
| Propagation time | `AstroTime.tt` (terrestrial time), so TDB↔TT never enters user code. |
| Bodies | Topocentric apparent altitude/azimuth (degrees) on the true equator of date, aberration included, library refraction model. |
| Catalogue positions | J2000 RA/Dec (degrees) rotated into the observer's horizontal frame, so precession and nutation are included. |
| Solar-system comparisons | Geometric (light-time corrected, no aberration) J2000 RA/Dec — the quantity JPL Horizons calls astrometric. |
| Right ascension | Degrees everywhere in this layer (Astronomy Engine returns hours; converted once, at the boundary). |
| Angular separation | The library's own vector angle (`AngleBetween`) for catalogue directions; the spherical law of cosines for horizontal coordinates. |
| Interpolation | Catmull-Rom cubic through four published samples, with right ascension unwrapped against a single reference. |

---

## 2. External source contracts

Every source below was exercised while building this; the access column records what actually happened.

| Source | Used for | Access verified | Notes |
|---|---|---|---|
| JPL Horizons `ssd.jpl.nasa.gov/api/horizons.api` | reference truth for validation; comet ephemerides | HTTP 200, no CORS header → server-side only | Comet designation needs `COMMAND='DES=2P;CAP'`; a bare `DES=2P` returns a 61-record index search instead of an ephemeris, and `COMMAND='2P'` errors with "Missing operator". `QUANTITIES='1,19,20'`, `ANG_FORMAT='DEG'`, `EXTRA_PREC='YES'`, `CSV_FORMAT='YES'` give `ra, dec, r, rdot, delta, deldot`. |
| JPL SBDB Query `ssd-api.jpl.nasa.gov/sbdb_query.api` | comet catalog + orbital elements | HTTP 200, no CORS header | Valid comet fields include `full_name,pdes,spkid,kind,e,a,q,i,om,w,tp,epoch,per,M1,K1,first_obs,last_obs,n_obs_used,equinox,orbit_id,condition_code,rms,data_arc`; `m1`/`k1` are **not** valid (HTTP 400) — total magnitude and slope are `M1`/`K1`. Values arrive as strings; `a` may be negative (hyperbolic) or huge (long-period). `sb-cdata` rejects `last_obs`, so filtering happens client-side. Sorting works: `&sort=-last_obs`. |
| COBS `cobs.si/api/*.api` | measured visual and CCD comet brightness | HTTP 200, no CORS header | `comet_list.api`, `comet.api`, `obs_list.api`, `elements.api`. Booleans must be `true`/`false` (not `1`). Every payload carries `signature.version` (observed: 1.5) which the pipeline asserts. Timestamps are UTC but published without a zone suffix. |
| IMO Meteor Shower Calendar | annual shower list: activity, λ⊙ peak, radiant, V∞, r, ZHR | PDF only; `www.imo.net` served a site-restoration shell (HTTP 200, `text/html`, 2 980 bytes) for every path during implementation | The pipeline reads the pinned Internet Archive snapshot `web.archive.org/web/20250712192730id_/…/cal2026.pdf` (988 146 bytes, 28 pages, `application/pdf`, SHA-256 `fde53888…`) and records both the canonical and the retrieved URL. |
| IAU Meteor Data Center `ta3.sk/IAUC22DB/MDC2007/Etc/streamfulldata.txt` | independent radiant cross-check + published radiant drift | HTTP 200, 822 447 bytes | Header documents the columns (LaSun, Ra, De, dRa, dDe, Vg, a, q, e, peri, node, incl). No ZHR column, so it is a cross-check only, never the shower list. |
| Open-Meteo | weather (existing) | CORS-enabled, unchanged | Used for the first few days of a plan only. |

No undocumented endpoints are used, and nothing that cannot be retrieved is simulated.

---

## 3. Data pipeline, versioning and freshness

### 3.1 Meteor calendar — `tools/overhead_meteors_build.py`

Flags: `--year`, `--pdf PATH`, `--mdc PATH`, `--out PATH`, `--fixture PATH`, `--check`, `--print-row-count`.

1. Resolve the calendar PDF (local file → canonical IMO URL → pinned archive snapshot), SHA-256 it and
   record both URLs and the retrieval time.
2. Extract Table 5 (Working List of Visual Meteor Showers, page 25) and normalise the PDF's broken degree
   glyphs (`283 .◦15` → 283.15, `230 ◦` → 230), en-dashes and zero-width spaces.
3. Parse every row with a documented regex, skipping justifiable non-rows (the Antihelion Source row, the
   caption, column headers, page footers) and listing them in `notes`.
4. Refuse to publish unless: ≥ 30 showers; unique 3-letter IAU codes; valid activity month-days; 4. λ⊙ in
   [0,360); RA in [0,360); |dec| ≤ 90; V∞ in 10–80 km/s; r in 1.5–3.5; ZHR an integer 1–200 **or** the
   literal `Var` (stored as `zhr: null` plus an explanatory note); parenthesised peaks flagged.
5. Cross-check every radiant against the IAU MDC list by IAU number and refuse to publish if any matched
   pair differs by more than 5°.
6. Write atomically, re-read and re-validate the artifact, and verify the committed fixture text parses
   to the same row set.

Result: **37 showers, 36 matched to the IAU MDC, worst radiant offset 3.32°** (Sep. Lyncids); 25 showers
carry MDC drift; the Phoenicids' only MDC entry is a 1958-apparition radiant 18.7° away, so it is
published with `mdc.matched: false` and no drift; the June Bootids matched a non-annual parameter set,
which is recorded in `notes`.

### 3.2 Comets — `tools/overhead_comets_build.py`

Flags: `--out`, `--ephemeris-out`, `--horizon-days`, `--max-candidates`, `--step-hours`,
`--sbdb-window-days`, `--sleep`, `--no-network`, `--check`, `--build-fixture`, `--as-of`.

1. One SBDB query sorted by `-last_obs`, filtered to comets observed inside the freshness window with
   usable elements; fragments excluded.
2. Ranking by the IAU total-magnitude model `M1 + 5·log10(Δ) + K1·log10(r)` using a Python two-body
   propagation for r and Δ, then keeping a bounded candidate list.
3. Per candidate, one Horizons `OBSERVER` ephemeris (geocentric, astrometric ICRF/J2000 RA/Dec plus r and
   Δ) over the horizon at 48-hour steps, refined per comet (24/12/8 h) when the object moves quickly,
   with retries and rate limiting.
4. Per candidate, COBS visual and CCD observations over the last 120 days: latest measurement (with
   method, observer count and coma diameter), 30-day median per class, counts, and a least-squares trend
   when there are ≥ 5 points spanning ≥ 10 days.
5. Noteworthy changes computed against the previous artifact with explicit thresholds recorded in the
   file (new object; |Δmagnitude| ≥ 0.7; element epoch change ≥ 1 day; closest approach improving ≥ 20%).
6. Hard validation, then atomic publication.

Result: **16 comets, 2 806 Horizons samples** with an adaptive step (48 h by default, refined to 24 h, 12 h or
8 h for the fastest comets), plus the COBS measurement summary, catalog `generated_at`
and per-source SHA-256 digests recorded; comets with no usable ephemeris are omitted and listed with a
reason.

### 3.3 Scheduled refresh — `.github/workflows/overhead-data.yml`

- Daily 06:23 UTC: comets. Monthly on the 1st at 06:17 UTC: meteor calendar. `workflow_dispatch` accepts
  `target = comets | meteors | both`.
- Steps: record the committed SHA-256s → refresh (tolerating a failed refresh so validation and reporting
  still run) → validate both artifacts with `--check` (hard gate) → validate independently in Node →
  report what changed in the step summary → commit only when a file actually changed → fail the run if a
  refresh step failed.
- Publication is atomic in the scripts, so a failed retrieval leaves the last good dataset in place; the
  page then shows the dataset's own age rather than pretending it is fresh. Nothing is ever deleted by a
  failed run.

---

## 4. Thresholds (one definition, in `overhead-astro.js`)

| Constant | Value | Meaning |
|---|---|---|
| `minAltitudeObservable` | 8° | below this a target is treated as obstructed by terrain, buildings, trees or haze |
| `minAltitudeGood` | 20° | "well placed" |
| `twilight.civil / nautical / astronomical` | −6° / −12° / −18° | solar altitude defining the darkness classes |
| `nakedEyeMagnitude` | 4.5 | point-source naked-eye limit used for optical classification |
| `binocularMagnitude` | 8.5 | point-source binocular limit |
| `cometBinocularMagnitude` | 9.0 | stricter limit for a diffuse comet |
| `moonInterference` | illumination ≥ 0.5 / 0.25, separation ≤ 30° / 45°, Moon altitude ≥ 10° | heuristic moonlight grading (see below) |
| `conjunctionDeg` / `closePairingDeg` | 5° / 2.5° | apparent proximity classes |
| parade eligibility | ≥ 3 classical planets, each ≥ 8° for the whole interval, Sun ≤ −6°, interval ≥ 10 minutes | common observing window |
| radiant altitude for showers | ≥ 20° | a shower is only offered when its radiant is usefully placed |
| ephemeris interpolation | 8–48 hour samples, Catmull-Rom cubic | position error measured ≤ 0.24′ |
| weather horizon | ≤ 84 hours ahead | outside this the observing value is computed without weather and marked provisional |
| plan significance floor | 20 / 100 | below this an event is listed under "calculated but not prioritised" instead of hidden |

Existing satellite definitions are untouched: "likely visible" still means elevation ≥ the configured
minimum, Sun ≤ −6° at the observer, and the spacecraft fully sunlit.

### The moonlight heuristic, stated plainly

The moonlight grade is an *observing-suitability heuristic*, not astronomy. It encodes that a bright Moon
close to a target brightens the sky background, and that a faint diffuse object suffers more than a bright
point source:

- illumination < 0.25, or the Moon below 10° altitude, or separation > 45° → `none`;
- a full Moon (≥ 0.5) within 30°, or any faint target inside 45° → `washed-out`;
- otherwise → `glare`.

---

## 5. Event detection rules

- **Planetary visibility** — topocentric altitude/azimuth, rise/set, solar elongation, `Illumination`
  magnitude and a local window intersected with real darkness. Mercury and Venus may use nautical or civil
  twilight (`allowTwilight`), and the candidate records that it did; Mercury inside 15° of the Sun is
  described as lost in twilight rather than offered.
- **Parades** — a scan of each night's darkest interval at 5-minute steps; a run qualifies only when
  ≥ 3 classical planets are simultaneously above 8° **at every sample of the interval**, the interval lasts
  ≥ 10 minutes, and only planets above the minimum for the whole interval are counted as participants.
  Telescopic planets are reported separately and never promote the parade. Wording always says the planets
  are spread along the ecliptic, never "in a straight line".
- **Conjunctions** — interior local minima of the apparent geocentric separation (coarse scan + ternary
  refinement; minima at the edges of the search window are discarded because they are window artifacts).
  The formal event time and the best local opportunity are both reported, and a minimum that occurs in
  local daylight carries the shift it had to make.
- **Oppositions** — `SearchRelativeLongitude(body, 0)` (heliocentric opposition) plus the local night's
  window so the planet's position at the observer's own midnight is always shown.
- **Greatest elongations** — `SearchMaxElongation`, with the library's morning/evening visibility and the
  local twilight window.
- **Moon/planet pairings** — minimum separation with a 2-hour search step (the Moon moves ~13°/day),
  observability decided by the *common* window in which both are above the minimum altitude during darkness.
- **Lunar eclipses** — `SearchLunarEclipse`, phase times from the published semi-durations, and the Moon's
  altitude at every phase. An eclipse below the horizon is reported but marked not observable, with the
  altitude that makes that true.
- **Solar eclipses** — `SearchLocalSolarEclipse(site)`, which only returns eclipses visible from that
  observer, so an eclipse that happens elsewhere is never presented as local. Obscuration, kind, phase
  times, local altitude and the filter warning are always included.
- **Meteor showers** — active when the local date falls inside the IMO activity window (year wrap handled
  by day-of-year, verified for the Quadrantids and Comae Berenicids); the peak instant is computed from the
  published solar longitude for the requested year, so it is correct in every year and every time zone; the
  radiant is corrected by published drift, clamped to ±15 days from the peak; the local window intersects
  radiant-above-20° with real darkness; moonlight, the darkness level and phase are reported as limiters.
- **Comets** — position from the published Horizons ephemeris when the instant is inside its window
  (Catmull-Rom cubic, exact at every sample), otherwise from the two-body Kepler propagation with the
  tolerance grade for its distance from the element epoch, stated on the card. Brightness is always either
  measured (COBS, with date, method and observer count) or predicted (IAU total-magnitude model, labelled
  as a model value) — never merged, never substituted.

## 6. Ranking, deduplication and the three confidences

**Observing suitability** is a weighted mean over the factors that are actually available, so omitting
weather does not silently deflate a score and a perfect event is still distinguishable from a clouded one:

| Factor | Weight | Quality |
|---|---|---|
| altitude | 30 | (altitude − 5°) / 55°, clamped |
| darkness | 20 | astronomical 1.0, nautical 0.6, civil 0.25, none 0 |
| moonlight | 15 | none 1.0, glare 0.55, washed-out 0 |
| optical demand | 15 | naked eye 1.0 … telescope 0.45 |
| significance | 15 | category-specific, from the engine's own numbers |
| weather | 25 | only inside 84 hours: (1 − cloud cover) × visibility factor × precipitation factor |

Scores are capped at 100 and reported with the factors that produced them. An event that is not observable
from the location scores 0 and says why.

**Deduplication** keys on category, type, objects and either the occurrence (conjunctions, oppositions,
elongations, eclipses — one card per occurrence, keeping the best night) or the local night (showers and
comets — each night is genuinely its own opportunity). Caveats from the discarded duplicate are merged into
the survivor, so no limitation is lost. Cards that overlap in time and share an object are cross-linked
rather than repeated.

**Consolidation** applies to the 90-day horizon: consecutive nights of the same circumstance become one
card that names the run (`nightCount`, first and last night, the best night and every night's score). In a
90-day planetary plan this reduces 165 candidate events to 11 cards; a 90-day meteor plan reduces 340
shower-nights to 17 cards.

**Three confidences, never collapsed into one number:**

1. *Astrometric* — `exact` (validated solar-system geometry), `horizons-sampled` (published ephemeris),
   `catalogue` (meteor radiant), `kepler-close` / `kepler-degraded` / `kepler-unreliable`, or `unknown`.
2. *Observing* — the 0–100 value with a grade of `forecast-included`, `no-usable-forecast` or
   `astronomy-only`.
3. *Phenomenon* — `low` (planetary geometry, eclipses), `statistical` (meteor activity), `high` (comet
   brightness).

---

## 7. Validation fixtures and measured tolerances

All fixtures are generated from live retrievals and committed, so every test runs offline. Each records
the exact query, the HTTP status, the SHA-256 of the raw response and the retrieval time.

| Fixture | Generator | Contents |
|---|---|---|
| `tests/fixtures/overhead/horizons-planets.json` | `tools/overhead_horizons_fixtures.py` | 4 725 samples from 45 JPL Horizons queries: geocentric astrometric RA/Dec/distance for the Sun, Moon and seven planets over 105 days; topocentric airless and refracted AZ/EL for six bodies at three sites (38°N, 34°S, 78°N) |
| `tests/fixtures/overhead/horizons-comets.json` | `tools/overhead_comets_build.py --build-fixture` | 4 comets in 4 orbit classes with SBDB elements, 4 Horizons samples each spanning ≤ 200 and ≥ 300 days from the element epoch, the pipeline's own propagator check, raw SBDB rows and raw COBS payloads |
| `tests/fixtures/overhead/imo-calendar-2026-table5.txt` | `tools/overhead_meteors_build.py` | the normalised IMO Table 5 text with a provenance header; the regression input for the parser, re-parsed independently in JavaScript by the data test |

Measured results (from the test run recorded in §9):

| Quantity | Reference | Measured | Asserted tolerance |
|---|---|---|---|
| Geocentric astrometric RA/Dec, Sun/Moon/planets | JPL Horizons (945 samples) | **25.3″** worst | 180″ (3′) |
| Topocentric astrometric RA/Dec | JPL Horizons (1 890 samples) | **25.4″** worst | 180″ |
| Airless apparent altitude/azimuth | JPL Horizons (1 890 samples) | **21.5″** worst | 180″ |
| Refracted altitude | JPL Horizons refracted AZ/EL | **2.7″** above 10° altitude; 1 670″ worst near the horizon where the two models diverge | 72″ above 10°, 2 160″ overall |
| Distance to the body | JPL Horizons Δ | **0.006 %** worst | 0.20 % |
| Moon topocentric parallax (must not be ignored) | geometry | **0.924°** | 0.5°–1.2° |
| Catalogue (J2000) path vs body path | cross-check | **17.7″** | 30″ |
| Opposition timing | Horizons daily elongation maximum | **0.065 d** | 1 d |
| Greatest elongation value | Horizons daily elongation maximum | **0.01°** | 0.5° |
| Conjunction time and separation | Horizons daily planet separations | Mars/Jupiter 2026-11-16, grid 1.194° vs refined 1.194°, **0.085 d** apart | 1 d, 0.05° |
| Comet propagation, ≤ 400 d from epoch | Horizons ephemeris samples | **0.07″–5.2′** across 10 comets | 15′ |
| Comet propagation, 400–800 d | Horizons ephemeris samples | ≤ 5.2′ | 60′ |
| Comet propagation beyond 800 d | Horizons ephemeris samples | 29′–4 343′ — graded `kepler-unreliable`, labelled approximate in the UI | grade asserted, value reported not constrained |
| Comet ephemeris interpolation | five-point Lagrange reconstruction of the same samples | **0.24′** worst (a linear fit through the same samples would have cost 8.28′ at the fastest comet) | 2′ |
| Comet ephemeris interpolation | trusted two-body propagation at midpoints | 36.9′ worst (dominated by the propagation's own error) | 60′ |
| Browser vs pipeline comet propagator | the fixture's independent Python implementation | **0.541′** worst divergence | 2′ |
| Artifact vs fixture overlap sample | the same Horizons instant in both | **0.00000°** | 0.01° |
| Meteor peak date | the IMO printed maximum | **0.87 d** worst (AMO) | 2 d |
| Meteor radiant | IAU MDC radiant for the same IAU number | **3.32°** worst | 5° |
| Solar-longitude round trip | own inverse | **≤ 0.01°** for all 360 integer longitudes | 0.01° |

Behavioural assertions that are not simple numbers (all in the committed tests):

- Parades: every participating planet is re-verified above the minimum at 1-minute steps across the whole
  advertised interval, and the Sun is below −6° throughout. A polar-summer night with no darkness produces
  no parade at all.
- Mercury: 0 dark-hour offers, 90 refusals and 15 twilight-only offers across a 90-night span at 38°N.
- Eclipses: the 2027-02-20 penumbral lunar eclipse is refused for Indiana (Moon −3.8° at mid-eclipse) and
  offered for Cape Town (45.5°); the 2026-08-12 total solar eclipse is offered for north-west Spain and
  **not** for Indiana; Indiana's next locally visible solar eclipse is 2028-01-26, partial, obscuration < 0.5.
- Meteor dates: a 2025 calendar produces no 2026 predictions, and a missing dataset is refused rather than
  guessed.
- Brightness provenance: the artifact's measured comet brightness is re-derived from the raw COBS payload
  in the fixture, and an empty payload is confirmed to produce no measured value.
- The DOM never contains the words "spectacle", "amazing", "once in a lifetime" or "must see".

## 8. Known limitations

- **Comet brightness is not predictable.** The catalog model can be wrong by several magnitudes, and COBS
  observations are observer- and instrument-dependent. Predicted and measured values are displayed in
  separate labelled fields and never combined.
- **Two-body propagation ignores planetary perturbations and non-gravitational acceleration.** Measured
  against Horizons: 0.07′–5.2′ inside 400 days of the element epoch, worst 3 600″+ (60°+) for comets whose
  elements are a decade old (260P). Those comets are graded `kepler-unreliable` and the card says the
  position is approximate. In normal operation the published ephemeris covers the planning window, so this
  path is a fallback, not the default.
- **Finite ephemeris sampling.** The artifact uses 48-hour steps by default and refines to 24, 12 or 8 hours
  for the fastest comets. Even at 8 hours the fastest sample track has 33′ of node curvature near
  perihelion, which a linear fit would turn into an 8′ position error; the cubic interpolation keeps the
  measured error at ≤ 0.24′. A shorter step would still be strictly better — this is a deliberate
  size/accuracy trade-off (2 806 published samples, a 388 kB artifact fetched once and cached for six hours).
- **Meteor activity is statistical.** Even a perfect radiant and darkness calculation cannot say how many
  meteors you will see. ZHR is displayed as standardized reference data with its definition; no local
  meteor-per-hour number is produced.
- **Weather is only meaningful for a few days.** Beyond 84 hours the observing value is computed from
  geometry and darkness alone and marked provisional.
- **IMO publishes a PDF, not an API.** A new calendar year needs a pipeline run (with the year's snapshot
  recorded); until then the browser refuses to describe the current year with an expired calendar.
- **Planetary magnitudes are model values** used only for optical classification, never as a claim about
  how bright something will look.
- **Local horizon obstructions are not modelled.** Terrain and buildings are represented by the minimum
  altitude threshold, the same convention the satellite side uses.
- **Atmospheric refraction near the horizon** differs between models: the library and Horizons disagree by
  up to 1 670″ below about 3° altitude. Events are therefore judged on airless altitude for geometry and
  the observer minimum keeps results away from that regime.
- **Moonlight grading is a documented heuristic**, not a photometric model, and is applied identically to
  every category.

## 9. Build, test and deploy

No build step is required for the page or its data; everything is served as static files.

```bash
# Astronomy layer against the committed JPL Horizons fixtures (4 725 samples)
node tests/overhead-astro.cjs

# Planetary events, parades, pairings, eclipses
node tests/overhead-planets.cjs

# Meteor showers: dataset handling, peaks from solar longitude, radiant geometry
node tests/overhead-meteors.cjs && node tests/overhead-meteors-data.cjs

# Comets: real catalog + ephemerides, propagator vs Horizons, interpolation, provenance
node tests/overhead-comets.cjs && node tests/overhead-comets-data.cjs

# Unified model: normalisation, dedup, consolidation, scoring, horizons, worker/fallback equality
node tests/overhead-opportunities.cjs

# Existing satellite suite (unchanged behaviour) plus the new interface
npx playwright test tests/overhead.spec.js tests/overhead-celestial.spec.js

# Dataset regeneration and validation
python3 tools/overhead_meteors_build.py --check
python3 tools/overhead_comets_build.py --check
python3 tools/overhead_horizons_fixtures.py --out tests/fixtures/overhead/horizons-planets.json
```

Deployment is the repository's existing GitHub Pages flow from `main`. The scheduled workflow commits
refreshed data; the browser shows each dataset's own age and refuses to use an expired calendar.

The Playwright suite runs the page from `file://`, where Chrome cannot fetch the data artifacts or create
workers, so the celestial tests serve those files from disk and (for the worker test) from a local HTTP
server. The synchronous fallback is therefore exercised on `file://` and the worker path over HTTP, and a
test asserts both produce an identical plan.

## 10. Deliberately excluded

- **No local meteor-per-hour prediction.** No validated model exists for a single observer at a single
  site, so only the published ZHR and the geometry are shown.
- **No comet brightness forecast beyond the catalog model.** The model prediction is shown labelled; no
  brightening extrapolation is presented as fact. A published trend is shown only when the observations
  support it (≥ 5 points over ≥ 10 days) and is attributed to the observations.
- **No arbitrary "visibility" claims.** Every card carries the numbers behind its recommendation.
- **No artificial urgency.** The noteworthy-changes section is empty when nothing meaningful changed.
- **No unrelated astronomy.** No deep-sky objects, no asteroid occultations, no variable stars.
- **No server-side rendering or backend.** Static hosting is sufficient because the pipeline is a build
  step, not a service.
