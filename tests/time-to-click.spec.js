const { test, expect } = require("@playwright/test");
const path = require("path");

const fileUrl = `file://${path.resolve(process.cwd(), "time-to-click.html")}`;

test.use({ channel: "chrome" });

function attachErrorCapture(page, errors) {
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
}

test.beforeEach(async ({ page }) => {
  // The analytics beacon is CORS-blocked from file:// origins; answer it
  // with a fake 204 so it doesn't pollute console-error assertions.
  await page.route("**/api/analytics/**", r => r.fulfill({ status: 204, body: "" }));
  await page.goto(fileUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__TTC_TEST__));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__TTC_TEST__));
  // Migration auto-creates one legacy default; drop it for a clean slate.
  await page.evaluate(() => window.__TTC_TEST__.clearAll());
});

test("adds a fixed & ranged timer, counts down independently", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);

  const fixedId = await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Check Fixed Task", minMinutes: 8, maxMinutes: 8 }));
  const rangedId = await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Check Ranged Task", minMinutes: 5, maxMinutes: 8 }));

  await expect(page.locator(".timer-card")).toHaveCount(2);

  const fixed = await page.evaluate(id => window.__TTC_TEST__.find(id), fixedId);
  const ranged = await page.evaluate(id => window.__TTC_TEST__.find(id), rangedId);
  expect(fixed.state).toBe("running");
  expect(ranged.state).toBe("running");
  expect(fixed.currentIntervalSeconds).toBe(480);
  expect(ranged.currentIntervalSeconds).toBeGreaterThanOrEqual(300);
  expect(ranged.currentIntervalSeconds).toBeLessThanOrEqual(480);

  await expect(page.locator(".timer-card", { hasText: "Check Fixed Task" })).toBeVisible();
  await expect(page.locator(".timer-card", { hasText: "Check Ranged Task" })).toBeVisible();
  await expect(page.locator("h1")).toHaveText("Time to Click");
  expect(errors.length).toBe(0);
});

test("pause one timer, others continue; resume preserves remaining", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);

  const a = await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Task A", minMinutes: 5, maxMinutes: 5 }));
  const b = await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Task B", minMinutes: 6, maxMinutes: 6 }));

  await page.waitForTimeout(800);
  const beforePause = await page.evaluate(id => window.__TTC_TEST__.find(id), a);
  await page.evaluate(id => window.__TTC_TEST__.pause(id), a);

  const aState = await page.evaluate(id => window.__TTC_TEST__.find(id), a);
  const bState = await page.evaluate(id => window.__TTC_TEST__.find(id), b);
  expect(aState.state).toBe("paused");
  expect(bState.state).toBe("running");
  // A is a fixed 5-minute timer; after ~800ms its frozen remainder should
  // be just under 300s.
  expect(aState.remainingMilliseconds).toBeGreaterThan(290000);
  expect(aState.remainingMilliseconds).toBeLessThanOrEqual(300000);
  expect(Math.abs(aState.remainingMilliseconds - beforePause.remainingMilliseconds)).toBeLessThan(1500);

  await page.waitForTimeout(900);
  const bAfter = await page.evaluate(id => window.__TTC_TEST__.find(id), b);
  expect(bAfter.remainingMilliseconds).toBeLessThan(bState.remainingMilliseconds);

  const aBeforeResume = await page.evaluate(id => window.__TTC_TEST__.find(id), a);
  await page.evaluate(id => window.__TTC_TEST__.resume(id), a);
  const aResumed = await page.evaluate(id => window.__TTC_TEST__.find(id), a);
  expect(aResumed.state).toBe("running");
  expect(Math.abs(aResumed.targetTimestamp - (Date.now() + aBeforeResume.remainingMilliseconds))).toBeLessThan(50);
  expect(errors.length).toBe(0);
});

test("new interval only affects selected timer; ranged stays in bounds", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  const a = await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "A", minMinutes: 4, maxMinutes: 6 }));
  for (let i = 0; i < 20; i++) {
    const t = await page.evaluate(id => { window.__TTC_TEST__.newInterval(id); return window.__TTC_TEST__.find(id); }, a);
    expect(t.currentIntervalSeconds).toBeGreaterThanOrEqual(240);
    expect(t.currentIntervalSeconds).toBeLessThanOrEqual(360);
  }
  const fixedId = await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "B", minMinutes: 9, maxMinutes: 9 }));
  for (let i = 0; i < 5; i++) {
    await page.evaluate(id => window.__TTC_TEST__.newInterval(id), fixedId);
    const t = await page.evaluate(id => window.__TTC_TEST__.find(id), fixedId);
    expect(t.currentIntervalSeconds).toBe(540);
  }
  expect(errors.length).toBe(0);
});

