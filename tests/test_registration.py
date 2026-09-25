import unittest
from datetime import date
from desktop.registration import registration_params, adult_group, login_name
from desktop.services import ApiError

class Gizmo:
 def __init__(self):self.groups=[{'id':8,'name':'18+'}];self.users=[]
 def request(self,method,path,**kw):return self.groups if path=='usergroups' else self.users
class RegistrationTests(unittest.TestCase):
 def setUp(self):
  self.gizmo=Gizmo();self.req={'username':'guest_1','password':'secret123','first_name':'Имя','last_name':'Фамилия','mobile_phone':'+7 (999) 123-45-67','sex':1,'birth_date':'2008-09-25'}
 def test_eighteenth_birthday(self):
  self.assertEqual(registration_params(self.req,self.gizmo,date(2026,9,25))['UserGroupId'],8)
  self.assertEqual(registration_params(self.req,self.gizmo,date(2026,9,24))['UserGroupId'],3)
 def test_all_fields_required(self):
  for key in self.req:
   req=dict(self.req);del req[key]
   with self.assertRaises((ApiError,KeyError,TypeError,ValueError)):registration_params(req,self.gizmo,date(2026,9,25))
 def test_bad_dates(self):
  for value in ['2008-02-30','2099-01-01','1800-01-01']:
   with self.assertRaises((ApiError,ValueError)):registration_params(dict(self.req,birth_date=value),self.gizmo,date(2026,9,25))
 def test_group_not_guessed(self):
  self.gizmo.groups=[]
  with self.assertRaises(ApiError):adult_group(self.gizmo)
  self.gizmo.groups=[{'id':8,'name':'18+'},{'id':9,'name':'18+'}]
  with self.assertRaises(ApiError):adult_group(self.gizmo)
 def test_phone_unambiguous(self):
  self.gizmo.users=[{'username':'guest','mobilePhone':'+79991234567'}]
  self.assertEqual(login_name(self.gizmo,'+7 (999) 123-45-67'),'guest')
  self.gizmo.users*=2
  with self.assertRaises(ApiError):login_name(self.gizmo,'+79991234567')
 def test_nickname_not_changed(self):self.assertEqual(login_name(self.gizmo,'nickname'),'nickname')

class AuthQueueTests(unittest.TestCase):
 def test_encrypted_registration_has_no_plaintext_local_journal(self):
  import os,json,base64,hashlib,tempfile
  from datetime import datetime,timezone
  from pathlib import Path
  from types import SimpleNamespace
  from unittest.mock import patch
  from cryptography.hazmat.primitives.ciphers.aead import AESGCM
  from desktop.registration import process_auth
  from desktop.engine import Store
  password='fixture-password-123';secret='test-only-agent-secret';id='e0c653fd-0691-455f-b544-0c00d2eb0857'
  payload={'action':'register','username':'guest_test','password':password,'first_name':'Имя','last_name':'Фамилия','mobile_phone':'+79991234567','sex':1,'birth_date':'2000-01-01'}
  iv=b'012345678901';raw=iv+AESGCM(hashlib.sha256(('1shot-auth-v2:'+secret).encode()).digest()).encrypt(iv,json.dumps(payload).encode(),id.encode())
  class FakeGizmo:
   def __init__(self):self.writes=[];self.member=None
   def request(self,method,path,**kwargs):
    if path=='usergroups':return [{'id':8,'name':'18+'}]
    if path.endswith('/exist'):return False
    if path=='users' and method=='PUT':
     self.writes.append(path);self.member={k[0].lower()+k[1:]:v for k,v in kwargs['params'].items()};return 7
    if path.endswith('/valid'):return {'result':0,'identity':{'userId':7}}
   def user(self,uid):return self.member
  class Cloud:
   worker_id='worker'
   def __init__(self):self.finished=None;self.claimed=False
   def request(self,path,body):
    if path=='upsert-profile':return {'ok':True}
    if body['action']=='claim':
     if self.claimed:return {'requests':[]}
     self.claimed=True;return {'requests':[{'id':id,'telegram_id':123,'created_at':datetime.now(timezone.utc).isoformat(),'cipher':base64.b64encode(raw).decode()}]}
    self.finished=body;return {'ok':True}
  with tempfile.TemporaryDirectory() as folder,patch.dict(os.environ,{'AGENT_SECRET':secret}):
   gizmo=FakeGizmo();cloud=Cloud();store=Store(Path(folder)/'test.sqlite3');bridge=SimpleNamespace(gizmo=gizmo,cloud=cloud,store=store)
   process_auth(bridge);process_auth(bridge)
   self.assertEqual(cloud.finished['status'],'done');self.assertEqual(gizmo.member['userGroupId'],8);self.assertEqual(gizmo.writes,['users'])
   self.assertNotIn(password,json.dumps(store.get('auth-v2:'+id)));self.assertNotIn('cipher',json.dumps(store.get('auth-v2:'+id)))
