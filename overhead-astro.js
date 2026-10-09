/* Overhead celestial layer: one place for solar-system geometry, observing windows,
   twilight, altitude/azimuth and event searches. Pure computation, no network, no DOM.
   Requires the pinned Astronomy Engine browser build (vendor/overhead/astronomy-2.1.19.min.js),
   which the host must load as window.Astronomy before this file runs. */
(function (root) {
'use strict';
const AE = root.Astronomy;
if (!AE) throw new Error('overhead-astro.js requires Astronomy Engine (window.Astronomy)');
const D2R = Math.PI / 180, R2D = 180 / Math.PI, DAY = 86400000, HOUR = 3600000, MINUTE = 60000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Astronomy Engine returns right ascension in sidereal HOURS (its EquatorialCoordinates contract);
// every function here returns degrees so callers never mix the two.
const LIBRARY = Object.freeze({ name: 'Astronomy Engine', version: '2.1.19', license: 'MIT',
  source: 'https://github.com/cosinekitty/astronomy', frames: 'EQJ/J2000 and true-equator-of-date' });

const PLANETS = Object.freeze(['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']);
// Mercury..Saturn are the classical naked-eye planets. Uranus and Neptune are telescopic at every
// magnitude they ever reach, so they are never bundled into a naked-eye claim.
const NAKED_EYE_PLANETS = Object.freeze(['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn']);
const TELESCOPIC_PLANETS = Object.freeze(['Uranus', 'Neptune']);
const ALL_BODIES = Object.freeze(['Sun', 'Moon', ...PLANETS]);
const isNakedEyePlanet = name => NAKED_EYE_PLANETS.includes(name);

function requireBody(name) {
  if (!ALL_BODIES.includes(name)) throw new Error('Unsupported body: ' + name);
  return name;
}
function observer(site) {
  if (!site || !Number.isFinite(site.lat) || !Number.isFinite(site.lon)) throw new Error('Observer requires finite latitude and longitude');
  return new AE.Observer(site.lat, site.lon, Number.isFinite(site.alt) ? site.alt : 0);
}
const timeOf = value => AE.MakeTime(value instanceof Date ? value : new Date(value));
// Accept a Date, an ISO string or epoch milliseconds wherever a time is expected, and always work in
// epoch milliseconds so arithmetic on windows cannot silently concatenate strings.
const toMs = value => (typeof value === 'number' ? value : timeOf(value).date.getTime());
// Terrestrial-time Julian date: the time basis JPL publishes orbital element epochs in.
const jdTT = value => timeOf(value).tt + 2451545.0;

/* ---- directions ---------------------------------------------------------- */

function unitVector(raDeg, decDeg) {
  const ra = raDeg * D2R, dec = decDeg * D2R, c = Math.cos(dec);
  return new AE.Vector(c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec));
}
// Angular separation in degrees between two directions. Uses the library's own vector angle so the
// convention matches Astronomy Engine exactly instead of re-deriving spherical trigonometry.
const separation = (ra1, dec1, ra2, dec2) => AE.AngleBetween(unitVector(ra1, dec1), unitVector(ra2, dec2));

/* ---- observing thresholds (one definition for every category) ------------ */

const RULES = Object.freeze({
  // Anything below these altitudes is treated as obstructed by terrain, buildings, haze or trees.
  minAltitudeObservable: 8,
  minAltitudeGood: 20,
  // Twilight levels in degrees of solar altitude; positive is above the horizon.
  twilight: Object.freeze({ civil: -6, nautical: -12, astronomical: -18 }),
  // Point-source naked-eye limit and the binocular limit used for optical requirements.
  nakedEyeMagnitude: 4.5,
  binocularMagnitude: 8.5,
  cometBinocularMagnitude: 9.0,
  // Moon interference: illumination must matter AND the Moon must be reasonably up and not far away.
  moonInterference: Object.freeze({ brightFraction: 0.5, faintFraction: 0.25, closeDeg: 30, nearDeg: 45, minMoonAltitude: 10 }),
  // Apparent proximity thresholds for pairings.
  conjunctionDeg: 5,
  closePairingDeg: 2.5,
});

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = azimuth => COMPASS[Math.round((((azimuth % 360) + 360) % 360) / 22.5) % 16];
// Angular distance in degrees between two horizontal-coordinate directions (altitude above the
// horizon, azimuth from north through east). Same spherical law of cosines the library uses, applied
// directly because horizontal coordinates need no frame rotation.
function horizonSeparation(alt1, az1, alt2, az2) {
  const a1 = alt1 * D2R, a2 = alt2 * D2R, d = (az1 - az2) * D2R;
  return Math.acos(clamp(Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(d), -1, 1)) * R2D;
}

/* ---- darkness and observing windows ------------------------------------- */

const sunAltitude = (date, site) => horizontal('Sun', date, site, { refraction: 'none' }).altitude;

// Contiguous intervals inside [start,end] where the Sun stays below `level` degrees, with both edges
// refined by bisection to about ten seconds. Sampling at five minutes cannot miss a twilight edge:
// the Sun moves at most 0.25 degrees per five minutes.
function belowIntervals(site, rawStart, rawEnd, level, options) {
  const start = toMs(rawStart), end = toMs(rawEnd);
  const step = ((options && options.stepMinutes) || 5) * MINUTE;
  const tol = 10000;
  const out = [];
  let open = null, previous = null;
  for (let t = start; ; t = Math.min(t + step, end)) {
    const altitude = sunAltitude(t, site), below = altitude <= level;
    if (below && open === null) {
      open = previous && previous.t < t && !previous.below
        ? refineCrossing(site, previous.t, t, level) : start;
    } else if (!below && open !== null) {
      out.push([open, refineCrossing(site, t - Math.min(step, t - start), t, level)]);
      open = null;
    }
    previous = { t, below };
    if (t >= end) break;
  }
  if (open !== null) out.push([open, end]);
  return out.filter(([a, b]) => b - a >= Math.max(tol, 5 * MINUTE));
}
function refineCrossing(site, low, high, level) {
  let a = low, b = high;
  const belowA = sunAltitude(a, site) <= level;
  while (b - a > 10000) {
    const m = (a + b) / 2;
    if ((sunAltitude(m, site) <= level) === belowA) a = m; else b = m;
  }
  return belowA ? a : b;
}
// Darkness for one observing night. Returns every level that is reached plus the best interval to
// use, which degrades gracefully from astronomical to nautical to civil twilight and never invents
// darkness at high latitude.
function darkness(site, rawStart, rawEnd, options) {
  const start = toMs(rawStart), end = toMs(rawEnd);
  const levels = { astronomical: [], nautical: [], civil: [] };
  for (const [key, level] of Object.entries(RULES.twilight)) levels[key] = belowIntervals(site, start, end, level, options);
  const longest = list => list.slice().sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0] || null;
  const chosen = [['astronomical', levels.astronomical], ['nautical', levels.nautical], ['civil', levels.civil]]
    .map(([key, list]) => ({ key, best: longest(list) })).find(entry => entry.best) || null;
  const best = chosen ? chosen.best : null;
  return { start, end, intervals: levels, achieved: chosen ? chosen.key : 'none',
    best: best ? { start: best[0], end: best[1], durationMin: (best[1] - best[0]) / MINUTE } : null,
    level: chosen ? RULES.twilight[chosen.key] : null,
    limited: !chosen || chosen.key !== 'astronomical',
    provenance: { library: LIBRARY.name + ' ' + LIBRARY.version, method: 'sampled solar altitude with bisected edges' } };
}


