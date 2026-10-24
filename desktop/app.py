"""Run: python -m desktop.app (Windows 10/11 + bundled Qt WebEngine)."""
import os
import sys
import threading
import time
import types
from pathlib import Path
from .engine import Controller,Store
from .accounts import Accounts
from .registration_approval import RegistrationApproval
from .guest_passwords import GuestPasswords
from .food import Food
from .polling import PollBudget
from .sound import Sound
from .notifications import NotificationGate
from .rentals import Rentals,ITEMS as RENTAL_ITEMS
from .test_accounts import TestAccounts
from .services import ApiError,Cloud,Gizmo,LegacyBridge
from .toast import Toaster,describe
from .updater import Updater
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
        self.food=Food(self.cloud,self.gizmo,self.store,lambda:{r['host_id']:r['gizmo_host_id'] for r in self.host_rows},rentals=types.SimpleNamespace(add=lambda *a:self._locked(lambda:self.rentals.add(*a))))
        self.password_grants=[];self.password_ready=False
        self.registrations=[];self.registration_ready=False
        self.sound=Sound(HOME,self.store);self.host_rows=[];self.password_requests=[];self.protocol_ready=False;self.maximized=False
        self.cloud.host_source=lambda:self.host_rows if self.last_sync and time.time()-self.last_sync<15 else None
        self.online=False;self.error='Подключение…';self.sync_error='';self.last_sync=0
        self.notifications=NotificationGate(self.store)
        self.rentals=Rentals(self.store)
        self.tests=TestAccounts(self.cloud,self.gizmo)
        self.rows=[];self.alerts={};self.notified_cursor=0;self.muted_until=0;self.window=None;self.tray=None;self.exiting=False
        self.toaster=None;self.updater=Updater(HOME,VERSION)
    def alarm(self,kind=None):self.sound.play(kind)
    def sound_settings(self,settings):return self.sound.configure(settings)
    def toast(self,kind,title,text):
        # One-shot on-screen notice in the 1SHOT style; the tray balloon is only a fallback.
        from datetime import datetime,timezone,timedelta
        stamp=(datetime.now(timezone.utc)+timedelta(hours=3)).strftime('%H:%M')+' МСК'
        try:
            if getattr(self,'toaster',None):self.toaster.show(kind,title,text,stamp);return
        except Exception:pass
        if getattr(self,'tray',None):
            try:self.tray.notify(text[:200],title[:60])
            except Exception:pass
    def update_loop(self):
        if self.stop.wait(30):return
        while True:
            try:
                if self.updater.snapshot()['phase'] in ('downloading','ready','installing'):raise StopIteration
                state=self.updater.check()
                if state.get('phase')=='available' and self.store.get('update.notified')!=state.get('latest'):
                    self.store.set('update.notified',state.get('latest'))
                    self.toast('update','Версия '+str(state.get('latest')),'Настройки → Обновление')
            except (Exception,StopIteration):pass
            if self.stop.wait(6*3600):return
    def host_info(self,host):
        """Who plays on this PC: profile, balance and time left from Gizmo. Read-only."""
        try:
            sessions=[x for x in self.gizmo.sessions() if str(x.get('hostNumber'))==str(host)]
            if not sessions:return {'free':True}
            s=sessions[0];uid=int(s['userId']);user=self.gizmo.user(uid)
            balance=self.gizmo.request('GET',f'users/{uid}/balance')
            if not isinstance(balance,dict) or balance.get('userId')!=uid:balance={}
            number=lambda v:v if isinstance(v,(int,float)) and not isinstance(v,bool) else None
            return {'user_id':uid,'username':user.get('username'),'first_name':user.get('firstName'),'last_name':user.get('lastName'),
                    'phone':user.get('mobilePhone') or user.get('phone'),'email':user.get('email'),'group':s.get('userGroupName'),
                    'balance':number(balance.get('balance')),'available_time':number(balance.get('availableTime')),
                    'span':number(s.get('span')),'last_login':s.get('lastLogin')}
        except Exception:return {'error':'Gizmo не ответил. Попробуйте ещё раз'}
    def lock_host(self,host,locked):
        try:
            host=str(host)
            if any(b['host_id']==host and b['status'] not in ('cancelled','expired','completed') for b in self.rows):return {'error':'На ПК есть бронь: блокировкой управляет бронь'}
            row=next((h for h in self.host_rows if h['host_id']==host),None)
            if not row:return {'error':'ПК не найден в Gizmo'}
            with self.operations:
                if locked and any(str(x.get('hostNumber'))==host for x in self.gizmo.sessions()):return {'error':'На ПК идёт игра'}
                self.gizmo.lock(int(row['gizmo_host_id']),bool(locked))
                self.host_rows=self.bridge.collect_hosts();self.last_sync=time.time()
            return {'ok':True}
        except Exception as error:return {'error':str(error)[:160] or 'Gizmo не подтвердил блокировку'}
    def test_accounts(self):
        try:return {'ok':True,'accounts':self.tests.list()}
        except Exception as error:return {'error':str(error)[:160] or 'Не удалось получить список'}
    def delete_test_account(self,uid):
        try:
            with self.operations:return self.tests.delete(uid)
        except Exception as error:return {'error':str(error)[:160] or 'Не удалось удалить аккаунт'}
    def _locked(self,fn):
        # Food reads and adds rentals under the same lock as the Desk buttons.
        with self.lock:return fn()
    def add_rental(self,item,host=None,who='',user_id=None):
        try:
            with self.lock:return {'ok':True,'rental':self.rentals.add(item,host,who,user_id)}
        except ValueError as error:return {'error':str(error)}
    def return_rental(self,rental_id):
        try:
            with self.lock:return {'ok':self.rentals.returned(rental_id)}
        except ValueError as error:return {'error':str(error)}
    def logout_host(self,host,user_id):
        # Ends the player's Gizmo session on this PC; only if that player is still the one on it.
        try:
            with self.operations:
                sessions=[x for x in self.gizmo.sessions() if str(x.get('hostNumber'))==str(host)]
                if not sessions or int(sessions[0].get('userId',-1))!=int(user_id):return {'error':'На ПК уже другой гость. Обновите данные'}
                self.gizmo.request('POST',f'users/{int(user_id)}/logout')
                self.host_rows=self.bridge.collect_hosts();self.last_sync=time.time()
            return {'ok':True}
        except Exception as error:return {'error':str(error)[:160] or 'Gizmo не подтвердил выход'}
    def copy_text(self,text):
        # Clipboard fallback for the Qt web view: Windows clip.exe understands UTF-16 with BOM.
        try:
            text=str(text)[:500]
            if sys.platform=='win32':
                import subprocess
                subprocess.run(['clip'],input=text.encode('utf-16'),check=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0),timeout=5)
                return {'ok':True}
            return {'error':'Буфер обмена недоступен'}
        except Exception:return {'error':'Не удалось скопировать'}
    def preview_sound(self,preset):
        try:self.sound.play_preset(preset);return {'ok':True}
        except ValueError as error:return {'error':str(error)}
    def check_update(self):
        try:return self.updater.check()
        except Exception:return {'phase':'error','error':'Не удалось проверить обновления'}
    def download_update(self):
        state=self.updater.snapshot()
        if state['phase']=='downloading':return state
        threading.Thread(target=self.updater.download,daemon=True).start()
        return dict(state,phase='downloading',progress=0)
    def install_update(self):
        try:
            if self.updater.snapshot()['phase']!='ready':return {'error':'Обновление ещё не скачано'}
            self.updater.launch()
        except Exception as error:return {'error':str(error) or 'Не удалось запустить установщик'}
        # The installer replaces the files and starts Desk again; stop the agent cleanly first.
        threading.Timer(0.6,self.quit,kwargs={'confirmed':True}).start()
        return {'ok':True}
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
                result=self.registration.reject(id,confirmed)
                if isinstance(result,dict) and result.get('ok'):
                    row=next((r for r in self.registrations if r.get('id')==id),{})
                    self.registration.remember(id,row.get('public_data') or {},'rejected')
                return result
        except Exception:return {'error':'Не удалось подтвердить отклонение анкеты'}
    def promo_codes(self):
        try:
            with self.operations:return {'codes':self.registration.promo_codes()}
        except Exception:return {'error':'Не удалось получить промокоды. Проверьте связь'}
    def register_guest(self,request_id,data,code=None,confirmed=False):
        try:
            with self.operations:
                self.renew_account_lease()
                return self.registration.register_at_desk(request_id,data,code,confirmed)
        except Exception as error:return {'error':str(error) if isinstance(error,ApiError) else 'Регистрация не выполнена. Проверьте связь'}
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
    def reset_password(self,id,username,password,confirmed=False,privileged=False):
        # Staff reset without a guest request: identity checked in person, Gizmo verifies the new password.
        try:
            if confirmed is not True:return {'error':'Подтвердите, что личность проверена'}
            with self.operations:
                self.renew_account_lease()
                self.accounts.reset(int(id),username,password,None,admin=True,privileged_confirmed=privileged is True)
            return {'ok':True}
        except Exception as error:return {'error':str(error)[:200] or 'Смена пароля не подтверждена'}
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
    def seat_guest(self, booking_id, host_id, user_id=None):
        try:
            with self.operations:
                if user_id:
                    self.accounts.login(int(user_id), int(host_id))
                return {'ok': True}
        except Exception as e:
            return {'error': str(e)}

    def snapshot(self):
        with self.lock:
            return {'rentals':self.rentals.list(),'rental_history':self.rentals.history()[-200:],'rental_items':RENTAL_ITEMS,'password_grants':self.password_grants,'password_ready':self.password_ready and self.online,'registrations':self.registrations,'registration_history':self.registration.history()[:100],'registration_ready':self.registration_ready and self.online,'password_sync_error':'Статус заявки на пароль изменился: требуется сверка с сервером' if any(v.get('conflict') for v in self.store.get('password-outcomes',{}).values()) else '', 'backend_label':getattr(self.cloud,'label','Сервер'),'online':self.online,'error':' · '.join(x for x in (self.error,'Еда: '+self.food.error if self.food.error else '') if x),'food':dict(self.food.status),'sync_error':self.sync_error,'last_sync':self.last_sync,'rows':self.rows,'alerts':len(self.store.get('alerts',{})),'update':self.updater.snapshot(),'version':VERSION,'muted':time.time()<self.muted_until,'sound':self.sound.settings,'hosts':self.host_rows,'password_requests':self.password_requests,'protocol_ready':self.protocol_ready}
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
                    for event in notices[-3:]:self.toast(*describe(event,self.rows))
                    if self.sound.settings['enabled']:
                        kind='attention' if any(e.get('kind')=='attention' for e in notices) else notices[-1].get('kind')
                        self.alarm(kind)
            except Exception:
                # Notification failure must never stop reservation processing.
                pass
            delay=budget.interval(self.rows,failed)
            self.stop.wait(max(1,delay-(time.monotonic()-started)))
    def food_loop(self):
        # Food orders run beside bookings: a slow menu refresh never delays the booking loop.
        while not self.stop.wait(8):
            if not self.online or os.getenv('FOOD_ENABLED','true').lower()!='true':continue
            try:self.food.tick(self.gizmo.sessions())
            except Exception as error:self.food.error=str(error)[:160]
    def sync_loop(self):
        while not self.stop.is_set():
            try:self.host_rows=self.bridge.collect_hosts();self.last_sync=time.time();self.sync_error=''
            except Exception as error:self.sync_error=str(error)[:180]
            self.stop.wait(5)
    def reveal(self,*_):self.window.show();self.window.restore()
    def close(self):
        if self.exiting:return True
        self.window.hide();return False
    def quit(self,*_,confirmed=True):
        # Desk asks inside its own window (two-tap button); no system message boxes.
        if self.exiting or not self.exit_prompt.acquire(blocking=False):return
        try:
            self.exiting=True;self.stop.set();self.sound.stop()
            if getattr(self,'toaster',None):self.toaster.close_all()
            # Never let a tray callback's stop/join prevent Qt from receiving destroy.
            self.window.destroy()
            if self.tray:threading.Thread(target=self.tray.stop,daemon=True).start()
        finally:self.exit_prompt.release()
    def started(self):
        import pystray
        from PIL import Image
        icon=Image.open(ROOT/'desktop'/'assets'/'tray-icon.png').convert('RGBA')
        self.tray=pystray.Icon('1SHOT',icon,f'1SHOT Desk v{VERSION} · {AUTHOR}',pystray.Menu(pystray.MenuItem('Открыть',self.reveal,default=True),pystray.MenuItem('Выход',lambda *_:self.quit())))
        threading.Thread(target=self.tray.run,daemon=True).start()
        import webview
        def factory(html,x,y,width,height):
            return webview.create_window('1SHOT',html=html,x=x,y=y,width=width,height=height,min_size=(width,height),resizable=False,frameless=True,easy_drag=False,shadow=False,focus=False,on_top=True,background_color='#000000')
        def screen():
            s=webview.screens[0] if webview.screens else None
            return (s.width,s.height) if s else (1920,1080)
        self.toaster=Toaster(factory,screen,ROOT)
        threading.Thread(target=self.update_loop,daemon=True).start()
        threading.Thread(target=self.work,daemon=True).start();threading.Thread(target=self.sync_loop,daemon=True).start();threading.Thread(target=self.food_loop,daemon=True).start()

def main():
    if not getattr(sys,'frozen',False):
        from .write_metadata import main as prepare
        prepare()
    from dotenv import load_dotenv
    load_dotenv(HOME/'.env')
    required=('GIZMO_BASE_URL','GIZMO_LOGIN','GIZMO_PASSWORD','AGENT_SECRET')
    # The installer drops env.example as .env: placeholders count as not filled in.
    missing=[key for key in required if not os.getenv(key) or 'YOUR-' in os.getenv(key,'')]
    if not (os.getenv('CLUB_API_URL') or (os.getenv('SUPABASE_URL') and 'YOUR-' not in os.getenv('SUPABASE_URL'))):missing.append('CLUB_API_URL (или SUPABASE_URL для старого сервера)')
    if missing:
        message='Заполните '+str(HOME/'.env')+'\nНе заданы: '+', '.join(missing)
        if sys.platform=='win32':
            import ctypes
            ctypes.windll.user32.MessageBoxW(None,message+'\n\nФайл откроется в Блокноте. Сохраните его и запустите Desk снова.','Настройка 1SHOT Desk',0x40)
            try:os.startfile(str(HOME/'.env')) if (HOME/'.env').exists() else None
            except OSError:pass
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
