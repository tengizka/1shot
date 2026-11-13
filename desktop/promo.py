"""Free hour for a promo code: zero-price time product plus a Gizmo note.
Granted at most once per application; an interrupted order is never repeated automatically."""
import os
import re
import time
from urllib.parse import quote

PRODUCT='standart 1 h'
sleep=time.sleep  # tests replace it to skip the waits


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
    """Only 0% may apply. A product without taxes gets Gizmo's default on API sales, so then every tax in Gizmo must be 0%."""
    item=gizmo.request('GET',f'v2.0/products/{int(product)}',params={'Expand':'ProductTaxes'})
    links=item.get('productTaxes') if isinstance(item,dict) else None
    if not isinstance(links,list):raise ValueError('не удалось проверить налог товара standart 1 h')
    taxes=gizmo.request('GET','v2.0/taxes')
    taxes=taxes.get('data') if isinstance(taxes,dict) else taxes
    if not isinstance(taxes,list):raise ValueError('не удалось прочитать налоги Gizmo')
    values={t.get('id'):t.get('value') for t in taxes if isinstance(t,dict)}
    used={t.get('taxId') for t in links if isinstance(t,dict) and t.get('isEnabled',True)}
    # No tax on the product: Gizmo picks a default, which is only safe when no tax in Gizmo is above 0%.
    checked=used or set(values)
    bad=sorted({values.get(i) for i in checked if not isinstance(values.get(i),(int,float)) or values.get(i)!=0},key=str)
    if bad and not used:raise ValueError(f'у товара standart 1 h нет налога, а в Gizmo есть налог {bad[-1]}%: его Gizmo и подставит. Сделайте налоги 0%')
    if bad:raise ValueError(f'у товара standart 1 h есть налог {bad[-1]}%: оставьте только «None» (0%)')


def strict_tax():
    """The club decided the free hour may carry the product's tax line; PROMO_REQUIRE_ZERO_TAX=true brings the 0% check back."""
    return os.getenv('PROMO_REQUIRE_ZERO_TAX','false').strip().lower()=='true'

def invoice_tax_free(gizmo,invoice_id):
    """Every line of the new invoice has a 0% tax rate and zero tax; anything unreadable is not zero."""
    data=gizmo.request('GET',f'v2.0/invoices/{int(invoice_id)}',params={'Expand':'InvoiceLines'})
    lines=data.get('invoiceLines') if isinstance(data,dict) else None
    if not isinstance(lines,list) or not lines:return False
    zero=lambda v:isinstance(v,(int,float)) and not isinstance(v,bool) and v==0
    return zero(data.get('taxTotal',0)) and all(isinstance(l,dict) and zero(l.get('taxRate')) and zero(l.get('taxTotal',0)) for l in lines)


def payment_method():
    value=os.getenv('PROMO_PAYMENT_METHOD_ID','-1').strip()
    if not re.fullmatch(r'-?\d+',value):raise ValueError('Некорректный PROMO_PAYMENT_METHOD_ID')
    return int(value)


