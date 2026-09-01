const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const http = require('http');

const port = 8800 + (process.pid % 700);
const url = `http://127.0.0.1:${port}/fruiting-forecast.html`;
let server;

test.use({ channel: 'chrome', viewport: { width: 1280, height: 850 } });
test.beforeAll(async () => {
  server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: process.cwd(), stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { await new Promise((resolve, reject) => http.get(url, r => { r.resume(); resolve(); }).on('error', reject)); return; }
    catch { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error('Static test server did not start');
});
test.afterAll(() => { if (server) server.kill(); });

async function open(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
  await page.route('**/api/analytics/**', r => r.abort());
  await page.route('https://tile.openstreetmap.org/**', r => r.abort());
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__FRUITING_FORECAST_TEST__ && window.__FRUITING_FORECAST_HUNTABILITY_TEST__);
  return errors;
}

test('property-specific rules override broad rules and unknown remains unknown', async ({ page }) => {
  const errors = await open(page);
  const result = await page.evaluate(() => {
    const h = window.__FRUITING_FORECAST_HUNTABILITY_TEST__;
    const property = { name: 'Example Refuge', manager: 'Example Agency', propertyType: 'Refuge', ownershipClass: 'PUBLIC' };
    const rules = { verifiedAt: '2026-09-01', rules: [
      { id: 'agency', scope: { managerContains: 'Example Agency' }, collectingStatus: 'ALLOWED_WITH_LIMITS', sourceUrl: 'https://example.gov/agency' },
      { id: 'property', scope: { propertyName: 'Example Refuge' }, collectingStatus: 'PROHIBITED', sourceUrl: 'https://example.gov/property' }
    ] };
    const resolved = h.resolveCollectingRule(property, rules);
    const unknown = h.resolveCollectingRule({ ...property, name: 'Unlisted Place', manager: 'Other' }, rules);
    return { resolved: resolved.id, unknown: unknown.collectingStatus, hunt: h.huntability(property, resolved), mixed: h.huntability({ ...property, ownershipClass: 'MIXED' }, unknown) };
  });
  expect(result.resolved).toBe('property');
  expect(result.unknown).toBe('UNKNOWN_VERIFY');
  expect(result.hunt.actionability).toBe('NOT_ACTIONABLE');
  expect(result.hunt.score).toBeLessThanOrEqual(8);
  expect(result.mixed.actionability).toBe('VERIFY_BEFORE_GOING');
  expect(result.mixed.score).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('Huntability is deterministic and private access does not alter biological scoring', async ({ page }) => {
  const errors = await open(page);
  const result = await page.evaluate(() => {
    const t = window.__FRUITING_FORECAST_TEST__, h = window.__FRUITING_FORECAST_HUNTABILITY_TEST__;
    const metrics = { rain10: 1.5, rain14: 1.8, daysSinceRain: 6, soilMoisture: .29, soilTemp: 66, airTemp: 70, et07: .7, vpd: .6, wind: 4, freeze: false, heat: 79 };
    const habitat = { available: true, forest: { cover: .9, deciduous: .8, open: .1, canopy: .75 }, hosts: { oakHickory: .9, beechMaple: .1, elmAshCottonwood: 0 }, soil: { wellDrainedPct: .8, awc25: 7 }, terrain: { slopeMedianDeg: 5 }, access: { publicPct: 0, restrictedPct: 0 }, confidence: { cellCoverage: 1, hostQuality: .65, soilCoverage: 1 } };
    const species = t.SPECIES.find(x => x.id === 'chanterelle');
    const before = t.scoreSpecies(species, { point: { searchRadius: 25 }, metrics, habitat }, null, new Date('2026-07-15')).score;
    const privateHunt = h.huntability({ name: 'Private Woods', ownershipClass: 'PRIVATE' }, { collectingStatus: 'UNKNOWN_VERIFY' });
    habitat.access.publicPct = 1;
    const after = t.scoreSpecies(species, { point: { searchRadius: 25 }, metrics, habitat }, null, new Date('2026-07-15')).score;
    return { before, after, a: privateHunt, b: h.huntability({ name: 'Private Woods', ownershipClass: 'PRIVATE' }, { collectingStatus: 'UNKNOWN_VERIFY' }) };
  });
  expect(result.after).toBe(result.before);
  expect(result.a).toEqual(result.b);
  expect(result.a.actionability).toBe('NOT_ACTIONABLE');
  expect(errors).toEqual([]);
});

test('actionable properties rank ahead while a private biological hotspot remains visible', async ({ page }) => {
  const errors = await open(page);
  const result = await page.evaluate(() => {
    const t = window.__FRUITING_FORECAST_TEST__, h = window.__FRUITING_FORECAST_HUNTABILITY_TEST__;
    const metrics = { rain10: 1.5, rain14: 1.8, rain7: 1.1, daysSinceRain: 6, soilMoisture: .29, soilTemp: 66, airTemp: 70, et07: .7, vpd: .6, wind: 4, freeze: false, heat: 79 };
    const habitat = { available: true, forest: { cover: .9, deciduous: .8, open: .1, canopy: .75 }, hosts: { oakHickory: .9, beechMaple: .1, elmAshCottonwood: 0 }, soil: { wellDrainedPct: .8, awc25: 7 }, terrain: { slopeMedianDeg: 5 }, access: { publicPct: 1, restrictedPct: 0 }, confidence: { cellCoverage: 1, hostQuality: .65, soilCoverage: 1 } };
    const rule = { collectingStatus: 'ALLOWED_WITH_LIMITS', sourceUrl: 'https://example.gov/rule' }, unknown = { collectingStatus: 'UNKNOWN_VERIFY' };
    const base = { manager: 'Manager', propertyType: 'Forest', center: { lat: 38.35, lon: -87.57 }, distance: 5, habitat, geometrySource: 'PAD-US', sourceUrl: 'https://example.gov/gis' };
    const publicLand = { ...base, id: 'public', name: 'Public Forest', ownershipClass: 'PUBLIC', rule };
    publicLand.huntability = h.huntability(publicLand, rule);
    const privateLand = { ...base, id: 'private', name: 'Private Hotspot', ownershipClass: 'PRIVATE', rule: unknown };
    privateLand.huntability = h.huntability(privateLand, unknown);
    const zones = [{ id: 'center', point: { lat: 38.35, lon: -87.57 }, weather: { metrics } }];
    return h.buildCandidates([privateLand, publicLand], zones, [t.SPECIES.find(x => x.id === 'chanterelle')], {}, 25).map(c => ({ id: c.id, biological: c.biologicalOpportunity, action: c.huntability.actionability }));
  });
  expect(result.map(x => x.id)).toEqual(['public', 'private']);
  expect(result[0].biological).toBe(result[1].biological);
  expect(result[1].action).toBe('NOT_ACTIONABLE');
  expect(errors).toEqual([]);
});

test('real static property geometry and authoritative rule metadata load', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await open(page);
  const result = await page.evaluate(async () => {
    const t = window.__FRUITING_FORECAST_TEST__;
    const points = t.zonePoints(38.3553, -87.5675, 50, 'deep');
    const evidence = await t.HabitatProvider.fetch(points, { lat: 38.3553, lon: -87.5675 }, 50, new AbortController().signal, false);
    const names = evidence._properties.map(p => p.name);
    const pike = evidence._properties.find(p => p.name === 'Pike State Forest');
    const patoka = evidence._properties.find(p => p.name === 'Patoka River National Wildlife Refuge');
    return { count: names.length, pike: pike && { rule: pike.rule.collectingStatus, type: pike.propertyType, source: pike.sourceUrl, geometry: pike.geometry.type }, patoka: patoka && patoka.rule.collectingStatus, ruleMeta: evidence._rules };
  });
  expect(result.count).toBeGreaterThan(10);
  expect(result.pike).toMatchObject({ rule: 'ALLOWED_WITH_LIMITS', type: 'State Forest', geometry: 'MultiPolygon' });
  expect(result.pike.source).toMatch(/^https:/);
  expect(result.patoka).toBe('PROHIBITED');
  expect(result.ruleMeta.count).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('malformed rules degrade the access subsystem without breaking habitat', async ({ page }) => {
  const errors = await open(page);
  await page.route('**/data/fruiting-forecast/public-land-rules.json**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"schemaVersion":1,"rules":[{"bad":true}]}' }));
  const result = await page.evaluate(async () => {
    const t = window.__FRUITING_FORECAST_TEST__;
    const evidence = await t.HabitatProvider.fetch(t.zonePoints(38.3553, -87.5675, 25, 'standard'), { lat: 38.3553, lon: -87.5675 }, 25, new AbortController().signal, true);
    return { center: evidence.center.available, properties: evidence._properties.length, error: evidence._rules.error };
  });
  expect(result.center).toBe(true);
  expect(result.properties).toBe(0);
  expect(result.error).toContain('malformed');
  expect(errors).toEqual([]);
});

test('missing public-land asset leaves static habitat and map fallback intact', async ({ page }) => {
  const errors = await open(page);
  await page.route('**/data/fruiting-forecast/public-lands.parquet', r => r.fulfill({ status: 503, body: 'offline' }));
  const result = await page.evaluate(async () => {
    const t = window.__FRUITING_FORECAST_TEST__;
    const evidence = await t.HabitatProvider.fetch(t.zonePoints(38.3553, -87.5675, 25, 'standard'), { lat: 38.3553, lon: -87.5675 }, 25, new AbortController().signal, true);
    return { center: evidence.center.available, properties: evidence._properties.length, error: evidence._rules.error };
  });
  expect(result.center).toBe(true);
  expect(result.properties).toBe(0);
  expect(result.error).toContain('HTTP 503');
  await expect(page.locator('#emptyState')).toBeVisible();
  expect(errors).toEqual([]);
});

test('named public-land layer and property details remain usable on desktop and mobile', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => {
    const t = window.__FRUITING_FORECAST_TEST__, h = window.__FRUITING_FORECAST_HUNTABILITY_TEST__, s = t.getState();
    const score = { speciesId: 'chanterelle', score: 84, band: 'High', confidence: { label: 'High', score: 88 }, components: { habitat: 90 }, habitatDetail: { score: 90 } };
    const geometry = { type: 'MultiPolygon', coordinates: [[[[-87.7,38.2],[-87.5,38.2],[-87.5,38.4],[-87.7,38.4],[-87.7,38.2]]]] };
    const candidate = { id: 'pike', name: 'Pike State Forest', manager: 'Indiana DNR', propertyType: 'State Forest', ownershipClass: 'PUBLIC', center: { lat: 38.3, lon: -87.6 }, distance: 12, habitat: { available: true, sampleCells: 8, forest: { cover: .9, canopy: .8 }, hosts: { oakHickory: .8 }, soil: {} }, weatherZoneId: 'center', scores: [score], biologicalOpportunity: 84, topSpeciesId: 'chanterelle', huntability: { score: 92, actionability: 'ACTIONABLE_WITH_RESTRICTIONS' }, rule: { collectingStatus: 'ALLOWED_WITH_LIMITS', summary: 'Personal use only.', verifiedAt: '2026-09-01', scope: { propertyName: 'Pike State Forest' }, sourceUrl: 'https://example.gov/rule', sourceTitle: 'Rule' }, recommendedHuntScore: 77, geometrySource: 'PAD-US', sourceUrl: 'https://example.gov/geometry' };
    s.analysis = { location: { lat: 38.35, lon: -87.57 }, zones: [{ id: 'center', point: { lat: 38.35, lon: -87.57 }, scores: [score] }], candidates: [candidate] };
    s.gis.properties = [{ id: 'pike', geometry }]; s.selectedSpecies = 'chanterelle'; s.selectedZone = 'center'; s.selectedProperty = 'pike'; s.mapLayer = 'huntable';
    h.renderHuntable(); h.renderMap(); h.renderDetail();
  });
  await expect(page.locator('#huntableList')).toContainText('Pike State Forest');
  await expect(page.locator('#detailContent')).toContainText('Biological opportunity');
  await expect(page.locator('#detailContent')).toContainText('Huntability 92/100');
  expect(await page.locator('.leaflet-container').count() + await page.locator('.map-fallback').count()).toBeGreaterThan(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.workspace')).toHaveCSS('display', 'block');
  await expect(page.locator('.place-grid')).toHaveCSS('grid-template-columns', '1fr');
  expect(errors).toEqual([]);
});

test('OpenRouter attachment cannot mutate ownership, rules, or Huntability', async ({ page }) => {
  const errors = await open(page);
  const result = await page.evaluate(async () => {
    const t = window.__FRUITING_FORECAST_TEST__, s = t.getState();
    s.analysis = { id: 'access-a', generatedAt: new Date().toISOString(), version: 'FF-test', location: { label: 'Princeton', lat: 38.35, lon: -87.57 }, radius: 50, depth: 'deep', gis: { status: 'enhanced' }, ranked: [], zones: [], observations: {}, candidates: [{ id: 'pike', ownershipClass: 'PUBLIC', rule: { collectingStatus: 'ALLOWED_WITH_LIMITS' }, huntability: { score: 92, actionability: 'ACTIONABLE_WITH_RESTRICTIONS' } }] };
    const before = JSON.stringify(s.analysis.candidates);
    await t.attachIntelligence('access-a', 'brief', { content: 'Interpretation only' });
    return { before, after: JSON.stringify(s.analysis.candidates) };
  });
  expect(result.after).toBe(result.before);
  expect(errors).toEqual([]);
});
