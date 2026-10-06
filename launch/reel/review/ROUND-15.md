# Round 15 review (fresh-eyes reviewer, Opus, no prior context)

Brief given: launch/reel/review/brief.md, sha256 24f248d7adf6

Gate at review time: GATE PASSED (97.2% motion coverage, longest static 0.50s, 3 cuts, avg shot 4.50s, -18.23 LUFS, -2.59 dBTP, flatness 0.160).

Gate: I ran the motion gate on `.tmp/reel/reel.mp4` again in this turn and all eleven checks show PASS. The three numbers that matter most: motion coverage 97.2%, longest static run 0.50 s (the black beat at 8.25 to 8.75 s), and minimum spectral flatness 0.160, only 0.01 above the 0.15 floor for pitched content.

Verdict: SHIP

| Axis | Score | Why |
|---|---|---|
| Motion | 4 | Every shot moves, and the moves come from the vocabulary: a split slide that opens the next picture between the two halves of the oak shot, line masks on the headline and price, one tile growing out of the grid, and the emblem planes closing. Measured motion falls to about a third of the reel's average in the last 5.6 s and during the grid hold (9.5 to 10 s), so the reel slows right where it ends. |
| Typography | 4 | Type arrives as part of the shot: the place name tracks open, the Cormorant headline masks in line by line and drifts with the push, and the price masks up over a hairline with the facts row beneath. Nothing sits in the top 250 px or the bottom 430 px. The weakness is the lock: the M of MATTER sits 25 px from the vertical edge of the concrete wall for the whole 2.6 s hold, so the wordmark is split between sea and concrete. |
| Depth and camera | 4 | Features I tracked across frames move by different amounts at different depths: the redwood deck travels about 50 px while the island behind it moves about 10 px, and the shrubs, wall and sky separate the same way. That reads as filmed. The closing wall shot is the flattest camera in the reel and also the longest. |
| Rhythm | 4 | Shots run 2.2, 3.2 and 2.9 s, then a 0.5 s black silence beat, then shorter shots (grid about 1.9 s, colonnade 1.5 s) before a 5.6 s hold on the lock, so the pacing does change. Every hard cut has a whoosh. There is no true triplet, which is acceptable at 18 s. |
| Sound | 4 | Judged from `cues.json` and the gate numbers only; I could not listen. No music. There are two silence beats (the black and after the lock), and paper, fabric, door and impact each fall on their event. The wind bed suits a California hillside. Two weak points: the room tone sits only 1.5 dB under the wind and well above the bible's quiet bed, and the whoosh that starts at 1.90 s ends at 2.10 s, while the split's fastest motion is at 2.27 s. |
| Product | n/a | no site footage in the reel |
| Brand tests | 4 | It is quiet, warm and editorial, with no gradient, glow or sales tone, so a $15M owner would be comfortable and an agent would show it to the seller. The reel says almost nothing about place after 8 s, which weakens the case for someone who follows without buying. |
| Copy | 4 | "LOS ALTOS HILLS, CALIFORNIA", "A residence shaped around the landscape.", the price, "5 BED · 4.5 BATH · 4,320 SF" and the lock: calm, brief, correct market, no em dash, no promises. The headline is pleasant but could describe many houses, which is why this is not a 5. |

Three worst shots
1. 12.40 to 18.00 s, the concrete wall and lock: the longest shot has the least camera movement, spends 2 s with no type before the emblem arrives, and the wordmark sits on the wall's vertical edge for the whole lock. Reframe so the full lock sits on the wall face or on the sky, and give the shot a push that matches the 2 to 3 per frame of motion in the earlier shots.
2. 8.75 to 10.67 s, the six-tile grid: a strict 2 by 3 block holds for about a second with almost no internal motion and nothing saying these are rooms of the same residence, so it reads as a catalogue page. Cut the hold to about 0.6 s, or give each tile its own slight push before one tile grows.
3. 2.07 to 2.33 s, the split slide: the whoosh runs from 1.90 to 2.10 s, before the panels move fastest (2.27 s), so the sound leads the picture by 0.2 to 0.3 s. Move the whoosh to about 2.05 s so its sweep peaks while the panels open.

- Minimum flatness of 0.160 against a 0.15 floor is a thin margin; check which cue (door or impact) produces it before the next change to the mix.
- The colonnade gets 1.5 s at full frame after it grows and is then cut away; a little more time there, or moving the cut onto a camera move, would give that cut a reason.
- Verification: `node launch/tools/motion-gate.mjs .tmp/reel/reel.mp4 --w 1080 --h 1920 --min-s 15 --max-s 25 --min-cuts 3 --max-cuts 8 | grep -c '^PASS'` printed 11, all eleven checks. Blockers: the Sound score comes from the cue list and gate numbers only, because I could not listen to the audio.
