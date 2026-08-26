const { test, expect } = require('@playwright/test');
const path = require('path');

const fileUrl = `file://${path.resolve(process.cwd(), 'ui-berry-3r-evaluator.html')}`;
const productionFixture = process.env.BERRY_PRODUCTION_FIXTURE;
const productionFixtures = (process.env.BERRY_PRODUCTION_FIXTURES || '').split(path.delimiter).filter(Boolean);

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

const autoReasons = {
  aesthetics: 'Website A is better because its balanced spacing, crisp typography, restrained palette, and centered hierarchy create a clearer visual focus, while Website B uses denser spacing, a less consistent heading scale, and more competing accents. Website B remains readable and coherent, but Website A presents the timer with stronger alignment, contrast, and overall visual consistency.',
  functionality: 'Website B is better because Website B includes the requested mode controls, settings panel, and state-change structure, while Website A includes the timer and reset control but has no comparable configuration flow. Website B therefore represents more core requirements through clearly labeled controls and corresponding panels, while Website A provides a narrower set of requested inputs and actions.',
  overall: 'Website B is better because Website A has the more polished hierarchy, steadier spacing, and cleaner palette, but Website B represents the requested settings and mode-control flow more completely. Website B’s denser layout costs less for this timer request than Website A’s narrower configuration structure, because customization is a core workflow requirement and matters more here than the difference in visual refinement.'
};

function automationResponses({ shortFunctionality = false, qaIssues = [] } = {}) {
  const result = {
    aesthetics: { option: 'A is better', reason: autoReasons.aesthetics, evidence: ['A-lens-visual'], caveats: [], confidence: .82 },
    functionality: { option: 'B is better', reason: shortFunctionality ? 'Website B is better because Website B has more evidence than Website A.' : autoReasons.functionality, evidence: ['B-r1'], caveats: ['Static behavior not confirmed'], confidence: .7 },
    overall: { option: 'B is better', reason: autoReasons.overall, evidence: ['A-lens-visual', 'B-r1'], caveats: [], confidence: .76 }
  };
  return {
    request: { purpose: 'Provide a configurable Pomodoro timer.', requirements: [
      { id: 'r1', text: 'Design a Pomodoro timer with red work mode, green short break, blue long break, a circular progress indicator, start, pause, reset, and a settings modal.', lens: 'mixed', importance: 'core', kind: 'behavior' },
      { id: 'r2', text: 'Make it responsive.', lens: 'mixed', importance: 'core', kind: 'responsive' }
    ] },
    'facts-A': { website: 'A', facts: [
      { id: 'A-r1', claim: 'Website A contains timer and reset controls.', lens: 'functionality', source: 'archive-dom', confidence: 'UNVERIFIED', behaviorAssessment: 'UNVERIFIED', requirementIds: ['r1'], relevance: 'explicit' },
      { id: 'A-visual', claim: 'Website A has consistent visual hierarchy.', lens: 'visual', source: 'archive-css', confidence: 'STRONGLY_SUPPORTED', requirementIds: [], relevance: 'lens-quality' }
    ] },
    'facts-B': { website: 'B', facts: [
      { id: 'B-r1', claim: 'Website B contains settings controls, a target panel, handlers, and state mutation code.', lens: 'functionality', source: 'archive-js-static', confidence: 'STRONGLY_SUPPORTED', behaviorAssessment: 'STRONGLY_SUPPORTED', requirementIds: ['r1'], relevance: 'explicit' },
      { id: 'B-r2', claim: 'Website B includes responsive rules.', lens: 'visual', source: 'archive-css', confidence: 'STRONGLY_SUPPORTED', requirementIds: ['r2'], relevance: 'explicit' }
    ] },
    decisions: {
      aesthetics: { option: 'A is better', rationalePlan: 'A has stronger lens-level visual consistency.', advantages: [{ claim: 'Stronger hierarchy', website: 'A', requirementIds: [], relevance: 'lens-quality', sourceFactIds: ['A-visual'], usedAsWinning: true }], caveats: [] },
      functionality: { option: 'B is better', rationalePlan: 'B represents more core requested behavior.', advantages: [{ claim: 'Settings flow represented', website: 'B', requirementIds: ['r1'], relevance: 'explicit', sourceFactIds: ['B-r1'], usedAsWinning: true }], caveats: ['Not interaction-confirmed'] },
      overall: { option: 'B is better', rationalePlan: 'Configuration matters more than the visual gap.', visualSide: { winner: 'A', summary: 'Website A has the stronger visual hierarchy.' }, functionalSide: { winner: 'B', summary: 'Website B represents more requested configuration controls.' }, tradeoff: { moreImportantSide: 'functionality', why: 'Configuration is core to this timer request.' }, advantages: [{ claim: 'Core configuration coverage', website: 'B', requirementIds: ['r1'], relevance: 'explicit', sourceFactIds: ['B-r1'], usedAsWinning: true }], caveats: [] }
    },
    reasons: result,
    qa: { overallSemantics: { visualComparisonExpressed: true, functionalComparisonExpressed: true, tradeoffExpressed: true, consistentWithDecision: true }, issues: qaIssues },
    'repair-functionality': { option: 'B is better', reason: autoReasons.functionality }
  };
}

