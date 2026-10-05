# Reel, storyboard

One vertical reel per Campaign-tier property: 1080x1920 (9:16), 30 fps, 18.0 s = 540 frames, sound design only (S36).
Built on `launch/engine` (one GSAP master timeline, seeked per frame). `scene.mjs` and `cues.mjs` use the times below on
the same clock. Moves are MOTION-BIBLE section 2 codes, sound is section 3. Palette, type and copy are fixed; the photograph
order, rhythm and timings are the producer's call (section 8) and the review loop may move them.

Spec slots: `shots[0]` to `shots[3]` are the camera photographs, `shots[4]` to `shots[9]` the six grid tiles. Photograph 1
is `shots[0]`, 2 is `shots[1]`, 3 is `shots[2]`, the last photograph is `shots[3]`. The tile that grows is the sixth, `shots[9]`.

| Beat | Window (s) | Picture | Moves | Sound cue |
|---|---|---|---|---|
| 1 | 0.0 to 3.7 | photograph 1 fills the frame from frame 0, LOCATION label low left | M6 push 8.5 percent, M8 rack focus 8 px to 0 in the first second, M2 label opens from 0.3 | air floor, room tone and the bed (wind, water, room or city by rule) fade in |
| 2 | 3.0 to 3.7 | the frame divides into a top and a bottom panel that slide apart over photograph 2 | M9 split slide 0.7 s | whoosh at 2.9 |
| 3 | 3.7 to 7.7 | photograph 2 with the title set over it in Cormorant, up to three lines | M7 crane (vertical drift, rotation within plus or minus 1.2 degrees), M1 mask reveal of the title at 3.85, M3 weight 400 to 500 at 4.35, mask out at 6.4 | bed continues; one stone step at 3.85 when the bed is room or city |
| 4 | 7.0 to 7.7 | photograph 2 divides over photograph 3 | M9 split slide 0.7 s | whoosh at 6.9 |
| 5 | 7.7 to 11.0 | photograph 3 with the facts row in Jost | M6 push 7.5 percent, M4 Sandstone rule draws at 7.9, M1 masks the row in at 8.2 and out at 10.3 | paper at 8.2, quiet |
| 6 | 11.0 to 11.2 | Obsidian, 6 frames | M13 hard cut to black | whoosh at 10.95 into the first silence beat, 11.2 to 11.7, air floor only |
| 7 | 11.2 to 15.4 | six tiles on Obsidian assemble into a grid, the sixth grows to the full frame at 12.7 and keeps moving, then divides over the last photograph | M10 grid assemble 1.4 s, M6 push on the full tile, M9 split slide at 14.7 | fabric at 11.7 and the bed returns, whoosh at 12.65 on the growth, whoosh at 14.6 on the split |
| 8 | 15.4 to 18.0 | the last photograph moving underneath; price and `matterofplace.com` mask in, the emblem planes close, the wordmark locks, the credit opens | M1 price at 15.5 and site at 15.75, M5 fast 0.8 s at 15.95, M1 wordmark at 16.5, M2 credit at 16.95, M11 light sweep once at 16.2 | impact at 16.75 on the lock, room tone out, the second silence beat from 17.3 to 18.0 |

## What each beat draws
- Copy is the six strings of `spec.copy` and nothing else: LOCATION (uppercase Jost 400, tracking opens to +0.14em), title
  (Cormorant 400, balanced lines, 112 px stepping down to 72 px for three lines at most), facts (Jost 400, uppercase,
  +0.14em), price (Jost 300), `matterofplace.com` (Jost 400, Sandstone), credit (Jost 400, uppercase, Sandstone).
- The wordmark and the emblem are brand artwork, not copy: the wordmark is the outline file `brand/logo/wordmark/wordmark-horizontal-bone.svg`
  (a lambda is drawn into it, so no machine font stands in), the emblem is its two planes as paths, the back plane at 40
  percent and the front plane at 90 percent.
- Type sits at 80 px from the left edge and inside the safe band between 300 px and 1500 px from the top, clear of the
  Instagram interface at the top and the bottom.

## Camera and depth
- Every photograph is three planes (back, subject under a soft mask, front under an edge mask) from `film.js` `depth`,
  with parallax 1.0 / 1.45 / 2.1 and a frame 10 percent larger than the photograph's cover, so a landscape photograph in
  9:16 is scaled to about 1.2 times cover and centred. Horizontal pan is not in the vocabulary and is not used.
- Camera moves on photographs run at constant speed (`ease: "none"`) so the gate does not read eased-out moves as static
  (GOTCHAS P-025). A hold on a flat field never exceeds about 0.8 s and the end card has a moving photograph under it.
- The M9 panels share one camera, so the two halves of a photograph move as one picture until they part.
- The full-frame tile of beat 7 is drawn at the box the rig of beat 8 uses, so the grid hands over to the camera with no jump.

## Easing
`power2.out` arrivals (the timeline default), `power3.inOut` for the M9 panels and the growing tile, `expo.out` for masks,
`none` for camera moves. The one spring is `back.out(1.2)` on the six tiles of M10, inside `gridAssemble`. M11 is
`lightSweep`, a solid Bone layer at 18 percent opacity softened by a 60 px blur, moved diagonally once at `none`. The
legibility layer under type over a photograph is `scrim`, a solid Obsidian layer at one fixed opacity (0.28 to 0.30 under
the first three photographs, 0.42 under the end card). Neither uses a CSS gradient.

## Sound
Noise, filters and envelopes only (`engine/runtime/audio.js`); no oscillator, no Tone.js, no music. The air floor never
drops to digital silence (GOTCHAS P-024) and is 15 dB lower inside the two silence beats, where it is the only sound.
The bed follows `bedFor(type, market)` and the seed comes from the property id, so a re-render is the same.
Every cue is on a cut or a visible event: three whooshes on the three M9 splits, one on the M13 cut and one on the growth,
paper on the facts row, fabric on the grid, the impact on the lock.

## Not used on purpose
The door of M5 (the impact stands for the lock), M12 (no product in a property reel), and any sound under 80 Hz other than
the single impact.
