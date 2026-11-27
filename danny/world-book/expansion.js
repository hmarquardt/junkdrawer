// Dani the Pimple Popper 1.4 — The World Book of Pores.
// One telemetry contract, one record service, one trophy room, and the challenge layer that uses
// them. The base campaign, The Pore Explorer and The Midnight Clinic all report into this module.
import {content} from '../content.js';
import {createTelemetry, quantize, METRIC_RULES} from '../telemetry.js';
import {normalizeWorld, evaluate, commit, tierFor, bookRows, ALL_METRICS} from '../records.js';
import {earnAchievements} from '../progression.js';
import * as deep from '../pore-explorer/expansion.js';

const NS = 'world-book-of-pores';
const CAMPAIGN = NS + ':legendary';
const CHALLENGE = NS + ':challenge';
const GAUNTLET = NS + ':gauntlet';
const esc = text => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const hash = text => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; };
const now = () => Date.now();
let api = null, mounted = false, panel = null, telemetry = createTelemetry();
let runtime = {sessionEncounters: 0, phased: 0, core: 0, low: false};

// ---------------------------------------------------------------------------------------------
// Pack wrappers: the shared engine owns simulation, the clinic owns its panel, the book owns this.
export function attach(context) {
  api = context;
  api.observe = observe;
  deep.attach({...context, packs: ['pore-explorer', 'midnight-clinic', NS]});
}
export const decorate = (...args) => deep.decorate(...args);
export const flow = (...args) => deep.flow(...args);
export const overlay = (...args) => deep.overlay(...args);
export const setMode = (...args) => deep.setMode(...args);
export const startScan = (...args) => deep.startScan(...args);
export const stopScan = (...args) => deep.stopScan(...args);
export const aim = (...args) => deep.aim(...args);
export const nudge = (...args) => deep.nudge(...args);
export const pickNode = (...args) => deep.pickNode(...args);
export const progressOf = (...args) => deep.progressOf(...args);
export const toolEquipped = id => deep.toolEquipped(id);
export const report = visit => deep.report(visit);
export const overlayContext = () => deep.overlayContext();
export function active() { return String(api?.visit()?.mode?.id || '').startsWith(NS + ':'); }
export function mount() {
  deep.mount();
  if (mounted) return;
  mounted = true;
  const host = document.querySelector('.console');
  if (!host) return;
  panel = document.createElement('section');
  panel.className = 'world-panel'; panel.id = 'worldPanel'; panel.hidden = true;
  panel.innerHTML = '<div class="panel-head"><h2><svg aria-hidden="true"><use href="#book"/></svg>World Book</h2><span class="tiny" id="worldCount">0 RECORDS</span></div>' +
    '<div class="world-body"><p class="tiny" id="worldToday">Loading today\u2019s disaster…</p>' +
    '<button class="secondary" id="worldOpen">Open the record book</button></div>';
  host.append(panel);
  panel.querySelector('#worldOpen').onclick = () => openHub();
  updatePanel();
}

// ---------------------------------------------------------------------------------------------
// Session lifecycle. Telemetry is started by the game, fed by the shared engine, and finished when
// a case closes. Nothing here runs inside the render loop or writes to storage per frame.
export function startSession(meta) {
  runtime = {sessionEncounters: runtime.sessionEncounters, phased: 0, core: 0, low: false};
  telemetry.start({...meta, now: now()});
}
export function abortSession() { telemetry.abort(); }
export function observe(event) {
  if (!event || !telemetry.active()) return;
  if (event.type === 'release') {
    runtime.phased += event.phased || 0;
    runtime.core = Math.max(runtime.core, event.core || 0);
  }
  if (event.type === 'gate-cleared') runtime.core = Math.max(runtime.core, event.core || 0);
  telemetry.event(event);
}
export function sessionOpen() { return telemetry.active(); }
function world(profile = api.profile()) {
  profile.world = normalizeWorld(profile.world, profile);
  return profile.world;
}
function definitions() { return content.list('records').filter(record => String(record.id).startsWith(NS + ':')); }
function trophies() { return content.list('trophies').filter(item => String(item.id).startsWith(NS + ':')); }
function comment(event, salt = '') {
  const lines = content.list('commentary').filter(line => line.event === event && String(line.id).startsWith(NS + ':'));
  return lines.length ? lines[hash(event + ':' + salt) % lines.length].text : '';
}
// The eight supernatural classifications are measured from the same contract as everything else.
function supernaturalValues(snapshot, meta) {
  const values = {};
  const klass = meta.klass || 'base';
  const supernatural = !['base', '', 'pore-explorer', null, undefined].includes(klass);
  if (klass === 'alien') values.alienExtraction = snapshot.values.singleExtraction;
  values.regenerationStages = snapshot.regenerated || 0;
  values.phaseReleases = runtime.phased;
  values.sporeOutlets = snapshot.values.outletBurst || 0;
  values.crystalSize = snapshot.coreSize || runtime.core;
  values.sessionEncounters = runtime.sessionEncounters;
  if (meta.lunar) values.lunarScore = snapshot.values.composite;
  if (supernatural) values.supernaturalComposite = snapshot.values.composite;
  return values;
}
function tierRank(tier) { return ['bronze', 'silver', 'gold', 'platinum', 'legendary'].indexOf(tier); }
function evaluateTrophies(profile, worldState) {
  const owned = new Set(worldState.trophies), fresh = [];
  const defs = definitions();
  for (const trophy of trophies()) {
    if (owned.has(trophy.id)) continue;
    let earned = false;
    if (trophy.kind === 'stat') earned = (profile.stats[trophy.stat] || 0) >= (trophy.threshold || 1);
    else if (trophy.kind === 'achievement') earned = profile.achievements.includes(trophy.achievement);
    else if (trophy.kind === 'record') {
      const definition = defs.find(item => item.metric === trophy.metric);
      const value = worldState.best[trophy.metric] || 0;
      earned = !!definition && value > 0 && tierRank(tierFor(definition, value)) >= tierRank(trophy.tier || 'bronze');
    }
    if (earned) { owned.add(trophy.id); fresh.push(trophy); }
  }
  worldState.trophies = [...owned].slice(0, 96);
  profile.stats.trophiesEarned = worldState.trophies.length;
  return fresh;
}
function recordHighlight(snapshot, meta, fresh) {
  if (!snapshot) return;
  world().highlight = {
    encounter: meta.encounter, seed: meta.seed, klass: meta.klass || null, at: now(),
    values: {...snapshot.values}, releases: snapshot.releases,
    events: snapshot.events.slice(0, 24), best: fresh.slice(0, 3).map(item => item.metric)
  };
}

