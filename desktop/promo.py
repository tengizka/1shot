"""Free hour for a promo code: zero-price time product plus a Gizmo note.
Granted at most once per application; an interrupted order is never repeated automatically."""
import os
import re
from urllib.parse import quote
from .services import Gizmo

PRODUCT='standart 1 h'


def free_hour_product(gizmo):
    items=gizmo.request('GET','products/time')
    found=[p for p in items if isinstance(p,dict) and not p.get('isDeleted') and str(p.get('name','')).strip().casefold()==PRODUCT] if isinstance(items,list) else []
    if len(found)!=1 or type(found[0].get('id')) is not int:raise ValueError(f'Нужен ровно один товар «standart 1 h», найдено: {len(found)}')
    if float(found[0].get('price') or 0)!=0:raise ValueError(f'Товар standart 1 h должен стоить 0 ₽, в Gizmo: {found[0].get("price")} ₽')
    # Gizmo keeps the minutes either on the product or in its nested timeProduct block.
    nested=found[0].get('timeProduct') if isinstance(found[0].get('timeProduct'),dict) else {}
    minutes=found[0].get('minutes',nested.get('minutes'))
    if minutes!=60:raise ValueError(f'Товар standart 1 h должен давать ровно 60 минут, в Gizmo: {minutes}')
    return found[0]['id']


def zero_tax(gizmo,product):
    """Only a product without any non-zero tax may be sold; an answer we cannot read counts as a tax."""
    item=gizmo.request('GET',f'v2.0/products/{int(product)}',params={'Expand':'ProductTaxes'})
    links=item.get('productTaxes') if isinstance(item,dict) else None
    if not isinstance(links,list):raise ValueError('не удалось проверить налог товара standart 1 h')
    used={t.get('taxId') for t in links if isinstance(t,dict) and t.get('isEnabled',True)}
    if not used:return
    taxes=gizmo.request('GET','v2.0/taxes')
    taxes=taxes.get('data') if isinstance(taxes,dict) else taxes
    values={t.get('id'):t.get('value') for t in taxes or [] if isinstance(t,dict)}
    bad=[values.get(i) for i in used if not isinstance(values.get(i),(int,float)) or values.get(i)!=0]
    if bad:raise ValueError(f'у товара standart 1 h есть налог {bad[0]}%: уберите его в Gizmo, нужен 0%')


def payment_method():
    value=os.getenv('PROMO_PAYMENT_METHOD_ID','-1').strip()
    if not re.fullmatch(r'-?\d+',value):raise ValueError('Некорректный PROMO_PAYMENT_METHOD_ID')
    return int(value)


class PromoReward:
    def __init__(self,cloud,gizmo,store,guard):
        self.cloud,self.gizmo,self.store,self.guard=cloud,gizmo,store,guard
        self._seller=None

    def seller(self):
        """The free hour is sold by its own Gizmo operator (PROMO_GIZMO_LOGIN), never by Desk's main login."""
        if self._seller is None:
            login,password=os.getenv('PROMO_GIZMO_LOGIN','').strip(),os.getenv('PROMO_GIZMO_PASSWORD','')
            if not login or not password or 'YOUR-' in login:raise ValueError('нужна отдельная учётка: PROMO_GIZMO_LOGIN и PROMO_GIZMO_PASSWORD в .env')
            if login==os.getenv('GIZMO_LOGIN','').strip():raise ValueError('PROMO_GIZMO_LOGIN должен отличаться от GIZMO_LOGIN')
            self._seller=Gizmo(login,password)
        return self._seller

    def report(self,id,record):
        if record.get('result') in ('granted','failed') and not record.get('synced'):
            try:
                self.guard()
                record['synced']=self.cloud.desk('promo_reward',id=id,result=record['result']).get('ok') is True
                self.store.set('promo:'+id,record)
            except Exception:pass  # Reporting is retried by flush; the Gizmo order never is.
        return record

    def flush(self):
        with self.store.connect() as db:
            rows=db.execute("select key from state where key like 'promo:%'").fetchall()
        for (key,) in rows:
            record=self.store.get(key)
            if record and not record.get('synced'):self.report(key.split(':',1)[1],record)

    def grant(self,id,uid,code):
        """Returns the local record: result granted / failed (nothing ordered) / attention (check by hand)."""
        key='promo:'+id;existing=self.store.get(key)
        if existing:
            if existing.get('phase')=='ordering':
                existing={'phase':'outcome','result':'attention','code':code,'gizmo_user_id':uid}
                self.store.set(key,existing)
            return self.report(id,existing)
        record={'phase':'outcome','result':'failed','code':code,'gizmo_user_id':uid,'note':False}
        # Off unless PROMO_AUTO_HOUR=true: the API sale gets the product's tax line, so staff give the hour by hand.
        if os.getenv('PROMO_AUTO_HOUR','false').strip().lower()!='true':
            record['error']='автоначисление выключено, выдайте час вручную';self.store.set(key,record);return self.report(id,record)
        try:
            self.guard();seller=self.seller();product=free_hour_product(self.gizmo);zero_tax(self.gizmo,product);method=payment_method()
        except Exception as error:
            # Nothing was ordered; the reason is shown to the admin, who can give the hour by hand.
            record['error']=str(error)[:160] or 'Проверка товара не прошла';self.store.set(key,record);return self.report(id,record)
        self.store.set(key,{'phase':'ordering','code':code,'gizmo_user_id':uid})
        try:
            invoice=seller.request('POST',f'users/{int(uid)}/order/{product}/invoice/payment/{method}')
            if not isinstance(invoice,dict) or type(invoice.get('id')) is not int:raise ValueError('Unknown order outcome')
            record['invoice_id']=invoice['id']
            # Accounting guard: the free hour must never move money. Any non-zero invoice stops for staff review.
            if any(float(invoice.get(k) or 0)!=0 for k in ('total','subTotal','outstanding')):raise ValueError('Non-zero invoice')
            if any('tax' in k.lower() and isinstance(v,(int,float)) and not isinstance(v,bool) and v!=0 for k,v in invoice.items()):raise ValueError('Non-zero tax')
            lines=seller.request('GET',f'users/{int(uid)}/producttime')
            ok=isinstance(lines,list) and any(isinstance(t,dict) and t.get('invoiceId')==invoice['id'] and not (t.get('isVoided') or t.get('isDeleted')) and float(t.get('totalSeconds') or 0)>=3600 for t in lines)
            record['result']='granted' if ok else 'attention'
        except Exception:
            record['result']='attention'
        try:
            text=(f'Автоматически (1SHOT Desk): выдан 1 час STANDART за промокод {code} при регистрации' if record['result']=='granted'
                  else f'Автоматически (1SHOT Desk): промокод {code} — начисление часа STANDART не подтверждено, проверьте вручную')
            self.guard();seller.request('PUT',f'users/{int(uid)}/note/{quote(text,safe="")}/0');record['note']=True
        except Exception:pass
        self.store.set(key,record)
        return self.report(id,record)
