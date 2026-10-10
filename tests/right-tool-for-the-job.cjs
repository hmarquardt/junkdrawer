/* Unit tests for right-tool-for-the-job.html
   Run: node tests/right-tool-for-the-job.cjs

   Extracts the page's data and core script blocks and exercises the decision
   engine directly: feasibility gates, ranking, the cost models including pools
   and rounding, sensitivity, break-even, and scenario serialisation. No npm,
   no browser, no network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'right-tool-for-the-job.html');
const html = fs.readFileSync(PAGE, 'utf8');

function block(id) {
  const m = html.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)<\\/script>'));
  assert.ok(m, id + ' script block must exist in the page');
  return m[1];
}

function makeSandbox() {
  const sandbox = { console, Date, Math, JSON, isFinite, Number, String, Object, Array, RegExp, parseFloat, parseInt, Blob: undefined };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(block('rtj-data'), sandbox);
  vm.runInContext(block('rtj-core'), sandbox);
  return sandbox;
}
const S = makeSandbox();
const C = S.RTJCore;
const D = S.RTJData;
const json = v => JSON.parse(JSON.stringify(v));
const tpl = id => C.fromTemplate(D.TEMPLATES.filter(t => t.id === id)[0]);
const pattern = id => D.PATTERNS.filter(p => p.id === id)[0];
const rowFor = (ev, id) => ev.feasible.filter(r => r.id === id)[0];
const rejectedFor = (ev, id) => ev.rejected.filter(r => r.id === id)[0];

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
  const entry = reg.pages['right-tool-for-the-job.html'];
  assert.ok(entry, 'the page is registered in junk-drawer.json');
  assert.equal(entry.version, m[1]);
  assert.ok(html.includes('JUNKDRAWER_DEPLOY_FOOTER version="' + m[1] + '"'));
  assert.ok(html.includes('version ' + m[1]));
});

t('exactly one analytics-lite tag and one shared storage helper', () => {
  assert.equal((html.match(/<script[^>]*analytics-lite\.js/g) || []).length, 1);
  assert.ok(html.includes('data-site-id="junkdrawer"'));
  assert.equal((html.match(/<script[^>]*jd-storage\.js/g) || []).length, 1);
});

t('every section carries the metadata the rail needs', () => {
  const sections = html.match(/<section class="view[^"]*"[^>]*>/g) || [];
  assert.ok(sections.length >= 16, 'sections: ' + sections.length);
  sections.forEach(s => {
    assert.ok(/id="view-[a-z0-9-]+"/.test(s), 'id: ' + s.slice(0, 60));
    assert.ok(/data-title="/.test(s), 'title: ' + s.slice(0, 60));
    assert.ok(/data-group="/.test(s), 'group: ' + s.slice(0, 60));
    assert.ok(/data-icon="/.test(s), 'icon: ' + s.slice(0, 60));
  });
});

t('the page never calls the network for its own decisions', () => {
  const app = block('rtj-app');
  assert.equal((app.match(/fetch\(/g) || []).length, 0, 'the app never calls fetch');
  assert.equal((app.match(/XMLHttpRequest/g) || []).length, 0);
  assert.ok(!/openrouter|api\.openai|generativelanguage/i.test(app), 'no model endpoints');
});

t('no credential-shaped string appears anywhere in the page', () => {
  const patterns = [/eyJ[A-Za-z0-9_-]{20,}/, /sk-[A-Za-z0-9]{20,}/, /AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]+-----/,
    /Bearer\s+[A-Za-z0-9._-]{20,}/, /cloudflare[_-]?api[_-]?token["']?\s*[:=]\s*["'][A-Za-z0-9_-]{15,}/i];
  patterns.forEach(re => assert.ok(!re.test(html), 'matched ' + re));
});

/* ---------------- data integrity ---------------- */
t('every candidate, pattern, scenario, project, tree and evidence row is complete', () => {
  const need = (o, keys, label) => keys.forEach(k => assert.ok(o[k] !== undefined, label + ' missing ' + k));
  D.CANDIDATES.forEach(c => need(c, ['id', 'name', 'provider', 'category', 'model', 'summary', 'caps', 'ops', 'strengths', 'limits', 'costNote'], 'candidate ' + c.id));
  D.CANDIDATES.forEach(c => ['runMaxMin', 'memoryMB', 'scratchGB', 'nativeBin', 'docker', 'gpu', 'http', 'coldStart', 'consistency', 'latency', 'costModel'].forEach(k => assert.ok(c.caps[k] !== undefined, c.id + '.caps.' + k)));
  D.PATTERNS.forEach(p => need(p, ['id', 'name', 'provider', 'summary', 'nodes', 'edges', 'fits', 'strengths', 'limits'], 'pattern ' + p.id));
  D.SCENARIOS.forEach(s => need(s, ['id', 'n', 'name', 'summary', 'tpl', 'req', 'rec', 'alt', 'why', 'cost', 'fails', 'steps'], 'scenario ' + s.id));
  D.PROJECTS.forEach(p => need(p, ['id', 'name', 'workloads', 'present', 'strengths', 'constraints', 'alternatives', 'migration', 'cost', 'recommendation'], 'project ' + p.id));
  D.TREES.forEach(tr => need(tr, ['id', 'title', 'symptom', 'start', 'nodes'], 'tree ' + tr.id));
  D.EVIDENCE.forEach(e => need(e, ['id', 'provider', 'product', 'capability', 'value', 'plan', 'source', 'status'], 'evidence ' + e.id));
  D.SOURCES.forEach(s => need(s, ['id', 'title', 'url', 'read', 'kind'], 'source ' + s.id));
  D.TEMPLATES.forEach(x => need(x, ['id', 'name', 'icon', 'req', 'because'], 'template ' + x.id));
});