// Geometric geocentric (or topocentric) J2000 right ascension/declination, degrees and au.
// "Geometric" = light-time corrected but NOT aberration corrected: this is what JPL Horizons calls
// astrometric RA/Dec, and it is the quantity the committed Horizons fixtures compare against.
function geometricEquatorial(name, date, site) {
  requireBody(name);
  const t = timeOf(date), geo = AE.GeoVector(name, t, false);
  let v = geo;
  if (site) {
    const ov = AE.ObserverVector(t, observer(site), false);
    v = new AE.Vector(geo.x - ov.x, geo.y - ov.y, geo.z - ov.z, t);
  }
  const eq = AE.EquatorFromVector(v);
  return { raDeg: eq.ra * 15, decDeg: eq.dec, distanceAu: Math.hypot(v.x, v.y, v.z),
    topocentric: !!site, frame: 'J2000 geometric (astrometric)', aberration: false,
    provenance: { library: LIBRARY.name + ' ' + LIBRARY.version, method: 'GeoVector + EquatorFromVector' } };
}

// Apparent topocentric altitude/azimuth: the coordinates an observer actually points at.
// True equator of date, annual aberration included, refraction from the library's standard model
// (Astronomy Engine's documented 'normal' option). The airless value is computed alongside so the
// size of the refraction correction is reported rather than hidden.
function horizontal(name, date, site, options) {
  requireBody(name);
  const requested = (options && options.refraction) || 'normal';
  const mode = requested === 'normal' ? 'normal' : '';
  const t = timeOf(date), obs = observer(site);
  const eq = AE.Equator(name, t, obs, true, true);
  const hor = AE.Horizon(t, obs, eq.ra, eq.dec, mode);
  const airless = mode ? AE.Horizon(t, obs, eq.ra, eq.dec, '') : hor;
  return { t: t.date.getTime(), altitude: hor.altitude, azimuth: hor.azimuth,
    raDeg: eq.ra * 15, decDeg: eq.dec, distanceAu: eq.dist,
    refractionApplied: !!mode, refractionDeg: hor.altitude - airless.altitude,
    frame: 'topocentric apparent, true equator of date',
    provenance: { library: LIBRARY.name + ' ' + LIBRARY.version, method: 'Equator + Horizon',
      refraction: mode || 'none' } };
}

