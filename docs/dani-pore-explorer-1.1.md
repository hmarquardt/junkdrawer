# Dani the Pimple Popper 1.1 — The Pore Explorer

**Release:** Dani the Pimple Popper 1.1 (expansion pack 1, namespace `pore-explorer`, pack version 1.1.0)  
**Canonical URL:** https://hmarquardt.github.io/junkdrawer/dani-the-pimple-popper.html  
**Baseline:** 1.0.1 release `1a4275e` (protected; base campaign unchanged)  
**Tagline:** The surface is only the beginning.

The Pore Explorer adds subsurface imaging, a reservoir-network simulation, six extraction behaviours,
three instruments, six anatomical regions, three chapters with three bosses, nine achievements and
new commentary. It is a first-party manifest loaded on demand. No backend, no paid dependency and no
third-party executable plugin is involved.

## Implemented features

| Requirement | Implementation |
| --- | --- |
| Expansion architecture | Independently versioned `danny/pore-explorer/pack.json`, lazily imported `expansion.js` and `porescope.js`, independent per-mode checkpoints, separate runtime offline cache, base campaign untouched. |
| PoreScope imaging | Surface, Scan and Cross-section views with a smooth cross-fade; animated scan lines, a footprint-aligned coverage lattice, depth-coded chambers, remaining-volume arcs, obstruction markers, a millimetre depth ruler and procedural tissue texture. Scanning is physical: the beam fills cells, and depth is earned by holding. |
| Subsurface reservoir engine | Graph simulation in `danny/reservoir.js` with six topology families, variable chamber volumes, four new materials, concealed compartments, articulation-edge valves, migrating plugs, multi-outlet flow, secondary cascade releases and deterministic replay from committed progress. |
| Six extraction behaviours | False Finish (conditional second reservoir), Endless Ribbon (long cohesive chain), Forked Reservoir (two arms, two simultaneous streams), Mixed Bag (materials change per chamber), Migrating Plug (obstruction changes chamber every pass), Chain Reaction (hub completion wakes neighbours). |
| New regions | Upper back, shoulder, outer ear, scalp, upper arm and neck, each with its own generated plate, curvature model, hair density/curvature and a hair-derived drag and scan-noise modifier. |
| Additional equipment | PoreScope (diagnostic sweep), Vortex Extractor (two flow units per release, narrow window, cannot break gates) and Resonance Wand (breaks one obstruction, cannot grip material). Each has a short first-use tutorial. |
| Expansion campaign | Three chapters, twelve encounters, three bosses (The Iceberg, The Krakenzit, The Hydra) with authored seeds. |
| Visual and audio | Imaging overlays, multi-stream long-form extrusions, depletion arcs, tissue cross-section, a boss flourish, secondary-release and low-depth cues, stereo panning for releases. WebGL2 and Canvas fallback both supported. |
| Progression | Nine expansion achievements, additive expansion statistics, expansion-specific chapter and boss counters. |
| Mode integration | The Pore Explorer is selectable from the header, the mode chooser and its own campaign panel; expansion Endless and Zen modes; encounter replay; expansion patients in Endless; extractions in Zen. No base-campaign prerequisite. |
| Commentary | Eighteen authored lines selected deterministically by event, including every requested line. |
| Performance and compatibility | Lazy media, bounded particles and nodes, deterministic fixed-step material simulation, texture reallocation instead of in-place mutation, adaptive graphics retained, reduced-motion respect, existing accessibility settings preserved. |

## New and modified files

**New**

- `danny/pore-explorer/pack.json` — manifest: 6 assets, 6 regions, 4 materials, 10 reservoir templates, 3 archetypes, 6 behaviours, 3 instruments, 3 bosses, 12 encounters, 3 chapters, 3 modes, 9 achievements, 18 commentary lines, 5 tutorials.
- `danny/pore-explorer/expansion.js` — campaign panel, reservoir releases, achievements, scanning interaction, tutorials, overlay ownership.
- `danny/pore-explorer/porescope.js` — imaging model (coverage, depth, discovery) and Canvas painting.
- `danny/pore-explorer/{back,shoulder,ear,scalp,arm,neck}.jpg` — generated region plates.
- `danny/reservoir.js` — deterministic reservoir graph primitive.
- `tools/danny-pore-textures.cjs` — reproducible plate generator.
- `tests/dani-pore-explorer.cjs` — expansion verification suite.
- `docs/dani-pore-explorer-1.1.md`, `docs/img/pore-explorer-*.png` — this report and captures.

**Modified**

