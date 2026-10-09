/* Astronomy-layer validation against committed JPL Horizons fixtures.
   Run: node tests/overhead-astro.cjs
   Tolerances are the ones documented in docs/overhead-celestial.md section 7 and are asserted, not
   advisory: the worst measured value is printed so drift in either the library or the fixtures is
   visible rather than hidden behind a loose bound. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
globalThis.Astronomy = require(path.resolve('vendor/overhead/astronomy-2.1.19.min.js'));
const A = require(path.resolve('overhead-astro.js'));
const fixture = JSON.parse(fs.readFileSync(path.resolve('tests/fixtures/overhead/horizons-planets.json'), 'utf8'));

const TOL = Object.freeze({
  geocentricDirection: 0.05,    // degrees; Horizons astrometric RA/Dec vs the library
  topocentricDirection: 0.05,   // degrees; same quantity after the topocentric parallax correction
  airlessAltAz: 0.05,           // degrees; airless apparent AZ/EL
  refractedAlt: 0.02,           // degrees; two different standard refraction models, above 10 degrees altitude
  refractedAltLow: 0.60,        // degrees; below 10 degrees altitude refraction models diverge
  distanceRelative: 0.002,      // |delta_horizons - distance_library| / delta
  eventTimeDays: 1.0,           // days; apparition searches vs the fixture's own daily sampling
  elongation: 0.5,              // degrees
  radiantCrossCheck: 5.0,       // degrees (meteor dataset, asserted in the meteors test)
});

const SITES = { 'Princeton, Indiana': { lat: 38.3553, lon: -87.5675 }, 'Cape Town': { lat: -33.9249, lon: 18.4241 },
  Longyearbyen: { lat: 78.22, lon: 15.65 } };
const wrap180 = value => ((value + 540) % 360) - 180;
const worst = { geocentric: 0, topocentric: 0, airless: 0, refracted: 0, distance: 0 };
const count = { geocentric: 0, topocentric: 0, airless: 0, refracted: 0 };
const MS = 86400000;

/* ---- 1. geocentric astrometric RA/Dec and distance --------------------- */
for (const sample of fixture.samples.filter(s => s.kind === 'geocentric')) {
  const engine = A.geometricEquatorial(sample.body, sample.utc);
  const offset = A.separation(engine.raDeg, engine.decDeg, sample.ra_deg, sample.dec_deg);
  worst.geocentric = Math.max(worst.geocentric, offset);
  count.geocentric++;
  assert(offset <= TOL.geocentricDirection,
    `${sample.body} ${sample.utc} geocentric direction differs by ${offset.toFixed(4)} deg`);
  if (sample.delta_au > 0.01) {
    const relative = Math.abs(engine.distanceAu - sample.delta_au) / sample.delta_au;
    worst.distance = Math.max(worst.distance, relative);
    assert(relative <= TOL.distanceRelative,
      `${sample.body} ${sample.utc} distance differs by ${(relative * 100).toFixed(4)}%`);
  }
  assert.match(engine.frame, /J2000/);
  assert.match(engine.provenance.library, /Astronomy Engine/);
}

/* ---- 2. topocentric airless altitude/azimuth ---------------------------- */
for (const sample of fixture.samples.filter(s => s.kind === 'topocentric-airless')) {
  const site = SITES[sample.site];
  const airless = A.horizontal(sample.body, sample.utc, site, { refraction: 'none' });
  const alt = Math.abs(airless.altitude - sample.apparent_alt_deg);
  const az = Math.abs(wrap180(airless.azimuth - sample.apparent_az_deg)) * Math.cos(sample.apparent_alt_deg * Math.PI / 180);
  const offset = Math.hypot(alt, az);
  worst.airless = Math.max(worst.airless, offset); count.airless++;
  assert(offset <= TOL.airlessAltAz, `${sample.body} at ${sample.site} airless alt/az differs by ${offset.toFixed(4)} deg`);
  // The same topocentric geometry, expressed as RA/Dec, must also match Horizons.
  const eq = A.geometricEquatorial(sample.body, sample.utc, site);
  const dir = A.separation(eq.raDeg, eq.decDeg, sample.ra_deg, sample.dec_deg);
  worst.topocentric = Math.max(worst.topocentric, dir); count.topocentric++;
  assert(dir <= TOL.topocentricDirection, `${sample.body} at ${sample.site} topocentric RA/Dec differs by ${dir.toFixed(4)} deg`);
}

