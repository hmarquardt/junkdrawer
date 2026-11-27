// Phase 2 benchmark runner. Supports the original legacy suite, the expanded dataset, and four architectures.
import { readFile, appendFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { legacyCases } from './legacy.mjs';
import { splitCases } from './dataset.mjs';
import manifest from '../fixtures/manifest.json' with { type: 'json' };
import { createTask, pair } from '../engine/contracts.mjs';
import { evaluateArchitecture, architectures, architectureNames } from '../engine/pipeline.mjs';
import { mockProvider } from '../providers/mock.mjs';
import { openAIProvider } from '../providers/openai.mjs';
import { hashBlob } from '../ingestion/images.mjs';
import { classify, evidenceAudit, stageMatches } from './taxonomy.mjs';
import { summarize } from './summary.mjs';

const { values } = parseArgs({
  options: {
    model: { type: 'string', multiple: true, default: [] },
    architecture: { type: 'string', multiple: true, default: [] },
    suite: { type: 'string', default: 'legacy' },
    split: { type: 'string', default: 'all' },
    repeat: { type: 'string', default: '1' },
    case: { type: 'string', multiple: true, default: [] },
    reverse: { type: 'boolean' },
    details: { type: 'boolean' },
    'budget-usd': { type: 'string', default: '10' },
    out: { type: 'string' },
  },
});
const repeats = Number(values.repeat);
if (!Number.isInteger(repeats) || repeats < 1) throw Error('Use a positive integer repeat count.');
const budget = Number(values['budget-usd']);
if (!Number.isFinite(budget) || budget < 0) throw Error('Use a non-negative budget.');
const selectedArchitectures = values.architecture.length ? values.architecture : ['a'];
if (selectedArchitectures.some((a) => !architectures.includes(a)))
  throw Error('Architecture must be one of ' + architectures.join(', '));
const suite = values.suite === 'phase2' ? splitCases(values.split) : legacyCases;
const selected = values.case.length
  ? values.case.map((id) => {
      const c = suite.find((c) => c.id === id);
      if (!c) throw Error('Unknown case ' + id);
      return c;
    })
  : suite;

async function taskFor(c) {
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
    if (!f) throw Error('No rendered fixture for ' + name);
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
  return { task, bytes };
}
const providerFor = (model, bytes) =>
  model === 'mock'
    ? mockProvider((ref) => hashBlob(new Blob([bytes.get(ref.id)])))
    : openAIProvider(async (input) =>
        pair((s) => 'data:image/png;base64,' + bytes.get(input.images[s].id).toString('base64')),
      );

const rows = [];
let spentUsd = 0;
let budgetExhausted = false;
outer: for (const model of values.model.length ? values.model : ['mock']) {
  for (const architecture of selectedArchitectures) {
    for (const c of selected) {
      const { task, bytes } = await taskFor(c);
      for (let i = 0; i < repeats; i++) {
        if (budget > 0 && spentUsd >= budget * 0.95) {
          budgetExhausted = true;
          break outer;
        }
        const row = {
          case: c.id,
          model,
          architecture,
          repeat: i + 1,
          expected: c.reference.decision,
          expectedStage: c.reference.stage,
          split: c.split,
          category: c.category,
          objective: c.objective,
        };
        try {
          const r = await evaluateArchitecture(task, providerFor(model, bytes), {
            architecture,
            model,
            reverse: values.reverse,
          });
          const calls = [
            ...(r.diagnostics?.stages || [r.telemetry]),
            ...(r.diagnostics?.reversed?.stages || (r.verification ? [r.verification.telemetry] : [])),
          ];
          const audit = evidenceAudit(c, r.why);
          Object.assign(row, {
            decision: r.decision,
            stage: r.stage,
            stageMatch: stageMatches(c.reference.stage, r.stage),
            agreement: c.reference.decision === null ? null : r.decision === c.reference.decision,
            evidenceKeyword: c.evidence ? new RegExp(c.evidence, 'i').test(r.why) : null,
            evidenceGrounded: audit.grounded,
            hallucinated: audit.hallucinated,
            why: r.why,
            confidence: r.confidence,
            consistent: r.verification?.consistent ?? null,
            latencyMs: calls.reduce((n, t) => n + t.latencyMs, 0),
            estimatedUsd: calls.every((t) => t.estimatedUsd !== null)
              ? calls.reduce((n, t) => n + t.estimatedUsd, 0)
              : null,
            inputTokens: calls.every((t) => t.inputTokens !== null)
              ? calls.reduce((n, t) => n + t.inputTokens, 0)
              : null,
            outputTokens: calls.every((t) => t.outputTokens !== null)
              ? calls.reduce((n, t) => n + t.outputTokens, 0)
              : null,
            telemetry: calls,
            valid: true,
          });
          row.taxonomy = classify(c, r);
          if (values.details) row.result = r;
        } catch (e) {
          Object.assign(row, { valid: false, error: e.message, taxonomy: ['invalid_output'] });
          if (e.attempts) {
            row.telemetry = e.attempts;
            row.latencyMs = e.attempts.reduce((n, t) => n + t.latencyMs, 0);
            row.estimatedUsd = e.attempts.every((t) => t.estimatedUsd !== null)
              ? e.attempts.reduce((n, t) => n + t.estimatedUsd, 0)
              : null;
          }
        }
        spentUsd += row.estimatedUsd || 0;
        rows.push(row);
        const line = JSON.stringify(row);
        console.log(line);
        if (values.out) await appendFile(values.out, line + '\n');
      }
    }
  }
}
for (const model of [...new Set(rows.map((r) => r.model))])
  for (const architecture of [...new Set(rows.filter((r) => r.model === model).map((r) => r.architecture))]) {
    const m = rows.filter((r) => r.model === model && r.architecture === architecture);
    console.log(
      JSON.stringify({
        summary: model,
        architecture,
        architectureName: architectureNames[architecture],
        ...summarize(m),
        spentUsd: Number(spentUsd.toFixed(6)),
        budgetUsd: budget,
        budgetExhausted,
        suite: values.suite,
        split: values.split,
      }),
    );
  }
if (budgetExhausted) console.error('Budget threshold reached; paid inference stopped.');
if (rows.some((r) => !r.valid)) process.exitCode = 1;