// ---------------------------------------------------------------------------------------------
// Completion: evaluate, commit, award, and advance any challenge or gauntlet that was running.
function conditionFor(visit) {
  const patient = visit.encounter.patient ? content.get('patients', visit.encounter.patient) : null;
  const id = visit.encounter.condition || patient?.condition;
  if (!id) return null;
  try { return content.get('conditions', id); } catch { return null; }
}
export function completeEncounter(extra = {}) {
  const profile = api.profile(), visit = api.visit();
  if (!telemetry.active() || !visit) return null;
  const patient = visit.encounter.patient ? content.get('patients', visit.encounter.patient) : null;
  const namespace = visit.mode.id.split(':')[0];
  const klasse = patient?.klass || (namespace === 'midnight-clinic' ? 'crossover' : namespace);
  const condition = conditionFor(visit);
  const stamp = now();
  const meta = {namespace, encounter: visit.encounter.id, seed: visit.seed, klass: klasse,
    region: visit.region?.id || null, equipment: profile.tool, lunar: !!condition?.moon, points: extra.points || 0,
    now: stamp, at: stamp};
  const base = telemetry.snapshot({points: meta.points, streak: visit.run.streak});
  const metrics = supernaturalValues(base, meta);
  const snapshot = telemetry.finish({points: meta.points, streak: visit.run.streak, metrics, now: meta.now,
    quality: extra.perfect ? 'perfect' : 'clean'});
  const w = world(profile);
  const results = evaluate(snapshot, definitions(), w);
  const fresh = commit(w, results, meta);
  profile.stats.recordsSet = (profile.stats.recordsSet || 0) + fresh.length;
  profile.stats.recordBeats = (profile.stats.recordBeats || 0) + fresh.length;
  profile.stats.platinumRecords = (profile.stats.platinumRecords || 0) + fresh.filter(item => ['platinum', 'legendary'].includes(item.tier)).length;
  profile.stats.legendaryRecords = (profile.stats.legendaryRecords || 0) + fresh.filter(item => item.tier === 'legendary').length;
  profile.stats.discoveredBest = Math.max(profile.stats.discoveredBest || 0, snapshot.values.discovered);
  profile.stats.historyEntries = w.history.length;
  runtime.sessionEncounters++;
  let outcome = null;
  if (namespace === NS) {
    w.legendary = [...new Set([...w.legendary, meta.encounter])].slice(0, 16);
    profile.stats.legendaryDone = w.legendary.length;
  }
  outcome = advanceChallenge(profile, w, snapshot);
  const earned = earnAchievements(profile);
  const freshTrophies = evaluateTrophies(profile, w);
  recordHighlight(snapshot, meta, fresh);
  api.save();
  lastSnapshot = snapshot; lastFresh = fresh;
  lastResult = {encounter: meta.encounter, patientClass: klasse, complexity: visit.difficulty || 1,
    status: 'complete', quality: extra.perfect ? 'perfect' : 'clean',
    extraction: {releases: snapshot.releases, volume: snapshot.values.encounterTotal},
    equipment: profile.tool, durationMs: snapshot.durationMs, precision: {perfect: Math.round(snapshot.values.precision * snapshot.releases / 1000), attempts: snapshot.releases},
    discovery: {found: snapshot.values.discovered, chambers: snapshot.chambers}, materials: snapshot.materialsSeen,
    scoringRules: visit.mode.scoring, rulesVersion: METRIC_RULES, points: meta.points};
  announce(w, fresh, earned, freshTrophies);
  return {snapshot, fresh, earned, trophies: freshTrophies, outcome};
}
function announce(w, fresh, earned, freshTrophies) {
  if (!w.flags.live || document.getElementById('dialog')?.open) return;
  if (!fresh.length && !earned.length && !freshTrophies.length) return;
  const record = fresh[0];
  const line = record
    ? comment('record', record.metric) + ' ' + (ALL_METRICS[record.metric]?.name || record.metric) + ' \u00b7 ' + record.value + (record.tier ? ' (' + record.tier + ')' : '')
    : earned[0] ? 'Achievement: ' + earned[0].name
    : 'Trophy earned: ' + freshTrophies[0].name;
  api.cue(line);
}
function advanceChallenge(profile, w, snapshot) {
  const pending = w.pending;
  if (!pending) return null;
  const score = Math.max(0, snapshot.values[pending.metric] || 0);
  if (pending.kind === 'daily') {
    const previous = w.daily[pending.key] || null;
    if (!previous || score > previous.score) w.daily[pending.key] = {id: pending.challengeId, score, at: now(), seed: pending.seed, rules: METRIC_RULES, encounter: pending.encounter};
    profile.stats.dailies = Object.keys(w.daily).length;
    w.pending = null;
    return {kind: 'daily', key: pending.key, score, best: w.daily[pending.key].score};
  }
  if (pending.kind === 'weekly') {
    const week = w.weekly[pending.key] || {scores: [0, 0, 0], at: now(), rules: METRIC_RULES};
    week.scores[pending.index] = Math.max(week.scores[pending.index] || 0, score);
    week.total = week.scores.reduce((sum, value) => sum + value, 0);
    week.at = now(); w.weekly[pending.key] = week;
    if (week.scores.every(value => value > 0) && !week.done) {
      week.done = 1;
      profile.stats.weeklies = Object.values(w.weekly).filter(item => item.done).length;
    }
    w.pending = null;
    return {kind: 'weekly', key: pending.key, index: pending.index, score, week};
  }
  if (pending.kind === 'gauntlet') {
    const gauntlet = content.get('chapters', pending.chapter);
    const step = pending.step;
    if (step + 1 < gauntlet.encounters.length) {
      w.pending = {...pending, step: step + 1};
      return {kind: 'gauntlet', id: pending.id, next: gauntlet.encounters[step + 1], step: step + 1, done: false};
    }
    w.gauntlet[pending.id] = {done: 1, at: now()};
    profile.stats.gauntletsDone = Object.values(w.gauntlet).filter(item => item.done).length;
    w.pending = null;
    return {kind: 'gauntlet', id: pending.id, done: true};
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Deterministic challenges. The UTC date (or ISO week) plus the rules version and the installed
// content fully determine a challenge; generation works offline and never needs a server.
const dateKey = (date = new Date()) => date.toISOString().slice(0, 10);
export function weekKey(date = new Date()) {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const first = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc - first) / 86400000) + 1) / 7);
  return utc.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}
