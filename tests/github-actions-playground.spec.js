/* Playwright spec for github-actions-playground.html
   Run: npx playwright test tests/github-actions-playground.spec.js --reporter=line
   The page is a single static file, so it is loaded over file:// exactly as it is
   used locally. Analytics calls are aborted: the collector is unreachable from
   file:// and would otherwise surface as a console error. */
const { test, expect } = require('@playwright/test');
const path = require('path');

const fileUrl = `file://${path.resolve(process.cwd(), 'github-actions-playground.html')}`;
test.use({ channel: 'chrome' });

async function open(page, hash) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  // Fulfil analytics locally instead of aborting: the collector and the tracker script
  // are unreachable from file://, and a failed request would show up as a console error.
  await page.route('**/api/analytics/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.route('**analytics-lite.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* analytics stubbed in tests */' }));
  await page.goto(fileUrl + (hash || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__GAP_TEST__));
  return errors;
}

test('loads, renders every section, and reports no errors', async ({ page }) => {
  const errors = await open(page, '#view-start');
  await expect(page.locator('h1')).toContainText('GitHub Actions is a computer');

  const views = await page.locator('main .view').count();
  expect(views).toBeGreaterThanOrEqual(20);
  await expect(page.locator('#navGroups button')).toHaveCount(views);

  const ids = await page.$$eval('main .view', els => els.map(e => e.id));
  for (const id of ids) {
    await page.evaluate(target => window.__GAP_TEST__.navigate(target), id);
    await expect(page.locator('#' + id)).toHaveClass(/active/);
  }

  await expect(page.locator('#runnerTable tbody tr')).toHaveCount(17);
  await expect(page.locator('#triggerTable tbody tr')).toHaveCount(26);
  await expect(page.locator('#recipeList article')).toHaveCount(16);
  await expect(page.locator('#expList article')).toHaveCount(15);
  await expect(page.locator('#oppList article')).toHaveCount(16);
  await expect(page.locator('#glossary dt')).toHaveCount(37);
  await expect(page.locator('#actionVersions tbody tr')).toHaveCount(14);
  await expect(page.locator('#srcTable tbody tr')).toHaveCount(27);
  await expect(page.locator('#costOut .stat')).toHaveCount(7);
  await expect(page.locator('#permChips .chip')).toHaveCount(10);
  await expect(page.locator('#treeChips .chip')).toHaveCount(2);
  await expect(page.locator('#cronPresets .chip')).toHaveCount(7);
  expect(await page.locator('.code .cpy').count()).toBeGreaterThan(15);
  expect(errors).toEqual([]);
});

test('navigation, deep links and keyboard shortcuts work', async ({ page }) => {
  const errors = await open(page, '#view-cost');
  await expect(page.locator('#view-cost')).toHaveClass(/active/);
  await expect(page.locator('#navGroups button[aria-current=page]')).toHaveText(/Costs/);

  await page.goto(fileUrl + '#view-cookbook/recipe-caching', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__GAP_TEST__));
  await expect(page.locator('#view-cookbook')).toHaveClass(/active/);
  expect(await page.locator('#recipe-caching').boundingBox()).not.toBeNull();

  const before = await page.evaluate(() => window.__GAP_TEST__.activeSection());
  await page.keyboard.press(']');
  const after = await page.evaluate(() => window.__GAP_TEST__.activeSection());
  expect(after).not.toBe(before);

  await page.keyboard.press('/');
  await expect(page.locator('#q')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#searchPanel')).not.toHaveClass(/open/);
  expect(errors).toEqual([]);
});

test('search finds topics and jumps to them', async ({ page }) => {
  const errors = await open(page);
  await page.fill('#q', 'ubuntu-slim');
  await expect(page.locator('#searchPanel')).toHaveClass(/open/);
  const results = page.locator('#resList button');
  expect(await results.count()).toBeGreaterThan(0);
  await results.first().click();
  await expect(page.locator('#searchPanel')).not.toHaveClass(/open/);
  const active = await page.evaluate(() => window.__GAP_TEST__.activeSection());
  expect(active).toBeTruthy();
  expect(await page.locator('#' + active).innerText()).toMatch(/ubuntu-slim/i);
  expect(errors).toEqual([]);
});

test('cron playground parses, explains and rejects', async ({ page }) => {
  const errors = await open(page, '#view-triggers');
  await page.fill('#cronExpr', '23 6 * * *');
  await expect(page.locator('#cronOut')).toContainText('06:23Z');
  expect(await page.locator('#cronNotes tbody tr').count()).toBeGreaterThan(5);
  await page.fill('#cronExpr', '17 6 1 * *');
  await expect(page.locator('#cronNotes')).toContainText('day-of-month 1');
  await page.fill('#cronExpr', 'not a cron');
  await expect(page.locator('#cronStatus')).toContainText('expected 5 fields');
  await page.click('#cronPresets .chip >> nth=2');
  await expect(page.locator('#cronExpr')).toHaveValue('*/15 * * * *');
  expect(errors).toEqual([]);
});

