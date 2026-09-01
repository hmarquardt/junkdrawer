/* Map UX Lab — engine interaction, scroll behavior, viewport policy, persistence */
const { test, expect } = require('@playwright/test');
const path = require('path');

test.use({ channel: 'chrome', headless: true, actionTimeout: 30000, navigationTimeout: 30000 });
/* Headless file:// renderer sessions occasionally die mid-poll ("session closed")
 * with page state verified healthy; one retry keeps the suite stable. */
test.describe.configure({ retries: 1 });

const PAGE_URL = `file://${path.resolve(process.cwd(), 'map-ux-lab.html')}`;
const TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

async function open(page, { mobile = false } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('crash', () => errors.push('PAGE CRASHED'));
  page.on('console', m => {
    if (m.type() === 'error' && !/net::|Failed to load resource|analytics/i.test(m.text())) errors.push(m.text());
  });
  await page.route(/analytics/, r => r.abort());
  await page.route('https://tile.openstreetmap.org/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__MAPUX_TEST__, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  return errors;
}

async function mapCenterBox(page) {
  const box = await page.locator('#map-wrap').boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragMap(page, dx, dy) {
  const c = await mapCenterBox(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + dx, c.y + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test.describe('boot & engines', () => {
  test('boots with Leaflet, switches to MapLibre, no console errors', async ({ page }) => {
    const errors = await open(page);
    expect(await page.evaluate(() => !!window.__MAPUX_TEST__.maps.leaflet)).toBe(true);
    expect(await page.locator('#map-leaflet .leaflet-pane').count()).toBeGreaterThan(0);
    await page.click('#eng-maplibre');
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => !!window.__MAPUX_TEST__.maps.maplibre)).toBe(true);
    expect(await page.locator('#map-maplibre canvas').count()).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__MAPUX_TEST__.state.engine)).toBe('maplibre');
    expect(errors).toEqual([]);
  });

  test('same fixture in both engines: center, POIs, route, polygon, circle', async ({ page }) => {
    const errors = await open(page);
    const leafletView = await page.evaluate(() => window.__MAPUX_TEST__.currentView());
    await page.click('#eng-maplibre');
    await page.waitForTimeout(1500);
    const mlView = await page.evaluate(() => window.__MAPUX_TEST__.currentView());
    expect(leafletView.lat).toBeCloseTo(mlView.lat, 4);
    expect(leafletView.lng).toBeCloseTo(mlView.lng, 4);
    expect(leafletView.zoom).toBeCloseTo(mlView.zoom, 1);
    // 6 POI pins + initial observations render in Leaflet; MapLibre has canvas + DOM markers
    const mlMarkers = await page.locator('#map-maplibre .maplibregl-marker').count();
    expect(mlMarkers).toBeGreaterThanOrEqual(10);
    const leafMarkers = await page.locator('#map-leaflet .leaflet-marker-icon').count();
    expect(leafMarkers).toBeGreaterThanOrEqual(10);
    expect(errors).toEqual([]);
  });
});