t('every cross reference resolves and every id is unique', () => {
  const ids = new Set(D.CANDIDATES.map(c => c.id));
  D.PATTERNS.forEach(p => {
    p.nodes.forEach(n => assert.ok(ids.has(n.id), p.id + ' node ' + n.id));
    p.edges.forEach(e => {
      assert.ok(ids.has(e.from), p.id + ' edge from ' + e.from);
      assert.ok(ids.has(e.to), p.id + ' edge to ' + e.to);
      assert.ok(p.nodes.some(n => n.id === e.from) && p.nodes.some(n => n.id === e.to), p.id + ' edge refers to a non-member: ' + e.from + ' -> ' + e.to);
    });
  });
  const pids = new Set(D.PATTERNS.map(p => p.id));
  D.SCENARIOS.forEach(s => { assert.ok(pids.has(s.rec), s.id + ' rec ' + s.rec); assert.ok(pids.has(s.alt), s.id + ' alt ' + s.alt); });
  D.PROJECTS.forEach(p => p.alternatives.forEach(a => assert.ok(pids.has(a.pattern), p.id + ' alternative ' + a.pattern)));
  const tids = new Set(D.TEMPLATES.map(x => x.id));
  D.SCENARIOS.forEach(s => assert.ok(tids.has(s.tpl), s.id + ' template ' + s.tpl));
  const sids = new Set(D.SOURCES.map(s => s.id));
  D.EVIDENCE.forEach(e => assert.ok(sids.has(e.source), e.id + ' source ' + e.source));
  [['candidate', D.CANDIDATES], ['pattern', D.PATTERNS], ['scenario', D.SCENARIOS], ['project', D.PROJECTS], ['tree', D.TREES], ['evidence', D.EVIDENCE], ['source', D.SOURCES], ['template', D.TEMPLATES]].forEach(([label, list]) => {
    const seen = new Set();
    list.forEach(x => { assert.ok(!seen.has(x.id), 'duplicate ' + label + ' id ' + x.id); seen.add(x.id); });
  });
});

t('every tree node is reachable and every branch terminates', () => {
  D.TREES.forEach(tr => {
    const keys = Object.keys(tr.nodes);
    assert.ok(keys.includes(tr.start), tr.id + ' start node missing');
    const reached = new Set([tr.start]);
    const walk = id => {
      const n = tr.nodes[id];
      assert.ok(n, tr.id + ' missing node ' + id);
      if (n.a) { n.a.forEach(x => { assert.ok(keys.includes(x.goto), tr.id + ' dangling branch ' + x.goto); if (!reached.has(x.goto)) { reached.add(x.goto); walk(x.goto); } }); }
      else { assert.ok(n.result && n.why && n.why.length, tr.id + ' leaf ' + id + ' needs a result and a reason'); }
    };
    walk(tr.start);
    keys.forEach(k => assert.ok(reached.has(k), tr.id + ' unreachable node ' + k));
  });
});

