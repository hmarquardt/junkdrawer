const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const PAGE = `file://${path.resolve(process.cwd(), 'ui-berry-3r-mhtml-workbench.html')}`;
const FIXTURE = path.resolve(process.cwd(), 'tests/fixtures/berry3r/synthetic-task.mhtml');
const REAL_FIXTURE = process.env.BERRY3W_REAL_FIXTURE || '';
const BOOKMARKLET = "(()=>{document.querySelectorAll('[id*=\"feather_proxy_banner\"]').forEach(e=>e.remove());document.documentElement.style.paddingTop='0';document.body.style.paddingTop='0';document.body.style.marginTop='0';})()";

test.use({ channel: 'chrome' });
test.describe.configure({ mode: 'serial' });

async function open(page) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.route('**/api/analytics/**', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**openrouter.ai**', r => r.abort());
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__BERRY3W_TEST__));
  return errors;
}
async function uploadSynthetic(page) {
  await page.setInputFiles('#fileInput', FIXTURE);
  await page.waitForFunction(() => window.__BERRY3W_TEST__.state().archive !== null, null, { timeout: 60000 });
}
const wordFiller = n => Array.from({ length: n }, (_, i) => 'detail' + (i + 1)).join(' ');
function reason(open, extra, total = 60) {
  const text = open + ' ' + extra;
  const have = text.trim().split(/\s+/).length;
  return have >= total ? text.trim() : (text + ' ' + wordFiller(total - have)).trim();
}

test('loads with no console errors and exposes its test hook', async ({ page }) => {
  const errors = await open(page);
  expect(await page.evaluate(() => typeof window.__BERRY3W_TEST__)).toBe('object');
  await expect(page.locator('#bmDrag')).toHaveAttribute('href', /^javascript:/);
  expect(await page.textContent('#verLabel')).toContain('2026.');
  expect(errors).toEqual([]);
});

test('ingests the captured fixture and resolves candidates and Before/After by Content-ID', async ({ page }) => {
  const errors = await open(page);
  await uploadSynthetic(page);
  const s = await page.evaluate(() => {
    const st = window.__BERRY3W_TEST__.state();
    const m = st.archive.mapping;
    return {
      partCount: st.archive.partCount,
      confidence: m.confidence,
      A: { cmp: m.candidates.A.comparison.part, before: m.candidates.A.before.part, after: m.candidates.A.after.part, method: m.candidates.A.before.method },
      B: { cmp: m.candidates.B.comparison.part, before: m.candidates.B.before.part, after: m.candidates.B.after.part, method: m.candidates.B.before.method },
      taskPart: m.task.part,
      taskMethod: m.task.method,
      evidence: { abefore: st.archive.evidence.A.before.part.number, aafter: st.archive.evidence.A.after.part.number, bbefore: st.archive.evidence.B.before.part.number, bafter: st.archive.evidence.B.after.part.number },
      warnings: st.archive.warnings,
      missing: st.archive.missing,
      parts: st.archive.parts.length,
      orphanListed: st.archive.parts.some(p => p.cid === 'frame-ORPHAN000@mhtml.blink'),
      alternatives: st.archive.mapping.alternatives.length
    };
  });
  expect(s.partCount).toBe(10);
  expect(s.parts).toBe(10);
  expect(s.confidence).toBeGreaterThan(0.9);
  expect(s.taskPart).toBe(1);
  expect(s.taskMethod).toContain('Snapshot-Content-Location');
  // the fixture stores the candidate documents out of A/B order on purpose
  expect(s.A.before).toBe(7);
  expect(s.A.after).toBe(9);
  expect(s.B.before).toBe(8);
  expect(s.B.after).toBe(6);
  expect(s.A.method).toBe('iframe title attribute');
  expect(s.evidence).toEqual({ abefore: 7, aafter: 9, bbefore: 8, bafter: 6 });
  // both dangling stylesheet references are reported, and the unreferenced frame is still listed
  expect(s.missing.map(m => m.cid).sort()).toEqual(['css-missingA@mhtml.blink', 'css-missingB@mhtml.blink']);
  expect(s.orphanListed).toBe(true);
  expect(s.alternatives).toBe(8);
  expect(s.warnings).toEqual([]);
  expect(errors).toEqual([]);
});

test('keeps the original request verbatim and never replaces it with a translation', async ({ page }) => {
  await open(page);
  await uploadSynthetic(page);
  const before = await page.evaluate(() => window.__BERRY3W_TEST__.state().request.text);
  expect(before).toBe('接下来自行加载已有公开原著文本');
  const after = await page.evaluate(() => {
    window.__BERRY3W_TEST__.state().request.translation = 'Next, load the existing publicly available original text yourself.';
    const s = window.__BERRY3W_TEST__.state();
    return { text: s.request.text, translation: s.request.translation, edited: s.request.edited };
  });
  expect(after.text).toBe('接下来自行加载已有公开原著文本');
  expect(after.translation).toContain('load the existing publicly available');
  expect(after.edited).toBe(false);
  expect(after.text).not.toMatch(/\uFFFD/);
});


test('decodes identical embedded payloads once and diffs Before to After', async ({ page }) => {
  await open(page);
  await uploadSynthetic(page);
  const s = await page.evaluate(() => {
    const st = window.__BERRY3W_TEST__.state();
    const emb = st.archive.evidence.A.after.embedded;
    return {
      unique: emb.length,
      occurrences: emb[0].occurrences,
      kind: emb[0].kind,
      sameBefore: st.comparison.A.before.embedded[0].bytes === st.comparison.B.before.embedded[0].bytes,
      addedA: st.comparison.A.cjkAdded,
      addedB: st.comparison.B.cjkAdded,
      probesA: window.__BERRY3W_TEST__.changedProbes(st.comparison.A).map(p => p.key),
      probesB: window.__BERRY3W_TEST__.changedProbes(st.comparison.B).map(p => p.key),
      bundleDeltaA: window.__BERRY3W_TEST__.diffStates(st.archive.evidence.A.before, st.archive.evidence.A.after).bundleDelta
    };
  });
  expect(s.unique).toBe(1);
  expect(s.occurrences).toBeGreaterThan(1);
  expect(s.kind).toBe('html');
  expect(s.sameBefore).toBe(true);
  expect(s.addedA.join(' ')).toContain('公开正文 HTTPS 地址');
  expect(s.addedB.join(' ')).toContain('在线来源自动检索与导入');
  expect(s.probesA).toContain('urlFetch');
  expect(s.probesB).toContain('openArchive');
  expect(s.bundleDeltaA).toBeGreaterThan(0);
});

test('reports malformed archives instead of crashing', async ({ page }) => {
  const errors = await open(page);
  const outcome = await page.evaluate(async () => {
    const t = window.__BERRY3W_TEST__;
    const bad = new File([new TextEncoder().encode('this is not a capture at all')], 'bad.mhtml');
    await t.handleFile(bad);
    const garbageStatus = document.getElementById('parseStatus').textContent;
    const garbageError = t.errBuffer().some(e => e.component === 'parser');
    const truncated = new File([new TextEncoder().encode('From: <Saved by Blink>\r\nContent-Type: multipart/related; boundary="X"\r\n\r\n--X\r\nContent-Type: text/html\r\n\r\nhello')], 'trunc.mhtml');
    await t.handleFile(truncated);
    const truncatedStatus = document.getElementById('parseStatus').textContent;
    const dangling = 'From: <Saved by Blink>\r\nSnapshot-Content-Location: https://x.invalid/tasks/abc\r\nContent-Type: multipart/related; boundary="Y"\r\n\r\n--Y\r\nContent-Type: text/html\r\nContent-Transfer-Encoding: 7bit\r\nContent-Location: https://x.invalid/tasks/abc\r\n\r\n<!doctype html><html><body><iframe src="cid:frame-NOPE@mhtml.blink"></iframe></body></html>\r\n--Y--\r\n';
    const missingFrame = await t.parseFile(new File([new TextEncoder().encode(dangling)], 'missing.mhtml')).then(() => 'ok').catch(e => e.message);
    return { garbageStatus, garbageError, truncatedStatus, missingFrame };
  });
  expect(outcome.garbageStatus).toContain('Parse failed');
  expect(outcome.garbageError).toBe(true);
  expect(outcome.truncatedStatus).toMatch(/Parse failed|Parsed/);
  expect(outcome.missingFrame).toContain('no resolvable candidate frames');
  expect(errors).toEqual([]);
});

test('applies the rubric rule checks to both fields', async ({ page }) => {
  await open(page);
  await uploadSynthetic(page);
  const results = await page.evaluate(() => {
    const t = window.__BERRY3W_TEST__;
    const codes = (dim, option, text, tieScale) => {
      t.state().decisions[dim] = { option, reason: text, tieScale };
      return t.validateAll().findings.map(f => f.code);
    };
    return {
      short: codes('satisfaction', 'A is better', 'Website A is better because it works.'),
      wrongOpening: codes('satisfaction', 'B is better', 'Website A is better because the search updates the listings and every requested section is present in the page body.'),
      aesthetics: codes('satisfaction', 'A is better', 'Website A is better because its palette is cleaner, its typography is elegant and its spacing is tidier than the crowded layout of Website B.'),
      badNaming: codes('satisfaction', 'A is better', 'Site A is better because the requested filters update the panel while Page B leaves its tabs dead and its form missing from the page entirely.'),
      bareLetter: codes('satisfaction', 'A is better', 'A is better because the request is met and B leaves the booking form missing from the page while its tabs do nothing at all.'),
      overallNoWeigh: codes('overall', 'B is better', 'Website B is better because its filters update the listings and its booking form submits correctly. Website A hides its form below a cluttered layout with cramped typography, misaligned blocks and cut-off labels.'),
      overallGood: codes('overall', 'B is better', 'Website B is better because its requested filters and booking form update the page while Website A, although tidier in layout and typography, leaves its category tabs dead, so the functional loss matters more here.'),
      tieThreshold: codes('satisfaction', 'Both are good', 'Website A and Website B are tied as good options because both update the panel and the listing, and both keep their typography and spacing readable.', 2),
      tieWinner: codes('satisfaction', 'Both are bad', 'Website A and Website B are tied as bad options because Website A is better at loading its content while the Website B filters never update anything at all.', 2),
      mojibake: codes('satisfaction', 'A is better', 'Website A is better because the request is met while Website B shows a broken rÃ©sumÃ© section and its tabs never update the panel below at all.')
    };
  });
  expect(results.short).toContain('word-min');
  expect(results.wrongOpening).toContain('opening-outcome');
  expect(results.aesthetics).toContain('aesthetics');
  expect(results.badNaming).toContain('label');
  expect(results.bareLetter).toContain('bare-letter');
  expect(results.overallNoWeigh).toContain('no-weighing');
  expect(results.overallGood).not.toContain('no-weighing');
  expect(results.tieThreshold).toContain('tie-threshold');
  expect(results.tieWinner).toContain('tie-winner');
  expect(results.mojibake).toContain('characters');
});

