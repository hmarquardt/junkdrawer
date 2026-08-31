const { test, expect } = require('@playwright/test');
const path = require('path');

const PAGE_URL = () => `file://${path.resolve(process.cwd(), 'wildlife-road-cruise-investigator.html')}`;

test.use({ channel: 'chrome' });

const CANDIDATES = [
  { name: 'Old River Bottoms WMA', type: 'wma', jurisdiction: 'State', lat: 36.2, lng: -86.8, briefDescription: 'Bottomland wetland along a river.', habitatKinds: ['wetland'], notableSpecies: [], sourceUrls: ['https://www.tn.gov/twra/oldriver.html'], distanceMiles: 4.2 },
  { name: 'Cane Ridge Grasslands', type: 'conservation', jurisdiction: 'County', lat: 36.05, lng: -86.7, briefDescription: 'Reclaimed grassland complex.', habitatKinds: ['grassland'], notableSpecies: [], sourceUrls: [], distanceMiles: 9.1 },
  { name: 'Perimeter Reservoir Wetlands', type: 'reservoir', jurisdiction: 'City', lat: 36.3, lng: -86.75, briefDescription: 'Shallow reservoir edges.', habitatKinds: ['wetland'], notableSpecies: [], sourceUrls: [], distanceMiles: 10.0 },
  { name: 'Downtown Riverfront Park', type: 'other', jurisdiction: 'City', lat: 36.16, lng: -86.78, briefDescription: 'Urban park with greenway.', habitatKinds: ['river'], notableSpecies: [], sourceUrls: [], distanceMiles: 0.3 },
  { name: 'Deep Forest Hiking Sanctuary', type: 'conservation', jurisdiction: 'Private', lat: 36.1, lng: -86.9, briefDescription: 'Trail-only access preserve.', habitatKinds: ['forest'], notableSpecies: [], sourceUrls: [], distanceMiles: 7.0 },
  { name: 'East County Slough Complex', type: 'wetland', jurisdiction: 'County', lat: 36.12, lng: -86.55, briefDescription: 'Sloughs beside rural roads.', habitatKinds: ['wetland'], notableSpecies: [], sourceUrls: [], distanceMiles: 13.0 },
  { name: 'North Rail Corridor Prairie', type: 'prairie', jurisdiction: 'State', lat: 36.35, lng: -86.7, briefDescription: 'Prairie strips along a rail line.', habitatKinds: ['grassland'], notableSpecies: [], sourceUrls: [], distanceMiles: 13.5 },
  { name: 'Gated Hunt Club Grounds', type: 'other', jurisdiction: 'Private', lat: 36.25, lng: -86.65, briefDescription: 'Private gated grounds.', habitatKinds: ['forest'], notableSpecies: [], sourceUrls: [], distanceMiles: 7.5 }
];

const j = (obj) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
const llmBody = (value, usage) => j({
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(value) } }],
  usage: usage || { prompt_tokens: 500, completion_tokens: 400, total_tokens: 900, cost: 0.004 }
});

function stageKey(userText){
  if (userText.includes('TASK: Resolve this location')) return 'geography';
  if (userText.includes('LANDSCAPE CHARACTERIZATION')) return 'landscape';
  if (userText.includes('BROAD CANDIDATE DISCOVERY')) return 'discovery';
  if (userText.includes('AUTONOMOUS TRIAGE')) return 'triage';
  if (userText.includes('ROAD-LEVEL INVESTIGATION')) return 'roads';
  if (userText.includes('WILDLIFE ENRICHMENT')) return 'enrichment';
  if (userText.includes('ADVERSARIAL VERIFICATION')) return 'verification';
  if (userText.includes('RANKING & GUIDE ASSEMBLY')) return 'ranking';
  return 'unknown';
}

const ROUTE_NAMES = ['Old River Bottoms Loop', 'Cane Ridge Grassland Wander', 'East Slough Out-and-Back'];

