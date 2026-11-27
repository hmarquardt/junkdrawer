# OLAF Phase 2 — accuracy, model calibration and perception hardening

Rubric: OLAF 1.1 (`../OLAF_RUBRIC.md`). Phase 2 started from local commit `a41a053`.
All inference used synthetic, authored fixtures. Raw benchmark JSONL stayed outside the repository.
Estimated spend is list-price telemetry from the provider; it excludes account discounts and taxes.

## 1. Method

- The deterministic engine was exercised offline against all 64 constructed references before any
  live call (`node olaf/benchmarks/verify.mjs`). References were written from the fixture pixels and
  the rubric, not from model answers.
- The original 16 cases remain in `benchmarks/cases.mjs` with unchanged requests, images and expected
  decisions. `benchmarks/legacy.mjs` adds the requirement/defect facts implied by their construction.
- 48 new cases cover clipping at four magnitudes, subtle/severe/intentional overlap, legitimate
  ellipsis, three contrast levels, disabled states, whole-page unreadability, equivalent radii and
  colour families, missing and offscreen components, hidden behavior, explicit requirements against
  polish or catastrophic defects, equal-quality ties, valid alternative layouts and mirrored
  position-bias traps. 16 new cases are a holdout that was not used to refine prompts.
- Objective cases have a fixed decision. Subjective preference cases record requirement/defect facts
  but no fixed decision. Equivalence cases assert that both sides are compliant.
- Reverse-order runs are mapped back to original candidate identities before comparison. A model
  disagreement is reported, never converted into a Tie.

## 2. Baseline reproduction (Architecture A, `gpt-4.1-mini`)

Same 16 cases, reverse verification, one repeat, current deterministic engine. The first pass had one
structurally invalid run (`severe`: the model marked a hidden-behavior requirement as visible) and one
invalid run caused by repeated request excerpts. Both are now corrected deterministically
(applicability coercion, duplicate and ungrounded excerpt removal). The `severe` row below is the
post-fix re-run; all other rows are from the same configuration.

| Metric | Result |
| --- | ---: |
| Structurally valid runs | 16 / 16 (100%) |
| Objective decision agreement | 10 / 14 (71.4%) |
| Overall fixed-reference agreement | 11 / 15 (73.3%) |
| Deciding-stage agreement | 11 / 16 (68.8%) |
| Evidence factuality (fixture vocabulary) | 16 / 16 (100%) |
| Reverse-order consistency (all runs) | 12 / 16 (75.0%) |
| Abstentions | 0 |
| Mean latency | 15.6 s |
| Estimated cost | $0.0030 per evaluation; $0.044 total |

Failure analysis: four decision failures were Ties where a constructed defect was never reported
(`overlap`, `clipping`, `contrast`) or a 90 px footer misalignment was read as compliant
(`alignment`). `imagery` chose the correct side but through preference rather than the defect stage.
The severe-defect exception now works: the washed page produced a derived page-broken contrast defect
from the model's own "blank/faint" render evidence and lost to the readable side.

## 3. Model comparison on the development subset

Eight development cases (adherence, severe defect, subtle defect, offscreen component, hidden/later
state, adherence-over-polish, genuine tie, mirrored position), Architecture A, reverse verification,
one repeat. Prices are list prices; the intermediate model was chosen as the cheapest reasoning-capable
snapshot.

| Metric | `gpt-4.1-mini` | `gpt-5.4-mini` | `gpt-6.2-sol` |
| --- | ---: | ---: | ---: |
| Structurally valid runs | 100% | 100% | 100% |
| Objective decision agreement | 87.5% (7/8) | 75% (6/8) | 100% (8/8) |
| Overall fixed-reference agreement | 87.5% | 75% | 100% |
| Deciding-stage agreement | 87.5% | 50% | 87.5% |
| Evidence factuality | 100% | 100% | 100% |
| Reverse-order consistency | 100% | 100% | 87.5% |
| Abstentions | 0 | 1 | 0 |
| Mean latency | 14.9 s | 10.6 s | 28.9 s |
| Estimated cost | $0.0030 | $0.0109 | $0.0322 |

