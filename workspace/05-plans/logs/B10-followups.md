# B10 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 0

Reviewer's follow-ups, none blocking, recorded word for word with their evidence. The first one (GOTCHAS.md) is banked as P-2203 and corrected in P-2200.

### app/scripts/lib/oauth-consent.ts

- what: When the consent is refused (the redirect carries `error=access_denied` with the right state), waitForCode rejects correctly. The owner's browser is still shown 200 `Connected. You can close this tab.`, which tells the owner the opposite of what happened. The script prints the real error, so nothing is stored. Only the browser text is wrong.
- evidence: scratch probe: fetch 127.0.0.1:8765/callback?state=S3&error=access_denied printed `refused 200 consent refused: access_denied` (confirmed by running)
- blocking: false

### app/scripts/x-authorize.ts

- what: Owner setup B item 2 has a fallback for when X refuses a loopback callback: paste the `code` into the script's prompt. The script has no such prompt. The author says so in docs/runbooks/social.md ('add one before relying on it'), so it is not a false statement. It is a known gap for step 3a, and it only matters if X refuses 127.0.0.1, which is UNPROVEN.
- evidence: workspace/05-plans/B10.md line 92 ('paste the code ... into the script's prompt'); x-authorize.ts has only waitForCode (read)
- blocking: false

### app/src/server/channels/index.ts

- what: The plan gives `getChannel(name)`, with the registry itself returning the disabled block for a row with enabled=false. The code is `getChannel(name, enabled)`, so the caller reads the row. The log discloses this. Steps 5 and 6 must keep it in mind (every caller must pass the row's real `enabled`), or the plan line should be folded to match.
- evidence: index.ts `export function getChannel(name: SocialChannel, enabled: boolean)` vs B10.md line 117 (read)
- blocking: false

### app/scripts/x-limits-check.ts

- what: x-limits-check --i-mean-it posts a real tweet with whatever token Vault (x_oauth_token) or .env holds, and does not call assertNotProduction. Before the launch switch that is the test handle. After the switch, Vault holds the brand handle's token, so a rerun would put 'Test post <timestamp>' on the brand account. The plan names this script as a step 3a measurement only and does not ask for the guard. This is a suspicion from reading, for L1 or step 3a to decide.
- evidence: x-limits-check.ts main(): no assertNotProduction import; token = get_vault_secret('x_oauth_token') ?? X_ACCESS_TOKEN (read)
- blocking: false

### app/scripts/lib/social-script.ts

- what: The plan says the scripts read secrets 'with the E10 loader' (scripts/load-env.mjs). readSecret instead parses the root .env directly, after checking the shell first. This copies the existing pattern in scripts/resend-domain.ts, so jscpd stays quiet. The dev profile in load-env.mjs does not allow-list META_*, X_* or LINKEDIN_*. This is a deviation from the plan's wording, not a leak. No such names are set in this shell, and no value is printed.
- evidence: social-script.ts readSecret(); load-env.mjs dev profile names (read)
- blocking: false

## g2 · steps 1-3b

Reviewer's follow-ups, none blocking, recorded word for word with their evidence. The two that concern GOTCHAS.md are banked as hit-again lines of P-152 and P-706 (the bank's rule: a lesson it already holds gets a "hit again", not a new entry).

### app/tests/unit/channels/reels-limits.test.ts

- what: Follow-up. The REEL constants are copied into the test, as plan step 3 asks. render-reel.mjs already exports MAX_BYTES and holds W, H and FPS as module constants. If B12 changes the reel (for example FPS to 24 or a longer duration), this test stays green while the probe and the limits drift apart. The test only checks the copied numbers against reels-limits.json, not what render-reel.mjs actually enforces. The plan allows this, so it is a note for B12 or a later step, not a fault in g2.
- evidence: render-reel.mjs:23-27 and :110-116 vs reels-limits.test.ts:5-13 (read, values equal today)
- blocking: false

### app/src/domain/channels.ts

- what: Follow-up, orchestrator to fold. The plan placeholder v23.0 is still the example in the Account ids form's validation message ('Use a version such as v23.0', channels.ts:57, a g1 file). B10.md line 17 still calls v23.0 the placeholder. The runbook now records v26.0 as the version to enter. The message is still valid, just stale.
- evidence: git grep -n v23 shows app/src/domain/channels.ts:57, tests/unit/channels/ids.test.ts:7-8, workspace/05-plans/B10.md:17
- blocking: false

## g3 · steps 4

Reviewer's follow-ups, none blocking, recorded word for word with their evidence. None concerns a file of the bank, so no new gotcha entry was needed; the two that already have one are named (P-2204, P-2205).

### app/src/server/channels/meta-errors.ts

- what: Suspected by reading, not run. GRAPH_ERROR_TABLE has no row for the Instagram and Page Business Use Case rate-limit codes (80001, 80002 and the rest of the 800xx family). If Meta answers one of these without is_transient and with a 4xx status, the classifier returns non_retryable, so the post fails at once instead of moving inside the window. The plan names only 4, 17, 32 and 613, which are all covered.
- evidence: In the table at meta-errors.ts lines 13-26, any unlisted code with status < 500 and no is_transient falls through to non_retryable. At about 2 posts a day a BUC limit is unlikely, and this is UNPROVEN until step 7 records live errors.
- blocking: false

### workspace/05-plans/STANDARDS.md

- what: R34 says each adapter classifies errors 'through an exported error table'. GRAPH_ERROR_TABLE is deliberately file-local because knip (R04) refuses an export nothing imports. R34's wording is stale. The conflict is banked as P-2204; the fold is the orchestrator's job.
- evidence: grep -n 'exported error table' workspace/05-plans/STANDARDS.md shows line 238; meta-errors.ts line 13 is 'const GRAPH_ERROR_TABLE' with no export.
- blocking: false

### app/src/server/jobs/system/meta-token-refresh.ts

- what: Not g3's file. B8's refresh job keeps its own copy of the Vault-first, env-second token read (lines 72-74: get_vault_secret, then ctx.env META_PAGE_TOKEN) instead of importing getMetaToken. The same rule now lives in two places, and they can drift: the B8 copy maps the error through its own unavailable() helper and returns undefined rather than throwing.
- evidence: grep -n 'get_vault_secret\|META_PAGE_TOKEN' app/src/server/jobs/system/meta-token-refresh.ts shows lines 72-74, and its comment line 8 says 'reads the token as B10's getMetaToken does'.
- blocking: false

### app/src/server/assets/service.ts

- what: Not done, waiting for B9, and stated honestly by the author. The mayApprove call in approveAsset (403 human_approval_required) and its case in tests/unit/assets/service.test.ts do not exist. The step 4 proof ran 6 of its 7 named files. human_approval_required is not in error-codes.ts yet.
- evidence: The vitest proof prints 'Test Files 6 passed (6)'. The author's own git ls-tree note says origin/main has no app/src/server/assets/service.ts.
- blocking: false

### app/src/server/channels/enable-guard.ts

- what: Recorded follow-ups, unchanged. (1) new_channels is read through getFlags, which is memoised for CATALOG_VERSION_TTL_MS (default 15 s), so a flag switched on is seen up to 15 s late. (2) For x and linkedin the guard checks only the id and token_checked_at. record_channel_check moves token_checked_at only on 'ok', so a 'dead' check within 48 h of an 'ok' one does not block enabling. The plan does not require token_state for x and linkedin.
- evidence: enable-guard.ts NEEDS sets tokenState: false for x and linkedin. Both points are in the g3 log under 'Decisions the plan left open'.
- blocking: false

### app/src/server/channels/meta-metrics.ts

- what: Unproven against the live API. META_METRICS and the Graph error classifications were tested only against fixtures the lane built from Meta's documentation (media-insights.json has source 'docs'), not against a live answer. They stay unproven until step 7 records a real insights response and the first case is tightened to 'every name in the answer is a table name' (P-2205).
- evidence: tests/fixtures/graph/media-insights.json has "source": "docs" and includes total_interactions, which has no field.
- blocking: false

## g4 · steps 5

Reviewer's follow-ups, none blocking, recorded word for word with their evidence. The one that concerns GOTCHAS.md is banked as P-2209 and a hit-again line on P-008.

### app/src/server/channels/meta.ts

- what: Suspected by reading, not run: findRecentPost calls media_publish when a stored container answers FINISHED (settleContainer, line 348). Plan invariant 2 says the reconcile job 'adopts a match or records outcome_unknown, and it never publishes'. If reconcile-social.ts calls this adapter's findRecentPost as it stands, a FINISHED container older than one hour would be published from the reconcile job. The adapter has no lookup-only path. The plan places publish-on-FINISHED inside findRecentPost's flow, so the tension is in the plan. The reconcile group needs to resolve it, and the orchestrator should fold it into the plan.
- evidence: meta.ts:340-350 (settleContainer: FINISHED -> publishContainer); meta.ts:442-449 (findRecentPost -> settleContainer). Plan B10 invariant 2, last sentences on the reconcile job.
- blocking: false

### app/src/server/channels/meta.ts

- what: Suspected by reading, UNPROVEN until step 7: the PUBLISHED adoption reads GET /{ig-user-id}/media. As far as I know, Instagram lists stories under /{ig-user-id}/stories, not /media. A crashed story container that answers PUBLISHED would then get not_found and end as outcome_unknown, never adopted. The plan names /media for every kind, so this is a plan line to check against the live API in step 7.
- evidence: meta.ts:284-297 adoptInstagramMedia; fixture media-list.json is docs-made with hand-added fields (source 'docs').
- blocking: false

### app/src/server/channels/meta.ts

- what: The live switch differs from the plan wording. Invariant 5 says the adapters 'return the dry-run answer' when liveSideEffects('social') is false. graph() (line 150-156) throws AppError('server') instead, because PublishResult in types.ts has no dry-run variant. No write leaves either way, so the safety property holds. The post-to-channel group must know that this throw is a retryable 'server' error, not a result. The plan line should be folded.
- evidence: meta.ts:150-156; types.ts PublishResult = posted | in_progress | skipped_disabled; the 'sends no write call when ...' tests expect code 'server'.
- blocking: false

### app/tests/unit/channels/meta.test.ts

- what: No test proves that every Graph call passes ctx.signal, which the plan's Files line for meta.ts requires ('every call passes ctx.signal'). With the signal replaced by undefined, all 34 tests stay green. The eslint selector only checks that an init with a signal key exists.
- evidence: node scripts/watchfail.mjs --file src/server/channels/meta.ts --find "const signal = session.ctx.signal;" --replace "const signal = undefined;" --run "bunx vitest run --project unit tests/unit/channels/meta.test.ts" --expect FAIL -> 'WATCHED-FAIL BAD: stayed green'
- blocking: false

### workspace/05-plans/logs/B10.md

- what: The g4 log says check-gotchas prints 42 path entries, above the limit of 40, and calls that 'not this group's'. This group's G-1000 is a path entry and took the count from 41 to 42. The bank was already over the limit, but the log leaves out this group's share. The orchestrator should retire or merge a path entry.
- evidence: check-gotchas: OK (42 path entries ...); GOTCHAS.md:31 'Keep under 40 live G entries'; the author's own report: 'it was 41 before G-1000'.
- blocking: false

### app/src/server/channels/meta.ts

- what: health() shows a misleading detail. A red token (token_state 'dead', or settings.meta never filled) still reads 'The token expires on <date>.' or 'The token does not expire.' The level is right; the words contradict it.
- evidence: meta.ts:462-471. The test 'reports the token health from settings.meta' checks only state: 'red' for a dead token.
- blocking: false

### app/src/server/channels/index.ts

- what: Note for the post-to-channel group: getChannel returns Channel, so publish's onContainer argument and findRecentPost (MetaChannel only) are not reachable through the registry without a typed path. That group needs one, without casting.
- evidence: index.ts getChannel(): Channel returns adapter(); meta.ts:51-58 MetaChannel extends Channel.
- blocking: false

### workspace/05-plans/B10.md

- what: Plan line to fold. The Files line for meta.ts lists debug_token, but meta-token.ts and Outputs say Meta health only reads what B8's meta_token_refresh stored. The author declared debug_token not done and also left alt_text unsent. The plan should say which is meant.
- evidence: plan-brief Files list, meta.ts line ('... findRecentPost, debug_token, error classification ...') vs the meta-token.ts line ('never calls Graph itself').
- blocking: false

## g5 · steps 5a

Reviewer's follow-ups, none blocking, recorded word for word with their evidence. The sixth (GOTCHAS.md, the snapshot create step's run time) is banked as P-2211.

