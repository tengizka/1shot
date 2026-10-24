import hashlib
import tempfile
import unittest
from pathlib import Path
from desktop.updater import Updater, newer, parse_version, ASSET, CHECKSUM, SILENT_ARGS

PAYLOAD = b'MZ fake installer ' * 4096
DIGEST = hashlib.sha256(PAYLOAD).hexdigest()


def release(tag, assets=(ASSET, CHECKSUM), draft=False):
    return {'tag_name': tag, 'draft': draft, 'body': 'notes',
            'assets': [{'name': n, 'browser_download_url': 'https://dl/' + tag + '/' + n, 'size': len(PAYLOAD)} for n in assets]}


class Response:
    def __init__(self, data=None, text='', content=b'', status=200):
        self.data, self.text, self.content, self.status = data, text, content, status
        self.headers = {'content-length': str(len(content))} if content else {}
    def raise_for_status(self):
        if self.status >= 400:
            raise RuntimeError(self.status)
    def json(self):
        return self.data
    def iter_content(self, chunk_size):
        for i in range(0, len(self.content), chunk_size):
            yield self.content[i:i + chunk_size]


class Http:
    def __init__(self, releases, checksum=DIGEST, payload=PAYLOAD, fail=False):
        self.releases, self.checksum, self.payload, self.fail, self.calls = releases, checksum, payload, fail, []
    def get(self, url, **kwargs):
        self.calls.append(url)
        if self.fail:
            raise ConnectionError('offline')
        if url.startswith('https://api.github.com/'):
            return Response(self.releases)
        if url.endswith(CHECKSUM):
            return Response(text=self.checksum + '  ' + ASSET)
        return Response(content=self.payload)


class UpdaterTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def make(self, http, current='3.0.0'):
        return Updater(Path(self.tmp.name), current, http)

    def test_versions(self):
        self.assertEqual(parse_version('desk-v3.1.2'), ((3, 1, 2), True))
        self.assertTrue(newer('desk-v3.0.1', '3.0.0'))
        self.assertTrue(newer('desk-v3.0.0', '1.7.0-alpha'))
        self.assertFalse(newer('desk-v3.0.0', '3.0.0'))
        self.assertFalse(newer('desk-v2.9.9', '3.0.0'))
        self.assertFalse(newer('nightly', '3.0.0'))

    def test_picks_newest_complete_desk_release(self):
        u = self.make(Http([release('desk-v3.0.2', assets=(ASSET,)), release('miniapp-v9.0.0'), release('desk-v3.1.0', draft=True), release('desk-v3.0.1')]))
        state = u.check()
        self.assertEqual((state['phase'], state['latest']), ('available', '3.0.1'))

    def test_latest_and_offline(self):
        self.assertEqual(self.make(Http([release('desk-v3.0.0')])).check()['phase'], 'latest')
        state = self.make(Http([], fail=True)).check()
        self.assertEqual(state['phase'], 'error')
        self.assertIn('интернет', state['error'])

    def test_download_verifies_checksum_then_launches_silently(self):
        u = self.make(Http([release('desk-v3.0.1')]))
        u.check()
        state = u.download()
        self.assertEqual((state['phase'], state['progress']), ('ready', 100))
        self.assertEqual(Path(u.installer).read_bytes(), PAYLOAD)
        launched = []
        u.launch(popen=lambda args, **kw: launched.append(args))
        self.assertEqual(launched[0][1:], SILENT_ARGS)
        self.assertEqual(u.snapshot()['phase'], 'installing')

    def test_corrupted_download_is_discarded(self):
        u = self.make(Http([release('desk-v3.0.1')], payload=PAYLOAD + b'x'))
        u.check()
        state = u.download()
        self.assertEqual(state['phase'], 'error')
        self.assertFalse(list((Path(self.tmp.name) / 'updates').glob('*')))
        with self.assertRaises(RuntimeError):
            u.launch(popen=lambda *a, **k: None)

    def test_bad_checksum_file_never_runs(self):
        u = self.make(Http([release('desk-v3.0.1')], checksum='not-a-hash'))
        u.check()
        self.assertEqual(u.download()['phase'], 'error')
        self.assertIsNone(u.installer)


if __name__ == '__main__':
    unittest.main()
