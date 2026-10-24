"""Self-update from GitHub releases of tengizka/1shot.

A Desk release is tagged ``desk-vX.Y.Z`` and carries two assets: the Inno Setup
installer ``1SHOT-Desk-Setup.exe`` and ``1SHOT-Desk-Setup.exe.sha256``. The
installer is downloaded next to the local data, checked against the published
SHA-256 and started silently; it closes Desk, replaces the program files and
starts Desk again. Settings, the .env file and the journal live in
%LOCALAPPDATA%\\1SHOT Desk and are never touched.
"""
import hashlib
import re
import subprocess
import sys
import threading
from pathlib import Path

REPO = 'tengizka/1shot'
API = f'https://api.github.com/repos/{REPO}/releases?per_page=20'
TAG_PREFIX = 'desk-v'
ASSET = '1SHOT-Desk-Setup.exe'
CHECKSUM = ASSET + '.sha256'
SILENT_ARGS = ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CLOSEAPPLICATIONS']


def parse_version(value):
    """'desk-v3.0.1' or '3.0.1-alpha' -> ((3, 0, 1), is_final). Unknown -> None."""
    match = re.match(r'^(?:desk-)?v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$', str(value or '').strip())
    if not match:
        return None
    return tuple(int(x) for x in match.group(1, 2, 3)), match.group(4) is None


def newer(candidate, current):
    a, b = parse_version(candidate), parse_version(current)
    if not a:
        return False
    if not b:
        return True
    return a > b


class Updater:
    def __init__(self, home, current, http=None):
        if http is None:
            import requests
            http = requests
        self.home, self.current, self.http = Path(home), current, http
        self.lock = threading.Lock()
        self.state = {'phase': 'idle', 'current': current, 'latest': None, 'progress': 0, 'error': '', 'notes': ''}
        self.release = None
        self.installer = None

    def snapshot(self):
        with self.lock:
            return dict(self.state)

    def _set(self, **values):
        with self.lock:
            self.state.update(values)

    def pick(self, releases):
        """Newest published Desk release that has both assets."""
        best = None
        for release in releases or []:
            if release.get('draft') or not str(release.get('tag_name', '')).startswith(TAG_PREFIX):
                continue
            assets = {a.get('name'): a for a in release.get('assets') or []}
            if ASSET not in assets or CHECKSUM not in assets:
                continue
            version = parse_version(release['tag_name'])
            if not version:
                continue
            if best is None or version > parse_version(best['tag_name']):
                best = release
        return best

    def check(self):
        self._set(phase='checking', error='')
        try:
            response = self.http.get(API, headers={'Accept': 'application/vnd.github+json', 'User-Agent': '1SHOT-Desk'}, timeout=15)
            response.raise_for_status()
            release = self.pick(response.json())
        except Exception:
            self._set(phase='error', error='Не удалось проверить обновления. Проверьте интернет')
            return self.snapshot()
        if not release or not newer(release['tag_name'], self.current):
            self.release = None
            self._set(phase='latest', latest=release['tag_name'][len(TAG_PREFIX):] if release else self.current, notes='')
            return self.snapshot()
        self.release = release
        self._set(phase='available', latest=release['tag_name'][len(TAG_PREFIX):], notes=(release.get('body') or '')[:600])
        return self.snapshot()

    def download(self):
        release = self.release
        if not release:
            self._set(phase='error', error='Сначала проверьте обновления')
            return self.snapshot()
        assets = {a['name']: a for a in release['assets']}
        target_dir = self.home / 'updates'
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / (release['tag_name'] + '-' + ASSET)
        part = target.with_suffix('.part')
        self._set(phase='downloading', progress=0, error='')
        try:
            checksum = self.http.get(assets[CHECKSUM]['browser_download_url'], headers={'User-Agent': '1SHOT-Desk'}, timeout=15)
            checksum.raise_for_status()
            expected = checksum.text.strip().split()[0].lower()
            if not re.fullmatch(r'[0-9a-f]{64}', expected):
                raise ValueError('bad checksum file')
            response = self.http.get(assets[ASSET]['browser_download_url'], headers={'User-Agent': '1SHOT-Desk'}, timeout=30, stream=True)
            response.raise_for_status()
            total = int(response.headers.get('content-length') or assets[ASSET].get('size') or 0)
            digest, done = hashlib.sha256(), 0
            with open(part, 'wb') as file:
                for chunk in response.iter_content(chunk_size=256 * 1024):
                    if not chunk:
                        continue
                    file.write(chunk)
                    digest.update(chunk)
                    done += len(chunk)
                    if total:
                        self._set(progress=min(99, int(done * 100 / total)))
            if digest.hexdigest() != expected:
                part.unlink(missing_ok=True)
                self._set(phase='error', error='Файл обновления повреждён. Попробуйте ещё раз')
                return self.snapshot()
            part.replace(target)
        except Exception:
            part.unlink(missing_ok=True)
            self._set(phase='error', error='Не удалось скачать обновление. Проверьте интернет')
            return self.snapshot()
        self.installer = target
        self._set(phase='ready', progress=100)
        return self.snapshot()

    def launch(self, popen=subprocess.Popen):
        """Start the verified installer detached; the caller then quits Desk."""
        if not self.installer or not Path(self.installer).exists():
            raise RuntimeError('Обновление не скачано')
        flags = 0
        if sys.platform == 'win32':
            flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
        popen([str(self.installer), *SILENT_ARGS], creationflags=flags, close_fds=True)
        self._set(phase='installing')
