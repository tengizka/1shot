"""Run: python -m desktop.app (Windows 10/11 + bundled Qt WebEngine)."""
import os
import sys
import threading
import time
from pathlib import Path
from .engine import Controller,Store
from .accounts import Accounts
from .sound import Sound
from .services import Cloud,Gizmo,LegacyBridge
from .version import VERSION, AUTHOR, APP_TITLE, APP_ID

ROOT=Path(getattr(sys,'_MEIPASS',Path(__file__).resolve().parents[1]))
HOME=Path(os.getenv('LOCALAPPDATA',str(Path.home())))/'1SHOT Desk'
HOME.mkdir(parents=True,exist_ok=True)

class App:
    def __init__(self):
        self.store=Store(HOME/'desk.sqlite3');self.cloud=Cloud();self.gizmo=Gizmo()
        self.controller=Controller(self.cloud,self.gizmo,self.store)
        self.bridge=LegacyBridge(self.gizmo,self.cloud,self.store)
        self.stop=threading.Event();self.lock=threading.RLock();self.operations=threading.RLock();self.exit_prompt=threading.Lock()
        self.controller.stopping=self.stop.is_set
        self.accounts=Accounts(self.gizmo,self.cloud,self.store,self.controller.guard)
        self.sound=Sound(HOME,self.store);self.host_rows=[];self.password_requests=[];self.protocol_ready=False;self.maximized=False
        self.online=False;self.error='Подключение…';self.sync_error='';self.last_sync=0
        self.rows=[];self.alerts={};self.notified_cursor=0;self.muted_until=0;self.window=None;self.tray=None;self.exiting=False
    def alarm(self):self.sound.play()
    def sound_settings(self,settings):return self.sound.configure(settings)
    def minimize(self):self.window.minimize()
    def maximize(self):
        self.maximized=not self.maximized
        self.window.maximize() if self.maximized else self.window.restore()
    def cancel_booking(self,id):
        try:
            with self.operations:
                self.cloud.snapshot(self.store.get('event_cursor',0))
                return self.cloud.desk('cancel',id=id)
        except Exception as error:return {'error':str(error)}
    def find_account(self,username):
        try:
            with self.operations:return {'user':self.accounts.find(username)}
        except Exception as error:return {'error':str(error)}
    def booking_guest(self,id):
        try:
            with self.operations:
                booking=next((b for b in self.controller.rows if b['id']==id),None)
                if not booking:return {'error':'Бронь уже завершена'}
                user=self.gizmo.user(int(booking['gizmo_user_id']))
                return {'user':{k:user.get(k) for k in ('username','firstName','lastName','mobilePhone','phone')},'telegram_id':booking.get('telegram_id'),'gizmo_user_id':booking['gizmo_user_id']}
        except Exception:return {'error':'Не удалось получить данные гостя из Gizmo'}
    def renew_account_lease(self):
        started=time.time();mono=time.monotonic()
        self.cloud.snapshot(self.store.get('event_cursor',0))
        self.controller.lease_until=started+25;self.controller.lease_mono=mono+25
    def prepare_password_request(self,id):
        try:
            with self.operations:
                self.renew_account_lease()
                request=self.cloud.desk('password_request',id=id)['request']
                user=self.accounts.guest(int(request['gizmo_user_id']))
                return {'user':{k:user.get(k) for k in ('id','username','firstName','lastName','mobilePhone','phone')},'request_id':request['id']}
        except Exception as error:return {'error':str(error)}
    def resolve_password_request(self,id,outcome,confirmed=False):
        try:
            if outcome not in ('done','rejected') or confirmed is not True:return {'error':'Подтвердите результат заявки'}
            with self.operations:
                self.renew_account_lease()
                self.cloud.desk('password_request',id=id)
                synced=self.accounts.queue_password_result(id,outcome)
                if self.store.get('password-outcomes',{}).get(id,{}).get('conflict'):return {'error':'Статус заявки уже изменился. Проверьте результат в Supabase'}
                if synced:
                    self.password_requests=[r for r in self.password_requests if r['id']!=id]
                return {'ok':True,'synced':synced}
        except Exception as error:return {'error':str(error)}
    def reset_password_request(self,id,username,password,confirmed=False):
        try:
            if confirmed is not True:return {'error':'Сначала подтвердите личность гостя'}
            with self.operations:
                self.renew_account_lease()
                request=self.cloud.desk('password_request',id=id)['request']
                self.accounts.reset(int(request['gizmo_user_id']),username,password,request_id=id)
                synced=id not in self.store.get('password-outcomes',{})
                if synced:self.password_requests=[r for r in self.password_requests if r['id']!=id]
                return {'ok':True,'synced':synced}
        except Exception as error:return {'error':str(error)}
    def reset_password(self,id,username,password):
        try:
            with self.operations:
                # Renew the same worker's lease without running arbitrary queued operations.
                started=time.time();mono=time.monotonic()
                self.cloud.snapshot(self.store.get('event_cursor',0))
                self.controller.lease_until=started+25;self.controller.lease_mono=mono+25
                self.accounts.reset(int(id),username,password)
                return {'ok':True}
        except Exception as error:return {'error':str(error)}
    def snapshot(self):
        with self.lock:
            return {'password_sync_error':'Статус заявки на пароль изменился: требуется сверка с Supabase' if any(v.get('conflict') for v in self.store.get('password-outcomes',{}).values()) else '', 'online':self.online,'error':self.error,'sync_error':self.sync_error,'last_sync':self.last_sync,'rows':self.rows,'alerts':len(self.store.get('alerts',{})),'muted':time.time()<self.muted_until,'sound':self.sound.settings,'hosts':self.host_rows,'password_requests':self.password_requests,'protocol_ready':self.protocol_ready}
    def acknowledge(self):
        with self.lock:self.store.set('alerts',{})
        self.sound.stop()
        return True
    def mute(self):self.muted_until=0 if time.time()<self.muted_until else time.time()+300;self.sound.stop();return True
    def test_sound(self):self.alarm();return True
    def work(self):
        last_alarm=0
        while not self.stop.is_set():
            try:
                with self.operations:
                    self.controller.tick()
                    try:
                        self.accounts.tick();self.protocol_ready=True
                        self.password_requests=[{k:r.get(k) for k in ('id','gizmo_user_id','telegram_id','created_at')} for r in self.accounts.requests]
                    except Exception as error:
                        self.protocol_ready=False;self.controller.errors.append('Аккаунты: '+str(error))
                with self.lock:
                    self.rows=[]
                    for b in self.controller.rows:
                        record=self.store.get('booking:'+b['id'],{})
                        self.rows.append({k:b.get(k) for k in ('id','username','telegram_id','gizmo_user_id','host_id','mode','duration_kind','status','starts_at','ends_at','hold_until','message','for_friend','instant','protocol')}|{'code':record.get('code') if b['status']=='holding' and time.time()-record.get('code_at',0)<180 else None})
                    self.online=True;self.error=' · '.join(self.controller.errors)
            except Exception as error:
                with self.lock:self.online=False;self.error=str(error)[:220]
            # Only an actual new booking alert may trigger a tray popup.
            cursor=max((int(k) for k in self.store.get('alerts',{}) if str(k).isdigit()),default=0)
            if self.tray and self.store.get('alerts',{}) and cursor>self.notified_cursor:
                try:self.tray.notify('Новая бронь или ситуация, требующая внимания. Откройте панель клуба.','1SHOT Desk')
                except Exception:pass
                self.notified_cursor=cursor
            if self.store.get('alerts',{}) and time.time()>self.muted_until and time.time()-last_alarm>self.sound.settings['repeat'] and self.sound.settings['enabled']:
                self.alarm();last_alarm=time.time()
            self.stop.wait(2)
    def sync_loop(self):
        while not self.stop.is_set():
            try:self.bridge.sync();self.host_rows=self.bridge.host_rows;self.last_sync=time.time();self.sync_error='';self.bridge.auth()
            except Exception as error:self.sync_error=str(error)[:180]
            self.stop.wait(5)
    def reveal(self,*_):self.window.show();self.window.restore()
    def close(self):
        if self.exiting:return True
        self.window.hide();return False
    def quit(self,*_):
        if self.exiting or not self.exit_prompt.acquire(blocking=False):return
        try:
            import ctypes
            if sys.platform=='win32' and ctypes.windll.user32.MessageBoxW(None,'Завершить работу агента? Активные сессии продолжатся, но новые команды и автоматическое снятие броней остановятся до следующего запуска.','1SHOT Desk',0x24)!=6:return
            self.exiting=True;self.stop.set();self.sound.stop()
            # Never let a tray callback's stop/join prevent Qt from receiving destroy.
            self.window.destroy()
            if self.tray:threading.Thread(target=self.tray.stop,daemon=True).start()
        finally:self.exit_prompt.release()
    def started(self):
        import pystray
        from PIL import Image
        icon=Image.open(ROOT/'desktop'/'assets'/'tray-icon.png').convert('RGBA')
        self.tray=pystray.Icon('1SHOT',icon,f'1SHOT Desk v{VERSION} · {AUTHOR}',pystray.Menu(pystray.MenuItem('Открыть',self.reveal,default=True),pystray.MenuItem('Выход',self.quit)))
        threading.Thread(target=self.tray.run,daemon=True).start()
        threading.Thread(target=self.work,daemon=True).start();threading.Thread(target=self.sync_loop,daemon=True).start()

