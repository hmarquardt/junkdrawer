const { test, expect } = require("@playwright/test");
const path = require("node:path");
const url = "file://" + path.resolve("andi-the-rat-slayer.html");
test.use({
  channel: "chrome",
  launchOptions: { args: ["--enable-unsafe-swiftshader"] },
});
function errors(page) {
  const log = [];
  page.on("pageerror", (e) => log.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") log.push(m.text());
  });
  return log;
}
test("production artwork, WebGL alley, steering and camera", async ({
  page,
}) => {
  const log = errors(page);
  await page.goto(url);
  await page.click("#how");
  await expect(page.locator("dialog")).toContainText("WASD");
  await page.click("#close");
  await page.click("#start");
  await page.click("#next");
  await expect.poll(() => page.evaluate(() => s.mode)).toBe("play");
  expect(
    await page.evaluate(
      () => !!document.querySelector("#view canvas").getContext("webgl2"),
    ),
  ).toBe(true);
  await page.keyboard.press("=");
  expect(await page.evaluate(() => s.zoom)).toBeCloseTo(0.9);
  await page.keyboard.press("e");
  expect(await page.evaluate(() => s.driving)).toBe(true);
  await page.keyboard.down("ArrowRight");
  await expect.poll(() => page.evaluate(() => s.andi.x)).toBeGreaterThan(-1.9);
  await page.keyboard.up("ArrowRight");
  await page.click("#pause");
  await expect(page.locator("#sceneName")).toHaveText("HOLD THE BELL");
  await page.click("#next");
  expect(log).toEqual([]);
});

// Advance animation frames deterministically, leaving all game input, collision,
// hit detection, checkpoint and progression logic on their production paths.
async function mapClock(page) {
  await page.addInitScript(() => {
    const context = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return kind === "webgl2" ? null : context.call(this, kind, ...args);
    };
    let callback,
      time = performance.now();
    window.requestAnimationFrame = (fn) => {
      callback = fn;
      return 1;
    };
    window.cancelAnimationFrame = () => {
      callback = null;
    };
    window.advanceFrames = (count) => {
      for (let i = 0; i < count; i++) {
        time += 1000 / 60;
        callback?.(time);
      }
    };
  });
}
test("all five bosses, retry and ending via keyboard gameplay", async ({
  page,
}) => {
  test.setTimeout(90000);
  const log = errors(page);
  await mapClock(page);
  await page.goto(url);
  await page.click("#start");
  await page.click("#next");
  const tick = (n) => page.evaluate((n) => advanceFrames(n), n);
  const move = async (key, n) => {
    await page.keyboard.down(key);
    await tick(n);
    await page.keyboard.up(key);
  };
  // Walking up hits the parked car, and continuous movement cannot pass through.
  await move("w", 90);
  const blocked = await page.evaluate(() => s.andi.z);
  expect(blocked).toBeGreaterThan(7.4);
  expect(blocked).toBeLessThan(8);
  await page.keyboard.press("e");
  await move("a", 21);
  for (let i = 0; i < 14 && (await page.evaluate(() => s.mode === "play")); i++)
    await move(i % 2 ? "s" : "w", 9);
  // Follow the visible rat until the moving car makes contact.
  for (
    let i = 0;
    i < 160 && (await page.evaluate(() => s.mode === "play"));
    i++
  ) {
    const key = await page.evaluate(() => {
      const dx = s.rat.x - s.andi.x,
        dz = s.rat.z - s.andi.z;
      return Math.abs(dx) > Math.abs(dz)
        ? dx > 0
          ? "d"
          : "a"
        : dz > 0
          ? "s"
          : "w";
    });
    await move(key, 4);
  }
  await expect(page.locator("#sceneTag")).toHaveText("ENCOUNTER CLEARED");
  async function next() {
    await page.click("#next");
    await page.click("#next");
  }
  async function go(x, z) {
    for (let i = 0; i < 65; i++) {
      const [px, pz] = await page.evaluate(() => [s.andi.x, s.andi.z]);
      const dx = x - px,
        dz = z - pz;
      if (Math.abs(dx) < 0.22 && Math.abs(dz) < 0.22) return;
      const horizontal = Math.abs(dx) > 0.21;
      await move(
        horizontal ? (dx > 0 ? "d" : "a") : dz > 0 ? "s" : "w",
        Math.min(
          8,
          Math.max(1, Math.round((Math.abs(horizontal ? dx : dz) / 5.8) * 60)),
        ),
      );
    }
    throw Error(
      "Cannot reach " +
        x +
        ", " +
        z +
        " from " +
        (await page.evaluate(() => JSON.stringify(s.andi))),
    );
  }
  async function actAt(x, z) {
    await go(x, z);
    await page.keyboard.press("e");
    await tick(15);
  }
  await next();
  await tick(4500);
  await expect(page.locator("#sceneTag")).toHaveText("CHECKPOINT");
  await next();
  await actAt(-4.2, 4);
  await go(-4.2, 2);
  await actAt(4.2, -6);
  await next();
  await go(-4.4, 4);
  for (let hit = 0; hit < 2; hit++) {
    for (
      let n = 0;
      n < 600 && !(await page.evaluate(() => s.stun > 0));
      n += 8
    ) {
      if (
        await page.evaluate(() => s.attack?.delay < 0.45 && s.attack.delay > 0)
      )
        await page.keyboard.press("Space");
      await tick(8);
    }
    const pad = await page.evaluate(() => s.targets[0]);
    expect(pad).toBeTruthy();
    await actAt(pad.x, pad.z);
    if (hit === 0) await go(-4.4, 4);
  }
  await next();
  await go(0, 8);
  await actAt(0, -6);
  await actAt(-4, 3);
  await actAt(4, 4);
  await next();
  await actAt(-4.2, 4);
  await expect(page.locator("#sceneName")).toHaveText("HOSTILE TAKEOVER");
  await page.click("#next");
  await go(-4.2, 2);
  await actAt(4, 3);
  await page.click("#next");
  await tick(240);
  const pad = await page.evaluate(() => s.targets[0]);
  await actAt(pad.x, pad.z);
  await expect(page.locator("#sceneTag")).toHaveText("CAMPAIGN COMPLETE");
  await page.click("#next");
  await expect(page.locator("#start")).toBeVisible();
  expect(log).toEqual([]);
});
test("portrait touch controls and fallback drawing", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const log = errors(page);
  await page.goto(url);
  await page.evaluate(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (k, ...a) {
      return k === "webgl2" ? null : orig.call(this, k, ...a);
    };
  });
  await page.tap("#start");
  await page.tap("#next");
  await page.tap("#touchAction");
  expect(await page.evaluate(() => s.driving)).toBe(true);
  const pad = page.locator("[data-key=arrowright]");
  const box = await pad.boundingBox();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + 12, y: box.y + 12 }],
  });
  await expect.poll(() => page.evaluate(() => s.andi.x)).toBeGreaterThan(-1);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.tap("#touchDodge");
  expect(await page.evaluate(() => s.dodgeWait)).toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(log).toEqual([]);
  await context.close();
});
