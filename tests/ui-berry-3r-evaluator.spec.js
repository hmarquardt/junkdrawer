const { test, expect } = require('@playwright/test');
const path = require('path');

const fileUrl = `file://${path.resolve(process.cwd(), 'ui-berry-3r-evaluator.html')}`;
const productionFixture = process.env.BERRY_PRODUCTION_FIXTURE;

test.use({ channel: 'chrome' });

async function open(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/api/analytics/**', route => route.fulfill({ status: 204, body: '' }));
  await page.goto(fileUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__BERRY3R_TEST__));
  return errors;
}

const filler = n => Array.from({ length: n }, (_, i) => `detail${i + 1}`).join(' ');
const reason = (option, n = 40, extra = '') => {
  const start = option === 'A is better'
    ? 'Website A is better because'
    : option === 'B is better'
      ? 'Website B is better because'
      : option === 'Both are good'
        ? 'Website A and Website B are tied as good options because'
        : 'Website A and Website B are tied as bad options because';
  const required = `${start} Website A has ${extra || 'balanced concrete qualities'}, while Website B has comparable concrete qualities.`;
  const count = required.trim().split(/\s+/).length;
  return `${required} ${filler(Math.max(0, n - count))}`.trim();
};

async function validate(page, dim, option, text, statuses = { A: 'normal', B: 'normal' }) {
  return page.evaluate(({ dim, option, text, statuses }) =>
    window.__BERRY3R_TEST__.validateDimension(dim, option, text, {}, statuses),
  { dim, option, text, statuses });
}

test('parser recovers shell, complete request, candidate identity, URLs, and all six existing fields', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  await expect(page.locator('#workspace')).toBeVisible();
  const parsed = await page.evaluate(() => {
    const s = window.__BERRY3R_TEST__.state;
    return {
      request: s.task.userRequest.text,
      a: [s.task.websiteA.part.index, s.task.websiteA.url, s.task.websiteA.iframeSrc],
      b: [s.task.websiteB.part.index, s.task.websiteB.url, s.task.websiteB.iframeSrc],
      answers: s.task.existingAnswers
    };
  });
  expect(parsed.request).toContain('settings modal');
  expect(parsed.request).toContain('responsive');
  expect(parsed.a[0]).not.toBe(parsed.b[0]);
  expect(parsed.a[1]).toBe('https://candidate-a.example.test/');
  expect(parsed.b[1]).toBe('https://candidate-b.example.test/');
  expect(parsed.a[2]).toContain('berry-a@test');
  expect(parsed.b[2]).toContain('berry-b@test');
  expect(parsed.answers).toMatchObject({
    aestheticsOption: 'A is better', functionalityOption: 'B is better', overallOption: 'B is better'
  });
  expect(parsed.answers.aestheticsReason).toContain('Website A is better');
  expect(parsed.answers.functionalityReason).toContain('Website B is better');
  expect(parsed.answers.overallReason).toContain('Website B is better');
  expect(errors).toEqual([]);
});

test('manual candidate reassignment changes only the selected side and prevents an accidental same-part assignment', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const before = await page.evaluate(() => ({ a: __BERRY3R_TEST__.state.task.websiteA.part.index, b: __BERRY3R_TEST__.state.task.websiteB.part.index }));
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('[data-assign=A]').selectOption(String(before.b));
  const after = await page.evaluate(() => ({ a: __BERRY3R_TEST__.state.task.websiteA.part.index, b: __BERRY3R_TEST__.state.task.websiteB.part.index }));
  expect(after).toEqual(before);
});

test('40 words are accepted', async ({ page }) => {
  await open(page); const out = await validate(page, 'aesthetics', 'A is better', reason('A is better', 40));
  expect(out.wc).toBe(40); expect(out.hard).toEqual([]);
});

test('160 words are accepted', async ({ page }) => {
  await open(page); const out = await validate(page, 'aesthetics', 'A is better', reason('A is better', 160));
  expect(out.wc).toBe(160); expect(out.hard).toEqual([]);
});

test('39 words are rejected', async ({ page }) => {
  await open(page); const out = await validate(page, 'aesthetics', 'A is better', reason('A is better', 39));
  expect(out.wc).toBe(39); expect(out.hard.join(' ')).toContain('40–160');
});

test('161 words are rejected', async ({ page }) => {
  await open(page); const out = await validate(page, 'aesthetics', 'A is better', reason('A is better', 161));
  expect(out.wc).toBe(161); expect(out.hard.join(' ')).toContain('40–160');
});

test('missing field and invalid option are hard failures', async ({ page }) => {
  await open(page); const out = await validate(page, 'overall', '', '');
  expect(out.hard).toEqual(expect.arrayContaining(['Choose an option.', 'Write a reason.']));
  const wrong = await validate(page, 'overall', 'A wins', reason('A is better', 40));
  expect(wrong.hard.join(' ')).toContain('exactly match');
});

test('wrong opening is rejected', async ({ page }) => {
  await open(page); const text = reason('A is better', 40).replace('Website A is better because', 'Website B appears first because');
  const out = await validate(page, 'aesthetics', 'A is better', text);
  expect(out.hard.join(' ')).toContain('Open with');
});

test('bare candidate naming is rejected', async ({ page }) => {
  await open(page); const text = reason('A is better', 40) + ' A wins this comparison.';
  const out = await validate(page, 'aesthetics', 'A is better', text);
  expect(out.hard.join(' ')).toContain('full names');
});

test('reason mentioning only the winner is rejected', async ({ page }) => {
  await open(page); const text = `Website A is better because ${filler(34)}`;
  const out = await validate(page, 'aesthetics', 'A is better', text);
  expect(out.hard.join(' ')).toContain('both Website A and Website B');
});

test('aesthetics behavioral leakage is flagged', async ({ page }) => {
  await open(page); const out = await validate(page, 'aesthetics', 'A is better', reason('A is better', 45, 'balanced layout and a button that works'));
  expect(out.lint.join(' ')).toContain('behavioral');
});

test('functionality visual leakage is flagged', async ({ page }) => {
  await open(page); const out = await validate(page, 'functionality', 'B is better', reason('B is better', 45, 'working controls and nicer colors'));
  expect(out.lint.join(' ')).toContain('visual-quality');
});

test('overall one-lens-only reasoning is flagged', async ({ page }) => {
  await open(page); const out = await validate(page, 'overall', 'A is better', reason('A is better', 45, 'balanced typography, palette, spacing, and visual polish'));
  expect(out.lint.join(' ')).toContain('both visual experience and fulfillment');
});

test('reused reason text is a hard failure and large overlap is warned', async ({ page }) => {
  await open(page); const r = reason('A is better', 55, 'layout button control navigation typography');
  const final = { aestheticsOption: 'A is better', aestheticsReason: r, functionalityOption: 'A is better', functionalityReason: r, overallOption: 'A is better', overallReason: `${r} extra` };
  const out = await page.evaluate(final => __BERRY3R_TEST__.validateAll(final, { A: 'normal', B: 'normal' }), final);
  expect(out.hard.join(' ')).toContain('identical');
  expect(out.lint.join(' ')).toContain('8+ word sequence');
});

test('Both option with winner language is flagged', async ({ page }) => {
  await open(page); const text = reason('Both are good', 50) + ' Website A is cleaner and better.';
  const out = await validate(page, 'aesthetics', 'Both are good', text);
  expect(out.lint.join(' ')).toContain('one-sided');
});

for (const [overall, overallReason] of [
  ['A is better', reason('A is better', 55, 'visual layout and working controls together')],
  ['B is better', reason('B is better', 55, 'visual layout and working controls together')],
  ['Both are good', reason('Both are good', 55, 'balanced visual layout and working controls offset each other')]
]) {
  test(`independent split decision accepts Overall=${overall}`, async ({ page }) => {
    await open(page);
    const final = {
      aestheticsOption: 'A is better', aestheticsReason: reason('A is better', 55, 'layout typography palette spacing'),
      functionalityOption: 'B is better', functionalityReason: reason('B is better', 55, 'working controls navigation modal form'),
      overallOption: overall, overallReason
    };
    const out = await page.evaluate(final => __BERRY3R_TEST__.validateAll(final, { A: 'normal', B: 'normal' }), final);
    expect(out.fields.overall.hard).toEqual([]);
    expect(out.hard.filter(x => x.startsWith('Overall'))).toEqual([]);
  });
}

test('one completely broken candidate deterministically assigns the working site all three wins', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  await page.locator('[data-note="A.status"]').selectOption('broken');
  const out = await page.evaluate(() => ({ a: __BERRY3R_TEST__.state.final.aestheticsOption, f: __BERRY3R_TEST__.state.final.functionalityOption, o: __BERRY3R_TEST__.state.final.overallOption }));
  expect(out).toEqual({ a: 'B is better', f: 'B is better', o: 'B is better' });
});

test('both broken assigns all Both are bad and waives minimum words', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  await page.locator('[data-note="A.status"]').selectOption('broken');
  await page.locator('[data-note="B.status"]').selectOption('broken');
  const options = await page.evaluate(() => ['aesthetics', 'functionality', 'overall'].map(d => __BERRY3R_TEST__.state.final[d + 'Option']));
  expect(options).toEqual(['Both are bad', 'Both are bad', 'Both are bad']);
  const short = await validate(page, 'overall', 'Both are bad', 'Website A and Website B are tied as bad options because neither renders.', { A: 'broken', B: 'broken' });
  expect(short.hard.join(' ')).not.toContain('40–160');
});

test('six fields round-trip through Berry history-shaped records', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const before = await page.evaluate(() => { const t = __BERRY3R_TEST__; const r = t.record(); t.restoreForTest(r); return { record: r.final, restored: t.state.final }; });
  expect(before.restored).toEqual(before.record);
  expect(Object.keys(before.record)).toHaveLength(6);
});

test('human edits survive AI re-evaluation while untouched fields populate', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  await page.locator('textarea[data-final="aestheticsReason"]').fill('Website A is better because this is a human-authored reason that must survive. Website A and Website B are both named here with enough placeholder details to identify the edited field during the regression test and ensure it is never replaced by later artificial intelligence output for any reason whatsoever.');
  const ai = {
    aesthetics: { option: 'B is better', reason: reason('B is better', 50), evidence: [], caveats: [], confidence: .8 },
    functionality: { option: 'A is better', reason: reason('A is better', 50), evidence: [], caveats: [], confidence: .8 },
    overall: { option: 'Both are good', reason: reason('Both are good', 50), evidence: [], caveats: [], confidence: .7 }
  };
  const out = await page.evaluate(ai => { __BERRY3R_TEST__.applyAiResult(ai); return __BERRY3R_TEST__.state.final; }, ai);
  expect(out.aestheticsReason).toContain('human-authored reason');
  expect(out.functionalityOption).toBe('A is better');
  expect(out.overallOption).toBe('Both are good');
});

test('actual UI smoke: parse, open URLs, six fields, live validation, clipboard, and clean console', async ({ page, context }) => {
  const errors = await open(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'file://' }).catch(() => {});
  await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  await expect(page.locator('[data-open="A"]')).toHaveCount(3);
  await expect(page.locator('[data-open="B"]')).toHaveCount(3);
  await expect(page.locator('.answer')).toHaveCount(3);
  await expect(page.locator('.answer textarea')).toHaveCount(3);
  await expect(page.locator('.answer input[type=radio]')).toHaveCount(12);
  await expect(page.locator('#request')).toHaveValue(/Pomodoro timer/);
  await page.locator('textarea[data-final="overallReason"]').fill('Too short');
  await expect(page.locator('[data-dim="overall"] .hard').first()).toContainText('40–160');
  await page.locator('[data-dim="overall"] [data-copy="overallReason"]').click();
  await page.screenshot({ path: '/tmp/ui-berry-3r-evaluator.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('production fixture smoke parses exact Feather shell, candidate mapping, URLs, request, and six field controls', async ({ page }) => {
  test.skip(!productionFixture, 'Set BERRY_PRODUCTION_FIXTURE to run the private local smoke fixture.');
  const errors = await open(page);
  await page.locator('#file').setInputFiles(productionFixture);
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#request')).toHaveValue(/Pomodoro timer/);
  const out = await page.evaluate(() => {
    const s = __BERRY3R_TEST__.state;
    return { parts: s.archive.parts.length, html: s.archive.htmlParts.length, request: s.task.userRequest.text, warnings: s.task.warnings, a: s.task.websiteA, b: s.task.websiteB, fields: Object.keys(s.task.existingAnswers) };
  });
  expect(out.parts).toBeGreaterThan(2);
  expect(out.html).toBeGreaterThanOrEqual(3);
  expect(out.a.part.index).not.toBe(out.b.part.index);
  expect(out.a.url).toMatch(/^https:\/\//);
  expect(out.b.url).toMatch(/^https:\/\//);
  expect(out.request).toMatch(/maintainin$/);
  expect(out.warnings.join(' ')).toContain('source-truncated');
  expect(out.fields.sort()).toEqual(['aestheticsOption','aestheticsReason','functionalityOption','functionalityReason','overallOption','overallReason'].sort());
  expect(errors).toEqual([]);
});

test('mobile layout has no page-level horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
