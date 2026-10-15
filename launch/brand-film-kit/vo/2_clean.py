# 2_clean.py - repair and polish:  python3 2_clean.py        (edit STEPS and p after reading step 1; run again as often as needed)
import json, subprocess, numpy as np, vo
from scipy import signal
x = np.load('work/voice_in.npy'); chk = json.load(open('work/check.json')); regions = [tuple(r) for r in chk['regions']]
STEPS = sorted([c['i'] for c in chk['clicks'] if c['kind'] == 'step'])      # after looking at work/clicks.png: add or remove sample indices by hand
p = vo.suggest(chk)                                                         # then override where the person's wishes or your reading differ, e.g. p['shelf'] = []
print('settings:', {k: p[k] for k in ('lp_hz', 'hp_hz', 'shelf', 'ds_band', 'ds_thresh')})
y, info = vo.polish(x, p, regions, STEPS); np.save('work/voice_clean.npy', y)
vo.plot_clicks(x, [dict(i=j, t=j / vo.SR, kind='repaired') for j in STEPS], 'work/clicks_fixed.png', vo.declick(x, STEPS)[0])      # red before, blue after the repair alone: LOOK
words = chk.get('words', [])
for j in STEPS:
    t = j / vo.SR; before = [w for w, s in words if s <= t]; after = [w for w, s in words if s > t]
    print('click repaired at %.3f s (between "%s" and "%s": in or next to one of them)' % (t, before[-1] if before else '', after[0] if after else ''))
a = vo.diagnose(y, quiet=True); f = lambda v: 'n/a' if v is None else '%+.1f' % v
print('power below 140 Hz: %.0f%% -> %.0f%%   fundamental over the 400-500 Hz band: %s -> %s dB   (a deep voice stays deep: only the excess is taken)' % (100 * chk['share_below_140'], 100 * a['share_below_140'], f(chk['fund_vs_mid']), f(a['fund_vs_mid'])))
print('"s" over the vowels: %s -> %s dB (median), %s -> %s dB (hottest)' % (f(chk['sib_over_vowel']), f(a['sib_over_vowel']), f(chk['sib_over_vowel_max']), f(a['sib_over_vowel_max'])))
if 'deess_db' in info: g = info['deess_db']; print('de-esser: active %.1f s (every s, z, ts and ch, and their tails); median %.1f dB, max %.1f dB' % ((g > 0.5).sum() / vo.SR, np.median(g[g > 0.5]), g.max()))
print('line loudness spread: %.1f -> %.1f LU   line trims: %s   (trims are measured after the low-end cut, which removes most of the spread by itself)' % (chk['line_spread'], a['line_spread'], np.round(info['trims'], 1)))
if p['lp_hz']: bl = chk['band_limit_hz']; print('mirror image above the band limit (%.1f-%.1f kHz): %.0f -> %.0f dB' % ((bl + 400) / 1000, (bl + 2500) / 1000, vo.band_db(x, bl + 400, bl + 2500), vo.band_db(y, bl + 400, bl + 2500)))
print('peak control: max %.1f dB' % info['limit_db'].max())
bp = signal.butter(4, [500, 3000], 'band', fs=vo.SR, output='sos'); n = min(len(x), 480000); c = signal.correlate(signal.sosfiltfilt(bp, y[:n]), signal.sosfiltfilt(bp, x[:n]), 'full', 'fft')
print('timing: cleaned voice is %d samples from the original (must be within 2)' % (np.argmax(c) - (n - 1)))
gain = vo.lufs_integrated(x) - vo.lufs_integrated(y); solo, _ = vo.limiter_tp(y * 10**(gain / 20), -1.0); solo = solo[:, 0]          # the cleaned voice alone, at the loudness of the file supplied
vo.write_wav24('out/voice-cleaned.wav', solo); print('out/voice-cleaned.wav: %.1f LUFS (supplied %.1f), true peak %.1f dBTP' % (vo.lufs_integrated(solo), vo.lufs_integrated(x), vo.true_peak(solo)))
print('highest peaks before peak control: a click the search missed would be among them. LOOK at work/peaks.png (each peak, after click repair only):')
for t_, lv, w, pre in info['peaks']: print('  %8.3f s  %5.1f dBFS  width %.2f ms  level in the 20 ms before %5.1f dB' % (t_, lv, w, pre))
vo.plot_clicks(vo.declick(x, STEPS)[0], [dict(i=int(round(t_ * vo.SR)), t=t_, kind='peak %.1f dBFS' % lv) for t_, lv, w, pre in info['peaks']], 'work/peaks.png')
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', 'out/voice-cleaned.wav', '-lavfi', 'showspectrumpic=s=1800x720:legend=1:drange=110:fscale=lin:start=8000:stop=24000', 'work/spectrum_top_clean.png'])    # compare with work/spectrum_top.png
