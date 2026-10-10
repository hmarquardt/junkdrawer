/* Playwright spec for right-tool-for-the-job.html
   Run: npx playwright test tests/right-tool-for-the-job.spec.js --reporter=line
   The page is a single static file loaded over file:// exactly as it is used
   locally. Analytics and the shared storage helper are stubbed so a missing
   CDN request cannot masquerade as a page defect. */
const { test, expect } = require('@playwright/test');
const path = require('path');

const fileUrl = `file://${path.resolve(process.cwd(), 'right-tool-for-the-job.html')}`;
test.use({ channel: 'chrome' });
test.describe.configure({ mode: 'serial' });

async function open(page, hash) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.route('**/api/analytics/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.route('**analytics-lite.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* analytics stubbed in tests */' }));
  await page.goto(fileUrl + (hash || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__RTJ_TEST__));
  return errors;
}
const T = page => page.evaluate;

test('loads, renders every section, and reports no errors', async ({ page }) => {
  const errors = await open(page, '#view-start');
  await expect(page.locator('main h1').first()).toContainText('Pick the infrastructure by requirements');
  const views = await page.locator('main .view').count();
  expect(views).toBeGreaterThanOrEqual(16);
  const empty = await page.evaluate(() => window.__RTJ_TEST__.emptyMounts());
  expect(empty).toEqual([]);
  expect(errors).toEqual([]);
});

test('navigation, deep links and the keyboard shortcut work', async ({ page }) => {
  const errors = await open(page);
  const ids = await page.evaluate(() => window.__RTJ_TEST__.sections());
  expect(ids.length).toBeGreaterThanOrEqual(16);
  await page.click('#railBody button[data-go="view-patterns"]');
  expect(await page.evaluate(() => window.__RTJ_TEST__.activeSection())).toBe('view-patterns');
  expect(await page.evaluate(() => location.hash)).toBe('#view-patterns');
  await page.goBack().catch(() => {});
  await page.goto(fileUrl + '#view-evidence', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__RTJ_TEST__));
  expect(await page.evaluate(() => window.__RTJ_TEST__.activeSection())).toBe('view-evidence');
  await page.keyboard.press('/');
  expect(await page.evaluate(() => document.activeElement.id)).toBe('q');
  const progress = await page.textContent('#progressText');
  expect(progress).toMatch(/^\d+\/\d+$/);
  expect(errors).toEqual([]);
});

test('search finds products, patterns and evidence, and reports an empty state', async ({ page }) => {
  const errors = await open(page);
  await page.fill('#q', 'cold start');
  await page.waitForSelector('#qPanel .res');
  const hits = await page.$$eval('#qPanel .res', els => els.map(e => e.textContent));
  expect(hits.length).toBeGreaterThan(0);
  await page.fill('#q', 'zzzznotathing');
  await expect(page.locator('#qPanel .empty')).toBeVisible();
  await page.fill('#q', 'geospatial');
  await page.waitForSelector('#qPanel .res');
  await page.locator('#qPanel .res').first().click();
  expect(await page.evaluate(() => window.__RTJ_TEST__.activeSection())).not.toBe('view-start');
  expect(await page.inputValue('#q')).toBe('');
  expect(errors).toEqual([]);
});

