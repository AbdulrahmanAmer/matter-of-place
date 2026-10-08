# B8b follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 1

Recorded from the g1 review (no blocking defect). None is blocking.

### 1. app/supabase/migrations/20261004115859_automation.sql

- what: The channel_settings.approval_mode CHECK (lines 62-66) does not enforce the plan's shape {Feature, Reach, Campaign}. A missing key makes `->> 'Reach' in (...)` evaluate to NULL, and a CHECK accepts NULL, so a value like {"Feature": "manual"} is stored. Today only the TS Zod schema guards it, so a direct Studio edit or a later put that skips Zod can store an incomplete mode. Found by reading, not run. Follow-up: add `approval_mode ?& array['Feature','Reach','Campaign']` to the check in a later migration.
- evidence: Lines 62-66: check (approval_mode ->> 'Feature' in ('manual','auto') and approval_mode ->> 'Reach' in (...) and approval_mode ->> 'Campaign' in (...)). Postgres treats a NULL CHECK result as satisfied.
- blocking: false

### 2. workspace/05-plans/logs/B8b.md

- what: The log title has an em dash ('# B8b — Automation console: build log'). The standing rule is no em dashes, and the other slice logs use none. Internal document, no product copy affected.
- evidence: git diff origin/main...slice/b8b | grep -n '^+.*—' finds only line 2819: '+# B8b — Automation console: build log'.
- blocking: false

### 3. app/supabase/sql/functions/automation_put_reason.sql

- what: Note for a later slice, already raised in the author's log. automation_put_reason keeps the plan's signature (p_id uuid first, no default), so the generated Args type p_id as string, and the TS putReason cannot pass null for an insert without a cast (P-915). claim_schedule took the opposite route: it gained `default null` on its three time arguments, which the plan's signature does not have. Both need an orchestrator ruling and a plan fold before the TS service group.
- evidence: src/db/types.ts diff: automation_put_reason Args "p_id": string; claim_schedule Args "p_old_last_run_at"?: string. Migration lines 797-803 add the defaults; the plan's Data changes line shows claim_schedule(p_key text, p_guard boolean, p_old_last_run_at timestamptz, p_last_run_at timestamptz, p_next_run_at timestamptz) with no defaults.
- blocking: false

### 4. app/supabase/sql/functions (7 put and restore files)

- what: UNPROVEN, outside this group. The seven `-- STUB(B8b step 6)` markers are invisible to scripts/stubs.ts (banked as P-1600), so the stubs gate cannot stop B8b from closing with the write_audit guard still in place. Separately, the plan's CI db job does not exist and src/db/types.ts is hand-written. Both are disclosed by the author and stay UNPROVEN until B4 lands the db job and main pushes the migration and runs gen:types --db with git diff --exit-code. B1b owns the stubs regex.
- evidence: P-1600 proof: git grep -c 'STUB(B8b step 6)' -- supabase/sql/functions | wc -l gives 7 while bun run stubs | grep -c automation_ gives 0. ci.yml jobs: run, check, build, merge-gate (no db).
- blocking: false

## g2 · steps 2-3

Recorded from the g2 review (no blocking defect). None is blocking. A seventh follow-up, a costTime line mapped to the wrong gotcha entry, is banked in GOTCHAS.md (P-076 "hit again"), not listed here.

### 1. app/src/domain/events.ts

- what: Line 123: the digest.due schema is `scheduled_for: z.string().datetime()`, which accepts only a `Z` suffix. It refuses the `+00:00` form that Postgres timestamptz and supabase-js return. scheduleSettingsSchema in the same diff uses `{ offset: true }`. If g4's runDueSchedules passes `next_run_at` straight through, every digest.due event fails eventPayloadSchemas. Fan-out would then log `fanout_payload_invalid` on every digest and plan with the raw payload. The producer is not built yet, so nothing breaks today.
- evidence: Confirmed by running a bun probe in the snapshot: safeParse({scheduled_for:'2026-10-27T14:00:00Z'}) gives true and safeParse({scheduled_for:'2026-10-27T14:00:00+00:00'}) gives false.
- blocking: false

### 2. app/src/domain/events.ts

