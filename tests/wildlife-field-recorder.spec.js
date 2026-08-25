/* Wildlife Field Recorder — photo-import / EXIF / enrichment regression suite */
const { test, expect } = require('@playwright/test');
const path = require('path');

test.use({ channel: 'chrome', headless: true, actionTimeout: 45000, navigationTimeout: 45000 });

const PAGE_URL = `file://${path.resolve(process.cwd(), 'wildlife-field-recorder.html')}`;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

/* ---------- shared helpers ---------- */

function blockExternal(page) {
  // Single consolidated handler: stacked glob routes measurably delay request
  // interception on file:// pages, which makes mocked flows flaky.
  page.route(/openrouter\.ai|analytics|open-meteo\.com|nominatim\.openstreetmap\.org|api\.gbif\.org/, r => r.abort());
}

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|analytics/i.test(m.text())) errors.push(m.text()); });
  return errors;
}

async function openCaptureTab(page) {
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.click('nav#tabs button[data-tab="capture"]');
}

async function importPhoto(page, exifRaw) {
  return page.evaluate(async ({ pngB64, exif }) => {
    const T = window.__WFR_TEST__;
    if (exif !== undefined) {
      window.exifr.parse = async () => exif;
    }
    const bin = Uint8Array.from(atob(pngB64), c => c.charCodeAt(0));
    await T.importPhotoFile(new File([bin], 'test.png', { type: 'image/png' }));
    return true;
  }, { pngB64: PNG.toString('base64'), exif: exifRaw });
}

/** Wait until the first observation satisfies the predicate expressed as a JS
 *  expression string over `obs` (evaluated inside the page).
 *  NOTE: deliberately a manual poll loop — this Playwright version resolves
 *  waitForFunction immediately for async (Promise-returning) predicates
 *  regardless of the resolved value. */
async function dbWait(page, expr, timeout = 60000) {
  const start = Date.now();
  for (;;) {
    const ok = await page.evaluate(`(async () => {
      const T = window.__WFR_TEST__;
      if (!T) return false;
      const obs = (await T.db.observations.toArray())[0];
      return !!obs && (${expr})(obs);
    })()`);
    if (ok) return true;
    if (Date.now() - start > timeout) throw new Error(`dbWait timeout: ${expr}`);
    await page.waitForTimeout(200);
  }
}

async function getObs(page) {
  return page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    return (await T.db.observations.toArray())[0] || null;
  });
}

function fullDayTimes(dateKey) {
  return Array.from({ length: 24 }, (_, h) => `${dateKey}T${String(h).padStart(2, '0')}:00`);
}

function meteoBody(dateKey, times) {
  const n = times.length;
  const mk = v => Array(n).fill(v);
  return {
    latitude: 38.355, longitude: -87.5381, elevation: 140,
    timezone: 'America/Chicago', timezone_abbreviation: 'CDT', utc_offset_seconds: -18000,
    hourly: {
      time: times,
      temperature_2m: times.map((_, i) => 70 + i * 0.1),
      apparent_temperature: mk(72), relative_humidity_2m: mk(60), dew_point_2m: mk(55),
      precipitation: mk(0), rain: mk(0), snowfall: mk(0), cloud_cover: mk(25),
      surface_pressure: mk(1010), pressure_msl: mk(1015),
      wind_speed_10m: mk(5), wind_gusts_10m: mk(9),
      wind_direction_10m: mk(180), weather_code: mk(2)
    }
  };
}

/** Mock Open-Meteo (overrides the earlier abort route; later routes win). */
async function mockMeteo(page) {
  const state = { mode: 'ok', times: null };
  state.calls = [];
  state.handler = async route => {
    const url = new URL(route.request().url());
    state.calls.push(url.searchParams.get('start_date'));
    if (state.mode === 'fail') return route.abort();
    const dateKey = url.searchParams.get('start_date') || '2026-05-14';
    const times = state.times || fullDayTimes(dateKey);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(meteoBody(dateKey, times)) });
  };
  await page.route('**open-meteo.com**', route => state.handler(route));
  return state;
}

const VISION_JSON = {
  subject_type: 'bird',
  common_name: 'Red-tailed Hawk',
  scientific_name: 'Buteo jamaicensis',
  taxonomic_rank: 'species',
  confidence: 0.92,
  alternatives: [],
  visible_traits: ['red tail'],
  life_stage: 'adult',
  sex: 'unknown',
  count: 1,
  behavior: 'soaring',
  notes: null
};

/** Mock the vision chat/completions endpoint. Returns state with captured
 *  request payloads and a release() gate for deferred responses. */
async function mockVision(page, { defer = false } = {}) {
  const state = { calls: [], released: !defer, release: () => {} };
  if (defer) state.released = new Promise(res => { state.release = res; });
  await page.route('**/chat/completions', async route => {
    state.calls.push(route.request().postDataJSON());
    if (defer) await state.released;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(VISION_JSON) } }] })
    });
  });
  return state;
}

async function mockGbif(page) {
  const state = { mode: 'exact', calls: [] };
  await page.route('**api.gbif.org**', async route => {
    state.calls.push(route.request().url());
    if (state.mode === 'fail') return route.abort();
    const base = {
      usageKey: 2480583,
      confidence: 98,
      kingdom: 'Animalia', phylum: 'Chordata', class: 'Aves',
      order: 'Accipitriformes', family: 'Accipitridae', genus: 'Buteo',
      species: 'Primary species',
      scientificName: 'Primary species',
      alternatives: [{ usageKey: 999, scientificName: 'Wrong alternative', kingdom: 'Animalia', genus: 'Wrong', species: 'Wrong alternative' }]
    };
    if (state.mode === 'fuzzy') base.matchType = 'FUZZY';
    else base.matchType = 'EXACT';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(base) });
  });
  return state;
}

