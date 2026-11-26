// Engine 1.4 extraction telemetry. One bounded aggregator, one versioned metric registry, and one
// event contract shared by the base campaign, The Pore Explorer and The Midnight Clinic.
// Observers only read the simulation: nothing here can change an extraction outcome.
export const TELEMETRY_SCHEMA = 1;
export const METRIC_RULES = 1;
export const MAX_EVENTS = 60;

// Metric definitions are versioned by METRIC_RULES. Historical meanings never change silently: a
// change in how a value is measured requires a new rules version and a new definition.
export const METRICS = Object.freeze({
  singleExtraction: {name: 'The Big One', unit: 'centi-volume', better: 'max',
    definition: 'Largest fictional material volume released by one committed interaction, in hundredths of a reservoir unit.'},
  reservoirTotal: {name: 'The Mother Lode', unit: 'centi-volume', better: 'max',
    definition: 'Total volume released from one blemish reservoir during one encounter.'},
  encounterTotal: {name: 'The Geological Event', unit: 'centi-volume', better: 'max',
    definition: 'Total volume released during one completed encounter.'},
  extrusionLength: {name: 'Going the Distance', unit: 'centi-divisions', better: 'max',
    definition: 'Longest rendered continuous extrusion chain, measured in hundredths of a lesion radius.'},
  cohesiveSegment: {name: 'The Long Goodbye', unit: 'centi-volume', better: 'max',
    definition: 'Largest single-material cohesive segment released by one committed interaction.'},
  streams: {name: 'The Hydrant', unit: 'count', better: 'max',
    definition: 'Most simultaneous material streams in one committed interaction.'},
  materials: {name: 'The Mixed Grill', unit: 'count', better: 'max',
    definition: 'Most distinct fictional materials released during one encounter.'},
  secondary: {name: 'The Aftershock', unit: 'count', better: 'max',
    definition: 'Most secondary or echoed releases produced by one completed encounter.'},
  streak: {name: 'The Streak Freak', unit: 'count', better: 'max',
    definition: 'Longest run of successful committed extractions observed by telemetry.'},
  sessionExtractions: {name: 'The Marathon Popper', unit: 'count', better: 'max',
    definition: 'Most committed extractions in one encounter session.'},
  precision: {name: 'Porefection', unit: 'per-mille', better: 'max',
    definition: 'Precision result: perfect releases per thousand committed releases in one encounter.'},
  composite: {name: 'The Geological Event (composite)', unit: 'points', better: 'max',
    definition: 'Highest documentary composite result for one completed encounter, using the scoring rules in force.'},
  discovered: {name: 'The Family Tree', unit: 'count', better: 'max',
    definition: 'Most reservoir chambers discovered in one encounter.'},
  outletBurst: {name: 'Spore Sport', unit: 'count', better: 'max',
    definition: 'Most simultaneous material outlets observed in one supernatural encounter.'}
});

export const metricDefinition = id => METRICS[id] || null;
export const quantize = value => Math.max(0, Math.round(value * 100));

function blank(meta) {
  return {
    meta, startedAt: meta.now || 0, releases: 0, perfect: 0, totalVolume: 0, maxSingle: 0,
    maxStreams: 0, maxMaterials: 0, secondary: 0, echoed: 0, regenerated: 0, mutated: 0, gates: 0,
    phased: 0, coreSize: 0, sessionEncounters: 0,
    discovered: 0, chambers: 0, longestExtrusion: 0, maxCohesive: 0, maxOutlets: 0,
    reservoir: {}, materialsSeen: new Set(), events: [], lastEvent: null
  };
}

