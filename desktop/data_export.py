"""User-triggered, read-only export of operational Gizmo data to Supabase."""

import json
import logging
import re
import threading
import uuid
from datetime import datetime, timedelta, timezone

from .club_stats import GUEST_GROUPS, MSK, _date
from .regulars import PERIOD_DAYS, PERIODS
from .services import ApiError, money_gizmo

logger = logging.getLogger(__name__)
REPORT_KIND = 'desk_data_export'
MAX_BATCH_BYTES = 360_000
GUEST_FIELDS = (
    'id', 'userGroupId', 'username', 'firstName', 'lastName', 'middleName',
    'mobilePhone', 'phone', 'email', 'birthDate', 'dateOfBirth',
    'createdTime', 'modifiedTime', 'lastLogin', 'isDisabled', 'isDeleted',
)
LABELS = {
    'guests': 'Гости',
    'guest_groups': 'Группы гостей',
    'stock': 'Остатки',
    'products': 'Товары',
    'product_groups': 'Категории товаров',
    'hosts': 'Компьютеры',
    'active_sessions': 'Текущие сессии',
    'sessions': 'История визитов',
    'sales': 'Продажи и пополнения',
    'guest_spending': 'Траты гостей',
}
AUTH_FIELDS = re.compile(r'password|passwd|passcode|pincode|secret|token|hash|credential|apikey|authorization|cardnumber|pan$|cvv|cvc')


def operational_data(value):
    if isinstance(value, dict):
        return {
            key: operational_data(item) for key, item in value.items()
            if not AUTH_FIELDS.search(re.sub(r'[^a-z]', '', key.casefold()))
        }
    if isinstance(value, list):
        return [operational_data(item) for item in value]
    return value


def rows(result, key):
    if isinstance(result, dict):
        result = next((result[field] for field in (key, 'data', 'result') if isinstance(result.get(field), list)), None)
    if not isinstance(result, list) or any(not isinstance(row, dict) for row in result):
        raise ApiError('Gizmo вернул некорректную выгрузку')
    return result


def batches(data):
    batch, size = [], 0
    for row in data:
        row_size = len(json.dumps(row, ensure_ascii=False, allow_nan=False).encode('utf-8')) + 2
        if row_size > MAX_BATCH_BYTES:
            raise ApiError('Одна запись слишком велика для отправки')
        if batch and size + row_size > MAX_BATCH_BYTES:
            yield batch
            batch, size = [], 0
        batch.append(row)
        size += row_size
    if batch:
        yield batch


def stamp(value):
    return value.astimezone(timezone.utc).isoformat(timespec='seconds')


class DataExport:
    def __init__(self, gizmo, cloud, food, stop):
        self.gizmo = gizmo
        self.cloud = cloud
        self.food = food
        self.stop = stop
        self.lock = threading.Lock()
        self.state = {'busy': False}

    def snapshot(self):
        with self.lock:
            return dict(self.state)

    def set_state(self, **state):
        with self.lock:
            self.state = state

    def start(self):
        with self.lock:
            if self.state['busy']:
                return dict(self.state)
            self.state = {'busy': True, 'step': 'Подключение к Supabase'}
            state = dict(self.state)
        threading.Thread(target=self.run, daemon=True).start()
        return state

    def collect(self, now, history):
        timeout = (3, 120)
        money = money_gizmo(self.gizmo)
        groups = rows(self.gizmo.request('GET', 'usergroups', timeout=timeout), 'groups')
        guest_groups = {row.get('id') for row in groups if str(row.get('name', '')).strip().casefold() in GUEST_GROUPS}
        if not guest_groups:
            raise ApiError('Gizmo: не найдены группы гостей')
        users = rows(self.gizmo.request('GET', 'users', timeout=timeout), 'users')
        guests = [
            {field: row[field] for field in GUEST_FIELDS if field in row}
            for row in users if type(row.get('id')) is int and row.get('userGroupId') in guest_groups
        ]
        yield 'guests', guests
        yield 'guest_groups', [row for row in groups if row.get('id') in guest_groups]
        yield 'hosts', self.gizmo.hosts()
        yield 'active_sessions', self.gizmo.sessions()

        start = min(
            [datetime(2025, 1, 1, tzinfo=MSK)] +
            [created for row in users if (created := _date(row.get('createdTime'))) and 2000 <= created.year <= now.year]
        ).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        history['from'] = stamp(start)
        while start < now:
            end = min((start + timedelta(days=32)).replace(day=1), now)
            span = {'DateFrom': stamp(start), 'DateTo': stamp(end)}
            for dataset, client, path, key, date_fields in (
                ('sessions', self.gizmo, 'reports/sessionslog', 'sessions', ('startTime',)),
                ('sales', money, 'reports/transactionslog', 'transactions', ('transactionDate', 'invoiceDate')),
            ):
                self.set_state(busy=True, step=f'{LABELS[dataset]} · {start:%m.%Y}')
                report = rows(client.request('GET', path, params=span, timeout=timeout), key)
                selected = []
                for row in report:
                    at = next((parsed for field in date_fields if (parsed := _date(row.get(field)))), None)
                    if at is None or start <= at < end or at == end == now:
                        selected.append(row)
                yield dataset, selected
            start = end

        midnight = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        for period in range(PERIODS):
            end = midnight - timedelta(days=PERIOD_DAYS * period)
            start = end - timedelta(days=PERIOD_DAYS)
            through = min(end - timedelta(seconds=1), now)
            report = money.request('GET', 'reports/users/spending', params={
                'start': stamp(start), 'end': stamp(through), 'max': max(len(users), 1),
            }, timeout=timeout)
            yield 'guest_spending', [
                {**row, 'period_start': start.date().isoformat(), 'period_end': through.date().isoformat()}
                for row in rows(report, 'spending')
            ]

        yield 'product_groups', self.food.paged('v2.0/productgroups')
        yield 'products', self.food.paged('v2.0/products', {'IsDeleted': 'false'})
        yield 'stock', self.food.stock_overview()

    def send(self, export_id, action, **data):
        if self.stop.is_set():
            raise ApiError('Выгрузка прервана при закрытии Desk')
        result = self.cloud.desk('report', kind=REPORT_KIND, data={
            'export_id': export_id, 'action': action, **data,
        })
        if result.get('ok') is not True:
            raise ApiError('Supabase не подтвердил запись')

    def run(self):
        export_id = str(uuid.uuid4())
        now = datetime.now(MSK).replace(microsecond=0)
        totals = dict.fromkeys(LABELS, 0)
        history = {}
        sequence = 0
        step = 'Подключение к Supabase'
        try:
            self.send(export_id, 'begin')
            for dataset, records in self.collect(now, history):
                step = LABELS[dataset]
                self.set_state(busy=True, step=step)
                for batch in batches(map(operational_data, records)):
                    self.send(export_id, 'append', dataset=dataset, sequence=sequence, rows=batch)
                    sequence += 1
                    totals[dataset] += len(batch)
            step = 'Публикация выгрузки'
            self.send(export_id, 'publish', batch_count=sequence, totals=totals, history={**history, 'to': stamp(now)})
        except ApiError as error:
            current = self.snapshot().get('step', step)
            self.set_state(busy=False, error=f'{current}. {str(error)[:180]}')
        except Exception:
            logger.exception('Сбой выгрузки Desk')
            self.set_state(busy=False, error=f'{step}. Не удалось завершить выгрузку')
        else:
            self.set_state(busy=False, completed=True, totals=totals)
