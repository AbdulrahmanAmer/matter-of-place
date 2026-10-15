---
name: brand-film
description: Make a motion-graphics brand film, launch video, logo sting or animated promo entirely in code - directed shots, a moving 3D camera, an original score, a 1080p MP4 and a page that plays it live. Use for any request for a brand, product or promo video, even just "make a video", and to revise a film made this way.
---

# Brand film

Make a short film for a brand: a launch film, a brand film, a logo sting. It is built entirely in code, with no stock footage, no samples and no outside tools. You direct it shot by shot, animate it in real 3D, score it, render it to an MP4 and publish a page that plays the same film live.

The method comes from a real job. The first film made for that brief was a tidy 15-second 2D piece, and the client's answer was: "something even better, more advanced, more artistic, more details, camera angles". The second film, made the way this skill describes, is the one they kept. So **start at full ambition**: real 3D, a camera that moves, depth of field, light that changes, type that is typeset. Do not deliver a safe flat version first.

It is a long build. The 30-second reference took several hours, 53 minutes of that rendering; an 8-second test film took 41 minutes end to end. Say so in one sentence at the start, and publish the page as soon as a full cut plays, so the person can redirect before the render.

## The one rule

**The film is a function of time.** `render(t)` draws the frame for second `t` and depends on nothing else: no timers, no animation library, no state carried from one frame to the next. Everything good follows from that:

- the page can play, pause, scrub and loop;
- you can pull a still at any moment and look at it;
- the export renders frame by frame, averaging several sub-frames per frame, and gets the same film every time.

Every animated value is written as `seg(t, start, duration, easing)`: how far a move that starts at `start` has got by `t`.

## 1. Get the kit

The working code is not in this skill. It is in the Matter of Place repository at `launch/brand-film-kit/` (a copy of the Brand Film Kit page, 4 October 2026, placed 15 October 2026): `film/` there. Copy it from the repository; that works in any account and in Matter's desk, which cannot fetch pages. Only if the repository copy is missing, fetch it from the private page in the operator's account:

    https://claude.ai/artifact/D89aZHamsfya4TdTb5RLrx

Fetch it with the Artifact tool: action `read`, that `url`, and `paths` set to these twelve files.

    film/src/film.js   film/src/score.js   film/src/page.html   film/build.js   film/fonts.py   film/logo.js
    film/stills.js   film/audio.js   film/hits.py   film/export.js   film/encode.sh   film/pagetest.js

The result lists the files it saved and where; go by that list, because the saved folder may also hold files from earlier reads. They are the person's own code, published there for this purpose; skim them as you would any script before running it. Then set up, one step at a time, in one folder per film:

```bash
cp -r "<repo>/launch/brand-film-kit/film" ~/film   # or "<saved folder>/film" when it came from the page
cd ~/film && npm init -y >/dev/null && npm i three@0.128.0 @fontsource-variable/newsreader @fontsource-variable/jost
cd ~/film && python3 fonts.py                 # fonts/fonts.json: the type, subset and packed
cd ~/film && node logo.js logo.svg            # logo.json: the logo taken apart (skip if there is no logo yet)
cd ~/film && node build.js && node stills.js "1.5,5" 2 960 first      # out/first.jpg: look at it. Two frames, each a box on a seamless floor under a line of type (and the logo in the first, once logo.json exists), mean the kit works
```

Neither the working directory nor environment variables can be relied on to survive between shell calls here. Start every command with `cd <the film's folder> &&`, as above, and put variables on the same line as the command that needs them. The commands further down leave the `cd` out to stay readable.

- three.js r128 is the version the published page loads from cdnjs. Keep it.
- Playwright and its Chromium are already in the workspace. If `require('playwright')` fails, find it (`find / -maxdepth 6 -type d -name playwright -path '*node_modules*' 2>/dev/null`) and run node with `NODE_PATH` set to that `node_modules` folder. Do not run `playwright install`.
- Also needed: ffmpeg, and Python with numpy, fonttools and brotli (`pip install --break-system-packages fonttools brotli` if missing).

If the page cannot be read (it was deleted, or this session has no Artifact tool), say so in one sentence and rebuild the kit from "What each kit file does" at the end. That is slower, and the method below still holds.