### app/src/server/channels/oauth-tokens.ts

- what: Found by reading, not by running. Two runs can refresh the same X token at the same moment (two post_x jobs, or a post beside the daily check). X rotates refresh tokens, so the second request gets invalid_grant. If its Vault re-read (line 278) happens before the first run's store_channel_token has committed, Vault still holds the refresh token that was sent. That run then marks the token dead: settings.x.token_state becomes dead, the admin gets a 'X needs to be reconnected' alert, and the post fails token_dead, even though Vault holds a good new set a few milliseconds later. This matches the plan's wording, so it is not blocking. It could be closed by doing for invalid_grant what the code already does for busy and stale: wait 2 seconds, read Vault again, and only then call the token dead.
- evidence: oauth-tokens.ts lines 275-281: `if (failure.reason === "invalid_grant") { const current = await readStored(...); if (current !== null && current.refresh_token !== sent) return fresh(current); } throw await refused(...)`. The re-read happens at once, with no wait.
- blocking: false

### app/src/server/channels/x-errors.ts

- what: Found by reading; the API shape is UNPROVEN. resetAt takes the latest of x-rate-limit-reset, x-user-limit-24hour-reset and x-app-limit-24hour-reset. If X sends the 24-hour headers on every write, a 429 from the 15-minute window would wait for the 24-hour reset, which can be hours later. The code does not read any `-remaining` header to tell which limit was hit. Step 3a should record a real 429 and pick the reset header from it.
- evidence: x-errors.ts lines 11-15 and 27-31. The fixture tests/fixtures/x/rate-limited.json has a 15-minute reset of 12:15Z and a 24-hour reset of 18:00Z, and x-errors.test.ts expects 18:00Z.
- blocking: false

