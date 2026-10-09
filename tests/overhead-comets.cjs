/* Comet engine validation against real catalog data and real JPL Horizons ephemerides.
   Two independent position paths are compared: the published Horizons samples that the pipeline
   fetched, and the browser-side two-body Kepler propagation of the published orbital elements.
   Run: node tests/overhead-comets.cjs */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
globalThis.Astronomy = require(path.resolve('vendor/overhead/astronomy-2.1.19.min.js'));
const A = require(path.resolve('overhead-astro.js'));
const C = require(path.resolve('overhead-comets.js'));
const catalog = JSON.parse(fs.readFileSync(path.resolve('data/overhead/comets.json'), 'utf8'));
const ephemeris = JSON.parse(fs.readFileSync(path.resolve('data/overhead/comet-ephemerides.json'), 'utf8'));
const now = Date.parse('2026-10-09T00:00:00Z');
const princeton = { lat: 38.3553, lon: -87.5675, tz: 'America/Chicago' };
const DAY = 86400000;

/* ---- 1. artifact validation -------------------------------------------- */
const validation = C.validateCatalog(catalog, now);
const ephemerisValidation = C.validateEphemeris(ephemeris, validation, now);
assert.deepEqual(validation.errors, [], 'the committed comet catalog must validate');
assert.deepEqual(ephemerisValidation.errors, [], 'the committed ephemeris artifact must validate');
assert(validation.comets.length >= 3, 'at least three comets must be published');
assert(validation.sources.elements.sha256 && validation.sources.elements.retrieved_at, 'element provenance must be recorded');
assert(validation.sources.ephemeris.parameters, 'the exact Horizons query parameters must be recorded');
assert.match(ephemeris.source.name, /Horizons/);
const identifiers = new Set(validation.comets.map(comet => comet.id));
assert.equal(identifiers.size, validation.comets.length, 'comet identifiers must be unique');
for (const comet of validation.comets) {
  assert(Number.isFinite(C.num(comet.elements.e)) && C.num(comet.elements.e) >= 0 && C.num(comet.elements.e) <= 5);
  assert(C.num(comet.elements.q) > 0);
  assert(C.num(comet.elements.i) >= 0 && C.num(comet.elements.i) <= 180);
  assert(comet.brightness && comet.brightness.absolute, comet.id + ' must carry magnitude parameters');
  assert(!comet.brightness.predicted || comet.brightness.predicted.caveat, 'a prediction must carry its caveat');
}
// Malformed inputs must be refused rather than half-shown.
const brokenA = JSON.parse(JSON.stringify(catalog)); delete brokenA.sources.ephemeris;
assert(C.validateCatalog(brokenA, now).errors.some(text => /provenance/.test(text)));
const brokenB = JSON.parse(JSON.stringify(catalog)); brokenB.comets[0].elements.e = 'not-a-number';
assert(C.validateCatalog(brokenB, now).errors.some(text => /eccentricity/.test(text)));
const brokenC = JSON.parse(JSON.stringify(ephemeris)); brokenC.comets[validation.comets[0].id].points.reverse();
assert(C.validateEphemeris(brokenC, validation, now).errors.some(text => /increasing/.test(text)));
console.log('artifacts: ' + validation.comets.length + ' comets, catalog ' + validation.ageDays + ' days old, ephemeris covering ' +
  Object.values(ephemerisValidation.comets).reduce((sum, entry) => sum + entry.count, 0) + ' Horizons samples; malformed artifacts refused');