test('blocks unsupported behaviour claims until a live observation exists', async ({ page }) => {
  await open(page);
  await uploadSynthetic(page);
  const status = await page.evaluate(() => {
    const t = window.__BERRY3W_TEST__;
    const sat = t.state().decisions.satisfaction;
    sat.option = 'B is better';
    sat.reason = "Website B is better because the requested import panel now loads text from a public source and the chapter mapping updates the reader panel below.";
    const blocked = t.validateAll().findings.filter(f => f.code === 'unverified-claim').map(f => f.field);
    t.state().verification = [{ id: 'v1', site: 'B', question: 'Does the import panel load a public source?', why: 'the archive cannot prove it', status: 'confirmed working', note: 'Pasted a public-domain URL and the reader filled with chapters.', source: 'manual' }];
    t.refreshFacts();
    const after = t.validateAll().findings.filter(f => f.code === 'unverified-claim').map(f => f.field);
    return { blocked, after, humanFacts: t.state().facts.B.filter(f => f.conf === 'HUMAN').length };
  });
  expect(status.blocked).toContain('satisfaction');
  expect(status.after).toEqual([]);
  expect(status.humanFacts).toBeGreaterThan(0);
});

test('records human overrides on the requirement matrix', async ({ page }) => {
  await open(page);
  await uploadSynthetic(page);
  const before = await page.evaluate(() => {
    const st = window.__BERRY3W_TEST__.state();
    const derived = st.requirements.find(r => r.hypothesis) || st.requirements[0];
    return { id: derived.id, status: derived['status' + 'A'], count: st.requirements.length, verification: st.verification.length, hypothesis: derived.hypothesis, text: derived.text };
  });
  expect(before.count).toBeGreaterThan(1);
  expect(before.verification).toBeGreaterThan(0);
  expect(before.hypothesis).toBe(true);
  expect(before.text.length).toBeGreaterThan(10);
  await page.evaluate(() => window.__BERRY3W_TEST__.switchView('compare'));
  // the matrix now lives in an expandable detail section, so open it like an operator would
  await page.evaluate(() => { const d = document.querySelector('#reqTable').closest('details'); if (d) d.open = true; });
  await page.selectOption(`select[data-req-status="${before.id}"][data-site="A"]`, 'human confirmed');
  const after = await page.evaluate(id => {
    const r = window.__BERRY3W_TEST__.state().requirements.find(x => x.id === id);
    return { status: r.statusA, override: r.overrides && r.overrides.A, hypothesis: r.hypothesis, facts: window.__BERRY3W_TEST__.state().facts.A.filter(f => f.conf === 'HUMAN').length };
  }, before.id);
  expect(after.status).toBe('human confirmed');
  expect(after.override.to).toBe('human confirmed');
  expect(after.override.by).toBe('operator');
  expect(after.override.from).toContain('archive-derived');
  expect(after.hypothesis).toBe(false);
  expect(after.facts).toBeGreaterThan(0);
});

test('autosaves and recovers a task across a reload', async ({ page }) => {
  await open(page);
  await uploadSynthetic(page);
  await page.evaluate(() => {
    const t = window.__BERRY3W_TEST__;
    t.state().decisions.satisfaction = { option: 'B is better', reason: 'Website B is better because the requested import flow is present and the reader maps the chapters to the source text, while Website A leaves the import panel unbuilt and its chapter list empty.' };
    return t.saveTask('manual');
  });
  await page.waitForFunction(() => window.__BERRY3W_TEST__.state().historyId !== null);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__BERRY3W_TEST__));
  await page.waitForFunction(() => window.__BERRY3W_TEST__.state().historyId !== null, null, { timeout: 20000 });
  const recovered = await page.evaluate(() => {
    const s = window.__BERRY3W_TEST__.state();
    return { option: s.decisions.satisfaction.option, reasonLength: s.decisions.satisfaction.reason.length, requirements: s.requirements.length, evidence: !!(s.archive && s.archive.evidence.A.after), fileName: s.fileName, parts: s.archive ? s.archive.partCount : 0 };
  });
  expect(recovered.option).toBe('B is better');
  expect(recovered.reasonLength).toBeGreaterThan(40);
  expect(recovered.requirements).toBeGreaterThan(1);
  expect(recovered.evidence).toBe(true);
  expect(recovered.parts).toBe(10);
  // the record keeps the filename; the archived file itself is never persisted
  expect(recovered.fileName).toBe('synthetic-task.mhtml');
  expect(await page.evaluate(() => window.__BERRY3W_TEST__.state().file === null)).toBe(true);
});

test('exports and re-imports tasks without credentials and keeps tasks isolated', async ({ page }) => {
  await open(page);
  await uploadSynthetic(page);
  const out = await page.evaluate(async () => {
    const t = window.__BERRY3W_TEST__;
    t.settings().apiKey = 'sk-or-v1-secretsecretsecret';
    t.state().task.id = 'task-xyz';
    t.state().decisions.overall = { option: 'A is better', reason: 'Website A is better because its import panel is present and its chapter list updates with the loaded text.' };
    await t.saveTask('manual');
    const rec = t.buildRecord();
    const json = JSON.stringify(rec);
    const before = (await t.idbGetAll('tasks')).length;
    await t.importTask(json);
    const rows = await t.idbGetAll('tasks');
    const imported = rows.find(r => String(r.id).startsWith('i'));
    return { before, after: rows.length, leak: /sk-or-v1-secretsecretsecret/.test(json), importedTaskId: imported ? imported.task.id : null, importedOverall: imported ? imported.decisions.overall.option : null, distinct: imported ? imported.id !== rec.id : false, evidenceKept: imported ? !!imported.archive.parts.length : false };
  });
  expect(out.leak).toBe(false);
  expect(out.after).toBe(out.before + 1);
  expect(out.importedTaskId).toBe('task-xyz');
  expect(out.importedOverall).toBe('A is better');
  expect(out.distinct).toBe(true);
  expect(out.evidenceKept).toBe(true);
});



test('bookmarklet: draggable link, copy fallback and banner fixture', async ({ page }) => {
  await open(page);
  const href = await page.getAttribute('#bmDrag', 'href');
  expect(href.startsWith('javascript:')).toBe(true);
  expect(decodeURIComponent(href.slice('javascript:'.length))).toBe(BOOKMARKLET);
  expect((await page.textContent('#bmCodePreview')).trim()).toBe(BOOKMARKLET);
  const selfTest = await page.evaluate(() => window.__BERRY3W_TEST__.bookmarkletSelfTest());
  expect(selfTest.pass).toBe(true);
  expect(selfTest.bannerRemoved).toBe(true);
  expect(selfTest.canarySurvived).toBe(true);
  await page.click('#bmTest');
  await expect(page.locator('#bmStateChip')).toHaveText('self-test passed');
  // the same code against a realistic banner fixture with injected spacing
  await page.setContent('<!doctype html><html><head><style>html,body{margin:0}</style></head><body>' +
    '<div id="feather_proxy_banner_top" style="height:44px;background:#111;color:#fff">Feather proxy banner</div>' +
    '<main id="page-content"><h1>Candidate page</h1><p>Real content stays.</p></main></body></html>');
  await page.evaluate(() => { document.documentElement.style.paddingTop = '44px'; document.body.style.paddingTop = '44px'; document.body.style.marginTop = '8px'; });
  await page.evaluate(code => { (0, eval)(code); }, BOOKMARKLET);
  const applied = await page.evaluate(() => ({
    banners: document.querySelectorAll('[id*="feather_proxy_banner"]').length,
    htmlPad: document.documentElement.style.paddingTop,
    bodyPad: document.body.style.paddingTop,
    bodyMargin: document.body.style.marginTop,
    content: !!document.getElementById('page-content'),
    text: document.body.innerText.trim().slice(0, 40)
  }));
  expect(applied.banners).toBe(0);
  expect(['', '0', '0px']).toContain(applied.htmlPad);
  expect(['', '0', '0px']).toContain(applied.bodyPad);
  expect(['', '0', '0px']).toContain(applied.bodyMargin);
  expect(applied.content).toBe(true);
  expect(applied.text).toContain('Candidate page');
});