test('the architect evaluates a template, explains rejections, and can say no', async ({ page }) => {
  const errors = await open(page, '#view-architect');
  await page.click('[data-tpl="tpl-geo-batch"]');
  await page.waitForTimeout(250);
  const state = await page.evaluate(() => {
    const ev = window.__RTJ_TEST__.evaluate();
    return { pref: ev.preferred && ev.preferred.id, cost: ev.preferred && ev.preferred.cost.monthly,
      feasible: ev.counts.feasible, rejected: ev.counts.rejected, reasons: ev.rejected.slice(0, 3).map(r => r.violations[0].message) };
  });
  expect(state.feasible).toBeGreaterThan(0);
  expect(state.rejected).toBeGreaterThan(0);
  state.reasons.forEach(r => expect(r.length).toBeGreaterThan(20));
  // a native toolchain must not be answered with an ordinary Worker
  const workerSurvived = await page.evaluate(() => window.__RTJ_TEST__.evaluate().feasible.some(r => r.pattern.nodes.some(n => n.id === 'cf-workers' && n.role === 'compute')));
  expect(workerSurvived).toBe(false);
  await expect(page.locator('#archResults .verdictBar')).toBeVisible();
  await expect(page.locator('#archResults .card').first()).toBeVisible();
  // the impossible case is reported as such
  await page.evaluate(() => window.__RTJ_TEST__.setReq({ workloadType: 'ai-inference', latency: 'realtime', trigger: 'http', gpu: true, memoryMB: 8192, availability: 'always-on' }));
  await page.waitForTimeout(200);
  const none = await page.evaluate(() => window.__RTJ_TEST__.evaluate().preferred);
  expect(none).toBeNull();
  await expect(page.locator('#archResults')).toContainText('No feasible topology');
  expect(errors).toEqual([]);
});

test('comparison renders cards and a side-by-side table', async ({ page }) => {
  const errors = await open(page, '#view-compare');
  await page.evaluate(() => window.__RTJ_TEST__.navigate('view-architect'));
  await page.click('[data-tpl="tpl-auth-crud"]');
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__RTJ_TEST__.navigate('view-compare'));
  const cards = await page.locator('#compareGrid .card').count();
  expect(cards).toBeGreaterThanOrEqual(2);
  const table = await page.locator('#compareSide table tbody tr').count();
  expect(table).toBeGreaterThanOrEqual(10);
  await expect(page.locator('#compareSide')).toContainText('Side by side');
  await expect(page.locator('#compareSide')).toContainText('Feasibility');
  expect(errors).toEqual([]);
});

test('the topology inspector draws real edges and lists them', async ({ page }) => {
  const errors = await open(page, '#view-diagram');
  const info = await page.evaluate(() => {
    const svg = document.querySelector('#diagramHost svg');
    return { nodes: document.querySelectorAll('#diagramHost .dg-node').length,
      edges: document.querySelectorAll('#diagramHost .dg-edge').length,
      labels: Array.from(document.querySelectorAll('#diagramHost .dg-elabel')).slice(0, 3).map(e => e.textContent),
      rows: document.querySelectorAll('#diagramHost table').length };
  });
  expect(info.nodes).toBeGreaterThan(0);
  expect(info.rows).toBeGreaterThanOrEqual(2);
  // every drawn edge corresponds to a declared edge in the model
  const declared = await page.evaluate(() => {
    const p = window.__RTJ_TEST__.core.patternById('cf-static-worker');
    return p.edges.length;
  });
  expect(info.edges).toBe(declared);
  await page.click('#diagramPicker [data-dpat="cf-queue-pipeline"]');
  await page.waitForTimeout(150);
  const after = await page.locator('#diagramHost .dg-node').count();
  expect(after).toBe(4);
  expect(errors).toEqual([]);
});

test('cost model computes, separates fixed from usage, and de-duplicates pools', async ({ page }) => {
  const errors = await open(page, '#view-cost');
  await page.fill('#ci-jobsPerMonth', '500');
  await page.fill('#ci-minutesPerJob', '20');
  await page.selectOption('#ci-repoVis', 'private');
  await page.waitForTimeout(200);
  await expect(page.locator('#costOut')).toContainText('Runner minutes');
  const gh = await page.evaluate(() => {
    const c = window.__RTJ_TEST__.core;
    return c.ghCost({ plan: 'free', repoVis: 'private', runner: 'linux_2', jobsPerMonth: 500, minutesPerJob: 20 });
  });
  expect(gh.billableMinutes).toBe(8000);
  await page.selectOption('#ci-repoVis', 'public');
  await page.waitForTimeout(200);
  const pub = await page.evaluate(() => window.__RTJ_TEST__.core.ghCost({ plan: 'free', repoVis: 'public', runner: 'linux_2', jobsPerMonth: 500, minutesPerJob: 20 }));
  expect(pub.monthly).toBe(0);
  await page.fill('#ci-requests', '15000000');
  await page.fill('#ci-cpuMs', '40000000');
  await page.waitForTimeout(200);
  await expect(page.locator('#costPoolsHost')).toContainText('counted once');
  const pools = await page.evaluate(() => window.__RTJ_TEST__.core.cfPools({ requests: 15000000, cpuMs: 40000000 }));
  expect(Object.keys(pools).length).toBe(2);
  expect(pools.requests.meters.length).toBe(1);
  expect(errors).toEqual([]);
});

