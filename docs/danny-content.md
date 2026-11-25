# Dani the Pimple Popper 1.0.1

The public entry point is [dani-the-pimple-popper.html](../dani-the-pimple-popper.html). Serve the repository over HTTP on localhost or HTTPS. The first online visit installs the base game for offline play. The game registers its worker for the canonical and legacy game filenames. Both use the same bounded asset cache.

Existing installations keep their manifest ID, `danny-popper` database and both campaign checkpoints. The old bookmark works offline with its installed release. After reconnecting, open it to receive the updated worker, then reopen the game. The legacy worker can run the corrected shell at the old address until the canonical scope is ready for offline launches. A device that has never received the update needs a connection before it can first open the new URL.

## Game systems

| Module | Responsibility |
| --- | --- |
| `danny/content.js`, `danny/base.json` | Load authored manifests, resolve namespaced IDs, and expose the content catalog. |
| `danny/simulation.js` | Generate repeatable patients and fields, evaluate instrument curves and boss release bands, and step the material simulation. |
| `danny/render.js` | Sample region photographs with pressure-dependent UV displacement and shading in Three.js/WebGL2. Composite tool contact and simulated material. Fall back to a shaded Canvas field when WebGL2 is unavailable or its context is lost. |
| `danny/input.js`, `danny/audio.js` | Handle pointer capture, cancellation and keyboard holds. Synthesize instrument contact, release, misses, timing cues and completion sounds. |
| `danny/progression.js` | Resolve encounters and mode checkpoints, apply score and XP, fit upgrades, award achievements, and migrate preview saves. |
| `danny/storage.js` | Commit the current profile and previous checkpoint together in IndexedDB. Detect stale writers. |
| `danny/game.js` | Connect the systems to the workstation, field reports and accessibility settings. |

One campaign consists of four chapters with a regular patient and a boss patient in each. Endless Clinic chooses a fresh seeded field each shift and schedules a boss every fourth patient. Zen accepts any release pressure and leaves score and XP alone. Each mode resumes its own patient. The case files show earned achievements and fitted upgrades.

## First-party content contract

A pack is a same-origin JSON manifest. The engine exposes `createRegistry()` for isolated catalogs and `content` for the game catalog. The application awaits `baseReady` at startup. The optional source map is empty in 1.0. On resume the engine resolves only the namespaces required by the active mode, equipment and encounter, and checks their major versions. A future first-party entry point can await `content.load(relativeManifestURL)` when a player enters that content. The current release invokes this loader only for the base pack. Repeated requests for a URL share a promise. Failed loads can be retried.

Every manifest declares a unique lowercase `namespace`, a semantic `version`, and integer `engineMajor` (currently 1). Record IDs take the form `namespace:slug` and must be unique across all categories. References may point to records in the same manifest or a previously registered pack. The loader stages a whole manifest, checks collisions and typed references, then registers it atomically. The base manifest serves as the working example for every record family.

| Array | Fields and engine meaning |
| --- | --- |
| `assets` | `kind` is `image` or `audio`. Resolve `src` relative to its manifest. Registration records a URL. A region decodes its image on entry. Equipment can decode an optional audio sample on first release. |
| `regions` | `name`, `image` asset ID, positive `elasticity` and `oil` multipliers for tissue displacement and specular response. |
| `materials` | `viscosity`, `cohesion` and `adhesion` in [0,1], and CSS `color` and `highlight`. These drive drag, chain constraints, outlet attachment, droplets, and contact friction. |
| `archetypes` | `name`, `material` ID and integer `shape` selecting a pale cap (0), dark plug (1), or congested opening (2). |
| `equipment` | `name`, descriptive `type`, `technique` (roll, pulse, suction), positive `speed`, normalized half-width `window`, unlock `xp`, tray/contact `art` (0–2), and optional `audio` asset ID. |
| `upgrades` | `name`, unlock `xp`, additive `windowBonus`, multiplicative `speedScale`. Earned upgrades fit automatically. |
| `behaviors` | Select an engine `pattern` (layers, drift, breakaway, alternating). Set `layers`, `pace`, `window` multiplier and normalized `shift`. Each completed pass persists. |
| `bosses` | `name`, `hint`, `behavior` and `archetype` IDs. The boss occupies the final field slot and unlocks after its other targets clear. |
| `encounters` | `name`, `flavor`, `region`, integer `seed`, `count` (1–6), nonempty `archetypes` list, optional `boss`. |
| `chapters` | `name`, positive `difficulty` multiplier and ordered `encounters` IDs. |
| `modes` | `name`, `description`, `strategy` (campaign, endless, zen), ordered `chapters` IDs and `scoring` ID. Registered modes appear in the shift picker. Endless schedules require regular and boss encounters. |
| `achievements` | `name`, positive `threshold`, and a profile counter in `stat` (total, perfects, bestStreak, bosses, chapters, endlessFields, zenFields). |
| `scoring` | `clean`, `perfect`, `streakStep`, `streakCap`, `bossBonus` and `caseXP`. The mode selects its rule by ID. |