const templates = () => content.list('challenges').filter(item => String(item.id).startsWith(NS + ':')).sort((a, b) => a.id.localeCompare(b.id));
export function challengeFor(key = dateKey()) {
  const pool = templates();
  if (!pool.length) return null;
  const pick = pool[hash(key + ':template') % pool.length];
  return {id: pick.id, key, category: pick.category, name: pick.name, encounter: pick.encounter,
    metric: pick.metric, modifier: pick.modifier || {}, seed: hash(key + ':seed') >>> 0, rules: METRIC_RULES};
}
export function weeklyChallenges(key = weekKey()) {
  const pool = templates();
  if (!pool.length) return [];
  return [0, 1, 2].map(index => {
    const pick = pool[hash(key + ':weekly:' + index) % pool.length];
    return {id: pick.id, key, index, category: pick.category, name: pick.name, encounter: pick.encounter,
      metric: pick.metric, modifier: pick.modifier || {}, seed: hash(key + ':seed:' + index) >>> 0, rules: METRIC_RULES};
  });
}
function beginChallenge(def, pending) {
  const w = world();
  w.pending = pending;
  api.save();
  api.replayEncounter(CHALLENGE, def.encounter, def.seed);
  api.close();
  api.cue((def.name || 'Challenge') + ': ' + (def.category || def.metric) + '. ' + (pending.kind === 'weekly' ? 'Championship attempt.' : 'Deterministic session.'));
}
export function startDaily(key = dateKey()) {
  const def = challengeFor(key);
  if (!def) return null;
  beginChallenge(def, {kind: 'daily', key, challengeId: def.id, encounter: def.encounter, seed: def.seed,
    metric: def.metric, modifier: def.modifier, rules: METRIC_RULES});
}
export function startWeekly(key = weekKey(), index = 0) {
  const list = weeklyChallenges(key);
  const def = list[index];
  if (!def) return null;
  beginChallenge(def, {kind: 'weekly', key, index, challengeId: def.id, encounter: def.encounter,
    seed: def.seed, metric: def.metric, modifier: def.modifier, rules: METRIC_RULES});
}
export function continueGauntlet() {
  const w = world(), pending = w.pending;
  if (!pending || pending.kind !== 'gauntlet') return false;
  const chapter = content.get('chapters', pending.chapter);
  const encounter = chapter.encounters[pending.step];
  if (!encounter) return false;
  api.replayEncounter(GAUNTLET, encounter, content.get('encounters', encounter).seed);
  api.close();
  return true;
}
const GAUNTLET_RESTRICT = {[NS + ':gauntlet-instrument']: 'pore-explorer:vortex'};
export function startGauntlet(chapterId) {
  const chapter = content.get('chapters', chapterId);
  const encounter = chapter.encounters[0];
  const w = world();
  w.pending = {kind: 'gauntlet', id: chapterId, chapter: chapterId, step: 0,
    modifier: {restrict: GAUNTLET_RESTRICT[chapterId] || null}, rules: METRIC_RULES};
  api.save();
  api.replayEncounter(GAUNTLET, encounter, content.get('encounters', encounter).seed);
  api.close();
  api.cue(chapter.name + ': stage 1 of ' + chapter.encounters.length + '.');
}
export function startLegendary() { api.selectMode(CAMPAIGN); api.close(); api.cue('Legendary encounters. Eight appointments, every mechanic.'); }
export function toolLocked(id) {
  const w = api?.profile()?.world;
  const pending = w?.pending;
  if (!pending || pending.kind === 'gauntlet') {
    const restrict = w?.pending?.modifier?.restrict;
    return !!restrict && restrict === id;
  }
  return pending.modifier?.restrict === id;
}

