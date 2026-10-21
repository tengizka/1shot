"""One-shot on-screen notices in the 1SHOT style.

Each notice is a small frameless, always-on-top window in the bottom-right corner
of the main screen. It never takes focus, closes by itself and is never replayed:
callers pass already-consumed events (see NotificationGate). Up to MAX_VISIBLE
notices stack upwards; extra ones replace the oldest.
"""
import base64
import html
import threading
from pathlib import Path

WIDTH, HEIGHT, GAP, MARGIN, TASKBAR = 372, 112, 10, 16, 48
LIFETIME = 7.0
MAX_VISIBLE = 3
ACCENTS = {'created': '#A3FF10', 'waiting': '#FFFFFF', 'attention': '#E93E97', 'reminder': '#FFB10B', 'update': '#A3FF10', 'info': '#A3FF10'}
LABELS = {'created': 'Новая бронь', 'waiting': 'Ожидание ПК', 'attention': 'Нужна проверка', 'reminder': 'Напоминание', 'update': 'Обновление', 'info': '1SHOT Desk'}


def _font(root):
    try:
        data = (Path(root) / 'assets' / 'fonts' / 'resquare' / 'ReSquare-Bold.ttf').read_bytes()
        return "@font-face{font-family:'ReSquare';font-weight:700;src:url(data:font/ttf;base64," + base64.b64encode(data).decode() + ") format('truetype')}"
    except OSError:
        return ''


def render(kind, title, text, stamp, font_css=''):
    accent = ACCENTS.get(kind, ACCENTS['info'])
    label = html.escape(LABELS.get(kind, LABELS['info']))
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>{font_css}
*{{margin:0;padding:0;box-sizing:border-box}}
html,body{{width:100%;height:100%;overflow:hidden;background:#000;color:#fff;font:500 12px/1.45 "Segoe UI",system-ui,sans-serif;cursor:default;user-select:none}}
body{{border:2px solid #2A2A2B;border-top:3px solid {accent};padding:12px 14px;display:flex;flex-direction:column;gap:6px;animation:in .35s cubic-bezier(.16,1,.3,1) both}}
.top{{display:flex;justify-content:space-between;align-items:center;gap:10px}}
.tag{{background:{accent};color:#000;font:800 10px/1 "Segoe UI",sans-serif;letter-spacing:.14em;text-transform:uppercase;padding:5px 8px}}
.time{{color:#9A9A9A;font-size:11px}}
h1{{font:700 20px/1.05 ReSquare,"Segoe UI",sans-serif;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
p{{color:#cfcfcf;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
.bar{{position:fixed;left:0;bottom:0;height:3px;background:{accent};animation:life {LIFETIME}s linear both}}
body.out{{animation:out .25s ease-in both}}
@keyframes in{{from{{opacity:0;transform:translateX(24px)}}}}
@keyframes out{{to{{opacity:0;transform:translateX(24px)}}}}
@keyframes life{{from{{width:100%}}to{{width:0}}}}
</style></head><body onclick="document.body.classList.add('out')">
<div class="top"><span class="tag">{label}</span><span class="time">{html.escape(stamp)}</span></div>
<h1>{html.escape(title)}</h1><p>{html.escape(text)}</p><i class="bar"></i>
<script>setTimeout(()=>document.body.classList.add('out'),{int(LIFETIME*1000)-260})</script>
</body></html>'''


class Toaster:
    """factory(html, x, y, width, height) -> window with .destroy(); screen() -> (width, height)."""

    def __init__(self, factory, screen, root='.', timer=threading.Timer, lifetime=LIFETIME):
        self.factory, self.screen, self.timer, self.lifetime = factory, screen, timer, lifetime
        self.font_css = _font(root)
        self.slots = [None] * MAX_VISIBLE
        self.lock = threading.Lock()

    def position(self, slot):
        width, height = self.screen()
        x = max(0, width - WIDTH - MARGIN)
        y = max(0, height - TASKBAR - MARGIN - (slot + 1) * HEIGHT - slot * GAP)
        return x, y

    def show(self, kind, title, text, stamp=''):
        with self.lock:
            slot = next((i for i, w in enumerate(self.slots) if w is None), None)
            if slot is None:
                slot = 0
                self._close(0)
            x, y = self.position(slot)
            window = self.factory(render(kind, title, text, stamp, self.font_css), x, y, WIDTH, HEIGHT)
            self.slots[slot] = window
        timer = self.timer(self.lifetime, self.expire, args=(slot, window))
        timer.daemon = True
        timer.start()
        return slot

    def expire(self, slot, window):
        with self.lock:
            if self.slots[slot] is window:
                self._close(slot)

    def _close(self, slot):
        window, self.slots[slot] = self.slots[slot], None
        if window is not None:
            try:
                window.destroy()
            except Exception:
                pass

    def close_all(self):
        with self.lock:
            for slot in range(MAX_VISIBLE):
                self._close(slot)


def describe(event, rows):
    """Turn a club event into (kind, title, text) using the booking it refers to."""
    kind = event.get('kind') if event.get('kind') in ('created', 'waiting', 'attention') else 'info'
    booking = next((b for b in rows if b.get('id') == event.get('booking_id')), None) or {}
    host = booking.get('host_id')
    title = ('PS5' if str(host) == '1' else f'ПК {host}') if host else LABELS[kind]
    guest = booking.get('guest_name') or booking.get('username') or ''
    detail = {'created': 'Бронь из мини-приложения', 'waiting': 'ПК занят, ждём освобождения', 'attention': 'Откройте Desk и проверьте бронь'}.get(kind, 'Событие клуба')
    return kind, title, ' · '.join(x for x in (guest, detail) if x)
