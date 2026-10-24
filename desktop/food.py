"""Food orders from the mini-app, delivered as the club's existing «Сделать заказ» call.

Nothing is created or changed in Gizmo except that call itself: the menu and pictures are only read,
the admin accepts the call and rings the order up in Gizmo as usual. The guest sees sent → accepted → closed;
a rejected call is shown as closed too, never as cancelled."""
import base64
import hashlib
import io
import json
import os
import time
from datetime import datetime,timezone
from .services import ApiError

ORDER_TYPE='сделать заказ'
PAYMENT={'deposit':'спишите с депозита','card':'картой при получении','cash':'наличными при получении'}
# Gizmo AssistanceRequestStatus: 0 pending, 1 accepted, 2 rejected, 3 cancelled.
PENDING,ACCEPTED=0,1
TIME_PRODUCT=1  # Gizmo ProductType: 0 product, 1 time, 2 bundle

def tag(order_id):return '#'+str(order_id).replace('-','')[:6].upper()

def note(order,host):
    """The text the admin sees on the call; Gizmo keeps at most 255 characters."""
    head=f"Заказ из Telegram {tag(order['id'])} · ПК {host} · "
    tail=f" · {float(order['total']):g} ₽ · оплата: {PAYMENT.get(order['payment'],'уточнить')}"
    items=', '.join(f"{i['name']} ×{i['qty']}" for i in order['items'])
    room=255-len(head)-len(tail)
    if len(items)>room:items=items[:max(0,room-1)]+'…'
    return head+items+tail

def thumbnail(raw):
    """Small WebP for the mini-app; None when the picture cannot be read."""
    try:
        from PIL import Image
        image=Image.open(io.BytesIO(base64.b64decode(raw))).convert('RGB')
        image.thumbnail((240,240))
        for quality in (72,55,40):
            out=io.BytesIO();image.save(out,'WEBP',quality=quality)
            uri='data:image/webp;base64,'+base64.b64encode(out.getvalue()).decode()
            if len(uri)<=55000:return uri
    except Exception:pass
    return None

