const { test, expect } = require("@playwright/test");
const path = require("path");

const fileUrl = `file://${path.resolve(process.cwd(), "gem-safari.html")}`;
const N = 8;
const TYPES = 6;


test.beforeEach(async ({ page }) => {
  // Analytics is a third-party endpoint; keep network calls out of local runs.
  await page.route("**/api/analytics/**", route => route.fulfill({ status: 204, body: "" }));
});

test.use({ channel: "chrome" });

// Independent reference implementation of "three in a row", used only to craft
// deterministic boards for the spec. The page under test has its own matcher.
function hasRun(board) {
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N - 2; c++) {
      const v = board[r * N + c];
      if (v === board[r * N + c + 1] && v === board[r * N + c + 2]) return true;
    }
  }
  for (let c = 0; c < N; c++) {
    for (let r = 0; r < N - 2; r++) {
      const v = board[r * N + c];
      if (v === board[(r + 1) * N + c] && v === board[(r + 2) * N + c]) return true;
    }
  }
  return false;
}

function neighborsOf(i) {
  const r = Math.floor(i / N);
  const c = i % N;
  const out = [];
  if (r) out.push(i - N);
  if (r < N - 1) out.push(i + N);
  if (c) out.push(i - 1);
  if (c < N - 1) out.push(i + 1);
  return out;
}

function validMoves(board) {
  const out = [];
  for (let i = 0; i < N * N; i++) {
    for (const j of neighborsOf(i)) {
      if (j < i) continue;
      [board[i], board[j]] = [board[j], board[i]];
      if (hasRun(board)) out.push([i, j, j === i + 1 ? "H" : "V"]);
      [board[i], board[j]] = [board[j], board[i]];
    }
  }
  return out;
}

function craftBoard() {
  for (let attempt = 0; attempt < 50000; attempt++) {
    const board = Array.from({ length: N * N }, () => Math.floor(Math.random() * TYPES));
    if (hasRun(board)) continue;
    const moves = validMoves(board);
    if (moves.some(m => m[2] === "H") && moves.some(m => m[2] === "V")) return board;
  }
  throw new Error("Could not craft a board with both orientations");
}

async function loadBoard(page) {
  const board = craftBoard();
  const accepted = await page.evaluate(candidate => window.__GEM_SAFARI_TEST__.setBoard(candidate), board);
  expect(accepted, "crafted board should be a legal starting position").toBe(true);
  expect(await page.evaluate(() => window.__GEM_SAFARI_TEST__.matches().length)).toBe(0);
  expect(await page.evaluate(() => window.__GEM_SAFARI_TEST__.hasMove())).toBe(true);
  return page.evaluate(() => window.__GEM_SAFARI_TEST__.validMoves());
}

async function waitForMove(page, expectedMoves) {
  await page.waitForFunction(
    moves => document.querySelector("#moves")?.textContent === String(moves),
    expectedMoves,
    { timeout: 20000 }
  );
  await page.waitForFunction(() => !window.__GEM_SAFARI_TEST__.busy(), null, { timeout: 20000 });
}

async function clickSwap(page, from, to) {
  await page.locator(`[data-i="${from}"]`).click();
  await expect(page.locator(".cell.selected")).toHaveCount(1);
  expect(await page.evaluate(() => window.__GEM_SAFARI_TEST__.selected())).toBe(from);
  await page.locator(`[data-i="${to}"]`).click();
}

async function dragSwap(page, from, to) {
  const a = await page.locator(`[data-i="${from}"]`).boundingBox();
  const b = await page.locator(`[data-i="${to}"]`).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
  await page.mouse.up();
}

function pickMove(live, orientation) {
  return live.find(m => (orientation === "H" ? m[1] === m[0] + 1 : m[1] === m[0] + 8));
}

test("rejects a swap that makes no match and keeps the board intact", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => message.type() === "error" && errors.push(message.text()));

  await page.goto(fileUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GEM_SAFARI_TEST__);

  const live = await page.evaluate(() => window.__GEM_SAFARI_TEST__.validMoves());
  const illegal = [];
  for (let i = 0; i < N * N && !illegal.length; i++) {
    for (const j of neighborsOf(i)) {
      if (j < i) continue;
      if (!live.some(m => m[0] === i && m[1] === j)) illegal.push([i, j]);
    }
  }
  expect(illegal.length).toBeGreaterThan(0);
  const before = await page.evaluate(() => window.__GEM_SAFARI_TEST__.board());
  await clickSwap(page, illegal[0][0], illegal[0][1]);
  await expect(page.locator("#status")).toContainText("no group", { timeout: 8000 });
  expect(await page.evaluate(() => window.__GEM_SAFARI_TEST__.moves())).toBe(25);
  expect(await page.evaluate(() => window.__GEM_SAFARI_TEST__.board())).toEqual(before);
  expect(await page.evaluate(() => window.__GEM_SAFARI_TEST__.busy())).toBe(false);
  expect(errors).toEqual([]);
});

for (const orientation of ["H", "V"]) {
  const label = orientation === "H" ? "horizontal" : "vertical";

  test(`${label} click swap consumes a move and leaves the board unlocked`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => message.type() === "error" && errors.push(message.text()));

    await page.goto(fileUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__GEM_SAFARI_TEST__);
    const live = await loadBoard(page);
    const move = pickMove(live, orientation);
    expect(move, `board should offer a ${label} move`).toBeTruthy();

    await clickSwap(page, move[0], move[1]);
    await waitForMove(page, 24);
    expect(await page.evaluate(() => window.__GEM_SAFARI_TEST__.busy())).toBe(false);

    // Regression: selection used to stop responding after the first move.
    await page.locator('[data-i="0"]').click();
    expect(await page.evaluate(() => window.__GEM_SAFARI_TEST__.selected())).toBe(0);
    await expect(page.locator(".cell.selected")).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test(`${label} keyboard swap consumes a move`, async ({ page }) => {
    await page.goto(fileUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__GEM_SAFARI_TEST__);
    const live = await loadBoard(page);
    const move = pickMove(live, orientation);
    expect(move).toBeTruthy();

    // Enter selects the focused gem, an arrow moves focus to its neighbor,
    // and the second Enter performs the swap.
    await page.locator(`[data-i="${move[0]}"]`).focus();
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => window.__GEM_SAFARI_TEST__.selected())).toBe(move[0]);
    await page.keyboard.press(orientation === "H" ? "ArrowRight" : "ArrowDown");
    await page.keyboard.press("Enter");
    await waitForMove(page, 24);
    expect(await page.evaluate(() => window.__GEM_SAFARI_TEST__.busy())).toBe(false);
  });

  test(`${label} drag swap consumes a move`, async ({ page }) => {
    await page.goto(fileUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__GEM_SAFARI_TEST__);
    const live = await loadBoard(page);
    const move = pickMove(live, orientation);
    expect(move).toBeTruthy();

    await dragSwap(page, move[0], move[1]);
    await waitForMove(page, 24);
    expect(await page.evaluate(() => window.__GEM_SAFARI_TEST__.busy())).toBe(false);
  });
}

test("generated starting boards are match-free and always playable", async ({ page }) => {
  await page.goto(fileUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GEM_SAFARI_TEST__);
  for (let i = 0; i < 12; i++) {
    await page.locator("#restart").click();
    expect(await page.evaluate(() => window.__GEM_SAFARI_TEST__.matches().length)).toBe(0);
    expect(await page.evaluate(() => window.__GEM_SAFARI_TEST__.hasMove())).toBe(true);
    expect(await page.evaluate(() => window.__GEM_SAFARI_TEST__.validMoves().length)).toBeGreaterThan(0);
  }
});
