# launch/email-doors

The two doors the email houses open on (operator, 2026-10-15: "the logo at the top needs to be similar to the one in
threshold but the style for it matching the vibe and art style of the afternoon one"). One door in two lights: the
emblem becomes a doorway and opens onto light, at night in Threshold, in the afternoon in Afternoon. Both GIFs play
once, hold frame 1 (the logo itself, what Outlook for Windows shows) and rest on the open door; no sound.

| File | What it is |
|---|---|
| `afternoon-door.html` | The day door, drawn in a 2D canvas: the emblem's two planes (its own tones in frame 1, Warm Grey and Sandstone stone once the room fills with sun) as a doorway in a Bone wall, the leaves flush and shut, then a blade of sun at the seam, then the opening fills with daylight and the door's gabled shape falls on the floor, sheared by a low sun, its edge softening with distance (24 directions on the sun's disc). No glow anywhere: light only where the sun lands. `render({ tau, night })`. |
| `doors.mjs` | `day <work>`: 36 frames at 2x, the GIF (`app/public/email/door-day.gif`, 1200 x 600 shown at 600 x 300, 15 fps, frame 1 held 1.4 s, the open door held 3 s) and the night still for Apple Mail's dark mode (`door-day-dark.png`). `night <work>`: the film's own hall (`../brand-film-kit/reference/product-launch/matter-of-place-product-launch.html`, read only, titles and dust hidden), the lockup played backwards with a dolly in, 40 frames, vignetted to Obsidian, the GIF `door-night.gif` (600 x 440). `sheet <out.png> <tau,...> [night]`: frames side by side, for looking. |

Run from the repository root after `bun install` in `launch/` (puppeteer-core) with ffmpeg on the path:

```
node launch/email-doors/doors.mjs day %TEMP%/door-day
node launch/email-doors/doors.mjs night %TEMP%/door-night   # needs the GPU: WebGL, about 20 s
```

Then run `bun run scripts/email-gallery.ts` in `app/` and look at `workspace/08-email-redesign/v2/index.html`. A new GIF
gets a new file name: `/email/*` is cached for seven days, and mail already sent keeps loading the old address.
Measured 2026-10-15: `door-day.gif` 125 KB, `door-night.gif` 555 KB (both under the 1 MB ceiling).
