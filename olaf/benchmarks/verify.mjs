// Offline consistency check: constructed references must satisfy the deterministic adjudicator.
// This never calls a provider and is safe to run in CI.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { cases, referenceObservation, splitCases } from './dataset.mjs';
import manifest from '../fixtures/manifest.json' with { type: 'json' };
import { createTask, validateTask, validateObservation } from '../engine/contracts.mjs';
import { adjudicateDetailed } from '../engine/adjudicate.mjs';
const { values } = parseArgs({
  options: { split: { type: 'string', default: 'all' }, quiet: { type: 'boolean' } },
});
const selected = splitCases(values.split);
const stageMatches = (expected, actual) =>
  expected === 'preference_or_tie' ? ['preference', 'tie'].includes(actual) : expected === actual;
const failures = [];
for (const c of selected) {
  const task = createTask();
  task.id = 'reference-' + c.id;
  task.request = c.request;
  task.captureScope = 'viewport';
  task.source = 'synthetic';
  for (const side of ['Left', 'Right']) {
    const name = c[side.toLowerCase()],
      f = manifest[name];
    task.images[side] = {
      id: side.toLowerCase() + '-' + c.id,
      width: f.width,
      height: f.height,
      bytes: f.bytes,
      sha256: f.hash,
      mime: 'image/png',
      source: 'synthetic',
      provenance: 'Rendered specimen',
    };
  }
  const record = { case: c.id, split: c.split, category: c.category, ok: true, problems: [] };
  try {
    validateTask(task);
    const observation = referenceObservation(c);
    validateObservation(observation, task);
    const outcome = adjudicateDetailed(observation);
    record.decision = outcome.decision;
    record.stage = outcome.stage;
    if (c.reference.decision === null) {
      // Subjective cases are scored for structural validity and stage family only.
      if (!stageMatches(c.reference.stage, outcome.stage)) {
        record.ok = false;
        record.problems.push('stage ' + outcome.stage + ' != ' + c.reference.stage);
      }
    } else if (outcome.decision !== c.reference.decision) {
      record.ok = false;
      record.problems.push('decision ' + outcome.decision + ' != ' + c.reference.decision);
    }
    if (c.reference.decision !== null && !stageMatches(c.reference.stage, outcome.stage)) {
      record.ok = false;
      record.problems.push('stage ' + outcome.stage + ' != ' + c.reference.stage);
    }
  } catch (e) {
    record.ok = false;
    record.problems.push(e.message);
  }
  if (!record.ok) failures.push(record);
  if (!values.quiet) console.log(JSON.stringify(record));
}
console.log(
  JSON.stringify({
    summary: 'reference-consistency',
    split: values.split,
    cases: selected.length,
    objective: selected.filter((c) => c.objective).length,
    holdout: selected.filter((c) => c.split === 'holdout').length,
    failures: failures.length,
  }),
);
if (failures.length) {
  for (const f of failures) console.error('REFERENCE ' + f.case + ': ' + f.problems.join('; '));
  process.exitCode = 1;
}
