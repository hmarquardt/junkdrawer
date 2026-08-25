/* Wildlife Field Recorder — photo-import workflow spec */
const { test, expect } = require('@playwright/test');
const path = require('path');

test.use({ channel: 'chrome', headless: true });

const URL = `file://${path.resolve(process.cwd(), 'wildlife-field-recorder.html')}`;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function blockExternal(page) {
  for (const p of ['**openrouter.ai**', '**api/analytics/**', '**analytics**', '**open-meteo.com**', '**nominatim.openstreetmap.org**', '**api.gbif.org**']) {
    page.route(p, r => r.abort());
  }
}

test('page loads with photo-import UI and no camera', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errors.push(m.text()); });
  blockExternal(page);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.click('nav#tabs button[data-tab="capture"]');
  await expect(page.locator('#capture-btn')).toBeVisible();
  await expect(page.locator('#import-photo-btn')).toBeVisible();
  expect(await page.locator('#camera-overlay, #camera-capture-btn, #camera-video').count()).toBe(0);
  expect(errors.filter(e => !/analytics/i.test(e))).toEqual([]);
});

test('import photo with EXIF uses EXIF capture time and GPS, saves ready', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|analytics/i.test(m.text())) errors.push(m.text()); });
  blockExternal(page);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.click('nav#tabs button[data-tab="capture"]');

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
  expect(res.source).toBe('photo_import');
  expect(res.timeProvenance).toBe('exif_DateTimeOriginal');
  expect(res.statuses).toContain('WEATHER');
  expect(res.submitStatus).toBe('ready');
  expect(errors).toEqual([]);
});

test('import photo with no EXIF: no location/time substitution, still saved', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|analytics/i.test(m.text())) errors.push(m.text()); });
  blockExternal(page);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.click('nav#tabs button[data-tab="capture"]');

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