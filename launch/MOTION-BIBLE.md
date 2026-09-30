# Motion bible — how Matter of Place moves on screen

This is the direction for every film, reel and product video. The v0 launch film (`01-launch-film`) failed because its
brief said "nothing else moves". Restraint belongs to palette, type and copy. Motion is where the future lives.

## 1. What we are aiming at
The grammar of a modern model-launch film (Anthropic's Claude launches are the reference class), translated to a
property publication:
- **Type is the actor.** Words arrive by mask, by line, by tracking, by weight change. A headline is a shot, not a caption.
- **The camera is always alive.** Every photograph sits in depth (foreground, subject, sky) and the camera dollies,
  cranes or racks focus through it. Nothing is a flat still for more than a second.
- **Cuts land on sound.** A whoosh, a footstep, a door, a breath of wind: each cut has a reason you can hear.
- **The product appears.** The real site and the admin, rendered in the same browser, scrolling and hovering, so the
  viewer sees the thing that exists, not a metaphor for it.
- **Rhythm changes.** Long holds (4 to 6 s) next to rapid triplets (0.4 s × 3). A launch film breathes; a slideshow does not.
- **One idea per shot, three ideas per minute.** Density comes from motion and rhythm, never from more words.

## 2. The vocabulary (the only moves allowed; combine freely)
| # | Move | Use | Duration |
|---|---|---|---|
| M1 | Mask reveal | text rises through a hard horizontal mask, one line at a time, 60 ms stagger | 0.5 to 0.8 s |
| M2 | Tracking expand | uppercase Jost label opens from -0.2em to +0.14em while fading in | 1.2 s |
| M3 | Weight shift | Cormorant title crossfades 400 → 500 as it settles | 0.6 s |
| M4 | Line wipe | a 1 px Sandstone rule draws across, text follows it | 0.8 s |
| M5 | Threshold assembly | the emblem's two planes slide in from left and right, the opening appears last | 1.6 s |
| M6 | Depth dolly | photograph split into 3 planes (parallax 1.0 / 1.04 / 1.09), camera pushes in 6 to 9 % | shot length |
| M7 | Crane | vertical camera drift with slight rotation (≤ 1.5°) across a landscape | shot length |
| M8 | Rack focus | blur 8 px → 0 on the subject plane while the foreground softens | 1.0 s |
| M9 | Split slide | frame divides into two panels that slide opposite ways to reveal the next shot | 0.7 s |
| M10 | Grid assemble | 6 to 9 property tiles arrive from slight offsets into a strict grid, then one tile grows to full frame | 1.4 s + hold |
| M11 | Light sweep | a soft Bone highlight crosses a dark frame diagonally once | 1.8 s |
| M12 | Product scroll | the live page scrolls at a cinematic 120 px/s with the cursor hovering a card | 3 to 5 s |
| M13 | Hard cut to black | 6 frames of Obsidian with a sound hit, then the next shot | 0.2 s |
Never: bounce, elastic, spin, particles, lens flare, gradients, glow, counters, zoom-blur transitions, stock wipes.
Easing: `power2.out` for arrivals, `power3.inOut` for camera, `expo.out` for masks. Springs only on M10.

## 3. Sound design (S36: no music, ever)
All sound is synthesized in code with Web Audio / Tone.js noise sources, filters and envelopes, rendered offline and
muxed by ffmpeg. Allowed palette:
- Room tone: brown noise, low-pass 120 Hz, -38 dB, under everything except true silence beats.
- Wind: pink noise, band-pass 300 to 1200 Hz with a 0.05 to 0.2 Hz LFO on gain; terraces, hills, coast.
- Water: two layers of noise with 6 to 10 s swells; coast and waterline shots.
- Stone footstep: 40 ms noise burst, low-pass 400 Hz, fast decay; one or two per interior shot at most.
- Door / threshold: 80 ms wooden thud (filtered noise, not a tone) with a soft hinge tail; used once, on M5.
- Paper / fabric: high-passed crackle, -30 dB; editorial and dossier shots.
- Whoosh: 200 ms noise sweep, band-pass rising 200 → 4000 Hz; on M9 and M13.
- Impact: one low, non-pitched thump (< 80 Hz, 120 ms) on the final wordmark lock.
Rules: no pitched sustained tones, no chords, no melodies, no rhythmic loops, no vocals. Integrated loudness -18 LUFS,
true peak -1 dBTP (`ffmpeg -af loudnorm`). Every sound is justified by what is on screen. Silence is used at least twice.

## 4. Beat sheet for the launch film (70 to 80 s)
| Beat | s | Picture | Move | Sound |
|---|---|---|---|---|
| 1 | 0–4 | Obsidian; a single Sandstone rule draws | M4 | room tone |
| 2 | 4–10 | Terrace at dusk in depth | M6 + M8 | wind |
| 3 | 10–13 | "A property is more than an asset." | M1 | wind continues |
| 4 | 13–14 | black | M13 | whoosh |
| 5 | 14–22 | triplet: Tiburon water · Manhattan · Palm Beach loggia, 2.6 s each | M6, M9 between | water, city air, wind |
| 6 | 22–27 | "Place matters." then the place names tracking open | M1, M2 | silence beat, then wind |
| 7 | 27–35 | the emblem assembles, the wordmark masks in | M5, M1 | door, then room tone |
| 8 | 35–45 | the product: home page scrolls, a dossier opens, the fact row masks in | M12, M1 | paper, footstep |
| 9 | 45–52 | grid of nine properties assembles, one grows to full frame | M10, M6 | fabric, whoosh |
| 10 | 52–60 | "Selected. Edited. Published. Distributed." one word per 1.2 s, weight shift | M1, M3 | four soft stone steps |
| 11 | 60–66 | "California · New York · Florida" over a crane across hills | M2, M7 | wind |
| 12 | 66–72 | "Exceptional property. Properly considered." | M1, M11 | silence beat |
| 13 | 72–78 | wordmark lock, matterofplace.com, "A product of Omnikom" | M5 (fast), M2 | impact, room tone out |

## 5. Product moments
Render the real site (`bun run dev` in the codebase, or the preview URL) in the same headless Chrome at 1920×1080 and
drive it with the capture script: scroll, hover a card, open a dossier. Capture at the film's frame rate; composite
into the film as a plane in depth (M6) so it feels filmed, not screen-recorded. No fake UI.

## 6. The gate (must pass before review)
`node launch/tools/motion-gate.mjs <mp4>` reports and thresholds:
- Motion coverage: percent of frames whose mean luminance difference from the previous frame exceeds a small threshold. **≥ 85 %** (v0 was near 0).
- Longest static run: consecutive frames below the threshold. **≤ 1.0 s**.
- Cuts (scene changes): **between 12 and 30** for 60 to 80 s.
- Average shot length: **2.0 to 5.5 s**.
- Loudness: integrated **-18 ± 1.5 LUFS**, true peak ≤ -1 dBTP; and a pitched-content check (dominant spectral peaks must not hold a stable frequency > 1.5 s).
- Frame stats: 1920×1080, 30 fps, H.264, duration within the brief.

## 7. The review loop (three rounds minimum)
1. Storyboard against this bible; shot count, moves per shot, sound per cut.
2. Render, encode, run the gate, build the contact sheet.
3. Dispatch a fresh reviewer (Opus, no prior context) with `REVIEW-RUBRIC.md`: it scores 1 to 5 on motion, typography,
   depth, rhythm, sound, product moments, brand tests, and names the three worst shots with timecodes.
4. Fix the three worst shots, re-render only the affected windows, re-run the gate, repeat until the reviewer's lowest
   score is 4 and the gate passes.

## 8. Freedom
Composition, rhythm, shot order within a beat, which photograph, which move: the producer's call. Palette, type, copy,
the three tests, and the sound rules: fixed.
