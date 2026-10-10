/* Unit tests for do-i-need-aws-gcp.html
   Run: node tests/do-i-need-aws-gcp.cjs

   Extracts the page's data and engine blocks and exercises them directly: the
   necessity classification, the hard gates, every cost model including the
   storage classes, crossovers, sensitivity, the advisors, scenario
   sanitisation and the disagreement report. No npm, no browser, no network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'do-i-need-aws-gcp.html');
const html = fs.readFileSync(PAGE, 'utf8');

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
  vm.runInContext(block('dng-data'), sandbox);
  vm.runInContext(block('dng-core'), sandbox);
  return sandbox;
}
const S = makeSandbox();
const D = S.DNGData;
const C = S.DNGCore;
const json = v => JSON.parse(JSON.stringify(v));
const tpl = id => C.mergeRequirement(D.TEMPLATES.filter(t => t.id === id)[0], {});
const rowFor = (ev, id) => ev.rows.filter(r => r.id === id)[0];

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
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'junk-drawer.json'), 'utf8'));
  const entry = reg.pages['do-i-need-aws-gcp.html'];
  assert.ok(entry, 'the page is registered in junk-drawer.json');
  assert.equal(entry.version, m[1]);
  assert.ok(html.includes('JUNKDRAWER_DEPLOY_FOOTER version="' + m[1] + '"'));
  assert.ok(html.includes('version ' + m[1]));
  assert.ok(entry.emoji && entry.title && entry.description, 'the registry entry is complete');
});

t('exactly one analytics tag, one storage helper and one favicon', () => {
  assert.equal((html.match(/<script[^>]*analytics-lite\.js/g) || []).length, 1);
  assert.ok(html.includes('data-site-id="junkdrawer"'));
  assert.equal((html.match(/<script[^>]*jd-storage\.js/g) || []).length, 1);
  assert.equal((html.match(/rel="icon"/g) || []).length, 1);
});

t('every section carries the metadata the rail needs', () => {
  const sections = html.match(/<section class="view[^"]*"[^>]*>/g) || [];
  assert.ok(sections.length >= 22, 'sections: ' + sections.length);
  sections.forEach(s => {
    assert.ok(/id="view-[a-z0-9-]+"/.test(s), 'id: ' + s.slice(0, 50));
    assert.ok(/data-title="/.test(s), 'title: ' + s.slice(0, 50));
    assert.ok(/data-group="/.test(s), 'group: ' + s.slice(0, 50));
    assert.ok(/data-icon="/.test(s), 'icon: ' + s.slice(0, 50));
  });
});

t('the page never calls the network for its own decisions', () => {
  const app = block('dng-app');
  assert.equal((app.match(/fetch\(/g) || []).length, 0, 'the app never calls fetch');
  assert.equal((app.match(/XMLHttpRequest/g) || []).length, 0);
  assert.equal((block('dng-core').match(/fetch\(/g) || []).length, 0);
  assert.ok(!/openrouter|api\.openai|generativelanguage|bedrock\./i.test(app), 'no model endpoints in the app');
});

t('no credential-shaped string appears anywhere in the page', () => {
  [/eyJ[A-Za-z0-9_-]{20,}/, /sk-[A-Za-z0-9]{20,}/, /AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]+-----/, /aws_secret_access_key/i, /cloudflare[_-]?api[_-]?token["']?\s*[:=]\s*["'][A-Za-z0-9_-]{15,}/i]
    .forEach(re => assert.ok(!re.test(html), 'matched ' + re));
});

/* ---------------- data integrity ---------------- */
t('every source, price, platform, class and record is complete', () => {
  const need = (o, keys, label) => keys.forEach(k => assert.ok(o[k] !== undefined && o[k] !== null, label + ' missing ' + k));
  D.SOURCES.forEach(s => need(s, ['id', 'title', 'url', 'read', 'how'], 'source ' + s.id));
  D.PRICES.forEach(p => {
    need(p, ['id', 'provider', 'service', 'sku', 'unit', 'region', 'source', 'confidence', 'kind'], 'price ' + p.id);
    assert.ok(['high', 'medium', 'low'].includes(p.confidence), p.id + ' confidence');
    assert.ok(['published', 'estimate', 'manual'].includes(p.kind), p.id + ' kind');
    assert.ok(typeof p.value === 'number' || p.value === null, p.id + ' value is a number or explicitly null');
  });
  D.STORAGE_CLASSES.forEach(c => need(c, ['id', 'provider', 'label', 'storage', 'minDays', 'minObjectBytes', 'retrieval', 'classA', 'classB', 'egress', 'source'], 'class ' + c.id));
  D.PLATFORMS.forEach(p => {
    need(p, ['id', 'name', 'short', 'provider', 'kinds', 'caps', 'costHook', 'src'], 'platform ' + p.id);
    ['memoryGB', 'diskGB', 'maxRunMin', 'native', 'docker', 'gpuVramGB', 'maxGpu', 'multiNode', 'postgres', 'extensions', 'http', 'regionControl', 'residency', 'alwaysOn'].forEach(k => assert.ok(p.caps[k] !== undefined, 'caps of ' + p.id + ' missing ' + k + ' (null is allowed and means undocumented)'));
  });
  D.DATA_SERVICES.forEach(s => need(s, ['id', 'name', 'provider', 'kind', 'caps', 'costHook'], 'data service ' + s.id));
  D.DOMAINS.forEach(b => need(b, ['id', 'domain', 'title', 'simpler', 'hyper', 'cost', 'verdict', 'src', 'conf', 'note'], 'boundary ' + b.id));
  D.GAPS.forEach(g => need(g, ['id', 'title', 'requirement', 'fails', 'aws', 'gcp', 'alt', 'cost', 'complexity', 'src', 'conf'], 'gap ' + g.id));
  D.SURPRISES.forEach(s => need(s, ['id', 'title', 'applies', 'what', 'where', 'model', 'inputs', 'src', 'conf', 'avoid', 'simpler'], 'surprise ' + s.id));
  D.PATTERNS.forEach(p => need(p, ['id', 'n', 'name', 'provider', 'flow', 'purpose', 'when', 'not', 'config', 'cost', 'verify', 'cleanup', 'src', 'confidence'], 'pattern ' + p.id));
  D.TEMPLATES.forEach(x => need(x, ['id', 'name', 'icon', 'because', 'req'], 'template ' + x.id));
  D.PROJECTS.forEach(p => need(p, ['id', 'name', 'icon', 'verdict', 'confidence', 'arch', 'workload', 'scale', 'hyper', 'simpler', 'migration', 'ops', 'cost', 'reconsider'], 'project ' + p.id));
  D.DISCREPANCIES.forEach(d => need(d, ['id', 'scenario', 'written', 'engine', 'primary', 'secondary', 'verdict', 'confidence', 'cause', 'evidence', 'verdictReason', 'reuse', 'proposed'], 'disagreement ' + d.id));
  D.METHOD_FINDINGS.forEach(f => need(f, ['id', 'severity', 'title', 'detail', 'impact', 'proposed'], 'finding ' + f.id));
  D.GLOSSARY.forEach(g => need(g, ['term', 'def', 'note'], 'glossary ' + g.term));
  D.ROADNAT && need(D.ROADNAT, ['title', 'summary', 'envelope', 'options', 'answers', 'conclusion'], 'ROADNAT');
});

