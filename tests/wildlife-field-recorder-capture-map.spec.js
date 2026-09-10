/* Wildlife Field Recorder — Capture dashboard + optional live map
 *
 * These specs cover the road-cruising Capture redesign: compact controls,
 * optional follow-vehicle map, current-outing sighting pins with overlap
 * handling, independent Off/Recent/Full breadcrumb trail rendering, offline
 * map failure, and data-compatibility guarantees (Notes removed from the UI
 * but preserved in storage, existing outings still load).
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

test.use({ channel: 'chrome', headless: true, actionTimeout: 45000, navigationTimeout: 45000 });

const PAGE_URL = `file://${path.resolve(process.cwd(), 'wildlife-field-recorder.html')}`;
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const PNG = TILE_PNG;

const FULL_EXIF = {
  Make: 'TestCam', Model: 'Mk100', FocalLength: 400, ISO: 200,
  DateTimeOriginal: '2026:05:14 17:42:00',
  OffsetTimeOriginal: '-04:00',
  OffsetTime: '-04:00',
  latitude: 38.355, longitude: -87.5381, GPSAltitude: 150, GPSImgDirection: 90
};

/* ---------- shared helpers ---------- */

function blockExternal(page) {
  page.route(/openrouter\.ai|analytics|open-meteo\.com|nominatim\.openstreetmap\.org|api\.gbif\.org/, r => r.abort());
}

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|analytics|tile\.openstreetmap/i.test(m.text())) errors.push(m.text()); });
  return errors;
}

/** Deterministic tile responses (or hard failures) for the capture map. */
async function mockTiles(page, { fail = false } = {}) {
  await page.route('**tile.openstreetmap.org/**', route =>
    fail ? route.abort() : route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }));
}

/** Mock geolocation: a watch the test drives plus a fixed one-shot fix. */
async function installMockGeolocation(page) {
  await page.addInitScript(() => {
    const state = { watches: 0, clears: [], success: null, failure: null };
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      watchPosition(success, failure) { state.watches++; state.success = success; state.failure = failure; return 700 + state.watches; },
      clearWatch(id) { state.clears.push(id); },
      getCurrentPosition(success) { success({ timestamp: Date.now(), coords: { latitude: 38.35, longitude: -87.57, accuracy: 8, altitude: null, altitudeAccuracy: null, heading: null, speed: null } }); }
    }});
    window.__geoState = state;
    window.__emitGeo = (timestamp, latitude, longitude, accuracy = 8, extras = {}) =>
      state.success && state.success({ timestamp, coords: { latitude, longitude, accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null, ...extras } });
  });
}

/** Stable MediaRecorder/getUserMedia mocks (Chrome headless denies the mic). */
async function installMockRecorder(page) {
  await page.addInitScript(() => {
    const stream = { getTracks: () => [{ stop() {} }] };
    navigator.mediaDevices.getUserMedia = async () => stream;
    window.MediaRecorder = class {
      constructor() { this.state = 'recording'; this.mimeType = 'audio/webm'; }
      start() {}
      stop() {
        this.state = 'inactive';
        if (this.ondataavailable) this.ondataavailable({ data: new Blob([new Uint8Array(64)], { type: 'audio/webm' }) });
        setTimeout(() => this.onstop && this.onstop(), 10);
      }
      static isTypeSupported() { return true; }
    };
  });
}

async function openCapture(page, { mobile = false } = {}) {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.querySelector('nav#tabs button[data-tab="capture"]').click());
}

async function mapState(page) {
  return page.evaluate(() => window.__WFR_TEST__.getCaptureMapState());
}

/** Manual poll (this Playwright version resolves async predicates eagerly). */
async function waitFor(page, predicate, arg = undefined, timeout = 20000) {
  const start = Date.now();
  for (;;) {
    if (await page.evaluate(predicate, arg)) return;
    if (Date.now() - start > timeout) throw new Error('waitFor timeout: ' + predicate.toString().slice(0, 120));
    await page.waitForTimeout(100);
  }
}

