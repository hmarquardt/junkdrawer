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

