/* Overhead meteor showers: the published IMO calendar plus locally calculated radiant geometry,
   darkness and moonlight. Pure computation; the dataset is supplied by the caller so this module
   never fetches anything and never invents a shower, a peak date or a rate.
   ZHR is surfaced only as the standardized reference value the IMO publishes, never as a prediction
   of how many meteors one observer will see from one location. */
(function (root) {
'use strict';
const A = root.OverheadAstro;
if (!A) throw new Error('overhead-meteors.js requires overhead-astro.js');
const DAY = 86400000, HOUR = 3600000, MINUTE = 60000;
const REQUIREMENT = 'junkdrawer.overhead.meteors/1';
const LIBRARY = 'overhead-meteors.js @ Astronomy Engine ' + A.LIBRARY.version;
// Extrapolating a published radiant drift further than this produces positions nobody published, so
// the drift correction is clamped to a fortnight either side of the peak.
const DRIFT_LIMIT_DAYS = 15;
// Qualitative bands derived from the published ZHR. They describe the published number, not a forecast.
const ZHR_BANDS = Object.freeze([[60, 'strong'], [20, 'moderate'], [1, 'minor']]);
const bandFor = zhr => (Number.isFinite(zhr) ? (ZHR_BANDS.find(([threshold]) => zhr >= threshold) || [0, 'minor'])[1] : 'unpublished');
const round = (value, digits) => (Number.isFinite(value) ? Math.round(value * Math.pow(10, digits)) / Math.pow(10, digits) : null);

/* ---- dataset validation and freshness ---------------------------------- */

// Validate the published artifact. A dataset that fails here must be surfaced as unavailable: a
// meteor shower calendar is the one thing this app cannot recompute from first principles.
function validate(dataset, now) {
  const errors = [], warnings = [];
  if (!dataset || typeof dataset !== 'object') return { ok: false, errors: ['no meteor dataset was supplied'], warnings, showers: [], coversNow: false };
  if (dataset.schema !== REQUIREMENT) errors.push('unexpected schema ' + dataset.schema);
  if (!Number.isFinite(dataset.calendar_year)) errors.push('missing calendar year');
  if (!dataset.source || !dataset.source.name || !dataset.source.retrieved_at) errors.push('missing source provenance');
  if (!dataset.coverage || !dataset.coverage.start || !dataset.coverage.end) errors.push('missing coverage window');
  const showers = Array.isArray(dataset.showers) ? dataset.showers : [];
  if (showers.length < 10) errors.push('only ' + showers.length + ' showers in the dataset');
  for (const shower of showers) {
    if (!shower.id || !shower.iau_code) errors.push('shower without an IAU code');
    if (!Number.isFinite(shower.peak && shower.peak.solar_longitude_deg)) errors.push('shower ' + shower.id + ' without a peak solar longitude');
    if (!(shower.radiant && Number.isFinite(shower.radiant.ra_deg) && Number.isFinite(shower.radiant.dec_deg))) errors.push('shower ' + shower.id + ' without a radiant');
    else if (shower.radiant.ra_deg >= 360 || Math.abs(shower.radiant.dec_deg) > 90) errors.push('shower ' + shower.id + ' has a radiant outside the sky');
    if (!shower.activity || !/^\d\d-\d\d$/.test(shower.activity.start_md) || !/^\d\d-\d\d$/.test(shower.activity.end_md)) errors.push('shower ' + shower.id + ' has an unusable activity window');
    if (shower.zhr !== null && !(shower.zhr > 0 && shower.zhr <= 500)) errors.push('shower ' + shower.id + ' has an implausible ZHR');
    if (shower.zhr === null && !shower.zhr_note) errors.push('shower ' + shower.id + ' has no ZHR and no explanation');
  }
  const generated = Date.parse(dataset.generated_at || '');
  const ageDays = Number.isFinite(generated) ? (now - generated) / DAY : null;
  if (ageDays !== null && ageDays > 400) warnings.push('the dataset is ' + Math.round(ageDays) + ' days old');
  const year = new Date(now).getUTCFullYear();
  const expired = Number.isFinite(dataset.calendar_year) && year > dataset.calendar_year
    && now > Date.parse(dataset.coverage.end) + 14 * DAY;
  return { ok: errors.length === 0, errors, warnings, showers,
    calendarYear: dataset.calendar_year || null, coverage: dataset.coverage || null,
    ageDays: ageDays === null ? null : round(ageDays, 1), coversNow: !expired,
    expiredReason: expired ? 'the published calendar covers ' + dataset.calendar_year + ' and this date is outside it; refresh the dataset before trusting any peak' : null,
    source: dataset.source || null, crossCheck: dataset.cross_check || null, notes: dataset.notes || [] };
}

/* ---- activity, peaks and radiant geometry ------------------------------ */

const monthDay = (md, year) => {
  const [month, day] = md.split('-').map(Number);
  return { month, day, year, iso: year + '-' + md };
};
// Day of year for a month-day string in a given year (1 = January 1).
const dayOfYear = (md, year) => Math.round((Date.parse(year + '-' + md + 'T00:00:00Z') - Date.UTC(year, 0, 1)) / DAY) + 1;
// Activity window as day-of-year numbers so year wrap (Quadrantids, Comae Berenicids) is explicit.
function activityWindow(shower, year) {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const startDay = dayOfYear(shower.activity.start_md, year);
  const endDay = dayOfYear(shower.activity.end_md, year);
  const wraps = endDay < startDay;
  return { startDay, endDay, wraps, length: wraps ? (leap ? 366 : 365) - startDay + endDay : endDay - startDay,
    start: monthDay(shower.activity.start_md, year).iso, end: monthDay(shower.activity.end_md, year).iso };
}
// Is the shower active on the local day whose date is dayIso?
function activeOn(shower, dayIso) {
  const year = Number(dayIso.slice(0, 4));
  const span = activityWindow(shower, year);
  const day = dayOfYear(dayIso.slice(5), year);
  return span.wraps ? (day >= span.startDay || day <= span.endDay) : (day >= span.startDay && day <= span.endDay);
}
// The peak instant for a given year, computed from the published solar longitude rather than copied
// from a calendar date, so it stays correct in every year and every time zone.
function peakTime(shower, year) {
  const longitude = ((shower.peak.solar_longitude_deg % 360) + 360) % 360;
  return A.searchSunLongitude(longitude, Date.parse(year + '-01-01T00:00:00Z'), 400);
}
// Radiant position, optionally corrected for the shower's published radiant drift. The drift is a
// linear extrapolation from the peak, clamped to a fortnight, and the correction is reported so the
// caller can see it rather than trusting a silently moved radiant.
function radiantAt(shower, t) {
  const base = { raDeg: shower.radiant.ra_deg, decDeg: shower.radiant.dec_deg, frame: shower.radiant.frame || 'J2000' };
  const driftRa = shower.radiant.drift_ra_deg_per_day, driftDec = shower.radiant.drift_dec_deg_per_day;
  if (!Number.isFinite(driftRa) || !Number.isFinite(driftDec)) {
    return { ...base, driftApplied: false, driftDays: 0, driftSource: null };
  }
  const peak = peakTime(shower, new Date(t).getUTCFullYear());
  const days = Math.max(-DRIFT_LIMIT_DAYS, Math.min(DRIFT_LIMIT_DAYS, (t - peak) / DAY));
  return { raDeg: ((base.raDeg + driftRa * days) % 360 + 360) % 360,
    decDeg: Math.max(-90, Math.min(90, base.decDeg + driftDec * days)), frame: base.frame,
    driftApplied: true, driftDays: round(days, 1),
    driftSource: shower.radiant.drift_source || 'published radiant drift',
    note: 'drift extrapolated no further than ' + DRIFT_LIMIT_DAYS + ' days from the peak' };
}

/* ---- one shower on one night ------------------------------------------- */

const PHASE = { peakNight: 'peak night', nearPeak: 'near its peak', building: 'building towards its peak', past: 'past its peak' };
// Evaluate a shower for one local night. Geometry (radiant altitude, darkness, moonlight) is exact to
// the published radiant; the shower's activity level is statistical and is described in words, never
// converted into a personal meteor count.
function evaluate(shower, site, night, context) {
  const validation = context && context.validation;
  const year = Number((night.day || new Date(night.start).toISOString().slice(0, 10)).slice(0, 4));
  const middle = Math.round((night.start + night.end) / 2);
  const peak = peakTime(shower, year);
  const daysFromPeak = (middle - peak) / DAY;
  const peakFallsInNight = peak >= night.start && peak <= night.end;
  const phase = peakFallsInNight ? 'peakNight' : Math.abs(daysFromPeak) <= 2 ? 'nearPeak'
    : daysFromPeak < 0 ? 'building' : 'past';
  const radiant = radiantAt(shower, middle);
  const dark = A.darkness(site, night.start, night.end);
  const span = dark.intervals.astronomical[0] || dark.intervals.nautical[0] || dark.intervals.civil[0];
  const track = A.trackFromJ2000(radiant.raDeg, radiant.decDeg, site, night.start, night.end, 10);
  const highest = track.reduce((a, b) => (b.altitude > a.altitude ? b : a));
  const minimumAltitude = (context && context.minAltitude) || 20;
  const above = track.filter(p => p.altitude >= minimumAltitude);
  const usable = span ? above.filter(p => p.t >= span[0] && p.t <= span[1]) : [];
  const start = usable.length ? usable[0].t : null;
  const end = usable.length ? usable[usable.length - 1].t : null;
  const best = usable.length ? usable.reduce((a, b) => (b.altitude > a.altitude ? b : a)) : null;
  const moon = A.moonInfo(best ? best.t : middle, site);
  const interference = A.moonInterference(moon, { altitude: best ? best.altitude : highest.altitude,
    azimuth: best ? best.azimuth : highest.azimuth }, { faint: true });
  const observable = !!(start && end);
  const caveats = [];
  const limiting = [];
  if (!span) { caveats.push('no twilight bright enough for the sky to be dark at this location on this date'); limiting.push('no darkness'); }
  else {
    if (dark.achieved !== 'astronomical') limiting.push(dark.achieved + ' twilight only');
    if (!observable) { caveats.push('the radiant never rises ' + minimumAltitude + '\u00b0 above the horizon during the dark hours'); limiting.push('radiant too low'); }
  }
  if (interference.level === 'washed-out') { caveats.push('moonlight interference: ' + interference.reason); limiting.push('moonlight'); }
  else if (interference.level === 'glare') limiting.push('moonlight glare');
  if (radiant.driftApplied) caveats.push('radiant position includes the published drift moved ' + radiant.driftDays + ' days from the peak');
  if (!Number.isFinite(shower.zhr)) caveats.push('the IMO publishes no single ZHR for this shower' + (shower.zhr_note ? ' (' + shower.zhr_note + ')' : ''));
  return { kind: 'meteor-shower', objects: [shower.name], showerId: shower.id, iauCode: shower.iau_code,
    site, night: night.day || null,
    t: { start: observable ? start : Math.round(middle), end: observable ? end : Math.round(middle), best: best ? best.t : Math.round(middle), peak },
    observable,
    positions: [{ name: 'Radiant (' + shower.name + ')', t: best ? best.t : middle,
      raDeg: round(radiant.raDeg, 3), decDeg: round(radiant.decDeg, 3), frame: radiant.frame,
      altitude: round(best ? best.altitude : highest.altitude, 2),
      azimuth: round(best ? best.azimuth : highest.azimuth, 1),
      compass: A.compass(best ? best.azimuth : highest.azimuth), optical: 'naked-eye' }],
    optical: 'naked-eye',
    data: { zhr: Number.isFinite(shower.zhr) ? shower.zhr : null,
      zhrBand: bandFor(shower.zhr), zhrNote: shower.zhr_note || null,
      zhrMeaning: 'the IMO ZHR is the rate an ideal observer would see with the radiant overhead under a perfect dark sky averaged over the shower’s population; it is not a prediction for one observer',
      populationIndex: shower.population_index, velocityKmS: shower.velocity_km_s,
      expectedMeteorsPerHour: null,
      rateNote: 'no local meteor-per-hour number is shown: shower rates vary by an order of magnitude between nights and no validated model for a single observer at a single site is being used',
      phase: PHASE[phase], phaseDays: round(daysFromPeak, 2), peakInstant: new Date(peak).toISOString(),
      peakFallsInNight, activityWindow: activityWindow(shower, year),
      radiant: { raDeg: round(radiant.raDeg, 3), decDeg: round(radiant.decDeg, 3), driftApplied: !!radiant.driftApplied, driftDays: radiant.driftDays || 0 },
      radiantAltitudeAtBest: best ? round(best.altitude, 2) : null,
      radiantPeakAltitude: round(highest.altitude, 2), minimumRadiantAltitude: minimumAltitude,
      darknessAchieved: dark.achieved, darknessLimited: dark.limited,
      moon: { illumination: round(moon.phaseFraction, 3), altitude: round(moon.altitude, 1), azimuth: round(moon.azimuth, 1), interference: interference.level },
      limitingFactors: limiting },
    caveats,
    provenance: { library: LIBRARY, method: 'published radiant rotated to the observer frame, sampled through the local night; peak from published solar longitude',
      dataset: validation && validation.source ? { name: validation.source.name, url: validation.source.original_url, retrieved: validation.source.retrieved_at } : null } };
}

/* ---- the plan ---------------------------------------------------------- */

// Opportunities for every shower that is active during the supplied local nights. A shower is only
// evaluated on nights inside its published activity window, and the dataset's own coverage is
// enforced: an expired calendar produces a refusal instead of last year's peaks.
function plan(dataset, options) {
  const now = (options && options.now) || Date.now();
  const site = options && options.site;
  const windows = (options && options.windows) || [];
  if (!site) throw new Error('meteor plan requires an observing site');
  const validation = validate(dataset, now);
  const result = { validation, calendarYear: validation.calendarYear, showers: [], skipped: [], activeOnAnyNight: [] };
  if (!validation.ok) return result;
  if (!validation.coversNow) {
    result.skipped.push({ reason: validation.expiredReason });
    return result;
  }
  const activeIds = new Set();
  for (const night of windows) {
    const day = night.day || new Date(night.start).toISOString().slice(0, 10);
    for (const shower of validation.showers) {
      if (!activeOn(shower, day)) continue;
      activeIds.add(shower.id);
      result.showers.push(evaluate(shower, site, night, { minAltitude: options && options.minAltitude, now, validation }));
    }
  }
  result.activeOnAnyNight = [...activeIds];
  return result;
}

root.OverheadMeteors = { REQUIREMENT, DRIFT_LIMIT_DAYS, ZHR_BANDS, bandFor, PHASE, validate, activityWindow,
  activeOn, peakTime, radiantAt, evaluate, plan };
if (typeof module !== 'undefined') module.exports = root.OverheadMeteors;
})(typeof self !== 'undefined' ? self : globalThis);
