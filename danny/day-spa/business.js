// Dani's Disgusting Day Spa — headless business engine.
// Money is integer Pore Bucks. Every movement is a ledger entry with a stable id, so an interrupted
// appointment, day close or purchase can be retried without paying twice. Nothing here touches the
// renderer, the extraction simulation or the DOM: appointments hand a seed and an encounter to the
// existing engine and consume its immutable measurement afterwards.
export const SPA_SCHEMA = 1;
export const SPA_RULES = 1;
export const LEDGER_LIMIT = 200;
export const COMPLETED_LIMIT = 40;
export const REVIEW_LIMIT = 30;
export const HISTORY_LIMIT = 30;
export const QUEUE_LIMIT = 12;
export const PRICING = {budget: 0.8, standard: 1, premium: 1.35, specialist: 1.6, legendary: 2};
export const QUALITY = {perfect: {pay: 1.05, sat: 25}, clean: {pay: 1, sat: 12}, rough: {pay: 0.85, sat: -12}, failed: {pay: 0.4, sat: -30}};

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const int = value => Number.isFinite(value) ? Math.trunc(value) : 0;
export const hash = text => { let h = 2166136261; for (let i = 0; i < String(text).length; i++) h = Math.imul(h ^ String(text).charCodeAt(i), 16777619); return h >>> 0; };
export const money = value => clamp(int(value), 0, 999999999);
const pick = (list, seed) => list.length ? list[seed % list.length] : null;
const sum = (list, fn) => list.reduce((total, item) => total + fn(item), 0);

export function defaultSpa(seed = 0) {
  return {
    v: SPA_SCHEMA, rules: SPA_RULES, seed: (int(seed) >>> 0), day: 1, cash: 2500, tier: 1,
    difficulty: 'disgusting-day-spa:diff-owner', pricing: 'standard', reputation: 80, rooms: 1,
    autoRestock: true, equipment: ['base:loop', 'base:wand'], condition: {},
    inventory: {pads: 20, cartridges: 6, gel: 4, cleaning: 10, maintenance: 2, spectral: 0, environment: 0},
    staff: [], appointments: [], completed: [], transactions: [], reviews: [], marketing: [],
    events: [], pendingEvent: null, session: null, history: [], recovery: 0, andi: 0,
    ledgerSeq: 0, closedDay: 0, eventDay: 0, assistDay: 0, stats: {days: 0, profitDays: 0, appointments: 0, delegated: 0, revenue: 0, expenses: 0,
      profitTotal: 0, reviews5: 0, returning: 0, referrals: 0, bulkBuys: 0, hires: 0, expansions: 0,
      midnightOpen: 0, vampireProfit: 0, viral: 0, recordRevenue: 0, equipmentVariety: 2, international: 0}
  };
}

// Normalisation is idempotent and bounded: it never invents money, never drops a completed receipt,
// and keeps every list inside its documented cap so the existing strict save validator stays happy.
export function normalizeSpa(spa) {
  const base = defaultSpa();
  if (!spa || typeof spa !== 'object' || Array.isArray(spa)) return base;
  const out = {...base, ...spa};
  out.v = SPA_SCHEMA;
  out.seed = int(out.seed) >>> 0;
  out.day = clamp(int(out.day) || 1, 1, 100000);
  out.cash = money(out.cash);
  out.tier = clamp(int(out.tier) || 1, 1, 7);
  out.reputation = clamp(int(out.reputation), 0, 1000);
  out.rooms = clamp(int(out.rooms) || 1, 1, 12);
  out.pricing = PRICING[out.pricing] ? out.pricing : 'standard';
  out.difficulty = /^disgusting-day-spa:diff-/.test(out.difficulty || '') ? out.difficulty : base.difficulty;
  out.autoRestock = out.autoRestock !== false;
  out.equipment = Array.isArray(out.equipment) ? [...new Set(out.equipment.filter(id => typeof id === 'string'))].slice(0, 24) : [...base.equipment];
  out.condition = out.condition && typeof out.condition === 'object' ? out.condition : {};
  out.inventory = {...base.inventory, ...(out.inventory && typeof out.inventory === 'object' ? out.inventory : {})};
  for (const key of Object.keys(base.inventory)) out.inventory[key] = clamp(int(out.inventory[key]), 0, 9999);
  out.staff = Array.isArray(out.staff) ? out.staff.slice(0, 12) : [];
  out.appointments = Array.isArray(out.appointments) ? out.appointments.slice(0, QUEUE_LIMIT) : [];
  out.completed = Array.isArray(out.completed) ? out.completed.slice(0, COMPLETED_LIMIT) : [];
  out.transactions = Array.isArray(out.transactions) ? out.transactions.slice(-LEDGER_LIMIT) : [];
  out.reviews = Array.isArray(out.reviews) ? out.reviews.slice(0, REVIEW_LIMIT) : [];
  out.marketing = Array.isArray(out.marketing) ? out.marketing.filter(item => item && int(item.untilDay) >= out.day).slice(0, 8) : [];
  out.events = Array.isArray(out.events) ? out.events.slice(0, 6) : [];
  out.history = Array.isArray(out.history) ? out.history.slice(-HISTORY_LIMIT) : [];
  out.ledgerSeq = int(out.ledgerSeq);
  out.closedDay = int(out.closedDay); out.eventDay = int(out.eventDay); out.assistDay = int(out.assistDay);
  out.stats = {...base.stats, ...(out.stats && typeof out.stats === 'object' ? out.stats : {})};
  for (const key of Object.keys(base.stats)) out.stats[key] = clamp(int(out.stats[key]), 0, 999999999);
  out.stats.tier = out.tier;
  out.stats.equipmentVariety = out.equipment.length;
  out.pendingEvent = out.pendingEvent && typeof out.pendingEvent === 'object' ? out.pendingEvent : null;
  out.session = out.session && typeof out.session === 'object' ? out.session : null;
  return out;
}

