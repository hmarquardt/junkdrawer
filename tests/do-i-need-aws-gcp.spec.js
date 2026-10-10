/* Playwright spec for do-i-need-aws-gcp.html
   Run: npx playwright test tests/do-i-need-aws-gcp.spec.js --reporter=line

   The page is a single static file loaded over file:// exactly as it is used
   locally. Analytics and the shared storage helper are stubbed so a missing CDN
   request cannot masquerade as a defect. No test provisions anything. */
const { test, expect } = require('@playwright/test');
const path = require('path');

const fileUrl = `file://${path.resolve(process.cwd(), 'do-i-need-aws-gcp.html')}`;
test.use({ channel: 'chrome' });
test.describe.configure({ mode: 'serial' });

async function open(page, hash) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.route('**/api/analytics/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.route('**analytics-lite.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* analytics stubbed in tests */' }));
  await page.goto(fileUrl + (hash || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__DNG_TEST__));
  return errors;
}
const viewIds = () => window.__DNG_TEST__ && window.__DNG_TEST__.sections();

test('loads, renders, and reports no errors', async ({ page }) => {
  const errors = await open(page, '#view-start');
  await expect(page.locator('main h1').first()).toContainText('Where AWS and Google Cloud still earn their complexity');
  const ids = await page.evaluate(viewIds);
  expect(ids.length).toBeGreaterThanOrEqual(22);
  const counts = await page.evaluate(() => window.__DNG_TEST__.counts());
  expect(counts.prices).toBeGreaterThan(100);
  expect(counts.discrepancies).toBe(9);
  expect(counts.patterns).toBeGreaterThanOrEqual(25);
  expect(errors).toEqual([]);
});

test('every section renders without an empty mount once visited', async ({ page }) => {
  const errors = await open(page, '#view-start');
  const ids = await page.evaluate(viewIds);
  for (const id of ids) {
    await page.evaluate(v => window.__DNG_TEST__.go(v.replace('view-', '')), id);
    const html = await page.evaluate(v => {
      const s = document.getElementById(v);
      const mount = s.querySelector('div[id$="Mount"]');
      return mount ? mount.innerHTML.length : s.textContent.length;
    }, id);
    expect(html, id + ' rendered nothing').toBeGreaterThan(200);
  }
  expect(errors).toEqual([]);
});

test('navigation, deep links, bookmarks and the progress meter work', async ({ page }) => {
  const errors = await open(page);
  await page.click('#railBody button[data-go="view-necessity"]');
  expect(await page.evaluate(() => window.__DNG_TEST__.activeSection())).toBe('view-necessity');
  expect(await page.evaluate(() => location.hash)).toBe('#view-necessity');
  await page.click('#bookmarkBtn');
  expect(await page.textContent('#bookmarkCount')).toBe('1');
  await page.goto(fileUrl + '#view-storage', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__DNG_TEST__));
  expect(await page.evaluate(() => window.__DNG_TEST__.activeSection())).toBe('view-storage');
  const progress = await page.textContent('#progressText');
  expect(progress).toMatch(/^\d+\/\d+$/);
  await page.keyboard.press('/');
  expect(await page.evaluate(() => document.activeElement.id)).toBe('q');
  expect(errors).toEqual([]);
});

test('search finds records, deep-links them, and reports an empty state', async ({ page }) => {
  const errors = await open(page);
  await page.fill('#q', 'postgis');
  await page.waitForSelector('#qPanel .res');
  const hits = await page.$$eval('#qPanel .res', els => els.map(e => e.textContent));
  expect(hits.length).toBeGreaterThan(0);
  await page.fill('#q', 'zzzznotathing');
  await expect(page.locator('#qPanel .empty')).toBeVisible();
  await page.fill('#q', 'minimum storage duration');
  await page.waitForSelector('#qPanel .res');
  await page.click('#qPanel .res');
  expect(await page.evaluate(() => window.__DNG_TEST__.activeSection())).toMatch(/^view-/);
  expect(errors).toEqual([]);
});

test('the necessity test answers, explains itself, and re-runs on a change', async ({ page }) => {
  const errors = await open(page, '#view-necessity');
  const verdict = await page.textContent('#necessityResult .stamp');
  expect(verdict.length).toBeGreaterThan(3);
  await page.click('[data-tpl="tpl-training"]');
  await expect(page.locator('#necessityResult .stamp')).toContainText('Required');
  const why = await page.$$eval('#necessityResult ul.why li', els => els.map(e => e.textContent));
  expect(why.length).toBeGreaterThan(1);
  await expect(page.locator('#necessityResult')).toContainText('Eliminated, with the constraint named');
  await page.click('[data-tpl="tpl-gisapi"]');
  await expect(page.locator('#necessityResult')).toContainText('PostGIS');
  const changed = await page.evaluate(() => window.__DNG_TEST__.setRequirement({ memoryGB: 64 }));
  expect(changed.memoryGB).toBe(64);
  await expect(page.locator('#necessityResult .stamp')).toContainText(/Not needed|Competitive option|Strongly justified|Required|Insufficient/);
  expect(errors).toEqual([]);
});

