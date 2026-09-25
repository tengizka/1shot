import base64
import os
import uuid
import requests

class ApiError(RuntimeError): pass

def unwrap(response, name):
    if not response.ok: raise ApiError(f'{name}: HTTP {response.status_code}')
    if not response.content:return None
    data=response.json()
    if isinstance(data,dict) and data.get('isError'):raise ApiError(f'{name}: Gizmo isError')
    return data.get('result') if isinstance(data,dict) and 'result' in data else data

class Gizmo:
    def __init__(self):
        self.base=os.environ['GIZMO_BASE_URL'].rstrip('/')
        self.auth={'Authorization':'Basic '+base64.b64encode((os.environ['GIZMO_LOGIN']+':'+os.environ['GIZMO_PASSWORD']).encode()).decode()}
        self.verify=os.getenv('GIZMO_VERIFY_SSL','true').lower()=='true'
    def request(self,method,path,**kwargs):
        # No URL containing credentials is included in errors/logs.
        try:r=requests.request(method,self.base+'/'+path,headers=self.auth,timeout=(3,5),verify=self.verify,**kwargs)
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

class Cloud:
    def __init__(self):
        self.base=os.environ['SUPABASE_URL'].rstrip('/')+'/functions/v1/'
        self.headers={'x-agent-secret':os.environ['AGENT_SECRET']}
        self.worker_id=str(uuid.uuid4())
    def request(self,path,method='POST',body=None):
        try:r=requests.request(method,self.base+path,headers=self.headers,json=body,timeout=(3,8))
        except requests.RequestException as e:raise ApiError('Supabase: нет связи') from e
        if not r.ok:raise ApiError(f'Supabase {path}: HTTP {r.status_code}')
        return r.json()
    def snapshot(self,cursor):return self.request('club-agent',body={'action':'snapshot','worker_id':self.worker_id,'after_event':cursor})
    def desk(self,action,**data):return self.request('club-desk',body={'action':action,'worker_id':self.worker_id,**data})
    def transition(self,id,old,new,message='',code=None):
        body={'action':'transition','worker_id':self.worker_id,'id':id,'from':old,'to':new,'message':message}
        if code is not None:body['code']=code
        try:return self.request('club-agent',body=body).get('ok') is True
        except ApiError as error:
            if 'HTTP 409' in str(error):return False
            raise

class LegacyBridge:
    """Existing sync/auth endpoints only. Never calls pending-reservations."""
    def __init__(self,gizmo,cloud,store):self.gizmo,self.cloud,self.store=gizmo,cloud,store
    def sync(self):
        hosts=self.gizmo.hosts();busy={str(s.get('hostNumber')) for s in self.gizmo.sessions()}
        rows=[]
        for h in hosts:
            if h.get('isDeleted'):continue
            n=int(h['number']);state=h.get('state')
            zone='ps5' if n==1 else str((n//10)*10) if 10<=n<30 else str((n//100)*100)
            status='busy' if str(n) in busy else 'broken' if state not in (0,2) else 'reserved' if state==2 else 'free'
            rows.append({'host_id':str(n),'gizmo_host_id':str(h['id']),'zone':zone,'status':status})
        self.cloud.request('sync-hosts',body={'hosts':rows})
        self.host_rows=rows
        return len(rows)
    def auth(self):
        from .registration import process_auth
        process_auth(self)
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
                        from .registration import registration_params
                        params=registration_params(req,self.gizmo)
                        exists=self.gizmo.request('GET',f'users/loginname/{quote(username,safe="")}/exist')
                        uid=None
                        if exists:result={'status':'username_taken'}
                        else:
                            uid=self.gizmo.request('PUT','users',params=params)
                            if not isinstance(uid,int) or uid<=0:raise ApiError('Не получен ID пользователя')
                            self.gizmo.request('POST',f'users/{uid}/password/{quote(password,safe="")}')
                    else:raise ApiError('unknown_auth_action')
                    if uid:
                        saved=self.cloud.request('upsert-profile',body={'telegram_id':req['telegram_id'],'gizmo_user_id':uid,'username':username,'first_name':req.get('first_name',''),'last_name':req.get('last_name','')})
                        if not saved.get('ok'):raise ApiError('Профиль не сохранён')
                        result={'status':'done','gizmo_user_id':uid}
                except Exception:result={'status':'failed','error_message':'auth_failed_contact_admin'}
                self.store.set(key,result)
            self.cloud.request('pending-auth',method='PATCH',body={'id':req['id'],**result})
