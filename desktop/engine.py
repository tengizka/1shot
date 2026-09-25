"""Safety-first club controller. No /reservations calls and no forced logout.
Windows UI is separate; this module is testable without Gizmo or Qt/WebView.
"""
from __future__ import annotations
from contextlib import contextmanager
import json
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
        if str(h['number'])=='1': raise UnsafeOperation('PS5 — только по телефону')
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
    def step(self,b):
        now=self.clock();key='booking:'+b['id'];record=self.store.get(key)
        if b['status'] in TERMINAL: return
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
        if b['status']=='attention':return  # Requires physical review; never guess ownership.
        if b['status']=='release_requested':
            if not b.get('for_friend'):raise UnsafeOperation('Разблокировка без входа разрешена только для друга')
            h=self.fresh_host(b)
            if not record or record.get('phase')!='released':self.release(b,record,h)
            self.transition(b,'completed','ПК разблокирован. Друг входит в свой аккаунт с компьютера')
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
        if not due:return
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
        alerts={key:event for key,event in alerts.items() if event.get('kind') in ('created','attention','waiting') and not event.get('instant') and event.get('booking_id') not in instant_ids}
        for event in snapshot.get('events',[]):
            if not event.get('instant') and event.get('booking_id') not in instant_ids and event['kind'] in ('created','attention','waiting'):
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