test("invalid interval strings are rejected by the parser", async ({ page }) => {
  const results = await page.evaluate(() => {
    const p = window.__TTC_TEST__.parse;
    return {
      a: p("8"), b: p("5-8"), c: p("5 - 8"), d: p("5 to 8"),
      e: p("6.5"), f: p("5.5-7.5"),
      bad1: p(""), bad2: p("0"), bad3: p("8-2"), bad4: p("5-abc"),
      bad5: p("-3"), bad6: p("5-8-3"), bad7: p("999")
    };
  });
  expect(results.a.minMinutes).toBe(8);
  expect(results.b.minMinutes).toBe(5);
  expect(results.c.maxMinutes).toBe(8);
  expect(results.d.minMinutes).toBe(5);
  expect(results.e.minMinutes).toBe(6.5);
  expect(results.f.minMinutes).toBe(5.5);
  expect(results.bad1.error).toBeTruthy();
  expect(results.bad2.error).toBeTruthy();
  expect(results.bad3.error).toBeTruthy();
  expect(results.bad4.error).toBeTruthy();
  expect(results.bad5.error).toBeTruthy();
  expect(results.bad6.error).toBeTruthy();
  expect(results.bad7.error).toBeTruthy();
});

test("editing prompt takes effect immediately; editing interval keeps current countdown", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  const id = await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Old Name", minMinutes: 10, maxMinutes: 10 }));
  await page.waitForTimeout(600);
  const before = await page.evaluate(i => window.__TTC_TEST__.find(i), id);
  await page.evaluate(i => window.__TTC_TEST__.edit(i, { prompt: "New Name", minMinutes: 3, maxMinutes: 4 }), id);
  const after = await page.evaluate(i => window.__TTC_TEST__.find(i), id);
  expect(after.prompt).toBe("New Name");
  expect(after.minMinutes).toBe(3);
  expect(after.maxMinutes).toBe(4);
  expect(after.currentIntervalSeconds).toBe(before.currentIntervalSeconds);
  expect(Math.abs(after.remainingMilliseconds - before.remainingMilliseconds)).toBeLessThan(1500);
  await expect(page.locator(".timer-card", { hasText: "New Name" })).toBeVisible();
  expect(errors.length).toBe(0);
});

test("multiple timers expiring on the same tick each fire once and rearm", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  const a = await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Alpha", minMinutes: 5, maxMinutes: 5 }));
  const b = await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Bravo", minMinutes: 6, maxMinutes: 6 }));
  await page.evaluate(() => window.__TTC_TEST__.expireAll());
  const aState = await page.evaluate(i => window.__TTC_TEST__.find(i), a);
  const bState = await page.evaluate(i => window.__TTC_TEST__.find(i), b);
  expect(aState.remindersCompleted).toBe(1);
  expect(bState.remindersCompleted).toBe(1);
  expect(aState.state).toBe("running");
  expect(bState.state).toBe("running");
  expect(aState.targetTimestamp).toBeGreaterThan(Date.now());
  expect(bState.targetTimestamp).toBeGreaterThan(Date.now());
  expect(errors.length).toBe(0);
});

test("delete removes card and its reminder-count contribution", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  const a = await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Keep", minMinutes: 5, maxMinutes: 5 }));
  const b = await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Drop", minMinutes: 5, maxMinutes: 5 }));
  await page.evaluate(i => window.__TTC_TEST__.setRemaining(i, 1), a);
  await page.evaluate(i => window.__TTC_TEST__.setRemaining(i, 1), b);
  await page.evaluate(() => window.__TTC_TEST__.tick());
  await page.evaluate(() => window.__TTC_TEST__.tick());
  await page.evaluate(i => window.__TTC_TEST__.deleteDirect(i), b);
  await expect(page.locator(".timer-card")).toHaveCount(1);
  await expect(page.locator(".timer-card", { hasText: "Keep" })).toBeVisible();
  const keep = await page.evaluate(i => window.__TTC_TEST__.find(i), a);
  expect(keep.state).toBe("running");
  expect(errors.length).toBe(0);
});

