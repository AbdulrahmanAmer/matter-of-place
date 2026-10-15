"""vo.py - voice-over toolkit: measure, repair, polish, mix under music, verify.
Everything works on float arrays at 48 kHz. Nothing here shifts audio in time: FIR stages are delay-compensated."""
import numpy as np, wave, subprocess, os, tempfile
from scipy import signal
from scipy.ndimage import minimum_filter1d, maximum_filter1d
SR = 48000

# ---------------------------------------------------------------- files
def read_wav(path):
    w = wave.open(path, 'rb'); n, sr, sw, ch = w.getnframes(), w.getframerate(), w.getsampwidth(), w.getnchannels(); raw = w.readframes(n); w.close()
    if sw == 3:
        a = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32); v = a[:, 0] | (a[:, 1] << 8) | (a[:, 2] << 16)
        v = np.where(v >= 1 << 23, v - (1 << 24), v).astype(np.float64) / (1 << 23)
    elif sw == 2: v = np.frombuffer(raw, dtype=np.int16).astype(np.float64) / 32768
    elif sw == 4: v = np.frombuffer(raw, dtype=np.int32).astype(np.float64) / 2147483648
    else: raise ValueError('unsupported sample width %d' % sw)
    return v.reshape(-1, ch), sr

def load48(path, mono=False):
    """any audio or video file -> float array at 48 kHz, shape (n, channels) or (n,) when mono=True. Uses ffmpeg."""
    tmp = tempfile.mktemp(suffix='.wav')
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-vn', '-ar', str(SR)] + (['-ac', '1'] if mono else []) + ['-c:a', 'pcm_s24le', tmp], check=True)
    x, _ = read_wav(tmp); os.remove(tmp)
    return x[:, 0] if mono else x

def write_wav24(path, x, dither=True, seed=7):
    y = x[:, None].copy() if x.ndim == 1 else x.copy()
    if dither: rng = np.random.default_rng(seed); y = y + (rng.random(y.shape) - rng.random(y.shape)) / (1 << 23)     # TPDF, 1 LSB
    v = np.clip(np.round(y * (1 << 23)), -(1 << 23), (1 << 23) - 1).astype(np.int32)
    b = np.empty(v.shape + (3,), dtype=np.uint8); b[..., 0] = v & 255; b[..., 1] = (v >> 8) & 255; b[..., 2] = (v >> 16) & 255
    w = wave.open(path, 'wb'); w.setnchannels(v.shape[1]); w.setsampwidth(3); w.setframerate(SR); w.writeframes(b.tobytes()); w.close()

# ---------------------------------------------------------------- loudness (ITU-R BS.1770, coefficients for 48 kHz)
_K1 = ([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585])
_K2 = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])
def _2d(x): return x if x.ndim > 1 else x[:, None]
def kweight(x): return signal.lfilter(*_K2, signal.lfilter(*_K1, _2d(x), axis=0), axis=0)
def lufs_ungated(x):
    return -0.691 + 10 * np.log10(np.sum(np.mean(kweight(x)**2, axis=0)) + 1e-20)
def lufs_integrated(x):
    """a mono array is measured as one channel: the same signal in both channels of a stereo file reads 3 dB higher"""
    k = kweight(x); blk, hop = int(0.4 * SR), int(0.1 * SR)
    z = np.array([np.sum(np.mean(k[i:i + blk]**2, axis=0)) for i in range(0, len(k) - blk + 1, hop)]); l = -0.691 + 10 * np.log10(z + 1e-20)
    z1 = z[l > -70]
    if len(z1) == 0: return -np.inf
    rel = -0.691 + 10 * np.log10(z1.mean()) - 10
    return -0.691 + 10 * np.log10(z[(l > -70) & (l > rel)].mean())
def true_peak(x, os=8):
    x = _2d(x); return 20 * np.log10(max(np.abs(signal.resample_poly(x[:, c], os, 1)).max() for c in range(x.shape[1])) + 1e-20)
def band_db(x, lo, hi, order=6):
    """power in a band, summed over channels, dB"""
    y = signal.sosfiltfilt(signal.butter(order, [lo, hi], 'band', fs=SR, output='sos'), _2d(x), axis=0); return 10 * np.log10(np.sum(np.mean(y**2, axis=0)) + 1e-20)
CENTS = (63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000)
def third_octave(x, nper=8192):
    f, P = signal.welch(x, SR, nperseg=min(nper, len(x)), window='hann'); df = f[1] - f[0]
    return {c: 10 * np.log10(P[(f >= c / 2**(1 / 6)) & (f < c * 2**(1 / 6))].sum() * df + 1e-20) for c in CENTS}

# ---------------------------------------------------------------- measuring a voice
def speech_regions(v, thr_db=-45, min_gap=0.25):
    """[start, end] in seconds of every stretch of speech; pauses shorter than min_gap do not split a region"""
    hop = 480; m = len(v) // hop; e = 20 * np.log10(np.sqrt((v[:m * hop].reshape(m, hop)**2).mean(axis=1)) + 1e-9); act = e > thr_db
    segs = []; i = 0
    while i < m:
        if act[i]:
            j = i
            while j < m and act[j]: j += 1
            if segs and i * hop / SR - segs[-1][1] < min_gap: segs[-1][1] = j * hop / SR
            else: segs.append([i * hop / SR, j * hop / SR])
            i = j
        else: i += 1
    return segs

def _speech_only(x, thr_db=-45):
    hop = 480; m = len(x) // hop; act = np.repeat(20 * np.log10(np.sqrt((x[:m * hop].reshape(m, hop)**2).mean(axis=1)) + 1e-9) > thr_db, hop); return x[:m * hop][act]

