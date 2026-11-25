"""Manually refreshed guest segments from Gizmo, with a counts-only Desk report."""
import threading
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from .club_stats import GUEST_GROUPS, MSK, _date
from .services import ApiError


PERIOD_DAYS = 30
PERIODS = 6


def _report_date(value):
    return value.astimezone(timezone.utc).isoformat(timespec='seconds')


def _list(value, label, key=None):
    if key and isinstance(value, dict):
        value = value.get(key)
    if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
        raise ApiError(f'Gizmo: некорректный отчёт «{label}»')
    return value


def _money(row):
    components = [row.get(key) for key in ('cash', 'deposits', 'creditCard')]
    values = components if all(type(value) in (int, float) for value in components) else [row.get('total')]
    if any(type(value) not in (int, float) for value in values):
        raise ApiError('Gizmo: некорректная сумма трат')
    result = sum(Decimal(str(value)) for value in values)
    if not result.is_finite():
        raise ApiError('Gizmo: некорректная сумма трат')
    return result


def collect(gizmo, excluded, minimum_visits, minimum_spend, now=None):
    now = now or datetime.now(MSK)
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    timeout = (3, 120)
    groups = _list(gizmo.request('GET', 'usergroups'), 'группы')
    guest_groups = {row['id'] for row in groups if str(row.get('name', '')).strip().casefold() in GUEST_GROUPS}
    if not guest_groups:
        raise ApiError('Gizmo: группы клиентов не найдены')

    directory = _list(gizmo.request('GET', 'users', timeout=timeout), 'гости')
    users = {
        row['id']: row for row in directory
        if type(row.get('id')) is int and row.get('userGroupId') in guest_groups
        and not row.get('isDeleted') and not row.get('isDisabled') and row['id'] not in excluded
    }

    visits = defaultdict(set)
    last_visit = {}
    periods = []
    for index in range(PERIODS):
        end = tomorrow - timedelta(days=PERIOD_DAYS * index)
        start = end - timedelta(days=PERIOD_DAYS)
        report = gizmo.request('GET', 'reports/sessionslog', params={
            'DateFrom': _report_date(start), 'DateTo': _report_date(min(end, now)),
        }, timeout=timeout)
        for row in _list(report, 'визиты', 'sessions'):
            uid = row.get('userId')
            if uid in users and not row.get('userIsGuest'):
                started = _date(row.get('startTime'))
                if started and start <= started < end and started <= now:
                    visits[uid].add(started.date())
                    last_visit[uid] = max(started.date(), last_visit.get(uid, started.date()))
        periods.append((start, end))

    # A session currently in progress may not have appeared in the history yet.
    for row in _list(gizmo.sessions(), 'текущие сессии'):
        uid = row.get('userId')
        started = _date(row.get('lastLogin'))
        if uid in users and started and periods[-1][0] <= started <= now:
            visits[uid].add(started.date())
            last_visit[uid] = max(started.date(), last_visit.get(uid, started.date()))

    result = {'active': [], 'sleeping': []}
    matched = set()
    active_from = periods[0][0].date()
    for index, (start, end) in enumerate(periods):
        candidates = {}
        for uid, days in visits.items():
            is_active = last_visit[uid] >= active_from
            if uid not in matched and is_active == (index == 0):
                count = sum(start.date() <= day < end.date() for day in days)
                if count >= minimum_visits:
                    candidates[uid] = count
        if not candidates:
            continue
        # Ask for all entries so qualifying guests aren't dropped by the default leaderboard size.
        spend = gizmo.request('GET', 'reports/users/spending', params={
            'start': _report_date(start),
            'end': _report_date(min(end - timedelta(seconds=1), now)),
            'max': max(len(directory), 1),
        }, timeout=timeout)
        amounts = {row['userId']: _money(row) for row in _list(spend, 'траты') if row.get('userId') in candidates}
        segment = 'active' if index == 0 else 'sleeping'
        for uid, count in candidates.items():
            amount = amounts.get(uid, Decimal(0))
            if amount < minimum_spend:
                continue
            user = users[uid]
            phone = str(user.get('mobilePhone') or '').strip() or str(user.get('phone') or '').strip()
            result[segment].append({
                'first_name': user.get('firstName') or '',
                'last_name': user.get('lastName') or '',
                'username': user.get('username') or '',
                'phone': phone,
                'visits': count,
                'spent': float(amount),
                'last_visit': last_visit[uid].isoformat(),
                'period_start': start.date().isoformat(),
                'period_end': (end.date() - timedelta(days=1)).isoformat(),
            })
            matched.add(uid)
    for rows in result.values():
        rows.sort(key=lambda row: (row['spent'], row['visits'], row['last_visit']), reverse=True)
    return result


class Regulars:
    def __init__(self, gizmo, cloud):
        self.gizmo = gizmo
        self.cloud = cloud
        self.lock = threading.Lock()
        self.state = {'busy': False}

    def snapshot(self):
        with self.lock:
            return dict(self.state)

    def start(self, minimum_visits, minimum_spend):
        if type(minimum_visits) is not int or type(minimum_spend) is not int or not (
            1 <= minimum_visits <= PERIOD_DAYS and 1 <= minimum_spend <= 1_000_000
        ):
            return {'error': 'Укажите от 1 до 30 дней визитов и траты от 1 до 1 000 000 ₽'}
        with self.lock:
            if self.state['busy']:
                return {'busy': True}
            self.state = {'busy': True}
        threading.Thread(target=self._run, args=(minimum_visits, minimum_spend), daemon=True).start()
        return {'busy': True}

    def _run(self, minimum_visits, minimum_spend):
        state = {'busy': False}
        now = datetime.now(MSK)
        try:
            tests = self.cloud.desk('test_accounts').get('accounts')
            if not isinstance(tests, list) or any(not isinstance(row, dict) for row in tests):
                raise ApiError('Не удалось проверить список тестовых аккаунтов')
            excluded = {row.get('gizmo_user_id') for row in tests}
            result = collect(self.gizmo, excluded, minimum_visits, minimum_spend, now)
        except Exception:
            state['error'] = 'Не удалось собрать отчёт. Проверьте связь с Gizmo и базой и повторите запуск.'
        else:
            state['result'] = result
            summary = {
                'at': now.isoformat(),
                'minimum_visits': minimum_visits,
                'minimum_spend': minimum_spend,
                'active_count': len(result['active']),
                'sleeping_count': len(result['sleeping']),
            }
            try:
                state['synced'] = self.cloud.desk('report', kind='guest_regulars', data=summary).get('ok') is True
            except Exception:
                state['synced'] = False
        with self.lock:
            self.state = state
