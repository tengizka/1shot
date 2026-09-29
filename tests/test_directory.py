import unittest
from unittest.mock import Mock
from desktop.directory import Directory
from desktop.engine import UnsafeOperation
import test_desk_accounts as base

class DirectoryTests(unittest.TestCase):
 def setUp(self):
  self.rows=[{'id':1,'username':'admin','firstName':'Анна','lastName':'Иванова','mobilePhone':'+7 (999) 123-45-67','userGroupId':1,'password':'MUST NOT LEAK'}, {'id':2,'username':'anna_guest','firstName':'Анна','lastName':'Петрова','userGroupId':3}, {'id':3,'username':'deleted','isDeleted':True}]
  self.gizmo=Mock();self.gizmo.request.side_effect=lambda method,path,**kw:self.rows if path=='users' else [{'id':1,'name':'Операторы'},{'id':3,'name':'Клиенты'}]
  self.gizmo.user.side_effect=lambda uid:next(r for r in self.rows if r['id']==uid)
  self.directory=Directory(self.gizmo)
 def test_partial_name_nick_and_normalized_phone(self):
  self.assertEqual(len(self.directory.search('анна')['users']),2)
  self.assertEqual(self.directory.search('999123')['users'][0]['id'],1)
  self.assertEqual(self.directory.search('anna_')['users'][0]['id'],2)
  self.assertFalse(self.directory.search('deleted')['users'])
  self.assertEqual(sum(c.args[1]=='users' for c in self.gizmo.request.call_args_list),1)
 def test_minimum_limit_and_whitelist(self):
  self.assertFalse(self.directory.search('a')['users']);self.assertFalse(self.gizmo.request.called)
  result=self.directory.search('admin')['users'][0];self.assertNotIn('password',result);self.assertTrue(result['requires_privileged_confirmation'])
  self.assertFalse(self.directory.get(2)['requires_privileged_confirmation'])
  self.rows.extend({'id':i,'username':'user'+str(i)} for i in range(10,40));self.directory.at=0
  result=self.directory.search('user');self.assertEqual(len(result['users']),20);self.assertTrue(result['more'])
 def test_unknown_groups_require_confirmation(self):
  self.gizmo.request.side_effect=RuntimeError('offline')
  self.assertTrue(self.directory.get(2,fresh=True)['requires_privileged_confirmation'])

class AdminResetTests(unittest.TestCase):
 setUp=base.AccountsTests.setUp
 tearDown=base.AccountsTests.tearDown
 def test_local_operator_reset_requires_extra_confirmation(self):
  self.gizmo.active=[];self.gizmo.member['userGroupId']=1
  with self.assertRaises(UnsafeOperation):self.api.reset(7,'guest','test-password',admin=True)
  self.assertEqual(self.gizmo.writes,[])
  self.assertTrue(self.api.reset(7,'guest','test-password',admin=True,privileged_confirmed=True))
  self.assertEqual(self.gizmo.member['userGroupId'],1)
 def test_remote_profile_guard_is_not_relaxed(self):
  self.gizmo.active=[];self.gizmo.member['userGroupId']=1
  with self.assertRaises(UnsafeOperation):self.api.execute({'kind':'profile_edit','gizmo_user_id':7,'payload':{'username':'new'}})
  with self.assertRaises(UnsafeOperation):self.api.execute({'kind':'password_reset','gizmo_user_id':7,'payload':{}})
  self.assertEqual(self.gizmo.writes,[])

class LocalConfirmationTests(unittest.TestCase):
 def test_reset_api_requires_explicit_identity_confirmation(self):
  from desktop.app import App
  app=App.__new__(App)
  self.assertIn('error',app.reset_password(7,'guest','test-password'))
  self.assertIn('error',app.reset_password_request('request','guest','test-password'))
  self.assertIn('error',app.login_account('101',7,'guest','request'))
