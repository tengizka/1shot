import base64
import io
import tempfile
import unittest
from datetime import datetime,timezone,timedelta
from pathlib import Path
from desktop.engine import Store
from desktop.food import Food,note,tag
from desktop.services import ApiError

def png():
    from PIL import Image
    out=io.BytesIO();Image.new('RGB',(800,600),(163,255,16)).save(out,'PNG');return base64.b64encode(out.getvalue()).decode()

class Gizmo:
    def __init__(self):
        self.calls=[];self.writes=[];self.status=0;self.post_error=None;self.post_result='model';self.notes=[]
        self.types=[{'id':4,'title':'Где мой заказ?','isDeleted':False},{'id':6,'title':'Сделать заказ','isDeleted':False}]
        self.products=[
            {'id':10,'productType':0,'productGroupId':1,'name':'Red Bull','price':189,'displayOrder':1},
            {'id':11,'productType':0,'productGroupId':2,'name':'Lays','price':120},
            {'id':12,'productType':1,'productGroupId':1,'name':'standart 1 h','price':0,'timeProduct':{'minutes':60}},
            {'id':17,'productType':1,'productGroupId':1,'name':'VIP 3 h','price':599,'timeProduct':{'minutes':180}},
            {'id':18,'productType':2,'productGroupId':2,'name':'Комбо','price':250},
            {'id':13,'productType':0,'productGroupId':1,'name':'Секрет','price':50,'disallowClientOrder':True},
            {'id':14,'productType':0,'productGroupId':1,'name':'Кончился','price':90,'enableStock':True,'disallowSaleIfOutOfStock':True},
            {'id':15,'productType':0,'productGroupId':3,'name':'Мышь','price':900},
            {'id':16,'productType':0,'productGroupId':1,'name':'Подогрев','price':30,'isService':True}]
    def request(self,method,path,**kw):
        self.calls.append((method,path,kw))
        if method!='GET':self.writes.append((method,path,kw.get('json')))
        if path=='v2.0/assistancerequesttype':return {'data':self.types,'nextCursor':None}
        if path=='v2.0/productgroups':return {'data':[{'id':1,'name':'Напитки','displayOrder':0},{'id':2,'name':'Снеки','displayOrder':1},{'id':3,'name':'Аксессуары','displayOrder':2}],'nextCursor':None}
        if path=='v2.0/productsstock':return {'data':[{'id':14,'onHand':0}],'nextCursor':None}
        if path=='v2.0/products':
            if kw['params'].get('Pagination.Cursor'):return {'data':self.products[3:],'nextCursor':None}
            return {'data':self.products[:3],'nextCursor':'next'}
        if path=='v2.0/products/10/images':return [{'id':1,'productId':10,'image':png()}]
        if path.startswith('v2.0/products/'):return []
        if path=='v2.0/assistancerequest' and method=='POST':
            if self.post_error:raise self.post_error
            self.notes.append(kw['json']['note'])
            return {'id':500,**kw['json']} if self.post_result=='model' else None
        if path=='v2.0/assistancerequest':return {'data':[{'id':501,'note':n} for n in self.notes],'nextCursor':None}
        if path.startswith('v2.0/assistancerequest/'):return {'id':500,'status':self.status}
        raise AssertionError(path)
    def posts(self):return [w for w in self.writes if w[1]=='v2.0/assistancerequest']

class Cloud:
    def __init__(self):self.calls=[];self.orders=[];self.statuses={}
    def desk(self,action,**data):
        assert action=='food_sync'
        self.calls.append(data)
        for u in data['updates']:self.statuses[u['id']]=u
        return {'orders':[dict(o,status=self.statuses.get(o['id'],{}).get('status',o['status']),assistance_id=self.statuses.get(o['id'],{}).get('assistance_id',o.get('assistance_id'))) for o in self.orders if self.statuses.get(o['id'],{}).get('status')!='closed']}

def order(status='new',minutes=1,**kw):
    return {'id':'abcdef12-0000-4000-8000-000000000001','gizmo_user_id':77,'host_id':'13','status':status,'payment':'card','total':498,
            'items':[{'id':10,'name':'Red Bull','price':189,'qty':2},{'id':11,'name':'Lays','price':120,'qty':1}],
            'created_at':(datetime.now(timezone.utc)-timedelta(minutes=minutes)).isoformat(),**kw}
SEATED=[{'userId':77,'hostNumber':13}]

class FoodTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(Path(self.temp.name)/'desk.sqlite3')
        self.gizmo=Gizmo();self.cloud=Cloud();self.food=Food(self.cloud,self.gizmo,self.store,lambda:{'13':'113'})
    def tearDown(self):self.temp.cleanup()
    def last(self,oid=order()['id']):return self.store.get('food.updates',{}).get(oid) or self.cloud.statuses.get(oid,{})

    def test_menu_reads_only_and_keeps_goods_for_guests(self):
        import os
        os.environ['FOOD_HIDE_GROUPS']='Аксессуары'
        try:food=Food(self.cloud,self.gizmo,self.store)
        finally:del os.environ['FOOD_HIDE_GROUPS']
        food.tick([])
        menu=self.cloud.calls[0]['menu']
        self.assertEqual([m['name'] for m in menu],['Red Bull','Lays','Комбо'],'time packages out, bundles in')
        self.assertEqual(menu[0]['group'],'Напитки');self.assertTrue(menu[0]['image'].startswith('data:image/webp;base64,'));self.assertLess(len(menu[0]['image']),55000)
        self.assertIsNone(menu[1]['image']);self.assertEqual(self.gizmo.writes,[],'menu sync never writes to Gizmo')
        food.menu_at=0;food.tick([]);self.assertNotIn('menu',self.cloud.calls[1],'unchanged menu is not sent again')
        self.assertEqual(sum(1 for c in self.gizmo.calls if c[1]=='v2.0/products/10/images'),1,'pictures are cached')

    def test_order_becomes_one_order_call_with_the_details(self):
        self.cloud.orders=[order()]
        self.food.tick(SEATED);self.food.tick(SEATED);self.food.tick(SEATED)
        posts=self.gizmo.posts();self.assertEqual(len(posts),1,'one call per order, never twice')
        body=posts[0][2];self.assertEqual((body['assistanceRequestTypeId'],body['userId'],body['hostId']),(6,77,113))
        self.assertEqual(body['note'],'Заказ из Telegram #ABCDEF · ПК 13 · Red Bull ×2, Lays ×1 · 498 ₽ · оплата: картой при получении')
        self.assertEqual(self.last()['status'],'sent');self.assertEqual(self.last()['assistance_id'],500)
        self.assertEqual([w for w in self.gizmo.writes if w[1]!='v2.0/assistancerequest'],[],'nothing else is written to Gizmo')

    def test_statuses_never_show_cancelled(self):
        self.cloud.orders=[order()];self.food.tick(SEATED)
        self.gizmo.status=1;self.food.tick(SEATED);self.assertEqual(self.last()['status'],'accepted')
        self.food.tick([]);self.assertEqual(self.last()['status'],'closed','guest left: accepted order is closed')
        self.setUp();self.cloud.orders=[order()];self.food.tick(SEATED)
        self.gizmo.status=2;self.food.tick(SEATED);self.assertEqual(self.last(),{'id':order()['id'],'status':'closed','message':''},'rejected is shown as closed, without a reason')

    def test_not_seated_or_stale_is_closed_without_a_call(self):
        self.cloud.orders=[order()];self.food.tick([])
        self.assertEqual(self.gizmo.posts(),[]);self.assertEqual(self.last()['status'],'closed')
        self.setUp();self.cloud.orders=[order(minutes=20)];self.food.tick(SEATED)
        self.assertEqual(self.gizmo.posts(),[]);self.assertEqual(self.last()['status'],'closed')

    def test_gizmo_refusal_closes_with_a_hint(self):
        self.gizmo.post_error=ApiError('Gizmo: HTTP 400');self.cloud.orders=[order()]
        self.food.tick(SEATED);self.assertIn('Вызов администратора',self.last()['message'])
        self.gizmo.post_error=None;self.food.tick(SEATED);self.assertEqual(self.gizmo.notes,[],'refused order is not retried')

    def test_lost_answer_is_found_by_tag_not_posted_again(self):
        self.gizmo.post_error=ApiError('Gizmo: превышено время ожидания ответа');self.cloud.orders=[order()]
        self.food.tick(SEATED);self.assertEqual(self.last(),{})
        self.gizmo.notes=['Заказ из Telegram #ABCDEF · ПК 13 · …'];self.gizmo.post_error=None
        self.food.tick(SEATED);self.assertEqual(self.last()['assistance_id'],501);self.assertEqual(len(self.gizmo.notes),1)

    def test_report_lost_on_the_way_does_not_repost(self):
        self.cloud.orders=[order()];self.food.tick(SEATED)
        self.cloud.statuses={};self.store.set('food.updates',{})
        self.food.tick(SEATED);self.assertEqual(len(self.gizmo.posts()),1)

    def test_no_order_type_no_call(self):
        self.gizmo.types=[t for t in self.gizmo.types if t['id']!=6];self.cloud.orders=[order()]
        self.food.tick(SEATED);self.assertEqual(self.gizmo.notes,[]);self.assertIn('Сделать заказ',self.food.error)

    def test_note_fits_gizmo_limit(self):
        long=order(items=[{'name':'Очень длинное название напитка '+str(i),'qty':5} for i in range(10)])
        text=note(long,'204');self.assertLessEqual(len(text),255);self.assertTrue(text.endswith('оплата: картой при получении'));self.assertIn(tag(long['id']),text)

    def test_gizmo_500_on_paging_falls_back_and_names_the_call(self):
        real=self.gizmo.request
        def picky(method,path,**kw):
            if (kw.get('params') or {}).get('Pagination.Limit') and path!='v2.0/products':raise ApiError('Gizmo: HTTP 500')
            return real(method,path,**kw)
        self.gizmo.request=picky;self.food.tick(SEATED)
        self.assertEqual([m['name'] for m in self.cloud.calls[0]['menu']],['Red Bull','Lays','Комбо','Мышь']);self.assertEqual(self.food.error,'')
        def broken(method,path,**kw):
            if path=='v2.0/products':raise ApiError('Gizmo: HTTP 500')
            return real(method,path,**kw)
        self.setUp();self.gizmo.request=broken;self.food.tick(SEATED)
        self.assertIn('(v2.0/products)',self.food.error);self.assertEqual(self.cloud.calls[0]['seats'],[{'uid':77,'host':'13'}],'seats still reported');self.assertNotIn('menu',self.cloud.calls[0])

    def test_gizmo_fails_on_the_page_after_the_last(self):
        real=self.gizmo.request
        def cursor(method,path,**kw):
            if (kw.get('params') or {}).get('Pagination.Cursor'):raise ApiError('Gizmo: HTTP 500')
            return real(method,path,**kw)
        self.gizmo.request=cursor;self.food.tick(SEATED)
        self.assertEqual([m['name'] for m in self.cloud.calls[0]['menu']],['Red Bull','Lays'],'first page kept');self.assertEqual(self.food.error,'')

    def test_time_and_rental_groups_hidden_by_default(self):
        self.assertTrue({'standart','vip','tv','аренда'}<=self.food.hidden)

if __name__=='__main__':unittest.main()