def f0_stats(x):
    """median, 10th and 90th percentile of the pitch (Hz) over voiced frames"""
    lp = signal.butter(4, 900, 'low', fs=SR, output='sos'); lo, hi = int(SR / 400), int(SR / 50); vals = []
    for i in range(0, len(x) - 4096, 960):
        fr = x[i:i + 4096] - x[i:i + 4096].mean()
        if np.sqrt((fr**2).mean()) < 0.01: continue
        fr = signal.sosfiltfilt(lp, fr); ac = signal.correlate(fr, fr, 'full')[len(fr) - 1:]; ac /= ac[0] + 1e-12; k = lo + np.argmax(ac[lo:hi])
        if ac[k] > 0.6: vals.append(SR / k)
    v = np.array(vals) if vals else np.array([120.0])
    return float(np.median(v)), float(np.percentile(v, 10)), float(np.percentile(v, 90))

def _frames_db(x, lo, hi, hop=480):
    b = signal.sosfiltfilt(signal.butter(6, [lo, hi], 'band', fs=SR, output='sos'), x); m = len(x) // hop
    return 10 * np.log10((b[:m * hop].reshape(m, hop)**2).mean(axis=1) + 1e-12)

def sibilant_frames(x):
    """10 ms frames -> (is_sibilant, is_vowel, level 3.5-9 kHz, level 150 Hz-3 kHz). Thresholds follow the voice's own level."""
    es, em = _frames_db(x, 3500, 9000), _frames_db(x, 150, 3000); ref = np.percentile(em, 95)        # the loud vowels
    return (es > ref - 12) & (es - em > 6), em > ref - 15, es, em

def diagnose(x, quiet=False):
    """The numbers that decide what to do. Prints a short report and returns it as a dict."""
    d = {}; x = np.asarray(x, dtype=np.float64); s = _speech_only(x)
    d['duration'] = len(x) / SR; d['lufs'] = lufs_integrated(x); d['true_peak'] = true_peak(x)
    d['regions'] = speech_regions(x); reg = d['regions']
    gaps = np.ones(len(x), bool)
    for a, b in reg: gaps[max(0, int((a - 0.08) * SR)):int((b + 0.25) * SR)] = False
    g = x[gaps]; d['gap_seconds'] = len(g) / SR
    d['gap_noise_db'] = 20 * np.log10(np.sqrt(np.mean(g**2)) + 1e-12) if len(g) > 2400 else None        # -240 = digital silence
    d['f0'], d['f0_p10'], d['f0_p90'] = f0_stats(x)
    f, P = signal.welch(s, SR, nperseg=16384); d['share_below_140'] = float(P[f < 140].sum() / P.sum())
    to = third_octave(s); pw = lambda cs: 10 * np.log10(np.mean([10**(to[c] / 10) for c in cs]))
    near = sorted(CENTS, key=lambda c: abs(np.log2(c / d['f0'])))[:2]
    d['fund_vs_mid'] = pw(near) - pw((400, 500))                 # how far the fundamental stands above the 400-500 Hz band
    sib, vow, es, em = sibilant_frames(x); d['sibilant_seconds'] = float(sib.sum() * 0.01)
    if sib.sum() >= 5:
        d['sib_over_vowel'] = float(np.median(es[sib]) - np.median(em[vow])); d['sib_over_vowel_max'] = float(es[sib].max() - np.median(em[vow]))
        seg = x[:len(sib) * 480].reshape(-1, 480)[sib].ravel(); ts = third_octave(seg, 480); hf = [c for c in CENTS if 2500 <= c <= 10000]
        k = max(range(len(hf) - 1), key=lambda i: 10**(ts[hf[i]] / 10) + 10**(ts[hf[i + 1]] / 10)); d['sib_peak_hz'] = float(np.sqrt(hf[k] * hf[k + 1]))
        d['sib_band'] = (round(d['sib_peak_hz'] / 1.4, -2), round(d['sib_peak_hz'] * 1.4, -2))
        d['sib_level_db'] = float(np.median(deess_level(x, d['sib_band'])[1][:len(sib) * 480].reshape(-1, 480)[sib]))     # what the de-esser's detector reads on a typical "s"
    else: d['sib_over_vowel'] = d['sib_over_vowel_max'] = d['sib_peak_hz'] = d['sib_band'] = d['sib_level_db'] = None
    # band limit: a generated voice is often 22 or 24 kHz audio upsampled; above its limit there is nothing, or a faint mirror image
    Pd = 10 * np.log10(P + 1e-30); ref = Pd[(f > 5000) & (f < 10000)].mean(); sm = np.convolve(Pd, np.ones(21) / 21, 'same')
    above = np.where((f > 6000) & (sm < ref - 30))[0]; d['band_limit_hz'] = float(f[above[0]]) if len(above) else SR / 2
    if d['band_limit_hz'] < 20000:
        img = Pd[(f > d['band_limit_hz'] + 400) & (f < d['band_limit_hz'] + 2500)].mean(); flo = Pd[f > 21000].mean(); d['image_db_over_floor'] = float(img - flo)
    else: d['image_db_over_floor'] = 0.0
    ll = [lufs_ungated(x[int(a * SR):int(b * SR)]) for a, b in reg]; d['line_lufs'] = ll; d['line_spread'] = float(max(ll) - min(ll)) if ll else 0.0
    if not quiet:
        print('duration %.3f s | %.1f LUFS (mono) | true peak %.1f dBTP | %d speech regions' % (d['duration'], d['lufs'], d['true_peak'], len(reg)))
        print('regions: ' + ' '.join('%.2f-%.2f' % (a, b) for a, b in reg))
        print('gaps: %.1f s, noise %s' % (d['gap_seconds'], 'n/a' if d['gap_noise_db'] is None else ('digital silence' if d['gap_noise_db'] < -100 else '%.1f dBFS' % d['gap_noise_db'])))
        print('pitch: median %.0f Hz (10th %.0f, 90th %.0f)' % (d['f0'], d['f0_p10'], d['f0_p90']))
        print('low end: %.0f%% of the power is below 140 Hz; fundamental stands %+.1f dB over the 400-500 Hz band' % (100 * d['share_below_140'], d['fund_vs_mid']))
        if d['sib_over_vowel'] is not None: print('sibilance: %.1f s of "s" sounds, %+.1f dB over the vowels (median), %+.1f dB (hottest), centred near %.0f Hz' % (d['sibilant_seconds'], d['sib_over_vowel'], d['sib_over_vowel_max'], d['sib_peak_hz']))
        print('band limit: %.0f Hz; content just above it is %.0f dB over the floor' % (d['band_limit_hz'], d['image_db_over_floor']))
        print('line loudness: ' + ' '.join('%.1f' % v for v in ll) + '  (spread %.1f LU)' % d['line_spread'])
    return d