function magnitude(name, date) {
  const info = AE.Illumination(requireBody(name), timeOf(date));
  return { magnitude: info.mag, phaseAngle: info.phase_angle, phaseFraction: info.phase_fraction,
    helioDistanceAu: info.helio_dist, geoDistanceAu: info.geo_dist,
    source: LIBRARY.name + ' Illumination model value (not a measurement)' };
}

function elongation(name, date) {
  const event = AE.Elongation(requireBody(name), timeOf(date));
  return { time: event.time.date.getTime(), elongationDeg: event.elongation,
    visibility: event.visibility, eclipticLatitudeDeg: event.ecliptic_lat,
    helioDistanceAu: event.helio_dist, geoDistanceAu: event.geo_dist };
}

const sunAngle = (name, date) => AE.AngleFromSun(requireBody(name), timeOf(date));
const pairLongitude = (a, b, date) => AE.PairLongitude(requireBody(a), requireBody(b), timeOf(date));

function moonInfo(date, site) {
  const t = timeOf(date), info = AE.Illumination('Moon', t);
  const out = { t: t.date.getTime(), phaseAngle: info.phase_angle, phaseFraction: info.phase_fraction,
    magnitude: info.mag, helioDistanceAu: info.helio_dist, geoDistanceAu: info.geo_dist };
  if (site) Object.assign(out, horizontal('Moon', date, site, { refraction: 'normal' }));
  return out;
}
// Fraction of the Moon's disc lit. 0 = new, 1 = full.
const moonIllumination = date => AE.Illumination('Moon', timeOf(date)).phase_fraction;
// Apparent geocentric ecliptic longitude of the Sun (lambda-sun), the quantity meteor-shower
// calendars use to fix a peak. Astronomy Engine's EclipticLongitude is heliocentric and therefore
// undefined for the Sun, so the geocentric ecliptic coordinates of the Sun's apparent vector are used.
const sunLongitude = date => AE.Ecliptic(AE.GeoVector('Sun', timeOf(date), true)).elon;
// Inverse of sunLongitude: when the Sun's apparent ecliptic longitude next reaches `degrees`.
// Implemented here rather than via Astronomy Engine's SearchSunLongitude because that search returns
// null for part of the year (verified for ecliptic longitudes near 107-119 degrees, where the Sun's
// apparent motion is slowest); this scan bisects on the wrapped residual and always converges.
function searchSunLongitude(degrees, startDate, limitDays) {
  const target = ((degrees % 360) + 360) % 360;
  const start = timeOf(startDate).date.getTime();
  const limit = (limitDays || 400) * DAY;
  const residual = ms => {
    const value = AE.Ecliptic(AE.GeoVector('Sun', timeOf(ms), true)).elon;
    return ((value - target + 540) % 360) - 180;
  };
  let previous = start, previousResidual = residual(start);
  if (previousResidual === 0) return start;
  for (let t = start + DAY; t <= start + limit + DAY; t += DAY) {
    const current = residual(t);
    if (previousResidual < 0 && current >= 0) {
      let a = previous, b = t;
      while (b - a > 1000) {
        const middle = Math.round((a + b) / 2);
        if (residual(middle) < 0) a = middle; else b = middle;
      }
      return b;
    }
    previous = t;
    previousResidual = current;
  }
  throw new Error('the Sun does not reach ecliptic longitude ' + target + ' within ' + limitDays + ' days');
}