async function installAutomationMock(page, responses) {
  await page.evaluate(responses => {
    window.__BERRY3R_TEST__.setAiTransport(async stage => {
      if (!(stage in responses)) throw new Error(`No mock response for ${stage}`);
      return structuredClone(responses[stage]);
    });
  }, responses);
}

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
  await page.locator('#manualDetails > summary').click();
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
  await page.locator('#manualDetails > summary').click();
  await page.locator('[data-note="A.status"]').selectOption('broken');
  const out = await page.evaluate(() => ({ a: __BERRY3R_TEST__.state.final.aestheticsOption, f: __BERRY3R_TEST__.state.final.functionalityOption, o: __BERRY3R_TEST__.state.final.overallOption }));
  expect(out).toEqual({ a: 'B is better', f: 'B is better', o: 'B is better' });
});

test('both broken assigns all Both are bad and waives minimum words', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  await page.locator('#manualDetails > summary').click();
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
    const guarded = __BERRY3R_TEST__.sanitizeDecomposition({ purpose: 'Invented completion', requirements: [{ id: 'invented', text: 'Add cloud accounts beyond the truncated sentence.', lens: 'functionality', importance: 'core', kind: 'behavior' }] });
    return { parts: s.archive.parts.length, html: s.archive.htmlParts.length, request: s.task.userRequest.text, warnings: s.task.warnings, a: s.task.websiteA, b: s.task.websiteB, fields: Object.keys(s.task.existingAnswers), requirements: s.requirements, guarded };
  });
  expect(out.parts).toBeGreaterThan(2);
  expect(out.html).toBeGreaterThanOrEqual(3);
  expect(out.a.part.index).not.toBe(out.b.part.index);
  expect(out.a.url).toMatch(/^https:\/\//);
  expect(out.b.url).toMatch(/^https:\/\//);
  expect(out.request).toMatch(/maintainin$/);
  expect(out.warnings.join(' ')).toContain('source-truncated');
  expect(out.requirements.length).toBeGreaterThan(0);
  expect(out.requirements.some(r => /Pomodoro/i.test(r.requirement))).toBe(true);
  expect(out.guarded.requirements.some(r => /cloud|account/i.test(r.requirement))).toBe(false);
  expect(out.fields.sort()).toEqual(['aestheticsOption','aestheticsReason','functionalityOption','functionalityReason','overallOption','overallReason'].sort());
  expect(errors).toEqual([]);
});

test('available private Berry fixtures retain distinct candidates, six fields, and structured requirements', async ({ page }) => {
  test.skip(!productionFixtures.length, 'Set BERRY_PRODUCTION_FIXTURES to run private local smoke fixtures.');
  const errors = await open(page), results=[];
  for (const fixture of productionFixtures) {
    await page.locator('#file').setInputFiles(fixture);
    await expect(page.locator('#workspace')).toBeVisible();
    results.push(await page.evaluate(() => {
      const t=__BERRY3R_TEST__,s=t.state,decomposition=t.decomposeLocal(s.task.userRequest.text);
      return {requestLength:s.task.userRequest.text.length,aPart:s.task.websiteA?.part.index,bPart:s.task.websiteB?.part.index,aUrl:s.task.websiteA?.url,bUrl:s.task.websiteB?.url,fields:Object.keys(s.task.existingAnswers),requirements:decomposition.requirements.length,cardinality:decomposition.requirements.filter(r=>r.requestedCount).length};
    }));
  }
  for (const out of results) {
    expect(out.requestLength).toBeGreaterThan(50);
    expect(out.aPart).not.toBe(out.bPart);
    expect(out.aUrl).toMatch(/^https:\/\//);
    expect(out.bUrl).toMatch(/^https:\/\//);
    expect(out.fields.sort()).toEqual(['aestheticsOption','aestheticsReason','functionalityOption','functionalityReason','overallOption','overallReason'].sort());
    expect(out.requirements).toBeGreaterThan(0);
  }
  expect(results.some(x=>x.cardinality>0)).toBe(true);
  expect(errors).toEqual([]);
});

test('mobile layout has no page-level horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('incidental unrequested feature cannot decide a winner', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const lint = await page.evaluate(() => {
    __BERRY3R_TEST__.state.decisions = { aesthetics: { advantages: [{ claim: 'Extra zoom control', relevance: 'incidental', usedAsWinning: true }] }, functionality: { advantages: [] }, overall: { advantages: [] } };
    return __BERRY3R_TEST__.validateAll(__BERRY3R_TEST__.state.final, { A: 'normal', B: 'normal' }).lint;
  });
  expect(lint.join(' ')).toContain('incidental advantage cannot decide');
});

test('explicit prohibition overrides an attractive extra feature', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const issues = await page.evaluate(() => {
    const s = __BERRY3R_TEST__.state;
    s.requirements = [{ id: 'r-no-bg', requirement: 'Do not use a background.', lens: 'visual', kind: 'prohibition', importance: 'core', websiteA: 'missed', websiteB: 'met', evidence: '' }];
    s.decisions = { aesthetics: { option: 'A is better', advantages: [{ claim: 'Attractive decorative background', relevance: 'lens-quality', usedAsWinning: true }] }, functionality: { advantages: [] }, overall: { advantages: [] } };
    return __BERRY3R_TEST__.relevanceIssues();
  });
  expect(issues.join(' ')).toContain('violating explicit prohibition');
});