test('sanitized preview strips scripts, handlers and data URLs inside a script-blocked frame', async ({ page }) => {
  await open(page);
  await uploadSynthetic(page);
  await page.evaluate(() => window.__BERRY3W_TEST__.switchView('compare'));
  await page.evaluate(() => { const d = document.querySelector('#previewBody').closest('details'); if (d) d.open = true; });
  await page.evaluate(() => window.__BERRY3W_TEST__.requestPreview('A:after'));
  await page.waitForSelector('iframe.preview', { timeout: 60000 });
  const info = await page.evaluate(async () => {
    const f = document.querySelector('iframe.preview');
    const html = await (await fetch(f.src)).text();
    // the sandboxed frame is a unique origin by design, so the parent cannot read into it:
    // the sanitized document is inspected through the blob it loads instead
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    return {
      sandbox: f.getAttribute('sandbox'),
      sameOriginReadable: !!f.contentDocument,
      scripts: (html.match(/<script/gi) || []).length,
      handlers: (html.match(/\son[a-z]+\s*=/gi) || []).length,
      dataUrls: (html.match(/data:text\/html/gi) || []).length,
      external: (html.match(/(?:href|src)="https?:/gi) || []).length,
      inlinedStyles: (html.match(/<style/gi) || []).length,
      nodes: parsed.querySelectorAll('*').length,
      text: parsed.body ? parsed.body.textContent.replace(/\s+/g, ' ').slice(0, 200) : '',
      navLabels: [...parsed.querySelectorAll('a')].map(a => a.textContent.trim()).filter(Boolean)
    };
  });
  expect(info.sandbox).toBe('');
  expect(info.sameOriginReadable).toBe(false);
  expect(info.scripts).toBe(0);
  expect(info.handlers).toBe(0);
  expect(info.dataUrls).toBe(0);
  expect(info.external).toBe(0);
  expect(info.inlinedStyles).toBeGreaterThan(0);
  expect(info.nodes).toBeGreaterThan(3);
  expect(info.navLabels).toContain('接入原文');
  expect(info.text).toContain('接入原文');
});

test('keeps the main thread responsive while parsing', async ({ page }) => {
  await open(page);
  const ticks = await page.evaluate(async () => {
    let n = 0;
    const timer = setInterval(() => { n++; }, 8);
    await window.__BERRY3W_TEST__.loadDemo();
    clearInterval(timer);
    return n;
  });
  expect(await page.evaluate(() => window.__BERRY3W_TEST__.state().archive.partCount)).toBe(10);
});


test('real 112 MB capture: mapping, request and diff verified', async ({ page }) => {
  test.setTimeout(300000);
  test.skip(!REAL_FIXTURE || !fs.existsSync(REAL_FIXTURE), 'set BERRY3W_REAL_FIXTURE to the captured .mhtml path');
  const errors = await open(page);
  const t0 = Date.now();
  await page.evaluate(() => {
    window.__ticks = 0;
    window.__tickTimer = setInterval(() => { window.__ticks++; }, 16);
  });
  await page.setInputFiles('#fileInput', REAL_FIXTURE);
  await page.waitForFunction(() => window.__BERRY3W_TEST__.state().archive !== null, null, { timeout: 300000 });
  const elapsed = Date.now() - t0;
  const ticks = await page.evaluate(() => { clearInterval(window.__tickTimer); return window.__ticks; });
  // the main thread must stay live: parsing happens in the worker, so timers keep firing
  expect(ticks).toBeGreaterThan(5);
  const s = await page.evaluate(() => {
    const st = window.__BERRY3W_TEST__.state();
    return {
      bytes: st.archive.header.size,
      partCount: st.archive.partCount,
      confidence: st.archive.mapping.confidence,
      A: { cmp: st.archive.mapping.candidates.A.comparison.part, before: st.archive.mapping.candidates.A.before.part, after: st.archive.mapping.candidates.A.after.part },
      B: { cmp: st.archive.mapping.candidates.B.comparison.part, before: st.archive.mapping.candidates.B.before.part, after: st.archive.mapping.candidates.B.after.part },
      request: st.request.text,
      missing: st.archive.missing.length,
      sameBefore: st.comparison.A.before.embedded[0].bytes === st.comparison.B.before.embedded[0].bytes,
      embA: st.archive.evidence.A.after.embedded[0],
      addedA: st.comparison.A.cjkAdded.join(' | '),
      addedB: st.comparison.B.cjkAdded.join(' | '),
      probesA: window.__BERRY3W_TEST__.changedProbes(st.comparison.A).map(p => p.key),
      probesB: window.__BERRY3W_TEST__.changedProbes(st.comparison.B).map(p => p.key),
      headingsA: st.archive.evidence.A.after.state.headings.length
    };
  });
  expect(s.bytes).toBe(112560589);
  expect(s.partCount).toBe(42);
  expect(s.A).toEqual({ cmp: 30, before: 34, after: 37 });
  expect(s.B).toEqual({ cmp: 32, before: 39, after: 41 });
  expect(s.confidence).toBeGreaterThan(0.9);
  expect(s.request).toBe('接下来自行加载已有公开原著文本');
  expect(s.missing).toBe(0);
  expect(s.sameBefore).toBe(true);
  expect(s.embA.occurrences).toBeGreaterThan(30);
  expect(s.embA.bytes).toBeGreaterThan(400000);
  expect(s.addedA).toContain('正文已接入');
  expect(s.addedB).toContain('使用者确认使用权限');
  expect(s.probesA).toContain('bibliographic');
  expect(s.probesB).toContain('openArchive');
  expect(elapsed).toBeLessThan(120000);
  expect(errors).toEqual([]);
});

/* ------------- OpenRouter credential / header hygiene (regression) -------------
   Root cause of "Failed to read the 'headers' property from 'RequestInit': String contains non
   ISO-8859-1 code point.": a key pasted with CJK, an emoji, a typographic quote or a
   non-breaking space was placed straight into the Authorization header, and the platform
   rejects the whole header map before any request leaves the browser. */
const KEY_GOOD = 'sk-or-v1-' + 'a1b2c3d4'.repeat(8);
const KEY_CJK = 'sk-or-v1-abc\u5bc6def\u2019\uD83D\uDD11-0123456789abcdef';
const KEY_NBSP = 'sk-or-v1-a1b2c3d4\u00a0a1b2c3d4a1b2c3d4';
const KEY_ZERO_WIDTH = 'sk-or-v1-a1b2c3d4\u200ba1b2c3d4a1b2c3d4';
const KEY_INNER_SPACE = 'sk-or-v1-a1b2c3d4 a1b2c3d4';
const KEY_SHORT = 'sk-or-v1-abc';
const CATALOGUE = { data: [{ id: 'openai/gpt-4.1-mini', name: 'GPT-4.1 mini' }, { id: 'anthropic/claude-3', name: 'Claude 3' }] };

async function openWithOpenRouter(page, opts = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.route('**/api/analytics/**', r => r.fulfill({ status: 204, body: '' }));
  const sent = [];
  await page.route('**openrouter.ai/api/v1/models', r => {
    sent.push({ kind: 'catalogue', auth: r.request().headers()['authorization'] || null });
    if (opts.catalogueStatus && opts.catalogueStatus !== 200) { r.fulfill({ status: opts.catalogueStatus, body: '{}' }); return; }
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CATALOGUE) });
  });
  await page.route('**openrouter.ai/api/v1/chat/completions', r => {
    sent.push({ kind: 'inference', auth: r.request().headers()['authorization'] || null, title: r.request().headers()['x-title'] || null, model: (r.request().postDataJSON() || {}).model });
    if (opts.inferenceStatus && opts.inferenceStatus !== 200) { r.fulfill({ status: opts.inferenceStatus, body: '{}' }); return; }
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '{"requirements":[]}' } }] }) });
  });
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__BERRY3W_TEST__));
  return { errors, sent };
}
const text = (page, sel) => page.textContent(sel).then(t => (t || '').trim());

test('root cause: the platform itself rejects a non ISO-8859-1 header value before sending', async ({ page }) => {
  await open(page);
  const constructed = await page.evaluate(() => {
    try { new Request('https://openrouter.ai/api/v1/models', { headers: { Authorization: 'Bearer sk-or-v1-\u5bc6' } }); return 'constructed'; }
    catch (e) { return e.name + ': ' + e.message; }
  });
  expect(constructed).toContain('non ISO-8859-1');
  const fetched = await page.evaluate(async () => {
    try { await fetch('https://openrouter.ai/api/v1/models', { headers: { 'X-Title': '\u6807\u9898' } }); return 'sent'; }
    catch (e) { return e.message; }
  });
  expect(fetched).toContain('non ISO-8859-1');
});

test('a Unicode-contaminated key is rejected, never stored, and never reaches a request', async ({ page }) => {
  const { errors, sent } = await openWithOpenRouter(page);
  await page.fill('#apiKey', KEY_CJK);
  const st = await page.evaluate(() => ({
    active: window.__BERRY3W_TEST__.settings().apiKey,
    stored: JSON.parse(localStorage.getItem('berry3w.settings') || '{}').apiKey || '',
    aria: document.querySelector('#apiKey').getAttribute('aria-invalid'),
    notice: document.querySelector('#modelStatus').textContent
  }));
  expect(st.active).toBe('');
  expect(st.stored).toBe('');
  expect(st.aria).toBe('true');
  expect(st.notice).toContain('U+5BC6');            // names the offending code point
  expect(st.notice).toContain('position 13');       // and its position, so the paste can be fixed
  expect(st.notice).toContain('ISO-8859-1');        // explains why it can never work
  expect(st.notice).not.toContain('sk-or-v1-');     // never echoes key material
  await page.click('#refreshModels');
  await page.waitForFunction(() => /models listed/.test(document.querySelector('#modelStatus').textContent));
  expect(sent.filter(r => r.kind === 'catalogue')).toHaveLength(1);
  expect(sent.every(r => r.auth === null)).toBe(true);
  expect(await text(page, '#modelStatus')).toContain('no key was sent');
  expect(errors).toEqual([]);
});

test('invisible and interior contamination is rejected with the exact code point', async ({ page }) => {
  await openWithOpenRouter(page);
  for (const [key, marker] of [[KEY_NBSP, 'U+00A0'], [KEY_ZERO_WIDTH, 'U+200B'], [KEY_INNER_SPACE, 'U+0020'], [KEY_SHORT, 'at least 16']]) {
    await page.fill('#apiKey', key);
    const notice = await text(page, '#modelStatus');
    expect(notice).toContain(marker);
    expect(notice).toContain('not used or saved');
    expect(await page.evaluate(() => window.__BERRY3W_TEST__.settings().apiKey)).toBe('');
  }
});