class Food:
    def __init__(self,cloud,gizmo,store,host_ids=lambda:{}):
        self.cloud,self.gizmo,self.store,self.host_ids=cloud,gizmo,store,host_ids
        self.type_id=None;self.menu_at=0;self.report_at=0;self.error='';self.status={'menu':0,'open':0}
        # Time packages and rentals are not food; FOOD_HIDE_GROUPS in .env replaces this list.
        self.hidden={g.strip().casefold() for g in os.getenv('FOOD_HIDE_GROUPS','Standart,VIP,TV,Аренда').split(',') if g.strip()}

    def get(self,path,params=None):
        # Errors name the endpoint, so "HTTP 500" on the Desk screen says which Gizmo call failed.
        try:return self.gizmo.request('GET',path,params=params)
        except ApiError as error:raise ApiError(f'{error} ({path.split("?")[0]})') from error

    def paged(self,path,params=None):
        rows,cursor=[],None
        for _ in range(30):
            query=dict(params or {},**{'Pagination.Limit':100})
            if cursor:query['Pagination.Cursor']=cursor
            try:page=self.get(path,query)
            except ApiError as error:
                # Some Gizmo builds fail on paging parameters: ask once for the plain list.
                # Gizmo keeps a nextCursor even after the last page and may fail on it: keep what we have.
                if rows and 'HTTP 5' in str(error):return rows
                if rows or 'HTTP 5' not in str(error):raise
                page=self.get(path,params or None)
                if isinstance(page,dict) and isinstance(page.get('data'),list):return page['data']
            if isinstance(page,list):return rows+page
            if not isinstance(page,dict) or not isinstance(page.get('data'),list):raise ApiError('Gizmo: неверный ответ '+path)
            rows+=page['data'];cursor=page.get('nextCursor')
            if not cursor or not page['data']:return rows
        return rows

    def order_type(self):
        if self.type_id is None:
            types=[t for t in self.paged('v2.0/assistancerequesttype') if not t.get('isDeleted') and str(t.get('title','')).strip().casefold()==ORDER_TYPE]
            if len(types)!=1 or type(types[0].get('id')) is not int:raise ApiError('В Gizmo нет типа вызова «Сделать заказ»')
            self.type_id=types[0]['id']
        return self.type_id

    def image(self,product_id):
        key=f'food.image:{int(product_id)}';hit=self.store.get(key)
        if hit and time.time()-hit.get('at',0)<86400:return hit.get('uri')
        uri=None
        try:
            images=self.get(f'v2.0/products/{int(product_id)}/images')
            images=images.get('data') if isinstance(images,dict) else images
            first=next((i for i in images or [] if isinstance(i,dict) and i.get('image')),None)
            uri=thumbnail(first['image']) if first else None
        except Exception:
            if hit:return hit.get('uri')
        self.store.set(key,{'uri':uri,'at':time.time()})
        return uri

    def menu(self):
        """What a guest may order: goods only (no time packages), not hidden from client orders, in stock."""
        groups={g['id']:g for g in self.paged('v2.0/productgroups') if type(g.get('id')) is int}
        # The stock list fails on some Gizmo builds; then each tracked product is asked on its own.
        try:stock={s['id']:s.get('onHand') for s in self.paged('v2.0/productsstock') if type(s.get('id')) is int}
        except ApiError:stock=None
        items=[]
        for p in self.paged('v2.0/products',{'IsDeleted':'false'}):
            group=groups.get(p.get('productGroupId'))
            price=p.get('price')
            if not group or type(p.get('id')) is not int or p.get('isDeleted') or p.get('productType')==TIME_PRODUCT or p.get('timeProduct'):continue
            if p.get('disallowClientOrder') or p.get('restrictSale') or p.get('isService') or not isinstance(price,(int,float)) or isinstance(price,bool) or price<=0:continue
            if str(group.get('name','')).strip().casefold() in self.hidden or not str(p.get('name') or '').strip():continue
            if p.get('enableStock') and not self.in_stock(p['id'],stock):continue
            items.append({'id':p['id'],'group':str(group.get('name') or 'Меню').strip()[:45],'group_order':int(group.get('displayOrder') or 0),'name':str(p['name']).strip()[:60],'price':round(float(price),2),'sort':int(p.get('displayOrder') or 0)})
        for item in items:item['image']=self.image(item['id'])
        return items

    def in_stock(self,product_id,stock):
        """Out-of-stock goods are hidden; an unreadable stock never hides a product."""
        if stock is not None and product_id in stock:on_hand=stock[product_id]
        else:
            try:
                row=self.get(f'v2.0/productsstock/{int(product_id)}')
                on_hand=(row.get('result') if isinstance(row,dict) and isinstance(row.get('result'),dict) else row or {}).get('onHand')
            except Exception:return True
        return not isinstance(on_hand,(int,float)) or on_hand>0

    def tax_report(self):
        """Read-only: Gizmo's tax table and every product that carries a tax, for staff to review remotely."""
        taxes=self.get('v2.0/taxes');taxes=taxes.get('data') if isinstance(taxes,dict) else taxes
        products=self.paged('v2.0/products',{'Expand':'ProductTaxes'})
        taxed=[{'id':p.get('id'),'name':p.get('name'),'type':p.get('productType'),'price':p.get('price'),'deleted':p.get('isDeleted'),'taxes':p.get('productTaxes')} for p in products if p.get('productTaxes')]
        free=[{'id':p.get('id'),'name':p.get('name'),'taxes':p.get('productTaxes')} for p in products if str(p.get('name','')).strip().casefold()=='standart 1 h']
        return {'taxes':taxes,'products_total':len(products),'products_with_taxes':taxed[:300],'standart_1h':free}

    def queue(self,order_id,status,**extra):
        updates=self.store.get('food.updates',{})
        updates[order_id]={'id':order_id,'status':status,**extra};self.store.set('food.updates',updates)

    def tick(self,sessions):
        """One round: seats and (every 10 minutes) the menu up, open orders down, then each order moves on."""
        self.error=''
        seats=[{'uid':int(s['userId']),'host':str(s['hostNumber'])} for s in sessions if s.get('userId') and s.get('hostNumber') is not None]
        body={'seats':seats,'updates':list(self.store.get('food.updates',{}).values())[:50]}
        if time.time()-self.menu_at>600:
            # A broken menu read never stops seats and orders; it is retried in a minute.
            try:
                menu=self.menu();digest=hashlib.sha256(json.dumps(menu,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
                if digest!=self.store.get('food.menu_hash') or self.status['menu']!=len(menu):body['menu']=menu
                self.menu_at=time.time();self.status['menu']=len(menu)
            except Exception as error:self.menu_at=time.time()-540;self.error='меню: '+str(error)[:150]
        if time.time()-self.report_at>600:
            self.report_at=time.time()
            try:self.cloud.desk('report',kind='gizmo_taxes',data=self.tax_report())
            except Exception:pass  # Diagnostics never block seats and orders.
        result=self.cloud.desk('food_sync',**body)
        if 'menu' in body:self.store.set('food.menu_hash',digest)
        sent={u['id']:u for u in body['updates']};pending=self.store.get('food.updates',{})
        self.store.set('food.updates',{k:v for k,v in pending.items() if sent.get(k)!=v})
        orders=result.get('orders') or [];self.status['open']=len(orders)
        where={s['uid']:s['host'] for s in seats}
        for order in orders:
            try:self.advance(order,where)
            except Exception as error:self.error=str(error)[:160]

    def advance(self,order,where):
        oid=order['id'];key='food:'+oid;journal=self.store.get(key,{})
        uid=int(order['gizmo_user_id']);age=time.time()-datetime.fromisoformat(order['created_at'].replace('Z','+00:00')).timestamp()
        if order['status']=='new':
            # Already sent or refused: the report is still on its way to the server, never post twice.
            if journal.get('phase')=='refused':return self.close(oid,'Не получилось отправить. Нажмите «Вызов администратора» на ПК')
            if journal.get('phase') in ('sent','accepted'):return
            if journal.get('phase')=='posting':
                found=self.find(uid,oid)
                if found:return self.sent(oid,found)
                if time.time()-journal.get('at',0)<60:return
            host=where.get(uid)
            if not host:return self.close(oid,'Вы вышли из-за ПК, заказ не отправлен')
            if age>900:return self.close(oid,'Заказ не дошёл до администратора. Попробуйте ещё раз')
            gizmo_host=self.host_ids().get(str(host))
            if not gizmo_host:return
            self.store.set(key,{'phase':'posting','at':time.time()})
            try:created=self.gizmo.request('POST','v2.0/assistancerequest',json={'assistanceRequestTypeId':self.order_type(),'userId':uid,'hostId':int(gizmo_host),'note':note(order,host)})
            except ApiError as error:
                # Gizmo answered with an error: the call was not created, nothing to look for.
                if 'HTTP 4' in str(error):self.error=str(error)[:160];self.store.set(key,{'phase':'refused'});return self.close(oid,'Не получилось отправить. Нажмите «Вызов администратора» на ПК')
                raise
            aid=created.get('id') if isinstance(created,dict) else created if type(created) is int else None
            return self.sent(oid,aid if type(aid) is int else self.find(uid,oid))
        aid=order.get('assistance_id') or journal.get('assistance_id')
        if not aid:return self.close(oid,'')
        call=self.get(f'v2.0/assistancerequest/{int(aid)}')
        status=call.get('status') if isinstance(call,dict) else None
        if status==PENDING:
            if age>2700:self.close(oid,'')
        elif status==ACCEPTED:
            if order['status']!='accepted':
                self.store.set(key,dict(journal,phase='accepted',accepted_at=time.time()));self.queue(oid,'accepted',message='Принят, несём')
            elif time.time()-journal.get('accepted_at',time.time())>1800 or uid not in where:self.close(oid,'')
        elif status is not None:self.close(oid,'')

    def find(self,uid,oid):
        mark=tag(oid)
        for call in self.paged('v2.0/assistancerequest',{'UserId':uid,'Pagination.IsAsc':'false'})[:50]:
            if mark in str(call.get('note') or '') and type(call.get('id')) is int:return call['id']
        return None

    def sent(self,oid,aid):
        if not aid:raise ApiError('Вызов создан, но Gizmo не вернул его номер')
        self.store.set('food:'+oid,{'phase':'sent','assistance_id':aid});self.queue(oid,'sent',assistance_id=aid,message='Отправлен администратору')

    def close(self,oid,message):
        self.queue(oid,'closed',message=message)