async function enableMap(page) {
  await page.click('#capture-map-toggle');
  await waitFor(page, () => window.__WFR_TEST__.getCaptureMapState().initialized);
}

async function startOuting(page) {
  return page.evaluate(async () => (await window.__WFR_TEST__.startOuting()).localOutingId);
}

async function emitFixes(page, fixes) {
  await page.evaluate(fixes => {
    const t = Date.now();
    for (const fix of fixes) window.__emitGeo(t + fix[0], fix[1], fix[2], fix[3], fix[4] || {});
  }, fixes);
}

async function storedPointCount(page) {
  return page.evaluate(() => window.__WFR_TEST__.db.outingPoints.count());
}

async function obsCount(page) {
  return page.evaluate(() => window.__WFR_TEST__.db.observations.count());
}

async function importPhoto(page, exifRaw) {
  return page.evaluate(async ({ pngB64, exif }) => {
    const T = window.__WFR_TEST__;
    if (exif !== undefined) window.exifr.parse = async () => exif;
    const bin = Uint8Array.from(atob(pngB64), c => c.charCodeAt(0));
    await T.importPhotoFile(new File([bin], 'test.png', { type: 'image/png' }));
    return true;
  }, { pngB64: PNG.toString('base64'), exif: exifRaw });
}

async function suspendFollowViaDrag(page) {
  const box = await page.locator('#capture-map').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 90, cy + 55, { steps: 10 });
  await page.mouse.up();
}

/* ---------- 1. optional map ---------- */

test('CM-01: capture works with the map collapsed (no wasted map space)', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await installMockGeolocation(page);
  await openCapture(page, { mobile: true });

  await expect(page.locator('#capture-map-region')).toBeHidden();
  await expect(page.locator('#capture-btn')).toBeVisible();
  await expect(page.locator('#capture-mark-btn')).toBeVisible();
  await expect(page.locator('#capture-save-btn')).toBeVisible();
  await expect(page.locator('#capture-note')).toHaveCount(0);
  expect((await mapState(page)).initialized).toBe(false);
  expect(await page.locator('#capture-map .leaflet-pane').count()).toBe(0);

  await page.click('#capture-mark-btn');
  await waitFor(page, async () => (await window.__WFR_TEST__.db.observations.count()) === 1);
  await expect(page.locator('#capture-status')).toContainText('marked');
  await expect(page.locator('#queue-chip')).toHaveText('Queue 1');
  expect(errors).toEqual([]);
});

test('CM-02: Map enables, collapses, and the preference survives reload', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockTiles(page);
  await installMockGeolocation(page);
  await openCapture(page, { mobile: true });

  await expect(page.locator('#capture-trail-toggle')).toHaveText('Trail: Off');
  await page.click('#capture-map-toggle');
  await waitFor(page, () => window.__WFR_TEST__.getCaptureMapState().initialized);
  await expect(page.locator('#capture-map-region')).toBeVisible();
  await expect(page.locator('#capture-map-toggle')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('wfr_capture_map_visible'))).toBe('true');

  await page.click('#capture-map-toggle');
  await expect(page.locator('#capture-map-region')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('wfr_capture_map_visible'))).toBe('false');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.querySelector('nav#tabs button[data-tab="capture"]').click());
  await expect(page.locator('#capture-map-region')).toBeHidden();
  expect(errors).toEqual([]);
});

/* ---------- 2. vehicle + follow ---------- */

