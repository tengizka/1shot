"""Run: python -m desktop.app (Windows 10/11 + bundled Qt WebEngine)."""
import os
import sys
import threading
import time
from pathlib import Path
from .engine import Controller,Store
from .accounts import Accounts
from .registration_approval import RegistrationApproval
from .guest_passwords import GuestPasswords
from .polling import PollBudget
from .sound import Sound
from .notifications import NotificationGate
from .reminders import Reminders
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
        self.bridge.guard=self.controller.guard
        self.accounts=Accounts(self.gizmo,self.cloud,self.store,self.controller.guard)
        self.registration=RegistrationApproval(self.cloud,self.gizmo,self.store,self.controller.guard)
        self.guest_passwords=GuestPasswords(self.cloud,self.gizmo,self.store,self.controller.guard)
        self.password_grants=[];self.password_ready=False
        self.registrations=[];self.registration_ready=False
        self.sound=Sound(HOME,self.store);self.host_rows=[];self.password_requests=[];self.protocol_ready=False;self.maximized=False
        self.cloud.host_source=lambda:self.host_rows if self.last_sync and time.time()-self.last_sync<15 else None
        self.online=False;self.error='Подключение…';self.sync_error='';self.last_sync=0
        self.notifications=NotificationGate(self.store)
        self.reminders=None;self.reminder_error=''
        try:self.reminders=Reminders(self.store)
        except Exception:self.reminder_error='Не удалось прочитать напоминания. Настройки сохранены без изменений'
        self.rows=[];self.alerts={};self.notified_cursor=0;self.muted_until=0;self.window=None;self.tray=None;self.exiting=False
    def alarm(self,kind=None):self.sound.play(kind)
    def sound_settings(self,settings):return self.sound.configure(settings)
    def reminder_settings(self,items,revision):
        if not self.reminders:return {'error':self.reminder_error}
        try:return {'ok':True, 'reminders':self.reminders.configure(items,revision)}
        except ValueError as error:return {'error':str(error)}
        except Exception:return {'error':'Не удалось сохранить напоминания. Проверьте локальное хранилище'}
    def preview_reminder(self,preset):
        from .sound import PRESETS
        if preset not in PRESETS:return {'error':'Неизвестный звук'}
        self.sound.play_preset(preset);return {'ok':True}
    def reminder_loop(self):
        while not self.stop.wait(1):
            if not self.reminders:continue
            try:
                events=self.reminders.tick()
                if events:
                    if self.tray:
                        try:self.tray.notify(' · '.join(e['text'] for e in events)[:240],'1SHOT · Напоминание')
                        except Exception:pass
                    audible=next((e for e in events if e['sound']!='none'),None)
                    if audible and self.sound.settings['enabled']:self.sound.play_preset(audible['sound'])
                self.reminder_error=''
            except Exception:self.reminder_error='Не удалось обработать напоминание. Проверьте локальное хранилище или звук'
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
    def approve_registration(self,id,confirmed=False):
        try:
            if confirmed is not True:return {'error':'Подтвердите очную проверку личности'}
            with self.operations:
                self.renew_account_lease()
                return self.registration.approve(id,confirmed)
        except Exception:return {'error':'Нет подтверждения результата. Не повторяйте создание; проверьте состояние анкеты'}
    def review_registration(self,id):
        try:
            with self.operations:
                self.renew_account_lease()
                return self.registration.review(id)
        except ValueError as error:return {'error':str(error)}
        except Exception:return {'error':'Сверка недоступна. Проверьте связь; аккаунт не менялся'}
    def reconcile_registration(self,id,proof_id,uid,confirmed=False):
        try:
            with self.operations:
                self.renew_account_lease()
                return self.registration.reconcile(id,proof_id,uid,confirmed)
        except ValueError as error:return {'error':str(error)}
        except Exception:return {'error':'Нет подтверждения завершения сверки. Повтор допускает только проверку того же результата, без создания аккаунта'}
    def reject_registration(self,id,confirmed=False):
        try:
            with self.operations:
                self.renew_account_lease()
                return self.registration.reject(id,confirmed)
        except Exception:return {'error':'Не удалось подтвердить отклонение анкеты'}
    def find_account(self,username):
        try:
            with self.operations:return {'user':self.accounts.find(username)}
        except Exception as error:return {'error':str(error)}
    def search_accounts(self,query):
        try:return self.accounts.directory.search(query)
        except Exception:return {'error':'Не удалось выполнить поиск. Проверьте связь с локальным сервером'}
    def select_account(self,id):
        try:return {'user':self.accounts.directory.get(int(id),fresh=True)}
        except Exception:return {'error':'Аккаунт недоступен. Повторите поиск'}
    def create_manual_booking(self,host,starts_at,guest_name,request_id):
        try:
            with self.operations:
                self.renew_account_lease()
                return self.cloud.desk('admin_booking',mode='reserve',host_id=str(host),starts_at=starts_at,guest_name=guest_name,request_id=request_id)
        except Exception as error:return {'error':str(error)}
    def login_account(self,host,id,username,request_id,booking_id=None,confirmed=False,privileged_confirmed=False):
        try:
            if confirmed is not True:raise ValueError('Подтвердите вход')
            with self.operations:
                user=self.accounts.directory.get(int(id),fresh=True)
                if user['username']!=username or user.get('isDisabled'):raise ValueError('Аккаунт изменён или отключён. Повторите поиск')
                if user['requires_privileged_confirmation'] and privileged_confirmed is not True:raise ValueError('Подтвердите работу со служебной группой')
                self.renew_account_lease()
                return self.cloud.desk('admin_booking',mode='login',host_id=str(host),gizmo_user_id=int(id),guest_name=username[:60],request_id=request_id,booking_id=booking_id)
        except Exception as error:return {'error':str(error)}
    def booking_guest(self,id):
        try:
            with self.operations:
                booking=next((b for b in self.controller.rows if b['id']==id),None)
                if not booking:return {'error':'Бронь уже завершена'}
                if booking.get('admin_created') and not booking.get('gizmo_user_id'):return {'user':{'firstName':booking.get('guest_name') or 'Гость без имени'},'telegram_id':None,'gizmo_user_id':None}
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
                user=self.accounts.directory.get(int(request['gizmo_user_id']),fresh=True)
                return {'user':user,'request_id':request['id']}
        except Exception as error:return {'error':str(error)}
    def resolve_password_request(self,id,outcome,confirmed=False):
        try:
            if outcome=='done':return {'error':'Заявка завершится после самостоятельной установки и проверки пароля владельцем'}
            if any(g.get('source_id')==id for g in getattr(self,'password_grants',[])):return {'error':'Для заявки уже выдано разрешение. Дождитесь результата владельца'}
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
    def reset_password_request(self,*args,**kwargs):
        return {'error':'Новый пароль вводит только владелец в мини-приложении. Выдайте разрешение по заявке'}
    def reset_password(self,*args,**kwargs):
        return {'error':'Пароль администратора не принимается. Владелец задаёт пароль самостоятельно'}
    def authorize_guest_password(self,source,id,uid,username,confirmed=False,privileged=False):
        try:
            with self.operations:
                self.renew_account_lease()
                return self.guest_passwords.authorize(source,id,uid,username,confirmed,privileged)
        except ValueError as error:return {'error':str(error)}
        except Exception:return {'error':'Разрешение не подтверждено. Проверьте состояние заявки; пароль не менялся'}
    def review_guest_password(self,id):
        try:
            with self.operations:
                self.renew_account_lease()
                return self.guest_passwords.review(id)
        except Exception:return {'error':'Нужен свежий успешный вход владельца после ошибки. Проверьте связь и конкретный аккаунт'}
    def resolve_guest_password(self,id,proof_id,uid,confirmed=False,privileged=False):
        try:
            with self.operations:
                self.renew_account_lease()
                return self.guest_passwords.resolve(id,proof_id,uid,confirmed,privileged)
        except Exception:return {'error':'Нет подтверждения сверки. Пароль повторно не устанавливался'}
    def snapshot(self):
        with self.lock:
            return {'reminders':self.reminders.snapshot() if self.reminders else None,'reminder_error':self.reminder_error,'password_grants':self.password_grants,'password_ready':self.password_ready and self.online,'registrations':self.registrations,'registration_ready':self.registration_ready and self.online,'password_sync_error':'Статус заявки на пароль изменился: требуется сверка с сервером' if any(v.get('conflict') for v in self.store.get('password-outcomes',{}).values()) else '', 'backend_label':getattr(self.cloud,'label','Сервер'),'online':self.online,'error':self.error,'sync_error':self.sync_error,'last_sync':self.last_sync,'rows':self.rows,'alerts':len(self.store.get('alerts',{})),'notifications':list(self.store.get('alerts',{}).values())[-5:],'muted':time.time()<self.muted_until,'sound':self.sound.settings,'hosts':self.host_rows,'password_requests':self.password_requests,'protocol_ready':self.protocol_ready}
    def acknowledge(self):
        with self.lock:self.store.set('alerts',{})
        self.sound.stop()
        return True
    def mute(self):self.muted_until=0 if time.time()<self.muted_until else time.time()+300;self.sound.stop();return True
    def test_sound(self,kind=None):
        if kind not in (None,'created','waiting','attention'):return False
        self.alarm(kind);return True
    def work(self):
        last_legacy=0;budget=PollBudget()
        while not self.stop.is_set():
            started=time.monotonic();failed=False
            try:
                with self.operations:
                    snapshot=self.controller.tick()
                    self.registration_ready='registrations' in snapshot.get('desk',{})
                    self.registrations=snapshot.get('desk',{}).get('registrations',[])
                    if self.registration_ready:self.registration.flush()
                    self.password_ready='password_grants' in snapshot.get('desk',{})
                    self.password_grants=snapshot.get('desk',{}).get('password_grants',[])
                    if self.password_ready:self.guest_passwords.tick(self.password_grants)
                    if snapshot.get("auth_pending"):self.bridge.auth()
                    if os.getenv("LEGACY_AUTH_ENABLED","false").lower()=="true" and time.monotonic()-last_legacy>=60:
                        last_legacy=time.monotonic();self.bridge.legacy_auth()
                    try:
                        self.accounts.tick(snapshot["desk"]);self.protocol_ready=True
                        self.password_requests=[{k:r.get(k) for k in ('id','gizmo_user_id','telegram_id','created_at')} for r in self.accounts.requests]
                    except Exception as error:
                        self.protocol_ready=False;self.controller.errors.append('Аккаунты: '+str(error))
                with self.lock:
                    self.rows=[]
                    for b in self.controller.rows:
                        record=self.store.get('booking:'+b['id'],{})
                        self.rows.append({k:b.get(k) for k in ('id','username','telegram_id','gizmo_user_id','host_id','mode','duration_kind','status','starts_at','ends_at','hold_until','message','for_friend','instant','protocol','admin_created','guest_name')}|{'code':record.get('code') if b['status']=='holding' and time.time()-record.get('code_at',0)<180 else None})
                    self.online=True;self.error=' · '.join(self.controller.errors)
            except Exception as error:
                failed=True
                with self.lock:self.online=False;self.protocol_ready=False;self.error=str(error)[:220]
            # Persist delivery before effects: reconnect/restart cannot replay audio.
            try:
                notices=self.notifications.consume(self.store.get('alerts',{}))
                if notices:
                    if self.tray:
                        try:self.tray.notify('Новое событие клуба. Подробности в панели.','1SHOT Desk')
                        except Exception:pass
                    if self.sound.settings['enabled']:
                        kind='attention' if any(e.get('kind')=='attention' for e in notices) else notices[-1].get('kind')
                        self.alarm(kind)
            except Exception:
                # Notification failure must never stop reservation processing.
                pass
            delay=budget.interval(self.rows,failed)
            self.stop.wait(max(1,delay-(time.monotonic()-started)))
    def sync_loop(self):
        while not self.stop.is_set():
            try:self.host_rows=self.bridge.collect_hosts();self.last_sync=time.time();self.sync_error=''
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
        threading.Thread(target=self.reminder_loop,daemon=True).start();threading.Thread(target=self.work,daemon=True).start();threading.Thread(target=self.sync_loop,daemon=True).start()

def main():
    if not getattr(sys,'frozen',False):
        from .write_metadata import main as prepare
        prepare()
    from dotenv import load_dotenv
    load_dotenv(HOME/'.env')
    required=('GIZMO_BASE_URL','GIZMO_LOGIN','GIZMO_PASSWORD','AGENT_SECRET')
    missing=[key for key in required if not os.getenv(key)]
    if not (os.getenv('CLUB_API_URL') or os.getenv('SUPABASE_URL')):missing.append('CLUB_API_URL (или SUPABASE_URL для старого сервера)')
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
