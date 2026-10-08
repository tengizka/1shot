import base64
import hashlib
import json
import os
import tempfile
import unittest
import uuid
from datetime import datetime, timezone, timedelta, date
from pathlib import Path
from unittest.mock import patch
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from desktop.engine import Store
from desktop.registration import registration_params
from desktop.registration_approval import RegistrationApproval

class Gizmo:
 def __init__(self):self.writes=[];self.member=None;self.users=[];self.fail_password=False;self.created_id=7
 def request(self,method,path,**kwargs):
  if method in ('PUT','POST'):self.writes.append((method,path))
  if path=='usergroups':return [{'id':8,'name':'18+'},{'id':15,'name':'Клиенты'}]
  if path.endswith('/exist'):return False
  if path=='users' and method=='GET':return self.users
  if path=='users' and method=='PUT':self.member={k[0].lower()+k[1:]:v for k,v in kwargs['params'].items()};return self.created_id
  if '/password/' in path and self.fail_password:raise RuntimeError('private error with password')
  if path.endswith('/valid'):return {'result':0,'identity':{'userId':7}}
 def user(self,uid):return self.member
class Cloud:
 def __init__(self,row):self.row=row;self.claimed=0;self.finished=[];self.offline=False
 def desk(self,action,**data):
  if action=='registration_claim':
   self.claimed+=1
   if self.claimed>1:raise RuntimeError('already consumed')
   return {'request':self.row}
  if action=='registration_finish':
   if self.offline:raise RuntimeError('offline')
   self.finished.append(data);return {'ok':True}
  return {'ok':True}
class ApprovalTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.store=Store(Path(self.temp.name)/'desk.sqlite3');self.id=str(uuid.uuid4());self.secret='fixture-secret'
  self.payload={'action':'register_application','username':'new_guest','password':'x','first_name':'Test','last_name':'Guest','mobile_phone':'+79991234567','birth_date':'2000-01-01','sex':1}
  iv=b'012345678901';raw=iv+AESGCM(hashlib.sha256(('1shot-auth-v2:'+self.secret).encode()).digest()).encrypt(iv,json.dumps(self.payload).encode(),self.id.encode())
  self.row={'id':self.id,'telegram_id':100,'cipher':base64.b64encode(raw).decode(),'expires_at':(datetime.now(timezone.utc)+timedelta(days=1)).isoformat()}
  self.cloud=Cloud(self.row);self.gizmo=Gizmo();self.api=RegistrationApproval(self.cloud,self.gizmo,self.store,lambda:None);self.env=patch.dict(os.environ,{'AGENT_SECRET':self.secret});self.env.start()
 def tearDown(self):self.env.stop();self.temp.cleanup()
 def test_explicit_confirmation_required(self):
  for value in (False,'true',1):self.assertIn('error',self.api.approve(self.id,value))
  self.assertEqual(self.cloud.claimed,0);self.assertEqual(self.gizmo.writes,[])
 def test_one_character_password_and_one_creation(self):
  self.assertTrue(self.api.approve(self.id,True)['ok']);before=list(self.gizmo.writes);self.api.approve(self.id,True)
  self.assertEqual(self.gizmo.writes,before);self.assertEqual(self.cloud.claimed,1)
  saved=json.dumps(self.store.get('registration:'+self.id));self.assertNotIn('password',saved);self.assertNotIn('cipher',saved)
 def test_restart_retries_only_result(self):
  self.cloud.offline=True;self.assertFalse(self.api.approve(self.id,True)['synced']);before=list(self.gizmo.writes)
  self.cloud.offline=False;RegistrationApproval(self.cloud,self.gizmo,self.store,lambda:None).flush()
  self.assertEqual(self.gizmo.writes,before);self.assertTrue(self.store.get('registration:'+self.id)['synced'])
 def test_uncertain_password_write_no_replay(self):
  self.gizmo.fail_password=True;result=self.api.approve(self.id,True);self.assertEqual(result['status'],'attention');self.assertEqual(result['gizmo_user_id'],7)
  before=list(self.gizmo.writes);self.api.approve(self.id,True);self.assertEqual(self.gizmo.writes,before)
 def test_russian_phone_alias_duplicate(self):
  self.gizmo.users=[{'mobilePhone':'8 (999) 123-45-67'}];self.assertEqual(self.api.approve(self.id,True)['status'],'rejected');self.assertEqual(self.gizmo.writes,[])
 def test_nickname_case_duplicate(self):
  self.gizmo.users=[{'username':'NEW_GUEST'}];self.assertEqual(self.api.approve(self.id,True)['status'],'rejected');self.assertEqual(self.gizmo.writes,[])
 def test_invalid_created_id_not_saved(self):
  self.gizmo.created_id=True;self.assertEqual(self.api.approve(self.id,True)['status'],'attention');self.assertIsNone(self.store.get('registration:'+self.id).get('gizmo_user_id'));self.assertEqual(len(self.gizmo.writes),1)
 def test_expired_no_creation(self):
  self.row['expires_at']=(datetime.now(timezone.utc)-timedelta(seconds=1)).isoformat();self.assertEqual(self.api.approve(self.id,True)['status'],'attention');self.assertEqual(self.gizmo.writes,[])
 def test_wrong_cipher_no_creation(self):
  self.row['cipher']=self.row['cipher'][:-4]+'AAAA';self.assertEqual(self.api.approve(self.id,True)['status'],'attention');self.assertEqual(self.gizmo.writes,[])
 def test_crash_intent_refuses_repeat(self):
  self.store.set('registration:'+self.id,{'phase':'intent','status':'attention'});self.api.approve(self.id,True);self.assertEqual(self.cloud.claimed,0);self.assertEqual(self.gizmo.writes,[])
 def test_owner_conflict_stops_automatic_reporting(self):
  from desktop.services import ApiError
  self.store.set('registration:'+self.id,{'phase':'outcome','status':'done','gizmo_user_id':7,'synced':False})
  attempts=[]
  def desk(*args,**kwargs):attempts.append(1);raise ApiError('owner conflict',status=409)
  self.cloud.desk=desk;self.api.flush();self.api.flush()
  self.assertEqual(len(attempts),1);self.assertTrue(self.store.get('registration:'+self.id)['conflict']);self.assertEqual(self.gizmo.writes,[])
 def test_guest_group_is_resolved_not_assumed(self):
  data=dict(self.payload,birth_date='2010-01-01');self.assertEqual(registration_params(data,self.gizmo,date(2026,10,8))['UserGroupId'],15)
 def test_profile_mismatch_never_sets_password_or_links(self):
  self.gizmo.user=lambda uid:dict(self.gizmo.member,userGroupId=999)
  result=self.api.approve(self.id,True);self.assertEqual(result['status'],'attention');self.assertEqual(result['gizmo_user_id'],7)
  self.assertEqual(self.gizmo.writes,[('PUT','users')])
 def test_failed_password_verification_not_done(self):
  original=self.gizmo.request
  def request(method,path,**kwargs):
   if path.endswith('/valid'):return {'result':1}
   return original(method,path,**kwargs)
  self.gizmo.request=request;self.assertEqual(self.api.approve(self.id,True)['status'],'attention')
 def test_whitespace_password_refused(self):
  with self.assertRaises(Exception):registration_params(dict(self.payload,password=' '),self.gizmo)
 def test_lease_loss_before_write(self):
  self.api.guard=lambda:(_ for _ in ()).throw(RuntimeError('expired'))
  with self.assertRaises(RuntimeError):self.api.approve(self.id,True)
  self.assertEqual(self.cloud.claimed,0);self.assertEqual(self.gizmo.writes,[])
