# B12 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 1

1. `launch/engine/audio.mjs` (not blocking). audio.mjs reads the output path only from argv[3]. A call that puts --query before the output path (audio.mjs scene.html --query qs out.wav) drops out.wav without any message and writes audio.wav beside the scene. The author's claim says the run 'with --query before out' passed, but the log line for that run gives no output path, so this case was never tested. When the later render-reel.mjs is written with that argument order, the WAV lands in launch/reel/audio.wav (git-ignored) instead of .tmp/reel/audio.wav. encode then fails loudly on a missing file, or quietly encodes a stale WAV if one is left over. The plan does not fix the argument order, and the usage comment documents [out.wav] before [--query], so this is a follow-up for the group that writes render-reel.mjs: put the output before --query, or have audio.mjs reject a positional argument it does not use.
   Evidence: Confirmed by running: `MSYS_NO_PATHCONV=1 node launch/engine/audio.mjs .tmp/standin/index.html --query "k=v" .tmp/aud/before.wav` -> rc 0, .tmp/aud/before.wav MISSING, .tmp/standin/audio.wav contains ?k=v&audio=1. Code: `const named = process.argv[3]; const out = resolve(named && !named.startsWith("--") ? named : join(dirname(scene), "audio.wav"));`

2. `launch/engine/encode.mjs` (not blocking). A --maxrate value that is not a number, or one with no value after it, gives Number() = NaN, which is falsy. The cap is then left out with no message, so the reel would be encoded without the 12 MB bitrate cap. Step 6's probe size check (H33 (8)) is the second layer that would refuse the oversized file, so nothing breaks for this step. The fix is to refuse a non-numeric value.
   Evidence: Suspected by reading, not run: `const maxrate = rate >= 0 ? Number(args[rate + 1]) : 0; ...(maxrate ? ["-maxrate", ...] : [])`

## g2 · steps 2-3

1. `app/tests/unit/reel/moves.test.ts` (not blocking). Coverage gap, confirmed by running it. The case 'writes every ease as a literal, so the check above sees it' only finds eases written as `ease:`. An ease passed by position to film.js move() (scene.mjs:55, `dolly = ... move(tl, cam, t0, t1, from, to, "none")`) is never checked. Changing that camera ease to an unapproved, unbanned value such as power4.inOut leaves all of moves.test.ts green, and that ease is the one P-025 needs to stay at none. The plan's wording ('any `ease:` value') is met to the letter, so this is a follow-up: also check the last argument of move() or the dolly literal.
   Evidence: `node scripts/watchfail.mjs --file ../launch/reel/scene.mjs --find 'from, to, "none");' --replace 'from, to, "power4.inOut");' --run "bunx vitest run --project unit tests/unit/reel/moves.test.ts" --expect FAIL` -> `WATCHED-FAIL BAD: stayed green`

2. `app/src/server/assets/spec.ts` (not blocking). File outside the group's file list, against a plan line. The Contract says spec.ts is a file 'which this slice does not change', but the group widened `specHash(spec: RenderSpec | ReelSpec)` and added `import type { ReelSpec }`. The change is type only (the body and B9 hashes are the same; B9's watched-fails on spec.ts replay ok), it is disclosed in the log and in P-2102, and the plan could not work as written (TS2345). The orchestrator should fold the plan line and accept or veto the one-writer exception.
   Evidence: `git diff origin/main...slice/b12 -- app/src/server/assets/spec.ts` shows only the import line and the signature line.

3. `launch/reel/cues.mjs` (not blocking). Unused export (STANDARDS C04). `export const DURATION = 18` is used only inside cues.mjs; nothing imports it (knip does not cover launch/). Drop the `export` or use it.
   Evidence: `git grep -n DURATION -- launch app/scripts app/tests` -> only launch/reel/cues.mjs:8,27,66 and the registry find text.

4. `workspace/05-plans/logs/B12.md` (not blocking). The log's UNPROVEN line for the Deno step can now be settled. `deno check --config supabase/functions/job-runner/deno.json src/server/assets/reel-spec.ts` passes (exit 0). CI's deno step checks only scripts/deno-portable.ts, which does not import reel-spec.ts, so CI still does not cover it until render-reel.ts lands or deno-portable imports it.
   Evidence: `deno check --config supabase/functions/job-runner/deno.json src/server/assets/reel-spec.ts` -> `Check src/server/assets/reel-spec.ts`, exit 0.

5. `launch/reel/scene.mjs` (not blocking). Note for the orchestrator to rule on (disclosed in the log). The scene relies on film.js depth(), whose plane masks are CSS radial-gradient and linear-gradient mask-images (film.js:128-133). They are alpha masks, not a visible gradient, and the approved launch film uses them. Invariant 3 lists 'gradients' as forbidden and moves.test.ts looks only in scene.mjs and scene.html, so whether a mask gradient is allowed is not written down anywhere.
   Evidence: `grep -n gradient launch/engine/runtime/film.js` -> lines 128-133 (depth masks).

6. `launch/reel/scene.html` (not blocking). Not proven by this group (the author's own UNPROVEN list): the scene loads /brand/logo/wordmark/wordmark-horizontal-bone.svg and /app/src/styles/tokens.css, so render.yml's reel job must check out brand/. Step 4 must prove it.
   Evidence: scene.html:6 and :65; render.yml reel job not yet written.