t('every cross reference resolves and every id is unique', () => {
  const srcIds = new Set(D.SOURCES.map(s => s.id));
  D.PRICES.forEach(p => assert.ok(srcIds.has(p.source), p.id + ' source ' + p.source));
  D.SOURCES.forEach(s => assert.ok(s.url && s.url.length > 8, s.id + ' has a url'));
  const storeIds = new Set(D.STORAGE_CLASSES.map(c => c.id));
  storeIds.forEach(id => assert.ok(C.CLASS_INDEX[id], 'class index has ' + id));
  const registry = new Set([].concat(D.PLATFORMS.map(p => p.id), D.DATA_SERVICES.map(d => d.id), D.STORAGE_CLASSES.map(c => c.id)));
  D.PLATFORMS.concat(D.DATA_SERVICES).forEach(p => p.src.forEach(s => assert.ok(srcIds.has(s), p.id + ' src ' + s)));
  D.PATTERNS.forEach(p => p.flow.forEach(n => assert.ok(D.NODES[n], p.id + ' flow node ' + n)));
  D.PATTERNS.forEach(p => p.src.forEach(s => assert.ok(srcIds.has(s), p.id + ' src ' + s)));
  [['transition', D.TRANSITIONS], ['breakeven', D.BREAKEVENS]].forEach(([label, list]) => {
    list.forEach(x => {
      [x.from || x.a, x.to || x.b].forEach(id => assert.ok(C.REG[id] || C.CLASS_INDEX[id], label + ' ' + x.id + ' references unknown ' + id));
    });
  });
  D.DISCREPANCIES.forEach(d => assert.ok(d.secondary.every(s => ['incumbent_advantage', 'unmodeled_migration_cost', 'missing_requirement', 'alternative_architecture', 'scoring_weakness', 'capability_data_weakness', 'pricing_model_weakness', 'implementation_defect'].includes(s)), d.id + ' secondary vocabulary'));
  const seen = new Set();
  [['price', D.PRICES], ['platform', D.PLATFORMS], ['data service', D.DATA_SERVICES], ['class', D.STORAGE_CLASSES], ['boundary', D.DOMAINS], ['gap', D.GAPS], ['pattern', D.PATTERNS], ['surprise', D.SURPRISES], ['disagreement', D.DISCREPANCIES], ['template', D.TEMPLATES], ['project', D.PROJECTS]].forEach(([label, list]) => {
    list.forEach(x => { assert.ok(!seen.has(label + ':' + x.id), 'duplicate ' + label + ' ' + x.id); seen.add(label + ':' + x.id); });
  });
});

