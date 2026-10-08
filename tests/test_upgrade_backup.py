from contextlib import closing
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from desktop.upgrade_backup import backup,verify

class BackupTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.source=self.root/'settings';self.source.mkdir();self.target=self.root/'backup'
  (self.source/'.env').write_text('SECRET=fixture-not-real\n');(self.source/'preferences.json').write_text('{"volume":25}')
  self.db=sqlite3.connect(self.source/'desk.sqlite3');self.db.execute('pragma journal_mode=wal');self.db.execute('create table state(key text,value text)');self.db.execute("insert into state values('pending','preserve')");self.db.commit()
 def tearDown(self):self.db.close();self.temp.cleanup()
 def test_live_wal_snapshot_and_secrets_preserved_not_in_manifest(self):
  data=backup(self.source,self.target);self.assertTrue(verify(self.target))
  with closing(sqlite3.connect(self.target/'desk.sqlite3')) as db:self.assertEqual(db.execute('select value from state').fetchone()[0],'preserve')
  self.assertEqual((self.target/'.env').read_bytes(),(self.source/'.env').read_bytes());self.assertNotIn('fixture-not-real',json.dumps(data));self.assertFalse((self.target/'desk.sqlite3-wal').exists())
 def test_existing_target_refused(self):
  self.target.mkdir()
  with self.assertRaises(ValueError):backup(self.source,self.target)
 def test_nested_target_refused(self):
  with self.assertRaises(ValueError):backup(self.source,self.source/'backup')
 def test_tamper_detected(self):
  backup(self.source,self.target);(self.target/'.env').write_text('changed')
  with self.assertRaises(ValueError):verify(self.target)
 def test_symlink_refused(self):
  try:(self.source/'outside').symlink_to(self.root,target_is_directory=True)
  except OSError:self.skipTest('symlink privilege unavailable')
  with self.assertRaises(ValueError):backup(self.source,self.target)
if __name__=='__main__':unittest.main()
