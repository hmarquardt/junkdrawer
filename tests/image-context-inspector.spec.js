const { test, expect } = require("@playwright/test");
const path = require("path");

const fileUrl = `file://${path.resolve(process.cwd(), "image-context-inspector.html")}`;
const PAGE_LABEL = "image-context-inspector";

test.use({ channel: "chrome" });

/* ---------------------------------------------------------------------- *
 * Shared geometry helpers (mirror the app's spherical math)
 * ---------------------------------------------------------------------- */
const EARTH_R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const CAM = { lat: 38.05, lng: -87.9 };

function destinationPoint(lat, lng, bearingDeg, distM) {
  const delta = distM / EARTH_R;
  const th = rad(bearingDeg);
  const p1 = rad(lat), l1 = rad(lng);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(delta) + Math.cos(p1) * Math.sin(delta) * Math.cos(th));
  const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(delta) * Math.cos(p1), Math.cos(delta) - Math.sin(p1) * Math.sin(p2));
  return [deg(p2), ((deg(l2) + 540) % 360) - 180];
}
function haversine(lat1, lng1, lat2, lng2) {
  const dp = rad(lat2 - lat1), dl = rad(lng2 - lng1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}
function bearingDeg(lat1, lng1, lat2, lng2) {
  const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
function angDiff(a, b) {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

let osmIdCounter = 900000;
function makeCandidate(name, km, opts = {}) {
  const bearing = opts.bearing !== undefined ? opts.bearing : 90;
  const [lat, lng] = destinationPoint(CAM.lat, CAM.lng, bearing, km * 1000);
  const id = "node/" + osmIdCounter;
  osmIdCounter += 1;
  return {
    id, osmType: "node", osmId: parseInt(id.split("/")[1], 10),
    osmIds: [{ type: "node", id: parseInt(id.split("/")[1], 10) }],
    name, type: opts.type || "peak", category: opts.category || "natural",
    geometryKind: opts.geometryKind || "point",
    representativePointNote: opts.representativePointNote || "node coordinate",
    lat, lng,
    distanceMeters: Math.round(km * 1000), distanceKm: km,
    bearingDegrees: bearing, bearingCardinal: "E",
    headingDeltaDegrees: Math.abs(bearing - 90),
    significance: "high", rankScore: opts.rankScore !== undefined ? opts.rankScore : 70 - km,
    named: true, retrievalClasses: ["natural"],
    tags: opts.tags || {},
    provenance: { provider: "OpenStreetMap", endpoint: "test", retrievalClass: "natural", retrievedAt: new Date().toISOString() }
  };
}

function buildSnapshot(candidates, heading = 90) {
  const sorted = [...candidates].sort((a, b) => b.rankScore - a.rankScore);
  const classStats = () => ({ endpoint: "test", rawElements: 0, normalized: sorted.length, error: null, truncated: false });
  return {
    cameraPosition: { lat: CAM.lat, lng: CAM.lng },
    cameraHeading: heading, headingCardinal: "E", headingSource: "manual",
    halfAngle: 30, maxDistanceKm: 20,
    sectorFromDegrees: heading - 30, sectorToDegrees: heading + 30,
    provider: "OpenStreetMap", endpoint: "test",
    retrievedAt: new Date().toISOString(),
    totalRawElements: 0, matchedCount: sorted.length,
    historicalCaveat: "Candidates reflect current OpenStreetMap data.", captureAgeYears: null,
    acquisition: {
      classes: { natural: classStats(), structures: classStats(), places: classStats() },
      completeness: "complete", mergedNormalized: sorted.length, deduped: sorted.length,
      insideMaxDistance: sorted.length, insideViewSector: sorted.length,
      ranked: sorted.length, uiShown: sorted.length, aiContext: Math.min(8, sorted.length)
    },
    outsideSector: [],
    candidates: sorted
  };
}


/** DEM field that is `base` everywhere except a raised knob under each
 * candidate coordinate (so the candidate ground itself resolves correctly). */
function demWithCandidatePeaks(candidates, base = 100, knobRadiusM = 40) {
  const knobs = candidates.map((c) => ({ lat: c.lat, lng: c.lng, ground: c.groundM || base + 20 }));
  return (la, lo) => {
    for (const k of knobs) {
      if (haversine(k.lat, k.lng, la, lo) <= knobRadiusM) return k.ground;
    }
    return base;
  };
}

/** Deterministic DEM mock for api.open-meteo.com/v1/elevation. */
async function mountElevationMock(page, opts = {}) {
  const state = { requests: [], fulfilled: 0, failed: 0 };
  await page.route("**api.open-meteo.com/v1/elevation**", async (route) => {
    try {
      const url = new URL(route.request().url());
      const lats = url.searchParams.get("latitude").split(",").map(Number);
      const lngs = url.searchParams.get("longitude").split(",").map(Number);
      const idx = state.requests.length;
      state.requests.push(lats.length);
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if ((opts.failBatchIndexes || []).includes(idx)) {
        state.failed += 1;
        await route.fulfill({ status: 500, contentType: "text/plain", body: "mock elevation failure" });
        return;
      }
      const elevations = lats.map((la, i) => (opts.elev ? opts.elev(la, lngs[i]) : 100));
      state.fulfilled += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ elevation: elevations }) });
    } catch (e) { /* aborted by the app */ }
  });
  return state;
}

function mountOverpassEmpty(page) {
  return page.route("**overpass-api.de/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ elements: [] }) }));
}

function blockExternalServices(page) {
  // Keep tests hermetic: analytics and OpenRouter never leave the machine.
  return Promise.all([
    page.route("**/api/analytics/**", (r) => r.abort()),
    page.route("**openrouter.ai/api/v1/models**", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) }))
  ]);
}

async function waitForTerrainSettled(page, timeout = 20000) {
  await page.waitForFunction(() => {
    const s = window.__ICI_TEST__ && window.__ICI_TEST__.getTerrainState && window.__ICI_TEST__.getTerrainState();
    return s && s.meta && s.meta.status !== "evaluating";
  }, null, { timeout });
}