t('every scenario and template resolves to a ranked recommendation', () => {
  D.SCENARIOS.forEach(s => {
    const ev = C.evaluate(C.scenarioReq(s));
    assert.ok(ev.preferred, s.id + ' produced no feasible topology');
    assert.ok(ev.preferred.relevance >= 2, s.id + ' preferred option is not a fit for the workload type');
  });
  D.TEMPLATES.forEach(x => {
    const ev = C.evaluate(C.fromTemplate(x));
    assert.ok(ev.counts.considered === D.PATTERNS.length);
    assert.ok(ev.feasible.length + ev.rejected.length === D.PATTERNS.length, x.id + ' lost a topology');
  });
});

/* ---------------- stage A: hard constraints ---------------- */
t('a native toolchain eliminates every isolate topology', () => {
  const req = tpl('tpl-geo-batch');
  assert.equal(req.nativeBin, true);
  const ev = C.evaluate(req);
  const survivors = ev.feasible.concat(ev.rejected.filter(r => r.ok));
  ev.feasible.forEach(r => r.pattern.nodes.forEach(n => {
    const c = C.candidateById(n.id);
    if (n.role === 'compute' || n.role === 'build') assert.notEqual(c.caps.nativeBin, 'no', r.id + ' kept a native-free executor');
  }));
  assert.ok(!rowFor(ev, 'cf-static-worker'), 'an ordinary Worker must not survive a native workload');
  assert.ok(!rowFor(ev, 'cf-cron-ingest-d1'), 'a cron Worker must not survive a native workload');
  const w = rejectedFor(ev, 'cf-static-worker') || rejectedFor(ev, 'cf-r2-dataset');
  const msg = (w ? w.violations : ev.rejected[0].violations).map(v => v.message).join(' | ');
  assert.ok(/native|memory|scratch/i.test(msg), 'the rejection must name the constraint, got: ' + msg);
});

t('a persistent low-latency public API eliminates batch runners', () => {
  const req = tpl('tpl-readonly-api');
  const ev = C.evaluate(req);
  ['gh-cron-batch', 'gh-release-dataset', 'gh-ci-matrix', 'selfhosted-ci', 'gpu-batch'].forEach(id => {
    assert.ok(!rowFor(ev, id), id + ' has no request-serving member and must not serve an interactive API');
  });
  /* The structural invariant: whatever survives an interactive API must contain a
     member that can answer an inbound request. GitHub processes and Cloudflare
     serves is a legitimate answer; a batch runner alone is not. */
  ev.feasible.forEach(r => {
    assert.ok(r.pattern.nodes.some(n => C.candidateById(n.id).caps.http), r.id + ' survived an interactive API with no serving member');
  });
  const r = rejectedFor(ev, 'gh-cron-batch');
  assert.ok(r, 'gh-cron-batch should appear among the rejections');
  assert.ok(r.violations.some(v => v.gate === 'trigger' || v.gate === 'coldStart'), 'rejection should be trigger or cold-start shaped: ' + JSON.stringify(r.violations.map(v => v.gate)));
  assert.ok(rowFor(ev, 'cf-static-worker'), 'an edge Worker should survive');
});

t('memory, scratch and GPU ceilings each eliminate the right things', () => {
  const big = C.merge(C.neutral(), { workloadType: 'batch', memoryMB: 4096, trigger: 'schedule', latency: 'offline', durationMin: 30, scratchGB: 10 });
  const ev = C.evaluate(big);
  assert.ok(!rowFor(ev, 'cf-cron-ingest-d1'), 'a 4 GB requirement rules out a 128 MB isolate');
  assert.ok((rejectedFor(ev, 'cf-cron-ingest-d1') || { violations: [] }).violations.some(v => v.gate === 'memory'));
  const gpu = C.merge(C.neutral(), { workloadType: 'batch', gpu: true, trigger: 'manual', latency: 'offline', memoryMB: 8192 });
  const ev2 = C.evaluate(gpu);
  ['cf-r2-dataset', 'cf-static-worker'].forEach(id => assert.ok(!rowFor(ev2, id), id + ' must not survive a GPU requirement'));
  const ev3 = C.evaluate(C.merge(C.neutral(), { workloadType: 'batch', persistentDisk: true, trigger: 'manual', latency: 'offline', durationMin: 60 }));
  assert.ok(!rowFor(ev3, 'cf-container-batch'), 'no Cloudflare container offers a persistent filesystem');
});

