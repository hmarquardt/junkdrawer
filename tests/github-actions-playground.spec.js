/* Playwright spec for github-actions-playground.html
   Run: npx playwright test tests/github-actions-playground.spec.js --reporter=line
   The page is a single static file, so it is loaded over file:// exactly as it is
   used locally. Analytics calls are aborted: the collector is unreachable from
   file:// and would otherwise surface as a console error. */
const { test, expect } = require('@playwright/test');
const path = require('path');

const fileUrl = `file://${path.resolve(process.cwd(), 'github-actions-playground.html')}`;
test.use({ channel: 'chrome' });

async function open(page, hash) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  // Fulfil analytics locally instead of aborting: the collector and the tracker script
  // are unreachable from file://, and a failed request would show up as a console error.
  await page.route('**/api/analytics/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.route('**analytics-lite.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* analytics stubbed in tests */' }));
  await page.goto(fileUrl + (hash || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__GAP_TEST__));
  return errors;
}

test('loads, renders every section, and reports no errors', async ({ page }) => {
  const errors = await open(page, '#view-start');
  await expect(page.locator('h1')).toContainText('GitHub Actions is a computer');

  const views = await page.locator('main .view').count();
  expect(views).toBeGreaterThanOrEqual(20);
  await expect(page.locator('#navGroups button')).toHaveCount(views);

  const ids = await page.$$eval('main .view', els => els.map(e => e.id));
  for (const id of ids) {
    await page.evaluate(target => window.__GAP_TEST__.navigate(target), id);
    await expect(page.locator('#' + id)).toHaveClass(/active/);
  }

  await expect(page.locator('#runnerTable tbody tr')).toHaveCount(17);
  await expect(page.locator('#triggerTable tbody tr')).toHaveCount(26);
  await expect(page.locator('#recipeList article')).toHaveCount(16);
  await expect(page.locator('#expList article')).toHaveCount(15);
  await expect(page.locator('#oppList article')).toHaveCount(16);
  await expect(page.locator('#glossary dt')).toHaveCount(37);
  await expect(page.locator('#actionVersions tbody tr')).toHaveCount(14);
  await expect(page.locator('#srcTable tbody tr')).toHaveCount(27);
  await expect(page.locator('#costOut .stat')).toHaveCount(7);
  await expect(page.locator('#permChips .chip')).toHaveCount(10);
  await expect(page.locator('#treeChips .chip')).toHaveCount(2);
  await expect(page.locator('#cronPresets .chip')).toHaveCount(7);
  expect(await page.locator('.code .cpy').count()).toBeGreaterThan(15);
  expect(errors).toEqual([]);
});

test('navigation, deep links and keyboard shortcuts work', async ({ page }) => {
  const errors = await open(page, '#view-cost');
  await expect(page.locator('#view-cost')).toHaveClass(/active/);
  await expect(page.locator('#navGroups button[aria-current=page]')).toHaveText(/Costs/);

  await page.goto(fileUrl + '#view-cookbook/recipe-caching', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__GAP_TEST__));
  await expect(page.locator('#view-cookbook')).toHaveClass(/active/);
  expect(await page.locator('#recipe-caching').boundingBox()).not.toBeNull();

  const before = await page.evaluate(() => window.__GAP_TEST__.activeSection());
  await page.keyboard.press(']');
  const after = await page.evaluate(() => window.__GAP_TEST__.activeSection());
  expect(after).not.toBe(before);

  await page.keyboard.press('/');
  await expect(page.locator('#q')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#searchPanel')).not.toHaveClass(/open/);
  expect(errors).toEqual([]);
});

