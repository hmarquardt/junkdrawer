const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.use({ channel: 'chrome' });
const url = `file://${path.resolve(process.cwd(), 'webdev-side-by-side-workbench.html')}`;
const REAL_MWEB = path.join(process.env.HOME || '', 'Downloads', 'WebDev side-by-side rating1.mhtml');

const FUNC = ['No testable functionality', 'Works', 'Partly works', 'Does not work'];
const COMP = ['Left', 'About equal', 'Right'];
const REASONS = ['Functionality', 'Requirements coverage', 'Useful added capability', 'Visual quality', 'No meaningful difference'];
const FORM_FIELD_ORDER = [
  'functional_correctness_left', 'functional_correctness_left_evidence',
  'functional_correctness_right', 'functional_correctness_right_evidence',
  'requirements_coverage_choice', 'requirements_coverage_evidence',
  'product_depth_choice', 'product_depth_evidence',
  'aesthetics_choice', 'aesthetics_evidence',
  'overall_preference_choice', 'overall_preference_primary_reason', 'overall_preference_optional_comment'
];

/* ---------- synthetic MHTML fixture ---------- */

const BOUNDARY = '----MultipartBoundary--JDTEST----';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function qp(text) {
  return String(text).replace(/=/g, '=3D');
}

function mimePart(headers, body) {
  return `\n--${BOUNDARY}\n${headers}\n\n${body}\n`;
}

function formControls() {
  const buttons = (id, values) => `<div id="${id}" role="group">${values.map(v => `<button type="button" value="${v}">${v}</button>`).join('')}</div>`;
  return [
    buttons('root_functional_correctness_left', FUNC),
    '<textarea id="root_functional_correctness_left_evidence"></textarea>',
    buttons('root_functional_correctness_right', FUNC),
    '<textarea id="root_functional_correctness_right_evidence"></textarea>',
    buttons('root_requirements_coverage_choice', COMP),
    '<textarea id="root_requirements_coverage_evidence"></textarea>',
    buttons('root_product_depth_choice', COMP),
    '<textarea id="root_product_depth_evidence"></textarea>',
    buttons('root_aesthetics_choice', COMP),
    '<textarea id="root_aesthetics_evidence"></textarea>',
    buttons('root_overall_preference_choice', COMP),
    buttons('root_overall_preference_primary_reason', REASONS),
    '<textarea id="root_overall_preference_optional_comment"></textarea>'
  ].join('');
}

