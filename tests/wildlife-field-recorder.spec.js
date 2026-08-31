/* Wildlife Field Recorder — photo-import / EXIF / enrichment regression suite */
const { test, expect } = require('@playwright/test');
const path = require('path');
const { createHash } = require('crypto');

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

async function mockBreadcrumbs(page, points, { fail = false, defer = false } = {}) {
  const state = { calls: [], release: () => {} };
  let gate = null;
  if (defer) gate = new Promise(resolve => { state.release = resolve; });
  await page.route('**/wildlife-field-recorder/breadcrumbs**', async route => {
    state.calls.push(route.request().url());
    if (gate) await gate;
    if (fail) return route.abort();
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ records: points.map((data, index) => ({ id: `crumb-${index}`, data })) })
    });
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

/* ---------- original-file picker / Android EXIF preservation ---------- */

test('PICKER-A: primary photo input is the normal image picker with truthful copy', async ({ page }) => {
  blockExternal(page);
  await openCaptureTab(page);
  const input = page.locator('#photo-import-input');
  expect(await input.getAttribute('accept')).toBe('image/*');
  expect(await input.getAttribute('capture')).toBeNull();
  await expect(page.locator('#import-photo-btn')).toContainText('Import Photo');
  await expect(page.locator('.original-photo-hint')).toContainText('outing history');
  await expect(page.locator('.original-photo-hint')).not.toContainText('original file');
  // Outing-track import keeps its own JSON/document picker.
  expect(await page.locator('#outing-import-input').getAttribute('accept')).toBe('application/json,.json');
});

test('PICKER-B/C: Import Photo opens the image input — never showOpenFilePicker — and preserves the camera filename', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await openCaptureTab(page);
  await page.evaluate(() => {
    window.exifr.parse = async () => ({});
    window.__pickerCalls = 0;
    window.showOpenFilePicker = async () => { window.__pickerCalls++; return []; };
  });
  const chooserPromise = page.waitForEvent('filechooser');
  await page.click('#import-photo-btn');
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'PXL_20260828_231840123.jpg', mimeType: 'image/jpeg', buffer: PNG });
  await dbWait(page, 'obs => obs.observationSource === "photo_import"');
  const obs = await getObs(page);
  // The Android-style selected File reaches importPhotoFile with its camera
  // filename intact, so Pixel UTC filename semantics apply.
  expect(await page.evaluate(() => window.__pickerCalls)).toBe(0);
  expect(obs.timeProvenance).toMatchObject({ source: 'filename', pattern: 'pixel_pxl', timeBasis: 'utc', utcIso: '2026-08-28T23:18:40.123Z' });
  expect(errors).toEqual([]);
});

test('PICKER-D: photo-picker cancellation is quiet — no observation, no error, Ready', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await openCaptureTab(page);
  await page.evaluate(() => {
    // Simulate the picker closing without a selection (empty FileList change).
    const input = document.getElementById('photo-import-input');
    input.files = new DataTransfer().files;
    input.dispatchEvent(new Event('change'));
  });
  await expect(page.locator('#capture-status')).toHaveText('Ready');
  expect(await page.evaluate(() => window.__WFR_TEST__.db.observations.count())).toBe(0);
  expect(errors).toEqual([]);
});

test('PICKER-E: supported MIME and extension combinations are accepted', async ({ page }) => {
  blockExternal(page);
  await openCaptureTab(page);
  const accepted = await page.evaluate(() => {
    const ok = window.__WFR_TEST__.isSupportedPhotoFile;
    return [
      new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
      new File(['x'], 'photo.JPEG', { type: '' }),
      new File(['x'], 'photo.png', { type: 'image/png' }),
      new File(['x'], 'photo.webp', { type: 'image/webp' }),
      new File(['x'], 'photo.heic', { type: 'image/heic' }),
      new File(['x'], 'photo.heif', { type: 'image/heif' }),
      new File(['x'], 'provider-file', { type: 'image/jpeg' }),
      new File(['x'], 'provider.jpg', { type: 'application/octet-stream' })
    ].map(ok);
  });
  expect(accepted).toEqual([true, true, true, true, true, true, true, true]);
});

test('PICKER-F: unsupported documents are rejected before EXIF or observation creation', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await openCaptureTab(page);
  const result = await page.evaluate(async () => {
    let exifCalls = 0;
    window.exifr.parse = async () => { exifCalls++; return {}; };
    const T = window.__WFR_TEST__;
    const statuses = [];
    for (const [name, type] of [['notes.pdf', 'application/pdf'], ['wildlife.txt', 'text/plain'], ['archive.zip', 'application/zip'], ['fake.jpg', 'application/pdf']]) {
      statuses.push((await T.importPhotoFile(new File(['not a photo'], name, { type }))).status);
    }
    return {
      statuses,
      exifCalls,
      observations: await T.db.observations.count(),
      message: document.getElementById('capture-status').textContent
    };
  });
  expect(result.statuses).toEqual(['unsupported', 'unsupported', 'unsupported', 'unsupported']);
  expect(result.exifCalls).toBe(0);
  expect(result.observations).toBe(0);
  expect(result.message).toContain("isn't a supported photo");
  expect(result.message).toContain('JPEG, PNG, WebP, HEIC, or HEIF');
  expect(errors).toEqual([]);
});

test('PICKER-G/H/I: selected bytes reach EXIF first, hash exactly, and retain rich metadata', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  const meteo = await mockMeteo(page);
  await openCaptureTab(page);
  const expectedHash = createHash('sha256').update(PNG).digest('hex');
  await page.evaluate(({ pngB64, exif }) => {
    const nativeCreateObjectURL = URL.createObjectURL.bind(URL);
    window.__importEvidence = { events: [], exifBytes: null };
    window.exifr.parse = async file => {
      window.__importEvidence.events.push('exif');
      const bytes = new Uint8Array(await file.arrayBuffer());
      window.__importEvidence.exifBytes = Array.from(bytes);
      return exif;
    };
    URL.createObjectURL = blob => {
      window.__importEvidence.events.push('resize');
      return nativeCreateObjectURL(blob);
    };
  }, { pngB64: PNG.toString('base64'), exif: FULL_EXIF });
  const chooserPromise = page.waitForEvent('filechooser');
  await page.click('#import-photo-btn');
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'camera-original.jpg', mimeType: 'image/jpeg', buffer: PNG });
  await dbWait(page, 'obs => obs.weatherStatus === "ok"');
  const result = await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    const obs = (await T.db.observations.toArray())[0];
    const photo = (await T.db.photos.toArray())[0];
    return {
      events: window.__importEvidence.events,
      exifBytes: window.__importEvidence.exifBytes,
      hash: photo.originalSha256,
      originalName: photo.originalFilename,
      exif: obs.exif,
      lat: obs.latitude,
      lng: obs.longitude,
      createdAt: obs.createdAt,
      timeSource: obs.timeProvenance.source,
      offset: obs.timeProvenance.utcOffsetSeconds,
      metadataStatus: document.getElementById('original-photo-status').textContent
    };
  });
  expect(result.events.indexOf('exif')).toBeGreaterThanOrEqual(0);
  expect(result.events.indexOf('resize')).toBeGreaterThan(result.events.indexOf('exif'));
  expect(Buffer.from(result.exifBytes)).toEqual(PNG);
  expect(result.hash).toBe(expectedHash);
  expect(result.originalName).toBe('camera-original.jpg');
  expect(result.exif.DateTimeOriginal).toBe(FULL_EXIF.DateTimeOriginal);
  expect(result.exif.OffsetTimeOriginal).toBe('-04:00');
  expect(result.exif.Make).toBe('TestCam');
  expect(result.exif.Model).toBe('Mk100');
  expect(result.lat).toBe(38.355);
  expect(result.lng).toBe(-87.5381);
  expect(result.createdAt).toBe(Date.parse('2026-05-14T21:42:00.000Z'));
  expect(result.timeSource).toBe('exif_DateTimeOriginal');
  expect(result.offset).toBe(-14400);
  expect(result.metadataStatus).toContain('Embedded metadata found');
  expect(result.metadataStatus).toContain('GPS · capture time · TestCam Mk100');
  expect(meteo.calls).toContain('2026-05-14');
  expect(errors).toEqual([]);
});

test('PICKER-J: metadata-free selection still imports without invented GPS or capture time', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await openCaptureTab(page);
  await page.evaluate(pngB64 => {
    window.exifr.parse = async () => ({});
  }, PNG.toString('base64'));
  const chooserPromise = page.waitForEvent('filechooser');
  await page.click('#import-photo-btn');
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'edited.jpg', mimeType: 'image/jpeg', buffer: PNG });
  await dbWait(page, 'obs => obs.observationSource === "photo_import"');
  const obs = await getObs(page);
  expect(obs.latitude).toBeNull();
  expect(obs.longitude).toBeNull();
  expect(obs.gpsStatus).toBe('missing');
  expect(obs.timeProvenance.source).toBe('unknown');
  expect(obs.createdAt).not.toBeNull();
  // Absent metadata is an expected, non-failing state on sanitized photos.
  await expect(page.locator('#original-photo-status')).toContainText('No embedded GPS/capture metadata found; checking outing history');
  expect(errors).toEqual([]);
});

/* ---------- capture-time and Safari breadcrumb recovery ---------- */

test('BREAD-A/B/C/D: filename registry parses real timestamps and rejects generic/malformed names', async ({ page }) => {
  blockExternal(page);
  await openCaptureTab(page);
  const parsed = await page.evaluate(() => {
    const parse = window.__WFR_TEST__.parsePhotoFilenameTime;
    return [
      parse('PXL_20260825_143211123.jpg'),
      parse('IMG_20260825_143211.jpg'),
      parse('20260825_143211.jpg'),
      parse('20260825_143211_001.jpg'),
      parse('IMG_4837.jpg'),
      parse('DSC_1021.jpg'),
      parse('IMG_20261340_296199.jpg')
    ];
  });
  expect(parsed[0]).toMatchObject({ pattern: 'pixel_pxl', timeBasis: 'utc', timeBasisResolution: 'known_filename_semantics', utcIso: '2026-08-25T14:32:11.123Z', timestamp: Date.parse('2026-08-25T14:32:11.123Z'), wallIso: null, millisecond: 123, confidence: 'high' });
  expect(parsed[1]).toMatchObject({ pattern: 'samsung_img', timeBasisHint: 'local_wall', wallIso: '2026-08-25T14:32:11', utcIso: null, confidence: 'medium_high' });
  expect(parsed[2]).toMatchObject({ pattern: 'generic_yyyymmdd_hhmmss', timeBasisHint: 'unknown' });
  expect(parsed[3]).toMatchObject({ suffix: '001', millisecond: null });
  expect(parsed.slice(4)).toEqual([null, null, null]);
});

test('BREAD-E/F: EXIF beats filename, filename beats weak lastModified, copy-time remains unresolved', async ({ page }) => {
  blockExternal(page);
  await openCaptureTab(page);
  const result = await page.evaluate(() => {
    const T = window.__WFR_TEST__;
    const importedAt = Date.UTC(2026, 7, 25, 23, 0, 0);
    const normalized = T.normalizeExif({ DateTimeOriginal: '2026:08:25 14:30:00', OffsetTimeOriginal: '-04:00' });
    const parsed = { captureTime: T.normalizeCaptureTime(normalized.exif) };
    const exifEvidence = T.collectPhotoTimeEvidence(new File(['x'], 'IMG_20260825_143500.jpg', { type: 'image/jpeg', lastModified: importedAt - 86400000 }), parsed, importedAt);
    const filenameEvidence = T.collectPhotoTimeEvidence(new File(['x'], 'IMG_20260825_143000.jpg', { type: 'image/jpeg', lastModified: Date.UTC(2026, 7, 25, 19, 45) }), {}, importedAt);
    const unresolvedEvidence = T.collectPhotoTimeEvidence(new File(['x'], 'IMG_4837.jpg', { type: 'image/jpeg', lastModified: importedAt - 1000 }), {}, importedAt);
    return {
      exif: T.resolveCaptureTimeEvidence(exifEvidence),
      filename: T.resolveCaptureTimeEvidence(filenameEvidence),
      unresolved: T.resolveCaptureTimeEvidence(unresolvedEvidence),
      unresolvedCandidates: unresolvedEvidence
    };
  });
  expect(result.exif).toMatchObject({ source: 'exif_DateTimeOriginal', wallIso: '2026-08-25T14:30:00' });
  expect(result.filename).toMatchObject({ source: 'filename', wallIso: '2026-08-25T14:30:00' });
  expect(result.unresolved).toBeNull();
  expect(result.unresolvedCandidates[0]).toMatchObject({ source: 'file_last_modified', plausible: false });
});

test('BREAD-G: a near-exact breadcrumb is used with explicit accuracy', async ({ page }) => {
  blockExternal(page);
  await openCaptureTab(page);
  const result = await page.evaluate(() => {
    const T = window.__WFR_TEST__;
    const target = Date.parse('2026-08-25T18:12:37Z');
    return T.resolveBreadcrumbLocation(
      { source: 'filename', wallIso: '2026-08-25T14:12:37', confidence: 'medium_high' },
      [{ timestamp: target + 8000, latitude: 38.3513, longitude: -87.5717, accuracyMeters: 12, utcOffsetSeconds: -14400, timezone: 'America/Indiana/Indianapolis', sourceId: 'near' }]
    );
  });
  expect(result).toMatchObject({ status: 'resolved', method: 'breadcrumb_nearest', latitude: 38.3513, longitude: -87.5717, estimatedAccuracyMeters: 12, confidence: 'high' });
});

test('BREAD-H/K/L: moving track interpolates mathematically and resolves filename wall time timezone', async ({ page }) => {
  blockExternal(page);
  await openCaptureTab(page);
  const result = await page.evaluate(() => {
    const T = window.__WFR_TEST__;
    const points = [
      { timestamp: Date.parse('2026-08-25T18:12:10Z'), latitude: 38.35120, longitude: -87.57182, accuracyMeters: 10, utcOffsetSeconds: -14400, timezone: 'America/Indiana/Indianapolis', sourceId: 'a' },
      { timestamp: Date.parse('2026-08-25T18:12:50Z'), latitude: 38.35135, longitude: -87.57160, accuracyMeters: 12, utcOffsetSeconds: -14400, timezone: 'America/Indiana/Indianapolis', sourceId: 'b' }
    ];
    const evidence = { source: 'filename', pattern: 'samsung_img', wallIso: '2026-08-25T14:12:30', confidence: 'medium_high' };
    const resolved = T.resolveBreadcrumbLocation(evidence, points);
    return { resolved, provenance: T.breadcrumbProvenance(evidence, resolved) };
  });
  expect(result.resolved.status).toBe('resolved');
  expect(result.resolved.method).toBe('breadcrumb_interpolated');
  expect(result.resolved.latitude).toBeCloseTo(38.351275, 6);
  expect(result.resolved.longitude).toBeCloseTo(-87.57171, 6);
  expect(result.resolved.timestamp).toBe(Date.parse('2026-08-25T18:12:30Z'));
  expect(result.resolved.estimatedAccuracyMeters).toBeGreaterThanOrEqual(12);
  expect(result.resolved.confidence).toBe('high');
  expect(result.provenance.breadcrumb).toMatchObject({ beforeTimestamp: Date.parse('2026-08-25T18:12:10Z'), afterTimestamp: Date.parse('2026-08-25T18:12:50Z') });
});

test('BREAD-I: stationary breadcrumbs use a robust cluster center', async ({ page }) => {
  blockExternal(page);
  await openCaptureTab(page);
  const result = await page.evaluate(() => {
    const T = window.__WFR_TEST__;
    const target = Date.parse('2026-08-25T18:12:30Z');
    const points = [
      [target - 90000, 38.35120, -87.57180, 9],
      [target, 38.35122, -87.57178, 8],
      [target + 90000, 38.35119, -87.57181, 11]
    ].map((p, i) => ({ timestamp: p[0], latitude: p[1], longitude: p[2], accuracyMeters: p[3], utcOffsetSeconds: -14400, timezone: 'America/Indiana/Indianapolis', sourceId: String(i) }));
    return T.resolveBreadcrumbLocation({ source: 'filename', wallIso: '2026-08-25T14:12:30', confidence: 'medium_high' }, points);
  });
  expect(result.method).toBe('breadcrumb_stationary_cluster');
  expect(result.latitude).toBeCloseTo(38.35120, 5);
  expect(result.longitude).toBeCloseTo(-87.57180, 5);
  expect(result.estimatedAccuracyMeters).toBeGreaterThanOrEqual(9);
  expect(['high', 'medium']).toContain(result.confidence);
});

test('BREAD-J: sparse or implausible tracks refuse false precision', async ({ page }) => {
  blockExternal(page);
  await openCaptureTab(page);
  const result = await page.evaluate(() => {
    const T = window.__WFR_TEST__;
    const target = Date.parse('2026-08-25T18:15:00Z');
    const points = [
      { timestamp: target - 6 * 60000, latitude: 38.0, longitude: -88.0, accuracyMeters: 10, utcOffsetSeconds: -14400 },
      { timestamp: target + 6 * 60000, latitude: 39.0, longitude: -87.0, accuracyMeters: 10, utcOffsetSeconds: -14400 }
    ];
    return T.resolveBreadcrumbLocation({ source: 'filename', wallIso: '2026-08-25T14:15:00', confidence: 'medium_high' }, points);
  });
  expect(result.status).toBe('unresolved');
  expect(result.reason).toMatch(/gap|bounding/i);
});

