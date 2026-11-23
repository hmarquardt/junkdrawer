const { test, expect, webkit, devices } = require("@playwright/test");
const path = require("node:path");
const url = "file://" + path.resolve("andi-the-rat-slayer.html");
test.use({
  channel: "chrome",
  launchOptions: { args: ["--enable-unsafe-swiftshader"] },
});
function watch(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}
async function frameClock(page, fallback = true) {
  await page.addInitScript((fallback) => {
    if (fallback) {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (k, ...a) {
        return k === "webgl2" ? null : get.call(this, k, ...a);
      };
    }
    let cb,
      time = performance.now();
    window.requestAnimationFrame = (fn) => ((cb = fn), 1);
    window.cancelAnimationFrame = () => (cb = null);
    window.framesForTest = (n) => {
      for (let i = 0; i < n; i++) {
        time += 1000 / 60;
        cb?.(time);
      }
    };
  }, fallback);
}
const tick = (page, n) => page.evaluate((n) => framesForTest(n), n);
test("fork reach, windup, recovery, charge, knockback, cover, circuits and checkpoint", async ({
  page,
}) => {
  const errors = watch(page);
  await frameClock(page);
  await page.goto(url);
  await page.click("#start");
  async function stage(n) {
    await page.evaluate((n) => resetStage(n), n);
    await page.click("#next");
    await tick(page, 2);
  }
  async function thrust(hold = 1) {
    await page.keyboard.down("j");
    await tick(page, hold);
    await page.keyboard.up("j");
    await tick(page, 18);
  }
  await stage(1);
  await page.evaluate(() => {
    s.andi = point(0, 4);
    s.rat = point(0, -5);
    s.mobs = [point(0, 0.95)];
    s.mobs[0].panic = 0.5;
    s.mobs[0].flee = Math.PI / 2;
  });
  await page.keyboard.press("f");
  await tick(page, 7);
  expect(await page.evaluate(() => s.fork.extension)).toBeGreaterThan(0);
  expect(await page.evaluate(() => s.fork.extension)).toBeLessThan(1);
  await tick(page, 18);
  await page.keyboard.press("f");
  await tick(page, 21);
  expect(await page.evaluate(() => s.fork.extension)).toBe(0);
  await page.evaluate(() => {
    s.mobs = [];
    s.targets = [target(0, 0.7), target(5, -6)];
  });
  await thrust();
  expect(await page.evaluate(() => s.targets[0].used)).toBe(false);
  await tick(page, 28);
  await page.keyboard.press("f");
  await tick(page, 24);
  await page.keyboard.down("j");
  await page.keyboard.up("j");
  await tick(page, 4);
  expect(await page.evaluate(() => s.targets[0].used)).toBe(false);
  await tick(page, 14);
  expect(await page.evaluate(() => s.targets[0].used)).toBe(true);
  await page.keyboard.press("j");
  expect(await page.evaluate(() => s.fork.swings)).toBe(2);
  await stage(1);
  await page.keyboard.press("f");
  await tick(page, 22);
  await page.evaluate(() => {
    s.andi = point(0, 4);
    s.mobs = [point(0, 2)];
    s.targets = [];
  });
  await thrust();
  expect(await page.evaluate(() => s.mobs[0].tumble)).toBeGreaterThan(0);
  await stage(1);
  await page.evaluate(() => {
    s.andi = point(-2, 8);
    s.targets = [target(-2, 4)];
    s.fork.extended = true;
    s.fork.extension = 1;
  });
  await thrust(35);
  expect(await page.evaluate(() => s.targets[0].used)).toBe(false);
  await stage(2);
  await page.evaluate(() => {
    s.andi = point(0, 4);
    s.stun = 5;
    s.targets = [target(0, -0.6)];
  });
  await thrust(35);
  expect(await page.evaluate(() => s.step)).toBe(1);
  await stage(3);
  await page.evaluate(() => {
    s.andi = point(0, 4);
    s.attack = { x: 0, z: 3, radius: 2, delay: 0.8 };
    s.rat = point(0, 1);
  });
  await thrust();
  expect(await page.evaluate(() => s.attack)).toBe(null);
  await tick(page, 28);
  await page.evaluate(() => {
    s.attack = null;
    s.attackTimer = 5;
    s.rat = point(0, 2);
    s.targets = [];
  });
  await thrust(36);
  expect(await page.evaluate(() => s.fork.stagger)).toBeGreaterThan(0);
  await page.evaluate(() => {
    s.hp = 1;
    s.inv = 0;
    hurt();
  });
  await page.click("#next");
  await page.click("#next");
  await tick(page, 1);
  expect(await page.evaluate(() => s.fork.extended && s.stage === 3)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
async function finger(page, cdp, type, points) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
}
async function center(page, selector) {
  const r = await page.locator(selector).boundingBox();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}
test("two thumbs move, charge, release and dodge independently; background pauses", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage(),
    errors = watch(page);
  await frameClock(page);
  await page.goto(url);
  await page.tap("#start");
  await page.evaluate(() => resetStage(1));
  await page.tap("#next");
  await tick(page, 1);
  const cdp = await ctx.newCDPSession(page),
    stick = { ...(await center(page, "[data-key=arrowright]")), id: 1 },
    attack = { ...(await center(page, "#touchAttack")), id: 2 },
    dodge = { ...(await center(page, "#touchDodge")), id: 3 };
  await finger(page, cdp, "touchStart", [stick]);
  await finger(page, cdp, "touchStart", [stick, attack]);
  await tick(page, 34);
  expect(await page.evaluate(() => s.andi.x)).toBeGreaterThan(-1);
  await expect(page.locator("#touchAttack")).toHaveClass(/charged/);
  await expect(page.locator("#forkReadout")).toContainText("Release");
  await finger(page, cdp, "touchEnd", [attack]);
  await tick(page, 15);
  expect(await page.evaluate(() => s.fork.swings)).toBe(1);
  await finger(page, cdp, "touchStart", [stick, dodge]);
  await tick(page, 5);
  expect(await page.evaluate(() => s.dash > 0 && s.andi.speed > 6)).toBe(true);
  await finger(page, cdp, "touchEnd", []);
  await tick(page, 1);
  expect(await page.evaluate(() => s.andi.speed)).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await tick(page, 60);
  await expect(page.locator("#next")).toHaveText("Resume");
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.tap("#next");
  await tick(page, 1);
  expect(await page.evaluate(() => s.mode)).toBe("play");
  expect(errors).toEqual([]);
  await ctx.close();
});
test("mobile WebKit briefings, rotations, 44px controls and WebGL touch attack", async () => {
  const b = await webkit.launch({ channel: "", args: [] });
  try {
    const p = await b.newPage({ ...devices["iPhone 13"] }),
      errors = watch(p);
    await p.goto(url);
    await p.tap("#start");
    for (const [w, h] of [
      [320, 568],
      [430, 932],
      [740, 320],
      [375, 812],
    ]) {
      await p.setViewportSize({ width: w, height: h });
      await p.evaluate(() => resetStage(1));
      await expect(p.locator("#missionBrief")).toContainText("Tap Attack");
      await expect(p.locator("#missionBrief")).not.toContainText("Press E");
      await p.tap("#next");
      for (const id of [
        "#touchAttack",
        "#touchDodge",
        "#forkToggle",
        "#pause",
        "#help",
        "[data-key=arrowright]",
      ]) {
        const r = await p.locator(id).boundingBox();
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(w + 1);
        expect(r.width).toBeGreaterThanOrEqual(44);
        expect(r.height).toBeGreaterThanOrEqual(44);
        expect(r.y + r.height).toBeLessThanOrEqual(h + 1);
      }
      await p.tap("#touchAttack");
      await expect.poll(() => p.evaluate(() => s.fork.swings)).toBe(1);
      await p.setViewportSize({ width: h, height: w });
      await expect
        .poll(() =>
          p.evaluate(
            () => s.stage === 1 && s.fork.swings === 1 && s.mode === "play",
          ),
        )
        .toBe(true);
      await p.setViewportSize({ width: w, height: h });
      await p.tap("#help");
      await expect(p.locator("dialog")).toContainText("Tap Attack");
      await p.tap("#close");
      expect(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally {
    await b.close();
  }
});

// Route decisions below read only visible text. Each movement and attack is a
// browser touch event. The clock advances the normal simulation and renderer.
for (const fallback of [true, false])
  test(
    "touch-only campaign guided by the HUD in " +
      (fallback ? "Canvas" : "WebGL"),
    async ({ browser }) => {
      test.setTimeout(180000);
      const ctx = await browser.newContext({
        ...devices["Pixel 7"],
        viewport: { width: 360, height: 740 },
      });
      try {
        const page = await ctx.newPage(),
          errors = watch(page);
        await frameClock(page, fallback);
        await page.goto(url);
        const cdp = await ctx.newCDPSession(page);
        await cdp.send("Emulation.setSafeAreaInsetsOverride", {
          insets: { top: 18, bottom: 12, left: 4, right: 4 },
        });
        await page.tap("#start");
        const lessons = new Set(),
          receipts = new Set();
        const arrows = {
          "↑": [0, -1],
          "↗": [1, -1],
          "→": [1, 0],
          "↘": [1, 1],
          "↓": [0, 1],
          "↙": [-1, 1],
          "←": [-1, 0],
          "↖": [-1, -1],
        };
        let same = 0,
          last = "",
          completed = false;
        for (let i = 0; i < 420; i++) {
          await tick(page, 1);
          if (await page.locator("#finish").isVisible()) {
            await tick(page, 100);
            continue;
          }
          if (await page.locator("#sceneCard").isVisible()) {
            const name = await page.locator("#sceneName").innerText(),
              tag = await page.locator("#sceneTag").innerText();
            if (tag === "CAMPAIGN COMPLETE") {
              completed = true;
              break;
            }
            expect(tag, "A fresh player lost the encounter: " + name).not.toBe(
              "CHECKPOINT",
            );
            if (await page.locator("#missionBrief").isVisible()) {
              lessons.add(name.toLowerCase());
              const copy = await page.locator("#missionBrief").innerText();
              expect(copy).toContain("direction pad");
              expect(copy).not.toMatch(/Press E|WASD|left click/);
            }
            await page.tap("#next");
            continue;
          }
          const objective = await page.locator("#objective").innerText(),
            prompt = (
              await page.locator("#instruction").innerText()
            ).toLowerCase();
          const receipt = await page.locator("#receipt").innerText();
          if (receipt) receipts.add(receipt);
          if (prompt === "tap enter car") {
            await page.tap("#touchAction");
            continue;
          }
          if (
            prompt.startsWith("tap attack") ||
            ["tap strike", "tap release", "tap activate"].includes(prompt)
          ) {
            await page.tap("#touchAttack");
            await tick(page, 30);
            continue;
          }
          if (prompt.includes("tap dodge")) await page.tap("#touchDodge");
          if (
            /Stay beside|Bait his lunge|Watch the dumpster/i.test(objective)
          ) {
            await tick(page, 9);
            continue;
          }
          const arrow = objective.match(/[↑↗→↘↓↙←↖]/)?.[0];
          expect(arrow, "Missing navigation for " + objective).toBeTruthy();
          same = objective === last ? same + 1 : 0;
          last = objective;
          let [dx, dz] = arrows[arrow];
          if (same >= 4) {
            [dx, dz] = dx === 0 ? [1, 0] : [0, -1];
            same = 0;
          }
          const pad = await page.locator(".pad").boundingBox();
          await finger(page, cdp, "touchStart", [
            {
              id: 1,
              x: pad.x + pad.width * (0.5 + 0.34 * dx),
              y: pad.y + pad.height * (0.5 + 0.34 * dz),
            },
          ]);
          await tick(page, 10);
          await finger(page, cdp, "touchEnd", []);
        }
        expect(completed, await page.locator(".brief").textContent()).toBe(
          true,
        );
        expect(lessons.size).toBe(7);
        expect(receipts.has("CART RELEASED — 1 OF 2")).toBe(true);
        await expect(page.locator("#award")).toBeVisible();
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    },
  );

test("a left click aims the fork, then WebGL loss preserves the fight in Canvas", async ({
  page,
}) => {
  const errors = watch(page);
  await page.goto(url);
  await page.click("#start");
  await page.evaluate(() => resetStage(1));
  await page.click("#next");
  await page.keyboard.press("f");
  await page.evaluate(() => {
    s.andi = point(0, 1);
    s.mobs = [];
    s.targets = [target(3.5, 1), target(5, -6)];
  });
  await expect.poll(() => page.evaluate(() => s.fork.extension)).toBe(1);
  const target = await page.evaluate(() => {
    const pos = view.project(3.5, 1, 0),
      r = $("view").getBoundingClientRect();
    return { x: pos.x + r.x, y: pos.y + r.y };
  });
  await page.mouse.click(target.x, target.y);
  await expect.poll(() => page.evaluate(() => s.step)).toBe(1);
  await page.click("#pause");
  await page.evaluate(() =>
    document
      .querySelector("#view canvas")
      .getContext("webgl2")
      .getExtension("WEBGL_lose_context")
      .loseContext(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => !!document.querySelector("#view canvas").getContext("2d"),
      ),
    )
    .toBe(true);
  await page.click("#next");
  await expect(page.locator("#progress")).toContainText("1 / 2");
  expect(await page.evaluate(() => s.fork.extended)).toBe(true);
  expect(errors).toEqual([]);
});

test("the campaign button accepts taps when the game input handlers are ready", async ({
  page,
}) => {
  let unblock;
  const pending = new Promise((resolve) => {
    unblock = resolve;
  });
  await page.route("http://andi.test/**", async (route) => {
    const asset = new URL(route.request().url()).pathname.slice(1);
    if (asset === "andi-the-rat-slayer/game.js") await pending;
    if (asset === "favicon.ico") return route.fulfill({ status: 204 });
    await route.fulfill({ path: path.resolve(asset) });
  });
  const loaded = page.goto("http://andi.test/andi-the-rat-slayer.html");
  try {
    await expect(
      page.getByRole("button", { name: /Play campaign/ }),
    ).toBeDisabled();
  } finally {
    unblock();
  }
  await loaded;
  await page.click("#start");
  await expect(page.getByRole("button", { name: "BEGIN FIGHT" })).toBeVisible();
});