test('break-even and sensitivity answer with boundaries, not false constants', async ({ page }) => {
  const errors = await open(page, '#view-breakeven');
  await expect(page.locator('#beForm')).toBeVisible();
  await expect(page.locator('#beTable')).toContainText('Cost at each sampled point');
  await page.selectOption('#beF', 'durationMin');
  await page.waitForTimeout(250);
  const rows = await page.locator('#beTable tbody tr').count();
  expect(rows).toBeGreaterThanOrEqual(8);
  const chart = await page.locator('#beChart svg path.series-a').count();
  expect(chart).toBe(1);
  // With a public repository and a free-tier workload both sides model to zero,
  // and the page says so rather than inventing a crossover.
  await page.selectOption('#beA', 'gh-cron-batch');
  await page.selectOption('#beB', 'cf-cron-ingest-d1');
  await page.selectOption('#beF', 'frequencyPerMonth');
  await page.waitForTimeout(300);
  await expect(page.locator('#beTable')).toContainText('Both options model to zero here');
  // Make the GitHub side genuinely billable and a boundary must appear.
  await page.evaluate(() => window.__RTJ_TEST__.setCostInput('repoVis', 'private'));
  await page.waitForTimeout(350);
  const beText = await page.textContent('#beTable');
  expect(beText).toMatch(/A crossover exists|No crossover in this range/);
  if (/A crossover exists/.test(beText)) {
    await expect(page.locator('#beChart svg line.cross')).toHaveCount(1);
    const resolution = beText.match(/found (between [\d,]+ and [\d,]+)/);
    expect(resolution).not.toBeNull();
  }
  await page.evaluate(() => window.__RTJ_TEST__.setCostInput('repoVis', 'public'));
  await page.waitForTimeout(250);
  // sensitivity: the gaps list names what would change the answer
  await page.evaluate(() => window.__RTJ_TEST__.navigate('view-architect'));
  await page.click('[data-tpl="tpl-static-site"]');
  await page.waitForTimeout(250);
  const gaps = await page.evaluate(() => window.__RTJ_TEST__.evaluate().gaps);
  expect(Array.isArray(gaps)).toBe(true);
  if (gaps.length) await expect(page.locator('#archResults')).toContainText('What would change this answer');
  expect(errors).toEqual([]);
});

