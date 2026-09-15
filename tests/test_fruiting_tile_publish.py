"""Offline integration test: real Parquet, isolated output, no service requests."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import duckdb

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('publish',ROOT/'tools/fruiting_tile_publish.py')
pub=importlib.util.module_from_spec(spec);spec.loader.exec_module(pub)

class Publication(unittest.TestCase):
    def test_incremental_integrity_empty_and_failure(self):
        with tempfile.TemporaryDirectory() as d:
            base=Path(d);source=base/'source';out=base/'out';(source/'habitat').mkdir(parents=True)
            tile=source/'habitat/n38_w088.parquet'
            con=duckdb.connect()
            con.execute("COPY (SELECT 38.5 lat,-87.5 lon,1.0 forest,.8 canopy,500 elevation_ft) TO ? (FORMAT PARQUET)",[str(tile)])
            side=tile.with_suffix('.parquet.json')
            side.write_text(json.dumps({'datasetVersion':'fixture-v1','sourceUrl':'https://example.gov/source','status':'PARTIAL'}))
            args=['build-fruiting-gis.py','build','tile','n38_w088','--source-dir',str(source),'--output',str(out),'--resume']
            with patch.object(sys,'argv',args):pub.main(ROOT)
            first=(out/'manifest.json').read_bytes()
            manifest=json.loads(first);entry=manifest['tiles'][0]
            self.assertEqual(entry['habitat']['cells'],1)
            self.assertEqual(entry['publicLands']['status'],'UNBUILT')
            with patch.object(sys,'argv',args):pub.main(ROOT)
            self.assertEqual(first,(out/'manifest.json').read_bytes())
            # Corrupt source must preserve previously published evidence.
            tile.write_bytes(b'broken')
            with patch.object(sys,'argv',args),self.assertRaises(SystemExit):pub.main(ROOT)
            entry=json.loads((out/'manifest.json').read_text())['tiles'][0]['habitat']
            self.assertEqual(entry['status'],'PARTIAL')
            self.assertEqual(entry['lastBuildAttempt']['status'],'FAILED')
            self.assertTrue((out/entry['url']).exists())
            # Explicit verified-empty with valid schema is distinct from missing source.
            tile.unlink()
            con.execute("COPY (SELECT 38.5 lat,-87.5 lon,1.0 forest,.8 canopy,500 elevation_ft WHERE false) TO ? (FORMAT PARQUET)",[str(tile)])
            side.write_text(json.dumps({'datasetVersion':'fixture-v2','sourceUrl':'https://example.gov/source','status':'VERIFIED_EMPTY'}))
            with patch.object(sys,'argv',args):pub.main(ROOT)
            self.assertEqual(json.loads((out/'manifest.json').read_text())['tiles'][0]['habitat']['status'],'VERIFIED_EMPTY')
            con.close()

    def test_completeness_components_are_carried_and_summarized(self):
        with tempfile.TemporaryDirectory() as d:
            base=Path(d);source=base/'source';out=base/'out';(source/'habitat').mkdir(parents=True)
            tile=source/'habitat/n39_w106.parquet'
            con=duckdb.connect()
            con.execute("COPY (SELECT 39.0 lat,-106.0 lon,1.0 forest,.6 canopy,9000 elevation_ft) TO ? (FORMAT PARQUET)",[str(tile)])
            tile.with_suffix('.parquet.json').write_text(json.dumps({
                'datasetVersion':'fixture-habitat-v2','sourceUrl':'https://example.gov/habitat','status':'AVAILABLE',
                'components':{'forestType':'AVAILABLE','elevation':'AVAILABLE','landCover':'AVAILABLE','canopy':'AVAILABLE','soil':'UNBUILT'}}))
            args=['build-fruiting-gis.py','build','tile','n39_w106','--source-dir',str(source),'--output',str(out)]
            with patch.object(sys,'argv',args):pub.main(ROOT)
            manifest=json.loads((out/'manifest.json').read_text())
            habitat=manifest['tiles'][0]['habitat']
            self.assertEqual(habitat['components']['canopy'],'AVAILABLE')
            self.assertEqual(manifest['summary']['layers']['habitat']['available'],1)
            self.assertEqual(manifest['summary']['layers']['habitat']['components']['soil']['UNBUILT'],1)
            con.close()

class AccessPublication(unittest.TestCase):
    def test_modern_access_rejects_generated_starts_and_duplicate_identity(self):
        with tempfile.TemporaryDirectory() as tmp, duckdb.connect() as con:
            source = Path(tmp) / 'access.parquet'
            con.execute("CREATE TABLE access AS SELECT 'osm:node:1' access_id, 'node' osm_type, '1' osm_id, true start_eligible, 'HIGH' evidence_grade, 'TRAILHEAD' AS \"type\", 'osm-node' location_method, NULL::VARCHAR restriction, '[\"p1\"]' property_ids_json, 'v1' source_version, '{\"type\":\"Point\",\"coordinates\":[-105.5,39.5]}' geometry_json")
            columns = {r[0] for r in con.execute('DESCRIBE access').fetchall()}
            meta = {'schemaVersion':2, 'license':'ODbL-1.0', 'attribution':'© OpenStreetMap contributors'}
            def validate():
                con.execute('COPY access TO ? (FORMAT PARQUET)', [str(source)])
                pub.validate_access(con, source, meta, columns)
            validate()
            con.execute("UPDATE access SET location_method='property-centroid'")
            with self.assertRaisesRegex(ValueError, 'Suggested Start'):
                validate()
            con.execute("UPDATE access SET location_method='osm-node'")
            con.execute('INSERT INTO access SELECT * FROM access')
            with self.assertRaisesRegex(ValueError, 'unique stable OSM'):
                validate()


class CoverageMetadata(unittest.TestCase):
    def test_profile_roster_matches_the_browser_mapping(self):
        import re
        html=(ROOT/'fruiting-forecast.html').read_text()
        marker='ECO_PROFILE_GROUPS='
        start=html.index(marker)+len(marker)
        literal=html[start:html.index('};',start)+1]
        browser={name:[int(code) for code in codes.split(',')]
                 for name,codes in re.findall(r'([A-Za-z]+):\[([0-9,]+)\]',literal)}
        self.assertEqual(browser,pub.ECO_PROFILE_GROUPS)

    def test_coverage_dimensions_are_separate_and_derived(self):
        tiles=[
            {'id':'n39_w106','bbox':[-106,39,-105,40],
             'habitat':{'status':'AVAILABLE','url':'a.parquet','components':{'forestType':'AVAILABLE','elevation':'AVAILABLE','landCover':'AVAILABLE','canopy':'AVAILABLE','soil':'AVAILABLE'}}},
            {'id':'n38_w088','bbox':[-88,38,-87,39],'habitat':{'status':'PARTIAL','url':'b.parquet'}},
            {'id':'n39_w107','bbox':[-107,39,-106,40],'habitat':{'status':'UNBUILT'}},
        ]
        coverage=pub.coverage_of(tiles,ROOT)
        # Publication and completeness are different questions.
        self.assertEqual(coverage['publishedTiles'],['n38_w088','n39_w106'])
        self.assertEqual(coverage['coverageTiles'],['n39_w106'])
        # Administrative and ecological dimensions come from pinned boundaries.
        # Bounding-box intersection is approximate addressing, so border states may
        # appear; the tile's own state must be present and counted once.
        self.assertIn('CO',coverage['states'])
        self.assertIn('IN',coverage['states'])
        self.assertEqual(coverage['states']['CO'],1)
        self.assertEqual(coverage['states']['IN'],1)
        self.assertEqual(coverage['ecologicalProfiles']['southernRockies'],1)
        self.assertEqual(coverage['ecologicalProfiles']['hardwood'],1)
        self.assertIn('separate',coverage['coverageSemantics'])

    def test_publication_refreshes_coverage_summary(self):
        with tempfile.TemporaryDirectory() as d:
            base=Path(d);source=base/'source';out=base/'out';(source/'habitat').mkdir(parents=True)
            tile=source/'habitat/n39_w106.parquet'
            con=duckdb.connect()
            con.execute("COPY (SELECT 39.0 lat,-106.0 lon,1.0 forest,.6 canopy,9000 elevation_ft) TO ? (FORMAT PARQUET)",[str(tile)])
            tile.with_suffix('.parquet.json').write_text(json.dumps({
                'datasetVersion':'fixture-habitat-v2','sourceUrl':'https://example.gov/habitat','status':'AVAILABLE',
                'components':{'forestType':'AVAILABLE','elevation':'AVAILABLE','landCover':'AVAILABLE','canopy':'AVAILABLE','soil':'AVAILABLE'}}))
            args=['build-fruiting-gis.py','build','tile','n39_w106','--source-dir',str(source),'--output',str(out)]
            with patch.object(sys,'argv',args):pub.main(ROOT)
            summary=json.loads((out/'manifest.json').read_text())['summary']
            self.assertEqual(summary['coverageTiles'],['n39_w106'])
            self.assertIn('CO',summary['states'])
            self.assertEqual(summary['ecologicalProfiles']['southernRockies'],1)
            con.close()

if __name__=='__main__':unittest.main()
