import os
import unittest
from unittest.mock import patch,Mock
from desktop.services import Cloud,ApiError
from desktop.polling import PollBudget

class EconomyTests(unittest.TestCase):
 def test_idle_budget_and_bounded_fast_poll(self):
  now=[0];budget=PollBudget(lambda:now[0]);rows=[{'id':'1','status':'checkin_pending'}]
  self.assertEqual(budget.interval(),5)
  self.assertEqual(31*86400//budget.interval(),535680)
  self.assertEqual(budget.interval(rows),2)
  now[0]=31;self.assertEqual(budget.interval(rows),5)
  self.assertEqual([budget.interval(failed=True) for _ in range(5)],[20,40,60,60,60])
  self.assertEqual(budget.interval(),5)
 def cloud(self,direct=False):
  with patch.dict(os.environ,{'SUPABASE_URL':'https://example.test','AGENT_SECRET':'test-only'}):c=Cloud()
  if not direct:c.rpc_base=None  # these tests cover the edge-function path
  return c
 def test_direct_snapshot_skips_the_function_and_falls_back_on_an_old_server(self):
  cloud=self.cloud(direct=True);cloud.request=Mock(return_value={'eco_version':1});cloud.host_source=lambda:[]
  ok=Mock(ok=True,status_code=200,text='{}');ok.json.return_value={'eco_version':1,'queues':[{'host_id':'13','username':'neo'}]}
  with patch('desktop.services.requests.post',return_value=ok) as post:
   self.assertEqual(cloud.snapshot(3)['queues'][0]['host_id'],'13')
  self.assertFalse(cloud.request.called);self.assertTrue(cloud.direct)
  args=post.call_args;self.assertTrue(args.args[0].endswith('/rest/v1/rpc/club_desk_snapshot'));self.assertEqual(args.kwargs['json']['p_secret'],'test-only');self.assertEqual(args.kwargs['json']['p_after'],3)
  missing=Mock(ok=False,status_code=404,text='{"code":"PGRST202"}')
  cloud=self.cloud(direct=True);cloud.request=Mock(return_value={'eco_version':1});cloud.host_source=lambda:[]
  with patch('desktop.services.requests.post',return_value=missing) as post:
   cloud.snapshot(0);cloud.snapshot(0)
  self.assertEqual(post.call_count,1,'an old server is not asked again for ten minutes');self.assertEqual(cloud.request.call_count,2);self.assertFalse(cloud.direct)
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