/* ---- altitude/azimuth windows, rise/set and local conditions ------------ */

// Sampled altitude/azimuth track for any body. Used for sky charts and event windows.
function altitudePath(name, site, rawStart, rawEnd, stepMinutes) {
  const start = toMs(rawStart), end = toMs(rawEnd);
  const step = (stepMinutes || 10) * MINUTE, out = [];
  for (let t = start; ; t = Math.min(t + step, end)) {
    const h = horizontal(name, t, site);
    out.push({ t, altitude: h.altitude, azimuth: h.azimuth });
    if (t >= end) break;
  }
  return out;
}
function refineAltitudeCrossing(name, site, low, high, minimum) {
  let a = low, b = high;
  const aboveA = horizontal(name, a, site, { refraction: 'none' }).altitude >= minimum;
  while (b - a > 10000) {
    const m = (a + b) / 2;
    if ((horizontal(name, m, site, { refraction: 'none' }).altitude >= minimum) === aboveA) a = m; else b = m;
  }
  return aboveA ? a : b;
}
// Intervals inside [start,end] where the body is at or above `minimum` degrees altitude.
function aboveIntervals(name, site, rawStart, rawEnd, minimum, options) {
  const start = toMs(rawStart), end = toMs(rawEnd);
  const step = ((options && options.stepMinutes) || 5) * MINUTE;
  const out = [];
  let open = null, previous = null;
  for (let t = start; ; t = Math.min(t + step, end)) {
    const altitude = horizontal(name, t, site, { refraction: 'none' }).altitude;
    const above = altitude >= minimum;
    if (above && open === null) open = previous && !previous.above ? refineAltitudeCrossing(name, site, previous.t, t, minimum) : start;
    else if (!above && open !== null) {
      out.push([open, refineAltitudeCrossing(name, site, Math.max(start, t - step), t, minimum)]);
      open = null;
    }
    previous = { t, above };
    if (t >= end) break;
  }
  if (open !== null) out.push([open, end]);
  return out.filter(([a, b]) => b - a >= 60000);
}
// Highest point of an altitude track inside one interval (altitude is unimodal across a single
// above-horizon interval, so ternary search converges to the sampling tolerance).
function refinePeak(name, site, start, end) {
  let a = start, b = end;
  const at = t => horizontal(name, t, site, { refraction: 'none' }).altitude;
  while (b - a > 5000) {
    const x = a + (b - a) / 3, y = b - (b - a) / 3;
    if (at(x) < at(y)) a = x; else b = y;
  }
  return horizontal(name, (a + b) / 2, site);
}
// The practical local opportunity for one body on one night: the longest stretch in the darkest
// usable twilight in which the body is above the minimum altitude, with the peak of that stretch.
// Astronomical darkness is preferred; nautical or civil twilight is only used when the caller asks
// for it (`allowTwilight`, correct for Mercury and Venus, which are typically only seen in twilight),
// and the level actually used is always reported so the UI can label a twilight-only sighting.
function bestWindow(name, site, night, options) {
  const minimum = (options && options.minAltitude) || RULES.minAltitudeObservable;
  const allowTwilight = !!(options && options.allowTwilight);
  const dark = darkness(site, night.start, night.end, options);
  const base = { name, minimum, darkness: { achieved: dark.achieved, best: dark.best, limited: dark.limited } };
  const tried = [];
  for (const level of ['astronomical', 'nautical', 'civil']) {
    const intervals = (dark.intervals[level] || []).slice().sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
    if (!intervals.length) continue;
    if (level !== 'astronomical' && !allowTwilight) { tried.push(level + ': available but twilight visibility was not requested'); continue; }
    for (const [from, to] of intervals) {
      const above = aboveIntervals(name, site, from, to, minimum, options);
      if (!above.length) { tried.push(level + ': below ' + minimum + '\u00b0'); continue; }
      const best = above.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
      const peak = refinePeak(name, site, best[0], best[1]);
      const entry = horizontal(name, best[0], site), exit = horizontal(name, best[1], site);
      return { ok: true, ...base, darknessUsed: level, twilight: level !== 'astronomical',
        start: best[0], end: best[1], durationMin: (best[1] - best[0]) / 60000,
        peak: { t: peak.t, altitude: peak.altitude, azimuth: peak.azimuth, compass: compass(peak.azimuth) },
        entry: { t: best[0], altitude: entry.altitude, azimuth: entry.azimuth, compass: compass(entry.azimuth) },
        exit: { t: best[1], altitude: exit.altitude, azimuth: exit.azimuth, compass: compass(exit.azimuth) },
        sector: compass(entry.azimuth) === compass(exit.azimuth) ? compass(entry.azimuth)
          : compass(entry.azimuth) + ' to ' + compass(exit.azimuth),
        intervals: above.map(([a, b]) => ({ start: a, end: b })), tried };
    }
  }
  const widest = dark.intervals.astronomical[0] || dark.intervals.nautical[0] || dark.intervals.civil[0];
  let peak = null;
  if (widest) {
    const track = altitudePath(name, site, widest[0], widest[1], 10);
    const top = track.reduce((a, b) => (b.altitude > a.altitude ? b : a));
    peak = { t: top.t, altitude: top.altitude, azimuth: top.azimuth, compass: compass(top.azimuth) };
  }
  return { ok: false, ...base, peak, intervals: [], tried,
    reason: dark.best ? 'stays below ' + minimum + '\u00b0 during the dark hours' : 'no twilight dark enough to observe on this night at this location' };
}
// Rise/set via the library's own search, which already handles the Moon's parallax and the Sun's
// standard -0.833 degree horizon dip. `groundHeight` is the observer's eye height in metres.
function riseSet(name, site, startDate, limitDays, direction) {
  requireBody(name);
  const found = AE.SearchRiseSet(name, observer(site), direction, timeOf(startDate), limitDays || 2,
    Number.isFinite(site.groundHeight) ? site.groundHeight : 0);
  return found ? found.date.getTime() : null;   // null is normal inside the polar circles
}
const rise = (name, site, from, days) => riseSet(name, site, from, days, 1);
const set = (name, site, from, days) => riseSet(name, site, from, days, -1);
function transit(name, site, from) {
  const event = AE.SearchHourAngle(requireBody(name), observer(site), 0, timeOf(from), 1);
  return { t: event.time.date.getTime(), altitude: event.hor.altitude, azimuth: event.hor.azimuth,
    compass: compass(event.hor.azimuth) };
}
// Sunset and the following sunrise around a local-noon instant, from the library's rise/set search.
function sunsetSunrise(site, fromDate) {
  const s = AE.SearchRiseSet('Sun', observer(site), -1, timeOf(fromDate), 2, 0);
  if (!s) return { sunset: null, sunrise: null };
  const r = AE.SearchRiseSet('Sun', observer(site), 1, s, 2, 0);
  return { sunset: s.date.getTime(), sunrise: r ? r.date.getTime() : null };
}
// Moonlight interference. This is an observing-suitability heuristic, not astronomy: it encodes that
// a bright Moon close to a target brightens the sky background, and it hits faint diffuse objects
// harder than bright point sources.
function moonInterference(moon, target, options) {
  const R = RULES.moonInterference;
  const illumination = Number.isFinite(moon.phaseFraction) ? moon.phaseFraction : 0;
  const out = { illumination, level: 'none', reason: null };
  if (Number.isFinite(moon.altitude) && Number.isFinite(target.altitude)) {
    out.separationDeg = horizonSeparation(moon.altitude, moon.azimuth, target.altitude, target.azimuth);
  }
  if (illumination < R.faintFraction) { out.reason = 'thin crescent Moon'; return out; }
  if (Number.isFinite(moon.altitude) && moon.altitude < R.minMoonAltitude) { out.reason = 'Moon is low or below the horizon'; return out; }
  if (Number.isFinite(out.separationDeg) && out.separationDeg > R.nearDeg) { out.reason = 'Moon is far from this part of the sky'; return out; }
  const faint = !!(options && options.faint);
  if (illumination >= R.brightFraction && (out.separationDeg || 0) <= R.closeDeg) out.level = 'washed-out';
  else if (faint) out.level = 'washed-out';
  else out.level = 'glare';
  out.reason = out.level === 'washed-out'
    ? 'a Moon ' + Math.round(illumination * 100) + '% lit within ' + Math.round(out.separationDeg || 0) + '\u00b0 brightens the sky background'
    : 'moonlight adds glare, but this target is bright enough to survive it';
  return out;
}