test('BREAD-M/N: sanitized Android photo recovers provenance, weather, vision, and taxonomy', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  seedSettings(page.context(), { token: 'lab-test', breadcrumbResource: 'breadcrumbs', llmKey: 'sk-or-test' });
  const crumbs = await mockBreadcrumbs(page, [
    { timestamp: '2026-05-14T21:41:30Z', latitude: 38.35120, longitude: -87.57182, accuracyMeters: 10, utcOffsetSeconds: -14400, timezone: 'America/Indiana/Indianapolis' },
    { timestamp: '2026-05-14T21:42:30Z', latitude: 38.35135, longitude: -87.57160, accuracyMeters: 12, utcOffsetSeconds: -14400, timezone: 'America/Indiana/Indianapolis' }
  ]);
  const meteo = await mockMeteo(page);
  await mockVision(page);
  await mockGbif(page);
  await openCaptureTab(page);
  await page.evaluate(async pngB64 => {
    window.exifr.parse = async () => ({});
    const bytes = Uint8Array.from(atob(pngB64), c => c.charCodeAt(0));
    await window.__WFR_TEST__.importPhotoFile(new File([bytes], 'IMG_20260514_174200.jpg', { type: 'image/jpeg' }));
  }, PNG.toString('base64'));
  await dbWait(page, 'obs => obs.weatherStatus === "ok" && obs.classificationStatus === "done" && obs.photoEnrichment.taxonomy === "done"');
  const obs = await getObs(page);
  expect(obs.timeProvenance).toMatchObject({ source: 'filename', pattern: 'samsung_img', wallIso: '2026-05-14T17:42:00', utcIso: '2026-05-14T21:42:00.000Z', timezone: 'America/Indiana/Indianapolis', timezoneSource: 'breadcrumb_location' });
  expect(obs.gpsSource).toBe('breadcrumb_interpolated');
  expect(obs.locationProvenance).toMatchObject({ source: 'breadcrumb_interpolated', confidence: 'high' });
  expect(obs.locationProvenance.breadcrumb.source).toBe('wilderness_safari');
  expect(obs.latitude).toBeCloseTo(38.351275, 6);
  expect(obs.longitude).toBeCloseTo(-87.57171, 6);
  expect(obs.createdAt).toBe(Date.parse('2026-05-14T21:42:00Z'));
  expect(obs.weatherRaw.strategy).toBe('historical archive');
  expect(obs.subjectCommonName).toBe('Red-tailed Hawk');
  expect(obs.taxonomy.status).toBe('ok');
  expect(crumbs.calls).toHaveLength(1);
  expect(meteo.calls).toContain('2026-05-14');
  await expect(page.locator('#import-evidence-summary')).toContainText('Estimated from Safari track');
  expect(errors).toEqual([]);
});

test('BREAD-O: user location edit wins over a late Safari response', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  seedSettings(page.context(), { token: 'lab-test', breadcrumbResource: 'breadcrumbs', llmKey: '' });
  const crumbs = await mockBreadcrumbs(page, [
    { timestamp: '2026-05-14T21:41:30Z', latitude: 38.3512, longitude: -87.5718, accuracyMeters: 10, utcOffsetSeconds: -14400, timezone: 'America/Indiana/Indianapolis' },
    { timestamp: '2026-05-14T21:42:30Z', latitude: 38.3514, longitude: -87.5716, accuracyMeters: 10, utcOffsetSeconds: -14400, timezone: 'America/Indiana/Indianapolis' }
  ], { defer: true });
  await openCaptureTab(page);
  await page.evaluate(async pngB64 => {
    window.exifr.parse = async () => ({});
    const bytes = Uint8Array.from(atob(pngB64), c => c.charCodeAt(0));
    await window.__WFR_TEST__.importPhotoFile(new File([bytes], 'IMG_20260514_174200.jpg', { type: 'image/jpeg' }));
  }, PNG.toString('base64'));
  await dbWait(page, 'obs => obs.photoEnrichment.location === "running"');
  await page.fill('#imp-lat', '38.5');
  await page.fill('#imp-lng', '-87.5');
  await page.click('#imp-save');
  crumbs.release();
  await page.waitForTimeout(500);
  const obs = await getObs(page);
  expect(obs.latitude).toBe(38.5);
  expect(obs.longitude).toBe(-87.5);
  expect(obs.gpsSource).toBe('user_provided');
  expect(errors).toEqual([]);
});

test('BREAD-P/Q: Safari failure is non-destructive and nearby photos reuse cached windows', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  seedSettings(page.context(), { token: 'lab-test', breadcrumbResource: 'breadcrumbs', llmKey: '' });
  const crumbs = await mockBreadcrumbs(page, [], { fail: true });
  await openCaptureTab(page);
  await page.evaluate(async pngB64 => {
    window.exifr.parse = async () => ({});
    const bytes = Uint8Array.from(atob(pngB64), c => c.charCodeAt(0));
    await window.__WFR_TEST__.importPhotoFile(new File([bytes], 'PXL_20260514_174200123.jpg', { type: 'image/jpeg' }));
  }, PNG.toString('base64'));
  await dbWait(page, 'obs => obs.photoEnrichment.location === "error"');
  let obs = await getObs(page);
  // Pixel PXL filenames encode UTC — the digits must NOT be treated as local wall time.
  expect(obs.timeProvenance).toMatchObject({ source: 'filename', pattern: 'pixel_pxl', timeBasis: 'utc', timeBasisResolution: 'known_filename_semantics', utcIso: '2026-05-14T17:42:00.123Z', wallIso: null });
  expect(obs.latitude).toBeNull();
  expect(obs.locationResolutionError).toMatch(/fetch|network/i);

  await page.unroute('**/wildlife-field-recorder/breadcrumbs**');
  const cached = await mockBreadcrumbs(page, [{ timestamp: '2026-05-14T21:43:00Z', latitude: 38.35, longitude: -87.57, accuracyMeters: 10, utcOffsetSeconds: -14400, timezone: 'America/Indiana/Indianapolis' }]);
  const calls = await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    T.clearBreadcrumbWindowCache();
    await T.fetchBreadcrumbWindow({ wallIso: '2026-05-14T17:41:00', utcIso: null }, T.BREADCRUMB_QUERY_WINDOW_MS);
    await T.fetchBreadcrumbWindow({ wallIso: '2026-05-14T17:44:00', utcIso: null }, T.BREADCRUMB_QUERY_WINDOW_MS);
    return true;
  });
  expect(calls).toBe(true);
  expect(cached.calls).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('BREAD-R: genuine desktop EXIF GPS/time bypasses Safari recovery', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  seedSettings(page.context(), { token: 'lab-test', breadcrumbResource: 'breadcrumbs', llmKey: '' });
  const crumbs = await mockBreadcrumbs(page, []);
  await openCaptureTab(page);
  await importPhoto(page, FULL_EXIF);
  await dbWait(page, 'obs => obs.observationSource === "photo_import"');
  const obs = await getObs(page);
  expect(obs.gpsSource).toBe('exif');
  expect(obs.timeProvenance.source).toBe('exif_DateTimeOriginal');
  expect(obs.latitude).toBe(FULL_EXIF.latitude);
  expect(crumbs.calls).toHaveLength(0);
  expect(errors).toEqual([]);
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
    expect(post.body.data.appVersion).toBe('2026.08.30.11');
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
    mk('openai/gpt-5.6-luna', 'OpenAI: GPT-5.6 Luna', ['text', 'image'], ['text']),
    mk('google/gemini-3.7-flash', 'Google: Gemini 3.7 Flash', ['text', 'image'], ['text']),
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

function transcriptionCatalogPayload() {
  const mk = (id, name) => ({
    id, name,
    architecture: { input_modalities: ['audio'], output_modalities: ['transcription'] }
  });
  return { data: [
    mk('openai/gpt-transcribe', 'OpenAI: GPT Transcribe'),
    mk('openai/whisper-1', 'OpenAI: Whisper 1'),
    mk('openai/gpt-4o-mini-transcribe', 'OpenAI: GPT-4o Mini Transcribe'),
    mk('deepgram/nova-3', 'Deepgram: Nova-3')
  ] };
}

function normalizeFixture(payload, dedicatedTranscription) {
  return payload.data.map(m => {
    const inputModalities = m.architecture.input_modalities;
    const outputModalities = m.architecture.output_modalities;
    const supportsText = inputModalities.includes('text') && outputModalities.includes('text');
    return {
      id: m.id, name: m.name, provider: m.id.split('/')[0], inputModalities, outputModalities,
      supportsText, supportsVision: inputModalities.includes('image') && supportsText,
      supportsAudioInput: inputModalities.includes('audio') && supportsText,
      supportsTranscription: dedicatedTranscription, source: 'catalog'
    };
  });
}

function recommendationResult(overrides = {}) {
  return {
    transcription: {
      model_id: 'openai/gpt-transcribe', reason: 'Best outdoor field-note accuracy.', confidence: 0.93, alternatives: ['openai/whisper-1']
    },
    classification: {
      model_id: 'openai/gpt-5.6-luna', reason: 'Reliable low-cost structured extraction.', confidence: 0.95, alternatives: ['openai/gpt-4.1-mini']
    },
    vision: {
      model_id: 'google/gemini-3.7-flash', reason: 'Strong fine-grained wildlife vision.', confidence: 0.91, alternatives: ['openai/gpt-5.6-luna']
    },
    ...overrides
  };
}

async function mockRecommendation(page, result = recommendationResult(), { fail = false } = {}) {
  const calls = [];
  await page.route('**/chat/completions', route => {
    const body = route.request().postDataJSON();
    if (body.model !== '~openai/gpt-latest') return route.abort();
    calls.push(body);
    if (fail) return route.abort();
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] })
    });
  });
  return calls;
}

/** Seed localStorage settings before any page script runs. Merges with any
 *  already-stored settings so a reload does not wipe the app's own saves. */
function seedSettings(context, overrides = {}, catalog = null, transcriptionCatalog = null) {
  context.addInitScript(({ overrides, catalog, transcriptionCatalog }) => {
    let existing = {};
    try { existing = JSON.parse(localStorage.getItem('wfr_settings') || '{}'); } catch(e) {}
    localStorage.setItem('wfr_settings', JSON.stringify({ llmKey: 'sk-or-test', ...existing, ...overrides }));
    if (catalog) {
      const cache = { fetchedAt: Date.now(), models: catalog };
      if (transcriptionCatalog) {
        cache.generalModels = catalog;
        cache.transcriptionModels = transcriptionCatalog;
        cache.generalFetchedAt = cache.fetchedAt;
        cache.transcriptionFetchedAt = cache.fetchedAt;
        delete cache.models;
      }
      localStorage.setItem('wfr_openrouter_catalog', JSON.stringify(cache));
    }
  }, { overrides, catalog, transcriptionCatalog });
}

async function mockCatalog(page, payload = catalogPayload(), transcriptionPayload = transcriptionCatalogPayload()) {
  await page.route(OR_MODELS_URL, route => {
    const isTranscription = new URL(route.request().url()).searchParams.get('output_modalities') === 'transcription';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(isTranscription ? transcriptionPayload : payload)
    });
  });
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

test('OR-D/E/F: general and dedicated transcription catalogs populate only their selectors', async ({ page }) => {
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
    'anthropic/claude-sonnet-4', 'google/gemini-2.5-flash', 'google/gemini-3.7-flash',
    'openai/gpt-4.1-mini', 'openai/gpt-5.6-luna'
  ]);
  expect(vision).not.toContain('openai/gpt-4.1');           // text-only
  expect(vision).not.toContain('openai/dall-e-3');          // image-output

  // E — chat-capable text models in Classification; utilities excluded
  const cls = await selectValues(page, 'cfg-text-model');
  for (const expected of ['openai/gpt-4.1-mini', 'openai/gpt-4.1', 'anthropic/claude-sonnet-4',
    'google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite', 'deepseek/deepseek-chat-v4',
    'mistralai/mistral-medium-3', 'openai/gpt-5.6-luna', 'google/gemini-3.7-flash']) {
    expect(cls).toContain(expected);
  }
  expect(cls).not.toContain('openai/text-embedding-3-large'); // embedding (no text output)
  expect(cls).not.toContain('openai/omni-moderation-latest'); // moderation utility
  expect(cls).not.toContain('openai/dall-e-3');               // image generation

  // F — only the dedicated output_modalities=transcription result is used.
  const trans = await selectValues(page, 'cfg-trans-model');
  expect(trans.sort()).toEqual(['deepgram/nova-3', 'openai/gpt-4o-mini-transcribe', 'openai/gpt-transcribe', 'openai/whisper-1']);
  expect(trans).not.toContain('google/gemini-2.5-flash'); // audio-capable chat model must not leak in
  expect(trans).not.toContain('google/gemini-2.5-flash-lite');
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

  await page.selectOption('#cfg-trans-model', 'openai/gpt-4o-mini-transcribe');
  await page.selectOption('#cfg-text-model', 'anthropic/claude-sonnet-4');
  await page.selectOption('#cfg-vision-model', 'google/gemini-2.5-flash');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await dbWaitQuiet(page);

  expect(await selectedValue(page, 'cfg-trans-model')).toBe('openai/gpt-4o-mini-transcribe');
  expect(await selectedValue(page, 'cfg-text-model')).toBe('anthropic/claude-sonnet-4');
  expect(await selectedValue(page, 'cfg-vision-model')).toBe('google/gemini-2.5-flash');

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('wfr_settings')));
  expect(stored.transModel).toBe('openai/gpt-4o-mini-transcribe');
  expect(stored.textModel).toBe('anthropic/claude-sonnet-4');
  expect(stored.visionModel).toBe('google/gemini-2.5-flash');
  expect(errors).toEqual([]);
});

test('OR-H: legacy direct-provider model IDs migrate or are preserved', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockCatalog(page);
  seedSettings(page.context(), {
    transModel: 'whisper-1',        // confidently maps to dedicated OpenRouter STT ID
    textModel: 'gpt-4.1-mini',      // bare slug -> openai/gpt-4.1-mini
    visionModel: 'openai/gpt-4.1-mini' // already an OpenRouter ID
  });
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await dbWaitQuiet(page);

  expect(await selectedValue(page, 'cfg-text-model')).toBe('openai/gpt-4.1-mini');
  expect(await selectedValue(page, 'cfg-vision-model')).toBe('openai/gpt-4.1-mini');

  expect(await selectedValue(page, 'cfg-trans-model')).toBe('openai/whisper-1');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('wfr_settings')));
  expect(stored.transModel).toBe('openai/whisper-1');
  expect(errors).toEqual([]);
});

test('OR-H2: cached .2 audio-chat transcription selection migrates to STT fallback', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  const oldGeneralCache = normalizeFixture(catalogPayload(), false);
  seedSettings(page.context(), { transModel: 'google/gemini-2.5-flash-lite' }, oldGeneralCache);
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await dbWaitQuiet(page);

  expect(await selectedValue(page, 'cfg-trans-model')).toBe('openai/gpt-transcribe');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('wfr_settings')));
  expect(stored.transModel).toBe('openai/gpt-transcribe');
  expect(await selectValues(page, 'cfg-trans-model')).not.toContain('google/gemini-2.5-flash-lite');
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
  const cachedStt = [{ id: 'openai/whisper-1', name: 'Whisper 1', provider: 'openai',
    inputModalities: ['audio'], outputModalities: ['transcription'], supportsText: false,
    supportsVision: false, supportsAudioInput: true, supportsTranscription: true, source: 'catalog' }];
  seedSettings(page.context(), { transModel: 'openai/whisper-1', textModel: 'anthropic/claude-sonnet-4', visionModel: 'openai/gpt-4.1-mini' }, cachedModels, cachedStt);
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await dbWaitQuiet(page);

  expect((await selectValues(page, 'cfg-text-model'))).toContain('anthropic/claude-sonnet-4');
  expect((await selectValues(page, 'cfg-trans-model'))).toEqual(['openai/whisper-1']);
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
  expect(await selectedValue(page2, 'cfg-text-model')).toBe('openai/gpt-5.6-luna');
  expect(await selectedValue(page2, 'cfg-vision-model')).toBe('google/gemini-3.7-flash');
  expect(await selectedValue(page2, 'cfg-trans-model')).toBe('openai/gpt-transcribe');
  expect(errors2).toEqual([]);
  await ctx2.close();
  expect(errors).toEqual([]);
});

test('OR-I2: dedicated STT catalog failure preserves general results and STT fallback', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await page.route(OR_MODELS_URL, route => {
    const isTranscription = new URL(route.request().url()).searchParams.get('output_modalities') === 'transcription';
    if (isTranscription) return route.abort();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(catalogPayload()) });
  });
  seedSettings(page.context());
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => /partly refreshed/i.test(document.getElementById('or-catalog-status').textContent));

  expect((await selectValues(page, 'cfg-trans-model')).sort()).toEqual(['openai/gpt-transcribe', 'openai/whisper-1']);
  expect(await selectValues(page, 'cfg-text-model')).toContain('anthropic/claude-sonnet-4');
  expect(await selectValues(page, 'cfg-vision-model')).toContain('openai/gpt-4.1-mini');
  expect(await page.textContent('#or-catalog-status')).toMatch(/retained cached\/fallback choices/i);
  expect(errors).toEqual([]);
});