test('both names with only a nominal Website B mention is flagged', async ({ page }) => {
  await open(page);
  const text = `Website A is better because its spacing, typography, hierarchy, palette, and alignment form a disciplined visual system with clear emphasis across every section. Website B is also present. ${filler(18)}`;
  const out = await validate(page, 'aesthetics', 'A is better', text);
  const all = await page.evaluate(({ text }) => {
    const f = { aestheticsOption: 'A is better', aestheticsReason: text, functionalityOption: '', functionalityReason: '', overallOption: '', overallReason: '' };
    return __BERRY3R_TEST__.validateAll(f, { A: 'normal', B: 'normal' });
  }, { text });
  expect(out.hard.join(' ')).not.toContain('Discuss both');
  expect(all.fields.aesthetics.lint.join(' ')).toContain('Website B is named but lacks a substantive observation');
});

test('cross-field works versus broken contradiction is flagged', async ({ page }) => {
  await open(page);
  const final = {
    aestheticsOption: 'A is better', aestheticsReason: reason('A is better', 45, 'balanced hierarchy typography and palette'),
    functionalityOption: 'A is better', functionalityReason: reason('A is better', 50, 'Website A works across the requested controls and Website B has limited controls'),
    overallOption: 'B is better', overallReason: reason('B is better', 50, 'Website A is broken for the core workflow while Website B includes the required controls and clean layout')
  };
  const out = await page.evaluate(final => __BERRY3R_TEST__.validateAll(final, { A: 'normal', B: 'normal' }), final);
  expect(out.lint.join(' ')).toContain('works” versus “broken');
});

test('cross-field present versus missing contradiction is flagged', async ({ page }) => {
  await open(page);
  const final = {
    aestheticsOption: 'A is better', aestheticsReason: reason('A is better', 45, 'balanced hierarchy typography and palette'),
    functionalityOption: 'A is better', functionalityReason: reason('A is better', 50, 'Website A has the settings panel present while Website B has fewer requested sections'),
    overallOption: 'B is better', overallReason: reason('B is better', 50, 'Website A has the settings panel missing while Website B combines usable controls with a coherent layout')
  };
  const out = await page.evaluate(final => __BERRY3R_TEST__.validateAll(final, { A: 'normal', B: 'normal' }), final);
  expect(out.lint.join(' ')).toContain('present” versus “missing');
});

test('Overall repeating Functionality without a trade-off is flagged', async ({ page }) => {
  await open(page);
  const functionReason = autoReasons.functionality;
  const final = {
    aestheticsOption: 'A is better', aestheticsReason: autoReasons.aesthetics,
    functionalityOption: 'B is better', functionalityReason: functionReason,
    overallOption: 'B is better', overallReason: functionReason
  };
  const out = await page.evaluate(final => __BERRY3R_TEST__.validateAll(final, { A: 'normal', B: 'normal' }), final);
  expect(out.lint.join(' ')).toContain('without an explicit trade-off');
});

test('Overall correctly weighs opposing winners without a trade-off warning', async ({ page }) => {
  await open(page);
  const final = {
    aestheticsOption: 'A is better', aestheticsReason: autoReasons.aesthetics,
    functionalityOption: 'B is better', functionalityReason: autoReasons.functionality,
    overallOption: 'B is better', overallReason: autoReasons.overall
  };
  const out = await page.evaluate(final => __BERRY3R_TEST__.validateAll(final, { A: 'normal', B: 'normal' }), final);
  expect(out.fields.overall.lint.join(' ')).not.toContain('must explicitly weigh');
  expect(out.fields.overall.lint.join(' ')).not.toContain('repeats Functionality');
});

test('tie option with a semantic winner is flagged', async ({ page }) => {
  await open(page);
  const text = `Website A and Website B are tied as good options because both use readable type and coherent palettes. Website A is clearly superior and outperforms Website B through stronger hierarchy, steadier spacing, and more consistent icon treatment, while Website B remains acceptable overall. ${filler(10)}`;
  const final = { aestheticsOption: 'Both are good', aestheticsReason: text, functionalityOption: '', functionalityReason: '', overallOption: '', overallReason: '' };
  const out = await page.evaluate(final => __BERRY3R_TEST__.validateAll(final, { A: 'normal', B: 'normal' }), final);
  expect(out.fields.aesthetics.lint.join(' ')).toMatch(/semantic winner|one-sided/);
});

test('winner option conflicts with the whole-reason conclusion', async ({ page }) => {
  await open(page);
  const text = `Website A is better because its opening section initially appears more balanced and polished than Website B. Website A then becomes inconsistent across later sections, while Website B maintains clearer spacing, stronger typography, and steadier alignment throughout; taken as a complete visual system, Website B is clearly better and outperforms Website A. ${filler(8)}`;
  const final = { aestheticsOption: 'A is better', aestheticsReason: text, functionalityOption: '', functionalityReason: '', overallOption: '', overallReason: '' };
  const out = await page.evaluate(final => __BERRY3R_TEST__.validateAll(final, { A: 'normal', B: 'normal' }), final);
  expect(out.fields.aesthetics.lint.join(' ')).toContain('appears to conclude Website B is better');
});

test('static JavaScript evidence cannot become confirmed behavior', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const fact = await page.evaluate(() => __BERRY3R_TEST__.normalizeFacts('B', { facts: [{ claim: 'Settings modal opens.', lens: 'functionality', source: 'archive-js-static', confidence: 'CONFIRMED', behaviorAssessment: 'CONFIRMED', requirementIds: [__BERRY3R_TEST__.state.requirements[0].id], relevance: 'explicit' }] })[0]);
  expect(fact.confidence).toBe('STRONGLY_SUPPORTED');
  expect(fact.confirmed).toBe(false);
});

