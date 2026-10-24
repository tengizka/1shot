"""Soft local notification sounds, synthesised on first use. Never changes Windows/system volume.

Five short tones, each built from a soft sine voice with a gentle attack, a little
octave shimmer and a long natural decay, so they read as a chime rather than a beep.
"""
import math
import struct
import sys
import wave
import threading

# name -> list of (start seconds, frequency Hz, level)
PRESETS = {
    'soft': [(0, 659.25, 1), (.16, 987.77, .8)],                        # two notes up
    'bell': [(0, 880.0, 1), (0, 1318.51, .35)],                         # single glassy bell
    'drop': [(0, 1174.66, .9), (.12, 783.99, .9)],                      # water drop down
    'chord': [(0, 523.25, .7), (.06, 659.25, .7), (.12, 783.99, .7)],  # warm major chord
    'tick': [(0, 1567.98, .6), (.11, 1567.98, .45)],                    # quiet double tick
}
NAMES = {'soft': 'Лайм', 'bell': 'Колокол', 'drop': 'Капля', 'chord': 'Аккорд', 'tick': 'Тик-тик'}
DEFAULT = {'preset': 'soft', 'volume': 60, 'repeat': 20, 'enabled': True, 'events': {}}


class Sound:
    def __init__(self, home, store):
        self.home, self.store = home, store
        saved = store.get('sound', {})
        self.settings = DEFAULT | {k: v for k, v in saved.items() if k in DEFAULT}
        if self.settings['preset'] not in PRESETS:
            self.settings['preset'] = DEFAULT['preset']
        self.settings['events'] = {}
        self.audio_lock = threading.RLock()

    def configure(self, settings):
        preset = settings.get('preset', self.settings['preset'])
        if preset not in PRESETS:
            raise ValueError('Неизвестный звук')
        self.settings = {'preset': preset, 'volume': max(0, min(100, int(settings.get('volume', self.settings['volume'])))),
                         'repeat': 20, 'enabled': bool(settings.get('enabled', True)), 'events': {}}
        self.store.set('sound', self.settings)
        if not self.settings['enabled']:
            self.stop()
        return self.settings

    def path(self, preset=None):
        preset = preset or self.settings['preset']
        volume = self.settings['volume']
        path = self.home / f'tone-{preset}-{volume}.wav'
        if path.exists():
            return path
        rate, duration, notes = 44100, 1.6, PRESETS[preset]
        frames = bytearray()
        for i in range(int(rate * duration)):
            t = i / rate
            sample = 0.0
            for start, freq, level in notes:
                age = t - start
                if age < 0:
                    continue
                attack = min(1.0, age / 0.012)
                envelope = attack * math.exp(-4.2 * age)
                sample += level * envelope * (math.sin(2 * math.pi * freq * age)
                                              + 0.18 * math.sin(4 * math.pi * freq * age) * math.exp(-6 * age))
            tail = min(1.0, (duration - t) / 0.25)
            value = max(-1.0, min(1.0, sample * 0.22 * tail)) * 32767 * volume / 100
            frames += struct.pack('<h', int(value))
        with wave.open(str(path), 'wb') as f:
            f.setnchannels(1)
            f.setsampwidth(2)
            f.setframerate(rate)
            f.writeframes(bytes(frames))
        return path

    def play(self, kind=None):
        self.play_preset(self.settings['preset'])

    def play_preset(self, preset):
        if preset not in PRESETS:
            raise ValueError('Неизвестный звук')
        with self.audio_lock:
            path = self.path(preset)
            if sys.platform == 'win32':
                import winsound
                winsound.PlaySound(str(path), winsound.SND_FILENAME | winsound.SND_ASYNC)

    def stop(self):
        if sys.platform == 'win32':
            import winsound
            winsound.PlaySound(None, 0)
