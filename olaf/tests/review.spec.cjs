const { test, expect } = require('@playwright/test');
const manifest = require('../fixtures/manifest.json');
let server, url, jsonl;
test.beforeAll(async () => {
  const { startServer } = await import('../server.mjs');
  server = await startServer(0, { OPENAI_API_KEY: 'review-test-only' });
  url = 'http://127.0.0.1:' + server.address().port;
  const { createTask } = await import('../engine/contracts.mjs');
  const { evaluateArchitecture } = await import('../engine/pipeline.mjs');
  const { mockProvider } = await import('../providers/mock.mjs');
  const task = createTask();
  task.request = 'Use a purple “View collection” button.';
  task.captureScope = 'viewport';
  for (const [side, name] of [
    ['Left', 'standard'],
    ['Right', 'red'],
  ]) {
    const f = manifest[name];
    task.images[side] = {
      id: side.toLowerCase() + '-fixture',
      width: f.width,
      height: f.height,
      bytes: f.bytes,
      sha256: f.hash,
      mime: 'image/png',
      source: 'synthetic',
      provenance: 'Rendered specimen',
    };
  }
  const result = await evaluateArchitecture(task, mockProvider((ref) => ref.sha256), {
    architecture: 'a',
    model: 'fixture-v1',
    reverse: true,
  });
  jsonl = Buffer.from(
    JSON.stringify({
      case: 'button',
      model: 'fixture-v1',
      architecture: 'a',
      repeat: 1,
      expected: 'Left',
      expectedStage: 'prompt_adherence',
      decision: result.decision,
      stage: result.stage,
      confidence: result.confidence,
      consistent: result.verification.consistent,
      latencyMs: result.telemetry.latencyMs,
      estimatedUsd: 0,
      result,
      valid: true,
    }) + '\n',
  );
});
test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});
test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.outgoing = [];
  page.on('pageerror', (event) => page.errors.push(event.message));
  page.on('console', (message) => {
    if (message.type() === 'error') page.errors.push(message.text());
  });
  page.on('request', (request) => {
    if (!request.url().startsWith(url) && /^https?:/.test(request.url())) page.outgoing.push(request.url());
  });
  await page.goto(url + '/olaf-review.html');
});
test.afterEach(async ({ page }) => {
  expect(page.errors).toEqual([]);
  expect(page.outgoing).toEqual([]);
});
test('review workspace shows reference, model judgment, images, trace and reverse order', async ({ page }) => {
  await page.locator('#jsonl').setInputFiles({ name: 'run.jsonl', mimeType: 'application/jsonl', buffer: jsonl });
  await expect(page.locator('#loaded')).toBeVisible();
  await expect(page.locator('#runSummary')).toContainText('Loaded runs');
  await page.locator('#onlyDisputes').uncheck();
  await expect(page.locator('#caseList')).toContainText('button');
  await page.locator('#caseList button').first().click();
  await expect(page.locator('#detail')).toContainText('Use a purple');
  await expect(page.locator('#detail')).toContainText('Fixed reference');
  await expect(page.locator('#detail')).toContainText('Left / prompt_adherence');
  await expect(page.locator('#detail')).toContainText('Actual model judgment');
  await expect(page.locator('#detail')).toContainText('Decision trace');
  await expect(page.locator('#detail')).toContainText('Reverse-order result');
  const images = page.locator('#detail img');
  await expect(images).toHaveCount(2);
  await expect
    .poll(() => images.first().evaluate((img) => img.naturalWidth))
    .toBeGreaterThan(600);
});

test('independent adjudication is stored separately and can be cleared', async ({ page }) => {
  await page.locator('#jsonl').setInputFiles({ name: 'run.jsonl', mimeType: 'application/jsonl', buffer: jsonl });
  await page.locator('#onlyDisputes').uncheck();
  await page.locator('#caseList button').first().click();
  await page.locator('.adjudication select').selectOption('defensible');
  await page.locator('.adjudication input').fill('reviewer-1');
  await page.locator('.adjudication textarea').fill('Reference is provisional; both sides are defensible.');
  await page.locator('.adjudication button').click();
  await expect(page.locator('#recordList')).toContainText('defensible');
  await expect(page.locator('#detail')).toContainText('Left / prompt_adherence');
  await page.reload();
  await expect(page.locator('#records')).toBeVisible();
  await expect(page.locator('#recordList')).toContainText('reviewer-1');
  await page.locator('#clearRecords').click();
  await expect(page.locator('#recordList')).toContainText('No independent adjudications recorded yet');
  const stored = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('olaf-review');
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('adjudications', 'readonly').objectStore('adjudications').getAll();
          request.onsuccess = () => resolve(request.result.length);
        };
      }),
  );
  expect(stored).toBe(0);
});