export const facility = (spa, pack) => pack.facilities.find(item => item.tier === spa.tier) || pack.facilities[0];
export const nextFacility = (spa, pack) => pack.facilities.find(item => item.tier === spa.tier + 1) || null;
export const difficulty = (spa, pack) => pack.difficulty.find(item => item.id === spa.difficulty) || pack.difficulty[1];
export const supplyItem = (pack, id) => pack.supplies.find(item => item.id === id || item.use === id) || null;

// --- ledger -----------------------------------------------------------------------------------
// Posting is idempotent by id. Cash only moves when the id has not been posted before, which is what
// makes retries after an interrupted save safe.
export function posted(spa, id) { return spa.transactions.some(entry => entry.id === id); }
export function post(spa, id, kind, amount, note = '') {
  if (!id || posted(spa, id)) return 0;
  const value = int(amount);
  spa.ledgerSeq = int(spa.ledgerSeq) + 1;
  spa.transactions.push({id, day: spa.day, kind, amount: value, note});
  spa.transactions = spa.transactions.slice(-LEDGER_LIMIT);
  spa.cash = money(spa.cash + value);
  return value;
}
export function payOut(spa, id, kind, amount, note = '') {
  // Never drives cash negative: a shortfall is recorded as deferred, not as a loan.
  const wanted = Math.max(0, int(amount));
  const paid = Math.min(wanted, spa.cash);
  if (paid > 0) post(spa, id, kind, -paid, note);
  if (paid < wanted) {
    post(spa, id + ':deferral', 'deferral', 0, 'Deferred ' + (wanted - paid) + ' PB');
    spa.recovery = Math.max(1, spa.recovery);
  }
  return paid;
}
export function ledgerBalance(spa) { return sum(spa.transactions, entry => entry.amount); }

// --- catalog, prices and costs ---------------------------------------------------------------
export function unitCost(pack, use) {
  const item = supplyItem(pack, use);
  return item ? Math.ceil(item.price / item.pack) : 0;
}
export function needsFor(spa, appointment, pack) {
  const need = {pads: appointment.targets, cartridges: Math.ceil(appointment.targets / 3), gel: 1, cleaning: 1};
  if (appointment.namespace === 'midnight-clinic') { need.spectral = 1; need.environment = 1; }
  const missing = {};
  for (const [key, value] of Object.entries(need)) if ((spa.inventory[key] || 0) < value) missing[key] = value - (spa.inventory[key] || 0);
  return {need, missing, ok: Object.keys(missing).length === 0};
}
export function appointmentCost(spa, appointment, pack) {
  const {need} = needsFor(spa, appointment, pack);
  const supplies = sum(Object.entries(need), ([use, units]) => unitCost(pack, use) * units);
  const equipment = 8 + spa.tier * 2 + (appointment.namespace === 'midnight-clinic' ? 12 : 0);
  const cleaning = 4 + spa.rooms * 2;
  return {supplies, equipment, cleaning, total: supplies + equipment + cleaning};
}
export function basePriceFor(appointment, pack) {
  if (appointment.legendary) return int(appointment.legendaryPrice) || 1500;
  const namespace = {base: 220, 'pore-explorer': 330, 'midnight-clinic': 500, 'world-book-of-pores': 900}[appointment.namespace] || 220;
  return Math.round(namespace * (1 + (appointment.tier - 1) * 0.15) / 10) * 10;
}
export function quote(spa, appointment, pack) {
  const persona = pack.personalities.find(item => item.id === appointment.personality) || pack.personalities[0];
  const price = basePriceFor(appointment, pack) * (1 + (spa.tier - 1) * 0.12) * (PRICING[spa.pricing] || 1) * (persona.priceBias || 1);
  return Math.max(40, Math.round(price / 10) * 10);
}
export function expectedPrice(spa, appointment, pack) {
  return Math.max(40, Math.round(basePriceFor(appointment, pack) * (1 + (spa.tier - 1) * 0.12) / 10) * 10);
}
export function wageBill(spa) { return sum(spa.staff, member => member.wage); }
export function operationalOverhead(spa, pack) {
  const tier = facility(spa, pack), diff = difficulty(spa, pack);
  const rent = Math.round(tier.overhead * (diff.cost || 1));
  const utilities = Math.round((40 + spa.rooms * 18) * (diff.cost || 1));
  const maintenance = sum(spa.equipment.filter(id => id.includes(':eq-')), id => {
    const item = pack.spaEquipment.find(entry => entry.id === id);
    return item ? Math.round(item.maintenance / 10) : 0;
  });
  return {rent, utilities, maintenance, wages: wageBill(spa), total: rent + utilities + maintenance + wageBill(spa)};
}
export function demandBonus(spa, pack) {
  const diff = difficulty(spa, pack);
  const marketing = sum(spa.marketing.filter(item => int(item.untilDay) >= spa.day), item => item.demand || 0);
  const staff = spa.staff.reduce((total, member) => total + (member.role === 'receptionist' ? 1 : member.role === 'marketing' ? 1 : 0), 0);
  const trophies = Math.floor((spa.trophyCount || 0) / 5);
  return (diff.demand || 0) + marketing + staff + trophies;
}

