import base64
import hashlib
import json
import os
import tempfile
import unittest
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch
from urllib.parse import unquote
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from desktop.engine import Store
from desktop.registration_approval import RegistrationApproval

class Gizmo:
 def __init__(self):self.writes=[];self.member=None;self.price=0;self.minutes=60;self.products=None;self.lines=None;self.order_error=False;self.invoice={'id':900,'total':0,'subTotal':0,'outstanding':0}
 def request(self,method,path,**kwargs):
  if method in ('PUT','POST'):self.writes.append((method,path))
  if path=='usergroups':return [{'id':8,'name':'18+'},{'id':15,'name':'Клиенты'}]
  if path.endswith('/exist'):return False
  if path=='users' and method=='GET':return []
  if path=='users' and method=='PUT':self.member={k[0].lower()+k[1:]:v for k,v in kwargs['params'].items()};return 7
  if path.endswith('/valid'):return {'result':0,'identity':{'userId':7}}
  if path=='products/time':return self.products if self.products is not None else [{'id':41,'name':'standart 1 h','price':self.price,'minutes':self.minutes},{'id':42,'name':'standart 30 min','price':0,'minutes':30}]
  if '/order/' in path:
   if self.order_error:raise RuntimeError('timeout')
   return self.invoice
  if path.endswith('/producttime'):return self.lines if self.lines is not None else [{'invoiceId':900,'totalSeconds':3600,'isVoided':False}]
 def user(self,uid):return self.member
 def orders(self):return [w for w in self.writes if '/order/' in w[1]]
 def notes(self):return [w for w in self.writes if '/note/' in w[1]]
class Cloud:
 def __init__(self,row):self.row=row;self.rewards=[]
 def desk(self,action,**data):
  if action=='registration_claim':return {'request':self.row}
  if action=='promo_reward':self.rewards.append(data['result'])
  return {'ok':True}
class PromoTests(unittest.TestCase):
 def build(self,promo='HEADSHOT'):
  self.id=str(uuid.uuid4());payload={'action':'register_application','username':'new_guest','password':'x','first_name':'Test','last_name':'Guest','mobile_phone':'+79991234567','birth_date':'2000-01-01','sex':1}
  if promo:payload['promo_code']=promo
  iv=b'012345678901';raw=iv+AESGCM(hashlib.sha256(('1shot-auth-v2:'+self.secret).encode()).digest()).encrypt(iv,json.dumps(payload).encode(),self.id.encode())
  self.cloud=Cloud({'id':self.id,'telegram_id':100,'cipher':base64.b64encode(raw).decode(),'expires_at':(datetime.now(timezone.utc)+timedelta(days=1)).isoformat()})
  self.api=RegistrationApproval(self.cloud,self.gizmo,self.store,lambda:None)
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.store=Store(Path(self.temp.name)/'desk.sqlite3');self.secret='fixture-secret';self.gizmo=Gizmo()
  self.env=patch.dict(os.environ,{'AGENT_SECRET':self.secret,'PROMO_AUTO_HOUR':'true'});self.env.start()
 def tearDown(self):self.env.stop();self.temp.cleanup()
 def test_grants_once_with_note(self):
  self.build();result=self.api.approve(self.id,True)
  self.assertEqual(result['promo']['result'],'granted');self.assertEqual(self.gizmo.orders(),[('POST','users/7/order/41/invoice/payment/-1')])
  self.assertEqual(len(self.gizmo.notes()),1);self.assertIn('HEADSHOT',self.gizmo.notes()[0][1]);self.assertEqual(self.cloud.rewards,['granted'])
  self.api.approve(self.id,True);self.assertEqual(len(self.gizmo.orders()),1)
 def test_no_promo_no_order(self):
  self.build(None);result=self.api.approve(self.id,True)
  self.assertTrue(result['ok']);self.assertNotIn('promo',result);self.assertEqual(self.gizmo.orders(),[]);self.assertEqual(self.gizmo.notes(),[])
 def test_paid_product_is_refused(self):
  self.gizmo.price=150;self.build();result=self.api.approve(self.id,True)
  self.assertEqual(result['promo']['result'],'failed');self.assertEqual(self.gizmo.orders(),[]);self.assertEqual(self.cloud.rewards,['failed'])
 def test_wrong_duration_is_refused(self):
  self.gizmo.minutes=30;self.build();self.assertEqual(self.api.approve(self.id,True)['promo']['result'],'failed');self.assertEqual(self.gizmo.orders(),[])
 def test_auto_hour_off_by_default(self):
  os.environ.pop('PROMO_AUTO_HOUR');self.build()
  r=self.api.approve(self.id,True);self.assertEqual(r['promo']['result'],'failed');self.assertIn('вручную',r['promo']['error']);self.assertEqual(self.gizmo.orders(),[])
 def test_minutes_inside_time_product_block(self):
  self.gizmo.products=[{'id':41,'name':'Standart 1 h','price':0,'timeProduct':{'minutes':60}}];self.build()
  r=self.api.approve(self.id,True);self.assertEqual(r['promo']['result'],'granted')
 def test_failure_reason_is_shown(self):
  self.gizmo.products=[{'id':41,'name':'standart 1 h','price':50,'minutes':60}];self.build()
  r=self.api.approve(self.id,True);self.assertEqual(r['promo']['result'],'failed');self.assertIn('0 ₽',r['promo']['error']);self.assertEqual(self.gizmo.orders(),[])
 def test_note_says_automatic(self):
  self.build();self.api.approve(self.id,True);note=unquote(self.gizmo.notes()[0][1])
  self.assertIn('Автоматически (1SHOT Desk): выдан 1 час STANDART за промокод HEADSHOT',note)
 def test_ambiguous_product_is_refused(self):
  self.gizmo.products=[{'id':41,'name':'standart 1 h','price':0,'minutes':60},{'id':43,'name':'Standart 1 H ','price':0,'minutes':60}];self.build()
  self.assertEqual(self.api.approve(self.id,True)['promo']['result'],'failed');self.assertEqual(self.gizmo.orders(),[])
 def test_unverified_order_needs_attention(self):
  self.gizmo.lines=[];self.build();result=self.api.approve(self.id,True)
  self.assertEqual(result['promo']['result'],'attention');self.assertEqual(self.cloud.rewards,[])
 def test_interrupted_order_never_repeats(self):
  self.build();self.store.set('promo:'+self.id,{'phase':'ordering','code':'HEADSHOT','gizmo_user_id':7})
  record=self.api.promo.grant(self.id,7,'HEADSHOT');self.assertEqual(record['result'],'attention');self.assertEqual(self.gizmo.orders(),[])
 def test_order_error_is_attention_not_retry(self):
  self.gizmo.order_error=True;self.build();self.assertEqual(self.api.approve(self.id,True)['promo']['result'],'attention')
  self.gizmo.order_error=False;self.api.promo.grant(self.id,7,'HEADSHOT');self.assertEqual(len(self.gizmo.orders()),1)
 def test_nonzero_invoice_stops(self):
  self.gizmo.invoice={'id':900,'total':150,'subTotal':150,'outstanding':0};self.build();result=self.api.approve(self.id,True)
  self.assertEqual(result['promo']['result'],'attention');self.assertEqual(self.cloud.rewards,[]);self.assertIn('проверьте',unquote(self.gizmo.notes()[0][1]))
 def test_malformed_code_ignored(self):
  self.build('vk; drop');self.assertNotIn('promo',self.api.approve(self.id,True));self.assertEqual(self.gizmo.orders(),[])
if __name__=='__main__':unittest.main()
