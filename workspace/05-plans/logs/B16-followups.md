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

## g2 · steps 2

1. File `app/scripts/set-site.ts` (not blocking).
   What: Follow-up (plan text, not this group's file): the plan's Files line for set-site.ts says to set process.env.CATALOG_VERSION_TTL_MS ??= "0" and load service.ts and readiness.ts with a dynamic import(). The script imports them statically and never sets the variable. By reading the code I think the deviation is harmless: state.ts reads the TTL at call time through readVar, and the script reads no state before its write, so the memo is empty when siteReadiness runs. Running the script confirms it: example then empty printed 'missing: none' and then 'missing: legal.entity legal.address'. The B16.md plan line is now stale and the orchestrator should fold it.
   Evidence: set-site.ts lines 11-12 import readiness.ts and service.ts statically, and nothing in the file sets CATALOG_VERSION_TTL_MS. The g2 block of workspace/05-plans/logs/B16.md states the deviation and the reason.

2. File `app/docs/runbooks/api.md` (not blocking).
   What: Follow-up: the plan's Files line asks for runbook lines on running scripts/set-site.ts (both fixtures, that the empty fixture restores the shared mop-dev row, and that the script refuses after L1's switch). They are not written. Step 2's own text does not name the file, and the author lists this as NOT DONE. It needs to land with step 3's route row, or the orchestrator should assign it.
   Evidence: git diff origin/main...slice/b16 --stat lists no docs/runbooks/api.md. The plan-brief Files list names it next to the GET /api/public/site row.

3. File `app/tests/unit/settings-service.test.ts` (not blocking).
   What: Follow-up: plan watched-fail (k) names site-read-path.test.ts (step 3's file). This group proved the same property (getSiteSettings never queries the settings table, one public_state call in 200 reads) in a new file that is not on the group's list. The author explains why (knip needs an importer for getPublicSite). Step 3 still has to create site-read-path.test.ts so that (k) holds as the plan words it. Its contract is covered for now.
   Evidence: watchfail --only b16-g2-read-table prints WATCHED-FAIL OK B16:b16-g2-read-table against tests/unit/settings-service.test.ts. No tests/unit/site-read-path.test.ts exists at 5bab4e7.

4. File `workspace/05-plans/logs/B16.md` (not blocking).
   What: Follow-up: the log's g2 UNPROVEN line ('the CI db job on the pull request ... skipped while the PR is a draft') is now outdated. PR 209 is not a draft and the db job passed on head 5bab4e7, running settings-site.db.test.ts (5 tests) on the ephemeral stack. Separately, the preview job on the same run failed: 7 flaky @overflow phone-sweep page.goto net::ERR_ABORTED timeouts and 48 passed. This group touches no UI or route, so the failure is not its own. It will still hold the merge gate until it is re-run.
   Evidence: gh pr checks 209: 'db pass 3m1s', 'preview fail 7m32s'. gh run view 37573151075 --job 112636074297 --log: 'db tests/db/settings-site.db.test.ts (5 tests)'. gh run view 37573151038 --log-failed: '7 flaky ... 48 passed', then '##[error]Process completed with exit code 1'.

(The fifth g2 follow-up, a GOTCHAS.md cost, went to the bank as a hit-again line in P-508.)

## g3 · steps 3

1. File `app/src/services/http/index.ts` (not blocking).
   What: UNPROVEN in live mode. Every proof (mine and the author's) ran a build with no VITE_API_BASE_URL, so services resolve to localSite, and the root loader and /legal never call the http adapter's site.get() (api.get("/site", publicSiteSchema)) against the route. No test covers site.get: tests/unit/http-adapter.test.ts has no site case. Under that local build, /legal on the MOP_ENV=production Worker still carries the 'fictional' paragraph, because localSite answers illustrativeContent true. This is harmless only because deploy.yml's production job always sets VITE_API_BASE_URL. The author's log already admits that the root loader and siteQuery have no test of their own.
   Evidence: In my production-mode Worker run, curl /legal | grep -ac fictional printed 1, while /api/public/site printed illustrativeContent:false. src/services/index.ts selects localServices when VITE_API_BASE_URL is unset. grep -n site tests/unit/http-adapter.test.ts finds no site.get case.

2. File `app/src/routes/__root.tsx` (not blocking).
   What: The root loader makes every page depend on GET /api/public/site. In a live build, a failed site fetch on a cache miss throws in the root loader and the whole page renders the root error page, not just the footer. ensureQueryData also never refetches stale data, so client navigations keep the first site value for the session. The plan asks for this loader, so this is a note for a later slice, not a defect of this step.
   Evidence: Read only, not run: loader: ({ context }) => context.queryClient.ensureQueryData(siteQuery()) at __root.tsx:22

3. File `workspace/05-plans/B16.md` (not blocking).
   What: Stale plan text for step 3. It says path /site, handler GET, and 'drop the /site row' in watched-fail (o). The tree uses the full path /api/public/site, handler ANY, and catalogRead. The author banked this as P-1941; the orchestrator should fold the fix into the plan.
   Evidence: plan-brief Files list: 'createFileRoute(...)({ server: { handlers: { GET: ...' versus app/src/routes/api/public/site.ts 'handlers: { ANY: ...'