// --- appointment generation ------------------------------------------------------------------
// A business seed, a day index, the installed pool and the current reputation fully determine the
// queue. No wall-clock time, network or random source participates.
export function generateDay(spa, ctx) {
  const pack = ctx.pack, tier = facility(spa, pack), diff = difficulty(spa, pack);
  const pricingDemand = {budget: 1, standard: 0, premium: -1, specialist: -1, legendary: -2}[spa.pricing] || 0;
  const capacity = clamp(tier.capacity + demandBonus(spa, pack) + pricingDemand, 2, 12);
  const pool = (ctx.pool || []).filter(item => item.tier <= spa.tier);
  const queue = [];
  if (!pool.length) { spa.appointments = queue; return queue; }
  for (let index = 0; index < capacity; index++) {
    const seed = hash(spa.seed + ':' + spa.day + ':' + index + ':' + spa.reputation);
    const source = pick(pool, seed);
    const persona = pick(pack.personalities, hash(seed + ':persona'));
    const appointment = {
      id: 'd' + spa.day + '-a' + (index + 1), day: spa.day, encounter: source.encounter, name: source.name,
      namespace: source.namespace, region: source.region, klass: source.klass || null,
      targets: source.targets || 3, hidden: source.hidden || 0, tier: source.tier || 1,
      boss: !!source.boss, legendary: !!source.legendary,
      complexity: clamp(1, 10, Math.round((source.targets || 3) / 2 + (source.hidden || 0) + (source.tier || 1))),
      minutes: 12 + (source.targets || 3) * 3 + (source.hidden || 0) * 2,
      personality: persona.id, persona: persona.name, expectation: persona.note,
      seed: seed >>> 0, status: 'queued', source: 'generated'
    };
    appointment.price = quote(spa, appointment, pack);
    appointment.cost = appointmentCost(spa, appointment, pack);
    if (spa.recovery) appointment.price = Math.round(appointment.price * 0.8 / 10) * 10;
    queue.push(appointment);
  }
  // Legendary and boss referrals are separate, gated by tier, reputation and the day hash.
  const legends = (ctx.legends || []).filter(item => item.tier <= spa.tier && item.reputation <= spa.reputation);
  if (legends.length && hash(spa.seed + ':legend:' + spa.day) % 100 < 18) {
    const def = pick(legends, hash(spa.seed + ':legendpick:' + spa.day));
    const appointment = {id: 'd' + spa.day + '-L', day: spa.day, encounter: def.encounter, name: def.name,
      namespace: def.encounter.split(':')[0], region: 'referral', klass: null, targets: 4, hidden: 2,
      tier: def.tier, boss: false, legendary: true, legendaryPrice: def.price, reputation: def.reputation,
      complexity: 9, minutes: 40, personality: 'disgusting-day-spa:persona-celebrity',
      persona: 'Celebrity referral', expectation: def.note, seed: hash(spa.seed + ':legendseed:' + spa.day) >>> 0,
      status: 'queued', source: 'legendary'};
    appointment.price = quote(spa, appointment, pack);
    appointment.cost = appointmentCost(spa, appointment, pack);
    queue.push(appointment);
  }
  spa.appointments = queue.slice(0, QUEUE_LIMIT);
  return spa.appointments;
}

// --- sessions ----------------------------------------------------------------------------------
export function startSession(spa, pack, appointmentId) {
  const appointment = spa.appointments.find(item => item.id === appointmentId && item.status === 'queued');
  if (!appointment) return {error: 'That appointment is no longer available.'};
  const supplies = needsFor(spa, appointment, pack);
  if (!supplies.ok) return {error: 'Supplies are short. Restock before starting.', missing: supplies.missing};
  if (spa.session) return {error: 'Another appointment is already in progress.'};
  spa.session = {appointmentId: appointment.id, receiptId: 'd' + spa.day + ':' + appointment.id,
    encounter: appointment.encounter, seed: appointment.seed, day: spa.day, startedAt: 0};
  appointment.status = 'active';
  return {appointment, session: spa.session};
}
export function abortSession(spa, reason = 'abandoned') {
  if (!spa.session) return null;
  const appointment = spa.appointments.find(item => item.id === spa.session.appointmentId);
  if (appointment) { appointment.status = 'queued'; appointment.aborted = (appointment.aborted || 0) + 1; }
  const session = spa.session; spa.session = null;
  return {...session, reason};
}

