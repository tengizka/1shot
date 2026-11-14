import unittest
from datetime import datetime, timedelta
from desktop.recent import pick
from desktop.tbank import MSK

NOW = datetime(2026, 11, 14, 18, 0, tzinfo=MSK)
def row(mins, uid=None, value=500, **kw):
    return {'transactionDate': (NOW - timedelta(minutes=mins)).strftime('%Y-%m-%dT%H:%M:%S'), 'total': value, 'userId': uid, **kw}
USERS = {1: {'id': 1, 'username': 'ivan'}, 2: {'id': 2, 'username': 'petr'}, 3: {'id': 3, 'username': 'oleg'}, 4: {'id': 4, 'username': 'max'}, 5: {'id': 5, 'username': 'kim'}}

class RecentTests(unittest.TestCase):
    def test_newest_three_without_players_and_repeats(self):
        rows = [row(50, 1), row(5, 2), row(10, 2), row(15, 3), row(20, 4), row(30, 5)]
        out = pick(rows, USERS, playing={3}, now=NOW)
        self.assertEqual([o['user_id'] for o in out], [2, 4, 5])
    def test_old_refunds_staff_and_unknown_are_skipped(self):
        rows = [row(400, 1), row(5, 2, value=-300), row(6, 99), row(7, None, userName='Oleg')]
        out = pick(rows, USERS, playing=set(), now=NOW)
        self.assertEqual([o['user_id'] for o in out], [3], 'matched by nickname when there is no id')

if __name__ == '__main__':
    unittest.main()
