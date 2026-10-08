"""Soft local notification sounds. Never changes Windows/system volume."""
import math
import struct
import sys
import wave
import threading

PRESETS={'soft':[(0,523.25),(.38,659.25)],'chime':[(0,659.25),(.32,783.99),(.64,1046.5)],'pulse':[(0,440),(.7,440)],'glass':[(0,880),(.3,1174.66)],'warm':[(0,349.23),(.45,440)],'rise':[(0,392),(.25,493.88),(.5,587.33)],'low':[(0,261.63),(.5,329.63)],'spark':[(0,1046.5),(.2,1318.51)],'softbell':[(0,587.33),(.55,783.99)],'drop':[(0,783.99),(.4,523.25)],'triple':[(0,440),(.35,523.25),(.7,659.25)],'calm':[(0,293.66),(.65,392)]}
DEFAULT={'preset':'soft','volume':50,'repeat':20,'enabled':True}
class Sound:
    def __init__(self,home,store):self.home,self.store=home,store;self.settings=DEFAULT|store.get('sound',{});self.audio_lock=threading.RLock()
    def configure(self,settings):
        preset=settings.get('preset','soft')
        if preset not in PRESETS:raise ValueError('Неизвестный звук')
        self.settings={'preset':preset,'volume':max(0,min(100,int(settings.get('volume',50)))),'repeat':max(10,min(120,int(settings.get('repeat',20)))),'enabled':bool(settings.get('enabled',True))}
        choices=settings.get('events',self.store.get('sound',{}).get('events',{}))
        self.settings['events']={kind:value for kind,value in choices.items() if kind in ('created','waiting','attention') and value in PRESETS}
        self.store.set('sound',self.settings)
        if not self.settings['enabled']:self.stop()
        return self.settings
    def path(self,preset=None):
        preset=preset or self.settings['preset'];volume=self.settings['volume'];path=self.home/f'notice-{preset}-{volume}.wav'
        if path.exists():return path
        rate=22050;duration=1.8;notes=PRESETS[preset]
        samples=[]
        for i in range(int(rate*duration)):
            t=i/rate;sample=0
            for start,freq in notes:
                age=t-start
                if 0<=age<1.05:
                    envelope=min(1,age/.09)*math.exp(-3.5*age)*min(1,(1.05-age)/.18)
                    sample+=envelope*(math.sin(2*math.pi*freq*age)+.12*math.sin(4*math.pi*freq*age))
            samples.append(struct.pack('<h',int(max(-1,min(1,sample*.28))*32767*volume/100)))
        with wave.open(str(path),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(rate);f.writeframes(b''.join(samples))
        return path
    def play(self,kind=None):
        self.play_preset(self.settings.get('events',{}).get(kind) or self.settings['preset'])
    def play_preset(self,preset):
        if preset not in PRESETS:raise ValueError('Неизвестный звук')
        with self.audio_lock:
            path=self.path(preset)
            if sys.platform=='win32':
                import winsound
                winsound.PlaySound(str(path),winsound.SND_FILENAME|winsound.SND_ASYNC)
    def stop(self):
        if sys.platform=='win32':
            import winsound
            winsound.PlaySound(None,0)