Two invalid runs in the first model pass (ungrounded excerpts) were removed by the grounding guard and
re-run; every row above is a valid structural result. Observations: the intermediate `gpt-5.4-mini`
did **not** outperform the economical baseline. It abstained once, produced more false-positive defects
and was less consistent in requirement status. The flagship was the only model at 100% decision
agreement, at roughly ten times the baseline cost and twice the latency. All three models still make
requirement-status mistakes on equivalence (three semantic-equivalence errors for the flagship) even
when the final decision is correct.

## 4. Architecture comparison

Same eight development cases, `gpt-4.1-mini`, reverse verification. All four architectures return
structurally valid results after the guards; architecture A is the preserved single pass.

| Architecture | Objective | Overall | Stage | Evidence | Reverse | Calls/case | Mean latency | $/eval |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A · single pass | 87.5% | 87.5% | 87.5% | 100% | 100% | 2 | 14.9 s | $0.0030 |
| B · structured perception | 87.5% | 87.5% | 75% | 100% | 100% | 4 | 20.4 s | $0.0048 |
| C · staged evaluation | 87.5% | 87.5% | 75% | 100% | 87.5% | 6–8 | 22.7 s | $0.0059 |
| D · targeted verification | 87.5% | 87.5% | 87.5% | 100% | 100% | 2–4 | 16.0 s | $0.0033 |

On a four-case flagship subset (`gpt-6.2-sol`):

| Architecture | Objective | Stage | Reverse | $/eval |
| --- | ---: | ---: | ---: | ---: |
| A | 100% | 100% | 75% | $0.0316 |
| B | 75% | 75% | 100% | $0.0311 |
| C | 100% | 75% | 100% | $0.0377 |
| D | 100% | 100% | 75% | $0.0323 |

Findings:

- Structured (B) and staged (C) perception did not improve decision accuracy at the economical tier.
  B and C both missed the subtle overlap. C's extra preference stage did not rescue it and added cost.
- With the flagship, B **abstained** on the washed page: requirement uncertainty produced REVIEW where
  A/D correctly applied the severe-defect exception.
- D's verification is targeted and cheap: it ran only for pages with a failed-rendering claim or an
  uncertain requirement. It repaired `/page-washed` from `rendering`/`preference` to `disqualifiers`
  and matched A's decisions at almost the same cost.
- Compiling requirements into a separate text-only call did not by itself improve grounding; all
  architectures produced occasional ungrounded or duplicate excerpts, which the engine now drops.

## 5. Holdout results

Sixteen cases were held out from prompt refinement. One run, Architecture A, `gpt-6.2-sol`, reverse
verification.

| Metric | Result |
| --- | ---: |
| Structurally valid runs | 16 / 16 (100%) |
| Objective decision agreement | 12 / 16 (75.0%) |
| Overall fixed-reference agreement | 12 / 16 (75.0%) |
| Deciding-stage agreement | 13 / 16 (81.3%) |
| Evidence factuality | 8 / 10 decisive runs (80.0%) |
| Reverse-order consistency | 14 / 15 decided runs (93.3%) |
| Abstentions | 1 (the expected both-page-broken REVIEW) |
| Mean latency | 27.2 s |
| Estimated cost | $0.0313 per evaluation |

Constructed single-difference cases: 12 / 13 (92.3%). The three fixed Tie cases
(`holdout-color-family`, `holdout-position-rounded`, `holdout-both-missing`) were all decided as a
preference for one side, so 0 / 3. This is the main reason the holdout misses the 90% target. Two of
those Ties encode a strict "equally good" reading; the rubric also allows a concrete palette or shape
difference to justify a preference, so those references are arguably stricter than the rubric. They
were fixed before holdout inference and were not revised afterwards.

