import os
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
from urllib.parse import unquote
from desktop.engine import Store
from desktop.registration_approval import RegistrationApproval
from desktop.services import ApiError

class Gizmo:
 def __init__(self):self.writes=[];self.member=None;self.users=[]
 def request(self,method,path,**kwargs):
  if method in ('PUT','POST'):self.writes.append((method,path,kwargs.get('params')))
  if path=='usergroups':return [{'id':8,'name':'18+'},{'id':15,'name':'Клиенты'}]
  if path.endswith('/exist'):return False
  if path=='users' and method=='GET':return self.users
  if path=='users' and method=='PUT':self.member={k[0].lower()+k[1:]:v for k,v in kwargs['params'].items()};return 7
  if path.endswith('/valid'):return {'result':0,'identity':{'userId':7}}
  if path.startswith('v2.0/products/'):return {'id':41,'productTaxes':getattr(self,'taxes_linked',[{'taxId':3,'isEnabled':True}])}
  if path=='v2.0/taxes':return {'data':[{'id':1,'name':'НДС','value':23},{'id':2,'name':'16%','value':16},{'id':3,'name':'None','value':0}]}
  if path.startswith('v2.0/invoices/'):return getattr(self,'invoice_v2',{'id':900,'taxTotal':0,'invoiceLines':[{'productName':'standart 1 h','taxRate':0,'taxTotal':0}]})
  if path=='products/time':return [{'id':41,'name':'standart 1 h','price':0,'minutes':60}]
  if '/order/' in path:return {'id':900,'total':0,'subTotal':0,'outstanding':0}
  if path.endswith('/producttime'):return [{'invoiceId':900,'totalSeconds':3600}]
 def user(self,uid):return self.member
 def creates(self):return [w for w in self.writes if w[1]=='users']
 def orders(self):return [w for w in self.writes if '/order/' in w[1]]
 def notes(self):return [unquote(w[1]) for w in self.writes if '/note/' in w[1]]
class Cloud:
 def __init__(self):self.calls=[];self.redeem=lambda **d:{'ok':True}
 def desk(self,action,**data):
  self.calls.append((action,data))
  if action=='promo_desk_redemption':return self.redeem(**data)
  if action=='promo_codes':return {'codes':[{'code':'HEADSHOT','channel':'ВКонтакте'},{'code':'bad code'},{'code':'GG','channel':'Сайт без рекламы'}]}
  return {'ok':True}
GUEST={'username':'new_guest','password':'x','first_name':'Иван','last_name':'Петров','mobile_phone':'8 (999) 123-45-67','birth_date':'2000-01-01','sex':1}
class DeskRegistrationTests(unittest.TestCase):
 def setUp(self):
  self.env=patch.dict(os.environ,{'PROMO_AUTO_HOUR':'true','PROMO_GIZMO_LOGIN':'promo','PROMO_GIZMO_PASSWORD':'pw'});self.env.start();self.addCleanup(self.env.stop)
  seller=patch('desktop.promo.Gizmo',lambda login,password:self.gizmo);seller.start();self.addCleanup(seller.stop)
  self.temp=tempfile.TemporaryDirectory();self.store=Store(Path(self.temp.name)/'desk.sqlite3');self.gizmo=Gizmo();self.cloud=Cloud()
  self.api=RegistrationApproval(self.cloud,self.gizmo,self.store,lambda:None);self.id=str(uuid.uuid4())
 def tearDown(self):self.temp.cleanup()
 def test_identity_confirmation_required(self):
  for value in (False,'true',1):self.assertIn('error',self.api.register_at_desk(self.id,GUEST,'HEADSHOT',value))
  self.assertEqual(self.gizmo.writes,[])
 def test_creates_once_with_free_hour_and_note(self):
  r=self.api.register_at_desk(self.id,GUEST,'HEADSHOT',True)
  self.assertTrue(r['ok']);self.assertEqual(r['gizmo_user_id'],7);self.assertEqual(r['promo']['result'],'granted')
  self.assertEqual(self.gizmo.creates()[0][2]['MobilePhone'],'+79991234567');self.assertEqual(self.gizmo.creates()[0][2]['UserGroupId'],8)
  names=[c[0] for c in self.cloud.calls];self.assertLess(names.index('promo_desk_redemption'),names.index('promo_reward'))
  self.assertIn('выдан 1 час STANDART за промокод HEADSHOT',self.gizmo.notes()[0])
  again=self.api.register_at_desk(self.id,GUEST,'HEADSHOT',True)
  self.assertTrue(again['ok']);self.assertEqual(len(self.gizmo.creates()),1);self.assertEqual(len(self.gizmo.orders()),1)
  self.assertNotIn('password',str(self.store.get('desk-registration:'+self.id)))
 def test_without_promo_no_hour(self):
  r=self.api.register_at_desk(self.id,GUEST,None,True)
  self.assertTrue(r['ok']);self.assertNotIn('promo',r);self.assertEqual(self.gizmo.orders(),[]);self.assertNotIn('promo_desk_redemption',[c[0] for c in self.cloud.calls])
 def test_duplicate_phone_is_rejected(self):
  self.gizmo.users=[{'username':'old','mobilePhone':'+7 999 123-45-67'}]
  r=self.api.register_at_desk(self.id,GUEST,'HEADSHOT',True)
  self.assertEqual(r['status'],'rejected');self.assertEqual(self.gizmo.creates(),[]);self.assertEqual(self.gizmo.orders(),[])
 def test_server_refuses_second_free_hour(self):
  def refuse(**d):raise ApiError('Supabase club-desk: HTTP 409: Этот гость уже получал час по промокоду',409)
  self.cloud.redeem=refuse
  r=self.api.register_at_desk(self.id,GUEST,'HEADSHOT',True)
  self.assertTrue(r['ok']);self.assertEqual(r['promo']['result'],'failed');self.assertIn('уже получал',r['promo']['error']);self.assertEqual(self.gizmo.orders(),[])
 def test_offline_redemption_retries_without_new_account(self):
  self.cloud.redeem=lambda **d:(_ for _ in ()).throw(RuntimeError('offline'))
  first=self.api.register_at_desk(self.id,GUEST,'HEADSHOT',True)
  self.assertEqual(first['promo']['result'],'pending');self.assertEqual(self.gizmo.orders(),[])
  self.cloud.redeem=lambda **d:{'ok':True}
  second=self.api.register_at_desk(self.id,{},'HEADSHOT',True)
  self.assertEqual(second['promo']['result'],'granted');self.assertEqual(len(self.gizmo.creates()),1);self.assertEqual(len(self.gizmo.orders()),1)
 def test_bad_fields_and_codes(self):
  self.assertIn('error',self.api.register_at_desk(self.id,dict(GUEST,mobile_phone='12'),None,True))
  self.assertIn('error',self.api.register_at_desk(self.id,GUEST,'vk; drop',True))
  self.assertEqual(self.gizmo.writes,[])
 def test_promo_codes_for_buttons(self):
  self.assertEqual([c['code'] for c in self.api.promo_codes()],['HEADSHOT','GG'])
if __name__=='__main__':unittest.main()