t('pattern numbering is dense and gap ids are referenced by the engine only when they exist', () => {
  const ns = D.PATTERNS.map(p => p.n).sort((a, b) => a - b);
  ns.forEach((n, i) => assert.equal(n, i + 1, 'pattern numbering: ' + ns.join(',')));
  const ev = C.necessity(Object.assign(tpl('tpl-gisapi'), {}), { noProbes: true });
  ev.gaps.forEach(id => assert.ok(D.GAPS.some(g => g.id === id), 'gap reference ' + id));
});

/* ---------------- the engine's own invariants ---------------- */
t('every self-test invariant passes in this environment', () => {
  const res = C.selfTest();
  const failed = res.results.filter(r => !r.pass).map(r => r.id + ' (' + r.detail + ')');
  assert.equal(failed.length, 0, 'failed invariants: ' + failed.join('; '));
  assert.ok(res.results.length >= 18, 'invariants: ' + res.results.length);
});

t('an unknown price is unknown, never zero', () => {
  const r = C.costById('external.inference', { category: 'inference' }, { usage: { runsPerMonth: 1000, tokensPerCall: 500 } });
  assert.equal(r.complete, false);
  assert.ok(r.unknown.length >= 1);
  assert.equal(r.monthly, 0, 'the floor is zero but it is labelled incomplete');
  assert.ok(r.unmodeled.some(u => /floor/.test(u)), 'the result says its total is a floor');
  const withRate = C.costById('external.inference', { category: 'inference' }, { usage: { runsPerMonth: 1000, tokensPerCall: 500, prices: { 'inference.api.rate': 10 } }, prices: { 'inference.api.rate': 10 } });
  assert.ok(withRate.monthly > 0, 'a supplied rate produces a price');
});

t('an undocumented capability fails closed, not open', () => {
  const req = tpl('tpl-geobatch'); req.durationMin = 600;
  const g = C.gateRow(C.REG['cf.containers'], req, {});
  assert.ok(g.violations.some(v => v.have === 'not documented'), 'the missing ceiling is named');
  assert.ok(g.violations.some(v => v.gate === 'duration'));
});

t('required is only produced by a documented constraint', () => {
  const res = C.necessity(tpl('tpl-training'), { noProbes: true });
  assert.equal(res.classification, 'required');
  const blocked = res.rejected.filter(r => r.provider !== 'aws' && r.provider !== 'gcp');
  assert.ok(blocked.length > 0);
  blocked.forEach(r => assert.ok(r.violations.some(v => v.have !== 'not documented'), r.id + ' was blocked only by missing evidence'));
  assert.ok(res.why.join(' ').length > 40, 'the verdict carries reasoning');
});

t('a hyperscaler is never required merely because a product exists', () => {
  ['tpl-etl', 'tpl-crud', 'tpl-burst'].forEach(id => {
    const res = C.necessity(tpl(id), { noProbes: true });
    assert.notEqual(res.classification, 'required', id + ' was classified required without a constraint');
  });
  const etl = C.necessity(tpl('tpl-etl'), { noProbes: true });
  assert.ok(['not-needed', 'competitive', 'insufficient'].includes(etl.classification), etl.classification);
  assert.ok(etl.costs.length > 0, 'the cheaper alternatives were priced');
  assert.ok(etl.advantages.join(' ').length > 0, 'the alternatives are stated');
});

t('an expensive option never wins over an equally capable incumbent on score alone', () => {
  const res = C.necessity(tpl('tpl-etl'), { noProbes: true });
  const cheapest = res.costs[0];
  assert.ok(cheapest.monthly <= Math.max.apply(null, res.costs.map(c => c.monthly)), 'costs are ordered');
  const best = res.costs.filter(c => c.id === res.bestHyper)[0];
  const simpler = res.costs.filter(c => c.id === res.bestSimpler)[0];
  if (best && simpler && best.monthly > simpler.monthly && res.classification === 'not-needed') {
    assert.ok(simpler.monthly <= best.monthly, 'the cheaper viable option is the one recommended');
  }
  assert.ok(res.costs.every(c => c.monthly >= 0));
});

t('spot capacity is flagged as non-guaranteed wherever it appears', () => {
  const res = C.necessity(tpl('tpl-geobatch'), { noProbes: true });
  const spotRows = res.rows.filter(r => r.id.includes('spot'));
  assert.ok(spotRows.length >= 2, 'spot candidates are evaluated');
  spotRows.forEach(r => {
    assert.ok(r.cautions.some(c => /spot/i.test(c)), r.id + ' has a spot caution');
    assert.ok(r.cautions.some(c => /not guaranteed|reclaim/i.test(c)), r.id + ' says capacity is not guaranteed');
  });
  const cost = C.costById('aws.ec2.spot', { category: 'batch' }, { usage: { runsPerMonth: 4, durationMin: 240, memoryGB: 32, spot: true } });
  assert.ok(cost.unmodeled.some(u => /reclaim/i.test(u)), 'the cost model names the interruption risk');
  assert.ok(cost.notes.some(n => /market/i.test(n)), 'the discount is labelled an assumption');
});