t('a large concurrent relational database rejects single-threaded stores', () => {
  const req = C.merge(C.neutral(), { workloadType: 'crud-api', trigger: 'http', latency: 'interactive', storageKind: 'large-sql', consistency: 'strong', concurrency: 200, frequencyPerMonth: 1000000, availability: 'always-on', memoryMB: 128, scratchGB: 0, durationMin: 0.05 });
  const ev = C.evaluate(req);
  assert.ok(!rowFor(ev, 'cf-static-worker'), 'D1 is single-threaded and cannot be the answer for a concurrent relational workload');
  const r = rejectedFor(ev, 'cf-static-worker');
  assert.ok(r && r.violations.some(v => v.gate === 'storage'), 'the rejection should be a storage gate: ' + JSON.stringify((r || {}).violations));
  assert.ok(rowFor(ev, 'cf-api-postgres'), 'the Hyperdrive path should survive');
});

t('correlation: nothing eliminated by a soft score', () => {
  /* A weighted score is only ever computed for survivors, so a topology with a
     perfect ops profile but a hard incompatibility must still be rejected. */
  const req = tpl('tpl-geo-batch');
  const ev = C.evaluate(req);
  const bestOps = D.PATTERNS.map(p => ({ id: p.id, ops: C.opsProfile(p).weighted })).sort((a, b) => b.ops - a.ops)[0];
  const inFeasible = ev.feasible.some(r => r.id === bestOps.id);
  const improved = ev.rejected.find(r => r.id === bestOps.id);
  assert.ok(inFeasible || improved, 'the highest-scoring topology must be accounted for somewhere');
  if (improved) assert.ok(improved.violations.length > 0, 'a rejection needs a reason');
  ev.rejected.forEach(r => assert.ok(r.violations.length > 0, r.id + ' was rejected with no reason'));
  ev.rejected.forEach(r => assert.equal(r.ops.weighted > 0, true, r.id + ' should still carry a score for transparency'));
});

t('an unsatisfiable combination is reported as unsatisfiable, not forced', () => {
  /* No candidate offers a globally distributed accelerator, so a realtime GPU path has no answer here. */
  const req = C.merge(C.neutral(), { workloadType: 'ai-inference', trigger: 'http', latency: 'realtime', gpu: true, memoryMB: 8192, availability: 'always-on' });
  const ev = C.evaluate(req);
  assert.equal(ev.preferred, null, 'no topology in the catalog can do this');
  assert.equal(ev.feasible.length, 0);
  assert.ok(ev.rejected.length === D.PATTERNS.length);
  ev.rejected.forEach(r => assert.ok(r.violations.length > 0));
});

/* ---------------- stage C: arithmetic ---------------- */
t('GitHub minutes bill only beyond the allowance for private repositories', () => {
  const pub = C.ghCost({ plan: 'free', repoVis: 'public', runner: 'linux_2', jobsPerMonth: 500, minutesPerJob: 10 });
  assert.equal(pub.monthly, 0, 'public repositories are free on standard runners');
  assert.equal(pub.billableMinutes, 0);
  assert.ok(pub.publicFree);
  const priv = C.ghCost({ plan: 'free', repoVis: 'private', runner: 'linux_2', jobsPerMonth: 500, minutesPerJob: 10 });
  assert.equal(priv.totalMinutes, 5000);
  assert.equal(priv.billableMinutes, 3000, '2000 minutes are included on Free');
  assert.equal(priv.monthly, C.round2(3000 * 0.006));
  const team = C.ghCost({ plan: 'team', repoVis: 'private', runner: 'linux_2', jobsPerMonth: 200, minutesPerJob: 10 });
  assert.equal(team.billableMinutes, 0, '3000 included on Team');
});

