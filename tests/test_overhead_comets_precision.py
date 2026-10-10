"""Precision-contract regression tests for the Overhead comet pipeline.

    python3 tests/test_overhead_comets_precision.py

Run 38032183173 of .github/workflows/overhead-data.yml (scheduled, 2026-10-10) fetched and processed
24 comets and then failed its own pre-publication gate with

    FAIL: 78P: geometry.min_delta_au is not the smallest published delta

The producer rounded the minimum geocentric distance of the *raw* Horizons response to four decimals
(1.5587 au) while the offline validator compared it against the *published* six-decimal sample grid
(1.55875 au) with a 5e-5 au tolerance - exactly the largest difference four-decimal rounding can
produce, so the comparison was decided by one floating-point ulp (5.0000000000105516e-05 > 5e-5).

These tests pin the fixed contract: every published derived value is an exact function of the samples
*as published*, producer and validator run the same helper, and the comparison is an equality rather
than a tolerance.  They cover the boundary case that broke the run, rounding boundaries in general,
flat minimum-distance intervals where several samples tie, and - just as importantly - that the check
got *stricter*, so a tampered value is still rejected.

No network, no third-party packages: the committed artifacts supply the real elements and the real
Horizons minimum, and every other sample set is constructed in memory.
"""
import copy
import importlib.util
import json
import unittest
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('overhead_comets_build',
                                             ROOT / 'tools/overhead_comets_build.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

COMETS_PATH = ROOT / 'data/overhead/comets.json'
EPHEMERIS_PATH = ROOT / 'data/overhead/comet-ephemerides.json'

HORIZON_START = '2026-10-10T00:00:00Z'
HORIZON_DAYS = 8
STEP_HOURS = 48
# The raw Horizons minimum geocentric distance of 78P over the horizon that failed the run
# (geocentric OBSERVER ephemeris, horizon start 2026-10-10, 48 h step, 91 samples).  It is the value
# this pipeline itself retrieved while reproducing the failure; it rounds to 1.55875 au at the six
# decimals comet-ephemerides.json publishes, which is exactly a four-decimal rounding boundary.
SEVENTY_EIGHT_P_RAW_MIN_DELTA_AU = 1.55874987605176
SEVENTY_EIGHT_P_PUBLISHED_MIN_DELTA_AU = 1.55875
# Six-decimal minima whose fifth decimal is a 5: publishing them at four decimals sits exactly on the
# rounding boundary, which is the situation the old tolerance could not decide.
BOUNDARY_MINIMA = [1.55875, 0.32135, 12.91605, 3.78505, 0.93305]
BOUNDARY_OFFSETS = [-1e-6, -1e-9, 0.0, 1e-9, 1e-6]


def iso_after(hours):
    start = datetime.fromisoformat(HORIZON_START.replace('Z', '+00:00'))
    return (start + timedelta(hours=hours)).strftime('%Y-%m-%dT%H:%M:%SZ')


def samples_from_deltas(deltas):
    """Horizons-shaped samples whose geocentric distances are `deltas` (48 h apart, as published)."""
    return [{'t_iso': iso_after(STEP_HOURS * index),
             'ra_deg': 12.0 + index * 0.5, 'dec_deg': -3.0 + index * 0.25,
             'r_au': 4.5, 'delta_au': delta}
            for index, delta in enumerate(deltas)]


def horizon():
    return {'start': HORIZON_START, 'end': iso_after(24 * HORIZON_DAYS), 'days': HORIZON_DAYS}


def candidate_for(ident='78P'):
    """A build_comet() candidate whose elements are the published ones of a real comet."""
    data = json.loads(COMETS_PATH.read_text(encoding='utf-8'))
    published = next(comet for comet in data['comets'] if comet['id'] == ident)
    elements = published['elements']
    record = {
        'full_name': published['name'], 'pdes': published['designation'],
        'spkid': str(published['sbdb_id'] or ''), 'kind': published['kind'],
        'e': str(elements['e']), 'a': str(elements['a']), 'q': str(elements['q']),
        'i': str(elements['i']), 'om': str(elements['om']), 'w': str(elements['w']),
        'tp': str(elements['tp']), 'epoch': str(elements['epoch']),
        'per': str(elements['per_years'] * 365.25) if elements['per_years'] else None,
        'equinox': elements['equinox'], 'orbit_id': elements['reference'],
        'soln_date': elements['solution_date'], 'condition_code': elements['condition_code'],
        'rms': str(elements['fit_rms']), 'n_obs_used': str(elements['n_obs_used']),
        'first_obs': elements['first_obs'], 'last_obs': elements['last_obs'],
    }
    absolute = published['brightness']['absolute']
    return {'id': ident, 'kind': published['kind'], 'record': record,
            'pdes': published['designation'], 'full_name': published['name'],
            'M1': float(absolute['M1']), 'K1': float(absolute['K1']), 'peak': {},
            'elements': {'e': elements['e'], 'q': elements['q'], 'i': elements['i'],
                         'om': elements['om'], 'w': elements['w'], 'tp': elements['tp']}}


def publish(deltas, ident='78P'):
    """Run the producer on samples and build the artifacts the offline validator would read."""
    points = samples_from_deltas(deltas)
    rows = build.published_rows(points)
    entry = {'start': HORIZON_START, 'step_hours': STEP_HOURS,
             'columns': list(build.EPHEMERIS_COLUMNS), 'points': rows, 'point_count': len(rows),
             'interpolation': build.EPHEMERIS_INTERPOLATION,
             'interpolation_max_deviation_deg': build.deviation_from_rows(rows),
             'target': ident}
    measured = build.summarise_observations([], HORIZON_START,
                                           iso_after(24 * HORIZON_DAYS), 0.0)
    comet = build.build_comet(candidate_for(ident),
                              {'points': points, 'target': ident,
                               'provenance': {'used': f'DES={ident};CAP'}},
                              measured, horizon(), STEP_HOURS, None, None)
    return comet, {'comets': [comet]}, {'comets': {ident: entry}}, rows


class PublishedPrecisionTest(unittest.TestCase):
    def rederive(self, artifact, ephemeris):
        return build.rederive_offline(artifact, ephemeris)

    def test_78p_boundary_case_publishes_and_validates(self):
        """The exact sample set that failed run 38032183173 now passes the same validator."""
        comet, artifact, ephemeris, rows = publish(
            [1.9, SEVENTY_EIGHT_P_RAW_MIN_DELTA_AU, 1.7, 2.1])
        published_minimum = min(row[4] for row in rows)
        value = comet['geometry']['min_delta_au']
        self.assertEqual(published_minimum, SEVENTY_EIGHT_P_PUBLISHED_MIN_DELTA_AU)
        self.assertEqual(value, build.min_delta_au_from_deltas([row[4] for row in rows]))
        self.assertEqual(value, 1.5588)
        self.assertLessEqual(abs(value - published_minimum), build.MIN_DELTA_HALF_WIDTH)
        self.rederive(artifact, ephemeris)                      # must not raise
        # The old producer rounded the raw response instead, and that value was more than the old
        # 5e-5 au tolerance away from the published minimum: this is the failure being pinned.
        old_value = build.round_half_up(SEVENTY_EIGHT_P_RAW_MIN_DELTA_AU, 4)
        self.assertEqual(old_value, 1.5587)
        self.assertGreater(abs(old_value - published_minimum), 5e-5)

    def test_rounding_boundaries_agree_exactly(self):
        """Minima that sit on, just below and just above a four-decimal boundary."""
        for boundary in BOUNDARY_MINIMA:
            for offset in BOUNDARY_OFFSETS:
                with self.subTest(boundary=boundary, offset=offset):
                    comet, artifact, ephemeris, rows = publish(
                        [boundary + 0.4, boundary + offset, boundary + 0.2, boundary + 0.6])
                    published_minimum = min(row[4] for row in rows)
                    value = comet['geometry']['min_delta_au']
                    self.assertEqual(value,
                                     build.min_delta_au_from_deltas([row[4] for row in rows]))
                    self.assertLessEqual(abs(value - published_minimum),
                                         build.MIN_DELTA_HALF_WIDTH)
                    self.rederive(artifact, ephemeris)

    def test_flat_minimum_interval_accepts_any_tied_sample(self):
        """A flat minimum publishes as one value with several samples tied on it."""
        comet, artifact, ephemeris, rows = publish([1.6, 1.1000004, 1.1, 1.1000002, 1.7])
        published = [row[4] for row in rows]
        self.assertEqual(min(published), 1.1)
        self.assertEqual(published.count(1.1), 3)
        self.assertEqual(comet['geometry']['min_delta_au'], 1.1)
        self.rederive(artifact, ephemeris)
        tied = [row[0] for row in rows if row[4] == min(published)]
        for stamp in tied:                                      # any tied sample is acceptable
            variant = copy.deepcopy(artifact)
            variant['comets'][0]['geometry']['min_delta_at'] = stamp
            self.rederive(variant, ephemeris)
        variant = copy.deepcopy(artifact)
        variant['comets'][0]['geometry']['min_delta_at'] = rows[0][0]   # 1.6 au, not tied
        with self.assertRaises(build.BuildError) as caught:
            self.rederive(variant, ephemeris)
        self.assertIn('min_delta_at', str(caught.exception))


    def test_tampered_minimum_is_still_rejected(self):
        """The check is stricter than before: a value inside the old 5e-5 window is now rejected."""
        comet, artifact, ephemeris, _ = publish([1.9, 1.2345, 1.7, 2.1])
        for offset in (1e-5, -1e-5, 2e-4, -2e-4):
            with self.subTest(offset=offset):
                variant = copy.deepcopy(artifact)
                variant['comets'][0]['geometry']['min_delta_au'] = round(
                    comet['geometry']['min_delta_au'] + offset, 6)
                with self.assertRaises(build.BuildError) as caught:
                    self.rederive(variant, ephemeris)
                self.assertIn('min_delta_au', str(caught.exception))

    def test_tampered_interpolation_deviation_is_rejected(self):
        """The published interpolation error is re-derived from the published samples."""
        data = json.loads(COMETS_PATH.read_text(encoding='utf-8'))
        ephemeris = json.loads(EPHEMERIS_PATH.read_text(encoding='utf-8'))
        build.validate_artifact(copy.deepcopy(data), copy.deepcopy(ephemeris))
        ident = '78P' if '78P' in ephemeris['comets'] else next(iter(ephemeris['comets']))
        entry = ephemeris['comets'][ident]
        self.assertEqual(entry['interpolation_max_deviation_deg'],
                         build.deviation_from_rows(entry['points']))
        variant = copy.deepcopy(ephemeris)
        variant['comets'][ident]['interpolation_max_deviation_deg'] += 1e-4
        with self.assertRaises(build.BuildError) as caught:
            build.validate_artifact(copy.deepcopy(data), variant)
        self.assertIn('interpolation_max_deviation_deg', str(caught.exception))

    def test_committed_artifacts_satisfy_the_exact_contract(self):
        """Every published comet: derived values are exact functions of the published samples."""
        data = json.loads(COMETS_PATH.read_text(encoding='utf-8'))
        ephemeris = json.loads(EPHEMERIS_PATH.read_text(encoding='utf-8'))
        self.assertTrue(data['comets'], 'the committed artifact has no comets')
        for comet in data['comets']:
            ident = comet['id']
            entry = ephemeris['comets'][ident]
            with self.subTest(comet=ident):
                deltas = [row[4] for row in entry['points']]
                self.assertEqual(comet['geometry']['min_delta_au'],
                                 build.min_delta_au_from_deltas(deltas))
                self.assertEqual(entry['interpolation_max_deviation_deg'],
                                 build.deviation_from_rows(entry['points']))
        derived = self.rederive(data, ephemeris)
        self.assertEqual(derived['comets'], len(data['comets']))


if __name__ == '__main__':
    unittest.main(verbosity=2)