test('CM-03: vehicle follows and updates smoothly with simulated movement', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockTiles(page);
  await installMockGeolocation(page);
  await openCapture(page);
  await enableMap(page);
  await startOuting(page);

  await emitFixes(page, [
    [0, 38.3500, -87.5700, 12],
    [6000, 38.3506, -87.5695, 10, { heading: 45 }],
    [12000, 38.3512, -87.5690, 9, { heading: 48 }]
  ]);
  await waitFor(page, () => {
    const s = window.__WFR_TEST__.getCaptureMapState();
    return s.vehicle && Math.abs(s.vehicle.lat - 38.3512) < 1e-6 &&
      s.center && s.center.lat > s.vehicle.lat + 0.0005;
  });

  const state = await mapState(page);
  expect(state.follow).toBe(true);
  expect(state.vehicleHeading).toBe(48);
  expect(state.metaText).toContain('±9 m');
  expect(state.metaText).toContain('Following');
  expect(state.zoom).toBe(15);
  // Follow keeps the vehicle slightly below center: map center is north of it.
  expect(state.center.lat).toBeGreaterThan(state.vehicle.lat + 0.0005);
  // Directional arrow is actually rotated.
  const transform = await page.locator('#capture-map .cap-vehicle-arrow').evaluate(el => el.style.transform);
  expect(transform).toContain('rotate(48deg)');
  expect(errors).toEqual([]);
});

test('CM-04: manual pan suspends follow; Recenter resumes it; a new sighting never yanks the view', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockTiles(page);
  await installMockGeolocation(page);
  await openCapture(page);
  await enableMap(page);
  await startOuting(page);
  await emitFixes(page, [[0, 38.35, -87.57, 8], [6000, 38.351, -87.569, 8]]);
  await waitFor(page, () => window.__WFR_TEST__.getCaptureMapState().vehicle !== null);
  await expect(page.locator('#capture-recenter')).toBeHidden();

  await suspendFollowViaDrag(page);
  await waitFor(page, () => window.__WFR_TEST__.getCaptureMapState().follow === false);
  await expect(page.locator('#capture-recenter')).toBeVisible();
  expect((await mapState(page)).metaText).toContain('Paused');

  // A fix arriving while paused must NOT snap the viewport back.
  const centerWhilePaused = (await mapState(page)).center;
  await emitFixes(page, [[12000, 38.352, -87.568, 8]]);
  await waitFor(page, () => {
    const v = window.__WFR_TEST__.getCaptureMapState().vehicle;
    return v && Math.abs(v.lat - 38.352) < 1e-6;
  });
  const afterFix = await mapState(page);
  expect(afterFix.follow).toBe(false);
  expect(Math.abs(afterFix.center.lat - centerWhilePaused.lat)).toBeLessThan(0.0002);

  await page.click('#capture-recenter');
  await waitFor(page, () => {
    const s = window.__WFR_TEST__.getCaptureMapState();
    return s.follow === true && s.center && s.vehicle && s.center.lat > s.vehicle.lat + 0.0005;
  });
  await expect(page.locator('#capture-recenter')).toBeHidden();
  const recentered = await mapState(page);
  expect(recentered.center.lat).toBeGreaterThan(recentered.vehicle.lat + 0.0005);

  // Creating a sighting must not interrupt follow or recenter on it.
  await page.click('#capture-mark-btn');
  await waitFor(page, async () => (await window.__WFR_TEST__.db.observations.count()) === 1);
  await waitFor(page, () => {
    const s = window.__WFR_TEST__.getCaptureMapState();
    return s.follow === true && s.center && s.center.lat > s.vehicle.lat + 0.0005;
  });
  const afterMark = await mapState(page);
  expect(afterMark.follow).toBe(true);
  expect(afterMark.center.lat).toBeGreaterThan(afterMark.vehicle.lat + 0.0005);
  expect(errors).toEqual([]);
});

/* ---------- 3. current-outing sighting pins ---------- */

