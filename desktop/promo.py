"""Free hour for a promo code: zero-price time product plus a Gizmo note.
Granted at most once per application; an interrupted order is never repeated automatically."""
import os
import re
from urllib.parse import quote

PRODUCT='standart 1 h'


def free_hour_product(gizmo):
    items=gizmo.request('GET','products/time')
    found=[p for p in items if isinstance(p,dict) and not p.get('isDeleted') and str(p.get('name','')).strip().casefold()==PRODUCT] if isinstance(items,list) else []
    if len(found)!=1 or type(found[0].get('id')) is not int:raise ValueError('Нужен ровно один товар standart 1 h')
    if float(found[0].get('price') or 0)!=0:raise ValueError('Товар standart 1 h должен стоить 0 ₽')
    if found[0].get('minutes')!=60:raise ValueError('Товар standart 1 h должен давать ровно 60 минут')
    return found[0]['id']


def payment_method():
    value=os.getenv('PROMO_PAYMENT_METHOD_ID','-1').strip()
    if not re.fullmatch(r'-?\d+',value):raise ValueError('Некорректный PROMO_PAYMENT_METHOD_ID')
    return int(value)


class PromoReward:
    def __init__(self,cloud,gizmo,store,guard):
        self.cloud,self.gizmo,self.store,self.guard=cloud,gizmo,store,guard

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
        try:
            self.guard();product=free_hour_product(self.gizmo);method=payment_method()
        except Exception:
            self.store.set(key,record);return self.report(id,record)
        self.store.set(key,{'phase':'ordering','code':code,'gizmo_user_id':uid})
        try:
            invoice=self.gizmo.request('POST',f'users/{int(uid)}/order/{product}/invoice/payment/{method}')
            if not isinstance(invoice,dict) or type(invoice.get('id')) is not int:raise ValueError('Unknown order outcome')
            record['invoice_id']=invoice['id']
            # Accounting guard: the free hour must never move money. Any non-zero invoice stops for staff review.
            if any(float(invoice.get(k) or 0)!=0 for k in ('total','subTotal','outstanding')):raise ValueError('Non-zero invoice')
            lines=self.gizmo.request('GET',f'users/{int(uid)}/producttime')
            ok=isinstance(lines,list) and any(isinstance(t,dict) and t.get('invoiceId')==invoice['id'] and not (t.get('isVoided') or t.get('isDeleted')) and float(t.get('totalSeconds') or 0)>=3600 for t in lines)
            record['result']='granted' if ok else 'attention'
        except Exception:
            record['result']='attention'
        try:
            text=(f'Автоматически (1SHOT Desk): выдан 1 час STANDART за промокод {code} при регистрации' if record['result']=='granted'
                  else f'Автоматически (1SHOT Desk): промокод {code} — начисление часа STANDART не подтверждено, проверьте вручную')
            self.guard();self.gizmo.request('PUT',f'users/{int(uid)}/note/{quote(text,safe="")}/0');record['note']=True
        except Exception:pass
        self.store.set(key,record)
        return self.report(id,record)