- what: Optional payload fields are `.optional()` only: `decline_reason_id`, `note` (submission.declined) and `submission_id` (property.published). A SQL producer that builds its payload with jsonb_build_object from a null column writes JSON null, and these schemas refuse null. That gives a spurious fanout_payload_invalid warning per event. Suspected by reading only; the B7 producers are not on main.
- evidence: Read only: events.ts lines 61-62 and 105 use `id.optional()` and `z.string().optional()`. submissions.decline_reason_id is nullable (`on delete set null`, migration 20261001090400_intake.sql:83).
- blocking: false

### 3. workspace/05-plans/B8.md

- what: This group made `sideEffect` a required field of SystemJobDefinition (app/src/server/jobs/types.ts). B8.md line 68 still documents `SystemJobDefinition { type, maxAttempts?, timeoutMs?, run }`. The plans that add system jobs (B5, B6, B10, B11, B14, B16 and others) do not mention `sideEffect`, so their builders hit a typecheck failure when they merge. These are stale plan lines in files outside this group, for the orchestrator to fold.
- evidence: `grep -ln "src/server/jobs/system/" workspace/05-plans/B*.md` lists B10, B11, B14, B16, B1b, B3, B3b, B5, B6, B7 and B8b. `grep -l sideEffect workspace/05-plans/B*.md` lists only B8b.
- blocking: false

### 4. app/tests/unit/automation/step-specs.test.ts

- what: The R28 run-twice title check (missingRunTwiceTests) iterates step specs only, never system types. meta_token_refresh is registered with sideEffect 'idempotency_key', calls graph.facebook.com and has no 'meta_token_refresh runs twice without a second outside effect' test, and the check does not see it. The plan's wording ('every type whose sideEffect is not none and whose isImplemented is true') is ambiguous, and R28 says 'step', so this is not a contract break. Later system types with outside effects (invoice_pdf, market_open_notice, newsletter_send) will also bypass the check.
- evidence: Read: step-specs.test.ts lines 57-62 filter listStepSpecs() only. `grep -rn "runs twice without a second outside effect" tests` finds only the helper strings in step-specs.test.ts.
- blocking: false

### 5. workspace/05-plans/STANDARDS.md

- what: R27 (line 208) says every step-specs entry declares timeoutMs and maxAttempts. The B8b Contract leaves both absent for the light steps and timeoutMs absent everywhere. The builder followed the Contract and banked the divergence as P-1605. R27 or the Contract needs one edit so the two agree.
- evidence: STANDARDS.md:208 compared with step-specs.ts: no spec sets timeoutMs, and 4 specs omit maxAttempts.
- blocking: false

### 6. app/tests/unit/automation/catalog.test.ts

- what: UNPROVEN, and stated as such by the author: `isImplemented("bump_catalog_version")` against the real registry is not asserted (the registry is empty on main), and the R28 real-registry case is vacuous until a step with an outside effect is implemented. Both must be tightened in g4. Also, the Plan type returned by planEvent carries no `warnings`, which the dry-run result in the Contract requires. That belongs to the later dry-run group and should be checked there.
- evidence: Read: catalog.test.ts lines 141-148 use stub registries only. src/server/jobs/steps/index.ts has `const catalog: readonly StepDefinition[] = [];`. plan.ts lines 46-51 have no warnings field.
- blocking: false

## c2s · steps 2

Recorded from the c2s review (no blocking defect). None is blocking. A fourth follow-up, about GOTCHAS.md, is banked as P-1614.

### 1. workspace/05-plans/B8b.md

- what: The plan's Files-list line for step-specs.test.ts still says the gate passes when 'some file under tests/ contains a test titled <type> runs twice ...'. The gate now asks vitest's unit and component projects only, which cover tests/unit/**, src/**/*.test.ts(x). A run-twice test placed in tests/db, tests/api or tests/e2e (a later B10 or B11 builder could reasonably put a post_* run-twice test in tests/api) will not be found, and the gate goes red. This fails closed, not open, and the author disclosed it as UNPROVEN. The plan text should be folded to match.
- evidence: Read app/vitest.config.ts: unit includes tests/unit/**/*.test.ts and src/**/*.test.ts, component includes *.test.tsx, and db includes tests/db and tests/api. testTitles() passes --project=unit --project=component over tests/unit and src only.
- blocking: false

### 2. app/tests/unit/automation/step-specs.test.ts