function enrichmentResponse(userText){
  const routeName = (userText.match(/Route: ([^\n]+)/) || [])[1] || 'Route';
  return {
    tagline: 'Test route for ' + routeName,
    why: 'Wetland edge meets agricultural field at the road shoulder, creating a roadside feeding line.',
    wildlife: {
      birds: [
        { n: 'Great blue heron', t: 'documented', d: 'on the property list' },
        { n: 'Wood duck', t: 'regularly-reported', d: '' }
      ],
      mammals: [{ n: 'White-tailed deer', t: 'regularly-reported', d: '' }],
      herps: [{ n: 'Painted turtle', t: 'habitat-supported', d: '' }],
      other: []
    },
    cues: ['Scan the water margin slowly.'],
    seasons: [{ season: 'Spring', text: 'Frog chorus begins.' }, { season: 'Winter', text: 'Waterfowl build.' }],
    best: 'Dawn and the last hour of daylight.',
    wildcards: ['An otter surfacing at dusk.'],
    watch: ['🦅 raptors', '🦆 waterfowl'],
    tags: ['birds', 'mammals', 'wetlands', 'dawn', 'postrain'],
    habitatIcons: ['💧', '🌾'],
    sources: [{ title: 'Tennessee Wildlife Resources Agency — ' + routeName, url: 'https://www.tn.gov/twra/wildlife.html' }]
  };
}

test.describe.configure({ mode: 'serial' });