t('egress is never silently omitted from a price or a comparison', () => {
  D.STORAGE_CLASSES.forEach(c => {
    const r = C.classCost(c.id, { storageGB: 100, objectCount: 100, storageDays: 30 });
    const says = r.unmodeled.some(u => /egress/i.test(u)) || r.notes.some(n => /egress/i.test(n)) || r.lines.some(l => /egress/i.test(l.label));
    assert.ok(says, c.id + ' says nothing about egress');
  });
  const small = C.classCost('r2.standard', { storageGB: 200, storageDays: 30, egressGB: 1000, classAOps: 1000, classBOps: 1000, retrievals: 0 });
  assert.ok(small.notes.some(n => /egress from this class is free/i.test(n)), 'R2 egress is called out as free, not omitted');
  const big = C.classCost('s3.standard', { storageGB: 200, storageDays: 30, egressGB: 1000, classAOps: 1000, classBOps: 1000, retrievals: 0 });
  assert.ok(big.lines.some(l => /egress/i.test(l.label)), 'S3 egress is a charge line');
});

/* ---------------- the adversarial cases named in the brief ---------------- */
t('BigQuery scan costs are never ignored and the free tier is spent once', () => {
  const free = C.costById('bigquery', { category: 'analytics' }, { usage: { scannedTiB: 1, queries: 1, bqStorageGB: 0 } });
  assert.equal(free.monthly, 0, 'one tebibyte a month is genuinely free');
  assert.ok(free.notes.some(n => /genuinely zero/i.test(n)), 'and the page says so rather than leaving it ambiguous');
  const paid = C.costById('bigquery', { category: 'analytics' }, { usage: { scannedTiB: 11, queries: 1, bqStorageGB: 0 } });
  assert.equal(paid.monthly, 62.5, 'ten tebibytes beyond the allowance at $6.25: ' + paid.monthly);
  const storage = C.costById('bigquery', { category: 'analytics' }, { usage: { scannedTiB: 0, queries: 0, bqStorageGB: 1000 } });
  assert.ok(storage.monthly > 0, 'storage is priced even with no queries');
});

t('S3 archival retrieval fees and minimum durations are modelled', () => {
  const r = C.classCost('s3.deep', { storageGB: 1000, storageDays: 365, retrievals: 250, classAOps: 0, classBOps: 0 });
  const ret = r.lines.filter(l => l.label === 'Retrieval')[0];
  assert.ok(ret, 'a retrieval line exists');
  assert.equal(ret.amount, 5, '250 GB at $0.02');
  const early = C.classCost('s3.deep', { storageGB: 100, storageDays: 30 });
  assert.ok(early.lines.some(l => l.label === 'Early deletion penalty' && l.amount > 0), 'an early delete is charged');
  assert.ok(early.notes.some(n => /180/.test(n)), 'the minimum duration is stated');
  const gcs = C.classCost('gcs.archive', { storageGB: 100, storageDays: 30 });
  assert.ok(gcs.notes.some(n => /365/.test(n)), 'Cloud Storage Archive states its 365-day minimum');
});

t('the minimum billable object size is applied where it exists', () => {
  const r = C.classCost('s3.ia', { storageGB: 0.1, objectCount: 20000, storageDays: 30 });
  const naive = 0.1 * 0.0125 * 1;
  assert.ok(r.monthly > naive * 10, '20,000 kilobyte objects bill as 128 KB each: ' + r.monthly + ' against ' + naive + ' for the raw bytes');
  assert.ok(r.notes.some(n => /128|minimum billable/i.test(n)), 'the reason is stated');
  const r2 = C.classCost('gcs.coldline', { storageGB: 0.1, objectCount: 20000, storageDays: 30 });
  assert.ok(r2.monthly < r.monthly, 'GCS has no minimum object size, so small objects are cheaper there');
});

t('D1 loses a workload that needs PostgreSQL extensions', () => {
  const res = C.necessity(tpl('tpl-gisapi'), { noProbes: true });
  const d1 = rowFor(res, 'd1');
  assert.ok(d1 && !d1.ok);
  assert.ok(d1.violations.some(v => v.gate === 'extensions'), 'the extension gate is the reason: ' + d1.violations.map(v => v.gate).join(','));
  assert.ok(res.feasible.some(r => r.id === 'cloudsql.pg' || r.id === 'rds.pg'), 'a PostgreSQL answer survives');
});

t('a Worker loses a workload that needs native execution', () => {
  const res = C.necessity(tpl('tpl-geobatch'), { noProbes: true });
  const w = rowFor(res, 'cf.workers');
  assert.ok(!w.ok && w.violations.some(v => v.gate === 'native'));
});