test('search finds topics and jumps to them', async ({ page }) => {
  const errors = await open(page);
  await page.fill('#q', 'ubuntu-slim');
  await expect(page.locator('#searchPanel')).toHaveClass(/open/);
  const results = page.locator('#resList button');
  expect(await results.count()).toBeGreaterThan(0);
  await results.first().click();
  await expect(page.locator('#searchPanel')).not.toHaveClass(/open/);
  const active = await page.evaluate(() => window.__GAP_TEST__.activeSection());
  expect(active).toBeTruthy();
  expect(await page.locator('#' + active).innerText()).toMatch(/ubuntu-slim/i);
  expect(errors).toEqual([]);
});

test('cron playground parses, explains and rejects', async ({ page }) => {
  const errors = await open(page, '#view-triggers');
  await page.fill('#cronExpr', '23 6 * * *');
  await expect(page.locator('#cronOut')).toContainText('06:23Z');
  expect(await page.locator('#cronNotes tbody tr').count()).toBeGreaterThan(5);
  await page.fill('#cronExpr', '17 6 1 * *');
  await expect(page.locator('#cronNotes')).toContainText('day-of-month 1');
  await page.fill('#cronExpr', 'not a cron');
  await expect(page.locator('#cronStatus')).toContainText('expected 5 fields');
  await page.click('#cronPresets .chip >> nth=2');
  await expect(page.locator('#cronExpr')).toHaveValue('*/15 * * * *');
  expect(errors).toEqual([]);
});

test('cost calculator and boundary explorer compute edge cases', async ({ page }) => {
  const errors = await open(page, '#view-cost');

  await page.selectOption('#cVisibility', 'public');
  await page.fill('#cMinutes', '12');
  await expect(page.locator('#costStatus')).toContainText('Nothing here bills GitHub');

  await page.selectOption('#cVisibility', 'private');
  await page.fill('#cMinutes', '0.1');
  await page.fill('#cJobs', '1');
  await page.fill('#cUsed', '0');
  await expect(page.locator('#costOut')).toContainText('1 min/job');

  await page.selectOption('#cRunner', 'linux_16');
  await expect(page.locator('#costStatus')).toContainText('Estimated');
  await expect(page.locator('#costNotes')).toContainText('cannot use included minutes');

  const options = await page.$$eval('#boundaryPick option', os => os.map(o => o.value));
  expect(options.length).toBeGreaterThan(5);
  for (const value of options) {
    await page.selectOption('#boundaryPick', value);
    await expect(page.locator('#boundaryOut')).toContainText(/free|billable/);
  }
  expect(errors).toEqual([]);
});

test('permissions calculator, recipes and decision trees are interactive', async ({ page }) => {
  const errors = await open(page, '#view-security');

  await page.click('#permChips .chip:has-text("Publish to GitHub Pages")');
  await expect(page.locator('#permOut')).toContainText('pages: write');
  await expect(page.locator('#permOut')).toContainText('id-token: write');
  await page.click('#permChips .chip:has-text("Pure compute")');
  await expect(page.locator('#permOut')).toContainText('permissions: {}');

  await page.evaluate(() => window.__GAP_TEST__.navigate('view-cookbook'));
  await page.fill('#recipeSearch', 'commit');
  expect(await page.locator('#recipeList article').count()).toBeGreaterThan(0);
  await page.fill('#recipeSearch', '');
  await page.click('#recipeFilters .chip:has-text("pipelines")');
  expect(await page.locator('#recipeList article').count()).toBeGreaterThan(0);
  await page.click('#recipeFilters .chip:has-text("all")');

  await page.evaluate(() => window.__GAP_TEST__.navigate('view-debug'));
  await expect(page.locator('#treeBox .dt-q')).toContainText('Actions tab');
  await page.click('#treeBox .dt-opt >> nth=0');
  await expect(page.locator('#treeBox')).toContainText('default branch');
  await page.click('#treeBox .dt-opt >> nth=1');
  await expect(page.locator('#treeBox .dt-answer, #treeBox .dt-q')).toBeVisible();
  expect(errors).toEqual([]);
});