t('larger runners never receive the included allowance and are never free', () => {
  const r = C.ghCost({ plan: 'team', repoVis: 'public', runner: 'linux_16', jobsPerMonth: 4, minutesPerJob: 120 });
  assert.equal(r.totalMinutes, 480);
  assert.equal(r.billableMinutes, 480, 'included minutes cannot be applied to a larger runner');
  assert.equal(r.monthly, C.round2(480 * 0.042));
  assert.ok(!r.publicFree, 'a larger runner is not free even on a public repository');
});

t('GitHub rounds up to the whole minute per job', () => {
  const r = C.ghCost({ plan: 'free', repoVis: 'private', runner: 'linux_2', jobsPerMonth: 3, minutesPerJob: 0.1 });
  assert.equal(r.totalMinutes, 3, 'three 0.1 minute jobs bill as three whole minutes');
  const r2 = C.ghCost({ plan: 'free', repoVis: 'private', runner: 'linux_2', jobsPerMonth: 1, minutesPerJob: 2.01 });
  assert.equal(r2.totalMinutes, 3);
});

t('GitHub storage distinguishes artifacts from cache and applies both allowances', () => {
  const r = C.ghCost({ plan: 'team', repoVis: 'private', runner: 'linux_2', jobsPerMonth: 0, minutesPerJob: 0, artifactGB: 5, retentionDays: 30, cacheGB: 15 });
  const artifact = r.lines.filter(l => /Artifact/.test(l.label))[0];
  const cache = r.lines.filter(l => /cache/.test(l.label))[0];
  assert.equal(artifact.amount, C.round2((5 - 2) * 0.25), '2 GB of storage is included on Team');
  assert.equal(cache.amount, C.round2((15 - 10) * 0.07), 'the first 10 GB of cache is free per repository');
});

t('Cloudflare counts pooled requests and CPU once, not once per product', () => {
  const shared = C.cfCost({ plan: 'paid', alreadyPaying: true, requests: 15000000, cpuMs: 40000000 });
  const lines = Object.fromEntries(shared.lines.map(l => [l.label, l.amount]));
  assert.equal(Object.keys(lines).filter(k => /requests/.test(k)).length, 1, 'one requests line');
  assert.equal(Object.keys(lines).filter(k => /CPU/.test(k)).length, 1, 'one CPU line');
  assert.equal(shared.monthly, C.round2(5 * 0.30 + 10 * 0.02), '5M billable requests and 10M billable CPU-ms, counted once');
  /* Adding a Workflows instance must not create a second request meter. */
  const withWf = C.cfCost({ plan: 'paid', alreadyPaying: true, requests: 15000000, cpuMs: 40000000, wfSteps: 1000000, wfStorageGB: 2 });
  const wfLines = withWf.lines.filter(l => /requests/i.test(l.label) || /CPU/.test(l.label));
  assert.equal(wfLines.length, 2, 'Workflow invocations add no extra request or CPU meter');
  assert.ok(withWf.monthly > shared.monthly, 'the Workflow step and storage meters do add cost');
});

t('the fixed Workers subscription is counted once, and only when it is new', () => {
  const fresh = C.cfCost({ plan: 'paid', alreadyPaying: false, requests: 0, cpuMs: 0 });
  assert.equal(fresh.monthly, C.cfBase);
  assert.equal(fresh.fixed, C.cfBase);
  const incumbent = C.cfCost({ plan: 'paid', alreadyPaying: true, requests: 0, cpuMs: 0 });
  assert.equal(incumbent.monthly, 0, 'an existing subscription is not counted again');
  assert.equal(incumbent.marginal, 0);
});

t('a free plan blocks rather than silently charging zero', () => {
  const over = C.cfCost({ plan: 'free', requests: 4000000 });
  assert.ok(over.blocked.length > 0, 'exceeding a free allowance must be surfaced');
  assert.ok(/Free plan|allowance/i.test(over.blocked[0]));
  const paidOnly = C.cfCost({ plan: 'free', queueOps: 1000 });
  assert.ok(paidOnly.blocked.some(b => /not available/i.test(b)), 'a paid-only product must be named as unavailable');
  const inside = C.cfCost({ plan: 'free', requests: 1000000, kvReads: 1000000 });
  assert.equal(inside.monthly, 0);
  assert.equal(inside.blocked.length, 0);
});

