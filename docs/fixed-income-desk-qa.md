# Fixed Income Desk — delivery and QA

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
