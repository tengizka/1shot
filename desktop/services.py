import base64
from datetime import datetime,timedelta,timezone
import os
import time
import uuid
import requests

class ApiError(RuntimeError):
    def __init__(self,message,status=None):
        super().__init__(message)
        self.status=status

def unwrap(response, name):
    if not response.ok: raise ApiError(f'{name}: HTTP {response.status_code}')
    if not response.content:return None
    data=response.json()
    if isinstance(data,dict) and data.get('isError'):raise ApiError(f'{name}: Gizmo isError')
    return data.get('result') if isinstance(data,dict) and 'result' in data else data

class Gizmo:
    def __init__(self,login=None,password=None):
        self.base=os.environ['GIZMO_BASE_URL'].rstrip('/')
        login,password=(login,password) if login else (os.environ['GIZMO_LOGIN'],os.environ['GIZMO_PASSWORD'])
        self.auth={'Authorization':'Basic '+base64.b64encode((login+':'+password).encode()).decode()}
        self.verify=os.getenv('GIZMO_VERIFY_SSL','true').lower()=='true'
    def request(self,method,path,**kwargs):
        # No URL containing credentials is included in errors/logs.
        timeout=kwargs.pop('timeout',(3,5))  # a few slow reports (statistics) ask for longer
        try:r=requests.request(method,self.base+'/'+path,headers=self.auth,timeout=timeout,verify=self.verify,**kwargs)
        except requests.exceptions.SSLError as e:raise ApiError('Gizmo: сертификат не прошёл проверку. Проверьте доверие сертификату и GIZMO_VERIFY_SSL') from e
        except requests.Timeout as e:raise ApiError('Gizmo: превышено время ожидания ответа') from e
        except requests.RequestException as e:raise ApiError('Gizmo: соединение недоступно. Проверьте адрес API и сеть клуба') from e
        return unwrap(r,'Gizmo')
    def hosts(self):
        data=self.request('GET','hosts')
        if not isinstance(data,list):raise ApiError('Gizmo: неверный список ПК')
        return data
    def host(self,id):return self.request('GET',f'hosts/{int(id)}')
    def sessions(self):
        data=self.request('GET','usersessions/activeinfo')
        if not isinstance(data,list):raise ApiError('Gizmo: неверный список сессий')
        return data
    def lock(self,id,locked):return self.request('POST',f'hosts/{int(id)}/lock/{str(locked).lower()}')
    def user(self,id):
        data=self.request('GET',f'users/{int(id)}')
        if not isinstance(data,dict) or data.get('id')!=int(id) or data.get('isDeleted'):raise ApiError('Аккаунт Gizmo не найден')
        return data
    def login(self,user,host):return self.request('POST',f'users/{int(user)}/login/{int(host)}')

def money_gizmo(default):
    """The Gizmo login for everything with money: free hours, top-ups, sales (the owner's account).
    MONEY_GIZMO_LOGIN/PASSWORD in .env; the older PROMO_GIZMO_* still works; otherwise Desk's main login."""
    for prefix in ('MONEY_GIZMO','PROMO_GIZMO'):
        login,password=os.getenv(prefix+'_LOGIN','').strip(),os.getenv(prefix+'_PASSWORD','')
        if login and password and 'YOUR-' not in login:return Gizmo(login,password)
    return default

class Cloud:
    def __init__(self):
        local=os.getenv('CLUB_API_URL','').strip()
        self.base=local.rstrip('/')+'/' if local else os.environ['SUPABASE_URL'].rstrip('/')+'/functions/v1/'
        self.label='Локальный сервер' if local else 'База данных'
        if local:
            from urllib.parse import urlparse
            parsed=urlparse(local)
            if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise ApiError('Некорректный CLUB_API_URL')
            if parsed.scheme=='http' and parsed.hostname not in ('localhost','127.0.0.1','::1'):
                raise ApiError('HTTP разрешён только для локального сервера')
        self.headers={'x-agent-secret':os.environ['AGENT_SECRET']}
        # Frequent calls go straight to the database (free on Supabase's plan, unlike edge functions). The public key
        # only reaches RPCs that check the agent secret; the old function stays the fallback for ten minutes on a miss.
        self.rpc_base=None if local else os.environ['SUPABASE_URL'].rstrip('/')+'/rest/v1/rpc/'
        self.rpc_key=os.getenv('SUPABASE_PUBLISHABLE_KEY','').strip() or 'sb_publishable__oIYYAaNECSFsEBGHjzrUw_2baaoeF9'
        self.rpc_off_until=0;self.direct=False
        self.worker_id=str(uuid.uuid4())
        self.host_source=lambda:None
        self.account_updates={}
    def request(self,path,method='POST',body=None):
        try:r=requests.request(method,self.base+path,headers=self.headers,json=body,timeout=(3,8))
        except requests.RequestException as e:raise ApiError(f'{self.label}: нет связи') from e
        if not r.ok:
            detail=''
            try:
                message=r.json().get('error')
                if isinstance(message,str):detail=': '+message[:180]
            except (ValueError,AttributeError):pass
            raise ApiError(f'{self.label}: ошибка {r.status_code}'+detail,status=r.status_code)
        return r.json()
    def rpc(self,name,args):
        """A database function called directly; None when it is not there yet (old server) so the caller falls back."""
        if not self.rpc_base or time.time()<self.rpc_off_until:return None
        try:r=requests.post(self.rpc_base+name,headers={'apikey':self.rpc_key,'Authorization':'Bearer '+self.rpc_key,'Content-Type':'application/json'},json={'p_secret':self.headers['x-agent-secret'],**args},timeout=(3,8))
        except requests.RequestException as e:raise ApiError(f'{self.label}: нет связи') from e
        if r.status_code in (401,403,404) or (r.status_code==400 and 'PGRST' in r.text):
            self.rpc_off_until=time.time()+600;self.direct=False;return None
        if not r.ok:
            try:message=r.json().get('message')
            except (ValueError,AttributeError):message=None
            raise ApiError(f'{self.label}: ошибка {r.status_code}'+(': '+message[:180] if isinstance(message,str) else ''),status=409 if 'P0001' in r.text else r.status_code)
        self.direct=True
        return r.json()
    def snapshot(self,cursor):
        updates=list(self.account_updates.values())[:10]
        result=self.rpc('club_desk_snapshot',{'p_worker':self.worker_id,'p_after':cursor,'p_hosts':self.host_source(),'p_accounts':updates})
        if result is None:result=self.request('club-agent',body={'action':'snapshot','eco':1,'worker_id':self.worker_id,'after_event':cursor,'hosts':self.host_source(),'accounts':updates})
        if result.get('eco_version')!=1:raise ApiError('Сервер не поддерживает протокол Desk: обновите серверную часть')
        for item in updates:
            key=str(item['telegram_id'])
            if self.account_updates.get(key)==item:self.account_updates.pop(key,None)
        return result
    def desk(self,action,**data):
        if action=='food_sync':
            result=self.rpc('club_desk_food',{'p_worker':self.worker_id,'p_seats':data.get('seats'),'p_menu':data.get('menu'),'p_updates':data.get('updates') or []})
            if result is not None:return result
        if action=='account':
            self.account_updates[str(data['telegram_id'])]={**data,'observed_at':datetime.now(timezone.utc).isoformat()}
            return {'ok':True,'queued':True}
        return self.request('club-desk',body={'action':action,'worker_id':self.worker_id,**data})
    def transition(self,id,old,new,message='',code=None):
        body={'action':'transition','worker_id':self.worker_id,'id':id,'from':old,'to':new,'message':message}
        if code is not None:body['code']=code
        try:return self.request('club-agent',body=body).get('ok') is True
        except ApiError as error:
            if getattr(error,'status',None)==409:return False
            raise

