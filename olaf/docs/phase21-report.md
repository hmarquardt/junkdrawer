# OLAF Phase 2.1 — operational readiness

Continuation from Phase 2 HEAD `c6e00bb`. Scope: operational interface, named presets, archive intake
diagnostics, local evaluation history, disputed-case review, and regression tests. No architecture
redesign and no paid inference. Frozen fixtures, reference labels and Phase 2 measured results are
unchanged.

## Delivered

| Area | Implementation |
| --- | --- |
| Result retention | A completed result and its exports stay visible when the request, scope, candidate order or images change. Only **Clear task** or starting another evaluation removes it. |
| Presets | Accuracy (`gpt-6.2-sol`, A, reverse), Economy (`gpt-4.1-mini`, D), Diagnostic (current model, D, detailed + reverse), Custom. Presets only offer identifiers reported by the local server; unavailable presets are disabled. Manual changes switch to Custom. |
| Active configuration | Shown above the provider controls and repeated in the result summary. |
| Keyboard | `Ctrl/Cmd+Enter` evaluates after the confirmation gate; `Escape` cancels. |
| Archive diagnostics | `ingestion/diagnose.mjs` builds a pure report shown after MHTML import: archive size, MIME/HTML part counts, image bytes and dimensions, CID/Content-Location, assignments, recovered request, ambiguities and warnings. Manual assignment remains available. |
| Local history | `history.mjs` stores bounded summaries in IndexedDB (`olaf-history`): id, timestamp, request/image hashes, rubric, provider, model, architecture, preset, winner/stage, confidence, evidence, uncertainty, latency, cost, reverse consistency. No screenshots or archives. 200-record cap, 180-day pruning, opt-in auto-save, export and clear. |
| Disputed-case review | `olaf-review.html` + `olaf/review.mjs` import a local benchmark JSONL, show frozen references, native-resolution images, model evidence/defects/severity, trace, telemetry and reverse order. Independent adjudication is stored separately (`olaf-review`) with reviewer, verdict, notes, export and clear. It never edits `dataset.mjs`. |
| Storage registry | `storage-manager.html` records the history/review databases and the auto-save preference. |
| Security | Loopback-only server, explicit asset allowlist (all committed synthetic fixtures, no tests or private files), inert archive parsing preserved. Review files are read in the browser and never uploaded. |

## Verification

- `node --test olaf/tests/engine.test.mjs olaf/tests/phase2.test.mjs olaf/tests/phase21.test.mjs` — 46 passing.
- Playwright workspace and review suites — 18 passing (16 workspace, 2 review).
- `node olaf/benchmarks/verify.mjs --quiet` — 64 references, 0 failures.
- Compliance audit — 0 errors, 0 warnings for both `olaf.html` and `olaf-review.html`.
- Additional paid inference: **$0** (Phase 2.1 total; no provider calls were required).
- Frozen Phase 2 benchmark data, holdout labels and results were not modified.

The exact Phase 2.1 commit is the HEAD containing this report (`git log -1 --oneline`).

## Operational notes

- Presets depend on `OLAF_MODELS`. With the default single-model server configuration, Accuracy is
  disabled and Economy uses the configured `gpt-4.1-mini`; Diagnostic and Custom remain available.
- History is optional and off by default. It deliberately excludes screenshots, archives, raw source
  text and credentials. Export before clearing if records matter.
- The review workspace requires a detailed benchmark JSONL (`run.mjs --details`). Raw benchmark files
  and independent adjudications stay outside the repository unless separately authorized.
- The first authorized archive procedure is documented in `README.md`: import locally, inspect the
  intake report, confirm or type the request, assign images manually when needed, inspect crops,
  evaluate with Diagnostic, and only then design a synthetic reproduction and adapter.
