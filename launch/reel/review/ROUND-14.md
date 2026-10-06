# Round 14 review (fresh-eyes reviewer, Opus, no prior context)

Brief given: launch/reel/review/brief.md, sha256 24f248d7adf6

Gate at review time: GATE PASSED (97.2% motion coverage, longest static 0.50s, 3 cuts, avg shot 4.50s, -18.23 LUFS, -2.29 dBTP, flatness 0.160).

Gate: all 11 checks pass. I re-ran `node launch/tools/motion-gate.mjs .tmp/reel/reel.mp4 --w 1080 --h 1920 --min-s 15 --max-s 25 --min-cuts 3 --max-cuts 8 | grep -c '^PASS'` this turn and it printed `11`. The three numbers that matter most: the longest static run is 0.50 s, motion coverage is 97.2%, and minimum spectral flatness is 0.160, only just over the 0.15 floor.

Verdict: SHIP

| Axis | Score | Why |
|---|---|---|
| Motion | 4 | Every shot moves, and each move comes from the vocabulary: rack focus into the oak, a split slide, line-by-line mask reveals, a rule that draws, the grid assembling and growing, a cut to black, and the emblem planes sliding in from both sides. After landing, the headline and price hold in place while only the photograph moves. |
| Typography | 4 | Real arrivals: the place label tracks open, the Cormorant headline masks in one line at a time, the price rises through a mask above a drawn hairline, and the wordmark assembles. All of it stays clear of the top and bottom interface bands. Once landed, the type sits on the picture like a caption, and all three photo shots put their text block at the same lower-left x. |
| Depth and camera | 4 | The oak opens on a real blur-to-sharp focus pull. The redwood deck and the colonnade push in, the deck with slight parallax against the trunk, and the closing wall drifts and cranes. The grid is flat by design, and the other pushes are single moves without visible plane separation. |
| Rhythm | 4 | Shot lengths are 2.1, 3.3, 2.8, a 0.6 s black, 2.0, 1.6 and 5.6 s. Silence is used twice as a beat and most cuts land on a sound. There is no fast triplet, and the first eight seconds follow a photograph, line, photograph, line pattern. |
| Sound | 4 | Judged from the cue list and the loudness numbers only; I did not listen. Each section has its own bed, the bed drops out for the black, and there is one door on the emblem, one impact on the lock, and silence at both beats. Two cues miss their picture events (see shot 2 and the note below), and the paper cue sits at bed level, so it is probably masked. |
| Product | n/a | no site footage in the reel |
| Brand tests | 4 | A $15M owner would be comfortable with it: on-palette, unhurried, no decoration, and the scrim only does legibility work. An agent would show it to a seller. The closing lock sits on dim grey concrete and reads a little sombre. |
| Copy | 4 | "Los Altos Hills, California", one headline, the price, a facts row and the sign-off. The copy is calm and brief, has no em dash or hyperbole, makes no promises, and names only California. "A residence shaped around the landscape." is the only line that could belong to any listing. |

Three worst shots
1. **12.40–14.50 s.** The concrete wall plays alone for 2.1 s right after the colonnade's own 1.4 s hold with no type, so the reel goes 3.5 s without a new idea, and the end card then holds 2.6 s past the lock. Bring the emblem in by about 13.0 s, or start the wall later, and trim the hold after the lock to about 1.5 s.
2. **1.90–2.37 s.** The split whoosh runs from 1.90 to 2.10 s and is over before the panels start moving at 2.13 s, so it is heard about seven frames early. Start it near 2.08 s so its rising sweep peaks in the middle of the split, around 2.25 s.
3. **2.37–8.20 s.** The headline and then the price mask in and freeze at the same lower-left position while the photograph pushes underneath, which is caption behaviour. Give the headline a slow counter-drift or a 400 to 500 weight shift as it settles, and let the price block track with the deck plane or sit in a different spot from the headline.

- The "tile grows" fabric cue at 10.45 s starts 0.3 s before the grow begins (10.77 s); move it to about 10.70 s.
- The paper cue (-22) sits at the same level as the wind (-22.5) and room tone (-24). Either raise it about 6 dB above the bed or duck the bed under it, or the price will arrive without its sound.
- A one-frame bright hairline is visible at the split's opening edge at 2.07 s (frame 00062). It is not distracting, but a matte that opens exactly on frame 64 would remove it.