test('outer whitespace is trimmed while the inside of a key is never rewritten', async ({ page }) => {
  await openWithOpenRouter(page);
  await page.fill('#apiKey', '  ' + KEY_GOOD + '\n');
  expect(await page.evaluate(() => window.__BERRY3W_TEST__.settings().apiKey)).toBe(KEY_GOOD);
});
test('catalogue loads anonymously; only a real inference marks the model verified', async ({ page }) => {
  const { errors, sent } = await openWithOpenRouter(page);
  await page.fill('#apiKey', KEY_GOOD);
  expect(await text(page, '#modelStatus')).toContain('Key saved in this browser (validated ASCII)');
  expect(await text(page, '#providerChip')).toContain('not verified yet');
  await page.click('#refreshModels');
  await page.waitForFunction(() => /models listed/.test(document.querySelector('#modelStatus').textContent));
  const groups = await page.evaluate(() => [...document.querySelectorAll('#model optgroup')].map(g => g.label));
  expect(groups).toContain('openai');
  expect(groups).toContain('anthropic');
  expect(sent.filter(r => r.kind === 'catalogue').every(r => r.auth === null)).toBe(true);
  expect(await text(page, '#modelStatus')).toContain('does not prove');
  expect(await text(page, '#providerChip')).toContain('not verified yet');
  const out = await page.evaluate(() => window.__BERRY3W_TEST__.openrouter([{ role: 'user', content: 'ping' }], 'test'));
  expect(out).toEqual({ requirements: [] });
  const inf = sent.filter(r => r.kind === 'inference');
  expect(inf).toHaveLength(1);
  expect(inf[0].auth).toBe('Bearer ' + KEY_GOOD);
  expect(inf[0].title).toBe('UI Berry 3R MHTML Evaluation Workbench');
  expect(inf[0].model).toBe('openai/gpt-4.1-mini');
  expect(await text(page, '#providerChip')).toContain('AI passes verified');
  expect(errors).toEqual([]);
});

test('a failed inference leaves the model unverified and no secret reaches logs, diagnostics or records', async ({ page }) => {
  await openWithOpenRouter(page, { inferenceStatus: 500 });
  await page.fill('#apiKey', KEY_GOOD);
  const threw = await page.evaluate(async () => {
    try { await window.__BERRY3W_TEST__.openrouter([{ role: 'user', content: 'ping' }], 'test'); return 'no throw'; }
    catch (e) { return e.message; }
  });
  expect(threw).toContain('HTTP 500');
  expect(await text(page, '#providerChip')).toContain('not verified yet');       // no unfounded claim
  const diag = await page.evaluate(() => { window.__BERRY3W_TEST__.renderDiag(); return document.querySelector('#diagBody').textContent; });
  expect(diag).toContain('key present, validated');
  expect(diag).toContain('not verified by a request yet');
  expect(diag).not.toContain(KEY_GOOD.slice(0, 16));
  expect(diag).not.toContain('chars)');
  const record = await page.evaluate(() => JSON.stringify(window.__BERRY3W_TEST__.buildRecord()));
  expect(record).not.toContain(KEY_GOOD.slice(0, 16));
  const logged = await page.evaluate(k => { window.__BERRY3W_TEST__.pushErr('test', 'Authorization: Bearer ' + k); const b = window.__BERRY3W_TEST__.errBuffer(); return b[b.length - 1].message; }, KEY_GOOD);
  expect(logged).not.toContain(KEY_GOOD);
  expect(logged).toContain('[REDACTED]');
});
test('a contaminated key already in localStorage is discarded on load, with an explanation', async ({ page }) => {
  await page.route('**/api/analytics/**', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**openrouter.ai**', r => r.abort());
  await page.addInitScript(k => { try { localStorage.setItem('berry3w.settings', JSON.stringify({ apiKey: k, model: 'openai/gpt-4.1-mini', temperature: 0.2 })); } catch (e) {} }, KEY_CJK);
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__BERRY3W_TEST__));
  expect(await page.evaluate(() => window.__BERRY3W_TEST__.settings().apiKey)).toBe('');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('berry3w.settings') || '{}').apiKey || '')).toBe('');
  const notice = await text(page, '#modelStatus');
  expect(notice).toContain('discarded before use');
  expect(notice).toContain('U+5BC6');
});

test('every dynamic header value is validated or rendered ASCII-safe', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const t = window.__BERRY3W_TEST__;
    const out = {};
    out.encoded = t.headerValue('X-Title', 'A \u6807 title', { encode: true });
    out.latin1Kept = t.headerValue('X-Title', 'Caf\u00e9 \u2014 test', { encode: true });
    try { t.headerValue('Authorization', 'Bearer sk-\u5bc6', {}); out.thrown = 'none'; } catch (e) { out.thrown = e.message; }
    out.anon = Object.keys(t.openrouterHeaders({}));
    try { t.openrouterHeaders({ auth: true }); out.authThrown = 'none'; } catch (e) { out.authThrown = e.message; }
    return out;
  });
  expect(r.encoded).toBe('A %E6%A0%87 title');           // >0xFF is percent-encoded, nothing is dropped
  expect(r.latin1Kept).toBe('Caf\u00e9 %E2%80%94 test');  // Latin-1 characters stay literal
  expect(r.thrown).toContain('U+5BC6');
  expect(r.thrown).toContain('cannot be sent');
  expect(r.anon).not.toContain('Authorization');          // no credential unless it is asked for
  expect(r.anon).toContain('HTTP-Referer');
  expect(r.authThrown).toContain('No OpenRouter key is set');
});

test('an imported record cannot smuggle a key back into storage', async ({ page }) => {
  await open(page);
  const stored = await page.evaluate(async k => {
    await window.__BERRY3W_TEST__.importTask(JSON.stringify({ id: 'smuggle', apiKey: k, settings: { apiKey: k }, task: { id: 'smuggle' } }));
    const all = await window.__BERRY3W_TEST__.idbGetAll('tasks');
    const rec = all.find(x => x.task && x.task.id === 'smuggle');
    return JSON.stringify(rec || {});
  }, KEY_GOOD);
  expect(stored).not.toContain(KEY_GOOD.slice(0, 16));
  expect(stored).not.toContain('apiKey');
});

/* ---------------- AI-first assessment workflow (regression) ----------------
   The workbench must analyse, decide provisionally and ask only what matters: the operator
   reviews and validates, rather than reconstructing the analysis by hand. */
const ASSESS_REQUEST = {
  sourceLanguage: 'zh', translation: 'Next, load the existing publicly available original text yourself.', purpose: 'Load the original text.',
  requirements: [{ id: 'r1', text: 'Load the existing publicly available original text', quoteOriginal: '\u63a5\u4e0b\u6765\u81ea\u884c\u52a0\u8f7d\u5df2\u6709\u516c\u5f00\u539f\u8457\u6587\u672c', lens: 'functionality', importance: 'core', kind: 'behavior' }]
};
function toAssessFacts(letter) {
  return { website: letter, requirementStatus: [{ id: 'r2', status: 'likely met', evidence: 'loader control present in the After state' }],
    facts: [{ claim: 'loader control present', lens: 'functionality', source: 'archive-dom', confidence: 'STRONG', behaviorRequired: true }],
    visualObservations: [], possibleRenderingFailures: [], uncertainties: [] };
}
const DECIDED = {
  satisfaction: { option: 'A is better', confidence: 'medium', because: ['r2: both expose a loader and Website A also offers a URL import'], decidingRequirementIds: ['r2'] },
  overall: { option: 'B is better', confidence: 'low', because: ['Website B labels where the imported text came from'], tradeOff: 'Website A imports more sources, but Website B tells the reader where the text came from.', decidingRequirementIds: ['r2'] },
  relativeStrengths: [{ site: 'A', point: 'URL import control present in the After state', relevance: 'explicit', requirementIds: ['r2'], certainty: 'behaviour-unverified' }],
  relativeWeaknesses: [{ site: 'B', point: 'no URL import control in the After state', relevance: 'explicit', requirementIds: ['r2'], certainty: 'presence-only' }],
  talkingPoints: [{ site: 'A', point: 'r2: Website A has a loader plus a URL import control', relevance: 'explicit', requirementIds: ['r2'], certainty: 'presence-only' }],
  uncertainties: [
    { site: 'A', question: 'Website A shows a text loader. When you tried loading the text, what happened?', why: 'A loader control exists in the After markup, but only a live tab proves it responds.', importance: 'decisive', affects: 'both', ifYes: 'Website A fulfils the request end to end', ifNo: 'Website A only looks complete', requirementIds: ['r2'], options: [{ label: 'It loaded text', status: 'confirmed working', note: 'text loaded' }, { label: 'It did nothing', status: 'broken', note: 'loader dead' }, { label: 'I could not check', status: 'could not inspect', note: 'unverified' }] },
    { site: 'B', question: 'Website B may show a placeholder where Website A shows a loader. What did you see?', why: 'Only placeholder text appears in the After state.', importance: 'material', affects: 'satisfaction', ifYes: '', ifNo: '', requirementIds: ['r2'], options: [{ label: 'A real loader', status: 'confirmed working', note: 'loader present' }, { label: 'Placeholder only', status: 'not present', note: 'no loader' }] }
  ]
};
const REVISED = Object.assign({}, DECIDED, {
  satisfaction: { option: 'B is better', confidence: 'high', because: ['your observation: the Website A loader did nothing', 'Website B loaded text from a public source'], decidingRequirementIds: ['r2'] },
  overall: { option: 'B is better', confidence: 'medium', because: ['Website B is the only candidate that loads text'], tradeOff: 'Website A looks richer, but cannot load text at all.', decidingRequirementIds: ['r2'] },
  uncertainties: []
});
async function openForAnalysis(page, opts = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.route('**/api/analytics/**', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**openrouter.ai**', r => r.abort());
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__BERRY3W_TEST__));
  if (opts.stub !== false) {
    await page.evaluate(canned => {
      window.__STAGES__ = [];
      window.__BERRY3W_TEST__.setAiTransport(async stage => {
        window.__STAGES__.push(stage);
        if (canned.throwOn && canned.throwOn.some(x => stage === x || stage.indexOf(x) === 0)) throw new Error('model unavailable for ' + stage);
        if (stage === 'request') return canned.request;
        if (stage === 'facts-A') return canned.factsA;
        if (stage === 'facts-B') return canned.factsB;
        if (stage === 'assess') return canned.first;
        if (stage === 'assess:2') return canned.second;
        if (stage === 'drafts') return canned.firstDrafts;
        if (stage === 'drafts:2') return canned.secondDrafts;
        if (stage.indexOf('draft-repair:') === 0) {
          const dim = stage.split(':')[1];
          if (canned.repairs && canned.repairs[dim]) return { reason: canned.repairs[dim] };
          throw new Error('no repair available for ' + dim);
        }
        throw new Error('unexpected stage ' + stage);
      });
    }, {
      request: ASSESS_REQUEST, factsA: toAssessFacts('A'), factsB: toAssessFacts('B'), first: DECIDED, second: REVISED,
      firstDrafts: opts.drafts || FIRST_DRAFTS, secondDrafts: opts.drafts2 || SECOND_DRAFTS,
      repairs: opts.repairs || null, throwOn: opts.throwOn || null
    });
  }
  await uploadSynthetic(page);
  return errors;
}
const analyzed = () => /model assessment/.test(window.__BERRY3W_TEST__.assessment().source);
test('one-click Analyze returns a provisional reading of both questions and only the questions that matter', async ({ page }) => {
  const errors = await openForAnalysis(page);
  const beforeAnalyze = await page.evaluate(() => window.__BERRY3W_TEST__.assessment().source);
  expect(beforeAnalyze).toMatch(/deterministic baseline/);            // archive-only until Analyze
  await page.click('#analyzeBtn');
  await page.waitForFunction(analyzed, null, { timeout: 30000 });
  const out = await page.evaluate(() => {
    const t = window.__BERRY3W_TEST__, a = t.assessment();
    return {
      stages: window.__STAGES__, sat: a.satisfaction, ovr: a.overall, changed: a.changed,
      strengths: a.strengths.length, weaknesses: a.weaknesses.length, talking: a.talkingPoints.length,
      clar: t.clarifications().map(c => ({ q: c.question, imp: c.importance, affects: c.affects, opts: c.options.map(o => o.label + '\u2192' + o.status), status: c.status })),
      decisions: { sat: t.state().decisions.satisfaction, ovr: t.state().decisions.overall },
      panel: document.querySelector('#assessBody').textContent, chip: document.querySelector('#assessChip').textContent,
      caveat: document.querySelector('#assessCaveat').textContent,
      matrixA: t.state().requirements.find(r => r.id === 'r2').statusA,
      firstPanelIsAssessment: !!document.querySelector('#view-archive section.panel #assessBody'),
      matrixFolded: !!document.querySelector('#reqTable').closest('details'),
      translated: t.state().request.translation
    };
  });
  expect(out.stages).toEqual(['request', 'facts-A', 'facts-B', 'assess', 'drafts']);   // five calls, nothing extra
  expect(out.sat.option).toBe('A is better');
  expect(out.sat.confidence).toBe('medium');
  expect(out.ovr.option).toBe('B is better');
  expect(out.ovr.tradeOff).toContain('tells the reader');
  expect(out.changed).toBe(false);                                           // first pass replaces the baseline, it is not a "change"
  expect(out.strengths).toBeGreaterThan(0);
  expect(out.weaknesses).toBeGreaterThan(0);
  expect(out.talking).toBeGreaterThan(0);
  expect(out.clar).toHaveLength(2);                                          // targeted questions, not a generic list
  expect(out.clar[0].imp).toBe('decisive');
  expect(out.clar[1].imp).toBe('material');
  expect(out.clar[0].q).toContain('what happened');
  expect(out.clar[0].opts.length).toBeGreaterThanOrEqual(3);                 // quick answers with their meaning
  expect(out.clar[1].affects).toBe('satisfaction');
  expect(out.decisions.sat).toEqual({ option: '', reason: '' });             // no model prose in the four fields
  expect(out.decisions.ovr).toEqual({ option: '', reason: '' });
  expect(out.panel).toContain('A is better');
  expect(out.panel).toContain('trade-off');
  expect(out.panel).toContain('Unresolved questions');
  expect(out.chip).toContain('AI assessment');
  expect(out.caveat).toContain('not proof of behaviour');
  expect(out.matrixA).toBe('likely met');                                    // the model also fills the matrix
  expect(out.firstPanelIsAssessment).toBe(true);                             // review-first layout
  expect(out.matrixFolded).toBe(true);                                       // detail folded away
  expect(out.translated).toContain('publicly available original text');
  expect(errors).toEqual([]);
});

