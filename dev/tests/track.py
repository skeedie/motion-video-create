# Синтетический тестовый трек: бочка на каждую долю (120 BPM), хэт на слабые доли, аккорд-подклад.
# Пишется стандартным модулем wave, без внешних зависимостей; если есть ffmpeg — можно перекодировать в mp3.
import math, os, random, shutil, struct, subprocess, sys, wave

BPM = 120.0
DURATION = 48.0  # слова в data/words.json заканчиваются на 40 с
SR = 22050


def synth(path, duration=DURATION, bpm=BPM, sr=SR):
    rnd = random.Random(7)
    n = int(duration * sr)
    beat = 60.0 / bpm
    out = bytearray()
    chords = [(220.0, 277.18, 329.63), (196.0, 246.94, 293.66), (174.61, 220.0, 261.63), (196.0, 246.94, 293.66)]
    for i in range(n):
        t = i / sr
        k = int(t / beat); tb = t - k * beat
        v = 0.0
        # бочка: затухающий синус с падением частоты; сильная доля громче
        if tb < 0.25:
            f = 55 + 90 * math.exp(-tb * 30)
            v += (0.9 if k % 4 == 0 else 0.65) * math.exp(-tb * 14) * math.sin(2 * math.pi * f * tb)
        # хэт на половине доли
        th = tb - beat / 2
        if 0 <= th < 0.05:
            v += 0.18 * math.exp(-th * 80) * (rnd.random() * 2 - 1)
        # подклад: аккорд меняется каждый такт
        ch = chords[(k // 4) % len(chords)]
        v += 0.05 * sum(math.sin(2 * math.pi * f * t) for f in ch)
        s = max(-1.0, min(1.0, v * 0.8))
        out += struct.pack('<h', int(s * 32000))
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(bytes(out))
    return path


def make_track(folder, mp3=True):
    """Возвращает путь к треку. mp3 — если есть ffmpeg (так ближе к реальному использованию), иначе wav."""
    os.makedirs(folder, exist_ok=True)
    wav = synth(os.path.join(folder, 'test-track.wav'))
    if mp3 and shutil.which('ffmpeg'):
        mp = os.path.join(folder, 'test-track.mp3')
        r = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '128k', mp])
        if r.returncode == 0 and os.path.getsize(mp) > 1000:
            return mp
    return wav


if __name__ == '__main__':
    print(make_track(sys.argv[1] if len(sys.argv) > 1 else '.'))
