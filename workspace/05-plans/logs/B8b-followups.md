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
