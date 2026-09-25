"""Exercise the packaged Windows browser and Python bridge without any club I/O."""
import json
import sys
import time
from .version import VERSION, AUTHOR, APP_TITLE
from pathlib import Path

class PreviewApi:
    def snapshot(self):
        return dict(online=False, error='', sync_error='', last_sync=0, alerts=0, muted=False, hosts=[], password_requests=[], protocol_ready=True, sound={'preset':'soft','volume':50,'repeat':20,'enabled':True},
                    rows=[dict(id='smoke-only', username='Проверка интерфейса', host_id='101',
                               mode='arrival', duration_kind='hour', status='requested',
                               starts_at='2026-09-25T12:00:00Z', ends_at='2026-09-25T13:00:00Z',
                               hold_until='2026-09-25T13:00:00Z', message='Без подключения к клубу', code=None)])
    def acknowledge(self):return True
    def mute(self):return True
    def test_sound(self):return True

def main(report):
    output=Path(report)
    window=None
    def save(ok,error=''):
        output.write_text(json.dumps({'ok':ok,'error':error,'backend':'qt'},ensure_ascii=False),encoding='utf-8')
    try:
        import webview
        root=Path(getattr(sys,'_MEIPASS',Path(__file__).resolve().parents[1]))
        window=webview.create_window('1SHOT startup test',str(root/'desktop'/'index.html'),
                                     js_api=PreviewApi(),width=1000,height=700,frameless=True,easy_drag=False)
        def check():
            try:
                until=time.monotonic()+45
                while time.monotonic()<until:
                    branding=window.evaluate_js("({version: document.getElementById('build-version')?.textContent, author: document.getElementById('build-author')?.textContent, title: document.title})")
                    ready=window.evaluate_js("""Boolean(
                      document.querySelector('.card h2')?.textContent === 'ПК 101' &&
                      document.fonts.check('600 12px Unbounded', 'Проверка') && [...document.fonts].some(f=>f.family==='Unbounded' && f.status==='loaded') &&
                      window.pywebview?.api?.snapshot
                    )""")
                    if ready and branding == {'version':'CLUB DESK / v'+VERSION,'author':AUTHOR,'title':APP_TITLE}:
                        # Exercise the real production close handler, without club I/O.
                        import threading
                        from unittest.mock import Mock,patch
                        from contextlib import nullcontext
                        from .app import App
                        shell=App.__new__(App);shell.window=window;shell.exiting=False
                        shell.exit_prompt=threading.Lock();shell.stop=threading.Event();shell.sound=Mock();shell.tray=None
                        window.events.closing+=shell.close
                        window.destroy();time.sleep(.3)
                        if window.events.closed.is_set():raise RuntimeError('Close-to-tray incorrectly terminated the window')
                        save(True)
                        with patch('ctypes.windll.user32.MessageBoxW',return_value=6) if sys.platform=='win32' else nullcontext():
                            shell.quit()
                        return
                    time.sleep(.25)
                save(False,'HTML, font, or JS-to-Python bridge did not become ready')
            except Exception as error:save(False,repr(error))
            finally:window.destroy()
        webview.start(check,gui='qt',debug=False,icon=str(root/'desktop'/'assets'/'app.ico'))
    except Exception as error:
        save(False,repr(error))
    if not output.exists():save(False,'Window exited without completing the startup check')

if __name__=='__main__':main(sys.argv[1])
