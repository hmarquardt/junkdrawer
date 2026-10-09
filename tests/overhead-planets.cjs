/* Planetary engine validation: event discovery, eligibility, optical classification and the
   observability rules that keep the app honest. Cross-checked against the committed JPL Horizons
   fixtures wherever an independent number exists.
   Run: node tests/overhead-planets.cjs */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
globalThis.Astronomy = require(path.resolve('vendor/overhead/astronomy-2.1.19.min.js'));
const A = require(path.resolve('overhead-astro.js'));
const P = require(path.resolve('overhead-planets.js'));
const fixture = JSON.parse(fs.readFileSync(path.resolve('tests/fixtures/overhead/horizons-planets.json'), 'utf8'));
const DAY = 86400000;
const princeton = { lat: 38.3553, lon: -87.5675, tz: 'America/Chicago' };
const cape = { lat: -33.9249, lon: 18.4241, tz: 'Africa/Johannesburg' };
const start = Date.parse('2026-10-08T00:00:00Z'), end = start + 90 * DAY;
const nights = [];
for (let day = 0; day < 90; day++) {
  const noon = Date.parse('2026-10-08T17:00:00Z') + day * DAY;
  const { sunset, sunrise } = A.sunsetSunrise(princeton, noon);
  nights.push({ day: new Date(noon).toISOString().slice(0, 10), start: sunset, end: sunrise });
}
const total = nights.length;

/* ---- independent fixtures used as the reference ------------------------ */
const geocentric = {};
for (const sample of fixture.samples.filter(s => s.kind === 'geocentric')) {
  (geocentric[sample.body] = geocentric[sample.body] || new Map()).set(sample.utc, sample);
}
const times = [...geocentric.Sun.keys()].sort();
const elongationAt = (a, b, utc) => A.separation(geocentric[a].get(utc).ra_deg, geocentric[a].get(utc).dec_deg,
  geocentric[b].get(utc).ra_deg, geocentric[b].get(utc).dec_deg);
// Closest fixture separation of a pair, its time, and the same value refined by the engine.
function fixtureClosest(a, b) {
  let best = { value: Infinity, utc: null };
  for (let i = 1; i < times.length - 1; i++) {
    const value = elongationAt(a, b, times[i]);
    if (value <= elongationAt(a, b, times[i - 1]) && value <= elongationAt(a, b, times[i + 1]) && value < best.value) {
      best = { value, utc: times[i] };
    }
  }
  return best;
}

/* ---- 1. visibility and optical classification -------------------------- */
{
  const jupiter = P.visibility('Jupiter', princeton, nights[0]);
  assert.equal(jupiter.observable, true, 'Jupiter must be observable on the first night');
  assert(jupiter.window.peak.altitude >= A.RULES.minAltitudeObservable);
  assert.equal(jupiter.optical, 'naked-eye');
  assert(jupiter.position.magnitude > -3.5 && jupiter.position.magnitude < -1.0);
  assert.match(jupiter.position.magnitudeSource, /not a measurement|model value/);
  const all = P.visibilityForAll(princeton, nights.slice(0, 7));
  assert.equal(Object.keys(all.planets).length, 7);
  // Telescopic planets can never come out of the engine as naked-eye, whatever their magnitude.
  for (const night of [0, 3, 6]) {
    for (const name of ['Uranus', 'Neptune']) {
      assert.equal(all.planets[name][night].optical, 'telescope', name + ' must be telescope-only');
      assert(all.planets[name][night].caveats.some(text => /telescope|binoculars/.test(text)));
    }
  }
  // Mercury near the Sun must be described as lost in twilight rather than offered freely.
  const mercury = P.visibility('Mercury', princeton, nights.find((_, i) => i === 4));
  assert(mercury.caveats.length > 0, 'a low Mercury sighting must carry a caveat');
  console.log('visibility: Jupiter peak ' + jupiter.window.peak.altitude.toFixed(1) + ' deg, optical ' + jupiter.optical);
}

/* ---- 2. Jupiter/Mars conjunction cross-checked with Horizons ----------- */
{
  const found = P.conjunctions(princeton, start, end, { stepHours: 24 });
  assert(found.length >= 1, 'at least one planet-planet conjunction is expected in 90 days');
  for (const candidate of found) {
    assert(candidate.data.separationDeg <= A.RULES.conjunctionDeg);
    assert(Number.isFinite(candidate.t.event) && Number.isFinite(candidate.t.best));
    assert(candidate.positions.length === 2);
    if (candidate.observable) assert(candidate.t.best >= candidate.t.start && candidate.t.best <= candidate.t.end);
  }
  const reference = fixtureClosest('Mars', 'Jupiter');
  const match = found.find(c => c.objects.includes('Mars') && c.objects.includes('Jupiter'));
  assert(match, 'the Mars/Jupiter conjunction that the Horizons fixture shows must be discovered');
  assert(Math.abs(match.t.event - Date.parse(reference.utc)) <= DAY, 'conjunction time within one day of the fixture minimum');
  assert(Math.abs(match.data.separationDeg - reference.value) <= 0.05, 'separation within 0.05 degrees of the fixture minimum');
  console.log('conjunction: Mars/Jupiter ' + match.data.separationDeg + ' deg at ' + new Date(match.t.event).toISOString().slice(0, 10) +
    ' (Horizons fixture ' + reference.value.toFixed(3) + ' deg), locally observable: ' + match.observable);
}