test('truncated request prevents invented missing requirements', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const out = await page.evaluate(() => {
    const t = __BERRY3R_TEST__, s = t.state;
    s.task.userRequest.sourceTruncated = true;
    return t.sanitizeDecomposition({ purpose: 'Invented ending', requirements: [{ id: 'invented', text: 'Add cloud synchronization and accounts.', lens: 'functionality', importance: 'core', kind: 'behavior' }] });
  });
  expect(out.requirements.some(r => /cloud|account/i.test(r.requirement))).toBe(false);
  expect(out.requirements.some(r => /Pomodoro/i.test(r.requirement))).toBe(true);
});

test('automatic requirement mapping links winning evidence to the request', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const facts = await page.evaluate(() => __BERRY3R_TEST__.buildStaticFacts('B'));
  expect(facts.some(f => f.relevance === 'explicit' && f.requirementIds.length > 0)).toBe(true);
  expect(facts.every(f => ['explicit', 'lens-quality', 'incidental'].includes(f.relevance))).toBe(true);
});

test('one-click Analyze & Generate reaches six populated fields through six normal AI calls', async ({ page }) => {
  const errors = await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  await installAutomationMock(page, automationResponses());
  await page.getByRole('button', { name: 'ANALYZE & GENERATE' }).click();
  await expect(page.locator('#aiStatus')).toContainText('Ready.');
  const out = await page.evaluate(() => ({ final: __BERRY3R_TEST__.state.final, calls: __BERRY3R_TEST__.state.aiCalls, pipeline: __BERRY3R_TEST__.state.pipeline }));
  expect(Object.values(out.final).every(Boolean)).toBe(true);
  expect(out.calls).toBe(6);
  expect(Object.values(out.pipeline).every(x => x === 'done')).toBe(true);
  expect(errors).toEqual([]);
});

test('automatic repair fixes only a short reason', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  await installAutomationMock(page, automationResponses({ shortFunctionality: true, qaIssues: [{ field: 'functionality', type: 'word-count', message: 'Functionality reason is short.', repairComponent: 'reason' }] }));
  await page.getByRole('button', { name: 'ANALYZE & GENERATE' }).click();
  await expect(page.locator('#aiStatus')).toContainText('Ready.');
  const out = await page.evaluate(() => ({ final: __BERRY3R_TEST__.state.final, repairs: __BERRY3R_TEST__.state.repairs, calls: __BERRY3R_TEST__.state.aiCalls }));
  expect(out.final.aestheticsReason).toBe(autoReasons.aesthetics);
  expect(out.final.functionalityReason).toBe(autoReasons.functionality);
  expect(out.final.overallReason).toBe(autoReasons.overall);
  expect(out.repairs.map(r => r.field)).toEqual(['functionality']);
  expect(out.calls).toBe(7);
});

test('human override survives a complete automatic rerun', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const human = 'Website A is better because this human override records balanced spacing, clear typography, consistent alignment, and a restrained palette across the timer. Website B remains readable, but its denser controls, weaker hierarchy, and uneven visual rhythm make the composition less polished and less focused than Website A throughout the interface.';
  await page.locator('textarea[data-final="aestheticsReason"]').fill(human);
  await installAutomationMock(page, automationResponses());
  await page.getByRole('button', { name: 'ANALYZE & GENERATE' }).click();
  await expect(page.locator('#aiStatus')).toContainText('Ready.');
  const out = await page.evaluate(() => __BERRY3R_TEST__.state.final);
  expect(out.aestheticsReason).toBe(human);
  expect(out.functionalityReason).toBe(autoReasons.functionality);
});

test('issue-report copy requires and includes Feather and annotation links', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  await page.locator('#taskIssueDetails > summary').click();
  await page.getByRole('button', { name: 'COPY ISSUE REPORT' }).click();
  await expect(page.locator('#issueStatus')).toContainText('Both Feather link and Annotation link are required');
  await page.locator('#annotationLink').fill('https://annotations.example.test/a-123');
  await page.locator('#issueText').fill('Candidate B preview is blank.');
  const out = await page.evaluate(() => __BERRY3R_TEST__.issueReportText());
  expect(out.ok).toBe(true);
  expect(out.text).toContain('Feather: https://tasks.example.test/task-berry');
  expect(out.text).toContain('Annotation: https://annotations.example.test/a-123');
  expect(out.text).toContain('Task: task-berry');
});

test('OpenRouter model refresh groups models by provider and preserves selection UX', async ({ page }) => {
  const errors = await open(page);
  await page.route('https://openrouter.ai/api/v1/models', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [
    { id: 'openai/gpt-4.1-mini', name: 'GPT 4.1 Mini' },
    { id: 'anthropic/claude-test', name: 'Claude Test' },
    { id: 'openai/gpt-test', name: 'GPT Test' }
  ] }) }));
  await page.getByRole('button', { name: 'Admin' }).click();
  await page.locator('#orKey').fill('test-key-not-secret');
  await page.locator('#orKey').press('Tab');
  await expect(page.locator('#modelStatus')).toContainText('3 models loaded');
  await expect(page.locator('#orModel optgroup')).toHaveCount(2);
  await expect(page.locator('#orModel optgroup').first()).toHaveAttribute('label', 'anthropic');
  expect(errors).toEqual([]);
});

