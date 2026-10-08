# B8 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 1,2

1. `app/tests/db/jobs.db.test.ts` (not blocking)
   - What: No test calls job_queue_read, yet trace.json (id job_queue_read) names tests/db/jobs.db.test.ts as its proof. A swapped vt/qty argument or a broken job_id cast in the wrapper would pass every gate of this group. I proved its behaviour by hand on mop-dev with real pgmq 1.5.1 (first read 1 row, second read hidden), but that proof is not in the suite. The step's proof list does not ask for a read case, so this is a follow-up: add one, or let step 4/6's committed queue case cover it.
   - Evidence: grep -c job_queue_read app/tests/db/jobs.db.test.ts -> 0; trace.json entry {"id":"job_queue_read","files":[...,"tests/db/jobs.db.test.ts"],"hasProof":true}

2. `workspace/06-architecture/architecture.md` (not blocking)
   - What: Stale line, not this group's file. Line 112 (and trace.json id job_queue_archive) still lists `job_queue_archive` as a B8 function of <ts>_jobs.sql. The B8 plan line 143 says 'no archive wrapper: nothing is archived, JOB-10', and the migration correctly creates none. This is for the orchestrator to fold.
   - Evidence: grep -n job_queue_archive workspace/06-architecture/architecture.md workspace/05-plans/trace.json -> architecture.md:112, trace.json id job_queue_archive

3. `workspace/05-plans/B8.md` (not blocking)
   - What: Stale plan line, which the author declared: step 2 marks the reaper re-send case and the p_local case 'committed mode', but both run in withRollback. The reason holds: pgmq tables are transactional, and a committed reap_stale_jobs would act on every real job of mop-dev. The orchestrator should fold this into the plan.
   - Evidence: jobs.db.test.ts lines 234-258 and 566-585 use withRollback; logs/B8.md 'Deviation, stated'

4. `app/src/db/types.ts` (not blocking)
   - What: NOT DONE and UNPROVEN, all declared by the author and blocked by rulings H1(a)/S50, not by the code. (1) The migration and the regenerated types do not travel together (R57/C21, G-004), and step 1's proof needs `bun run check` green with them. (2) The CI db job is green on the PR. (3) Re-apply after db:reset on a real stack (I proved it only on a stub cluster). (4) The PostgREST `or` filter on job_event_entity_id returns 200. (5) The committed parallel claim on a real stack: red on mop-dev now with relation public.jobs does not exist. (6) createJob and the seven dataset jobs (B4 factories.ts is not on main). Each must be closed before or at merge, or recorded by the orchestrator.
   - Evidence: git ls-tree origin/main app/tests/fixtures/ has no factories.ts; mop-dev: to_regclass('public.jobs') is null; the full-file mop-dev run reproduces 'Tests 1 failed | 27 passed (28)'

5. `app/supabase/migrations/20261003185349_jobs.sql` (not blocking)
   - What: C11 (every new job query names the index that serves it), found by reading, not run. enqueue_job_manual looks up keys with `starts_with(j.idempotency_key, v_prefix)` (line 302). Under Supabase's non-C collation the unique btree on idempotency_key cannot serve a prefix match, so each manual enqueue scans jobs. Manual jobs are rare and jobs_done is pruned at 30 days, so this costs a little time and does not affect correctness. Note it, or add a text_pattern_ops index when step 8 touches the table.
   - Evidence: line 302: where starts_with(j.idempotency_key, v_prefix); indexes created: jobs_status_run_after_idx, jobs_type_created_idx, jobs_event_idx, jobs_admin_list_idx, jobs_admin_status_list_idx, jobs_local_waiting_idx, plus the unique constraint

## g3 · steps 3,4

1. `app/src/server/lib/crypto.ts` (not blocking)
   - What: Stale stub marker. Lines 38-39 still read '/** @public */' and '// STUB(B8): first used by src/server/lib/hmac.ts (signBody, verifyBody)' above toHex. This group's hmac.ts now imports toHex, so the marker describes something that already happened. When B8 is marked closed in PLAN.md, G05 ('bun run stubs') will fail on this line. crypto.ts is not one of this group's files, and the H46 exception does not cover it, so the builder was right to leave it. Someone must still remove it before B8 closes. The log does not mention it.
   - Evidence: Confirmed by running: `bun run scripts/stubs.ts` lists 'src/server/lib/crypto.ts:39 STUB(B8): first used by src/server/lib/hmac.ts (signBody, verifyBody)'. `git diff origin/main...HEAD --stat` shows crypto.ts unchanged, and hmac.ts line 1 imports toHex from ./crypto.ts.

2. `app/src/server/jobs/runner.ts` (not blocking)
   - What: Suspected by reading, not run. Heavy jobs can starve under a light backlog. runOnce drains the light queue first and skips the heavy batch once 40 s have passed (line 265: `if (!pastCutoff(tick)) await runBatch(tick, true, HEAVY_PER_TICK)`). If light work fills 40 s on every tick, for example right after a provider outage when many retries fall due together, no heavy job is dispatched until the backlog clears. The code follows the plan's order (light, then heavy), so this is a weakness in the plan, not a contract breach. A small heavy reserve, or reading the heavy queue first, would close it.
   - Evidence: Reading runner.ts lines 263-266, and the runner.test.ts case 'starts no new job after 40 seconds of the budget', which shows the heavy batch never runs after the cutoff.

3. `app/tests/unit/jobs/runner.test.ts` (not blocking)
   - What: The setup() wrapper at lines 130-143 replaces B3's fakeDb `from` with one that answers any table name. That loosens R50's 'fake-db.ts throws on any unregistered RPC or table' for this one read. The typed client still catches a wrong table name at typecheck, so the practical risk is low. The author banked it as P-905, which says a filter chain in fake-db.ts is B3's or the orchestrator's change. Recorded so that change gets routed.
   - Evidence: Reading runner.test.ts lines 129-143 and GOTCHAS P-905.