// The aggregator keeps a single active session. Events are plain, bounded records; per-frame data
// is never retained and no frame loop writes to storage.
export function createTelemetry() {
  let session = null;
  const api = {
    start(meta) {
      session = blank({...meta});
      api.event({type: 'encounter-started'});
    },
    active() { return !!session; },
    session() { return session ? {...session, events: [...session.events]} : null; },
    event(event) {
      if (!session) return null;
      const record = {t: event.type, at: session.events.length};
      for (const key of ['namespace', 'encounter', 'seed', 'target', 'material', 'equipment', 'quality']) {
        if (event[key] !== undefined) record[key] = event[key];
      }
      if (session.events.length < MAX_EVENTS) session.events.push(record);
      session.lastEvent = record;
      if (event.type === 'release') {
        const volume = Number(event.volume) || 0;
        session.releases++;
        session.totalVolume += volume;
        session.maxSingle = Math.max(session.maxSingle, volume);
        session.maxStreams = Math.max(session.maxStreams, event.streams || 0);
        session.maxOutlets = Math.max(session.maxOutlets, event.outlets || 0);
        session.longestExtrusion = Math.max(session.longestExtrusion, event.extrusion || 0);
        session.maxCohesive = Math.max(session.maxCohesive, event.cohesive || 0);
        session.secondary += (event.secondary || 0) + (event.echo || 0);
        session.echoed += event.echo || 0;
        session.regenerated += event.regenerated || 0;
        session.phased += event.phased || 0;
        session.coreSize = Math.max(session.coreSize, event.core || 0);
        if (event.mutated) session.mutated++;
        const materials = event.materials || [];
        for (const material of materials) session.materialsSeen.add(material);
        session.maxMaterials = Math.max(session.maxMaterials, new Set(materials).size);
        session.discovered = Math.max(session.discovered, event.discovered || 0);
        session.chambers = Math.max(session.chambers, event.chambers || 0);
        session.reservoir[event.target ?? 0] = (session.reservoir[event.target ?? 0] || 0) + volume;
        if (event.perfect) session.perfect++;
        if (event.equipment) session.equipment = event.equipment;
      } else if (event.type === 'gate-cleared') {
        session.gates++;
        session.coreSize = Math.max(session.coreSize, event.core || 0);
      } else if (event.type === 'discovery') {
        session.discovered = Math.max(session.discovered, event.found || 0);
        session.chambers = Math.max(session.chambers, event.chambers || 0);
      }
      return record;
    },
    // A snapshot is a measurement document. It is quantized to integers so it can be stored in a
    // save that validates strictly, and it carries the metric rules version it was produced under.
    snapshot(extra = {}) {
      if (!session) return null;
      const reservoirMax = Object.values(session.reservoir).reduce((max, value) => Math.max(max, value), 0);
      const values = {
        singleExtraction: quantize(session.maxSingle),
        reservoirTotal: quantize(reservoirMax),
        encounterTotal: quantize(session.totalVolume),
        extrusionLength: quantize(session.longestExtrusion),
        cohesiveSegment: quantize(session.maxCohesive),
        streams: session.maxStreams,
        materials: session.materialsSeen.size,
        secondary: session.secondary,
        streak: extra.streak || 0,
        sessionExtractions: session.releases,
        precision: session.releases ? Math.round((session.perfect / session.releases) * 1000) : 0,
        composite: Math.max(0, Math.round(extra.points || 0)),
        discovered: session.discovered,
        outletBurst: session.maxOutlets,
        ...(extra.metrics || {})
      };
      return {schema: TELEMETRY_SCHEMA, rules: METRIC_RULES, meta: {...session.meta}, values,
        events: session.events.map(event => event.type), chambers: session.chambers,
        releases: session.releases, totalVolume: quantize(session.totalVolume), gates: session.gates,
        regenerated: session.regenerated, phased: session.phased, coreSize: session.coreSize,
        materialsSeen: [...session.materialsSeen].slice(0, 16),
        durationMs: Math.max(0, Math.round((extra.now || 0) - session.startedAt)),
        quality: extra.quality || null};
    },
    finish(extra = {}) {
      const result = api.snapshot(extra);
      session = null;
      return result;
    },
    abort() { session = null; }
  };
  return api;
}
