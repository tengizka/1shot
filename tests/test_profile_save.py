import ast
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import Mock

class ProfileSaveTests(TestCase):
    def context(self, response):
        tree = ast.parse(Path('agent.py').read_text())
        funcs = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ('upsert_profile', 'handle_login')]
        ns = dict(post_to_supabase=Mock(return_value=response), report_auth=Mock(),
                  validate_gizmo_credentials=Mock(return_value=(True, 42)), log=Mock())
        exec(compile(ast.Module(body=funcs,type_ignores=[]),'agent.py','exec'),ns)
        return ns
    def test_http_failure_does_not_report_successful_login(self):
        ns = self.context(Mock(ok=False,status_code=500))
        ns['handle_login']('req',123,'test','test')
        self.assertEqual(ns['report_auth'].call_args.args[1], 'failed')
    def test_missing_acknowledgement_is_failure(self):
        response = Mock(ok=True); response.json.return_value = {}
        ns = self.context(response)
        ns['handle_login']('req',123,'test','test')
        self.assertEqual(ns['report_auth'].call_args.args[1], 'failed')
    def test_saved_profile_allows_login(self):
        response = Mock(ok=True); response.json.return_value = {'ok': True}
        ns = self.context(response)
        ns['handle_login']('req',123,'test','test')
        self.assertEqual(ns['report_auth'].call_args.args[1], 'done')
if __name__=='__main__':main()