const FULL_EXIF = {
  Make: 'TestCam', Model: 'Mk100', FocalLength: 400, ISO: 200,
  DateTimeOriginal: '2026:05:14 17:42:00',
  OffsetTimeOriginal: '-04:00',
  OffsetTime: '-04:00',
  latitude: 38.355, longitude: -87.5381, GPSAltitude: 150, GPSImgDirection: 90
};

/* ---------- original smoke tests (preserved) ---------- */

test('page loads with photo-import UI and no camera', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errors.push(m.text()); });
  blockExternal(page);
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.click('nav#tabs button[data-tab="capture"]');
  await expect(page.locator('#capture-btn')).toBeVisible();
  await expect(page.locator('#import-photo-btn')).toBeVisible();
  expect(await page.locator('#camera-overlay, #camera-capture-btn, #camera-video').count()).toBe(0);
  expect(errors.filter(e => !/analytics/i.test(e))).toEqual([]);
});

test('import photo with EXIF uses EXIF capture time and GPS, saves ready', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await openCaptureTab(page);

  const res = await page.evaluate(async (pngB64) => {
    const T = window.__WFR_TEST__;
    window.exifr.parse = async () => ({
      Make: 'TestCam', Model: 'Mk100', FocalLength: 400, ISO: 200,
      DateTimeOriginal: '2026:05:14 17:42:00', OffsetTime: '-04:00',
      latitude: 38.3550, longitude: -87.5381, GPSAltitude: 150, GPSImgDirection: 90
    });
    const bin = Uint8Array.from(atob(pngB64), c => c.charCodeAt(0));
    await T.importPhotoFile(new File([bin], 'test.png', { type: 'image/png' }));
    await new Promise(r => setTimeout(r, 500));
    const obs = (await T.db.observations.toArray())[0];
    const epoch = Date.parse('2026-05-14T21:42:00.000Z');
    const statuses = document.getElementById('import-status-list').innerText;
    document.getElementById('imp-save').click();
    await new Promise(r => setTimeout(r, 300));
    const saved = (await T.db.observations.toArray())[0];
    return {
      count: await T.db.observations.count(),
      lat: obs.latitude, lng: obs.longitude,
      createdAtIsExif: obs.createdAt === epoch,
      createdAtStillExifAfterSave: saved.createdAt === epoch,
      source: obs.observationSource,
      timeProvenance: obs.timeProvenance && obs.timeProvenance.source,
      statuses,
      submitStatus: saved.submitStatus
    };
  }, PNG.toString('base64'));

  expect(res.count).toBe(1);
  expect(res.lat).toBe(38.355);
  expect(res.lng).toBe(-87.5381);
  expect(res.createdAtIsExif).toBe(true);
  expect(res.createdAtStillExifAfterSave).toBe(true);
  expect(res.source).toBe('photo_import');
  expect(res.timeProvenance).toBe('exif_DateTimeOriginal');
  expect(res.statuses).toContain('WEATHER');
  expect(res.submitStatus).toBe('ready');
  expect(errors).toEqual([]);
});

test('import photo with no EXIF: no location/time substitution, still saved', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await openCaptureTab(page);

  const res = await page.evaluate(async (pngB64) => {
    const T = window.__WFR_TEST__;
    window.exifr.parse = async () => ({});
    const bin = Uint8Array.from(atob(pngB64), c => c.charCodeAt(0));
    await T.importPhotoFile(new File([bin], 'plain.png', { type: 'image/png' }));
    await new Promise(r => setTimeout(r, 400));
    const obs = (await T.db.observations.toArray())[0];
    return {
      lat: obs.latitude, lng: obs.longitude,
      timeSource: obs.timeProvenance && obs.timeProvenance.source,
      weatherStatus: obs.weatherStatus,
      count: await T.db.observations.count()
    };
  }, PNG.toString('base64'));

  expect(res.count).toBe(1);
  expect(res.lat).toBeNull();
  expect(res.lng).toBeNull();
  expect(res.timeSource).toBe('unknown');
  expect(res.weatherStatus).not.toBe('ok');
  expect(errors).toEqual([]);
});

/* ---------- A. Realistic EXIF Date object (revived values) ---------- */

test('A: EXIF timestamps revived as JS Date objects still parse to correct wall time', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await openCaptureTab(page);

  // Real exifr with reviveValues:true hands back Date instances. The wall-clock
  // getters must recover 17:42 local wall time regardless of host timezone.
  const dateObjExif = {
    ...FULL_EXIF,
    DateTimeOriginal: new Date(2026, 4, 14, 17, 42, 0)
  };

  await importPhoto(page, dateObjExif);
  await dbWait(page, o => o.timeProvenance && o.timeProvenance.wallIso === '2026-05-14T17:42:00');

  const obs = await getObs(page);
  const epoch = Date.parse('2026-05-14T21:42:00.000Z'); // 17:42 -04:00
  expect(obs.createdAt).toBe(epoch);
  expect(obs.startedAt).toBe(epoch);
  expect(obs.timeProvenance.utcIso).toBe('2026-05-14T21:42:00.000Z');
  expect(obs.timeProvenance.utcOffsetSeconds).toBe(-14400);
  expect(errors).toEqual([]);
});

/* ---------- B. Weather successful nearest-hour selection ---------- */