# ---------------------------------------------------------------- clicks
def _lpc(seg, order):
    r = np.correlate(seg, seg, 'full')[len(seg) - 1:len(seg) + order]; r[0] = r[0] * 1.0005 + 1e-9
    a = np.zeros(order + 1); a[0] = 1; e = r[0]
    for i in range(1, order + 1):
        k = -(r[i] + np.dot(a[1:i], r[i - 1:0:-1])) / e; a[1:i] = a[1:i] + k * a[i - 1:0:-1]; a[i] = k; e *= (1 - k * k)
    return a

def prediction_error(x, order=32, frame=2048, hop=1024):
    res = np.zeros_like(x); ws = np.zeros_like(x); win = np.hanning(frame)
    for s in range(0, len(x) - frame, hop):
        seg = x[s:s + frame]
        if np.abs(seg).max() < 1e-5: continue
        a = _lpc(seg * win, order); pad = np.concatenate([x[s - order:s], seg]) if s >= order else np.concatenate([np.zeros(order), seg])
        res[s:s + frame] += signal.lfilter(a, [1], pad)[order:] * win; ws[s:s + frame] += win
    return res / np.maximum(ws, 1e-9)

def find_clicks(x):
    """Samples the previous 32 samples cannot predict, measured against the voice's own level. Each gets a suggested kind:
    'step'   - the waveform jumps to a new level and carries on from there: a splice click (also a voice that starts mid-wave
               straight out of silence). Repair it.
    'unsure' - partly like a step. Look at the plot and decide; when still in doubt leave it.
    'burst'  - a spike after a short silence followed by hiss: a consonant (t, k, p), or the grain of an "s". Leave it alone.
    The suggestion is only that: plot the steps and the unsure ones (plot_clicks) and look before repairing."""
    s = _speech_only(x); ref = np.sqrt(np.mean(s**2)) if len(s) else 0.2; ar = np.abs(prediction_error(x))
    c = np.where(ar > 0.3 * ref)[0]; groups = []
    for i in c:
        if groups and i - groups[-1][-1] < 96: groups[-1].append(i)
        else: groups.append([i])
    out = []
    for g in groups:
        g = np.array(g); j0 = int(g[np.argmax(ar[g])])
        if j0 < 120 or j0 > len(x) - 120: continue
        dd = np.diff(x[j0 - 40:j0 + 41]); j = j0 - 40 + int(np.argmax(np.abs(dd)))               # sample just before the largest jump
        jump = float(np.median(x[j + 9:j + 57]) - np.median(x[j - 56:j - 8]))                       # change of level across the event, 1 ms either side
        rough = 0.5 * (_rough(x[j - 56:j - 8]) + _rough(x[j + 9:j + 57]))                           # how jagged the wave is either side: small in a vowel, large in an "s"
        r, k, q = ar[j0] / ref, abs(jump) / ref, abs(jump) / (rough + 1e-9)
        kind = 'step' if r >= 0.4 and k >= 0.75 and q >= 5 else 'unsure' if r >= 0.3 and k >= 0.4 and q >= 2.5 else 'burst'
        out.append(dict(i=j, t=j / SR, resid=float(ar[j0]), jump=jump, smooth=float(q), kind=kind))
    return out
def _rough(seg):
    n = np.arange(len(seg)); return float(np.std(seg - np.polyval(np.polyfit(n, seg, 1), n)))