test('an answered clarification is recorded as a human observation and can change the suggested winner', async ({ page }) => {
  const errors = await openForAnalysis(page);
  await page.click('#analyzeBtn');
  await page.waitForFunction(analyzed, null, { timeout: 30000 });
  const before = await page.evaluate(() => ({ sat: window.__BERRY3W_TEST__.assessment().satisfaction.option, ovr: window.__BERRY3W_TEST__.assessment().overall.option, open: window.__BERRY3W_TEST__.openClarifications().length }));
  expect(before.sat).toBe('A is better');
  expect(before.open).toBe(2);
  await page.click('#reviewBody [data-cl-opt="1"]');                       // "It did nothing" -> broken, answered on the review screen
  await page.waitForFunction(() => window.__BERRY3W_TEST__.assessment().round === 2, null, { timeout: 30000 });
  const after = await page.evaluate(() => {
    const t = window.__BERRY3W_TEST__, a = t.assessment(), c = t.clarifications()[0];
    const r = t.state().requirements.find(x => x.id === 'r2');
    return {
      stages: window.__STAGES__, sat: a.satisfaction.option, ovr: a.overall.option, changed: a.changed, note: a.changedNote, round: a.round,
      open: t.openClarifications().length, status: c.status, answer: c.answer,
      verify: t.state().verification.filter(v => v.clarificationId).map(v => ({ site: v.site, status: v.status, source: v.source })),
      humanFacts: t.state().facts.A.filter(f => f.conf === 'HUMAN').length,
      matrixA: r.statusA, humanA: !!(r.human && r.human.A),
      superseded: t.clarifications().filter(c => c.status === 'superseded').length,
      clarifyStatus: document.querySelector('#clarifyStatus').textContent,
      panel: document.querySelector('#assessBody').textContent,
      clarifyPanel: document.querySelector('#clarifyBody').textContent,
      verifyPanel: document.querySelector('#verifyBody').textContent.slice(0, 80)
    };
  });
  expect(after.stages).toEqual(['request', 'facts-A', 'facts-B', 'assess', 'drafts', 'assess:2', 'drafts:2']);
  expect(after.sat).toBe('B is better');                                     // the suggestion moved
  expect(after.changed).toBe(true);
  expect(after.note).toContain('A is better');
  expect(after.note).toContain('B is better');
  expect(after.round).toBe(2);
  expect(after.status).toBe('answered');
  expect(after.answer.status).toBe('broken');
  expect(after.open).toBe(0);                                                // round 2 asked nothing further
  expect(after.superseded).toBe(1);                                          // the other question is kept, not lost
  expect(after.clarifyPanel).toContain('superseded');
  expect(after.verify).toHaveLength(1);
  expect(after.verify[0].status).toBe('broken');
  expect(after.verify[0].source).toContain('model clarification');
  expect(after.humanFacts).toBeGreaterThan(0);                               // observation is now a human fact
  expect(after.matrixA).toBe('missed');
  expect(after.humanA).toBe(true);
  expect(after.clarifyStatus).toContain('moved from');
  expect(after.panel).toContain('B is better');
  expect(after.verifyPanel).toContain('Asked by the assessment');
  expect(errors).toEqual([]);
});
test('keeps the four submission fields human-authored while the review screen carries the drafts', async ({ page }) => {
  const errors = await openForAnalysis(page);
  await page.click('#analyzeBtn');
  await page.waitForFunction(() => window.__BERRY3W_TEST__.drafts().overall !== null, null, { timeout: 30000 });
  const view = await page.evaluate(() => {
    return {
      satReason: document.querySelector('#satReason').value,
      ovrReason: document.querySelector('#ovrReason').value,
      review: document.querySelector('#reviewBody').textContent,
      chip: document.querySelector('#suggestChip').textContent,
      options: document.querySelectorAll('#satOptions .opt').length,
      draft: window.__BERRY3W_TEST__.assessmentText()
    };
  });
  expect(view.satReason).toBe('');                       // never pre-filled with model prose
  expect(view.ovrReason).toBe('');
  expect(view.review).toContain('A is better');
  expect(view.review).toContain('Use this recommendation');
  expect(view.review).toContain('AI-generated draft');
  expect(view.chip).toContain('recommendation');
  expect(view.options).toBe(4);
  expect(view.draft).toContain('the four submission fields are written by the operator');
  const applied = await page.evaluate(() => {
    window.__BERRY3W_TEST__.applySuggestion('satisfaction');
    const d = window.__BERRY3W_TEST__.state().decisions.satisfaction;
    return { option: d.option, reason: d.reason, checked: document.querySelectorAll('#satOptions input[type=radio]:checked').length };
  });
  expect(applied.option).toBe('A is better');            // confirming a recommendation sets the selection ...
  expect(applied.reason).toBe('');                       // ... and nothing else
  expect(applied.checked).toBe(1);
  // the rubric still governs what the operator writes
  const rubric = await page.evaluate(() => {
    const t = window.__BERRY3W_TEST__;
    t.state().decisions.satisfaction.reason = 'Website A is better because it works.';
    return t.validateAll().findings.map(f => f.code);
  });
  expect(rubric).toContain('word-min');
  expect(errors).toEqual([]);
});

test('without a model the workflow still returns a labelled deterministic baseline, never a blank decision', async ({ page }) => {
  const errors = await openForAnalysis(page, { stub: false });
  await page.click('#analyzeBtn');
  const out = await page.evaluate(() => {
    const t = window.__BERRY3W_TEST__, a = t.assessment();
    return { src: a.source, sat: a.satisfaction.option, ovr: a.overall.option, conf: a.satisfaction.confidence,
      status: document.querySelector('#analyzeStatus').textContent, chip: document.querySelector('#assessChip').textContent,
      caveat: document.querySelector('#assessCaveat').textContent, clar: t.clarifications().length,
      panel: document.querySelector('#assessBody').textContent };
  });
  expect(out.src).toMatch(/deterministic baseline/);
  expect(out.sat).toBeTruthy();
  expect(out.ovr).toBeTruthy();
  expect(['low', 'medium']).toContain(out.conf);          // a baseline never claims high confidence
  expect(out.status).toContain('No OpenRouter key is set');
  expect(out.status).toContain('deterministic baseline');
  expect(out.chip).toContain('baseline');
  expect(out.caveat).toContain('no model weighed the candidates');
  expect(out.clar).toBe(0);                              // no invented questions without a model
  expect(out.panel).toContain(out.sat);
  expect(errors).toEqual([]);
});

