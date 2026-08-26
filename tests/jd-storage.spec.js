const { test, expect } = require("@playwright/test");
const path = require("path");

test.use({ channel: "chrome" });

const FIXTURE_URL = "file:///var/folders/c3/ldm9f34x49gbzf_2mx_4ws3r0000gn/T/opencode/jd-storage-fixture.html";

async function freshPage(page) {
  // about:blank denies localStorage; a real file:// page has a usable origin.
  await page.goto(FIXTURE_URL);
  await page.addScriptTag({ path: path.resolve(process.cwd(), "jd-storage.js") });
  await page.evaluate(() => localStorage.clear());
}

test("setJSON/setString succeed normally and read back", async ({ page }) => {
  await freshPage(page);
  const res = await page.evaluate(() => {
    const r1 = JDStorage.setJSON("t.a.v1", { n: 1, s: "x" });
    const r2 = JDStorage.setString("t.b.v1", "plain");
    return { r1: r1.ok, r2: r2.ok, back: JDStorage.getJSON("t.a.v1", null), plain: JDStorage.getString("t.b.v1") };
  });
  expect(res.r1).toBe(true);
  expect(res.r2).toBe(true);
  expect(res.back).toEqual({ n: 1, s: "x" });
  expect(res.plain).toBe("plain");
});

test("getJSON falls back on missing or corrupt values without throwing", async ({ page }) => {
  await freshPage(page);
  const res = await page.evaluate(() => {
    localStorage.setItem("t.corrupt", "{not json");
    return {
      missing: JDStorage.getJSON("t.missing", { d: 1 }),
      corrupt: JDStorage.getJSON("t.corrupt", { d: 2 }),
      nullDefault: JDStorage.getString("t.missing", "fb")
    };
  });
  expect(res.missing).toEqual({ d: 1 });
  expect(res.corrupt).toEqual({ d: 2 });
  expect(res.nullDefault).toBe("fb");
});

test("quota errors never throw and evict-and-retry recovers", async ({ page }) => {
  await freshPage(page);
  const res = await page.evaluate(() => {
    const original = localStorage.setItem.bind(localStorage);
    let failures = 2; // fail the first two attempts, then succeed
    localStorage.setItem = function (k, v) {
      if (failures > 0) { failures -= 1; const e = new Error("exceeded the quota"); e.name = "QuotaExceededError"; throw e; }
      return original(k, v);
    };
    const evictions = [];
    const store = { history: new Array(50).fill("x") };
    const res = JDStorage.setJSON("t.quota.v1", store, {
      maxRetries: 3,
      evict: function () { evictions.push(1); store.history = store.history.slice(0, 10); }
    });
    localStorage.setItem = original;
    return { ok: res.ok, attempts: res.attempts, evictions: evictions.length, stored: JDStorage.getJSON("t.quota.v1", null).history.length };
  });
  expect(res.ok).toBe(true);
  expect(res.attempts).toBe(2);
  expect(res.evictions).toBe(2);
  expect(res.stored).toBe(10);
});

test("exhausted retries return a structured quota failure, no throw", async ({ page }) => {
  await freshPage(page);
  const res = await page.evaluate(() => {
    const original = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function () {
      const e = new Error("exceeded the quota"); e.name = "QuotaExceededError"; throw e;
    };
    let evictions = 0;
    const out = JDStorage.setString("t.impossible", "v", { maxRetries: 2, evict: () => { evictions += 1; } });
    localStorage.setItem = original;
    return { ok: out.ok, quota: out.quota, error: out.error, evictions };
  });
  expect(res.ok).toBe(false);
  expect(res.quota).toBe(true);
  expect(res.evictions).toBe(2);
  expect(typeof res.error).toBe("string");
});

test("sizeOf and remove behave", async ({ page }) => {
  await freshPage(page);
  const res = await page.evaluate(() => {
    JDStorage.setString("t.size", "abcd");
    const before = JDStorage.sizeOf("t.size");
    const removed = JDStorage.remove("t.size");
    const after = JDStorage.sizeOf("t.size");
    return { before, removed, after };
  });
  expect(res.before).toBeGreaterThan(0);
  expect(res.removed).toBe(true);
  expect(res.after).toBe(0);
});