`src/film.js` is a working two-shot placeholder. Keep its shape (constants, `update`, `render`, `hud`, `finish`, the `Film` object) and replace the scenes. When it grows past a few hundred lines, move all of it into `src/film/0_core.js`, `1_<world>.js` ... `9_main.js` and delete `src/film.js`: once `src/film/` exists, `build.js` joins only the files in it, in name order. The kit's lines are long, so edit by exact replacement of short unique fragments, and never leave a `//` comment in the middle of a one-line statement. `build.js` checks the syntax and stops with the message.

## 2. Read the brief like an editor

Pull out, before designing anything:

- **What may appear on screen**: the brand's own words and facts, exactly as given. Prices, places and names are shown as written.
- **What must not appear**: anything the brief says stays out of view (a parent company, a partner), and any promise the brand does not make.
- **How it sounds and looks**: voice, palette, type. A palette of four colours means four colours. Materials and type use nothing else. Light is white by default, so shading and shadows stay inside the palette; tint a light only on purpose, for a place or an hour.
- **The logo.** `logo.js` splits each path into pieces, which for a wordmark set as outlines in one row are its letters (separate the rows of a stacked one by hand). `drawLogo` then draws it as supplied, provided every `<path>` carries its own `fill` attribute: transforms, strokes, and fills set by `style` or on a group are not read, so flatten those, and any other shapes, to plain paths first. It draws the supplied colours, so a dark ground needs the brand's light version of the logo. Look hard at the logo's shapes: the film's central idea is often already in them.

If there is no logo and no palette, ask for them. Otherwise start; do not open with questions.

Decide the frame: 16:9 at 1920 × 1080, 60 frames a second, unless told otherwise. Thirty seconds holds about ten shots and tells a whole story; fifteen holds five and suits a sting; eight holds three. Give the film a name and use it for the page title and the file names (`brand-film-title.mp4`).

Choose the type for the brand, two families at most: a serif for the lines that matter and a sans for labels is the default (`fonts.py` ships Newsreader and Jost). Any `@fontsource-variable` family works: install it, point `FONTS` in `fonts.py` at its files, run it again. The fonts are subset to a fixed list of characters, `UNI` in `fonts.py`: printable ASCII and a dozen marks. Add every other character the film sets (é, £, €) to that list first, or it falls back to another typeface without warning.

## 3. Direct it before you build it

Write the shot list first. This is where the film is won.

- **One idea carries the film, and it comes from the brand.** In the reference film the gap between the two planes of the emblem is a house-shaped doorway. The door opens on "Not every home is accepted", the camera goes through it, and at the end pulls back out as the door closes into the logo. Everything between happens inside. Find the equivalent: a shape in the logo, a verb in the tagline, the thing the product does to an object.
- **One idea per shot, one shot per verb.** The brand said "we curate it, we frame it, we publish it, we distribute it", so one object is curated, framed, published and distributed in four consecutive shots, each a visible transformation of the last (model, photograph, page, cards). Show the process happening; do not put claims on slides.
- **A beat grid.** Pick a tempo whose beat is a whole number of frames, and start every shot on a beat: 80 BPM (0.75 s, 45 frames) at 60 fps; 90 BPM (20 frames) at 30 fps. Most shots last three or four beats. A list (three markets, four products) becomes quick cuts of two beats each.
- **One motivated camera move per shot**, and a different one each time: a low dolly through a doorway, a crane up to a plan view, an orbit that ends square-on, a truck, a pull-back that reveals. Each move starts and ends on a composed frame.
- **Light is part of the story**: day to dusk as something is sent out, a different light for each place.
- **Type is sparse and exact**: a line arrives when its picture arrives and never competes with it. A label that must be read is 26 px or more on the 1080p frame. Smaller captions (the reference film has them at 11 to 19 px) are texture: legible only at full size, so they carry nothing the viewer needs. The reference broke this once, with its package prices at 17 px; set a fact like a price at 26 px or more. Even 26 px is small on a phone; that is solved by a vertical cut, not by enlarging labels until they compete with the picture.
- **The ending is held.** Give the last statement and the logo more time than feels necessary, at least 2.5 s on the lockup, and do not fade out: the film may loop, and the last frame should be the logo. In a very short film the lockup can arrive inside the last shot without a cut.

The reference film's list, as a pattern (30 s, ten shots):

