import unittest
from datetime import datetime
from desktop.club_stats import compute, public, zone, MSK


def sess(uid, day, hour, minutes, host='101'):
    start = datetime(2026, *day, hour, 0, tzinfo=MSK)
    return {'userId': uid, 'startTime': start.isoformat(), 'totalMinutes': minutes, 'hostNumber': host}


class ClubStatsTests(unittest.TestCase):
    def raw(self):
        users = [{'id': 1, 'username': 'old', 'userGroupId': 8, 'createdTime': '2026-01-10T12:00:00+03:00'},
                 {'id': 2, 'username': 'new_back', 'userGroupId': 8, 'createdTime': '2026-10-05T12:00:00+03:00'},
                 {'id': 3, 'username': 'new_once', 'userGroupId': 8, 'createdTime': '2026-10-07T12:00:00+03:00'},
                 {'id': 4, 'username': 'never', 'userGroupId': 8, 'createdTime': '2026-10-08T12:00:00+03:00'},
                 {'id': 9, 'username': 'admin', 'userGroupId': 1, 'createdTime': '2026-10-01T12:00:00+03:00'}]
        sessions = [sess(1, (10, 1), 20, 120, '12'), sess(1, (10, 2), 2, 60), sess(1, (10, 3), 21, 60), sess(1, (10, 4), 21, 30),
                    sess(2, (10, 5), 18, 90), sess(2, (10, 5), 22, 30, '1'), sess(2, (11, 1), 19, 60, '22'),
                    sess(3, (10, 7), 18, 45), sess(9, (10, 1), 10, 600)]
        return {'users': users, 'groups': {8: '18+', 1: 'админы'}, 'sessions': sessions,
                'sales': [{'transactionDate': '2026-10-05T18:00:00+03:00', 'title': 'Red Bull', 'total': 150}],
                'spending': [{'userId': 1, 'total': 900}, {'userId': 2, 'total': 300}],
                'first': datetime(2025, 12, 1, tzinfo=MSK), 'now': datetime(2026, 11, 14, 12, tzinfo=MSK), 'errors': []}

    def test_months_new_back_active(self):
        r = compute(self.raw())
        oct_ = next(m for m in r['months'] if m['month'] == '2026-10')
        self.assertEqual(oct_['new'], 2)          # new_back and new_once played in their first month; «never» did not
        self.assertEqual(oct_['came_back'], 1)    # only new_back came on a second day
        self.assertEqual(oct_['active'], 3)       # the admin group is not a guest
        self.assertEqual(oct_['regular'], 1)      # «old» came on 4 days
        self.assertEqual(oct_['visits'], 6)       # two sessions on one day are one visit
        self.assertEqual(oct_['revenue'], 150)
        s = r['summary']
        self.assertEqual((s['accounts'], s['played'], s['never_played']), (4, 3, 1))
        self.assertEqual(s['return_rate'], 50)

    def test_zones_and_heat(self):
        r = compute(self.raw())
        zones = {z['zone']: z['hours'] for z in r['zones']}
        self.assertEqual(set(zones), {'STANDART', 'VIP 1', 'VIP 2', 'TV'})
        self.assertEqual(sum(map(sum, r['heat'])), 7)
        self.assertEqual((zone('11'), zone('25'), zone('1'), zone('104')), ('VIP 1', 'VIP 2', 'TV', 'STANDART'))

    def test_nicknames_never_leave_the_club(self):
        r = compute(self.raw())
        self.assertEqual(r['local']['top_hours'][0]['nick'], 'old')
        self.assertNotIn('old', str(public(r)))
        self.assertNotIn('new_back', str(public(r)))


class RevenueTests(ClubStatsTests):
    def test_deposit_purchases_are_not_counted_twice(self):
        raw = self.raw()
        raw['sales'] = [
            {'transactionDate': '2026-10-05T18:00:00+03:00', 'title': 'Пополнение депозита', 'total': 500, 'paymentMethodName': 'Наличные'},
            {'transactionDate': '2026-10-05T18:10:00+03:00', 'title': 'Red Bull', 'total': 150, 'paymentMethodName': 'Депозит'},
            {'transactionDate': '2026-10-05T18:20:00+03:00', 'title': 'Чипсы', 'total': 100, 'paymentMethodName': 'Карта'},
            {'transactionDate': '2026-10-05T18:30:00+03:00', 'title': 'Вода', 'total': 50, 'paymentMethodName': 'Баллы'},
            {'transactionDate': '2026-10-06T12:00:00+03:00', 'title': 'Чипсы', 'total': -100, 'paymentMethodName': 'Карта'}]
        oct_ = next(m for m in compute(raw)['months'] if m['month'] == '2026-10')
        self.assertEqual(oct_['revenue'], 500)      # 500 cash top-up + 100 card − 100 card refund; deposit and points are not new money
        self.assertEqual(oct_['topups'], 500)
        self.assertEqual(oct_['from_deposit'], 150)

    def test_server_copy_has_guests_by_id_only(self):
        pub = public(compute(self.raw()))
        self.assertEqual({g['id'] for g in pub['guests']}, {1, 2, 3})
        self.assertNotIn('username', str(pub['guests']))


if __name__ == '__main__':
    unittest.main()
