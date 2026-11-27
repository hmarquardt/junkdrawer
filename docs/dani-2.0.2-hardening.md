# Dani the Pimple Popper 2.0.2 — Final Release Hardening

**Release date:** 2026-11-25 · **Baseline:** 2.0.1 (`07ed2ed`, `1b64e6e`, deploy 2026.11.25.10)
**Schema:** 1 (additive fields only) · **Financial rules:** v1 · **Namespace:** `disgusting-day-spa`

## 1. Permanent transaction idempotency

2.0.1 relied on a 40-receipt window and an 80-id ring. Both are advisory. 2.0.2 makes settlement
eligibility structural:

1. **Current-day eligibility.** A settlement is legal only when `appointment.day === spa.day`. A
   reconstructed session for a closed day is refused before any money moves, no matter what history
   has been pruned.
2. **Generation-valid identifiers.** The appointment id must match `^d<today>-(a<1..12>|L|E<n>)$`.
   Malformed or historical receipts cannot collide with a live slot.
3. **One settlement per slot per day.** `settleMask` is a 14-bit integer in the save. Bits are set
   once; out-of-order completion (a3 before a1) works because bits are independent. The mask is not a
   history list and is never pruned.
4. **Terminal state.** A duplicate or rejected settlement marks the appointment complete and clears
   the session, so the day can still close (a defect found by the stress test).
5. **Archived audit trail.** On day advance the day's mask is appended to `settleLog` (≤30 integers)
   solely for audit; eligibility never reads it.

The same analysis applied to the other money movements:

- **Payroll, rent, utilities, maintenance:** stable ids (`<day>-wages`, `<day>-rent`, …) plus
  `closedDay`; retrying an interrupted close posts only missing ids.
- **Facility, equipment, marketing, hiring, training:** stable ids (`facility-<tier>`, `equip-<id>`, …),
  so a repeated request is a no-op.
- **Repeatable supply purchases:** the UI supplies a per-click request id (UUID); `post` de-duplicates
  it. The dashboard also has a re-entrancy guard against double clicks.
- **Grants:** `assist-<day>` plus a ten-day rate limit.
- **Delegation:** the same per-day slot mask; a resolved appointment is terminal.

Multiple tabs are protected by the existing revision-checked save transaction: both tabs may compute a
receipt, but only one state is committed; the loser's cash and mask never reach storage. Previous-
checkpoint recovery restores the committed mask with the receipt, so a recovered save cannot replay it.

### Stress results (`tests/dani-stabilization.cjs`)

- Settle one appointment, then post **100 / 1,000 / 10,000** later transactions, **delete both the
  completed receipts and the settled-id ring**, and attempt to settle again: refused every time, cash
  unchanged, mask intact, ledger pruned to 200.
- Out-of-order settlement (a2 then a1): two receipts, exactly one per slot; re-settling either is
  refused.
- Closed day / stale session: refused; the day advances normally afterwards.
- Malformed identifier (`dX-a1`): refused.
- Accounting reconciliation (`opening + inflow − outflow = cash`) holds through the entire stress run.

## 2. Shared storage test resolution

`tests/jd-storage.spec.js` hard-coded an absolute fixture path under `/var/folders/.../T/opencode/`
that this environment does not create. That was a **test portability defect**, not a production
storage issue. The suite now generates the fixture HTML in `os.tmpdir()` at run time and uses its
`file://` URL. No assertion was changed, skipped or weakened, and no production storage behaviour was
touched. The suite now exits **0** (5/5). `tests/storage-manager.spec.js` also passes.

## 3. Economic progression reassessment (120 days, 100 seeds)

| Strategy | Tier 7 | Days to T5/T6/T7 (median) | Median cash | Median appointments | Grants |
| --- | --- | --- | --- | --- | --- |
| Routine (clean) | **90/100** | 54 / 63 / 76 | 100,348 | 587 | 194 |
| Premium (perfect, 1.35×) | 100/100 | 36 / 41 / 48 | 358,755 | 601 | 72 |
| Conservative | 100/100 | 68 / 78 / 92 | 71,548 | 533 | 0 |
| Aggressive | 24/100 | 34 / 44 / 56 | 0 | 135 | 792 |
| Marketing-heavy | 85/100 | 51 / 60 / 74 | 102,208 | 599 | 233 |
| Delegation-heavy | 0/100 | — (tier 3) | 24,148 | 445 (368 delegated) | 0 |
| Midnight-only | 0/100 | — (tier 1) | 0 | 0 | 1,100 |
| Low quality | 0/100 | — (tier 1) | 2,149 | 240 | 0 |

Findings:

- **Competent routine play now reaches Pore World** (90%), at median day 76; marketing-heavy 85% at
day 74; conservative 100% but slower (day 92); premium remains the fastest (day 48). Multiple viable
paths exist and quality still dominates.
- **Aggressive expansion is self-defeating** (24%, 792 grants): it overextends and repeatedly defers
  obligations. This is a documented strategic failure, not a soft-lock.
- **Delegation-only stalls at tier 3.** Delegated work pays 90%, halves tips and cannot set records;
  reputation growth is too slow for the tier-4 gate. Delegation is a support tool.
- **Midnight-only from day one earns nothing** because midnight appointments require tier 5; the UI
  states the requirement. **Low-quality play never progresses.**
- No strategy produced negative cash or an unreconciled ledger across 800 runs.

The 2.0.1 tuning (tier 6/7 at 22,000/34,000, late overhead 520/800/1,200) is retained; the 120-day
evidence supports it. No further balance change was made.

## 4. Playtime

Median routine completion is 587 appointments over 76 business days; premium is 601 over 48 days.
At 20–40 s of active extraction per appointment that is roughly **3–6 hours** of play for a routine
path and **3–5 hours** for premium, plus management time. These are estimates from scripted runs, not
human playtests. Early management features are available immediately (marketing at tier 1, technician
at tier 3), so no long grind precedes them.

## 5. Interface, storage and scope

- The six-entry header remains verified at 320–1920 px with no overlap, no horizontal overflow and
  hit-testable buttons; ≤430 px uses a six-column grid with 44 px targets.
- Save additions are three integers and one ≤30-entry integer log; no new storage keyspaces.
- Scope respected: no new expansions, campaigns, equipment, patient classes, accounts or services.

## 6. Remaining limitations

- No physical-device or human playtest. See `docs/dani-physical-device-checklist.md`.
- Delegation-only and midnight-only strategies are intentionally poor; the UI warns about the tier-5
  requirement but does not prevent the attempt.
- Performance figures are software-renderer measurements (see the release commit for the run).
