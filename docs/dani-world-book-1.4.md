# Dani the Pimple Popper 1.4 — The World Book of Pores

**Release date:** 2026-11-25
**Canonical URL:** https://hmarquardt.github.io/junkdrawer/dani-the-pimple-popper.html
**Baseline:** 1.3.0 (The Midnight Clinic), commit `2cbbc14`
**Namespace:** `world-book-of-pores` · **Content version:** 1.0.0 · **Metric rules:** v1

> Some people make history. Dani extracts it.

## 1. What shipped

- **One telemetry contract** (`danny/telemetry.js`) fed by the shared reservoir engine for the base
  campaign, The Pore Explorer and The Midnight Clinic. It observes finished measurements only and
  cannot mutate simulation state.
- **One record service** (`danny/records.js`): versioned metric definitions, twenty unified record
  classifications, bronze → legendary tiers, previous-best tracking, bounded history, integer-only
  persistence, and an idempotent 1.3 → 1.4 migration.
- **World Book hub** (`danny/world-book/expansion.js`) with a filterable record book, trophy room,
  daily disasters, weekly championships, legendary encounters, six gauntlets, share/compare, local
  certificates and bounded highlights.
- **Eight legendary encounters** built from new reservoir templates that compose existing mechanics
  (branching networks, cohesive ribbons, multi-material strata, concealed labyrinths, clusters with
  multiple outlets, phase-locked supernatural reservoirs, bioluminescent pipelines and a finale that
  combines all of them).
- **Six gauntlets** including a cross-campaign Boss Rush, with independent stored progress, explicit
  resume and an equipment restriction that is mechanically completable.
- **Portable challenge codes** (`WBP1.`) and **self-reported result codes** (`WBR1.`) with strict
  local validation; **certificates** rendered with Canvas on demand; **13 expansion achievements**.
- **Version 2.0 encounter-result contract** exposed from the hub module (`encounterResult()`).

## 2. Architecture

```
simulation (reservoir.js / pore-explorer/expansion.js)
   └─ api.observe(event)          ← finished measurements only
        └─ telemetry.js           ← bounded aggregator, 60-event buffer
             └─ records.js        ← metric registry, tiers, evaluate/commit, migration
                  ├─ world-book/expansion.js (presentation, challenges, trophies, sharing)
                  └─ progression.js (bounded world state in the transaction save)
```

The base campaign, Pore Explorer and Midnight Clinic keep their own namespaces, XP, achievements and
campaign checkpoints. Only *measurement* is shared. The World Book module is loaded on demand; base
startup downloads none of it.

## 3. Telemetry event contract (schema 1)

Events emitted by the shared engine: `encounter-started`, `release`, `discovery`, `gate-cleared`.
Completion is reported by the game when a case closes. A `release` carries: namespace, encounter,
seed, target, volume (normalised units), streams, outlets, materials, cohesive volume, secondary and
echo counts, regenerated chambers, mutated flag, phased chambers, discovered chambers, total
chambers, perfect flag, equipment id, rendered extrusion length. Payloads are bounded and contain no
functions, DOM nodes or blobs. Observers are read-only; the telemetry suite asserts the input object
is unchanged.

## 4. Metric definitions (rules v1)

| Metric | Meaning | Unit |
| --- | --- | --- |
| `singleExtraction` | The Big One — largest volume from one committed interaction | centi-units |
| `reservoirTotal` | The Mother Lode — total from one reservoir | centi-units |
| `encounterTotal` | The Geological Event — total from one encounter | centi-units |
| `extrusionLength` | The Long Goodbye — longest rendered continuous chain | centi-divisions |
| `cohesiveSegment` | Going the Distance — largest single-material segment | centi-units |
| `streams` | The Hydrant — simultaneous streams in one interaction | count |
| `discovered` | The Family Tree — chambers discovered | count |
| `secondary` | The Aftershock — secondary/echo releases in one encounter | count |
| `materials` | The Mixed Grill — distinct materials in one encounter | count |
| `streak` | The Streak Freak — consecutive successful releases | count |
| `sessionExtractions` | The Marathon Popper — committed releases in one encounter | count |
| `precision` | Porefection — perfect releases per thousand | per-mille |
| `composite` | composite documentary result for the encounter | points |
| `outletBurst` | most simultaneous outlets | count |

The eight 1.3 supernatural classifications keep their own metrics (`alienExtraction`,
`regenerationStages`, `phaseReleases`, `lunarScore`, `sporeOutlets`, `crystalSize`,
`sessionEncounters`, `supernaturalComposite`) so ordinary and supernatural results are never compared
misleadingly. Changing a definition requires a new rules version; stored values are not reinterpreted.

## 5. Midnight Clinic migration

- `normalizeWorld()` runs on first use and is idempotent. It maps the eight 1.3 stats
  (`alienBest`, `regenBest`, `phaseReleases`, `moonBest`, `multiStream`, `crystalBest`,
  `witchingHour`, `unholyExtrusion`) to unified metrics, but only when no unified value exists.