test('OR-J: endpoint regression keeps STT dedicated and classification/vision on OpenRouter chat', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockMeteo(page);
  await mockGbif(page);
  let openAiCalls = 0;
  await page.route('**api.openai.com**', route => { openAiCalls++; return route.abort(); });

  const chatCalls = [];
  await page.route('**/chat/completions', async route => {
    const url = new URL(route.request().url());
    chatCalls.push({ host: url.host, path: url.pathname, body: route.request().postDataJSON() });
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(VISION_JSON) } }] })
    });
  });
  const sttCalls = [];
  await page.route('**/audio/transcriptions', async route => {
    const url = new URL(route.request().url());
    sttCalls.push({ host: url.host, path: url.pathname, body: route.request().postDataJSON() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'Red-tailed hawk circling over the field.' }) });
  });

  seedSettings(page.context(), { visionModel: 'openai/gpt-4.1-mini', textModel: 'openai/gpt-4.1-mini', transModel: 'openai/whisper-1' });
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

  expect(sttCalls).toHaveLength(1);
  const operationalChatCalls = chatCalls.filter(call => call.body.model !== '~openai/gpt-latest');
  expect(operationalChatCalls).toHaveLength(1); // photo identification only
  for (const call of [...sttCalls, ...operationalChatCalls]) {
    expect(call.host).toBe('openrouter.ai');
    expect(call.body.model).toMatch(/^[a-z0-9~_-]+\/[a-z0-9._-]+$/i); // OpenRouter-style ID
  }
  expect(sttCalls[0].path).toBe('/api/v1/audio/transcriptions');
  expect(sttCalls[0].body.model).toBe('openai/whisper-1');
  expect(sttCalls[0].body.input_audio.format).toBe('wav');
  expect(sttCalls[0].body.input_audio.data).toBeTruthy();
  expect(sttCalls[0].body).not.toHaveProperty('messages');
  expect(operationalChatCalls[0].path).toBe('/api/v1/chat/completions');
  expect(operationalChatCalls[0].body).toHaveProperty('messages');
  expect(openAiCalls).toBe(0); // no direct OpenAI traffic whatsoever
  expect(errors).toEqual([]);
});

test('OR-K: voice pipeline passes STT result.text into one chat classification request', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  const general = normalizeFixture(catalogPayload(), false);
  const stt = normalizeFixture(transcriptionCatalogPayload(), true);
  seedSettings(page.context(), {
    transModel: 'openai/whisper-1', textModel: 'openai/gpt-4.1-mini'
  }, general, stt);

  const sttCalls = [];
  await page.route('**/audio/transcriptions', route => {
    sttCalls.push(route.request().postDataJSON());
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ text: 'Red-tailed hawk circling over the field.' })
    });
  });
  const chatCalls = [];
  await page.route('**/chat/completions', route => {
    chatCalls.push(route.request().postDataJSON());
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        subjectCommonName: 'Red-tailed Hawk', subjectScientificName: 'Buteo jamaicensis',
        subjectConfidence: 0.96, category: 'bird', categoryConfidence: 0.99,
        behavior: 'circling', habitat: 'field', count: 1, tags: ['raptor'],
        summary: 'One Red-tailed Hawk circling.', needsHumanReview: false, reviewReason: null
      }) } }] })
    });
  });

  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  const result = await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    const bytes = new Uint8Array(64);
    bytes.set([82, 73, 70, 70], 0);
    const blob = new Blob([bytes], { type: 'audio/wav' });
    await T.db.audioBlobs.put({ blobId: 'voice-pipeline-audio', blob, mimeType: 'audio/wav', sizeBytes: blob.size, createdAt: Date.now() });
    const obs = {
      localId: 'voice-pipeline-observation', createdAt: Date.now(), updatedAt: Date.now(),
      audioBlobId: 'voice-pipeline-audio', audioMimeType: 'audio/wav', transcript: '',
      transcriptionStatus: 'pending', classificationStatus: 'pending', submitStatus: 'local',
      latitude: null, longitude: null, weatherRaw: null, userNoteText: ''
    };
    await T.db.observations.put(obs);
    await T.processObservation(obs);
    return T.db.observations.get(obs.localId);
  });

  expect(sttCalls).toHaveLength(1);
  const operationalChatCalls = chatCalls.filter(call => call.model !== '~openai/gpt-latest');
  expect(operationalChatCalls).toHaveLength(1);
  expect(sttCalls[0]).not.toHaveProperty('messages');
  expect(operationalChatCalls[0].messages[0].content).toContain('Red-tailed hawk circling over the field.');
  expect(result.transcript).toBe('Red-tailed hawk circling over the field.');
  expect(result.subjectCommonName).toBe('Red-tailed Hawk');
  expect(result.category).toBe('bird');
  expect(result.submitStatus).toBe('ready');
  expect(errors).toEqual([]);
});

/* ========================
   Recommended models + dynamic recommendation engine
   ======================== */

test('REC-A/B/C/E: bootstrap recommendations lead each picker, are unique, and default fresh installs', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockCatalog(page);
  seedSettings(page.context());
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => document.querySelector('#cfg-trans-model option[value="openai/gpt-transcribe"]'));

  const expected = {
    'cfg-trans-model': 'openai/gpt-transcribe',
    'cfg-text-model': 'openai/gpt-5.6-luna',
    'cfg-vision-model': 'google/gemini-3.7-flash'
  };
  for (const [id, modelId] of Object.entries(expected)) {
    const info = await page.evaluate(({ id, modelId }) => {
      const select = document.getElementById(id);
      return {
        firstGroup: select.children[0]?.label,
        count: Array.from(select.options).filter(o => o.value === modelId).length,
        label: Array.from(select.options).find(o => o.value === modelId)?.textContent,
        selected: select.value
      };
    }, { id, modelId });
    expect(info.firstGroup).toBe('★ Recommended for WFR');
    expect(info.count).toBe(1);
    expect(info.label).toMatch(/^★ .+ — Recommended$/);
    expect(info.selected).toBe(modelId);
  }
  expect(errors).toEqual([]);
});

test('REC-D/F: existing choices survive recommendations until one-click adoption, then persist', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockCatalog(page);
  seedSettings(page.context());
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.click('nav#tabs button[data-tab="admin"]');
  await dbWaitQuiet(page);

  await page.selectOption('#cfg-trans-model', 'openai/whisper-1');
  await page.selectOption('#cfg-text-model', 'anthropic/claude-sonnet-4');
  await page.selectOption('#cfg-vision-model', 'openai/gpt-4.1-mini');

  expect(await selectedValue(page, 'cfg-trans-model')).toBe('openai/whisper-1');
  expect(await selectedValue(page, 'cfg-text-model')).toBe('anthropic/claude-sonnet-4');
  expect(await selectedValue(page, 'cfg-vision-model')).toBe('openai/gpt-4.1-mini');

  await page.click('#use-recommended-models');
  expect(await selectedValue(page, 'cfg-trans-model')).toBe('openai/gpt-transcribe');
  expect(await selectedValue(page, 'cfg-text-model')).toBe('openai/gpt-5.6-luna');
  expect(await selectedValue(page, 'cfg-vision-model')).toBe('google/gemini-3.7-flash');
  await expect(page.locator('#recommendation-status')).toHaveText('Recommended WFR models selected');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  expect(await selectedValue(page, 'cfg-trans-model')).toBe('openai/gpt-transcribe');
  expect(await selectedValue(page, 'cfg-text-model')).toBe('openai/gpt-5.6-luna');
  expect(await selectedValue(page, 'cfg-vision-model')).toBe('google/gemini-3.7-flash');
  expect(errors).toEqual([]);
});

test('REC-G: unavailable bootstrap role creates no invalid option and preserves that role', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  const general = catalogPayload();
  general.data = general.data.filter(m => m.id !== 'google/gemini-3.7-flash');
  await mockCatalog(page, general);
  seedSettings(page.context(), {
    transModel: 'openai/whisper-1', textModel: 'anthropic/claude-sonnet-4', visionModel: 'openai/gpt-4.1-mini'
  });
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.click('nav#tabs button[data-tab="admin"]');
  await page.waitForFunction(() => document.getElementById('cfg-text-model').options.length > 5);

  expect(await selectValues(page, 'cfg-vision-model')).not.toContain('google/gemini-3.7-flash');
  await expect(page.locator('#rec-vision-model')).toHaveText('Recommended model currently unavailable');
  await page.click('#use-recommended-models');
  expect(await selectedValue(page, 'cfg-trans-model')).toBe('openai/gpt-transcribe');
  expect(await selectedValue(page, 'cfg-text-model')).toBe('openai/gpt-5.6-luna');
  expect(await selectedValue(page, 'cfg-vision-model')).toBe('openai/gpt-4.1-mini');
  await expect(page.locator('#recommendation-status')).toContainText('Photo ID');
  expect(errors).toEqual([]);
});

test('REC-O/P/Q/R/S/Z: GPT Latest evaluates actual candidates without changing selections until adoption', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  const general = catalogPayload();
  general.data.push({
    id: 'example/new-better-model', name: 'Example: New Better Model', created: 1787684400,
    context_length: 250000,
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    pricing: { prompt: '0.00000005', completion: '0.0000002' }
  });
  await mockCatalog(page, general);
  const calls = await mockRecommendation(page, recommendationResult({
    classification: {
      model_id: 'example/new-better-model', reason: 'New catalog model is ideal for compact JSON extraction.', confidence: 0.97,
      alternatives: ['openai/gpt-5.6-luna']
    }
  }));
  seedSettings(page.context(), {
    transModel: 'openai/whisper-1', textModel: 'anthropic/claude-sonnet-4', visionModel: 'openai/gpt-4.1-mini'
  });
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => document.querySelector('#cfg-text-model optgroup:first-child option')?.value === 'example/new-better-model');

  expect(calls).toHaveLength(1);
  expect(calls[0].model).toBe('~openai/gpt-latest');
  const prompt = calls[0].messages.map(m => m.content).join('\n');
  expect(prompt).toContain('Wildlife Field Recorder version 2026.08.30.11');
  expect(prompt).toMatch(/FIELD TRANSCRIPTION/i);
  expect(prompt).toMatch(/STRUCTURED OBSERVATION CLASSIFICATION/i);
  expect(prompt).toMatch(/WILDLIFE PHOTO IDENTIFICATION/i);
  expect(prompt).toContain('example/new-better-model');
  expect(prompt).not.toContain('openai/text-embedding-3-large');
  expect(calls[0].response_format.type).toBe('json_schema');

  expect(await selectedValue(page, 'cfg-text-model')).toBe('anthropic/claude-sonnet-4');
  await expect(page.locator('#rec-classification-model')).toHaveText('New Better Model');
  await expect(page.locator('#rec-classification-reason')).toContainText('compact JSON extraction');

  await page.click('nav#tabs button[data-tab="admin"]');
  await page.click('#use-recommended-models');
  expect(await selectedValue(page, 'cfg-text-model')).toBe('example/new-better-model');
  expect(errors).toEqual([]);
});

test('REC-T/U: hallucinated and wrong-capability recommendations are rejected per role', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockCatalog(page);
  await mockRecommendation(page, recommendationResult({
    transcription: { model_id: 'google/gemini-2.5-flash', reason: 'Wrong endpoint type.', confidence: 0.9, alternatives: [] },
    classification: { model_id: 'fakevendor/model-that-does-not-exist', reason: 'Hallucinated.', confidence: 0.9, alternatives: [] },
    vision: { model_id: 'openai/gpt-4.1', reason: 'Text only.', confidence: 0.9, alternatives: [] }
  }));
  seedSettings(page.context(), {
    transModel: 'openai/whisper-1', textModel: 'anthropic/claude-sonnet-4', visionModel: 'openai/gpt-4.1-mini'
  });
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => document.querySelector('#cfg-text-model optgroup:first-child option'));

  expect(await selectValues(page, 'cfg-text-model')).not.toContain('fakevendor/model-that-does-not-exist');
  expect(await page.locator('#cfg-trans-model optgroup:first-child option').getAttribute('value')).toBe('openai/gpt-transcribe');
  expect(await page.locator('#cfg-text-model optgroup:first-child option').getAttribute('value')).toBe('openai/gpt-5.6-luna');
  expect(await page.locator('#cfg-vision-model optgroup:first-child option').getAttribute('value')).toBe('google/gemini-3.7-flash');
  expect(await selectedValue(page, 'cfg-trans-model')).toBe('openai/whisper-1');
  expect(await selectedValue(page, 'cfg-text-model')).toBe('anthropic/claude-sonnet-4');
  expect(await selectedValue(page, 'cfg-vision-model')).toBe('openai/gpt-4.1-mini');
  expect(errors).toEqual([]);
});

test('REC-V/W/X: fresh cache avoids inference; manual refresh and catalog fingerprint changes re-evaluate', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  let general = catalogPayload();
  await page.route(OR_MODELS_URL, route => {
    const isTranscription = new URL(route.request().url()).searchParams.get('output_modalities') === 'transcription';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isTranscription ? transcriptionCatalogPayload() : general) });
  });
  const calls = await mockRecommendation(page);
  seedSettings(page.context());
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => document.getElementById('recommendation-freshness').textContent.includes('GPT Latest'));
  expect(calls).toHaveLength(1);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(250);
  expect(calls).toHaveLength(1);

  await page.click('nav#tabs button[data-tab="admin"]');
  await page.click('#refresh-models');
  await page.waitForFunction(() => document.getElementById('refresh-models').disabled === false);
  expect(calls).toHaveLength(2);

  general = { data: [...general.data, {
    id: 'example/catalog-newcomer', name: 'Example: Catalog Newcomer', created: 1787684500,
    architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0.0000001', completion: '0.0000002' }
  }] };
  await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    await T.refreshModelCatalog({ silent: true });
    await T.refreshRecommendations();
  });
  expect(calls).toHaveLength(3);
  expect(errors).toEqual([]);
});

test('REC-Y: recommendation failure is non-destructive after catalog refresh', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockCatalog(page);
  await mockRecommendation(page, recommendationResult(), { fail: true });
  seedSettings(page.context(), { textModel: 'anthropic/claude-sonnet-4' });
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.click('nav#tabs button[data-tab="admin"]');
  await page.click('#refresh-models');
  await page.waitForFunction(() => document.getElementById('refresh-models').disabled === false);

  await expect(page.locator('#or-catalog-status')).toContainText('recommendation update failed');
  expect(await selectedValue(page, 'cfg-text-model')).toBe('anthropic/claude-sonnet-4');
  expect((await selectValues(page, 'cfg-text-model')).length).toBeGreaterThan(5);
  expect(errors).toEqual([]);
});

/* ========================
   Appearance, contrast, smoke, and mobile layout
   ======================== */

test('THEME-H/I/J: dark defaults, header toggle persists light and dark', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  expect(await page.getAttribute('html', 'data-theme')).toBe('dark');
  await expect(page.locator('#theme-toggle')).toHaveAttribute('aria-label', 'Switch to light theme');

  await page.click('#theme-toggle');
  expect(await page.getAttribute('html', 'data-theme')).toBe('light');
  await page.reload({ waitUntil: 'domcontentloaded' });
  expect(await page.getAttribute('html', 'data-theme')).toBe('light');

  await page.click('#theme-toggle');
  expect(await page.getAttribute('html', 'data-theme')).toBe('dark');
  await page.reload({ waitUntil: 'domcontentloaded' });
  expect(await page.getAttribute('html', 'data-theme')).toBe('dark');
  expect(errors).toEqual([]);
});

test('THEME-K/L: both themes meet contrast targets and retain surface/control hierarchy', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.click('nav#tabs button[data-tab="admin"]');

  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => window.__WFR_TEST__.applyTheme(theme), theme);
    const audit = await page.evaluate(() => {
      const rgb = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const lum = value => {
        const c = rgb(value).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const body = getComputedStyle(document.body);
      const card = getComputedStyle(document.querySelector('.card'));
      const muted = getComputedStyle(document.querySelector('#or-catalog-status'));
      const primary = getComputedStyle(document.querySelector('#test-llm'));
      const panel = getComputedStyle(document.querySelector('.recommendation-panel'));
      const input = getComputedStyle(document.querySelector('#cfg-or-key'));
      return {
        body: ratio(body.color, body.backgroundColor),
        card: ratio(card.color, card.backgroundColor),
        muted: ratio(muted.color, card.backgroundColor),
        primary: ratio(primary.color, primary.backgroundColor),
        pageBg: body.backgroundColor, cardBg: card.backgroundColor, panelBg: panel.backgroundColor,
        inputBg: input.backgroundColor, inputBorder: input.borderTopColor,
        inputBorderContrast: ratio(input.borderTopColor, input.backgroundColor)
      };
    });
    expect(audit.body, `${theme} body contrast`).toBeGreaterThanOrEqual(4.5);
    expect(audit.card, `${theme} card contrast`).toBeGreaterThanOrEqual(4.5);
    expect(audit.muted, `${theme} muted contrast`).toBeGreaterThanOrEqual(4.5);
    expect(audit.primary, `${theme} primary contrast`).toBeGreaterThanOrEqual(4.5);
    expect(audit.pageBg).not.toBe(audit.cardBg);
    expect(audit.cardBg).not.toBe(audit.panelBg);
    expect(audit.inputBg).not.toBe(audit.inputBorder);
    expect(audit.inputBorderContrast).toBeGreaterThanOrEqual(3);
  }
  expect(errors).toEqual([]);
});

