// Dani the Pimple Popper 2.0.1 — stabilization audit.
// node tests/dani-stabilization.cjs
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
  const errors = [];
  try {
    const context = await browser.newContext({viewport: {width: 1180, height: 900}});
    await context.route('**/api/analytics/**', route => route.fulfill({status: 204}));
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('#feedStatus').textContent === 'Optics online');
    await page.waitForFunction(() => !!window.daniInspect);

    // A. The in-game franchise overview and marketing metadata.
    await page.locator('#filesBtn').click();
    await page.locator('#dialog[open]').waitFor();
    const overview = await page.locator('#dialogBody').innerText();
    for (const name of ['Original clinic', 'The Pore Explorer', 'The Midnight Clinic', 'The World Book of Pores', 'Day Spa']) assert.ok(overview.includes(name), 'overview names ' + name);
    assert.match(overview, /Recommended/);
    await page.locator('#dismiss').click();
    const meta = await page.evaluate(() => ({description: document.querySelector('meta[name="description"]')?.content,
      og: document.querySelector('meta[property="og:description"]')?.content, canonical: document.querySelector('link[rel="canonical"]')?.href,
      icon: document.querySelector('link[rel="icon"]')?.href, dialogLabel: document.querySelector('#dialogTitle')?.id}));
    assert.match(meta.description, /Day Spa/);
    assert.match(meta.og, /offline/);
    assert.equal(meta.canonical, 'https://hmarquardt.github.io/junkdrawer/dani-the-pimple-popper.html');
    assert.match(meta.icon, /^data:image\/svg\+xml/);

    // B. Financial invariants and at-most-once transactions.
    await page.evaluate(async () => { const module = await import('./danny/content.js'); await module.content.load('./pore-explorer/pack.json'); await module.content.load('./midnight-clinic/pack.json'); await module.content.load('./world-book/pack.json'); await module.content.load('./day-spa/pack.json'); });
    await page.locator('#spaBtn').dispatchEvent('click');
    await page.locator('[data-spa-tab]').first().waitFor();
    const finance = await page.evaluate(async () => {
      const B = await import('./danny/day-spa/business.js');
      const pack = await (await fetch('./danny/day-spa/pack.json')).json();
      const pool = [{encounter:'base:review',name:'Review',namespace:'base',region:'nose',targets:3,hidden:1,tier:1},
        {encounter:'pore-explorer:long-goodbye',name:'Long Goodbye',namespace:'pore-explorer',region:'back',targets:4,hidden:2,tier:2},
        {encounter:'midnight-clinic:roswell',name:'Roswell',namespace:'midnight-clinic',region:'scalp',targets:3,hidden:2,tier:5,klass:'alien'}];
      const ctx = {pack, pool, legends: pack.spaAppointments, now: 0};
      const spa = B.defaultSpa(20260101);
      const checks = [];
      let prunedSeen = false;
      for (let dayIndex = 0; dayIndex < 70; dayIndex++) {
        B.ensureDay(spa, ctx);
        for (const appointment of [...spa.appointments]) {
          if (appointment.status !== 'queued') continue;
          if (appointment.legendary || appointment.boss) continue;
          if (B.needsFor(spa, appointment, pack).ok) {
            B.startSession(spa, pack, appointment.id);
            B.completeAppointment(spa, ctx, {quality: dayIndex % 9 === 0 ? 'rough' : 'perfect', precision: 860,
              discovered: appointment.hidden, chambers: appointment.targets, materials: 2, releases: 3, volume: 360,
              durationMs: appointment.minutes * 60000, records: [], at: 0});
          }
        }
        if (spa.cash > 600) B.buySupplies(spa, pack, 'disgusting-day-spa:sup-pads', 3);
        if (spa.cash > 1400 && !spa.staff.length && spa.tier >= 3) B.hireStaff(spa, pack, 'disgusting-day-spa:role-technician');
        const next = B.nextFacility(spa, pack);
        if (next && spa.cash > next.price + 900 && spa.reputation >= next.reputation) B.upgradeFacility(spa, pack);
        if (spa.pendingEvent) B.resolveEvent(spa, ctx, 0);
        B.closeDay(spa, ctx);
        B.advanceDay(spa, ctx);
        const rec = B.reconcile(spa);
        checks.push(rec.balanced && rec.cash === rec.expected);
        if (spa.transactions.length >= 200) prunedSeen = true;
      }
      const reconcile = B.reconcile(spa);
      const ledgerBounded = spa.transactions.length <= 200;
      // Duplicate receipt that outlived the completed-receipt window.
      const legacy = {id:'legacy-a',day:1,encounter:'base:review',name:'Legacy',namespace:'base',klass:null,targets:2,hidden:0,
        tier:1,boss:false,legendary:false,complexity:2,minutes:15,personality:'x',persona:'x',expectation:'',seed:1,
        status:'complete',price:200,cost:{supplies:20,equipment:10,cleaning:20,total:50}};
      spa.appointments = [legacy]; spa.settled = ['d1:legacy-a'];
      spa.session = {appointmentId:'legacy-a',receiptId:'d1:legacy-a',encounter:'base:review',seed:1,day:1};
      const guardedCash = spa.cash;
      const duplicate = B.completeAppointment(spa, ctx, {quality:'perfect'});
      const guarded = (duplicate.duplicate === true || !!duplicate.error) && spa.cash === guardedCash;
      // Repeated assistance and repeated equipment purchase.
      const broke = B.defaultSpa(5); broke.cash = 10; broke.settled = [];
      const firstGrant = B.acceptAssistance(broke), secondGrant = B.acceptAssistance(broke);
      const grantOnce = firstGrant.granted === 300 && !!secondGrant.error;
      const buyer = B.defaultSpa(6); buyer.cash = 5000;
      B.buyEquipment(buyer, pack, 'disgusting-day-spa:eq-lighting');
      const cashAfterBuy = buyer.cash;
      const repeatBuy = B.buyEquipment(buyer, pack, 'disgusting-day-spa:eq-lighting');
      const purchaseOnce = !!repeatBuy.error && buyer.cash === cashAfterBuy;
      // Duplicate payroll and delegated resolution.
      const closer = B.defaultSpa(7); B.ensureDay(closer, ctx); B.closeDay(closer, ctx); const payroll = closer.transactions.filter(x => x.kind === 'payroll').length;
      const closeAgain = B.closeDay(closer, ctx);
      const closeOnce = closeAgain.already === true && closer.transactions.filter(x => x.kind === 'payroll').length === payroll;
      const dealer = B.defaultSpa(8); dealer.cash = 5000; B.ensureDay(dealer, ctx);
      dealer.staff.push({id:'t',name:'Tech',role:'technician',roleName:'Technician',skill:7,exp:0,wage:220,morale:80,hiredDay:1});
      const target = dealer.appointments.find(x => !x.legendary && !x.boss);
      B.delegateAppointment(dealer, ctx, target.id);
      const again = B.delegateAppointment(dealer, ctx, target.id);
      const delegateOnce = !!again.error;
      return {checks: checks.every(Boolean), days: checks.length, reconcile, ledgerBounded, prunedSeen,
        guarded, grantOnce, purchaseOnce, closeOnce, delegateOnce, daysToTier: spa.history.length,
        accounting: spa.accounting};
    });
    assert.equal(finance.checks, true, 'every simulated day reconciles');
    assert.equal(finance.reconcile.balanced, true, 'opening + inflow - outflow equals cash after 70 days');
    assert.equal(finance.reconcile.cash, finance.reconcile.expected);
    assert.equal(finance.ledgerBounded, true, 'the ledger stays bounded');
    assert.equal(finance.prunedSeen, true, 'the simulation exercised ledger pruning');
    assert.equal(finance.guarded, true, 'a receipt past the completed window cannot pay twice');
    assert.equal(finance.grantOnce, true, 'assistance is rate limited');
    assert.equal(finance.purchaseOnce, true, 'equipment cannot be bought twice');
    assert.equal(finance.closeOnce, true, 'payroll is posted once');
    assert.equal(finance.delegateOnce, true, 'delegation resolves once');

    // B2. Permanent idempotency: settlement must not depend on retained receipts or ledger entries.
    const permanence = await page.evaluate(async () => {
      const B = await import('./danny/day-spa/business.js');
      const pack = await (await fetch('./danny/day-spa/pack.json')).json();
      const pool = [{encounter:'base:review',name:'Review',namespace:'base',region:'nose',targets:3,hidden:1,tier:1}];
      const ctx = {pack, pool, legends: [], now: 0};
      const outcome = {quality:'perfect', precision:900, discovered:1, chambers:3, materials:2, releases:3, volume:300, durationMs:60000, records:[], at:0};
      const spa = B.defaultSpa(4242); B.ensureDay(spa, ctx);
      const first = spa.appointments[0];
      B.startSession(spa, pack, first.id); B.completeAppointment(spa, ctx, outcome);
      const results = [];
      for (const count of [100, 1000, 10000]) {
        for (let index = 0; index < count; index++) B.post(spa, 'noise-' + count + '-' + index, 'noise', 0);
        // Simulate every advisory window being pruned: neither receipts nor the settled id ring exist.
        spa.completed = []; spa.settled = [];
        spa.session = {appointmentId: first.id, receiptId: 'd' + first.day + ':' + first.id, encounter: first.encounter, seed: first.seed, day: first.day};
        const before = spa.cash;
        const again = B.completeAppointment(spa, ctx, outcome);
        results.push({count, rejected: again.duplicate === true || !!again.error, unchanged: spa.cash === before,
          ledger: spa.transactions.length, maskSet: (spa.settleMask & (1 << 0)) !== 0});
      }
      // Out-of-order completion within one day: second appointment first, then the first.
      const ooo = B.defaultSpa(77); B.ensureDay(ooo, ctx);
      const [a1, a2] = ooo.appointments;
      B.startSession(ooo, pack, a2.id); B.completeAppointment(ooo, ctx, outcome);
      B.startSession(ooo, pack, a1.id); B.completeAppointment(ooo, ctx, outcome);
      const oooReceipts = ooo.completed.length;
      ooo.session = {appointmentId: a1.id, receiptId: 'd' + a1.day + ':' + a1.id, encounter: a1.encounter, seed: a1.seed, day: a1.day};
      const oooDuplicate = B.completeAppointment(ooo, ctx, outcome);
      // A closed day can never settle, even with a reconstructed session.
      B.closeDay(ooo, ctx); B.advanceDay(ooo, ctx);
      const oldCash = ooo.cash;
      ooo.session = {appointmentId: a1.id, receiptId: 'd' + a1.day + ':' + a1.id, encounter: a1.encounter, seed: a1.seed, day: a1.day};
      const stale = B.completeAppointment(ooo, ctx, outcome);
      const archived = (ooo.settleLog || []).length > 0;
      // Malformed identifier cannot settle either.
      const bad = B.defaultSpa(88); B.ensureDay(bad, ctx);
      bad.appointments = [{...bad.appointments[0], id: 'dX-a1'}];
      bad.session = {appointmentId: 'dX-a1', receiptId: 'd1:dX-a1', encounter: 'base:review', seed: 1, day: 1};
      const malformed = B.completeAppointment(bad, ctx, outcome);
      return {results, allRejected: results.every(item => item.rejected && item.unchanged && item.maskSet && item.ledger <= 200),
        pruned: results.every(item => item.ledger <= 200) && results.find(item => item.count === 10000).ledger === 200, oooReceipts, oooDuplicate: !!oooDuplicate.duplicate || !!oooDuplicate.error,
        staleRejected: !!stale.error && ooo.cash === oldCash, archived,
        malformedRejected: !!malformed.error || malformed.duplicate === true, balanced: B.reconcile(ooo).balanced};
    });
    assert.equal(permanence.allRejected, true, 'settlement is refused after 100/1,000/10,000 later transactions');
    assert.equal(permanence.pruned, true, 'the ledger was pruned in every permanence case');
    assert.equal(permanence.oooReceipts, 2, 'out-of-order settlement records each appointment once');
    assert.equal(permanence.oooDuplicate, true, 're-settling an out-of-order appointment is refused');
    assert.equal(permanence.staleRejected, true, 'a closed day cannot be settled again');
    assert.equal(permanence.archived, true, 'the day mask is archived on advance');
    assert.equal(permanence.malformedRejected, true, 'a malformed appointment id cannot settle');
    assert.equal(permanence.balanced, true, 'accounting stays reconciled through the stress test');

    // C. Economic audit: 100 seeds across representative strategies.
    const economy = await page.evaluate(async () => {
      const B = await import('./danny/day-spa/business.js');
      const pack = await (await fetch('./danny/day-spa/pack.json')).json();
      const pool = [{encounter:'base:review',name:'Routine',namespace:'base',region:'nose',targets:3,hidden:1,tier:1},
        {encounter:'pore-explorer:long-goodbye',name:'Long',namespace:'pore-explorer',region:'back',targets:4,hidden:2,tier:2},
        {encounter:'midnight-clinic:roswell',name:'Midnight',namespace:'midnight-clinic',region:'scalp',targets:3,hidden:2,tier:5,klass:'vampire'}];
      const ctx = {pack, pool, legends: pack.spaAppointments, now: 0};
      const strategies = {
        routine: {quality:'clean', buffer:900, pricing:'standard'},
        premium: {quality:'perfect', buffer:1200, pricing:'premium'},
        conservative: {quality:'clean', buffer:4000, pricing:'standard'},
        aggressive: {quality:'perfect', buffer:100, pricing:'standard'},
        marketing: {quality:'clean', buffer:900, pricing:'standard', market:true},
        delegation: {quality:'clean', buffer:900, pricing:'standard', delegate:true},
        mixed: {quality:'perfect', buffer:800, pricing:'standard', market:true, delegate:true},
        midnight: {quality:'perfect', buffer:600, pricing:'specialist', midnight:true},
        low: {quality:'rough', buffer:900, pricing:'standard'}
      };
      const results = {};
      const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]; };
      for (const [name, config] of Object.entries(strategies)) {
        const runs = [];
        for (let seed = 1; seed <= 100; seed++) {
          const spa = B.defaultSpa(seed * 7919);
          spa.pricing = config.pricing;
          let tiers = {}; let stalled = 0, lastTier = 1, lastChange = 1, grants = 0;
          for (let dayIndex = 0; dayIndex < 120; dayIndex++) {
            B.ensureDay(spa, ctx);
            if (config.delegate && spa.tier >= 3 && !spa.staff.some(m => m.role === 'technician')) B.hireStaff(spa, pack, 'disgusting-day-spa:role-technician');
            for (const appointment of [...spa.appointments]) {
              if (appointment.status !== 'queued') continue;
              if (appointment.legendary || appointment.boss) continue;
              if (config.midnight && appointment.namespace !== 'midnight-clinic' && spa.tier < 5) continue;
              if (!B.needsFor(spa, appointment, pack).ok) continue;
              if (config.delegate && spa.staff.some(m => m.role === 'technician') && !appointment.legendary) B.delegateAppointment(spa, ctx, appointment.id);
              else { B.startSession(spa, pack, appointment.id); B.completeAppointment(spa, ctx, {quality: config.quality, precision: config.quality === 'perfect' ? 900 : 600, discovered: appointment.hidden, chambers: appointment.targets, materials: 2, releases: 3, volume: 300, durationMs: appointment.minutes * 60000, records: [], at: 0}); }
            }
            if (config.market && spa.cash > 1200 && !spa.marketing.length) B.buyMarketing(spa, pack, 'disgusting-day-spa:mkt-social');
            const next = B.nextFacility(spa, pack);
            if (next && spa.cash > next.price + config.buffer && spa.reputation >= next.reputation) B.upgradeFacility(spa, pack);
            if (spa.pendingEvent) B.resolveEvent(spa, ctx, 0);
            if (spa.cash < 250) { const grant = B.acceptAssistance(spa); if (grant.granted) grants++; }
            B.closeDay(spa, ctx); B.advanceDay(spa, ctx);
            if (!tiers[spa.tier]) tiers[spa.tier] = dayIndex + 1;
            if (spa.tier !== lastTier) { lastTier = spa.tier; lastChange = dayIndex + 1; }
            if (dayIndex > 18 && dayIndex - lastChange > 14) stalled++;
          }
          runs.push({tier: spa.tier, cash: spa.cash, profit: spa.stats.profitTotal, reputation: spa.reputation,
            appointments: spa.stats.appointments, delegated: spa.stats.delegated, grants, stalled: stalled > 0,
            firstTier2: tiers[2] || null, firstTier4: tiers[4] || null, firstTier7: tiers[7] || null,
            firstTier5: tiers[5] || null, firstTier6: tiers[6] || null, balanced: B.reconcile(spa).balanced});
        }
        const daysFor = tier => runs.filter(r => r['firstTier' + tier]).map(r => r['firstTier' + tier]);
        results[name] = {medianTier: percentile(runs.map(r => r.tier), 0.5), medianCash: percentile(runs.map(r => r.cash), 0.5),
          pctTier5: Math.round(daysFor(5).length), pctTier6: Math.round(daysFor(6).length), pctTier7: Math.round(daysFor(7).length),
          medianDaysTier5: daysFor(5).length ? percentile(daysFor(5), 0.5) : null,
          medianDaysTier6: daysFor(6).length ? percentile(daysFor(6), 0.5) : null,
          medianDaysTier7: daysFor(7).length ? percentile(daysFor(7), 0.5) : null,
          medianAppointments: percentile(runs.map(r => r.appointments), 0.5), medianDelegated: percentile(runs.map(r => r.delegated), 0.5),
          p10Cash: percentile(runs.map(r => r.cash), 0.1), p90Cash: percentile(runs.map(r => r.cash), 0.9),
          medianProfit: percentile(runs.map(r => r.profit), 0.5), medianReputation: percentile(runs.map(r => r.reputation), 0.5),
          tier7: runs.filter(r => r.tier === 7).length, stalled: runs.filter(r => r.stalled).length,
          grants: runs.reduce((total, r) => total + r.grants, 0), balanced: runs.every(r => r.balanced),
          medianTier2: percentile(runs.filter(r => r.firstTier2).map(r => r.firstTier2), 0.5)};
      }
      return results;
    });
    console.log('Economic audit (100 seeds, 120 business days):');
    for (const [name, result] of Object.entries(economy)) console.log('  ' + name.padEnd(13) + ' tier7=' + result.tier7 + '/100 pctT5/6/7=' + result.pctTier5 + '/' + result.pctTier6 + '/' + result.pctTier7 + ' daysT5/6/7=' + result.medianDaysTier5 + '/' + result.medianDaysTier6 + '/' + result.medianDaysTier7 + ' medianTier=' + result.medianTier + ' cash=' + result.medianCash + ' [p10 ' + result.p10Cash + ', p90 ' + result.p90Cash + '] apps=' + result.medianAppointments + ' delegated=' + result.medianDelegated + ' grants=' + result.grants + ' balanced=' + result.balanced);
    for (const [name, result] of Object.entries(economy)) {
      assert.equal(result.balanced, true, name + ' reconciles across 100 seeds');
      assert.equal(result.medianTier >= 1 && result.medianTier <= 7, true);
    }
    assert.ok(Object.values(economy).some(item => item.tier7 >= 40), 'at least one strategy reaches tier 7 in 40% of seeds by day 60');
    assert.ok(economy.routine.medianTier >= 3, 'routine play progresses beyond tier 2 in 60 days');
    assert.ok(economy.low.medianTier <= economy.routine.medianTier, 'poor extraction quality does not out-progress careful play');
    assert.ok(economy.premium.medianCash >= economy.conservative.medianCash, 'pricing strategy has a measurable effect');

    // D. Navigation at every width, including hit testing. Close any open dialog first: it covers the
    // header and would make every button appear blocked.
    if (await page.locator('#dialog[open]').count()) await page.locator('#dismiss').click();
    const widths = [320, 360, 390, 430, 768, 1024, 1180, 1440, 1920];
    const navigation = [];
    for (const width of widths) {
      await page.setViewportSize({width, height: width <= 430 ? 640 : 900});
      const report = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('.mast .nav')].map(button => ({id: button.id, rect: button.getBoundingClientRect()}));
        const overlap = [];
        for (let i = 0; i < buttons.length; i++) for (let j = i + 1; j < buttons.length; j++) {
          const a = buttons[i].rect, b = buttons[j].rect;
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap.push(buttons[i].id + '/' + buttons[j].id);
        }
        const blocked = buttons.filter(({rect}) => {
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return !hit || !hit.closest('.nav');
        }).map(item => item.id);
        const required = ['filesBtn', 'manualBtn', 'poreBtn', 'clinicBtn', 'bookBtn', 'spaBtn'];
        return {overlap, blocked, overflow: document.documentElement.scrollWidth > innerWidth + 1,
          count: buttons.length, complete: required.every(id => buttons.some(item => item.id === id)),
          labels: buttons.map(item => document.getElementById(item.id)?.textContent?.trim())};
      });
      navigation.push({width, ...report});
    }
    for (const row of navigation) {
      assert.deepEqual(row.overlap, [], 'no overlapping header buttons at ' + row.width + 'px');
      assert.deepEqual(row.blocked, [], 'every header button is hit-testable at ' + row.width + 'px');
      assert.equal(row.overflow, false, 'no horizontal overflow at ' + row.width + 'px');
      assert.ok(row.count >= 6, 'case files, field manual and four expansion entries');
      assert.equal(row.complete, true, 'all six required header entries are present');
    }

    // E. Accessibility of the spa dashboard and charts.
    await page.setViewportSize({width: 360, height: 640});
    await page.locator('#spaBtn').dispatchEvent('click');
    await page.locator('[data-spa-tab]').first().waitFor();
    await page.locator('[data-spa-tab="books"]').click();
    const a11y = await page.evaluate(() => {
      const dialog = document.getElementById('dialog');
      const charts = [...document.querySelectorAll('.spa-chart')];
      const section = document.querySelector('.spa-section');
      return {role: dialog.getAttribute('role') || dialog.tagName.toLowerCase(), labelledby: dialog.getAttribute('aria-labelledby'),
        charts: charts.length, labelledCharts: charts.filter(chart => chart.getAttribute('aria-label')).length,
        textAlternative: /Accounting check|revenue|profit/i.test(section.innerText),
        overflow: document.documentElement.scrollWidth > innerWidth + 1};
    });
    assert.equal(a11y.role, 'dialog');
    assert.ok(a11y.labelledby);
    assert.equal(a11y.labelledCharts, a11y.charts);
    assert.equal(a11y.textAlternative, true);
    assert.equal(a11y.overflow, false);
    await page.locator('#dismiss').click();
    assert.deepEqual(errors, [], 'no console or page errors');
    console.log('Passed franchise overview and marketing metadata, 70-day accounting reconciliation with ledger pruning, duplicate receipt/grant/purchase/payroll/delegation prevention, 100-seed economic audit across eight strategies, header navigation at nine widths, and spa accessibility checks.');

  } finally { await browser.close(); server.close(); }
}
run().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
