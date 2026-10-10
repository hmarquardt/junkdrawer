/* Playwright spec for infrastructure-field-guide.html
   Run: npx playwright test tests/infrastructure-field-guide.spec.js --reporter=line

   The landing page is loaded over file:// exactly as it is used locally, and
   the four artifacts it links to are loaded the same way, so a deep link is
   verified by actually following it and asking the target page which section is
   active. Analytics and the shared storage helper are stubbed so a missing
   request cannot masquerade as a defect. */
const { test, expect } = require('@playwright/test');
const path = require('path');

const PAGE = 'infrastructure-field-guide.html';
const fileUrl = `file://${path.resolve(process.cwd(), PAGE)}`;
const artifactUrl = f => `file://${path.resolve(process.cwd(), f)}`;

/* Each sibling exposes the same read-only hook shape: activeSection() names the
   section that is currently shown. */
const HOOKS = {
  'github-actions-playground.html': '__GAP_TEST__',
  'cloudflare-developer-playground.html': '__CFP_TEST__',
  'right-tool-for-the-job.html': '__RTJ_TEST__',
  'do-i-need-aws-gcp.html': '__DNG_TEST__'
};

test.use({ channel: 'chrome' });
test.describe.configure({ mode: 'serial' });

async function open(page, hash) {
  const errors = [];
  const requests = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('request', r => { if (!r.url().startsWith('file://') && !r.url().startsWith('data:')) requests.push(r.url()); });
  await page.route('**/api/analytics/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.route('**analytics-lite.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* stubbed */' }));
  await page.goto(fileUrl + (hash || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__IFG_TEST__));
  return { errors, requests };
}

test('loads, renders, and reports no errors', async ({ page }) => {
  const { errors, requests } = await open(page, '#top');
  await expect(page.locator('h1')).toHaveText('Infrastructure Field Guide');
  await expect(page.locator('.tagline')).toHaveText('Less infrastructure. Better decisions.');
  await expect(page.locator('#guides h2')).toHaveText('The four field guides');
  expect(await page.evaluate(() => window.__IFG_TEST__.guides().length)).toBe(4);
  expect(requests, 'no request should leave the browser').toEqual([]);
  expect(errors).toEqual([]);
});

test('the theme is light by default and dark is a deliberate choice', async ({ page }) => {
  const { errors } = await open(page);
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
  await expect(page.locator('[data-theme-set="light"]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('[data-theme-set="dark"]');
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
  await expect(page.locator('[data-theme-set="dark"]')).toHaveAttribute('aria-pressed', 'true');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__IFG_TEST__));
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
  await page.click('[data-theme-set="system"]');
  expect(await page.evaluate(() => window.__IFG_TEST__.theme().state)).toBe('system');
  expect(errors).toEqual([]);
});

test('every section on the page has real content', async ({ page }) => {
  const { errors } = await open(page);
  const ids = await page.evaluate(() => window.__IFG_TEST__.sections());
  expect(ids.length).toBe(8);
  for (const id of ids) {
    const len = await page.evaluate(i => document.getElementById(i).textContent.trim().length, id);
    expect(len, id + ' rendered nothing').toBeGreaterThan(220);
  }
  expect(errors).toEqual([]);
});

test('section navigation scrolls and marks the current section', async ({ page }) => {
  const { errors } = await open(page);
  await page.click('#tnav a[href="#findings"]');
  await page.waitForFunction(() => {
    const el = document.getElementById('findings');
    return el && Math.abs(el.getBoundingClientRect().top) < 220;
  });
  await page.waitForFunction(() =>
    document.querySelector('#tnav a[href="#findings"]').getAttribute('aria-current') === 'true');
  expect(await page.locator('#tnav a[href="#findings"]').getAttribute('aria-current')).toBe('true');
  await page.click('#tnav a[href="#beyond"]');
  await page.waitForFunction(() =>
    document.querySelector('#tnav a[href="#beyond"]').getAttribute('aria-current') === 'true');
  expect(await page.locator('#tnav a[href="#findings"]').getAttribute('aria-current')).toBe(null);
  expect(errors).toEqual([]);
});


test('all four guides are linked, and every promoted deep link really lands', async ({ page }) => {
  const { errors } = await open(page);
  const guides = await page.evaluate(() => window.__IFG_TEST__.guides());
  expect(guides.length).toBe(4);
  for (const g of guides) {
    const primary = page.locator(`a[href="${g.file}"]`).first();
    await expect(primary).toBeVisible();
    const deep = await page.evaluate(id => window.__IFG_TEST__.allLinks().filter(l => l.guide === id && l.view), g.id);
    expect(deep.length, g.id + ' should promote deep links').toBeGreaterThanOrEqual(3);
    const hook = HOOKS[g.file];
    expect(hook, 'a known test hook for ' + g.file).toBeTruthy();
    for (const d of deep.slice(0, 2)) {
      await page.goto(artifactUrl(d.href.split('#')[0]) + '#' + d.view, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(h => window[h] && typeof window[h].activeSection === 'function', hook, { timeout: 15000 });
      const active = await page.evaluate(h => window[h].activeSection(), hook);
      expect(active, d.href + ' did not open ' + d.view).toBe(d.view);
      await page.goto(fileUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => Boolean(window.__IFG_TEST__));
    }
  }
  expect(errors).toEqual([]);
});

test('the selector answers deterministically and links to the right guide', async ({ page }) => {
  const { errors } = await open(page, '#start');
  const ids = await page.evaluate(() => window.__IFG_TEST__.intents());
  expect(ids.length).toBe(10);
  await expect(page.locator('#intents .intent')).toHaveCount(10);
  for (const id of ids) {
    const expected = await page.evaluate(i => window.__IFG_TEST__.recommend(i), id);
    await page.click(`[data-intent="${id}"]`);
    await expect(page.locator(`[data-intent="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
    const answer = await page.locator('#answer').textContent();
    expect(answer).toContain(expected.guide.title);
    expect(answer).toContain(expected.why.slice(0, 40));
    const href = await page.locator('#answer a.btn').first().getAttribute('href');
    expect(href).toBe(expected.primary.href);
    expect(await page.evaluate(() => window.__IFG_TEST__.recommend(window.__IFG_TEST__.currentIntent()))).toEqual(expected);
  }
  expect(errors).toEqual([]);
});

test('the selector result survives a reload and updates the progress meter', async ({ page }) => {
  const { errors } = await open(page, '#start');
  await page.click('[data-intent="necessary"]');
  await expect(page.locator('#answer')).toContainText('Do I Still Need AWS or GCP?');
  expect(await page.textContent('#progress')).toMatch(/^1\/4 opened$/);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__IFG_TEST__));
  expect(await page.evaluate(() => window.__IFG_TEST__.currentIntent())).toBe('necessary');
  await expect(page.locator('[data-intent="necessary"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#answer')).toContainText('Do I Still Need AWS or GCP?');
  expect(await page.textContent('#progress')).toMatch(/^1\/4 opened$/);
  expect(errors).toEqual([]);
});

test('every rendered link on the dynamic surfaces is relative and safe', async ({ page }) => {
  const { errors } = await open(page, '#start');
  await page.click('[data-intent="costs"]');
  const hrefs = await page.evaluate(() => window.__IFG_TEST__.links());
  expect(hrefs.length).toBeGreaterThan(4);
  for (const h of hrefs) {
    expect(h, 'a rendered link must stay relative: ' + h).toMatch(/^[A-Za-z0-9._-]+\.html(#view-[a-z0-9-]+)?$/);
  }
  const all = await page.locator('a[href]').evaluateAll(els => els.map(e => e.getAttribute('href')));
  for (const h of all) {
    expect(h.startsWith('javascript:'), 'no javascript: links').toBe(false);
    expect(h.startsWith('data:'), 'no data: links').toBe(false);
  }
  expect(errors).toEqual([]);
});

test('guarded storage is used, and a full quota does not break the page', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.addInitScript(() => {
    /* Simulate a shared origin whose budget is already full. */
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
    void orig;
  });
  await page.route('**analytics-lite.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* stubbed */' }));
  await page.goto(fileUrl + '#start', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__IFG_TEST__));
  await page.click('[data-intent="storage"]');
  await expect(page.locator('#answer')).toContainText('Do I Still Need AWS or GCP?');
  await page.click('[data-theme-set="dark"]');
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
  expect(errors).toEqual([]);
});


test('the metadata table renders a snapshot that matches the registry', async ({ page }) => {
  const { errors } = await open(page, '#sources');
  const registry = require(path.resolve(process.cwd(), 'junk-drawer.json'));
  const rows = await page.locator('#metaBody tr').evaluateAll(trs => trs.map(tr => [...tr.children].map(td => td.textContent.trim())));
  expect(rows.length).toBe(4);
  for (const r of rows) {
    const href = await page.locator('#metaBody tr', { hasText: r[0] }).locator('a[href$=".html"]').first().getAttribute('href');
    const entry = registry.pages[href];
    expect(entry, href + ' must be a registered page').toBeTruthy();
    expect(r[1]).toBe(entry.version);
    expect(Number(r[2])).toBeGreaterThan(10);
    expect(r[3]).toBe('2026-10-10');
  }
  await expect(page.locator('#metaVerified')).toHaveText('2026-10-10');
  await expect(page.locator('#sources')).toContainText('no automatic synchronization');
  /* The page states its own version and date, from the bundle, not from memory. */
  const own = await page.evaluate(() => window.IFGData.META.landing);
  await expect(page.locator('#landingVersion')).toHaveText(own.version);
  await expect(page.locator('#landingUpdated')).toHaveText(own.updated);
  expect(own.version).toBe(registry.pages['infrastructure-field-guide.html'].version);
  expect(errors).toEqual([]);
});

test('all five guided paths render with working steps', async ({ page }) => {
  const { errors } = await open(page, '#paths');
  const paths = await page.evaluate(() => window.__IFG_TEST__.paths());
  expect(paths.length).toBe(5);
  await expect(page.locator('#pathsMount .path')).toHaveCount(5);
  for (const p of paths) {
    const links = page.locator(`#path-${p.id} a`);
    await expect(links).toHaveCount(p.steps);
    for (const h of await links.evaluateAll(els => els.map(e => e.getAttribute('href')))) {
      expect(h).toMatch(/^[A-Za-z0-9._-]+\.html#view-[a-z0-9-]+$/);
    }
  }
  expect(errors).toEqual([]);
});

test('the guide panels keep their own identity and match the data', async ({ page }) => {
  const { errors } = await open(page, '#guides');
  await expect(page.locator('.guide')).toHaveCount(4);
  await expect(page.locator('.guide .spine .verb')).toHaveText(['Discover', 'Explore', 'Decide', 'Challenge']);
  for (const cls of ['gh', 'cf', 'rtj', 'dng']) {
    await expect(page.locator(`.guide.${cls}`)).toHaveCount(1);
  }
  const onPage = await page.locator('#guides a[href*="#view-"]').evaluateAll(els => els.map(e => e.getAttribute('href')));
  for (const g of await page.evaluate(() => window.__IFG_TEST__.guides())) {
    const expected = await page.evaluate(id => window.IFGData.GUIDES.filter(x => x.id === id)[0].deep.map(dd => dd.view), g.id);
    for (const v of expected) {
      expect(onPage, 'the panel for ' + g.file + ' should link ' + v).toContain(g.file + '#' + v);
    }
  }
  expect(onPage.length).toBeGreaterThanOrEqual(20);
  expect(errors).toEqual([]);
});

test('the page reports its own invariants in the browser', async ({ page }) => {
  const { errors } = await open(page);
  const st = await page.evaluate(() => window.__IFG_TEST__.selfTest());
  expect(st.failed, JSON.stringify(st.checks.filter(c => !c.ok))).toBe(0);
  expect(st.total).toBeGreaterThanOrEqual(25);
  const sum = await page.evaluate(() => window.__IFG_TEST__.sumSections());
  expect(await page.evaluate(() => window.__IFG_TEST__.statSections())).toBe(String(sum));
  expect(errors).toEqual([]);
});


test('keyboard and screen-reader affordances are present and usable', async ({ page }) => {
  const { errors } = await open(page);
  await expect(page.locator('header.topbar')).toBeVisible();
  await expect(page.locator('nav[aria-label="Sections of this page"]')).toBeVisible();
  await expect(page.locator('main#main')).toHaveCount(1);
  await expect(page.locator('footer[data-junkdrawer-deploy-footer]')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('#answer')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#selectorStatus')).toHaveAttribute('role', 'status');
  await expect(page.locator('[data-theme-set="light"]')).toHaveAttribute('aria-pressed', 'true');
  /* The skip link is the first thing a keyboard reaches and it works. */
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.className)).toBe('skip');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => location.hash)).toBe('#main');
  /* A selector button is operable from the keyboard alone. */
  await page.locator('#intents .intent').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#answer .verdict')).toBeVisible();
  /* Every link has discernible text and no image is decorative noise. */
  const empty = await page.locator('a[href]').evaluateAll(els =>
    els.filter(e => !e.textContent.trim() && !e.getAttribute('aria-label')).length);
  expect(empty).toBe(0);
  expect(await page.locator('img').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('the layout survives a narrow viewport without clipping or overflow', async ({ page }) => {
  const { errors } = await open(page);
  await page.setViewportSize({ width: 380, height: 820 });
  await page.waitForTimeout(150);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'the page must not scroll sideways on a phone').toBeLessThanOrEqual(1);
  for (const sel of ['#tnav a[href="#guides"]', '[data-theme-set="dark"]', '#intents .intent', '.guide.gh a.btn']) {
    const box = await page.locator(sel).first().boundingBox();
    expect(box, sel + ' should be laid out').toBeTruthy();
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(381);
  }
  /* The selector still answers on a narrow screen. */
  await page.click('[data-intent="automate"]');
  await expect(page.locator('#answer')).toContainText('GitHub Actions');
  expect(errors).toEqual([]);
});

test('the print stylesheet removes the chrome and keeps the prose', async ({ page }) => {
  const { errors } = await open(page);
  await page.emulateMedia({ media: 'print' });
  const hidden = await page.locator('.topbar').evaluate(el => getComputedStyle(el).display);
  expect(hidden).toBe('none');
  const actions = await page.locator('.hero-actions').evaluate(el => getComputedStyle(el).display);
  expect(actions).toBe('none');
  await expect(page.locator('.guide').first()).toBeVisible();
  await expect(page.locator('footer[data-junkdrawer-deploy-footer]')).toBeAttached();
  await page.emulateMedia({ media: 'screen' });
  expect(errors).toEqual([]);
});

test('the page explains itself when scripting is unavailable', async ({ page }) => {
  const context = page.context();
  const blocked = await context.newPage();
  await blocked.route('**/*.js', r => r.abort());
  await blocked.goto(fileUrl, { waitUntil: 'domcontentloaded' });
  const noscript = await blocked.locator('noscript').first().textContent();
  expect(noscript.length).toBeGreaterThan(20);
  /* Primary navigation is static HTML and therefore survives with no JS at all. */
  await expect(blocked.locator('a[href="github-actions-playground.html"]').first()).toBeVisible();
  await expect(blocked.locator('a[href="do-i-need-aws-gcp.html"]').first()).toBeVisible();
  expect(await blocked.locator('#guides .guide').count()).toBe(4);
  await blocked.close();
});

test('dark mode is legible and does not invert the page into a dashboard', async ({ page }) => {
  const { errors } = await open(page);
  await page.click('[data-theme-set="dark"]');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const fg = await page.evaluate(() => getComputedStyle(document.body).color);
  expect(bg).not.toBe(fg);
  expect(bg).toMatch(/^rgb\((1[0-9]|2[0-9]), /);
  const link = await page.locator('#guides a[href="right-tool-for-the-job.html"]').first()
    .evaluate(el => getComputedStyle(el).color);
  expect(link).not.toBe(fg);
  expect(errors).toEqual([]);
});