- `danny/content.js` — optional families and reference fields, new technique/pattern/family validation, `pore-explorer` source registration.
- `danny/simulation.js` — vortex/resonance/probe curves, stutter/surge bands, long and multi-stream ejecta, reservoir attachment, hair resistance.
- `danny/render.js` — stream rendering, overlay ordering, per-region texture reallocation, new instrument silhouettes.
- `danny/progression.js` — expansion statistics, namespace-aware scoring, campaign seeds for every campaign, per-case reservoir reset, save validation for expansion fields.
- `danny/game.js` — lazy expansion loading, reservoir-aware releases, mode-scoped tray, campaign entry point, expansion reports, read-only inspection surface.
- `danny/audio.js` — stereo panning and expansion cues.
- `danny/instruments.js` — three new instrument studies.
- `danny/style.css` — PoreScope panel, imaging and campaign accents.
- `dani-the-pimple-popper.html`, `danny-the-pimple-popper.html` — entry point, metadata, versions.
- `danny-sw.js` — new shell version, runtime expansion cache, cache cleanup.
- `storage-manager.html` — expansion storage classification.
- `junk-drawer.json` — catalogue description and versions.
- `docs/danny-content.md` — architecture and engine contracts.

## Architectural decisions

1. **The reservoir is the model, not an animation.** Every visible chamber, material, depth and
   obstruction is derived from `replay(graph, {p, g, found})`. The save stores a pass count, a broken
   gate list and a scan mask; nothing else. A checkpoint therefore cannot describe a field that the
   simulation would not produce.
2. **Imaging is a Canvas 2D overlay under the material.** It never touches the skin shader, so WebGL2
   and the shaded Canvas fallback behave identically and the base renderer keeps its cost profile.
3. **The expansion is a guest.** `game.js` holds one nullable module reference, and every call site is
   optional-chained. Without the pack the base game takes exactly the 1.0.1 path.
4. **Instruments trade off, they do not upgrade.** The PoreScope cannot extract, the vortex cannot
   break gates, and the wand cannot grip material. Obstructed and branched networks reward choosing
   the right tool rather than a bigger number.
5. **Authored seeds for every campaign.** `slot()` now uses the encounter seed for any campaign mode,
   not only `base:campaign`; procedural modes still draw fresh seeds.
6. **Namespace-aware scoring.** Expansion modes add `deep*` counters, so base achievements and
   counters cannot be earned or advanced by expansion play.
7. **Storage is unchanged in shape.** One IndexedDB database, one bounded record pair, one small
   per-target progress map cleared on case change, plus a lazily filled media cache.

## Simulation changes

- Reservoir draws: one volume unit per release (two for the vortex), nearest chamber first, empty
  chambers remain conduits, hubs cascade 55% of a unit to each revealed neighbour.
- Gates are placed on articulation edges wherever the topology has one, so valves and plugs cannot be
  trivially bypassed. Migrating plugs hold a different articulation edge per draw; a resonance pass
  records the draw index.
- Concealed chambers are excluded from flow until imaged or exposed by draining the chamber in front of
  them. Exposure is derived during replay.
- A reservoir that is already empty is sealed by a normal release instead of soft-locking.
- Depth gain is accumulated with an in-memory remainder so integer persistence still grows on a 60 Hz
  frame loop.
- Material emission and multiple simultaneous streams keep the existing fixed 1/90 s stepping.

## Asset sources

All expansion art is original. `tools/danny-pore-textures.cjs` deterministically generates six
768×576 region plates from documented seeds: a multi-octave value-noise skin field, region-specific
curvature (broad back, rounded shoulder, cartilage ear, follicular scalp, tapered arm, creased neck),
baked pores, creases and tapered hair curves, then a JPEG encode (`sips` on macOS; PNG otherwise).
Regenerate with `node tools/danny-pore-textures.cjs`. No third-party image is used and no base
photograph is recolored. Fonts and Three.js remain the base release's licensed assets.

## Campaign content

| Chapter | Encounters | Boss |
| --- | --- | --- |
| Below the Surface | Nothing to see here · The Hidden Agenda · More Than Meets the Eye | The Iceberg |
| Pore Decisions | The Fork in the Road · Chamber of Secrets · The Long Goodbye | The Krakenzit |
| The Underground | Subterranean Blues · The Department of Hidden Affairs · Everything Everywhere All at Once | The Hydra |

## Test results

All commands were run from the repository root on macOS with Chrome (Playwright 1.62.1) and a
software rasterizer.