test('cost calculator and boundary explorer compute edge cases', async ({ page }) => {
  const errors = await open(page, '#view-cost');

  await page.selectOption('#cVisibility', 'public');
  await page.fill('#cMinutes', '12');
  await expect(page.locator('#costStatus')).toContainText('Nothing here bills GitHub');

  await page.selectOption('#cVisibility', 'private');
  await page.fill('#cMinutes', '0.1');
  await page.fill('#cJobs', '1');
  await page.fill('#cUsed', '0');
  await expect(page.locator('#costOut')).toContainText('1 min/job');

  await page.selectOption('#cRunner', 'linux_16');
  await expect(page.locator('#costStatus')).toContainText('Estimated');
  await expect(page.locator('#costNotes')).toContainText('cannot use included minutes');

  const options = await page.$$eval('#boundaryPick option', os => os.map(o => o.value));
  expect(options.length).toBeGreaterThan(5);
  for (const value of options) {
    await page.selectOption('#boundaryPick', value);
    await expect(page.locator('#boundaryOut')).toContainText(/free|billable/);
  }
  expect(errors).toEqual([]);
});

test('permissions calculator, recipes and decision trees are interactive', async ({ page }) => {
  const errors = await open(page, '#view-security');

  await page.click('#permChips .chip:has-text("Publish to GitHub Pages")');
  await expect(page.locator('#permOut')).toContainText('pages: write');
  await expect(page.locator('#permOut')).toContainText('id-token: write');
  await page.click('#permChips .chip:has-text("Pure compute")');
  await expect(page.locator('#permOut')).toContainText('permissions: {}');

  await page.evaluate(() => window.__GAP_TEST__.navigate('view-cookbook'));
  await page.fill('#recipeSearch', 'commit');
  expect(await page.locator('#recipeList article').count()).toBeGreaterThan(0);
  await page.fill('#recipeSearch', '');
  await page.click('#recipeFilters .chip:has-text("pipelines")');
  expect(await page.locator('#recipeList article').count()).toBeGreaterThan(0);
  await page.click('#recipeFilters .chip:has-text("all")');

  await page.evaluate(() => window.__GAP_TEST__.navigate('view-debug'));
  await expect(page.locator('#treeBox .dt-q')).toContainText('Actions tab');
  await page.click('#treeBox .dt-opt >> nth=0');
  await expect(page.locator('#treeBox')).toContainText('default branch');
  await page.click('#treeBox .dt-opt >> nth=1');
  await expect(page.locator('#treeBox .dt-answer, #treeBox .dt-q')).toBeVisible();
  expect(errors).toEqual([]);
});

test('copy buttons copy the complete snippet', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = await open(page, '#view-cookbook');
  await page.locator('#recipe-commit-data .code .cpy').first().click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('permissions:');
  expect(copied).toContain('contents: write');
  expect(copied.length).toBeGreaterThan(400);
  expect(errors).toEqual([]);
});

test('reading progress, bookmarks and experiments persist across a reload', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => window.__GAP_TEST__.navigate('view-runners'));
  await page.click('.star[data-star="view-runners"]');
  await expect(page.locator('.star[data-star="view-runners"]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#btnStars');
  await expect(page.locator('#rail .panel')).toContainText(/Runner Infrastructure/);
  await page.evaluate(() => window.__GAP_TEST__.setExperiment(1, true));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__GAP_TEST__));
  await expect(page.locator('#view-runners')).toHaveClass(/active/);
  await expect(page.locator('.star[data-star="view-runners"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#expProgress')).toContainText('1 of 15');
  expect(errors).toEqual([]);
});

test('mobile layout does not create horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await open(page, '#view-cookbook');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: '/tmp/github-actions-playground-mobile.png', fullPage: false });
  expect(errors).toEqual([]);
});

test('the only network call is the opt-in live workflow check', async ({ page }) => {
  const requests = [];
  page.on('request', r => { const u = r.url(); if (!u.startsWith('file://')) requests.push(u); });
  // Fulfil analytics locally instead of aborting: the collector and the tracker script
  // are unreachable from file://, and a failed request would show up as a console error.
  await page.route('**/api/analytics/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.route('**analytics-lite.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* analytics stubbed in tests */' }));
  await page.goto(fileUrl + '#view-explorer', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__GAP_TEST__));
  await page.waitForTimeout(400);
  expect(requests.filter(u => u.includes('api.github.com'))).toEqual([]);
  await expect(page.locator('#invList')).toContainText('overhead-data.yml');
});