/* ---- event searches ----------------------------------------------------- */

const geocentricPair = (a, b, t) => {
  const ea = geometricEquatorial(a, t), eb = geometricEquatorial(b, t);
  return { separationDeg: separation(ea.raDeg, ea.decDeg, eb.raDeg, eb.decDeg), a: ea, b: eb };
};
// Local minima of the apparent geocentric separation of two bodies inside [start,end]. Coarse scan
// then ternary refinement: separation is unimodal around a conjunction, so this converges on the real
// minimum instead of reporting the closest grid sample.
function minimumSeparations(a, b, start, end, options) {
  const step = ((options && options.stepHours) || 6) * HOUR;
  const samples = [];
  for (let t = start; t <= end; t += step) samples.push({ t, ...geocentricPair(a, b, t) });
  const found = [];
  // Interior local minima only: a minimum at the very edge of the search interval is an artifact of
  // the window, not a conjunction, and reporting it would invent an event.
  for (let i = 1; i < samples.length - 1; i++) {
    const previous = samples[i - 1], current = samples[i], next = samples[i + 1];
    if (current.separationDeg <= previous.separationDeg && current.separationDeg <= next.separationDeg) {
      found.push({ lo: previous.t, hi: next.t });
    }
  }
  return found.map(({ lo, hi }) => {
    let x = lo, y = hi;
    while (y - x > 20000) {
      const p = x + (y - x) / 3, q = y - (y - x) / 3;
      if (geocentricPair(a, b, p).separationDeg < geocentricPair(a, b, q).separationDeg) y = q; else x = p;
    }
    const t = Math.round((x + y) / 2), pair = geocentricPair(a, b, t);
    return { t, separationDeg: pair.separationDeg, a: pair.a, b: pair.b,
      frame: 'geocentric apparent separation (the astronomical event), degrees' };
  }).sort((p, q) => p.t - q.t);
}
// Call a "next event" search repeatedly to list every occurrence inside a planning horizon.
function series(next, start, end, limit) {
  const out = [];
  let cursor = start;
  for (let i = 0; i < (limit || 12); i++) {
    let t;
    try { t = next(cursor); } catch { break; }
    if (!Number.isFinite(t) || t > end) break;
    out.push(t);
    cursor = t + 6 * HOUR;
  }
  return out;
}
// Heliocentric relative longitude 0 = opposition of a superior planet (and inferior conjunction of
// Mercury or Venus); 180 = conjunction of a superior planet (and superior conjunction of Mercury or
// Venus). This is the library's documented relation, not a re-derivation of it.
const relativeLongitudeEvents = (body, target, start, end) =>
  series(from => AE.SearchRelativeLongitude(requireBody(body), target, timeOf(from)).date.getTime(), start, end, 8);
