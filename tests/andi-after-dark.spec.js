const { test, expect } = require("@playwright/test");
const path = require("node:path");
const url = "file://" + path.resolve("andi-the-rat-slayer.html");
test.use({
  channel: "chrome",
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
const saved = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("andi.campaign")));
async function title(page) {
  await page.tap("#settings");
  await page.tap("#back");
}
async function legacy(page) {
  await page.tap("#legacy");
  await page.tap("#confirmLegacy");
}
test("a fresh browser opts into legacy access, reloads, replays, and resets only on confirmation", async ({
  page,
}) => {
  await page.goto(url);
  await expect(page.locator("#continue")).toBeHidden();
  await page.tap("#selectLevel");
  await expect(page.locator("#content button:enabled")).toHaveCount(1);
  await page.tap("#close");
  await legacy(page);
  expect(await saved(page)).toMatchObject({
    unlocked: 6,
    checkpoint: 6,
    lastCompleted: 0,
    chapter: 2,
    best: {},
  });
  await page.reload();
  await page.tap("#continue");
  await expect(page.locator("#sceneName")).toHaveText("The Stinkfather");
  await title(page);
  await page.tap("#selectLevel");
  await page.locator("#content button").first().tap();
  await page.tap("#next");
  await page.evaluate(() => {
    s.driving = true;
    Object.assign(s.car, s.rat);
    Object.assign(s.andi, s.rat);
    keys.add("d");
  });
  await expect(page.locator("#sceneTag")).toHaveText("ENCOUNTER CLEARED");
  expect(await saved(page)).toMatchObject({
    unlocked: 6,
    checkpoint: 6,
    lastCompleted: 1,
  });
  await title(page);
  await page.tap("#settings");
  await page.selectOption("#quality", "low");
  await page.selectOption("#difficulty", "rush");
  await page.tap("#close");
  await page.tap("#sound");
  await page.reload();
  await page.tap("#settings");
  await expect(page.locator("#difficulty")).toHaveValue("rush");
  await expect(page.locator("#quality")).toHaveValue("low");
  await page.tap("#close");
  await expect(page.locator("#sound")).toContainText("OFF");
  await page.tap("#resetProgress");
  await page.tap("#close");
  expect((await saved(page)).unlocked).toBe(6);
  await page.tap("#resetProgress");
  await page.tap("#confirmReset");
  await page.reload();
  await expect(page.locator("#continue")).toBeHidden();
  expect(await saved(page)).toMatchObject({
    unlocked: 1,
    best: {},
    achievements: [],
    upgrades: [],
  });
});
test("schema upgrade is idempotent, corrupt records recover and newer saves survive", async ({
  page,
}) => {
  await page.goto(url);
  async function seed(text) {
    await page.evaluate((t) => localStorage.setItem("andi.campaign", t), text);
    await page.reload();
  }
  await seed(
    JSON.stringify({
      version: 1,
      furthestLevel: 4,
      lastCompleted: 3,
      difficulty: "normal",
      best: { 3: 18 },
    }),
  );
  expect(await saved(page)).toMatchObject({
    version: 2,
    checkpoint: 4,
    settings: { difficulty: "normal" },
    best: { 3: 18 },
  });
  await page.reload();
  await page.tap("#continue");
  await expect(page.locator("#sceneName")).toHaveText("Professor Ratington");
  await seed("{broken");
  await expect(page.locator("#continue")).toBeHidden();
  await page.tap("#start");
  expect((await saved(page)).unlocked).toBe(1);
  await seed('{"version":99,"future":"keep"}');
  await page.tap("#start");
  expect(await saved(page)).toEqual({ version: 99, future: "keep" });
});
test("blocked browser storage keeps the campaign playable and reports a session-only save", async ({
  page,
}) => {
  await page.addInitScript(() => {
    for (const k of ["getItem", "setItem"])
      Storage.prototype[k] = () => {
        throw new DOMException("Blocked", "SecurityError");
      };
  });
  await page.goto(url);
  await legacy(page);
  await page.tap("#continue");
  await expect(page.locator("#sceneName")).toHaveText("The Stinkfather");
  await expect(page.locator("#saveAlert")).toContainText("this session");
});
test("windmill clears nearby clouds; council perks are optional and neutral cats cannot take fork hits", async ({
  page,
}) => {
  await page.goto(url);
  await legacy(page);
  await page.tap("#continue");
  await page.tap("#next");
  await page.evaluate(() => {
    s.andi.x = s.treatAt.x;
    s.andi.z = s.treatAt.z;
  });
  await expect.poll(async () => (await saved(page)).treats).toBe(1);
  for (const [i, effect] of ["protection", "patience", "reach"].entries()) {
    await page.evaluate((i) => {
      s.hp = 2;
      s.attackTimer = 30;
      Object.assign(s.andi, { x: catCouncil[i].x, z: catCouncil[i].z });
      Math.random = () => 0.9;
    }, i);
    await expect.poll(() => page.evaluate(() => s.actionWait)).toBe(0);
    await expect(page.locator("#touchAction")).toHaveText("Greet cat");
    await page.tap("#touchAction");
    await expect(page.locator("#receipt")).toContainText(effect);
    expect(
      await page.evaluate(() => catCouncil.includes(assistedTarget())),
    ).toBe(false);
  }
  expect((await saved(page)).treats).toBe(0);
  await page.evaluate(() => {
    s.andi = point(0, 8);
    s.clouds = [
      { x: 0.5, z: 7, radius: 1, life: 4 },
      { x: 5, z: -5, radius: 1, life: 4 },
    ];
    s.inv = 30;
  });
  await page.keyboard.down("j");
  await expect(page.locator("#forkReadout")).toContainText("CHARGED");
  await page.keyboard.up("j");
  await expect.poll(() => page.evaluate(() => s.clouds.length)).toBe(1);
  await title(page);
  await page.reload();
  expect((await saved(page)).collected).toBe(1);
});

