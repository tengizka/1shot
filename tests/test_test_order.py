import os
import unittest
from unittest.mock import patch
from desktop.test_order import place

class Gizmo:
 def __init__(self):self.posts=[]
 def request(self,method,path,**kw):
  if path=='users':return [{'id':5,'username':'blackwolf1'},{'id':6,'username':'other'}]
  if path=='v2.0/paymentmethods':return {'data':[{'id':-1,'name':'Наличные'},{'id':-3,'name':'Депозит'}]}
  if method=='POST':self.posts.append(path);return {'id':1}
MENU=[{'id':10,'group':'Сладости','name':'Choco Pie','price':49},{'id':11,'group':'Энергетики','name':'Burn','price':199},{'id':12,'group':'Аренда','name':'Коврик','price':10}]

class TestOrder(unittest.TestCase):
 def test_cheapest_food_from_owner_paid_by_deposit(self):
  desk,owner=Gizmo(),Gizmo()
  with patch.dict(os.environ,{'PAYMENT_DEPOSIT_METHOD_ID':''}):r=place(desk,owner,MENU,'BlackWolf1')
  self.assertEqual(owner.posts,['users/5/order/10/1/invoice/payment/-3']);self.assertEqual(desk.posts,[])
  self.assertTrue(r['owner_account']);self.assertEqual(r['item'],'Choco Pie')
 def test_unknown_user_orders_nothing(self):
  desk=Gizmo()
  with self.assertRaises(ValueError):place(desk,desk,MENU,'nobody')
  self.assertEqual(desk.posts,[])
