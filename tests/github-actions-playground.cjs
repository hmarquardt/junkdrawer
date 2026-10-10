/* Unit tests for github-actions-playground.html
   Run: node tests/github-actions-playground.cjs
   Extracts the page's <script id="gap-core"> block and exercises the pure
   functions (cron parsing, cost model, YAML lint, search ranking, state
   sanitising) plus every bundled recipe's embedded YAML and the data sets the
   page renders. No npm, no browser, no network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'github-actions-playground.html');
const html = fs.readFileSync(PAGE, 'utf8');

const coreMatch = html.match(/<script id="gap-core">([\s\S]*?)<\/script>/);
assert.ok(coreMatch, 'gap-core script block must exist in the page');
const sandbox = { console, Date, Math, JSON, isFinite, Number, String, Object, Array, RegExp };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(coreMatch[1], sandbox);
const C = sandbox.GAPCore;
const json = v => JSON.parse(JSON.stringify(v));

let passed = 0;
const failures = [];
function t(name, fn) {
  try { fn(); passed += 1; }
  catch (err) { failures.push(name + ': ' + err.message); }
}

/* ---------------- page integration ---------------- */
t('footer version matches the junk-drawer.json entry in all three places', () => {
  const m = html.match(/data-deploy-version="([\d.]+)"/);
  assert.ok(m, 'footer data-deploy-version present');
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'junk-drawer.json'), 'utf8'));
  assert.equal(reg.pages['github-actions-playground.html'].version, m[1]);
  assert.ok(html.includes('JUNKDRAWER_DEPLOY_FOOTER version="' + m[1] + '"'));
  assert.ok(html.includes('version ' + m[1]));
});
t('exactly one analytics-lite tag (the JunkDrawer convention)', () => {
  assert.equal((html.match(/<script[^>]*analytics-lite\.js/g) || []).length, 1, 'one analytics tag');
  assert.ok(html.includes('data-site-id="junkdrawer"'));
});
t('every section carries the metadata the navigation needs', () => {
  const sections = html.match(/<section class="view[^>]*>/g) || [];
  assert.ok(sections.length >= 20, 'sections: ' + sections.length);
  sections.forEach(s => {
    assert.ok(/id="view-[a-z0-9-]+"/.test(s), 'id: ' + s.slice(0, 60));
    assert.ok(/data-title="/.test(s), 'data-title: ' + s.slice(0, 60));
    assert.ok(/data-group="/.test(s), 'data-group: ' + s.slice(0, 60));
  });
});
t('the page makes no network calls without a click', () => {
  const fetches = html.match(/fetch\(/g) || [];
  assert.equal(fetches.length, 1, 'one opt-in fetch (the live workflow check)');
  assert.ok(html.includes('api.github.com/repos/hmarquardt/junkdrawer'));
});
t('no secrets, tokens or keys are embedded', () => {
  ['ghp_', 'sk-', 'AKIA', 'CLOUDFLARE_API_TOKEN=', 'Bearer ey'].forEach(bad => {
    assert.ok(!html.includes(bad), 'page must not contain ' + bad);
  });
});

/* ---------------- cron ---------------- */
t('cron: daily 06:23 UTC fires on consecutive days', () => {
  const r = C.cronNext('23 6 * * *', Date.UTC(2026, 9, 10, 0, 0), 3);
  assert.ok(r.ok);
  assert.equal(C.fmtUtc(r.runs[0]), '2026-10-10 06:23Z');
  assert.equal(C.fmtUtc(r.runs[1]), '2026-10-11 06:23Z');
  assert.equal(r.runs[1] - r.runs[0], 86400000);
});
t('cron: the repository monthly entry resolves to the 1st', () => {
  const r = C.cronNext('17 6 1 * *', Date.UTC(2026, 9, 10, 0, 0), 2);
  assert.equal(C.fmtUtc(r.runs[0]), '2026-11-01 06:17Z');
});
t('cron: steps, lists and weekday names', () => {
  assert.deepEqual(json(C.cronNext('*/15 * * * *', Date.UTC(2026, 0, 1, 10, 0), 2).runs.map(C.fmtUtc)), ['2026-01-01 10:15Z', '2026-01-01 10:30Z']);
  assert.deepEqual(json(C.cronNext('0 9 * * MON,WED', Date.UTC(2026, 0, 1, 0, 0), 2).runs.map(C.fmtUtc)), ['2026-01-05 09:00Z', '2026-01-07 09:00Z']);
});
t('cron: day-of-month OR day-of-week follows POSIX', () => {
  const p = C.parseCron('0 12 1-7 * MON');
  assert.ok(p.ok);
  assert.equal(p.domRestricted, true);
  assert.equal(p.dowRestricted, true);
  assert.equal(C.fmtUtc(C.cronNext('0 12 1-7 * MON', Date.UTC(2026, 9, 1, 0, 0), 1).runs[0]), '2026-10-01 12:00Z');
});
t('cron: 7 is Sunday', () => {
  assert.equal(C.fmtUtc(C.cronNext('0 0 * * 7', Date.UTC(2026, 9, 6, 0, 0), 1).runs[0]), '2026-10-11 00:00Z');
});
t('cron: malformed expressions fail with a reason', () => {
  ['', '23 6 * *', '99 6 * * *', '0 0 32 * *', '* * * FOO *', '5-1 * * * *', '*/0 * * * *'].forEach(bad => {
    const p = C.parseCron(bad);
    assert.equal(p.ok, false, 'should reject "' + bad + '"');
    assert.ok(p.error && p.error.length > 4, 'error text for "' + bad + '"');
  });
  assert.equal(C.parseCron('23 6 * * *').ok, true);
  assert.equal(C.cronNext('nonsense', Date.now(), 1).runs.length, 0);
});
t('cron: explanation names all five fields and flags the POSIX rule', () => {
  const ex = C.cronExplain('0 12 1-7 * MON');
  assert.equal(ex.lines.length, 5);
  assert.ok(ex.notes.join(' ').includes('POSIX'));
});

/* ---------------- cost model ---------------- */
t('cost: public repository on a standard runner is free at any volume', () => {
  const r = C.costEstimate({ visibility: 'public', plan: 'free', runner: 'linux_2', jobsPerRun: 4, minutesPerJob: 12, runsPerDay: 24, daysPerMonth: 30 });
  assert.equal(r.runnerCost, 0);
  assert.equal(r.billableMinutes, 0);
  assert.equal(r.total, 0);
  assert.equal(r.billedMinutes, 4 * 12 * 24 * 30);
});
t('cost: minutes round up per job', () => {
  const r = C.costEstimate({ visibility: 'private', plan: 'pro', runner: 'linux_2', jobsPerRun: 1, minutesPerJob: 1.1, runsPerDay: 1, daysPerMonth: 1, alreadyUsedMinutes: 3000 });
  assert.equal(r.roundedPerJob, 2);
  assert.equal(r.billableMinutes, 2);
  assert.equal(Number(r.runnerCost.toFixed(4)), 0.012);
});
t('cost: usage inside the plan allowance bills nothing', () => {
  const r = C.costEstimate({ visibility: 'private', plan: 'free', runner: 'linux_2', jobsPerRun: 1, minutesPerJob: 30, runsPerDay: 1, daysPerMonth: 30 });
  assert.equal(r.billedMinutes, 900);
  assert.equal(r.billableMinutes, 0);
  assert.equal(r.total, 0);
  assert.equal(r.remainingIncludedMinutes, 2000);
});
t('cost: only the excess over the allowance bills', () => {
  const r = C.costEstimate({ visibility: 'private', plan: 'free', runner: 'linux_2', jobsPerRun: 1, minutesPerJob: 100, runsPerDay: 1, daysPerMonth: 30, alreadyUsedMinutes: 1000 });
  assert.equal(r.billedMinutes, 3000);
  assert.equal(r.billableMinutes, 2000);
  assert.equal(Number((r.billableMinutes * r.rate).toFixed(2)), 12);
});
t('cost: larger runners ignore included minutes entirely', () => {
  const r = C.costEstimate({ visibility: 'public', plan: 'enterprise', runner: 'linux_16', jobsPerRun: 1, minutesPerJob: 10, runsPerDay: 1, daysPerMonth: 2 });
  assert.equal(r.larger, true);
  assert.equal(r.billableMinutes, 20);
  assert.equal(Number(r.runnerCost.toFixed(3)), Number((20 * 0.042).toFixed(3)));
  assert.ok(r.notes.join(' ').includes('cannot use included minutes'));
});
t('cost: self-hosted is free and says so', () => {
  const r = C.costEstimate({ visibility: 'private', plan: 'team', runner: 'self_hosted', jobsPerRun: 2, minutesPerJob: 60, runsPerDay: 5, daysPerMonth: 30 });
  assert.equal(r.runnerCost, 0);
  assert.equal(r.selfHosted, true);
  assert.ok(r.notes.join(' ').includes('no billed minutes'));
});
t('cost: documented rates are the ones in the page', () => {
  assert.deepEqual(json(C.RATES), {
    linux_slim: 0.002, linux_2: 0.006, linux_2_arm: 0.005, windows_2: 0.010,
    windows_2_arm: 0.010, macos: 0.062, linux_4: 0.012, linux_8: 0.022,
    linux_16: 0.042, linux_32: 0.082, linux_64: 0.162, windows_4: 0.022,
    windows_8: 0.042, macos_12: 0.077, macos_5_pro: 0.102, linux_4_gpu: 0.052,
    windows_4_gpu: 0.102, self_hosted: 0
  });
  assert.deepEqual(json(C.QUOTAS.free), { label: 'GitHub Free', minutes: 2000, storageGB: 0.5 });
  assert.deepEqual(json(C.QUOTAS.enterprise), { label: 'Enterprise Cloud', minutes: 50000, storageGB: 50 });
  assert.equal(C.STORAGE_RATES.shared, 0.25);
  assert.equal(C.STORAGE_RATES.cache, 0.07);
  assert.ok(C.RATES.macos / C.RATES.linux_2 > 9, 'macOS is an order of magnitude above Linux');
});
t('cost: storage is estimated separately per SKU', () => {
  const r = C.costEstimate({ visibility: 'private', plan: 'free', runner: 'linux_2', jobsPerRun: 1, minutesPerJob: 1, runsPerDay: 1, daysPerMonth: 1, artifactGB: 20, retentionDays: 30, cacheGB: 30 });
  assert.equal(Number(r.storageBillableGB.toFixed(3)), 19.5);
  assert.equal(Number(r.cacheBillableGB.toFixed(3)), 20);
  assert.equal(Number((r.storageCost + r.cacheCost).toFixed(2)), 6.28);
});
t('cost: nonsense input cannot produce NaN or Infinity', () => {
  const r = C.costEstimate({ visibility: 'nonsense', plan: 'nope', runner: 'unknown', jobsPerRun: 'x', minutesPerJob: null, runsPerDay: -4, daysPerMonth: 99, artifactGB: 'y', retentionDays: 0 });
  ['runnerCost', 'storageCost', 'cacheCost', 'total', 'billedMinutes', 'wallClockMinutes'].forEach(k => assert.ok(Number.isFinite(r[k]), k));
  assert.equal(r.total, 0);
  assert.equal(r.planLabel, C.QUOTAS.free.label);
  assert.equal(r.runnerLabel, C.RUNNER_LABEL.linux_2);
  assert.ok(r.notes.length >= 2);
});
t('cost boundaries cover every documented transition', () => {
  ['public-to-private', 'standard-to-larger', 'quota-exhausted', 'artifact-sprawl', 'cache-over-10gb', 'macos-matrix', 'self-hosted', 'external-api'].forEach(id => {
    const b = C.boundaryVerdict(id);
    assert.ok(b, id + ' exists');
    ['pick', 'verdict', 'detail', 'zeros', 'avoid'].forEach(k => assert.ok(b[k] && b[k].length > 3, id + '.' + k));
  });
  assert.equal(C.boundaryVerdict('nope'), null);
});

/* ---------------- permissions ---------------- */
t('permissions: every objective declares a minimal block, a reason and a trap', () => {
  assert.ok(C.PERM_TARGETS.length >= 8);
  C.PERM_TARGETS.forEach(p => {
    assert.ok(p.perms.includes('permissions:'), p.id + ' declares permissions');
    assert.ok(p.why.length > 10 && p.trap.length > 10, p.id);
  });
  assert.ok(C.permissionsFor('pages-deploy').perms.includes('id-token: write'));
  assert.ok(C.permissionsFor('commit-data').perms.includes('contents: write'));
  assert.ok(!C.permissionsFor('test-only').perms.includes('write'));
  assert.equal(C.permissionsFor('nope'), null);
});

/* ---------------- YAML lint ---------------- */
t('yaml: accepts a well-formed workflow', () => {
  const r = C.yamlLint('name: X\non:\n  push:\n    branches: [main]\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n');
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(json(r.topKeys), ['name', 'on', 'jobs']);
});
t('yaml: flags tabs, odd indentation, duplicate keys and missing required keys', () => {
  assert.equal(C.yamlLint('name: x\non:\tpull_request\njobs:\n  a:\n    steps: []\n').ok, false);
  assert.equal(C.yamlLint('name: x\non: push\njobs:\n   a:\n    runs-on: ubuntu-latest\n').ok, false);
  assert.equal(C.yamlLint('name: x\nname: y\non: push\njobs: {}\n').ok, false);
  const missing = C.yamlLint('name: x\nsteps: []\n');
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.join(' ').includes('on:'));
  assert.equal(C.yamlLint('# comments only\n').ok, false);
});
t('yaml: every bundled recipe parses and is complete', () => {
  assert.ok(C.RECIPES.length >= 12, 'recipes: ' + C.RECIPES.length);
  const ids = new Set();
  C.RECIPES.forEach(r => {
    ['id', 'title', 'cat', 'purpose', 'when', 'setup', 'verify', 'trouble', 'cost', 'yaml'].forEach(k => {
      const min = (k === 'cat') ? 2 : 4;
      assert.ok(r[k] && String(r[k]).length >= min, r.id + ' missing ' + k);
    });
    assert.ok(!ids.has(r.id), 'duplicate recipe id ' + r.id);
    ids.add(r.id);
    const lint = C.yamlLint(r.yaml);
    assert.equal(lint.ok, true, r.id + ' YAML: ' + JSON.stringify(lint.errors));
    assert.ok(lint.topKeys.includes('on'), r.id + ' declares a trigger');
    assert.ok(lint.topKeys.includes('jobs'), r.id + ' declares jobs');
  });
});
t('yaml: recipes pin every third-party action', () => {
  C.RECIPES.forEach(r => {
    (r.yaml.match(/uses:\s*(\S+)/g) || []).forEach(u => {
      const ref = u.replace(/uses:\s*/, '');
      if (ref.startsWith('./') || ref.startsWith('docker://')) return;
      assert.ok(/@v\d|@\d/.test(ref), r.id + ' pins ' + ref);
    });
  });
});
t('yaml: recipes that write declare contents: write', () => {
  C.RECIPES.filter(r => /git push|gh release create/.test(r.yaml)).forEach(r => {
    assert.ok(/contents:\s*write/.test(r.yaml), r.id + ' declares contents: write');
  });
});

/* ---------------- search ranking ---------------- */
t('search: title hits outrank body hits, non-matches are rejected', () => {
  assert.ok(C.rankMatch('cron', 'Cron playground', 'unrelated') > C.rankMatch('cron', 'Other', 'about cron'));
  assert.equal(C.rankMatch('zzzznotthere', 'Cron', 'cron cron'), -1);
  assert.equal(C.rankMatch('', 'Cron', 'body'), -1);
  assert.ok(C.rankMatch('cron playground', 'Cron playground', '') > 0);
});
t('search: the page has enough indexable headings to be worth searching', () => {
  const headings = (html.match(/<h[234][ >]/g) || []).length;
  assert.ok(headings >= 40, 'headings: ' + headings);
});

/* ---------------- state sanitising ---------------- */
t('state: sanitizePrefs defaults safely and bounds everything', () => {
  const s = C.sanitizePrefs(null);
  assert.equal(s.tab, 'view-start');
  assert.deepEqual(json(s.bookmarks), []);
  const messy = C.sanitizePrefs({
    tab: 'javascript:alert(1)',
    bookmarks: ['view-a', 'view-a'].concat(Array.from({ length: 90 }, (_, i) => 'b' + i)),
    recents: Array.from({ length: 40 }, (_, i) => 'r' + i),
    visited: { 'view-x': 1, 'view-y': 0 },
    experiments: { 1: true, 2: false },
    costInputs: { cMinutes: 12, cPlan: 'pro', bogus: { nested: true } },
    cronExpr: 'x'.repeat(400),
    theme: 'System'
  });
  assert.equal(messy.tab, 'view-start', 'invalid tab rejected');
  assert.ok(messy.bookmarks.length <= 64);
  assert.equal(messy.bookmarks.filter(b => b === 'view-a').length, 1, 'dedupes');
  assert.ok(messy.recents.length <= 12);
  assert.deepEqual(json(Object.keys(messy.visited)), ['view-x']);
  assert.deepEqual(json(Object.keys(messy.experiments)), ['1']);
  assert.equal(messy.costInputs.cMinutes, 12);
  assert.equal(messy.cronExpr.length, 120);
  assert.equal(messy.theme, 'light', 'a theme that is not exactly light, dark or system falls back to light');
  assert.equal(s.theme, 'light', 'fresh state starts light');
  ['light', 'dark', 'system'].forEach(v => assert.equal(C.sanitizePrefs({ theme: v }).theme, v));
  assert.equal(C.sanitizePrefs({ theme: { nested: 'dark' } }).theme, 'light');
  assert.equal(C.sanitizePrefs({ theme: 1 }).theme, 'light');
  assert.ok(!('contrast' in s), 'the removed contrast flag is no longer part of stored state');
});
t('state: the page writes only the three documented localStorage keys', () => {
  const uniq = Array.from(new Set(html.match(/gaPlayground\.[a-zA-Z0-9.]+/g) || [])).sort();
  assert.deepEqual(json(uniq), ['gaPlayground.costInputs.v1', 'gaPlayground.experiments.v1', 'gaPlayground.prefs.v1']);
  assert.ok(html.includes('JDStorage.setJSON'), 'uses the guarded helper');
  assert.ok(html.includes('jd-storage.js'), 'loads the helper');
});

/* ---------------- data integrity ---------------- */
t('runner catalogue covers the labels the manual names', () => {
  const labels = C.RUNNERS.map(r => r.label).join(' ');
  ['ubuntu-slim', 'ubuntu-latest', 'arm', 'windows', 'macos', 'self-hosted'].forEach(k => assert.ok(labels.includes(k), 'mentions ' + k));
  assert.ok(C.RUNNERS.length >= 14, 'runner rows: ' + C.RUNNERS.length);
  assert.ok(C.LARGER.includes('linux_4') && !C.LARGER.includes('linux_2'));
});
t('event catalogue marks privileged triggers honestly', () => {
  const byName = new Map(C.EVENTS.map(e => [e.name, e]));
  ['push', 'pull_request', 'pull_request_target', 'schedule', 'workflow_dispatch', 'workflow_call', 'workflow_run', 'repository_dispatch', 'release', 'issue_comment', 'check_run', 'deployment', 'watch'].forEach(n => assert.ok(byName.has(n), n));
  assert.equal(byName.get('pull_request_target').trust, 'privileged');
  assert.equal(byName.get('issue_comment').trust, 'privileged');
  assert.equal(byName.get('schedule').trust, 'safe');
  assert.ok(C.EVENTS.length >= 20);
});
t('action versions cite the verification date and the checkout change', () => {
  assert.ok(C.ACTIONS.length >= 10);
  C.ACTIONS.forEach(a => assert.ok(a.major && a.note, a.name));
  assert.equal(C.VERIFIED, '2026-10-10');
  assert.ok(C.ACTIONS.find(a => a.name === 'actions/checkout').note.includes('pwn-request'));
});
t('experiments, opportunities, glossary and sources are populated', () => {
  assert.equal(C.EXPERIMENTS.length, 15);
  C.EXPERIMENTS.forEach(e => ['n', 'title', 'goal', 'teaches', 'cost', 'steps', 'yaml', 'verify', 'cleanup', 'fails']
    .forEach(k => assert.ok(e[k] !== undefined, 'experiment ' + e.n + ' missing ' + k)));
  assert.ok(C.OPPORTUNITIES.length >= 14);
  C.OPPORTUNITIES.forEach(o => {
    assert.ok(o.value >= 1 && o.value <= 5, o.title + ' value');
    assert.ok(o.ease >= 1 && o.ease <= 5, o.title + ' ease');
    assert.ok(o.verdict && o.verdict.length > 10, o.title + ' verdict');
  });
  assert.ok(C.GLOSSARY.length >= 30);
  assert.ok(C.SOURCES.length >= 20);
  C.SOURCES.forEach(s => {
    assert.ok(/^https:\/\//.test(s[1]), s[0] + ' has an https source');
    assert.equal(s[3], '2026-10-10', s[0] + ' carries a retrieval date');
  });
});
t('decision trees terminate and contain no cycles', () => {
  assert.ok(C.TREES.length >= 2);
  C.TREES.forEach(tree => {
    const seen = new Set();
    const stack = new Set();
    const walk = id => {
      assert.ok(!stack.has(id), tree.id + ' cycle at ' + id);
      if (seen.has(id)) return;
      seen.add(id);
      stack.add(id);
      const node = tree.nodes[id];
      assert.ok(node, tree.id + ' missing node ' + id);
      if (node.a) { assert.ok(node.a.length > 20, tree.id + ' answer ' + id); stack.delete(id); return; }
      assert.ok(node.q && node.opts && node.opts.length >= 2, tree.id + ' question ' + id);
      node.opts.forEach(o => { assert.ok(typeof o[0] === 'string' && typeof o[1] === 'string', tree.id + ' option shape'); walk(o[1]); });
      stack.delete(id);
    };
    walk('q1');
    assert.ok(seen.size >= 6, tree.id + ' reachable nodes: ' + seen.size);
  });
});
t('inventory documents the repository workflow accurately', () => {
  assert.equal(C.INVENTORY.length, 1);
  const w = C.INVENTORY[0];
  assert.equal(w.file, '.github/workflows/overhead-data.yml');
  assert.ok(w.permissions.includes('contents: write'));
  assert.ok(w.triggers.includes('23 6 * * *') && w.triggers.includes('17 6 1 * *'));
  assert.ok(w.external.includes('JPL') && w.external.includes('COBS'));
  assert.ok(w.mutates.startsWith('Yes'));
});
t('reference tables are populated', () => {
  assert.ok(C.REF.contexts.length >= 10);
  assert.ok(C.REF.env.length >= 10);
  assert.ok(C.REF.funcs.length >= 6);
  assert.ok(C.REF.cli.length >= 8);
});

/* ---------------- theme resolution (gap-theme, extracted and run isolated) ---------------- */
const themeMatch = html.match(/<script id="gap-theme">([\s\S]*?)<\/script>/);
assert.ok(themeMatch, 'gap-theme script block must exist in the page');
const themeSource = themeMatch[1];

/* Runs the real resolver in a vm with a stubbed window, so every rule is exercised
   as written rather than re-implemented in the test. */
function loadTheme(opts) {
  const o = opts || {};
  const attrs = {};
  const systemListeners = [];
  const mql = {
    matches: !!o.prefersDark,
    addEventListener(type, fn) { systemListeners.push(fn); },
  };
  const stored = o.stored || {};
  const storage = o.brokenStorage
    ? { getItem() { throw new Error('storage disabled'); } }
    : { getItem(k) { return Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : null; } };
  const win = {
    document: { documentElement: { setAttribute(k, v) { attrs[k] = v; } } },
    matchMedia() { return mql; },
    localStorage: storage,
  };
  win.window = win;
  const sandbox = { window: win, console, JSON, Object, Array, String, RegExp, Math, Date, isFinite };
  vm.createContext(sandbox);
  vm.runInContext(themeSource, sandbox);
  return {
    attrs, mql, theme: win.GAPTheme, core: win.GAPThemeCore,
    /* simulate the operating system switching appearance while the page is open */
    changeSystem(dark) { mql.matches = dark; systemListeners.forEach(fn => fn()); },
  };
}
const prefKey = 'gaPlayground.prefs.v1';

t('theme: the core declares light as the default and only three choices', () => {
  const { core } = loadTheme();
  assert.deepEqual(json(core.themes), ['light', 'dark', 'system']);
  assert.equal(core.DEFAULT, 'light');
  assert.equal(core.key, prefKey);
  assert.equal(core.normalize('dark'), 'dark');
  assert.equal(core.normalize('system'), 'system');
  assert.equal(core.resolve('light', true), 'light');
  assert.equal(core.resolve('dark', false), 'dark');
  assert.equal(core.resolve('system', true), 'dark');
  assert.equal(core.resolve('system', false), 'light', 'system without an OS dark preference is light');
});

t('theme: anything that is not an explicit theme choice means light', () => {
  const { core } = loadTheme();
  ['', null, undefined, 'DARK', 'midnight', 'system ', 0, {}, [], 'true', 'auto'].forEach(v => {
    assert.equal(core.normalize(v), 'light', 'normalize(' + JSON.stringify(v) + ')');
    assert.equal(core.resolve(v, true), 'light', 'an OS dark preference must not override ' + JSON.stringify(v));
  });
  assert.equal(core.readStored(null), 'light', 'no storage at all');
  assert.equal(core.readStored({ getItem: () => 'not json' }), 'light', 'unparseable payload');
  assert.equal(core.readStored({ getItem: () => 'null' }), 'light', 'JSON null');
  assert.equal(core.readStored({ getItem: () => '[]' }), 'light', 'JSON array');
  assert.equal(core.readStored({ getItem: () => JSON.stringify({ bookmarks: ['view-cost'], contrast: true }) }), 'light',
    'a legacy pref with no theme field carries no theme decision');
  assert.equal(core.readStored({ getItem: () => JSON.stringify({ theme: 'dark' }) }), 'dark');
});

t('theme: a fresh visitor is light even when the operating system prefers dark', () => {
  const fresh = loadTheme({ prefersDark: true });
  assert.equal(fresh.attrs['data-theme'], 'light', 'default is light regardless of the OS preference');
  assert.equal(fresh.attrs['data-theme-pref'], 'light');
  assert.equal(fresh.theme.state().resolved, 'light');

  const legacy = loadTheme({ prefersDark: true, stored: { [prefKey]: JSON.stringify({ bookmarks: [], contrast: true }) } });
  assert.equal(legacy.attrs['data-theme'], 'light');
  assert.equal(legacy.theme.state().pref, 'light');

  const broken = loadTheme({ prefersDark: true, brokenStorage: true });
  assert.equal(broken.attrs['data-theme'], 'light', 'a blocked localStorage must not break theming');
});

t('theme: the stored choice is applied to <html> before anything renders', () => {
  const dark = loadTheme({ stored: { [prefKey]: JSON.stringify({ theme: 'dark' }) } });
  assert.equal(dark.attrs['data-theme'], 'dark');
  assert.equal(dark.attrs['data-theme-pref'], 'dark');
  const light = loadTheme({ stored: { [prefKey]: JSON.stringify({ theme: 'light' }) }, prefersDark: true });
  assert.equal(light.attrs['data-theme'], 'light', 'an explicit light choice beats an OS dark preference');
});

t('theme: system mode follows the OS, live, while the page is open', () => {
  const sys = loadTheme({ prefersDark: true, stored: { [prefKey]: JSON.stringify({ theme: 'system' }) } });
  assert.equal(sys.attrs['data-theme'], 'dark', 'system + OS dark = dark');
  assert.equal(sys.attrs['data-theme-pref'], 'system', 'the preference itself stays system');
  sys.changeSystem(false);
  assert.equal(sys.attrs['data-theme'], 'light', 'the OS switches to light while the page is open');
  sys.changeSystem(true);
  assert.equal(sys.attrs['data-theme'], 'dark', 'and back again');

  const explicit = loadTheme({ prefersDark: false, stored: { [prefKey]: JSON.stringify({ theme: 'dark' }) } });
  assert.equal(explicit.attrs['data-theme'], 'dark');
  explicit.changeSystem(true);
  assert.equal(explicit.attrs['data-theme'], 'dark', 'explicit dark ignores OS changes');
  assert.equal(explicit.theme.set('system'), 'system');
  assert.equal(explicit.attrs['data-theme'], 'dark', 'switching to system re-resolves against the current OS');
  assert.equal(explicit.theme.set('nonsense'), 'light', 'set() normalises anything unknown');
});

t('theme: the stylesheet never follows the OS on its own', () => {
  const cssBlock = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.equal(/@media\s*\(prefers-color-scheme/.test(cssBlock), false,
    'the resolver owns that decision, so a stored choice always wins');
  assert.equal((html.match(/prefers-color-scheme/g) || []).length, 1,
    'exactly one prefers-color-scheme query in the page — the gap-theme resolver');
  assert.ok(html.indexOf('<script id="gap-theme">') < html.indexOf('<style>'),
    'the resolver runs before the stylesheet, so there is no flash of the wrong theme');
  assert.ok(html.includes('<meta name="color-scheme" content="light dark">'));
  assert.ok(!/#btnTheme|prefs\.contrast/.test(html), 'the old contrast toggle is gone');
});

t('theme: the control in the bar offers exactly light, dark and system', () => {
  const sel = html.match(/<select id="themeSel"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(sel, 'a theme selector exists');
  assert.deepEqual(json([...sel[1].matchAll(/<option value="([a-z]+)"/g)].map(m => m[1])), ['light', 'dark', 'system']);
  assert.ok(/<label class="sr-only" id="themeLab" for="themeSel">/.test(html), 'a real label is associated');
  assert.ok(/id="themeIco"[^>]*aria-hidden="true"/.test(html), 'the sun/moon glyph is decorative');
  assert.ok(/window\.GAPTheme\.onChange\(paint\)/.test(html), 'the control follows programmatic changes (system mode)');
});

/* ---------------- palette: token discipline and WCAG AA ---------------- */
const cssText = html.match(/<style>([\s\S]*?)<\/style>/)[1];
function tokenBlock(selector) {
  const m = cssText.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
  const out = {};
  if (!m) return out;
  m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(';').forEach(decl => {
    const i = decl.indexOf(':');
    if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  });
  return out;
}
const light = tokenBlock(':root');
const dark = tokenBlock('html[data-theme="dark"]');

function luminance(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map(i => {
    const s = parseInt(full.slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

t('palette: light is the default set and the dark set is opt-in', () => {
  assert.equal(light['--bg'], '#ffffff', 'white reading surface by default');
  assert.equal(light['--surface'], '#ffffff');
  assert.equal(light['--bg-app'], '#f8fafc');
  assert.equal(light['--text'], '#172033');
  assert.equal(light['--surface-code'], '#f6f8fa', 'code is light by default too');
  assert.ok(/(^|\n)\s*:root\{[^}]*color-scheme:\s*light/.test(cssText), 'the default block declares a light colour scheme');
  assert.equal(dark['--bg'], '#0d1117', 'dark lives in its own token set');
  assert.equal(dark['--surface-code'], '#161b22');
  const darkRule = cssText.match(/html\[data-theme="dark"\]\s*\{[^}]*\}/)[0];
  assert.ok(/color-scheme:\s*dark/.test(darkRule));
  // every colour-valued token must exist in both sets, or a component silently inherits the wrong theme
  const colourKeys = Object.keys(light).filter(k => /^(#|rgba?\()/i.test(light[k]));
  assert.ok(colourKeys.length >= 30, 'colour tokens in the light set: ' + colourKeys.length);
  const missing = colourKeys.filter(k => !(k in dark));
  assert.deepEqual(missing, [], 'colour tokens with no dark counterpart: ' + missing.join(', '));
});

t('palette: no component hardcodes a colour, a gradient or a glow', () => {
  const withoutTokens = cssText.replace(/(:root|html\[data-theme[^{]*)\{[^}]*\}/g, '');
  const hexes = [...withoutTokens.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0]);
  assert.deepEqual(hexes, [], 'colour literals outside the token blocks: ' + hexes.join(' '));
  assert.ok(!/gradient/.test(withoutTokens), 'no gradients in component rules');
  assert.ok(!/blur\(|drop-shadow/.test(withoutTokens), 'no glow or blur effects');
});

t('palette: every text/background pair in both themes meets WCAG AA', () => {
  const pairs = [
    ['--text', '--bg'], ['--text', '--surface'], ['--text', '--surface-2'], ['--text', '--surface-3'],
    ['--text-2', '--bg'], ['--text-2', '--surface'], ['--text-2', '--surface-2'], ['--text-2', '--surface-3'],
    ['--text-3', '--bg'], ['--text-3', '--surface'], ['--text-3', '--surface-2'],
    ['--accent', '--bg'], ['--accent', '--surface'], ['--accent', '--accent-soft'],
    ['--success', '--surface'], ['--success', '--success-soft'],
    ['--warning', '--surface'], ['--warning', '--warning-soft'],
    ['--danger', '--surface'], ['--danger', '--danger-soft'],
    ['--violet', '--surface'], ['--violet', '--violet-soft'],
    ['--pink', '--surface'], ['--pink', '--pink-soft'],
    ['--syn-key', '--surface-code'], ['--syn-str', '--surface-code'], ['--syn-num', '--surface-code'],
    ['--syn-com', '--surface-code'], ['--syn-exp', '--surface-code'], ['--syn-bool', '--surface-code'],
    ['--text', '--surface-code'],
  ];
  [['light', light], ['dark', dark]].forEach(([name, tokens]) => {
    pairs.forEach(([fg, bg]) => {
      assert.ok(tokens[fg] && tokens[bg], name + ': ' + fg + ' or ' + bg + ' is missing');
      const r = contrast(tokens[fg], tokens[bg]);
      assert.ok(r >= 4.5, name + ': ' + fg + ' on ' + bg + ' = ' + r.toFixed(2) + ':1 (AA needs 4.5:1)');
    });
  });
});

/* ---------------- report ---------------- */
if (failures.length) {
  console.error('FAIL: ' + failures.length + ' of ' + (passed + failures.length) + ' checks failed\n');
  failures.forEach(f => console.error('  x ' + f));
  process.exit(1);
}
console.log('github-actions-playground: ' + passed + ' checks passed, 0 failed');
console.log('  recipes ' + C.RECIPES.length + ' | events ' + C.EVENTS.length + ' | runners ' + C.RUNNERS.length +
            ' | experiments ' + C.EXPERIMENTS.length + ' | opportunities ' + C.OPPORTUNITIES.length +
            ' | glossary ' + C.GLOSSARY.length + ' | sources ' + C.SOURCES.length);
