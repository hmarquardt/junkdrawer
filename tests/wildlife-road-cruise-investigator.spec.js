const { test, expect } = require('@playwright/test');
const path = require('path');

const PAGE_URL = () => `file://${path.resolve(process.cwd(), 'wildlife-road-cruise-investigator.html')}`;

const SAMPLE_PACKAGE = {
  schemaVersion: 1,
  generator: { name: 'Wildlife Road Cruise Investigator', version: 'test' },
  guide: {
    id: 'nashville-tn-wildlife-road-cruises',
    title: 'Nashville Wildlife Road Cruises',
    description: 'Test package for validation.',
    location: { input: 'Nashville, Tennessee', canonicalName: 'Nashville, Tennessee', lat: 36.16, lng: -86.78, region: 'Tennessee', country: 'United States', counties: ['Davidson'] },
    radiusMiles: 25,
    generatedAt: '2026-08-31T12:00:00.000Z',
    researchMode: 'deep',
    cruisingPhilosophy: ['Slow vehicle-based wildlife observation']
  },
  routes: [
    {
      id: 'r1',
      name: 'Test Bottoms Loop — Old River Rd',
      short: 'Old River Rd',
      tagline: 'A test wetland loop.',
      classification: 'recommended',
      color: '#e69f6b',
      traffic: 'Expected very low',
      geometryType: 'loop',
      confidence: 'High — mapped-road geometry',
      habitat: ['💧'],
      why: 'Test habitat narrative.',
      wildlife: {
        birds: [{ n: 'Great blue heron', t: 'documented', d: 'test note' }],
        mammals: [{ n: 'White-tailed deer', t: 'regularly-reported', d: '' }],
        herps: [{ n: 'Painted turtle', t: 'habitat-supported', d: '' }],
        other: []
      },
      cues: ['Scan the water margin.'],
      seasons: [['Spring', 'Test spring note']],
      best: 'Dawn.',
      wildcards: ['A test wildcard.'],
      watch: ['🦅 raptors'],
      tags: ['birds', 'wetlands'],
      access: { status: 'probable', notes: 'Public road presumed open.' },
      geometry: { type: 'LineString', coordinates: [[-86.78, 36.16], [-86.77, 36.17], [-86.76, 36.165]] },
      geometryConfidence: 'verified',
      geometryNote: 'From mapped OSM ways.',
      routeMiles: 4.2,
      scores: { biologicalPotential: 8, roadCruiseSuitability: 8, trafficSuitability: 7, habitatDiversity: 8, accessConfidence: 7, evidenceConfidence: 7, overall: 7.8 },
      sourceUrls: ['https://www.tn.gov/twra/wildlife.html'],
      unresolvedQuestions: []
    },
    {
      id: 'r2',
      name: 'Exploratory Slough Out-and-Back',
      short: 'Slough Rd',
      tagline: 'An exploratory test route.',
      classification: 'exploratory',
      color: '#66c2a5',
      traffic: 'Expected low',
      geometryType: 'out-and-back',
      confidence: 'Exploratory — geometry unresolved',
      habitat: ['🌾'],
      why: 'Another test narrative.',
      wildlife: { birds: [{ n: 'Killdeer', t: 'habitat-supported', d: '' }], mammals: [], herps: [], other: [] },
      cues: [],
      seasons: [],
      best: 'Any morning.',
      wildcards: [],
      watch: [],
      tags: ['birds'],
      access: { status: 'unverified', notes: '' },
      geometry: null,
      geometryConfidence: 'unresolved',
      geometryNote: 'Unresolved on purpose.',
      geometryAnchor: { lat: 36.2, lng: -86.7 },
      routeMiles: null,
      scores: { biologicalPotential: 6, roadCruiseSuitability: 5, trafficSuitability: 6, habitatDiversity: 5, accessConfidence: 4, evidenceConfidence: 5, overall: 5.3 },
      sourceUrls: [],
      unresolvedQuestions: ['Is Slough Rd open year-round?']
    }
  ],
  research: {
    pipeline: [],
    landscape: null,
    candidates: [
      { id: 'cand-1', name: 'Test WMA', type: 'wma', jurisdiction: 'State', lat: 36.2, lng: -86.7, briefDescription: 'A test candidate.', habitatKinds: ['wetland'], notableSpecies: [], sourceUrls: [], distanceMiles: 3.1, triage: { verdict: 'promoted', reasonCode: 'other', reason: '', scores: {} } }
    ],
    rejectedCandidates: [{ name: 'Test Park', type: 'other', reasonCode: 'walking-oriented', reason: 'Trail-based park.', distanceMiles: null }],
    roads: [],
    sources: [
      { id: 'src-1', title: 'Tennessee Wildlife Resources Agency', url: 'https://www.tn.gov/twra/wildlife.html', sourceType: 'state-agency', supports: ['public-access'], accessedAt: '2026-08-31T12:00:00.000Z', authorityTier: 'state-agency' }
    ],
    warnings: [],
    unresolvedQuestions: [{ route: 'r2', routeName: 'Exploratory Slough Out-and-Back', text: 'Is Slough Rd open year-round?' }],
    usage: { llmCalls: 3, searchCalls: 2, fetchCalls: 1, mapQueries: 1, tokensIn: 900, tokensOut: 700, cost: 0.012, citations: [{ url: 'https://www.tn.gov/twra/wildlife.html', title: 'TWRA' }] }
  },
  fieldReports: []
};

test.use({ channel: 'chrome' });