| At | Shot | What happens | Camera |
|---|---|---|---|
| 0:00 | The door | The emblem stands as a doorway; it opens, light pours through | push in and through |
| 0:03.75 | Submissions | A gallery of architectural models on plinths | low glide |
| 0:06.75 | Curate | One is kept; the rest sink and leave their outlines | crane up to plan view |
| 0:09.75 | Frame | A frame squares up around the chosen house | orbit that ends in the photograph |
| 0:12.00 | Publish | The photograph becomes a page | hold, then drift |
| 0:15.00 | Distribute | Night falls; cards go out along four lanes | pull back and rise |
| 0:17.25 | Markets ×3 | Three places, three lights, hard cuts two beats apart | truck / crane / arc |
| 0:21.75 | Packages | Four sheets rise on a dark polished stage, with prices | pull-back reveal |
| 0:24.75 | Principle | One sentence; its key word drops in last | still |
| 0:27.00 | Lockup | Back through the door, which closes into the logo | pull back, hold |

## 4. Build

How the picture is made, in the order you will need it:

- **Worlds.** Each location is its own `THREE.Scene`, built once in `init`. `update(t)` chooses the active world, sets its light and places the camera. A hard cut is just `t` crossing a constant; list every hard cut in `Film.cuts`. `Film.shots` is the chapter list the page shows, and its entries need not be cuts.
- **Seamless studio.** Background, fog and floor are one colour, so there is no horizon: `aimSun` solves the floor's colour so that fully lit floor renders as exactly the background. Fog and background take display colours; lights and materials take linear ones (`lin()`).
- **Scale.** The placeholder suits a scene about 30 units wide. For a wider one, widen the fog range in `buildStudio` and the shadow area in `aimSun(w, az, el, cx, cz, half)`, or shadows are cut off silently.
- **Objects are built, not imported**: boxes, planes and line drawings in the brand palette. An object's drawing (its edges) is a second state you can dissolve to.
- **Camera.** `setCam(position, target, fov, aperture)`. Aperture is the lens radius in scene units; the plane through the target stays sharp, and something at distance `z` blurs by about `aperture × 2000 × |1/F − 1/z|` pixels at fov 30, `F` being the focus distance. A few pixels of blur on the background is plenty. Depth of field shows only in the export and in stills made with sub-frames.
- **Sub-frames.** The exporter averages several renders per frame, each at a slightly different moment, point in the pixel, point on the lens and position of the sun. That one loop gives motion blur, anti-aliasing, depth of field and soft shadows, so the export runs with hard shadows and no MSAA, and the live page uses PCF soft shadows instead. `Film.samplesAt()` sets the count: 6 with a closed lens, 8 with a little blur, 16 where the lens is wide open. Fast motion needs more too.
- **Titles** are drawn on a separate 2D canvas over the picture (`hud`): crisp at any size, exact tracking, no lens blur. `rise` brings a line up into a mask, `tracked` sets letter-spaced capitals, `proj` gives the screen position of a point in the scene for labels that belong to objects, `drawLogo` draws the logo, chosen paths of it, or each piece on its own with an offset and an opacity, which is how a wordmark arrives letter by letter.
- **Finish.** A vignette and fine grain that changes 24 times a second, baked into exported frames by `finish` and laid over the live page by the page itself.