def plot_clicks(x, clicks, path, y=None):
    """two views of each candidate: 4 ms either side, and 40 ms either side. Red = x, blue = y (the repaired signal) if given."""
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    n = max(1, len(clicks)); per = min(3, n); rows = int(np.ceil(n / per)); fig, ax = plt.subplots(rows, per * 2, figsize=(24, 3.4 * rows)); ax = np.atleast_2d(ax)
    for q, c in enumerate(clicks):
        j = c['i']
        for h, half in enumerate((200, 1920)):
            k = np.arange(max(0, j - half), min(len(x), j + half)); p = ax[q // per][(q % per) * 2 + h]; p.plot((k - j) / SR * 1000, x[k], lw=0.8, color='tab:red')
            if y is not None: p.plot((k - j) / SR * 1000, y[k], lw=0.8, color='tab:blue')
            p.set_title('%.4f s  %s' % (c['t'], c.get('kind', '')) + ('  jump %+.2f' % c['jump'] if 'jump' in c else '') if h == 0 else 'the same, 40 ms either side', fontsize=9); p.grid(alpha=0.3)
    plt.tight_layout(); plt.savefig(path, dpi=64); plt.close(fig)

def peaks(x, n=10):
    """the n highest peaks: (time, level dBFS, width in ms at half height, level of the 20 ms before in dB).
    A lone narrow peak with a loud 'before' sits inside a word: suspect it of being a click the search missed."""
    a = np.abs(x); out = []
    for i in np.argsort(a)[::-1]:
        if all(abs(i - j) > 2400 for j, *_ in out):
            h = a[i] / 2; l = i; r = i
            while l > 0 and a[l] > h: l -= 1
            while r < len(a) - 1 and a[r] > h: r += 1
            out.append((int(i), 20 * np.log10(a[i] + 1e-12), (r - l) / SR * 1000, 20 * np.log10(np.sqrt(np.mean(x[max(0, i - 960):max(1, i - 48)]**2)) + 1e-9)))
        if len(out) >= n: break
    return [(i / SR, lv, w, pre) for i, lv, w, pre in sorted(out)]

def _ar_interpolate(y, s, e, order=32, ctx=2048):
    """re-draw samples s..e-1 so the prediction error across the gap is as small as possible"""
    r = np.zeros(order + 1)
    for seg in (y[max(0, s - ctx):s], y[e:e + ctx]):
        seg = (seg - seg.mean()) * np.hanning(len(seg)); r += np.correlate(seg, seg, 'full')[len(seg) - 1:len(seg) + order]
    r[0] *= 1.0005; a = np.zeros(order + 1); a[0] = 1; err = r[0]
    for i in range(1, order + 1):
        k = -(r[i] + np.dot(a[1:i], r[i - 1:0:-1])) / err; a[1:i] = a[1:i] + k * a[i - 1:0:-1]; a[i] = k; err *= (1 - k * k)
    m = e - s; rows = np.arange(s, e + order); A = np.zeros((len(rows), m)); b = np.zeros(len(rows))
    for q, n in enumerate(rows):
        for k in range(order + 1):
            t = n - k
            if s <= t < e: A[q, t - s] = a[k]
            else: b[q] += a[k] * y[t]
    out = y.copy(); out[s:e] = np.linalg.lstsq(A, -b, rcond=None)[0]; return out

def fix_step(x, j, W_ms=4.0, gap=12):
    """j = sample just before the jump. The jump is spread over 2*W_ms (a slow change the voice masks) and the
    half millisecond around it is re-drawn from its surroundings."""
    W = int(W_ms * 1e-3 * SR); c0 = j + 0.5; nl = np.arange(j - 64, j - 9); nr = np.arange(j + 11, j + 66)
    d = np.polyval(np.polyfit(nr - c0, x[nr], 2), 0.0) - np.polyval(np.polyfit(nl - c0, x[nl], 2), 0.0)
    n = np.arange(j - W, j + W + 1); c = np.clip(0.5 - 0.5 * np.cos(np.pi * (n - (c0 - W)) / (2 * W)), 0, 1)
    y = x.copy(); y[n] = x[n] + d * (c - (n > j))
    return _ar_interpolate(y, j - gap + 1, j + gap + 1), d

def declick(x, steps):
    y = x.copy(); sizes = []
    for j in steps: y, d = fix_step(y, int(j)); sizes.append(d)
    return y, sizes

# ---------------------------------------------------------------- polish
P = dict(lp_hz=None,                 # low-pass just above the source's band limit when a mirror image sits above it; None = leave
         hp_hz=50, shelf=[],         # shelf: list of (corner Hz, gain dB, slope) low shelves, applied in series
         ds_band=None, ds_thresh=-25.0, ds_ratio=3.0, ds_knee=4.0, ds_max=9.0, ds_attack_ms=1.5, ds_release_ms=40.0,     # ds_band None = no de-essing
         trim_max=1.5, lim_ceiling_db=None, lim_take_db=2.0, lim_lookahead_ms=1.5, lim_release_ms=30.0)

def suggest(d):
    """settings from the measurements, deliberately conservative: nothing is changed unless the numbers say it is clearly off"""
    p = dict(P)
    if d['band_limit_hz'] < 20000 and d['image_db_over_floor'] > 10: p['lp_hz'] = round(d['band_limit_hz'] + 400, -2)
    p['hp_hz'] = float(np.clip(round(0.7 * d['f0_p10'] / 5) * 5, 40, 100))
    cut = float(np.clip(d['fund_vs_mid'] - 12.0, 0, 7))                    # bring a booming fundamental back to +12 dB over the 400-500 Hz band, never more than 7 dB
    if cut >= 1.0: g = -round(cut / 2 / 0.914, 2); p['shelf'] = [(round(1.65 * d['f0'] / 5) * 5, g, 1.15)] * 2
    if d['sib_over_vowel'] is not None and d['sib_over_vowel'] > 5.0:
        p['ds_band'] = d['sib_band']; p['ds_thresh'] = round(d['sib_level_db'] - 6.75, 1)       # a typical "s" comes down about 4.5 dB, the hottest at most ds_max
    return p

def low_shelf(f0, gain_db, S=1.0):
    A = 10**(gain_db / 40); w0 = 2 * np.pi * f0 / SR; al = np.sin(w0) / 2 * np.sqrt((A + 1 / A) * (1 / S - 1) + 2); c = np.cos(w0)
    b = [A * ((A + 1) - (A - 1) * c + 2 * np.sqrt(A) * al), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - 2 * np.sqrt(A) * al)]
    a = [(A + 1) + (A - 1) * c + 2 * np.sqrt(A) * al, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - 2 * np.sqrt(A) * al]
    return np.array(b) / a[0], np.array(a) / a[0]

