/* Unit tests for cloudflare-developer-playground.html
   Run: node tests/cloudflare-developer-playground.cjs
   Extracts the page's data and core script blocks and exercises the pure
   functions (cost model, decision engine, cron parser, search ranking,
   tree walking) plus the integrity of every bundled data set.
   No npm, no browser, no network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'cloudflare-developer-playground.html');
const html = fs.readFileSync(PAGE, 'utf8');

function block(id) {
  const m = html.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)<\\/script>'));
  assert.ok(m, id + ' script block must exist in the page');
  return m[1];
}

const sandbox = { console, Date, Math, JSON, isFinite, Number, String, Object, Array, RegExp, parseFloat, parseInt };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(block('cfp-data'), sandbox);
vm.runInContext(block('cfp-core'), sandbox);
const C = sandbox.CFPCore;
const json = v => JSON.parse(JSON.stringify(v));

let passed = 0;
const failures = [];
function t(name, fn) {
  try { fn(); passed += 1; }
  catch (err) { failures.push(name + ': ' + err.message); }
}

const VIEW_IDS = () => (html.match(/<section class="view[^"]*" id="(view-[a-z0-9-]+)"/g) || [])
  .map(s => s.match(/id="(view-[a-z0-9-]+)"/)[1]);

/* ---------------- page integration ---------------- */
t('footer version matches the junk-drawer.json entry in all three places', () => {
  const m = html.match(/data-deploy-version="([\d.]+)"/);
  assert.ok(m, 'footer data-deploy-version present');
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'junk-drawer.json'), 'utf8'));
  const entry = reg.pages['cloudflare-developer-playground.html'];
  assert.ok(entry, 'the page is registered in junk-drawer.json');
  assert.equal(entry.version, m[1]);
  assert.ok(html.includes('JUNKDRAWER_DEPLOY_FOOTER version="' + m[1] + '"'));
  assert.ok(html.includes('version ' + m[1]));
});

t('exactly one analytics-lite tag, plus the shared storage helper', () => {
  assert.equal((html.match(/<script[^>]*analytics-lite\.js/g) || []).length, 1);
  assert.ok(html.includes('data-site-id="junkdrawer"'));
  assert.equal((html.match(/<script[^>]*jd-storage\.js/g) || []).length, 1);
});

