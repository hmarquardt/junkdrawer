// Dani the Pimple Popper 2.0 — Dani's Disgusting Day Spa.
// Management presentation and the appointment-session bridge. The extraction engine is untouched: an
// appointment hands an encounter and a seed to the existing replay path, waits for the unified
// telemetry result, and then settles one immutable receipt through business.js.
import {content} from '../content.js';
import * as business from './business.js';
import * as world from '../world-book/expansion.js';
import {earnAchievements} from '../progression.js';

const NS = 'disgusting-day-spa';
export const SPA_MODE = NS + ':clinic';
const esc = text => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const pb = value => Math.round(Number(value) || 0).toLocaleString('en-US') + ' PB';
const pct = value => Math.round(Number(value) || 0) + '%';
let api = null, mounted = false, panel = null, cache = null, tab = 'today';
// A new business gets a seed once, then keeps it forever: queues are reproducible from that seed.
const state = (profile = api.profile()) => {
  if (!profile.spa) profile.spa = business.normalizeSpa(business.defaultSpa(((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0)));
  else profile.spa = business.normalizeSpa(profile.spa);
  return profile.spa;
};

// The pool is built from installed content once per load. Tier gates keep supernatural cases in the
// Midnight Wing and legendary cases in the endgame; the engine itself never reads content.
function buildContext() {
  const pack = {
    facilities: content.list('facilities'), spaEquipment: content.list('spaEquipment'), supplies: content.list('supplies'),
    staffRoles: content.list('staffRoles'), staffNames: content.list('staffNames').map(item => item.name),
    personalities: content.list('personalities'), marketing: content.list('marketing'), businessEvents: content.list('businessEvents'),
    spaAppointments: content.list('spaAppointments'), reviewLines: content.list('reviewLines'), difficulty: content.list('difficulty'),
    spaAchievements: content.list('spaAchievements')
  };
  const tierFor = namespace => ({base: 1, 'pore-explorer': 2, 'midnight-clinic': 5, 'world-book-of-pores': 6}[namespace] || 1);
  const pool = [];
  for (const encounter of content.list('encounters')) {
    const namespace = String(encounter.id).split(':')[0];
    if (!['base', 'pore-explorer', 'midnight-clinic', 'world-book-of-pores'].includes(namespace)) continue;
    if (/ratfather-referral/.test(encounter.id)) continue;
    let reservoir = null;
    try { reservoir = content.get('reservoirs', encounter.reservoir); } catch { reservoir = null; }
    let klass = null;
    try { klass = encounter.patient ? content.get('patients', encounter.patient).klass : null; } catch { klass = null; }
    let region = encounter.region;
    try { region = content.get('regions', encounter.region).name; } catch { region = encounter.region; }
    pool.push({encounter: encounter.id, name: encounter.name, namespace, region, targets: encounter.count,
      hidden: reservoir?.hidden || 0, tier: tierFor(namespace), klass, boss: !!encounter.boss,
      phase: !!reservoir?.phase});
  }
  return {pack, pool, legends: pack.spaAppointments, now: 0};
}
const context = () => cache || (cache = buildContext());

function syncAchievements(profile = api.profile()) {
  const spa = state(profile), pack = context().pack;
  const met = business.achievementsFor(spa, pack);
  const fresh = [];
  for (const def of met) if (!profile.achievements.includes(def.id)) { profile.achievements.push(def.id); fresh.push(def); }
  if (fresh.length) { profile.stats.spaAchievements = (profile.stats.spaAchievements || 0) + fresh.length; }
  earnAchievements(profile);
  return fresh;
}
function beginDay() {
  const profile = api.profile(), spa = state(profile);
  spa.trophyCount = (profile.world?.trophies || []).length;
  business.ensureDay(spa, context());
  api.save();
  return spa;
}

// --- lifecycle --------------------------------------------------------------------------------
export function attach(contextApi) {
  api = contextApi;
  api.save = api.save;
}
export function mount() {
  if (mounted) return;
  mounted = true;
  const host = document.querySelector('.console');
  if (!host) return;
  panel = document.createElement('section');
  panel.className = 'spa-panel'; panel.id = 'spaPanel';
  panel.innerHTML = '<div class="panel-head"><h2><svg aria-hidden="true"><use href="#files"/></svg>Day Spa</h2><span class="tiny" id="spaHead">DAY 1</span></div>' +
    '<div class="spa-body"><p class="tiny" id="spaLine">Opening the clinic…</p>' +
    '<div class="spa-actions"><button class="secondary" id="spaOpen">Dashboard</button><button class="primary" id="spaAdvance">Advance day</button></div></div>';
  host.append(panel);
  panel.querySelector('#spaOpen').onclick = () => open();
  panel.querySelector('#spaAdvance').onclick = () => advance();
  try { beginDay(); } catch (error) { panel.querySelector('#spaLine').textContent = error.message; }
  sync();
}
export function sync() {
  if (!panel) return;
  try {
    const profile = api.profile(), spa = state(profile), summary = business.summary(spa, context().pack);
    panel.querySelector('#spaHead').textContent = 'DAY ' + summary.day + ' · ' + summary.tierName.toUpperCase();
    panel.querySelector('#spaLine').textContent = pb(summary.cash) + ' · ' + summary.reputation + ' REP · ' + summary.done + '/' + summary.capacity + ' done' +
      (summary.session ? ' · appointment in progress' : summary.next ? ' · next: ' + summary.next.name : '');
  } catch { /* the panel must never break the extraction UI */ }
}
export function open(to = tab) { tab = to; beginDay(); render(); }

export function startAppointment(id) {
  const spa = state(), result = business.startSession(spa, context().pack, id);
  if (result.error) { api.cue(result.error); return null; }
  api.save();
  api.close();
  api.replayEncounter(SPA_MODE, result.appointment.encounter, result.appointment.seed);
  api.cue(result.appointment.name + ' · ' + result.appointment.persona + '. Perform the extraction.');
  return result.appointment;
}
export function abortAppointment() {
  const spa = state(), session = business.abortSession(spa);
  if (session) { api.save(); api.cue('Appointment postponed. No revenue was recorded.'); }
  return session;
}
// Called by the game immediately after the unified record service has finished the encounter.
export function completeAppointment() {
  const profile = api.profile(), spa = state(profile);
  if (!spa.session) return null;
  const last = world.lastEncounter(), snapshot = last?.snapshot, result = last?.result;
  const precision = snapshot?.values.precision || 0;
  const quality = result?.quality === 'perfect' || precision >= 850 ? 'perfect' : precision >= 400 ? 'clean' : 'rough';
  const outcome = snapshot ? {quality, precision, discovered: snapshot.values.discovered, chambers: snapshot.chambers,
    materials: snapshot.values.materials, releases: snapshot.releases, volume: snapshot.values.encounterTotal,
    durationMs: snapshot.durationMs, records: last.records || [], at: Date.now()}
    : {quality: 'clean', precision: 0, discovered: 0, chambers: 0, materials: 0, releases: 0, volume: 0, durationMs: 0, records: [], at: Date.now()};
  const settled = business.completeAppointment(spa, context(), outcome);
  if (settled?.error) { api.cue(settled.error); return settled; }
  const fresh = syncAchievements(profile);
  api.save();
  const receipt = settled.receipt;
  api.cue('Appointment settled: ' + pb(receipt.paid + receipt.tip) + ' · ' + receipt.satisfaction + '/100 · ' + settled.review.stars + '\u2605' +
    (fresh.length ? ' · Achievement: ' + fresh[0].name : ''));
  return settled;
}
export function advance() {
  const profile = api.profile(), spa = state(profile);
  const result = business.advanceDay(spa, context());
  if (result.error) { api.cue(result.error); return result; }
  spa.trophyCount = (profile.world?.trophies || []).length;
  const fresh = syncAchievements(profile);
  api.save();
  api.cue('Day ' + result.day + ' · ' + result.appointments + ' appointments' + (result.event ? ' · ' + result.event.name : '') + (fresh.length ? ' · Achievement: ' + fresh[0].name : ''));
  if (document.getElementById('dialog')?.open) render();
  return result;
}

// --- settings, files, offline and inspection --------------------------------------------------
export function settingsHTML() {
  const spa = state();
  return '<h3>Day Spa</h3><div class="prefs"><label>Automatic restocking <input id="spaAutoRestock" type="checkbox"' + (spa.autoRestock ? ' checked' : '') + '></label></div>';
}
export function bindSettings(root = document) {
  const input = root.getElementById('spaAutoRestock');
  if (input) input.onchange = () => { business.setAutoRestock(state(), input.checked); api.save(); };
}
export function recordsForFiles() {
  if (!content.versions()[NS]) return '';
  const spa = state(), summary = business.summary(spa, context().pack);
  return '<details><summary>Day Spa · day ' + summary.day + ' · ' + pb(summary.cash) + '</summary>' +
    '<p>' + esc(summary.tierName) + ' · ' + summary.reputation + ' reputation · ' + spa.stats.appointments + ' appointments · ' + spa.stats.days + ' days traded</p>' +
    '<p class="tiny">Open the Day Spa from the header for appointments, staffing, supplies and the books.</p></details>';
}
export function primeOffline() {
  if (primeOffline.done || !navigator.onLine) return;
  primeOffline.done = true;
  return Promise.allSettled(['./pack.json', './business.js', './expansion.js'].map(path => fetch(new URL(path, import.meta.url).href, {cache: 'reload'})));
}
export function reset() { cache = null; sync(); }
export function snapshotForTests() {
  const profile = api.profile(), spa = state(profile), pack = context().pack;
  return {spa: structuredClone(spa), summary: business.summary(spa, pack), pool: context().pool.length,
    legends: context().legends.length, achievements: business.achievementsFor(spa, pack).map(item => item.id),
    revenueByClass: business.revenueBy(spa, 'class'), ledger: business.ledgerBalance(spa),
    reviewTrend: business.reviewTrend(spa), facility: pack.facilities.map(item => ({tier: item.tier, name: item.name, price: item.price, reputation: item.reputation}))};
}
export {business, world as book};

// --- presentation ----------------------------------------------------------------------------
const ROOM_ICON = '<svg viewBox="0 0 64 48" aria-hidden="true"><rect x="3" y="5" width="58" height="38" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 38h14M32 38h7M46 38h8" stroke="currentColor" stroke-width="2"/></svg>';
function factorList(factors) {
  return '<ul class="spa-factors">' + (factors || []).map(item => '<li><span>' + esc(item.label) + '</span><b class="' + (item.delta >= 0 ? 'up' : 'down') + '">' + (item.delta >= 0 ? '+' : '') + item.delta + '</b></li>').join('') + '</ul>';
}
function appointmentCard(appointment, spa, pack) {
  const supplies = business.needsFor(spa, appointment, pack);
  const persona = pack.personalities.find(item => item.id === appointment.personality);
  const active = spa.session?.appointmentId === appointment.id;
  const done = appointment.status === 'complete';
  const technician = spa.staff.some(member => member.role === 'technician');
  const canDelegate = technician && !appointment.legendary && !appointment.boss && !done && !active && !spa.session;
  return '<article class="spa-appt' + (appointment.legendary ? ' legendary' : '') + (done ? ' done' : '') + '">' +
    '<header><div><strong>' + esc(appointment.name) + '</strong><small>' + esc(appointment.region || '') + ' · ' + esc(appointment.namespace) + ' · seed ' + appointment.seed + '</small></div>' +
    '<span class="spa-tag">' + (done ? 'SETTLED' : active ? 'IN PROGRESS' : appointment.legendary ? 'LEGENDARY' : 'QUEUED') + '</span></header>' +
    '<p class="spa-persona">' + esc(appointment.persona || persona?.name || '') + ' · ' + esc(persona?.note || '') + '</p>' +
    '<dl class="spa-facts"><div><dt>Complexity</dt><dd>' + appointment.complexity + '/10</dd></div>' +
    '<div><dt>Duration</dt><dd>~' + appointment.minutes + 'm</dd></div>' +
    '<div><dt>Targets</dt><dd>' + appointment.targets + '</dd></div>' +
    '<div><dt>Hidden</dt><dd>' + (appointment.hidden || 0) + '</dd></div>' +
    '<div><dt>Quote</dt><dd>' + pb(appointment.price) + '</dd></div>' +
    '<div><dt>Est. cost</dt><dd>' + pb(appointment.cost.total) + '</dd></div></dl>' +
    '<p class="spa-supplies ' + (supplies.ok ? 'ok' : 'low') + '">' + (supplies.ok ? 'Supplies ready' : 'Short: ' + Object.keys(supplies.missing).join(', ')) + '</p>' +
    (done ? '' : '<div class="spa-appt-actions">' +
      (active ? '<button class="primary" data-resume="1">Resume extraction</button>' : '<button class="primary" data-start="' + esc(appointment.id) + '"' + (supplies.ok && !spa.session ? '' : ' disabled') + '>Perform extraction</button>') +
      (canDelegate ? '<button class="secondary" data-delegate="' + esc(appointment.id) + '"' + (supplies.ok ? '' : ' disabled') + '>Delegate</button>' : '') +
      (appointment.legendary || appointment.boss ? '<span class="tiny">Personal performance required</span>' : '') + '</div>') +
    '</article>';
}
function roomCards(spa, pack) {
  const receiptDay = spa.completed.filter(item => item.day === spa.day).length;
  const rooms = [{name: 'Reception', status: spa.staff.some(m => m.role === 'receptionist') ? 'staffed' : 'available'},
    {name: 'Waiting area', status: spa.appointments.some(a => a.status === 'queued') ? 'occupied' : 'available'},
    {name: 'Equipment storage', status: spa.inventory.pads > 3 ? 'available' : 'low'},
    {name: 'Supply inventory', status: spa.inventory.cleaning > 2 ? 'available' : 'low'},
    {name: 'Staff lounge', status: spa.staff.length ? 'staffed' : 'available'}];
  for (let index = 1; index <= spa.rooms; index++) rooms.push({name: 'Treatment room ' + index,
    status: spa.session && index === 1 ? 'occupied' : receiptDay >= index ? 'cleaning' : 'available'});
  rooms.push({name: 'Diagnostic room', status: spa.tier >= 4 ? 'available' : 'locked'});
  rooms.push({name: 'Midnight wing', status: spa.tier >= 5 ? 'open' : 'locked'});
  rooms.push({name: 'Trophy display', status: (spa.trophyCount || 0) ? 'available' : 'locked', note: (spa.trophyCount || 0) + ' trophies'});
  rooms.push({name: 'Administrative office', status: spa.staff.some(m => m.role === 'operations') ? 'staffed' : 'available'});
  return rooms.map(room => '<figure class="spa-room ' + esc(room.status) + '">' + ROOM_ICON + '<figcaption><strong>' + esc(room.name) + '</strong><small>' + esc(room.note || room.status) + '</small></figcaption></figure>').join('');
}
function bars(series, key, tone = 'lime') {
  if (!series.length) return '<p class="tiny">No closed days yet.</p>';
  const max = Math.max(1, ...series.map(row => Math.abs(row[key])));
  return '<div class="spa-chart" role="img" aria-label="' + esc(key) + ' by day">' + series.map(row => {
    const height = Math.max(2, Math.round(Math.abs(row[key]) / max * 68));
    return '<div class="spa-bar ' + tone + '" style="height:' + height + 'px" title="Day ' + row.day + ': ' + row[key] + '"></div>';
  }).join('') + '</div>';
}
function todaySection(profile, spa, pack) {
  const summary = business.summary(spa, pack);
  const event = spa.pendingEvent;
  return '<div class="spa-stats"><div><span>Cash</span><b>' + pb(summary.cash) + '</b></div><div><span>Reputation</span><b>' + summary.reputation + '/1000</b></div>' +
    '<div><span>Today</span><b>' + summary.done + '/' + summary.capacity + '</b></div><div><span>Profit today</span><b class="' + (summary.profit >= 0 ? 'up' : 'down') + '">' + (summary.profit >= 0 ? '+' : '') + pb(summary.profit) + '</b></div></div>' +
    (event ? '<div class="spa-event"><strong>' + esc(event.name) + '</strong><p>' + esc(event.note) + '</p><div class="spa-appt-actions">' + event.choices.map(choice => '<button class="secondary" data-event="' + choice.index + '">' + esc(choice.label) + '<small>' + esc(choice.note) + '</small></button>').join('') + '</div></div>' : '') +
    (summary.session ? '<p class="spa-banner">An appointment is in progress. <button class="secondary" data-resume="1">Resume extraction</button></p>' : '') +
    '<div class="spa-appts">' + (spa.appointments.length ? spa.appointments.map(item => appointmentCard(item, spa, pack)).join('') : '<p class="tiny">No appointments in today\u2019s queue.</p>') + '</div>' +
    '<div class="dialog-actions"><button class="secondary" data-close-day="1">Close the day</button><button class="primary" data-advance="1">Advance to tomorrow</button>' +
    (summary.cash < 300 ? '<button class="secondary" data-assist="1">Request business assistance</button>' : '') + '</div>' +
    '<p class="tiny">Closing the day pays rent, utilities, wages and maintenance. Advancing generates tomorrow from the business seed.</p>';
}
function clinicSection(spa, pack) {
  const next = business.nextFacility(spa, pack), tier = business.facility(spa, pack);
  return '<div class="spa-floor">' + roomCards(spa, pack) + '</div>' +
    '<h3>' + esc(tier.name) + '</h3><p class="tiny">Tier ' + tier.tier + ' · ' + tier.capacity + ' appointment slots · facility quality ' + tier.quality + ' · ' + pb(tier.overhead) + ' rent per day.</p>' +
    (next ? '<div class="spa-upgrade"><div><strong>Next: ' + esc(next.name) + '</strong><p class="tiny">' + esc(next.blurb) + '</p><p class="tiny">Requires ' + next.reputation + ' reputation · ' + pb(next.price) + ' · becomes ' + next.capacity + ' slots</p></div>' +
      '<button class="primary" data-upgrade="1"' + (spa.cash >= next.price && spa.reputation >= next.reputation ? '' : ' disabled') + '>Expand</button></div>' : '<p class="tiny">Pore World reached. The endgame continues through legendary referrals and specialty portfolios.</p>');
}
function shopSection(spa, pack) {
  const equipment = pack.spaEquipment.map(item => '<div class="spa-shop-row"><div><strong>' + esc(item.name) + '</strong><small>Tier ' + item.tier + ' · ' + pb(item.price) + ' · ' + pb(item.operating) + '/appointment · maintenance ' + item.maintenance + '</small></div>' +
    (spa.equipment.includes(item.id) ? '<span class="spa-tag">OWNED</span>' : '<button class="secondary" data-buy-equipment="' + esc(item.id) + '"' + (spa.cash >= item.price && spa.tier >= item.tier ? '' : ' disabled') + '>Buy</button>') + '</div>').join('');
  const supplies = pack.supplies.map(item => '<div class="spa-shop-row"><div><strong>' + esc(item.name) + '</strong><small>' + (spa.inventory[item.use] || 0) + ' in stock · pack of ' + item.pack + ' · ' + pb(item.price) + (item.tier > 1 ? ' · tier ' + item.tier : '') + '</small></div>' +
    '<div class="spa-buy"><button class="secondary" data-restock="' + esc(item.id) + '" data-packs="1"' + (spa.tier >= item.tier && spa.cash >= item.price ? '' : ' disabled') + '>1</button>' +
    '<button class="secondary" data-restock="' + esc(item.id) + '" data-packs="3"' + (spa.tier >= item.tier && spa.cash >= item.price * 3 * 0.9 ? '' : ' disabled') + '>3 (-10%)</button></div></div>').join('');
  return '<h3>Equipment</h3>' + equipment + '<h3>Consumables</h3>' + supplies +
    '<p class="tiny">Purchases and restocks are ledger entries. Automatic restocking only buys consumables the clinic actually uses.</p>';
}

function teamSection(spa, pack) {
  const staff = spa.staff.length ? spa.staff.map(member => '<div class="spa-shop-row"><div><strong>' + esc(member.name) + '</strong><small>' + esc(member.roleName) + ' · skill ' + member.skill + '/10 · morale ' + member.morale + ' · ' + pb(member.wage) + '/day</small></div>' +
    '<div class="spa-buy"><button class="secondary" data-train="' + esc(member.id) + '">Train ' + (200 + member.skill * 60) + ' PB</button><button class="secondary" data-fire="' + esc(member.id) + '">Dismiss</button></div></div>').join('') : '<p class="tiny">No employees yet. Dani is currently reception, clinical staff and accounts.</p>';
  const roles = pack.staffRoles.map(role => '<div class="spa-shop-row"><div><strong>' + esc(role.name) + '</strong><small>' + esc(role.blurb) + ' · ' + pb(role.wage) + '/day · tier ' + role.tier + '</small></div>' +
    '<button class="secondary" data-hire="' + esc(role.id) + '"' + (spa.tier >= role.tier && spa.cash >= role.wage ? '' : ' disabled') + '>Hire</button></div>').join('');
  return '<h3>Team</h3>' + staff + '<h3>Recruitment</h3>' + roles +
    '<p class="tiny">Technicians resolve eligible routine appointments deterministically. Delegated cases never set extraction records; legendary and boss appointments must be performed personally.</p>';
}
function growthSection(profile, spa, pack) {
  const marketing = pack.marketing.map(item => '<div class="spa-shop-row"><div><strong>' + esc(item.name) + '</strong><small>' + pb(item.cost) + ' · ' + item.days + ' days · +' + item.demand + ' demand · +' + item.reputation + ' reputation</small><p class="tiny">' + esc(item.note) + '</p></div>' +
    '<button class="secondary" data-marketing="' + esc(item.id) + '"' + (spa.tier >= item.tier && spa.cash >= item.cost && !spa.marketing.some(m => m.id === item.id) ? '' : ' disabled') + '>Launch</button></div>').join('');
  const achievements = pack.spaAchievements.map(def => '<p class="' + (profile.achievements.includes(def.id) ? 'achievement' : '') + '">' + (profile.achievements.includes(def.id) ? '\u2713 ' : '\u25cb ') + esc(def.name) + ' <span class="tiny">(' + def.stat + ' \u2265 ' + def.threshold + ')</span></p>').join('');
  return '<h3>Pricing and assistance</h3><div class="spa-settings">' +
    '<label>Pricing <select id="spaPricing">' + Object.keys(business.PRICING).map(key => '<option' + (spa.pricing === key ? ' selected' : '') + '>' + key + '</option>').join('') + '</select></label>' +
    '<label>Difficulty <select id="spaDifficulty">' + pack.difficulty.map(item => '<option value="' + esc(item.id) + '"' + (spa.difficulty === item.id ? ' selected' : '') + '>' + esc(item.name) + '</option>').join('') + '</select></label>' +
    '<label class="tiny">Auto-restock <input id="spaAutoRestock2" type="checkbox"' + (spa.autoRestock ? ' checked' : '') + '></label></div>' +
    '<h3>Marketing</h3>' + marketing +
    '<h3>Andi crossover</h3><div class="spa-shop-row"><div><strong>Chicago branch enquiry</strong><small>' + (spa.andi ? 'Discovered. Andi refers unusual customers and the Alley Cat Council provides unofficial security.' : 'Andi has thoughts about a second location.') + '</small></div>' +
    '<button class="secondary" data-andi="1"' + (spa.andi ? ' disabled' : '') + '>Call Andi</button></div>' +
    '<h3>Business achievements</h3><div class="record-grid">' + achievements + '</div>';
}
function booksSection(spa, pack) {
  const series = business.chartSeries(spa);
  const byClass = Object.entries(business.revenueBy(spa, 'class')).sort((a, b) => b[1] - a[1]);
  const reviews = spa.reviews.slice(0, 8).map(review => '<div class="spa-review"><strong>' + '\u2605'.repeat(review.stars) + '\u2606'.repeat(5 - review.stars) + '</strong><p>' + esc(review.text) + '</p><small>Day ' + review.day + ' · satisfaction ' + review.satisfaction + '/100' + (review.delegated ? ' · delegated' : '') + '</small></div>').join('') || '<p class="tiny">No reviews yet.</p>';
  const ledger = spa.transactions.slice(-12).reverse().map(entry => '<div class="spa-ledger-row"><span>Day ' + entry.day + ' · ' + esc(entry.kind) + '</span><b class="' + (entry.amount >= 0 ? 'up' : 'down') + '">' + (entry.amount >= 0 ? '+' : '') + pb(entry.amount) + '</b><small>' + esc(entry.note || '') + '</small></div>').join('') || '<p class="tiny">No transactions yet.</p>';
  return '<div class="spa-stats"><div><span>Days traded</span><b>' + spa.stats.days + '</b></div><div><span>Appointments</span><b>' + spa.stats.appointments + '</b></div>' +
    '<div><span>Revenue</span><b>' + pb(spa.stats.revenue) + '</b></div><div><span>Expenses</span><b>' + pb(spa.stats.expenses) + '</b></div></div>' +
    '<h3>Daily revenue</h3>' + bars(series, 'revenue') + '<h3>Daily profit</h3>' + bars(series, 'profit', 'brass') +
    '<h3>Revenue by patient class</h3>' + (byClass.length ? byClass.map(([name, value]) => '<div class="spa-shop-row"><span>' + esc(name) + '</span><b>' + pb(value) + '</b></div>').join('') : '<p class="tiny">No settled appointments yet.</p>') +
    '<h3>Reviews</h3>' + reviews + '<h3>Ledger (last 12)</h3>' + ledger +
    '<p class="tiny">Every entry has a stable id. Cash reconciles to the retained ledger: ' + pb(business.ledgerBalance(spa)) + ' of movements.</p>';
}
function recordsSection(profile) {
  const records = content.list('records').filter(record => record.metric).map(record => ({name: record.name, value: profile.world?.best?.[record.metric] || 0, tier: profile.world?.meta?.[record.metric]?.tier || null}))
    .filter(record => record.value > 0).sort((a, b) => b.value - a.value).slice(0, 6);
  const trophies = (profile.world?.trophies || []).length;
  return '<p class="tiny">The spa reads the Version 1.4 unified record service. Interactive appointments can set records; delegated cases cannot.</p>' +
    '<div class="spa-stats"><div><span>Records</span><b>' + records.length + '</b></div><div><span>Trophies</span><b>' + trophies + '</b></div><div><span>Record revenue</span><b>' + (profile.stats.recordRevenue || 0) + '</b></div><div><span>Spa achievements</span><b>' + (profile.stats.spaAchievements || 0) + '</b></div></div>' +
    (records.length ? records.map(record => '<div class="spa-shop-row"><span>' + esc(record.name) + ' <span class="tier ' + esc(record.tier || '') + '">' + esc(record.tier || '') + '</span></span><b>' + record.value + '</b></div>').join('') : '<p class="tiny">No records yet. Perform an extraction personally to enter the book.</p>') +
    '<div class="dialog-actions"><button class="primary" data-book="1">Open the World Book</button></div>';
}
function render() {
  if (!api) return;
  const profile = api.profile(), spa = state(profile), pack = context().pack;
  const summary = business.summary(spa, pack);
  const tabs = [['today', 'Today'], ['clinic', 'Clinic'], ['shop', 'Shop'], ['team', 'Team'], ['growth', 'Growth'], ['books', 'Books'], ['records', 'Records']];
  const sections = {today: todaySection(profile, spa, pack), clinic: clinicSection(spa, pack), shop: shopSection(spa, pack),
    team: teamSection(spa, pack), growth: growthSection(profile, spa, pack), books: booksSection(spa, pack), records: recordsSection(profile)};
  api.modal('Dani\u2019s Disgusting Day Spa',
    '<p class="tiny">Day ' + summary.day + ' \u00b7 ' + esc(summary.tierName) + ' \u00b7 ' + pb(summary.cash) + ' \u00b7 ' + summary.reputation + ' reputation \u00b7 ' + summary.staff + ' staff</p>' +
    '<div class="book-tabs" role="tablist">' + tabs.map(([id, name]) => '<button role="tab" aria-selected="' + (id === tab) + '" data-spa-tab="' + id + '">' + name + '</button>').join('') + '</div>' +
    '<div class="spa-section">' + sections[tab] + '</div>' +
    '<p class="tiny">Fictional business simulation. Pore Bucks have no real value; there are no purchases, accounts or clinical claims.</p>',
    [['Close', api.close]], 'OUR BUSINESS IS BOOMING');
  bind(profile, spa, pack);
}
function run(action) {
  const profile = api.profile(), spa = state(profile);
  const result = action(spa, profile) || null;
  const fresh = syncAchievements(profile);
  api.save(); sync();
  if (fresh.length) api.cue('Achievement: ' + fresh[0].name);
  if (document.getElementById('dialog')?.open) render();
  return result;
}
function bind(profile, spa, pack) {
  const body = document.getElementById('dialogBody');
  if (!body) return;
  for (const button of body.querySelectorAll('[data-spa-tab]')) button.onclick = () => { tab = button.dataset.spaTab; render(); };
  for (const button of body.querySelectorAll('[data-start]')) button.onclick = () => startAppointment(button.dataset.start);
  for (const button of body.querySelectorAll('[data-delegate]')) button.onclick = () => run((stateNow) => {
    const result = business.delegateAppointment(stateNow, context(), button.dataset.delegate);
    if (result?.error) api.cue(result.error);
    return result;
  });
  for (const button of body.querySelectorAll('[data-resume]')) button.onclick = () => { if (resumeAppointment()) return; };
  for (const button of body.querySelectorAll('[data-event]')) button.onclick = () => run((stateNow) => business.resolveEvent(stateNow, context(), Number(button.dataset.event)));
  body.querySelector('[data-advance]')?.addEventListener('click', () => advance());
  body.querySelector('[data-close-day]')?.addEventListener('click', () => run((stateNow) => {
    const result = business.closeDay(stateNow, context());
    api.cue(result.error || (result.already ? 'The day is already closed.' : 'Day ' + result.summary.day + ' closed: ' + pb(result.summary.profit) + ' profit.'));
    return result;
  }));
  body.querySelector('[data-assist]')?.addEventListener('click', () => run((stateNow) => {
    const result = business.acceptAssistance(stateNow);
    api.cue(result.error || 'Assistance granted: ' + pb(result.granted) + '.');
    return result;
  }));
  body.querySelector('[data-upgrade]')?.addEventListener('click', () => run((stateNow) => {
    const result = business.upgradeFacility(stateNow, pack);
    api.cue(result.error || 'Facility expanded: ' + result.name + '.');
    return result;
  }));
  for (const button of body.querySelectorAll('[data-buy-equipment]')) button.onclick = () => run((stateNow) => {
    const result = business.buyEquipment(stateNow, pack, button.dataset.buyEquipment);
    api.cue(result.error || 'Purchased: ' + result.name + '.');
    return result;
  });
  for (const button of body.querySelectorAll('[data-restock]')) button.onclick = () => run((stateNow) => {
    const result = business.buySupplies(stateNow, pack, button.dataset.restock, Number(button.dataset.packs));
    api.cue(result.error || 'Restocked: ' + result.packs + ' pack(s) for ' + pb(result.price) + '.');
    return result;
  });
  for (const button of body.querySelectorAll('[data-hire]')) button.onclick = () => run((stateNow) => {
    const result = business.hireStaff(stateNow, pack, button.dataset.hire);
    api.cue(result.error || 'Hired ' + result.name + ' (' + result.role + ').');
    return result;
  });
  for (const button of body.querySelectorAll('[data-train]')) button.onclick = () => run((stateNow) => {
    const result = business.trainStaff(stateNow, pack, button.dataset.train);
    api.cue(result.error || result.name + ' trained to skill ' + result.skill + '.');
    return result;
  });
  for (const button of body.querySelectorAll('[data-fire]')) button.onclick = () => run((stateNow) => {
    const result = business.fireStaff(stateNow, button.dataset.fire);
    api.cue(result.error || result.name + ' has left the clinic.');
    return result;
  });
  for (const button of body.querySelectorAll('[data-marketing]')) button.onclick = () => run((stateNow) => {
    const result = business.buyMarketing(stateNow, pack, button.dataset.marketing);
    api.cue(result.error || 'Campaign launched: ' + result.name + '.');
    return result;
  });
  body.querySelector('[data-andi]')?.addEventListener('click', () => run((stateNow) => {
    const result = business.andiCrossover(stateNow);
    api.cue(result.already ? 'Andi is already on the case.' : result.note);
    return result;
  }));
  body.querySelector('[data-book]')?.addEventListener('click', () => { api.close(); world.open(); });
  const pricing = body.querySelector('#spaPricing');
  if (pricing) pricing.onchange = () => run((stateNow) => business.setPricing(stateNow, pricing.value));
  const difficulty = body.querySelector('#spaDifficulty');
  if (difficulty) difficulty.onchange = () => run((stateNow) => business.setDifficulty(stateNow, difficulty.value));
  const auto = body.querySelector('#spaAutoRestock2');
  if (auto) auto.onchange = () => { business.setAutoRestock(state(), auto.checked); api.save(); render(); };
}
export function resumeAppointment() {
  const spa = state();
  if (!spa.session) return false;
  api.close();
  api.replayEncounter(SPA_MODE, spa.session.encounter, spa.session.seed);
  return true;
}