/** goto + gps + injected snapshot + completed terrain run. Returns elevation mock. */
async function setupTerrainWorkspace(page, candidates, elevOpts = {}, heading = 90) {
  await mountOverpassEmpty(page);
  const mock = await mountElevationMock(page, elevOpts);
  await page.goto(fileUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__ICI_TEST__);
  await page.evaluate((c) => window.__ICI_TEST__.exerciseLocation(c[0], c[1]), [CAM.lat, CAM.lng]);
  // Sightline UI renders only for a loaded image; spec photos carry no EXIF.
  await page.evaluate(() => window.__ICI_TEST__.simulateLoadedPhoto("spec-photo.jpg"));
  await page.evaluate((snap) => window.__ICI_TEST__.sightlineTestHelpers.injectSnapshot(snap), buildSnapshot(candidates, heading));
  await page.evaluate(() => window.__ICI_TEST__.sightlineTestHelpers.runTerrainAnalysis());
  await waitForTerrainSettled(page);
  return mock;
}

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/* ---------------------------------------------------------------------- *
 * Pure engine tests (no network beyond CDN) — deterministic DEM math
 * ---------------------------------------------------------------------- */
test.describe(PAGE_LABEL + " terrain engine (pure)", () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    page._errors = [];
    page.on("pageerror", (e) => page._errors.push(e.message));
    await blockExternalServices(page);
    await page.goto(fileUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!(window.__ICI_TEST__ && window.__ICI_TEST__.sightlineTestHelpers.terrainHelpers));
  });

  test.afterAll(async () => {
    expect(page._errors, "no page errors").toEqual([]);
    await page.close();
  });

  function syntheticProfile(km, n, elevFn) {
    const pts = [];
    for (let i = 1; i <= n; i++) {
      const d = km * 1000 * (i / (n + 1));
      const [lat, lng] = destinationPoint(CAM.lat, CAM.lng, 90, d);
      pts.push({ lat, lng, distanceM: Math.round(d), elevationM: elevFn(d) });
    }
    return pts;
  }
  const CAMERA = { lat: CAM.lat, lng: CAM.lng, groundElevationM: 100 };

  async function evalEvidence(camera, candidate, profile) {
    return page.evaluate(({ camera, candidate, profile }) => {
      const t = window.__ICI_TEST__.sightlineTestHelpers.terrainHelpers;
      return t.computeTerrainEvidence(camera, candidate, profile);
    }, { camera, candidate, profile });
  }

  test("43. flat terrain -> terrain-clear", async () => {
    const profile = syntheticProfile(8, 27, () => 100);
    const [clat, clng] = destinationPoint(CAM.lat, CAM.lng, 90, 8000);
    const ev = await evalEvidence(
      CAMERA,
      { lat: clat, lng: clng, groundElevationM: 120, tags: {}, category: "natural", type: "peak" },
      profile
    );
    expect(ev.status).toBe("terrain-clear");
    expect(ev.cameraEyeElevationM).toBe(101.6); // DEM ground + 1.6 m assumed eye height
    expect(ev.cameraGroundElevationM).toBe(100);
    expect(ev.angularClearanceDeg).toBeGreaterThan(0.05);
    expect(ev.candidateTargetSource).toBe("DEM");
  });

  test("44. blocking ridge -> terrain-blocked with correct obstruction sample", async () => {
    const profile = syntheticProfile(10, 33, (d) => (Math.abs(d - 4000) <= 300 ? 220 : 100));
    const [clat, clng] = destinationPoint(CAM.lat, CAM.lng, 90, 10000);
    const ev = await evalEvidence(
      CAMERA,
      { lat: clat, lng: clng, groundElevationM: 130, tags: {}, category: "natural", type: "peak" },
      profile
    );
    expect(ev.status).toBe("terrain-blocked");
    expect(ev.obstruction.elevationM).toBe(220);
    expect(Math.abs(ev.obstruction.distanceM - 4000)).toBeLessThanOrEqual(300);
    expect(ev.angularClearanceDeg).toBeLessThan(-0.05);
  });

  test("45. borderline angular difference -> terrain-uncertain, stable under float noise", async () => {
    const cls = await page.evaluate(() => {
      const t = window.__ICI_TEST__.sightlineTestHelpers.terrainHelpers;
      return [
        t.classifyTerrainAngles(0.06, 0),
        t.classifyTerrainAngles(-0.06, 0),
        t.classifyTerrainAngles(0.03, 0),
        t.classifyTerrainAngles(0.050001, 0),
        t.classifyTerrainAngles(0.049999, 0)
      ];
    });
    expect(cls).toEqual(["terrain-clear", "terrain-blocked", "terrain-uncertain", "terrain-clear", "terrain-uncertain"]);
    // Integrated borderline profile: clearance ~ -0.026 deg (< margin).
    const profile = syntheticProfile(6, 20, () => 100);
    const [clat, clng] = destinationPoint(CAM.lat, CAM.lng, 90, 6000);
    const ev = await evalEvidence(
      CAMERA,
      { lat: clat, lng: clng, groundElevationM: 97.5, tags: {}, category: "natural", type: "hill" },
      profile
    );
    expect(ev.status).toBe("terrain-uncertain");
    expect(Math.abs(ev.angularClearanceDeg)).toBeLessThan(0.05);
  });

  test("46. blocked structure without height -> base-blocked-height-unknown", async () => {
    const profile = syntheticProfile(10, 33, (d) => (Math.abs(d - 3000) <= 300 ? 115 : 100));
    const [clat, clng] = destinationPoint(CAM.lat, CAM.lng, 90, 10000);
    const ev = await evalEvidence(
      CAMERA,
      { lat: clat, lng: clng, groundElevationM: 100, tags: {}, category: "landmark", type: "water tower" },
      profile
    );
    expect(ev.status).toBe("base-blocked-height-unknown"); // NOT plain terrain-blocked
    expect(ev.candidateTargetSource).toBe("DEM");
  });

  test("47. structure with OSM height clearing horizon -> terrain-clear, source OSM height", async () => {
    const profile = syntheticProfile(10, 33, (d) => (Math.abs(d - 3000) <= 300 ? 115 : 100));
    const [clat, clng] = destinationPoint(CAM.lat, CAM.lng, 90, 10000);
    const known = await evalEvidence(
      CAMERA,
      { lat: clat, lng: clng, groundElevationM: 100, tags: { height: "75" }, category: "landmark", type: "tower" },
      profile
    );
    expect(known.status).toBe("terrain-clear");
    expect(known.candidateTargetElevationM).toBe(175);
    expect(known.candidateTargetSource).toBe("OSM height");
    // Same geometry but height unknown must NOT be called plainly blocked.
    const unknown = await evalEvidence(
      CAMERA,
      { lat: clat, lng: clng, groundElevationM: 100, tags: {}, category: "landmark", type: "tower" },
      profile
    );
    expect(unknown.status).toBe("base-blocked-height-unknown");
  });

  test("height parsing and structure detection rules", async () => {
    const r = await page.evaluate(() => {
      const t = window.__ICI_TEST__.sightlineTestHelpers.terrainHelpers;
      return {
        meters: [t.parseOsmHeightMeters("50"), t.parseOsmHeightMeters("50 m"), t.parseOsmHeightMeters("164 ft")],
        rejected: [t.parseOsmHeightMeters("50;url=http://x"), t.parseOsmHeightMeters("high"), t.parseOsmHeightMeters("-5"), t.parseOsmHeightMeters(null)],
        levels: [t.parseBuildingLevels("4"), t.parseBuildingLevels("many"), t.parseBuildingLevels("0")],
        structure: [
          t.isVerticalStructureCandidate({ category: "landmark", type: "lighthouse" }),
          t.isVerticalStructureCandidate({ category: "industrial", type: "silo" }),
          t.isVerticalStructureCandidate({ category: "infrastructure", type: "bridge" }),
          t.isVerticalStructureCandidate({ category: "structure", type: "building" }),
          t.isVerticalStructureCandidate({ category: "natural", type: "peak" }),
          t.isVerticalStructureCandidate({ category: "place", type: "village" }),
          t.isVerticalStructureCandidate({ category: "infrastructure", type: "power plant" }),
          t.isVerticalStructureCandidate({ category: "infrastructure", type: "airport" }),
          t.isVerticalStructureCandidate({ category: "land use", type: "park" })
        ],
        levelsTarget: t.resolveCandidateTarget({ tags: { "building:levels": "5" }, category: "structure", type: "building" }, 100),
        eleTrusted: t.resolveCandidateTarget({ tags: { ele: "168" }, category: "natural", type: "peak" }, 171),
        eleDistrusted: t.resolveCandidateTarget({ tags: { ele: "9999" }, category: "natural", type: "peak" }, 120)
      };
    });
    expect(r.meters[0]).toBe(50);
    expect(r.meters[1]).toBe(50);
    expect(r.meters[2]).toBe(50); // 164 ft = 49.9872 m, rounded to one decimal
    expect(r.rejected.every((v) => v === null)).toBe(true);
    expect(r.levels).toEqual([4, null, null]);
    expect(r.structure.slice(0, 4)).toEqual([true, true, true, true]);
    expect(r.structure.slice(4)).toEqual([false, false, false, false, false]);
    expect(r.levelsTarget.elevationM).toBe(115);           // 100 + 5 x 3 m inferred
    expect(r.levelsTarget.source).toBe("inferred structure height");
    expect(r.eleTrusted.source).toBe("OSM ele");
    expect(r.eleTrusted.elevationM).toBe(168);
    expect(r.eleDistrusted.source).toBe("DEM");            // implausible OSM ele ignored
  });

  test("48. Earth curvature changes the horizon result vs naive flat interpolation", async () => {
    // Constant 100 m terrain; candidate ground 120 m at 20 km.
    const profile = syntheticProfile(20, 60, () => 100);
    const [clat, clng] = destinationPoint(CAM.lat, CAM.lng, 90, 20000);
    const ev = await evalEvidence(
      CAMERA,
      { lat: clat, lng: clng, groundElevationM: 120, tags: {}, category: "place", type: "village" },
      profile
    );
    // Spherical geometry: clearance +0.003 deg -> inside uncertainty band.
    expect(["terrain-uncertain", "terrain-clear"]).toContain(ev.status);
    expect(Math.abs(ev.angularClearanceDeg)).toBeLessThan(0.06);
    // Spherical horizon sits near the geometric dip minimum (~4.6 km),
    // NOT at the farthest sample like naive flat math.
    expect(ev.obstruction.distanceM).toBeGreaterThan(2500);
    expect(ev.obstruction.distanceM).toBeLessThan(7000);

    const naive = await page.evaluate(({ profile }) => {
      const degc = (r) => (r * 180) / Math.PI;
      let horizon = -Infinity, horizonD = null;
      profile.forEach((p) => {
        const a = degc(Math.atan((p.elevationM - 101.6) / p.distanceM));
        if (a > horizon) { horizon = a; horizonD = p.distanceM; }
      });
      const D = profile[profile.length - 1].distanceM;
      const target = degc(Math.atan((120 - 101.6) / D));
      return { horizon, horizonD, target, clearance: target - horizon };
    }, { profile });
    // Naive flat-Earth math says comfortably CLEAR (+0.057 > margin) while the
    // curvature-aware result does not — materially different horizon outcome.
    expect(naive.clearance).toBeGreaterThan(0.05);
    expect(naive.horizonD).toBeGreaterThan(18000);
    expect(ev.obstruction.distanceM).toBeLessThan(naive.horizonD / 3);
  });

  test("sampling strategy: spacing target, clamps, geodesic path excludes endpoints", async () => {
    const r = await page.evaluate(() => {
      const t = window.__ICI_TEST__.sightlineTestHelpers.terrainHelpers;
      const near = t.generateTerrainPath(38.05, -87.9, 90, 2000);
      const mid = t.generateTerrainPath(38.05, -87.9, 90, 10000);
      const far = t.generateTerrainPath(38.05, -87.9, 90, 20000);
      const mono = far.every((p, i) => i === 0 || p.distanceM > far[i - 1].distanceM);
      return {
        nearCount: near.length, midCount: mid.length, farCount: far.length, mono,
        firstD: far[0].distanceM, lastD: far[far.length - 1].distanceM,
        spacingMid: 10000 / (mid.length + 1),
        constants: t.constants
      };
    });
    expect(r.constants.CAMERA_HEIGHT_M).toBe(1.6);
    expect(r.constants.TERRAIN_ANGLE_MARGIN_DEG).toBe(0.05);
    expect(r.constants.TERRAIN_BATCH_SIZE).toBe(100);
    expect(r.constants.TERRAIN_SAMPLE_SPACING_M).toBe(300);
    expect(r.nearCount).toBe(8);     // minimum clamp
    expect(r.midCount).toBe(33);
    expect(r.farCount).toBe(60);     // maximum clamp
    expect(r.mono).toBe(true);
    expect(r.firstD).toBeGreaterThan(0);   // camera endpoint excluded
    expect(r.lastD).toBeLessThan(20000);   // candidate endpoint excluded
    expect(r.spacingMid).toBeGreaterThan(250);
    expect(r.spacingMid).toBeLessThan(350);
  });

  test("SVG profile builder renders core elements from compact samples", async () => {
    const svg = await page.evaluate(() => {
      const t = window.__ICI_TEST__.sightlineTestHelpers.terrainHelpers;
      return t.buildTerrainProfileSvg({
        samples: [[0, 100], [3000, 220], [6000, 104], [9000, 108], [10000, 130]],
        cameraEyeElevationM: 101.6,
        candidateTargetElevationM: 130,
        obstruction: { distanceM: 3000, elevationM: 220 }
      }, { width: 320, height: 118 });
    });
    expect(svg).toContain("<svg");
    expect(svg).toContain('stroke="#477565"');   // sage terrain line
    expect(svg).toContain('stroke="#b9674f"');   // clay sightline
    expect(svg.match(/circle/g).length).toBeGreaterThanOrEqual(4); // obstruction + endpoints
    expect(svg).toContain("</svg>");
  });
});

