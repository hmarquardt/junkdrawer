const { test, expect } = require("@playwright/test");
const path = require("path");

const fileUrl = `file://${path.resolve(process.cwd(), "ground-grid-growth.html")}`;
const navIds = [
  "overview", "farms-sell", "who-farms", "farm-economics", "subsidies",
  "data-centers", "claims", "compare", "money", "power", "environment",
  "transparency", "grade", "terms", "sources", "method", "admin"
];

test.use({ channel: "chrome" });

test("direct-file app initializes, calculates, navigates, and persists", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(`${fileUrl}#overview`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GGG_TEST__?.state.sources.length === 11);

  await expect(page.locator("h1")).toHaveText("Ground, Grid and Growth");
  await expect(page.locator("#claimList article")).toHaveCount(14);
  await expect(page.locator("#sourceList article")).toHaveCount(11);
  await page.screenshot({ path: "/tmp/ground-grid-growth-overview.png", fullPage: true });

  for (const id of navIds) {
    await page.evaluate(section => window.__GGG_TEST__.navigate(section), id);
    await expect(page.locator(`#${id}`)).toHaveClass(/active/);
  }

  await expect(page.locator("#relationshipDiagram .role")).toHaveCount(4);
  await expect(page.locator("#farmEconomicsResults .stat")).toHaveCount(10);
  await expect(page.locator("#subsidyTabs button")).toHaveCount(8);
  await expect(page.locator("#dcTypeTabs button")).toHaveCount(8);
  await expect(page.locator("#comparisonTable tbody tr")).toHaveCount(17);
  await expect(page.locator("#fiscalResults .stat")).toHaveCount(8);
  await expect(page.locator("#powerResults .stat")).toHaveCount(6);
  await expect(page.locator("#timeline .stage")).toHaveCount(11);
  await expect(page.locator("#gradeSummary")).toContainText("Insufficient information");
  await expect(page.locator("#termDocument li")).toHaveCount(27);
  await expect(page.locator("#methodCards .card")).toHaveCount(6);

  await page.evaluate(() => window.__GGG_TEST__.navigate("environment"));
  await page.getByRole("button", { name: "Noise" }).click();
  await expect(page.locator("#environmentTerms")).toContainText("property-line");
  await page.getByRole("button", { name: "Light & viewshed" }).click();
  await expect(page.locator("#environmentTerms")).toContainText("full-cutoff");

  await page.evaluate(() => window.__GGG_TEST__.navigate("money"));
  await page.locator("#fiscalInputs [data-key=completion]").fill("55");
  await expect(page.locator("#fiscalResults")).toContainText("50% buildout");

  await page.evaluate(() => window.__GGG_TEST__.navigate("farms-sell"));
  const totalAcres = page.locator("#farmSaleInputs [data-key=totalAcres]");
  await totalAcres.fill("500");
  await expect(page.locator("#farmSaleResults")).toContainText("$6,250,000");

  page.once("dialog", dialog => dialog.accept("Persistence check"));
  await page.getByRole("button", { name: "Save scenario" }).first().click();
  await page.waitForFunction(async () => (await window.__GGG_TEST__.idbAll("farmScenarios")).length > 0);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GGG_TEST__?.state.sources.length === 11);
  await expect(page.locator("#farmSaleInputs [data-key=totalAcres]")).toHaveValue("500");
  const savedCount = await page.evaluate(async () => (await window.__GGG_TEST__.idbAll("farmScenarios")).length);
  expect(savedCount).toBeGreaterThan(0);

  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toMatch(/\bNaN\b|\bInfinity\b/);
  expect(errors).toEqual([]);
});

test("mobile layout does not create page-level horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${fileUrl}#overview`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__GGG_TEST__));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.locator("body")).toHaveClass(/nav-open/);
  await page.screenshot({ path: "/tmp/ground-grid-growth-mobile.png", fullPage: true });
});

test("HTTP origin behaves like static GitHub Pages hosting", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:8789/ground-grid-growth.html#claims", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GGG_TEST__?.state.claims.length === 14);
  await expect(page.locator("#claims")).toHaveClass(/active/);
  await page.locator("#claimSearch").fill("water");
  await expect(page.locator("#claimList article")).toHaveCount(2);
  expect(errors).toEqual([]);
});