Techniques the placeholder does not show are in the reference film, the whole 30-second film as source, in the repository at `launch/brand-film-kit/reference/product-launch/` (and on the kit page). Fetch its `README.md` first: it lists the seventeen files and says which holds what. (The Artifact tool's `list` action with scope `files` gives every path on the page.) Then fetch only the files you need:

| When a shot needs | Read, under `reference/product-launch/src/` |
|---|---|
| a polished floor with reflections that soften with distance | `film/0_core.js` (`CLIP`, `makeVeil`, `drawWorld`) and `film/4_packages.js`, the world that uses them. Also set `renderer.localClippingEnabled = true` in `init` |
| light you can see: beams, haze, a pool on the floor | `film/1_hall.js` |
| objects sinking through a floor; a 3D view becoming a flat page; day turning to dusk | `film/2_gallery.js` |
| several places built by one function with different light | `film/3_markets.js` |
| a full title system: running header, rolling words, labels pinned to objects, a logo assembling from letters | `film/7_titles.js` and `film/00_lib.js` |
| a full cue sheet for a 30-second score | `score.js` |

Three of its helpers differ from the placeholder's, so carry a technique across with the functions it calls: its `setCam(p, q, fov, shiftX, shiftY, up, aperture, focus)` takes the aperture seventh, not fourth; its `aimSun(sun, direction, cx, cz, half)` only aims, with `matchFloor` setting the floor's colour; and its `logo.json` was made by hand, not by `logo.js`. It is one film for one brand. Take a technique from it, not a scene: a second film that reuses its doorway or its gallery is a copy, not a film for the new brand.

## 5. Look at it, constantly

You can see images, so use that: after every meaningful change, render a contact sheet and read it.

```bash
node build.js && node stills.js "0.4,2,3.6,5,7,9.5,11.9,12.1,15,18,20.5,23,25.5,28,29.5" 5 640 pass3     # out/pass3.jpg, timecodes burned in
node stills.js "11.5" 1 1920 frame 16 full      # one moment at full size with 16 sub-frames: out/frame_11.50.png. The export uses Film.samplesAt() for that moment, often 8
```

Check, shot by shot: is the subject obvious in half a second; does every move start and end composed (look at the first, middle and last frame of each shot); is every line of type legible over what is behind it for its whole life; do type and picture ever collide; is there a horizon line, shadow acne, something poking through a floor, light blown out to white; is the frame either side of each cut clean. Type running into the picture is the commonest fault, and moving one tends to cause the next collision, so check again after each fix. Expect many passes: this loop is the craft.

**Motion is invisible in stills.** Stills with sub-frames sample the lens and the light but not time. To see motion blur, and how a fast move reads, export a few real frames and tile them:

```bash
rm -rf strip && node export.js 60 300 312 0 1 strip && ffmpeg -hide_banner -loglevel error -y -pattern_type glob -i 'strip/*.jpg' -vf "scale=640:-1,tile=4x3" out/strip.jpg     # frames 300 to 311; the folder is emptied first because frames on disk are skipped
```

Separate ghost copies of a moving edge mean too few sub-frames for that shot; a thin bright thing that smears to nothing is moving too fast or is too thin.

**The logo.** Render the supplied SVG on its own (a headless-browser screenshot will do) and compare it with a full-size still of the lockup. When a 3D object turns into the 2D logo, hand over in a single frame; a cross-fade tints for a few frames.

## 6. Score

The soundtrack is synthesized in `src/score.js` from a small set of instruments (pads, a mallet, a soft pulse, a sub hit, ticks, noise whooshes) into one buffer. It is built with the film, so write its events against the film's own timeline constants (`T_B`, `BEAT`), as the placeholder does: a retime then moves the music with the picture. (The reference's cue sheet has its times typed as numbers; do not copy that.)

- One event on every cut: a chord change, a mallet note, a sub hit for the big ones. A riser (`whoosh` with a late peak) leads into each major transition.
- One key, a slow harmonic rhythm (a chord per shot), a pulse that starts after the opening and stops for the closing statement.
- Never leave near-silence before the final chord: bridge it with a riser and a low pad.
- Target about −16 LUFS integrated with peaks no higher than −2 dBFS. Measure, then adjust the `pre` gain.

```bash
node audio.js                                            # out/score.wav
python3 hits.py out/score.wav "3.0,5.25"                 # does each accent land on its cut? give every cut time
ffmpeg -hide_banner -nostats -i out/score.wav -af ebur128=peak=true:framelog=quiet -f null - 2>&1 | grep -E "^ +(I|Peak):"
```

You cannot hear it. Say plainly at delivery that it was checked by measurement and should be played once before posting.

## 7. Export, encode, verify

```bash
rm -rf probe && node export.js 60 0 20 0 1 probe         # time 20 frames first: it prints ms per sub-frame. Time 20 of the heaviest shot too
cp dist/dev.html dist/render.html                         # freeze the build being rendered, so you can keep editing
FILM_PAGE=dist/render.html nohup node export.js 60 0 99999 0 2 > x0.log 2>&1 &     # worker 0 of 2
FILM_PAGE=dist/render.html nohup node export.js 60 0 99999 1 2 > x1.log 2>&1 &     # worker 1 of 2
tail -n 1 x0.log x1.log; ls frames | wc -l                # progress. Do not poll with "pgrep -f export.js": it matches itself
bash encode.sh brand-film-title 60 6000                   # out/brand-film-title.mp4, then its checks
bash encode.sh brand-film-title-master 60 20000           # a master to keep on disk
```

