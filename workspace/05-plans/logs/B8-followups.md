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