test('B: weather picks nearest hour with numeric differenceMinutes (no NaN)', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  const meteo = await mockMeteo(page);   // registered after blocker -> wins
  meteo.times = ['2026-05-14T17:00', '2026-05-14T18:00', '2026-05-14T19:00'];
  await openCaptureTab(page);

  await importPhoto(page, FULL_EXIF);
  await dbWait(page, o => o.photoEnrichment.weather === 'done');

  const obs = await getObs(page);
  expect(obs.weatherStatus).toBe('ok');
  expect(obs.weatherRaw.status).toBe('ok');
  expect(obs.weatherRaw.sourceTimeLocal).toBe('2026-05-14T18:00'); // 17:42 -> nearest is 18:00
  expect(Number.isFinite(obs.weatherRaw.differenceMinutes)).toBe(true);
  expect(obs.weatherRaw.differenceMinutes).toBe(18);
  expect(String(obs.weatherRaw.differenceMinutes)).not.toContain('NaN');
  expect(meteo.calls.length).toBeGreaterThanOrEqual(1);
  expect(meteo.calls[0]).toBe('2026-05-14');
  expect(errors).toEqual([]);
});

/* ---------- C. Vision request carries a complete data URL ---------- */

test('C: vision request sends data:image/jpeg;base64 data URL', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockMeteo(page);
  await mockGbif(page);
  const vision = await mockVision(page);
  await openCaptureTab(page);

  await page.evaluate(() => { window.__WFR_TEST__.settings.llmKey = 'test-key'; });

  await importPhoto(page, FULL_EXIF);
  await dbWait(page, o => o.classificationStatus === 'done');

  expect(vision.calls.length).toBeGreaterThanOrEqual(1);
  const content = vision.calls[0].messages[0].content;
  const imagePart = Array.isArray(content) ? content.find(c => c.type === 'image_url') : null;
  expect(imagePart).toBeTruthy();
  expect(imagePart.image_url.url).toMatch(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/);
  expect(errors).toEqual([]);
});

/* ---------- D. Async AI hydration survives Save ---------- */

test('D: late AI result fills blank fields and survives Save untouched', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockMeteo(page);
  await mockGbif(page);
  const vision = await mockVision(page, { defer: true });
  await openCaptureTab(page);

  await page.evaluate(() => { window.__WFR_TEST__.settings.llmKey = 'test-key'; });
  await importPhoto(page, FULL_EXIF);

  // Review overlay is open and fields are blank while AI is pending.
  await expect(page.locator('#import-overlay')).toBeVisible();
  await expect(page.locator('#imp-common')).toHaveValue('');
  await expect(page.locator('#imp-sci')).toHaveValue('');

  vision.release();
  await page.waitForFunction(() => document.getElementById('imp-common') &&
    document.getElementById('imp-common').value === 'Red-tailed Hawk', undefined, { timeout: 10000 });

  // User does NOT edit the species; Save must persist the hydrated AI values.
  await page.click('#imp-save');
  await expect(page.locator('#import-overlay')).not.toBeVisible();
  await dbWait(page, o => o.submitStatus === 'ready');

  const obs = await getObs(page);
  expect(obs.subjectCommonName).toBe('Red-tailed Hawk');
  expect(obs.subjectScientificName).toBe('Buteo jamaicensis');
  expect(errors).toEqual([]);
});

/* ---------- E. User edit wins over late AI ---------- */

test("E: user-entered species wins over later AI response", async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockMeteo(page);
  await mockGbif(page);
  const vision = await mockVision(page, { defer: true });
  await openCaptureTab(page);

  await page.evaluate(() => { window.__WFR_TEST__.settings.llmKey = 'test-key'; });
  await importPhoto(page, FULL_EXIF);
  await expect(page.locator('#import-overlay')).toBeVisible();

  await page.fill('#imp-common', "Cooper's Hawk");
  await page.fill('#imp-sci', 'Accipiter cooperii');

  vision.release();
  await dbWait(page, o => o.classificationStatus === 'done');
  // Hydration must not overwrite user-edited inputs.
  await expect(page.locator('#imp-common')).toHaveValue("Cooper's Hawk");

  // Save is an async handler; wait until its write lands before asserting.
  await page.click('#imp-save');
  await dbWait(page, o => o.submitStatus === 'ready' &&
    o.subjectCommonName === "Cooper's Hawk" && o.subjectScientificName === 'Accipiter cooperii');
  const obs = await getObs(page);
  expect(obs.subjectCommonName).toBe("Cooper's Hawk");
  expect(obs.subjectScientificName).toBe('Accipiter cooperii');
  expect(errors).toEqual([]);
});

/* ---------- F. EXIF time survives review Save ---------- */

test('F: unedited EXIF datetime survives opening review + Save byte-for-byte', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockMeteo(page);
  await mockGbif(page);
  await openCaptureTab(page);

  await importPhoto(page, FULL_EXIF);
  await dbWait(page, o => o.photoEnrichment.weather === 'done');

  const before = await getObs(page);
  const epoch = Date.parse('2026-05-14T21:42:00.000Z');
  expect(before.createdAt).toBe(epoch);

  // The form shows the EXIF wall clock (17:42 -04:00), not offset-shifted UTC.
  await expect(page.locator('#imp-datetime')).toHaveValue('2026-05-14T17:42');

  await page.click('#imp-save');
  await expect(page.locator('#import-overlay')).not.toBeVisible();

  const after = await getObs(page);
  expect(after.createdAt).toBe(before.createdAt);
  expect(after.startedAt).toBe(before.startedAt);
  expect(after.timeProvenance.source).toBe('exif_DateTimeOriginal');
  expect(after.timeProvenance.wallIso).toBe('2026-05-14T17:42:00');
  expect(errors).toEqual([]);
});

/* ---------- G. Manual missing-time recovery ---------- */

