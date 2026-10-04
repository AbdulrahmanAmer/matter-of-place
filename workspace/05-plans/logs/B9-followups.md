# B9 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 1

1. `workspace/08-creative/BRIEF.md` (not blocking)
   - What: The brief contradicts itself on the cover. The cover slot line says 'No headline on the cover', but the same section's option B says 'warm ivory text column on the left with the headline and price', and cover/B.html renders 'A residence shaped around the landscape.' If the CEO picks cover B, the step 3 builder reading the slot list will leave the headline out and stop matching the chosen PNG.
   - Evidence: grep -o 'A residence[^<]*' workspace/08-creative/options/cover/*.html returns cover/B.html only. BRIEF.md ## cover reads 'Slots: image (hero), wordmark, location line, price, specs. No headline on the cover.' and 'Options: ... B, warm ivory text column on the left with the headline and price'. Confirmed by running.

2. `workspace/08-creative/options/cover/B.html` (not blocking)
   - What: Cover B breaks the brief's own cover safe area ('64 px on every side'). The wordmark, location, headline, price and specs all sit at left:56px, and the wordmark at top:56px. It is a mock and no crop removes 56 px, so nothing visibly breaks, but the option does not follow the brief that a later builder will follow.
   - Evidence: Text-position extraction on cover/B.html: 'left:56px;top:56px WORDMARK', 'cap | left:56px;top:236px', 'serif | left:56px;top:268px', 'num | left:56px;top:504px'. Confirmed by running.

3. `launch/engine/still.mjs` (not blocking)
   - What: Gap in coverage (follow-up, not a contract break). still.mjs has no test and no registry entry. Its refusal paths were proven only by hand, by the author and again by me here. A missing image is refused by the image.decode() rejection, not by the requestfailed listener the author's note implies. If a later edit drops the decode wait, nothing automated would catch it.
   - Evidence: Scratch img.html with <img src=nope.jpg> gives rc=1 'DOMException: EncodingError: The source image cannot be decoded.' Font and CSS failures give rc=1 'Page errors'. Confirmed by running.

## g2 · steps 2

1. `workspace/08-creative/DIRECTION.md` (not blocking)
   - What: In the standalone-email bullet, the footer and its rule are in the wrong order compared with the chosen option. DIRECTION.md says the footer comes 'above a 1 px sandstone rule'. In options/standalone-email/C.html the rule comes first (top:1196px) and the footer text below it (top:1212px). Step 3 builds from this file, so it would put the rule under the footer.
   - Evidence: Confirmed by reading: standalone-email/C.html has `<div ... top:1196px;height:1px;background:var(--sandstone)>` followed by the footer `<div ... top:1212px ...>You receive this ...`. DIRECTION.md line: 'footer 12 px Jost 300 with the preference and unsubscribe line and "Matter of Place, an Omnikom company" above a 1 px sandstone rule.'

2. `workspace/08-creative/DIRECTION.md` (not blocking)
   - What: The general 'Values that follow' rules contradict the picked options. (a) 'Cormorant Garamond for headline, place name and price', but in standalone-email C the price is in the 12 px Jost caps line 'California · $8,950,000', and DIRECTION's own standalone bullet says so. (b) 'Caps lines use letter spacing 0.22em', but the email link 'View the residence' and 'Property note' use 0.2em in both picked email options. Step 3 turns these values into tokens.
   - Evidence: Confirmed by reading options/standalone-email/C.html (`.cap` 'California · $8,950,000' at 12px; 'Property note' and the link at letter-spacing:.2em) and options/newsletter-block/A.html (link letter-spacing:.2em).

3. `workspace/08-creative/DIRECTION.md` (not blocking)
   - What: BRIEF.md lists these standalone-email slots: two supporting photographs and one call to action with square corners. Option C, the pick, has neither: it has one inset photograph and a text link. DIRECTION.md does not say these slots are dropped, so step 3 has to guess whether production carries the two supporting photographs.
   - Evidence: Confirmed by reading: BRIEF.md '## standalone-email' Slots line, compared with options/standalone-email/C.html (one img, link is an underlined span). DIRECTION.md says nothing about supporting photographs.

4. `workspace/05-plans/B9.md` (not blocking)
   - What: Stale plan text that is not this group's file (orchestrator to fold). Step 2, the Files list, the Observed exit and sizing/B9.json g2 still say 'the CEO's picks' and 'the operator assigns the S-number'. The picks and S65 were made by the CTO under ASSUMED H55 (2), which overrules this text.
   - Evidence: plan-brief output: 'BLOCKED until the CEO has picked ...', '(the operator assigns the S-number)'. grep in sizing/B9.json: 'DIRECTION.md from the CEO's picks'. ASSUMED.md line 250 H55 (2).

Two follow-ups on GOTCHAS.md are banked as P-705 and P-706, not listed here.

## g3 · steps 3

1. `app/src/templates/social/social.css` (not blocking)
   - What: No automated check pins the slot weights. Only a manual, uncommitted probe proves the h1 renders at 400; the author labelled this UNPROVEN. If a later edit drops line 139 (`font-weight: var(--social-weight-text)` on .social-frame__headline), every headline goes back to 700 and check stays green. Step 6's shoot/render path, or a g4 template test that runs in a browser, should assert the computed weights.
   - Evidence: My in-memory mutation removing that line made the headline 700 for carousel and story. templates.test.ts (g4) is SSR-only and cannot see the computed style. Confirmed by running.

2. `workspace/05-plans/STANDARDS.md` (not blocking)
   - What: The folder-map row for public/ (line 87) lists `fonts/*.woff2` only. The committed public/fonts/LICENSES.md is required by the plan, and app/scripts/check-layout.mjs now allows it. The document lags the gate. The author already logged this as P-704; it is the orchestrator's file.
   - Evidence: STANDARDS.md line 87: `fonts/*.woff2`. check-layout.mjs diff: `public/fonts/{*.woff2,LICENSES.md}`. Confirmed by reading.

3. `workspace/05-plans/B9.md` (not blocking)
   - What: Stale plan line. The shoot.mjs Files entry says the fixture images are "files under src/assets/gallery/", but the fixture's hero is src/assets/los-altos.jpg. Step 6's shoot.mjs must read the paths from the fixture as written, not assume the gallery folder.
   - Evidence: app/src/templates/social/fixtures/property.fixture.json images[0].path = "src/assets/los-altos.jpg". The plan-brief Files list for scripts/lib/shoot.mjs says the images are under `src/assets/gallery/`. Confirmed by reading.

Two follow-ups on GOTCHAS.md are banked as P-709 and P-710, not listed here.

## g4 · steps 4,5

1. `app/tests/unit/assets/carousel-plan.test.ts` (not blocking)
   - What: No test pins planCarousel(spec, 7). The plan says the planner chooses 6 to maxSlides slides, and 7 is a valid render_carousel max_slides value. The tests check only 6, the default 8 and out-of-range values. If the place adjustment in the photo count regresses, a recipe with max_slides 7 posts 8 slides and every test stays green. The current code is correct (it returns 7). This is a coverage gap, not a present misbehaviour, so it is a follow-up. Fix: add a case where (12, PLACE) with max_slides 7 has length 7, plus a registry entry.
   - Evidence: Confirmed by running: watchfail single mutation at slides.ts:54, `maxSlides > MIN_SLIDES + (withPlace ? 1 : 0) ? 4 : 3` changed to `maxSlides > MIN_SLIDES ? 4 : 3`, gave 'WATCHED-FAIL BAD: stayed green (src/templates/social/slides.ts)'.

2. `app/src/templates/social/NewsletterBlock.tsx` (not blocking)
   - What: NOT DONE (and so is the standalone.tsx property block). The orchestrator's brief listed only the standalone block as blocked on B5. The author also left NewsletterBlock unbuilt, because the plan requires its colours to come from B5's src/templates/theme.gen.ts, which is not on main. That dependency is real (B5 step 1 owns gen-theme.ts and theme.gen.ts). The orchestrator has to schedule NewsletterBlock, newsletter-block.test.ts and the renderTemplate case in templates.test.ts after B5 steps 1 and 3 merge.
   - Evidence: Confirmed by running: `git ls-tree -r origin/main --name-only | grep theme.gen` prints nothing; B5.md line 161 has step 1 creating theme.gen.ts. The B9.md log under 'g4 · steps 4,5' records it as BLOCKED on B5.

3. `app/src/templates/social/facts.ts` (not blocking)
   - What: A new file the plan does not name. Its folder-map row (STANDARDS 1.3, src/templates: '`social/`: Pascal `.tsx` (B9 names)') covers neither its name nor its kind. The author declared it in the log and gave a reason (shared lines for four templates, jscpd, R43), and check-layout passes. slides.ts, which the plan names, sets the same precedent. The orchestrator should widen the row to allow kebab `.ts` helper modules in social/ (C03).
   - Evidence: Suspected by reading: STANDARDS.md line 69, naming column. `bun run layout` passed in the check run.

4. `app/tests/unit/assets/templates.test.ts` (not blocking)
   - What: Minor test weaknesses. (1) The 'carry no em dash, no colour value and no inline style' scan covers Cover, Story and the carousel slides but leaves out OgCard. (2) In carousel-plan.test.ts, the it.each title 'plans 6 to 8 slides for $count images' is the same for the with-place and without-place cases, so a red line does not say which one failed.
   - Evidence: Suspected by reading: templates.test.ts, the final describe builds `all` from Cover, Story and planCarousel slides only. The carousel-plan.test.ts it.each title has no $place.

5. `app/src/templates/README.md` (not blocking)
   - What: The module map lists SocialFrame, social.css, fonts.css and the fixture, but not this group's Cover.tsx, Story.tsx, OgCard.tsx, Carousel.tsx, slides.ts or facts.ts. Nothing in it is false, it is just incomplete. The README is not this group's file, so the orchestrator should fold the rows in.
   - Evidence: Suspected by reading: cat app/src/templates/README.md.

6. `app/src/templates/social/slides.ts` (not blocking)
   - What: Note for step 8. SocialSource and SpecProperty are a second definition of the RenderSpec property and image shape from the Contract, plus an optional `place` that the Contract's RenderSpec lacks (the author flagged this as a plan gap). When step 8 writes RenderSpec in src/server/assets/spec.ts, it should import SpecProperty from slides.ts or replace it, not copy the shape (C05). Step 8's buildRenderSpec must also carry `place`, or the place slide never appears.
   - Evidence: Suspected by reading: B9.md line 13 (RenderSpec property list, no place) against slides.ts lines 1 to 31.

Three follow-ups on GOTCHAS.md are banked as P-711 (the dead planner clamp), P-712 (the vitest worker-start error under load) and a hit-again line on P-008 (backslashes dropped in a heredoc), not listed here.

## g5 · steps 6

1. `app/tests/unit/assets/render-scripts.test.ts` (not blocking)
   - What: The header comment says the render scripts refuse a spec that is not theirs before a browser starts. Only a malformed key_prefix is refused. renderSet in app/scripts/lib/shoot.mjs:302 never compares spec.kind with the script's own kind. So cover.run given {kind:'story', out.key_prefix:'assets/<id>/story/r1/'} would render cover frames and store them under the story folder; the deliver() prefix check passes because the key is built from spec.kind. No product path dispatches a mismatched kind today (the step modules and dispatchHeavy are later groups). Follow-up: either add the guard or correct the comment. Suspected from reading, not run.
   - Evidence: shoot.mjs specSchema kind is z.enum(['cover','carousel','story']) and nothing ties it to the caller. render-scripts.test.ts only asserts rejects.toThrow('key_prefix').

2. `app/scripts/lib/shoot.mjs` (not blocking)
   - What: In upload mode, dataUrl() (line 239) treats any spec image URL that is not http(s) as a path under the app folder and reads it from the runner's disk. The plan says that in upload mode images are fetched from the spec's absolute mediaUrl addresses. A relative URL in a dispatched spec would be read from the local disk without any error. Follow-up: refuse non-absolute URLs outside --fixture. Suspected from reading.
   - Evidence: dataUrl(): `if (/^https?:\/\//.test(url)) {...fetch...} const path = resolve(APP, url)`, with no mode check.

3. `app/scripts/lib/shoot.mjs` (not blocking)
   - What: --fixture builds the RenderSpec inline in runCli, not through buildRenderSpec as the plan says. The author logged why: spec.ts is step 8 and does not exist yet. The CLI must switch to buildRenderSpec when step 8 lands, with `place` carried.
   - Evidence: src/server/assets does not exist in d9e1b7e. runCli assembles {kind, property, images, out} by hand.

4. `app/scripts/lib/shoot.mjs` (not blocking)
   - What: UNPROVEN, as the author declared: upload mode (putIfMissing and the image fetch were only exercised with fetch mocked, and no Storage call was made); Chrome and --no-sandbox on ubuntu-latest; no fetch timeouts. The browser invariants (frame size, fonts, network refusal, not-JPEG) are manual registry entries that CI cannot replay until step 10 runs Chrome in Actions.
   - Evidence: tests/mutations/B9.json manual entries b9g5-cover-viewport, -cover-png, -cover-not-jpeg, -font-missing, -network-refused. The replay prints 'manual 6 not replayed'.

5. `app/scripts/render-carousel.mjs` (not blocking)
   - What: The 1080x1080 LinkedIn square is the top 1080 px of a photo slide. The cover pick carries no headline or price, and the location line sits about 40 px from the bottom edge. The author recorded a proper square format as a g3 follow-up.
   - Evidence: Viewed .tmp/rv1/linkedin-set-0.1b4b06f9.jpg: photograph, then wordmark, '01 / 04' and location only.

The sixth follow-up of the review is on GOTCHAS.md and is banked as P-717 (reading a redirected watchfail replay with `grep -a`), not listed here.

## g6 · steps 7,8

1. `app/src/domain/assets.ts` (not blocking)
   - What: R04/C04: seven exports are used nowhere in src, tests or scripts: assetKindLabels, assetStatusLabels, assetListFilters, AssetListFilters, AssetFile, AssetKind, AssetStatus. knip passes only because the new 'export * from "./assets.ts"' line in src/domain/index.ts (a knip entry) re-exports them. R04 says an export kept for a later slice carries /** @public */ and a STUB marker, and none of these do, so the stubs gate will never flag them if service.ts and the admin screens never arrive. The content itself is what plan step 7 asks for.
   - Evidence: for n in assetKindLabels ... AssetStatus; grep -rlw $n src tests scripts | grep -v src/domain/assets.ts → empty for all seven; git diff origin/main...HEAD -- app/src/domain/index.ts adds the barrel line; the author's log says the line 'is what keeps knip from calling its exports unused'

