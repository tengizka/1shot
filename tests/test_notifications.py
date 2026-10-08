import tempfile
import unittest
from pathlib import Path
from desktop.engine import Store
from desktop.notifications import NotificationGate
from desktop.sound import Sound, PRESETS

class NotificationsTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.store=Store(Path(self.tmp.name)/'state.sqlite')
    def test_once_including_restart_and_offline_replay(self):
        gate=NotificationGate(self.store)
        events={'1':{'kind':'created'},'2':{'kind':'attention'}}
        self.assertEqual(len(gate.consume(events)),2)
        self.assertEqual(gate.consume(events),[])
        self.assertEqual(NotificationGate(self.store).consume(events),[])
        events['3']={'kind':'waiting'}
        self.assertEqual(len(NotificationGate(self.store).consume(events)),1)
    def test_existing_alerts_do_not_replay_at_upgrade(self):
        self.store.set('alerts',{'20':{'kind':'created'}})
        self.store.set('event_cursor',25)
        self.assertEqual(NotificationGate(self.store).consume({'24':{},'25':{}}),[])
    def test_persist_before_effect_and_no_replay_after_failure(self):
        gate=NotificationGate(self.store);gate.consume({'8':{}})
        self.assertEqual(self.store.get('notice_cursor'),8)
        self.assertEqual(NotificationGate(self.store).consume({'8':{}}),[])
    def test_local_sounds_and_event_settings(self):
        sound=Sound(Path(self.tmp.name),self.store)
        self.assertEqual(len(PRESETS),12)
        for preset in PRESETS:
            sound.configure({'preset':preset,'volume':20,'events':{'created':'glass','attention':'low'},'enabled':False})
            self.assertGreater(sound.path().stat().st_size,1000)
        self.assertEqual(Sound(Path(self.tmp.name),self.store).settings['events']['attention'],'low')
        with self.assertRaises(ValueError):sound.configure({'preset':'bad'})
