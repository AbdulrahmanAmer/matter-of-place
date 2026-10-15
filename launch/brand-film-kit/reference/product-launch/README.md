# Product Launch: the reference film

The film this kit was first used for: Matter of Place, "Product Launch". 30 seconds, 1920 × 1080, 60 frames a second, ten shots on an 80 BPM grid, original score, and a voice-over added afterwards.

It is kept here for two reasons.

1. **As worked examples.** The kit's own `src/film.js` is a two-shot placeholder. This is a whole film, with every technique the brand-film skill describes.
2. **So the film itself can be revised.** It rebuilds from these files with the kit's own tools.

It is one film for one brand. Take a technique from it (how a polished floor is drawn), not a scene (a gallery of houses).

What was delivered: `matter-of-place-product-launch.mp4` (music only), `matter-of-place-product-launch-vo.mp4` (with the voice-over) and `matter-of-place-vo-cleaned.wav`. The film's own page, which plays it live, is https://claude.ai/artifact/1hr6tMUvRbRx5vnXoZU5ep and still plays the music-only version.

## The files

Seventeen, all under `reference/product-launch/`:

    README.md   voice-over.md   logo.json   fonts/fonts.json   src/page.html   src/score.js
    src/film/00_lib.js   src/film/01_world.js   src/film/0_core.js   src/film/1_hall.js   src/film/2_gallery.js   src/film/3_markets.js
    src/film/4_packages.js   src/film/5_wall.js   src/film/6_direct.js   src/film/7_titles.js   src/film/8_main.js

## Rebuild it

Take a second copy of the film kit, then lay these files over it. The shell may not keep its working directory between calls, so every line starts with `cd`:

```bash
cp -r "<saved folder>/film" ~/launch
cd ~/launch && rm -rf src && cp -r "<saved folder>/reference/product-launch/src" "<saved folder>/reference/product-launch/fonts" "<saved folder>/reference/product-launch/logo.json" .
cd ~/launch && npm init -y >/dev/null && npm i three@0.128.0
cd ~/launch && node build.js && node stills.js "0.4,2,5,7,9.5,11.9,13.5,16,18,19.5,21,23,25.5,28,29.5" 5 640 ref     # out/ref.jpg
```

Do not run `fonts.py` or `logo.js` here: `fonts/fonts.json` and `logo.json` are already the film's own. Then the kit's usual steps: `audio.js`, `export.js`, `encode.sh`, `pagetest.js`.

Checked on 4 and 15 October 2026. Frames sampled from every shot after the door, rendered this way, are byte-identical to the delivered film's. The door shot keeps a cache of its text from frame to frame, so its frames come out exactly the same only when they are rendered in order from the start, as below: done that way, 69 of its first 76 frames were byte-identical and the other 7 differed by one shade in a few pixels (PSNR above 95 dB), which no one can see. The score matches the delivered one to the last bit of rounding.

## Render it exactly as delivered

Two workers, each taking every other frame in order from the start, then the same two-pass encode the delivered MP4 had:

```bash
cd ~/launch && cp dist/dev.html dist/render.html
cd ~/launch && FILM_PAGE=dist/render.html nohup node export.js 60 0 1800 0 2 > x0.log 2>&1 &
cd ~/launch && FILM_PAGE=dist/render.html nohup node export.js 60 0 1800 1 2 > x1.log 2>&1 &
# when both workers have finished (tail -n 1 x0.log x1.log says so), about an hour later:
cd ~/launch && node audio.js && bash encode.sh matter-of-place-product-launch 60 6000
```

Then the voice-over, with the steps and settings in `voice-over.md`, which reproduce the delivered voice-over files byte for byte.

Numbers from the delivered render, for planning: 1,800 frames, 8 sub-frames a frame on average, about 0.45 s per sub-frame, 53 minutes with two workers on two cores. Two-pass at 6,000 kbit/s gave 23.3 MB. Loudness -16.1 LUFS.

## Revise it

1. **Make the change and look.** Rebuild, then pull stills of the shot before and after. Prices and package names are in `src/film/4_packages.js`, the market names in `3_markets.js`, the opening line in `1_hall.js`, the feature page's text in `2_gallery.js`, and the other titles in `7_titles.js`; search the source for the words. Shot times are in `0_core.js`. The score's cue sheet (`src/score.js`) has its times typed as numbers, not as those constants: after a retime, move its events by hand.
2. **Render.** The rendered frames are not kept between sessions (they are 2 GB), so a revision in a new session renders all 1,800 frames: about an hour with two workers. Only a session that still has the film's `frames/` folder can do less: delete the frames of every shot the change touches and run the exporter again; it skips what is on disk. To confirm the range was wide enough, export the frame on either side of it into a spare folder and compare each with the one on disk: they must be identical. (In a test, changing one package's price touched frames 1338 to 1484 and nothing else.)
3. **Encode**, the film and a master, with `encode.sh`, and read its checks.
4. **The version with voice.** Its picture was copied from the old film, so it must be made again. If neither timing nor music changed, the sound is still right: ask for the delivered film with voice and copy its sound onto the new picture.
   `ffmpeg -i new.mp4 -i old-vo.mp4 -map 0:v:0 -map 1:a:0 -c copy new-vo.mp4`
   If timing or music changed, the mix is redone from the voice file with the settings in `voice-over.md`.
