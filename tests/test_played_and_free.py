import unittest
from datetime import datetime,timezone
from desktop.accounts import span_hours
from desktop.services import LegacyBridge

class SpanTests(unittest.TestCase):
 def test_formats(self):
  self.assertEqual(span_hours({'totalHours':12.5}),12.5)
  self.assertAlmostEqual(span_hours('1.02:30:00'),26.5)
  self.assertAlmostEqual(span_hours('03:15:00'),3.25)
  self.assertEqual(span_hours('7,5'),7.5)
  self.assertIsNone(span_hours('abc'))

class Gizmo:
 def __init__(self,left):self.left=left
 def hosts(self):return [{'id':5,'number':13,'state':0},{'id':6,'number':14,'state':0}]
 def sessions(self):return [{'hostNumber':13,'userId':7}]
 def request(self,method,path,**kw):return {'userId':7,'availableTime':self.left}

class FreeAtTests(unittest.TestCase):
 def test_busy_host_gets_end_time(self):
  rows={r['host_id']:r for r in LegacyBridge(Gizmo(5400),None,None).collect_hosts()}
  left=(datetime.fromisoformat(rows['13']['free_at'])-datetime.now(timezone.utc)).total_seconds()
  self.assertTrue(5300<left<=5400);self.assertNotIn('free_at',rows['14'])
 def test_long_deposit_has_no_end_time(self):
  rows={r['host_id']:r for r in LegacyBridge(Gizmo(20*3600),None,None).collect_hosts()}
  self.assertIsNone(rows['13']['free_at'])
