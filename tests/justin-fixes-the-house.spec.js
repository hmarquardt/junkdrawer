const { test, expect } = require("@playwright/test");
const path = require("node:path");
const url = "file://" + path.resolve("justin-fixes-the-house.html");

test.use({ channel: "chrome" });

function watch(page) {
  const errors = [];
  page.route("**/api/analytics/**", (r) => r.fulfill({ status: 204 }));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

test("title screen, Open Graph metadata, full Chapter 1 loop, Lowe's run, and save persistence", async ({
  page,
}) => {
  const errors = watch(page);
  await page.goto(url);

  // Verify OG + Twitter Card metadata
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://hmarquardt.github.io/junkdrawer/justin-fixes-the-house/poster.jpg",
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );

  // Start Chapter 1
  await page.click("#startBtn");
  await expect(page.locator("#sceneName")).toHaveText("Inside the House");
  await page.click("#sceneNextBtn");
  await expect(page.locator("#sceneCard")).toBeHidden();

  // Inspect all 3 broken items via click-to-walk on the hardware list
  for (let i = 0; i < 3; i++) {
    await page.locator("#hardwareList li").nth(i).click();
    await expect
      .poll(() => page.evaluate(() => window.__JUSTIN_TEST__.getState().foundCount()))
      .toBe(i + 1);
  }

  // Drive to Lowe's
  await expect(page.locator("#driveLowesBtn")).toBeEnabled();
  await page.click("#driveLowesBtn");
  await expect.poll(() => page.evaluate(() => window.__JUSTIN_TEST__.getState().mode)).toBe("driving");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await page.evaluate(() => window.__JUSTIN_TEST__.finishDriveNow());

  // Lowe's checkout: trigger impulse buy quip, then Grab All Listed & checkout
  await expect(page.locator("#dialog")).toBeVisible();
  await page.click("#impulseBtn");
  await expect(page.locator("#checkoutMsg")).toContainText("stud finders");
  await page.click("#grabAllBtn");
  await page.click("#finishCheckoutBtn");
  await expect(page.locator("#dialog")).toBeHidden();

  // Fix all 3 items (exercise real breaker + wiring UI on Wall Switch!)
  // 1. Flickering bulb (index 0)
  await page.locator("#hardwareList li").nth(0).click();
  await expect(page.locator("#dialog")).toBeVisible();
  await page.evaluate(() => window.__JUSTIN_TEST__.completeActiveRepair());
  await expect(page.locator("#dialog")).toBeHidden();

  // 2. Loose wall switch (index 1) — real breaker OFF -> 3 wires -> breaker ON
  await page.locator("#hardwareList li").nth(1).click();
  await expect(page.locator("#breakerBtn")).toBeVisible();
  await page.click("#breakerBtn");
  for (let w = 0; w < 3; w++) await page.click(`[data-wire="${w}"]`);
  await page.click("#breakerBtn");
  await expect(page.locator("#dialog")).toBeHidden();

  // 3. Pantry hinge (index 2)
  await page.locator("#hardwareList li").nth(2).click();
  await expect(page.locator("#dialog")).toBeVisible();
  await page.evaluate(() => window.__JUSTIN_TEST__.completeActiveRepair());
  await expect(page.locator("#sceneTag")).toHaveText("CHAPTER 01 COMPLETE");

  // Reload and verify checkpoint + achievements persisted in localStorage
  await page.reload();
  await expect(page.locator("#continueBtn")).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("justin.campaign")));
  expect(saved.unlocked).toBe(2);
  expect(saved.checkpoint).toBe(2);
  expect(saved.lowesTripsTotal).toBe(1);
  expect(saved.achievements).toContain("firstFix");
  expect(saved.achievements).toContain("safetyFirst");
  expect(saved.achievements).toContain("impulseBuy");
  expect(errors).toEqual([]);
});

test("Chapter 3 triggers the iconic second Lowe's run for the 3/8-inch bevel washer", async ({
  page,
}) => {
  const errors = watch(page);
  await page.goto(url);
  await page.evaluate(() => window.__JUSTIN_TEST__.startChapter(2));
  await page.click("#sceneNextBtn");

  // Spot the dripping outdoor spigot (index 1 in Chapter 3)
  await page.locator("#hardwareList li").nth(1).click();
  await expect
    .poll(() => page.evaluate(() => window.__JUSTIN_TEST__.getState().repairs.spigot.found))
    .toBe(true);

  // First Lowe's run for the 1/2" flat washer
  await page.click("#driveLowesBtn");
  await page.evaluate(() => window.__JUSTIN_TEST__.finishDriveNow());
  await page.click("#grabAllBtn");
  await page.click("#finishCheckoutBtn");

  // Attempting to fix spigot triggers "BACK TO LOWE'S!" surprise card
  await page.locator("#hardwareList li").nth(1).click();
  await expect(page.locator("#sceneName")).toHaveText("BACK TO LOWE’S!");
  await page.click("#sceneNextBtn");
  await expect.poll(() => page.evaluate(() => window.__JUSTIN_TEST__.getState().mode)).toBe("driving");
  await page.evaluate(() => window.__JUSTIN_TEST__.finishDriveNow());

  // Checkout now lists the 3/8" Bevel Washer!
  await expect(page.locator("#dialogContent")).toContainText("3/8\" Bevel Washer");
  await page.click("#grabAllBtn");
  await page.click("#finishCheckoutBtn");

  // Now fixing the spigot opens the plumbing mini-game!
  await page.locator("#hardwareList li").nth(1).click();
  await expect(page.locator("#breakerBtn")).toContainText("WATER: ON");
  await page.click("#breakerBtn");
  for (let w = 0; w < 3; w++) await page.click(`[data-wire="${w}"]`);
  await page.click("#breakerBtn");
  await expect
    .poll(() => page.evaluate(() => window.__JUSTIN_TEST__.getState().repairs.spigot.fixed))
    .toBe(true);
  expect(await page.evaluate(() => window.__JUSTIN_TEST__.getState().lowesTrips)).toBe(2);
  expect(errors).toEqual([]);
});

test("mobile portrait layout has zero horizontal overflow and responsive touch controls", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = watch(page);
  await page.goto(url);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.tap("#startBtn");
  await page.tap("#sceneNextBtn");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator(".dpad")).toBeVisible();
  expect(errors).toEqual([]);
  await ctx.close();
});