test('the cost laboratory prices, states unknowns and honours an override', async ({ page }) => {
  const errors = await open(page, '#view-costlab');
  await page.click('.tabRow .tab[data-lab="object"]');
  await expect(page.locator('#costlabMount')).toContainText('Deep Archive');
  await page.click('.tabRow .tab[data-lab="ai"]');
  const unknownText = await page.textContent('#costlabMount');
  expect(unknownText).toMatch(/not set|unknown/i);
  const before = await page.evaluate(() => window.__DNG_TEST__.cost('aws.ec2.gpu', { gpuCount: 1, gpuVramGB: 24, durationMin: 60, runsPerMonth: 100 }).monthly);
  await page.fill('input[data-ov="ec2.g5.xlarge"]', '2.5');
  await page.locator('body').click();
  const after = await page.evaluate(() => window.__DNG_TEST__.cost('aws.ec2.gpu', { gpuCount: 1, gpuVramGB: 24, durationMin: 60, runsPerMonth: 100 }).monthly);
  expect(after).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});

test('the storage comparator reprices on input and names the cheapest class', async ({ page }) => {
  const errors = await open(page, '#view-storage');
  await expect(page.locator('#storageMount')).toContainText('Minimum storage duration');
  const cheap = async () => page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#storageMount table tbody tr'));
    return rows.length;
  });
  expect(await cheap()).toBeGreaterThan(6);
  await page.fill('#st-retrievals', '4000');
  await page.fill('#st-egressGB', '4000');
  await page.fill('#st-storageDays', '30');
  await expect(page.locator('#storageMount')).toContainText('Cheapest for these volumes');
  const verdict = await page.textContent('#storageMount .callout.ok');
  expect(verdict).toMatch(/R2 Standard|Standard|Nearline/);
  expect(errors).toEqual([]);
});

test('break-even shows curves and refuses to invent a crossing', async ({ page }) => {
  const errors = await open(page, '#view-breakeven');
  const svgs = await page.locator('#breakevenMount svg').count();
  expect(svgs).toBeGreaterThanOrEqual(10);
  await expect(page.locator('#breakevenMount')).toContainText('No crossover to report');
  const text = await page.textContent('#breakevenMount');
  expect(text).toContain('insufficient information');
  expect(errors).toEqual([]);
});

test('the advisors name the rule that fired and show every rule', async ({ page }) => {
  const errors = await open(page, '#view-advisors');
  await expect(page.locator('#advisorsMount')).toContainText(/Rule c\d+ fired, after evaluating \d+ of 15/);
  await expect(page.locator('#advisorsMount details').first()).toBeVisible();
  const rules = await page.locator('#advisorsMount table tbody tr').count();
  expect(rules).toBeGreaterThan(25);
  expect(errors).toEqual([]);
});

test('cost surprises are calculators, not warnings', async ({ page }) => {
  const errors = await open(page, '#view-surprises');
  await page.fill('#sp-s-nat-gatewayHours', '730');
  await page.fill('#sp-s-nat-gatewayGB', '1000');
  const text = await page.textContent('#surprisesMount');
  expect(text).toMatch(/Gateway hours/);
  expect(text).toMatch(/Where it appears/);
  expect(errors).toEqual([]);
});

test('patterns render diagrams, and the Road Naturalist case study runs its envelope', async ({ page }) => {
  const errors = await open(page, '#view-patterns');
  const diagrams = await page.locator('#patternsMount .diagram').count();
  expect(diagrams).toBeGreaterThanOrEqual(26);
  await page.click('[data-prov="aws"]');
  const afterFilter = await page.locator('#patternsMount .diagram').count();
  expect(afterFilter).toBeLessThan(diagrams);
  await page.evaluate(() => window.__DNG_TEST__.go('roadnaturalist'));
  await expect(page.locator('#roadnatMount')).toContainText('resource envelope');
  await page.click('#rnRun');
  await expect(page.locator('#rnResult')).toContainText('confidence');
  expect(errors).toEqual([]);
});

test('the audit view reproduces all nine and links the machine-readable report', async ({ page }) => {
  const errors = await open(page, '#view-audit');
  const items = await page.locator('#auditMount .rowCard').count();
  expect(items).toBe(9);
  await expect(page.locator('#auditMount')).toContainText('implementation defect');
  await expect(page.locator('#auditMount')).toContainText('docs/aws-gcp-disagreements-2026-10.json');
  await expect(page.locator('#auditMount')).toContainText('Written advice is right');
  expect(errors).toEqual([]);
});

test('the method view runs the invariants in the browser', async ({ page }) => {
  const errors = await open(page, '#view-method');
  await page.click('#runSelfTest');
  await expect(page.locator('#selfTestOut .badge.bad')).toHaveCount(0);
  const status = await page.textContent('#selfTestStatus');
  expect(status).toContain('All invariants hold');
  expect(errors).toEqual([]);
});

