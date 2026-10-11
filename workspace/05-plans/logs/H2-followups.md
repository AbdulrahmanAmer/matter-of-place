# H2 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 1

Recorded from the g1 code review, 2026-10-11. Follow-ups whose file is GOTCHAS.md are banked in GOTCHAS.md (a new P-3208, the P-015 hit-again line for the `/` route, and a G-031 hit-again line), not here. Nothing below is blocking, and no code was changed for it.

1. File: `workspace/05-plans/acceptance/probe.mjs`. Not blocking.
   - What: The read-only guard of `db` (FORBIDDEN_STATEMENT at line 41, forbiddenStatements at lines 287-294) only checks the start of each statement. psql meta-commands later on a line get through: `\gexec`, `\gset` followed by a `:var` line, and `\!` mid-line. A query file the guard accepts can therefore end the `begin read only` transaction and run the rest of the file read-write in autocommit on mop-dev, which becomes production after the launch switch (H35). Three texts state the opposite: the security charter ('runs a query file inside a read-only transaction that is rolled back'), the P-3200 rule, and the log line saying the '\!' file was refused. Fix: refuse any backslash outside a string literal, not just at the start of a statement. Not blocking: every panelist already holds DEV_DB_URL in its shell, so the guard is a seatbelt, not the boundary. I can name no accidental panelist input that writes.
   - Evidence: CONFIRMED BY RUNNING: a file holding `show transaction_read_only;` / `select 'commit' \gexec` / `show transaction_read_only;` went through `node workspace/05-plans/acceptance/probe.mjs db <file>` and printed `on`, then `COMMIT`, then `off`, then `WARNING: there is no transaction in progress`, exit 0. A file holding only `commit;` was refused.

2. File: `workspace/05-plans/H2.md`. Not blocking.
   - What: The plan's step 1 proof says the dev home page has 'zero console errors'. Not met: there are 2 on desktop and 1 on phone, all 404s on seeded media. The probe reports correctly and the fault is in the deploy or the media bucket, outside this group's files. The author marked this pass:false and banked it (P-3202). The orchestrator should either turn it into the first ledger row of pass one, or change the plan line so the proof checks that the probe reports errors rather than that there are none.
   - Evidence: CONFIRMED BY RUNNING: `probe.mjs page /` printed '[desktop 1440x900] status 200, console errors 2, failed requests 2' and '[phone 390x844] status 200, console errors 1'. `curl -s -o /dev/null -w "%{http_code}" https://matter-of-place-dev.holy-meadow-4327.workers.dev/media/o/oak-hill-residence/0-46eab9f6.webp` prints 404.

3. File: `app/tests/unit/acceptance-ledger.test.ts`. Not blocking.
   - What: Contract invariant 4 requires a disagreement to be written 'with both reasons'. run.mjs line 106 enforces this ('a vote needs its reason'), but no test sends a vote without a reason: the `agree()` helper always fills one in. Deleting line 106 would leave the suite green. The same is true of the 'unknown key', 'votes must be a list' and 'a vote needs a severity' checks. No test title names the reasons half of the invariant (STANDARDS R53, C10).
   - Evidence: SUSPECTED BY READING, not mutated: the only `reason` in the test file is inside `agree()` at line 28, and no registry entry in app/tests/mutations/H2.json targets line 106 or the other three checks.

4. File: `workspace/05-plans/acceptance/probe.mjs`. Not blocking.
   - What: Two env overrides the plan does not ask for (STANDARDS C05): `ACCEPTANCE_URL` at line 27 and `SENTRY_ORG` with a default at line 416. Nothing in the repository sets ACCEPTANCE_URL. Separately, `sentry` asks for limit=100 without pagination, so above 100 open issues the count printed is silently capped.
   - Evidence: SUSPECTED BY READING: a grep for ACCEPTANCE_URL across workspace/, app/scripts and .github matches only probe.mjs:27.

5. File: `workspace/05-plans/STANDARDS.md`. Not blocking.
   - What: Folder map row 1.1 lists the contents of `workspace/05-plans/` and has no `acceptance/`. The plan names the path, and the row already omits other existing tools such as quiet.mjs, check-gotchas.mjs and review-snapshot.mjs, so this is a stale row for the orchestrator to update, not a misplaced file.
   - Evidence: SUSPECTED BY READING: STANDARDS.md line 25. check-layout.mjs covers only app/ and printed 'layout: OK (2660 files)'.

6. File: `workspace/05-plans/acceptance/run.mjs`. Not blocking.
   - What: The report's date comes from UTC (`new Date().toISOString().slice(0, 10)`, line 303). On this +0300 laptop a run between 00:00 and 03:00 local time names the report after the previous day. Step 6 requires two clean passes 'on two different days', which this can blur. The author noted the UTC date in the log.
   - Evidence: CONFIRMED BY RUNNING: at 2026-10-11 01:31 local, `run.mjs --report` wrote workspace/audits/acceptance-2026-10-10.md.