The remaining substantive miss is `holdout-overlap-vs-clip`, a provisional severity/impact comparison
between two major defects. All other constructed adherence, defect, applicability and precedence cases
were decided correctly.

## 6. Error taxonomy and failure analysis

Each unsuccessful run is labelled with one or more categories from the standard taxonomy:
requirement omission, invented requirement, applicability error, semantic-equivalence error, missed
defect, false-positive defect, incorrect defect severity, visual hallucination, preference
disagreement, decision-precedence violation, position inconsistency, invalid output, unsupported
explanation. Labels are derived deterministically by `benchmarks/taxonomy.mjs` from the fixed reference
and the model's own observation; abstentions and invalid outputs are labelled separately.

Aggregate counts (final taxonomy over stored observations):

- Economical baseline, legacy 16: `missed_defect` 5, `position_inconsistency` 4,
  `decision_precedence_violation` 4, `semantic_equivalence_error` 3.
- Flagship, holdout 16: `missed_defect` 3, `unsupported_explanation` 3, `preference_disagreement` 3,
  `incorrect_defect_severity` 2, `invented_requirement` 2, `applicability_error` 2,
  `semantic_equivalence_error` 2, `position_inconsistency` 1, `decision_disagreement` 1,
  `false_positive_defect` 1.
- Flagship, development 8: `semantic_equivalence_error` 3, `invented_requirement` 2,
  `position_inconsistency` 1, `missed_defect` 1, `applicability_error` 1.

What the taxonomy shows, independent of model tier:

1. **Missed defects dominate the economical tier.** Overlap, clipping and low-contrast paragraphs are
   read as "no meaningful difference", producing Ties. The engine cannot recover a defect the model
   never reports.
2. **Severe-defect precedence is now engine-correct.** When the model describes a page as blank,
   washed or faint but labels rendering as failed and reports no defect, the engine converts the
   rendering label and derives a page-broken contrast defect from that evidence, so the readable side
   wins. This fixed the Phase 1 `severe` failure and the `/page-washed` development case.
3. **Equivalence remains a model problem.** Even when both implementations satisfy an unspecified
   radius or colour-family request, models mark one side missing. The engine promotes `missing` to
   `alternative` only when the stage explicitly records a reasonable alternative and a substantive
   basis, and it demotes `alternative` when the model's own evidence describes the element as absent or
   enabled. It does not invent equivalence from free text.
4. **Applicability and grounding are engine-correct.** Hidden behavior, later screens, duplicate and
   ungrounded excerpts are coerced or dropped before adjudication, with an audit trail. This removed
   the only structural invalidations in the baseline suite.
5. **Position bias persists at the model level.** Reversing candidate order changed decisions in
   4/16 legacy runs for the economical baseline and 1/8 development runs for the flagship. Disagreement
   is surfaced and lowers confidence; it is never turned into a Tie.

## 7. Acceptance criteria

| Target | Measured | Status |
| --- | --- | --- |
| 100% deterministic precedence test compliance | 64 / 64 offline references, 0 failures | met |
| 100% structurally valid final results | 100% in legacy, model, architecture and holdout groups after the guards | met |
| ≥95% agreement on unambiguous objective cases | 100% (8/8) flagship dev; 75% (12/16) flagship holdout; 71.4% (10/14) economical legacy | not met |
| ≥90% overall fixed-reference agreement | 100% flagship dev; 75% flagship holdout; 73.3% economical legacy | not met |
| ≥95% deciding-category agreement | 87.5% flagship dev; 81.3% flagship holdout; 68.8% economical legacy | not met |
| ≥98% reverse-order consistency | 87.5% flagship dev; 93.3% flagship holdout; 75% economical legacy | not met |

The targets were not achieved on the full fixed set. The best configuration reached 100% on the eight
development cases but generalised to 75% on the holdout, where all three fixed Ties and one provisional
severity comparison failed. These numbers are reported without removing difficult cases or revising
references after inference.

