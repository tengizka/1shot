"""Local reminders. No club requests, catch-up queue or booking mutations."""
import copy
import re
import threading
import time
import uuid
from .sound import PRESETS

DEFAULT = [{'id': 'air-conditioners', 'text': 'Проверить кондиционеры',
            'minutes': 150, 'enabled': True, 'sound': 'soft'}]

class Reminders:
    def __init__(self, store, clock=time.monotonic, wall=time.time):
        self.store, self.clock, self.wall = store, clock, wall
        self.lock = threading.RLock()
        self.config = store.get('reminders.config', {'revision': 0, 'items': DEFAULT})
        if type(self.config.get('revision')) is not int or self.config['revision'] < 0:
            raise ValueError('Повреждена версия настроек')
        self.validate(self.config['items'])  # Fail closed on damaged settings; never overwrite them.
        self.history = store.get('reminders.history', [])
        self.due = {r['id']: clock() + r['minutes'] * 60 for r in self.config['items'] if r['enabled']}

    @staticmethod
    def validate(items):
        if not isinstance(items, list) or len(items) > 20:
            raise ValueError('Можно сохранить не больше 20 напоминаний')
        ids = set()
        for r in items:
            if not isinstance(r, dict) or set(r) != {'id', 'text', 'minutes', 'enabled', 'sound'}:
                raise ValueError('Неверный формат напоминания')
            if not isinstance(r['id'], str) or not re.fullmatch(r'[a-zA-Z0-9-]{1,64}', r['id']) or r['id'] in ids:
                raise ValueError('Неверный или повторяющийся идентификатор')
            ids.add(r['id'])
            if not isinstance(r['text'], str) or not 1 <= len(r['text'].strip()) <= 140:
                raise ValueError('Введите текст длиной от 1 до 140 символов')
            if type(r['minutes']) is not int or not 1 <= r['minutes'] <= 10080:
                raise ValueError('Интервал: от 1 минуты до 7 дней')
            if type(r['enabled']) is not bool or r['sound'] not in ('none', *PRESETS):
                raise ValueError('Неверные настройки звука или включения')

    def snapshot(self):
        with self.lock:
            return copy.deepcopy({'config': self.config, 'history': self.history})

    def configure(self, items, revision):
        self.validate(items)
        with self.lock:
            if type(revision) is not int or revision != self.config['revision']:
                raise ValueError('Настройки уже изменились. Обновите список перед сохранением')
            items = copy.deepcopy(items)
            for r in items:
                r['text'] = r['text'].strip()
            config = {'revision': revision + 1, 'items': items}
            old = {r['id']: r for r in self.config['items']}
            now = self.clock()
            due = {r['id']: self.due[r['id']] if r['id'] in self.due and old.get(r['id']) == r
                   else now + r['minutes'] * 60 for r in items if r['enabled']}
            self.store.set('reminders.config', config)
            self.config, self.due = config, due
            return self.snapshot()

    def tick(self):
        with self.lock:
            now = self.clock()
            ready = [r for r in self.config['items'] if r['enabled'] and now >= self.due[r['id']]]
            if not ready:
                return []
            events = [dict(r, event_id=str(uuid.uuid4()), occurred_at=self.wall()) for r in ready]
            history = (self.history + events)[-20:]
            # Persist before effects. A crash can miss a sound, never replay it on restart.
            self.store.set('reminders.history', history)
            self.history = history
            for r in ready:
                self.due[r['id']] = now + r['minutes'] * 60
            return copy.deepcopy(events)
