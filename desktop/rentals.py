"""Local rentals desk: who has which club item (mice, mouse pad, power bank).

Kept only in the Desk journal on this PC; a returned item is removed at once.
"""
import re
import time
import uuid

ITEMS = {
    'powerbank': 'Повербанк',
    'gprox': 'Logitech G PRO X',
    'gprox2': 'Logitech G PRO X 2',
    'x3': 'Attack Shark X3',
    'g304': 'Logitech G304',
    'pad': 'Коврик Logitech G740',
}
LIMIT = 100


class Rentals:
    def __init__(self, store, clock=time.time):
        self.store, self.clock = store, clock

    def list(self):
        return [dict(r) for r in self.store.get('rentals', []) if r.get('item') in ITEMS]

    def add(self, item, host=None, who=''):
        if item not in ITEMS:
            raise ValueError('Неизвестная вещь')
        host = None if host in (None, '') else str(host).strip()
        if host is not None and not re.fullmatch(r'\d{1,3}', host):
            raise ValueError('Неверный номер ПК')
        who = ' '.join(str(who or '').split())[:60]
        if not host and not who:
            raise ValueError('Укажите ПК или кому выдали')
        rows = self.list()
        if len(rows) >= LIMIT:
            raise ValueError('Слишком много активных аренд')
        row = {'id': uuid.uuid4().hex, 'item': item, 'host': host, 'who': who, 'at': self.clock()}
        self.store.set('rentals', rows + [row])
        return row

    def returned(self, rental_id):
        rows = self.list()
        left = [r for r in rows if r['id'] != rental_id]
        if len(left) == len(rows):
            raise ValueError('Аренда уже закрыта')
        self.store.set('rentals', left)
        return True
