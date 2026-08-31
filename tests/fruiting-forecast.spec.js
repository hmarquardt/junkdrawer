const { test, expect } = require('@playwright/test');
const path = require('path');

const url = `file://${path.resolve(process.cwd(), 'fruiting-forecast.html')}`;
test.use({ channel: 'chrome', viewport: { width: 1440, height: 900 } });

function weatherPayload(lat = 39.1653, lon = -86.5264) {
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dates = [];
  for (let i = -30; i <= 7; i++) dates.push(new Date(day.getTime() + i * 86400000).toISOString().slice(0, 10));
  const hours = [];
  for (let i = -30 * 24; i <= 7 * 24; i++) hours.push(new Date(day.getTime() + i * 3600000).toISOString().slice(0, 13) + ':00');
  return {
    latitude: lat, longitude: lon, elevation: 235, timezone: 'America/Indiana/Indianapolis',
    daily: {
      time: dates,
      precipitation_sum: dates.map((_, i) => i > 20 && i < 29 ? 0.18 : (i === 29 ? 0.65 : 0)),
      temperature_2m_max: dates.map(() => 78), temperature_2m_min: dates.map(() => 60),
      et0_fao_evapotranspiration: dates.map(() => 0.12)
    },
    hourly: {
      time: hours,
      temperature_2m: hours.map(() => 69), relative_humidity_2m: hours.map(() => 78),
      dew_point_2m: hours.map(() => 62), precipitation: hours.map(() => 0),
      soil_temperature_0cm: hours.map(() => 66), soil_moisture_0_to_1cm: hours.map(() => 0.29),
      vapour_pressure_deficit: hours.map(() => 0.65), wind_speed_10m: hours.map(() => 5)
    }
  };
}

async function setup(page, { weatherFailure = false, observationFailure = false } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED') && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
  await page.addInitScript(() => { window.__FF_TEST_FAST__ = true; });
  await page.route('**/api/analytics/**', route => route.abort());
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.route('https://api.open-meteo.com/v1/forecast**', async route => {
    if (weatherFailure) return route.fulfill({ status: 503, body: 'offline' });
    const requestUrl = new URL(route.request().url());
    const lats = requestUrl.searchParams.get('latitude').split(',').map(Number);
    const lons = requestUrl.searchParams.get('longitude').split(',').map(Number);
    const body = lats.map((lat, i) => weatherPayload(lat, lons[i]));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body.length === 1 ? body[0] : body) });
  });
  await page.route('https://api.inaturalist.org/v1/observations**', route => observationFailure
    ? route.fulfill({ status: 503, body: '{}' })
    : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total_results: 6, results: [{ observed_on: new Date().toISOString().slice(0, 10) }] }) }));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__FRUITING_FORECAST_TEST__);
  return errors;
}

async function runAnalysis(page) {
  await page.locator('#locationInput').fill('39.1653, -86.5264');
  await page.getByRole('button', { name: 'Run field analysis' }).click();
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('#status')).toContainText('Analysis ready');
}

test('first load, weather retrieval, ranking, explanation, and map interaction', async ({ page }) => {
  const errors = await setup(page);
  await expect(page.locator('#emptyState')).toBeVisible();
  await runAnalysis(page);
  await expect(page.locator('.rank-card')).toHaveCount(7);
  await expect(page.locator('#topBet')).toContainText('/ 100');
  await expect(page.locator('#detailPlaceholder')).toBeHidden();
  await page.locator('[data-explain]').first().click();
  await expect(page.locator('#explainDialog')).toBeVisible();
  await expect(page.locator('#explainContent')).toContainText('Missing inputs are omitted');
  await page.locator('[data-close="explainDialog"]').click();
  await page.evaluate(() => {
    const state = window.__FRUITING_FORECAST_TEST__.getState();
    if (state.layers.length) state.layers[state.layers.length - 1].fire('click');
    else document.querySelector('.map-zone-fallback:last-child').click();
  });
  await expect(page.locator('#detailContent')).toContainText('Weather evidence');
  expect(errors).toEqual([]);
});

test('saved preferences, radius change, IndexedDB analysis persistence, and cache refresh', async ({ page }) => {
  const errors = await setup(page);
  await page.locator('#radiusSelect').selectOption('50');
  await runAnalysis(page);
  expect(await page.evaluate(() => window.__FRUITING_FORECAST_TEST__.getState().analysis.radius)).toBe(50);
  expect(await page.evaluate(() => window.__FRUITING_FORECAST_TEST__.dbAll('analyses').then(x => x.length))).toBe(1);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__FRUITING_FORECAST_TEST__);
  await expect(page.locator('#radiusSelect')).toHaveValue('50');
  await expect(page.locator('#locationInput')).toHaveValue('39.1653, -86.5264');
  expect(errors).toEqual([]);
});

test('weather API failure leaves a strong error state', async ({ page }) => {
  const errors = await setup(page, { weatherFailure: true });
  await page.locator('#locationInput').fill('39.1653, -86.5264');
  await page.getByRole('button', { name: 'Run field analysis' }).click();
  await expect(page.locator('#status')).toContainText('Weather service failed');
  await expect(page.locator('#emptyState')).toBeVisible();
  expect(errors).toEqual([]);
});

test('observation failure produces partial-data scoring and lower confidence', async ({ page }) => {
  const errors = await setup(page, { observationFailure: true });
  await runAnalysis(page);
  await expect(page.locator('#detailContent')).toContainText('Observation evidence unavailable');
  await expect(page.locator('#detailContent')).toContainText('Confidence');
  expect(errors).toEqual([]);
});

test('seasonality gate, score trace arithmetic, and zone generation are deterministic', async ({ page }) => {
  const errors = await setup(page);
  const result = await page.evaluate(() => {
    const t = window.__FRUITING_FORECAST_TEST__;
    const species = t.SPECIES.find(x => x.id === 'morel');
    return {
      january: t.monthScore(species, 1), april: t.monthScore(species, 4),
      quick: t.zonePoints(39, -86, 25, 'quick').length,
      standard: t.zonePoints(39, -86, 25, 'standard').length,
      deep: t.zonePoints(39, -86, 25, 'deep').length
    };
  });
  expect(result).toEqual({ january: 0, april: 100, quick: 1, standard: 5, deep: 9 });
  expect(errors).toEqual([]);
});

test('mobile stacks cleanly and desktop detail panel remains independently scrollable', async ({ page }) => {
  const errors = await setup(page);
  await runAnalysis(page);
  const desktop = await page.locator('#detailPanel').evaluate(el => ({ position: getComputedStyle(el).position, overflow: getComputedStyle(el).overflowY, client: el.clientHeight, scroll: el.scrollHeight }));
  expect(desktop.position).toBe('sticky');
  expect(desktop.overflow).toBe('auto');
  expect(desktop.scroll).toBeGreaterThanOrEqual(desktop.client);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.locator('.workspace').evaluate(el => getComputedStyle(el).display);
  expect(mobile).toBe('block');
  await expect(page.locator('#detailPanel')).toBeVisible();
  expect(errors).toEqual([]);
});

test('hunt record persists separately from caches', async ({ page }) => {
  const errors = await setup(page);
  await page.getByRole('button', { name: 'Log a hunt' }).click();
  await page.locator('#huntNotes').fill('Test field record');
  await page.getByRole('button', { name: 'Save field record' }).click();
  await expect(page.locator('#status')).toContainText('Hunt saved locally');
  expect(await page.evaluate(() => window.__FRUITING_FORECAST_TEST__.dbAll('hunts').then(x => x.length))).toBe(1);
  expect(errors).toEqual([]);
});
