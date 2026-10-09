/* Overhead comets: orbital-position calculation, published-ephemeris lookup, measured versus predicted
   brightness, local observing windows and candidate discovery. Pure computation; the datasets are
   supplied by the caller, so nothing here fetches or invents a comet.

   Position policy (see docs/overhead-celestial.md):
     1. if the published Horizons ephemeris covers the instant, interpolate it (authoritative),
     2. otherwise propagate the published orbital elements with a two-body Kepler solution and attach
        the measured tolerance for the distance from the element epoch,
     3. brightness is only ever labelled measured (COBS) or predicted (the IAU total-magnitude model). */
(function (root) {
'use strict';
const A = root.OverheadAstro;
if (!A) throw new Error('overhead-comets.js requires overhead-astro.js');
const DAY = 86400000, HOUR = 3600000, MINUTE = 60000;
const CATALOG_REQUIREMENT = 'junkdrawer.overhead.comets/1';
const EPHEMERIS_REQUIREMENT = 'junkdrawer.overhead.comets-ephemeris/1';
const LIBRARY = 'overhead-comets.js @ Astronomy Engine ' + A.LIBRARY.version;
const GAUSSIAN_K = 0.01720209895;      // radians per day, the Gaussian gravitational constant
// Measured against JPL Horizons for 2P/Encke (documented in docs/overhead-celestial.md, section 7):
// under 1 arcminute within 400 days of the element epoch, about 5 arcminutes at 9 months, and about
// 100 arcminutes at 21 months where non-gravitational acceleration dominates the error budget.
const KEPLER_TOLERANCE = Object.freeze([
  { maxDays: 400, arcmin: 15, grade: 'kepler-close' },
  { maxDays: 800, arcmin: 90, grade: 'kepler-degraded' },
  { maxDays: Infinity, arcmin: null, grade: 'kepler-unreliable' },
]);
const round = (value, digits) => (Number.isFinite(value) ? Math.round(value * Math.pow(10, digits)) / Math.pow(10, digits) : null);
// JPL publishes SBDB values as strings and the pipeline preserves that, so every numeric element is
// coerced once here rather than trusted to be a number.
const num = value => (typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN));
const MJD_J2000 = 2451545.0;
const jdToMs = jd => (jd - MJD_J2000) * DAY + Date.UTC(2000, 0, 1, 12, 0, 0);
const msToJd = ms => (ms - Date.UTC(2000, 0, 1, 12, 0, 0)) / DAY + MJD_J2000;

/* ---- orbital propagation ----------------------------------------------- */

// Kepler's equation, elliptic case: E - e sin E = M, solved by Newton with a safe starting guess.
function solveElliptic(meanAnomaly, e) {
  const M = ((meanAnomaly % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 60; i++) {
    const residual = E - e * Math.sin(E) - M;
    const slope = 1 - e * Math.cos(E);
    if (Math.abs(slope) < 1e-14) break;
    const step = residual / slope;
    E -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  return E;
}
// Kepler's equation, hyperbolic case: e sinh H - H = M.
function solveHyperbolic(meanAnomaly, e) {
  let H = Math.asinh(meanAnomaly / e);
  if (!Number.isFinite(H)) H = 0;
  for (let i = 0; i < 200; i++) {
    const residual = e * Math.sinh(H) - H - meanAnomaly;
    const slope = e * Math.cosh(H) - 1;
    if (Math.abs(slope) < 1e-14) break;
    const step = residual / slope;
    H -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  return H;
}
// Barker's equation, parabolic case: G^3/3 + G = M.
function solveBarker(meanAnomaly) {
  let G = Math.cbrt(3 * meanAnomaly);
  for (let i = 0; i < 200; i++) {
    const residual = G * G * G / 3 + G - meanAnomaly;
    const slope = G * G + 1;
    const step = residual / slope;
    G -= step;
    if (Math.abs(step) < 1e-14) break;
  }
  return G;
}
// Heliocentric ECLIPTIC J2000 position in AU from Keplerian elements at a terrestrial-time Julian
// date. Handles the elliptic, parabolic and hyperbolic cases separately because a near-parabolic
// comet has no usable semi-major axis.
function propagateElements(elements, jdTT) {
  const e = num(elements.e);
  const days = jdTT - num(elements.tp);
  let radius, trueAnomaly;
  if (e < 1 - 1e-9) {
    const a = num(elements.a);
    const meanMotion = GAUSSIAN_K / Math.pow(a, 1.5);
    const E = solveElliptic(meanMotion * days, e);
    const xv = a * (Math.cos(E) - e), yv = a * Math.sqrt(Math.max(0, 1 - e * e)) * Math.sin(E);
    radius = Math.hypot(xv, yv);
    trueAnomaly = Math.atan2(yv, xv);
  } else if (e > 1 + 1e-9) {
    const a = num(elements.a);
    const meanMotion = GAUSSIAN_K / Math.pow(Math.abs(a), 1.5);
    const H = solveHyperbolic(meanMotion * days, e);
    const xv = a * (Math.cosh(H) - e), yv = Math.sqrt(Math.max(0, a * a * (e * e - 1))) * Math.sinh(H);
    radius = Math.hypot(xv, yv);
    trueAnomaly = Math.atan2(yv, xv);
  } else {
    const q = num(elements.q);
    const meanMotion = GAUSSIAN_K / Math.sqrt(2 * Math.pow(q, 3));
    const G = solveBarker(meanMotion * days);
    radius = q * (1 + G * G);
    trueAnomaly = 2 * Math.atan(G);
  }
  const argumentOfLatitude = trueAnomaly + num(elements.w) * Math.PI / 180;
  const node = num(elements.om) * Math.PI / 180, inclination = num(elements.i) * Math.PI / 180;
  const cu = Math.cos(argumentOfLatitude), su = Math.sin(argumentOfLatitude);
  const cO = Math.cos(node), sO = Math.sin(node), ci = Math.cos(inclination), si = Math.sin(inclination);
  return { x: radius * (cO * cu - sO * su * ci), y: radius * (sO * cu + cO * su * ci), z: radius * su * si,
    r: radius, trueAnomalyDeg: trueAnomaly * 180 / Math.PI };
}

/* ---- positions: published ephemeris first, validated propagation second -- */

// Geocentric astrometric J2000 RA/Dec from the orbital elements, with the tolerance grade that applies
// at this instant and the distance from the element epoch that produced it.
function positionFromElements(comet, tMs) {
  const epochMs = comet.elements.epoch_iso ? Date.parse(comet.elements.epoch_iso) : jdToMs(num(comet.elements.epoch));
  const daysFromEpoch = Math.abs(tMs - epochMs) / DAY;
  const tolerance = KEPLER_TOLERANCE.find(entry => daysFromEpoch <= entry.maxDays);
  const position = A.geocentricFromHeliocentric(jd => propagateElements(comet.elements, jd), tMs);
  return { ...position, method: 'kepler-two-body', grade: tolerance.grade, daysFromEpoch: round(daysFromEpoch, 1),
    toleranceArcmin: tolerance.arcmin, frame: 'geocentric astrometric J2000 RA/Dec',
    provenance: { library: LIBRARY, method: 'two-body Kepler propagation of the published elements',
      note: 'planetary perturbations and non-gravitational acceleration are not modelled' } };
}
// Interpolation of the published Horizons samples. A Catmull-Rom cubic through the four samples around
// the instant is exact at the samples and much closer to the true track than linear interpolation
// between 48-hour samples (the measured node curvature of the fastest comet near perihelion implies a
// linear error of about 3 arcminutes, which the cubic removes almost entirely). Right ascension is
// unwrapped locally first so the 0/360 boundary cannot corrupt the polynomial.
function positionFromEphemeris(entry, tMs) {
  const points = entry.points;
  if (!points || points.length < 2) return null;
  let lo = 0, hi = points.length - 1;
  if (tMs < points[lo].t || tMs > points[hi].t) return null;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid].t <= tMs) lo = mid; else hi = mid; }
  const a = points[lo], b = points[hi];
  const span = b.t - a.t;
  const f = span > 0 ? (tMs - a.t) / span : 0;
  const p0 = points[lo - 1] || a, p3 = points[hi + 1] || b;
  // Every right ascension is unwrapped against the SAME reference (the interval's first sample),
  // otherwise a value that already sits on the far side of the 0/360 boundary stays wrapped and the
  // polynomial produces a nonsense direction.
  const unwrap = (value, reference) => value + Math.round((reference - value) / 360) * 360;
  const unwrapped = { p0: unwrap(p0.raDeg, a.raDeg), p1: a.raDeg, p2: unwrap(b.raDeg, a.raDeg), p3: unwrap(p3.raDeg, a.raDeg) };
  const catmull = (v0, v1, v2, v3) => v1 + 0.5 * f * ((v2 - v0) + f * ((2 * v0 - 5 * v1 + 4 * v2 - v3) + f * (3 * (v1 - v2) + v3 - v0)));
  const ra = ((catmull(unwrapped.p0, unwrapped.p1, unwrapped.p2, unwrapped.p3) % 360) + 360) % 360;
  const dec = catmull(p0.decDeg, a.decDeg, b.decDeg, p3.decDeg);
  const distance = catmull(p0.distanceAu, a.distanceAu, b.distanceAu, p3.distanceAu);
  const helio = catmull(p0.helioDistanceAu, a.helioDistanceAu, b.helioDistanceAu, p3.helioDistanceAu);
  const linearDec = a.decDeg + (b.decDeg - a.decDeg) * f;
  return { raDeg: ra, decDeg: Math.max(-90, Math.min(90, dec)),
    distanceAu: distance, helioDistanceAu: helio,
    method: 'published-ephemeris', grade: 'horizons-sampled', sampleGapHours: round(span / HOUR, 1),
    interpolationFraction: round(f, 3), frame: 'geocentric astrometric J2000 RA/Dec',
    interpolation: { scheme: 'catmull-rom cubic through the four neighbouring samples',
      linearDecDeg: round(linearDec, 4), curvatureCorrectionDeg: round(dec - linearDec, 4) },
    provenance: { library: 'JPL Horizons published ephemeris in the dataset', method: 'cubic interpolation between published samples',
      note: 'samples are one to two days apart; the interpolation is exact at every sample' } };
}
// Position for an instant: prefer the published ephemeris, fall back to propagation with its grade.
function position(comet, ephemerisEntry, tMs) {
  const sampled = ephemerisEntry ? positionFromEphemeris(ephemerisEntry, tMs) : null;
  if (sampled) return sampled;
  if (!ephemerisEntry) return positionFromElements(comet, tMs);
  const propagated = positionFromElements(comet, tMs);
  return { ...propagated, ephemerisMissed: true,
    note: 'the published ephemeris does not cover this instant, so the validated two-body propagation was used instead' };
}
// Where the object is in the observer's sky. The J2000 direction is rotated into the horizontal frame,
// which is the correct path for a position that is not a solar-system body lookup.
function horizontalFor(positionResult, tMs, site, options) {
  const horizontal = A.horizontalFromJ2000(positionResult.raDeg, positionResult.decDeg, tMs, site, options);
  return { ...horizontal, method: positionResult.method, grade: positionResult.grade };
}

/* ---- brightness: measured and predicted are never merged ----------------- */

// IAU total-magnitude model: m = M1 + 5 log10(delta) + K1 log10(r). This is a model prediction from
// catalog parameters; it is labelled as such everywhere and never compared with a measurement as if
// the two were the same kind of number.
function predictedMagnitude(absolute, rAu, deltaAu) {
  if (!absolute || !Number.isFinite(num(absolute.M1)) || !Number.isFinite(num(absolute.K1))
    || !Number.isFinite(rAu) || !Number.isFinite(deltaAu) || rAu <= 0 || deltaAu <= 0) return null;
  return { magnitude: round(num(absolute.M1) + 5 * Math.log10(deltaAu) + num(absolute.K1) * Math.log10(rAu), 2),
    model: 'IAU total magnitude: M1 + 5*log10(delta) + K1*log10(r)',
    inputs: { M1: num(absolute.M1), K1: num(absolute.K1), rAu: round(rAu, 4), deltaAu: round(deltaAu, 4) },
    caveat: 'prediction from catalog magnitude parameters, not a measurement' };
}
// Measured brightness as published by COBS, with the count of contributing observations so a single
// outlier can be judged. Never substituted for a prediction, and never used to claim visibility.
function measuredBrightness(comet) {
  const measured = comet.brightness && comet.brightness.measured;
  if (!measured || !measured.latest || !Number.isFinite(measured.latest.magnitude)) return null;
  return { magnitude: measured.latest.magnitude, date: measured.latest.date, method: measured.latest.method,
    observerCount: measured.latest.observer_count || null, source: 'COBS - Comet Observation Database',
    median30d: measured.median_30d ? measured.median_30d.magnitude : null,
    trend: measured.trend || null, observed: true };
}
// Optical requirement from a brightness value, with the reason recorded. A comet is diffuse, so the
// threshold is deliberately stricter than for a star of the same magnitude.
function opticalFor(magnitude, source) {
  if (!Number.isFinite(magnitude)) return { level: 'unknown', reason: 'no ' + (source || 'brightness') + ' value is available' };
  if (magnitude <= A.RULES.nakedEyeMagnitude) return { level: 'naked-eye maybe',
    reason: 'a predicted or measured total magnitude of ' + magnitude + ' suggests a possible naked-eye object, but a diffuse comet is much harder to see than a star of the same brightness' };
  if (magnitude <= A.RULES.cometBinocularMagnitude) return { level: 'binoculars',
    reason: 'total magnitude ' + magnitude + ' is binocular territory, and the coma may be diffuse' };
  return { level: 'telescope', reason: 'total magnitude ' + magnitude + ' needs a telescope' };
}

/* ---- dataset validation ------------------------------------------------ */

function validateCatalog(dataset, now) {
  const errors = [], warnings = [];
  if (!dataset || typeof dataset !== 'object') return { ok: false, errors: ['no comet catalog was supplied'], warnings, comets: [] };
  if (dataset.schema !== CATALOG_REQUIREMENT) errors.push('unexpected catalog schema ' + dataset.schema);
  if (!dataset.sources || !dataset.sources.elements || !dataset.sources.ephemeris) errors.push('missing source provenance');
  const comets = Array.isArray(dataset.comets) ? dataset.comets : [];
  if (comets.length < 1) errors.push('the catalog contains no comets');
  const ids = new Set();
  for (const comet of comets) {
    if (!comet.id || !comet.name) errors.push('comet without an identifier');
    if (ids.has(comet.id)) errors.push('duplicate comet id ' + comet.id);
    ids.add(comet.id);
    const raw = comet.elements || {};
    const e = { e: num(raw.e), q: num(raw.q), i: num(raw.i), a: num(raw.a), tp: num(raw.tp), epoch: num(raw.epoch) };
    if (!Number.isFinite(e.e) || e.e < 0 || e.e > 5) errors.push(comet.id + ' has an unusable eccentricity');
    if (!Number.isFinite(e.q) || e.q <= 0) errors.push(comet.id + ' has an unusable perihelion distance');
    if (!Number.isFinite(e.i) || e.i < 0 || e.i > 180) errors.push(comet.id + ' has an unusable inclination');
    if (e.e < 1 && !Number.isFinite(e.a)) errors.push(comet.id + ' is elliptical but has no semi-major axis');
    if (!Number.isFinite(e.tp)) errors.push(comet.id + ' has no perihelion time');
    if (!comet.brightness || !comet.brightness.absolute) warnings.push(comet.id + ' has no published magnitude parameters');
    if (comet.brightness && comet.brightness.predicted && !comet.brightness.predicted.caveat) errors.push(comet.id + ' has a prediction without a caveat');
  }
  const generated = Date.parse(dataset.generated_at || '');
  const ageDays = Number.isFinite(generated) ? (now - generated) / DAY : null;
  if (ageDays !== null && ageDays > 45) warnings.push('the catalog is ' + Math.round(ageDays) + ' days old');
  if (ageDays !== null && ageDays > 400) errors.push('the catalog is more than a year old and its orbits are stale');
  return { ok: errors.length === 0, errors, warnings, comets, ageDays: ageDays === null ? null : round(ageDays, 1),
    generatedAt: dataset.generated_at || null, sources: dataset.sources || null,
    thresholds: dataset.thresholds || null, noteworthy: dataset.noteworthy || null, notes: dataset.notes || [] };
}
// The ephemeris artifact must line up with the catalog: every comet needs points, and the points must
// be ordered, inside the declared window and physically plausible.
function validateEphemeris(dataset, catalog, now) {
  const errors = [];
  if (!dataset || typeof dataset !== 'object') return { ok: false, errors: ['no ephemeris artifact was supplied'], comets: {} };
  if (dataset.schema !== EPHEMERIS_REQUIREMENT) errors.push('unexpected ephemeris schema ' + dataset.schema);
  const entries = {};
  for (const comet of (catalog && catalog.comets) || []) {
    const raw = dataset.comets && dataset.comets[comet.id];
    if (!raw || !Array.isArray(raw.points) || raw.points.length < 2) { errors.push(comet.id + ' has no usable ephemeris'); continue; }
    const points = raw.points.map(row => Array.isArray(row)
      ? { t: Date.parse(row[0]), raDeg: row[1], decDeg: row[2], helioDistanceAu: row[3], distanceAu: row[4] }
      : { t: Date.parse(row.t_iso || row.t), raDeg: row.ra_deg, decDeg: row.dec_deg, helioDistanceAu: row.r_au, distanceAu: row.delta_au });
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (!Number.isFinite(p.t) || !Number.isFinite(p.raDeg) || !Number.isFinite(p.decDeg)
        || !(p.distanceAu > 0) || !(p.helioDistanceAu > 0) || Math.abs(p.decDeg) > 90) {
        errors.push(comet.id + ' has an invalid ephemeris row'); break;
      }
      if (i && p.t <= points[i - 1].t) { errors.push(comet.id + ' ephemeris timestamps are not increasing'); break; }
    }
    entries[comet.id] = { points, start: points[0].t, end: points[points.length - 1].t,
      stepHours: round((points[1].t - points[0].t) / HOUR, 2), count: points.length };
  }
  const generated = Date.parse(dataset.generated_at || '');
  const ageDays = Number.isFinite(generated) ? (now - generated) / DAY : null;
  return { ok: errors.length === 0, errors, comets: entries, ageDays: ageDays === null ? null : round(ageDays, 1),
    generatedAt: dataset.generated_at || null, source: dataset.source || null, frame: dataset.frame || null };
}