def _fir(x, h):
    d = (len(h) - 1) // 2; return signal.fftconvolve(np.r_[x, np.zeros(d)], h)[d:d + len(x)]       # linear phase, delay removed

def _smooth_ar(v, attack_ms, release_ms):
    a, r = np.exp(-1 / (attack_ms * 1e-3 * SR)), np.exp(-1 / (release_ms * 1e-3 * SR)); out = np.empty_like(v); s = 0.0
    for i, t in enumerate(v):
        c = a if t > s else r; s = c * s + (1 - c) * t; out[i] = s
    return out

def deess_level(x, band):
    h = signal.firwin(129, list(band), pass_zero=False, window=('kaiser', 5.0), fs=SR); b = _fir(x, h); w = int(0.003 * SR)
    return b, 20 * np.log10(np.sqrt(np.convolve(b**2, np.ones(w) / w, 'same')) + 1e-9)

def deess(x, p):
    """turn the sibilant band down only while it is loud; returns (signal, reduction in dB per sample)"""
    band, L = deess_level(x, p['ds_band']); over = L - p['ds_thresh']; k = p['ds_knee']; slope = 1 - 1 / p['ds_ratio']
    gr = np.where(over <= -k / 2, 0.0, np.where(over >= k / 2, over * slope, slope * (over + k / 2)**2 / (2 * k))); gr = np.minimum(gr, p['ds_max'])
    la = int(0.002 * SR); gr = _smooth_ar(np.r_[gr[la:], np.zeros(la)], p['ds_attack_ms'], p['ds_release_ms'])       # looks 2 ms ahead
    return x - band * (1 - 10**(-gr / 20)), gr

def level_lines(x, lines, trim_max=1.5):
    """one gain per line so all lines read the same loudness; gains change only inside the pauses"""
    lv = np.array([lufs_ungated(x[int(a * SR):int(b * SR)]) for a, b in lines]); g = np.clip(np.median(lv) - lv, -trim_max, trim_max)
    edges = [0.0] + [(lines[i][1] + lines[i + 1][0]) / 2 for i in range(len(lines) - 1)] + [len(x) / SR]; env = np.zeros(len(x))
    for i in range(len(lines)): env[int(edges[i] * SR):int(edges[i + 1] * SR)] = g[i]
    k = int(0.04 * SR); win = np.hanning(k); win /= win.sum(); env = np.convolve(np.r_[np.full(k, env[0]), env, np.full(k, env[-1])], win, 'same')[k:-k]
    return x * 10**(env / 20), g

def _limit_gain(peak, ceiling, lookahead_ms, release_ms):
    """gain that keeps `peak` under `ceiling`: already down when a peak arrives, moves smoothly (no steps), recovers slowly"""
    la = int(lookahead_ms * 1e-3 * SR); need = np.minimum(1.0, ceiling / np.maximum(peak, 1e-12)); g1 = minimum_filter1d(need, size=2 * la + 1, mode='nearest')
    r = np.exp(-1 / (release_ms * 1e-3 * SR)); g2 = np.empty_like(g1); s = 1.0
    for i, t in enumerate(g1): s = min(t, r * s + (1 - r)); g2[i] = s
    win = np.hanning(2 * la + 3)[1:-1]; win /= win.sum(); return np.convolve(np.r_[np.full(la, g2[0]), g2, np.full(la, g2[-1])], win, 'valid')

def polish(x, p, lines=None, steps=()):
    """click repair -> band tidy -> low end -> de-ess -> line levelling -> peak control. Returns (voice, info)."""
    info = {}; y, info['click_sizes'] = declick(x, steps)
    if p['lp_hz']: y = _fir(y, signal.firwin(255, p['lp_hz'], window=('kaiser', 8.0), fs=SR))
    if p['hp_hz']: y = signal.sosfilt(signal.butter(4, p['hp_hz'], 'high', fs=SR, output='sos'), y)
    for f0, g, S in p['shelf']: y = signal.lfilter(*low_shelf(f0, g, S), y)
    if p['ds_band']: y, info['deess_db'] = deess(y, p)
    lines = lines or speech_regions(x); y, info['trims'] = level_lines(y, lines, p['trim_max'])
    ceil_db = p['lim_ceiling_db'] if p['lim_ceiling_db'] is not None else 20 * np.log10(np.abs(y).max()) - p['lim_take_db']
    info['peaks'] = peaks(y, 8)                                           # before peak control: an outlier here is worth a look
    g = _limit_gain(np.abs(y), 10**(ceil_db / 20), p['lim_lookahead_ms'], p['lim_release_ms']); info['limit_db'] = -20 * np.log10(g)
    return y * g, info

# ---------------------------------------------------------------- mix
M = dict(voice_over_music_db=2.0,    # voice loudness above the music's own loudness
         duck_db=-9.0,               # how far the music drops under a line
         duck_extra={},              # {line index: depth} for lines that sit on dense music
         falls={},                   # {line index: (start, end)} to time one duck by hand, e.g. just after an accent that must land first
         hits=[],                    # times of the music's accents (the picture cuts): the duck recovers in time for an accent in a pause
         fall_s=0.30, hold_s=0.15, rise_s=1.0, bridge_s=0.7,                 # pauses shorter than bridge_s stay ducked: every such pause, so raise it with care
         bridge_after=[],            # line indices after which the music stays down however long the pause: for two lines of one thought
         bed_margin_db=6.0, bed_ratio=4.0, bed_max_db=6.0, bed_attack_ms=40.0, bed_release_ms=300.0,
         target_lufs=-16.0, ceiling_dbtp=-1.5)

