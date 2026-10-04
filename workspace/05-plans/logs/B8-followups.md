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