test('copy buttons copy the complete snippet', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = await open(page, '#view-cookbook');
  await page.locator('#recipe-commit-data .code .cpy').first().click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('permissions:');
  expect(copied).toContain('contents: write');
  expect(copied.length).toBeGreaterThan(400);
  expect(errors).toEqual([]);
});

test('reading progress, bookmarks and experiments persist across a reload', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => window.__GAP_TEST__.navigate('view-runners'));
  await page.click('.star[data-star="view-runners"]');
  await expect(page.locator('.star[data-star="view-runners"]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#btnStars');
  await expect(page.locator('#rail .panel')).toContainText(/Runner Infrastructure/);
  await page.evaluate(() => window.__GAP_TEST__.setExperiment(1, true));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__GAP_TEST__));
  await expect(page.locator('#view-runners')).toHaveClass(/active/);
  await expect(page.locator('.star[data-star="view-runners"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#expProgress')).toContainText('1 of 15');
  expect(errors).toEqual([]);
});

/* ------------------------------------------------------------------
   Theme, contrast and layout invariants.

   The audit functions below run in the browser (Playwright serialises them),
   so they measure real computed styles rather than the intent of the CSS.
   ------------------------------------------------------------------ */
const PREFS_KEY = 'gaPlayground.prefs.v1';

/* Contrast for every text-bearing element inside a view, resolved against the
   background it actually sits on. Returns only failures: [] means nothing unreadable. */
function contrastAudit(viewId) {
  function parse(c) {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(s => parseFloat(s.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function lin(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function lum(c) { return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b); }
  function over(fg, bg) {
    return { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };
  }
  function ratio(a, b) {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  function bgOf(el) {
    let n = el, acc = null;
    while (n && n.nodeType === 1) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { acc = acc ? over(acc, c) : c; if (acc.a >= 0.999) return acc; }
      n = n.parentElement;
    }
    return acc || { r: 255, g: 255, b: 255, a: 1 };
  }
  function ownText(el) {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim().length > 1) return true;
    return false;
  }
  const view = document.getElementById(viewId);
  if (!view) return [];
  const out = [];
  for (const el of view.querySelectorAll('*')) {
    if (!ownText(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.9) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (el.closest('[aria-hidden=true]')) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const eff = fg.a < 1 ? over(fg, bg) : fg;
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const need = (size >= 24 || (size >= 18.66 && weight >= 700)) ? 3 : 4.5;
    const got = ratio(eff, bg);
    if (got < need) {
      out.push({
        el: el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ').filter(Boolean).join('.'),
        color: cs.color,
        bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')',
        size, weight, need, got: Math.round(got * 100) / 100,
        text: el.textContent.trim().slice(0, 40)
      });
    }
  }
  return out;
}

/* Characters per first line for wide paragraphs, estimated against the rendered font. */
function proseMeasure() {
  const out = [];
  for (const el of document.querySelectorAll('main p, main li')) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 500) continue;
    const cs = getComputedStyle(el);
    if ((parseFloat(cs.lineHeight) || 24) * 2.5 > rect.height) continue;
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    probe.style.font = cs.font;
    probe.textContent = 'x'.repeat(100);
    document.body.appendChild(probe);
    const perChar = probe.getBoundingClientRect().width / 100;
    probe.remove();
    out.push({ chars: Math.round(rect.width / perChar), width: Math.round(rect.width) });
  }
  return out;
}

const rgbLuminance = (rgb) => {
  const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map(Number).map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/* As open(), plus a probe registered before any page script, so tests can see the
   theme as it stood when parsing finished — i.e. what the first paint used. */
async function openPrepared(page, hash) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.route('**/api/analytics/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.route('**analytics-lite.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* analytics stubbed in tests */' }));
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      window.__themeAtDCL__ = document.documentElement.getAttribute('data-theme');
      window.__themePrefAtDCL__ = document.documentElement.getAttribute('data-theme-pref');
    });
  });
  await page.goto(fileUrl + (hash || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__GAP_TEST__));
  return errors;
}

