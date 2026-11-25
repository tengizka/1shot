import unittest
from datetime import datetime, timedelta
from unittest.mock import Mock, patch

from desktop.club_stats import MSK
from desktop.regulars import Regulars, collect


NOW = datetime(2026, 11, 25, 12, tzinfo=MSK)


class GizmoFixture:
    def request(self, method, path, params=None, **kwargs):
        if path == 'usergroups':
            return [{'id': 1, 'name': 'Клиенты'}, {'id': 2, 'name': 'Персонал'}]
        if path == 'users':
            return [
                {'id': uid, 'userGroupId': 2 if uid == 5 else 1, 'username': f'guest{uid}',
                 'firstName': 'Имя', 'lastName': 'Фамилия', 'phone': '70000000000',
                 'mobilePhone': '+70000000001' if uid == 1 else None}
                for uid in range(1, 8)
            ]
        if path == 'reports/sessionslog':
            start = datetime.fromisoformat(params['DateFrom'])
            end = datetime.fromisoformat(params['DateTo'])
            sessions = []
            for uid, offsets in {1: [0, 1, 5, 8, 8], 2: [30, 31, 32, 33], 3: [0, 1, 2],
                                 4: [0, 1, 2, 3], 5: [0, 1, 2, 3], 6: [0, 1, 2, 3],
                                 7: [0, 1, 2, 3]}.items():
                for offset in offsets:
                    time = NOW - timedelta(days=offset, hours=1)
                    if start <= time <= end:
                        sessions.append({'userId': uid, 'startTime': time.isoformat()})
            return {'sessions': sessions}
        if path == 'reports/users/spending':
            return [{'userId': uid, 'cash': 300 if uid == 7 else 3000,
                     'creditCard': 0, 'deposits': 0, 'points': 4000, 'total': 5000}
                    for uid in range(1, 8)]
        raise AssertionError(path)

    def sessions(self):
        return [{'userId': 3, 'lastLogin': (NOW - timedelta(days=3)).isoformat()}]


class RegularsTests(unittest.TestCase):
    def test_segments_use_distinct_visit_days_paid_spend_and_contact_fields(self):
        report = collect(GizmoFixture(), {4, 6}, 4, 3000, NOW)
        self.assertEqual([row['username'] for row in report['active']], ['guest1', 'guest3'])
        self.assertEqual([row['username'] for row in report['sleeping']], ['guest2'])
        self.assertEqual(report['active'][0]['visits'], 4)
        self.assertEqual(report['active'][0]['phone'], '+70000000001')
        self.assertEqual(report['sleeping'][0]['phone'], '70000000000')
        self.assertEqual(report['sleeping'][0]['last_visit'], '2026-10-26')

    def test_only_counts_and_criteria_are_sent_to_the_cloud(self):
        cloud = Mock()
        cloud.desk.side_effect = [{'accounts': []}, {'ok': True}]
        service = Regulars(GizmoFixture(), cloud)
        with patch('desktop.regulars.datetime') as now:
            now.now.return_value = NOW
            service._run(4, 3000)
        cloud.desk.assert_called_with('report', kind='guest_regulars', data={
            'at': NOW.isoformat(), 'minimum_visits': 4, 'minimum_spend': 3000,
            'active_count': 4, 'sleeping_count': 1,
        })
        self.assertTrue(service.snapshot()['synced'])

    def test_local_results_remain_when_server_rejects_summary(self):
        cloud = Mock()
        cloud.desk.side_effect = [{'accounts': []}, {'ok': False}]
        service = Regulars(GizmoFixture(), cloud)
        with patch('desktop.regulars.datetime') as now:
            now.now.return_value = NOW
            service._run(4, 3000)
        self.assertFalse(service.snapshot()['synced'])
        self.assertEqual(service.snapshot()['result']['sleeping'][0]['phone'], '70000000000')


if __name__ == '__main__':
    unittest.main()
