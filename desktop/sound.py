"""Soft local notification sounds. Never changes Windows/system volume."""
import math
import struct
import sys
import wave

DEFAULT={'preset':'soft','volume':50,'repeat':20,'enabled':True}
class Sound:
    def __init__(self,home,store):self.home,self.store=home,store;self.settings=DEFAULT|store.get('sound',{})
    def configure(self,settings):
        preset=settings.get('preset','soft')
        if preset not in ('soft','chime','pulse'):raise ValueError('Неизвестный звук')
        self.settings={'preset':preset,'volume':max(0,min(100,int(settings.get('volume',50)))),'repeat':max(10,min(120,int(settings.get('repeat',20)))),'enabled':bool(settings.get('enabled',True))}
        self.store.set('sound',self.settings);return self.settings
    def path(self):
        preset=self.settings['preset'];volume=self.settings['volume'];path=self.home/f'notice-{preset}-{volume}.wav'
        if path.exists():return path
        rate=22050;duration=1.8;notes={'soft':[(0,523.25),(.38,659.25)],'chime':[(0,659.25),(.32,783.99),(.64,1046.5)],'pulse':[(0,440),(.7,440)]}[preset]
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
    def play(self):
        path=self.path()
        if sys.platform=='win32':
            import winsound
            winsound.PlaySound(str(path),winsound.SND_FILENAME|winsound.SND_ASYNC)
    def stop(self):
        if sys.platform=='win32':
            import winsound
            winsound.PlaySound(None,0)