test('TCO separates platform cost from time and migration effort', async ({ page }) => {
  const errors = await open(page, '#view-tco');
  await page.fill('#tco-labourRatePerHour', '120');
  await page.waitForTimeout(250);
  await expect(page.locator('#tcoOut')).toContainText('Total cost of ownership');
  await expect(page.locator('#tcoOut')).toContainText('this workbench’s estimates');
  await expect(page.locator('#tcoOut')).toContainText('does not include');
  const rows = await page.locator('#tcoOut tbody tr').count();
  expect(rows).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('constraint trees walk to a leaf that names an alternative', async ({ page }) => {
  const errors = await open(page, '#view-constraints');
  await page.click('#treePicker [data-tree="tree-duration"]');
  await page.waitForTimeout(150);
  const q1 = await page.textContent('#treeHost .treeQ');
  expect(q1.length).toBeGreaterThan(10);
  await page.click('#treeHost .treeAns .seg:nth-child(1)');
  await page.waitForTimeout(150);
  const q2 = await page.textContent('#treeHost .treeQ');
  expect(q2.length).toBeGreaterThan(10);
  await page.click('#treeHost .treeAns .seg:nth-child(1)');
  await page.waitForTimeout(150);
  await expect(page.locator('#treeHost .callout')).toBeVisible();
  await expect(page.locator('#treeHost .treeTrail')).toContainText('Path:');
  const refs = await page.$$eval('#treeHost a[href]', a => a.map(x => x.getAttribute('href')));
  expect(refs.length).toBeGreaterThan(0);
  refs.forEach(h => expect(h).toMatch(/^(github-actions-playground|cloudflare-developer-playground)\.html#view-[a-z0-9-]+$/));
  await page.click('#treeRestart');
  await page.waitForTimeout(150);
  expect(await page.textContent('#treeHost .treeQ')).toBe(q1);
  expect(errors).toEqual([]);
});

test('the scenario library filters, loads into the architect, and shows where the engine disagrees', async ({ page }) => {
  const errors = await open(page, '#view-scenarios');
  const total = await page.locator('#scenarioList article').count();
  expect(total).toBeGreaterThanOrEqual(30);
  await page.click('[data-sc="illustrative"]');
  await page.waitForTimeout(250);
  const filtered = await page.locator('#scenarioList article').count();
  expect(filtered).toBeLessThan(total);
  expect(filtered).toBeGreaterThan(0);
  await page.click('[data-sc="all"]');
  await page.waitForTimeout(250);
  await expect(page.locator('#scenarioList article').first()).toContainText('The architect, run on these assumptions, returns');
  await page.locator('#scenarioList [data-load-scenario]').first().click();
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.__RTJ_TEST__.activeSection())).toBe('view-architect');
  expect(await page.evaluate(() => Object.keys(window.__RTJ_TEST__.req()).length)).toBeGreaterThan(15);
  expect(errors).toEqual([]);
});

test('project reviews carry a verdict, evidence and a confidence', async ({ page }) => {
  const errors = await open(page, '#view-projects');
  const cards = await page.locator('#projectList article').count();
  expect(cards).toBeGreaterThanOrEqual(7);
  const ids = await page.$$eval('#projectList article', els => els.map(e => e.id));
  ['overhead', 'cflab', 'fruiting-forecast', 'junkdrawer', 'collecting-nichols'].forEach(id => expect(ids).toContain(id));
  const text = await page.textContent('#projectList');
  expect(text).toContain('Verified present architecture');
  expect(text).toContain('Confidence:');
  expect(text).toContain('keep');
  // no credential-shaped content leaked into a review
  expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
  expect(text).not.toMatch(/[0-9a-f]{32}/);
  expect(errors).toEqual([]);
});

test('scenarios serialise, export and import through real validation', async ({ page }) => {
  const errors = await open(page, '#view-saved');
  await page.evaluate(() => { window.__RTJ_TEST__.clearSaved(); window.__RTJ_TEST__.saveScenario('spec scenario'); });
  await page.waitForTimeout(150);
  const payload = await page.evaluate(() => window.__RTJ_TEST__.exportPayload());
  expect(payload.format).toBe('rtj-scenario');
  expect(payload.version).toBe(1);
  expect(payload.scenarios.length).toBe(1);
  expect(JSON.stringify(payload)).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
  await page.evaluate(() => window.__RTJ_TEST__.clearSaved());
  await page.evaluate(text => window.__RTJ_TEST__.importText(text), JSON.stringify(payload));
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__RTJ_TEST__.saved().length)).toBe(1);
  await expect(page.locator('#savedList')).toContainText('spec scenario');
  // a hostile file is rejected rather than trusted
  await page.evaluate(() => window.__RTJ_TEST__.clearSaved());
  await page.evaluate(() => window.__RTJ_TEST__.importText(JSON.stringify({ format: 'rtj-scenario', version: 1, req: { workloadType: 'other', apiToken: 'x' } })));
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__RTJ_TEST__.saved().length)).toBe(0);
  await page.evaluate(() => window.__RTJ_TEST__.importText('{ not json'));
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__RTJ_TEST__.saved().length)).toBe(0);
  expect(errors).toEqual([]);
});

