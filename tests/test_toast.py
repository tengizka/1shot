import unittest
from desktop.toast import Toaster, describe, render, MAX_VISIBLE, WIDTH


class Window:
    def __init__(self, html, x, y):
        self.html, self.x, self.y, self.closed = html, x, y, False
    def destroy(self):
        self.closed = True


class Timer:
    made = []
    def __init__(self, interval, fn, args=()):
        self.fn, self.args = fn, args
        Timer.made.append(self)
    def start(self):
        pass
    def fire(self):
        self.fn(*self.args)


class ToastTest(unittest.TestCase):
    def setUp(self):
        Timer.made = []
        self.windows = []
        def factory(html, x, y, w, h):
            win = Window(html, x, y)
            self.windows.append(win)
            return win
        self.toaster = Toaster(factory, lambda: (1920, 1080), root='.', timer=Timer)

    def test_stack_bottom_right_and_expire(self):
        for i in range(MAX_VISIBLE):
            self.toaster.show('created', f'ПК {i}', 'guest')
        xs = {w.x for w in self.windows}
        self.assertEqual(xs, {1920 - WIDTH - 16})
        ys = [w.y for w in self.windows]
        self.assertEqual(ys, sorted(ys, reverse=True), 'new notices stack upwards')
        Timer.made[0].fire()
        self.assertTrue(self.windows[0].closed)
        self.toaster.show('waiting', 'ПК 9', '')
        self.assertEqual(self.windows[-1].y, ys[0], 'a freed slot is reused')

    def test_overflow_replaces_oldest_and_close_all(self):
        for i in range(MAX_VISIBLE + 1):
            self.toaster.show('created', f'ПК {i}', '')
        self.assertTrue(self.windows[0].closed)
        self.toaster.close_all()
        self.assertTrue(all(w.closed for w in self.windows))

    def test_text_is_escaped(self):
        html = render('attention', '<img src=x onerror=alert(1)>', '<b>', '12:00')
        self.assertNotIn('<img src=x', html)
        self.assertIn('&lt;img', html)

    def test_describe_uses_booking(self):
        kind, title, text = describe({'kind': 'created', 'booking_id': 'b'}, [{'id': 'b', 'host_id': '14', 'username': 'guest'}])
        self.assertEqual((kind, title), ('created', 'ПК 14'))
        self.assertIn('guest', text)
        self.assertEqual(describe({'kind': 'attention', 'booking_id': 'x'}, [{'id': 'x', 'host_id': '1'}])[1], 'PS5')
        self.assertEqual(describe({'kind': 'weird'}, [])[0], 'info')


if __name__ == '__main__':
    unittest.main()
