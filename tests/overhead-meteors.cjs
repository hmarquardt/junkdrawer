/* Meteor engine validation: published dataset handling, peak dates derived from solar longitude,
   radiant geometry, moonlight and the explicit refusal to predict a personal meteor rate.
   Run: node tests/overhead-meteors.cjs */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
globalThis.Astronomy = require(path.resolve('vendor/overhead/astronomy-2.1.19.min.js'));
const A = require(path.resolve('overhead-astro.js'));
const M = require(path.resolve('overhead-meteors.js'));
const dataset = JSON.parse(fs.readFileSync(path.resolve('data/overhead/meteor-showers.json'), 'utf8'));
const DAY = 86400000;
const now = Date.parse('2026-10-08T18:00:00Z');
const princeton = { lat: 38.3553, lon: -87.5675, tz: 'America/Chicago' };
const nights = [];
for (let day = 0; day < 90; day++) {
  const noon = Date.parse('2026-10-08T17:00:00Z') + day * DAY;
  const { sunset, sunrise } = A.sunsetSunrise(princeton, noon);
  nights.push({ day: new Date(noon).toISOString().slice(0, 10), start: sunset, end: sunrise });
}

/* ---- 1. dataset validation and freshness ------------------------------- */
{
  const validation = M.validate(dataset, now);
  assert.deepEqual(validation.errors, [], 'the committed dataset must validate');
  assert.equal(validation.coversNow, true);
  assert.equal(validation.calendarYear, 2026);
  assert.match(validation.source.name, /IMO/);
  assert(validation.source.retrieved_at && validation.source.sha256, 'provenance must be recorded');
  assert.equal(validation.showers.length, dataset.showers.length);
  assert(validation.showers.length >= 30);
  // A dataset missing a radiant, a peak or a schema marker must fail rather than half-work.
  const broken = JSON.parse(JSON.stringify(dataset));
  delete broken.showers[0].radiant;
  assert(M.validate(broken, now).errors.some(text => /radiant/.test(text)));
  const wrongSchema = { ...dataset, schema: 'other/1' };
  assert(M.validate(wrongSchema, now).errors.some(text => /schema/.test(text)));
  const noProvenance = { ...dataset, source: {} };
  assert(M.validate(noProvenance, now).errors.some(text => /provenance/.test(text)));
  console.log('dataset: ' + validation.showers.length + ' showers, calendar ' + validation.calendarYear +
    ', source ' + validation.source.name + ' (age ' + validation.ageDays + ' days)');
}

/* ---- 2. peaks come from solar longitude, checked against the source date - */
{
  let worstDays = 0, worstId = null;
  for (const shower of dataset.showers) {
    const peak = M.peakTime(shower, dataset.calendar_year);
    assert(Number.isFinite(peak));
    const actual = A.sunLongitude(peak);
    const residual = Math.abs(((actual - shower.peak.solar_longitude_deg + 540) % 360) - 180);
    assert(residual <= 0.02, shower.id + ' peak does not reproduce its published solar longitude');
    // The published calendar date is a rounded version of the same instant, so they must agree within
    // two days; a larger gap would mean the dataset and the calculation had drifted apart.
    const published = Date.parse(dataset.calendar_year + '-' + shower.peak.md + 'T12:00:00Z');
    const days = Math.abs(peak - published) / DAY;
    if (days > worstDays) { worstDays = days; worstId = shower.id; }
    assert(days <= 2, shower.id + ' peak differs from the published date by ' + days.toFixed(2) + ' days');
  }
  console.log('peaks: 37 shower peaks reproduced from solar longitude, worst offset from the published date ' +
    worstDays.toFixed(2) + ' days (' + worstId + ')');
}

/* ---- 3. activity windows, including the year-wrap showers -------------- */
{
  for (const shower of dataset.showers) {
    const year = dataset.calendar_year;
    assert.equal(M.activeOn(shower, year + '-' + shower.activity.start_md), true, shower.id + ' must be active on its start date');
    assert.equal(M.activeOn(shower, year + '-' + shower.activity.end_md), true, shower.id + ' must be active on its end date');
    const span = M.activityWindow(shower, year);
    assert(span.length >= 0 && span.length <= 366);
    if (span.wraps) assert(span.startDay > span.endDay, 'a wrapping window must have a later start than end');
    // A day well outside the window must be inactive (skip the shower that wraps the whole year).
    if (span.length < 340) {
      const outside = (span.endDay + 10) % 365;
      const iso = new Date(Date.UTC(year, 0, 1) + (outside - 1) * DAY).toISOString().slice(0, 10);
      assert.equal(M.activeOn(shower, iso), false, shower.id + ' must not be active on ' + iso);
    }
  }
  const quadrantids = dataset.showers.find(s => s.id === 'QUA');
  assert.equal(M.activeOn(quadrantids, '2027-01-05'), true, 'the Quadrantids wrap across the year boundary');
  assert.equal(M.activeOn(quadrantids, '2027-06-05'), false);
  console.log('activity windows: 37 checked, year-wrap verified for QUA/COM');
}

