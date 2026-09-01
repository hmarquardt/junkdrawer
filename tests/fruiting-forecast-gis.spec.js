const { test, expect } = require('@playwright/test');
const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

// Static JS syntax check: fail fast if the main app IIFE doesn't parse
test('main application JavaScript has no syntax errors', () => {
  const html = fs.readFileSync(path.resolve(process.cwd(), 'fruiting-forecast.html'), 'utf-8');
  // Find the main app script block by looking for the test API marker
  const marker = '__FRUITING_FORECAST_TEST__';
  const scriptStart = html.lastIndexOf('<script>', html.indexOf(marker));
  const scriptEnd = html.indexOf('</script>', scriptStart);
  const mainJs = html.slice(scriptStart + '<script>'.length, scriptEnd);
  expect(mainJs.length).toBeGreaterThan(10000);
  execSync('node --check /dev/stdin', { input: mainJs, timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
});

test('page loads without syntax errors and app initializes', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
  await page.route('**/api/analytics/**', r => r.abort());
  await page.route('https://tile.openstreetmap.org/**', r => r.abort());
  await page.goto(`http://127.0.0.1:8791/fruiting-forecast.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__FRUITING_FORECAST_TEST__);
  const hasTestApi = await page.evaluate(() => !!window.__FRUITING_FORECAST_TEST__);
  expect(hasTestApi).toBe(true);
  expect(errors).toEqual([]);
});

const port = 8791;
const httpUrl = `http://127.0.0.1:${port}/fruiting-forecast.html`;
const fileUrl = `file://${path.resolve(process.cwd(), 'fruiting-forecast.html')}`;
let server;

test.use({ channel: process.env.FF_LIVE_GIS === '1' ? undefined : 'chrome', viewport: { width: 1280, height: 850 } });
test.beforeAll(async () => {
  server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: process.cwd(), stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { await new Promise((resolve, reject) => http.get(httpUrl, r => { r.resume(); resolve(); }).on('error', reject)); return; }
    catch { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error('Static test server did not start');
});
test.afterAll(() => { if (server) server.kill(); });

async function open(page, url = fileUrl) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
  await page.route('**/api/analytics/**', r => r.abort());
  await page.route('https://tile.openstreetmap.org/**', r => r.abort());
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__FRUITING_FORECAST_TEST__);
  return errors;
}

test('basic file mode works without DuckDB or GIS files', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('#emptyState')).toBeVisible();
  expect(await page.evaluate(() => window.__FRUITING_FORECAST_TEST__.gisManifest(false).then(() => 'unexpected', e => e.message))).toContain('requires HTTP hosting');
  expect(errors).toEqual([]);
});

test('tile selection intersects radius deterministically and rejects distant tiles', async ({ page }) => {
  const errors = await open(page);
  const ids = await page.evaluate(() => {
    const t = window.__FRUITING_FORECAST_TEST__;
    const m = { tiles: [
      { id: 'near', bbox: [-88, 38, -87, 39] },
      { id: 'far', bbox: [-82, 42, -81, 43] },
      { id: 'bad', bbox: ['x', 0, 1, 2] }
    ] };
    return t.selectGisTiles(m, 38.35, -87.57, 50).map(x => x.id);
  });
  expect(ids).toEqual(['near']);
  expect(errors).toEqual([]);
});

test('spatial cell aggregation retains provenance and missing fields stay missing', async ({ page }) => {
  const errors = await open(page);
  const result = await page.evaluate(() => {
    const t = window.__FRUITING_FORECAST_TEST__;
    const rows = [
      { lat: 38.35, lon: -87.57, forest: 1, deciduous: 1, open_land: 0, canopy: .8, oak_hickory_signal: 1, beech_maple_signal: 0, elm_ash_cottonwood_signal: 0, land_class: 'deciduous', forest_group: 'oak_hickory', elevation_ft: 450, access_class: 'public', property_name: 'Example Forest' },
      { lat: 38.36, lon: -87.56, forest: 0, deciduous: 0, open_land: 1, canopy: 0, oak_hickory_signal: 0, beech_maple_signal: 0, elm_ash_cottonwood_signal: 0, land_class: 'crops', elevation_ft: 430, access_class: 'likely_private' }
    ];
    return t.aggregateHabitat(rows, { id: 'center', lat: 38.35, lon: -87.57 }, 25, { sources: [{ id: 'nlcd' }] });
  });
  expect(result.sampleCells).toBe(2);
  expect(result.forest.cover).toBe(.5);
  expect(result.soil.awc25).toBeNull();
  expect(result.sources[0].id).toBe('nlcd');
  expect(errors).toEqual([]);
});

test('habitat is species-specific and access cannot alter biological score', async ({ page }) => {
  const errors = await open(page);
  const result = await page.evaluate(() => {
    const t = window.__FRUITING_FORECAST_TEST__;
    const metrics = { rain10: 1.5, rain14: 1.8, rain7: 1, daysSinceRain: 6, soilMoisture: .29, soilTemp: 66, airTemp: 70, et07: .7, vpd: .6, wind: 4, freeze: false, heat: 79 };
    const habitat = { available: true, forest: { cover: .9, deciduous: .82, open: .08, canopy: .74 }, hosts: { oakHickory: .9, beechMaple: .1, elmAshCottonwood: 0 }, soil: { wellDrainedPct: .8, awc25: 7 }, terrain: { slopeMedianDeg: 5 }, access: { publicPct: 0, restrictedPct: 0 }, confidence: { cellCoverage: 1, hostQuality: .65, soilCoverage: 1 } };
    const zone = { point: { searchRadius: 25 }, metrics, habitat };
    const chanterelle = t.scoreSpecies(t.SPECIES.find(x => x.id === 'chanterelle'), zone, null, new Date('2026-07-15'));
    const puffball = t.scoreSpecies(t.SPECIES.find(x => x.id === 'puffball'), zone, null, new Date('2026-08-15'));
    const before = chanterelle.score;
    habitat.access.publicPct = 1;
    const after = t.scoreSpecies(t.SPECIES.find(x => x.id === 'chanterelle'), zone, null, new Date('2026-07-15'));
    return { chanterelle: chanterelle.components.habitat, puffball: puffball.components.habitat, before, after: after.score, utility: after.accessUtility };
  });
  expect(result.chanterelle).toBeGreaterThan(result.puffball);
  expect(result.after).toBe(result.before);
  expect(result.utility).toBe(100);
  expect(errors).toEqual([]);
});

test('DuckDB-Wasm loads Spatial and queries real local Parquet tiles', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await open(page, httpUrl);
  const result = await page.evaluate(async () => {
    const t = window.__FRUITING_FORECAST_TEST__;
    const manifest = await t.gisManifest(true);
    const points = t.zonePoints(38.3553, -87.5675, 25, 'standard');
    const evidence = await t.HabitatProvider.fetch(points, { lat: 38.3553, lon: -87.5675 }, 25, new AbortController().signal, false);
    const state = t.getState();
    const cachedTiles = (await t.dbAll('cache')).filter(row => row.key && (row.key.startsWith('gis-tile:') || row.key.startsWith('gis-asset:')));
    return { manifest: manifest.datasetVersion, tiles: state.gis.tiles.length, cachedTiles: cachedTiles.length, spatial: state.gis.spatial, cells: evidence.center && evidence.center.sampleCells, forest: evidence.center && evidence.center.forest.cover };
  });
  expect(result.tiles).toBeGreaterThan(0);
  expect(result.cachedTiles).toBeGreaterThanOrEqual(result.tiles);
  expect(result.spatial).toBe(true);
  expect(result.cells).toBeGreaterThan(1);
  expect(result.forest).toBeGreaterThanOrEqual(0);
  expect(result.forest).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('DuckDB worker/module failure degrades without a fatal page failure', async ({ page }) => {
  const errors = await open(page, httpUrl);
  await page.route('https://cdn.jsdelivr.net/npm/@duckdb/**', route => route.abort());
  const result = await page.evaluate(() => window.__FRUITING_FORECAST_TEST__.initDuckDB().then(() => 'unexpected', error => ({ message: error.message, status: window.__FRUITING_FORECAST_TEST__.getState().gis.status })));
  expect(result.status).toBe('degraded');
  expect(result.message).toBeTruthy();
  await expect(page.locator('#emptyState')).toBeVisible();
  expect(errors.filter(message => !message.includes('ERR_FAILED'))).toEqual([]);
});

test('score explanation expands deterministic habitat subcomponents and separates access', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => {
    const t = window.__FRUITING_FORECAST_TEST__, state = t.getState();
    const habitat = { available: true, sampleCells: 20, forest: { cover: .8, deciduous: .75, open: .12, canopy: .7 }, hosts: { oakHickory: .82, beechMaple: .12, elmAshCottonwood: .04 }, soil: { wellDrainedPct: .8, awc25: 7 }, terrain: { slopeMedianDeg: 5 }, access: { publicPct: .4, restrictedPct: 0 }, confidence: { cellCoverage: 1, hostQuality: .65, soilCoverage: 1 }, sources: [{ id: 'nlcd' }] };
    const zone = { point: { id: 'center', searchRadius: 25 }, metrics: { rain10: 1.5, rain14: 1.6, daysSinceRain: 6, soilMoisture: .29, soilTemp: 66, airTemp: 70, et07: .7, vpd: .6, wind: 4, freeze: false, heat: 79 }, habitat };
    const score = t.scoreSpecies(t.SPECIES.find(row => row.id === 'chanterelle'), zone, null, new Date('2026-07-15'));
    state.analysis = { zones: [{ id: 'center', scores: [score] }] };
    state.selectedZone = 'center';
    state.selectedSpecies = 'chanterelle';
    t.showExplain('chanterelle');
  });
  await expect(page.locator('#explainContent')).toContainText('Habitat trace');
  await expect(page.locator('#explainContent')).toContainText('Host-tree-group fit');
  await expect(page.locator('#explainContent')).toContainText('contributes nothing to biological opportunity');
  expect(errors).toEqual([]);
});

