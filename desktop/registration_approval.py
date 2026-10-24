"""One-shot, staff-confirmed creation. Never journal passwords or raw API errors."""
import base64
import hashlib
import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import quote
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from .promo import PromoReward
from .registration import registration_params
from .services import ApiError


def phone_key(value):
    digits=re.sub(r'\D','',str(value or ''))
    return '7'+digits[1:] if len(digits)==11 and digits[0] in '78' else digits


def create_gizmo_account(gizmo,guard,req,remember):
    """Duplicate check, creation, profile and password verification for an approved application.
    Returns ('rejected', None) for a duplicate or ('done', uid). Any uncertainty raises; the caller never retries creation.
    remember(uid) runs right after Gizmo returns the new id so a crash later still knows which account exists."""
    params=registration_params(req,gizmo);username=req['username'];password=req['password']
    exists=gizmo.request('GET',f'users/loginname/{quote(username,safe="")}/exist')
    if type(exists) is not bool:raise ValueError('Uncertain nickname check')
    users=gizmo.request('GET','users',params={'IsDeleted':False})
    if not isinstance(users,list):raise ValueError('Uncertain user directory')
    if exists or any(not u.get('isDeleted') and (str(u.get('username','')).casefold()==username.casefold() or phone_key(req['mobile_phone']) in (phone_key(u.get('mobilePhone')),phone_key(u.get('phone')))) for u in users):
        return 'rejected',None
    guard();uid=gizmo.request('PUT','users',params=params)
    if type(uid) is not int or uid<=0:raise ValueError('Unknown creation outcome')
    remember(uid)
    actual=gizmo.user(uid)
    if any(actual.get(k[0].lower()+k[1:])!=params[k] for k in ('Username','UserGroupId','FirstName','LastName','Sex')) or str(actual.get('birthDate',''))[:10]!=req['birth_date'] or phone_key(actual.get('mobilePhone'))!=phone_key(req['mobile_phone']):raise ValueError('Created profile mismatch')
    guard();gizmo.request('POST',f'users/{uid}/password/{quote(password,safe="")}')
    verified=gizmo.request('GET',f'users/{quote(username,safe="")}/{quote(password,safe="")}/valid')
    if verified.get('result')!=0 or type(verified.get('identity',{}).get('userId')) is not int or verified['identity']['userId']!=uid:raise ValueError('Password not verified')
    return 'done',uid


_LATIN=dict(zip('абвгдеёжзийклмнопрстуфхцчшщъыьэюя',['a','b','v','g','d','e','e','zh','z','i','y','k','l','m','n','o','p','r','s','t','u','f','h','ts','ch','sh','sch','','y','','e','yu','ya']))


def free_username(gizmo,first_name,phone):
    """Reception guests do not pick a nickname: name in Latin + the phone's last digits, the first one Gizmo has free."""
    base=re.sub(r'[^a-z0-9]','',''.join(_LATIN.get(c,c) for c in str(first_name).strip().lower()))[:16] or 'guest'
    digits=re.sub(r'\D','',str(phone))
    for tail in (digits[-4:],digits[-6:],digits[-8:])+tuple(digits[-4:]+str(n) for n in range(2,10)):
        name=(base+tail)[:30]
        if len(name)>=3 and gizmo.request('GET',f'users/loginname/{quote(name,safe="")}/exist') is False:return name
    raise ApiError('Не удалось подобрать свободный ник')