test('THEME-M/N: core tabs smoke in both themes and 320/375/430px have no body overflow', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');

  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => window.__WFR_TEST__.applyTheme(theme), theme);
    for (const tab of ['capture', 'review', 'admin', 'history', 'map']) {
      await page.evaluate(tab => document.querySelector(`nav#tabs button[data-tab="${tab}"]`).click(), tab);
      await page.waitForTimeout(40);
      await expect(page.locator(`#tab-${tab}`)).toHaveClass(/active/);
    }
    for (const width of [320, 375, 430]) {
      await page.setViewportSize({ width, height: 820 });
      for (const tab of ['capture', 'review', 'admin']) {
        await page.evaluate(tab => document.querySelector(`nav#tabs button[data-tab="${tab}"]`).click(), tab);
        const dimensions = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
          offenders: Array.from(document.querySelectorAll('body *')).map(el => {
            const rect = el.getBoundingClientRect();
            return { tag: el.tagName, id: el.id, cls: el.className, left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
          }).filter(x => x.right > document.documentElement.clientWidth + 1 || x.left < -1).slice(0, 8)
        }));
        expect(dimensions.scroll, `${theme} ${width}px ${tab}: ${JSON.stringify(dimensions.offenders)}`).toBeLessThanOrEqual(dimensions.client);
      }
    }
  }
  expect(errors).toEqual([]);
});

/* ---------- .7 local outing tracker / JSON exchange ---------- */

async function installMockGeolocation(page) {
  await page.addInitScript(() => {
    const state = { watches: 0, clears: [], success: null, failure: null };
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      watchPosition(success, failure) { state.watches++; state.success = success; state.failure = failure; return 700 + state.watches; },
      clearWatch(id) { state.clears.push(id); },
      getCurrentPosition(success) { success({ timestamp: Date.now(), coords: { latitude: 38.35, longitude: -87.57, accuracy: 8, altitude: null, altitudeAccuracy: null, heading: null, speed: null } }); }
    }});
    window.__geoState = state;
    window.__emitGeo = (timestamp, latitude, longitude, accuracy = 8, extras = {}) => state.success && state.success({ timestamp, coords: { latitude, longitude, accuracy, altitude:null, altitudeAccuracy:null, heading:null, speed:null, ...extras } });
    window.__failGeo = message => state.failure && state.failure({ code: 2, message });
  });
}

test('OUTING-A–H: lifecycle starts one watcher, throttles noise, stores movement, and finalizes once', async ({ page }) => {
  const errors = collectErrors(page); blockExternal(page); await installMockGeolocation(page);
  await openCaptureTab(page);
  const result = await page.evaluate(async () => {
    const T = window.__WFR_TEST__, t = Date.now();
    const first = await T.startOuting();
    const second = await T.startOuting();
    window.__emitGeo(t, 38.35120, -87.57182, 12);
    window.__emitGeo(t + 1000, 38.35120, -87.57182, 12);
    window.__emitGeo(t + 6000, 38.35135, -87.57160, 12);
    await new Promise(r => setTimeout(r, 80));
    const during = await T.db.outingPoints.where('outingLocalId').equals(first.localOutingId).count();
    await T.stopOuting(); await T.stopOuting();
    return { same:first.localOutingId===second.localOutingId, during, watches:window.__geoState.watches, clears:window.__geoState.clears.length, outing:await T.db.outings.get(first.localOutingId), pointer:localStorage.getItem('wfr_active_outing_id') };
  });
  expect(result.same).toBe(true); expect(result.watches).toBe(1); expect(result.during).toBe(2); expect(result.clears).toBe(1);
  expect(result.outing.status).toBe('completed'); expect(result.outing.endedAt).toBeGreaterThan(result.outing.startedAt); expect(result.pointer).toBeNull();
  expect(errors).toEqual([]);
});

test('OUTING-I/J: reload resumes an unfinished outing and GPS failure stays non-destructive', async ({ page }) => {
  const errors = collectErrors(page); blockExternal(page); await installMockGeolocation(page); await openCaptureTab(page);
  const id = await page.evaluate(async () => (await window.__WFR_TEST__.startOuting()).localOutingId);
  await page.reload({ waitUntil:'domcontentloaded' }); await page.waitForFunction(() => window.__WFR_TEST__.getActiveOuting());
  const state = await page.evaluate(async id => {
    window.__failGeo('Position unavailable'); await new Promise(r => setTimeout(r, 20));
    return { id:window.__WFR_TEST__.getActiveOuting().localOutingId, watches:window.__geoState.watches, status:(await window.__WFR_TEST__.db.outings.get(id)).status, text:document.querySelector('#outing-state').textContent };
  }, id);
  expect(state.id).toBe(id); expect(state.watches).toBe(1); expect(state.status).toBe('active'); expect(state.text).toContain('temporarily unavailable');
  await page.evaluate(() => window.__WFR_TEST__.stopOuting()); expect(errors).toEqual([]);
});

test('OUTING-K–N: v2 stores preserve observations and deleting an outing removes only its points', async ({ page }) => {
  blockExternal(page); await page.goto(PAGE_URL, { waitUntil:'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const T=window.__WFR_TEST__, now=Date.now(), id='outing-delete-test';
    T.db.close(); await Dexie.delete('WildlifeFieldRecorder');
    const oldDb=new Dexie('WildlifeFieldRecorder'); oldDb.version(1).stores({observations:'localId, createdAt, submitStatus, category, tripLocalId',audioBlobs:'blobId',trips:'localTripId, startedAt, submitStatus',photos:'localPhotoId, observationLocalId, uploadStatus',logs:'++id, timestamp'});
    await oldDb.open(); await oldDb.observations.put({ localId:'keep-observation', createdAt:now, submitStatus:'local', outingLocalId:id }); await oldDb.close();
    await T.db.open();
    await T.db.outings.put({ localOutingId:id, startedAt:now, endedAt:now+1000, status:'completed', source:'wfr_local' });
    await T.db.outingPoints.put({ localPointId:'delete-point', outingLocalId:id, timestamp:now, latitude:1, longitude:2 });
    const stores=T.db.tables.map(t=>t.name);
    await T.deleteOuting(id,false);
    return { stores, observation:await T.db.observations.get('keep-observation'), outing:await T.db.outings.get(id), points:await T.db.outingPoints.where('outingLocalId').equals(id).count() };
  });
  expect(result.stores).toEqual(expect.arrayContaining(['outings','outingPoints','observations']));
  expect(result.observation.localId).toBe('keep-observation'); expect(result.outing).toBeUndefined(); expect(result.points).toBe(0);
});

test('OUTING-O–S: export is sorted, minimal, and excludes observation content and credentials', async ({ page }) => {
  blockExternal(page); await page.goto(PAGE_URL, { waitUntil:'domcontentloaded' });
  const exported = await page.evaluate(async () => {
    const T=window.__WFR_TEST__, id='outing-export', base=Date.parse('2026-08-25T18:03:17Z');
    T.settings.llmKey='secret-key'; T.settings.token='secret-token';
    await T.db.outings.put({ localOutingId:id, name:'Patoka Outing', startedAt:base, endedAt:base+60000, status:'completed', source:'wfr_local', timezoneAtStart:'America/Indiana/Indianapolis', utcOffsetSecondsAtStart:-14400 });
    await T.db.outingPoints.bulkPut([
      {localPointId:'p2',outingLocalId:id,timestamp:base+2000,latitude:38.2,longitude:-87.2,kind:'breadcrumb'},
      {localPointId:'p1',outingLocalId:id,timestamp:base+1000,latitude:38.1,longitude:-87.1,kind:'breadcrumb'}
    ]);
    await T.db.observations.put({localId:'anchor',outingLocalId:id,createdAt:base+1500,startedAt:base+1500,latitude:38.15,longitude:-87.15,accuracyMeters:9,transcript:'private transcript',userNoteText:'private note',submitStatus:'local'});
    return T.buildOutingTrackExport(id);
  });
  expect(exported.format).toBe('wfr-outing-track'); expect(exported.version).toBe(1);
  expect(exported.points.map(p=>Date.parse(p.timestamp))).toEqual([...exported.points.map(p=>Date.parse(p.timestamp))].sort((a,b)=>a-b));
  expect(exported.points.some(p=>p.kind==='observation_anchor')).toBe(true);
  const text=JSON.stringify(exported); expect(text).not.toContain('private transcript'); expect(text).not.toContain('private note'); expect(text).not.toContain('secret-key'); expect(text).not.toContain('secret-token');
});

test('OUTING-T–X: import validates format/coordinates, avoids ID collision, persists, and renders history', async ({ page }) => {
  const errors=collectErrors(page); blockExternal(page); await page.goto(PAGE_URL,{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async () => {
    const T=window.__WFR_TEST__, payload={format:'wfr-outing-track',version:1,outing:{id:'same-source',name:'Hank track',startedAt:'2026-08-25T18:03:17Z',endedAt:'2026-08-25T18:04:17Z',timezone:'America/Indiana/Indianapolis',utcOffsetSeconds:-14400},points:[{timestamp:'2026-08-25T18:03:21Z',latitude:38.351284,longitude:-87.571623,accuracyMeters:8.4}]};
    const a=await T.importOutingTrackData(payload), b=await T.importOutingTrackData(payload);
    let badFormat='',badCoords=''; try{T.validateOutingTrackJson({...payload,format:'other'})}catch(e){badFormat=e.message} try{T.validateOutingTrackJson({...payload,points:[{timestamp:'2026-08-25T18:03:21Z',latitude:999,longitude:0}]})}catch(e){badCoords=e.message}
    await T.loadOutingHistory(); return {a:a.localOutingId,b:b.localOutingId,badFormat,badCoords,count:await T.db.outings.where('source').equals('wfr_imported').count(),html:document.querySelector('#outing-history-list').textContent};
  });
  expect(result.a).not.toBe(result.b); expect(result.count).toBe(2); expect(result.badFormat).toContain('not a WFR'); expect(result.badCoords).toContain('invalid'); expect(result.html).toContain('Hank track'); expect(result.html).toContain('Imported'); expect(errors).toEqual([]);
});

test('OUTING-Y/AD: sanitized wall time resolves against local provider with explicit provenance', async ({ page }) => {
  blockExternal(page); await page.goto(PAGE_URL,{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async () => {
    const T=window.__WFR_TEST__, id='local-provider', base=Date.parse('2026-08-25T18:32:10Z');
    await T.db.outings.put({localOutingId:id,startedAt:base,endedAt:base+40000,status:'completed',source:'wfr_local',timezoneAtStart:'America/Indiana/Indianapolis',utcOffsetSecondsAtStart:-14400});
    await T.db.outingPoints.bulkPut([{localPointId:'a',outingLocalId:id,timestamp:base,latitude:38.35120,longitude:-87.57182,accuracyMeters:8,utcOffsetSeconds:-14400},{localPointId:'b',outingLocalId:id,timestamp:base+40000,latitude:38.35135,longitude:-87.57160,accuracyMeters:8,utcOffsetSeconds:-14400}]);
    const r=await T.getBreadcrumbCandidates({source:'filename',pattern:'samsung_img',confidence:'medium_high',wallIso:'2026-08-25T14:32:30'}); return {r,p:T.breadcrumbProvenance({source:'filename',pattern:'samsung_img',confidence:'medium_high',wallIso:'2026-08-25T14:32:30'},r)};
  });
  expect(result.r.status).toBe('resolved'); expect(result.r.provider).toBe('wfr_outing_track'); expect(result.r.method).toBe('breadcrumb_interpolated'); expect(result.p.providerOutingId).toBe('local-provider');
});

test('OUTING-Z/AA/AE/AF: imported track powers sanitized photo, weather, vision, and taxonomy without Safari', async ({ page }) => {
  const errors=collectErrors(page); blockExternal(page); const weather=await mockMeteo(page); const vision=await mockVision(page); await mockGbif(page);
  let safariCalls=0; await page.route('**/breadcrumbs**', route=>{safariCalls++; return route.abort();});
  await openCaptureTab(page);
  await page.evaluate(async ({pngB64}) => {
    const T=window.__WFR_TEST__, base=Date.parse('2026-08-25T18:32:10Z'); T.settings.llmKey='test-key';
    await T.importOutingTrackData({format:'wfr-outing-track',version:1,outing:{id:'hank',name:'Hank track',startedAt:new Date(base).toISOString(),endedAt:new Date(base+30000).toISOString(),timezone:'America/Indiana/Indianapolis',utcOffsetSeconds:-14400},points:[0,5,10,15].map((s,i)=>({timestamp:new Date(base+s*1000).toISOString(),latitude:38.35120+i*.00004,longitude:-87.57182+i*.00007,accuracyMeters:8,utcOffsetSeconds:-14400}))});
    window.exifr.parse=async()=>({}); const bin=Uint8Array.from(atob(pngB64),c=>c.charCodeAt(0));
    await T.importPhotoFile(new File([bin],'IMG_20260825_143218.jpg',{type:'image/png',lastModified:Date.now()}));
  },{pngB64:PNG.toString('base64')});
  await dbWait(page, `obs => obs.weatherStatus === 'ok' && obs.classificationStatus === 'done' && obs.photoEnrichment.taxonomy === 'done'`);
  const obs=await getObs(page); expect(obs.locationProvenance.provider).toBe('wfr_imported_track'); expect(obs.gpsSource).toMatch(/^breadcrumb_/); expect(obs.weatherStatus).toBe('ok'); expect(obs.subjectCommonName).toBe('Red-tailed Hawk'); expect(obs.taxonomy.status).toBe('ok'); expect(safariCalls).toBe(0); expect(weather.calls.length).toBeGreaterThan(0); expect(vision.calls).toHaveLength(1); expect(errors).toEqual([]);
});

test('OUTING-AB/AC: Safari remains fallback while EXIF still bypasses every provider', async ({ page }) => {
  blockExternal(page); await page.goto(PAGE_URL,{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async () => {
    const T=window.__WFR_TEST__; T.settings.token='';
    const noTrack=await T.getBreadcrumbCandidates({source:'filename',confidence:'medium',wallIso:'2026-08-25T14:00:00'});
    await T.db.observations.put({localId:'exif-bypass',createdAt:Date.now(),latitude:1,longitude:2,gpsSource:'exif',timeProvenance:{source:'exif_DateTimeOriginal'},photoEnrichment:{location:'pending'}});
    await T.runBreadcrumbRecoveryStage('exif-bypass'); return {noTrack,obs:await T.db.observations.get('exif-bypass')};
  });
  expect(result.noTrack.reason).toContain('Safari breadcrumb source is not configured'); expect(result.obs.latitude).toBe(1); expect(result.obs.photoEnrichment.location).toBe('pending');
});

/* ---------- Pixel UTC semantics, filename hypotheses, Safari fallback (2026.08.30.11) ---------- */

const INDIANA_OUTING = {
  format: 'wfr-outing-track', version: 1,
  outing: { id: 'indiana', name: 'Indiana outing', startedAt: '2026-08-28T22:00:00Z', endedAt: '2026-08-29T00:30:00Z', timezone: 'America/Indiana/Indianapolis', utcOffsetSeconds: -14400 },
  points: [
    { timestamp: '2026-08-28T23:17:40Z', latitude: 38.35120, longitude: -87.57182, accuracyMeters: 8, utcOffsetSeconds: -14400 },
    { timestamp: '2026-08-28T23:19:40Z', latitude: 38.35135, longitude: -87.57160, accuracyMeters: 8, utcOffsetSeconds: -14400 }
  ]
};

async function importIndianaOutingAndPhoto(page, filename) {
  await page.evaluate(async ({ pngB64, outingJson, photoName }) => {
    const T = window.__WFR_TEST__;
    T.settings.llmKey = 'sk-or-test';
    await T.importOutingTrackData(outingJson);
    window.exifr.parse = async () => ({});
    const bin = Uint8Array.from(atob(pngB64), c => c.charCodeAt(0));
    await T.importPhotoFile(new File([bin], photoName, { type: 'image/jpeg', lastModified: Date.now() }));
  }, { pngB64: PNG.toString('base64'), outingJson: INDIANA_OUTING, photoName: filename });
}

test('PIXEL-UTC: PXL filename is absolute UTC, matches outing track, Safari never called', async ({ page }) => {
  const errors = collectErrors(page); blockExternal(page);
  const weather = await mockMeteo(page); const vision = await mockVision(page); await mockGbif(page);
  seedSettings(page.context(), { token: 'lab-test', breadcrumbResource: 'breadcrumbs', llmKey: 'sk-or-test' });
  let safariCalls = 0;
  await page.route('**/breadcrumbs**', route => { safariCalls++; return route.abort(); });
  await openCaptureTab(page);
  await importIndianaOutingAndPhoto(page, 'PXL_20260828_231840123.jpg');
  await dbWait(page, `obs => obs.weatherStatus === 'ok' && obs.classificationStatus === 'done' && obs.photoEnrichment.taxonomy === 'done'`);
  const obs = await getObs(page);
  expect(obs.createdAt).toBe(Date.parse('2026-08-28T23:18:40.123Z'));
  expect(obs.createdAt).not.toBe(Date.parse('2026-08-29T03:18:40.123Z'));
  expect(obs.timeProvenance).toMatchObject({
    source: 'filename', pattern: 'pixel_pxl', timeBasis: 'utc',
    timeBasisResolution: 'known_filename_semantics',
    utcIso: '2026-08-28T23:18:40.123Z', wallIso: '2026-08-28T19:18:40',
    timezone: 'America/Indiana/Indianapolis'
  });
  expect(obs.locationProvenance.provider).toBe('wfr_imported_track');
  expect(obs.gpsSource).toMatch(/^breadcrumb_/);
  expect(obs.latitude).toBeCloseTo(38.351275, 4);
  expect(obs.longitude).toBeCloseTo(-87.57171, 4);
  expect(safariCalls).toBe(0);
  expect(weather.calls.length).toBeGreaterThan(0);
  const summary = await page.locator('#import-evidence-summary').innerText();
  expect(summary).toContain('7:18:40');
  expect(summary).toContain('UTC filename');
  expect(errors).toEqual([]);
});

test('PIXEL-SAMSUNG: IMG filename resolves as outing-local wall time via track corroboration', async ({ page }) => {
  const errors = collectErrors(page); blockExternal(page);
  const weather = await mockMeteo(page); const vision = await mockVision(page); await mockGbif(page);
  seedSettings(page.context(), { token: 'lab-test', breadcrumbResource: 'breadcrumbs', llmKey: 'sk-or-test' });
  let safariCalls = 0;
  await page.route('**/breadcrumbs**', route => { safariCalls++; return route.abort(); });
  await openCaptureTab(page);
  await importIndianaOutingAndPhoto(page, 'IMG_20260828_191840.jpg');
  await dbWait(page, `obs => obs.weatherStatus === 'ok' && obs.classificationStatus === 'done'`);
  const obs = await getObs(page);
  expect(obs.createdAt).toBe(Date.parse('2026-08-28T23:18:40.000Z'));
  expect(obs.timeProvenance).toMatchObject({
    source: 'filename', pattern: 'samsung_img', timeBasis: 'local_wall',
    timeBasisResolution: 'breadcrumb_corroborated',
    utcIso: '2026-08-28T23:18:40.000Z', wallIso: '2026-08-28T19:18:40'
  });
  expect(obs.locationProvenance.provider).toBe('wfr_imported_track');
  expect(safariCalls).toBe(0);
  const summary = await page.locator('#import-evidence-summary').innerText();
  expect(summary).toContain('track-corroborated local time');
  expect(errors).toEqual([]);
});

test('PICKER-E2E: sanitized image-picker selection with Pixel filename fully recovers via imported outing', async ({ page }) => {
  const errors = collectErrors(page); blockExternal(page);
  const weather = await mockMeteo(page); const vision = await mockVision(page); await mockGbif(page);
  seedSettings(page.context(), { token: 'lab-test', breadcrumbResource: 'breadcrumbs', llmKey: 'sk-or-test' });
  let safariCalls = 0;
  await page.route('**/breadcrumbs**', route => { safariCalls++; return route.abort(); });
  await openCaptureTab(page);
  await page.evaluate(async outingJson => {
    const T = window.__WFR_TEST__;
    T.settings.llmKey = 'sk-or-test';
    await T.importOutingTrackData(outingJson);
    window.exifr.parse = async () => ({});
  }, INDIANA_OUTING);
  // Simulate the new normal Android photo-picker flow end to end.
  const chooserPromise = page.waitForEvent('filechooser');
  await page.click('#import-photo-btn');
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'PXL_20260828_231840123.jpg', mimeType: 'image/jpeg', buffer: PNG });
  await dbWait(page, `obs => obs.weatherStatus === 'ok' && obs.classificationStatus === 'done' && obs.photoEnrichment.taxonomy === 'done'`);
  const obs = await getObs(page);
  expect(obs.timeProvenance).toMatchObject({ pattern: 'pixel_pxl', timeBasis: 'utc', utcIso: '2026-08-28T23:18:40.123Z' });
  expect(obs.locationProvenance.provider).toBe('wfr_imported_track');
  expect(obs.gpsSource).toMatch(/^breadcrumb_/);
  expect(obs.latitude).toBeCloseTo(38.351275, 4);
  expect(obs.subjectCommonName).toBe('Red-tailed Hawk');
  expect(obs.taxonomy.status).toBe('ok');
  expect(await page.locator('#import-evidence-summary').innerText()).toContain('7:18:40');
  expect(safariCalls).toBe(0);
  expect(errors).toEqual([]);
});

test('HYPOTHESES-A/B: generic digits resolve by track coverage', async ({ page }) => {
  blockExternal(page); await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  const cases = await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    // Case A track: covers 23:18:40Z only.
    await T.db.outings.put({ localOutingId: 'hyp-a', startedAt: Date.parse('2026-08-28T23:00:00Z'), endedAt: Date.parse('2026-08-28T23:40:00Z'), status: 'completed', source: 'wfr_local', timezoneAtStart: 'America/Indiana/Indianapolis', utcOffsetSecondsAtStart: -14400 });
    await T.db.outingPoints.bulkPut([
      { localPointId: 'hyp-a-0', outingLocalId: 'hyp-a', timestamp: Date.parse('2026-08-28T23:17:40Z'), latitude: 38.35120, longitude: -87.57182, accuracyMeters: 8, utcOffsetSeconds: -14400 },
      { localPointId: 'hyp-a-1', outingLocalId: 'hyp-a', timestamp: Date.parse('2026-08-28T23:19:40Z'), latitude: 38.35135, longitude: -87.57160, accuracyMeters: 8, utcOffsetSeconds: -14400 }
    ]);
    // Case B track: covers 23:18:40Z (19:18:40 local) only.
    await T.db.outings.put({ localOutingId: 'hyp-b', startedAt: Date.parse('2026-08-28T23:00:00Z'), endedAt: Date.parse('2026-08-28T23:40:00Z'), status: 'completed', source: 'wfr_local', timezoneAtStart: 'America/Indiana/Indianapolis', utcOffsetSecondsAtStart: -14400 });
    await T.db.outingPoints.bulkPut([
      { localPointId: 'hyp-b-0', outingLocalId: 'hyp-b', timestamp: Date.parse('2026-08-28T23:17:40Z'), latitude: 38.35120, longitude: -87.57182, accuracyMeters: 8, utcOffsetSeconds: -14400 },
      { localPointId: 'hyp-b-1', outingLocalId: 'hyp-b', timestamp: Date.parse('2026-08-28T23:19:40Z'), latitude: 38.35135, longitude: -87.57160, accuracyMeters: 8, utcOffsetSeconds: -14400 }
    ]);
    const evidence = wall => ({ source: 'filename', pattern: 'generic_yyyymmdd_hhmmss', timeBasisHint: 'unknown', confidence: 'medium', wallIso: wall, utcIso: null });
    return {
      utcChosen: await T.getBreadcrumbCandidates(evidence('2026-08-28T23:18:40')),
      localChosen: await T.getBreadcrumbCandidates(evidence('2026-08-28T19:18:40'))
    };
  });
  // Case A: UTC interpretation wins (local-wall would be ~4h outside the track).
  expect(cases.utcChosen.status).toBe('resolved');
  expect(cases.utcChosen.timestamp).toBe(Date.parse('2026-08-28T23:18:40Z'));
  expect(cases.utcChosen.filenameBasis).toMatchObject({ timeBasis: 'utc', resolution: 'breadcrumb_corroborated' });
  // Case B: outing-local interpretation wins.
  expect(cases.localChosen.status).toBe('resolved');
  expect(cases.localChosen.timestamp).toBe(Date.parse('2026-08-28T23:18:40Z'));
  expect(cases.localChosen.filenameBasis).toMatchObject({ timeBasis: 'local_wall', offsetSeconds: -14400, resolution: 'breadcrumb_corroborated' });
});

