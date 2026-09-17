import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import fruiting_remote as remote
import fruiting_tile_publish as pub
import duckdb

class RemotePublication(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.file=self.root/'tiny.parquet';self.file.write_bytes(b'parquet')
        self.asset={'url':'habitat/n39_w106-abcdef.parquet','bytes':7,'sha256':hashlib.sha256(b'parquet').hexdigest()}
        self.ledger=self.root/'inventory.jsonl'
    def test_references_excludes_shadowed_legacy_tile_url(self):
        m={'tiles':[{'bbox':[0,0,1,1],'url':'missing.parquet','habitat':self.asset}]}
        self.assertEqual(list(remote.references(m)),[self.asset['url']])
    def test_conflicting_reference_rejected(self):
        with self.assertRaises(remote.IntegrityError):remote.references([self.asset,{**self.asset,'bytes':8}])
    def test_resume_valid_remote_skips_upload(self):
        with patch.object(remote,'remote_bytes',return_value=(b'parquet',{'seconds':.1,'retries':0})),patch.object(remote.subprocess,'run') as put:
            self.assertFalse(remote.ensure_remote(self.file,self.asset,inventory=self.ledger)['uploaded']);put.assert_not_called()
    def test_remote_collision_never_overwritten(self):
        with patch.object(remote,'remote_bytes',side_effect=remote.IntegrityError('wrong hash')),patch.object(remote.subprocess,'run') as put:
            with self.assertRaises(remote.IntegrityError):remote.ensure_remote(self.file,self.asset,inventory=self.ledger)
            put.assert_not_called()
    def test_upload_intent_precedes_put_and_verification(self):
        events=[]
        def get(*args):
            events.append('get');return (None if len(events)==1 else b'parquet'),{'seconds':.1,'retries':0}
        def put(*args,**kw):
            self.assertIn('upload-intent',self.ledger.read_text());events.append('put');return type('Result',(),{'returncode':0})()
        with patch.object(remote,'remote_bytes',side_effect=get),patch.object(remote.subprocess,'run',side_effect=put):
            self.assertTrue(remote.ensure_remote(self.file,self.asset,inventory=self.ledger)['uploaded'])
        self.assertEqual(events,['get','put','get'])
    def test_lock_released_after_interruption(self):
        with self.assertRaises(KeyboardInterrupt):
            with remote.publication_lock(self.root):raise KeyboardInterrupt
        with remote.publication_lock(self.root):pass
    def test_manifest_never_references_failed_remote_upload(self):
        src=self.root/'src/habitat';src.mkdir(parents=True);f=src/'n39_w106.parquet';out=self.root/'out';out.mkdir()
        with duckdb.connect() as c:c.execute('COPY (SELECT 39.5 lat,-105.5 lon,1 forest,0.5 canopy,9000 elevation_ft) TO ? (FORMAT PARQUET)',[str(f)])
        f.with_suffix('.parquet.json').write_text(json.dumps({'status':'AVAILABLE','datasetVersion':'test','sourceUrl':'https://example.gov'}))
        (out/'manifest.json').write_text(json.dumps({'tiles':[],'assetBaseUrl':remote.ORIGIN}))
        with patch.object(remote,'ensure_remote',side_effect=RuntimeError('interrupted')):
            self.assertEqual(pub.publish_tiles(self.root,['n39_w106'],['habitat'],src.parent,out),1)
        self.assertNotIn('url',json.loads((out/'manifest.json').read_text())['tiles'][0]['habitat'])
        with patch.object(remote,'ensure_remote',return_value={}) as ensure:
            self.assertEqual(pub.publish_tiles(self.root,['n39_w106'],['habitat'],src.parent,out,resume=True),0)
            self.assertEqual(ensure.call_count,1)
        self.assertIn('url',json.loads((out/'manifest.json').read_text())['tiles'][0]['habitat'])
    def test_integrity_requires_both_size_and_digest(self):
        for b in [b'bad',b'PARQUET']:
            with self.assertRaises(remote.IntegrityError):remote.validate(b,self.asset)

if __name__=='__main__':unittest.main()
