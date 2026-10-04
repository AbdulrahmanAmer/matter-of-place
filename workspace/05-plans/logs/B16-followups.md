# B16 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 1,2

1. File `app/src/db/types.ts` (not blocking).
   What: The new RPC settings_put_site is missing from the generated types. STANDARDS C21 and the PR template ask for the migration and its regenerated types in the same PR. The author did not list this as UNPROVEN. From this lane it cannot be generated: gen:types reads either mop-dev, where the lane may not push, or the --local CI stack, which does not exist. It will bite step 2's service.ts, whose typed db.rpc("settings_put_site") will not typecheck until the types include it.
   Evidence: grep -n settings_put_site app/src/db/types.ts finds nothing, while public_state and save_property sit at lines 1647-1648. .github/pull_request_template.md:27 says 'a migration travels with its regenerated src/db/types.ts'.

2. File `workspace/05-plans/logs/B16.md` (not blocking).
   What: The UNPROVEN item 'CI db job on PR #98' cannot be cleared by that PR: ci.yml on this commit has no db job. Its jobs are check, build and merge-gate, and line 128 says 'Jobs appended here (B4 db and e2e...)'. The function's only proofs are the rolled-back mop-dev runs, mine included. Step 2's plan proof (CI db job green, settings-site.db.test.ts) stays UNPROVEN until B4 adds the job, not until this PR runs CI.
   Evidence: grep -n '^  [a-z-]*:$' .github/workflows/ci.yml lists check, build and merge-gate only.

3. File `app/supabase/migrations/20261003212641_fn_settings_put_site.sql` (not blocking).
   What: The '-- down:' header (line 1) says to re-run db:fn from the previous commit of settings_put_site.sql. This function is new, so no previous commit exists and an operator following the header has nothing to run. The real down step is: drop function public.settings_put_site(jsonb, uuid, public.actor_kind, text, text). The author disclosed this. The text comes from B2's scripts/db-fn.mjs template, which should write a drop-function line when the function is new. Since the file is on no main yet, it can be regenerated once the template is fixed. Not blocking: leaving the function in place on rollback does no harm.
   Evidence: head -1 app/supabase/migrations/20261003212641_fn_settings_put_site.sql; git log origin/main -- app/supabase/sql/functions/settings_put_site.sql prints nothing.

4. File `app/supabase/sql/functions/settings_put_site.sql` (not blocking).
   What: Suspected by reading, not a plan breach: the function updates value but never sets settings.updated_by (uuid, defined in catalog.sql:245), so the column keeps its old value after every audited write. The actor does land in audit_log. Also, p_actor_kind accepts 'agent', so 'human only' (Contract 4) rests entirely on B7's matrix (humanOnly) until write_audit exists (R21). Both are worth folding when B7's write_audit lands.
   Evidence: sed -n 241,246p app/supabase/migrations/20261001090300_catalog.sql; the function's update statement sets only value.

5. File `app/src/domain/retention.ts` (not blocking).
   What: The unit test checks only the five keys B2 seeds. The other four (subject_requests, email_pii, rate_limits, analytics_daily) have no seeded row on main yet: B3, B5 and B8 seed them. Until step 5's db test (-t retention) runs, a wrong number for any of those four would pass. The author lists this as UNPROVEN, which is correct.
   Evidence: ls app/supabase/migrations shows no 20261001100000_public_write_functions.sql and no B5 or B8 retention migration on this commit.
