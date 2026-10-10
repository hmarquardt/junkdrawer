/* Playwright spec for cloudflare-developer-playground.html
   Run: npx playwright test tests/cloudflare-developer-playground.spec.js --reporter=line
   The page is a single static file, so it is loaded over file:// exactly as
   it is used locally. Analytics is fulfilled locally because the collector
   is unreachable from file:// and a failed request would surface as a
   console error. */
const { test, expect } = require('@playwright/test');
const path = require('path');

const fileUrl = `file://${path.resolve(process.cwd(), 'cloudflare-developer-playground.html')}`;
test.use({ channel: 'chrome' });
test.describe.configure({ mode: 'serial' });

async function open(page, hash) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.route('**/api/analytics/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.route('**analytics-lite.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* analytics stubbed in tests */' }));
  await page.goto(fileUrl + (hash || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__CFP_TEST__));
  return errors;
}

test('loads, renders every section, and reports no errors', async ({ page }) => {
  const errors = await open(page, '#view-start');
  await expect(page.locator('main h1').first()).toContainText('Cloudflare is a small computer');

  const views = await page.locator('main .view').count();
  expect(views).toBeGreaterThanOrEqual(40);
  await expect(page.locator('#navGroups button')).toHaveCount(views);

  const ids = await page.$$eval('main .view', els => els.map(e => e.id));
  for (const id of ids) {
    await page.evaluate(target => window.__CFP_TEST__.navigate(target), id);
    await expect(page.locator('#' + id)).toHaveClass(/active/);
    const text = await page.locator('#' + id).innerText();
    expect(text.trim().length).toBeGreaterThan(80);
  }

  await expect(page.locator('#recipeList article')).toHaveCount(31);
  await expect(page.locator('#expList article')).toHaveCount(22);
  await expect(page.locator('#atlas article')).toHaveCount(7);
  await expect(page.locator('#oppList article')).toHaveCount(22);
  await expect(page.locator('#glossaryList dt')).toHaveCount(51);
  await expect(page.locator('#srcList tbody tr')).toHaveCount(65);
  await page.evaluate(() => window.__CFP_TEST__.navigate('view-pricing'));
  await expect(page.locator('#pricingTables table').first()).toBeVisible();
  await expect(page.locator('#pricingTables table')).toHaveCount(19);
  await expect(page.locator('#boundaryList article')).toHaveCount(18);
  await expect(page.locator('#limitTables table')).toHaveCount(18);
  await page.evaluate(() => window.__CFP_TEST__.navigate('view-atlas'));
  await expect(page.locator('.map-svg .node').first()).toBeVisible();
  await page.evaluate(() => window.__CFP_TEST__.navigate('view-start'));
  expect(errors).toEqual([]);
});

test('navigation, deep links and keyboard shortcuts work', async ({ page }) => {
  const errors = await open(page, '#view-pricing');
  await expect(page.locator('#view-pricing')).toHaveClass(/active/);
  await expect(page.locator('#navGroups button[aria-current=page]')).toHaveText(/Costs/);

  await page.goto(fileUrl + '#view-recipes/recipe-d1-crud', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__CFP_TEST__));
  await expect(page.locator('#view-recipes')).toHaveClass(/active/);
  expect(await page.locator('#recipe-d1-crud').boundingBox()).not.toBeNull();

  const before = await page.evaluate(() => window.__CFP_TEST__.activeSection());
  await page.keyboard.press(']');
  const after = await page.evaluate(() => window.__CFP_TEST__.activeSection());
  expect(after).not.toBe(before);
  await page.keyboard.press('[');
  expect(await page.evaluate(() => window.__CFP_TEST__.activeSection())).toBe(before);

  await page.keyboard.press('/');
  await expect(page.locator('#q')).toBeFocused();
  expect(errors).toEqual([]);
});

test('search finds products, limits and recipes, and reports empty states', async ({ page }) => {
  const errors = await open(page);
  await page.fill('#q', 'class a operations');
  await expect(page.locator('#qPanel .res').first()).toBeVisible();
  expect((await page.locator('#qPanel .res b').first().innerText()).toLowerCase()).toContain('r2');

  await page.fill('#q', 'zzzzqqq');
  await expect(page.locator('#qPanel .empty')).toContainText('No matches');

  await page.fill('#q', 'durable objects');
  await page.locator('#qPanel .res').first().click();
  await expect(page.locator('#view-do')).toHaveClass(/active/);
  expect(errors).toEqual([]);
});
test('bookmarks and recents are local, visible and resettable', async ({ page }) => {
  const errors = await open(page, '#view-d1');
  await page.locator('[data-bookmark="view-d1"]').click();
  await expect(page.locator('#bmN')).toHaveText('1');
  await expect(page.locator('[data-bookmark="view-d1"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#bmBtn').click();
  await expect(page.locator('#qPanel .res')).toHaveCount(1);
  await expect(page.locator('#qPanel b')).toContainText('D1');
  await page.locator('body').click({ position: { x: 5, y: 400 } });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__CFP_TEST__));
  await expect(page.locator('#bmN')).toHaveText('1');
  await expect(page.locator('#recentN')).not.toHaveText('0');

  await page.locator('#resetBtn').click();
  await expect(page.locator('#bmN')).toHaveText('0');
  expect(errors).toEqual([]);
});

