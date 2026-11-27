# Dani the Pimple Popper 2.0.1 — The Polished Pore

**Release date:** 2026-11-25 · **Baseline:** 2.0 (`02e158b`, deploy 2026.11.25.9)
**Financial rules:** v1 · **Schema:** unchanged (1) · **Namespace:** `disgusting-day-spa`

> Finish the game properly.

## 1. Regression gate (complete)

Every mandatory suite was executed against the 2.0.1 working tree by a detached runner that recorded
exit codes and durations. Empty logs were never treated as success.

| Suite | Exit | Duration |
| --- | --- | --- |
| `tests/danny-popper.cjs` | 0 | 8 s |
| `tests/dani-pore-explorer.cjs` | 0 | 64 s |
| `tests/dani-midnight-clinic.cjs` | 0 | 82 s |
| `tests/dani-world-book.cjs` | 0 | 24 s |
| `tests/dani-day-spa.cjs` | 0 | 4 s (cached assets) |
| `tests/dani-release.cjs` | 0 | 6 s |
| Andi (`tests/andi-the-rat-slayer.spec.js`) | 0 | 13 s (8/8) |
| Storage heuristics (`tests/audit-storage-heuristics.sh`) | 0 | 1 s (9/9) |
| `tests/jd-storage.spec.js` | 0 | 11 s (18/18) |
| `tests/storage-manager.spec.js` | 0 | included above |
| `tests/dani-stabilization.cjs` (new) | 0 | ~25 s |

The Midnight Clinic and release suites that were outstanding at 2.0 are now green. No assertion was
weakened. The Day Spa suite initially failed for a real reason: an incomplete patch left two orphaned
lines at module scope in `business.js` (`spa is not defined`). Fixed and re-run green.

## 2. Defects found and corrected

1. **Accounting could not be reconciled after ledger pruning.** Cash was authoritative but the ledger
   is capped at 200 entries. Added cumulative `accounting {opening, inflow, outflow, grants, deferred}`
   maintained by every `post`, plus `reconcile()`. The Books tab now shows the invariant.
2. **Receipt idempotency depended on a 40-receipt window.** Added a bounded `settled` guard (80 ids)
   so a replay cannot pay twice after its receipt has been pruned.
3. **Rapid double-clicks could repeat an action.** Added a re-entrancy guard around dashboard actions.
4. **The header rules applied `width:100%` to each nav button at ≤1100px**, stacking/overlapping the
   six entries. Scope corrected to the nav container; at ≤430px the header is a six-column grid with
   44px touch targets.
5. **Orphaned `payOut` lines** at module scope broke the whole spa import; removed.
6. **`ledgerBalance` was replaced instead of extended**, breaking `reconcile`; restored.
7. **Marketing metadata was stale** (described only the original game and Pore Explorer). Updated the
   description and Open Graph copy for all five experiences.
8. **No in-game overview.** The Case Files dialog now opens with a short guide to the five
   experiences and a recommended starting path.
9. **Late-game progression wall.** 100-seed audits showed routine play stalling at tier 5: tiers 6–7
   cost 85,000 PB while routine margins accumulated ~16,500 PB in 60 days. Tier 6/7 prices reduced to
   22,000/34,000 and late overhead to 520/800/1,200. Routine now reaches tier 6 on the marketing path;
   aggressive expansion reaches Pore World in 24/100 seeds; premium/perfect play in 100/100.

## 3. Financial integrity

Verified by `tests/dani-stabilization.cjs`:

- 70 simulated business days with purchases, staff, events, upgrades and rough-quality appointments:
  **every day** satisfies `opening + inflow − outflow = cash`, including after the ledger has been
  pruned (the run asserts pruning occurred).
- Duplicate receipt after the completed window: no cash movement, no second receipt.
- Business assistance is rate limited; equipment cannot be bought twice; payroll posts once; a
  delegated appointment resolves once.
- No negative cash in any of 800 economic runs (8 strategies × 100 seeds). Deferred obligations are
  tracked separately and never counted as paid expenses.

## 4. Economic audit (100 seeds per strategy, 60 business days)