test('a fresh visitor gets the light theme, applied before first paint', async ({ page }) => {
  const errors = await openPrepared(page, '#view-start');

  expect(await page.evaluate(() => window.__themeAtDCL__)).toBe('light');
  expect(await page.evaluate(() => window.__themePrefAtDCL__)).toBe('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#themeSel')).toHaveValue('light');

  const painted = await page.evaluate(() => ({
    body: getComputedStyle(document.body).backgroundColor,
    text: getComputedStyle(document.body).color,
    scheme: getComputedStyle(document.documentElement).colorScheme,
    code: getComputedStyle(document.querySelector('.code')).backgroundColor,
    codeText: getComputedStyle(document.querySelector('.code pre')).color,
    icon: document.getElementById('themeIco').textContent.trim()
  }));
  expect(rgbLuminance(painted.body)).toBeGreaterThan(0.85);   // white reading surface
  expect(rgbLuminance(painted.text)).toBeLessThan(0.1);       // dark, readable type
  expect(painted.scheme).toBe('light');
  expect(rgbLuminance(painted.code)).toBeGreaterThan(0.8);    // code is light by default too
  expect(rgbLuminance(painted.codeText)).toBeLessThan(0.2);   // …with dark code text
  expect(painted.icon).toBe('☀');
  expect(errors).toEqual([]);
});

test('dark and system modes work, persist, and code follows the theme', async ({ page }) => {
  const errors = await openPrepared(page);

  await page.selectOption('#themeSel', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme-pref', 'dark');
  const dark = await page.evaluate(() => ({
    body: getComputedStyle(document.body).backgroundColor,
    text: getComputedStyle(document.body).color,
    scheme: getComputedStyle(document.documentElement).colorScheme,
    code: getComputedStyle(document.querySelector('.code')).backgroundColor,
    icon: document.getElementById('themeIco').textContent.trim()
  }));
  expect(rgbLuminance(dark.body)).toBeLessThan(0.1);
  expect(rgbLuminance(dark.text)).toBeGreaterThan(0.6);
  expect(dark.scheme).toBe('dark');
  expect(rgbLuminance(dark.code)).toBeLessThan(0.1);          // code follows the chosen theme
  expect(dark.icon).toBe('☾');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__GAP_TEST__));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#themeSel')).toHaveValue('dark');
  expect(await page.evaluate(() => window.__themeAtDCL__)).toBe('dark');

  // System is opt-in, and keeps following the OS while the page is open.
  await page.selectOption('#themeSel', 'system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme-pref', 'system');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#themeLab')).toContainText('System, following OS');

  // An explicit choice ignores the OS preference entirely.
  await page.selectOption('#themeSel', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // A legacy stored preference (bookmarks, the old contrast flag) carries no theme decision.
  await page.evaluate(k => localStorage.setItem(k, JSON.stringify({ bookmarks: ['view-cost'], contrast: true })), PREFS_KEY);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__GAP_TEST__));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(errors).toEqual([]);
});