const oppositions = (body, start, end) => relativeLongitudeEvents(body, 0, start, end);
const conjunctionsWithSun = (body, start, end) => relativeLongitudeEvents(body, 180, start, end);
const inferiorConjunctions = (body, start, end) => relativeLongitudeEvents(body, 0, start, end);
const greatestElongations = (body, start, end) =>
  series(from => AE.SearchMaxElongation(requireBody(body), timeOf(from)).time.date.getTime(), start, end, 10)
    .map(t => ({ t, ...elongation(body, t) }));


/* ---- eclipses ----------------------------------------------------------- */

function normalizeLunarEclipse(info, site) {
  const peak = info.peak.date.getTime(), minute = 60000;
  const local = horizontal('Moon', peak, site);
  // Semi-durations are minutes before/after the peak, so phase times are peak +/- the semi-duration;
  // a zero semi-duration means that phase does not occur at all and is reported as null.
  const phaseAt = offsetMin => {
    if (!Number.isFinite(offsetMin) || offsetMin === 0) return null;
    const t = Math.round(peak + offsetMin * minute), h = horizontal('Moon', t, site);
    return { t, altitude: h.altitude, azimuth: h.azimuth, compass: compass(h.azimuth) };
  };
  return { kind: info.kind, obscuration: info.obscuration,
    peak: { t: peak, altitude: local.altitude, azimuth: local.azimuth, compass: compass(local.azimuth) },
    phases: { penumbral_begin: phaseAt(-info.sd_penum), partial_begin: phaseAt(-info.sd_partial),
      total_begin: phaseAt(-info.sd_total), total_end: phaseAt(info.sd_total),
      partial_end: phaseAt(info.sd_partial), penumbral_end: phaseAt(info.sd_penum) },
    semiDurationsMin: { penumbral: info.sd_penum, partial: info.sd_partial, total: info.sd_total },
    localVisible: local.altitude > 0,
    provenance: { library: LIBRARY.name + ' ' + LIBRARY.version, method: 'SearchLunarEclipse + local Moon altitude' } };
}
// Lunar eclipses in a window. The Moon's altitude at every phase decides whether the eclipse is
// actually observable from this site, so it is always reported; the event is never called visible
// just because it happens somewhere on Earth.
function lunarEclipses(site, start, end, limit) {
  const out = [];
  let cursor = start;
  for (let i = 0; i < (limit || 6); i++) {
    const info = AE.SearchLunarEclipse(timeOf(cursor));
    const peakMs = info.peak.date.getTime();
    if (peakMs > end) break;
    out.push(normalizeLunarEclipse(info, site));
    cursor = peakMs + DAY;
  }
  return out;
}
function normalizeSolarEclipse(info, site) {
  const phase = event => {
    if (!event) return null;
    const t = event.time.date.getTime(), h = horizontal('Sun', t, site);
    return { t, altitude: Number.isFinite(event.altitude) ? event.altitude : h.altitude,
      azimuth: Number.isFinite(event.azimuth) ? event.azimuth : h.azimuth, compass: compass(h.azimuth) };
  };
  return { kind: info.kind, obscuration: info.obscuration,
    phases: { partial_begin: phase(info.partial_begin), total_begin: phase(info.total_begin),
      peak: phase(info.peak), total_end: phase(info.total_end), partial_end: phase(info.partial_end) },
    localVisible: true,
    provenance: { library: LIBRARY.name + ' ' + LIBRARY.version, method: 'SearchLocalSolarEclipse for this observer' } };
}
// Solar eclipses with local circumstances. SearchLocalSolarEclipse only returns eclipses that are at
// least partly visible from the given site, so every returned event is locally visible by
// construction; the maximum obscuration and the Sun's altitude are reported so the claim is checkable.
function localSolarEclipses(site, start, end, limit) {
  const out = [];
  let cursor = start;
  for (let i = 0; i < (limit || 4); i++) {
    const info = AE.SearchLocalSolarEclipse(timeOf(cursor), observer(site));
    const peakMs = info.peak.time.date.getTime();
    if (peakMs > end) break;
    out.push(normalizeSolarEclipse(info, site));
    cursor = peakMs + 2 * DAY;
  }
  return out;
}