test('HYPOTHESES-C: both interpretations covered equally becomes ambiguous for review', async ({ page }) => {
  blockExternal(page); await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  const ambiguous = await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    await T.db.outings.put({ localOutingId: 'hyp-c2', startedAt: Date.parse('2026-08-28T18:00:00Z'), endedAt: Date.parse('2026-08-29T00:30:00Z'), status: 'completed', source: 'wfr_local', timezoneAtStart: 'America/Indiana/Indianapolis', utcOffsetSecondsAtStart: -14400 });
    await T.db.outingPoints.bulkPut([
      { localPointId: 'hyp-c2-0', outingLocalId: 'hyp-c2', timestamp: Date.parse('2026-08-28T19:17:40Z'), latitude: 38.35120, longitude: -87.57182, accuracyMeters: 8, utcOffsetSeconds: -14400 },
      { localPointId: 'hyp-c2-1', outingLocalId: 'hyp-c2', timestamp: Date.parse('2026-08-28T19:19:40Z'), latitude: 38.35121, longitude: -87.57180, accuracyMeters: 8, utcOffsetSeconds: -14400 },
      { localPointId: 'hyp-c2-2', outingLocalId: 'hyp-c2', timestamp: Date.parse('2026-08-28T23:17:40Z'), latitude: 38.35134, longitude: -87.57162, accuracyMeters: 8, utcOffsetSeconds: -14400 },
      { localPointId: 'hyp-c2-3', outingLocalId: 'hyp-c2', timestamp: Date.parse('2026-08-28T23:19:40Z'), latitude: 38.35135, longitude: -87.57160, accuracyMeters: 8, utcOffsetSeconds: -14400 }
    ]);
    return T.getBreadcrumbCandidates({ source: 'filename', pattern: 'generic_yyyymmdd_hhmmss', timeBasisHint: 'unknown', confidence: 'medium', wallIso: '2026-08-28T19:18:40', utcIso: null });
  });
  expect(ambiguous.status).toBe('ambiguous');
  expect(ambiguous.reason).toMatch(/ambigu|Review the capture time/i);
});

test('HYPOTHESIS-OFFSET: local-wall resolution uses the relevant point offset, not the outing start offset', async ({ page }) => {
  blockExternal(page); await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    // Outing starts at UTC-4 but its points record UTC-5 (travel/DST change).
    await T.db.outings.put({ localOutingId: 'dst-outing', startedAt: Date.parse('2026-08-28T23:00:00Z'), endedAt: Date.parse('2026-08-29T01:00:00Z'), status: 'completed', source: 'wfr_local', timezoneAtStart: 'America/Indiana/Indianapolis', utcOffsetSecondsAtStart: -14400 });
    await T.db.outingPoints.bulkPut([
      { localPointId: 'dst-0', outingLocalId: 'dst-outing', timestamp: Date.parse('2026-08-29T00:17:40Z'), latitude: 38.35120, longitude: -87.57182, accuracyMeters: 8, utcOffsetSeconds: -18000 },
      { localPointId: 'dst-1', outingLocalId: 'dst-outing', timestamp: Date.parse('2026-08-29T00:19:40Z'), latitude: 38.35135, longitude: -87.57160, accuracyMeters: 8, utcOffsetSeconds: -18000 }
    ]);
    return T.getBreadcrumbCandidates({ source: 'filename', pattern: 'generic_yyyymmdd_hhmmss', timeBasisHint: 'unknown', confidence: 'medium', wallIso: '2026-08-28T19:18:40', utcIso: null });
  });
  expect(result.status).toBe('resolved');
  expect(result.timestamp).toBe(Date.parse('2026-08-29T00:18:40Z'));
  expect(result.filenameBasis).toMatchObject({ timeBasis: 'local_wall', offsetSeconds: -18000, resolution: 'breadcrumb_corroborated' });
});

const TZ_RESULTS = [];
for (const tz of ['UTC', 'America/Indiana/Indianapolis', 'America/Denver']) {
  test.describe(`cross-timezone independence (${tz})`, () => {
    test.use({ timezoneId: tz });
    test('identical Pixel + outing fixture resolves identically', async ({ page }) => {
      const errors = collectErrors(page); blockExternal(page);
      seedSettings(page.context(), { token: 'lab-test', breadcrumbResource: 'breadcrumbs', llmKey: '' });
      await page.route('**/breadcrumbs**', route => route.abort());
      await openCaptureTab(page);
      await importIndianaOutingAndPhoto(page, 'PXL_20260828_231840123.jpg');
      await dbWait(page, `obs => obs.gpsSource && obs.gpsSource.indexOf('breadcrumb_') === 0`);
      const obs = await getObs(page);
      TZ_RESULTS.push({
        tz,
        createdAt: obs.createdAt,
        latitude: obs.latitude,
        longitude: obs.longitude,
        utcIso: obs.timeProvenance.utcIso,
        timeBasis: obs.timeProvenance.timeBasis,
        timeBasisResolution: obs.timeProvenance.timeBasisResolution
      });
      expect(obs.createdAt).toBe(Date.parse('2026-08-28T23:18:40.123Z'));
      if (TZ_RESULTS.length === 3) {
        const comparable = r => ({ createdAt: r.createdAt, latitude: r.latitude, longitude: r.longitude, utcIso: r.utcIso, timeBasis: r.timeBasis, timeBasisResolution: r.timeBasisResolution });
        expect(comparable(TZ_RESULTS[1])).toEqual(comparable(TZ_RESULTS[0]));
        expect(comparable(TZ_RESULTS[2])).toEqual(comparable(TZ_RESULTS[0]));
        expect(TZ_RESULTS[0].latitude).toBeCloseTo(38.351275, 4);
      }
      expect(errors).toEqual([]);
    });
  });
}

test('SAFARI-A: HTTP 400 resource-not-found is graceful provider unavailable and never blocks vision', async ({ page }) => {
  const errors = collectErrors(page); blockExternal(page);
  const vision = await mockVision(page);
  seedSettings(page.context(), { token: 'lab-test', breadcrumbResource: 'breadcrumbs', llmKey: 'sk-or-test' });
  await page.route('**/wildlife-field-recorder/breadcrumbs**', route => route.fulfill({
    status: 400, contentType: 'application/json',
    body: JSON.stringify({ detail: 'Resource not found: wildlife-field-recorder/breadcrumbs' })
  }));
  await openCaptureTab(page);
  await page.evaluate(async pngB64 => {
    const T = window.__WFR_TEST__;
    window.exifr.parse = async () => ({});
    const bin = Uint8Array.from(atob(pngB64), c => c.charCodeAt(0));
    await T.importPhotoFile(new File([bin], 'PXL_20260828_231840123.jpg', { type: 'image/jpeg', lastModified: Date.now() }));
  }, PNG.toString('base64'));
  await dbWait(page, `obs => obs.photoEnrichment.location === 'unavailable' && obs.classificationStatus === 'done'`);
  const obs = await getObs(page);
  expect(obs.locationResolutionError).toBe('Safari breadcrumb source unavailable');
  expect(obs.locationResolutionError).not.toMatch(/HTTP/);
  expect(obs.latitude).toBeNull();
  // One photo-identification request (the other chat/completions call is the
  // unrelated model-recommendation job that runs on load with a stored key).
  const photoVisionCalls = vision.calls.filter(c => (c.messages || []).some(m => Array.isArray(m.content)));
  expect(photoVisionCalls).toHaveLength(1);
  // The browser's own network log may mention the 400, but the page must not
  // surface it as an error or destroy the import.
  expect(errors.filter(e => !/Failed to load resource.*400/.test(e))).toEqual([]);
});

test('SAFARI-B: HTTP 404 resource-not-found is provider unavailable via the candidate API', async ({ page }) => {
  blockExternal(page);
  await page.route('**/wildlife-field-recorder/breadcrumbs**', route => route.fulfill({
    status: 404, contentType: 'application/json',
    body: JSON.stringify({ detail: 'Resource not found: wildlife-field-recorder/breadcrumbs' })
  }));
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    T.settings.token = 'lab-test';
    T.settings.breadcrumbResource = 'breadcrumbs';
    return T.getBreadcrumbCandidates({ source: 'filename', pattern: 'pixel_pxl', timeBasis: 'utc', confidence: 'high', utcIso: '2026-08-28T23:18:40.123Z', wallIso: null });
  });
  expect(result.status).toBe('provider_unavailable');
  expect(result.reason).toBe('Safari breadcrumb source unavailable');
});

test('COPY-ID: completed identification with null confidence is not reported as pending', async ({ page }) => {
  blockExternal(page); await openCaptureTab(page);
  const doneHtml = await page.evaluate(() => window.__WFR_TEST__.reviewTop({
    localId: 'copy-done', timeProvenance: { source: 'exif_DateTimeOriginal', wallIso: '2026-08-28T19:18:40', utcIso: '2026-08-28T23:18:40.000Z', utcOffsetSeconds: -14400 },
    subjectCommonName: 'Fall Webworm', subjectScientificName: 'Hyphantria cunea',
    subjectConfidence: null, classificationStatus: 'done',
    photoEnrichment: { identification: 'done', location: 'ready' }
  }, ''));
  expect(doneHtml).not.toContain('pending or unavailable');
  expect(doneHtml).toContain('Fall Webworm');
  expect(doneHtml).toContain('confidence unavailable');
  const pendingHtml = await page.evaluate(() => window.__WFR_TEST__.reviewTop({
    localId: 'copy-pending', timeProvenance: { source: 'unknown' },
    subjectConfidence: null, classificationStatus: 'pending',
    photoEnrichment: { identification: 'pending' }
  }, ''));
  expect(pendingHtml).toContain('pending or unavailable');
});

/* ---------- Subject geometry (post-taxonomy photogrammetric estimate) ---------- */

/* Independent reference implementations of the geometry math (not the app's). */
function refFov(f, w, h) {
  const r = w / h, s = Math.sqrt(r * r + 1);
  const ew = 43.266 * r / s, eh = 43.266 / s;
  return { horizontal: 2 * Math.atan(ew / (2 * f)), vertical: 2 * Math.atan(eh / (2 * f)) };
}
function refRay(x, y, fov) {
  const nx = (x - 0.5) * 2, ny = (y - 0.5) * 2;
  const v = [nx * Math.tan(fov.horizontal / 2), ny * Math.tan(fov.vertical / 2), 1];
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
}
function refAngleDeg(a, b, fov) {
  const ra = refRay(a.x, a.y, fov), rb = refRay(b.x, b.y, fov);
  const dot = Math.min(1, Math.max(-1, ra[0] * rb[0] + ra[1] * rb[1] + ra[2] * rb[2]));
  return Math.acos(dot) * 180 / Math.PI;
}
function refDistance(size, angDeg) { const a = angDeg * Math.PI / 180; return size / (2 * Math.tan(a / 2)); }
function refDestPoint(lat, lon, brg, d) {
  const R = 6371008.8, toRad = x => x * Math.PI / 180;
  const p1 = toRad(lat), l1 = toRad(lon), th = toRad(brg), dl = d / R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(dl) + Math.cos(p1) * Math.sin(dl) * Math.cos(th));
  const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(dl) * Math.cos(p1), Math.cos(dl) - Math.sin(p1) * Math.sin(p2));
  return { latitude: p2 * 180 / Math.PI, longitude: ((l2 * 180 / Math.PI + 540) % 360) - 180 };
}
function refHaversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371008.8, toRad = x => x * Math.PI / 180;
  const dp = toRad(lat2 - lat1), dl = toRad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const GEO_POINTS = { a: { x: 0.5, y: 0.2 }, b: { x: 0.5, y: 0.7 } };