/* ---- 3. refraction model ------------------------------------------------ */
for (const sample of fixture.samples.filter(s => s.kind === 'topocentric-refracted')) {
  const site = SITES[sample.site];
  const refracted = A.horizontal(sample.body, sample.utc, site, { refraction: 'normal' });
  const airless = A.horizontal(sample.body, sample.utc, site, { refraction: 'none' });
  const limit = sample.apparent_alt_deg >= 10 ? TOL.refractedAlt : TOL.refractedAltLow;
  const delta = Math.abs(refracted.altitude - sample.apparent_alt_deg);
  worst.refracted = Math.max(worst.refracted, delta); count.refracted++;
  assert(delta <= limit, `${sample.body} at ${sample.site} refracted altitude differs by ${delta.toFixed(4)} deg`);
  // The library's standard model lifts a body by at most about 0.6 degrees at the horizon; a larger
  // correction would mean the wrong refraction option or the wrong coordinate frame was supplied.
  assert(refracted.refractionDeg >= -0.01 && refracted.refractionDeg <= 0.7,
    `implausible refraction correction ${refracted.refractionDeg}`);
  if (sample.apparent_alt_deg >= 5) {
    assert(refracted.altitude >= airless.altitude - 0.01, 'refraction must not lower a body above 5 degrees');
  }
  assert.equal(refracted.refractionApplied, true);
}

/* ---- 4. topocentric parallax is actually applied ------------------------ */
{
  const moonGeocentric = fixture.samples.filter(s => s.body === 'Moon' && s.kind === 'geocentric');
  const site = SITES['Princeton, Indiana'];
  let parallax = 0;
  for (const sample of moonGeocentric.slice(0, 6)) {
    const g = A.geometricEquatorial('Moon', sample.utc), t = A.geometricEquatorial('Moon', sample.utc, site);
    parallax = Math.max(parallax, A.separation(g.raDeg, g.decDeg, t.raDeg, t.decDeg));
  }
  // The Moon's horizontal parallax is about 0.9 degrees; if a "topocentric" position ignored it the
  // difference would be zero and every spacecraft-free sky instruction would be wrong.
  assert(parallax > 0.5 && parallax < 1.2, `Moon topocentric parallax measured ${parallax.toFixed(4)} deg`);
  worst.parallax = parallax;
}