test('CM-05: current-outing sightings appear immediately and are distinct from the vehicle', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockTiles(page);
  await installMockGeolocation(page);
  await openCapture(page);
  await enableMap(page);
  await startOuting(page);
  await emitFixes(page, [[0, 38.35, -87.57, 8]]);
  await waitFor(page, () => window.__WFR_TEST__.getCaptureMapState().vehicle !== null);

  await page.click('#capture-mark-btn');
  await waitFor(page, async () => (await window.__WFR_TEST__.db.observations.count()) === 1);
  await waitFor(page, () => window.__WFR_TEST__.getCaptureMapState().sightingCount === 1);

  // Vehicle = directional divIcon marker; sightings = compact circle markers.
  expect(await page.locator('#capture-map .cap-vehicle-icon').count()).toBe(1);
  const sightingPaths = page.locator('#capture-map path.leaflet-interactive');
  await expect(sightingPaths).toHaveCount(1);
  const vehicleSize = await page.locator('#capture-map .cap-vehicle-arrow svg').boundingBox();
  const sightingBox = await sightingPaths.first().boundingBox();
  expect(vehicleSize.width).toBeGreaterThan(sightingBox.width);
  expect(errors).toEqual([]);
});

test('CM-06: co-located sightings stay individually selectable and the newest is emphasized', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockTiles(page);
  await installMockGeolocation(page);
  await openCapture(page);
  await enableMap(page);
  await startOuting(page);
  await emitFixes(page, [[0, 38.35, -87.57, 8]]);
  await waitFor(page, () => window.__WFR_TEST__.getCaptureMapState().vehicle !== null);

  for (let i = 0; i < 3; i++) {
    await page.click('#capture-mark-btn');
    await waitFor(page, async n => (await window.__WFR_TEST__.db.observations.count()) === n, i + 1);
  }
  await waitFor(page, () => window.__WFR_TEST__.getCaptureMapState().sightingCount === 3);

  const state = await mapState(page);
  // Fan-out: identical source coordinates render at distinct map positions.
  for (let i = 0; i < state.sightingLatLngs.length; i++) {
    for (let j = i + 1; j < state.sightingLatLngs.length; j++) {
      const a = state.sightingLatLngs[i], b = state.sightingLatLngs[j];
      expect(Math.abs(a.lat - b.lat) + Math.abs(a.lng - b.lng)).toBeGreaterThan(0);
    }
  }
  const paths = page.locator('#capture-map path.leaflet-interactive');
  await expect(paths).toHaveCount(3);
  // Newest marker carries the heavier emphasis ring.
  const widths = await paths.evaluateAll(els => els.map(el => el.getAttribute('stroke-width')));
  expect(widths[widths.length - 1]).toBe('3');
  expect(widths.slice(0, -1).every(w => w === '1.5')).toBe(true);
  // Each pin is clickable and opens its own summary.
  await paths.last().click();
  await expect(page.locator('#capture-map .leaflet-popup-content')).toContainText('Field mark');
  expect(errors).toEqual([]);
});

test('CM-07: sighting popup summarizes species, time, photos, and audio', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockTiles(page);
  await installMockGeolocation(page);
  await openCapture(page);
  await enableMap(page);
  const outingId = await startOuting(page);
  await emitFixes(page, [[0, 38.35, -87.57, 8]]);
  await waitFor(page, () => window.__WFR_TEST__.getCaptureMapState().vehicle !== null);

  const createdAt = Date.now() - 60000;
  await page.evaluate(async ({ outingId, createdAt }) => {
    await window.__WFR_TEST__.db.observations.put({
      localId: 'cm-popup-obs', outingLocalId: outingId, createdAt, startedAt: createdAt, stoppedAt: createdAt,
      latitude: 38.3505, longitude: -87.5695, accuracyMeters: 8, gpsStatus: 'ok',
      subjectCommonName: 'Great Blue Heron', category: 'bird',
      photoLocalIds: ['photo-a', 'photo-b'], durationSeconds: 37, audioBlobId: 'audio-x',
      userNoteText: 'a historical note', submitStatus: 'local'
    });
    await window.__WFR_TEST__.captureMapRefreshSightings();
  }, { outingId, createdAt });
  await waitFor(page, () => window.__WFR_TEST__.getCaptureMapState().sightingCount === 1);

  await page.locator('#capture-map path.leaflet-interactive').first().click();
  const popup = page.locator('#capture-map .leaflet-popup-content');
  await expect(popup).toContainText('Great Blue Heron');
  await expect(popup).toContainText('📷 2');
  await expect(popup).toContainText('0:37');
  expect(errors).toEqual([]);
});

