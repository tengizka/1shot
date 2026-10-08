"""One-shot, staff-confirmed creation. Never journal passwords or raw API errors."""
import base64
import hashlib
import json
import os
import re
import uuid
from datetime import datetime, timezone
from urllib.parse import quote
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from .registration import registration_params


def phone_key(value):
    digits=re.sub(r'\D','',str(value or ''))
    return '7'+digits[1:] if len(digits)==11 and digits[0] in '78' else digits


class RegistrationApproval:
    def __init__(self,cloud,gizmo,store,guard):
        self.cloud,self.gizmo,self.store,self.guard=cloud,gizmo,store,guard

    def report(self,id,record):
        if record.get('phase')!='outcome':
            return {'ok':False,'status':'attention','error':'Операция прервалась. Нужна ручная сверка; повторное создание заблокировано'}
        if not record.get('synced'):
            try:
                self.guard()
                result=self.cloud.desk('registration_finish',id=id,status=record['status'],gizmo_user_id=record.get('gizmo_user_id'))
                record['synced']=result.get('ok') is True
                record['conflict']=not record['synced']
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

    def approve(self,id,confirmed=False):
        if confirmed is not True:return {'error':'Подтвердите очную проверку личности'}
        try:id=str(uuid.UUID(id))
        except (ValueError,TypeError,AttributeError):return {'error':'Некорректная заявка'}
        existing=self.store.get('registration:'+id)
        if existing:return self.report(id,existing)
        self.guard()
        self.store.set('registration:'+id,{'phase':'intent','status':'attention'})
        uid=None;status='attention'
        try:
            row=self.cloud.desk('registration_claim',id=id,confirmed=True)['request']
            if row['id']!=id or datetime.fromisoformat(row['expires_at'].replace('Z','+00:00'))<=datetime.now(timezone.utc):raise ValueError('Expired claim')
            raw=base64.b64decode(row['cipher'],validate=True)
            key=hashlib.sha256(('1shot-auth-v2:'+os.environ['AGENT_SECRET']).encode()).digest()
            req=json.loads(AESGCM(key).decrypt(raw[:12],raw[12:],id.encode()))
            if req.get('action')!='register_application':raise ValueError('Wrong action')
            params=registration_params(req,self.gizmo);username=req['username'];password=req['password']
            exists=self.gizmo.request('GET',f'users/loginname/{quote(username,safe="")}/exist')
            if type(exists) is not bool:raise ValueError('Uncertain nickname check')
            users=self.gizmo.request('GET','users',params={'IsDeleted':False})
            if not isinstance(users,list):raise ValueError('Uncertain user directory')
            duplicate=exists or any(not u.get('isDeleted') and (str(u.get('username','')).casefold()==username.casefold() or phone_key(req['mobile_phone']) in (phone_key(u.get('mobilePhone')),phone_key(u.get('phone')))) for u in users)
            if duplicate:status='rejected'
            else:
                self.guard();created_id=self.gizmo.request('PUT','users',params=params)
                if type(created_id) is not int or created_id<=0:raise ValueError('Unknown creation outcome')
                uid=created_id
                self.store.set('registration:'+id,{'phase':'created','status':'attention','gizmo_user_id':uid})
                actual=self.gizmo.user(uid)
                if any(actual.get(k[0].lower()+k[1:])!=params[k] for k in ('Username','UserGroupId','FirstName','LastName','Sex')) or str(actual.get('birthDate',''))[:10]!=req['birth_date'] or phone_key(actual.get('mobilePhone'))!=phone_key(req['mobile_phone']):raise ValueError('Created profile mismatch')
                self.guard();self.gizmo.request('POST',f'users/{uid}/password/{quote(password,safe="")}')
                verified=self.gizmo.request('GET',f'users/{quote(username,safe="")}/{quote(password,safe="")}/valid')
                if verified.get('result')!=0 or type(verified.get('identity',{}).get('userId')) is not int or verified['identity']['userId']!=uid:raise ValueError('Password not verified')
                status='done'
        except Exception:status='attention'
        record={'phase':'outcome','status':status,'gizmo_user_id':uid,'synced':False}
        self.store.set('registration:'+id,record)
        return self.report(id,record)

    def reject(self,id,confirmed=False):
        if confirmed is not True:return {'error':'Подтвердите отклонение анкеты'}
        self.guard()
        return self.cloud.desk('registration_reject',id=str(uuid.UUID(id)),confirmed=True)
