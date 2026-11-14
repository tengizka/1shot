import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from desktop.engine import Store
from desktop.tbank import TBankShift, MSK


class Gizmo:
    def __init__(self):
        self.calls = []
        self.rows = []

    def request(self, method, path, **kw):
        self.calls.append((method, path))
        if path == 'reports/transactionslog':
            return {'transactions': self.rows}
        raise AssertionError('unexpected Gizmo call ' + path)


class Cloud:
    def __init__(self):
        self.reports = []

    def desk(self, action, **kw):
        self.reports.append((action, kw.get('kind')))
        return {'ok': True}


def op(minutes_ago, amount, method='Т-Банк', title='Пополнение депозита'):
    return {'transactionDate': (datetime.now(MSK) - timedelta(minutes=minutes_ago)).isoformat(), 'total': amount,
            'paymentMethodName': method, 'title': title, 'operatorName': 'Иван', 'invoiceId': 1}


class TBankTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name) / 'desk.sqlite3')
        self.gizmo, self.cloud = Gizmo(), Cloud()
        self.t = TBankShift(self.gizmo, self.cloud, self.store)
        self.store.set('tbank-shift', {'id': 's1', 'start': (datetime.now(MSK) - timedelta(hours=5)).isoformat()})

    def tearDown(self):
        self.temp.cleanup()

    def test_counts_only_tbank_since_shift_start(self):
        self.gizmo.rows = [op(10, 500), op(20, 1000, 'Tinkoff'), op(30, 300, 'Наличные'), op(40, 150, 'Депозит'),
                           op(600, 9999), op(5, -200)]   # before the shift; a refund
        s = self.t.status(True)
        self.assertEqual((s['count'], s['sum']), (3, 1300.0))

    def test_close_starts_a_new_count_and_keeps_history(self):
        self.gizmo.rows = [op(10, 500)]
        self.assertIn('error', self.t.close('s1'))                 # needs the second tap
        self.assertIn('error', self.t.close('old', True))          # a stale page cannot close twice
        r = self.t.close('s1', True)
        self.assertEqual((r['closed']['count'], r['closed']['sum']), (1, 500.0))
        s = self.t.status(True)
        self.assertNotEqual(s['id'], 's1')
        self.assertEqual((s['count'], s['sum']), (0, 0))           # the old operation is before the new start
        self.assertEqual(s['history'][0]['sum'], 500.0)
        self.assertIn(('report', 'tbank_shifts'), self.cloud.reports)

    def test_never_writes_to_gizmo(self):
        # «Закрыть смену» is our counter only: Gizmo is read, never written, and its shift is never closed.
        self.gizmo.rows = [op(10, 500)]
        self.t.status(True)
        self.t.close('s1', True)
        self.assertTrue(self.gizmo.calls)
        self.assertEqual({m for m, _ in self.gizmo.calls}, {'GET'})
        self.assertFalse(any('shift' in p for _, p in self.gizmo.calls))


class FeedTests(unittest.TestCase):
    def test_feed_has_amounts_and_sessions_without_names(self):
        from desktop.tbank import feed
        now = datetime.now(MSK)
        class G:
            calls = []
            def request(self, method, path, **kw):
                self.calls.append(method)
                if path == 'reports/transactionslog':
                    return {'transactions': [op(10, 500), op(20, 300, 'Наличные'), op(30, 150, 'Депозит', 'Red Bull'), op(3000, 999)]}
                return {'sessions': [{'startTime': (now - timedelta(hours=1)).isoformat(), 'userId': 7, 'totalMinutes': 90, 'userName': 'secret'}]}
        g = G()
        f = feed(g, now)
        self.assertEqual([(m['kind'], m['amount'], m['topup']) for m in f['money']], [('tbank', 500, True), ('cash', 300, True), ('deposit', 150, False)])
        self.assertEqual(f['sessions'], [{'at': f['sessions'][0]['at'], 'user': 7, 'minutes': 90}])
        self.assertNotIn('Иван', str(f)); self.assertNotIn('secret', str(f))
        self.assertEqual(set(g.calls), {'GET'})


if __name__ == '__main__':
    unittest.main()