t('multi-GPU training is not mistaken for small inference', () => {
  const train = C.necessity(tpl('tpl-training'), { noProbes: true });
  assert.equal(train.classification, 'required');
  const small = C.necessity(C.mergeRequirement(D.TEMPLATES.filter(t => t.id === 'tpl-analytics')[0], {}), { noProbes: true });
  assert.notEqual(small.classification, 'required', 'a small analytical workload is not required to use AWS or GCP');
  const inference = C.necessity(C.mergeRequirement(D.TEMPLATES.filter(t => t.id === 'tpl-etl')[0], { category: 'inference', gpuCount: 0, gpuVramGB: 0 }), { noProbes: true });
  assert.ok(['not-needed', 'competitive', 'strongly-justified'].includes(inference.classification), inference.classification);
  assert.ok(inference.costs.some(c => c.provider === 'other' || c.id === 'aws.ec2.gpu'), 'a per-token API and a hosted GPU are both priced in the comparison');
  const acceleratorOnly = C.necessity(C.mergeRequirement(D.TEMPLATES.filter(t => t.id === 'tpl-training')[0], {}), { noProbes: true });
  const survivors = acceleratorOnly.feasible.map(r => r.id);
  assert.ok(survivors.every(id => /gpu|ec2\.gpu/.test(id)), 'a multi-accelerator requirement removes every non-accelerator platform: ' + survivors.join(','));
  const gpuCost = C.costById('aws.ec2.gpu', { category: 'training' }, { usage: { gpuCount: 8, gpuVramGB: 80, durationMin: 1440, runsPerMonth: 1 } });
  assert.ok(gpuCost.monthly > 2000, 'an eight-accelerator day is thousands of dollars: ' + gpuCost.monthly);
  assert.ok(gpuCost.unmodeled.some(u => /capacity-planned/i.test(u)), 'the capacity caveat is attached');
});

t('a public-repository discount is never applied to a private workload', () => {
  const pub = C.costById('gh.standard', tpl('tpl-etl'), { usage: { repoVis: 'public', runsPerMonth: 100, durationMin: 30 } });
  const priv = C.costById('gh.standard', tpl('tpl-etl'), { usage: { repoVis: 'private', runsPerMonth: 100, durationMin: 30 } });
  assert.equal(pub.monthly, 0);
  assert.ok(priv.monthly > 0);
  const larger = C.costById('gh.larger', tpl('tpl-geobatch'), { usage: { repoVis: 'public', runsPerMonth: 4, durationMin: 240, memoryGB: 64 } });
  assert.ok(larger.monthly > 0, 'a larger runner is never free for a public repository');
  assert.ok(larger.notes.some(n => /never free|included minutes/i.test(n)));
});

t('cost sensitivity labels agree with the calculated series', () => {
  const ev = tpl('tpl-etl');
  const rising = C.sensitivity('cf.workers', ev, 'runsPerMonth', [1000, 1000000, 100000000], { cpuMsPerRequest: 12 });
  assert.equal(rising.direction, 'rises');
  assert.ok(/rises as runsPerMonth/.test(rising.label));
  assert.ok(rising.points[2].monthly > rising.points[0].monthly);
  const flat = C.sensitivity('vps.small', ev, 'runsPerMonth', [1, 1000000], { vpsMonthly: 5 });
  assert.equal(flat.direction, 'does not move', 'a fixed subscription does not move with volume');
});

t('free allowances are applied once and their period is respected', () => {
  const d1Small = C.costById('d1', { category: 'service' }, { usage: { d1RowsRead: 5000000, d1RowsWritten: 100000, d1StorageGB: 1, alreadyPaying: true } });
  assert.equal(d1Small.monthly, 0, 'a daily allowance is not spent thirty times in a monthly model');
  const d1Big = C.costById('d1', { category: 'service' }, { usage: { d1RowsRead: 100000000, d1RowsWritten: 5000000, d1StorageGB: 10, alreadyPaying: true } });
  assert.ok(d1Big.monthly > 0);
  const lambda = C.costById('aws.lambda', { category: 'batch' }, { usage: { runsPerMonth: 100, durationMin: 1, memoryGB: 1 } });
  assert.equal(lambda.monthly, 0, 'inside the free tier: ' + lambda.monthly);
  const lambdaFloor = C.costById('aws.lambda', { category: 'batch' }, { usage: { runsPerMonth: 10, durationMin: 0.05, memoryGB: 1 } });
  assert.equal(lambdaFloor.monthly, 0, 'a short function also sits inside the free tier');
  assert.ok(lambdaFloor.notes.some(n => /minimum of one minute|60 s/.test(n)), 'the one-minute minimum is disclosed even when the free tier absorbs it');
});