/* ---- 2. propagator vs the published Horizons ephemeris ----------------- */
{
  // The published samples are genuine Horizons output, so comparing the browser propagator with them
  // is a real external check. The bound depends on how far the instant is from the element epoch,
  // because two-body propagation cannot model planetary perturbations or non-gravitational forces.
  const measured = [], unreliable = [];
  for (const comet of validation.comets) {
    const entry = ephemerisValidation.comets[comet.id];
    const epoch = Date.parse(comet.elements.epoch_iso);
    const daysFromEpoch = Math.abs(entry.points[0].t - epoch) / DAY;
    let worst = { arcmin: 0, days: 0, utc: null };
    for (const point of entry.points) {
      const propagated = C.positionFromElements(comet, point.t);
      const separation = A.separation(propagated.raDeg, propagated.decDeg, point.raDeg, point.decDeg) * 60;
      const days = Math.abs(point.t - epoch) / DAY;
      if (separation > worst.arcmin) worst = { arcmin: separation, days, utc: new Date(point.t).toISOString() };
      // Comets whose published elements are years old are exactly the case two-body propagation cannot
      // handle. The engine grades them 'kepler-unreliable' and the interface says the position is
      // approximate; the test only requires that the grade is right and the disagreement is recorded,
      // never hidden. Everything closer to the epoch is held to the documented tolerance.
      if (days <= 400) assert(separation <= 15, comet.id + ' differs from Horizons by ' + separation.toFixed(2) + ' arcmin at ' + days.toFixed(0) + ' days (limit 15)');
      else if (days <= 800) assert(separation <= 60, comet.id + ' differs by ' + separation.toFixed(2) + ' arcmin at ' + days.toFixed(0) + ' days (limit 60)');
    }
    const grade = C.positionFromElements(comet, now).grade;
    if (daysFromEpoch > 800) {
      assert.equal(grade, 'kepler-unreliable', comet.id + ' must be graded unreliable ' + daysFromEpoch.toFixed(0) + ' days from its epoch');
      unreliable.push({ id: comet.id, days: daysFromEpoch, worst: worst.arcmin });
    } else {
      measured.push({ id: comet.id, worst: worst.arcmin, days: worst.days, samples: entry.count, grade });
    }
  }
  assert(measured.length >= 3, 'at least three comets must have elements close enough to their ephemeris for a real comparison');
  const worst = measured.reduce((a, b) => (b.worst > a.worst ? b : a));
  const best = measured.reduce((a, b) => (b.worst < a.worst ? b : a));
  console.log('propagation vs Horizons: ' + measured.length + ' comparable comets, worst ' + worst.worst.toFixed(2) +
    ' arcmin (' + worst.id + ' at ' + worst.days.toFixed(0) + ' days from epoch), best ' + best.worst.toFixed(2) + ' arcmin (' + best.id + ')');
  if (unreliable.length) console.log('propagation refused as approximate: ' + unreliable.map(entry => entry.id + ' at ' +
    entry.days.toFixed(0) + ' days (' + entry.worst.toFixed(0) + ' arcmin). ' ).join('') + 'each is labelled in the interface');
  assert(measured.some(entry => entry.worst < 2), 'at least one comet must agree with Horizons to better than 2 arcminutes');
}

