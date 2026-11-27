import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cases, referenceObservation } from '../benchmarks/dataset.mjs';
import manifest from '../fixtures/manifest.json' with { type: 'json' };
import { createTask, validateObservation, validateTask, sides } from '../engine/contracts.mjs';
import { adjudicate, adjudicateDetailed } from '../engine/adjudicate.mjs';
import { normalizeAssessment, normalizePerception } from '../engine/assessment.mjs';
import { validateCompile, validateAdherence, wireSchema, structuredSchema } from '../engine/stages.mjs';
import { validateVerify, claimsFor, applyVerification } from '../engine/verify.mjs';
import { evaluateArchitecture } from '../engine/pipeline.mjs';
import { mockProvider } from '../providers/mock.mjs';
import { recoverExcerpt, substantiveBasis } from '../engine/text.mjs';
import { decodePng, encodePng, cropImage, cropDataUrl } from '../ingestion/png.mjs';
import { pricingFor, estimatedUsd } from '../providers/pricing.mjs';

const stageMatches = (expected, actual) =>
  expected === 'preference_or_tie' ? ['preference', 'tie'].includes(actual) : expected === actual;

test('every constructed reference satisfies the deterministic adjudicator and contracts', () => {
  assert.ok(cases.length >= 60);
  assert.equal(cases.filter((c) => c.split === 'holdout').length, 16);
  for (const c of cases) {
    const task = createTask();
    task.id = 'reference-' + c.id;
    task.request = c.request;
    task.captureScope = 'viewport';
    for (const side of sides) {
      const f = manifest[c[side.toLowerCase()]];
      assert.ok(f, 'missing fixture ' + c[side.toLowerCase()]);
      task.images[side] = {
        id: side + '-' + c.id,
        width: f.width,
        height: f.height,
        bytes: f.bytes,
        sha256: f.hash,
        mime: 'image/png',
        source: 'synthetic',
        provenance: 'Rendered specimen',
      };
    }
    validateTask(task);
    const observation = referenceObservation(c);
    validateObservation(observation, task);
    const outcome = adjudicate(observation);
    if (c.reference.decision !== null) assert.equal(outcome.decision, c.reference.decision, c.id);
    assert.ok(stageMatches(c.reference.stage, outcome.stage), c.id + ' stage ' + outcome.stage);
  }
});

test('equivalence promotion requires an explicit substantive basis', () => {
  const base = {
    requirements: [
      {
        id: 'R1',
        excerpt: 'rounded corners',
        kind: 'style',
        scope: 'visible',
        status: { Left: 'missing', Right: 'met' },
        evidence: { Left: 'a square button', Right: 'a rounded button' },
        basis: { Left: '', Right: 'a rounded button satisfies the request' },
        alternative: { Left: false, Right: false },
        confidence: { Left: 'low', Right: 'high' },
      },
    ],
    defects: [],
  };
  assert.equal(normalizeAssessment(base).assessment.requirements[0].status.Left, 'missing');
  const vague = structuredClone(base);
  vague.requirements[0].alternative.Left = true;
  vague.requirements[0].basis.Left = 'no';
  assert.equal(normalizeAssessment(vague).assessment.requirements[0].status.Left, 'missing');
  const explicit = structuredClone(base);
  explicit.requirements[0].alternative.Left = true;
  explicit.requirements[0].basis.Left = 'slightly rounded corners are a reasonable reading of the request';
  assert.equal(normalizeAssessment(explicit).assessment.requirements[0].status.Left, 'alternative');
  assert.equal(normalizeAssessment(explicit).corrections[0].kind, 'equivalence');
});

test('severe-defect normalization follows observable scope and impact', () => {
  const assessment = {
    requirements: [],
    defects: [
      { side: 'Left', type: 'contrast', severity: 'major', scope: 'widespread', impact: 'unreadable' },
      { side: 'Right', type: 'contrast', severity: 'page_broken', scope: 'localized', impact: 'cosmetic' },
    ],
  };
  const { assessment: out, corrections } = normalizeAssessment(assessment);
  assert.equal(out.defects[0].severity, 'page_broken');
  assert.equal(out.defects[1].severity, 'major');
  assert.equal(corrections.length, 2);
});

test('both page-broken sides abstain instead of inventing a preference', () => {
  const c = cases.find((x) => x.id === 'both-page-broken');
  const outcome = adjudicateDetailed(referenceObservation(c));
  assert.equal(outcome.decision, 'REVIEW');
  assert.equal(outcome.stage, 'review');
  assert.ok(outcome.trace.some((step) => step.detail === 'both sides page-broken'));
});