// ---------------------------------------------------------------------------------------------
// Sharing. Codes are tiny, validated payloads: no URLs, no executable content, no unknown ids.
const b64u = {
  encode(text) { return btoa(unescape(encodeURIComponent(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  decode(text) { return decodeURIComponent(escape(atob(text.replace(/-/g, '+').replace(/_/g, '/')))); }
};
export function encodeChallenge(def) {
  return 'WBP1.' + b64u.encode(JSON.stringify({v: 1, rules: METRIC_RULES, enc: def.encounter, seed: def.seed, mod: def.modifier || {}}));
}
export function decodeChallenge(code) {
  if (typeof code !== 'string' || code.length < 12 || code.length > 600 || !code.startsWith('WBP1.')) throw Error('Not a World Book challenge code.');
  let payload;
  try { payload = JSON.parse(b64u.decode(code.slice(5))); } catch { throw Error('The challenge code is damaged.'); }
  if (!payload || payload.v !== 1) throw Error('Unsupported challenge schema.');
  if (!Number.isInteger(payload.rules) || payload.rules < 1 || payload.rules > METRIC_RULES) throw Error('Unsupported challenge rules version.');
  if (typeof payload.enc !== 'string' || !/^[a-z][\w-]*:[a-z][\w-]*$/.test(payload.enc)) throw Error('Invalid encounter identifier.');
  let encounter; try { encounter = content.get('encounters', payload.enc); } catch { throw Error('That encounter is not installed.'); }
  if (!Number.isInteger(payload.seed) || payload.seed < 0 || payload.seed > 4294967295) throw Error('Invalid seed.');
  const mod = payload.mod && typeof payload.mod === 'object' ? payload.mod : {};
  const allowed = ['restrict', 'condition', 'noScan'];
  for (const key of Object.keys(mod)) if (!allowed.includes(key)) throw Error('Unsupported challenge modifier.');
  if (mod.restrict) { try { content.get('equipment', mod.restrict); } catch { throw Error('Unknown equipment restriction.'); } }
  if (mod.condition) { try { content.get('conditions', mod.condition); } catch { throw Error('Unknown environment modifier.'); } }
  if (mod.noScan !== undefined && typeof mod.noScan !== 'boolean') throw Error('Invalid modifier.');
  return {encounter: payload.enc, seed: payload.seed, modifier: mod, rules: payload.rules, name: encounter.name};
}
export function startShared(code) {
  const def = decodeChallenge(code);
  beginChallenge({...def, category: 'shared', id: 'shared'},
    {kind: 'daily', key: 'shared:' + (hash(code) % 100000), challengeId: 'shared', encounter: def.encounter,
      seed: def.seed, metric: 'encounterTotal', modifier: def.modifier, rules: def.rules});
  return def;
}
export function encodeResult(def, score, stats = {}, nickname = '') {
  return 'WBR1.' + b64u.encode(JSON.stringify({v: 1, rules: METRIC_RULES, enc: def.encounter, seed: def.seed,
    score: Math.max(0, Math.round(score)), stats: {...stats}, nick: String(nickname).slice(0, 24), game: '1.4'}));
}
export function importResult(code) {
  if (typeof code !== 'string' || !code.startsWith('WBR1.') || code.length > 900) throw Error('Not a World Book result code.');
  let payload; try { payload = JSON.parse(b64u.decode(code.slice(5))); } catch { throw Error('The result code is damaged.'); }
  if (!payload || payload.v !== 1) throw Error('Unsupported result schema.');
  if (typeof payload.enc !== 'string' || !/^[a-z][\w-]*:[a-z][\w-]*$/.test(payload.enc)) throw Error('Invalid result encounter.');
  if (!Number.isInteger(payload.score) || payload.score < 0) throw Error('Invalid result score.');
  const w = world();
  w.imported = [{enc: payload.enc, score: payload.score, nick: String(payload.nick || 'anonymous').slice(0, 24),
    rules: payload.rules || 0, at: now(), verified: 0}, ...w.imported].slice(0, 5);
  api.save();
  return w.imported[0];
}

// ---------------------------------------------------------------------------------------------
// Presentation: one mobile-friendly hub, generated certificates, and bounded highlight summaries.
const FORMAT = {centi: value => (value / 100).toFixed(2), count: value => String(value), permille: value => (value / 10).toFixed(1) + '%'};
function formatMetric(metric, value) {
  const unit = ALL_METRICS[metric]?.unit || 'count';
  if (unit.includes('centi')) return FORMAT.centi(value) + ' u';
  if (unit === 'per-mille') return FORMAT.permille(value);
  return String(value);
}
function campaignOf(meta) {
  if (!meta?.namespace) return 'legacy';
  if (meta.namespace.startsWith('midnight')) return 'midnight';
  if (meta.namespace.startsWith('pore')) return 'pore';
  if (meta.namespace.startsWith('world-book')) return 'book';
  return 'base';
}
const CAMPAIGN_LABEL = {base: 'Base campaign', pore: 'Pore Explorer', midnight: 'Midnight Clinic', book: 'World Book', legacy: 'Legacy record'};
let filter = {campaign: 'all', classification: 'all', tier: 'all'};
let lastResult = null, lastSnapshot = null, lastFresh = [];

export function openHub(section = 'records') {
  const profile = api.profile(), w = world(profile);
  const definitionsList = definitions();
  const rows = bookRows(w, definitionsList);
  const owned = new Set(w.trophies);
  const recordCount = rows.filter(row => row.value > 0).length;
  const daily = challengeFor();
  const dailyResult = w.daily[daily?.key] || null;
  const week = weekKey(), weekly = weeklyChallenges(week), weeklyResult = w.weekly[week] || null;
  const legendary = content.list('encounters').filter(item => item.id.startsWith(NS + ':') && item.id !== NS + ':ratfather-referral');
  const gauntlets = content.list('chapters').filter(item => item.id.startsWith(NS + ':gauntlet-'));
  const filterRow = (name, values, current) => '<label>' + name + ' <select data-filter="' + name.toLowerCase() + '">' +
    ['all', ...values].map(value => '<option value="' + esc(value) + '"' + (current === value ? ' selected' : '') + '>' + esc(value) + '</option>').join('') + '</select></label>';
  const visible = rows.filter(row => {
    const campaign = campaignOf(row.meta);
    return (filter.campaign === 'all' || filter.campaign === campaign) &&
      (filter.classification === 'all' || filter.classification === row.classification) &&
      (filter.tier === 'all' || filter.tier === (row.tier || 'none'));
  });
  const recordsHTML = '<div class="book-filters">' +
    filterRow('Campaign', ['base', 'pore', 'midnight', 'book', 'legacy'], filter.campaign) +
    filterRow('Class', ['core', 'supernatural'], filter.classification) +
    filterRow('Tier', ['bronze', 'silver', 'gold', 'platinum', 'legendary', 'legacy', 'none'], filter.tier) + '</div>' +
    visible.map(row => {
      const meta = row.meta || {};
      return '<div class="book-row"><div class="book-main"><strong>' + esc(row.name) + '</strong>' +
        '<small>' + esc(row.classification) + ' \u00b7 ' + esc(CAMPAIGN_LABEL[campaignOf(meta)]) + (meta.legacy ? ' \u00b7 LEGACY (metadata unavailable)' : '') + '</small></div>' +
        '<div class="book-value"><b>' + (row.value ? formatMetric(row.metric, row.value) : '\u2014') + '</b>' +
        (row.tier ? '<i class="tier ' + esc(row.tier) + '">' + esc(row.tier) + '</i>' : '') + '</div>' +
        '<div class="book-meta">' + (meta.at ? new Date(meta.at).toISOString().slice(0, 10) : 'date unavailable') +
        (meta.equipment ? ' \u00b7 ' + esc(meta.equipment.split(':').pop()) : '') +
        (meta.seed ? ' \u00b7 seed ' + meta.seed : '') + '</div>' +
        (row.value ? '<button class="secondary" data-cert="' + esc(row.metric) + '">Certificate</button>' : '') + '</div>';
    }).join('') +
    '<p class="tiny">' + visible.length + ' of ' + rows.length + ' classifications. Blank values are unrecorded, never estimated.</p>';
  const trophiesHTML = '<div class="trophy-grid">' + trophies().map(trophy =>
    '<figure class="trophy ' + (owned.has(trophy.id) ? 'owned' : '') + '"' + (trophy.hidden && !owned.has(trophy.id) ? ' data-hidden="1"' : '') + '>' +
    '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M20 10h24v10a12 12 0 0 1-24 0z" fill="' + (owned.has(trophy.id) ? '#cefa80' : 'none') + '" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M20 14H12v6a8 8 0 0 0 8 8M44 14h8v6a8 8 0 0 1-8 8M32 32v12M24 50h16" fill="none" stroke="currentColor" stroke-width="2"/></svg>' +
    '<figcaption>' + (trophy.hidden && !owned.has(trophy.id) ? 'Hidden trophy' : esc(trophy.name)) + '</figcaption></figure>').join('') + '</div>' +
    '<p class="tiny">' + w.trophies.length + ' of ' + trophies().length + ' earned. Trophies are evaluated from local records and achievements only.</p>';
  const dailyHTML = daily ? '<p><strong>' + esc(daily.name) + '</strong> \u00b7 ' + esc(daily.category) + ' \u00b7 ' + esc(content.get('encounters', daily.encounter).name) + '</p>' +
    '<p class="tiny">Seed ' + daily.seed + ' \u00b7 rules v' + daily.rules + ' \u00b7 metric ' + esc(daily.metric) + '</p>' +
    '<p>' + (dailyResult ? 'Best this date: <strong>' + formatMetric(daily.metric, dailyResult.score) + '</strong>' : 'Not attempted yet.') + '</p>' +
    '<div class="dialog-actions"><button class="primary" data-daily="1">' + (dailyResult ? 'Replay today\u2019s disaster' : 'Run today\u2019s disaster') + '</button>' +
    '<button class="secondary" data-share="daily">Copy challenge code</button></div>' : '<p>No challenge templates installed.</p>';
  const history = Object.keys(w.daily).sort().reverse().slice(0, 14).map(key =>
    '<div class="book-row"><strong>' + key + '</strong><small>' + esc(w.daily[key].id || 'daily') + ' \u00b7 seed ' + (w.daily[key].seed ?? 'legacy') + '</small>' +
    '<button class="secondary" data-replay-daily="' + esc(key) + '">Replay</button></div>').join('') || '<p class="tiny">No daily history yet.</p>';
  const weeklyHTML = '<h3>' + week + '</h3>' + weekly.map((def, index) =>
    '<div class="book-row"><strong>' + esc(def.name) + '</strong><small>' + esc(def.category) + '</small>' +
    '<b>' + formatMetric(def.metric, weeklyResult?.scores?.[index] || 0) + '</b>' +
    '<button class="secondary" data-weekly="' + index + '">Run</button></div>').join('') +
    '<p class="tiny">Championship total ' + (weeklyResult?.total || 0) + ' \u00b7 UTC week \u00b7 local scores only, never presented as a global ranking.</p>' +
    '<h3>History</h3>' + (Object.keys(w.weekly).sort().reverse().slice(0, 8).map(key => '<div class="book-row"><strong>' + key + '</strong><b>' + (w.weekly[key].total || 0) + '</b><small>' + (w.weekly[key].done ? 'complete' : 'in progress') + '</small></div>').join('') || '<p class="tiny">No championships yet.</p>');
  const legendaryHTML = '<p>Eight authored encounters that combine every mechanic. Clearing one adds it to the book.</p>' +
    legendary.map(encounter => '<div class="book-row"><strong>' + esc(encounter.name) + '</strong><small>' + esc(content.get('regions', encounter.region).name) + ' \u00b7 ' + encounter.count + ' targets</small>' +
    '<b>' + (w.legendary.includes(encounter.id) ? 'CLEARED' : '') + '</b></div>').join('') +
    '<div class="dialog-actions"><button class="primary" data-legendary="1">' + (w.legendary.length ? 'Continue legendary run' : 'Start legendary run') + '</button></div>';
  const gauntletHTML = gauntlets.map(chapter => {
    const state = w.gauntlet[chapter.id];
    const pending = w.pending?.kind === 'gauntlet' && w.pending.id === chapter.id ? w.pending.step : null;
    return '<div class="book-row"><div class="book-main"><strong>' + esc(chapter.name) + '</strong><small>' + chapter.encounters.length + ' stages</small></div>' +
      '<b>' + (state?.done ? 'DONE' : pending !== null ? 'STAGE ' + (pending + 1) : '') + '</b>' +
      '<button class="secondary" data-gauntlet="' + esc(chapter.id) + '">' + (pending !== null ? 'Resume' : state?.done ? 'Replay' : 'Start') + '</button></div>';
  }).join('');
  const shareHTML = '<p>Challenge codes are validated locally: schema version, installed content, integer seed and a short modifier whitelist. No URLs, no executable content.</p>' +
    '<label class="tiny">Challenge code<input id="bookCode" class="book-input" placeholder="WBP1.…" autocomplete="off"></label>' +
    '<div class="dialog-actions"><button class="secondary" id="bookRunCode">Run code</button><button class="secondary" id="bookCopyDaily">Copy today\u2019s code</button></div>' +
    '<label class="tiny">Imported result code<input id="bookResult" class="book-input" placeholder="WBR1.…" autocomplete="off"></label>' +
    '<div class="dialog-actions"><button class="secondary" id="bookImport">Import result</button></div>' +
    '<h3>Comparison</h3>' + (w.imported.length ? w.imported.map(item => '<div class="book-row"><strong>' + esc(item.nick) + '</strong><small>' + esc(item.enc) + ' \u00b7 self-reported' + ((item.rules || 0) !== METRIC_RULES ? ' \u00b7 rules v' + item.rules + ' (incompatible)' : '') + '</small><b>' + item.score + '</b></div>').join('') : '<p class="tiny">No imported results.</p>');
  const highlightHTML = w.highlight ? '<p><strong>' + esc(content.get('encounters', w.highlight.encounter)?.name || w.highlight.encounter) + '</strong> \u00b7 seed ' + w.highlight.seed + '</p>' +
    '<p class="tiny">' + w.highlight.releases + ' releases \u00b7 events: ' + esc((w.highlight.events || []).join(', ')) + '</p>' +
    '<div class="record-grid">' + Object.entries(w.highlight.values || {}).filter(([, value]) => value > 0).slice(0, 8).map(([metric, value]) =>
      '<p>' + esc(ALL_METRICS[metric]?.name || metric) + ' \u00b7 ' + formatMetric(metric, value) + '</p>').join('') + '</div>' : '<p class="tiny">No highlight yet. Complete an encounter.</p>';
  const sections = {records: recordsHTML, trophies: trophiesHTML, daily: dailyHTML + '<h3>Recent days</h3>' + history,
    weekly: weeklyHTML, legendary: legendaryHTML, gauntlets: gauntletHTML, share: shareHTML, highlights: highlightHTML};
  const tabs = [['records', 'Record book'], ['trophies', 'Trophy room'], ['daily', 'Daily disaster'], ['weekly', 'Championships'],
    ['legendary', 'Legendary'], ['gauntlets', 'Gauntlets'], ['share', 'Share & compare'], ['highlights', 'Highlights']];
  api.modal('The World Book of Pores',
    '<p class="tiny">' + recordCount + ' of ' + rows.length + ' classifications recorded \u00b7 ' + w.trophies.length + ' trophies \u00b7 rules v' + METRIC_RULES + '</p>' +
    '<div class="book-tabs" role="tablist">' + tabs.map(([id, name]) => '<button role="tab" aria-selected="' + (id === section) + '" data-tab="' + id + '">' + name + '</button>').join('') + '</div>' +
    '<div class="book-section">' + (sections[section] || recordsHTML) + '</div>' +
    '<p class="tiny">Measurements are simulation-derived and fictional. Imported results are self-reported and unverified. Works offline.</p>',
    [['Close', api.close]], 'EXPANSION 4 \u00b7 MAKING DISGUSTING HISTORY');
  bindHub();
}

function encounterName(id) { try { return content.get('encounters', id).name; } catch { return String(id || 'unknown encounter'); } }
function bindHub() {
  const body = document.getElementById('dialogBody');
  if (!body) return;
  for (const tab of body.querySelectorAll('[data-tab]')) tab.onclick = () => openHub(tab.dataset.tab);
  for (const select of body.querySelectorAll('[data-filter]')) select.onchange = () => { filter[select.dataset.filter] = select.value; openHub('records'); };
  for (const button of body.querySelectorAll('[data-cert]')) button.onclick = () => downloadCertificate(button.dataset.cert);
  body.querySelector('[data-daily]')?.addEventListener('click', () => startDaily());
  body.querySelector('[data-share="daily"]')?.addEventListener('click', () => copyText(encodeChallenge(challengeFor())));
  for (const button of body.querySelectorAll('[data-replay-daily]')) button.onclick = () => {
    const key = button.dataset.replayDaily, stored = world().daily[key], def = challengeFor(key);
    if (!def) return;
    beginChallenge({...def, id: stored?.id || def.id, encounter: stored?.encounter || def.encounter, seed: stored?.seed ?? def.seed},
      {kind: 'daily', key, challengeId: stored?.id || def.id, encounter: stored?.encounter || def.encounter,
        seed: stored?.seed ?? def.seed, metric: def.metric, modifier: {}, rules: def.rules});
  };
  for (const button of body.querySelectorAll('[data-weekly]')) button.onclick = () => startWeekly(weekKey(), Number(button.dataset.weekly));
  body.querySelector('[data-legendary]')?.addEventListener('click', startLegendary);
  for (const button of body.querySelectorAll('[data-gauntlet]')) button.onclick = () => {
    const pending = world().pending;
    if (pending?.kind === 'gauntlet' && pending.id === button.dataset.gauntlet) continueGauntlet();
    else startGauntlet(button.dataset.gauntlet);
  };
  body.querySelector('#bookRunCode')?.addEventListener('click', () => {
    try { const def = startShared(document.getElementById('bookCode').value.trim()); api.cue('Running shared challenge: ' + def.name + '.'); }
    catch (error) { api.cue(error.message); }
  });
  body.querySelector('#bookCopyDaily')?.addEventListener('click', () => copyText(encodeChallenge(challengeFor())));
  body.querySelector('#bookImport')?.addEventListener('click', () => {
    try { const item = importResult(document.getElementById('bookResult').value.trim()); api.cue('Imported a self-reported result for ' + encounterName(item.enc) + '.'); openHub('share'); }
    catch (error) { api.cue(error.message); }
  });
}
function copyText(text) {
  if (!text) return;
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => api.cue('Challenge code copied.')).catch(() => api.cue(text));
  else api.cue(text);
}

// Certificates are generated on demand, outside the frame loop, with Canvas only.
export function certificateCanvas(metric) {
  const row = bookRows(world(), definitions()).find(item => item.metric === metric);
  if (!row || !row.value) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1000; canvas.height = 600;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0e1412'; ctx.fillRect(0, 0, 1000, 600);
  ctx.strokeStyle = '#cefa80'; ctx.lineWidth = 6; ctx.strokeRect(22, 22, 956, 556);
  ctx.fillStyle = '#cefa80'; ctx.font = '700 20px ui-monospace, monospace';
  ctx.fillText('THE WORLD BOOK OF PORES', 58, 82);
  ctx.fillStyle = '#f2efe4'; ctx.font = '700 52px system-ui, sans-serif';
  ctx.fillText(row.name, 58, 190, 880);
  ctx.font = '600 72px system-ui, sans-serif'; ctx.fillStyle = '#ffffff';
  ctx.fillText(formatMetric(row.metric, row.value), 58, 300, 880);
  ctx.font = '26px system-ui, sans-serif'; ctx.fillStyle = '#cfe0c4';
  ctx.fillText((row.tier ? row.tier.toUpperCase() + ' TIER · ' : '') + CAMPAIGN_LABEL[campaignOf(row.meta)] + ' · ' + (row.meta.at ? new Date(row.meta.at).toISOString().slice(0, 10) : 'legacy record, date unavailable'), 58, 352, 880);
  ctx.font = 'italic 24px Georgia, serif'; ctx.fillStyle = '#efd697';
  ctx.fillText('"' + comment('record', metric) + '"', 58, 428, 880);
  ctx.font = '18px ui-monospace, monospace'; ctx.fillStyle = '#8fa596';
  ctx.fillText('Dani the Pimple Popper · 1.4 · https://hmarquardt.github.io/junkdrawer/dani-the-pimple-popper.html', 58, 520);
  ctx.fillStyle = '#cefa80'; ctx.font = '16px ui-monospace, monospace';
  ctx.fillText('FICTIONAL SIMULATION · ' + (row.meta.legacy ? 'LEGACY RECORD' : 'SIMULATION-DERIVED MEASUREMENT'), 58, 552);
  return canvas;
}
export function downloadCertificate(metric) {
  const canvas = certificateCanvas(metric);
  if (!canvas) return null;
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = 'dani-world-book-' + metric + '.png';
  document.body.append(link); link.click(); link.remove();
  world().views = (world().views || 0) + 1;
  api.save();
  api.cue('Certificate generated locally.');
  return link.href;
}

// ---------------------------------------------------------------------------------------------
// Panel, settings, offline priming and the Version 2.0 encounter-result contract.
function updatePanel() {
  if (!panel) return;
  const w = world(), daily = challengeFor(), done = w.daily[daily?.key];
  const count = Object.values(w.best).filter(value => value > 0).length;
  panel.querySelector('#worldCount').textContent = count + ' RECORDS';
  panel.querySelector('#worldToday').textContent = daily
    ? 'Daily: ' + daily.name + (done ? ' · best ' + formatMetric(daily.metric, done.score) : ' · not attempted')
    : 'No challenge content installed.';
}
export function sync() { deep.sync(); updatePanel(); }
export function settingsHTML() {
  return '<h3>World Book</h3><div class="prefs"><label>Live record indicators <input id="bookLive" type="checkbox"' + (world().flags.live ? ' checked' : '') + '></label></div>';
}
export function bindSettings(root = document) {
  const live = root.getElementById('bookLive');
  if (live) live.onchange = () => { world().flags.live = live.checked; api.save(); };
}
export function recordsForFiles() {
  if (!content.versions()[NS]) return '';
  const rows = bookRows(world(), definitions()).filter(row => row.value > 0).sort((a, b) => b.value - a.value).slice(0, 5);
  return '<details><summary>World Book · ' + Object.values(world().best).filter(value => value > 0).length + ' records</summary>' +
    (rows.map(row => '<p>' + esc(row.name) + ' · ' + formatMetric(row.metric, row.value) + '</p>').join('') || '<p class="tiny">No records yet.</p>') +
    '<p class="tiny">Open the World Book from the header for the record book, trophies, daily disasters and championships.</p></details>';
}
export function primeOffline() {
  if (primeOffline.done || !navigator.onLine) return;
  primeOffline.done = true;
  const urls = ['./pack.json', './expansion.js'].map(path => new URL(path, import.meta.url).href);
  return Promise.allSettled(urls.map(url => fetch(url, {cache: 'reload'})));
}
export function reset() { lastResult = null; lastSnapshot = null; lastFresh = []; updatePanel(); }
export function lastEncounter() { return lastSnapshot ? {snapshot: lastSnapshot, result: lastResult, records: [...lastFresh]} : null; }
export function open() { openHub('records'); }
// The Version 2.0 contract. Business systems are not implemented; this is the read-only shape a
// future Day Spa can consume.
export function encounterResult(extra = {}) {
  if (lastResult) return lastResult;
  const visit = api?.visit();
  if (!visit) return null;
  const patient = visit.encounter.patient ? content.get('patients', visit.encounter.patient) : null;
  return {encounter: visit.encounter.id, patientClass: patient?.klass || visit.mode.id.split(':')[0],
    complexity: visit.difficulty || 1, status: 'in-progress', quality: null,
    extraction: {releases: 0, volume: 0}, equipment: api.profile().tool, durationMs: 0,
    precision: {perfect: 0, attempts: 0}, discovery: {found: 0, chambers: 0},
    materials: [], scoringRules: visit.mode.scoring, rulesVersion: METRIC_RULES};
}
export {deep};

// Read-only inspection surface for the automated suites and smoke checks.
export function snapshotForTests() {
  const w = world(), profile = api.profile();
  return {world: structuredClone(w), definitions: definitions().length, trophies: trophies().length,
    daily: challengeFor(), weekly: weeklyChallenges(), pending: w.pending,
    result: encounterResult(), stats: structuredClone(profile.stats), achievements: [...profile.achievements],
    records: bookRows(w, definitions()).map(row => ({metric: row.metric, value: row.value, tier: row.tier, klass: row.classification}))};
}
