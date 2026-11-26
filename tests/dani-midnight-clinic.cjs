// Dani the Pimple Popper 1.3 — The Midnight Clinic verification suite.
// Run from the repository root: node tests/dani-midnight-clinic.cjs
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
  const errors = [], clinicRequests = [];
  try {
    const context = await browser.newContext({viewport: {width: 1180, height: 880}});
    await context.route('**/api/analytics/**', route => route.fulfill({status: 204}));
    await context.route('**/midnight-clinic/**', route => { clinicRequests.push(route.request().url()); return route.continue(); });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const boot = async (target = page) => {
      await target.waitForFunction(() => document.querySelector('#feedStatus').textContent === 'Optics online');
      await target.waitForFunction(() => !!window.daniInspect);
    };
    const settle = async (target = page) => target.waitForFunction(() => document.querySelector('#feedStatus').dataset.save !== 'pending');
    const clock = async (target = page) => {
      await target.clock.install({time: new Date('2030-06-13T00:00:00Z')});
      await target.clock.pauseAt(new Date('2030-06-13T00:00:01Z'));
    };
    const snapshot = async (target = page) => {
      await settle(target);
      return target.evaluate(async () => (await (await (await import('./danny/storage.js')).openCampaign()).read()).state);
    };
    const timing = async (id, target = page) => {
      await settle(target);
      return target.evaluate(async id => {
        const {openCampaign} = await import('./danny/storage.js');
        const {migrate, visitFor, calibrated} = await import('./danny/progression.js');
        const {makeField, pressure, band} = await import('./danny/simulation.js');
        const profile = migrate((await (await openCampaign()).read()).state);
        const visit = visitFor(profile), tool = calibrated(profile, visit), field = makeField(visit);
        const l = field[id], pass = visit.run.layers[id] || 0;
        // Stepped clinic curves (spectral, cryo) do not cross the exact centre, so accept any
        // instant that the game's own band assessment would score as a release.
        let closest = 0, distance = 1;
        for (let ms = 1; ms < 26000; ms++) {
          const t = ms / 1000, zone = band(t, l, tool, pass);
          const error = Math.abs(pressure(t, l, tool, pass) - zone.center);
          if (error <= zone.width * 0.7) return ms;
          if (error < distance) { distance = error; closest = ms; }
        }
        if (distance <= 1) return closest;
        throw Error('No release band for target ' + id + ' with ' + tool.technique);
      }, id);
    };
    // Release when the game itself reports the band, rather than re-deriving every curve. This is
    // the same signal a player sees (the meter lights up) and it survives stepped clinic curves.
    const releaseAt = async (ms = 0, target = page) => {
      await target.locator('#extract').focus();
      await target.keyboard.down('Space');
      let elapsed = 0;
      const limit = Math.max(2400, Math.min(6000, ms * 3 || 3000));
      while (elapsed < limit) {
        await target.clock.fastForward(24);
        elapsed += 24;
        if (await target.evaluate(() => document.getElementById('meter').classList.contains('inside'))) break;
      }
      await target.keyboard.up('Space');
      await settle(target);
    };
    let dismissTutorial = async () => '';
    const equip = async (name, target = page) => {
      const tool = target.locator('.tool').filter({has: target.locator('.tool-name', {hasText: name})});
      if (!(await tool.isEnabled())) throw Error('Instrument locked: ' + name);
      await tool.click(); await settle(target); await dismissTutorial(target);
    };
    const equipAny = async (names, target = page) => {
      for (const name of names) {
        const tool = target.locator('.tool').filter({has: target.locator('.tool-name', {hasText: name})});
        if (await tool.isEnabled()) { await tool.click(); await settle(target); await dismissTutorial(target); return name; }
      }
      throw Error('No usable instrument among ' + names.join(', '));
    };
    dismissTutorial = async (target = page) => {
      if (!(await target.locator('#dialog[open]').count())) return '';
      const title = await target.locator('#dialogTitle').textContent();
      const button = target.getByRole('button', {name: 'Got it'});
      if (await button.count()) await button.click();
      return title;
    };
    const openClinic = async (target = page) => {
      await target.locator('#clinicBtn').click();
      await target.locator('#dialogTitle').waitFor();
    };
    const enterClinic = async (label = 'Open the clinic', target = page) => {
      await openClinic(target);
      const name = (await target.getByRole('button', {name: label}).count()) ? label : 'Resume the shift';
      await target.getByRole('button', {name}).click();
      const tutorial = await dismissTutorial(target);
      await target.locator('#scopePanel').waitFor({state: 'visible'});
      return tutorial;
    };
    const activeId = async (target = page) => Number(await target.locator('.marker.current').getAttribute('data-target'));
    const session = async (target = page) => target.evaluate(() => daniInspect.session());
    const fieldInfo = async (id, target = page) => target.evaluate(id => daniInspect.field().find(l => l.id === id), id);
    const scanAll = async (target = page, equipScope = true) => {
      if (equipScope) await equip('PoreScope', target).catch(() => {});
      await target.locator('[data-view="scan"]').click();
      await target.locator('#scanBtn').focus();
      await target.keyboard.down('Space');
      const box = await target.locator('#stage').boundingBox();
      for (let r = 0; r < 6; r++) for (let c = 0; c < 8; c++) {
        await target.mouse.move(box.x + box.width * (0.2 + c / 7 * 0.6), box.y + box.height * (0.25 + r / 5 * 0.55));
        await target.clock.fastForward(180);
      }
      await target.keyboard.up('Space');
      await settle(target);
      return target.evaluate(() => daniInspect.scope());
    };
    const GATE_TOOLS = {core: ['Arcane Resonator', 'Cryo Wand'], valve: ['Arcane Resonator'], plug: ['The Silver Loop', 'Arcane Resonator'],
      septum: ['Arcane Resonator'], migrate: ['Arcane Resonator', 'Resonance Wand']};
    const clearTarget = async (target = page, options = {}) => {
      const id = await activeId(target);
      const alternatives = ['The Silver Loop', 'Spectral Extractor', 'Cryo Wand', 'Arcane Resonator'];
      for (let guard = 0; guard < 44; guard++) {
        const info = await fieldInfo(id, target);
        if (info.cleared) return info;
        let scope = await target.evaluate(() => daniInspect.scope());
        if (!options.noScan && scope && info.found < info.nodes) { await scanAll(target, false); scope = await target.evaluate(() => daniInspect.scope()); }
        const gates = scope ? scope.gates.filter(g => !g.broken) : [];
        const held = scope && scope.held;
        let chosen;
        if (gates.length || held) chosen = await equipAny([...(GATE_TOOLS[held ? 'migrate' : gates[0].type] || []), 'The Silver Loop'], target);
        else chosen = await equipAny(['Spectral Extractor', 'The Silver Loop'], target);
        const before = await fieldInfo(id, target);
        await releaseAt(0, target);
        let after = await fieldInfo(id, target);
        // A player tries another instrument when a release does nothing. That also advances the
        // phase clock, so a phase-locked chamber becomes reachable on the next attempt.
        for (const name of alternatives) {
          if (after.passes !== before.passes || after.cleared) break;
          const tool = target.locator('.tool').filter({has: target.locator('.tool-name', {hasText: name})});
          if (!(await tool.isEnabled())) continue;
          await tool.click(); await settle(target); await dismissTutorial(target);
          await releaseAt(0, target);
          after = await fieldInfo(id, target);
        }
        if (after.passes === before.passes && !after.cleared && !gates.length && scope && scope.phaseClosed && scope.phaseClosed.length) {
          await releaseAt(0, target).catch(() => {});
        }
      }
      const scopeNow = await target.evaluate(() => daniInspect.scope());
      const enabled = await target.evaluate(() => [...document.querySelectorAll('.tool')].filter(button => !button.disabled)
        .map(button => button.querySelector('.tool-name').textContent));
      const diagnostic = {encounter: (await session(target)).encounter, passes: (await fieldInfo(id, target)).passes,
        remaining: scopeNow && scopeNow.remaining, found: scopeNow && scopeNow.found, nodes: scopeNow && scopeNow.nodes.length,
        gates: scopeNow && scopeNow.gates, held: scopeNow && scopeNow.held, phaseClosed: scopeNow && scopeNow.phaseClosed,
        enabled, cue: await target.locator('#cue').textContent()};
      throw Error('Target ' + id + ' did not clear: ' + JSON.stringify(diagnostic));
    };
    const clearCase = async (target = page, options = {}) => {
      for (let guard = 0; guard < 8; guard++) {
        if (await target.locator('#review:visible').count()) return;
        await clearTarget(target, options);
      }
      throw Error('Case did not clear');
    };
    const nextCase = async () => {
      await page.locator('#review').click();
      const next = page.getByRole('button', {name: 'Begin next case'});
      if (await next.count()) { await next.click(); return true; }
      const view = page.getByRole('button', {name: 'View campaign'});
      if (await view.count()) await view.click();
      return false;
    };

    // ---------------------------------------------------------------------------------------
    // A. Baseline, lazy loading and the midnight contract.
    await page.goto(url);
    await boot(page);
    assert.equal(await page.locator('#stage').getAttribute('data-renderer'), 'webgl2');
    assert.equal(clinicRequests.length, 0, 'the clinic must not load during base startup');
    await page.locator('#soundBtn').click(); await page.locator('#soundBtn').click();
    const baseBefore = await snapshot(page);
    assert.equal(baseBefore.mode, 'base:campaign');
    await clock(page);
    await page.route('**/bad-patient.json', route => route.fulfill({json: {namespace: 'bad', version: '1.0.0', engineMajor: 1,
      patients: [{id: 'bad:thing', name: 'Thing', klass: 'kraken', region: 'midnight-clinic:vampire-neck', reservoir: 'midnight-clinic:res-vampire', materials: ['base:cream']}]}}));
    const contract = await page.evaluate(async () => {
      const {createRegistry} = await import('./danny/content.js');
      const reg = createRegistry();
      await reg.load('./base.json');
      const namespace = await reg.load('./midnight-clinic/pack.json');
      let badClass = false;
      try { await reg.load('./bad-patient.json'); } catch { badClass = true; }
      const patients = reg.list('patients'), classes = [...new Set(patients.map(p => p.klass))];
      const intake = reg.list('intake').length, records = reg.list('records').length;
      const legacy = createRegistry();
      let isolated = false;
      try { legacy.get('patients', 'midnight-clinic:patient-count-blackula'); } catch { isolated = true; }
      return {namespace, badClass, isolated, patients: patients.length, classes: classes.length,
        materials: reg.list('materials').length, equipment: reg.list('equipment').length, tutorials: reg.list('tutorials').length,
        encounters: reg.list('encounters').length, bosses: reg.list('bosses').length, achievements: reg.list('achievements').length,
        records, intake, conditions: reg.list('conditions').length, reservoirs: reg.list('reservoirs').length,
        modes: reg.list('modes').map(m => m.id).sort()};
    });
    assert.equal(contract.namespace, 'midnight-clinic');
    assert.equal(contract.badClass, true, 'unknown patient classes must be rejected');
    assert.equal(contract.isolated, true, 'a fresh registry must not see the pack');
    assert.equal(contract.patients, 11);
    assert.equal(contract.classes, 11, 'ten supernatural classes plus the crossover');
    // Counts include the base records registered first in this catalog.
    assert.deepEqual([contract.materials, contract.equipment, contract.encounters, contract.bosses, contract.achievements, contract.records, contract.intake, contract.conditions], [11, 7, 25, 8, 23, 8, 16, 6]);
    assert.deepEqual(contract.modes.filter(id => id.startsWith('midnight-clinic:')), ['midnight-clinic:campaign', 'midnight-clinic:endless', 'midnight-clinic:referral', 'midnight-clinic:zen']);
    assert.equal(contract.modes.length, 7, 'three base modes plus four clinic modes');

    // ---------------------------------------------------------------------------------------
    // B. Supernatural simulation: conditions, phases, rewiring, regeneration and conservation.
    const simulation = await page.evaluate(async () => {
      const {build, replay, accounting} = await import('./danny/reservoir.js');
      const mk = (id, extra) => ({id: 'midnight-clinic:' + id, pattern: extra.pattern || 'braid', chambers: [6, 8], scale: .8,
        materials: ['midnight-clinic:ectoplasm', 'midnight-clinic:crypt-resin'], hidden: 2, obstruction: extra.obstruction || 'none', ...extra});
      const template = mk('res-lovecraft', {pattern: 'braid', phase: 5, phaseNodes: 2, rewire: 3, mutation: 4, mutates: 3, echo: true, dormant: 2, obstruction: 'septum'});
      const one = JSON.stringify(build(template, 4242)), two = JSON.stringify(build(template, 4242)), three = JSON.stringify(build(template, 4243));
      const envs = [{}, {moon: true}, {temp: true}, {spectral: true}, {bioluminescence: true}, {spectral: true, moon: true, bioluminescence: true}];
      let complete = true, conserved = true, negative = false, phaseSaw = false, rewires = 0, regens = 0, mutated = 0, echoes = 0;
      const seeds = [7, 99, 4242, 8123];
      for (const seed of seeds) for (const env of envs) {
        const graph = build(template, seed);
        const all = graph.nodes.map(n => n.key);
        const full = replay(graph, {p: 48, found: all}, {openAll: true, env});
        if (!full.complete) complete = false;
        const acct = accounting(graph, {p: 48, found: all});
        if (acct.negative || Math.abs(acct.consumed + acct.remaining - acct.initial) > 0.02) conserved = false;
        for (let p = 1; p <= 12; p++) {
          const state = replay(graph, {p, found: all, k: p}, {env});
          const event = state.events[p - 1];
          if (state.phaseClosed.length) phaseSaw = true;
          if (state.nodes.some(n => n.dormant && !n.active) && p < 12) regens = Math.max(regens, state.dormant.length);
          rewires = Math.max(rewires, graph.rewired);
          mutated = Math.max(mutated, state.nodes.filter(n => n.mutates).length);
          if (event.echoed.length) echoes++;
        }
        // Unknown state must never be reachable: a drained field is always complete.
        const drained = replay(graph, {p: 48, found: all}, {openAll: true, env});
        if (drained.remaining > 0.01) complete = false;
      }
      const a = replay(build(template, 11), {p: 7, found: build(template, 11).nodes.map(n => n.key)}, {env: {moon: true, spectral: true}});
      const b = replay(build(template, 11), {p: 7, found: build(template, 11).nodes.map(n => n.key)}, {env: {moon: true, spectral: true}});
      return {same: one === two, differs: one !== three, complete, conserved, negative, phaseSaw, rewires, regens, mutated, echoes,
        deterministic: JSON.stringify(a) === JSON.stringify(b)};
    });
    assert.equal(simulation.same, true);
    assert.equal(simulation.differs, true);
    assert.equal(simulation.complete, true, 'every seed and condition must complete');
    assert.equal(simulation.conserved, true, 'material accounting must balance');
    assert.equal(simulation.negative, false);
    assert.equal(simulation.phaseSaw, true, 'phase-locked chambers must exist');
    assert.ok(simulation.rewires >= 2, 'the labyrinth must add passages');
    assert.ok(simulation.regens >= 1, 'dormant chambers must exist');
    assert.ok(simulation.mutated >= 1, 'material mutation must exist');
    assert.ok(simulation.echoes >= 1, 'spectral echoes must fire');
    assert.equal(simulation.deterministic, true);

    // ---------------------------------------------------------------------------------------
    // C. Clinic entry, intake, imaging and the first supernatural extraction.
    await openClinic();
    assert.equal(await page.locator('#dialogTitle').textContent(), 'The Midnight Clinic');
    assert.equal(await page.locator('.file-row').count(), 16, 'four chapters of four appointments');
    assert.match(await page.locator('#dialogBody').innerText(), /PATIENT INTAKE|Intake paperwork/);
    await page.getByRole('button', {name: 'Open the clinic'}).click();
    assert.equal(await dismissTutorial(), 'Opening the clinic');
    await page.locator('#scopePanel').waitFor({state: 'visible'});
    await page.locator('#clinicPanel').waitFor({state: 'visible'});
    assert.equal(await page.locator('.tool-name').count(), 8, 'base kit, shared PoreScope, Pore Explorer kit and four clinic instruments');
    assert.equal((await session()).mode, 'midnight-clinic:campaign');
    assert.ok(clinicRequests.some(request => request.includes('pack.json')), 'the pack loads on demand');
    assert.equal(await page.locator('#caseTitle').textContent(), 'Count Blackula');
    assert.match(await page.locator('#patient').textContent(), /vampire|night baker|museum guard/i);
    assert.match(await page.locator('#clinicLine').textContent(), /vampire/i);
    const firstField = await page.evaluate(() => daniInspect.field());
    assert.ok(firstField.every(target => target.pattern && target.nodes >= 4), 'every patient is a reservoir network');
    assert.ok(firstField.some(target => target.layers >= 4), 'supernatural reservoirs need several passes');
    const scan = await scanAll(page, true);
    assert.ok(scan.found >= 3, 'scanning resolves supernatural chambers');
    await page.locator('[data-view="surface"]').click();
    // PoreScope release is diagnostic only.
    await equip('PoreScope');
    const probeId = await activeId();
    const probeBefore = await fieldInfo(probeId);
    await releaseAt(await timing(probeId));
    assert.equal((await fieldInfo(probeId)).passes, probeBefore.passes, 'diagnostic pulse does not drain');
    // The Silver Loop levers a simple plug and draws material.
    await clearCase(page);
    assert.equal(await page.locator('#targetCount').textContent(), '3 / 3');
    const afterFirstCase = await page.evaluate(() => daniInspect.totals());
    assert.ok(afterFirstCase.stats.vampires >= 1, 'vampire class recorded');
    assert.ok(afterFirstCase.stats.classCases >= 1);
    assert.ok(afterFirstCase.achievements.includes('midnight-clinic:ach-night-shift'));
    assert.ok(afterFirstCase.achievements.includes('midnight-clinic:ach-fangs-for-coming'));
    assert.equal(afterFirstCase.stats.chapters, 0, 'base chapter counter untouched');
    assert.equal(afterFirstCase.stats.bosses, 0, 'base boss counter untouched');

    // ---------------------------------------------------------------------------------------
    // D. The whole campaign: sixteen appointments and four bosses, with class, record and
    // achievement coverage. Scanning is skipped after the first case to keep the run bounded.
    const played = [];
    const playCase = async options => {
      played.push((await session()).encounter);
      await clearCase(page, options);
    };
    for (let index = 0; index < 15; index++) {
      assert.equal(await nextCase(), true, 'more appointments remain at ' + index);
      await playCase({noScan: true});
    }
    assert.equal(await nextCase(), false, 'the midnight campaign is complete');
    await page.getByRole('button', {name: 'View campaign'}).click().catch(() => {});
    if (await page.locator('#dialog[open]').count()) await page.locator('#dismiss').click();
    const totals = await page.evaluate(() => daniInspect.totals());
    const required = ['night-shift', 'fangs-for-coming', 'hair-of-the-dog', 'dead-and-buried', 'pore-possession',
      'swamp-justice', 'troll-bridge', 'beam-me-up', 'last-of-gus', 'witching-hour', 'unholy-alliance',
      'unspeakable-pop', 'creature-comforts', 'nocturnal-professional', 'full-moon-fever'];
    const missing = required.filter(name => !totals.achievements.includes('midnight-clinic:ach-' + name));
    assert.deepEqual(missing, [], 'every disclosed midnight achievement must be earnable');
    assert.equal(totals.stats.midnightChapters, 4, 'four midnight chapters');
    assert.equal(totals.stats.classesSeen, 10, 'all ten supernatural classes seen');
    assert.ok(totals.stats.poreculas >= 1 && totals.stats.sebums >= 1 && totals.stats.terrestzits >= 1 && totals.stats.cthulhus >= 1);
    assert.ok(totals.stats.regenBest >= 1, 'regeneration recorded');
    assert.ok(totals.stats.crystalBest > 0, 'crystalline obstruction recorded');
    assert.ok(totals.stats.phaseReleases >= 1, 'phase releases recorded');
    assert.ok(totals.stats.crystals >= 1, 'crystalline cores broken');
    assert.ok(totals.stats.unholyExtrusion > 0, 'supernatural composite score recorded');
    assert.equal(totals.stats.chapters, 0);
    assert.equal(totals.stats.bosses, 0);
    assert.equal(new Set(played).size, 15, 'fifteen further distinct appointments');

    // ---------------------------------------------------------------------------------------
    // E. The hidden referral, the observer and the endless variant.
    await openClinic();
    const referral = page.getByRole('button', {name: "The Ratfather's Referral"});
    assert.equal(await referral.count(), 1, 'the referral unlocks after six classes');
    await referral.click();
    await dismissTutorial();
    await page.locator('#scopePanel').waitFor({state: 'visible'});
    assert.equal((await session()).mode, 'midnight-clinic:referral');
    await clearCase(page, {noScan: true});
    const referralTotals = await page.evaluate(() => daniInspect.totals());
    assert.ok(referralTotals.achievements.includes('midnight-clinic:ach-ratfather'), 'hidden referral achievement');
    assert.equal(referralTotals.stats.ratfathers, 1);
    assert.equal(await page.evaluate(() => daniInspect.profile().observer), true, 'the Alley Cat Council observer unlocks');
    await openClinic();
    await page.getByRole('button', {name: 'Midnight Endless'}).click();
    await dismissTutorial();
    await page.locator('#scopePanel').waitFor({state: 'visible'});
    const variant = await page.evaluate(() => daniInspect.run().variant);
    assert.ok(variant && variant.label, 'endless draws a procedural variant');
    await settle(page);
    const variantBeforeReload = JSON.stringify(variant);
    await page.reload(); await boot(page);
    const afterReload = await page.evaluate(async () => {
      const {variantFor} = await import('./danny/midnight-clinic/expansion.js');
      const run = daniInspect.run();
      return {derived: variantFor(run.seed, daniInspect.session().mode), stored: run.variant};
    });
    assert.equal(JSON.stringify(afterReload.derived), variantBeforeReload, 'the variant is derived deterministically from the seed');
    assert.ok(afterReload.stored === null || JSON.stringify(afterReload.stored) === variantBeforeReload);
    if (variant.restriction) {
      const techniques = {silver: 'The Silver Loop', spectral: 'Spectral Extractor', cryo: 'Cryo Wand', arcane: 'Arcane Resonator'};
      const locked = page.locator('.tool').filter({has: page.locator('.tool-name', {hasText: techniques[variant.restriction]})});
      assert.equal(await locked.isEnabled(), false, 'the variant restriction disables its instrument');
    }
    await page.locator('#clinicBtn').click();
    await page.getByRole('button', {name: 'Midnight Zen'}).click();
    await dismissTutorial();
    await page.locator('#scopePanel').waitFor({state: 'visible'});
    const zenBefore = await page.evaluate(() => daniInspect.totals());
    await page.locator('#extract').focus();
    await page.keyboard.down('Space'); await page.clock.fastForward(160); await page.keyboard.up('Space');
    await settle(page);
    const zenAfter = await page.evaluate(() => daniInspect.totals());
    assert.equal(zenAfter.stats.total, zenBefore.stats.total, 'Zen does not score');
    assert.equal(zenAfter.xp, zenBefore.xp);
    const zenScope = await page.evaluate(() => daniInspect.scope());
    if (zenScope) assert.equal(zenScope.phaseClosed?.length || 0, 0, 'Zen lifts phase restrictions');

    // ---------------------------------------------------------------------------------------
    // F. Independent checkpoints, 1.0 save compatibility and offline access.
    const baseMode = async target => {
      await target.locator('#modeBtn').click();
      await target.locator('.mode-option').filter({has: target.locator('strong', {hasText: 'Campaign'})}).first().click();
      await target.waitForFunction(() => daniInspect.session().mode === 'base:campaign');
    };
    await baseMode(page);
    const baseAfter = await snapshot(page);
    assert.deepEqual(baseAfter.slots['base:campaign'], baseBefore.slots['base:campaign'], 'base checkpoint preserved');
    const slots = await page.evaluate(async () => Object.keys((await (async () => (await (await import('./danny/storage.js')).openCampaign()).read())()).state.slots).sort());
    assert.ok(slots.includes('midnight-clinic:campaign') && slots.includes('midnight-clinic:endless') && slots.includes('midnight-clinic:zen'));
    assert.equal(baseAfter.stats.midnightChapters, 4);
    await page.locator('#soundBtn').click(); await page.locator('#soundBtn').click(); await settle(page);
    await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('danny-popper');
      request.onsuccess = () => { const tx = request.result.transaction('campaign', 'readwrite');
        tx.objectStore('campaign').put({revision: 9999, broken: true}, 'current'); tx.oncomplete = resolve; tx.onerror = reject; };
    }));
    await page.reload(); await boot(page);
    assert.match(await page.locator('#saveStatus').textContent(), /Recovered/);
    assert.equal((await session()).mode, 'base:campaign');
    assert.equal((await snapshot(page)).stats.midnightChapters, 4, 'midnight progress survives base recovery');
    // A 1.0-shaped save loads, normalizes and still opens the clinic.
    await page.evaluate(async () => {
      const state = {schema: 2, revision: 51, packs: {base: '1.0.0'}, mode: 'base:campaign', tool: 'base:loop',
        slots: {'base:campaign': {encounter: 'base:forecast', seed: 20530, turn: 2, cleared: [0], layers: {}, streak: 1, points: 100}},
        xp: 300, score: 200, achievements: ['base:first-pop'],
        stats: {total: 3, perfects: 1, bestStreak: 2, bosses: 0, chapters: 0, endlessFields: 0, zenFields: 0},
        settings: {sound: true, volume: .65, haptics: false, assist: false, toggle: false, contrast: false, reducedMotion: false}};
      await new Promise((resolve, reject) => { const request = indexedDB.open('danny-popper');
        request.onsuccess = () => { const tx = request.result.transaction('campaign', 'readwrite');
          tx.objectStore('campaign').put(state, 'current'); tx.oncomplete = resolve; tx.onerror = reject; }; });
    });
    await page.reload(); await boot(page);
    const compat = await page.evaluate(() => daniInspect.profile());
    assert.equal(compat.xp, 300);
    assert.equal(compat.settings.intensity, 'midnight', 'clinic settings normalize on a 1.0 save');
    assert.deepEqual(compat.discovered, []);
    await enterClinic();
    assert.equal((await session()).mode, 'midnight-clinic:campaign');
    // Offline: the midnight runtime cache fills and the clinic resumes without a network.
    const cachesNow = await page.evaluate(async () => {
      const names = await caches.keys();
      const cache = names.find(name => name.startsWith('junkdrawer-danny-expansion-'));
      const files = cache ? (await (await caches.open(cache)).keys()).map(request => new URL(request.url).pathname) : [];
      return {files: files.filter(f => f.includes('midnight-clinic')).length, plates: files.filter(f => /midnight-clinic\/.*\.jpg$/.test(f)).length};
    });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {timeout: 20000}).catch(() => {});
    await page.reload(); await boot(page);
    await settle(page);
    const primed = await page.evaluate(async () => {
      const names = await caches.keys();
      const cache = names.find(name => name.startsWith('junkdrawer-danny-expansion-'));
      const files = cache ? (await (await caches.open(cache)).keys()).map(request => new URL(request.url).pathname) : [];
      return {plates: files.filter(f => /midnight-clinic\/.*\.jpg$/.test(f)).length, modules: files.filter(f => /midnight-clinic\/.*\.js$/.test(f)).length};
    });
    assert.ok(primed.plates >= 12, 'all twelve supernatural plates are cached (' + primed.plates + ')');
    assert.ok(primed.modules >= 1, 'the clinic module is cached');
    await context.setOffline(true);
    await page.reload(); await boot(page);
    await page.locator('#clinicPanel').waitFor({state: 'visible'});
    assert.equal((await session()).mode, 'midnight-clinic:campaign', 'the clinic resumes offline');
    await context.setOffline(false);
    // Legacy launch URL.
    await page.goto(base + 'danny-the-pimple-popper.html#legacy');
    await page.waitForFunction(() => location.pathname.endsWith('/dani-the-pimple-popper.html'));
    await boot(page);

    // ---------------------------------------------------------------------------------------
    // G. Canvas fallback, touch and mobile layout.
    const canvasContext = await browser.newContext({viewport: {width: 390, height: 820}, isMobile: true, hasTouch: true});
    await canvasContext.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type === 'webgl2' ? null : original.call(this, type, ...args); };
    });
    const mobile = await canvasContext.newPage();
    mobile.on('pageerror', e => errors.push(e.message));
    await mobile.goto(url); await boot(mobile);
    assert.equal(await mobile.locator('#stage').getAttribute('data-renderer'), 'canvas2d');
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await enterClinic('Open the clinic', mobile);
    await mobile.locator('[data-view="scan"]').click();
    const box = await mobile.locator('#stage').boundingBox();
    const touch = await canvasContext.newCDPSession(mobile);
    await touch.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: box.x + box.width * .4, y: box.y + box.height * .5}]});
    await mobile.waitForTimeout(140);
    for (const [x, y] of [[.3, .4], [.5, .55], [.68, .7]]) {
      await touch.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: box.x + box.width * x, y: box.y + box.height * y}]});
      await mobile.waitForTimeout(70);
    }
    await touch.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    const pixels = await mobile.evaluate(() => {
      const canvas = document.getElementById('effects'), ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 8) painted++;
      return painted;
    });
    assert.ok(pixels > 2000, 'Canvas fallback paints the supernatural imaging overlay');
    await canvasContext.close();

    // ---------------------------------------------------------------------------------------
    // H. Frame budget: base idle versus the final boss under the clinic overlay.
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
    await perf.locator('#clinicBtn').click();
    await perf.getByRole('button', {name: /Open the clinic|Resume the shift/}).click();
    await dismissTutorial(perf);
    await perf.locator('[data-view="scan"]').click();
    await perf.locator('#scanBtn').focus();
    await perf.keyboard.down('Space');
    const scanning = await measure(perf);
    await perf.keyboard.up('Space');
    assert.ok(scanning.p95 < Math.max(140, idle.p95 * 5), 'the clinic keeps a bounded frame budget');
    await perfContext.close();

    assert.deepEqual(errors, [], 'no console or page errors');
    console.log('Passed midnight manifest and lazy loading, ten patient classes, eight materials, four instruments, sixteen encounters and four bosses, all supernatural reservoir primitives, achievements, records, The Ratfather referral, endless variants, zen restrictions, checkpoints, save compatibility, offline cache, legacy URL, WebGL2 and Canvas.');
    console.log('Frame timing (software renderer, DPR 3): base idle median ' + idle.median.toFixed(1) + ' ms / p95 ' + idle.p95.toFixed(1) + ' ms · clinic scan median ' + scanning.median.toFixed(1) + ' ms / p95 ' + scanning.p95.toFixed(1) + ' ms.');
  } finally { await browser.close(); server.close(); }
}
run().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