/* ---- 5. darkness, DST, cross-midnight and polar nights ------------------ */
const princeton = { lat: 38.3553, lon: -87.5675, tz: 'America/Chicago' };
{
  const night = { start: Date.parse('2026-10-08T22:00:00Z'), end: Date.parse('2026-10-09T12:00:00Z') };
  const dark = A.darkness(princeton, night.start, night.end);
  assert.equal(dark.achieved, 'astronomical');
  assert(dark.best && dark.best.start > night.start && dark.best.end < night.end, 'dark window must be interior');
  // The window must span local midnight: it belongs to the evening of October 8 locally and the
  // small hours of October 9, which in UTC is entirely on October 9 in the early hours.
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: princeton.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(dark.best.start));
  const field = type => parts.find(p => p.type === type).value;
  assert.equal(`${field('year')}-${field('month')}-${field('day')}`, '2026-10-08', 'the window belongs to the local evening of October 8');
  const localMidnight = Date.parse('2026-10-09T05:00:00Z');   // 2026-10-09T00:00 CDT (UTC-5)
  assert(dark.best.start < localMidnight && dark.best.end > localMidnight, 'the dark window must cross local midnight');
  assert(dark.best.end - dark.best.start > 8 * 3600000, 'an October night at 38N should be dark for more than 8 hours');
  assert(dark.intervals.astronomical.length >= 1 && dark.limited === false);
  worst.darkHours = (dark.best.durationMin / 60);
}
{
  // US daylight saving ends 2026-11-01; the dark window must still land on the local date it belongs
  // to, and must be computed from real solar altitude rather than an assumed clock offset.
  const night = { start: Date.parse('2026-11-01T23:00:00Z'), end: Date.parse('2026-11-02T13:00:00Z') };
  const dark = A.darkness(princeton, night.start, night.end);
  assert(dark.best, 'expected a dark window across the DST boundary');
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: princeton.tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  assert.equal(fmt.format(new Date(dark.best.start)), '2026-11-01');
  assert.equal(fmt.format(new Date(dark.best.end)), '2026-11-02');
  // Sunset moves about an hour earlier in local clock terms after DST ends but the UTC instant of
  // darkness is dictated by the Sun, so the window must not regress to the summer shape.
  assert(dark.best.durationMin > 600 && dark.best.durationMin < 800);
}
{
  // 78N in mid-October: the Sun never reaches 18 degrees below the horizon, so the planner must
  // report nautical darkness and mark the night limited instead of claiming astronomical darkness.
  const polar = { lat: 78.22, lon: 15.65, tz: 'Arctic/Longyearbyen' };
  const dark = A.darkness(polar, Date.parse('2026-10-08T16:00:00Z'), Date.parse('2026-10-09T08:00:00Z'));
  assert.equal(dark.achieved, 'nautical');
  assert.equal(dark.limited, true);
  assert(dark.intervals.astronomical.length === 0);
  // Polar day: in June the Sun stays up, so there is no dark window at all - and no invention of one.
  const summer = A.darkness(polar, Date.parse('2026-06-21T20:00:00Z'), Date.parse('2026-06-22T06:00:00Z'));
  assert.equal(summer.achieved, 'none');
  assert.equal(summer.best, null);
  const window = A.bestWindow('Jupiter', polar, { start: Date.parse('2026-06-21T20:00:00Z'), end: Date.parse('2026-06-22T06:00:00Z') });
  assert.equal(window.ok, false);
  assert.match(window.reason, /dark/);
}
{
  // Southern hemisphere night on the same UTC instant must be a different window, not a copy.
  const cape = { lat: -33.9249, lon: 18.4241, tz: 'Africa/Johannesburg' };
  const dark = A.darkness(cape, Date.parse('2026-10-08T16:00:00Z'), Date.parse('2026-10-09T06:00:00Z'));
  assert(dark.best, 'Cape Town must have a dark window');
  assert.equal(dark.achieved, 'astronomical');
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: cape.tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  assert.equal(fmt.format(new Date(dark.best.start)), '2026-10-08');
}


