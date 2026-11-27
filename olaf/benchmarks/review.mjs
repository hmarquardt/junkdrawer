// Reads an existing --details run; this review never invokes a model.
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { cases } from './cases.mjs';
const file = process.argv[2];
if (!file) throw Error('Usage: node olaf/benchmarks/review.mjs RUN.jsonl > PRIVATE_REVIEW.jsonl');
const lines = (await readFile(file, 'utf8'))
  .trim()
  .split(/\r?\n/)
  .map((l) => JSON.parse(l));
const terminal = createInterface({ input: process.stdin, output: process.stderr });
let accurate = 0,
  reviewed = 0;
try {
  for (const row of lines.filter((row) => row.valid && row.case)) {
    const c = cases.find((c) => c.id === row.case);
    if (!c || !row.result) throw Error('Use a detailed synthetic benchmark run from this fixture version.');
    const file = (n) => fileURLToPath(new URL('../fixtures/images/' + n + '.png', import.meta.url));
    process.stderr.write(
      [
        '',
        c.id + ' · ' + row.model + ' · run ' + row.repeat,
        c.request,
        'Left  ' + file(c.left),
        'Right ' + file(c.right),
        row.why,
        'Expected cue: ' + c.evidence,
        'Proposed stage: ' + row.stage,
        'Observed evidence: ' + JSON.stringify(row.result.evidence),
        '',
      ].join('\n'),
    );
    let answer;
    do {
      answer = (
        await terminal.question(
          'After inspecting the images, is the decisive evidence factually accurate on both sides? [y/n/s] ',
        )
      )
        .trim()
        .toLowerCase();
    } while (!['y', 'n', 's'].includes(answer));
    if (answer === 's') continue;
    const note = await terminal.question('Evidence location or correction: ');
    reviewed++;
    if (answer === 'y') accurate++;
    console.log(
      JSON.stringify({
        case: c.id,
        model: row.model,
        repeat: row.repeat,
        evidenceAccurate: answer === 'y',
        note,
      }),
    );
  }
  console.log(JSON.stringify({ reviewed, accurate }));
} finally {
  terminal.close();
}
