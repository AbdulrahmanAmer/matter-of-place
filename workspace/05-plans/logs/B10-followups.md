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