4. `app/src/server/jobs/dispatch.ts` (not blocking)
   - What: Possible conflict with R09. R09 says 'Throw only AppError with a key of errorCodes', but dispatch.ts:52 throws `new Error(`dispatch_${status}`)`, runner.ts:69 rejects with `new Error("step_timeout")`, and selftest.ts:17 throws `new Error("selftest_throw")`. NonRetryableError extends Error, not AppError. The plan's Contract asks for these error texts in jobs.error and names NonRetryableError, and lint's only-throw-error accepts them. So this is a conflict between STANDARDS and the plan for job-internal errors, for the orchestrator to settle. It is not a builder defect.
   - Evidence: Reading dispatch.ts:52, runner.ts:69, selftest.ts:17 and STANDARDS R09 (line 132).

5. `app/src/server/lib/events.ts` (not blocking)
   - What: Note for step 8, which the author already flagged. emitEvent takes `entityId: string` because the generated emit_event Args type p_entity_id is non-null. The plan's health.ts call passes `entityId: null`, so it will not typecheck as the plan writes it. The step 8 plan line, or the emitEvent signature, needs to change there.
   - Evidence: Reading events.ts lines 33-49, and the author's unproven list.

## g4 · steps 5

1. `workspace/05-plans/sizing/B8.json` (not blocking)
   - What: Several step-5 deliverables belong to no B8 group. g4 covers only app/supabase/functions/job-runner and config.toml, and no other group lists: the ci.yml deno step aimed at the runner, plus the deno test of tests/deno/*.smoke.ts; the deploy.yml dev-job 'functions deploy job-runner'; scripts/rollback-runner.sh; tests/deno/steps.smoke.ts; the job-runner case of tests/unit/sentry.test.ts; and the guardedScripts entry in assert-not-production.test.ts. Until someone owns them, the committed deno.lock is checked by nothing in CI (G15 does not cover the runner), and after merge the runner is never deployed from main. The author reported these as NOT DONE honestly; the orchestrator must assign them, or B8 cannot close.
   - Evidence: node over sizing/B8.json lists the files of g1..g10; grep for rollback-runner|ci.yml|deploy.yml|steps.smoke|sentry.test|assert-not-production in sizing/B8.json finds nothing.

2. `app/supabase/functions/job-runner/index.ts` (not blocking)
   - What: Every report sets requestId to one crypto.randomUUID() per tick, not to the job id the plan's Files list asks for ('requestId = the job id when there is one'). So a dead-job Sentry event cannot be joined to its jobs row except by job type and time, and all jobs in one tick share one id. The real cause is that the plan's own Contract defines Reporter as (error, { fingerprint, level? }) with no job id, in g3's types.ts. The log calls this 'a choice the plan left open', which is inaccurate. The plan needs one ruling: either Reporter carries jobId, or the Files line changes.
   - Evidence: line 23 'const requestId = crypto.randomUUID();'; types.ts:12-15 Reporter has no id; runner.ts:134 'opts.report(error, { fingerprint: ["job_dead", job.type] })'

3. `app/eslint.config.js` (not blocking)
   - What: The new supabase/functions/**/*.ts block turns off every type-checked rule (disableTypeChecked). R01 (lint is type-aware, strictTypeChecked) no longer holds for the runner entry. deno check does not catch floating promises, so a dropped await on captureException in the 500 path would pass both gates and could lose the Sentry event when the isolate ends. Nothing in the code triggers this today. A project block with Deno types, as G-016 did for scripts, would keep R01.
   - Evidence: printf 'const p = Promise.resolve(1);\np.then(() => 1);\nexport {};\n' | eslint --stdin --stdin-filename supabase/functions/job-runner/index.ts -> exit 0 (no no-floating-promises)

4. `app/supabase/functions/job-runner/deno.json` (not blocking)
   - What: deno.json and deno.lock are add/add copies of B3's files at fb15894. They merge clean only while B3 keeps them byte-identical. If B3 changes either file in another review round before merging, B8 gets an add/add conflict. P-907's proof also depends on origin/slice/b3 existing.
   - Evidence: git diff origin/slice/b3 8600cc0 -- the two files: empty today

5. `workspace/05-plans/ASSUMED.md` (not blocking)
   - What: Three records are still owed by the orchestrator. ASSUMED E5 must record that --use-api did not honour a stale deno.lock (not re-run by the reviewer). JOB_RUNNER_SECRET must be copied into the main .env and PREVIEW_WORKER_SECRETS_JSON before the lane .env goes away. And SENTRY_RELEASE is not a function secret, so every runner event is tagged release 'dev', even after the launch switch.
   - Evidence: supabase secrets list: no SENTRY_RELEASE; index.ts line 33 'release: Deno.env.get("SENTRY_RELEASE") ?? "dev"'

6. `.claude/workflows/build-slice.js` (not blocking)
   - What: The review brief contradicts itself. It says to run plan-brief.mjs 'from E:/mop-build/ops' and also 'never read, run or write anything there'. I ran plan-brief from the snapshot, which gives the same output because the snapshot is the same commit.
   - Evidence: Brief text: '(the brief is mechanical: run `node workspace/05-plans/plan-brief.mjs B8 ...` from E:/mop-build/ops'

## g5 · steps 6,6a