/* ---------------------------------------------------------------------- *
 * Integration tests — batched retrieval against a mocked DEM service
 * ---------------------------------------------------------------------- */
test.describe(PAGE_LABEL + " terrain integration", () => {
  let page;
  let pageErrors;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await blockExternalServices(page);
  });

  test("flat DEM: candidates classified end-to-end, chips and provenance rendered", async () => {
    const cands = [makeCandidate("Flat Peak", 8, {}), makeCandidate("Flat Hill", 5, {})];
    const mock = await setupTerrainWorkspace(page, cands, { elev: demWithCandidatePeaks(cands) });

    const st = await page.evaluate(() => window.__ICI_TEST__.getTerrainState());
    expect(st.meta.status).toBe("complete");
    expect(st.meta.completedCandidates).toBe(2);
    expect(st.meta.provider).toBe("Open-Meteo");
    expect(st.meta.dataset).toBe("Copernicus DEM GLO-90");
    expect(st.meta.resolutionM).toBe(90);
    for (const c of st.candidates) {
      expect(c.terrain.status).toBe("terrain-clear");
      expect(c.terrain.source.dataset).toBe("Copernicus DEM GLO-90");
      expect(c.terrain.source.resolutionM).toBe(90);
      expect(c.terrain.samples[0]).toEqual([0, 100]);
    }
    await expect(page.locator("#sightlineCandidates .sl-terr").first()).toContainText("terrain clear");
    await expect(page.locator("#sightlineFacing .sightline-summary")).toContainText("2 candidates · 2 terrain analyzed");
    await expect(page.locator("#sightlineCandidates .sl-terr").first()).toHaveCSS("text-transform", "uppercase");
    for (const size of mock.requests) expect(size).toBeLessThanOrEqual(100);
  });

  test("v2.2.1 progress: candidates render immediately with EVALUATING badges", async () => {
    await mountOverpassEmpty(page);
    await mountElevationMock(page, { delayMs: 450, elev: () => 100 });
    await page.goto(fileUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__ICI_TEST__);
    await page.evaluate((c) => window.__ICI_TEST__.exerciseLocation(c[0], c[1]), [CAM.lat, CAM.lng]);
    await page.evaluate(() => window.__ICI_TEST__.simulateLoadedPhoto("progress-photo.jpg"));
    const cands = [makeCandidate("Fisher Knobs", 13.8, { bearing: 90 }), makeCandidate("Progress Hill", 8, { bearing: 80 })];
    await page.evaluate((snap) => window.__ICI_TEST__.sightlineTestHelpers.injectSnapshot(snap), buildSnapshot(cands, 90));
    await expect(page.locator("#sightlineFacing .sightline-summary")).toContainText("2 candidates · evaluating terrain…");
    await expect(page.locator("#sightlineCandidates .sl-terr")).toHaveCount(2);
    await expect(page.locator("#sightlineCandidates .sl-terr").first()).toContainText("evaluating");
    await page.evaluate(() => { window.__terrainProgressTest = window.__ICI_TEST__.sightlineTestHelpers.runTerrainAnalysis(); });
    await expect(page.locator("#sightlineCandidates .sl-terr").first()).toContainText("evaluating");
    await waitForTerrainSettled(page);
    await expect(page.locator("#sightlineCandidates .sl-terr").first()).not.toContainText("evaluating");
  });

  test("44i. blocking ridge integration: evidence, drawer detail, SVG profile, diagnostics", async () => {
    await setupTerrainWorkspace(page, [
      makeCandidate("Ridge Peak", 10, {})
    ], {
      elev: (la, lo) => (Math.abs(haversine(CAM.lat, CAM.lng, la, lo) - 4000) <= 320 ? 220 : 100)
    });
    const st = await page.evaluate(() => window.__ICI_TEST__.getTerrainState());
    const cand = st.candidates[0];
    expect(cand.terrain.status).toBe("terrain-blocked");
    expect(cand.terrain.obstruction.elevationM).toBe(220);
    expect(Math.abs(cand.terrain.obstruction.distanceM - 4000)).toBeLessThanOrEqual(320);
    expect(cand.terrainAdjustment).toBe(-20);
    expect(cand.terrainAdjustedScore).toBeCloseTo(cand.rankScore - 20, 5);

    await page.locator("#sightlineCandidates li").first().click();
    const drawer = page.locator("#sightlineDrawerBody");
    await expect(drawer).toContainText("Highest obstruction");
    await expect(drawer).toContainText("220 m at 3.8 km"); // nearest sample inside the ridge band
    await expect(drawer).toContainText("Copernicus DEM GLO-90");
    await expect(drawer).toContainText("atmospheric refraction not modeled");
    await expect(drawer.locator(".terrain-profile-wrap svg")).toBeVisible();
    await expect(page.locator("#sightlineDrawerList .sl-terr").first()).toContainText("terrain blocked");

    const diag = await page.evaluate(() => window.__ICI_TEST__.sightlineTestHelpers.getDiagnosticsText());
    expect(diag).toMatch(/Terrain visibility:\n  status: complete/);
    expect(diag).toMatch(/Ridge Peak:/);
    expect(diag).toMatch(/adjustment -20/);
    // Raw sample arrays must not be dumped into diagnostics.
    expect(diag.match(/\[0,\s*100\]/)).toBeNull();
  });

  test("45i. borderline DEM survives the full engine path", async () => {
    const [clat, clng] = destinationPoint(CAM.lat, CAM.lng, 90, 6000);
    await setupTerrainWorkspace(page, [
      makeCandidate("Border Dome", 6, {})
    ], {
      elev: (la, lo) => (Math.abs(la - clat) < 1e-5 && Math.abs(lo - clng) < 1e-5 ? 97.5 : 100)
    });
    const st = await page.evaluate(() => window.__ICI_TEST__.getTerrainState());
    expect(st.candidates[0].terrain.status).toBe("terrain-uncertain");
    await expect(page.locator("#sightlineCandidates .sl-terr").first()).toContainText("uncertain");
  });

  test("49. batching: >100 samples split into <=100-coordinate requests with exact mapping", async () => {
    const candidates = [];
    for (let km = 2; km <= 20; km += 2) candidates.push(makeCandidate("Cand " + km, km, {}));
    const mock = await setupTerrainWorkspace(page, candidates, {
      // Linear elevation field — any response/sample misalignment breaks this.
      elev: (la, lo) => 100 + haversine(CAM.lat, CAM.lng, la, lo) / 1000
    });
    const st = await page.evaluate(() => window.__ICI_TEST__.getTerrainState());
    expect(st.meta.requestedCandidates).toBe(10);
    const totalSamples = st.meta.samplePointsGenerated;
    expect(totalSamples).toBeGreaterThan(100);
    // Endpoints of one candidate can legitimately coincide with interior
    // samples of another (aligned distances) — the run reports the deduped count.
    const uniqueCoords = st.meta.uniqueCoordinatesRequested;
    expect(uniqueCoords).toBeGreaterThan(100);
    expect(uniqueCoords).toBeLessThanOrEqual(totalSamples + 11);
    const expectedBatches = Math.ceil(uniqueCoords / 100);
    expect(mock.requests.length).toBe(expectedBatches);
    expect(st.meta.batchesRequested).toBe(expectedBatches);
    expect(st.meta.batchesFailed).toBe(0);
    let summed = 0;
    for (const size of mock.requests) { expect(size).toBeLessThanOrEqual(100); summed += size; }
    expect(summed).toBe(uniqueCoords);
    // Exact mapping: every stored sample matches the deterministic field.
    for (const c of st.candidates) {
      expect(c.terrain.samples.length).toBe(c.terrain.sampleCount + 2);
      const D = c.distanceMeters;
      const n = c.terrain.sampleCount;
      for (let i = 1; i <= n; i++) {
        const planD = D * (i / (n + 1));
        expect(Math.abs(c.terrain.samples[i][1] - (100 + planD / 1000))).toBeLessThanOrEqual(1);
        expect(c.terrain.samples[i][0]).toBe(Math.round(planD));
      }
      expect(c.terrain.samples[c.terrain.samples.length - 1][0]).toBe(D);
    }
  });

  test("50. partial API failure: affected candidates unavailable, others unaffected", async () => {
    const candidates = [];
    for (let km = 2; km <= 20; km += 2) candidates.push(makeCandidate("CandF " + km, km, {}));
    const mock = await setupTerrainWorkspace(page, candidates, {
      failBatchIndexes: [1],
      elev: () => 100
    });
    const st = await page.evaluate(() => window.__ICI_TEST__.getTerrainState());
    expect(mock.failed).toBe(1);
    expect(st.meta.batchesFailed).toBe(1);
    const unavailable = st.candidates.filter((c) => c.terrain && c.terrain.status === "unavailable");
    const classified = st.candidates.filter((c) => c.terrain && ["terrain-clear", "terrain-blocked", "terrain-uncertain"].includes(c.terrain.status));
    expect(unavailable.length).toBeGreaterThanOrEqual(1);
    expect(classified.length).toBeGreaterThanOrEqual(1);
    expect(unavailable.length + classified.length).toBe(st.meta.requestedCandidates);
    for (const c of unavailable) expect(c.terrain.error).toBeTruthy();
    expect(st.meta.completedCandidates).toBe(classified.length); // no fabricated results
    await expect(page.locator("#sightlineFacing .sightline-summary")).toContainText(`10 candidates · terrain available for ${classified.length}`);
    await expect(page.locator("#sightlineCandidates .sl-terr-unavailable")).toHaveCount(unavailable.length);
  });

  test("v2.2.1 complete elevation failure leaves Sightline usable and visibly unavailable", async () => {
    const candidates = [makeCandidate("Unavailable Peak", 8, {}), makeCandidate("Unavailable Hill", 5, {})];
    await setupTerrainWorkspace(page, candidates, { failBatchIndexes: [0, 1, 2, 3, 4] });
    await expect(page.locator("#sightlineFacing .sightline-summary")).toContainText("2 candidates · terrain unavailable");
    await expect(page.locator("#sightlineCandidates li")).toHaveCount(2);
    await expect(page.locator("#sightlineCandidates .sl-terr-unavailable")).toHaveCount(2);
    await expect(page.locator("#sightlineCandidates .sl-terr-unavailable").first()).toContainText("unavailable");
    await expect(page.locator("#sightlineDetailsBtn")).toBeEnabled();
  });

  test("51a. Clear cancels terrain work: requests aborted, state cleared, nothing attaches", async () => {
    await mountOverpassEmpty(page);
    const mock = await mountElevationMock(page, { delayMs: 500, elev: () => 100 });
    await page.goto(fileUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__ICI_TEST__);
    await page.evaluate((c) => window.__ICI_TEST__.exerciseLocation(c[0], c[1]), [CAM.lat, CAM.lng]);
    await page.evaluate((snap) => window.__ICI_TEST__.sightlineTestHelpers.injectSnapshot(snap), buildSnapshot([makeCandidate("Slow Peak", 12, {})], 90));
    const runPromise = page.evaluate(() => window.__ICI_TEST__.sightlineTestHelpers.runTerrainAnalysis());
    await page.waitForTimeout(150);
    await page.click("#clearImageBtn");
    await runPromise;
    expect(await page.evaluate(() => window.__ICI_TEST__.getTerrainState())).toBeNull();
    await expect(page.locator("#sightlineFacing")).toContainText("Awaiting a geotagged image");
    const fulfilledAtClear = mock.fulfilled;
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => window.__ICI_TEST__.getTerrainState())).toBeNull();
    expect(mock.fulfilled - fulfilledAtClear).toBeLessThanOrEqual(1); // handler may finish, nothing attaches
    await expect(page.locator("#focusOverlay")).not.toHaveClass(/open/);
  });

  test("51b. loading another image cancels outstanding terrain work", async () => {
    await mountOverpassEmpty(page);
    const mock = await mountElevationMock(page, { delayMs: 500, elev: () => 100 });
    await page.goto(fileUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__ICI_TEST__);
    await page.evaluate((c) => window.__ICI_TEST__.exerciseLocation(c[0], c[1]), [CAM.lat, CAM.lng]);
    await page.evaluate((snap) => window.__ICI_TEST__.sightlineTestHelpers.injectSnapshot(snap), buildSnapshot([makeCandidate("Slow Peak II", 12, {})], 90));
    const runPromise = page.evaluate(() => window.__ICI_TEST__.sightlineTestHelpers.runTerrainAnalysis());
    await page.waitForTimeout(150);
    await page.setInputFiles("#dz-input", { name: "second.png", mimeType: "image/png", buffer: Buffer.from(TINY_PNG_BASE64, "base64") });
    await runPromise;
    expect(await page.evaluate(() => window.__ICI_TEST__.getTerrainState())).toBeNull();
    await expect(page.locator("#sightlineFacing")).toContainText("GPS missing");
    const fulfilledAtSwitch = mock.fulfilled;
    await page.waitForTimeout(800);
    expect(mock.fulfilled - fulfilledAtSwitch).toBeLessThanOrEqual(1);
  });

  test("51c/39. manual heading change invalidates the old terrain run", async () => {
    await mountOverpassEmpty(page);
    const mock = await mountElevationMock(page, { delayMs: 400, elev: () => 100 });
    await page.goto(fileUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__ICI_TEST__);
    await page.evaluate((c) => window.__ICI_TEST__.exerciseLocation(c[0], c[1]), [CAM.lat, CAM.lng]);
    await page.evaluate((snap) => window.__ICI_TEST__.sightlineTestHelpers.injectSnapshot(snap), buildSnapshot([makeCandidate("Heading Peak", 10, {})], 90));
    const runPromise = page.evaluate(() => window.__ICI_TEST__.sightlineTestHelpers.runTerrainAnalysis());
    await page.waitForTimeout(120);
    await page.evaluate(() => window.__ICI_TEST__.setManualHeadingAndRun(270)); // reruns Sightline (Overpass mocked empty)
    await runPromise;
    const st = await page.evaluate(() => window.__ICI_TEST__.getTerrainState());
    expect(st.candidates.length).toBe(0);       // stale candidates gone
    const fulfilledAtChange = mock.fulfilled;
    await page.waitForTimeout(700);
    expect(mock.fulfilled - fulfilledAtChange).toBeLessThanOrEqual(1);
  });

  test("24/25/26/32. terrain-adjusted ordering with preserved base ranks + AI context", async () => {
    const alpha = makeCandidate("Alpha Ridge", 8, { bearing: 90, rankScore: 70 });            // blocked (-20)
    const beta = makeCandidate("Beta Knob", 7, { bearing: 72, rankScore: 66 });               // clear (+8)
    const gamma = makeCandidate("Gamma Tower", 12, { bearing: 108, rankScore: 62, type: "tower", category: "landmark", tags: { height: "40" } });
    await setupTerrainWorkspace(page, [alpha, beta, gamma], {
      elev: (la, lo) => {
        const d = haversine(CAM.lat, CAM.lng, la, lo);
        if (Math.abs(d - 5500) <= 350 && angDiff(bearingDeg(CAM.lat, CAM.lng, la, lo), 90) <= 3) return 220;
        return demWithCandidatePeaks([alpha, beta])(la, lo);
      }
    });
    const st = await page.evaluate(() => window.__ICI_TEST__.getTerrainState());
    const byName = Object.fromEntries(st.candidates.map((c) => [c.name, c]));
    expect(byName["Alpha Ridge"].terrain.status).toBe("terrain-blocked");
    expect(byName["Alpha Ridge"].rankScore).toBe(70);                 // base score untouched
    expect(byName["Alpha Ridge"].terrainAdjustment).toBe(-20);
    expect(byName["Alpha Ridge"].terrainAdjustedScore).toBe(50);
    expect(byName["Beta Knob"].terrain.status).toBe("terrain-clear");
    expect(byName["Beta Knob"].terrainAdjustedScore).toBe(74);
    expect(byName["Gamma Tower"].terrain.status).toBe("terrain-clear"); // known height clears
    expect(byName["Gamma Tower"].terrain.candidateTargetSource).toBe("OSM height");
    expect(st.candidates.map((c) => c.name)).toEqual(["Beta Knob", "Gamma Tower", "Alpha Ridge"]);
    expect(byName["Beta Knob"].baseRank).toBe(2);                     // geographic rank retained
    expect(byName["Alpha Ridge"].baseRank).toBe(1);

    const payload = await page.evaluate(() => window.__ICI_TEST__.getSightlineState().aiContextPayload);
    expect(payload.possible_features_in_view[0].name).toBe("Beta Knob");
    expect(payload.possible_features_in_view[0].terrain_assessment).toBe("terrain-clear");
    expect(payload.possible_features_in_view[0].candidate_elevation_m).toBe(120); // DEM knob under Beta
    const alphaEntry = payload.possible_features_in_view.find((f) => f.name === "Alpha Ridge");
    expect(alphaEntry.geographic_rank).toBe(1);
    expect(alphaEntry.terrain_adjusted_rank).toBe(3);
    expect(payload.terrain_analysis.dataset).toBe("Copernicus DEM GLO-90");
    expect(payload.terrain_analysis.nominal_resolution_m).toBe(90);
    expect(payload.terrain_analysis.atmospheric_refraction_modeled).toBe(false);
    expect(payload.terrain_analysis.limitations).toMatch(/vegetation/);
    // Blocked candidates are never deleted from the snapshot.
    expect(st.candidates.length).toBe(3);
  });

  test("22i. drawer wording for base-blocked structure with unknown height", async () => {
    await setupTerrainWorkspace(page, [
      makeCandidate("Mystery Water Tower", 10, { type: "water tower", category: "landmark" })
    ], {
      elev: (la, lo) => (Math.abs(haversine(CAM.lat, CAM.lng, la, lo) - 3000) <= 320 ? 115 : 100)
    });
    await expect(page.locator("#sightlineCandidates .sl-terr").first()).toContainText("base blocked");
    await page.locator("#sightlineCandidates li").first().click();
    const drawer = page.locator("#sightlineDrawerBody");
    await expect(drawer).toContainText("Terrain blocks the structure base");
    await expect(drawer).toContainText("unknown structure height may extend above the horizon");
  });

  test("unanalyzed snapshot renders gracefully without terrain chips or blocks", async () => {
    await mountOverpassEmpty(page);
    await blockExternalServices(page);
    await page.goto(fileUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__ICI_TEST__);
    await page.evaluate((c) => window.__ICI_TEST__.exerciseLocation(c[0], c[1]), [CAM.lat, CAM.lng]);
    await page.evaluate(() => window.__ICI_TEST__.simulateLoadedPhoto("spec-photo.jpg"));
    await page.evaluate((snap) => window.__ICI_TEST__.sightlineTestHelpers.injectSnapshot(snap, true), buildSnapshot([makeCandidate("Unanalyzed Peak", 9, {})], 90));
    const chipCount = await page.locator("#sightlineCandidates .sl-terr").count();
    expect(chipCount).toBe(0);
    await page.locator("#sightlineCandidates li").first().click();
    const drawerText = await page.locator("#sightlineDrawerBody").textContent();
    expect(drawerText).not.toContain("Terrain visibility");
    expect(pageErrors).toEqual([]);
  });
});