// Horizontal coordinates of a FIXED J2000 catalogue position (meteor radiant, star). The J2000 vector
// is rotated into the observer's horizontal frame, so precession and nutation to the date of the
// observation are included; this is the correct path for catalogue coordinates and is deliberately
// separate from horizontal(), which takes a solar-system body and returns of-date coordinates.
function horizontalFromJ2000(raDeg, decDeg, date, site, options) {
  const t = timeOf(date);
  // Spherical takes degrees (its latitude/longitude properties are documented in degrees), and
  // HorizonFromVector returns a Spherical whose latitude is altitude and longitude is azimuth.
  const vector = AE.VectorFromSphere(new AE.Spherical(decDeg, raDeg, 1), t);
  const horizontalVector = AE.RotateVector(AE.Rotation_EQJ_HOR(t, observer(site)), vector);
  const mode = options && options.refraction === 'none' ? null : 'normal';
  const coords = AE.HorizonFromVector(horizontalVector, mode);
  return { t: t.date.getTime(), altitude: coords.lat, azimuth: coords.lon,
    refractionApplied: mode !== null, frame: 'J2000 catalogue position rotated into the horizontal frame' };
}
// Sampled track of a fixed catalogue position, for radiants and anything else pinned to the sky.
function trackFromJ2000(raDeg, decDeg, site, rawStart, rawEnd, stepMinutes) {
  const start = toMs(rawStart), end = toMs(rawEnd);
  const step = (stepMinutes || 10) * MINUTE, out = [];
  for (let t = start; ; t = Math.min(t + step, end)) {
    out.push({ ...horizontalFromJ2000(raDeg, decDeg, t, site) });
    if (t >= end) break;
  }
  return out;
}