test('full autonomous pipeline: geography → QA → guide ready', async ({ page }) => {
  test.setTimeout(120000);
  await page.route('**/api/analytics/**', r => r.abort());

  await page.route('https://openrouter.ai/api/v1/models', r => r.fulfill(j({ data: [
    { id: 'openai/gpt-4.1-mini', name: 'OpenAI: GPT-4.1 Mini' },
    { id: 'test/research-model', name: 'Test Research Model' }
  ] })));

  await page.route('https://openrouter.ai/api/v1/chat/completions', async r => {
    const body = r.request().postDataJSON();
    const user = body.messages.map(m => m.content).join('\n');
    const key = stageKey(user);
    if (key === 'geography') return r.fulfill(llmBody({
      resolved: true, ambiguous: false,
      candidates: [{ label: 'Nashville, Tennessee', region: 'Tennessee', country: 'United States', lat: 36.16, lng: -86.78, why: '' }],
      canonicalName: 'Nashville, Tennessee', lat: 36.16, lng: -86.78, region: 'Tennessee', country: 'United States',
      counties: ['Davidson', 'Williamson'], notes: 'Resolved from location string.',
      sources: [{ title: 'Wikipedia — Nashville', url: 'https://en.wikipedia.org/wiki/Nashville,_Tennessee' }]
    }));
    if (key === 'landscape') return r.fulfill(llmBody({
      habitats: [
        { name: 'Cumberland River bottoms', kind: 'river', description: 'Floodplain forest and sloughs.', roadCruiseRelevance: 'high' },
        { name: 'Reclaimed grassland complexes', kind: 'grassland', description: 'Old fields on reclaimed ground.', roadCruiseRelevance: 'high' },
        { name: 'Reservoir edges', kind: 'wetland', description: 'Shallow draws at reservoir heads.', roadCruiseRelevance: 'medium' }
      ],
      summary: 'River bottoms, grasslands and reservoir edges dominate.',
      seasonalityNotes: 'Winter waterfowl; spring shorebirds on mudflats.',
      fewQualifyingHabitats: false, suggestedRadiusExpansionMiles: 0,
      sources: []
    }));
    if (key === 'discovery') return r.fulfill(llmBody({
      candidates: CANDIDATES.map(c => ({
        name: c.name, type: c.type, jurisdiction: c.jurisdiction, lat: c.lat, lng: c.lng,
        briefDescription: c.briefDescription, habitatKinds: c.habitatKinds, notableSpecies: [],
        sourceUrls: c.sourceUrls
      }))
    }));
    if (key === 'triage') return r.fulfill(llmBody({
      evaluations: [
        { name: CANDIDATES[0].name, verdict: 'promoted', reasonCode: 'other', reason: 'Strong wetland road adjacency.', scores: { habitatPotential: 8, roadHabitatAdjacency: 8, trafficSuitability: 8, vehicleAccess: 7, roadGeometry: 7, observationPracticality: 8, walkingIndependence: 9, evidenceConfidence: 7 } },
        { name: CANDIDATES[1].name, verdict: 'promoted', reasonCode: 'other', reason: 'Grassland grid roads.', scores: { habitatPotential: 7, roadHabitatAdjacency: 7, trafficSuitability: 8, vehicleAccess: 7, roadGeometry: 8, observationPracticality: 7, walkingIndependence: 8, evidenceConfidence: 6 } },
        { name: CANDIDATES[2].name, verdict: 'secondary', reasonCode: 'other', reason: 'Reservoir edge likely good but access unconfirmed.', scores: { habitatPotential: 7, roadHabitatAdjacency: 6, trafficSuitability: 6, vehicleAccess: 5, roadGeometry: 6, observationPracticality: 7, walkingIndependence: 7, evidenceConfidence: 5 } },
        { name: CANDIDATES[3].name, verdict: 'rejected', reasonCode: 'high-traffic', reason: 'Urban park, heavy traffic.', scores: {} },
        { name: CANDIDATES[4].name, verdict: 'rejected', reasonCode: 'walking-oriented', reason: 'Trail-only access.', scores: {} },
        { name: CANDIDATES[5].name, verdict: 'promoted', reasonCode: 'other', reason: 'Sloughs directly beside county roads.', scores: { habitatPotential: 8, roadHabitatAdjacency: 8, trafficSuitability: 9, vehicleAccess: 7, roadGeometry: 6, observationPracticality: 8, walkingIndependence: 9, evidenceConfidence: 6 } },
        { name: CANDIDATES[6].name, verdict: 'secondary', reasonCode: 'other', reason: 'Prairie strips visible from a rail-access road.', scores: { habitatPotential: 6, roadHabitatAdjacency: 5, trafficSuitability: 7, vehicleAccess: 5, roadGeometry: 5, observationPracticality: 6, walkingIndependence: 7, evidenceConfidence: 4 } },
        { name: CANDIDATES[7].name, verdict: 'rejected', reasonCode: 'private-access', reason: 'Gated private grounds.', scores: {} }
      ]
    }));
    if (key === 'roads') return r.fulfill(llmBody({
      roads: [
        { candidateName: CANDIDATES[0].name, routeName: ROUTE_NAMES[0], roadNames: ['Old River Rd'], geometryType: 'loop', surface: 'Paved county road', publicAccess: { status: 'verified', notes: 'Public county road through the WMA.' }, closures: 'None known', trafficExpectation: 'Expected very low', pulloffs: 'Wide shoulders at bridges', adjacencyNotes: 'Wetland touches the road for two miles.', centerLat: 36.2, centerLng: -86.8, estimatedMiles: 6, exploratory: false, sourceUrls: ['https://www.tn.gov/twra/oldriver.html'] },
        { candidateName: CANDIDATES[1].name, routeName: ROUTE_NAMES[1], roadNames: ['Cane Ridge Rd'], geometryType: 'wander', surface: 'Gravel', publicAccess: { status: 'probable', notes: 'County gravel roads.' }, closures: 'Gates seasonal', trafficExpectation: 'Expected low', pulloffs: 'Few', adjacencyNotes: 'Grassland alongside.', centerLat: 36.05, centerLng: -86.7, estimatedMiles: 5, exploratory: true, sourceUrls: [] },
        { candidateName: CANDIDATES[5].name, routeName: ROUTE_NAMES[2], roadNames: ['Slough Rd'], geometryType: 'out-and-back', surface: 'Paved', publicAccess: { status: 'probable', notes: 'Public road assumed.' }, closures: '', trafficExpectation: 'Expected very low', pulloffs: '', adjacencyNotes: 'Slough edge.', centerLat: 36.12, centerLng: -86.55, estimatedMiles: 4, exploratory: false, sourceUrls: [] }
      ],
      omitted: [{ candidateName: CANDIDATES[6].name, reason: 'No distinct vehicle route beyond the main road.' }]
    }));
    if (key === 'enrichment') return r.fulfill(llmBody(enrichmentResponse(user)));
    if (key === 'verification') return r.fulfill(llmBody({
      reviews: ROUTE_NAMES.map((rn, i) => ({
        routeName: rn,
        verdict: 'keep',
        accessVerification: { status: i === 0 ? 'verified' : 'probable', notes: 'Rechecked agency pages.' },
        speciesAdjustments: i === 0 ? [{ species: 'Wood duck', action: 'downgrade', to: 'habitat-supported', reason: 'Property-level record only.' }] : [],
        unresolvedQuestions: i === 1 ? ['Are the seasonal gates open in March?'] : [],
        radiusCheck: { withinRadius: true, note: '' },
        duplicateOf: '',
        notes: 'Checked against TWRA pages.'
      }))
    }));
    if (key === 'ranking') return r.fulfill(llmBody({
      routes: [
        { routeName: ROUTE_NAMES[0], scores: { biologicalPotential: 8.5, roadCruiseSuitability: 8, trafficSuitability: 8, habitatDiversity: 7.5, accessConfidence: 8, evidenceConfidence: 7.5 }, rationale: 'Strong wetland adjacency and verified access.' },
        { routeName: ROUTE_NAMES[1], scores: { biologicalPotential: 7, roadCruiseSuitability: 6.5, trafficSuitability: 7.5, habitatDiversity: 6.5, accessConfidence: 6, evidenceConfidence: 5.5 }, rationale: 'Good grassland but unverified gates.' },
        { routeName: ROUTE_NAMES[2], scores: { biologicalPotential: 7.5, roadCruiseSuitability: 7, trafficSuitability: 8, habitatDiversity: 6.5, accessConfidence: 6.5, evidenceConfidence: 6.5 }, rationale: 'Slough road with low traffic.' }
      ],
      guideTitle: 'Nashville Wildlife Road Cruises',
      guideDescription: 'Autonomously researched road-cruise opportunities around Nashville.'
    }));
    return r.fulfill({ status: 500, body: 'unexpected LLM call: ' + user.slice(0, 120) });
  });

  await page.route('https://overpass-api.de/api/interpreter', async r => {
    const body = decodeURIComponent(r.request().postData() || '').replace('data=', '');
    if (body.includes('36.12, -86.55') || body.includes('36.12,-86.55')) return r.fulfill(j({ elements: [] }));
    return r.fulfill(j({ elements: [
      { type: 'way', tags: { highway: 'secondary', name: 'Old River Rd' }, geometry: [{ lat: 36.2, lon: -86.8 }, { lat: 36.2, lon: -86.78 }] },
      { type: 'way', tags: { highway: 'secondary', name: 'Old River Rd' }, geometry: [{ lat: 36.2, lon: -86.78 }, { lat: 36.21, lon: -86.77 }] },
      { type: 'way', tags: { highway: 'footway', name: 'Old River Trail' }, geometry: [{ lat: 36.19, lon: -86.8 }, { lat: 36.19, lon: -86.79 }] }
    ] }));
  });

  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  await page.goto(PAGE_URL(), { waitUntil: 'domcontentloaded' });
  await page.fill('#apiKeyInput', 'sk-or-test');
  await page.click('#btnRefreshModels');
  await expect(page.locator('#modelStatus')).toContainText('2 models loaded');
  await page.selectOption('#modelSelect', 'test/research-model');
  await page.locator('#locInput').fill('Nashville, Tennessee');
  await page.click('#btnInvestigate');

  await expect(page.locator('#sessionPill')).toHaveText('Guide ready · Nashville, Tennessee', { timeout: 90000 });
  await expect(page.locator('#tab-preview')).toBeVisible();
  await expect(page.locator('#pvRouteList .route')).toHaveCount(3);
  await expect(page.locator('#pvGuideHead')).toContainText('Nashville Wildlife Road Cruises');
  await expect(page.locator('.stage[data-stage="geography"] .stage-status-label')).toHaveText('Complete');
  await expect(page.locator('.stage[data-stage="candidateTriage"] .stage-sub')).toContainText('3 rejected');
  await expect(page.locator('#pvActive')).toContainText('Test route for Old River Bottoms Loop');

  await page.locator('#pvRouteList .route').first().click();
  await expect(page.locator('#pvActive')).toContainText('Access verified');
  await expect(page.locator('#pvActive')).toContainText('Score rationale');
  await expect(page.locator('.tier.t-documented').first()).toBeVisible();

  expect(pageErrors).toEqual([]);

  await page.click('#tabbtn-data');
  const exported = JSON.parse(await page.locator('#jsonEditor').inputValue());
  expect(exported.schemaVersion).toBe(1);
  expect(exported.routes).toHaveLength(3);
  expect(exported.routes[0].geometry.type).toBe('LineString');
  expect(exported.routes[0].geometry.coordinates[0]).toEqual([-86.8, 36.2]);
  expect(exported.routes[1].geometry).toBeNull();
  expect(exported.routes[1].classification).toBe('exploratory');
  expect(exported.routes[0].scores.overall).toBeCloseTo(8.0, 1);
  expect(exported.research.rejectedCandidates.length).toBeGreaterThanOrEqual(4);
  expect(exported.research.sources.length).toBeGreaterThanOrEqual(3);
  expect(exported.fieldReports).toEqual([]);
  expect(exported.research.pipeline).toHaveLength(10);
  expect(exported.research.usage.llmCalls).toBeGreaterThanOrEqual(10);
  expect(exported.research.usage.mapQueries).toBeGreaterThanOrEqual(3);
  expect(exported.guide.location.lat).toBeCloseTo(36.16, 2);
  expect(exported.guide.title).toBe('Nashville Wildlife Road Cruises');
});

