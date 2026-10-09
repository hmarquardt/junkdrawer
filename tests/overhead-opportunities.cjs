/* Unified opportunity model: normalisation, rejection, deduplication, consolidation, scoring,
   the three confidences and the planning horizons.
   Run: node tests/overhead-opportunities.cjs */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
globalThis.Astronomy = require(path.resolve('vendor/overhead/astronomy-2.1.19.min.js'));
const A = require(path.resolve('overhead-astro.js'));
const P = require(path.resolve('overhead-planets.js'));
const M = require(path.resolve('overhead-meteors.js'));
const O = require(path.resolve('overhead-opportunities.js'));
const dataset = JSON.parse(fs.readFileSync(path.resolve('data/overhead/meteor-showers.json'), 'utf8'));
const DAY = 86400000, HOUR = 3600000;
const now = Date.parse('2026-10-08T18:00:00Z');
const princeton = { lat: 38.3553, lon: -87.5675, tz: 'America/Chicago' };
const nights = [];
for (let day = 0; day < 90; day++) {
  const noon = Date.parse('2026-10-08T17:00:00Z') + day * DAY;
  const { sunset, sunrise } = A.sunsetSunrise(princeton, noon);
  nights.push({ day: new Date(noon).toISOString().slice(0, 10), start: sunset, end: sunrise });
}
// Real candidates from both engines, tagged with their categories.
const planetCandidates = P.events(princeton, now, now + 90 * DAY, { windows: nights, stepHours: 24 })
  .map(candidate => ({ ...candidate, category: 'planets' }));
const meteorPlan = M.plan(dataset, { site: princeton, windows: nights, now });
const meteorCandidates = meteorPlan.showers.map(candidate => ({ ...candidate, category: 'meteors' }));
const all = [...planetCandidates, ...meteorCandidates];
const noWeather = () => null;

/* ---- 1. normalisation and rejection ------------------------------------ */
{
  const { accepted, rejected } = O.fromCandidates(all, { site: princeton, now });
  assert.equal(rejected.length, 0, 'every real candidate must satisfy the model: ' + JSON.stringify(rejected.slice(0, 3)));
  assert.equal(accepted.length, all.length);
  for (const opportunity of accepted) {
    assert(opportunity.id && opportunity.modelVersion === O.MODEL_VERSION);
    assert(O.CATEGORIES[opportunity.category]);
    assert(opportunity.title && opportunity.summary && opportunity.why.length > 0);
    assert(Number.isFinite(opportunity.best));
    assert(typeof opportunity.eligibility.observable === 'boolean');
    assert(opportunity.objects.length > 0);
  }
  // Malformed candidates are rejected with reasons, not shown with holes in them.
  const bad = [{ kind: 'conjunction', objects: ['Mars'], t: {} }, { objects: ['Mars'], t: { best: now } },
    { kind: 'conjunction', objects: [], t: { best: now } }];
  const rejectedBad = O.fromCandidates(bad, {}).rejected;
  assert.equal(rejectedBad.length, 3);
  assert(rejectedBad.every(entry => entry.problems.length > 0));
  // Ids are deterministic for the same input.
  const again = O.fromCandidates(all, { site: princeton, now }).accepted;
  assert(again.every((o, i) => o.id === accepted[i].id), 'opportunity ids must be stable');
  console.log('model: ' + accepted.length + ' real candidates normalised, 3 malformed candidates rejected, ids stable');
}

/* ---- 2. deduplication and consolidation -------------------------------- */
{
  const scored = O.withScores(all, { site: princeton, now, weatherAt: noWeather });
  const ids = new Set(scored.opportunities.map(o => o.id));
  assert.equal(ids.size, scored.opportunities.length, 'deduplicated ids must be unique');
  // Duplicate night cards are impossible in a short-horizon plan.
  const tonight = O.plan(scored.opportunities, { horizon: 'tonight', now, windows: nights, weatherAt: noWeather });
  const keys = tonight.opportunities.map(o => O.dedupeKey(o));
  assert.equal(new Set(keys).size, keys.length, 'a plan must not repeat the same circumstance');
  const week = O.plan(scored.opportunities, { horizon: 'week', now, windows: nights, weatherAt: noWeather });
  assert(week.opportunities.length > 3 && week.opportunities.length < 60, 'a week plan is a usable length: ' + week.opportunities.length);
  const extended = O.plan(scored.opportunities, { horizon: 'extended', now, windows: nights, weatherAt: noWeather });
  assert.equal(extended.consolidated, true);
  assert(extended.opportunities.length < 60, 'the 90-day plan must be consolidated: ' + extended.opportunities.length);
  const merged = extended.opportunities.filter(o => o.attributes.nightCount > 1);
  assert(merged.length > 0, 'consolidation must actually merge multi-night circumstances');
  for (const opportunity of merged) {
    const best = opportunity.attributes.runScores.reduce((a, b) => (b.value > a.value ? b : a));
    assert.equal(best.value, opportunity.observing.value, 'a merged card must carry its best night\'s score');
    assert(opportunity.attributes.nightCount >= 2);
    assert.equal(opportunity.attributes.bestNight, best.night);
    assert(opportunity.why.some(text => /observable on \d+ nights/.test(text)));
  }
  console.log('dedupe: tonight ' + tonight.opportunities.length + ', week ' + week.opportunities.length +
    ', 90 days ' + extended.opportunities.length + ' cards (' + merged.length + ' merged multi-night runs) from ' + all.length + ' candidates');
}