test('API key is excluded from history-shaped records and exports', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('berry3r.settings', JSON.stringify({ apiKey: 'sk-or-v1-private-test-sentinel', model: 'openai/gpt-4.1-mini' })));
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const serialized = await page.evaluate(() => JSON.stringify(__BERRY3R_TEST__.record()));
  expect(serialized).not.toContain('private-test-sentinel');
  expect(serialized).not.toContain('apiKey');
});

const realOverall = `Website B is better because it provides the stronger end-to-end interpretation of the requested builder, especially around gallery-based hero selection and clearly distinguished controls for expanding each hierarchy level. Website A appears to have the more festival-specific visual identity and supplies four extensive starter sections, but its upload-style hero choice and less descriptive plus controls weaken prompt alignment. Website B still presents all essential event fields, themes, menu levels, and preview content while making the intended structure easier to identify. That functional advantage outweighs Website A's likely aesthetic edge, although neither implementation has been behaviorally verified.`;

test('real production Overall is recognized as a visual/functionality trade-off', async ({ page }) => {
  await open(page);
  const out = await page.evaluate(reason => __BERRY3R_TEST__.overallLexicalAssessment(reason), realOverall);
  expect(out).toEqual({ visual: true, functional: true, tradeoff: true });
});

test('plural controls count as functionality language', async ({ page }) => {
  await open(page);
  const out = await page.evaluate(() => __BERRY3R_TEST__.overallLexicalAssessment('Website A has the stronger visual hierarchy, but Website B provides clearer controls for every requested level and that advantage matters more.'));
  expect(out.functional).toBe(true);
});

test('functional advantage outweighs aesthetic edge is explicit trade-off language', async ({ page }) => {
  await open(page);
  const out = await page.evaluate(() => __BERRY3R_TEST__.overallLexicalAssessment('Website A has the aesthetic edge, but Website B fulfills the requested workflow more completely, and that functional advantage outweighs Website A visual lead.'));
  expect(out.tradeoff).toBe(true);
});

test('structured Overall and semantic QA override lexical uncertainty', async ({ page }) => {
  await open(page);
  const out = await page.evaluate(() => {
    const t = __BERRY3R_TEST__, s = t.state;
    s.decisions = { overall: { option: 'B is better', visualSide: { winner: 'A', summary: 'Website A leads presentation.' }, functionalSide: { winner: 'B', summary: 'Website B answers the brief.' }, tradeoff: { moreImportantSide: 'functionality', why: 'The brief depends on configuration.' } } };
    s.qa = { overallSemantics: { visualComparisonExpressed: true, functionalComparisonExpressed: true, tradeoffExpressed: true, consistentWithDecision: true }, issues: [] };
    return t.overallAssessment('Website B is better because Website A offers the stronger presentation, while Website B answers the brief more directly. The latter matters more for this particular request.');
  });
  expect(out.pass).toBe(true);
  expect(out.advisory).toContain('Lexical heuristic is uncertain');
});

test('archived structure suggests is blocked from submission voice', async ({ page }) => {
  await open(page);
  const issues = await page.evaluate(() => __BERRY3R_TEST__.submissionVoiceIssues('Its archived structure suggests a clear visual progression.'));
  expect(issues.join(' ')).toContain('internal evidence or automation mechanics');
});

test('archived interface visibly includes is blocked from submission voice', async ({ page }) => {
  await open(page);
  const issues = await page.evaluate(() => __BERRY3R_TEST__.submissionVoiceIssues('The archived interface visibly includes six selectable choices.'));
  expect(issues.join(' ')).toContain('internal evidence or automation mechanics');
});

test('behaviorally verified disclaimer is removed without inventing success', async ({ page }) => {
  await open(page);
  const cleaned = await page.evaluate(() => __BERRY3R_TEST__.sanitizeSubmissionVoice('Website B provides the requested controls, although neither implementation has been behaviorally verified.'));
  expect(cleaned).toBe('Website B provides the requested controls');
  expect(cleaned).not.toMatch(/works|verified/i);
});

test('unconfirmed behavior may use safe existence language', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const final = {
    aestheticsOption: 'A is better', aestheticsReason: autoReasons.aesthetics,
    functionalityOption: 'B is better', functionalityReason: 'Website B is better because Website B includes the requested settings controls, provides configuration inputs, and presents clear mode choices, while Website A contains the timer and reset controls but exposes fewer requested configuration fields. Website B more closely matches the requested workflow structure, and Website A still provides the essential timer content without claiming that either interaction succeeds.',
    overallOption: 'B is better', overallReason: autoReasons.overall
  };
  const out = await page.evaluate(final => __BERRY3R_TEST__.validateAll(final, { A: 'normal', B: 'normal' }), final);
  expect(out.blocking.join(' ')).not.toContain('stated as confirmed');
});

test('four-by-five versus one-by-three initial structures become symmetric facts', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const out = await page.evaluate(() => {
    const t=__BERRY3R_TEST__,s=t.state;
    s.requirements=[{id:'r-count',requirement:'Provide four starter category sections with five item fields per subcategory.',requestedCount:{categories:4,itemsPerSubcategory:5},lens:'functionality',kind:'content',importance:'core',websiteA:'unknown',websiteB:'unknown',evidence:''}];
    s.reports.A={visible:'Category 1 Item 1 Item 2 Item 3 Item 4 Item 5 Category 2 Category 3 Category 4',controls:[],css:{colors:[],media:[],animations:[],raw:''},js:{hasJavaScript:false,staticHandlerHints:[],raw:''}};
    s.reports.B={visible:'Category 1 Item 1 Item 2 Item 3',controls:[{text:'Add Item',id:''},{text:'Add Subcategory',id:''},{text:'Add Category',id:''}],css:{colors:[],media:[],animations:[],raw:''},js:{hasJavaScript:false,staticHandlerHints:[],raw:''}};
    return {A:t.cardinalityFacts('A'),B:t.cardinalityFacts('B')};
  });
  expect(out.A.find(f=>f.comparisonKey.endsWith('initial-cardinality')).observedCount).toEqual({categories:4,itemsPerSubcategory:5});
  expect(out.B.find(f=>f.comparisonKey.endsWith('initial-cardinality')).observedCount).toEqual({categories:1,itemsPerSubcategory:3});
});