/* ---------- 4. breadcrumb trail ---------- */

test('CM-08: trail defaults Off, Recent/Full render as a polyline, recording is untouched', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockTiles(page);
  await installMockGeolocation(page);
  await openCapture(page);
  await enableMap(page);
  await startOuting(page);
  await emitFixes(page, [[0, 38.35, -87.57, 8], [6000, 38.351, -87.569, 8], [12000, 38.352, -87.568, 8]]);
  await waitFor(page, async () => (await window.__WFR_TEST__.db.outingPoints.count()) >= 3);

  const off = await mapState(page);
  expect(off.trailMode).toBe('off');
  expect(off.trailLatLngs).toBe(0);
  expect(off.trailPointCount).toBe(3);

  await page.click('#capture-trail-toggle');
  await expect(page.locator('#capture-trail-toggle')).toHaveText('Trail: Recent');
  await waitFor(page, () => window.__WFR_TEST__.getCaptureMapState().trailLatLngs === 3);

  await page.click('#capture-trail-toggle');
  await expect(page.locator('#capture-trail-toggle')).toHaveText('Trail: Full');
  expect((await mapState(page)).trailLatLngs).toBe(3);

  // Toggling visibility never changes the stored breadcrumb data.
  const before = await storedPointCount(page);
  await page.click('#capture-trail-toggle'); // back to Off
  await expect(page.locator('#capture-trail-toggle')).toHaveText('Trail: Off');
  await emitFixes(page, [[18000, 38.353, -87.567, 8]]);
  await waitFor(page, async n => (await window.__WFR_TEST__.db.outingPoints.count()) === n, before + 1);
  expect((await mapState(page)).trailLatLngs).toBe(0);
  expect(await storedPointCount(page)).toBe(before + 1);
  expect(await page.evaluate(() => localStorage.getItem('wfr_capture_trail_mode'))).toBe('off');
  expect(errors).toEqual([]);
});

test('CM-09: Full trail handles 760 out-and-back breadcrumbs without UI degradation', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockTiles(page);
  await installMockGeolocation(page);
  await openCapture(page);
  const outingId = await startOuting(page);

  const points = [];
  const base = Date.now() - 3600000;
  for (let i = 0; i < 380; i++) {
    points.push({ localPointId: 'cm-out-' + i, outingLocalId: outingId, timestamp: base + i * 5000, latitude: 38.35 + i * 0.00005, longitude: -87.57 + i * 0.00004, accuracyMeters: 8 });
  }
  for (let i = 379; i >= 0; i--) {
    points.push({ localPointId: 'cm-back-' + i, outingLocalId: outingId, timestamp: base + (760 - i) * 5000, latitude: 38.35 + i * 0.00005, longitude: -87.57 + i * 0.00004, accuracyMeters: 8 });
  }
  await page.evaluate(points => window.__WFR_TEST__.db.outingPoints.bulkPut(points), points);

  await page.click('#capture-map-toggle');
  await waitFor(page, () => window.__WFR_TEST__.getCaptureMapState().initialized);
  await waitFor(page, () => window.__WFR_TEST__.getCaptureMapState().trailPointCount === 760);

  await page.click('#capture-trail-toggle');
  await expect(page.locator('#capture-trail-toggle')).toHaveText('Trail: Recent');
  await page.click('#capture-trail-toggle');
  await expect(page.locator('#capture-trail-toggle')).toHaveText('Trail: Full');

  const timing = await page.evaluate(() => {
    const start = performance.now();
    window.__WFR_TEST__.renderCaptureTrail();
    return { ms: performance.now() - start, state: window.__WFR_TEST__.getCaptureMapState() };
  });
  expect(timing.state.trailLatLngs).toBe(760);
  expect(timing.ms).toBeLessThan(2000);
  // Overlapping out-and-back geometry remains a single usable polyline.
  expect(timing.state.trailPointCount).toBe(760);
  expect(await storedPointCount(page)).toBe(760);
  expect(errors).toEqual([]);
});

