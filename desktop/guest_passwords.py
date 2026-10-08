"""Scoped staff authorization; only the guest supplies the new password."""
import base64
import hashlib
import json
import os
import uuid
from urllib.parse import quote
from datetime import datetime, timezone
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from .registration import registration_params
from .registration_approval import phone_key
from .services import ApiError


class GuestPasswords:
    def __init__(self,cloud,gizmo,store,guard):
        self.cloud,self.gizmo,self.store,self.guard=cloud,gizmo,store,guard

    def account(self,uid):
        if type(uid) is not int or uid<=0:raise ValueError('Нет подтверждённого ID аккаунта')
        user=self.gizmo.user(uid)
        if type(user.get('id')) is not int or user['id']!=uid or type(user.get('userGroupId')) is not int or user['userGroupId']<=0:raise ValueError('Профиль не подтверждён')
        if user.get('isDeleted') or user.get('isDisabled'):raise ValueError('Аккаунт отключён или удалён')
        groups=self.gizmo.request('GET','usergroups')
        if not isinstance(groups,list):raise ValueError('Группы не подтверждены')
        matches=[g for g in groups if type(g.get('id')) is int and g.get('id')==user.get('userGroupId')]
        name=matches[0].get('name','').strip().casefold() if len(matches)==1 else ''
        guest=name in ('клиенты','18+') and sum(g.get('name','').strip().casefold()==name for g in groups)==1
        return user,1 if guest else 8

    def authorize(self,source,id,uid,username,confirmed=False,privileged=False):
        if confirmed is not True:return {'error':'Подтвердите очную проверку личности'}
        id=str(uuid.UUID(id));self.guard()
        context=self.cloud.desk('password_context',source=source,id=id)['data']
        if context.get('gizmo_user_id')!=uid:raise ValueError('Аккаунт заявки изменился')
        user,minimum=self.account(uid)
        if user['username']!=username:raise ValueError('Повторите выбор аккаунта: никнейм изменился')
        if minimum==8 and privileged is not True:raise ValueError('Подтвердите разрешение для служебной или неизвестной группы')
        if source=='registration':
            expected=registration_params(dict(context['public_data'],password='x'),self.gizmo)
            if any(user.get(k[0].lower()+k[1:])!=expected[k] for k in ('Username','UserGroupId','FirstName','LastName','Sex')) or str(user.get('birthDate',''))[:10]!=expected['BirthDate'][:10] or phone_key(user.get('mobilePhone'))!=phone_key(expected['MobilePhone']):raise ValueError('Профиль не совпадает с анкетой. Нужна сверка')
            saved=self.store.get('registration:'+id,{})
            if saved.get('gizmo_user_id') not in (None,uid):raise ValueError('ID отличается от локального журнала')
        if any(s.get('userId')==uid for s in self.gizmo.sessions()):raise ValueError('Владелец должен сам завершить игровую сессию перед сменой пароля')
        self.guard()
        grant=self.cloud.desk('password_authorize',source=source,id=id,gizmo_user_id=uid,username=username,group_id=user['userGroupId'],minimum_length=minimum,confirmed=True,privileged=privileged is True)['data']
        return {'ok':True,'grant_id':grant}

    def report(self,id,record):
        try:
            self.guard();result=self.cloud.desk('password_finish',id=id,status=record['status'])
            record['synced']=result.get('ok') is True;record['conflict']=not record['synced']
            self.store.set('guest-password:'+id,record)
        except ApiError as error:
            if error.status in (403,409):
                record['conflict']=True;self.store.set('guest-password:'+id,record)
        except Exception:pass

    def tick(self,grants):
        with self.store.connect() as db:records=db.execute("select key,value from state where key like 'guest-password:%'").fetchall()
        for key,value in records:
            record=json.loads(value)
            if record.get('phase')=='outcome' and not record.get('synced') and not record.get('conflict'):self.report(key.split(':',1)[1],record)
        for grant in grants:
            if grant.get('status')!='queued':continue
            id=str(uuid.UUID(grant['id']));key='guest-password:'+id
            if self.store.get(key):continue
            self.guard();self.store.set(key,{'phase':'intent','status':'attention'})
            status='attention'
            try:
                row=self.cloud.desk('password_claim',id=id)['data']
                if row['id']!=id or datetime.fromisoformat(row['expires_at'].replace('Z','+00:00'))<=datetime.now(timezone.utc):raise ValueError('Expired grant')
                raw=base64.b64decode(row['cipher'],validate=True)
                secret=hashlib.sha256(('1shot-password-v1:'+os.environ['AGENT_SECRET']).encode()).digest()
                payload=json.loads(AESGCM(secret).decrypt(raw[:12],raw[12:],(id+':'+row['request_id']).encode()))
                password=payload.get('password');uid=row['gizmo_user_id'];user,minimum=self.account(uid)
                if user['username']!=row['username'] or user['userGroupId']!=row['group_id'] or minimum>row['minimum_length']:raise ValueError('Account policy changed')
                if not isinstance(password,str) or not password.strip() or not max(minimum,row['minimum_length'])<=len(password)<=64:raise ValueError('Invalid password')
                if any(s.get('userId')==uid for s in self.gizmo.sessions()):raise ValueError('Active session; never log it out')
                self.guard()
                # Exactly one write; never clear the old password first.
                self.gizmo.request('POST',f'users/{uid}/password/{quote(password,safe="")}')
                verified=self.gizmo.request('GET',f'users/{quote(user["username"],safe="")}/{quote(password,safe="")}/valid')
                if type(verified.get('result')) is not int or verified.get('result')!=0 or type(verified.get('identity',{}).get('userId')) is not int or verified['identity']['userId']!=uid:raise ValueError('Password not verified')
                status='done'
            except Exception:pass  # Never expose payloads, password-bearing URLs or raw exceptions.
            record={'phase':'outcome','status':status,'synced':False}
            self.store.set(key,record);self.report(id,record)

    def review(self,id):
        self.guard();result=self.cloud.desk('password_review',id=str(uuid.UUID(id)))['data']
        user,minimum=self.account(result['gizmo_user_id'])
        return {**result,'username':user['username'],'requires_privileged_confirmation':minimum==8}

    def resolve(self,id,proof_id,uid,confirmed=False,privileged=False):
        if confirmed is not True:return {'error':'Подтвердите очную сверку доступа'}
        id=str(uuid.UUID(id));proof_id=str(uuid.UUID(proof_id));key='password-resolution:'+id
        saved=self.store.get(key,{})
        if saved.get('proof_id')!=proof_id or saved.get('gizmo_user_id')!=uid:
            checked=self.review(id)
            if checked['proof_id']!=proof_id or checked['gizmo_user_id']!=uid:return {'error':'Вход изменился. Повторите просмотр'}
        _,minimum=self.account(uid)
        if minimum==8 and privileged is not True:return {'error':'Подтвердите сверку служебного аккаунта'}
        self.guard();self.store.set(key,{'proof_id':proof_id,'gizmo_user_id':uid})
        return self.cloud.desk('password_resolve',id=id,proof_id=proof_id,confirmed=True)
