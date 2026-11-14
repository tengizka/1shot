"""«ТБанк за смену»: how much came through T-Bank since our own shift started, so the admin stops counting by hand.

The counter is ours only. «Закрыть смену» saves the totals to the local history and starts a new count from that
second. It NEVER closes, opens or touches a shift in Gizmo: this module only READS Gizmo's transaction log
(GET reports/transactionslog) and writes nothing anywhere in Gizmo.

Every refresh recounts from the log (operations since the shift start with a T-Bank payment method), so an operation
is never counted twice and a refund simply subtracts itself.
"""
import os
import re
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

MSK = timezone(timedelta(hours=3))
NAME = re.compile(r'т-?\s?банк|тинькоф|tinkoff|t-?\s?bank', re.I)


def _date(value):
    if not value:
        return None
    try:
        d = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return (d if d.tzinfo else d.replace(tzinfo=MSK)).astimezone(MSK)


def is_tbank(row):
    """PAYMENT_TBANK_METHOD_ID in .env picks the method by id; otherwise any method whose name says T-Bank / Тинькофф."""
    wanted = os.getenv('PAYMENT_TBANK_METHOD_ID', '').strip()
    if wanted:
        return str(row.get('paymentMethodId')) == wanted
    return bool(NAME.search(str(row.get('paymentMethodName') or '')))


def operations(rows, start, end=None):
    out = []
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict) or not is_tbank(r):
            continue
        at = _date(r.get('transactionDate') or r.get('invoiceDate'))
        value = r.get('total', r.get('value'))
        if not at or at < start or (end and at >= end) or not isinstance(value, (int, float)) or isinstance(value, bool):
            continue
        out.append({'at': at.isoformat(), 'title': str(r.get('title') or '').strip()[:60], 'amount': round(float(value), 2),
                    'operator': str(r.get('operatorName') or '').strip()[:40], 'invoice': r.get('invoiceId')})
    out.sort(key=lambda o: o['at'], reverse=True)
    return out