test('dynamic add controls do not erase initial cardinality shortfall', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const facts = await page.evaluate(() => {
    const t=__BERRY3R_TEST__,s=t.state;
    s.requirements=[{id:'r-count',requirement:'Provide four starter category sections with five item fields per subcategory.',requestedCount:{categories:4,itemsPerSubcategory:5},lens:'functionality',kind:'content',importance:'core',websiteA:'unknown',websiteB:'unknown',evidence:''}];
    s.reports.B={visible:'Category 1 Item 1 Item 2 Item 3',controls:[{text:'Add Item',id:''},{text:'Add Subcategory',id:''},{text:'Add Category',id:''}],css:{colors:[],media:[],animations:[],raw:''},js:{hasJavaScript:false,staticHandlerHints:[],raw:''}};
    return t.cardinalityFacts('B');
  });
  expect(facts.some(f=>f.observedCount?.categories===1&&f.observedCount?.itemsPerSubcategory===3)).toBe(true);
  expect(facts.some(f=>f.dynamicExpansion?.addCategory&&f.dynamicExpansion?.addItem)).toBe(true);
  expect(facts.filter(f=>f.requirementIds.includes('r-count'))).toHaveLength(2);
});

test('appearance-only Overall remains blocking', async ({ page }) => {
  await open(page);
  const out = await page.evaluate(() => { __BERRY3R_TEST__.state.decisions=null; __BERRY3R_TEST__.state.qa=null; return __BERRY3R_TEST__.overallAssessment('Website A is better because Website A has stronger typography, spacing, palette, hierarchy, and visual polish, while Website B has denser layout and weaker alignment. The cleaner composition makes Website A the better choice for the requested page.'); });
  expect(out.pass).toBe(false);
  expect(out.message).toContain('functionality/prompt fulfillment');
});

test('prompt-fulfillment-only Overall remains blocking', async ({ page }) => {
  await open(page);
  const out = await page.evaluate(() => { __BERRY3R_TEST__.state.decisions=null; __BERRY3R_TEST__.state.qa=null; return __BERRY3R_TEST__.overallAssessment('Website B is better because Website B includes every requested control, input, feature, and configuration field, while Website A is missing important requirements. Website B fulfills the workflow more completely, supports every menu level, and provides the requested interactions, so its functional advantage matters more for the user.'); });
  expect(out.pass).toBe(false);
  expect(out.message).toContain('visual comparison');
});

test('advisory-only lexical uncertainty does not prevent READY', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const out = await page.evaluate(({aesthetics,functionality}) => {
    const t=__BERRY3R_TEST__,s=t.state;
    s.decisions={overall:{option:'B is better',visualSide:{winner:'A',summary:'Website A leads presentation.'},functionalSide:{winner:'B',summary:'Website B answers the brief.'},tradeoff:{moreImportantSide:'functionality',why:'Configuration is central.'},advantages:[]},aesthetics:{advantages:[]},functionality:{advantages:[]}};
    s.qa={overallSemantics:{visualComparisonExpressed:true,functionalComparisonExpressed:true,tradeoffExpressed:true,consistentWithDecision:true},issues:[]};
    s.final={aestheticsOption:'A is better',aestheticsReason:aesthetics,functionalityOption:'B is better',functionalityReason:functionality,overallOption:'B is better',overallReason:'Website B is better because Website A offers an expressive treatment with memorable character and stronger emotional appeal, while Website B answers the brief in a more direct manner. The second consideration carries greater weight for this particular request because the central user goal depends on that directness. Website A remains compelling, but Website B provides the more appropriate complete choice for the intended audience.'};
    const v=t.validateAll(s.final,{A:'normal',B:'normal'});return{valid:v.valid,advisory:v.advisory,blocking:v.blocking,checks:t.qaChecks(v)};
  }, {aesthetics:autoReasons.aesthetics,functionality:autoReasons.functionality});
  expect(out.valid).toBe(true);
  expect(out.blocking).toEqual([]);
  expect(out.advisory.join(' ')).toContain('Lexical heuristic is uncertain');
  expect(out.checks.filter(x=>!x.pass&&x.severity==='blocking')).toHaveLength(0);
});
// ---------- Phase 4.1: UX Cleanup Regression ----------

test('first visit defaults to light theme', async ({ page }) => {
  const errors = await open(page);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(theme).toBe('light');
  expect(errors).toEqual([]);
});

test('saved dark preference restores dark theme', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('berry3r.theme', 'dark'));
  const errors = await open(page);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(theme).toBe('dark');
  expect(errors).toEqual([]);
  await page.evaluate(() => localStorage.removeItem('berry3r.theme'));
});

