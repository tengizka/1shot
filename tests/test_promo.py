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
  if path.startswith('v2.0/products/'):return {'id':41,'productTaxes':getattr(self,'taxes_linked',[{'taxId':3,'isEnabled':True}])}
  if path=='v2.0/taxes':return {'data':getattr(self,'tax_table',[{'id':1,'name':'НДС','value':23},{'id':2,'name':'16%','value':16},{'id':3,'name':'None','value':0}])}
  if path.startswith('v2.0/invoices/'):return getattr(self,'invoice_v2',{'id':900,'taxTotal':0,'invoiceLines':[{'productName':'standart 1 h','taxRate':0,'taxTotal':0}]})
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
  self.env=patch.dict(os.environ,{'AGENT_SECRET':self.secret,'PROMO_AUTO_HOUR':'true','GIZMO_LOGIN':'desk','PROMO_GIZMO_LOGIN':'promo','PROMO_GIZMO_PASSWORD':'pw'});self.env.start()
  # The hour is sold by its own operator login; the fake records both clients in one place.
  self.made=[];self.seller=patch('desktop.promo.Gizmo',lambda login,password:(self.made.append(login),self.gizmo)[1]);self.seller.start()
 def tearDown(self):self.seller.stop();self.env.stop();self.temp.cleanup()
 def test_hour_is_sold_by_its_own_login(self):
  self.build();self.assertEqual(self.api.approve(self.id,True)['promo']['result'],'granted');self.assertEqual(self.made,['promo'])
 def test_without_separate_login_desk_login_sells(self):
  with patch.dict(os.environ,{'PROMO_GIZMO_LOGIN':''}):
   self.made.clear();self.build();r=self.api.approve(self.id,True)
   self.assertEqual(r['promo']['result'],'granted');self.assertEqual(self.made,[]);self.assertEqual(len(self.gizmo.orders()),1)
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
 def test_tax_line_allowed_by_default_but_never_money(self):
  self.gizmo.taxes_linked=[{'taxId':1,'isEnabled':True}];self.build();r=self.api.approve(self.id,True)
  self.assertEqual(r['promo']['result'],'granted','the club accepts the 23% line on the free hour')
 def test_any_tax_on_the_product_stops_the_hour(self):
  os.environ['PROMO_REQUIRE_ZERO_TAX']='true'  # strict mode, off by default since the club accepts the tax line
  for linked,ok in (([{'taxId':3,'isEnabled':True}],True),([],False),([{'taxId':1,'isEnabled':False}],False),([{'taxId':3},{'taxId':1,'isEnabled':False}],True),([{'taxId':1,'isEnabled':True}],False),([{'taxId':9}],False)):
   self.gizmo=Gizmo();self.gizmo.taxes_linked=linked;self.build();r=self.api.approve(self.id,True)
   self.assertEqual(r['promo']['result'],'granted' if ok else 'failed',linked)
   if not ok:self.assertEqual(self.gizmo.orders(),[]);self.assertIn('налог',r['promo']['error'])
 def test_no_product_tax_ok_only_when_every_gizmo_tax_is_zero(self):
  os.environ['PROMO_REQUIRE_ZERO_TAX']='true'  # strict mode, off by default since the club accepts the tax line
  for taxes,ok in (([{'id':1,'value':23},{'id':3,'value':0}],False),([{'id':1,'value':0},{'id':2,'value':0},{'id':3,'value':0}],True),([{'id':1,'value':0}],True)):
   self.gizmo=Gizmo();self.gizmo.taxes_linked=[];self.gizmo.tax_table=taxes;self.build();r=self.api.approve(self.id,True)
   self.assertEqual(r['promo']['result'],'granted' if ok else 'failed',taxes)
   if not ok:self.assertIn('23%',r['promo']['error']);self.assertEqual(self.gizmo.orders(),[])
 def test_tax_in_the_invoice_needs_a_check(self):
  os.environ['PROMO_REQUIRE_ZERO_TAX']='true'  # strict mode, off by default since the club accepts the tax line
  self.gizmo.invoice=dict(self.gizmo.invoice,taxTotal=0.5);self.build()
  self.assertEqual(self.api.approve(self.id,True)['promo']['result'],'attention')
 def test_23_percent_line_in_the_invoice_needs_a_check(self):
  os.environ['PROMO_REQUIRE_ZERO_TAX']='true'  # strict mode, off by default since the club accepts the tax line
  for v2 in ({'id':900,'taxTotal':0,'invoiceLines':[{'productName':'standart 1 h','taxRate':23,'taxTotal':0}]},{'id':900},None):
   self.gizmo=Gizmo();self.gizmo.invoice_v2=v2;self.build()
   r=self.api.approve(self.id,True);self.assertEqual(r['promo']['result'],'attention',v2);self.assertIn('проверьте вручную',unquote(self.gizmo.notes()[0][1]))
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