test('no unreadable text in any section, in either theme', async ({ page }) => {
  const errors = await openPrepared(page);
  const ids = await page.evaluate(() => [...document.querySelectorAll('main .view')].map(v => v.id));
  expect(ids.length).toBeGreaterThanOrEqual(20);

  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => window.__GAP_TEST__.setTheme(t), theme);
    let scanned = 0;
    const failures = [];
    for (const id of ids) {
      await page.evaluate(v => window.__GAP_TEST__.navigate(v), id);
      scanned += await page.evaluate(v => document.querySelectorAll('#' + v + ' *').length, id);
      const bad = await page.evaluate(contrastAudit, id);
      bad.forEach(b => failures.push(theme + ' ' + id + ': ' + b.el + ' ' + b.got + ':1 < ' + b.need + ':1 (' +
        b.color + ' on ' + b.bg + ', ' + b.size + 'px/' + b.weight + ') "' + b.text + '"'));
    }
    expect(scanned).toBeGreaterThan(4000);
    expect(failures).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test('prose stays in a readable measure and no panel collapses', async ({ page }) => {
  const errors = await openPrepared(page, '#view-model');
  const lines = [];
  for (const id of ['view-start', 'view-model', 'view-cookbook', 'view-security']) {
    await page.evaluate(v => window.__GAP_TEST__.navigate(v), id);
    (await page.evaluate(proseMeasure)).forEach(l => lines.push(l));
  }
  expect(lines.length).toBeGreaterThanOrEqual(3);
  const sorted = lines.map(l => l.chars).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  expect(median).toBeGreaterThan(78);
  expect(median).toBeLessThan(118);

  // A grid nested inside a grid once collapsed the calculators into a 76px column.
  const ids = await page.evaluate(() => [...document.querySelectorAll('main .view')].map(v => v.id));
  const collapsed = [];
  for (const id of ids) {
    const bad = await page.evaluate(v => {
      window.__GAP_TEST__.navigate(v);
      const out = [];
      const sel = '#' + v + ' .card, #' + v + ' .tool, #' + v + ' .exp, #' + v + ' .opp, #' + v +
        ' .dtree, #' + v + ' .tablewrap, #' + v + ' .grid';
      document.querySelectorAll(sel).forEach(el => {
        const w = Math.round(el.getBoundingClientRect().width);
        if (w > 0 && w < 300) out.push(el.tagName + '.' + String(el.className || '') + ' = ' + w + 'px');
      });
      return out;
    }, id);
    bad.forEach(b => collapsed.push(id + ': ' + b));
  }
  expect(collapsed).toEqual([]);
  expect(errors).toEqual([]);
});

test('the theme control is labelled and keyboard operable', async ({ page }) => {
  const errors = await openPrepared(page);
  await expect(page.getByLabel(/Colour theme/)).toHaveCount(1);
  await page.locator('#themeSel').focus();
  expect(await page.evaluate(() => document.activeElement.id)).toBe('themeSel');
  const ring = await page.evaluate(() => getComputedStyle(document.getElementById('themeSel').closest('.themesel')).boxShadow);
  expect(ring).not.toBe('none');                       // visible focus ring on the control
  await page.selectOption('#themeSel', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => window.__GAP_TEST__.theme().pref)).toBe('dark');
  expect(errors).toEqual([]);
});

test('mobile layout does not create horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openPrepared(page, '#view-cookbook');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  // the bar wraps into rows instead of squeezing the search field or overlapping controls
  const bar = await page.evaluate(() => ({
    height: Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
    search: Math.round(document.querySelector('.search').getBoundingClientRect().width),
    rows: new Set([...document.querySelectorAll('.topbar-tools > *')].map(el => Math.round(el.getBoundingClientRect().top))).size
  }));
  expect(bar.search).toBeGreaterThan(300);
  expect(bar.rows).toBeGreaterThan(1);
  await page.screenshot({ path: '/tmp/github-actions-playground-mobile.png', fullPage: false });

  for (const width of [360, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(150);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});

test('the only network call is the opt-in live workflow check', async ({ page }) => {
  const requests = [];
  page.on('request', r => { const u = r.url(); if (!u.startsWith('file://')) requests.push(u); });
  // Fulfil analytics locally instead of aborting: the collector and the tracker script
  // are unreachable from file://, and a failed request would show up as a console error.
  await page.route('**/api/analytics/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.route('**analytics-lite.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* analytics stubbed in tests */' }));
  await page.goto(fileUrl + '#view-explorer', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__GAP_TEST__));
  await page.waitForTimeout(400);
  expect(requests.filter(u => u.includes('api.github.com'))).toEqual([]);
  await expect(page.locator('#invList')).toContainText('overhead-data.yml');
});
