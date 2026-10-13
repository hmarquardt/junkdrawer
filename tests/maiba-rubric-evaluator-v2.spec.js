const { test, expect } = require('@playwright/test');
const path = require('path');

test.use({ channel: 'chrome' });
const url = `file://${path.resolve(process.cwd(), 'maiba_rubric_evaluator_v2.html')}`;
const reasoning2 = 'Comment: Q2 reasoning with a direct quote: "helpful".\n\nWent wrong: Detail.\n\nDid well: Evidence.';
const reasoning4 = 'Comment: Q4 reasoning stays intact.\n\nWent wrong: Specific issue.\n\nDid well: Clear answer.';

async function openPage(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    localStorage.setItem('maiba.openrouter.apiKey', 'test-key');
    localStorage.setItem('maiba.rubric.active', 'Test rubric');
    localStorage.setItem('maiba.model.processing', 'test/processor');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async text => { window.__copied = text; } }
    });
  });
  await page.route('**/api/analytics/**', route => route.abort());
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      q1: 'Good', q2: reasoning2, q3: 'Good', q4: reasoning4,
      q5: 'None', q6: 'Comment: No response quality dimensions need improvement.\n\nDimensions to improve: None',
      q7: 'Yes', q8: 'A single conversation'
    }) } }], usage: {} })
  }));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return errors;
}

