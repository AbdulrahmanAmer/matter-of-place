# Round 12 review (fresh-eyes reviewer, Opus, no prior context)

Gate at review time: GATE PASSED (97.2% motion coverage, longest static 0.50s, 3 cuts, avg shot 4.50s, -18.23 LUFS, -2.29 dBTP, flatness 0.160).

Gate: I re-ran the motion gate and all eleven checks are green. The three numbers that tell the most: motion coverage 97.2 %, longest static run 0.50 s, and minimum spectral flatness 0.160, which is only just over the 0.15 floor.

Verdict: SHIP

| Axis | Score | Why |
|---|---|---|
| Motion | 4 | Every shot moves: a push on each photograph, a split slide at 2.1 s, line-by-line mask reveals, the grid assembling and one tile growing. Easing looks consistent. It slows at the end: frame-to-frame change falls from 8 to 13 on the photographs to about 1.5 to 2 under the end card from 14.5 to 18 s, so the close nearly reads as a still. |
| Typography | 4 | Type arrives through masks: the Cormorant headline comes up line by line (frame 85), the place label is tracked Jost, a hairline draws under the price, and the wordmark masks in. The hierarchy is clean and nothing sits in the top 250 px or bottom 430 px (the facts row ends near y 1445). The headline and price stay pinned to the screen while the picture pushes behind them. |
| Depth and camera | 4 | All three opening photographs push in. On the interior the sofa in front stays soft, which reads as a rack focus. On the hill, the bench in front moves more than the hills behind it. The grid is flat by nature. The colonnade, blown up from a grid tile to full frame, looks soft. I could not confirm separate parallax planes beyond the hill shot. |
| Rhythm | 4 | Shots run 2.1, 3.3 and 2.8 s, then a 0.6 s black beat, a 1.6 s grid, a 2.0 s grow and a 5.6 s close, so the pace varies and the black breaks any slideshow feel. There is no triplet, and the first three shots are close enough in length to drift toward an even beat. |
| Sound | 4 | Judged from the cue list and the gate numbers only; I could not listen. Every cut has a cue, and the paper, fabric, door and impact cues land on visible events. Silence is used twice (8.3 to 8.8 s and 16.1 to 18 s), and loudness and peak are right. Four nearly identical whooshes (-12 to -14, 0.2 to 0.25 s) in 18 s, one of them on a plain hard cut at 5.4 s, start to sound like a template. |
| Product | n/a | no site footage in the reel |
| Brand tests | 4 | The palette is quiet, the type is calm and there is no gradient or glow, so a $15M owner would be comfortable. The close sends a follower to the publication rather than to the listing, and an agent would show it to a seller. The softness of the upscaled interior and colonnade frames is the main thing that would make a picky agent hesitate. |
| Copy | 4 | Brief and calm: place, one line, price, facts, then the wordmark, URL and "A product of Omnikom". No em dash, no hyperbole, the market is correct and nothing promises an outcome. "A residence shaped around the landscape." is pleasant but could describe many houses. |

Three worst shots
1. 9.4 to 10.4 s, grid hold: after the tiles land, the six flat rectangles barely move (frame-to-frame change about 2.8) between large black voids, which reads as a slide. Cut the hold to about 0.4 s, or give the whole grid one slow shared push, before the tile grows.
2. 14.5 to 18.0 s, end card: the wordmark locks at about 15.3 s and then holds 2.7 s over the slowest camera in the reel, with nearly 2 s of near-silence, so about a fifth of the reel is closing. Keep the camera moving under the wordmark, or end about 1.5 s after the lock.
3. 2.5 to 5.3 s, interior headline: the headline stays at the same pixel while the room pushes behind it, and "shaped around" sits over the white sofa, where contrast is lowest. Give the headline a slight drift tied to the room behind it, or set it lower over the darker floor.

- At 2.07 s (frame 62) the split opens as a 1 to 2 px bright line across the full width for a frame or two before the panels part. Check that it does not flash as a stray line at playback speed. With minimum flatness at 0.160 against a 0.15 floor, the impact or door cue is close to failing the pitched-content check, so do not make either more tonal.
- Verification: I ran the gate command from the first line of `gate.txt` again and counted 11 PASS lines and 0 FAIL lines.
- Blockers: I could not listen to the sound track, so the Sound score rests only on `cues.json` and the gate's loudness and flatness numbers.