test("a second tab sees unlocks and an older run cannot replace the new checkpoint", async ({
  page,
  context,
}) => {
  await page.goto(url);
  const other = await context.newPage();
  await other.goto(url);
  await other.tap("#start");
  await legacy(page);
  await expect(other.locator("#saveStatus")).toContainText("Level 6");
  await other.tap("#next");
  await other.evaluate(() => {
    s.driving = true;
    Object.assign(s.car, s.rat);
    Object.assign(s.andi, s.rat);
    keys.add("d");
  });
  await expect(other.locator("#sceneTag")).toHaveText("ENCOUNTER CLEARED");
  expect(await saved(page)).toMatchObject({
    unlocked: 6,
    checkpoint: 6,
    lastCompleted: 1,
  });
});
test("the detector distinguishes a cardboard prop and a real exit; intimidation cannot defeat the possum", async ({
  page,
}) => {
  await page.goto(url);
  await page.tap("#start");
  await page.evaluate(() => resetStage(7));
  await page.tap("#next");
  await page.evaluate(() => Object.assign(s.andi, s.decoys[0]));
  await expect(page.locator("#touchAction")).toHaveText("Check prop");
  await page.tap("#touchAction");
  await expect(page.locator("#receipt")).toContainText("CARDBOARD");
  expect(await page.evaluate(() => s.boss)).toBe(3);
  await page.evaluate(() => Object.assign(s.andi, s.targets[0]));
  await expect(page.locator("#touchAction")).toHaveText("Inspect");
  await expect.poll(() => page.evaluate(() => s.actionWait)).toBe(0);
  await page.tap("#touchAction");
  await expect(page.locator("#progress")).toContainText("1 / 3");
  await expect(page.locator("#objective")).toContainText("Hollow crate");
});

test("mobile WebKit can read and reopen every night mission at small portrait and landscape sizes", async () => {
  const { webkit } = require("@playwright/test");
  const browser = await webkit.launch({ channel: "", args: [] });
  try {
    const page = await browser.newPage({
      viewport: { width: 320, height: 568 },
      isMobile: true,
      hasTouch: true,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.tap("#start");
    for (let stage = 5; stage <= 8; stage++) {
      await page.evaluate((i) => resetStage(i), stage);
      await expect(page.locator("#missionBrief")).toContainText(
        "direction pad",
      );
      await expect(page.locator("#missionBrief")).not.toContainText("Press E");
      await page.tap("#next");
      await page.tap("#help");
      await expect(page.locator("#content")).toContainText("Watch out");
      await page.setViewportSize({ width: 568, height: 320 });
      await page.tap("#close");
      await page.tap("#pause");
      await expect(page.locator("#sceneTag")).toHaveText("CAMPAIGN PAUSED");
      await page.tap("#next");
      await page.setViewportSize({ width: 320, height: 568 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
});
