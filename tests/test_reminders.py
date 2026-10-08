import copy
import tempfile
import unittest
from pathlib import Path
from desktop.engine import Store
from desktop.reminders import Reminders, DEFAULT

class RemindersTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.store=Store(Path(self.tmp.name)/'desk.sqlite');self.now=0
        self.make=lambda:Reminders(self.store,clock=lambda:self.now,wall=lambda:1700000000+self.now)
        self.r=self.make()
    def test_default_and_once(self):
        self.assertEqual(self.r.snapshot()['config']['items'],DEFAULT)
        self.now=8999;self.assertEqual(self.r.tick(),[])
        self.now=9000;self.assertEqual(self.r.tick()[0]['text'],'Проверить кондиционеры')
        self.assertEqual(self.r.tick(),[])
        self.now=18000;self.assertEqual(len(self.r.tick()),1)
    def test_restart_does_not_replay_or_catch_up(self):
        self.now=9000;self.r.tick();self.now=1000000;self.r=self.make()
        self.assertEqual(self.r.tick(),[])
        self.now+=9000;self.assertEqual(len(self.r.tick()),1)
        self.assertEqual(len(self.r.snapshot()['history']),2)
    def test_delayed_wake_emits_one_not_burst(self):
        self.now=1000000;self.assertEqual(len(self.r.tick()),1);self.assertEqual(self.r.tick(),[])
    def test_config_revision_disable_and_unchanged_deadline(self):
        items=copy.deepcopy(DEFAULT);self.now=100
        self.r.configure(items,0);self.now=9000;self.assertEqual(len(self.r.tick()),1)
        items[0]['enabled']=False;self.r.configure(items,1);self.now+=9000;self.assertEqual(self.r.tick(),[])
        with self.assertRaises(ValueError):self.r.configure(items,1)
        self.assertFalse(self.make().snapshot()['config']['items'][0]['enabled'])
    def test_changed_interval_restarts_only_changed_item(self):
        items=copy.deepcopy(DEFAULT);items.append(dict(items[0],id='custom',minutes=1,text='Вода',sound='none'))
        self.r.configure(items,0);self.now=30;items[0]['minutes']=1;self.r.configure(items,1)
        self.now=60;self.assertEqual([e['id'] for e in self.r.tick()],['custom'])
        self.now=90;self.assertEqual([e['id'] for e in self.r.tick()],['air-conditioners'])
    def test_invalid_input_does_not_touch_existing_settings(self):
        for change in [{'text':''},{'minutes':True},{'minutes':0},{'minutes':1.5},{'minutes':10081},{'enabled':'yes'},{'sound':'../file'},{'id':'bad/id'}]:
            items=[dict(DEFAULT[0],**change)]
            with self.assertRaises(ValueError):self.r.configure(items,0)
        with self.assertRaises(ValueError):self.r.configure(DEFAULT*2,0)
        self.assertEqual(self.r.snapshot()['config']['revision'],0)
    def test_write_failure_has_no_effect_and_retries_once(self):
        original=self.store.set
        self.store.set=lambda *a: (_ for _ in ()).throw(OSError('disk'))
        self.now=9000
        with self.assertRaises(OSError):self.r.tick()
        self.assertEqual(self.r.snapshot()['history'],[])
        with self.assertRaises(OSError):self.r.configure([],0)
        self.assertEqual(self.r.snapshot()['config']['items'],DEFAULT)
        self.store.set=original;self.assertEqual(len(self.r.tick()),1);self.assertEqual(self.r.tick(),[])
    def test_empty_config_is_not_replaced_by_default_and_history_is_bounded(self):
        for n in range(25):self.now+=9000;self.r.tick()
        self.assertEqual(len(self.r.snapshot()['history']),20)
        self.r.configure([],0);self.assertEqual(self.make().snapshot()['config']['items'],[])
    def test_snapshot_is_a_copy(self):
        self.r.snapshot()['config']['items'].clear()
        self.assertEqual(len(self.r.snapshot()['config']['items']),1)

class ReminderDeliveryTest(unittest.TestCase):
    def test_offline_batch_visual_always_sound_once_and_no_catchup(self):
        from desktop.app import App
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as tmp:
            now=[0];store=Store(Path(tmp)/'desk.sqlite')
            r=Reminders(store,clock=lambda:now[0]);items=copy.deepcopy(DEFAULT)
            items.append(dict(items[0],id='water',text='Вода',sound='glass'))
            r.configure(items,0);now[0]=9000
            sounds=[];popups=[]
            app=App.__new__(App);app.reminders=r;app.sound=SimpleNamespace(settings={'enabled':False},play_preset=sounds.append)
            app.tray=SimpleNamespace(notify=lambda *args:popups.append(args))
            def run():
                waits=iter([False,True]);app.stop=SimpleNamespace(wait=lambda _:next(waits));app.reminder_loop()
            run();self.assertEqual(sounds,[]);self.assertEqual(len(popups),1);self.assertEqual(len(r.snapshot()['history']),2)
            app.sound.settings['enabled']=True;run();self.assertEqual(sounds,[])
            now[0]+=9000;run();self.assertEqual(sounds,['soft']);self.assertEqual(len(popups),2)