t('every section carries the metadata the navigation needs', () => {
  const sections = html.match(/<section class="view[^>]*>/g) || [];
  assert.ok(sections.length >= 40, 'sections: ' + sections.length);
  sections.forEach(s => {
    assert.ok(/id="view-[a-z0-9-]+"/.test(s), 'id: ' + s.slice(0, 60));
    assert.ok(/data-title="/.test(s), 'data-title: ' + s.slice(0, 60));
    assert.ok(/data-group="/.test(s), 'data-group: ' + s.slice(0, 60));
    assert.ok(/data-icon="/.test(s), 'data-icon: ' + s.slice(0, 60));
  });
});

t('every section has prose content rendered from the data block', () => {
  const ids = VIEW_IDS();
  const contentKeys = Object.keys(sandbox.CONTENT);
  ids.forEach(id => assert.ok(contentKeys.indexOf(id) >= 0, 'CONTENT missing for ' + id));
  contentKeys.forEach(k => {
    assert.ok(ids.indexOf(k) >= 0, 'CONTENT key with no section: ' + k);
    assert.ok(sandbox.CONTENT[k].blocks.length >= 1, k + ' has blocks');
  });
});
t('the page itself makes no network calls: fetch appears only in documented samples', () => {
  const app = block('cfp-app');
  assert.equal((app.match(/fetch\(/g) || []).length, 0, 'the app never calls fetch');
  assert.equal((html.match(/XMLHttpRequest/g) || []).length, 0, 'no XHR anywhere');
  assert.equal((html.match(/<script[^>]+src="https?:/g) || []).length, 0, 'no third-party scripts');
  // the data block legitimately contains fetch() inside recipe code samples
  assert.ok((block('cfp-data').match(/fetch\(/g) || []).length >= 1, 'recipe samples show fetch usage');
});

t('no secrets, tokens or infrastructure identifiers are embedded', () => {
  ['ghp_', 'AKIA', 'CLOUDFLARE_API_TOKEN=', 'Bearer ey'].forEach(bad =>
    assert.ok(!html.includes(bad), 'page must not contain a credential prefix: ' + bad));
  // identifiers are checked by shape: UUIDs and 32-character account ids
  assert.deepEqual(html.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || [], [],
    'no database or namespace identifiers are published');
  assert.deepEqual(html.match(/\b[0-9a-f]{32}\b/g) || [], [], 'no account identifiers are published');
});

t('no inline event handlers and no external stylesheet', () => {
  assert.equal((html.match(/\son(click|change|input|load|error)=/g) || []).length, 0, 'no inline handlers');
  assert.equal((html.match(/<link[^>]+rel="stylesheet"/g) || []).length, 0, 'styles are inline');
  assert.ok(html.includes('<style>') && html.includes('</style>'));
});

t('colour discipline: no hex outside the two token blocks, no gradients', () => {
  const tokenBlocks = html.match(/:root\s*\{[\s\S]*?\}|html\[data-theme="dark"\]\s*\{[\s\S]*?\}/g) || [];
  assert.ok(tokenBlocks.length >= 2, 'both token blocks exist');
  let stripped = html;
  tokenBlocks.forEach(b => { stripped = stripped.replace(b, ''); });
  const stray = (stripped.match(/#[0-9a-fA-F]{3,8}\b/g) || []);
  // every remaining literal is a token reference, never a colour value
  assert.deepEqual(stray.slice(0, 5), [], 'no colour literals outside the token blocks');
  assert.equal((html.match(/linear-gradient|radial-gradient/g) || []).length, 0, 'no gradients');
});

t('print styles force the light palette and hide the chrome', () => {
  const print = html.slice(html.indexOf('@media print'));
  assert.ok(print.includes('--bg: #ffffff'));
  assert.ok(print.includes('display: none !important'));
});

t('theme resolution is light-first and system is opt-in', () => {
  const m = html.match(/<script id="cfp-theme">([\s\S]*?)<\/script>/);
  assert.ok(m, 'theme block present');
  const themeSandbox = { console };
  themeSandbox.globalThis = themeSandbox;
  vm.createContext(themeSandbox);
  vm.runInContext(m[1], themeSandbox);
  const T = themeSandbox.CFPThemeCore;
  assert.equal(T.DEFAULT, 'light');
  assert.equal(T.normalize('dark'), 'dark');
  assert.equal(T.normalize('purple'), 'light');
  assert.equal(T.resolve('system', true), 'dark');
  assert.equal(T.resolve('system', false), 'light');
  assert.equal(T.resolve('dark', false), 'dark');
  assert.equal(T.readStored(null), 'light');
  assert.equal(T.readStored({ getItem: () => '{"theme":"dark"}' }), 'dark');
  assert.equal(T.readStored({ getItem: () => 'not json' }), 'light');
  assert.equal(T.readStored({ getItem: () => { throw new Error('blocked'); } }), 'light');
});
/* ---------------- cost model ---------------- */
t('cost: the documented Workers example (15M requests, 7 ms CPU) lands at $8.00', () => {
  const r = json(C.workersExample());
  const requests = r.rows.filter(x => x.key === 'requests')[0];
  const cpu = r.rows.filter(x => x.key === 'cpu')[0];
  const logs = r.rows.filter(x => x.key === 'logs')[0];
  assert.equal(requests.billableUnits, 5);          // 15M - 10M included
  assert.equal(Math.round(requests.cost * 100) / 100, 1.5);
  assert.equal(cpu.billableUnits, 75);              // 105M - 30M included
  assert.equal(Math.round(cpu.cost * 100) / 100, 1.5);
  assert.equal(logs.cost, 0);
  assert.equal(r.total, 8);                         // 3 metered + the 5 minimum
  assert.equal(r.minimumOnly, false);
});

t('cost: billable units round up, and the Workers minimum is a floor', () => {
  assert.equal(C.billedUnits(10.0001, 10), 1);
  assert.equal(C.billedUnits(10, 10), 0);
  assert.equal(C.billedUnits(19.4, 10), 10);
  assert.equal(C.billedUnits(5, 10), 0);
  assert.equal(C.billedUnits(-5, 10), 0);
  const tiny = json(C.serviceCost(sandbox.PRICES.filter(p => p.id === 'workers')[0], { requests: 1e6, cpu: 1e6 }));
  assert.equal(tiny.total, 5);
  assert.equal(tiny.minimumOnly, true);
  assert.equal(tiny.metersTotal, 0);
});

t('cost: zero usage bills nothing beyond a subscription', () => {
  sandbox.PRICES.forEach(p => {
    const r = C.serviceCost(p, {});
    assert.equal(Number.isFinite(r.total), true, p.id + ' total is finite');
    assert.equal(r.total, p.base || 0, p.id + ' with no usage bills only its base');
  });
});

t('cost: D1, KV, Queues and R2 arithmetic against hand-worked values', () => {
  const d1 = C.serviceCost(sandbox.PRICES.filter(p => p.id === 'd1')[0],
    { rowsRead: 26000e6, rowsWritten: 60e6, storage: 9 });
  assert.equal(d1.rows.filter(r => r.key === 'rowsRead')[0].billableUnits, 1000);
  assert.equal(Math.round(d1.rows.filter(r => r.key === 'rowsRead')[0].cost * 1000) / 1000, 1);
  assert.equal(d1.rows.filter(r => r.key === 'rowsWritten')[0].billableUnits, 10);
  assert.equal(d1.rows.filter(r => r.key === 'storage')[0].billableUnits, 4);
  assert.equal(d1.total, 14);

  const kv = C.serviceCost(sandbox.PRICES.filter(p => p.id === 'kv')[0],
    { reads: 20e6, writes: 2e6, deletes: 0, lists: 0, storage: 2 });
  assert.equal(kv.rows.filter(r => r.key === 'reads')[0].cost, 5);
  assert.equal(kv.rows.filter(r => r.key === 'writes')[0].cost, 5);
  assert.equal(Math.round(kv.rows.filter(r => r.key === 'storage')[0].cost * 100) / 100, 0.5);

  const q = C.serviceCost(sandbox.PRICES.filter(p => p.id === 'queues')[0], { ops: 4e6 });
  assert.equal(Math.round(q.total * 100) / 100, 1.2);

  const r2 = C.serviceCost(sandbox.PRICES.filter(p => p.id === 'r2')[0], { storage: 12, classA: 2e6, classB: 20e6 });
  assert.equal(r2.rows.filter(r => r.key === 'storage')[0].billableUnits, 2);
  assert.equal(r2.rows.filter(r => r.key === 'classA')[0].cost, 4.5);
  assert.equal(Math.round(r2.rows.filter(r => r.key === 'classB')[0].cost * 100) / 100, 3.6);
});
t('cost: Durable Object duration and container hours are computed in their own units', () => {
  const doEntry = sandbox.PRICES.filter(p => p.id === 'do')[0];
  const d = C.serviceCost(doEntry, { requests: 3e6, duration: 1.4e6 });
  assert.equal(d.rows.filter(r => r.key === 'requests')[0].billableUnits, 2);   // 3M - 1M
  assert.equal(d.rows.filter(r => r.key === 'requests')[0].cost, 0.3);
  assert.equal(d.rows.filter(r => r.key === 'duration')[0].billableUnits, 1);   // 1.4M - 0.4M
  assert.equal(d.rows.filter(r => r.key === 'duration')[0].cost, 12.5);

  const c = sandbox.PRICES.filter(p => p.id === 'containers')[0];
  const mem = c.meters.filter(m => m.key === 'memory')[0];
  const cost = C.meterCost(mem, 30);                       // 30 GiB-hours, 25 included
  assert.equal(Math.round(cost.includedUnits), 25);
  assert.equal(cost.billableUnits, 5);
  assert.equal(Math.round(cost.cost * 1000) / 1000, Math.round(5 * 0.0000025 * 3600 * 1000) / 1000);
});

t('cost: an unverified allowance is charged from zero and flagged, never guessed', () => {
  const doEntry = sandbox.PRICES.filter(p => p.id === 'do')[0];
  const sqlMeter = doEntry.meters.filter(m => m.key === 'sqlStorage')[0];
  assert.equal(sqlMeter.included, null, 'the Durable Object SQL storage allowance is deliberately null');
  const r = C.serviceCost(doEntry, { sqlStorage: 3 });
  assert.ok(r.unknownMeters.indexOf('sqlStorage') >= 0, 'the unverified meter is flagged');
  assert.equal(Math.round(r.rows.filter(x => x.key === 'sqlStorage')[0].cost * 100) / 100, 0.6);
  assert.equal(r.rows.filter(x => x.key === 'sqlStorage')[0].unknownAllowance, true);
  assert.equal(r.rows.filter(x => x.key === 'sqlStorage')[0].includedUnits, 0);
});

t('cost: every priced service has a rate, a unit, a source and a date', () => {
  assert.ok(sandbox.PRICES.length >= 15, 'priced services: ' + sandbox.PRICES.length);
  const sourceIds = sandbox.SOURCES.map(s => s.id);
  sandbox.PRICES.forEach(p => {
    assert.ok(p.source && sourceIds.indexOf(p.source) >= 0, p.id + ' cites a real source');
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(p.verified), p.id + ' has a verification date');
    assert.ok(Array.isArray(p.meters) && p.meters.length, p.id + ' has meters');
    assert.ok(typeof p.freeNote === 'string' && p.freeNote.length > 10, p.id + ' states its free plan');
    p.meters.forEach(m => {
      assert.ok(m.key && m.label && m.unit, p.id + ' meter has key, label and unit');
      assert.equal(Number.isFinite(m.rate), true, p.id + '/' + m.key + ' has a numeric rate');
      assert.ok(m.rate > 0, p.id + '/' + m.key + ' rate is positive');
      assert.ok(m.included === null || typeof m.included === 'number', p.id + '/' + m.key + ' included is numeric or null');
    });
  });
});

t('cost: pooled meters are detected rather than double-counted', () => {
  const stack = json(C.stackCost([
    { serviceId: 'workers', usage: { requests: 60e6, cpu: 300e6 } },
    { serviceId: 'workflows', usage: { requests: 5e6, cpu: 20e6, steps: 1e6, storage: 3 } }
  ]));
  assert.ok(stack.doubleCounted.indexOf('Workers requests') >= 0, 'shares the request meter');
  assert.ok(stack.doubleCounted.indexOf('Workers CPU') >= 0, 'shares the CPU meter');
  assert.ok(stack.total > 0);
  const single = json(C.stackCost([{ serviceId: 'd1', usage: { rowsRead: 1e9 } }]));
  assert.deepEqual(single.doubleCounted, [], 'D1 shares nothing');
});

t('cost: invalid or absent parts are skipped instead of throwing', () => {
  const r = C.stackCost([{ serviceId: 'nope', usage: {} }, { serviceId: 'd1', usage: {} }]);
  assert.equal(r.parts.length, 1);
  assert.equal(Number.isFinite(r.total), true);
  assert.equal(C.stackCost([]).total, 0);
  assert.equal(Number.isFinite(C.serviceCost(sandbox.PRICES.filter(p => p.id === 'd1')[0], { rowsRead: NaN }).total), true);
});

t('formatting helpers are stable at the edges', () => {
  assert.equal(C.usd(0), '$0.00');
  assert.equal(C.usd(12.3456), '$12.35');
  assert.equal(C.usd(NaN), '—');
  assert.equal(C.big(1500), '1.5k');
  assert.equal(C.big(2.5e6), '2.5M');
  assert.equal(C.big(1e9), '1B');
  assert.equal(C.num(1 / 3), '0.33');
  assert.equal(C.pct(5, 0), 0);
  assert.equal(C.pct(1, 2), 50);
});
/* ---------------- decision lab ---------------- */
t('decision: a heavy batch on an existing VPS is told no, with reasons', () => {
  const r = C.decide({ kind: 'batch', trigger: 'manual', volume: 2, cpuMs: 900000, memoryMb: 3000,
    durationSec: 3600, dataGb: 60, recordGb: 4, needsDisk: true, needsBlocking: true, needsSql: true,
    instantRevocation: false, regionalLatency: false, existingInfra: true, budget: 'free' });
  assert.equal(r.fit, 'no');
  assert.ok(/may not be the best execution environment/.test(r.headline));
  assert.ok(r.gaps.length >= 1, 'states where it stops making sense');
  assert.ok(r.reasons.length >= 1);
  assert.ok(r.picks.some(p => p.name === 'Containers'));
  assert.ok(r.limits.some(l => /128 MB/.test(l)));
});

t('decision: a tiny auth API is recommended with D1 and a revocation warning', () => {
  const r = C.decide({ kind: 'http', trigger: 'request', volume: 30000, cpuMs: 6, memoryMb: 32,
    durationSec: 1, dataGb: 0.5, recordGb: 0.001, needsSql: true, instantRevocation: true,
    needsDisk: false, needsBlocking: false, regionalLatency: false, existingInfra: false, budget: 'free' });
  assert.ok(r.fit === 'yes' || r.fit === 'maybe');
  assert.ok(r.picks.some(p => /D1/.test(p.name)));
  assert.equal(r.cost.requestsPerMonth, 900000);
  assert.ok(Number.isFinite(r.cost.workersEstimate));
  assert.ok(/pool|Pages Functions/.test(r.cost.note));
});

t('decision: hard ceilings are surfaced for memory, artefacts and data volume', () => {
  const mem = C.decide({ kind: 'media', memoryMb: 512, volume: 10 });
  assert.ok(mem.limits.some(l => /128 MB/.test(l)));
  assert.ok(mem.picks.some(p => p.name === 'Containers'));

  const big = C.decide({ kind: 'batch', recordGb: 2, volume: 10 });
  assert.ok(big.picks.some(p => p.name === 'R2 with presigned URLs'));

  const lake = C.decide({ kind: 'http', dataGb: 150, needsSql: false, recordGb: 0.05 });
  assert.ok(lake.limits.some(l => /10 GB/.test(l)));
  assert.ok(lake.picks.some(p => p.name === 'R2'));

  const slow = C.decide({ kind: 'batch', durationSec: 900, volume: 20, needsBlocking: true });
  assert.ok(slow.limits.some(l => /15 minutes/.test(l)));
  assert.ok(slow.picks.some(p => p.name === 'Workflows'));
});

t('decision: stateful, analytics, AI and untrusted workloads get the right services', () => {
  const stateful = C.decide({ kind: 'stateful', volume: 1000, trigger: 'event' });
  assert.ok(stateful.picks.some(p => p.name === 'Durable Objects'));
  const analytics = C.decide({ kind: 'analytics', volume: 100000, trigger: 'request' });
  assert.ok(analytics.picks.some(p => p.name === 'Analytics Engine'));
  const ai = C.decide({ kind: 'ai', volume: 5000, trigger: 'request' });
  assert.ok(ai.picks.some(p => p.name === 'Workers AI'));
  assert.ok(ai.picks.some(p => p.name === 'AI Gateway'));
  const untrusted = C.decide({ kind: 'untrusted', volume: 100, trigger: 'request' });
  assert.ok(untrusted.picks.some(p => /Sandbox/.test(p.name)));
  const scheduled = C.decide({ kind: 'batch', trigger: 'schedule', volume: 24 });
  assert.ok(scheduled.picks.some(p => p.name === 'Cron Triggers'));
});

t('decision: the form is consumable and defaults are sane', () => {
  const fields = C.DECISION_FIELDS;
  assert.ok(fields.length >= 12, 'fields: ' + fields.length);
  fields.forEach(f => {
    assert.ok(f.key && f.label, 'field has a key and label');
    assert.ok(['select', 'number', 'check'].indexOf(f.type) >= 0, f.key + ' has a known type');
    if (f.type === 'select') assert.ok(f.options.length >= 2, f.key + ' has options');
    if (f.type === 'number') assert.equal(Number.isFinite(f.def), true, f.key + ' has a numeric default');
    if (f.type === 'check') assert.equal(typeof f.def, 'boolean', f.key + ' has a boolean default');
  });
  const bare = C.decide({});
  assert.ok(['yes', 'maybe', 'no'].indexOf(bare.fit) >= 0);
  assert.ok(bare.picks.length >= 1);
  const weird = C.decide({ volume: 'abc', cpuMs: -5, memoryMb: null, dataGb: undefined, kind: 'unknown-kind' });
  assert.ok(['yes', 'maybe', 'no'].indexOf(weird.fit) >= 0, 'invalid input still yields a verdict');
  assert.equal(weird.signals.cpuMs, -5);
});
/* ---------------- cron ---------------- */
t('cron: daily 06:23 UTC fires on consecutive days', () => {
  const r = C.cronNext('23 6 * * *', Date.UTC(2026, 9, 10, 0, 0), 3);
  assert.ok(r.ok, r.error);
  assert.equal(C.fmtUtc(r.runs[0]), '2026-10-10 06:23Z');
  assert.equal(C.fmtUtc(r.runs[1]), '2026-10-11 06:23Z');
  assert.equal(r.runs[1] - r.runs[0], 86400000);
});

t('cron: the repository hourly pattern and the monthly first-of-month', () => {
  assert.equal(C.fmtUtc(C.cronNext('17 * * * *', Date.UTC(2026, 9, 10, 0, 0), 1).runs[0]), '2026-10-10 00:17Z');
  assert.equal(C.fmtUtc(C.cronNext('0 15 1 * *', Date.UTC(2026, 9, 10, 0, 0), 1).runs[0]), '2026-11-01 15:00Z');
});

t('cron: steps, lists and weekday names', () => {
  assert.deepEqual(json(C.cronNext('*/15 * * * *', Date.UTC(2026, 0, 1, 10, 0), 2).runs.map(C.fmtUtc)),
    ['2026-01-01 10:15Z', '2026-01-01 10:30Z']);
  assert.deepEqual(json(C.cronNext('0 9 * * MON,WED', Date.UTC(2026, 0, 1, 0, 0), 2).runs.map(C.fmtUtc)),
    ['2026-01-05 09:00Z', '2026-01-07 09:00Z']);
  assert.deepEqual(json(C.cronNext('0 0 1 JAN *', Date.UTC(2026, 5, 1, 0, 0), 1).runs.map(C.fmtUtc)),
    ['2027-01-01 00:00Z']);
});

t('cron: day-of-month OR day-of-week follows POSIX, and 7 is Sunday', () => {
  const p = C.parseCron('0 12 1-7 * MON');
  assert.ok(p.ok);
  assert.equal(p.domRestricted, true);
  assert.equal(p.dowRestricted, true);
  assert.equal(C.fmtUtc(C.cronNext('0 12 1-7 * MON', Date.UTC(2026, 9, 1, 0, 0), 1).runs[0]), '2026-10-01 12:00Z');
  assert.equal(C.fmtUtc(C.cronNext('0 0 * * 7', Date.UTC(2026, 9, 6, 0, 0), 1).runs[0]), '2026-10-11 00:00Z');
  assert.equal(C.parseCron('0 0 * * *').domRestricted, false);
  assert.equal(C.parseCron('0 0 * * *').dowRestricted, false);
});

t('cron: LW means the last weekday of the month', () => {
  assert.equal(C.lastWeekdayOfMonth(2026, 9), 30);        // October 2026: the 30th is a Friday
  assert.equal(C.lastWeekdayOfMonth(2026, 7), 31);         // August 2026 ends on a Monday
  assert.equal(C.fmtUtc(C.cronNext('59 23 LW * *', Date.UTC(2026, 9, 1, 0, 0), 1).runs[0]), '2026-10-30 23:59Z');
});

t('cron: invalid expressions are rejected with a reason', () => {
  assert.equal(C.parseCron('').ok, false);
  assert.equal(C.parseCron('* * *').ok, false);
  assert.equal(C.parseCron('* * * * * *').ok, false);
  assert.ok(/five fields/.test(C.parseCron('* * * * * *').error));
  assert.ok(/seconds/.test(C.parseCron('* * * * * *').error));
  assert.equal(C.parseCron('99 * * * *').ok, false);
  assert.equal(C.parseCron('0 0 32 * *').ok, false);
  assert.equal(C.parseCron('0 0 * 13 *').ok, false);
  assert.equal(C.parseCron('*/0 * * * *').ok, false);
});

t('cron: the explorer reports UTC and never claims a timezone', () => {
  const parsed = C.parseCron('30 2 * * *');
  assert.equal(parsed.utc, true);
  const r = C.cronNext('30 2 * * *', Date.UTC(2026, 11, 31, 23, 0), 1);
  assert.equal(C.fmtUtc(r.runs[0]), '2027-01-01 02:30Z');
});
/* ---------------- trees ---------------- */
t('trees: every diagnostic tree and the advisor has a complete graph', () => {
  const trees = sandbox.TREES.concat([sandbox.ORCH_TREE]);
  assert.ok(trees.length >= 9, 'trees: ' + trees.length);
  trees.forEach(tree => {
    const problems = json(C.graphCheck(tree));
    assert.deepEqual(problems, [], tree.id + ': ' + problems.join('; '));
  });
});

t('trees: every option path terminates in a result', () => {
  const trees = sandbox.TREES.concat([sandbox.ORCH_TREE]);
  trees.forEach(tree => {
    const walkAll = (node, trail) => {
      const n = tree.nodes[node];
      if (n.r) return 1;
      let leaves = 0;
      n.opts.forEach(o => {
        const r = C.walkTree(tree, trail.concat([o.t]));
        assert.equal(r.ok, true, tree.id + ': ' + trail.join('>') + '>' + o.t);
        leaves += walkAll(o.to, trail.concat([o.t]));
      });
      return leaves;
    };
    const leaves = walkAll(tree.start, []);
    assert.ok(leaves >= 2, tree.id + ' has multiple outcomes');
  });
});

t('trees: diagnosis asks for evidence before proposing a fix', () => {
  sandbox.TREES.forEach(tree => {
    Object.keys(tree.nodes).forEach(id => {
      const n = tree.nodes[id];
      if (n.r && n.r.kind !== 'ok') {
        assert.ok(n.r.evidence && n.r.evidence.length >= 1, tree.id + '/' + id + ' asks for evidence');
      }
      if (n.r) {
        assert.ok(n.r.kind && ['ok', 'maybe', 'bad', 'warn', 'yes', 'no'].indexOf(n.r.kind) >= 0, tree.id + '/' + id + ' has a verdict kind');
        assert.ok(n.r.body && n.r.body.length > 30, tree.id + '/' + id + ' explains itself');
        if (n.r.links) n.r.links.forEach(v => assert.ok(VIEW_IDS().indexOf(v) >= 0, tree.id + '/' + id + ' links to a real view: ' + v));
      }
    });
  });
});

t('trees: the billing tree covers each of the five classic surprises', () => {
  const bill = sandbox.TREES.filter(x => x.id === 't-bill')[0];
  assert.ok(bill, 'the billing tree exists');
  const results = bill.nodes.q1.opts.map(o => { const r = bill.nodes[o.to].r; return r.title + ' ' + r.body + ' ' + (r.fixes || []).join(' '); }).join(' ');
  ['Class A', 'rows', 'hibernate', 'sampling', 'warm'].forEach(term =>
    assert.ok(new RegExp(term, 'i').test(results), 'billing tree mentions ' + term));
});

t('advisor: the orchestration tree recommends the documented default for each trigger shape', () => {
  const tree = sandbox.ORCH_TREE;
  const byLabel = label => {
    const r = C.walkTree(tree, [label]);
    assert.equal(r.ok, true, label);
    return r;
  };
  // schedule then short and idempotent -> cron
  let node = byLabel('On a fixed schedule');
  node = C.walkTree(tree, ['On a fixed schedule', node.opts.filter(o => /Short and idempotent/.test(o.t))[0].t]);
  assert.ok(/Cron Trigger/.test(node.result.title));
  // delayed and per-entity -> alarms
  node = C.walkTree(tree, ['After a delay or a future timestamp', 'One entity at a time — a cart, a device, a user']);
  assert.ok(/alarm/i.test(node.result.title));
  // multi-step, durable -> workflows
  node = C.walkTree(tree, ['It is a multi-step process that must survive failure']);
  assert.ok(/Workflows/.test(node.result.title));
  // async and lossy side effect -> waitUntil with the honest caveat
  node = C.walkTree(tree, ['Right after another action, but not in the response', 'Nothing — it is a side effect I can lose']);
  assert.ok(/waitUntil/.test(node.result.title));
  assert.ok(/lossy/.test(node.result.title));
});

t('advisor: every storage recommendation names an alternative and what would go wrong', () => {
  const list = sandbox.STORAGE_ADVISOR;
  assert.ok(list.length >= 8, 'workloads: ' + list.length);
  const picks = list.map(a => a.pick).join(' ');
  ['R2', 'D1', 'KV', 'Durable Objects', 'Analytics Engine', 'Workers Cache'].forEach(service =>
    assert.ok(picks.indexOf(service) >= 0, 'recommends ' + service + ' somewhere'));
  list.forEach(a => {
    ['workload', 'needs', 'why', 'wrong', 'cost'].forEach(f =>
      assert.ok(a[f] && a[f].length > 15, a.id + ' has ' + f));
    ['pick', 'alt'].forEach(f => assert.ok(a[f] && a[f].length > 1, a.id + ' has ' + f));
    a.links.forEach(v => assert.ok(VIEW_IDS().indexOf(v) >= 0, a.id + ' links to a real view'));
  });
});

/* ---------------- search ---------------- */
t('search scoring requires every term and prefers short exact labels', () => {
  assert.equal(C.score('nothing here', 'workers'), 0);
  assert.equal(C.score('', 'workers'), 0);
  assert.equal(C.score('workers', ''), 0);
  assert.ok(C.score('Workers', 'workers') > C.score('Workers pricing page', 'workers'));
  assert.ok(C.score('workers pricing', 'workers prices') === 0, 'a missing term scores nothing');
  assert.ok(C.score('workers queues', 'workers queues') > 0);
  assert.ok(C.score('D1 limits', 'd1') > 0);
});
/* ---------------- data integrity ---------------- */
t('recipes: at least 30 with every required field, citing real sources', () => {
  const recipes = sandbox.RECIPES;
  assert.ok(recipes.length >= 30, 'recipes: ' + recipes.length);
  const ids = {};
  const sourceIds = sandbox.SOURCES.map(s => s.id);
  recipes.forEach(r => {
    assert.ok(r.id && !ids[r.id], 'unique id: ' + r.id);
    ids[r.id] = 1;
    ['name', 'cat', 'purpose', 'perms', 'cost', 'plan'].forEach(f => assert.ok(r[f], r.id + ' has ' + f));
    ['services', 'prereq', 'use', 'setup', 'cli', 'verify', 'fails', 'cleanup', 'docs'].forEach(f =>
      assert.ok(Array.isArray(r[f]) && r[f].length, r.id + ' has a non-empty ' + f));
    assert.equal(typeof r.deployed, 'boolean', r.id + ' states whether it is deployed');
    r.docs.forEach(d => assert.ok(sourceIds.indexOf(d) >= 0, r.id + ' cites unknown source ' + d));
    if (r.code) assert.ok(r.code.title && r.code.text, r.id + ' code block is titled and non-empty');
  });
  const categories = {};
  recipes.forEach(r => { categories[r.cat] = (categories[r.cat] || 0) + 1; });
  assert.ok(Object.keys(categories).length >= 5, 'recipes span categories: ' + Object.keys(categories));
});

t('recipes: the ones marked as in use correspond to real inventory findings', () => {
  const inUse = sandbox.RECIPES.filter(r => r.deployed).map(r => r.id);
  assert.ok(inUse.length >= 4, 'in-use recipes: ' + inUse.join(', '));
  ['r2-content-addressed-dataset', 'cron-poll-api', 'auth-session-d1', 'rate-limit-binding', 'staging-environments']
    .forEach(id => assert.ok(inUse.indexOf(id) >= 0, id + ' should be marked as in use'));
});

t('experiments: at least 20, contiguous, with cost warnings and validation', () => {
  const exps = sandbox.EXPERIMENTS;
  assert.ok(exps.length >= 20, 'experiments: ' + exps.length);
  const nums = json(exps.map(e => Number(e.n)).sort((a, b) => a - b));
  assert.deepEqual(nums, Array.from({ length: exps.length }, (_, i) => i + 1), 'numbering: ' + JSON.stringify(nums) + ' len ' + exps.length);
  exps.forEach(e => {
    ['id', 'title', 'group', 'why', 'expect', 'validate', 'cost', 'cleanup'].forEach(f =>
      assert.ok(e[f], e.id + ' has ' + f));
    ['prereq', 'steps', 'fails'].forEach(f => assert.ok(Array.isArray(e[f]) && e[f].length, e.id + ' has ' + f));
    assert.equal(typeof e.paid, 'boolean', e.id + ' declares paid or free');
  });
  assert.ok(exps.filter(e => e.paid).length >= 2, 'some experiments require a paid plan');
  assert.ok(exps.filter(e => !e.paid).length >= exps.length - 5, 'most work on the free plan');
});

t('limits: every table is sourced and every row matches the declared columns', () => {
  const sourceIds = sandbox.SOURCES.map(s => s.id);
  assert.ok(sandbox.LIMITS.length >= 15, 'limit tables: ' + sandbox.LIMITS.length);
  sandbox.LIMITS.forEach(table => {
    assert.ok(table.id && table.title, 'table has an id and title');
    assert.ok(sourceIds.indexOf(table.source) >= 0, table.id + ' cites a real source');
    assert.equal(table.verified, '2026-10-10', table.id + ' carries the verification date');
    assert.ok(table.cols.length >= 2, table.id + ' has columns');
    table.rows.forEach((row, i) => {
      assert.equal(row.length, table.cols.length, table.id + ' row ' + i + ' column count');
      assert.ok(String(row[0]).length, table.id + ' row ' + i + ' starts with a label');
    });
  });
});

t('sources: every source is dated, classified and unique', () => {
  const sources = sandbox.SOURCES;
  assert.ok(sources.length >= 45, 'sources: ' + sources.length);
  const seen = {};
  sources.forEach(s => {
    assert.ok(s.id && !seen[s.id], 'unique source id: ' + s.id);
    seen[s.id] = 1;
    assert.ok(/^https?:|^file:/.test(s.url), s.id + ' has a fetchable url');
    assert.equal(s.read, '2026-10-10', s.id + ' records the read date');
    assert.ok(['verified', 'checked', 'local'].indexOf(s.kind) >= 0, s.id + ' has a known kind');
    assert.ok(s.supports && s.supports.length > 20, s.id + ' says what it supports');
  });
  assert.ok(sources.filter(s => s.kind === 'verified').length >= 25, 'most facts are verified figures');
  assert.ok(sources.filter(s => s.kind === 'local').length >= 4, 'local findings are labelled');
  assert.ok(sources.filter(s => s.kind === 'checked').length >= 5, 'behaviour-only sources are labelled');
});

t('glossary: at least 40 unique terms with real definitions', () => {
  const g = sandbox.GLOSSARY;
  assert.ok(g.length >= 40, 'terms: ' + g.length);
  const seen = {};
  g.forEach(entry => {
    assert.ok(entry.t && !seen[entry.t], 'unique term: ' + entry.t);
    seen[entry.t] = 1;
    assert.ok(entry.d.length > 30, entry.t + ' has a real definition');
  });
});
t('products: each has a full dashboard panel and a section that exists', () => {
  const ids = VIEW_IDS();
  const products = sandbox.PRODUCTS;
  assert.ok(products.length >= 25, 'products: ' + products.length);
  const seen = {};
  products.forEach(p => {
    assert.ok(!seen[p.id], 'unique product id: ' + p.id);
    seen[p.id] = 1;
    assert.ok(ids.indexOf(p.view) >= 0, p.id + ' links to an existing section');
    ['summary', 'find', 'create', 'configure', 'monitor', 'secure', 'cost'].forEach(f =>
      assert.ok(p[f] && String(p[f]).length > 5, p.id + ' has ' + f));
    assert.ok(Array.isArray(p.bind) && Array.isArray(p.api), p.id + ' declares bindings and API surfaces');
    assert.ok(p.status && p.status.length >= 2, p.id + ' has a status');
    assert.ok(p.cat && p.cat.length >= 2, p.id + ' has a category');
    assert.ok(p.plan && p.plan.length >= 2, p.id + ' states its plan requirement');
  });
  const cats = {};
  products.forEach(p => { cats[p.cat] = 1; });
  assert.ok(Object.keys(cats).length >= 6, 'products span the map categories');
  ['workers', 'd1', 'r2', 'kv', 'do', 'queues', 'workflows', 'containers', 'workersai'].forEach(id =>
    assert.ok(seen[id], 'core product missing from the dashboard atlas: ' + id));
});

t('opportunities: at least 20, ranked without gaps, tied to real projects', () => {
  const opps = sandbox.OPPORTUNITIES;
  assert.ok(opps.length >= 20, 'opportunities: ' + opps.length);
  assert.deepEqual(json(opps.map(o => Number(o.rank)).sort((a, b) => a - b)),
    Array.from({ length: opps.length }, (_, i) => i + 1), 'ranks are 1..n');
  const projects = sandbox.PROJECTS.map(p => p.short || p.name);
  opps.forEach(o => {
    assert.ok(o.id && o.name && o.benefit && o.why && o.next && o.cost, o.id + ' is complete');
    assert.ok(projects.indexOf(o.project) >= 0, o.id + ' names a real project (got ' + o.project + ')');
    assert.ok(['low', 'medium', 'high'].indexOf(o.complexity) >= 0, o.id + ' grades complexity');
    assert.ok(['low', 'medium', 'high'].indexOf(o.risk) >= 0, o.id + ' grades risk');
  });
  assert.ok(opps.filter(o => o.kind === 'unconventional').length >= 5, 'several unconventional ideas');
  assert.ok(opps.filter(o => o.started).length >= 1, 'at least one is already partly started');
});

t('projects: verified entries are sourced and publish no account identifiers', () => {
  const projects = sandbox.PROJECTS;
  assert.ok(projects.length >= 6, 'projects: ' + projects.length);
  const sourceIds = sandbox.SOURCES.map(s => s.id);
  const names = {};
  projects.forEach(p => {
    assert.ok(p.id && p.name && p.what && p.host && p.stack, p.id + ' is complete');
    assert.ok(!names[p.name], 'unique project name: ' + p.name);
    names[p.name] = 1;
    assert.ok(sourceIds.indexOf(p.source) >= 0, p.id + ' cites a real source');
    assert.ok(p.architecture.length >= 1 && p.improvements.length >= 1, p.id + ' has architecture and improvements');
    assert.ok(Array.isArray(p.risks), p.id + ' has a risks list');
    (p.experiments || []).forEach(id => assert.ok(sandbox.EXPERIMENTS.some(e => e.id === id), p.id + ' references a real experiment'));
  });
  assert.ok(projects.filter(p => p.state === 'verified').length >= 5, 'most entries are verified facts');
  ['CFLab', 'JunkDrawer itself'].forEach(n => assert.ok(names[n], 'expected project present: ' + n));
});

t('boundaries: every product boundary states its failure mode and what to watch', () => {
  const bs = sandbox.BOUNDARIES;
  assert.ok(bs.length >= 15, 'boundaries: ' + bs.length);
  bs.forEach(b => {
    assert.ok(b.service && b.service.length >= 2, b.id + ' names its service');
    ['free', 'paid', 'stops', 'surprise', 'watch'].forEach(f =>
      assert.ok(b[f] && b[f].length > 10, b.id + ' has ' + f));
  });
  assert.ok(sandbox.BILLING_NAV.length >= 8, 'billing navigation entries: ' + sandbox.BILLING_NAV.length);
  sandbox.BILLING_NAV.forEach(n => assert.ok(n.where && n.what, 'billing nav entry is complete'));
});

t('errors: codes are unique and every entry explains cause and fix', () => {
  const errs = sandbox.ERRORS;
  assert.ok(errs.length >= 15, 'error entries: ' + errs.length);
  const seen = {};
  errs.forEach(e => {
    assert.ok(!seen[e.code], 'unique code: ' + e.code);
    seen[e.code] = 1;
    ['what', 'why', 'fix'].forEach(f => assert.ok(e[f] && e[f].length > 10, e.code + ' has ' + f));
  });
  ['1101', '1102', '1019', '1027', '1042'].forEach(code => assert.ok(seen[code], 'covers error ' + code));
});
t('the ecosystem map only draws edges between declared nodes', () => {
  const nodes = {};
  sandbox.MAP_NODES.forEach(n => { nodes[n.id] = n; });
  assert.ok(sandbox.MAP_NODES.length >= 30, 'map nodes: ' + sandbox.MAP_NODES.length);
  assert.ok(sandbox.MAP_EDGES.length >= 30, 'map edges: ' + sandbox.MAP_EDGES.length);
  const views = VIEW_IDS();
  const cats = {};
  sandbox.MAP_CATEGORIES.forEach(c => { cats[c.id] = 1; });
  sandbox.MAP_NODES.forEach(n => {
    assert.ok(cats[n.cat], n.id + ' has a known category');
    assert.ok(views.indexOf(n.view) >= 0, n.id + ' links to an existing view');
    [n.x, n.y, n.w].forEach(v => assert.equal(Number.isFinite(v), true, n.id + ' has numeric geometry'));
    assert.ok(n.x + n.w <= 1000, n.id + ' stays inside the viewBox horizontally');
    assert.ok(/[A-Za-z0-9]{2}/.test(n.label), n.id + ' is labelled');
  });
  const kinds = ['bind', 'api', 'orchestrate'];
  sandbox.MAP_EDGES.forEach(e => {
    assert.ok(nodes[e.a] && nodes[e.b], 'edge ' + e.a + '->' + e.b + ' references real nodes');
    assert.ok(kinds.indexOf(e.kind) >= 0, 'edge kind is known: ' + e.kind);
  });
  sandbox.MAP_ZONES.forEach(z => assert.ok(cats[z.cat], 'zone category ' + z.cat));
  // every category that has nodes also has a zone, so nothing floats outside a box
  const zoned = {};
  sandbox.MAP_ZONES.forEach(z => { zoned[z.cat] = 1; });
  sandbox.MAP_NODES.forEach(n => assert.ok(zoned[n.cat], 'no zone drawn for ' + n.cat));
});

t('the execution-model comparison covers the six models this manual claims', () => {
  const m = sandbox.EXEC_MODELS;
  assert.ok(m.cols.length >= 5);
  assert.equal(m.rows.length, 6);
  const text = m.rows.map(r => r[0]).join(' ');
  ['Worker isolate', 'Durable Object', 'Container', 'Sandbox', 'browser', 'GitHub'].forEach(term =>
    assert.ok(new RegExp(term, 'i').test(text), 'comparison mentions ' + term));
  m.rows.forEach(r => assert.equal(r.length, m.cols.length, 'row width: ' + r[0]));
});

t('every planner view is reachable and every tool mount is declared in the HTML', () => {
  const mounts = ['mapWrap', 'mapDetail', 'mapFilters', 'dashList', 'dashDetail', 'dashChips', 'dashModel',
    'startStats', 'startPaths', 'workersSample', 'limitsTable', 'reqLimitsTable', 'wallTable', 'limitTables',
    'd1Limits', 'd1Calc', 'r2Limits', 'r2Calc', 'kvTable', 'doTable', 'doCalc', 'storageAdvisor',
    'cronTool', 'queueTable', 'queueCalc', 'wfTable', 'wfCalc', 'orchTree', 'orchCompare',
    'staticCompare', 'staticJunkdrawer', 'dnsTable', 'cacheTable', 'netTable', 'ztTable', 'permGuide',
    'aiModels', 'aiCalc', 'gwFeatures', 'obsMetrics', 'obsPricing', 'errTable', 'errLookup',
    'emailTable', 'emailSetup', 'tokenCookbook', 'secretGuide', 'cliCookbook', 'iacTable',
    'pricingTables', 'fullStackCalc', 'boundaryTool', 'boundaryList', 'billingNav',
    'treeSelect', 'treeHost', 'reliabilityTable', 'recipeFilters', 'recipeList', 'recipeCount',
    'expProgress', 'expFilters', 'expList', 'atlas', 'atlasSummary', 'oppFilters', 'oppList',
    'decisionScenarios', 'decisionForm', 'decisionOut', 'glossaryList', 'srcList', 'compatFlags',
    'instanceTable', 'computeCompare', 'sandboxCompare', 'platformsTable', 'longTailTable', 'buildsTable'];
  mounts.forEach(id => assert.ok(html.includes('id="' + id + '"'), 'mount exists in the HTML: ' + id));
});

t('bookmark controls are injected for every section by the app', () => {
  assert.ok(html.includes('function addBookmarkControls'), 'the injecting helper exists');
  assert.ok(html.includes("setAttribute('data-bookmark'"), 'buttons carry a data-bookmark attribute');
  assert.ok(html.includes('toggleBookmark'), 'the toggle handler exists');
  assert.ok(!/data-bookmark="view-/.test(html), 'buttons are generated, not hand-written');
});

t('the offline promise holds: no intervals, no service worker, no live sockets', () => {
  const app = block('cfp-app');
  assert.equal((app.match(/setInterval\(/g) || []).length, 0, 'no polling intervals in the app');
  assert.equal((app.match(/new WebSocket/g) || []).length, 0, 'the app opens no sockets');
  assert.equal((html.match(/serviceWorker/gi) || []).length, 0, 'no service worker');
  assert.ok((app.match(/setTimeout\(/g) || []).length >= 1, 'only one-shot timers are used');
});

/* ---------------- report ---------------- */
if (failures.length) {
  console.error('\n' + failures.length + ' failing checks:\n' + failures.map(f => '  ✗ ' + f).join('\n'));
  console.error('\n' + passed + ' passed, ' + failures.length + ' failed');
  process.exit(1);
}
console.log(passed + ' checks passed');
