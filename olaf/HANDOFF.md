# OLAF Phase 2 handoff

Status: implementation complete, live benchmarking in progress. Nothing has been pushed or deployed.
Repository: `/Users/hmarquardt/junkdrawer`, branch `main`.

## Local commits

- `a41a053` — Phase 1 implementation (received from Codex).
- `374bff9` — Phase 2 contracts, staged architectures, expanded fixtures/dataset, diagnostic tooling, tests, UI.
- `8135728` — Deterministic hardening (grounding, applicability, rendering/severity guards), benchmark
  taxonomy fixes, Phase 2 report and this handoff.
- Phase 2.1 — Presets, result retention, archive intake diagnostics, local history, disputed-case
  review workspace, tests and operational documentation. The exact commit is the HEAD containing this
  file (`git log -1 --oneline`).

`8135728` is the Phase 2 code and results commit. A final documentation commit follows it; the exact
HEAD at handoff is `git log -1 --oneline`. Nothing has been pushed or deployed.

## What Phase 2 added

| Area | Files | Notes |
| --- | --- | --- |
| Stage contracts | `schemas/stages.v1.json`, `engine/stages.mjs` | Compile, adherence, inspection, preference, verify, plus a merged structured shape for Architecture B. Local `$ref`s are expanded for strict structured output. |
| Deterministic assessment | `engine/assessment.mjs`, `engine/adjudicate.mjs` | Equivalence promotion only with a substantive basis; evidence-contradicted statuses corrected; rendering-vs-unreadability guard; severity normalization; both-page-broken abstention; decision trace. |
| Architectures | `engine/pipeline.mjs` | A = preserved single pass, B = compile + structured pass, C = compile + adherence + inspection (+ preference only when it can decide), D = single pass + targeted native-resolution crop verification. Reverse runs map back to original candidate identities. |
| Verification | `engine/verify.mjs`, `ingestion/png.mjs` | Claims, grounded suggestions, auditable corrections, PNG crop without dependencies. |
| Providers | `providers/openai.mjs`, `providers/pricing.mjs`, `prompts/stages.mjs` | Stage calls, per-stage telemetry, list-price estimates for known snapshots, strict schemas. Credentials stay in the loopback process. |
| Dataset | `benchmarks/dataset.mjs`, `benchmarks/legacy.mjs` | 64 fixed-reference cases (16 legacy + 48 new), 16-case holdout, objective/subjective separation, equivalence and precedence traps. |
| Tooling | `benchmarks/verify.mjs`, `run.mjs`, `taxonomy.mjs`, `summary.mjs`, `compare.mjs` | Offline reference check, budgeted runner, error taxonomy, comparison report. |
| UI | `olaf.html`, `app.mjs` | Architecture selector; collapsible decision trace, compiled requirements and per-stage telemetry. |
| Server | `server.mjs` | `/olaf/stage` with same-origin, allowlist, size limits; images still resolve only inside the loopback provider. |

## Phase 2.1 operational readiness

Added without changing frozen fixtures, reference labels, measured Phase 2 results or architectures:

- **Presets** (`presets.mjs`, `app.mjs`): Accuracy (`gpt-6.2-sol` + A + reverse), Economy
  (`gpt-4.1-mini` + D), Diagnostic (current model + D + detailed/reverse) and Custom. Presets disable
  themselves when the required provider identifier is not configured; manual changes switch to Custom.
  Active configuration is always visible and repeated in the result summary.
- **Result retention**: completed results and exports survive request, scope, image and order changes.
  Only Clear task or a new evaluation replaces them.
- **Keyboard**: `Ctrl/Cmd+Enter` evaluates after confirmation; `Escape` cancels.
- **Archive intake report** (`ingestion/diagnose.mjs`): size, MIME/HTML counts, image dimensions,
  CID/Content-Location, assignments, recovered request, ambiguities and warnings; manual assignment
  remains available.
- **Local history** (`history.mjs`): optional IndexedDB summaries with hashes and telemetry, no images
  or archives; 200-record cap, 180-day prune, export and clear. Registered in `storage-manager.html`.
- **Disputed-case review** (`olaf-review.html`, `olaf/review.mjs`): imports a detailed benchmark JSONL,
  shows frozen reference vs model judgment, native-resolution images, evidence, defects/severity,
  trace, telemetry and reverse order; records independent adjudication separately in IndexedDB.

Tests: 46 Node tests, 16 workspace browser tests, 2 review browser tests, 64 offline references and
both compliance audits pass. No additional paid inference was used ($0 for Phase 2.1).

Operational procedures are in `README.md`; the completion summary is `docs/phase21-report.md`.