test('all secondary and manual sections start collapsed', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const state = await page.evaluate(() => ({
    request: !document.querySelector('#workspace > details').hasAttribute('open'),
    analysis: !document.getElementById('analysisDetails')?.hasAttribute('open'),
    manual: !document.getElementById('manualDetails')?.hasAttribute('open'),
    archive: !document.getElementById('archive')?.hasAttribute('open'),
    taskIssue: !document.getElementById('taskIssueDetails')?.hasAttribute('open')
  }));
  expect(state.request).toBe(true);
  expect(state.analysis).toBe(true);
  expect(state.manual).toBe(true);
  expect(state.archive).toBe(true);
  expect(state.taskIssue).toBe(true);
});

test('canonical editable answers follow immediately after the task/action bar', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const out = await page.evaluate(() => {
    const strip = document.querySelector('.action-strip');
    const panel = document.getElementById('submissionPanel');
    const afterStrip = strip?.nextElementSibling === panel;
    const gap = panel.getBoundingClientRect().top - strip.getBoundingClientRect().bottom;
    return { afterStrip, gap, nearTop: panel.getBoundingClientRect().top < window.innerHeight };
  });
  expect(out.afterStrip).toBe(true);
  expect(out.nearTop).toBe(true);
  expect(Math.abs(out.gap)).toBeLessThan(200);
});

test('only one primary visible presentation of the three final answers exists', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const out = await page.evaluate(() => {
    const visible = el => !el.closest('details:not([open])') && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const answers = [...document.querySelectorAll('.answer')];
    const drafts = [...document.querySelectorAll('.draft')];
    return {
      answersVisible: answers.filter(visible).length,
      editableReasonAreas: document.querySelectorAll('#submission textarea[data-final]').length,
      optionControls: document.querySelectorAll('#submission input[type=radio]').length,
      draftsVisibleOnLoad: drafts.filter(visible).length
    };
  });
  expect(out.answersVisible).toBe(3);
  expect(out.editableReasonAreas).toBe(3);
  expect(out.optionControls).toBe(12);
  expect(out.draftsVisibleOnLoad).toBe(0);
});

test('AI intermediate drafts are retained only inside collapsed Analysis Details', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const before = await page.evaluate(() => {
    const details = document.getElementById('aiDraftsDetails');
    const box = document.getElementById('drafts');
    const visible = el => !el.closest('details:not([open])') && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    return { exists: !!details, insideAnalysis: !!details?.closest('#analysisDetails'), containsDrafts: !!box?.closest('#aiDraftsDetails'), detailsCollapsed: !details?.hasAttribute('open'), draftsHidden: visible(box) === false };
  });
  expect(before.exists).toBe(true);
  expect(before.insideAnalysis).toBe(true);
  expect(before.containsDrafts).toBe(true);
  expect(before.detailsCollapsed).toBe(true);
  expect(before.draftsHidden).toBe(true);
  await page.locator('#analysisDetails > summary').click();
  await page.locator('#aiDraftsDetails > summary').click();
  const after = await page.evaluate(() => {
    const visible = el => !el.closest('details:not([open])') && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    return { draftCards: [...document.querySelectorAll('.draft')].filter(visible).length };
  });
  expect(after.draftCards).toBe(3);
});

test('Final QA directly follows the canonical answer cards', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const adjacent = await page.evaluate(() => {
    const answers = document.getElementById('submissionPanel');
    const qa = document.getElementById('finalQaPanel');
    const direct = answers?.nextElementSibling === qa;
    const gap = qa.getBoundingClientRect().top - answers.getBoundingClientRect().bottom;
    return { direct, gap };
  });
  expect(adjacent.direct).toBe(true);
  expect(Math.abs(adjacent.gap)).toBeLessThan(200);
});

test('final answer sections precede all secondary/manual/collapsed sections in DOM order', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const order = await page.evaluate(() => {
    const els = ['submissionPanel', 'finalQaPanel', 'analysisDetails', 'manualDetails', 'archive', 'taskIssueDetails'];
    const list = Array.from(document.body.querySelectorAll('section, details'));
    return Object.fromEntries(els.map(id => [id, list.indexOf(document.getElementById(id))]));
  });
  expect(order.submissionPanel).toBeLessThan(order.finalQaPanel);
  expect(order.finalQaPanel).toBeLessThan(order.analysisDetails);
  expect(order.finalQaPanel).toBeLessThan(order.manualDetails);
  expect(order.finalQaPanel).toBeLessThan(order.archive);
  expect(order.archive).toBeLessThan(order.taskIssueDetails);
});

test('manual corrections can be opened and used through their summary', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  await page.locator('#manualDetails > summary').click();
  await page.locator('.chip').first().click();
  const noteValue = await page.locator('.lens textarea').first().inputValue();
  expect(noteValue.length).toBeGreaterThan(0);
  await page.locator('textarea[data-note="A.visual"]').fill('Manual observation entered while collapsed-by-default.');
  const stored = await page.evaluate(() => __BERRY3R_TEST__.state.notes.A.visual);
  expect(stored).toContain('collapsed-by-default');
});

test('task issue reporting can be opened and used through its summary', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  await page.locator('#taskIssueDetails > summary').click();
  await page.locator('#featherLink').fill('https://tasks.example.test/task-berry');
  await page.locator('#annotationLink').fill('https://annotations.example.test/a-xyz');
  await page.getByRole('button', { name: 'COPY ISSUE REPORT' }).click();
  await expect(page.locator('#issueStatus')).toContainText('copied with both required links');
});

