/* Celestial plan assembly: turns the category engines into the unified opportunity model and the three
   planning horizons. Shared by the web worker (overhead-celestial-worker.js) and by the page's own
   synchronous fallback, so both paths compute exactly the same answer. */
(function (root) {
'use strict';
const PLAN_CATEGORIES = ['planets', 'meteors', 'comets'];
// Eclipses are calculated by the planetary engine (they are solar-system geometry) but belong to the
// "Comets & Special Events" category in the interface, so they are mapped rather than duplicated.
const SPECIAL_EVENT_KINDS = ['lunar-eclipse', 'solar-eclipse'];
const round = (value, digits) => (Number.isFinite(value) ? Math.round(value * Math.pow(10, digits)) / Math.pow(10, digits) : null);

// Open-Meteo hourly lookup with the same convention as the satellite side (index = whole hours after
// the first sample, and only used when the requested instant really falls inside that hour). It is
// duplicated here so the worker does not have to load the satellite stack just to read a forecast.
function weatherLookup(weather, time) {
  const hourly = weather && weather.hourly;
  if (!hourly || !hourly.time || !hourly.time.length) return null;
  const index = Math.floor((time / 1000 - hourly.time[0]) / 3600);
  if (index < 0 || index >= hourly.time.length) return null;
  if (Math.abs(hourly.time[index] - time / 1000) > 3600) return null;
  const read = key => (Number.isFinite(hourly[key] && hourly[key][index]) ? hourly[key][index] : null);
  return { cloud_cover: read('cloud_cover'), visibility: read('visibility'), precipitation: read('precipitation'),
    temperature_2m: read('temperature_2m'), weather_code: read('weather_code') };
}

function compute(request) {
  const A = root.OverheadAstro, P = root.OverheadPlanets, M = root.OverheadMeteors,
    C = root.OverheadComets, O = root.OverheadOpportunities;
  if (!A || !P || !M || !O) throw new Error('the celestial calculation libraries did not all load');
  const site = request.site;
  const windows = request.windows || [];
  const now = request.now || Date.now();
  const horizon = request.horizon || 'tonight';
  const category = request.category || 'planets';
  const datasets = request.datasets || {};
  const options = request.options || {};
  const days = horizon === 'extended' ? 90 : horizon === 'week' ? 7 : 1;
  const spanStart = windows.length ? windows[0].start : now;
  const spanEnd = windows.length ? (windows[Math.min(days, windows.length) - 1].end || spanStart + days * 86400000) : now + days * 86400000;
  const searchStart = windows.length ? windows[0].start - 6 * 3600000 : now;
  const searchEnd = windows.length ? windows[Math.min(Math.max(days, 7), windows.length) - 1].end + 86400000 : now + days * 86400000;
  const errors = [];
  const timings = {};
  const candidates = [];
  const started = Date.now();
  const timed = (name, fn) => { const t = Date.now(); const out = fn(); timings[name] = Date.now() - t; return out; };

  // Planets (and eclipses) are always calculated: they need no dataset and are the anchor of the plan.
  let planetEvents = [];
  if (category === 'planets' || category === 'comets') {
    try {
      planetEvents = timed('planets', () => P.events(site, searchStart, searchEnd, {
        windows: windows.slice(0, Math.max(days, 7)),
        stepHours: days > 30 ? 24 : 12, minAltitude: options.minAltitude || A.RULES.minAltitudeObservable }));
    } catch (error) { errors.push('planetary events: ' + (error && error.message || error)); }
  }
  for (const event of planetEvents) {
    if (category === 'comets' && !SPECIAL_EVENT_KINDS.includes(event.kind)) continue;
    candidates.push({ ...event, category: 'planets' });
  }

  // Meteor showers require the published IMO calendar.
  let meteorValidation = null;
  if (category === 'meteors') {
    if (!datasets.meteors) errors.push('the meteor shower calendar could not be loaded, so no shower is shown');
    else {
      try {
        const plan = timed('meteors', () => M.plan(datasets.meteors, { site, windows: windows.slice(0, Math.max(days, 7)), now,
          minAltitude: options.minRadiantAltitude || 20 }));
        meteorValidation = plan.validation;
        for (const shower of plan.showers) candidates.push({ ...shower, category: 'meteors' });
        if (!plan.validation.ok) errors.push('the meteor calendar failed validation: ' + plan.validation.errors.slice(0, 2).join('; '));
        if (!plan.validation.coversNow) errors.push(plan.validation.expiredReason);
        else for (const skipped of plan.skipped) errors.push(skipped.reason);
      } catch (error) { errors.push('meteor showers: ' + (error && error.message || error)); }
    }
  }

  // Comets require both the catalog and the ephemeris artifact.
  let cometValidation = null, ephemerisValidation = null;
  if (category === 'comets') {
    if (!datasets.comets) errors.push('the comet catalog could not be loaded, so no comet is shown');
    else if (!C) errors.push('the comet engine did not load');
    else {
      try {
        const plan = timed('comets', () => C.plan(datasets.comets, datasets.ephemeris, { site, windows: windows.slice(0, Math.max(days, 7)), now, options }));
        cometValidation = plan.validation; ephemerisValidation = plan.ephemerisValidation;
        for (const comet of plan.comets) candidates.push({ ...comet, category: 'comets' });
        if (!plan.validation.ok) errors.push('the comet catalog failed validation: ' + plan.validation.errors.slice(0, 2).join('; '));
        if (plan.ephemerisValidation && !plan.ephemerisValidation.ok) errors.push('the comet ephemeris artifact failed validation: ' + plan.ephemerisValidation.errors.slice(0, 2).join('; '));
        for (const skipped of plan.skipped) errors.push(skipped.comet ? skipped.comet + ': ' + skipped.reason : skipped.reason);
      } catch (error) { errors.push('comets: ' + (error && error.message || error)); }
    }
  }

  const scored = O.withScores(candidates, { site, now, weatherAt: request.weather ? (t => weatherLookup(request.weather, t)) : null });
  const plans = {};
  for (const name of ['tonight', 'week', 'extended']) {
    plans[name] = O.plan(scored.opportunities, { horizon: name, now, windows, maxCards: name === 'extended' ? 60 : 40,
      minimumScore: options.minimumScore });
  }
  return { category, horizon, site, now, span: { start: spanStart, end: spanEnd, days },
    opportunities: scored.opportunities, plans, rejected: scored.rejected, errors,
    validation: { meteors: meteorValidation, comets: cometValidation, ephemeris: ephemerisValidation },
    diagnostics: { timings, candidateCount: candidates.length, durationMs: Date.now() - started },
    noteworthy: C ? C.changes(datasets.comets) : null };
}

root.OverheadCelestialPlan = { PLAN_CATEGORIES, SPECIAL_EVENT_KINDS, weatherLookup, compute };
if (typeof module !== 'undefined') module.exports = root.OverheadCelestialPlan;
})(typeof self !== 'undefined' ? self : globalThis);
