import tempfile
import unittest
from pathlib import Path
from desktop.accounts import Accounts,session_record
from desktop.engine import Store,UnsafeOperation
from desktop.sound import Sound

class Gizmo:
 def __init__(self):
  self.member={'id':7,'username':'guest','userGroupId':3,'firstName':'Old','lastName':'Name','birthDate':'2000-01-02','email':'g@example.test','mobilePhone':'123'}
  self.active=[{'userId':7,'hostId':50,'hostNumber':101,'lastLogin':'2026-09-25T10:00:00Z'}];self.writes=[]
 def user(self,id):return dict(self.member)
 def sessions(self):return [dict(s) for s in self.active]
 def request(self,method,path,**kw):
  if method=='POST':self.writes.append((path,kw))
  if path.endswith('/balance'):return {'userId':7,'balance':123.45}
  if path.endswith('/logout'):self.active=[]
  if path=='users' and method=='POST':
   for key,value in kw['params'].items():
    if key!='UserId':self.member[key[0].lower()+key[1:]]=value
  if path.endswith('/valid'):return {'result':0,'identity':{'userId':7}}
class AccountsTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.store=Store(Path(self.temp.name)/'test.db');self.gizmo=Gizmo();self.api=Accounts(self.gizmo,None,self.store,lambda:None)
 def tearDown(self):self.temp.cleanup()
 def test_real_balance_and_session(self):
  data=self.api.read(7);self.assertEqual(data['balance'],123.45);self.assertEqual(data['session']['host_id'],'101')
 def test_logout_only_expected_session(self):
  payload=session_record(self.gizmo.active[0]);self.api.execute({'kind':'logout','gizmo_user_id':7,'payload':payload});self.assertEqual(len(self.gizmo.writes),1)
 def test_new_session_not_logged_out(self):
  payload=session_record(self.gizmo.active[0]);self.gizmo.active[0]['lastLogin']='2026-09-25T11:00:00Z'
  with self.assertRaises(UnsafeOperation):self.api.execute({'kind':'logout','gizmo_user_id':7,'payload':payload})
  self.assertEqual(self.gizmo.writes,[])
 def test_multi_session_logout_refused(self):
  payload=session_record(self.gizmo.active[0]);self.gizmo.active.append(dict(self.gizmo.active[0],hostId=51))
  with self.assertRaises(UnsafeOperation):self.api.execute({'kind':'logout','gizmo_user_id':7,'payload':payload})
  self.assertEqual(self.gizmo.writes,[])
 def test_name_change_preserves_birthday(self):
  self.gizmo.active=[];self.api.execute({'kind':'profile_edit','gizmo_user_id':7,'payload':{'firstName':'New','username':'guest2'}})
  self.assertEqual(self.gizmo.member['birthDate'],'2000-01-02');self.assertEqual(self.gizmo.member['username'],'guest2')
 def test_birthday_edit_forbidden(self):
  self.gizmo.active=[]
  with self.assertRaises(UnsafeOperation):self.api.execute({'kind':'profile_edit','gizmo_user_id':7,'payload':{'birthDate':'1999-01-01'}})
  self.assertEqual(self.gizmo.writes,[])
 def test_operator_group_cannot_be_reset(self):
  self.gizmo.member['userGroupId']=1;self.gizmo.active=[]
  with self.assertRaises(UnsafeOperation):self.api.reset(7,'guest','password123')
  self.assertEqual(self.gizmo.writes,[])
 def test_find_by_phone_resolves_actual_username_and_identity(self):
  request=self.gizmo.request
  def lookup(method,path,**kw):
   if path=='users' and method=='GET':return [dict(self.gizmo.member,mobilePhone='+79991234567')]
   if path.endswith('/exist'):return False
   if path=='users/guest/username':return dict(self.gizmo.member)
   return request(method,path,**kw)
  self.gizmo.request=lookup
  actual=self.api.find('+7 (999) 123-45-67');self.assertEqual(actual['id'],7);self.assertEqual(actual['username'],'guest');self.assertEqual(actual['firstName'],'Old');self.assertEqual(self.gizmo.writes,[])
 def test_reset_checks_selected_username(self):
  self.gizmo.active=[]
  with self.assertRaises(UnsafeOperation):self.api.reset(7,'somebody-else','password123')
  self.assertEqual(self.gizmo.writes,[])
 def test_admin_reset_verifies_new_credentials(self):
  self.gizmo.active=[];self.assertTrue(self.api.reset(7,'guest','password123'))
 def test_request_reset_retries_only_cloud_outcome_after_connection_loss(self):
  class Cloud:
   def __init__(self):self.offline=True;self.calls=[]
   def desk(self,action,**data):
    self.calls.append((action,data))
    if self.offline:raise RuntimeError('Supabase: HTTP 409 lease_expired')
    return {'ok':True}
  cloud=Cloud();self.api.cloud=cloud;self.gizmo.active=[]
  self.assertTrue(self.api.reset(7,'guest','test-password',request_id='request-1'))
  self.assertIn('request-1',self.store.get('password-outcomes'));self.assertFalse(self.store.get('password-outcomes')['request-1'].get('conflict'))
  writes=list(self.gizmo.writes);cloud.offline=False;self.api.flush_password_results()
  self.assertEqual(self.store.get('password-outcomes'),{});self.assertEqual(self.gizmo.writes,writes)
  self.api.reset(7,'guest','different-password',request_id='request-1');self.assertEqual(self.gizmo.writes,writes)
  self.assertNotIn('test-password',str(self.store.get('password-reset:request-1')))
 def test_unknown_password_intent_cannot_replay(self):
  self.gizmo.active=[];self.store.set('password-reset:r',{'phase':'intent','user_id':7})
  with self.assertRaises(UnsafeOperation):self.api.reset(7,'guest','test-password',request_id='r')
  self.assertEqual(self.gizmo.writes,[])
 def test_manual_close_has_no_gizmo_side_effect_and_conflict_is_not_overwritten(self):
  class Cloud:
   def desk(self,action,**data):return {'ok':False,'conflict':True}
  self.api.cloud=Cloud();self.assertFalse(self.api.queue_password_result('r','rejected'))
  self.assertTrue(self.store.get('password-outcomes')['r']['conflict']);self.assertEqual(self.gizmo.writes,[])
  with self.assertRaises(UnsafeOperation):self.api.queue_password_result('r','done')
 def test_soft_sound_volume_and_saved_preferences(self):
  sound=Sound(Path(self.temp.name),self.store);self.assertEqual(sound.settings['preset'],'soft');self.assertTrue(sound.path().exists())
  sound.configure({'preset':'chime','volume':25,'repeat':30,'enabled':False});other=Sound(Path(self.temp.name),self.store);self.assertEqual(other.settings['volume'],25);self.assertFalse(other.settings['enabled'])

class ShutdownTests(unittest.TestCase):
 def test_close_hides_but_exit_destroys_before_tray_stop(self):
  import threading
  from unittest.mock import Mock,patch
  from desktop.app import App
  app=App.__new__(App);app.window=Mock();app.exiting=False
  self.assertFalse(app.close());app.window.hide.assert_called_once()
  app.exit_prompt=threading.Lock();app.stop=threading.Event();app.sound=Mock();app.tray=Mock()
  order=[];app.window.destroy.side_effect=lambda:order.append('window');app.tray.stop.side_effect=lambda:order.append('tray')
  with patch('desktop.app.sys.platform','linux'):app.quit()
  self.assertTrue(app.stop.is_set());self.assertTrue(app.exiting);app.window.destroy.assert_called_once();self.assertEqual(order[0],'window')
  self.assertTrue(app.close())