/* ---- 6. practical observing window ------------------------------------- */
{
  const night = { start: Date.parse('2026-10-08T22:00:00Z'), end: Date.parse('2026-10-09T12:00:00Z') };
  const jupiter = A.bestWindow('Jupiter', princeton, night);
  assert.equal(jupiter.ok, true, 'Jupiter should be observable on the October 8 night');
  assert(jupiter.start < jupiter.end && jupiter.durationMin > 30);
  assert(jupiter.peak.altitude >= A.RULES.minAltitudeObservable);
  assert(A.compass(jupiter.peak.azimuth) === jupiter.peak.compass);
  assert.match(jupiter.darkness.achieved, /astronomical/);
  // The peak of the window must be the highest altitude in the window, not merely the first sample.
  const track = A.altitudePath('Jupiter', princeton, jupiter.start, jupiter.end, 2);
  assert(track.every(p => p.altitude <= jupiter.peak.altitude + 0.01), 'peak altitude must bound the window');
  assert(Math.abs(track.reduce((a, b) => (b.altitude > a.altitude ? b : a)).altitude - jupiter.peak.altitude) < 0.05);
  worst.jupiterAlt = jupiter.peak.altitude;
  // A body that stays below the horizon through the dark hours must produce a refusal with a reason,
  // never an event. Mercury in late 2026 is the perfect case: at greatest elongation it is far from
  // the Sun but already set by the time the sky is dark, so it must be refused by default and only
  // offered when the caller explicitly asks for twilight visibility.
  let refused = 0, offered = 0, twilightOnly = 0;
  for (let day = 0; day < 90; day++) {
    const start = Date.parse('2026-10-08T22:00:00Z') + day * 86400000;
    const window = A.bestWindow('Mercury', princeton, { start, end: start + 14 * 3600000 });
    if (window.ok) { offered++; assert.equal(window.darknessUsed, 'astronomical'); }
    else { refused++; assert(window.reason && window.reason.length > 10); }
    const twilight = A.bestWindow('Mercury', princeton, { start, end: start + 14 * 3600000 }, { allowTwilight: true });
    if (twilight.ok) {
      twilightOnly++;
      assert(['nautical', 'civil'].includes(twilight.darknessUsed), 'a twilight sighting must say which twilight');
      assert.equal(twilight.twilight, true);
    }
  }
  assert(refused > 0, `Mercury must be refused during the dark hours on some nights (${offered} offered)`);
  assert(twilightOnly > 0, 'Mercury must be offered as a twilight-only sighting on some nights');
  assert.equal(offered, 0, 'Mercury is never above 8 degrees during full darkness in this span');
  worst.mercury = { darkHourOffers: offered, darkHourRefusals: refused, twilightOffers: twilightOnly };
}

/* ---- 7. event searches cross-checked against Horizons daily samples ---- */
const geocentric = {};
for (const sample of fixture.samples.filter(s => s.kind === 'geocentric')) {
  (geocentric[sample.body] = geocentric[sample.body] || new Map()).set(sample.utc, sample);
}
const fixtureTimes = [...geocentric.Sun.keys()].sort();
const elongationSeries = (a, b) => fixtureTimes.map(utc => ({
  utc, t: Date.parse(utc),
  value: A.separation(geocentric[a].get(utc).ra_deg, geocentric[a].get(utc).dec_deg,
    geocentric[b].get(utc).ra_deg, geocentric[b].get(utc).dec_deg) }));
const interiorExtreme = (list, compare) => list.filter((point, i) => i > 0 && i < list.length - 1
  && compare(point.value, list[i - 1].value) && compare(point.value, list[i + 1].value));
const fixtureStart = Date.parse(fixtureTimes[0]), fixtureEnd = Date.parse(fixtureTimes[fixtureTimes.length - 1]);


