# Dani the Pimple Popper 2.0 — Dani's Disgusting Day Spa

**Release date:** 2026-11-25 · **Baseline:** 1.4.0 (`c21283c`) · **Namespace:** `disgusting-day-spa`
**Content version:** 1.0.0 · **Financial rules:** v1 · **Schema:** 1

> Our business is booming. So are your pores.

## 1. What shipped

A fifth first-party, lazy-loaded module that turns the extraction simulator into a clinic-management
game without replacing it. Appointments are ordinary encounters: performing one opens the existing
extraction UI (same instruments, telemetry, records, WebGL2/Canvas paths) and settles a single receipt
when the case closes.

- **Business day loop:** queue → perform or delegate → settle → close day (rent, utilities, wages,
  maintenance, restock) → advance → deterministic next queue and business event.
- **Seven facility tiers** from The Spare Room to Pore World, each with real capacity, overhead,
  reputation requirements and a Midnight Wing at tier 5.
- **Appointments** generated from all installed campaigns by business seed + day + reputation +
  marketing; routine and specialty queues, concealed complications, personality expectations, quotes
  and estimated costs.
- **Interactive and delegated work.** Technicians resolve routine cases deterministically; legendary
  and boss cases must be performed personally. Delegated work never sets extraction records.
- **Finance:** integer Pore Bucks, append-only bounded ledger with stable ids, pricing presets,
  purchases, payroll, supplies, maintenance, marketing, events, assistance and reports.
- **Satisfaction** with an itemised factor breakdown, stars, tips, returning customers, referrals and
  reputation; **customer reviews** generated from actual outcomes.
- **World Book integration:** the spa reads unified records/trophies; interactive appointments can
  set records, delegated ones cannot; the trophy display adds a small demand bonus.
- **21 business achievements**, the Andi crossover, business events and endgame legendary referrals.
- **Dashboard** (Today, Clinic floor plan, Shop, Team, Growth, Books, Records) at 360×640 upward.

## 2. Architecture

```
danny/day-spa/
  pack.json       content: facilities, equipment, supplies, roles, personalities, marketing,
                  events, legendary appointments, review lines, achievements, one route mode
  business.js     headless engine: money, prices, generation, settlement, satisfaction,
                  day close, purchases, staff, events, achievements, reporting
  expansion.js    presentation + appointment-session bridge; imports world-book for receipts
```

The business engine has no DOM, renderer or simulation imports. It receives a plain context
(`pack`, `pool`, `legends`) and returns receipts. The expansion module builds that context from the
content registry, calls `replayEncounter` for an appointment, and after completion reads
`world.lastEncounter()` — the immutable snapshot and new records — then settles.

## 3. Financial rules (v1)

- Currency: integer Pore Bucks. No real money, accounts, purchases or paid dependencies.
- Revenue: appointment price × quality factor (perfect 1.05, clean 1.0, rough 0.85, failed 0.4),
  plus tips from satisfaction, plus event and campaign effects.
- Costs: per-appointment supplies/equipment/cleaning; daily rent, utilities, maintenance, wages;
  purchases, training, marketing and events. Supplies are consumed per target; midnight cases also
  consume spectral and environmental media.
- Prices: namespace base × tier multiplier × pricing preset (budget 0.8 → legendary 2.0) ×
  personality bias, rounded to 10 PB. Higher prices reduce demand; they do not guarantee profit.
- Cash never goes negative. A shortfall is posted as a deferral, triggers reputation loss and a
  discounted recovery queue; a fictional grant (300 PB, once per 10 days) is available under 300 PB.

## 4. Transaction integrity

- Every movement is `post(id, kind, amount)`; a repeated id is a no-op. Appointment receipts use
  `d<day>:<appointment>`; payroll/rent/utilities use `<day>-<kind>`; purchases use typed ids.
- Receipts are immutable and capped at 40; re-entering a completed appointment returns the stored
  receipt and moves no money (covered by the suite).
- Day close is idempotent (`closedDay` plus ledger ids), so an interrupted close can be retried.
- Inventory is clamped at zero, purchases are guarded by tier and cash, and equipment cannot be
  destroyed by an event (maintenance lowers condition, then restores it at close).
- The whole spa state is bounded and validated by `progression.validSpa` inside the existing
  current/previous checkpoint transaction. Corrupt saves fall back to the previous checkpoint.

## 5. Economic balance (headless batch runs)

Simulated with the real pack, a 5-encounter pool and four strategies over 50 business days
(seed 1234):

| Strategy | Tier | Cash | Appointments | Notes |
| --- | --- | --- | --- | --- |
| Routine, clean quality | 6 | 42,027 PB | 344 | steady, no marketing |
| Perfect quality | 7 | 3,694 PB | 330 | reached tier 7, heavy capex |
| Premium pricing, perfect | 7 | 141,166 PB | 324 | best margin path |
| Rough quality | 1 | 27,747 PB | 400 | reputation never unlocks tiers |

Pore World is reachable by day 45 in a reinvesting run. Multiple paths are viable; rushed play stalls
because reputation, not cash, gates expansion. The first upgrade is affordable in the first two days.

Tuning defects found and fixed by the batch runs: reversed capacity clamp (12 appointments at tier 1),
and an auto-restock policy that bought every catalogue item daily and starved profitable clinics.

## 6. Verification

`tests/dani-day-spa.cjs` covers lazy loading, deterministic queues, integer ledger and duplicate
prevention, pricing/costs, equipment and supply gates, all seven tiers, staffing and delegation,
satisfaction/reviews, day-close and payroll idempotency, recovery, events, achievements, one complete
interactive appointment with exactly one receipt, day advancement, session and receipt persistence,
checkpoint recovery, offline dashboard, 360×640, WebGL2 and Canvas. Existing suites re-run after this
release: `danny-popper`, `dani-pore-explorer`, `dani-midnight-clinic`, `dani-world-book`,
`dani-release`, Andi (8/8), storage heuristics (9/9).

## 7. Known limitations

- Appointments use authored encounters from the installed packs; procedural spa-only encounter
  generation is represented by the deterministic queue, not new reservoir generators.
- Weekly/monthly payroll, tax and employment-law simulation are deliberately out of scope.
- Delegated outcomes are intentionally coarse (skill, facility quality, complexity and a deterministic
  jitter), and cannot set extraction records.
- No physical iOS/Android device verification and no human playtest. Outstanding: install/upgrade from
  1.0.1, 1.1, 1.3 and 1.4 preserving records and business state; finger scanning without page scroll
  during a spa appointment; frame budget and haptics on the largest legendary appointment; offline
  resume of an active appointment; the 360×640 dashboard on hardware.
- Software-renderer frame timings are not claims about physical-phone performance.

## 8. Version 2.0 encounter-result contract

The spa consumes exactly the 1.4 contract: encounter, patient class, complexity, status, quality,
releases/volume, equipment, duration, precision, discovery, materials, scoring rules and rules
version, plus new record metrics. A future Day Spa business system can derive satisfaction, revenue,
costs, reputation, specialist bonuses and staff efficiency from it without touching the simulation.
