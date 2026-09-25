import copy
import tempfile
import time
import unittest
from datetime import datetime,timezone
from desktop.engine import Controller,Store

NOW=1900000000
def iso(n):return datetime.fromtimestamp(n,timezone.utc).isoformat()
def booking(**kw):return dict(id='b',host_id='101',gizmo_user_id=7,status='requested',starts_at=iso(NOW-1),hold_until=iso(NOW+3600),**kw)
class Cloud:
 def __init__(self,b):self.b=b;self.calls=[]
 def snapshot(self,cursor):return {'bookings':[copy.deepcopy(self.b)],'events':[],'lease_seconds':30}
 def transition(self,id,old,new,message,code):
  self.calls.append(new)
  if self.b['status']!=old:return False
  self.b['status']=new;return True
class Gizmo:
 def __init__(self):self.h={'id':50,'number':101,'state':0,'modifiedTime':'a'};self.active=[];self.locks=[];self.logins=[];self.fail_lock=False;self.fail_login=False
 def hosts(self):return [copy.deepcopy(self.h)]
 def host(self,id):return copy.deepcopy(self.h)
 def sessions(self):return copy.deepcopy(self.active)
 def lock(self,id,value):
  self.locks.append(value);self.h.update(state=2 if value else 0,modifiedTime='b' if value else 'c')
  if self.fail_lock:raise TimeoutError('unknown lock outcome')
 def user(self,id):return {'id':id}
 def login(self,user,host):
  self.logins.append((user,host))
  if self.fail_login:raise TimeoutError('unknown login outcome')
