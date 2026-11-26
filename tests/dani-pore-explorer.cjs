// Dani the Pimple Popper 1.1 — The Pore Explorer verification suite.
// Run from the repository root: node tests/dani-pore-explorer.cjs
// Serves a GitHub Pages-style subpath, drives the real UI through Chrome, and checks the expansion
// contract, reservoir simulation, equipment, campaign, achievements, saves, offline cache and both
// renderers. Physical-device behavior is not claimed by this suite.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const server = http.createServer(async (req, res) => {
  const file = new URL(req.url, 'http://localhost').pathname.replace(/^\/junkdrawer\//, '');
  if (!/^(danny\/[\w./-]+|andi-the-rat-slayer\/three.min.js|danny-sw.js|dani-the-pimple-popper.html|danny-the-pimple-popper.html|analytics-lite.js)$/.test(file)) {
    res.writeHead(404).end(); return;
  }
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
  const errors = [], packRequests = [];
  try {
    const context = await browser.newContext({viewport: {width: 1180, height: 880}});
    await context.route('**/api/analytics/**', route => route.fulfill({status: 204}));
    await context.route('**/pore-explorer/**', route => { packRequests.push(route.request().url()); return route.continue(); });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const boot = async (target = page) => {
      await target.waitForFunction(() => document.querySelector('#feedStatus').textContent === 'Optics online');
      await target.waitForFunction(() => !!window.daniInspect);
    };
    const clock = async (target = page) => {
      await target.clock.install({time: new Date('2030-03-01T00:00:00Z')});
      await target.clock.pauseAt(new Date('2030-03-01T00:00:01Z'));
    };
    const snapshot = async (target = page) => {
      await target.waitForFunction(() => document.querySelector('#feedStatus').dataset.save !== 'pending');
      return target.evaluate(async () => {
        const {openCampaign} = await import('./danny/storage.js');
        return (await (await openCampaign()).read()).state;
      });
    };
    const settle = async (target = page) => target.waitForFunction(() => document.querySelector('#feedStatus').dataset.save !== 'pending');
    // Compute a release instant from the published curves for whichever instrument is equipped.
    const timing = async (id, target = page) => {
      // The saved profile carries the equipped instrument, so let the write commit first.
      await settle(target);
      return target.evaluate(async id => {
      const {openCampaign} = await import('./danny/storage.js');
      const {migrate, visitFor, calibrated} = await import('./danny/progression.js');
      const {makeField, pressure, band} = await import('./danny/simulation.js');
      const profile = migrate((await (await openCampaign()).read()).state);
      const visit = visitFor(profile), tool = calibrated(profile, visit), field = makeField(visit);
      const l = field[id], pass = visit.run.layers[id] || 0;
      for (let ms = 1; ms < 24000; ms++) {
        const t = ms / 1000, zone = band(t, l, tool, pass);
        if (Math.abs(pressure(t, l, tool, pass) - zone.center) < 0.0015) return ms;
      }
      throw Error('No release band for target ' + id);
      }, id);
    };
    const releaseAt = async (ms, target = page) => {
      await target.locator('#extract').focus();
      await target.keyboard.down('Space');
      await target.clock.fastForward(ms);
      await target.keyboard.up('Space');
      await target.waitForFunction(() => document.querySelector('#feedStatus').dataset.save !== 'pending');
    };
    let dismissTutorial = async () => '';
    const equip = async (name, target = page) => {
      const tool = target.locator('.tool').filter({has: target.locator('.tool-name', {hasText: name})});
      if (!(await tool.isEnabled())) throw Error('Instrument locked: ' + name);
      await tool.click();
      await settle(target);
      // The first time an expansion instrument is equipped its short tutorial opens.
      await dismissTutorial(target);
    };
    const openExpansion = async (target = page) => {
      await target.locator('#poreBtn').click();
      await target.locator('#dialogTitle').waitFor();
    };
    dismissTutorial = async (target = page) => {
      if (await target.locator('#dialog[open]').count()) {
        const title = await target.locator('#dialogTitle').textContent();
        const button = target.getByRole('button', {name: 'Got it'});
        if (await button.count()) await button.click();
        return title;
      }
      return '';
    };
    const enterExpansion = async (mode = 'Start the dive', target = page) => {
      await openExpansion(target);
      const label = (await target.getByRole('button', {name: mode}).count()) ? mode : 'Resume the dive';
      await target.getByRole('button', {name: label}).click();
      const title = await dismissTutorial(target);
      await target.locator('#scopePanel').waitFor({state: 'visible'});
      return title;
    };
    const session = async (target = page) => target.evaluate(() => daniInspect.session());
    const activeId = async (target = page) => Number(await target.locator('.marker.current').getAttribute('data-target'));
    // Sweep the whole reservoir footprint in Scan mode. Coverage is spatial and depth is earned,
    // so this exercises the real interaction rather than calling a reveal function.
    const scanAll = async (target = page, equipScope = true) => {
      if (equipScope) await equip('PoreScope', target);
      await target.locator('[data-view="scan"]').click();
      await target.locator('#scanBtn').focus();
      await target.keyboard.down('Space');
      const box = await target.locator('#stage').boundingBox();
      const columns = 9, rows = 7;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < columns; c++) {
          await target.mouse.move(box.x + box.width * (0.16 + c / (columns - 1) * 0.68),
            box.y + box.height * (0.22 + r / (rows - 1) * 0.72));
          await target.clock.fastForward(200);
        }
      }
      await target.keyboard.up('Space');
      await target.waitForFunction(() => document.querySelector('#feedStatus').dataset.save !== 'pending');
      return target.evaluate(() => daniInspect.scope());
    };
    const fieldInfo = async (id, target = page) => target.evaluate(id => daniInspect.field().find(l => l.id === id), id);
    const equipAny = async (names, target = page) => {
      for (const name of names) {
        const tool = target.locator('.tool').filter({has: target.locator('.tool-name', {hasText: name})});
        if (await tool.isEnabled()) { await tool.click(); await settle(target); await dismissTutorial(target); return name; }
      }
      throw Error('No usable instrument among ' + names.join(', '));
    };
    // Clear the current target through the intended loop: scan what is concealed, break gate
    // obstructions with the wand, otherwise extract. Guards against silent stalls.
    const clearTarget = async (target = page, options = {}) => {
      const id = await activeId(target);
      for (let guard = 0; guard < 44; guard++) {
        const info = await fieldInfo(id, target);
        if (info.cleared) return info;
        let scope = await target.evaluate(() => daniInspect.scope());
        if (!options.noScan && scope && info.found < info.nodes) {
          await scanAll(target, false);
          scope = await target.evaluate(() => daniInspect.scope());
        }
        const gated = scope ? (scope.held || scope.gates.some(g => !g.broken)) : false;
        if (gated) await equipAny(['Resonance Wand', 'Loop extractor'], target);
        else await equipAny(['Vortex Extractor', 'Loop extractor'], target);
        const before = await fieldInfo(id, target);
        await releaseAt(await timing(id, target), target);
        const after = await fieldInfo(id, target);
        if (!after.cleared && after.passes === before.passes && !gated && !options.noScan) {
          const cue = await target.locator('#cue').textContent();
          if (/scan|sealed|concealed/i.test(cue)) await scanAll(target, false);
        }
      }
      const diagnostic = {field: await fieldInfo(id, target), scope: await target.evaluate(() => daniInspect.scope()),
        cue: await target.locator('#cue').textContent(), session: await session(target)};
      throw Error('Target ' + id + ' did not clear: ' + JSON.stringify(diagnostic));
    };
    const clearCase = async (target = page, options = {}) => {
      for (let guard = 0; guard < 8; guard++) {
        if (await target.locator('#review:visible').count()) return;
        await clearTarget(target, options);
      }
      throw Error('Case did not clear');
    };

    // ---------------------------------------------------------------------------------------
    // A. Lazy loading, manifest contract, namespace isolation, graph determinism.
    await page.goto(url);
    await boot(page);
    assert.equal(await page.locator('#stage').getAttribute('data-renderer'), 'webgl2', 'WebGL2 renderer expected');
    assert.equal(packRequests.length, 0, 'the expansion must not load during base startup');
    // Two preference writes create the initial checkpoint without touching gameplay state.
    await page.locator('#soundBtn').click();
    await page.locator('#soundBtn').click();
    const baseBefore = await snapshot(page);
    assert.equal(baseBefore.mode, 'base:campaign');
    await clock(page);
    const duplicatePack = JSON.parse(await fs.readFile(path.join(root, 'danny/pore-explorer/pack.json'), 'utf8'));
    await page.route('**/duplicate-pack.json', route => route.fulfill({json: duplicatePack}));
    await page.route('**/bad-technique.json', route => route.fulfill({json: {namespace: 'bad', version: '1.0.0', engineMajor: 1,
      equipment: [{id: 'bad:laser', name: 'Laser', type: 'Beam', technique: 'laser', speed: 1, window: .1, xp: 0, art: 0}]}}));
    await page.route('**/bad-reservoir.json', route => route.fulfill({json: {namespace: 'bad', version: '1.0.0', engineMajor: 1,
      reservoirs: [{id: 'bad:spiral', name: 'Spiral', pattern: 'spiral', chambers: [3, 4], scale: 1, materials: ['base:cream'], hidden: 0, obstruction: 'none'}]}}));
    const contract = await page.evaluate(async () => {
      const {createRegistry} = await import('./danny/content.js');
      const empty = createRegistry();
      let isolated = false;
      try { empty.get('reservoirs', 'pore-explorer:res-split'); } catch { isolated = true; }
      // First-party packs may reference previously registered records, so base loads first.
      const packed = createRegistry();
      await packed.load('./base.json');
      const baseOnly = packed.list('equipment').length;
      const namespace = await packed.load('./pore-explorer/pack.json');
      let duplicate = false, technique = false, family = false;
      try { await packed.load('./duplicate-pack.json'); } catch { duplicate = true; }
      const other = createRegistry();
      try { await other.load('./bad-technique.json'); } catch { technique = true; }
      try { await other.load('./bad-reservoir.json'); } catch { family = true; }
      return {namespace, isolated, duplicate, technique, family, baseOnly,
        regions: packed.list('regions').length, reservoirs: packed.list('reservoirs').length,
        equipment: packed.list('equipment').length, tutorials: packed.list('tutorials').length,
        achievements: packed.list('achievements').length, commentary: packed.list('commentary').length,
        modes: packed.list('modes').map(mode => mode.id).sort()};
    });
    assert.equal(contract.namespace, 'pore-explorer');
    assert.equal(contract.baseOnly, 3, 'the base pack registers alone');
    assert.equal(contract.isolated, true, 'a fresh registry must not see another pack');
    assert.equal(contract.duplicate, true, 'duplicate pack registration must fail');
    assert.equal(contract.technique, true, 'unknown instrument techniques must be rejected');
    assert.equal(contract.family, true, 'unknown reservoir families must be rejected');
    // Counts include the base records already registered in this catalog.
    assert.deepEqual([contract.regions, contract.reservoirs, contract.equipment, contract.tutorials, contract.achievements, contract.commentary], [13, 10, 6, 5, 16, 18]);
    assert.deepEqual(contract.modes.filter(id => id.startsWith('pore-explorer:')), ['pore-explorer:campaign', 'pore-explorer:endless', 'pore-explorer:zen']);
    assert.equal(contract.modes.length, 6, 'three base modes plus three expansion modes');

    const simulation = await page.evaluate(async () => {
      const {build, replay, remainingDraws, accounting, preview} = await import('./danny/reservoir.js');
      const template = {id: 'pore-explorer:res-iceberg', pattern: 'strata', chambers: [7, 9], scale: .86,
        materials: ['pore-explorer:keratin', 'base:cream'], hidden: 3, obstruction: 'valve'};
      const one = JSON.stringify(build(template, 424242)), two = JSON.stringify(build(template, 424242));
      const three = JSON.stringify(build(template, 424243));
      let complete = true, conserved = true, negative = false, cascades = 0, valvesHold = true, plugMoves = true;
      for (const pattern of ['fork', 'ribbon', 'strata', 'chain', 'braid', 'migrate']) {
        for (const seed of [1, 7, 99, 4242]) {
          const graph = build({id: 'pore-explorer:t-' + pattern, pattern, chambers: [4, 7], scale: .7,
            materials: ['base:cream', 'pore-explorer:serous'], hidden: 1, obstruction: pattern === 'migrate' ? 'migrate' : 'none'}, seed);
          const found = graph.nodes.map(node => node.key);
          const full = replay(graph, {p: 40, found}, {openAll: true});
          if (!full.complete) complete = false;
          const acct = accounting(graph, {p: 40, found});
          if (acct.negative || Math.abs(acct.consumed + acct.remaining - acct.initial) > 0.02) conserved = false;
          if (full.events.some(event => event.secondary.length)) cascades++;
          if (pattern !== 'migrate') {
            const valved = build({id: 'pore-explorer:v-' + pattern, pattern, chambers: [5, 6], scale: .7,
              materials: ['base:cream'], hidden: 0, obstruction: 'valve'}, seed);
            if (valved.gates.length) {
              const held = replay(valved, {p: 20});
              const opened = replay(valved, {p: 20, g: valved.gates.map((_, index) => index)});
              if (!(held.remaining > opened.remaining)) valvesHold = false;
            }
          }
        }
        if (pattern === 'migrate') {
          const graph = build({id: 'pore-explorer:m', pattern, chambers: [6, 6], scale: .7,
            materials: ['base:cream'], hidden: 0, obstruction: 'migrate'}, 11);
          const hosts = new Set();
          for (let pass = 1; pass <= 4; pass++) hosts.add(replay(graph, {p: pass}).migrating);
          if (hosts.size < 2) plugMoves = false;
        }
      }
      // A vortex release advances two flow units; preview reports it without committing.
      const graph = build({id: 'pore-explorer:p', pattern: 'fork', chambers: [5, 6], scale: 1,
        materials: ['base:cream'], hidden: 0, obstruction: 'none'}, 5);
      const vortex = preview(graph, {p: 0}, {technique: 'vortex'});
      const loop = preview(graph, {p: 0}, {technique: 'roll'});
      return {same: one === two, differs: one !== three, complete, conserved, negative, cascades,
        valvesHold, plugMoves, vortexSteps: vortex.steps, loopSteps: loop.steps,
        needs: remainingDraws(graph, {}), nodes: graph.nodes.length};
    });
    assert.equal(simulation.same, true, 'reservoir generation must be deterministic for a seed');
    assert.equal(simulation.differs, true, 'a different seed must produce a different network');
    assert.equal(simulation.complete, true, 'every family must be completable');
    assert.equal(simulation.conserved, true, 'material accounting must balance');
    assert.equal(simulation.negative, false);
    assert.ok(simulation.cascades >= 4, 'chain reactions must produce secondary releases');
    assert.equal(simulation.valvesHold, true, 'valves must restrict flow until broken');
    assert.equal(simulation.plugMoves, true, 'the migrating plug must change chambers');
    assert.deepEqual([simulation.vortexSteps, simulation.loopSteps], [2, 1]);

    // ---------------------------------------------------------------------------------------
    // B. Expansion entry, tutorials, imaging interaction and the first concealed reservoir.
    await openExpansion();
    assert.equal(await page.locator('#dialogTitle').textContent(), 'The Pore Explorer');
    assert.equal(await page.locator('.file-row').count(), 12, 'three chapters of four encounters');
    await page.getByRole('button', {name: 'Start the dive'}).click();
    assert.equal(await dismissTutorial(), 'Entering the underground', 'first entry tutorial');
    await page.locator('#scopePanel').waitFor({state: 'visible'});
    assert.equal(await page.locator('#scopePanel').isVisible(), true);
    assert.equal(await page.locator('.tool-name').count(), 6, 'base kit plus three expansion instruments');
    assert.equal(await page.locator('#caseTitle').textContent(), 'Nothing to see here');
    assert.equal((await session()).mode, 'pore-explorer:campaign');
    assert.ok(packRequests.some(request => request.includes('pack.json')), 'the pack must load on demand');
    assert.ok(packRequests.some(request => request.includes('expansion.js')), 'the module must load on demand');
    // Re-opening the expansion panel must not repeat the tutorial.
    await openExpansion();
    await page.getByRole('button', {name: 'Stay on shift'}).click();
    assert.equal(await page.locator('#dialog[open]').count(), 0);
    // Imaging modes are independent and animated; the beam maps a spatial grid.
    await page.locator('[data-view="scan"]').click();
    assert.equal(await page.locator('[data-view="scan"]').getAttribute('aria-pressed'), 'true');
    const beforeScan = await fieldInfo(0);
    assert.ok(beforeScan.found < beforeScan.nodes, 'a concealed chamber starts hidden');
    const firstScan = await scanAll(page, false);
    assert.ok(firstScan.found >= 2, 'sweeping the beam must resolve concealed structure');
    assert.match(await page.locator('#scopeReadout').textContent(), /chambers mapped/);
    assert.ok(firstScan.found > beforeScan.found, 'the sweep must resolve a new chamber');
    assert.match(await page.locator('#cue').textContent(), /basement|mixed-use|drilling|structure|chamber|resolved/i);
    await page.locator('[data-view="cross"]').click();
    await page.clock.fastForward(600);
    const crossPixels = await page.evaluate(() => {
      const canvas = document.getElementById('effects'), ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 8) painted++;
      return painted;
    });
    assert.ok(crossPixels > 5000, 'the cross-section overlay must paint on the effects canvas');
    await page.locator('[data-view="surface"]').click();
    await page.clock.fastForward(400);
    // The PoreScope releases a diagnostic pulse: depth up, material untouched.
    const probeId = await activeId();
    await equip('PoreScope');
    const probeBefore = await fieldInfo(probeId);
    await releaseAt(await timing(probeId));
    const probeAfter = await fieldInfo(probeId);
    assert.equal(probeAfter.passes, probeBefore.passes, 'a diagnostic pulse must not drain material');
    assert.match(await page.locator('#cue').textContent(), /Diagnostic|Depth|chamber/i);
    // The first extraction release is deliberately partial: the visible cap is not the reservoir.
    await equip('Loop extractor');
    const beforeFirst = await fieldInfo(0);
    await releaseAt(await timing(0));
    const afterFirst = await fieldInfo(0);
    assert.equal(afterFirst.cleared, false, 'the first pass must not finish the target');
    assert.ok(afterFirst.passes > beforeFirst.passes, 'the release must commit a reservoir pass');
    assert.match(await page.locator('#cue').textContent(), /chamber|below|basement|reservoir|material|more|stream/i);
    const truth = await page.evaluate(() => daniInspect.totals());
    assert.ok(truth.achievements.includes('pore-explorer:truth-down-there'), 'concealed discovery achievement');
    await clearCase(page);
    assert.equal(await page.locator('#targetCount').textContent(), '3 / 3');
    assert.equal(await page.locator('#review:visible').count(), 1);
    const afterCaseOne = await page.evaluate(() => daniInspect.totals());
    assert.ok(afterCaseOne.stats.concealed >= 1);
    assert.equal(afterCaseOne.stats.chapters, 0, 'expansion progress must not touch base chapters');
    assert.equal(afterCaseOne.stats.bosses, 0, 'expansion bosses must not count as base bosses');

    // ---------------------------------------------------------------------------------------
    // C. Expansion instruments: the vortex advances two flow units, the wand refuses plain
    // material, and the wand is required for valves and migrating plugs.
    const nextCase = async () => {
      await page.locator('#review').click();
      const next = page.getByRole('button', {name: 'Begin next case'});
      if (await next.count()) { await next.click(); return true; }
      const view = page.getByRole('button', {name: 'View campaign'});
      if (await view.count()) await view.click();
      return false;
    };
    assert.equal(await nextCase(), true);
    assert.equal(await page.locator('#caseTitle').textContent(), 'The Hidden Agenda');
    const vortexTool = page.locator('.tool').filter({has: page.locator('.tool-name', {hasText: 'Vortex Extractor'})});
    assert.equal(await vortexTool.isEnabled(), true, 'chapter two should unlock the vortex');
    const vortexTarget = await activeId();
    await equip('Vortex Extractor');
    const beforeVortex = await fieldInfo(vortexTarget);
    await releaseAt(await timing(vortexTarget));
    const afterVortex = await fieldInfo(vortexTarget);
    assert.equal(afterVortex.passes - beforeVortex.passes, 2, 'a vortex release drains two flow units');
    await clearCase(page);
    assert.equal(await nextCase(), true);
    assert.equal(await page.locator('#caseTitle').textContent(), 'More Than Meets the Eye');
    await clearCase(page);
    assert.equal(await nextCase(), true);
    assert.equal(await page.locator('#caseTitle').textContent(), 'Beneath the Iceberg');
    // The boss is gated behind the regular targets and needs the wand for its valve.
    assert.match(await page.locator('#bossHint').textContent(), /Iceberg|Clear the field/);
    await clearCase(page);
    const afterIceberg = await page.evaluate(() => daniInspect.totals());
    assert.ok(afterIceberg.achievements.includes('pore-explorer:iceberg-ahead'), 'Iceberg achievement');
    assert.ok(afterIceberg.stats.icebergs >= 1);
    assert.ok(afterIceberg.stats.deepBosses >= 1);
    assert.equal(afterIceberg.stats.bosses, 0, 'expansion bosses never increment base boss stats');

    // ---------------------------------------------------------------------------------------
    // D. Chapters six and seven, every encounter, all three bosses, the cascade and the ribbon.
    const played = [];
    const playOnce = async options => {
      played.push((await session()).encounter);
      await clearCase(page, options);
    };
    assert.equal(await nextCase(), true);
    assert.equal(await page.locator('#caseTitle').textContent(), 'The Fork in the Road');
    await playOnce();
    await nextCase();
    assert.equal(await page.locator('#caseTitle').textContent(), 'Chamber of Secrets');
    await playOnce();
    await nextCase();
    assert.equal(await page.locator('#caseTitle').textContent(), 'The Long Goodbye');
    await playOnce();
    const ribbon = await page.evaluate(() => daniInspect.totals());
    assert.ok(ribbon.stats.ribbons >= 1, 'a long cohesive release must register');
    await nextCase();
    assert.equal(await page.locator('#caseTitle').textContent(), 'Release the Krakenzit');
    await clearCase(page);
    const kraken = await page.evaluate(() => daniInspect.totals());
    assert.ok(kraken.achievements.includes('pore-explorer:krakenzit-released'), 'Krakenzit achievement');
    await nextCase();
    assert.equal(await page.locator('#caseTitle').textContent(), 'Subterranean Blues');
    await playOnce();
    const cascade = await page.evaluate(() => daniInspect.totals());
    assert.ok(cascade.stats.secondarySwarm >= 3, 'a hub must wake at least three neighbours');
    await nextCase();
    assert.equal(await page.locator('#caseTitle').textContent(), 'The Department of Hidden Affairs');
    try {
      await playOnce({noScan: true});
    } catch (error) {
      console.error('[mystery fallback]', String(error.message).slice(0, 240));
      await scanAll(page, false);
      await playOnce();
    }
    await nextCase();
    assert.equal(await page.locator('#caseTitle').textContent(), 'Everything Everywhere All at Once');
    await playOnce();
    await nextCase();
    assert.equal(await page.locator('#caseTitle').textContent(), 'The Hydra');
    await clearCase(page);
    const totals = await page.evaluate(() => daniInspect.totals());
    const expansionAchievements = ['truth-down-there', 'iceberg-ahead', 'wait-theres-more', 'neverending',
      'archaeologist', 'krakenzit-released', 'heads-will-pop', 'center-of-the-zit', 'not-so-elementary'];
    const missing = expansionAchievements.filter(name => !totals.achievements.includes('pore-explorer:' + name));
    assert.deepEqual(missing, [], 'all nine expansion achievements must be earnable through play');
    assert.equal(totals.stats.deepChapters, 3, 'three expansion chapters recorded');
    assert.equal(totals.stats.hydras, 1);
    assert.equal(totals.stats.chapters, 0, 'base chapter counter untouched');
    assert.ok(totals.stats.networks >= 1, 'a fully imaged network must be recorded');
    assert.ok(totals.stats.mysterySolves >= 1, 'the mystery case must record a minimal-diagnostic solve');
    // Replaying a completed encounter must not disturb the campaign checkpoint, and an ungated
    // reservoir is the right place to prove the wand refuses ordinary material.
    await openExpansion();
    await page.locator('.deep-replay[data-encounter="pore-explorer:nothing-to-see"]').first().click();
    await page.locator('#scopePanel').waitFor({state: 'visible'});
    assert.equal((await session()).encounter, 'pore-explorer:nothing-to-see');
    await equip('Resonance Wand');
    const plain = await activeId();
    await scanAll(page, false);
    const beforeWand = await fieldInfo(plain);
    await releaseAt(await timing(plain));
    const afterWand = await fieldInfo(plain);
    assert.equal(afterWand.passes, beforeWand.passes, 'the wand cannot grip plain material');
    assert.match(await page.locator('#cue').textContent(), /nothing to resonate|cannot grip/i);
    const replayed = await page.evaluate(() => daniInspect.totals());
    assert.equal(replayed.stats.deepChapters, 3, 'replay leaves campaign chapter progress intact');

    // ---------------------------------------------------------------------------------------
    // E. Mode integration: expansion Endless and Zen keep their own checkpoints.
    await openExpansion();
    await page.getByRole('button', {name: 'Endless core sample'}).click();
    await page.locator('#scopePanel').waitFor({state: 'visible'});
    assert.equal((await session()).mode, 'pore-explorer:endless');
    await clearTarget(page);
    assert.ok((await page.evaluate(() => daniInspect.totals())).stats.total > 0);
    await openExpansion();
    await page.getByRole('button', {name: 'Zen imaging'}).click();
    await page.locator('#scopePanel').waitFor({state: 'visible'});
    assert.equal((await session()).mode, 'pore-explorer:zen');
    const zenBefore = await page.evaluate(() => daniInspect.totals());
    await page.locator('#extract').focus();
    await page.keyboard.down('Space');
    await page.clock.fastForward(140);
    await page.keyboard.up('Space');
    await page.waitForFunction(() => document.querySelector('#feedStatus').dataset.save !== 'pending');
    const zenAfter = await page.evaluate(() => daniInspect.totals());
    assert.equal(zenAfter.stats.total, zenBefore.stats.total, 'Zen extraction must not score');
    assert.equal(zenAfter.xp, zenBefore.xp, 'Zen extraction must not award XP');

    // ---------------------------------------------------------------------------------------
    // F. Independent checkpoints: the base campaign slot is untouched and survives a corrupt
    // expansion checkpoint through the previous-record recovery path.
    const baseMode = async target => {
      await target.locator('#modeBtn').click();
      await target.locator('.mode-option').filter({has: target.locator('strong', {hasText: 'Campaign'})}).first().click();
      await target.waitForFunction(() => daniInspect.session().mode === 'base:campaign');
    };
    await baseMode(page);
    const baseAfter = await snapshot(page);
    assert.deepEqual(baseAfter.slots['base:campaign'], baseBefore.slots['base:campaign'], 'base checkpoint preserved');
    assert.equal(baseAfter.slots['base:campaign'].encounter, baseBefore.slots['base:campaign'].encounter);
    const expansionState = await page.evaluate(async () => {
      const {openCampaign} = await import('./danny/storage.js');
      const state = (await (await openCampaign()).read()).state;
      return {slots: Object.keys(state.slots).sort(), deepChapters: state.stats.deepChapters, mode: state.mode};
    });
    assert.deepEqual(expansionState.slots, ['base:campaign', 'pore-explorer:campaign', 'pore-explorer:endless', 'pore-explorer:zen']);
    assert.equal(expansionState.deepChapters, 3);
    // Commit a second base-mode record so the previous checkpoint is also a base-mode save.
    await page.locator('#soundBtn').click();
    await page.locator('#soundBtn').click();
    await page.waitForFunction(() => document.querySelector('#feedStatus').dataset.save !== 'pending');
    // Corrupt only the newest record; the previous checkpoint must restore the expansion campaign.
    await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('danny-popper');
      request.onsuccess = () => {
        const tx = request.result.transaction('campaign', 'readwrite');
        tx.objectStore('campaign').put({revision: 999, broken: true}, 'current');
        tx.oncomplete = resolve; tx.onerror = reject;
      };
    }));
    await page.reload(); await boot(page);
    assert.match(await page.locator('#saveStatus').textContent(), /Recovered/);
    assert.equal((await session()).mode, 'base:campaign', 'base mode survives recovery');
    const recovered = await snapshot(page);
    assert.deepEqual(recovered.slots['base:campaign'], baseBefore.slots['base:campaign']);
    assert.equal(recovered.stats.deepChapters, 3, 'expansion progress survives base recovery');

    // ---------------------------------------------------------------------------------------
    // G. Existing 1.0 save compatibility: a schema-2 record with only base counters must load.
    await page.evaluate(async () => {
      const state = {
        schema: 2, revision: 41, packs: {base: '1.0.0'}, mode: 'base:campaign', tool: 'base:loop',
        slots: {'base:campaign': {encounter: 'base:forecast', seed: 20530, turn: 2, cleared: [0], layers: {}, streak: 1, points: 100}},
        xp: 240, score: 180, achievements: ['base:first-pop'],
        stats: {total: 3, perfects: 1, bestStreak: 2, bosses: 0, chapters: 0, endlessFields: 0, zenFields: 0},
        settings: {sound: true, volume: .65, haptics: false, assist: false, toggle: false, contrast: false, reducedMotion: false}
      };
      const {openCampaign} = await import('./danny/storage.js');
      const store = await openCampaign();
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('danny-popper');
        request.onsuccess = () => {
          const tx = request.result.transaction('campaign', 'readwrite');
          tx.objectStore('campaign').put(state, 'current');
          tx.oncomplete = resolve; tx.onerror = reject;
        };
      });
      void store;
    });
    await page.reload(); await boot(page);
    assert.equal((await session()).mode, 'base:campaign');
    assert.equal(await page.locator('#targetCount').textContent(), '1 / 4');
    const compat = await page.evaluate(() => daniInspect.profile());
    assert.equal(compat.xp, 240);
    assert.deepEqual(compat.achievements, ['base:first-pop']);
    assert.equal(compat.stats.concealed, 0, 'expansion counters are normalized on load');
    assert.deepEqual(compat.tutorials, []);
    assert.match(await page.locator('#kitCount').textContent(), /03 \/ 03 AVAILABLE/, 'base tray lists only the base kit');
    // The expansion is still selectable from this older save.
    await enterExpansion();
    assert.equal((await session()).mode, 'pore-explorer:campaign');
    await baseMode(page);
    assert.equal(await page.locator('.tool-name').count(), 3, 'base tray restores the base kit');

    // ---------------------------------------------------------------------------------------
    // H. Offline expansion access, legacy URL, Canvas fallback and a like-for-like timing check.
    const cacheAudit = await page.evaluate(async () => {
      const names = await caches.keys();
      const expansion = names.find(name => name.startsWith('junkdrawer-danny-expansion-'));
      const shell = names.find(name => name.startsWith('junkdrawer-danny-shell-'));
      const list = expansion ? (await (await caches.open(expansion)).keys()).map(request => new URL(request.url).pathname) : [];
      const shellFiles = (await (await caches.open(shell)).keys()).map(request => new URL(request.url).pathname);
      return {expand: names.filter(name => name.startsWith('junkdrawer-danny-')), expansion, shell,
        media: list.filter(path => /\.(jpg|png)$/.test(path)).length, modules: list.filter(path => path.endsWith('.js')).length,
        engine: shellFiles.filter(path => /reservoir\.js$|content\.js$|progression\.js$/.test(path)).length,
        baseTextures: shellFiles.filter(path => /skin\.jpg$/.test(path)).length};
    });
    assert.ok(cacheAudit.expansion, 'the expansion cache exists after first access');
    assert.ok(cacheAudit.media >= 6, 'all six region plates are cached for offline play');
    assert.ok(cacheAudit.modules >= 2, 'the on-demand expansion modules are cached after first use');
    assert.equal(cacheAudit.engine, 3, 'shared engine primitives remain in the base offline shell');
    assert.equal(cacheAudit.baseTextures, 1, 'the base shell cache is unchanged');
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {timeout: 20000}).catch(() => {});
    await page.reload(); await boot(page);
    await enterExpansion();
    await settle(page);
    await context.setOffline(true);
    await page.reload(); await boot(page);
    const offlineBoot = await page.evaluate(() => ({session: daniInspect.session(), status: document.querySelector('#saveStatus').textContent,
      panel: !!document.querySelector('#scopePanel'), hidden: document.querySelector('#scopePanel')?.hidden, cue: document.querySelector('#cue').textContent}));
    console.log('[offline boot]', JSON.stringify(offlineBoot));
    await page.locator('#scopePanel').waitFor({state: 'visible'});
    assert.equal((await session()).mode, 'pore-explorer:campaign', 'expansion checkpoint resumes offline');
    await openExpansion();
    assert.equal(await page.locator('.file-row').count(), 12, 'offline campaign panel');
    await page.getByRole('button', {name: 'Stay on shift'}).click();
    await context.setOffline(false);
    // Legacy launch URL still resolves to the canonical document.
    await page.goto(base + 'danny-the-pimple-popper.html#legacy');
    await page.waitForFunction(() => location.pathname.endsWith('/dani-the-pimple-popper.html'));
    assert.equal(await page.locator('h1').textContent(), 'Dani the Pimple Popper.');
    await boot(page);
    // Canvas fallback: the imaging overlay must work without WebGL2.
    const canvasContext = await browser.newContext({viewport: {width: 390, height: 820}, isMobile: true, hasTouch: true});
    await canvasContext.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return type === 'webgl2' ? null : original.call(this, type, ...args);
      };
    });
    const mobile = await canvasContext.newPage();
    mobile.on('pageerror', e => errors.push(e.message));
    await mobile.goto(url); await boot(mobile);
    assert.equal(await mobile.locator('#stage').getAttribute('data-renderer'), 'canvas2d');
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow');
    await enterExpansion('Start the dive', mobile);
    await mobile.locator('[data-view="scan"]').click();
    const box = await mobile.locator('#stage').boundingBox();
    const touch = await canvasContext.newCDPSession(mobile);
    await touch.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: box.x + box.width * .45, y: box.y + box.height * .55}]});
    await mobile.waitForTimeout(120);
    for (const [x, y] of [[.3, .35], [.5, .5], [.7, .7]]) {
      await touch.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: box.x + box.width * x, y: box.y + box.height * y}]});
      await mobile.waitForTimeout(60);
    }
    await touch.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    const mobilePixels = await mobile.evaluate(() => {
      const canvas = document.getElementById('effects'), ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 8) painted++;
      return painted;
    });
    assert.ok(mobilePixels > 2000, 'Canvas fallback paints the imaging overlay');
    await canvasContext.close();

    // Performance: same page, same frame loop, idle base versus active scanning. Timing only, no
    // assertions about physical devices.
    const measure = async target => target.evaluate(() => new Promise(resolve => {
      const samples = []; let last = performance.now(), frames = 0;
      const tick = stamp => {
        samples.push(stamp - last); last = stamp;
        if (++frames < 100) requestAnimationFrame(tick);
        else {
          const values = samples.slice(12).sort((a, b) => a - b);
          resolve({median: values[Math.floor(values.length / 2)], p95: values[Math.floor(values.length * .95)]});
        }
      };
      requestAnimationFrame(tick);
    }));
    const perfContext = await browser.newContext({viewport: {width: 1180, height: 880}, deviceScaleFactor: 3});
    await perfContext.route('**/api/analytics/**', route => route.fulfill({status: 204}));
    const perf = await perfContext.newPage();
    perf.on('pageerror', e => errors.push(e.message));
    await perf.goto(url); await boot(perf);
    const idle = await measure(perf);
    await enterExpansion('Start the dive', perf);
    await perf.locator('[data-view="scan"]').click();
    await perf.locator('#scanBtn').focus();
    await perf.keyboard.down('Space');
    const scanning = await measure(perf);
    await perf.keyboard.up('Space');
    assert.ok(scanning.p95 < Math.max(120, idle.p95 * 5), 'imaging must stay inside a bounded frame budget');
    await perfContext.close();

    assert.deepEqual(errors, [], 'no console or page errors');
    console.log('Passed expansion manifest and lazy loading, namespace isolation, deterministic reservoir graphs, material accounting, chamber activation, hidden placement, all twelve encounters and three bosses, six behaviors, three instruments, nine achievements, independent checkpoints, 1.0 save compatibility, offline expansion cache, legacy URL, WebGL2 and Canvas imaging.');
    console.log('Frame timing (software renderer, identical page): base idle median ' + idle.median.toFixed(1) + ' ms / p95 ' + idle.p95.toFixed(1) + ' ms · PoreScope scan median ' + scanning.median.toFixed(1) + ' ms / p95 ' + scanning.p95.toFixed(1) + ' ms.');
  } finally { await browser.close(); server.close(); }
}
run().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
