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

test('interface language supports direct Spanish links and preserves selections', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/api/analytics/**', route => route.fulfill({ status: 204, body: '' }));
  await page.goto(`${url}?lang=es#builder`, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.locator('#tab-start')).toHaveText('Inicio');
  await expect(page.locator('#builder h2')).toHaveText('Dale al chatbot una guía para enseñar.');
  await expect(page).toHaveURL(/\?lang=es#builder$/);

  await page.locator('#subject').fill('Biología');
  await page.locator('#topic').fill('fotosíntesis');
  await page.locator('#grade').selectOption('Grades 6–8');
  await page.locator('input[name="goal"][value="Study for a quiz/test"]').check({ force: true });
  await page.locator('#mode2').check({ force: true });
  await page.locator('[data-lang="en"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#tab-start')).toHaveText('Start');
  await expect(page.locator('#subject')).toHaveValue('Biología');
  await expect(page.locator('#topic')).toHaveValue('fotosíntesis');
  await expect(page.locator('#grade')).toHaveValue('Grades 6–8');
  await expect(page.locator('input[name="goal"]:checked')).toHaveValue('Study for a quiz/test');
  await expect(page.locator('#mode2')).toBeChecked();
  await expect(page).toHaveURL(/\?lang=en#builder$/);

  await page.locator('[data-lang="es"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.locator('#subject')).toHaveValue('Biología');
  await expect(page.locator('[data-lang="es"]')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('interface and tutoring languages remain independent and bilingual options shape the prompt', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/api/analytics/**', route => route.fulfill({ status: 204, body: '' }));
  await page.goto(`${url}#builder`, { waitUntil: 'domcontentloaded' });

  await page.locator('#subject').fill('Science');
  await page.locator('input[name="tutorLanguage"][value="Bilingual support"]').check({ force: true });
  await expect(page.locator('#bilingualOptions')).toBeVisible();
  await page.locator('#primaryLanguage').selectOption('English');
  await expect(page.locator('#supportLanguage')).toHaveValue('Spanish');
  await expect(page.locator('#generatedPrompt')).toContainText('Teach primarily in English. Use Spanish strategically.');
  await expect(page.locator('#generatedPrompt')).toContainText('Never treat an accent or imperfect language');

  await page.locator('[data-lang="es"]').click();
  await expect(page.locator('#generatedPrompt')).toContainText('Enseña principalmente en inglés y usa español de forma estratégica.');
  await expect(page.locator('input[name="tutorLanguage"]:checked')).toHaveValue('Bilingual support');

  await page.locator('input[name="tutorLanguage"][value="English"]').check({ force: true });
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.locator('#generatedPrompt')).toContainText('Enseña completamente en inglés');

  await page.locator('[data-lang="en"]').click();
  await page.locator('input[name="tutorLanguage"][value="Spanish"]').check({ force: true });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#generatedPrompt')).toContainText('Teach entirely in Spanish');
  expect(errors).toEqual([]);
});

test('Spanish interface has no overflow at 390px and keeps navigation query state', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/api/analytics/**', route => route.fulfill({ status: 204, body: '' }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${url}?lang=es`, { waitUntil: 'domcontentloaded' });

  for (const id of ['start', 'builder', 'modes', 'voice', 'library', 'cost', 'evidence', 'terms', 'guide']) {
    await page.evaluate(section => window.__AI_PLAYBOOK_TEST__.go(section, false), id);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page).toHaveURL(new RegExp(`\\?lang=es#${id}$`));
  }
  await page.evaluate(() => window.__AI_PLAYBOOK_TEST__.go('library', false));
  await expect(page.locator('#searchPrompts')).toHaveAttribute('placeholder', 'Buscar prompts…');
  await expect(page.locator('.prompt-card')).toHaveCount(34);
  await page.locator('#filterMode').selectOption('Bilingual');
  await expect(page.locator('.prompt-card')).toHaveCount(6);
  await expect(page.locator('.prompt-card').first()).toContainText('Explica esto en ambos idiomas');
  expect(errors).toEqual([]);
});