class ReconciliationTests(unittest.TestCase):
 tearDown=ApprovalTests.tearDown
 def setUp(self):
  ApprovalTests.setUp(self);self.proof=str(uuid.uuid4())
  self.row.update(status='attention',public_data={k:v for k,v in self.payload.items() if k not in ('action','password')})
  self.gizmo.member={k[0].lower()+k[1:]:v for k,v in registration_params(self.payload,self.gizmo).items()}
  original=self.cloud.desk
  def desk(action,**data):
   if action=='registration_review':return {'request':self.row,'proof':{'id':self.proof,'gizmo_user_id':7}}
   if action=='registration_reconcile':self.cloud.finished.append(data);return {'ok':True}
   return original(action,**data)
  self.cloud.desk=desk
 def test_reconcile_never_creates_or_changes_password(self):
  checked=self.api.review(self.id);self.assertEqual(checked['gizmo_user_id'],7)
  self.assertTrue(self.api.reconcile(self.id,self.proof,7,True)['ok'])
  self.api.reconcile(self.id,self.proof,7,True);self.assertEqual(len(self.cloud.finished),1);self.assertEqual(self.gizmo.writes,[])
 def test_known_uid_mismatch_blocks(self):
  self.store.set('registration:'+self.id,{'phase':'created','gizmo_user_id':8})
  with self.assertRaises(ValueError):self.api.review(self.id)
  self.assertEqual(self.gizmo.writes,[])
 def test_requires_separate_confirmation(self):
  self.assertIn('error',self.api.reconcile(self.id,self.proof,7));self.assertEqual(self.cloud.finished,[])
 def test_changed_proof_requires_new_review(self):
  self.assertIn('error',self.api.reconcile(self.id,str(uuid.uuid4()),7,True));self.assertEqual(self.cloud.finished,[])
 def test_mismatched_profile_blocks_reconciliation(self):
  self.gizmo.member['userGroupId']=99
  with self.assertRaises(ValueError):self.api.reconcile(self.id,self.proof,7,True)
  self.assertEqual(self.cloud.finished,[])
if __name__=='__main__':unittest.main()
