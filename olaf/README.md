# OLAF comparison desk

OLAF compares two screenshots with the original design request using version 1.1 of the supplied [visual rubric](../OLAF_RUBRIC.md). The browser workspace, CLI and synthetic benchmark runner call the same evaluation engine.

## Launch

From the Junkdrawer repository root, use Node 22.12 or later and a current desktop browser. The app and local server have no npm runtime dependencies.

```sh
node olaf/server.mjs
```

Open **http://127.0.0.1:4173/olaf.html**. Pass a different port as the first argument if needed. The server accepts the numeric loopback hostname. An HTTP origin supports the ES modules, JSON imports, clipboard and Web Crypto APIs used here.

1. Choose **Load sample** for a complete local demonstration. For your own task use **Browse files**, drop an archive or images, or paste an image. Multiple loose images fill empty slots in selection order. Extras appear in the image pool. An archive starts a separate task.
2. Edit the request, inspect the assignments and choose the capture scope if known. To paste into a particular side, focus its panel first. **Remove** releases its assignment. **Clear task** discards all in-memory originals, crops and results.
3. For a screenshot of the entire task, open **Inspect / crop**, expand **Crop candidate regions**, then drag a rectangle or enter original pixel coordinates. Choose **Use as Left** and **Use as Right** for the respective regions. **Fit**, **Zoom** and **Fullscreen** work on the preserved original.
4. Choose provider and model. **Verify in reverse order** makes a second independent observation. **Diagnostic inspection** asks the provider for more detailed locations and alternate interpretations and expands the diagnostic view.
5. Review the request, thumbnails and assignment summary. Check the confirmation box and choose **Evaluate pair**. Changes invalidate confirmation. **Cancel evaluation** stops waiting and aborts the local transport. **Retry evaluation** starts a fresh run after an error. A provider can still charge for work already started.
6. Read the explanation, decisive evidence, requirements, defects and limitations. Use **Copy Why**, **Copy JSON** or **Export evaluation** to keep a result. An export contains observations and may quote the request. Keep private exports outside the repository.

### Presets and result retention

The Evaluation panel offers four named presets. Only configured model identifiers are selectable; an
unavailable preset is disabled with the required identifier in its label.

| Preset | Configuration |
| --- | --- |
| Accuracy | `gpt-6.2-sol`, Architecture A, reverse verification |
| Economy | `gpt-4.1-mini`, Architecture D, no reverse pass |
| Diagnostic | Current model, Architecture D, detailed evidence, reverse verification |
| Custom | Manual provider, model and architecture selection |

The active configuration is shown above the provider controls and repeated in the result summary.
Changing a model, architecture or verification option switches the preset to Custom. `Ctrl/Cmd+Enter`
evaluates after the confirmation box is checked; `Escape` cancels a running evaluation. A completed
result and its exports remain visible when the request or candidate order changes. Only **Clear task**
or starting another evaluation removes it.

The archive intake report appears after an MHTML import and lists archive size, MIME and HTML part
counts, image resources with dimensions, Content-ID and Content-Location associations, recovered
request text, candidate assignments, ambiguities and parser warnings. Manual assignment stays available
from the image pool whenever automatic extraction is incomplete.

### Local evaluation history

The optional history is local-only and off by default. **Save current evaluation** stores a summary
record in IndexedDB; **Save each completed evaluation automatically** opts in to automatic saving. A
record contains the evaluation id, timestamp, request and image hashes, rubric version, provider, model,
architecture, preset, winner, decision stage, confidence, evidence, uncertainty, latency, estimated
cost and reverse-order consistency. It never stores screenshots, archives, tokens or API keys. History
is capped at 200 records and pruned after 180 days, and offers JSON export and explicit clear.

### Providers and credentials

**Mock** runs entirely in the browser. It recognizes the built-in exhibit pair by original SHA-256 and request text, handles swaps, and returns REVIEW for unknown input. It exercises the real adjudicator with scripted observations.

**OpenAI** is available when the Node process inherits a valid `OPENAI_API_KEY`. Supply it through your existing environment or secret manager before starting the server. Selecting the provider and evaluating sends the request, capture scope and two full-resolution raster images to OpenAI. The browser receives only the allowed model names and observation response. Ordinary static hosting supports mock mode.

