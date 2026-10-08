import base64
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
import uuid
from datetime import datetime,timezone,timedelta
from unittest.mock import patch
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from desktop.engine import Store
from desktop.guest_passwords import GuestPasswords

class PasswordTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.store=Store(Path(self.temp.name)/'desk.sqlite3');self.id=str(uuid.uuid4());self.request=str(uuid.uuid4());self.source=str(uuid.uuid4());self.secret='fixture-only';self.writes=[];self.calls=[];self.fail=False;self.active=[];self.privileged=False;self.offline=False
  self.user={'id':7,'username':'guest','userGroupId':3};self.groups=[{'id':3,'name':'Клиенты'}]
  outer=self
  class Gizmo:
   def user(self,uid):return outer.user
   def sessions(self):return outer.active
   def request(self,method,path,**kw):
    if path=='usergroups':return outer.groups
    if method=='POST':
     outer.writes.append(path)
     if outer.fail:raise RuntimeError('never expose password-bearing URL')
    if path.endswith('/valid'):return {'result':0,'identity':{'userId':7}}
  class Cloud:
   def desk(self,action,**data):
    outer.calls.append((action,data))
    if action=='password_context':return {'data':{'gizmo_user_id':7,'telegram_id':100}}
    if action=='password_authorize':return {'data':outer.id}
    if action=='password_claim':return {'data':outer.row}
    if outer.offline:raise RuntimeError('offline')
    return {'ok':True}
  self.row={'id':self.id,'request_id':self.request,'gizmo_user_id':7,'username':'guest','group_id':3,'minimum_length':1,'expires_at':(datetime.now(timezone.utc)+timedelta(minutes=10)).isoformat()}
  self.encrypt('x');self.api=GuestPasswords(Cloud(),Gizmo(),self.store,lambda:None);self.env=patch.dict(os.environ,{'AGENT_SECRET':self.secret});self.env.start()
 def encrypt(self,password):
  iv=b'012345678901';encrypted=AESGCM(hashlib.sha256(('1shot-password-v1:'+self.secret).encode()).digest()).encrypt(iv,json.dumps({'password':password}).encode(),(self.id+':'+self.request).encode());self.row['cipher']=base64.b64encode(iv+encrypted).decode()
 def tearDown(self):self.env.stop();self.temp.cleanup()
 def tick(self):self.api.tick([{'id':self.id,'status':'queued'}])
 def test_only_guest_chooses_password_and_write_happens_once(self):
  self.assertTrue(self.api.authorize('password_request',self.source,7,'guest',True)['ok']);self.assertEqual(self.writes,[])
  self.tick();self.tick();self.assertEqual(self.writes,['users/7/password/x']);self.assertEqual(self.store.get('guest-password:'+self.id)['status'],'done')
  journal=json.dumps(self.store.get('guest-password:'+self.id));self.assertNotIn('cipher',journal);self.assertNotIn('password',journal)
 def test_explicit_confirmation_and_correct_account(self):
  self.assertIn('error',self.api.authorize('password_request',self.source,7,'guest'))
  with self.assertRaises(ValueError):self.api.authorize('password_request',self.source,8,'guest',True)
  self.assertEqual(self.writes,[])
 def test_privileged_account_requires_extra_confirmation_and_minimum_eight(self):
  self.groups=[{'id':3,'name':'Операторы'}]
  with self.assertRaises(ValueError):self.api.authorize('password_request',self.source,7,'guest',True)
  self.api.authorize('password_request',self.source,7,'guest',True,True)
  self.assertEqual(self.calls[-1][1]['minimum_length'],8)
  self.tick();self.assertEqual(self.writes,[]);self.assertEqual(self.store.get('guest-password:'+self.id)['status'],'attention')
 def test_account_policy_change_blocks_write(self):
  self.user['userGroupId']=99;self.tick();self.assertEqual(self.writes,[])
 def test_active_session_never_logged_out_or_modified(self):
  self.active=[{'userId':7}]
  with self.assertRaises(ValueError):self.api.authorize('password_request',self.source,7,'guest',True)
  self.tick();self.assertEqual(self.writes,[])
 def test_uncertain_write_never_replayed(self):
  self.fail=True;self.tick();self.tick();self.assertEqual(len(self.writes),1);self.assertEqual(self.store.get('guest-password:'+self.id)['status'],'attention')
 def test_only_reporting_retries(self):
  self.offline=True;self.tick();self.offline=False;self.tick();self.assertEqual(len(self.writes),1);self.assertTrue(self.store.get('guest-password:'+self.id)['synced'])
 def test_bad_aad_never_writes(self):
  self.row['request_id']=str(uuid.uuid4());self.tick();self.assertEqual(self.writes,[])
 def test_expired_never_writes(self):
  self.row['expires_at']=(datetime.now(timezone.utc)-timedelta(seconds=1)).isoformat();self.tick();self.assertEqual(self.writes,[])
 def test_crash_intent_blocks_replay(self):
  self.store.set('guest-password:'+self.id,{'phase':'intent'});self.tick();self.assertEqual(self.calls,[])
 def test_access_resolution_never_writes_password(self):
  proof=str(uuid.uuid4());calls=[]
  def desk(action,**data):
   calls.append(action)
   if action=='password_review':return {'data':{'proof_id':proof,'gizmo_user_id':7}}
   return {'ok':True}
  self.api.cloud.desk=desk
  self.assertIn('error',self.api.resolve(self.id,proof,7))
  self.assertTrue(self.api.resolve(self.id,proof,7,True)['ok']);self.assertTrue(self.api.resolve(self.id,proof,7,True)['ok'])
  self.assertEqual(calls.count('password_review'),1);self.assertEqual(self.writes,[])
 def test_failed_verification_never_claims_success(self):
  original=self.api.gizmo.request
  def request(method,path,**kw):
   if path.endswith('/valid'):return {'result':1}
   return original(method,path,**kw)
  self.api.gizmo.request=request;self.tick();self.assertEqual(self.store.get('guest-password:'+self.id)['status'],'attention');self.assertEqual(len(self.writes),1)
 def test_old_desk_password_entry_points_are_disabled(self):
  from desktop.app import App
  app=App.__new__(App)
  self.assertIn('error',app.reset_password(7,'guest','secret',True));self.assertIn('error',app.reset_password_request(self.source,'guest','secret',True))
if __name__=='__main__':unittest.main()
