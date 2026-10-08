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
