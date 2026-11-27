// Aggregate one or more benchmark JSONL runs into a comparison report. Offline and deterministic.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { summarize } from './summary.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { split: { type: 'string', default: 'all' }, failures: { type: 'boolean', default: true } },
});
if (!positionals.length) throw Error('Usage: node olaf/benchmarks/compare.mjs RUN.jsonl [RUN2.jsonl ...]');
const rows = [];
for (const file of positionals) {
  const lines = (await readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const row = JSON.parse(line);
    if (row.case) rows.push(row);
  }
}
const selected = rows.filter((r) => values.split === 'all' || r.split === values.split);
const groups = new Map();
for (const row of selected) {
  const key = [row.model, row.architecture, row.split].join('|');
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}
const pct = (f) => (f.total ? Math.round((f.success / f.total) * 1000) / 10 + '%' : '—');
const num = (n, digits = 0) => (n == null ? '—' : n.toFixed(digits));
const table = [
  '| Model | Architecture | Split | Runs | Valid | Objective | Overall | Stage | Evidence | Reverse | Abstain | Mean ms | $/eval |',
  '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
];
const report = [];
for (const [key, group] of groups) {
  const [model, architecture, split] = key.split('|');
  const s = summarize(group);
  table.push(
    `| ${model} | ${architecture} | ${split} | ${s.runs} | ${pct(s.structuralValidity)} | ${pct(s.decisionAgreement)} | ${pct(s.overallAgreement)} | ${pct(s.stageAgreement)} | ${pct(s.evidenceFactuality)} | ${pct(s.positionalConsistency)} | ${s.abstentions} | ${num(s.latencyMs.mean)} | $${num(s.usdPerEvaluation, 4)} |`,
  );
  report.push({ model, architecture, split, ...s });
}
console.log(table.join('\n'));
console.log('');
for (const group of report) {
  const entries = Object.entries(group.taxonomy).sort((a, b) => b[1] - a[1]);
  if (entries.length)
    console.log(
      `**${group.model} · ${group.architecture} · ${group.split}** errors: ` +
        entries.map(([k, v]) => `${k}=${v}`).join(', '),
    );
}
if (values.failures) {
  const disagreements = selected.filter((r) => r.valid && r.expected != null && r.agreement === false);
  if (disagreements.length) {
    console.log('\n| Case | Model | Arch | Expected | Actual | Taxonomy |');
    console.log('| --- | --- | --- | --- | --- | --- |');
    for (const r of disagreements)
      console.log(
        `| ${r.case} | ${r.model} | ${r.architecture} | ${r.expected}/${r.expectedStage} | ${r.decision}/${r.stage} | ${(r.taxonomy || []).join(', ')} |`,
      );
  }
  const invalid = selected.filter((r) => !r.valid);
  if (invalid.length) {
    console.log('\nInvalid runs:');
    for (const r of invalid) console.log(`- ${r.case} · ${r.model} · ${r.architecture}: ${r.error}`);
  }
}
console.log('\n```json');
console.log(JSON.stringify(report, null, 2));
console.log('```');