### app/src/server/channels/x-errors.ts

- what: Already declared UNPROVEN by the author. A dead token is recognised only when X answers with `error: invalid_grant` (or a 401). If X's token endpoint answers a dead refresh token with a 400 carrying another error code, such as invalid_request, classifyXError returns non_retryable. Then nothing is stored, health does not turn red, and no reconnect alert is sent. The only sign would be the failed post. Step 3a should record X's real answer to a dead grant and the classifier should follow it.
- evidence: x-errors.ts lines 51-58: only `problem?.error === "invalid_grant"` or status 401 gives token_dead; any other 4xx gives non_retryable. tests/fixtures/x/invalid-grant.json has source "plan".
- blocking: false

### app/tests/unit/channels/linkedin.test.ts

- what: Two parts of the code have no test. (1) The statistics query uses `ugcPosts=List(...)` for a urn:li:ugcPost id. Only the share id is tested, so that branch can be removed with every test still green. (2) Every request in oauth-tokens.ts passes `signal: ctx.signal`, as R27 and R32 require, but nothing tests it. Removing it from callApi leaves every channel test green. The g4 review raised the same gap for Graph.
- evidence: Confirmed by running the two watchfail probes listed under reran: both printed `WATCHED-FAIL BAD: stayed green`.
- blocking: false