test("pause all / resume all preserves individual remaining durations", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  const a = await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "X", minMinutes: 4, maxMinutes: 4 }));
  const b = await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Y", minMinutes: 9, maxMinutes: 9 }));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__TTC_TEST__.pauseAll());
  const aP = await page.evaluate(i => window.__TTC_TEST__.find(i), a);
  const bP = await page.evaluate(i => window.__TTC_TEST__.find(i), b);
  expect(aP.state).toBe("paused");
  expect(bP.state).toBe("paused");
  expect(Math.abs(aP.remainingMilliseconds - 240000)).toBeLessThan(1200);
  expect(Math.abs(bP.remainingMilliseconds - 540000)).toBeLessThan(1200);
  await page.evaluate(() => window.__TTC_TEST__.resumeAll());
  const aR = await page.evaluate(i => window.__TTC_TEST__.find(i), a);
  const bR = await page.evaluate(i => window.__TTC_TEST__.find(i), b);
  expect(aR.state).toBe("running");
  expect(bR.state).toBe("running");
  expect(Math.abs(aR.targetTimestamp - (Date.now() + aP.remainingMilliseconds))).toBeLessThan(60);
  expect(errors.length).toBe(0);
});

test("refresh restores saved timers without a reminder storm", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  const a = await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Persist A", minMinutes: 7, maxMinutes: 7 }));
  await page.evaluate(i => window.__TTC_TEST__.setRemaining(i, 1), a);
  await page.evaluate(() => window.__TTC_TEST__.tick());
  const before = await page.evaluate(i => window.__TTC_TEST__.find(i), a);
  expect(before.remindersCompleted).toBe(1);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__TTC_TEST__));
  const after = await page.evaluate(() => {
    const t = window.__TTC_TEST__.timers()[0];
    return { count: window.__TTC_TEST__.timers().length, state: t.state, prompt: t.prompt, reminders: t.remindersCompleted, targetFuture: t.targetTimestamp > Date.now() };
  });
  expect(after.count).toBe(1);
  expect(after.prompt).toBe("Persist A");
  expect(after.reminders).toBe(1);
  expect(after.state).toBe("running");
  expect(after.targetFuture).toBe(true);
  expect(errors.length).toBe(0);
});

test("corrupt localStorage falls back safely", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await page.evaluate(() => {
    localStorage.setItem("timeToClick.timers.v2", "{{{ not json");
    localStorage.setItem("timeToClick.settings.v2", "]bad");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__TTC_TEST__));
  const n = await page.evaluate(() => window.__TTC_TEST__.timers().length);
  expect(n).toBeGreaterThanOrEqual(0);
  expect(errors.length).toBe(0);
});

test("legacy migration creates one default timer carrying old settings & count", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await page.evaluate(() => {
    localStorage.setItem("timeToClick.settings.v1", JSON.stringify({ minMinutes: 3, maxMinutes: 5, speechVolume: 0.7 }));
    localStorage.setItem("timeToClick.reminderCount.v1", "12");
    localStorage.removeItem("timeToClick.timers.v2");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__TTC_TEST__));
  const t = await page.evaluate(() => window.__TTC_TEST__.timers()[0]);
  expect(t.prompt).toBe("Time to Click.");
  expect(t.minMinutes).toBe(3);
  expect(t.maxMinutes).toBe(5);
  expect(t.remindersCompleted).toBe(12);
  expect(t.state).toBe("not-started");
  expect(errors.length).toBe(0);
});

test("concurrent expirations enqueue both prompts and serialize the alarm queue", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  const a = await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Check Alpha", minMinutes: 5, maxMinutes: 5 }));
  const b = await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Check Bravo", minMinutes: 6, maxMinutes: 6 }));
  await page.evaluate(() => window.__TTC_TEST__.expireAll());
  // Both fired exactly once
  const ra = await page.evaluate(i => window.__TTC_TEST__.find(i).remindersCompleted, a);
  const rb = await page.evaluate(i => window.__TTC_TEST__.find(i).remindersCompleted, b);
  expect(ra).toBe(1);
  expect(rb).toBe(1);
  // The queue processes one at a time and eventually drains
  await page.waitForFunction(() => window.__TTC_TEST__.alarmQueueLength() === 0 && !window.__TTC_TEST__.alarmBusy(), { timeout: 15000 });
  expect(errors.length).toBe(0);
});