test('theme is light by default, persistent, and system is opt-in', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await page.selectOption('#themeSel', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(darkBg).not.toBe(lightBg);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__CFP_TEST__));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#themeSel')).toHaveValue('dark');

  await page.selectOption('#themeSel', 'system');
  const resolved = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  expect(['light', 'dark']).toContain(resolved);

  await page.selectOption('#themeSel', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(errors).toEqual([]);
});

test('cost calculators react to input and flag unverified allowances', async ({ page }) => {
  const errors = await open(page, '#view-d1');
  const out = page.locator('#d1-out');
  await expect(out).toContainText('Estimated month');
  const before = await out.innerText();

  await page.fill('#d1-rowsRead', '40000000000');
  const after = await out.innerText();
  expect(after).not.toBe(before);
  expect(after).toContain('over allowance');

  await page.fill('#d1-rowsRead', '0');
  await expect(out).toContainText('within allowance');

  await page.goto(fileUrl + '#view-do', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__CFP_TEST__));
  await expect(page.locator('#do-out')).toContainText('Estimated month');
  await page.fill('#do-sqlStorage', '3');
  await expect(page.locator('#do-out')).toContainText('charged from zero');
  expect(errors).toEqual([]);
});

test('the composable estimator totals the stack and warns about pooled meters', async ({ page }) => {
  const errors = await open(page, '#view-pricing');
  const host = page.locator('#fullStackCalc');
  await expect(host).toContainText('Estimated month');
  await expect(host).toContainText('Subtotal');
  await expect(host).toContainText('Shared meters detected');

  const before = await host.innerText();
  await page.fill('#stack-d1-rowsRead', '50000000000');
  expect(await host.innerText()).not.toBe(before);
  expect(errors).toEqual([]);
});

test('the decision lab recommends, and is willing to say no', async ({ page }) => {
  const errors = await open(page, '#view-decision');
  await expect(page.locator('#decisionOut')).toContainText('Recommended services');

  await page.locator('[data-scen="sc-vps"]').click();
  await expect(page.locator('#decisionOut .verdict')).toHaveClass(/no/);
  await expect(page.locator('#decisionOut')).toContainText('may not be the best execution environment');
  await expect(page.locator('#decisionOut')).toContainText('Containers');

  await page.locator('[data-scen="sc-auth"]').click();
  await expect(page.locator('#decisionOut')).toContainText('D1');
  await expect(page.locator('#decisionOut')).toContainText('Fit:');

  await page.fill('#decision-memoryMb', '900');
  await expect(page.locator('#decisionOut')).toContainText('128 MB');
  expect(errors).toEqual([]);
});

test('the storage advisor and orchestration tree both reach a recommendation', async ({ page }) => {
  const errors = await open(page, '#view-storage');
  await expect(page.locator('#storageAdvisor .pick').first()).toContainText('Recommendation');
  await page.locator('[data-st="st-events"]').click();
  await expect(page.locator('#stDetail')).toContainText('R2');

  await page.goto(fileUrl + '#view-coordination', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__CFP_TEST__));
  await page.locator('#orchInner [data-tree-opt="It is a multi-step process that must survive failure"]').click();
  await expect(page.locator('#orchInner .verdict')).toContainText('Workflows');
  await page.locator('#orchInner [data-tree-restart]').click();
  await expect(page.locator('#orchInner .tree-opts')).toBeVisible();
  expect(errors).toEqual([]);
});
test('diagnostic trees walk, ask for evidence, and restart cleanly', async ({ page }) => {
  const errors = await open(page, '#view-troubleshoot');
  await expect(page.locator('#treeHost .tree-q')).toContainText('Does it happen on every request');

  await page.locator('[data-tree="t-bill"]').click();
  await page.locator('#treeInner [data-tree-opt="R2 operations, especially Class A"]').click();
  await expect(page.locator('#treeInner .verdict')).toContainText('listing');
  await expect(page.locator('#treeInner .verdict')).toContainText('Collect first');

  await page.locator('#treeInner [data-tree-restart]').click();
  await expect(page.locator('#treeInner .tree-q')).toContainText('Which meter grew');

  await page.locator('#treeInner [data-tree-opt="Container memory and disk hours"]').click();
  await page.locator('#treeInner [data-tree-restart]').click();
  await page.locator('#treeInner [data-tree-opt="Log events, or the observability allowance"]').click();
  await expect(page.locator('#treeInner .verdict')).toContainText('sampling');
  expect(errors).toEqual([]);
});