- Migrated values are flagged `{legacy:true, at:null}`. Dates, equipment ids and seeds that were never
  recorded are shown as **legacy / metadata unavailable**, never invented.
- The 1.3 stats are retained (read-only compatibility). The clinic's record panel now reads the
  unified value when present and labels legacy values.
- Achievements, class discovery, campaign checkpoints and integer-safe validation are untouched. A
  second normalisation is byte-identical (asserted in `tests/dani-world-book.cjs`).
- Interrupted migration cannot duplicate a record: commit only accepts a value greater than the stored
  best, history is de-duplicated by metric improvement, and the whole world state is bounded.

## 6. Daily and weekly rules

- **Daily Disaster:** `challengeFor(UTC date)` = FNV-1a hash of `date + template` over the nine
  installed challenge templates, with the seed derived from the same date. Identical date + rules
  version + content ⇒ identical challenge. Stored per date with seed, encounter and score; the best
  score per date is kept; re-running cannot duplicate rewards because `stats.dailies` counts distinct
  stored dates and the stored score only improves. History is bounded to 14 days.
- **Weekly Championship:** `weekKey()` uses the ISO-8601 UTC week. Three distinct challenges are
  selected from `week + index`; each can be run separately; the championship total is the sum of best
  scores. Completed weeks increment `stats.weeklies` once (`done` flag). History is bounded to 8 weeks.
- All generation is offline, deterministic, and local. Nothing is presented as a global ranking.

## 7. Sharing and comparison

`WBP1.` challenge codes encode schema version, rules version, encounter id, integer seed and a
whitelist of modifiers (`restrict`, `condition`, `noScan`). Decoding rejects wrong prefixes, oversized
payloads, unknown schemas/rules, malformed ids, uninstalled content, unknown modifiers and non-integer
seeds. `WBR1.` result codes are imported as **self-reported, unverified** entries (max 5) and flagged
when their rules version differs from the local one. No accounts, servers or claimed tamper-proof
rankings.

## 8. Save architecture and storage

`profile.world` is a small, bounded object inside the existing transactional current/previous save:
`best`/`prev` (≤40 integer metrics), `meta` (one small record each), ≤24 history entries, ≤96 trophy
ids, ≤14 daily entries, ≤8 weekly entries, ≤10 gauntlet checkpoints, ≤5 imported results, one
highlight summary, one pending challenge. No certificates, blobs, images or telemetry streams are
stored. Frame-loop persistence is unchanged (saves happen on case completion only).

## 9. Performance

Measured in the automated suite under Chrome's software renderer at DPR 3, 1180×880:
base idle median 16.7 ms / p95 16.8 ms; legendary scanning with telemetry median 16.7 ms /
p95 16.7 ms. Telemetry is event-driven (a handful of events per release), so it adds no per-frame
work. Certificate rendering and highlight summaries run only on demand. These are software-renderer
figures on a desktop; no physical-device measurement was performed.

## 10. Verification

- `tests/dani-world-book.cjs` — telemetry accuracy and immutability, metric definitions, record
  evaluation and tiers, migration and idempotency, namespace isolation, daily/weekly determinism,
  challenge-code validation, result import labelling, record book and filters, trophy room,
  legendary completion, certificate rendering, daily checkpoint resume, gauntlet restriction and
  staging, save corruption recovery, 1.0 save migration, offline hub, 360×640 layout, WebGL2 and
  Canvas.
- Existing suites re-run green: `tests/danny-popper.cjs`, `tests/dani-pore-explorer.cjs`,
  `tests/dani-midnight-clinic.cjs`, `tests/dani-release.cjs` (see the release commit message for the
  exact run).

## 11. Known limitations

- Version 1.2 never existed; 1.4 migrates 1.3 directly.
- Highlight summaries are bounded event/measurement summaries, not deterministic visual replays.
- Trophies use original inline SVG silhouettes rather than illustrated art.
- Weekly totals are local self-reported scores, not authenticated rankings.
- The daily and weekly *completion* paths share the challenge runner and were exercised by the
  gauntlet/daily checkpoint tests; the full three-stage weekly completion is covered by unit-level
  score accumulation rather than a scripted three-case playthrough.
- No physical iOS/Android device verification and no human playtest were performed. Outstanding
  checks: installation and upgrade from 1.0.1/1.1/1.3 preserving records, finger scanning without
  page scroll, frame budget and haptics on the largest legendary reservoir, offline replay after one
  visit, and the 360×640 hub layout on real devices.

## 12. Version 2.0 contract

`encounterResult()` returns: encounter id, patient classification, complexity, completion status and
quality, extraction releases/volume, equipment, duration, precision counts, discovery counts, material
totals, scoring rules and rules version. A future Day Spa can derive satisfaction, revenue, costs,
reputation, specialist bonuses, appointment duration and staff efficiency from this shape without
new simulation work. The Midnight Clinic `patientSummary()` contract is unchanged and remains the
source of patient-class metadata.