/* ---- 3. published ephemeris interpolation ----------------------------- */
{
  // Independent error estimate for the interpolation: a five-point Lagrange polynomial through the
  // surrounding samples is a higher-order reconstruction of the same data, so the gap between it and
  // the engine's four-point cubic bounds the interpolation error without needing a second data source.
  const lagrange = (points, tMs) => {
    const reference = points[points.length >> 1].raDeg;
    const unwrap = value => value + Math.round((reference - value) / 360) * 360;
    const value = key => {
      let total = 0;
      for (let i = 0; i < points.length; i++) {
        let term = key === 'raDeg' ? unwrap(points[i].raDeg) : points[i].decDeg;
        for (let j = 0; j < points.length; j++) if (j !== i) term *= (tMs - points[j].t) / (points[i].t - points[j].t);
        total += term;
      }
      return total;
    };
    return { raDeg: ((value('raDeg') % 360) + 360) % 360, decDeg: value('decDeg') };
  };
  let worstCurvature = 0, worstCurvatureId = null, worstError = 0, worstErrorId = null;
  let nodes = 0, midpoints = 0, worstPropagation = 0, worstPropagationId = null;
  for (const comet of validation.comets) {
    const entry = ephemerisValidation.comets[comet.id];
    const points = entry.points;
    const trusted = ['kepler-close', 'kepler-degraded'].includes(C.positionFromElements(comet, points[0].t).grade);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      // Exact at the sample instants: the published samples are reproduced, never smoothed away.
      const exact = C.positionFromEphemeris(entry, a.t);
      assert(Math.abs(exact.raDeg - a.raDeg) < 1e-6 && Math.abs(exact.decDeg - a.decDeg) < 1e-6);
      // How curved the published track is: this bounds what a LINEAR interpolation between 48-hour
      // samples could have been wrong by (about a quarter of this value). It is reported, not asserted,
      // except as a sanity bound that would catch a corrupted sample sequence.
      if (i > 0) {
        const previous = points[i - 1];
        const chord = A.midpointDirection(previous.raDeg, previous.decDeg, b.raDeg, b.decDeg);
        const curvature = A.separation(a.raDeg, a.decDeg, chord.raDeg, chord.decDeg) * 60;
        nodes++;
        if (curvature > worstCurvature) { worstCurvature = curvature; worstCurvatureId = comet.id; }
        assert(curvature <= 120, comet.id + ' sample sequence is discontinuous: ' + curvature.toFixed(2) + ' arcmin');
      }
      // Interpolation error, measured against a higher-order reconstruction of the same samples where
      // five neighbours are available.
      if (i > 1 && i < points.length - 3) {
        const window = points.slice(i - 2, i + 3);
        const middle = (a.t + b.t) / 2;
        const higher = lagrange(window, middle), cubic = C.positionFromEphemeris(entry, middle);
        const error = A.separation(higher.raDeg, higher.decDeg, cubic.raDeg, cubic.decDeg) * 60;
        if (error > worstError) { worstError = error; worstErrorId = comet.id; }
        assert(error <= 2, comet.id + ' interpolation error ' + error.toFixed(2) + ' arcmin against a five-point reconstruction');
      }
      // Where the local propagation is trustworthy it is a fully independent check. The bound here is the
      // propagation's own measured error, because the propagation is the weaker of the two paths.
      if (trusted) {
        const middle = (a.t + b.t) / 2;
        const interpolated = C.positionFromEphemeris(entry, middle);
        const propagated = C.positionFromElements(comet, middle);
        const separation = A.separation(interpolated.raDeg, interpolated.decDeg, propagated.raDeg, propagated.decDeg) * 60;
        midpoints++;
        if (separation > worstPropagation) { worstPropagation = separation; worstPropagationId = comet.id; }
        assert(separation <= 60, comet.id + ' interpolation disagrees with trusted propagation by ' + separation.toFixed(1) + ' arcmin');
      }
    }
    assert.equal(C.positionFromEphemeris(entry, points[0].t - DAY), null, comet.id + ' must not extrapolate before the window');
    assert.equal(C.positionFromEphemeris(entry, points[points.length - 1].t + DAY), null, comet.id + ' must not extrapolate past the window');
  }
  console.log('interpolation: exact at ' + nodes + ' sample instants; measured error at ' + (nodes - 2) + ' midpoints is at most ' +
    worstError.toFixed(2) + ' arcmin (' + worstErrorId + '), while the 48-hour node curvature of ' + worstCurvature.toFixed(1) +
    ' arcmin (' + worstCurvatureId + ') would have cost a linear interpolation about ' + (worstCurvature / 4).toFixed(2) + ' arcmin');
  console.log('  ' + midpoints + ' midpoints also cross-checked against trusted two-body propagation, worst ' + worstPropagation.toFixed(2) + ' arcmin (' + worstPropagationId + ')');
}

