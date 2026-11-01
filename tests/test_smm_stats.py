import threading
import unittest
from desktop import smm_stats


class Cloud:
    def __init__(self):
        self.sent = []

    def request(self, path, method='POST', body=None):
        if body['action'] == 'promo_report':
            return {'codes': [{'code': 'HEADSHOT'}, {'code': 'LEVELUP'}],
                    'redemptions': [
                        {'code': 'HEADSHOT', 'status': 'done', 'gizmo_user_id': 7, 'decided_at': '2026-11-02T10:00:00+00:00'},
                        {'code': 'HEADSHOT', 'status': 'done', 'gizmo_user_id': 8, 'decided_at': '2026-11-02T11:00:00+00:00'},
                        {'code': 'HEADSHOT', 'status': 'awaiting_admin', 'gizmo_user_id': None},
                        {'code': 'LEVELUP', 'status': 'rejected', 'gizmo_user_id': 9}]}
        self.sent.append(body)
        return {'ok': True}


class Gizmo:
    def request(self, method, path, params=None, timeout=None):
        uid = params.get('userId') or params.get('UserId')
        if path == 'reports/users/spending':
            return [{'userId': uid, 'total': 450 if uid == 7 else 0}]
        days = ['2026-11-02T12:00:00Z', '2026-11-05T12:00:00Z'] if uid == 7 else ['2026-11-02T12:00:00Z']
        return {'sessions': [{'startTime': d, 'billedSpan': 1.5} for d in days]}


class SmmStatsTest(unittest.TestCase):
    def test_push_sends_only_numbers_per_code(self):
        cloud = Cloud()
        rows = smm_stats.push(cloud, Gizmo())
        by = {r['code']: r for r in rows}
        self.assertEqual(by['HEADSHOT'], {'code': 'HEADSHOT', 'guests': 2, 'returned': 1, 'revenue': 450})
        self.assertEqual(by['LEVELUP'], {'code': 'LEVELUP', 'guests': 0, 'returned': 0, 'revenue': 0})
        sent = cloud.sent[-1]
        self.assertEqual(sent['action'], 'smm_club_push')
        self.assertEqual(set(sent['rows'][0]), {'code', 'guests', 'returned', 'revenue'})

    def test_loop_reports_errors_and_stops(self):
        class Broken(Cloud):
            def request(self, *a, **k):
                raise RuntimeError('нет связи')
        stop, errors = threading.Event(), []
        smm_stats.INTERVAL = 0.01
        waits = iter([False, True])
        stop.wait = lambda t: next(waits)
        smm_stats.loop(stop, Broken(), Gizmo(), report=errors.append)
        self.assertEqual(errors, ['нет связи'])


if __name__ == '__main__':
    unittest.main()