test('saved scenarios and the theme survive a reload', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => { window.__RTJ_TEST__.clearSaved(); window.__RTJ_TEST__.saveScenario('persist me'); window.__RTJ_TEST__.setTheme('dark'); window.__RTJ_TEST__.bookmark('view-method'); });
  await page.waitForTimeout(250);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__RTJ_TEST__));
  expect(await page.evaluate(() => window.__RTJ_TEST__.saved().length)).toBe(1);
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
  expect(await page.evaluate(() => window.__RTJ_TEST__.state().bm)).toContain('view-method');
  await page.evaluate(() => window.__RTJ_TEST__.clearSaved());
  expect(errors).toEqual([]);
});

test('theme is light by default and system is opt-in', async ({ page }) => {
  const errors = await open(page);
  expect(await page.evaluate(() => window.__RTJ_TEST__.theme())).toBe('light');
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
  await page.selectOption('#themeSel', 'system');
  await page.waitForTimeout(150);
  const effective = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  expect(['light', 'dark']).toContain(effective);
  await page.selectOption('#themeSel', 'light');
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
  expect(errors).toEqual([]);
});

test('evidence and sources are traceable and dated', async ({ page }) => {
  const errors = await open(page, '#view-evidence');
  const rows = await page.locator('#evidenceTable tbody tr').count();
  expect(rows).toBeGreaterThanOrEqual(40);
  await expect(page.locator('#evidenceSummary')).toContainText('hard gates enforced');
  await page.click('[data-ev="judgement"]');
  await page.waitForTimeout(250);
  const judged = await page.locator('#evidenceTable tbody tr').count();
  expect(judged).toBeGreaterThan(0);
  expect(judged).toBeLessThan(rows);
  await page.click('[data-ev="all"]');
  await page.waitForTimeout(200);
  const links = await page.$$eval('#evidenceTable a[href]', a => a.map(x => x.href));
  expect(links.length).toBeGreaterThan(0);
  // Official sources are https on the documented domains; the companion manuals
  // and local configuration files resolve to relative paths, which is also correct.
  const OFFICIAL = /^https:\/\/(developers\.cloudflare\.com|docs\.github\.com|www\.cloudflare\.com)\//;
  const LOCAL = /(github-actions-playground|cloudflare-developer-playground)\.html$/;
  links.forEach(h => expect(OFFICIAL.test(h) || LOCAL.test(h), h).toBe(true));
  expect(links.some(h => OFFICIAL.test(h))).toBe(true);
  await page.evaluate(() => window.__RTJ_TEST__.navigate('view-sources'));
  await expect(page.locator('#sourcesList')).toContainText('read 2026-10-10');
  await expect(page.locator('#methodDetail')).toContainText('How a recommendation is produced');
  await expect(page.locator('#methodDetail')).toContainText('What is deliberately not known');
  expect(errors).toEqual([]);
});

test('cross-manual deep links point at real sections of the companion manuals', async ({ page }) => {
  const errors = await open(page, '#view-patterns');
  const hrefs = await page.$$eval('#patternList a[href]', a => a.map(x => x.getAttribute('href')));
  expect(hrefs.length).toBeGreaterThan(0);
  const seen = {};
  const fs = require('fs');
  for (const h of hrefs) {
    const [file, frag] = h.split('#');
    expect(['github-actions-playground.html', 'cloudflare-developer-playground.html']).toContain(file);
    if (!seen[file]) seen[file] = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
    expect(seen[file]).toContain('id="' + frag + '"');
  }
  expect(errors).toEqual([]);
});