t('billable units round up before the rate is applied', () => {
  /* 1,000,001 Class A operations bill as 2,000,000. */
  const r = C.cfCost({ plan: 'paid', alreadyPaying: true, r2ClassA: 1000001 });
  const line = r.lines.filter(l => /Class A/.test(l.label))[0];
  assert.ok(line, 'a Class A line should exist');
  assert.equal(line.amount, C.round2(1 * 4.50), 'the included million is removed, then the million-and-one rounds up');
  assert.equal(r.monthly, 4.50);
});

t('a component with unpublished pricing is reported, never treated as free', () => {
  const r = C.cfCost({ plan: 'paid', alreadyPaying: true, vectorizeQueries: 0 });
  assert.ok(r.unmodeled.length > 0, 'unmodelled categories must be listed');
  const conv = C.convCost('vps', {});
  assert.ok(conv.monthly > 0);
  assert.ok(conv.unmodeled.some(u => /vary|inputs/i.test(u)), 'conventional prices must be described as inputs');
  const unknown = C.convCost('not-a-real-candidate', {});
  assert.equal(unknown.monthly, 0);
  assert.ok(unknown.unmodeled.some(u => /No cost model/i.test(u)), 'an unknown component must be reported as unmodelled');
});

t('a topology that needs a paid plan says so rather than describing itself as free', () => {
  const req = tpl('tpl-code-exec');
  const ev = C.evaluate(req);
  assert.ok(ev.preferred, 'the untrusted-code template needs an answer');
  const cautions = ev.preferred.cautions.join(' ');
  const blocked = (ev.preferred.cost.blocked || []).length;
  const paid = ev.preferred.pattern.nodes.some(n => C.candidateById(n.id).caps.paidRequired);
  if (paid) assert.ok(cautions.length > 0 || blocked > 0, 'a paid requirement must be surfaced to the reader');
});

/* ---------------- stages B and D ---------------- */
t('rankings are deterministic and every rejection is explained', () => {
  const req = tpl('tpl-auth-crud');
  const a = C.evaluate(req), b = C.evaluate(req);
  assert.deepEqual(a.feasible.map(r => r.id), b.feasible.map(r => r.id), 'the same input must give the same order');
  assert.ok(a.feasible[0].relevance >= a.feasible[a.feasible.length - 1].relevance, 'relevance is the first sort key');
  a.rejected.forEach(r => assert.ok(r.violations.length > 0));
  assert.ok(a.preferred && a.strongAlt, 'a preference and an alternative are both required');
  assert.notEqual(a.preferred.id, a.strongAlt.id);
  assert.ok(a.lowestCost && a.simplest, 'the cheapest and simplest picks are required');
  assert.ok(a.lowestCost.cost.monthly <= a.preferred.cost.monthly, 'the cheapest option cannot cost more than the preferred one');
});

t('the stated preference only reorders survivors, never the survivor set', () => {
  const base = tpl('tpl-multiday');
  const sets = ['least-overhead', 'lowest-cost', 'most-control'].map(p => {
    const ev = C.evaluate(C.merge(base, { opsPreference: p }));
    return ev.feasible.map(r => r.id).sort().join(',');
  });
  assert.equal(sets[0], sets[1]);
  assert.equal(sets[1], sets[2]);
});

t('weights change the ordering when the preference changes', () => {
  const base = C.merge(tpl('tpl-large-dataset'), { workloadType: 'data-lake' });
  const a = C.evaluate(C.merge(base, { opsPreference: 'least-overhead' }));
  const b = C.evaluate(C.merge(base, { opsPreference: 'most-control' }));
  const sameOrder = a.feasible.map(r => r.id).join() === b.feasible.map(r => r.id).join();
  const sameScores = a.feasible.every((r, i) => r.ops.weighted === b.feasible[i].ops.weighted);
  assert.ok(!sameOrder || !sameScores, 'a different preference should change either the order or the scores');
  assert.deepEqual(C.opsProfile(D.PATTERNS[0]).scores, C.opsProfile(D.PATTERNS[0], C.weightPresets['most-control']).scores, 'axis scores do not depend on weights');
});

