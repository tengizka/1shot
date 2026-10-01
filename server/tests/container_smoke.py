"""CI only. Never talks to club PCs and never enables production bookings."""
import json,urllib.request,urllib.error,uuid,subprocess,sys,traceback
sys.excepthook=lambda t,v,tb: print("::error::"+"".join(traceback.format_exception(t,v,tb)).replace("%","%25").replace("\n","%0A").replace("\r","%0D"))

def call(port,path,body=None,secret=None):
 headers={'Content-Type':'application/json'}
 if secret:headers['x-agent-secret']=secret
 req=urllib.request.Request(f'http://127.0.0.1:{port}{path}',data=None if body is None else json.dumps(body).encode(),headers=headers)
 try:
  with urllib.request.urlopen(req,timeout=10) as r:return r.status,r.read()
 except urllib.error.HTTPError as e:return e.code,e.read()

assert call(8787,'/healthz')[0]==200
assert b"window.CLUB_API_BASE='/api'" in call(8787,'/backend-config.js')[1]
assert b'backend-config.js' in call(8787,'/')[1]
for path in ['/.env','/server/.env','/desktop/env.example','/api/not-real']:
 assert call(8787,path)[0]==404,path
secret='ci-only-not-a-real-secret-long';worker=str(uuid.uuid4())
assert call(8787,'/api/club-agent',{'action':'snapshot','eco':1,'worker_id':worker},secret)[0]==404
assert call(8787,'/api/club-auth',{'action':'claim','worker_id':worker},secret)[0]==403
assert call(8788,'/api/club-agent',{'action':'snapshot','eco':1,'worker_id':worker})[0]==403
status,data=call(8788,'/api/club-agent',{'action':'snapshot','eco':1,'worker_id':worker,'hosts':[{'host_id':'101','zone':'100','status':'free','gizmo_host_id':50}]},secret)
assert status==200,(status,data)
assert json.loads(data)['eco_version']==1
assert json.loads(call(8787,'/api/club-bookings',{'action':'capabilities'})[1])['enabled'] is False
assert call(8787,'/api/club-bookings',{'action':'state','initData':'forged'})[0]==403
status,data=call(8788,'/api/upsert-profile',{'telegram_id':123,'gizmo_user_id':7,'username':'CI user'},secret)
assert status==200,(status,data)
# Restart: DB records remain; never reset the volume as an upgrade procedure.
subprocess.run(['docker','compose','-f','server/compose.yaml','restart','api'],check=True)
subprocess.run(['docker','compose','-f','server/compose.yaml','up','-d','--wait','--wait-timeout','60'],check=True)
assert call(8787,'/healthz')[0]==200
out=subprocess.check_output(['docker','compose','-f','server/compose.yaml','exec','-T','db','psql','-U','oneshot_owner','-d','oneshot','-tAc','select username from profiles where telegram_id=123'],text=True)
assert out.strip()=='CI user'
print('Actual PostgreSQL + standalone API + restart persistence: PASS')