/* ---------- 5. offline / failure behavior ---------- */

test('CM-10: tile failure degrades to a status message; GPS and capture continue', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockTiles(page, { fail: true });
  await installMockGeolocation(page);
  await openCapture(page);
  await enableMap(page);

  await waitFor(page, () => /Map unavailable/.test(window.__WFR_TEST__.getCaptureMapState().mapStatus || ''));
  await expect(page.locator('#capture-map-status')).toContainText('GPS recording continues');

  await startOuting(page);
  await emitFixes(page, [[0, 38.35, -87.57, 8], [6000, 38.351, -87.569, 8]]);
  await waitFor(page, async () => (await window.__WFR_TEST__.db.outingPoints.count()) >= 2);
  await page.click('#capture-mark-btn');
  await waitFor(page, async () => (await window.__WFR_TEST__.db.observations.count()) === 1);
  const state = await mapState(page);
  expect(state.vehicle).not.toBeNull();
  expect(state.sightingCount).toBe(1);
  expect(errors).toEqual([]);
});

test('CM-11: missing Leaflet degrades gracefully without breaking capture', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await page.route('**/leaflet@1.9.4/dist/leaflet.min.js', route => route.abort());
  await page.route('**/leaflet@1.9.4/dist/leaflet.css', route => route.abort());
  await installMockGeolocation(page);
  await openCapture(page);

  await page.click('#capture-map-toggle');
  await expect(page.locator('#capture-map-status')).toContainText('Map unavailable — GPS recording continues');
  expect((await mapState(page)).initialized).toBe(false);

  await page.click('#capture-mark-btn');
  await waitFor(page, async () => (await window.__WFR_TEST__.db.observations.count()) === 1);
  const obs = await page.evaluate(async () => (await window.__WFR_TEST__.db.observations.toArray())[0]);
  expect(obs.latitude).toBeCloseTo(38.35);
  expect(obs.userNoteText).toBeNull();
  expect(errors).toEqual([]);
});

/* ---------- 6. capture pipelines preserved ---------- */

test('CM-12: voice capture + Save still work and add a current-outing pin', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockTiles(page);
  await installMockGeolocation(page);
  await installMockRecorder(page);
  await openCapture(page);
  await enableMap(page);
  await startOuting(page);

  await page.click('#capture-btn');
  await waitFor(page, () => window.__WFR_TEST__.getActiveCapture() === true);
  await expect(page.locator('#cap-rec')).toBeVisible();
  await expect(page.locator('#capture-save-btn')).toBeEnabled();

  await page.click('#capture-save-btn');
  await waitFor(page, async () => (await window.__WFR_TEST__.db.observations.count()) === 1);
  await waitFor(page, () => window.__WFR_TEST__.getCaptureMapState().sightingCount === 1);
  const obs = await page.evaluate(async () => (await window.__WFR_TEST__.db.observations.toArray())[0]);
  expect(obs.userNoteText).toBeNull();
  expect(obs.audioBlobId).toBeTruthy();
  expect((await mapState(page)).follow).toBe(true);
  expect(errors).toEqual([]);
});

test('CM-13: importing a photo while voice recording keeps recording alive', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockTiles(page);
  await installMockGeolocation(page);
  await installMockRecorder(page);
  await openCapture(page);
  await enableMap(page);
  await startOuting(page);

  await page.click('#capture-btn');
  await waitFor(page, () => window.__WFR_TEST__.getActiveCapture() === true);

  await importPhoto(page, FULL_EXIF);
  await waitFor(page, async () => (await window.__WFR_TEST__.db.observations.count()) === 1);
  expect(await page.evaluate(() => window.__WFR_TEST__.getActiveCapture())).toBe(true);
  await expect(page.locator('#capture-btn')).toHaveClass(/recording/);

  // Stop the still-running voice capture; both sightings must persist.
  await page.evaluate(() => document.getElementById('capture-btn').click());
  await waitFor(page, async () => (await window.__WFR_TEST__.db.observations.count()) === 2);
  await waitFor(page, () => window.__WFR_TEST__.getCaptureMapState().sightingCount === 2);
  expect(await page.evaluate(() => window.__WFR_TEST__.getActiveCapture())).toBe(false);
  expect(errors).toEqual([]);
});

