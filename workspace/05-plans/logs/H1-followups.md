# H1 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 1

1. `app/scripts/harden/checklist.json` (not blocking)
   - What: Rows H1-31, H1-37 and H1-40 run 'bunx vitest run' without --testTimeout=60000 --hookTimeout=60000. This contradicts the rule this group banked in its G-031 hit-again line: 'A vitest run ... placed in a checklist row takes the two flags itself'. Only H1-24 was fixed. Under the multi-lane load measured today, these rows can go red at the default 5 s timeout (a false fail, not a false pass). H1-37 also runs tests/db/migration-headers.test.ts without --project db, as the author noted.
   - Evidence: grep -o 'bunx vitest run [^&;|]*' app/scripts/harden/checklist.json | grep -v testTimeout | grep -v 'project db' prints 'bunx vitest run tests/unit/automation/plan.test.ts', 'bunx vitest run tests/db/migration-headers.test.ts' and 'bunx vitest run tests/unit/state.test.ts tests/unit/cache.test.ts' (confirmed by running)

2. `app/scripts/harden/run-all.mjs` (not blocking)
   - What: Line 461: runRow builds the report's 'command' cell with expand(phase.command, urls, phase.worker?.port), which uses the checklist port. runWithWorker uses the HARDEN_PORT_<port> override. On a lane that moves the port, the report records http://127.0.0.1:8788 while the run used 8879. The evidence column, which comes from the output, shows 8879.
   - Evidence: Read at line 461 versus line 325. Confirmed indirectly by running: W-2 evidence printed 'at http://127.0.0.1:8879' under HARDEN_PORT_8788=8879, while the command field is expanded with spec.port 8788.

3. `app/scripts/harden/run-all.mjs` (not blocking)
   - What: needsEnv (line 417) checks the runner's own process.env, not the profile a row loads with <load-dev>. H1-33 (AUDIT_AGENT_KEY_DEV) and H1-21b therefore stay 'blocked' after the operator puts the value in .env, unless it is also exported in the runner's shell. Neither name is in scripts/load-env.mjs. The failure is conservative (blocked, never pass), but the row's BLOCKED until text will mislead.
   - Evidence: grep -c '^AUDIT_AGENT_KEY_DEV=' .env prints 0 and grep -n AUDIT_AGENT_KEY_DEV app/scripts/load-env.mjs finds nothing; run-all.mjs:416-418. Suspected by reading; the future state was not run.