function buildFixture(options = {}) {
  const prompt = options.prompt || [
    'Build a todo app. It must include an input for a new task, an Add button that appends the task to the list, and a Delete control for each task.',
    'No authentication is required.'
  ].join('\n\n');
  const includeCandidates = options.includeCandidates !== false;
  const includeImage = options.includeImage === true;
  const leftBody = options.leftBody || '<h1>Todo</h1><img src="https://cdn.example.invalid/hero.png" alt="hero"><ul class="list"></ul><input id="task" placeholder="New task"><button>Add</button><button>Clear</button>';
  const rightBody = options.rightBody || '<h1>Task Manager</h1><ul class="list"></ul><input id="task" placeholder="New task"><button>Add</button>';
  const promptHtml = prompt.split('\n\n').map(p => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('');
  const iframes = includeCandidates
    ? '<iframe src="cid:frame-left@mhtml.blink" title="Left"></iframe><iframe src="cid:frame-right@mhtml.blink" title="Right"></iframe>'
    : '';
  const withPrompt = options.includePrompt !== false ? `<h3>Task prompt</h3>${promptHtml}` : '';
  const taskHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>WebDev side-by-side rating</title></head><body>${withPrompt}<h3>Left</h3><h3>Right</h3>${iframes}${formControls()}<p>No outputs captured yet</p><p>No outputs captured yet</p></body></html>`;
  const leftCandidate = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Todo Left</title><link rel="stylesheet" href="cid:css-left@mhtml.blink"></head><body>${leftBody}</body></html>`;
  const rightCandidate = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Todo Right</title><link rel="stylesheet" href="cid:css-right@mhtml.blink"></head><body>${rightBody}</body></html>`;
  const wrapper = inner => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>App preview</title></head><body><main id="preview"><iframe src="${inner}" title="App preview"></iframe></main></body></html>`;
  const htmlHeaders = (id, location) => `Content-Type: text/html\nContent-Transfer-Encoding: quoted-printable\nContent-ID: <${id}>\nContent-Location: ${location}`;
  const parts = [
    mimePart(htmlHeaders('frame-task@mhtml.blink', 'https://fixture.example/tasks/1'), qp(taskHtml))
  ];
  if (includeCandidates) {
    parts.push(
      mimePart(htmlHeaders('frame-left@mhtml.blink', 'https://left.example/feather-mobile-preview.html'), qp(wrapper('cid:frame-left-candidate@mhtml.blink'))),
      mimePart(htmlHeaders('frame-right@mhtml.blink', 'https://right.example/feather-mobile-preview.html'), qp(wrapper('cid:frame-right-candidate@mhtml.blink'))),
      mimePart(htmlHeaders('frame-left-candidate@mhtml.blink', 'https://left.example/'), qp(leftCandidate)),
      mimePart(htmlHeaders('frame-right-candidate@mhtml.blink', 'https://right.example/'), qp(rightCandidate)),
      mimePart('Content-Type: text/css\nContent-Transfer-Encoding: quoted-printable\nContent-Location: cid:css-left@mhtml.blink', qp('body{font-family:sans-serif}.list{margin:0}@media(max-width:600px){body{padding:4px}}')),
      mimePart('Content-Type: text/css\nContent-Transfer-Encoding: quoted-printable\nContent-Location: cid:css-right@mhtml.blink', qp('.list{display:grid}@media(max-width:600px){.list{display:block}}'))
    );
  }
  if (includeImage) parts.push(mimePart('Content-Type: image/png\nContent-Transfer-Encoding: base64\nContent-Location: cid:shot-left@mhtml.blink', PNG));
  return [
    'From: <Saved by Blink>',
    'Snapshot-Content-Location: https://fixture.example/tasks/1',
    'Subject: WebDev side-by-side rating',
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; type="text/html"; boundary="${BOUNDARY}"`,
    '',
    ...parts,
    `\n--${BOUNDARY}--\n`
  ].join('\n');
}

/* ---------- page helpers ---------- */

async function open(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('analytics-lite')) errors.push(message.text()); });
  await page.route('**/api/analytics/**', route => route.fulfill({ status: 204, body: '' }));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__WEBDEV_SBS_TEST__));
  return errors;
}

async function upload(page, name, text, type = 'multipart/related') {
  return page.evaluate(({ name, text, type }) => window.__WEBDEV_SBS_TEST__.uploadText(name, text, type), { name, text, type });
}

async function openAdvanced(page) {
  await page.evaluate(() => {
    document.getElementById('advancedWorkbench').open = true;
    document.querySelectorAll('#advancedWorkbench details.subcard').forEach(detail => { detail.open = true; });
  });
}

async function openSettings(page) {
  await page.locator('#openSettings').click();
  await expect(page.locator('#settingsModal')).toBeVisible();
}

const CATALOG = [
  { id: 'openai/gpt-4.1-mini', name: 'GPT 4.1 mini', supported_parameters: ['response_format', 'structured_outputs', 'temperature', 'max_tokens', 'max_completion_tokens'], architecture: { input_modalities: ['text', 'image', 'file'], output_modalities: ['text'] }, top_provider: { context_length: 128000, max_completion_tokens: 16384, is_moderated: false } },
  { id: 'anthropic/claude-test', name: 'Claude test', supported_parameters: ['response_format', 'structured_outputs', 'temperature', 'max_tokens'], architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, top_provider: { context_length: 200000, max_completion_tokens: 8192, is_moderated: false } },
  { id: 'meta/text-only', name: 'Text Only', supported_parameters: ['response_format', 'structured_outputs', 'temperature', 'max_tokens'], architecture: { input_modalities: ['text'], output_modalities: ['text'] }, top_provider: { context_length: 32000 } }
];

async function installCatalog(page, models = CATALOG) {
  await page.route('https://openrouter.ai/api/v1/models', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: models }) }));
}

async function configureAI(page, models = CATALOG) {
  await installCatalog(page, models);
  await openSettings(page);
  await page.locator('#orKey').fill('test-local-key');
  await page.locator('#orKey').press('Tab');
  await expect(page.locator('#orModelStatus')).toContainText('models loaded');
  await page.locator('#orEnabled').check();
  await page.locator('#saveSettings').click();
  await expect(page.locator('#settingsModal')).toBeHidden();
}

function aiReply(value) {
  return { choices: [{ message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }] };
}

async function installWorkflowMock(page, options = {}) {
  const requests = [];
  await page.route('https://openrouter.ai/api/v1/chat/completions', async route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    const name = body.response_format?.json_schema?.name;
    let payload = {};
    const rawContent = body.messages[1].content;
    if (typeof rawContent === 'string') { try { payload = JSON.parse(rawContent); } catch {} }
    else if (Array.isArray(rawContent)) { const textPart = rawContent.find(part => part.type === 'text'); if (textPart) { try { payload = JSON.parse(textPart.text); } catch {} } }
    let content;
    if (name === 'webdev_requirements') {
      const prompt = payload.prompt || '';
      const quoted = prompt.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 15).slice(0, 2);
      content = { requirements: quoted.map((wording, i) => ({ label: 'Requirement ' + (i + 1), wording, category: i ? 'Component' : 'Interaction', explicit: true, testable: i === 0, notes: '' })) };
    } else if (name === 'webdev_judgment') {
      const facts = payload.facts || [];
      const pick = (prefix, n = 1) => facts.filter(f => f.id.startsWith(prefix)).slice(0, n).map(f => f.id);
      const anyId = pick('cand:left').length ? pick('cand:left') : [facts[0]?.id].filter(Boolean);
      const aesthetics = options.aesthetics
        ? { ...options.aesthetics, source_ids: options.aesthetics.source_ids && options.aesthetics.source_ids.length ? options.aesthetics.source_ids : (pick('archive:visual').length ? pick('archive:visual') : anyId) }
        : { choice: 'About equal', basis: 'visual', rationale: 'Both use a similar layout.', confidence: 'low', source_ids: pick('archive:visual') };
      content = {
        functional_correctness: {
          left: { choice: 'Works', rationale: 'Static markup includes the requested controls.', confidence: 'low', source_ids: anyId },
          right: { choice: 'Partly works', rationale: 'Static markup lacks one requested control.', confidence: 'low', source_ids: pick('cand:right').length ? pick('cand:right') : anyId }
        },
        requirements_coverage: { choice: 'About equal', rationale: 'Both list the requested items.', confidence: 'low', source_ids: pick('archive:').length ? pick('archive:') : anyId },
        product_depth: { choice: 'Right', rationale: 'The right candidate lists an extra control.', confidence: 'low', source_ids: pick('cand:right').length ? pick('cand:right') : anyId },
        aesthetics,
        overall_preference: { choice: 'Left', primary_reason: 'Functionality', optional_comment: 'The left candidate covers the requested controls in its static markup. The right candidate is missing one requested control.', rationale: 'Functional difference.', confidence: 'low', source_ids: anyId }
      };
    } else if (name === 'webdev_visual_judgment') {
      content = options.visual || {
        choice: 'Right',
        evidence: 'The right one keeps its three-column grid on mobile, while the left clips the last card.',
        observations: {
          left_desktop: ['Three cards fit cleanly across the page.'],
          left_mobile: ['The last card is clipped at the right edge.'],
          right_desktop: ['Cards keep even spacing.'],
          right_mobile: ['Cards stack into a single column without clipping.']
        },
        confidence: 'medium'
      };
    } else if (name === 'webdev_workflow_evidence') {
      content = {
        functional_correctness_left_evidence: 'The left static markup includes the requested input, Add control, and Clear control.',
        functional_correctness_right_evidence: 'The right static markup includes the input and the Add control and the list region.',
        requirements_coverage_evidence: 'Both candidates include the requested input and Add control in their static markup.',
        product_depth_evidence: 'The right candidate lists a task counter control the left candidate does not.',
        aesthetics_evidence: 'Both candidates use a similar single-column layout with system fonts.'
      };
    } else {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'unexpected schema ' + name } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(aiReply(content)) });
  });
  return requests;
}

/* ---------- new primary workflow tests ---------- */

test('MHTML upload via the file input parses the archive and enables analysis', async ({ page }) => {
  const errors = await open(page);
  await page.setInputFiles('#mwebFile', { name: 'rating.mhtml', mimeType: 'multipart/related', buffer: Buffer.from(buildFixture()) });
  await expect(page.locator('#fileName')).toHaveText('rating.mhtml');
  await expect(page.locator('#parseStatus')).toContainText('Parsed');
  await expect(page.locator('#parseStatus')).toContainText('prompt found');
  await expect(page.locator('#analyze')).toBeEnabled();
  const summary = await page.evaluate(() => {
    const s = window.__WEBDEV_SBS_TEST__.state().source;
    return { parsed: s.parsed, promptFound: s.promptFound, left: !!s.candidates.left, right: !!s.candidates.right, leftCss: s.candidates.left.css.length, rightCss: s.candidates.right.css.length, visual: s.visualEvidence };
  });
  expect(summary).toEqual({ parsed: true, promptFound: true, left: true, right: true, leftCss: expect.any(Number), rightCss: expect.any(Number), visual: false });
  expect(summary.leftCss).toBeGreaterThan(0);
  expect(summary.rightCss).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('drag and drop upload parses the same archive', async ({ page }) => {
  const errors = await open(page);
  const text = buildFixture();
  await page.evaluate(text => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'dropped.mhtml', { type: 'multipart/related' }));
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: dt });
    document.getElementById('dropzone').dispatchEvent(event);
  }, text);
  await expect(page.locator('#fileName')).toHaveText('dropped.mhtml');
  await expect(page.locator('#parseStatus')).toContainText('Parsed');
  await expect(page.locator('#analyze')).toBeEnabled();
  expect(await page.evaluate(() => window.__WEBDEV_SBS_TEST__.state().source.candidates.right.title)).toBe('Todo Right');
  expect(errors).toEqual([]);
});

test('original prompt and live-form structure are extracted from the task document', async ({ page }) => {
  const errors = await open(page);
  await upload(page, 'rating.mhtml', buildFixture());
  const result = await page.evaluate(() => {
    const t = window.__WEBDEV_SBS_TEST__;
    const s = t.state().source;
    return { prompt: t.state().prompt, source: s.promptSource, missing: t.compareFormStructure(s.formStructure).filter(r => !r.found), groups: Object.keys(s.formStructure.groups).length, textareas: s.formStructure.textareas.length };
  });
  expect(result.source).toBe('heading');
  expect(result.prompt).toContain('Build a todo app. It must include an input for a new task');
  expect(result.prompt).toContain('No authentication is required.');
  expect(result.missing).toEqual([]);
  expect(result.groups).toBe(7);
  expect(result.textareas).toBe(6);
  expect(errors).toEqual([]);
});

test('archive parsing failure explains itself and disables analysis', async ({ page }) => {
  const errors = await open(page);
  await upload(page, 'broken.mhtml', 'this is not an archive and not html at all');
  await expect(page.locator('#parseStatus')).toContainText('Parse failed');
  await expect(page.locator('#analyze')).toBeDisabled();
  await expect(page.locator('#analyzeHint')).toContainText('Parse failed');
  const state = await page.evaluate(() => ({ parsed: window.__WEBDEV_SBS_TEST__.state().source.parsed, error: window.__WEBDEV_SBS_TEST__.state().source.parseError }));
  expect(state.parsed).toBe(false);
  expect(state.error.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('missing candidate evidence is reported instead of invented', async ({ page }) => {
  const errors = await open(page);
  await upload(page, 'no-candidates.mhtml', buildFixture({ includeCandidates: false }));
  await expect(page.locator('#analyze')).toBeEnabled();
  await expect(page.locator('#analyzeHint')).toContainText('candidate missing');
  await page.locator('#analyze').click();
  await expect(page.locator('#stageResults')).toBeVisible();
  const result = await page.evaluate(() => {
    const t = window.__WEBDEV_SBS_TEST__, s = t.state();
    return {
      left: s.source.candidates.left, right: s.source.candidates.right,
      warnings: s.analysis.warnings.join('\n'), meta: s.analysis.fieldMeta,
      aesthetics: t.canonical().aesthetics,
      coverage: t.canonical().requirements_coverage
    };
  });
  expect(result.left).toBeNull();
  expect(result.right).toBeNull();
  expect(result.warnings).toContain('candidate');
  expect(result.aesthetics.choice).toBe('');
  expect(result.meta.aesthetics_choice.basis).toBe('unavailable');
  expect(result.coverage.choice).toBe('');
  expect(errors).toEqual([]);
});

test('complete analysis proposes all 13 live-form fields with rendered visual evidence', async ({ page }) => {
  const errors = await open(page);
  const requests = await installWorkflowMock(page);
  await configureAI(page);
  await upload(page, 'rating.mhtml', buildFixture({ includeImage: true }));
  await page.locator('#analyze').click();
  await expect(page.locator('#stageResults')).toBeVisible();
  await expect(page.locator('#resultList .result-row')).toHaveCount(13);
  await expect(page.locator('#resultsCount')).toHaveText('13 / 13');
  const visionRequest = requests.find(r => r.response_format?.json_schema?.name === 'webdev_visual_judgment');
  expect(Array.isArray(visionRequest.messages[1].content)).toBe(true);
  expect(visionRequest.messages[1].content.filter(part => part.type === 'image_url')).toHaveLength(4);
  expect(visionRequest.model).toBe('openai/gpt-4.1-mini');
  const judgmentRequest = requests.find(r => r.response_format?.json_schema?.name === 'webdev_judgment');
  expect(typeof judgmentRequest.messages[1].content).toBe('string');
  expect(judgmentRequest.messages[1].content).toContain('renderedVisualAnalysis');
  const result = await page.evaluate(() => {
    const t = window.__WEBDEV_SBS_TEST__;
    const values = {};
    for (const key of t.FORM_FIELD_ORDER) values[key] = t.resultValue(key);
    return { values, structural: t.validatePayload(t.canonical(), { complete: true }), stages: t.state().analysis.stages.map(x => x.status), aestheticsMeta: t.state().analysis.fieldMeta.aesthetics_choice, visuals: t.visualObservations(), badge: document.querySelector('[data-result="aesthetics_choice"] .basis-badge')?.textContent || '' };
  });
  for (const key of FORM_FIELD_ORDER) expect(String(result.values[key]).length).toBeGreaterThan(0);
  expect(result.structural).toEqual([]);
  expect(result.stages.every(x => x === 'done')).toBe(true);
  expect(result.aestheticsMeta.basis).toBe('rendered');
  expect(result.badge).toContain('Rendered archive evidence');
  expect(result.visuals.basis).toBe('rendered');
  expect(result.visuals.observations.left_mobile.length).toBeGreaterThan(0);
  await openAdvanced(page);
  await expect(page.locator('#renderedShotsView')).toContainText('Visible observations');
  await expect(page.locator('#renderedShotsView')).toContainText('Cards stack into a single column without clipping.');
  await expect(page.locator('#renderedShotsView .shot')).toHaveCount(4);
  expect(errors).toEqual([]);
});

test('rasterization failure does not fabricate aesthetics', async ({ page }) => {
  const errors = await open(page);
  const requests = await installWorkflowMock(page);
  await configureAI(page);
  await page.evaluate(() => window.__WEBDEV_SBS_TEST__.forceRasterFailure(true));
  await upload(page, 'rating.mhtml', buildFixture());
  await page.locator('#analyze').click();
  await expect(page.locator('#stageResults')).toBeVisible();
  const result = await page.evaluate(() => {
    const t = window.__WEBDEV_SBS_TEST__;
    return { aesthetics: t.canonical().aesthetics, meta: t.state().analysis.fieldMeta, warnings: t.state().analysis.warnings.join('\n'), failure: t.rasterFailure(), shots: t.shotsMeta(), badge: document.querySelector('[data-result="aesthetics_choice"] .basis-badge')?.textContent || '' };
  });
  expect(result.aesthetics.choice).toBe('');
  expect(result.aesthetics.evidence).toBe('');
  expect(result.meta.aesthetics_choice.basis).toBe('unavailable');
  expect(result.badge.toLowerCase()).toContain('unavailable');
  expect(result.failure).toContain('rasterization');
  expect(result.shots).toBeNull();
  expect(result.warnings).toContain('Rendered visual evidence unavailable');
  expect(requests.find(r => r.response_format?.json_schema?.name === 'webdev_visual_judgment')).toBeUndefined();
  expect(errors).toEqual([]);
});

test('recovered HTML/CSS renders desktop and mobile snapshots and records limitations', async ({ page }) => {
  const errors = await open(page);
  await configureAI(page);
  await upload(page, 'rating.mhtml', buildFixture());
  const result = await page.evaluate(async () => {
    const t = window.__WEBDEV_SBS_TEST__;
    await t.renderCandidateShots();
    return { shots: t.shotsMeta(), limitations: t.renderLimitations(), failure: t.rasterFailure() };
  });
  expect(result.failure).toBe('');
  expect(result.shots.left.desktop.prefix).toBe('data:image/png;base64,');
  expect(result.shots.left.desktop.width).toBe(1440);
  expect(result.shots.left.desktop.height).toBe(900);
  expect(result.shots.left.mobile.width).toBe(390);
  expect(result.shots.left.mobile.height).toBe(844);
  expect(result.shots.right.desktop.prefix).toBe('data:image/png;base64,');
  expect(result.shots.right.mobile.prefix).toBe('data:image/png;base64,');
  expect(result.shots.left.desktop.bytes).not.toBe(result.shots.right.desktop.bytes);
  expect(result.shots.left.mobile.bytes).not.toBe(result.shots.right.mobile.bytes);
  expect(result.limitations.join('\n')).toContain('external');
  expect(result.limitations.join('\n')).toContain('scripts, event handlers, runtime state');
  await openAdvanced(page);
  await expect(page.locator('#renderedShotsView .shot')).toHaveCount(4);
  expect(errors).toEqual([]);
});

test('vision capability is detected from model metadata', async ({ page }) => {
  const errors = await open(page);
  await configureAI(page);
  const result = await page.evaluate(() => {
    const t = window.__WEBDEV_SBS_TEST__;
    const models = t.models();
    return {
      vision: t.modelCapability(models.find(m => m.id === 'openai/gpt-4.1-mini')).vision,
      textOnly: t.modelCapability(models.find(m => m.id === 'meta/text-only')).vision,
      fallback: t.effectiveVisualModel()
    };
  });
  expect(result.vision).toBe(true);
  expect(result.textOnly).toBe(false);
  expect(result.fallback).toBe('openai/gpt-4.1-mini');
  expect(errors).toEqual([]);
});

test('text-only models do not receive image requests', async ({ page }) => {
  const errors = await open(page);
  const requests = await installWorkflowMock(page);
  await configureAI(page, [{ id: 'meta/text-only', name: 'Text Only', supported_parameters: ['response_format', 'structured_outputs', 'temperature', 'max_tokens'], architecture: { input_modalities: ['text'] }, top_provider: {} }]);
  await upload(page, 'rating.mhtml', buildFixture());
  await page.locator('#analyze').click();
  await expect(page.locator('#stageResults')).toBeVisible();
  expect(requests.find(r => r.response_format?.json_schema?.name === 'webdev_visual_judgment')).toBeUndefined();
  for (const request of requests) expect(Array.isArray(request.messages[1].content)).toBe(false);
  const result = await page.evaluate(() => {
    const t = window.__WEBDEV_SBS_TEST__;
    return { aesthetics: t.canonical().aesthetics, meta: t.state().analysis.fieldMeta.aesthetics_choice, visuals: t.visualObservations() };
  });
  expect(result.aesthetics.choice).toBe('');
  expect(result.meta.basis).toBe('unavailable');
  expect(result.visuals).toBeNull();
  expect(errors).toEqual([]);
});

test('a separate visual model can be selected for image analysis', async ({ page }) => {
  const errors = await open(page);
  const requests = await installWorkflowMock(page);
  await configureAI(page, [
    { id: 'meta/text-only', name: 'Text Only', supported_parameters: ['response_format', 'structured_outputs', 'temperature', 'max_tokens'], architecture: { input_modalities: ['text'] }, top_provider: {} },
    { id: 'vendor/vision', name: 'Vision Model', supported_parameters: ['response_format', 'structured_outputs', 'temperature', 'max_tokens'], architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, top_provider: {} }
  ]);
  await openSettings(page);
  await page.locator('#orModel').selectOption('meta/text-only');
  await page.locator('#orVisualModel').selectOption('vendor/vision');
  await page.locator('#saveSettings').click();
  await upload(page, 'rating.mhtml', buildFixture());
  await page.locator('#analyze').click();
  await expect(page.locator('#stageResults')).toBeVisible();
  const visionRequest = requests.find(r => r.response_format?.json_schema?.name === 'webdev_visual_judgment');
  expect(visionRequest.model).toBe('vendor/vision');
  expect(visionRequest.messages[1].content.filter(part => part.type === 'image_url')).toHaveLength(4);
  const judgmentRequest = requests.find(r => r.response_format?.json_schema?.name === 'webdev_judgment');
  expect(judgmentRequest.model).toBe('meta/text-only');
  const result = await page.evaluate(() => {
    const t = window.__WEBDEV_SBS_TEST__;
    return { visual: t.visualObservations(), meta: t.state().analysis.fieldMeta.aesthetics_choice };
  });
  expect(result.visual.model).toBe('vendor/vision');
  expect(result.meta.basis).toBe('rendered');
  expect(errors).toEqual([]);
});

test('evidence writing follows the configurable writing style, requirements extraction does not', async ({ page }) => {
  const errors = await open(page);
  const requests = await installWorkflowMock(page);
  await configureAI(page);
  await openSettings(page);
  await page.locator('#orStyle').fill('Sentinel style: short, dry, and specific.');
  await page.locator('#orStyle').press('Tab');
  await page.locator('#saveSettings').click();
  await upload(page, 'rating.mhtml', buildFixture());
  await page.locator('#analyze').click();
  await expect(page.locator('#stageResults')).toBeVisible();
  const requirements = requests.find(r => r.response_format?.json_schema?.name === 'webdev_requirements');
  const evidence = requests.find(r => r.response_format?.json_schema?.name === 'webdev_workflow_evidence');
  const vision = requests.find(r => r.response_format?.json_schema?.name === 'webdev_visual_judgment');
  const judgment = requests.find(r => r.response_format?.json_schema?.name === 'webdev_judgment');
  expect(evidence.messages[0].content).toContain('Sentinel style: short, dry, and specific.');
  expect(vision.messages[0].content).toContain('Sentinel style: short, dry, and specific.');
  expect(judgment.messages[0].content).toContain('Sentinel style: short, dry, and specific.');
  expect(requirements.messages[0].content).not.toContain('Sentinel style');
  expect(errors).toEqual([]);
});

test('writing style persists locally', async ({ page }) => {
  const errors = await open(page);
  await openSettings(page);
  await page.locator('#orStyle').fill('Persisted style sentinel.');
  await page.locator('#orStyle').press('Tab');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('webdev-sbs.openrouter.v1')).style)).toBe('Persisted style sentinel.');
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__WEBDEV_SBS_TEST__));
  await openSettings(page);
  await expect(page.locator('#orStyle')).toHaveValue('Persisted style sentinel.');
  expect(await page.evaluate(() => window.__WEBDEV_SBS_TEST__.styleInstruction())).toBe('Persisted style sentinel.');
  expect(errors).toEqual([]);
});

/* ---------- OpenRouter capability handling ---------- */

test('model catalog preserves capability metadata', async ({ page }) => {
  const errors = await open(page);
  await configureAI(page);
  const result = await page.evaluate(() => {
    const t = window.__WEBDEV_SBS_TEST__;
    const models = t.models();
    return {
      gpt: models.find(m => m.id === 'openai/gpt-4.1-mini'),
      caps: Object.fromEntries(models.map(m => [m.id, t.modelCapability(m)]))
    };
  });
  expect(result.gpt.supported_parameters).toContain('structured_outputs');
  expect(result.gpt.architecture.input_modalities).toEqual(['text', 'image', 'file']);
  expect(result.gpt.top_provider.context_length).toBe(128000);
  expect(result.gpt.top_provider.max_completion_tokens).toBe(16384);
  expect(result.caps['openai/gpt-4.1-mini'].tier).toBe('compatible');
  expect(result.caps['openai/gpt-4.1-mini'].tokenParam).toBe('max_tokens');
  expect(errors).toEqual([]);
});

test('request parameters are built from advertised model capabilities', async ({ page }) => {
  const errors = await open(page);
  await configureAI(page, [
    { id: 'vendor/full', name: 'Full', supported_parameters: ['response_format', 'structured_outputs', 'temperature', 'max_tokens'], architecture: { input_modalities: ['text'] }, top_provider: {} },
    { id: 'vendor/notemp', name: 'No temperature', supported_parameters: ['response_format', 'structured_outputs', 'max_tokens'], architecture: { input_modalities: ['text'] }, top_provider: {} },
    { id: 'vendor/mct', name: 'Completion tokens', supported_parameters: ['response_format', 'structured_outputs', 'temperature', 'max_completion_tokens'], architecture: { input_modalities: ['text'] }, top_provider: {} },
    { id: 'vendor/jsononly', name: 'JSON only', supported_parameters: ['response_format', 'temperature'], architecture: { input_modalities: ['text'] }, top_provider: {} },
    { id: 'vendor/legacy', name: 'Legacy', supported_parameters: ['temperature', 'max_tokens'], architecture: { input_modalities: ['text'] }, top_provider: {} }
  ]);
  const built = await page.evaluate(() => {
    const t = window.__WEBDEV_SBS_TEST__;
    const byId = Object.fromEntries(t.models().map(m => [m.id, m]));
    const schema = { type: 'json_schema', json_schema: { name: 'x', strict: true, schema: { type: 'object' } } };
    const build = id => t.buildOpenRouterRequest(byId[id], { responseSchema: schema, systemInstruction: 'sys', userContent: { a: 1 }, tokens: 100 });
    return { full: build('vendor/full'), notemp: build('vendor/notemp'), mct: build('vendor/mct'), jsononly: build('vendor/jsononly'), legacy: build('vendor/legacy') };
  });
  expect(built.full.body.temperature).toBe(0.1);
  expect(built.full.body.max_tokens).toBe(100);
  expect(built.full.body.max_completion_tokens).toBeUndefined();
  expect(built.full.body.response_format.json_schema.strict).toBe(true);
  expect(built.full.body.provider.require_parameters).toBe(true);
  expect(built.full.sent).toEqual(['response_format', 'temperature', 'max_tokens']);

  expect(built.notemp.body.temperature).toBeUndefined();
  expect(built.notemp.body.max_tokens).toBe(100);
  expect(built.notemp.body.provider.require_parameters).toBe(true);
  expect(built.notemp.sent).toEqual(['response_format', 'max_tokens']);

  expect(built.mct.body.max_completion_tokens).toBe(100);
  expect(built.mct.body.max_tokens).toBeUndefined();
  expect(built.mct.sent).toEqual(['response_format', 'temperature', 'max_completion_tokens']);

  expect(built.jsononly.body.response_format.type).toBe('json_object');
  expect(built.jsononly.structuredMode).toBe('json');
  expect(built.jsononly.body.temperature).toBe(0.1);
  expect(built.jsononly.body.max_tokens).toBeUndefined();
  expect(built.jsononly.sent).toEqual(['response_format', 'temperature']);

  expect(built.legacy.body.response_format).toBeUndefined();
  expect(built.legacy.structuredMode).toBe('prompt');
  expect(built.legacy.sent).toEqual(['temperature', 'max_tokens']);
  expect(errors).toEqual([]);
});

test('Test selected model uses the same request builder and reports the provider', async ({ page }) => {
  const errors = await open(page);
  const bodies = [];
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'Test Provider', model: body.model, choices: [{ message: { content: '{"ok":true}' } }] }) });
  });
  await configureAI(page);
  await openSettings(page);
  await page.locator('#orTestModel').click();
  await expect(page.locator('#orModelStatus')).toContainText('Model ready · structured output verified');
  await expect(page.locator('#orModelStatus')).toContainText('Test Provider');
  expect(bodies).toHaveLength(1);
  const body = bodies[0];
  expect(body.response_format.json_schema.name).toBe('webdev_model_test');
  expect(body.response_format.json_schema.strict).toBe(true);
  expect(body.response_format.json_schema.schema.required).toEqual(['ok']);
  expect(body.temperature).toBe(0.1);
  expect(body.max_tokens).toBe(64);
  expect(body.provider.require_parameters).toBe(true);
  const expected = await page.evaluate(() => {
    const t = window.__WEBDEV_SBS_TEST__;
    const model = t.models().find(m => m.id === 'openai/gpt-4.1-mini');
    return t.buildOpenRouterRequest(model, { responseSchema: { type: 'json_schema', json_schema: { name: 'webdev_model_test', strict: true, schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } } } }, systemInstruction: 'Reply with a JSON object.', userContent: { probe: 'return ok true' }, tokens: 64 }).body;
  });
  expect(body).toEqual(expected);
  expect(errors).toEqual([]);
});

test('an incompatible model is detected before full analysis and blocks AI calls', async ({ page }) => {
  const errors = await open(page);
  let chatCalls = 0;
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => { chatCalls++; return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) });
  await configureAI(page, [{ id: 'vendor/legacy', name: 'Legacy', supported_parameters: ['temperature', 'max_tokens'], architecture: { input_modalities: ['text'] }, top_provider: {} }]);
  await openSettings(page);
  await page.locator('#orModel').selectOption('vendor/legacy');
  await page.locator('#saveSettings').click();
  await upload(page, 'rating.mhtml', buildFixture());
  await page.locator('#analyze').click();
  await expect(page.locator('#stageResults')).toBeVisible();
  await expect(page.locator('#resultList .result-row')).toHaveCount(13);
  expect(chatCalls).toBe(0);
  const result = await page.evaluate(() => {
    const t = window.__WEBDEV_SBS_TEST__;
    return { warnings: t.state().analysis.warnings.join('\n'), aesthetics: t.canonical().aesthetics, functional: t.canonical().functional_correctness.left.choice };
  });
  expect(result.warnings).toContain('model check failed');
  expect(result.aesthetics.choice).toBe('');
  expect(result.functional).toBe('');
  expect(errors).toEqual([]);
});

test('a saved incompatible model is flagged and switched only by explicit fallback', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('analytics-lite')) errors.push(message.text()); });
  await page.route('**/api/analytics/**', route => route.fulfill({ status: 204, body: '' }));
  await page.addInitScript(() => localStorage.setItem('webdev-sbs.openrouter.v1', JSON.stringify({ enabled: true, apiKey: 'test-local-key', model: 'vendor/missing' })));
  await installCatalog(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__WEBDEV_SBS_TEST__));
  expect(await page.evaluate(() => window.__WEBDEV_SBS_TEST__.orSettings().model)).toBe('vendor/missing');
  await openSettings(page);
  await page.locator('#orRefreshModels').click();
  await expect(page.locator('#orModelStatus')).toContainText('not in the catalog');
  await expect(page.locator('#orUseFallback')).toBeVisible();
  expect(await page.evaluate(() => window.__WEBDEV_SBS_TEST__.orSettings().model)).toBe('vendor/missing');
  await page.locator('#orUseFallback').click();
  expect(await page.evaluate(() => window.__WEBDEV_SBS_TEST__.orSettings().model)).toBe('openai/gpt-4.1-mini');
  await expect(page.locator('#orModelStatus')).toContainText('Switched to compatible model');
  expect(errors).toEqual([]);
});

test('an OpenRouter 404 routing error aborts the remaining AI stages', async ({ page }) => {
  const errors = await open(page);
  let chatCalls = 0;
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => {
    chatCalls++;
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { message: 'No endpoints found that can handle the requested parameters.' } }) });
  });
  await configureAI(page);
  await upload(page, 'rating.mhtml', buildFixture());
  await page.locator('#analyze').click();
  await expect(page.locator('#stageResults')).toBeVisible();
  await expect(page.locator('#resultList .result-row')).toHaveCount(13);
  expect(chatCalls).toBe(1);
  const result = await page.evaluate(() => {
    const t = window.__WEBDEV_SBS_TEST__;
    return { warnings: t.state().analysis.warnings.join('\n'), failure: t.state().analysis.openRouterFailure, stages: t.state().analysis.stages.map(x => x.status) };
  });
  expect(result.failure).toContain('routing failed');
  expect(result.warnings).toContain('Remaining AI stages were skipped');
  expect(result.stages[4]).toBe('done');
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.every(message => message.includes('404'))).toBe(true);
});

test('OpenRouter diagnostics name the model and parameters without the API key', async ({ page }) => {
  const errors = await open(page);
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { message: 'No endpoints found that can handle the requested parameters.' } }) }));
  await configureAI(page);
  await upload(page, 'rating.mhtml', buildFixture());
  await page.locator('#analyze').click();
  await expect(page.locator('#stageResults')).toBeVisible();
  await openAdvanced(page);
  const text = await page.locator('#orDiagnostics').textContent();
  expect(text).toContain('openai/gpt-4.1-mini');
  expect(text).toContain('HTTP 404');
  expect(text).toContain('response_format');
  expect(text).toContain('temperature');
  expect(text).toContain('require_parameters: yes');
  expect(text).toContain('Likely incompatible parameter');
  expect(text).not.toContain('test-local-key');
  expect(text).not.toContain('Bearer');
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.every(message => message.includes('404'))).toBe(true);
});

test('a blank optional comment produces no validation warning', async ({ page }) => {
  const errors = await open(page);
  const result = await page.evaluate(() => {
    const t = window.__WEBDEV_SBS_TEST__;
    return {
      blankLint: t.lint(),
      blankFlags: t.commentFlags(''),
      shortFlags: t.commentFlags('Only one sentence.'),
      goodFlags: t.commentFlags('The left app wins because it works. The right app loses because it is missing the table.')
    };
  });
  expect(result.blankLint.join('\n')).not.toContain('Optional comment');
  expect(result.blankFlags).toEqual([]);
  expect(result.shortFlags.join(' ')).toContain('2–4 sentences');
  expect(result.goodFlags).toEqual([]);
  expect(errors).toEqual([]);
});

test('mobile layout stays narrow on upload and results', async ({ page }) => {
  const errors = await open(page);
  await installWorkflowMock(page);
  await configureAI(page);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await upload(page, 'rating.mhtml', buildFixture({ includeImage: true }));
  await page.locator('#analyze').click();
  await expect(page.locator('#resultList .result-row')).toHaveCount(13);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: '/tmp/webdev-workbench-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('manual and advanced workflow remains accessible', async ({ page }) => {
  const errors = await open(page);
  await upload(page, 'rating.mhtml', buildFixture());
  await openAdvanced(page);
  await expect(page.locator('#prompt')).toHaveValue(/Build a todo app/);
  await page.locator('#extractRequirements').click();
  await expect(page.locator('#requirementsList .req-card')).toHaveCount(3);
  await expect(page.locator('#observationRows tr')).toHaveCount(3);
  await expect(page.locator('#aiExtract')).toBeVisible();
  await openSettings(page);
  await expect(page.locator('#orKey')).toBeVisible();
  await page.locator('#closeSettings').click();
  await expect(page.locator('#submissionPreview').locator('dt')).toHaveCount(13);
  expect(await page.locator('#candidatePreviews iframe').first().getAttribute('srcdoc')).toContain('Todo');
  expect(await page.locator('#rawArchive').textContent()).toContain('Todo Left');
  expect(errors).toEqual([]);
});

/* ---------- preserved behavior ---------- */

test('draft round trip, legal choices, 200-character evidence, and sentence warnings', async ({ page }) => {
  const errors = await open(page);
  const result = await page.evaluate(({ FUNC, COMP, REASONS }) => {
    const t = window.__WEBDEV_SBS_TEST__;
    const initial = t.canonical();
    t.importPayload(JSON.parse(JSON.stringify(initial)));
    const roundTrip = JSON.stringify(t.canonical()) === JSON.stringify(initial);
    const legal = FUNC.map(choice => {
      const p = structuredClone(initial);
      p.functional_correctness.left.choice = choice;
      t.importPayload(p);
      return t.canonical().functional_correctness.left.choice;
    });
    const comparisons = COMP.map(choice => {
      const p = structuredClone(initial);
      for (const key of ['requirements_coverage', 'product_depth', 'aesthetics']) p[key].choice = choice;
      p.overall_preference.choice = choice;
      t.importPayload(p);
      const out = t.canonical();
      return [out.requirements_coverage.choice, out.product_depth.choice, out.aesthetics.choice, out.overall_preference.choice];
    });
    const reasons = REASONS.map(primary_reason => {
      const p = structuredClone(initial);
      p.overall_preference.primary_reason = primary_reason;
      t.importPayload(p);
      return t.canonical().overall_preference.primary_reason;
    });
    const edge = t.evidenceFlags('requirements_coverage', 'x'.repeat(200) + '.');
    const exact = t.evidenceFlags('requirements_coverage', 'x'.repeat(199) + '.');
    const multi = t.evidenceFlags('requirements_coverage', 'First sentence. Second sentence.');
    return { roundTrip, legal, comparisons, reasons, edge, exact, multi };
  }, { FUNC, COMP, REASONS });
  expect(result.roundTrip).toBe(true);
  expect(result.legal).toEqual(FUNC);
  expect(result.comparisons).toEqual(COMP.map(x => [x, x, x, x]));
  expect(result.reasons).toEqual(REASONS);
  expect(result.edge).toContain('Over 200 characters');
  expect(result.exact).not.toContain('Over 200 characters');
  expect(result.multi).toContain('Use one sentence');
  expect(errors).toEqual([]);
});

test('requirements, observations, contradictions, and local restore', async ({ page }) => {
  const errors = await open(page);
  await upload(page, 'rating.mhtml', buildFixture());
  await openAdvanced(page);
  await page.locator('#prompt').fill('Build a calculator that updates the total when Calculate is clicked.');
  await page.locator('#extractRequirements').click();
  await expect(page.locator('#requirementsList .req-card')).toHaveCount(1);
  await page.locator('#requirementsList [data-key=testable]').check();
  await page.locator('#observationRows [data-obs="left.presence"]').selectOption('Absent');
  const warnings = await page.evaluate(() => {
    const t = window.__WEBDEV_SBS_TEST__, s = t.state();
    s.requirements[0].left.function = 'Works';
    s.requirements[0].right.presence = 'Absent';
    s.evaluation.requirements_coverage.choice = 'Right';
    s.requirements[0].left.presence = 'Present';
    const coverage = t.lint();
    s.requirements[0].left.presence = 'Absent';
    return { coverage, absent: t.lint() };
  });
  expect(warnings.coverage.some(x => x.includes('Coverage favors Right'))).toBe(true);
  expect(warnings.absent.some(x => x.includes('absent but marked Works'))).toBe(true);
  await page.waitForTimeout(700);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__WEBDEV_SBS_TEST__));
  await openAdvanced(page);
  await expect(page.locator('#prompt')).toHaveValue('Build a calculator that updates the total when Calculate is clicked.');
  expect(errors).toEqual([]);
});

test('bookmarklet validates before touching form, maps every field, and never submits', async ({ page }) => {
  await open(page);
  const source = await page.evaluate(() => window.__WEBDEV_SBS_TEST__.webdevAutofill.toString());
  const payload = {
    schema: 'webdev-sbs-v1',
    functional_correctness: { left: { choice: 'Works', evidence: 'The Calculate control updates the total.' }, right: { choice: 'Partly works', evidence: 'The Calculate control updates once but ignores a changed term.' } },
    requirements_coverage: { choice: 'Left', evidence: 'The right candidate omits the requested pricing table.' },
    product_depth: { choice: 'Right', evidence: 'The right candidate adds a working cart quantity stepper.' },
    aesthetics: { choice: 'About equal', evidence: 'Both candidates keep readable layouts on desktop and mobile.' },
    overall_preference: { choice: 'Left', primary_reason: 'Requirements coverage', optional_comment: '' }
  };
  const cases = [
    { raw: '{bad', controls: true, expected: 'malformed JSON' },
    { raw: JSON.stringify({ ...payload, schema: 'other' }), controls: true, expected: 'validation failed' },
    { raw: JSON.stringify({ ...payload, aesthetics: { ...payload.aesthetics, evidence: 'x'.repeat(201) } }), controls: true, expected: 'validation failed' },
    { raw: JSON.stringify(payload), controls: false, expected: 'incompatible form DOM' },
    { raw: JSON.stringify(payload), controls: true, expected: 'Fields verified: 13/13' }
  ];
  for (const c of cases) {
    const result = await page.evaluate(async ({ source, c, FUNC, COMP, REASONS }) => {
      const map = {
        root_functional_correctness_left: FUNC,
        root_functional_correctness_right: FUNC,
        root_requirements_coverage_choice: COMP,
        root_product_depth_choice: COMP,
        root_aesthetics_choice: COMP,
        root_overall_preference_choice: COMP,
        root_overall_preference_primary_reason: REASONS
      };
      const texts = ['root_functional_correctness_left_evidence', 'root_functional_correctness_right_evidence', 'root_requirements_coverage_evidence', 'root_product_depth_evidence', 'root_aesthetics_evidence', 'root_overall_preference_optional_comment'];
      const host = document.createElement('div'); host.id = 'mockForm'; document.body.append(host);
      if (c.controls) {
        for (const [id, values] of Object.entries(map)) {
          const group = document.createElement('div'); group.id = id;
          for (const value of values) { const b = document.createElement('button'); b.value = value; b.type = 'button'; b.textContent = value; b.onclick = () => { group.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true') }; group.append(b) }
          host.append(group);
        }
        for (const id of texts) { const t = document.createElement('textarea'); t.id = id; host.append(t) }
      }
      const submit = document.createElement('button'); submit.textContent = 'Submit'; submit.onclick = () => window.__submitCount++; host.append(submit);
      window.__submitCount = 0; const alerts = []; window.alert = s => alerts.push(s);
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => c.raw } });
      Function('return (' + source + ')')()();
      await new Promise(r => setTimeout(r, 180));
      const values = Object.keys(map).map(id => [id, document.getElementById(id)?.querySelector('button[aria-pressed="true"]')?.value]);
      const textValues = texts.map(id => [id, document.getElementById(id)?.value]);
      const output = { alerts, submitCount: window.__submitCount, values, textValues }; host.remove(); return output;
    }, { source, c, FUNC, COMP, REASONS });
    expect(result.alerts.join(' ')).toContain(c.expected);
    expect(result.submitCount).toBe(0);
    if (c.expected === 'Fields verified: 13/13') {
      expect(result.values).toEqual([
        ['root_functional_correctness_left', 'Works'], ['root_functional_correctness_right', 'Partly works'],
        ['root_requirements_coverage_choice', 'Left'], ['root_product_depth_choice', 'Right'],
        ['root_aesthetics_choice', 'About equal'], ['root_overall_preference_choice', 'Left'],
        ['root_overall_preference_primary_reason', 'Requirements coverage']
      ]);
      expect(result.textValues[0][1]).toBe(payload.functional_correctness.left.evidence);
      expect(result.textValues[5][1]).toBe('');
    } else expect(result.values.every(([, value]) => !value)).toBe(true);
  }
  expect(source).not.toMatch(/querySelector\([^)]*submit|\.submit\(/i);
});

test('native textarea setter emits bubbling input and change', async ({ page }) => {
  const errors = await open(page);
  const events = await page.evaluate(() => {
    const t = document.createElement('textarea'), seen = []; document.body.append(t);
    for (const type of ['input', 'change']) t.addEventListener(type, e => seen.push([e.type, e.bubbles]));
    window.__WEBDEV_SBS_TEST__.nativeSet(t, 'React-safe value');
    t.remove(); return { value: t.value, seen };
  });
  expect(events).toEqual({ value: 'React-safe value', seen: [['input', true], ['change', true]] });
  expect(errors).toEqual([]);
});

test('AI requirements are strict, quoted, staged, and out-of-scope text is warned', async ({ page }) => {
  const errors = await open(page);
  let answer = aiReply({ requirements: [{ label: 'Pricing table', wording: 'a pricing table', category: 'Component', explicit: true, testable: false, notes: '' }] });
  const requests = [];
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => { requests.push(route.request().postDataJSON()); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) }) });
  await configureAI(page);
  await openAdvanced(page);
  await openSettings(page);
  await page.locator('#orModel').selectOption('anthropic/claude-test');
  await page.locator('#saveSettings').click();
  await page.locator('#prompt').fill('Build a pricing table. No authentication is required.');
  await page.locator('#aiExtract').click();
  await expect(page.locator('#aiStage .ai-proposal')).toHaveCount(1);
  await expect(page.locator('#requirementsList .req-card')).toHaveCount(0);
  expect(requests[0].model).toBe('anthropic/claude-test');
  expect(requests[0].response_format.type).toBe('json_schema');
  expect(requests[0].response_format.json_schema.strict).toBe(true);
  await page.locator('#aiStage [data-ai-apply]').click();
  await expect(page.locator('#requirementsList .req-card')).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('webdev-sbs.openrouter.v1')))).toEqual({ enabled: true, apiKey: 'test-local-key', model: 'anthropic/claude-test', visualModel: '', style: 'Plainspoken, concise, technically literate, conversational. Avoid rubric/QA boilerplate.' });

  answer = aiReply({ requirements: [{ label: 'Authentication', wording: 'Add authentication', category: 'Interaction', explicit: true, testable: true, notes: '' }] });
  await page.locator('#aiExtract').click();
  await expect(page.locator('#aiStatus')).toContainText('not quoted from the prompt');
  await expect(page.locator('#aiStage .ai-proposal')).toHaveCount(0);
  await expect(page.locator('#requirementsList .req-card')).toHaveCount(1);

  answer = aiReply({ requirements: [{ label: 'Authentication', wording: 'No authentication is required.', category: 'Other', explicit: true, testable: false, notes: '' }] });
  await page.locator('#aiExtract').click();
  await expect(page.locator('#aiStage .ai-proposal')).toHaveCount(1);
  await expect(page.locator('#aiStage')).toContainText('negative or conditional instruction');
  expect(errors).toEqual([]);
});

test('malformed AI and network failures preserve manual workflow', async ({ page }) => {
  const errors = await open(page);
  let answer = aiReply('{not json');
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => route.fulfill({ status: answer === 'failure' ? 503 : 200, contentType: 'application/json', body: answer === 'failure' ? JSON.stringify({ error: { message: 'Unavailable' } }) : JSON.stringify(answer) }));
  await configureAI(page);
  await openAdvanced(page);
  await page.locator('#prompt').fill('Build a calculator that updates the total when Calculate is clicked.');
  await page.locator('#aiExtract').click();
  await expect(page.locator('#aiStatus')).toContainText('malformed structured JSON');
  await expect(page.locator('#aiStage .ai-proposal')).toHaveCount(0);
  answer = 'failure';
  await page.locator('#aiExtract').click();
  await expect(page.locator('#aiStatus')).toContainText('OpenRouter HTTP 503');
  await page.locator('#extractRequirements').click();
  await expect(page.locator('#requirementsList .req-card')).toHaveCount(1);
  expect(errors).toEqual([expect.stringContaining('503')]);
});

test('AI evidence stays staged, protects edited text, and enforces 200 characters', async ({ page }) => {
  const errors = await open(page);
  let answer;
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(aiReply(answer)) }));
  await configureAI(page);
  await openAdvanced(page);
  const id = await page.evaluate(() => {
    const t = window.__WEBDEV_SBS_TEST__, s = t.state(), r = t.requirement('Calculate', 'Calculate updates the total');
    r.category = 'Interaction'; r.testable = true;
    r.left = { presence: 'Present', function: 'Works', note: 'Calculate updates the monthly total' };
    r.right = { presence: 'Present', function: 'Works', note: 'Calculate updates the monthly total' };
    s.prompt = 'Calculate updates the total'; s.requirements = [r]; s.evaluation.functional_correctness.left.evidence = 'The Calculate control updates the total.'; t.renderAll(); return r.id;
  });
  answer = { suggestions: [{ field: 'functional_correctness.left', evidence: 'The Calculate button updates the displayed monthly total.', source_ids: [`obs:${id}:left`] }] };
  const before = await page.evaluate(() => JSON.stringify(window.__WEBDEV_SBS_TEST__.canonical()));
  await page.locator('#aiEvidence').click();
  await expect(page.locator('#aiStage .ai-proposal')).toHaveCount(1);
  expect(await page.evaluate(() => JSON.stringify(window.__WEBDEV_SBS_TEST__.canonical()))).toBe(before);
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#aiStage [data-ai-apply]').click();
  expect(await page.evaluate(() => JSON.stringify(window.__WEBDEV_SBS_TEST__.canonical()))).toBe(before);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#aiStage [data-ai-apply]').click();
  await expect(page.locator('#e_functional_correctness_left')).toHaveValue('The Calculate button updates the displayed monthly total.');
  answer = { suggestions: [{ field: 'functional_correctness.left', evidence: 'X'.repeat(200) + '.', source_ids: [`obs:${id}:left`] }] };
  await page.locator('#aiEvidence').click();
  await expect(page.locator('#aiStatus')).toContainText('Over 200 characters');
  await expect(page.locator('#aiStage .ai-proposal')).toHaveCount(0);
  await expect(page.locator('#e_functional_correctness_left')).toHaveValue('The Calculate button updates the displayed monthly total.');
  expect(errors).toEqual([]);
});

test('visual judgment receives only visual notes; overall suggestion waits for acceptance', async ({ page }) => {
  const errors = await open(page);
  let answer, requests = [];
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => { requests.push(route.request().postDataJSON()); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(aiReply(answer)) }) });
  await configureAI(page);
  await openAdvanced(page);
  await page.evaluate(() => {
    const t = window.__WEBDEV_SBS_TEST__, s = t.state(), r = t.requirement('Responsive cards', 'Keep cards readable on mobile');
    r.category = 'Visual/layout'; r.left.presence = 'Present'; r.right.presence = 'Present'; s.prompt = 'Keep cards readable on mobile'; s.requirements = [r];
    for (const side of ['left', 'right']) for (const view of ['desktop', 'mobile']) s.inspections[side][view] = true;
    s.visual.left.mobile.flags = ['clipping/cutoff']; s.visual.left.mobile.note = 'Third card clips at the viewport edge';
    s.visual.right.mobile.note = 'Three cards stack without clipping';
    Object.assign(s.evaluation.functional_correctness.left, { choice: 'No testable functionality', evidence: 'The prompt specifies a static responsive card layout.' });
    Object.assign(s.evaluation.functional_correctness.right, { choice: 'No testable functionality', evidence: 'The prompt names no interaction to test.' });
    Object.assign(s.evaluation.requirements_coverage, { choice: 'About equal', evidence: 'Both candidates include the requested cards.' });
    Object.assign(s.evaluation.product_depth, { choice: 'About equal', evidence: 'Neither candidate adds a useful working extra.' });
    Object.assign(s.evaluation.aesthetics, { choice: 'Right', evidence: 'The right cards stack on mobile while the left third card clips at the edge.' });
    t.renderAll();
  });
  answer = { choice: 'Right', evidence: 'The right cards stack on mobile while the left third card clips at the edge.', rationale: 'The mobile difference is decisive.', source_ids: ['visual:left:mobile', 'visual:right:mobile'] };
  await page.locator('#aiAesthetics').click();
  await expect(page.locator('#aiStage .ai-proposal')).toHaveCount(1);
  const visualRequest = JSON.parse(requests[0].messages[1].content);
  expect(Object.keys(visualRequest)).toEqual(['facts']);
  expect(visualRequest.facts.every(f => f.id.startsWith('visual:'))).toBe(true);
  await page.locator('#aiStage [data-ai-apply]').click();
  await expect(page.locator('#e_aesthetics')).toHaveValue(answer.evidence);
  answer = { choice: 'Right', primary_reason: 'Visual quality', rationale: 'The right mobile layout keeps all cards readable.', source_ids: ['visual:left:mobile', 'visual:right:mobile'] };
  await page.locator('#aiOverall').click();
  await expect(page.locator('#aiStage .ai-proposal')).toHaveCount(1);
  await page.locator('#aiStage [data-ai-apply]').click();
  await expect(page.locator('input[name="r_overall_preference_choice"][value="Right"]')).toBeChecked();
  await expect(page.locator('input[name="r_overall_preference_primary_reason"][value="Visual quality"]')).toBeChecked();
  expect(requests[1].messages[1].content).toContain('rubric');
  expect(errors).toEqual([]);
});

test('clear data removes the local OpenRouter key and keeps deterministic suggestions available', async ({ page }) => {
  const errors = await open(page);
  await configureAI(page);
  await openAdvanced(page);
  await page.evaluate(() => { const t = window.__WEBDEV_SBS_TEST__, s = t.state(), r = t.requirement('Static cards', 'Show three cards'); r.testable = false; s.prompt = 'Show three cards'; s.requirements = [r]; t.renderAll() });
  await page.locator('#aiRubric').click();
  await expect(page.locator('#aiStage')).toContainText('No testable functionality');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#clearData').click();
  await openSettings(page);
  await expect(page.locator('#orKey')).toHaveValue('');
  expect(await page.evaluate(() => localStorage.getItem('webdev-sbs.openrouter.v1'))).toBeNull();
  await page.locator('#closeSettings').click();
  await expect(page.locator('#aiStage .ai-proposal')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('an AI result is discarded when the evaluation changes during its request', async ({ page }) => {
  const errors = await open(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('https://openrouter.ai/api/v1/chat/completions', async route => {
    await gate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(aiReply({ requirements: [{ label: 'Pricing table', wording: 'a pricing table', category: 'Component', explicit: true, testable: false, notes: '' }] })) });
  });
  await configureAI(page);
  await openAdvanced(page);
  await page.locator('#prompt').fill('Build a pricing table.');
  await page.locator('#aiExtract').click();
  await expect(page.locator('#aiStatus')).toContainText('Extracting requirements');
  await page.locator('#prompt').fill('Build a calculator.');
  release();
  await expect(page.locator('#aiStatus')).toContainText('suggestions were discarded');
  await expect(page.locator('#aiStage .ai-proposal')).toHaveCount(0);
  await expect(page.locator('#requirementsList .req-card')).toHaveCount(0);
  expect(errors).toEqual([]);
});

/* ---------- real production archive (local only) ---------- */

test('production MWEB recovers prompt, both candidates, and all 13 form controls', async ({ page }) => {
  test.skip(!fs.existsSync(REAL_MWEB), 'Production MWEB not present on this machine');
  const errors = await open(page);
  const raw = fs.readFileSync(REAL_MWEB, 'latin1');
  await upload(page, path.basename(REAL_MWEB), raw);
  await expect(page.locator('#parseStatus')).toContainText('Parsed');
  await expect(page.locator('#analyze')).toBeEnabled();
  const result = await page.evaluate(() => {
    const t = window.__WEBDEV_SBS_TEST__, s = t.state().source;
    return {
      partCount: s.partCount, promptFound: s.promptFound, promptLength: s.prompt.length,
      left: s.candidates.left && { title: s.candidates.left.title, css: s.candidates.left.css.length },
      right: s.candidates.right && { title: s.candidates.right.title, css: s.candidates.right.css.length },
      missingForm: t.compareFormStructure(s.formStructure).filter(r => !r.found).length,
      visualEvidence: s.visualEvidence,
      diagnostics: s.diagnostics.map(d => d.level + ': ' + d.message)
    };
  });
  expect(result.partCount).toBeGreaterThan(30);
  expect(result.promptFound).toBe(true);
  expect(result.promptLength).toBeGreaterThan(1000);
  expect(result.left.title).toContain('ResuAI');
  expect(result.right.title).toContain('Vitae');
  expect(result.left.css).toBeGreaterThan(0);
  expect(result.right.css).toBeGreaterThan(0);
  expect(result.missingForm).toBe(0);
  expect(result.visualEvidence).toBe(false);
  expect(result.diagnostics.some(d => d.includes('No rendered screenshots'))).toBe(true);
  expect(errors).toEqual([]);
});