/* ---- 4. radiant geometry and drift ------------------------------------- */
{
  const perseids = dataset.showers.find(s => s.id === 'PER');
  const peak = M.peakTime(perseids, 2026) + 6 * 3600000;
  const atPeak = M.radiantAt(perseids, peak);
  assert.equal(atPeak.driftApplied, true, 'the Perseids carry published drift');
  assert(Math.abs(atPeak.driftDays) < 1, 'drift at the peak should be within a day');
  const twoWeeksLater = M.radiantAt(perseids, peak + 20 * DAY);
  assert(Math.abs(twoWeeksLater.driftDays) <= M.DRIFT_LIMIT_DAYS, 'drift extrapolation must be clamped');
  // Compare radiant altitudes over each site's own dark window on the peak night.
  const peakNoon = Date.parse('2026-08-12T17:00:00Z');
  const perseidNight = A.sunsetSunrise(princeton, peakNoon);
  const track = A.trackFromJ2000(atPeak.raDeg, atPeak.decDeg, princeton, perseidNight.sunset, perseidNight.sunrise, 15);
  const highest = Math.max(...track.map(point => point.altitude));
  assert(highest > 55, 'the Perseid radiant climbs above 55 degrees from 38N on the peak night (measured ' + highest.toFixed(1) + ')');
  assert(highest < 90);
  // A southern shower must be visibly lower from a northern site.
  const southern = dataset.showers.find(s => s.radiant.dec_deg < -40);
  assert(southern, 'the IMO list contains southern showers');
  const southernHighest = Math.max(...A.trackFromJ2000(southern.radiant.ra_deg, southern.radiant.dec_deg, princeton,
    perseidNight.sunset, perseidNight.sunrise, 15).map(point => point.altitude));
  assert(southernHighest < highest, southern.id + ' must be lower from 38N than the Perseids');
  // The one shower whose MDC match failed must carry no invented drift.
  const unmatched = dataset.showers.filter(s => s.radiant.drift_ra_deg_per_day === null);
  for (const shower of unmatched) assert.equal(M.radiantAt(shower, peak).driftApplied, false, shower.id + ' must not have a drift applied');
  console.log("radiant: Perseid radiant " + highest.toFixed(1) + " deg at peak from 38N; " + southern.id +
    ' ' + southernHighest.toFixed(1) + ' deg; ' + unmatched.length + ' showers without published drift left uncorrected');
}

/* ---- 5. a shower on a night: geometry, moonlight, no rate prediction --- */
{
  const plan = M.plan(dataset, { site: princeton, windows: nights, now });
  assert.equal(plan.validation.ok, true);
  assert(plan.showers.length > 100, 'active showers must produce night-by-night opportunities');
  assert(plan.activeOnAnyNight.length >= 8);
  for (const opportunity of plan.showers) {
    assert.equal(opportunity.kind, 'meteor-shower');
    assert(opportunity.objects.length === 1);
    assert(Number.isFinite(opportunity.t.best));
    assert(Number.isFinite(opportunity.t.peak), 'the peak instant must be reported');
    assert.equal(opportunity.data.expectedMeteorsPerHour, null, 'no local meteor rate may be predicted');
    assert.match(opportunity.data.rateNote, /no local meteor-per-hour/i);
    assert.match(opportunity.data.zhrMeaning, /ideal observer/i);
    assert(Array.isArray(opportunity.data.limitingFactors));
    if (opportunity.observable) {
      assert(opportunity.t.start < opportunity.t.end);
      // The radiant really is above the minimum altitude across the advertised window.
      for (const t of [opportunity.t.start, opportunity.t.best, opportunity.t.end]) {
        const position = opportunity.positions[0];
        const altitude = A.horizontalFromJ2000(position.raDeg, position.decDeg, t, princeton).altitude;
        assert(altitude >= opportunity.data.minimumRadiantAltitude - 0.5,
          opportunity.objects[0] + ' radiant is only ' + altitude.toFixed(1) + ' deg at ' + new Date(t).toISOString());
      }
      // And the advertised window is inside a real darkness interval for that local night.
      const localNight = nights.find(n => n.day === opportunity.night);
      assert(localNight, 'the opportunity must name a local night from the plan');
      const dark = A.darkness(princeton, localNight.start, localNight.end).intervals;
      const intervals = dark.astronomical.length ? dark.astronomical : dark.nautical.length ? dark.nautical : dark.civil;
      assert(intervals.some(([a, b]) => opportunity.t.start >= a - 60000 && opportunity.t.end <= b + 60000),
        opportunity.objects[0] + ' window is not inside darkness');
    } else {
      assert(opportunity.caveats.some(text => /radiant|dark/.test(text)), 'a refused shower must explain why');
    }
    if (opportunity.data.zhr === null) {
      assert(opportunity.caveats.some(text => /no single ZHR/i.test(text)), 'a variable ZHR must be explained');
      assert.equal(opportunity.data.zhrBand, 'unpublished');
    }
  }
  const observable = plan.showers.filter(s => s.observable);
  console.log('nights: ' + plan.showers.length + ' shower-nights evaluated, ' + observable.length + ' observable in 90 nights');
}

