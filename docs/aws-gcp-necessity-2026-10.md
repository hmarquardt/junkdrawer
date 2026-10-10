# Do I Still Need AWS or GCP? — method, evidence and limits

Artifact: `do-i-need-aws-gcp.html`, version 2026.10.10.1, published from this repository.
Prices and platform limits read on **2026-10-10** from the provider rate cards named in the
page's source catalogue. Companion documents:

- `docs/aws-gcp-disagreements-2026-10.json` — the machine-readable discrepancy report for the
  nine-disagreement audit, generated from the same data the page embeds.
- `tests/do-i-need-aws-gcp.cjs` — 39 unit tests over the engine, the data and the report.
- `tests/do-i-need-aws-gcp.spec.js` — 19 browser tests over rendering, navigation, storage,
  accessibility and offline behaviour.

## 1. What the artifact is for

The collection now answers three questions in three places:

| Artifact | Question |
| --- | --- |
| `github-actions-playground.html` | What can GitHub automation do? |
| `cloudflare-developer-playground.html` | What can Cloudflare do? |
| `right-tool-for-the-job.html` | Which architecture fits this workload? |
| `do-i-need-aws-gcp.html` | When does hyperscaler infrastructure actually earn its place? |

This artifact is an investigation, not a recommendation engine with a preference. Its output for a
workload is one of five classifications, and only one of them is categorical:

- **required by stated constraints** — a documented constraint eliminates every alternative the
  page evaluated, and the page prints the constraint and the alternative it eliminated;
- **strongly justified** — cheaper on the modelled volumes, or providing a capability the workload
  declares that the simpler option lacks;
- **competitive option** — defensible, not required;
- **not needed** — a simpler option satisfies every stated requirement at no greater cost;
- **insufficient information** — the evidence cannot support a verdict, which is a legitimate and
  frequently correct answer.

## 2. Method

1. **Hard gates.** Every candidate platform is tested against the stated requirement set. A failure
   removes the candidate and names the constraint. A capability the catalogue does not record also
   removes the candidate, because treating an unverified limit as available is the failure mode the
   page exists to prevent. The gates are: category, memory, disk, duration, native execution,
   container control, accelerator count, VRAM, multi-node, region pinning, residency, process
   lifetime, database shape and database extensions.
2. **Cost.** Survivors are priced by one of 19 cost models over a curated catalogue of 126 rates.
   Fixed charges, included allowances, rounding and unknowns are kept separate. Every rate names its
   source and its confidence, and every rate can be overridden with a real quote.
3. **Classification.** The verdict follows from a comparison between the cheapest surviving
   non-hyperscaler option and the cheapest surviving hyperscaler option, with capability differences
   treated as part of the comparison rather than as a tiebreak.
4. **Uncertainty.** Every probe that would change the verdict is discovered by re-running the whole
   test with that input changed, so the page reports conditions rather than a confidence score.

Cautions are separate from gates: spot capacity, self-hosted runner exposure, a production
availability expectation on a single machine, compliance evidence the page does not hold, and
private-network shapes that differ between platforms. A caution lowers confidence and never removes
a candidate.

## 3. The accuracy contract

- Official provider pricing is the source of truth; each rate names the page it came from.
- A rate read from a rendered page is marked **rate card read**. A rate whose table renders
  client-side is marked **documented** — a weaker claim, labelled wherever the figure appears.
- A figure that exists only to make a comparison possible is marked **estimate** and carries a
  warning. The VPS prices, the third-party managed database price and the assumed spot discounts are
  the estimates in this catalogue, and they are the reason the override box exists.
- An unset price stays unset. The external inference rate is deliberately empty: it is the reader's
  quote. The model refuses to price that option without it and returns a floor with an explicit
  unknown rather than a number.
- No all-in monthly figure is claimed. Every total is presented as fixed + variable + included +
  unmodelled, with the unmodelled charges listed.

## 4. The nine-disagreement audit

`right-tool-for-the-job.html` ships 36 scenarios with written recommendations and a deterministic
engine; the engine agreed with the written advice in 27 cases. All nine disagreements were
reproduced by executing both of that page's script blocks headlessly against its own scenario
library, and each was classified:

| Classification | Scenarios |
| --- | --- |
| implementation defect | sc-03, sc-30 |
| scoring or relevance weakness | sc-06, sc-20, sc-29 |
| capability-data weakness | sc-22, sc-32 |
| requirement-vocabulary weakness | sc-13, sc-33 |

