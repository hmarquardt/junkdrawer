const { test, expect } = require('@playwright/test');
const path = require('path');

const PAGE_URL = `file://${path.resolve(process.cwd(), 'princeton-wildlife-road-cruises.html')}`;

test.use({ channel: 'chrome' });

test.beforeEach(async ({ page }) => {
  page.junkdrawerErrors = [];
  page.on('pageerror', error => page.junkdrawerErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('ERR_FAILED')) page.junkdrawerErrors.push(message.text());
  });
  await page.route('**/api/analytics/**', route => route.abort());
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#activeHead .detail-title')).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(page.junkdrawerErrors).toEqual([]);
});

test('renders all five route cards and the compact active field guide', async ({ page }) => {
  await expect(page.locator('#routeList .route')).toHaveCount(5);
  await expect(page.locator('#activeDetail [data-section="why"]')).toContainText('Why This Road Is Interesting');
  await expect(page.locator('#activeDetail [data-section="wildlife"]')).toContainText('Wildlife');
  await expect(page.locator('#activeDetail [data-section="seasons"]')).toContainText('Seasonal Guide');
  await expect(page.locator('#activeDetail [data-section="wildcards"]')).toContainText('Wildcards');
  await expect(page.locator('#activeDetail .tier')).not.toHaveCount(0);
});

test('route visibility toggles update the count and persist bounded UI state', async ({ page }) => {
  await expect(page.locator('#visibleCount')).toHaveText('5 of 5 visible');
  await page.locator('[data-route="dillin"] .route-toggle').uncheck();
  await expect(page.locator('#visibleCount')).toHaveText('4 of 5 visible');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('princeton-wildlife-road-cruises')));
  expect(stored.dillin).toBe(false);
  expect(stored.filters).toEqual([]);
  expect(JSON.stringify(stored)).not.toMatch(/latitude|longitude|accuracy|heading|speed/i);
});

test('show all, hide all, and fit visible still work', async ({ page }) => {
  await page.locator('#hideAll').click();
  await expect(page.locator('#visibleCount')).toHaveText('0 of 5 visible');
  await page.locator('#showAll').click();
  await expect(page.locator('#visibleCount')).toHaveText('5 of 5 visible');
  await page.locator('#fitVisible').click();
  await expect(page.locator('#visibleCount')).toHaveText('5 of 5 visible');
});

test('focus route opens the active route map popup', async ({ page }) => {
  await page.locator('#focusRoute').click();
  await expect(page.locator('.leaflet-popup-content')).toContainText('Dillin Bottoms');
  await expect(page.locator('.leaflet-popup-content')).toContainText('eagles / raptors');
  await expect(page.locator('.leaflet-popup-content')).toContainText('Best:');
});

test('wildlife filters emphasize without hiding cards', async ({ page }) => {
  const herps = page.locator('.chip', { hasText: 'Herps' });
  const postRain = page.locator('.chip', { hasText: 'Post-rain' });
  await herps.click();
  await expect(herps).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#routeList .route')).toHaveCount(5);
  await expect(page.locator('#routeList .route.match')).toHaveCount(5);
  await postRain.click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('princeton-wildlife-road-cruises')));
  expect(stored.filters.sort()).toEqual(['herps', 'postrain']);
  await herps.click();
  await postRain.click();
  await expect(page.locator('#routeList .route.match')).toHaveCount(0);
  await expect(page.locator('#routeList .route.dim')).toHaveCount(0);
});

test('localStorage restores filters, visibility, and active route only', async ({ page }) => {
  await page.locator('.chip', { hasText: 'Wetlands' }).click();
  await page.locator('[data-route="oatsville"] .route-toggle').uncheck();
  await page.locator('[data-route="bluegrass"] .details').click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#activeHead .detail-title')).toContainText('Blue Grass FWA');
  await expect(page.locator('.chip', { hasText: 'Wetlands' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#visibleCount')).toHaveText('4 of 5 visible');
  await expect(page.locator('#routeList .route.match')).toHaveCount(5);
});

test('desktop columns keep opportunities directly beneath the map', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });

  const layout = await page.evaluate(() => {
    const root = document.querySelector('.layout');
    const left = document.querySelector('.guide-left');
    const map = document.querySelector('.guide-left > .map-card').getBoundingClientRect();
    const opportunities = document.querySelector('.guide-left > .opportunities').getBoundingClientRect();
    const side = document.querySelector('#activePanel').getBoundingClientRect();
    return {
      rootChildren: root.children.length,
      leftChildren: left.children.length,
      columns: getComputedStyle(root).gridTemplateColumns,
      opportunityGap: opportunities.top - map.bottom,
      sideToRight: side.left > map.right - 2
    };
  });

  expect(layout.rootChildren).toBe(2);
  expect(layout.leftChildren).toBe(2);
  expect(layout.columns).not.toBe('none');
  expect(layout.opportunityGap).toBeGreaterThanOrEqual(12);
  expect(layout.opportunityGap).toBeLessThanOrEqual(16);
  expect(layout.sideToRight).toBe(true);

  const before = await page.locator('.opportunities').evaluate(el => el.getBoundingClientRect().top);
  await page.getByRole('button', { name: 'Expand all' }).click();
  const after = await page.locator('.opportunities').evaluate(el => el.getBoundingClientRect().top);
  expect(Math.abs(after - before)).toBeLessThan(2);
});

