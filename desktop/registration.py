"""Strict registration and encrypted auth queue. No password persists locally."""
import base64
import hashlib
import json
import os
import re
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote
from .services import ApiError


def adult_group(gizmo):
    groups=gizmo.request('GET','usergroups')
    found=[g for g in groups if g.get('name','').strip()=='18+'] if isinstance(groups,list) else []
    if len(found)!=1 or not isinstance(found[0].get('id'),int) or found[0]['id']<=0:
        raise ApiError('В Gizmo нужна ровно одна группа с названием 18+')
    return found[0]['id']


def registration_params(req,gizmo,today=None):
    today=today or datetime.now(timezone(timedelta(hours=3))).date()
    if not re.fullmatch(r'[\w.-]{3,30}',req.get('username','')) or not 6<=len(req.get('password',''))<=64:
        raise ApiError('Некорректный никнейм или пароль')
    if any(not isinstance(req.get(k),str) or not req[k].strip() or len(req[k])>45 for k in ('first_name','last_name')):
        raise ApiError('Имя и фамилия обязательны')
    phone=re.sub(r'[ ()-]','',req.get('mobile_phone',''))
    if not re.fullmatch(r'\+?\d{7,15}',phone) or type(req.get('sex')) is not int or req['sex'] not in (1,2):
        raise ApiError('Проверьте телефон и пол')
    birth=date.fromisoformat(req['birth_date'])
    age=today.year-birth.year-((today.month,today.day)<(birth.month,birth.day))
    if birth>today or age>110:raise ApiError('Проверьте дату рождения')
    group=adult_group(gizmo) if age>=18 else int(os.getenv('GUEST_USER_GROUP_ID','3'))
    return {'Username':req['username'],'UserGroupId':group,'FirstName':req['first_name'].strip(),'LastName':req['last_name'].strip(),'MobilePhone':phone,'Sex':req['sex'],'BirthDate':birth.isoformat()+'T00:00:00'}


def login_name(gizmo,identity):
    # A phone must match exactly one nondeleted/non-disabled guest; never try several passwords.
    if not re.fullmatch(r'\+?[\d ()-]{7,20}',identity):return identity
    if gizmo.request('GET',f'users/loginname/{quote(identity,safe="")}/exist') is True:return identity
    normalized=lambda value:re.sub(r'\D','',str(value or ''))
    matches=[u for u in gizmo.request('GET','users',params={'IsDeleted':False,'IsDisabled':False})
             if not u.get('isDeleted') and not u.get('isDisabled') and normalized(identity) in (normalized(u.get('mobilePhone')),normalized(u.get('phone')))]
    if len(matches)!=1:raise ApiError('Телефон не найден или неоднозначен; используйте никнейм')
    return matches[0]['username']


def process_auth(bridge):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    cloud,gizmo,store=bridge.cloud,bridge.gizmo,bridge.store
    rows=cloud.request('club-auth',body={'action':'claim','worker_id':cloud.worker_id}).get('requests',[])
    for row in rows:
        key='auth-v2:'+row['id'];result=store.get(key)
        if not result:
            store.set(key,{'status':'failed'})  # uncertain registration is never replayed
            result={'status':'failed'}
            try:
                created=datetime.fromisoformat(row['created_at'].replace('Z','+00:00'))
                if (datetime.now(timezone.utc)-created).total_seconds()>180:raise ApiError('Запрос истёк')
                raw=base64.b64decode(row['cipher'],validate=True)
                secret=hashlib.sha256(('1shot-auth-v2:'+os.environ['AGENT_SECRET']).encode()).digest()
                req=json.loads(AESGCM(secret).decrypt(raw[:12],raw[12:],row['id'].encode()))
                uid=None;username=req['username'];password=req['password']
                if req['action']=='register':
                    params=registration_params(req,gizmo)
                    if gizmo.request('GET',f'users/loginname/{quote(username,safe="")}/exist'):
                        result={'status':'username_taken'}
                    else:
                        uid=gizmo.request('PUT','users',params=params)
                        if type(uid) is not int or uid<=0:raise ApiError('Нет ID нового аккаунта')
                        gizmo.request('POST',f'users/{uid}/password/{quote(password,safe="")}')
                        actual=gizmo.user(uid)
                        if actual.get('userGroupId')!=params['UserGroupId'] or str(actual.get('birthDate',''))[:10]!=req['birth_date']:
                            raise ApiError('Gizmo не подтвердил группу / дату рождения')
                        verified=gizmo.request('GET',f'users/{quote(username,safe="")}/{quote(password,safe="")}/valid')
                        if verified.get('result')!=0 or verified.get('identity',{}).get('userId')!=uid:raise ApiError('Пароль не подтверждён')
                elif req['action']=='login':
                    username=login_name(gizmo,username)
                    verified=gizmo.request('GET',f'users/{quote(username,safe="")}/{quote(password,safe="")}/valid')
                    uid=verified.get('identity',{}).get('userId') if verified.get('result')==0 else None
                    if not uid:result={'status':'invalid_credentials'}
                else:raise ApiError('Unknown action')
                if uid:
                    user=gizmo.user(uid)
                    saved=cloud.request('upsert-profile',body={'telegram_id':row['telegram_id'],'gizmo_user_id':uid,'username':user['username'],'first_name':user.get('firstName') or '','last_name':user.get('lastName') or ''})
                    if not saved.get('ok'):raise ApiError('Профиль не сохранён')
                    result={'status':'done','gizmo_user_id':uid}
            except Exception:result={'status':'failed'}  # never log credentials or raw Gizmo responses
            store.set(key,result)
        cloud.request('club-auth',body={'action':'finish','worker_id':cloud.worker_id,'id':row['id'],**result})
