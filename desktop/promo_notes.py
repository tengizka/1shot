"""«Акция по заметкам»: who got a promo item (the admins write it in the guest's Gizmo note, e.g. «взял гориллу»),
how much they topped up on that visit, and who came back and topped up again afterwards.

Reads Gizmo only: every guest's notes (GET users/{id}/note, with the note's date), deposit transactions
(GET v2.0/deposittransactions) and the sessions log. The summary that leaves the club has no names or phones.
"""
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

from .tbank import MSK, _date

TOPUP_TYPE = 0          # Gizmo DepositTransactionType: 0 = money put on the deposit
BEFORE = timedelta(hours=3)   # the top-up that came with the promo: up to 3 h before the note …
AFTER = timedelta(hours=1)    # … or up to 1 h after it (the note is often written once the can is handed over)


def _rows(value, key):
    if isinstance(value, dict):
        value = value.get(key, value.get('data', value.get('result')))
    return value if isinstance(value, list) else []


# Admins write it every way: «горилла», «гориллу», «горила», «Gorilla», «горил»; and the price as «600», «600р», «600 ₽».
GORILLA = re.compile(r'г[оа]р+[иы]л+|gor+il+', re.I)
SIX_HUNDRED = re.compile(r'(?<!\d)600(?!\d)')


def pattern(word):
    w = word.strip().casefold().replace('ё', 'е')
    return GORILLA if GORILLA.match(w) or w.startswith('горил') else re.compile(re.escape(w))


def find(notes_by_user, word):
    """{uid: [note…]} -> {uid: (first matching note date, text)}; deleted notes are skipped."""
    rx = pattern(word)
    out = {}
    for uid, notes in notes_by_user.items():
        for n in notes:
            if not isinstance(n, dict) or n.get('isDeleted'):
                continue
            text = str(n.get('text') or '')
            at = _date(n.get('createdTime') or n.get('modifiedTime'))
            if at and rx.search(text.casefold().replace('ё', 'е')) and (uid not in out or at < out[uid][0]):
                out[uid] = (at, text.strip()[:200])
    return out


def compute(hits, deposits, sessions, users, now):
    """The report. hits: {uid: (at, text)}; deposits: v2 rows; sessions: sessionslog rows; users: {uid: user}."""
    money = {}
    for d in deposits:
        if not isinstance(d, dict) or d.get('type') != TOPUP_TYPE:
            continue
        amount, at = d.get('amount'), _date(d.get('date'))
        if at and isinstance(amount, (int, float)) and not isinstance(amount, bool) and amount > 0:
            money.setdefault(d.get('userId'), []).append((at, float(amount)))
    plays = {}
    for s in sessions:
        at = _date(s.get('startTime')) if isinstance(s, dict) else None
        if at and not s.get('userIsGuest'):
            plays.setdefault(s.get('userId'), []).append(at)
    guests = []
    for uid, (at, text) in hits.items():
        mine = money.get(uid, [])
        that_visit = [a for t, a in mine if at - BEFORE <= t <= at + AFTER]
        later = [a for t, a in mine if t > at + AFTER]
        came_back = sorted({p.date() for p in plays.get(uid, []) if p.date() > at.date()})
        u = users.get(uid) or {}
        guests.append({'id': uid, 'nick': u.get('username') or f'ID {uid}', 'name': ' '.join(x for x in (u.get('firstName'), u.get('lastName')) if x),
                       'at': at.isoformat(), 'note': text, 'topup': round(sum(that_visit)), 'later_sum': round(sum(later)),
                       'later_count': len(later), 'visits_after': len(came_back), 'last_visit': came_back[-1].isoformat() if came_back else None})
    guests.sort(key=lambda g: g['at'], reverse=True)
    n = len(guests)
    pct = lambda k: round(100 * k / n) if n else 0
    topped, again, back = [g for g in guests if g['topup']], [g for g in guests if g['later_count']], [g for g in guests if g['visits_after']]
    by_day = {}
    for g in guests:
        by_day[g['at'][:10]] = by_day.get(g['at'][:10], 0) + 1
    summary = {'people': n, 'from': min((g['at'] for g in guests), default=None), 'to': max((g['at'] for g in guests), default=None),
               'topped_that_visit': len(topped), 'topped_that_visit_pct': pct(len(topped)), 'that_visit_sum': sum(g['topup'] for g in guests),
               'avg_that_visit': round(sum(g['topup'] for g in topped) / len(topped)) if topped else 0,
               'topped_again': len(again), 'topped_again_pct': pct(len(again)), 'again_sum': sum(g['later_sum'] for g in guests),
               'came_back': len(back), 'came_back_pct': pct(len(back)), 'by_day': dict(sorted(by_day.items())), 'at': now.isoformat()}
    return {'summary': summary, 'guests': guests}