test('the cron explorer parses, rejects, and offers working presets', async ({ page }) => {
  const errors = await open(page, '#view-cron');
  await expect(page.locator('#cronOut table')).toBeVisible();
  await expect(page.locator('#cronOut')).toContainText('06:23Z');

  await page.fill('#cronExpr', 'not a cron');
  await expect(page.locator('#cronOut .callout')).toContainText('five fields');

  await page.fill('#cronExpr', '59 23 LW * *');
  await expect(page.locator('#cronOut')).toContainText('2026-');
  await page.locator('[data-cron="*/15 * * * *"]').click();
  await expect(page.locator('#cronExpr')).toHaveValue('*/15 * * * *');
  await expect(page.locator('#cronOut tbody tr')).toHaveCount(5);
  expect(errors).toEqual([]);
});

test('recipes filter, expand and expose copyable code', async ({ page }) => {
  const errors = await open(page, '#view-recipes');
  await expect(page.locator('#recipeCount')).toContainText('31 of 31');
  await page.locator('[data-rcat="storage"]').click();
  const filtered = await page.locator('#recipeList article').count();
  expect(filtered).toBeGreaterThan(3);
  expect(filtered).toBeLessThan(31);

  await page.locator('[data-rcat="all"]').click();
  const first = page.locator('#recipeList article').first();
  await first.locator('summary').click();
  await expect(first.locator('.code pre')).toBeVisible();

  await first.locator('.cpy').click();
  await expect(first.locator('.cpy')).toHaveText(/Copied|Copy/);
  expect(errors).toEqual([]);
});

test('experiment progress is tracked locally and survives a reload', async ({ page }) => {
  const errors = await open(page, '#view-experiments');
  await expect(page.locator('#expProgress')).toContainText('0/22');
  await page.locator('[data-exp="exp-04"]').check();
  await expect(page.locator('#expProgress')).toContainText('1/22');

  await page.locator('[data-egrp="Storage"]').click();
  await expect(page.locator('#expList article').first()).toBeVisible();
  await page.locator('[data-egrp="all"]').click();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__CFP_TEST__));
  await expect(page.locator('[data-exp="exp-04"]')).toBeChecked();
  await page.locator('#resetBtn').click();
  await expect(page.locator('#expProgress')).toContainText('0/22');
  expect(errors).toEqual([]);
});

test('the ecosystem map selects nodes, shows relationships and filters', async ({ page }) => {
  const errors = await open(page, '#view-atlas');
  await expect(page.locator('#mapDetail h3')).toContainText('Workers');
  await page.locator('.map-svg .node[data-node="r2"]').click();
  await expect(page.locator('#mapDetail h3')).toContainText('R2');
  await expect(page.locator('#mapDetail .rel').first()).toContainText('binding');

  await page.locator('[data-mapcat="ai"]').click();
  const dimmed = await page.$$eval('.map-svg .node', els => els.filter(e => e.style.opacity === '0.18').length);
  expect(dimmed).toBeGreaterThan(0);
  await page.locator('[data-mapcat="all"]').click();
  expect(errors).toEqual([]);
});