/* ---- 3. scoring, weather horizon and the three confidences -------------- */
{
  const base = { category: 'planets', kind: 'opposition', objects: ['Jupiter'], t: { start: now, end: now, best: now + HOUR },
    observable: true, optical: 'naked-eye', positions: [{ name: 'Jupiter', altitude: 60, azimuth: 180, compass: 'S' }],
    data: { darknessAchieved: 'astronomical', moon: { interference: 'none' } } };
  const good = O.create(base, {}).opportunity;
  const goodScore = O.score(good, { now, weatherAt: noWeather });
  const poor = O.create({ ...base, optical: 'telescope',
    positions: [{ name: 'Jupiter', altitude: 12, azimuth: 180, compass: 'S' }],
    data: { darknessAchieved: 'civil', moon: { interference: 'washed-out' } } }, {}).opportunity;
  const poorScore = O.score(poor, { now, weatherAt: noWeather });
  assert(goodScore.value > poorScore.value + 25, 'a high, dark, moon-free naked-eye event must outscore a low, moonlit, telescopic one');
  assert(goodScore.factors.altitude > poorScore.factors.altitude);
  assert(goodScore.factors.darkness > poorScore.factors.darkness);
  assert.equal(poorScore.factors.moonlight, 0);
  // Weather is only applied inside its useful range.
  const weatherAt = () => ({ cloud_cover: 10, visibility: 25000, precipitation: 0 });
  const near = O.score({ ...good, best: now + 2 * HOUR }, { now, weatherAt });
  const far = O.score({ ...good, best: now + 60 * DAY }, { now, weatherAt });
  assert.equal(near.weatherUsed, true);
  // Adding weather re-normalises the weighted mean, so a good forecast may move the value slightly;
  // what must hold is that it stays high and that a bad forecast clearly costs points.
  assert(near.value >= goodScore.value - 3, 'a clear forecast must not meaningfully lower the score (' + near.value + ' vs ' + goodScore.value + ')');
  assert.equal(far.weatherUsed, false, 'weather must not be applied two months ahead');
  assert.equal(far.withinForecast, false);
  assert.equal(far.provisional, true);
  assert.equal(far.factors.weather, null);
  const cloudy = O.score({ ...good, best: now + 2 * HOUR }, { now, weatherAt: () => ({ cloud_cover: 100, visibility: 5000, precipitation: 1 }) });
  assert(cloudy.value < near.value - 15, 'a forecast of full cloud and rain must clearly reduce the score (' + cloudy.value + ' vs ' + near.value + ')');
  // A candidate that is not observable scores zero and says why.
  const refused = O.create({ ...base, observable: false, caveats: ['below the horizon here'] }, {}).opportunity;
  const refusedScore = O.score(refused, { now, weatherAt: noWeather });
  assert.equal(refusedScore.value, 0);
  assert.match(refusedScore.detail, /not observable/i);
  // The three confidences are separate and each is populated.
  const confidences = O.confidence(good, { now, observing: goodScore, weatherAt: noWeather });
  assert.equal(confidences.astrometric.grade, 'exact');
  assert.equal(confidences.phenomenon.level, 'low');
  assert.equal(confidences.observing.grade, 'no-usable-forecast', 'inside the forecast window but without a usable forecast');
  assert.equal(confidences.phenomenon.level, 'low');
  const farConfidence = O.confidence({ ...good, best: now + 60 * DAY }, { now, observing: O.score({ ...good, best: now + 60 * DAY }, { now, weatherAt: noWeather }) });
  assert.equal(farConfidence.observing.grade, 'astronomy-only', 'beyond the forecast range the grade says astronomy only');
  const comet = O.create({ ...base, category: 'comets', kind: 'comet', objects: ['C/2026 S2'],
    data: { positionGrade: 'kepler-degraded', darknessAchieved: 'astronomical', moon: { interference: 'none' } } }, {}).opportunity;
  const cometConfidence = O.confidence(comet, { now, observing: O.score(comet, { now }) });
  assert.equal(cometConfidence.astrometric.grade, 'kepler-degraded');
  assert.equal(cometConfidence.phenomenon.level, 'high');
  assert.notEqual(cometConfidence.astrometric.grade, cometConfidence.phenomenon.level);
  console.log('scoring: good ' + goodScore.value + ' vs poor ' + poorScore.value + ', cloudy ' + cloudy.value +
    ', far-horizon provisional ' + far.provisional + '; confidences astrometric/phenomenon kept separate');
}