// --- satisfaction, reviews and reputation ------------------------------------------------------
// Every factor is explicit and returned with the receipt, so the dashboard can explain the result.
export function satisfactionFor(spa, pack, appointment, outcome) {
  const tier = facility(spa, pack), persona = pack.personalities.find(item => item.id === appointment.personality) || pack.personalities[0];
  const factors = [{id: 'baseline', label: 'Baseline expectation', delta: 50}];
  const quality = QUALITY[outcome.quality] || QUALITY.clean;
  factors.push({id: 'quality', label: 'Completion quality (' + outcome.quality + ')', delta: quality.sat});
  const precision = clamp(int(outcome.precision), 0, 1000);
  factors.push({id: 'precision', label: 'Precision', delta: Math.round(precision / 1000 * 15)});
  const chambers = Math.max(1, int(outcome.chambers) || 1);
  factors.push({id: 'discovery', label: 'Concealed reservoir discovery', delta: Math.round(clamp(int(outcome.discovered) / chambers, 0, 1) * 8)});
  const capabilities = new Set((pack.spaEquipment || []).filter(item => spa.equipment.includes(item.id)).flatMap(item => item.capabilities || []));
  const needsSpectral = appointment.namespace === 'midnight-clinic';
  const fit = needsSpectral ? (capabilities.has('spectral') && capabilities.has('environment') ? 6 : -8) : (capabilities.size ? 4 : 0);
  factors.push({id: 'equipment', label: needsSpectral ? 'Supernatural equipment fit' : 'Equipment fit', delta: fit});
  factors.push({id: 'personality', label: persona.name, delta: persona.satisfaction || 0});
  const expected = expectedPrice(spa, appointment, pack);
  const ratio = appointment.price / Math.max(1, expected);
  factors.push({id: 'price', label: 'Price versus expectation', delta: ratio > 1.25 ? -8 : ratio > 1.05 ? -3 : ratio < 0.9 ? 4 : 1});
  factors.push({id: 'facility', label: 'Facility quality', delta: Math.round(tier.quality / 2)});
  const staffBonus = spa.staff.some(member => ['assistant', 'midnight'].includes(member.role)) ? 3 : 0;
  if (staffBonus) factors.push({id: 'staff', label: 'Staff service', delta: staffBonus});
  const minutes = int(outcome.durationMs) ? outcome.durationMs / 60000 : 0;
  const delay = minutes > appointment.minutes * 1.5 ? -6 : minutes > 0 && minutes < appointment.minutes ? 2 : 0;
  factors.push({id: 'duration', label: 'Appointment duration', delta: delay});
  if ((outcome.discovered || 0) >= Math.max(1, appointment.hidden)) factors.push({id: 'complications', label: 'Concealed complications resolved', delta: 5});
  const expect = (difficulty(spa, pack).expectation || 1);
  factors.push({id: 'difficulty', label: 'Management expectations', delta: -Math.round((expect - 1) * 20)});
  if (outcome.delegated) factors.push({id: 'delegated', label: 'Handled by staff', delta: -6});
  const score = clamp(factors.reduce((total, factor) => total + factor.delta, 0), 0, 100);
  return {score, factors};
}
export function starsFor(score) { return score >= 88 ? 5 : score >= 72 ? 4 : score >= 55 ? 3 : score >= 38 ? 2 : 1; }
export function reviewFor(spa, pack, receipt, satisfaction) {
  const stars = starsFor(satisfaction.score);
  const lines = (pack.reviewLines || []).filter(line => line.stars === stars);
  const line = pick(lines.length ? lines : pack.reviewLines || [], hash(receipt.id + ':review'));
  return {id: 'rev-' + receipt.id, day: spa.day, appointmentId: receipt.appointmentId, stars,
    text: line ? line.text : 'No comment.', satisfaction: satisfaction.score, delegated: !!receipt.delegated,
    klass: receipt.klass || receipt.namespace, factors: satisfaction.factors.slice(0, 3)};
}
export function reputationDelta(score, records = 0) {
  const base = score >= 88 ? 6 : score >= 72 ? 3 : score >= 55 ? 1 : score >= 38 ? -2 : -5;
  return base + Math.min(4, records * 2);
}

// --- settlement -------------------------------------------------------------------------------
// A receipt is written once per appointment. Re-entering with the same receipt id returns the stored
// receipt and moves no money, which is what makes interrupted appointments and replays safe.
function settle(spa, ctx, appointment, outcome, options = {}) {
  const pack = ctx.pack, receiptId = options.receiptId || ('d' + spa.day + ':' + appointment.id);
  const existing = spa.completed.find(item => item.id === receiptId);
  if (existing) return {receipt: existing, duplicate: true, review: spa.reviews.find(item => item.appointmentId === appointment.id) || null};
  const quality = QUALITY[outcome.quality] ? outcome.quality : 'clean';
  const delegated = !!options.delegated;
  const satisfaction = satisfactionFor(spa, pack, appointment, {...outcome, quality, delegated});
  const persona = pack.personalities.find(item => item.id === appointment.personality) || pack.personalities[0];
  const paid = Math.max(0, Math.round(appointment.price * QUALITY[quality].pay * (delegated ? 0.9 : 1)));
  const tipRate = clamp((satisfaction.score - 60) / 500, 0, 0.15) * (persona.tipBias || 1) * (delegated ? 0.5 : 1);
  const tip = quality === 'failed' ? 0 : Math.max(0, Math.round(paid * tipRate));
  const costs = appointmentCost(spa, appointment, pack);
  post(spa, 'rev-' + receiptId, 'appointment-revenue', paid, appointment.name);
  if (tip > 0) post(spa, 'tip-' + receiptId, 'customer-tip', tip, appointment.name);
  const paidSupplies = payOut(spa, 'sup-' + receiptId, 'supplies', costs.supplies, appointment.name);
  const paidEquipment = payOut(spa, 'eq-' + receiptId, 'equipment-use', costs.equipment, appointment.name);
  const paidCleaning = payOut(spa, 'clean-' + receiptId, 'cleaning', costs.cleaning, appointment.name);
  const spent = paidSupplies + paidEquipment + paidCleaning;
  const need = needsFor(spa, appointment, pack).need;
  for (const [key, units] of Object.entries(need)) spa.inventory[key] = Math.max(0, (spa.inventory[key] || 0) - units);
  for (const id of spa.equipment) if (spa.condition[id] !== undefined) spa.condition[id] = clamp(spa.condition[id] - 2, 10, 100);
  const records = Array.isArray(outcome.records) ? outcome.records.slice(0, 6) : [];
  const reputation = reputationDelta(satisfaction.score, records.length);
  spa.reputation = clamp(spa.reputation + reputation, 0, 1000);
  const receipt = {id: receiptId, appointmentId: appointment.id, day: spa.day, encounter: appointment.encounter,
    namespace: appointment.namespace, klass: appointment.klass, name: appointment.name, status: 'complete',
    quality, precision: clamp(int(outcome.precision), 0, 1000), discovered: int(outcome.discovered),
    chambers: int(outcome.chambers) || appointment.targets, materials: int(outcome.materials),
    releases: int(outcome.releases), volume: int(outcome.volume), durationMs: int(outcome.durationMs),
    records: records.map(item => item.metric || item), delegated, staffId: options.staffId || null,
    price: appointment.price, paid, tip, costs: spent, satisfaction: satisfaction.score,
    factors: satisfaction.factors, reputation, at: int(options.at)}
  spa.completed.unshift(receipt); spa.completed = spa.completed.slice(0, COMPLETED_LIMIT);
  const review = reviewFor(spa, pack, receipt, satisfaction);
  spa.reviews.unshift(review); spa.reviews = spa.reviews.slice(0, REVIEW_LIMIT);
  appointment.status = 'complete';
  spa.stats.appointments++;
  spa.stats.revenue += paid + tip;
  spa.stats.expenses += spent;
  if (delegated) spa.stats.delegated++;
  if (review.stars === 5) spa.stats.reviews5++;
  if (satisfaction.score >= 80 && hash(receiptId + ':return') % 3 === 0) spa.stats.returning++;
  if (satisfaction.score >= 86 && hash(receiptId + ':referral') % 4 === 0) spa.stats.referrals++;
  if (records.length) spa.stats.recordRevenue++;
  if (/vampire/.test(String(appointment.klass)) && paid + tip > spent) spa.stats.vampireProfit++;
  if (appointment.legendary && /International/.test(appointment.name)) spa.stats.international++;
  if (spa.session && spa.session.appointmentId === appointment.id) spa.session = null;
  return {receipt, review, duplicate: false, satisfaction};
}
export function completeAppointment(spa, ctx, outcome = {}) {
  if (!spa.session) return {error: 'No appointment is in progress.'};
  const appointment = spa.appointments.find(item => item.id === spa.session.appointmentId);
  if (!appointment) { spa.session = null; return {error: 'The appointment disappeared.'}; }
  return settle(spa, ctx, appointment, {...outcome, delegated: false}, {receiptId: spa.session.receiptId, at: outcome.at});
}
export function delegateAppointment(spa, ctx, appointmentId) {
  if (spa.session) return {error: 'Finish the current appointment first.'};
  const appointment = spa.appointments.find(item => item.id === appointmentId && item.status === 'queued');
  if (!appointment) return {error: 'That appointment is not available.'};
  if (appointment.legendary || appointment.boss) return {error: 'This case must be performed personally.'};
  const technician = spa.staff.filter(member => member.role === 'technician').sort((a, b) => b.skill - a.skill)[0];
  if (!technician) return {error: 'Hire an Extraction Technician first.'};
  const supplies = needsFor(spa, appointment, ctx.pack);
  if (!supplies.ok) return {error: 'Supplies are short.', missing: supplies.missing};
  const seed = hash(appointment.id + ':delegate:' + technician.id);
  const score = technician.skill * 10 + facility(spa, ctx.pack).quality * 2 - appointment.complexity * 7 + (seed % 11) - 5;
  const quality = score >= 65 ? 'perfect' : score >= 38 ? 'clean' : score >= 12 ? 'rough' : 'failed';
  const diagnostic = spa.staff.some(member => member.role === 'diagnostic');
  const result = settle(spa, ctx, appointment, {quality, precision: 0, discovered: diagnostic ? Math.min(appointment.hidden, Math.round(appointment.hidden * 0.5)) : 0,
    chambers: appointment.targets, materials: 1, releases: appointment.targets, volume: appointment.targets * 120,
    durationMs: appointment.minutes * 60000, records: [], delegated: true}, {delegated: true, staffId: technician.id, at: ctx.now});
  technician.exp = int(technician.exp) + 1;
  if (technician.exp % 3 === 0) technician.skill = clamp(technician.skill + 1, 1, 10);
  return result;
}