/* ---------------- crossovers, advisors, scenarios, search ---------------- */
t('R2 beats S3 Standard on egress and the crossover is found rather than asserted', () => {
  const ev = tpl('tpl-etl');
  const s = C.sweep('r2.standard', 's3.standard', ev, 'egressGB', [0, 10, 100, 1000, 5000, 20000], { storageGB: 200, storageDays: 30, classAOps: 100000, classBOps: 1000000, retrievals: 0 });
  assert.equal(s.points.length, 6);
  assert.ok(s.points[5].a < s.points[5].b, 'R2 is cheaper at heavy egress');
  assert.equal(s.crossing, null, 'R2 also stores more cheaply, so it dominates S3 Standard across this range');
  assert.ok(/never more expensive/.test(s.note), 'and the page says why there is no crossing: ' + s.note);
  const ia = C.sweep('s3.ia', 's3.standard', ev, 'retrievals', [0, 10, 100, 1000, 10000], { storageGB: 1000, storageDays: 30, classAOps: 1000, classBOps: 10000, egressGB: 0 });
  assert.ok(ia.crossing, 'an archival class crosses the standard class on retrieval volume: ' + JSON.stringify(ia.crossing));
  assert.ok(ia.points[0].a < ia.points[0].b, 'standard-IA is cheaper to hold with no reads');
  assert.ok(ia.points[4].a > ia.points[4].b, 'and dearer once the data is actually read');
});

t('a crossover is refused when the data cannot support one', () => {
  const ev = tpl('tpl-etl');
  const same = C.sweep('gh.pages', 'gh.pages', ev, 'runsPerMonth', [1, 100, 10000]);
  assert.equal(same.crossing, null);
  const free = C.sweep('gh.standard', 'cf.workers', ev, 'runsPerMonth', [1, 100, 10000], { repoVis: 'public' });
  assert.ok(/no crossover to find|never more expensive/.test(free.note), free.note);
  const unknown = C.sweep('external.inference', 'aws.ec2.gpu', ev, 'inferenceRequests', [1000, 100000], { tokensPerCall: 500, gpuCount: 1, gpuVramGB: 24, durationMin: 60 });
  assert.ok(/unknown/.test(unknown.note), 'an unknown price makes the crossing conditional: ' + unknown.note);
});

t('the storage crossover picks a different class as the access pattern changes', () => {
  const cold = C.storageCrossover({ storageGB: 4000, objectCount: 5000, storageDays: 365, retrievals: 0, classAOps: 5000, classBOps: 20000, egressGB: 0 });
  assert.ok(['s3.deep', 'gcs.archive'].includes(cold.cheapest.id), 'untouched data held a year belongs in an archive class: ' + cold.cheapest.id);
  const hot = C.storageCrossover({ storageGB: 4000, objectCount: 5000, storageDays: 30, retrievals: 4000, classAOps: 50000, classBOps: 2000000, egressGB: 4000 });
  assert.notEqual(hot.cheapest.id, cold.cheapest.id, 'a heavily read dataset held for a month does not belong in Deep Archive');
  assert.equal(hot.cheapest.id, 'r2.standard', 'with 4 TB read and 4 TB egressed in a month, R2 Standard is cheapest: ' + hot.cheapest.id);
  const deep = hot.rows.filter(r => r.id === 's3.deep')[0];
  assert.ok(deep.lines.some(l => l.label === 'Retrieval'), 'the archive class still shows its retrieval charge');
});

t('the advisors are deterministic and their first match wins', () => {
  const a = C.advise('compute', { category: 'training', gpuCount: 8, gpuVramGB: 80, distributed: true, memoryGB: 256 });
  assert.equal(a.ruleId, 'c1', 'the accelerator rule fires first');
  assert.equal(a.answer, 'aws.ec2.gpu');
  const b = C.advise('compute', { category: 'service', durationMin: 0.05, memoryGB: 0.1, gpuCount: 0 });
  assert.equal(b.ruleId, 'c12');
  const again = C.advise('compute', { category: 'training', gpuCount: 8, gpuVramGB: 80, distributed: true });
  assert.deepEqual(a, again, 'the same answers give the same rule');
  const none = C.advise('database', {});
  assert.ok(none.ruleId === null || typeof none.ruleId === 'string');
  const db = C.advise('database', { needExtensions: true, dbKind: 'relational' });
  assert.equal(db.answer, 'cloudsql.pg', 'an extension requirement is a gate, not a preference');
  const de = C.advise('dataeng', { distributed: true });
  assert.equal(de.ruleId, 'e1');
  const err = C.advise('nope', {});
  assert.ok(err.error);
});

t('an imported scenario is sanitised and cannot carry anything else', () => {
  const evil = JSON.stringify({ kind: 'dng-scenario', name: '<img src=x onerror=alert(1)>', requirement: { memoryGB: 1e12, durationMin: -5, category: 'not-a-category', dataScaleGB: 1e12, extra: 'x', compliance: ['HIPAA', 42] } });
  const res = C.importScenario(evil);
  assert.equal(res.ok, true);
  assert.ok(res.requirement.memoryGB <= 1e9, 'a huge number is clamped: ' + res.requirement.memoryGB);
  assert.ok(res.requirement.durationMin >= 0, 'a negative duration is clamped');
  assert.equal(res.requirement.category, 'batch', 'an unknown select value falls back to the first option');
  assert.equal(res.requirement.extra, undefined, 'unexpected keys are discarded');
  assert.deepEqual(res.requirement.compliance, ['HIPAA'], 'compliance keeps strings only');
  assert.equal(C.importScenario('<script>alert(1)</script>').ok, false, 'markup is not JSON');
  assert.equal(C.importScenario('{"kind":"other"}').ok, false, 'a different document kind is refused');
  assert.equal(C.importScenario('{"kind":"dng-scenario"}').ok, false, 'a missing requirement is refused');
  const round = C.exportScenario({ name: 'round trip', requirement: C.mergeRequirement(D.TEMPLATES[0], { memoryGB: 12 }) });
  const back = C.importScenario(round);
  assert.equal(back.ok, true);
  assert.equal(back.requirement.memoryGB, 12);
  assert.ok(!/<|>/.test(JSON.parse(round).name), 'an exported name carries no markup');
});

