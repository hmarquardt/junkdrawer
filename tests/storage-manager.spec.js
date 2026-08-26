const { test, expect } = require("@playwright/test");
const path = require("path");

const fileUrl = `file://${path.resolve(process.cwd(), "storage-manager.html")}`;

test.use({ channel: "chrome" });

function attachErrorCapture(page, errors) {
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/analytics/**", r => r.fulfill({ status: 204, body: "" }));
  await page.goto(fileUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__SM_TEST__));
  await page.evaluate(() => {
    localStorage.clear();
    indexedDB.databases().then(dbs => dbs.forEach(d => indexedDB.deleteDatabase(d.name)));
    if ("caches" in window) caches.keys().then(ns => ns.forEach(n => caches.delete(n)));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__SM_TEST__));
});

test("discovers seeded localStorage keys with sizes, owners, and shapes", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await page.evaluate(() => {
    localStorage.setItem("timeToClick.timers.v2", JSON.stringify([{ id: "t1", prompt: "x" }]));
    localStorage.setItem("dpz_source_content_user-1", "x".repeat(50000));
    localStorage.setItem("mystery_key_no_owner", "hello world");
    localStorage.setItem("songforge_state", JSON.stringify({ projects: [], generated_images: [] }));
  });
  await page.evaluate(() => window.__SM_TEST__.refreshAll());
  await page.waitForTimeout(400);

  const rows = await page.evaluate(() => window.__SM_TEST__.scanLocalStorage());
  const byKey = Object.fromEntries(rows.map(r => [r.key, r]));
  expect(byKey["timeToClick.timers.v2"].owner).toBe("Time to Click");
  expect(byKey["timeToClick.timers.v2"].shape).toContain("Array(1 records)");
  expect(byKey["dpz_source_content_user-1"].owner).toBe("Dating Pyramid Zeitgeist");
  expect(byKey["dpz_source_content_user-1"].size).toBeGreaterThanOrEqual(100000);
  expect(byKey["mystery_key_no_owner"].owner).toBe("Unrecognized");
  expect(byKey["songforge_state"].owner).toBe("SongForge AI");

  await expect(page.locator("tr", { hasText: "dpz_source_content_user-1" })).toBeVisible();
  // 4 seeded + 1 written by analytics-lite.js (junkstats.visitor_id)
  await expect(page.locator("#lsTotal")).toContainText("5 keys");
  expect(errors.length).toBe(0);
});

test("legacy/orphan keys are flagged with risk badges", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await page.evaluate(() => {
    localStorage.setItem("quack-drawer-import", "csv,data");
    localStorage.setItem("wgpu_pp_saved", "[]");
    localStorage.setItem("bca-theme", "dark");
  });
  await page.evaluate(() => window.__SM_TEST__.refreshAll());
  await page.waitForTimeout(400);

  await expect(page.locator("#lsTableWrap tr", { hasText: "quack-drawer-import" }).locator(".badge.red")).toHaveText("legacy");
  await expect(page.locator("#lsTableWrap tr", { hasText: "wgpu_pp_saved" }).locator(".badge.red")).toHaveText("legacy");
  const themeRow = page.locator("#lsTableWrap tr", { hasText: "bca-theme" });
  await expect(themeRow).toBeVisible();
  await expect(themeRow.locator(".badge.red")).toHaveCount(0);
  expect(errors.length).toBe(0);
});

test("sorting by size/key/app and filtering work", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await page.evaluate(() => {
    localStorage.setItem("aaa_small", "x");
    localStorage.setItem("zzz_big", "y".repeat(20000));
    localStorage.setItem("mmm_mid", "z".repeat(2000));
  });
  await page.evaluate(() => window.__SM_TEST__.refreshAll());
  await page.waitForTimeout(300);

  const firstKeyBySize = await page.locator("#lsTableWrap tbody tr td.key-cell").first().textContent();
  expect(firstKeyBySize).toContain("zzz_big");

  await page.selectOption("#lsSort", "key");
  const keysSorted = await page.locator("#lsTableWrap tbody tr td.key-cell").allTextContents();
  expect(keysSorted[0]).toContain("aaa_small");

  await page.fill("#lsFilter", "mmm");
  await expect(page.locator("#lsTableWrap tbody tr")).toHaveCount(1);
  await page.fill("#lsFilter", "");
  await page.selectOption("#lsSort", "app");
  expect(errors.length).toBe(0);
});

test("delete key requires confirmation; cancel leaves data; confirm removes", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await page.evaluate(() => localStorage.setItem("junkstats.dashboard.theme", "dark"));
  await page.evaluate(() => window.__SM_TEST__.refreshAll());
  await page.waitForTimeout(300);

  await page.locator("tr", { hasText: "junkstats.dashboard.theme" }).locator(".ls-delete").click();
  await expect(page.locator("#confirmDialog")).toBeVisible();
  await expect(page.locator("#confirmMessage")).toContainText("junkstats.dashboard.theme");
  await page.click("#confirmCancel");
  await expect(page.locator("#confirmDialog")).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("junkstats.dashboard.theme"))).toBe("dark");

  await page.locator("tr", { hasText: "junkstats.dashboard.theme" }).locator(".ls-delete").click();
  await page.click("#confirmOk");
  await expect(page.locator("#confirmDialog")).toBeHidden();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => localStorage.getItem("junkstats.dashboard.theme"))).toBeNull();
  expect(errors.length).toBe(0);
});

test("IndexedDB databases are discovered with store counts and deletable with typed confirmation", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  const created = await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open("GBIFExplorerCache", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("searches", { keyPath: "id" });
      db.createObjectStore("records", { keyPath: "cacheKey" });
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(["searches", "records"], "readwrite");
      for (let i = 0; i < 5; i++) tx.objectStore("searches").put({ id: i });
      for (let i = 0; i < 3; i++) tx.objectStore("records").put({ cacheKey: i });
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  }));
  expect(created).toBe(true);

  await page.click("#tab-idb");
  await page.evaluate(() => window.__SM_TEST__.refreshAll());
  await page.waitForFunction(() => {
    const block = document.querySelector('.db-block[data-db="GBIFExplorerCache"]');
    return block && block.textContent.includes("records");
  }, { timeout: 10000 });

  const block = page.locator('.db-block[data-db="GBIFExplorerCache"]');
  await expect(block).toContainText("5 records");
  await expect(block).toContainText("3 records");
  await expect(block).toContainText("GBIF Explorer");
  await expect(block).toContainText("size: unavailable");

  await block.locator(".idb-delete").click();
  await expect(page.locator("#typedDialog")).toBeVisible();
  await expect(page.locator("#typedMessage")).toContainText("GBIFExplorerCache");
  // typed confirm: wrong phrase disabled, cancel keeps data
  await page.fill("#typedInput", "wrong-name");
  await expect(page.locator("#typedOk")).toBeDisabled();
  await page.click("#typedCancel");
  await expect(page.locator("#typedDialog")).toBeHidden();
  const stillThere = await page.evaluate(() => indexedDB.databases().then(dbs => dbs.some(d => d.name === "GBIFExplorerCache")));
  expect(stillThere).toBe(true);

  await page.locator('.db-block[data-db="GBIFExplorerCache"] .idb-delete').click();
  await page.fill("#typedInput", "GBIFExplorerCache");
  await page.click("#typedOk");
  await page.waitForFunction(() => indexedDB.databases().then(dbs => !dbs.some(d => d.name === "GBIFExplorerCache")), { timeout: 10000 });
  expect(errors.length).toBe(0);
});

test("cache storage entries are discovered and deletable with confirmation", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await page.evaluate(() => caches.open("test-cache-fixture").then(c => c.put("https://example.com/x", new Response("hello"))));
  await page.click("#tab-cache");
  await page.evaluate(() => window.__SM_TEST__.refreshAll());
  await page.waitForFunction(() => document.body.textContent.includes("test-cache-fixture"));

  const block = page.locator('.db-block[data-cache="test-cache-fixture"]');
  await expect(block).toContainText("1 entry");
  await block.locator(".cache-delete").click();
  await page.click("#confirmCancel");
  expect(await page.evaluate(() => caches.keys().then(ns => ns.includes("test-cache-fixture")))).toBe(true);
  await block.locator(".cache-delete").click();
  await page.click("#confirmOk");
  await page.waitForFunction(() => caches.keys().then(ns => !ns.includes("test-cache-fixture")));
  expect(errors.length).toBe(0);
});

test("overview shows quota estimates and localStorage total", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await page.evaluate(() => localStorage.setItem("pad", "q".repeat(3000)));
  await page.evaluate(() => window.__SM_TEST__.refreshAll());
  await page.waitForTimeout(500);
  const usage = await page.locator("#statUsage").textContent();
  const ls = await page.locator("#statLS").textContent();
  expect(usage).not.toBe("unavailable");
  expect(ls).toMatch(/KB|B/);
  await expect(page.locator("#persistStatus")).toContainText(/Persistent storage: (granted|not granted)/);
  expect(errors.length).toBe(0);
});

test("diagnostics tab lists largest consumers and legacy cleanup section", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await page.evaluate(() => {
    localStorage.setItem("chatTranscriber", JSON.stringify({ history: new Array(50).fill("x") }));
    localStorage.setItem("quack_drawer_saved_queries", "[]");
  });
  await page.evaluate(() => window.__SM_TEST__.refreshAll());
  await page.click("#tab-rec");
  await expect(page.locator("#recContent")).toContainText("Largest localStorage consumers");
  await expect(page.locator("#recContent li", { hasText: "chatTranscriber" }).locator(".badge.red")).toHaveText("red");
  await expect(page.locator("#recContent")).toContainText("quack_drawer_saved_queries");
  await expect(page.locator("#recContent")).toContainText("v1 saved queries");
  expect(errors.length).toBe(0);
});

test("origin reset requires typing RESET and actually clears storage", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await page.evaluate(() => {
    localStorage.setItem("some_key", "1");
    const req = indexedDB.open("reset_fixture", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("s");
    req.onsuccess = () => req.result.close();
  });
  await page.evaluate(() => caches.open("reset-cache").then(c => c.put("https://example.com/y", new Response("z"))));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__SM_TEST__.refreshAll());
  await page.waitForTimeout(300);

  await page.click(".danger-zone summary");
  await page.click("#originResetBtn");
  await expect(page.locator("#typedDialog")).toBeVisible();
  await page.fill("#typedInput", "nope");
  await page.click("#typedCancel");
  expect(await page.evaluate(() => localStorage.getItem("some_key"))).toBe("1");

  await page.click("#originResetBtn");
  await page.fill("#typedInput", "RESET");
  await page.click("#typedOk");
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  const dbs = await page.evaluate(() => indexedDB.databases().then(d => d.map(x => x.name)));
  expect(dbs).not.toContain("reset_fixture");
  const cachesLeft = await page.evaluate(() => caches.keys());
  expect(cachesLeft).not.toContain("reset-cache");
  expect(errors.length).toBe(0);
});

// ---------------------------------------------------------------------------
// Phase 2: Applications health view (growth/retention classifications).
// ---------------------------------------------------------------------------

test("Applications tab renders growth and health classifications from live data", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await page.evaluate(() => {
    localStorage.setItem("songforge_state", JSON.stringify({ projects: [] }));
    localStorage.setItem("whatShouldIEat.settings.v1", "{}");
  });
  await page.evaluate(() => window.__SM_TEST__.refreshAll());
  await page.click("#tab-apps");
  await expect(page.locator("#appsTableWrap table")).toBeVisible();

  // Migrated apps classified from the audit metadata
  const dpzRow = page.locator("#appsTableWrap tr", { hasText: "Dating Pyramid Zeitgeist" });
  await expect(dpzRow.locator(".badge", { hasText: "USER-MANAGED" })).toBeVisible();
  await expect(dpzRow.locator(".badge", { hasText: "GOOD" })).toBeVisible();

  const pmRow = page.locator("#appsTableWrap tr", { hasText: "Polymarket Pulse" });
  await expect(pmRow.locator(".badge", { hasText: "AGE-PRUNED" })).toBeVisible();
  await expect(pmRow.locator(".badge", { hasText: "GOOD" })).toBeVisible();

  const wtRow = page.locator("#appsTableWrap tr", { hasText: "The Watchtower" });
  await expect(wtRow.locator(".badge", { hasText: "AGE-PRUNED" })).toBeVisible();

  // Live per-app localStorage size is computed, not invented
  const songforgeSize = await page.evaluate(() => window.__SM_TEST__.appLiveLsSize("SongForge AI"));
  expect(songforgeSize).toBeGreaterThan(0);
  const songforgeRow = page.locator("#appsTableWrap tr", { hasText: "SongForge AI" });
  await expect(songforgeRow).toContainText("B");

  expect(errors.length).toBe(0);
});

test("unbounded apps are surfaced; healthy large-IDB apps are not marked unhealthy for size", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await page.evaluate(() => window.__SM_TEST__.refreshAll());
  await page.click("#tab-rec");

  await expect(page.locator("#recContent")).toContainText("Apps still growing without bounds");
  await expect(page.locator("#recContent li", { hasText: "Local AI Scratchpad" }).first()).toBeVisible();
  await expect(page.locator("#recContent")).toContainText("Flagged for review");

  // Healthy-despite-large note present
  await expect(page.locator("#recContent")).toContainText("Large-but-healthy IndexedDB apps");

  const ici = await page.evaluate(() => window.__SM_TEST__.appHealth["Image Context Inspector"]);
  expect(ici.health).toBe("GOOD");
  const bca = await page.evaluate(() => window.__SM_TEST__.appHealth["UI Berry 3R Evaluator"]);
  expect(bca.note).toContain("excluded");
  expect(errors.length).toBe(0);
});

test("oversized-key diagnostic lists big keys with sizes", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await page.evaluate(() => localStorage.setItem("dpz_source_content_huge", "z".repeat(80000)));
  await page.evaluate(() => window.__SM_TEST__.refreshAll());
  await page.click("#tab-rec");
  const oversizedSection = page.locator("#recContent .rec-section", { hasText: "Oversized localStorage keys" });
  await expect(oversizedSection.locator("li", { hasText: "dpz_source_content_huge" })).toBeVisible();
  expect(errors.length).toBe(0);
});

test("legacy candidates still display and deletion remains confirmation-gated", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await page.evaluate(() => localStorage.setItem("kraken_radar", "{}"));
  await page.evaluate(() => window.__SM_TEST__.refreshAll());
  await page.waitForTimeout(300);
  await expect(page.locator("tr", { hasText: "kraken_radar" }).locator(".badge.red")).toHaveText("legacy");
  // guard: deleting requires the modal, and cancelling keeps data
  await page.locator("#lsTableWrap tr", { hasText: "kraken_radar" }).locator(".ls-delete").click();
  await expect(page.locator("#confirmDialog")).toBeVisible();
  await page.click("#confirmCancel");
  expect(await page.evaluate(() => localStorage.getItem("kraken_radar"))).toBe("{}");
  expect(errors.length).toBe(0);
});