// --- day close and advance --------------------------------------------------------------------
export function closeDay(spa, ctx) {
  if (spa.session) return {error: 'Finish or abandon the active appointment before closing the day.'};
  const pack = ctx.pack;
  if (spa.closedDay === spa.day) return {already: true, summary: spa.history[spa.history.length - 1] || null};
  const overhead = operationalOverhead(spa, pack);
  const rent = payOut(spa, spa.day + '-rent', 'rent', overhead.rent, 'Facility rent');
  const utilities = payOut(spa, spa.day + '-utilities', 'utilities', overhead.utilities, 'Utilities');
  const wages = payOut(spa, spa.day + '-wages', 'payroll', overhead.wages, 'Staff wages');
  const maintenance = payOut(spa, spa.day + '-maintenance', 'maintenance', overhead.maintenance, 'Equipment maintenance');
  for (const id of spa.equipment) if (spa.condition[id] !== undefined) spa.condition[id] = 100;
  if (spa.autoRestock || spa.staff.some(member => member.role === 'operations')) restockToThresholds(spa, pack);
  const receipts = spa.completed.filter(item => item.day === spa.day);
  const revenue = sum(receipts, item => item.paid + item.tip);
  const expenses = sum(spa.transactions.filter(entry => entry.day === spa.day && entry.amount < 0), entry => -entry.amount);
  const profit = revenue - expenses;
  const satisfaction = receipts.length ? Math.round(sum(receipts, item => item.satisfaction) / receipts.length) : 0;
  const summary = {day: spa.day, revenue, expenses, profit, appointments: receipts.length, satisfaction,
    reputation: spa.reputation, cash: spa.cash};
  spa.history.push(summary); spa.history = spa.history.slice(-HISTORY_LIMIT);
  spa.closedDay = spa.day;
  spa.stats.days++;
  if (profit > 0) spa.stats.profitDays++;
  spa.stats.profitTotal = Math.max(0, spa.stats.profitTotal + profit);
  if (spa.recovery) spa.reputation = clamp(spa.reputation - 5, 0, 1000);
  return {summary, overhead: {...overhead, paid: {rent, utilities, wages, maintenance}}};
}
function restockToThresholds(spa, pack) {
  // Only consumables the clinic actually uses are replenished. Maintenance kits are a manual buy: an
  // automatic daily purchase of every catalogue item is how a profitable clinic goes broke.
  const threshold = {pads: 18, cartridges: 8, gel: 4, cleaning: 10, spectral: 3, environment: 3};
  for (const item of pack.supplies) {
    const limit = threshold[item.use];
    if (limit === undefined) continue;
    if ((item.tier || 1) > spa.tier) continue;
    if (item.use === 'spectral' || item.use === 'environment') { if (spa.tier < 5) continue; }
    const have = spa.inventory[item.use] || 0;
    if (have >= limit) continue;
    if (spa.cash < item.price) continue;
    post(spa, 'restock-' + spa.day + '-' + item.use, 'restock', -item.price, item.name);
    spa.inventory[item.use] = have + item.pack;
  }
}
export function advanceDay(spa, ctx) {
  if (spa.session) return {error: 'An appointment is in progress.'};
  const closed = closeDay(spa, ctx);
  if (closed.error) return closed;
  spa.day++;
  // The recovery discount applies to the queue generated for the new day, then expires.
  generateDay(spa, ctx);
  spa.recovery = 0;
  spa.pendingEvent = rollEvent(spa, ctx);
  spa.eventDay = spa.pendingEvent ? spa.day : 0;
  const tier = facility(spa, ctx.pack);
  if (tier.tier >= 5 && !spa.stats.midnightOpen) spa.stats.midnightOpen = 1;
  return {day: spa.day, appointments: spa.appointments.length, event: spa.pendingEvent, closed: closed.summary};
}
// Called when the dashboard opens. Idempotent: a day with a queue, or a day that already has a
// receipt, is never regenerated.
export function ensureDay(spa, ctx) {
  if (!spa.appointments.length && !spa.completed.some(item => item.day === spa.day)) generateDay(spa, ctx);
  if (!spa.pendingEvent && spa.eventDay !== spa.day) { spa.pendingEvent = rollEvent(spa, ctx); spa.eventDay = spa.day; }
  return spa;
}
export function acceptAssistance(spa) {
  if (spa.cash >= 300) return {error: 'Assistance is only available below 300 PB.'};
  if (spa.assistDay && spa.day - spa.assistDay < 10) return {error: 'Assistance was already used in the last ten days.'};
  spa.assistDay = spa.day; spa.recovery = 1;
  post(spa, 'assist-' + spa.day, 'business-assistance', 300, 'Fictional small-business assistance');
  spa.reputation = clamp(spa.reputation + 2, 0, 1000);
  return {granted: 300, note: 'A fictional small-business grant and discounted appointments.'};
}

