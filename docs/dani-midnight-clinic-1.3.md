# Dani the Pimple Popper 1.3 — The Midnight Clinic

**Release:** 1.3 (expansion pack 3, namespace `midnight-clinic`, pack 1.0.0)  
**Canonical URL:** https://hmarquardt.github.io/junkdrawer/dani-the-pimple-popper.html  
**Protected baselines:** 1.0.1 `1a4275e`, 1.1 `bfde2ce` (both re-verified in this release)

## Version 1.2 status (release blocker review)

Version 1.2 (The World Book of Pores) is **not present** in this repository: there is no 1.2 manifest, module, documentation, telemetry pipeline or record system. This release therefore could not integrate the 1.2 record contract, and it did not pretend to. The applicable blocker was resolved inside 1.3:

- A bounded **supernatural record book** ships with the clinic (eight classifications, separate from base score/XP/best streak).
- Records are defined in the pack (`records`: `{id,name,stat,kind}`), rendered from ordinary integer profile stats, and classified separately so supernatural material never contaminates base comparable records.
- No existing personal best is touched: base XP, score, best streak, achievements, chapters and boss counters are untouched by clinic play (asserted in the suite).
- The interface is deliberately the one a future World Book can adopt: `records` definitions, integer stats, per-class counters and a documented record classification, with no new database.

Outstanding 1.2 work, recorded rather than bypassed: a unified record/challenge service, cross-game challenge sharing, trophy collection, and a migration that folds the 1.3 supernatural records into that service.

## Implemented features

| Requirement | Implementation |
| --- | --- |
| Architecture | First-party pack `danny/midnight-clinic/pack.json`; lazy module; independent campaign/endless/zen/referral checkpoints; separate runtime offline cache; no backend, no paid dependency. Reuses the shared deep-extraction engine in `pore-explorer/expansion.js` and `reservoir.js`. |
| Ten patient classes | Vampire, werewolf, zombie, swamp creature, reptilian, extraterrestrial, troll, ghost, fungoid and Lovecraftian, plus a crossover class. Each is a `patients` record with its own region plate, materials, reservoir template, environmental condition and intake paperwork. |
| Eight materials | Ectoplasm, Dragon Wax, Moon Gel, Swamp Sludge, Obsidian Sebum, Alien Plasma, Mycelial Filament and Crypt Resin, each with distinct viscosity, cohesion, adhesion, colour and highlight; mixed materials create simultaneous streams. |
| Environmental mechanics | Authored `conditions` (`moonless`, `howling`, `delayed`, `humid`, `phase-storm`, `iridescent`) drive lunar surges (every fourth pass draws +50%), temperature sluggishness (every third pass draws 60%), spectral windows (hidden chambers visible on alternate passes), bioluminescent reveals and phase throttling. All derived from the pass index and seed, so they are deterministic and checkpoint-safe. |
| Four instruments | The Silver Loop (steady alignment, perfect alignment draws +50%, levers simple plugs), Spectral Extractor (fast through phase windows), Cryo Wand (cracks crystalline cores, lower flow), Arcane Resonator (ruptures cores, septa, plugs, migrating plugs and valves; reveals concealed connections; slower). All have first-use tutorials and touch/keyboard input. |
| Reservoir behavior primitives | Phase throttling, Regenerator (bounded dormant chambers that wake one at a time), Living Labyrinth (extra passages open at fixed milestones; connectivity can only improve), Convergence/Spore outlets (multi-stream), Spectral Echo (a delayed release from the chamber behind one that emptied), Crystalline Core (equipment-gated obstruction), Material Mutation (chamber material changes at a defined milestone). |
| Campaign | Four chapters, sixteen appointments, four bosses: Count Porecula, The Abominable Sebum, The Extra-Terrest-Zit and Cthulhu's Complexion. |
| Midnight Endless | Procedural variant per shift from the seed: eight rare patient variants, an instrument restriction, an authored intake note, authored encounters for class/region/material/topology/condition variety, and the engine's every-fourth-patient boss schedule. |
| Midnight Zen | Every instrument unlocked, no score or XP, phase restrictions lifted, ambience and intensity adjustable, quiet-HUD option. |
| Records | Eight supernatural records plus a class book, shown in the clinic panel and case files. |
| Achievements | Sixteen midnight achievements, including one hidden referral achievement and a lunar-score record achievement. |
| Atmosphere | Procedural rain bed, thunder, clock chimes and creaks on an independent ambience bus, plus an optional low music pad, with separate ambience volume, music toggle, extraction volume and reduced-intensity behaviour. No jump scares, no flashing. |
| Visual intensity | Spooky / Midnight / Eldritch change stream count (2/3/4), saturation and overlay depth only. Scoring, difficulty and record eligibility are unchanged. |
| Crossover | The Ratfather's Referral is a hidden one-case mode unlocked after six supernatural classes, with a signed referral note and an Alley Cat Council observer flag. No runtime dependency on Andi the Rat Slayer. |
| Future Spa contracts | `patientSummary()` exposes patient class, appointment complexity, equipment requirements, estimated releases, completion quality, satisfaction inputs, material statistics and environmental requirements. No finances, scheduling, staffing or reputation are implemented. |