test('stage contracts reject ungrounded, missing and applicable-requirement violations', () => {
  const request = 'Use a purple button and a working search on the next screen.';
  assert.equal(recoverExcerpt(request, 'Use a purple button'), 'Use a purple button');
  const duplicated = validateCompile(
    {
      requirements: [
        { id: 'R1', excerpt: 'purple button', kind: 'style', scope: 'visible', check: 'x', confidence: 'high' },
        { id: 'R2', excerpt: 'purple button', kind: 'component', scope: 'visible', check: 'x', confidence: 'high' },
      ],
    },
    request,
  );
  assert.equal(duplicated.length, 1);
  assert.equal(duplicated.aliases.get('R2'), 'R1');
  assert.throws(() =>
    validateCompile(
      {
        requirements: [
          { id: 'R1', excerpt: 'not in the request', kind: 'style', scope: 'visible', check: 'x', confidence: 'high' },
        ],
      },
      request,
    ),
  );
  const compiled = validateCompile(
    {
      requirements: [
        { id: 'R1', excerpt: 'Use a purple button', kind: 'style', scope: 'visible', check: 'x', confidence: 'high' },
        {
          id: 'R2',
          excerpt: 'working search on the next screen',
          kind: 'later_state',
          scope: 'later',
          check: 'x',
          confidence: 'high',
        },
      ],
    },
    request,
  );
  const result = (id, status) => ({
    id,
    status,
    evidence: { Left: 'a button', Right: 'a button' },
    basis: { Left: 'the button is visible', Right: 'the button is visible' },
    alternative: { Left: false, Right: false },
    confidence: { Left: 'high', Right: 'high' },
  });
  assert.throws(() => validateAdherence({ results: [result('R1', { Left: 'met', Right: 'met' })] }, compiled));
  assert.throws(() =>
    validateAdherence(
      {
        results: [
          result('R1', { Left: 'met', Right: 'met' }),
          result('R2', { Left: 'met', Right: 'met' }),
        ],
      },
      compiled,
    ),
  );
  const ok = validateAdherence(
    {
      results: [
        result('R1', { Left: 'met', Right: 'missing' }),
        result('R2', { Left: 'excluded', Right: 'excluded' }),
      ],
    },
    compiled,
  );
  assert.equal(ok[1].scope, 'later');
});

test('wire and structured schemas expand local refs for strict structured output', () => {
  const compile = wireSchema('compile');
  assert.ok(!JSON.stringify(compile).includes('#/$defs'));
  assert.ok(!('minLength' in compile.properties.requirements.items.properties.excerpt));
  const structured = structuredSchema();
  assert.ok(structured.properties.results && structured.properties.passes && structured.properties.preference);
  assert.ok(!JSON.stringify(structured).includes('#/$defs'));
});


async function demoTask() {
  const task = createTask();
  task.request = 'Use a purple “View collection” button.';
  task.captureScope = 'viewport';
  for (const [side, name] of [
    ['Left', 'standard'],
    ['Right', 'red'],
  ]) {
    const f = manifest[name];
    task.images[side] = {
      id: crypto.randomUUID(),
      width: f.width,
      height: f.height,
      bytes: f.bytes,
      sha256: f.hash,
      mime: 'image/png',
      source: 'synthetic',
      provenance: 'Rendered specimen',
    };
  }
  return task;
}

test('all four architectures reach the same verdict offline and map reversed order', async () => {
  const task = await demoTask();
  const provider = mockProvider((ref) => ref.sha256);
  for (const architecture of ['a', 'b', 'c', 'd']) {
    const result = await evaluateArchitecture(task, provider, {
      architecture,
      model: 'fixture-v1',
      reverse: true,
    });
    assert.equal(result.decision, 'Left', architecture);
    assert.equal(result.stage, 'prompt_adherence', architecture);
    assert.equal(result.verification.consistent, true, architecture);
    assert.equal(result.diagnostics.architecture, architecture === 'a' ? 'a' : architecture);
    const calls = result.diagnostics.stages.length;
    if (architecture === 'a') assert.equal(calls, 1);
    if (architecture === 'b') assert.ok(calls >= 2);
    if (architecture === 'c') assert.ok(calls >= 3);
    if (architecture === 'd') assert.ok(calls >= 1);
  }
});