// --- purchases and staff ----------------------------------------------------------------------
export function upgradeFacility(spa, pack) {
  const next = nextFacility(spa, pack);
  if (!next) return {error: 'This is already Pore World.'};
  if (spa.reputation < next.reputation) return {error: 'Reputation ' + next.reputation + ' required.'};
  if (spa.cash < next.price) return {error: 'Not enough Pore Bucks.'};
  payOut(spa, 'facility-' + next.tier, 'facility-upgrade', next.price, next.name);
  spa.tier = next.tier; spa.rooms = next.capacity; spa.stats.expansions++;
  if (next.tier >= 5) spa.stats.midnightOpen = 1;
  if (next.tier >= 7) spa.stats.international = Math.max(1, spa.stats.international);
  return {tier: next.tier, name: next.name};
}
export function buyEquipment(spa, pack, id) {
  const item = pack.spaEquipment.find(entry => entry.id === id);
  if (!item) return {error: 'Unknown equipment.'};
  if (spa.equipment.includes(id)) return {error: 'Already owned.'};
  if (item.tier > spa.tier) return {error: 'Requires facility tier ' + item.tier + '.'};
  if (spa.cash < item.price) return {error: 'Not enough Pore Bucks.'};
  payOut(spa, 'equip-' + id, 'equipment-purchase', item.price, item.name);
  spa.equipment.push(id); spa.condition[id] = 100;
  spa.stats.equipmentVariety = spa.equipment.length;
  return {id, name: item.name};
}
export function buySupplies(spa, pack, id, packs = 1) {
  const item = pack.supplies.find(entry => entry.id === id || entry.use === id);
  if (!item) return {error: 'Unknown supply.'};
  if (item.tier > spa.tier) return {error: 'Requires facility tier ' + item.tier + '.'};
  const quantity = clamp(int(packs) || 1, 1, 8);
  const bulk = quantity >= 3;
  const price = Math.round(item.price * quantity * (bulk ? 0.9 : 1));
  if (spa.cash < price) return {error: 'Not enough Pore Bucks.'};
  post(spa, 'supplies-' + item.use + '-' + spa.day + '-' + spa.ledgerSeq, 'supplies-purchase', -price, item.name + ' x' + quantity);
  spa.inventory[item.use] = clamp((spa.inventory[item.use] || 0) + item.pack * quantity, 0, 9999);
  if (bulk) spa.stats.bulkBuys++;
  return {id: item.id, packs: quantity, price, bulk};
}
export function buyMarketing(spa, pack, id) {
  const campaign = pack.marketing.find(entry => entry.id === id);
  if (!campaign) return {error: 'Unknown campaign.'};
  if (campaign.tier > spa.tier) return {error: 'Requires facility tier ' + campaign.tier + '.'};
  if (spa.marketing.some(item => item.id === id)) return {error: 'That campaign is already running.'};
  if (spa.cash < campaign.cost) return {error: 'Not enough Pore Bucks.'};
  payOut(spa, 'marketing-' + id + '-' + spa.day, 'marketing', campaign.cost, campaign.name);
  spa.marketing.push({id, untilDay: spa.day + campaign.days - 1, demand: campaign.demand});
  spa.reputation = clamp(spa.reputation + campaign.reputation, 0, 1000);
  return {id, name: campaign.name, untilDay: spa.day + campaign.days - 1};
}
export function hireStaff(spa, pack, roleId) {
  const role = pack.staffRoles.find(entry => entry.id === roleId);
  if (!role) return {error: 'Unknown role.'};
  if (role.tier > spa.tier) return {error: 'Requires facility tier ' + role.tier + '.'};
  if (spa.staff.length >= 1 + spa.rooms * 2) return {error: 'The staff lounge is full.'};
  if (spa.cash < role.wage) return {error: 'Not enough Pore Bucks for the first wage.'};
  const name = pack.staffNames[hash(spa.seed + ':' + role.id + ':' + spa.staff.length) % pack.staffNames.length];
  spa.staff.push({id: 'staff-' + (spa.staff.length + 1) + '-' + hash(name + role.id) % 999, name,
    role: role.capability === 'delegate' ? 'technician' : role.capability, roleName: role.name,
    skill: 3 + (hash(name) % 3), exp: 0, wage: role.wage, morale: 80, hiredDay: spa.day});
  spa.stats.hires++;
  return {name, role: role.name, wage: role.wage};
}
export function trainStaff(spa, pack, staffId) {
  const member = spa.staff.find(item => item.id === staffId);
  if (!member) return {error: 'Unknown employee.'};
  const cost = 200 + member.skill * 60;
  if (spa.cash < cost) return {error: 'Training costs ' + cost + ' PB.'};
  if (member.skill >= 10) return {error: 'Already at maximum skill.'};
  payOut(spa, 'train-' + staffId + '-' + spa.day, 'training', cost, member.name);
  member.skill = clamp(member.skill + 1, 1, 10); member.morale = clamp(member.morale + 5, 0, 100);
  return {name: member.name, skill: member.skill, cost};
}
export function fireStaff(spa, staffId) {
  const member = spa.staff.find(item => item.id === staffId);
  if (!member) return {error: 'Unknown employee.'};
  spa.staff = spa.staff.filter(item => item.id !== staffId);
  spa.reputation = clamp(spa.reputation - 2, 0, 1000);
  return {name: member.name};
}
export function setPricing(spa, preset) { if (!PRICING[preset]) return {error: 'Unknown pricing preset.'}; spa.pricing = preset; return {pricing: preset}; }
export function setDifficulty(spa, id) { if (!/^disgusting-day-spa:diff-/.test(id)) return {error: 'Unknown difficulty.'}; spa.difficulty = id; return {difficulty: id}; }
export function setAutoRestock(spa, value) { spa.autoRestock = !!value; return {autoRestock: spa.autoRestock}; }