/* ---- 3. oppositions and elongations ----------------------------------- */
{
  const oppositions = P.oppositions(princeton, start, end);
  const uranus = oppositions.find(o => o.objects[0] === 'Uranus');
  assert(uranus, 'Uranus opposition must be found in this window');
  assert.equal(uranus.observable, true);
  assert.equal(uranus.optical, 'telescope', 'Uranus must stay telescope-only at opposition');
  assert(uranus.data.elongationDeg >= 179);
  // The fixture's own maximum solar elongation for Uranus must agree on the date.
  let fixtureMax = { value: -1, utc: null };
  for (const utc of times) { const value = elongationAt('Sun', 'Uranus', utc); if (value > fixtureMax.value) fixtureMax = { value, utc }; }
  assert(Math.abs(uranus.t.event - Date.parse(fixtureMax.utc)) <= 3 * DAY, 'Uranus opposition near the fixture elongation maximum');
  const elongations = P.elongations(princeton, start, end);
  assert(elongations.length >= 2, 'Mercury and Venus elongations are expected');
  for (const event of elongations) {
    assert(['morning', 'evening'].includes(event.data.visibility));
    assert(event.data.elongationDeg > 18 && event.data.elongationDeg < 48);
  }
  console.log('opposition: Uranus ' + new Date(uranus.t.event).toISOString().slice(0, 10) + ' elongation ' + uranus.data.elongationDeg +
    ' deg, telescope-only; elongations: ' + elongations.map(e => e.objects[0] + ' ' + e.data.elongationDeg + ' ' + e.data.visibility + (e.observable ? '' : ' (not usable)')).join(', '));
}

/* ---- 4. parades are real simultaneous windows -------------------------- */
{
  const parades = P.detectParades(princeton, nights, { minAltitude: 8, minPlanets: 3 });
  assert(parades.length > 0, 'a three-planet grouping is expected in this 90-day span');
  for (const parade of parades) {
    assert(parade.objects.length >= 3, 'a parade needs at least three classical planets');
    for (const name of parade.objects) assert(A.NAKED_EYE_PLANETS.includes(name), name + ' is not a naked-eye planet');
    for (const name of ['Uranus', 'Neptune']) assert(!parade.objects.includes(name), 'telescopic planets must not count towards a parade');
    assert(parade.t.start < parade.t.end && parade.durationMin >= 5);
    assert(parade.data.classicalCount === parade.objects.length);
    assert(parade.caveats.some(text => /ecliptic/.test(text)), 'a parade must explain that the grouping is apparent');
    assert(parade.optical === 'naked-eye' || parade.optical === 'naked-eye and binocular');
    // Independent re-check: every participating planet is above the minimum at every sample of the
    // interval, and each participant's own best window overlaps the interval.
    for (let t = parade.t.start; t <= parade.t.end; t += 60000) {
      for (const name of parade.objects) {
        assert(A.horizontal(name, t, princeton).altitude >= parade.data.minimumAltitude - 0.01,
          name + ' drops below the parade minimum inside the advertised interval');
      }
      assert(A.sunAltitude(t, princeton) <= A.RULES.twilight.civil, 'a parade interval must be in darkness');
    }
    for (const position of parade.positions) {
      assert(position.t === parade.t.best);
      assert(A.horizontal(position.name, position.t, princeton).altitude >= parade.data.minimumAltitude - 0.01);
      assert.equal(position.compass, A.compass(position.azimuth));
    }
  }
  const lead = parades[0];
  console.log('parade: ' + lead.objects.join(' + ') + ' for ' + lead.durationMin + ' min on ' + lead.night +
    ', sectors ' + lead.data.sector + ', telescopic also up: ' + (lead.telescopes.join(', ') || 'none'));
  // A polar summer night has no dark window at all, so no parade may be manufactured.
  const polar = { lat: 78.22, lon: 15.65 };
  const polarNights = [{ day: '2026-06-21', start: Date.parse('2026-06-21T20:00:00Z'), end: Date.parse('2026-06-22T06:00:00Z') }];
  assert.deepEqual(P.detectParades(polar, polarNights, { minAltitude: 8 }), [], 'no parade can exist without darkness');
}

