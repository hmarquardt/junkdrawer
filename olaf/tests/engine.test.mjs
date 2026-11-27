import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseArchive } from '../ingestion/mime.mjs';
import { pair, assign, swap, validateTask, validateObservation } from '../engine/contracts.mjs';
import { adjudicate } from '../engine/adjudicate.mjs';
import { evaluate, validateResult } from '../engine/evaluate.mjs';
import { mockProvider } from '../providers/mock.mjs';
import { openAIProvider } from '../providers/openai.mjs';
import { startServer } from '../server.mjs';
import task from '../fixtures/task.json' with { type: 'json' };
import manifest from '../fixtures/manifest.json' with { type: 'json' };
const provider = mockProvider((ref) => manifest[ref.id.split('-')[1]].hash);
const { observation: base } = await provider.observe(task, {});
const obs = () => structuredClone(base);
function defect(side, severity) {
  return {
    side,
    severity,
    type: 'contrast',
    location: 'main text',
    evidence: pair((s) =>
      s === side ? 'the heading blends into the background' : 'the heading has dark lettering',
    ),
  };
}
test('nested MIME, relative location, CID, folded headers, charsets and encoded newlines', async () => {
  const a = parseArchive(await readFile(new URL('../fixtures/nested.mhtml', import.meta.url)));
  assert.equal(a.parts.length, 3);
  assert.match(a.parts[0].text, /café/);
  assert.equal(a.resolveRef('cid:RED').index, 1);
  assert.equal(a.resolveRef('green.png').index, 2);
  assert.deepEqual([...a.parts[1].bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(a.warnings, []);
  const qp = parseArchive(
    Buffer.from(
      'Content-Type: text/plain; charset=windows-1252\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nA=\r\nB=80',
    ),
  );
  assert.equal(qp.parts[0].text, 'AB€');
});
test('incomplete multipart recovers final resource, preserves raw binary and skips invalid encodings', async () => {
  const a = parseArchive(await readFile(new URL('../fixtures/ambiguous.mht', import.meta.url)));
  assert.equal(a.parts.length, 3);
  assert.match(a.warnings.join(' '), /incomplete/);
  const b = parseArchive(
    Buffer.from(
      'Content-Type: multipart/related; boundary=b\n\n--b\nContent-Type: image/png\n\n\u0000\u0080\u00ff\n\n--b\nContent-Type: image/png\nContent-Transfer-Encoding: base64\n\n%\n--b--',
      'latin1',
    ),
  );
  assert.deepEqual([...b.parts[0].bytes], [0, 128, 255, 10]);
  assert.match(b.warnings.join(' '), /undecodable/);
  assert.ok(parseArchive(Buffer.from('truncated')).warnings.length);
});
test('canonical task rejects invalid fields, dimensions and duplicate identities', () => {
  validateTask(task);
  for (const change of [
    (t) => (t.images.Left.width = 0),
    (t) => (t.images.Left.id = t.images.Right.id),
    (t) => (t.rubricVersion = '1.0'),
    (t) => (t.request = '  '),
    (t) => (t.images.Left.mime = 'image/svg+xml'),
    (t) => (t.token = 'unexpected'),
  ]) {
    const t = structuredClone(task);
    change(t);
    assert.throws(() => validateTask(t));
  }
});
test('assignment of opposite candidate exchanges stable identities', () => {
  const t = structuredClone(task);
  assign(t, 'Left', t.images.Right);
  assert.deepEqual(t, swap(task));
  assert.deepEqual(swap(t), task);
  assign(t, 'Left', null);
  assert.throws(() => validateTask(t));
  assert.throws(() => assign(t, 'Bad', task.images.Left));
});
const scenarios = [
  [
    'same severity, unequal impact',
    (o) => {
      o.requirements = [];
      o.defects = [defect('Left', 'major'), defect('Right', 'major')];
      o.lessAffected = 'Right';
      o.impactEvidence = {
        Left: 'all field labels are unreadable',
        Right: 'only the date label is unreadable',
      };
    },
    'Right',
    'disqualifiers',
  ],
  ['single rendering', (o) => (o.rendering.Left = 'failed'), 'Right', 'rendering'],
  ['both failed', (o) => (o.rendering = pair(() => 'failed')), 'REVIEW', 'review'],
  ['uncertain rendering', (o) => (o.rendering.Right = 'uncertain'), 'REVIEW', 'review'],
  ['adherence over taste', (o) => (o.preference = 'Right'), 'Left', 'prompt_adherence'],
  [
    'adherence over ordinary defect',
    (o) => (o.defects = [defect('Left', 'major')]),
    'Left',
    'prompt_adherence',
  ],
  ['severe exception', (o) => (o.defects = [defect('Left', 'page_broken')]), 'Right', 'disqualifiers'],
  [
    'competing defects',
    (o) => {
      o.requirements = [];
      o.defects = [defect('Right', 'minor'), defect('Left', 'major')];
    },
    'Right',
    'disqualifiers',
  ],
  [
    'reasonable alternative meets',
    (o) => {
      o.requirements[0].status.Right = 'alternative';
      o.preference = 'Right';
    },
    'Right',
    'preference',
  ],
  [
    'comparable defects go to preference',
    (o) => {
      o.requirements = [];
      o.defects = [defect('Left', 'major'), defect('Right', 'major')];
      o.preference = 'Left';
    },
    'Left',
    'preference',
  ],
  [
    'unobservable behavior',
    (o) => {
      Object.assign(o.requirements[0], {
        kind: 'functionality',
        scope: 'unobservable',
        status: pair(() => 'excluded'),
      });
    },
    'Tie',
    'tie',
  ],
  [
    'later screens',
    (o) => {
      Object.assign(o.requirements[0], { kind: 'later_state', scope: 'later', status: pair(() => 'excluded') });
    },
    'Tie',
    'tie',
  ],
  ['uncertain adherence', (o) => (o.requirements[0].status.Right = 'uncertain'), 'REVIEW', 'review'],
  [
    'insufficient resolution',
    (o) => {
      o.requirements = [];
      o.preference = 'uncertain';
    },
    'REVIEW',
    'review',
  ],
  ['equivalent screenshots', (o) => (o.requirements = []), 'Tie', 'tie'],
];
for (const [name, change, decision, stage] of scenarios)
  test('precedence · ' + name, () => {
    const o = obs();
    change(o);
    validateObservation(o, task);
    const r = adjudicate(o);
    assert.equal(r.decision, decision);
    assert.equal(r.stage, stage);
  });
test('malformed observations and unsupported requirements are rejected', () => {
  for (const change of [
    (o) => delete o.passes.type,
    (o) => (o.principles.spacing.Right = ''),
    (o) => (o.requirements[0].excerpt = 'invented'),
    (o) => (o.requirements[0].kind = 'functionality'),
    (o) => o.requirements.push(o.requirements[0]),
  ]) {
    const o = obs();
    change(o);
    assert.throws(() => validateObservation(o, task));
  }
});
test('reverse-order run uses opposite image IDs and validates explanation, evidence, winner and mapping', async () => {
  const seen = [];
  const p = {
    ...provider,
    observe(t, opts) {
      seen.push(t.images.Left.id);
      return provider.observe(t, opts);
    },
  };
  const result = await evaluate(task, p, { model: 'mock', reverse: true });
  assert.deepEqual(seen, [task.images.Left.id, task.images.Right.id]);
  assert.equal(result.verification.reversedDecision, 'Right');
  assert.equal(result.verification.consistent, true);
  for (const change of [
    (r) => (r.why = 'unsupported'),
    (r) => (r.decision = 'Right'),
    (r) => (r.evidence.Right = 'unrelated'),
    (r) => (r.verification.mappedDecision = 'Right'),
  ]) {
    const r = structuredClone(result);
    change(r);
    assert.throws(() => validateResult(r, task));
  }
  for (const evidence of [
    'option A has a purple button',
    'the heading is purple. It is smaller. This is great.',
  ]) {
    const o = obs();
    o.requirements[0].evidence.Left = evidence;
    await assert.rejects(
      evaluate(task, { name: 'test', observe: () => ({ observation: o }) }, { model: 'test' }),
      /style check/,
    );
  }
});
test('position-biased provider flags disagreement and unknown mock task abstains', async () => {
  const biased = { name: 'test', observe: () => ({ observation: obs() }) };
  assert.equal((await evaluate(task, biased, { model: 'test', reverse: true })).verification.consistent, false);
  const t = { ...task, request: 'Something else' };
  assert.equal((await evaluate(t, provider, { model: 'mock' })).decision, 'REVIEW');
});
test('provider HTTP failure normalizes sensitive body, invalid JSON and remote references are rejected', async () => {
  const key = 'test-only-secret',
    env = { OPENAI_API_KEY: key },
    model = 'gpt-4.1-mini',
    url = 'data:image/png;base64,iVBORw0KGgo=';
  const p = (transport, images = pair(() => url)) => openAIProvider(() => images, { env, transport });
  const error = await p(async () => new Response(key, { status: 401 }))
    .observe(task, { model })
    .catch((e) => e);
  assert.match(error.message, /HTTP 401/);
  assert.ok(!error.message.includes(key));
  await assert.rejects(p(async () => new Response('{}')).observe(task, { model }), /incomplete JSON/);
  await assert.rejects(
    p(
      () => assert.fail('transport called'),
      pair(() => 'https://example.invalid/image'),
    ).observe(task, { model }),
    /embedded raster/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(evaluate(task, provider, { model, signal: controller.signal }), { name: 'AbortError' });
});
test('loopback configuration and static responses exclude credentials and private resources', async () => {
  const sentinel = 'server-only-test-value',
    server = await startServer(0, { OPENAI_API_KEY: sentinel });
  try {
    const url = 'http://127.0.0.1:' + server.address().port;
    for (const path of [
      '/',
      '/olaf/config',
      '/olaf/app.mjs',
      '/olaf/server.mjs',
      '/.env',
      '/OLAF_RUBRIC.md',
      '/olaf/providers/openai.mjs',
    ]) {
      const r = await fetch(url + path);
      assert.equal(r.status, ['/', '/olaf/config', '/olaf/app.mjs'].includes(path) ? 200 : 404);
      assert.ok(!(await r.text()).includes(sentinel));
    }
    const r = await fetch(url + '/olaf/observe', {
      method: 'POST',
      headers: { Origin: 'https://example.invalid', 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(r.status, 403);
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    assert.equal(
      (
        await fetch(url + '/olaf/observe', {
          method: 'POST',
          headers: { Origin: url, 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
      400,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test('provider timeout propagates without manufacturing a result', async () => {
  await assert.rejects(evaluate(task, provider, { model: 'fixture-v1', timeoutMs: 5 }), {
    name: 'TimeoutError',
  });
});
test('CLI checks original image identity even when plausible byte counts are supplied', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const fixture = (n) => new URL('../fixtures/' + n, import.meta.url).pathname;
  const args = [
    new URL('../cli.mjs', import.meta.url).pathname,
    fixture('task.json'),
    fixture('images/standard.png'),
    fixture('images/red.png'),
  ];
  const good = await run(process.execPath, args);
  assert.equal(JSON.parse(good.stdout).decision, 'Left');
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(tmpdir() + '/olaf-test-');
  try {
    const changed = await readFile(args[2]);
    changed[changed.length - 1] ^= 1;
    await writeFile(dir + '/changed.png', changed);
    args[2] = dir + '/changed.png';
    await assert.rejects(run(process.execPath, args), /does not match the task manifest/);
  } finally {
    await rm(dir, { recursive: true });
  }
});
test('caller edits during inference cannot invert candidate identity', async () => {
  const draft = structuredClone(task);
  const pending = evaluate(draft, provider, { model: 'fixture-v1', reverse: true });
  draft.images = swap(draft).images;
  const result = await pending;
  assert.equal(result.candidateIds.Left, task.images.Left.id);
  assert.equal(result.decision, 'Left');
  assert.equal(result.verification.consistent, true);
});
test('relative MIME locations, encoded CIDs and generic binary raster attachments', () => {
  const a = parseArchive(
    Buffer.from(
      'Content-Type: multipart/related; boundary=q\n\n--q\nContent-Type: text/html\nContent-Location: dir/page.html\n\n<img src="photo.png">\n--q\nContent-Type: application/octet-stream\nContent-Location: dir/photo.png\nContent-ID: <photo@local>\nContent-Transfer-Encoding: base64\n\niVBORw0KGgo=\n--q--',
    ),
  );
  assert.equal(a.resolveRef('photo.png', a.parts[0].location), a.parts[1]);
  assert.equal(a.resolveRef('cid:photo%40local').mime, 'image/png');
});
