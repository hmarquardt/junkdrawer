# /// script
# dependencies = ["duckdb", "requests", "osmium==4.3.1", "shapely>=2,<3", "pyproj"]
# ///
"""Offline access contract and actual PBF extraction tests; fixture is explicitly synthetic."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import duckdb
import osmium
from shapely.geometry import Point, LineString, box, mapping, shape
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import fruiting_osm_access as access


def feature(tags=None, geometry=None, ident='osm:node:1'):
    tags = tags or {'highway': 'trailhead'}
    typ, osm_id = ident.split(':')[1:]
    return {'id': ident, 'osm_type': typ, 'osm_id': osm_id, 'kind': access.feature_type(tags),
            'tags': tags, 'geometry': mapping(geometry if geometry is not None else Point(-105.5, 39.5))}


def fixture_pbf(folder):
    path = folder / 'fixture.osm.pbf'
    header = osmium.io.Header()
    header.set('osmosis_replication_timestamp', '2026-09-13T20:21:20Z')
    with osmium.SimpleWriter(str(path), header=header) as writer:
        for obj in osmium.FileProcessor(str(ROOT / 'tests/fixtures/fruiting-access/access.osm')):
            writer.add(obj)
    return path


class AccessContract(unittest.TestCase):
    def test_same_snapshot_refresh_repairs_corrupt_generation(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pbf = fixture_pbf(root)
            response = SimpleNamespace(text=hashlib.md5(pbf.read_bytes()).hexdigest(), raise_for_status=lambda: None)
            cache = root / 'cache'
            with patch.object(access.requests, 'get', return_value=response):
                first = access.prepare(cache, 'CO', snapshot='260913', local_pbf=pbf)
                old = cache / first['directory']
                (old / 'candidates.parquet').write_bytes(b'corrupt')
                second = access.prepare(cache, 'CO', refresh=True, snapshot='260913', local_pbf=pbf)
            self.assertNotEqual(first['directory'], second['directory'])
            self.assertEqual(access.validate_ready(cache, second), cache / second['directory'])
            self.assertEqual((old / 'candidates.parquet').read_bytes(), b'corrupt')

    def setUp(self):
        self.project = access.metric_transform([-106, 39, -105, 40])
        self.prop = {'property_id': 'forest', 'property_name': 'Test National Forest'}
        self.geometry = box(-105.501, 39.499, -105.499, 39.501)
        self.properties = [(self.prop, transform(self.project, self.geometry))]
        self.roads = [dict(feature({'highway': 'service'}, LineString([(-105.502, 39.5), (-105.5, 39.5)]), 'osm:way:1'), kind='ROAD'),
                      dict(feature({'highway': 'path'}, LineString([(-105.5, 39.5), (-105.5, 39.502)]), 'osm:way:2'), kind='ROAD')]

    def normalize(self, f=None, roads=None, properties=None):
        return access.normalize(f or feature(), access.RoadIndex(self.roads if roads is None else roads, self.project),
                                self.properties if properties is None else properties, self.project, 'fixture-v1')

    def test_trailhead_missing_tags_are_mapped_evidence_not_verified_permission(self):
        row = self.normalize()
        self.assertTrue(row['start_eligible'])
        self.assertEqual(row['evidence_grade'], 'HIGH')
        self.assertIsNone(row['access'])
        self.assertIsNone(row['verified_at'])
        self.assertFalse(row['official'])
        self.assertIn('not independently verified', row['notes'])
        self.assertEqual(row['access_id'], 'osm:node:1')

    def test_parking_node_area_and_stable_identity(self):
        for geometry, ident in [(Point(-105.5, 39.5), 'osm:node:2'),
                                (box(-105.5001, 39.4999, -105.4999, 39.5001), 'osm:way:2')]:
            row = self.normalize(feature({'amenity': 'parking', 'parking': 'surface'}, geometry, ident))
            self.assertTrue(row['start_eligible'])
            self.assertTrue(geometry.covers(Point(row['lon'], row['lat'])))
            self.assertEqual(row['access_id'], ident)
        self.assertEqual(row['location_method'], 'mapped-area-representative-point')

    def test_private_no_customers_and_mode_restrictions(self):
        for key, val in [('access', 'private'), ('access', 'no'), ('access', 'customers'), ('foot', 'no'),
                         ('vehicle', 'no'), ('motor_vehicle', 'no')]:
            with self.subTest(key=key, val=val):
                row = self.normalize(feature({'amenity': 'parking', key: val}))
                self.assertEqual(row['evidence_grade'], 'RESTRICTED')
                self.assertFalse(row['start_eligible'])
                self.assertIn(key + '=' + val, row['restriction'])
        row = self.normalize(feature({'highway': 'trailhead', 'access': 'permissive'}))
        self.assertTrue(row['start_eligible'])

    def test_gate_is_never_a_start_and_tags_survive(self):
        for tags in [{'barrier': 'gate'}, {'barrier': 'lift_gate', 'access': 'private', 'locked': 'yes'},
                     {'barrier': 'gate', 'access': 'permissive', 'foot': 'yes', 'vehicle': 'no'}]:
            row = self.normalize(feature(tags))
            self.assertFalse(row['start_eligible'])
            for k, v in tags.items():
                self.assertEqual(row[k], v)

    def test_urban_structured_and_entrance_parking(self):
        for tags in [{'parking': 'underground'}, {'parking': 'multi-storey'}, {'building': 'garage'}, {'name': 'Walmart parking'}]:
            row = self.normalize(feature({'amenity': 'parking', **tags}))
            self.assertEqual(row['evidence_grade'], 'REJECTED')
            self.assertFalse(row['start_eligible'])
        self.assertIsNone(access.feature_type({'amenity': 'parking_entrance'}))
        roads = [dict(r, tags={'highway': 'residential'}) for r in self.roads]
        self.assertFalse(self.normalize(feature({'amenity': 'parking'}), roads)['start_eligible'])

    def test_isolation_and_uncertain_track(self):
        for roads in [[], self.roads[:1]]:
            row = self.normalize(roads=roads)
            self.assertEqual(row['evidence_grade'], 'REVIEW')
            self.assertFalse(row['start_eligible'])
        roads = [dict(self.roads[0], tags={'highway': 'track'}), self.roads[1]]
        row = self.normalize(roads=roads)
        self.assertEqual(row['road_quality'], 'TRACK_UNCERTAIN')
        self.assertFalse(row['start_eligible'])

    def test_property_association_ambiguous_and_not_nearest(self):
        overlap = self.properties + [(dict(self.prop, property_id='preserve'), self.properties[0][1])]
        row = self.normalize(properties=overlap)
        self.assertIsNone(row['property_id'])
        self.assertEqual(json.loads(row['property_ids_json']), ['forest', 'preserve'])
        self.assertEqual(row['association_method'], 'ambiguous-multiple-properties')
        self.assertEqual(row['evidence_grade'], 'MEDIUM')
        far = [(self.prop, transform(self.project, box(-105.48, 39.5, -105.47, 39.51)))]
        row = self.normalize(properties=far)
        self.assertEqual(row['evidence_grade'], 'REVIEW')
        self.assertFalse(row['start_eligible'])
        self.assertEqual(json.loads(row['property_ids_json']), [])
        near = [(self.prop, transform(self.project, box(-105.501, 39.5001, -105.499, 39.501)))]
        row = self.normalize(properties=near)
        self.assertEqual(row['association_method'], 'boundary-road-connection')
        self.assertLess(row['association_distance_m'], 50)
        self.assertEqual(row['evidence_grade'], 'MEDIUM')

    def test_conditional_informal_and_private_approach(self):
        for tags in [{'highway': 'trailhead', 'informal': 'yes'}, {'highway': 'trailhead', 'access:conditional': 'no @ (winter)'}]:
            self.assertFalse(self.normalize(feature(tags))['start_eligible'])
        roads = [dict(self.roads[0], tags={'highway': 'service', 'access': 'private'}), self.roads[1]]
        row = self.normalize(feature({'amenity': 'parking', 'name': 'Trail Parking'}), roads)
        self.assertEqual(row['evidence_grade'], 'RESTRICTED')
        self.assertFalse(row['start_eligible'])
        trailhead = self.normalize(feature({'highway': 'trailhead'}), roads)
        self.assertFalse(trailhead['start_eligible'])
        self.assertEqual(trailhead['evidence_grade'], 'RESTRICTED')

    def test_closer_private_approach_cannot_be_bypassed_by_nearby_public_road(self):
        roads = [dict(self.roads[0], tags={'highway': 'service', 'access': 'private'}), self.roads[1],
                 dict(feature({'highway': 'service'}, LineString([(-105.502, 39.50015), (-105.499, 39.50015)]), 'osm:way:3'), kind='ROAD')]
        row = self.normalize(feature({'amenity': 'parking', 'name': 'Trail Parking'}), roads)
        self.assertFalse(row['start_eligible'])
        self.assertEqual(row['evidence_grade'], 'RESTRICTED')

    def test_property_holes_and_linear_features_never_supply_starts(self):
        from shapely.geometry import Polygon
        geometry = Polygon(self.geometry.exterior.coords, [box(-105.5008, 39.4992, -105.4992, 39.5008).exterior.coords])
        row = self.normalize(properties=access.PropertyIndex([(self.prop, transform(self.project, geometry))]))
        self.assertFalse(row['start_eligible'])
        self.assertEqual(row['association_method'], 'unassociated')
        row = self.normalize(feature({'highway': 'trailhead'}, LineString([(-105.5, 39.5), (-105.5, 39.5001)]), 'osm:way:9'))
        self.assertFalse(row['start_eligible'])

    def test_real_pbf_reader_nodes_ways_relation_and_no_contributor_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            metrics = access.extract_pbf(fixture_pbf(folder), folder)
            rows = access.read_local(folder / 'candidates.parquet', [-106, 39, -105, 40])
            by_id = {r['id']: r for r in rows}
            self.assertEqual(metrics['counts']['ROAD'], 2)
            self.assertIn('osm:way:200', by_id)
            self.assertIn('osm:relation:300', by_id)
            self.assertNotIn('osm:node:7', by_id)
            self.assertEqual(by_id['osm:node:1']['kind'], 'TRAILHEAD')
            self.assertEqual(by_id['osm:node:6']['tags']['access'], 'private')
            self.assertEqual(shape(by_id['osm:way:200']['geometry']).geom_type, 'MultiPolygon')
            self.assertNotIn('user', json.dumps(rows))
            # Node on edge, area across edge, same road/gate identity in either local clip.
            left = access.read_local(folder / 'candidates.parquet', [-106, 39, -105.5002, 40])
            right = access.read_local(folder / 'candidates.parquet', [-105.5002, 39, -105, 40])
            shared = {r['id'] for r in left} & {r['id'] for r in right}
            self.assertIn('osm:way:200', shared)
            self.assertIn('osm:node:6', shared)
            left = access.read_local(folder / 'candidates.parquet', [-106, 39, -105.5, 40])
            right = access.read_local(folder / 'candidates.parquet', [-105.5, 39, -105, 40])
            self.assertIn('osm:node:1', {r['id'] for r in left} & {r['id'] for r in right})

    def test_transit_ferry_and_institutional_parking_is_never_a_start(self):
        """Washington-scale audit: transit park-and-rides, ferry lots and
        institutional lots are rejected generically; Sno-Parks and trailheads
        stay evidence."""
        def parking(name=None, operator=None):
            tags = {'amenity': 'parking', 'parking': 'surface'}
            if name:
                tags['name'] = name
            if operator:
                tags['operator'] = operator
            return feature(tags, geometry=Point(-105.5, 39.5), ident='osm:node:99')
        lot = access.normalize(parking('Gateway Transit Center Park and Ride', 'TriMet'),
                               access.RoadIndex([], self.project), [], self.project, 'v')
        ferry = access.normalize(parking('Ferry Waiting Area', 'Washington State Ferries'),
                                 access.RoadIndex([], self.project), [], self.project, 'v')
        school = access.normalize(parking('Parent Parking', 'Beaverton School District'),
                                  access.RoadIndex([], self.project), [], self.project, 'v')
        sno = access.normalize(parking('White River West Sno-Park', 'Oregon Department of Transportation'),
                               access.RoadIndex([], self.project), [], self.project, 'v')
        trailhead = access.normalize(feature({'highway': 'trailhead', 'name': 'School Canyon Trailhead'}),
                                     access.RoadIndex([], self.project), [], self.project, 'v')
        for row in (lot, ferry, school):
            self.assertEqual(row['evidence_grade'], 'REJECTED', row['name'])
            self.assertFalse(row['start_eligible'])
        self.assertIn('transit', lot['evidence_reason'])
        self.assertNotEqual(sno['evidence_grade'], 'REJECTED')
        self.assertNotEqual(trailhead['evidence_grade'], 'REJECTED')

    def test_edge_crossing_area_publishes_in_exactly_one_tile(self):
        """A parking polygon spanning an integer-degree line is selected by its
        representative point with half-open edges, so adjacent tile builds
        cannot double-publish it."""
        polygon = box(-122.0005, 45.99986, -121.9995, 46.00014)  # crosses lat 46 and lon -122
        candidate = feature({'amenity': 'parking', 'name': 'Edge Parking'},
                            geometry=polygon, ident='osm:way:42')
        # Exactly one adjacent tile may claim the feature, wherever the stable
        # representative point falls.
        adjacent = [[-123, 45, -122, 46], [-122, 45, -121, 46], [-123, 46, -122, 47], [-122, 46, -121, 47]]
        claims = [b for b in adjacent if access.in_tile(candidate, b)]
        self.assertEqual(len(claims), 1, claims)
        # A representative point exactly on the edge belongs to the north/east tile only.
        on_edge = feature({'amenity': 'parking'}, geometry=Point(-122.0, 46.0), ident='osm:node:43')
        self.assertFalse(access.in_tile(on_edge, [-123, 45, -122, 46]))
        self.assertFalse(access.in_tile(on_edge, [-123, 46, -122, 47]))
        self.assertFalse(access.in_tile(on_edge, [-122, 45, -121, 46]))
        self.assertTrue(access.in_tile(on_edge, [-122, 46, -121, 47]))

    def test_ready_reuse_corruption_and_failed_refresh(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp)
            folder = cache / 'prepared'; folder.mkdir()
            files = {}
            for name in ['source.osm.pbf', 'roads.parquet', 'candidates.parquet']:
                (folder / name).write_bytes(b'validated fixture bytes')
                files[name] = {'bytes': (folder / name).stat().st_size, 'sha256': access._sha256(folder / name)}
            entry = {'status': 'READY', 'adapterVersion': access.VERSION, 'directory': 'prepared', 'sha256': 'digest', 'files': files}
            (folder / 'READY').write_text('digest\n')
            access.record_source(cache, 'osm_access:CO', entry)
            access.record_source(cache, 'osm_access:OR', entry)
            with patch.object(access.requests, 'get', side_effect=RuntimeError('offline')):
                self.assertTrue(access.prepare(cache, 'CO')['reused'])
                with self.assertRaises(RuntimeError):
                    access.prepare(cache, 'CO', refresh=True)
            self.assertEqual(access.validate_ready(cache, access.load_cache_manifest(cache)['sources']['osm_access:CO']), folder)
            self.assertEqual(access.load_cache_manifest(cache)['sources']['osm_access:OR'], entry)
            (folder / 'candidates.parquet').write_bytes(b'corrupt')
            with self.assertRaises(ValueError):
                access.prepare(cache, 'CO')


class PublishedCanaries(unittest.TestCase):
    def test_real_canaries_and_legacy_mixed_schema(self):
        manifest = json.loads((ROOT / 'data/fruiting-forecast/manifest.json').read_text())
        paths = []
        for tid in ['n39_w106', 'n40_w106', 'n44_w124', 'n43_w123']:
            tile = next(t for t in manifest['tiles'] if t['id'] == tid)
            asset = tile['accessPoints']
            self.assertEqual(asset['status'], 'AVAILABLE')
            path = ROOT / 'data/fruiting-forecast' / asset['url']; paths.append(str(path))
            self.assertEqual(access._sha256(path), asset['sha256'])
            with duckdb.connect() as con:
                rows = con.execute('SELECT access_id, start_eligible, evidence_grade, geometry_json, lat, lon, source_version FROM read_parquet(?)', [str(path)]).fetchall()
            self.assertTrue(any(r[1] for r in rows))
            self.assertTrue(any(r[2] == 'RESTRICTED' for r in rows))
            for ident, eligible, grade, geom, lat, lon, source in rows:
                self.assertRegex(ident, r'^osm:(node|way|relation):\d+$')
                self.assertTrue(shape(json.loads(geom)).distance(Point(lon, lat)) < 1e-8)
                if eligible:
                    self.assertIn(grade, ['HIGH', 'MEDIUM'])
                self.assertTrue(source.startswith(access.VERSION))
        paths.append(str(ROOT / 'data/fruiting-forecast/ap/n38_w087.parquet'))
        with duckdb.connect() as con:
            result = con.execute('SELECT count(*), count(evidence_grade) FROM read_parquet(?, union_by_name=true)', [paths]).fetchone()
        self.assertGreater(result[0], result[1])


if __name__ == '__main__':
    unittest.main()