for (const model of ['Maiba', 'ChatGPT']) {
  test(`${model} Q2/Q4 generation, individual copy, full copy, and history export`, async ({ page }) => {
    const errors = await openPage(page);
    await page.locator('#conversationInput').fill('User: Question\nAssistant: Answer');
    await page.locator('#evaluatedModel').selectOption(model);
    await page.locator('#btnEvaluate').click();
    await expect(page.locator('#evaluationOutput [data-section="Q4"] pre')).toContainText(`Model: ${model}`);
    for (const [field, reasoning] of [['Q2', reasoning2], ['Q4', reasoning4]]) {
      const section = page.locator(`#evaluationOutput [data-section="${field}"]`);
      await expect(section.locator('pre')).toHaveText(`Model: ${model}\n\n${reasoning}`);
      await section.locator('.copy-btn').click();
      expect(await page.evaluate(() => window.__copied)).toBe(`Model: ${model}\n\n${reasoning}`);
    }
    await page.locator('#btnCopyOutput').click();
    const copied = await page.evaluate(() => window.__copied);
    expect(copied).toContain(`Q2. Please explain your selection in Q1.\nModel: ${model}\n\n${reasoning2}`);
    expect(copied).toContain(`Q4. Please explain your selection in Q3.\nModel: ${model}\n\n${reasoning4}`);
    await page.getByRole('tab', { name: 'Admin' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#btnExportHistory').click();
    const download = await downloadPromise;
    const fs = require('fs');
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(exported[0].renderedQ1ToQ8Output).toContain(`Model: ${model}\n\n${reasoning2}`);
    expect(errors).toEqual([]);
  });
}

test('prefixes normalize, repeat idempotently, and preserve reasoning', async ({ page }) => {
  const errors = await openPage(page);
  const result = await page.evaluate(({ reasoning2, reasoning4 }) => {
    const source = renderQ1ToQ8({ q1: 'Good', q2: `Model: MAIBA\n\nModel: ChatGPT\n\n${reasoning2}`,
      q3: 'Good', q4: `model: chatgpt\n\n${reasoning4}`, q5: 'None', q6: 'Other', q7: 'Yes', q8: 'One' });
    const once = formatEvaluationOutput(source, 'Maiba');
    return { once, twice: formatEvaluationOutput(once, 'Maiba') };
  }, { reasoning2, reasoning4 });
  expect(result.twice).toBe(result.once);
  expect(result.once).toContain(`Q2. Please explain your selection in Q1.\nModel: Maiba\n\n${reasoning2}`);
  expect(result.once).toContain(`Q4. Please explain your selection in Q3.\nModel: Maiba\n\n${reasoning4}`);
  expect((result.once.match(/Model:/g) || []).length).toBe(2);
  expect(errors).toEqual([]);
});

test('missing identity blocks evaluation and legacy copy/export until resolved', async ({ page }) => {
  const errors = await openPage(page);
  await page.locator('#conversationInput').fill('User: Question\nAssistant: Answer');
  await page.locator('#btnEvaluate').click();
  await expect(page.locator('#evaluationMeta')).toContainText('Select the model being evaluated');
  await page.evaluate(async () => {
    await dbSave({ id: 'legacy', createdAt: new Date().toISOString(),
      renderedQ1ToQ8Output: renderQ1ToQ8({ q1: 'Good', q2: 'Model: MAIBA\n\nLegacy Q2',
        q3: 'Good', q4: 'Model: Maiba\n\nLegacy Q4' }) });
  });
  await page.getByRole('tab', { name: 'History' }).click();
  page.on('dialog', d => d.accept());
  await page.locator('#historyTable [data-action="copy"]').click();
  expect(await page.evaluate(() => window.__copied)).toBeUndefined();
  await page.getByRole('tab', { name: 'Admin' }).click();
  await page.locator('#btnExportHistory').click();
  await page.getByRole('tab', { name: 'History' }).click();
  await page.locator('#detailEvaluatedModel').selectOption('ChatGPT');
  await page.locator('#btnDetailSaveModel').click();
  await expect(page.locator('#detailOutput [data-section="Q2"] pre')).toContainText('Model: ChatGPT');
  await page.locator('#btnDetailCopy').click();
  await expect.poll(() => page.evaluate(() => window.__copied)).toContain('Q2. Please explain your selection in Q1.\nModel: ChatGPT\n\nLegacy Q2');
  expect(await page.evaluate(() => window.__copied)).toContain('Q4. Please explain your selection in Q3.\nModel: ChatGPT\n\nLegacy Q4');
  expect(errors).toEqual([]);
});

test('reviewer corrections normalize Q2/Q4 before proposed copy and after applying', async ({ page }) => {
  const errors = await openPage(page);
  await page.locator('#conversationInput').fill('User: Question\nAssistant: Answer');
  await page.locator('#evaluatedModel').selectOption('Maiba');
  await page.locator('#btnEvaluate').click();
  await expect(page.locator('#evaluationOutput [data-section="Q4"] pre')).toContainText('Model: Maiba');
  await page.evaluate(() => {
    localStorage.setItem('maiba.model.review', 'test/reviewer');
  });
  await page.unroute('https://openrouter.ai/api/v1/chat/completions');
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      comparison: 'Clarified reasoning.',
      corrected_q1_to_q8: `Q1. How do you evaluate the AI's first response in this conversation?\nGood\n\nQ2. Please explain your selection in Q1.\nModel: ChatGPT\n\nRevised Q2 reasoning.\n\nQ3. How do you evaluate the AI's responses across the full conversation?\nGood\n\nQ4. Please explain your selection in Q3.\nmodel: maiba\n\nRevised Q4 reasoning.\n\nQ5. Across the full conversation, which of the following response quality dimensions need to be improved?\nNone\n\nQ6. If you selected any of the response quality dimensions in Q5, please explain your reasoning for your choices.\nOther\n\nQ7. Based on your overall review of this conversation, does the AI appear to have met the user's goal(s)?\nYes\n\nQ8. In your opinion, does this chat feel like a single conversation or multiple conversations?\nOne`
    }) } }], usage: {} })
  }));
  await page.locator('#btnVerify').click();
  await expect(page.locator('#verificationDiff [data-section="Q2"] pre')).toHaveText('Model: Maiba\n\nRevised Q2 reasoning.');
  await page.locator('#verificationDiff [data-section="Q4"] .copy-btn').click();
  await expect.poll(() => page.evaluate(() => window.__copied)).toBe('Model: Maiba\n\nRevised Q4 reasoning.');
  await page.locator('#btnApplyFixes').click();
  await page.locator('#btnCopyOutput').click();
  await expect.poll(() => page.evaluate(() => window.__copied)).toContain('Q4. Please explain your selection in Q3.\nModel: Maiba\n\nRevised Q4 reasoning.');
  expect(errors).toEqual([]);
});