class PromoReward:
    def __init__(self,cloud,gizmo,store,guard):
        self.cloud,self.gizmo,self.store,self.guard=cloud,gizmo,store,guard
        self._seller=None

    def seller(self):
        """The free hour and its note always go through Desk's main Gizmo login (GIZMO_LOGIN), the way that has always worked.
        MONEY_GIZMO_* is for money only (top-ups): an owner account without API access must never block the free hour."""
        return self.gizmo

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
        # On by default (the club accepts the tax line on the free hour); PROMO_AUTO_HOUR=false leaves it to staff.
        if os.getenv('PROMO_AUTO_HOUR','true').strip().lower()=='false':
            record['error']='автоначисление выключено, выдайте час вручную';self.store.set(key,record);return self.report(id,record)
        try:
            self.guard();seller=self.seller();product=free_hour_product(self.gizmo);method=payment_method()
            # The club accepts the product's tax line on the free hour; PROMO_REQUIRE_ZERO_TAX=true checks for 0%.
            if strict_tax():zero_tax(self.gizmo,product)
        except Exception as error:
            # Nothing was ordered; the reason is shown to the admin, who can give the hour by hand.
            record['error']=str(error)[:160] or 'Проверка товара не прошла';self.store.set(key,record);return self.report(id,record)
        self.store.set(key,{'phase':'ordering','code':code,'gizmo_user_id':uid,**({'tax_warning':record['tax_warning']} if record.get('tax_warning') else {})})
        hour=lambda t,known:isinstance(t,dict) and t.get('invoiceId') not in known and not (t.get('isVoided') or t.get('isDeleted')) and float(t.get('totalSeconds') or 0)>=3600
        try:
            before=seller.request('GET',f'users/{int(uid)}/producttime')
            known={t.get('invoiceId') for t in before if isinstance(t,dict)} if isinstance(before,list) else None
        except Exception:known=None
        try:
            # Gizmo can take well over 5 s to make the invoice; a short timeout used to leave the hour «unconfirmed».
            invoice=seller.request('POST',f'users/{int(uid)}/order/{product}/invoice/payment/{method}',timeout=(3,45))
            if not isinstance(invoice,dict) or type(invoice.get('id')) is not int:raise ValueError('Unknown order outcome')
            record['invoice_id']=invoice['id']
            # Accounting guard: the free hour must never move money. Any non-zero invoice stops for staff review.
            if any(float(invoice.get(k) or 0)!=0 for k in ('total','subTotal','outstanding')):raise ValueError('Non-zero invoice')
            if strict_tax():
                if any('tax' in k.lower() and isinstance(v,(int,float)) and not isinstance(v,bool) and v!=0 for k,v in invoice.items()):raise ValueError('Non-zero tax')
                if not invoice_tax_free(seller,invoice['id']):raise ValueError('Invoice tax not 0%')
            ok=False
            for wait in (0,2,5):
                sleep(wait)
                lines=seller.request('GET',f'users/{int(uid)}/producttime',timeout=(3,20))
                ok=isinstance(lines,list) and any(isinstance(t,dict) and t.get('invoiceId')==invoice['id'] and hour(t,()) for t in lines)
                if ok:break
            record['result']='granted' if ok else 'attention'
            if not ok:
                seen=[{k:t.get(k) for k in ('invoiceId','totalSeconds','isVoided','isDeleted')} for t in lines if isinstance(t,dict)][:3] if isinstance(lines,list) else lines
                record['error']=f'счёт {invoice["id"]} создан, но часа нет на счету гостя (Gizmo показывает: {seen})'[:200]
        except Exception as error:
            record['result']='attention'
            # Shown to the admin and kept in the Gizmo note, so the real reason is never lost.
            record['error']=('Gizmo ответил: '+str(error))[:200]
            # The answer was lost, but the hour may be there: a new hour line that was not on the account before counts.
            if known is not None and str(error)!='Non-zero invoice':
                for wait in (3,6,10):
                    sleep(wait)
                    try:lines=seller.request('GET',f'users/{int(uid)}/producttime',timeout=(3,20))
                    except Exception:continue
                    if isinstance(lines,list) and sum(1 for t in lines if hour(t,known))==1:record['result']='granted';record.pop('error',None);break
        try:
            text=(f'Автоматически (1SHOT Desk): выдан 1 час STANDART за промокод {code} при регистрации' if record['result']=='granted'
                  else f'Автоматически (1SHOT Desk): промокод {code} — начисление часа STANDART не подтверждено, проверьте вручную'+(f'. Причина: {record["error"]}' if record.get('error') else ''))
            self.guard();seller.request('PUT',f'users/{int(uid)}/note/{quote(text,safe="")}/0');record['note']=True
        except Exception:pass
        self.store.set(key,record)
        return self.report(id,record)


def test_hour(gizmo,username):
    """Settings → «Тесты» → «Тестовый бесплатный час»: the same steps as the free hour at registration, for an account
    picked by nickname, with every step reported, so staff see exactly where and why Gizmo stops."""
    from .test_order import find_user
    steps=[]
    def step(text):steps.append(text)
    try:
        user=find_user(gizmo,username);uid=int(user['id']);step(f'Аккаунт {user.get("username")} · ID {uid}')
        product=free_hour_product(gizmo);step(f'Товар standart 1 h найден · ID {product}')
        method=payment_method();step(f'Способ оплаты {method}')
        before=gizmo.request('GET',f'users/{uid}/producttime')
        known={t.get('invoiceId') for t in before if isinstance(t,dict)} if isinstance(before,list) else set()
        try:invoice=gizmo.request('POST',f'users/{uid}/order/{product}/invoice/payment/{method}',timeout=(3,45))
        except Exception as error:
            step(f'Gizmo не продал час: {error}');return {'ok':False,'steps':steps}
        if not isinstance(invoice,dict) or type(invoice.get('id')) is not int:
            step(f'Gizmo ответил непонятно: {str(invoice)[:120]}');return {'ok':False,'steps':steps}
        step(f'Счёт {invoice["id"]} · сумма {invoice.get("total")} ₽')
        lines=[]
        for wait in (0,2,5):
            sleep(wait);lines=gizmo.request('GET',f'users/{uid}/producttime',timeout=(3,20))
            if isinstance(lines,list) and any(isinstance(t,dict) and t.get('invoiceId') not in known and float(t.get('totalSeconds') or 0)>=3600 for t in lines):break
        else:
            seen=[{k:t.get(k) for k in ('invoiceId','totalSeconds','isVoided')} for t in lines if isinstance(t,dict)][:4] if isinstance(lines,list) else str(lines)[:120]
            step(f'Часа на счету не видно. Gizmo показывает: {seen}')
            ok=False
        if not steps[-1].startswith('Часа на счету'):step('Час на счету гостя ✓');ok=True
        try:
            gizmo.request('PUT',f'users/{uid}/note/{quote("Тест (1SHOT Desk): бесплатный час STANDART"+(" выдан" if ok else " — не подтверждён"),safe="")}/0');step('Заметка в Gizmo ✓')
        except Exception as error:step(f'Заметка не записалась: {error}')
        return {'ok':ok,'steps':steps}
    except Exception as error:
        step(f'Остановились: {error}');return {'ok':False,'steps':steps}
