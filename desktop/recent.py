"""«Недавно пополнялись»: the last guests who paid in Gizmo (top-up or package), to log them in with one tap.

Reads Gizmo only: GET reports/transactionslog for the last hours and the active sessions. A guest who already
plays somewhere is not offered. Staff and service accounts are not offered either (same rule as the account search).
"""
import threading
import time
from datetime import datetime, timedelta

from .tbank import MSK, _date

ID_KEYS = ('userId', 'customerId', 'clientId')
NAME_KEYS = ('userName', 'username', 'customerName', 'customer', 'clientName')


def _uid(row, by_name):
    for k in ID_KEYS:
        v = row.get(k)
        if type(v) is int and v > 0:
            return v
    for k in NAME_KEYS:
        v = str(row.get(k) or '').strip().casefold()
        if v and v in by_name:
            return by_name[v]
    return None


def pick(rows, users, playing, now, hours=3, limit=3):
    """Newest paying guests first, one line each, without the ones in a session right now."""
    by_name = {str(u.get('username') or '').strip().casefold(): u['id'] for u in users.values() if u.get('username')}
    since = now - timedelta(hours=hours)
    seen, out = set(), []
    lines = []
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict):
            continue
        at = _date(r.get('transactionDate') or r.get('invoiceDate'))
        value = r.get('total', r.get('value'))
        if not at or at < since or at > now + timedelta(minutes=5):
            continue
        if not isinstance(value, (int, float)) or isinstance(value, bool) or value <= 0:
            continue
        uid = _uid(r, by_name)
        if uid in users:
            lines.append((at, uid, float(value), str(r.get('title') or '').strip()[:40]))
    lines.sort(key=lambda x: x[0], reverse=True)
    for at, uid, value, title in lines:
        if uid in seen:
            continue
        seen.add(uid)
        if uid in playing:
            continue
        out.append({'user_id': uid, 'at': at.isoformat(), 'amount': round(value, 2), 'title': title})
        if len(out) >= limit:
            break
    return out


class RecentPayers:
    def __init__(self, gizmo, directory):
        self.gizmo, self.directory = gizmo, directory
        self.lock = threading.Lock()
        self.cache, self.cache_at = None, 0.0

    def list(self):
        with self.lock:
            if self.cache is not None and time.monotonic() - self.cache_at < 15:
                return self.cache
            now = datetime.now(MSK)
            span = {'DateFrom': (now - timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%S'),
                    'DateTo': (now + timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%S')}
            report = self.gizmo.request('GET', 'reports/transactionslog', params=span, timeout=(3, 30))
            rows = report.get('transactions') if isinstance(report, dict) else report
            playing = {s.get('userId') for s in self.gizmo.sessions() if isinstance(s, dict)}
            # Only guests: the account search already knows who is staff (requires_privileged_confirmation).
            self.directory.search('__warmup__')
            groups = self.directory.group_names()
            users = {}
            for u in self.directory.rows:
                if u.get('isDisabled'):
                    continue
                d = self.directory.describe(u, groups)
                if not d.get('requires_privileged_confirmation'):
                    users[u['id']] = d
            found = pick(rows, users, playing, now)
            result = [{**users[f['user_id']], **f} for f in found]
            self.cache, self.cache_at = result, time.monotonic()
            return result
