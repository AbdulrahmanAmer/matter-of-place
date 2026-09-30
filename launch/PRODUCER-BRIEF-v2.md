# Producer brief v2 — the Matter of Place launch film, launch grade

You are the director and producer. The v0 film in `launch/01-launch-film` is a well-lit slideshow; the CEO rejected it.
The bar is a modern model-launch film (Anthropic's Claude launches are the reference class): type as the actor, a camera
that is always alive, cuts that land on sound, the real product in motion, rhythm that breathes. Everything coded by you.
No outside models, no stock, no recordings, no music (S36: music is not permitted; sound design only).

Read first, in this order, and do not skip: `E:\Matter Of Place\launch\MOTION-BIBLE.md` (the direction, vocabulary,
beat sheet, sound rules, gate, loop), `E:\Matter Of Place\launch\REVIEW-RUBRIC.md`, `E:\Matter Of Place\CLAUDE.md`,
`E:\Matter Of Place\Matter Of Place Codebase\src\styles\tokens.css`, `src\components\brand\emblem.tsx` and `wordmark.tsx`
(port to SVG exactly; the v0 port in `launch/01-launch-film/scene.html` is usable), `src\data\properties.ts` and
`src\data\markets.ts` (place names and hero image files only; no prices, no addresses in the film).
Photography: `src\assets\*.jpg`, `src\assets\gallery\*.jpg`. Film clip: `public\media\tiburon-waterline.mp4` (may be used as one shot).

## Where you work
`E:\Matter Of Place\launch\film\` (create). Reusable engine in `launch\engine\` (create) so later reels and the partner
video use it. Do not modify `Matter Of Place Codebase\` (another worker is refactoring it on a branch right now). For
product shots, make a read-only snapshot of `main`: `git -C "E:/Matter Of Place" worktree add "E:/Matter Of Place/launch/.site-main" main`,
then `bun install` and `bun run dev --port 8090` inside `launch/.site-main/Matter Of Place Codebase`. Add `.site-main/`
to `launch/.gitignore`. Remove the worktree when done (`git worktree remove`).

## Toolchain
bun (`bun add gsap three tone puppeteer-core` inside `launch/`), ffmpeg 8 + ffprobe on PATH, cached Chrome at
`C:\Users\DELL\.cache\puppeteer\chrome\win64-154.0.8037.57\chrome-win64\chrome.exe`. Google Fonts reachable (Jost,
Cormorant Garamond, Urbanist). Windows: forward slashes in scripts, absolute paths, the Bash tool. `node launch/tools/motion-gate.mjs <mp4>`
is the gate; read it to know what it measures.

## The engine (`launch/engine/`)
- `serve.mjs`: tiny static server for the scene folder (ES modules do not load from `file://`).
- `scene` contract: a page exports `window.__film = { duration, seek(ms), ready: Promise }`. `seek` sets the GSAP
  master timeline (`gsap.globalTimeline.pause()`; `master.seek(ms/1000)`), re-renders every Three.js scene at that
  time, and resolves when the frame is painted (`requestAnimationFrame` twice). No wall-clock time anywhere.
- `capture.mjs`: puppeteer-core, 1920×1080, `deviceScaleFactor 1`, waits for `__film.ready`, then for each frame
  `await page.evaluate(t => __film.seek(t), ms)` and `page.screenshot` to `frames/%05d.png`. Parallel workers by
  frame ranges (v0 did this; reuse the idea). Resume-safe: skip frames that exist.
- `audio.mjs`: opens the same scene with `?audio=1`; the page renders the sound design with an `OfflineAudioContext`
  (Tone.js `Tone.Offline` is fine) into a WAV blob according to the beat sheet's cue list, and the script saves it.
  Only the palette in MOTION-BIBLE §3. Never a pitched sustained tone, chord, melody, loop or voice.
- `encode.mjs`: `ffmpeg -framerate 30 -i frames/%05d.png -i audio.wav -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -af loudnorm=I=-18:TP=-1:LRA=9 -movflags +faststart -shortest out.mp4`,
  plus `contact-sheet.png` (`fps=1/2,scale=320:-1,tile=8xN`).
- Product capture: `product.mjs` drives `http://127.0.0.1:8090` (home, a dossier, the properties grid) with scripted
  scroll and hover at the film's frame rate and writes PNG sequences the scene composites as textured planes in depth.
  Inject CSS to hide `.content-tag` and the delivery notice so no "ILLUSTRATIVE" label appears; this is our site and a film.

## The film (`launch/film/`)
- `STORYBOARD.md` first: every beat from MOTION-BIBLE §4 expanded into shots with move IDs, seconds, image, copy,
  sound cue. You may change shot order inside a beat, choose photographs, and adjust seconds by ±30 %; keep the copy.
- Build scene by scene. After each beat is built, render only that window (capture supports `--from --to`) and look at
  three frames yourself (Read the PNG). Ask: would this frame sit in an Anthropic launch film? If not, rebuild the beat.
- Depth: every photograph is at least three planes (matte-cut is not required; use a soft radial mask for the subject
  plane and a slightly scaled copy for foreground) so M6/M7/M8 read as camera moves.
- Type: real masks (`overflow:hidden` line wrappers, GSAP `yPercent` 110 → 0, `expo.out`, 60 ms stagger), tracking
  via `letter-spacing`, weight via cross-fade of two layers. Never animate `opacity` alone for text.
- Sound: one cue list as data (`cues.json`: t, type, params), consumed by both the audio render and, if you want, an
  on-screen check overlay for QA that is disabled in the final render.

## The loop (MOTION-BIBLE §7), three rounds minimum
1. Render full, encode, `node launch/tools/motion-gate.mjs launch/film/matter-of-place-launch.mp4`. Fix until the gate passes.
2. Dispatch a fresh reviewer with the Agent tool (`subagent_type: general-purpose`, `model: opus`) and this prompt:
   "You are a fresh-eyes reviewer. Read E:\Matter Of Place\launch\REVIEW-RUBRIC.md and E:\Matter Of Place\launch\MOTION-BIBLE.md.
   Judge E:\Matter Of Place\launch\film\contact-sheet.png and frames at these timecodes (Read the PNGs): [list 12 frames
   spread across the film]. Return the eight scores, the three worst shots with timecodes and one fix each, and the verdict."
   Save its answer as `launch/film/reviews/round-N.md`.
3. Fix the three worst shots, re-render only those windows, re-encode, re-gate, next round. Stop when the gate passes
   and the reviewer's lowest score is 4, or after round 5 (then report the remaining gap plainly).

## Report
Write `launch/film/REPORT.md`: storyboard summary, engine description, gate output (paste), each round's scores and
what changed, final `ffprobe` output, contact-sheet path, what is UNPROVEN, cost of the loop in rounds, and one line
`MEMORY: <lesson>`. Add any tooling that cost you time to `E:\Matter Of Place\GOTCHAS.md` as a process entry with proof.
Keep frames and the worktree out of git. The MP4 and contact sheet stay in the repo.