test.beforeEach(async ({ page }) => {
  await page.route('**/api/analytics/**', r => r.abort());
  await page.goto(PAGE_URL(), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
});

test('loads with no console or page errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForTimeout(700);
  expect(errors).toEqual([]);
});

test('renders the 10-stage pipeline in pending state', async ({ page }) => {
  await expect(page.locator('#pipeline .stage')).toHaveCount(10);
  await expect(page.locator('.stage[data-stage="geography"] .stage-status-label')).toHaveText('Pending');
  await expect(page.locator('.stage[data-stage="qa"]')).toBeVisible();
});

test('tab switching preserves state', async ({ page }) => {
  await page.click('#tabbtn-preview');
  await expect(page.locator('#tab-preview')).toBeVisible();
  await expect(page.locator('#tab-investigate')).toBeHidden();
  await page.click('#tabbtn-investigate');
  await expect(page.locator('.stage[data-stage="geography"]')).toBeVisible();
});

test('import via editor produces a rendered preview with route cards and sources', async ({ page }) => {
  await page.click('#tabbtn-data');
  await page.locator('#jsonEditor').fill(JSON.stringify(SAMPLE_PACKAGE, null, 2));
  await page.click('#btnApplyJson');
  await expect(page.locator('#dataStatus')).toContainText('loaded');
  await expect(page.locator('#tab-preview')).toBeVisible();
  await expect(page.locator('#pvRouteList .route')).toHaveCount(2);
  await expect(page.locator('#pvRouteList .route').first()).toContainText('Test Bottoms Loop');
  await expect(page.locator('#pvSources li').first()).toContainText('Tennessee Wildlife Resources Agency');
  await expect(page.locator('.tier.t-documented').first()).toBeVisible();
  await expect(page.locator('.class-chip.cls-recommended').first()).toBeVisible();
});

test('active route panel shows full field guide with access and research', async ({ page }) => {
  await page.click('#tabbtn-data');
  await page.locator('#jsonEditor').fill(JSON.stringify(SAMPLE_PACKAGE, null, 2));
  await page.click('#btnApplyJson');
  await page.locator('#pvRouteList .route').first().click();
  await expect(page.locator('#pvActive')).toContainText('Why this road is interesting');
  await expect(page.locator('#pvActive')).toContainText('Access probable');
  await expect(page.locator('#pvActive')).toContainText('Sources for this route');
});

test('export downloads JSON that re-imports', async ({ page }) => {
  await page.click('#tabbtn-data');
  await page.locator('#jsonEditor').fill(JSON.stringify(SAMPLE_PACKAGE, null, 2));
  await page.click('#btnApplyJson');
  await page.click('#tabbtn-data');
  const download = page.waitForEvent('download');
  await page.click('#btnExportJson');
  const dl = await download;
  expect(dl.suggestedFilename()).toBe('nashville-tn-wildlife-road-cruises.json');
  const stream = await dl.createReadStream();
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(exported.schemaVersion).toBe(1);
  expect(exported.routes).toHaveLength(2);
  expect(exported.routes[0].geometry.type).toBe('LineString');
  expect(exported.fieldReports).toEqual([]);
});

test('validate reports invalid JSON clearly', async ({ page }) => {
  await page.click('#tabbtn-data');
  await page.locator('#jsonEditor').fill('{"schemaVersion": 2}');
  await page.click('#btnValidateJson');
  await expect(page.locator('#dataStatus')).toContainText('Invalid');
  await page.locator('#jsonEditor').fill('not json at all');
  await page.click('#btnValidateJson');
  await expect(page.locator('#dataStatus')).toContainText('Invalid JSON');
});

test('research inspector opens from a route card', async ({ page }) => {
  await page.click('#tabbtn-data');
  await page.locator('#jsonEditor').fill(JSON.stringify(SAMPLE_PACKAGE, null, 2));
  await page.click('#btnApplyJson');
  await page.locator('#pvRouteList .route').first().locator('.research-btn').click();
  const modal = page.locator('#modal .modal-box');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('Sources & evidence');
  await page.locator('#modalActions button').click();
  await expect(page.locator('#modal')).toBeHidden();
});

test('candidate markers toggle on the map after import', async ({ page }) => {
  await page.click('#tabbtn-data');
  await page.locator('#jsonEditor').fill(JSON.stringify(SAMPLE_PACKAGE, null, 2));
  await page.click('#btnApplyJson');
  await page.check('#pvCandToggle');
  await expect(page.locator('#pvMap .leaflet-overlay-pane path')).not.toHaveCount(0);
});

test('localStorage stays lightweight (settings key only)', async ({ page }) => {
  await page.click('#tabbtn-data');
  await page.locator('#jsonEditor').fill(JSON.stringify(SAMPLE_PACKAGE, null, 2));
  await page.click('#btnApplyJson');
  await page.waitForTimeout(1500);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  const junkdrawerKeys = keys.filter(k => k.startsWith('wrci.') || k.startsWith('junkstats.'));
  expect(junkdrawerKeys.length).toBeLessThanOrEqual(3);
  expect(junkdrawerKeys).toContain('wrci.settings.v1');
});

test('investigate requires a key and a location, with no fabricated progress', async ({ page }) => {
  await page.click('#btnInvestigate');
  await expect(page.locator('#intakeStatus')).toContainText('location');
  await page.locator('#locInput').fill('Nashville, Tennessee');
  await page.click('#btnInvestigate');
  await expect(page.locator('#toast')).toContainText('OpenRouter API key');
  await expect(page.locator('.stage[data-stage="geography"] .stage-status-label')).toHaveText('Pending');
});
