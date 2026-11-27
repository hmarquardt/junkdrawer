// Explicit operator-supplied operands only. JSON image references never cause filesystem or network reads.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pair, validateTask } from './engine/contracts.mjs';
import { evaluate } from './engine/evaluate.mjs';
import { openAIProvider } from './providers/openai.mjs';
import { mockProvider } from './providers/mock.mjs';
import { imageType, hashBlob } from './ingestion/images.mjs';
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    model: { type: 'string', default: 'mock' },
    reverse: { type: 'boolean' },
    diagnostic: { type: 'boolean' },
  },
});
if (positionals.length !== 3)
  throw Error('Usage: node olaf/cli.mjs [--model ID] [--reverse] TASK.json LEFT_IMAGE RIGHT_IMAGE');
const task = validateTask(JSON.parse(await readFile(positionals[0], 'utf8')));
const buffers = new Map();
for (const [i, side] of ['Left', 'Right'].entries()) {
  const bytes = await readFile(positionals[i + 1]),
    ref = task.images[side];
  if (
    bytes.length !== ref.bytes ||
    imageType(bytes) !== ref.mime ||
    (await hashBlob(new Blob([bytes]))) !== ref.sha256
  )
    throw Error(side + ' image does not match the task manifest.');
  buffers.set(ref.id, bytes);
}
const provider =
  values.model === 'mock'
    ? mockProvider((ref) => ref.sha256)
    : openAIProvider(async (t) =>
        pair((s) => 'data:' + t.images[s].mime + ';base64,' + buffers.get(t.images[s].id).toString('base64')),
      );
console.log(
  JSON.stringify(
    await evaluate(task, provider, {
      model: values.model,
      reverse: values.reverse,
      diagnostic: values.diagnostic,
    }),
    null,
    2,
  ),
);