test('malformed GIS manifest is rejected without damaging the page', async ({ page }) => {
  const errors = await open(page, httpUrl);
  await page.route('**/data/fruiting-forecast/manifest.json**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"tiles":"bad"}' }));
  const message = await page.evaluate(() => window.__FRUITING_FORECAST_TEST__.gisManifest(true).then(() => 'unexpected', e => e.message));
  expect(message).toContain('malformed');
  await expect(page.locator('#emptyState')).toBeVisible();
  expect(errors).toEqual([]);
});

test('OpenRouter evidence includes GIS but intelligence attachment cannot mutate it', async ({ page }) => {
  const errors = await open(page);
  const result = await page.evaluate(async () => {
    const t = window.__FRUITING_FORECAST_TEST__, s = t.getState();
    s.analysis = { id: 'gis-a', generatedAt: new Date().toISOString(), version: 'FF-test', location: { label: 'Princeton', lat: 38.35, lon: -87.57 }, radius: 25, depth: 'standard', gis: { status: 'enhanced' }, ranked: [], zones: [], observations: {} };
    const before = JSON.stringify(s.analysis.gis);
    await t.attachIntelligence('gis-a', 'brief', { content: 'Interpretation only' });
    return { before, after: JSON.stringify(s.analysis.gis), digest: t.analysisEvidence(s.analysis).gis };
  });
  expect(result.after).toBe(result.before);
  expect(result.digest.status).toBe('enhanced');
  expect(errors).toEqual([]);
});

