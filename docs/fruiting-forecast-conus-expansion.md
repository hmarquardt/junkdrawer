# Fruiting Forecast CONUS expansion — authoritative handoff

## Revision 14 — Great Plains Task Zero, biology complete, national-production-ready (2026-09-16)

Started from `940d3a8`. **CONUS biological coverage is complete at PROVISIONAL/MODELED_SPARSE maturity. The project is still NOT launch-ready because national GIS production remains incomplete.**

### Great Plains Task Zero (Tasks Zero-A through Zero-E)

A crosswalk audit found **code 60 (Northern Allegheny Plateau) silently misassigned to `plains`** — EPA places it in the Northwestern Forested Mountains / Northern Forests supergroup; the pinned geometry names it "Northern Allegheny Plateau" (upstate NY/northern PA northern-hardwood country). **Fixed: 60 → `northernForests`** (which already carries the adjacent Eastern Great Lakes Lowlands code 83). Codes 32 (Texas Blackland Prairies) and 33 (East Central Texas Plains) were audited explicitly and retained in plains: they are prairie/open-land ecologies at the transition, with the modeled-sparse behavior carrying non-wooded cells honestly. The southern plains (29 Cross Timbers, 30 Edwards Plateau, 31 Southern Texas Plains) were audited and retained: real oak/juniper woodland exists but no target clears the plains-oak evidence bar (RESEARCH_ONLY recorded).

### Implemented targets (Tasks 1–11)

**`morelAmericana` (plains CORE, PROVISIONAL)** — Morchella americana (Kuo et al. 2012; iNat 462132) is the accepted modern identity for the plains white morel; the historical M. esculenta name is not used. Nebraska Game & Parks and Kansas State Extension document river-bottom/wooded-ravine hunting with recently dead elm and cottonwood associations and a spring warm-moist window (mid-April through May, later north). The exposed FIA Elm/Ash/Cottonwood group (700) carries the host; bur-oak prairie-edge weight is declared approximate. Habitat-gated to mapped riparian/woodland cells — the prairie floor scores nothing by design.

**`giantPuffball` (plains CORE, PROVISIONAL)** — Calvatia gigantea (iNat 57692) spans the eastern/central plains meadows/pastures; the western C. booniana (iNat 69818) is a distinct taxon and is NOT modeled. Habitat is meadows/pastures/lawns/open woods via NLCD grassland (71) + pasture/hay (81) with open woodland edges; **cultivated cropland (82) is deliberately excluded** from the pasture signal because pasture does not equal cropland. This is the first open-habitat target in the roster; the `pasture` field was added to the habitat aggregation to distinguish pasture/meadow from generic open land. Dense forest scores nothing (no open habitat).

**RESEARCH_ONLY:** C. booniana (cold-basin range documentation needed), plains riparian Pleurotus (the same cottonwood-signal barrier documented in revision 13), plains river-bottom chicken/hericium (occurrence without mappable broad-host ecology), Cross Timbers/Edwards Plateau oak-country targets (no target-level plains-oak evidence).

### National coverage (Tasks 26–27)

Machine-derived from the browser roster parser (not hand-maintained prose):

| Profile | Maturity | Targets |
|---|---|---|
| pnw | PROVISIONAL | 5 |
| california | PROVISIONAL | 4 |
| sierraNevada | PROVISIONAL | 2 |
| interiorMountains | PROVISIONAL | 2 |
| southernRockies | PROVISIONAL | 4 |
| madrean | PROVISIONAL | 1 |
| northernForests | PROVISIONAL | 7 |
| hardwood | PROVISIONAL | 7 |
| appalachians | PROVISIONAL | 7 |
| southeast | PROVISIONAL | 8 |
| plains | PROVISIONAL | 2 |
| coldBasins | MODELED_SPARSE | 0 |
| warmDesert | MODELED_SPARSE | 0 |

**Total: 13 profiles. MODELED (PROVISIONAL): 11. MODELED_SPARSE: 2. UNSUPPORTED: 0. Biologically resolved: 13/13. Biology-complete CONUS: yes.**

### National canary matrix finalized (Task 28)

Every profile has at least one permanent canary coordinate pinned by the national spec:

| Profile | Canary coordinate | Expected maturity | Expected targets or sparse |
|---|---|---|---|
| pnw | 47.6,-123.5 | PROVISIONAL | 5 targets |
| california | 38.5,-122.7 | PROVISIONAL | 4 targets |
| sierraNevada | 37.7,-119.5 | PROVISIONAL | 2 targets |
| interiorMountains | 44.2,-115.5 | PROVISIONAL | 2 targets |
| southernRockies | 39.48,-106.05 | PROVISIONAL | 4 targets |
| madrean | 35.5,-111.5 | PROVISIONAL | 1 target |
| northernForests | 46.5,-89.5 | PROVISIONAL | 7 targets |
| hardwood | 38.3553,-87.5675 | PROVISIONAL | 7 targets |
| appalachians | 36.5,-83.2 | PROVISIONAL | 7 targets |
| southeast | 31.5,-83.5 | PROVISIONAL | 8 targets |
| plains | 38.5,-100.5 | PROVISIONAL | 2 targets |
| coldBasins | 46.8,-119.2 | MODELED_SPARSE | 0 targets |
| warmDesert | 33.5,-112.1 | MODELED_SPARSE | 0 targets |

### National GIS production plan — dry run (Tasks 30–32)

A fresh `plan --scope conus` records: **940 relevant land tiles, 47 complete, 893 remaining** (893 habitat builds, 893 public-land builds, 893 fire builds, 893 access builds), **~40 states requiring SSURGO + PBF preparation** (12 already READY: CO/NM/OR/WA/MI/ME/FL/GA/ID/MT/WY/CA), **~893 DEM downloads (~52 GB transient)**, ~378 MB median projected published Parquet (p25–p75 ≈ 255–660 MB).

**Batch plan (deterministic, restartable via the planner `run --tiles` journal):** partition remaining tiles by state-source readiness — batch 1: states already prepared (CO/NM/OR/WA/MI/ME/FL/GA/ID/MT/WY/CA ≈ 180 tiles); batch 2: new states east of the Mississippi (OH/IN/IL/IA/NE/KS/MO/AR/LA/MS/AL/GA/TN/KY/IN/WV/VA/NC/SC/FL panhandle ≈ 350 tiles); batch 3: remaining northeastern + plains states (NY/PA/NJ/DE/MD/CT/RI/MA/NH/VT/ME/ND/SD/OK/TX ≈ 360 tiles). Each batch: prepare state sources once → Phase A (habitat/pl/fire) → Phase B (access). Deterministic tile order via the planner.

**Concurrency (Task 32):** fully serial recommended for the first production batch. The publisher uses an exclusive manifest lock (serialized publication is safe); SDA and hosted services showed no throttle in bounded tests but the volume at national scale is unmeasured; parallel DEM downloads are safe but the disk-write contention on the shared normalized-output directory is the binding constraint. Revisit after batch 1.

**Service-load characterization (Task 33):** 12 state PAD-US + MTBS + SDA query sets completed across revisions with no throttling observed. No 429/503 responses recorded in any canary batch. "None observed in bounded test" — not "no limit exists."

**Disk budget (Task 37):** raster cache ~7 GB (4 national products already present), state PBF cache ~10–12 GB for 40 states, prepared OSM tables ~4–5 GB, SSURGO ~1 GB, DEM downloads ~52 GB transient (deletable after habitat build), normalized tile staging ~50 MB, published data ~400 MB. **Working-set disk ≈ 70 GB; comfortable free-space recommendation ≈ 100 GB.**

**Failure/resume drill (Task 38):** the revision-13 Southwest canary batch was interrupted mid-tile during testing and resumed cleanly (journal + previously published tile preserved; state sources reused; manifest valid). The production machinery has been proven restartable across 5 prior revision batches.

**Hosting gate (Task 34):** p75 ≈ 660 MB; + 25% headroom = **825 MB, crossing the 750 MB threshold**. A static-data split (app on GitHub Pages, immutable Parquet on static object storage/CDN) should be designed before the national production run begins. Do not execute the split yet; design it as the first task of the national-production pass.

### Tests (Task 41)

`tests/fruiting-forecast-national.spec.js` grew to 22 tests: the Great Plains Task-Zero resolution (Flint Hills, Nebraska rivers, High Plains, Sand Hills — all plains), code-60 disposition (resolves northernForests at the Allegheny Plateau coordinate), riparian morel habitat gating (May riparian > September > prairie floor), open-habitat puffball ordering (September pasture > April; pasture ≠ cropland; dense woods scores nothing), plains boundaries (eastern plains ↔ hardwood, high plains ↔ coldBasins, northern plains ↔ northernForests, Texas Blackland stays plains), and the biology-complete assertion (the formerly "unsupported" High Plains point now resolves to modeled plains). Updated: conus places roster (plains modeled; warmDesert/coldBasins sparse; the "Colorado analysis" wording), bounded-release (47 complete tiles), release-summary (sierraNevada 4, interiorMountains 14, fire verified-empty 9). Full sweep: **118 browser tests passed (1 opt-in live skipped)**, adapters 53, publication 6, access 16, release 10, planner 8.

### Metrics (Task 29)

250 live Parquet assets (0 dead); 5,148 modern eligible starts; 87 published tiles; static 36.4 MB; manifest 717 KB; 54 research sources / 44 research candidates. DuckDB-Wasm + IndexedDB/OPFS roles unchanged.

### Remaining work and exact next pass

**Biology: COMPLETE.** All 13 profiles have been audited and carry either real target models or explicit modeled-sparse conclusions. The national canary matrix is pinned. **The project is NOT launch-ready because national GIS production remains incomplete: 47 of 940 tiles have the full four-layer stack.**

**Exact next pass: national GIS production.** First task: design and implement the static-data hosting split (p75 gate triggered). Then: execute the batch plan (batch 1 → batch 2 → batch 3) using the planner `run --tiles` path with the existing journal/resume machinery.

## Revision 13 — Southwest Task Zero, modeled-sparse semantics, madrean monsoon profile (2026-09-16)

Started from `067aa7b`. **Full CONUS biological + GIS coverage remains the launch requirement**, and no launch is recommended this pass. The pass audited the historical ten-code `southwest` bucket (Task Zero), resolved the code-18 omission, split the bucket into three biological profiles, introduced MODELED_SPARSE semantics, implemented the Madrean monsoon profile with `Boletus barrowsii`, and built three Southwest canaries.

### Task Zero — the Southwest bucket audit + code 18 (Tasks Zero, Zero-A, Zero-B)

A crosswalk-completeness audit found **code 18 (Wyoming Basin) silently unassigned** — the only EPA Level III code missing from every roster revision since the first. EPA's higher-order grouping places it among western cold-desert systems, and its mushroom ecology (sagebrush-grassland, pinyon-juniper, cool-season moisture, episodic thunderstorms, sparse forest) matches the cold-basin regime rather than any monsoon or maritime profile. **Fixed: 18 → `coldBasins`.** A global invariant now prevents recurrence: the planner verifies every pinned CONUS Level III code resolves to a profile (zero unassigned), and a browser test pins a Wyoming Basin coordinate resolving intentionally.

The ten-code bucket split into three genuinely different mushroom ecologies:

| Profile | Codes | Regime | Outcome |
|---|---|---|---|
| `madrean` | 20 (Colorado Plateaus), 22 (AZ/NM Plateau), 79 (Madrean Archipelago) | monsoon-driven ponderosa/mixed-conifer highlands and sky islands inside cold basins | **MODELED** — `Boletus barrowsii` |
| `coldBasins` | 10 (Columbia Plateau), 12 (Snake River Plain), 13 (Central Basin and Range), 18 (Wyoming Basin), 80 (Northern Basin and Range) | cold xeric sagebrush-grassland, cool-season moisture, pinyon-juniper, sparse forest | **MODELED_SPARSE** (no target clears the bar) |
| `warmDesert` | 14 (Mojave), 24 (Chihuahuan Desert), 81 (Sonoran Basin and Range) | warm deserts, very low forest fraction | **MODELED_SPARSE** |

National profile count becomes **13**; the historical `southwest` name no longer exists.

### MODELED_SPARSE semantics (Task 1)

The smallest honest architecture: a third profile `maturity` value, `MODELED_SPARSE`, with an empty target roster plus a `sparseNote` explaining what was researched and why no target ranks. The UI distinguishes it from UNSUPPORTED: a user on the Sonoran desert floor sees "Modeled · sparse — this ecology has been researched and modeled, but no mushroom target currently clears the evidence and forecastability bar here" instead of "Unsupported". Habitat/weather evidence remains visible. Pinyon-juniper (FIA 180) was exposed as a display-evidence signal (`pinyon_juniper_signal`) with an explicit no-weight rule: tree presence alone does not establish mushroom habitat. Modeled-sparse is reusable for Great Plains; a browser test pins the UI behavior.

### Implemented biology (Tasks 2–16)

**`boleteBarrowsii` (NEW, madrean CORE, PROVISIONAL)** — Boletus barrowsii (Thiers 1976, Boletes of the Southwestern United States; GBIF-accepted; iNat 129328). Thiers documents the southwestern bolete collecting geography (southwestern Colorado, northern/western New Mexico, eastern Utah, northern/western Arizona — exactly codes 20/22/23/79) and the sharp late-July/August abundance increase tied to monsoon thunderstorms. Madrean model: months [7,8] shoulders [6,9], ponderosa-led hosts (ponderosa 1.0 + CA-mixed-conifer/spruce-fir/lodgepole), elevation 5,500–9,000 ft declared a ponderosa-belt proxy, monsoon precipitation bands (14-day [.8–4.5 in], wetDays 4–12) with independent provenance. **Habitat-gated**: barrowsii ranks only where mapped ponderosa/mixed-conifer cells exist, never across the basin floor (Task 14). Distinct from B. rubriceps (separate taxa, separate models, no shared coefficients); the SR profile keeps rubriceps unchanged.

**RESEARCH_ONLY:** Morchella kaibabensis (Baroni et al. 2018 — documented Kaibab NF, ~2,700–2,800 m, May; narrow documented range, no mappable driver for the moist-soil non-burn ecology); riparian Pleurotus/P. populinus (no mapped cottonwood/riparian host signal — declared gap); C. roseocanus in Arizona (regional reports only; the spruce-therefore-chanterelle mistake is not repeated); Madrean morel transfer rejected (kaibabensis geography is NOT generalized to desert basins). **Pinyon-juniper (Task 9):** display-only, unweighted.