| Command | Result |
| --- | --- |
| `node tests/danny-popper.cjs` | Pass — four chapters, four bosses, all modes, upgrades, score, achievements, offline, migration, recovery, conflicts, accessibility, touch, keyboard, WebGL2 and Canvas. |
| `node tests/dani-pore-explorer.cjs` | Pass — manifest and lazy loading, namespace isolation, deterministic graphs, accounting, activation, hidden placement, 12 encounters, 3 bosses, 6 behaviours, 3 instruments, 9 achievements, independent checkpoints, 1.0 save, offline expansion cache, legacy URL, WebGL2 and Canvas imaging. |
| `node tests/dani-release.cjs` | Pass — installed 1.0 worker upgrade, both launch URLs, PWA identity, both checkpoints, continued saves, branding and cross-app isolation. |
| `npx playwright test tests/andi-the-rat-slayer.spec.js --workers=1` | Pass — 8/8 shared-infrastructure regressions. |
| `bash tests/audit-storage-heuristics.sh` | Pass — 9/9 heuristics. |

The expansion suite also asserts no console or page errors across the whole run.

## Performance measurements

Identical conditions: one page, 1180×880 logical viewport, `deviceScaleFactor: 3`, software
rasterizer, 100 sampled animation frames after the first 12.

| Scene | Median frame | p95 frame |
| --- | --- | --- |
| Base field, idle | 16.7 ms | 16.8 ms |
| PoreScope scanning (sweep loop, overlay + imaging) | 16.7 ms | 16.7 ms |

Both scenes hold the 60 Hz frame budget under software rendering; the messaging and overlay work does
not push the frame over budget. No material regression against the 1.0.1 baseline was observed in this
environment. Real-GPU and thermal measurements on physical devices have not been performed.

## Save compatibility verification

The suite seeds a schema-2 record containing only 1.0 fields, reloads, and asserts the base field,
XP, score and achievements survive, that expansion counters normalize to zero, that the base tray
hides expansion instruments, and that the expansion is still selectable. It also plays the expansion,
switches to the base campaign, and asserts the base slot is byte-identical, the base counters are
unchanged, all four mode slots exist, and a deliberately corrupted newest record recovers from the
previous checkpoint with expansion chapter progress intact.

## Offline behavior verification

After one online visit the suite asserts the base shell still holds its original files plus
`reservoir.js`, and that the runtime expansion cache holds the six plates and the two on-demand
modules. It then goes offline, reloads, and resumes the expansion checkpoint with the campaign panel
and imaging available. The legacy launch URL continues to resolve to the canonical document offline.

## Known limitations

- Physical-device validation is outstanding: no phone, tablet or real-GPU timings, thermal behaviour,
  haptic feel or touch ergonomics have been verified for the expansion.
- No human playtest of the expansion's feel has been recorded yet; the base release's approved feel is
  the reference.
- The PoreScope depiction is fictional and deliberately non-diagnostic; it is not medical imaging.
- Scanner coverage is intentionally coarse (6×6 per field) to keep the save small and the interaction
  legible; it is a game instrument, not a high-resolution map.
- The expansion is English-only, matching the base game.
- Boss encounters are long by design (the Hydra can need a dozen passes per target); there is no
  separate difficulty selector beyond the expansion Zen mode.

## Deployment

- Production host: GitHub Pages, canonical URL unchanged.
- Release commit: `bfde2ce9b7d25d66dafcbac06c8fed080c3d5eb7` ("Release Dani 1.1 with The Pore Explorer expansion").
- Follow-up commit: `a4f40be` ("Prime the Pore Explorer offline cache on a first visit") adds `primeOffline()` and bumps the shell and expansion caches to 2026.11.25.5.
- Push verification: `origin/main` contains both commits (`git-sync.sh verify` reported the remote has this history).
- Production smoke test on the live origin with a fresh browser profile: page reports `FICTIONAL SIMULATION · v1.1`, WebGL2 renderer, the expansion loads only after it is opened, the authored seed 51031 is used, a scan reached 3/3 chambers at full depth gain, one release advanced the reservoir with two material streams and awarded "The Truth Is Down There", and the worker finished with `junkdrawer-danny-shell-2026.11.25.5` plus `junkdrawer-danny-expansion-2026.11.25.5` (9 files, 6 plates). No console or page errors.

## Remaining physical-device validation

1. Install the canonical URL on iOS Safari and Android Chrome; confirm the service worker upgrades an
   existing 1.0.1 installation and that both checkpoints survive.
2. Play Chapter Five on a mid-range phone: confirm the scan beam tracks a finger without scrolling the
   page, that the cross-fade holds frame budget, and that haptics fire on release.
3. Confirm the expansion remains playable offline after one online visit on each platform.
4. Confirm the PoreScope panel and the campaign panel fit a 360×640 viewport without horizontal
   scrolling, and that keyboard scanning works with a hardware keyboard on a tablet.
5. Record device, OS, browser, input method, observed response and player comments, then update this
   report.
