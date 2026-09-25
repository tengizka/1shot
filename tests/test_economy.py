import os
import unittest
from unittest.mock import patch,Mock
from desktop.services import Cloud,ApiError
from desktop.polling import PollBudget

class EconomyTests(unittest.TestCase):
 def test_idle_budget_and_bounded_fast_poll(self):
  now=[0];budget=PollBudget(lambda:now[0]);rows=[{'id':'1','status':'checkin_pending'}]
  self.assertEqual(budget.interval(),10)
  self.assertEqual(31*86400//budget.interval(),267840)
  self.assertEqual(budget.interval(rows),2)
  now[0]=31;self.assertEqual(budget.interval(rows),10)
  self.assertEqual([budget.interval(failed=True) for _ in range(5)],[20,40,60,60,60])
  self.assertEqual(budget.interval(),10)
 def cloud(self):
  with patch.dict(os.environ,{'SUPABASE_URL':'https://example.test','AGENT_SECRET':'test-only'}):return Cloud()
 def test_idle_snapshot_is_one_request(self):
  cloud=self.cloud();cloud.request=Mock(return_value={'eco_version':1})
  cloud.host_source=lambda:[{'host_id':'11','status':'free'}]
  cloud.snapshot(4)
  self.assertEqual(cloud.request.call_count,1)
  body=cloud.request.call_args.kwargs['body']
  self.assertEqual(body['eco'],1);self.assertEqual(body['after_event'],4);self.assertEqual(len(body['hosts']),1)
 def test_account_updates_piggyback_and_retry_only_cache(self):
  cloud=self.cloud();cloud.request=Mock(side_effect=ApiError('offline'))
  cloud.desk('account',telegram_id=1,gizmo_user_id=7,data={'balance':5})
  self.assertFalse(cloud.request.called)
  with self.assertRaises(ApiError):cloud.snapshot(0)
  self.assertEqual(len(cloud.account_updates),1)
  cloud.request=Mock(return_value={'eco_version':1});cloud.snapshot(0)
  self.assertEqual(len(cloud.request.call_args.kwargs['body']['accounts']),1)
  self.assertIn('observed_at',cloud.request.call_args.kwargs['body']['accounts'][0]);self.assertFalse(cloud.account_updates)
 def test_old_backend_refused_without_legacy_request_storm(self):
  cloud=self.cloud();cloud.request=Mock(return_value={'bookings':[]})
  cloud.desk('account',telegram_id=1,gizmo_user_id=7,data={})
  with self.assertRaises(ApiError):cloud.snapshot(0)
  self.assertEqual(cloud.request.call_count,1);self.assertEqual(len(cloud.account_updates),1)
 def test_stale_hosts_are_not_heartbeated(self):
  cloud=self.cloud();cloud.request=Mock(return_value={'eco_version':1});cloud.snapshot(0)
  self.assertIsNone(cloud.request.call_args.kwargs['body']['hosts'])