const GEO_PRIOR = { min: 0.9, typical: 1.05, max: 1.3 };
const GEO_CG = { focalLength35mm: 230, imageWidth: 4000, imageHeight: 3000, digitalZoomRatio: null, source: 'exif' };
const GEO_MEASUREMENT = {
  dimension: 'standing_height',
  pointA: GEO_POINTS.a, pointB: GEO_POINTS.b,
  subjectCenter: { x: 0.5, y: 0.45 },
  pose: 'standing, side-on', occlusion: 'minor', foreshortening: 'low',
  confidence: 0.82, notes: 'head and feet visible'
};
const GEOMETRY_JSON = {
  usable: true, reason: null, species: 'Ardea herodias', dimension: 'standing_height',
  physical_size_m: { min: 0.9, typical: 1.05, max: 1.3 },
  measurement: { point_a: GEO_POINTS.a, point_b: GEO_POINTS.b },
  subject_center: { x: 0.5, y: 0.45 },
  pose: 'standing, side-on', occlusion: 'minor', foreshortening: 'low',
  measurement_confidence: 0.82, life_stage: 'adult', notes: 'head and feet visible'
};

/** Vision mock that answers identification and geometry calls distinctly. */
async function mockVisionAndGeometry(page, geometryJson) {
  const state = { calls: [] };
  await page.route('**/chat/completions', async route => {
    const body = route.request().postDataJSON();
    state.calls.push(body);
    const isGeometry = JSON.stringify(body).includes('MEASUREMENT, not identification');
    const payload = isGeometry ? geometryJson : VISION_JSON;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }) });
  });
  return state;
}

test('GEO-FOV: deterministic field-of-view math for landscape and portrait', async ({ page }) => {
  blockExternal(page); await openCaptureTab(page);
  const result = await page.evaluate(() => {
    const T = window.__WFR_TEST__;
    return {
      landscape: T.fieldOfViewRadians(230, 4000, 3000),
      portrait: T.fieldOfViewRadians(230, 3000, 4000),
      square: T.fieldOfViewRadians(230, 2000, 2000),
      invalid: T.fieldOfViewRadians(0, 4000, 3000)
    };
  });
  const expL = refFov(230, 4000, 3000);
  expect(result.landscape.horizontal).toBeCloseTo(expL.horizontal, 9);
  expect(result.landscape.vertical).toBeCloseTo(expL.vertical, 9);
  const expP = refFov(230, 3000, 4000);
  expect(result.portrait.horizontal).toBeCloseTo(expP.horizontal, 9);
  expect(result.portrait.vertical).toBeCloseTo(expP.vertical, 9);
  // Portrait must swap the landscape FOVs (same diagonal, swapped aspect).
  expect(result.portrait.horizontal).toBeCloseTo(result.landscape.vertical, 9);
  expect(result.portrait.vertical).toBeCloseTo(result.landscape.horizontal, 9);
  expect(result.square.horizontal).toBeCloseTo(result.square.vertical, 9);
  expect(result.invalid).toBeNull();
});

test('GEO-RANGE: deterministic angular-size and distance math', async ({ page }) => {
  blockExternal(page); await openCaptureTab(page);
  const result = await page.evaluate(({ cg, m, prior }) => window.__WFR_TEST__.estimateSubjectRange(cg, m, prior),
    { cg: GEO_CG, m: GEO_MEASUREMENT, prior: GEO_PRIOR });
  const ang = refAngleDeg(GEO_POINTS.a, GEO_POINTS.b, refFov(230, 4000, 3000));
  expect(result.status).toBe('estimated');
  expect(result.angularSizeDegrees).toBeCloseTo(ang, 2);
  expect(result.distanceMetersPrecise.min).toBeCloseTo(refDistance(GEO_PRIOR.min, ang), 3);
  expect(result.distanceMetersPrecise.typical).toBeCloseTo(refDistance(GEO_PRIOR.typical, ang), 3);
  expect(result.distanceMetersPrecise.max).toBeCloseTo(refDistance(GEO_PRIOR.max, ang), 3);
  expect(result.distanceMeters.min).toBeCloseTo(refDistance(GEO_PRIOR.min, ang), 1);
  expect(result.distanceMeters.typical).toBeCloseTo(refDistance(GEO_PRIOR.typical, ang), 1);
  expect(result.distanceMeters.max).toBeCloseTo(refDistance(GEO_PRIOR.max, ang), 1);
  expect(result.confidence).toBe('medium');
});

test('GEO-SIZE: wider biological size range produces wider distance range', async ({ page }) => {
  blockExternal(page); await openCaptureTab(page);
  const ranges = await page.evaluate(({ cg, m }) => {
    const T = window.__WFR_TEST__;
    return {
      narrow: T.estimateSubjectRange(cg, m, { min: 0.9, typical: 1.05, max: 1.3 }),
      wide: T.estimateSubjectRange(cg, m, { min: 0.8, typical: 1.05, max: 1.6 })
    };
  }, { cg: GEO_CG, m: GEO_MEASUREMENT });
  const narrowWidth = ranges.narrow.distanceMetersPrecise.max - ranges.narrow.distanceMetersPrecise.min;
  const wideWidth = ranges.wide.distanceMetersPrecise.max - ranges.wide.distanceMetersPrecise.min;
  expect(wideWidth).toBeGreaterThan(narrowWidth);
  expect(ranges.narrow.distanceMeters.min).toBeLessThan(ranges.narrow.distanceMeters.typical);
  expect(ranges.narrow.distanceMeters.typical).toBeLessThan(ranges.narrow.distanceMeters.max);
});

test('GEO-ZOOM: ambiguous digital zoom preserves an optical envelope instead of double-applying', async ({ page }) => {
  blockExternal(page); await openCaptureTab(page);
  const result = await page.evaluate(({ cg, m, prior }) => {
    const T = window.__WFR_TEST__;
    return {
      optical: T.opticalFocalLengthRange(cg),
      range: T.estimateSubjectRange(cg, m, prior)
    };
  }, { cg: { ...GEO_CG, digitalZoomRatio: 1.4 }, m: GEO_MEASUREMENT, prior: GEO_PRIOR });
  expect(result.optical).toEqual({ min: 230, max: 322, digitalZoomAmbiguous: true });
  const ang230 = refAngleDeg(GEO_POINTS.a, GEO_POINTS.b, refFov(230, 4000, 3000));
  const ang322 = refAngleDeg(GEO_POINTS.a, GEO_POINTS.b, refFov(322, 4000, 3000));
  // Blind double-application would be a single distance at 322mm semantics;
  // the envelope instead spans from 230mm to 322mm focal semantics.
  expect(result.range.distanceMetersPrecise.min).toBeCloseTo(refDistance(GEO_PRIOR.min, ang230), 3);
  expect(result.range.distanceMetersPrecise.max).toBeCloseTo(refDistance(GEO_PRIOR.max, ang322), 3);
  expect(result.range.distanceMetersPrecise.max).toBeGreaterThan(refDistance(GEO_PRIOR.max, ang230));
  expect(result.range.uncertaintyReasons).toContain('digital zoom crop semantics ambiguous');
});

test('GEO-BEARING: frame offset correction against a known true camera direction', async ({ page }) => {
  blockExternal(page); await openCaptureTab(page);
  const result = await page.evaluate(fov => {
    const T = window.__WFR_TEST__;
    return {
      centered: T.subjectBearingFromFrame(270, 0.5, fov),
      right: T.subjectBearingFromFrame(270, 0.6, fov),
      wrap: T.subjectBearingFromFrame(359, 0.6, fov)
    };
  }, refFov(230, 4000, 3000));
  expect(result.centered.bearingDegreesTrue).toBeCloseTo(270, 9);
  const expectedOffset = Math.atan(0.2 * Math.tan(refFov(230, 4000, 3000).horizontal / 2)) * 180 / Math.PI;
  expect(result.right.offsetDegrees).toBeCloseTo(expectedOffset, 9);
  expect(result.right.bearingDegreesTrue).toBeCloseTo(270 + expectedOffset, 9);
  expect(result.wrap.bearingDegreesTrue).toBeCloseTo((359 + expectedOffset) % 360, 6);
});

test('GEO-GEO: spherical geodesic destination-point projection', async ({ page }) => {
  blockExternal(page); await openCaptureTab(page);
  const result = await page.evaluate(() => {
    const T = window.__WFR_TEST__;
    return {
      east: T.destinationPointDegrees(38.3512, -87.5718, 90, 100),
      north: T.destinationPointDegrees(38.3512, -87.5718, 0, 1000),
      dateline: T.destinationPointDegrees(10, 179.999, 90, 20000)
    };
  });
  const east = refDestPoint(38.3512, -87.5718, 90, 100);
  expect(result.east.latitude).toBeCloseTo(east.latitude, 12);
  expect(result.east.longitude).toBeCloseTo(east.longitude, 12);
  const north = refDestPoint(38.3512, -87.5718, 0, 1000);
  expect(result.north.latitude).toBeCloseTo(north.latitude, 12);
  expect(result.north.longitude).toBeCloseTo(north.longitude, 12);
  const dl = refDestPoint(10, 179.999, 90, 20000);
  expect(result.dateline.longitude).toBeCloseTo(dl.longitude, 9);
  expect(result.dateline.longitude).toBeLessThan(0); // wrapped across the antimeridian
});

test('GEO-VALIDATION: malformed model measurements are rejected, not ranged', async ({ page }) => {
  blockExternal(page); await openCaptureTab(page);
  const results = await page.evaluate(gj => {
    const T = window.__WFR_TEST__;
    const good = { ...gj };
    return {
      notUsable: T.validateSubjectMeasurementResponse({ usable: false, reason: 'severe occlusion — animal behind branches' }),
      badCoords: T.validateSubjectMeasurementResponse({ ...good, measurement: { point_a: { x: 1.4, y: 0.2 }, point_b: { x: 0.5, y: 0.7 } } }),
      invertedRange: T.validateSubjectMeasurementResponse({ ...good, physical_size_m: { min: 1.3, typical: 1.05, max: 0.9 } }),
      hugeRange: T.validateSubjectMeasurementResponse({ ...good, physical_size_m: { min: 0.1, typical: 1, max: 2 } }),
      lowConfidence: T.validateSubjectMeasurementResponse({ ...good, measurement_confidence: 0.2 }),
      nan: T.validateSubjectMeasurementResponse({ ...good, physical_size_m: { min: NaN, typical: 1, max: 2 } }),
      negative: T.validateSubjectMeasurementResponse({ ...good, physical_size_m: { min: -1, typical: 1, max: 2 } })
    };
  }, GEOMETRY_JSON);
  expect(results.notUsable.ok).toBe(false);
  expect(results.notUsable.reason).toMatch(/occlusion/);
  for (const key of ['badCoords', 'invertedRange', 'hugeRange', 'lowConfidence', 'nan', 'negative']) {
    expect(results[key].ok, key).toBe(false);
  }
});

test('GEO-BEARING-REF: true vs magnetic direction handling', async ({ page }) => {
  blockExternal(page); await openCaptureTab(page);
  const result = await page.evaluate(({ gj }) => {
    const T = window.__WFR_TEST__;
    const obs = { subjectScientificName: 'Ardea herodias', latitude: 38.3512, longitude: -87.5718, gpsSource: 'wfr_outing_track' };
    const geomResponse = T.subjectGeometryFromResponse;
    // Build capture geometry through the real EXIF normalization path.
    const mk = mode => {
      const exif = { FocalLengthIn35mmFormat: 230 };
      if (mode !== 'NO_DIRECTION') { exif.GPSImgDirection = 247; exif.GPSImgDirectionRef = mode; }
      return geomResponse(obs, T.normalizeCaptureGeometry(exif, 4000, 3000), gj, 'test-model');
    };
    return {
      trueNorth: mk('T'),
      magnetic: mk('M'),
      missing: mk('NO_DIRECTION'),
      refless: mk(null)
    };
  }, { gj: GEOMETRY_JSON });
  expect(result.trueNorth.bearingEstimate.status).toBe('estimated');
  expect(result.trueNorth.bearingEstimate.bearingDegreesTrue).toBe(247);
  expect(result.trueNorth.locationEstimate.status).toBe('estimated');
  // Magnetic: preserved as magnetic, never silently converted to true.
  expect(result.magnetic.bearingEstimate.status).toBe('magnetic_only');
  expect(result.magnetic.bearingEstimate.cameraDirectionDegreesMagnetic).toBe(247);
  expect(result.magnetic.bearingEstimate.reason).toMatch(/magnetic/i);
  expect(result.magnetic.locationEstimate).toBeNull();
  // Missing direction: range may exist, bearing and coordinates do not.
  expect(result.missing.rangeEstimate.status).toBe('estimated');
  expect(result.missing.bearingEstimate.status).toBe('unavailable');
  expect(result.missing.bearingEstimate.reason).toMatch(/direction not recorded/i);
  expect(result.missing.locationEstimate).toBeNull();
  // A direction value without a usable reference is also refused (conservative).
  expect(result.refless.bearingEstimate.status).toBe('unavailable');
  expect(result.refless.bearingEstimate.reason).toMatch(/neither true nor magnetic/i);
  expect(result.refless.locationEstimate).toBeNull();
});

async function seedGeometryObs(page, { geometryCalls = 0 } = {}) {
  await page.evaluate(async ({ geometryCalls }) => {
    const T = window.__WFR_TEST__;
    T.settings.llmKey = 'sk-or-test';
    await T.db.observations.put({
      localId: 'geo-obs', createdAt: Date.now(), startedAt: Date.now(),
      latitude: 38.3512, longitude: -87.5718, gpsSource: 'exif', gpsStatus: 'ok',
      subjectCommonName: 'Great Blue Heron', subjectScientificName: 'Ardea herodias',
      taxonomy: { status: 'ok', species: 'Ardea herodias', scientificName: 'Ardea herodias' },
      exif: { FocalLengthIn35mmFormat: 230, GPSImgDirection: 247, GPSImgDirectionRef: 'T', Orientation: 1 },
      photoLocalIds: ['geo-photo'], observationSource: 'photo_import',
      timeProvenance: { source: 'exif_DateTimeOriginal', wallIso: '2026-08-28T19:18:40', utcIso: '2026-08-28T23:18:40.000Z', utcOffsetSeconds: -14400 },
      photoEnrichment: { exif: 'done', location: 'ready', timestamp: 'ready', geocode: 'done', weather: 'done', identification: 'done', taxonomy: 'done', geometry: 'pending' }
    });
    await T.db.photos.put({ localPhotoId: 'geo-photo', observationLocalId: 'geo-obs', createdAt: Date.now(), width: 4000, height: 3000, mimeType: 'image/jpeg', uploadStatus: 'pending' });
    await T.db.audioBlobs.put({ blobId: 'geo-photo', blob: new Blob(['x'], { type: 'image/jpeg' }), mimeType: 'image/jpeg', sizeBytes: 1, createdAt: Date.now() });
  }, { geometryCalls });
}

async function mockGeometryRoute(page, geometryJson) {
  const state = { geometryCalls: 0 };
  await page.route('**/chat/completions', async route => {
    const body = route.request().postDataJSON();
    if (JSON.stringify(body).includes('MEASUREMENT, not identification')) {
      state.geometryCalls++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(geometryJson) } }] }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(VISION_JSON) } }] }) });
  });
  return state;
}

test('GEO-ORDER: geometry never starts before species-level taxonomy', async ({ page }) => {
  const errors = collectErrors(page); blockExternal(page);
  await openCaptureTab(page);
  await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    // Ambiguous taxonomy + optics present + geometry pending: must stay unavailable.
    await T.db.observations.put({
      localId: 'geo-order', createdAt: Date.now(), startedAt: Date.now(),
      subjectCommonName: 'Some heron', subjectScientificName: 'Ardea sp.',
      taxonomy: { status: 'ambiguous', matchType: 'FUZZY', scientificName: 'Ardea sp.' },
      exif: { FocalLengthIn35mmFormat: 230 },
      photoLocalIds: ['geo-order-photo'], observationSource: 'photo_import',
      photoEnrichment: { exif: 'done', location: 'ready', timestamp: 'ready', geocode: 'done', weather: 'done', identification: 'done', taxonomy: 'done', geometry: 'pending' }
    });
    await T.db.photos.put({ localPhotoId: 'geo-order-photo', observationLocalId: 'geo-order', createdAt: Date.now(), width: 4000, height: 3000, uploadStatus: 'pending' });
    await T.db.audioBlobs.put({ blobId: 'geo-order-photo', blob: new Blob(['x'], { type: 'image/jpeg' }), mimeType: 'image/jpeg', sizeBytes: 1, createdAt: Date.now() });
  });
  const geoRoute = await mockGeometryRoute(page, GEOMETRY_JSON);
  await page.evaluate(() => window.__WFR_TEST__.runSubjectGeometryStage('geo-order'));
  const obs = await page.evaluate(async () => (await window.__WFR_TEST__.db.observations.get('geo-order')));
  expect(obs.photoEnrichment.geometry).toBe('unavailable');
  expect(obs.subjectGeometry.status).toBe('unavailable');
  expect(obs.subjectGeometry.reason).toMatch(/taxonomy/i);
  expect(geoRoute.geometryCalls).toBe(0); // no geometry model call
  expect(errors).toEqual([]);
});