t('sensitivity reports what a changed assumption would do', () => {
  const base = C.merge(tpl('tpl-static-site'), { workloadType: 'static-site' });
  const gaps = C.decisiveGaps(base);
  assert.ok(Array.isArray(gaps));
  gaps.forEach(g => {
    assert.ok(g.question && g.field, 'a gap needs a question');
    assert.ok(g.wouldAdd > 0 || g.wouldRemove > 0, 'a gap must actually change the survivor set');
  });
  const nativeGap = C.decisiveGaps(base).some(g => g.field === 'nativeBin');
  assert.ok(nativeGap, 'declaring a native requirement must change the feasible set');
  assert.ok(C.decisiveGaps(base).every(g => g.testedValue !== undefined), 'a gap records the value that was tested');
  /* Cost sensitivity is a separate, monotone question. */
  const req = C.merge(tpl('tpl-large-dataset'), { datasetGB: 200 });
  const sweep = C.sweep('cf-r2-dataset', req, 'datasetGB', [10, 100, 1000, 10000]);
  assert.equal(sweep.length, 4);
  assert.ok(sweep[3].monthly > sweep[0].monthly, 'more storage must cost more');
  assert.ok(sweep.every(s => s.feasible), 'a storage sweep should not break feasibility here');
});

t('break-even finds a boundary when one exists and refuses to invent one otherwise', () => {
  const req = C.merge(tpl('tpl-scheduled-refresh'), { publishTo: 'objects' });
  const vals = [30, 120, 300, 720, 1500, 3000, 6000, 12000];
  const a = C.sweep('gh-etl-r2-serve', req, 'frequencyPerMonth', vals);
  const b = C.sweep('cf-cron-ingest-d1', req, 'frequencyPerMonth', vals);
  const cross = C.crossing(a, b);
  /* Both sides model to zero on a public repository, so there is no honest crossing. */
  assert.equal(cross, null, 'identical zero series must not produce a crossing');
  /* Force a billable difference: private repository minutes against a metered Worker. */
  const a2 = C.sweep('gh-cron-batch', C.merge(req, { durationMin: 20 }), 'frequencyPerMonth', vals, { repoVis: 'private', plan: 'free' });
  const b2 = C.sweep('cf-cron-ingest-d1', C.merge(req, { durationMin: 20 }), 'frequencyPerMonth', vals, { repoVis: 'private', plan: 'free' });
  assert.ok(a2[0].monthly === 0 && a2[a2.length - 1].monthly > 0, 'the GitHub side must start free and become billable');
  const cross2 = C.crossing(a2, b2);
  assert.ok(cross2, 'a real cost divergence should produce a crossing');
  assert.ok(cross2.value >= vals[0] && cross2.value <= vals[vals.length - 1]);
  assert.ok(/between/.test(cross2.resolution), 'a crossing carries the resolution it was found at');
});

t('TCO separates platform cost, time and migration effort', () => {
  const ev = C.evaluate(tpl('tpl-readonly-api'));
  const r = C.tco(ev.preferred, { monthlyHours: 2, labourRatePerHour: 100, migrationHours: 12, recoveryMonths: 12 });
  assert.equal(r.platform, ev.preferred.cost.monthly);
  assert.equal(r.opsValue, 200);
  assert.equal(r.migrationValue, 100);
  assert.equal(r.total, C.round2(r.platform + 200 + 100));
  assert.ok(r.opsShare >= 0 && r.opsShare <= 100);
  assert.equal(C.tco(ev.preferred, { monthlyHours: 0, labourRatePerHour: 0, migrationHours: 0 }).total, r.platform);
});

/* ---------------- persistence and export ---------------- */
t('a serialised scenario carries only whitelisted requirements', () => {
  const req = C.merge(tpl('tpl-auth-crud'), { freeText: 'note', apiKey: 'SHOULD-NOT-SURVIVE', token: 'nope' });
  const s = C.serializeScenario('test', req, { savedAt: '2026-10-10T00:00:00.000Z', costOverrides: { vpsMonthly: 10 }, notes: 'n' });
  assert.equal(s.format, C.schema.format);
  assert.equal(s.version, C.schema.version);
  assert.equal(s.req.apiKey, undefined, 'unknown fields are stripped');
  assert.equal(s.req.token, undefined);
  assert.equal(s.req.workloadType, 'crud-api');
  assert.ok(JSON.stringify(s).indexOf('SHOULD-NOT-SURVIVE') < 0, 'no stray value survives');
  const keys = Object.keys(s.req);
  keys.forEach(k => assert.ok(Object.prototype.hasOwnProperty.call(D.FIELDS, k), 'unknown field kept: ' + k));
});

