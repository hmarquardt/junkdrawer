#!/usr/bin/env python3
"""Build data/overhead/comets.json + data/overhead/comet-ephemerides.json for Overhead.

Three real retrievals feed this pipeline.  Every value that reaches the artifacts comes from one
of them; nothing is inferred, interpolated or copied between objects, and each retrieval is
recorded with its URL, timestamp and SHA-256 of the raw response bytes.

  * NASA/JPL Small-Body Database **query** API (https://ssd-api.jpl.nasa.gov/sbdb_query.api).
    One request returns every comet in the SBDB, sorted by ``-last_obs``; the rows are filtered in
    Python to objects whose ``last_obs`` falls inside the freshness window (``--sbdb-window-days``)
    because the SBDB filter language rejects ``last_obs``.  ``m1``/``k1`` are *invalid* field names
    for this endpoint (HTTP 400); the total absolute magnitude and its slope are ``M1``/``K1``.
  * NASA/JPL **Horizons** API (https://ssd.jpl.nasa.gov/api/horizons.api).  One ``OBSERVER``
    ephemeris per published comet, geocentric (``CENTER='500@399'``), ``QUANTITIES='1,19,20'``
    (astrometric RA/Dec, heliocentric r/rdot, observer delta/deldot).  The ``;CAP`` suffix on
    ``COMMAND='DES=<designation>;CAP'`` is required: a bare ``DES=2P`` triggers a record-index
    search instead of an ephemeris, and ``COMMAND='2P'`` fails with "Missing operator".  A
    designation Horizons cannot resolve uniquely (verified: ``DES=2023 R1;CAP`` matches both the
    comet and its fragment) is retried once as ``DES=<SPK-ID>;CAP``, which is recorded per comet in
    ``provenance.ephemeris_command``.

    ``--step-hours`` is the requested *maximum* sampling interval.  The browser interpolates these
    samples linearly, so each comet gets the coarsest step from ``STEP_CHOICES_HOURS`` whose
    predicted worst mid-way deviation stays inside ``INTERPOLATION_MAX_DEG`` (0.02 deg), estimated
    from the local geometry before the request and re-measured afterwards; the measured value is
    published per comet as ``interpolation_max_deviation_deg``.  With a 48 h step the measured
    deviation reached 0.55 deg for a comet near perihelion, which is why the step adapts.
  * COBS - Comet Observation Database (https://cobs.si/api/obs_list.api).  Visual (``obs_type=V``)
    and CCD/CMOS (``obs_type=C``) observations of the last 120 days, requested separately and
    never merged into one number without recording which methods contributed.

Candidate ranking is done locally (no extra network calls) with the IAU total-magnitude model

    m1 = M1 + 5*log10(delta) + K1*log10(r)

evaluated over the horizon at the point where the object is predicted brightest, with r and delta
from a two-body Kepler propagation of the published SBDB elements (elliptical, parabolic and
hyperbolic cases: Newton iteration on Kepler's equation, Newton on the hyperbolic Kepler equation,
Newton on Barker's equation).  **Uncertainty of that model**: measured against Horizons for
2P/Encke from the SBDB elements of epoch JD 2460147.5, the two-body geocentric position was
0.16-0.65 arcmin from Horizons 78-798 days after the epoch and 4.3 arcmin at +1174 days (the drift
is the missing non-gravitational acceleration and planetary perturbations).  It is used for
*ranking* and for the published ``predicted`` magnitude only, where 1 arcmin of geometry is
irrelevant (0.1% in delta = 0.002 mag); every position shown by the browser comes from the Horizons
samples, never from this propagation.  Heliocentric distances r agree with Horizons to 1e-4 au
(<1e-3 au) over the same span, i.e. below 0.005 mag in the model above.

Earth's heliocentric position (needed for delta) comes from the JPL/Standish "Approximate Positions
of the Planets" Table 1 (EM Barycenter, valid 1800-2050), fetched from
https://ssd.jpl.nasa.gov/planets/approx_pos.html on 2026-10-08 (HTTP 200, 29585 bytes, sha256
9f7b30ca81cc548a879565bb3f70e6899a38ff5877cb1ff16bb04892f9c4d742).  That page states nominal
errors for EM Bary of 20 arcsec in heliocentric longitude, 8 arcsec in latitude and 6000 km in
distance over 1800-2050.  The elements in EARTH_MODEL are copied verbatim from that page's Table 1
and were checked against a Horizons VECTORS ephemeris of body 399 at JD 2460225.5: the positions
differ by 5580 km (3.7e-5 au), consistent with the stated accuracy plus the Earth/Moon-barycentre
offset (up to 4700 km).  This is the only physical constant table hard-coded in this file.

Modes
    python3 tools/overhead_comets_build.py                 # retrieve, rank, publish both artifacts
    python3 tools/overhead_comets_build.py --check         # validate the committed artifacts
    python3 tools/overhead_comets_build.py --no-network    # revalidate + re-derive an existing pair
    python3 tools/overhead_comets_build.py --build-fixture # refresh the offline test fixture

The build refuses to publish unless every documented invariant holds (see validate_artifact), and
both artifacts are written atomically (temp file + os.replace) so a failure never leaves a partial
file behind; on failure the previously committed artifacts are left untouched.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import statistics
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

SCHEMA = 'junkdrawer.overhead.comets/1'
EPHEMERIS_SCHEMA = 'junkdrawer.overhead.comets-ephemeris/1'
FIXTURE_SCHEMA = 'junkdrawer.overhead.comets-fixture/1'

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / 'data/overhead/comets.json'
DEFAULT_EPHEMERIS_OUT = ROOT / 'data/overhead/comet-ephemerides.json'
DEFAULT_FIXTURE = ROOT / 'tests/fixtures/overhead/horizons-comets.json'

SBDB_QUERY_URL = 'https://ssd-api.jpl.nasa.gov/sbdb_query.api'
SBDB_OBJECT_URL = 'https://ssd-api.jpl.nasa.gov/sbdb.api'
HORIZONS_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api'
COBS_OBS_URL = 'https://cobs.si/api/obs_list.api'
COBS_LIST_URL = 'https://cobs.si/api/comet_list.api'

USER_AGENT = 'junkdrawer-overhead-comets-build/1.0 (+https://github.com/hmarquardt/junkdrawer)'

# Comet row fields that actually exist on sbdb_query.api.  `m1`/`k1` do NOT: they answer HTTP 400.
SBDB_FIELDS = ('full_name,pdes,spkid,kind,e,a,q,i,om,w,tp,epoch,per,M1,K1,'
               'first_obs,last_obs,n_obs_used,equinox,orbit_id,soln_date,condition_code,rms,'
               'data_arc')
# `not_valid_before`/`not_valid_after` exist on sbdb.api but are NOT valid sbdb_query fields
# (HTTP 400 "invalid field specified"), so no solution-validity window is published here.
SBDB_QUERY_BASE = {'fields': SBDB_FIELDS, 'sb-kind': 'c', 'sb-xfrag': '1',
                   'sort': '-last_obs', 'full-prec': 'true'}
# 2000 rows covers every comet whose last_obs is inside the freshness window (verified: 293 of the
# first 2000 rows were inside a 500-day window while the page's 2000th row was already 21 years
# old).  If the last row is still inside the window the build pages on with limit-from.
SBDB_PAGE_LIMIT = 2000
SBDB_MAX_PAGES = 3

MIN_COMETS = 3                 # publication gate: a 3-comet artifact means something went wrong
MIN_EPHEMERIS_POINTS = 3       # publication gate: a 3-row ephemeris is not an ephemeris
HORIZON_COVERAGE_MIN = 0.8     # published samples must span >= 80% of the requested horizon
MAX_AU = 500.0                 # sanity bound for r and delta
HORIZON_DAYS_RANGE = (30, 400)
MAX_CANDIDATES_CAP = 40
CONSECUTIVE_FAILURE_ABORT = 3
HORIZONS_BRIGHT_ENOUGH_MAG = 12.0
# Published samples are interpolated linearly by the browser, so each comet gets the coarsest step
# from this list (divisors of 24 h, so samples always land on whole hours) whose worst mid-way
# deviation stays inside INTERPOLATION_MAX_DEG.  --step-hours is the requested maximum.
STEP_CHOICES_HOURS = (1, 2, 3, 4, 6, 8, 12, 24, 48)
INTERPOLATION_MAX_DEG = 0.02
COBS_WINDOW_DAYS = 120
COBS_MEDIAN_DAYS = 30
COBS_PAGE_LIMIT = 3
COBS_MIN_TREND_POINTS = 5
COBS_MIN_TREND_SPAN_DAYS = 10.0
COBS_TREND_FLAT_EPS = 0.005   # |mag/day| below this is reported as "flat", not brightening/fading
COBS_REQUEST_GAP_S = 0.5      # COBS is a small community server: never hit it faster than this
# `signature.version` is asserted, not assumed: the JSON contract is versioned and the parser below
# is written against these two.  A bump must fail the build loudly instead of mis-reading silently.
COBS_API_VERSIONS = {'obs_list': '1.5', 'comet_list': '1.3'}

THRESHOLDS = {'new_window_days': 30, 'brightening_delta_mag': 0.7, 'orbit_epoch_change_days': 1,
              'closer_approach_improvement_pct': 20}
GENERATED_AT_WARN_DAYS = 45
GENERATED_AT_FAIL_DAYS = 400

# JPL/Standish, "Approximate Positions of the Planets", Table 1 (1800-2050 AD), EM Barycenter,
# referred to the mean ecliptic and equinox of J2000: {element: (value at J2000, value/century)}.
# Copied verbatim from the page cited in the module docstring (retrieved 2026-10-08).
EARTH_MODEL_URL = 'https://ssd.jpl.nasa.gov/planets/approx_pos.html'
EARTH_MODEL_SHA256 = '9f7b30ca81cc548a879565bb3f70e6899a38ff5877cb1ff16bb04892f9c4d742'
EARTH_MODEL_RETRIEVED_AT = '2026-10-08'
EARTH_MODEL = {
    'a': (1.00000261, 0.00000562),
    'e': (0.01671123, -0.00004392),
    'I': (-0.00001531, -0.01294668),
    'L': (100.46457166, 35999.37244981),
    'peri': (102.93768193, 0.32327364),
    'node': (0.0, 0.0),
}

# Gaussian gravitational constant, au^1.5/day (the value the SBDB/Horizons elements are consistent
# with); used only inside the local two-body propagation.
GAUSSIAN_K = 0.01720209895
OBLIQUITY_J2000_DEG = 23.439291111
TDB_MINUS_UTC_DAYS = 69.184 / 86400.0   # TT-UTC 69.184 s in 2026 (32.184 s + 37 leap seconds)
JD_J2000 = 2451545.0
JD_UNIX_EPOCH = 2440587.5

ISO_RE = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')
SHA256_RE = re.compile(r'^[0-9a-f]{64}$')
# A fragment component suffix ('73P-B', '2023 R1-B', 'P/2016 J1-A'): the SBDB query's sb-xfrag=1
# already excludes most of them, but not every component designation, so the row filter repeats it.
FRAGMENT_RE = re.compile(r'[-/][A-Z]{1,2}$')
NUMBERED_RE = re.compile(r'^(\d+)([A-Z])$')
PREFIXED_RE = re.compile(r'^\s*(\d*)\s*([A-Z])\s*/')
HORIZONS_ROW_RE = re.compile(r'^\s*(\d{4})-([A-Z][a-z]{2})-(\d{2})\s+(\d{1,2}):(\d{2})')
MONTH_ABBR = {name: number for number, name in enumerate(
    ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'), start=1)}


class BuildError(RuntimeError):
    """Anything that must stop the run rather than publish an unverified artifact."""


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def round_half_up(value: float, digits: int) -> float:
    return float(f'{value:.{digits}f}')


# --------------------------------------------------------------------------------------------- time
def jd_from_iso(text: str) -> float:
    """Julian date from an ISO-8601 UTC instant (no time-scale conversion is applied)."""
    stamp = datetime.fromisoformat(str(text).replace('Z', '+00:00'))
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp.timestamp() / 86400.0 + JD_UNIX_EPOCH


def iso_from_jd(jd: float) -> str:
    """Calendar ISO-8601 UTC for a Julian date, to the minute.

    The SBDB ``epoch``/``tp`` values are TDB Julian dates; they are rendered as if they were UTC
    because TDB-UTC is 69 s in 2026, i.e. below the published precision of these elements.  The
    propagator always uses the raw Julian date, never this string.
    """
    stamp = datetime.fromtimestamp((jd - JD_UNIX_EPOCH) * 86400.0, timezone.utc)
    return stamp.strftime('%Y-%m-%dT%H:%M:%SZ')


def iso_day(jd: float) -> str:
    return datetime.fromtimestamp((jd - JD_UNIX_EPOCH) * 86400.0, timezone.utc).strftime('%Y-%m-%d')


def parse_iso(text: str) -> datetime:
    stamp = datetime.fromisoformat(str(text).replace('Z', '+00:00'))
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp.astimezone(timezone.utc)


def days_between(start_iso: str, end_iso: str) -> float:
    return (parse_iso(end_iso) - parse_iso(start_iso)).total_seconds() / 86400.0


# --------------------------------------------------------------- two-body Kepler propagation (J2000)
def solve_kepler(mean_anomaly: float, e: float) -> float:
    """E - e sin E = M by Newton iteration."""
    m = math.fmod(mean_anomaly, 2.0 * math.pi)
    ecc = m if e < 0.8 else math.pi
    for _ in range(80):
        delta = -(ecc - e * math.sin(ecc) - m) / (1.0 - e * math.cos(ecc))
        ecc += delta
        if abs(delta) < 1e-14:
            break
    return ecc


def solve_hyperbolic_kepler(mean_anomaly: float, e: float) -> float:
    """e sinh H - H = M by Newton iteration."""
    h = math.asinh(mean_anomaly / e)
    for _ in range(200):
        delta = -(e * math.sinh(h) - h - mean_anomaly) / (e * math.cosh(h) - 1.0)
        h += delta
        if abs(delta) < 1e-14:
            break
    return h


def solve_barker(work: float) -> float:
    """D^3/3 + D = W (Barker's equation) by Newton iteration."""
    d = math.copysign(abs(3.0 * work) ** (1.0 / 3.0), work)
    for _ in range(200):
        delta = -(d ** 3 / 3.0 + d - work) / (d * d + 1.0)
        d += delta
        if abs(delta) < 1e-14:
            break
    return d


def true_anomaly_and_r(e: float, q: float, tp: float, jd: float) -> tuple[float, float]:
    """(true anomaly in radians, heliocentric distance au) of the osculating conic at `jd`.

    `jd` and `tp` are TDB Julian dates, `e`/`q` the published eccentricity and perihelion distance.
    Elliptical (e<1), hyperbolic (e>1) and parabolic (e=1) cases are handled explicitly.
    """
    if not math.isfinite(q) or not q > 0.0:
        raise BuildError(f'perihelion distance {q!r} is not usable')
    if e < 1.0 - 1e-9:
        a = q / (1.0 - e)
        mean_anomaly = GAUSSIAN_K / a ** 1.5 * (jd - tp)
        ecc = solve_kepler(mean_anomaly, e)
        r = a * (1.0 - e * math.cos(ecc))
        nu = 2.0 * math.atan2(math.sqrt(1.0 + e) * math.sin(ecc / 2.0),
                              math.sqrt(1.0 - e) * math.cos(ecc / 2.0))
        return nu, r
    if e > 1.0 + 1e-9:
        a = q / (1.0 - e)                      # negative for a hyperbola
        mean_anomaly = GAUSSIAN_K / (-a) ** 1.5 * (jd - tp)
        h = solve_hyperbolic_kepler(mean_anomaly, e)
        r = -a * (e * math.cosh(h) - 1.0)
        nu = 2.0 * math.atan2(math.sqrt(e + 1.0) * math.sinh(h / 2.0),
                              math.sqrt(e - 1.0) * math.cosh(h / 2.0))
        return nu, r
    work = 3.0 * GAUSSIAN_K * (jd - tp) / (2.0 * math.sqrt(2.0) * q ** 1.5)
    d = solve_barker(work)
    return 2.0 * math.atan(d), q * (1.0 + d * d)


def helio_ecliptic(e: float, q: float, inc: float, node: float, peri: float, tp: float,
                   jd: float) -> tuple[float, float, float, float]:
    """Heliocentric J2000 ecliptic rectangular coordinates (au) and r (au)."""
    nu, r = true_anomaly_and_r(e, q, tp, jd)
    u = math.radians(peri) + nu
    node_r, inc_r = math.radians(node), math.radians(inc)
    x = r * (math.cos(node_r) * math.cos(u) - math.sin(node_r) * math.sin(u) * math.cos(inc_r))
    y = r * (math.sin(node_r) * math.cos(u) + math.cos(node_r) * math.sin(u) * math.cos(inc_r))
    z = r * (math.sin(u) * math.sin(inc_r))
    return x, y, z, r


def earth_helio_ecliptic(jd_tdb: float) -> tuple[float, float, float]:
    """Earth/Moon-barycentre heliocentric J2000 ecliptic position (au), JPL Table 1 elements."""
    t = (jd_tdb - JD_J2000) / 36525.0
    a = EARTH_MODEL['a'][0] + EARTH_MODEL['a'][1] * t
    e = EARTH_MODEL['e'][0] + EARTH_MODEL['e'][1] * t
    inc = math.radians(EARTH_MODEL['I'][0] + EARTH_MODEL['I'][1] * t)
    mean_lon = EARTH_MODEL['L'][0] + EARTH_MODEL['L'][1] * t
    peri = EARTH_MODEL['peri'][0] + EARTH_MODEL['peri'][1] * t
    node = EARTH_MODEL['node'][0] + EARTH_MODEL['node'][1] * t
    w = math.radians(peri - node)
    node_r = math.radians(node)
    mean_anomaly = math.radians((mean_lon - peri + 180.0) % 360.0 - 180.0)
    ecc = solve_kepler(mean_anomaly, e)
    xp = a * (math.cos(ecc) - e)
    yp = a * math.sqrt(1.0 - e * e) * math.sin(ecc)
    cw, sw = math.cos(w), math.sin(w)
    cn, sn = math.cos(node_r), math.sin(node_r)
    ci, si = math.cos(inc), math.sin(inc)
    x = (cw * cn - sw * sn * ci) * xp + (-sw * cn - cw * sn * ci) * yp
    y = (cw * sn + sw * cn * ci) * xp + (-sw * sn + cw * cn * ci) * yp
    z = (sw * si) * xp + (cw * si) * yp
    return x, y, z


def geocentric(elements: dict, jd_tdb: float) -> dict:
    """Geocentric astrometric ICRF/J2000 RA/Dec (deg) and r, delta (au) from a two-body propagation.

    Elements may arrive as numbers or as the SBDB's numeric strings (``epoch``/``tp`` are published
    as full-precision strings), so each field is coerced here.
    """
    e, q = float(elements['e']), float(elements['q'])
    inc, om = float(elements['i']), float(elements['om'])
    peri, tp = float(elements['w']), float(elements['tp'])
    cx, cy, cz, r = helio_ecliptic(e, q, inc, om, peri, tp, jd_tdb)
    ex, ey, ez = earth_helio_ecliptic(jd_tdb)
    dx, dy, dz = cx - ex, cy - ey, cz - ez
    delta = math.sqrt(dx * dx + dy * dy + dz * dz)
    eps = math.radians(OBLIQUITY_J2000_DEG)
    xe = dx
    ye = dy * math.cos(eps) - dz * math.sin(eps)
    ze = dy * math.sin(eps) + dz * math.cos(eps)
    return {'ra_deg': math.degrees(math.atan2(ye, xe)) % 360.0,
            'dec_deg': math.degrees(math.atan2(ze, math.hypot(xe, ye))),
            'r_au': r, 'delta_au': delta}


def total_magnitude(m1: float, k1: float, r: float, delta: float) -> float:
    """IAU total-magnitude model m1 = M1 + 5 log10(delta) + K1 log10(r)."""
    if not (r > 0.0 and delta > 0.0):
        raise BuildError('total_magnitude needs r>0 and delta>0')
    return m1 + 5.0 * math.log10(delta) + k1 * math.log10(r)


def separation_arcmin(ra_a: float, dec_a: float, ra_b: float, dec_b: float) -> float:
    """Angular separation in arcmin, small-angle form (fine for the arcmin-scale residuals here)."""
    dra = (ra_a - ra_b + 180.0) % 360.0 - 180.0
    ddec = dec_a - dec_b
    return math.hypot(dra * math.cos(math.radians(dec_b)), ddec) * 60.0


def unwrap_ra(ras: list[float]) -> list[float]:
    """Remove 0/360 crossings so a RA series can be differenced."""
    out = [ras[0]]
    for ra in ras[1:]:
        out.append(out[-1] + ((ra - out[-1] + 180.0) % 360.0 - 180.0))
    return out


def midway_deviation(points: list[dict]) -> float:
    """Worst linear-interpolation error at sample times, in degrees.

    For evenly spaced samples the linear interpolation between the neighbours of sample i differs
    from the true value at i by |y[i] - (y[i-1]+y[i+1])/2| - the second difference - for RA (scaled
    by cos(dec) so it is an on-sky angle) and for declination.  This is the quantity the browser
    inherits when it interpolates linearly between published samples.
    """
    if len(points) < 3:
        return 0.0
    ras = unwrap_ra([point['ra_deg'] for point in points])
    decs = [point['dec_deg'] for point in points]
    worst = 0.0
    for index in range(1, len(points) - 1):
        cosd = math.cos(math.radians(decs[index]))
        worst = max(worst,
                    abs(ras[index] - (ras[index - 1] + ras[index + 1]) / 2.0) * cosd,
                    abs(decs[index] - (decs[index - 1] + decs[index + 1]) / 2.0))
    return worst


def choose_step_from_curvature(curvature: float, max_step_hours: int,
                               safety: float = 0.7, below: int | None = None) -> int:
    """Coarsest allowed step whose mid-way error |y''| h^2 / 2 stays inside the tolerance."""
    options = [hours for hours in STEP_CHOICES_HOURS
               if hours <= max_step_hours and (below is None or hours < below)]
    if not options:
        return 1
    if curvature <= 0.0:
        return max(options)
    limit_hours = 24.0 * math.sqrt(2.0 * INTERPOLATION_MAX_DEG / curvature) * safety
    for hours in sorted(options, reverse=True):
        if hours <= limit_hours:
            return hours
    return min(options)


def choose_step_hours(elements: dict, start_jd: float, horizon_days: int, max_step_hours: int,
                      safety: float = 0.7) -> int:
    """The coarsest step whose linear interpolation stays inside INTERPOLATION_MAX_DEG.

    The curvature is estimated from the local two-body geometry on a quarter-day grid, so choosing
    a finer step for a fast comet costs no extra request: the second difference of a smooth series
    scales as h^2, so the step that keeps |y[i]-(y[i-1]+y[i+1])/2| <= INTERPOLATION_MAX_DEG is
    h = sqrt(2*tolerance/|y''|), scaled by `safety` for the model's own error.
    """
    grid = 0.25
    count = max(2, int(round(horizon_days / grid)))
    series = [geocentric(elements, start_jd + index * grid) for index in range(count + 1)]
    ras = unwrap_ra([point['ra_deg'] for point in series])
    decs = [point['dec_deg'] for point in series]
    curvature = 0.0
    for index in range(1, len(series) - 1):
        cosd = math.cos(math.radians(decs[index]))
        curvature = max(curvature,
                        abs(ras[index] - (ras[index - 1] + ras[index + 1]) / 2.0) * cosd / grid ** 2,
                        abs(decs[index] - (decs[index - 1] + decs[index + 1]) / 2.0) / grid ** 2)
    return choose_step_from_curvature(curvature, max_step_hours, safety)


# ------------------------------------------------------------------------------------- HTTP plumbing
class Fetcher:
    """HTTP GET with a shared session, a minimum interval between requests and bounded retries.

    Transient failures (HTTP 429/5xx, connection errors) are retried with exponential backoff.
    Permanent failures (any other non-200) are returned immediately.  `status` is None when every
    attempt failed; the caller decides whether that is fatal for the whole run.
    """

    TRANSIENT_STATUS = (429, 500, 502, 503, 504)

    def __init__(self, min_interval: float = 0.0, timeout: float = 180.0, retries: int = 3):
        self.session = requests.Session()
        self.session.headers.update({'User-Agent': USER_AGENT})
        self.min_interval = min_interval
        self.timeout = timeout
        self.retries = retries
        self._last_call = 0.0
        self.requests_made = 0

    def pause(self, seconds: float) -> None:
        if seconds > 0:
            time.sleep(seconds)

    def _rate_limit(self) -> None:
        if self.min_interval > 0:
            gap = time.monotonic() - self._last_call
            if gap < self.min_interval:
                time.sleep(self.min_interval - gap)

    def get(self, url: str, params: dict) -> dict:
        error = None
        for attempt in range(self.retries):
            self._rate_limit()
            self._last_call = time.monotonic()
            self.requests_made += 1
            try:
                response = self.session.get(url, params=params, timeout=self.timeout)
            except requests.RequestException as exc:
                error = f'{type(exc).__name__}: {exc}'
            else:
                if response.status_code == 200:
                    return {'status': 200, 'body': response.content, 'url': response.url,
                            'attempts': attempt + 1, 'error': None}
                error = f'HTTP {response.status_code}'
                if response.status_code not in self.TRANSIENT_STATUS:
                    return {'status': response.status_code, 'body': response.content,
                            'url': response.url, 'attempts': attempt + 1, 'error': error}
            if attempt + 1 < self.retries:
                time.sleep(min(30.0, 2.0 ** attempt))
        return {'status': None, 'body': b'', 'url': url, 'attempts': self.retries, 'error': error}


def query_string(params: dict) -> str:
    """The query string as passed (unencoded); requests encodes it on the wire."""
    return '&'.join(f'{key}={value}' for key, value in params.items())


# ------------------------------------------------------------------------------------ SBDB discovery
def to_float(value) -> float | None:
    if value is None or value == '':
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def fetch_sbdb_rows(fetcher: Fetcher, run_date: date, window_days: int) -> tuple[list[dict], dict]:
    """Every comet in the SBDB, newest `last_obs` first, with full-precision elements.

    Returns the parsed rows and the provenance block for the artifact.  The SBDB query language
    cannot filter on `last_obs` (HTTP 400), so the freshness window is applied in Python; the query
    is paged with `limit`/`limit-from` only if the last row is still inside the window.
    """
    window_start = (run_date - timedelta(days=window_days)).isoformat()
    pages, bodies, urls = [], [], []
    offset = 0
    capped = False
    while True:
        params = dict(SBDB_QUERY_BASE, limit=str(SBDB_PAGE_LIMIT))
        if offset:
            params['limit-from'] = str(offset)
        result = fetcher.get(SBDB_QUERY_URL, params)
        if result['status'] != 200:
            detail = result['body'].decode('utf-8', errors='replace').strip()[:300]
            raise BuildError(f'SBDB query failed: {result["error"]} (status {result["status"]}) '
                             f'{detail}')
        bodies.append(result['body'])
        urls.append(result['url'])
        try:
            payload = json.loads(result['body'].decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise BuildError(f'SBDB query did not return JSON: {exc}') from exc
        fields = list(payload.get('fields') or [])
        rows = payload.get('data') or []
        if fields != SBDB_FIELDS.split(','):
            raise BuildError('SBDB returned an unexpected field order: ' + ','.join(fields))
        pages.append(rows)
        if len(rows) < SBDB_PAGE_LIMIT:
            break
        if rows[-1][fields.index('last_obs')] < window_start:
            break
        offset += len(rows)
        if len(pages) >= SBDB_MAX_PAGES:
            capped = True
            break
    prov = {
        'name': 'NASA/JPL Small-Body Database (SBDB) Query API',
        'url': SBDB_QUERY_URL,
        'query': query_string(dict(SBDB_QUERY_BASE, limit=str(SBDB_PAGE_LIMIT))),
        'request_url': urls[0],
        'http_status': 200,
        'retrieved_at': utc_now(),
        'row_count': sum(len(page) for page in pages),
        'sha256': sha256(bodies[0]),
        'note': ('values arrive as strings and are stored here as parsed numbers; a may be negative '
                 '(hyperbolic) or very large (long-period); tp and epoch are TDB Julian dates; '
                 'm1/k1 are not valid field names for this endpoint (HTTP 400), M1/K1 are'),
    }
    if len(bodies) > 1:
        prov['pages'] = [{'url': url, 'sha256': sha256(body), 'bytes': len(body),
                          'http_status': 200} for url, body in zip(urls, bodies)]
        prov['note'] += (f'; the response needed {len(pages)} pages, sha256 anchors the first page '
                         'and pages[] anchors the rest')
        if capped:
            prov['note'] += '; the last page hit SBDB_MAX_PAGES so the oldest rows may be missing'
    return [dict(zip(SBDB_FIELDS.split(','), row)) for page in pages for row in page], prov


def designation_parts(full_name: str, pdes: str) -> tuple[str, str]:
    """(id, comet prefix letter) from the SBDB name/designation strings."""
    match = PREFIXED_RE.match(full_name or '') or PREFIXED_RE.match(pdes or '')
    kind = match.group(2) if match else 'C'
    stripped = (pdes or '').strip()
    if NUMBERED_RE.match(stripped) or '/' in stripped:
        return stripped, kind
    return f'{kind}/{stripped}', kind


def usable_elements(record: dict) -> tuple[bool, str]:
    """(usable, reason-if-not) for the numerically required element set."""
    e = to_float(record.get('e'))
    q = to_float(record.get('q'))
    inc = to_float(record.get('i'))
    om = to_float(record.get('om'))
    w = to_float(record.get('w'))
    tp = to_float(record.get('tp'))
    if None in (e, q, inc, om, w, tp):
        return False, 'missing one of e,q,i,om,w,tp'
    if not 0.0 <= e <= 5.0:
        return False, f'eccentricity {e} outside [0,5]'
    if not q > 0.0:
        return False, f'perihelion distance {q} not positive'
    if not 0.0 <= inc <= 180.0:
        return False, f'inclination {inc} outside [0,180]'
    if e < 1.0 and to_float(record.get('a')) is None:
        return False, 'a missing for an elliptical orbit'
    return True, ''


def rank_candidates(records: list[dict], run_date: date, window_days: int, horizon_days: int,
                    max_candidates: int) -> tuple[list[dict], dict]:
    """Filter the SBDB rows to the freshness window and rank them by predicted peak brightness.

    Ranking propagates every candidate over the horizon with the local two-body model (see the
    module docstring for the measured accuracy) so it costs no extra network calls.
    """
    window_start = run_date - timedelta(days=window_days)
    start_jd = jd_from_iso(f'{run_date.isoformat()}T00:00:00Z') + TDB_MINUS_UTC_DAYS
    diag = {'rows': len(records), 'in_window': 0, 'fragments': 0, 'duplicates': 0,
            'unusable_elements': [], 'no_magnitude': [], 'unpropagatable': []}
    seen: set[str] = set()
    candidates = []
    for record in records:
        last_obs = (record.get('last_obs') or '').strip()
        if len(last_obs) != 10 or last_obs < window_start.isoformat():
            continue                       # also drops the YYYY-??-?? partial dates
        diag['in_window'] += 1
        pdes = (record.get('pdes') or '').strip()
        full_name = (record.get('full_name') or '').strip()
        if FRAGMENT_RE.search(pdes) or FRAGMENT_RE.search(full_name.split()[0] if full_name else ''):
            diag['fragments'] += 1
            continue
        ident, kind = designation_parts(full_name, pdes)
        if ident in seen:
            diag['duplicates'] += 1
            continue
        seen.add(ident)
        ok, reason = usable_elements(record)
        if not ok:
            diag['unusable_elements'].append(f'{ident}: {reason}')
            continue
        m1, k1 = to_float(record.get('M1')), to_float(record.get('K1'))
        if m1 is None or k1 is None:
            diag['no_magnitude'].append(ident)
            continue
        elements = {'e': to_float(record['e']), 'q': to_float(record['q']),
                    'i': to_float(record['i']), 'om': to_float(record['om']),
                    'w': to_float(record['w']), 'tp': to_float(record['tp'])}
        peak = None
        try:
            for day in range(0, horizon_days + 1):
                jd = start_jd + day
                geo = geocentric(elements, jd)
                if not (0.0 < geo['r_au'] <= MAX_AU and 0.0 < geo['delta_au'] <= MAX_AU):
                    continue
                mag = total_magnitude(m1, k1, geo['r_au'], geo['delta_au'])
                if peak is None or mag < peak['magnitude']:
                    peak = {'magnitude': mag, 'at': iso_from_jd(jd - TDB_MINUS_UTC_DAYS),
                            'r_au': geo['r_au'], 'delta_au': geo['delta_au']}
        except (BuildError, OverflowError, ValueError) as exc:
            diag['unpropagatable'].append(f'{ident}: {exc}')
            continue
        if peak is None:
            diag['unpropagatable'].append(f'{ident}: no valid propagation inside the horizon')
            continue
        candidates.append({'id': ident, 'kind': kind, 'record': record, 'pdes': pdes,
                           'full_name': full_name, 'M1': m1, 'K1': k1, 'peak': peak,
                           'elements': elements})
    candidates.sort(key=lambda item: (item['peak']['magnitude'], item['id']))
    # Any object predicted brighter than HORIZONS_BRIGHT_ENOUGH_MAG inside the horizon is published
    # even when it falls outside the requested count; everything else is filled in brightness order.
    selected = [item for item in candidates if item['peak']['magnitude'] < HORIZONS_BRIGHT_ENOUGH_MAG]
    chosen = {item['id'] for item in selected}
    limit = max(max_candidates, len(selected))
    for item in candidates:
        if len(selected) >= limit:
            break
        if item['id'] not in chosen:
            selected.append(item)
            chosen.add(item['id'])
    selected.sort(key=lambda item: (item['peak']['magnitude'], item['id']))
    selected = selected[:MAX_CANDIDATES_CAP]
    diag['cap'] = {'requested': max_candidates, 'published': len(selected)}
    diag['ranked'] = len(candidates)
    diag['selected'] = [item['id'] for item in selected]
    diag['brighter_than_12'] = [item['id'] for item in candidates
                                if item['peak']['magnitude'] < HORIZONS_BRIGHT_ENOUGH_MAG]
    diag['selected_peak_range'] = ([round_half_up(selected[0]['peak']['magnitude'], 2),
                                    round_half_up(selected[-1]['peak']['magnitude'], 2)]
                                   if selected else None)
    return selected, diag


# --------------------------------------------------------------------------------- Horizons ephemeris
HORIZONS_PARAM_ORDER = ('format', 'COMMAND', 'MAKE_EPHEM', 'EPHEM_TYPE', 'CENTER', 'START_TIME',
                        'STOP_TIME', 'STEP_SIZE', 'QUANTITIES', 'ANG_FORMAT', 'TIME_DIGITS',
                        'EXTRA_PREC', 'CSV_FORMAT', 'OBJ_DATA')


def horizons_params(command: str, start: str, stop: str, step_hours: int) -> dict:
    """The verified working parameter set (see the module docstring for why each value is fixed)."""
    values = {
        'format': 'text',
        'COMMAND': f"'DES={command};CAP'",
        'MAKE_EPHEM': "'YES'",
        'EPHEM_TYPE': "'OBSERVER'",
        'CENTER': "'500@399'",
        'START_TIME': f"'{start}'",
        'STOP_TIME': f"'{stop}'",
        'STEP_SIZE': f"'{step_hours} h'",
        'QUANTITIES': "'1,19,20'",
        'ANG_FORMAT': "'DEG'",
        'TIME_DIGITS': "'MINUTES'",
        'EXTRA_PREC': "'YES'",
        'CSV_FORMAT': "'YES'",
        'OBJ_DATA': "'NO'",
    }
    return {key: values[key] for key in HORIZONS_PARAM_ORDER}


def horizons_query_template(step_hours: int) -> str:
    """The parameter string as published in the artifact: per-comet fields in <>, step literal.

    The literals for START_TIME/STOP_TIME are the run's horizon; both are also published in
    ``horizon``, and every per-comet request used exactly this parameter string with COMMAND
    replaced by that comet's designation.
    """
    return query_string(horizons_params('<desig>', '<horizon_start>', '<horizon_end>', step_hours))


def horizons_body_rows(body: bytes) -> list[str]:
    """The CSV rows between $$SOE and $$EOE, or [] when the response carries no ephemeris."""
    text = body.decode('utf-8', errors='replace')
    start = text.find('$$SOE')
    end = text.find('$$EOE')
    if start < 0 or end < start:
        return []
    return [line for line in text[start + len('$$SOE'):end].splitlines() if line.strip()]


def horizons_body_target(body: bytes) -> str:
    text = body.decode('utf-8', errors='replace')
    for line in text.splitlines():
        if line.startswith('Target body name:'):
            return line.split(':', 1)[1].split('{')[0].strip()
    return ''


def horizons_body_error(body: bytes) -> str:
    """Horizons answers HTTP 200 even for bad input; surface the message for the run notes."""
    text = body.decode('utf-8', errors='replace')
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith('API ') and not line.startswith('*'):
            return line[:200]
    return text.strip()[:200] or 'empty response'


def parse_horizons_row(line: str) -> dict | None:
    """One CSV ephemeris row -> sample dict, or None when the row is not usable.

    Verified column layout for QUANTITIES='1,19,20' with CSV_FORMAT='YES':
        date, <blank>, <blank>, RA_deg, Dec_deg, r_au, rdot, delta_au, deldot, <blank>
    """
    match = HORIZONS_ROW_RE.match(line)
    if not match:
        return None
    year, month, day, hour, minute = match.groups()
    if month not in MONTH_ABBR:
        return None
    parts = [cell.strip() for cell in line.split(',')]
    if len(parts) < 8:
        return None
    try:
        ra = float(parts[3])
        dec = float(parts[4])
        r = float(parts[5])
        delta = float(parts[7])
    except (TypeError, ValueError):
        return None
    if not all(math.isfinite(value) for value in (ra, dec, r, delta)):
        return None
    if not (0.0 <= ra < 360.0 and -90.0 <= dec <= 90.0):
        return None
    if not (0.0 < r <= MAX_AU and 0.0 < delta <= MAX_AU):
        return None
    return {'t_iso': f'{int(year):04d}-{MONTH_ABBR[month]:02d}-{int(day):02d}T'
                     f'{int(hour):02d}:{int(minute):02d}:00Z',
            'ra_deg': ra, 'dec_deg': dec, 'r_au': r, 'delta_au': delta}


def fetch_ephemeris(fetcher: Fetcher, command: str, start: str, stop: str, step_hours: int,
                    sleep_seconds: float, fallback_command: str | None = None) -> dict:
    """One Horizons geocentric OBSERVER ephemeris for one comet.

    The designation form ``DES=<designation>;CAP`` is what the artifact documents, but a designation
    that Horizons' small-body index resolves to more than one record returns a record-index search
    page instead of an ephemeris (verified: ``DES=2023 R1;CAP`` matches the comet and its fragment).
    When that happens and an SPK-ID is known, the request is repeated once with
    ``DES=<spkid>;CAP``, which selects exactly the row the elements came from.

    Returns {'ok', 'points', 'reason', 'target', 'provenance'}.  A response without a usable
    ``$$SOE`` block is a hard failure - rows are never invented or substituted.
    """
    attempts = []
    used = command
    for option in (command, fallback_command):
        if option is None:
            continue
        params = horizons_params(option, start, stop, step_hours)
        fetcher.pause(sleep_seconds)
        result = fetcher.get(HORIZONS_URL, params)
        provenance = {'query': query_string(params), 'command': f'DES={option};CAP',
                      'url': result['url'], 'http_status': result['status'],
                      'attempts': result['attempts'], 'bytes': len(result['body']),
                      'retrieved_at': utc_now(),
                      'sha256': sha256(result['body']) if result['body'] else None}
        attempts.append(provenance)
        used = option
        if result['status'] != 200:
            reason = f'Horizons request failed ({result["error"]})'
            continue
        rows = horizons_body_rows(result['body'])
        if not rows:
            reason = ('Horizons returned no $$SOE block: '
                      + horizons_body_error(result['body']))
            continue
        points = [sample for sample in (parse_horizons_row(line) for line in rows) if sample]
        if len(points) < MIN_EPHEMERIS_POINTS:
            reason = f'only {len(points)} of {len(rows)} ephemeris rows were usable'
            continue
        provenance['used'] = f'DES={used};CAP'
        provenance['attempts_made'] = len(attempts)
        if len(attempts) > 1:
            provenance['note'] = (f'the designation query failed ({attempts[0]["http_status"]}), '
                                  f'the SPK-ID form {provenance["used"]} was used instead')
        return {'ok': True, 'points': points, 'reason': '',
                'target': horizons_body_target(result['body']), 'provenance': provenance}
    provenance = attempts[-1] if attempts else {}
    provenance['attempts_made'] = len(attempts)
    provenance['all_attempts'] = attempts
    return {'ok': False, 'points': [], 'target': '', 'reason': reason, 'provenance': provenance}


# --------------------------------------------------------------------------- COBS observations
def cobs_params(des: str, obs_type: str, from_date: str, to_date: str, page: int) -> dict:
    """obs_list.api parameters.  Booleans are lower-case `true` (COBS rejects `1`)."""
    return {'format': 'json', 'des': des, 'from_date': f'{from_date} 00:00',
            'to_date': f'{to_date} 23:59', 'obs_type': obs_type,
            'exclude_not_accurate': 'true', 'exclude_issue': 'true', 'page': str(page)}


def assert_cobs_signature(payload: dict, endpoint: str) -> str:
    """Assert the documented `signature.version` contract of every COBS JSON payload."""
    signature = payload.get('signature')
    if not isinstance(signature, dict) or not signature.get('version'):
        raise BuildError(f'COBS {endpoint} payload has no signature.version; the API contract changed')
    version = str(signature['version'])
    expected = COBS_API_VERSIONS[endpoint]
    if version != expected:
        raise BuildError(f'COBS {endpoint} reports version {version}, parser expects {expected}: '
                         're-verify the response shape before publishing')
    return version


def parse_cobs_observation(row: dict, method: str) -> dict | None:
    """One COBS observation row -> a measurement, or None when it carries no usable magnitude.

    `method` is the query's own obs_type label ('visual' for obs_type=V, 'CCD' for obs_type=C):
    COBS uses ICQ method codes that overlap between the two lists (code 'V' appears as a Johnson
    V-band CCD measurement as well as a classic visual estimate), so the request type - not the
    method code - decides the label.  The code and its human name are kept alongside it.
    """
    magnitude = to_float(row.get('magnitude'))
    stamp = str(row.get('obs_date') or '')
    if magnitude is None or len(stamp) < 16:
        return None
    try:
        when = datetime.strptime(stamp[:19], '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    code = row.get('obs_method') or {}
    observer = row.get('observer') or {}
    name = ' '.join(part for part in (observer.get('first_name'), observer.get('last_name')) if part)
    return {'t_iso': when.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'date': when.strftime('%Y-%m-%d'),
            'epoch_days': when.timestamp() / 86400.0,
            'magnitude': magnitude,
            'method': method,
            'method_code': code.get('key'),
            'method_name': code.get('name'),
            'observer': name.strip() or (observer.get('icq_name') or ''),
            'coma_diameter': to_float(row.get('coma_diameter'))}


def fetch_cobs_observations(fetcher: Fetcher, des: str, from_date: str,
                            to_date: str) -> dict:
    """Visual + CCD observations of one comet, requested separately and labelled by request type."""
    result = {'observations': [], 'payloads': [], 'api_version': None, 'errors': [], 'pages': {},
              'known': False}
    for obs_type, label in (('V', 'visual'), ('C', 'CCD')):
        for page in range(1, COBS_PAGE_LIMIT + 1):
            params = cobs_params(des, obs_type, from_date, to_date, page)
            fetched = fetcher.get(COBS_OBS_URL, params)
            entry = {'url': fetched['url'], 'query': query_string(params),
                     'http_status': fetched['status'], 'retrieved_at': utc_now(),
                     'bytes': len(fetched['body']),
                     'sha256': sha256(fetched['body']) if fetched['body'] else None,
                     'obs_type': obs_type, 'page': page}
            result['payloads'].append(entry)
            if fetched['status'] != 200:
                result['errors'].append(f'{label} page {page}: {fetched["error"]}')
                break
            try:
                payload = json.loads(fetched['body'].decode('utf-8'))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                result['errors'].append(f'{label} page {page}: not JSON ({exc})')
                break
            code = payload.get('code')
            if code is not None and str(code) not in ('200',):
                message = str(payload.get('message') or '')
                if 'no object matches' in message:
                    break                      # comet unknown to COBS: no observations, not an error
                raise BuildError(f'COBS obs_list.api rejected our query ({code}): {message}')
            version = assert_cobs_signature(payload, 'obs_list')
            result['api_version'] = result['api_version'] or version
            result['known'] = True
            rows = payload.get('objects') or []
            for row in rows:
                parsed = parse_cobs_observation(row, label)
                if parsed:
                    result['observations'].append(parsed)
            info = payload.get('info') or {}
            pages = int(info.get('pages') or 1)
            result['pages'][label] = pages
            if page >= pages or len(rows) < int(info.get('length') or 0):
                break
            if page == COBS_PAGE_LIMIT:
                result['errors'].append(f'{label}: hit the {COBS_PAGE_LIMIT}-page cap, '
                                        f'{info.get("recordsTotal")} observations reported')
    result['observations'].sort(key=lambda obs: (obs['t_iso'], obs['method'], str(obs['method_code'])))
    return result


def fetch_cobs_for(fetcher: Fetcher, idents: list[str], from_date: str, to_date: str) -> dict:
    """Try the designations in order and stop at the first one COBS knows.

    COBS indexes comets by the name it publishes (``C/2026 A2``, ``2P``), which is what SBDB's
    ``pdes`` is *not* for a long-period comet (``2026 A2``): verified that ``des=C/2026 A2``
    returns 230 CCD observations while ``des=2026 A2`` returns "no object matches".
    """
    result = None
    for ident in idents:
        result = fetch_cobs_observations(fetcher, ident, from_date, to_date)
        result['queried_as'] = ident
        if result['known']:
            break
    return result


def method_codes(observations: list[dict]) -> list[str]:
    return sorted({str(obs.get('method_code')) for obs in observations if obs.get('method_code')})


def fit_trend(observations: list[dict], origin_days: float) -> dict | None:
    """Least-squares magnitude-vs-time fit: returns None unless the sample is large enough."""
    if len(observations) < COBS_MIN_TREND_POINTS:
        return None
    spans = [obs['epoch_days'] for obs in observations]
    span_days = max(spans) - min(spans)
    if span_days < COBS_MIN_TREND_SPAN_DAYS:
        return None
    xs = [obs['epoch_days'] - origin_days for obs in observations]
    ys = [obs['magnitude'] for obs in observations]
    mean_x, mean_y = statistics.fmean(xs), statistics.fmean(ys)
    sxx = sum((x - mean_x) ** 2 for x in xs)
    if sxx <= 0.0:
        return None
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / sxx
    direction = ('brightening' if slope < -COBS_TREND_FLAT_EPS
                 else 'fading' if slope > COBS_TREND_FLAT_EPS else 'flat')
    return {'magnitudes_per_day': round_half_up(slope, 4), 'points': len(observations),
            'span_days': round_half_up(span_days, 2), 'direction': direction,
            'method': sorted({obs['method'] for obs in observations}),
            'method_codes': method_codes(observations), 'source': 'COBS observations',
            'fit': 'least squares of magnitude against time over this window'}


ELEMENT_SOURCE = 'NASA/JPL SBDB'
ELEMENTS_PROVENANCE = 'NASA/JPL SBDB Query API (full-prec element set)'
BRIGHTNESS_MODEL = 'M1 + 5*log10(delta) + K1*log10(r)'
PREDICTED_CAVEAT = ("model prediction from catalog parameters, not a measurement; M1/K1 are JPL's "
                    'total-magnitude fit and the geometry is the Horizons sample nearest the peak')


def build_comet(candidate: dict, ephemeris: dict, measured: dict, horizon: dict, step_hours: int,
                packed: str | None, cobs_note: str | None) -> dict:
    """One published comet record: elements, brightness, geometry, caveats, provenance."""
    record = candidate['record']
    points = ephemeris['points']
    m1, k1 = candidate['M1'], candidate['K1']
    tp = to_float(record['tp'])
    best = min(points, key=lambda point: total_magnitude(m1, k1, point['r_au'], point['delta_au']))
    closest = min(points, key=lambda point: point['delta_au'])
    peak_mag = total_magnitude(m1, k1, best['r_au'], best['delta_au'])
    elements = {
        'equinox': (record.get('equinox') or '').strip() or None,
        'epoch': record['epoch'], 'epoch_iso': iso_from_jd(to_float(record['epoch'])),
        'e': to_float(record['e']), 'a': to_float(record['a']), 'q': to_float(record['q']),
        'i': to_float(record['i']), 'om': to_float(record['om']), 'w': to_float(record['w']),
        'tp': record['tp'], 'tp_iso': iso_from_jd(tp),
        'per_years': (round_half_up(to_float(record['per']) / 365.25, 4)
                      if to_float(record['per']) is not None else None),
        'source': ELEMENT_SOURCE,
        'reference': (record.get('orbit_id') or '').strip() or None,
        'solution_date': (record.get('soln_date') or '').strip() or None,
        'condition_code': (record.get('condition_code') or '').strip() or None,
        'fit_rms': to_float(record.get('rms')),
        'n_obs_used': (int(float(record['n_obs_used']))
                       if to_float(record['n_obs_used']) is not None else None),
        'first_obs': record['first_obs'], 'last_obs': record['last_obs'],
    }
    caveats = [
        f'ephemeris covers {horizon["start"]} to {horizon["end"]} at {step_hours} h steps '
        f'({len(points)} Horizons samples); positions in the browser come from those samples, not '
        'from a local propagation',
        'the predicted magnitude is a catalog-parameter model, not a measurement',
    ]
    if not measured['observed']:
        caveats.append('no COBS observation in the last '
                       f'{measured["window_days"]} days with exclude_not_accurate and exclude_issue set')
    elif measured['latest']:
        age = round_half_up(days_between(measured['latest']['date'], horizon['start']), 1)
        if age > 14:
            caveats.append(f'the most recent COBS observation is {age:g} days older than the '
                           'start of this horizon')
        if measured['latest']['coma_diameter_arcmin'] is not None:
            caveats.append('COBS reports the coma diameter in the field coma_diameter; it is '
                           'published here as arcmin (the ICQ convention) because the COBS help page '
                           'could not be retrieved in this run (HTTP 500) to confirm the unit')
    if cobs_note:
        caveats.append(cobs_note)
    if record.get('condition_code'):
        caveats.append(f'SBDB orbit uncertainty parameter (MPC U) {record["condition_code"]} for '
                       f'the element set used here (JPL solution '
                       f'{elements["reference"] or "unstated"})')
    if elements['per_years']:
        caveats.append(f'tp is the osculating perihelion time of this element set, not a forecast: '
                       f'for this {elements["per_years"]:.3f}-year orbit the next perihelion passage '
                       f'is roughly one period later')
    if ephemeris.get('target') and candidate['id'] not in ephemeris['target']:
        caveats.append(f'Horizons resolved this designation to target "{ephemeris["target"]}"')
    if (ephemeris.get('provenance') or {}).get('note'):
        caveats.append('Horizons: ' + ephemeris['provenance']['note'])
    designation = candidate['pdes']
    return {
        'id': candidate['id'],
        'name': candidate['full_name'] or candidate['id'],
        'designation': designation,
        'kind': candidate['kind'],
        'mpc_packed': packed,
        'sbdb_id': int(float(record['spkid'])) if to_float(record['spkid']) else None,
        'elements': elements,
        'brightness': {
            'absolute': {'M1': m1, 'K1': k1,
                         'source': 'JPL SBDB M1/K1 (total magnitude model)'},
            'measured': measured,
            'predicted': {'magnitude': round_half_up(peak_mag, 2), 'at': best['t_iso'],
                          'r_au': round_half_up(best['r_au'], 6),
                          'delta_au': round_half_up(best['delta_au'], 6),
                          'model': BRIGHTNESS_MODEL, 'caveat': PREDICTED_CAVEAT,
                          'source': 'Horizons geometry + JPL SBDB M1/K1'},
        },
        'geometry': {'peak_brightness_at': best['t_iso'],
                     'min_delta_au': round_half_up(closest['delta_au'], 4),
                     'min_delta_at': closest['t_iso'],
                     'perihelion_iso': elements['tp_iso'],
                     'source': ('minimum geocentric distance and peak-brightness time from the '
                                'Horizons samples; the candidate ranking used a local two-body '
                                'Kepler propagation of the SBDB elements')},
        'caveats': caveats,
        'provenance': {
            'elements': ELEMENTS_PROVENANCE,
            'ephemeris': f'NASA/JPL Horizons OBSERVER ({len(points)} samples, '
                         f"{step_hours} h steps, geocentric)",
            'ephemeris_command': (ephemeris.get('provenance') or {}).get('used'),
            'observations': ('COBS obs_list.api (visual and CCD requested separately)'
                             if measured['observed'] else None),
            'brightness_model': f'IAU total magnitude model {BRIGHTNESS_MODEL}',
            'measured_source': 'COBS' if measured['observed'] else None,
        },
        'links': {
            'sbdb': ('https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr='
                     + requests.utils.quote(candidate['id'])),
            'horizons': 'https://ssd.jpl.nasa.gov/horizons/app.html#/',
        },
    }


# ------------------------------------------------------------------------------ noteworthy changes
def compare_with_previous(previous: dict | None, comets: list[dict], basis_note: str,
                          now_iso: str) -> dict:
    """Compare this run against the previously committed artifact using the published thresholds.

    `new_objects` is an id that is absent from the previous artifact whose SBDB ``first_obs`` is
    within ``new_window_days`` of this run; the other lists compare the published measured
    magnitude (same method set), the element epoch and the predicted minimum geocentric distance.
    Every list is derived from measured or derived values only; when there is no comparable previous
    artifact all lists are empty (which is also the expected steady-state result).
    """
    noteworthy = {'new_objects': [], 'brightened': [], 'faded': [], 'orbit_updates': [],
                  'approaching_minimum_delta': [], 'basis': basis_note}
    if not previous or previous.get('schema') != SCHEMA:
        return noteworthy
    old = {comet.get('id'): comet for comet in previous.get('comets') or []}
    new_ids = {comet['id'] for comet in comets}
    for comet in comets:
        prior = old.get(comet['id'])
        first_obs = comet['elements'].get('first_obs') or ''
        if prior is None:
            if first_obs and ISO_RE.match(now_iso):
                age = days_between(f'{first_obs}T00:00:00Z', now_iso)
                if 0 <= age <= THRESHOLDS['new_window_days']:
                    noteworthy['new_objects'].append(comet['id'])
            continue
        measured = comet['brightness']['measured']
        prior_measured = (prior.get('brightness') or {}).get('measured') or {}
        now_latest, old_latest = measured.get('latest'), prior_measured.get('latest')
        if now_latest and old_latest:
            methods_now = now_latest.get('methods') or [now_latest.get('method')]
            methods_old = old_latest.get('methods') or [old_latest.get('method')]
            if set(methods_now) == set(methods_old):
                delta_mag = round_half_up(now_latest['magnitude'] - old_latest['magnitude'], 3)
                if abs(delta_mag) >= THRESHOLDS['brightening_delta_mag']:
                    entry = {'id': comet['id'], 'delta_mag': delta_mag,
                             'method': now_latest.get('method'),
                             'from': {'magnitude': old_latest['magnitude'],
                                      'date': old_latest.get('date')},
                             'to': {'magnitude': now_latest['magnitude'],
                                    'date': now_latest.get('date')}}
                    (noteworthy['brightened'] if delta_mag < 0 else noteworthy['faded']).append(entry)
        old_epoch = ((prior.get('elements') or {}).get('epoch'))
        new_epoch = comet['elements'].get('epoch')
        if old_epoch and new_epoch:
            try:
                gap = abs(float(new_epoch) - float(old_epoch))
            except (TypeError, ValueError):
                gap = 0.0
            if gap >= THRESHOLDS['orbit_epoch_change_days']:
                noteworthy['orbit_updates'].append({
                    'id': comet['id'],
                    'old_epoch': (prior.get('elements') or {}).get('epoch_iso') or old_epoch,
                    'new_epoch': comet['elements'].get('epoch_iso') or new_epoch,
                    'delta_days': round_half_up(gap, 2)})
        old_delta = ((prior.get('geometry') or {}).get('min_delta_au'))
        new_delta = (comet.get('geometry') or {}).get('min_delta_au')
        if old_delta and new_delta and old_delta > 0:
            improvement = 100.0 * (old_delta - new_delta) / old_delta
            if improvement >= THRESHOLDS['closer_approach_improvement_pct']:
                noteworthy['approaching_minimum_delta'].append({
                    'id': comet['id'], 'old_min_delta_au': old_delta, 'new_min_delta_au': new_delta,
                    'improvement_pct': round_half_up(improvement, 1),
                    'min_delta_at': comet['geometry'].get('min_delta_at')})
    for key in ('brightened', 'faded', 'orbit_updates', 'approaching_minimum_delta'):
        noteworthy[key].sort(key=lambda entry: entry['id'])
    noteworthy['new_objects'] = sorted(new_ids & set(noteworthy['new_objects']))
    return noteworthy


def summarise_observations(observations: list[dict], window_start: str, window_end: str,
                           now_epoch_days: float) -> dict:
    """The published `measured` block: latest, 30-day median, counts and trend.

    Visual and CCD magnitudes are pooled for the median and the trend *because* the counts and the
    contributing ICQ method codes are published next to them; the `latest` block reports the method
    of the observation it came from (or "mixed" when one timestamp carries both, which happens when
    COBS stores several filters of the same image).

    `latest` is the most recent observation timestamp in the window.  When several observations
    share that timestamp, the magnitude and coma diameter are the median of that group and the
    methods that contributed are reported - nothing is cherry-picked.
    """
    measured = {'latest': None, 'latest_reason': None, 'median_30d': None, 'median_30d_reason': None,
                'count': {'visual': sum(1 for obs in observations if obs['method'] == 'visual'),
                          'ccd': sum(1 for obs in observations if obs['method'] == 'CCD'),
                          'total': len(observations)},
                'trend': None, 'trend_reason': None, 'window_days': COBS_WINDOW_DAYS,
                'window_start': window_start, 'window_end': window_end,
                'observed': bool(observations), 'source': 'COBS'}
    if not observations:
        reason = 'no COBS observations in the window'
        measured['latest_reason'] = reason
        measured['median_30d_reason'] = reason
        measured['trend_reason'] = reason
        return measured
    latest_stamp = max(obs['t_iso'] for obs in observations)
    group = [obs for obs in observations if obs['t_iso'] == latest_stamp]
    methods = sorted({obs['method'] for obs in group})
    comas = [obs['coma_diameter'] for obs in group if obs['coma_diameter'] is not None]
    names = sorted({str(obs['method_name']) for obs in group if obs['method_name']})
    measured['latest'] = {
        'magnitude': round_half_up(statistics.median([obs['magnitude'] for obs in group]), 3),
        'date': latest_stamp,
        'method': methods[0] if len(methods) == 1 else 'mixed',
        'methods': methods,
        'method_name': names[0] if len(names) == 1 else None,
        'method_codes': sorted({str(obs['method_code']) for obs in group if obs['method_code']}),
        'observer_count': len({obs['observer'] for obs in group if obs['observer']}),
        'observations_at_latest': len(group),
        'coma_diameter_arcmin': round_half_up(statistics.median(comas), 3) if comas else None,
        'source': 'COBS',
    }
    recent = [obs for obs in observations if obs['epoch_days'] >= now_epoch_days - COBS_MEDIAN_DAYS]
    if recent:
        measured['median_30d'] = {
            'magnitude': round_half_up(statistics.median([obs['magnitude'] for obs in recent]), 3),
            'visual_count': sum(1 for obs in recent if obs['method'] == 'visual'),
            'ccd_count': sum(1 for obs in recent if obs['method'] == 'CCD'),
            'method_codes': method_codes(recent),
            'window_start': iso_from_jd(now_epoch_days - COBS_MEDIAN_DAYS + JD_UNIX_EPOCH),
            'window_end': iso_from_jd(now_epoch_days + JD_UNIX_EPOCH),
            'source': 'COBS',
        }
    else:
        measured['median_30d_reason'] = f'no COBS observations in the last {COBS_MEDIAN_DAYS} days'
    origin = min(obs['epoch_days'] for obs in observations)
    per_method = []
    for label in ('visual', 'CCD'):
        fit = fit_trend([obs for obs in observations if obs['method'] == label], origin)
        if fit:
            per_method.append(fit)
    if per_method:
        per_method.sort(key=lambda fit: (-fit['points'], fit['method']))
        measured['trend'] = per_method[0]
    elif len(observations) >= COBS_MIN_TREND_POINTS:
        fit = fit_trend(observations, origin)
        if fit:
            fit['method'] = ['visual+CCD']
            measured['trend'] = fit
        else:
            measured['trend_reason'] = (f'{len(observations)} observations but they span less than '
                                        f'{COBS_MIN_TREND_SPAN_DAYS:g} days')
    else:
        measured['trend_reason'] = (f'only {len(observations)} observations in the window '
                                    f'(at least {COBS_MIN_TREND_POINTS} are needed for a trend)')
    return measured


# ---------------------------------------------------------------------------------- validation gates
# Everything below is a documented invariant of the dataset, not a best-effort heuristic: a
# violation means a parsing or source change and must fail the run instead of shipping.
NOTES_EPHEMERIS_SKIP_PREFIX = 'ephemeris unavailable: '
EPHEMERIS_COLUMNS = ['t_iso', 'ra_deg', 'dec_deg', 'r_au', 'delta_au']
EPHEMERIS_FRAME = 'geocentric astrometric ICRF/J2000 RA/Dec, degrees; r and delta in au'
EPHEMERIS_INTERPOLATION = ('linear between samples; samples are 1-2 day spaced (finer for a comet '
                           'that moves fast enough to require it - see that comet\'s step_hours) so '
                           "interpolation error is far below the source's own accuracy; the worst "
                           'measured mid-way deviation is published next to it')


def require(condition: bool, message: str) -> None:
    if not condition:
        raise BuildError(message)


def valid_iso(value, label: str) -> str:
    require(isinstance(value, str) and bool(ISO_RE.match(value)),
            f'{label} is not an ISO-8601 UTC stamp ({value!r})')
    return value


def finite_number(value, label: str) -> float:
    require(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value),
            f'{label} is not a finite number ({value!r})')
    return float(value)


def numeric_value(value, label: str) -> float:
    """A number, or a numeric string: the SBDB publishes epoch/tp as full-precision strings."""
    if isinstance(value, str):
        try:
            number = float(value)
        except ValueError as exc:
            raise BuildError(f'{label} is not numeric ({value!r})') from exc
        require(math.isfinite(number), f'{label} is not finite ({value!r})')
        return number
    return finite_number(value, label)


def check_freshness(generated_at: str, label: str, now: datetime | None = None) -> list[str]:
    """Fail on a stale artifact, warn on one that is merely old.  Returns the warnings."""
    valid_iso(generated_at, f'{label}.generated_at')
    age = ((now or datetime.now(timezone.utc)) - parse_iso(generated_at)).total_seconds() / 86400.0
    require(age <= GENERATED_AT_FAIL_DAYS,
            f'{label}.generated_at is {age:.1f} days old (hard limit {GENERATED_AT_FAIL_DAYS})')
    if age > GENERATED_AT_WARN_DAYS:
        return [f'{label}.generated_at is {age:.1f} days old (warn threshold '
                f'{GENERATED_AT_WARN_DAYS})']
    return []


def validate_provenance_block(block: dict, label: str, required: tuple[str, ...]) -> None:
    require(isinstance(block, dict), f'{label} is missing')
    for key in required:
        require(block.get(key) not in (None, '', [], {}), f'{label}.{key} is missing or empty')
    valid_iso(block.get('retrieved_at'), f'{label}.retrieved_at')


def validate_elements(elements: dict, label: str) -> None:
    require(isinstance(elements, dict), f'{label}.elements is missing')
    for key in ('epoch', 'epoch_iso', 'e', 'q', 'i', 'om', 'w', 'tp', 'tp_iso', 'source',
                'n_obs_used', 'first_obs', 'last_obs'):
        require(key in elements, f'{label}.elements.{key} is missing')
    e = finite_number(elements['e'], f'{label}.elements.e')
    require(0.0 <= e <= 5.0, f'{label}.elements.e {e} outside [0,5]')
    q = finite_number(elements['q'], f'{label}.elements.q')
    require(0.0 < q <= MAX_AU, f'{label}.elements.q {q} outside (0,{MAX_AU}]')
    inc = finite_number(elements['i'], f'{label}.elements.i')
    require(0.0 <= inc <= 180.0, f'{label}.elements.i {inc} outside [0,180]')
    finite_number(elements['om'], f'{label}.elements.om')
    finite_number(elements['w'], f'{label}.elements.w')
    numeric_value(elements['tp'], f'{label}.elements.tp')
    numeric_value(elements['epoch'], f'{label}.elements.epoch')
    if elements.get('a') is None:
        require(e >= 1.0, f'{label}.elements.a is null for an elliptical orbit')
    else:
        finite_number(elements['a'], f'{label}.elements.a')
    if elements.get('per_years') is not None:
        require(finite_number(elements['per_years'], f'{label}.elements.per_years') > 0.0,
                f'{label}.elements.per_years must be positive')
    valid_iso(elements['epoch_iso'], f'{label}.elements.epoch_iso')
    valid_iso(elements['tp_iso'], f'{label}.elements.tp_iso')
    for key in ('first_obs', 'last_obs'):
        require(len(str(elements[key])) == 10, f'{label}.elements.{key} is not a calendar date')
    require(elements['source'] == ELEMENT_SOURCE, f'{label}.elements.source is not {ELEMENT_SOURCE}')


def validate_brightness(brightness: dict, label: str, horizon_start: str) -> None:
    require(isinstance(brightness, dict), f'{label}.brightness is missing')
    absolute = brightness.get('absolute') or {}
    for key in ('M1', 'K1', 'source'):
        require(absolute.get(key) is not None, f'{label}.brightness.absolute.{key} is missing')
    finite_number(absolute['M1'], f'{label}.brightness.absolute.M1')
    finite_number(absolute['K1'], f'{label}.brightness.absolute.K1')
    predicted = brightness.get('predicted')
    require(isinstance(predicted, dict), f'{label}.brightness.predicted is missing')
    finite_number(predicted.get('magnitude'), f'{label}.brightness.predicted.magnitude')
    valid_iso(predicted.get('at'), f'{label}.brightness.predicted.at')
    require(predicted.get('model') == BRIGHTNESS_MODEL,
            f'{label}.brightness.predicted.model is not the documented model')
    require(isinstance(predicted.get('caveat'), str) and predicted['caveat'],
            f'{label}.brightness.predicted.caveat is missing: a prediction must be labelled')
    measured = brightness.get('measured')
    require(isinstance(measured, dict), f'{label}.brightness.measured is missing')
    require(isinstance(measured.get('observed'), bool),
            f'{label}.brightness.measured.observed is not a boolean')
    latest = measured.get('latest')
    if latest:
        require(measured['observed'] is True, f'{label}: a latest observation but observed is false')
        finite_number(latest.get('magnitude'), f'{label}.measured.latest.magnitude')
        valid_iso(latest.get('date'), f'{label}.measured.latest.date')
        require(latest.get('method') in ('visual', 'CCD', 'mixed'),
                f'{label}.measured.latest.method is not a validated method name')
        require(latest.get('source') == 'COBS', f'{label}.measured.latest.source is not COBS')
        require(set(latest.get('methods') or []) <= {'visual', 'CCD'},
                f'{label}.measured.latest.methods is not a visual/CCD set')
        # A measurement must be a past observation: the predicted value is always an ephemeris
        # sample inside the horizon, so a measured value that carries the prediction's timestamp
        # (or sits in the future) would have been copied rather than observed.
        require(days_between(horizon_start, latest['date']) <= 1.0,
                f'{label}.measured.latest.date {latest["date"]} is after the horizon start '
                f'{horizon_start}: a measurement cannot be in the future')
        require(not (latest.get('magnitude') == predicted.get('magnitude')
                     and latest.get('date') == predicted.get('at')),
                f'{label}: the measured magnitude and timestamp are the prediction, not an observation')
    else:
        require(measured['observed'] is False, f'{label}: no latest observation but observed is true')
        require(isinstance(measured.get('latest_reason'), str) and measured['latest_reason'],
                f'{label}: an absent observation needs a documented reason')


def validate_measured_statistics(measured: dict, label: str) -> None:
    counts = measured.get('count') or {}
    for key in ('visual', 'ccd', 'total'):
        require(isinstance(counts.get(key), int), f'{label}.measured.count.{key} is not an integer')
    require(counts.get('total') == counts.get('visual', 0) + counts.get('ccd', 0),
            f'{label}.measured.count.total does not equal visual+ccd')
    require(measured.get('window_days') == COBS_WINDOW_DAYS,
            f'{label}.measured.window_days is not {COBS_WINDOW_DAYS}')
    if measured.get('trend') is None:
        require(isinstance(measured.get('trend_reason'), str) and measured['trend_reason'],
                f'{label}: a null trend needs a documented reason')
    else:
        trend = measured['trend']
        finite_number(trend.get('magnitudes_per_day'), f'{label}.measured.trend.magnitudes_per_day')
        require(isinstance(trend.get('points'), int) and trend['points'] >= COBS_MIN_TREND_POINTS,
                f'{label}.measured.trend.points is below the published minimum')
        require(finite_number(trend.get('span_days'), f'{label}.measured.trend.span_days')
                >= COBS_MIN_TREND_SPAN_DAYS, f'{label}.measured.trend span is too short')
        require(trend.get('direction') in ('brightening', 'fading', 'flat'),
                f'{label}.measured.trend.direction is not one of the documented values')
        require(bool(trend.get('method')), f'{label}.measured.trend.method is missing')
    if measured.get('median_30d'):
        median = measured['median_30d']
        finite_number(median.get('magnitude'), f'{label}.measured.median_30d.magnitude')
        for key in ('visual_count', 'ccd_count'):
            require(isinstance(median.get(key), int), f'{label}.measured.median_30d.{key} is not int')
        require(median['visual_count'] + median['ccd_count'] >= 1,
                f'{label}.measured.median_30d records no contributing observation')
    else:
        require(isinstance(measured.get('median_30d_reason'), str) and measured['median_30d_reason'],
                f'{label}: an absent 30-day median needs a documented reason')


def validate_ephemeris_artifact(ephemeris: dict, comets: list[dict], horizon: dict) -> dict:
    """Every published comet needs a matching ephemeris entry, and every sample must be usable."""
    require(ephemeris.get('schema') == EPHEMERIS_SCHEMA,
            f'ephemeris schema {ephemeris.get("schema")!r} != {EPHEMERIS_SCHEMA!r}')
    warnings = check_freshness(ephemeris.get('generated_at'), 'comet-ephemerides.json')
    require(ephemeris.get('frame') == EPHEMERIS_FRAME, 'ephemeris.frame is not the documented frame')
    require(isinstance(ephemeris.get('step_hours'), int) and ephemeris['step_hours'] > 0,
            'ephemeris.step_hours is not a positive integer')
    validate_provenance_block(ephemeris.get('source'), 'ephemeris.source',
                             ('name', 'url', 'retrieved_at', 'query_template'))
    requested_days = float(horizon['days'])
    entries = ephemeris.get('comets')
    require(isinstance(entries, dict), 'ephemeris.comets is not an object')
    published = {comet['id'] for comet in comets}
    require(set(entries) == published,
            'the ephemeris artifact and comets.json list different comets: '
            f'only in ephemeris {sorted(set(entries) - published)}, '
            f'only in comets.json {sorted(published - set(entries))}')
    samples = 0
    for ident, entry in entries.items():
        label = f'ephemeris.comets[{ident}]'
        require(entry.get('start') == horizon['start'], f'{label}.start is not the horizon start')
        step = entry.get('step_hours')
        # A step that divides 24 h or is a whole number of days keeps every sample on a whole hour
        # (and on 00:00 UTC when the step is a multiple of 24 h), which the fixture cross-check and
        # the browser's time handling both rely on.
        require(isinstance(step, int) and step > 0 and (24 % step == 0 or step % 24 == 0),
                f'{label}.step_hours {step!r} is neither a divisor of 24 nor a multiple of 24')
        require(step <= ephemeris['step_hours'],
                f'{label}.step_hours {step} exceeds the requested maximum')
        require(entry.get('columns') == EPHEMERIS_COLUMNS, f'{label}.columns is not documented')
        require(isinstance(entry.get('interpolation'), str) and entry['interpolation'],
                f'{label}.interpolation is missing')
        deviation = finite_number(entry.get('interpolation_max_deviation_deg'),
                                  f'{label}.interpolation_max_deviation_deg')
        require(deviation <= INTERPOLATION_MAX_DEG,
                f'{label}: linear interpolation would deviate by {deviation} deg mid-way '
                f'(limit {INTERPOLATION_MAX_DEG})')
        points = entry.get('points')
        require(isinstance(points, list) and len(points) >= MIN_EPHEMERIS_POINTS,
                f'{label} has fewer than {MIN_EPHEMERIS_POINTS} points')
        require(entry.get('point_count') == len(points),
                f'{label}.point_count {entry.get("point_count")} != {len(points)} points')
        previous = None
        for index, point in enumerate(points):
            spot = f'{label}.points[{index}]'
            require(isinstance(point, list) and len(point) == len(EPHEMERIS_COLUMNS),
                    f'{spot} is not a {len(EPHEMERIS_COLUMNS)}-element array')
            stamp = valid_iso(point[0], f'{spot}[0]')
            ra = finite_number(point[1], f'{spot}[1]')
            dec = finite_number(point[2], f'{spot}[2]')
            r = finite_number(point[3], f'{spot}[3]')
            delta = finite_number(point[4], f'{spot}[4]')
            require(0.0 <= ra < 360.0, f'{spot} RA {ra} outside [0,360)')
            require(-90.0 <= dec <= 90.0, f'{spot} dec {dec} outside [-90,90]')
            require(0.0 < r <= MAX_AU, f'{spot} r {r} outside (0,{MAX_AU}]')
            require(0.0 < delta <= MAX_AU, f'{spot} delta {delta} outside (0,{MAX_AU}]')
            require(horizon['start'] <= stamp <= horizon['end'],
                    f'{spot} {stamp} is outside the published horizon')
            if previous is not None:
                require(stamp > previous, f'{spot} {stamp} does not follow {previous}')
            previous = stamp
        span = days_between(points[0][0], points[-1][0])
        require(span >= HORIZON_COVERAGE_MIN * requested_days,
                f'{label} covers {span:.1f} of {requested_days:.0f} days '
                f'(minimum {HORIZON_COVERAGE_MIN:.0%})')
        samples += len(points)
    return {'ephemeris_comets': len(entries), 'samples': samples, 'warnings': warnings}


def fetch_one_sha(block: dict, label: str) -> None:
    require(isinstance(block, dict), f'{label} is missing')
    require(bool(SHA256_RE.match(str(block.get('sha256') or ''))),
            f'{label}.sha256 is not a 64-character hex digest')
    valid_iso(block.get('retrieved_at'), f'{label}.retrieved_at')
    require(block.get('http_status') == 200, f'{label}.http_status is not 200')


def validate_fixture_comet(comet: dict) -> list[float]:
    """Structural checks for one fixture comet; returns its epoch offsets in days."""
    label = f'fixture.comets[{comet.get("id")}]'
    for key in ('id', 'designation', 'kind', 'element_epoch_jd', 'element_epoch_iso', 'tp_jd',
                'tp_iso', 'samples', 'elements'):
        require(comet.get(key) is not None, f'{label}.{key} is missing')
    valid_iso(comet['element_epoch_iso'], f'{label}.element_epoch_iso')
    valid_iso(comet['tp_iso'], f'{label}.tp_iso')
    finite_number(comet['element_epoch_jd'], f'{label}.element_epoch_jd')
    finite_number(comet['tp_jd'], f'{label}.tp_jd')
    elements = comet['elements']
    for key in ('e', 'q', 'i', 'om', 'w'):
        finite_number(elements.get(key), f'{label}.elements.{key}')
    require(0.0 < float(elements['q']) <= MAX_AU, f'{label}.elements.q out of range')
    require(0.0 <= float(elements['i']) <= 180.0, f'{label}.elements.i out of range')
    require(0.0 <= float(elements['e']) <= 5.0, f'{label}.elements.e out of range')
    fetch_one_sha(comet.get('sbdb_api') or {}, f'{label}.sbdb_api')
    samples = comet['samples']
    require(len(samples) >= 4, f'{label} needs at least 4 Horizons samples')
    offsets = []
    for index, sample in enumerate(samples):
        spot = f'{label}.samples[{index}]'
        fetch_one_sha(sample, spot)
        valid_iso(sample.get('utc'), f'{spot}.utc')
        query = str(sample.get('horizons_query') or '')
        require(query.startswith('format=text&COMMAND='),
                f'{spot}.horizons_query is not the parameter string of a Horizons request')
        require("'DES=" in query and ';CAP' in query,
                f'{spot}.horizons_query is not a comet designation query with ;CAP')
        ra = finite_number(sample.get('ra_deg'), f'{spot}.ra_deg')
        dec = finite_number(sample.get('dec_deg'), f'{spot}.dec_deg')
        r = finite_number(sample.get('r_au'), f'{spot}.r_au')
        delta = finite_number(sample.get('delta_au'), f'{spot}.delta_au')
        require(0.0 <= ra < 360.0, f'{spot} RA {ra} outside [0,360)')
        require(-90.0 <= dec <= 90.0, f'{spot} dec {dec} outside [-90,90]')
        require(0.0 < r <= MAX_AU, f'{spot} r {r} outside (0,{MAX_AU}]')
        require(0.0 < delta <= MAX_AU, f'{spot} delta {delta} outside (0,{MAX_AU}]')
        offset = finite_number(sample.get('epoch_offset_days'), f'{spot}.epoch_offset_days')
        require(abs(offset - (jd_from_iso(sample['utc']) - comet['element_epoch_jd'])) < 0.01,
                f'{spot}.epoch_offset_days does not match utc minus element_epoch_jd')
        offsets.append(offset)
    require(any(abs(offset) <= 200.0 for offset in offsets),
            f'{label} has no sample within 200 days of the element epoch')
    require(any(300.0 <= abs(offset) <= 800.0 for offset in offsets),
            f'{label} has no sample 300-800 days from the element epoch')
    return offsets


def cross_check_fixture(fixture: dict, ephemeris: dict | None) -> tuple[int, int]:
    """Compare fixture samples with the published ephemerides where comet and date coincide."""
    compared, checked = 0, 0
    pairs = (fixture.get('cross_check') or {}).get('pairs') or []
    for pair in pairs:
        ident, stamp = pair.get('comet'), pair.get('t_iso')
        if not ephemeris or ident not in (ephemeris.get('comets') or {}):
            continue
        points = {point[0]: point for point in ephemeris['comets'][ident]['points']}
        if stamp not in points:
            continue
        checked += 1
        for comet in fixture.get('comets') or []:
            if comet['id'] != ident:
                continue
            for sample in comet['samples']:
                if sample['utc'] != stamp:
                    continue
                point = points[stamp]
                require(abs(sample['ra_deg'] - point[1]) <= 0.01,
                        f'fixture/artifact RA mismatch for {ident} at {stamp}: '
                        f'{sample["ra_deg"]} vs {point[1]}')
                require(abs(sample['dec_deg'] - point[2]) <= 0.01,
                        f'fixture/artifact dec mismatch for {ident} at {stamp}: '
                        f'{sample["dec_deg"]} vs {point[2]}')
                require(abs(sample['delta_au'] - point[4]) <= 0.001,
                        f'fixture/artifact delta mismatch for {ident} at {stamp}: '
                        f'{sample["delta_au"]} vs {point[4]}')
                compared += 1
    require(checked == compared,
            f'{checked} declared fixture/artifact cross-check pairs, only {compared} comparable')
    return checked, compared


def validate_fixture(fixture: dict, ephemeris: dict | None) -> dict:
    """Structural validation of the offline fixture, plus the cross-check against the artifact."""
    require(isinstance(fixture, dict), 'the fixture is not an object')
    require(fixture.get('schema') == FIXTURE_SCHEMA,
            f'fixture schema {fixture.get("schema")!r} != {FIXTURE_SCHEMA!r}')
    valid_iso(fixture.get('generated_at'), 'fixture.generated_at')
    rows = fixture.get('sbdb_rows') or {}
    fetch_one_sha(rows, 'fixture.sbdb_rows')
    require(isinstance(rows.get('fields'), list) and rows['fields'],
            'fixture.sbdb_rows.fields is empty')
    require(isinstance(rows.get('rows'), list) and len(rows['rows']) >= MIN_COMETS,
            'fixture.sbdb_rows.rows is too short to have driven candidate selection')
    for index, row in enumerate(rows['rows']):
        require(isinstance(row, list) and len(row) == len(rows['fields']),
                f'fixture.sbdb_rows.rows[{index}] does not match the field list')
    for index, sample in enumerate(fixture.get('cobs_samples') or []):
        fetch_one_sha(sample, f'fixture.cobs_samples[{index}]')
        require(isinstance(sample.get('payload'), dict),
                f'fixture.cobs_samples[{index}].payload is not the raw JSON object')
        require(str(sample.get('query') or ''), f'fixture.cobs_samples[{index}].query is empty')
    comets = fixture.get('comets')
    require(isinstance(comets, list) and len(comets) >= 3, 'the fixture needs at least 3 comets')
    offsets = {comet.get('id'): validate_fixture_comet(comet) for comet in comets}
    checked, compared = cross_check_fixture(fixture, ephemeris)
    return {'fixture_comets': len(comets), 'cross_check_pairs': checked, 'compared': compared,
            'epoch_offsets': {key: [min(value), max(value)] for key, value in offsets.items()}}


def validate_artifact(data: dict, ephemeris: dict | None = None, fixture: dict | None = None,
                      now: datetime | None = None) -> dict:
    """Raise BuildError unless the artifacts satisfy every documented invariant."""
    require(isinstance(data, dict), 'comets.json is not an object')
    require(data.get('schema') == SCHEMA, f'schema {data.get("schema")!r} != {SCHEMA!r}')
    warnings = check_freshness(data.get('generated_at'), 'comets.json', now)
    horizon = data.get('horizon') or {}
    valid_iso(horizon.get('start'), 'horizon.start')
    valid_iso(horizon.get('end'), 'horizon.end')
    require(isinstance(horizon.get('days'), int) and horizon['days'] > 0,
            'horizon.days is not a positive integer')
    require(horizon['days'] <= HORIZON_DAYS_RANGE[1],
            f'horizon.days {horizon["days"]} exceeds {HORIZON_DAYS_RANGE[1]}')
    require(abs(days_between(horizon['start'], horizon['end']) - horizon['days']) < 1e-6,
            'horizon.end is not horizon.start + horizon.days')
    sources = data.get('sources') or {}
    validate_provenance_block(sources.get('elements'), 'sources.elements',
                             ('name', 'url', 'query', 'retrieved_at', 'row_count', 'sha256'))
    require(bool(SHA256_RE.match(str(sources['elements'].get('sha256') or ''))),
            'sources.elements.sha256 is not a 64-character hex digest')
    require(isinstance(sources['elements'].get('row_count'), int)
            and sources['elements']['row_count'] >= MIN_COMETS,
            'sources.elements.row_count is not a positive integer')
    validate_provenance_block(sources.get('ephemeris'), 'sources.ephemeris',
                             ('name', 'url', 'parameters', 'retrieved_at', 'frame', 'step_hours'))
    validate_provenance_block(sources.get('observations'), 'sources.observations',
                             ('name', 'url', 'api_version', 'retrieved_at', 'note'))
    require(data.get('thresholds') == THRESHOLDS,
            'thresholds are missing or differ from the documented values')
    noteworthy = data.get('noteworthy') or {}
    for key in ('new_objects', 'brightened', 'faded', 'orbit_updates', 'approaching_minimum_delta'):
        require(isinstance(noteworthy.get(key), list), f'noteworthy.{key} is not a list')
    require(isinstance(noteworthy.get('basis'), str) and noteworthy['basis'],
            'noteworthy.basis is missing: the comparison must be stated')
    notes = data.get('notes')
    require(isinstance(notes, list) and notes, 'notes is empty')
    skipped = 0
    for note in notes:
        require(isinstance(note, str) and note, 'a note is empty')
        if note.startswith(NOTES_EPHEMERIS_SKIP_PREFIX):
            skipped += 1
            require(len(note) > len(NOTES_EPHEMERIS_SKIP_PREFIX) + 3,
                    f'a skipped-comet note has no reason: {note!r}')
    comets = data.get('comets')
    require(isinstance(comets, list), 'comets is not a list')
    require(len(comets) >= MIN_COMETS,
            f'only {len(comets)} comets published, at least {MIN_COMETS} are required')
    ids = [comet.get('id') for comet in comets]
    require(len(set(ids)) == len(ids), 'comet ids are not unique: ' + ', '.join(sorted(
        {ident for ident in ids if ids.count(ident) > 1})))
    for comet in comets:
        label = f'comets[{comet.get("id")}]'
        for key in ('id', 'name', 'designation', 'kind', 'elements', 'brightness', 'geometry',
                    'caveats', 'links', 'provenance'):
            require(comet.get(key), f'{label}.{key} is missing')
        validate_elements(comet['elements'], label)
        validate_brightness(comet['brightness'], label, horizon['start'])
        validate_measured_statistics(comet['brightness']['measured'], label)
        geometry = comet['geometry']
        valid_iso(geometry.get('peak_brightness_at'), f'{label}.geometry.peak_brightness_at')
        valid_iso(geometry.get('min_delta_at'), f'{label}.geometry.min_delta_at')
        valid_iso(geometry.get('perihelion_iso'), f'{label}.geometry.perihelion_iso')
        delta = finite_number(geometry.get('min_delta_au'), f'{label}.geometry.min_delta_au')
        require(0.0 < delta <= MAX_AU, f'{label}.geometry.min_delta_au {delta} out of range')
        require(bool(geometry.get('source')), f'{label}.geometry.source is missing')
        require(isinstance(comet['caveats'], list) and comet['caveats'],
                f'{label}.caveats is empty: every comet must state its limits')
        provenance = comet['provenance']
        for key in ('elements', 'ephemeris', 'brightness_model'):
            require(isinstance(provenance.get(key), str) and provenance[key],
                    f'{label}.provenance.{key} is missing')
        require('SBDB' in provenance['elements'], f'{label}.provenance.elements names no source')
        require('Horizons' in provenance['ephemeris'], f'{label}.provenance.ephemeris names no source')
        for key in ('sbdb', 'horizons'):
            require(str((comet['links'] or {}).get(key) or '').startswith('https://'),
                    f'{label}.links.{key} is not an https URL')
    summary = {'comets': len(comets), 'skipped': skipped, 'warnings': warnings}
    if ephemeris is None:
        return summary
    summary.update(validate_ephemeris_artifact(ephemeris, comets, horizon))
    if fixture is not None:
        summary['fixture'] = validate_fixture(fixture, ephemeris)
    return summary


def rederive_offline(data: dict, ephemeris: dict) -> dict:
    """Recompute this artifact's derived values from its own published numbers, with no network.

    This is what `--no-network` adds on top of `--check`: it proves the published predictions and
    geometry really are the documented model applied to the published samples, and it re-runs the
    local two-body propagation against the Horizons samples to restate the model's measured error.
    """
    result = {'comets': 0, 'max_predicted_mag_delta': 0.0, 'max_min_delta_delta_au': 0.0,
              'max_kepler_mag_delta': 0.0, 'max_kepler_r_delta_au': 0.0,
              'separations_arcmin': []}
    for comet in data['comets']:
        ident = comet['id']
        points = ephemeris['comets'][ident]['points']
        absolute = comet['brightness']['absolute']
        m1, k1 = float(absolute['M1']), float(absolute['K1'])
        magnitudes = [total_magnitude(m1, k1, point[3], point[4]) for point in points]
        brightest = min(magnitudes)
        predicted = comet['brightness']['predicted']
        result['max_predicted_mag_delta'] = max(
            result['max_predicted_mag_delta'], abs(brightest - float(predicted['magnitude'])))
        require(abs(brightest - float(predicted['magnitude'])) <= 0.01,
                f'{ident}: predicted.magnitude is not the model value at the brightest sample')
        stamps = [point[0] for point in points]
        require(predicted['at'] in stamps, f'{ident}: predicted.at is not a published sample')
        peak_index = stamps.index(predicted['at'])
        require(abs(magnitudes[peak_index] - brightest) <= 0.005,
                f'{ident}: predicted.at is not a sample where the model is (tied for) brightest')
        deltas = [point[4] for point in points]
        nearest = min(deltas)
        result['max_min_delta_delta_au'] = max(
            result['max_min_delta_delta_au'], abs(float(comet['geometry']['min_delta_au']) - nearest))
        require(abs(float(comet['geometry']['min_delta_au']) - nearest) <= 5e-5,
                f'{ident}: geometry.min_delta_au is not the smallest published delta')
        # A very flat minimum means several samples tie once the published 6-decimal delta is used
        # (measured: 260P's two nearest samples differ by 1.5e-7 au), so accept any tied sample.
        tied = {point[0] for point in points if abs(point[4] - nearest) <= 1e-6}
        require(comet['geometry']['min_delta_at'] in tied,
                f'{ident}: geometry.min_delta_at is not a sample at the published minimum distance')
        elements = comet['elements']
        for key, stamp in (('epoch', 'epoch_iso'), ('tp', 'tp_iso')):
            require(iso_from_jd(float(elements[key])) == elements[stamp],
                    f'{ident}: elements.{stamp} is not the calendar form of elements.{key}')
        result['comets'] += 1
        jd = jd_from_iso(predicted['at']) + TDB_MINUS_UTC_DAYS
        geo = geocentric(elements, jd)
        kepler_mag = total_magnitude(m1, k1, geo['r_au'], geo['delta_au'])
        result['max_kepler_mag_delta'] = max(result['max_kepler_mag_delta'],
                                             abs(kepler_mag - float(predicted['magnitude'])))
        result['max_kepler_r_delta_au'] = max(result['max_kepler_r_delta_au'],
                                              abs(geo['r_au'] - points[peak_index][3]))
        result['separations_arcmin'].append(round_half_up(separation_arcmin(
            geo['ra_deg'], geo['dec_deg'], points[peak_index][1], points[peak_index][2]), 3))
    if result['separations_arcmin']:
        result['max_separation_arcmin'] = max(result['separations_arcmin'])
    return result


# --------------------------------------------------------------------------------------- publishing
def write_atomic(path: Path, text: str) -> None:
    """Publish via temp file + rename so a failure never leaves a corrupt artifact behind."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.tmp')
    temp.write_text(text, encoding='utf-8')
    os.replace(temp, path)


def dump(payload: dict) -> str:
    return json.dumps(payload, indent=2, ensure_ascii=False) + '\n'


def load_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as exc:
        print(f'note: {path} is not readable JSON ({exc}); treating it as absent', file=sys.stderr)
        return None


def relpath(path: Path) -> str:
    try:
        return str(Path(path).resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def read_artifacts(args) -> tuple[dict, dict, dict | None]:
    """Load comets.json, comet-ephemerides.json and (when present) the fixture."""
    comets = load_json(args.out)
    if comets is None:
        raise BuildError(f'{args.out} does not exist or is not JSON; run the build first')
    ephemeris = load_json(args.ephemeris_out)
    if ephemeris is None:
        raise BuildError(f'{args.ephemeris_out} does not exist or is not JSON; run the build first')
    fixture = load_json(args.fixture)
    if fixture is None and Path(args.fixture).exists():
        raise BuildError(f'{args.fixture} exists but is not readable JSON')
    if fixture is None:
        print(f'note: no fixture at {args.fixture}; validating the artifacts alone', file=sys.stderr)
    return comets, ephemeris, fixture


def run_check(args) -> int:
    """Offline validation of the committed artifacts (and the fixture, when present)."""
    comets, ephemeris, fixture = read_artifacts(args)
    summary = validate_artifact(comets, ephemeris, fixture)
    for warning in summary['warnings']:
        print(f'warning: {warning}', file=sys.stderr)
    print(f'OK {relpath(args.out)}: schema {comets["schema"]}, {summary["comets"]} comets, '
          f'{summary["samples"]} ephemeris samples, {summary["skipped"]} documented skips')
    if fixture is not None:
        detail = summary['fixture']
        print(f'OK {relpath(args.fixture)}: schema {fixture["schema"]}, '
              f'{detail["fixture_comets"]} comets, {detail["compared"]} fixture/artifact '
              f'cross-check pair(s) compared')
    return 0


def run_no_network(args) -> int:
    """Revalidate and re-derive the committed artifacts offline: no request is made."""
    comets, ephemeris, fixture = read_artifacts(args)
    summary = validate_artifact(comets, ephemeris, fixture)
    derived = rederive_offline(comets, ephemeris)
    print(f'OK {relpath(args.out)}: schema {comets["schema"]}, {summary["comets"]} comets, '
          f'{summary["samples"]} ephemeris samples, {summary["skipped"]} documented skips '
          '(validated offline)')
    print(f'OK re-derived from the published numbers: max |predicted magnitude - model(sample)| '
          f'{derived["max_predicted_mag_delta"]:.4f} mag, max |min_delta_au - smallest published '
          f'delta| {derived["max_min_delta_delta_au"]:.6f} au')
    print(f'OK local two-body propagation vs the Horizons samples at each peak: '
          f'{"max " + format(derived.get("max_separation_arcmin", 0.0), ".2f") + " arcmin" if derived["separations_arcmin"] else "not evaluated"}, '
          f'r agrees to {derived["max_kepler_r_delta_au"]:.5f} au, the magnitude model using the '
          f'propagated geometry differs by {derived["max_kepler_mag_delta"]:.3f} mag')
    for warning in summary['warnings']:
        print(f'warning: {warning}', file=sys.stderr)
    return 0


# ----------------------------------------------------------------------------------- fixture builder
# The fixture is a pinned offline reference, so it is refreshed by an explicit mode instead of on
# every build: its sample dates are chosen relative to each comet's own SBDB element epoch (which
# only changes when JPL republishes a solution), and one sample per comet that is also published in
# comet-ephemerides.json is aligned to that artifact's sample grid so the two can be cross-checked.
FIXTURE_COMETS = (
    {'id': '2P', 'why': 'Jupiter-family numbered short-period comet, e=0.847',
     'offsets': (9, 78, 433), 'align_with_artifact': True},
    {'id': 'C/2026 A2', 'why': 'near-parabolic long-period comet, e=0.9976 (a=818 au)',
     'offsets': (-110, 150, 420, 900)},
    {'id': 'C/2026 O1', 'why': 'hyperbolic comet, e=1.0010 (a=-1578 au)',
     'offsets': (-90, 120, 400, 730)},
    {'id': 'P/2026 R1', 'why': 'low-eccentricity short-period comet, e=0.427',
     'offsets': (-60, 60, 400, 700)},
)


def fetch_sbdb_object(fetcher: Fetcher, pdes: str) -> dict:
    """Full-precision elements of one object from sbdb.api (the fixture's element reference)."""
    params = {'sstr': pdes, 'full-prec': 'true'}
    result = fetcher.get(SBDB_OBJECT_URL, params)
    provenance = {'url': result['url'], 'query': query_string(params),
                  'http_status': result['status'], 'retrieved_at': utc_now(),
                  'bytes': len(result['body']), 'sha256': sha256(result['body']) if result['body'] else None}
    require(result['status'] == 200, f'SBDB object lookup for {pdes} failed: {result["error"]}')
    payload = json.loads(result['body'].decode('utf-8'))
    obj = payload.get('object') or {}
    require(str(obj.get('des') or '') == pdes,
            f'SBDB resolved {pdes} to {obj.get("des")!r}; refusing to build a fixture for that')
    orbit = payload.get('orbit') or {}
    values = {element.get('name'): element.get('value') for element in orbit.get('elements') or []}
    epoch, tp = to_float(orbit.get('epoch')), to_float(values.get('tp'))
    require(epoch is not None and tp is not None, f'SBDB gave {pdes} no epoch or tp')
    elements = {key: to_float(values.get(key))
                for key in ('e', 'a', 'q', 'i', 'om', 'w', 'tp', 'per')}
    for key in ('e', 'q', 'i', 'om', 'w', 'tp'):
        require(elements[key] is not None, f'SBDB element {key} is missing for {pdes}')
    return {'provenance': provenance, 'object': obj, 'orbit': orbit, 'elements': elements,
            'equinox': orbit.get('equinox'), 'epoch': epoch, 'tp': tp,
            'orbit_id': orbit.get('orbit_id'), 'soln_date': orbit.get('soln_date'),
            'n_obs_used': orbit.get('n_obs_used'), 'first_obs': orbit.get('first_obs'),
            'last_obs': orbit.get('last_obs'), 'reference': orbit.get('reference')}


def fixture_sample_ucs(offsets: tuple, epoch_jd: float, artifact_date: str | None) -> list[str]:
    """Sample instants (ISO UTC) from day offsets, plus an artifact-aligned instant when given."""
    stamps = [f'{iso_day(epoch_jd + offset)}T00:00:00Z' for offset in offsets]
    if artifact_date and artifact_date.endswith('T00:00:00Z') and artifact_date not in stamps:
        stamps.append(artifact_date)
    return sorted(set(stamps))


def fixture_horizons_sample(fetcher: Fetcher, pdes: str, stamp: str, sleep: float,
                            spkid: str | None = None) -> dict:
    """One single-instant Horizons ephemeris row for the fixture (a 1-day window, first row)."""
    day = stamp[:10]
    stop = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
    last_error = ''
    for option in (pdes, spkid):
        if option is None:
            continue
        params = horizons_params(option, day, stop, 24)
        fetcher.pause(sleep)
        result = fetcher.get(HORIZONS_URL, params)
        require(result['status'] == 200,
                f'Horizons fixture sample for {pdes} at {day} failed: {result["error"]}')
        rows = horizons_body_rows(result['body'])
        if not rows:
            last_error = horizons_body_error(result['body'])
            continue
        sample = None
        for line in rows:
            candidate = parse_horizons_row(line)
            if candidate and candidate['t_iso'] == stamp:
                sample = candidate
                break
        if sample is None:
            last_error = f'no row at {stamp}'
            continue
        return {'utc': stamp, 'ra_deg': sample['ra_deg'], 'dec_deg': sample['dec_deg'],
                'r_au': sample['r_au'], 'delta_au': sample['delta_au'],
                'horizons_query': query_string(params), 'horizons_url': result['url'],
                'http_status': result['status'], 'retrieved_at': utc_now(),
                'sha256': sha256(result['body']), 'bytes': len(result['body']),
                'target': horizons_body_target(result['body'])}
    raise BuildError(f'Horizons returned no usable row for {pdes} at {stamp}: {last_error}')


def propagator_check(elements: dict, samples: list[dict]) -> dict:
    """Run the local two-body propagation against the fixture's Horizons rows (the model contract)."""
    per_sample = []
    for sample in samples:
        jd = jd_from_iso(sample['utc']) + TDB_MINUS_UTC_DAYS
        geo = geocentric(elements, jd)
        per_sample.append({
            'utc': sample['utc'],
            'ra_deg': round_half_up(geo['ra_deg'], 6), 'dec_deg': round_half_up(geo['dec_deg'], 6),
            'r_au': round_half_up(geo['r_au'], 6), 'delta_au': round_half_up(geo['delta_au'], 6),
            'separation_arcmin': round_half_up(separation_arcmin(
                geo['ra_deg'], geo['dec_deg'], sample['ra_deg'], sample['dec_deg']), 4),
            'delta_error_au': round_half_up(geo['delta_au'] - sample['delta_au'], 6),
        })
    separations = [entry['separation_arcmin'] for entry in per_sample]
    return {'model': ('two-body Kepler propagation of the SBDB elements (elliptical/parabolic/'
                      'hyperbolic) + JPL/Standish EM Bary position, J2000 ecliptic -> equatorial'),
            'max_separation_arcmin': max(separations) if separations else None,
            'samples': per_sample,
            'note': ('measured error of the model the browser propagator repeats; it grows with the '
                     'time from the element epoch because this model has no non-gravitational '
                     'acceleration and no planetary perturbations')}


def fixture_cobs_samples(fetcher: Fetcher, published: list[str], window_start: str,
                         window_end: str, budget_bytes: int = 400_000) -> list[dict]:
    """Raw COBS obs_list.api payloads for one published comet, embedded verbatim in the fixture."""
    for ident in published[:4]:
        payloads = []
        for obs_type in ('V', 'C'):
            params = cobs_params(ident, obs_type, window_start, window_end, 1)
            result = fetcher.get(COBS_OBS_URL, params)
            entry = {'url': result['url'], 'query': query_string(params), 'comet': ident,
                     'obs_type': obs_type, 'page': 1, 'http_status': result['status'],
                     'retrieved_at': utc_now(), 'bytes': len(result['body']),
                     'sha256': sha256(result['body']) if result['body'] else None}
            if result['status'] != 200:
                break
            try:
                payload = json.loads(result['body'].decode('utf-8'))
            except (UnicodeDecodeError, json.JSONDecodeError):
                break
            if payload.get('code') is not None and str(payload['code']) not in ('200',):
                break
            entry['signature'] = payload.get('signature')
            entry['payload'] = payload
            payloads.append(entry)
        total = sum(item['bytes'] for item in payloads)
        if len(payloads) == 2 and total <= budget_bytes:
            return payloads
        if payloads and payloads[-1]['bytes'] <= budget_bytes // 2:
            return [payloads[-1]]
    return []


def fixture_query_template() -> str:
    """The per-sample Horizons parameter string used to build the fixture (a 1-day window)."""
    return query_string(horizons_params('<desig>', '<sample_date>', '<sample_date + 1 day>', 24))


def run_build_fixture(args) -> int:
    """Refresh tests/fixtures/overhead/horizons-comets.json (network required)."""
    generated_at = utc_now()
    run_date = (args.as_of or datetime.now(timezone.utc).date())
    fetcher = Fetcher(min_interval=COBS_REQUEST_GAP_S)
    rows, rows_provenance = fetch_sbdb_rows(fetcher, run_date, args.sbdb_window_days)
    window_start = (run_date - timedelta(days=args.sbdb_window_days)).isoformat()
    by_id = {}
    for record in rows:
        ident, _ = designation_parts(record.get('full_name') or '', record.get('pdes') or '')
        by_id.setdefault(ident, record)
    fields = SBDB_FIELDS.split(',')
    in_window = [row for row in rows
                 if len(str(row.get('last_obs') or '').strip()) == 10
                 and row['last_obs'] >= window_start]
    ephemeris_artifact = load_json(args.ephemeris_out)
    comets, cross_pairs, notes = [], [], []
    for spec in FIXTURE_COMETS:
        record = by_id.get(spec['id'])
        require(record is not None,
                f'{spec["id"]} is not in the current {args.sbdb_window_days}-day SBDB candidate '
                'window; refresh FIXTURE_COMETS with a designation that is (nothing was written)')
        pdes = (record.get('pdes') or '').strip()
        obj = fetch_sbdb_object(fetcher, pdes)
        align = None
        if spec.get('align_with_artifact') and ephemeris_artifact:
            entry = (ephemeris_artifact.get('comets') or {}).get(spec['id']) or {}
            if entry.get('points'):
                align = entry['points'][-1][0]
        stamps = fixture_sample_ucs(spec['offsets'], obj['epoch'], align)
        samples = [fixture_horizons_sample(fetcher, pdes, stamp, args.sleep,
                                           spkid=(obj['object'].get('spkid') or None))
                   for stamp in stamps]
        for sample in samples:
            sample['epoch_offset_days'] = round_half_up(jd_from_iso(sample['utc']) - obj['epoch'], 4)
        samples.sort(key=lambda sample: sample['utc'])
        elements = obj['elements']
        comets.append({
            'id': spec['id'], 'designation': (obj['object'].get('des') or pdes),
            'name': (obj['object'].get('fullname') or spec['id']),
            'kind': (obj['object'].get('kind') or ''), 'pdes': pdes,
            'orbit_class': (obj['object'].get('orbit_class') or {}).get('code'),
            'why': spec['why'], 'elements': elements, 'equinox': obj['equinox'],
            'element_epoch_jd': obj['epoch'], 'element_epoch_iso': iso_from_jd(obj['epoch']),
            'tp_jd': obj['tp'], 'tp_iso': iso_from_jd(obj['tp']), 'orbit_id': obj['orbit_id'],
            'n_obs_used': obj['n_obs_used'], 'first_obs': obj['first_obs'],
            'last_obs': obj['last_obs'],
            'sbdb_api': dict(obj['provenance'], reference=obj['reference'],
                             soln_date=obj['soln_date'], equinox=obj['equinox'],
                             epoch=obj['epoch'], tp=obj['tp'],
                             note='full-precision elements from ssd-api.jpl.nasa.gov/sbdb.api'),
            'samples': samples,
            'propagator_check': propagator_check(elements, samples),
        })
        if align:
            cross_pairs.append({'comet': spec['id'], 't_iso': align})
            notes.append(f'{spec["id"]}: one sample is aligned with the last sample of '
                         f'{relpath(args.ephemeris_out)} so the two artifacts can be cross-checked '
                         'at an identical instant')
    published = [comet['id'] for comet in (load_json(args.out) or {}).get('comets') or []]
    cobs_samples = (fixture_cobs_samples(fetcher, published,
                                         (run_date - timedelta(days=COBS_WINDOW_DAYS)).isoformat(),
                                         run_date.isoformat()) if published else [])
    if cobs_samples:
        notes.append('cobs_samples are the raw obs_list.api payloads for one published comet, '
                     'fetched with the same parameters as the build so the browser test can '
                     f're-derive its measured block: {cobs_samples[0]["comet"]} '
                     f'({", ".join(item["obs_type"] for item in cobs_samples)})')
    else:
        notes.append('no raw COBS payload is embedded: no published comet was available or the '
                     'payloads exceeded the size budget')
    fixture = {
        'schema': FIXTURE_SCHEMA, 'generated_at': generated_at,
        'generated_by': 'tools/overhead_comets_build.py --build-fixture',
        'purpose': ('offline reference for the browser-side comet propagator: a local two-body '
                    'propagation of the SBDB elements plus a JPL EM Bary position must reproduce '
                    'these Horizons rows, with no network access at test time'),
        'frame': EPHEMERIS_FRAME,
        'time_scale': ('sample instants are UTC; add 69.184 s (TT-UTC in 2026) before treating a '
                       'time as the TDB the elements are referred to'),
        'earth_model': {'model': 'JPL/Standish approximate positions, Table 1, EM Barycenter',
                        'url': EARTH_MODEL_URL, 'sha256': EARTH_MODEL_SHA256,
                        'retrieved_at': EARTH_MODEL_RETRIEVED_AT,
                        'stated_accuracy': ('20 arcsec longitude, 8 arcsec latitude, 6000 km '
                                            'distance over 1800-2050'),
                        'elements': {key: list(value) for key, value in EARTH_MODEL.items()},
                        'note': ('values at J2000 and per century, referred to the mean ecliptic '
                                 'and equinox of J2000')},
        'horizons_query_template': fixture_query_template(),
        'sbdb_rows': {
            'url': SBDB_QUERY_URL, 'query': rows_provenance['query'],
            'request_url': rows_provenance['request_url'],
            'retrieved_at': rows_provenance['retrieved_at'],
            'sha256': rows_provenance['sha256'], 'row_count': rows_provenance['row_count'],
            'http_status': rows_provenance['http_status'],
            'window_start': window_start, 'window_end': run_date.isoformat(),
            'fields': fields,
            'rows': [[row.get(field) for field in fields] for row in in_window],
            'note': ('the rows of the single SBDB comet query that fell inside the candidate '
                     'freshness window, verbatim (values as returned, still strings); this is the '
                     'row set candidate selection ran on'),
        },
        'cobs_samples': cobs_samples,
        'cross_check': {'artifact': relpath(args.ephemeris_out), 'pairs': cross_pairs,
                        'tolerance': {'ra_deg': 0.01, 'dec_deg': 0.01, 'delta_au': 0.001},
                        'note': ('these (comet, instant) pairs appear in both this fixture and the '
                                 'published ephemerides artifact and must agree within the '
                                 'tolerance above; if the artifact is refreshed with a different '
                                 'horizon, re-run --build-fixture to re-align')},
        'comets': comets,
        'notes': notes + [
            "sample dates are offsets from each comet's own SBDB element epoch, so the fixture "
            'keeps its meaning when JPL republishes an unrelated orbit',
            'each comet has at least one sample within 200 days of its element epoch and one '
            '300-800 days away',
            'propagator_check records what this build measured for the propagation contract on the '
            'exact numbers in this file; tests/overhead-comets-data.cjs recomputes it independently',
        ],
    }
    detail = validate_fixture(fixture, ephemeris_artifact)
    write_atomic(args.fixture, dump(fixture))
    print(f'wrote {relpath(args.fixture)}: {len(comets)} comets, '
          f'{sum(len(comet["samples"]) for comet in comets)} Horizons samples, '
          f'{len(cross_pairs)} cross-check pair(s), {len(cobs_samples)} raw COBS payload(s)')
    print('max propagator separation by comet: '
          + ', '.join(f'{comet["id"]}={comet["propagator_check"]["max_separation_arcmin"]:.2f} arcmin'
                      for comet in comets))
    print(f'{relpath(args.fixture)} sha256={sha256(args.fixture.read_bytes())} '
          f'bytes={args.fixture.stat().st_size}')
    if detail['cross_check_pairs']:
        print(f'cross-checked {detail["compared"]} fixture/artifact pair(s) against '
              f'{relpath(args.ephemeris_out)}')
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--out', type=Path, default=DEFAULT_OUT,
                        help=f'comets artifact path (default {relpath(DEFAULT_OUT)})')
    parser.add_argument('--ephemeris-out', type=Path, default=DEFAULT_EPHEMERIS_OUT,
                        help=f'ephemeris artifact path (default {relpath(DEFAULT_EPHEMERIS_OUT)})')
    parser.add_argument('--fixture', type=Path, default=DEFAULT_FIXTURE,
                        help=f'offline fixture path (default {relpath(DEFAULT_FIXTURE)})')
    parser.add_argument('--horizon-days', type=int, default=180,
                        help='ephemeris horizon in days, %d..%d (default 180)'
                             % HORIZON_DAYS_RANGE)
    parser.add_argument('--max-candidates', type=int, default=24,
                        help=f'published comets, hard cap {MAX_CANDIDATES_CAP} (default 24)')
    parser.add_argument('--step-hours', type=int, default=48,
                        help='ephemeris sampling interval in hours (default 48)')
    parser.add_argument('--sbdb-window-days', type=int, default=500,
                        help='freshness window on SBDB last_obs (default 500)')
    parser.add_argument('--sleep', type=float, default=1.5,
                        help='delay between Horizons requests in seconds (default 1.5)')
    parser.add_argument('--as-of', type=date.fromisoformat, default=None,
                        help='run date for reproducible rebuilds (default: today, UTC)')
    parser.add_argument('--no-network', action='store_true', dest='no_network',
                        help='revalidate and re-derive the committed artifacts offline')
    parser.add_argument('--check', action='store_true',
                        help='validate the committed artifacts and the fixture, then exit')
    parser.add_argument('--build-fixture', action='store_true', dest='build_fixture',
                        help='refresh the offline test fixture (network required)')
    return parser


def check_args(args) -> None:
    low, high = HORIZON_DAYS_RANGE
    require(low <= args.horizon_days <= high,
            f'--horizon-days must be between {low} and {high}')
    require(1 <= args.max_candidates <= MAX_CANDIDATES_CAP,
            f'--max-candidates must be between 1 and {MAX_CANDIDATES_CAP}')
    require(1 <= args.step_hours <= 240, '--step-hours must be between 1 and 240')
    require(args.horizon_days * 24 % args.step_hours == 0,
            '--step-hours must divide the horizon exactly so the samples span the whole window')
    require(30 <= args.sbdb_window_days <= 3650,
            '--sbdb-window-days must be between 30 and 3650')
    require(args.sleep >= 0, '--sleep cannot be negative')
    require(Path(args.out) != Path(args.ephemeris_out),
            '--out and --ephemeris-out must be different files')


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        check_args(args)
        if args.check:
            return run_check(args)
        if args.no_network:
            return run_no_network(args)
        if args.build_fixture:
            return run_build_fixture(args)
        return run_build(args)
    except BuildError as error:
        print(f'FAIL: {error}', file=sys.stderr)
        return 1


def fetch_cobs_comet_list(fetcher: Fetcher) -> dict:
    """COBS comet list (observed comets).  Used only for the packed MPC designation of a comet.

    No ``type`` filter: ``type=C`` returns only the long-period ``C/...`` comets, so a numbered
    periodic comet (``2P``) would never be found.  Verified: ``is-observed=true`` returns 1713
    comets including ``2P``/``260P``/``P/2026 R1``, whose ``name`` matches our ids.
    """
    params = {'is-observed': 'true'}
    fetched = fetcher.get(COBS_LIST_URL, params)
    provenance = {'url': fetched['url'], 'query': query_string(params),
                  'http_status': fetched['status'], 'retrieved_at': utc_now(),
                  'bytes': len(fetched['body']),
                  'sha256': sha256(fetched['body']) if fetched['body'] else None}
    if fetched['status'] != 200:
        return {'map': {}, 'api_version': None, 'provenance': provenance, 'error': fetched['error']}
    payload = json.loads(fetched['body'].decode('utf-8'))
    version = assert_cobs_signature(payload, 'comet_list')
    mapping = {}
    for obj in payload.get('objects') or []:
        name = str(obj.get('name') or '').strip()
        if name:
            mapping[name] = {'mpc_packed': obj.get('mpc_name'), 'cobs_id': obj.get('id')}
    return {'map': mapping, 'api_version': version, 'provenance': provenance, 'error': None}


def run_build(args) -> int:
    """Retrieve, rank, measure, validate and publish both artifacts."""
    generated_at = utc_now()
    run_date = (args.as_of or datetime.now(timezone.utc).date())
    horizon = {'start': f'{run_date.isoformat()}T00:00:00Z',
               'end': f'{(run_date + timedelta(days=args.horizon_days)).isoformat()}T00:00:00Z',
               'days': args.horizon_days}
    cobs_start, cobs_end = (run_date - timedelta(days=COBS_WINDOW_DAYS)).isoformat(), run_date.isoformat()
    fetcher = Fetcher(min_interval=COBS_REQUEST_GAP_S)
    previous = load_json(args.out)
    notes = [
        'candidate discovery: SBDB comet query sorted by -last_obs, filtered in Python to last_obs '
        f'>= {(run_date - timedelta(days=args.sbdb_window_days)).isoformat()} '
        f'({args.sbdb_window_days}-day freshness window) because the SBDB filter language rejects '
        'last_obs',
        f'ranking uses the IAU total magnitude model {BRIGHTNESS_MODEL} evaluated over the horizon at '
        'the daily point where each object is predicted brightest, with r and delta from a local '
        'two-body Kepler propagation of the SBDB elements; measured against Horizons for 2P/Encke '
        'that propagation is 0.16-0.65 arcmin from the element epoch to +800 days and 4.3 arcmin at '
        '+1174 days (missing non-gravitational acceleration and perturbations)',
    ]
    rows, element_provenance = fetch_sbdb_rows(fetcher, run_date, args.sbdb_window_days)
    selected, diag = rank_candidates(rows, run_date, args.sbdb_window_days, args.horizon_days,
                                     args.max_candidates)
    notes.append(f'candidate discovery result: {diag["rows"]} SBDB comet rows, '
                 f'{diag["in_window"]} inside the freshness window, {diag["ranked"]} rankable, '
                 f'{len(selected)} selected (requested {args.max_candidates}, hard cap '
                 f'{MAX_CANDIDATES_CAP}; objects brighter than {HORIZONS_BRIGHT_ENOUGH_MAG:g} mag are '
                 f'taken first: {diag["brighter_than_12"] or "none"})')
    if diag['fragments'] or diag['duplicates']:
        notes.append(f'rejected {diag["fragments"]} fragment designations and '
                     f'{diag["duplicates"]} duplicate designations')
    if diag['unusable_elements']:
        notes.append('candidates with unusable elements: ' + '; '.join(diag['unusable_elements'][:8]))
    if diag['no_magnitude']:
        notes.append(f'{len(diag["no_magnitude"])} candidates were skipped because the SBDB publishes '
                     'no M1/K1 for them: ' + ', '.join(diag['no_magnitude'][:10]))
    if diag['unpropagatable']:
        notes.append('candidates that could not be propagated: ' + '; '.join(diag['unpropagatable'][:8]))
    if diag['selected_peak_range']:
        notes.append(f'published candidates span predicted peak magnitudes '
                     f'{diag["selected_peak_range"][0]} to {diag["selected_peak_range"][1]}')
    require(bool(selected), 'the SBDB query produced no rankable candidate')
    comets, ephemeris_comets, skipped = [], {}, []
    horizons_requests, cobs_requests, consecutive_failures = 0, 0, 0
    retrieved_stamps, cobs_payloads = [], []
    unknown_cobs, deviations, refined = [], [], []
    cobs_version = None
    try:
        listing = fetch_cobs_comet_list(fetcher)
    except BuildError as exc:
        listing = {'map': {}, 'api_version': None, 'provenance': None, 'error': str(exc)}
    packed_map = listing['map']
    if listing['error']:
        notes.append(f'COBS comet_list.api could not be read ({listing["error"]}); mpc_packed is null '
                     'for every comet and no packed designation was invented')
    for item in selected:
        start_jd = jd_from_iso(horizon['start']) + TDB_MINUS_UTC_DAYS
        step_hours = choose_step_hours(item['elements'], start_jd, args.horizon_days,
                                       args.step_hours)
        ephemeris = fetch_ephemeris(fetcher, item['pdes'], horizon['start'][:10],
                                    horizon['end'][:10], step_hours, args.sleep,
                                    fallback_command=(item['record'].get('spkid') or None))
        horizons_requests += int(ephemeris['provenance'].get('attempts_made') or 1)
        if not ephemeris['ok']:
            consecutive_failures += 1
            reason = f'{item["id"]}: {ephemeris["reason"]}'
            skipped.append(reason)
            notes.append(NOTES_EPHEMERIS_SKIP_PREFIX + reason)
            if consecutive_failures >= CONSECUTIVE_FAILURE_ABORT:
                raise BuildError(f'{CONSECUTIVE_FAILURE_ABORT} consecutive Horizons failures, last '
                                 f'error: {reason}; nothing was written')
            continue
        consecutive_failures = 0
        deviation = midway_deviation(ephemeris['points'])
        # If the estimate above was too optimistic, refine once from the measured samples (the same
        # h^2 scaling, this time on the real curve) before giving up on this comet.
        if deviation > INTERPOLATION_MAX_DEG and step_hours > min(STEP_CHOICES_HOURS):
            curvature = 2.0 * deviation / (step_hours / 24.0) ** 2
            finer = choose_step_from_curvature(curvature, args.step_hours, below=step_hours)
            if finer < step_hours:
                refined.append(f'{item["id"]} ({step_hours} h -> {finer} h)')
                notes.append(f'{item["id"]}: refetched at {finer} h because the {step_hours} h grid '
                             f'left {deviation:.3f} deg of linear-interpolation error')
                step_hours = finer
                ephemeris = fetch_ephemeris(fetcher, item['pdes'], horizon['start'][:10],
                                            horizon['end'][:10], step_hours, args.sleep,
                                            fallback_command=(item['record'].get('spkid') or None))
                horizons_requests += int(ephemeris['provenance'].get('attempts_made') or 1)
                deviation = midway_deviation(ephemeris['points'])
        if deviation > INTERPOLATION_MAX_DEG:
            raise BuildError(f'{item["id"]}: linear interpolation of the published samples would '
                             f'deviate by {deviation:.3f} deg mid-way (limit '
                             f'{INTERPOLATION_MAX_DEG}); nothing was written')
        retrieved_stamps.append(ephemeris['provenance']['retrieved_at'])
        assessment = fetch_cobs_for(fetcher, [item['id'], item['pdes']], cobs_start, cobs_end)
        cobs_requests += len(assessment['payloads'])
        cobs_payloads.extend(assessment['payloads'])
        cobs_version = cobs_version or assessment['api_version']
        if not assessment['known']:
            unknown_cobs.append(f'{item["id"]} (tried {item["id"]} and {item["pdes"]})')
        measured = summarise_observations(
            assessment['observations'], f'{cobs_start}T00:00:00Z', f'{cobs_end}T23:59:59Z',
            jd_from_iso(f'{cobs_end}T23:59:59Z') - JD_UNIX_EPOCH)
        cobs_note = ('; '.join(assessment['errors'])) if assessment['errors'] else None
        comets.append(build_comet(item, ephemeris, measured, horizon, step_hours,
                                  packed_map.get(item['id'], {}).get('mpc_packed'), cobs_note))
        print(f'  [{len(comets)}/{len(selected)}] {item["id"]}: {len(ephemeris["points"])} samples '
              f'at {step_hours} h, {len(assessment["observations"])} COBS observations, '
              f'interpolation error {deviation:.4f} deg', file=sys.stderr, flush=True)
        ephemeris_comets[item['id']] = {
            'start': horizon['start'], 'step_hours': step_hours,
            'columns': list(EPHEMERIS_COLUMNS),
            'points': [[point['t_iso'], round_half_up(point['ra_deg'], 6),
                        round_half_up(point['dec_deg'], 6), round_half_up(point['r_au'], 6),
                        round_half_up(point['delta_au'], 6)] for point in ephemeris['points']],
            'point_count': len(ephemeris['points']),
            'interpolation': EPHEMERIS_INTERPOLATION,
            'interpolation_max_deviation_deg': round_half_up(deviation, 5),
            'target': ephemeris['target'] or None,
        }
        deviations.append(deviation)
    if len(comets) < MIN_COMETS:
        raise BuildError(f'only {len(comets)} comets got a usable Horizons ephemeris (at least '
                         f'{MIN_COMETS} required); nothing was written')
    notes.extend([
        f'ephemeris: one geocentric OBSERVER request per published comet over '
        f'[{horizon["start"]}, {horizon["end"]}]; {horizons_requests} Horizons requests, '
        f'{len(ephemeris_comets)} usable; RA/Dec are astrometric ICRF/J2000 degrees and light-time '
        'corrected, exactly as Horizons delivered them',
        f'sampling: --step-hours {args.step_hours} is the requested maximum, but each comet gets the '
        f'coarsest step from {list(STEP_CHOICES_HOURS)} h whose linear interpolation stays within '
        f'{INTERPOLATION_MAX_DEG} deg mid-way (the browser interpolates linearly), estimated from '
        f'the local geometry before the request; steps used: '
        + ', '.join(f'{ident}={entry["step_hours"]}h' for ident, entry in
                    sorted(ephemeris_comets.items(), key=lambda pair: pair[1]['step_hours']))
        + (f'; refined after measurement: {", ".join(refined)}' if refined else ''),
        f'measured worst mid-way interpolation error over all published samples: '
        f'{max(deviations):.4f} deg (limit {INTERPOLATION_MAX_DEG})',
        'positions are never taken from the local two-body propagation: that model is used only to '
        'rank candidates before the ephemeris requests and to sanity-check the committed fixture',
        f'observations: COBS obs_list.api over [{cobs_start}, {cobs_end}] with '
        'exclude_not_accurate=true and exclude_issue=true; visual (obs_type=V) and CCD (obs_type=C) '
        f'are requested separately ({cobs_requests} requests) and pooled only together with the '
        'published per-method counts and ICQ method codes',
        'observation timestamps are the COBS obs_date values, published here as UTC; COBS documents '
        'its observation times as UT, but its help page could not be retrieved in this run (HTTP 500) '
        'to reconfirm that',
        'the coma diameter is published as arcmin because that is the ICQ convention; the COBS help '
        'page could not be retrieved (HTTP 500) to confirm the unit of its coma_diameter field',
        'comets.json carries no ephemeris samples on purpose: it is read on every page load, and the '
        'samples live in data/overhead/comet-ephemerides.json',
        f'COBS API signature versions asserted: obs_list.api {cobs_version or "unknown"}, '
        f'comet_list.api {listing["api_version"] or "unknown"}',
    ])
    if skipped:
        notes.append(f'{len(skipped)} selected comet(s) were dropped because no Horizons ephemeris '
                     'could be read; they are named above and are absent from comets.json because the '
                     'browser can only position a comet it has samples for')
    if unknown_cobs:
        notes.append('COBS has no object under either designation for: ' + ', '.join(unknown_cobs)
                     + '; their measured block is published as observed=false with a reason rather '
                       'than with a substituted value')
    basis = (f'compared this run with {relpath(args.out)}: candidate ids, SBDB element epochs, COBS '
             'last measured magnitudes and predicted minimum geocentric distances, using the '
             'published thresholds; ' + (f'that artifact was generated {previous["generated_at"]}'
                                        if previous else 'no previous artifact was present, so every '
                                        'list is empty'))
    noteworthy = compare_with_previous(previous, comets, basis, generated_at)
    counts = ', '.join(f'{key}={len(value)}' for key, value in noteworthy.items()
                       if isinstance(value, list))
    notes.append(f'noteworthy comparison against the previous artifact: {counts} '
                 '(empty lists are the expected steady-state result)')
    artifact = {
        'schema': SCHEMA, 'generated_at': generated_at, 'horizon': horizon,
        'sources': {
            'elements': element_provenance,
            'ephemeris': {
                'name': 'NASA/JPL Horizons', 'url': HORIZONS_URL,
                'parameters': horizons_query_template(args.step_hours),
                'retrieved_at': (retrieved_stamps[0] if retrieved_stamps else generated_at),
                'retrieved_until': (retrieved_stamps[-1] if retrieved_stamps else generated_at),
                'frame': EPHEMERIS_FRAME, 'step_hours': args.step_hours,
                'step_hours_max': args.step_hours,
                'step_hours_by_comet': {ident: entry['step_hours']
                                        for ident, entry in sorted(ephemeris_comets.items())},
                'requests': horizons_requests,
                'note': ('COMMAND is DES=<designation>;CAP - the ;CAP suffix is required, a bare DES= '
                         'sends Horizons into a record-index search instead of an ephemeris; a '
                         'designation that Horizons cannot resolve uniquely falls back once to '
                         'DES=<SPK-ID>;CAP (recorded per comet in provenance.ephemeris_command)'),
            },
            'observations': {
                'name': 'COBS - Comet Observation Database', 'url': COBS_OBS_URL,
                'api_version': cobs_version or 'unknown',
                'retrieved_at': (cobs_payloads[0]['retrieved_at'] if cobs_payloads else generated_at),
                'note': 'visual and CCD magnitudes are reported separately and never merged',
                'requests': cobs_requests,
                'exclusions': ['exclude_not_accurate=true', 'exclude_issue=true'],
                'window_days': COBS_WINDOW_DAYS,
            },
        },
        'thresholds': THRESHOLDS, 'noteworthy': noteworthy, 'comets': comets, 'notes': notes,
    }
    ephemeris_artifact = {
        'schema': EPHEMERIS_SCHEMA, 'generated_at': generated_at, 'frame': EPHEMERIS_FRAME,
        'step_hours': args.step_hours,
        'step_hours_note': (f'--step-hours {args.step_hours} is the requested maximum; each comet '
                            'carries the step actually used, chosen as the coarsest divisor of 24 h '
                            f'that keeps linear interpolation within {INTERPOLATION_MAX_DEG} deg '
                            'mid-way'),
        'max_interpolation_deviation_deg': round_half_up(max(deviations), 5),
        'source': {'name': 'NASA/JPL Horizons', 'url': HORIZONS_URL,
                   'retrieved_at': artifact['sources']['ephemeris']['retrieved_at'],
                   'retrieved_until': artifact['sources']['ephemeris']['retrieved_until'],
                   'query_template': horizons_query_template(args.step_hours),
                   'requests': horizons_requests, 'frame': EPHEMERIS_FRAME,
                   'step_hours': args.step_hours},
        'comets': ephemeris_comets,
    }
    derived = rederive_offline(artifact, ephemeris_artifact)
    ages = [days_between(comet['elements']['epoch_iso'],
                         comet['brightness']['predicted']['at']) for comet in comets]
    stale = sum(1 for age in ages if age > 730)
    notes.append(
        f'ranking model measured on the published set: the two-body Kepler propagation differs from '
        f'the Horizons geometry at each predicted peak by at most '
        f'{max(derived["separations_arcmin"]):.1f} arcmin (median '
        f'{round_half_up(statistics.median(derived["separations_arcmin"]), 2)} arcmin) and the '
        f'total-magnitude model evaluated on the propagated geometry differs by up to '
        f'{derived["max_kepler_mag_delta"]:.2f} mag; {stale} of {len(comets)} comets peak more than '
        f'2 years after their element epoch, which is where that gap comes from. Published magnitudes '
        'always use the Horizons geometry, so this only affects which candidates were selected.')
    validate_artifact(artifact, ephemeris_artifact, None)
    write_atomic(args.out, dump(artifact))
    write_atomic(args.ephemeris_out, dump(ephemeris_artifact))
    summary = validate_artifact(json.loads(args.out.read_text(encoding='utf-8')),
                                json.loads(args.ephemeris_out.read_text(encoding='utf-8')), None)
    print(f'wrote {relpath(args.out)}: {summary["comets"]} comets, {summary["samples"]} ephemeris '
          f'samples, {len(skipped)} skipped, {horizons_requests} Horizons requests, '
          f'{cobs_requests} COBS requests')
    print(f'wrote {relpath(args.ephemeris_out)}: {len(ephemeris_comets)} comets')
    print(f'{relpath(args.out)} sha256={sha256(args.out.read_bytes())} bytes={args.out.stat().st_size}')
    print(f'{relpath(args.ephemeris_out)} sha256={sha256(args.ephemeris_out.read_bytes())} '
          f'bytes={args.ephemeris_out.stat().st_size}')
    for warning in summary.get('warnings', []):
        print(f'warning: {warning}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
