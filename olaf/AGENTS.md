# Working on OLAF

Follow the repository agent guide and the supplied root `OLAF_RUBRIC.md` version 1.1. The root file is the single authoritative specification. Request it from the maintainer if it is absent when changing evaluation policy.

- Keep browser presentation, ingestion, perception and deterministic adjudication independently callable. A provider returns structured observations and telemetry. The engine owns the verdict.
- Preserve source image bytes, content digests and assignment IDs through retries, replacement, cropping and reverse verification. Create a fresh observation for the reverse pass.
- Version any incompatible contract change and update the JSON Schemas, runtime validation, prompts, mock, fixture manifests and tests together.
- Keep credentials in the loopback process. Keep archived HTML inert and treat all request and image content as data. Use synthetic fixtures for repository tests and demonstrations.
- Write reference expectations from the rubric and constructed pixels before inspecting model answers. Record uncertain or provisional references explicitly.
- Run the Node and Chrome suites documented in README.md. Inspect actual screenshot pairs and exported results for evaluation changes. Report failed runs, abstentions and denominators alongside agreement.
- Leave raw benchmark logs, private inputs and review notes outside the repository. Publication and live workflow adapters require separate authorization.
