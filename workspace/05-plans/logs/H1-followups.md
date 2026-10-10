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

## g6 · steps 6, 6b

1. `C:/Users/DELL/AppData/Local/Temp/tmp.4GbAp0A9XI (process leftover, outside the repo)` (not blocking)
   - What: The author's debugging copy of the drill (P-2892: 'a copy that keeps its folder') left a plaintext, decrypted mop-dev dump in the system temp folder. The folder holds x.dump (2.8 MB), public.sql (9.8 MB, every public row) and auth.sql (auth.users and identities: emails and password hashes). This goes against restore.md section 2 ('delete it after use'). The shipped scripts clean up correctly: my three runs left no folder. The fix is to delete that folder and bank a rule that any debug copy of a drill deletes its temp folder.
   - Evidence: Confirmed by running: ls -la /tmp/tmp.4GbAp0A9XI shows auth.sql, public.sql, x.dump and download/mop-dev-standin.dump.p7m, dated 12:35. Its restore.sql is the earlier drill form (no vault delete) and reads E:/mop-build/h1g6/app/scripts/harden/rowcounts.sql, so it came from the author's session

2. `app/scripts/harden/restore-lib.sh` (not blocking)
   - What: STANDARDS 1.3 folder map, row `scripts/`, naming column, says '.sh and .ps1 only where a plan names it'. The plan does not name restore-lib.sh. The same row also puts shared script helpers in scripts/lib/, not scripts/harden/ (C02, C03). The author disclosed this (the file exists to satisfy jscpd), and nothing goes wrong at runtime. The orchestrator should add it to the plan's Files list or move it.
   - Evidence: Found by reading: STANDARDS.md line 85 (folder map row scripts/); the log line 'a file the plan does not name'; check-layout.mjs gained a named entry for it

3. `app/tests/unit/assert-not-production.test.ts` (not blocking)
   - What: For the two shell drills, guardedScripts only checks text. If the bun -e guard line is commented out, the test stays green. It also stays green if the guard is moved below the marker insert. For .ts scripts, typecheck catches a commented call through the unused import; for .sh nothing does. The real damage is limited because db:reset refuses on production by itself, but restore-rehearsal.sh would write its marker row into production audit_log.
   - Evidence: Confirmed by running: node scripts/watchfail.mjs --file scripts/harden/restore-supabase-drill.sh --find "bun -e ..." --replace "# bun -e ..." --run "bunx vitest run --project unit tests/unit/assert-not-production.test.ts" --expect restore-supabase-drill printed 'WATCHED-FAIL BAD: stayed green'

4. `app/scripts/harden/checklist.json` (not blocking)
   - What: The H1-21 and H1-21b blockedText, the log and restore.md section 6 all say the rows wait for the operator to give the path of the escrowed key. delivery.md 'The key pair' says the private key is at creds/backup-recipient.key in the laptop's root checkout until the escrow is done, so the orchestrator can probably run the real H1-21 now with that path; that is not something only the operator can do (S63). The lane was right not to read the root.
   - Evidence: Found by reading: app/docs/runbooks/delivery.md line 453 ('Private key | creds/backup-recipient.key at the root of the laptop's checkout'); restore.md lines 182-184. I did not check that the file exists, because the brief forbids reading E:/Matter Of Place

5. `app/docs/runbooks/restore.md` (not blocking)
   - What: Section 4 and the H1-21b drill call `bun run db:reset`. That command refuses unless supabase/.temp/project-ref exists in the app folder (checkResetTarget needs the linked ref). The runbook never says to run `supabase link --project-ref` first, so on a fresh checkout the drill stops with 'restore into project blocked: bun run db:reset'.
   - Evidence: Suspected by reading, not run against mop-dev: app/scripts/db-reset-dev.mjs checkLinkedTarget reads ../supabase/.temp/project-ref; reset-guard.mjs throws 'refusing: ref mismatch (linked none, ...)' when it is missing

6. `app/src/admin/inquiries/inquiries.test.tsx` (not blocking)
   - What: bun run check is red under load on component tests the branch does not touch: inquiries, settings and revisions. Inquiries was also red when run with the other two files only, and green alone. This is not this group's code. P-2895 has hit again, and its cause is still UNPROVEN.
   - Evidence: Confirmed by running: full check: Tests 1 failed | 3801 passed, check-exit=1. JSON-reporter run: total 3929, failed 4. The three files together: 1 failed | 20 passed. Inquiries alone: 7 passed (7). git diff --stat origin/main...HEAD -- app/src/admin is empty

The follow-up whose file is GOTCHAS.md (item 7 of the review) is banked as a hit-again line on P-094 (a `python3 -` patch failed with `couldn't create signal pipe, Win32 error 5`) and as P-2896 (a red vitest run whose quiet tail lost the failing file names: rerun with the JSON reporter). Item 1 asks for a rule that a debug copy of a drill deletes its temp folder; it is recorded here and not banked, because it names no file of the tree.