/* ---------------- AI draft explanations: generation, naming, QA and regeneration ----------------
   Draft fixtures below were tuned against the workbench's own validator, so a clean fixture is
   clean for the same reason a real submission would be: word range, naming, lens and tie rules. */
const SAT_A = 'Website A is better because it provides the requested text loader together with a URL import control, so the whole requested flow sits in one place, while Website B presents a loader only and does not expose a way to bring the required text in from a source. Both candidates show the reader panel and the chapter list the request names, and both keep the navigation the task depends on, but Website A includes the extra control the requested flow needs and Website B leaves that part of the request unaddressed.';
const SAT_B = 'Website B is better because it provides the requested text loader, the reader panel and the chapter list in one place, while Website A adds a URL import control that the request did not ask for and keeps the loader behind another step. Both candidates show the requested sections, and both keep the navigation the task depends on, but Website B places every requested control where the request describes it, so the flow the user asked for is easier to follow from the top of the page.';
const OVR_B = 'Website B is better because its typography and spacing make the long text easier to read, and its section headings sit in a clearer hierarchy, so the page can be taken in at a glance, while Website A groups its blocks more tightly and its text runs edge to edge. Website A does provide more of the requested controls, and that counts in its favour, but its plain presentation makes the reading experience more tiring overall. Weighing the two, the missing import control costs the user less than clearer typography and calmer spacing gain, so Website B offers the better complete experience.';
const TIE_SAT = 'Website A and Website B are tied as good options because both provide the requested text loader, the reader panel and the chapter list, and neither candidate leaves a requested section out. Website A includes a URL import control that Website B does not expose, but Website B keeps the loader control at the top of the panel where the request places it, so the two pages cover the same request from slightly different angles. Both satisfy the requested content and components equally well, so the pair sits at solid or good on the quality scale.';
const TIE_OVR = 'Website A and Website B are tied as good options because each one covers what the other leaves out: Website B has clearer typography, calmer spacing and a tidier hierarchy, while Website A provides more of the requested controls, including the URL import the request names. Weighing functionality against presentation, the extra control in Website A matters about as much as the easier reading in Website B. Since neither advantage clearly outweighs the other, the pair sits at solid or good on the quality scale.';
const FIRST_DRAFTS = {
  satisfaction: { option: 'A is better', reason: SAT_A, why: ['r2: the loader and the URL import control both appear in the After state'] },
  overall: { option: 'B is better', reason: OVR_B, why: ['typography and spacing differ between the two After states'] }
};
const SECOND_DRAFTS = {
  satisfaction: { option: 'B is better', reason: SAT_B, why: ['your observation: the Website A loader did nothing'] },
  overall: { option: 'B is better', reason: OVR_B, why: ['typography and spacing differ between the two After states'] }
};
test('Analyze delivers a complete assessment plus two AI draft explanations in the review screen', async ({ page }) => {
  const errors = await openForAnalysis(page);
  await page.click('#analyzeBtn');
  await page.waitForFunction(() => window.__BERRY3W_TEST__.drafts().overall !== null, null, { timeout: 30000 });
  const out = await page.evaluate(() => {
    const t = window.__BERRY3W_TEST__, d = t.drafts();
    return {
      stages: window.__STAGES__, view: t.state().view,
      sat: { option: d.satisfaction.option, words: d.satisfaction.words, ok: d.satisfaction.qa.ok, unrepaired: d.satisfaction.unrepaired, text: d.satisfaction.text },
      ovr: { option: d.overall.option, words: d.overall.words, ok: d.overall.qa.ok, text: d.overall.text },
      review: document.querySelector('#reviewBody').textContent,
      badges: [...document.querySelectorAll('#reviewBody .badge')].map(b => b.textContent),
      finalSat: document.querySelector('#satReason').value, finalOvr: document.querySelector('#ovrReason').value,
      readiness: document.querySelector('#readinessNote').textContent,
      regenerate: document.querySelector('#regenerateDraftsBtn').disabled,
      draftsPersistence: JSON.stringify(t.state().drafts).length
    };
  });
  expect(out.stages).toEqual(['request', 'facts-A', 'facts-B', 'assess', 'drafts']);   // five calls, nothing extra
  expect(out.view).toBe('decide');                                                    // review screen first
  expect(out.sat.option).toBe('A is better');
  expect(out.ovr.option).toBe('B is better');
  expect(out.sat.ok).toBe(true);
  expect(out.ovr.ok).toBe(true);
  expect(out.sat.unrepaired).toEqual([]);
  expect(out.sat.words).toBeGreaterThanOrEqual(40);
  expect(out.sat.words).toBeLessThanOrEqual(160);
  expect(out.ovr.words).toBeGreaterThanOrEqual(40);
  expect(out.ovr.words).toBeLessThanOrEqual(160);
  expect(out.sat.text.startsWith('Website A is better because ')).toBe(true);         // required opener
  expect(out.ovr.text.startsWith('Website B is better because ')).toBe(true);
  expect(out.badges.filter(b => /not submission-ready under the project authorship rule/.test(b))).toHaveLength(2);
  expect(out.review).toContain('Use this recommendation');
  expect(out.review).toContain('Your selection: not chosen yet');
  expect(out.finalSat).toBe('');                                                     // never pre-filled
  expect(out.finalOvr).toBe('');
  expect(out.readiness).toContain('2 of the four submission fields still empty');
  expect(out.regenerate).toBe(false);
  expect(errors).toEqual([]);
});

test('drafts are normalised into the handbook style: naming, opener, punctuation and word range', async ({ page }) => {
  const sloppy = {
    satisfaction: { option: 'A is better', reason: 'Site A is better \u2014 it has a \u201ccleaner\u201d loader. B has none. A also wins.', why: [] },
    overall: { option: 'B is better', reason: 'Page B is better because its typography is clearer than the first website, although the second website has more controls.' }
  };
  const errors = await openForAnalysis(page, { drafts: sloppy, repairs: { satisfaction: SAT_A, overall: OVR_B } });
  await page.click('#analyzeBtn');
  await page.waitForFunction(() => window.__BERRY3W_TEST__.drafts().overall !== null, null, { timeout: 30000 });
  const out = await page.evaluate(() => {
    const t = window.__BERRY3W_TEST__, d = t.drafts();
    return {
      stages: window.__STAGES__,
      sat: { text: d.satisfaction.text, words: d.satisfaction.words, ok: d.satisfaction.qa.ok, repairs: d.satisfaction.repairs },
      ovr: { text: d.overall.text, ok: d.overall.qa.ok, repairs: d.overall.repairs },
      canon: t.canonicalizeCandidates('Site A beats Site B and the first website wins'),
      house: t.sanitizeHouseStyle('say \u201cyes\u201d \u2014 then go'),
      opening: t.openingFor('Both are bad')
    };
  });
  expect(out.stages.filter(s => s.indexOf('draft-repair:') === 0)).toEqual(['draft-repair:satisfaction', 'draft-repair:overall']);
  expect(out.sat.text).toBe(SAT_A);                        // the repair replaced the invalid draft
  expect(out.sat.words).toBeGreaterThanOrEqual(40);
  expect(out.sat.ok).toBe(true);
  expect(out.ovr.ok).toBe(true);
  expect(out.sat.repairs.length).toBeGreaterThan(0);
  expect(out.sat.text).not.toMatch(/\bSite\s+A\b/);        // no invented labels
  expect(out.sat.text).not.toMatch(/(?<!Website\s)\b[AB]\b/);   // no bare letters
  expect(out.sat.text).not.toContain('\u2014');            // no em dashes
  expect(out.sat.text).not.toContain('\u201c');
  expect(out.ovr.text).toContain('Website B');
  expect(out.canon).toBe('Website A beats Website B and Website A wins');   // idempotent canonicalisation
  expect(out.canon).toBe('Website A beats Website B and Website A wins');
  expect(out.house).toBe('say "yes", then go');
  expect(out.opening).toBe('Website A and Website B are tied as bad options because ');
  expect(errors).toEqual([]);
});
test('a defect the repair pass cannot fix is reported, never silently accepted', async ({ page }) => {
  const sloppy = {
    satisfaction: { option: 'A is better', reason: 'Site A is better because its palette is cleaner and B looks dated.', why: [] },
    overall: { option: 'B is better', reason: OVR_B, why: [] }
  };
  const errors = await openForAnalysis(page, { drafts: sloppy });          // the repair stage throws
  await page.click('#analyzeBtn');
  await page.waitForFunction(() => window.__BERRY3W_TEST__.drafts().overall !== null, null, { timeout: 30000 });
  const out = await page.evaluate(() => {
    const t = window.__BERRY3W_TEST__, d = t.drafts().satisfaction;
    return { codes: d.unrepaired, ok: d.qa.ok, findings: d.qa.findings.map(f => f.code),
      chip: [...document.querySelectorAll('#reviewBody .chip')].map(c => c.textContent),
      readiness: document.querySelector('#readinessNote').textContent,
      text: d.text, status: document.querySelector('#draftStatus').textContent };
  });
  expect(out.codes.length).toBeGreaterThan(0);                             // reported, not hidden
  expect(out.codes).toContain('word-min');
  expect(out.ok).toBe(false);
  expect(out.chip.join(' | ')).toMatch(/rule\(s\) still failing/);
  expect(out.readiness).toContain('satisfaction draft still breaks a rule');
  expect(out.status.length).toBeGreaterThan(0);
  expect(out.text.startsWith('Website A is better because ')).toBe(true);   // naming/opener still normalised
  expect(errors).toEqual([]);
});

