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

## g4 · steps 6

1. `app/tests/unit/reel/render-reel-script.test.ts` (not blocking). The upload branch is covered by no test. In render-reel.mjs, `if (out === undefined && !input.fixture)` with the putIfMissing loop (about lines 301-305) can be inverted or deleted and every unit test, plus the fixture proof, stays green. A real job would then report done with files whose keys hold no object in bucket media. The author already lists the real upload as UNPROVEN, and the plan names no upload test, so this is a follow-up for the slice that proves a real render_reel job.
   Evidence: Read: the test file imports only resultFor, gateError, probeError, reelInput, reelFiles, PROVISIONAL and MAX_BYTES, and no registry entry names the upload condition. Neither the fixture run nor GitHub run 37342756765 reaches putIfMissing.

2. `app/tests/unit/reel/render-reel-script.test.ts` (not blocking). The provisional-result test only compares the PROVISIONAL constant with its literal value. Deleting `writeFileSync(resultFile, JSON.stringify(PROVISIONAL))` in the main block would stay green. I confirmed by running that the write happens: result.json held reel_timeout during my render. The plan asks only for the value test, so this is a note.
   Evidence: Read: test lines 95-97. Mid-run, app/.tmp/reel/result.json read {"status":"failed","error":"reel_timeout","retryable":false}.

3. `app/scripts/render-reel.mjs` (not blocking). resultFor (line 89) marks every 'media-store: ' message as retryable. That includes `media-store: SUPABASE_URL is not set` and `SUPABASE_SERVICE_ROLE_KEY is not set` from required() in scripts/lib/media-store.mjs. A missing secret is a configuration fault, not an outage, but it would run 5 attempts of Actions minutes before going dead. The Contract only names a Storage outage, a failed download and a failed upload as retryable.
   Evidence: Read: media-store.mjs required() throws `media-store: ${name} is not set`, which matches /^(storage_unavailable$|media-store: )/.

4. `app/scripts/render-reel.mjs` (not blocking). If the second flatness check (`node([... probe.mjs flat ...])`, line 285) fails, the error is `probe.mjs exited 1`. The Contract's fixed form is `gate_failed: <check> <value>`, and B9's trigger copies this text into assets.render_error for screen 10. In practice the gate's own flatness check runs first on the same measure, so this is unlikely to fire.
   Evidence: Read: node() throws `${basename(args[0])} exited ${status}`, and nothing wraps the probe.mjs call.

5. `workspace/05-plans/logs/B12.md` (not blocking). The reel's bytes and gate numbers change between runs on the same machine, not only between machines. My laptop run of the same commit measured -18.23 LUFS, -2.59 dBTP, reel.f356c15a.mp4 at 7108568 bytes and poster.2b6e95a9.jpg. The author's laptop run and CI both measured -18.19 and -2.29, with cd1a66e9 / 3b3e1755. The log's UNPROVEN line describes this only as cross-machine. It does not break F24, since a re-render is a new key anyway, but a by-hand re-render cannot be expected to reproduce a key.
   Evidence: Ran: my render log showed 'loudness -18 +/-1.5 LUFS -18.23 LUFS' and 'true peak <= -1 dBTP -2.59 dBTP'. gh run view 37342756765 --log shows -18.19 LUFS and -2.29 dBTP.

6. `workspace/05-plans/B12.md` (not blocking). Two plan lines no longer match what was built, for the orchestrator to fold. Capture runs at `--workers` min(4, availableParallelism()), not the plan's `--workers 2`: the runner measured 4 cores. The reel job adds actions/setup-node at node 24, which the plan's step list leaves out (P-2112). Both are logged as decisions.
   Evidence: Read: render-reel.mjs line 273. Log 'Decisions' items (2) and (5). The CI log printed '4 workers'.

7. `.github/workflows/README.md` (not blocking). The README still says 'These three exist' and has no row for render.yml. The file now carries B8's render job and B12's reel job. The row is B8's to add (this group did not touch the README), so it goes to the orchestrator.
   Evidence: Read: README line 11, 'Later slices add `render.yml` (B8 ...; B9 and B12 add to it) ... each lands with its owner and gets its row here'. The table lists only ci.yml, deploy.yml and backup.yml.

## g3 · steps 4-5