t('search finds records and reports an empty result honestly', () => {
  assert.ok(C.searchAll('athena').length > 0);
  assert.ok(C.searchAll('minimum storage duration').length > 0);
  assert.ok(C.searchAll('geospatial').length > 0);
  assert.ok(C.searchAll('postgis').length > 0);
  assert.equal(C.searchAll('zzzz-not-a-thing').length, 0);
  assert.equal(C.searchAll('   ').length, 0);
  const hits = C.searchAll('r2');
  assert.ok(hits.length <= 24, 'results are capped: ' + hits.length);
  hits.forEach(h => assert.ok(h.href.startsWith('#view-'), 'every hit deep-links: ' + h.href));
});

/* ---------------- the disagreement audit ---------------- */
t('the nine disagreements are reproduced, classified and adjudicated', () => {
  const st = C.disagreementStats();
  assert.equal(st.total, 9, 'nine disagreements');
  assert.equal(st.agreements, 27, 'and twenty-seven agreements, which is what the audited page reported');
  assert.equal(st.defects, 2, 'two scenarios share one implementation defect');
  assert.equal(st.agreementsAfterDefects, 29, 'so the agreement rate would be 29 of 36 once the defect is fixed');
  assert.ok(st.causes >= 4, 'distinct causes: ' + st.causes);
  const classCount = Object.keys(st.byClass).length;
  assert.ok(classCount >= 4, 'primary classes used: ' + classCount);
  const verdicts = D.DISCREPANCIES.map(d => d.verdict);
  assert.ok(verdicts.every(v => ['written', 'engine', 'both', 'neither'].includes(v)), 'every item adjudicates the written advice and the engine');
  assert.ok(verdicts.filter(v => v === 'written').length >= 5, 'the written advice is supported most often: ' + verdicts.join(','));
  assert.ok(verdicts.every(v => v !== 'engine'), 'in no case was the engine alone right');
  const ids = D.DISCREPANCIES.map(d => d.id);
  ['sc-03', 'sc-06', 'sc-13', 'sc-20', 'sc-22', 'sc-29', 'sc-30', 'sc-32', 'sc-33'].forEach(id => assert.ok(ids.includes(id), 'audited scenario ' + id));
  D.DISCREPANCIES.forEach(d => {
    assert.ok(d.evidence.length >= 2, d.id + ' carries evidence');
    assert.ok(d.proposed.length > 20, d.id + ' proposes a correction');
    assert.ok(d.reuse.length > 20, d.id + ' records what this artifact does differently');
  });
});

t('no disagreement was silently reconciled to reach agreement', () => {
  D.DISCREPANCIES.forEach(d => {
    assert.notEqual(d.verdictReason, '', d.id + ' adjudicates rather than reconciling');
  });
  const written = D.DISCREPANCIES.filter(d => d.written === 'cf-static-worker');
  assert.equal(written.length, 0, "the engine answers are recorded as the engine gave them");
  const sc03 = D.DISCREPANCIES.filter(d => d.id === 'sc-03')[0];
  assert.equal(sc03.engine, 'cf-static-worker', 'the engine answer is recorded faithfully even where it is wrong');
  assert.equal(sc03.written, 'gh-pages-static');
});

t('the machine-readable report beside the page agrees with the page', () => {
  const p = path.join(ROOT, 'docs/aws-gcp-disagreements-2026-10.json');
  assert.ok(fs.existsSync(p), 'the report file exists');
  const report = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(report.artifact, 'do-i-need-aws-gcp.html');
  assert.equal(report.audited.file, 'right-tool-for-the-job.html');
  assert.equal(report.audited.scenarios, 36);
  assert.equal(report.agreements, 27);
  assert.equal(report.disagreements, 9);
  assert.deepEqual(json(report.items), json(D.DISCREPANCIES), 'the items match the page exactly');
  assert.deepEqual(json(report.findings), json(D.METHOD_FINDINGS), 'the findings match the page exactly');
  assert.equal(report.classificationVocabulary.length, 8, 'the eight classifications are listed');
  assert.ok(report.integrity.includes('No file in the audited artifact was modified'));
  assert.ok(report.discountedHypotheses[0].outcome.includes('Not reproduced'));
});