The default live model is `gpt-4.1-mini`. Set `OLAF_MODELS` to a comma-separated allowlist of accessible vision models supporting Chat Completions and strict structured outputs. Restart the server after configuration changes. Models are operator-configured and may still return an availability or capability error. A call times out after 90 seconds. The live API accepts a combined JSON body of up to 48 MiB including Base64 overhead.

Telemetry records the actual model snapshot, observed latency and reported usage. Cost estimates for the default model use standard input, cached-input and output prices of $0.40, $0.10 and $1.60 per million tokens. For one configured model, `OLAF_USD_PER_MILLION=input,output` overrides rates using an uncached estimate. Unknown prices are null. Estimates exclude account-specific discounts and taxes. [Model pricing](https://developers.openai.com/api/docs/models/gpt-4.1-mini)

### CLI and batches

The CLI reads a canonical JSON manifest and two explicitly named local image files in Left, Right order. It checks MIME, byte count and SHA-256 before inference. Output goes to stdout. Add `--model gpt-4.1-mini` for live inference or `--diagnostic` for detailed observations. Scripts can import `evaluate()` directly to process an application-specific batch.

```sh
node olaf/cli.mjs --reverse olaf/fixtures/task.json \
  olaf/fixtures/images/standard.png olaf/fixtures/images/red.png
```

## Architecture and security

| Layer | Responsibility |
| --- | --- |
| `ingestion/mime.mjs` | Byte-preserving recursive MIME parsing, folded headers, nested boundaries, declared charsets, quoted-printable, Base64 and binary parts. Records partial recovery and resolves CID and location references locally. |
| `ingestion/archive.mjs` | The browser adapter reads text and raster references from inert template content in a detached document. It recognizes generic request headings, textareas and explicit image labels. Ambiguity leaves assignments available for correction. |
| `ingestion/images.mjs` | Sniffs and decodes original raster bytes, records dimensions and a digest, and produces optional lossless pixel crops with parent ID and coordinates. |
| `ingestion/diagnose.mjs` | Pure archive intake report: sizes, part and document counts, image dimensions, CID/location associations, assignments, recovered request and ambiguities. |
| `presets.mjs`, `history.mjs` | Named configurations resolved only against configured model identifiers; optional IndexedDB evaluation history with hashes, telemetry, evidence, export, clear, a 200-record cap and 180-day pruning. |
| `review.html`, `review.mjs` | Local disputed-case review workspace. Imports a benchmark JSONL, shows frozen references and model observations, and records independent adjudication separately in IndexedDB. |
| `schemas/` and `engine/contracts.mjs` | Versioned task, paired perception, stage and result JSON Schemas. Runtime checks also enforce identity, request grounding and requirement applicability. Both sides can contain identical pixels with independent assignment IDs. |
| `prompts/` and `providers/` | Architecture A uses one paired multimodal call. Phase 2 stages compile, adherence, inspection, preference and verification prompts live in `prompts/stages.mjs`; the OpenAI adapter returns structured data, model, usage and per-call cost. Adapters receive the canonical task, model, diagnostic option, crop regions and abort signal. Only the adapter resolves image IDs to bytes. |
| `engine/adjudicate.mjs` | Checks rendering, explicit visible adherence, severity and comparative defect impact, then preference and genuine ties. Accepted alternatives count as met. Unknown evidence can force REVIEW. Both page-broken sides abstain. Deterministic explanation generation uses the decisive evidence pair and emits a decision trace. |
| `engine/evaluate.mjs` | Validates observations and result consistency, checks the explanation, measures calls and maps reversed assignments back to original IDs. Disagreement is displayed and lowers confidence. |
| `engine/stages.mjs`, `engine/assessment.mjs` | Validate compiled requirements, adherence results, inspection and verification against versioned stage contracts. Normalize equivalence and severe-defect precedence from explicit evidence before adjudication, and assemble the canonical observation. |
| `engine/verify.mjs` | Build targeted claims, validate grounded verification answers, and apply only explicit corrections with an audit trail. |
| `engine/pipeline.mjs` | Architecture A (single pass), B (compiled requirements plus one structured pass), C (separate adherence and inspection, preference only when it can decide), and D (initial evaluation plus native-resolution crop verification). Reverse runs are mapped back to original candidate identities with per-stage order diagnostics. |
| `ingestion/png.mjs` | Dependency-free PNG decode, crop and encode for Node-only native-resolution verification regions. Sources are never modified. |
| `app.mjs`, `style.css`, `../olaf.html` | Input, inspection, confirmation, architecture selection and presentation. Collapsible decision trace, compiled requirements and stage telemetry. User and model strings go into text nodes. Task content and image object URLs live only in memory. |
| `server.mjs` | Loopback-only static allowlist and authenticated upstream transport for `observe` and `stage`. Validates Host, request Origin, JSON media type, allowed model and stage, embedded raster input and stage payload sizes. Limits concurrent live calls and response error detail. |
| `benchmarks/`, `fixtures/`, `tests/` | 64 authored reference cases in `dataset.mjs`, Chrome-rendered screenshots, synthetic MIME archives, offline reference verification, error taxonomy, comparison reports and independent browser, review and engine tests. |

Berry's visual evaluator supplies the precedent for byte-oriented transfer decoding, CID/location resolution, stable image manifests, explicit image parts, the user-role JSON instruction, cancellation, and per-call telemetry. Its adapters and OpenRouter client are inline and coupled to Berry state. OLAF adapts those conventions into independent modules. Its comparison rubric, credential boundary and in-memory lifetime are specific to this application. Berry code and storage remain separate.

The parser never navigates to an archive location, renders an archived page or fetches a missing image. It accepts up to 64 MiB per file, 2,048 MIME nodes and 12 levels of nesting. Embedded scripts, styles, SVG, frames and unsupported MIME bodies do not become display resources. Invalid parts yield warnings where recovery is possible. An archive containing application source or linked pages alone can require manual screenshots. Cropping is explicit and leaves the source intact. Zoom changes display scale only. The provider controls any internal image tokenization.

Static assets have no credentials. The local server serves an explicit file list, restricts the browser with CSP and never logs request bodies, headers or responses. It has no directory listing or CORS permission for external origins. On the canonical public Junkdrawer page the existing Analytics Lite script can emit its ordinary pageview on direct or index navigation. Local evaluations have no analytics. OLAF sends no task events or evaluation telemetry to JunkStats. Do not expose the local relay to a network or publish raw results, real archives, credentials or screenshots.

The public-domain photograph in the illustration benchmark is the official Grace Hopper portrait by James S. Davis, U.S. Navy, distributed in Matplotlib's sample data. The exhibit page, drawing and other image variants are authored fixtures. [Portrait record](https://commons.wikimedia.org/wiki/File:Grace_Hopper.jpg) · [Source JPEG](https://github.com/matplotlib/matplotlib/blob/main/lib/matplotlib/mpl-data/sample_data/grace_hopper.jpg)

## Testing and benchmarking

From the repository root, use the existing Playwright installation and the real Chrome channel. For a fresh checkout install the test-only packages with `npm install --no-save --package-lock=false @playwright/test playwright` and install Chrome if needed.

```sh
node --test olaf/tests/engine.test.mjs olaf/tests/phase2.test.mjs olaf/tests/phase21.test.mjs
node node_modules/@playwright/test/cli.js test olaf/tests/workspace.spec.cjs olaf/tests/review.spec.cjs
bash .agents/skills/junkdrawer-compliance-audit/scripts/audit.sh olaf.html
node olaf/fixtures/render.mjs
node olaf/benchmarks/verify.mjs
node olaf/benchmarks/run.mjs --model mock --case button --reverse --repeat 2
```

The render command regenerates the committed 700 × 390 screenshots, digest manifest and demo task from the HTML source using the local Chrome and fonts. Run it when changing fixtures; original legacy hashes are stable. To run all 16 legacy cases with reverse verification and retain observations for private review:

```sh
node olaf/benchmarks/run.mjs --model gpt-4.1-mini --reverse --details > /tmp/olaf-benchmark.jsonl
node olaf/benchmarks/review.mjs /tmp/olaf-benchmark.jsonl > /tmp/olaf-evidence-review.jsonl
```

Phase 2 adds a 64-case suite (16 legacy plus 48 constructed cases, including a 16-case holdout) and four architectures. Run the offline reference check before any paid inference, and keep paid runs inside an explicit budget:

```sh
node olaf/benchmarks/run.mjs --suite phase2 --split dev --architecture a --model gpt-4.1-mini --reverse --details --out /tmp/olaf-dev.jsonl
node olaf/benchmarks/run.mjs --suite phase2 --split holdout --architecture a --model gpt-6.2-sol --reverse --budget-usd 2 --out /tmp/olaf-holdout.jsonl
node olaf/benchmarks/compare.mjs /tmp/olaf-dev.jsonl /tmp/olaf-holdout.jsonl
```

`--architecture` accepts `a` (preserved single pass), `b` (compiled requirements plus one structured pass), `c` (staged adherence and inspection with preference only when it can decide), and `d` (initial evaluation plus targeted native-resolution crop verification). `--suite`, `--split`, `--case`, `--repeat` and repeatable `--model` select the run. The runner stops before 95% of `--budget-usd` (default 10). Each JSONL row records the reference decision and stage, split, category, actual decision and stage, stage agreement, evidence factuality, hallucination flags, mapped reverse consistency, error taxonomy, latency and estimated cost. Invalid runs count against agreement and cause a nonzero exit.

`summarize()` reports decision agreement on objective cases, overall fixed-reference agreement, stage agreement, agreement by confidence, stage, category and split, positional consistency, evidence factuality, structural validity, abstentions and per-call cost. `compare.mjs` prints a model and architecture comparison table plus the failure list. Review output records factual checks of evidence against both actual screenshots. Keyword hits only help locate likely evidence.

Reference judgments were specified from constructed differences and rubric rules before live inference. The rounded-corner, color-family and layout cases admit reasonable alternatives and are scored as equivalence or subjective cases instead of forcing a side. The hierarchy preference remains a provisional design judgment. The holdout split was not used during prompt refinement. The suite lacks independent human adjudication and real-task coverage. Measured results, including cases that missed the targets, are recorded in [`docs/phase2-report.md`](docs/phase2-report.md).

## Disputed-case review

Start the local server and open **http://127.0.0.1:4173/olaf-review.html** (also linked from the
workspace header). Load a detailed benchmark JSONL produced by `run.mjs --details`. Nothing is
uploaded; the file is read in the browser and matched to the committed synthetic fixtures.