1. `workspace/05-plans/B12.md` (not blocking). The step 5 proof names ROUND-3.md, which fails as written (5 axes at 4 or 5, 0 SHIP). The real SHIP round is ROUND-15.md (7, 1, 1). The plan line is stale, the author disclosed it and P-2108 banks it. The orchestrator has to fold the proof and the Files line to ROUND-15.md, or the merge gate will read this step as red.
   Evidence: Confirmed by running: ROUND-3.md -> 5 0 1; ROUND-15.md -> 7 1 1.

2. `launch/engine/chrome.mjs` (not blocking). This group edited a g1 file outside its named list, against the one-writer-per-file lane rule. It added the P-052 GPU-off flags to CHROME_ARGS. The change is right and needed for invariant 6, it is disclosed, and no current launch scene uses WebGL. Still, --use-gl=disabled now applies to every engine capture (capture, audio, still, product), and CLAUDE.md names Three.js as part of the motion engine, so any future WebGL scene would get no GL context. The author's watched-fail (8 captures with the old args) is UNPROVEN by me, because a read-only reviewer cannot revert the file.
   Evidence: git show 5b6c12a -- launch/engine/chrome.mjs (+ --disable-gpu --disable-gpu-rasterization --disable-accelerated-2d-canvas --use-gl=disabled); launch/package.json lists three ^0.186.1; grep finds no WebGL use in launch/ outside a comment in film.js:10.

3. `launch/reel/STORYBOARD.md` (not blocking). g2's file was edited at d63fd26 by this group, and g2's review of it is older than the edit. The author disclosed this as UNPROVEN. It needs a re-read by g2's owner or the orchestrator.
   Evidence: git log --oneline origin/main..slice/b12 -- launch/reel/STORYBOARD.md lists d63fd26 (g3).

4. `workspace/05-plans/logs/B12.md` (not blocking). The edge-scan proof (item 5, 'worst dark edge run (px): l 0, r 0, t 0, b 0') names no command and no committed script, so nobody else can re-run it (P-088 spirit).
   Evidence: Read: log item 5 gives only the output line; no edge-scan script exists under launch/ or app/scripts.

5. `launch/reel/review/ROUND-15.md` (not blocking). Invariant 6 'same MP4 bytes' is still UNPROVEN, and the author says so honestly. My two full captures differ in 1 frame (00506, 6 samples, 1 level); the author saw 14 frames. With putIfMissing keyed on the spec hash, a re-render cannot overwrite a stored reel, so nothing breaks for the product. The orchestrator should either relax the Contract's wording to 'stills byte-identical, MP4 within pixel noise' or assign the cause hunt (P-2119).
   Evidence: Confirmed by running: diff of the two sha256sum lists -> 1 line (00506.png); cmp -> 6 samples max 1.

## c7 · steps 7

1. `app/scripts/db-fn.mjs` (not blocking). Follow-up: bun run db:fn writes a false '-- down:' line for functions that are new. The line says 're-run bun run db:fn <names> from the previous commit', but that commit has no such files. The B12 g5 log line 273 says the author rewrote this line by hand in 20261006001909_reel.sql. That workaround is not in the bank, so the next slice that adds a new SQL function will hit it again.
   Evidence: db-fn.mjs line 129 writes `-- down: re-run bun run db:fn ${names.join(" ")} from the previous commit of ${sources}`. grep for a db:fn down-line entry in GOTCHAS.md finds none. The migration header now reads '-- down: drop trigger assets_reel_video ...; drop function ...'.

2. `workspace/05-plans/B12.md` (not blocking). Follow-up for the orchestrator to fold into the plan: Data changes still gives the duration formula as floor(d / 60) with round(d) % 60, which yields '0:00' for 59.6. The build rounds first, which is correct and is recorded in P-2120. The Contract also still says render-reel.ts imports '@/server/assets/reel-spec.ts'. The build uses a relative '../../assets/reel-spec.ts', like its sibling steps; the CS-01 .ts rule holds and deno check passes. Neither is a code defect.
   Evidence: attach_reel.sql: v_seconds := round(...)::int; format('%s:%s', v_seconds / 60, ...). render-reel.ts line 3: import { buildReelSpec } from "../../assets/reel-spec.ts".