```sh
node --test olaf/tests/engine.test.mjs olaf/tests/phase2.test.mjs   # 42 passing
node node_modules/@playwright/test/cli.js test olaf/tests/workspace.spec.cjs  # 11 passing
node olaf/benchmarks/verify.mjs --quiet                            # 64 references, 0 failures
bash .agents/skills/junkdrawer-compliance-audit/scripts/audit.sh olaf.html
```

`OLAF_RUBRIC.md` is the authoritative supplied specification and remains untracked in this checkout;
request it from the maintainer if it is absent.

## Budget

Initial Phase 2 budget: $10. Estimated list-price spend across every Phase 2 run: **$1.63**.
The runner enforces a 95% threshold per invocation (`--budget-usd`, default 10) and stops paid
inference before crossing it. Raw JSONL and the ledger live outside the repository.

## Measured results (details in `docs/phase2-report.md`)

| Group | Valid | Objective | Overall | Stage | Reverse | $/eval |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Legacy 16, A, `gpt-4.1-mini` | 100% | 71.4% | 73.3% | 68.8% | 75.0% | $0.0030 |
| Dev 8, A, `gpt-4.1-mini` | 100% | 87.5% | 87.5% | 87.5% | 100% | $0.0030 |
| Dev 8, A, `gpt-5.4-mini` | 100% | 75.0% | 75.0% | 50.0% | 100% | $0.0109 |
| Dev 8, A, `gpt-6.2-sol` | 100% | 100% | 100% | 87.5% | 87.5% | $0.0322 |
| Holdout 16, A, `gpt-6.2-sol` | 100% | 75.0% | 75.0% | 81.3% | 93.3% | $0.0313 |

Architecture comparison on the economical model: A and D reach 87.5% objective and 87.5% stage;
B and C add calls and cost without accuracy gain. With the flagship, B abstained on the washed page;
D matched A's decisions at nearly the same cost and repaired the severe-page stage.

Recommended defaults: accuracy — `gpt-6.2-sol` + Architecture A; cost — `gpt-4.1-mini` + Architecture D.
Do not default to B or C. Acceptance targets were not met on the holdout; the report explains why and
does not adjust references after inference.

## Live benchmark artifacts (outside the repository)

- `/tmp/olaf-p2-baseline-mini.jsonl` — first Phase 1 reproduction with the original runner.
- `/tmp/olaf-p2-legacy-merged.jsonl` — final legacy 16 (includes the post-fix `severe` re-run).
- `/tmp/olaf-p2-models-merged.jsonl` — three-tier model comparison, Architecture A, dev 8.
- `/tmp/olaf-p2-arch-all-mini.jsonl`, `/tmp/olaf-p2-arch-all-flagship.jsonl` — architecture comparison.
- `/tmp/olaf-p2-holdout-merged.jsonl` — flagship holdout.
- `/tmp/berry-*.log`, `/tmp/berry-head-fails.txt` — Berry investigation evidence.

Raw observations stay outside the repository.

## Continuation instructions

1. Read `OLAF_RUBRIC.md`, `olaf/README.md` and `olaf/docs/phase2-report.md`.
2. Run the offline suite above; it never calls a provider.
3. To continue benchmarking, set `OLAF_MODELS` and run `olaf/benchmarks/run.mjs` with `--suite phase2`, an explicit `--architecture`, `--split` and `--budget-usd`. Use `olaf/benchmarks/compare.mjs` for tables.
4. Do not tune prompts against the `holdout` split. If prompts change, re-run dev first and holdout once.
5. Commit intended files only, locally. Do not push, deploy or publish results.

## Outstanding issues

See the "Remaining limitations" section of the report. The short version: no independent human adjudication, synthetic fixtures only, single-screen captures, and model perception still limits equivalence and severe-defect classification more than the deterministic engine does.

## Berry regression investigation

- OLAF Phase 2 changes only `olaf/`, `olaf.html` and `junk-drawer.json`. `ui-berry-3r-visual-evaluator.html`
  and its spec were last changed together in `49627a2` and are untouched in this phase.
- Current tree, all four Berry specs: 239 passed, 4 skipped, 9 failed — every failure in
  `tests/ui-berry-3r-visual-evaluator.spec.js`.
- The same spec alone on the current tree: 27 passed, 17 failed. The same spec alone in a clean
  worktree at `a41a053`: 28 passed, 16 failed, with a different failure set.
- Same code, different failure membership across runs and load levels ⇒ pre-existing order- and
  environment-sensitive flakiness, not an OLAF regression. No Berry file was modified.
- Earlier Phase 1 full-suite runs already failed in this spec; no clean-HEAD baseline of zero failures exists.
