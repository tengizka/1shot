"""Food orders from the mini-app, delivered as the club's existing «Сделать заказ» call.

Nothing is created or changed in Gizmo except that call itself: the menu and pictures are only read,
the admin accepts the call and rings the order up in Gizmo as usual. The guest sees sent → accepted → closed;
a rejected call is shown as closed too, never as cancelled."""
import base64
import difflib
import hashlib
import io
import json
import os
import re
import time
from datetime import datetime,timedelta,timezone
from .services import ApiError
from .rentals import item_for

ORDER_TYPE='сделать заказ'
PAYMENT={'deposit':'спишите с депозита','card':'картой при получении','cash':'наличными при получении'}
# Gizmo AssistanceRequestStatus: 0 pending, 1 accepted, 2 rejected, 3 cancelled.
PENDING,ACCEPTED=0,1
TIME_PRODUCT=1  # Gizmo ProductType: 0 product, 1 time, 2 bundle
RENTAL_GROUP='аренда'

def plain(name):
    """Product name without the quotes Gizmo copies sometimes carry: "Red Bull" → Red Bull."""
    return str(name or '').strip().strip('"«»\'').strip()

def norm(name):
    """Same goods under slightly different names: case, quotes, spaces and a trailing dot do not matter."""
    return ' '.join(plain(name).casefold().replace('ё','е').split()).rstrip('.').strip()

def key(name):
    """Name for matching copies: case, quotes, «л», commas vs dots and punctuation do not matter."""
    text=norm(name).replace(',','.')
    text=re.sub(r'(?<=\d)\s*л\b\.?|\bл\b\.?','',text)
    return ' '.join(re.sub(r'[^0-9a-zа-я.]+',' ',text).replace(' .',' ').split()).strip('. ')

def volume(name):
    return set(re.findall(r'\d+\.\d+|\d+',key(name)))

def till_card(p):
    """Cards the till sells carry a barcode or a stock count; the client shop copies have neither."""
    return bool(p.get('enableStock') or str(p.get('barcode') or '').strip())

