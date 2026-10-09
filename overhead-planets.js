/* Overhead planetary events: visibility, parades, conjunctions, oppositions, elongations,
   Moon/planet pairings and eclipses. Pure computation over overhead-astro.js; no DOM, no network.
   Every function returns plain "candidate" objects that overhead-opportunities.js normalises,
   validates and ranks. Nothing here invents an event: a candidate exists only because a calculation
   found a real geometric circumstance, and each carries the numbers behind it. */
(function (root) {
'use strict';
const A = root.OverheadAstro;
if (!A) throw new Error('overhead-planets.js requires overhead-astro.js');
const DAY = 86400000, HOUR = 3600000, MINUTE = 60000;
const RULES = A.RULES;
const CLASSICAL = A.NAKED_EYE_PLANETS.slice();
const TELESCOPIC = A.TELESCOPIC_PLANETS.slice();
const ALL_PLANETS = CLASSICAL.concat(TELESCOPIC);
const LIBRARY = 'overhead-planets.js @ Astronomy Engine ' + A.LIBRARY.version;
const round = (value, digits) => (Number.isFinite(value) ? Math.round(value * Math.pow(10, digits)) / Math.pow(10, digits) : null);

// Optical requirement from the model magnitude. A planet's magnitude is a point-source value, so it is
// compared with the point-source limits. Uranus and Neptune are forced into the telescope band at
// every magnitude they reach: they must never be offered as a naked-eye sighting.
function opticalFor(name, magnitude) {
  if (TELESCOPIC.includes(name)) return 'telescope';
  if (!Number.isFinite(magnitude)) return 'unknown';
  if (magnitude <= RULES.nakedEyeMagnitude) return 'naked-eye';
  if (magnitude <= RULES.binocularMagnitude) return 'binocular';
  return 'telescope';
}
// Mercury and Venus are usually only visible while the sky is still bright, so their windows may use
// nautical or civil twilight - and every candidate records that it did.
const allowsTwilight = name => name === 'Mercury' || name === 'Venus';

function positionRecord(name, t, site) {
  const horizontal = A.horizontal(name, t, site);
  const info = A.magnitude(name, t);
  return { name, t,
    raDeg: round(horizontal.raDeg, 4), decDeg: round(horizontal.decDeg, 4),
    altitude: round(horizontal.altitude, 2), azimuth: round(horizontal.azimuth, 1),
    compass: A.compass(horizontal.azimuth),
    magnitude: round(info.magnitude, 2), magnitudeSource: info.source,
    phaseAngle: round(info.phaseAngle, 1),
    elongationDeg: round(A.sunAngle(name, t), 1),
    optical: opticalFor(name, info.magnitude),
    frame: horizontal.frame, refractionApplied: horizontal.refractionApplied };
}

// Local observability of one planet on one night, with the caveats that make the answer honest.
function visibility(name, site, night, options) {
  const window = A.bestWindow(name, site, night, Object.assign({}, options || {}, { allowTwilight: allowsTwilight(name) }));
  const moment = window.ok ? window.peak.t : (window.peak ? window.peak.t : Math.round((night.start + night.end) / 2));
  const position = positionRecord(name, moment, site);
  const caveats = [];
  if (!window.ok) caveats.push(window.reason);
  if (name === 'Mercury') {
    if (position.elongationDeg < 15) caveats.push('only ' + position.elongationDeg.toFixed(0) + '\u00b0 from the Sun, so it is lost in bright twilight');
    else if (window.twilight) caveats.push('a twilight sighting: it sets or rises before the sky is fully dark');
  }
  if (name === 'Venus' && window.twilight) caveats.push('a twilight sighting: it is low while the sky is still bright');
  if (TELESCOPIC.includes(name)) caveats.push('not a naked-eye object: binoculars or a telescope are required and it stays a star-like point');
  if (window.ok && window.peak.altitude < RULES.minAltitudeGood) caveats.push('stays low (peak ' + window.peak.altitude.toFixed(0) + '\u00b0), so trees, buildings and haze may hide it');
  const optical = opticalFor(name, position.magnitude);
  if (!window.ok) return { name, site, night, observable: false, window, position: null, caveats, optical };
  return { name, site, night, observable: true, window, position, caveats, optical,
    darknessUsed: window.darknessUsed, twilight: window.twilight };
}
// Every planet's local opportunity for a list of nights. Telescopic planets are included but always
// classified as telescope-only, so no caller can present them as naked-eye sightings by accident.
function visibilityForAll(site, windows, options) {
  const out = { site, nights: windows.length, planets: {} };
  for (const name of ALL_PLANETS) out.planets[name] = windows.map(night => visibility(name, site, night, options));
  return out;
}

// Planets above the minimum altitude at one instant, used by the parade scan.
function aboveAt(names, t, site, minimum) {
  const above = [];
  for (const name of names) if (A.horizontal(name, t, site).altitude >= minimum) above.push(name);
  return above;
}
// A "parade" is a real common observing interval: several planets simultaneously above the minimum
// altitude while the observer's sky is dark. Sampling the dark window and then requiring every
// participating planet to be above the minimum at every sample of the interval is what separates a
// parade from planets that merely happen to be up on the same night at unrelated times.
function detectParades(site, windows, options) {
  const minimum = (options && options.minAltitude) || RULES.minAltitudeObservable;
  const stepMinutes = (options && options.stepMinutes) || 5;
  const required = (options && options.minPlanets) || 3;
  const found = [];
  for (const night of windows) {
    const dark = A.darkness(site, night.start, night.end);
    // Use the darkest interval the site actually gets; a grouping in twilight is a much weaker sight.
    const span = dark.intervals.astronomical[0] || dark.intervals.nautical[0] || dark.intervals.civil[0];
    if (!span) continue;
    const step = stepMinutes * MINUTE;
    const runs = [];
    let run = null;
    for (let t = span[0]; t <= span[1]; t += step) {
      const above = aboveAt(CLASSICAL, t, site, minimum);
      if (above.length >= required) {
        if (!run) run = { start: t, end: t, sets: [] };
        run.end = t;
        run.sets.push(above);
      } else if (run) { runs.push(run); run = null; }
    }
    if (run) runs.push(run);
    for (const candidate of runs) {
      // A grouping that lasts one sample is not an observing opportunity.
      if (candidate.end - candidate.start < (options && options.minDurationMinutes || 10) * MINUTE) continue;
      // Only planets above the minimum across the WHOLE interval participate in the parade.
      const participants = CLASSICAL.filter(name => candidate.sets.every(set => set.includes(name)));
      if (participants.length < required) continue;
      const telescopes = telescopicInInterval(site, candidate, minimum);
      const peakTime = Math.round((candidate.start + candidate.end) / 2);
      const positions = participants.map(name => positionRecord(name, peakTime, site));
      found.push({ kind: 'parade', objects: participants.slice(), telescopes,
        night: night.day || null, observable: true,
        t: { start: candidate.start, end: candidate.end, best: peakTime },
        durationMin: Math.round((candidate.end - candidate.start) / MINUTE),
        positions,
        optical: positions.every(p => p.optical === 'naked-eye') ? 'naked-eye' : 'naked-eye and binocular',
        data: { minimumAltitude: minimum, classicalCount: participants.length, telescopicCount: telescopes.length,
          darknessAchieved: dark.achieved, sector: positions.map(p => p.compass).join(', '),
          eclipticNote: 'these planets lie along the ecliptic, so they appear spread across a sector of sky rather than in a straight line' },
        caveats: ['the grouping is apparent: the planets are at very different distances and only look clustered because they share the ecliptic'],
        provenance: { library: LIBRARY, method: 'simultaneous altitude sampling across the dark window, full-interval participation required' } });
    }
  }
  return found.sort((a, b) => b.data.classicalCount - a.data.classicalCount || b.durationMin - a.durationMin || a.t.best - b.t.best);
}
// Telescopic planets are reported for context but never counted towards the parade's naked-eye claim.
function telescopicInInterval(site, candidate, minimum) {
  const step = 10 * MINUTE;
  const present = [];
  for (const name of TELESCOPIC) {
    let always = true;
    for (let t = candidate.start; t <= candidate.end; t += step) {
      if (A.horizontal(name, t, site).altitude < minimum) { always = false; break; }
    }
    if (always) present.push(name);
  }
  return present;
}

/* ---- shared local-window helpers --------------------------------------- */

// Intersection of two interval lists, keeping only overlaps longer than a minute.
function intersectIntervals(first, second) {
  const out = [];
  for (const [a1, b1] of first) for (const [a2, b2] of second) {
    const start = Math.max(a1, a2), end = Math.min(b1, b2);
    if (end - start > MINUTE) out.push([start, end]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}
// Longest interval in which every named body is above the minimum altitude.
function commonWindow(site, names, span, minimum) {
  let intervals = [[span[0], span[1]]];
  for (const name of names) {
    intervals = intersectIntervals(intervals, A.aboveIntervals(name, site, span[0], span[1], minimum));
    if (!intervals.length) return null;
  }
  return intervals.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
}
// The dark (or twilight-usable) interval containing an instant, or the next one after it. A
// conjunction whose minimum happens in local daylight is reported with the shift it had to make
// instead of pretending the closest approach is observable.
function darkWindowAround(site, t) {
  const dark = A.darkness(site, t - 18 * HOUR, t + 30 * HOUR, { stepMinutes: 10 });
  const civil = dark.intervals.civil;
  const containing = civil.find(([a, b]) => t >= a && t <= b);
  if (containing) return { span: containing, shifted: false, deltaMs: 0 };
  const next = civil.filter(([a]) => a > t).sort((x, y) => x[0] - y[0])[0];
  return next ? { span: next, shifted: true, deltaMs: next[0] - t } : { span: null, shifted: false, deltaMs: null };
}

/* ---- pairings: conjunctions and Moon/planet approaches ------------------ */

// Apparent pairings inside [start,end]. The formal astronomical event is the minimum of the apparent
// geocentric separation; the local opportunity is computed separately, because the closest approach
// is often below the horizon or in daylight where the observer actually is.
function conjunctions(site, start, end, options) {
  const opts = options || {};
  const maxSeparation = opts.maxSeparationDeg || RULES.conjunctionDeg;
  const out = [];
  for (let i = 0; i < ALL_PLANETS.length; i++) {
    for (let j = i + 1; j < ALL_PLANETS.length; j++) {
      const a = ALL_PLANETS[i], b = ALL_PLANETS[j];
      for (const minimum of A.minimumSeparations(a, b, start, end, { stepHours: opts.stepHours || 12 })) {
        if (minimum.separationDeg <= maxSeparation) out.push(pairingCandidate(site, minimum, a, b, opts));
      }
    }
  }
  return out.sort((x, y) => x.data.separationDeg - y.data.separationDeg || x.t.best - y.t.best);
}
// Moon/planet approaches need a finer grid: the Moon moves about 13 degrees per day.
function moonPairings(site, start, end, options) {
  const opts = options || {};
  const maxSeparation = opts.maxMoonSeparationDeg || 6;
  const out = [];
  for (const planet of ALL_PLANETS) {
    for (const minimum of A.minimumSeparations('Moon', planet, start, end, { stepHours: opts.moonStepHours || 2 })) {
      if (minimum.separationDeg <= maxSeparation) out.push(pairingCandidate(site, minimum, 'Moon', planet, opts));
    }
  }
  return out.sort((x, y) => x.t.best - y.t.best);
}
function pairingCandidate(site, minimum, a, b, options) {
  const around = darkWindowAround(site, minimum.t);
  const minimumAltitude = (options && options.minAltitude) || RULES.minAltitudeObservable;
  const names = [a, b];
  const common = around.span ? commonWindow(site, names, around.span, minimumAltitude) : null;
  const localMoment = common ? Math.round((common[0] + common[1]) / 2) : Math.round(minimum.t);
  const positions = names.map(name => positionRecord(name, localMoment, site));
  const localSeparation = A.separation(positions[0].raDeg, positions[0].decDeg, positions[1].raDeg, positions[1].decDeg);
  const caveats = [];
  if (around.shifted) caveats.push('closest approach happens in local daylight (' + Math.round(around.deltaMs / HOUR) + ' h before the next usable darkness), so the quoted local time is the best available look, not the minimum itself');
  if (!common) caveats.push('the pair is below ' + minimumAltitude + '\u00b0 or in daylight for the whole usable window here');
  if (minimum.separationDeg <= RULES.closePairingDeg) caveats.push('a close pairing: both fit inside a binocular field at the same time');
  const withMoon = names.includes('Moon');
  if (withMoon) caveats.push('the Moon moves quickly, so the separation changes noticeably within a few hours');
  return { kind: withMoon ? 'moon-planet' : 'conjunction', objects: names,
    t: { start: common ? common[0] : Math.round(minimum.t), end: common ? common[1] : Math.round(minimum.t),
      best: localMoment, event: minimum.t },
    durationMin: common ? Math.round((common[1] - common[0]) / MINUTE) : 0,
    observable: !!common,
    positions,
    optical: positions.every(p => p.optical === 'naked-eye') ? 'naked-eye'
      : positions.some(p => p.optical === 'telescope') ? 'telescope for one of the pair' : 'binocular',
    data: { separationDeg: round(minimum.separationDeg, 3), localSeparationDeg: round(localSeparation, 3),
      formalEvent: new Date(minimum.t).toISOString(),
      eventShiftHours: around.shifted ? round(around.deltaMs / HOUR, 1) : 0,
      darknessAchieved: around.span ? 'civil or better' : 'none', frame: minimum.frame },
    caveats,
    provenance: { library: LIBRARY, method: 'ternary-refined minimum of the apparent geocentric separation, local window from common altitude intervals' } };
}

/* ---- oppositions, greatest elongations and eclipses -------------------- */

// Oppositions of the superior planets: the formal event is the heliocentric longitude match, and the
// local opportunity is that night's observing window, so a planet opposite the Sun is never described
// as visible without saying where it is at the observer's own midnight.
function oppositions(site, start, end, options) {
  const out = [];
  for (const planet of ['Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']) {
    for (const t of A.oppositions(planet, start, end)) {
      const around = darkWindowAround(site, t);
      const minimum = (options && options.minAltitude) || RULES.minAltitudeObservable;
      const common = around.span ? commonWindow(site, [planet], around.span, minimum) : null;
      const moment = common ? Math.round((common[0] + common[1]) / 2) : Math.round(t);
      const position = positionRecord(planet, moment, site);
      const caveats = [];
      if (TELESCOPIC.includes(planet)) caveats.push('visible all night, but still telescope-only: it stays a faint star-like point');
      caveats.push('opposition is a whole-night circumstance, not a moment: the planet is highest near local midnight');
      if (!common) caveats.push('the planet does not clear ' + minimum + '\u00b0 during darkness at this site on the opposition date');
      out.push({ kind: 'opposition', objects: [planet],
        t: { start: around.span ? around.span[0] : t, end: around.span ? around.span[1] : t, best: moment, event: t },
        observable: !!common, positions: [position], optical: opticalFor(planet, position.magnitude),
        data: { elongationDeg: round(A.sunAngle(planet, t), 2),
          diskNote: 'this is the year\u2019s closest approach, so the disc is at its largest',
          darknessAchieved: around.span ? 'civil or better' : 'none' },
        caveats,
        provenance: { library: LIBRARY, method: 'SearchRelativeLongitude(body, 0) for heliocentric opposition plus the local night window' } });
    }
  }
  return out.sort((a, b) => a.t.event - b.t.event);
}
// Greatest elongations of Mercury and Venus, including whether the planet is a morning or evening
// object (the library reports the visibility, and it is surfaced rather than inferred).
function elongations(site, start, end, options) {
  const out = [];
  for (const planet of ['Mercury', 'Venus']) {
    for (const event of A.greatestElongations(planet, start, end)) {
      const around = darkWindowAround(site, event.t);
      const minimum = (options && options.minAltitude) || RULES.minAltitudeObservable;
      const window = around.span
        ? A.bestWindow(planet, site, { start: around.span[0], end: around.span[1] }, { minAltitude: minimum, allowTwilight: true })
        : null;
      const moment = window && window.ok ? window.peak.t : Math.round(event.t);
      const position = positionRecord(planet, moment, site);
      const caveats = [];
      if (!window || !window.ok) caveats.push(window ? window.reason : 'no usable twilight window at this site on the elongation date');
      else if (window.twilight) caveats.push('the most favourable time is while the sky is still bright, so contrast is poor');
      caveats.push('greatest elongation is the moment of maximum angle from the Sun, not automatically the easiest evening to see it');
      out.push({ kind: 'elongation', objects: [planet],
        t: { start: around.span ? around.span[0] : event.t, end: around.span ? around.span[1] : event.t, best: moment, event: event.t },
        observable: !!(window && window.ok), positions: [position], optical: opticalFor(planet, position.magnitude),
        data: { elongationDeg: round(event.elongationDeg, 2), visibility: event.visibility,
          distanceAu: round(event.geoDistanceAu, 3), phaseAngle: position.phaseAngle,
          darknessAchieved: window && window.ok ? window.darknessUsed : 'none' },
        caveats,
        provenance: { library: LIBRARY, method: 'SearchMaxElongation plus the local best window on the elongation night' } });
    }
  }
  return out.sort((a, b) => a.t.event - b.t.event);
}

// Eclipses. A lunar eclipse is reported with the Moon's altitude at mid-eclipse, so an eclipse below
// the horizon is never presented as observable. A solar eclipse only exists here when the library
// finds circumstances for this observer, which is the only reliable way to answer "can I see it".
function eclipses(site, start, end, options) {
  const out = [];
  for (const eclipse of A.lunarEclipses(site, start, end, (options && options.maxEclipses) || 6)) {
    const phases = eclipse.phases;
    const begin = phases.partial_begin || phases.penumbral_begin;
    const ends = phases.partial_end || phases.penumbral_end;
    const caveats = [];
    if (!eclipse.localVisible) caveats.push('mid-eclipse is below the horizon here (Moon at ' + eclipse.peak.altitude.toFixed(1) + '\u00b0), so it cannot be seen from this location');
    else if (eclipse.peak.altitude < RULES.minAltitudeObservable) caveats.push('mid-eclipse is only ' + eclipse.peak.altitude.toFixed(1) + '\u00b0 above the horizon here, so a clear horizon is essential');
    out.push({ kind: 'lunar-eclipse', objects: ['Moon'],
      t: { start: begin ? begin.t : eclipse.peak.t, end: ends ? ends.t : eclipse.peak.t, best: eclipse.peak.t, event: eclipse.peak.t },
      observable: eclipse.localVisible,
      positions: [positionRecord('Moon', eclipse.peak.t, site)],
      optical: 'naked-eye',
      data: { eclipseKind: eclipse.kind, obscuration: round(eclipse.obscuration, 3),
        semiDurationsMin: eclipse.semiDurationsMin, phases: eclipse.phases,
        altitudeAtPeak: round(eclipse.peak.altitude, 2), compass: eclipse.peak.compass },
      caveats,
      provenance: eclipse.provenance });
  }
  for (const eclipse of A.localSolarEclipses(site, start, end, (options && options.maxEclipses) || 4)) {
    const peak = eclipse.phases.peak;
    const caveats = ['never look at the Sun without a certified solar filter'];
    if (eclipse.kind !== 'total' && eclipse.kind !== 'annular') caveats.push('a partial eclipse only: the Sun is never fully covered from this location');
    if (peak.altitude < RULES.minAltitudeObservable) caveats.push('maximum occurs only ' + peak.altitude.toFixed(1) + '\u00b0 above the horizon here, so an unobstructed horizon is needed');
    out.push({ kind: 'solar-eclipse', objects: ['Sun', 'Moon'],
      t: { start: eclipse.phases.partial_begin ? eclipse.phases.partial_begin.t : peak.t,
        end: eclipse.phases.partial_end ? eclipse.phases.partial_end.t : peak.t, best: peak.t, event: peak.t },
      observable: true,
      positions: [positionRecord('Sun', peak.t, site)],
      optical: 'solar filter required',
      data: { eclipseKind: eclipse.kind, obscuration: round(eclipse.obscuration, 3), phases: eclipse.phases,
        altitudeAtPeak: round(peak.altitude, 2), compass: peak.compass,
        localOnlyNote: 'reported only because the eclipse is visible from this location' },
      caveats,
      provenance: eclipse.provenance });
  }
  return out.sort((a, b) => a.t.best - b.t.best);
}

/* ---- everything at once ------------------------------------------------ */

function events(site, start, end, options) {
  const opts = options || {};
  const out = [];
  if (opts.windows && opts.windows.length) out.push(...detectParades(site, opts.windows, opts));
  out.push(...conjunctions(site, start, end, opts));
  out.push(...moonPairings(site, start, end, opts));
  out.push(...oppositions(site, start, end, opts));
  out.push(...elongations(site, start, end, opts));
  out.push(...eclipses(site, start, end, opts));
  return out;
}

root.OverheadPlanets = { CLASSICAL, TELESCOPIC, ALL_PLANETS, opticalFor, allowsTwilight, positionRecord,
  visibility, visibilityForAll, detectParades, intersectIntervals, commonWindow, darkWindowAround,
  conjunctions, moonPairings, pairingCandidate, oppositions, elongations, eclipses, events };
if (typeof module !== 'undefined') module.exports = root.OverheadPlanets;
})(typeof self !== 'undefined' ? self : globalThis);
