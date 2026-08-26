const { test, expect } = require("@playwright/test");
const path = require("path");

test.use({ channel: "chrome" });

function attachErrorCapture(page, errors) {
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/net::|Failed to load resource/.test(m.text())) errors.push(m.text()); });
}

// Keep retention tests hermetic: live market/news fetches are nondeterministic
// and race with the seeded data. Local file:// loads, the analytics beacon,
// and CDN libraries (Dexie/Chart.js) are allowed; data APIs are blocked.
async function blockNetwork(page) {
  await page.route("**/*", r => {
    const url = r.request().url();
    if (url.startsWith("file://")) return r.continue();
    if (url.includes("/api/analytics/")) return r.fulfill({ status: 204, body: "" });
    if (/jsdelivr|unpkg|cdnjs/.test(url)) return r.continue();
    return r.abort();
  });
}

function idbCount(page, dbName, storeName) {
  return page.evaluate(([db, store]) => new Promise((resolve, reject) => {
    // Open without a version: the apps use Dexie at higher versions and we
    // must attach to the existing schema, never create/upgrade it.
    const req = indexedDB.open(db);
    req.onsuccess = () => {
      const d = req.result;
      try {
        const tx = d.transaction(store, "readonly");
        const cr = tx.objectStore(store).count();
        cr.onsuccess = () => { d.close(); resolve(cr.result); };
        cr.onerror = () => { d.close(); reject(cr.error); };
      } catch (e) { d.close(); reject(e); }
    };
    req.onerror = () => reject(req.error);
  }), [dbName, storeName]);
}

function idbAdd(page, dbName, storeName, rows) {
  return page.evaluate(([db, store, rows]) => new Promise((resolve, reject) => {
    const req = indexedDB.open(db);
    req.onsuccess = () => {
      const d = req.result;
      const tx = d.transaction(store, "readwrite");
      const os = tx.objectStore(store);
      rows.forEach(r => os.add(r));
      tx.oncomplete = () => { d.close(); resolve(true); };
      tx.onerror = () => { d.close(); reject(tx.error); };
      tx.onabort = () => { d.close(); reject(tx.error || new Error("aborted")); };
    };
    req.onerror = () => reject(req.error);
  }), [dbName, storeName, rows]);
}

function starredEventCount(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open("watchtowerDB");
    req.onsuccess = () => {
      const d = req.result;
      const tx = d.transaction("events", "readonly");
      const out = { total: 0, starred: 0 };
      const cursorReq = tx.objectStore("events").openCursor();
      cursorReq.onsuccess = () => {
        const c = cursorReq.result;
        if (!c) { d.close(); resolve(out); return; }
        out.total += 1;
        if (c.value.starred === true) out.starred += 1;
        c.continue();
      };
      cursorReq.onerror = () => { d.close(); reject(cursorReq.error); };
    };
    req.onerror = () => reject(req.error);
  }));
}

test("polymarket: init prune enforces age + hard caps", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await blockNetwork(page);
  await page.goto(`file://${path.resolve(process.cwd(), "polymarket_pulse.html")}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500); // let Dexie create the schema

  const day = 86400000;
  const now = Date.now();
  await idbAdd(page, "PolymarketPulseDB", "fetchLogs",
    Array.from({ length: 600 }, (_, i) => ({ timestamp: now - i * 1000, level: "info", type: "t", message: "m" + i })));
  await idbAdd(page, "PolymarketPulseDB", "llmAnalyses",
    Array.from({ length: 220 }, (_, i) => ({ createdAt: now - i * 1000, model: "m", scope: "s", overallMood: "x" })));
  await idbAdd(page, "PolymarketPulseDB", "marketTicks",
    Array.from({ length: 120 }, (_, i) => ({ marketId: "mk" + (i % 10), timestamp: now - (i < 60 ? 10 * day : i * 1000), price: 0.5 })));

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500); // init prune is fire-and-forget

  expect(await idbCount(page, "PolymarketPulseDB", "fetchLogs")).toBeLessThanOrEqual(500);
  expect(await idbCount(page, "PolymarketPulseDB", "llmAnalyses")).toBeLessThanOrEqual(200);
  const ticks = await idbCount(page, "PolymarketPulseDB", "marketTicks");
  expect(ticks).toBeLessThanOrEqual(120);
  expect(ticks).toBeLessThan(120); // old ticks (10 days) age-pruned at 3d default
  expect(errors.length).toBe(0);
});

test("crypto mood ring: init prune enforces age + hard caps", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await blockNetwork(page);
  await page.goto(`file://${path.resolve(process.cwd(), "crypto-mood-ring.html")}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const day = 86400000;
  const now = Date.now();
  await idbAdd(page, "CryptoMoodRingDB", "fetchLogs",
    Array.from({ length: 520 }, (_, i) => ({ timestamp: now - i * 1000, level: "info", type: "t", message: "m" + i })));
  await idbAdd(page, "CryptoMoodRingDB", "llmAnalyses",
    Array.from({ length: 210 }, (_, i) => ({ createdAt: now - i * 1000, model: "m", recommendationSummary: "x" })));
  await idbAdd(page, "CryptoMoodRingDB", "priceTicks",
    Array.from({ length: 30 }, (_, i) => ({ coinId: "btc", symbol: "BTC", provider: "p", timestamp: now - 10 * day - i, price: 1 })));

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  expect(await idbCount(page, "CryptoMoodRingDB", "fetchLogs")).toBeLessThanOrEqual(500);
  expect(await idbCount(page, "CryptoMoodRingDB", "llmAnalyses")).toBeLessThanOrEqual(200);
  // 10-day-old ticks are beyond the 7-day price retention: all seeded ticks gone
  // (any remaining rows would be fresh ticks the app itself wrote).
  const ticks = await idbCount(page, "CryptoMoodRingDB", "priceTicks");
  expect(ticks).toBeLessThanOrEqual(5);
  expect(errors.length).toBe(0);
});

test("watchtower: unstarred old events pruned, starred survive, scans capped", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await blockNetwork(page);
  await page.goto(`file://${path.resolve(process.cwd(), "the-watchtower.html")}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const oldIso = new Date(Date.now() - 40 * 86400000).toISOString();
  const events = [];
  for (let i = 0; i < 5200; i++) events.push({ id: "ev-old-" + i, title: "old " + i, sourceType: "gdelt", sourceName: "seed", tags: [], links: [], fetchedAt: oldIso, starred: false });
  for (let i = 0; i < 50; i++) events.push({ id: "ev-star-" + i, title: "star " + i, sourceType: "gdelt", sourceName: "seed", tags: [], links: [], fetchedAt: oldIso, starred: true });
  await idbAdd(page, "watchtowerDB", "events", events);
  await idbAdd(page, "watchtowerDB", "scans",
    Array.from({ length: 600 }, (_, i) => ({ startedAt: oldIso, finishedAt: oldIso })));

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(async () => true, null, { timeout: 1000 }).catch(() => {});
  await page.waitForTimeout(4000);

  const counts = await starredEventCount(page);
  expect(counts.starred).toBe(50);        // starred always survive
  expect(counts.total).toBe(50);          // all 5,200 unstarred old events pruned (age)
  expect(await idbCount(page, "watchtowerDB", "scans")).toBeLessThanOrEqual(500);
  expect(errors.length).toBe(0);
});