test('scenarios save, export, import and survive a reload without executing markup', async ({ page }) => {
  const errors = await open(page, '#view-necessity');
  await page.click('[data-tpl="tpl-burst"]');
  page.once('dialog', d => d.accept('spec scenario'));
  await page.click('#nsBookmark');
  await page.evaluate(() => window.__DNG_TEST__.go('saved'));
  await expect(page.locator('#savedMount')).toContainText('spec scenario');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__DNG_TEST__));
  const saved = await page.evaluate(() => window.__DNG_TEST__.scenarios());
  expect(saved.length).toBe(1);
  expect(saved[0].name).toBe('spec scenario');
  const bad = await page.evaluate(() => window.__DNG_TEST__.importScenario('{"kind":"dng-scenario","name":"<img src=x onerror=window.__PWNED=1>","requirement":{"memoryGB":999999999999,"category":"nonsense"}}'));
  expect(bad.ok).toBe(true);
  expect(bad.requirement.memoryGB).toBeLessThanOrEqual(1000000000);
  expect(await page.evaluate(() => window.__PWNED)).toBeUndefined();
  const notJson = await page.evaluate(() => window.__DNG_TEST__.importScenario('<script>window.__PWNED=1</script>'));
  expect(notJson.ok).toBe(false);
  expect(errors).toEqual([]);
});

test('the theme control switches and persists, and reset clears local state', async ({ page }) => {
  const errors = await open(page);
  await page.selectOption('#themeSel', 'dark');
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__DNG_TEST__));
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
  await page.click('#resetBtn');
  expect(await page.evaluate(() => window.__DNG_TEST__.scenarios().length)).toBe(0);
  expect(await page.evaluate(() => window.__DNG_TEST__.prefs().bookmarks.length)).toBe(0);
  expect(errors).toEqual([]);
});

test('the page works offline: no request leaves the browser', async ({ page }) => {
  const requests = [];
  page.on('request', r => { const u = r.url(); if (!u.startsWith('file://') && !u.includes('analytics')) requests.push(u); });
  const errors = await open(page);
  await page.evaluate(() => window.__DNG_TEST__.go('necessity'));
  await page.evaluate(() => window.__DNG_TEST__.classifyNow());
  await page.evaluate(() => window.__DNG_TEST__.go('costlab'));
  await page.evaluate(() => window.__DNG_TEST__.go('surprises'));
  expect(requests, 'the page must not call out for its own decisions').toEqual([]);
  expect(errors).toEqual([]);
});

test('keyboard and screen-reader affordances are present', async ({ page }) => {
  await open(page);
  await expect(page.locator('a.skip')).toHaveAttribute('href', '#main');
  await expect(page.locator('#liveRegion')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#q')).toHaveAttribute('aria-label');
  await expect(page.locator('#q')).toHaveAttribute('role', 'combobox');
  await expect(page.locator('#themeSel')).toHaveAttribute('aria-label', 'Theme');
  const unlabelled = await page.evaluate(() => Array.from(document.querySelectorAll('input, select, textarea')).filter(el => {
    if (el.type === 'hidden' || el.getAttribute('aria-label')) return false;
    if (el.id && document.querySelector('label[for="' + el.id + '"]')) return false;
    return !el.closest('label');
  }).map(el => el.id || el.name || el.outerHTML.slice(0, 60)));
  expect(unlabelled).toEqual([]);
  const headings = await page.$$eval('main h1', els => els.length);
  expect(headings).toBeGreaterThanOrEqual(1);
});

test('the layout survives a narrow viewport without clipping controls', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 800 });
  const errors = await open(page, '#view-necessity');
  await expect(page.locator('#railToggle')).toBeVisible();
  await page.click('#railToggle');
  await expect(page.locator('#railBody')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(errors).toEqual([]);
});

test('the acceptance criteria of the investigation are visible on the page', async ({ page }) => {
  await open(page, '#view-start');
  await expect(page.locator('#startMount')).toContainText('Not needed');
  await expect(page.locator('#startMount')).toContainText('Required by constraints');
  await expect(page.locator('#startMount')).toContainText('Insufficient information');
  await page.evaluate(() => window.__DNG_TEST__.go('projects'));
  await expect(page.locator('#projectsMount')).toContainText('Road Naturalist');
  await expect(page.locator('#projectsMount')).toContainText('Migration is not the default');
  await page.evaluate(() => window.__DNG_TEST__.go('evidence'));
  await expect(page.locator('#evidenceMount')).toContainText('rate card read');
  await expect(page.locator('#evidenceMount input[data-ov]').first()).toBeVisible();
  await expect(page.locator('#evidenceMount')).toContainText('must be supplied');
  await page.evaluate(() => window.__DNG_TEST__.go('gaps'));
  await expect(page.locator('#gapsMount')).toContainText('specialist');
  await page.evaluate(() => window.__DNG_TEST__.go('atlas'));
  await expect(page.locator('#atlasMount')).toContainText('Cloud Run jobs');
  await page.evaluate(() => window.__DNG_TEST__.go('glossary'));
  await expect(page.locator('#glossaryMount')).toContainText('Minimum storage duration');
});