5. **The page.** It draws the film live from this same code, so until it is rebuilt and published again it shows the old version. Read the page at the address above with the Artifact tool, then publish the new `dist/page.html` to that same address.
6. Say what changed, what was re-rendered, and what the person should replace wherever the film is already posted.

## Type

Newsreader (display size, weights 200 to 500, roman and italic) under the name "MoP Serif", and Jost (weights 300 to 600) under the name "MoP Sans". Both are subset to printable ASCII plus the non-breaking space and · × – — ‘ ’ “ ” • … →. A new line that needs any other character (é, £) would fall back to another typeface without warning. Remake the fonts first: in the kit's `fonts.py` change the family names to "MoP Serif" and "MoP Sans", add the character to `UNI`, install the two families with npm and run it.

The small captions in this film are set at 11 to 19 px. They are texture, legible only at full size. One of them breaks the rule that a label which must be read is 26 px or more: the package prices are 17 px. A revision is a chance to enlarge them.

## Where each technique lives

Files are joined in name order by `build.js`. The names of the exporter's per-sub-frame values (`JIT.u`, `JIT.v`, `JIT.w`, `JIT.i`) are the kit's own, so code can be carried across. Three things differ from the kit's placeholder: `setCam(p, q, fov, shiftX, shiftY, up, aperture, focus)` takes the aperture seventh, not fourth; `aimSun(sun, direction, cx, cz, half)` only aims, and `matchFloor` sets the floor's colour; and `logo.json` was made by hand (`LOGO.hz.letters`, `LOGO.emblem`), not by `logo.js`.

| File | What is in it |
|---|---|
| `src/film/00_lib.js` | Easing curves, colour helpers, a cache of text widths, `rise` (a line that rises into a mask), `tracked` capitals, hairlines |
| `src/film/01_world.js` | Themes (the materials one world shares). `makeModel`: architectural models built from walls, glazing, lit windows and line drawings. Trees and palms. The model definitions. `glowTexture` for glows and light pools |
| `src/film/0_core.js` | The timeline constants. The camera: thin lens, lens shift, `orbit`, `proj`. Sun aiming and the seamless floor (`matchFloor`). **Polished floors**: `CLIP`, `makeVeil` and `drawWorld`, the two-pass mirror draw with a rougher mirror for every sub-frame |
| `src/film/1_hall.js` | The door shot. **Light you can see**: additive haze slices, ray sheets, a pool of light with a penumbra. In export each sub-frame draws a quarter of the layers with a different phase (`OPT.lean`), and the averaging fills them in |
| `src/film/2_gallery.js` | Objects on plinths. **Sinking through a floor** with clipping, leaving a plan drawing behind. Contact shadows. **A 3D view becoming a flat page**: `snapPrint` renders the view into a texture, `drawPageTex` typesets the page around it. Day to dusk (`duskAt`). Cards sent out along lanes. A crane up to a plan view and an orbit that ends square-on |
| `src/film/3_markets.js` | Three small worlds from one builder: same construction, different theme and light, hard cuts between them |
| `src/film/4_packages.js` | Sheets rising on a dark polished stage. **The worked example of a glossy world**: it sets up what `drawWorld` reads (`refl`, `solo`, `gloss`, `rough`, `veil`, a transparent floor material) |
| `src/film/5_wall.js` | A wall with afternoon light through a window: a still shot for one sentence |
| `src/film/6_direct.js` | `update(t)`: which world, which light, which camera, all from `t` |
| `src/film/7_titles.js` | The title layer. A running header, a stack of verbs that roll over, labels pinned to 3D objects with `proj`, crop marks, prices under their sheets, a sentence whose key word drops in last, the logo assembling from its letters. Ink and paper swap at one chosen moment as night falls (`inkAt`) |
| `src/film/8_main.js` | Vignette and grain, `init` (it turns on `renderer.localClippingEnabled`, which the floors need), and the `Film` object the kit's tools use |
| `src/score.js` | The full cue sheet: a chord per shot, an accent on every cut, risers into the big transitions, the pulse stopping for the closing statement |
| `src/page.html` | The published page, styled for the brand |

## Shot list

| At | Shot | What happens | Camera |
|---|---|---|---|
| 0:00 | The door | The emblem stands as a doorway; it opens and light pours through. "Not every home is accepted." | push in and through |
| 0:03.75 | Submissions | A gallery of architectural models on plinths | low glide |
| 0:06.75 | Curate | One is kept; the rest sink and leave their outlines | crane up to a plan view |
| 0:09.75 | Frame | A frame squares up around the chosen house | orbit that ends in the photograph |
| 0:12.00 | Publish | The photograph becomes a page | hold, then drift |
| 0:15.00 | Distribute | Night falls; cards go out along four lanes | pull back and rise |
| 0:17.25 | Markets | California, New York, Florida: three lights, hard cuts two beats apart | truck, crane, arc |
| 0:21.75 | Packages | Four sheets rise on a dark polished stage, with their prices | pull-back reveal |
| 0:24.75 | Principle | "Price never equals merit." The word "never" drops in last | still |
| 0:27.00 | Lockup | Back through the door, which closes into the logo | pull back, hold |

The prices and package names on screen are facts that date.

The voice-over, its timing and the settings of its mix are in `voice-over.md`.
