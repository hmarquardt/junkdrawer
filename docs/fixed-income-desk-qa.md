# Fixed Income Desk — 2026.09.10.2 release and QA

Production baseline preserved: `8c6b2a1`, version `2026.09.10.1`. This release adds an applied Markets layer to the existing single-file application. It does not replace the reference desk or its five original calculators.

## What changed

- Markets is the first primary tab and the first-visit default. Valid existing active-tab preferences still win.
- The original 44 equations, 29 concepts, 16 risk families and 167 glossary entries remain. All previous sections, keyboard tab navigation, local calculators, themes and print modes remain available.
- Ten dated metric cards; interactive Treasury par curve; rate and spread histories; local curve analytics; editable observed-move duration/convexity card; educational portfolio scenarios added inside the existing Lab.
- Eight concise “1990s ME → 2026 ME” callouts connect the new instrumentation to existing explanations.
- Markets search entries and contextual links point into duration, DV01, curve risk, SOFR, real yields, breakevens, carry/roll-down and the risk taxonomy.
- Optional OpenRouter analyst interprets an inspectable, deterministic packet. No model call is needed for market access, calculation or education.
- No analytics. The old Analytics Lite tag was deliberately removed under the user's explicit v2 privacy requirement. The convention audit's missing-analytics warning is expected and does not call for adding tracking back.

## Official market endpoints

Treasury base URL:

```text
https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml
```

Parameters:

```text
?data=daily_treasury_yield_curve&field_tdr_date_value_month=YYYYMM
?data=daily_treasury_real_yield_curve&field_tdr_date_value_month=YYYYMM
?data=daily_treasury_yield_curve&field_tdr_date_value=YYYY
?data=daily_treasury_real_yield_curve&field_tdr_date_value=YYYY
```

The Treasury adapter parses XML using `DOMParser` and namespace-local names. `NEW_DATE` is the observation date; `BC_*` fields are nominal yields and `TC_*` fields are real yields. Null and absent maturities stay missing. The `BC_1_5MONTH` field is displayed as 6W, represented by 1.5/12 years on the tenor axis. No curve is treated as equally spaced categories.

NY Fed endpoints:

