// Engine 1.4 record book. One bounded, versioned record state shared by every campaign. Record
// values are integers (fixed-point where the simulation is continuous), so the existing strict save
// validator keeps working and historical meanings never change silently.
import {METRICS, METRIC_RULES, quantize} from './telemetry.js';

export const WORLD_SCHEMA = 1;
export const HISTORY_LIMIT = 24;
export const DAILY_LIMIT = 14;
export const WEEKLY_LIMIT = 8;
export const IMPORT_LIMIT = 5;
export const TROPHY_LIMIT = 96;

// The eight supernatural classifications introduced in 1.3 stay separately comparable.
export const SUPERNATURAL_METRICS = Object.freeze({
  alienExtraction: {name: 'Out of This World', unit: 'centi-volume', better: 'max',
    definition: 'Largest extraterrestrial extraction in one committed interaction.'},
  regenerationStages: {name: 'The Undying Plug', unit: 'count', better: 'max',
    definition: 'Most dormant supernatural chambers activated in one encounter.'},
  phaseReleases: {name: 'Ghostbusters', unit: 'count', better: 'max',
    definition: 'Most successful releases that drained a phase-locked chamber in one encounter.'},
  lunarScore: {name: 'Full Moon Fever', unit: 'points', better: 'max',
    definition: 'Highest lunar-modified encounter result.'},
  sporeOutlets: {name: 'Spore Sport', unit: 'count', better: 'max',
    definition: 'Most simultaneous mycelial or multi-outlet streams in one interaction.'},
  crystalSize: {name: 'The Crystal Method', unit: 'centi-volume', better: 'max',
    definition: 'Largest crystalline obstruction cleared, in hundredths of a reservoir unit.'},
  sessionEncounters: {name: 'The Witching Hour', unit: 'count', better: 'max',
    definition: 'Most supernatural encounters completed in one session.'},
  supernaturalComposite: {name: 'Unholy Extrusion', unit: 'points', better: 'max',
    definition: 'Highest supernatural composite extraction result.'}
});
export const ALL_METRICS = Object.freeze({...METRICS, ...SUPERNATURAL_METRICS});

// Legacy stat → metric. Values written by 1.3 are preserved verbatim and labelled legacy.
export const LEGACY_STATS = [
  ['alienBest', 'alienExtraction'], ['regenBest', 'regenerationStages'], ['phaseReleases', 'phaseReleases'],
  ['moonBest', 'lunarScore'], ['multiStream', 'sporeOutlets'], ['crystalBest', 'crystalSize'],
  ['witchingHour', 'sessionEncounters'], ['unholyExtrusion', 'supernaturalComposite']
];

export function defaultWorld() {
  return {v: WORLD_SCHEMA, rules: METRIC_RULES, migrated: 0, best: {}, prev: {}, meta: {},
    history: [], trophies: [], daily: {}, weekly: {}, gauntlet: {}, imported: [],
    session: 0, flags: {live: true}, views: 0, legendary: [], highlight: null, pending: null};
}
const safeObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const int = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

