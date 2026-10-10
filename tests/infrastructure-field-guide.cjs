/* Unit and integration tests for infrastructure-field-guide.html
   Run: node tests/infrastructure-field-guide.cjs

   This landing page makes claims about four sibling artifacts, so most of what
   is worth testing is whether those claims are still true. Every version,
   section count and deep link declared by the page is re-derived here from the
   artifact files themselves and from junk-drawer.json. No npm, no browser, no
   network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'infrastructure-field-guide.html');
const html = fs.readFileSync(PAGE, 'utf8');
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'junk-drawer.json'), 'utf8'));
const disagreements = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/aws-gcp-disagreements-2026-10.json'), 'utf8'));

function block(id) {
  const m = html.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)<\\/script>'));
  assert.ok(m, id + ' script block must exist in the page');
  return m[1];
}
function makeSandbox() {
  const sandbox = { console, Date, Math, JSON, isFinite, isNaN, Number, String, Object, Array, RegExp, parseFloat, parseInt, undefined };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(block('ifg-theme'), sandbox);
  vm.runInContext(block('ifg-data'), sandbox);
  vm.runInContext(block('ifg-core'), sandbox);
  return sandbox;
}
const S = makeSandbox();
const C = S.IFGCore;
const D = S.IFGData;
const json = v => JSON.parse(JSON.stringify(v));
/* Prose checks run against a whitespace-collapsed, entity-decoded copy: the
   page wraps its sentences across source lines and uses typographic entities,
   and a claim should not pass or fail because of either. */
