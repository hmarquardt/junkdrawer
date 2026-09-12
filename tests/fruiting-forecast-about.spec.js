const { test, expect } = require('@playwright/test');
const path = require('path');
const manifest = require('../data/fruiting-forecast/manifest.json');
const url = `file://${path.resolve(process.cwd(), 'fruiting-forecast.html')}`;
test.use({ channel: 'chrome', viewport: { width: 1280, height: 850 } });
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
  await page.route('**/analytics-lite.js', r => r.fulfill({contentType:'application/javascript', body:''}));
  await page.route('https://unpkg.com/**', r => r.abort());
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

async function about(page) { await page.getByRole('tab', {name:'About', exact:true}).click(); }
function status(page, name) { return page.locator('#aboutAnalysisStatus .about-status > div').filter({has:page.locator('dt', {hasText:new RegExp('^'+name+'$')})}); }

test('About navigation preserves result, selected sector, map DOM and analysis identity', async ({ page }) => {
  const errors = await setup(page); await runAnalysis(page);
  await page.locator('.map-zone-fallback').last().click();
  await page.evaluate(() => { const s=window.__FRUITING_FORECAST_TEST__.getState(); window.__beforeAbout={analysis:s.analysis, json:JSON.stringify(s.analysis), zone:s.selectedZone, species:s.selectedSpecies, map:document.getElementById('map').firstChild, details:document.getElementById('detailContent').innerHTML}; });
  await about(page);
  await expect(page.locator('#aboutView')).toBeVisible(); await expect(page.locator('#forecastView')).toBeHidden();
  await page.getByRole('tab',{name:'Forecast',exact:true}).click();
  await expect(page.locator('#results')).toBeVisible(); await expect(page.locator('#map')).toBeVisible();
  expect(await page.evaluate(() => { const s=window.__FRUITING_FORECAST_TEST__.getState(), b=window.__beforeAbout; return s.analysis===b.analysis && JSON.stringify(s.analysis)===b.json && s.selectedZone===b.zone && s.selectedSpecies===b.species && document.getElementById('map').firstChild===b.map && document.getElementById('detailContent').innerHTML===b.details; })).toBe(true);
  expect(errors).toEqual([]);
});

test('keyboard tabs and editorial safety, score and dependency content', async ({ page }) => {
  const errors=await setup(page);
  await page.emulateMedia({colorScheme:'light'});
  await page.getByRole('tab',{name:'Forecast',exact:true}).focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab',{name:'About',exact:true})).toBeFocused();
  const view=page.locator('#aboutView');
  await page.screenshot({path:'/private/tmp/fruiting-about-desktop.png'});
  for(const copy of ['Biological Opportunity','Huntability','Recommended Hunt Score','OpenRouter is interpretation only. It is not part of the scoring engine.','It does not identify a specimen and never determines that a mushroom is safe to eat.','A mapped parking or access point is not a mushroom location.']) await expect(view).toContainText(copy);
  for(const copy of ['Open-Meteo','DuckDB-Wasm','iNaturalist','OpenRouter','IndexedDB','OPFS','Leaflet','Public lands','Collecting rules','Access points','Seasonal model']) await expect(view.locator('.about-matrix')).toContainText(copy);
  await expect(view).toContainText('Run a forecast to see which evidence layers are available');
  await page.keyboard.press('Home'); await expect(page.locator('#forecastView')).toBeVisible();
  expect(errors).toEqual([]);
});

test('loaded analysis status uses recorded evidence, counts and config without revealing keys', async ({ page }) => {
  const errors=await setup(page); await runAnalysis(page);
  await page.evaluate(m => {
    const s=window.__FRUITING_FORECAST_TEST__.getState();
    s.gis.manifest=m; s.gis.persistenceMode='opfs';
    s.analysis.zones.forEach(z => z.habitat={available:true});
    Object.assign(s.analysis.gis,{status:'enhanced',publicProperties:3,unknownRules:1,accessPointCount:7});
    // These session counts must not override the saved analysis.
    s.gis.propertyCount=999; s.gis.accessCount=888;
    s.prefs.openrouter={apiKey:'secret-about-fixture',model:'openai/gpt-4.1-mini'};
  }, manifest);
  await about(page);
  await expect(status(page,'Weather')).toContainText('✓ Available');
  await expect(status(page,'Observations')).toContainText('✓ Available');
  await expect(status(page,'Habitat GIS')).toContainText('✓ Available');
  await expect(status(page,'Public land')).toContainText('3 properties');
  await expect(status(page,'Collecting rules')).toContainText('1 unverified');
  await expect(status(page,'Access points')).toContainText('7 points');
  await expect(status(page,'GIS persistence')).toContainText('OPFS');
  await expect(status(page,'AI Analyst')).toContainText('Configured');
  await expect(page.locator('#aboutView')).not.toContainText('secret-about-fixture');
  await page.evaluate(() => window.__FRUITING_FORECAST_TEST__.getState().prefs.openrouter.apiKey='');
  await page.getByRole('tab',{name:'Forecast',exact:true}).click(); await about(page);
  await expect(status(page,'AI Analyst')).toContainText('Not configured');
  expect(errors).toEqual([]);
});

