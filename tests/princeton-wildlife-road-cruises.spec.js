const { test, expect } = require('@playwright/test');
const path = require('path');

const PAGE_URL = () => `file://${path.resolve(process.cwd(), 'princeton-wildlife-road-cruises.html')}`;

test.use({ channel: 'chrome' });

test.beforeEach(async ({ page }) => {
  // Fresh context per test: block analytics, isolate storage
  await page.route('**/api/analytics/**', r => r.abort());
  await page.goto(PAGE_URL(), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
});

test('loads with no console or page errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('renders five route cards with field-guide sections', async ({ page }) => {
  await expect(page.locator('.route')).toHaveCount(5);
  await expect(page.locator('#routeList .route').first().locator('text=Why this road is interesting')).toBeVisible();
  await expect(page.locator('#routeList .route').first().locator('text=What you might see')).toBeVisible();
  await expect(page.locator('#routeList .route').first().locator('text=Why go today')).toBeVisible();
  await expect(page.locator('#routeList .route').first().locator('text=Wildcards')).toBeVisible();
  await expect(page.locator('.tier')).not.toHaveCount(0);
});

test('route visibility toggles update count and persist', async ({ page }) => {
  await expect(page.locator('#visibleCount')).toHaveText('5 of 5 visible');
  const firstToggle = page.locator('.route').first().locator('.route-toggle');
  await firstToggle.uncheck();
  await expect(page.locator('#visibleCount')).toHaveText('4 of 5 visible');
  await page.waitForTimeout(200);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('princeton-wildlife-road-cruises')));
  expect(stored.dillin).toBe(false);
  expect(stored.filters).toEqual([]);
});

test('show all / hide all / fit visible still work', async ({ page }) => {
  await page.click('#hideAll');
  await expect(page.locator('#visibleCount')).toHaveText('0 of 5 visible');
  await page.click('#showAll');
  await expect(page.locator('#visibleCount')).toHaveText('5 of 5 visible');
  await page.click('#fitVisible');
  await expect(page.locator('#visibleCount')).toHaveText('5 of 5 visible');
});

test('focus button opens map popup', async ({ page }) => {
  await page.locator('.route').first().locator('.focus').click();
  await expect(page.locator('.leaflet-popup-content')).toContainText('Dillin Bottoms');
  await expect(page.locator('.leaflet-popup-content')).toContainText('eagles / raptors');
  await expect(page.locator('.leaflet-popup-content')).toContainText('Best:');
});

test('wildlife filters emphasize and dim without hiding routes', async ({ page }) => {
  const herpsChip = page.locator('.chip', { hasText: 'Herps' });
  await herpsChip.click();
  await expect(herpsChip).toHaveAttribute('aria-pressed', 'true');
  // nothing hidden
  await expect(page.locator('.route')).toHaveCount(5);
  await expect(page.locator('.route')).not.toHaveCount(0);
  // dillin and sugar6 have herps tag; bluegrass too; oatsville too; snakey too (all have herps)
  await expect(page.locator('.route.match')).toHaveCount(5);
  const birdsChip = page.locator('.chip', { hasText: 'Post-rain' });
  await birdsChip.click();
  // filters combine via OR; all routes have postrain
  await expect(page.locator('.route.match')).toHaveCount(5);
  // persist
  await page.waitForTimeout(200);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('princeton-wildlife-road-cruises')));
  expect(stored.filters.sort()).toEqual(['herps', 'postrain'].sort());
  // clear filters restores neutral state
  await herpsChip.click();
  await birdsChip.click();
  await expect(page.locator('.route.match')).toHaveCount(0);
  await expect(page.locator('.route.dim')).toHaveCount(0);
});

test('localStorage persistence restores filters and visibility on reload', async ({ page }) => {
  await page.locator('.chip', { hasText: 'Wetlands' }).click();
  await page.locator('.route').nth(2).locator('.route-toggle').uncheck();
  await page.waitForTimeout(200);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.chip', { hasText: 'Wetlands' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#visibleCount')).toHaveText('4 of 5 visible');
  await expect(page.locator('.route.match')).toHaveCount(5);
});