### app/docs/runbooks/social.md

- what: Not this group's files. Two places still describe step 5a as missing. social.md line 66 says `--check` waits for oauth-tokens.ts (step 5a). scripts/lib/oauth-consent.ts lines 164-165 carry `STUB(B10 step 5a)` and print `check is built with oauth-tokens.ts (step 5a)`. oauth-tokens.ts now exists, and the log (B10.md line 185) says --check waits for step 6's generated types. The runbook line and the STUB marker should both name step 6.
- evidence: grep -rn "STUB(B10 step 5a)" app/scripts app/docs gives oauth-consent.ts:164; sed -n 66p app/docs/runbooks/social.md gives "`--check` is not built yet. It needs `oauth-tokens.ts` (step 5a)".
- blocking: false

### app/src/server/channels/oauth-tokens.ts

- what: Two smaller points. (1) When X or LinkedIn posting is switched off (liveSideEffects false), callApi throws AppError("server") instead of returning the dry-run answer the plan's invariant 5 describes. meta.ts does the same, and the g4 follow-up already records it; it should be settled for all three adapters at once in step 6. (2) recordXRead adds one read per callApi call, but a 401 followed by a refresh and a resend makes two GETs, so settings.x.usage counts one read too few each time that happens.
- evidence: oauth-tokens.ts lines 354-360 (the throw) and lines 368-373 (the second attempt, then one recordXRead).
- blocking: false

## g6 · steps 6

Reviewer's follow-ups, none blocking, recorded word for word with their evidence. None names GOTCHAS.md, so no gotcha entry is added; the cost the third one mentions is already banked as P-2216.

### app/src/server/channels/post-to-channel.ts

- what: X and LinkedIn write their inflight marker before the create call (lines 473-486), and onFailure never clears it (lines 316-359). So when the create call is plainly refused with a 429 or the free-tier write limit (class retry_at, meaning no post was made), the next run finds the marker. It waits 2 minutes, then looks the post up, finds nothing and fails the row as outcome_unknown with a social_failed alert. As a result, x.ts's mapping of 429 to retry_at never gives an automatic retry. Nothing is posted twice, but on a day X rate-limits, every X post needs a person to press Retry. The plan text produces this outcome, so it belongs to the plan owner. The author already listed it as a follow-up.
- evidence: Found by reading: resolveMarker lines 376-385 turn an old inflight marker with no match into not_found, and line 469 turns that into fail(run, 'outcome_unknown', true). No test covers a create refused after the marker was written.
- blocking: false