1. `app/src/db/types.ts` (not blocking)
   - What: The hand-written entries (P-910) are not in the generator's byte shape. The generator writes blank lines inside 'Relationships: [' as 20 spaces (22 such lines remain). The edit writes empty lines, and it also changed the existing migration_checksums blank line. So P-910's own after-push proof ('gen:types -- --db' then 'git diff --exit-code src/db/types.ts' exits 0) will go red on whitespace even if the types are right. P-910's rule also claims entries 'in the generator's own shape'.
   - Evidence: git diff 2043064..9f6e1f2 -- app/src/db/types.ts | cat -A shows '-                    $' replaced by '+$'; grep -c '^ \{20\}$' src/db/types.ts gives 22

2. `app/docs/runbooks/jobs.md` (not blocking)
   - What: Line 33 cites ASSUMED E5 for 'The deploy does not honour a stale deno.lock'. E5 does not say that. B8-followups.md line 66 lists that record as still owed by the orchestrator. The statement was measured by g4, but the citation points to a record that does not hold it yet.
   - Evidence: grep -n 'E5' workspace/05-plans/ASSUMED.md: row 61 covers deploy --use-api and npm imports only; B8-followups.md:66 'ASSUMED E5 must record that --use-api did not honour a stale deno.lock'

3. `workspace/05-plans/B8.md` (not blocking)
   - What: Two plan lines do not match reality, and neither is banked or in B8-followups.md (the author recorded both only in the log). (1) Step 6a's proof 'bunx vitest run tests/unit/jobs/ops-health-hook.test.ts tests/unit/jobs/runner.test.ts -t beat' skips the whole hook file, so it proves nothing about the hook. (2) The Files line 'handleOpsHealth(getDb(), params.token, process.env)' would break the Contract on a Worker with no database key: getDb() throws AppError unavailable before the token compare, so a wrong token would get 503 JSON instead of 404. The author passes getDb (the function) and the parsed env instead. That is correct, but it is a deviation from the plan.
   - Evidence: Re-run of the -t beat command: 'Test Files 1 passed | 1 skipped (2)'. src/server/lib/db.ts:41-42 throws AppError('unavailable') when the key is unset

4. `app/supabase/migrations/20261004023709_job_cron.sql` (not blocking)
   - What: The plan-mandated 'unschedule by name first' (F16) has no test that can detect its removal. pg_cron 1.6.4 replaces a job of the same name, so the re-apply case stays green without those lines. The author measured this, banked it as P-911 and did not register it. This is recorded so the orchestrator can decide whether F16 still holds. It is not a defect of this group.
   - Evidence: psql: select extversion from pg_extension where extname='pg_cron' gives 1.6.4; GOTCHAS P-911

5. `workspace/05-plans/logs/B8.md` (not blocking)
   - What: STANDARDS C22 asks that a new public route or per-tick cost state its unit cost and the P-009 line it draws on. The log and the runbook do not. The beat adds one RPC per runner tick (about 1440 a day). The ops-health hook adds one Worker request and one RPC per monitor poll (about 288 a day at 5 minutes).
   - Evidence: grep -n 'P-009\|unit cost' in the g5 log block finds nothing

6. `app/src/server/hooks/ops-health.ts` (not blocking)
   - What: R09 says a dependency outage answers 503 with Retry-After. The hook's 503 'fail: ops_health_rpc' has no Retry-After. The H40 exception only covers the plain-text body. The uptime monitor ignores the header, so nothing breaks for this product. The orchestrator should say whether H40 also exempts the header.
   - Evidence: Headers of the 503 from wrangler dev on port 8839: Content-Type, Cache-Control, X-Content-Type-Options, x-request-id; no Retry-After

(A seventh follow-up, the reviewer's own cost with the secrets loader and the self-contradicting review brief, is banked as a "Hit again" line in GOTCHAS P-310.)

## c5 · steps 5

1. `app/docs/runbooks/delivery.md` (not blocking)
   - What: Follow-up (not this group's file). The '## Deploys from main' paragraph (lines 270-275) lists every step of the dev job and still leaves out the new functions-deploy step. It also does not say that a failed function deploy, for example after an expired SUPABASE_ACCESS_TOKEN or a Supabase API error, now ends dev before the Worker deploy and so skips production (needs: dev). It does not say that the Worker rollback on a red smoke rolls back only the Worker: the runner stays at the new SHA, and scripts/rollback-runner.sh is the manual path. STANDARDS C23 asks a deploy-path change to update the rollback or incident runbook.
   - Evidence: From my reading of delivery.md:270-275: 'When main holds a migration it first links the one project and runs bun run db:push ... a failed push ends the job before the Worker deploy. It builds like a preview ...' with no mention of the function deploy. deploy.yml:268-273 now adds functions-deploy between db-push and the Worker deploy, and deploy.yml:342-343 runs the rollback step only for the Worker.

2. `.github/workflows/deploy.yml` (not blocking)
   - What: Follow-up (C22). The cost comment in the header (lines 10-14, 'about 1 minute each ... (UNPROVEN)') was not updated for the new step. The dev job now also runs a supabase functions deploy --use-api (a bundle and upload) on every code push to main. The estimate is already marked UNPROVEN, so measure it on the first post-merge dev run, together with the UNPROVEN 'Deployed Functions' log check.
   - Evidence: From my reading of deploy.yml:10-14: the cost lines describe dev as the Worker deploy only. The diff touches only lines 266-273.

(A third follow-up, the reviewer's own cost with the actionlint binary missing from a review snapshot, is banked as GOTCHAS P-913.)

## g6 · steps 7

1. `.github/workflows/render.yml` (not blocking)
   - What: No test covers three security- or behaviour-relevant lines: `if: always()` on the callback step, RENDER_CALLBACK_SECRET scoped to that one step's env, and the setup-node step that post-callback.mjs's import.meta.main depends on. If `if: always()` is dropped, every failed render sends no callback, and the job waits 30 minutes for the reaper on every failure, with no test going red. If the secret moves to job level, B9's render scripts can read it. The plan's test list does not ask for these, so this is a follow-up.
   - Evidence: Read by me: render-job.test.ts asserts only the if: expression, MOP_ENV, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and the absence of R2_/vars./repository_dispatch. hygiene.test.ts covers permissions {} and persist-credentials globally, not these. grep -n "always()" app/tests/unit/hygiene.test.ts app/tests/unit/jobs/render-job.test.ts prints nothing.

2. `workspace/05-plans/B8.md` (step 7) (not blocking)
   - What: Two parts of step 7 are NOT DONE: (1) GITHUB_DISPATCH_TOKEN as a mop-dev function secret, held back on purpose (P-912: set before render.yml is on main, it would turn every heavy job dead with dispatch_404); (2) RENDER_CALLBACK_SECRET and JOB_RUNNER_SECRET on the production Worker, which does not exist yet. The orchestrator must set (1) right after B8 merges and then run the SEC-02 probes (403 Contents PUT, 204 dispatch, largest client_payload against 65,535). (2) is caught by L1 preflight check (2). The plan line saying the production Worker 'holds the keys of the one database' (also in L1 step 1a, 'since B3 step 8') is stale against reality.
   - Evidence: Confirmed by running: bunx wrangler secret list --name matter-of-place gives 'Worker "matter-of-place" not found'. supabase secrets list shows no GITHUB_DISPATCH_TOKEN. The log and P-912 state both honestly.

3. `app/scripts/render-job.mjs` (not blocking)
   - What: Nothing proves the live round trip yet (UNPROVEN until merge): enqueueJob of test.selftest_heavy, gh workflow run render.yml, the callback reaching the dev Worker, and the job reaching done. Only the B9-script import path was exercised by me against real B9 files, and no test does it. A mutation of the import base (`../${script}`) would leave every unit test green, because the only 'missing script' case uses a type with no file.
   - Evidence: Confirmed by running: MOP_JOB with type render_cover reaches B9's render-cover.mjs (zod error 'payload.data.spec Required'). Read: the render-job.test.ts runJob cases use only social_post, render_nothing_here and the self-test.

4. `app/scripts/post-callback.mjs` (not blocking)
   - What: `process.exit(1)` right after a fetch aborts on Windows with a libuv assertion (UV_HANDLE_CLOSING) and exit 127 instead of 1. CI runs ubuntu, so production is unaffected, but anyone running the script on this laptop for a manual proof sees a crash, not a clean refusal. `process.exitCode = 1` would avoid it.
   - Evidence: Confirmed by running: node scripts/post-callback.mjs against the dev Worker printed 'post-callback: 404 ...' then 'Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76', exit 127.

(Three further follow-ups have GOTCHAS.md as their file and are banked as "hit again" lines: P-076 (JSON.parse JSDoc casts, `no-unsafe-assignment`), P-152 (bare `bunx vitest run` of hygiene.test.ts times out at 20 s), P-913 (actionlint binary missing from a review snapshot).)

## g7 · steps 8,8a

1. `app/src/server/jobs/system/retention.ts` (not blocking)
   - What: Files are removed with supabase-js db.storage.from('submissions').remove(...), which is what step 8a's text says. The plan's Risks section (ruling H33 (2)) says every step reaches Storage through B3's media-store.ts, so the plan contradicts itself and the orchestrator should fold it. One effect to know about, found by reading: every Storage error, a permanent 4xx included, becomes AppError('storage_unavailable'). The runner then retries an hour later without using an attempt, so a permanent Storage refusal never sends the job dead and surfaces only through retention_stalled after 2 days.
   - Evidence: retention.ts lines 74-84: any non-null error from .remove() throws AppError('storage_unavailable'). runner.ts:185 maps that code to retry_at now+1h with no attempt used. Brief, Risks: 'Every step and script reaches them through B3's src/server/lib/media-store.ts'. Step 8a: 'retention.ts removes the files with db.storage.from("submissions").remove(paths)'.

2. `app/src/server/jobs/system/health/providers.ts` (not blocking)
   - What: Found by reading, not run: resend_domain calls `await response.json()` outside any try. A 200 answer whose body is not JSON throws out of the whole health job, so it retries and eventually goes dead, instead of returning a typed 'fail' for that one check. It is the same kind of gap that graphGet in meta-token-refresh.ts already guards.
   - Evidence: providers.ts, resendDomain.run: `const parsed = resendDomainsSchema.safeParse(await response.json());` has no try/catch. Compare meta-token-refresh.ts graphGet, which wraps response.json().

3. `workspace/05-plans/B8.md` (not blocking)
   - What: Plan lines the code now differs from, for the orchestrator to fold: (1) meta_token_record takes its nullable dates last, (p_checked_at, p_token_state, p_missing_scopes, p_expires_at, p_data_access_expires_at, p_new_token), per P-915. (2) retention_declined_media and retention_accepted_media take only p_keep, with no p_dry_run. (3) healthChecks is module-local, not exported (R04/knip). B16 step 8's health-site.test.ts calls the site_identity entry of healthChecks, so B16 has to add the export back in that step, which R04 allows. (4) retention_accepted_media also waits for an unfinished copy_submission_media job and needs at least one photograph. (5) STANDARDS R32's adapter list does not name meta-token-refresh.ts, but eslint's ADAPTER_FILES does.
   - Evidence: supabase/sql/functions/meta_token_record.sql signature; retention_declined_media.sql and retention_accepted_media.sql signatures; health.ts line 'const healthChecks: readonly HealthCheck[]'; B16.md line 146; STANDARDS.md R32 list

4. `app/supabase/migrations/20261004065712_retention.sql` (not blocking)
   - What: GD-03 asks for the first production run to be a dry run. The 'retention' cron row is live as soon as main pushes this migration, and mop-dev becomes production at the launch switch, so the first real run happens on the first 03:45 UTC tick after the merge, with no dry run before it. Separately, health's retention_stalled fails on day one for any policy that has never run (last_run_at is null). The author lists both as follow-ups. They belong on L1's checklist.
   - Evidence: retention.sql lines 563-569 cron.schedule('retention','45 3 * * *',...); health_counts.sql: 'p.last_run_at is null' counts as stalled

5. `app/src/server/jobs/system/meta-token-refresh.ts` (not blocking)
   - What: UNPROVEN against reality. Graph debug_token, fb_exchange_token and ig_refresh_token answers, and the Resend /domains shape, are tested only against fixtures the author wrote (R33 wants recorded fixtures with source and recorded_at). The Instagram-login refresh route is chosen with a token.startsWith('IG') guess, which no real token has tested. Writing to Vault as the Edge Function's service role (GS-01) is proven only as postgres inside a rolled-back transaction. This needs the Meta app (S59) and a Resend key.
   - Evidence: refreshUrl(): `if (token.startsWith("IG"))`; tests/unit/jobs/meta-token-refresh.test.ts and health-providers.test.ts use inline fixtures; no tests/fixtures/meta or tests/fixtures/resend recorded files

6. `app/scripts/job-selftest.ts` (not blocking)
   - What: Still UNPROVEN after the merge (ruling H57): the full self-test printing 'heavy done' with the created, claimed, dispatched, callback, done timeline (needs GITHUB_DISPATCH_TOKEN as a function secret, P-912); --reconcile printing 'reconcile done' (the deployed runner does not have the reconcile type yet, and reconcile.ts passes a STUB(B3 step 8) stand-in, so it proves the job path only); the pushed-database retention_policies selects; the CI db job; and gen:types matching the hand-written types.ts entries (P-910). Separately, the 3 deno check errors in g5/B3 files (db.ts:2,3, runner.ts:227) remain for the CI deno step.
   - Evidence: Author's unproven list and log lines 675 and 732. deno check output above. reconcile.ts: '// STUB(B3 step 8)'

## c8w · steps 8

1. `app/src/routes/api/hooks/sentry-test.ts, app/src/server/jobs/system/reconcile.ts` (not blocking)
   - What: slice/b8 at 8f4d1d6 conflicts with origin/main. PR 114 (49e3799) rewrote the two STUB comment lines to 'STUB(B8 step 2a)', and this commit deletes those same lines. A conflicting pull request starts no CI run (P-136). The fix is small: merge origin/main into slice/b8 and keep the branch side of both hunks, then run check-gotchas, because GOTCHAS.md also changed on main.
   - Evidence: Confirmed by running: git merge-tree --write-tree --name-only HEAD origin/main gives exit 1 with 'CONFLICT (content): Merge conflict in app/src/routes/api/hooks/sentry-test.ts' and '... in app/src/server/jobs/system/reconcile.ts'.
   - Recorded by the follow-ups pass: origin/main was merged into slice/b8 and the branch side of both hunks was kept (both files equal the branch's own version, no STUB left); the merge commit is on the branch.

2. `app/tests/unit/sentry-test-route.test.ts:104` (not blocking)
   - What: The new route case loads the TanStack route module with vi.resetModules() and then a dynamic import, and it sets no timeout of its own. On a cold transform cache, the author's own proof command (a bare bunx vitest run, which keeps the 5000 ms default) went red. It passes under bun run check, which gives every test 60 s. render-variants.test.ts had the same problem and now sets { timeout: 60_000 } (G-031 hit-again, B9 g5). This case could do the same, or the proof command could add --testTimeout=60000.
   - Evidence: Confirmed by running. The first run in the fresh snapshot gave 'FAIL |unit| tests/unit/sentry-test-route.test.ts > the sentry-test route > reads SENTRY_TEST_TOKEN through env.ts ... Error: Test timed out in 5000ms.' The next three runs passed in 3.1 s to 5.0 s.

3. `app/tests/unit/jobs/reconcile.test.ts:93` (not blocking)
   - What: Follow-up on test strength. The case 'runs the real reconcileUploads' uses an empty submission_media table, so the stored counts (all zero) match the stand-in's. Only the call-shape assertion (client.calls contains from submission_media) tells real from stand-in, which is close to an internal-call assertion (C10). The watched-fail replay proves it goes red when the stand-in is put back, so the contract holds. A row-carrying case (one waiting row and a storage fake answering NoSuchKey, so missing or checked counts become 1) would assert behaviour, not shape. Not required by the step.
   - Evidence: Read the diff. The watchfail replay of rc-wired printed WATCHED-FAIL OK, so the test does fail when the wiring is removed.

4. `workspace/05-plans/logs/B8.md` (not blocking)
   - What: UNPROVEN, as the author says. The deployed job-runner still runs the stand-in, because main at 49e3799 still holds it. The --reconcile self-test I re-ran (exit 0, all-zero counts) proves the job path, not the real reconcileUploads. It needs a re-run after merge and the job-runner redeploy. The sentry-test route against a deployed Worker holding SENTRY_TEST_TOKEN is also UNPROVEN. The orchestrator should track both to closure.
   - Evidence: bun run scripts/job-selftest.ts --reconcile gave 'reconcile done in 54 s', 'reconcile uploads: {"checked":0,"deleted":0,"missing":0,"uploaded":0}', exit 0

(A fifth follow-up, the reviewer's own two costs in a bare vitest run and a loaded `bun run check`, is banked as hit-again lines on GOTCHAS G-031 and P-712.)

## g2 · steps 2a

1. `app/tests/db/jobs.db.test.ts` (not blocking)
   - What: Step 8's case 'returns backup null while schedule_settings is absent' (line 938, already on origin/main, not written by g2) is now permanently red on mop-dev. B8b's 20261004115859_automation.sql created schedule_settings there. Because of this the author's 'jobs: Tests 42 passed (42)' no longer reproduces; it was plausibly true before main's deploy at 15:54Z. Its B8.json entry now goes red whether or not it is mutated, so it measures nothing. g2 did not cause this and every step 2a case is green. The fix is to rewrite the case so it does not depend on whether another slice's table exists, for example by asserting backup from schedule_settings' backup row.
   - Evidence: Without the prelude: node node_modules/vitest/vitest.mjs run --project db tests/db/jobs.db.test.ts -t 'schedule_settings is absent' -> AssertionError: expected { absent: false, backup: null } to deeply equal { absent: true, backup: null }; Tests 1 failed | 41 skipped (42). git grep shows the case at origin/main:app/tests/db/jobs.db.test.ts:938. (Banked as P-916; recording pass: `git grep -n "to_regclass(.*is null" -- tests/db` also finds `retention.db.test.ts:657` for `email_messages`, the same shape, not run.)

2. `app/tests/api/subscribers.api.test.ts` (not blocking)
   - What: Step 2a's proof says a filled honeypot writes no row and no event. inquiries, submissions and subjects each gained an 'emitted toEqual([])' honeypot assertion. subscribers.api.test.ts has no honeypot case at all, even though POST /subscribers goes through the same pipeline.ts honeypot branch. Follow-up: add the case, or record that the shared pipeline branch is covered elsewhere.
   - Evidence: grep -n 'website\|honeypot' app/tests/api/subscribers.api.test.ts prints nothing. pipeline.ts:251-258 strips the honeypot for every JSON public route.

3. `app/src/server/inquiries/service.ts` (not blocking)
   - What: A stale comment outside g2's files. Line 8 says 'the function emits nothing until B8 step 2a (G20)', and create_inquiry now emits inquiry.received. The orchestrator should fold this, or the next writer of that file.
   - Evidence: grep -n '2a' app/src/server/inquiries/service.ts -> 8: /** `POST /inquiries`: one row through `create_inquiry` (G49); the function emits nothing until B8 step 2a (G20). */

4. `app/tests/api/inquiries.api.test.ts (and submissions, subjects, subscribers)` (not blocking)
   - What: Suspected from reading, not run. After main pushes the migration, these API tests commit real catalog events on the one database. Once B8b seeds recipes and fan-out runs on mop-dev, fanout_insert_jobs will turn the test events into real jobs (for example admin notifications). jobs.event_id is 'references public.events (id) on delete restrict' (20261003185349_jobs.sql:63), so the new cleanup 'delete from public.events where entity_id in (...)' would then fail with an FK violation and leave rows behind. Separately, the honeypot 'no event' checks filter only on type and a time window, so another lane writing at the same moment can flake them (the author noted this). Follow-up for B8b, which owns the fan-out.
   - Evidence: grep -n 'references public.events' app/supabase/migrations/*.sql -> jobs.sql:63 'on delete restrict'. automation.sql:674 fanout_insert_jobs(p_event_id ...) inserts jobs carrying the event id.

5. `app/tests/db/jobs.db.test.ts` (not blocking)
   - What: UNPROVEN, as the author already says: the plan's 'CI db job is green' proof cannot run because ci.yml has no db job until B4 adds it. The four API tests and function-source.db.test.ts without the prelude stay red on mop-dev until main pushes 20261004135327_public_write_events.sql. After the push, rerun the four API files and jobs/function-source/public-write without the prelude.
   - Evidence: My API run printed Tests 4 failed | 36 passed (40), each 'expected [] to deeply equal [...]'. The author's log records grep -c '^  db:' .github/workflows/ci.yml as 0.

(A sixth follow-up, the reviewer's three costs in a scratch registry folder, a foreign-table absence assertion and the review brief's plan-brief folder, has GOTCHAS.md as its file and is banked as P-916 and as hit-again lines on P-154 and P-706.)

## c8db · steps 8

1. `app/tests/db/jobs.db.test.ts` (not blocking)
   - What: Follow-up. The new case 'returns the backup row enabled flag and last run time' only ever sets enabled = true. A health_counts that hard-codes 'enabled', true (or reads the wrong boolean) would stay green. Only the null mutation (hc-backup-row) was watched failing. This case does not cover enabled = false; backup_fresh's warn branch depends on it.
   - Evidence: Read, not run: the upsert at the new case sets enabled = excluded.enabled with the literal true, and the only assertion on it is expect(backup?.enabled).toBe(true). The registry has no mutation that keeps the row but changes the enabled value.

2. `app/tests/db/retention.db.test.ts` (not blocking)
   - What: Follow-up, not this group's file. retention.db.test.ts:653-666 is the same kind of test that turned jobs.db red. It asserts to_regclass('public.email_messages') is null and expects { absent: true, count: 0 }. It will go red on every database once B5's migration creating email_messages reaches main. Today it is green because no migration in the snapshot creates email_messages. P-916 already names it.
   - Evidence: cd app && git grep -n "to_regclass(.*is null" -- tests/db prints only tests/db/retention.db.test.ts:657 after this change. grep -ln 'create table.*email_messages' supabase/migrations/*.sql finds nothing.

3. `workspace/05-plans/B8.md` (not blocking)
   - What: Follow-up for the orchestrator. Step 8 still says the health cases 'return backup null while schedule_settings is absent'. On every database built from main that state can no longer happen. The case is now 'backup row is absent' plus the new populated-row case. B8-followups.md:183 (the permanently red case) is now resolved and should be closed. P-916's proof line still cites jobs.db.test.ts:942 as a live hit, and that hit is gone.
   - Evidence: grep -rn 'schedule_settings is absent' finds B8.md step 8 (plan-brief output), logs/B8-followups.md:183-184 and GOTCHAS.md:2087-2090

4. `app/supabase/migrations/20261004060603_system_jobs.sql` (not blocking)
   - What: Follow-up, a note for a later slice (this group was told not to change the schema). health_counts (and ops_health in 20261004023712_ops_heartbeat.sql) still has the to_regclass('public.schedule_settings') is null branch. Since 20261004115859_automation.sql, no database built from main can reach that branch, and no test covers it now. It can be removed in a later migration that makes the read static.
   - Evidence: Read: system_jobs.sql around line 150 and ops_heartbeat.sql:51 both guard with to_regclass. automation.sql:74 creates the table unconditionally.

(A fifth follow-up, the reviewer's costTime entry that the author assigned to P-310 without a line for quiet.mjs, has GOTCHAS.md as its file and is banked as a hit-again line on P-310.)

## g1 · steps 9

1. `app/src/domain/jobs.ts` (not blocking)
   - What: The comment on jobRetryBulkSchema says the rule of at least one filter means 'a request never retries every dead job'. That is not true. Sending error_like '%' (or a since far in the past) passes the schema, and admin_retry_jobs then requeues every dead job that has an error. The plan only asks for at least one filter, so the behaviour meets the plan. The comment claims a guarantee the code does not give. Fix the comment, or refuse a pattern that is only wildcards.
   - Evidence: Confirmed by running: on mop-dev in a rolled-back transaction, `select public.admin_retry_jobs(<media_ops human>, 'human', 'r13', p_error_like => '%')` returned 115. The comment is at src/domain/jobs.ts, just above `export const jobRetryBulkSchema`.

2. `app/tests/unit/jobs/service.test.ts` (not blocking)
   - What: No test exercises the `since` filter of retry-bulk, in either layer. I deleted the line in retryBulkJobs that passes `since` to the RPC, and service.test.ts stayed green. tests/db/jobs.db.test.ts never passes a non-null p_since, so removing the `finished_at >= p_since` clause in admin_retry_jobs would also go unnoticed (that half is from reading the test, not run). The code is correct today. If it regresses, a 'retry since one hour ago' request would quietly requeue every older dead job of that type. The plan's proof does not ask for this case, so it is a follow-up.
   - Evidence: Confirmed by running: scratch watchfail entry rev-since-dropped (find `...(input.since === undefined ? {} : { p_since: input.since }),` replaced with nothing) gave `WATCHED-FAIL BAD: stayed green`. `grep -n since tests/db/jobs.db.test.ts` shows only `since: null` in the expected audit row.

3. `workspace/05-plans/B8.md` (not blocking)
   - What: The plan text no longer matches what was built, and the log records each departure: (1) admin_retry_jobs takes (p_actor, p_actor_kind, p_request_id, p_type, p_error_like, p_since) with the filters last and defaulted (P-915), not the plan's order. The plan and the B10.md, B8.md and B8b.md review lines still show the old order. (2) listJobs makes two selects on a page after a cursor (ties, then older rows, because of R44), while plan line 90 says 'one supabase-js select'. (3) jobStatusLabels and the JobStatus re-export named for src/domain/jobs.ts were left out (knip, R04). Step 10 has to add them where it first uses them. The orchestrator should fold all three into the plan.
   - Evidence: From reading: B8.md lines 90, 91 and 93 compared with app/supabase/migrations/20261008135942_jobs_admin.sql (the admin_retry_jobs signature), app/src/server/jobs/service.ts (`after()`) and app/src/domain/jobs.ts (no jobStatusLabels). The log block '## g1 · steps 9', under 'Choices the plan left open', records all three.

(A fourth follow-up, the rework of `listJobs` after a jscpd clone that the bank did not hold, has GOTCHAS.md as its file and is banked as P-2600.)

## c8e · steps 9

1. `workspace/05-plans/logs/B8.md` (not blocking)
   - What: The c8e block says the --only replay ran 'against mop-dev, which does not hold this branch's migrations'. P-2601 and the commit message also call 20261004060603_system_jobs.sql 'the branch's migration'. That migration is already on origin/main, and mop-dev holds its defaults: the old mutant fails on mop-dev with the same 'cannot remove parameter defaults' error. The wording reads as if only CI could show the defect, but it reproduces locally. Imprecise, not false about jobs_admin.
   - Evidence: git log -1 origin/main -- app/supabase/migrations/20261004060603_system_jobs.sql -> 0f200b7e. MOP_MUTATION_SQL=<old sql> bunx vitest run --project db tests/db/jobs.db.test.ts -t "emit_event inserts a row" on mop-dev -> 'cannot remove parameter defaults from existing function'.

(Two further follow-ups have GOTCHAS.md as their file: the missing hit-again line on P-008, added to that entry, and the reviewer's cost of running a gate beside a replay, banked as P-2604.)

## g1 · steps 10

1. `app/src/routes/admin/jobs.index.tsx` (not blocking)
   - What: Suspected from reading, not run. The shell's comment says a non-uuid `entity` or `job` in the search is dropped, but the page never reads the validated search. JobsPage reads raw `location.searchStr` through useUrlFilters and useOpenJob (JobsPage.tsx, `params.get(OPEN)`). So `?job=abc` still opens the drawer and requests `/api/admin/jobs/abc`, and fetchJob builds that path without encodeURIComponent (jobs-api.ts `jobPath`). The server-side uuid checks keep this harmless: it is a GET and the answer must parse as jobDetailSchema. Still, the comment describes protection the page does not have, and validateSearch's uuid filter does nothing for screen 16.
   - Evidence: jobs.index.tsx lines 4-5 comment and validateSearch; JobsPage.tsx useOpenJob reads `new URLSearchParams(location.searchStr).get("job")`; use-url-filters.ts reads `location.searchStr`. No test mounts the real Route: jobs.test.tsx uses pageRoute from test-router, so validateSearch is never run.

2. `tests/mutations/B8.json` (not blocking)
   - What: The manual entry b8g1-e2e-retry (retryJob posts to cancel, expect 'Expected: 200') has no working control on mop-dev today. The unmutated spec already fails there with 'Expected: 200, Received: 500', because admin_retry_job is not on mop-dev. A replay now would print OK without the mutation being what turned it red. It becomes a real watched-fail only once main pushes 20261008135942_jobs_admin.sql or it runs on the CI stack, and then the unmutated spec must be seen green first. The author disclosed that it was not replayed.
   - Evidence: Retry case on the built Worker against mop-dev, unmutated: admin-jobs.spec.ts:79 Expected: 200, Received: 500. pg_proc where proname like 'admin_%job%' returns [].

3. `workspace/05-plans/B8.md` (not blocking)
   - What: Two plan lines for step 10 no longer match what was built. (1) The proof command `bunx playwright test --project admin tests/e2e/admin-jobs.spec.ts` reads the file as a second project; `--project=admin` is needed (banked as P-2602). (2) FILES says the route sets the pending skeleton through B7's adminRouteOptions(). Under ruling H66 the shell cannot import it, the sibling screens (channels, reports, assets) set only errorComponent in the .lazy.tsx file, and this route has no loader. The deviation is logged. The plan text is the orchestrator's to update.
   - Evidence: P-2602 symptom (1); jobs.index.lazy.tsx sets only errorComponent; query.ts adminRouteOptions is used by no route under src/routes/admin.

4. `app/src/admin/jobs (UNPROVEN items, carried forward)` (not blocking)
   - What: Still UNPROVEN, as the author says, and to be closed later: the Retry e2e (dead to queued, with the banner emptying) on CI's live e2e stack; Approve and Cancel against a real database (they are unit-tested with a stubbed fetch only); a brand check of screen 16 by eye or viewport screenshot (C18; only axe was run).
   - Evidence: Reproduced the 500 at admin-jobs.spec.ts:79 on mop-dev. The CI e2e job (ci.yml line 337, E2E_STACK=1 bunx playwright test --project=admin) runs on a supabase start stack built from the branch's migrations, so it is the proof once the pull request runs.

(One further follow-up has GOTCHAS.md as its file: the reviewer's cost of a shared scratchpad file name overwritten by another agent, recorded as a hit-again line on P-2136.)

## g2 · steps 10a

1. `app/supabase/sql/functions/takedown_media_keys.sql` (not blocking)
   - What: Follow-up, suspected by reading, not run. The key list is built from the property's current rows. A public object whose row is gone or was replaced is never deleted or purged. Example: apply_media_variants (line 22) overwrites media_key when a photograph is rendered again with different content, and nothing in the repo deletes the old master or its sizes from the media bucket. The same happens to any photograph whose property_media row is removed before the takedown. In a rights takedown the disputed photograph is often the one an editor removed first, and it would stay at /media/o/<slug>/<n>-<sha8>.webp and its v/ sizes. The plan specifies this row-based design, so it is not this step's defect. Closing it needs either a Storage list by the property's o/<owner>/ and v/<owner>/ prefixes, or a delete of the objects whenever a row loses its key.
   - Evidence: grep -ln 'delete from public.property_media' supabase/sql/functions/*.sql returns nothing; grep deleteObjects src scripts finds only takedown-media.ts; apply_media_variants.sql line 22 sets `variants = case when m.media_key = i.media_key then ... else i.variants end` together with `set media_key = i.media_key`

2. `app/src/server/jobs/system/takedown-media.ts` (not blocking)
   - What: Follow-up, suspected by reading. purge() runs before markPosts(). purgeUrls throws NonRetryableError on any Cloudflare 4xx other than 429, for example a revoked token, a wrong zone, or file URLs outside CF_ZONE_ID's zone such as the workers.dev MEDIA_PUBLIC_BASE on dev. That kills the job, and takedown_mark_posts never runs, so live posts never reach the 'Withdraw by hand' list. The plan asks for this order (3 then 4), so it is not blocking here. Marking posts before the purge, or catching a final purge refusal into purge_skipped, would separate the human withdrawal list from cache housekeeping. The live proof waits for `done`, so on dev it will show whether Cloudflare refuses workers.dev URLs.
   - Evidence: purge-cache.ts send(): `if (!response.ok) throw new NonRetryableError(...)`; takedown-media.ts lines: `const purged = await purge(ctx, keys); const postsMarked = await markPosts(...)`; the runner's fail() with dead=true for NonRetryableError

3. `workspace/05-plans/B8.md` (not blocking)
   - What: Follow-up for the orchestrator to fold. Several plan lines no longer match main. Step 10a's Files line says 'each value of variants' and asks for to_regclass/execute guards. The log-events.ts Change line appends takedown_posts_unavailable. The db proof clause says 'takedown_mark_posts returns 0 while social_posts is absent'. The author deviated correctly and banked it as P-2605, but the plan still says the old thing.
   - Evidence: git grep -n 'create table public.assets\|create table public.social_posts' -- app/supabase/migrations gives two lines; log-events.ts already holds runner_beat_failed (line 16) and has no takedown_posts_unavailable

4. `workspace/05-plans/logs/B8.md` (not blocking)
   - What: Follow-up. Checklist C22: the new job type takedown_media states no unit cost: Storage delete calls (1 per 1,000 keys), Cloudflare purge calls (1 per 30 keys), 2 RPCs per pass, 2 passes, and the P-009 line it draws on. The cost is small and the job is rare.
   - Evidence: awk '/^## g2/,0' workspace/05-plans/logs/B8.md | grep -i 'cost\|P-009' returns nothing

5. `app/src/server/jobs/system/takedown-media.ts` (not blocking)
   - What: Follow-up, suspected by reading. Suppose the runner dies after deleteObjects succeeds but before requeue_job stores deleted_at. The rerun deletes again, which is harmless, but records `deleted: 0` because the objects are already gone. The live proof's pass condition 'result.deleted at least 1' would then read as a failure even though the takedown worked. Worth one sentence in the runbook or the live-proof text.
   - Evidence: run(): `if (done === null) { const { deleted } = await deleteObjects("media", keys); return { status: "retry_at", ... result: { deleted_at, deleted } } }`; media-store deleteBatch counts only what Storage reports it removed

6. `app/supabase/sql/functions/mark_social_post_posted.sql` (not blocking)
   - What: Follow-up for B10, suspected by reading. A post that is already past post-to-channel's editorial_state check when the takedown commits can land 'posted' after takedown_mark_posts has run. It is then never marked withdraw_required_at, and that live post never appears on screen 12. Fix: either mark_social_post_posted sets withdraw_required_at when properties.taken_down_at is not null, or the takedown re-marks once later.
   - Evidence: grep -n 'taken_down\|withdraw_required' mark_social_post_posted.sql set_social_post_inflight.sql finds nothing; post-to-channel.ts:427 checks editorial_state only before the call


## c8j · steps 10

1. `app/tests/e2e/admin-jobs.spec.ts` (not blocking)
   - What: UNPROVEN, not a defect of the code: the new Cancel case and both new watched-fails (c8j-e2e-cancel, c8j-e2e-no-delete) have never run green or red for the right reason. admin_retry_job and admin_cancel_job are in 20261008135942_jobs_admin.sql, which is not on mop-dev (ruling H57). C08 of STANDARDS stays open until someone replays both entries after main pushes the migration, and CI's e2e job (a fresh supabase start stack, ci.yml:265) passes on the PR.
   - Evidence: pg_proc query on mop-dev returns []; the control run fails at :81:37 with 500, 3 did not run. Reading confirms the mutant logic: in c8j-e2e-cancel, cancelJob posting to /retry means no /cancel response arrives, so the test hits its 15 s timeout. The confirm dialog 'Cancel this job', the queued status in CANCELLABLE and the 'Cancelled' label all match JobDrawer.tsx:23,96 and JobStatus.tsx:11.

2. `workspace/05-plans/B8.md` (not blocking)
   - What: Stale plan text (the orchestrator's to fold, as the author noted). Line 109 still says the spec inserts a job with key `test:<run id>` that is 'removed in afterAll'. The spec now uses key `e2e-jobs:<run id>` and deletes nothing. Line 176's `idempotency_key like 'test:%'` cleanup check no longer covers this spec's rows.
   - Evidence: grep -n 'removed in .afterAll' workspace/05-plans/B8.md matches line 109

3. `workspace/05-plans/logs/B8.md` (not blocking)
   - What: The proof commands in the log and the claim do not load the dev profile. Re-run exactly as written, the spec refuses in beforeAll with 'refusing: DEV_DB_URL is not set', so it never reaches the failure the log claims to show. The same is true of the `run` fields of the two c8j registry entries. This cost one wasted e2e run during review. The run lines should start with eval "$(node scripts/load-env.mjs --profile dev)" (G-901 convention).
   - Evidence: E2E_TARGET=built E2E_PORT=8996 env -u CLOUDFLARE_API_TOKEN bunx playwright test --project=admin tests/e2e/admin-jobs.spec.ts -> 'Error: refusing: DEV_DB_URL is not set' at assert-not-production.mjs:50

4. `app/tests/e2e/admin-jobs.spec.ts` (not blocking)
   - What: Every laptop run before the migration is pushed leaves another dead e2e_jobs row on mop-dev, 14 now including the one from this review. The banner is newest first with a limit of 5 (service.ts:40, jobs-queries.ts:61), and the spec filters by its own run id, so these rows do not break the spec. They do fill the Dead jobs banner on mop-dev until the launch switch's db:reset, as P-2607 already says. Note only: avoid more laptop full-spec runs until the push.
   - Evidence: select status,count(*) from public.jobs where type='e2e_jobs' -> dead 13 before my run

(One further follow-up has GOTCHAS.md as its file: the laptop proof command copied from a log without the dev profile; banked as P-2608.)
