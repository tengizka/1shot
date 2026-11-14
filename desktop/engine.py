"""Safety-first club controller. No /reservations calls and no forced logout.
Windows UI is separate; this module is testable without Gizmo or Qt/WebView.
"""
from __future__ import annotations
from contextlib import contextmanager
import json
import os
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

TERMINAL = {'cancelled', 'expired', 'completed'}

def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()

class Store:
    def __init__(self, path):
        self.path = str(path)
        with self.connect() as db:
            db.execute('create table if not exists state(key text primary key, value text not null)')
    @contextmanager
    def connect(self):
        db=sqlite3.connect(self.path,timeout=10)
        try:
            db.execute('pragma synchronous=FULL')
            with db:yield db
        finally:db.close()
    def get(self,key,default=None):
        with self.connect() as db: row=db.execute('select value from state where key=?',(key,)).fetchone()
        return json.loads(row[0]) if row else default
    def set(self,key,value):
        with self.connect() as db: db.execute('insert into state values(?,?) on conflict(key) do update set value=excluded.value',(key,json.dumps(value)))

class UnsafeOperation(RuntimeError): pass


def lock_lead():
    try:return max(0.0,float(os.getenv('BOOKING_LOCK_HOURS','2')))*3600
    except ValueError:return 7200.0

class Controller:
    def __init__(self, cloud, gizmo, store, clock=time.time):
        self.cloud,self.gizmo,self.store,self.clock=cloud,gizmo,store,clock
        self.lease_until=0
        self.lease_mono=0
        self.rows=[]
        self.errors=[]
    def guard(self):
        if getattr(self,'stopping',lambda:False)():raise UnsafeOperation('Агент завершает работу')
        if self.clock()+10>=self.lease_until or time.monotonic()+10>=self.lease_mono: raise UnsafeOperation('Lease панели истёк; действия Gizmo остановлены')
    def transition(self,b,status,message='',code=None):
        self.guard()
        return self.cloud.transition(b['id'],b['status'],status,message,code)
    def attention(self,b,message):
        if b['status']!='attention':self.transition(b,'attention',message)
    def fresh_host(self,b):
        self.guard()
        hosts=self.gizmo.hosts()
        h=next((h for h in hosts if str(h.get('number'))==str(b['host_id']) and not h.get('isDeleted')),None)
        if not h: raise UnsafeOperation('Компьютер не найден в Gizmo')
        if str(h['number'])=='1' and not b.get('instant'): raise UnsafeOperation('PS5 — бронь только по телефону')
        return h
    def sessions(self,h):
        self.guard()
        return [s for s in self.gizmo.sessions() if str(s.get('hostId'))==str(h['id'])]
    def release(self,b,record,h):
        if not record or record.get('phase') not in ('locked','release_sent'):
            raise UnsafeOperation('Нет доказательства, что блокировку поставило наше приложение')
        if self.sessions(h): raise UnsafeOperation('ПК занят: состояние не меняем')
        if h.get('state')==0:
            record['phase']='released';self.store.set('booking:'+b['id'],record);return True
        if h.get('state')!=2 or not record.get('stamp') or h.get('modifiedTime')!=record['stamp']:
            raise UnsafeOperation('Состояние ПК изменено извне. Автоснятие блокировки запрещено')
        record['phase']='release_sent';self.store.set('booking:'+b['id'],record)
        self.guard();self.gizmo.lock(h['id'],False)
        after=self.gizmo.host(h['id'])
        if after.get('state')!=0: raise UnsafeOperation('Gizmo не подтвердил снятие блокировки')
        record.update(phase='released',stamp=after.get('modifiedTime'))
        self.store.set('booking:'+b['id'],record);return True
    def step_ps5(self,b,now):
        # PS5 has no Gizmo client to lock: the booking is a reservation the admin sees in Desk.
        if b['status']=='attention':return
        if b['status'] not in ('requested','waiting','holding','cancel_requested'):
            self.attention(b,'TV-зона PS5: вход через Gizmo не выполняется. Проверьте зону вручную');return
        if b['status']=='cancel_requested' or now>=timestamp(b['hold_until']):
            self.transition(b,'cancelled' if b['status']=='cancel_requested' else 'expired','Бронь TV-зоны завершена');return
        if b['status'] in ('requested','waiting') and now>=timestamp(b['starts_at']):
            self.transition(b,'holding','TV-зона PS5 ждёт тебя')
    def own_session(self,b,sessions):
        uid=b.get('gizmo_user_id')
        return bool(uid) and any(int(s.get('userId',-1))==int(uid) for s in sessions)
    def settled_in_club(self,b,record,now):
        """A booking changed by hand in the club (Gizmo, admin, the guest sat down): close it cleanly
        instead of leaving it for review. Only clear cases; anything unclear keeps the old safe rules."""
        status=b['status']
        if status not in ('requested','waiting','holding','checkin_pending','attention'):return False
        phase=(record or {}).get('phase')
        if status=='attention' and not record:
            # Nothing of ours on the PC: once the hold time is over the booking simply ends.
            if now>=timestamp(b['hold_until']):self.transition(b,'expired','Время брони вышло');return True
            return False
        if not record:
            # Before our lock: only the guest sitting down early is certain.
            if status in ('requested','waiting') and b.get('gizmo_user_id') and now>=timestamp(b['starts_at'])-lock_lead():
                h=self.fresh_host(b)
                if self.own_session(b,self.sessions(h)):
                    self.store.set('booking:'+b['id'],{'phase':'session','host_id':h['id']})
                    self.transition(b,'in_session','Гость за ПК');return True
            return False
        if phase not in ('locked','released'):return False
        h=self.fresh_host(b);sessions=self.sessions(h)
        if sessions:
            key='booking:'+b['id']
            if self.own_session(b,sessions):
                record['phase']='session';self.store.set(key,record)
                self.transition(b,'in_session','Гость за ПК');return True
            record['phase']='released';self.store.set(key,record)
            if b.get('admin_created') and not b.get('gizmo_user_id'):
                self.transition(b,'completed','Гость сел за ПК');return True
            self.transition(b,'cancelled','ПК занял другой гость в клубе');return True
        if phase=='locked' and h.get('state')==0:
            # The admin unlocked the PC in Gizmo: that is the booking taken off in the club.
            record['phase']='released';self.store.set('booking:'+b['id'],record)
            self.transition(b,'cancelled','Бронь снята в клубе');return True
        if status=='attention' and phase=='released' and now>=timestamp(b['hold_until']):
            self.transition(b,'expired','Время брони вышло');return True
        return False
    def step(self,b):
        now=self.clock();key='booking:'+b['id'];record=self.store.get(key)
        if b['status'] in TERMINAL: return
        # PS5: a direct login from Desk goes the normal way (Gizmo starts the session); bookings stay phone-only.
        if str(b['host_id'])=='1' and not b.get('instant'): return self.step_ps5(b,now)
        # Verify an already-sent login before handling expiry: never replay the POST.
        if record and record.get('phase')=='login_sent':
            h=self.fresh_host(b);sessions=self.sessions(h)
            if any(int(s.get('userId',-1))==int(b['gizmo_user_id']) for s in sessions):
                if self.transition(b,'in_session','Вход подтверждён активной сессией Gizmo'):
                    record['phase']='session';self.store.set(key,record)
            elif now-record['sent_at']>15:
                self.attention(b,'Результат входа неизвестен. Не повторяем команду; проверьте ПК вручную')
            return
        if b['status']=='in_session':
            h=self.fresh_host(b);sessions=self.sessions(h)
            if any(int(s.get('userId',-1))==int(b['gizmo_user_id']) for s in sessions):
                if record:record.pop('empty_since',None);self.store.set(key,record)
                return
            record=record or {};empty_since=record.setdefault('empty_since',now);self.store.set(key,record)
            if now-empty_since>=10:self.transition(b,'completed','Сессия завершена')
            return
        if self.settled_in_club(b,record,now):return
        if b['status']=='attention':return  # Anything not settled above still needs a person.
        if b['status']=='release_requested':
            arrived=b.get('admin_created') and not b.get('gizmo_user_id')
            if not b.get('for_friend') and not arrived:raise UnsafeOperation('Разблокировка без входа разрешена только для друга')
            if arrived and not record:
                # «Гость пришёл» before our lock was set: nothing to unlock, the booking simply ends.
                self.transition(b,'completed','Гость пришёл');return
            h=self.fresh_host(b)
            if not record or record.get('phase')!='released':self.release(b,record,h)
            self.transition(b,'completed','Гость пришёл, ПК разблокирован' if arrived else 'ПК разблокирован. Друг входит в свой аккаунт с компьютера')
            return
        due=now>=timestamp(b['starts_at'])
        expired=now>=timestamp(b['hold_until'])
        if b['status']=='cancel_requested' or expired:
            if not record and b['status'] in ('holding','checkin_pending','cancel_requested'):
                h=self.fresh_host(b)
                if h.get('state')!=0:raise UnsafeOperation('Журнал отсутствует, состояние ПК требует ручной проверки')
            if record and record.get('phase') not in ('released','session'):
                h=self.fresh_host(b);self.release(b,record,h)
            self.transition(b,'cancelled' if b['status']=='cancel_requested' else 'expired','Бронь завершена; чужие блокировки не снимались')
            return
        # The PC is locked ahead of time: BOOKING_LOCK_HOURS (default 2) before the booked start.
        if now<timestamp(b['starts_at'])-lock_lead():return
        h=self.fresh_host(b)
        if b.get('instant') and not record and b['status'] in ('requested','waiting','checkin_pending'):
            if b.get('for_friend'):raise UnsafeOperation('Прямой вход разрешён только в свой аккаунт')
            if h.get('state')!=0 or self.sessions(h):raise UnsafeOperation('ПК уже занят или заблокирован. Вход отменён')
            self.gizmo.user(b['gizmo_user_id'])
            if any(int(s.get('userId',-1))==int(b['gizmo_user_id']) for s in self.gizmo.sessions()):
                raise UnsafeOperation('Аккаунт уже играет. Перенос сессии запрещён')
            if b['status']!='checkin_pending':
                if not self.transition(b,'checkin_pending','Выполняем прямой вход'):return
                b['status']='checkin_pending'
            # Fresh read immediately before the POST. Gizmo exposes no atomic CAS login.
            self.guard();current=self.gizmo.host(h['id'])
            if current.get('state')!=0 or self.sessions(h):raise UnsafeOperation('ПК заняли во время подготовки входа')
            if any(int(s.get('userId',-1))==int(b['gizmo_user_id']) for s in self.gizmo.sessions()):
                raise UnsafeOperation('Аккаунт уже вошёл на другой ПК')
            self.store.set(key,{'phase':'login_sent','host_id':h['id'],'sent_at':now,'direct':True})
            self.guard();self.gizmo.login(b['gizmo_user_id'],h['id'])
            return
        if b['status'] in ('requested','waiting'):
            if b.get('instant') and any(int(s.get('userId',-1))==int(b['gizmo_user_id']) for s in self.gizmo.sessions()):
                raise UnsafeOperation('Аккаунт уже играет. Перенос сессии запрещён')
            if record:
                # A crash after intent was persisted but before confirmation is ambiguous.
                if record.get('phase')=='locked' and h.get('state')==2 and h.get('modifiedTime')==record.get('stamp'):
                    code=record.get('code');self.transition(b,'holding','ПК заблокирован и ждёт гостя',code);return
                raise UnsafeOperation('Незавершённая операция блокировки. Нужна ручная проверка')
            if (self.sessions(h) or h.get('state')!=0) and not due:
                # Someone still plays (or the admin holds it): wait, the lock comes once it frees up.
                if b['status']!='waiting':self.transition(b,'waiting','ПК пока занят: заблокируем, как только освободится')
                return
            if self.sessions(h):
                self.transition(b,'cancelled','ПК занят. Бронь отменена без вмешательства в игру')
                return
            if h.get('state')!=0:raise UnsafeOperation('ПК заблокирован или выключен администратором. Не меняем состояние')
            if not h.get('modifiedTime'):raise UnsafeOperation('Gizmo не отдаёт modifiedTime: безопасное владение блокировкой не подтверждено')
            record={'phase':'lock_sent','host_id':h['id'],'sent_at':now}
            self.store.set(key,record)
            self.guard();self.gizmo.lock(h['id'],True)
            after=self.gizmo.host(h['id'])
            if after.get('state')!=2 or not after.get('modifiedTime'):raise UnsafeOperation('Gizmo не подтвердил блокировку')
            if after['modifiedTime']==h.get('modifiedTime'):
                raise UnsafeOperation('Gizmo не обновил modifiedTime после блокировки. Нужна ручная проверка')
            code=None if b.get('protocol',1)>=2 else f'{secrets.randbelow(1000000):06d}'
            record.update(phase='locked',stamp=after['modifiedTime'],code=code,code_at=now)
            self.store.set(key,record)
            self.transition(b,'checkin_pending' if b.get('instant') else 'holding','Подключаем аккаунт' if b.get('instant') else 'ПК заблокирован и ждёт вас',code)
        elif b['status']=='holding':
            if not record or record.get('phase')!='locked' or h.get('state')!=2 or h.get('modifiedTime')!=record.get('stamp'):
                raise UnsafeOperation('Блокировка не совпадает с локальным журналом')
            if b.get('protocol',1)>=2:
                if b.get('instant') and not b.get('for_friend'):self.transition(b,'checkin_pending','Подключаем ваш аккаунт')
                return
            if now-record.get('code_at',0)>150:
                record.update(code=None if b.get('protocol',1)>=2 else f'{secrets.randbelow(1000000):06d}',code_at=now)
                self.store.set(key,record);self.transition(b,'holding','Новый код присутствия в панели клуба',record['code'])
        elif b['status']=='checkin_pending':
            if b.get('for_friend'):raise UnsafeOperation('Для друга разрешена только разблокировка без входа')
            if self.sessions(h):raise UnsafeOperation('На ПК уже есть сессия. Вход не выполняется')
            if not record or record.get('phase')!='locked':raise UnsafeOperation('Нет подтверждённой собственной блокировки')
            self.gizmo.user(b['gizmo_user_id'])
            self.guard()
            if any(int(s.get('userId',-1))==int(b['gizmo_user_id']) for s in self.gizmo.sessions()):
                raise UnsafeOperation('Аккаунт уже играет на другом ПК. Автоматический перенос запрещён')
            self.release(b,record,h)
            # Re-check after unlocking. A manual login racing here cannot be made atomic
            # by this API; a conflict is never resolved by logging someone out.
            if self.sessions(h):raise UnsafeOperation('ПК заняли во время подготовки входа')
            self.guard()
            if any(int(s.get('userId',-1))==int(b['gizmo_user_id']) for s in self.gizmo.sessions()):
                raise UnsafeOperation('Аккаунт уже вошёл на другой ПК')
            record.update(phase='login_sent',sent_at=now);self.store.set(key,record)
            self.guard();self.gizmo.login(b['gizmo_user_id'],h['id'])
    def tick(self):
        started=self.clock();mono=time.monotonic()
        snapshot=self.cloud.snapshot(self.store.get('event_cursor',0))
        self.lease_until=started+snapshot.get('lease_seconds',0)
        self.lease_mono=mono+snapshot.get('lease_seconds',0)
        self.rows=snapshot['bookings']
        alerts=self.store.get('alerts',{})
        instant_ids={b['id'] for b in self.rows if b.get('instant')}
        # The admin made these bookings in Desk himself: no «new booking» toast or sound for them (problems still alert).
        admin_ids={b['id'] for b in self.rows if b.get('admin_created')}
        quiet=lambda e:e.get('instant') or e.get('booking_id') in instant_ids or (e.get('kind')=='created' and e.get('booking_id') in admin_ids)
        alerts={key:event for key,event in alerts.items() if event.get('kind') in ('created','attention','waiting') and not quiet(event)}
        for event in snapshot.get('events',[]):
            if not quiet(event) and event['kind'] in ('created','attention','waiting'):
                alerts[str(event['id'])]=event
            self.store.set('alerts',alerts)
            self.store.set('event_cursor',event['id'])
        self.store.set('alerts',alerts)
        self.errors=[]
        for b in self.rows:
            try:self.step(b)
            except Exception as error:
                self.errors.append(f"ПК {b['host_id']}: {type(error).__name__}: {str(error)[:200]}")
                # Preserve phase in journal for recovery. Do not unlock or replay.
                try:self.attention(b,str(error)[:200])
                except Exception:pass
        return snapshot
