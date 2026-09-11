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
  await expect(page.locator('#copyAll')).toBeDisabled();
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
  await page.locator('#generate').click(); await expect(page.locator('#notice')).toContainText('Reference Fidelity complete');
  await expect(page.locator('#notice')).toContainText('Add confirmed behavior observations');
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
  await expect(page.locator('#copyAll')).toBeDisabled();
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