## Patient classes and materials

| Class | Region plate | Reservoir primitives | Condition |
| --- | --- | --- | --- |
| Vampire | pale translucent throat/shoulder | fork, hidden compartments, phase window, plug | moonless |
| Werewolf | dense fur back/forearm | chain, spectral echo | howling |
| Zombie | weathered forearm | strata, two dormant chambers, material mutation | delayed |
| Swamp creature | amphibian flank | braid, echo, multiple outlets | humid |
| Reptilian | overlapping scales | fork, crystalline core, phase window | phase storm |
| Extraterrestrial | iridescent torso | braid, rewiring passages, phase window | iridescent |
| Troll | mineral back | strata, crystalline core, multiple outlets | delayed |
| Ghost | translucent shoulder | ribbon, three phase-locked chambers | phase storm |
| Fungoid | mycelium shoulder | chain, echo, four outlets | humid |
| Lovecraftian | impossible torso | braid, rewiring, mutation, septum, phase window | phase storm |

## Assets

Twelve original procedural plates (768×576) are generated by `tools/danny-midnight-textures.cjs` from documented seeds: base/flush palettes, curvature relief, pores, grain, sheen, tapered hair with adjustable weight, overlapping scale arcs, branching mycelium with spore nodes, bioluminescent blooms and mineral facets. Regenerate with `node tools/danny-midnight-textures.cjs`. No third-party imagery; no base plate is recoloured. Fonts and Three.js remain the base release's licensed assets.

## Verification

| Command | Result |
| --- | --- |
| `node tests/dani-midnight-clinic.cjs` | **Pass** — manifest and lazy loading, class/material/record/tutorial contract, unknown-class rejection, namespace isolation, deterministic graphs, conditions, phase transitions, rewiring, finite regeneration, material conservation, all sixteen appointments, four bosses, achievements, records, referral and observer, endless variant determinism and restrictions, Zen, independent checkpoints, 1.0 save compatibility, offline cache, legacy URL, WebGL2 + Canvas, touch, mobile layout, frame budget. |
| `node tests/danny-popper.cjs` | **Pass** |
| `node tests/dani-pore-explorer.cjs` | **Pass** |
| `node tests/dani-release.cjs` | **Pass** |
| `npx playwright test tests/andi-the-rat-slayer.spec.js --workers=1` | **Pass 8/8** |
| `bash tests/audit-storage-heuristics.sh` | **Pass 9/9** |

Frame timing (identical page, 1180×880, DPR 3, software rasterizer): base idle median 16.7 ms / p95 16.7 ms; clinic scanning median 16.7 ms / p95 16.7 ms. Both hold the 60 Hz budget.

## Defects found and resolved during verification

- Phase windows keyed to committed passes could never open while a release was blocked. Phases are now a property of the chamber's own fill and throttle flow to 30% instead of walling it off, so no seed, instrument or condition can soft-lock a case; the spectral extractor draws 30% faster.
- Spectral echoes originally re-drained an already-empty chamber. They now release from the still-filled chamber behind it.
- The shared PoreScope was hidden in clinic modes by pack scoping; equipment now accepts an array of scopes.
- Clinic modes could not break valves with any owned instrument; the Arcane Resonator now parts valves too, and the free Silver Loop levers simple plugs.
- Record stats stored float volumes, which the strict integer save validator rejected, so a reload silently fell back to the previous checkpoint. They are now integer centi-units.
- The PoreScope pack was not loaded when the clinic was opened directly, and `midnight-clinic` was missing from the optional content sources. Both are registered.
- Two additional navigation entries overlapped on narrow desktops; the mast now wraps.

## Save compatibility and offline

The suite asserts the base campaign slot is unchanged after full clinic play, that four independent clinic slots exist, that the base counters stay at zero, that a corrupted newest record recovers from the previous checkpoint with clinic progress intact, that a 1.0-shaped save normalises new settings/discovery fields and still opens the clinic, and that all twelve supernatural plates plus the clinic module are cached. It then reloads offline and resumes the clinic checkpoint.

## Known limitations

- **No physical-device verification and no human playtest were performed.** Frame timing above is a software rasterizer on macOS.
- Version 1.2 (World Book of Pores) is absent; the supernatural record book is intentionally a standalone, migration-ready subset. Challenge sharing and trophies are not implemented.
- Patient intake humour is an authored pool of sixteen forms plus per-patient notes, not an infinite generator.
- Midnight Endless combines authored encounters with seeded variants (class/condition/material/topology vary through the authored pool) rather than generating brand-new encounter records. Documented as the intended bounded design.
- Ambience is procedurally synthesised, not recorded; there is no separate music track beyond the pad.
- Instruments are fictional; nothing in the expansion is clinical guidance.

## Deployment

- Production host: GitHub Pages, canonical URL unchanged.
- Release commit: `0177568e4618f7368267cacceec6d5da1a9b4e4d` ("Release Dani 1.3 with The Midnight Clinic expansion")
- Push verification: `origin/main` contains the release commit (`git-sync.sh verify`).