/* ---- 4. eligibility, empty states and the rank order ------------------- */
{
  const scored = O.withScores(all, { site: princeton, now, weatherAt: noWeather });
  const values = scored.opportunities.map(o => o.observing.value);
  for (let i = 1; i < values.length; i++) assert(values[i - 1] >= values[i], 'opportunities must be ranked by observing value');
  const refused = scored.opportunities.filter(o => !o.eligibility.observable);
  assert(refused.every(o => o.observing.value === 0), 'a refused event can never carry observing value');
  const week = O.plan(scored.opportunities, { horizon: 'week', now, windows: nights, weatherAt: noWeather });
  assert(week.opportunities.every(o => o.eligibility.observable), 'the plan must never list an unobservable event as an opportunity');
  assert(week.notObservable.every(entry => entry.reasons.length > 0), 'every excluded event must say why');
  // An empty plan is a valid answer with an explanation.
  const empty = O.plan([], { horizon: 'tonight', now, windows: nights, weatherAt: noWeather });
  assert.equal(empty.empty, true);
  assert.match(empty.emptyReason, /Nothing|no notable/i);
  const onlyRefused = O.plan([scored.opportunities.find(o => !o.eligibility.observable)].filter(Boolean),
    { horizon: 'tonight', now, windows: nights, weatherAt: noWeather });
  assert.equal(onlyRefused.opportunities.length, 0);
  assert.equal(onlyRefused.empty, true);
  // Long horizons carry the honesty notes about weather and comet brightness.
  const extended = O.plan(scored.opportunities, { horizon: 'extended', now, windows: nights, weatherAt: noWeather });
  assert(extended.notes.some(text => /weather can only be trusted/i.test(text)));
  assert(extended.notes.some(text => /comet brightness|meteor activity/i.test(text)));
  console.log('eligibility: ' + week.opportunities.length + ' offered, ' + week.notObservable.length +
    ' excluded with reasons; empty plan reported as valid');
}

/* ---- 5. satellites join the same model --------------------------------- */
{
  const pass = { id: '25544-123456', name: 'ISS (ZARYA)', norad: '25544', start: now + 600000, end: now + 1200000,
    peak: { t: now + 900000, el: 62, az: 210, sun: -20, lit: true }, likely: true, score: { score: 78 },
    brightness: 1, duration: 240, provisional: false, groups: ['stations'] };
  const candidate = O.fromSatellitePass(pass, { site: princeton });
  const created = O.create(candidate, { site: princeton });
  assert.equal(created.ok, true, JSON.stringify(created.problems));
  const opportunity = created.opportunity;
  assert.equal(opportunity.category, 'satellites');
  assert.equal(opportunity.objects[0], 'ISS (ZARYA)');
  assert.equal(opportunity.attributes.darknessAchieved, 'astronomical');
  assert.equal(opportunity.positions[0].altitude, 62);
  assert.match(opportunity.provenance.library, /satellite\.js/);
  // The ranking mixes categories without losing the per-category information.
  const merged = O.withScores([...all, candidate], { site: princeton, now, weatherAt: noWeather });
  const categories = new Set(merged.opportunities.map(o => o.category));
  assert(categories.has('satellites') && categories.has('planets') && categories.has('meteors'));
  const satellite = merged.opportunities.find(o => o.category === 'satellites');
  assert(satellite.observing.value > 0);
  console.log('satellites: converted pass ranked with value ' + satellite.observing.value +
    ' alongside ' + (merged.opportunities.length - 1) + ' celestial opportunities in ' + categories.size + ' categories');
}
console.log('PASS: unified opportunity model, scoring, dedupe, consolidation and all three horizons verified');