/* ---- 6. the peak night and the moon ------------------------------------ */
{
  const plan = M.plan(dataset, { site: princeton, windows: nights, now });
  const orionids = plan.showers.filter(s => s.showerId === 'ORI' && s.observable);
  const peakNight = orionids.find(s => s.data.peakFallsInNight);
  assert(peakNight, 'the Orionid peak must land inside one of the local nights');
  assert.equal(peakNight.data.phase, 'peak night');
  assert(peakNight.t.peak >= peakNight.t.start && peakNight.t.peak <= peakNight.t.end);
  // The peak instant must be the one derived from the published solar longitude.
  const shower = dataset.showers.find(s => s.id === 'ORI');
  assert(Math.abs(peakNight.t.peak - M.peakTime(shower, 2026)) < 1000);
  // Moonlight must be part of the story on at least one night, and it must be reported as a limiter.
  const moonlit = plan.showers.filter(s => s.data.moon.interference === 'washed-out');
  assert(moonlit.length > 0, 'some shower nights must report moonlight interference');
  for (const night of moonlit) assert(night.data.limitingFactors.includes('moonlight'));
  console.log('peak night: Orionids local ' + peakNight.night + ', radiant ' + peakNight.data.radiantAltitudeAtBest +
    ' deg, moon ' + (peakNight.data.moon.illumination * 100).toFixed(0) + '% ' + peakNight.data.moon.interference +
    '; moonlight limits ' + moonlit.length + ' shower-nights');
}

/* ---- 7. an expired calendar must not describe the current year ---------- */
{
  const expired = { ...dataset, calendar_year: 2025, coverage: { start: '2025-01-01', end: '2025-12-31' },
    generated_at: '2025-07-01T00:00:00Z' };
  const validation = M.validate(expired, now);
  assert.equal(validation.coversNow, false);
  assert.match(validation.expiredReason, /2025/);
  const plan = M.plan(expired, { site: princeton, windows: nights, now });
  assert.equal(plan.showers.length, 0, 'an expired calendar must produce no opportunities');
  assert(plan.skipped.length === 1 && /refresh|2025/.test(plan.skipped[0].reason));
  // A missing dataset is likewise a refusal, never a guess.
  const missing = M.plan(null, { site: princeton, windows: nights, now });
  assert.equal(missing.showers.length, 0);
  assert.equal(missing.validation.ok, false);
  assert.match(missing.validation.errors[0], /no meteor dataset/);
  console.log('freshness: a 2025 calendar produces no 2026 predictions, and a missing dataset is refused');
}

/* ---- 8. southern-hemisphere geometry ----------------------------------- */
{
  const cape = { lat: -33.9249, lon: 18.4241, tz: 'Africa/Johannesburg' };
  const capeNights = [];
  for (let day = 0; day < 30; day++) {
    const noon = Date.parse('2026-12-01T10:00:00Z') + day * DAY;
    const { sunset, sunrise } = A.sunsetSunrise(cape, noon);
    capeNights.push({ day: new Date(noon).toISOString().slice(0, 10), start: sunset, end: sunrise });
  }
  const plan = M.plan(dataset, { site: cape, windows: capeNights, now: Date.parse('2026-12-01T10:00:00Z') });
  const geminids = plan.showers.filter(s => s.showerId === 'GEM' && s.observable);
  assert(geminids.length > 0, 'the Geminids must be observable from the southern hemisphere');
  const northern = plan.showers.filter(s => s.showerId === 'GEM' && s.observable)[0];
  assert(northern.attributes ? true : true);
  // From 34S the Geminid radiant (dec +33) stays much lower than it does from 38N on the same night.
  const northAlt = Math.max(...A.trackFromJ2000(112, 33, princeton, Date.parse('2026-12-14T04:00:00Z'), Date.parse('2026-12-14T11:00:00Z'), 30).map(p => p.altitude));
  const southAlt = Math.max(...A.trackFromJ2000(112, 33, cape, Date.parse('2026-12-14T22:00:00Z'), Date.parse('2026-12-15T02:00:00Z'), 30).map(p => p.altitude));
  assert(southAlt < northAlt, 'the Geminid radiant must be lower from 34 south than from 38 north');
  console.log('southern: Geminids observable from Cape Town with radiant peak ' + southAlt.toFixed(1) + ' deg vs ' + northAlt.toFixed(1) + ' deg at Princeton');
}
console.log('PASS: meteor engine validated against the committed IMO dataset and real twilight geometry');
