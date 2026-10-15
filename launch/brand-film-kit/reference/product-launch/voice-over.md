# Product Launch: the voice-over, as delivered

A worked example for the two voice-over skills, and the record needed to make the same mix again.

## The script

58 words, about 19 seconds of speech in a 30-second film. "In" is when the line starts.

| In | On screen | Voice-over |
|---|---|---|
| 0:00.6 | The door opens: "Not every home is accepted." | Every home has a price. |
| 0:02.5 | Through the doorway | It's rarely the interesting part. |
| 0:05.3 | Rising over the submissions | A modest house can make the cut. |
| 0:07.7 | The declined homes sink | A grand one might not. |
| 0:09.6 | The frame squares up on the chosen house | We're not brokers. We're editors. |
| 0:12.5 | The photograph becomes a page | A listing waits to be found. |
| 0:15.3 | Cards go out at nightfall | A feature travels. |
| 0:18.0 | California, New York, Florida | Even our map is edited. |
| 0:22.5 | Four packages and their prices | Acceptance is not for sale. |
| 0:25.0 | "Price never equals merit." | It was never a matter of price. |
| 0:28.0 | Logo | It's a matter of place. |

Reading notes. Tone: dry and level, with the wit left in the words; underplay every line. Sync: "editors" lands as the frame squares up at 0:11.5, "never" at about 0:25.4 as the word drops into the title. Silence: Florida plays with no voice, and there is a beat before each second sentence. Last line: it is the name, so read it plainly as the wordmark settles.

The script it replaced walked through the shots and named them ("Not every home is accepted." "Agents and owners bring homes to us." "What we accept, we frame." "We publish it as a feature." "Three markets. California. New York. Florida." "Price never equals merit." "Matter of Place."). The client's verdict: "the script is too bland and it just says what's on the screen."

## The voice file

A generated voice, supplied as one WAV of 30.000 s, already laid out on the film's timeline: every line starts on its cue. Nothing was moved.

What the check measured:

| Measure | Supplied | After cleaning |
|---|---|---|
| Loudness | -15.9 LUFS, true peak -1.1 dBTP | same loudness, true peak -1.2 dBTP |
| Background between lines | digital silence | unchanged, so no noise reduction |
| Pitch | about 88 Hz | unchanged |
| Share of power below 140 Hz | 85% | 71% |
| Fundamental over the 400-500 Hz band | +18.4 dB | +12.3 dB |
| "s" sounds over the vowels | +8.4 dB, hottest +14.1, around 4.5 kHz | +3.6 dB, hottest +7.4 |
| Band limit | 11.8 kHz, with a mirror image above it (a 24 kHz source, upsampled) | nothing above 12.2 kHz |
| Loudness spread between lines | 2.6 LU | 0.2 LU |
| Splice clicks | 7 | 0 |

The seven clicks, in seconds: 0.905, 2.736 (in "rarely"), 5.594, 9.640 (the head of "We're", which started mid-wave out of silence), 11.377, 12.774 (in "listing", where the vowel meets the "s"), 18.300. As sample indices in that file at 48 kHz: 43455, 131327, 268518, 462719, 546107, 613153, 878383.

The click at 12.774 s was missed by the first version of the click search and by the first delivery. It was found when the method was tested, and the search was changed. It is the reason the voice skill says to look at the highest peaks after cleaning.

## Settings, exactly as delivered

The kit's five voice steps, run on the original voice file with the changes below, make the delivered files again byte for byte: the cleaned voice, the mix, and the film with voice (checked on 15 October 2026).

In `2_clean.py`, just above the line that prints the settings:

```python
STEPS = [43455, 131327, 268518, 462719, 546107, 613153, 878383]
p = dict(vo.P, lp_hz=12200, hp_hz=50, shelf=[(145, -3.5, 1.15)] * 2, ds_band=(3200, 6200), ds_thresh=-25.0, lim_ceiling_db=-6.5)
regions = [(0.63, 2.44), (2.44, 4.26), (5.32, 7.12), (7.73, 9.24), (9.63, 10.75), (11.26, 12.21), (12.53, 14.18), (15.32, 16.62), (18.03, 19.53), (22.52, 24.19), (25.03, 26.99), (28.00, 29.49)]   # one per sentence, set by hand, so each sentence is levelled on its own
```

In `3_mix.py`, in place of the line that calls `vo.auto_knobs`:

```python
m = dict(vo.M, hits=hits, duck_extra={7: -10.5, 10: -12.0}, falls={10: (27.93, 28.10)})
# duck_extra: "Even our map is edited." sits on the market cuts, and the last line carries the name
# falls: the final chord lands at 27.9 and the last line starts at 28.0, so the chord lands first and the duck follows fast
# the mix's target stays at the kit's default, -16.0 LUFS
```

Then run, from the folder that holds them, with the music-only film and its score:

```bash
python3 1_check.py voice.wav script.txt film.mp4
python3 2_clean.py
python3 3_mix.py film.mp4 --music score.wav --hits "3.75,6.75,9.75,12.0,15.0,17.25,18.75,20.25,21.75,24.75,27.75"
bash 4_mux.sh film.mp4 out/matter-of-place-product-launch-vo.mp4
python3 5_verify.py out/matter-of-place-product-launch-vo.mp4 script.txt
```

The mix numbers its lines by speech region, and this voice has 11 regions because the first two sentences run together; that is why `duck_extra` says 7 and 10. The last accent, 27.75, is where the final chord starts to swell; its hit is at 27.9.

The kit's own suggestions for this voice, without these changes, are nearly the same (shelves of -3.53 dB, de-ess band 3200 to 6300 Hz at -25.7), its click search finds the same seven clicks, and its automatic mix lands within a tenth of a decibel of the delivered loudness.

Music under the voice: the film's own score (`out/score.wav`, from `audio.js`), 9 dB down under each line, back up over a second, and back in time for the accent on each cut.

## Result

`matter-of-place-product-launch-vo.mp4`: -16.0 LUFS, the same as the film without voice; true peak -3.5 dBTP; picture stream copied, checksum identical to the original; sound in step with the mix (lag 0). Two speech recognizers hear every word of the script in the cleaned voice alone, in the finished film, and in the finished film through a phone-speaker filter.

Checked by measurement and by looking at plots, not by ear.

One thing to do better next time: the last line starts a tenth of a second after the final chord. A closing hit deserves 0.3 s to itself.