### app/src/server/jobs/steps/render-cover.ts

- what: onResult now calls maybeAutoApprove, and the same holds for render-carousel.ts and render-story.ts. That adds 1 to 5 database calls plus fanoutEvent's calls to the render callback. STANDARDS R60 caps a render callback at 5 calls (JOB-03). The render-hook budget test cannot see the extra calls, and tests/unit/assets/steps.test.ts mocks maybeAutoApprove out. A second effect: src/server/hooks/render.ts lines 73-80 fail the render job when onResult throws. A transient read error inside maybeAutoApprove, or the auto_approve_asset RPC raising because a person approved first, now fails a render whose files were already stored, and B8 re-runs it. The plan orders these call lines, so the conflict is the orchestrator's to settle. The author already listed it.
- evidence: Found by reading: the render.ts lines above; render-hook.test.ts:291 asserts at most 5 calls with a fixture onResult. In auto-approve.ts the eligible path makes 1 assets read, then properties, settings and channel_settings, then the auto_approve_asset RPC, then fanoutEvent.
- blocking: false

### app/tests/mutations/B9.json

- what: CI did not replay the six rebuilt approve_asset sql entries. Run 37585086451's `watchfail --changed origin/main` selection never names b9g6-approve-event, -agent, -not-pending, -og-cover, -og-none or -auth-approve_asset. Their only red-for-the-right-reason proof is the author's mop-dev stand-in. I confirmed statically that each is a one-line mutation of the current five-parameter file, so they look right, but the CI selection misses a changed registry entry whose test file did not change. P-2216 records the symptom, but no rule makes CI select changed entries.
- evidence: grep -oE 'B9:[a-z0-9_-]+' on the db job log of run 37585086451 lists only b9g6-approved-*, -og-pages, -og-result, -og-twice and b9g7-*, none of the six.
- blocking: false

### app/src/server/channels/post-to-channel.ts

- what: notifyAdmin passes `env: readVar("MOP_ENV") ?? "production"` (line 128). The plan says `env: readVar("MOP_ENV")`, so a runner without MOP_ENV tags its Sentry alerts as production. The author already listed this follow-up ('the MOP_ENV default'), together with the dry-run log carrying ids instead of the request payload (line 445).
- evidence: Found by reading line 128 and line 445.
- blocking: false

### app/src/server/automation/service.ts

- what: NOT DONE, and stated honestly: the putChannelSettings and restoreRevision assertMayEnable lines, their tests/unit/automation/service.test.ts cases, and B9's approveAsset passing evidence all wait for service files that origin/main does not have. Until they land, approve_asset's evidence path is only reached through auto_approve_asset.
- evidence: git ls-tree origin/main app/src/server/automation/ app/src/server/assets/ lists no service.ts.
- blocking: false

## g2 · steps 1-3b

Second review round of the group (a fresh reviewer on the frozen snapshot), recorded word for word with their evidence. The two that concern GOTCHAS.md are banked as P-2405 and P-2406. The reels-limits constants and the v23.0 text also appear in the first g2 block above.

### app/tests/mutations/B10.json

- what: Follow-up, not blocking. Five fields of reels-limits.json have no watched-fail entry: aspect.min/max, max_width_px, fps.min and audio_codecs. The four tests do assert them, and changing aspect.max to 0.5 would turn the test red, but no registry entry proves it. Separately, the REEL constants in the test copy render-reel.mjs's W, H, FPS and MAX_BYTES (the plan asks for constants in the test). If B12 changes FPS, this test stays green without noticing.
- evidence: Read: the B10.json entries b10g2-* mutate only video_codecs, fps.max, duration_s.max, max_size_mb and source. scripts/render-reel.mjs:23-27 declares W=1080, H=1920, FPS=30 and exports MAX_BYTES=12_000_000.
- blocking: false

### workspace/05-plans/B10.md

- what: Follow-up for the orchestrator, not blocking. Line 17 of the plan still says 'ASSUMED placeholder v23.0; step 3 replaces it with the newest version', but the runbook now records v26.0. The hint text in src/domain/channels.ts:57 ('Use a version such as v23.0', a g1 file) also still names v23.0. Neither line is false, but the plan line is stale.
- evidence: git grep -n 'v23.0' gives only src/domain/channels.ts:57, tests/unit/channels/ids.test.ts and workspace/05-plans/B10.md:17
- blocking: false