- what: Suspected by reading, not run. If spawnSync itself fails (for example node_modules/vitest/vitest.mjs is missing or execPath cannot start), child.stderr is null and child.error is dropped. The test still goes red, but the message reads 'vitest json report unreadable: null', and the cause it carries is the ENOENT on report.json, not the spawn error. That makes a CI failure of this kind slow to diagnose.
- evidence: Lines in testTitles(): spawnSync(...) result is used only as child.stderr in `throw new Error(`vitest json report unreadable: ${child.stderr}`, { cause: error })`; child.error and child.status are never read.
- blocking: false

### 3. app/.gitignore

- what: P-1613 records that vitest 5's json reporter writes .vitest/json/output.json into the app when no --outputFile is given, and that the folder is not ignored. Its rule leaves a person to remove it by hand before committing. The gate itself always passes --outputFile, so it is safe today. A one-line .vitest/ ignore would make the rule mechanical (H46-size change).
- evidence: grep -n vitest app/.gitignore .gitignore printed no ignore line. P-1613 cause text: 'that folder is not in .gitignore'.
- blocking: false

## c3r · steps 4

Recorded from the c3r review (no blocking defect). None is blocking. The GOTCHAS.md follow-up went to the bank (P-712 hit again), not here.

### 1. app/docs/runbooks/jobs.md