test('G: manually supplied time creates full provenance and enables weather', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  const meteo = await mockMeteo(page);
  await openCaptureTab(page);

  // GPS but NO timestamp in EXIF.
  await importPhoto(page, { latitude: 38.355, longitude: -87.5381 });
  await expect(page.locator('#import-overlay')).toBeVisible();

  const before = await getObs(page);
  expect(before.timeProvenance.source).toBe('unknown');
  expect(before.timeProvenance.wallIso).toBeUndefined();

  await page.fill('#imp-datetime', '2026-05-14T17:42');
  await page.click('#imp-retry-all');

  await dbWait(page, o => o.photoEnrichment.weather === 'done');

  const obs = await getObs(page);
  const tp = obs.timeProvenance;
  expect(tp.source).toBe('user_provided');
  expect(tp.wallIso).toBe('2026-05-14T17:42:00');
  expect(tp.localIso).toMatch(/^2026-05-14T17:42:00/);
  expect(tp.utcIso).toBeTruthy();
  expect(typeof tp.utcOffsetSeconds).toBe('number');
  expect(tp.timezoneConfidence).toBeTruthy();
  expect(Date.parse(tp.utcIso)).toBe(obs.createdAt);

  // Weather actually ran against the manually entered date.
  expect(meteo.calls.length).toBeGreaterThanOrEqual(1);
  expect(meteo.calls).toContain('2026-05-14');
  expect(obs.weatherStatus).toBe('ok');
  expect(obs.weatherApiUrl).toContain('start_date=2026-05-14');
  expect(errors).toEqual([]);
});

/* ---------- H. Edited timestamp makes weather stale + rerun ---------- */

test('H: editing observation time reruns weather against the new timestamp', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  const meteo = await mockMeteo(page);
  await openCaptureTab(page);

  await importPhoto(page, FULL_EXIF);
  await dbWait(page, o => o.photoEnrichment.weather === 'done');

  const first = await getObs(page);
  expect(first.weatherApiUrl).toContain('start_date=2026-05-14');
  const firstFetchAt = first.weatherFetchedAt;

  await page.fill('#imp-datetime', '2026-06-20T10:30');
  await page.click('#imp-retry-all');

  await dbWait(page, o => o.photoEnrichment.weather === 'done' &&
    o.weatherApiUrl && o.weatherApiUrl.includes('2026-06-20'));

  const edited = await getObs(page);
  const tp = edited.timeProvenance;
  expect(tp.wallIso).toBe('2026-06-20T10:30:00');
  // Previously established EXIF offset (-04:00) is retained for the edit.
  expect(tp.utcOffsetSeconds).toBe(-14400);
  expect(tp.utcIso).toBe('2026-06-20T14:30:00.000Z');
  expect(edited.createdAt).toBe(Date.parse('2026-06-20T14:30:00.000Z'));
  expect(edited.startedAt).toBe(edited.createdAt);
  // Old weather was dropped, not silently retained.
  expect(edited.weatherApiUrl).toContain('start_date=2026-06-20');
  expect(edited.weatherRaw.sourceTimeLocal).toContain('2026-06-20');
  expect(Number.isFinite(edited.weatherRaw.differenceMinutes)).toBe(true);
  expect(edited.weatherFetchedAt).toBeGreaterThanOrEqual(firstFetchAt);
  expect(meteo.calls.filter(d => d === '2026-06-20').length).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
});

/* ---------- I. GBIF primary match wins over alternatives ---------- */

test('I: GBIF top-level exact match is used, alternatives are informational only', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockGbif(page);
  await openCaptureTab(page);

  const res = await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    const ok = await T.normalizeTaxonomy('Some species');
    return ok;
  });

  expect(res.status).toBe('ok');
  expect(res.scientificName).toBe('Primary species');           // primary, not alternatives[0]
  expect(res.species).toBe('Primary species');
  expect(res.alternativeNames).toContain('Wrong alternative');  // kept informational
  expect(errors).toEqual([]);
});

test('I2: ambiguous GBIF matches do not silently substitute an alternative', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  const gbif = await mockGbif(page);
  gbif.mode = 'fuzzy';
  await openCaptureTab(page);

  const res = await page.evaluate(async () => window.__WFR_TEST__.normalizeTaxonomy('Ambiguous name'));
  expect(res.status).toBe('ambiguous');
  expect(res.matchType).toBe('FUZZY');
  expect(res.scientificName).not.toBe('Wrong alternative');
  expect(res.alternatives.map(a => a.scientificName)).toContain('Wrong alternative');
  expect(errors).toEqual([]);
});

/* ---------- J. Retry buttons work after async failure ---------- */

test('J: weather retry button reruns a failed request via delegated handler', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  const meteo = await mockMeteo(page);
  meteo.mode = 'fail';
  await openCaptureTab(page);

  await importPhoto(page, FULL_EXIF);
  await dbWait(page, o => o.photoEnrichment.weather === 'error');

  let obs = await getObs(page);
  expect(obs.weatherStatus).toBe('error');

  // Retry button rendered asynchronously by renderImportReviewStatuses.
  const retryBtn = page.locator('#import-status-list button[data-retry="WEATHER"]');
  await expect(retryBtn).toBeVisible();

  meteo.mode = 'ok';
  await retryBtn.click();
  await dbWait(page, o => o.photoEnrichment.weather === 'done');

  obs = await getObs(page);
  expect(obs.weatherStatus).toBe('ok');
  expect(meteo.calls.length).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});

/* ---------- K. Taxonomy retry works independently of vision ---------- */

