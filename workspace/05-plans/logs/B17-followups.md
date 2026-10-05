# B17 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 1

1. File `app/src/server/lib/headers.ts` (not blocking).
   What: withPageCsp hashes only 200 text/html responses, as the plan says. As a result the stored 404 and 410 pages, the 5xx page and g5's maintenance 503 keep the default policy with no sha256 source, while they still carry TanStack's inline bootstrap. In report-only this sends violation reports from every 404 view. Once H1 turns csp_enforce on, those pages lose hydration. The author recorded this as a plan gap. It goes to the plan owner before H1's flip.
   Evidence: Ran on the 8939 preview: curl -s -D - -o /dev/null http://127.0.0.1:8939/journal | grep -o sha256 | wc -l gives 0 (the page is a 404)

2. File `app/supabase/migrations/20261005054600_essentials_flags.sql` (not blocking).
   What: Step 1 and R16 / E2E-06 say the migration lands in its own small pull request before the code that reads the keys. Here it sits on slice/b17 with all of step 1's code. That is harmless because defaultFlags gives false for both missing keys, but under ruling H57 the workflow has to split or merge it on its own. The CI db job, db:psql printing 'false | false' and 'migration list --linked' are UNPROVEN until main pushes it.
   Evidence: git diff origin/main...HEAD --stat lists the migration beside headers.ts, pipeline.ts and the rest; no pull request exists for the commit.

3. File `app/tests/db/flags.db.test.ts` (not blocking).
   What: The case title still reads 'exists with new_channels and archive_pages false', but it now asserts four keys including csp_enforce and maintenance. The title understates what is checked. It runs only in the CI db project, so it is UNPROVEN here.
   Evidence: sed -n 15,35p tests/db/flags.db.test.ts

4. File `app/src/domain/contracts.ts` (not blocking).
   What: cspReportBatchSchema refuses a Reporting API batch of more than 20 reports, so all of them are lost with a 400. It also refuses a legacy report that has 'violated-directive' but no 'effective-directive', which some older browsers send. Both follow the plan's 1-to-20 shape, but the loss is silent. Step 10's report-only week should check whether real batches go over 20.
   Evidence: Read by reading, not run: z.array(reportingApiViolation).min(1).max(20) and legacyViolation requires 'effective-directive'

5. File `app/src/server/lib/headers.ts` (not blocking).
   What: The CPU cost of hashing on a miss of / under workerd is still BLOCKED. The only number comes from Bun (0.59 ms CPU per call), not B1b's step 7 wrangler tail recipe, and the edge proof ran on a local wrangler dev, not the custom domain (L1, F25 j). Both are UNPROVEN and recorded by the author.
   Evidence: workspace/05-plans/logs/B17.md Proof 2 of the first g1 block

## c1 · steps 1

1. File `workspace/05-plans/B17.md` (not blocking).
   What: Contract invariant 1 still lists `upgrade-insecure-requests` in the policy for both states. The code now sends it only in the enforced header (headers.ts:97), so the plan and the code no longer agree. The plan is the orchestrator's file to fold: it should say 'enforced policy only'. The author already flagged this as UNPROVEN.
   Evidence: Read only: line 16 of B17.md contains "... object-src 'none'; upgrade-insecure-requests; report-uri /api/public/csp-report; report-to csp" with no flag condition. headers.ts:97 filters the directive out unless flags.csp_enforce === true.

2. File `app/tests/e2e` (CI e2e job) (not blocking).
   What: UNPROVEN: that the e2e job of PR 142 is green. CI runs every spec in live mode (E2E_MODE=live) across the desktop, phone, live-desktop and edge projects (ci.yml:303-307). The author and I ran only sweep.spec.ts, in local mode, on desktop and phone. GitHub Actions billing is currently blocked (P-524/P-2003), so no CI run exists for this commit. By reading only: live mode reads csp_enforce from mop-dev, where it is false or missing, and mergeFlags turns that into false, so the same branch applies. Not confirmed by running.
   Evidence: Confirmed by running: sweep desktop+phone local, 102 passed + 4 load timeouts, which passed on re-run (32 passed). Not run: live-desktop, edge, coming-soon, live mode.

3. File `workspace/05-plans/check-gotchas.mjs` (not blocking).
   What: This round edited a shared, orchestrator-owned tool (last edited in 187218b, ruling H51) that is not among the group's named files. The one-writer-per-file rule allows only gate-config entries (H46). The change itself is small and correct, and its watched-fail reproduces (exit 1 on a NUL, exit 0 clean). The orchestrator should ratify it so another lane editing the same script does not conflict with it.
   Evidence: git show --stat 67b42e9 lists workspace/05-plans/check-gotchas.mjs | 7 ++++++-. git log -- workspace/05-plans/check-gotchas.mjs shows the previous writers were orchestrator commits 187218b and ad17a24.

Recorded in the bank, not here: two follow-ups whose file is GOTCHAS.md became hit-again lines of P-713 (the 120 s foreground timeout of a by-hand replay) and P-015 (the `-g "/markets$"` path conversion), plus one on P-1805 (the four property-page sweep timeouts under load), because the bank holds those lessons already and a repeat gets a dated line, not a new entry.
