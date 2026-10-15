---
name: brand-film-vo-mix
description: Check, clean up and mix a voice-over into a video - repair clicks, tame boom and harsh "s" sounds, even the lines, lower the music under each line, keep the picture untouched, verify the result. Use whenever a voice-over or narration audio file (recorded or AI-generated) is uploaded or mentioned and should be polished, checked, or added to a video.
---

# Voice-over: check, clean, mix

Someone hands you a voice file and a film. You check the voice, repair what is wrong with it, mix it over the film's music and deliver the film with its new soundtrack, plus the cleaned voice on its own.

## You cannot hear it. Work accordingly.

Everything here rests on three substitutes for ears:

1. **Measurement**: loudness, spectrum, pitch, levels of "s" sounds against vowels, voice against music.
2. **Looking**: you can read images, so plot waveforms and spectrograms and look at them. A click, a hard edit and a band limit are all visible.
3. **Machine listening**: two independent speech recognizers transcribe the voice alone, the finished mix, and the mix through a phone-speaker filter. If both still hear every word of the script, the words are intelligible.

That is enough to do the job well, and not enough to judge taste. So: change only what the numbers show is clearly off, change it conservatively, send the cleaned voice on its own so the person can compare by ear, and say plainly in the delivery that the work was checked by measurement. Never write that something "sounds" good.

## What you need