test('K: taxonomy retries without re-running vision classification', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockMeteo(page);
  const gbif = await mockGbif(page);
  gbif.mode = 'fail';
  const vision = await mockVision(page);
  await openCaptureTab(page);

  await page.evaluate(() => { window.__WFR_TEST__.settings.llmKey = 'test-key'; });
  await importPhoto(page, FULL_EXIF);

  await dbWait(page, o => o.photoEnrichment.identification === 'done' && o.photoEnrichment.taxonomy === 'error');
  expect(vision.calls.length).toBeLessThanOrEqual(1);

  gbif.mode = 'exact';
  const retryBtn = page.locator('#import-status-list button[data-retry="TAXONOMY"]');
  await expect(retryBtn).toBeVisible();
  await retryBtn.click();

  await dbWait(page, o => o.photoEnrichment.taxonomy === 'done');

  const obs = await getObs(page);
  expect(obs.taxonomy.status).toBe('ok');
  expect(obs.taxonomy.scientificName).toBe('Primary species');
  // Vision was NOT re-run to accomplish the taxonomy retry.
  expect(vision.calls.length).toBe(1);
  expect(errors).toEqual([]);
});

/* ---------- L. Coordinate zero handling ---------- */

test('L: zero latitude/longitude are valid coordinates for weather', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  const meteo = await mockMeteo(page);
  await openCaptureTab(page);

  const res = await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    const ct = { wallIso: '2026-05-14T12:00:00', utcOffsetSeconds: 0, timezoneConfidence: 'high' };
    const latZero = await T.enrichWeatherAt(0, -90.125, ct);
    const lngZero = await T.enrichWeatherAt(-12.5, 0, ct);
    const normZeroLat = T.normalizeExif({ latitude: 0, longitude: -90.125, GPSLatitude: [0, 0, 0], GPSLatitudeRef: 'N', GPSLongitude: [90, 7, 30], GPSLongitudeRef: 'W' });
    return {
      latZeroStatus: latZero.status,
      latZeroDiff: latZero.differenceMinutes,
      lngZeroStatus: lngZero.status,
      gpsFromZeroLat: normZeroLat.gps ? normZeroLat.gps.lat : null
    };
  });

  expect(res.latZeroStatus).toBe('ok');
  expect(Number.isFinite(res.latZeroDiff)).toBe(true);
  expect(res.lngZeroStatus).toBe('ok');
  expect(res.gpsFromZeroLat).toBe(0);
  expect(meteo.calls.length).toBe(2);
  expect(errors).toEqual([]);
});

/* ---------- M. Compass direction table ---------- */

test('M: 16-point compass directions are deterministic and include S', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await openCaptureTab(page);

  const res = await page.evaluate(() => {
    const c = window.__WFR_TEST__.compassDirection;
    return {
      n: c(0), e: c(90), s: c(180), w: c(270), nnw: c(337.5),
      nne: c(11.25), sse: c(157.5), wrap359: c(359), negWrap: c(-90),
      invalid: c(null), nan: c('abc')
    };
  });

  expect(res.n).toBe('N');
  expect(res.e).toBe('E');
  expect(res.s).toBe('S');
  expect(res.w).toBe('W');
  expect(res.nnw).toBe('NNW');
  expect(res.nne).toBe('NNE');
  expect(res.sse).toBe('SSE');
  expect(res.wrap359).toBe('N');
  expect(res.negWrap).toBe('W');
  expect(res.invalid).toBeNull();
  expect(res.nan).toBeNull();
  expect(errors).toEqual([]);
});

/* ---------- N. Backend contract regression ---------- */

