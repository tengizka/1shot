"""«Статистика»: the whole club from Gizmo's own reports, for the owner.

Gizmo is reachable only inside the club, so Desk reads it here: every guest account, every session of the last
12 months (reports/sessionslog), spending per guest (reports/users/spending) and sales (reports/transactionslog).
From that it counts, per month, new guests, how many of them came back, active and regular guests, visits and hours;
the busiest days and hours; the zones and PCs; sleeping accounts; and a few facts worth knowing.

The full result (with nicknames of the top guests) stays on this PC. Only numbers go to the server
(club_desk_reports, kind «club_stats»): no names, phones, nicknames or Gizmo ids leave the club.
"""
import threading
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

MSK = timezone(timedelta(hours=3))
MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
GUEST_GROUPS = ('клиенты', '18+')


def zone(host):
    """Hall zones by PC number (see assets/hall-map.js): 11–15 VIP 1, 21–25 VIP 2, 1 the PS5 in the TV zone."""
    h = str(host or '').strip()
    if h == '1':
        return 'TV'
    if h.isdigit() and 11 <= int(h) <= 15:
        return 'VIP 1'
    if h.isdigit() and 21 <= int(h) <= 25:
        return 'VIP 2'
    return 'STANDART'


def _date(value):
    if not value:
        return None
    try:
        d = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return (d if d.tzinfo else d.replace(tzinfo=MSK)).astimezone(MSK)


def _rows(value, key):
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        for k in (key, 'data', 'result'):
            if isinstance(value.get(k), list):
                return value[k]
    return []


def _minutes(s, start, end):
    for k in ('totalMinutes', 'duration'):
        v = s.get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0:
            return float(v)
    if start and end and end > start:
        return (end - start).total_seconds() / 60
    return 0.0


def month_key(d):
    return f'{d.year}-{d.month:02d}'


def month_label(key):
    y, m = key.split('-')
    return f'{MONTHS[int(m) - 1]} {y[2:]}'