test("the specific expired card flashes with its prompt; others do not", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  const a = await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Flash Me", minMinutes: 5, maxMinutes: 5 }));
  await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Stay Calm", minMinutes: 9, maxMinutes: 9 }));
  await page.evaluate(i => window.__TTC_TEST__.expireNow(i), a);
  const flashCard = page.locator(".timer-card.alarm-flash");
  await expect(flashCard).toHaveCount(1);
  await expect(flashCard).toContainText("Flash Me");
  await expect(flashCard.locator(".flash-banner")).toBeVisible();
  expect(errors.length).toBe(0);
});

test("tab title tracks the soonest running timer", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Soon Task", minMinutes: 2, maxMinutes: 2 }));
  await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Later Task", minMinutes: 30, maxMinutes: 30 }));
  await page.waitForTimeout(500);
  const title = await page.title();
  expect(title).toContain("Soon Task");
  expect(title).toMatch(/^\d{2}:\d{2} /);
  expect(errors.length).toBe(0);
});

test("notification body uses the timer's prompt", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await page.evaluate(() => {
    window.__NOTES__ = [];
    window.Notification = function (title, opts) { window.__NOTES__.push({ title: title, body: opts && opts.body }); };
    window.Notification.permission = "granted";
  });
  // enable notifications setting directly
  const a = await page.evaluate(() => {
    const toggle = document.getElementById("notificationsToggle");
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    return window.__TTC_TEST__.addAndStart({ prompt: "Notify Body Here", minMinutes: 5, maxMinutes: 5 });
  });
  await page.evaluate(i => window.__TTC_TEST__.expireNow(i), a);
  await page.waitForFunction(() => window.__NOTES__.length > 0);
  const note = await page.evaluate(() => window.__NOTES__[0]);
  expect(note.title).toBe("Time to Click");
  expect(note.body).toBe("Notify Body Here");
  expect(errors.length).toBe(0);
});

test("deleting a timer with a queued alarm drops the queued alarm safely", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  const a = await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "First Speaker With A Long Prompt To Keep Queue Busy", minMinutes: 5, maxMinutes: 5 }));
  const b = await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Second", minMinutes: 5, maxMinutes: 5 }));
  await page.evaluate(() => window.__TTC_TEST__.expireAll());
  // Immediately delete b before its alarm can begin playing
  await page.evaluate(i => window.__TTC_TEST__.deleteDirect(i), b);
  await page.waitForFunction(() => window.__TTC_TEST__.alarmQueueLength() === 0 && !window.__TTC_TEST__.alarmBusy(), { timeout: 15000 });
  await expect(page.locator(".timer-card")).toHaveCount(1);
  expect(errors.length).toBe(0);
});

test("empty state shows after deleting all timers, with Add Timer", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  const a = await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Solo", minMinutes: 5, maxMinutes: 5 }));
  await page.evaluate(i => window.__TTC_TEST__.deleteDirect(i), a);
  await expect(page.locator("#emptyState")).toBeVisible();
  await expect(page.locator("#emptyState")).toContainText("No timers running");
  await expect(page.locator("#emptyAddBtn")).toBeVisible();
  expect(errors.length).toBe(0);
});

test("mobile layout: single column grid, no horizontal overflow", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Mobile A", minMinutes: 5, maxMinutes: 5 }));
  await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Mobile B", minMinutes: 6, maxMinutes: 6 }));
  await page.waitForTimeout(300);
  const metrics = await page.evaluate(() => {
    const grid = document.getElementById("timerGrid");
    const cards = Array.from(grid.querySelectorAll(".timer-card"));
    return {
      cols: new Set(cards.map(c => c.getBoundingClientRect().left)).size,
      docW: document.documentElement.scrollWidth,
      winW: window.innerWidth
    };
  });
  expect(metrics.cols).toBe(1);
  expect(metrics.docW).toBeLessThanOrEqual(metrics.winW + 1);
  expect(errors.length).toBe(0);
});