- what: Follow-up (STANDARDS C23; outside this group's files; the author recorded it). Line 96 still says pg_cron enqueues prune at 03:30 UTC. The schedules migration unschedules that job, and the runner drives prune from schedule_settings. Once main pushes the migration, the runbook is false.
- evidence: grep -rn prune docs/runbooks/*.md prints docs/runbooks/jobs.md:96 'pg_cron enqueues four system jobs ... `prune` at 03:30 UTC'. supabase/migrations/20261005000101_automation_schedules.sql: select cron.unschedule('prune').
- blocking: false

### 2. app/src/server/jobs/README.md

- what: Follow-up (not this group's file). The author named line 18 ('scheduler.ts ... a stub until B8b step 4'). Line 26 is stale in the same way: it still calls fanoutPendingEvents 'a stub until B8b step 4'.
- evidence: grep -n 'stub until B8b step 4' src/server/jobs/README.md matches lines 18 and 26.
- blocking: false

### 3. app/src/server/jobs/scheduler.ts

- what: Follow-up (plan risk; the author recorded it). If a row has neither last_run_at nor next_run_at, dueAt is nextRun(cron, now - 1 min), so the row is due only in the minute after its slot. A runner tick missed at 03:30 on the first day skips that day's prune, and a missed kpi_weekly tick skips the whole week. The code follows the plan's formula exactly. The fix belongs in the plan or the seed, for example by seeding next_run_at.
- evidence: Read src/server/automation/cron.ts:35-39. The author's probe in logs/B8b.md:466 shows 03:30:20 true and 03:31:05 false.
- blocking: false

### 4. app/src/server/jobs/scheduler.ts

- what: Follow-up (plan and code disagree; the author recorded it). Invariant 11 says the scheduler asks getStep(<key>). The code asks getSystemJob(key) at line 97, because steps/index.ts getStep does not merge the system types. The plan line needs folding.
- evidence: scheduler.ts:97 `getSystemJob(key) === undefined`; plan-brief invariant 11 'asks getStep(<key>) (B8's registry, which merges the system types)'.
- blocking: false

### 5. app/src/server/automation/fanout.ts

- what: Follow-up (STANDARDS C04, convention). fanoutEvent is a new export with no caller in src; per the plan, its callers are B6, B7 and B9. It carries neither the @public tag nor a STUB marker, which C04 asks of a later-slice export. knip passes only because the unit test imports it. The plan does name the function in this step.
- evidence: grep -rn 'fanoutEvent\b' src --include=*.ts finds nothing outside automation/fanout.ts; git show origin/main:app/src/server/automation/fanout.ts had only fanoutPendingEvents.
- blocking: false

### 6. app/supabase/migrations/20261005000100_automation_seed.sql

- what: Follow-up (a comment that is not true yet). The comment above the schedule_settings insert says keepwarm equals the wrangler.toml trigger and backup equals the schedule line of backup.yml. Neither exists yet: wrangler.toml has only the marker '# B8b adds the [triggers] crons line here.' (second half of step 4), and backup.yml has no schedule: cron line (B1b step 8). Both rows are harmless now (backup is disabled, and nothing fires keepwarm until the trigger lands).
- evidence: grep -n 'crons\|triggers' app/wrangler.toml prints only line 11, the marker; grep -n 'cron' .github/workflows/backup.yml finds no schedule cron.
- blocking: false

### 7. slice/b8b (branch)

- what: Follow-up. origin/main has moved to 3e7ddeb (B15 merged, including the webhook_omnikom step in steps/index.ts). The snapshot commit 7c7c42e is no longer up to date with main, so the merge gate will want main merged first. git merge-tree reports a clean merge and migrations:check still shows 28 on main. After the merge, re-run the step-specs and plan tests, because webhook_omnikom becomes an implemented step.
- evidence: git merge-base --is-ancestor origin/main HEAD → exit 1; git log HEAD..origin/main lists 3e7ddeb Merge pull request #132 (slice/b15); git merge-tree --write-tree → 0.
- blocking: false

## g4 · steps 4,4a

Recorded from the g4 review (no blocking defect). None is blocking. Three further items concerned GOTCHAS.md and are banked there, not listed here: the P-094 hit-again line (the double application, rule extended), the P-310 hit-again line (the reviewer brief's loader), the new P-1711 (the review snapshot shares refs, `origin/main` moved mid-review), and the B9 g6 line of P-154 that main lost, restored.

### 1. app/src/server/lib/log-events.ts

- what: All seven new LogEvent names went in twice (lines 27-33 and again 34-40). The duplicates are dead entries (STANDARDS C04). No test catches it, because log.test.ts compares the emitted list against [...LogEvent], duplicates included. The likely cause is the P-094 incident: the python/node patch that went to the background still applied, and the Edit tool then added the same lines again. Nothing breaks at runtime.
- evidence: Confirmed by running `git show 36d3271 -- app/src/server/lib/log-events.ts`: 14 '+' lines with the 7 names repeated. `git show 50e14b8:app/src/server/lib/log-events.ts | grep keepwarm` prints nothing, so the duplication comes from this group's commit and not from a merge.
- blocking: false

### 2. app/scripts/cf-purge-token.mjs

- what: Line 97 treats any failure of the verify call as 'refused': `verify(stored).catch(() => "refused")`. A network error, a Cloudflare 5xx or a zod parse error therefore falls through to line 126, which rolls mop-cache-purge to a new value. The same happens on every run in a checkout whose .env lacks the token, such as the orchestrator's E:/Matter Of Place. A roll silently invalidates the CF_PURGE_TOKEN already stored in the Supabase function secrets. Every later purge_cache job then gets 403, becomes a NonRetryableError and shows as a dead job on screen 16, until someone re-runs `supabase secrets set`. The script only prints 'written to .env', with no 'rolled, re-set the function secret' notice. The plan line says 'reused'. The impact is housekeeping only (architecture 13 rule 4), so this is not blocking.
- evidence: Found by reading cf-purge-token.mjs lines 95-127. The author's own unproven list says another checkout 'rolls the token and invalidates these'. Neither P-1616 nor the script's output warns about it.
- blocking: false

### 3. app/src/server/automation/step-specs.ts

- what: purge_cache now calls Cloudflare (this group made it an outside call), but its spec has no maxAttempts, so it falls to the default 5. R27 asks every type that calls an outside provider to have maxAttempts >= 10 and survive a 60-minute outage. The spec file belongs to step 2, not this group. step-specs.test.ts does not catch this, because purge_cache has sideEffect 'none'.
- evidence: Read step-specs.ts: the purge_cache entry (lines ~155-180) has no maxAttempts line; providerMaxAttempts = 12 is used only by other types.
- blocking: false

### 4. app/src/server/jobs/steps/purge-cache.ts

- what: This file is now an R32 adapter, but it classifies Cloudflare errors inline (429 / >=500 / other 4xx / success:false) and does not export an error table as R34 asks of each adapter. Behaviour matches the plan's outcomes.
- evidence: Read purge-cache.ts lines 40-50 and STANDARDS R34.
- blocking: false

### 5. workspace/05-plans/B8b.md

- what: Plan lines are stale against the code, and the orchestrator should fold them. Line 129 and step 4a still name /client/v4/user/tokens*, which P-1616 shows refuses the account-owned mop-admin, and still say an existing token is 'reused', where the script rolls it. The bump_catalog_version Files line says getStep("market_open_notice"), but the code uses getSystemJob, which is correct because B11's job is a system job.
- evidence: `sed -n 129p workspace/05-plans/B8b.md` against cf-purge-token.mjs lines 81, 103-126 and bump-catalog-version.ts line 15.
- blocking: false

### 6. app/src/server/scheduled.ts

- what: UNPROVEN, carried rather than defective. runKeepWarm has only run against fakeDb with a stub fetch. Its real wiring (Worker scheduled(), the keepwarm plugin, the wrangler.toml trigger) is step 5. The CI db job does not exist in ci.yml, so the plan's CI db line is UNPROVEN. The dev-job deploy after the merge has not been seen. Whether a tag purge reaches the cache.mop.internal entries is measured only after L1. My curl reached the currently deployed job-runner, which is not proven to be this branch's code.
- evidence: The author's unproven list. The curl returned http=200 with "claimed":0 but cannot identify which deployed code answered.
- blocking: false

## g5 · steps 5

Recorded from the g5 review (no blocking defect). Two further items concerned GOTCHAS.md and are banked there, not listed here: the merge-driver cost (a hit-again line on P-072) and the worker-start timeout of the review (a hit-again line on P-712).

### 1. app/scripts/automation-smoke.ts

- what: Follow-up, not blocking. Until a notify_admin module is registered, the smoke prints 'UNPROVEN: real run, ...' but still exits 0 (lines 176-185 and main). H1-31 in workspace/05-plans/H1.md:74 reads only the exit code of `bun run scripts/automation-smoke.ts`, so before B5 registers notify_admin that gate goes green without the real-run half of the exit. The author disclosed this. The orchestrator should decide whether H1-31 greps for the 'jobs for step: 0' line or the script exits non-zero on the UNPROVEN branch. One more thing for the same lane: once B5 registers send_email, the real event plans a queued send_received job. The deployed runner can claim it before cancelOpenJobs runs, which means a real email to the submitter of the newest mop-dev submission. That risk is already listed in the B8b log follow-ups.
- evidence: Seen by reading: src/server/jobs/steps/index.ts on 87198b8 registers no send_email and no notify_admin. Line 74 of workspace/05-plans/H1.md chains `&& bun run scripts/automation-smoke.ts &&` and checks no output. I did not re-run the smoke against mop-dev: it was not among this rework's proofs, and each run appends an event row to the one database.
- blocking: false

### 2. workspace/05-plans/H1.md

- what: Follow-up, not blocking, the orchestrator's file. H1.md line 114 and B8b.md step 5 still name the `/__scheduled` URL for the local scheduled test, and on the installed wrangler it answers 404. P-1622 banks this.
- evidence: Confirmed by running: with wrangler dev --test-scheduled on 8909, `curl -s -o /dev/null -w %{http_code} http://127.0.0.1:8909/__scheduled?cron=*%2F10+*+*+*+*` printed 404, and `/cdn-cgi/handler/scheduled?cron=...` printed 200 with a keepwarm_tick line.
- blocking: false

### 3. app/docs/runbooks/delivery.md

- what: Follow-up, not blocking. The deploy and clock paths changed but no runbook did. The 'Worker configuration' section (around line 106) does not say that wrangler.toml now holds `[triggers] crons = ["*/10 * * * *"]` or that matter-of-place and matter-of-place-dev carry it. The `preview` bullet (around line 225) does not say that pr-<n> is deployed from `.output/server/wrangler.preview.json` with no cron (scripts/preview-no-cron.mjs). STANDARDS C23 asks for a runbook update on a deploy or clock change, but step 5 names no runbook, so the orchestrator should fold this or assign it.
- evidence: Seen by reading: `grep -rn "keepwarm\|crons\|preview-no-cron\|wrangler.preview" app/docs/runbooks/delivery.md` gives no match, and the only keepwarm runbook lines are jobs.md:45 and :48 (heartbeat only).
- blocking: false

## g6 · steps 6

Recorded from the g6 review (no blocking defect). The seventh item concerned GOTCHAS.md and is banked there, not listed here: a hit-again line on P-154 and one on P-817.

### 1. app/src/server/automation/service.ts

- what: Line 185: the `auto_after` half of the agent approval guardrail has no test anywhere. The Contract says an agent gets 403 human_only when it changes `auto_after`. The code does that correctly today, but deleting the branch leaves every test green. automation.db.test.ts has no auto_after case for the database copy in automation_restore_revision either. The plan's proof list asks only for the `auto` case, so this is a follow-up, not a blocker.
- evidence: Confirmed by running: a scratch registry entry replacing `if (raised || (next.auto_after !== undefined && next.auto_after !== current.auto_after)) {` with `if (raised) {` and running `bunx vitest run --project unit tests/unit/automation/service.test.ts` gave `WATCHED-FAIL BAD: stayed green (R:rev-auto-after)`. `grep -n auto_after tests/unit/automation/service.test.ts tests/db/automation.db.test.ts` finds only the fixture value `auto_after: null`.
- blocking: false

### 2. app/src/server/automation/service.ts

- what: Lines 471-476: the agent PROTECTED_SCHEDULES check on the restore path is untested. This is the only layer that stops an agent key with chief_editor or admin and the automation scope from restoring a schedule revision that sets `enabled` false on backup, audit, prune, reconcile or keepwarm. automation_restore_revision has a database copy of the approval guard but none for schedules. The plan names only the approval guard for restore, so this is extra code that holds correctly but has no test.
- evidence: Confirmed by running: a scratch entry changing `if (actor.kind === "agent" && revision.table_name === "schedule_settings") {` to `actor.kind === "nobody"` gave `WATCHED-FAIL BAD: stayed green (R:rev-restore-schedule)`. supabase/sql/functions/automation_restore_revision.sql lines 97-116 check only `external_clock` for schedule_settings.
- blocking: false

### 3. app/supabase/sql/functions/automation_restore_revision.sql

- what: Suspected from reading, not run. An agent's restore of an automation_recipes or email_templates revision enqueues no notify_admin job. Only automation_put_recipe and automation_put_template do (SEC-11). An admin-role agent can therefore change a recipe through the restore route with no human notified. The plan's Contract names only the two put functions, so this is a note for the orchestrator or a later slice.
- evidence: grep -n notify_admin on automation_restore_revision.sql: no hit; automation_put_recipe.sql line 36: `if p_actor_kind = 'agent' then perform public.enqueue_job('notify_admin', ...)`.
- blocking: false

### 4. workspace/05-plans/B8b.md

- what: The plan text no longer matches the shipped code, which is the orchestrator's to fold. Line 103 (Audit) says put functions are followed only by an optional p_note, and Files line 110 says 'same signatures', but automation_put_reason now ends `p_note text default null, p_id uuid default null` (P-721). Line 162 still shows `automation_put_reason(p_id uuid, p_patch jsonb, ...)`. Revisions use B7's adminPageSchema `cursor=<at>~<id>`, not a `before` cursor. Invariant 14 calls flagsPutSchema the `.strict()` form of flagsSchema, but it is `z.record(z.enum(featureFlags), z.boolean())`; unknown keys are still refused, as tested. The author's log records every one of these deviations.
- evidence: sed -n '103p;110p;162p' workspace/05-plans/B8b.md against supabase/sql/functions/automation_put_reason.sql lines 1-8 and src/domain/flags.ts line 44.
- blocking: false

### 5. app/tests/mutations/B8b.json

- what: The committed entry b8b-g6-sql-recipe-audit replays BAD on mop-dev until main pushes 20261008065636_automation_audit.sql. Its test calls automation_put_reason with the new 4-argument form, which mop-dev does not have yet. It replays OK with the migration as prelude. Per H57 it is UNPROVEN in committed form until the push. Re-run it with --only after main pushes.
- evidence: dev profile, `node scripts/watchfail.mjs --registry tests/mutations --only b8b-g6-sql-recipe-audit` gave `WATCHED-FAIL BAD: wrong reason ... function public.automation_put_reason(unknown, unknown, unknown, unknown) does not exist`. The same entry with the migration prepended in a fresh scratch folder gave `WATCHED-FAIL OK`.
- blocking: false

### 6. app/scripts/gen-action-roles.mjs

- what: The step-6 proof names `bun run scripts/gen-action-roles.mjs`, and it was not run. The author says the matrix is unchanged and that the script writes a duplicate migration on every run. tests/unit/action-roles.sync.test.ts passes, so the seed equals the matrix. The proof line and the script's behaviour need an orchestrator ruling. Live HTTP calls to the 16 new routes are also UNPROVEN: they are covered only by the parity and authz sweep and by service unit tests against fakeDb.
- evidence: bunx vitest run tests/unit/action-roles.sync.test.ts passes (inside the 67/67 run). The author's own unproven list.
- blocking: false