A new behavior primitive requires a reviewed addition to the engine's pattern table and simulation code. Data packs can compose the built-in primitives. The loader accepts data and same-origin media references. The engine contains all executable behavior.

The base worker's install list contains base assets only. A future pack that supports offline use should cache its selected manifest and assets after entry, under a bounded, versioned pack cache. Register its packaged URL in a first-party route. An expansion management screen is outside the release scope.

## Save compatibility and recovery

Schema 2 stores stable mode, encounter, tool, achievement and pack IDs. A mode slot contains its patient seed, shift counter, cleared target indices, pass counts, current score, and streak. A release commits at a discrete boundary. An interrupted hold resumes at the last committed pass. Retain encounter seeds, target order, count and archetype meaning for published IDs. Give substantially changed layouts new IDs. Preserve IDs across compatible pack versions. A breaking pack update requires an explicit migration and fixture from the preceding release.

One IndexedDB object store holds `current` and `previous`. Every write compares the current revision and parent checkpoint token and advances it atomically. A stale tab gets an actionable status. A malformed current record falls back to a valid previous checkpoint. The preview migration maps its six numeric cases and three instruments onto stable IDs and preserves cleared targets, XP, sound, and operator totals. A future save format or unavailable active content opens a temporary session and protects the saved records. Inactive pack slots and unknown achievement IDs survive normal saves. Resetting all shifts removes the prior checkpoint and writes a fresh profile.

## Verification and expansion gate

Run `node tests/danny-popper.cjs` from the repository root with Chrome and Playwright installed. It serves a GitHub Pages-style subpath and exercises the game through browser input. Run `node tests/dani-release.cjs` to test the installed 1.0 worker upgrading on the same origin, both launch URLs, and checkpoint preservation. The compatibility test reads the original release from Git history. The static shell includes its licensed fonts, Three.js and all base region textures.

The Pore Explorer, Dani's Disgusting Day Spa, The Guinness Book of Pores, and The Midnight Clinic are reserved concepts. Expansion implementation starts only after the base release is live, its encounters and save recovery pass, physical-device testing confirms acceptable mobile performance, and actual players have evaluated the feel and visual quality of extraction. Record real device, input method, observed response, and player comments when that playtest takes place.

### Art sources

The original cheek photograph and four regional plates were generated with the built-in image generation tool. The renderer adds the playable lesions, tissue response and expelled material at runtime. `skin.jpg` is the cheek plate. The four quadrants of the second plate became `forehead.jpg`, `jaw.jpg`, `nose.jpg`, and `temple.jpg`.

<details><summary>Source prompts</summary>

> Photorealistic extreme macro photograph of a small field of warm peach human cheek skin, full bleed edge to edge, camera almost perpendicular to skin surface with very slight slope. Fine pores, organic creases, a few nearly translucent vellus hairs, subtle rusty rose flushing, naturally varying skin relief. Soft directional clinical light from upper left, realistic specular skin oils, optical macro focus crisp across central field and softer toward edges. No distinct large pimples, objects, tools, wounds, text, graphics, or borders. Landscape 3:2, for the base texture in a fictional macro simulation.

> A 2 by 2 contact sheet of four photoreal dermatological macro skin texture photographs for a fictional game, no borders, no text, no gutters. Each quadrant is a distinct edge-to-edge magnified patch of healthy skin, no face silhouette. Upper left: warm medium brown forehead with subtle curving horizontal micro-folds and fine sheen. Upper right: bronze jaw/chin with sparse short dark stubble, subtly faceted pores. Lower left: pale rosy nose with larger sebaceous pores and specular oils. Lower right: rich deep brown temple, fine vellus hairs and soft interlacing lines. Natural macro-photographic detail, overhead view, same soft directional light upper left, no implements, no blemishes or wounds. Square canvas, strict four equal square photographs.

</details>
