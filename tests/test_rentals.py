import tempfile
import unittest
from pathlib import Path
from desktop.engine import Store
from desktop.rentals import Rentals, ITEMS


class RentalsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = Store(Path(self.tmp.name) / 'desk.sqlite')
        self.rentals = Rentals(self.store, clock=lambda: 1000)

    def test_add_list_return(self):
        a = self.rentals.add('powerbank', None, '  Вася   у стойки ')
        b = self.rentals.add('g304', '104', '')
        self.assertEqual(a['who'], 'Вася у стойки')
        self.assertEqual([r['item'] for r in Rentals(self.store).list()], ['powerbank', 'g304'])
        self.rentals.returned(a['id'])
        self.assertEqual([r['id'] for r in self.rentals.list()], [b['id']])
        with self.assertRaises(ValueError):
            self.rentals.returned(a['id'])
        history = Rentals(self.store).history()
        self.assertEqual([(h['id'], h['returned_at']) for h in history], [(a['id'], 1000)])

    def test_validation(self):
        self.assertEqual(len(ITEMS), 6)
        for item, host, who in [('laptop', '1', ''), ('pad', '1;drop', ''), ('pad', None, '  ')]:
            with self.assertRaises(ValueError):
                self.rentals.add(item, host, who)


    def test_rental_remembers_guest_account(self):
        row = self.rentals.add('g304', '104', 'neo', 7)
        self.assertEqual(row['user_id'], 7)
        self.rentals.returned(row['id'])
        self.assertEqual(self.rentals.history()[-1]['user_id'], 7)
        for bad in (0, -3, '7', True):
            with self.assertRaises(ValueError):
                self.rentals.add('g304', '104', 'neo', bad)

if __name__ == '__main__':
    unittest.main()