## 8. Recommended default

- **Accuracy first:** `gpt-6.2-sol` with **Architecture A**. It matched or beat every other
  architecture on decisions and stage, had 100% structural validity and evidence factuality, and is the
  simplest path. Estimated $0.032 and ~29 s per evaluation.
- **Cost first:** `gpt-4.1-mini` with **Architecture D**. It matched A's decisions on the development
  set, improved stage agreement from 75% to 87.5% by verifying failed-rendering and uncertain claims,
  and costs about $0.0033 per evaluation. Use A when latency matters most.
- **Do not default to B or C.** They added cost and latency without accuracy gains at the economical
  tier, and B abstained on a severe page with the flagship. Keep them as comparison baselines.
- Keep the deterministic guards regardless of model: they removed every structural invalidation and
  fixed the severe-defect exception, applicability and grounding failures observed in Phase 1.
- Continue to surface reverse-order disagreement explicitly. The flagship disagreed on
  `holdout-purple-missing-vs-broken`; lowering confidence is preferable to forcing a Tie.

## 9. Remaining limitations

- No independent human adjudication. References are constructed but authored by the same agent that
  built the fixtures.
- Three fixed Ties (`holdout-color-family`, `holdout-position-rounded`, `holdout-both-missing`) apply a
  strict "equally good" reading. The rubric allows a concrete palette or shape difference to justify a
  preference, so the references may be stricter than the rubric; they were not revised after inference.
- `holdout-overlap-vs-clip` is a provisional severity/impact judgment between two major defects.
- Synthetic single-screen captures only; no real Feather or DAS archives, no responsive states, no
  multi-screen flows.
- The benchmark rewards rubric-faithful decisions on constructed differences. It cannot measure
  whether a human reviewer would agree on genuinely ambiguous aesthetic calls.
- Some perception failures remain (missed subtle clipping/overlap, equivalence misreads). The
  deterministic guards correct contradictions the model itself reports; they cannot recover content
  the model never saw.
- Contrast and clipping have no pixel-level measurement. Where measured misses concentrate in small
  text and container overflow, conventional computer-vision assistance is justified: text bounding
  boxes versus container bounds, line-height/overflow detection, and WCAG contrast sampling of text
  regions. They should supplement, not replace, contextual judgment.
- Cost estimates depend on published list prices and reported token counts. Unknown models return
  null rather than an invented figure.

## 10. Berry regression investigation

Berry's HTML and specs were last changed together in `49627a2`; Phase 2 changed only `olaf/`,
`olaf.html` and `junk-drawer.json`.

- All four Berry specs on the current tree: 239 passed, 4 skipped, 9 failed, every failure in
  `tests/ui-berry-3r-visual-evaluator.spec.js`.
- That spec alone on the current tree: 27 passed, 17 failed.
- That spec alone in a clean worktree at `a41a053`: 28 passed, 16 failed, with a different failure set.
- Same code, different failing membership across runs and load levels. The failures are pre-existing,
  order- and environment-sensitive, and are not attributable to OLAF, shared infrastructure changes or
  a seed regression. No Berry file was modified.

The extra failure mentioned in the brief is therefore environmental/order-dependent. A reliable
Berry baseline would require isolating storage state and stabilising the visual-evaluator suite; that
is outside Phase 2 scope.

## 11. Cost ledger

Estimated list-price spend across all Phase 2 runs: **$1.63** of the $10 budget. The most expensive
single group was the flagship holdout run ($0.51 plus $0.05 of re-runs). Raw JSONL and the ledger live
outside the repository. No paid inference was needed after the budget review.

## 12. Local commits

Phase 2 implementation: `374bff9`. Deterministic hardening and benchmark evidence: `8135728`.
Nothing was pushed or deployed. The exact HEAD at handoff is `git log -1 --oneline`.