class TestClubController(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.store=Store(self.tmp.name+'/journal.db');self.cloud=Cloud(booking());self.gizmo=Gizmo();self.now=NOW
  self.ctrl=Controller(self.cloud,self.gizmo,self.store,lambda:self.now)
 def tearDown(self):self.tmp.cleanup()
 def test_lock_confirm_and_expire_owned_only(self):
  self.ctrl.tick();self.assertEqual(self.cloud.b['status'],'holding');self.assertEqual(self.gizmo.locks,[True]);self.assertEqual(len(self.store.get('booking:b')['code']),6)
  self.now+=3601;self.ctrl.tick();self.assertEqual(self.gizmo.locks,[True,False]);self.assertEqual(self.cloud.b['status'],'expired')
 def test_busy_scheduled_cancelled_without_kicking_or_later_lock(self):
  self.gizmo.active=[{'hostId':50,'userId':99}];self.ctrl.tick();self.assertEqual(self.cloud.b['status'],'cancelled');self.assertEqual(self.gizmo.locks,[])
  self.gizmo.active=[];self.ctrl.tick();self.assertEqual(self.cloud.b['status'],'cancelled');self.assertEqual(self.gizmo.locks,[])
 def test_future_does_not_lock(self):
  self.cloud.b['starts_at']=iso(NOW+100);self.ctrl.tick();self.assertEqual(self.gizmo.locks,[])
 def test_preexisting_lock_never_claimed_or_released(self):
  self.gizmo.h['state']=2;self.ctrl.tick();self.assertEqual(self.cloud.b['status'],'attention');self.now+=4000;self.ctrl.tick();self.assertEqual(self.gizmo.locks,[])
 def test_external_change_never_unlocked(self):
  self.ctrl.tick();self.gizmo.h['modifiedTime']='operator-changed';self.now+=4000;self.ctrl.tick();self.assertEqual(self.gizmo.locks,[True]);self.assertEqual(self.cloud.b['status'],'attention')
 def test_missing_journal_preserves_lock(self):
  self.ctrl.tick();self.store.set('booking:b',None);self.now+=4000;self.ctrl.tick();self.assertEqual(self.gizmo.locks,[True]);self.assertEqual(self.cloud.b['status'],'attention')
 def test_missing_stamp_refuses_lock(self):
  self.gizmo.h['modifiedTime']=None;self.ctrl.tick();self.assertEqual(self.gizmo.locks,[])
 def test_unchanged_stamp_requires_manual_review(self):
  self.gizmo.h['modifiedTime']='b';self.ctrl.tick();self.now+=4000;self.ctrl.tick();self.assertEqual(self.gizmo.locks,[True]);self.assertEqual(self.cloud.b['status'],'attention')
 def test_lock_timeout_never_replayed(self):
  self.gizmo.fail_lock=True;self.ctrl.tick();self.ctrl.tick();self.assertEqual(self.gizmo.locks,[True]);self.assertEqual(self.cloud.b['status'],'attention')
 def test_checkin_verifies_session_and_never_replays_login(self):
  self.ctrl.tick();self.cloud.b['status']='checkin_pending';self.ctrl.tick();self.ctrl.tick();self.assertEqual(len(self.gizmo.logins),1)
  self.gizmo.active=[{'hostId':50,'userId':7}];self.ctrl.tick();self.assertEqual(self.cloud.b['status'],'in_session');self.assertEqual(self.gizmo.locks,[True,False])
  self.now+=9000;self.ctrl.tick();self.assertEqual(self.cloud.b['status'],'in_session')
  self.gizmo.active=[];self.ctrl.tick();self.now+=11;self.ctrl.tick();self.assertEqual(self.cloud.b['status'],'completed')
 def test_login_timeout_reconciles_instead_of_replaying(self):
  self.ctrl.tick();self.gizmo.fail_login=True;self.cloud.b['status']='checkin_pending';self.ctrl.tick();self.now+=20;self.ctrl.tick();self.ctrl.tick();self.assertEqual(len(self.gizmo.logins),1)
  self.gizmo.active=[{'hostId':50,'userId':7}];self.ctrl.tick();self.assertEqual(self.cloud.b['status'],'in_session')
 def test_session_on_another_pc_does_not_confirm(self):
  self.ctrl.tick();self.cloud.b['status']='checkin_pending';self.ctrl.tick();self.gizmo.active=[{'hostId':51,'userId':7}];self.now+=20;self.ctrl.tick();self.assertEqual(self.cloud.b['status'],'attention')
 def test_no_session_interrupted_during_release(self):
  self.ctrl.tick();self.gizmo.active=[{'hostId':50,'userId':99}];self.now+=4000;self.ctrl.tick();self.assertEqual(self.gizmo.locks,[True]);self.assertEqual(self.cloud.b['status'],'attention')
 def test_account_on_another_host_not_moved(self):
  self.ctrl.tick();self.cloud.b['status']='checkin_pending';self.gizmo.active=[{'hostId':51,'userId':7}];self.ctrl.tick();self.assertEqual(self.gizmo.logins,[]);self.assertEqual(self.gizmo.locks,[True]);self.assertEqual(self.cloud.b['status'],'attention')
 def test_v2_hold_does_not_require_or_rotate_code(self):
  self.cloud.b['protocol']=2;self.ctrl.tick();self.assertEqual(self.cloud.b['status'],'holding');self.assertIsNone(self.store.get('booking:b')['code']);self.now+=180;self.ctrl.tick();self.assertIsNone(self.store.get('booking:b')['code'])
 def test_instant_enters_without_guest_code(self):
  self.cloud.b.update(protocol=2,instant=True);self.ctrl.tick();self.assertEqual(self.cloud.b['status'],'checkin_pending');self.assertNotIn('holding',self.cloud.calls);self.assertEqual(self.gizmo.logins,[(7,50)]);self.assertEqual(self.gizmo.locks,[]);self.ctrl.tick();self.assertEqual(self.gizmo.logins,[(7,50)])
 def test_direct_login_timeout_is_not_replayed_and_never_locks(self):
  self.cloud.b.update(protocol=2,instant=True);self.gizmo.fail_login=True;self.ctrl.tick();self.ctrl.tick();self.assertEqual(self.gizmo.locks,[]);self.assertEqual(self.gizmo.logins,[(7,50)])
  self.gizmo.active=[{'hostId':50,'userId':7}];self.ctrl.tick();self.assertEqual(self.cloud.b['status'],'in_session');self.assertEqual(self.gizmo.logins,[(7,50)])
 def test_direct_login_rejects_busy_and_foreign_locked_pc(self):
  self.cloud.b.update(protocol=2,instant=True);self.gizmo.active=[{'hostId':50,'userId':99}];self.ctrl.tick();self.assertEqual(self.gizmo.logins,[]);self.assertEqual(self.gizmo.locks,[])
  self.cloud.b['status']='requested';self.gizmo.active=[];self.gizmo.h['state']=2;self.ctrl.tick();self.assertEqual(self.gizmo.logins,[]);self.assertEqual(self.gizmo.locks,[])
 def test_direct_login_rechecks_before_post(self):
  self.cloud.b.update(protocol=2,instant=True)
  self.gizmo.host=lambda id:dict(self.gizmo.h,state=2)
  self.ctrl.tick();self.assertEqual(self.gizmo.logins,[]);self.assertEqual(self.gizmo.locks,[])
 def test_direct_login_does_not_move_existing_user(self):
  self.cloud.b.update(protocol=2,instant=True);self.gizmo.active=[{'hostId':51,'userId':7}];self.ctrl.tick();self.assertEqual(self.gizmo.logins,[]);self.assertEqual(self.gizmo.locks,[])
 def test_instant_events_never_notify(self):
  self.cloud.b.update(protocol=2,instant=True)
  self.cloud.snapshot=lambda cursor:{'bookings':[copy.deepcopy(self.cloud.b)],'events':[{'id':1,'kind':'created','booking_id':'b'},{'id':2,'kind':'attention','booking_id':'old','instant':True}],'lease_seconds':30}
  self.ctrl.tick();self.assertEqual(self.store.get('alerts'),{});self.assertEqual(self.store.get('event_cursor'),2)
 def test_normal_booking_still_notifies(self):
  self.cloud.snapshot=lambda cursor:{'bookings':[copy.deepcopy(self.cloud.b)],'events':[{'id':1,'kind':'created','booking_id':'b'}],'lease_seconds':30}
  self.ctrl.tick();self.assertIn('1',self.store.get('alerts'))
 def test_friend_release_never_logs_owner_in(self):
  self.cloud.b.update(protocol=2,for_friend=True);self.ctrl.tick();self.cloud.b['status']='release_requested';self.ctrl.tick();self.assertEqual(self.gizmo.locks,[True,False]);self.assertEqual(self.gizmo.logins,[]);self.assertEqual(self.cloud.b['status'],'completed')
 def test_friend_cannot_enter_owner_account(self):
  self.cloud.b.update(protocol=2,for_friend=True);self.ctrl.tick();self.cloud.b['status']='checkin_pending';self.ctrl.tick();self.assertEqual(self.gizmo.logins,[]);self.assertEqual(self.cloud.b['status'],'attention')
 def test_shutdown_stops_new_gizmo_side_effects(self):
  self.ctrl.stopping=lambda:True;self.ctrl.tick();self.assertEqual(self.gizmo.locks,[])
 def test_expired_lease_blocks_side_effects(self):
  with self.assertRaises(Exception):self.ctrl.step(self.cloud.b)
  self.assertEqual(self.gizmo.locks,[])
 def test_cancel_releases_only_owned_hold(self):
  self.ctrl.tick();self.cloud.b['status']='cancel_requested';self.ctrl.tick();self.assertEqual(self.cloud.b['status'],'cancelled');self.assertEqual(self.gizmo.locks,[True,False])
