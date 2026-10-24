import importlib.util
import tempfile
import unittest
import unittest.mock
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('club_analytics', Path(__file__).resolve().parent.parent / 'analytics' / 'Export-ClubAnalytics.py')
analytics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analytics)

class Gizmo:
    def __init__(self):self.calls=[]
    def get(self, endpoint, params=None):
        self.calls.append((endpoint, params))
        if endpoint == 'reports/users/spending':
            return [{'userId': params['userId'], 'total': 1200 if params['userId'] == 7 else 0, 'cash': 200, 'creditCard': 1000, 'deposits': 0}]
        if endpoint == 'reports/sessionslog':
            if params['UserId'] == 7:
                return {'sessions': [{'startTime': '2026-10-20T18:00:00', 'billedSpan': 3600}, {'startTime': '2026-10-20T21:00:00', 'billedSpan': 3600}, {'startTime': '2026-10-22T19:00:00', 'billedSpan': 7200}]}
            return {'sessions': [{'startTime': '2026-10-20T18:00:00', 'billedSpan': 3600}, {'startTime': '2026-10-21T18:00:00', 'billedSpan': 0}]}

REPORT = {
    'codes': [{'code': 'HEADSHOT', 'channel': 'ВКонтакте', 'active': True}, {'code': 'LEVELUP', 'channel': 'Яндекс Поиск', 'active': True}, {'code': 'RESPAWN', 'channel': 'Яндекс Карты', 'active': True}],
    'redemptions': [
        {'code': 'HEADSHOT', 'status': 'done', 'gizmo_user_id': 7, 'reward': 'granted', 'created_at': '2026-10-19T10:00:00+00:00', 'decided_at': '2026-10-20T17:00:00.123+00:00'},
        {'code': 'HEADSHOT', 'status': 'done', 'gizmo_user_id': 8, 'reward': None, 'created_at': '2026-10-19T10:00:00+00:00', 'decided_at': '2026-10-20T17:30:00+00:00'},
        {'code': 'HEADSHOT', 'status': 'awaiting_admin', 'gizmo_user_id': None, 'reward': None, 'created_at': '2026-10-22T10:00:00+00:00', 'decided_at': None},
        {'code': 'LEVELUP', 'status': 'expired', 'gizmo_user_id': None, 'reward': None, 'created_at': '2026-10-15T10:00:00+00:00', 'decided_at': '2026-10-18T10:00:00+00:00'},
    ]}

class PromoAnalyticsTests(unittest.TestCase):
    def test_summary_per_code(self):
        users = [{'id': 7, 'userName': 'neo', 'firstName': 'Иван'}, {'id': 8, 'userName': 'trinity', 'firstName': ''}]
        with unittest.mock.patch.dict(analytics.PROMO_BUDGET, {'HEADSHOT': 2000}):
            promo = analytics.promo_analytics(REPORT, users, Gizmo())
        rows = {r['code']: r for r in promo['rows']}
        h = rows['HEADSHOT']
        self.assertEqual((h['forms'], h['done'], h['waiting'], h['granted'], h['returned'], h['spent'], h['per_guest'], h['cost']), (3, 2, 1, 1, 1, 1200, 600, 1000))
        self.assertEqual((rows['LEVELUP']['rejected'], rows['LEVELUP']['done'], rows['LEVELUP']['cost']), (1, 0, None))
        self.assertEqual(rows['RESPAWN']['forms'], 0)
        neo = [g for g in promo['guests'] if g['username'] == 'neo'][0]
        self.assertEqual((neo['visits'], neo['last'], neo['reward'], neo['spent'], neo['approved']), (2, '22.10.2026', 'Выдан', 1200, '20.10.2026'))
        self.assertEqual([g['reward'] for g in promo['guests'] if g['username'] == 'trinity'], ['Проверить'])

    def test_activity_window_starts_at_approval(self):
        gizmo = Gizmo()
        analytics.promo_analytics(REPORT, [], gizmo)
        starts = {p.get('start') or p.get('DateFrom') for _, p in gizmo.calls}
        self.assertEqual(starts, {'2026-10-20T17:00:00Z', '2026-10-20T17:30:00Z'})

    def test_workbook_with_promo_and_call_list(self):
        data = analytics.analyze([{'id': 1, 'userName': 'old', 'firstName': 'Пётр', 'mobilePhone': '+79990000000', 'modifiedTime': '2026-08-01T10:00:00'}],
                                 [{'userId': 1, 'username': 'old', 'total': 9000, 'cash': 0, 'creditCard': 9000}], [])
        data['promo'] = analytics.promo_analytics(REPORT, [], Gizmo())
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'stats.xlsx'
            analytics.create_designed_excel_workbook(data, str(path))
            with zipfile.ZipFile(path) as z:
                book = z.read('xl/workbook.xml').decode()
                strings = z.read('xl/sharedStrings.xml').decode()
        for name in ('Обзвон спящих', 'Промокоды', 'Гости по промокодам'):
            self.assertIn(name, book)
        self.assertIn('дарим час STANDART', strings)
        self.assertNotIn('200 бонусов', strings)

    def test_report_unavailable_without_credentials(self):
        self.assertIsNone(analytics.fetch_promo_report({}))

if __name__ == '__main__':
    unittest.main()