test('session survives reload; failed stage is retryable and pipeline completes', async ({ page }) => {
  test.setTimeout(120000);
  await page.route('**/api/analytics/**', r => r.abort());

  await page.route('https://openrouter.ai/api/v1/models', r => r.fulfill(j({ data: [{ id: 'test/research-model', name: 'Test Research Model' }] })));

  let triageCalls = 0;
  await page.route('https://openrouter.ai/api/v1/chat/completions', async r => {
    const body = r.request().postDataJSON();
    const user = body.messages.map(m => m.content).join('\n');
    const key = stageKey(user);
    if (key === 'triage'){
      triageCalls++;
      if (triageCalls <= 2) return r.fulfill({ status: 500, body: 'provider blew up' });
      return r.fulfill(llmBody({ evaluations: [
        { name: CANDIDATES[0].name, verdict: 'promoted', reasonCode: 'other', reason: '', scores: { habitatPotential: 8, roadHabitatAdjacency: 8, trafficSuitability: 8, vehicleAccess: 7, roadGeometry: 7, observationPracticality: 8, walkingIndependence: 9, evidenceConfidence: 7 } },
        { name: CANDIDATES[5].name, verdict: 'promoted', reasonCode: 'other', reason: '', scores: { habitatPotential: 8, roadHabitatAdjacency: 8, trafficSuitability: 9, vehicleAccess: 7, roadGeometry: 6, observationPracticality: 8, walkingIndependence: 9, evidenceConfidence: 6 } },
        { name: CANDIDATES[3].name, verdict: 'rejected', reasonCode: 'high-traffic', reason: '', scores: {} },
        { name: CANDIDATES[4].name, verdict: 'rejected', reasonCode: 'walking-oriented', reason: '', scores: {} }
      ] }));
    }
    if (key === 'geography') return r.fulfill(llmBody({
      resolved: true, ambiguous: false,
      candidates: [{ label: 'Nashville, Tennessee', region: 'Tennessee', country: 'United States', lat: 36.16, lng: -86.78 }],
      canonicalName: 'Nashville, Tennessee', lat: 36.16, lng: -86.78, region: 'Tennessee', country: 'United States',
      counties: ['Davidson'], notes: '', sources: []
    }));
    if (key === 'landscape') return r.fulfill(llmBody({
      habitats: [
        { name: 'River bottoms', kind: 'river', description: '', roadCruiseRelevance: 'high' },
        { name: 'Grasslands', kind: 'grassland', description: '', roadCruiseRelevance: 'high' }
      ], summary: '', seasonalityNotes: '', fewQualifyingHabitats: false, suggestedRadiusExpansionMiles: 0, sources: []
    }));
    if (key === 'discovery') return r.fulfill(llmBody({ candidates: CANDIDATES.map(c => ({ name: c.name, type: c.type, jurisdiction: 'X', lat: c.lat, lng: c.lng, briefDescription: c.name, habitatKinds: [], notableSpecies: [], sourceUrls: [] })) }));
    if (key === 'roads') return r.fulfill(llmBody({
      roads: [
        { candidateName: CANDIDATES[0].name, routeName: ROUTE_NAMES[0], roadNames: ['Old River Rd'], geometryType: 'loop', surface: 'Paved', publicAccess: { status: 'verified', notes: '' }, closures: '', trafficExpectation: 'Low', pulloffs: '', adjacencyNotes: '', centerLat: 36.2, centerLng: -86.8, estimatedMiles: 6, exploratory: false, sourceUrls: [] },
        { candidateName: CANDIDATES[5].name, routeName: ROUTE_NAMES[2], roadNames: ['Slough Rd'], geometryType: 'out-and-back', surface: 'Paved', publicAccess: { status: 'probable', notes: '' }, closures: '', trafficExpectation: 'Low', pulloffs: '', adjacencyNotes: '', centerLat: 36.12, centerLng: -86.55, estimatedMiles: 4, exploratory: false, sourceUrls: [] }
      ], omitted: []
    }));
    if (key === 'enrichment') return r.fulfill(llmBody(enrichmentResponse(user)));
    if (key === 'verification') return r.fulfill(llmBody({ reviews: [ROUTE_NAMES[0], ROUTE_NAMES[2]].map(rn => ({ routeName: rn, verdict: 'keep', accessVerification: { status: 'probable', notes: '' }, speciesAdjustments: [], unresolvedQuestions: [], radiusCheck: { withinRadius: true, note: '' }, duplicateOf: '', notes: '' })) }));
    if (key === 'ranking') return r.fulfill(llmBody({
      routes: [
        { routeName: ROUTE_NAMES[0], scores: { biologicalPotential: 8.5, roadCruiseSuitability: 8, trafficSuitability: 8, habitatDiversity: 7.5, accessConfidence: 8, evidenceConfidence: 7.5 }, rationale: 'x' },
        { routeName: ROUTE_NAMES[2], scores: { biologicalPotential: 7.5, roadCruiseSuitability: 7, trafficSuitability: 8, habitatDiversity: 6.5, accessConfidence: 6.5, evidenceConfidence: 6.5 }, rationale: 'x' }
      ], guideTitle: 'Nashville Wildlife Road Cruises', guideDescription: 'Test.'
    }));
    return r.fulfill({ status: 500, body: 'unexpected' });
  });

  await page.route('https://overpass-api.de/api/interpreter', async r => {
    const body = decodeURIComponent(r.request().postData() || '').replace('data=', '');
    if (body.includes('36.12, -86.55') || body.includes('36.12,-86.55')) return r.fulfill(j({ elements: [] }));
    return r.fulfill(j({ elements: [
      { type: 'way', tags: { highway: 'secondary', name: 'Old River Rd' }, geometry: [{ lat: 36.2, lon: -86.8 }, { lat: 36.2, lon: -86.78 }] }
    ] }));
  });

  await page.goto(PAGE_URL(), { waitUntil: 'domcontentloaded' });
  await page.fill('#apiKeyInput', 'sk-or-test');
  await page.locator('#locInput').fill('Nashville, Tennessee');
  await page.click('#btnInvestigate');

  await expect(page.locator('.stage[data-stage="candidateTriage"] .stage-status-label')).toHaveText('Failed', { timeout: 60000 });
  await expect(page.locator('.stage[data-stage="geography"] .stage-status-label')).toHaveText('Complete');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#resumeStrip')).toBeVisible();
  await expect(page.locator('#resumeMsg')).toContainText('paused');
  await expect(page.locator('.stage[data-stage="geography"] .stage-status-label')).toHaveText('Complete');
  await expect(page.locator('.stage[data-stage="candidateTriage"] .stage-status-label')).toHaveText('Failed');

  await page.click('#btnResume');
  await expect(page.locator('#sessionPill')).toHaveText('Guide ready · Nashville, Tennessee', { timeout: 90000 });
  await expect(page.locator('#pvRouteList .route')).toHaveCount(2);
});