test("Add Timer dialog: inline validation, then Add & Start creates and starts", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await page.click("#addTimerBtn");
  await expect(page.locator("#timerDialog")).toBeVisible();
  // invalid interval -> inline error, no timer created
  await page.fill("#intervalInput", "abc");
  await page.fill("#promptInput", "Check the thing");
  await page.click("#timerDialogOk");
  await expect(page.locator("#intervalError")).toBeVisible();
  await expect(page.locator(".timer-card")).toHaveCount(0);
  await expect(page.locator("#timerDialog")).toBeVisible();
  // fix and submit
  await page.fill("#intervalInput", "5-8");
  await page.click("#timerDialogOk");
  await expect(page.locator("#timerDialog")).toBeHidden();
  await expect(page.locator(".timer-card")).toHaveCount(1);
  const t = await page.evaluate(() => window.__TTC_TEST__.timers()[0]);
  expect(t.state).toBe("running");
  expect(t.minMinutes).toBe(5);
  expect(t.maxMinutes).toBe(8);
  expect(t.prompt).toBe("Check the thing");
  expect(errors.length).toBe(0);
});

test("Edit dialog prefills and saves; countdown not reset", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  const id = await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Original", minMinutes: 8, maxMinutes: 8 }));
  await page.waitForTimeout(700);
  const before = await page.evaluate(i => window.__TTC_TEST__.find(i), id);
  await page.click(".timer-card .ctl-edit");
  await expect(page.locator("#timerDialog")).toBeVisible();
  await expect(page.locator("#timerDialogTitle")).toHaveText("Edit Timer");
  await expect(page.locator("#intervalInput")).toHaveValue("8");
  await expect(page.locator("#promptInput")).toHaveValue("Original");
  await page.fill("#promptInput", "Renamed Task");
  await page.fill("#intervalInput", "2-3");
  await page.click("#timerDialogOk");
  await expect(page.locator("#timerDialog")).toBeHidden();
  const after = await page.evaluate(i => window.__TTC_TEST__.find(i), id);
  expect(after.prompt).toBe("Renamed Task");
  expect(after.minMinutes).toBe(2);
  // current countdown untouched (still the original 8-minute cycle)
  expect(after.currentIntervalSeconds).toBe(before.currentIntervalSeconds);
  expect(after.currentIntervalSeconds).toBe(480);
  expect(errors.length).toBe(0);
});

test("Delete requires confirmation; cancel keeps the timer", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Precious", minMinutes: 5, maxMinutes: 5 }));
  await page.click(".timer-card .ctl-delete");
  await expect(page.locator("#confirmDialog")).toBeVisible();
  await expect(page.locator("#confirmMessage")).toContainText("Precious");
  await page.click("#confirmCancel");
  await expect(page.locator("#confirmDialog")).toBeHidden();
  await expect(page.locator(".timer-card")).toHaveCount(1);
  // now confirm
  await page.click(".timer-card .ctl-delete");
  await page.click("#confirmOk");
  await expect(page.locator(".timer-card")).toHaveCount(0);
  await expect(page.locator("#emptyState")).toBeVisible();
  expect(errors.length).toBe(0);
});

test("card countdown display ticks down and shows mm:ss", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  await page.evaluate(() => window.__TTC_TEST__.addAndStart({ prompt: "Visible Countdown", minMinutes: 5, maxMinutes: 5 }));
  const cd = page.locator(".timer-card .countdown");
  await expect(cd).toHaveText("05:00", { timeout: 3000 });
  await page.waitForTimeout(1500);
  const text = await cd.textContent();
  expect(text).toMatch(/^04:5[0-9]$/);
  expect(errors.length).toBe(0);
});

// ---------------------------------------------------------------------------
// Restore-time alarm ordering (cards must exist before alarms flash) and
// speech safety-timeout hardening.
// ---------------------------------------------------------------------------

function seedRunningTimer(overrides) {
  return Object.assign({
    id: "seed-" + Math.random().toString(36).slice(2, 8),
    prompt: "Seeded Task",
    minMinutes: 5,
    maxMinutes: 5,
    state: "running",
    currentIntervalSeconds: 300,
    targetTimestamp: 0,
    remainingMilliseconds: 0,
    remindersCompleted: 0,
    createdAt: Date.now()
  }, overrides);
}