class RegistrationApproval:
    def __init__(self,cloud,gizmo,store,guard):
        self.cloud,self.gizmo,self.store,self.guard=cloud,gizmo,store,guard
        self.promo=PromoReward(cloud,gizmo,store,guard)

    def remember(self,id,req,result,uid=None,source='telegram',code=None):
        """Local history of decided applications for the «История анкет» list (no passwords)."""
        history=[h for h in self.store.get('registration-history',[]) if h.get('id')!=id]
        history.insert(0,{'id':id,'at':datetime.now(timezone.utc).isoformat(),'result':result,'source':source,'gizmo_user_id':uid,'code':code,
                          'username':str(req.get('username') or '')[:30],'name':' '.join(str(req.get(k) or '').strip() for k in ('first_name','last_name')).strip()[:90],
                          'phone':str(req.get('mobile_phone') or '')[:20]})
        self.store.set('registration-history',history[:300])

    def history(self):
        return self.store.get('registration-history',[])

    def report(self,id,record):
        if record.get('phase')=='reconciled':return {'ok':True,'status':'done','synced':True,'gizmo_user_id':record['gizmo_user_id']}
        if record.get('phase')!='outcome':
            return {'ok':False,'status':'attention','error':'Операция прервалась. Нужна ручная сверка; повторное создание заблокировано'}
        if not record.get('synced'):
            try:
                self.guard()
                result=self.cloud.desk('registration_finish',id=id,status=record['status'],gizmo_user_id=record.get('gizmo_user_id'))
                record['synced']=result.get('ok') is True
                record['conflict']=not record['synced']
                if record['conflict']:record['retry_at']=time.time()
                self.store.set('registration:'+id,record)
            except ApiError as error:
                if error.status in (403,409):
                    record['conflict']=True;record['retry_at']=time.time()
                    self.store.set('registration:'+id,record)
            except Exception:pass  # Retry reporting only; never repeat a Gizmo write.
        return {'ok':record['status']=='done','status':record['status'],'synced':bool(record.get('synced')),'gizmo_user_id':record.get('gizmo_user_id')}

    def flush(self):
        with self.store.connect() as db:
            rows=db.execute("select key,value from state where key like 'registration:%'").fetchall()
        for key,raw in rows:
            record=json.loads(raw)
            if record.get('phase')=='outcome' and not record.get('synced') and not record.get('conflict'):
                self.report(key.split(':',1)[1],record)
            elif record.get('phase')=='outcome' and record.get('conflict') and record.get('status')=='done' and time.time()-record.get('retry_at',0)>300:
                # The server may have moved it to «attention» by timeout; it accepts the created account now.
                record.update(conflict=False,retry_at=time.time());self.store.set(key,record);self.report(key.split(':',1)[1],record)
        self.promo.flush()

    def approve(self,id,confirmed=False):
        if confirmed is not True:return {'error':'Подтвердите очную проверку личности'}
        try:id=str(uuid.UUID(id))
        except (ValueError,TypeError,AttributeError):return {'error':'Некорректная заявка'}
        existing=self.store.get('registration:'+id)
        if existing:return self.report(id,existing)
        self.guard()
        self.store.set('registration:'+id,{'phase':'intent','status':'attention'})
        uid=None;status='attention';code=None;req={}
        try:
            row=self.cloud.desk('registration_claim',id=id,confirmed=True)['request']
            if row['id']!=id or datetime.fromisoformat(row['expires_at'].replace('Z','+00:00'))<=datetime.now(timezone.utc):raise ValueError('Expired claim')
            raw=base64.b64decode(row['cipher'],validate=True)
            key=hashlib.sha256(('1shot-auth-v2:'+os.environ['AGENT_SECRET']).encode()).digest()
            req=json.loads(AESGCM(key).decrypt(raw[:12],raw[12:],id.encode()))
            if req.get('action')!='register_application':raise ValueError('Wrong action')
            code=req.get('promo_code') if isinstance(req.get('promo_code'),str) and re.fullmatch(r'[A-Z0-9_-]{2,32}',req['promo_code']) else None
            created=[]
            def remember(new_uid):
                created.append(new_uid);self.store.set('registration:'+id,{'phase':'created','status':'attention','gizmo_user_id':new_uid})
            try:status,uid=create_gizmo_account(self.gizmo,self.guard,req,remember)
            finally:uid=uid or (created[0] if created else None)
        except Exception:status='attention'
        record={'phase':'outcome','status':status,'gizmo_user_id':uid,'synced':False}
        self.store.set('registration:'+id,record)
        if status in ('done','rejected'):
            try:self.remember(id,req,status,uid,'telegram',code)
            except Exception:pass
        result=self.report(id,record)
        if status=='done' and code:
            reward=self.promo.grant(id,uid,code)
            result['promo']={'code':code,'result':reward.get('result'),'note':reward.get('note'),'error':reward.get('error'),**({'tax_warning':reward['tax_warning']} if reward.get('tax_warning') else {})}
        return result

    def promo_codes(self):
        self.guard()
        codes=self.cloud.desk('promo_codes').get('codes')
        return [c for c in codes if isinstance(c,dict) and isinstance(c.get('code'),str) and re.fullmatch(r'[A-Z0-9_-]{2,32}',c['code'])] if isinstance(codes,list) else []

    def register_at_desk(self,id,data,code=None,confirmed=False):
        """Reception registration without Telegram: same checks as an approved application, promo picked by a button.
        One request id is one account; repeating it never creates a second one, it only finishes the free hour."""
        if confirmed is not True:return {'error':'Подтвердите, что личность проверена по документу'}
        try:id=str(uuid.UUID(id))
        except (ValueError,TypeError,AttributeError):return {'error':'Некорректный запрос'}
        if code is not None and not (isinstance(code,str) and re.fullmatch(r'[A-Z0-9_-]{2,32}',code)):return {'error':'Выберите промокод кнопкой'}
        key='desk-registration:'+id;record=self.store.get(key)
        if not record:
            if not isinstance(data,dict):return {'error':'Заполните анкету'}
            digits=re.sub(r'\D','',str(data.get('mobile_phone','')))
            phone='+7'+digits[1:] if len(digits)==11 and digits[0] in '78' else ('+7'+digits if len(digits)==10 else str(data.get('mobile_phone','')).strip())
            username=str(data.get('username','')).strip()
            if not username:
                try:username=free_username(self.gizmo,data.get('first_name',''),phone)
                except Exception as error:return {'error':str(error) if isinstance(error,ApiError) else 'Не удалось подобрать ник. Проверьте связь'}
            req={'username':username,'password':data.get('password'),'first_name':str(data.get('first_name','')),'last_name':str(data.get('last_name','')),
                 'mobile_phone':phone,'birth_date':str(data.get('birth_date','')),'sex':data.get('sex')}
            try:registration_params(req,self.gizmo)
            except Exception as error:return {'error':str(error) if isinstance(error,ApiError) else 'Проверьте поля анкеты'}
            self.guard();self.store.set(key,{'phase':'intent','status':'attention','code':code})
            status,uid='attention',None;created=[]
            def remember(new_uid):
                created.append(new_uid);self.store.set(key,{'phase':'created','status':'attention','gizmo_user_id':new_uid,'code':code})
            try:status,uid=create_gizmo_account(self.gizmo,self.guard,req,remember)
            except Exception:status='attention'
            uid=uid or (created[0] if created else None)
            record={'phase':'outcome','status':status,'gizmo_user_id':uid,'code':code,'username':req['username']}
            self.store.set(key,record)
            if status=='done':self.remember(id,req,'done',uid,'desk',code)
        result={'ok':record.get('status')=='done','status':record.get('status'),'gizmo_user_id':record.get('gizmo_user_id'),'username':record.get('username')}
        if record.get('phase')!='outcome':
            result.update(ok=False,status='attention',error='Операция прервалась. Проверьте аккаунт в Gizmo вручную; повторное создание заблокировано');return result
        code=record.get('code')
        if result['ok'] and code:
            # The redemption is recorded before the hour: the server allows one free hour per Gizmo account.
            if not record.get('redeemed'):
                try:
                    self.guard();ok=self.cloud.desk('promo_desk_redemption',id=id,code=code,gizmo_user_id=record['gizmo_user_id']).get('ok') is True
                except ApiError as error:
                    result['promo']={'code':code,'result':'failed','error':str(error).rsplit(': ',1)[-1]};return result
                except Exception:ok=False
                if not ok:
                    result['promo']={'code':code,'result':'pending','error':'Нет связи с сервером. Нажмите «Создать» ещё раз: аккаунт не продублируется'};return result
                record['redeemed']=True;self.store.set(key,record)
            reward=self.promo.grant(id,record['gizmo_user_id'],code)
            result['promo']={'code':code,'result':reward.get('result'),'note':reward.get('note'),'error':reward.get('error'),**({'tax_warning':reward['tax_warning']} if reward.get('tax_warning') else {})}
        return result

    def reject(self,id,confirmed=False):
        if confirmed is not True:return {'error':'Подтвердите отклонение анкеты'}
        self.guard()
        return self.cloud.desk('registration_reject',id=str(uuid.UUID(id)),confirmed=True)

    def review(self,id):
        """Read-only inspection. Password proof comes from the guest's own fresh login."""
        id=str(uuid.UUID(id));self.guard()
        result=self.cloud.desk('registration_review',id=id)
        row,proof=result['request'],result.get('proof')
        if row.get('id')!=id or row.get('status')!='attention':raise ValueError('Заявка изменилась')
        if not proof:raise ValueError('Попросите гостя заново войти с телефона: нужен успешный вход после появления ошибки, не старше 10 минут')
        uid=proof.get('gizmo_user_id')
        if type(uid) is not int or uid<=0:raise ValueError('Не подтверждён аккаунт')
        local=self.store.get('registration:'+id,{})
        for known in (row.get('gizmo_user_id'),local.get('gizmo_user_id')):
            if known is not None and known!=uid:raise ValueError('Вход выполнен не в созданный аккаунт. Нужна ручная проверка')
        params=registration_params(dict(row['public_data'],password='x'),self.gizmo)
        actual=self.gizmo.user(uid)
        if actual.get('isDeleted') or actual.get('isDisabled'):raise ValueError('Аккаунт удалён или отключён')
        if any(actual.get(k[0].lower()+k[1:])!=params[k] for k in ('Username','UserGroupId','FirstName','LastName','Sex')) or str(actual.get('birthDate',''))[:10]!=params['BirthDate'][:10] or phone_key(actual.get('mobilePhone'))!=phone_key(params['MobilePhone']):
            raise ValueError('Профиль, группа или данные не совпадают с анкетой. Ничего не изменено')
        return {'proof_id':proof['id'],'gizmo_user_id':uid,'username':actual['username'],'first_name':actual.get('firstName'),'last_name':actual.get('lastName'),'mobile_phone':actual.get('mobilePhone')}

    def reconcile(self,id,proof_id,uid,confirmed=False):
        if confirmed is not True:return {'error':'Подтвердите очную сверку конкретного аккаунта'}
        id=str(uuid.UUID(id));proof_id=str(uuid.UUID(proof_id))
        if type(uid) is not int or uid<=0:return {'error':'Некорректный аккаунт'}
        previous=self.store.get('registration:'+id,{})
        if previous.get('phase')=='reconciled':return self.report(id,previous)
        # An ambiguous SQL response is retried with the exact persisted proof, not a new operation.
        if not (previous.get('phase')=='reconciling' and previous.get('proof_id')==proof_id and previous.get('gizmo_user_id')==uid):
            checked=self.review(id)
            if checked['proof_id']!=proof_id or checked['gizmo_user_id']!=uid:return {'error':'Вход гостя изменился. Повторите просмотр'}
            self.store.set('registration:'+id,{'phase':'reconciling','status':'attention','proof_id':proof_id,'gizmo_user_id':uid})
        self.guard()
        result=self.cloud.desk('registration_reconcile',id=id,proof_id=proof_id,gizmo_user_id=uid,confirmed=True)
        if result.get('ok') is True:
            self.store.set('registration:'+id,{'phase':'reconciled','status':'done','gizmo_user_id':uid})
        return result