test('ambiguous geography pauses pipeline with an inline question, resumes after answer', async ({ page }) => {
  test.setTimeout(120000);
  await page.route('**/api/analytics/**', r => r.abort());
  await page.route('https://openrouter.ai/api/v1/models', r => r.fulfill(j({ data: [{ id: 'test/research-model', name: 'Test' }] })));

  await page.route('https://openrouter.ai/api/v1/chat/completions', async r => {
    const body = r.request().postDataJSON();
    const user = body.messages.map(m => m.content).join('\n');
    const key = stageKey(user);
    if (key === 'geography'){
      const chose = user.includes('ANSWER');
      return r.fulfill(llmBody(chose ? {
        resolved: true, ambiguous: false, candidates: [],
        canonicalName: 'Nashville, Tennessee', lat: 36.16, lng: -86.78, region: 'Tennessee', country: 'United States',
        counties: [], notes: '', sources: []
      } : {
        resolved: false, ambiguous: true,
        candidates: [
          { label: 'Nashville, Tennessee', region: 'Tennessee', country: 'United States', lat: 36.16, lng: -86.78, why: 'largest' },
          { label: 'Nashville, Indiana', region: 'Indiana', country: 'United States', lat: 39.2, lng: -86.24, why: '' }
        ],
        canonicalName: '', sources: []
      }));
    }
    if (key === 'landscape') return r.fulfill(llmBody({ habitats: [{ name: 'River bottoms', kind: 'river', description: '', roadCruiseRelevance: 'high' }, { name: 'Hills', kind: 'forest', description: '', roadCruiseRelevance: 'medium' }], summary: '', seasonalityNotes: '', fewQualifyingHabitats: false, suggestedRadiusExpansionMiles: 0, sources: [] }));
    if (key === 'discovery') return r.fulfill(llmBody({ candidates: CANDIDATES.map(c => ({ name: c.name, type: c.type, jurisdiction: 'X', lat: c.lat, lng: c.lng, briefDescription: c.name, habitatKinds: [], notableSpecies: [], sourceUrls: [] })) }));
    if (key === 'triage') return r.fulfill(llmBody({ evaluations: [
      { name: CANDIDATES[0].name, verdict: 'promoted', reasonCode: 'other', reason: '', scores: { habitatPotential: 8, roadHabitatAdjacency: 8, trafficSuitability: 8, vehicleAccess: 7, roadGeometry: 7, observationPracticality: 8, walkingIndependence: 9, evidenceConfidence: 7 } },
      { name: CANDIDATES[3].name, verdict: 'rejected', reasonCode: 'high-traffic', reason: '', scores: {} },
      { name: CANDIDATES[4].name, verdict: 'rejected', reasonCode: 'walking-oriented', reason: '', scores: {} },
      { name: CANDIDATES[7].name, verdict: 'rejected', reasonCode: 'private-access', reason: '', scores: {} }
    ] }));
    if (key === 'roads') return r.fulfill(llmBody({ roads: [
      { candidateName: CANDIDATES[0].name, routeName: ROUTE_NAMES[0], roadNames: ['Old River Rd'], geometryType: 'loop', surface: 'Paved', publicAccess: { status: 'probable', notes: '' }, closures: '', trafficExpectation: 'Low', pulloffs: '', adjacencyNotes: '', centerLat: 36.2, centerLng: -86.8, estimatedMiles: 6, exploratory: false, sourceUrls: [] }
    ], omitted: [] }));
    if (key === 'enrichment') return r.fulfill(llmBody(enrichmentResponse(user)));
    if (key === 'verification') return r.fulfill(llmBody({ reviews: [{ routeName: ROUTE_NAMES[0], verdict: 'keep', accessVerification: { status: 'probable', notes: '' }, speciesAdjustments: [], unresolvedQuestions: [], radiusCheck: { withinRadius: true, note: '' }, duplicateOf: '', notes: '' }] }));
    if (key === 'ranking') return r.fulfill(llmBody({ routes: [{ routeName: ROUTE_NAMES[0], scores: { biologicalPotential: 8, roadCruiseSuitability: 8, trafficSuitability: 8, habitatDiversity: 7, accessConfidence: 7, evidenceConfidence: 7 }, rationale: 'x' }], guideTitle: 'Nashville Wildlife Road Cruises', guideDescription: 'Test.' }));
    return r.fulfill({ status: 500, body: 'unexpected: ' + key });
  });
  await page.route('https://overpass-api.de/api/interpreter', r => r.fulfill(j({ elements: [
    { type: 'way', tags: { highway: 'secondary', name: 'Old River Rd' }, geometry: [{ lat: 36.2, lon: -86.8 }, { lat: 36.2, lon: -86.79 }] }
  ] })));

  await page.goto(PAGE_URL(), { waitUntil: 'domcontentloaded' });
  await page.fill('#apiKeyInput', 'sk-or-test');
  await page.locator('#locInput').fill('Nashville');
  await page.click('#btnInvestigate');

  await expect(page.locator('.stage[data-stage="geography"] .stage-status-label')).toHaveText('Needs Input', { timeout: 60000 });
  const question = page.locator('.stage[data-stage="geography"] .question-block');
  await expect(question).toBeVisible();
  await expect(question).toContainText('matches multiple places');
  await question.locator('.q-choice').first().click();
  await question.locator('.q-confirm').click();

  await expect(page.locator('#sessionPill')).toContainText('Guide ready', { timeout: 90000 });
  await expect(page.locator('#pvGuideHead')).toContainText('Nashville Wildlife Road Cruises');
});

test('mobile viewport has no horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/analytics/**', r => r.abort());
  await page.goto(PAGE_URL(), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.click('#tabbtn-preview');
  await page.waitForTimeout(400);
  const overflowPreview = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflowPreview).toBeLessThanOrEqual(1);
  await page.click('#tabbtn-data');
  const overflowData = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflowData).toBeLessThanOrEqual(1);
});