For each run the workspace shows the original request, native-resolution Left and Right images, the
frozen reference decision and stage, the model decision and stage, both sides' evidence, defects and
severities, the decision trace, stage telemetry and the reverse-order result. Rows whose reference was
not constructed or not objective are marked as potentially defensible disagreements.

Independent adjudication is recorded separately from the frozen benchmark and from evaluation history:
choose a verdict (agree, defensible disagreement, model error or an independent side), add a reviewer
and notes, and save. Records live in IndexedDB (`olaf-review`) and can be exported as JSON or cleared.
They never modify `benchmarks/dataset.mjs`, the reference labels or the measured results.

## First representative archive

No authorized representative Feather archive has been validated. Keep the original outside the repository. Inspect only its MIME inventory, inert HTML text and image relationships locally. Record which generic recovery decisions were correct, missing or ambiguous. Verify each side, the exact prompt, dimensions, capture scope and any missing assets with an authorized reviewer.

1. Open the workspace from the local server and import the archive. Do not commit or publish it.
2. Expand **Archive intake report**. Confirm archive size, MIME part count, HTML document count and image resources. Each image line reports MIME, byte size, dimensions, CID, Content-Location, part index and current assignment.
3. Confirm the recovered request text or choose a recovered candidate. If extraction fails, type the request manually and assign images from the pool.
4. Record every ambiguity and parser warning, then check the full-resolution images with **Inspect / crop**. Crops never modify the source assets.
5. Evaluate with the **Diagnostic** preset and note whether the decision, stage and evidence match an independent manual review. Save an evaluation-history record if useful; keep raw results outside the repository.

Create a minimal synthetic reproduction of the relevant structure, replacing all content, URLs, identifiers and images. Only then implement a separate `{ extract(parsedArchive) }` adapter and select it from observed, documented signatures. The adapter returns candidate requests, embedded image blobs with labels, proposed assignments, metadata and warnings. Reuse existing normalization, stable identities and explicit confirmation. Test partial archives, missing labels and reversed ordering before enabling the adapter. Leave task claiming, live workflow navigation and submission outside the engine.