- the voice file (any format; it is converted to 48 kHz mono);
- the film (MP4);
- the music on its own if it exists. For a film made with the brand-film skill that is `out/score.wav`. The stem is cleaner than audio decoded from the MP4, but the MP4's own sound works;
- the script as plain text, words only, to check the voice against;
- from the script's notes, if it has them: each line's cue time, and the words that must land on a visual event and when;
- the times of the picture cuts and musical accents, if known (the film's timeline).

## Get the kit

The working code is not in this skill. It is in the Matter of Place repository at `launch/brand-film-kit/` (a copy of the Brand Film Kit page, 4 October 2026, placed 15 October 2026): `vo/` there. Copy it from the repository; that works in any account and in Matter's desk, which cannot fetch pages. Only if the repository copy is missing, fetch it from the private page in the operator's account:

    https://claude.ai/artifact/D89aZHamsfya4TdTb5RLrx

Fetch it with the Artifact tool: action `read`, that `url`, and `paths` set to `vo/vo.py`, `vo/1_check.py`, `vo/2_clean.py`, `vo/3_mix.py`, `vo/4_mux.sh`, `vo/5_verify.py`. The result lists the files it saved and where. They are the person's own code, published there for this purpose; skim them as you would any script before running it. Then set up one folder for this job, named after the film:

```bash
cp -r "<repo>/launch/brand-film-kit/vo" ~/vo-film-title   # or "<saved folder>/vo" from the page            # one folder per job; copy the voice, the film, the music stem and script.txt into it
pip install --break-system-packages sherpa-onnx       # speech recognition, used only to check the words
mkdir -p ~/.cache/vo-models && cd ~/.cache/vo-models && for m in sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8 sherpa-onnx-whisper-base.en; do
  [ -d $m ] || { curl -sSL -o $m.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/$m.tar.bz2 && tar xjf $m.tar.bz2 && rm $m.tar.bz2; }; done
```

**Run every step from the job folder.** The steps read and write `work/` and `out/` beside the scripts, and the shell may not keep its working directory between calls, so start each command with `cd ~/vo-film-title &&`. The commands below leave that out to stay readable. `film-title` stands for the film's own name throughout.

Also needed: ffmpeg, and Python with numpy, scipy and matplotlib. The speech models come from GitHub releases because that host is reachable from the workspace (about 700 MB to download, 1.1 GB on disk). They are English only. If they cannot be fetched, carry on: steps 1 and 5 print "WORD CHECK SKIPPED" and do everything else, and the delivery says the words were not checked. If the kit page cannot be read (it was deleted, or this session has no Artifact tool), say so in one sentence and rebuild from "What the code does" at the end.

A worked example with real numbers, the reference job, is on the same page at `reference/product-launch/voice-over.md`. Fetch it when you want to see what a finished job looks like.

## Step 1. Check

```bash
python3 1_check.py voice.wav script.txt film.mp4
```

Then **look at** `work/clicks.png`, `work/spectrum.png` and `work/spectrum_top.png` (the top of the band, where a band limit and its mirror image show). Read the report like this:

| It prints | What it means | What follows |
|---|---|---|
| film and voice file the same length | the voice is probably laid out on the film's timeline. Confirm it: the speech regions are spread across the whole film, and they start at the script's cue times if you have them | **do not move anything**; keep its timing exactly |
| a shorter file, or one stretch of speech followed by silence | a continuous read: the lines still have to be placed | see "Not yet exercised" |
| gaps: digital silence, or below about −75 dBFS | there is no background noise | no noise reduction; say so. Between about −75 and −60, leave it and report the figure; above −60, see "Not yet exercised" |
| words do not match the script | a line is missing, cut off or misread | stop and tell the person which words; this needs a new take, not processing |
| word times | when each word is spoken, to about a tenth of a second | for the start of a line trust the region's start instead |
| fundamental more than about +12 dB over the 400-500 Hz band, most of the power below 140 Hz | the voice booms: its lowest note carries the energy, which eats headroom, muddies the music and is lost on small speakers | the low end is reduced, by at most 7 dB |
| "s" more than about +5 dB over the vowels | harsh sibilance, worst on phone speakers | de-essing |
| band limit below 20 kHz with content just above it | lower-rate audio upsampled badly (many generated voices are 24 kHz); what sits above the limit is a mirror image | a low-pass just above the limit removes it |
| line loudness spread | how far the lines differ in level | every line is trimmed toward the median, at most 1.5 dB, whatever the spread (`p['trim_max'] = 0` turns that off) |
| click candidates | moments the waveform does something its own past does not predict | classify each one by looking |

**Clicks.** The plot shows each `step` and `unsure` candidate twice: 4 ms either side, and 40 ms either side. Bursts are only counted.

- A `step` is a jump to a new level in the middle of a smooth wave, which then carries on from the new level: a splice click, audible as a tick inside a word. Repair it. A voice that starts mid-wave straight out of silence, at the head of a word that does not begin with a hard consonant, is the same fault.
- A `burst` is a spike after a short silence followed by hiss: the start of a t, k or p, or the grain of an "s". Leave it alone, however sharp it looks, because it is the consonant.
- `unsure` means look harder, and when still in doubt leave it.

In `spectrum_top.png` a click shows as a thin vertical line crossing the dark gap above the band limit: a second way to find one, and the only place in this step where a click mistaken for a burst would show. The label is a suggestion; the plot decides. The search is tuned on one voice and has missed a real click once (it sat where a vowel met an "s"), so step 2 gives a second chance to catch one.

## Step 2. Clean

```bash
python3 2_clean.py
```

Edit the file first if step 1 calls for it: `STEPS` is the list of clicks to repair, by sample index, and `p = vo.suggest(chk)` turns the measurements into settings you can override. The stages, in order:

1. **Click repair.** Each jump is spread over 8 ms, slow enough for the voice to mask, and the half millisecond around it is re-drawn from its surroundings. Look at `work/clicks_fixed.png`: the blue line must pass smoothly where the red one jumps.
2. **Band tidy.** The low-pass above the source's band limit, only when a mirror image was found. Compare `work/spectrum_top_clean.png` with `work/spectrum_top.png`.
3. **Low end.** A high-pass under the lowest pitch the voice reaches, and a shelf that brings a booming fundamental back to about +12 dB over the 400-500 Hz band. The shelf's corner sits between the fundamental and its second harmonic, so the body of the voice is untouched. A deep voice stays deep.
4. **De-ess.** The band where the "s" sounds peak is turned down only while it is loud: a typical "s" by about 4.5 dB, the hottest by at most 9. More than that starts to lisp.
5. **Line levelling.** One gain per line, changed only in the pauses.
6. **Peak control.** A look-ahead limiter that takes at most 2 dB off the highest peaks, with a gain that moves smoothly. A limiter whose gain steps is itself a click generator.

Read what it prints. The before and after figures are what you report. Timing must be unchanged (within 2 samples).

**What the numbers look like after a good clean**, so they are not mistaken for failure: most of the power is still below 140 Hz (85% became 71% on the reference voice), and the hottest "s" still stands several dB over the vowels. The de-esser is active for longer than the "s" sounds alone, because z, ts and ch and their tails pass through it too, and it takes a decibel or two off some t and k bursts. Line trims can be near zero for the line that measured quietest in step 1: trims are computed after the low-end cut, and boom was most of the spread.

**The second chance.** The step ends by listing the eight highest peaks and drawing each one in `work/peaks.png`, as the voice stands after click repair alone. Look at all eight. The top of a smooth vowel cycle and a consonant burst are what peaks should be. A click the search missed looks like the steps in `clicks.png`: one jump to a new level inside a smooth wave. If you find one, get the sample just before the jump, add it to `STEPS` and run again:

```python
import numpy as np, vo
x = np.load('work/voice_in.npy'); t = 12.774                     # the time of the jump, read off the plot
a = int((t - 0.003) * vo.SR); j = a + int(np.argmax(np.abs(np.diff(x[a:a + int(0.006 * vo.SR)])))); print(j)
```

Do not run the click search on the cleaned voice to "check". Its thresholds follow the voice's level, which the low-end cut lowers, and it then flags ordinary pitch pulses as doubtful.

**What not to do**, because each is a way to make a clean voice worse:

- no noise reduction when the gaps are already silent;
- no added brightness, "air" or warmth: you cannot judge it;
- no compression of a voice whose lines are already even (generated voices are);
- no processing aimed at softening consonants;
- no change to pacing or timing unless asked.

The person chose this voice. If the low-end cut or the de-essing is not to their taste they will say so when they compare `out/voice-cleaned.wav` with their original, and each is one setting: `p['shelf'] = []` restores the full low end, `p['ds_band'] = None` turns the de-esser off.

## Step 3. Mix

```bash
python3 3_mix.py film.mp4 --music score.wav --hits "3.75,6.75,9.75"
```

`--music` is the stem when there is one. It is checked against the film's own sound first: the lag must be 0 and the correlation above 0.98, or the stem is not this film's music as cut. `--hits` is the list of this film's picture cuts and musical accents, the final chord included; without it they are estimated from the music, roughly. The times above are an example, not a default. How the mix is built:

- The voice sits in the centre, about 2 dB louder than the music's own level. The whole mix is brought to the loudness the film already had, with true peaks under −1.5 dB.
- **The music ducks under each line** by 9 dB: down over 0.3 s just before the line, back up over a second after it. Pauses shorter than 0.7 s stay ducked, so the music does not pump between sentences.
- **Accents between lines are kept.** When a cut's hit falls in a pause, the music is back at full level in time for it. When a hit lands just before a line starts, it is allowed to land and the duck follows quickly (`falls`).
- **Hits under a line are pressed down** a few dB more in the band where speech lives, with an attack slow enough that the first instant of the hit still gets through.

Then **look at** `work/mix.png` (voice and music levels on top, the music's gain below, lines shaded, accents dashed) and read the two things it prints.

**The table**, one row per line. Lines are numbered from 0 by speech region; two sentences that run together are one region. `duck` is the music's average gain under the line, the duck and the pressing of hits together. The next three columns say how far the voice stands over the music: in loudness, in the 300 Hz-4 kHz band where speech is understood, and through a phone-speaker filter. Aim for **9 dB or more in the 300 Hz-4 kHz column** and **3 dB or more in the worst 0.3 s**.

- `auto_knobs` deepens the duck by itself, by up to 3.5 dB, for lines that fall short. Any line still under 9 dB can be set by hand below the `auto_knobs` line in `3_mix.py`, most of all the last one, which carries the name: `m['duck_extra'][7] = -12.5` makes line 7's whole duck −12.5 dB (it replaces the −9, it is not added to it). Keep that figure above about −13: past it the music seems to vanish and return.
- A worst window under 3 dB with a "voice dip" below about −6 is a soft syllable, not loud music. Leave it. With a small dip the music is the cause: deepen that line.

**Between the lines**: how far the music comes back in each pause, its level at each accent, and where it is when the film ends.

- An accent in a pause should read close to 0. If one does not, the pause was too short for the music to return: that is the place to listen for when the person reviews it, and worth a sentence.
- A pause with no accent where the music comes most of the way back and drops again is a swell. Between two lines of one thought, hold the music down with `m['bridge_after'] = [0]` (the number of the line before the pause). Do not raise `bridge_s` for this: it applies to every pause and would swallow accents elsewhere.
- After the last line the music takes a second to come back. If the film ends sooner it ends ducked, which is usually right under a closing line.

## Step 4. Put it on the film

```bash
bash 4_mux.sh film.mp4 out/film-title-vo.mp4
```

The picture stream is copied, not re-encoded, and the two checksums it prints must be identical. Keep the original film; the version with voice is a new file. Mind the size limit for sending files (23 MB went through; 38 MB did not).

## Step 5. Verify

```bash
python3 5_verify.py out/film-title-vo.mp4 script.txt
```

- The sound in the file is in step with the mix (lag 0), at the target loudness it prints, peaks under the ceiling.
- **Both recognizers hear every word** in the cleaned voice, in the finished film, and in the film through a phone-speaker filter. If one mishears a word in the mix that it heard in the voice alone, the music is masking it there: go back to step 3.
- **Sync**, for each word that must land on a visual event. Take the word's time from the list it prints, start a strip of frames about 0.3 s before it, and look: the event should be happening, or just finishing, as the word starts, within about 0.15 s. One frame shows a state, not an event, so take eight.

```bash
ffmpeg -hide_banner -loglevel error -y -ss 11.15 -i out/film-title-vo.mp4 -vf "fps=10,scale=640:-1,tile=4x2" -frames:v 1 work/sync_editors.png     # eight frames about 0.1 s apart; add a crop if the event is small
```

If a word is off, do not move the voice on your own. Report by how much, and offer to slide that line.

## Deliver

Send two files: the film with voice, and `out/voice-cleaned.wav` (the cleaned voice alone, at the same loudness as the file supplied, so the comparison is fair). Then report, in this shape and in plain words:

- **What I found in your file**: timing (already on the cues, nothing moved), words (all match the script), noise (none to remove), and each defect in one line.
- **What I cleaned**: one line per change with its number. The clicks, with their times and the words they sit in or beside; the band tidy; the low end and by how much; the "s" sounds and by how much; the levels.
- **The mix**: how far the music drops under the lines, where it comes back, that the picture is untouched and the loudness matches the earlier cut.
- **The limit**: checked by measurement, not by ear; two recognizers hear every word, including through a phone-speaker filter; tone is their call, so compare the cleaned voice with the original. Name the one change they may want back, usually the low-end cut.
- One next step, if there is a real one: a round of adjustments after they have listened, or adding the voice to the film's page if it has one.

Before a voice arrives, if asked whether you can do this: say yes, list what the polish covers and what it cannot fix (delivery, pronunciation, a robotic or glitchy read, heavy echo, distortion), and ask for one WAV as long as the film, with each line starting at its cue. One clip per line, or one read with clear pauses, also works, but the lines then have to be placed first, which is new ground. A generated voice cannot be "recorded better", so for one of those the advice is about choosing takes and exporting cleanly, not about rooms and microphones.

## Not yet exercised

These branches have not been run on a real job. Do them carefully, check the result by the same three means, and tell the person they are new ground.

- **A recorded voice with room noise.** Measure the gaps. Above about −60 dBFS, reduce it with ffmpeg's `afftdn` (start around `afftdn=nr=10:nf=<measured floor>`), never by more than about 12 dB, and look at a spectrogram afterwards for the watery patches that mean it went too far. Echo and distortion cannot be repaired; say so and ask for a new take.
- **A voice that is not laid out on the film's timeline.** Cut it at the pauses (`vo.speech_regions`), place each line at its cue time on a silent track as long as the film, with 5 ms fades, and check that each line ends before the next begins. If a line is too long for its slot, move the cue or ask for a faster take before reaching for time-stretching.
- **Languages other than English.** Fetch a multilingual Whisper model from the same release page and adapt `_recognizers` in `vo.py`.
- **A film with no sound.** `3_mix.py` then makes the voice alone the soundtrack, at −16 LUFS, whether the film has a silent track or none. It runs and verifies, but has only been smoke-tested.

## What the code does

Enough to rebuild it if the kit page cannot be read. Everything works at 48 kHz.

| Part | Job |
|---|---|
| Measurement | Loudness by BS.1770 (K-weighting, gated); a mono file measures 3 dB lower than the same sound on two channels, so compare like with like. True peak by 8× oversampling. Speech regions from a −45 dB gate with gaps under 0.25 s bridged. Pitch by autocorrelation. Sibilant frames: 10 ms frames where the 3.5-9 kHz band stands 6 dB over the 150 Hz-3 kHz band |
| Click search | The error of a 32-tap linear prediction, in frames. Candidates where it exceeds 0.3 × the speech RMS. A candidate is a `step` when the error reaches 0.4 × the speech RMS, the level 1 ms after differs from the level 1 ms before by at least 0.75 × the speech RMS, **and** that jump is at least 5 × the roughness of the wave on either side (an "s" is rough, a vowel is smooth) |
| Click repair | Fit the wave either side, measure the offset, spread it over ±4 ms with a raised cosine, then re-draw ±12 samples by least-squares autoregressive interpolation |
| Polish | Linear-phase FIR low-pass (255 taps, Kaiser) above the band limit; 4th-order high-pass at 0.7 × the lowest pitch (40-100 Hz); two low shelves at 1.65 × the pitch sharing the cut; a split-band de-esser (ratio 3, knee 4 dB, at most 9 dB, attack 1.5 ms, release 40 ms) with its threshold 6.75 dB under a typical "s"; per-line trims of at most 1.5 dB; a limiter whose gain is a minimum filter over the look-ahead, a slow release, then a Hann smoothing |
| Mix | A duck envelope with raised-cosine ramps (fall 0.3 s, hold 0.15 s, rise 1 s, bridging pauses under 0.7 s, recovering 50 ms before an accent in a pause); a "bed limiter" on the music's 300 Hz-4 kHz level under the voice (margin 6 dB, ratio 4, at most 6 dB, attack 40 ms); voice 2 dB over the music's loudness; the sum brought to the film's loudness through a true-peak limiter at −1.5 dBTP |
| Mux | `ffmpeg -i film -i mix.wav -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 256k`, then an MD5 of each video stream |
| Verify | Cross-correlation lag between the file's sound and the mix; loudness and true peak; two sherpa-onnx recognizers (Parakeet TDT and Whisper base.en) on stretches of up to 29 s, never on short isolated clips, which are misheard; the phone filter is a band-pass from 300 Hz to 7 kHz |