/* ---- 4. independent fixture: elements and dates the artifact does not use -- */
{
  const fixturePath = path.resolve('tests/fixtures/overhead/horizons-comets.json');
  assert(fs.existsSync(fixturePath), 'the independent Horizons comet fixture must be committed');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.equal(fixture.schema, 'junkdrawer.overhead.comets-fixture/1');
  assert(fixture.comets.length >= 3, 'the fixture must cover at least three comets');
  const classes = new Set(fixture.comets.map(entry => entry.orbit_class || entry.kind));
  assert(classes.size >= 2, 'the fixture must span more than one orbit class');
  let worstFixture = 0, worstFixtureId = null, samples = 0, crossChecked = 0, worstDivergence = 0;
  for (const entry of fixture.comets) {
    assert(entry.samples.length >= 4, entry.id + ' must have at least four Horizons samples');
    for (const sample of entry.samples) {
      assert(/^[0-9a-f]{64}$/.test(sample.horizons_sha256 || entry.sbdb_api.sha256 || ''), entry.id + ' sample must record a sha256');
      assert(Number.isFinite(sample.ra_deg) && sample.ra_deg >= 0 && sample.ra_deg < 360);
      assert(Number.isFinite(sample.dec_deg) && Math.abs(sample.dec_deg) <= 90);
      assert(sample.r_au > 0 && sample.delta_au > 0);
    }
    const epoch = Date.parse(entry.element_epoch_iso);
    const offsets = entry.samples.map(sample => Math.abs(Date.parse(sample.utc) - epoch) / DAY);
    assert(Math.min(...offsets) <= 200, entry.id + ' needs a sample within 200 days of its element epoch');
    assert(Math.max(...offsets) >= 300, entry.id + ' needs a sample far from its element epoch');
    // The engine is given the fixture's own elements, so this is a genuine independent comparison.
    const comet = { id: entry.id, name: entry.name, elements: { e: entry.elements.e, a: entry.elements.a, q: entry.elements.q,
      i: entry.elements.i, om: entry.elements.om, w: entry.elements.w, tp: entry.tp_jd, epoch: entry.element_epoch_jd,
      epoch_iso: entry.element_epoch_iso } };
    for (const sample of entry.samples) {
      const t = Date.parse(sample.utc);
      const engine = C.positionFromElements(comet, t);
      const separation = A.separation(engine.raDeg, engine.decDeg, sample.ra_deg, sample.dec_deg) * 60;
      const days = Math.abs(t - epoch) / DAY;
      samples++;
      if (separation > worstFixture) { worstFixture = separation; worstFixtureId = entry.id; }
      const limit = days <= 400 ? 15 : days <= 800 ? 60 : 240;
      assert(separation <= limit, entry.id + ' differs from the fixture by ' + separation.toFixed(2) + ' arcmin at ' + days.toFixed(0) + ' days');
      // Cross-implementation check: the pipeline's own Python propagation of the same elements must
      // agree with the browser implementation to well inside the measurement noise.
      const recorded = (entry.propagator_check && entry.propagator_check.samples || []).find(row => row.utc === sample.utc);
      if (recorded) {
        const divergence = A.separation(engine.raDeg, engine.decDeg, recorded.ra_deg, recorded.dec_deg) * 60;
        worstDivergence = Math.max(worstDivergence, divergence);
        crossChecked++;
        assert(divergence <= 2, entry.id + ' browser and pipeline propagators diverge by ' + divergence.toFixed(2) + ' arcmin');
        assert(Math.abs(engine.distanceAu - recorded.delta_au) <= 0.002, entry.id + ' distance diverges from the pipeline propagator');
      }
    }
  }
  // The fixture and the published artifact must agree wherever they cover the same instant.
  let pairs = 0, worstPair = 0;
  for (const pair of (fixture.cross_check && fixture.cross_check.pairs) || []) {
    const catalogEntry = validation.comets.find(comet => comet.id === pair.comet);
    const ephemerisEntry = catalogEntry && ephemerisValidation.comets[catalogEntry.id];
    if (!catalogEntry || !ephemerisEntry) continue;
    const t = Date.parse(pair.t_iso);
    const fromArtifact = C.positionFromEphemeris(ephemerisEntry, t);
    if (!fromArtifact) continue;
    const fixtureSample = (fixture.comets.find(entry => entry.id === pair.comet).samples || []).find(sample => sample.utc === pair.t_iso);
    if (!fixtureSample) continue;
    const separation = A.separation(fromArtifact.raDeg, fromArtifact.decDeg, fixtureSample.ra_deg, fixtureSample.dec_deg);
    worstPair = Math.max(worstPair, separation);
    pairs++;
    const tolerance = (fixture.cross_check.tolerance && fixture.cross_check.tolerance.ra_deg) || 0.01;
    assert(separation <= tolerance, pair.comet + ' artifact and fixture disagree by ' + separation.toFixed(4) + ' deg');
    assert(Math.abs(fromArtifact.distanceAu - fixtureSample.delta_au) <= ((fixture.cross_check.tolerance && fixture.cross_check.tolerance.delta_au) || 0.001));
  }
  console.log('independent fixture: ' + samples + ' Horizons samples across ' + fixture.comets.length + ' comets and ' + classes.size +
    ' orbit classes, worst ' + worstFixture.toFixed(2) + ' arcmin (' + worstFixtureId + '); ' + crossChecked +
    ' instants cross-checked against the pipeline propagator, worst divergence ' + worstDivergence.toFixed(3) + ' arcmin');
  if (pairs) console.log('  ' + pairs + ' artifact/fixture overlap pair(s) agree within the documented tolerance (worst ' + worstPair.toFixed(5) + ' deg)');

  // Brightness provenance: every measured value in the artifact must be explained by the raw COBS
  // payload for the same observation class (visual or CCD). A payload with no rows must correspond to
  // an artifact that reports no measurement of that class - never a value that appeared from nowhere.
  let explained = 0, absent = 0;
  for (const sample of fixture.cobs_samples || []) {
    const catalogEntry = validation.comets.find(comet => comet.id === sample.comet);
    if (!catalogEntry) continue;
    const measured = catalogEntry.brightness && catalogEntry.brightness.measured;
    const className = sample.obs_type === 'C' ? 'ccd' : 'visual';
    const rows = (sample.payload && sample.payload.objects) || [];
    if (!rows.length) {
      const count = measured && measured.count ? measured.count[className] : 0;
      assert(!count, sample.comet + ' reports ' + count + ' ' + className + ' observation(s) although the raw payload is empty');
      if (measured && measured.latest) assert.notEqual(String(measured.latest.method || '').toLowerCase(), className, sample.comet + ' latest measurement class contradicts the empty payload');
      absent++;
      continue;
    }
    // COBS timestamps are UTC but are published without a zone suffix, so they are parsed as UTC
    // explicitly rather than with the test runner's local offset.
    const asUtc = value => Date.parse(String(value).replace(' ', 'T') + 'Z');
    const latest = rows.map(row => ({ magnitude: Number(row.magnitude), date: row.obs_date }))
      .sort((a, b) => asUtc(b.date) - asUtc(a.date))[0];
    assert(measured && measured.count && measured.count[className] >= rows.length,
      sample.comet + ' count for ' + className + ' does not cover the raw payload');
    const artifactLatest = measured.latest && String(measured.latest.method || '').toLowerCase() === className ? measured.latest : null;
    assert(artifactLatest, sample.comet + ' must report the ' + className + ' measurement the payload contains');
    assert(Math.abs(artifactLatest.magnitude - latest.magnitude) < 0.001, sample.comet + ' magnitude does not match the raw COBS payload');
    assert(Math.abs(Date.parse(artifactLatest.date) - asUtc(latest.date)) < 60000, sample.comet + ' observation date does not match the raw payload');
    explained++;
  }
  console.log('  brightness provenance: ' + explained + ' measured value(s) verified against raw COBS payloads, ' + absent + ' empty payload(s) confirmed to produce no measured value');
}