def duck_envelope(n, regions, p):
    """music gain in dB: 0 between lines, the duck depth under them"""
    t = np.arange(n) / SR; want = np.zeros(n); ramp = lambda u: 0.5 - 0.5 * np.cos(np.pi * np.clip(u, 0, 1)); blocks = []
    for k, (a, b) in enumerate(regions):
        depth = p['duck_extra'].get(k, p['duck_db'])
        if blocks and (a - blocks[-1][1] < p['bridge_s'] or (k - 1) in p.get('bridge_after', ())): blocks[-1] = (blocks[-1][0], b, min(blocks[-1][2], depth), blocks[-1][3])
        else: blocks.append((a, b, depth, k))
    plan = []
    for q, (a, b, depth, k) in enumerate(blocks):
        f0, f1 = p['falls'].get(k, (a - p['fall_s'], a)); r0 = b + p['hold_s']; r1 = r0 + p['rise_s']; nxt = blocks[q + 1][0] if q + 1 < len(blocks) else n / SR
        hit = next((h for h in p['hits'] if r0 + 0.3 <= h - 0.05 and h < nxt - 0.05), None)
        if hit is not None: r1 = min(r1, hit - 0.05)
        plan.append((f0, f1, r0, r1, depth)); want = np.minimum(want, depth * np.minimum(ramp((t - f0) / (f1 - f0)), 1 - ramp((t - r0) / (r1 - r0))))
    return want, plan

def bed_limit(music, voice2, env, p):
    """extra reduction (dB <= 0) while a line is spoken: when a hit or chord rises in the speech band (300 Hz - 4 kHz) to within
    bed_margin_db of the voice's usual level it is pressed back. The slow attack lets the first instant of a hit through."""
    bp = signal.butter(4, [300, 4000], 'band', fs=SR, output='sos'); w = int(0.05 * SR); k = np.ones(w) / w
    lm = 10 * np.log10(np.convolve((signal.sosfiltfilt(bp, music, axis=0)**2).sum(axis=1), k, 'same') + 1e-20)
    lv = 10 * np.log10(np.convolve((signal.sosfiltfilt(bp, voice2, axis=0)**2).sum(axis=1), k, 'same') + 1e-20); vref = np.median(lv[lv > lv.max() - 25])
    over = lm - (vref - p['bed_margin_db']); kn = 3.0; slope = 1 - 1 / p['bed_ratio']
    gr = np.where(over <= -kn / 2, 0.0, np.where(over >= kn / 2, over * slope, slope * (over + kn / 2)**2 / (2 * kn))); gr = np.minimum(gr, p['bed_max_db'])
    return -_smooth_ar(gr * np.clip(env / p['duck_db'], 0, 1), p['bed_attack_ms'], p['bed_release_ms'])

def limiter_tp(x, ceiling_dbtp, lookahead_ms=2.0, release_ms=60.0, os=4):
    x = _2d(x); up = np.max(np.abs(signal.resample_poly(x, os, 1, axis=0)), axis=1); pk = maximum_filter1d(up[:len(x) * os].reshape(len(x), os).max(axis=1), size=3, mode='nearest')
    g = _limit_gain(pk, 10**(ceiling_dbtp / 20), lookahead_ms, release_ms); return x * g[:, None], -20 * np.log10(g)

def mix(voice, music, p):
    """voice: mono, polished. music: (n, 2). Returns (stereo mix at target loudness, info)."""
    music = _2d(music); n = len(music); voice = np.r_[voice, np.zeros(max(0, n - len(voice)))][:n]        # the music (the film) sets the length
    if music.shape[1] == 1: music = np.c_[music, music]
    regions = speech_regions(voice); lm = lufs_integrated(music)
    gv = 0.0 if lm < -60 else (lm + p['voice_over_music_db']) - lufs_integrated(np.c_[voice, voice])               # a film with no sound: the voice alone, at target loudness
    env, plan = duck_envelope(n, regions, p); v2 = np.c_[voice, voice] * 10**(gv / 20); m2 = music * 10**(env / 20)[:, None]
    bed = bed_limit(m2, v2, env, p); m2 = m2 * 10**(bed / 20)[:, None]; s = v2 + m2
    g = p['target_lufs'] - lufs_integrated(s); out, gr = limiter_tp(s * 10**(g / 20), p['ceiling_dbtp'])
    g2 = p['target_lufs'] - lufs_integrated(out); out = out * 10**(g2 / 20); k = 10**((g + g2) / 20)
    return out, dict(regions=regions, plan=plan, env=env, bed=bed, limit_db=gr, voice_gain=gv + g + g2, music_gain=g + g2, voice=v2 * k, music=m2 * k)