test('N: voice + photo observations submit the existing backend payload shape', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockMeteo(page);
  await openCaptureTab(page);

  const submissions = [];
  await page.route('**/wildlife-field-recorder/observations', async route => {
    submissions.push({ kind: 'observation', body: route.request().postDataJSON(), method: route.request().method() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'be-obs-' + submissions.length }) });
  });
  await page.route('**/observations/*/files', async route => {
    submissions.push({ kind: 'file', method: route.request().method() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'be-file-' + submissions.length }) });
  });

  const res = await page.evaluate(async (pngB64) => {
    const T = window.__WFR_TEST__;
    T.settings.token = 'test-token';

    // Voice-shaped observation (as produced post-capture).
    const now = Date.now();
    await T.db.observations.put({
      localId: 'obs-voice-test', createdAt: now, startedAt: now - 5000, stoppedAt: now,
      durationSeconds: 5, latitude: 38.3, longitude: -87.5, accuracyMeters: 12,
      altitude: null, heading: null, speed: null, gpsStatus: 'ok',
      weatherStatus: 'skipped', weatherApiUrl: null, weatherFetchedAt: null, weatherRaw: null,
      audioBlobId: null, audioMimeType: null, audioSizeBytes: 0,
      userNoteText: 'cardinal by the fence', transcriptionStatus: 'not_applicable', transcript: null,
      classificationStatus: 'done', subjectCommonName: 'Northern Cardinal',
      subjectScientificName: 'Cardinalis cardinalis', subjectConfidence: 0.8,
      category: 'bird', categoryConfidence: 0.8, tags: [], behavior: null, habitat: null,
      count: 1, summary: '', llmRaw: '', tripLocalId: null, backendObservationId: null,
      backendFileIds: [], photoFileIds: [], photoLocalIds: [],
      submitStatus: 'ready', submitError: null, updatedAt: now
    });
    const voice = await T.db.observations.get('obs-voice-test');
    await T.submitObservation(voice);

    // Photo-imported observation.
    window.exifr.parse = async () => ({
      DateTimeOriginal: '2026:05:14 17:42:00', OffsetTimeOriginal: '-04:00',
      latitude: 38.355, longitude: -87.5381
    });
    const bin = Uint8Array.from(atob(pngB64), c => c.charCodeAt(0));
    await T.importPhotoFile(new File([bin], 'contract.png', { type: 'image/png' }));
    const findPhoto = () => T.db.observations.toArray().then(rows => rows.find(o => o.localId !== 'obs-voice-test'));
    const waitFor = async (pred, what) => {
      for (let i = 0; i < 100; i++) {
        const p = await findPhoto();
        if (p && pred(p)) return p;
        await new Promise(r => setTimeout(r, 100));
      }
      throw new Error('photo observation never ' + what);
    };
    await waitFor(() => true, 'created');
    document.getElementById('imp-save').click();
    await waitFor(p => p.submitStatus === 'ready', 'ready');
    const photo = (await T.db.observations.toArray()).find(o => o.localId !== 'obs-voice-test');
    await T.submitObservation(photo);
    return { submitted: true };
  }, PNG.toString('base64'));

  expect(res.submitted).toBe(true);

  const obsPosts = submissions.filter(s => s.kind === 'observation' && s.method === 'POST');
  expect(obsPosts.length).toBe(2);

  const EXPECTED_KEYS = [
    'localId', 'tripLocalId', 'backendTripId', 'createdAt', 'startedAt', 'stoppedAt',
    'durationSeconds', 'latitude', 'longitude', 'accuracyMeters', 'altitude', 'heading',
    'speed', 'gpsStatus', 'weatherStatus', 'weatherFetchedAt', 'weatherRaw', 'transcript',
    'subjectCommonName', 'subjectScientificName', 'subjectConfidence', 'category',
    'categoryConfidence', 'behavior', 'habitat', 'count', 'tags', 'summary', 'userNoteText',
    'llmRaw', 'photoCount', 'appVersion'
  ];
  const FORBIDDEN_KEYS = ['observationSource', 'exif', 'taxonomy', 'timeProvenance', 'aiIdentification', 'photoEnrichment'];

  // Payload must not introduce keys outside the existing contract, must never
  // include frontend-only internals, and must carry the core fields.
  const REQUIRED_KEYS = ['localId', 'createdAt', 'startedAt', 'latitude', 'longitude', 'gpsStatus',
    'weatherStatus', 'subjectCommonName', 'subjectScientificName', 'category', 'tags',
    'userNoteText', 'photoCount', 'appVersion'];
  for (const post of obsPosts) {
    expect(post.body.data.appVersion).toBe('2026.08.25.2');
    for (const key of Object.keys(post.body.data)) {
      expect(EXPECTED_KEYS).toContain(key);
    }
    for (const required of REQUIRED_KEYS) {
      expect(post.body.data).toHaveProperty(required);
    }
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(post.body.data).not.toHaveProperty(forbidden);
    }
  }
  const bylocalId = Object.fromEntries(obsPosts.map(p => [p.body.data.localId, p.body.data]));
  const voicePayload = bylocalId['obs-voice-test'];
  const photoPayload = obsPosts.map(p => p.body.data).find(p => p.localId !== 'obs-voice-test');
  expect(voicePayload.subjectCommonName).toBe('Northern Cardinal');
  expect(photoPayload.photoCount).toBe(1);
  expect(photoPayload.createdAt).toBe(Date.parse('2026-05-14T21:42:00.000Z'));
  expect(errors).toEqual([]);
});

/* ---------- Voice Observation smoke: recorder error path stays graceful ---------- */

test('voice capture button handles denied microphone gracefully', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await openCaptureTab(page);

  await page.click('#capture-btn');
  // Headless Chrome denies getUserMedia; startCapture must catch and reset state.
  await page.waitForFunction(() =>
    document.getElementById('capture-status') &&
    /Audio error/i.test(document.getElementById('capture-status').textContent),
    undefined, { timeout: 10000 });

  await expect(page.locator('#capture-btn')).not.toHaveClass(/recording/);
  const queue = await page.textContent('#queue-chip');
  expect(queue).toBe('Queue 0');
  expect(errors).toEqual([]);
});

/* ========================
   OpenRouter-only LLM setup + provider-grouped model pickers
   ======================== */

const OR_MODELS_URL = '**openrouter.ai/api/v1/models**';

function catalogPayload() {
  const mk = (id, name, input, output) => ({
    id, name,
    architecture: { input_modalities: input, output_modalities: output },
    pricing: { prompt: '0.0000001', completion: '0.0000004' }
  });
  return { data: [
    mk('openai/gpt-4.1-mini', 'OpenAI: GPT-4.1 Mini', ['text', 'image'], ['text']),
    mk('openai/gpt-4.1', 'OpenAI: GPT-4.1', ['text'], ['text']),
    mk('openai/omni-moderation-latest', 'OpenAI: Omni Moderation', ['text'], ['text']),
    mk('anthropic/claude-sonnet-4', 'Anthropic: Claude Sonnet 4', ['text', 'image'], ['text']),
    mk('google/gemini-2.5-flash', 'Google: Gemini 2.5 Flash', ['text', 'image', 'audio'], ['text']),
    mk('google/gemini-2.5-flash-lite', 'Google: Gemini 2.5 Flash Lite', ['text', 'audio'], ['text']),
    mk('deepseek/deepseek-chat-v4', 'DeepSeek: DeepSeek Chat V4', ['text'], ['text']),
    mk('mistralai/mistral-medium-3', 'Mistral AI: Mistral Medium 3', ['text'], ['text']),
    mk('openai/text-embedding-3-large', 'OpenAI: Text Embedding 3 Large', ['text'], []),
    mk('openai/dall-e-3', 'OpenAI: DALL-E 3', ['text'], ['image'])
  ]};
}

/** Seed localStorage settings before any page script runs. Merges with any
 *  already-stored settings so a reload does not wipe the app's own saves. */