// --- business events --------------------------------------------------------------------------
const EVENT_CHOICES = {
  'ev-demand': [['Open late', 'One more appointment slot today.'], ['Keep normal hours', 'Reputation +1 for reliability.']],
  'ev-discount': [['Stock up', 'Two free packs of pads and cartridges.'], ['Pass', 'No change.']],
  'ev-maintenance': [['Pay for a service', '150 PB, all equipment restored.'], ['Defer', 'Condition -20, reputation -2.']],
  'ev-celebrity': [['Accept the referral', 'A premium celebrity appointment is added.'], ['Decline politely', 'Reputation +1.']],
  'ev-publicity': [['Pose for the photograph', 'Reputation +6, 50 PB for prints.'], ['Stay clinical', 'Reputation +1.']],
  'ev-training': [['Send the team', '200 PB, one employee gains a skill point.'], ['Skip', 'No change.']],
  'ev-competitor': [['Run a counter-campaign', '150 PB, demand +1 next day.'], ['Ignore them', 'Demand -1 today, reputation +1.']],
  'ev-viral': [['Ride the algorithm', 'Demand +2 today, reputation +5.'], ['Stay professional', 'Reputation +2.']],
  'ev-midnight': [['Open at midnight', 'A supernatural appointment is added.'], ['Close on time', 'Reputation +1.']],
  'ev-insurance': [['Fight the claim', '100 PB, reputation +3.'], ['Pay it out', '250 PB, reputation -1.']],
  'ev-werewolves': [['Seat them', 'One fewer slot today, reputation +5.'], ['Reschedule', 'Reputation -2.']],
  'ev-legendary': [['Accept the referral', 'A legendary appointment is added.'], ['Refer it on', 'Reputation +2.']]
};
export function rollEvent(spa, pack) {
  if (hash(spa.seed + ':event:' + spa.day) % 100 >= 32) return null;
  const pool = (pack.businessEvents || []).filter(item => !item.tier || item.tier <= spa.tier);
  if (!pool.length) return null;
  const total = sum(pool, item => item.weight || 1);
  let ticket = hash(spa.seed + ':eventpick:' + spa.day) % total;
  let chosen = pool[0];
  for (const item of pool) { ticket -= item.weight || 1; if (ticket < 0) { chosen = item; break; } }
  const choices = (EVENT_CHOICES[chosen.id] || [['Acknowledge', 'No change.'], ['Ignore', 'No change.']]).map(([label, note], index) => ({index, label, note}));
  return {id: chosen.id, day: spa.day, name: chosen.name, note: chosen.note, choices};
}
export function resolveEvent(spa, ctx, choice = 0) {
  const pending = spa.pendingEvent;
  if (!pending) return {error: 'No pending event.'};
  const pack = ctx.pack, id = pending.id, day = spa.day, tag = 'event-' + day + '-' + id + '-' + choice;
  const addSpecial = (definition, price) => {
    const appointment = {id: 'd' + day + '-E' + (spa.appointments.length + 1), day, encounter: definition.encounter,
      name: definition.name, namespace: definition.encounter.split(':')[0], region: 'referral', klass: null,
      targets: 4, hidden: 2, tier: Math.max(1, spa.tier), boss: false, legendary: true,
      legendaryPrice: price, complexity: 9, minutes: 40, personality: 'disgusting-day-spa:persona-celebrity',
      persona: 'Referred client', expectation: 'A referral with opinions.', seed: hash(tag) >>> 0, status: 'queued', source: 'event'};
    appointment.price = quote(spa, appointment, pack);
    appointment.cost = appointmentCost(spa, appointment, pack);
    spa.appointments = [...spa.appointments, appointment].slice(0, QUEUE_LIMIT);
    return appointment;
  };
  let result = {id, choice};
  if (id === 'ev-demand') { if (choice === 0) spa.appointments = spa.appointments.slice(0, 11); else spa.reputation = clamp(spa.reputation + 1, 0, 1000); }
  else if (id === 'ev-discount') { if (choice === 0) { spa.inventory.pads += 40; spa.inventory.cartridges += 20; } }
  else if (id === 'ev-maintenance') { if (choice === 0) payOut(spa, tag, 'maintenance', 150, 'Emergency service'); else { for (const key of Object.keys(spa.condition)) spa.condition[key] = clamp(spa.condition[key] - 20, 10, 100); spa.reputation = clamp(spa.reputation - 2, 0, 1000); } }
  else if (id === 'ev-celebrity') { if (choice === 0) result.appointment = addSpecial({encounter: 'world-book-of-pores:spaghetti', name: 'Celebrity walk-in'}, 1600); else spa.reputation = clamp(spa.reputation + 1, 0, 1000); }
  else if (id === 'ev-publicity') { if (choice === 0) { payOut(spa, tag, 'marketing', 50, 'Photograph prints'); spa.reputation = clamp(spa.reputation + 6, 0, 1000); } else spa.reputation = clamp(spa.reputation + 1, 0, 1000); }
  else if (id === 'ev-training') { if (choice === 0 && spa.staff.length) { payOut(spa, tag, 'training', 200, 'Team training'); const member = spa.staff[hash(tag) % spa.staff.length]; member.skill = clamp(member.skill + 1, 1, 10); } }
  else if (id === 'ev-competitor') { if (choice === 0) { payOut(spa, tag, 'marketing', 150, 'Counter-campaign'); spa.marketing.push({id: 'event-competitor', untilDay: day + 1, demand: 1}); } else spa.reputation = clamp(spa.reputation + 1, 0, 1000); }
  else if (id === 'ev-viral') { if (choice === 0) { spa.marketing.push({id: 'event-viral', untilDay: day, demand: 2}); spa.reputation = clamp(spa.reputation + 5, 0, 1000); spa.stats.viral++; } else spa.reputation = clamp(spa.reputation + 2, 0, 1000); }
  else if (id === 'ev-midnight') { if (choice === 0) result.appointment = addSpecial({encounter: 'midnight-clinic:ghost-follicle', name: 'Midnight drop-in'}, 1200); else spa.reputation = clamp(spa.reputation + 1, 0, 1000); }
  else if (id === 'ev-insurance') { if (choice === 0) { payOut(spa, tag, 'insurance', 100, 'Dispute filing'); spa.reputation = clamp(spa.reputation + 3, 0, 1000); } else { payOut(spa, tag, 'insurance', 250, 'Claim settlement'); spa.reputation = clamp(spa.reputation - 1, 0, 1000); } }
  else if (id === 'ev-werewolves') { if (choice === 0) { spa.appointments = spa.appointments.slice(0, 11); spa.reputation = clamp(spa.reputation + 5, 0, 1000); } else spa.reputation = clamp(spa.reputation - 2, 0, 1000); }
  else if (id === 'ev-legendary') { if (choice === 0) result.appointment = addSpecial({encounter: 'world-book-of-pores:finale', name: 'Legendary referral'}, 2400); else spa.reputation = clamp(spa.reputation + 2, 0, 1000); }
  spa.pendingEvent = null;
  return result;
}