class LegacyBridge:
    """Existing sync/auth endpoints only. Never calls pending-reservations."""
    def __init__(self,gizmo,cloud,store):self.gizmo,self.cloud,self.store=gizmo,cloud,store
    def free_at(self,uid):
        """When the player's time runs out: their remaining balance time, cached a minute per player."""
        cache=self.__dict__.setdefault('free_cache',{});now=time.time()
        hit=cache.get(uid)
        if hit and now-hit[0]<60:return hit[1]
        value=None
        try:
            left=self.gizmo.request('GET',f'users/{int(uid)}/balance').get('availableTime')
            # Hours of deposit are not a real end time: beyond 12 hours the PC shows as «надолго».
            if isinstance(left,(int,float)) and not isinstance(left,bool) and 0<left<=12*3600:
                value=(datetime.now(timezone.utc)+timedelta(seconds=left)).isoformat()
        except Exception:pass  # No estimate is fine; the PC just shows as busy.
        cache[uid]=(now,value)
        return value
    def collect_hosts(self):
        hosts=self.gizmo.hosts();players={str(s.get('hostNumber')):s.get('userId') for s in self.gizmo.sessions()};busy=set(players)
        rows=[]
        for h in hosts:
            if h.get('isDeleted'):continue
            n=int(h['number']);state=h.get('state')
            zone='ps5' if n==1 else str((n//10)*10) if 10<=n<30 else str((n//100)*100)
            status='busy' if str(n) in busy else 'broken' if state not in (0,2) else 'reserved' if state==2 else 'free'
            row={'host_id':str(n),'gizmo_host_id':str(h['id']),'zone':zone,'status':status,'updated_at':datetime.now(timezone.utc).isoformat()}
            if status=='busy' and players.get(str(n)):row['free_at']=self.free_at(players[str(n)])
            rows.append(row)
        return rows
    def sync(self):
        rows=self.collect_hosts()
        self.cloud.request('sync-hosts',body={'hosts':rows})
        self.host_rows=rows
        return len(rows)
    def auth(self):
        from .registration import process_auth
        process_auth(self)
    def legacy_auth(self):
        from urllib.parse import quote
        data=self.cloud.request('pending-auth',method='GET')
        for req in data.get('requests',[]):
            key='auth:'+str(req['id']);result=self.store.get(key)
            if not result:
                # Persist intent, so a registration is never replayed after a crash.
                self.store.set(key,{'status':'failed','error_message':'auth_interrupted_contact_admin'})
                try:
                    username=req['username'];password=req['password']
                    if req['action']=='login':
                        identity=self.gizmo.request('GET',f'users/{quote(username,safe="")}/{quote(password,safe="")}/valid')
                        uid=identity.get('identity',{}).get('userId') if identity.get('result')==0 else None
                        if not uid:result={'status':'invalid_credentials'}
                    elif req['action']=='register':
                        raise ApiError('Нужно очное одобрение администратора')
                    else:raise ApiError('unknown_auth_action')
                    if uid:
                        saved=self.cloud.request('upsert-profile',body={'telegram_id':req['telegram_id'],'gizmo_user_id':uid,'username':username,'first_name':req.get('first_name',''),'last_name':req.get('last_name','')})
                        if not saved.get('ok'):raise ApiError('Профиль не сохранён')
                        result={'status':'done','gizmo_user_id':uid}
                except Exception:result={'status':'failed','error_message':'auth_failed_contact_admin'}
                self.store.set(key,result)
            self.cloud.request('pending-auth',method='PATCH',body={'id':req['id'],**result})
