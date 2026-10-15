# hits.py - does each musical accent land on its cut?  python3 hits.py out/score.wav "3.0,5.25"
# For every cut time: when the loudness rises most sharply within 0.2 s of it, and by how much. Offsets beyond about 0.04 s, or rises under 3 dB, need a look.
import sys, wave, numpy as np
w = wave.open(sys.argv[1], 'rb'); sr, ch = w.getframerate(), w.getnchannels(); x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float).reshape(-1, ch).mean(axis=1) / 32768
hop = sr // 100; e = np.array([10 * np.log10(np.mean(x[i:i + 2 * hop]**2) + 1e-12) for i in range(0, len(x) - 2 * hop, hop)])       # 20 ms level every 10 ms
for c in [float(v) for v in sys.argv[2].split(',')]:
    k = int(c * 100); lo, hi = max(3, k - 20), min(len(e) - 1, k + 20); rise = [e[i] - e[i - 3] for i in range(lo, hi)]; j = lo + int(np.argmax(rise))
    print('cut %6.2f s: sharpest rise %+5.1f dB at %6.2f s (%+.2f s)' % (c, max(rise), (j - 2) / 100, (j - 2) / 100 - c))
