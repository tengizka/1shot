import json
import struct
import unittest
from pathlib import Path
from desktop.version import VERSION, AUTHOR, APP_TITLE

ROOT=Path(__file__).resolve().parents[1]
class DesktopBrandingTests(unittest.TestCase):
    def test_generated_browser_identity_matches_release(self):
        script=(ROOT/'desktop/brand.js').read_text(encoding='utf-8')
        value=json.loads(script.removeprefix('window.DESK_BUILD = ').strip().removesuffix(';'))
        self.assertEqual(value,dict(version=VERSION,author=AUTHOR,title=APP_TITLE))
    def test_icon_contains_small_and_large_windows_sizes(self):
        data=(ROOT/'desktop/assets/app.ico').read_bytes()
        reserved,kind,count=struct.unpack_from('<HHH',data)
        self.assertEqual((reserved,kind),(0,1))
        sizes=set()
        for i in range(count):
            w,h,colors,res,planes,bits,length,offset=struct.unpack_from('<BBBBHHII',data,6+i*16)
            sizes.add(w or 256)
            self.assertEqual(w,h)
            self.assertLessEqual(offset+length,len(data))
            self.assertEqual(data[offset:offset+8],b'\x89PNG\r\n\x1a\n')
        self.assertTrue({16,20,24,32,40,48,64,128,256}<=sizes)
    def test_windows_resource_includes_author_and_version(self):
        text=(ROOT/'desktop/version-info.txt').read_text(encoding='utf-8')
        self.assertIn(repr(VERSION),text)
        self.assertIn(repr(AUTHOR),text)