4. `app/scripts/harden/run-all.mjs` (not blocking)
   - What: writeReport (line 545) names the file only by date. A partial run with --report (for example L1 step 5's '--env prod --only H1-03,H1-25,H1-30,H1-35,H1-41') overwrites the full prod-config report of the same day, and a --checklist fixture run with --report would write a fixture report to the same path. The file does say '(partial)'.
   - Evidence: run-all.mjs:543-545 'const path = `${ROOT}workspace/audits/harden-${date}.md`'. Suspected by reading; --report was not run.

5. `app/scripts/harden/run-all.mjs` (not blocking)
   - What: What the runner does not cover, in one note. A kill during a worker phase leaves .dev.vars at MOP_ENV=production (the author disclosed this). serve() also copies .dev.vars to .output/server/.dev.vars and never restores that copy, so a later wrangler dev started from .output without the cf:preview copy step runs with the last phase's MOP_ENV. The writeDevVars failure path in the finally block was not provoked. A BLOCKED marker with leading whitespace is read as pass (fixture X-8). The plan says 'starts BLOCKED', so this matches the plan.
   - Evidence: Fixture X-8 printed '| X-8 |  | pass | BLOCKED indented |' (confirmed by running). serve() line 284 copyFileSync with no restore (read).

6. `app/tests/mutations/H1.json` (not blocking)
   - What: Watched-fail (aa) and the P-2807 BLOCKED-on-any-line fix exist only as hand runs in the log. Neither is a registry entry, so neither replays in CI. The registry already holds non-test targets (h1g2-k-ratelimit-fixture mutates a fixture JSON), so both could be entries: find 'if (run.code !== 0)' and 'linesOf(run.output).some(isBlockedLine)'.
   - Evidence: I reproduced both mutants by hand in scratch copies. aa went to pass and exit 0; the first-line mutant made X-1 pass. H1.json lists only h1g2-* entries.

The three follow-ups whose file is GOTCHAS.md are banked as P-2808 (the rework of the fix round), P-2809 (the shared scratchpad) and a hit-again line on G-031 (forks worker timeout, `--maxWorkers=1` rerun).

## g2 · steps 2

1. `app/scripts/harden/rate-probe.ts` (not blocking)
   - What: R50 says dev-script processes never see production or account-wide credentials, and it is enforced by scripts/lib/guard-env.mjs. rate-probe.ts and upload-probe.ts commit rows to mop-dev with DEV_DB_URL and the dev service role, but neither calls guardEnv(), while every other writing dev script does (admin-smoke, seed, set-site, job-selftest and others). I could not name a concrete harm: both probes read only DEV_ names. That is why this is a follow-up and not a blocker.
   - Evidence: I loaded the full .env into a shell, which brings in SUPABASE_ACCESS_TOKEN and PROD_TURNSTILE_SECRET. In that shell both probes ran to 'rate ok' and 'upload ok'. The vitest db project in the same shell refused: 'refusing: ops variables in this shell PROD_TURNSTILE_SECRET SUPABASE_ACCESS_TOKEN'. grep -rln guardEnv scripts lists neither probe.

2. `app/tests/e2e/admin-authz.spec.ts` (not blocking)
   - What: For every role except commercial, the expected verdict comes from permission(action).roles, which is the code under test. If the matrix is widened for any role other than commercial, the expectation and the behaviour change together and the spec stays green. Only commercial writes have an independent list (COMMERCIAL_WRITES). Watched-fail (y) asks only for commercial, so the contract holds. What the spec does not prove is that the matrix itself is right for the other five roles. That is left to B7's authz.matrix.test.
   - Evidence: Lines 30-36 build `roles: permission(r.tag.action).roles` in the Bun child. Lines 148-150 judge allowed = route.roles.some(...) for every role that is not commercial.

3. `app/scripts/harden/fixtures/zone-rules-bad-ratelimit.json` (not blocking)
   - What: zone-rules-bad-ratelimit.json and zone-rules-country-block.json, the fixtures the plan names for watched-fail (k), are referenced by nothing in the repo. The registry entries h1g2-k-* mutate zone-rules.json instead. Both files do turn waf-check red when run by hand. Either wire them into the registry or a checklist control, or note why they stay.
   - Evidence: grep -rn 'zone-rules-bad-ratelimit\|zone-rules-country-block' outside GOTCHAS finds only the plan and the log. waf-check --fixture on each file exited 1 with the expected line.

4. `workspace/05-plans/logs/H1.md` (not blocking)
   - What: The plan's watched-fail list includes two items on this group's own files that the log neither reports nor marks UNPROVEN. One is (kk): the rate-probe cleanup without mop.retention. The other is (ii): check-headers --cache red on an HTML s-maxage of 60, and HSTS without includeSubDomains. I ran (kk) myself and it went red for the right reason ('cleanup failed subscribers'). The log should record (kk), and (ii) should be run or marked UNPROVEN.
   - Evidence: The g2 watched-fail block of logs/H1.md lists a, s, q, z, G-1300, rule 6, guard, k, ss, b, uu, v, rr, y and (dd) UNPROVEN, with no (kk) and no (ii). My replay of (kk) gave WATCHED-FAIL OK KK:review-kk-no-retention.

5. `app/scripts/harden/rate-probe.ts` (not blocking)
   - What: Both probes' cleanups delete every rate_limits row whose bucket matches 'subscribers:%' (or 'submissions:%') since the probe started. That includes hits other lanes' Workers or tests wrote in that window without taking the G34 lock. This could make another lane's rate-limit assertion flaky. The fix is to narrow the delete to the key_hash of the probe's own CLIENT_IP and email.
   - Evidence: rate-probe.ts cleanup(): "select id::text as id from rate_limits where bucket like 'subscribers:%' and at >= $1". upload-probe.ts uses the same with 'submissions:%'. Suspected by reading, not observed.

The two follow-ups whose file is GOTCHAS.md are banked as P-2810 (two parallel specs signing in the same user) and P-2811 (the free-plan daily Workers limit, error 1027, and the request cost of a run-all against prod-config).

## g3 · step 3

Review verdict ACCEPT (fresh Opus review of 100d31cc, plan amended by 50fef3b7, ruling H75): three non-blocking defects (1 to 3 below) and seven follow-ups (4 to 10).

1. `app/scripts/harden/checklist.json`, row H1-18 (not blocking; FIXED in this commit)
   - What: when the pull request lookup for `main`'s head returned an empty sha, `gh run list --workflow ci.yml --commit "$sha"` dropped the commit filter and the row judged the newest run of any branch. Fix: `[ -n "$sha" ] &&` now stands in front of the `gh run list --commit` check, so an empty sha fails the row.
   - Evidence: `gh run list --workflow ci.yml --commit "" --limit 1 --json headBranch,conclusion` printed `[{"conclusion":"","headBranch":"slice/b7"}]`. After the fix, `grep -c '\[ -n \\"$sha\\" \] &&' app/scripts/harden/checklist.json` prints 1 and `node scripts/harden/run-all.mjs --list | wc -l` prints 47. Banked as P-2813. Owner: done.

2. `app/scripts/harden/rls-review.ts` / `rls-review.sql`, condition (b) (not blocking)
   - What: (b) uses `has_table_privilege`, which ignores column-level grants and sequences. `grant select (id) on public.payments to anon` and `grant usage on sequence ... to anon` both pass. mop-dev holds 0 anon column grants today, so the review is right on the data it has. Suggestion: add `information_schema.column_privileges` (grantee anon or public) and `has_sequence_privilege` to (b).
   - Evidence: `MOP_MUTATION_SQL="grant select (id) on public.payments to anon" bun run scripts/harden/rls-review.ts --env dev` printed `rls ok`, exit 0 (confirmed by running; the sequence grant also printed `rls ok`). Banked as P-2814. Owner: the slice that next edits `rls-review.sql`.

3. `app/scripts/harden/rls-review.ts` / `rls-review.sql` (not blocking)
   - What: views are never checked for RLS bypass. A `public` view without `security_invoker` granted to `authenticated` reads the underlying table as its owner, and the review does not look. All 5 current views (`market_interest_counts`, `dashboard_counts`, `submission_list`, `archive_facets`, `invoice_list`) have `security_invoker=true`. H1-17's advisor lint `security_definer_view` probably covers it; untested.
   - Evidence: a scratch view over `payments`, without `security_invoker`, granted to `authenticated`, printed `rls ok` (confirmed by running, rolled back). Owner: the slice that next edits `rls-review.sql`; the advisor claim is UNPROVEN.

4. `app/scripts/harden/rls-review.sql`, condition (c), and the `rls-review.ts` header (not blocking)
   - What: (c) is a name check on policy text, not behaviour. A `using (false and app.role_in(...))` policy, a negated `is_staff`, a restrictive `using (false)` and an open `using (true)` select all print `rls ok`. B2's "the matrix as behaviour" test in `tests/db/rls.db.test.ts` is the behaviour check; it cannot take `MOP_MUTATION_SQL`, and it is suspected to catch all four (not replayed). The `rls-review.ts` header should say that (c) is a name check and that the behaviour check is B2's test.
   - Evidence: the four policies were run through `MOP_MUTATION_SQL`; each printed `rls ok`. Owner: whoever edits the header; the suspicion about B2's test is UNPROVEN.

5. `app/scripts/harden/rls-review.sql`, condition (e) (not blocking)
   - What: (e) accepts any `search_path=` value; `search_path = pg_temp, public` passes. All 197 definer functions use `search_path=""` today. Requiring exactly `""` would cost nothing.
   - Evidence: read from the SQL; the review's count of definer functions was 196 in the g3 run and 197 at the time of the review, all with `search_path=""`. Not replayed with a `pg_temp, public` function. Owner: the slice that next edits `rls-review.sql`.

6. `.env.ops` and `app/supabase/.temp` (not blocking)
   - What: H1-17 and H1-18 depend on two untracked local files. A fresh review snapshot failed H1-17 with `jq: Cannot iterate over null` and H1-18 with `ProjectRefNotLinkedError` until both were copied in. The main checkout has `supabase/.temp` but no `.env.ops`, so ruling H75's run of H1-18 from main needs `.env.ops` there first, or H1-18 should lint with `--db-url "$DEV_DB_URL"` (P-337) and need no link.
   - Evidence: both failures seen in the snapshot; both rows passed after the copy. Banked as P-2815. Owner: the orchestrator (before the H75 run).

7. `app/scripts/harden/db-reset-dev.mjs` (not blocking)
   - What: the `H1_DB_RESET=1` guard checks nothing about the branch, the G34 lock or live lanes: anyone who sets the variable resets mop-dev. Suggestion: `db-reset-dev.mjs` refuses unless the branch is `main`.
   - Evidence: read from the row and the script; not run (a lane may not, ruling H57). Owner: the orchestrator.

8. `app/scripts/harden/checklist.json` and the plan (not blocking)
   - What: plan and checklist disagree in wording. Row H1-16 says "one line per table and role", the code prints one line per table. Row H1-19 says "rerun as is", the checklist adds `--testTimeout=60000 --hookTimeout=60000` (the G-031 rule, so the checklist is right). Correct the plan text, not the code.
   - Evidence: the g3 log's Proof 1 prints one line per table; H1-19's command in the checklist carries the two flags. Owner: the orchestrator (plan text).

9. `app/scripts/harden/rls-review.ts` (not blocking)
   - What: the `sql` watched-fail replays take ACCESS EXCLUSIVE locks on the real `jobs`, `payments` and `audit_log` with no `lock_timeout`; a replay blocks behind a long transaction of another lane, and blocks that lane's reads while it waits. Suggestion: `set local lock_timeout = '3s'` after `begin` in `rls-review.ts`.
   - Evidence: suspected by reading, not observed. Owner: the slice that next edits `rls-review.ts`.

10. `workspace/05-plans/logs/H1.md` (not blocking)
    - What: the second half of watched-fail (m), "make the down block a no-op, the drill's schema comparison must go red", waits on `scripts/harden/migration-rollback-drill.sh`, which does not exist yet.
    - Evidence: the g3 block of the log marks it UNPROVEN. Owner: the group that writes the rollback drill (H1-35 to H1-39).

The three follow-ups whose file is GOTCHAS.md are banked as P-2813 (the empty `--commit` filter), P-2814 (`has_table_privilege` blind to column grants and sequences) and P-2815 (a review snapshot lacks `.env.ops` and `supabase/.temp`). The suggestions-only items (7 to 10) are not banked.

## g7 · steps 7

1. `app/scripts/harden/migration-rollback-drill.sh` (not blocking)
   - What: The drill cannot tell a complete down block from a partial one. It checks only two things: the schema differs after the down block, and re-applying the up file gives back the first dump. Up files use create or replace, so a down block that drops 1 of 9 objects still prints 'migration rollback ok'. The script already stands at the prefix chain just before the drilled file, but it never dumps there and compares that dump with the post-down dump. Runbook section 4 says the drill proves 'one down block really undoes its migration', which claims more than the method checks. Today's admin_team down block does fully undo its migration (prefix dump equals post-down dump, checked by running), so nothing in the current tree is false. This is a weakness: the plan's H1-37 text defines exactly the differs/equals check the author built.
   - Evidence: On a scratchpad copy, the admin_team down block reduced to 'drop function public.is_last_admin(uuid);' gave 'migration rollback ok', exit 0. A copy with a prefix dump added printed PREFIX-EQUALS-DOWN for the real block.

2. `app/tests/mutations/H1.json` (not blocking)
   - What: The two watched-fails of this group, (j) 'ROLLBACK_VERSION set to a version that does not exist' and (m) part 2 'down block made a no-op', have no entry in the slice registry. Earlier H1 groups registered their harden-script watched-fails (h1g2-b-hsts, h1g2-v-checkdb-allows and others, as kind manual), and C08 asks for registry entries. R49 scopes the rule to test files and mutation-registry.test.ts passes, so this is not blocking. The (m) part 2 mutation can be replayed locally with PG_BIN; (j) needs the live account and would be a manual entry.
   - Evidence: git show 56cca034 --stat does not touch tests/mutations/H1.json. The H1 log says 'No file of this group is in a registry entry.' Listing H1.json ids shows none for rollback-drill.sh or migration-rollback-drill.sh.

3. `app/scripts/harden/rollback-drill.sh` (not blocking)
   - What: After the rollback the script polls for status 404 or 500 and never reads the body. P-2920's rule says 'The marker v2 (body) going away is the proof', but the code checks the status alone. The 500 means the built Worker (MOP_ENV=production, no secrets) fails on an unknown path; nobody has investigated it, and what the live Worker answers there is UNPROVEN. I found no input that makes the drill pass falsely today, because v2's static asset answers 200. A body check (body not equal to v2) would match the banked rule and drop the 500 special case.
   - Evidence: In wait_for status '^(404|500)$', only %{http_code} is compared. Re-run printed 'answer after rollback: 500'.

4. `app/docs/runbooks/rollback.md` (not blocking)
   - What: The job-runner half of H1-22 (DO-10) is BLOCKED. scripts/rollback-runner.sh (B8) is not in the tree, so the runner rollback, the {"claimed":...} curl and the minutes for section 2b and the section 6 row do not exist. The runbook says so honestly. Close it when B8 lands. Two related items stay open: the in-job rollback record (run 37119653705) predates 110 lines of deploy.yml changes, and the CEO initials in section 5 are pending.
   - Evidence: ls app/scripts/rollback-runner.sh shows no such file. Section 2b opens with 'BLOCKED'.

The one follow-up whose file is GOTCHAS.md (P-2920's cause on how fast a deleted Worker stops answering) is banked as P-2924, and the sentence in P-2920 now points to it.