test('live Princeton 50-mile geographic sanity check', async ({ page }) => {
  test.skip(process.env.FF_LIVE_GIS !== '1', 'explicit live validation only');
  test.setTimeout(150000);
  const errors = await open(page, httpUrl);
  await page.locator('#locationInput').fill('38.3553, -87.5675');
  await page.locator('#radiusSelect').selectOption('50');
  await page.locator('#depthSelect').selectOption('deep');
  await page.locator('#analyzeBtn').click();
  await page.waitForFunction(() => window.__FRUITING_FORECAST_TEST__.getState().analysis && !document.querySelector('#analyzeBtn').disabled, null, { timeout: 120000 });
  const result = await page.evaluate(() => {
    const analysis = window.__FRUITING_FORECAST_TEST__.getState().analysis;
    return {
      gis: analysis.gis,
      ranked: analysis.ranked.map(row => ({ species: row.speciesId, score: row.score, habitat: row.components.habitat, best: row.bestZoneId })),
      zones: analysis.zones.map(zone => ({ zone: zone.name, forest: zone.habitat?.forest?.cover, oak: zone.habitat?.hosts?.oakHickory, access: zone.habitat?.access?.classification, utility: zone.accessUtility, opportunity: zone.opportunity, cells: zone.habitat?.sampleCells, properties: zone.habitat?.access?.properties }))
      ,candidates: analysis.candidates.map(c => ({ name: c.name, biology: c.biologicalOpportunity, huntability: c.huntability.score, action: c.huntability.actionability, rule: c.rule.collectingStatus }))
    };
  });
  console.log(`PRINCETON_GIS ${JSON.stringify(result)}`);
  expect(result.gis.status).toBe('enhanced');
  expect(result.zones).toHaveLength(9);
  expect(new Set(result.zones.map(zone => zone.forest)).size).toBeGreaterThan(2);
  expect(result.zones.every(zone => zone.cells > 1)).toBe(true);
  expect(result.ranked.every(row => Number.isFinite(row.habitat))).toBe(true);
  expect(result.candidates.some(c => c.name === 'Pike State Forest' && c.action === 'ACTIONABLE_WITH_RESTRICTIONS')).toBe(true);
  expect(result.candidates.some(c => c.name === 'Patoka River National Wildlife Refuge' && c.rule === 'PROHIBITED')).toBe(true);
  await page.screenshot({ path: '/private/tmp/fruiting-princeton-desktop.png', fullPage: true });
  await page.locator('#mapLayer').selectOption('huntable');
  await page.locator('[data-property]').filter({ hasText: 'Pike State Forest' }).click();
  await expect(page.locator('#detailContent')).toContainText('Pike State Forest');
  await expect(page.locator('#detailContent')).toContainText('ALLOWED_WITH_LIMITS');
  await page.screenshot({ path: '/private/tmp/fruiting-princeton-public-lands.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.workspace')).toHaveCSS('display', 'block');
  await page.screenshot({ path: '/private/tmp/fruiting-princeton-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
