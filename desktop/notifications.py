"""Durable at-most-once notification delivery; never changes booking state.

The watermark is written BEFORE sound/tray delivery. A crash in between may lose
one notification, but cannot replay it after restart. New events in one snapshot
are grouped into one sound, not a burst. Disabled sound still consumes events.
"""
class NotificationGate:
    def __init__(self, store):
        self.store = store
        existing = max((int(k) for k in store.get('alerts', {}) if str(k).isdigit()), default=0)
        self.cursor = max(int(store.get('notice_cursor', 0)), int(store.get('event_cursor', 0)), existing)
        store.set('notice_cursor', self.cursor)

    def consume(self, alerts):
        fresh = [(int(k), event) for k, event in alerts.items()
                 if str(k).isdigit() and int(k) > self.cursor]
        if not fresh:
            return []
        fresh.sort(key=lambda item: item[0])
        cursor = fresh[-1][0]
        self.store.set('notice_cursor', cursor)
        self.cursor = cursor
        return [event for _, event in fresh]
