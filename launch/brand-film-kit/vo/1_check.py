# 1_check.py - measure the voice and look for defects:  python3 1_check.py voice.wav [script.txt] [film.mp4]
import sys, os, json, subprocess, numpy as np, vo
os.makedirs('work', exist_ok=True); os.makedirs('out', exist_ok=True)
x = vo.load48(sys.argv[1], mono=True); np.save('work/voice_in.npy', x)
d = vo.diagnose(x)
if len(sys.argv) > 3:
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', sys.argv[3]], capture_output=True, text=True).stdout)
    print('film %.3f s, voice file %.3f s: %s' % (dur, d['duration'], 'same length, so the voice is laid out on the film\'s timeline' if abs(dur - d['duration']) < 0.1 else 'different lengths'))
clicks = vo.find_clicks(x); show = [c for c in clicks if c['kind'] != 'burst']; vo.plot_clicks(x, show, 'work/clicks.png')      # then LOOK at work/clicks.png
print('click search: %d steps, %d unsure, %d consonant bursts left alone' % (sum(c['kind'] == 'step' for c in clicks), sum(c['kind'] == 'unsure' for c in clicks), sum(c['kind'] == 'burst' for c in clicks)))
for c in show: print('  %9.4f s  %-6s jump %+.2f  sample %d' % (c['t'], c['kind'], c['jump'], c['i']))
for name, extra in (('spectrum', ':fscale=log'), ('spectrum_top', ':fscale=lin:start=8000:stop=24000')):                         # and at these two
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', sys.argv[1], '-lavfi', 'showspectrumpic=s=1800x720:legend=1:drange=110' + extra, 'work/%s.png' % name])
if len(sys.argv) > 2:                                                                 # do the words match the script, and when is each word spoken?
    script = open(sys.argv[2]).read()
    try: h1, h2, words = vo.transcribe(x, d['regions'])
    except Exception as e: h1 = None; print('WORD CHECK SKIPPED: the speech recognizers could not be started (%s: %s). Everything else stands; say so in the delivery.' % (type(e).__name__, str(e)[:120]))
    if h1 is not None:
        print('words match the script: recognizer 1 %s, recognizer 2 %s' % (vo.same_words(h1, script), vo.same_words(h2, script)))
        if not (vo.same_words(h1, script) and vo.same_words(h2, script)): print('  heard 1:', h1, '\n  heard 2:', h2)
        print('word times (within about 0.1 s): ' + ' '.join('%s@%.2f' % w for w in words)); d['words'] = words
json.dump(dict(d, clicks=clicks), open('work/check.json', 'w'), indent=1, default=float)