def check_mix(out, info):
    """Per line: how far the voice stands over the music. Aim for 9 dB or more in the speech band (300 Hz - 4 kHz) and 3 dB or more in
    the worst 0.3 s. 'voice dip' says how far the voice itself has dropped in that worst window: below about -6 the weak moment is a
    soft syllable, not loud music."""
    v, m = info['voice'], info['music']; P_ = lambda z: 10 * np.log10(np.sum(np.mean(z**2, axis=0)) + 1e-20)
    bp = signal.butter(6, [300, 4000], 'band', fs=SR, output='sos'); vb, mb = signal.sosfiltfilt(bp, v, axis=0), signal.sosfiltfilt(bp, m, axis=0)
    ph = signal.butter(2, [300, 7000], 'band', fs=SR, output='sos'); vp, mp = signal.sosfilt(ph, v, axis=0), signal.sosfilt(ph, m, axis=0)
    print('mix %.2f LUFS | true peak %.2f dBTP | voice gain %+.2f dB | music gain %+.2f dB | limiter max %.2f dB' % (lufs_integrated(out), true_peak(out), info['voice_gain'], info['music_gain'], info['limit_db'].max()))
    print('line  start    end   duck   over music: K-weighted  300Hz-4kHz  phone   worst 0.3 s (voice dip)'); rows = []
    for k, (a, b) in enumerate(info['regions']):
        i, j = int(a * SR), int(b * SR); w = int(0.3 * SR); idx = list(range(i, max(i + 1, j - w), 2400)); vals = [P_(vb[q:q + w]) - P_(mb[q:q + w]) for q in idx]; z = int(np.argmin(vals))
        row = (k, a, b, (info['env'] + info['bed'])[i:j].mean(), lufs_ungated(v[i:j]) - lufs_ungated(m[i:j]), P_(vb[i:j]) - P_(mb[i:j]), lufs_ungated(vp[i:j]) - lufs_ungated(mp[i:j]), vals[z], idx[z] / SR, P_(vb[idx[z]:idx[z] + w]) - P_(vb[i:j])); rows.append(row)
        print('%3d  %6.2f %6.2f  %5.1f        %6.1f       %6.1f   %6.1f     %5.1f dB at %.2f s (%+.0f)' % row)
    return rows

def report_pauses(info, hits):
    """What the music does between the lines, printed because it cannot be heard: how far it comes back in each pause (0 = fully back),
    its level at each accent that falls in a pause, and where it is when the film ends."""
    g = info['env'] + info['bed']; reg = info['regions']; n = len(g); at = lambda h: float(g[max(0, int((h - 0.05) * SR)):min(n, int((h + 0.05) * SR) + 1)].max())
    edges = [(0.0, reg[0][0])] + [(reg[k][1], reg[k + 1][0]) for k in range(len(reg) - 1)] + [(reg[-1][1], n / SR)]
    print('between the lines (music against its full level, dB; 0 = fully back):')
    for q, (a, b) in enumerate(edges):
        i = int(a * SR); top = float(g[i:max(i + 1, int(b * SR))].max()); hs = [h for h in hits if a <= h <= b]
        where = 'before the first line' if q == 0 else 'after the last line' if q == len(edges) - 1 else 'after line %d' % (q - 1)
        print('  %-21s %6.2f-%6.2f s (%.2f s)  comes back to %5.1f  | %s' % (where, a, b, b - a, top, ', '.join('accent at %.2f s: %.1f' % (h, at(h)) for h in hs) or 'no accent in it'))
    under = [h for h in hits if any(a < h < b for a, b in reg)]
    if under: print('  accents that fall under a line (pressed down by design): ' + ' '.join('%.2f' % h for h in under))
    print('  when the film ends: %.1f | deepest moment: %.1f at %.2f s' % (g[-1], g.min(), np.argmin(g) / SR))

def plot_mix(info, hits, path):
    """top: voice and music levels as mixed; bottom: the music's gain. Red bands = lines, green dashes = accents."""
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    g = info['env'] + info['bed']; hop = 480; m = len(g) // hop; tt = np.arange(m) * hop / SR
    lv = lambda z: 10 * np.log10((_2d(z)[:m * hop]**2).sum(axis=1).reshape(m, hop).mean(axis=1) + 1e-12)
    fig, ax = plt.subplots(2, 1, figsize=(24, 8), sharex=True)
    ax[0].plot(tt, lv(info['voice']), lw=0.8, color='tab:red', label='voice'); ax[0].plot(tt, lv(info['music']), lw=0.8, color='tab:blue', label='music, as mixed')
    ax[0].set_ylim(-70, 0); ax[0].set_ylabel('level, dB'); ax[0].legend(loc='lower right'); ax[1].plot(tt, g[:m * hop:hop], lw=1.2, color='k'); ax[1].set_ylabel('music gain, dB'); ax[1].set_xlabel('seconds')
    for p_ in ax:
        for k, (a, b) in enumerate(info['regions']): p_.axvspan(a, b, color='tab:red', alpha=0.08)
        for h in hits: p_.axvline(h, color='tab:green', lw=0.9, ls='--')
        p_.grid(alpha=0.3); p_.set_xticks(np.arange(0, m * hop / SR + 1, 1.0))
    for k, (a, b) in enumerate(info['regions']): ax[1].text((a + b) / 2, 0.6, str(k), ha='center', fontsize=10)
    plt.tight_layout(); plt.savefig(path, dpi=64); plt.close(fig)

def find_hits(music, min_rise_db=6.0, min_gap=0.4):
    """times where the music jumps up: its accents. Use the film's cut times instead when you know them."""
    k = kweight(music); w = int(0.05 * SR); hop = int(0.01 * SR); e = np.array([-0.691 + 10 * np.log10(np.sum(np.mean(k[i:i + w]**2, axis=0)) + 1e-12) for i in range(0, len(k) - w, hop)])
    hits = []
    for i in range(35, len(e) - 5):
        before = e[i - 35:i - 5].max(); now = e[i:i + 5].max()
        if now - before >= min_rise_db and now > np.median(e) - 3 and (not hits or i * 0.01 + 0.03 - hits[-1] >= min_gap): hits.append(round(i * 0.01 + 0.03, 2))
    return hits