function seedSettings(context, overrides = {}, catalog = null) {
  context.addInitScript(({ overrides, catalog }) => {
    let existing = {};
    try { existing = JSON.parse(localStorage.getItem('wfr_settings') || '{}'); } catch(e) {}
    localStorage.setItem('wfr_settings', JSON.stringify({ llmKey: 'sk-or-test', ...existing, ...overrides }));
    if (catalog) {
      localStorage.setItem('wfr_openrouter_catalog', JSON.stringify({ fetchedAt: Date.now(), models: catalog }));
    }
  }, { overrides, catalog });
}

async function mockCatalog(page, payload = catalogPayload()) {
  await page.route(OR_MODELS_URL, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }));
}

async function selectValues(page, id) {
  return page.evaluate(id => Array.from(document.getElementById(id).options).map(o => o.value), id);
}
async function selectedValue(page, id) {
  return page.evaluate(id => document.getElementById(id).value, id);
}

/** Wait until the OpenRouter model catalog has been rendered into the selects
 *  (cache, fallback, or live). */
async function dbWaitQuiet(page, timeout = 15000) {
  await page.waitForFunction(`(() => {
    const el = document.getElementById('or-catalog-status');
    const opts = document.getElementById('cfg-text-model');
    return !!el && !!opts && opts.options.length > 0 && el.textContent.length > 0;
  })()`, undefined, { timeout });
}

test('OR-A/B: generic provider UI removed; exactly one OpenRouter key field', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockCatalog(page);
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.click('nav#tabs button[data-tab="admin"]');

  // A — generic provider controls gone from the LLM card (LabBox API base must remain)
  await expect(page.locator('#cfg-llm-provider')).toHaveCount(0);
  await expect(page.locator('#cfg-llm-base')).toHaveCount(0);
  await expect(page.locator('#cfg-same-key')).toHaveCount(0);
  const llmCard = page.locator('#llm-test-result').locator('xpath=ancestor::div[contains(@class,"card")]');
  await expect(llmCard).not.toContainText('API base URL');
  await expect(llmCard).toContainText('OpenRouter API key');
  const labboxCard = page.locator('#cfg-api-base').locator('xpath=ancestor::div[contains(@class,"card")]');
  await expect(labboxCard).toContainText('API base URL'); // untouched LabBox field
  expect(await page.locator('#test-llm').innerText()).toBe('Test OpenRouter');

  // B — exactly one OpenRouter key control
  expect(await page.locator('#cfg-or-key[type="password"]').count()).toBe(1);
  expect(errors).toEqual([]);
});

test('OR-C: model dropdowns group by vendor with human labels', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockCatalog(page);
  seedSettings(page.context());
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await dbWaitQuiet(page);

  const groups = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#cfg-text-model optgroup')).map(g => g.label));
  for (const expected of ['OpenAI', 'Anthropic', 'Google', 'DeepSeek']) {
    expect(groups).toContain(expected);
  }
  // Human-readable option text, raw ID as value
  const optTexts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#cfg-text-model option')).map(o => ({ t: o.textContent, v: o.value })));
  const mini = optTexts.find(o => o.v === 'openai/gpt-4.1-mini');
  expect(mini.t).toBe('GPT-4.1 Mini');
  expect(errors).toEqual([]);
});

test('OR-D/E/F: vision, classification, and transcription filtering', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockCatalog(page);
  seedSettings(page.context());
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await dbWaitQuiet(page);

  // D — only image-input + text-output models in Photo identification
  const vision = await selectValues(page, 'cfg-vision-model');
  expect(vision.sort()).toEqual([
    'anthropic/claude-sonnet-4', 'google/gemini-2.5-flash', 'openai/gpt-4.1-mini'
  ]);
  expect(vision).not.toContain('openai/gpt-4.1');           // text-only
  expect(vision).not.toContain('openai/dall-e-3');          // image-output

  // E — chat-capable text models in Classification; utilities excluded
  const cls = await selectValues(page, 'cfg-text-model');
  for (const expected of ['openai/gpt-4.1-mini', 'openai/gpt-4.1', 'anthropic/claude-sonnet-4',
    'google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite', 'deepseek/deepseek-chat-v4',
    'mistralai/mistral-medium-3']) {
    expect(cls).toContain(expected);
  }
  expect(cls).not.toContain('openai/text-embedding-3-large'); // embedding (no text output)
  expect(cls).not.toContain('openai/omni-moderation-latest'); // moderation utility
  expect(cls).not.toContain('openai/dall-e-3');               // image generation

  // F — only audio-input + text-output models in Transcription
  const trans = await selectValues(page, 'cfg-trans-model');
  expect(trans.sort()).toEqual(['google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite']);
  expect(trans).not.toContain('mistralai/mistral-medium-3');  // ordinary chat model
  expect(trans).not.toContain('openai/gpt-4.1-mini');
  expect(errors).toEqual([]);
});

test('OR-G: three selections persist across reload', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockCatalog(page);
  seedSettings(page.context());
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.click('nav#tabs button[data-tab="admin"]');
  await dbWaitQuiet(page);

  await page.selectOption('#cfg-trans-model', 'google/gemini-2.5-flash');
  await page.selectOption('#cfg-text-model', 'anthropic/claude-sonnet-4');
  await page.selectOption('#cfg-vision-model', 'google/gemini-2.5-flash');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await dbWaitQuiet(page);

  expect(await selectedValue(page, 'cfg-trans-model')).toBe('google/gemini-2.5-flash');
  expect(await selectedValue(page, 'cfg-text-model')).toBe('anthropic/claude-sonnet-4');
  expect(await selectedValue(page, 'cfg-vision-model')).toBe('google/gemini-2.5-flash');

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('wfr_settings')));
  expect(stored.transModel).toBe('google/gemini-2.5-flash');
  expect(stored.textModel).toBe('anthropic/claude-sonnet-4');
  expect(stored.visionModel).toBe('google/gemini-2.5-flash');
  expect(errors).toEqual([]);
});