def pair_cards(cards):
    """Groups of the same goods: exact matches first, then each shop card joins its most similar till card."""
    groups={}
    for c in cards:groups.setdefault((c[1].get('id'),key(c[0].get('name'))),[]).append(c)
    lonely_shop=[g for g in groups.values() if not any(till_card(c[0]) for c in g)]
    lonely_till=[g for g in groups.values() if not any(not till_card(c[0]) for c in g)]
    pairs=[]
    for g in lonely_shop:
        name=key(g[0][0].get('name'));best,score=None,0.0
        for t in lonely_till:
            if t[0][1].get('id')!=g[0][1].get('id'):continue
            other=key(t[0][0].get('name'))
            if volume(name)!=volume(other):continue
            ratio=difflib.SequenceMatcher(None,name,other).ratio()
            if ratio>score:best,score=t,ratio
        if best is not None and score>=0.8:pairs.append((score,g,best))
    taken=set()
    for score,g,t in sorted(pairs,key=lambda x:-x[0]):
        if id(t) in taken or id(g) in taken:continue
        taken.update((id(t),id(g)));g.extend(t);t.clear()
    return [g for g in groups.values() if g]

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
    def __init__(self,cloud,gizmo,store,host_ids=lambda:{},rentals=None):
        self.cloud,self.gizmo,self.store,self.host_ids,self.rentals=cloud,gizmo,store,host_ids,rentals
        self.type_id=None;self.menu_at=0;self.report_at=0;self.error='';self.status={'menu':0,'open':0}
        # Time packages and rentals are not food; FOOD_HIDE_GROUPS in .env replaces this list.
        # Rentals are sold in the market too (their own tab), so the «Аренда» group is never hidden.
        self.hidden={g.strip().casefold() for g in os.getenv('FOOD_HIDE_GROUPS','Standart,VIP,TV').split(',') if g.strip()}-{RENTAL_GROUP}


    def get(self,path,params=None):
        # Errors name the endpoint, so "HTTP 500" on the Desk screen says which Gizmo call failed.
        try:return self.gizmo.request('GET',path,params=params)
        except ApiError as error:raise ApiError(f'{error} ({path.split("?")[0]})') from error

    def paged(self,path,params=None,limit=100,pages=30):
        rows,cursor=[],None
        for _ in range(pages):
            query=dict(params or {},**{'Pagination.Limit':limit})
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
        # Only goods sold in the last FOOD_SOLD_DAYS (default 60): old duplicates with stale stock drop out.
        try:sold_ids,sold_names=self.sold()
        except Exception:sold_ids,sold_names=set(),set()
        # The till sells the old cards (barcode, stock); the client shop shows newer copies of the same goods,
        # often typed a little differently. Each shop card is paired with the most similar till card of its group:
        # the shop card is shown, sales and stock come from the till card.
        cards=[]
        for p in self.paged('v2.0/products',{'IsDeleted':'false'}):
            group=groups.get(p.get('productGroupId'))
            price=p.get('price')
            if not group or type(p.get('id')) is not int or p.get('isDeleted') or p.get('productType')==TIME_PRODUCT or p.get('timeProduct'):continue
            if p.get('disallowClientOrder') or p.get('restrictSale') or p.get('isService') or not isinstance(price,(int,float)) or isinstance(price,bool) or price<=0:continue
            if str(group.get('name','')).strip().casefold() in self.hidden or not plain(p.get('name')):continue
            cards.append((p,group))
        sold_keys={key(n) for n in sold_names}
        items=[]
        for copies in pair_cards(cards):
            shop=[c for c in copies if not till_card(c[0])]
            p,group=max(shop or copies,key=lambda c:c[0]['id'])
            rental=str(group.get('name','')).strip().casefold()==RENTAL_GROUP
            till=[c[0] for c in copies if till_card(c[0])]
            # Sales only decide for goods sold at the till; a shop card on its own is what the club chose to show.
            if not rental and till and (sold_ids or sold_names) and not any(t['id'] in sold_ids or key(t.get('name')) in sold_keys for t in till):continue
            # Rental items come back after use: their stock count says nothing, they are always offered.
            tracked=[] if rental else [c[0] for c in copies if c[0].get('enableStock')]
            if tracked and not any(self.in_stock(t['id'],stock) for t in tracked):continue
            items.append({'id':p['id'],'group':str(group.get('name') or 'Меню').strip()[:45],'group_order':int(group.get('displayOrder') or 0),'name':plain(p['name'])[:60],'price':round(float(p['price']),2),'sort':int(p.get('displayOrder') or 0)})
        items.sort(key=lambda i:(i['group_order'],i['sort'],i['id']))
        for item in items:item['image']=self.image(item['id'])
        return items

    def rent_out(self,order,host,journal):
        """Accepted order: its rental items go to the Desk rentals list on this PC, once."""
        if not self.rentals or journal.get('rented'):return
        for line in order.get('items') or []:
            key=item_for(line.get('name'))
            if key:
                try:self.rentals.add(key,host,'',int(order['gizmo_user_id']))
                except ValueError:pass
        journal['rented']=True

    def sold(self):
        """Products on Gizmo invoices of the last N days, cached for 6 hours: (ids, names). Empty means «do not filter».
        Invoice lines carry the product name; the id is used when Gizmo gives one."""
        try:days=int(os.getenv('FOOD_SOLD_DAYS','60'))
        except ValueError:days=60
        if days<=0:return set(),set()
        hit=self.store.get('food.sold')
        if hit and time.time()-hit.get('at',0)<6*3600 and hit.get('days')==days:return set(hit.get('ids') or []),set(hit.get('names') or [])
        since=datetime.now(timezone.utc)-timedelta(days=days);ids,names=set(),set()
        # Newest first, so a long period never loses the latest sales to the page cap.
        for invoice in self.paged('v2.0/invoices',{'DateFrom':since.strftime('%Y-%m-%dT%H:%M:%S'),'Expand':'InvoiceLines','Pagination.IsAsc':'false'},limit=500,pages=80):
            if not isinstance(invoice,dict) or invoice.get('isVoided') or invoice.get('isDeleted'):continue
            when=str(invoice.get('date') or invoice.get('createdTime') or '')
            try:
                at=datetime.fromisoformat(when[:19])
                if at.replace(tzinfo=timezone.utc)<since-timedelta(days=1):continue
            except ValueError:pass
            for line in invoice.get('invoiceLines') or []:
                if not isinstance(line,dict) or line.get('isVoided') or line.get('isDeleted'):continue
                product=line.get('product') if isinstance(line.get('product'),dict) else {}
                pid=line.get('productId') if type(line.get('productId')) is int else product.get('productId') if type(product.get('productId')) is int else product.get('id')
                if type(pid) is int:ids.add(pid)
                name=str(line.get('productName') or product.get('name') or '').strip().casefold()
                if name:names.add(name)
        self.store.set('food.sold',{'at':time.time(),'days':days,'ids':sorted(ids),'names':sorted(names)})
        return ids,names

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
                journal=dict(journal,phase='accepted',accepted_at=time.time());self.rent_out(order,where.get(uid) or order.get('host_id'),journal)
                self.store.set(key,journal);self.queue(oid,'accepted',message='Принят, несём')
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
