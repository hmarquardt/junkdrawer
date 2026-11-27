import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { cases } from './cases.mjs';
import manifest from '../fixtures/manifest.json' with { type: 'json' };
import { createTask, pair } from '../engine/contracts.mjs';
import { evaluate } from '../engine/evaluate.mjs';
import { mockProvider } from '../providers/mock.mjs';
import { hashBlob } from '../ingestion/images.mjs';
import { openAIProvider } from '../providers/openai.mjs';
const { values } = parseArgs({
  options: {
    model: { type: 'string', multiple: true, default: [] },
    repeat: { type: 'string', default: '1' },
    case: { type: 'string', multiple: true, default: [] },
    reverse: { type: 'boolean' },
    details: { type: 'boolean' },
  },
});
const repeats = Number(values.repeat);
if (!Number.isInteger(repeats) || repeats < 1) throw Error('Use a positive integer repeat count.');
const selected = values.case.length
  ? values.case.map((id) => {
      const c = cases.find((c) => c.id === id);
      if (!c) throw Error('Unknown case ' + id);
      return c;
    })
  : cases;
const rows = [];
for (const model of values.model.length ? values.model : ['mock']) {
  for (const c of selected) {
    const task = createTask();
    task.request = c.request;
    task.source = 'synthetic';
    task.provenance = 'Rendered HTML fixture';
    task.captureScope = 'viewport';
    const bytes = new Map();
    for (const side of ['Left', 'Right']) {
      const name = c[side.toLowerCase()],
        id = crypto.randomUUID(),
        f = manifest[name];
      bytes.set(id, await readFile(new URL('../fixtures/images/' + name + '.png', import.meta.url)));
      task.images[side] = {
        id,
        width: f.width,
        height: f.height,
        bytes: f.bytes,
        sha256: f.hash,
        mime: 'image/png',
        source: 'synthetic',
        provenance: 'Rendered specimen',
      };
    }
    const provider =
      model === 'mock'
        ? mockProvider((ref) => hashBlob(new Blob([bytes.get(ref.id)])))
        : openAIProvider(async (input) =>
            pair((s) => 'data:image/png;base64,' + bytes.get(input.images[s].id).toString('base64')),
          );
    for (let i = 0; i < repeats; i++) {
      const row = {
        case: c.id,
        model,
        repeat: i + 1,
        expected: c.decision,
        expectedStage: c.stage,
        expectedEvidence: c.evidence,
      };
      try {
        const r = await evaluate(task, provider, { model, reverse: values.reverse });
        const stageMatch =
          c.stage === 'preference_or_tie' ? ['preference', 'tie'].includes(r.stage) : r.stage === c.stage;
        const runs = [r.telemetry, ...(r.verification ? [r.verification.telemetry] : [])];
        Object.assign(row, {
          decision: r.decision,
          stage: r.stage,
          stageMatch,
          agreement: c.decision === null ? null : r.decision === c.decision,
          evidenceKeyword: new RegExp(c.evidence, 'i').test(r.why),
          why: r.why,
          confidence: r.confidence,
          consistent: r.verification?.consistent ?? null,
          latencyMs: runs.reduce((n, t) => n + t.latencyMs, 0),
          estimatedUsd: runs.every((t) => t.estimatedUsd !== null)
            ? runs.reduce((n, t) => n + t.estimatedUsd, 0)
            : null,
          telemetry: runs,
          valid: true,
        });
        if (values.details) row.result = r;
      } catch (e) {
        row.valid = false;
        row.error = e.message;
        if (e.attempts) {
          row.telemetry = e.attempts;
          row.latencyMs = e.attempts.reduce((n, t) => n + t.latencyMs, 0);
          row.estimatedUsd = e.attempts.every((t) => t.estimatedUsd !== null)
            ? e.attempts.reduce((n, t) => n + t.estimatedUsd, 0)
            : null;
        }
      }
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
}
for (const model of new Set(rows.map((r) => r.model))) {
  const m = rows.filter((r) => r.model === model);
  const fraction = (list) => ({ success: list.filter(Boolean).length, total: list.length });
  const labelled = m.filter((r) => r.expected !== null);
  const buckets = Object.fromEntries(
    ['high', 'medium', 'low'].map((k) => [
      k,
      fraction(labelled.filter((r) => r.confidence === k).map((r) => r.agreement)),
    ]),
  );
  const groups = selected.map((c) => m.filter((r) => r.case === c.id)).filter((g) => g.length > 1);
  console.log(
    JSON.stringify({
      summary: model,
      runs: m.length,
      valid: fraction(m.map((r) => r.valid)),
      decisionAgreement: fraction(labelled.map((r) => r.agreement)),
      unambiguousAdherenceAndDefects: fraction(
        labelled
          .filter((r) => ['prompt_adherence', 'disqualifiers'].includes(r.expectedStage))
          .map((r) => r.agreement),
      ),
      stageAgreement: fraction(m.map((r) => r.stageMatch)),
      agreementByConfidence: buckets,
      stages: Object.fromEntries(
        [...new Set(m.map((r) => r.expectedStage))].map((s) => [
          s,
          fraction(m.filter((r) => r.expectedStage === s).map((r) => r.stageMatch)),
        ]),
      ),
      positionalConsistency: fraction(
        m.filter((r) => r.consistent != null && r.decision !== 'REVIEW').map((r) => r.consistent),
      ),
      repeatable: fraction(
        groups.map((g) => g.every((r) => r.valid && r.decision === g[0].decision && r.stage === g[0].stage)),
      ),
      abstentions: m.filter((r) => r.decision === 'REVIEW').length,
      latencyMs: m.filter((r) => r.valid).map((r) => r.latencyMs),
      estimatedUsd: m.every((r) => r.estimatedUsd != null) ? m.reduce((n, r) => n + r.estimatedUsd, 0) : null,
    }),
  );
}
if (rows.some((r) => !r.valid)) process.exitCode = 1;