2. `app/supabase/sql/functions/approve_asset.sql (also reject_asset.sql, rerender_asset.sql, set_asset_caption.sql)` (not blocking)
   - What: R21/R05: these functions insert into audit_log directly because B7's write_audit does not exist yet. That gap is admitted, but no '-- STUB(B7 ...)' line marks the place, unlike B8b's '-- STUB(B8b step 6)' precedent. Also, scripts/stubs.ts cannot see SQL markers at all (P-1600). So when B7 lands nothing tracks moving these four functions onto write_audit and its actor, disabled and role checks.
   - Evidence: grep -rn STUB supabase/sql/functions/*.sql lists only the seven automation_* B8b lines; grep -rln 'insert into public.audit_log' supabase/sql/functions includes approve_asset, reject_asset, rerender_asset, set_asset_caption

3. `app/src/server/jobs/steps/render-variants.ts` (not blocking)
   - What: R09 (follow-up): lines 163 and 196 throw a plain Error ('render_variants: no result for <id>') in server code, not an AppError or NonRetryableError. A callback whose result lacks a signed media id therefore fails as retryable and re-dispatches the whole batch until max_attempts. It writes nothing before throwing (tested), so no data is at risk. B8's dispatch.ts has the same pattern.
   - Evidence: grep -rn 'throw new Error' src/server → render-variants.ts:163, :196 (plus B8's dispatch.ts:52, selftest.ts:17)

4. `app/src/server/jobs/steps/render-specs.ts` (not blocking)
   - What: This stand-in for B8b step 2 (marked STUB) sits in jobs/steps/, where the folder-map row allows one file per step type, and render-specs is not a step type. Its specs declare maxAttempts but no timeoutMs, which R27 requires once they move to step-specs.ts. When B8b step 2 lands, the file should be deleted and timeoutMs added.
   - Evidence: cat src/server/jobs/steps/render-specs.ts: heavy, maxAttempts 12, paramsSchema; no timeoutMs; marker '// STUB(B8b step 2)'

5. `app/tests/unit/assets/steps.test.ts` (not blocking)
   - What: The test titled '$type runs twice without a second outside effect' (line 319) checks that the second run makes a second render.yml dispatch identical to the first. So the outside effect (an Actions run) does happen twice. No second upload happens only because downstream keys are content-hashed and putIfMissing skips existing keys, and this test does not exercise that. The title overstates what is proven (R28/HO-7).
   - Evidence: steps.test.ts:333-336: run twice, then expect(second).toEqual(first) on dispatchedJob(spy, 0) and dispatchedJob(spy, 1)

6. `app/src/server/jobs/steps/render-variants.ts` (not blocking)
   - What: NOT DONE, as the author recorded: the request_property_render call when a claim returns 40 rows, and its unit case, are missing. Until B7 lands, a property with more than 40 staged photographs gets only the first 40 rendered; the rest wait for another attach to queue a job. Marked '// STUB(B7 step 8)'. I confirmed request_property_render is not on origin/main (00f1d80).
   - Evidence: git grep -l request_property_render origin/main -- app/supabase app/src/db/types.ts → nothing; render-variants.ts:139 STUB line

7. `workspace/05-plans/B9.md (orchestrator to fold)` (not blocking)
   - What: Plan text and code differ, as the log records. upsert_asset_stub moves job_id to the new job only on a pending row (plan: coalesce(p_job_id, job_id) always), and when every revision is rejected it starts revision n+1 (plan: 'else 1'). approve_asset keeps the old og_image_key when a cover has no main file. All three are reasonable and documented, but the plan line is now stale.
   - Evidence: supabase/sql/functions/upsert_asset_stub.sql lines with 'filter (where a.status <> 'rejected'), max(a.revision) + 1' and 'v_row.status = 'pending''; log block 'Decisions and plan gaps'

8. `(B2) property_media_bump_catalog_version` (not blocking)
   - What: P-719 is open for B2: every claim_media_for_render, apply_media_variants and clear_media_staging bumps catalog_version, which invalidates the public cache. A claim alone changes no public column, so one render_variants run causes three cache-key bumps.
   - Evidence: GOTCHAS P-719 symptom and cause, reproduced by the two-connection claim test passing only with the Lock-wait poll

9. `UNPROVEN (no file)` (not blocking)
   - What: Still UNPROVEN: the plan's CI db job (ci.yml has none until B4) and the type-drift check of src/db/types.ts on an ephemeral stack. Also unproven: a render in Actions with real Chrome and fonts, render_variants and render_og_static running to done, and the settings row og_static (waiting on B8 step 7's dispatch token).
   - Evidence: gh pr checks 117: no db job; the og-static jobs I enqueued stayed queued and were cancelled

The tenth follow-up of the review is on GOTCHAS.md (P-718's proof names a port, not the data directory) and is banked as P-726, not listed here.

## g7 · steps 9

1. `app/src/server/jobs/steps/write-captions.ts` (not blocking)
   - What: An editor's caption can still be overwritten in a short window. typedByHand (lines 49-63) reads caption_lint once, then the loop (lines 124-144) calls set_asset_text for up to six kinds one after another over the network. An editor who saves through set_asset_caption between that read and a given kind's write loses the caption. For the last kind the window is several round trips (about 0.5 s against the cloud), not 'milliseconds'. The plan says such a kind is 'never overwritten'. A full fix needs a caption_lint = 'edited' guard inside set_asset_text, which is g6's SQL, not a file of this group. Reading the row again for each kind inside the loop would narrow the window further.
   - Evidence: Found by reading write-captions.ts:123-143. The author lists it under unproven and in P-727 as a follow-up for g6. It is not yet in workspace/05-plans/logs/B9-followups.md: grep for set_asset_text there prints nothing.

2. `workspace/05-plans/logs/B9.md` (not blocking)
   - What: The g7 rework's Proof 2 line says 'Tests 135 passed (135)'. Running the same command on head 6263aa7 gives 136. The pass claim holds and only the count is stale, probably from a run before the last test was added.
   - Evidence: bunx vitest run --project unit tests/unit/assets/captions-runner.test.ts tests/unit/assets/steps.test.ts tests/unit/automation/step-specs.test.ts tests/unit/assets/voice.test.ts tests/unit/assets/captions.test.ts tests/unit/assets/links.test.ts -> 'Tests 136 passed (136)'

3. `app/tests/unit/assets/steps.test.ts` (not blocking)
   - What: The rework rightly removed a self-proving assertion (it checked the fixture's status, not the step's output) and renamed the case to 'Campaign creates both, with the same block'. As a result, the plan proof clause 'Campaign creates both, the standalone pending' and the Verification line 'steps.test.ts asserts every row a B9 step creates has status pending' are now proven only at the SQL layer (assets.db.test.ts, upsert_asset_stub). No unit case in steps.test.ts covers them. The plan line should be updated to name the db test.
   - Evidence: git show 6263aa7 -- app/tests/unit/assets/steps.test.ts; grep -n pending tests/unit/assets/steps.test.ts shows only the variants_pending and revision cases

4. `app/tests/unit/automation/step-specs.test.ts` (not blocking)
   - What: This plan proof file does not exist on the branch (it comes from B8b step 2). Vitest skips a missing path without any message, so the author's proof command exits 0 and looks green even though that part checks nothing. Re-run the proof once B8b lands. newsletter-block.test.ts is also missing; it waits on B5 step 1 and is already in the follow-ups.
   - Evidence: ls tests/unit/automation/ -> 'No such file or directory'; the vitest command still exits 0 with 5 files

5. `app/src/server/assets/voice.ts` (not blocking)
   - What: These follow-ups carry over from the author's own list and none blocks. usage.input_tokens counts only uncached input, so B14 will under-count. alt_text and slide_alts are not linted for em dashes or banned words. The .slice(0, 25) in captions-runner.ts repeats .limit(25), and the fake database ignores limit. The render-hook 299 s flake is in B8's file (P-729).
   - Evidence: The author's unproven list. Reading voice.ts:142-189 shows lintCaption is applied only to the three caption variants.

## c9m · steps 7

1. `workspace/05-plans/logs/B9.md` (not blocking)
   - What: UNPROVEN, as the author already admits. Neither the CI migration-order step nor the db job has run on the PR with the renamed files. The local migration-order gate is green against the current origin/main, but if main gains a migration newer than 20261004172322 before PR 117 merges, the same refusal comes back. The log's statement that 'the db job stays the proof' is correct, but that proof has not been seen yet.
   - Evidence: No CI run exists for e6ea262 (brief). Local: node scripts/check-migrations.mjs printed 'migration-order: OK (25 on main, 2 added)' against origin/main as fetched at review time.

## c6u · steps 6

1. `workspace/05-plans/B4.md` (lines 47, 103, 119) and GOTCHAS.md P-730 (not blocking)
   - What: The group exists so that CI's e2e job stops getting 404 on /media/<key>. But B4's plan still seeds the e2e and db jobs with `--images skip`, so no CI job will ever run the upload path this group built. Both the author's UNPROVEN note ('the proof moves to the CI e2e job on main') and P-730's rule ('UNPROVEN until the CI e2e job on main runs the seed') point to a job that, as planned, uploads nothing. No one owns switching B4's e2e seed to `--images upload` (about 87 s more per run, measured here). Until someone does, the 404 that motivated c6u stays.
   - Evidence: grep in B4.md: line 103 says `bun run seed -- --target local --mode full --images skip` for both the db and e2e jobs, and line 47 says 'the seed runs with --images skip ... no Storage bucket of H33 (1) is written'. The ci.yml on origin/main and on this branch has no seed or e2e step yet. Confirmed by reading.

2. `app/scripts/variants.ts` (supabaseMediaRows.setVariants / restoreVariants) (not blocking)
   - What: The update is `.update({ variants }).eq("id", id)` with no match on the `media_key` it read. `stored()` reads every row once at the start, and then each row takes seconds of makeVariants, so on `--all` the window lasts minutes. If an editor replaces a photograph and its render_variants job runs apply_media_variants inside that window, the CLI writes the old photograph's sizes onto the new key. B2's orientation trigger then derives the orientation from the wrong hero. This is the 'never keep another photograph's sizes' rule that apply_media_variants enforces, and STANDARDS C11 requires naming the race partner. Neither is done. Fix: add `.eq("media_key", row.media_key)` to the update and count a row it did not match.
   - Evidence: Suspected by reading app/scripts/variants.ts supabaseMediaRows.setVariants. Not run against a database: this lane may not touch mop-dev (H57).

3. `app/scripts/variants.ts` (supabaseMediaRows.stored) (not blocking)
   - What: The property_media select has no range or pagination. Supabase's PostgREST cap (1000 rows by default) would silently cut `--all` short, and it would still print 'variants stored 1000, failed 0' and exit 0.
   - Evidence: Suspected by reading. The select chain has no .range(). Not run against a real table, and the author lists --property/--all against the real table as UNPROVEN.

4. `app/scripts/seed.ts` main() and `app/scripts/lib/storage-env.ts` (not blocking)
   - What: No test or run covers the wiring that points media-store at the seeded project (projectOf, then useForMediaStore). If `useForMediaStore(project)` were deleted, every test would stay green, and uploads would go to whatever SUPABASE_URL the shell holds. GOTCHAS line 1272 records that the dev profile shell does hold another project's URL. The author's fake-Storage run and mine both set SUPABASE_URL directly and skipped main(). UNPROVEN.
   - Evidence: Read: main() calls useForMediaStore(project) before runSeed, so the code is right today. No test imports storage-env.ts or calls main().

5. `app/scripts/variants.ts` main() (not blocking)
   - What: The CLI writes property_media on the one database but calls neither guardEnv() (SEC-08) nor holdDevLock() (G34). The seed and og-static, which write to the same project, call both.
   - Evidence: grep 'guardEnv()' app/scripts finds api-smoke, dev-vars, job-selftest, og-static, seed and set-environment, not variants.ts. Confirmed by running grep.

6. `app/docs/coming-soon.md:56` (not blocking)
   - What: Stale line, not this group's file: 'The `upload` mode needs B9's media store and refuses until B9 has landed.' On this branch the upload mode runs and does not refuse. The group fixed the matching line in docs/runbooks/database.md but missed this one.
   - Evidence: Grep for '--images upload' across the snapshot found this line. Confirmed by running grep.

7. `workspace/05-plans/B2.md:102` and the B9 Files entry for scripts/lib/media-store.mjs (not blocking)
   - What: Stale plan text. It says the media store is loaded only lazily through a non-literal specifier and that B2's code never imports it statically. variants.ts now imports it statically, which is correct now that the file exists (the old reason was that tsc could not resolve a missing file). No src/ or Deno file imports variants.ts: the src mentions are comments only.
   - Evidence: grep 'scripts/variants' in src finds only comment lines in spec.ts:94 and mappers.ts:194. bun run build exit 0.