/* ---------------------------------------------------------------------- *
 * History persistence + restore (zero terrain network on restore)
 * ---------------------------------------------------------------------- */
test.describe(PAGE_LABEL + " history snapshot", () => {
  test("55. terrain evidence persists; restore redraws with zero elevation calls", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await blockExternalServices(page);
    await mountOverpassEmpty(page);
    const hill = makeCandidate("History Hill", 8, { bearing: 70, rankScore: 60 });
    const tower = makeCandidate("History Tower", 6, { bearing: 90, type: "water tower", category: "landmark", rankScore: 65 });
    await mountElevationMock(page, {
      elev: (la, lo) => {
        const d = haversine(CAM.lat, CAM.lng, la, lo);
        if (Math.abs(d - 3000) <= 320 && angDiff(bearingDeg(CAM.lat, CAM.lng, la, lo), 90) <= 3) return 220;
        return haversine(hill.lat, hill.lng, la, lo) <= 40 ? 120 : 100; // raised knob under History Hill
      }
    });
    let elevationCalls = 0;
    page.on("request", (req) => { if (req.url().includes("api.open-meteo.com/v1/elevation")) elevationCalls += 1; });

    await page.goto(fileUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__ICI_TEST__);

    // Configure an API key through the real Settings modal.
    await page.click("#settingsBtn");
    await page.fill("#apiKeyInput", "sk-or-test-history");
    await page.click("#settingsSaveBtn");

    // Mock the AI completion endpoint.
    await page.route("**openrouter.ai/api/v1/chat/completions**", (route) =>
      route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          choices: [{ message: { content: "Terrain-aware analysis answer." } }],
          model: "openai/gpt-4.1-mini",
          usage: { prompt_tokens: 12, completion_tokens: 4 }
        })
      }));

    // Load a real (tiny) image so history thumbnail encoding works.
    await page.setInputFiles("#dz-input", { name: "history-test.png", mimeType: "image/png", buffer: Buffer.from(TINY_PNG_BASE64, "base64") });
    // Let async EXIF parsing settle before injecting GPS, mirroring real usage
    // (a late parse completion would otherwise null out the injected GPS).
    await page.waitForFunction(() => {
      const s = window.__ICI_TEST__.getRuntimeState();
      return ["ok", "no-gps", "no-exif", "parse-error"].includes(s.exifStatus);
    }, null, { timeout: 15000 });
    await page.evaluate((c) => window.__ICI_TEST__.exerciseLocation(c[0], c[1]), [CAM.lat, CAM.lng]);

    await page.evaluate((snap) => window.__ICI_TEST__.sightlineTestHelpers.injectSnapshot(snap), buildSnapshot([hill, tower], 90));
    await page.evaluate(() => window.__ICI_TEST__.sightlineTestHelpers.runTerrainAnalysis());
    await waitForTerrainSettled(page);

    await page.fill("#aiQuestion", "What do you see?");
    await page.click("#analyzeBtn");
    await expect.poll(
      () => page.evaluate(() => window.__ICI_TEST__.getHistoryRecords().then((r) => r.length)),
      { timeout: 30000 }
    ).toBe(1);
    const records = await page.evaluate(() => window.__ICI_TEST__.getHistoryRecords());
    expect(records.length).toBe(1);
    expect(records[0].question).toBe("What do you see?");

    // Reload — restore path must perform zero terrain/elevation network calls.
    const before = elevationCalls;

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__ICI_TEST__);
    await page.click("#historyBtn");
    await page.locator(".history-card").first().click();
    await expect(page.locator(".history-detail")).toContainText("Context sent to AI");
    const contextJson = await page.locator(".detail-block", { hasText: "Context sent to AI" }).locator("pre").textContent();
    expect(contextJson).toContain("terrain_assessment");
    expect(contextJson).toContain("Copernicus DEM GLO-90");

    await page.getByRole("button", { name: "Open in Workspace" }).click();
    await expect(page.locator("#sightlineCandidates .sl-terr").first()).toContainText("terrain clear");
    await page.locator("#sightlineCandidates li").first().click();
    await expect(page.locator("#sightlineDrawerBody .terrain-profile-wrap svg")).toBeVisible();
    await expect(page.locator("#sightlineDrawerBody")).toContainText("Copernicus DEM GLO-90");
    expect(elevationCalls).toBe(before); // zero terrain network calls on restore
    expect(pageErrors).toEqual([]);
  });
});