export function andiCrossover(spa) {
  if (spa.andi) return {already: true};
  spa.andi = 1;
  spa.reputation = clamp(spa.reputation + 15, 0, 1000);
  spa.marketing.push({id: 'andi-chicago', untilDay: spa.day + 5, demand: 1});
  return {already: false, note: 'Andi sends a Chicago referral and the Alley Cat Council as unofficial security.'};
}

// --- achievements and reporting ---------------------------------------------------------------
export function achievementsFor(spa, pack) {
  return (pack.spaAchievements || []).filter(def => (spa.stats[def.stat] || 0) >= (def.threshold || 1));
}
export function summary(spa, pack) {
  const receipts = spa.completed.filter(item => item.day === spa.day);
  const revenue = sum(receipts, item => item.paid + item.tip);
  const expenses = sum(spa.transactions.filter(entry => entry.day === spa.day && entry.amount < 0), entry => -entry.amount);
  const next = nextFacility(spa, pack);
  const tier = facility(spa, pack);
  const low = Object.entries(spa.inventory).filter(([key, value]) => ['pads', 'cartridges', 'gel', 'cleaning'].includes(key) && value <= 1).map(([key]) => key);
  return {day: spa.day, cash: spa.cash, tier: spa.tier, tierName: tier.name, reputation: spa.reputation,
    capacity: clamp(tier.capacity + demandBonus(spa, pack), 2, 12), queued: spa.appointments.filter(item => item.status === 'queued').length,
    done: receipts.length, revenue, expenses, profit: revenue - expenses,
    next: next ? {name: next.name, price: next.price, reputation: next.reputation, ready: spa.reputation >= next.reputation && spa.cash >= next.price} : null,
    low, staff: spa.staff.length, trophies: spa.trophyCount || 0, session: !!spa.session};
}
export function revenueBy(spa, key) {
  const groups = {};
  for (const receipt of spa.completed) {
    const name = key === 'class' ? (receipt.klass || receipt.namespace) : key === 'category' ? (receipt.delegated ? 'Delegated' : 'Personal') : receipt.namespace;
    groups[name] = (groups[name] || 0) + receipt.paid + receipt.tip;
  }
  return groups;
}
export function chartSeries(spa, limit = 14) {
  return spa.history.slice(-limit).map(row => ({day: row.day, revenue: row.revenue, expenses: row.expenses, profit: row.profit, satisfaction: row.satisfaction}));
}
export function reviewTrend(spa) {
  const recent = spa.reviews.slice(0, 12);
  return recent.length ? Math.round(sum(recent, item => item.stars) / recent.length * 10) / 10 : 0;
}
