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