test('verification applies only explicit corrections and keeps an audit trail', () => {
  const task = createTask();
  task.request = 'Use a purple button.';
  const observation = referenceObservation({
    request: task.request,
    vocabulary: ['button'],
    requirements: [
      {
        excerpt: 'purple button',
        kind: 'style',
        scope: 'visible',
        status: { Left: 'uncertain', Right: 'missing' },
      },
    ],
    defects: [{ side: 'Left', type: 'contrast', severity: 'major' }],
    reference: { decision: null, stage: 'review' },
  });
  const claims = claimsFor(observation);
  assert.deepEqual(
    claims.map((c) => c.target),
    ['R1:Left', 'D1'],
  );
  const verification = {
    checks: [
      {
        target: 'R1:Left',
        verdict: 'refuted',
        suggested: 'met',
        evidence: { Left: 'the button is purple', Right: 'the button is red' },
        note: 'the button reads purple',
      },
      { target: 'D1', verdict: 'refuted', suggested: 'remove', evidence: { Left: 'x', Right: 'y' }, note: 'no defect' },
    ],
  };
  validateVerify(verification, claims);
  const applied = applyVerification(observation, verification, claims);
  assert.equal(applied.observation.requirements[0].status.Left, 'met');
  assert.equal(applied.observation.defects.length, 0);
  assert.equal(applied.corrections.filter((c) => c.applied).length, 2);
  assert.throws(() =>
    validateVerify(
      { checks: [{ target: 'R9', verdict: 'confirmed', suggested: '', evidence: { Left: 'x', Right: 'y' }, note: '' }] },
      claims,
    ),
  );
  assert.throws(() =>
    validateVerify(
      {
        checks: [
          { target: 'R1:Left', verdict: 'refuted', suggested: 'purple', evidence: { Left: 'x', Right: 'y' }, note: '' },
        ],
      },
      claims,
    ),
  );
});

test('PNG crops preserve pixels for targeted verification and pass through unchanged', async () => {
  const bytes = await readFile(new URL('../fixtures/images/standard.png', import.meta.url));
  const image = decodePng(bytes);
  assert.equal(image.width, 700);
  assert.equal(image.height, 390);
  const crop = cropImage(image, { x: 10, y: 20, width: 64, height: 32 });
  const round = decodePng(encodePng(crop));
  assert.deepEqual([...round.data], [...crop.data]);
  const url = 'data:image/png;base64,' + bytes.toString('base64');
  const region = cropDataUrl(url, { side: 'Left', label: 'Left region', y0: 100, y1: 160 });
  const decoded = decodePng(Buffer.from(region.split(',')[1], 'base64'));
  assert.equal(decoded.width, 700);
  assert.equal(decoded.height, 60);
  assert.equal(cropDataUrl('data:image/jpeg;base64,AAAA', { side: 'Left', y0: 0, y1: 10 }), null);
});

test('pricing covers configured snapshots and refuses to invent unknown costs', () => {
  assert.deepEqual(pricingFor('gpt-4.1-mini'), [0.4, 0.1, 1.6]);
  assert.deepEqual(pricingFor('gpt-6.2-sol'), [2, 0.1, 10]);
  assert.equal(pricingFor('unknown-model'), null);
  assert.equal(estimatedUsd({ env: {}, models: [], actualModel: 'unknown-model', usage: { inputTokens: 1, outputTokens: 1 } }), null);
  const usd = estimatedUsd({
    env: {},
    models: [],
    actualModel: 'gpt-4.1-mini-2025-04-14',
    usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedTokens: 0 },
  });
  assert.equal(Number(usd.toFixed(6)), 2);
  assert.ok(substantiveBasis('slightly rounded corners are a reasonable interpretation'));
  assert.ok(!substantiveBasis('n/a'));
});


test('stage endpoint enforces origin, stage allowlist and image requirements', async () => {
  const { startServer } = await import('../server.mjs');
  const sentinel = 'stage-test-key';
  const server = await startServer(0, { OPENAI_API_KEY: sentinel, OLAF_MODELS: 'gpt-4.1-mini' });
  const url = 'http://127.0.0.1:' + server.address().port;
  try {
    const post = (body, origin = url) =>
      fetch(url + '/olaf/stage', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const base = { request: 'Use a purple button.', captureScope: 'viewport', model: 'gpt-4.1-mini' };
    assert.equal((await post({ ...base, stage: 'nope' }, 'https://example.invalid')).status, 403);
    assert.equal((await post({ ...base, stage: 'nope' })).status, 400);
    assert.equal((await post({ ...base, stage: 'inspection' })).status, 400);
    assert.equal(
      (
        await post({
          ...base,
          stage: 'adherence',
          images: { Left: 'https://example.invalid/a.png', Right: 'data:image/png;base64,AA==' },
        })
      ).status,
      502,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


test('single-pass guards convert contradicted statuses and distinguish unreadable pages from failed loading', () => {
  const observation = referenceObservation(cases.find((c) => c.id === 'clip-severe'));
  observation.rendering.Left = 'failed';
  observation.renderEvidence.Left = 'the page text is washed out and unreadable';
  observation.requirements[0].status.Left = 'alternative';
  observation.requirements[0].evidence.Left = 'the button is enabled and purple';
  observation.defects = [
    {
      side: 'Left',
      type: 'contrast',
      severity: 'major',
      location: 'whole page',
      evidence: { Left: 'the main text fades into the background', Right: 'the text is dark' },
    },
  ];
  const { observation: out, corrections } = normalizePerception(observation);
  assert.equal(out.rendering.Left, 'rendered');
  assert.equal(out.requirements[0].status.Left, 'missing');
  assert.equal(out.defects[0].severity, 'page_broken');
  assert.equal(corrections.length, 3);
  assert.equal(adjudicate(out).decision, 'Right');
});