const text = html.replace(/\s+/g, ' ')
  .replace(/&rsquo;|&lsquo;|&#39;/g, "'")
  .replace(/&ldquo;|&rdquo;/g, '"')
  .replace(/&mdash;/g, '\u2014')
  .replace(/&ndash;/g, '\u2013')
  .replace(/&thinsp;|&nbsp;/g, ' ')
  .replace(/&hellip;/g, '\u2026')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>');

/* Artifact facts, read fresh from disk on every run. */
const artifact = {};
for (const g of C.guides()) {
  const file = path.join(ROOT, g.file);
  assert.ok(fs.existsSync(file), 'artifact missing: ' + g.file);
  const src = fs.readFileSync(file, 'utf8');
  const ids = new Set([...src.matchAll(/id="(view-[A-Za-z0-9_-]+)"/g)].map(m => m[1]));
  artifact[g.id] = { src, ids, size: src.length };
}
/* Every href in the page that points at a sibling artifact, statically written.
   The four feature panels, the findings and the footer are hand-written HTML,
   so this is the check that catches a typo in one of them. */
const staticLinks = [...html.matchAll(/href="([A-Za-z0-9._-]+\.html)(#(view-[A-Za-z0-9_-]+))?"/g)]
  .map(m => ({ file: m[1], view: m[3] ? m[3] : null, href: m[1] + (m[3] ? '#' + m[3] : '') }));

let passed = 0;
const failures = [];
function t(name, fn) {
  try { fn(); passed += 1; }
  catch (err) { failures.push(name + ': ' + err.message); }
}

/* ---------------- page integration ---------------- */
t('the footer version, the comment and the registry agree', () => {
  const m = html.match(/data-deploy-version="([\d.]+)"/);
  assert.ok(m, 'a deploy version is present');
  assert.ok(/^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(m[1]), 'version format: ' + m[1]);
  const entry = registry.pages['infrastructure-field-guide.html'];
  assert.ok(entry, 'the page is registered in junk-drawer.json');
  assert.equal(entry.version, m[1]);
  assert.ok(html.includes('JUNKDRAWER_DEPLOY_FOOTER version="' + m[1] + '"'));
  assert.ok(html.includes('version ' + m[1]));
  assert.ok(entry.emoji && entry.title && entry.description, 'the registry entry is complete');
});

t('exactly one analytics tag, one storage helper, one favicon', () => {
  assert.equal((html.match(/<script[^>]*analytics-lite\.js/g) || []).length, 1);
  assert.equal((html.match(/<script[^>]*jd-storage\.js/g) || []).length, 1);
  assert.equal((html.match(/<link rel="icon"/g) || []).length, 1);
  assert.ok(html.includes('data-site-id="junkdrawer"'), 'analytics carries the site id');
});

t('the page loads nothing it does not ship', () => {
  const remote = [...html.matchAll(/(?:src|href)="(https?:)?\/\/[^"]+"/g)].map(m => m[0]);
  assert.deepEqual(remote, [], 'only relative references are allowed, found: ' + remote.join(', '));
  assert.ok(!/fetch\s*\(/.test(html), 'the page must not fetch anything');
  assert.ok(!/XMLHttpRequest|WebSocket|EventSource/.test(html), 'no live connections');
  assert.ok(!/api\.openai|api\.anthropic|Bearer [A-Za-z0-9]/.test(html), 'no credentials or model endpoints');
  const endpoint = html.match(/data-api="([^"]+)"/);
  assert.ok(endpoint && /^https:\/\/lab\.aismallbizguru\.com\/api\/analytics\//.test(endpoint[1]), 'only the analytics collector is referenced');
});

t('the document has the landmarks and structure a reader needs', () => {
  assert.ok(/<html lang="en">/.test(html));
  assert.ok(/<meta name="viewport"/.test(html));
  assert.ok(/<meta name="description"/.test(html));
  assert.ok(/<meta name="color-scheme"/.test(html));
  assert.ok(/<a class="skip" href="#main">/.test(html));
  assert.equal((html.match(/<main id="main">/g) || []).length, 1);
  assert.equal((html.match(/<\/main>/g) || []).length, 1);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'exactly one h1');
  assert.ok(html.includes('data-junkdrawer-deploy-footer'));
  assert.ok(/@media print/.test(html), 'a print stylesheet is present');
});


/* ---------------- the four artifacts, re-derived ---------------- */
t('every guide names a real file that is registered', () => {
  for (const g of C.guides()) {
    assert.ok(registry.pages[g.file], g.file + ' must be registered in junk-drawer.json');
    assert.ok(registry.pages[g.file].title.length > 0);
  }
});

t('every declared version matches the registry, not just the page', () => {
  for (const g of C.guides()) {
    assert.equal(g.version, registry.pages[g.file].version, g.file + ' version drift');
  }
  assert.equal(D.META.landing.version, registry.pages['infrastructure-field-guide.html'].version);
});

t('every declared section count matches the artifact', () => {
  for (const g of C.guides()) {
    assert.equal(g.sections, artifact[g.id].ids.size, g.file + ' section count drift');
  }
});

t('the promoted deep links exist as real sections in the real files', () => {
  for (const g of C.guides()) {
    assert.ok(g.deep.length >= 3, g.id + ' should promote at least three sections');
    for (const d of g.deep) {
      assert.ok(artifact[g.id].ids.has(d.view), g.file + ' has no ' + d.view);
    }
  }
});

t('every selector recommendation and second stop resolves to a real section', () => {
  for (const it of C.intents()) {
    assert.ok(artifact[it.guide], 'intent ' + it.id + ' names an unknown guide');
    assert.ok(artifact[it.guide].ids.has(it.view), 'intent ' + it.id + ' points at missing ' + it.guide + '#' + it.view);
    for (const a of it.also) {
      assert.ok(artifact[a.guide] && artifact[a.guide].ids.has(a.view),
        'intent ' + it.id + ' second stop missing ' + a.guide + '#' + a.view);
    }
  }
});

t('every step of every guided path resolves to a real section', () => {
  for (const p of C.paths()) {
    assert.ok(p.steps.length >= 3, 'path ' + p.id + ' is too short');
    for (const s of p.steps) {
      assert.ok(artifact[s.guide] && artifact[s.guide].ids.has(s.view),
        'path ' + p.id + ' step missing ' + s.guide + '#' + s.view);
    }
  }
});

t('the hero figure is the real sum of the four artifacts', () => {
  const real = Object.values(artifact).reduce((n, a) => n + a.ids.size, 0);
  assert.equal(C.sumSections(), real, 'the page says ' + C.sumSections() + ', the artifacts have ' + real);
  assert.ok(html.includes('id="statSections"'), 'the hero stat is rendered from the core');
});

t('every statically written artifact link points at a section that exists', () => {
  const seen = [];
  for (const l of staticLinks) {
    seen.push(l.href);
    const file = path.join(ROOT, l.file);
    assert.ok(fs.existsSync(file), 'static link to a missing file: ' + l.file);
    if (l.view) {
      const src = fs.readFileSync(file, 'utf8');
      assert.ok(new RegExp('id="' + l.view + '"').test(src), 'static link to a missing section: ' + l.href);
    }
  }
  assert.ok(seen.length > 20, 'expected many artifact links, found ' + seen.length);
});

t('the metadata table snapshot matches the registry and the artifacts', () => {
  const rows = C.metaRows();
  assert.equal(rows.length, 4);
  for (const r of rows) {
    assert.equal(r.version, registry.pages[r.file].version);
    const g = C.guides().filter(x => x.file === r.file)[0];
    assert.equal(r.sections, artifact[g.id].ids.size);
    assert.equal(r.verified, D.META.verified);
  }
});


/* ---------------- core behaviour ---------------- */
t('the page records its own version and update date, not just the four guides', () => {
  assert.ok(html.includes('id="landingVersion"') && html.includes('id="landingUpdated"'));
  assert.equal(D.META.landing.file, 'infrastructure-field-guide.html');
  assert.equal(D.META.landing.version, registry.pages['infrastructure-field-guide.html'].version);
  assert.equal(D.META.landing.updated, D.META.verified);
  assert.match(D.META.landing.updated, /^\d{4}-\d{2}-\d{2}$/);
});

t('the snapshot and the export agree about the date', () => {
  assert.equal(C.VERIFIED, D.META.verified);
  assert.match(C.VERIFIED, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(C.META.note.includes(C.VERIFIED), 'the note states the date it is about');
});

t('the selector is deterministic and refuses to invent an answer', () => {
  for (const it of C.intents()) {
    const a = json(C.recommend(it.id));
    const b = json(C.recommend(it.id));
    assert.deepEqual(a, b, 'recommend(' + it.id + ') is not deterministic');
    assert.equal(a.ok, true);
    assert.equal(a.primary.href, C.link(it.guide, it.view));
    assert.equal(a.alternates.length, 3, 'a recommendation should name the three other guides');
    assert.deepEqual(a.alternates.map(x => x.id), json(C.guides()).filter(g => g.id !== it.guide).map(g => g.id));
  }
  const bad = C.recommend('nope');
  assert.equal(bad.ok, false);
  assert.ok(bad.error.includes('nope'), 'the failure names the input it could not use');
  assert.equal(C.recommend('').ok, false);
  assert.equal(C.recommend(null).ok, false);
});

t('every link the page can produce is a safe relative link to a real file', () => {
  const all = C.allLinks();
  assert.ok(all.length >= 50, 'expected a substantial link inventory, found ' + all.length);
  for (const l of all) {
    assert.ok(C.isSafeLink(l.href), 'unsafe link: ' + l.href);
    assert.ok(fs.existsSync(path.join(ROOT, l.href.split('#')[0])), 'link to a missing file: ' + l.href);
    if (l.view) assert.ok(artifact[l.guide].ids.has(l.view), 'link to a missing section: ' + l.href);
  }
});

t('the safety rule rejects the shapes it is supposed to', () => {
  const bad = ['https://example.com/a.html', '//example.com/a.html', 'javascript:alert(1)',
    'data:text/html,x', 'page.html?a=1', '#view-start', '', 'mailto:a@b.c', '../../etc/passwd',
    'page.htm', 'a b.html', null, undefined, 42];
  for (const b of bad) assert.equal(C.isSafeLink(b), false, 'should reject: ' + JSON.stringify(b));
  assert.equal(C.isSafeLink('right-tool-for-the-job.html'), true);
  assert.equal(C.isSafeLink('do-i-need-aws-gcp.html#view-necessity'), true);
  assert.equal(C.guideOfHref('do-i-need-aws-gcp.html#view-audit').id, 'dng');
  assert.equal(C.guideOfHref('https://example.com'), null);
});

t('the in-page invariants all pass', () => {
  const st = json(C.selfTest());
  assert.equal(st.failed, 0, 'failing invariants: ' + st.checks.filter(c => !c.ok).map(c => c.name).join('; '));
  assert.ok(st.total >= 25, 'expected a meaningful invariant count, found ' + st.total);
});

t('the theme core resolves the three preferences', () => {
  const T = S.IFGThemeCore;
  assert.ok(T, 'the theme core is exported for testing');
  assert.equal(T.DEFAULT, 'light');
  assert.deepEqual(json(T.themes), ['light', 'dark', 'system']);
  assert.equal(T.resolve('light', true), 'light');
  assert.equal(T.resolve('dark', false), 'dark');
  assert.equal(T.resolve('system', true), 'dark');
  assert.equal(T.resolve('system', false), 'light');
  assert.equal(T.normalize('nonsense'), 'light');
  assert.deepEqual(json(T.readStored({ getItem: () => null })), { theme: 'light', intent: null });
  assert.equal(T.readStored({ getItem: () => '{oops' }).theme, 'light');
  assert.equal(T.readStored({ getItem: () => JSON.stringify({ theme: 'dark', intent: 'costs' }) }).intent, 'costs');
  assert.equal(T.readStored({ getItem: () => JSON.stringify({ intent: '<script>alert(1)</script>' }) }).intent, null);
  assert.equal(T.readStored({ getItem: () => JSON.stringify({ intent: 'x'.repeat(60) }) }).intent, null);
  assert.equal(T.readStored({ getItem: () => JSON.stringify(['not', 'an', 'object']) }).theme, 'light');
  assert.equal(T.key, 'ifg.prefs.v1');
});

t('light is the default, not something the operating system can override', () => {
  assert.ok(/var DEFAULT = 'light';/.test(block('ifg-theme')));
  const T = S.IFGThemeCore;
  assert.equal(T.resolve(T.DEFAULT, true), 'light', 'a dark OS must not override the page default');
});

/* ---------------- storage discipline ---------------- */
t('persistence is one small preference key, written through the guarded helper', () => {
  assert.equal(block('ifg-theme').match(/localStorage\.setItem/g), null, 'the theme bootstrap must not write');
  const app = block('ifg-app');
  assert.ok(/JDStorage\.setJSON\(KEY, prefs/.test(app), 'writes go through the guarded helper');
  assert.ok(/maxRetries/.test(app));
  const keys = [...html.matchAll(/'(ifg\.[A-Za-z0-9._-]+)'/g)].map(m => m[1]);
  const unique = [...new Set(keys)];
  assert.deepEqual(unique, ['ifg.prefs.v1'], 'the page should own exactly one storage key, found: ' + unique.join(', '));
});

t('nothing that can grow is stored, and no payload is stored', () => {
  const app = block('ifg-app');
  assert.ok(/slice\(0, 4\)/.test(app), 'the visited list is hard-capped at the four guides');
  assert.ok(/sanitizeVisited/.test(app), 'stored values are whitelisted on the way in');
  assert.ok(!/toDataURL|readAsDataURL|base64|Blob|FileReader/.test(html), 'no binary payloads');
  assert.ok(!/JSON\.stringify\(state\)|appState|fullState/.test(app), 'no whole-app-state blob');
});

t('the page imports no storage other than its own preference', () => {
  assert.ok(!/indexedDB/i.test(html), 'a landing page needs no database');
  assert.ok(!/sessionStorage/.test(html));
  assert.ok(!/document\.cookie/.test(html));
});

/* ---------------- editorial integrity ---------------- */
t('the page states its own limits rather than a vendor preference', () => {
  assert.ok(/not a universal prescription/i.test(text), 'the framing sentence is present');
  assert.ok(/stop paying/i.test(text), 'the goal sentence is present');
  assert.ok(/least complicated infrastructure/i.test(text), 'the framing question is present');
  assert.ok(/where my thinking has landed today/i.test(text));
  assert.ok(/does not begin by excluding most of the market/i.test(text));
  /* The page must actively keep the alternatives legitimate, not merely avoid
     insulting them. These two sentences are the load-bearing ones. */
  assert.ok(/isn.t a declaration that GitHub and Cloudflare are the only tools worth using/i.test(text),
    'the page denies that its two favourites are exclusive');
  assert.ok(/There.s a place for AWS and Google Cloud/i.test(text),
    'the page keeps the hyperscalers legitimate in its own words');
  /* Banned patterns must catch a positive claim without firing on the brief's
     own required sentence, "They're not the only correct answers". */
  const banned = [/obsolete/i, /universally superior/i, /(?<!not )\bthe only correct (?:answer|choice|way)\b/i,
    /you should always use/i, /AWS is dead/i, /GCP is dead/i, /\bno longer (?:needed|relevant|required)\b/i];
  for (const re of banned) assert.ok(!re.test(text), 'the page reads as a vendor claim matching ' + re);
  assert.ok(/not the only correct answers/i.test(text), 'the brief\'s closing caveat is stated verbatim');
});

t('every alternative provider the brief requires is discussed by name', () => {
  for (const n of ['Railway', 'Vercel', 'Fly.io', 'Render', 'DigitalOcean', 'Supabase']) {
    assert.ok(text.includes(n), 'missing alternative: ' + n);
  }
  assert.ok(/small persistent Linux instance/i.test(text), 'conventional VPS hosting is discussed');
  assert.ok(/hardware you already own/i.test(text), 'local computing is discussed');
  assert.ok(/No live pricing is published on this page/i.test(text), 'the page does not pretend to be a price list');
  assert.ok(/not exhaustive/i.test(text), 'the list is not presented as a directory');
});

t('the six field findings are present and link to their evidence', () => {
  for (const f of ['Overhead', 'Road Naturalist', 'CFLab', 'JunkDrawer', 'Collecting Nichols', 'The nine disagreements']) {
    assert.ok(text.includes(f), 'missing finding: ' + f);
  }
  assert.equal((html.match(/class="finding /g) || []).length, 6, 'six findings, one card each');
  assert.equal((html.match(/class="lesson"/g) || []).length, 6, 'each finding states a lesson');
  assert.ok(html.includes('id="finding-disagreements"'), 'the disagreement finding is addressable');
});

t('the disagreement numbers on the page match the audit report', () => {
  assert.equal(disagreements.stats.total, 9);
  assert.equal(disagreements.stats.agreements, 27);
  assert.ok(/36 scenarios/.test(text), 'the scenario total is stated');
  assert.ok(/27 of them/.test(text), 'the agreement total is stated');
  const b = disagreements.stats.byClass;
  assert.equal(b.implementation_defect + b.scoring_weakness + b.capability_data_weakness + b.missing_requirement, 9);
  assert.ok(/two implementation defects/.test(text));
  assert.ok(/three scoring or/.test(text));
  assert.ok(/two capability-data weaknesses/.test(text));
  assert.ok(/two requirement-vocabulary/.test(text));
  assert.ok(/no file in the audited artifact was modified/i.test(text), 'the audit is reported as a finding, not a fix');
  assert.ok(/documented, not patched/i.test(text));
});

t('the page does not claim work that was not done', () => {
  const banned = [/\bwe fixed\b/i, /\bhas been fixed\b/i, /\bnow agrees\b/i, /\bwe migrated\b/i,
    /\bmigrated to\b/i, /\breduced our bill\b/i, /\bsaved us \d/i, /\bcut costs by\b/i, /\bimproved by \d/i];
  for (const re of banned) assert.ok(!re.test(text), 'unsupported claim matching ' + re);
});

/* ---------------- report ---------------- */
if (failures.length) {
  console.error('failures:');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log('ok    infrastructure-field-guide: ' + passed + ' passed, 0 failed');

