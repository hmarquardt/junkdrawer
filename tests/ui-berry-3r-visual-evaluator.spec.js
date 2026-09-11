const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
test.use({ channel: 'chrome' });
const url = `file://${path.resolve('ui-berry-3r-visual-evaluator.html')}`;
async function open(page, demo = false) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/api/analytics/**', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**openrouter.ai/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }));
  await page.goto(url);
  await page.waitForFunction(() => !!window.__BERRY3VISUAL_TEST__);
  if (demo) {
    await page.getByRole('button', { name: 'Load synthetic demo' }).click();
    await expect(page.locator('#notice')).toContainText('Synthetic clone ready');
  }
  return errors;
}
async function check(page, d, o, reason, statuses) {
  return page.evaluate(({ d, o, reason, statuses }) => __BERRY3VISUAL_TEST__.validateDimension(d, o, reason, {}, statuses), { d, o, reason, statuses });
}
const longReason = (extra = '', n = 52) => {
  const s = `Website A is better because Website A ${extra || 'opened the menu'}, while Website B did not respond to the same action.`;
  return s + ' ' + Array.from({ length: Math.max(0, n - s.split(/\s+/).length) }, (_, i) => `detail${i}`).join(' ');
};

test('production evaluator is byte-identical to HEAD and its demo still loads', async ({ page }) => {
  expect(fs.readFileSync('ui-berry-3r-evaluator.html', 'utf8')).toBe(execFileSync('git', ['show', 'HEAD:ui-berry-3r-evaluator.html'], { encoding: 'utf8', maxBuffer: 2e6 }));
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/analytics/**', r => r.fulfill({ status: 204, body: '' }));
  await page.goto(`file://${path.resolve('ui-berry-3r-evaluator.html')}`);
  await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  await expect(page.locator('#workspace')).toBeVisible();
  expect(await page.evaluate(() => __BERRY3R_TEST__.state.task.websiteA.url)).toContain('candidate-a');
  expect(errors).toEqual([]);
});

test('new evaluator loads without runtime errors and has exact question order / legal choices', async ({ page }) => {
  const errors = await open(page);
  expect(await page.locator('#submission h2').allTextContents()).toEqual(['Functionality', 'Reference Fidelity', 'Overall']);
  for (const d of ['functionality', 'fidelity', 'overall']) {
    expect(await page.locator(`input[name=${d}]`).evaluateAll(es => es.map(e => e.value))).toEqual(['A is better', 'B is better', 'Both are good', 'Both are bad']);
  }
  expect(errors).toEqual([]);
});

test('synthetic clone contains reference, multiple candidate captures and opposing decisions', async ({ page }) => {
  const errors = await open(page, true);
  const out = await page.evaluate(() => { const T = __BERRY3VISUAL_TEST__, s = T.state; return { type: s.task.taskType, counts: [s.task.referenceImages.length, s.task.candidates.A.images.length, s.task.candidates.B.images.length], final: s.final, qa: T.validateAll() }; });
  expect(out.type).toBe('clone'); expect(out.counts).toEqual([1, 2, 2]);
  expect(out.final.functionalityOption).toBe('B is better'); expect(out.final.fidelityOption).toBe('A is better');
  expect(out.qa.issues).toEqual([]);
  await expect(page.locator('#copyAll')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('file pickers, reference replace, capture naming, reorder and remove', async ({ page }) => {
  const errors = await open(page, true);
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 32; return c.toDataURL().split(',')[1]; });
  const file = { name: 'extra.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') };
  await page.locator('[data-imagefile=R]').setInputFiles(file);
  await page.locator('[data-imagefile=A]').setInputFiles([file, { ...file, name: 'another.png' }]);
  expect(await page.evaluate(() => __BERRY3VISUAL_TEST__.state.task.referenceImages.map(i => [i.width, i.height]))).toEqual([[64, 32]]);
  await expect(page.locator('[data-role=A] .capture')).toHaveCount(4);
  const input = page.locator('[data-name="A:3"]'); await input.fill('Custom end'); await input.dispatchEvent('change');
  await page.locator('[data-move="A:3:-1"]').click();
  expect(await page.locator('[data-name="A:2"]').inputValue()).toBe('Custom end');
  await page.locator('[data-remove="A:2"]').click();
  expect(await page.locator('[data-role=A] .capture').count()).toBe(3);
  expect(errors).toEqual([]);
});

test('clipboard paste and image drop populate the focused roles', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 20; c.height = 30;
    const blob = await new Promise(r => c.toBlob(r)); const f = new File([blob], 'pasted.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(f);
    document.querySelector('[data-role=R]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await expect(page.locator('[data-role=R] .capture')).toHaveCount(1);
  await page.evaluate(async () => {
    const f = new File([__BERRY3VISUAL_TEST__.state.task.referenceImages[0].blob], 'drop.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(f);
    document.querySelector('[data-role=B]').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  });
  await expect(page.locator('[data-role=B] .capture')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('lightbox zoom, fit, overlay, side-by-side and dimension mismatch', async ({ page }) => {
  const errors = await open(page, true);
  await page.locator('[data-expand=A]').click();
  await expect(page.locator('#lightbox')).toBeVisible();
  await expect(page.locator('#lightStages .image-stage')).toHaveCount(2);
  await page.locator('[data-light=pixels]').click();
  expect(await page.locator('#lightStages img').first().evaluate(e => e.style.transform)).toContain('scale(1)');
  await page.locator('#compareMode').selectOption('overlay');
  await expect(page.locator('#lightStages img')).toHaveCount(2);
  await page.locator('#opacity').fill('0.7'); await page.locator('#opacity').dispatchEvent('input');
  expect(await page.locator('#lightStages img').nth(1).evaluate(e => e.style.opacity)).toBe('0.7');
  await page.locator('#compareMode').selectOption('diff');
  await expect(page.locator('#compareNote')).toContainText('Advisory only');
  await page.keyboard.press('Escape');
  await page.locator('[data-selectimage="A:1"]').click(); await page.locator('[data-expand=A]').click();
  await page.locator('#compareMode').selectOption('diff');
  await expect(page.locator('#compareNote')).toContainText('must match exactly');
  expect(errors).toEqual([]);
});

test('unknown and explicitly text-only models cannot receive image tasks', async ({ page }) => {
  const errors = await open(page, true);
  await page.evaluate(() => { const T = __BERRY3VISUAL_TEST__; T.settings.apiKey = 'test-key'; T.state.models = [{ id: T.settings.model, architecture: { input_modalities: ['text'], output_modalities: ['text'] } }]; T.setAiTransport(() => { throw Error('SHOULD NOT CALL'); }); });
  await page.locator('#generate').click();
  await expect(page.locator('#notice')).toContainText('no verified image-input');
  expect(await page.evaluate(() => __BERRY3VISUAL_TEST__.state.passes.length)).toBe(0);
  expect(errors).toEqual([]);
});

test('provider-grouped vision selector excludes text-only and retains saved selection on failure', async ({ page }) => {
  await open(page);
  await page.route('**openrouter.ai/api/v1/models', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [
    { id: 'openai/gpt-4.1-mini', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
    { id: 'provider/vision', architecture: { input_modalities: ['image', 'text'], output_modalities: ['text'] } },
    { id: 'provider/text', architecture: { input_modalities: ['text'], output_modalities: ['text'] } }
  ] }) }));
  await page.locator('[data-view=admin]').click(); await page.locator('#orKey').fill('test-key'); await page.locator('#orKey').blur();
  await expect(page.locator('#modelStatus')).toContainText('2 verified vision models');
  expect(await page.locator('#orModel optgroup').evaluateAll(es => es.map(e => e.label))).toEqual(['openai', 'provider']);
  await expect(page.locator('#orModel option[value="provider/text"]')).toHaveCount(0);
  await page.locator('#orModel').selectOption('provider/vision');
  await page.route('**openrouter.ai/api/v1/models', r => r.fulfill({ status: 500, body: '' }));
  await page.locator('#refreshModels').click(); await expect(page.locator('#modelStatus')).toContainText('refresh failed');
  await expect(page.locator('#orModel')).toHaveValue('provider/vision');
});

test('model request capabilities omit unsupported sampling parameters for known reasoning models', async ({ page }) => {
  await open(page);
  const out = await page.evaluate(() => {
    const T = __BERRY3VISUAL_TEST__; T.settings.temperature = 0.25;
    const ids = ['openai/gpt-6-astra', 'openai/gpt-5.6-sol', 'openai/gpt-5.6-terra', 'openai/gpt-5.6-luna', 'openai/gpt-4.1-mini', 'acme/custom-vision'];
    return Object.fromEntries(ids.map(id => { const body = T.modelRequestBody(id, [{ role: 'user', content: 'x' }]); const u = body.messages.find(m => m.role === 'user'); return [id, { caps: T.modelRequestCapabilities(id), keys: Object.keys(body), body, user: typeof u.content === 'string' ? u.content : u.content.filter(p => p.type === 'text').map(p => p.text).join('\n') }]; }));
  });
  for (const id of ['openai/gpt-6-astra', 'openai/gpt-5.6-sol', 'openai/gpt-5.6-terra', 'openai/gpt-5.6-luna']) {
    expect(out[id].caps.temperature).toBe(false);
    expect(out[id].caps.nativeProvider).toBe(true);
    for (const key of ['temperature', 'top_p', 'top_logprobs', 'logprobs']) expect(out[id].keys).not.toContain(key);
    expect(out[id].body.response_format).toEqual({ type: 'json_object' });
    expect(out[id].body.provider).toEqual({ only: ['openai'], allow_fallbacks: false });
    expect(out[id].body.messages.length).toBeGreaterThan(0);
    expect(/json/.test(out[id].user)).toBe(true);
  }
  for (const id of ['openai/gpt-4.1-mini', 'acme/custom-vision']) {
    expect(out[id].caps.temperature).toBe(true);
    expect(out[id].caps.nativeProvider).toBe(false);
    expect(out[id].keys).toContain('temperature');
    expect(out[id].body.temperature).toBe(0.25);
    expect('provider' in out[id].body).toBe(false);
  }
  expect(out['openai/gpt-6-astra'].caps.samplingNote).toContain('not supported');
});

test('JSON-mode directive lands in user input through the common builder and is idempotent', async ({ page }) => {
  await open(page);
  const out = await page.evaluate(() => {
    const T = __BERRY3VISUAL_TEST__;
    const userText = m => typeof m.content === 'string' ? m.content : m.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
    const sysOnly = T.modelRequestBody('openai/gpt-4.1-mini', [{ role: 'system', content: 'Return JSON only.' }, { role: 'user', content: '{}' }]);
    const already = T.modelRequestBody('openai/gpt-4.1-mini', [{ role: 'system', content: 'You are a judge.' }, { role: 'user', content: 'Compare. Return only a single valid json object.' }]);
    const multimodal = T.modelRequestBody('openai/gpt-4.1-mini', [{ role: 'system', content: 'sys' }, { role: 'user', content: [{ type: 'text', text: 'Observe.' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }]);
    const mUser = multimodal.messages.find(m => m.role === 'user');
    return {
      sysOnlyUser: userText(sysOnly.messages.find(m => m.role === 'user')),
      sysOnlySystem: sysOnly.messages.find(m => m.role === 'system').content,
      alreadyUser: userText(already.messages.find(m => m.role === 'user')),
      alreadyCount: (userText(already.messages.find(m => m.role === 'user')).match(/json/g) || []).length,
      multimodalUser: userText(mUser),
      multimodalImages: mUser.content.filter(p => p.type === 'image_url').length,
      userObjectsFrozen: Object.isFrozen(already.messages.find(m => m.role === 'user'))
    };
  });
  expect(out.sysOnlySystem).toContain('JSON');
  expect(/json/.test(out.sysOnlyUser)).toBe(true);
  expect(out.sysOnlyUser).toContain('Return only a single valid json object.');
  expect(out.alreadyUser).toBe('Compare. Return only a single valid json object.');
  expect(out.alreadyCount).toBe(1);
  expect(/json/.test(out.multimodalUser)).toBe(true);
  expect(out.multimodalImages).toBe(1);
});

test('native-OpenAI-like JSON-mode guard passes every pass through the common directive', async ({ page }) => {
  const errors = await open(page, true);
  await page.evaluate(() => {
    const T = __BERRY3VISUAL_TEST__, s = T.state;
    T.settings.apiKey = 'test-key-json'; T.settings.chime = false;
    s.models = [{ id: 'openai/gpt-6-astra', name: 'GPT-6 Astra', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }];
    T.renderModels();
    window.__sample = structuredClone(s.draft); window.__features = structuredClone(s.features); window.__qaRounds = 0;
  });
  await page.locator('[data-view=admin]').click();
  await page.locator('#orModel').selectOption('openai/gpt-6-astra');
  await page.locator('[data-view=evaluate]').click();
  const bodies = [];
  const userTextOf = body => { const u = body.messages.find(m => m.role === 'user'); return typeof u?.content === 'string' ? u.content : (Array.isArray(u?.content) ? u.content.filter(p => p.type === 'text').map(p => p.text).join('\n') : ''); };
  await page.route('**openrouter.ai/api/v1/chat/completions', async route => {
    const body = route.request().postDataJSON(); bodies.push(body);
    if (body.response_format?.type === 'json_object' && !/json/.test(userTextOf(body))) {
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Provider returned error', code: 400, metadata: { provider_name: 'OpenAI', raw: JSON.stringify({ error: { message: "Response input messages must contain the word 'json' in some form to use 'text.format' of type 'json_object'.", type: 'invalid_request_error', param: 'input', code: null } }) } } }) });
    }
    if (!body.provider || body.provider.only?.join(',') !== 'openai' || body.provider.allow_fallbacks !== false) {
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Provider returned error', code: 400, metadata: { provider_name: 'Azure' } } }) });
    }
    const instruction = body.messages[0].content.split('\nPASS: ')[1] || '';
    let response;
    if (instruction.startsWith('Observe images')) response = { features: await page.evaluate(() => window.__features) };
    else if (instruction.startsWith('Adversarial visual-only QA')) response = { issues: [], allClaimsEvidenced: true, referenceFeatures: true, lensIsolation: true };
    else if (instruction.startsWith('Generate ONLY Reference Fidelity')) response = await page.evaluate(() => structuredClone(window.__sample));
    else if (instruction.startsWith('Adversarial QA')) {
      const round = await page.evaluate(() => ++window.__qaRounds);
      const result = await page.evaluate(() => { const T = __BERRY3VISUAL_TEST__, result = structuredClone(window.__sample); for (const d of T.DIMS) for (const c of result[d].claims) c.evidenceIds = d === 'functionality' ? [...T.retainedBehavior().A, ...T.retainedBehavior().B].map(f => f.id) : d === 'fidelity' ? T.state.features.map(f => f.id) : [...T.state.features.map(f => f.id), ...T.retainedBehavior().A.map(f => f.id), ...T.retainedBehavior().B.map(f => f.id)]; return result });
      response = { result, issues: round === 1 ? ['Force one bounded repair round.'] : [], checked: { referenceFeatures: true, behaviorNotInferred: true, lensIsolation: true, tieConsistency: true, allClaimsEvidenced: true, overallTradeoff: true, wordCounts: true } };
    } else response = await page.evaluate(() => structuredClone(window.__sample));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ provider: 'OpenAI', choices: [{ message: { content: JSON.stringify(response) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) });
  });
  await page.locator('#visualOnly').click();
  await expect(page.locator('#notice')).toContainText('Fidelity analysis complete');
  await page.locator('#generate').click();
  await expect(page.locator('#notice')).toContainText('Analysis complete');
  const instructionOf = body => body.messages[0].content.split('\nPASS: ')[1] || '';
  expect(bodies.some(b => instructionOf(b).startsWith('Observe images'))).toBe(true);
  expect(bodies.some(b => instructionOf(b).startsWith('Generate ONLY Reference Fidelity'))).toBe(true);
  expect(bodies.some(b => instructionOf(b).startsWith('Adversarial visual-only QA'))).toBe(true);
  expect(bodies.some(b => instructionOf(b).startsWith('Using ONLY retained evidence') && !/Repair only identified issues/.test(instructionOf(b)))).toBe(true);
  expect(bodies.some(b => instructionOf(b).startsWith('Adversarial QA'))).toBe(true);
  expect(bodies.some(b => /Repair only identified issues/.test(instructionOf(b)))).toBe(true);
  for (const body of bodies) {
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(/json/.test(userTextOf(body))).toBe(true);
    expect(body.provider).toEqual({ only: ['openai'], allow_fallbacks: false });
    for (const key of ['temperature', 'top_p', 'top_logprobs', 'logprobs']) expect(key in body).toBe(false);
  }
  expect(bodies[0].messages[1].content.filter(p => p.type === 'image_url')).toHaveLength(5);
  expect(errors).toEqual([]);
});

test('Admin disables temperature for Astra, preserves the stored value, and restores it for supporting models', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const T = __BERRY3VISUAL_TEST__; T.settings.temperature = 0.25;
    T.state.models = [
      { id: 'openai/gpt-6-astra', name: 'GPT-6 Astra', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
      { id: 'openai/gpt-4.1-mini', name: 'GPT-4.1 Mini', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }
    ];
    T.renderModels();
  });
  await page.locator('[data-view=admin]').click();
  await page.locator('#orModel').selectOption('openai/gpt-6-astra');
  await expect(page.locator('#temperature')).toBeDisabled();
  await expect(page.locator('#temperature')).toHaveValue('0.25');
  await expect(page.locator('#temperatureNote')).toContainText('Sampling temperature is not supported by GPT-6 Astra and will not be sent.');
  expect(await page.evaluate(() => __BERRY3VISUAL_TEST__.settings.temperature)).toBe(0.25);
  await page.locator('#orModel').selectOption('openai/gpt-4.1-mini');
  await expect(page.locator('#temperature')).toBeEnabled();
  await expect(page.locator('#temperature')).toHaveValue('0.25');
  await expect(page.locator('#temperatureNote')).toBeHidden();
});

test('Astra requests omit sampling parameters on every pass while keeping vision parts and structured output', async ({ page }) => {
  const errors = await open(page, true);
  await page.evaluate(() => {
    const T = __BERRY3VISUAL_TEST__, s = T.state;
    T.settings.apiKey = 'test-key-astra'; T.settings.chime = false;
    s.models = [{ id: 'openai/gpt-6-astra', name: 'GPT-6 Astra', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }];
    T.renderModels();
    window.__sample = structuredClone(s.draft); window.__features = structuredClone(s.features);
  });
  await page.locator('[data-view=admin]').click();
  await page.locator('#orModel').selectOption('openai/gpt-6-astra');
  await page.locator('[data-view=evaluate]').click();
  const bodies = [];
  await page.route('**openrouter.ai/api/v1/chat/completions', async route => {
    const body = route.request().postDataJSON(); bodies.push(body);
    if ('temperature' in body || 'top_p' in body || 'top_logprobs' in body || 'logprobs' in body) {
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Provider returned error', code: 400, metadata: { provider_name: 'OpenAI', raw: JSON.stringify({ error: { message: 'Unsupported parameter: temperature', type: 'invalid_request_error', code: 'unsupported_parameter' } }) } } }) });
    }
    if (!body.provider || body.provider.only?.join(',') !== 'openai' || body.provider.allow_fallbacks !== false) {
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Provider returned error', code: 400, metadata: { provider_name: 'Azure', raw: JSON.stringify({ error: { message: 'Azure routing was not pinned' } }) } } }) });
    }
    const instruction = body.messages[0].content.split('\nPASS: ')[1];
    let response;
    if (instruction.startsWith('Observe images')) response = { features: await page.evaluate(() => window.__features) };
    else if (instruction.startsWith('Adversarial QA')) {
      const result = await page.evaluate(() => { const T = __BERRY3VISUAL_TEST__, result = structuredClone(window.__sample); for (const d of T.DIMS) for (const c of result[d].claims) c.evidenceIds = d === 'functionality' ? [...T.retainedBehavior().A, ...T.retainedBehavior().B].map(f => f.id) : d === 'fidelity' ? T.state.features.map(f => f.id) : [...T.state.features.map(f => f.id), ...T.retainedBehavior().A.map(f => f.id), ...T.retainedBehavior().B.map(f => f.id)]; return result });
      response = { result, issues: [], checked: { referenceFeatures: true, behaviorNotInferred: true, lensIsolation: true, tieConsistency: true, allClaimsEvidenced: true, overallTradeoff: true, wordCounts: true } };
    } else response = await page.evaluate(() => window.__sample);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ provider: 'OpenAI', choices: [{ message: { content: JSON.stringify(response) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) });
  });
  await page.locator('#generate').click();
  await expect(page.locator('#notice')).toContainText('Analysis complete');
  expect(bodies).toHaveLength(3);
  for (const body of bodies) {
    expect(body.model).toBe('openai/gpt-6-astra');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.provider).toEqual({ only: ['openai'], allow_fallbacks: false });
    for (const key of ['temperature', 'top_p', 'top_logprobs', 'logprobs']) expect(key in body).toBe(false);
  }
  expect(bodies[0].messages[1].content.filter(p => p.type === 'image_url')).toHaveLength(5);
  expect(await page.evaluate(() => __BERRY3VISUAL_TEST__.settings.temperature)).toBe(0.25);
  const debug = await page.evaluate(() => __BERRY3VISUAL_TEST__.buildDebugReport());
  expect(debug.passes[0].requestShape.temperature).toBe('OMITTED');
  expect(debug.passes[0].requestShape.contentParts).toContain('5 images');
  expect(debug.passes[0].requestShape.provider).toBe('only: openai, allow_fallbacks: false');
  expect(debug.passes.map(p => p.provider)).toEqual(['OpenAI', 'OpenAI', 'OpenAI']);
  expect(JSON.stringify(debug)).not.toContain('test-key-astra');
  expect(JSON.stringify(debug)).not.toContain('data:image');
  expect(errors).toEqual([]);
});

test('source and screenshots never normalize into confirmed behavior; channels stay separate', async ({ page }) => {
  await open(page, true);
  const out = await page.evaluate(() => {
    const T = __BERRY3VISUAL_TEST__;
    const normalized = T.normalizeBehavior({ A: [{ observation: 'Button works from source', status: 'passed', source: 'source-code', confidence: 'confirmed' }] });
    const visual = T.state.features.map(f => f.id); const behavior = T.retainedBehavior();
    return { normalized, visual, behavior };
  });
  expect(out.normalized.A[0].confidence).toBe('unverified');
  expect(out.behavior.A.some(f => out.visual.includes(f.id))).toBe(false);
  expect(out.behavior.A.some(f => /Settings/.test(f.observation))).toBe(true);
});
for (const [n, valid] of [[39, false], [40, true], [160, true], [161, false]]) {
  test(`word count boundary ${n}`, async ({ page }) => { await open(page); const v = await check(page, 'functionality', 'A is better', longReason('', n)); expect(v.wc).toBe(n); expect(v.issues.some(x => x.includes('40–160'))).toBe(!valid); });
}

test('candidate naming, outcome opening, tie contradiction and reason reuse QA', async ({ page }) => {
  await open(page, true);
  for (const phrase of ['A opened the menu', 'Site A opened the menu', 'the left one opened the menu']) {
    expect((await check(page, 'functionality', 'A is better', longReason(phrase))).issues.join(' ')).toContain('Candidate naming');
  }
  const tied = 'Website A and Website B are tied as good options because Website A is clearly better than Website B. ' + longReason();
  expect((await check(page, 'overall', 'Both are good', tied)).issues.join(' ')).toContain('contradiction');
  expect((await check(page, 'functionality', 'B is better', longReason())).issues.join(' ')).toContain('Outcome opening');
  expect(await page.evaluate(() => { const T = __BERRY3VISUAL_TEST__; const f = { ...T.state.final, overallReason: T.state.final.functionalityReason }; return T.validateAll(f).issues.some(i => i.includes('Duplicate')); })).toBe(true);
});

test('lens QA flags obvious leakage, requires reference grounding, accepts overall trade-off', async ({ page }) => {
  await open(page, true);
  expect((await check(page, 'functionality', 'A is better', longReason('has a prettier palette and typography'))).issues.join(' ')).toContain('Lens crossing');
  const fidelity = 'Website A is better because the reference hero matches Website A, and its button works when clicked, while Website B has a different heading. ' + 'Additional concrete description of the panels and their surrounding details accompanies this comparative observation.';
  expect((await check(page, 'fidelity', 'A is better', fidelity)).issues.join(' ')).toContain('Lens crossing');
  expect((await check(page, 'fidelity', 'A is better', longReason('looks cleaner than Website B'))).issues.join(' ')).toContain('Reference anchoring');
  const o = await page.evaluate(() => { const T = __BERRY3VISUAL_TEST__; return T.validateDimension('overall', T.state.final.overallOption, T.state.final.overallReason); });
  expect(o.issues).toEqual([]);
  const visibleLabels = "Website A is better because the reference navigation labels and button text match Website A, while Website B replaces the heading and omits the three-column panel. The supplied image has a dark background and thin rectangular frame that Website A reproduces with closer proportions.";
  expect((await check(page, 'fidelity', 'A is better', visibleLabels)).issues).toEqual([]);
  expect((await check(page, 'fidelity', 'A is better', visibleLabels+' A thin border surrounds the reference panel.')).issues).toEqual([]);
});

test('one broken candidate forces the rendering winner in QA; both broken short reasons pass', async ({ page }) => {
  await open(page, true);
  await page.selectOption('#render-A', 'broken');
  expect(await page.evaluate(() => __BERRY3VISUAL_TEST__.DIMS.map(d => __BERRY3VISUAL_TEST__.state.final[d+'Option']))).toEqual(['B is better', 'B is better', 'B is better']);
  expect(await page.evaluate(() => {const T=__BERRY3VISUAL_TEST__; return T.validateAll({...T.state.final, overallOption:'A is better'}).issues.some(i=>i.includes('broken-candidate rule requires B'));})).toBe(true);
  await page.selectOption('#render-B', 'broken');
  await page.locator('#generate').click();
  await expect(page.locator('#ready')).toContainText('READY TO COPY');
  expect(await page.evaluate(() => { const T = __BERRY3VISUAL_TEST__; return T.DIMS.map(d => T.state.final[d + 'Option']); })).toEqual(['Both are bad', 'Both are bad', 'Both are bad']);
  const v = await check(page, 'fidelity', 'Both are bad', 'Website A and Website B are tied as bad options because Website A has no visible output and Website B provides none.', { A: 'broken', B: 'broken' });
  expect(v.issues).toEqual([]);
  expect((await check(page, 'fidelity', 'Both are bad', 'Website A and Website B are tied as bad options because ' + 'detail '.repeat(170), { A: 'broken', B: 'broken' })).issues.join(' ')).toContain('40–160');
});

test('copy all six fields uses clone order and copy next cycles reasons', async ({ page }) => {
  await open(page, true);
  await page.evaluate(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => window.__copied.push(t) } }); });
  await page.locator('#copyAll').click();
  const copied = await page.evaluate(() => window.__copied[0].split('\n'));
  expect(copied[0]).toBe('B is better'); expect(copied[1]).toContain('Settings'); expect(copied[2]).toBe('A is better'); expect(copied[3]).toContain('reference'); expect(copied).toHaveLength(6);
  for (let i = 0; i < 3; i++) await page.locator('#copyNext').click();
  const texts = await page.evaluate(() => window.__copied.slice(1)); expect(texts).toEqual([copied[1], copied[3], copied[5]]);
});

test('separate history, redacted secrets, no localStorage images; opt-in image roundtrip and cascade', async ({ page }) => {
  const errors = await open(page, true);
  const out = await page.evaluate(async () => {
    const T = __BERRY3VISUAL_TEST__; T.settings.apiKey = 'sk-or-v1-very-secret-test-value';
    T.state.task.taskId = 'sk-or-v1-very-secret-test-value';
    const id = await T.saveHistory();
    return { id, keys: [T.DB, T.SETTINGS_KEY], rows: await T.historyRows(), debug: T.buildDebugReport(), storage: Object.entries(localStorage) };
  });
  expect(out.keys).toEqual(['berry3visual-evaluator', 'berry3visual.settings']);
  expect(JSON.stringify(out.rows)).not.toContain('very-secret-test-value'); expect(JSON.stringify(out.debug)).not.toContain('very-secret-test-value');
  expect(JSON.stringify(out.rows)).not.toMatch(/data:image|blob:/); expect(JSON.stringify(out.storage)).not.toMatch(/data:image|blob:/);
  await page.locator('#archiveImages').check(); await page.locator('#saveHistory').click();
  await expect(page.locator('#notice')).toContainText('separate image blobs');
  await page.locator('[data-view=history]').click();
  await page.evaluate(async () => { const T = __BERRY3VISUAL_TEST__; await T.openHistory(T.state.historyId); });
  await expect.poll(async()=>page.locator('#stage-R img').evaluate(e=>parseFloat(e.style.transform.split('scale(')[1]))).toBeGreaterThan(0);
  expect(await page.evaluate(() => __BERRY3VISUAL_TEST__.state.task.candidates.A.images.every(i => i.blob instanceof Blob))).toBe(true);
  await page.locator('#archiveImages').uncheck(); await page.locator('#saveHistory').click();
  await expect(page.locator('#notice')).toContainText('Images were not retained');
  const count = () => page.evaluate(async () => { const db = await new Promise(r => { const q = indexedDB.open('berry3visual-evaluator'); q.onsuccess = () => r(q.result); }); const n = await new Promise(r => { const q = db.transaction('images').objectStore('images').count(); q.onsuccess = () => r(q.result); }); db.close(); return n; });
  expect(await count()).toBe(0);
  await page.locator('#archiveImages').check(); await page.locator('#saveHistory').click(); await expect(page.locator('#notice')).toContainText('separate image blobs');
  expect(await count()).toBe(5);
  await page.evaluate(async () => { const T = __BERRY3VISUAL_TEST__; await T.deleteHistory(T.state.historyId); });
  expect(await count()).toBe(0);
  expect(errors).toEqual([]);
});

test('MHTML adapter rejects unverified task types and written-prompt shells', async ({ page }) => {
  const errors=await open(page);
  const output = await page.evaluate(async () => {
    const boundary='berry-test-boundary';
    const mime=html=>`MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${boundary}"\r\n\r\n--${boundary}\r\nContent-Type: text/html\r\n\r\n${html}\r\n--${boundary}--\r\n`;
    const messages=[];for(const html of ['<h1>Screenshot comparison</h1><img src="unknown.png">','<h3>User request</h3><p>Build a timer.</p><h3>Aesthetics</h3>']){try{await __BERRY3VISUAL_TEST__.parseCloneTaskArchive(mime(html));messages.push('unexpected success')}catch(e){messages.push(e.message)}}return messages;
  });
  for(const message of output)expect(message).toContain('WRONG TASK TYPE');expect(errors).toEqual([]);
});

async function mockPipeline(page, unsupported = false) {
  await page.evaluate(({ unsupported }) => {
    const T = __BERRY3VISUAL_TEST__, s = T.state;
    T.settings.apiKey = 'test-key'; s.models = [{ id: T.settings.model, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }];
    const sample = structuredClone(s.draft), oldFeatures = structuredClone(s.features);
    window.__calls = [];
    T.setAiTransport(async (stage, messages) => {
      window.__calls.push({ stage, messages });
      if (stage === 'visual observation') return { features: oldFeatures };
      if (stage === 'fidelity QA') return { issues: [], allClaimsEvidenced: true, referenceFeatures: true, lensIsolation: true };
      const result = structuredClone(sample);
      for (const d of T.DIMS) for (const c of result[d].claims) c.evidenceIds = d === 'functionality' ? [...T.retainedBehavior().A, ...T.retainedBehavior().B].map(f => f.id) : d === 'fidelity' ? s.features.map(f => f.id) : [...s.features.map(f => f.id), ...T.retainedBehavior().A.map(f => f.id), ...T.retainedBehavior().B.map(f => f.id)];
      if (unsupported) result.fidelity.claims[0].evidenceIds = ['invented-feature'];
      if (stage === 'adversarial QA') return { result, issues: [], checked: { referenceFeatures: true, behaviorNotInferred: true, lensIsolation: true, tieConsistency: true, allClaimsEvidenced: true, overallTradeoff: true, wordCounts: true } };
      return result;
    });
  }, { unsupported });
}

test('multimodal evidence-first pipeline runs real sequencing with mocked transport', async ({ page }) => {
  const errors = await open(page, true); await mockPipeline(page);
  await page.locator('#generate').click(); await expect(page.locator('#notice')).toContainText('Analysis complete.');
  const out = await page.evaluate(() => ({ calls: window.__calls, qa: __BERRY3VISUAL_TEST__.validateAll() }));
  expect(out.calls.map(c => c.stage)).toEqual(['visual observation', 'decision synthesis', 'adversarial QA']);
  expect(out.calls[0].messages[1].content.filter(p => p.type === 'image_url')).toHaveLength(5);
  expect(out.calls[1].messages[1].content).not.toContain('data:image');
  const payload = JSON.parse(out.calls[1].messages[1].content); expect(payload.behaviorEvidence.A.every(f => f.confidence === 'confirmed')).toBe(true);
  expect(out.qa.issues).toEqual([]); expect(errors).toEqual([]);
});

test('unsupported evidence IDs block ready even if model QA says pass; repair is bounded', async ({ page }) => {
  await open(page, true); await mockPipeline(page, true);
  await page.locator('#generate').click(); await expect(page.locator('#notice')).toContainText('unresolved QA');
  expect(await page.evaluate(() => __BERRY3VISUAL_TEST__.validateAll().issues.join(' '))).toContain('unsupported claim');
  expect(await page.evaluate(() => window.__calls.length)).toBe(5);
  await expect(page.locator('#copyAll')).toBeEnabled();
  await page.evaluate(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => window.__copied.push(t) } }); });
  page.once('dialog', d => d.accept());
  await page.locator('#copyAll').click();
  expect(await page.evaluate(() => window.__copied.length)).toBe(1);
});

test('manual edits survive rerun, evidence changes invalidate stale claims', async ({ page }) => {
  await open(page, true); await mockPipeline(page);
  await page.locator('[data-final=functionalityReason]').fill('Human edited reason.');
  await page.locator('#generate').click(); await expect(page.locator('#notice')).toContainText('preserved edits');
  await expect(page.locator('[data-final=functionalityReason]')).toHaveValue('Human edited reason.');
  await page.locator('[data-remove="A:0"]').click();
  expect(await page.evaluate(() => __BERRY3VISUAL_TEST__.validateAll().issues.join(' '))).toContain('Evidence changed');
});

test('malformed model output and absent behavior are both visible, never silent', async ({ page }) => {
  const errors = await open(page, true);
  await mockPipeline(page);
  await page.evaluate(() => __BERRY3VISUAL_TEST__.setAiTransport(async () => ({ invalid: true })));
  await page.locator('#generate').click(); await expect(page.locator('#notice')).toContainText('features array');
  expect(await page.evaluate(() => __BERRY3VISUAL_TEST__.state.busy)).toBe(false);
  expect(await page.evaluate(() => document.querySelector('#generate').getAttribute('aria-busy'))).toBe('false');
  await page.evaluate(() => { const T = __BERRY3VISUAL_TEST__; T.state.task.candidates.A.behaviorEvidence = []; T.setRenderStatus('A', 'unknown'); T.state.final.functionalityOption = ''; T.state.final.functionalityReason = ''; T.state.final.overallOption = ''; T.state.final.overallReason = ''; T.state.dirty = {}; });
  await mockPipeline(page);
  await expect(page.locator('#generate')).toBeDisabled();
  await expect(page.locator('#generate')).toHaveText('ADD BEHAVIOR TO GENERATE ALL');
  await page.locator('#visualOnly').click(); await expect(page.locator('#notice')).toContainText('Fidelity analysis complete');
  await expect(page.locator('#notice')).toContainText('pending verified behavior');
  await expect(page.locator('[data-final=fidelityReason]')).not.toHaveValue('');
  await expect(page.locator('[data-final=functionalityReason]')).toHaveValue('');
  await expect(page.locator('[data-final=overallReason]')).toHaveValue('');
  expect(errors).toEqual([]);
});

test('settings quota failure is surfaced without runtime error or image fallback', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
  await page.locator('[data-view=admin]').click(); await page.locator('#orKey').fill('sk-or-v1-secretvalue');
  await expect(page.locator('#persistState')).toContainText('NOT saved');
  expect(await page.evaluate(() => JSON.stringify(__BERRY3VISUAL_TEST__.buildDebugReport()))).not.toContain('secretvalue');
  expect(errors).toEqual([]);
});

test('responsive desktop and mobile layouts have no page overflow', async ({ page }) => {
  const errors = await open(page, true);
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await page.screenshot({path: '/private/tmp/berry-visual-'+width+'.png', fullPage:true}); }
  expect(errors).toEqual([]);
});

test('edits during verification cannot be marked verified by an older response', async ({ page }) => {
  await open(page, true);
  await page.evaluate(() => {
    const T = __BERRY3VISUAL_TEST__, s = T.state;
    T.settings.apiKey = 'test-key'; s.models = [{ id: T.settings.model, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }];
    const result = structuredClone(s.draft);
    T.setAiTransport(async () => {
      await new Promise(resolve => window.__releaseVerification = resolve);
      return { result, issues: [], checked: { referenceFeatures: true, behaviorNotInferred: true, lensIsolation: true, tieConsistency: true, allClaimsEvidenced: true, overallTradeoff: true, wordCounts: true } };
    });
  });
  await page.locator('#verify').click(); await page.waitForFunction(() => !!window.__releaseVerification);
  await page.locator('[data-final=fidelityReason]').fill('An edit made while verification was running.');
  await page.evaluate(() => window.__releaseVerification());
  await expect(page.locator('#notice')).toContainText('Answers changed during verification');
  expect(await page.evaluate(() => __BERRY3VISUAL_TEST__.validateAll().valid)).toBe(false);
  await expect(page.locator('#copyAll')).toBeEnabled();
});

test('native OpenRouter client sends image parts and retains usage telemetry without secrets', async ({ page }) => {
  const errors = await open(page, true);
  await page.evaluate(() => {
    const T = __BERRY3VISUAL_TEST__;
    T.settings.apiKey = 'sk-or-v1-native-client-test'; T.state.models = [{ id: T.settings.model, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }];
    window.__sample = structuredClone(T.state.draft); window.__features = structuredClone(T.state.features);
  });
  const bodies = [];
  await page.route('**openrouter.ai/api/v1/chat/completions', async route => {
    const body = route.request().postDataJSON(); bodies.push(body);
    expect(route.request().headers().authorization).toBe('Bearer sk-or-v1-native-client-test');
    const result = await page.evaluate(() => {
      const T = __BERRY3VISUAL_TEST__, result = structuredClone(window.__sample);
      for (const d of T.DIMS) for (const c of result[d].claims) c.evidenceIds = d === 'functionality' ? [...T.retainedBehavior().A, ...T.retainedBehavior().B].map(f => f.id) : d === 'fidelity' ? T.state.features.map(f => f.id) : [...T.state.features.map(f => f.id), ...T.retainedBehavior().A.map(f => f.id), ...T.retainedBehavior().B.map(f => f.id)];
      return result;
    });
    const instruction = body.messages[0].content.split('\nPASS: ')[1];
    const response = instruction.startsWith('Observe images') ? { features: await page.evaluate(() => window.__features) } : instruction.startsWith('Adversarial QA') ? { result, issues: [], checked: { referenceFeatures: true, behaviorNotInferred: true, lensIsolation: true, tieConsistency: true, allClaimsEvidenced: true, overallTradeoff: true, wordCounts: true } } : result;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }], usage: { prompt_tokens: 100, completion_tokens: 80, cost: 0.002 } }) });
  });
  await page.locator('#generate').click(); await expect(page.locator('#notice')).toContainText('Analysis complete.');
  expect(bodies).toHaveLength(3); expect(bodies[0].messages[1].content.filter(p => p.type === 'image_url').every(p => p.image_url.url.startsWith('data:image/png;base64,'))).toBe(true);
  const debug = await page.evaluate(() => __BERRY3VISUAL_TEST__.buildDebugReport());
  expect(debug.passes[0].usage.prompt_tokens).toBe(100); expect(debug.passes[0].usage.cost).toBe(0.002);
  expect(JSON.stringify(debug)).not.toContain('native-client-test'); expect(errors).toEqual([]);
});

test('cancel stops the pipeline and releases evidence editing', async ({ page }) => {
  await open(page, true);
  await page.evaluate(() => {
    const T = __BERRY3VISUAL_TEST__; T.settings.apiKey = 'test-key'; T.state.models = [{ id: T.settings.model, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }];
    T.setAiTransport(async () => { await new Promise(r => window.__release = r); return { features: T.state.features }; });
  });
  await page.locator('#generate').click(); await page.waitForFunction(() => !!window.__release);
  await page.locator('#cancel').click(); await page.evaluate(() => window.__release());
  await expect(page.locator('#notice')).toContainText('cancelled');
  await expect(page.locator('#generate')).toBeEnabled();
  expect(await page.locator('#visualPanel').evaluate(e => e.inert)).toBe(false);
});

test('outcome contradiction flags only global winner claims, not local subfeature comparisons', async ({ page }) => {
  await open(page, true);
  const pad = 'The reference image also shows a gray lower region and three small toolbar controls, and this comparative description adds concrete detail about the panels and their surrounding areas for both candidates.';
  const local = 'Website A is better because Website B better reproduces the emblem while Website A is closer in spacing, although Website B has the closer headline scale. ' + pad;
  expect((await check(page, 'fidelity', 'A is better', local)).issues.join(' ')).not.toContain('contradiction');
  const global = 'Website A is better because Website A preserves the reference panels. Website B is better. ' + pad;
  expect((await check(page, 'fidelity', 'A is better', global)).issues.join(' ')).toContain('contradiction');
  const globalB = 'Website B is better because Website B preserves the reference panels. Website A wins overall. ' + pad;
  expect((await check(page, 'fidelity', 'B is better', globalB)).issues.join(' ')).toContain('contradiction');
});

test('Overall trade-off accepts semantic equivalents without magic keywords', async ({ page }) => {
  await open(page, true);
  const pad = 'Website A and Website B both show the reference gray editor region under a dark preview, and this sentence adds concrete detail about the panels and their surrounding areas so both candidates are described.';
  const cases = [
    ['A is better', 'Website A is better because its interaction advantage outweighs visual drift: Website A works reliably while Website B has dead controls, even though the reference palette matches Website B. ' + pad],
    ['A is better', 'Website A is better because closer reproduction does not compensate for dead controls; the reference image favors Website B on the heading, but Website A loads and responds. ' + pad],
    ['Both are good', 'Website A and Website B are tied as good options because both behave similarly, so fidelity decides: the reference gray editor region matches Website A while Website B changes the lower panel. ' + pad],
    ['A is better', 'Website A is better because the fidelity difference is small while the functionality difference is substantial, and Website B fails to respond where Website A works. ' + pad]
  ];
  for (const [option, reason] of cases) expect((await check(page, 'overall', option, reason)).issues.join(' ')).not.toContain('weigh reference fidelity');
  const noTrade = 'Website A is better because the reference panels match Website A while Website B changes the heading color. Website A also works and Website B loads. ' + pad;
  expect((await check(page, 'overall', 'A is better', noTrade)).issues.join(' ')).toContain('weigh reference fidelity');
});

test('internal reconstruction language is stripped from generated submission prose and flagged if reintroduced', async ({ page }) => {
  await open(page);
  const out = await page.evaluate(() => {
    const T = __BERRY3VISUAL_TEST__;
    return {
      unit: T.sanitizeFinalProse('Website A is better because it preserves the reference palette; font fallbacks limit exact typography comparisons. Website B changes the heading color.'),
      dropped: T.sanitizeFinalProse('Typography differences deserve caution because font fallback may alter wrapping.'),
      clean: T.sanitizeFinalProse('Website A is better because it preserves the reference panels while Website B changes them.'),
      integrated: T.finalFrom({ functionality: { option: 'A is better', reason: 'Website A is better because the reference toolbar responds; reconstruction warnings reduce certainty about the lower region across both candidates.' }, fidelity: { option: 'A is better', reason: 'Website A is better because it preserves the reference panels; font fallbacks limit exact typography comparisons. Website B changes them.' }, overall: { option: 'A is better', reason: 'Website A is better because it preserves the reference panels while Website B changes them, and Website A also responds where Website B is unresponsive.' } }),
      flagged: T.validateDimension('fidelity', 'A is better', 'Website A is better because it preserves the reference panels while Website B changes them, though reconstruction warnings reduce certainty about the lower region and the surrounding details of both pages here.').issues
    };
  });
  expect(out.unit).toContain('preserves the reference palette');
  expect(out.unit).not.toMatch(/font fallbacks/i);
  expect(out.dropped).toBe('');
  expect(out.clean).not.toMatch(/reconstruction|font fallback/i);
  expect(out.integrated.fidelityReason).toContain('preserves the reference panels');
  expect(out.integrated.fidelityReason).not.toMatch(/font fallback/i);
  expect(out.integrated.functionalityReason).not.toMatch(/reconstruction/i);
  expect(out.flagged.join(' ')).toContain('internal reconstruction/mechanism');
});

test('feature ledger carries importance, match quality, local winner and magnitude; advisory reports close and strong calls', async ({ page }) => {
  await open(page, true);
  const out = await page.evaluate(() => {
    const T = __BERRY3VISUAL_TEST__, s = T.state, ids = ['R', 'A', 'B'].map(k => k === 'R' ? s.task.referenceImages[0].id : s.task.candidates[k].images[0].id);
    const normalized = T.normalizeFeatures([{ feature: 'Hero', reference: 'Reference hero', A: 'A hero', B: 'B hero', importance: 4, matchA: 5, matchB: 1, magnitude: 'major', imageIds: ids, confidence: 'high' }])[0];
    s.features = [
      { id: 'visual-1', feature: 'Hero', location: 'Top', importance: 3, matchA: 4, matchB: 3, localWinner: 'A', magnitude: 'moderate', reference: 'Reference hero', A: 'A hero', B: 'B hero', imageIds: ids, confidence: 'high', manual: false },
      { id: 'visual-2', feature: 'Footer', location: 'Bottom', importance: 2, matchA: 2, matchB: 4, localWinner: 'B', magnitude: 'major', reference: 'Reference footer', A: 'A footer', B: 'B footer', imageIds: ids, confidence: 'high', manual: false }
    ];
    const close = T.fidelityAdvisory();
    s.features.push({ id: 'visual-3', feature: 'Panel', location: 'Mid', importance: 5, matchA: 2, matchB: 5, localWinner: 'B', magnitude: 'major', reference: 'Reference panel', A: 'A panel', B: 'B panel', imageIds: ids, confidence: 'high', manual: false });
    return { normalized, close, strong: T.fidelityAdvisory() };
  });
  expect(out.normalized).toMatchObject({ importance: 4, matchA: 5, matchB: 1, localWinner: 'A', magnitude: 'major' });
  expect(out.close.close).toBe(true);
  expect(out.strong.verdict).toBe('B');
  expect(out.strong.close).toBe(false);
  const shown = await page.evaluate(() => {
    const T = __BERRY3VISUAL_TEST__, s = T.state, ids = ['R', 'A', 'B'].map(k => k === 'R' ? s.task.referenceImages[0].id : s.task.candidates[k].images[0].id);
    s.features = [
      { id: 'visual-1', feature: 'Hero', location: 'Top', importance: 3, matchA: 4, matchB: 3, localWinner: 'A', magnitude: 'moderate', reference: 'Reference hero', A: 'A hero', B: 'B hero', imageIds: ids, confidence: 'high', manual: false },
      { id: 'visual-2', feature: 'Footer', location: 'Bottom', importance: 2, matchA: 2, matchB: 4, localWinner: 'B', magnitude: 'major', reference: 'Reference footer', A: 'A footer', B: 'B footer', imageIds: ids, confidence: 'high', manual: false }
    ];
    T.renderAll();
    return document.querySelector('#reconstructionStatus').textContent;
  });
  expect(shown).toContain('Close fidelity call');
});

test('decision synthesis consumes the enriched ledger and carries the sparse-task functionality instructions', async ({ page }) => {
  await open(page, true); await mockPipeline(page);
  await page.locator('#generate').click(); await expect(page.locator('#notice')).toContainText('Analysis complete');
  const calls = await page.evaluate(() => window.__calls);
  const payload = JSON.parse(calls[1].messages[1].content);
  expect(payload.advisory).toBeTruthy();
  expect(payload.visualEvidence.length).toBeGreaterThan(0);
  expect(payload.visualEvidence.every(f => 'localWinner' in f && 'magnitude' in f && 'importance' in f)).toBe(true);
  expect(calls[0].messages[0].content).toContain('sparse interface is not a functionality failure');
  expect(calls[0].messages[0].content).toContain('Few controls is not a functionality failure');
});

test('one transient provider retry uses an identical payload and records both attempts; 400 never retries', async ({ page }) => {
  const errors = await open(page, true);
  await page.evaluate(() => { const T = __BERRY3VISUAL_TEST__, s = T.state; T.settings.apiKey = 'test-key'; T.settings.chime = false; s.models = [{ id: T.settings.model, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }]; window.__sample = structuredClone(s.draft); window.__features = structuredClone(s.features); });
  const bodies = []; let first = true;
  await page.route('**openrouter.ai/api/v1/chat/completions', async route => {
    const body = route.request().postDataJSON(); bodies.push(body);
    if (first) { first = false; return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Provider returned error', code: 502 } }) }); }
    const instruction = body.messages[0].content.split('\nPASS: ')[1];
    let response;
    if (instruction.startsWith('Observe images')) response = { features: await page.evaluate(() => window.__features) };
    else if (instruction.startsWith('Adversarial QA')) {
      const result = await page.evaluate(() => { const T = __BERRY3VISUAL_TEST__, result = structuredClone(window.__sample); for (const d of T.DIMS) for (const c of result[d].claims) c.evidenceIds = d === 'functionality' ? [...T.retainedBehavior().A, ...T.retainedBehavior().B].map(f => f.id) : d === 'fidelity' ? T.state.features.map(f => f.id) : [...T.state.features.map(f => f.id), ...T.retainedBehavior().A.map(f => f.id), ...T.retainedBehavior().B.map(f => f.id)]; return result });
      response = { result, issues: [], checked: { referenceFeatures: true, behaviorNotInferred: true, lensIsolation: true, tieConsistency: true, allClaimsEvidenced: true, overallTradeoff: true, wordCounts: true } };
    } else response = await page.evaluate(() => window.__sample);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ provider: 'OpenAI', choices: [{ message: { content: JSON.stringify(response) } }], usage: { prompt_tokens: 1 } }) });
  });
  await page.locator('#generate').click();
  await expect(page.locator('#notice')).toContainText('Analysis complete');
  expect(bodies).toHaveLength(4);
  expect(JSON.stringify(bodies[0])).toBe(JSON.stringify(bodies[1]));
  const passes = await page.evaluate(() => __BERRY3VISUAL_TEST__.state.passes.map(p => ({ stage: p.stage, attempt: p.attempt, status: p.status, retryReason: p.retryReason || null, httpStatus: p.httpStatus })));
  expect(passes[0]).toMatchObject({ stage: 'visual observation', attempt: 1, status: 'retrying', retryReason: 'HTTP 502', httpStatus: 502 });
  expect(passes[1]).toMatchObject({ stage: 'visual observation', attempt: 2, status: 'done', httpStatus: 200 });
  expect(errors.filter(e => !/Failed to load resource/.test(e))).toEqual([]);
});

test('a deterministic 400 response is not retried', async ({ page }) => {
  const errors = await open(page, true);
  await page.evaluate(() => { const T = __BERRY3VISUAL_TEST__, s = T.state; T.settings.apiKey = 'test-key'; T.settings.chime = false; s.models = [{ id: T.settings.model, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }]; });
  await page.route('**openrouter.ai/api/v1/chat/completions', r => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Provider returned error', code: 400 } }) }));
  await page.evaluate(() => { const T = __BERRY3VISUAL_TEST__; T.generate(); });
  await expect(page.locator('#notice')).toContainText('HTTP 400');
  const passes = await page.evaluate(() => __BERRY3VISUAL_TEST__.state.passes.map(p => ({ attempt: p.attempt, status: p.status })));
  expect(passes).toEqual([{ attempt: 1, status: 'failed' }]);
  expect(errors.filter(e => !/Failed to load resource/.test(e))).toEqual([]);
});

test('per-field copy controls work independently of QA and keep focus', async ({ page }) => {
  const errors = await open(page, true);
  await page.evaluate(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => window.__copied.push(t) } }); });
  await page.locator('[data-copyopt=functionality]').click();
  await expect(page.locator('[data-copyopt=functionality]')).toHaveText('Copied ✓');
  await page.locator('[data-copyreason=functionality]').click();
  await page.evaluate(() => { const T = __BERRY3VISUAL_TEST__; T.state.final.functionalityReason = 'Short invalid text.'; T.renderSubmission(); });
  await page.locator('[data-copyreason=functionality]').click();
  const copied = await page.evaluate(() => window.__copied);
  expect(copied[0]).toBe('B is better');
  expect(copied[1]).toContain('Settings button opened the settings dialog');
  expect(copied[2]).toBe('Short invalid text.');
  const focused = await page.evaluate(() => document.activeElement?.dataset?.copyreason || document.activeElement?.getAttribute('data-copyreason'));
  expect(focused).toBe('functionality');
  expect(errors).toEqual([]);
});

test('full Analyze stays disabled until both candidates have confirmed live behavior; fidelity-only stays available', async ({ page }) => {
  await open(page, true);
  await page.evaluate(() => { const T = __BERRY3VISUAL_TEST__; ['A', 'B'].forEach(k => { T.state.task.candidates[k].behaviorEvidence = []; T.setRenderStatus(k, 'unknown'); }); });
  await expect(page.locator('#generate')).toBeDisabled();
  await expect(page.locator('#generate')).toHaveText('ADD BEHAVIOR TO GENERATE ALL');
  await expect(page.locator('#generateHint')).toContainText('confirmed live behavior check');
  await expect(page.locator('#visualOnly')).toBeEnabled();
  for (const k of ['A', 'B']) {
    await page.locator(`[data-quicktext="${k}"]`).fill('Resolution toggle changed state');
    await page.locator(`[data-quickresult="${k}"]`).selectOption('Works');
    await page.locator(`[data-quickadd="${k}"]`).click();
  }
  const facts = await page.evaluate(() => __BERRY3VISUAL_TEST__.retainedBehavior());
  expect(facts.A[0]).toMatchObject({ source: 'human-live-check', confidence: 'confirmed', status: 'passed', control: 'Resolution toggle changed state' });
  await expect(page.locator('#generate')).toBeEnabled();
  await expect(page.locator('#generate')).toHaveText('ANALYZE & GENERATE');
});

test('no-meaningful-controls confirmation warns from source hints, can be dismissed, and counts only when explicitly confirmed', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { const T = __BERRY3VISUAL_TEST__, s = T.state; s.task.candidates.A.interactiveHints = { buttons: 3, inputs: 0, textareas: 1, selects: 0, links: 0, total: 4 }; T.renderAll(); });
  let message = '';
  page.once('dialog', d => { message = d.message(); d.dismiss(); });
  await page.evaluate(() => { const el = document.querySelector('[data-nocontrols=A]'); el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(message).toContain('3 buttons and 1 textarea');
  expect(await page.evaluate(() => __BERRY3VISUAL_TEST__.state.task.candidates.A.noInteractiveControls)).toBe(false);
  page.once('dialog', d => d.accept());
  await page.evaluate(() => { const el = document.querySelector('[data-nocontrols=A]'); el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
  const out = await page.evaluate(() => ({ flag: __BERRY3VISUAL_TEST__.state.task.candidates.A.noInteractiveControls, facts: __BERRY3VISUAL_TEST__.retainedBehavior().A }));
  expect(out.flag).toBe(true);
  expect(out.facts).toHaveLength(1);
  expect(out.facts[0]).toMatchObject({ source: 'human-live-check', confidence: 'confirmed', noControls: true });
});

test('confirmed partial live checks satisfy the behavior gate while remaining distinguishable from pass and fail', async ({ page }) => {
  const errors = await open(page, true);
  await page.evaluate(() => {
    const T = __BERRY3VISUAL_TEST__, s = T.state;
    T.settings.apiKey = 'test-key'; T.settings.chime = false;
    s.models = [{ id: T.settings.model, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }];
    window.__sample = structuredClone(s.draft); window.__payloads = []; window.__system = '';
    T.setAiTransport(async (stage, messages) => {
      if (stage === 'decision synthesis') { window.__system = messages[0].content; window.__payloads.push(JSON.parse(messages[1].content)); }
      if (stage === 'visual observation') return { features: structuredClone(T.state.features) };
      const result = structuredClone(window.__sample);
      for (const d of T.DIMS) for (const c of result[d].claims) c.evidenceIds = d === 'functionality' ? [...T.retainedBehavior().A, ...T.retainedBehavior().B].map(f => f.id) : d === 'fidelity' ? T.state.features.map(f => f.id) : [...T.state.features.map(f => f.id), ...T.retainedBehavior().A.map(f => f.id), ...T.retainedBehavior().B.map(f => f.id)];
      if (stage === 'adversarial QA') return { result, issues: [], checked: { referenceFeatures: true, behaviorNotInferred: true, lensIsolation: true, tieConsistency: true, allClaimsEvidenced: true, overallTradeoff: true, wordCounts: true } };
      return result;
    });
  });
  const combos = [['partial', 'pass'], ['partial', 'fail'], ['partial', 'partial'], ['fail', 'partial']];
  const canonical = s => s === 'pass' ? 'passed' : s === 'fail' ? 'failed' : s;
  for (let i = 0; i < combos.length; i++) {
    const [statusA, statusB] = combos[i];
    const gate = await page.evaluate(({ statusA, statusB }) => {
      const T = __BERRY3VISUAL_TEST__, s = T.state;
      s.task.candidates.A.behaviorEvidence = T.normalizeBehavior({ A: [{ observation: 'Toggle tested live', status: statusA, source: 'human-live-check', confidence: 'confirmed' }] }).A;
      s.task.candidates.B.behaviorEvidence = T.normalizeBehavior({ B: [{ observation: 'Toggle tested live', status: statusB, source: 'human-live-check', confidence: 'confirmed' }] }).B;
      T.changed();
      return { can: T.canAnalyzeBehavior(), full: T.canSynthesizeFullEvaluation(), retained: T.retainedBehavior() };
    }, { statusA, statusB });
    expect(gate.can).toBe(true); expect(gate.full).toBe(true);
    expect(gate.retained.A[0]).toMatchObject({ status: canonical(statusA), confidence: 'confirmed', source: 'human-live-check' });
    expect(gate.retained.B[0]).toMatchObject({ status: canonical(statusB), confidence: 'confirmed', source: 'human-live-check' });
    await page.locator('#generate').click();
    await page.waitForFunction(n => window.__payloads.length > n, i);
    await expect.poll(() => page.evaluate(() => __BERRY3VISUAL_TEST__.state.busy)).toBe(false);
    await expect(page.locator('#notice')).toContainText('Analysis complete');
  }
  const out = await page.evaluate(() => ({ payloads: window.__payloads, system: window.__system, final: __BERRY3VISUAL_TEST__.state.final }));
  expect(out.payloads).toHaveLength(4);
  const statuses = out.payloads.map(p => [p.behaviorEvidence.A[0].status, p.behaviorEvidence.B[0].status]);
  expect(statuses).toEqual(combos.map(([a, b]) => [canonical(a), canonical(b)]));
  expect(out.payloads[0].behaviorEvidence.A[0].status).toBe('partial');
  expect(out.payloads[0].behaviorEvidence.B[0].status).toBe('passed');
  expect(out.system).toContain('weigh passed over partial over failed');
  for (const d of ['functionality', 'fidelity', 'overall']) { expect(out.final[d + 'Reason']).toBeTruthy(); expect(out.final[d + 'Option']).toBeTruthy(); }
  const denials = await page.evaluate(() => {
    const T = __BERRY3VISUAL_TEST__, s = T.state;
    T.setRenderStatus('A', 'unknown'); T.setRenderStatus('B', 'unknown');
    s.task.candidates.A.behaviorEvidence = T.normalizeBehavior({ A: [{ observation: 'Button exists in source', status: 'passed', source: 'source-code', confidence: 'confirmed' }] }).A;
    s.task.candidates.B.behaviorEvidence = T.normalizeBehavior({ B: [{ observation: 'Button exists in source', status: 'passed', source: 'source-code', confidence: 'confirmed' }] }).B;
    return { can: T.canAnalyzeBehavior(), a: T.retainedBehavior().A, b: T.retainedBehavior().B };
  });
  expect(denials.can).toBe(false); expect(denials.a).toEqual([]); expect(denials.b).toEqual([]);
  expect(errors).toEqual([]);
});