test('CM-14: unsynced photo import pins appear for the current session', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockTiles(page);
  await installMockGeolocation(page);
  await openCapture(page);
  await enableMap(page);

  // No outing: a photo import with historical EXIF time must still pin.
  await importPhoto(page, FULL_EXIF);
  await waitFor(page, () => window.__WFR_TEST__.getCaptureMapState().sightingCount === 1);
  const state = await mapState(page);
  expect(state.sightingCount).toBe(1);
  // Photo badge reflects the attached photo count for the current sighting.
  await expect(page.locator('#cap-photo-count')).toHaveText('📷 1');
  expect(errors).toEqual([]);
});

/* ---------- 7. existing data / compatibility ---------- */

test('CM-15: a saved active outing resumes with its trail and pins; earlier outings stay off the map', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockTiles(page);
  await installMockGeolocation(page);
  await openCapture(page);

  const ids = await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    const now = Date.now();
    const currentId = 'outing-current';
    const olderId = 'outing-older';
    await T.db.outings.bulkPut([
      { localOutingId: currentId, startedAt: now - 3600000, endedAt: null, status: 'active', source: 'wfr_local', pointCount: 2, observationCount: 0, timezoneAtStart: 'America/Indiana/Indianapolis' },
      { localOutingId: olderId, startedAt: now - 86400000, endedAt: now - 82800000, status: 'completed', source: 'wfr_local', pointCount: 1, observationCount: 1, timezoneAtStart: 'America/Indiana/Indianapolis' }
    ]);
    await T.db.outingPoints.bulkPut([
      { localPointId: 'cur-1', outingLocalId: currentId, timestamp: now - 3600000, latitude: 38.35, longitude: -87.57, kind: 'breadcrumb' },
      { localPointId: 'cur-2', outingLocalId: currentId, timestamp: now - 3500000, latitude: 38.351, longitude: -87.569, kind: 'breadcrumb' },
      { localPointId: 'old-1', outingLocalId: olderId, timestamp: now - 86400000, latitude: 38.30, longitude: -87.60, kind: 'breadcrumb' }
    ]);
    await T.db.observations.bulkPut([
      { localId: 'cm-current-obs', outingLocalId: currentId, createdAt: now - 3550000, startedAt: now - 3550000, stoppedAt: now - 3550000, latitude: 38.3505, longitude: -87.5695, gpsStatus: 'ok', submitStatus: 'local', userNoteText: 'historical note' },
      { localId: 'cm-older-obs', outingLocalId: olderId, createdAt: now - 86300000, startedAt: now - 86300000, stoppedAt: now - 86300000, latitude: 38.30, longitude: -87.60, gpsStatus: 'ok', submitStatus: 'local', userNoteText: 'ancient note' }
    ]);
    localStorage.setItem('wfr_active_outing_id', currentId);
    return { currentId, olderId };
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.querySelector('nav#tabs button[data-tab="capture"]').click());
  await waitFor(page, () => !!window.__WFR_TEST__.getActiveOuting());
  await enableMap(page);
  await waitFor(page, () => window.__WFR_TEST__.getCaptureMapState().sightingCount === 1);

  const state = await mapState(page);
  expect(state.scopeOutingId).toBe(ids.currentId);
  expect(state.trailPointCount).toBe(2);
  expect(state.sightingIds).toEqual(['cm-current-obs']);

  // Historical notes remain intact in storage.
  const older = await page.evaluate(async () => window.__WFR_TEST__.db.observations.get('cm-older-obs'));
  expect(older.userNoteText).toBe('ancient note');
  expect(await page.locator('#capture-note').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('CM-16: historical notes survive while the Capture Notes UI is removed', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await installMockGeolocation(page);
  await openCapture(page);

  await page.evaluate(async () => {
    const T = window.__WFR_TEST__;
    const now = Date.now();
    await T.db.outings.put({ localOutingId: 'outing-notes', startedAt: now - 1000, status: 'active', source: 'wfr_local' });
    await T.db.observations.put({
      localId: 'cm-hist-note', outingLocalId: 'outing-notes', createdAt: now - 900, startedAt: now - 900,
      latitude: 38.35, longitude: -87.57, gpsStatus: 'ok', submitStatus: 'local', userNoteText: 'kept forever'
    });
    localStorage.setItem('wfr_active_outing_id', 'outing-notes');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.querySelector('nav#tabs button[data-tab="capture"]').click());
  await waitFor(page, () => !!window.__WFR_TEST__.getActiveOuting());

  // Capture UI no longer renders a notes control.
  expect(await page.locator('#capture-note').count()).toBe(0);
  expect(await page.locator('#tab-capture textarea').count()).toBe(0);

  await page.click('#capture-mark-btn');
  await waitFor(page, async () => (await window.__WFR_TEST__.db.observations.count()) === 2);
  const hist = await page.evaluate(async () => window.__WFR_TEST__.db.observations.get('cm-hist-note'));
  expect(hist.userNoteText).toBe('kept forever');
  const fresh = await page.evaluate(async () => (await window.__WFR_TEST__.db.observations.toArray()).find(o => o.localId !== 'cm-hist-note'));
  expect(fresh.userNoteText).toBeNull();
  expect(errors).toEqual([]);
});

/* ---------- 8. responsive + touch ergonomics ---------- */

test('CM-17: no horizontal overflow at 390/768/1024/1440/1920 with the map enabled', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockTiles(page);
  await installMockGeolocation(page);
  await openCapture(page);
  await enableMap(page);
  await page.click('#capture-trail-toggle');
  await page.click('#capture-trail-toggle'); // Full

  for (const width of [390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(120);
    const dims = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
      offenders: Array.from(document.querySelectorAll('body *')).map(el => {
        const rect = el.getBoundingClientRect();
        return { tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 40), left: Math.round(rect.left), right: Math.round(rect.right) };
      }).filter(x => x.right > document.documentElement.clientWidth + 1 || x.left < -1).slice(0, 6)
    }));
    expect(dims.scroll, `${width}px: ${JSON.stringify(dims.offenders)}`).toBeLessThanOrEqual(dims.client);
  }
  expect(errors).toEqual([]);
});

test('CM-18: primary capture controls and Recenter meet 44px touch targets', async ({ page }) => {
  const errors = collectErrors(page);
  blockExternal(page);
  await mockTiles(page);
  await installMockGeolocation(page);
  await openCapture(page, { mobile: true });
  await enableMap(page);
  await startOuting(page);
  await emitFixes(page, [[0, 38.35, -87.57, 8]]);
  await waitFor(page, () => window.__WFR_TEST__.getCaptureMapState().vehicle !== null);

  for (const sel of ['#import-photo-btn', '#capture-btn', '#capture-mark-btn', '#capture-save-btn']) {
    const box = await page.locator(sel).boundingBox();
    expect(box.height, sel).toBeGreaterThanOrEqual(44);
  }
  await suspendFollowViaDrag(page);
  await waitFor(page, () => window.__WFR_TEST__.getCaptureMapState().follow === false);
  const recenter = await page.locator('#capture-recenter').boundingBox();
  expect(recenter.height).toBeGreaterThanOrEqual(44);
  expect(recenter.width).toBeGreaterThanOrEqual(44);
  expect(errors).toEqual([]);
});