/* ---------------------------------------------------------------------- *
 * Focus Map integration + mobile layout
 * ---------------------------------------------------------------------- */
test.describe(PAGE_LABEL + " Focus Map terrain tray", () => {
  test("56. selecting a candidate opens a collapsible tray; map sizing untouched", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await blockExternalServices(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    const trayCands = [makeCandidate("Tray Peak", 8, {}), makeCandidate("Tray Hill", 5, {})];
    await setupTerrainWorkspace(page, trayCands, { elev: demWithCandidatePeaks(trayCands) });

    await page.click("#mapExpandBtn");
    await page.waitForSelector("#focusMapContainer.leaflet-container", { timeout: 15000 });
    const mapBoxBefore = await page.locator(".focus-map-container").boundingBox();

    await page.locator(".focus-map-container path.leaflet-interactive").first().hover();
    await expect(page.locator(".focus-map-container .leaflet-tooltip")).toContainText("Terrain: terrain clear");
    await page.locator(".focus-map-container path.leaflet-interactive").first().click();
    const tray = page.locator("#focusTerrainTray");
    await expect(tray).toBeVisible();
    await expect(tray.locator(".focus-terrain-tray-name")).toHaveText(/Tray (Peak|Hill)/);
    await expect(tray).toContainText("Likely terrain-visible");
    await expect(tray.locator("svg")).toBeVisible();
    await expect(tray).toContainText("refraction not modeled");

    // The tray overlays the map — the map container itself never resizes.
    const mapBoxAfter = await page.locator(".focus-map-container").boundingBox();
    expect(mapBoxAfter.width).toBeCloseTo(mapBoxBefore.width, 0);
    expect(mapBoxAfter.height).toBeCloseTo(mapBoxBefore.height, 0);

    // Collapse / expand toggle.
    await tray.locator(".focus-terrain-tray-head").click();
    await expect(tray).toHaveClass(/collapsed/);
    await tray.locator(".focus-terrain-tray-head").click();
    await expect(tray).not.toHaveClass(/collapsed/);

    // Close and reopen.
    await tray.locator(".focus-terrain-tray-close").click();
    await expect(page.locator("#focusTerrainTray")).toHaveCount(0);
    await page.locator(".focus-map-container path.leaflet-interactive").first().click();
    await expect(tray).toBeVisible();

    // Closing Focus View removes the tray entirely.
    await page.click("#focusCloseBtn");
    await expect(page.locator("#focusTerrainTray")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test("57. mobile 390x844: drawer profile fits width, tray stacks, no horizontal scroll", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await blockExternalServices(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await setupTerrainWorkspace(page, [makeCandidate("Mobile Peak", 9, {})], { elev: () => 100 });

    await page.locator("#sightlineCandidates li").first().click();
    const svgBox = await page.locator("#sightlineDrawerBody .terrain-profile-wrap svg").boundingBox();
    expect(svgBox.width).toBeLessThanOrEqual(391);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);

    // Focus Map terrain tray stacks vertically and stays inside the viewport.
    await page.click("#sightlineCloseBtn");
    await page.click("#mapExpandBtn");
    await page.waitForSelector("#focusMapContainer.leaflet-container", { timeout: 15000 });
    await page.locator(".focus-map-container path.leaflet-interactive").first().click();
    await expect(page.locator("#focusTerrainTray")).toBeVisible();
    const factsBox = await page.locator("#focusTerrainTray .focus-terrain-tray-facts").boundingBox();
    const graphBox = await page.locator("#focusTerrainTray .focus-terrain-tray-graph").boundingBox();
    expect(graphBox.width).toBeLessThanOrEqual(391);
    expect(factsBox.y).toBeLessThan(graphBox.y); // stacked vertically
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    expect(pageErrors).toEqual([]);
  });
});

/* ---------------------------------------------------------------------- *
 * v2.2.1 screenshot acceptance — normal Sightline visibility
 * ---------------------------------------------------------------------- */
test.describe(PAGE_LABEL + " terrain visibility screenshots", () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1904, height: 832 },
    { width: 390, height: 844 }
  ]) {
    test(`${viewport.width}x${viewport.height}: normal Sightline badges remain readable without clipping`, async ({ page }) => {
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));
      await blockExternalServices(page);
      await mountOverpassEmpty(page);
      await page.setViewportSize(viewport);
      await page.goto(fileUrl, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !!window.__ICI_TEST__);
      await page.evaluate((c) => window.__ICI_TEST__.exerciseLocation(c[0], c[1]), [CAM.lat, CAM.lng]);
      await page.evaluate(() => window.__ICI_TEST__.simulateLoadedPhoto("southern-indiana.jpg"));

      const fisher = makeCandidate("Fisher Knobs", 13.8, { bearing: 335, rankScore: 72 });
      fisher.headingDeltaDegrees = 0.9;
      fisher.terrain = { status: "terrain-uncertain" };
      fisher.baseRank = 1;
      fisher.terrainAdjustment = 0;
      fisher.terrainAdjustedScore = 72;
      const rosa = makeCandidate("Mount Rosa", 15.3, { bearing: 338, rankScore: 69 });
      rosa.headingDeltaDegrees = 3.1;
      rosa.terrain = { status: "terrain-blocked" };
      rosa.baseRank = 2;
      rosa.terrainAdjustment = -20;
      rosa.terrainAdjustedScore = 49;
      const tower = makeCandidate("Henderson Water Tower", 6.3, { bearing: 329, type: "water tower", category: "landmark", rankScore: 64 });
      tower.headingDeltaDegrees = 5.1;
      tower.terrain = { status: "base-blocked-height-unknown" };
      tower.baseRank = 3;
      tower.terrainAdjustment = -8;
      tower.terrainAdjustedScore = 56;
      const snap = buildSnapshot([fisher, tower, rosa], 334.1);
      snap.matchedCount = 3;
      snap.terrain = {
        status: "complete", requestedCandidates: 3, completedCandidates: 3,
        provider: "Open-Meteo", dataset: "Copernicus DEM GLO-90", resolutionM: 90,
        samplePointsGenerated: 0, batchesRequested: 0, batchesFailed: 0
      };
      await page.evaluate((snapshot) => window.__ICI_TEST__.sightlineTestHelpers.injectSnapshot(snapshot), snap);

      const section = page.locator("#sightlineSection");
      await section.scrollIntoViewIfNeeded();
      await expect(page.locator("#sightlineFacing .sightline-summary")).toContainText("3 candidates · 3 terrain analyzed");
      await expect(page.locator("#sightlineCandidates li", { hasText: "Fisher Knobs" })).toContainText("uncertain");
      await expect(page.locator("#sightlineCandidates li", { hasText: "Mount Rosa" })).toContainText("terrain blocked");
      await expect(page.locator("#sightlineCandidates li", { hasText: "Henderson Water Tower" })).toContainText("base blocked");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
      const clippedRows = await page.locator("#sightlineCandidates li").evaluateAll((rows) =>
        rows.filter((row) => row.scrollWidth > row.clientWidth + 1).length);
      expect(clippedRows).toBe(0);
      await page.screenshot({ path: `/tmp/image-context-inspector-terrain-${viewport.width}x${viewport.height}.png` });
      expect(pageErrors).toEqual([]);
    });
  }
});
