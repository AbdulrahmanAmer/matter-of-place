# B8b — Automation console: build log

## g1 · steps 1

Branch `slice/b8b` from `origin/main` at 49e3799 (the merge fast-forwarded; no conflict).

What was built
- `app/supabase/migrations/20261004115859_automation.sql`: `automation_recipes` (18-trigger check), `email_templates`, `channel_settings` (`posting_window ? 'tz'`, `approval_mode` values `manual|auto`), `schedule_settings` (eight keys, `interval_days` 1 to 90), `automation_revisions` (indexes `(table_name, row_id, at desc)` and `(at desc)`), `event_fanout_failures` (JOB-07); `decline_reasons` gains `created_at` and `updated_at` and the two triggers, no policy; `jobs.recipe_id` foreign key `on delete set null` plus `jobs_recipe_idx` (R24: every foreign key leads an index); `updated_at`, `version_bump` (B2's `properties_version_bump`), `trigger_locked`, revision and `automation_revisions_immutable` triggers; RLS and grants per architecture 3.7; the fifteen functions, each composed byte for byte from its file in `supabase/sql/functions/` (DB-13).
- Every put function ends in `p_actor uuid, p_actor_kind actor_kind, p_request_id text[, p_note text default null]`, sets `mop.actor_id`, `mop.actor_kind`, `mop.note` with `set_config(..., true)` before its write, and carries the `write_audit` call behind `if to_regproc('public.write_audit') is not null` with the marker `-- STUB(B8b step 6): unconditional write_audit` (seven files).
- Error messages the functions raise were added to `src/server/lib/error-codes.ts` (API-03; `tests/unit/error-codes.test.ts` failed on them): `human_only` 403, `unknown_trigger` and `unknown_template` 404, `trigger_locked`, `unknown_field`, `external_clock`, `reorder_mismatch`, `nothing_to_restore` 422. Unknown rows elsewhere raise the existing `not_found` (P0002) and unknown patch keys of recipe, template, reason and channel raise the existing `invalid_patch_key`.
- `src/db/types.ts`: hand entries in the generator's shape (P-910): the six tables, `decline_reasons`' two columns, the `jobs_recipe_id_fkey` relationship and the twelve callable functions. UNPROVEN until main pushes the migration: then `bun run gen:types -- --db` must print `wrote src/db/types.ts` and `git diff --exit-code src/db/types.ts` exit 0; a diff means the hand entries were wrong and the regenerated file wins.
- Files outside the sized list that the step needed (P-513): `tests/db/rls.db.test.ts` (FIXTURES gain one row in each new table, or the matrix-as-behaviour cases read `rows 0` for staff selects), `src/server/lib/error-codes.ts` (above).
- `tests/db/schema-manifest.ts`: the six tables, `decline_reasons.created_at` and `updated_at`, `notPii` for `automation_recipes.name` and `automation_revisions.table_name`. `tests/db/rls-matrix.ts`: the six rows (`automation_recipes` select and update only; `event_fanout_failures` none).

Decisions and findings for the orchestrator
- `claim_schedule`'s three times take `default null` (P-915), so the TS scheduler can leave a null old `last_run_at` out; positional calls are unchanged.
- `automation_put_reason(p_id uuid, ...)` keeps the plan's signature, so its generated `Args` type `p_id` as `string`: the TS `putReason` cannot pass null for an insert without a cast (P-915). The plan pins the argument order and the trailing actor arguments, so this group did not move it. The TS group that writes `putReason` needs a ruling: either a migration giving `p_id` a default (and every argument after it one), or a separate insert function.
- A new reason with no `sort` goes last (`max(sort) + 1`); reorder positions are 1-based.
- `scripts/stubs.ts` does not see a SQL `-- STUB(` marker (banked as P-1600): the seven markers above are tracked here; step 6 confirms none is left with `git grep -n "STUB(B8b step 6)" -- app/supabase`.
- There is no `db` job in `.github/workflows/ci.yml` on main (B4 has not landed it), so the plan's "CI `db` job green on the pull request" cannot run. The database proof is mop-dev inside rolled-back transactions with the migration as `MOP_MUTATION_SQL` (P-312). The CI `db` job is UNPROVEN.

### Proof: dry pass in a rolled-back transaction (`bun run db:psql`)
From `app/` with the dev profile, `env -u CLOUDFLARE_API_TOKEN bun run db:psql -- -f <scratch>/dry.sql`, where `dry.sql` is `\set ON_ERROR_STOP on`, `begin;`, `\i supabase/migrations/20261004115859_automation.sql`, a count of the six tables, `rollback;`:
```
CREATE POLICY
CREATE POLICY
 tables 
--------
      6
(1 row)

ROLLBACK
exit=0
```

### Proof: database tests on mop-dev with the migration as prelude (P-312, file by file)
`eval "$(node scripts/load-env.mjs --profile dev)"; export MOP_MUTATION_SQL="$(cat supabase/migrations/20261004115859_automation.sql)"; env -u CLOUDFLARE_API_TOKEN node node_modules/vitest/vitest.mjs run --project db tests/db/<file>`:
```
== automation
      Tests  22 passed (22)
== schema
      Tests  51 passed (51)
== rls
      Tests  14 passed (14)
== function-source
      Tests  1 passed (1)
```
First run of `automation` was `Tests  2 failed | 20 passed (22)`: two test defects, fixed in the test. The guarded claim got `"first": false` because the fixture's `last_run_at` came back as a JS `Date` without microseconds (banked G-700); the reason case compared with `max(sort)` read in the same statement as the insert, which cannot see it. The rerun after the last test edit: `Tests  22 passed (22)`.

### Proof: watched-fail, every entry of `tests/mutations/B8b.json` (26)
Replayed with the migration prepended to each entry's `sql`, through `node node_modules/vitest/vitest.mjs` (P-312; the scratch replayer rewrites each `bunx vitest run` line to that form):
```
GOOD b8b-g1-put-actor-kind exit=1 Tests  1 failed | 21 skipped (22)
GOOD b8b-g1-version-bump exit=1 Tests  1 failed | 21 skipped (22)
GOOD b8b-g1-direct-note exit=1 Tests  1 failed | 21 skipped (22)
GOOD b8b-g1-clock-exempt exit=1 Tests  1 failed | 21 skipped (22)
GOOD b8b-g1-append-only exit=1 Tests  1 failed | 21 skipped (22)
GOOD b8b-g1-trigger-locked exit=1 Tests  1 failed | 21 skipped (22)
GOOD b8b-g1-unknown-trigger exit=1 Tests  1 failed | 21 skipped (22)
BAD  b8b-g1-commercial-update exit=1 Tests  1 failed | 21 skipped (22)
     × a commercial staff user cannot update a recipe 2484ms
AssertionError: expected 1 to be +0 // Object.is equality
GOOD b8b-g1-admin-insert exit=1 Tests  1 failed | 21 skipped (22)
GOOD b8b-g1-claim-guard exit=1 Tests  1 failed | 21 skipped (22)
GOOD b8b-g1-claim-enabled exit=1 Tests  1 failed | 21 skipped (22)
GOOD b8b-g1-claim-unguarded exit=1 Tests  1 failed | 21 skipped (22)
GOOD b8b-g1-schedule-next-reset exit=1 Tests  1 failed | 21 skipped (22)
GOOD b8b-g1-unknown-field exit=1 Tests  1 failed | 21 skipped (22)
GOOD b8b-g1-external-clock exit=1 Tests  1 failed | 21 skipped (22)
GOOD b8b-g1-unknown-template exit=1 Tests  1 failed | 21 skipped (22)
GOOD b8b-g1-agent-notify exit=1 Tests  1 failed | 21 skipped (22)
GOOD b8b-g1-human-no-notify exit=1 Tests  1 failed | 21 skipped (22)
GOOD b8b-g1-reason-last exit=1 Tests  1 failed | 21 skipped (22)
GOOD b8b-g1-reorder-changed-only exit=1 Tests  1 failed | 21 skipped (22)
GOOD b8b-g1-restore-note exit=1 Tests  1 failed | 21 skipped (22)
GOOD b8b-g1-nothing-to-restore exit=1 Tests  1 failed | 21 skipped (22)
GOOD b8b-g1-human-only exit=1 Tests  1 failed | 21 skipped (22)
GOOD b8b-g1-decline-policies exit=1 Tests  1 failed | 21 skipped (22)
GOOD b8b-g1-rls-row exit=1 Tests  1 failed | 13 skipped (14)
GOOD b8b-g1-manifest exit=1 Tests  1 failed | 50 skipped (51)
replayed: 1 bad
```
The one BAD was red for the right reason; its `expect` had lost a backslash to `sed` (P-008, hit again) and could not match `+0`. After the fix, the entry alone:
```
GOOD b8b-g1-commercial-update exit=1 Tests  1 failed | 21 skipped (22)
replayed: 0 bad
```

### Proof: `bun run check` and `bun run build` in `app/` (background, P-712)
Run 1 (`node ../workspace/05-plans/quiet.mjs -- bun run check`): every stage green to the tests, then
```
 ❯ |unit| tests/unit/error-codes.test.ts (3 tests | 1 failed) 69ms
     × holds every message a migration raises 49ms
 Test Files  1 failed | 103 passed (104)
      Tests  1 failed | 1348 passed (1349)
     Errors  3 errors
```
(the nine new messages, plus three `Failed to start forks worker` errors). The codes were added to `error-codes.ts`; `bunx vitest run --project unit tests/unit/error-codes.test.ts` → `Tests  3 passed (3)`.
Run 2: layout, typecheck, lint, knip, jscpd, stubs and format green; the test stage exited 1 with only the worker-start error:
```
Vitest caught 2 unhandled errors during the test run.
Error: [vitest-pool]: Failed to start forks worker for test files E:/mop-build/auto/app/tests/unit/turnstile-client.test.tsx.
Error: [vitest-pool]: Failed to start forks worker for test files E:/mop-build/auto/app/tests/unit/owner-presented.test.tsx.
error: script "check" exited with code 1
```
`bun run test` alone (P-712):
```
 FAIL  |unit| tests/unit/hygiene.test.ts > the orchestrator's merge script is under the app's gates (H42 (2), G-032) > lint gives prettier/prettier the options of .prettierrc for it
Error: Test timed out in 20000ms.
 Test Files  1 failed | 106 passed (107)
      Tests  1 failed | 1361 passed (1362)
```
That case alone (P-152, its own 20 s timeout on a loaded laptop): `bunx vitest run --project unit tests/unit/hygiene.test.ts -t "lint gives prettier"` → `Tests  1 passed | 55 skipped (56)`. No assertion failed in any run after the error-codes fix; a fully green single `bun run check` was not observed on this laptop under the other lanes' load.
`node ../workspace/05-plans/quiet.mjs -- bun run build` → `quiet: ok (248 lines, showing the last 12)`, exit 0.

UNPROVEN: the CI `db` job (it does not exist on main); `gen:types` equality with the hand entries (after main pushes); the B7 catalog case (every `p_actor` function calls `write_audit(`), which holds by text but runs only when B7 lands.

### Proof: CI on PR 115 (draft) at 3dfd1e0
`gh pr checks 115`:
```
build	pass	34s	https://github.com/AbdulrahmanAmer/matter-of-place/actions/runs/37206205925/job/111447799880
check	pass	2m21s	https://github.com/AbdulrahmanAmer/matter-of-place/actions/runs/37206205925/job/111447800031
preview-db	pass	13s	https://github.com/AbdulrahmanAmer/matter-of-place/actions/runs/37206205940/job/111447799840
```
CI's `check` job runs the whole `bun run check` (tests included) green, which the loaded laptop could not show in one run. No `db` job ran: none exists on main.

## g1 · follow-ups recorded

Review of g1 found no blocking defect and seven follow-ups; no code changed. Gotcha entries: P-1601 (a read in the same statement as the inserting function), P-1602 (dry pass deadlock from another lane's locks), plus hit-again lines on P-312 (bun crash on the prelude replay) and P-713 (reused scratch registry folder, force-killed watchfail). The other four follow-ups (approval_mode CHECK shape, em dash in this log's title, put_reason and claim_schedule signatures, SQL stub markers and the missing db job) are in `workspace/05-plans/logs/B8b-followups.md` under "## g1 · steps 1".

## g2 · steps 2-3

Branch `slice/b8b`, brought up to `origin/main` at the start (fast-forward, no conflict).

What was built
- `src/domain/events.ts`: `eventTypes` (18), `EventType`, `tiers`, `marketSlugs` (from `marketSlugSchema`), `assetKinds`, `eventPayloadSchemas` (one passthrough object per type, ids as uuid).
- `src/domain/automation.ts`: `conditionsSchema` (strict, non-empty lists), `stepSchema`, `recipeSchema` (at most 20 steps, unique ids with the path of the second), `declineReasonSchema`, `channelSettingsSchema` with the posting window (ISO weekdays 1 to 7, `HH:MM`, validated `tz`, `daily_cap` 1 to 25 default 2), `scheduleSettingsSchema`, `scheduleSettingsPutSchema` (strict, four keys), `effectiveApprovalMode(settings, tier, today)` with `today` a `YYYY-MM-DD` string (no clock, R29), `skipReasons` and the three label maps.
- `src/server/automation/step-specs.ts`: the 17 specs as `Record<StepType, StepSpec>`, `fields` descriptors, `local: true` on `write_captions` only, `maxAttempts` 12 for provider and heavy steps and absent for the four light ones (`defaultMaxAttempts` 5 is applied by the planner), `timeoutMs` absent everywhere, `sideEffect` on all.
- `src/server/automation/catalog.ts`: `listStepSpecs`, `getSpec`, `isImplemented(type, registry = getStep)`, `stepForChannel`.
- `src/server/automation/plan.ts`: pure `planEvent(recipe, event, { registry })`, `matchesConditions`, `PlannedJob` (the keys `fanout_insert_jobs` reads), `SkipReason`. The registry is a required argument of the context, so the planner has no default and no clock; g4's fan-out passes `getStep`.
- Files outside the group list that step 2 needs (P-513): `src/server/jobs/types.ts` (`SideEffect`, required `sideEffect` on `SystemJobDefinition`), the five system jobs (`health`, `prune`, `reconcile`, `retention`, `meta_token_refresh`: one line each) and `src/server/jobs/system/index.ts` (`listSystemJobs`), because the step says every system type declares `sideEffect` and the test iterates B8's system registry. A later slice that registers a system job now fails typecheck until it declares `sideEffect`; that is the gate HO-7 wants.
- `tests/mutations/B8b.json`: 54 `b8b-g2-*` entries, one or more for each of the 52 test titles.

Decisions and findings for the orchestrator
- R27 against the Contract (P-1605): R27 says every spec declares `timeoutMs` and `maxAttempts`; the Contract leaves both absent for most steps and `write_captions` has no `timeoutMs`. Built to the Contract; the planner reports the effective `max_attempts`.
- `isImplemented("bump_catalog_version")` against the real registry is not asserted yet (the registry is empty on main); the stub-registry case is. Tighten it in g4.
- The R28 case against the real registry is vacuous until an implemented step has an outside effect. The helper case proves the logic, and the watched-fail `specs-run-twice-real` puts a `send_email` module in the real registry and goes red naming it.
- `post_meta.channels` is a union of `"from_settings"` and a list, so its descriptor is `multiselect` with default `"from_settings"` and the hint "Empty uses the enabled channels in settings"; g5's form maps an empty selection to `from_settings`.
- `eslint-disable` on `Intl.DateTimeFormat` for the zone check (P-1603); knip needed tests for plan-named exports (P-1604).
- Posting-window `days` are ISO weekdays 1 to 7; B10 reads them that way (the seed's `[1,2,3,4,5]` is Monday to Friday either way).

### Proof: `bunx vitest run tests/unit/automation/catalog.test.ts tests/unit/automation/approval.test.ts tests/unit/automation/step-specs.test.ts`
```
 Test Files  3 passed (3)
      Tests  37 passed (37)
```
### Proof: `bunx vitest run tests/unit/automation/plan.test.ts`
```
 Test Files  1 passed (1)
      Tests  15 passed (15)
```
### Proof: watched-fail replay of the 54 new entries (fresh folder holding only them, P-713)
`node scripts/watchfail.mjs --registry <fresh folder>`:
```
watchfail: replayed 54: ok 54, bad 0, stale 0; manual 0 not replayed; 0 not selected
```
Brief items: (b) `plan-condition-filter`, (f) `catalog-fields-entry`, (h) `catalog-isimplemented` and `plan-is-implemented`, (i) `approval-tz-required`, (u) `plan-one-confirm`, (v) `plan-skip-order`, (ah) `specs-attempts`, (al) `specs-run-twice-real` and `specs-run-twice-helper`, (am) `specs-local` and `plan-spec-local`, each red for its title.

### Proof: `bun run check` (from `app/`)
```
quiet: ok (50 lines, showing the last 12)
exit=0
```
It ran layout, typecheck, lint, knip, jscpd, stubs, format and the unit and component tests (111 files). Before the registry entries existed it was red only on `mutation-registry.test.ts` (`name every test file as the test of at least one entry`), which is the gate for this group's four new test files.
### Proof: `bun run build`
```
quiet: ok (241 lines, showing the last 12)
exit=0
```

UNPROVEN: the `isImplemented` real-registry case for `bump_catalog_version` (g4); the R28 real-registry case for a real external step (it needs one implemented).

## g2 · follow-ups recorded

The g2 review found no blocking defect. Seven follow-ups: one is a cost mapped to the wrong gotcha entry and is banked as a "hit again" line in P-076 (no new entry; P-1604 covers only knip). The other six are recorded in `workspace/05-plans/logs/B8b-followups.md` under "## g2 · steps 2-3" for the orchestrator to fold or assign. No code changed.

## g3 · steps 4 (first half)

Branch `slice/b8b`, brought up to `origin/main` at the start (already up to date). Local commit `edaac8d` before the replays.

What was built
- `src/server/automation/cron.ts`: `nextRun` (cron-parser, UTC), `startOfUtcDay`, `scheduleNext`, `dueAt`, `isDue`, exactly as invariant 12.
- `src/server/jobs/scheduler.ts`: `runDueSchedules(db, now)` for `digest`, `prune`, `reconcile`, `kpi_weekly`, `newsletter_hygiene`: one guarded `claim_schedule`, then emit or enqueue, a rollback claim on a throw, the advance-only branch with `// STUB(B11): kpi_weekly and newsletter_hygiene registered`. `keepwarm`, `audit` and `backup` are never claimed here.
- `src/server/automation/fanout.ts`: `fanoutEvent(db, eventId)` and `fanoutPendingEvents(db, limit)`; one `fanout_insert_jobs` per event, the sweep reads `fanout_pending_events`, a failure logs `fanout_failed` `{ eventId, code }`, calls `record_fanout_failure`, and after one hour enqueues `notify_admin` keyed `fanout_failed:<event_id>`. An invalid payload is planned raw and logged `fanout_payload_invalid`.
- `src/server/lib/log-events.ts`: the six `fanout_*` and `schedule_*` names (g4 appends the rest).
- `cron-parser` 5.10.1 in `package.json` and `bun.lock`, `"cron-parser": "npm:cron-parser@5.10.1"` in `supabase/functions/job-runner/deno.json`, `deno.lock` regenerated with B8's `deno cache --lock=...` command.
- `supabase/migrations/20261004163000_automation_seed.sql` (18 recipes, 6 decline reasons, 6 channel rows with `tz`, 8 schedule rows; every insert `on conflict do nothing`) and `20261004163001_automation_schedules.sql` (`cron.unschedule('prune')` guarded by `where exists`). No schema change, so `src/db/types.ts` is unchanged (no `gen:types` needed).
- Tests: `tests/unit/automation/{cron,scheduler,fanout}.test.ts`, six cases appended to `tests/db/automation.db.test.ts` (they run the migration file text inside the rolled-back transaction, so they hold before and after `main` pushes it), 41 entries `b8b-g3-*` in `tests/mutations/B8b.json`.
- Outside the group list (P-513): `tests/unit/jobs/runner.test.ts` (B8) mocked fanout and scheduler with `{ spy: true }`, which runs the real code; with the real bodies 33 of 39 cases failed on `unexpected rpc fanout_pending_events`. The two mocks are now bare `vi.mock(import(...))` (P-1607). Its 33 registry entries replay OK.

Decisions and findings for the orchestrator
- Plan line (invariant 11): "`getStep(<key>)` (B8's registry, which merges the system types)". `getStep` does not merge them; the runner uses `getStep(type) ?? getSystemJob(type)`. The scheduler asks `getSystemJob(key)`, where B11 registers both types (P-1608).
- Plan command `bun add --exact cron-parser@5` stored `"5"`; pinned by hand to `5.10.1` (P-1606).
- `fanoutEvent` reads the event and the recipe with `.eq(...)` table reads; `fakeDb` ignores filters, so each fanout test registers only the matching rows.
- A `record_fanout_failure` error throws `unavailable` and ends the sweep (no log name exists for it; a database that cannot record is down for the rest of the tick too).
- A bad `cron` text in a `schedule_settings` row would throw from `isDue` and end the tick; g5's put validates `cron` through `nextRun`, so only a direct SQL edit can store one. Not handled here (not in the Contract).
- The dry-run equality case compares `planEvent` with the RPC's `p_jobs` until g5 re-points it at `dryRun`.
- Seed copy (decline paragraphs, recipe names) is ASSUMED, for the CEO's review before launch.
- Watched-fail `b8b-g3-fan-recipe-edit` is `manual`: invariant 5 is structural (the RPC arguments are built before the edit and both zod parses copy params), so no one-file mutation can alias them.

### Proof: `bunx vitest run tests/unit/automation/cron.test.ts tests/unit/automation/scheduler.test.ts tests/unit/automation/fanout.test.ts`
```
 Test Files  3 passed (3)
      Tests  32 passed (32)
```
### Proof: `bunx vitest run tests/unit/readpath.test.ts -t "table writes"`
```
 Test Files  1 passed (1)
      Tests  1 passed | 4 skipped (5)
```
### Proof: `deno check --frozen --config supabase/functions/job-runner/deno.json supabase/functions/job-runner/index.ts` (from `app/`)
```
Check supabase/functions/job-runner/index.ts
deno exit=0
```
### Proof: `bun run scripts/stubs.ts`
```
src/server/jobs/scheduler.ts:83 STUB(B11): kpi_weekly and newsletter_hygiene registered
stubs: 10 markers, 0 on closed slices
```
(no `STUB(B8b step 4)` marker left; the other nine markers belong to B3b, B8, B15, B5 and B9.)
### Proof: `grep -rn "reconcile_uploads\|reconcile-uploads\|has_markets\|build_issue" src supabase` → no output, exit 1. The em dash grep of the brief (U+2014) over `supabase/migrations/*automation_seed.sql` → no output, exit 1.
### Proof: db tests on mop-dev inside rolled-back transactions (P-312); the CI `db` job does not exist on main (`ci.yml` has `run`, `check`, `build`, `merge-gate`), so it is UNPROVEN
`env -u CLOUDFLARE_API_TOKEN node node_modules/vitest/vitest.mjs run --project db tests/db/automation.db.test.ts` (dev profile):
```
      Tests  28 passed (28)
```
Whole db project with `MOP_MUTATION_SQL` = the two new migrations:
```
 FAIL  |db| tests/db/gate.db.test.ts > publish gate > publish_incomplete without country
error: deadlock detected
 FAIL  |db| tests/db/jobs.db.test.ts > health_counts > returns backup null while schedule_settings is absent
AssertionError: expected { absent: false, backup: { …(2) } } to deeply equal { absent: true, backup: null }
 Test Files  2 failed | 28 passed (30)
      Tests  2 failed | 442 passed (444)
```
The gate case is another lane's lock (P-1602, P-322): `tests/db/gate.db.test.ts` alone with the same prelude → `Tests  30 passed (30)`. The jobs case is B8's, red on mop-dev since g1's `schedule_settings` table was pushed, whatever this group does (P-916, B8 follow-up). `tests/db/integrity.db.test.ts`, slow in a first loaded run, alone → `Tests  51 passed (51)`.
### Proof: watched-fail replays (one id per call, P-066)
```
WATCHED-FAIL OK B8b:b8b-g3-<id>   for all 40 replayable entries (32 unit, lint and deno, 8 db)
```
Brief items: (g) `b8b-g3-g`, (t) `b8b-g3-t`, (y) `b8b-g3-y`, (ac) `b8b-g3-ac`, (a) `b8b-g3-a` (fan-out against `planEvent` until g5), (ah) `b8b-g3-ah`, (an) `b8b-g3-an`, (aj) `b8b-g3-aj` (eslint: `Deno-loaded file: import with the .ts extension`) and `b8b-g3-aj-deno` (`Type checking failed`), seed idempotency `b8b-g3-seed-twice`. B8's 33 runner-test entries from a fresh folder: `watchfail: replayed 33: ok 33, bad 0, stale 0`.
### Proof: `bun run check` (from `app/`)
```
quiet: ok (47 lines, showing the last 12)
exit=0
```
### Proof: `bun run build`
```
quiet: ok (235 lines, showing the last 12)
```
### Proof: `node scripts/check-migrations.mjs` after the commit
```
migration-order: OK (25 on main, 2 added)
```

UNPROVEN until after the merge and the `dev` job: the five `select`s on mop-dev (18 recipes, eight schedules, no `prune` in `cron.job`, a `tz` per channel, a scheduler `reconcile:<date>T<HH:MM>` job `done`), the `job-runner` deploy as the runtime import proof of `npm:cron-parser@5.10.1`, and the `curl` of the runner answering 200 with `"claimed"`. The `settings.flags` select waits on B3b. The CI `db` job: none exists.
Bank: P-1606, P-1607, P-1608, P-1609 added, P-094 hit again.