Findings, in brief:

1. The `gh-pages-static` pattern has no member with the storage role, so a storage gate eliminates
   it before relevance is consulted. That single defect causes two of the nine disagreements, and the
   pattern would otherwise have ranked first in both. A related message interpolates an undefined
   capability, which is the visible symptom of the same incomplete record.
2. Incumbent credit is awarded to a pattern's provider label, so a hybrid pattern collects a
   Cloudflare bonus it did not earn, and a self-hosted operator earns nothing. This contributes to
   three disagreements.
3. Relevance is dominated by a pattern's `fits` list, so an exact label match outranks an actual
   requirement mismatch, and a materially suited pattern whose label list omits the workload type
   scores zero and sorts last. This causes two disagreements and contributes to a third.
4. Two disagreements are requirement-vocabulary problems rather than engine problems: the written
   advice is a conditional the model cannot express, and the requirement set encodes an
   implementation choice as a constraint.

One hypothesis was tested and discarded. The suspicion that a burst scenario modelled at zero
because a daily free allowance had been double-counted did not survive reproduction: five million
requests and 25 million CPU milliseconds sit inside the Workers Paid included allowance of ten
million requests, so the modelled zero is correct. The audit records the check rather than the
hypothesis.

No file in the audited artifact was modified by this work, and no disagreement was reconciled to
make the agreement rate look better. In no case was the engine alone right; in six cases the written
advice was better supported, and in three both answers are defensible.

## 5. The Road Naturalist case study

The flagship workload is examined against nine execution options. Its resource envelope is
dominated by three numbers: tens of millions of source features, a peak working set in the tens of
egabytes of memory, and hundreds of gigabytes of intermediate Parquet. The conclusion is that the
current split — heavy native work locally, a credential-free endpoint at the edge — is right, and
that the migration path to a Spot batch fleet is unusually cheap because the pipeline is already
partition-parallel and manifest-driven. What it lacks is a reason: no rebuild has a deadline. That
is a scheduling requirement rather than a compute one, and it is the condition the page says would
change the answer.

Every figure in the case study is labelled as a measurement, a published platform limit, or an
assumption with its basis stated. The runtime per rebuild is an estimate, and the page says that
every cost comparison inherits that uncertainty rather than presenting a confident total.

## 6. Project reviews

Eight existing systems were reviewed. All eight are recommended as **keep**, with the specific
condition that would justify reconsidering each one. The reasoning is not sentimentality about
incumbent infrastructure: migration costs hours, adds operational surface, and in several cases
would reduce privacy or increase a bill. The two genuinely open questions in the collection are
where Road Naturalist's derived dataset is published and whether Fruiting Forecast's rebuild ever
needs to run unattended.

## 7. Known limitations

- The catalogue is curated rather than exhaustive. A rate that is missing produces an unknown, not
  a zero, and the page says so.
- Several rate tables render client-side, so a number of figures are transcribed rather than read.
  They are marked, and the page's own advice is that a quote beats its transcription.
- Cloudflare Containers' maximum run duration is not documented in the catalogue, so any long job
  excludes it with an explanation. That is the fail-closed rule working, not an oversight, and it is
  the single most likely candidate for a documented value to be added later.
- Compliance is carried as a caution rather than a gate, because the page holds no per-platform
  certification evidence. A regulated requirement therefore tends toward **insufficient
  information**, which is the honest answer.
- Cost models are month-shaped. Daily allowances are converted carefully, but a workload whose
  behaviour differs between weekdays and weekends is modelled as an average.
- The page has no opinion about taste. Two architectures that cost the same and satisfy the same
  requirements are reported as competitive, and the choice is left where it belongs.

## 8. Verification performed

- `node tests/do-i-need-aws-gcp.cjs` — 39 tests, 0 failures, including 20 engine invariants.
- `npx playwright test tests/do-i-need-aws-gcp.spec.js` — 19 tests, 0 failures.
- `npx playwright test tests/storage-manager.spec.js` — 13 tests, 0 failures after the
  Storage Manager registration change.
- `bash tests/audit-storage-heuristics.sh` — 9 tests, 0 failures.
- `.agents/skills/junkdrawer-compliance-audit/scripts/audit.sh do-i-need-aws-gcp.html` — 0 errors,
  0 warnings.
- Every cost model, gate and comparison runs offline; a browser test asserts that no request leaves
  the page while it works.