// Normalisation is idempotent: it never invents a value, never deletes a known one and never
// duplicates history. It also performs the one-way 1.3 → 1.4 record migration exactly once.
export function normalizeWorld(world, profile) {
  const base = defaultWorld();
  const out = {...base, ...safeObject(world)};
  out.best = safeObject(out.best);
  out.prev = safeObject(out.prev);
  out.meta = safeObject(out.meta);
  out.daily = safeObject(out.daily);
  out.weekly = safeObject(out.weekly);
  out.gauntlet = safeObject(out.gauntlet);
  out.flags = {...base.flags, ...safeObject(out.flags)};
  out.history = Array.isArray(out.history) ? out.history.slice(0, HISTORY_LIMIT) : [];
  out.trophies = Array.isArray(out.trophies) ? [...new Set(out.trophies)].slice(0, TROPHY_LIMIT) : [];
  out.imported = Array.isArray(out.imported) ? out.imported.slice(0, IMPORT_LIMIT) : [];
  out.legendary = Array.isArray(out.legendary) ? [...new Set(out.legendary)].slice(0, 16) : [];
  out.highlight = out.highlight && typeof out.highlight === 'object' ? out.highlight : null;
  out.pending = out.pending && typeof out.pending === 'object' ? out.pending : null;
  out.session = int(out.session);
  out.views = int(out.views);
  for (const key of Object.keys(out.best)) if (!ALL_METRICS[key]) delete out.best[key];
  for (const key of Object.keys(out.prev)) if (!ALL_METRICS[key]) delete out.prev[key];
  for (const key of Object.keys(out.meta)) if (!ALL_METRICS[key]) delete out.meta[key];
  for (const key of Object.keys(out.best)) out.best[key] = int(out.best[key]);
  for (const key of Object.keys(out.prev)) out.prev[key] = int(out.prev[key]);
  for (const day of Object.keys(out.daily)) if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) delete out.daily[day];
  for (const week of Object.keys(out.weekly)) if (!/^\d{4}-W\d{2}$/.test(week)) delete out.weekly[week];
  // Keep only the most recent bounded slices.
  out.history.sort((a, b) => int(b.at) - int(a.at));
  out.history = out.history.slice(0, HISTORY_LIMIT);
  const days = Object.keys(out.daily).sort();
  for (const day of days.slice(0, Math.max(0, days.length - DAILY_LIMIT))) delete out.daily[day];
  const weeks = Object.keys(out.weekly).sort();
  for (const week of weeks.slice(0, Math.max(0, weeks.length - WEEKLY_LIMIT))) delete out.weekly[week];
  if (!out.migrated) {
    // Preserve the eight 1.3 classifications without inventing metadata that was never recorded.
    for (const [stat, metric] of LEGACY_STATS) {
      const value = int(profile?.stats?.[stat]);
      if (value > 0 && !out.best[metric]) {
        out.best[metric] = value;
        out.meta[metric] = {legacy: true, at: null, tier: 'legacy'};
      }
    }
    out.migrated = 1;
  }
  return out;
}

export function tierFor(definition, value) {
  const tiers = definition?.tiers || {};
  let tier = null;
  for (const name of ['bronze', 'silver', 'gold', 'platinum', 'legendary']) {
    const threshold = int(tiers[name]);
    if (threshold > 0 && value >= threshold) tier = name;
  }
  return tier;
}

// Evaluate a telemetry snapshot against the pack's record definitions. Pure: nothing is written.
export function evaluate(snapshot, definitions, world) {
  if (!snapshot) return [];
  const results = [];
  for (const definition of definitions) {
    const numeric = definition.metric === 'sessionEncounters' ? snapshot.values.sessionEncounters
      : definition.metric === 'lunarScore' ? snapshot.values.lunarScore
      : snapshot.values[definition.metric];
    const value = int(numeric);
    if (value <= 0) continue;
    const best = int(world.best[definition.metric]);
    results.push({id: definition.id, metric: definition.metric, value, best,
      previous: int(world.prev[definition.metric]) || null, isRecord: value > best,
      tier: tierFor(definition, value), definition});
  }
  return results;
}

// Commit only improvements. A repeated or replayed result can never duplicate history, and an
// imported record can never overwrite a local best.
export function commit(world, results, meta = {}) {
  const fresh = [];
  for (const result of results) {
    if (!result.isRecord || !ALL_METRICS[result.metric]) continue;
    const previous = int(world.best[result.metric]);
    world.prev[result.metric] = previous;
    world.best[result.metric] = result.value;
    world.meta[result.metric] = {legacy: false, at: int(meta.at), namespace: meta.namespace || null,
      encounter: meta.encounter || null, klass: meta.klass || null, region: meta.region || null,
      equipment: meta.equipment || null, material: meta.material || null, seed: int(meta.seed),
      tier: result.tier || tierFor(result.definition, result.value) || 'bronze'};
    world.history.unshift({m: result.metric, v: result.value, at: int(meta.at)});
    fresh.push({...result, previous});
  }
  if (fresh.length) {
    world.history = world.history.slice(0, HISTORY_LIMIT);
    world.session = int(world.session) + fresh.length;
  }
  return fresh;
}

export function bookRows(world, definitions) {
  return definitions.map(definition => ({
    id: definition.id, name: definition.name, classification: definition.classification || 'core',
    metric: definition.metric, value: int(world.best[definition.metric]), tier: world.meta[definition.metric]?.tier || null,
    meta: world.meta[definition.metric] || {legacy: true, at: null},
    definition
  }));
}
export const metricName = id => ALL_METRICS[id]?.name || id;
export const metricDefinition = id => ALL_METRICS[id] || null;
export {quantize};
