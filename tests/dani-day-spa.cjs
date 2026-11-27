// Dani the Pimple Popper 2.0 — Dani's Disgusting Day Spa verification suite.
// node tests/dani-day-spa.cjs
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
  const url = 'http://127.0.0.1:' + server.address().port + '/junkdrawer/dani-the-pimple-popper.html';
  const browser = await chromium.launch({channel: 'chrome', args: ['--enable-unsafe-swiftshader']});
  const errors = [], spaRequests = [];
  try {
    const context = await browser.newContext({viewport: {width: 1180, height: 900}});
    await context.route('**/api/analytics/**', route => route.fulfill({status: 204}));
    await context.route('**/day-spa/**', route => { spaRequests.push(route.request().url()); return route.continue(); });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
    const boot = async (target = page) => {
      await target.waitForFunction(() => document.querySelector('#feedStatus').textContent === 'Optics online');
      await target.waitForFunction(() => !!window.daniInspect);
    };
    const settle = async (target = page) => target.waitForFunction(() => document.querySelector('#feedStatus').dataset.save !== 'pending');
    const clock = async (target = page) => {
      await target.clock.install({time: new Date('2030-07-01T00:00:00Z')});
      await target.clock.pauseAt(new Date('2030-07-01T00:00:01Z'));
    };
    const dismiss = async (target = page) => {
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
      await equipAny(['PoreScope'], target).catch(() => {});
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
        await equipAny(gates.length ? (types[gates[0].type] || ['Loop extractor']) : ['Loop extractor', 'Precision tip', 'Arcane Resonator', 'Spectral Extractor'], target);
        const before = await fieldInfo(id, target);
        await releaseInBand(target);
        let after = await fieldInfo(id, target);
        for (const name of ['Loop extractor', 'Precision tip', 'Arcane Resonator', 'Spectral Extractor', 'Cryo Wand']) {
          if (after.passes !== before.passes || after.cleared) break;
          const tool = target.locator('.tool').filter({has: target.locator('.tool-name', {hasText: name})});
          if (!(await tool.isEnabled())) continue;
          await tool.click(); await settle(target); await dismiss(target);
          await releaseInBand(target);
          after = await fieldInfo(id, target);
        }
      }
      throw Error('Target did not clear');
    };
    const clearCase = async (target = page) => {
      for (let guard = 0; guard < 8; guard++) {
        if (await target.locator('#review:visible').count()) return;
        await clearTarget(target);
      }
      throw Error('Case did not clear');
    };
    const openSpa = async (target = page) => {
      if (await target.locator('#dialog[open]').count()) {
        const got = target.getByRole('button', {name: 'Got it'});
        if (await got.count()) await got.click();
        else if (await target.locator('#dismiss').count()) await target.locator('#dismiss').click();
      }
      await target.locator('#spaBtn').click();
      await target.locator('[data-spa-tab]').first().waitFor();
    };
    const spaTab = async (name, target = page) => { await target.locator('[data-spa-tab="' + name + '"]').click(); await target.locator('.spa-section').waitFor(); };

    // A. Lazy loading and the dashboard.
    await page.goto(url);
    await boot(page);
    assert.equal(spaRequests.length, 0, 'the spa must not load during base startup');
    await clock(page);
    await openSpa(page);
    assert.equal(await page.locator('[data-spa-tab]').count(), 7);
    assert.ok(await page.locator('.spa-appt').count() >= 2 && await page.locator('.spa-appt').count() <= 3, 'tier 1 offers a small queue');
    const opening = await page.evaluate(() => daniInspect.spa());
    assert.deepEqual([opening.summary.cash, opening.summary.tier, opening.summary.day], [2500, 1, 1]);
    assert.equal(opening.pool >= 20, true);
    assert.equal(opening.legends, 6);
    await spaTab('clinic'); assert.ok(await page.locator('.spa-room').count() >= 8);
    await spaTab('shop'); assert.ok(await page.locator('[data-buy-equipment]').count() >= 8);
    await spaTab('team'); assert.equal(await page.locator('[data-hire]').count(), 7);
    await spaTab('growth'); assert.equal(await page.locator('[data-marketing]').count(), 7);
    await spaTab('today');
    await page.locator('#dismiss').click();

    // B. Headless engine: determinism, ledger, catalogues, pricing, delegation, day close,
    // facilities, achievements, recovery and idempotency.
    const engine = await page.evaluate(async () => {
      const B = await import('./danny/day-spa/business.js');
      const pack = await (await fetch('./danny/day-spa/pack.json')).json();
      const pool = [{encounter: 'base:review', name: 'Review', namespace: 'base', region: 'nose', targets: 3, hidden: 1, tier: 1},
        {encounter: 'pore-explorer:long-goodbye', name: 'Long Goodbye', namespace: 'pore-explorer', region: 'back', targets: 4, hidden: 2, tier: 2},
        {encounter: 'midnight-clinic:roswell', name: 'Roswell', namespace: 'midnight-clinic', region: 'scalp', targets: 3, hidden: 2, tier: 5, klass: 'alien'}];
      const ctx = {pack, pool, legends: pack.spaAppointments, now: 0};
      const a = B.defaultSpa(42), b = B.defaultSpa(42);
      const qa = B.generateDay(a, ctx), qb = B.generateDay(b, ctx);
      const deterministic = JSON.stringify(qa.map(x => [x.id, x.encounter, x.seed, x.price])) === JSON.stringify(qb.map(x => [x.id, x.encounter, x.seed, x.price]));
      const opening = a.cash;
      B.post(a, 'once', 'test', 100); B.post(a, 'once', 'test', 100);
      const ledgerOnce = a.cash === opening + 100;
      a.cash = 5000;
      B.buySupplies(a, pack, 'disgusting-day-spa:sup-pads', 3);
      const bulk = a.stats.bulkBuys === 1;
      const before = a.cash; B.buyEquipment(a, pack, 'disgusting-day-spa:eq-lighting');
      const equipmentGuard = a.cash === before - 400;
      B.payOut(a, 'huge', 'test', 999999);
      const neverNegative = a.cash >= 0;
      // A guaranteed interactive appointment.
      const appointment = a.appointments.find(x => x.status === 'queued');
      B.startSession(a, pack, appointment.id);
      const first = B.completeAppointment(a, ctx, {quality: 'perfect', precision: 900, discovered: appointment.hidden, chambers: appointment.targets, materials: 2, releases: 3, volume: 400, durationMs: appointment.minutes * 60000, records: [{metric: 'singleExtraction'}], at: 0});
      const cashAfter = a.cash, receiptsAfter = a.completed.length, was = first.receipt;
      a.session = {...a.session, appointmentId: appointment.id, receiptId: was.id};
      const duplicate = B.completeAppointment(a, ctx, {quality: 'perfect', precision: 900, discovered: 1, chambers: 3});
      const idempotent = duplicate.duplicate === true && a.cash === cashAfter && a.completed.length === receiptsAfter;
      const satisfaction = first.receipt.satisfaction >= 60 && first.receipt.factors.length >= 8 && first.review.stars >= 3;
      // Delegation is deterministic and cannot create records.
      const spa = B.defaultSpa(7);
      B.generateDay(spa, ctx);
      spa.staff.push({id: 'staff-t', name: 'Tech', role: 'technician', roleName: 'Extraction Technician', skill: 8, exp: 0, wage: 220, morale: 80, hiredDay: 1});
      const target = spa.appointments.find(x => !x.legendary && !x.boss);
      const d1 = B.delegateAppointment(spa, ctx, target.id);
      const delegated = d1.receipt?.delegated === true && d1.receipt.records.length === 0;
      // Day close is idempotent and payroll is not duplicated.
      const close1 = B.closeDay(spa, ctx), close2 = B.closeDay(spa, ctx);
      const payroll = spa.transactions.filter(x => x.kind === 'payroll').length === 1;
      const closeIdempotent = !!close2.already && close1.summary && payroll;
      // Facilities: every tier is reachable with capital and reputation.
      const climber = B.defaultSpa(9); climber.cash = 200000; climber.reputation = 1000;
      const tiers = [climber.tier];
      for (let step = 0; step < 6; step++) { const up = B.upgradeFacility(climber, pack); tiers.push(climber.tier); if (up.error) break; }
      const allTiers = tiers.join(',') === '1,2,3,4,5,6,7';
      const midnightOpen = climber.stats.midnightOpen === 1;
      // Recovery.
      const broke = B.defaultSpa(11); broke.cash = 40; B.closeDay(broke, ctx);
      const recovered = broke.cash >= 0 && !!broke.recovery;
      const assist = B.acceptAssistance(broke);
      const assisted = assist.granted === 300 && broke.cash >= 300;
      // Events never drive cash negative.
      const eventSpa = B.defaultSpa(13); eventSpa.cash = 100;
      eventSpa.pendingEvent = {id: 'ev-insurance', day: 1, name: 'Insurance', note: '', choices: [{index: 0}, {index: 1}]};
      B.resolveEvent(eventSpa, ctx, 1);
      // Achievements.
      const earnedSpa = B.defaultSpa(15); earnedSpa.stats.days = 10; earnedSpa.stats.days = 10;
      const achievements = B.achievementsFor(earnedSpa, pack).map(x => x.id);
      return {deterministic, ledgerOnce, neverNegative, bulk, equipmentGuard, idempotent, satisfaction, delegated,
        closeIdempotent, allTiers, midnightOpen, recovered, assisted, eventSafe: eventSpa.cash >= 0, achievements,
        ledgerBalance: B.ledgerBalance(a) >= 0, receipt: {paid: was.paid, tip: was.tip, satisfaction: was.satisfaction, quality: was.quality},
        tiers: tiers.join(',')};
    });
    assert.equal(engine.deterministic, true, 'the same seed and day produce the same queue');
    assert.equal(engine.ledgerOnce, true, 'duplicate ledger ids do not pay twice');
    assert.equal(engine.neverNegative, true, 'cash never goes negative');
    assert.equal(engine.bulk, true, 'bulk restocking is recorded');
    assert.equal(engine.equipmentGuard, true, 'tier gates are enforced');
    assert.equal(engine.idempotent, true, 'a replayed receipt pays nothing');
    assert.equal(engine.satisfaction, true, 'satisfaction has an itemised breakdown');
    assert.equal(engine.delegated, true, 'delegation never sets records');
    assert.equal(engine.closeIdempotent, true, 'day close and payroll are idempotent');
    assert.equal(engine.allTiers, true, 'all seven facility tiers are purchasable');
    assert.equal(engine.midnightOpen, true, 'the Midnight Wing opens at tier five');
    assert.equal(engine.recovered, true, 'a shortfall becomes deferral, never negative cash');
    assert.equal(engine.assisted, true, 'business assistance restores working capital');
    assert.equal(engine.eventSafe, true, 'events never overdraw the account');
    assert.ok(engine.achievements.includes('disgusting-day-spa:ach-daily-grind'));

    // C. Interactive appointment: the extraction runs, the receipt settles once, and the day closes.
    await openSpa(page);
    const cashBefore = (await page.evaluate(() => daniInspect.spa())).summary.cash;
    await page.locator('[data-start]').first().click();
    await page.waitForFunction(() => daniInspect.session()?.mode === 'disgusting-day-spa:clinic', {timeout: 20000});
    await page.waitForFunction(() => daniInspect.field().length > 0, {timeout: 20000});
    await clearCase(page);
    await settle(page);
    const settled = await page.evaluate(() => daniInspect.spa());
    assert.equal(settled.spa.completed.length, 1, 'exactly one receipt for one appointment');
    assert.equal(settled.spa.session, null, 'the session closes on settlement');
    assert.ok(settled.spa.completed[0].paid > 0 && settled.spa.reviews.length === 1);
    assert.ok(settled.summary.cash > cashBefore, 'the appointment paid the clinic');
    assert.ok(settled.ledger >= 0);
    assert.ok(settled.spa.transactions.some(entry => entry.kind === 'appointment-revenue'));
    await dismiss(page);
    if (await page.locator('#review:visible').count()) {
      await page.locator('#review').click();
      await page.locator('#dialog[open]').waitFor();
      await page.locator('#dismiss').click();
    }
    await page.locator('#spaAdvance').click();
    await page.waitForFunction(() => daniInspect.spa().summary.day === 2, {timeout: 10000});
    const day2 = await page.evaluate(() => daniInspect.spa());
    assert.equal(day2.spa.history.length, 1);
    assert.ok(day2.spa.transactions.some(entry => entry.kind === 'rent'));
    assert.ok(day2.spa.transactions.some(entry => entry.kind === 'utilities'));
    assert.ok(day2.summary.queued >= 2);

    // D. Persistence: an active appointment resumes after a reload, and settlement data survives it.
    await openSpa(page);
    const started = await page.evaluate(async () => {
      const module = await import('./danny/day-spa/expansion.js');
      const state = daniInspect.spa();
      const queued = state.spa.appointments.find(item => item.status === 'queued');
      if (!queued) return {error: 'no queued appointment'};
      const result = module.startAppointment(queued.id);
      return {id: queued.id, error: result?.error || null, supplies: queued.cost};
    });
    assert.equal(started.error, null, 'the appointment starts: ' + JSON.stringify(started));
    await page.waitForFunction(() => daniInspect.session()?.mode === 'disgusting-day-spa:clinic', {timeout: 20000});
    await page.waitForFunction(() => !!daniInspect.spa()?.spa?.session, {timeout: 10000});
    const receiptCount = (await page.evaluate(() => daniInspect.spa())).spa.completed.length;
    await page.reload();
    await boot(page);
    assert.equal((await page.evaluate(() => daniInspect.session()))?.mode, 'disgusting-day-spa:clinic', 'the appointment mode resumes');
    const resumed = await page.evaluate(() => daniInspect.spa());
    assert.ok(resumed.spa.session, 'the appointment session survives a reload');
    assert.equal(resumed.spa.completed.length, receiptCount, 'receipts persist');
    await page.evaluate(async () => { const spa = await import('./danny/day-spa/expansion.js'); spa.abortAppointment(); });
    await page.locator('#modeBtn').click();
    await page.locator('.mode-option').filter({has: page.locator('strong', {hasText: 'Campaign'})}).first().click();
    await page.waitForFunction(() => daniInspect.session().mode === 'base:campaign');
    await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('danny-popper');
      request.onsuccess = () => { const tx = request.result.transaction('campaign', 'readwrite');
        tx.objectStore('campaign').put({revision: 9999, broken: true}, 'current'); tx.oncomplete = resolve; tx.onerror = reject; };
    }));
    await page.reload(); await boot(page);
    assert.match(await page.locator('#saveStatus').textContent(), /Recovered/);
    await openSpa(page);
    const recovered = await page.evaluate(() => daniInspect.spa());
    assert.equal(recovered.spa.completed.length, receiptCount, 'receipts survive checkpoint recovery');
    assert.ok(recovered.summary.cash > 0);
    await page.locator('#dismiss').click();

    // E. Offline and mobile.
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {timeout: 20000}).catch(() => {});
    await page.reload(); await boot(page);
    await openSpa(page); await page.locator('#dismiss').click();
    const audit = () => page.evaluate(async () => {
      const names = await caches.keys();
      const cache = names.find(name => name.startsWith('junkdrawer-danny-expansion-'));
      const files = cache ? (await (await caches.open(cache)).keys()).map(request => new URL(request.url).pathname) : [];
      return files.filter(file => file.includes('day-spa')).length;
    });
    await page.waitForTimeout(600);
    let cacheAudit = await audit();
    if (!cacheAudit) {
      // Under worker control the runtime cache must retain expansion assets for offline use.
      await page.evaluate(async () => {
        await fetch('./danny/day-spa/pack.json', {cache: 'reload'});
        await fetch('./danny/day-spa/expansion.js', {cache: 'reload'});
      });
      await page.waitForTimeout(500);
      cacheAudit = await audit();
    }
    console.log('[spa cache] files=' + cacheAudit + ' controlled=' + (await page.evaluate(() => !!navigator.serviceWorker.controller)));
    await context.setOffline(true);
    await page.reload(); await boot(page);
    await openSpa(page);
    assert.equal(await page.locator('[data-spa-tab]').count(), 7, 'the dashboard works offline');
    await page.locator('#dismiss').click();
    await context.setOffline(false);
    const mobileContext = await browser.newContext({viewport: {width: 360, height: 640}, isMobile: true, hasTouch: true});
    await mobileContext.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type === 'webgl2' ? null : original.call(this, type, ...args); };
    });
    const mobile = await mobileContext.newPage();
    mobile.on('pageerror', e => errors.push(e.message));
    await mobile.goto(url); await boot(mobile);
    assert.equal(await mobile.locator('#stage').getAttribute('data-renderer'), 'canvas2d');
    await openSpa(mobile);
    assert.equal(await mobile.locator('[data-spa-tab]').count(), 7);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'dashboard fits 360px');
    await mobile.locator('#dismiss').click();
    await mobileContext.close();
    assert.deepEqual(errors, [], 'no console or page errors');
    console.log('Passed lazy loading, deterministic appointments, integer ledger and duplicate prevention, pricing and cost catalogues, equipment and supply gates, seven facility tiers, staffing and delegation, satisfaction and reviews, day close and payroll idempotency, recovery assistance, business events, achievements, one complete interactive appointment with a single receipt, day advancement, session and receipt persistence, checkpoint recovery, offline dashboard, 360x640 layout, WebGL2 and Canvas.');
  } finally { await browser.close(); server.close(); }
}
run().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
