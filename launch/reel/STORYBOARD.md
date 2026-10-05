# Reel, storyboard

One vertical reel per Campaign-tier property: 1080x1920 (9:16), 30 fps, 18.0 s = 540 frames, sound design only (S36).
Built on `launch/engine` (one GSAP master timeline, seeked per frame). `scene.mjs` and `cues.mjs` use the times below on
the same clock. Moves are MOTION-BIBLE section 2 codes, sound is section 3. Palette, type and copy are fixed; the photograph
order, rhythm and timings are the producer's call (section 8) and the review loop may move them (it did: twelve rounds, `review/ROUND-1.md` to `ROUND-12.md`, the last of which says SHIP).

Spec slots: `shots[0]` to `shots[3]` are the camera photographs, `shots[4]` to `shots[9]` the six grid tiles. Photograph 1
is `shots[0]`, 2 is `shots[1]`, 3 is `shots[2]`, the last photograph is `shots[3]`. The tile that grows is the sixth, `shots[9]`.

| Beat | Window (s) | Picture | Moves | Sound cue |
|---|---|---|---|---|
| 1 | 0.0 to 2.6 | photograph 1 fills the frame from frame 0, LOCATION label low left from 0.3 to 2.1 | M6 push 11 percent, M8 rack focus 8 px to 0 in the first second, M2 label opens from 0.3 | air floor, room tone and the bed (wind, water, room or city by rule) fade in |
| 2 | 2.0 to 2.6 | the frame divides into a top and a bottom panel that slide apart over photograph 2 | M9 split slide 0.55 s | whoosh at 1.9 |
| 3 | 2.0 to 5.4 | photograph 2 with the title set over it in Cormorant, up to three lines | M7 crane (vertical drift of plus or minus 30 px, rotation within plus or minus 0.8 degrees), M1 mask reveal of the title at 2.65 once the split has closed, M3 weight 400 to 500 at 3.15 (the heavier face fades in over the lighter one, so the line never dims), the block sinks 40 px against the crane, M1 mask out at 4.65 before the cut | bed continues; one stone step at 2.65 when the bed is room or city |
| 4 | 5.4 | photograph 2 cuts to photograph 3 | hard cut (an edit, not a move of the bible) | whoosh at 5.2, rising into the cut |
| 5 | 5.4 to 8.2 | photograph 3 with the price above a Sandstone rule and the facts row below it | M6 push 11 percent with a lateral travel of 180 px, M8 the foreground deck pulls into focus in the first 1.1 s, M1 masks the price in at 5.65, M4 rule draws at 5.95, M1 masks the facts in at 6.2, both out at 7.45 and 7.5 | paper at 5.7, quiet |
| 6 | 8.2 to 8.4 | Obsidian, 6 frames, then the empty field until the first tile | M13 hard cut to black | whoosh at 8.1 into the first silence beat, 8.3 to 8.8, air floor only |
| 7 | 8.4 to 12.4 | six tiles on Obsidian assemble into a grid from 8.7, the sixth tile grows to the full frame from 10.3 to 11.3 while the other five dim, and keeps moving to the cut at 12.4; every picture eases from 122 percent to its tile over the grid's life | M10 grid assemble 1.4 s with the tiles landing 0.1 s apart, 3.5 percent push and a 36 px rise on the whole grid from 8.7 to 11.3, M6 push on the full tile, hard cut to the last photograph at 12.4 | fabric at 8.75 and the bed returns, softer fabric at 10.45 as the growth shows, whoosh at 12.3 into the cut |
| 8 | 12.4 to 18.0 | the last photograph, cut to, moving underneath, alone for under two seconds under one light sweep; the emblem planes close, the wordmark locks, `matterofplace.com` and the credit open | M11 at 13.0, M8 the picture softens by 1.5 px from 13.4, M5 fast 0.8 s at 14.2, M1 wordmark at 14.75 and site at 15.0, M2 credit at 15.5, the lock rises 20 px to the last frame | door as the planes close at 14.85, impact at 15.4 on the lock, room tone out, the second silence beat from 16.1 to 18.0 |