def main():
    if not getattr(sys,'frozen',False):
        from .write_metadata import main as prepare
        prepare()
    from dotenv import load_dotenv
    load_dotenv(HOME/'.env')
    required=('GIZMO_BASE_URL','GIZMO_LOGIN','GIZMO_PASSWORD','SUPABASE_URL','AGENT_SECRET')
    missing=[key for key in required if not os.getenv(key)]
    if missing:
        message='Заполните '+str(HOME/'.env')+'\nНе заданы: '+', '.join(missing)
        if sys.platform=='win32':
            import ctypes
            ctypes.windll.user32.MessageBoxW(None,message,'Настройка 1SHOT Desk',0x10)
        else:print(message)
        return
    # Prevent two local instances from sharing the ownership journal.
    handle=open(HOME/'desk.lock','a+b');handle.write(b'0');handle.flush();handle.seek(0)
    try:
        if sys.platform=='win32':
            import msvcrt
            msvcrt.locking(handle.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except OSError:raise SystemExit('1SHOT Desk уже запущен — откройте его из трея')
    import webview
    if sys.platform=='win32':
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
    app=App();app.window=webview.create_window(APP_TITLE,str(ROOT/'desktop'/'index.html'),js_api=app,width=1120,height=760,min_size=(900,600),frameless=True,easy_drag=False,background_color='#000000')
    app.window.events.closing+=app.close
    webview.start(app.started,gui='qt',debug=False,icon=str(ROOT/'desktop'/'assets'/'app.ico'))
    handle.close()

if __name__=='__main__':main()
