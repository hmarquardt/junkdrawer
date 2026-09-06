const { test, expect } = require('@playwright/test');
const path = require('path');

test.use({ channel: 'chrome' });

const url = `file://${path.resolve(process.cwd(), 'ai-learning-playbook.html')}`;
const viewports = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

for (const viewport of viewports) {
  test(`${viewport.width}px layout has no horizontal overflow`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route('**/api/analytics/**', route => route.fulfill({ status: 204, body: '' }));
    await page.setViewportSize(viewport);
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    for (const id of ['start', 'builder', 'modes', 'voice', 'library', 'cost', 'evidence', 'terms', 'guide']) {
      await page.evaluate(section => window.__AI_PLAYBOOK_TEST__.go(section, false), id);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    }
    expect(errors).toEqual([]);
  });
}

test('builder, copy, filters, calculator and tab focus behavior work', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/api/analytics/**', route => route.fulfill({ status: 204, body: '' }));
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: "My child doesn't understand today's math lesson." }).click();
  await expect(page.locator('#builder')).toBeVisible();
  await page.locator('#topic').fill('equivalent fractions');
  await page.locator('#grade').selectOption('Grades 3–5');
  await page.locator('#mode2').check({ force: true });
  const result = page.locator('#generatedPrompt');
  await expect(result).toContainText('equivalent fractions');
  await expect(result).toContainText('Grades 3–5');
  await expect(result).toContainText('Worked examples');
  await page.locator('#copyGenerated').click();
  await expect(page.locator('#builderStatus')).toContainText('Copied');

  await page.evaluate(() => window.__AI_PLAYBOOK_TEST__.go('library', false));
  await page.locator('#searchPrompts').fill('ghostwriting');
  await expect(page.locator('.prompt-card')).toHaveCount(1);
  await expect(page.locator('.prompt-card')).toContainText('Revise without ghostwriting');

  await page.evaluate(() => window.__AI_PLAYBOOK_TEST__.go('cost', false));
  await page.locator('#tutorRate').fill('50');
  await page.locator('#sessions').fill('1');
  await page.locator('#hours').fill('1');
  await page.locator('#months').selectOption('12');
  await expect(page.locator('#humanAnnual')).toHaveText('$2,598');
  await expect(page.locator('#difference')).toHaveText('$2,358');

  const focusableInHiddenPanel = await page.evaluate(() => {
    const selector = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
    return [...document.querySelectorAll('.panel[hidden]')].some(panel =>
      [...panel.querySelectorAll(selector)].some(node => node.tabIndex >= 0 && node.getClientRects().length)
    );
  });
  expect(focusableInHiddenPanel).toBe(false);
  expect(errors).toEqual([]);
});