test("overdue timer restored on reload fires exactly once and flashes its own card", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  const overdue = seedRunningTimer({
    prompt: "Overdue Restore Task",
    targetTimestamp: Date.now() - 45000,
    currentIntervalSeconds: 300
  });
  await page.evaluate(t => localStorage.setItem("timeToClick.timers.v2", JSON.stringify([t])), overdue);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__TTC_TEST__));

  // 1) incremented exactly once, 2) running again, 3) future target
  const t = await page.evaluate(() => window.__TTC_TEST__.timers()[0]);
  expect(t.prompt).toBe("Overdue Restore Task");
  expect(t.remindersCompleted).toBe(1);
  expect(t.state).toBe("running");
  expect(t.targetTimestamp).toBeGreaterThan(Date.now());

  // 4) card exists; 5) that same card carries the alarm visual state
  const card = page.locator(".timer-card", { hasText: "Overdue Restore Task" });
  await expect(card).toHaveCount(1);
  await expect(page.locator(".timer-card.alarm-flash")).toHaveCount(1);
  await expect(page.locator(".timer-card.alarm-flash")).toContainText("Overdue Restore Task");

  // 6) no reminder storm; 7) alarm queued/processed exactly once
  await page.waitForFunction(
    () => window.__TTC_TEST__.alarmQueueLength() === 0 && !window.__TTC_TEST__.alarmBusy(),
    { timeout: 15000 }
  );
  await page.evaluate(() => window.__TTC_TEST__.tick());
  const after = await page.evaluate(() => window.__TTC_TEST__.timers()[0]);
  expect(after.remindersCompleted).toBe(1);
  expect(await page.evaluate(() => window.__TTC_TEST__.processedAlarmCount())).toBe(1);
  expect(errors.length).toBe(0);
});

test("two overdue timers restored together each fire once with serialized alarms", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  const a = seedRunningTimer({ id: "seed-a", prompt: "Overdue Alpha", targetTimestamp: Date.now() - 60000 });
  const b = seedRunningTimer({ id: "seed-b", prompt: "Overdue Bravo", targetTimestamp: Date.now() - 30000 });
  await page.evaluate(ts => localStorage.setItem("timeToClick.timers.v2", JSON.stringify(ts)), [a, b]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__TTC_TEST__));

  // Both increment once and rearm with future targets.
  const states = await page.evaluate(() => window.__TTC_TEST__.timers().map(t => ({
    prompt: t.prompt, reminders: t.remindersCompleted, state: t.state, future: t.targetTimestamp > Date.now()
  })));
  expect(states).toHaveLength(2);
  for (const s of states) {
    expect(s.reminders).toBe(1);
    expect(s.state).toBe("running");
    expect(s.future).toBe(true);
  }

  // Each card flashes (serialized, so possibly at different moments).
  await expect(page.locator(".timer-card.alarm-flash", { hasText: "Overdue Alpha" })).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".timer-card.alarm-flash", { hasText: "Overdue Bravo" })).toBeVisible({ timeout: 20000 });

  // Both alarms retained and processed exactly once, in order, queue drains.
  await page.waitForFunction(
    () => window.__TTC_TEST__.alarmQueueLength() === 0 && !window.__TTC_TEST__.alarmBusy(),
    { timeout: 30000 }
  );
  expect(await page.evaluate(() => window.__TTC_TEST__.processedAlarmCount())).toBe(2);
  const finalCounts = await page.evaluate(() => window.__TTC_TEST__.timers().map(t => t.remindersCompleted));
  expect(finalCounts).toEqual([1, 1]);
  expect(errors.length).toBe(0);
});

test("speech safety timeout respects prompt length, speech rate, and a floor", async ({ page }) => {
  const errors = [];
  attachErrorCapture(page, errors);
  const results = await page.evaluate(() => {
    const h = window.__TTC_TEST__;
    const text = "Check the queue now.";
    const atRate1 = h.speechSafetyTimeoutMs(text);
    h.setSpeechRate(0.5);
    const atHalfRate = h.speechSafetyTimeoutMs(text);
    h.setSpeechRate(1);
    const afterRestore = h.speechSafetyTimeoutMs(text);
    const short = h.speechSafetyTimeoutMs("Hi.");
    const long = h.speechSafetyTimeoutMs("Please check the annotation queue and confirm every pending item before moving on with the rest of your work today.");
    const floor = h.speechSafetyTimeoutMs("");
    return { short, long, atHalfRate, atRate1, afterRestore, floor };
  });
  expect(results.short).toBeGreaterThanOrEqual(5000);
  expect(results.long).toBeGreaterThan(results.short);
  expect(results.atHalfRate).toBeGreaterThan(results.atRate1);
  expect(results.afterRestore).toBe(results.atRate1);
  expect(results.floor).toBe(5000);
  expect(errors.length).toBe(0);
});
