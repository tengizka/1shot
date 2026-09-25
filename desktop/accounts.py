"""Account operations use only verified profile IDs, never IDs supplied by a guest."""
import hashlib
import math
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import quote
from .engine import UnsafeOperation

EDITABLE={'username':30,'firstName':45,'lastName':45,'email':254,'mobilePhone':20}
PRESERVE=('username','userGroupId','email','firstName','lastName','birthDate','address','city','country','postCode','phone','mobilePhone','sex','identification')

def session_record(s):
    # Never use an unstable elapsed-time counter as session identity.
    stamp=s.get('lastLogin')
    key=hashlib.sha256(f"{s['userId']}:{s['hostId']}:{stamp}".encode()).hexdigest() if stamp else None
    return {'key':key,'host_id':str(s.get('hostNumber','')),'gizmo_host_id':s['hostId'],'last_login':stamp,'user_id':s['userId']}

def finite(value):return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)

class Accounts:
    def __init__(self,gizmo,cloud,store,guard):
        self.gizmo,self.cloud,self.store,self.guard=gizmo,cloud,store,guard
        self.requests=[]
    def guest(self,uid):
        user=self.gizmo.user(uid)
        if user.get('userGroupId')!=int(os.getenv('GUEST_USER_GROUP_ID','3')):
            from .registration import adult_group
            try:group=adult_group(self.gizmo)
            except Exception as error:raise UnsafeOperation('Гостевая группа 18+ не подтверждена') from error
            if user.get('userGroupId')!=group:
                raise UnsafeOperation('Изменения разрешены только для гостевых групп клуба, не операторов')
        return user
    def statistics(self,uid):
        key='stats:'+str(uid);cached=self.store.get(key)
        if cached and time.time()-cached.get('cached_at',0)<600:return cached
        end=datetime.now(timezone.utc);start=end-timedelta(days=30)
        result={'from':start.isoformat(),'to':end.isoformat(),'hours':None,'cached_at':time.time()}
        try:
            rows=self.gizmo.request('GET','stats/session',params={'userId':int(uid),'start':start.isoformat(),'end':end.isoformat(),'max':100})
            own=[r for r in rows if r.get('userId')==int(uid)] if isinstance(rows,list) else []
            if len(own)==1:
                value=(own[0].get('totalSpan') or {}).get('totalHours')
                if finite(value) and value>=0:result['hours']=value
        except Exception:pass  # Statistics failure must not hide balance / session.
        self.store.set(key,result)
        return result
    def read(self,uid):
        user=self.gizmo.user(uid)
        balance=self.gizmo.request('GET',f'users/{int(uid)}/balance')
        if not isinstance(balance,dict) or balance.get('userId')!=int(uid):raise UnsafeOperation('Gizmo не подтвердил владельца баланса')
        active=[s for s in self.gizmo.sessions() if s.get('userId')==int(uid)]
        return {k:user.get(k) for k in ('username','firstName','lastName','birthDate','email','mobilePhone')}|{
            'balance':balance.get('balance') if finite(balance.get('balance')) else None,
            'session':session_record(active[0]) if len(active)==1 else None,
            'session_count':len(active),'statistics':self.statistics(uid)}
    def execute(self,cmd):
        uid=int(cmd['gizmo_user_id']);kind=cmd['kind'];payload=cmd['payload']
        self.guard()
        if kind=='logout':
            active=[s for s in self.gizmo.sessions() if s.get('userId')==uid]
            if not active:return 'Сессия уже завершена'
            if len(active)!=1 or not payload.get('key') or session_record(active[0])['key']!=payload['key']:
                raise UnsafeOperation('Сессия изменилась; чужой или новый вход не завершаем')
            self.guard();self.gizmo.request('POST',f'users/{uid}/logout')
            if any(s.get('userId')==uid for s in self.gizmo.sessions()):
                raise UnsafeOperation('Gizmo ещё не подтвердил выход. Команду автоматически не повторяем')
            return 'Выход подтверждён Gizmo'
        if kind=='profile_edit':
            user=self.guest(uid)
            if any(s.get('userId')==uid for s in self.gizmo.sessions()):raise UnsafeOperation('Сначала завершите игровую сессию')
            if not payload or any(k not in EDITABLE or not isinstance(v,str) or len(v)>EDITABLE[k] for k,v in payload.items()):raise UnsafeOperation('Некорректные поля профиля')
            desired={**user,**payload}
            # Preserve every documented personal field, including immutable birth date.
            params={'UserId':uid}
            for field in PRESERVE:
                value=desired.get(field)
                if value is not None:params[field[0].upper()+field[1:]]=value
            self.guard();self.gizmo.request('POST','users',params=params)
            actual=self.gizmo.user(uid)
            if any((actual.get(k) or '')!=v for k,v in payload.items()):raise UnsafeOperation('Не все изменения подтверждены Gizmo')
            if actual.get('birthDate')!=user.get('birthDate'):raise UnsafeOperation('Gizmo изменил дату рождения; нужна проверка администратора')
            return 'Профиль сохранён в Gizmo'
        raise UnsafeOperation('Неизвестная операция')
    def queue_password_result(self,id,outcome,verified=False):
        pending=self.store.get('password-outcomes',{})
        if id in pending and pending[id]['outcome']!=outcome:raise UnsafeOperation('Для заявки уже сохранён другой результат')
        pending[id]={'outcome':outcome,'verified':bool(verified) or pending.get(id,{}).get('verified',False)}
        self.store.set('password-outcomes',pending)
        self.flush_password_results()
        return id not in self.store.get('password-outcomes',{})
    def flush_password_results(self):
        pending=self.store.get('password-outcomes',{})
        for id,result in list(pending.items()):
            if result.get('conflict'):continue
            try:
                response=self.cloud.desk('resolve_password',id=id,confirmed=True,outcome=result['outcome'],verified=result['verified'])
                if response.get('conflict'):
                    pending[id]['conflict']=True;self.store.set('password-outcomes',pending);continue
                if not response.get('ok'):continue
                del pending[id]
            except Exception:
                pass  # Includes expired lease: only the outcome is retried, never the password.
            self.store.set('password-outcomes',pending)
    def tick(self,data=None):
        self.flush_password_results()
        if data is None:data=self.cloud.desk('poll')
        self.requests=[r for r in data['commands'] if r['status']=='awaiting_admin']
        for cmd in data['commands']:
            if cmd['status']=='awaiting_admin':continue
            self.guard()
            key='command:'+cmd['id'];saved=self.store.get(key)
            if saved:
                self.cloud.desk('finish',id=cmd['id'],**saved);continue
            if cmd['status']=='running':
                # Another process or a crash may have already sent the side effect.
                self.cloud.desk('finish',id=cmd['id'],status='attention',message='Операция прервана. Не повторяем автоматически');continue
            if not self.cloud.desk('claim',id=cmd['id']).get('ok'):continue
            result={'status':'attention','message':'Операция прервана; нужна ручная проверка'}
            self.store.set(key,result)
            try:result={'status':'done','message':self.execute(cmd)}
            except Exception as error:result={'status':'attention','message':str(error)[:250]}
            self.store.set(key,result);self.cloud.desk('finish',id=cmd['id'],**result)
        for item in data['accounts'][:10]:
            self.guard()
            if item.get('updated_at'):
                age=time.time()-datetime.fromisoformat(item['updated_at'].replace('Z','+00:00')).timestamp()
                if age<10:continue
            actual=self.read(item['gizmo_user_id'])
            self.cloud.desk('account',telegram_id=item['telegram_id'],gizmo_user_id=item['gizmo_user_id'],data=actual)
    def find(self,username):
        if not isinstance(username,str) or not 1<=len(username)<=30:raise UnsafeOperation('Введите точный логин')
        from .registration import login_name
        username=login_name(self.gizmo,username.strip())
        result=self.gizmo.request('GET',f'users/{quote(username,safe="")}/username')
        if not isinstance(result,dict) or not result.get('id'):raise UnsafeOperation('Аккаунт не найден')
        user=self.guest(result['id'])
        return {k:user.get(k) for k in ('id','username','firstName','lastName','mobilePhone','phone')}
    def reset(self,uid,expected_username,password,request_id=None):
        if not isinstance(password,str) or not 8<=len(password)<=64 or password.isspace():raise UnsafeOperation('Новый пароль: от 8 до 64 символов')
        user=self.guest(uid)
        if user.get('username')!=expected_username:raise UnsafeOperation('Логин изменился. Найдите аккаунт заново')
        if any(s.get('userId')==int(uid) for s in self.gizmo.sessions()):raise UnsafeOperation('Сначала гость должен завершить сессию')
        journal='password-reset:'+str(request_id) if request_id else None
        previous=self.store.get(journal) if journal else None
        if previous:
            if previous.get('phase')=='verified' and previous.get('user_id')==int(uid):
                self.queue_password_result(request_id,'done',True);return True
            raise UnsafeOperation('Результат предыдущей смены неизвестен. Не повторяйте: проверьте аккаунт вручную')
        self.guard()
        if journal:self.store.set(journal,{'phase':'intent','user_id':int(uid),'time':time.time()})
        # Passwords are sent directly to documented Gizmo API, never persisted in DB/logs.
        audit='admin-reset:'+str(uuid.uuid4())
        self.store.set(audit,{'user_id':int(uid),'time':time.time(),'status':'intent'})
        self.gizmo.request('POST',f'users/{int(uid)}/password/{quote(password,safe="")}')
        check=self.gizmo.request('GET',f'users/{quote(expected_username,safe="")}/{quote(password,safe="")}/valid')
        if not isinstance(check,dict) or check.get('result')!=0 or check.get('identity',{}).get('userId')!=int(uid):
            raise UnsafeOperation('Смена пароля не подтверждена. Не повторяйте вслепую')
        self.store.set(audit,{'user_id':int(uid),'time':time.time(),'status':'verified'})
        if journal:self.store.set(journal,{'phase':'verified','user_id':int(uid),'time':time.time()})
        targets=[request_id] if request_id else [r['id'] for r in self.requests if r['gizmo_user_id']==int(uid)]
        for id in targets:self.queue_password_result(id,'done',True)
        return True