test('GEO-NOOPTICS: missing 35mm-equivalent optics skips geometry without any model call', async ({ page }) => {
  const errors = collectErrors(page); blockExternal(page);
  await openCaptureTab(page);
  await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    T.settings.llmKey = 'sk-or-test';
    await T.db.observations.put({
      localId: 'geo-noopt', createdAt: Date.now(), startedAt: Date.now(),
      subjectCommonName: 'Great Blue Heron', subjectScientificName: 'Ardea herodias',
      taxonomy: { status: 'ok', species: 'Ardea herodias', scientificName: 'Ardea herodias' },
      exif: { FocalLength: 23 },
      photoLocalIds: ['geo-noopt-photo'], observationSource: 'photo_import',
      photoEnrichment: { exif: 'done', location: 'ready', timestamp: 'ready', geocode: 'done', weather: 'done', identification: 'done', taxonomy: 'done', geometry: 'pending' }
    });
    await T.db.photos.put({ localPhotoId: 'geo-noopt-photo', observationLocalId: 'geo-noopt', createdAt: Date.now(), width: 4000, height: 3000, uploadStatus: 'pending' });
    await T.db.audioBlobs.put({ blobId: 'geo-noopt-photo', blob: new Blob(['x'], { type: 'image/jpeg' }), mimeType: 'image/jpeg', sizeBytes: 1, createdAt: Date.now() });
  });
  const geoRoute = await mockGeometryRoute(page, GEOMETRY_JSON);
  await page.evaluate(() => window.__WFR_TEST__.runSubjectGeometryStage('geo-noopt'));
  const obs = await page.evaluate(async () => (await window.__WFR_TEST__.db.observations.get('geo-noopt')));
  expect(obs.photoEnrichment.geometry).toBe('unavailable');
  expect(obs.subjectGeometry.status).toBe('unavailable');
  expect(obs.subjectGeometry.reason).toMatch(/optical metadata missing/i);
  expect(geoRoute.geometryCalls).toBe(0);
  expect(errors).toEqual([]);
});

test('GEO-OCCLUSION: unusable measurement degrades gracefully with reason retained', async ({ page }) => {
  const errors = collectErrors(page); blockExternal(page);
  await mockGeometryRoute(page, { usable: false, reason: 'severe occlusion — animal behind branches' });
  await openCaptureTab(page);
  await seedGeometryObs(page);
  await page.evaluate(() => window.__WFR_TEST__.runSubjectGeometryStage('geo-obs'));
  const obs = await page.evaluate(async () => (await window.__WFR_TEST__.db.observations.get('geo-obs')));
  expect(obs.photoEnrichment.geometry).toBe('unavailable');
  expect(obs.subjectGeometry.status).toBe('unavailable');
  expect(obs.subjectGeometry.reason).toMatch(/occlusion/i);
  expect(obs.subjectGeometry.rangeEstimate).toBeUndefined();
  expect(obs.latitude).toBe(38.3512); // camera GPS untouched
  expect(errors).toEqual([]);
});

test('GEO-E2E: taxonomy + optics + true direction + outing camera yields separated subject estimate', async ({ page }) => {
  const errors = collectErrors(page); blockExternal(page);
  const weather = await mockMeteo(page);
  await mockVisionAndGeometry(page, GEOMETRY_JSON);
  await mockGbif(page);
  await page.route('**/breadcrumbs**', route => route.abort());
  await openCaptureTab(page);
  await page.evaluate(async ({ outingJson, pngB64 }) => {
    const T = window.__WFR_TEST__;
    T.settings.llmKey = 'sk-or-test';
    await T.importOutingTrackData(outingJson);
    window.exifr.parse = async () => ({
      FocalLengthIn35mmFormat: 230, GPSImgDirection: 247, GPSImgDirectionRef: 'T', Orientation: 1
    });
    const bin = Uint8Array.from(atob(pngB64), c => c.charCodeAt(0));
    await T.importPhotoFile(new File([bin], 'IMG_20260828_191840.jpg', { type: 'image/jpeg', lastModified: Date.now() }));
  }, { outingJson: INDIANA_OUTING, pngB64: PNG.toString('base64') });
  await dbWait(page, `obs => obs.photoEnrichment.geometry === 'done'`);
  const obs = await getObs(page);
  const sg = obs.subjectGeometry;
  expect(sg.status).toBe('done');
  expect(sg.captureGeometry.focalLength35mm).toBe(230);
  expect(sg.speciesPhysicalPrior).toMatchObject({ dimension: 'standing_height', minimumMeters: 0.9, maximumMeters: 1.3, source: 'model_species_prior' });
  expect(sg.rangeEstimate.status).toBe('estimated');
  expect(sg.bearingEstimate.status).toBe('estimated');
  expect(sg.bearingEstimate.bearingDegreesTrue).toBe(247);
  // Observation GPS remains the CAMERA location from the outing track.
  expect(obs.latitude).toBeCloseTo(38.351275, 4);
  expect(obs.longitude).toBeCloseTo(-87.57171, 4);
  expect(obs.gpsSource).toMatch(/^breadcrumb_/);
  // Subject location is separate, projected from camera + bearing + range.
  const expected = refDestPoint(obs.latitude, obs.longitude, 247, sg.rangeEstimate.distanceMeters.typical);
  expect(sg.locationEstimate.status).toBe('estimated');
  expect(sg.locationEstimate.latitude).toBeCloseTo(expected.latitude, 4);
  expect(sg.locationEstimate.longitude).toBeCloseTo(expected.longitude, 4);
  // Subject estimate is genuinely separated from the camera by ~the typical range.
  const separationMeters = refHaversineMeters(obs.latitude, obs.longitude, sg.locationEstimate.latitude, sg.locationEstimate.longitude);
  expect(separationMeters).toBeGreaterThanOrEqual(sg.rangeEstimate.distanceMeters.min);
  expect(separationMeters).toBeLessThanOrEqual(sg.rangeEstimate.distanceMeters.max);
  expect(sg.locationEstimate.cameraLocationSource).toBe(obs.gpsSource);
  expect(sg.locationEstimate.source).toBe('photogrammetric_estimate');
  expect(sg.locationEstimate.estimatedAccuracyMeters).toBeGreaterThan(0);
  expect(weather.calls.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('GEO-SPECIES-CHANGE: editing the scientific name marks the subject estimate stale', async ({ page }) => {
  const errors = collectErrors(page); blockExternal(page);
  const weather = await mockMeteo(page);
  await mockVisionAndGeometry(page, GEOMETRY_JSON);
  await mockGbif(page);
  await openCaptureTab(page);
  await page.evaluate(async ({ outingJson, pngB64 }) => {
    const T = window.__WFR_TEST__;
    T.settings.llmKey = 'sk-or-test';
    await T.importOutingTrackData(outingJson);
    window.exifr.parse = async () => ({ FocalLengthIn35mmFormat: 230, GPSImgDirection: 247, GPSImgDirectionRef: 'T' });
    const bin = Uint8Array.from(atob(pngB64), c => c.charCodeAt(0));
    await T.importPhotoFile(new File([bin], 'IMG_20260828_191840.jpg', { type: 'image/jpeg', lastModified: Date.now() }));
  }, { outingJson: INDIANA_OUTING, pngB64: PNG.toString('base64') });
  await dbWait(page, `obs => obs.photoEnrichment.geometry === 'done'`);
  await page.fill('#imp-sci', 'Branta canadensis');
  await page.click('#imp-save');
  await page.waitForTimeout(300);
  const obs = await getObs(page);
  expect(obs.subjectGeometry.stale).toBe(true);
  expect(obs.subjectGeometry.status).toBe('unavailable');
  expect(obs.subjectGeometry.reason).toMatch(/Species changed/i);
  expect(obs.photoEnrichment.geometry).toBe('unavailable');
  expect(errors).toEqual([]);
});

test('GEO-ACTIVE-OUTING: photo resolves against a still-active outing without stop/export', async ({ page }) => {
  const errors = collectErrors(page); blockExternal(page);
  await installMockGeolocation(page);
  await openCaptureTab(page);
  await page.evaluate(async pngB64 => {
    const T = window.__WFR_TEST__;
    const t0 = Date.now();
    await T.startOuting();
    window.__emitGeo(t0, 38.35120, -87.57182, 10);
    window.__emitGeo(t0 + 6000, 38.35135, -87.57160, 10);
    // Pixel filename digits are UTC — build them from the midpoint instant.
    const mid = new Date(t0 + 3000);
    const p2 = n => String(n).padStart(2, '0');
    const name = 'PXL_' + mid.getUTCFullYear() + p2(mid.getUTCMonth() + 1) + p2(mid.getUTCDate()) + '_' +
      p2(mid.getUTCHours()) + p2(mid.getUTCMinutes()) + p2(mid.getUTCSeconds()) + '123.jpg';
    window.exifr.parse = async () => ({});
    const bin = Uint8Array.from(atob(pngB64), c => c.charCodeAt(0));
    await T.importPhotoFile(new File([bin], name, { type: 'image/jpeg', lastModified: Date.now() }));
    window.__photoName = name;
  }, PNG.toString('base64'));
  await dbWait(page, `obs => obs.gpsSource && obs.gpsSource.indexOf('breadcrumb_') === 0`);
  const obs = await getObs(page);
  expect(obs.locationProvenance.provider).toBe('wfr_outing_track');
  expect(obs.gpsSource).toMatch(/^breadcrumb_/);
  // The outing is STILL ACTIVE — it was never stopped or exported.
  const outing = await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    return { active: !!T.getActiveOuting(), status: (await T.db.outings.toArray())[0].status };
  });
  expect(outing.active).toBe(true);
  expect(outing.status).toBe('active');
  expect(errors).toEqual([]);
});

/* ========================================================
   Weather lifecycle: offline voice capture, deferred state,
   historical backfill, pre-submit repair, backend PATCH
   (2026.08.30.11)
   ======================================================== */

const WX_OFFSET = -14400; // America/Indiana/Indianapolis

function wxWallIso(utcMs, offsetSeconds = WX_OFFSET) {
  return new Date(utcMs + offsetSeconds * 1000).toISOString().slice(0, 19);
}

function wxTimeProvenance(ageMs, wallOverride) {
  const utcMs = Date.now() - ageMs;
  return {
    source: 'capture_clock',
    utcIso: new Date(utcMs).toISOString(),
    wallIso: wallOverride || wxWallIso(utcMs),
    timezone: 'America/Indiana/Indianapolis',
    utcOffsetSeconds: WX_OFFSET,
    capturedAt: Date.now()
  };
}

function wxSeedObs(overrides = {}) {
  const ageMs = overrides.__ageMs != null ? overrides.__ageMs : 3600000;
  delete overrides.__ageMs;
  const wtp = wxTimeProvenance(ageMs);
  return Object.assign({
    localId: 'wx-voice',
    createdAt: Date.parse(wtp.utcIso),
    startedAt: Date.parse(wtp.utcIso) - 5000,
    stoppedAt: Date.parse(wtp.utcIso),
    durationSeconds: 5,
    latitude: 38.355,
    longitude: -87.5381,
    accuracyMeters: 12,
    altitude: null, heading: null, speed: null, gpsStatus: 'ok',
    weatherStatus: 'deferred',
    weatherDeferredReason: 'offline_at_capture',
    weatherApiUrl: null, weatherFetchedAt: null, weatherRaw: null,
    weatherProvenance: null,
    weatherTimeProvenance: wtp,
    audioBlobId: null, audioMimeType: null, audioSizeBytes: 0,
    userNoteText: 'cardinal by the fence',
    transcriptionStatus: 'not_applicable', transcript: null,
    classificationStatus: 'done', subjectCommonName: 'Northern Cardinal',
    subjectScientificName: 'Cardinalis cardinalis', subjectConfidence: 0.8,
    category: 'bird', categoryConfidence: 0.8, tags: [],
    behavior: null, habitat: null, count: 1, summary: '', llmRaw: '',
    tripLocalId: null, backendObservationId: null,
    backendFileIds: [], photoFileIds: [], photoLocalIds: [],
    submitStatus: 'local', submitError: null,
    updatedAt: Date.now()
  }, overrides);
}

async function seedWxObs(page, overrides) {
  return page.evaluate(async seed => {
    const T = window.__WFR_TEST__;
    await T.db.observations.put(seed);
    return true;
  }, wxSeedObs(overrides || {}));
}

async function getWxObs(page, localId = 'wx-voice') {
  return page.evaluate(async id => {
    const T = window.__WFR_TEST__;
    return T.db.observations.get(id);
  }, localId);
}

/* ---------- WB-A: offline voice capture ---------- */

test('WB-A: voice capture while offline defers weather without blocking the observation', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = cb => cb({ coords: { latitude: 38.355, longitude: -87.5381, accuracy: 9 } });
    const stream = { getTracks: () => [{ stop() {} }] };
    navigator.mediaDevices.getUserMedia = async () => stream;
    window.MediaRecorder = class {
      constructor() { this.state = 'recording'; }
      start() {}
      stop() { this.state = 'inactive'; setTimeout(() => this.onstop && this.onstop(), 10); }
      static isTypeSupported() { return true; }
    };
  });
  await openCaptureTab(page);
  await page.context().setOffline(true);
  await page.click('#capture-btn');
  await page.waitForTimeout(600); // recording starts; context promise resolves offline
  await page.click('#capture-btn'); // stop recording → finalize
  await dbWait(page, o => o.weatherStatus === 'deferred');

  const obs = await getObs(page);
  expect(obs.weatherStatus).toBe('deferred');
  expect(obs.weatherDeferredReason).toBe('offline_at_capture');
  expect(obs.weatherRaw).toBeNull();
  expect(obs.latitude).toBeCloseTo(38.355);
  expect(obs.submitStatus).toBe('local');
  const wtp = obs.weatherTimeProvenance;
  expect(wtp.source).toBe('capture_clock');
  expect(wtp.utcIso).toBe(new Date(obs.startedAt).toISOString());
  expect(wtp.utcOffsetSeconds).toBe(-new Date(obs.startedAt).getTimezoneOffset() * 60);
  expect(wtp.wallIso).toBeTruthy();
  expect(errors).toEqual([]);
});

/* ---------- WB-B: later historical backfill ---------- */

test('WB-B: backfillObservationWeather enriches a deferred voice observation in place', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  const meteo = await mockMeteo(page);
  await openCaptureTab(page);
  await seedWxObs(page, {
    weatherTimeProvenance: {
      source: 'capture_clock',
      utcIso: '2026-05-14T21:17:42.381Z',
      wallIso: '2026-05-14T17:17:42',
      timezone: 'America/Indiana/Indianapolis',
      utcOffsetSeconds: WX_OFFSET,
      capturedAt: Date.now()
    },
    createdAt: Date.parse('2026-05-14T21:17:42.381Z'),
    startedAt: Date.parse('2026-05-14T21:17:42.381Z') - 5000,
    stoppedAt: Date.parse('2026-05-14T21:17:42.381Z')
  });

  const before = await getWxObs(page);
  const result = await page.evaluate(async () => window.__WFR_TEST__.backfillObservationWeather('wx-voice'));
  expect(result.status).toBe('ok');

  const obs = await getWxObs(page);
  expect(obs.weatherStatus).toBe('ok');
  expect(obs.weatherRaw.current).toBeTruthy();
  expect(obs.weatherRaw.current.temperature_2m).toBeCloseTo(70 + 17 * 0.1, 5); // nearest hour 17:00
  expect(obs.weatherRaw.sourceTimeLocal).toBe('2026-05-14T17:00');
  expect(obs.weatherFetchedAt).toBeGreaterThan(0);
  expect(obs.weatherApiUrl).toContain('start_date=');
  expect(obs.weatherProvenance.mode).toBe('historical_backfill');
  expect(obs.weatherProvenance.provider).toBe('open-meteo');
  expect(obs.weatherProvenance.strategy).toBeTruthy();
  expect(obs.weatherProvenance.sourceTimeLocal).toBe('2026-05-14T17:00');
  expect(obs.weatherProvenance.backfilledAt).toBeGreaterThan(0);
  expect(obs.weatherDeferredReason).toBeNull();
  // Observation time must never be mutated by weather backfill.
  expect(obs.createdAt).toBe(before.createdAt);
  expect(obs.startedAt).toBe(before.startedAt);
  expect(meteo.calls.length).toBe(1);
  expect(errors).toEqual([]);
});

/* ---------- WB-C: pre-submit repair ---------- */

test('WB-C: submit repairs deferred weather first, then submits the enriched observation', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  const meteo = await mockMeteo(page);
  await openCaptureTab(page);
  await seedWxObs(page, { submitStatus: 'ready' });

  const submissions = [];
  await page.route('**/wildlife-field-recorder/observations', async route => {
    submissions.push({ method: route.request().method(), body: route.request().postDataJSON() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'be-wx-1' }) });
  });

  await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    T.settings.token = 'test-token';
    const obs = await T.db.observations.get('wx-voice');
    await T.submitObservation(obs);
  });

  expect(meteo.calls.length).toBeGreaterThanOrEqual(1); // weather fetched BEFORE submit
  expect(submissions.length).toBe(1);
  expect(submissions[0].method).toBe('POST');
  expect(submissions[0].body.data.weatherStatus).toBe('ok');
  expect(submissions[0].body.data.weatherRaw.current).toBeTruthy();
  expect(errors).toEqual([]);
});