def day_report(notes_by_user, users, deposits, since, now):
    """Every note written since `since`, with what it says about the gorilla and 600, plus the 600 ₽ top-ups of that time."""
    nick = lambda uid: (users.get(uid) or {}).get('username') or f'ID {uid}'
    rows = []
    for uid, notes in notes_by_user.items():
        for n in notes:
            if not isinstance(n, dict) or n.get('isDeleted'):
                continue
            at = _date(n.get('createdTime') or n.get('modifiedTime'))
            text = str(n.get('text') or '').strip()
            if at and at >= since and text:
                low = text.casefold().replace('ё', 'е')
                rows.append({'id': uid, 'nick': nick(uid), 'at': at.isoformat(), 'text': text[:400],
                             'gorilla': bool(GORILLA.search(low)), 'six': bool(SIX_HUNDRED.search(low))})
    rows.sort(key=lambda r: r['at'], reverse=True)
    tops = []
    for d in deposits:
        at = _date(d.get('date')) if isinstance(d, dict) else None
        if at and at >= since and d.get('type') == TOPUP_TYPE and d.get('amount') == 600:
            tops.append({'id': d.get('userId'), 'nick': nick(d.get('userId')), 'at': at.isoformat()})
    gor_users = {r['id'] for r in rows if r['gorilla']}
    summary = {'hours': round((now - since).total_seconds() / 3600), 'notes': len(rows), 'guests': len({r['id'] for r in rows}),
               'gorilla_notes': sum(r['gorilla'] for r in rows), 'gorilla_guests': len(gor_users),
               'six_notes': sum(r['six'] for r in rows), 'both_notes': sum(r['gorilla'] and r['six'] for r in rows),
               'topups_600': len(tops), 'topups_600_with_gorilla_note': sum(1 for t in tops if t['id'] in gor_users)}
    return {'mode': 'day', 'summary': summary, 'notes': rows, 'topups_600': sorted(tops, key=lambda t: t['at'], reverse=True)}


class PromoNotes:
    def __init__(self, gizmo, cloud):
        self.gizmo, self.cloud = gizmo, cloud
        self.lock = threading.Lock()
        self.state = {'busy': False, 'done': 0, 'total': 0, 'word': '', 'result': None, 'error': ''}

    def snapshot(self):
        with self.lock:
            return dict(self.state)

    def start(self, word):
        word = str(word or '').strip()
        if not 3 <= len(word) <= 40:
            return {'error': 'Слово из заметки: от 3 до 40 букв'}
        with self.lock:
            if self.state['busy']:
                return {'error': 'Уже считаем, подождите'}
            self.state.update(busy=True, done=0, total=0, word=word, error='')
        threading.Thread(target=self._run, args=(word,), daemon=True).start()
        return {'ok': True}

    def _notes(self, uid):
        for attempt in range(3):
            try:
                return uid, _rows(self.gizmo.request('GET', f'users/{int(uid)}/note', timeout=(3, 20)), 'notes')
            except Exception:
                time.sleep(0.5 * (attempt + 1))
        return uid, None

    def _read_all(self):
        users = {u['id']: u for u in _rows(self.gizmo.request('GET', 'users', params={'IsDeleted': False}, timeout=(3, 60)), 'users')
                 if isinstance(u, dict) and type(u.get('id')) is int}
        with self.lock:
            self.state['total'] = len(users)
        notes, failed = {}, 0
        with ThreadPoolExecutor(max_workers=6) as pool:
            for uid, rows in pool.map(self._notes, list(users)):
                if rows is None:
                    failed += 1
                else:
                    notes[uid] = rows
                with self.lock:
                    self.state['done'] += 1
        return users, notes, failed

    def _deposits(self, start, now):
        span = {'DateFrom': start.strftime('%Y-%m-%dT%H:%M:%S'), 'DateTo': (now + timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%S')}
        deposits, cursor = [], None
        for _ in range(100):   # paged; 100 pages × 500 rows is far beyond a club's month
            params = {**span, 'Pagination.Limit': 500, **({'Pagination.Cursor': cursor} if cursor else {})}
            page = self.gizmo.request('GET', 'v2.0/deposittransactions', params=params, timeout=(3, 60))
            deposits += _rows(page, 'data')
            cursor = page.get('nextCursor') if isinstance(page, dict) else None
            if not cursor:
                break
        return deposits, span

    def start_day(self, hours=24):
        hours = int(hours) if str(hours).isdigit() and 1 <= int(hours) <= 168 else 24
        with self.lock:
            if self.state['busy']:
                return {'error': 'Уже считаем, подождите'}
            self.state.update(busy=True, done=0, total=0, word=f'{hours} ч', error='')
        threading.Thread(target=self._run_day, args=(hours,), daemon=True).start()
        return {'ok': True}

    def _run_day(self, hours):
        try:
            users, notes, failed = self._read_all()
            now = datetime.now(MSK)
            since = now - timedelta(hours=hours)
            deposits, _ = self._deposits(since - timedelta(days=1), now)
            result = day_report(notes, users, deposits, since, now)
            result['failed'] = failed
            try:   # counts only, never the note texts
                self.cloud.desk('report', kind='promo_notes_day', data=result['summary'])
            except Exception:
                pass
            with self.lock:
                self.state.update(busy=False, result=result, error='' if not failed else f'Не прочитались заметки у {failed} гостей')
        except Exception as error:
            with self.lock:
                self.state.update(busy=False, error='Gizmo не отдал данные: ' + str(error)[:160])

    def _run(self, word):
        try:
            users, notes, failed = self._read_all()
            hits = find(notes, word)
            now = datetime.now(MSK)
            start = min((at for at, _ in hits.values()), default=now) - timedelta(days=1)
            deposits, span = self._deposits(start, now)
            sessions = _rows(self.gizmo.request('GET', 'reports/sessionslog', params=span, timeout=(3, 60)), 'sessions')
            result = compute(hits, deposits, sessions, users, now)
            result['word'], result['failed'] = word, failed
            types = {}
            for d in deposits:
                if isinstance(d, dict):
                    types[str(d.get('type'))] = types.get(str(d.get('type')), 0) + 1
            result['summary']['deposit_types'] = types   # to check what Gizmo calls a top-up
            try:   # counts only, no names: lets the owner see the result from the bot side too
                self.cloud.desk('report', kind='promo_notes', data={'word': word, **result['summary']})
            except Exception:
                pass
            with self.lock:
                self.state.update(busy=False, result=result, error='' if not failed else f'Не прочитались заметки у {failed} гостей')
        except Exception as error:
            with self.lock:
                self.state.update(busy=False, error='Gizmo не отдал данные: ' + str(error)[:160])
