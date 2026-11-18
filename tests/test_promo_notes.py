import unittest
from datetime import datetime
from desktop.promo_notes import find, compute
from desktop.tbank import MSK

NOW = datetime(2026, 11, 18, 12, 0, tzinfo=MSK)
NOTES = {
    1: [{'text': 'Взял гориллу', 'createdTime': '2026-11-10T20:05:00'}, {'text': 'старая заметка', 'createdTime': '2026-10-01T10:00:00'}],
    2: [{'text': 'ГОРИЛЛА выдана', 'createdTime': '2026-11-11T18:00:00'}],
    3: [{'text': 'горилла', 'createdTime': '2026-11-12T12:00:00', 'isDeleted': True}],
    4: [{'text': 'ничего', 'createdTime': '2026-11-12T12:00:00'}],
}
DEPOSITS = [
    {'userId': 1, 'type': 0, 'amount': 1000, 'date': '2026-11-10T19:40:00'},   # with the can
    {'userId': 1, 'type': 0, 'amount': 500, 'date': '2026-11-14T15:00:00'},    # came back and topped up
    {'userId': 1, 'type': 2, 'amount': 300, 'date': '2026-11-14T15:05:00'},    # a charge, not a top-up
    {'userId': 2, 'type': 0, 'amount': 700, 'date': '2026-11-11T18:30:00'},
    {'userId': 4, 'type': 0, 'amount': 9999, 'date': '2026-11-11T18:30:00'},
]
SESSIONS = [{'userId': 1, 'startTime': '2026-11-10T19:45:00'}, {'userId': 1, 'startTime': '2026-11-14T15:10:00'},
            {'userId': 2, 'startTime': '2026-11-11T18:40:00'}]
USERS = {1: {'username': '79990000001'}, 2: {'username': '79990000002'}}


class PromoNotesTests(unittest.TestCase):
    def test_finds_word_in_any_case_skips_deleted(self):
        hits = find(NOTES, 'горилл')
        self.assertEqual(sorted(hits), [1, 2])

    def test_report(self):
        r = compute(find(NOTES, 'горилл'), DEPOSITS, SESSIONS, USERS, NOW)
        s = r['summary']
        self.assertEqual(s['people'], 2)
        self.assertEqual((s['topped_that_visit'], s['that_visit_sum'], s['avg_that_visit']), (2, 1700, 850))
        self.assertEqual((s['topped_again'], s['again_sum']), (1, 500))
        self.assertEqual((s['came_back'], s['came_back_pct']), (1, 50))
        g1 = next(g for g in r['guests'] if g['id'] == 1)
        self.assertEqual((g1['topup'], g1['later_sum'], g1['later_count'], g1['visits_after']), (1000, 500, 1, 1))


if __name__ == '__main__':
    unittest.main()


class DayNotesTests(unittest.TestCase):
    def test_all_notes_of_the_day_with_gorilla_and_600_marked(self):
        from desktop.promo_notes import day_report, find
        from datetime import timedelta
        since = NOW - timedelta(hours=24)
        notes = {
            1: [{'text': 'Горила за 600р', 'createdTime': '2026-11-18T01:00:00'}],
            2: [{'text': 'Gorilla выдана', 'createdTime': '2026-11-17T20:00:00'}],
            3: [{'text': 'пополнил 600 ₽', 'createdTime': '2026-11-17T22:00:00'}, {'text': 'старое', 'createdTime': '2026-11-10T22:00:00'}],
            4: [{'text': 'просил наушники', 'createdTime': '2026-11-18T09:00:00'}],
        }
        deposits = [{'userId': 1, 'type': 0, 'amount': 600.0, 'date': '2026-11-18T00:55:00'}, {'userId': 5, 'type': 0, 'amount': 600, 'date': '2026-11-18T03:00:00'},
                    {'userId': 6, 'type': 0, 'amount': 6000, 'date': '2026-11-18T03:00:00'}]
        r = day_report(notes, {1: {'username': '79990000001'}}, deposits, since, NOW)
        s = r['summary']
        self.assertEqual((s['notes'], s['gorilla_notes'], s['six_notes'], s['both_notes']), (4, 2, 2, 1))
        self.assertEqual((s['topups_600'], s['topups_600_with_gorilla_note']), (2, 1))
        self.assertEqual(sorted(find(notes, 'горилл')), [1, 2], 'the keyword search also finds «горила» and «Gorilla»')