| Strategy | Median tier | Tier 7 | Stalled runs | Median cash | p10 / p90 | Grants |
| --- | --- | --- | --- | --- | --- | --- |
| Routine (clean) | 5 | 0/100 | 100 | 17,540 | 13,753 / 21,404 | 0 |
| Premium (perfect, 1.35×) | 7 | 100/100 | 3 | 60,402 | 42,166 / 73,655 | 18 |
| Conservative | 4 | 0/100 | 99 | 12,447 | 7,946 / 15,871 | 0 |
| Aggressive | 5 | 24/100 | 73 | 0 | 0 / 0 | 234 |
| Marketing-heavy | 6 | 0/100 | — | 5,388 | 47 / 21,238 | 3 |
| Delegation-heavy | 3 | 0/100 | 100 | 10,779 | 9,609 / 12,278 | 0 |
| Midnight-only | 1 | 0/100 | 100 | 0 | 0 / 0 | 500 |
| Low quality | 1 | 0/100 | 100 | 2,178 | 1,643 / 2,774 | 0 |

Findings:

- **Premium/perfect is dominant** (Pore World in 100/100 seeds, median 60k cash). Extraction quality is
  the strongest lever, which is intended; it is not a money exploit (every run still pays wages, rent
  and supplies).
- **Routine-only play plateaus at tier 5.** It remains solvent and can afford staff, marketing and
  equipment, but Pore World requires either better quality, premium pricing, or aggressive expansion.
  This is a deliberate skill gate, documented rather than flattened.
- **Aggressive expansion is viable but fragile** (24/100 reach tier 7; median cash 0, 234 grants).
- **Delegation-heavy play stalls at tier 3** because delegated work pays 90%, halves tips and cannot
  set records. It is a support strategy, not a replacement for playing.
- **Midnight-only from day one is a trap** (no revenue before tier 5). It is a policy artefact of the
  audit, but it reflects a real player mistake the UI should discourage; the Midnight Wing description
  now states the tier requirement.
- **Low-quality play never progresses**, confirming that rushed extraction does not out-earn care.

No strategy produced a negative balance or an unreconciled ledger.

## 5. Playtime and pacing

A reached tier is not a playtime. The audit performs appointments instantly; a human appointment of
3–4 targets takes roughly 20–40 seconds of active extraction. Premium play reaching Pore World by
day ~45–60 at 3–6 appointments/day implies **roughly 150–300 interactive appointments** and **2–4 hours**
of active play, plus management time. Routine play reaches tier 5 in that window and needs deliberate
quality/pricing improvement to finish; it does not require hundreds of identical extractions to unlock
management features (staff at tier 3, delegation immediately, marketing at tier 1).

These are estimates derived from automated runs and the measured duration of scripted appointments;
they are **not** human playtest measurements.

## 6. Navigation and accessibility

- Header verified at 320, 360, 390, 430, 768, 1024, 1180, 1440 and 1920 px: no overlapping entries, no
  horizontal overflow, every required entry hit-testable. Six entries (Case files, Field manual, Pore
  Explorer, Midnight Clinic, World Book, Day Spa) remain individually addressable, so no existing
  deep-link or test contract changed.
- At ≤430px the header is a six-column grid with 44px-high targets; labels wrap rather than clip.
- The spa dashboard was checked at 360×640: no overflow, charts carry `role="img"` and `aria-label`,
  the accounting sentence provides a textual alternative, dialogs expose `aria-labelledby`, and the
  Books tab states the reconciliation in words and numbers.

## 7. Production and offline

- Version markers, asset availability and a production browser smoke are recorded in the release
  commit notes and the final report of this release.
- Offline behaviour is covered by the suites: the Day Spa suite proves a controlled worker caches the
  module and that the dashboard opens after an offline reload; the World Book suite does the same for
  its hub. Cache names are versioned, so obsolete shells are removed on activate.

## 8. Known limitations

- Routine-only play plateaus at tier 5 by design; a 2.1 tuning pass could add a routine-viable endgame
  path if playtesting shows the plateau is discouraging.
- Midnight-only appointment selection before tier 5 is unprofitable; the UI states the requirement but
  does not prevent a player from trying.
- No physical-device testing and no human playtest. See `docs/dani-physical-device-checklist.md`.
- Performance figures are software-renderer measurements, not phone measurements.
