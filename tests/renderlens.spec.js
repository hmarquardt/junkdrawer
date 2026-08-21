const { test, expect } = require("@playwright/test");
const path = require("path");

const fileUrl = `file://${path.resolve(process.cwd(), "RenderLens.html")}`;

test.use({ channel: "chrome" });

test("sample data renders without leaking source or executing embedded scripts", async ({ page }) => {
  const errors = [];
  const dialogs = [];

  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("dialog", async dialog => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });

  await page.goto(fileUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Load Sample" }).click();

  await expect(page.locator("#sourceInput")).toHaveValue(/typical AI response/);
  await expect(page.locator("#renderedContent .rendered-doc")).toBeVisible();
  await expect(page.locator("#renderedContent")).toContainText("Market Overview");
  await expect(page.locator("#renderedContent")).toContainText("Bob Smith");
  await expect(page.locator("#renderedContent .parse-error-warning")).toHaveCount(0);
  await expect(page.locator("#formatBadges")).toContainText("Code");
  await expect(page.locator("#formatBadges")).toContainText("JSON");

  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toContain("All application JavaScript");
  expect(bodyText).not.toContain("var SAMPLE_TEXT");
  expect(dialogs).toEqual([]);
  expect(errors).toEqual([]);
});