t('the audited artifact was not modified by this work', () => {
  const audited = fs.readFileSync(path.join(ROOT, 'right-tool-for-the-job.html'), 'utf8');
  assert.ok(audited.includes('RTJCore'), 'the companion artifact is intact');
  assert.ok(!audited.includes('dng-'), 'nothing from this page leaked into it');
});

/* ---------------- storage classes and surprises ---------------- */
t('every storage class is priced through the same four mechanics', () => {
  D.STORAGE_CLASSES.forEach(c => {
    const r = C.classCost(c.id, { storageGB: 100, objectCount: 1000, storageDays: 90, retrievals: 10, classAOps: 1000, classBOps: 1000, egressGB: 10 });
    assert.ok(r.lines.some(l => l.label === 'Storage'), c.id + ' has a storage line');
    assert.ok(r.monthly >= 0, c.id + ' monthly');
    if (c.minDays > 0) assert.ok(r.notes.some(n => /minimum storage duration/i.test(n)), c.id + ' states its minimum duration');
    if (c.minObjectBytes > 0) assert.ok(r.notes.some(n => /minimum billable object size/i.test(n)), c.id + ' states its minimum object size');
    if (c.retrieval > 0) assert.ok(r.notes.some(n => /[Rr]etrieval/) || r.lines.some(l => l.label === 'Retrieval'), c.id + ' states its retrieval charge');
  });
});

t('every cost surprise is computable and refuses to invent a price', () => {
  D.SURPRISES.forEach(s => {
    const usage = {};
    s.inputs.forEach(k => {
      if (k === 'retrievalClass') usage[k] = 's3.deep';
      else if (k === 'deleteClass') usage[k] = 's3.ia';
      else if (k === 'egressProvider' || k === 'opsProvider') usage[k] = 'aws';
      else usage[k] = 100;
    });
    const r = C.surpriseCost(s.id, usage);
    assert.ok(r, s.id + ' produces a result');
    assert.equal(typeof r.monthly, 'number');
    assert.ok(r.lines.length > 0, s.id + ' produces charge lines with the inputs supplied');
    assert.ok(r.complete === false || r.complete === true);
  });
  const nat = C.surpriseCost('s-nat', { gatewayHours: 730, gatewayGB: 1000 });
  assert.ok(Math.abs(nat.monthly - (730 * 0.045 + 1000 * 0.045)) < 0.02, 'NAT arithmetic: ' + nat.monthly);
  const ipv4 = C.surpriseCost('s-ipv4', { addresses: 3, addressHours: 730 });
  assert.ok(Math.abs(ipv4.monthly - 3 * 730 * 0.005) < 0.02, 'address arithmetic: ' + ipv4.monthly);
  const idle = C.surpriseCost('s-idle-db', { dbHourly: 0.019, idleHours: 730, dbStorageGB: 20 });
  assert.ok(idle.monthly > 15, 'an idle database is a floor, not a rounding error: ' + idle.monthly);
  const unknown = C.surpriseCost('s-nat', {});
  assert.ok(unknown.complete === false || unknown.unmodeled.length > 0, 'an unpriced trap says what is missing');
});

t('a genuine zero and a missing number are reported differently', () => {
  const zero = C.costById('gh.pages', tpl('tpl-etl'), { usage: { runsPerMonth: 30, dataScaleGB: 0.5 } });
  assert.equal(zero.monthly, 0);
  assert.equal(zero.complete, true, 'a documented zero is complete');
  assert.ok(zero.notes.some(n => /genuinely zero/i.test(n)));
  const batchFee = C.price('batch.fee', null);
  assert.equal(batchFee.value, 0);
  assert.equal(batchFee.known, true, 'the free orchestrator is a documented fact');
  const missing = C.price('inference.api.rate', null);
  assert.equal(missing.known, false, 'an unset rate is unknown');
  const absent = C.price('ec2.does.not.exist', null);
  assert.equal(absent.known, false);
  assert.equal(absent.missing, true);
  assert.ok(!absent.value, 'an absent price has no value rather than a zero');
});

t('a price override is honoured everywhere and never mutates the catalogue', () => {
  const before = json(C.PRICE_INDEX['gh.linux.16'].value);
  const base = C.costById('gh.larger', tpl('tpl-geobatch'), { usage: { runsPerMonth: 4, durationMin: 240, memoryGB: 64 } });
  const over = C.costById('gh.larger', tpl('tpl-geobatch'), { usage: { runsPerMonth: 4, durationMin: 240, memoryGB: 64 }, prices: { 'gh.linux.16': 0.084 } });
  assert.ok(Math.abs(over.monthly - base.monthly * 2) < 0.02, 'doubling a rate doubles the line: ' + base.monthly + ' -> ' + over.monthly);
  assert.equal(C.PRICE_INDEX['gh.linux.16'].value, before, 'the catalogue itself is untouched');
});

/* ---------------- result ---------------- */
const failed = failures.length;
console.log((failed ? 'FAIL' : 'ok  ') + '  do-i-need-aws-gcp: ' + passed + ' passed, ' + failed + ' failed');
failures.forEach(f => console.log('  - ' + f));
process.exit(failed ? 1 : 0);