test.describe('page-scroll behavior (the core question)', () => {
  test('Leaflet default capture: wheel zooms the map and does not scroll the page', async ({ page }) => {
    const errors = await open(page);
    await page.locator('#map-wrap').scrollIntoViewIfNeeded();
    const c = await mapCenterBox(page);
    await page.mouse.move(c.x, c.y);
    const before = await page.evaluate(() => ({ scrollY: window.scrollY, zoom: window.__MAPUX_TEST__.maps.leaflet.getZoom() }));
    await page.mouse.wheel(0, -480);
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => ({ scrollY: window.scrollY, zoom: window.__MAPUX_TEST__.maps.leaflet.getZoom() }));
    expect(after.zoom).toBeGreaterThan(before.zoom);
    expect(after.scrollY).toBeCloseTo(before.scrollY, 5);
    expect(errors).toEqual([]);
  });

  test('cooperative mode hands plain wheel back to the page and hints for ctrl+wheel', async ({ page }) => {
    const errors = await open(page);
    await page.locator('#map-wrap').scrollIntoViewIfNeeded();
    await page.locator('#scroll-group').scrollIntoViewIfNeeded();
    await page.click('#scroll-group .seg-mini button:nth-child(2)'); // Cooperative / calm
    await page.waitForTimeout(200);
    const c = await mapCenterBox(page);
    await page.mouse.move(c.x, c.y);
    // deliberate ctrl+wheel zooms the map (map still under the cursor)
    const zoomBefore = await page.evaluate(() => window.__MAPUX_TEST__.maps.leaflet.getZoom());
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -480);
    await page.keyboard.up('Control');
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__MAPUX_TEST__.maps.leaflet.getZoom())).toBeGreaterThan(zoomBefore);
    // plain wheel hands the gesture back to the page: scroll moves, zoom does not
    const before = await page.evaluate(() => ({ scrollY: window.scrollY, zoom: window.__MAPUX_TEST__.maps.leaflet.getZoom() }));
    await page.mouse.wheel(0, 480);
    await page.waitForTimeout(400);
    const mid = await page.evaluate(() => ({ scrollY: window.scrollY, zoom: window.__MAPUX_TEST__.maps.leaflet.getZoom() }));
    expect(mid.zoom).toBeCloseTo(before.zoom, 1); // no zoom
    expect(mid.scrollY).toBeGreaterThan(before.scrollY); // the page scrolled
    await expect(page.locator('#coop-hint')).toHaveClass(/show/);
    expect(errors).toEqual([]);
  });

  test('ignore mode: map never captures wheel', async ({ page }) => {
    const errors = await open(page);
    await page.locator('#scroll-group').scrollIntoViewIfNeeded();
    await page.click('#scroll-group .seg-mini button:nth-child(3)');
    await page.locator('#map-wrap').scrollIntoViewIfNeeded();
    const c = await mapCenterBox(page);
    await page.mouse.move(c.x, c.y);
    const before = await page.evaluate(() => ({ scrollY: window.scrollY, zoom: window.__MAPUX_TEST__.maps.leaflet.getZoom() }));
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({ scrollY: window.scrollY, zoom: window.__MAPUX_TEST__.maps.leaflet.getZoom() }));
    expect(after.zoom).toBeCloseTo(before.zoom, 1);
    expect(after.scrollY).toBeGreaterThan(before.scrollY);
    expect(errors).toEqual([]);
  });

  test('MapLibre cooperative preset recreates the map with native cooperative gestures', async ({ page }) => {
    const errors = await open(page);
    await page.click('#eng-maplibre');
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Cooperative Gestures' }).click();
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.__MAPUX_TEST__.maps.maplibre._muxCooperative)).toBe(true);
    expect(await page.evaluate(() => window.__MAPUX_TEST__.configJson().scrollBehavior)).toBe('cooperative');
    expect(errors).toEqual([]);
  });
});