## What each beat draws
- Copy is the six strings of `spec.copy` and nothing else: LOCATION (uppercase Jost 400, 44 px, tracking opens to +0.14em), title
  (Cormorant 400, balanced lines, 112 px stepping down to 72 px for three lines at most), facts (Jost 400, uppercase, 48 px,
  +0.14em), price (Jost 400, 76 px, left margin), `matterofplace.com` (Jost 400, 34 px, Bone), credit (Jost 400, uppercase,
  28 px, Bone).
- The wordmark and the emblem are brand artwork, not copy: the wordmark is the outline file `brand/logo/wordmark/wordmark-horizontal-bone.svg`
  (a lambda is drawn into it, so no machine font stands in), the emblem is its two planes as paths, the back plane at 40
  percent and the front plane at 90 percent.
- Type sits at 80 px from the left edge (the lock is centred) and between 985 px and 1490 px from the top, away from the top and bottom edges where
  an app draws its own interface (ASSUMED band, UNPROVEN against Meta's current overlay sizes). The grid sits between 261 px and 1474 px once its 3.5 percent push has run.
- The price rides with the facts row on the third photograph, so it is never the last statement before the lock and never stands on the brand. A line that is wider than 920 px shrinks to fit.

## Camera and depth
- Every photograph is three planes (back, subject under a soft mask, front under an edge mask) from `film.js` `depth`,
  with parallax factors of 1.0, 1.25 and 1.5 on photograph 3, 1.0, 1.15 and 1.3 on photograph 2 and 1.0, 1.1 and 1.2 on photographs 1 and 4 and on the colonnade (a factor of 1.5 on photograph 2 doubled the sofa's edge, so it keeps the smaller one) and a frame 10 percent larger than the photograph's cover, so a landscape photograph in
  9:16 is scaled to about 1.2 times cover and centred. Wider factors showed the planes' edges as ghosts in review round 1. Horizontal pan is not in the vocabulary; the end card's sideways travel is a camera move on its rig, not a pan between shots.
- Photograph 2 is anchored at its lower edge and drawn 15 percent larger so its flat ceiling stays out of the frame.
- Camera moves on photographs run at constant speed (`ease: "none"`) so the gate does not read eased-out moves as static
  (GOTCHAS P-025). A hold on a flat field never exceeds about 0.8 s and the end card has a photograph under it that moves fast enough to clear the gate's threshold on its own (GOTCHAS P-2107).
- The M9 panels share one camera, so the two halves of a photograph move as one picture until they part. The one split opens on a horizontal slit.
- The full-frame tile of beat 7 is drawn at the box the rig of beat 8 uses, so the grid hands over to the camera with no jump.

## Easing
`power2.out` arrivals (the timeline default), `power3.inOut` for the M9 panels and the growing tile, `expo.out` for masks,
`none` for camera moves. The one spring is `back.out(1.2)` on the six tiles of M10, inside `gridAssemble`. M11 is
`lightSweep`, a solid Bone layer 560 px wide at 10 percent opacity softened by a 60 px blur, moved diagonally once at `none`. The
legibility layer under type over a photograph is `scrim`, a solid Obsidian layer at one fixed opacity. Over photographs 2 and 3
and the end card it has two parts: a light layer over the whole frame (0.16, 0.1 and 0.1) and a local pool behind the type (0.6, 0.5 and 0.5)
whose edge a 90 to 100 px blur softens, so the photograph keeps its own light everywhere else; photograph 1 has the whole-frame layer
at 0.2 and no type to protect after 1.8 s. Photograph 2's pool is drawn in both panels so no seam shows. The pools fade in with
the type (2.1, 5.5 and 13.6) and, under photograph 3, out at 7.3. The second photograph's headline is the only type over a
light surface, which is why its pool is the deepest. Neither uses a CSS gradient.

## Sound
Noise, filters and envelopes only (`engine/runtime/audio.js`); no oscillator, no Tone.js, no music. The air floor never
drops to digital silence (GOTCHAS P-024) and is 18 dB lower inside the two silence beats, where it is the only sound.
The bed follows `bedFor(type, market)` and the seed comes from the property id, so a re-render is the same.
Every cue is on a cut or a visible event: whooshes on the M9 split, the two hard cuts and the M13 cut to black (the whoosh before a cut
rises into it), paper where the price and the facts row arrive, fabric on the grid, the door as the emblem planes close, the impact on
the wordmark lock.

## Not used on purpose
M12 (no product in a property reel), and any sound under 80 Hz other than the single impact.
