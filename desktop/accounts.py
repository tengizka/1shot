"""Account operations use only verified profile IDs, never IDs supplied by a guest."""
import hashlib
import math
import os
import re
import threading
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

def span_hours(value):
    """Gizmo sends a duration as {totalHours: …}, as a .NET string «d.hh:mm:ss», or as plain hours."""
    if isinstance(value,dict):
        for key in ('totalHours','TotalHours'):
            if finite(value.get(key)):return float(value[key])
        if finite(value.get('ticks')):return value['ticks']/36e9
        return None
    if finite(value):return float(value)
    if isinstance(value,str):
        m=re.fullmatch(r'(?:(\d+)\.)?(\d+):(\d{2}):(\d{2})(?:\.\d+)?',value.strip())
        if m:return int(m[1] or 0)*24+int(m[2])+int(m[3])/60+int(m[4])/3600
        try:return float(value.replace(',','.'))
        except ValueError:return None
    return None

class Accounts:
    def __init__(self,gizmo,cloud,store,guard):
        self.gizmo,self.cloud,self.store,self.guard=gizmo,cloud,store,guard
        self.requests=[]
        from .directory import Directory
        self.directory=Directory(gizmo)
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
        """«Наиграно»: Gizmo counts it slowly (tens of seconds), so it runs in the background and is kept 6 hours."""
        mem=self.__dict__.setdefault('_stats',{});busy=self.__dict__.setdefault('_stats_busy',set())
        hit=mem.get(uid)
        if hit and time.time()-hit['cached_at']<(6*3600 if hit['hours'] is not None else 600):return hit
        if uid not in busy:
            busy.add(uid)
            threading.Thread(target=self._count_hours,args=(uid,mem,busy),daemon=True).start()
        return hit or {'from':None,'to':None,'hours':None,'cached_at':0}
    def _count_hours(self,uid,mem,busy):
        end=datetime.now(timezone.utc);start=datetime(2024,1,1,tzinfo=timezone.utc)
        result={'from':start.isoformat(),'to':end.isoformat(),'hours':None,'cached_at':time.time()}
        try:
            rows=self.gizmo.request('GET','stats/session',timeout=(3,90),params={'userId':int(uid),'start':start.strftime('%Y-%m-%dT%H:%M:%S'),'end':end.strftime('%Y-%m-%dT%H:%M:%S'),'max':100})
            own=[r for r in rows if r.get('userId')==int(uid)] if isinstance(rows,list) else None
            if own==[]:result['hours']=0
            elif own and len(own)==1:
                value=span_hours(own[0].get('totalSpan'))
                if value is None:value=span_hours(own[0].get('hours'))
                if value is not None and value>=0:result['hours']=round(value,1)
        except Exception:pass  # Statistics failure must not hide balance / session.
        finally:
            mem[uid]=result;busy.discard(uid)
    def read(self,uid):
        user=self.gizmo.user(uid)
        balance=self.gizmo.request('GET',f'users/{int(uid)}/balance')
        if not isinstance(balance,dict) or balance.get('userId')!=int(uid):raise UnsafeOperation('Gizmo не подтвердил владельца баланса')
        active=[s for s in self.gizmo.sessions() if s.get('userId')==int(uid)]
        return {k:user.get(k) for k in ('username','firstName','lastName','birthDate','email','mobilePhone')}|{
            'balance':balance.get('balance') if finite(balance.get('balance')) else None,
            'available_time':balance.get('availableTime') if finite(balance.get('availableTime')) and balance.get('availableTime')>=0 else None,
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
        if kind=='lock':
            active=[s for s in self.gizmo.sessions() if s.get('userId')==uid]
            if not active:return 'Сессия уже завершена'
            if len(active)!=1 or not payload.get('key') or session_record(active[0])['key']!=payload['key']:
                raise UnsafeOperation('Сессия изменилась; чужой вход не блокируем')
            host_id=active[0].get('hostId')
            if not host_id:raise UnsafeOperation('Не удалось определить ПК для блокировки')
            self.guard();self.gizmo.request('POST',f'hosts/{int(host_id)}/lock/true')
            return 'Экран ПК заблокирован'
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
        if kind=='topup':
            amount=payload.get('amount')
            if type(amount) is not int or not 100<=amount<=50000:raise UnsafeOperation('Некорректная сумма пополнения')
            self.gizmo.user(uid)
            method=self.online_method()
            self.guard()
            # Gizmo makes the T-Bank link and credits the deposit by itself once the guest pays.
            created=self.gizmo.request('POST','v2.0/paymentintent/deposit',json={'userId':uid,'amount':amount,'paymentMethodId':method})
            url=created.get('paymentUrl') if isinstance(created,dict) else None
            if not isinstance(url,str) or not url.startswith('https://') or len(url)>300:raise UnsafeOperation('Gizmo не вернул ссылку на оплату')
            return url
        raise UnsafeOperation('Неизвестная операция')
    def online_method(self):
        """Gizmo payment method for online top-ups: PAYMENT_ONLINE_METHOD_ID in .env, otherwise the only enabled T-Bank / online method."""
        value=os.getenv('PAYMENT_ONLINE_METHOD_ID','').strip()
        if value:return int(value)
        rows=self.gizmo.request('GET','v2.0/paymentmethods')
        rows=rows.get('data') if isinstance(rows,dict) else rows
        found=[m for m in rows or [] if m.get('isEnabled') and not m.get('isDeleted') and re.search(r'т-?банк|тинькоф|tinkoff|t-?bank|онлайн|online',str(m.get('name','')),re.I)]
        if len(found)!=1:
            names=', '.join(f"{m.get('id')} {m.get('name')}" for m in rows or [] if not m.get('isDeleted'))
            raise UnsafeOperation(('Укажите PAYMENT_ONLINE_METHOD_ID в .env. Способы оплаты Gizmo: '+names)[:250])
        return int(found[0]['id'])
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
    def reset(self,uid,expected_username,password,request_id=None,admin=False,privileged_confirmed=False):
        if not isinstance(password,str) or not 3<=len(password)<=64 or password.isspace():raise UnsafeOperation('Новый пароль: от 3 до 64 символов')
        user=self.directory.get(uid,fresh=True) if admin else self.guest(uid)
        if admin and user['requires_privileged_confirmation'] and privileged_confirmed is not True:raise UnsafeOperation('Подтвердите смену пароля служебной или неподтверждённой гостевой группы')
        if user.get('username')!=expected_username:raise UnsafeOperation('Логин изменился. Найдите аккаунт заново')
        if any(s.get('userId')==int(uid) for s in self.gizmo.sessions()):raise UnsafeOperation('Сначала владелец должен завершить игровую сессию')
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