{
  // Opposition of a superior planet = maximum solar elongation. Compare the library's apparition
  // search with the fixture's own daily Horizons sampling.
  for (const planet of ['Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']) {
    const maxima = interiorExtreme(elongationSeries('Sun', planet), (v, n) => v >= n);
    const events = A.oppositions(planet, fixtureStart, fixtureEnd);
    if (!maxima.length) { assert.equal(events.length, 0, `${planet}: no fixture maximum, so no opposition may be reported`); continue; }
    const best = maxima.reduce((a, b) => (b.value > a.value ? b : a));
    assert.equal(events.length, 1, `${planet} should have exactly one opposition inside the fixture window`);
    assert(Math.abs(events[0] - best.t) <= TOL.eventTimeDays * MS,
      `${planet} opposition ${new Date(events[0]).toISOString()} vs fixture maximum ${best.utc}`);
    assert(A.sunAngle(planet, events[0]) >= 179.0, `${planet} elongation at opposition must be near 180 degrees`);
    worst.oppositionDays = Math.max(worst.oppositionDays || 0, Math.abs(events[0] - best.t) / MS);
  }
  // Greatest elongation of Mercury and Venus.
  for (const planet of ['Mercury', 'Venus']) {
    const maxima = interiorExtreme(elongationSeries('Sun', planet), (v, n) => v >= n);
    const events = A.greatestElongations(planet, fixtureStart, fixtureEnd);
    for (const maximum of maxima) {
      const match = events.find(e => Math.abs(e.t - maximum.t) <= 2 * TOL.eventTimeDays * MS);
      assert(match, `${planet} greatest elongation missing near ${maximum.utc}`);
      assert(Math.abs(match.elongationDeg - maximum.value) <= TOL.elongation,
        `${planet} elongation ${match.elongationDeg.toFixed(3)} vs fixture ${maximum.value.toFixed(3)}`);
      assert(['morning', 'evening'].includes(match.visibility), 'elongation visibility must be reported');
    }
    assert(events.length >= maxima.length, `${planet} events ${events.length} < fixture maxima ${maxima.length}`);
  }
}
{
  // Closest apparent planet-planet pairing inside the fixture window, found from Horizons data alone
  // and then required to appear in the engine's conjunction search within a day.
  const planets = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
  const pairs = [];
  for (let i = 0; i < planets.length; i++) {
    for (let j = i + 1; j < planets.length; j++) {
      const minima = interiorExtreme(elongationSeries(planets[i], planets[j]), (v, n) => v <= n);
      if (minima.length) pairs.push({ a: planets[i], b: planets[j], ...minima.reduce((x, y) => (y.value < x.value ? y : x)) });
    }
  }
  assert(pairs.length > 6, 'the fixture window must contain planet-planet minima to compare');
  const tightest = pairs.reduce((a, b) => (b.value < a.value ? b : a));
  const found = A.minimumSeparations(tightest.a, tightest.b, fixtureStart, fixtureEnd)
    .filter(m => m.t > fixtureStart + MS && m.t < fixtureEnd - MS);
  const match = found.find(m => Math.abs(m.t - tightest.t) <= TOL.eventTimeDays * MS);
  assert(match, `no conjunction found near ${tightest.a}/${tightest.b} at ${tightest.utc} (found ${found.length})`);
  assert(match.separationDeg <= tightest.value + 0.3,
    `refined separation ${match.separationDeg.toFixed(3)} worse than the fixture grid ${tightest.value.toFixed(3)}`);
  // Every reported minimum really is a local minimum of the separation function, checked one hour
  // either side with the engine's own positions so a grid artifact cannot survive.
  const separationAt = t => {
    const x = A.geometricEquatorial(tightest.a, t), y = A.geometricEquatorial(tightest.b, t);
    return A.separation(x.raDeg, x.decDeg, y.raDeg, y.decDeg);
  };
  for (const minimum of found) {
    assert(minimum.separationDeg <= separationAt(minimum.t - 3600000) + 1e-6
      && minimum.separationDeg <= separationAt(minimum.t + 3600000) + 1e-6, 'reported minimum must be a local minimum');
  }
  worst.conjunction = { pair: tightest.a + '/' + tightest.b, gridDeg: tightest.value,
    refinedDeg: match.separationDeg, days: Math.abs(match.t - tightest.t) / MS };

/* ---- 8. eclipses: locality is not optional ----------------------------- */
{
  const indiana = SITES['Princeton, Indiana'];
  const cape = SITES['Cape Town'];
  const lunar = A.lunarEclipses(indiana, Date.parse('2027-01-01T00:00:00Z'), Date.parse('2027-06-01T00:00:00Z'));
  assert.equal(lunar.length, 1, 'exactly one lunar eclipse is expected in this window');
  const eclipse = lunar[0];
  assert.equal(eclipse.kind, 'penumbral');
  assert(Math.abs(Date.parse('2027-02-20T23:12:44Z') - eclipse.peak.t) <= 5 * 60000, 'penumbral peak time');
  assert.equal(eclipse.obscuration, 0, 'a penumbral eclipse has no umbral obscuration');
  // Geometry check using an independent quantity: a lunar eclipse requires the Moon to be opposite
  // the Sun, so the Sun-Moon angle at the peak must be within a couple of degrees of 180.
  assert(A.sunAngle('Moon', eclipse.peak.t) >= 170, 'the Moon must be near opposition at a lunar eclipse');
  assert(eclipse.phases.penumbral_begin.t < eclipse.peak.t && eclipse.peak.t < eclipse.phases.penumbral_end.t);
  assert.equal(eclipse.phases.partial_begin, null, 'no partial phase in a penumbral eclipse');
  // Local visibility is decided by the Moon's altitude at this site, not by the eclipse happening.
  assert.equal(eclipse.localVisible, false, 'the Moon is below the horizon at the peak from Indiana');
  assert(eclipse.peak.altitude < 0);
  const elsewhere = A.lunarEclipses(cape, Date.parse('2027-01-01T00:00:00Z'), Date.parse('2027-06-01T00:00:00Z'))[0];
  assert.equal(elsewhere.peak.t, eclipse.peak.t, 'the same eclipse everywhere');
  assert.equal(elsewhere.localVisible, true, 'the same eclipse is above the horizon from Cape Town');
  assert(elsewhere.peak.altitude > 0);
  worst.lunarEclipse = { peak: new Date(eclipse.peak.t).toISOString(), indianaAlt: eclipse.peak.altitude, capeAlt: elsewhere.peak.altitude };
}
{
  const spain = { lat: 43.36, lon: -8.4 }, indiana = SITES['Princeton, Indiana'];
  const august = [Date.parse('2026-08-01T00:00:00Z'), Date.parse('2026-08-31T00:00:00Z')];
  const spanish = A.localSolarEclipses(spain, august[0], august[1]);
  assert.equal(spanish.length, 1, 'the 2026 August eclipse is locally visible from north-west Spain');
  assert.equal(spanish[0].kind, 'total');
  assert(spanish[0].obscuration > 0.99);
  assert(spanish[0].phases.partial_begin.t < spanish[0].phases.peak.t && spanish[0].phases.peak.t < spanish[0].phases.partial_end.t);
  assert(spanish[0].phases.peak.altitude > 0 && spanish[0].phases.peak.altitude < 30, 'a low evening Sun, as expected near sunset');
  // The same eclipse must NOT be reported for Indiana: this is the exact failure mode the planner has
  // to avoid, so it is asserted rather than assumed.
  assert.equal(A.localSolarEclipses(indiana, august[0], august[1]).length, 0, 'no local solar eclipse in Indiana in August 2026');
  // A locally visible solar eclipse far in the future is still reported, with its local obscuration.
  const next = A.localSolarEclipses(indiana, Date.parse('2026-10-08T00:00:00Z'), Date.parse('2030-01-01T00:00:00Z'));
  assert(next.length >= 1);
  assert.equal(new Date(next[0].phases.peak.t).toISOString().slice(0, 10), '2028-01-26');
  assert.equal(next[0].kind, 'partial');
  assert(next[0].obscuration > 0 && next[0].obscuration < 0.5);
  worst.solarEclipses = { spain: spanish[0].kind + ' ' + spanish[0].obscuration.toFixed(3),
    indianaNext: new Date(next[0].phases.peak.t).toISOString().slice(0, 10) };
}


/* ---- 9. solar-longitude peaks, moonlight heuristics, magnitudes -------- */
{
  const residual = (target, t) => ((A.sunLongitude(t) - target + 540) % 360) - 180;
  for (const target of [0, 90, 140.0, 254.5, 283.15, 312.4]) {
    const t = A.searchSunLongitude(target, Date.parse('2026-01-01T00:00:00Z'), 400);
    assert(Math.abs(residual(target, t)) <= 0.01, `solar longitude ${target} round trip error ${residual(target, t)}`);
  }
  // Peak dates derived from solar longitude must be year-specific rather than copied between years.
  // The instant lambda-sun reaches a value drifts about a quarter day per year, so the UTC date is
  // stable but the time is not - which is exactly why a copied calendar date is wrong.
  const peak2026 = A.searchSunLongitude(140.0, Date.parse('2026-01-01T00:00:00Z'), 400);
  const peak2027 = A.searchSunLongitude(140.0, Date.parse('2027-01-01T00:00:00Z'), 400);
  assert.equal(new Date(peak2026).toISOString().slice(0, 10), '2026-08-12');
  assert.equal(new Date(peak2027).toISOString().slice(0, 10), '2027-08-12');
  assert(new Date(peak2027).getUTCHours() > new Date(peak2026).getUTCHours(), 'the peak instant must drift later in UTC');
  worst.solarLongitudePeaks = { '2026': new Date(peak2026).toISOString(), '2027': new Date(peak2027).toISOString() };

  const target = { altitude: 45, azimuth: 185 };
  const full = { phaseFraction: 0.99, altitude: 40, azimuth: 180 };
  assert.equal(A.moonInterference(full, target).level, 'washed-out');
  assert.equal(A.moonInterference(full, { altitude: 45, azimuth: 320 }).level, 'none');
  assert.equal(A.moonInterference({ phaseFraction: 0.1, altitude: 40, azimuth: 180 }, target).level, 'none');
  assert.equal(A.moonInterference({ phaseFraction: 0.9, altitude: 2, azimuth: 180 }, target).level, 'none');
  const gibbous = { phaseFraction: 0.4, altitude: 40, azimuth: 170 };
  assert.equal(A.moonInterference(gibbous, target).level, 'glare');
  assert.equal(A.moonInterference(gibbous, target, { faint: true }).level, 'washed-out');
  assert.equal(A.moonInterference({ phaseFraction: 0.9, altitude: 40, azimuth: 220 }, target).level, 'washed-out', '26 degrees away is still too close for a full Moon');
  assert.equal(A.moonInterference({ phaseFraction: 0.9, altitude: 40, azimuth: 245 }, target).level, 'glare', '43 degrees away brightens the sky but does not wash the target out');
  assert.equal(A.moonInterference({ phaseFraction: 0.9, altitude: 40, azimuth: 320 }, target).level, 'none', 'clear of the target');
  assert.equal(A.horizonSeparation(20, 0, 20, 0), 0);
  assert(Math.abs(A.horizonSeparation(0, 0, 0, 90) - 90) < 1e-9);
  assert(Math.abs(A.horizonSeparation(30, 0, -30, 180) - 180) < 1e-9);

  const ranges = { Mercury: [-3.0, 6.0], Venus: [-5.0, -3.0], Mars: [-3.0, 2.5], Jupiter: [-3.0, -1.5],
    Saturn: [-0.7, 1.5], Uranus: [5.0, 6.5], Neptune: [7.3, 8.5] };
  for (const [name, [min, max]] of Object.entries(ranges)) {
    for (let day = 0; day < 120; day += 10) {
      const info = A.magnitude(name, Date.parse('2026-10-08T00:00:00Z') + day * 86400000);
      assert(info.magnitude >= min && info.magnitude <= max,
        `${name} magnitude ${info.magnitude.toFixed(2)} outside the physically possible range ${min}..${max}`);
      assert.match(info.source, /not a measurement/);
    }
  }
  for (const name of ['Uranus', 'Neptune']) {
    // The library's own magnitude makes the "never automatically naked eye" rule checkable.
    assert(A.magnitude(name, Date.parse('2026-11-01T00:00:00Z')).magnitude > A.RULES.nakedEyeMagnitude);
    assert(!A.isNakedEyePlanet(name));
  }
}

/* ---- 10. catalogue (J2000) coordinate path ----------------------------- */
{
  // The meteor-radiant path rotates a fixed J2000 position into the observer's horizontal frame.
  // Cross-checking it against the solar-system path (which returns of-date coordinates) proves the
  // two agree to within aberration and light-time differences, so a radiant is treated consistently.
  const site = SITES['Princeton, Indiana'];
  let worstCatalogue = 0;
  for (const name of ['Jupiter', 'Mars', 'Moon', 'Saturn', 'Venus']) {
    const t = Date.parse('2026-11-16T09:00:00Z');
    const eq = A.geometricEquatorial(name, t, site), direct = A.horizontal(name, t, site);
    const via = A.horizontalFromJ2000(eq.raDeg, eq.decDeg, t, site);
    const offset = A.horizonSeparation(direct.altitude, direct.azimuth, via.altitude, via.azimuth) * 3600;
    worstCatalogue = Math.max(worstCatalogue, offset);
    assert(offset < 30, `${name} catalogue path differs from the body path by ${offset.toFixed(1)}"`);
    assert(via.refractionApplied);
  }
  // The Perseid radiant (RA 48, dec +58, J2000) climbs high from 38N in mid-August and is above the
  // horizon through the night: a sanity check on the catalogue path with a published radiant.
  const track = A.trackFromJ2000(48, 58, site, Date.parse('2026-08-12T22:00:00Z'), Date.parse('2026-08-13T12:00:00Z'), 30);
  assert(track.length > 20 && track.every(p => Number.isFinite(p.altitude) && Number.isFinite(p.azimuth)));
  const peak = Math.max(...track.map(p => p.altitude));
  assert(peak > 60 && peak < 85, `Perseid radiant peak altitude ${peak.toFixed(1)} deg from 38N`);
  assert(Math.min(...track.map(p => p.altitude)) > -10, 'the radiant stays near or above the horizon all night at 38N');
  worst.catalogueArcsec = worstCatalogue;
  worst.perseidRadiantPeak = peak;
}

/* ---- summary ---------------------------------------------------------- */
console.log(`PASS: astronomy layer validated against ${fixture.samples.length} JPL Horizons samples from ${fixture.queries.length} queries.`);
console.log(`  worst geocentric direction error ${(worst.geocentric * 3600).toFixed(1)}" over ${count.geocentric} samples (limit ${(TOL.geocentricDirection * 3600).toFixed(0)}")`);
console.log(`  worst topocentric direction error ${(worst.topocentric * 3600).toFixed(1)}" over ${count.topocentric} samples (limit ${(TOL.topocentricDirection * 3600).toFixed(0)}")`);
console.log(`  worst airless alt/az error ${(worst.airless * 3600).toFixed(1)}" over ${count.airless} samples (limit ${(TOL.airlessAltAz * 3600).toFixed(0)}")`);
console.log(`  worst refracted-altitude error ${(worst.refracted * 3600).toFixed(1)}" over ${count.refracted} samples (limit ${(TOL.refractedAltLow * 3600).toFixed(0)}", ${(TOL.refractedAlt * 3600).toFixed(0)}" above 10 deg)`);
console.log(`  worst relative distance error ${(worst.distance * 100).toFixed(5)}% (limit ${(TOL.distanceRelative * 100).toFixed(2)}%)`);
console.log(`  Moon topocentric parallax ${worst.parallax.toFixed(3)} deg; Princeton dark window ${worst.darkHours.toFixed(1)} h; Jupiter peak ${worst.jupiterAlt.toFixed(1)} deg`);
console.log(`  Mercury: ${worst.mercury.darkHourOffers} dark-hour offers, ${worst.mercury.darkHourRefusals} refusals, ${worst.mercury.twilightOffers} twilight-only offers`);
console.log(`  worst opposition timing error ${worst.oppositionDays.toFixed(3)} d (limit ${TOL.eventTimeDays} d)`);
console.log(`  conjunction ${worst.conjunction.pair}: fixture grid ${worst.conjunction.gridDeg.toFixed(3)} deg, refined ${worst.conjunction.refinedDeg.toFixed(3)} deg, ${worst.conjunction.days.toFixed(3)} d apart`);
console.log(`  lunar eclipse ${worst.lunarEclipse.peak}: Indiana altitude ${worst.lunarEclipse.indianaAlt.toFixed(2)} deg (not visible), Cape Town ${worst.lunarEclipse.capeAlt.toFixed(2)} deg (visible)`);
console.log('  solar eclipse: Spain ' + worst.solarEclipses.spain + ', Indiana next ' + worst.solarEclipses.indianaNext);
console.log('  catalogue (J2000) path vs body path: worst ' + worst.catalogueArcsec.toFixed(1) + ' arcsec (limit 30); Perseid radiant peak ' + worst.perseidRadiantPeak.toFixed(1) + ' deg from 38N');

}
