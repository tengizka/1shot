import unittest
from desktop.services import ApiError
from desktop.test_accounts import TestAccounts

class Cloud:
    def __init__(self):self.accounts=[{'gizmo_user_id':4760,'code':'LEVELUP','created_at':'2026-10-24T16:44:35Z'}];self.removed=[]
    def desk(self,action,**data):
        if action=='test_accounts':return {'accounts':[a for a in self.accounts if a['gizmo_user_id'] not in self.removed]}
        if action=='test_account_removed':self.removed.append(data['gizmo_user_id']);return {'ok':True}
        raise AssertionError(action)

class Gizmo:
    def __init__(self):self.users={4760:{'id':4760,'username':'test_neo'},77:{'id':77,'username':'guest'}};self.active=[];self.deletes=[];self.v2_missing=False
    def user(self,uid):
        u=self.users.get(uid)
        if not u or u.get('isDeleted'):raise ApiError('Аккаунт Gizmo не найден')
        return u
    def sessions(self):return self.active
    def request(self,method,path,**kw):
        assert method=='DELETE';self.deletes.append(path)
        if self.v2_missing and path.startswith('v2.0/'):raise ApiError('Gizmo: HTTP 405')
        self.users[int(path.rsplit('/',1)[1])]['isDeleted']=True

class TestAccountsTests(unittest.TestCase):
    def setUp(self):self.cloud=Cloud();self.gizmo=Gizmo();self.t=TestAccounts(self.cloud,self.gizmo)
    def test_list_shows_name_and_code(self):
        self.assertEqual(self.t.list(),[{'gizmo_user_id':4760,'username':'test_neo','code':'LEVELUP','created_at':'2026-10-24T16:44:35Z','gone':False}])
    def test_delete_in_gizmo_then_server(self):
        self.assertEqual(self.t.delete(4760),{'ok':True});self.assertEqual(self.gizmo.deletes,['v2.0/users/4760']);self.assertEqual(self.cloud.removed,[4760])
        self.assertEqual(self.t.list(),[])
    def test_old_api_fallback(self):
        self.gizmo.v2_missing=True;self.t.delete(4760);self.assertEqual(self.gizmo.deletes,['v2.0/users/4760','users/4760'])
    def test_only_listed_accounts(self):
        with self.assertRaises(ValueError):self.t.delete(77)
        self.assertEqual(self.gizmo.deletes,[]);self.assertFalse(self.gizmo.users[77].get('isDeleted'))
    def test_never_while_playing(self):
        self.gizmo.active=[{'userId':4760,'hostNumber':13}]
        with self.assertRaises(ValueError):self.t.delete(4760)
        self.assertEqual(self.gizmo.deletes,[])
    def test_server_retry_after_gizmo_delete(self):
        self.gizmo.users[4760]['isDeleted']=True;self.t.delete(4760)
        self.assertEqual(self.gizmo.deletes,[],'already gone in Gizmo: only the server is cleaned');self.assertEqual(self.cloud.removed,[4760])

if __name__=='__main__':unittest.main()
