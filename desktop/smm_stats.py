"""SMM dashboard feed: once an hour Desk sends per-promo-code totals that only Gizmo knows
(guests who came back, money they spent after the free hour) to the club server.
Only numbers per code leave the club PC: no names, phones, usernames or Gizmo ids."""
import os
from datetime import datetime, timezone

INTERVAL = 3600


def enabled():
    return os.getenv('SMM_STATS_ENABLED', 'true').strip().lower() == 'true'


def _date(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None


def guest_activity(gizmo, uid, since):
    """Spend and number of distinct visit days after approval. The free hour costs 0 ₽ and adds nothing."""
    start = since.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    spent = 0.0
    rows = gizmo.request('GET', 'reports/users/spending', params={'userId': uid, 'start': start}, timeout=(3, 20)) or []
    for row in rows if isinstance(rows, list) else []:
        if isinstance(row, dict) and row.get('userId') == uid:
            spent = float(row.get('total') or 0)
    report = gizmo.request('GET', 'reports/sessionslog', params={'UserId': uid, 'DateFrom': start,
                           'DateTo': datetime.now(timezone.utc).strftime('%Y-%m-%dT23:59:59Z')}, timeout=(3, 20))
    days = set()
    for sess in (report.get('sessions') or []) if isinstance(report, dict) else []:
        started = _date(sess.get('startTime'))
        if started and float(sess.get('billedSpan') or sess.get('span') or 0) > 0:
            days.add(started.date())
    return spent, len(days)


def collect(cloud, gizmo):
    report = cloud.request('club-desk', body={'action': 'promo_report'})
    totals = {c['code']: {'code': c['code'], 'guests': 0, 'returned': 0, 'revenue': 0.0}
              for c in report.get('codes', []) if isinstance(c, dict) and c.get('code')}
    for r in report.get('redemptions', []):
        uid = r.get('gizmo_user_id')
        if r.get('status') != 'done' or not isinstance(uid, int) or r.get('code') not in totals:
            continue
        since = _date(r.get('decided_at')) or _date(r.get('created_at')) or datetime.now(timezone.utc)
        spent, days = guest_activity(gizmo, uid, since)
        row = totals[r['code']]
        row['guests'] += 1
        row['returned'] += 1 if days >= 2 else 0
        row['revenue'] += spent
    return [{**row, 'revenue': round(row['revenue'])} for row in totals.values()]


def push(cloud, gizmo):
    rows = collect(cloud, gizmo)
    cloud.request('club-desk', body={'action': 'smm_club_push', 'rows': rows})
    return rows


def loop(stop, cloud, gizmo, online=lambda: True, report=lambda error: None):
    """First push a minute after start, then hourly. Errors are reported and retried next hour."""
    wait = 60
    while not stop.wait(wait):
        wait = INTERVAL
        if not enabled() or not online():
            continue
        try:
            push(cloud, gizmo)
            report('')
        except Exception as error:  # noqa: BLE001 — stats must never disturb the Desk
            report(str(error)[:160])