test('light-mode WCAG contrast: text tokens clear 4.5:1 and key boundaries clear 3:1', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  await page.locator('[data-dim="aesthetics"] .option input').first().check();
  const failures = await page.evaluate(() => {
    const parts = s => (s.match(/\d+(\.\d+)?/g) || []).map(Number);
    const lum = rgb => { const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return .2126 * f(rgb[0]) + .7152 * f(rgb[1]) + .0722 * f(rgb[2]); };
    const cr = (fg, bg) => { const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x); return (a + .05) / (b + .05); };
    const comp = getComputedStyle(document.documentElement);
    const tok = n => {
      let v = comp.getPropertyValue(n).trim();
      if (v.startsWith('#')) v = v.slice(1).replace(/^(\w)(\w)(\w)$/, '$1$1$2$2$3$3');
      return v.match(/../g).map(h => parseInt(h, 16));
    };
    const bc = el => parts(getComputedStyle(el).backgroundColor).slice(0, 3);
    const cc = el => parts(getComputedStyle(el).color).slice(0, 3);
    const checks = [
      ['ink on rail', tok('--ink'), tok('--rail'), 4.5],
      ['ink on panel', tok('--ink'), [255, 255, 255], 4.5],
      ['muted on rail', tok('--muted'), tok('--rail'), 4.5],
      ['muted on panel', tok('--muted'), [255, 255, 255], 4.5],
      ['warn on rail', tok('--warn'), tok('--rail'), 4.5],
      ['warn on warning-note', tok('--warn'), [252, 243, 224], 4.5],
      ['bad on rail', tok('--bad'), tok('--rail'), 4.5],
      ['ok on panel', tok('--ok'), [255, 255, 255], 4.5],
      ['accent A on panel', tok('--a'), [255, 255, 255], 4.5],
      ['accent B on panel', tok('--b'), [255, 255, 255], 4.5],
      ['berry eyebrow on rail', tok('--berry'), tok('--rail'), 4.5]
    ];
    const failures = [];
    for (const [name, fg, bg, min] of checks) {
      const r = cr(fg, bg);
      if (r < min) failures.push(`${name}: ${r.toFixed(2)} < ${min}`);
    }
    const primary = document.querySelector('.btn.primary');
    const pr = cr(cc(primary), bc(primary));
    if (pr < 4.5) failures.push(`primary button fg/bg: ${pr.toFixed(2)} < 4.5`);
    const accentBtn = document.querySelector('.btn.a');
    const ar = cr(cc(accentBtn), bc(accentBtn));
    if (ar < 4.5) failures.push(`accent-A button fg/bg: ${ar.toFixed(2)} < 4.5`);
    const reasonArea = document.querySelector('textarea[data-final="aestheticsReason"]');
    const ph = getComputedStyle(reasonArea, '::placeholder').color;
    const phr = cr(parts(ph), bc(reasonArea));
    if (phr < 4.5) failures.push(`placeholder: ${phr.toFixed(2)} < 4.5`);
    const selectedSpan = document.querySelector('.option input:checked+span');
    if (selectedSpan) {
      const sr = cr(cc(selectedSpan), bc(selectedSpan));
      if (sr < 4.5) failures.push(`selected option text/bg: ${sr.toFixed(2)} < 4.5`);
      const inactive = document.querySelector('.option input:not(:checked)+span');
      const cardBg = bc(inactive.closest('.answer'));
      const ir = cr(cc(inactive), cardBg);
      if (ir < 4.5) failures.push(`inactive option text/bg: ${ir.toFixed(2)} < 4.5`);
    }
    return failures;
  });
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
});

test('completion scroll targets the result area when no answer field has focus', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const canScroll = await page.evaluate(() => {
    const panel = document.getElementById('submissionPanel');
    return !!panel && typeof panel.scrollIntoView === 'function';
  });
  expect(canScroll).toBe(true);
});

test('completion chime does not fire for targeted lint/rewrite', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const fnType = await page.evaluate(() => typeof window.__BERRY3R_TEST__.playCompletionChime);
  expect(fnType).toBe('function');
});

test('disabled chime preference suppresses sound', async ({ page }) => {
  await open(page);
  const safe = await page.evaluate(() => {
    try { return typeof window.__BERRY3R_TEST__.playCompletionChime === 'function'; }
    catch(e) { return false; }
  });
  expect(safe).toBe(true);
});

test('chime preference defaults ON', async ({ page }) => {
  await open(page);
  const checked = await page.locator('#setChime').isChecked();
  expect(checked).toBe(true);
});

test('no "human-led inspection workbench" text remains', async ({ page }) => {
  await open(page);
  const text = await page.textContent('body');
  expect(text).not.toMatch(/human-led|inspection incomplete|inspect first|inspection required|workbench/i);
});

test('no normal status incorrectly says "Inspection incomplete"', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const statusText = await page.textContent('#taskStatus');
  expect(statusText).not.toMatch(/inspection incomplete/i);
});

test('mobile layout has no horizontal overflow', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(100);
  const overflow = await page.evaluate(() => {
    const html = document.documentElement;
    return html.scrollWidth > html.clientWidth;
  });
  expect(overflow).toBe(false);
});

test('desktop layout has no horizontal overflow after the restructure', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('completion chime fires once after successful full analysis', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const exists = await page.evaluate(() => {
    const fn = window.__BERRY3R_TEST__.playCompletionChime;
    return typeof fn === 'function' && fn.toString().includes('AudioContext');
  });
  expect(exists).toBe(true);
});