test('OR-H: legacy direct-provider model IDs migrate or are preserved', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockCatalog(page);
  seedSettings(page.context(), {
    transModel: 'whisper-1',        // not mappable -> preserved with unavailable label
    textModel: 'gpt-4.1-mini',      // bare slug -> openai/gpt-4.1-mini
    visionModel: 'openai/gpt-4.1-mini' // already an OpenRouter ID
  });
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await dbWaitQuiet(page);

  expect(await selectedValue(page, 'cfg-text-model')).toBe('openai/gpt-4.1-mini');
  expect(await selectedValue(page, 'cfg-vision-model')).toBe('openai/gpt-4.1-mini');

  const transOpts = await page.evaluate(() =>
    Array.from(document.getElementById('cfg-trans-model').options).map(o => ({ v: o.value, t: o.textContent })));
  const whisper = transOpts.find(o => o.v === 'whisper-1');
  expect(whisper).toBeTruthy();
  expect(whisper.t).toMatch(/Current saved model — unavailable in catalog/);
  expect(await selectedValue(page, 'cfg-trans-model')).toBe('whisper-1'); // not silently replaced
  expect(errors).toEqual([]);
});

test('OR-I: cached catalog survives refresh failure; fallback list without cache', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page); // openrouter blocked -> refresh fails

  // I-1: cache present -> selectors populate from cache despite failed refresh
  const cachedModels = [
    { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'anthropic',
      inputModalities: ['text', 'image'], outputModalities: ['text'],
      supportsText: true, supportsVision: true, supportsAudioInput: false, supportsTranscription: false, source: 'catalog' },
    { id: 'google/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', provider: 'google',
      inputModalities: ['text', 'audio'], outputModalities: ['text'],
      supportsText: true, supportsVision: false, supportsAudioInput: true, supportsTranscription: true, source: 'catalog' }
  ];
  seedSettings(page.context(), { textModel: 'anthropic/claude-sonnet-4', visionModel: 'openai/gpt-4.1-mini' }, cachedModels);
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await dbWaitQuiet(page);

  expect((await selectValues(page, 'cfg-text-model'))).toContain('anthropic/claude-sonnet-4');
  expect((await selectValues(page, 'cfg-trans-model'))).toEqual(['google/gemini-2.5-flash-lite']);
  expect(await selectedValue(page, 'cfg-text-model')).toBe('anthropic/claude-sonnet-4'); // selection preserved
  expect(await page.textContent('#or-catalog-status')).toMatch(/cached/i);

  // I-2: no cache at all -> built-in fallback keeps the app usable
  const ctx2 = await page.context().browser().newContext();
  const page2 = await ctx2.newPage();
  const errors2 = collectErrors(page2);
  blockExternal(page2);
  seedSettings(ctx2, {});
  await page2.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page2.waitForLoadState('networkidle');
  await page2.waitForTimeout(400);
  expect((await selectValues(page2, 'cfg-text-model'))).toContain('openai/gpt-4.1-mini');
  expect(await selectedValue(page2, 'cfg-text-model')).toBe('openai/gpt-4.1-mini');
  expect(await selectedValue(page2, 'cfg-vision-model')).toBe('openai/gpt-4.1-mini'); // vision default despite no vision-capable fallback entry beyond mini
  expect(errors2).toEqual([]);
  await ctx2.close();
  expect(errors).toEqual([]);
});

test('OR-J: transcription + classification + vision all hit OpenRouter endpoints', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockMeteo(page);
  await mockGbif(page);
  let openAiCalls = 0;
  await page.route('**api.openai.com**', route => { openAiCalls++; return route.abort(); });

  const orCalls = [];
  await page.route('**/chat/completions', async route => {
    const url = new URL(route.request().url());
    orCalls.push({ host: url.host, body: route.request().postDataJSON() });
    if (route.request().headers()['content-type']?.includes('multipart')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: '' }) });
    }
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(VISION_JSON) } }] })
    });
  });

  seedSettings(page.context(), { visionModel: 'openai/gpt-4.1-mini', textModel: 'openai/gpt-4.1-mini', transModel: 'google/gemini-2.5-flash-lite' });
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await dbWaitQuiet(page);

  // Runtime transcription call through the app's own helper
  await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    // Minimal WAV-shaped blob: decode will fail on empty PCM and fall back to raw passthrough.
    const bytes = new Uint8Array(64);
    bytes.set([82, 73, 70, 70], 0); // 'RIFF'
    await T.db.audioBlobs.put({ blobId: 'tmp-audio', blob: new Blob([bytes], { type: 'audio/wav' }), mimeType: 'audio/wav', sizeBytes: 64, createdAt: Date.now() });
    const rec = await T.db.audioBlobs.get('tmp-audio');
    await T.transcribeAudio(rec.blob, 'audio/wav');
  });

  // Vision call through the real photo-import flow
  await importPhoto(page, FULL_EXIF);
  await dbWait(page, o => o.classificationStatus === 'done' || o.classificationError);

  expect(orCalls.length).toBeGreaterThanOrEqual(1);
  for (const call of orCalls) {
    expect(call.host).toBe('openrouter.ai');
    expect(call.body.model).toMatch(/^[a-z0-9~_-]+\/[a-z0-9._-]+$/i); // OpenRouter-style ID
  }
  const transcribeCall = orCalls.find(c => JSON.stringify(c.body).includes('input_audio'));
  expect(transcribeCall).toBeTruthy();
  expect(transcribeCall.body.model).toBe('google/gemini-2.5-flash-lite');
  expect(openAiCalls).toBe(0); // no direct OpenAI traffic whatsoever
  expect(errors).toEqual([]);
});
