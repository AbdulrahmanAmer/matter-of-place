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
