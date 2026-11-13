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
from .services import money_gizmo

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
        """«Наиграно»: Gizmo counts it slowly (tens of seconds) and only for the whole club at once, so one background
        read takes every guest's hours and is kept 6 hours; a guest missing from it has played 0 hours."""
        table=self.__dict__.setdefault('_hours',{'at':0,'by_user':None,'busy':False})
        # Kept 6 hours; a failed read is retried after 10 minutes.
        stale=time.time()-table['at']>=(6*3600 if table['by_user'] is not None else 600)
        if (table['at']==0 or stale) and not table['busy']:
            table['busy']=True
            threading.Thread(target=self._count_hours,args=(table,),daemon=True).start()
        if table['by_user'] is None:return {'from':None,'to':None,'hours':None,'cached_at':0}
        return {'from':table['from'],'to':table['to'],'hours':table['by_user'].get(int(uid),0.0),'cached_at':table['at']}
    def _count_hours(self,table):
        end=datetime.now(timezone.utc);start=datetime(2024,1,1,tzinfo=timezone.utc)
        try:
            # max: every guest of the club, not Gizmo's top 100 (the old reason «Наиграно» showed 0 for most guests).
            rows=self.gizmo.request('GET','stats/session',timeout=(3,120),params={'start':start.strftime('%Y-%m-%dT%H:%M:%S'),'end':end.strftime('%Y-%m-%dT%H:%M:%S'),'max':100000})
            if isinstance(rows,list):
                by_user={}
                for r in rows:
                    value=span_hours(r.get('totalSpan'))
                    if value is None:value=span_hours(r.get('hours'))
                    if isinstance(r.get('userId'),int) and value is not None and value>=0:by_user[r['userId']]=round(value,1)
                table.update({'by_user':by_user,'from':start.isoformat(),'to':end.isoformat()})
        except Exception:pass  # Statistics failure must not hide balance / session.
        finally:
            table['at']=time.time();table['busy']=False
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
            # Money goes through the owner's account, like the free hour.
            created=money_gizmo(self.gizmo).request('POST','v2.0/paymentintent/deposit',json={'userId':uid,'amount':amount,'paymentMethodId':method})
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


def _rows(value,key):
    """Gizmo reports wrap their rows ({sessions:[…]}, {data:[…]}); a bare list is the rows themselves."""
    if isinstance(value,list):return value
    if isinstance(value,dict):
        for k in (key,'data','result'):
            if isinstance(value.get(k),list):return value[k]
    return []

def _money(value):
    return round(float(value),2) if finite(value) else None

def profile(gizmo,directory,uid,statistics=None,rentals=(),registrations=()):
    """Everything the desk knows about one account for the «Аккаунты» page: who it is, money and time, visits,
    purchases and notes. Every part is read on its own, so a slow Gizmo report only leaves its own block empty."""
    uid=int(uid);user=directory.get(uid,fresh=True);full=gizmo.user(uid)
    out={'user':user|{k:full.get(k) for k in ('birthDate','email','createdTime','sex','isDisabled')},'errors':[]}
    end=datetime.now(timezone.utc);start=end-timedelta(days=365)
    span={'DateFrom':start.strftime('%Y-%m-%dT%H:%M:%S'),'DateTo':end.strftime('%Y-%m-%dT%H:%M:%S')}
    try:
        balance=gizmo.request('GET',f'users/{uid}/balance')
        if not isinstance(balance,dict) or balance.get('userId')!=uid:raise ValueError()
        out['balance']={'deposit':_money(balance.get('deposits',balance.get('balance'))),'balance':_money(balance.get('balance')),
                        'points':balance.get('points') if finite(balance.get('points')) else None,
                        'time':balance.get('availableTime') if finite(balance.get('availableTime')) and balance.get('availableTime')>=0 else None}
    except Exception:out['errors'].append('баланс')
    try:
        active=[s for s in gizmo.sessions() if s.get('userId')==uid]
        out['playing']=[{'host':str(s.get('hostNumber','')),'since':s.get('lastLogin')} for s in active]
    except Exception:out['playing']=[]
    try:
        rows=_rows(gizmo.request('GET','reports/sessionslog',params={'UserId':uid,**span},timeout=(3,40)),'sessions')
        visits=[{'start':r.get('startTime'),'end':r.get('endTime'),'host':str(r.get('hostNumber') or r.get('hostName') or ''),
                 'minutes':round(r['totalMinutes']) if finite(r.get('totalMinutes')) else (round(span_hours(r.get('span'))*60) if span_hours(r.get('span')) is not None else None)}
                for r in rows if isinstance(r,dict) and r.get('userId') in (None,uid)]
        visits.sort(key=lambda v:str(v['start'] or ''),reverse=True)
        out['visits']=visits[:60];out['visit_count']=len(visits)
        out['last_visit']=visits[0]['start'] if visits else None
    except Exception:out['visits']=None;out['errors'].append('посещения')
    try:
        rows=_rows(gizmo.request('GET','reports/transactionslog',params={'UserId':uid,**span},timeout=(3,40)),'transactions')
        buys=[{'at':r.get('transactionDate') or r.get('invoiceDate'),'title':str(r.get('title') or '')[:80],'value':_money(r.get('total',r.get('value'))),
               'method':str(r.get('paymentMethodName') or '')[:40]} for r in rows if isinstance(r,dict)]
        buys.sort(key=lambda b:str(b['at'] or ''),reverse=True)
        out['purchases']=buys[:80]
    except Exception:out['purchases']=None;out['errors'].append('покупки')
    try:
        notes=_rows(gizmo.request('GET',f'v2.0/users/{uid}/notes',params={'Pagination.Limit':30}),'data')
        out['notes']=[str(n.get('text') or '')[:300] for n in notes if isinstance(n,dict) and n.get('text')]
    except Exception:out['notes']=None
    out['hours']=(statistics or {}).get('hours')
    out['rentals']=[{'item':r.get('item'),'at':r.get('at'),'returned_at':r.get('returned_at'),'host':r.get('host')} for r in rentals if r.get('user_id')==uid][-30:][::-1]
    reg=[h for h in registrations if h.get('gizmo_user_id')==uid]
    out['registration']={'at':reg[0].get('at'),'code':reg[0].get('code'),'source':reg[0].get('source')} if reg else None
    return out
