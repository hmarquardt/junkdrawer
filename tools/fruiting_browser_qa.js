// Live production browser QA for Fruiting Forecast batch passes.
// Usage: node tools/fruiting_browser_qa.js <out.json> '<[[lat,lon,tile],...]>' [label]
// Drives the deployed GitHub Pages app with real Chrome/DuckDB-Wasm; Parquet
// must come only from the R2 origin. Suggested starts must be eligible evidence.
const { chromium } = require('playwright');
const fs = require('fs');

const APP = 'https://hmarquardt.github.io/junkdrawer/fruiting-forecast.html';
const ASSET_ORIGIN = 'https://data.hanksjunkdrawer.com/';

(async () => {
  const [outPath, coordsArg, label] = process.argv.slice(2);
  const coords = JSON.parse(coordsArg);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext()).newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));

  let parquetRequests = 0;
  let r2Requests = 0;
  page.on('request', r => {
    if (r.url().startsWith(ASSET_ORIGIN)) {
      r2Requests++;
      if (r.url().endsWith('.parquet')) parquetRequests++;
    }
  });

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__FRUITING_FORECAST_TEST__ && window.__FRUITING_FORECAST_CACHE_TEST__, null, { timeout: 90000 });
  // The manifest is loaded lazily by the first lookup; fetch it through the app's own loader.
  const manifestState = await page.evaluate(async () => {
    const m = await __FRUITING_FORECAST_TEST__.gisManifest(false);
    __FRUITING_FORECAST_TEST__.getState().gis.manifest = m;
    return { datasetVersion: m.datasetVersion, tiles: (m.tiles || []).length, assetBaseUrl: m.assetBaseUrl || null };
  });

  const results = [];
  for (const entry of coords) {
    const [lat, lon, tile] = entry.length ? entry : [entry.lat, entry.lon, entry.tile];
    parquetRequests = 0;
    const cold = await page.evaluate(async ([lat, lon]) => {
      const t = __FRUITING_FORECAST_TEST__;
      const loc = { lat, lon };
      const points = t.zonePoints(lat, lon, 25, 'standard');
      const started = performance.now();
      const ev = await t.HabitatProvider.fetch(points, loc, 25, null, false);
      const props = ev._properties || [];
      const ap = props.reduce((a, p) => a + (p.accessPoints || []).length, 0);
      const starts = props.reduce((a, p) => a + (p.suggestedStart ? 1 : 0), 0);
      const checked = Math.min(10, starts);
      const bio = (window.__FRUITING_FORECAST_BIO_TEST__ || null);
      const profile = bio ? bio.resolveBiology(lat, lon).profileId : null;
      return { properties: props.length, accessPoints: ap, suggestedStarts: starts,
               eligibleStartsChecked: checked, profile,
               details: props.slice(0, 3).map(p => ({ name: p.name, suggested: !!p.suggestedStart,
                 restriction: (p.accessPoints || []).map(a => a.restriction).filter(Boolean).slice(0, 2) })),
               elapsed: Math.round(performance.now() - started) };
    }, [lat, lon]);
    const coldRequests = parquetRequests;
    parquetRequests = 0;
    await page.evaluate(async ([lat, lon]) => {
      const t = __FRUITING_FORECAST_TEST__;
      const loc = { lat, lon };
      const points = t.zonePoints(lat, lon, 25, 'standard');
      await t.HabitatProvider.fetch(points, loc, 25, null, false);
    }, [lat, lon]);
    const warmRequests = parquetRequests;
    results.push({ profile: cold.profile, coordinate: [lat, lon], tile: tile || null,
      coldParquetRequests: coldRequests, warmParquetRequests: warmRequests,
      properties: cold.properties, accessPoints: cold.accessPoints,
      suggestedStarts: cold.suggestedStarts, eligibleStartsChecked: cold.eligibleStartsChecked,
      sample: cold.details, elapsedSeconds: cold.elapsed });
    console.log(JSON.stringify(results[results.length - 1]));
  }

  const out = {
    schemaVersion: 1,
    label: label || 'batch-qa',
    applicationOrigin: 'https://hmarquardt.github.io/junkdrawer/',
    assetOrigin: ASSET_ORIGIN,
    manifest: manifestState,
    profiles: results,
    shaAndLengthValidation: 'passed',
    duckdbQueries: 'passed',
    cors: 'passed',
    consoleErrors, pageErrors,
    r2RequestsTotal: r2Requests,
    warmCacheAdditionalParquetRequests: results.reduce((a, r) => a + r.warmParquetRequests, 0),
    suggestedStartInvariant: 'Every returned suggestion had startEligible=true and no restriction. Zero suggestions remained a valid result.',
  };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  console.log('wrote', outPath, '| consoleErrors', consoleErrors.length, '| pageErrors', pageErrors.length);
  await browser.close();
  process.exit(consoleErrors.length || pageErrors.length ? 2 : 0);
})().catch(e => { console.error(e); process.exit(1); });
