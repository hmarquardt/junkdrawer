/* Overhead unified observing-opportunity model: one normalised representation for satellites, planets,
   meteor showers and comets, plus ranking, deduplication and the tonight / 7-day / 90-day plans.
   This module owns the schema and the scores; the category engines own the astronomy. */
(function (root) {
'use strict';
const DAY = 86400000, HOUR = 3600000;
const MODEL_VERSION = 'junkdrawer.overhead.opportunity/1';
const CATEGORIES = Object.freeze({ satellites: 'Satellites', planets: 'Planets & Alignments',
  meteors: 'Meteor Showers', comets: 'Comets & Special Events' });
// Observing-suitability weights. Geometry, darkness, moonlight, optical demand, weather and how
// unusual the event is are scored separately and then combined; the score is about how good the
// opportunity is to look at, never about how certain the underlying astronomy is (that is the
// astrometric confidence) nor about how predictable the phenomenon is (the phenomenon confidence).
const WEIGHTS = Object.freeze({ altitude: 30, darkness: 20, moonlight: 15, optical: 15, significance: 15, weather: 25 });
const DARKNESS_POINTS = Object.freeze({ astronomical: 1, nautical: 0.6, civil: 0.25, none: 0 });
const MOON_POINTS = Object.freeze({ none: 1, glare: 0.55, 'washed-out': 0 });
const OPTICAL_POINTS = Object.freeze({ 'naked-eye': 1, 'naked-eye maybe': 0.85, binocular: 0.7, 'naked-eye and binocular': 0.9,
  'binoculars': 0.7, telescope: 0.45, 'telescope for one of the pair': 0.6, 'solar filter required': 0.5, unknown: 0.5 });
// Weather is only used inside the range where a forecast means something. Beyond that the observing
// value is reported without weather and marked unknown rather than optimistic.
const WEATHER_HORIZON_HOURS = 84;
const DEFAULT_MINIMUM_SCORE = 20;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (value, digits) => (Number.isFinite(value) ? Math.round(value * Math.pow(10, digits)) / Math.pow(10, digits) : null);
const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const dayKey = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

/* ---- construction and validation --------------------------------------- */

// Turn a category candidate into a normalised opportunity. Anything that cannot satisfy the model is
// rejected with a reason instead of being shown with missing fields.
function create(candidate, context) {
  const problems = [];
  if (!candidate || typeof candidate !== 'object') return { ok: false, problems: ['not an object'] };
  const category = candidate.category || (context && context.category);
  if (!CATEGORIES[category]) problems.push('unknown category ' + category);
  if (!candidate.kind) problems.push('missing event kind');
  const objects = (candidate.objects || []).filter(Boolean);
  if (!objects.length) problems.push('no objects');
  const t = candidate.t || {};
  if (!Number.isFinite(t.best)) problems.push('no best time');
  const positions = Array.isArray(candidate.positions) ? candidate.positions : [];
  if (problems.length) return { ok: false, problems };
  const occurrence = candidate.occurrence || (candidate.data && (candidate.data.formalEvent || candidate.data.peakInstant))
    || new Date(t.best).toISOString().slice(0, 10);
  const id = [category, candidate.kind, objects.map(slug).join('-'), dayKey(t.best), slug(String(occurrence).slice(0, 10))].join(':');
  return { ok: true, opportunity: { id, modelVersion: MODEL_VERSION, category, type: candidate.kind,
    objects, occurrence: String(occurrence),
    title: candidate.title || titleFor(candidate, objects), summary: candidate.summary || summaryFor(candidate, objects),
    why: candidate.why || whyFor(candidate, objects),
    start: Number.isFinite(t.start) ? t.start : t.best, end: Number.isFinite(t.end) ? t.end : t.best, best: t.best,
    night: candidate.night || null,
    site: candidate.site || (context && context.site) || null,
    positions, optical: candidate.optical || 'unknown',
    eligibility: { observable: candidate.observable !== false,
      reasons: candidate.observable === false ? (candidate.caveats || ['not observable from this location']) : [] },
    conditions: (candidate.data && { darknessAchieved: candidate.data.darknessAchieved || null,
      twilight: !!(candidate.data.darknessLimited), moon: candidate.data.moon || null }) || {},
    caveats: candidate.caveats || [], attributes: candidate.data || {},
    provenance: candidate.provenance || {}, calculation: { library: (candidate.provenance && candidate.provenance.library) || null },
    dataset: (candidate.provenance && candidate.provenance.dataset) || null } };
}
function titleFor(candidate, objects) {
  const names = objects.join(' + ');
  switch (candidate.kind) {
    case 'parade': return objects.length + '-planet grouping: ' + names;
    case 'conjunction': return 'Close approach: ' + names;
    case 'moon-planet': return 'Moon near ' + objects.filter(n => n !== 'Moon').join(' + ');
    case 'opposition': return names + ' at opposition';
    case 'elongation': return names + ' at greatest elongation';
    case 'lunar-eclipse': return 'Lunar eclipse';
    case 'solar-eclipse': return 'Solar eclipse';
    case 'meteor-shower': return names + ' meteor shower';
    case 'comet': return names;
    case 'satellite-pass': return names + ' pass';
    default: return names;
  }
}

// One sentence that says what is actually happening, using only numbers the engine produced.
function summaryFor(candidate, objects) {
  const data = candidate.data || {};
  switch (candidate.kind) {
    case 'parade': return objects.length + ' bright planets share a ' + candidate.durationMin + '-minute window above ' + data.minimumAltitude + '\u00b0, spread along the ecliptic.';
    case 'conjunction': return objects.join(' and ') + ' are ' + data.separationDeg + '\u00b0 apart at closest approach' + (data.eventShiftHours ? ', which happens in local daylight; the best local look is quoted.' : '.');
    case 'moon-planet': return 'The Moon passes ' + data.separationDeg + '\u00b0 from ' + objects.filter(n => n !== 'Moon').join(' and ') + '.';
    case 'opposition': return objects[0] + ' is opposite the Sun: up all night and at its closest this year.';
    case 'elongation': return objects[0] + ' is ' + data.elongationDeg + '\u00b0 from the Sun, best seen in the ' + data.visibility + ' sky.';
    case 'meteor-shower': return objects[0] + ' is ' + data.phase + '; the radiant is ' + (data.radiantAltitudeAtBest === null ? 'below the usable altitude' : 'about ' + Math.round(data.radiantAltitudeAtBest) + '\u00b0 up at the best moment') + '.';
    case 'lunar-eclipse': return 'A ' + data.eclipseKind + ' lunar eclipse; the Moon is ' + data.altitudeAtPeak + '\u00b0 up here at mid-eclipse.';
    case 'solar-eclipse': return 'A ' + data.eclipseKind + ' solar eclipse with ' + Math.round((data.obscuration || 0) * 100) + '% of the Sun covered at maximum.';
    case 'comet': {
      const measured = data.measuredBrightness, predicted = data.predictedBrightness;
      const brightness = measured ? 'last measured magnitude ' + measured.magnitude + ' on ' + String(measured.date).slice(0, 10)
        : predicted ? 'predicted magnitude ' + predicted.magnitude + ' (a model value)' : 'brightness unknown';
      return objects[0] + ' is up from this site with ' + brightness + '.';
    }
    case 'satellite-pass': return objects[0] + ' crosses the sky at up to ' + Math.round(candidate.positions[0] ? candidate.positions[0].altitude : 0) + '\u00b0.';
    default: return objects.join(' + ');
  }
}
// Why the card is worth reading. Every reason names a measured circumstance, never an adjective.
function whyFor(candidate, objects) {
  const data = candidate.data || {}, reasons = [];
  if (candidate.kind === 'parade' && data.classicalCount >= 4) reasons.push(data.classicalCount + ' naked-eye planets are up at the same time');
  else if (candidate.kind === 'parade') reasons.push(data.classicalCount + ' naked-eye planets share one window');
  if (Number.isFinite(data.separationDeg) && data.separationDeg <= 1) reasons.push('the pair is within ' + data.separationDeg + '\u00b0 \u2014 a genuinely tight pairing');
  if (candidate.kind === 'meteor-shower') {
    if (data.phase === 'peak night') reasons.push('the peak falls inside this night');
    else if (data.phase === 'near its peak') reasons.push('this is within a couple of nights of the peak');
    if (data.zhrBand === 'strong') reasons.push('the IMO lists a high ZHR for this shower (' + data.zhr + ')');
    if (data.moon && data.moon.illumination < 0.25) reasons.push('almost no moonlight to wash it out');
  }
  if (candidate.kind === 'comet' && data.measuredBrightness) reasons.push('there is a recent measured brightness, so the comet is really being followed');
  if (candidate.kind === 'comet' && data.trend && data.trend.direction === 'brightening') reasons.push('reported observations show it brightening at about ' + Math.abs(data.trend.magnitudes_per_day) + ' mag/day');
  if (candidate.kind === 'lunar-eclipse') reasons.push('a lunar eclipse is visible with no equipment');
  if (candidate.kind === 'solar-eclipse') reasons.push('a locally visible solar eclipse (eye protection required)');
  if (candidate.positions && candidate.positions[0] && candidate.positions[0].altitude >= 45) reasons.push('it is well up in the sky, not lost in the haze near the horizon');
  if (data.darknessAchieved === 'astronomical') reasons.push('the sky reaches full astronomical darkness');
  if (!reasons.length) reasons.push('this is the best available circumstance in the window for ' + objects.join(' + '));
  return reasons;
}

/* ---- scoring and confidence -------------------------------------------- */

const ASTROMETRIC_GRADES = Object.freeze({
  exact: { grade: 'exact', detail: 'solar-system geometry from Astronomy Engine, validated against JPL Horizons to better than 30 arcseconds', reliability: 'high' },
  'horizons-sampled': { grade: 'horizons-sampled', detail: 'position read from a published JPL Horizons ephemeris and interpolated between samples', reliability: 'high' },
  catalogue: { grade: 'catalogue', detail: 'published radiant position (IMO / IAU MDC), correct to a few degrees for a shower radiant', reliability: 'medium' },
  'kepler-close': { grade: 'kepler-close', detail: 'two-body propagation of published elements within 400 days of the epoch; measured against Horizons to about 15 arcminutes', reliability: 'medium' },
  'kepler-degraded': { grade: 'kepler-degraded', detail: 'two-body propagation 400-800 days from the element epoch; measured error about 90 arcminutes', reliability: 'low' },
  'kepler-unreliable': { grade: 'kepler-unreliable', detail: 'two-body propagation beyond 800 days from the element epoch or near perihelion: the position is approximate only', reliability: 'low' },
  unknown: { grade: 'unknown', detail: 'no position method was recorded', reliability: 'unknown' },
});
const PHENOMENON = Object.freeze({
  planet: { level: 'low', detail: 'planetary geometry is deterministic: where and when the planets appear is known to arcseconds' },
  meteor: { level: 'statistical', detail: 'shower geometry is exact, but the actual number of meteors on a given night is not predictable' },
  comet: { level: 'high', detail: 'a comet position is usually reliable, but its brightness can miss a prediction by several magnitudes' },
  eclipse: { level: 'low', detail: 'eclipse timing and local geometry are deterministic' },
});
const phenomenonFor = category => (category === 'planets' ? PHENOMENON.planet : category === 'meteors' ? PHENOMENON.meteor
  : category === 'comets' ? PHENOMENON.comet : null) || PHENOMENON.planet;

// Observing suitability: how good this is to actually look at, from this site, on this night.
// Weather only enters inside its forecast horizon; otherwise the value is reported weather-free and
// marked unknown so nobody reads a 90-day score as if a forecast had confirmed it.
function score(opportunity, context) {
  const ctx = context || {};
  const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
  const attributes = opportunity.attributes || {};
  const bestPosition = opportunity.positions.slice().sort((a, b) => (b.altitude || -90) - (a.altitude || -90))[0] || null;
  const altitude = bestPosition && Number.isFinite(bestPosition.altitude) ? bestPosition.altitude : null;
  const darkness = attributes.darknessAchieved || opportunity.conditions.darknessAchieved || null;
  const moon = (opportunity.conditions && opportunity.conditions.moon) || attributes.moon || null;
  const moonLevel = (moon && moon.interference) || 'none';
  const factors = {};
  // Each factor is a 0..1 quality; the score is the weighted mean over the factors actually available,
  // so omitting weather (no forecast) does not silently deflate the value, and a perfect event can
  // still be distinguished from a clouded-out one.
  const quality = {};
  quality.altitude = clamp(((altitude === null ? 0 : altitude) - 5) / 55, 0, 1);
  quality.darkness = DARKNESS_POINTS[darkness] === undefined ? 0 : DARKNESS_POINTS[darkness];
  quality.moonlight = MOON_POINTS[moonLevel] === undefined ? 1 : MOON_POINTS[moonLevel];
  quality.optical = OPTICAL_POINTS[opportunity.optical] === undefined ? 0.5 : OPTICAL_POINTS[opportunity.optical];
  quality.significance = significance(opportunity);
  quality.weather = null;
  let weather = null, weatherUsed = false, provisional = false;
  const hoursAhead = (opportunity.best - now) / HOUR;
  const withinForecast = hoursAhead <= WEATHER_HORIZON_HOURS && hoursAhead > -2;
  if (ctx.weatherAt && withinForecast) {
    weather = ctx.weatherAt(opportunity.best);
    if (weather && Number.isFinite(weather.cloud_cover) && Number.isFinite(weather.visibility) && Number.isFinite(weather.precipitation)) {
      weatherUsed = true;
      quality.weather = clamp(1 - weather.cloud_cover / 100, 0, 1)
        * clamp(weather.visibility / 20000, 0.2, 1) * (weather.precipitation > 0 ? 0.5 : 1);
    }
  }
  if (!withinForecast || (withinForecast && !weatherUsed)) provisional = true;
  let weighted = 0, weights = 0;
  for (const key of Object.keys(WEIGHTS)) {
    if (quality[key] === null || quality[key] === undefined) { factors[key] = null; continue; }
    factors[key] = round(WEIGHTS[key] * quality[key], 1);
    weighted += WEIGHTS[key] * quality[key];
    weights += WEIGHTS[key];
  }
  const observable = opportunity.eligibility.observable;
  const value = observable && weights > 0 ? Math.round(clamp(100 * weighted / weights, 0, 100)) : 0;
  return { value, quality: Object.fromEntries(Object.entries(quality).map(([key, v]) => [key, v === null ? null : round(v, 3)])),
    factors, weightsUsed: weights,
    weather, weatherUsed, withinForecast, provisional: provisional || !observable,
    detail: observable
      ? (weatherUsed ? 'geometry, darkness and a forecast inside its useful range' : 'geometry and darkness only; no forecast is applied at this range')
      : 'not observable from this location: ' + (opportunity.eligibility.reasons.join('; ') || 'unknown reason') };
}
// How unusual the circumstance is, from the numbers the engine produced. Bounded to [0,1].
function significance(opportunity) {
  const data = opportunity.attributes || {};
  switch (opportunity.type) {
    case 'parade': return clamp(0.35 + 0.22 * (data.classicalCount || 0), 0, 1);
    case 'conjunction': return clamp(1 - (data.separationDeg || 5) / 5, 0.15, 1);
    case 'moon-planet': return clamp(1 - (data.separationDeg || 6) / 6, 0.1, 0.8);
    case 'opposition': return 0.6;
    case 'elongation': return clamp((data.elongationDeg || 0) / 45, 0.1, 0.7);
    case 'meteor-shower': {
      const band = data.zhrBand === 'strong' ? 0.8 : data.zhrBand === 'moderate' ? 0.5 : 0.25;
      const phase = data.phase === 'peak night' ? 1 : data.phase === 'near its peak' ? 0.8 : 0.4;
      return clamp(band * phase, 0.05, 0.95);
    }
    case 'lunar-eclipse': return data.eclipseKind === 'total' ? 0.95 : data.eclipseKind === 'partial' ? 0.8 : 0.5;
    case 'solar-eclipse': return clamp(0.6 + (data.obscuration || 0) * 0.4, 0.3, 1);
    case 'comet': {
      const magnitude = data.measuredBrightness ? data.measuredBrightness.magnitude
        : data.predictedBrightness ? data.predictedBrightness.magnitude : null;
      const brightness = Number.isFinite(magnitude) ? clamp((14 - magnitude) / 12, 0.05, 1) : 0.2;
      const trend = data.trend && data.trend.direction === 'brightening' ? 0.15 : 0;
      return clamp(brightness + trend, 0.05, 1);
    }
    case 'satellite-pass': return clamp((data.score || 0) / 100, 0.05, 1);
    default: return 0.3;
  }
}
// Three confidences that are never collapsed into one number.
function confidence(opportunity, context) {
  const attributes = opportunity.attributes || {};
  const gradeKey = attributes.positionGrade || (opportunity.category === 'planets' ? 'exact'
    : opportunity.category === 'meteors' ? 'catalogue' : 'unknown');
  const astrometric = ASTROMETRIC_GRADES[gradeKey] || ASTROMETRIC_GRADES.unknown;
  const observing = (context && context.observing) || score(opportunity, context);
  return { astrometric: { ...astrometric, frame: opportunity.positions[0] ? opportunity.positions[0].frame || null : null },
    observing: { value: observing.value, grade: observing.weatherUsed ? 'forecast-included' : observing.withinForecast ? 'no-usable-forecast' : 'astronomy-only',
      detail: observing.detail },
    phenomenon: phenomenonFor(opportunity.category) };
}

/* ---- normalisation, deduplication, ranking ----------------------------- */

// Convert candidates into the model, keeping the rejected ones visible for diagnostics. A rejection is
// never silently dropped: the caller can see exactly why a candidate did not become an opportunity.
function fromCandidates(candidates, context) {
  const accepted = [], rejected = [];
  for (const candidate of candidates || []) {
    const result = create(candidate, context);
    if (result.ok) accepted.push(result.opportunity); else rejected.push({ candidate: (candidate && candidate.kind) || 'unknown', problems: result.problems });
  }
  return { accepted, rejected };
}
// Deduplication key. Showers and comets are one card per local night because each night really is a
// different observing opportunity; conjunctions, oppositions, elongations and eclipses are one card
// per occurrence, keeping the night on which they are best seen.
function dedupeKey(opportunity) {
  const perNight = opportunity.category === 'meteors' || opportunity.category === 'comets';
  const objects = opportunity.objects.slice().sort().join('+');
  return [opportunity.category, opportunity.type, objects, perNight ? opportunity.night || dayKey(opportunity.best) : opportunity.occurrence].join('|');
}
// Keep the best-scoring card for each dedupe key, merging caveats so no limitation is lost, and
// cross-link cards that overlap in time and share objects instead of repeating them.
function dedupe(opportunities, context) {
  const ranked = opportunities.map(opportunity => {
    const observing = score(opportunity, context);
    return { ...opportunity, observing, confidence: confidence(opportunity, { ...context, observing }) };
  });
  const best = new Map();
  for (const opportunity of ranked) {
    const key = dedupeKey(opportunity);
    const existing = best.get(key);
    if (!existing || opportunity.observing.value > existing.observing.value
      || (opportunity.observing.value === existing.observing.value && opportunity.best < existing.best)) {
      // Merge the losing card's caveats into the winner so no limitation is lost with the duplicate.
      const chosen = existing
        ? { ...opportunity, caveats: [...new Set([...opportunity.caveats, ...existing.caveats])] }
        : opportunity;
      best.set(key, chosen);
    } else {
      existing.caveats = [...new Set([...existing.caveats, ...opportunity.caveats])];
    }
  }
  const kept = [...best.values()].sort((a, b) => a.best - b.best);
  // Cross-link: a conjunction between two planets that both take part in the same parade is related to
  // it rather than repeated, and an eclipse that happens on a shower's peak night is worth knowing about.
  for (const a of kept) {
    a.related = kept.filter(b => b !== a && Math.abs(b.best - a.best) <= 6 * HOUR
      && b.objects.some(name => a.objects.includes(name))).map(b => b.id);
  }
  return kept;
}
// Ranking: observing suitability first, then how significant the circumstance is, then the earliest.
function rank(opportunities, context) {
  return opportunities.slice().sort((a, b) => {
    const av = (a.observing ? a.observing.value : score(a, context).value);
    const bv = (b.observing ? b.observing.value : score(b, context).value);
    return bv - av || significance(b) - significance(a) || a.best - b.best;
  });
}
function withScores(candidates, context) {
  const normalised = fromCandidates(candidates, context);
  const kept = dedupe(normalised.accepted, context);
  return { opportunities: rank(kept, context), rejected: normalised.rejected };
}

/* ---- consolidation for long horizons ---------------------------------- */

// Night-by-night cards are right for tonight and the coming week, where each night is its own
// decision. Across 90 days the same shower or the same parade would produce dozens of near-identical
// cards, so consecutive nights of one circumstance are merged into a single card that names the run
// and points at its best night. Nothing is hidden: the night count and the date range are reported.
function consolidate(opportunities) {
  const groups = new Map();
  for (const opportunity of opportunities) {
    const key = [opportunity.category, opportunity.type, opportunity.objects.slice().sort().join('+')].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(opportunity);
  }
  const out = [];
  for (const list of groups.values()) {
    const sorted = list.slice().sort((a, b) => a.best - b.best);
    let run = [];
    const flush = () => { if (run.length) out.push(mergeRun(run)); run = []; };
    for (const opportunity of sorted) {
      const previous = run[run.length - 1];
      if (previous && nightGap(previous.night, opportunity.night) > 2) flush();
      run.push(opportunity);
    }
    flush();
  }
  return out;
}
const nightGap = (a, b) => {
  if (!a || !b) return 1;
  return Math.abs((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
};
// Merge a consecutive run into one card, keeping the best night's numbers as the card's own.
function mergeRun(run) {
  if (run.length === 1) return run[0];
  const best = run.reduce((a, b) => (b.observing.value > a.observing.value ? b : a));
  const first = run[0], last = run[run.length - 1];
  const nights = run.length;
  return { ...best,
    id: best.id + '+run' + nights,
    start: Math.min(...run.map(o => o.start)), end: Math.max(...run.map(o => o.end)),
    occurrence: best.occurrence,
    why: [...best.why, 'observable on ' + nights + ' nights between ' + (first.night || '') + ' and ' + (last.night || '')],
    caveats: [...new Set(run.flatMap(o => o.caveats))],
    attributes: { ...best.attributes, nightCount: nights, runStart: first.night || null, runEnd: last.night || null,
      bestNight: best.night || null, runScores: run.map(o => ({ night: o.night, value: o.observing.value })) } };
}

/* ---- planning horizons ------------------------------------------------- */

const HORIZONS = Object.freeze({ tonight: { label: 'Tonight', nights: 1 }, week: { label: 'Next 7 Days', nights: 7 },
  extended: { label: 'Next 90 Days', nights: 90 } });
// Build the plan for one horizon. An empty plan is a valid answer and carries the reason, so the UI
// never has to invent something to show.
function plan(opportunities, options) {
  const opts = options || {};
  const horizon = HORIZONS[opts.horizon || 'tonight'] ? opts.horizon || 'tonight' : 'tonight';
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const windows = opts.windows || [];
  const nights = HORIZONS[horizon].nights;
  const end = windows.length ? (windows[Math.min(nights, windows.length) - 1].end || now + nights * DAY) : now + nights * DAY;
  const start = windows.length ? windows[0].start : now;
  const within = opportunities.filter(o => o.best >= start - 3 * HOUR && o.best <= end);
  const observable = within.filter(o => o.eligibility.observable);
  const minimumScore = Number.isFinite(opts.minimumScore) ? opts.minimumScore : DEFAULT_MINIMUM_SCORE;
  const worthwhile = observable.filter(o => (o.observing ? o.observing.value : 0) >= minimumScore);
  const excluded = observable.filter(o => !worthwhile.includes(o));
  // Long horizons are consolidated so one shower or one parade does not fill the plan with
  // near-identical nights; short horizons keep night-by-night cards because each night is a decision.
  const consolidateRuns = opts.consolidate !== undefined ? opts.consolidate : nights >= 30;
  const listed = consolidateRuns ? consolidate(worthwhile) : worthwhile;
  const maxCards = Number.isFinite(opts.maxCards) ? opts.maxCards : 80;
  const ranked = rank(listed, opts);
  return { horizon, label: HORIZONS[horizon].label, start, end, nights, consolidated: consolidateRuns,
    opportunities: ranked.slice(0, maxCards),
    truncated: Math.max(0, ranked.length - maxCards),
    belowThreshold: rank(excluded, opts).map(o => ({ id: o.id, title: o.title, value: o.observing ? o.observing.value : 0 })),
    considered: within.length, notObservable: within.filter(o => !o.eligibility.observable).map(o => ({ id: o.id, title: o.title, reasons: o.eligibility.reasons })),
    empty: worthwhile.length === 0,
    emptyReason: worthwhile.length ? null : emptyReason(within, observable, excluded, horizon),
    weather: (opts.weatherAt && (opts.weatherAt(end) || null)) ? 'forecast available for part of this window' : 'no forecast applies across this window',
    notes: notesFor(horizon, nights) };
}
function emptyReason(within, observable, excluded, horizon) {
  if (!within.length) return 'Nothing in this category is calculated to be observable in this window from this location.';
  if (!observable.length) return 'Events happen in this window, but none of them are observable from this location — see the notes on each event for why.';
  if (excluded.length) return 'The only events in this window are ordinary ones below the significance threshold; the list below shows them with their scores.';
  return 'No notable opportunity is predicted for this horizon; ordinary satellite passes and planet positions remain available.';
}
function notesFor(horizon, nights) {
  const notes = [];
  if (nights >= 7) notes.push('Weather can only be trusted for the first three or four days, so later events are scored on geometry and darkness alone.');
  if (nights >= 90) notes.push('At this range comet brightness and meteor activity are the least certain parts of the plan; the confidence panel on each card says which kind of uncertainty applies.');
  return notes;
}

/* ---- satellites in the same model ------------------------------------- */

// Existing satellite passes are converted into the same shape so the unified summary can rank them
// next to everything else. The satellite tab keeps its own rendering and its own scoring.
function fromSatellitePass(pass, context) {
  const score = (pass.score && pass.score.score) || 0;
  return { category: 'satellites', kind: 'satellite-pass', objects: [pass.train ? pass.train.name || 'Starlink train' : pass.name],
    t: { start: pass.start, end: pass.end, best: pass.peak.t }, occurrence: pass.id, night: pass.night || null,
    site: context && context.site, optical: pass.train ? 'naked-eye' : (score >= 60 ? 'naked-eye' : 'naked-eye'),
    observable: !!pass.likely, caveats: pass.likely ? [] : ['orbital geometry only; not a viewing recommendation'],
    positions: [{ name: pass.name, t: pass.peak.t, altitude: round(pass.peak.el, 2), azimuth: round(pass.peak.az, 1),
      compass: (root.OverheadAstro && root.OverheadAstro.compass(pass.peak.az)) || null, optical: 'naked-eye' }],
    data: { score, brightness: pass.brightness || null, durationSeconds: pass.duration || null,
      darknessAchieved: pass.peak.sun <= -18 ? 'astronomical' : pass.peak.sun <= -12 ? 'nautical' : 'civil',
      provisional: !!pass.provisional, satelliteGroups: pass.groups || [] },
    provenance: { library: 'overhead-engine.js (satellite.js SGP4)' } };
}

root.OverheadOpportunities = { MODEL_VERSION, CATEGORIES, WEIGHTS, HORIZONS, DEFAULT_MINIMUM_SCORE, WEATHER_HORIZON_HOURS,
  create, dedupeKey, dedupe, consolidate, mergeRun, fromCandidates, withScores, score, significance, confidence,
  rank, plan, fromSatellitePass };
if (typeof module !== 'undefined') module.exports = root.OverheadOpportunities;
})(typeof self !== 'undefined' ? self : globalThis);