test('basic and partial evidence stay distinct from disabled overlays and zero reports', async ({ page }) => {
  const errors=await setup(page,{observationFailure:true}); await runAnalysis(page); await about(page);
  await expect(status(page,'Habitat GIS')).toContainText('Partial evidence · no habitat data retained; basic forecast remains usable');
  await expect(status(page,'Weather')).toContainText('Available');
  await expect(status(page,'Observations')).toContainText('Unavailable');
  await page.getByRole('tab',{name:'Forecast',exact:true}).click();
  await page.evaluate(() => {const s=window.__FRUITING_FORECAST_TEST__.getState();s.analysis.zones[0].habitat={available:true};s.analysis.observations={chanterelle:{available:true,total21:0}};s.showAccessPoints=false;});
  await about(page);
  await expect(status(page,'Habitat GIS')).toContainText('Partial');
  await expect(status(page,'Observations')).toContainText('Available · 1/1 species · no reports found');
  await expect(status(page,'Access-point overlay')).toContainText('Disabled · hidden');
  await expect(status(page,'Access points')).toContainText('No data found');
  expect(errors).toEqual([]);
});

test('manifest counts are derived from descriptors and handle partial resource publication', async ({ page }) => {
  const errors=await setup(page);
  await page.evaluate(m => window.__FRUITING_FORECAST_TEST__.getState().gis.manifest=m, manifest); await about(page);
  const coverage=page.locator('#aboutCoverageStatus');
  for(const [label,count] of [['Published habitat tiles',40],['Public-land tiles',21],['Access-point tiles',13]]) await expect(coverage.locator('dl > div').filter({hasText:label})).toContainText(String(count));
  await expect(coverage).toContainText('2026.09.01');
  await page.getByRole('tab',{name:'Forecast',exact:true}).click();
  await page.evaluate(() => window.__FRUITING_FORECAST_TEST__.getState().gis.manifest={datasetVersion:'fixture-v2',tiles:[{habitat:{url:'one.parquet'}},{id:'address-only'},{url:'legacy.parquet',publicLands:{url:'land.parquet'}}]});
  await about(page);
  await expect(coverage).toContainText('fixture-v2');
  await expect(coverage.locator('dl > div').filter({hasText:'Published habitat tiles'})).toContainText('2');
  await expect(coverage.locator('dl > div').filter({hasText:'Access-point tiles'})).toContainText('0');
  expect(errors).toEqual([]);
});

test('score scope remains separate across About navigation: overall 82 and selected 70', async ({ page }) => {
  const errors=await setup(page); await runAnalysis(page);
  await page.evaluate(() => {
    const s=window.__FRUITING_FORECAST_TEST__.getState(),a=s.analysis,sp=s.selectedSpecies;
    a.ranked.find(x=>x.speciesId===sp).score=82;
    s.selectedZone=a.zones[1].id; a.zones[1].scores.find(x=>x.speciesId===sp).score=70;
    window.__FRUITING_FORECAST_HUNTABILITY_TEST__.renderDetail();
  });
  await expect(page.locator('#detailContent .detail-score')).toContainText('70');
  await about(page); await expect(page.locator('#aboutScores')).toContainText('overall 82 and a selected-sector 70');
  await page.getByRole('tab',{name:'Forecast',exact:true}).click();
  await expect(page.locator('#detailContent .detail-score')).toContainText('70');
  expect(await page.evaluate(() => {const s=window.__FRUITING_FORECAST_TEST__.getState();return s.analysis.ranked.find(x=>x.speciesId===s.selectedSpecies).score;})).toBe(82);
  expect(errors).toEqual([]);
});

for(const theme of ['light','dark','system']) test(`About mobile 390 × 844: ${theme}, readable matrix and expandable failures`, async ({ page }) => {
  const errors=await setup(page); await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({colorScheme:'light'}); await page.selectOption('#themeSelect',theme); await about(page);
  await page.locator('#aboutFailures summary').filter({hasText:'OPFS unavailable'}).click();
  await expect(page.locator('#aboutFailures')).toContainText('transient DuckDB');
  expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const expected=theme==='dark'?'dark':'light';await expect(page.locator('html')).toHaveAttribute('data-theme',expected);
  if(theme==='light') { await page.screenshot({path:'/private/tmp/fruiting-about-mobile.png',fullPage:true}); await page.evaluate(()=>window.scrollTo(0,0)); await page.screenshot({path:'/private/tmp/fruiting-about-mobile-top.png'}); }
  expect(errors).toEqual([]);
});

test('hosted About loads only manifest metadata and reuses it without starting GIS', async ({ page }) => {
  const errors=await setup(page), requests=[];
  const html=require('fs').readFileSync(path.resolve('fruiting-forecast.html'),'utf8');
  await page.route('http://fruiting.test/**', r => {
    const u=new URL(r.request().url());requests.push(u.pathname);
    if(u.pathname.endsWith('/manifest.json')) return r.fulfill({contentType:'application/json',body:JSON.stringify(manifest)});
    if(u.pathname.endsWith('/fruiting-forecast.html')) return r.fulfill({contentType:'text/html',body:html});
    return r.fulfill({contentType:'application/javascript',body:''});
  });
  await page.goto('http://fruiting.test/fruiting-forecast.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__FRUITING_FORECAST_TEST__);
  await about(page); await expect(page.locator('#aboutCoverageStatus')).toContainText('2026.09.01');
  await page.getByRole('tab',{name:'Forecast',exact:true}).click(); await about(page);
  expect(requests.filter(x=>x.endsWith('/manifest.json'))).toHaveLength(1);
  expect(requests.some(x=>x.endsWith('.parquet'))).toBe(false);
  expect(await page.evaluate(()=>window.__FRUITING_FORECAST_TEST__.getState().gis.status)).toBe('idle');
  expect(errors).toEqual([]);
});