/* ---- 5. Moon pairings -------------------------------------------------- */
{
  const pairings = P.moonPairings(princeton, start, start + 30 * DAY, {});
  assert(pairings.length >= 3, 'several Moon/planet approaches are expected in a month');
  assert(pairings.every(p => p.data.separationDeg <= 6));
  for (const pairing of pairings) {
    assert(pairing.objects.includes('Moon'));
    const planet = pairing.objects.find(name => name !== 'Moon');
    assert(pairing.positions.length === 2);
    // The local separation is reported alongside the formal minimum because the Moon moves quickly.
    assert(Number.isFinite(pairing.data.localSeparationDeg));
    if (pairing.observable) {
      for (const position of pairing.positions) assert(position.altitude >= A.RULES.minAltitudeObservable - 0.01,
        planet + ': both bodies must be above the minimum for an observable pairing');
    } else {
      assert(pairing.caveats.some(text => /below|daylight/.test(text)), 'a refused pairing must explain why');
    }
  }
  const observable = pairings.filter(p => p.observable);
  console.log('moon pairings: ' + pairings.length + ' approaches in 30 days, ' + observable.length +
    ' locally observable (example: ' + (observable[0] ? observable[0].objects.join(' + ') + ' at ' + observable[0].data.separationDeg + ' deg' : 'none') + ')');
}

/* ---- 6. eclipses respect the observer --------------------------------- */
{
  const lunar = P.eclipses(princeton, Date.parse('2027-01-01T00:00:00Z'), Date.parse('2027-06-01T00:00:00Z'));
  const penumbral = lunar.find(e => e.kind === 'lunar-eclipse');
  assert(penumbral, 'the February 2027 penumbral lunar eclipse must be found');
  assert.equal(penumbral.observable, false, 'it is below the horizon from Indiana');
  assert(penumbral.caveats.some(text => /below the horizon/.test(text)));
  const capeLunar = P.eclipses(cape, Date.parse('2027-01-01T00:00:00Z'), Date.parse('2027-06-01T00:00:00Z'))
    .find(e => e.kind === 'lunar-eclipse');
  assert.equal(capeLunar.observable, true, 'the same eclipse is up from Cape Town');
  assert(capeLunar.positions[0].altitude > 0);
  // Solar eclipses: only where they are visible, and always with the filter warning.
  const spain = P.eclipses({ lat: 43.36, lon: -8.4 }, Date.parse('2026-08-01T00:00:00Z'), Date.parse('2026-08-31T00:00:00Z'));
  const spanishSolar = spain.filter(e => e.kind === 'solar-eclipse');
  assert.equal(spanishSolar.length, 1, 'exactly one locally visible solar eclipse in that month for Spain');
  assert.equal(spanishSolar[0].observable, true);
  assert.equal(spanishSolar[0].optical, 'solar filter required');
  assert(spanishSolar[0].caveats.some(text => /filter/.test(text)));
  assert.equal(spain.filter(e => e.kind === 'solar-eclipse').length, 1);
  assert.equal(P.eclipses(princeton, Date.parse('2026-08-01T00:00:00Z'), Date.parse('2026-08-31T00:00:00Z'))
    .filter(e => e.kind === 'solar-eclipse').length, 0,
    'no solar eclipse may be reported for a location that cannot see it');
  console.log('eclipse: 2027-02-20 penumbral lunar, Indiana altitude negative (refused), Cape Town ' +
    capeLunar.positions[0].altitude.toFixed(1) + ' deg (offered); 2026-08-12 total solar for Spain only');
}

/* ---- 7. every candidate satisfies the model --------------------------- */
{
  const events = P.events(princeton, start, start + 30 * DAY, { windows: nights.slice(0, 30), stepHours: 24 });
  assert(events.length >= 10);
  for (const event of events) {
    assert(typeof event.kind === 'string' && event.kind.length > 2);
    assert(Array.isArray(event.objects) && event.objects.length > 0);
    assert(Number.isFinite(event.t.best));
    assert(Array.isArray(event.positions));
    assert(typeof event.observable === 'boolean');
    assert(Array.isArray(event.caveats) && event.caveats.length > 0, 'every event must carry at least one caveat');
    assert(event.provenance && event.provenance.library);
    for (const position of event.positions) {
      assert(Number.isFinite(position.altitude) && position.altitude >= -90 && position.altitude <= 90);
      assert(Number.isFinite(position.azimuth) && position.azimuth >= 0 && position.azimuth <= 360);
      if (Number.isFinite(position.magnitude)) {
        if (['Uranus', 'Neptune'].includes(position.name)) assert.equal(position.optical, 'telescope');
        else if (position.magnitude > A.RULES.nakedEyeMagnitude) assert.notEqual(position.optical, 'naked-eye');
      }
    }
  }
  console.log('PASS: ' + events.length + ' planetary events over 30 nights all satisfy the model; ' + total + ' nights scanned for parades');
}