class TBankShift:
    def __init__(self, gizmo, cloud, store):
        self.gizmo, self.cloud, self.store = gizmo, cloud, store
        self.lock = threading.Lock()
        self.cache = None
        self.cache_at = 0.0

    def state(self):
        st = self.store.get('tbank-shift')
        if not st:
            st = {'id': str(uuid.uuid4()), 'start': datetime.now(MSK).isoformat()}
            self.store.set('tbank-shift', st)
        return st

    def _read(self, start, end=None):
        # A day of margin before the start: Gizmo filters by its own clock; the exact cut is made here.
        params = {'DateFrom': (start - timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%S'),
                  'DateTo': ((end or datetime.now(MSK)) + timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%S')}
        report = self.gizmo.request('GET', 'reports/transactionslog', params=params, timeout=(3, 60))
        rows = report.get('transactions') if isinstance(report, dict) else report
        return operations(rows, start, end)

    def status(self, fresh=False):
        """Current shift: since when, how many T-Bank operations, the sum, the operations, and the closed shifts."""
        with self.lock:
            st = self.state()
            history = self.store.get('tbank-history', [])
            if not fresh and self.cache and self.cache.get('id') == st['id'] and time.time() - self.cache_at < 20:
                return {**self.cache, 'history': history[:30]}
            try:
                ops = self._read(_date(st['start']))
                result = {'id': st['id'], 'start': st['start'], 'count': len(ops), 'sum': round(sum(o['amount'] for o in ops), 2),
                          'operations': ops[:200], 'error': ''}
            except Exception as error:
                result = {'id': st['id'], 'start': st['start'], 'count': None, 'sum': None, 'operations': [],
                          'error': ('Не удалось прочитать журнал Gizmo: ' + str(error))[:200]}
            self.cache, self.cache_at = result, time.time()
            return {**result, 'history': history[:30]}

    def set_start(self, shift_id, start):
        """«Считать с»: when nobody pressed «Закрыть смену», the admin finds the first T-Bank payment in Gizmo and
        sets the start to its date and time; the counter recounts from there. Our counter only, Gizmo is not touched."""
        at = _date(start)
        now = datetime.now(MSK)
        if not at:
            return {'error': 'Укажите дату и время'}
        if at > now:
            return {'error': 'Время ещё не наступило'}
        if now - at > timedelta(days=7):
            return {'error': 'Можно считать максимум за 7 дней'}
        with self.lock:
            st = self.state()
            if shift_id != st['id']:
                return {'error': 'Смена изменилась. Обновите страницу'}
            self.store.set('tbank-shift', {'id': st['id'], 'start': at.isoformat(), 'manual': True})
            self.cache = None
        return {'ok': True}

    def close(self, shift_id, confirmed=False):
        """Our counter only: saves the totals and starts a new count. Nothing is sent to Gizmo."""
        if confirmed is not True:
            return {'error': 'Подтвердите закрытие смены'}
        with self.lock:
            st = self.state()
            if shift_id != st['id']:
                return {'error': 'Смена уже закрыта. Обновите страницу'}
            end = datetime.now(MSK)
            try:
                ops = self._read(_date(st['start']), end)
            except Exception as error:
                return {'error': ('Не удалось прочитать журнал Gizmo, смену не закрываю: ' + str(error))[:200]}
            record = {'id': st['id'], 'start': st['start'], 'end': end.isoformat(), 'count': len(ops),
                      'sum': round(sum(o['amount'] for o in ops), 2)}
            history = [record] + self.store.get('tbank-history', [])
            self.store.set('tbank-history', history[:500])
            self.store.set('tbank-shift', {'id': str(uuid.uuid4()), 'start': end.isoformat()})
            self.cache = None
        try:
            self.cloud.desk('report', kind='tbank_shifts', data={'shifts': history[:200]})
        except Exception:
            pass  # The history lives on this PC; the server copy is only for the owner's reports.
        return {'ok': True, 'closed': record}


def kind(row):
    """How the money came: tbank / cash / card / deposit (paid from money already in) / points / other."""
    if is_tbank(row):
        return 'tbank'
    m = str(row.get('paymentMethodName') or '').casefold()
    for k, words in (('deposit', ('депозит', 'deposit')), ('points', ('балл', 'бонус', 'point', 'bonus')),
                     ('cash', ('нал', 'cash')), ('card', ('карт', 'card', 'сбп', 'qr', 'терминал'))):
        if any(w in m for w in words):
            return k
    return 'other'


def feed(gizmo, now=None, hours=26):
    """The last day of money and play for the shift reports in the bot: amounts with how they were paid, and session
    starts by Gizmo account number. No names, nicknames, phones or staff names leave the club."""
    now = now or datetime.now(MSK)
    start = now - timedelta(hours=hours)
    span = {'DateFrom': (start - timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%S'), 'DateTo': (now + timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%S')}
    money = []
    report = gizmo.request('GET', 'reports/transactionslog', params=span, timeout=(3, 60))
    for r in (report.get('transactions') if isinstance(report, dict) else report) or []:
        at = _date(r.get('transactionDate') or r.get('invoiceDate')) if isinstance(r, dict) else None
        value = r.get('total', r.get('value')) if at else None
        if at and at >= start and isinstance(value, (int, float)) and not isinstance(value, bool):
            title = str(r.get('title') or '').casefold()
            money.append({'at': at.isoformat(), 'amount': round(float(value), 2), 'kind': kind(r),
                          'topup': any(w in title for w in ('депозит', 'пополн', 'deposit'))})
    plays = []
    report = gizmo.request('GET', 'reports/sessionslog', params=span, timeout=(3, 60))
    for s in (report.get('sessions') if isinstance(report, dict) else report) or []:
        at = _date(s.get('startTime')) if isinstance(s, dict) else None
        if at and at >= start:
            plays.append({'at': at.isoformat(), 'user': s.get('userId') if not s.get('userIsGuest') else None,
                          'minutes': round(float(s.get('totalMinutes') or 0))})
    return {'at': now.isoformat(), 'from': start.isoformat(), 'money': money[:3000], 'sessions': plays[:3000]}


def feed_loop(stop, gizmo, cloud, online=lambda: True, every=300):
    """Every 5 minutes: the shift feed to the server (club_desk_reports, kind «shift_feed»). Read-only in Gizmo."""
    if stop.wait(20):
        return
    while True:
        if online():
            try:
                cloud.desk('report', kind='shift_feed', data=feed(gizmo))
            except Exception:
                pass  # The next round tries again; the bot says when the feed is stale.
        if stop.wait(every):
            return