test('active route disclosures use sensible defaults and dynamic counts', async ({ page }) => {
  const state = await page.evaluate(() => {
    const section = name => document.querySelector(`#activeDetail details[data-section="${name}"]`)?.open ?? null;
    const wildlife = name => document.querySelector(`#activeDetail details[data-wildlife-group="${name}"]`)?.open ?? null;
    const text = selector => document.querySelector(selector)?.textContent.replace(/\s+/g, ' ').trim() || '';
    return {
      why: section('why'),
      wildlife: section('wildlife'),
      best: section('best'),
      cues: section('cues'),
      seasons: section('seasons'),
      wildcards: section('wildcards'),
      access: section('access'),
      research: section('research'),
      birds: wildlife('birds'),
      mammals: wildlife('mammals'),
      herps: wildlife('herps'),
      other: wildlife('other'),
      birdsSummary: text('[data-wildlife-group="birds"] > summary'),
      cuesSummary: text('[data-section="cues"] > summary'),
      headerText: text('#activeHead')
    };
  });

  expect(state).toMatchObject({
    why: true,
    wildlife: true,
    best: true,
    cues: false,
    seasons: false,
    wildcards: false,
    access: true,
    research: false,
    birds: true,
    mammals: false,
    herps: false,
    other: null
  });
  expect(state.birdsSummary).toMatch(/Birds · \d+/);
  expect(state.cuesSummary).toMatch(/What to Watch While Driving · \d+/);
  expect(state.headerText).toContain('Dillin Bottoms');
  await expect(page.locator('#focusRoute')).toBeVisible();
  await expect(page.locator('#prevRoute')).toBeVisible();
  await expect(page.locator('#nextRoute')).toBeVisible();
});

test('expand and collapse utilities affect only active-route details', async ({ page }) => {
  const radius = page.locator('#radiusToggle');
  const routeToggle = page.locator('[data-route="dillin"] .route-toggle');
  const radiusBefore = await radius.isChecked();
  const routeBefore = await routeToggle.isChecked();

  await page.getByRole('button', { name: 'Collapse all' }).click();
  expect(await page.locator('#activeDetail details').evaluateAll(nodes => nodes.every(node => !node.open))).toBe(true);
  expect(await radius.isChecked()).toBe(radiusBefore);
  expect(await routeToggle.isChecked()).toBe(routeBefore);

  await page.getByRole('button', { name: 'Expand all' }).click();
  expect(await page.locator('#activeDetail details').evaluateAll(nodes => nodes.every(node => node.open))).toBe(true);
  expect(await radius.isChecked()).toBe(radiusBefore);
  expect(await routeToggle.isChecked()).toBe(routeBefore);
});

test('changing the active route resets disclosures and keeps visibility independent', async ({ page }) => {
  await page.getByRole('button', { name: 'Collapse all' }).click();
  await page.locator('[data-route="bluegrass"] .details').click();

  await expect(page.locator('#activeHead .detail-title')).toContainText('Blue Grass FWA');
  expect(await page.locator('[data-section="why"]').evaluate(el => el.open)).toBe(true);
  expect(await page.locator('[data-section="wildlife"]').evaluate(el => el.open)).toBe(true);
  expect(await page.locator('[data-wildlife-group="birds"]').evaluate(el => el.open)).toBe(true);
  expect(await page.locator('[data-wildlife-group="mammals"]').evaluate(el => el.open)).toBe(false);
  expect(await page.locator('[data-section="cues"]').evaluate(el => el.open)).toBe(false);
  expect(await page.locator('[data-section="access"]').evaluate(el => el.open)).toBe(true);

  const toggle = page.locator('[data-route="bluegrass"] .route-toggle');
  await toggle.uncheck();
  await expect(page.locator('#activeHiddenNote')).toHaveText(/Hidden on map/);
  await expect(page.locator('#activeHead .detail-title')).toContainText('Blue Grass FWA');
});

test('mobile order is map, active route, opportunities without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  const positions = await page.evaluate(() => {
    const box = selector => document.querySelector(selector).getBoundingClientRect();
    return {
      map: box('.map-card').top,
      side: box('#activePanel').top,
      opportunities: box('.opportunities').top,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });

  expect(positions.map).toBeLessThan(positions.side);
  expect(positions.side).toBeLessThan(positions.opportunities);
  expect(positions.overflow).toBeLessThanOrEqual(0);
});