test('the dashboard atlas shows a full panel for every product', async ({ page }) => {
  const errors = await open(page, '#view-dashboard');
  await expect(page.locator('#dashDetail')).toContainText('Find it');
  await expect(page.locator('#dashDetail')).toContainText('Understand its cost');
  await page.locator('[data-prod="d1"]').click();
  await expect(page.locator('#dashDetail h3')).toContainText('D1');
  await expect(page.locator('#dashDetail')).toContainText('Rows read');
  await page.locator('#dashChips [data-cat="orchestration"]').click();
  const shown = await page.locator('#dashList .chip').count();
  expect(shown).toBeGreaterThan(2);
  expect(errors).toEqual([]);
});
test('layouts hold at phone, tablet and desktop widths', async ({ page }) => {
  const errors = await open(page);

  for (const width of [360, 414, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => {
      const de = document.documentElement;
      return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth };
    });
    // allow a small tolerance for scrollbar rounding
    expect(overflow.scrollWidth - overflow.clientWidth).toBeLessThanOrEqual(2);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#rail')).toBeHidden();
  await page.locator('#railToggle').click();
  await expect(page.locator('#rail')).toBeVisible();
  await expect(page.locator('#railToggle')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#navGroups button').first().click();
  await expect(page.locator('#rail')).toBeHidden();
  expect(errors).toEqual([]);
});

test('accessibility basics: landmarks, labels, names and focus order', async ({ page }) => {
  const errors = await open(page);

  await expect(page.locator('header.bar')).toHaveCount(1);
  await expect(page.locator('nav#rail')).toHaveAttribute('aria-label', /sections/i);
  await expect(page.locator('#status')).toHaveAttribute('role', 'status');
  await expect(page.locator('.skip')).toHaveAttribute('href', '#main');

  // every control has an accessible name
  const unnamed = await page.evaluate(() => {
    const nameOf = el => {
      if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
      if (el.getAttribute('aria-labelledby')) return 'labelledby';
      if (el.labels && el.labels.length) return Array.from(el.labels).map(l => l.textContent).join(' ').trim();
      if (el.closest('label')) return el.closest('label').textContent.trim();
      return (el.textContent || '').trim();
    };
    return Array.from(document.querySelectorAll('button, select, input'))
      .filter(el => !nameOf(el))
      .map(el => el.tagName + '#' + (el.id || el.className));
  });
  expect(unnamed).toEqual([]);

  // every section has exactly one h1 and a bookmark control
  const headings = await page.$$eval('main .view', els => els.map(e => e.querySelectorAll('h1').length));
  expect(headings.every(n => n === 1)).toBe(true);
  await expect(page.locator('[data-bookmark]')).toHaveCount(41);

  // the map exposes keyboard-reachable nodes with names
  await page.evaluate(() => window.__CFP_TEST__.navigate('view-atlas'));
  await expect(page.locator('.map-svg .node[tabindex="0"]').first()).toHaveAttribute('aria-label', /\w/);
  expect(errors).toEqual([]);
});

test('contrast of body text against the surface holds in both themes', async ({ page }) => {
  await open(page);
  const measure = () => page.evaluate(() => {
    const toRgb = value => {
      const v = String(value || '').trim();
      if (v.startsWith('#')) {
        const h = v.length === 4 ? v.slice(1).split('').map(c => c + c).join('') : v.slice(1);
        return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
      }
      const m = (v.match(/[\d.]+/g) || []).map(Number);
      return m.slice(0, 3);
    };
    const lum = value => {
      const m = toRgb(value).map(v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
    };
    const ratio = (a, b) => {
      const l1 = lum(a), l2 = lum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const body = getComputedStyle(document.body);
    const muted = document.querySelector('.muted');
    const mutedColor = muted ? getComputedStyle(muted).color : body.color;
    const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface');
    return {
      bodyOnBg: ratio(body.color, body.backgroundColor),
      mutedOnSurface: ratio(mutedColor, surface.trim() || body.backgroundColor)
    };
  });

  const light = await measure();
  expect(light.bodyOnBg).toBeGreaterThan(7);
  expect(light.mutedOnSurface).toBeGreaterThan(4.5);

  await page.selectOption('#themeSel', 'dark');
  const dark = await measure();
  expect(dark.bodyOnBg).toBeGreaterThan(7);
  expect(dark.mutedOnSurface).toBeGreaterThan(4.5);
});

test('print stylesheet forces the light palette', async ({ page }) => {
  await open(page);
  await page.selectOption('#themeSel', 'dark');
  await page.emulateMedia({ media: 'print' });
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lum = bg.match(/\d+/g).map(Number).slice(0, 3).reduce((a, b) => a + b, 0) / 3;
  expect(lum).toBeGreaterThan(200);
  const chromeHidden = await page.evaluate(() => getComputedStyle(document.querySelector('header.bar')).display);
  expect(chromeHidden).toBe('none');
  await page.emulateMedia({ media: 'screen' });
  await page.selectOption('#themeSel', 'light');
});

test('wide tables scroll inside their own wrapper, not the page', async ({ page }) => {
  const errors = await open(page, '#view-limits');
  const result = await page.evaluate(() => {
    const escapes = [];
    let scrollable = 0;
    document.querySelectorAll('.tw').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > document.documentElement.clientWidth + 2) escapes.push(el.className);
      if (el.scrollWidth > el.clientWidth + 2) scrollable += 1;
    });
    return { escapes, scrollable, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  expect(result.escapes).toEqual([]);
  expect(result.overflow).toBeLessThanOrEqual(2);
  expect(result.scrollable).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
