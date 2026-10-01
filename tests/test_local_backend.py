import os
import unittest
from unittest.mock import patch
from desktop.services import Cloud,ApiError

class LocalBackendTests(unittest.TestCase):
 def test_local_does_not_require_cloud_and_never_falls_back(self):
  with patch.dict(os.environ,{'CLUB_API_URL':'http://127.0.0.1:8788/api','AGENT_SECRET':'test'},clear=True):
   c=Cloud();self.assertEqual(c.base,'http://127.0.0.1:8788/api/');self.assertEqual(c.label,'Локальный сервер')
 def test_old_configuration_still_works(self):
  with patch.dict(os.environ,{'SUPABASE_URL':'https://example.test','AGENT_SECRET':'test'},clear=True):
   self.assertEqual(Cloud().base,'https://example.test/functions/v1/')
 def test_no_cleartext_secrets_over_lan_or_credentials_in_url(self):
  for url in ['http://192.168.1.5:8788/api','https://user:password@example.test/api','ftp://example.test/api','https://example.test/api?secret=x']:
   with patch.dict(os.environ,{'CLUB_API_URL':url,'AGENT_SECRET':'test'},clear=True):
    with self.assertRaises(ApiError):Cloud()