/* ---- one comet on one night -------------------------------------------- */

// Evaluate a comet for one local night: altitude track through the dark hours, the best usable window,
// moonlight, optical requirement and the two brightness values kept deliberately separate.
function evaluate(comet, ephemerisEntry, site, night, context) {
  const options = (context && context.options) || {};
  const minimum = options.minAltitude || A.RULES.minAltitudeObservable;
  const middle = Math.round((night.start + night.end) / 2);
  const prediction = predictedMagnitude(comet.brightness && comet.brightness.absolute, null, null);
  const dark = A.darkness(site, night.start, night.end);
  const span = dark.intervals.astronomical[0] || dark.intervals.nautical[0] || dark.intervals.civil[0];
  const track = [];
  const step = (options.stepMinutes || 15) * MINUTE;
  for (let t = night.start; t <= night.end; t += step) {
    const p = position(comet, ephemerisEntry, t);
    const horizontal = horizontalFor(p, t, site);
    track.push({ t, altitude: horizontal.altitude, azimuth: horizontal.azimuth, position: p });
  }
  const best = track.reduce((a, b) => (b.altitude > a.altitude ? b : a));
  const usable = span ? track.filter(p => p.t >= span[0] && p.t <= span[1] && p.altitude >= minimum) : [];
  const start = usable.length ? usable[0].t : null;
  const end = usable.length ? usable[usable.length - 1].t : null;
  const peak = usable.length ? usable.reduce((a, b) => (b.altitude > a.altitude ? b : a)) : best;
  const observable = !!(start && end);
  const measured = measuredBrightness(comet);
  const predicted = peak.position ? predictedMagnitude(comet.brightness && comet.brightness.absolute, peak.position.helioDistanceAu, peak.position.distanceAu) : null;
  const reference = measured ? measured.magnitude : predicted ? predicted.magnitude : null;
  const optical = opticalFor(reference, measured ? 'measured' : predicted ? 'predicted' : 'no');
  const moon = A.moonInfo(peak.t, site);
  const interference = A.moonInterference(moon, { altitude: peak.altitude, azimuth: peak.azimuth }, { faint: true });
  const limiting = [];
  const caveats = [];
  if (!span) { caveats.push('no twilight dark enough at this location on this date'); limiting.push('no darkness'); }
  else if (dark.achieved !== 'astronomical') limiting.push(dark.achieved + ' twilight');
  if (!observable) { caveats.push('never rises ' + minimum + '\u00b0 above the horizon during the dark hours at this site'); limiting.push('altitude'); }
  if (interference.level === 'washed-out') { caveats.push('moonlight interference: ' + interference.reason); limiting.push('moonlight'); }
  else if (interference.level === 'glare') limiting.push('moonlight glare');
  if (!measured) caveats.push('no recent measured brightness for this comet: only a catalog prediction is available');
  if (peak.position && peak.position.ephemerisMissed) caveats.push(peak.position.note);
  if (peak.position && peak.position.grade !== 'horizons-sampled') {
    caveats.push('position from two-body propagation ' + peak.position.daysFromEpoch + ' days from the element epoch' +
      (peak.position.toleranceArcmin ? ' (measured tolerance about ' + peak.position.toleranceArcmin + ' arcminutes)' : ' (beyond the validated range: treat the position as approximate)'));
  }
  for (const note of comet.caveats || []) caveats.push(note);
  return { kind: 'comet', objects: [comet.name], cometId: comet.id, designation: comet.designation || comet.id,
    site, night: night.day || null,
    t: { start: observable ? start : Math.round(middle), end: observable ? end : Math.round(middle),
      best: observable ? peak.t : Math.round(middle) },
    observable,
    positions: [{ name: comet.name, t: peak.t,
      raDeg: peak.position ? round(peak.position.raDeg, 3) : null,
      decDeg: peak.position ? round(peak.position.decDeg, 3) : null,
      altitude: round(peak.altitude, 2), azimuth: round(peak.azimuth, 1), compass: A.compass(peak.azimuth),
      distanceAu: peak.position ? round(peak.position.distanceAu, 4) : null,
      optical: optical.level }],
    optical: optical.level,
    data: { measuredBrightness: measured || null, predictedBrightness: predicted || null,
      brightnessSource: measured ? 'COBS measurement' : predicted ? 'catalog model prediction' : 'unknown',
      opticalReason: optical.reason,
      positionMethod: peak.position ? peak.position.method : null,
      positionGrade: peak.position ? peak.position.grade : null,
      positionToleranceArcmin: peak.position ? peak.position.toleranceArcmin : null,
      daysFromElementEpoch: peak.position ? peak.position.daysFromEpoch : null,
      helioDistanceAu: peak.position ? round(peak.position.helioDistanceAu, 4) : null,
      distanceAu: peak.position ? round(peak.position.distanceAu, 4) : null,
      altitudeAtBest: round(peak.altitude, 2), peakAltitude: round(best.altitude, 2),
      darknessAchieved: dark.achieved, darknessLimited: dark.limited,
      moon: { illumination: round(moon.phaseFraction, 3), altitude: round(moon.altitude, 1), interference: interference.level },
      limitingFactors: limiting, minimumAltitude: minimum,
      trend: measured && measured.trend ? measured.trend : null,
      ephemerisAuthoritative: !!(peak.position && peak.position.method === 'published-ephemeris') },
    caveats,
    provenance: { library: LIBRARY, method: peak.position ? peak.position.provenance.method : 'unknown',
      catalog: comet.links || null, orbitSource: comet.elements.reference || null,
      datasetGeneratedAt: context && context.generatedAt ? context.generatedAt : null } };
}