```text
https://markets.newyorkfed.org/api/rates/all/latest.json
https://markets.newyorkfed.org/api/rates/all/search.json?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

The separate JSON adapter reads `refRates`, `effectiveDate`, `type`, `percentRate` (with a documented-schema `percent` fallback), `volumeInBillions`, and SOFRAI's `average30day`, `average90day`, `average180day`, and `index`. Implemented types: SOFR, EFFR, TGCR, BGCR, OBFR and SOFRAI. All effective dates are retained individually.

On initial Markets activation, Treasury loads only the current and previous month for nominal and real curves. NY Fed loads latest observations and a two-week comparison window. No decades of data are bundled or downloaded. Historic comparisons load target months as necessary. History ranges request months for short windows and years for longer windows, with at most three queued history fetches in flight. SOFR/EFFR history is requested when selected.

## Browser / CORS verification

Verified with actual Chrome `fetch()` requests from a document whose origin is **https://hmarquardt.github.io**. Only that document was fulfilled by Playwright to simulate the deployed HTML. Requests to Treasury and NY Fed were not intercepted, mocked, proxied, or executed server-side. Readable response bodies with `Response.type === "cors"` establish browser access; curl success was not used as the CORS test.

Reproducible optional network check:

```sh
node scripts/verify-fixed-income-cors.cjs
```

The browser probe checks nominal and real month/year URLs plus NY Fed latest and date-range JSON. All six endpoint patterns returned **HTTP 200, readable CORS responses** on 2026-09-10. The earlier browser probe at 16:18:45 UTC also verified secured SOFR last-N and unsecured EFFR search endpoints, but the page uses the combined endpoints above.

An integrated page check loaded one-year Treasury and NY Fed history from the same origin model. It obtained 422 nominal rows, 422 real rows across the requested Treasury calendar-year files and 1,535 NY Fed reference records; charts then filtered the requested window. Nominal/real curves were dated 2026-09-09, overnight rates 2026-09-09, and SOFR averages/index 2026-09-10. These are recorded QA observations, not hard-coded application defaults. No browser runtime errors or page overflow occurred at desktop/mobile sizes.

Direct browser access is a tested observation, not a permanent guarantee: CORS, source availability and publication policies can change. A failed request yields a local source status and Retry control, with no fallback proxy, third-party scrape or backend.

## Deterministic analytics and dates

All market arithmetic is centralized in pure functions and runs before any model request:

| Measure | Convention |
|---|---|
| 2s10s / 5s30s / 3m10y / 2s30s | Long yield minus short yield, percent-point difference × 100 = bp |
| 5Y / 10Y breakeven | Nominal minus real par yield on the latest common observation date; percent display, bp changes |
| Curve level | Equal-weight mean of 2Y, 5Y, 10Y, 30Y; unavailable if a required node is missing |
| Front / belly / long slopes | 2Y−3M, 10Y−2Y, 30Y−10Y, in bp |
| Butterfly | 2×5Y−2Y−10Y, in bp |
| Maturity moves | Latest minus actual comparison observation at each matched tenor |
| Largest move | Largest absolute matched-tenor bp change |
| Parallel approximation | Equal-weight mean bp change across matched tenors |
| Nonparallel residual | RMS bp deviation from that mean, with the matched tenor count shown |
| Classification | Change in 2s10s; 0.5 bp tolerance; bull/bear only if both 2Y and 10Y move consistently down/up |
| Apply the Math | Existing `shockMetrics`: −D Δy + ½C Δy², using the observed 10Y move |
| Scenario portfolio | Existing shock math plus −spreadDuration × Δspread; explicit assumed values/sensitivities |

Comparisons choose the latest observation **on or before** the target, within ten calendar days. No look-ahead or interpolation is used. Previous-observation mode chooses the preceding date. Week/month/quarter/year targets are calendar offsets; month/year offsets clamp month ends. The actual comparison date appears on cards and the curve.

Breakevens align dates exactly. Historical breakevens do not forward-fill missing real observations. Each NY Fed series uses its own effective and comparison dates. Every displayed observation keeps its source date; retrieval time is never substituted for that date.

Freshness is an approximate display heuristic: more than two business days behind is stale, excluding weekends and modeled US federal holidays. It is not an exhaustive exchange calendar or an assertion that every source has published today. The status distinguishes Loading, Current, Partially available, Stale, Offline and Source error. Optional missing values render as unavailable; missing SOFR or EFFR makes the overall state partial. Failed refreshes retain available session observations with their original dates. History failure does not erase current values.

Treasury curves here are **par**, not zero, curves. “Use Current Market” populates representative bond/shock yields and aligned inflation inputs, but deliberately does not paste par rates into the existing zero-rate forward calculator. The five scenario exposures (2Y/10Y/30Y Treasury, IG corporate, agency MBS) use editable assumed duration, convexity and spread duration; they do not claim corporate or MBS fair valuation.

## Chart library and footprint

uPlot **1.6.32**, MIT license, is vendored inline from its exact upstream release tag. The reviewed distribution is 51,081 bytes of JavaScript plus 1,857 bytes of CSS. Full MIT attribution and SHA-256 identifiers are in source comments. Distribution review found no network requests, dynamic evaluation or externally loaded assets. Functional validation used the chart in real browsers.

- Treasury curve: numeric tenor axis, independent comparison checkboxes, pointer/touch readout and keyboard maturity selector.
- Rate history: 2Y/5Y/10Y/30Y, SOFR, EFFR and real 10Y.
- Spread history: 2s10s, 5s30s, 3m10y and date-aligned 10Y breakeven.
- Ranges: 1M, 3M, 6M, YTD, 1Y, 3Y, 5Y, Max (explicitly capped at 5Y).
- Charts initialize only when Markets is active, resize on viewport changes, and use theme colors. Zoom is disabled; no reset-zoom control is needed. Comparison toggles persist through session refreshes.
- Tables provide numerical equivalents and dates; current metrics do not depend on canvas or color interpretation. Short-range time axes show month/day; longer ranges show month/year.
- Original simple SVG illustrations and calculators remain unchanged.

The complete artifact is approximately **300 KB uncompressed**, with no framework, npm runtime, font fetch, backend, proxy or embedded market dataset. No dependencies were installed for this iteration.

## OpenRouter architecture and security

Endpoints:

```text
GET  https://openrouter.ai/api/v1/models
GET  https://openrouter.ai/api/v1/key
POST https://openrouter.ai/api/v1/chat/completions
```

A password input and namespaced preference hold the optional key. Models load only after a key is saved (or found in existing saved settings). Provider-grouped options come from the current Models API; filtering, context and prompt/completion pricing are shown. Saved/default selection survives catalog failures; default remains `openai/gpt-4.1-mini`. `openrouter/free` is selectable when supplied by the catalog. Test connection authenticates the key without generating a completion.

“Analyze Current Market” is the only completion action. The default mode is Practitioner refresher. A small system instruction and normalized market packet are sent, with no XML, scraped pages, browser credentials, API key or large raw history in the messages. The prompt prohibits invented current facts, silent recomputation and personalized advice; it separates observations from interpretation and requires a constrained educational structure.

The UI displays the exact request body in “Data sent to model”, excluding the Authorization header. Successful analysis records selected model, analysis time, source dates, comparison date, usage tokens and reported cost or an explicitly approximate token-only catalog estimate. Later market refreshes do not rewrite that packet. A failed second request clears the prior result rather than pairing stale commentary with new inputs. Responses are parsed as bounded JSON and inserted as escaped text; concept links are allowlisted. Thought-experiment analysis is hidden until Reveal analysis is opened. Malformed output fails cleanly, without an automatic paid retry.

The key is sent only to OpenRouter in Authorization headers, never to data sources, packets, analytics, logs or printed output. Settings and request inspection are excluded from print. Remove key clears the credential; storage failures get visible feedback. The key is **not encrypted**: the page explicitly explains that JavaScript on the same page/origin can read browser-stored keys. No claims of secure-vault storage are made.

OpenRouter workflows were tested with controlled mocked responses, including catalog failures, authentication feedback, grounded output, token/cost rendering, failed retries, escaping and deletion. **No user API key was supplied and no paid production completion was performed.**

## Storage and retention

| Data | Mechanism | Limit / policy |
|---|---|---|
| Theme and active tab | Existing guarded localStorage keys | One small string each |
| OpenRouter key/model | `fixed-income-desk.openrouter` | One object; key ≤512 characters, model ≤180 characters; normally well below 2 KiB, worst-case JSON/UTF-16 representation below 10 KiB |
| Market observations | Session memory only | ≤1,700 rows per Treasury curve; ≤12,000 normalized reference-rate records |
| Fetch cache | Session memory only | ≤24 entries; normalized rows or fetched-range markers, no persisted XML/JSON |
| Model catalog | Session memory only | ≤1,500 reduced metadata records; bounded name/id strings |
| AI output | Session memory only | One current result/request; bounded parsed sections, max 2,200 requested output tokens |
| Calculator/scenario values | Session memory only | Fixed controls; no history |

No IndexedDB database, growing localStorage payload or new Storage Manager registration is needed: persistent additions are bounded credentials/preferences only. Closing/reloading the page discards market data and AI results.

## QA results

```sh
node node_modules/@playwright/test/cli.js test tests/fixed-income-desk.spec.js tests/fixed-income-markets.spec.js --reporter=line --workers=1
.agents/skills/junkdrawer-compliance-audit/scripts/audit.sh fixed-income-desk.html
```

**24 tests pass**: all nine baseline tests remain, plus fifteen Markets tests. Baseline navigation assertions were adjusted only for the intentional new first tab, and source fixtures were added so the original suite remains network-independent.

Coverage includes XML/JSON parsing, missing maturities, weekend/holiday dates, clamped month offsets, unavailable comparisons, mismatched nominal/real dates, stale/partial/offline/error states, curve metrics/classification, bounded range requests, historical failures, charts at 390/768/1024/1440/1920px, touch/pointer readout, keyboard numerical alternatives, theme changes, all original sections/calculators, cross-links, print modes, observed-move Lab handoff, editable scenarios, key-free AI packets, grouped models/fallbacks, token/cost presentation, reveal interaction and safe failed-analysis provenance.

Known fixture results: 2s10s 30 bp; 5s30s 50 bp; 3m10y 50 bp; 2s30s 60 bp; four-node level 4.45%; butterfly −10 bp. Nominal latest date September 9 and real latest date September 8 align to September 8 for a 2.5% breakeven. An independently selected comparison gives a 20 bp 10Y rise and 10 bp 2s10s steepening. The observed 10 bp scenario with D=8 and C=70 produces −0.7965% before display rounding.

Compliance: **0 errors, 1 intentional missing-analytics warning**, reflecting the user's explicit no-analytics requirement. Footer comment, footer attribute/text and manifest all match **2026.09.10.2**. `git diff --check` passes. Browser fixture tests reported no runtime errors; real-feed browser checks also reported none. Network failure tests allow expected failed-resource diagnostics while asserting the application stays usable.

## Candidate feeds intentionally deferred

| Candidate | Public/authentication/license considerations | Browser verification | Decision |
|---|---|---|---|
| FINRA TRACE, corporate and securitized-product Query API datasets | Public information exists, but production datasets have credential/entitlement and dataset-specific terms; availability must be evaluated per product | No production credentialed CORS claim; documentation reviewed only | Defer reliable trade/credit/MBS data until a specific licensed browser-compatible dataset is selected |
| FRED credit-spread and macro series | Official API requires an API key; underlying series can carry additional rights/terms | No CORS compatibility claim for a shipped adapter | Defer additional credential/data plumbing; Treasury/NY Fed already cover the initial learning task |
| Federal Reserve H.15 downloads | Public official daily rates, with overlap with selected sources | Download documentation reviewed; cross-origin fetch not certified for this release | Defer redundant ingestion and another publication/calendar convention |
| Unofficial mirrors/CORS proxies | Reliability, attribution and redistribution unclear | Not used | Rejected; no proxy fallback or silent scraping |

## New documentation and research links

All retrieved or checked on **2026-09-10**; source documentation is linked from the page's existing Sources section.

- [Treasury XML feed](https://home.treasury.gov/treasury-daily-interest-rate-xml-feed)
- [Treasury curve methodology](https://home.treasury.gov/policy-issues/financing-the-government/interest-rate-statistics/treasury-yield-curve-methodology)
- [NY Fed Markets API](https://markets.newyorkfed.org/static/docs/markets-api.html) and [machine-readable specification](https://markets.newyorkfed.org/static/docs/markets-api.yml)
- [NY Fed publication and rate methodology](https://www.newyorkfed.org/markets/reference-rates/additional-information-about-reference-rates)
- [NY Fed Terms of Use](https://www.newyorkfed.org/privacy/termsofuse.html) — attribution/independent-publication and non-endorsement notice included; local derivations are distinguished from source data
- [uPlot 1.6.32 source and license](https://github.com/leeoniya/uPlot/tree/1.6.32)
- [OpenRouter Models API](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)
- [OpenRouter key authentication](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key)
- [OpenRouter chat completions](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request)
- [FINRA API documentation and dataset terms](https://developer.finra.org/docs)
- [FRED API key requirement](https://fred.stlouisfed.org/docs/api/api_key.html)
- [Federal Reserve H.15 download program](https://www.federalreserve.gov/datadownload/Choose.aspx?rel=H15)

Vendor distribution hashes:

```text
19c8d4c6ad88929a79f4ae49d6f7161566dfd0ba3d15cc495e974f787eb78f1f  uPlot.iife.min.js 1.6.32
df630c6a8d6f8eeaff264b50f73ce5b114f646ffd9a0bb74f049b0a00135fa04  uPlot.min.css 1.6.32
```

---

## Archived v1 baseline report

The following records the original v1 release. Its analytics inclusion and source/count/print descriptions are historical; the v2 details above supersede them.

### Fixed Income Desk — v1 delivery and QA

Version: **2026.09.10.1**. Research and QA date: **2026-09-10**.

## Deliverables and architecture

- `fixed-income-desk.html`: one HTML file containing CSS, vanilla JavaScript, structured reference content, SVG charts, search and calculators. No build, npm installation, framework, font download or financial API.
- Registered in `junk-drawer.json` with the same version.
- 8 tabs: Foundations, Math & Equations, Risk, Instrumentation, Then vs Now, Interactive Lab, Glossary, Sources.
- 29 foundation entries, 44 equations, 16 risk families, a 10-sector risk matrix, 167 glossary entries, and five calculators.
- Equation cards include definitions/units, copy, explanations, assumptions, limitations, worked examples, practical significance and related risks. Cheat-sheet mode hides explanatory material.
- Global search includes concepts, instrument descriptions, equations, risks, infrastructure and glossary; results reveal and focus the appropriate content. Local equation and glossary filters complement it.
- Semantic tab buttons use roving focus and Left/Right/Home/End navigation. Search supports slash-to-focus, arrow navigation, Enter and Escape. Native details provide progressive disclosure.
- Two guarded, bounded localStorage preferences: theme and active tab. Calculator values stay in memory. Storage failure displays feedback and leaves the page usable. No storage registry entry is needed for these trivial preferences.
- Core content and calculations work from a local file. The repository-required `analytics-lite.js` is the only external script reference; the application logic has no dependency on its completion.
- Full-reference and math-cheat-sheet printing expand the relevant material and include source URLs. Full printing ignores transient search filters, then restores them afterward.

## QA

Executed the repository's existing Playwright installation directly through Node, with real headless Chrome; no npm command or dependency installation was used:

```sh
node node_modules/@playwright/test/cli.js test tests/fixed-income-desk.spec.js --reporter=line --workers=1
.agents/skills/junkdrawer-compliance-audit/scripts/audit.sh fixed-income-desk.html
```

**9 browser tests pass. Compliance audit: 0 errors, 0 warnings.**

| Check | Result |
|---|---|
| 390, 768, 1024, 1440, 1920 px | All eight sections tested with explanations expanded; no document horizontal overflow |
| Equations | No equation content overflow at all five widths |
| Tables | Wide matrices/comparisons remain within keyboard-focusable scrolling containers |
| Charts | Responsive inline SVG; all input values also available in a table; short-end labels spaced for narrow screens |
| Keyboard tabs and search | Arrow/Home/End navigation, search selection, focus movement and filtered cross-links pass |
| Equation copy and cheat sheet | Copy handler verified with a controlled clipboard; equations and definitions remain in cheat mode |
| Preferences | Theme and active tab survive reload; denied storage does not break calculators |
| Error handling | Empty fields, out-of-range PD, unsupported fractional coupon periods and reset from invalid curve input tested |
| Internal links | Every rendered internal anchor resolves; risk matrix row/column counts agree |
| Printing | Full reference and cheat sheet generated to A4 PDFs; hidden tabs/details expand, filters restore, cheat excludes other sections |
| Browser errors | No page/runtime console errors with analytics collection mocked |
| Visual review | Desktop/mobile entry screens, mobile lab, dark theme and first-page print previews inspected |

Independent calculator checks:

- $1,000 face, 5% coupon, 10 years, 5% semiannual YTM → **$1,000**.
- $100 two-year zero at 5% annual yield → **$90.70294785**; modified duration **1.90476190**.
- $100 face, 5% coupon, two years, zero yield → **$110**.
- Analytic duration and convexity agree with independent symmetric numerical price derivatives.
- Price 100, duration 5, convexity 30, +100 bp → **95.00 duration only; 95.15 with convexity**.
- 1Y zero 4%, 2Y zero 5%, annual compounding → **6.009615%** implied 1Y-to-2Y forward.
- Exposure $1,000,000, one-year PD 2%, recovery 40% → **60% LGD and $12,000 expected loss**.
- Nominal 4.3%, real 1.8% → **2.5% / 250 bp breakeven**.

Print samples are generated in `/private/tmp/fixed-income-reference.pdf` (68 pages with all explanations) and `/private/tmp/fixed-income-cheat-sheet.pdf` (8 pages). Pagination depends on browser/font/print settings. Screenshots and test runner output are temporary QA artifacts, not site dependencies.

Scope of verification: Chrome, file URLs, listed viewports and automated/visual checks; no claim of exhaustive assistive-technology testing or cross-browser certification. No live market pricing validation is implied; examples are deliberately synthetic.

## Financial conventions and remaining variation

- **YTM:** a promised-cash-flow IRR. The IRR equation itself does not require coupon reinvestment; realizing equivalent terminal compound wealth does. Default and early sale can change returns.
- **Pricing:** bond lab assumes coupon-date settlement and a whole number of regular coupon periods. Actual dates, day-count variants, stubs, ex-coupon rules, fees, taxes and options are outside that calculator.
- **Rates and curves:** displayed inputs use percentages; formulas use annual decimal rates. Curve explorers use annual-effective zero yields, not par Treasury yields. No intermediate calibration or arbitrage-free fitting is claimed.
- **Sensitivity:** duration and convexity use the same rate convention. DV01 is a positive loss magnitude for an ordinary long bond; desks differ on signs and whether PV01 denotes curve risk or annuity value. Dollar duration may mean per-unit, per-percent or per-bp sensitivity elsewhere.
- **Spread measures:** G/I spreads compare yields, Z-spread fits a zero curve, OAS includes a model of options, and asset-swap spread reflects a specified bond/swap package. Benchmark, collateral, upfront and compounding choices matter. Discount margin is also convention-dependent.
- **BEY/YTW:** bill and semiannual-bond uses of BEY differ. Eligible call schedules and vendor YTW treatment require documentation. YTW is not a bound on default or market losses.
- **SOFR:** term, daily simple and compounded-in-arrears conventions differ; lookback, observation shift, lockout, spread treatment and floors follow the actual contract. Treasury FRNs reference Treasury bills.
- **Credit:** the one-period scalar PD × LGD × EAD example omits joint severity/exposure dependence, default timing and accounting lifetime-loss rules. Market-implied probabilities include pricing assumptions and premia.
- **Inflation:** breakeven is approximate market compensation, affected by liquidity/inflation-risk premia, index lag, seasonality and the deflation floor; it is not a pure inflation forecast.
- **Mortgages:** PSA is a benchmark, CPR/SMM are conditional speeds, and WAL depends on a principal path. OAS/effective duration/convexity depend on rates, volatility and borrower behavior.
- **Risk matrix:** qualitative synthesis for typical positions, not calibrated sector scores; maturity, leverage, tranches and investor currency can change dominance.

## Research sources

All links below were retrieved or checked on **2026-09-10**. Fabozzi is the conceptual organizing influence; no copyrighted textbook passages are reproduced. Vendor material establishes available capabilities, not independent investment-performance evidence.

- [FINRA · Bond yield and return](https://www.finra.org/investors/insights/bond-yield-return) — Yield terminology; this desk distinguishes the IRR identity from a reinvested terminal-wealth scenario.
- [FINRA · TRACE](https://www.finra.org/filing-reporting/trace) — Corporate/agency and structured-product reporting infrastructure; product rules differ.
- [FINRA · Regulatory Notice 24-06](https://www.finra.org/rules-guidance/notices/24-06) — On-the-run nominal Treasury end-of-day and historical dissemination.
- [MSRB · EMMA](https://www.msrb.org/Electronic-Municipal-Market-Access-EMMA-Website) — Municipal transaction prices and issuer disclosures.
- [New York Fed · SOFR averages and index](https://www.newyorkfed.org/markets/reference-rates/sofr-averages-and-index) — Compounded averages and index; observations are distinct from forward-looking term SOFR.
- [ARRC · SOFR FRN conventions matrix](https://www.newyorkfed.org/medialibrary/Microsites/arrc/files/2019/ARRC_SOFR_FRN_Conventions_Matrix.pdf) — Lookbacks, lockouts, averaging and compounding conventions.
- [TreasuryDirect · TIPS](https://www.treasurydirect.gov/marketable-securities/tips/) — Indexation, semiannual payments and maturity principal floor.
- [TreasuryDirect · STRIPS](https://www.treasurydirect.gov/marketable-securities/strips/) — Separated coupon/principal payments and commercial book-entry holdings.
- [Federal Reserve · TIPS yield curve and inflation compensation](https://www.federalreserve.gov/econres/feds/the-tips-yield-curve-and-inflation-compensation.htm) — Inflation-risk and liquidity premia in breakevens.
- [CME · Calculating the dollar value of a basis point](https://www.cmegroup.com/trading/interest-rates/files/Calculating_the_Dollar_Value_of_a_Basis_Point.pdf) — Price sensitivity, modified duration and DV01.
- [CME · Key-rate duration adjustment](https://www.cmegroup.com/education/articles-and-reports/case-study-key-rate-duration-adjustment) — Tenor-specific exposure and hedge construction.
- [SIFMA · Standard formulas for mortgage-backed securities](https://www.sifma.org/wp-content/uploads/2017/08/chsf.pdf) — CPR/SMM, PSA and mortgage cash-flow conventions.
- [SEC · T+1 implementation](https://www.sec.gov/newsroom/press-releases/2024-62) — May 28, 2024 transition for most covered broker-dealer transactions.
- [SEC · Treasury clearing implementation](https://www.sec.gov/featured-topics/treasury-clearing-implementation) — Eligible cash/repo clearing timetable, checked September 10, 2026; future dates may change.
- [New York Fed · All-to-all trading in the U.S. Treasury market](https://www.newyorkfed.org/research/staff_reports/sr1036.html) — Protocols, access and barriers; revised November 2024.
- [ICE · Evaluated pricing](https://www.ice.com/fixed-income-data-services/data-and-analytics/pricing/evaluated-pricing) — Provider description of evaluated pricing; not evidence that evaluations are firm quotes.
- [Tradeweb · Institutional credit](https://www.tradeweb.com/our-markets/institutional/credit/) — Provider description of RFQ, automated execution and portfolio trading.
- [Tradeweb · How Ai-Price works](https://cdn.tradeweb.com/499a19/globalassets/newsroom/media-center/aiprice-whitepaper/tradeweb_aiprice_white_paper_march2020_final.pdf) — Provider evidence of ML-assisted price estimation and noisy-print filtering; not independent performance verification.
- [Tradeweb · TARA research assistant launch](https://investors.tradeweb.com/news-releases/news-release-details/tradeweb-launches-tara-ai-powered-research-assistant/) — Provider announcement of natural-language credit research tooling.
- [Federal Reserve · Machine trading in March 2020 stress](https://www.federalreserve.gov/econres/notes/feds-notes/what-do-quoted-spreads-tell-us-about-machine-trading-market-stress-march-2020-20200925.html) — Treasury depth, replenishment and trading costs under stress.
- [Bank of England · December 2022 Financial Stability Report](https://www.bankofengland.co.uk/financial-stability-report/2022/december-2022) — LDI leverage, margin calls and forced gilt sales.
- [McGraw Hill — The Handbook of Fixed Income Securities, ninth edition](https://www.mheducation.com/highered/mhp/product/handbook-fixed-income-securities-ninth-edition.html) — publisher overview and further reading; not a source of copied textbook text.