test.describe('presets genuinely change behavior', () => {
  test('Very Calm changes live Leaflet options; manual tweak shows Modified badge', async ({ page }) => {
    const errors = await open(page);
    await page.getByRole('button', { name: 'Very Calm' }).click();
    expect(await page.evaluate(() => ({
      cfg: window.__MAPUX_TEST__.cfg().wheelPx,
      map: window.__MAPUX_TEST__.maps.leaflet.options.wheelPxPerZoomLevel,
      preset: window.__MAPUX_TEST__.state.preset.leaflet
    }))).toEqual({ cfg: 260, map: 260, preset: 'Very Calm' });
    expect(await page.evaluate(() => window.__MAPUX_TEST__.maps.leaflet.options.inertia)).toBe(false);
    // Manual tweak → Custom + Modified badge (slider lives inside the collapsible group)
    await page.evaluate(() => {
      const el = document.getElementById('ctl-wheelPx');
      el.value = 300;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__MAPUX_TEST__.state.preset.leaflet)).toBe('Custom');
    await expect(page.locator('#badge-modified')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('No Scroll Hijack preset switches scroll mode', async ({ page }) => {
    const errors = await open(page);
    await page.getByRole('button', { name: 'No Scroll Hijack' }).click();
    expect(await page.evaluate(() => window.__MAPUX_TEST__.cfg().scrollMode)).toBe('cooperative');
    expect(await page.locator('#badge-scroll').innerText()).toBe('cooperative');
    expect(errors).toEqual([]);
  });
});

test.describe('manual control + viewport policies', () => {
  async function dragAndControl(page) {
    await dragMap(page, 90, -70);
    await page.waitForTimeout(1300); // let drag inertia settle so view snapshots are stable
    await expect(page.locator('#userctl-box')).toHaveClass(/taken/);
    await expect(page.locator('#userctl-label')).toContainText('USER HAS TAKEN CONTROL');
  }

  test('drag marks USER HAS TAKEN CONTROL; respect_manual blocks implicit refits', async ({ page }) => {
    const errors = await open(page);
    await dragAndControl(page);
    await page.getByRole('button', { name: 'Load new observations' }).click();
    await page.waitForTimeout(400);
    const log = await page.locator('#event-log').innerText();
    expect(log).toContain('BLOCKED');
    expect(log).toContain('respecting manual control');
    // explicit command still allowed
    await page.getByRole('button', { name: 'Fit all results' }).click();
    await page.waitForTimeout(900);
    expect(await page.locator('#event-log').innerText()).toContain('Fit all results');
    expect(errors).toEqual([]);
  });

  test('always_auto executes implicit refits even after manual control', async ({ page }) => {
    const errors = await open(page);
    await dragAndControl(page);
    await page.locator('#policy-group input[value="always_auto"]').check();
    await page.getByRole('button', { name: 'Load new observations' }).click();
    await page.waitForTimeout(900);
    const log = await page.locator('#event-log').innerText();
    expect(log).toContain('Load new observations');
    expect(log).not.toContain('BLOCKED');
    expect(errors).toEqual([]);
  });

  test('preserve_view blocks even explicit navigation', async ({ page }) => {
    const errors = await open(page);
    await page.locator('#policy-group input[value="preserve_view"]').check();
    const before = await page.evaluate(() => window.__MAPUX_TEST__.currentView());
    await page.getByRole('button', { name: 'Return home' }).click();
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => window.__MAPUX_TEST__.currentView());
    expect(after.zoom).toBeCloseTo(before.zoom, 6);
    expect(await page.locator('#event-log').innerText()).toContain('preserve view entirely');
    expect(errors).toEqual([]);
  });

  test('preserve_zoom: selecting a POI recenters but keeps zoom', async ({ page }) => {
    const errors = await open(page);
    await page.locator('#policy-group input[value="preserve_zoom"]').check();
    // change zoom first so preservation is observable
    await page.locator('#map-wrap').scrollIntoViewIfNeeded();
    const c = await mapCenterBox(page);
    await page.mouse.move(c.x, c.y);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(700);
    const before = await page.evaluate(() => window.__MAPUX_TEST__.currentView());
    await page.getByRole('button', { name: 'Select POI' }).click();
    await page.waitForTimeout(1400);
    await page.waitForFunction(() => /open/.test(document.getElementById('detail-panel').className), null, { timeout: 5000 });
    const after = await page.evaluate(() => window.__MAPUX_TEST__.currentView());
    expect(after.zoom).toBeCloseTo(before.zoom, 1);
    expect(Math.abs(after.lat - before.lat) + Math.abs(after.lng - before.lng)).toBeGreaterThan(1e-4);
    await page.waitForFunction(() => /open/.test(document.getElementById('detail-panel').className), null, { timeout: 5000 });
    expect(errors).toEqual([]);
  });

  test('release control returns to app-controlled state', async ({ page }) => {
    const errors = await open(page);
    await dragAndControl(page);
    await page.click('#btn-release');
    expect(await page.locator('#userctl-box').getAttribute('class')).not.toContain('taken');
    expect(errors).toEqual([]);
  });
});

test.describe('detail panel resize behavior', () => {
  test('open/close preserves center and resize survives user control', async ({ page }) => {
    const errors = await open(page);
    await dragMap(page, 60, -40); // take manual control first
    await page.waitForTimeout(1300); // let drag inertia settle
    const before = await page.evaluate(() => window.__MAPUX_TEST__.currentView());
    await page.getByRole('button', { name: 'Open detail panel' }).click();
    await page.waitForTimeout(700);
    const openView = await page.evaluate(() => window.__MAPUX_TEST__.currentView());
    expect(openView.lat).toBeCloseTo(before.lat, 3);
    expect(openView.lng).toBeCloseTo(before.lng, 3);
    expect(await page.locator('#detail-panel.open').count()).toBe(1);
    // user control survived the layout change
    expect(await page.evaluate(() => window.__MAPUX_TEST__.state.userControlled)).toBe(true);
    await page.getByRole('button', { name: 'Close detail panel', exact: true }).click();
    await page.waitForTimeout(500);
    const closedView = await page.evaluate(() => window.__MAPUX_TEST__.currentView());
    expect(closedView.lat).toBeCloseTo(before.lat, 3);
    expect(await page.locator('#event-log').innerText()).toContain('center preserved');
    expect(errors).toEqual([]);
  });
});

test.describe('favorite configuration', () => {
  test('saves with timestamp and survives reload', async ({ page }) => {
    const errors = await open(page);
    await page.evaluate(() => {
      const el = document.getElementById('ctl-wheelPx');
      el.value = 240;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#policy-group input[value="preserve_zoom"]').check();
    await page.click('#btn-favorite');
    await expect(page.locator('#favorite-line')).toBeVisible();
    const favLine = await page.locator('#favorite-line').innerText();
    expect(favLine).toContain('★ Favorite saved');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__MAPUX_TEST__, null, { timeout: 20000 });
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__MAPUX_TEST__.cfg().wheelPx)).toBe(240);
    expect(await page.evaluate(() => window.__MAPUX_TEST__.state.policy)).toBe('preserve_zoom');
    await expect(page.locator('#favorite-line')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('reset all settings clears favorite and config', async ({ page }) => {
    const errors = await open(page);
    await page.click('#btn-favorite');
    await page.click('#btn-all-reset');
    await page.waitForTimeout(200);
    expect(await page.locator('#favorite-line').isHidden()).toBe(true);
    expect(await page.evaluate(() => window.__MAPUX_TEST__.cfg().wheelPx)).toBe(60);
    expect(errors).toEqual([]);
  });
});

test.describe('export & specification', () => {
  test('JSON, init code, and behavioral spec track the active engine and config', async ({ page }) => {
    const errors = await open(page);
    let j = JSON.parse(await page.evaluate(() => window.__MAPUX_TEST__.configJson() && JSON.stringify(window.__MAPUX_TEST__.configJson())));
    expect(j.engine).toBe('leaflet');
    expect(j.location.name).toBe('Princeton, Indiana');
    expect(j.viewportPolicy.id).toBe('respect_manual');
    let code = await page.locator('#exp-code').textContent();
    expect(code).toContain('L.map(');
    expect(code).toContain('wheelPxPerZoomLevel: 60');
    // switch engine
    await page.click('#eng-maplibre');
    await page.waitForTimeout(1200);
    code = await page.locator('#exp-code').textContent();
    expect(code).toContain('new maplibregl.Map(');
    expect(code).toContain('cooperativeGestures: false');
    const spec = await page.locator('#exp-spec').textContent();
    expect(spec).toContain('Touch rotation is');
    expect(spec).toContain('must not shift the map center');
    expect(errors).toEqual([]);
  });

  test('copy buttons report success', async ({ page }) => {
    const errors = await open(page);
    await page.evaluate(() => {
      navigator.clipboard.writeText = t => Promise.resolve();
    });
    await page.locator('[data-copy="json"]').click();
    await expect(page.locator('#status')).toContainText('JSON copied');
    await page.locator('[data-copy="all"]').click();
    await expect(page.locator('#status')).toContainText('Everything copied');
    expect(errors).toEqual([]);
  });
});

test.describe('comparison mode', () => {
  test('both maps visible and views sync without feedback loops', async ({ page }) => {
    const errors = await open(page);
    await page.click('#btn-compare');
    await page.waitForTimeout(1200);
    expect(await page.locator('#map-leaflet').isVisible()).toBe(true);
    expect(await page.locator('#map-maplibre').isVisible()).toBe(true);
    // move Leaflet; MapLibre should approximately follow
    await page.evaluate(() => window.__MAPUX_TEST__.maps.leaflet.setView([38.3700, -87.5400], 15, { animate: false }));
    await page.waitForTimeout(500);
    const sync = await page.evaluate(() => {
      const l = window.__MAPUX_TEST__.maps.leaflet;
      const m = window.__MAPUX_TEST__.maps.maplibre;
      const lc = l.getCenter(), mc = m.getCenter();
      return { dl: Math.abs(lc.lat - mc.lat), dg: Math.abs(lc.lng - mc.lng), dz: Math.abs(m.getZoom() - l.getZoom()) };
    });
    expect(sync.dl).toBeLessThan(1e-5);
    expect(sync.dg).toBeLessThan(1e-5);
    expect(sync.dz).toBeLessThan(0.01);
    expect(errors).toEqual([]);
  });
});

test.describe('mobile 390×844', () => {
  test('no horizontal overflow, adequate map height, controls usable', async ({ page }) => {
    const errors = await open(page, { mobile: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const mapH = await page.locator('#map-wrap').evaluate(el => el.getBoundingClientRect().height);
    expect(mapH).toBeGreaterThanOrEqual(400);
    // collapse/expand a control group and apply a preset by touch-sized taps
    await page.locator('#grp-engine summary').click();
    await page.getByRole('button', { name: 'Touch Friendly' }).click();
    expect(await page.evaluate(() => window.__MAPUX_TEST__.cfg().tapTolerance)).toBe(30);
    expect(errors).toEqual([]);
  });

  test('torture test checklist works and persists', async ({ page }) => {
    const errors = await open(page, { mobile: true });
    await page.locator('#tt-0').check();
    await page.locator('#tt-1').check();
    expect(await page.locator('#tt-progress').textContent()).toBe('2/11');
    await page.click('#btn-tt-reset');
    expect(await page.locator('#tt-progress').textContent()).toBe('0/11');
    expect(errors).toEqual([]);
  });
});

test.describe('event log', () => {
  test('records interaction events and caps growth; pause stops recording', async ({ page }) => {
    const errors = await open(page);
    await dragMap(page, 50, -40);
    expect(await page.locator('#event-log').innerText()).toContain('dragstart');
    // cap check
    await page.evaluate(() => {
      for (let i = 0; i < 400; i++) window.__MAPUX_TEST__.logEvent('synthetic', String(i), 'sys');
    });
    expect(await page.locator('#event-log li').count()).toBeLessThanOrEqual(251);
    await page.click('#btn-log-pause');
    await page.evaluate(() => window.__MAPUX_TEST__.logEvent('should not appear', '', 'sys'));
    const count = await page.locator('#event-log li').count();
    expect(await page.locator('#event-log').innerText()).not.toContain('should not appear');
    expect((await page.locator('#event-log').innerHTML()).includes('should not appear')).toBe(false);
    expect(errors).toEqual([]);
  });

  test('wheel telemetry is throttled, not flooding', async ({ page }) => {
    const errors = await open(page);
    await page.locator('#map-wrap').scrollIntoViewIfNeeded();
    const c = await mapCenterBox(page);
    await page.mouse.move(c.x, c.y);
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -60);
    await page.waitForTimeout(600);
    const wheelLines = (await page.locator('#event-log').innerText()).split('\n').filter(l => l.includes('wheel')).length;
    expect(wheelLines).toBeLessThanOrEqual(6);
    expect(await page.locator('#event-log li').count()).toBeLessThan(30);
    expect(errors).toEqual([]);
  });
});

test.describe('maplibre specifics', () => {
  test('touch rotation disabled in Touch Friendly preset; config reaches the map', async ({ page }) => {
    const errors = await open(page);
    await page.click('#eng-maplibre');
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Touch Friendly' }).click();
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const m = window.__MAPUX_TEST__.maps.maplibre;
      return {
        rotationOn: m.touchZoomRotate.isEnabled(),
        clickTol: m._muxClickTolerance,
        cfgRot: window.__MAPUX_TEST__.cfg().rotation,
        cfgTol: window.__MAPUX_TEST__.cfg().clickTolerance
      };
    });
    expect(r.cfgRot).toBe(false);
    expect(r.cfgTol).toBe(8);
    expect(r.clickTol).toBe(8);
    expect(errors).toEqual([]);
  });

  test('export spec mentions rotation discipline for maplibre', async ({ page }) => {
    const errors = await open(page);
    await page.click('#eng-maplibre');
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Touch Friendly' }).click();
    const spec = await page.evaluate(() => window.__MAPUX_TEST__.behaviorSpec());
    expect(spec).toMatch(/Touch rotation is disabled/);
    expect(errors).toEqual([]);
  });
});