/* ---- plan and noteworthy changes --------------------------------------- */

// Opportunities for every catalogued comet on the supplied nights. Bounded by construction: only the
// comets the pipeline published are considered, and at most `maxNightsPerComet` nights are evaluated
// per comet (the nights around its best geometry), so the page never grows with catalog size.
function plan(catalog, ephemeris, options) {
  const now = (options && options.now) || Date.now();
  const site = options && options.site;
  const windows = (options && options.windows) || [];
  if (!site) throw new Error('comet plan requires an observing site');
  const validation = validateCatalog(catalog, now);
  const ephemerisValidation = validateEphemeris(ephemeris, validation, now);
  const result = { validation, ephemerisValidation, comets: [], skipped: [], noteworthy: validation.noteworthy || null };
  if (!validation.ok) return result;
  if (!ephemerisValidation.ok) result.skipped.push({ reason: 'the ephemeris artifact is missing or invalid: ' + ephemerisValidation.errors.slice(0, 2).join('; ') });
  for (const comet of validation.comets) {
    const entry = ephemerisValidation.comets[comet.id] || null;
    const perNight = windows.map(night => evaluate(comet, entry, site, night, { options, generatedAt: validation.generatedAt }));
    const observable = perNight.filter(o => o.observable);
    if (!observable.length) { result.skipped.push({ comet: comet.id, reason: 'not observable from this site in the planning window' }); continue; }
    result.comets.push(...observable);
  }
  return result;
}
// Noteworthy changes as published by the pipeline. Nothing is invented here: the lists come from the
// dataset's own comparison against its previous revision, and an empty list is a normal result.
function changes(catalog) {
  const noteworthy = (catalog && catalog.noteworthy) || null;
  if (!noteworthy) return { available: false, reason: 'the catalog does not carry a change comparison', newObjects: [], brightened: [], faded: [], orbitUpdates: [], approaching: [], basis: null };
  const list = value => (Array.isArray(value) ? value : []);
  return { available: true, basis: noteworthy.basis || null,
    newObjects: list(noteworthy.new_objects), brightened: list(noteworthy.brightened), faded: list(noteworthy.faded),
    orbitUpdates: list(noteworthy.orbit_updates), approaching: list(noteworthy.approaching_minimum_delta),
    thresholds: (catalog && catalog.thresholds) || null,
    empty: !['new_objects', 'brightened', 'faded', 'orbit_updates', 'approaching_minimum_delta'].some(key => list(noteworthy[key]).length) };
}

root.OverheadComets = { CATALOG_REQUIREMENT, EPHEMERIS_REQUIREMENT, KEPLER_TOLERANCE, LIBRARY,
  solveElliptic, solveHyperbolic, solveBarker, propagateElements, jdToMs, msToJd, num,
  positionFromElements, positionFromEphemeris, position, horizontalFor, predictedMagnitude, measuredBrightness,
  opticalFor, validateCatalog, validateEphemeris, evaluate, plan, changes };
if (typeof module !== 'undefined') module.exports = root.OverheadComets;
})(typeof self !== 'undefined' ? self : globalThis);
