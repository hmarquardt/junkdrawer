const { test, expect } = require('@playwright/test');
const path = require('path');

const url = `file://${path.resolve(process.cwd(), 'fruiting-forecast.html')}`;
test.use({ channel: 'chrome', viewport: { width: 1440, height: 900 } });

function weatherPayload(lat = 39.1653, lon = -86.5264) {
  const now = new Date(), day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dates = Array.from({ length: 38 }, (_, i) => new Date(day.getTime() + (i - 30) * 86400000).toISOString().slice(0, 10));
  const hours = Array.from({ length: 889 }, (_, i) => new Date(day.getTime() + (i - 720) * 3600000).toISOString().slice(0, 13) + ':00');
  return {
    latitude: lat, longitude: lon, elevation: 235, timezone: 'America/Indiana/Indianapolis',
    daily: { time: dates, precipitation_sum: dates.map((_, i) => i > 20 && i < 29 ? .18 : i === 29 ? .65 : 0), temperature_2m_max: dates.map(() => 78), temperature_2m_min: dates.map(() => 60), et0_fao_evapotranspiration: dates.map(() => .12) },
    hourly: { time: hours, temperature_2m: hours.map(() => 69), relative_humidity_2m: hours.map(() => 78), dew_point_2m: hours.map(() => 62), precipitation: hours.map(() => 0), soil_temperature_0cm: hours.map(() => 66), soil_moisture_0_to_1cm: hours.map(() => .29), vapour_pressure_deficit: hours.map(() => .65), wind_speed_10m: hours.map(() => 5) }
  };
}

const catalog = [
  { id: 'openai/gpt-4.1-mini', name: 'GPT-4.1 Mini', context_length: 1000000, pricing: { prompt: '.0000004', completion: '.0000016' }, supported_parameters: ['tools'], architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', context_length: 200000, pricing: { prompt: '.000003', completion: '.000015' }, supported_parameters: ['tools'], architecture: { input_modalities: ['text'], output_modalities: ['text'] } }
];

async function setup(page, options = {}) {
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED') && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
  await page.addInitScript(() => { window.__FF_TEST_FAST__ = true; });
  await page.route('**/api/analytics/**', route => route.abort());
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.route('https://api.open-meteo.com/v1/forecast**', async route => {
    const u = new URL(route.request().url()), lats = u.searchParams.get('latitude').split(',').map(Number), lons = u.searchParams.get('longitude').split(',').map(Number);
    const rows = lats.map((lat, i) => weatherPayload(lat, lons[i]));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows.length === 1 ? rows[0] : rows) });
  });
  await page.route('https://api.inaturalist.org/v1/observations**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total_results: 6, results: [{ observed_on: new Date().toISOString().slice(0, 10) }] }) }));
  await page.route('https://openrouter.ai/api/v1/models', route => options.modelFailure
    ? route.fulfill({ status: 503, body: '{}' })
    : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: catalog }) }));
  await page.route('https://openrouter.ai/api/v1/chat/completions', async route => {
    const body = route.request().postDataJSON(); requests.push(body);
    if (options.chatFailure) return route.fulfill({ status: 500, body: JSON.stringify({ error: { message: 'test failure' } }) });
    const reply = options.reply ? options.reply(body) : { content: '## Mission Summary\nChanterelles remain the immutable top-ranked target.', annotations: [] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'gen-test', model: body.model, choices: [{ message: { role: 'assistant', content: reply.content, annotations: reply.annotations || [] } }], usage: { prompt_tokens: 420, completion_tokens: 120, total_tokens: 540, cost: .0042 } }) });
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__FRUITING_FORECAST_TEST__);
  return { errors, requests };
}

async function runAnalysis(page) {
  await page.locator('#locationInput').fill('39.1653, -86.5264');
  await page.locator('#analyzeBtn').click();
  await expect(page.locator('#status')).toContainText('Analysis ready');
}

async function configure(page, key = 'sk-or-v1-super-secret-test-key') {
  await page.locator('#settingsBtn').click();
  await page.locator('#orApiKey').fill(key);
  await page.locator('#orSave').click();
  await expect(page.locator('#orModelStatus')).toContainText('models loaded');
  await page.locator('[data-close="settingsDialog"]').click();
}

async function deterministicSnapshot(page) {
  return page.evaluate(() => {
    const a = window.__FRUITING_FORECAST_TEST__.getState().analysis;
    return JSON.stringify({ ranked: a.ranked, zones: a.zones.map(z => ({ id: z.id, opportunity: z.opportunity, scores: z.scores })) });
  });
}

