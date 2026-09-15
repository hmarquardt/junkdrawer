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

if __name__=='__main__':unittest.main()