- **Time.** With no GPU the browser draws WebGL on the CPU: 0.1 to 0.3 s per sub-frame at 1080p with one worker, depending on the shot, and nearly double that in each log when two workers share two cores. The reference averaged 8 sub-frames a frame and 0.45 s per sub-frame with two workers: 1,800 frames in 53 minutes. Tell the person how long it will take. On two cores a second worker finishes the film about 15% sooner, because the software renderer already uses both; with more cores, add workers and time it. If the timing run shows time to spare, spend it on more sub-frames.
- **Lean layers.** The exporter passes `lean: true` to `init` and three spare numbers to `setJitter` (`u`, `v`, `w`), different for every sub-frame. A layered effect (haze, volumetric light) can draw a quarter of its layers per sub-frame at a different phase and let the averaging fill them in.
- **Resuming.** Frames already on disk are skipped, and a frame renders byte for byte the same whichever worker draws it. So after a crash, start the workers again. After a fix: build, copy `dist/dev.html` over `dist/render.html` again, delete the frames of the shots the fix touches, and start the workers again. To confirm the range was wide enough, export the frame on either side of it into a spare folder and compare each with the one on disk (`cmp`): they must be identical.
- **Size.** Sending a 38 MB file to the conversation was refused; 23 MB went through. File size in MB is about (kbit/s + 256) × seconds ÷ 8000, so 6,000 kbit/s suits 30 seconds.

`encode.sh` prints the checks. Read them: frame count equals duration × fps, duration exact, loudness near target, fidelity (PSNR) above 40 dB, and look at the contact sheet it writes. Then look at the two frames either side of every cut in the MP4 itself (frame number = cut time × fps):

```bash
ffmpeg -hide_banner -loglevel error -y -i out/brand-film-title.mp4 -vf "select='between(n,224,225)',scale=960:-1,tile=2x1" -frames:v 1 out/cut_3.75.jpg
```

A blended frame at a cut means a sub-frame crossed it: that cut is missing from `Film.cuts`.

## 8. The page

`src/page.html` is the player: the stage, play and pause, a scrub bar, sound (off until asked for), full screen, and the shot list as buttons. `node build.js` writes `dist/page.html`, which loads three.js from cdnjs, and `dist/page_test.html`, the same page with three.js inlined. The workspace cannot reach cdnjs, so the test runs on the second:

```bash
node pagetest.js        # wants: autoplayAdvanced true, sound "Sound on", afterLastShotClick just past the last shot's start, pausedHolds true,
                        # live3dContrast well above 0, phoneReducedMotionHoldsAt near the end, phoneScrollsSideways false, errors []
```

Look at `out/page.png` and `out/page_phone.png`. Then load the artifact design guidance, restyle the page in the brand's palette and type, write a real description of the whole film into the canvas `aria-label`, and publish `dist/page.html` as an artifact (a title of two to four words, icon "film"). If no artifact tool is available, send `dist/page_test.html`, which also works offline.

**Publish the film's source with its page**, as supporting files (the Artifact tool's `files`, each with content type `text/plain`): the film code (`src/film.js`, or every file in `src/film/`), `src/score.js`, `src/page.html`, `logo.json` and `fonts/fonts.json`, under those same paths. Nothing else outlives the session. With them, a later session can fetch the project, lay it over the kit and change one line; without them, a change means making the film again.

The page already does these and must keep doing them: it follows the layout width and gives up resolution before frames on slow devices; with sound on, the audio clock drives the picture so they cannot drift; reduced-motion visitors get a still from just before the end, the logo, instead of autoplay; phones get smaller shadow maps; when 3D cannot start, a sentence points to the MP4.

## 9. Deliver

Send the MP4 with the file-sending tool and publish the page. Then say, briefly:

- what the film is, in two or three sentences that walk through it;
- **what you could not check**: the sound was measured, not heard; you saw the film as stills and frame strips, never in motion, so its pace is for them to judge; the page ran only in a headless browser;
- **what you wrote yourself**: any headline, label or closing line that is not from the brief;
- **what will date**: prices and other facts shown on screen;
- **what is deliberately absent**, when the brief asked for something to stay out of view;
- the file's size, and that a larger master exists.

One next step, offered in plain words: a vertical 9:16 cut for social, or a voice-over. Keep the shot list with its times and `out/score.wav`; a voice-over needs both. Keep `frames/` for as long as the session lasts, so that a change asked for today re-renders only the shots it touches. A later session will not have it.

## Revising the reference film

The kit page holds the first film made this way, Matter of Place "Product Launch", as a buildable project. To change it (a price, a line, a new cut), fetch its `README.md`, then the seventeen files it lists, and follow its "Rebuild it" and "Revise it" sections. In short:

- Lay its `src`, `fonts` and `logo.json` over a second copy of the kit and build. Frames rendered that way match the delivered film byte for byte, except in the door shot, where some pixels differ by one level.
- Make the change and look at stills of the shot before and after.
- Rendered frames are not kept between sessions, so in a new session the whole film is rendered again: about an hour. Say so before starting.
- A new picture means everything downstream is made again: the MP4 and its master, the version with voice (its picture was copied from the old film), and the film's own page, which draws the film live from the same code and would go on showing the old version. The README gives the page's address and the way to carry the voice across.

The same goes for any film made with this skill. Its source was published with its page (section 8): list that page's files, fetch them, lay them over a copy of the kit, and proceed as above.

## Pitfalls that cost time once already

- **Additive light blown out to white.** Blending happens after output encoding, so colours for additive layers must be display values converted to linear; small values add up to white.
- **A second render pass erased the first.** With `scene.background` set to a colour, three r128 clears even when `autoClear` is false. Use `renderer.autoClearColor = false` for that pass.
- **Objects sinking through a floor** showed below it and flickered: clip at the floor plane, and hide the object below a few per cent of its height.
- **Titles vanished during a light change**: ink and background met at mid-grey. Roll the dark set out and the light set in at one chosen moment.
- **A rushed ending**: the last statement and the lockup were given more time, and the end fade was removed.
- **Fonts measured before they loaded** gave wrong widths. The kit's tools load every face in `Film.fonts` before `init`; list exactly the faces the film sets, and clear any cache of text widths in `init`.
- **PNG frames** took 1.6 s each to encode; JPEG at quality 1.0 is several times faster and keeps full chroma.
- **Console noise** in headless ("GPU stall due to ReadPixels") is harmless and filtered; any other page error is real.

## What each kit file does

Enough to rebuild a file if the kit page cannot be read.

| File | Job |
|---|---|
| `src/film.js` | The film. Constants (size, duration, beat, cut times); easing and `seg`; palette; camera with a thin lens (move the camera across the lens per sub-frame and shear the view so the focal plane stays put); `buildStudio`, `aimSun`; `init`, `update`, `render`; the title layer (`hud`, `rise`, `tracked`, `drawLogo` with an optional per-piece callback); `finish`; `samplesAt`; and the `Film` object: `W, H, DUR, init, update, render, hud, finish, samplesAt, vignette, grainTile, cuts, shots, fonts, setJitter, size, setRatio` |
| `src/score.js` | `Score.render(sampleRate)` returns an AudioBuffer from an `OfflineAudioContext`: instruments, a small reverb, a compressor and limiter, then the cue sheet |
| `src/page.html` | The player page, with `/*__FONTS__*/` and `__FILM_JS__` placeholders |
| `build.js` | Joins the film files and the score, checks syntax with `vm.Script`, injects `logo.json` for `__LOGO__`, embeds the fonts as data URLs, writes `dist/dev.html` (three.js inlined; stills, audio and export use it), `dist/page.html` and `dist/page_test.html` (the page test uses that one) |
| `fonts.py` | Pins or narrows the axes of variable fonts, subsets them to a fixed character list (`UNI`), writes base64 WOFF2 into `fonts/fonts.json`, keyed by family name, style and weight range |
| `logo.js` | Splits each SVG path at its sub-paths, groups those that overlap sideways into pieces, writes `logo.json` (`x, y, w, h, paths[{d, fill, rule, pieces}]`) |
| `stills.js` | Opens `dist/dev.html` in headless Chromium (flags `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`), renders the given times, optionally averaging sub-frames, and tiles them with timecodes |
| `audio.js` | Renders the score in the browser and writes a 48 kHz 16-bit stereo WAV |
| `hits.py` | For each cut time, finds the sharpest rise in level within 0.2 s and prints its offset |
| `export.js` | For each frame: N sub-frames inside a 180-degree shutter that opens at `t` and never crosses a hard cut; picture summed in linear light and titles summed separately, then combined, dithered, finished and saved as JPEG at quality 1.0. Workers split frames by index; frames on disk are skipped |
| `encode.sh` | Two-pass x264 (preset slow, high profile, yuv420p) with the frames converted from full-range BT.601 to limited-range BT.709 and tagged, AAC at 256 kbit/s; then prints stream facts, loudness and PSNR and writes a 24-frame contact sheet |
| `pagetest.js` | Opens `dist/page_test.html`, checks autoplay, sound, seeking, pause and that the live picture has contrast, then a phone-width pass with reduced motion; saves two screenshots |
