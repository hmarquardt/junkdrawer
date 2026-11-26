// Dani the Pimple Popper 1.4 — The World Book of Pores verification suite.
// Run from the repository root: node tests/dani-world-book.cjs
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const server = http.createServer(async (req, res) => {
  const file = new URL(req.url, 'http://localhost').pathname.replace(/^\/junkdrawer\//, '');
  if (!/^(danny\/[\w./-]+|andi-the-rat-slayer\/three.min.js|danny-sw.js|dani-the-pimple-popper.html|danny-the-pimple-popper.html|analytics-lite.js)$/.test(file)) { res.writeHead(404).end(); return; }
  try {
    const mime = {js:'text/javascript',json:'application/json',html:'text/html',css:'text/css',webmanifest:'application/manifest+json',png:'image/png',jpg:'image/jpeg',ttf:'font/ttf'};
    res.setHeader('Content-Type', mime[file.split('.').pop()] || 'application/octet-stream');
    res.end(await fs.readFile(path.join(root, file)));
  } catch { res.writeHead(404).end(); }
});
async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/junkdrawer/';
  const url = base + 'dani-the-pimple-popper.html';
  const browser = await chromium.launch({channel: 'chrome', args: ['--enable-unsafe-swiftshader']});
  const errors = [], bookRequests = [];
  try {
    const context = await browser.newContext({viewport: {width: 1180, height: 900}});
    await context.route('**/api/analytics/**', route => route.fulfill({status: 204}));
    await context.route('**/world-book/**', route => { bookRequests.push(route.request().url()); return route.continue(); });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const boot = async (target = page) => {
      await target.waitForFunction(() => document.querySelector('#feedStatus').textContent === 'Optics online');
      await target.waitForFunction(() => !!window.daniInspect);
    };
    const settle = async (target = page) => target.waitForFunction(() => document.querySelector('#feedStatus').dataset.save !== 'pending');
    const snapshot = async (target = page) => {
      await settle(target);
      return target.evaluate(async () => (await (await (await import('./danny/storage.js')).openCampaign()).read()).state);
    };
    const clock = async (target = page) => {
      await target.clock.install({time: new Date('2030-07-01T00:00:00Z')});
      await target.clock.pauseAt(new Date('2030-07-01T00:00:01Z'));
    };
    let dismiss = async () => '';
    dismiss = async (target = page) => {
      if (!(await target.locator('#dialog[open]').count())) return '';
      const title = await target.locator('#dialogTitle').textContent();
      const got = target.getByRole('button', {name: 'Got it'});
      if (await got.count()) await got.click();
      return title;
    };
    const releaseInBand = async (target = page) => {
      await target.locator('#extract').focus();
      await target.keyboard.down('Space');
      for (let i = 0; i < 200; i++) {
        await target.clock.fastForward(24);
        if (await target.evaluate(() => document.getElementById('meter').classList.contains('inside'))) break;
      }
      await target.keyboard.up('Space');
      await settle(target);
    };
    const equipAny = async (names, target = page) => {
      for (const name of names) {
        const tool = target.locator('.tool').filter({has: target.locator('.tool-name', {hasText: name})});
        if (await tool.isEnabled()) { await tool.click(); await settle(target); await dismiss(target); return name; }
      }
      throw Error('No usable instrument among ' + names.join(', '));
    };
    const scanAll = async (target = page) => {
      await equipAny(['PoreScope', 'The Silver Loop'], target).catch(() => {});
      await target.locator('[data-view="scan"]').click();
      await target.locator('#scanBtn').focus();
      await target.keyboard.down('Space');
      const box = await target.locator('#stage').boundingBox();
      for (let r = 0; r < 6; r++) for (let c = 0; c < 8; c++) {
        await target.mouse.move(box.x + box.width * (.2 + c / 7 * .6), box.y + box.height * (.25 + r / 5 * .55));
        await target.clock.fastForward(170);
      }
      await target.keyboard.up('Space');
      await settle(target);
      await target.locator('[data-view="surface"]').click();
    };
    const activeId = async (target = page) => Number(await target.locator('.marker.current').getAttribute('data-target'));
    const fieldInfo = async (id, target = page) => target.evaluate(id => daniInspect.field().find(item => item.id === id), id);
    const clearTarget = async (target = page) => {
      const id = await activeId(target);
      for (let guard = 0; guard < 40; guard++) {
        const info = await fieldInfo(id, target);
        if (info.cleared) return info;
        const scope = await target.evaluate(() => daniInspect.scope());
        if (scope && info.found < info.nodes) await scanAll(target);
        const gates = await target.evaluate(() => daniInspect.scope()?.gates.filter(gate => !gate.broken) || []);
        const types = {core: ['Arcane Resonator', 'Cryo Wand'], valve: ['Arcane Resonator'], plug: ['The Silver Loop', 'Arcane Resonator'],
          septum: ['Arcane Resonator'], migrate: ['Arcane Resonator']};
        await equipAny(gates.length ? (types[gates[0].type] || ['The Silver Loop']) : ['Spectral Extractor', 'Arcane Resonator', 'The Silver Loop'], target);
        const before = await fieldInfo(id, target);
        await releaseInBand(target);
        let after = await fieldInfo(id, target);
        for (const name of ['The Silver Loop', 'Arcane Resonator', 'Spectral Extractor', 'Cryo Wand']) {
          if (after.passes !== before.passes || after.cleared) break;
          const tool = target.locator('.tool').filter({has: target.locator('.tool-name', {hasText: name})});
          if (!(await tool.isEnabled())) continue;
          await tool.click(); await settle(target); await dismiss(target);
          await releaseInBand(target);
          after = await fieldInfo(id, target);
        }
      }
      throw Error('Target did not clear: ' + JSON.stringify(await target.evaluate(() => daniInspect.field())));
    };
    const clearCase = async (target = page) => {
      for (let guard = 0; guard < 8; guard++) {
        if (await target.locator('#review:visible').count()) return;
        await clearTarget(target);
      }
      throw Error('Case did not clear');
    };
    const openHub = async (target = page) => {
      await target.locator('#bookBtn').click();
      await target.locator('.book-tabs').waitFor();
    };
    const tab = async (name, target = page) => { await target.locator('[data-tab="' + name + '"]').click(); await target.locator('.book-section').waitFor(); };

    // ---------------------------------------------------------------------------------------
    // A. Baseline, lazy loading and the unified contract.
    await page.goto(url);
    await boot(page);
    assert.equal(await page.locator('#stage').getAttribute('data-renderer'), 'webgl2');
    assert.equal(bookRequests.length, 0, 'the World Book must not load during base startup');
    await page.locator('#soundBtn').click(); await page.locator('#soundBtn').click();
    const baseBefore = await snapshot(page);
    await clock(page);
    await page.route('**/bad-world.json', route => route.fulfill({json: {namespace: 'bad', version: '1.0.0', engineMajor: 1,
      records: [{id: 'bad:thing', name: 'Thing'}]}}));
    const contract = await page.evaluate(async () => {
      const {createRegistry} = await import('./danny/content.js');
      const reg = createRegistry();
      await reg.load('./base.json');
      await reg.load('./pore-explorer/pack.json');
      await reg.load('./midnight-clinic/pack.json');
      const namespace = await reg.load('./world-book/pack.json');
      let bad = false;
      try { await reg.load('./bad-world.json'); } catch { bad = true; }
      return {namespace, bad, records: reg.list('records').length, trophies: reg.list('trophies').length,
        challenges: reg.list('challenges').length, encounters: reg.list('encounters').length,
        reservoirs: reg.list('reservoirs').length, modes: reg.list('modes').length};
    });
    assert.equal(contract.namespace, 'world-book-of-pores');
    assert.equal(contract.bad, true, 'an invalid record definition must be rejected');
    assert.ok(contract.records >= 28, 'twenty unified classifications plus the eight supernatural ones');
    assert.equal(contract.trophies, 16);
    assert.equal(contract.challenges, 9);
    // Registry counts include every installed pack: base + Pore Explorer + Midnight Clinic + book.
    assert.equal(contract.reservoirs, 33, 'legendary templates plus the installed packs');
    assert.equal(contract.encounters, 45, 'seventeen installed plus eight legendary plus base');

    // ---------------------------------------------------------------------------------------
    // B. Telemetry accuracy, ordering, bounds and metric definitions (module level).
    const telemetry = await page.evaluate(async () => {
      const {createTelemetry, METRICS, METRIC_RULES, quantize} = await import('./danny/telemetry.js');
      const t = createTelemetry();
      t.start({encounter: 'x:y', seed: 7, now: 1000});
      const input = {type: 'release', volume: 1.234, streams: 2, materials: ['a', 'b'], cohesive: 0.8,
        secondary: 1, echo: 1, regenerated: 1, phased: 1, discovered: 5, chambers: 9, perfect: 1,
        equipment: 'e:1', extrusion: 0.42, target: 0};
      const frozen = JSON.stringify(input);
      t.event(input);
      t.event({type: 'release', volume: 0.5, streams: 1, materials: ['a'], target: 1, perfect: 0});
      t.event({type: 'gate-cleared', core: 220});
      for (let i = 0; i < 80; i++) t.event({type: 'noise'});
      const snapshot = t.finish({points: 250, streak: 3, now: 5000});
      return {frozen: JSON.stringify(input) === frozen, rules: METRIC_RULES, metrics: Object.keys(METRICS).length,
        values: snapshot.values, events: snapshot.events.length, releases: snapshot.releases,
        total: snapshot.totalVolume, duration: snapshot.durationMs, regenerated: snapshot.regenerated,
        core: snapshot.coreSize, quantize: quantize(1.005), schema: snapshot.schema};
    });
    assert.equal(telemetry.frozen, true, 'observers must not mutate the simulation payload');
    assert.equal(telemetry.schema, 1);
    assert.ok(telemetry.rules >= 1);
    assert.deepEqual([telemetry.values.singleExtraction, telemetry.values.encounterTotal, telemetry.values.streams, telemetry.values.materials], [123, 173, 2, 2]);
    assert.deepEqual([telemetry.releases, telemetry.total, telemetry.duration], [2, 173, 4000]);
    assert.deepEqual([telemetry.values.precision, telemetry.values.secondary, telemetry.values.discovered], [500, 2, 5]);
    assert.equal(telemetry.events <= 60, true, 'event buffer stays bounded');
    assert.deepEqual([telemetry.regenerated, telemetry.core], [1, 220]);

    // ---------------------------------------------------------------------------------------
    // C. Record evaluation, tiers, idempotency and the Midnight Clinic migration.
    const records = await page.evaluate(async () => {
      const {normalizeWorld, evaluate, commit, tierFor, defaultWorld, ALL_METRICS} = await import('./danny/records.js');
      const defs = [
        {id: 'wb:a', name: 'A', metric: 'singleExtraction', classification: 'core', tiers: {bronze: 100, silver: 200, gold: 300, platinum: 400, legendary: 600}},
        {id: 'wb:b', name: 'B', metric: 'streams', classification: 'core', tiers: {bronze: 2, silver: 3, gold: 4, platinum: 5, legendary: 6}},
        {id: 'wb:legacy', name: 'Legacy', metric: 'alienExtraction', classification: 'supernatural', tiers: {bronze: 100, silver: 200, gold: 300, platinum: 400, legendary: 500}}
      ];
      const profile = {stats: {alienBest: 321, regenBest: 2, phaseReleases: 4, moonBest: 700, multiStream: 3, crystalBest: 180, witchingHour: 5, unholyExtrusion: 900}};
      const world = normalizeWorld(null, profile);
      const legacy = {alien: world.best.alienExtraction, meta: world.meta.alienExtraction, migrated: world.migrated};
      const again = normalizeWorld(world, profile);
      const idempotent = JSON.stringify(again) === JSON.stringify(world);
      const snapshot = {values: {singleExtraction: 410, streams: 3, materials: 2, alienExtraction: 410, encounterTotal: 500}};
      const first = evaluate(snapshot, defs, world);
      const fresh = commit(world, first, {at: 1000, namespace: 'base', encounter: 'base:x', klass: 'base', seed: 5});
      const historyAfterFirst = world.history.length;
      const repeat = commit(world, evaluate(snapshot, defs, world), {at: 1001});
      return {legacy, idempotent, tiers: first.map(item => item.tier), fresh: fresh.length,
        historyAfterFirst, historyAfterRepeat: world.history.length, repeat: repeat.length,
        best: world.best.singleExtraction, prev: world.prev.singleExtraction, metaAt: world.meta.singleExtraction.at,
        tierFor: tierFor(defs[0], 605), hasAll: !!ALL_METRICS.alienExtraction};
    });
    assert.deepEqual(records.legacy, {alien: 321, meta: {legacy: true, at: null, tier: 'legacy'}, migrated: 1});
    assert.equal(records.idempotent, true, 'migration is idempotent');
    assert.deepEqual(records.tiers, ['platinum', 'silver', 'platinum']);
    assert.equal(records.fresh, 3, 'three improvements committed');
    assert.deepEqual([records.historyAfterFirst, records.historyAfterRepeat, records.repeat], [3, 3, 0], 'replays cannot duplicate history');
    assert.deepEqual([records.best, records.prev, records.metaAt], [410, 0, 1000]);
    assert.equal(records.tierFor, 'legendary');
    assert.equal(records.hasAll, true);

    // ---------------------------------------------------------------------------------------
    // D. Deterministic daily and weekly generation, sharing validation and result import.
    const deterministic = await page.evaluate(async () => {
      const {content} = await import('./danny/content.js');
      await content.load('./pore-explorer/pack.json');
      await content.load('./midnight-clinic/pack.json');
      await content.load('./world-book/pack.json');
      const {challengeFor, weeklyChallenges, weekKey, encodeChallenge, decodeChallenge} = await import('./danny/world-book/expansion.js');
      const a = challengeFor('2030-07-01'), b = challengeFor('2030-07-01'), c = challengeFor('2030-07-02');
      const weeks = weeklyChallenges('2030-W27');
      const round = decodeChallenge(encodeChallenge(a));
      const bad = [];
      for (const code of ['', 'nope', 'WBP1.%%%', 'WBP1.' + btoa(JSON.stringify({v: 9})), 'WBP1.' + btoa(JSON.stringify({v: 1, rules: 1, enc: 'x:none', seed: 1})),
        'WBP1.' + btoa(JSON.stringify({v: 1, rules: 1, enc: 'base:review', seed: 1, mod: {hack: 1}})),
        'WBP1.' + btoa(JSON.stringify({v: 1, rules: 1, enc: 'base:review', seed: 1, mod: {restrict: 'https://evil.example/x'}})), 'x'.repeat(900)]) {
        try { decodeChallenge(code); } catch { bad.push(true); }
      }
      return {same: JSON.stringify(a) === JSON.stringify(b), differs: JSON.stringify(a) !== JSON.stringify(c),
        seed: Number.isInteger(a.seed) && a.seed >= 0, weekSeed: weeks.map(item => item.seed), weekKey: weekKey(new Date('2030-07-01T00:00:00Z')),
        round: round.encounter === a.encounter && round.seed === a.seed, rejected: bad.length, rules: a.rules};
    });
    assert.equal(deterministic.same, true, 'the same UTC date yields the same challenge');
    assert.equal(deterministic.differs, true, 'a different date yields a different challenge');
    assert.equal(deterministic.seed, true);
    assert.equal(new Set(deterministic.weekSeed).size, 3, 'three distinct weekly challenges');
    assert.equal(deterministic.weekKey, '2030-W27');
    assert.equal(deterministic.round, true, 'challenge codes reproduce the same encounter and seed');
    assert.equal(deterministic.rejected, 8, 'invalid codes are rejected (schema, ids, modifiers, size)');


    // ---------------------------------------------------------------------------------------
    // E. The hub: lazy load, record book, filters, trophies and a locally generated certificate.
    await openHub();
    assert.equal(await page.locator('#dialogTitle').textContent(), 'The World Book of Pores');
    assert.equal(await page.locator('.book-tabs button').count(), 8);
    assert.equal(await page.locator('.book-row').count(), 20, 'twenty classifications in the book');
    assert.ok(bookRequests.some(request => request.includes('world-book/pack.json')), 'the pack loads on demand');
    const imported = await page.evaluate(async () => {
      const {encodeResult, importResult} = await import('./danny/world-book/expansion.js');
      const item = importResult(encodeResult({encounter: 'base:review', seed: 5}, 321, {releases: 4}, 'Rival'));
      return {score: item.score, nick: item.nick, verified: item.verified};
    });
    assert.deepEqual(imported, {score: 321, nick: 'Rival', verified: 0}, 'imported results are labelled self-reported');
    await tab('trophies');
    assert.equal(await page.locator('.trophy').count(), 16);
    assert.equal(await page.locator('.trophy.owned').count(), 0, 'no trophies before play');
    await tab('daily');
    assert.match(await page.locator('.book-section').innerText(), /Seed \d+/);
    await tab('weekly');
    assert.equal(await page.locator('[data-weekly]').count(), 3);
    await tab('gauntlets');
    assert.equal(await page.locator('[data-gauntlet]').count(), 6);
    await tab('share');
    assert.equal(await page.locator('#bookCode').count(), 1);
    await page.locator('#dismiss').click();

    // ---------------------------------------------------------------------------------------
    // F. Legendary encounter: one complete case feeds telemetry, records, achievements,
    // highlights and a locally rendered certificate.
    await openHub();
    await tab('legendary');
    await page.getByRole('button', {name: /Start legendary run|Continue legendary run/}).click();
    await dismiss();
    await page.locator('#scopePanel').waitFor({state: 'visible'});
    assert.equal((await page.evaluate(() => daniInspect.session())).mode, 'world-book-of-pores:legendary');
    const legendaryEncounter = (await page.evaluate(() => daniInspect.session())).encounter;
    assert.match(legendaryEncounter, /^world-book-of-pores:/);
    await clearCase(page);
    await settle(page);
    const afterLegendary = await page.evaluate(() => daniInspect.world());
    assert.ok(afterLegendary.stats.recordsSet >= 1, 'a legendary case sets at least one record');
    assert.ok(afterLegendary.world.history.length >= 1, 'record history is written');
    assert.ok(afterLegendary.world.highlight, 'a bounded highlight is captured');
    assert.equal(afterLegendary.stats.legendaryDone, 1);
    assert.ok(afterLegendary.world.legendary.includes(legendaryEncounter));
    assert.ok(afterLegendary.achievements.includes('world-book-of-pores:ach-for-the-record'));
    const best = afterLegendary.records.filter(item => item.value > 0).sort((a, b) => b.value - a.value)[0];
    assert.ok(best, 'records carry measured values');
    const certificate = await page.evaluate(async metric => {
      const {certificateCanvas} = await import('./danny/world-book/expansion.js');
      const canvas = certificateCanvas(metric);
      return canvas ? {width: canvas.width, size: canvas.toDataURL('image/png').length} : null;
    }, best.metric);
    assert.ok(certificate && certificate.width === 1000 && certificate.size > 5000, 'certificate renders locally');
    const metaDate = afterLegendary.world.meta[best.metric]?.at;
    assert.ok(metaDate > 0, 'record metadata carries a date');

    // ---------------------------------------------------------------------------------------
    // G. Daily challenges and gauntlets: deterministic starts, independent state, restrictions.
    await openHub();
    await tab('daily');
    await page.getByRole('button', {name: /Run today\u2019s disaster|Replay today\u2019s disaster/}).click();
    await dismiss();
    await page.locator('#scopePanel').waitFor({state: 'visible'});
    const dailyPending = await page.evaluate(() => daniInspect.world().pending);
    assert.equal(dailyPending.kind, 'daily');
    assert.equal(dailyPending.metric, (await page.evaluate(() => daniInspect.world().daily)).metric);
    await releaseInBand(page);
    const dailySession = await page.evaluate(() => ({session: daniInspect.scope() !== null, pending: daniInspect.world().pending}));
    assert.equal(dailySession.session, true);
    await settle(page);
    await page.reload(); await boot(page);
    assert.equal((await page.evaluate(() => daniInspect.world().pending))?.kind, 'daily', 'challenge checkpoints resume');
    await page.locator('#modeBtn').click();
    await page.locator('.mode-option').filter({has: page.locator('strong', {hasText: 'Campaign'})}).first().click();
    await page.waitForFunction(() => daniInspect.session().mode === 'base:campaign');
    await openHub();
    await tab('gauntlets');
    const instrument = page.locator('[data-gauntlet="world-book-of-pores:gauntlet-instrument"]');
    await instrument.click();
    await dismiss();
    await page.locator('#scopePanel').waitFor({state: 'visible'});
    const restricted = await page.evaluate(() => daniInspect.world().pending);
    assert.equal(restricted.kind, 'gauntlet');
    assert.equal(restricted.modifier.restrict, 'pore-explorer:vortex');
    const vortex = page.locator('.tool').filter({has: page.locator('.tool-name', {hasText: 'Vortex Extractor'})});
    assert.equal(await vortex.isEnabled(), false, 'a gauntlet restriction disables that instrument');
    await clearCase(page);
    await settle(page);
    const afterStage = await page.evaluate(() => daniInspect.world());
    assert.equal(afterStage.pending.step, 1, 'the gauntlet advances one stage at a time');
    assert.equal(afterStage.stats.gauntletsDone || 0, 0, 'the gauntlet is not complete after one stage');
    await openHub();
    await tab('gauntlets');
    await page.locator('[data-gauntlet="world-book-of-pores:gauntlet-instrument"]').click();
    await dismiss();
    await page.locator('#scopePanel').waitFor({state: 'visible'});
    assert.equal((await page.evaluate(() => daniInspect.world().pending)).step, 1, 'resume continues at the stored stage');

    // ---------------------------------------------------------------------------------------
    // H. Persistence, migration of older saves, offline access and mobile/Canvas rendering.
    await page.locator('#modeBtn').click();
    await page.locator('.mode-option').filter({has: page.locator('strong', {hasText: 'Campaign'})}).first().click();
    await page.waitForFunction(() => daniInspect.session().mode === 'base:campaign');
    const baseAfter = await snapshot(page);
    assert.deepEqual(baseAfter.slots['base:campaign'], baseBefore.slots['base:campaign'], 'base checkpoint preserved');
    assert.equal(baseAfter.world.best?.singleExtraction >= 0, true, 'unified records persist in the profile');
    assert.ok(baseAfter.world.history.length >= 1);
    assert.equal(baseAfter.stats.chapters, 0, 'base chapter counter untouched');
    await page.locator('#soundBtn').click(); await page.locator('#soundBtn').click(); await settle(page);
    await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('danny-popper');
      request.onsuccess = () => { const tx = request.result.transaction('campaign', 'readwrite');
        tx.objectStore('campaign').put({revision: 99999, broken: true}, 'current'); tx.oncomplete = resolve; tx.onerror = reject; };
    }));
    await page.reload(); await boot(page);
    assert.match(await page.locator('#saveStatus').textContent(), /Recovered/);
    const recoveredSave = await snapshot(page);
    assert.ok(recoveredSave.world.history.length >= 1, 'records survive checkpoint recovery');
    await openHub();
    const recovered = await page.evaluate(() => daniInspect.world());
    assert.ok(recovered.world.history.length >= 1, 'the recovered book is readable');
    await page.locator('#dismiss').click();
    // A 1.0-shaped save normalises to a valid world and still opens the hub.
    await page.evaluate(() => new Promise((resolve, reject) => {
      const state = {schema: 2, revision: 71, packs: {base: '1.0.0'}, mode: 'base:campaign', tool: 'base:loop',
        slots: {'base:campaign': {encounter: 'base:forecast', seed: 20530, turn: 2, cleared: [0], layers: {}, streak: 1, points: 100}},
        xp: 400, score: 300, achievements: ['base:first-pop'],
        stats: {total: 3, perfects: 1, bestStreak: 2, bosses: 0, chapters: 0, endlessFields: 0, zenFields: 0},
        settings: {sound: true, volume: .65, haptics: false, assist: false, toggle: false, contrast: false, reducedMotion: false}};
      const request = indexedDB.open('danny-popper');
      request.onsuccess = () => { const tx = request.result.transaction('campaign', 'readwrite');
        tx.objectStore('campaign').put(state, 'current'); tx.oncomplete = resolve; tx.onerror = reject; };
    }));
    await page.reload(); await boot(page);
    await openHub();
    const migrated = await page.evaluate(() => daniInspect.world());
    assert.equal(migrated.world.v, 1);
    assert.equal(migrated.world.migrated, 1);
    await page.locator('#dismiss').click();
    // Offline: the pack and module are cached after first access and the hub reopens offline.
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {timeout: 20000}).catch(() => {});
    await page.reload(); await boot(page);
    await openHub(); await page.locator('#dismiss').click();
    const cacheAudit = await page.evaluate(async () => {
      const names = await caches.keys();
      const cache = names.find(name => name.startsWith('junkdrawer-danny-expansion-'));
      const files = cache ? (await (await caches.open(cache)).keys()).map(request => new URL(request.url).pathname) : [];
      return files.filter(file => file.includes('world-book')).length;
    });
    assert.ok(cacheAudit >= 1, 'the World Book module is cached');
    await context.setOffline(true);
    await page.reload(); await boot(page);
    await openHub();
    assert.equal(await page.locator('.book-tabs button').count(), 8, 'the hub works offline');
    await page.locator('#dismiss').click();
    await context.setOffline(false);
    // Mobile and the Canvas fallback.
    const mobileContext = await browser.newContext({viewport: {width: 360, height: 640}, isMobile: true, hasTouch: true});
    await mobileContext.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type === 'webgl2' ? null : original.call(this, type, ...args); };
    });
    const mobile = await mobileContext.newPage();
    mobile.on('pageerror', e => errors.push(e.message));
    await mobile.goto(url); await boot(mobile);
    assert.equal(await mobile.locator('#stage').getAttribute('data-renderer'), 'canvas2d');
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await openHub(mobile);
    assert.equal(await mobile.locator('.book-tabs button').count(), 8);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'hub fits 360px');
    await mobile.locator('#dismiss').click();
    await mobileContext.close();

    // ---------------------------------------------------------------------------------------
    // I. Frame budget with telemetry running versus base idle.
    const measure = async target => target.evaluate(() => new Promise(resolve => {
      const samples = []; let last = performance.now(), frames = 0;
      const tick = stamp => { samples.push(stamp - last); last = stamp;
        if (++frames < 100) requestAnimationFrame(tick);
        else { const values = samples.slice(12).sort((a, b) => a - b); resolve({median: values[Math.floor(values.length / 2)], p95: values[Math.floor(values.length * .95)]}); } };
      requestAnimationFrame(tick);
    }));
    const perfContext = await browser.newContext({viewport: {width: 1180, height: 880}, deviceScaleFactor: 3});
    await perfContext.route('**/api/analytics/**', route => route.fulfill({status: 204}));
    const perf = await perfContext.newPage();
    perf.on('pageerror', e => errors.push(e.message));
    await perf.goto(url); await boot(perf);
    const idle = await measure(perf);
    await perf.locator('#bookBtn').click();
    await perf.locator('[data-tab="legendary"]').click();
    await perf.getByRole('button', {name: /Start legendary run|Continue legendary run/}).click();
    await dismiss(perf);
    await perf.locator('[data-view="scan"]').click();
    await perf.locator('#scanBtn').focus();
    await perf.keyboard.down('Space');
    const scanning = await measure(perf);
    await perf.keyboard.up('Space');
    assert.ok(scanning.p95 < Math.max(150, idle.p95 * 5), 'telemetry and imaging keep a bounded frame budget');
    await perfContext.close();

    assert.deepEqual(errors, [], 'no console or page errors');
    console.log('Passed unified telemetry, metric definitions, record evaluation and tiers, Midnight Clinic migration and idempotency, daily and weekly determinism, challenge codes and result import, record book and trophy hub, legendary encounter records, certificates, daily checkpoints, gauntlet restrictions and staging, save recovery, 1.0 save migration, offline hub, mobile layout, WebGL2 and Canvas.');
    console.log('Frame timing (software renderer, DPR 3): base idle median ' + idle.median.toFixed(1) + ' ms / p95 ' + idle.p95.toFixed(1) + ' ms · legendary scan median ' + scanning.median.toFixed(1) + ' ms / p95 ' + scanning.p95.toFixed(1) + ' ms.');
  } finally { await browser.close(); server.close(); }
}
run().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