test('forecast is complete without OpenRouter and makes no hidden OpenRouter requests', async ({ page }) => {
  const { errors, requests } = await setup(page);
  await runAnalysis(page);
  await expect(page.locator('.analyst-module')).toBeVisible();
  await expect(page.locator('.analyst-module')).toContainText('not configured');
  expect(requests).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('configuration and grouped model selection persist without leaking the key', async ({ page }) => {
  const secret = 'sk-or-v1-super-secret-test-key';
  const { errors } = await setup(page);
  await configure(page, secret);
  await page.locator('#settingsBtn').click();
  await expect(page.locator('#orModel optgroup')).toHaveCount(2);
  await page.locator('#orModel').selectOption('anthropic/claude-sonnet-4');
  await expect(page.locator('#orModelMeta')).toContainText('200000 context');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__FRUITING_FORECAST_TEST__);
  await page.locator('#settingsBtn').click();
  await expect(page.locator('#orApiKey')).toHaveValue(secret);
  await expect(page.locator('#orModel')).toHaveValue('anthropic/claude-sonnet-4');
  await expect(page.locator('#diagnostics')).not.toContainText(secret);
  expect(await page.evaluate(() => window.__FRUITING_FORECAST_TEST__.redact('Bearer ' + 'sk-or-v1-super-secret-test-key'))).not.toContain(secret);
  expect(errors).toEqual([]);
});

test('catalog failure exposes a usable manual model fallback', async ({ page }) => {
  const { errors } = await setup(page, { modelFailure: true });
  await page.locator('#settingsBtn').click();
  await page.locator('#orApiKey').fill('sk-or-v1-test-key');
  await page.locator('#orSave').click();
  await expect(page.locator('#orModelStatus')).toContainText('catalog failed');
  await expect(page.locator('#orManualDetails')).toHaveAttribute('open', '');
  await page.locator('#orManualModel').fill('meta-llama/llama-test');
  await page.locator('#orUseManual').click();
  await expect(page.locator('#orModel')).toHaveValue('meta-llama/llama-test');
  expect(errors).toEqual([]);
});

test('Analyst Brief receives deterministic evidence and cannot mutate scores', async ({ page }) => {
  const { errors, requests } = await setup(page);
  await runAnalysis(page);
  const before = await deterministicSnapshot(page);
  await configure(page);
  await page.locator('[data-ai-action="brief"]').click();
  await expect(page.locator('.ai-output').first()).toContainText('immutable top-ranked target');
  const after = await deterministicSnapshot(page);
  expect(after).toBe(before);
  expect(requests).toHaveLength(1);
  expect(requests[0].messages[0].content).toContain('Treat them as immutable input data');
  expect(requests[0].messages[1].content).toContain('deterministicRankings');
  expect(requests[0].messages[1].content).toContain('scoringModelVersion');
  expect(await page.evaluate(() => window.__FRUITING_FORECAST_TEST__.dbAll('analyses').then(rows => Boolean(rows[0].intelligence.brief)))).toBe(true);
  expect(errors).toEqual([]);
});

test('failed LLM requests leave the active analysis untouched', async ({ page }) => {
  const { errors } = await setup(page, { chatFailure: true });
  await runAnalysis(page);
  const before = await deterministicSnapshot(page);
  await configure(page);
  await page.locator('[data-ai-action="brief"]').click();
  await expect(page.locator('#status')).toContainText('Analyst brief failed');
  expect(await deterministicSnapshot(page)).toBe(before);
  await expect(page.locator('#topBet')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Online Intelligence uses server tools, preserves source URLs, and keeps scores separate', async ({ page }) => {
  const source = 'https://example.org/indiana-chanterelle-report';
  const { errors, requests } = await setup(page, { reply: () => ({ content: `Online evidence: Supporting\n## Regional Signal\nRecent discussion supports fruiting [Example report](${source}).\n## Conflicts\nThis does not alter the deterministic score.`, annotations: [{ type: 'url_citation', url_citation: { url: source, title: 'Indiana chanterelle report', content: 'Dated field report.' } }] }) });
  await runAnalysis(page);
  const before = await deterministicSnapshot(page);
  await configure(page);
  await page.locator('[data-ai-action="research"]').click();
  await expect(page.locator(`a[href="${source}"]`).first()).toBeVisible();
  await expect(page.locator('.evidence-pair')).toContainText('Supporting');
  expect(requests[0].tools.map(t => t.type)).toEqual(['openrouter:web_search', 'openrouter:web_fetch']);
  expect(await deterministicSnapshot(page)).toBe(before);
  expect(errors).toEqual([]);
});

test('Ask About This Forecast is analysis-scoped and does not mutate rankings', async ({ page }) => {
  const { errors, requests } = await setup(page, { reply: () => ({ content: 'Medium confidence reflects missing habitat and access evidence.', annotations: [] }) });
  await runAnalysis(page);
  const before = await deterministicSnapshot(page);
  await configure(page);
  await page.locator('#forecastQuestion').fill('Why is confidence Medium?');
  await page.locator('[data-ai-action="ask"]').click();
  await expect(page.locator('.ai-output').last()).toContainText('missing habitat and access evidence');
  expect(requests[0].tools).toBeUndefined();
  expect(await deterministicSnapshot(page)).toBe(before);
  expect(await page.evaluate(() => window.__FRUITING_FORECAST_TEST__.getState().analysis.intelligence.qa.length)).toBe(1);
  const panel = await page.locator('#detailPanel').evaluate(el => ({ position: getComputedStyle(el).position, overflow: getComputedStyle(el).overflowY, client: el.clientHeight, scroll: el.scrollHeight }));
  expect(panel.position).toBe('sticky');
  expect(panel.overflow).toBe('auto');
  expect(panel.scroll).toBeGreaterThan(panel.client);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.analyst-module')).toBeVisible();
  expect(await page.locator('.workspace').evaluate(el => getComputedStyle(el).display)).toBe('block');
  expect(errors).toEqual([]);
});
