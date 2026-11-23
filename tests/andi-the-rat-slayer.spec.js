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
    await expect(page.locator("#instruction")).toHaveText(
      /^Press E to (release cart|strike|activate panel [123])$/,
    );
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
  await tick(70);
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
  await tick(70);
  await tick(360);
  await expect(page.locator("#sceneName")).toHaveText("HOSTILE TAKEOVER");
  await expect(page.locator("#missionBrief")).toContainText(
    "Cut power to his suit",
  );
  await page.click("#next");
  await go(-4.2, 2);
  await actAt(4, 3);
  await tick(360);
  await expect(page.locator("#missionBrief")).toContainText(
    "Land the final strike",
  );
  await page.click("#next");
  await tick(240);
  const pad = await page.evaluate(() => s.targets[0]);
  await actAt(pad.x, pad.z);
  await tick(105);
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
  await expect(page.locator("#missionBrief")).toContainText("Tap Enter car");
  await expect(page.locator("#missionBrief")).not.toContainText("WASD");
  await page.tap("#next");
  await expect(page.locator("#instruction")).toHaveText("Tap Enter car");
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

test("briefings wait for acknowledgement and help restores the exact encounter", async ({
  page,
}) => {
  const log = errors(page);
  await mapClock(page);
  await page.goto(url);
  await page.click("#start");
  for (const [stage, goal] of [
    "Intercept the rat",
    "Defeat the Dumpster King",
    "two exposed weak points",
    "Override three panels",
    "break his barricade",
  ].entries()) {
    await page.evaluate((i) => resetStage(i), stage);
    await page.evaluate(() => advanceFrames(450));
    await expect(page.locator("#missionBrief")).toContainText(goal);
    for (const key of ["Goal", "How", "Watch out", "Controls"])
      await expect(
        page.locator("#missionBrief dt").getByText(key, { exact: true }),
      ).toBeVisible();
    if (stage === 4)
      await expect(page.locator("#missionBrief")).not.toContainText("panel 2");
    await page.getByRole("button", { name: "BEGIN FIGHT" }).click();
    await page.evaluate(() => advanceFrames(8));
    const before = await page.evaluate(() => [
      s.time,
      s.hp,
      s.stage,
      s.step,
      s.attackTimer,
    ]);
    await page.click("#help");
    await expect(page.locator("dialog")).toContainText(goal);
    await page.evaluate(() => advanceFrames(600));
    expect(
      await page.evaluate(() => [s.time, s.hp, s.stage, s.step, s.attackTimer]),
    ).toEqual(before);
    await page.click("#close");
    await page.click("#pause");
    await page.evaluate(() => advanceFrames(180));
    await expect(page.locator("#next")).toHaveText("Resume");
    await page.click("#help");
    await page.click("#close");
    await expect(page.locator("#next")).toHaveText("Resume");
    await page.click("#next");
  }
  expect(log).toEqual([]);
});
test("release controls, recovery hints, receipt and impact follow the encounter", async ({
  page,
}) => {
  const log = errors(page);
  await mapClock(page);
  await page.goto(url);
  await page.click("#start");
  await page.evaluate(() => resetStage(1));
  await page.click("#next");
  // Keep the stationary fixture alive long enough to test both hint thresholds.
  await page.evaluate(() => {
    s.inv = 65;
    advanceFrames(2);
  });
  await expect(page.locator("#progress")).toHaveText(
    "Cart releases activated: 0 / 2",
  );
  await expect(page.locator("#pins .pin:visible")).toHaveCount(2);
  await page.keyboard.press("e");
  await page.evaluate(() => advanceFrames(1));
  await expect(page.locator("#instruction")).toContainText("Follow Release 1");
  await page.evaluate(() => advanceFrames(930));
  await page.evaluate(() => {
    for (let i = 0; i < 125 && s.attack; i++) advanceFrames(1);
  });
  await expect(page.locator("#instruction")).toContainText("glowing controls");
  await page.evaluate(() => advanceFrames(950));
  await expect(page.locator("#guideLayer")).toHaveClass(/beacon/);
  expect(await page.evaluate(() => s.mode)).toBe("play");
  await page.keyboard.down("a");
  await page.evaluate(() => {
    s.andi.x = -4.2;
    s.andi.z = 4;
    advanceFrames(1);
  });
  await page.keyboard.up("a");
  await expect(page.locator("#instruction")).toHaveText(
    "Press E to release cart",
  );
  await expect(page.locator("#guideLayer")).not.toHaveClass(/beacon/);
  await page.keyboard.press("e");
  await page.evaluate(() => advanceFrames(1));
  await expect(page.locator("#receipt")).toHaveText("CART RELEASED — 1 OF 2");
  await expect(page.locator("#progress")).toContainText("1 / 2");
  await expect(page.locator(".complete")).toContainText("Release 1");
  await expect(page.locator(".primaryPin")).toContainText("Release 2");
  await page.evaluate(() => advanceFrames(40));
  await expect(page.locator("#impact")).toBeVisible();
  expect(await page.locator("#bhealth").evaluate((e) => e.value)).toBe(1);
  await page.evaluate(() => {
    s.andi.x = 4.2;
    s.andi.z = -6;
    advanceFrames(1);
  });
  await page.keyboard.press("e");
  await page.evaluate(() => advanceFrames(2));
  await expect(page.locator("#progress")).toContainText("2 / 2");
  await expect(page.locator(".primaryPin:visible")).toHaveCount(0);
  await page.evaluate(() => advanceFrames(68));
  await expect(page.locator("#sceneTag")).toHaveText("ENCOUNTER CLEARED");
  expect(log).toEqual([]);
});
test("guidance follows panel resets, dodge warnings and temporary weak points", async ({
  page,
}) => {
  await mapClock(page);
  await page.goto(url);
  await page.click("#start");
  await page.evaluate(() => resetStage(3));
  await page.click("#next");
  await page.evaluate(() => advanceFrames(1));
  await expect(page.locator("#instruction")).toContainText("2 → 1 → 3");
  async function panel(i) {
    await page.evaluate((i) => {
      Object.assign(s.andi, s.targets[i]);
      advanceFrames(15);
    }, i);
    await page.keyboard.press("e");
    await page.evaluate(() => advanceFrames(1));
  }
  await panel(1);
  await expect(page.locator("#progress")).toContainText("1 / 3");
  await panel(2);
  await expect(page.locator("#progress")).toContainText("0 / 3");
  await expect(page.locator(".primaryPin")).toContainText("Panel 2");
  await expect(page.locator("#pins .complete")).toHaveCount(0);
  await page.evaluate(() => resetStage(2));
  await page.click("#next");
  await page.evaluate(() => {
    s.andi.x = -4.4;
    s.andi.z = 4;
    advanceFrames(240);
  });
  await expect(page.locator("#instruction")).toContainText("Press Space");
  await page.keyboard.press("Space");
  await page.evaluate(() => advanceFrames(40));
  await expect(page.locator(".primaryPin")).toContainText("Weak point");
  await expect(page.locator("#instruction")).toHaveText("Press E to strike");
  await page.evaluate(() => advanceFrames(350));
  await expect(page.locator(".primaryPin")).toContainText("Dumpster");
  await expect(page.locator("#instruction")).not.toContainText("strike");
});
test("portrait WebGL projects the active release to the edge and uses touch labels", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 360, height: 740 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const log = errors(page);
  await page.goto(url);
  await page.tap("#start");
  await page.evaluate(() => resetStage(1));
  await page.tap("#next");
  await page.evaluate(() => {
    s.andi.x = 4.2;
    s.andi.z = -6;
  });
  await expect(page.locator("#instruction")).toHaveText("Tap Release");
  await page.tap("#touchAction");
  await page.evaluate(() => {
    s.andi.x = 7.4;
    s.andi.z = -11;
    s.zoom = 0.8;
  });
  await expect(page.locator(".primaryPin.edge")).toContainText("Release 1");
  await expect(page.locator(".primaryPin.edge")).toBeInViewport();
  expect(
    await page.evaluate(
      () => !!document.querySelector("#view canvas").getContext("webgl2"),
    ),
  ).toBe(true);
  await page.tap("#help");
  await expect(page.locator("dialog")).toContainText("direction pad");
  await page.tap("#close");
  expect(log).toEqual([]);
  await context.close();
});
