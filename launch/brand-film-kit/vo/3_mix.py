# 3_mix.py - the voice over the music:  python3 3_mix.py film.mp4 [--music score.wav] [--hits "3.75,6.75,..."]
#   --music  the music on its own, when it exists (cleaner than the film's decoded sound); it is checked against the film
#   --hits   times of the picture cuts and musical accents, when known; otherwise they are estimated from the music
import sys, json, subprocess, numpy as np, vo
arg = lambda k: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else None
voice = np.load('work/voice_clean.npy')
probe = lambda *a: subprocess.run(['ffprobe', '-v', 'error', *a, '-of', 'csv=p=0', sys.argv[1]], capture_output=True, text=True).stdout.strip()
film = vo.load48(sys.argv[1]) if probe('-select_streams', 'a', '-show_entries', 'stream=index') else np.zeros((int(float(probe('-show_entries', 'format=duration')) * vo.SR), 2))     # no sound stream at all: silence of the film's length
music = film
if arg('--music'):
    music = vo.load48(arg('--music')); lag, corr = vo.in_step(music, film)
    print('music stem against the film\'s own sound: lag %d samples, correlation %.3f (wanted: 0 and above 0.98; otherwise the stem is not this film\'s music as cut)' % (lag, corr))
hits = [float(v) for v in arg('--hits').split(',')] if arg('--hits') else vo.find_hits(music) if np.abs(music).max() > 0 else []
have = float(vo.lufs_integrated(film)); silent = not have > -60
if silent: print('the film has no sound: the mix will be the voice alone, at %.0f LUFS' % vo.M['target_lufs'])
m = dict(vo.M, hits=hits, target_lufs=vo.M['target_lufs'] if silent else round(have, 1))        # keep the loudness the film already has
m = vo.auto_knobs(voice, music, m)                                    # first settings from measurement; then adjust by hand below this line, e.g. m['duck_extra'][10] = -12.5 or m['bridge_after'] = [0]
print('accents:', hits, '\nduck_extra:', m['duck_extra'], '\nfalls:', m['falls'])
out, info = vo.mix(voice, music, m); vo.check_mix(out, info)
if not silent: vo.report_pauses(info, hits)
vo.plot_mix(info, hits, 'work/mix.png')                                 # then LOOK at work/mix.png
vo.write_wav24('work/mix.wav', out); json.dump(m, open('work/mix_settings.json', 'w'), indent=1, default=str)