def auto_knobs(voice, music, p, want_db=9.0, max_extra_db=3.5):
    """A first setting of the two per-line knobs, from measurement:
    falls      - when an accent lands just before a line (within 0.35 s), let it land, then duck quickly
    duck_extra - lines that sit less than want_db over the music in the speech band get more duck, up to max_extra_db
    Read check_mix afterwards and adjust by hand; these are starting values."""
    p = dict(p, duck_extra=dict(p['duck_extra']), falls=dict(p['falls'])); regions = speech_regions(voice); fixed = set(p['duck_extra'])
    for k, (a, b) in enumerate(regions):
        h = [h for h in p['hits'] if a - 0.35 <= h <= a - 0.02]
        if h and k not in p['falls']: p['falls'][k] = (round(h[-1] + 0.03, 2), round(h[-1] + 0.20, 2))
    bp = signal.butter(6, [300, 4000], 'band', fs=SR, output='sos')
    for _ in range(3):                                                    # the mix is re-levelled after every change, so approach the aim in a few passes
        out, info = mix(voice, music, p); vb, mb = signal.sosfiltfilt(bp, info['voice'], axis=0), signal.sosfiltfilt(bp, info['music'], axis=0)
        for k, (a, b) in enumerate(regions):
            i, j = int(a * SR), int(b * SR); vm = 10 * np.log10(np.sum(np.mean(vb[i:j]**2, axis=0)) / (np.sum(np.mean(mb[i:j]**2, axis=0)) + 1e-20))
            if vm < want_db and k not in fixed: p['duck_extra'][k] = float(round(max(p['duck_db'] - max_extra_db, p['duck_extra'].get(k, p['duck_db']) - (want_db - vm) - 0.2), 1))
    return p

def in_step(a, b, seconds=20):
    """are two recordings of the same programme lined up? returns (lag of a behind b in samples, correlation 0..1). Use it to check that a
    music stem really is the film's own music before mixing onto it."""
    n = min(len(a), len(b), int(seconds * SR)); u, v = _2d(a)[:n].mean(axis=1), _2d(b)[:n].mean(axis=1); c = signal.correlate(u, v, 'full', 'fft'); k = int(np.argmax(np.abs(c)))
    return k - (n - 1), float(abs(c[k]) / (np.sqrt(np.sum(u**2) * np.sum(v**2)) + 1e-20))

def phone(x):
    """roughly what a phone speaker passes: 300 Hz - 7 kHz"""
    return signal.sosfilt(signal.butter(2, [300, 7000], 'band', fs=SR, output='sos'), _2d(x), axis=0)

# ---------------------------------------------------------------- hearing by machine: speech recognition
MODELS = os.environ.get('VO_MODELS', os.path.expanduser('~/.cache/vo-models'))
def _recognizers(models):
    import sherpa_onnx
    p = os.path.join(models, 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8'); w = os.path.join(models, 'sherpa-onnx-whisper-base.en')
    pk = sherpa_onnx.OfflineRecognizer.from_transducer(encoder=p + '/encoder.int8.onnx', decoder=p + '/decoder.int8.onnx', joiner=p + '/joiner.int8.onnx', tokens=p + '/tokens.txt', model_type='nemo_transducer', num_threads=4)
    wh = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=w + '/base.en-encoder.onnx', decoder=w + '/base.en-decoder.onnx', tokens=w + '/base.en-tokens.txt', language='en', task='transcribe', num_threads=4)
    return pk, wh

def transcribe(x, regions, models=MODELS):
    """Two independent recognizers listen to x (mono or stereo, 48 kHz). Lines are grouped into stretches of at most 29 s of roughly
    equal length, because short isolated clips are misheard and one of the models takes at most 30 s.
    Returns (text heard by the first, text heard by the second, [(word, start seconds), ...] from the first).
    Word times are good to about a tenth of a second: for the start of a line trust the region's start instead."""
    pk, wh = _recognizers(models); mono = _2d(x).mean(axis=1); t1, t2, words = [], [], []
    span = regions[-1][1] - regions[0][0]; parts = int(np.ceil(span / 29.0)); target = span / parts + 1.0; chunks = []
    for a, b in regions:
        if chunks and b - chunks[-1][0] <= min(29.0, target): chunks[-1][1] = b
        else: chunks.append([a, b])
    for a, b in chunks:
        i, j = max(0, int((a - 0.25) * SR)), min(len(mono), int((b + 0.25) * SR)); seg = signal.resample_poly(mono[i:j], 1, 3).astype(np.float32)
        s = pk.create_stream(); s.accept_waveform(16000, seg); pk.decode_stream(s); r = s.result; t1.append(r.text.strip()); first = True
        for tok, ts in zip(r.tokens, r.timestamps):
            if tok.startswith(' ') or tok.startswith('\u2581') or first: words.append([tok.strip().lstrip('\u2581'), ts + i / SR]); first = False
            else: words[-1][0] += tok
        s = wh.create_stream(); s.accept_waveform(16000, seg); wh.decode_stream(s); t2.append(s.result.text.strip())
    for w in words:                                                       # a word cannot start in a pause: move it to the start of the line that follows
        if not any(a <= w[1] <= b for a, b in regions):
            nxt = [a for a, b in regions if a > w[1]]
            if nxt and nxt[0] - w[1] < 0.6: w[1] = nxt[0]
    return ' '.join(t1), ' '.join(t2), [(w, round(t, 2)) for w, t in words]

def same_words(heard, script):
    import re; n = lambda s: re.sub(r"[^a-z0-9' ]", '', s.lower().replace('’', "'")).split(); return n(heard) == n(script)