test('ties obey the 1-6 threshold and are never presented as settled while evidence is open', async ({ page }) => {
  const tieAssessment = Object.assign({}, DECIDED, {
    satisfaction: { option: 'Both are good', confidence: 'low', because: ['both cover the requested controls'], decidingRequirementIds: ['r2'] },
    overall: { option: 'Both are good', confidence: 'low', because: ['each covers what the other leaves out'], tradeOff: 'Functionality and presentation pull in opposite directions.', decidingRequirementIds: [] }
  });
  const tieDrafts = {
    satisfaction: { option: 'Both are good', reason: TIE_SAT, tieScale: 5, why: [] },
    overall: { option: 'Both are good', reason: TIE_OVR, tieScale: 5, why: [] }
  };
  const errors = await openForAnalysis(page);
  await page.evaluate(c => {
    const t = window.__BERRY3W_TEST__;
    t.setAiTransport(async stage => {
      if (stage === 'request') return c.request;
      if (stage === 'facts-A') return c.factsA;
      if (stage === 'facts-B') return c.factsB;
      if (stage === 'assess') return c.assess;
      if (stage === 'drafts') return c.drafts;
      throw new Error('unexpected ' + stage);
    });
  }, { assess: tieAssessment, drafts: tieDrafts, request: ASSESS_REQUEST, factsA: toAssessFacts('A'), factsB: toAssessFacts('B') });
  await page.click('#analyzeBtn');
  await page.waitForFunction(() => window.__BERRY3W_TEST__.drafts().overall !== null, null, { timeout: 30000 });
  const out = await page.evaluate(() => {
    const t = window.__BERRY3W_TEST__, d = t.drafts();
    const withScale = (scale) => t.validateFields({ satisfaction: { option: 'Both are good', reason: d.satisfaction.text, tieScale: scale }, overall: { option: 'Both are good', reason: d.overall.text, tieScale: scale } }).findings.filter(f => f.level === 'error').map(f => f.code);
    return {
      satOk: d.satisfaction.qa.ok, ovrOk: d.overall.qa.ok, satScale: d.satisfaction.tieScale,
      satText: d.satisfaction.text, ovrText: d.overall.text,
      lowThreshold: withScale(2), highThreshold: withScale(5),
      review: document.querySelector('#reviewBody').textContent,
      open: t.openClarifications().length
    };
  });
  expect(out.satScale).toBe(5);
  expect(out.satText.startsWith('Website A and Website B are tied as good options because ')).toBe(true);
  expect(out.satText).toContain('Website A');
  expect(out.satText).toContain('Website B');
  expect(out.satOk).toBe(true);
  expect(out.ovrOk).toBe(true);
  expect(out.highThreshold).not.toContain('tie-threshold');
  expect(out.lowThreshold).toContain('tie-threshold');                      // 1-6 rule enforced
  expect(out.open).toBeGreaterThan(0);
  expect(out.review).toContain('This tie is provisional');                  // not presented as certain
  expect(errors).toEqual([]);
});
test('Satisfaction and Overall drafts stay independent and never copy each other', async ({ page }) => {
  const sameOption = Object.assign({}, DECIDED, { satisfaction: { option: 'B is better', confidence: 'medium', because: ['r2: Website B places every requested control at the top'], decidingRequirementIds: ['r2'] } });
  const errors = await openForAnalysis(page);
  await page.evaluate(c => {
    window.__BERRY3W_TEST__.setAiTransport(async stage => {
      if (stage === 'request') return c.request;
      if (stage === 'facts-A') return c.factsA;
      if (stage === 'facts-B') return c.factsB;
      if (stage === 'assess') return c.assess;
      if (stage === 'drafts') return c.drafts;
      throw new Error('unexpected ' + stage);
    });
  }, {
    assess: sameOption, request: ASSESS_REQUEST, factsA: toAssessFacts('A'), factsB: toAssessFacts('B'),
    drafts: { satisfaction: { option: 'B is better', reason: SAT_B, why: [] }, overall: { option: 'B is better', reason: OVR_B, why: [] } }
  });
  await page.click('#analyzeBtn');
  await page.waitForFunction(() => window.__BERRY3W_TEST__.drafts().overall !== null, null, { timeout: 30000 });
  const out = await page.evaluate(() => {
    const t = window.__BERRY3W_TEST__, d = t.drafts();
    const codes = t.validateFields({ satisfaction: { option: 'B is better', reason: d.satisfaction.text }, overall: { option: 'B is better', reason: d.overall.text } }).findings;
    return {
      satText: d.satisfaction.text, ovrText: d.overall.text, satOk: d.satisfaction.qa.ok, ovrOk: d.overall.qa.ok,
      sameOption: codes.filter(f => f.code === 'same-option' || f.code === 'reuse').map(f => f.level + ':' + f.code),
      identical: d.satisfaction.text === d.overall.text,
      overallOnly: codes.filter(f => f.field === 'overall').map(f => f.code)
    };
  });
  expect(out.identical).toBe(false);
  expect(out.satText.startsWith('Website B is better because ')).toBe(true);
  expect(out.ovrText.startsWith('Website B is better because ')).toBe(true);
  expect(out.satOk).toBe(true);
  expect(out.ovrOk).toBe(true);
  expect(out.sameOption).toContain('info:same-option');          // allowed, but flagged as needing the weighing
  expect(out.sameOption).not.toContain('error:reuse');           // not a copy of the Satisfaction reasoning
  expect(out.overallOnly).not.toContain('no-weighing');
  expect(errors).toEqual([]);
});

test('a clarification regenerates the affected draft and reports what changed', async ({ page }) => {
  const errors = await openForAnalysis(page);
  await page.click('#analyzeBtn');
  await page.waitForFunction(() => window.__BERRY3W_TEST__.drafts().overall !== null, null, { timeout: 30000 });
  const before = await page.evaluate(() => ({ sat: window.__BERRY3W_TEST__.drafts().satisfaction.text, stages: window.__STAGES__.slice() }));
  expect(before.sat.startsWith('Website A is better because ')).toBe(true);
  await page.click('#reviewBody [data-cl-opt="1"]');                        // answer on the review screen
  await page.waitForFunction(() => window.__BERRY3W_TEST__.drafts().satisfaction && window.__BERRY3W_TEST__.drafts().satisfaction.round === 2, null, { timeout: 30000 });
  const out = await page.evaluate(() => {
    const t = window.__BERRY3W_TEST__;
    return {
      stages: window.__STAGES__, sat: t.drafts().satisfaction, ovr: t.drafts().overall,
      assessment: t.assessment().satisfaction.option, changed: t.assessment().changed,
      review: document.querySelector('#reviewBody').textContent,
      status: document.querySelector('#draftStatus').textContent,
      readiness: document.querySelector('#readinessNote').textContent
    };
  });
  expect(out.stages).toContain('drafts:2');
  expect(out.sat.round).toBe(2);
  expect(out.sat.text).toBe(SAT_B);
  expect(out.sat.text.startsWith('Website B is better because ')).toBe(true);   // follows the recalculation
  expect(out.sat.trigger).toContain('what happened');
  expect(out.sat.changeShare).toBeGreaterThan(0);
  expect(out.sat.qa.ok).toBe(true);
  expect(out.assessment).toBe('B is better');
  expect(out.changed).toBe(true);
  expect(out.review).toContain('B is better');
  expect(out.status).toMatch(/updated from the new evidence|already matched/);
  expect(errors).toEqual([]);
});
test('operator edits survive regeneration, and the new draft is offered rather than imposed', async ({ page }) => {
  const errors = await openForAnalysis(page);
  await page.click('#analyzeBtn');
  await page.waitForFunction(() => window.__BERRY3W_TEST__.drafts().overall !== null, null, { timeout: 30000 });
  const mine = 'Website A is better because the requested loader and the URL import control are both present on the page, while Website B offers the loader alone, so the requested flow cannot be completed there. Both candidates show the reader panel and the chapter list the request names. This paragraph is my own wording for the draft box.';
  await page.evaluate(text => window.__BERRY3W_TEST__.editDraft('satisfaction', text), mine);
  const edited = await page.evaluate(() => {
    const t = window.__BERRY3W_TEST__;
    return { edited: t.draftEdited().satisfaction, current: t.currentDraftText('satisfaction'), ai: t.drafts().satisfaction.text };
  });
  expect(edited.edited).toBe(true);
  expect(edited.current).toBe(mine);
  expect(edited.ai).not.toBe(mine);
  await page.click('#reviewBody [data-cl-opt="1"]');                       // the analysis changes underneath
  await page.waitForFunction(() => window.__BERRY3W_TEST__.draftPending().satisfaction !== null, null, { timeout: 30000 });
  const pending = await page.evaluate(() => {
    const t = window.__BERRY3W_TEST__;
    return { current: t.currentDraftText('satisfaction'), ai: t.drafts().satisfaction.text, pending: t.draftPending().satisfaction.text,
      review: document.querySelector('#reviewBody').textContent, log: t.draftLog().satisfaction.map(e => e.kind) };
  });
  expect(pending.current).toBe(mine);                                        // my wording is untouched
  expect(pending.ai).not.toBe(SAT_B);                                        // the AI draft slot was not overwritten either
  expect(pending.pending).toBe(SAT_B);
  expect(pending.review).toContain('Updated draft available for the new analysis');
  expect(pending.review).toContain('Keep my wording');
  expect(pending.log).toContain('edit');
  await page.click('#reviewBody [data-draft-keep="satisfaction"]');
  const kept = await page.evaluate(() => {
    const t = window.__BERRY3W_TEST__;
    return { current: t.currentDraftText('satisfaction'), pending: t.draftPending().satisfaction, log: t.draftLog().satisfaction.map(e => e.kind) };
  });
  expect(kept.current).toBe(mine);
  expect(kept.pending).toBe(null);
  expect(kept.log).toContain('ai-unused');
  const applied = await page.evaluate(() => {
    const t = window.__BERRY3W_TEST__;
    return { ovr: t.drafts().overall.text, prevOvr: !!(t.draftsPrev().overall), pendingOvr: t.draftPending().overall };
  });
  expect(applied.ovr).toBe(OVR_B);                        // never edited, so the new draft applied directly
  expect(applied.prevOvr).toBe(true);                     // and the replaced draft stays restorable
  expect(applied.pendingOvr).toBe(null);
  await page.click('#reviewBody [data-draft-restore="overall"]');
  const restoredPrev = await page.evaluate(() => ({ prev: window.__BERRY3W_TEST__.draftsPrev().overall, text: window.__BERRY3W_TEST__.drafts().overall.text }));
  expect(restoredPrev.prev).toBe(null);
  expect(restoredPrev.text).toBe(OVR_B);
  // my wording is still in the box, so a new draft is offered again and this time accepted
  await page.evaluate(async () => { await window.__BERRY3W_TEST__.regenerateDrafts(['satisfaction']); });
  const offered = await page.evaluate(() => ({ pending: window.__BERRY3W_TEST__.draftPending().satisfaction, current: window.__BERRY3W_TEST__.currentDraftText('satisfaction') }));
  expect(offered.current).toBe(mine);
  expect(offered.pending.text).toBe(SAT_B);
  await page.click('#reviewBody [data-draft-accept="satisfaction"]');
  const accepted = await page.evaluate(() => {
    const t = window.__BERRY3W_TEST__;
    return { text: t.drafts().satisfaction.text, edited: t.draftEdited().satisfaction, current: t.currentDraftText('satisfaction'), pending: t.draftPending().satisfaction, log: t.draftLog().satisfaction.map(e => e.kind), prev: !!t.draftsPrev().satisfaction };
  });
  expect(accepted.text).toBe(SAT_B);                      // the accepted draft is now the shown one
  expect(accepted.current).toBe(SAT_B);
  expect(accepted.edited).toBe(false);
  expect(accepted.pending).toBe(null);
  expect(accepted.prev).toBe(true);
  expect(accepted.log).toContain('edit');                 // the replaced wording is filed, not lost
  expect(errors).toEqual([]);
});

