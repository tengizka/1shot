import unittest
import test_club_controller as base

class ManualControllerTests(unittest.TestCase):
 setUp=base.TestClubController.setUp
 tearDown=base.TestClubController.tearDown
 def test_anonymous_hold_and_expiry(self):
  self.cloud.b.update(admin_created=True,protocol=2,telegram_id=None,gizmo_user_id=None,hold_until=base.iso(base.NOW+1800))
  self.ctrl.tick();self.assertEqual(self.cloud.b['status'],'holding');self.assertEqual(self.gizmo.locks,[True]);self.assertEqual(self.gizmo.logins,[])
  self.now+=1801;self.ctrl.tick();self.assertEqual(self.cloud.b['status'],'expired');self.assertEqual(self.gizmo.locks,[True,False])
 def test_binding_account_releases_only_own_hold_then_logs_in_once(self):
  self.cloud.b.update(admin_created=True,protocol=2,telegram_id=None,gizmo_user_id=None)
  self.ctrl.tick();self.cloud.b.update(status='checkin_pending',gizmo_user_id=7)
  self.ctrl.tick();self.ctrl.tick();self.assertEqual(self.gizmo.locks,[True,False]);self.assertEqual(self.gizmo.logins,[(7,50)])
 def test_manual_instant_is_direct_and_never_replayed(self):
  self.cloud.b.update(admin_created=True,protocol=2,telegram_id=None,instant=True)
  self.ctrl.tick();self.ctrl.tick();self.assertEqual(self.gizmo.locks,[]);self.assertEqual(self.gizmo.logins,[(7,50)])
 def test_manual_expiry_never_interrupts_an_existing_game(self):
  self.cloud.b.update(admin_created=True,protocol=2,telegram_id=None,gizmo_user_id=None)
  self.ctrl.tick();self.gizmo.active=[{'hostId':50,'userId':99}];self.now+=4000;self.ctrl.tick()
  self.assertEqual(self.gizmo.locks,[True]);self.assertEqual(self.gizmo.logins,[]);self.assertEqual(self.cloud.b['status'],'attention')