t('import validation rejects bad files and accepts good ones', () => {
  const good = C.serializeScenario('ok', tpl('tpl-static-site'), { savedAt: 'now' });
  assert.equal(C.validateImport(good).ok, true);
  assert.equal(C.validateImport(null).ok, false);
  assert.equal(C.validateImport('nope').ok, false);
  assert.equal(C.validateImport({ format: 'something-else', version: 1, req: {} }).ok, false);
  const future = C.validateImport({ format: C.schema.format, version: 99, req: { workloadType: 'other' } });
  assert.equal(future.ok, false);
  assert.ok(/newer version/.test(future.errors.join(' ')));
  const badType = C.validateImport({ format: C.schema.format, version: 1, req: { workloadType: 'other', durationMin: 'ten' } });
  assert.equal(badType.ok, false);
  assert.ok(/number/.test(badType.errors.join(' ')));
  const badChoice = C.validateImport({ format: C.schema.format, version: 1, req: { workloadType: 'teleportation' } });
  assert.equal(badChoice.ok, false);
  const extra = C.validateImport({ format: C.schema.format, version: 1, req: { workloadType: 'other', apiToken: 'x' } });
  assert.equal(extra.ok, false, 'unknown fields are rejected rather than trusted');
  const round = C.validateImport(JSON.parse(JSON.stringify(good)));
  assert.equal(round.ok, true, 'a round trip through JSON must still validate');
  assert.equal(round.data.req.workloadType, 'static-site');
});

t('a scenario reloaded from serialised form reproduces its recommendation', () => {
  D.SCENARIOS.slice(0, 12).forEach(s => {
    const direct = C.evaluate(C.scenarioReq(s));
    const restored = C.evaluate(C.merge(C.neutral(), JSON.parse(JSON.stringify(C.sanitizeReq(C.scenarioReq(s))))));
    assert.equal(restored.preferred.id, direct.preferred.id, s.id + ' changed after a serialise round trip');
  });
});

/* ---------------- search and formatting ---------------- */
t('search scoring is deterministic, ordered and empty-safe', () => {
  assert.equal(C.score('', 'x'), 0);
  assert.equal(C.score('anything', ''), 0);
  assert.equal(C.score('containers', 'zzz'), 0);
  const a = C.score('Cloudflare Containers instance types', 'containers');
  const b = C.score('something else entirely', 'containers');
  assert.ok(a > b);
  assert.equal(C.score('a b', 'a b'), C.score('a b', 'a b'));
});

t('numbers and money are formatted without false precision', () => {
  assert.equal(C.usd(0), '$0');
  assert.equal(C.usd(0.004), '$0.00');
  assert.equal(C.usd(12.5), '$12.50');
  assert.equal(C.usd(1234.5), '$1,234.50');
  assert.equal(C.usd(NaN), 'not modelled');
  assert.equal(C.usd(undefined), 'not modelled');
  assert.equal(C.fmtNum(Infinity), 'unlimited');
  assert.equal(C.round2(0.1 + 0.2), 0.3);
  assert.equal(C.num('x', 7), 7);
  assert.equal(C.num('12.5', 0), 12.5);
});

t('cost detail is always traceable to a line or an explicit omission', () => {
  const ev = C.evaluate(tpl('tpl-large-dataset'));
  ev.feasible.forEach(r => {
    if (r.cost.monthly > 0) assert.ok(r.cost.lines.length > 0, r.id + ' has a cost but no line items');
    r.cost.lines.forEach(l => {
      assert.ok(l.label && l.detail, r.id + ' line without a label or basis');
      assert.equal(typeof l.amount, 'number');
    });
    const sum = C.round2(r.cost.lines.reduce((a, l) => a + l.amount, 0));
    assert.equal(sum, r.cost.monthly, r.id + ' lines do not add up to the total');
    if (r.cost.unmodeled.length === 0) assert.ok(r.cost.monthly >= 0);
  });
});

/* ---------------- report ---------------- */
if (failures.length) {
  console.log(failures.length + ' check(s) failed:');
  failures.forEach(f => console.log('  FAIL ' + f));
  console.log(passed + ' checks passed, ' + failures.length + ' failed');
  process.exit(1);
}
console.log(passed + ' checks passed');