/* ---------- WB-D: manual backfill PATCHes an already-submitted observation ---------- */

test('WB-D: manual backfill PATCHes the existing backend observation, never POSTs a duplicate', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  const meteo = await mockMeteo(page);
  await openCaptureTab(page);
  await seedWxObs(page, { backendObservationId: 'wx-be-77', submitStatus: 'submitted' });

  const backend = [];
  await page.route('**/wildlife-field-recorder/observations', async route => {
    backend.push({ method: route.request().method(), url: route.request().url() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'new-dup' }) });
  });
  await page.route('**/observations/wx-be-77', async route => {
    backend.push({ method: route.request().method(), url: route.request().url() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'wx-be-77' }) });
  });

  const result = await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    T.settings.token = 'test-token';
    return T.runManualWeatherBackfill();
  });

  expect(result.status).toBe('done');
  expect(result.updated).toBe(1);
  expect(result.patched).toBe(1);
  expect(backend.length).toBe(1);
  expect(backend[0].method).toBe('PATCH');
  expect(backend[0].url).toContain('/observations/wx-be-77');
  const obs = await getWxObs(page);
  expect(obs.weatherStatus).toBe('ok');
  expect(obs.weatherRaw.current).toBeTruthy();
  expect(obs.weatherProvenance.mode).toBe('historical_backfill');
  expect(obs.backendObservationId).toBe('wx-be-77');
  expect(meteo.calls.length).toBe(1);
  expect(errors).toEqual([]);
});

/* ---------- WB-E: PATCH failure keeps good local weather ---------- */

test('WB-E: backend PATCH failure retains enriched local weather with a sync diagnostic', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockMeteo(page);
  await openCaptureTab(page);
  await seedWxObs(page, { backendObservationId: 'wx-be-88', submitStatus: 'submitted' });
  await page.route('**/observations/wx-be-88', route => route.abort());

  const result = await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    T.settings.token = 'test-token';
    return T.runManualWeatherBackfill();
  });

  expect(result.updated).toBe(1);
  expect(result.patchFailed).toBe(1);
  const obs = await getWxObs(page);
  expect(obs.weatherStatus).toBe('ok'); // no rollback
  expect(obs.submitStatus).toBe('submitted'); // never demoted by weather PATCH failure
  expect(obs.backendObservationId).toBe('wx-be-88'); // backend id intact
  expect(obs.weatherRaw.current).toBeTruthy();
  expect(obs.weatherProvenance.mode).toBe('historical_backfill');
  expect(obs.weatherBackendSyncStatus).toBe('pending');
  expect(obs.weatherBackendSyncError).toBeTruthy();
  expect(errors).toEqual([]);
});

/* ---------- WB-F: good weather is never overwritten ---------- */

test('WB-F: auto and manual backfill never touch observations with complete weather', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  const meteo = await mockMeteo(page);
  await openCaptureTab(page);
  await seedWxObs(page, {
    weatherStatus: 'ok',
    weatherRaw: { current: { temperature_2m: 55, weather_code: 1 } },
    weatherProvenance: { mode: 'capture_live', provider: 'open-meteo', capturedAt: 1 }
  });

  const auto = await page.evaluate(async () => window.__WFR_TEST__.autoWeatherBackfillPass());
  const manual = await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    T.settings.token = 'test-token';
    return T.runManualWeatherBackfill();
  });

  expect(auto.updated).toBe(0);
  expect(manual.updated).toBe(0);
  expect(manual.alreadyComplete).toBe(1);
  expect(meteo.calls.length).toBe(0);
  const obs = await getWxObs(page);
  expect(obs.weatherRaw.current.temperature_2m).toBe(55);
  expect(obs.weatherProvenance.mode).toBe('capture_live');
  expect(errors).toEqual([]);
});

/* ---------- WB-G/H: ineligible observations + network failure ---------- */

test('WB-G: missing GPS or missing time is ineligible and never calls Open-Meteo', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  const meteo = await mockMeteo(page);
  await openCaptureTab(page);

  const res = await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    const noGps = T.weatherBackfillEligibility({ latitude: null, longitude: null, createdAt: Date.now(), weatherStatus: 'deferred', weatherRaw: null });
    const noTime = T.weatherBackfillEligibility({ latitude: 38.3, longitude: -87.5, createdAt: NaN, weatherStatus: 'deferred', weatherRaw: null });
    const legacyNull = T.weatherBackfillEligibility({ latitude: 38.3, longitude: -87.5, createdAt: Date.now(), weatherStatus: null, weatherRaw: null });
    const skippedLegacy = T.weatherBackfillEligibility({ latitude: 38.3, longitude: -87.5, createdAt: Date.now(), weatherStatus: 'skipped', weatherRaw: null });
    await T.db.observations.put({
      localId: 'wx-nogps', createdAt: Date.now(), startedAt: Date.now(),
      latitude: null, longitude: null, gpsStatus: 'missing',
      weatherStatus: 'deferred', weatherDeferredReason: 'offline_at_capture',
      weatherApiUrl: null, weatherFetchedAt: null, weatherRaw: null,
      submitStatus: 'local', updatedAt: Date.now()
    });
    const backfill = await T.backfillObservationWeather('wx-nogps');
    const stored = await T.db.observations.get('wx-nogps');
    return { noGps, noTime, legacyNull, skippedLegacy, backfill, storedStatus: stored.weatherStatus };
  });

  expect(res.noGps.eligible).toBe(false);
  expect(res.noGps.reason).toBe('missing_location');
  expect(res.noTime.eligible).toBe(false);
  expect(res.noTime.reason).toBe('missing_timestamp');
  expect(res.legacyNull.eligible).toBe(true); // legacy missing state normalizes lazily
  expect(res.skippedLegacy.eligible).toBe(true);
  expect(res.backfill.status).toBe('unavailable');
  expect(res.storedStatus).not.toBe('ok');
  expect(meteo.calls.length).toBe(0);
  expect(errors).toEqual([]);
});

test('WB-H: weather endpoint failure leaves the observation retryable and uncorrupted', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  const meteo = await mockMeteo(page);
  meteo.mode = 'fail';
  await openCaptureTab(page);
  await seedWxObs(page);

  const result = await page.evaluate(async () => window.__WFR_TEST__.backfillObservationWeather('wx-voice'));
  expect(result.status).toBe('error');
  const obs = await getWxObs(page);
  expect(obs.weatherStatus).toBe('deferred');
  expect(obs.weatherDeferredReason).toBe('backfill_failed');
  expect(obs.weatherRaw).toBeNull();
  expect(obs.weatherSubmitError).toBeTruthy();
  expect(errors).toEqual([]);
});

/* ---------- WB-I/J: online event auto-backfill + age window ---------- */

test('WB-I: online event repairs only eligible recent observations, no overlapping pass', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  const meteo = await mockMeteo(page);
  await openCaptureTab(page);

  await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    const seed = overrides => T.db.observations.put(Object.assign({
      localId: 'x', createdAt: Date.now() - 3600000, startedAt: Date.now() - 3600000,
      latitude: 38.355, longitude: -87.5381, gpsStatus: 'ok',
      weatherApiUrl: null, weatherFetchedAt: null, weatherRaw: null,
      submitStatus: 'local', updatedAt: Date.now()
    }, overrides));
    const wtp = {
      source: 'capture_clock',
      utcIso: new Date(Date.now() - 3600000).toISOString(),
      wallIso: new Date(Date.now() - 3600000 + 14400000).toISOString().slice(0, 19),
      timezone: 'America/Indiana/Indianapolis', utcOffsetSeconds: -14400, capturedAt: Date.now()
    };
    const wtp2 = Object.assign({}, wtp, {
      utcIso: new Date(Date.now() - 7200000).toISOString(),
      wallIso: new Date(Date.now() - 7200000 + 14400000).toISOString().slice(0, 19)
    });
    await seed({ localId: 'wx-d1', weatherStatus: 'deferred', weatherDeferredReason: 'offline_at_capture', weatherTimeProvenance: wtp });
    await seed({ localId: 'wx-d2', weatherStatus: 'deferred', weatherDeferredReason: 'offline_at_capture', weatherTimeProvenance: wtp2 });
    await seed({ localId: 'wx-ok', weatherStatus: 'ok', weatherRaw: { current: { temperature_2m: 50 } } });
    await seed({ localId: 'wx-nogps', weatherStatus: 'deferred', weatherDeferredReason: 'offline_at_capture', latitude: null, longitude: null });
  });

  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.evaluate(() => window.dispatchEvent(new Event('online'))); // must not double-process
  await page.waitForTimeout(1500);

  const d1 = await getWxObs(page, 'wx-d1');
  const d2 = await getWxObs(page, 'wx-d2');
  const ok = await getWxObs(page, 'wx-ok');
  const noGps = await getWxObs(page, 'wx-nogps');
  expect(d1.weatherStatus).toBe('ok');
  expect(d1.weatherProvenance.mode).toBe('historical_backfill');
  expect(d2.weatherStatus).toBe('ok');
  expect(ok.weatherRaw.current.temperature_2m).toBe(50); // untouched
  expect(noGps.weatherStatus).toBe('deferred'); // ineligible, skipped
  expect(meteo.calls.length).toBe(2); // exactly one fetch per eligible observation
  expect(errors).toEqual([]);
});

test('WB-J: observations older than the auto window are not auto-repaired but manual backfill repairs them', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  const meteo = await mockMeteo(page);
  await openCaptureTab(page);
  await seedWxObs(page, { __ageMs: 30 * 24 * 60 * 60 * 1000 });

  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(1200);
  let obs = await getWxObs(page);
  expect(obs.weatherStatus).toBe('deferred'); // outside WEATHER_BACKFILL_WINDOW_MS
  expect(meteo.calls.length).toBe(0);

  const result = await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    T.settings.token = 'test-token';
    return T.runManualWeatherBackfill();
  });
  expect(result.updated).toBe(1);
  obs = await getWxObs(page);
  expect(obs.weatherStatus).toBe('ok');
  expect(obs.weatherProvenance.mode).toBe('historical_backfill');
  expect(meteo.calls.length).toBe(1);
  expect(errors).toEqual([]);
});

/* ---------- WB-K: same trip, independent per-observation hourly matching ---------- */

test('WB-K: multiple same-trip observations are matched independently against hourly data', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockMeteo(page);
  await openCaptureTab(page);

  await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    const mk = (localId, wall) => {
      const utcMs = Date.parse(wall + 'Z') + 14400000;
      return T.db.observations.put({
        localId, createdAt: utcMs, startedAt: utcMs,
        latitude: 38.355, longitude: -87.5381, gpsStatus: 'ok',
        weatherStatus: 'deferred', weatherDeferredReason: 'offline_at_capture',
        weatherApiUrl: null, weatherFetchedAt: null, weatherRaw: null, weatherProvenance: null,
        weatherTimeProvenance: { source: 'capture_clock', utcIso: new Date(utcMs).toISOString(), wallIso: wall, timezone: 'America/Indiana/Indianapolis', utcOffsetSeconds: -14400, capturedAt: Date.now() },
        submitStatus: 'local', updatedAt: Date.now()
      });
    };
    await mk('wx-m1', '2026-05-14T08:17:00');
    await mk('wx-m2', '2026-05-14T14:43:00');
    const r1 = await T.backfillObservationWeather('wx-m1');
    const r2 = await T.backfillObservationWeather('wx-m2');
    return [r1.status, r2.status];
  });

  const m1 = await getWxObs(page, 'wx-m1');
  const m2 = await getWxObs(page, 'wx-m2');
  expect(m1.weatherStatus).toBe('ok');
  expect(m2.weatherStatus).toBe('ok');
  expect(m1.weatherRaw.sourceTimeLocal).toBe('2026-05-14T08:00');
  expect(m2.weatherRaw.sourceTimeLocal).toBe('2026-05-14T15:00');
  expect(m1.weatherRaw.current.temperature_2m).toBeCloseTo(70 + 8 * 0.1, 5);
  expect(m2.weatherRaw.current.temperature_2m).toBeCloseTo(70 + 15 * 0.1, 5);
  expect(m1.weatherProvenance.sourceTimeLocal).toBe('2026-05-14T08:00');
  expect(m2.weatherProvenance.sourceTimeLocal).toBe('2026-05-14T15:00');
  expect(errors).toEqual([]);
});

/* ---------- WB-L: legacy timezone derives from location, never the processing device ---------- */

function indianaMeteoBody(dateKey) {
  const body = meteoBody(dateKey, fullDayTimes(dateKey));
  body.timezone = 'America/Indiana/Indianapolis';
  body.timezone_abbreviation = 'EDT';
  body.utc_offset_seconds = -14400;
  return body;
}

test('WB-L: legacy observation without stored timezone resolves Indiana hour regardless of device zone', async ({ browser }) => {
  const seed = {
    localId: 'wx-tz',
    createdAt: Date.parse('2026-05-14T21:17:42.381Z'),
    startedAt: Date.parse('2026-05-14T21:17:42.381Z'),
    latitude: 38.355, longitude: -87.5381, gpsStatus: 'ok',
    weatherStatus: 'deferred', weatherDeferredReason: 'offline_at_capture',
    weatherApiUrl: null, weatherFetchedAt: null, weatherRaw: null,
    submitStatus: 'local', updatedAt: Date.now()
  };

  async function repairIn(timezoneId) {
    const context = await browser.newContext({ timezoneId });
    const page = await context.newPage();
    const errors = collectErrors(page);
    blockExternal(page);
    await mockMeteo(page);
    // Later route wins: serve Indiana timezone metadata for these coordinates.
    await page.route('**open-meteo.com**', async route => {
      const url = new URL(route.request().url());
      const dateKey = url.searchParams.get('start_date') || '2026-05-14';
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(indianaMeteoBody(dateKey)) });
    });
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await page.evaluate(async s => {
      const T = window.__WFR_TEST__;
      await T.db.observations.put(Object.assign({}, s));
      return T.backfillObservationWeather('wx-tz');
    }, seed);
    const obs = await page.evaluate(async () => window.__WFR_TEST__.db.observations.get('wx-tz'));
    await context.close();
    return { obs, errors };
  }

  const denver = await repairIn('America/Denver');
  const indiana = await repairIn('America/Indiana/Indianapolis');

  for (const run of [denver, indiana]) {
    expect(run.obs.weatherStatus).toBe('ok');
    expect(run.obs.weatherRaw.sourceTimeLocal).toBe('2026-05-14T17:00'); // Indiana wall hour (UTC-4)
    expect(run.obs.weatherRaw.current.temperature_2m).toBeCloseTo(70 + 17 * 0.1, 5);
    expect(run.obs.weatherProvenance.captureTimeSource).toBe('location_metadata');
    expect(run.errors).toEqual([]);
  }
  // Device zone must not influence the repair outcome.
  expect(denver.obs.weatherRaw.sourceTimeLocal).toBe(indiana.obs.weatherRaw.sourceTimeLocal);
  expect(denver.obs.weatherRaw.current.temperature_2m).toBe(indiana.obs.weatherRaw.current.temperature_2m);
});

/* ---------- WB-M: weather-only backend sync has no unrelated side effects ---------- */

test('WB-M: weather-only sync neither demotes submitted state nor uploads unrelated photos', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockMeteo(page);
  await openCaptureTab(page);
  await seedWxObs(page, { backendObservationId: 'wx-be-99', submitStatus: 'submitted' });
  await page.evaluate(async pngB64 => {
    const T = window.__WFR_TEST__;
    const bin = Uint8Array.from(atob(pngB64), c => c.charCodeAt(0));
    await T.db.photos.put({
      localPhotoId: 'wx-ph-1', observationLocalId: 'wx-voice', backendObservationId: null,
      createdAt: Date.now(), blobId: 'wx-ph-1', mimeType: 'image/jpeg', sizeBytes: bin.length,
      width: 1, height: 1, originalFilename: 'p.jpg', uploadStatus: 'pending',
      backendFileId: null, backendFileUrl: null, uploadError: null, updatedAt: Date.now()
    });
    await T.db.audioBlobs.put({ blobId: 'wx-ph-1', blob: new Blob([bin], { type: 'image/jpeg' }), mimeType: 'image/jpeg', sizeBytes: bin.length, createdAt: Date.now() });
  }, PNG.toString('base64'));

  const backend = [];
  await page.route('**/observations/wx-be-99', async route => {
    backend.push(route.request().method());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'wx-be-99' }) });
  });
  let fileUploads = 0;
  await page.route('**/observations/*/files', async route => {
    fileUploads++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'be-file-x' }) });
  });

  const result = await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    T.settings.token = 'test-token';
    return T.runManualWeatherBackfill();
  });

  expect(result.updated).toBe(1);
  expect(result.patched).toBe(1);
  expect(backend).toEqual(['PATCH']); // PATCH only — no POST, no file uploads
  expect(fileUploads).toBe(0);
  const obs = await getWxObs(page);
  expect(obs.submitStatus).toBe('submitted'); // untouched by weather-only sync
  expect(obs.backendObservationId).toBe('wx-be-99');
  expect(obs.weatherBackendSyncStatus).toBe('synced');
  expect(obs.weatherStatus).toBe('ok');
  const photo = await page.evaluate(async () => window.__WFR_TEST__.db.photos.get('wx-ph-1'));
  expect(photo.uploadStatus).toBe('pending'); // unrelated upload NOT triggered
  expect(errors).toEqual([]);
});
