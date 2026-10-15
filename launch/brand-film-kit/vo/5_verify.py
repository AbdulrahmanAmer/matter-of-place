# 5_verify.py - check the finished file:  python3 5_verify.py out/film-vo.mp4 [script.txt]
import sys, json, numpy as np, vo
from scipy import signal
a = vo.load48(sys.argv[1]); m, _ = vo.read_wav('work/mix.wav'); n = min(len(a), len(m)); target = json.load(open('work/mix_settings.json'))['target_lufs']
lag = int(np.argmax(signal.correlate(a[:n, 0], m[:n, 0], 'full', 'fft')) - (n - 1))
print('sound in the file vs the mix: lag %d samples (must be 0) | %.2f LUFS (target %s) | true peak %.2f dBTP (ceiling %s)' % (lag, vo.lufs_integrated(a), target, vo.true_peak(a), vo.M['ceiling_dbtp']))
if len(sys.argv) > 2:
    script = open(sys.argv[2]).read(); regions = json.load(open('work/check.json'))['regions']; voice = np.load('work/voice_clean.npy'); times = None
    for name, sig in (('cleaned voice alone', voice), ('finished film', a), ('finished film through a phone speaker', vo.phone(a))):
        try: h1, h2, words = vo.transcribe(sig, regions)
        except Exception as e: print('WORD CHECK SKIPPED: the speech recognizers could not be started (%s: %s)' % (type(e).__name__, str(e)[:120])); break
        ok = vo.same_words(h1, script), vo.same_words(h2, script); times = words if name == 'finished film' else times
        print('%-38s every word heard: recognizer 1 %s, recognizer 2 %s' % (name, ok[0], ok[1]))
        if not all(ok): print('  heard 1:', h1, '\n  heard 2:', h2)
    if times: print('word times in the finished film (within about 0.1 s): ' + ' '.join('%s@%.2f' % w for w in times))