// Rotate a heliocentric ECLIPTIC J2000 position (AU) into the J2000 equatorial frame, which is the
// frame solar-system orbital elements are expressed in. Used by the comet propagator.
function eclipticToEquatorial(x, y, z, date) {
  const t = timeOf(date);
  const matrix = AE.InverseRotation(AE.Rotation_EQJ_ECL());
  return AE.RotateVector(matrix, new AE.Vector(x, y, z, t));
}
// Geocentric astrometric J2000 RA/Dec of an object whose heliocentric ecliptic position is supplied by
// a callback, evaluating the callback at successively earlier emission epochs until the light-time
// correction converges (three iterations is far below the position uncertainty of any comet).
function geocentricFromHeliocentric(positionAt, date, site) {
  const t = timeOf(date);
  const earth = AE.HelioVector('Earth', t);
  const earthVector = site ? (() => {
    const offset = AE.ObserverVector(t, observer(site), false);
    return new AE.Vector(earth.x + offset.x, earth.y + offset.y, earth.z + offset.z, t);
  })() : earth;
  const daysPerAu = 0.005775518331;   // light travel time for one astronomical unit
  let lightDays = 0, result = null;
  for (let i = 0; i < 3; i++) {
    const heliocentric = positionAt(jdTT(date) - lightDays);
    const equatorial = eclipticToEquatorial(heliocentric.x, heliocentric.y, heliocentric.z, date);
    const vector = new AE.Vector(equatorial.x - earthVector.x, equatorial.y - earthVector.y,
      equatorial.z - earthVector.z, t);
    const eq = AE.EquatorFromVector(vector);
    result = { raDeg: ((eq.ra * 15) % 360 + 360) % 360, decDeg: eq.dec,
      distanceAu: Math.hypot(vector.x, vector.y, vector.z),
      helioDistanceAu: Math.hypot(heliocentric.x, heliocentric.y, heliocentric.z),
      lightTimeDays: lightDays, topocentric: !!site };
    lightDays = result.distanceAu * daysPerAu;
  }
  return result;
}

// Great-circle midpoint of two directions, in degrees. Used to measure how far a sample sits from the
// straight (great-circle) chord between its neighbours without falling into the right-ascension
// wraparound at 0/360 degrees.
function midpointDirection(ra1, dec1, ra2, dec2) {
  const a = unitVector(ra1, dec1), b = unitVector(ra2, dec2);
  const sum = new AE.Vector(a.x + b.x, a.y + b.y, a.z + b.z);
  const radius = Math.hypot(sum.x, sum.y, sum.z);
  if (!(radius > 1e-12)) return { raDeg: ra1, decDeg: dec1, antipodal: true };
  return { raDeg: ((Math.atan2(sum.y, sum.x) * R2D) % 360 + 360) % 360, decDeg: Math.asin(sum.z / radius) * R2D };
}

/* ---- exports ------------------------------------------------------------ */

root.OverheadAstro = { LIBRARY, RULES, AE, PLANETS, NAKED_EYE_PLANETS, TELESCOPIC_PLANETS, ALL_BODIES,
  isNakedEyePlanet, compass, separation, horizonSeparation, midpointDirection, horizontalFromJ2000, trackFromJ2000,
  eclipticToEquatorial, geocentricFromHeliocentric, jdTT, observer,
  geometricEquatorial, horizontal, magnitude, elongation, sunAngle, pairLongitude,
  moonInfo, moonIllumination, sunLongitude, searchSunLongitude, sunAltitude,
  darkness, altitudePath, aboveIntervals, bestWindow, rise, set, transit, sunsetSunrise, moonInterference,
  minimumSeparations, series, oppositions, conjunctionsWithSun, inferiorConjunctions, greatestElongations,
  lunarEclipses, localSolarEclipses, normalizeLunarEclipse, normalizeSolarEclipse };
if (typeof module !== 'undefined') module.exports = root.OverheadAstro;
})(typeof self !== 'undefined' ? self : globalThis);