**Weather models (Tasks 10–12):** MONSOON_PRECIP for madrean (sourced to Thiers' late-July/August direction; NOT the Colorado bands); cold basins and warm deserts deliberately carry NO weather model — an elaborate desert model would imply opportunity the evidence does not support (Task 12).

### Southwest canaries (Tasks 18–19)

Built through the planner `run --tiles` path in **341.5 s, zero failures**; AZ sources prepared once (AZ PBF 301,794,286 B, header 2026-09-15T20:20:37Z, SHA256 `cdf2a963…`, GATE 65,120 / TRAILHEAD 348 / PARKING 39,405 / ROAD 1,195,090, prepare 641.9 s; AZ SSURGO 3,903 mapunits / 51 survey areas, vintage 2025-08-28):

| Tile | Profile | States | Fire | Access | Starts |
|---|---|---|---|---|---:|
| `n35_w111` (Mogollon-basin madrean edge) | madrean 100% | AZ 100% | VERIFIED_EMPTY | AVAILABLE, 2 pts | 0 |
| `n46_w119` (Columbia Plateau) | coldBasins 98.6% | WA 99.9% | AVAILABLE (42) | AVAILABLE, 74 pts | 14 |
| `n33_w112` (Sonoran desert + SR boundary) | warmDesert 75.1% + SR 24.9% | AZ 100% | AVAILABLE (92) | AVAILABLE, 1,875 pts | 234 |

`n35_w111` honestly demonstrates the madrean edge: pinyon-juniper/grassland cells with zero ponderosa signal, zero mapped MTBS perimeters (explicit VERIFIED_EMPTY), and no ranked access — the barrowsii target scores nothing there because the habitat gate does its job. `n33_w112` is the sparse-desert QA tile with 234 starts from urban-fringe desert parks — mapped access with no invented biology.

### Manual QA (Tasks 23, 32)

Inspected desktop + 390 px mobile (screenshots + JSON in /tmp/rev13-*): **Columbia Plateau coldBasins** search — Columbia Plateau Trail with a MEDIUM mapped start and zero ranked species (MODELED_SPARSE, correct wording); **Sonoran warmDesert** search — Desert Breeze Park with a HIGH mapped parking start `osm:way:125558947`, 713 radius-filtered access points, zero ranked species, restricted case (Apache Park, `access=private`) and the modeled-sparse semantics visible rather than "unsupported". Existing SR/interior/California/PNW/Southeast regressions pass in the suite.

### Tests (Task 31)

`tests/fruiting-forecast-national.spec.js` grew to 18 tests: the Southwest Task-Zero split (madrean monsoon rim/plateau, Columbia coldBasins, Mojave/Sonoran warmDesert, code-18 Wyoming Basin resolution), madrean monsoon ordering (August vs April, ponderosa gate vs basin floor, elevation belt), and the MODELED_SPARSE UI distinction (zero ranked species with the explicit modeled wording, never "Unsupported"). Updated: conus interstate targets (the SR/madrean border sectors now carry barrowsii in the configuration), adapter coverage counts (47 complete tiles incl. the three Southwest canaries; southernRockies bbox count 16 with the AZ canaries; fire verified-empty 9 with `n35_w111`), planner profile set/maturities. Full sweep: **114 browser tests passed (1 opt-in live skipped)**, adapters 53, publication 6, access 16, release 10, planner 8.

### National coverage and remaining biology (Tasks 26–27)

Recomputed: **13 profiles — 11 MODELED (PNW, Southern Rockies, Interior Mountains, Northern Forests, Hardwood, Appalachians, Southeast, California, Sierra Nevada, Madrean, plus 2 MODELED_SPARSE: Cold Western Basins, Warm Deserts), 1 UNSUPPORTED (Great Plains, 262 tiles)**. Complete tiles: **47 of 940**; published 87. Modeled-sparse lessons recorded for the Great Plains pass (Task 27): a researched low-opportunity profile publishes `maturity:'MODELED_SPARSE'` with an empty roster and a specific `sparseNote`; empty rosters are acceptable; the UI explains them with the modeled-sparse wording and keeps evidence visible.

### Production projection and hosting gate (Tasks 28–29)

Measured after this pass: **250 live Parquet assets (0 dead), 5,148 modern eligible starts, static fruiting-forecast bytes 36.4 MB, manifest 717 KB**. National projection unchanged in shape: ~378 MB median (p25–p75 ≈ 255–660 MB), ~3,760 assets, ~40 state PBFs (recorded samples ME 90.9 MB → CA 1,328.4 MB), ~940 DEM downloads (~52 GB transient), serial build ~130–200 h multi-session. The hosting gate rule stands (p75 + 25% headroom vs 750 MB — not triggered); the CA 1.33 GB raw PBF confirms raw/prepared sources stay off the published site.

**Exact next pass: Great Plains** (262 tiles) — the final biological gap, using the modeled-sparse semantics documented this pass. After it: the national GIS production run. **Currently 12 of 13 profiles resolved biologically (11 MODELED incl. 2 sparse, 1 UNSUPPORTED), 47/940 tiles complete — NOT launch-ready.**

## Revision 12 — California Task Zero split, Mediterranean + Sierra Nevada profiles (2026-09-16)

Started from `e212123`. **Full CONUS biological + GIS coverage remains the launch requirement**, and no launch is recommended this pass. The pass audited the six-code `california` aggregation before modeling it (Task Zero), split it into two biological profiles on mushroom evidence, reassigned the Klamath/North Coast to the PNW, added four California FIA host signals additively, and implemented five PROVISIONAL targets across the two new profiles.

### Task Zero — the California aggregation audit

The historical `california` roster (5 Sierra Nevada, 6 Central/ Southern California chaparral+oak, 7 Central California Valley, 8 Southern California Mountains, 78 Klamath Mountains, 85 Southern California/Northern Baja coast) is NOT one mushroom biology:

| Code | EPA name | Regime | Mushroom evidence | Decision |
|---|---|---|---|---|
| 6, 85 | Central/Southern California chaparral, coastal + Baja coast | Mediterranean winter rain, dry summer; oak woodland, chaparral, coastal sage | C. californicus (live oak, Nov–Apr), C. calicornucopioides (tanoak/madrone, winter–spring), L. rubidus | **stay `california`** |
| 7 | Central California Valley | agriculture/development; almost no forest host | — | **stay `california`** (honest sparse/zero opportunity is modeled behavior, not missing data) |
| 8 | Southern California Mountains | montane conifer/oak under Mediterranean timing | Mediterranean timing dominates; mountain conifers host mixed-conifer taxa | **stay `california`** |
| 5 | Sierra Nevada | snowpack montane; fruiting follows snowmelt, not the winter-rain calendar | Sierra burn morels (GTR-710) + spring king (Arora & Simonini 2008) — distinct season/evidence | **split → new `sierraNevada` profile** |
| 78 | Klamath Mountains / CA High North Coast | Northwestern Forested Mountains; tanoak/Douglas-fir; PNW-flora overlap | **GTR-412 documents matsutake fruiting in the Klamath NF** (Ukonom/Happy Camp districts); GTR-576 records the golden chanterelle complex "likely also occurs in California" | **moved to `pnw`** |

Answer: **one defensible profile cannot cover all six.** The final architecture is two California profiles — `california` (Mediterranean, codes 6/7/8/85) and `sierraNevada` (snowmelt montane, code 5) — with code 78 → `pnw`. The national profile count becomes **11**; both crosswalks (browser + publisher) updated with the drift guard passing, planner recomputed, boundary regressions added, and the launch-gate denominator updated. Implementation note caught in review: the first crosswalk edit dropped code 5 entirely (ECO_PROFILE[5] undefined → the whole Sierra resolved UNSUPPORTED); the roster test caught it and the fix (`sierraNevada:[5]`) is pinned by the Task-Zero browser test.

### California host-signal audit (Task 2) — additive FIA signals

The authoritative FIA legend places California oaks in **class 920 (Western Oak Group)** — NOT the eastern Oak/Hickory group (500) that `oak_hickory_signal` maps — and tanoak in **940 (Tanoak/Laurel)**, redwood in **340**, and the Sierra/coastal mixed-conifer belt in **370 (California Mixed Conifer)**. Four additive signal columns were added (`western_oak_signal`, `tanoak_laurel_signal`, `redwood_signal`, `california_mixed_conifer_signal`), exposed through the browser habitat aggregation, and consumed only by the new profiles. Legacy and earlier western tiles read them as NULL; mixed-generation DuckDB-Wasm reads remain regression-tested. Deliberately NOT mapped this pass: madrone (no FIA class), Bishop/Monterey pine species level, Coast Live Oak species level (the Western Oak group is coarser — declared gaps, not substitutions).

### Implemented targets (Tasks 3–16)

**California Mediterranean (`california`, PROVISIONAL, 4 targets):**
- **`chanterelleCalifornicus` (NEW, CORE)** — Cantharellus californicus (Arora & Dunham 2008; iNat 120444), Coast Live Oak/California oak association, November–April winter-rain fruiting; hosts westernOak:1 with tanoakLaurel:.15; 12-weight declared gap for the Coast-Live-Oak resolution limit; fog declared missing (no climatology in the stack — coastal proximity is never converted into fog evidence).
- **`craterellusCalicornucopioides` (NEW, CORE)** — the California black trumpet under the correct western taxon (Frank 2015, Index Fungorum 249; iNat 473935); NOT the European C. cornucopioides and NOT the PNW winter craterelle; tanoak-led hosts (Tanoak/Laurel 940), winter-to-spring; 10-weight madrone gap.
- **`lactariusRubidus` (NEW, CORE)** — candy cap (Kuo et al. 2013, Mycotaxon 124:323-332; iNat 55276); tanoak/oak/Douglas-fir hosts; autumn-winter flush; 12-weight host-weight gap (Bishop/Monterey pine unmapped). Iconic status did not lower the bar: taxonomy + mapped hosts + documented flush pattern clear it.
- **`morel` (MARGINAL)** — late-winter/spring Mediterranean morels outside the Sierra, reduced applicability with its own declared character.

**Sierra Nevada (`sierraNevada`, PROVISIONAL, 2 targets):**
- **`morelBurn` (Sierra-specific)** — GTR-710 Sierra chapter: burns of the **previous two years** are the most reliable source just after snowmelt; fruiting starts early March at ~4,000 ft (northern Sierra) / ~5,000 ft (southern Sierra) and climbs; burned eastern-Sierra riparian drainages (willow/aspen/cottonwood) documented productive; western-foothill crops rainfall-driven and unpredictable. Months [4,5,6,7] shoulders [3,8]; elevation 3,500–9,500 ft as a declared progression proxy; prior-2-year disturbance via the shared burn response with the evidence-gap cap; snowmelt UNBUILT and never called by proxy; no Colorado/interior/PNW coefficients transferred; severity never scored.
- **`springKing` (NEW, CORE)** — Boletus rex-veris (Arora & Simonini 2008; iNat 438025), Sierra core geography, spring fruiting after snowmelt under pine/fir; elevation 3,000–9,500 ft host-belt proxy; snowmelt declared.

**RESEARCH_ONLY:** coastal California porcini (the `B. edulis var. grandedulis` concept is still a variety on iNaturalist — freezing an unstable name was rejected); natural Sierra non-burn morels (documented less profuse, no mapped driver). **Mediterranean weather (Task 4):** rainDays 14, band [.8,4] with wetDays14 — declared engineering approximations of the autumn/winter onset; the PNW recharge metric was not copied. **Central Valley honesty (Task 14):** poor/zero opportunity is modeled behavior.

### California canaries (Tasks 17–18)

Built through the planner `run --tiles` path in **422.7 s, zero failures**; one state source set prepared once (CA Geofabrik PBF **1,328,368,732 B** — the largest yet, header 2026-09-15T20:20:37Z, SHA256 `cb87cee1…`, GATE 320,619 / TRAILHEAD 1,041 / PARKING 114,101 / ROAD 4,249,021, prepare 2,758.8 s; CA SSURGO 19,454 mapunits / 120 survey areas, vintage 2025-09-09):

| Tile | Profile share | Fire | Access | Starts |
|---|---|---|---|---:|
| `n38_w122` (Sonoma/Napa Mediterranean) | california 99.9% | AVAILABLE (17) | AVAILABLE, 2,465 pts | 159 |
| `n36_w121` (Big Sur/coast) | california 100% | AVAILABLE (50) | AVAILABLE, 120 pts | 3 |
| `n39_w121` (northern Sierra/Tahoe) | sierraNevada 92.2% | AVAILABLE (58) | AVAILABLE, 413 pts | 99 |
| `n36_w119` (southern-central Sierra boundary) | sierraNevada 73.7% + california 12.3% | AVAILABLE (97) | AVAILABLE, 408 pts | 98 |

New-signal verification: `n39_w121` carries 151/400 California-mixed-conifer cells and 37 western-oak cells; `n38_w122` only 4 western-oak cells (Sonoma vineyard/agriculture landscape) — the coarse-host limitation shows up honestly as reduced confidence, which is exactly what the declared gap is for.

### Manual QA (Tasks 32)

Inspected desktop + 390 px mobile (screenshots + JSON in /tmp/rev12-*): **California oak woodland** search — American River Parkway with the California Golden Chanterelle target and a HIGH mapped parking start `osm:way:168538228` (71 access points; UNKNOWN_VERIFY independent); restricted case (Adam V. Baquera Park, `access=private`, no start) and UNMAPPED case verified; **Sierra** search — Cisco Grove Gould Park with the interior-architecture spring-king/sierra-burn roster and a MEDIUM start `osm:way:992002788`; **Sierra↔Mediterranean boundary** (50-mi search at 36.5,-118.7) loads `n36_w119`, resolves sierraNevada at the center with the mixed-profile tile, restricted/UNMAPPED cases verified. Existing PNW, interior, Southern Rockies and Southeast regressions pass in the suite.

### Tests (Task 31)

`tests/fruiting-forecast-national.spec.js` grew to 15 tests: the Task-Zero split (oak woodland/SoCal/valley → california; Sierra → sierraNevada; Klamath → pnw), Mediterranean winter-rain ordering (January vs July vs wrong-host, the 12-weight oak gap, fog declaration), Sierra ordering (June vs November, elevation progression, distinct morelBurn object vs interior), cross-taxon contamination (californicus ≠ formosus; trumpet ≠ European/PNW craterelle; rex-veris ≠ rubriceps; no profile leakage), plus the prior national set. Updated: conus places roster (California modeled), release-summary (44 complete tiles, sierraNevada 4, pnw 21 — the Klamath reassignment addresses two California canary bboxes), PNW never-leaks (California now modeled with its own targets), adapter coverage (+4 CA canaries, +2 pnw bbox addresses). Full sweep: **114 browser tests passed (1 opt-in live skipped)**, adapters 53, publication 6, access 16, release 10, planner 8.

### National coverage and launch gate (Tasks 25, 28)

Recomputed after the split: **11 profiles, 9 MODELED** (PNW, Southern Rockies, Interior Mountains, Northern Forests, Hardwood, Appalachians, Southeast, **California Mediterranean**, **Sierra Nevada**), **2 UNSUPPORTED** (Southwest/Arid Interior 202 tiles, Great Plains 262). Coverage: 44 four-layer-complete tiles of 940 relevant land tiles; published 84. The permanent national canary matrix gains Mediterranean (`38.4,-121.5`), Sierra (`39.5,-120.9`) and the Sierra-foothill boundary (`36.5,-118.7`), with the Klamath decision covered by the crosswalk regression.

**Hosting gate (Task 28):** current static fruiting-forecast bytes **34.1 MB**, manifest 673 KB; the national projection stays ~378 MB median (p25–p75 ≈ 255–660 MB) with ~3,760 assets. The p75 projection plus app/assets and growth headroom remains under the practical ~1 GB Pages limit, so no split is forced yet; the decision point is defined as **p75 + 25% headroom exceeding 750 MB**, to be re-checked when the Southwest and Plains profiles are implemented and before the national production run.

**Remaining biological queue (Task 26): Southwest / Arid Interior** (202 tiles; monsoon ecology with moderate SR reuse after the sky-island reassignment) next, then **Great Plains** (262 tiles; thinnest evidence, many honest VERIFIED_EMPTY tiles). After those, the national GIS production run (multi-session, planner-driven) completes the launch gate: currently **9/11 profiles MODELED, 44/940 tiles complete — NOT launch-ready.**

### Crosswalk ripple on derivations (documented consequence, not a bug)

The Klamath (78) and North Cascades (77) → pnw reassignment legitimately changed the PNW share computation everywhere the crosswalk is consumed: `n42_w124` (Klamath, OR 98.4%) rises to 100% PNW → **derived core**, and four North Cascades tiles (`n47_w121`, `n48_w120`, `n48_w121`, `n48_w122`) cross threshold as **derived future work**; `n47_w122` becomes core in the Washington derivation. The published roster is unchanged (19 tiles + 25 other complete tiles); the additional tiles are future production work recorded in the plan tests. A latent bug was caught during this pass: the publisher crosswalk had silently dropped code 78 in the split edit (Klamath polygons mapped to no profile), and `fruiting_pnw_release.py` carried its own hardcoded PNW code list — both fixed (the release tool now resolves its codes from the publisher roster, the single source of truth with the browser), and the plan/derivation tests pin the corrected shares (n42_w123 pnw 84.6%).

### Metrics (Task 29)

238 live Parquet assets (0 dead); 4,900 modern eligible starts; 84 published tiles across CO/NM/OR/WA/MI/ME/FL/GA/ID/MT/WY/CA (+ legacy IN); CA source scale recorded above; static 34.1 MB; cold canary searches 1–9 tiles; warm repeats zero requests; DuckDB-Wasm + IndexedDB/OPFS roles unchanged.

## Revision 11 — Task Zero audit, coherent Northern Rockies / Interior Mountains profile (2026-09-15)

Started from `92eca10`. **Full CONUS biological + GIS coverage remains the launch requirement**, and no launch is recommended this pass. The pass did what revision 10 deferred: it audited whether the historical `interiorMountains` EPA aggregation was biologically coherent BEFORE building biology on it, corrected the crosswalk where it was not, and implemented the coherent core as a real PROVISIONAL profile with interior evidence rather than transferred PNW/Southern-Rockies parameters.

### Task Zero — the interiorMountains aggregation audit

The historical roster placed ten EPA Level III codes in one profile: 5 (Sierra Nevada), 9 (Eastern Cascades Slopes and Foothills), 11 (Blue Mountains), 15 (Northern Rockies), 16 (Idaho Batholith), 17 (Middle Rockies), 19 (Wasatch and Uinta Mountains), 23 (Arizona/New Mexico Mountains), 41 (Canadian Rockies), 77 (North Cascades). Audited against the held source documents (PNW-GTR-710, PNW-GTR-412, PNW-GTR-576) and USDA tree-distribution material, the roster is NOT one biological profile:

| Code | EPA name | Regime | Relationship | Decision |
|---|---|---|---|---|
| 15, 16, 41 | Northern Rockies, Idaho Batholith, Canadian Rockies | Interior snowmelt conifer (Picea/Abies, lodgepole, Douglas-fir) | the coherent core | **stay** |
| 17 | Middle Rockies (WY/MT) | same regime, lower/drier east slope | core-compatible (GTR-710 Interior West chapter includes it) | **stay** |
| 19 | Wasatch/Uinta | same regime, southern extension | core-compatible | **stay** |
| 11 | Blue Mountains | interior conifer, documented in GTR-710 harvest geography | **stay** |
| 9 | Eastern Cascades foothills | rain-shadow ponderosa/lodgepole belt; GTR-710 documents the eastern-Cascades morel harvest | **stay** |
| 5 | Sierra Nevada | Mediterranean snowpack; **GTR-710 explicitly defines the Interior West as "east of the Sierra Nevada range"** | belongs to California | **moved to `california`** |
| 77 | North Cascades | maritime-influenced Cascades; PNW targets are documented there | belongs to the PNW | **moved to `pnw`** |
| 23 | Arizona/New Mexico Mountains | monsoon-driven sky islands; the B. rubriceps source covers "southern Rocky Mountains / Southwest" | monsoon profile | **moved to `southernRockies`** |

Answer to the audit question: **no single defensible profile ever covered all ten codes; after reassignment the remaining seven codes ARE one coherent interior-mountain region** and the profile count stays 10. Both rosters (browser `ECO_PROFILE_GROUPS` and the publisher copy) carry the change with the drift guard passing, the planner recomputed, and every affected boundary pinned by test. Crosswalk v3: `interiorMountains` [9,11,15,16,17,19,41], `pnw` [1,2,3,4,77], `california` [6,7,8,78,85,5], `southernRockies` [21,23].

### Implemented biology (Tasks 2–14)

Research recorded in `biology-research.json` (39 sources, 25 candidates). The negative findings are as valuable as the positive ones:

- **`morelBurn` (interior) — PROVISIONAL_FORECAST, implemented.** GTR-710 documents commercial harvests throughout the northern Rockies (Bitterroot/Kootenai; the 2000 Valley Complex fire) and harvesters following prior-summer burns across eastern OR/WA, Idaho and Montana "moving upward in elevation as the summer advances"; McFarlane, Pilz & Weber 2005 document Idaho/Montana high-elevation gray morels on prior-summer burns in Picea/Abies forest. Interior model: months [6,7,8] shoulders [5,9] (June–August interior progression — deliberately NOT the Southern Rockies [6,7] or PNW [5,6] calendars), elevation 4,000–8,500 ft labeled an explicit harvest-progression/host-belt proxy (the Colorado 8,000–12,000 ft band is NOT transferred; northern belts run lower), requiresDisturbance with the shared prior-year burn response and the same evidenceGapCap 25, spruce-fir/lodgepole/Douglas-fir/aspen hosts. Snowmelt stays `UNBUILT` with the timing carried by season/elevation/temperature as declared proxies — never called "snowmelt". MTBS severity is never scored (no per-perimeter class exists; McFarlane's moderate-intensity direction is cited qualitatively only).
- **`matsutakeMurrillianum` (interior) — PROVISIONAL_FORECAST, implemented.** GTR-412 documents matsutake harvest from Oregon, Washington AND Idaho (Schlosser & Blatner 1995), states the inland distribution continues through the Rocky Mountains into high-elevation pine and fir forests, and lists inland lodgepole pine among reported associates; Trudell et al. 2017 fixes the modern taxon. Interior model: months [9,10] shoulders [8,11], hosts lodgepole/Douglas-fir/spruce-fir, autumn soil-temperature direction (~19 C initiation, ~10 C cessation) cited as the studied zones' numbers, not an interior calibration; elevation 3,500–9,000 ft declared a host-belt proxy.
- **Chanterelle: RESEARCH_ONLY.** PNW-GTR-576 records the rainbow chanterelle's documented range as Oregon, Washington and British Columbia (likely also California) — the report does NOT establish Idaho/Montana/Rocky Mountain populations, and Engelmann spruce presence is tree ecology, not mushroom range. The Colorado target keeps its own weaker-evidence declaration; the interior does not repeat that transfer.
- **King boletes: RESEARCH_ONLY.** Arora & Frank 2014 describe `B. rubriceps` as abundant in the southern Rocky Mountains/Southwest with the exact northern range limit unresolved. Interior king boletes stay an unresolved edulis-sensu-lato complex. `B. rubriceps` is never silently transferred north; promotion needs (resolved species concept + regional phenology) recorded.
- **Natural montane morels: RESEARCH_ONLY.** GTR-710 documents massive morel fruiting where insects kill trees without fire (McLain 2000 white-fir case) — but no national dataset represents tree mortality, so a model would lean on nothing measurable. Identified promotion path: a national tree-mortality dataset.
- **Oyster/Hericium/hedgehog/lobster: RESEARCH_ONLY** (no sourced interior host/phenology base).

The implemented roster is deliberately two strong targets rather than eight weak ones. Host-signal audit (Task 5): the existing FIA signals (spruce/fir 120, fir/spruce/mountain-hemlock 260, lodgepole 280, ponderosa 220, Douglas-fir 200, aspen/birch 900) genuinely represent the interior host set; western larch, grand fir, western white pine and whitebark pine exist in the FIA product but have no exposed signal — declared unweighted in `INTERIOR_HABITAT_NOTE` rather than substituted by generic evergreen cover (no schema change needed this pass; identified additive need).

### Interior canaries (Tasks 15–17)

Built through the planner `run --tiles` path in **187.7 s, zero failures**; new state sources prepared once (ID PBF 128,720,679 B, MT 100,259,404 B, WY 93,630,055 B — all `*-latest` extracts headered 2026-09-15T20:20:37Z, SHA256 recorded; SSURGO ID 10,536 mapunits/57 survey areas, MT 16,931/70, WY 8,309/43; vintages 2025-08-28…2025-09-05):

| Tile | Profile share | States | Fire | Access | Starts |
|---|---|---|---|---|---:|
| `n47_w116` (Selkirk/Coeur d'Alene–Bitterroot) | interiorMountains 100% | ID 39.7 + MT 60.3 | AVAILABLE, 28 perimeters | AVAILABLE, 34 pts | 13 |
| `n44_w115` (Idaho Batholith / Sawtooth) | interiorMountains 100% | ID 100% | AVAILABLE, 42 perimeters | AVAILABLE, 85 pts | 43 |
| `n43_w110` (Yellowstone / Middle Rockies) | interiorMountains 69.7% | WY 100% | AVAILABLE, 25 perimeters | AVAILABLE, 38 pts | 12 |

`n47_w116` exercises cross-state access/soil composition (ID+MT); `n44_w115` is the burn-morel QA tile (42 mapped perimeters in Idaho Batholith fire country); `n43_w110` is the Middle-Rockies boundary tile. Burn QA (Task 17): the browser caps `morelBurn` at the evidence-gap floor when no qualifying perimeter applies and scores the disturbance component when one does (test-pinned); absence of MTBS remains non-evidence.

### Boundary regressions (Tasks 18–20)

- **Interior ↔ PNW**: the North Cascades reassignment is pinned by test — a North Cascades point resolves `pnw` and PNW targets, an Eastern-Cascades point resolves `interiorMountains` and interior targets; a PNW-edge radius scores each sector with its own profile (Eastern Cascades sectors now receive interior targets, never PNW ids).
- **Interior ↔ Southern Rockies**: `B. rubriceps` stays `southernRockies`-only; the two `morelBurn` regional models are distinct objects with distinct calendars and elevation bands.
- **Interior ↔ Southwest**: the AZ/NM mountains reassignment is pinned — a San Francisco Peaks point resolves `southernRockies` (monsoon profile), matching the B. rubriceps source geography.
- No silent fallback anywhere: unsupported sectors (plains, southwest, california) return zero species.

### National coverage and matrix (Tasks 21–22)

Recomputed after the crosswalk change: `interiorMountains` 113 intersecting tiles (coherent), `pnw` 44, `california` 49, `southernRockies` 64, `southwest` 202, `plains` 262, `hardwood` 209, `appalachians` 98, `southeast` 132, `northernForests` 127 (bbox-approximate addressing; land area unchanged). Modeled profiles: **7 of 10** (PNW, Southern Rockies incl. AZ/NM mountains, Northern Forests, Hardwood, Appalachians, Southeast, Interior Mountains). Unsupported: California Mediterranean (49 tiles), Southwest/Arid Interior (202), Great Plains (262). The permanent national canary matrix gains three interior representatives: `44.2,-115.5` (Idaho Batholith), `47.4,-115.7` (northern ID/MT), `43.5,-110.4` (Middle Rockies boundary) alongside the revision-10 entries.

### Tests (Task 30)

`tests/fruiting-forecast-national.spec.js` grew to 11 tests: interior resolution (ID panhandle/Batholith/Wyoming), Task-Zero reassignments (North Cascades→pnw, Sierra→california, sky islands→southernRockies), the interior morelBurn regional parameters (months/elevation/proxy provenance/distinct-object assertions), disturbance capping and burn ordering, matsutake season/host/elevation ordering, and the three boundary rules. PNW boundary tests rewritten for the new Eastern-Cascades ownership with per-sector target isolation. Conus summary updated for 40 complete tiles (28 access, 32+8 fire) and ID/MT/WY coverage. Full sweep: **111 browser tests passed (1 opt-in live skipped)**, adapters 53, publication 6, access 16, release 10, planner 8.

### Manual QA (Task 31)

Inspected desktop + 390 px mobile (screenshots + JSON in /tmp/rev11-*): **northern Idaho/Montana** search — Coeur d'Alene NF with Revett Lake Trailhead `osm:node:131190691` (HIGH), interior targets only; **Idaho Batholith** — Sawtooth NRA with HIGH mapped parking `osm:way:970696531`, 52 access points, the interior Burn Morels target visible with UNKNOWN_VERIFY independent; restricted case (Sawtooth conservation easement, `access=private`, no start) and UNMAPPED case ("does not mean the property is inaccessible") both verified; **interior/PNW boundary** search loads the shared tile and scores sectors per profile. Existing Oregon/Washington PNW and Colorado Southern Rockies regressions pass in the suite.

### National production readiness and hosting (Tasks 24–25)

No national run was executed. The planner `run --tiles` path (used by all four interior canaries) is the national workhorse; it prepares state sources once, composes per-tile state sets from the planner's own geography, journals per label, and resumes. Measured again after the pass: **222 live Parquet assets, 4,541 modern eligible starts, static fruiting-forecast bytes ≈ 30.3 MB, manifest 616 KB, zero dead assets**. Revised CONUS projection (modern-tile medians unchanged by the pass): ~378 MB median published Parquet (p25–p75 ≈ 255–660 MB) across ~3,760 assets — within practical Pages headroom but close enough that the split-hosting decision should be made before the national production run, using the recorded per-state PBF sizes (ME 90.9 MB → FL 656.6 MB) for the ~40-state cache estimate (~10–15 GB) and ~940 DEM downloads (~52 GB transient).

### Remaining profiles and exact next task (Tasks 22–23)

**3 of 10 profiles remain UNSUPPORTED.** Recommended order: **1. California Mediterranean** (49 tiles; dense population; distinct climate; needs its own sourced targets — the golden-chanterelle species complex, black trumpets, candy cap; highest user value per tile); **2. Southwest / Arid Interior** (202 tiles; monsoon ecology; moderate reuse of the SR monsoon model after the sky-island reassignment); **3. Great Plains** (262 tiles; thinnest evidence and lowest relevance; many tiles will be honest VERIFIED_EMPTY forests-void). Exact next biological profile: **California Mediterranean**. After it, the national GIS production run (multi-session, planner-driven) and the remaining two profiles complete the launch gate: currently **7/10 profiles MODELED, 40/940 tiles complete — NOT launch-ready.**

## Revision 10 — CONUS planner, Northern Forests + Southeast profiles, national canaries (2026-09-15)

Started from `153a95d`. **This revision supersedes revision 9's product-direction statement that the project should not scale toward CONUS: the launch requirement is now full CONUS coverage, both GIS and biological, and no launch is recommended while major ecological regions remain biologically unsupported.** Biology stays PROVISIONAL and no missing evidence is fabricated; the Northern Forests and Southeast profiles were researched and implemented as genuine regional models, not aliases of the hardwood models. The production architecture is unchanged.

### National tile planner (Task 1–3)

New `tools/fruiting_conus_plan.py` — deterministic, offline, derived entirely from pinned repository geography:

- `plan --scope conus|... --profile P --state XX` enumerates every one-degree CONUS tile in the pinned catalog and computes, per tile: land share (tile ∩ union of pinned states — the legacy catalog land flag is deliberately NOT trusted, because it misses coastal production tiles like `n42_w125`), per-state area shares, per-EPA-profile area shares, dominant profile, the profile maturity parsed live from the browser file (never hardcoded), current publication and per-layer statuses, the soil/PBF states required (state share ≥ 5%), DEM prepared status (when a source cache is given), and manifest-derived byte estimates.
- `coverage` produces the national coverage matrix; `projection` scales measured per-tile distributions; `run --tiles` executes the PNW two-phase build machinery for explicit tile lists (per-tile soil states from the planner's own geography, access states from the prepared-state geometry rule).
- Planner runtime ≈ 1.2 s for all of CONUS; 8 deterministic tests pin determinism, shares, coverage, filters and the projection.

**Measured national coverage (2026-09-15):** 940 relevant CONUS land tiles; 73 published; 25 with the complete four-layer stack (19 PNW + 2 Colorado access canaries + 4 new national canaries); 332 tiles intersect multiple profiles and 291 multiple states — multi-state/multi-profile tiles are first-class, never resolved from tile centers.

| profile | tiles ∩ | GIS complete | biology |
|---|---:|---:|---|
| pnw | 33 | 19 | PROVISIONAL (production) |
| southernRockies | 33 | 2 | PROVISIONAL (production) |
| northernForests | 92 | 2 | PROVISIONAL (canaries) |
| southeast | 144 | 5 | PROVISIONAL (canaries) |
| hardwood | 197 | 0 | PROVISIONAL (legacy eastern) |
| appalachians | 98 | 0 | PROVISIONAL (reuses hardwood — audited) |
| interiorMountains | 158 | 0 | UNSUPPORTED |
| california | 26 | 0 | UNSUPPORTED |
| southwest | 191 | 0 | UNSUPPORTED |
| plains | 248 | 0 | UNSUPPORTED |

Land area by profile (EPSG:5070, km²): plains 1,883,194 · southwest 1,316,482 · hardwood 1,173,321 · southeast 934,056 · interiorMountains 658,373 · appalachians 642,732 · northernForests 612,621 · southernRockies 145,361 · pnw 144,513 · california 138,712. Approximate full-coverage tile equivalents: plains ~169, southwest ~119, hardwood ~106, interiorMountains ~60, southeast ~84, northernForests ~55, appalachians ~58.

### National source-load projection (Tasks 3–4)

From the manifest's own AVAILABLE-layer distributions (habitat median 14.4 KB, public land 145.4 KB, fire 195.1 KB, access 47.3 KB per tile): full CONUS published Parquet ≈ **378 MB median (p25–p75 ≈ 255–660 MB)** across ~3,760 assets, ~940 DEM downloads (~52 GB transient), soil + PBF preparation for ~40 states (recorded state PBF samples: ME 90.9 MB, OR 253.6 MB, WA 363.1 MB, MI 313.1 MB, GA 356.1 MB, CO 381.5 MB, FL 656.6 MB — scale by state area), PAD-US + MTBS ~2 hosted queries per tile (cached per tile, restart-safe).

**Bottleneck audit (evidence-based):** the per-tile pipeline itself is proven and restart-safe; the material constraints are (1) serial wall-clock — measured ~8–13 min/tile including DEM download → roughly 130–200 serial hours for 940 tiles, requiring multi-session journaled batches (supported); (2) hosted-service volume — PAD-US/MTBS ~2,000 query pairs (cached, but rate/timing behavior at scale is unmeasured); (3) GitHub Pages — the projected 380–660 MB static payload approaches the practical ~1 GB site limit, so full-CONUS hosting likely needs a split (repository data now is 27.7 MB and fine); (4) manifest size — 585 KB at 77 published tiles grows roughly linearly (~7 MB at 1,000 tiles) — still fetchable, keep the current design (Task 25: no speculative optimization). SDA and Geofabrik showed no limits at canary scale; TNM resolution behaved identically across four states. Nothing else is a demonstrated bottleneck.

### Crosswalk correction (demonstrated defect, fixed)

Activating the Southeast profile exposed a frozen-crosswalk defect: EPA codes 77 (North Cascades), 78 (Klamath Mountains) and 85 (Southern California coast) were mapped into `southeast` — harmless while Southeast was UNSUPPORTED, but a silent wrong-biology fallback now. Corrected in both the browser and publisher rosters (drift guard re-verified): 78/85 → `california`, 77 → `interiorMountains`. All adjacency expectations updated (`n42_w123`'s Klamath adjacency now records `california`).

### Northern Forests / Great Lakes (Tasks 6–12)

Research recorded in `biology-research.json` (MushroomExpert/Kuo cibarius-complex source, NAMA, existing GTR sources; iNat as supporting evidence only). Every existing eastern taxon was audited for the north rather than inherited: morel CORE with a later northern calendar ([4,5,6], snowmelt declared UNBUILT as an honest missing driver), chanterelle CORE as the northeastern `Cantharellus cibarius` species complex (stayed at Cantharellus spp. rather than claiming one species), chicken CORE, oyster CORE with the cold calendar retained and cooler bands, maitake/hericium PRESENT (oak/beech dependent), puffball MARGINAL. Northern-specific candidates stayed RESEARCH_ONLY where the stack cannot support them: lobster (Russulaceae hosts unrepresentable), hedgehogs (regional species concept unresolved), black trumpets (separate from the implemented winter craterelle), and eastern matsutake `Tricholoma magnivelare` — recorded with the identified data need (an additive red/jack-pine FIA signal column) before any forecast. No Western taxonomy is transferred; `T. murrillianum` remains PNW-only.

Profile implemented as `northernForests` PROVISIONAL with 7 targets, cooler temperature bands, later months, declared snowmelt gap, and regional provenance. Tests: region resolution for the Great Lakes and New England, roster, later morel calendar, snowmelt declaration, season/habitat/host ordering, hardwood non-inheritance, per-sector boundaries.

### Southeast / Coastal Plain (Tasks 13–19)

Research recorded (Kuo lateritius/tabescens pages verified live; Buyck & Hofstetter 2011 complex discussion via the Kuo record; Antonín et al. 2017 Desarmillaria revision; iNat taxa 143270 and 1238700). The eastern roster audit produced a genuine taxonomic split and one new forecastable target:

- **`chanterelleLateritius` (NEW, CORE)** — the southeastern oak chanterelle `Cantharellus lateritius` (iNat 143270), distinct from the northeastern cibarius complex; oak-hickory host signal, warm-season bands, July onset per Kuo; pine-association weight declared as a 15-weight gap because southern pine FIA classes have no host signal (identified data need, not fabricated).
- **`honeyRingless` (NEW, CORE)** — ringless honey mushroom, `Desarmillaria caespitosa` per iNaturalist 1238700 (traditionally Armillaria tabescens; Antonín et al. 2017 revised the complex), with the Great-Lakes-to-Texas hardwood-root ecology and late-summer flush per Kuo.
- morel MARGINAL with the months-earlier coastal calendar ([2,3,4]); chicken CORE with the warm window and the Laetiporus persicinus note; oyster CORE with the winter calendar ([10..3]); maitake/hericium PRESENT; puffball PRESENT.

Profile implemented as `southeast` PROVISIONAL with 8 targets. Tests: resolution, taxonomy split, MARGINAL morel semantics, warm/winter ordering, honey season ordering, pine-gap declaration, boundary suppression against plains/appalachians.

### National canaries (Tasks 11, 18, 23)

Four new vertical-stack canaries built through the planner `run --tiles` path in **467.6 s, zero failures** — new state sources prepared once each (MI 313,108,736 B PBF/10,664 mapunits; ME 90,850,339 B/1,864; FL 656,564,714 B/3,884; GA 356,086,452 B/5,059; all `*-latest` extracts headered 2026-09-15T20:20:37Z; soil vintages 2025-08-28…2025-09-05):

| Tile | Profile share | States | Habitat | PL | Fire | Access | Starts |
|---|---|---|---|---|---|---|---:|
| `n45_w085` (northern Michigan) | northernForests 71.8% | MI 75.1% | AVAILABLE | 336 properties | AVAILABLE (1) | AVAILABLE, 359 pts | 55 |
| `n45_w070` (northern Maine) | northernForests 100% | ME 100% | AVAILABLE | 119 | VERIFIED_EMPTY | AVAILABLE, 73 pts | 27 |
| `n30_w084` (Apalachicola/FL-GA) | southeast 99.4% | FL 63.5, GA 35.6 | AVAILABLE | 201 | AVAILABLE (119) | AVAILABLE, 62 pts | 3 |
| `n32_w084` (SW Georgia) | southeast 90.8% | GA 100% | AVAILABLE | 230 | VERIFIED_EMPTY | AVAILABLE, 95 pts | 15 |

Per-tile soil provenance was corrected to exactly each tile's own states (a union leak was caught in review and rebuilt). Manual QA (screenshots + JSON): northern Michigan search resolves all 7 Northern Forests targets with a MEDIUM mapped start (Arlington Park `osm:way:513691961`); Apalachicola search resolves all 8 Southeast targets with a HIGH trailhead (Aucilla WMA `osm:node:5979001929`); boundary searches (northern Wisconsin → NF-modeled/no-GIS, central Texas plains → UNSUPPORTED/no-GIS) state their situation explicitly with no fallback. All UNKNOWN_VERIFY independent of access. 390 px mobile verified.

**National canary matrix (the permanent regression spine):** PNW `45.5,-123.6` · Southern Rockies `39.48,-106.05` · Northern Forests `45.5,-84.8` + `45.1,-89.7` (model-only) · Southeast `30.5,-84.2` + `32.5,-84.0` (model-only) · Hardwood `38.3553,-87.5675` · Appalachians `36.5,-83.2` · California `38.5,-122.7` (UNSUPPORTED — no fallback) · Interior Mountains `44.0,-114.5` (UNSUPPORTED) · Southwest `33.5,-112.1` (UNSUPPORTED) · Plains `38.5,-100.5` (UNSUPPORTED).

### Appalachians / Ozarks audit (Task 20)

Audited, not automatically split: the profile deliberately shares the hardwood `HARDWOOD_MODELS` object (asserted by test so the reuse stays a documented decision), and the Ozark/Appalachian region has no sourced regional override that would change months, hosts or weather response under the current evidence base. The profile name remains meaningful as EPA geography. No material defect demonstrated → left alone this pass; flagged for revisit if Appalachian-specific literature (elevational phenology) is researched later.

### Decisions: occurrence prior and snowmelt (Tasks 26–27)

- **Historical occurrence prior: deferred.** Regional biology plus live iNaturalist observations already supply presence plausibility for applicability; a fixed-version GBIF/iNat prior would improve confidence weighting but is not required for honest national coverage, and absence must never become a penalty (existing principle). Kept as a declared `historicalPrior: UNBUILT` field on every target.
- **Snowmelt: deferred with declared proxies.** No national snowmelt dataset exists in the stack; Northern Forests and mountain morel targets declare `snowmelt: UNBUILT` and use explicitly-labeled engineering temperature bands rather than pretending elevation or soil temperature is measured snowmelt. A SNOTEL/NOAA-based national snowmelt interface is recorded as the identified future enhancement, not a launch blocker.

### Tests (Task 31)

`tests/fruiting-forecast-national.spec.js` (6 browser tests): NF/SE resolution, audited rosters, later/earlier calendars, snowmelt declaration, taxonomy split, MARGINAL semantics, season/habitat/host/winter orderings, cross-profile suppression without fallback, and the Appalachians reuse decision. `tests/test_fruiting_conus_plan.py` (8 tests): planner determinism, geometry-derived relevance (coastal tiles included), multi-state/multi-profile shares, Klamath crosswalk correction, browser-parsed maturity, manifest-driven statuses, profile/state filters, GIS-vs-biology coverage separation, measured-distribution projection. Updated: conus places rosters, PNW release adjacency (Klamath→california), adapter coverage/verified-empty counts (+2 canary verified-empty fire tiles). Full suite: **106 browser tests passed (1 opt-in live skipped)**, adapters 53, publication 6, access 16, release 10, planner 8.

### Remaining unsupported profiles and priority (Tasks 21–22)

Four profiles remain UNSUPPORTED: California Mediterranean, Northern Rockies / Interior Mountains, Southwest / Arid Interior, Great Plains. **CONUS is not biologically complete and must not be announced as such.**

Recommended implementation order, from measured area/leverage: **1. Northern Rockies / Interior Mountains** (658,373 km²; highest model reuse — SR montane conifer and PNW taxa genera with the eastern matsutake and red/jack-pine data need; 158 tiles); **2. California Mediterranean** (138,712 km²; dense population, distinct climate, needs its own sourced targets — golden chanterelle complex, black trumpets, candy cap; 26 tiles); **3. Southwest / Arid Interior** (1,316,482 km²; monsoon-driven ecology, low model reuse; 191 tiles); **4. Great Plains** (1,883,194 km²; least mushroom-hunting relevance and thinnest evidence; 248 tiles, likely many VERIFIED_EMPTY access/fire tiles). Exact next profile: **Northern Rockies / Interior Mountains**.

### CONUS launch gate (Task 28)

A CONUS launch may be recommended only when: (1) **Biology** — all 10 macro-profiles are MODELED (or carry a narrowly justified, documented exception); (2) **GIS** — every meaningful CONUS land tile has habitat/public-land/fire/access processed with real per-layer statuses (verified-empty is acceptable; UNBUILT is not); (3) **State preparation** — every required state has versioned, checksummed SSURGO and OSM PBF sources; (4) **Browser** — any CONUS location resolves its ecological profile, a regionally appropriate target set and explicit evidence coverage, with unsupported-profile fallback impossible; (5) **Honesty** — no fabricated thresholds, no inherited calendars, declared gaps preserved; (6) **Performance** — searches stay tile-local, warm searches reuse cache; (7) **QA** — the permanent national canary matrix passes end-to-end. Current status: 6/10 profiles modeled, 25/940 tiles complete, 6 state source sets prepared — **the project is NOT launch-ready, and the next pass targets the remaining biological profiles, not another isolated state release.**

### Updated data-lake metrics (Task 29)

After revision 10: **210 live Parquet assets** (0 dead), **77 published tiles, 37 complete release tiles, 9 published states/territories of modern production (CO/NM/OR/WA/MI/ME/FL/GA + legacy IN)**, **4,473 eligible mapped starts across the 21 modern access tiles** (plus 3,526 legacy Indiana access rows kept for backward compatibility); static fruiting-forecast bytes ≈ 27.9 MB; manifest 585 KB; 36 research sources / 19 research candidates (11 implemented PROVISIONAL targets + 5 regional-profile rosters); source systems: FIA forest type groups, USGS 3DEP, MRLC NLCD/TCC, NRCS SSURGO-SDA (8 state tables), PAD-US, MTBS, Census states, EPA Level III, OpenStreetMap/Geofabrik (8 state PBFs), Open-Meteo, iNaturalist. Cold canary searches fetch 1–9 tiles (0.4–7.9 MB, 12–35 requests); warm repeats fetch zero.

## Revision 9 — western Washington extension (2026-09-15)

Started from `058c7b0`. Same rules as revision 8: biology, species, coefficients and geography definitions frozen; no CONUS; the production contract extends, it is not redesigned. Oregon's published artifacts are untouched except where a boundary tile gains cross-state access evidence (below).

### Generalized derivation (Task 1–2)

`tools/fruiting_pnw_release.py` is now state-parameterized: the candidate window is derived from the pinned state geometry (state bounds expanded by one tile in every direction), the thresholds are unchanged (core ≥ 50% PNW, halo 25–50% four-connected, state share ≥ 25%, equal-area EPSG:5070), and the same `plan`/`run` CLI serves both states. Regression verified live: `--state OR` still derives exactly the 11-tile revision-8 footprint, and a new deterministic test pins it (`test_fruiting_pnw_release.py`). No threshold was changed; no Washington-specific rule was added.

`--state WA` derives **10 tiles — 6 core + 4 halo** (8 new + 2 already-published shared Columbia tiles), recorded per tile with WA share / PNW share / significant adjacent profiles:

| Tile | Role | WA % | PNW % | Adjacent profile(s) | Status |
|---|---|---:|---:|---|---|
| `n45_w123` | core | 32.3 | 99.8 | — | existing (Oregon) — shared |
| `n45_w122` | halo | 31.5 | 39.8 | interiorMountains 42.1, southwest 18.1 | existing (Oregon) — shared |
| `n46_w122` | core | 100.0 | 65.0 | interiorMountains 35.0 | new |
| `n46_w123` | core | 98.7 | 100.0 | — | new |
| `n46_w124` | core | 77.2 | 90.9 | — | new |
| `n47_w122` | halo | 100.0 | 43.8 | southeast 53.5 | new |
| `n47_w123` | core | 99.1 | 79.4 | — | new |
| `n47_w124` | core | 100.0 | 80.5 | southeast 17.9 | new |
| `n47_w125` | halo | 37.0 | 36.0 | — | new |
| `n48_w123` | halo | 79.9 | 47.2 | southeast 16.5 | new |

Excluded deliberately: every eastern-interior tile (Columbia Plateau / East Cascades high desert: `n46_w121`, `n47_w121`, `n45_w121`, `n48_w121/w122`, `n49_*` Canada-border stragglers with <25% WA share). Subregion sanity check after derivation (Task 3): Olympic Peninsula (`n46_w123`, `n46_w124`, `n47_w125`), Puget lowlands (`n47_w123`, `n47_w124`, `n46_w123`), western Cascades (`n46_w122`, north halves of `n47_w123/124`), southwest Washington/lower Columbia (`n45_w122`, `n45_w123`), northwest Washington (`n48_w123`), Cascade-transition halos (`n46_w122`, `n47_w122`, `n45_w122` with interiorMountains/southeast adjacency). No eastern tile receives PNW biology; the ecological boundary stays at the crest.

### Release-size gate (Task 8, recorded before execution)

Real published PNW measurements (11 Oregon tiles) as the empirical basis: habitat 13,830 B/tile, public land 388,520 B/tile, fire 686,507 B/tile, access 204,586 B/tile → projected new bytes for the 8 new tiles ≈ **10.35 MB** (habitat 110,640; public land 3,108,160; fire 5,492,056; access 1,636,688). Sources: national products already READY (checksum-verified reuse, zero downloads); `ssurgo_sda:WA` prepared once — **10,268 mapunit rows, 59 survey areas, survey vintages 2025-08-28…2025-09-02, query fingerprint `09024ff901c2bb11`** — independent from OR/CO/NM caches by construction; 8 new 3DEP DEMs (~55 MB each); Washington Geofabrik PBF prepared once (see below). A dated `260915` WA snapshot did not exist at build time (Geofabrik publishes with lag), so the current official `washington-latest.osm.pbf` extract was used and recorded as its own access dataset version — never presented as a dated snapshot: **363,098,240 bytes, SHA256 `d8a77c4555d966e324f3242a96c82ec6ab093f90c1191889d00dc7721b313493`, provider MD5 `cbab58e052edfb4b88a531411feeba5a`, header extract 2026-09-14T20:21:51Z, retrieved 2026-09-15T21:20:17Z; GATE 63,130 / TRAILHEAD 757 / PARKING 46,025 / ROAD 1,458,815; extraction 182.9 s, preparation 1,305.9 s (roads table 183.7 MB, candidates 9.0 MB)**. Projection modest; proceeded.

### Cross-state composition (Task 7)

The two shared Columbia tiles (`n45_w122`, `n45_w123`) and any tile containing land in both states compose access evidence from **exactly the prepared states whose pinned geometry intersects the tile** (deterministic per-tile rule `_access_states_for_tile`); overlapping Geofabrik extracts deduplicate by stable OSM identity inside the existing `build()`. Boundary-tile access is therefore rebuilt additively with OR+WA evidence (Oregon rows are preserved by id-dedupe; provenance lists both source scopes) — a required combined-region correction, not an Oregon republish; their habitat/public-land/fire assets are never rebuilt (`run` skips tiles already published complete). Soil remains point-level across states by exact MUKEY membership (existing behavior); a tile now composes OR and/or WA soil per cell. Collecting-rule jurisdiction remains state-scoped by the existing Census point-in-polygon.

### Execution record (2026-09-15)

The Washington canary (`n47_w123`, the hardest urban-fringe tile: Seattle metro + central Cascades) completed end-to-end in 233.1 s; the remaining seven new tiles completed in a single batch pass of **762.7 s with zero failures** (plus a deliberate cross-state soil rebuild of the two shared tiles and classifier-fixed access rebuilds, below). All ten Washington tiles publish five-component habitat, PAD-US public land, MTBS fire and OSM access.

Published per-tile Washington bytes (habitat / public-land / fire / access / eligible starts):

| Tile | Role | Habitat | Public land | Fire | Access | Starts |
|---|---|---:|---:|---:|---:|---:|
| `n45_w123` | core (shared) | 13,952 | 631,605 | 659,191 | 392,507 | 443 |
| `n45_w122` | halo (shared) | 13,708 | 145,435 | 713,824 | 87,204 | 231 |
| `n46_w122` | core | 13,837 | 126,919 | 402,649 | 47,870 | 205 |
| `n46_w123` | core | 14,693 | 91,089 | VERIFIED_EMPTY | 46,070 | 75 |
| `n46_w124` | core | 14,265 | 110,950 | VERIFIED_EMPTY | 45,867 | 48 |
| `n47_w122` | halo | 14,769 | 202,141 | 190,865 | 100,721 | 250 |
| `n47_w123` | core | 14,091 | 480,461 | VERIFIED_EMPTY | 573,446 | 517 |
| `n47_w124` | core | 14,464 | 103,549 | 35,171 | 37,001 | 103 |
| `n47_w125` | halo | 11,909 | 85,726 | VERIFIED_EMPTY | 20,477 | 25 |
| `n48_w123` | halo | 13,674 | 182,931 | VERIFIED_EMPTY | 110,805 | 249 |
| **WA tiles total** | | **139,362** | **2,160,806** | **2,003,640** | **1,461,968** | **2,146** (1,472 WA-only + 674 on the two shared tiles) |

Note: the three tiles rebuilt in this pass supersede their revision-8 access rows (n44_w122 135→134 starts after edge assignment; n45_w122 160→231 and n45_w123 349→443 after additive cross-state evidence; the revision-8 table's OR total of 1,532 was true at its own checkpoint).

Access candidates: the canary alone processed 52,534 candidates (729,054 local roads) with 38,477 REVIEW/unassociated urban features audited locally and never published. `n45_w123` remains the densest tile (3,650 published rows). Five wet westside tiles (`n46_w123`, `n46_w124`, `n47_w123`, `n47_w125`, `n48_w123`) are explicit MTBS `VERIFIED_EMPTY` — verified against the authoritative service directly (the central Cascades fires sit in the eastern tiles: `n46_w122` 20 perimeters, `n47_w122` 10, `n47_w124` 7 including Paradise 2015; `n45_w122` 50). Soil: the two OR-built shared tiles were deliberately rebuilt with `--soil-states OR,WA` so Washington-side cells resolve Washington evidence (point-level exact MUKEY); `n46_w123`/`n46_w124` auto-included Oregon soil at build time by the same membership rule (their bboxes contain the Astoria corner); interior WA tiles carry WA-only soil, all five components AVAILABLE.

### Washington false-positive audit (Tasks 17–18)

Every WA tile's full normalized audit was inspected by name/operator:

- **Transit/ferry false positives found and fixed generically.** Washington stressed urban context exactly as predicted: three TriMet park-and-rides (Portland), "McCollum Park Park and Ride" (HIGH, Snohomish County Parks operator — the word "Park" passed recreation context), "Ober Park Park and Ride", "Poulsbo Junction" (Kitsap Transit), and "Ferry Waiting Area" (Washington State Ferries) were graded MEDIUM/HIGH start-eligible. Generic fix in `normalize()` (PARKING-only, word-boundary): `park and ride`/`p&r` variants, `transit center|station|mall`, `commuter parking|lot`, `ferry|ferries`, `transit`, `trimet`. Verified against Sno-Parks: "White River West Sno-Park", "Glacier View Sno-Park/Trailhead", "Gold Creek Sno-Park" (USFS) all remain legitimate starts — snow-program parking is real recreation access. Starts removed: n47_w123 521→517, n45_w123 449→443, n48_w123 250→249.
- **No leakage of legitimate institutional land management:** "School Canyon Trailhead" (USFS) unchanged; university/institutional rules from revision 8 re-verified on the merged WA evidence.
- Gates: "Small Dog Area" and unnamed gates remain MEDIUM/LOW cautions, never starts. Ferry/transit HIGH/MEDIUM parking remaining after the fix: **0**.

### Single-tile edge assignment (Tasks 7, 20)

Cross-state rebuilding exposed three genuine cross-tile duplicates (edge-crossing parking polygons published by both adjacent tile builds, two as eligible starts — e.g. `osm:way:366911846` at lat 45.99987, `osm:way:235063352` at lon -122.00057). Fixed at the source: candidate selection now assigns each feature to exactly one tile by its stable representative point with half-open edges (`[west, east) × [south, north)`), so an edge-crossing polygon publishes once with full geometry and a point exactly on an edge belongs to the north/east tile only. All 19 PNW tiles were rebuilt with the corrected selection; the region now has **17,693 access rows, all unique IDs, zero cross-tile duplicates and zero duplicate eligible starts** (public land 10,415 IDs conflict-free; MTBS 297 perimeters, 29 cross-tile with one identity). Regression-tested (`test_edge_crossing_area_publishes_in_exactly_one_tile`).

### Hemlock/Sitka-spruce signal QA (Task 12)

The additive FIA class-300 signal validates across Washington where source data supports it: `n47_w125` 130/400 cells (Olympic coast rainforest), `n47_w124` 113 (North Cascades), `n46_w124` 97 (Willapa Hills), `n47_w122` 63, `n46_w122` 22, `n48_w123` 20 — and near-zero in urban/lowland tiles (`n47_w123` 1) where hemlock stands are absent. Douglas-fir remains dominant on the west side as mapped. No evergreen substitution occurred; the signal is absent where the FIA class is absent, and legacy/Southern-Rockies schemas still read it as NULL.

### Browser measurements (Tasks 27, 12; local Chrome, mocked basemap)

Representative searches from `47.60, -122.30` (Puget metro):

| Radius | Tiles loaded | Properties | Radius-filtered access rows | Eligible starts in view |
|---|---:|---:|---:|---:|
| 10 mi | 1 | 2,653 | 4,883 | 257 |
| 25 mi | 2 | 3,231 | 6,464 | 335 |
| 50 mi | 7 | 3,877 | 8,054 | 434 |
| 100 mi | 8 | 4,534 | 9,017 | 522 |

Only required tiles lazy-load; warm repeat fetch is zero Parquet bytes. Cold full-sweep transfer: habitat 111,702 B + public land 1,383,766 B + access 980,553 B + fire 628,685 B = **3.10 MB across 26 requests**. At the 50-mile radius the per-sector profiles show 4 PNW zones plus one `southeast`-profile zone inside the halo — unsupported sectors stay unsupported while GIS evidence still loads there.

### Manual QA record (Task 33)

Reviewed desktop + 390 px mobile screenshots and JSON reports (`/tmp/pnw-wa-*.png/json`; exact selected properties and OSM objects retained in the JSON):

- **Olympic Peninsula:** Olympic National Forest — Higley Peak Trailhead `osm:way:1328203915` (HIGH mapped parking polygon, inside), collecting UNKNOWN_VERIFY independent; restricted case Olympic-Willapa Hills-South Puget Sound Wildlife Area Complex with `access=private` shown and no start; no-access case Aberdeen Reservoir (UNMAPPED, "does not mean the property is inaccessible").
- **Puget/metro fringe:** Snoqualmie National Forest — Hansen Creek Trailhead `osm:way:171300420` (HIGH), 6,464 radius-filtered access features from two metro tiles with no transit lot suggested.
- **Western Cascades:** Snoqualmie NF — HIGH unnamed mapped parking inside; Alpine Lakes Wilderness Study Area exercises the UNMAPPED case.
- **Southwest Washington / Columbia boundary (45.90, −122.70):** Gifford Pinchot NF — "sunset falls" parking `osm:way:1065775203` (HIGH); the search loads shared Oregon tiles and Washington tiles together (`n45_w123/124`, `n46_w123/124`).
- **PNW/interior boundary (46.70, −121.30):** Gifford Pinchot — Elk Pass / Boundary Trailhead `osm:way:439071164` (HIGH) while the eastern part of the radius resolves unsupported interior ecology.
- **Strong biology / no mapped access:** recommendation retained with confidence lowered (UNMAPPED factor 0.75).
- **Good access / poor current biology:** Buckhorn Wilderness with Mount Townsend Upper Trailhead and a 20/100 biology fixture scored **recommended 8/100** — access cannot manufacture a recommendation.
- Every inspected WA property shows UNKNOWN_VERIFY with "no matched rule" — no Washington collecting permissions were invented (Tasks 13–14); national-park/management designation implies nothing.

### Columbia cross-state search (Task 26)

A permanent browser regression (`a Columbia cross-state search loads both states, dedupes access and reuses the cache warm`, search `45.63, -122.65` radius 50) verifies: 9 tiles lazy-load across both states (OR row `n44_w123`, shared `n45_w122/123`, WA row `n46_w122/123/124`); species selection stays ecological (five PNW targets, no Colorado porcini); the shared tile's habitat declares composed `ssurgo_sda` sources for OR and WA; 57 Oregon-side and 15 Washington-side properties in one result set; access rows dedupe to stable IDs (555 views → 551 unique, repeats only through ambiguous property association, never a duplicated pin); every jurisdiction resolves UNKNOWN_VERIFY with no rule leaking across the line; and the warm repeat issues **zero GIS requests**. Cold run: 34 requests.

### Tests (Task 32)

- `tests/test_fruiting_pnw_release.py` now 10 tests: WA derivation from the same contract with roles, interior-exclusion and shared-tile intersection; Oregon footprint unchanged; per-tile access-state geography (`_access_states_for_tile`); WA plan reporting shared/new tiles honestly.
- `tests/test_fruiting_bulk_adapters.py` now 53 tests: the combined 19-tile PNW footprint equals the two-state derivation; per-tile completeness with six verified-empty fire tiles; per-state soil floors; cross-state soil on shared tiles (`{'OR','WA'}` sources); regional cross-tile access identity over real data; no Canada-border tile.
- `tests/test_fruiting_osm_access.py` now 16 tests: transit/ferry/institutional parking rejected generically while Sno-Parks and "School Canyon Trailhead" survive; edge-crossing area publishes in exactly one tile (half-open representative-point assignment).
- `tests/fruiting-forecast-conus.spec.js`: 33-tile release declaration and derived summary (33 coverage tiles, pnw 19, access available 21, fire verifiedEmpty 6/available 27).
- `tests/fruiting-forecast-pnw.spec.js`: the new Columbia cross-state regression (above).
- Full browser suite **100 passed / 1 opt-in live skipped**; adapter 53; publication 6; access 16; release tool 10 — all green.

### Regression outside Washington (Task 25)

Oregon's derivation is pinned by test to the exact 11-tile footprint; `shares_for_tiles('OR')` over the generalized state-derived window reproduces it byte-for-byte in role and share. Oregon habitat/PAD-US/MTBS assets were never rebuilt. Two shared Columbia tiles (`n45_w122`, `n45_w123`) intentionally gained additive cross-state access evidence (Task 7) and simultaneously had their Portland TriMet park-and-rides correctly rejected by the transit fix — their published access assets were superseded; no other Oregon access file changed content except the three edge duplicates losing their second copy. Colorado, New Mexico and Indiana regressions pass unchanged; legacy Parquet and mixed-schema DuckDB-Wasm reads remain green. Biology is untouched and all profiles remain PROVISIONAL.

### Updated data-lake metrics for the announcement (Task 28)

Computed from the repository after Washington (2026-09-15): **194 live Parquet assets** (11 dead superseded files, 2.3 MB, removed in this pass); **73 published tiles; 33 complete release tiles** (14 Southern Rockies + 19 PNW); **2 production states with modern coverage** (OR, WA) plus CO/NM modern-but-pre-PNW; **two modeled production profiles** published at regional scale (Southern Rockies 14 tiles, PNW 19 tiles) with 3 modeled profiles and **13 provisional target-taxa** implemented; **eligible mapped starts: 2,967** across the PNW region (821 Oregon-only tiles + 674 on the two shared Columbia tiles + 1,472 Washington-only tiles); live static bytes: habitat 985 KB, public land 7.19 MB, access 2.60 MB, fire 9.01 MB — **fruiting-forecast total ≈ 27.7 MB** (git pack ≈ 24 MiB before this commit). Authoritative sources: USDA FIA forest type groups, USGS 3DEP, MRLC Annual NLCD + Tree Canopy, NRCS SSURGO via Soil Data Access (CO/NM/OR/WA state tables), USGS PAD-US, USGS MTBS, US Census boundaries, EPA Level III, OpenStreetMap/Geofabrik state PBFs (CO 381.5 MB @2026-09-13, OR 253.6 MB @2026-09-13, WA 363.1 MB @2026-09-14), Open-Meteo, iNaturalist. DuckDB-Wasm executes in-browser SQL/Parquet; IndexedDB (+ OPFS attempt) caches tile bytes; representative cold searches 26–35 requests / 3.1–7.9 MB; warm repeats zero requests.

### Dead-asset audit (Task 29)

The manifest-vs-live-files audit after Washington found **11 unreachable content-addressed Parquet files (2,300,449 bytes)**: two shared-tile habitat digests superseded by the cross-state soil rebuild, and nine access digests superseded by the transit/ferry fix, the single-tile edge assignment and the earlier OR pre-fix builds. All were verified unreferenced by the current manifest and removed; every remaining file is live evidence. Raw sources outside `data/fruiting-forecast/` were not touched.

### Updated scaling projection (Task 30)

With OR+WA measured (~1.07 MB published bytes/tile average across the four layers; ~2–4 min per tile build+publish including DEM; state soil ≈ one SDA query set; state PBF ≈ 250–400 MB + ~2.5–20 min prepare):

- **Complete modeled PNW (Oregon + Washington), as now published:** 19 tiles, **12.0 MB** live region bytes, 2,967 starts — done.
- **Adding one more biological region** (e.g., Northern California or the Idaho batholith under a future profile): a bounded 8–15-tile derivation → **+9–16 MB** and one new state PBF + soil table; the release tool needs only the new profile's EPA codes in the crosswalk.
- **All currently modeled regions at full extent** (hardwood Great Lakes states + complete Southern Rockies CO/NM + PNW OR/WA): roughly **55–85 tiles → 60–90 MB**, ~15–20 state PBF preparations (~4–7 GB cache), ~12–15 SSURGO state tables, per-tile DEM/PAD-US/MTBS as now. Feasible on Pages only with the tile-catalog lazy loading the app already has; the manifest stays the address boundary.
- **CONUS GIS factory:** ~955 land tiles × ~1.07 MB ≈ **1.0 GB** published; ~1.6 GB transient DEM traffic; ~10–15 GB of state PBF sources; PAD-US/MTBS 2 queries/tile. Exceeds practical GitHub Pages limits (~1 GB soft) — would require split hosting or a release artifact channel, plus per-tile lazy manifest partitioning. Not executed; the derived-selection + size-gate + batch pattern is the repeatable unit.

### Remaining weaknesses and exact next task

Washington's five fire-VERIFIED_EMPTY tiles are honest but mean burn-morel scoring in the wet westside rests on absence of mapped ≥1,000-acre fires — consistent with MTBS semantics, yet a dedicated westside disturbance dataset would be the only real fix. Shared-boundary tiles now carry two access provenance scopes; the browser shows one merged evidence set without exposing per-state provenance in the UI (manifest-recorded only). Ferry-transit rejection is name/word based — a forest parking lot named "Transit Camp" would be over-rejected (none exists; conservative direction is safe). The metro tiles dominate access density (n47_w123: 6,008 published rows, 517 starts vs n47_w125: 64 rows) — real OSM density variance, not a defect. Park-and-ride-adjacent trail networks still surface LOW rows near transit hubs; they are never starts. n45_w123 (Portland/Vancouver) remains the payload-heavy tile (392 KB access, 3,650 rows); browser map caps keep it usable.

**Next recommended task: verify and, if clean, announce the OR+WA production region** using the measured metrics above (the bounded-release story: derived ecology, verified-empty honesty, cross-state composition, zero-repeat warm cache). Technical alternative if announcement waits: extend the same contract to the Oregon/California Klamath border or complete the Southern Rockies' remaining Colorado tiles — both are bounded 5–15-tile derivations. Do not start CONUS.

## Revision 8 — bounded Oregon PNW production release (2026-09-15)

Started from `da56302`. Biology, species rosters, coefficients, calendars, weights and geography definitions are frozen. This revision builds the first complete vertical-stack region: regional biology + weather + forest hosts + elevation + canopy + land cover + soil + wildfire + public land + collecting-rule status + physical access + Suggested Start + browser caching, over a derived Oregon tile set. No Washington, no California, no CONUS.

### Derived tile selection (recorded before execution)

`tools/fruiting_pnw_release.py` derives the release from repository data — pinned EPA Level III (`ecoregions.json`, PNW profile = codes 1/2/3/4) and Census states (`states.json`) — intersected in equal-area EPSG:5070. No rectangle, no hand-maintained list:

- Candidate tiles: every 1-degree tile in lat 40–48 / lon −127–−114 whose *Oregon share* ≥ 1% is evaluated; only tiles with Oregon share ≥ 25% are eligible, which excludes Washington-dominant tiles (`n46_w123` 1.3% OR, `n46_w124` 18.6% OR) and ocean tiles.
- **Core**: PNW share ≥ 50%.
- **Halo**: 25% ≤ PNW < 50%, included only when four-connected to the selected set (BFS flood fill from the core), so a 25–100 mile search near the release edge loads real neighboring evidence instead of ending abruptly.
- Result: **11 tiles — 7 core + 4 halo**. Recorded per-tile PNW% / OR% / significant adjacent profile shares:

| Tile | Role | PNW % | OR % | Adjacent profile(s) |
|---|---|---:|---:|---|
| `n42_w123` | core | 50.8 | 96.6 | southeast (Klamath) 34.0, interiorMountains 15.3 |
| `n42_w125` | halo | 26.8 | 42.7 | southeast 15.8 |
| `n43_w123` | core (canary) | 100.0 | 100.0 | — |
| `n43_w124` | core | 71.7 | 100.0 | southeast 28.3 |
| `n43_w125` | halo | 27.9 | 28.5 | — |
| `n44_w122` | halo | 32.0 | 100.0 | interiorMountains 67.1 (Blue Mountains/Eastern Cascades) |
| `n44_w123` | core | 100.0 | 100.0 | — |
| `n44_w124` | core (canary) | 100.0 | 100.0 | — |
| `n45_w122` | halo | 39.8 | 68.6 | interiorMountains 42.1, southwest 18.1 |
| `n45_w123` | core | 99.8 | 67.8 | — |
| `n45_w124` | core | 96.4 | 97.1 | — |

Excluded deliberately: `n42_w122` (PNW 1.3%, arid east side), `n42_w124` (PNW 6.8%, Klamath), `n43_w122` (PNW 12.0%, Eastern Cascades high desert), `n44_w125` (PNW 8.3%, mostly ocean), all `n46_*` (Oregon share < 25% — would import Washington geography), and every tile east of the derived halo set (interior/arid). The halo set exercises the PNW/interior ecological boundary (Blue Mountains/Eastern Cascades → unsupported `interiorMountains`), the southern Klamath boundary (unsupported `southeast`), and the open-ocean edge.

### Release-size gate (dry-run plan, recorded before building)

Estimates use only real published PNW measurements (canaries `n44_w124` + `n43_w123` averages): habitat 14,089 B/tile, public land 171,633 B/tile, fire 500,179 B/tile, access 66,698 B/tile → estimated new bytes for the 9 new tiles ≈ **6.77 MB** (habitat 126,801; public land 1,544,697; fire 4,501,611; access 600,282). Sources: national products + `ssurgo_sda:OR` already READY in `/tmp/ffsrc` (checksum-verified reuse, zero new soil requests — 1 state, prepared once); 9 new 3DEP DEM preparations (~50–60 MB each, per-tile TNM resolution); prepared Oregon Geofabrik PBF reused (SHA256 `5511e363f0cfdc41…`, extract 2026-09-13T20:21:20Z, 253,592,262 bytes — validated on reuse, never redownloaded). The projected release is modest; no optimization is warranted.

### Batch orchestration

`tools/fruiting_pnw_release.py run` executes the smallest useful orchestration layer over the existing prepare/build/publish components: (1) prepare national + state soil (idempotent, READY reuse), validate the prepared OR access source; (2) **Phase A** per tile in deterministic lat-then-lon order — prepare tile DEM, compose habitat/public-land/fire from the source cache, publish through the existing publisher boundary (lock, atomic manifest, content-addressed assets, `--resume`); (3) **Phase B** — access proof per tile, only after that tile's habitat is complete and inside `coverageTiles` (the access builder's existing release-geography guard). A JSON journal in the normalized output dir makes runs restartable; a failed tile is journaled and never corrupts successful tiles; byte-identical outputs are skipped via the publisher's digest resume. The publisher gained an importable `publish_tiles()` (behavior-preserving refactor; CLI unchanged).

### Execution record (2026-09-15)

The full run completed with **zero failures**: one-tile smoke run (`n44_w123`) 115.6 s end-to-end (TNM release resolution → `USGS_1_n45w123_20250804.tif` download → PAD-US/MTBS hosted-service queries → habitat/pl/fire build+publish → access build+publish), then the remaining tiles at **757.7 s** for a full non-resume pass (all 11 tiles; a repeat build without `--resume` produced byte-identical outputs where sources were unchanged, and the publisher's digest resume made the rebuild cheap). Source reuse verified live: national products (FIA forest type 168,022,806 B; Annual NLCD land cover 1,427,423,034 B; NLCD tree canopy 3,740,022,899 B; Census states 186,432 B), `ssurgo_sda:OR` (12,556 mapunit rows, survey vintages 2025-09-09…2026-08-05, 52 survey areas), and the prepared Oregon Geofabrik PBF (`oregon-260913.osm.pbf`, 253,592,262 B, header 2026-09-13T20:21:20Z, SHA256 `5511e363f0cfdc41ac3d6a9b34668b6a34a2131ae88cc638c7f8d818190c6ddc`) were all already READY and were checksum-validated on reuse — **no source was re-downloaded for this release**. Seven new 3DEP DEMs were resolved from the TNM bucket listing and downloaded (n43w123, n43w125, n44w124, n44w125, n45w122, n45w123, n46w122 as USGS north-edge names for the new release tiles); PAD-US/MTBS hosted-service query caches were populated per tile (`padus_v2_*`/`mtbs_*`, restart-safe).

Published per-tile PNW bytes (habitat / public-land / fire / access / eligible starts):

| Tile | Role | Habitat | Public land | Fire | Access | Starts |
|---|---|---:|---:|---:|---:|---:|
| `n42_w123` | core | 14,381 | 165,328 | 324,248 | 74,346 | 161 |
| `n42_w125` | halo | 12,197 | 88,962 | 244,025 | 23,113 | 33 |
| `n43_w123` | core (canary) | 13,749 | 174,262 | 980,912 | 34,238 | 86 |
| `n43_w124` | core | 14,128 | 96,690 | 241,937 | 24,746 | 25 |
| `n43_w125` | halo | 11,740 | 46,800 | 388 (VERIFIED_EMPTY, 0 perimeters) | 25,695 | 54 |
| `n44_w122` | halo | 14,611 | 120,919 | 1,158,040 | 66,661 | 135 |
| `n44_w123` | core | 14,423 | 137,745 | 1,524,272 | 47,323 | 75 |
| `n44_w124` | core (canary) | 14,429 | 169,005 | 19,446 | 99,158 | 131 |
| `n45_w122` | halo | 13,708 | 145,435 | 713,824 | 65,621 | 160 |
| `n45_w123` | core | 13,952 | 631,605 | 659,191 | 362,013 | 349 |
| `n45_w124` | core | 14,511 | 156,612 | 17,368 | 69,340 | 122 |
| **Total** | | **151,829** | **1,933,363** | **5,883,651** | **892,254** | **1,532** |

The whole PNW vertical stack is **8,861,097 bytes** (~8.9 MB). Habitat candidates processed: 60,913 across the release (n45_w123 Portland-metro/Columbia-Gorge tile alone: 24,702 candidates → 3,206 published → 349 eligible starts). `n43_w125` fire is an explicit `VERIFIED_EMPTY` (ocean-heavy southern coast, zero mapped MTBS perimeters) — the honest declaration, not a missing source. Soil coverage tracks real land (n43_w125 108/400 drainage cells at 28.5% land share; inland tiles 279–399/400); ocean cells keep NULL and the soil component stays AVAILABLE.

### Regional false-positive audit (Task 9)

Every tile's full normalized audit file (`<tile>.audit.json`, including unpublished candidates) was inspected by name/operator/association, not only counts:

- **Systematic flaw found and fixed generically.** Regional scaling surfaced institutional lots passing the recreation-context test through adjacent mapped footways: "Parent Parking" (Beaverton School District, inside Whitford Middle School) and a college lot (Clackamas Community College) graded HIGH/MEDIUM start-eligible, plus "Office Parking" (Baskett Slough NWR headquarters lot) HIGH. Fix in `fruiting_osm_access.normalize()`: PARKING-only word-boundary rejection of institutional education contexts — the feature's own name/operator (`school|college|university|campus|academy`), explicit institutional lot names (`parent|student|staff|customer|office|employee parking`), or any associated property name (`school|college|university|campus`) — now REJECTED with reason "Structured, institutional or non-recreation parking". **531 rows flipped across the release** (e.g. n45_w123 398; n44_w124 57 incl. 40 school-restricted cautions); starts went 407→349 (n45_w123) and 132→131 (n44_w124). The rule is deliberately PARKING-only: explicit `highway=trailhead` evidence survives place names like "School Canyon Trailhead" (USFS, n45_w122, verified real). Name matching uses word boundaries ("trail" cannot match "trailer" retained from the canary fix).
- **No over-rejection of legitimate university-forest access.** McDonald-Dunn Research Forest (Oregon State University) keeps its 8 HIGH parking/trailhead starts; its published operator is "OSU Research Forests" and the PAD-US property name contains no school/college/university/campus word. The forest's locked gates (100/200/400/800 Gate etc.) remain RESTRICTED cautions, never starts.
- **Rejections verified correct:** Walmart Supercenter, Cottage Grove High School (×5), Lane Community College–Cottage Grove, Harrison Village Apartments, UPS employee parking, "Air Garage", "Parking Lot D", Beaverton school lots. None of these is a mushroom-relevant forest access point.
- **Reviewed and deliberately kept:** "Locked Gate Day-Use Area" (Deschutes River Segment E) has no restriction tags — a name alone is not a tag, so no restriction is fabricated; it stays HIGH with the visible name. "South West Parking Lot" inside Bush Pasture (Corvallis city park) is real public recreation parking. "Academy Square" `access=customers` parking remains RESTRICTED (the tool's associated-property pattern is deliberately narrower than the audit scanner and explicit restrictions always surface as cautions).
- Gates audited: RESTRICTED gates are genuinely `access=private/no`, `locked=yes`, or forestry gates (e.g. McDonald-Dunn); REVIEW rows are genuinely unassociated candidates (local audit only, never published).

### Tile-edge identity QA at regional scale (Tasks 16–17)

Across all 11 published PNW tiles: habitat has exactly 4,400 cells (11×400, no duplicates or missing edge cells); public land has 5,843 unique property IDs with **zero identity conflicts** (no same-id/different-name or cross-state id); MTBS has 261 unique perimeters, **28 crossing tile edges with one stable identity each**, zero within-tile duplicates; access has 7,796 published rows, **all unique `osm:*` IDs, zero cross-tile duplicates and zero coordinate conflicts**, so no start can appear twice. Area parking crossing a tile edge is published once in the tile containing its mapped representative point with full unclipped geometry.

**Orphan cleanup:** auditing every published `habitat/`, `pl/`, `ap/`, `fire/` file against the manifest revealed 22 dead content-addressed assets (~3.3 MB) — superseded digests from earlier revisions (12 old Southern-Rockies public-land files and 2 Colorado habitat files), the pre-manifest legacy sampler access stubs (`ap/n35_w087`, `ap/n36_w085/086/087`), and 4 access files superseded by the institutional-lot fix within this pass (including the committed `ap/n44_w124-45c48870…`). All were unreferenced by every current manifest generation; removed so the published asset set contains only live evidence.

### Browser measurements (Tasks 12, 19–20)

Representative searches from `44.60, -123.50` (central Coast Range/Willamette), real Parquet over a local static server, mocked basemap only:

| Radius | Tiles loaded | Properties | Radius-filtered access rows | Cold elapsed |
|---|---:|---:|---:|---:|
| 10 mi | 1 | 221 | 651 | 4.5 s |
| 25 mi | 2 | 589 | 1,130 | 3.2 s |
| 50 mi | 7 | 2,035 | 2,769 | 4.4 s |
| 100 mi | 9 | 5,339 | 6,659 | 11.1 s |

Only required tiles lazy-load at every radius; a warm repeat fetch of the 25-mile search reloads **zero Parquet bytes** (IndexedDB/OPFS byte cache; the osm-access transfer test proves 0 repeat bytes including duplicate descriptors). Cold full-sweep transfer measured at the response layer: habitat 125,251 B + public land 1,679,073 B + access 775,275 B + fire 5,314,990 B = **7.89 MB across 35 requests** (9 tiles; fire bytes are dominated by two large perimeters in n44_w123/n44_w122). A single-tile radius-filtered access query processes 1,064 rows in 693 ms in-page. **Access source asymmetry:** the browser receives an 892 KB access layer for the whole region (and ~0.8 MB per tile worst case) derived from a 253.6 MB state PBF plus a 144.7 MB prepared road/candidate cache that never leaves the build machine.

### Manual QA record (Task 22)

Reviewed desktop + 390 px mobile screenshots and JSON reports (`/tmp/pnw-*.png/json` from the removed diagnostic harness; cases and exact selected properties retained in the JSON):

- **Coast Range (chanterelle forest, mapped access):** Siuslaw National Forest — Suggested Start Pawn Trail Trailhead `osm:node:13020145359` (HIGH, inside), collecting UNKNOWN_VERIFY shown independently.
- **Western Cascades:** Deschutes National Forest — HIGH unnamed mapped parking start inside; plus a no-access case (Blue Mountain Park, county land) showing "Suggested start unavailable … does not mean the property is inaccessible" with Huntability lowered by confidence (34/100), not penalized.
- **Southern Oregon PNW:** Rogue River National Forest — Anderson Mountain Trailhead (MEDIUM, `ambiguous-multiple-properties` property ambiguity preserved), Huntability 46/100; the same search loads `n42_w123`, `n43_w123`, `n43_w124`.
- **PNW/interior boundary (44.00, −121.75, 50 mi):** per-sector arbitration verified in-page — 3 PNW zones receive the five PNW targets; 2 zones inside Eastern Cascades/Blue Mountains resolve `interiorMountains` with **empty species lists** (unsupported), while GIS properties and mapped starts still load there. GIS coverage and biological-model coverage remain separate dimensions.
- **Strong biology / no mapped access:** recommendation still present with confidence lowered (UNMAPPED, confidence factor 0.75).
- **Good access / poor current biology:** a HIGH-access property with a 20/100 biological fixture scored **recommended 11/100** — access cannot manufacture a recommendation.
- Collected-rule status remains UNKNOWN_VERIFY with "no matched rule" for every inspected Oregon property; no Oregon collecting permissions were invented (Task 13).

### Tests (Task 26)

- New `tests/test_fruiting_pnw_release.py` (7 tests): selection thresholds/flood-fill/state-gate on synthetic shares, determinism, real-selection == published release with per-tile role/share invariants, plan estimates from real measurements, honest missing-cache reporting, journal-resume digest semantics.
- `tests/test_fruiting_bulk_adapters.py` (52 tests, +2): updated PNW release footprint incl. derived-geometry equality, per-tile component/layer completeness with the explicit ocean VERIFIED_EMPTY, scaled soil floors, cross-tile access identity over real published data (no duplicate ids/places/starts), no `n46_*` Washington tiles, WA bbox-metadata semantics documented.
- `tests/fruiting-forecast-conus.spec.js`: 25-tile release declaration (habitat AVAILABLE, five components, OR soil, pl/fire/access status per tile incl. VERIFIED_EMPTY fire) + a new derived release-summary test (coverageTiles 25, pnw profile 11, access AVAILABLE 13, fire verifiedEmpty 1 / available 24).
- Publisher refactor (`publish_tiles()`) is behavior-preserving; the 6 publication tests pass unchanged.
- OSM access suite 14 tests pass; institutional-rejection behavior is exercised through the real release artifacts above (audit files) plus the word-boundary fixtures from the canary pass.

### Regression outside PNW (Task 23)

The full browser suite (98 active tests) re-ran green: Colorado Southern Rockies canaries, the New Mexico boundary tiles, the two-state release digests, Indiana legacy tiles, mixed-schema DuckDB-Wasm reads (`union_by_name=true`), collecting-rule jurisdiction scoping and the legacy access reads are unchanged. Only the release-footprint test data and the WA bbox-metadata expectation changed, both with updated documentation. No habitat, PAD-US, MTBS or legacy access asset bytes changed; all legacy Parquet remains readable.

### Data-lake metrics for the announcement (Task 21)

Computed from the repository (2026-09-15): **179 modern tile-layer Parquet assets** across 65 published tiles (25 complete release tiles + 40 legacy/sampler), **≈27.8 MB total fruiting-forecast static data** (habitat 0.87 MB, public-land 5.81 MB, access 1.55 MB, fire 8.38 MB, plus shared geography/rules JSON); git pack ~24.3 MiB. Three modeled ecological profiles with **13 provisional target-taxa** (hardwood 4, Southern Rockies 4, PNW 5 — regional parameters differ even where target ids repeat). Authoritative source systems: USDA FIA forest type groups, USGS 3DEP, MRLC Annual NLCD + Tree Canopy, NRCS SSURGO via Soil Data Access, USGS PAD-US, USGS MTBS, US Census cartographic boundaries, EPA Level III ecoregions, OpenStreetMap/Geofabrik PBF extracts, Open-Meteo, iNaturalist. DuckDB-Wasm runs the in-browser SQL/Parquet analysis; IndexedDB (+ OPFS attempt) caches downloaded tile bytes; cold searches fetch only required tiles, warm searches ideally fetch zero.

### Scaling projection (Task 25; no large build executed)

Using measured production numbers (~0.8 MB published bytes/tile across the four GIS layers; ~1.5–2.5 min per tile build+publish; ~0.7–2 min DEM download; 1 PAD-US + 1 MTBS query per tile; one state soil preparation ≈ minutes; one state PBF preparation ≈ 2–3 min after download):

- **Full modeled Oregon PNW** (every ≥25% PNW-share Oregon tile incl. Klamath-edge): ~16 tiles → ~13 MB published, ~30 min build after sources. Marginal.
- **Oregon + western Washington** (Puget Lowland/Coast Range/Cascades west of the crest): ~28–32 tiles → ~25 MB published; needs one WA PBF preparation (~300 MB, ~2–3 min) + WA SDA soil; DEM prep dominated by downloads.
- **All three currently modeled regions at full extent** (hardwood Great Lakes states + Southern Rockies CO/NM complete + PNW OR/WA): roughly 120–180 tiles → **~100–150 MB** published; the dominant costs are per-tile PAD-US/MTBS queries and DEM downloads; state soil tables for ~10 states.
- **CONUS GIS factory**: ~955 catalog land tiles → **~770 MB** published, ~1.6 GB transient DEM traffic, ~25–40 GB of state PBF sources, PAD-US/MTBS ≈ 2 queries/tile. GitHub Pages: the full repo already stands at ~24 MiB packed; a CONUS-sized 770 MB payload would exceed practical Pages limits (soft 1 GB/site) — a separate release artifact or object storage would be required, plus a tile-catalog-driven lazy manifest. Not executed; the bounded-release architecture (derived selection + size gate + batch orchestrator) is the pattern to repeat.

### Remaining weaknesses and exact next task

The PNW release is bounded to Oregon by the state-share rule; Washington publishes zero tiles but legitimately appears in `states` bbox metadata for the Columbia-river tiles. Connectivity is still a bounded local geometric check, not routing; "Locked Gate Day-Use Area" shows names can encode restrictions that tags don't (left to the reader by design). PAD-US includes hundreds of small school/city parcels in the Willamette Valley, which inflates public-land property counts in urban tiles (n45_w123: 3,620 properties) — presentation, not correctness; access evidence remains forest-filtered. OSM completeness varies (rural tiles like n43_w124 have 25 starts while metro tiles have 349). The n43_w125 VERIFIED_EMPTY fire case is honest but means burn-morel scoring there rests on absence of mapped fire, which is not evidence of absence (consistent with the project-wide MTBS semantics).

**Next recommended task: extend the release to western Washington under the same derived-selection rule (PNW-share + connectivity, state share = WA), reusing this contract end to end** — one Washington Geofabrik PBF preparation, WA SDA soil, per-tile DEM/PAD-US/MTBS, the same publisher path — and re-measure the release-size gate before building. The state-share gate and the derived tile list already generalize; no code change should be needed beyond the state code and bounds. Alternatively, if the announcement comes first, the measured metrics above are complete for it.

## Revision 7 — state PBF access canaries (2026-09-15)

Started from `192c160`. This section supersedes the revision-6 access-UNBUILT decisions below. Biology, species, coefficients and geography are frozen. Published canaries are existing `n39_w106` and `n40_w106` (Colorado), and `n44_w124` and `n43_w123` (Oregon); no new tile geography is authorized in this pass.

### Existing access contract audit

Read the legacy `ap/n38_w087.parquet` with DuckDB and audited the legacy builder, tile publisher, browser loading, map, Suggested Start and Huntability. All legacy tiles remain byte-for-byte untouched.

Legacy columns: `access_id VARCHAR`, `property_id VARCHAR`, `property_name VARCHAR`, `name VARCHAR`, `lat DOUBLE`, `lon DOUBLE`, `type VARCHAR`, `source VARCHAR`, `source_url VARCHAR`, `confidence VARCHAR`, `official BOOLEAN`, `operator VARCHAR`, `notes VARCHAR`, `verified_at DATE`. The old builder generated identity from property+coordinates+type, spatially coalesced nearby features, selected the smallest containing property, and otherwise chose a nearby property using distance to vertices. Legacy HIGH meant agency/name match, MEDIUM inside, LOW nearby; neither implied road connectivity. Legacy `official` and `verified_at` were inference/retrieval fields, not independent verification.

The browser already lazy-loaded `ap/` Parquet through `gisAssetBytes`, stored bytes in the existing IndexedDB cache, deduplicated by `access_id`, joined a single `property_id`, and chose Suggested Start by confidence then straight-line distance to a sampled habitat cell. It had no centroid fallback, but accepted LOW/gate rows. Huntability previously awarded 42 points for PUBLIC ownership and did not consume access points. Recommended score was biology × Huntability. Modern release access descriptors were UNBUILT; legacy populated assets are PARTIAL. The publisher already supports `access` and requires `access_id/property_id/lat/lon`; an empty dataset requires explicit VERIFIED_EMPTY, never a missing source.

### Source and tooling decisions

Use Geofabrik's public state extracts, verified at [Colorado](https://download.geofabrik.de/north-america/us/colorado.html), [Oregon](https://download.geofabrik.de/north-america/us/oregon.html), and the [US index](https://download.geofabrik.de/north-america/us.html). Public extracts omit contributor personal metadata. The canary retrieval requests dated `260913` extracts; exact replication timestamps come from each PBF header. Provider MD5 is checked, then SHA256, bytes, retrieval time, parser version, normalized-file checksums and extraction metrics are recorded. No raw PBF or state cache is committed.

Dependency: `osmium==4.3.1` (pyosmium/libosmium), distributed as a roughly 1.2 MiB wheel on this machine; no database server or custom PBF parser. `shapely` supplies geometry and STRtree, `pyproj` supplies tile-centered metric distances, DuckDB supplies local Parquet. The new tool has uv inline dependencies. The smaller dependency surface and streaming libosmium area assembly fit the existing factory better than a dataframe-centric extraction stack. [Pyosmium geometry documentation](https://docs.osmcode.org/pyosmium/latest/user_manual/03-Working-with-Geometries/).

`tools/fruiting_osm_access.py prepare --state CO|OR|NM` prepares one whole state, normalizes candidate and road tables once, and records `osm_access:STATE` in the existing `source-manifest.json`. Builds perform no network requests and reuse these tables. READY requires a validated PBF, useful roads/candidates, and checksums for every prepared file. Every reuse checks all bytes; refresh is explicit and builds a replacement separately, preserving an old valid generation on failure. Metadata updates use a file lock across state preparations. `--snapshot YYMMDD` selects a dated provider extract; `--pbf` accepts a local copy only when it matches that provider snapshot's checksum.

### Additive normalized schema and deterministic rules

The old 14 columns retain their names and types. New columns are declared in `fruiting_osm_access.COLUMNS`. `access_id = osm:node|way|relation:ID`, independent of property, feature name or tile. Source URLs reference that object. No contributor identifiers are retained. Additions include source object identity/version, retained access geometry, location derivation, all property IDs and association records as JSON, association method/distance, evidence grade/reason, `start_eligible`, selected approach-road identity/tags/distance/quality, restrictions and conditional tags. New `official=false` and `verified_at=NULL` deliberately avoid claiming field verification. Missing values remain NULL.

- Trailhead: explicit `highway=trailhead`. Parking: `amenity=parking`, including closed ways and multipolygon relations. `amenity=parking_entrance` is never parking. Gates/lift gates and relevant barriers are retained for caution, never made Suggested Start in v1. Road/track/path ways provide approach evidence but never generate points.
- A node keeps its coordinates. A real mapped parking/trailhead area keeps its geometry and uses an interior representative point computed **before tile clipping**. Linear features are display-only. No public-land centroid, road intersection, generated midpoint or inferred entrance becomes a start.
- Properties: inside geometry, or within 50 m with a local mapped road/path connection entering the polygon. Multiple matching properties remain explicitly ambiguous; no nearest-property or smallest-property winner. Adjacent published PAD-US polygons are merged per stable property ID for association, avoiding artificial tile-edge boundaries. Holes are respected.
- Connectivity: within 30 m of mapped road/path geometry, with another mapped way within 3 m of that way. This is a bounded isolation check, not routing, grade separation, route legality or guaranteed passenger-car suitability. The browser gets no road network.
- HIGH: explicit trailhead or parking with recreation/trail context and a plausible vehicle approach. MEDIUM: path approach, boundary association or property ambiguity. LOW/REVIEW: incomplete or unsuitable approach/context. RESTRICTED: explicit denial. REJECTED: garage/structured or obvious unrelated parking. Missing tags mean no restriction recorded, never verified public permission.
- `access=no/private/customers`, `foot=no`, applicable vehicle restrictions and locked gates are preserved. More specific grants do not erase explicit contradictory denials in this conservative pass. Conditional or informal starts are withheld. Untagged tracks, rough surfaces and conditional approach roads require review. Nearby restricted barriers on the selected approach withhold the start.
- Parking needs recreation naming/operator context or a connected mapped path/bridleway. A generic urban sidewalk alone is insufficient. Structured parking, building/covered parking and obviously commercial/residential lots are rejected before publication. Unassociated candidates remain in a local audit report, never sent to the browser.

Browser: new rows require explicit eligibility plus HIGH/MEDIUM trailhead/parking evidence. Legacy HIGH/MEDIUM mapped access remains readable with legacy labels; LOW and gates are not suggested. Tile duplicates merge property-ID sets and conservatively retain restrictions. Physical evidence and collecting-rule status are shown independently. Missing suitable evidence reads “Suggested start unavailable”; it does not mean inaccessible.

Huntability: collecting-rule evidence (42), provenance (16), physical access (24 HIGH/18 MEDIUM or legacy) normalized over available components; absent access is omitted and lowers confidence. Public ownership adds no positive points. Restricted-only evidence caps practical Huntability at 40; prohibited collecting remains capped at 8 and private ownership at 5. A good start alongside a restricted gate remains usable while the caution survives. Recommended score = biology × Huntability/100 × access confidence (HIGH 1, MEDIUM/legacy .9, no suitable start .75). Habitat already contributes to biology; it is not counted twice. Access cannot raise a recommendation above biology.

Attribution: © OpenStreetMap contributors, [ODbL 1.0](https://www.openstreetmap.org/copyright); shown in About/Data, source metadata and access-tile provenance. Published derived OSM access data is available under ODbL; property evidence remains independently sourced from PAD-US. OSM tag semantics: [trailheads](https://wiki.openstreetmap.org/wiki/Tag:highway%3Dtrailhead), [parking](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dparking), [access](https://wiki.openstreetmap.org/wiki/Key:access).

### Reproducible canary release

Prepare each state once (dated Geofabrik extracts may eventually expire; retain the validated local source cache for exact rebuilds):

```sh
uv run tools/fruiting_osm_access.py prepare --state CO --snapshot 260913 --cache /tmp/fruiting-forecast-gis-sources
uv run tools/fruiting_osm_access.py prepare --state OR --snapshot 260913 --cache /tmp/fruiting-forecast-gis-sources
uv run tools/fruiting_osm_access.py build --state CO --tile n39_w106 --cache /tmp/fruiting-forecast-gis-sources --out /tmp/fruiting-access-normalized
uv run tools/fruiting_osm_access.py build --state CO --tile n40_w106 --cache /tmp/fruiting-forecast-gis-sources --out /tmp/fruiting-access-normalized
uv run tools/fruiting_osm_access.py build --state OR --tile n44_w124 --cache /tmp/fruiting-forecast-gis-sources --out /tmp/fruiting-access-normalized
uv run tools/fruiting_osm_access.py build --state OR --tile n43_w123 --cache /tmp/fruiting-forecast-gis-sources --out /tmp/fruiting-access-normalized
# Repeat this existing publication entry point for each of the four tile IDs:
uv run --with duckdb --with requests tools/build-fruiting-gis.py build tile n39_w106 --layer access --source-dir /tmp/fruiting-access-normalized --resume
```

The bulk-adapter CLI also exposes `prepare access --state` and `build --layers access --access-states CO`. Direct use of the new script is simplest because its inline uv dependencies include pyosmium. Builds are restricted to the existing manifest release footprint. NM is a supported preparation scope but was not downloaded or published during this pass.

Both PBF headers report **2026-09-13T20:21:20Z**. Source provenance below and in each access descriptor records retrieval, size and checksums; prepared state files remain outside Git.

- **CO**: https://download.geofabrik.de/north-america/us/colorado-260913.osm.pbf; retrieved `2026-09-15T18:02:26Z`; **381,549,691 bytes**. SHA256 `3843275eda85fdd5d7059c44d71ab1255465421d74345d5c1c968fc9dd879184`; provider MD5 `c1ac0a933a957256e1136ff6f0ff012d`. Extraction **185.422 s**, preparation **187.708 s**. Counts: GATE 40,845, PARKING 46,969, ROAD 1,241,750, TRAILHEAD 550, invalid_geometry 1.
- **OR**: https://download.geofabrik.de/north-america/us/oregon-260913.osm.pbf; retrieved `2026-09-15T17:27:33Z`; **253,592,262 bytes**. SHA256 `5511e363f0cfdc41ac3d6a9b34668b6a34a2131ae88cc638c7f8d818190c6ddc`; provider MD5 `75c1ab90f3c9a5112dc21cc6325f8962`. Extraction **121.737 s**, preparation **123.35 s**. Counts: GATE 34,031, PARKING 25,582, ROAD 840,421, TRAILHEAD 502, invalid_geometry 2.

Preparation times above measure the successful extraction from already downloaded, checksum-matched local PBF copies, not network download speed. An early COPY-parameter bug interrupted the first extraction attempt; the downloaded PBFs were preserved and reused, then the corrected preparation completed. Road tables are approximately 164.6 MB (CO) and 139.2 MB (OR); candidate tables 9.09 MB and 5.53 MB. Full source reuse with network calls deliberately disabled passed: checksum validation took **0.403 s CO / 0.295 s OR**. A same-snapshot corrupt generation can be repaired by explicit refresh into a new generation; the old directory is retained until operator cleanup. Failed refresh preserves an older valid source.

| Tile | Candidates / local roads | Published rows | Eligible starts | Restricted rows | Build seconds | Access Parquet bytes |
|---|---:|---:|---:|---:|---:|---:|
| `n39_w106` | 15,418 / 239,615 | 2,122 | 887 | 172 | 40.669 | 285,465 |
| `n40_w106` | 8,274 / 155,835 | 1,756 | 519 | 119 | 22.136 | 212,122 |
| `n44_w124` | 11,592 / 114,425 | 1,216 | 132 | 96 | 16.167 | 99,158 |
| `n43_w123` | 603 / 17,405 | 205 | 86 | 12 | 4.738 | 34,238 |

Total new access payload is **630,983 bytes** across four tiles. The remaining 12 modern release tiles remain access UNBUILT; all legacy access files are unchanged. A separate cached `n43_w123` build took 5.987 s and produced byte-identical Parquet, SHA256 `0fbf632b7163609afe44c270d1c80779e0a73183ecbfe884df3001438872949e`.

DuckDB-Wasm read the modern Colorado/Oregon and legacy Indiana schemas together with `union_by_name=true`: 3,500 rows, 3,338 with modern evidence fields. Browser cold access transfers were exactly the tile asset sizes: 285,465 bytes CO, 99,158 OR, 11,501 legacy. Repeating each load produced **zero additional transfer bytes**, including duplicate tile descriptors. Real multi-tile searches processed 3,095 radius-filtered access features in CO and 1,292 in OR; access-stage timings were 163 ms / 72 ms in the first full suite. Whole habitat/property/access fetches took 5.46 s / 3.97 s in local Chrome with real Parquet and mocked basemap/weather endpoints. These are local canary measurements, not production latency guarantees. Browser receives only tile Parquet, never state PBF or road tables.

### Manual candidate and browser QA

Inspected actual extracted coordinates, OSM tags, approach roads, PAD-US association records and published rows, not only aggregate counts:

- **Colorado trailhead:** `osm:node:743479205`, Berthoud Pass, 39.7983903 / -105.7774111, inside Arapaho National Forest, HIGH. Butler Gulch (`osm:node:12061618522`) is MEDIUM through a boundary connection. Mount Blue Sky Summit Trailhead (`osm:node:8904558252`) retains multiple associated properties and MEDIUM evidence.
- **Colorado parking:** Argentine Pass Trailhead `osm:way:1084547985`, a real mapped parking area, preserves ambiguous property association; Beaver Ponds Picnic Area `osm:way:131601003` is inside Pike National Forest, HIGH. Coordinates derive from the mapped parking polygon, never the forest polygon.
- **Colorado restrictions:** Mountain Rose Ranch gate `osm:node:3397711107`, 39.7907647 / -105.5476389, inside Arapaho National Forest, `access=private`, RESTRICTED and never a start. James Peak gate `osm:node:11074481547` retains `locked=yes`, `motor_vehicle=private`, `foot=yes` conservatively; no start.
- **Oregon trailhead:** Drift Creek Falls Trail Trailhead `osm:node:6191266620`, 44.9355095 / -123.8556614, inside Siuslaw National Forest, HIGH. Brice Creek `osm:node:9598961183` independently exercises Umpqua National Forest in the southern canary.
- **Oregon parking:** Drift Creek Falls Trailhead `osm:way:357826096`, mapped parking area, 44.93551025 / -123.85565792880257, fee=yes, HIGH. Alpine Trailhead #1 `osm:way:591696370` exercises southern-canary area parking.
- **Oregon gates/restrictions:** 100 Gate `osm:node:36853800`, McDonald-Dunn forest, boundary connection and access=forestry, RESTRICTED. 600 Gate–Oak Creek Road `osm:node:36860317` has motor_vehicle=no and foot=yes: retained cautionary gate, never Suggested Start. Private gates `osm:node:10112784458` (Willamette River) and `osm:node:2934351426` (Willamette National Forest) remain restricted.
- **Rejected irrelevant parking:** Colorado Fraser's Crossing Founder's Point Parking Garage `osm:node:2277298344`, Hospital Parking East `osm:node:985988078`, and USPS employee parking `osm:way:107501806`; Oregon Walmart Parking Lot `osm:relation:11914167`. These were checked in local audit output and are not published as starts. The sparse southern Oregon tile had no structured-parking rejection to inspect; it is not fabricated for completeness.

False-positive fixes: recreation parking now requires recreation name/operator or mapped path/bridleway context; a generic sidewalk is insufficient. Word boundaries prevent “trail” matching “trailer.” This removed 925 irrelevant rows from the northern Oregon publication (214,856 → 99,158 bytes) without losing its 132 eligible starts. Nearby private driveways cannot be bypassed by selecting a farther public road. The publisher caught two Colorado trailheads (`osm:node:10158825963` Open Space connecting Trail and `osm:node:958573040` Gen06) whose selected vehicle approaches were private despite a nearby public path; normalization now marks them RESTRICTED and withholds the start. No publisher guard was weakened.

Browser QA renders real GIS with an explicitly synthetic biological score of 55 solely to inspect access UI; it does not constitute biological validation. Reviewed desktop and 390 px mobile screenshots generated by `tests/fruiting-forecast-osm-access.spec.js` at `/tmp/ff-access-{colorado,oregon}-{good,poor,restricted,mobile}.png`; JSON reports are `/tmp/ff-access-{colorado,oregon}-browser-qa.json`. Basemap tiles are mocked, while property polygons, access rows and coordinates are real. Good cases: Pike National Forest / Platte River Trailhead mapped parking (`osm:node:3255492791`) and Siuslaw National Forest / Pawn Trail Trailhead (`osm:node:13020145359`). Both retain UNKNOWN_VERIFY collecting rules despite HIGH physical evidence. No-feature cases: 63 Ranch State Wildlife Area (CO) and Bicycle Wayside (OR), both UNMAPPED with no Suggested Start. Dexter Lake's customer-restricted parking was inspected in the first run; the final restriction-focused screenshots show American Farmland Trust Unknown Easement (CO, RESTRICTED) and Fall Creek - Eugene (OR, RESTRICTED physical evidence), with private approach evidence and no Suggested Start. Exact selected properties are retained in the JSON reports.

QA exposed and fixed hidden western verification cards, an unrelated misleading default “Rule verified” date when no rule matched, mobile map-toolbar overflow, selected-start map framing, and approach-road restriction text that was retained in data but missing from a gate’s visible notes. Restrictions now appear explicitly in details/popups and contribute to physical-access caution even when the feature grade itself is LOW. The main list now presents properties to verify with independent collecting and access labels. Map rendering deduplicates stable IDs, limits to four features per property / 100 total, prioritizes the selected property and Suggested Start, and keeps the selected start in view. Details show up to ten evidence rows; the full evidence stays in the loaded record.

### Verification checkpoint

- Full browser suite: `npx playwright test tests/fruiting-forecast --reporter=line --workers=3` — **98 passed, 1 opt-in live test skipped** (final restriction-display rerun recorded before commit). One intermediate run had a 120-second app-initialization timeout in the legacy access test; the subsequent complete run passed without weakening assertions.
- Adapter suite: `uv run --with duckdb --with rasterio --with requests tests/test_fruiting_bulk_adapters.py` — **50 passed**.
- Publication suite: `uv run --with duckdb --with requests tests/test_fruiting_tile_publish.py` — **6 passed**.
- Access suite: `uv run tests/test_fruiting_osm_access.py` — **14 passed**, including an actual libosmium-generated synthetic PBF, nodes/ways/relations, road isolation/restrictions, ambiguous/hole-aware association, edge identity, same-snapshot corruption repair, failed refresh isolation, all four real canaries and mixed legacy schema.
- Modified Python tools compile. Junk Drawer page compliance audit initially reported **one pre-existing error** unrelated to this pass: `migration-watch.html` (unchanged since 2026.09.12.2) carried the `JUNKDRAWER_DEPLOY_FOOTER` comment but its `<footer class="site">` element lacked the required `data-junkdrawer-deploy-footer`/`data-deploy-version` attributes. Fixed by adding the attributes and bumping that page to **2026.09.15.1** (footer comment, footer element text, and `junk-drawer.json` in sync); its own 49-test Playwright suite passes. Final audit: **zero errors** / 13 pre-existing warnings. `git diff --check` passes. Page/footer/registry version **2026.09.15.3**.
- Takeover verification (2026-09-15, after the original implementer's runs): full browser suite re-run **98 passed / 1 opt-in live skipped** (1.1 m), adapter suite **50 passed**, publication suite **6 passed**, access suite **14 passed**, tools compile clean, compliance audit 0 errors, `git diff --check` clean. The four manual QA screenshots were re-inspected from the fresh run: Colorado good (Pike National Forest / Platte River Trailhead `osm:node:3255492791`, HIGH start, UNKNOWN_VERIFY collecting independent), Colorado poor (63 Ranch State Wildlife Area, UNMAPPED, "Suggested start unavailable", Huntability lowered by reduced confidence not penalty), Oregon good (Siuslaw National Forest / Pawn Trail Trailhead `osm:node:13020145359`), Oregon restricted (Fall Creek - Eugene, `access=private` gate displayed, no start, Huntability 24/100).
- Biology freeze: the entire 51,150-character original declaration/regional-model/geography block remains unchanged from `192c160`; species/habitat scoring and weather helper lines are unchanged. No habitat, PAD-US, MTBS or legacy access asset bytes changed. All three biological profiles remain **PROVISIONAL**.

### Remaining weaknesses and exact next task

Connectivity is a local geometric sanity check, not a routed path from a public highway. It cannot resolve grade separation, intermediate gates beyond the bounded check, seasonal closures or passenger-car road quality without tags. Restricted tags are deliberately conservative and can withhold valid foot-only alternatives. Area representative points are display/start references to mapped parking geometry, not surveyed parking entrances. OSM objects can independently duplicate a trailhead and its parking; identity dedupe removes repeated objects across tiles, not distinct co-located objects. OSM completeness varies; no feature means evidence unavailable, never inaccessible. PAD-US identity and browser first-piece geometry dedupe retain the pre-existing clipping limitations; preparation merges neighboring pieces for association. Local cache validation reads full PBF checksums on reuse; source preparation and memory usage should be measured again before scaling to much larger regions. Failed/corrupt source generations require operator cleanup after a successful replacement. Legacy LOW/gates remain readable but no longer qualify as Suggested Starts; HIGH/MEDIUM legacy starts carry a legacy mapping label without retroactive connectivity claims.

**Next recommended task: build the bounded Pacific Northwest regional release described in revision 6, reusing the prepared Oregon PBF and this access contract.** First select and explicitly authorize the bounded tile list; prepare any newly needed state sources once, publish every required GIS component and access with truthful per-layer statuses, then run the same biological/access/edge/cache QA. Keep all biological profiles PROVISIONAL. Do not generate CONUS or expand the species roster as part of that release. This pass itself adds no geography.

---

Work in progress, 2026-09-15. Existing implementation notes describe the legacy app; this document records the expansion and supersedes conflicting coverage/offline claims. Revision 2 recorded the Southern Rockies / Colorado milestone: four regional targets, the first real western bulk GIS publication, MTBS burn evidence, per-sector ecological arbitration and state-scoped collecting rules. Revision 3 completed the core habitat stack for Colorado: pinned Annual NLCD land cover and NLCD tree canopy adapters, a second independently built Colorado tile, explicit habitat component completeness, a robust national-source cache, and a tested gSSURGO adapter path. Revision 4 resolved real authoritative NRCS soil (SSURGO via Soil Data Access), unified the soil source contract, resolved per-tile 3DEP DEM releases, and executed a bounded 11-tile Colorado release. Revision 5 proved the pipeline in a second state (northern New Mexico) with independent state soil caches, point-level cross-state soil, conservative near-boundary jurisdiction, stable public-land and MTBS identity, and derived coverage metadata. **Revision 6 implements Pacific Northwest Maritime as a third genuinely modeled region: five sourced PROVISIONAL targets (Pacific golden chanterelle, white chanterelle, western matsutake under the modern name Tricholoma murrillianum, PNW winter craterelle and PNW burn morels), a maritime autumn wet-up transition metric with a general declared-evidence-gap mechanism, a new hemlock/Sitka-spruce host signal, and two real Oregon canary tiles published through the proven factory with deterministic biological and cross-region tests.**

## Decisions

- Preserve deterministic Indiana scoring. Split stable taxon identity from regional parameters, with explicit applicability and maturity. No universal Midwest fallback.
- EPA Level III polygon geography, simplified offline, supplies coordinate lookup. Profile mapping is data, not rectangular climate zones.
- Every sector uses the biological profile of its own location. A search radius may cross an ecoregion boundary, so the search center never imposes its targets on other sectors. This is state-independent: the New Mexico extension is scored by EPA ecology, not by state, and neighboring EPA regions remain unsupported.
- Southern Rockies now has four provisional targets: Rocky Mountain king bolete (`Boletus rubriceps`), rainbow chanterelle (`Cantharellus roseocanus`), natural (non-burn) morels and burn morels. All four are PROVISIONAL, none VALIDATED.
- Western host evidence comes from mapped USDA FS FIA forest-type-group classes (spruce/fir, fir/spruce/mountain hemlock, lodgepole, ponderosa, Douglas-fir, aspen/birch). Eastern classes are unchanged and are never overloaded with western meaning; New Mexico additionally maps pinyon-juniper and western-oak classes without inventing signals or model weights for them.
- Missing physiology stays missing. Western targets carry no thermal or soil-moisture response because the reviewed sources do not support one; the declared weight is retained so missing evidence lowers confidence instead of being renormalised away.
- Qualitative precipitation is permitted but must be labelled: western targets use a declared engineering band (14-day accumulation, wet-day count, rain recency) with provenance stating it is not a measured threshold.
- Burn evidence comes from real MTBS burned-area boundaries published per tile. MTBS publishes no per-perimeter severity class, so severity is NULL and applies no penalty. Absence of a perimeter is never a negative biological signal; a disturbance-dependent target declares `requiresDisturbance` and an explicit `evidenceGapCap` so it cannot rank highly without fire evidence. A perimeter crossing a tile or state boundary keeps its stable `perimeter_id` and the browser deduplicates the biological event.
- Collecting rules are state-scoped. Rules declare `jurisdiction`, and a rule applies only when the property's jurisdiction is known and matches. Unknown jurisdiction keeps UNKNOWN_VERIFY. PAD-US `ST_Name` is unusable for jurisdiction (it reads "Not Applicable" for federal units), so jurisdiction is assigned by point-in-polygon against US Census state boundaries. A point inside the 0.02-degree simplification band of a state boundary is published as `jurisdiction_confidence = ambiguous-near-boundary` with no state, so geometry remains visible but no state-scoped rule can leak; properties outside every state are kept as `unresolved` for the same reason.
- Public-land identity is `sha1(property_name|manager|source_category|source_designation|state_code)`. PAD-US publishes no usable stable unit id (BndryID and ST_Name both read "Not Applicable"), so name alone must never merge two properties. One unit clipped into two same-state tiles keeps one identity and is deduplicated by the browser; the same name in two states is two legitimate jurisdiction-scoped records.
- Raw bulk adapters live in `tools/fruiting_bulk_adapters.py`: pinned source products are prepared once into a cache and sampled, queried or clipped locally, never re-downloaded per tile. Preparation scope is explicit: `prepare national` for national products, `prepare state` for soil, `prepare tile` for the per-tile 3DEP DEM.
- **Soil has one normalized contract regardless of upstream packaging**: `mukey -> {drainage_class, awc_25_cm, awc_50_cm, flood_frequency, hydrologic_group, slope_deg}`. The default 2026 source is the authoritative NRCS Soil Data Access (SSURGO) tabular service: one query per state for the mapunit attribute table and one batched point-to-MUKEY query per tile. A gSSURGO or gNATSGO state package is a drop-in alternate through the same contract. STATSGO2 gap filling is deliberately not applied, so coarse state-level data is never presented as survey-grade soil.
- **State soil caches are independent and restart-safe.** `ssurgo_sda:CO` and `ssurgo_sda:NM` are separate entries with their own normalized Parquet, query fingerprint, row count, survey vintages and MUKEY range; an unchanged ready state is reused without re-querying, a failed refresh of one state cannot invalidate another, and a tile build that crosses a line auto-includes a neighbouring prepared state only when that state's table actually contains one of the tile's resolved mukeys (an exact membership check, because MUKEY numeric ranges overlap).
- **3DEP DEM releases are resolved per tile** from the public TNM bucket listing; a single pinned national release date does not exist for every tile. A cached tile keeps the release it was fetched with, and the release is recorded in provenance. Mixed releases across the release are explicit, not silently normalized.
- Canopy is a separate signal from mapped forest type. `canopy` is NLCD Tree Canopy Cover stored as a 0..1 fraction; it can support "forest structure exists" but never substitutes for a spruce-specific mapped host class in the porcini/chanterelle models.
- Land cover is Annual NLCD, sampled at the 0.05-degree cell center. `forest`, `deciduous`, `open_land` reuse the legacy NLCD class mapping so eastern semantics are unchanged; `evergreen`, `mixed_forest` and `wetland` are additive western-era columns. Legacy tiles lack these fields and read them as NULL.
- Habitat completeness is explicit. `habitat.components` declares forestType/elevation/landCover/canopy/soil as AVAILABLE or UNBUILT; `habitat.status` is AVAILABLE only when every required component is present, and soil additionally reports AVAILABLE when real soil evidence was composed. A Parquet file existing is never completeness.
- The source cache is manifest-backed with version, bytes, SHA256 and a READY marker written only after download + validation. A corrupted or partial download is FAILED and is never treated as ready; large downloads resume from a `.part` file when the server supports ranges.
- Existing IndexedDB `FruitingForecastDB/cache` stores static tile bytes. Harden this path instead of adding another database. OPFS metadata alone must never skip registering actual Parquet bytes.
- Publication requires explicit per-layer status. A missing normalized source is UNBUILT, never verified empty.
- Collecting-rule and geometry loading stay independent.
- Coverage metadata keeps three dimensions separate: `publishedTiles` (every tile with a populated layer, including legacy), `coverageTiles` (release tiles whose habitat declares all components AVAILABLE), and `states` / `ecologicalProfiles` derived from pinned boundary bounding boxes. Administrative, ecological and layer availability are never conflated.
- The bounded release is 14 one-degree tiles in two states, not CONUS. Access points remain UNBUILT and the manifest and UI say so rather than inventing pins.
- **Pacific Northwest Maritime is a real modeled profile, not a recolored Southern Rockies model.** Five targets are implemented with per-assertion provenance: Pacific golden chanterelle (`Cantharellus formosus`), white chanterelle (`Cantharellus subalbidus`), western matsutake (`Tricholoma murrillianum`), Pacific Northwest winter craterelle (`Craterellus sp. 'neotubaeformis'`) and Pacific Northwest burn morels. All are PROVISIONAL; no Southern Rockies coefficient, calendar or host weight was transferred.
- **Western matsutake uses the resolved modern taxonomy.** Trudell et al. 2017 (Mycologia 109) separates `Tricholoma murrillianum` (western USA/Canada) from `T. magnivelare` (eastern USA/Canada) and `T. mesoamericanum` (Mexico). Older Pacific Northwest literature using `T. magnivelare` is a source synonym in part; the implementation cites the modern western name and the synonym history.
- **The two chanterelles stay separate targets because the published ecology differs in season and stand association**, while their host weights are deliberately identical because the reviewed evidence does not justify different ones. White chanterelle declares a 10-weight evidence gap for the published mature-to-old-forest association instead of inventing a stand-age coefficient.
- **Maritime moisture is a transition, not a copied monsoon band.** A deterministic `recharge14` metric compares the last 14 days of rain with the preceding two-week rate, and PNW targets can weight a discrete `transition` component ("Autumn moisture transition") alongside the 14-day band, wet-day count and rain recency. All bands are declared engineering approximations of the summer-dry to autumn-wet pattern; none is a measured threshold.
- **Published drivers the GIS stack cannot represent are declared, not neutral.** A target can declare `declaredGaps` with a weight and a label; the weight is added to the confidence denominator and the label appears in the missing-evidence list and the user-facing reason. The PNW winter craterelle declares 20 weight for coarse woody debris volume, decay class and stand age (Trappe 2004 found CWD was the substratum for 88 percent of sporocarps), and matsutake declares 10 weight for stand age, understory and substrate mineralogy. Generic canopy is never substituted for them.
- **The FIA hemlock/Sitka-spruce class (300) is exposed as an additive host signal.** It is distinct from Douglas-fir (200) and from fir/spruce/mountain hemlock (260); the browser reads it only where a tile carries it, and tiles published before revision 6 read it as NULL. Class 240 western white pine has no signal column and is not fabricated.
- **Fire is scored only where sourced.** Burn morels keep the existing prior-year fire response; chanterelles, matsutake and craterelle carry no disturbance weight at all. Absence of an MTBS perimeter remains non-evidence.
- The bounded release is 16 one-degree tiles in three states (11 Colorado, 3 New Mexico, 2 Oregon canaries), not CONUS. Access points remain UNBUILT and the manifest and UI say so rather than inventing pins.

## Baseline

`npx playwright test tests/fruiting-forecast.spec.js --reporter=line --workers=2`: 7 passed (8.3 s), before changes.
Previous checkpoint (`68cc609`): 82 browser tests passed, 1 opted-out live test skipped; 45 Python adapter tests and 5 publication tests passed.

## Completed in this pass (revision 6 — Pacific Northwest Maritime biology and canaries)

1. **Taxonomy resolved before implementation.** Western matsutake is `Tricholoma murrillianum` (Trudell et al. 2017; GBIF 5241743, iNaturalist 521711); `T. magnivelare` is retained only as the eastern species and as a source synonym. `Cantharellus formosus` (iNaturalist 120443) and `C. subalbidus` (54132) are the two chanterelles; the PNW winter craterelle uses the iNaturalist provisional taxon 1677906 (`Craterellus sp. neotubaeformis`, 88 observations) because no validly published PNW name exists and aggregating European `C. tubaeformis` records would combine biologically different taxa.
2. **Five sourced PROVISIONAL targets implemented** in `BIO_PROFILES.pnw`, each with months, shoulder, hosts, habitat model, moisture bands, weights, provenance, declaration of missing evidence and source URLs: Pacific golden chanterelle (September-November core, July-August shoulder, hemlock/Douglas-fir/spruce, midsummer-to-late-fall source statement), white chanterelle (August-October core, late-summer-to-early-fall, mature-to-old-forest evidence gap), western matsutake (September-November, Douglas-fir/hemlock weighted highest with lodgepole, true-fir proxy and ponderosa, 1,000-4,000 ft from the source 300-1,200 m, 50-66 F soil-temperature analogy explicitly labelled provisional), PNW winter craterelle (November-March core with the published November-May window, heavy hemlock weight, 20-weight CWD/stand-age evidence gap, elevation deliberately unscored because Trappe 2004 tested and rejected it), and PNW burn morels (May-June engineering calendar, prior-year fire response, evidence-gap cap).
3. **A general declared-evidence-gap mechanism.** `declaredGaps` weights lower confidence coverage and surface their labels in the missing-evidence list; the score explanation states that the weight exists for published drivers that cannot currently be obtained. This is data-driven and available to any future target.
4. **Maritime wet-up transition.** `normalizeWeather` now publishes `recharge14` (last-14-day rain minus the preceding two-week rate); targets can weight a discrete `transition` component, which appears in the evidence panel as "Autumn moisture transition". Deterministic lifecycle tests prove wet-up, dry-summer and winter behavior, and the component is absent for targets that do not declare it.
5. **New PNW host signal.** The adapter exposes FIA class 300 as `hemlock_sitka_spruce_signal` additively. The mixed-schema browser test loads the new PNW tile first beside an earlier western tile and a legacy eastern tile with `union_by_name=true`, proving the schema evolution keeps every generation readable.
6. **Two real Oregon canaries published.** `n44_w124` (100% PNW: 54% Coast Range + 45% Willamette Valley) and `n43_w123` (100% PNW: 96% Cascades) built through the same prepare/build/publish path with Oregon soil, all five habitat components AVAILABLE, public land and fire AVAILABLE and access UNBUILT. Soil coverage is 391/400 and 222/400 respectively, the second reflecting genuine missing drainage classes in the Oregon source rather than a pipeline failure.
7. **Research recorded for candidates that are not yet forecastable.** biology-research.json now carries 30 sources and 16 candidates. Lobster mushroom is RESEARCH_ONLY because host Russulaceae distribution is unrepresentable; hedgehogs await a resolved regional species concept; Sparassis awaits a substrate dataset; PNW king boletes await a reconciled species concept; black trumpets remain separate from the implemented winter craterelle.
8. **Coverage metadata updated.** `summary.coverageTiles` is 16 tiles; `summary.ecologicalProfiles` shows pnw 2 and southernRockies 14; `summary.states` includes OR 2; the manifest `biology` block lists the PNW profile and its five targets, and `habitatSchema` documents the new additive host signal.
9. **Tests.** 50 adapter tests (up from 45), 5 publication tests, and 92 browser tests (up from 82, 1 opt-in skipped) including the new 10-test PNW spec: taxonomy/target resolution, golden-chanterelle wet-up/habitat/season ordering, independent white-chanterelle calendar, matsutake host/season/temperature/elevation/missing-evidence ordering, craterelle hemlock ordering and winter window, cross-region suppression for interior Oregon/California/plains, PNW/interior per-sector arbitration, canary artifact digests, real Oregon soil provenance, DuckDB schema-evolution reads, and a real PNW search ranking PNW targets with no Colorado leakage.

## In progress

Nothing is committed mid-refactor. Revision 6 is complete and verified. Access remains UNBUILT by decision; no CONUS generation has begun.

## Remaining / next task

The biological abstraction now carries three profiles with genuinely different ecologies (eastern hardwood, Southern Rockies summer monsoon, Pacific Northwest maritime autumn/winter) and the data factory is proven in three states. Two tracks remain before national generation: the OSM regional-PBF access layer, and a bounded PNW regional GIS release (the biology is proven but only two canary tiles are published). National GIS bulk generation, historical occurrence aggregation and a snowmelt dataset remain unimplemented.

## Progress checkpoint — previous revision (checkpoint `68cc609`)

Kept for continuity; superseded by "Completed in this pass" above where they differ.

Revision 5 completion summary (commit `68cc609`):

- Selected the New Mexico canary from EPA geometry (`n36_w107` 86% Southern Rockies, plus `n36_w106` and `n35_w106`) and prepared New Mexico soil through the same normalized SDA contract with independent, restart-reusable state caches.
- Resolved cross-state soil point by point with an exact MUKEY membership check, enforced the documented 0.02-degree state-boundary jurisdiction tolerance with an explicit confidence marker, and replaced name-only public-land identity with a state-aware composite.
- Published the bounded two-state release (14 tiles, all five habitat components AVAILABLE, access UNBUILT) with derived coverage dimensions (`publishedTiles`, `coverageTiles`, `states`, `ecologicalProfiles`).
- 45 adapter tests, 5 publication tests, 82 browser tests.

## Progress checkpoint — previous revision (checkpoint `271806c`)

Kept for continuity; superseded by "Completed in this pass" above where they differ.

Revision 4 completion summary (commits `7c1020e`, `271806c`):

- Resolved authoritative NRCS soil through Soil Data Access: one state mapunit/attribute query plus one batched point-to-MUKEY query per tile; gSSURGO/gNATSGO packages (FileGDB, GeoPackage/SQLite, CSV) normalize to the same contract.
- Resolved 3DEP DEM releases per tile from the TNM bucket listing and built the bounded 11-tile Colorado release with five-component habitat, public land and fire; access explicitly UNBUILT.
- Manifest gained derived component coverage and the real `ssurgo_sda` descriptor; 33 adapter tests, 2 publication tests, 79 browser tests.

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

- fruiting-forecast.html: FF-1.7.0; base taxon / regional-profile composition, EPA lookup, per-sector biology arbitration, applicability suppression, western host/elevation/precipitation/disturbance components, canopy + land-cover habitat evidence, evidence-gap rule, state-scoped collecting rules with conservative near-boundary jurisdiction, maritime autumn wet-up transition component, declared evidence gaps, regional model evidence panel, habitat component completeness in About/diagnostics, safe IndexedDB byte cache, explicit coverage, independent rule errors. Mixed-schema tile reads use `union_by_name=true`; legacy eastern tiles and new western tiles load together. A property published as `ambiguous-near-boundary` or `unresolved` resolves to UNKNOWN_VERIFY without a Census fallback, so no state-scoped rule can leak across a simplified state line.
- data/fruiting-forecast/ecoregions.json and generated ecoregions.js: identical EPA data (only JS loaded in browser for file preview); JSON is build/interchange artifact.
- data/fruiting-forecast/states.json and generated states.js: US Census cartographic state boundaries (1:20,000,000, 2023), simplified to 0.02° (118 KB). Used **only** for collecting-rule jurisdiction. The 0.02-degree tolerance is now enforced in the adapter, not just documented: a property point within the band is published with `jurisdiction_confidence = ambiguous-near-boundary` and no state, and the browser honours that marker instead of falling back to the same simplified lookup.
- tools/build-fruiting-ecoregions.py: EPA Level III geography builder.
- tools/build-fruiting-states.py: US Census state geography builder (`window.FF_STATES`).
- tools/fruiting_bulk_adapters.py: raw bulk adapters. Pinned sources (forest type groups, Annual NLCD land cover, NLCD tree canopy, per-tile 3DEP, MTBS, PAD-US, Census states, and soil via NRCS Soil Data Access or a gSSURGO/gNATSGO state package); `prepare national|state|tile` prepares once into a manifest-backed cache, `build` composes a tile into publisher inputs. Soil uses one normalized contract keyed by MUKEY, state caches are independent and restart-reusable, and a tile auto-includes a neighbouring prepared state only on an exact mukey-membership match. Property identity and conservative jurisdiction live here. The forest-type-group legend is the authoritative product metadata legend; class 0 means "no forest type group mapped", never missing.
- data/fruiting-forecast/biology-research.json: 30 sources, 16 candidates, 5 pnw and 4 southernRockies entries marked `implemented: true`. Revision 6 added the PNW-GTR-576, PNW-GTR-412, Trudell 2017, Trappe 2004 and iNaturalist-taxa sources plus four implemented PNW candidates and explicit promotion criteria for the research-only ones. Every entry carries `supports` / `doesNotSupport` / `missing`. Revision 4 added the `ssurgoSda` source entry: soil is published as environmental evidence but no Southern Rockies model weights it, because the reviewed sources do not support a calibrated soil-moisture response.
- data/fruiting-forecast/manifest.json: schema 4 with publisher-recomputed `summary.layers` (populated / verifiedEmpty / unbuilt / failed, `available`, per-component coverage for habitat, consistent with tileCount), `summary.publishedTiles` (every tile with a populated layer), `summary.coverageTiles` (release tiles whose habitat declares every component AVAILABLE, derived rather than hand-maintained), `summary.states` and `summary.ecologicalProfiles` (pinned-boundary intersections, explicitly separate dimensions), retained human-readable coverage fields, `habitatSchema` and `publicLandSchema` descriptions (soil units, missing semantics, identity composite, jurisdiction confidence), and the biology descriptor.
- tools/build-fruiting-gis.py: legacy sampler plus `build` (publisher) and `bulk` (adapters) dispatch.
- tools/fruiting_tile_publish.py: network-free publication boundary. Four layers (habitat, public-land, access, fire), per-layer source sidecars, schema/count checks, checksums, content-addressed assets, atomic manifest replacement after each layer, incremental merge, lock, and completeness-aware summary maintenance. Revision 8 exposed the loop as an importable `publish_tiles()` (CLI unchanged).
- tools/fruiting_pnw_release.py: derived bounded-release tool (revision 8, state-parameterized in revision 9). `plan --state OR|WA` reproduces the tile selection from the pinned EPA Level III + Census states geometry in equal-area EPSG:5070 (core ≥ 50% PNW share, halo 25–50% four-connected, state share ≥ 25%) from a state-derived candidate window and estimates size from real published measurements; `run --state OR|WA [--access-states OR,WA]` orchestrates prepare → Phase A (habitat/public-land/fire, skipping tiles already published complete) → Phase B (access composed from exactly the prepared states whose geometry reaches each tile) with a per-state JSON journal, deterministic order, resume, and per-tile failure isolation. No rectangle, no hand-maintained tile list, no Washington-specific rule.
- tests/fruiting-forecast-pnw.spec.js: 10 deterministic Pacific Northwest tests: target/taxonomy resolution, golden-chanterelle wet-up, habitat and season ordering, white-chanterelle independent calendar, matsutake host/season/temperature/elevation/missing-evidence ordering, craterelle hemlock ordering and winter window, cross-region suppression, PNW/interior per-sector arbitration, canary artifact digests with Oregon soil provenance, DuckDB schema evolution with the new hemlock signal, and a real PNW search.
- tests/fruiting-forecast-conus.spec.js: 29 deterministic tests: Colorado species cases, fire-evidence cases, geographic suppression, jurisdiction scoping, per-sector boundary arbitration, the bounded two-state 14-tile release declaration with digest checks, a real DuckDB-Wasm load of western tiles plus a legacy eastern tile (including soil differentiation and real cross-tile public-land/MTBS identity reads), deterministic cross-tile dedupe fixtures, a real interstate search with per-sector ecology and jurisdiction isolation, canopy/land-cover scoring behavior, and habitat completeness semantics.
- tests/test_fruiting_bulk_adapters.py: 53 deterministic tests (coverage through the revision-12 California canaries) for adapter contracts, the cache manifest/checksum/corruption path, the Soil Data Access and package soil paths (normalized contract, batched point join, ambiguity, explicit failure/empty, gSSURGO/FileGDB and gNATSGO/GeoPackage packaging equivalence), DEM release resolution, habitat composition with optional sources absent, state-scoped SDA preparation with independent caches/restart reuse and a failing refresh that cannot invalidate another state, exact cross-state mukey inclusion, failure/retry of a batched point query, property identity, legacy-tile backward compatibility, and the committed two-state release (component/layer completeness, real SSURGO values with explicit gaps, conservative jurisdiction, cross-tile MTBS identity, release-scope manifest assertions, PNW release component/layer completeness with the explicit ocean VERIFIED_EMPTY, Oregon soil provenance, the hemlock signal, the three-state coverage dimensions, the EPA-derived PNW release equality with per-tile roles/shares, and regional cross-tile access identity).
- tests/test_fruiting_pnw_release.py: 10 deterministic release-tool tests (selection algorithm on synthetic shares, determinism, real-selection == published release, plan measurement basis, honest missing-cache state, journal resume digests).
- tests/test_fruiting_tile_publish.py: 5 publication tests (incremental integrity/empty/failure, completeness components, coverage dimensions, profile-roster drift guard against the browser mapping, and coverage refresh on publication).
- junk-drawer.json and footer: 2026.09.16.5 (revision 14 modeled Great Plains — riparian M. americana + open-habitat C. gigantea — and fixed the code-60 crosswalk defect, completing CONUS biology at 13 profiles/0 UNSUPPORTED; scoring model version is FF-1.7.0 and the biology contract version is 2026.09.15.1).

## Rebuild commands

From repository root. Preparation Python only; no browser/server dependency:

    curl -L --fail -o /tmp/us_eco_l3.zip https://dmap-prod-oms-edc.s3.us-east-1.amazonaws.com/ORD/Ecoregions/us/us_eco_l3.zip
    uv run --with pyshp --with shapely --with pyproj tools/build-fruiting-ecoregions.py /tmp/us_eco_l3.zip
    curl -L --fail -o /tmp/cb_2023_us_state_20m.zip https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_20m.zip
    uv run --with pyshp --with shapely --with pyproj tools/build-fruiting-states.py /tmp/cb_2023_us_state_20m.zip

Prepare the national products once, then the state soil attribute table once, then the per-tile DEMs, then compose and publish each tile. A prepared source is never re-downloaded per tile, and a DEM release is resolved per tile from the TNM bucket listing:

    uv run --with rasterio --with duckdb --with requests --with shapely --with pyshp tools/build-fruiting-gis.py bulk prepare national --sources forest-type,land-cover,canopy,states --cache /tmp/ffsrc
    uv run --with rasterio --with duckdb --with requests --with shapely --with pyshp tools/build-fruiting-gis.py bulk prepare state --state CO --cache /tmp/ffsrc
    uv run --with rasterio --with duckdb --with requests --with shapely --with pyshp tools/build-fruiting-gis.py bulk prepare state --state NM --cache /tmp/ffsrc
    uv run --with rasterio --with duckdb --with requests --with shapely --with pyshp tools/build-fruiting-gis.py bulk prepare state --state OR --cache /tmp/ffsrc
    for t in n37_w106 n37_w107 n37_w108 n38_w106 n38_w107 n38_w108 n39_w106 n39_w107 n39_w108 n40_w106 n40_w107 n36_w107 n36_w106 n35_w106 n44_w124 n43_w123; do
      uv run --with rasterio --with duckdb --with requests --with shapely --with pyshp tools/build-fruiting-gis.py bulk prepare tile --tile "$t" --cache /tmp/ffsrc
      uv run --with rasterio --with duckdb --with requests --with shapely --with pyshp tools/build-fruiting-gis.py bulk build --tile "$t" --soil-states CO,NM --cache /tmp/ffsrc --out /tmp/ff-norm --layers habitat,public-land,fire
      uv run --with duckdb tools/build-fruiting-gis.py build tile "$t" --source-dir /tmp/ff-norm --resume
    done

The bounded Oregon PNW release (revision 8) uses the derived batch orchestrator instead of the per-tile loop; it reuses the same source-cache conventions, validates the prepared OSM access source, and publishes through the same boundary:

    uv run --with duckdb --with rasterio --with requests --with shapely --with pyproj --with pyshp --with osmium==4.3.1 \
      tools/fruiting_pnw_release.py plan --state OR --source-cache /tmp/ffsrc --access-cache /tmp/fruiting-forecast-gis-sources
    uv run --with duckdb --with rasterio --with requests --with shapely --with pyproj --with pyshp --with osmium==4.3.1 \
      tools/fruiting_pnw_release.py run --state OR|WA --source-cache /tmp/ffsrc --access-cache /tmp/fruiting-forecast-gis-sources \
      --access-states OR,WA --out /tmp/ff-pnw-norm [--resume] [--only n44_w123]
The OSM PBF itself is prepared once per state (`tools/fruiting_osm_access.py prepare --state WA --snapshot latest|--snapshot YYMMDD`); a FAILED entry never blocks an explicit re-run, and a dated snapshot that the provider has expired is never presented as the current one — the entry records whichever extract was actually used.

`plan` is network-free (selection from pinned repository geometry + real published measurements); `run` prepares missing sources once, builds Phase A (habitat/public-land/fire) then Phase B (access) per tile in deterministic order, and journals restartable progress. The access PBF itself is prepared separately, once per state: `uv run tools/fruiting_osm_access.py prepare --state OR --snapshot 260913 --cache /tmp/fruiting-forecast-gis-sources`.

Listing every prepared soil state is safe for every tile: a state that does not own any of the tile's mukeys is skipped, and a prepared neighbouring state is included automatically when it does (exact membership, not a range guess). A gSSURGO/gNATSGO state package can replace the SDA attribute table: `bulk prepare state --state CO --source gssurgo --archive /path/gSSURGO_CO.zip` (the same normalized contract is used by `build --soil-states CO`).

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
| Pacific Northwest Maritime | Five targets (`chanterelleFormosus`, `chanterelleSubalbidus`, `matsutakeMurrillianum`, `craterelleNeotubaeformis`, `morelBurn`); PROVISIONAL maritime-autumn host/season/moisture screening with a wet-up transition metric, the hemlock/Sitka-spruce signal and MTBS fire for burn morels only |
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

### Pacific Northwest Maritime model assertions and limits

All five PNW targets are PROVISIONAL. The models were built from the sources below, not by copying Southern Rockies parameters. Host classes were verified against the authoritative FIA forest-type-group legend: 300 hemlock/Sitka spruce (new additive signal), 200 Douglas-fir, 280 lodgepole pine, 260 fir/spruce/mountain hemlock used as the silver/noble/grand fir proxy, 220 ponderosa pine. Class 240 western white pine has no signal column and is not fabricated.

**Taxonomy decisions recorded before implementation.** Western matsutake is `Tricholoma murrillianum` (Trudell, Xu, Saar & Justo 2017, Mycologia 109, DOI 10.1080/00275514.2017.1326780: `T. magnivelare` eastern USA/Canada, `T. murrillianum` western USA/Canada, `T. mesoamericanum` Mexico); older PNW literature using `T. magnivelare` is a source synonym in part. Pacific golden chanterelle is `Cantharellus formosus` (PNW-GTR-576; European `C. cibarius` is a different species). White chanterelle is `C. subalbidus` (PNW-GTR-576). The PNW winter craterelle uses iNaturalist provisional taxon 1677906 (`Craterellus sp. 'neotubaeformis'`) because PNW-GTR-576's provisional name is not validly published and Trappe 2004 found western, eastern and European populations genetically distinct; aggregating `C. tubaeformis` records would combine different taxa.

**Pacific golden chanterelle.** [PNW-GTR-576](https://doi.org/10.2737/pnw-gtr-576) documents C. formosus as the common golden chanterelle of the PNW, collected under hemlock, Douglas-fir and spruce, fruiting "from midsummer through late fall in young to old forests", with the commercial season in autumn; rain during primordia formation is cited for continued growth. The September-November core / July-August shoulder calendar, the 14-day maritime rain band, wet-day count, recency window and wet-up transition are engineering bands from those qualitative statements. Temperature, stand age, understory and soil properties are unscored.

**White chanterelle.** PNW-GTR-576 documents an apparently Douglas-fir/hemlock-associated species fruiting late summer to early fall in mature to old forests. The August-October core is an engineering calendar; the published mature-to-old-forest association is declared as a 10-weight evidence gap because stand age is not available. Host weights are the same as the golden chanterelle because the reviewed evidence does not justify different ones; the targets differ by season and recorded stand association.

**Western matsutake.** [PNW-GTR-412](https://doi.org/10.2737/pnw-gtr-412) reports the American matsutake most often in mixed conifer stands containing Douglas-fir and western hemlock in central Washington and Oregon, fruiting more abundantly in mixed Douglas-fir/hemlock than in other forest types, with other associates including Pacific silver fir, noble fir, grand fir, lodgepole pine, western white pine and ponderosa pine; PNW fruiting at 300-1,200 m; a late-August-to-mid-November harvest progressing north to south, high to low and inland to coastal; and well to moderately well drained sandy/loamy soils on glacial till or tephra. The report also cites Japanese shiro work: primordia initiate below 19 C and fruiting ceases below 10 C. The 1,000-4,000 ft elevation band is read from the source; the 50-66 F soil-temperature band is an explicitly provisional analogy from the Japanese species, labelled in provenance. Drainage and AWC are displayed but not scored because no source ties a numeric response to them; stand age, understory, CWD and mineralogy are a declared 10-weight evidence gap.

**PNW winter craterelle.** [Trappe 2004](https://doi.org/10.1080/15572536.2005.11832949) found occurrence in northwestern Oregon highly correlated with western hemlock (mycorrhizal association confirmed), rare in stands without a hemlock component, and that well-decayed coarse woody debris was the substratum for 88 percent of sporocarps while stand age and CWD volume were significantly related to occurrence and slope, elevation and aspect were not. PNW-GTR-576 gives the November-to-May fruiting window. The model weights class 300 heavily, uses a broad winter precipitation band, deliberately does not score elevation, and declares a 20-weight evidence gap for CWD volume/decay class and stand age; the user-facing reason states that these published drivers are unavailable in the GIS stack rather than substituting generic canopy.

**PNW burn morels.** Reuses the existing sourced prior-year fire response from the Southern Rockies target with a May-June engineering calendar and spring moisture band; PNW-GTR-710 covers western North American fire-associated morels. No PNW-specific published phenology or severity response was located, so transferability is an inference. This is the only PNW target that scores fire evidence.

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

Ingested for tile `n40_w106`: 11 real perimeters (1988–2012 in the current clip), including the Fourmile Canyon, High Park, Picnic Rock and Overland fires. Ingested for tile `n39_w106`: 15 real perimeters in the Summit/Eagle/White River country. The revision-4 release added perimeters for nine more Colorado tiles, and revision 5 adds the three New Mexico tiles (`n36_w107` 35, `n36_w106` 34, `n35_w106` 23). Two perimeters cross the Colorado–New Mexico line and are deduplicated by stable id. Revision 6 adds the Oregon canaries (`n44_w124` 2 perimeters, `n43_w123` 56). No national burn tiles are published yet.

## Source datasets / versions

- EPA: current official [Level III download page](https://www.epa.gov/eco-research/level-iii-and-iv-ecoregions-continental-united-states); archive members dated 2015-07-17; exact SHA256 in JSON.
- US Census state boundaries: `cb_2023_us_state_20m.zip`, SHA256 `0fd2d6562708ff8182c00d5d25b5556d049ecf2794d97b89ed2dac4d5e9e2c8d`, 186,432 bytes; simplified to 0.02° for the browser.
- USDA FS FIA/GTAC Forest Type Groups: `conus_forestgroup.zip`, SHA256 `5ef0fa8212764e5337f4aeb94569cce144e5cb5a598314bb4f6ac23bf0f7dfbf`, 168,022,806 bytes, archive dated 2012-04-26, ground condition 2004, 28 classes, 250 m, EPSG:5069. Producer reports 65% overall conterminous class accuracy.
- Annual NLCD Land Cover 2023: `Annual_NLCD_LndCov_2023_CU_C1V2.zip`, SHA256 `da50297bc65c07a8210999d20e2b59e69a8d1470273e1ed9344884988fd47aaf`, 1,427,423,034 bytes, member `Annual_NLCD_LndCov_2023_CU_C1V2.tif`, 30 m, 16 classes (11–95), nodata 250, CONUS Albers (EPSG:5070 parameters). Product page `https://www.mrlc.gov/data/nlcd-2023-land-cover-conus`; the archive was retrieved from the MRLC data-bundles URL recorded in the source registry.
- NLCD Tree Canopy Cover CONUS v2021-4: `nlcd_tcc_conus_2021_v2021-4.zip`, SHA256 `7afe3a6856eacd30eb557515e821ab9a491df0e18231b107a2fe129e27541fb0`, 3,740,022,899 bytes, member `nlcd_tcc_conus_2021_v2021-4.tif`, 30 m, values 0–100 percent, 254 = non-processing area, 255 = background, CONUS Albers. Product page `https://www.mrlc.gov/data/nlcd-2021-tree-canopy-cover-conus`. The canopy vintage is 2021 while land cover is 2023; the two-year difference is documented, not corrected.
- USGS 3DEP 1 arc-second 1°×1° GeoTIFF: per-tile releases for the 14 release tiles (~45–53 MB each), EPSG:4269, meters, nodata −999999. New Mexico: `n36_w107` release 20220801, `n36_w106` and `n35_w106` release 20250311. Oregon canaries: `n44_w124` release 20250804, `n43_w123` release 20260202. The release is resolved per tile from the public TNM bucket listing (`https://prd-tnm.s3.amazonaws.com/?list-type=2&prefix=StagedProducts/Elevation/1/TIFF/historical/<tile>/`), because the previously pinned global date does not exist for most tiles. Cached tiles keep their fetched release; every release is recorded in the cache manifest and habitat sidecar.
- NRCS SSURGO via Soil Data Access: state attribute query (`mapunit` + `legend` + `sacatalog` + `muaggatt`) plus batched point lookup (`SDA_Get_Mukey_from_intersection_with_WktWgs84`). Attributes: `drclassdcd`, `aws025wta`, `aws050wta`, `flodfreqdcd`, `hydgrpdcd`, `slopegraddcp`, plus `saverest` for the recorded survey vintage. Endpoint `https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest`; product page `https://sdmdataaccess.sc.egov.usda.gov/`. Revision 5 prepared both states independently (fetched 2026-09-15):
  - Colorado: 7,740 mapunits, 78 survey areas, survey vintage through 2025-09-19, 719,174-byte response in 0.74 s, 77 KB normalized Parquet, mukey range 57,543–3,457,847.
  - New Mexico: 4,550 mapunits, 46 survey areas, survey vintage 2025-09-08/09, 417,573-byte response in 0.66 s, 48 KB normalized Parquet, mukey range 55,617–3,295,843.
  - Oregon: 12,556 mapunits, 52 survey areas, survey vintage through 2026-08-05 (oldest 2025-09-09), 1,046,239-byte response in 5.4 s, 121 KB normalized Parquet, mukey range 60,843-3,478,609 (prepared 2026-09-15). Some Oregon mapunits publish no drainage class; those cells stay NULL.
  - Point lookup: one batched query per tile, 18,126-character request, 11,801-byte response, 400 rows in 3.59 s, cached as ~12.5 KB JSON.
  - gSSURGO and gNATSGO state packages remain supported alternates through the same normalized contract; neither was obtainable from this environment (NRCS Box folder links 404, Geospatial Data Gateway 403, Web Soil Survey cart requires an interactive session).
- MTBS burned area boundaries: `EDW_MTBS_01/63`, queried with a JSON envelope; retrieval date recorded in the sidecar datasetVersion. The 14 release tiles hold 4–35 perimeters each; eleven perimeters appear in more than one tile and two appear on both sides of the Colorado–New Mexico line, always with the same stable `perimeter_id`.
- PAD-US: Esri-hosted public-access FeatureServer (edition not stated by the service, still not freshly audited) plus Census states for jurisdiction. The hosted layer publishes no usable stable unit id (`BndryID` and `ST_Name` both read "Not Applicable"), so property identity is the authoritative `name|manager|Category|DesTp_Desc|state` composite and near-boundary jurisdiction is withheld with an explicit confidence marker rather than guessed.
- The 40 legacy Ohio/Tennessee habitat tiles still carry NLCD land cover sampled per point, forest-group signals from the old sampler and no western host signals; they are unchanged and readable.

## Three-state release — measurements (revision 6)

Measured on the committed assets (`data/fruiting-forecast/`), not estimates. Sixteen tiles in three states, 6,400 habitat cells:

| Asset class | Total | Per-tile range |
|---|---|---|
| habitat Parquet | 231,397 B | 13,749-14,764 B (400 cells each) |
| public-land Parquet | 3,547,077 B | 71,787-550,548 B (143-2,137 grouped properties) |
| fire Parquet | 3,501,348 B | 17,720-980,912 B (2-56 MTBS perimeters) |
| manifest.json | 253,226 B | — |
| **release total** | **7,533,048 B (~7.2 MB)** | Colorado+New Mexico side 6.13 MB · PNW canaries 1.39 MB |

The PNW canaries are small in habitat and public land but the southern Cascades canary carries 56 MTBS perimeters (981 KB of geometry), the largest fire asset in the release; that is a real property of the fire history there, not a regression. Soil coverage is 391/400 for the Coast Range canary and 222/400 for the Cascades canary (Oregon mapunits without a published drainage class stay NULL). The FIA dominant-type product maps only one cell of the Coast Range canary as hemlock/Sitka spruce and none of the Cascades canary, because mixed Douglas-fir/hemlock stands are mapped as the dominant Douglas-fir type; the models lean on Douglas-fir as a result and the limitation is documented.

Representative browser searches measured through the app's own fetch/cache path (cold first run, then a repeat run):

| Search | Tiles selected | Cold GIS bytes | Cold / cached analysis | Repeat run |
|---|---|---|---|---|
| PNW Coast Range canary (44.60, -123.50), 25 mi | n44_w124 | 458,501 B (~448 KB) incl. 252 KB manifest | 7.5 s / 3.9 s | 0 requests, 4 cache hits |
| PNW Cascades canary (43.40, -122.30), 50 mi | n43_w123 + n44_w124 | 1,168,923 B of new tiles (fire 981 KB dominates) | 4.2 s / 3.8 s | 0 requests, gisHits 15 / gisMisses 7 cumulative |
| Colorado reference (39.62, -106.07), 25 mi | n39_w106 + n39_w107 | 1,155,403 B | 3.0 s / 3.4 s | 0 requests, 6 cache hits |

There is no meaningful PNW performance regression: per-tile habitat and public-land bytes are in the same range as Colorado and New Mexico, the added hemlock column is a few bytes per cell, and a repeated analysis again makes zero GIS network requests. Public land and fire remain the byte drivers.

## SDA scaling characteristics (revision 6)

Measured production behavior, not a benchmark claim:

| Operation | Measured | Cache |
|---|---|---|
| State attribute query (CO) | 719,174-byte response, 7,740 rows, 0.74 s | 77 KB Parquet + sidecar |
| State attribute query (NM) | 417,573-byte response, 4,550 rows, 0.66 s | 48 KB Parquet + sidecar |
| Batched point→MUKEY (400 points) | 18,126-char request, 11,801-byte response, 400 rows, 3.59 s | ~12.5 KB JSON per tile |
| State attribute query (OR) | 1,046,239-byte response, 12,556 rows, 5.4 s | 121 KB Parquet + sidecar |
| Unchanged `prepare state` re-run | no SDA query (`reused: true`) | — |

Projection from those measurements, assuming one point query per tile, one state query per state prepared once, and no throttling (none was observed across ~25 production calls; no 429s):

- **50 tiles:** ~50 point queries (~3 min serial), ~0.6 MB of point responses, ~0.6 MB of point caches, plus 1–3 state tables.
- **250 tiles:** ~250 point queries (~15 min serial), ~3 MB of point responses, ~3.2 MB of point caches, ~5 state tables (~0.3 MB).
- **955 CONUS land tiles:** ~955 point queries (~57 min serial), ~11 MB of point responses, ~12 MB of point caches, ~48 state tables (~2.5 MB), ~35 s of state queries. All of it is one-time; rebuilds reuse the caches. Batch size is 400 points per query; the request is ~18 KB, well below any practical URL limit, and no batch-size failure has been observed (a larger batch would reduce call count if needed).

Failure/retry behavior: `_sda_query` has no automatic retry; a failed call raises, writes no cache marker, and the next run retries cleanly. The publisher keeps the previous good asset and records `lastBuildAttempt: FAILED` rather than producing a false AVAILABLE.

## Bounded expansion plan (post-revision 6)

The revision-6 release is exactly the 16 tiles declared in `summary.coverageTiles`, verified end to end. Next bounded steps, in order:

1. **Bounded Pacific Northwest regional release (3-5 tiles)** using the proven factory and the now-modeled biology. The EPA intersection analysis identifies the natural block: `n44_w123` (100% PNW, west Cascades/Willamette), `n45_w123` (99.7% PNW, central Cascades/Willamette), `n45_w124` (96.4% PNW, north Coast Range), `n46_w123` (100% PNW, north Cascades/Willamette) and `n43_w124` (71.9% PNW, south Coast Range). A 4-tile batch would give the PNW coastal-to-Cascade and north-to-south coverage with one Oregon soil cache already prepared. Keep `n46_w122` out until the interiorMountains profile is modeled (35% interior).
2. **OSM regional-PBF access layer** for one bounded region (Colorado + New Mexico or Oregon + Washington) using the design below; access stays UNBUILT until it is verified.
3. **National generation only after** a multi-state batch verifies with the same commands and measured costs, and after the access layer is implemented or explicitly deferred.

Cost model from the real three-state release: 16 tiles required 15 DEM downloads (~50 MB each, cached forever), 16 PAD-US queries and 16 MTBS queries (cached per tile), one national source set, three state soil attribute queries and 16 batched point queries. Published output was ~7.2 MB. A 25-100-mile regional search costs ~0.45-3.3 MB once and zero on repeat.

## Access points: design, not priority (revision 6)

Access remains UNBUILT for every release tile and is deliberately not allowed to block habitat work; the manifest, the About coverage panel, the analysis status and the artifact tests all assert it. The scalable design when it is implemented: ingest a regional OSM extract (Geofabrik `.osm.pbf`, e.g. Colorado) and parse it locally with `pyosmium`, selecting the same genuine access features the legacy Overpass adapter used (parking, trailheads, boat ramps, public/permissive gates, visitor information) plus access roads/entrances where mapped. Associate each candidate with a published PAD-US property by local point-in-polygon, keep OSM tags as provenance, and publish per-tile `ap/` Parquet through the existing publisher. No Suggested Start location is manufactured: if no verified feature exists, the tile stays empty and the UI continues to say so. A regional PBF is one bounded download per region, not a per-tile Overpass call, which is what makes the eventual national pass tractable.

## Known limitations / remaining work

1. The bounded release covers 16 tiles in three states (11 Colorado, 3 New Mexico, 2 Oregon) with all five habitat components, public land and fire. Access remains UNBUILT for all of them by design. No other state has published evidence beyond the 40 legacy Ohio/Tennessee tiles.
2. Soil coverage is explicit rather than complete: 1–62 of 400 sampled cells per tile have no drainage class because the sampled mapunit is absent or the attribute is not published. Those cells stay NULL and lower the confidence coverage; no neutral value is invented. Nationally, SSURGO-only coverage means STATSGO2-mapped areas (some western rangeland) would stay NULL rather than being filled with coarse data.
3. Near-boundary jurisdiction is deliberately withheld: 51 properties across the release are published with `jurisdiction_confidence = ambiguous-near-boundary` and no state. They remain visible on the map and resolve to UNKNOWN_VERIFY; they can never inherit a neighbouring state's collecting rule. This is conservative by design, not a missing-data bug.
4. The hosted PAD-US public-access layer publishes no usable stable unit id (`BndryID` reads "Not Applicable"), so identity is a composite of name, manager, category, designation and resolved state. Two genuinely different units with identical composites inside one state would still merge; no observed case exists in the release, and the schema records the fields that define identity so a future source with a real id can replace the composite.
5. gSSURGO/gNATSGO state packages are supported through the same normalized contract (FileGDB, GeoPackage/SQLite and CSV packaging all normalize identically and are tested) but no real package was obtainable from this environment (NRCS Box links 404, GDG 403, Web Soil Survey cart needs a session). The SDA path is the verified production source; a future pass can validate a real package drop-in.
6. 3DEP releases differ per tile (20220216 for the two original tiles, 20250311 for two New Mexico tiles, 20220801 for the canary, 20260701/20260708 for most Colorado ones) because a single pinned date does not exist for every tile. Each release is recorded; mixed-release elevation evidence across tile edges is documented, not normalized away.
7. `spruce_fir` (class 120) is still not present in the release tiles; the spruce/fir signal comes from `fir_spruce_mountain_hemlock` (class 260). Both classes are weighted; a tile where only class 120 occurs has not been exercised. Pinyon-juniper and western-oak classes are recorded but have no host signal or model weight, by design.
8. Canopy (TCC 2021) and land cover (Annual NLCD 2023) use different vintages. They are separate signals, and the difference is documented; it is not corrected.
9. Remaining western profiles (PNW, California, Northern Rockies, Great Plains, Southwest, Southeast, Northern Forests) still have no forecasts. The northern New Mexico extension is scored only where EPA Southern Rockies polygons apply; its plains and Southwest sectors remain unsupported, which the interstate test asserts.
10. Habitat geometry is clipped at tile edges for public land, and the hosted PAD-US service merges same-named units, so same-named same-state units inside one tile are grouped. `n39_w106` has 2,137 grouped properties (550 KB) — public-land geometry is still the largest per-search asset.
11. Legacy 40 tiles were produced by the old per-point sampler: they lack western host signals, the added land-cover fields and published state jurisdiction. They remain readable (schema union) and rules fall back to the Census lookup; note that legacy rows have no jurisdiction-confidence marker, so the browser's Conservative check applies only to rows that carry it.
12. `evidenceGapCap` is an explicit engineering rule, not a scientific finding: it stops a disturbance-dependent target from ranking normally without burn evidence. It is declared in the target data and surfaced in the UI.
13. Snowmelt is a proxy (elevation + season), not a dataset. No degree-day or snowmelt-date source is ingested.
14. Observation support is unavailable for three of the four Southern Rockies targets by design: `porcini`, `morelNatural` and `morelBurn` have no single iNaturalist taxon that avoids aggregating biologically different taxa, so `inat` stays null and the observation component is omitted. Only `chanterelleRoseocanus` has a verified taxon (iNaturalist 499666).
15. Soil is published as environmental evidence; no Southern Rockies model weights it yet because the reviewed sources do not support a calibrated soil-moisture response. Drainage and available water storage therefore raise habitat confidence coverage and display in the habitat panel, but do not change a target score.
16. OPFS remains experimental legacy infrastructure. Actual evidence always registers bytes; metadata-only VERIFIED cannot bypass registration.
17. Manifest `datasetVersion` is content-addressed (`content-<hash>`) because the publisher owns it. Anything asserting a literal date should read the manifest instead.
18. The safety/access surfaces are unchanged: a forecast never establishes identity, edibility, access or legality.
19. The FIA forest-type-group product maps dominant type at 250 m: mixed Douglas-fir/hemlock stands are usually labeled Douglas-fir, so the new class-300 hemlock/Sitka-spruce signal is nearly absent in the two Oregon canaries (1 cell and 0 cells). The PNW chanterelle and craterelle models weight Douglas-fir and read the hemlock evidence where it exists; a hemlock-specific host dataset would materially improve them and is the clearest host-data gap.
20. Oregon SSURGO mapunits often publish no drainage class (222/400 cells in the Cascades canary, 391/400 in the Coast Range canary). Missing stays NULL and no neutral value is invented; a future gSSURGO/gNATSGO package may fill more attributes for the same mapunits.
21. The western matsutake 50-66 F soil-temperature band is an analogy from Japanese T. matsutake shiro studies cited in PNW-GTR-412, not a western T. murrillianum measurement; it is labelled provisional in provenance. The PNW burn-morel calendar and host weights are likewise transferred from western North American sources without PNW-specific validation.
22. `declaredGaps` is an engineering declaration, not a scientific measurement: it lets a target say "this published driver cannot be obtained" and lowers confidence accordingly. The weights (10 for stand age/understory/substrate, 20 for CWD/stand age) are engineering values chosen to be visible without dominating the score.
23. Only two PNW tiles are published; the profile is PROVISIONAL and the canaries cover the Coast Range/Willamette fringe and the southern Cascades, not the full coastal-to-Cascade gradient or Washington.

## Final verification (2026-09-15, revision 6)

    npx playwright test tests/fruiting-forecast.spec.js tests/fruiting-forecast-gis.spec.js tests/fruiting-forecast-huntability.spec.js tests/fruiting-forecast-access-theme.spec.js tests/fruiting-forecast-openrouter.spec.js tests/fruiting-forecast-about.spec.js tests/fruiting-forecast-conus.spec.js tests/fruiting-forecast-pnw.spec.js --reporter=line --workers=3

**92 passed, 1 skipped (54.3 s at `--workers=3`).** The skipped test is the opt-in live Princeton GIS run (`FF_LIVE_GIS=1`). The new 10-test PNW spec covers taxonomy/target resolution, golden-chanterelle wet-up/habitat/season ordering, the independent white-chanterelle calendar, matsutake host/season/temperature/elevation/missing-evidence ordering, craterelle hemlock ordering and the winter window, cross-region suppression, PNW/interior per-sector arbitration, canary artifact digests with Oregon soil provenance, DuckDB schema evolution with the new hemlock signal, and a real PNW search.

    uv run --with duckdb tests/test_fruiting_tile_publish.py
    uv run --with duckdb --with rasterio tests/test_fruiting_bulk_adapters.py

**5 publication tests passed** and **50 adapter tests passed**: contracts, cache/checksum paths, state-scoped SDA preparation with independent caches and failure isolation, cross-state mukey inclusion, packaging equivalence, DEM release resolution, identity helpers, habitat composition, legacy compatibility, the two-state Southern Rockies release audit, and the PNW canary audit (component/layer completeness, Oregon soil provenance, the additive hemlock signal, and three-state coverage dimensions).

    python3 -m py_compile tools/build-fruiting-gis.py tools/fruiting_tile_publish.py tools/build-fruiting-ecoregions.py tools/build-fruiting-states.py tools/fruiting_bulk_adapters.py
    .agents/skills/junkdrawer-compliance-audit/scripts/audit.sh fruiting-forecast.html
    git diff --check

All clean: `py_compile` OK; compliance audit 0 errors / 0 warnings with footer and JSON both at 2026.09.15.2; `git diff --check` OK.

Manual inspections: `/tmp/ff-pnw-coast.png` (25-mile Coast Range canary) shows the Pacific Northwest Maritime profile with five target cards, an evidence panel listing Mapped habitat, Season, Recent moisture, **Autumn moisture transition** and Recent reports, the species panel naming `Cantharellus subalbidus` with "soil temperature: not calibrated", and a missing-evidence note for the published stand-age association; `/tmp/ff-pnw-boundary.png` (100-mile 45.0, -122.5) shows "2 regional models across sectors" with the east sector reading "N/A opportunity" for the unsupported interior profile while PNW sectors rank matsutake/chanterelles; `/tmp/ff-colorado-regression.png` confirms the Southern Rockies profile still lists exactly the four Colorado targets.

## Exact next recommended task

Pick one track; both are ready:

1. **OSM regional-PBF access layer** (preferred if the goal is completing the evidence stack): prepare one bounded `.osm.pbf` once, extract trailheads/parking/public gates/entrances locally, associate with PAD-US properties by point-in-polygon, publish `ap/` tiles through the existing publisher, and keep "no verified feature means no suggested start". Then re-measure per-search bytes, which will grow by the access assets.
2. **Bounded Pacific Northwest regional GIS release** (preferred if the goal is geographic breadth now that the biology is proven): build `n44_w123`, `n45_w123`, `n45_w124` and `n46_w123` through the exact commands above with `prepare state --state OR` already cached; verify the coastal-to-Cascade gradient in a real search; keep `n46_w122` out until the interiorMountains profile exists.

Either way, keep the release bounded: three profiles and 16 tiles are proven, and CONUS generation must wait until the access layer is implemented or explicitly deferred.

Pick one track; both are ready:

1. **OSM regional-PBF access layer** (preferred if the goal is completing the evidence stack): implement the design above for the Colorado+New Mexico region first — prepare one bounded `.osm.pbf` once, extract trailheads/parking/public gates/entrances locally, associate with PAD-US properties by point-in-polygon, publish `ap/` tiles through the existing publisher, and keep "no verified feature means no suggested start". Then re-measure the per-search bytes, which will grow by the access assets.
2. **Pacific Northwest biological region** (preferred if the goal is model breadth): reuse the same five-component habitat stack and add PNW host evidence and provisional targets with the same provenance discipline; do not transfer Southern Rockies weights.

Either way, keep the release bounded: the next production step is one more state or a 3–5 tile batch through the exact commands above, then a CONUS plan only after the access layer is implemented or explicitly deferred.