def fetch(gizmo, now=None, months=12):
    """Raw material from Gizmo. Sessions and sales are read month by month so no single report is huge."""
    now = now or datetime.now(MSK)
    users = gizmo.request('GET', 'users', params={'IsDeleted': False}, timeout=(3, 60))
    groups = {g.get('id'): str(g.get('name', '')).strip().casefold() for g in gizmo.request('GET', 'usergroups') or []}
    first = (now.replace(day=1, hour=0, minute=0, second=0, microsecond=0) - timedelta(days=31 * (months - 1))).replace(day=1)
    sessions, sales, errors = [], [], []
    start = first
    while start < now:
        end = (start + timedelta(days=32)).replace(day=1)
        span = {'DateFrom': start.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S'),
                'DateTo': min(end, now).astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')}
        try:
            sessions += _rows(gizmo.request('GET', 'reports/sessionslog', params=span, timeout=(3, 120)), 'sessions')
        except Exception:
            errors.append('сессии ' + month_label(month_key(start)))
        try:
            sales += _rows(gizmo.request('GET', 'reports/transactionslog', params=span, timeout=(3, 120)), 'transactions')
        except Exception:
            errors.append('продажи ' + month_label(month_key(start)))
        start = end
    try:
        spending = gizmo.request('GET', 'reports/users/spending', params={'start': first.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}, timeout=(3, 120))
    except Exception:
        spending = []
        errors.append('траты гостей')
    return {'users': users if isinstance(users, list) else [], 'groups': groups, 'sessions': sessions, 'sales': sales,
            'spending': spending if isinstance(spending, list) else [], 'first': first, 'now': now, 'errors': errors}


def compute(raw):
    now, first = raw['now'], raw['first']
    guest_group = {gid for gid, name in raw['groups'].items() if name in GUEST_GROUPS}
    users = {u['id']: u for u in raw['users'] if isinstance(u, dict) and type(u.get('id')) is int and (not guest_group or u.get('userGroupId') in guest_group)}
    created = {uid: _date(u.get('createdTime')) for uid, u in users.items()}

    # Sessions → visits: one visit = one guest on one day (two sessions the same day are one visit).
    visits = defaultdict(set)          # uid -> {date}
    month_hours = Counter()
    month_visits = Counter()
    heat = Counter()                   # (weekday, hour) -> visits started
    zone_hours, pc_hours = Counter(), Counter()
    hours_by_user = Counter()
    longest = (0.0, None, None)
    day_guests = defaultdict(set)
    night = total_sessions = 0
    anonymous = 0
    for s in raw['sessions']:
        if not isinstance(s, dict):
            continue
        uid = s.get('userId')
        start, end = _date(s.get('startTime')), _date(s.get('endTime'))
        if not start:
            continue
        mins = _minutes(s, start, end)
        if s.get('userIsGuest') or uid not in users:
            anonymous += 1
            continue
        total_sessions += 1
        host = s.get('hostNumber') or s.get('hostName') or ''
        hours = mins / 60
        key = month_key(start)
        month_hours[key] += hours
        zone_hours[zone(host)] += hours
        if host:
            pc_hours[str(host)] += hours
        hours_by_user[uid] += hours
        if start.date() not in visits[uid]:
            visits[uid].add(start.date())
            month_visits[key] += 1
            heat[(start.weekday(), start.hour)] += 1
            day_guests[start.date()].add(uid)
        if start.hour < 6:
            night += 1
        if hours > longest[0]:
            longest = (hours, uid, start)

    month_keys = []
    m = first
    while m <= now:
        month_keys.append(month_key(m))
        m = (m + timedelta(days=32)).replace(day=1)

    # A guest is new in the month their account was made (and they played at least once that month).
    first_visit = {uid: min(days) for uid, days in visits.items() if days}
    rows = []
    for key in month_keys:
        new = [uid for uid, c in created.items() if c and month_key(c) == key and uid in first_visit and f'{first_visit[uid].year}-{first_visit[uid].month:02d}' == key]
        came_back = [uid for uid in new if len(visits[uid]) >= 2]
        active = [uid for uid, days in visits.items() if any(f'{d.year}-{d.month:02d}' == key for d in days)]
        regular = [uid for uid in active if sum(1 for d in visits[uid] if f'{d.year}-{d.month:02d}' == key) >= 4]
        accounts = sum(1 for c in created.values() if c and month_key(c) == key)
        rows.append({'month': key, 'label': month_label(key), 'accounts': accounts, 'new': len(new), 'came_back': len(came_back),
                     'active': len(active), 'regular': len(regular), 'visits': month_visits[key], 'hours': round(month_hours[key])})

    today = now.date()
    last_visit = {uid: max(days) for uid, days in visits.items() if days}
    active_30 = sum(1 for d in last_visit.values() if (today - d).days <= 30)
    sleeping = sum(1 for d in last_visit.values() if 30 < (today - d).days <= 180)
    never = sum(1 for uid in users if uid not in last_visit)

    # Money. Revenue is real money only (cash, card, СБП…), deposit top-ups included. A purchase paid from the deposit
    # is not new money (it was counted when the deposit was topped up), so it goes to «с депозита», not to revenue;
    # points and bonuses are not money at all. Refunds come as negative lines and subtract themselves.
    revenue, topups, from_deposit = Counter(), Counter(), Counter()
    products, product_money = Counter(), Counter()
    for t in raw['sales']:
        if not isinstance(t, dict):
            continue
        d = _date(t.get('transactionDate') or t.get('invoiceDate'))
        value = t.get('total', t.get('value'))
        if not d or not isinstance(value, (int, float)) or isinstance(value, bool):
            continue
        method = str(t.get('paymentMethodName') or '').casefold()
        title = str(t.get('title') or '').strip()
        key = month_key(d)
        if any(w in method for w in ('депозит', 'deposit')):
            from_deposit[key] += float(value)
        elif not any(w in method for w in ('балл', 'point', 'бонус', 'bonus')):
            revenue[key] += float(value)
            if any(w in title.casefold() for w in ('депозит', 'пополн', 'deposit')):
                topups[key] += float(value)
        # Deposit top-ups are money in, not something guests buy.
        if title and value > 0 and not any(w in title.casefold() for w in ('депозит', 'пополн', 'deposit')):
            products[title] += 1
            product_money[title] += float(value)
    spend = sorted((float(r.get('total') or 0), r.get('userId')) for r in raw['spending'] if isinstance(r, dict) and r.get('userId') in users)
    paying = [v for v, _ in spend if v > 0]
    for r in rows:
        r['revenue'] = round(revenue[r['month']])
        r['topups'] = round(topups[r['month']])
        r['from_deposit'] = round(from_deposit[r['month']])

    weekday_visits = Counter()
    hour_visits = Counter()
    for (wd, h), n in heat.items():
        weekday_visits[wd] += n
        hour_visits[h] += n
    busiest_day = max(day_guests.items(), key=lambda kv: len(kv[1]), default=(None, set()))
    nick = lambda uid: (users.get(uid) or {}).get('username') or f'ID {uid}'

    last12 = rows[-12:]
    new_total = sum(r['new'] for r in last12)
    back_total = sum(r['came_back'] for r in last12)
    summary = {
        'accounts': len(users), 'played': len(last_visit), 'never_played': never,
        'active_30': active_30, 'sleeping': sleeping,
        'visits': sum(month_visits.values()), 'hours': round(sum(month_hours.values())),
        'sessions': total_sessions, 'avg_session_min': round(sum(month_hours.values()) * 60 / total_sessions) if total_sessions else 0,
        'return_rate': round(100 * back_total / new_total) if new_total else None,
        'night_share': round(100 * night / total_sessions) if total_sessions else 0,
        'paying_guests': len(paying), 'avg_spend': round(sum(paying) / len(paying)) if paying else None,
        'median_spend': round(paying[len(paying) // 2]) if paying else None,
    }
    facts = []
    if busiest_day[0]:
        facts.append(f'Рекорд по гостям за день: {len(busiest_day[1])}, это было {busiest_day[0].strftime("%d.%m.%Y")} ({WEEKDAYS[busiest_day[0].weekday()]})')
    if weekday_visits:
        wd = max(weekday_visits, key=weekday_visits.get)
        low = min(weekday_visits, key=weekday_visits.get)
        facts.append(f'Самый людный день недели — {WEEKDAYS[wd]}, самый тихий — {WEEKDAYS[low]}')
    if hour_visits:
        h = max(hour_visits, key=hour_visits.get)
        facts.append(f'Чаще всего приходят в {h:02d}:00–{(h + 1) % 24:02d}:00')
    if zone_hours:
        total = sum(zone_hours.values()) or 1
        facts.append('Часы по залам: ' + ', '.join(f'{z} {round(100 * v / total)}%' for z, v in zone_hours.most_common()))
    if pc_hours:
        top, low = pc_hours.most_common(1)[0], min(pc_hours.items(), key=lambda kv: kv[1])
        facts.append(f'Самый загруженный ПК — {top[0]} ({round(top[1])}h), самый свободный — {low[0]} ({round(low[1])}h)')
    if summary['return_rate'] is not None:
        facts.append(f'Из новых гостей за год вернулись ещё хотя бы раз {summary["return_rate"]}%')
    facts.append(f'Ночные сессии (00:00–06:00): {summary["night_share"]}% от всех')
    if summary['avg_session_min']:
        facts.append(f'Средняя сессия длится {summary["avg_session_min"] // 60}h {summary["avg_session_min"] % 60}m')
    if products:
        facts.append('Чаще всего покупают: ' + ', '.join(f'{t} ({n})' for t, n in products.most_common(3)))
    if never:
        facts.append(f'Аккаунтов, которые ни разу не играли за последний год: {never}')

    # Local-only extras: who the regulars are. Never sent to the server.
    local = {
        'top_hours': [{'nick': nick(uid), 'hours': round(h)} for uid, h in hours_by_user.most_common(10)],
        'top_visits': [{'nick': nick(uid), 'visits': len(d)} for uid, d in sorted(visits.items(), key=lambda kv: -len(kv[1]))[:10]],
        'top_spend': [{'nick': nick(uid), 'spent': round(v)} for v, uid in reversed(spend[-10:]) if v > 0],
        'longest': {'nick': nick(longest[1]), 'hours': round(longest[0], 1), 'date': longest[2].strftime('%d.%m.%Y')} if longest[1] else None,
    }
    # Every guest who played, by Gizmo account number only (no names or phones: the server is outside Russia).
    spent_by = {uid: v for v, uid in spend}
    guests = [{'id': uid, 'created': created[uid].strftime('%Y-%m-%d') if created.get(uid) else None,
               'first': min(days).isoformat(), 'last': max(days).isoformat(), 'visits': len(days),
               'hours': round(hours_by_user[uid], 1), 'spent': round(spent_by.get(uid, 0))}
              for uid, days in visits.items() if days]
    guests.sort(key=lambda g: -g['hours'])
    guests = guests[:3000]  # the server keeps a report up to 500 KB
    return {
        'at': now.isoformat(), 'months': rows, 'guests': guests, 'summary': summary, 'facts': facts,
        'heat': [[heat[(wd, h)] for h in range(24)] for wd in range(7)],
        'zones': [{'zone': z, 'hours': round(v)} for z, v in zone_hours.most_common()],
        'pcs': [{'pc': p, 'hours': round(v)} for p, v in pc_hours.most_common()],
        'products': [{'title': t, 'count': n, 'money': round(product_money[t])} for t, n in products.most_common(10)],
        'anonymous_sessions': anonymous, 'errors': raw['errors'], 'local': local,
    }


def public(result):
    """What goes to the server: everything except nicknames (since 3.16 a nickname is the guest's phone number).
    Guests are listed by Gizmo account number; product titles are the club's own menu."""
    return {k: v for k, v in result.items() if k != 'local'}


class ClubStats:
    def __init__(self, gizmo, cloud, store):
        self.gizmo, self.cloud, self.store = gizmo, cloud, store
        self.busy = False
        self.error = ''

    def snapshot(self):
        return {'stats': self.store.get('club-stats'), 'busy': self.busy, 'error': self.error}

    def refresh(self, background=True):
        if self.busy:
            return self.snapshot()
        self.busy = True
        self.error = ''

        def run():
            try:
                result = compute(fetch(self.gizmo))
                self.store.set('club-stats', result)
                try:
                    self.cloud.desk('report', kind='club_stats', data=public(result))
                except Exception:
                    pass  # The server copy is a bonus; the Desk page works without it.
            except Exception as error:
                self.error = ('Не удалось собрать статистику: ' + str(error))[:200]
            finally:
                self.busy = False
        if background:
            threading.Thread(target=run, daemon=True).start()
        else:
            run()
        return self.snapshot()

    def loop(self, stop):
        """Once a day, quietly, so the page opens with fresh numbers."""
        while not stop.wait(60):
            stats = self.store.get('club-stats') or {}
            at = _date(stats.get('at'))
            if not at or datetime.now(MSK) - at > timedelta(hours=24):
                self.refresh(background=False)
            stop.wait(3600)