test('AI drafts stay separate from the human submission fields, and seeding them is explicit and flagged', async ({ page }) => {
  const errors = await openForAnalysis(page);
  await page.click('#analyzeBtn');
  await page.waitForFunction(() => window.__BERRY3W_TEST__.drafts().overall !== null, null, { timeout: 30000 });
  const before = await page.evaluate(() => ({
    satReason: window.__BERRY3W_TEST__.state().decisions.satisfaction.reason,
    ovrReason: window.__BERRY3W_TEST__.state().decisions.overall.reason,
    draft: window.__BERRY3W_TEST__.drafts().satisfaction.text,
    seeded: window.__BERRY3W_TEST__.state().decisions.satisfaction.seededFromDraft || null
  }));
  expect(before.satReason).toBe('');
  expect(before.ovrReason).toBe('');
  expect(before.seeded).toBe(null);
  await page.evaluate(() => window.__BERRY3W_TEST__.seedFinalFromDraft('satisfaction'));
  const seeded = await page.evaluate(() => {
    const t = window.__BERRY3W_TEST__;
    return {
      field: t.state().decisions.satisfaction.reason,
      draft: t.drafts().satisfaction.text,
      flag: !!t.state().decisions.satisfaction.seededFromDraft,
      codes: t.validateAll().findings.map(f => f.code),
      satStatus: document.querySelector('#draftStatus').textContent,
      banner: document.querySelector('#readinessNote').textContent
    };
  });
  expect(seeded.field).toBe(seeded.draft);                                  // explicit copy, same words
  expect(seeded.flag).toBe(true);
  expect(seeded.codes).toContain('ai-seeded');                              // flagged while unchanged
  expect(seeded.satStatus).toContain('rewrite it in your own words');
  await page.evaluate(() => {
    const t = window.__BERRY3W_TEST__;
    t.state().decisions.satisfaction.reason = t.state().decisions.satisfaction.reason.replace('provides the requested text loader', 'includes the text loader the request names');
  });
  const rewritten = await page.evaluate(() => window.__BERRY3W_TEST__.validateAll().findings.map(f => f.code));
  expect(rewritten).not.toContain('ai-seeded');                             // the flag clears once the wording is theirs
  expect(errors).toEqual([]);
});
test('a failed draft step degrades gracefully and can be retried', async ({ page }) => {
  const errors = await openForAnalysis(page, { throwOn: ['drafts'] });
  await page.click('#analyzeBtn');
  await page.waitForFunction(() => /model assessment/.test(window.__BERRY3W_TEST__.assessment().source), null, { timeout: 30000 });
  const failed = await page.evaluate(() => ({
    sat: window.__BERRY3W_TEST__.drafts().satisfaction,
    panel: document.querySelector('#reviewBody').textContent,
    status: document.querySelector('#draftStatus').textContent,
    components: window.__BERRY3W_TEST__.errBuffer().map(e => e.component),
    regenerateDisabled: document.querySelector('#regenerateDraftsBtn').disabled
  }));
  expect(failed.sat).toBe(null);
  expect(failed.panel).toContain('No draft for this field yet');
  expect(failed.panel).toContain('Regenerate drafts');
  expect(failed.status).toMatch(/Regenerate drafts|model step failed/);
  expect(failed.components).toContain('drafts');
  expect(failed.regenerateDisabled).toBe(false);
  await page.evaluate(c => {
    window.__BERRY3W_TEST__.setAiTransport(async stage => {
      if (stage === 'drafts') return c;
      throw new Error('unexpected ' + stage);
    });
  }, FIRST_DRAFTS);
  await page.click('#regenerateDraftsBtn');
  await page.waitForFunction(() => window.__BERRY3W_TEST__.drafts().overall !== null, null, { timeout: 30000 });
  const retried = await page.evaluate(() => ({
    sat: window.__BERRY3W_TEST__.drafts().satisfaction.text,
    ovr: window.__BERRY3W_TEST__.drafts().overall.text,
    status: document.querySelector('#draftStatus').textContent
  }));
  expect(retried.sat).toBe(SAT_A);
  expect(retried.ovr).toBe(OVR_B);
  expect(retried.status).toContain('ready');
  expect(errors).toEqual([]);
});

test('drafts, edits and their rule checks survive export and re-import', async ({ page }) => {
  const errors = await openForAnalysis(page);
  await page.click('#analyzeBtn');
  await page.waitForFunction(() => window.__BERRY3W_TEST__.drafts().overall !== null, null, { timeout: 30000 });
  const mine = 'Website A is better because the requested loader is present on the page while Website B exposes nothing of the kind, so the request cannot be carried out there. Both candidates show the reader panel the request names. This is my own wording.';
  await page.evaluate(text => window.__BERRY3W_TEST__.editDraft('overall', text), mine);
  const out = await page.evaluate(async () => {
    const t = window.__BERRY3W_TEST__;
    t.settings().apiKey = 'sk-or-v1-secretsecretsecret';
    const rec = t.buildRecord();
    const json = JSON.stringify(rec);
    t.applyRecord(JSON.parse(json));
    const d = t.drafts();
    return {
      jsonHasKey: /sk-or-v1-secretsecretsecret/.test(json),
      recDrafts: !!rec.drafts.satisfaction,
      recEdit: rec.draftEdits.overall,
      words: d.satisfaction.words,
      qaOk: d.satisfaction.qa.ok,
      option: d.overall.option,
      edited: t.draftEdited().overall,
      current: t.currentDraftText('overall'),
      log: t.draftLog().overall.length,
      finalField: t.state().decisions.overall.reason
    };
  });
  expect(out.jsonHasKey).toBe(false);                    // credentials still never leave in a record
  expect(out.recDrafts).toBe(true);
  expect(out.words).toBeGreaterThanOrEqual(40);
  expect(out.qaOk).toBe(true);
  expect(out.option).toBe('B is better');
  expect(out.recEdit).toBe(mine);
  expect(out.edited).toBe(true);
  expect(out.current).toBe(mine);
  expect(out.log).toBeGreaterThan(0);
  expect(out.finalField).toBe('');                       // an AI draft never becomes the submission field
  expect(errors).toEqual([]);
});

test('real capture: Analyze writes both drafts from the archived evidence', async ({ page }) => {
  test.setTimeout(300000);
  test.skip(!REAL_FIXTURE || !fs.existsSync(REAL_FIXTURE), 'set BERRY3W_REAL_FIXTURE to the captured .mhtml path');
  const errors = await open(page);
  await page.evaluate(c => {
    window.__STAGES__ = [];
    window.__BERRY3W_TEST__.setAiTransport(async stage => {
      window.__STAGES__.push(stage);
      if (stage === 'request') return c.request;
      if (stage === 'facts-A') return c.factsA;
      if (stage === 'facts-B') return c.factsB;
      if (stage === 'assess') return c.assess;
      if (stage === 'drafts') return c.drafts;
      throw new Error('unexpected ' + stage);
    });
  }, { request: ASSESS_REQUEST, factsA: toAssessFacts('A'), factsB: toAssessFacts('B'), assess: DECIDED, drafts: FIRST_DRAFTS });
  await page.setInputFiles('#fileInput', REAL_FIXTURE);
  await page.waitForFunction(() => window.__BERRY3W_TEST__.state().archive !== null, null, { timeout: 300000 });
  await page.click('#analyzeBtn');
  await page.waitForFunction(() => window.__BERRY3W_TEST__.drafts().overall !== null, null, { timeout: 120000 });
  const out = await page.evaluate(() => {
    const t = window.__BERRY3W_TEST__, d = t.drafts();
    return {
      stages: window.__STAGES__, parts: t.state().archive.partCount,
      requirements: t.state().requirements.length,
      sat: { open: d.satisfaction.text.slice(0, 40), words: d.satisfaction.words, ok: d.satisfaction.qa.ok },
      ovr: { open: d.overall.text.slice(0, 40), words: d.overall.words, ok: d.overall.qa.ok },
      bare: t.validateFields({ satisfaction: { option: d.satisfaction.option, reason: d.satisfaction.text }, overall: { option: d.overall.option, reason: d.overall.text } }).findings.filter(f => f.level === 'error' && (f.code === 'bare-letter' || f.code === 'label')).length,
      payload: JSON.stringify(t.draftPayload(['satisfaction', 'overall'], 1)).length
    };
  });
  expect(out.parts).toBeGreaterThan(10);
  expect(out.stages).toEqual(['request', 'facts-A', 'facts-B', 'assess', 'drafts']);
  expect(out.sat.open.startsWith('Website A is better because ')).toBe(true);
  expect(out.ovr.open.startsWith('Website B is better because ')).toBe(true);
  expect(out.sat.words).toBeGreaterThanOrEqual(40);
  expect(out.ovr.words).toBeGreaterThanOrEqual(40);
  expect(out.sat.ok).toBe(true);
  expect(out.ovr.ok).toBe(true);
  expect(out.bare).toBe(0);
  expect(out.payload).toBeLessThan(200000);               // bounded prompt on a 112 MB capture
  expect(errors).toEqual([]);
});