test('accessibility basics: landmarks, names, focus order and live regions', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('a.skip')).toHaveAttribute('href', '#main');
  await expect(page.locator('main#main')).toHaveCount(1);
  await expect(page.locator('nav.rail')).toHaveAttribute('aria-label', 'Workbench sections');
  await expect(page.locator('#liveRegion')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#q')).toHaveAttribute('aria-label', 'Search the workbench');
  await expect(page.locator('#themeSel')).toHaveAttribute('aria-label', 'Theme');
  // every rail button has an accessible name and the current one is marked
  const unnamed = await page.$$eval('#railBody button[data-go]', els => els.filter(e => !e.textContent.trim()).length);
  expect(unnamed).toBe(0);
  expect(await page.locator('#railBody button[aria-current="page"]').count()).toBe(1);
  // diagrams carry a text alternative
  const label = await page.getAttribute('#diagramHost svg', 'aria-label');
  expect(label && label.length).toBeGreaterThan(10);
  // headings are hierarchical enough to navigate
  const h1s = await page.locator('main .view.active h1').count();
  expect(h1s).toBeLessThanOrEqual(2);
  // a control is reachable and operable by keyboard
  await page.keyboard.press('/');
  expect(await page.evaluate(() => document.activeElement.id)).toBe('q');
  await page.keyboard.type('d1');
  await page.waitForSelector('#qPanel .res');
  await page.keyboard.press('ArrowDown');
  expect(await page.locator('#qPanel .res[data-active="1"]').count()).toBe(1);
  await page.keyboard.press('Escape');
  expect(await page.inputValue('#q')).toBe('');
  expect(errors).toEqual([]);
});

test('layouts hold at phone, tablet and desktop widths', async ({ page }) => {
  const errors = await open(page, '#view-architect');
  for (const [w, h, label] of [[380, 780, 'phone'], [834, 1000, 'tablet'], [1440, 950, 'desktop']]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, label + ' horizontal overflow').toBeLessThanOrEqual(2);
    const railVisible = await page.locator('#rail').isVisible();
    expect(railVisible, label + ' rail visible').toBe(true);
  }
  await page.setViewportSize({ width: 380, height: 780 });
  await page.click('#railToggle');
  await page.waitForTimeout(150);
  expect(await page.locator('#railBody').isVisible()).toBe(false);
  await page.click('#railToggle');
  await page.waitForTimeout(150);
  expect(await page.locator('#railBody').isVisible()).toBe(true);
  expect(errors).toEqual([]);
});

test('wide tables scroll inside their own wrapper, not the page', async ({ page }) => {
  const errors = await open(page, '#view-candidates');
  await page.setViewportSize({ width: 800, height: 900 });
  await page.waitForTimeout(200);
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow).toBeLessThanOrEqual(2);
  const wrapped = await page.evaluate(() => {
    const t = document.querySelector('#candidateTable table');
    const box = t.closest('.scrollX');
    return box ? box.scrollWidth - box.clientWidth : -1;
  });
  expect(wrapped).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('the print stylesheet forces the light palette and hides chrome', async ({ page }) => {
  const errors = await open(page, '#view-start');
  await page.evaluate(() => window.__RTJ_TEST__.setTheme('dark'));
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(150);
  const bar = await page.locator('.bar').isVisible();
  expect(bar).toBe(false);
  const views = await page.locator('main .view').evaluateAll(els => els.filter(e => getComputedStyle(e).display !== 'none').length);
  expect(views).toBeGreaterThan(1);
  await page.emulateMedia({ media: 'screen' });
  expect(errors).toEqual([]);
});

test('the page still works when the shared storage helper is unavailable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // Blocking the helper on purpose produces a resource-load error; what this test asserts is that no page error follows from its absence.
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route('**/api/analytics/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.route('**analytics-lite.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* analytics stubbed in tests */' }));
  await page.route('**jd-storage.js', r => r.abort());
  await page.goto(fileUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__RTJ_TEST__));
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => typeof window.JDStorage)).toBe('undefined');
  // the engine, the rendering and the persistence all still work
  expect(await page.evaluate(() => window.__RTJ_TEST__.evaluate().preferred !== null)).toBe(true);
  await page.evaluate(() => { window.__RTJ_TEST__.clearSaved(); window.__RTJ_TEST__.saveScenario('no helper'); });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__RTJ_TEST__.saved().length)).toBe(1);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__RTJ_TEST__));
  expect(await page.evaluate(() => window.__RTJ_TEST__.saved().length)).toBe(1);
  await page.evaluate(() => window.__RTJ_TEST__.clearSaved());
  expect(errors).toEqual([]);
});
