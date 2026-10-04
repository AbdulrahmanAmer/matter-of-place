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

### g3 · merge of main after the first push
`git merge origin/main` (B3b PR 122: coming-soon migration `20261004155556`, earlier than this group's two) merged with no conflict; `check-gotchas` OK, `bun install` no changes, `migration-order: OK (25 on main, 2 added)`. After the merge `bun run check` → `quiet: ok (47 lines, showing the last 12)`, `exit=0`; `bun run build` → `quiet: ok (235 lines, showing the last 12)`, `build exit=0`.
B3b's flags row is on mop-dev now: `bun run db:psql -- -Atc "select value from public.settings where key = 'flags';"` → `{"new_channels": false, "archive_pages": false}`.

## g3 · steps 4 (first half) · rework after review (2026-10-04)
Blocking defect fixed: `fanoutPendingEvents` caught each event's error but awaited `recordFailure` inside the catch, so a
failing `record_fanout_failure` (deterministic `interval out of range` from about the 37th failure of one event) left
the sweep and cost the runner's whole tick. The catch now catches the recorder too and logs
`fanout_failure_unrecorded` with `{ eventId, code }` (new LogEvent name), and the loop goes on. Follow-ups inside g3's
files also done: `scheduler.ts` logs `schedule_cron_invalid` for a hand-edited invalid cron and skips the row
(`dueNext`), and the recipe-edit case of `fanout.test.ts` now edits the stored params object in place (registry entry
stays `manual`: two defensive copies, one-file mutations stay green, the two-file replay was run red, P-1611).
Not g3's files, left for the orchestrator: g1's `record_fanout_failure.sql` exponent overflow (cap the exponent, and fold
the B8b plan formula), and `app/docs/runbooks/jobs.md` line 96 still naming pg_cron `prune` (STANDARDS C23).
Bank: P-1610, P-1611 added; hit-again lines on P-027 (output hidden by a pipe) and P-310 (registry replay of db entries).
Main merged first (`git merge origin/main`, 4 commits of B8), check-gotchas OK.

- `bunx vitest run tests/unit/automation/cron.test.ts tests/unit/automation/scheduler.test.ts tests/unit/automation/fanout.test.ts`
  Test Files  3 passed (3) / Tests  34 passed (34)
- `bunx vitest run tests/unit/readpath.test.ts -t "table writes"`
  Test Files  1 passed (1) / Tests  2 passed | 3 skipped (5)
- dev profile + `env -u CLOUDFLARE_API_TOKEN -u SUPABASE_ACCESS_TOKEN bunx vitest run --project db tests/db/automation.db.test.ts`
  Test Files  1 passed (1) / Tests  28 passed (28)  (local run against mop-dev; the CI `db` job is the proof of record)
- `deno check --frozen --config supabase/functions/job-runner/deno.json supabase/functions/job-runner/index.ts` → `Check supabase/functions/job-runner/index.ts`, exit 0
- `bun run scripts/stubs.ts` → no `STUB(B8b step 4)` marker (count 0); `stubs: 10 markers, 0 on closed slices`
- `grep -rn "reconcile_uploads\|reconcile-uploads\|has_markets\|build_issue" src supabase` → nothing, exit 1
- `grep -rn "—" supabase/migrations/*automation_seed.sql` → nothing, exit 1
- watched-fail, new and changed entries: `b8b-g3-fan-unrecorded` (`.catch(` to `.finally(`), `b8b-g3-sch-cron-invalid`
  (catch rethrows), `b8b-g3-y` (catch rethrows), `b8b-g3-sch-runner-keys` (guard line removed): each `WATCHED-FAIL OK`.
  Full replay in the dev shell, `watchfail.mjs --registry tests/mutations --changed origin/main`:
  `watchfail: replayed 207: ok 207, bad 0, stale 0; manual 2 not replayed; 1669 not selected`
- `bun run check` → layout, typecheck, lint, knip, jscpd, stubs, format, unit and component tests all passed (quiet: ok)
- `bun run build` → quiet: ok
UNPROVEN until after the merge and the `dev` job: the post-merge selects (18 recipes, eight schedule rows, no `prune` in
cron.job, a `tz` per channel), the `job-runner` deploy and its 200 with `"claimed"`, and the scheduler's `reconcile` job
row. The `settings.flags` select waits on B3b.

### g3 rework · second merge of main (PR #124 showed CONFLICTING)
`git merge origin/main` at 416cb75: GOTCHAS.md P-094 compared by hand (main's two B9 g7 hit-again lines folded in),
check-gotchas OK. After the merge:
- `bunx vitest run` of the three g3 files → Tests  34 passed (34); `deno check --frozen ...` exit 0; `bun run build` ok
- `bun run check` → RED, one test outside g3's files:
  FAIL |unit| tests/unit/automation/step-specs.test.ts > step specs > finds a run-twice test for every implemented type with an outside effect
  AssertionError: expected [ 'render_variants', …(3) ] to deeply equal []   (render_variants, render_cover, render_carousel, render_story)
  Tests  1 failed | 1649 passed (1650)
  Cause: B9 (merged to main, PR #117) registered the four render steps without R28 run-twice cases; g2's gate first
  meets them here. Owner: B9's `tests/unit/assets/steps.test.ts` (one `<type> runs twice without a second outside
  effect` case each). Not fixed by g3 (not its files). Banked as P-1612.

### g3 rework · migrations renamed (CI migration-order red on the merge head)
CI run 37226895685, job `migration-order`: `rename supabase/migrations/20261004163000_automation_seed.sql to a
timestamp after 20261004172322` (and the same for `..._automation_schedules.sql`). Renamed with `git mv` to
`20261004190700_automation_seed.sql` and `20261004190701_automation_schedules.sql`, content unchanged; the two registry
`file` paths follow. P-318 hit again (the staged rename crashed the local check with ENOENT; committed first).
- `bun run migrations:check` → migration-order: OK (27 on main, 2 added)
- dev profile, `bunx vitest run --project db tests/db/automation.db.test.ts` → Test Files 1 passed (1) / Tests 28 passed (28)
- `watchfail.mjs --only` b8b-g3-seed-twice, b8b-g3-schedules-prune, b8b-g3-schedules-no-reconcile-uploads → WATCHED-FAIL OK each
- `grep -rn "—" supabase/migrations/*automation_seed.sql` → nothing, exit 1

### g3 rework · CI on 2070a9e
- ci run 37227263805: `build` success, `check` failure, only the integration red above:
  FAIL unit tests/unit/automation/step-specs.test.ts > step specs > finds a run-twice test for every implemented type
  AssertionError: expected [ 'render_variants', …(3) ] to deeply equal []   (B9's render steps, P-1612; not g3's files)
  `migration-order` passes now (it was the job that failed on d9f2d2d).
- deploy run 37227263854: `preview-db` success; `dev`, `preview`, `production` skipped.
- CI `db` job: does not exist (`ci.yml` jobs are check, build, merge-gate), so that proof is UNPROVEN; the database
  proof of record is the local dev-profile run above (28 passed) inside rolled-back transactions (P-312 hit again).

## g3 · steps 4 (first half) · second rework after review (2026-10-04)
Blocking defect (step-specs.test.ts R28 gate red after merging main): NOT FIXED by g3, BLOCKED on a file outside g3.
The review's premise, and P-1612 as first written, were wrong: B9 does carry the four run-twice cases, as one
`it.each([...renderTypes, { type: "render_variants", kind: "variants" }])("$type runs twice without a second outside
effect", ...)` at `tests/unit/assets/steps.test.ts:323`. The gate's `testTitles()` matches only literal `it("...")` and
`test("...")` titles, so it cannot see an `it.each` template. The fix belongs in g2's
`tests/unit/automation/step-specs.test.ts` (expand `.each` templates, or read the titles vitest runs), not in B9's file
and not by weakening the gate. P-1612 corrected in the bank.
- `bunx vitest run tests/unit/assets/steps.test.ts -t "runs twice" --reporter=verbose | grep -v "↓" | grep "runs twice"`
   ✓ |unit| tests/unit/assets/steps.test.ts > the render steps > render_cover runs twice without a second outside effect 41ms
   ✓ |unit| tests/unit/assets/steps.test.ts > the render steps > render_carousel runs twice without a second outside effect 7ms
   ✓ |unit| tests/unit/assets/steps.test.ts > the render steps > render_story runs twice without a second outside effect 3ms
   ✓ |unit| tests/unit/assets/steps.test.ts > the render steps > render_variants runs twice without a second outside effect 2ms
   ✓ |unit| tests/unit/assets/steps.test.ts > render_og_static > render_og_static runs twice without a second outside effect 1ms
Re-run of every proof on 0d8358e (no code change in this round):
- `bunx vitest run tests/unit/automation/cron.test.ts tests/unit/automation/scheduler.test.ts tests/unit/automation/fanout.test.ts`
   Test Files  3 passed (3) /      Tests  34 passed (34)
- `bunx vitest run tests/unit/readpath.test.ts -t "table writes"`
   Test Files  1 passed (1) /      Tests  1 passed | 4 skipped (5)
  (correction: the first rework block above pasted "2 passed | 3 skipped (5)"; this run, like the first g3 block, prints 1 | 4)
- dev profile, `env -u CLOUDFLARE_API_TOKEN -u SUPABASE_ACCESS_TOKEN bunx vitest run --project db tests/db/automation.db.test.ts`
   Test Files  1 passed (1) /      Tests  28 passed (28)   (local, mop-dev, rolled back; there is no CI `db` job: UNPROVEN as the plan words it)
- `deno check --frozen --config supabase/functions/job-runner/deno.json supabase/functions/job-runner/index.ts` → deno exit 0
- `bun run scripts/stubs.ts` → 0 lines with `STUB(B8b step 4)`; `stubs: 10 markers, 0 on closed slices`
- `grep -rn "reconcile_uploads\|reconcile-uploads\|has_markets\|build_issue" src supabase` → nothing, exit 1
- `grep -rn "—" supabase/migrations/*automation_seed.sql` → nothing, exit 1
- `bun run check` → RED, exit 1, only the gate:
   FAIL  |unit| tests/unit/automation/step-specs.test.ts > step specs > finds a run-twice test for every implemented type with an outside effect
  AssertionError: expected [ 'render_variants', …(3) ] to deeply equal []
   ❯ tests/unit/automation/step-specs.test.ts:118:57
- `bun run build` → quiet: ok
Follow-ups not in g3's files, left as the review marked them: g1's `record_fanout_failure.sql` exponent overflow,
`docs/runbooks/jobs.md:96` (pg_cron prune), `src/server/jobs/README.md:18,26` (stale "stub until B8b step 4"), plan
fold of `fanout_failure_unrecorded` and `schedule_cron_invalid`, and invariant 12's one-minute first-slot window for a
row with both clocks null (cron.ts follows the plan as written).
UNPROVEN until after the merge and the `dev` job: the post-merge selects, the `job-runner` deploy and its 200 with
`"claimed"`, and the scheduler's `reconcile` row.

## c2s · steps 2
Started from main at 416cb75 (git merge-base origin/main HEAD); code commit 0cd72a8, handed in with the log commit that follows it. Defect fixed: the R28 gate read only literal `it("...")` titles and missed B9's `it.each` table.
Change: `testTitles()` in `tests/unit/automation/step-specs.test.ts` now runs `vitest run --project=unit --project=component --testNamePattern="runs twice" --reporter=json --outputFile=<tmp>` on the files under `tests/unit` and `src` that contain the words (not itself) and reads the `title` of every passed or failed result. The db project is not asked (UNPROVEN for a run-twice test that lives under `tests/db`: there is none today). The stale registry entry `b8b-g2-specs-run-twice-real` (its `find` no longer occurs in `src/server/jobs/steps/index.ts` since B9 landed) is replaced by `b8b-c2s-run-twice-each-row`; `b8b-c2s-run-twice-reporter` covers the reporter filter.
- `bunx vitest run tests/unit/automation/catalog.test.ts tests/unit/automation/approval.test.ts tests/unit/automation/step-specs.test.ts`
   Test Files  3 passed (3) /      Tests  37 passed (37)
- watched-fail by hand: deleted the `render_story` row of `renderTypes` in `tests/unit/assets/steps.test.ts`, then `bunx vitest run --project unit tests/unit/automation/step-specs.test.ts`
   × finds a run-twice test for every implemented type with an outside effect
   AssertionError: expected [ 'render_story' ] to deeply equal []     (file restored from a copy; `git status` shows only my three files)
- `node scripts/watchfail.mjs --registry tests/mutations --only <id>` for the 8 entries that name step-specs.test.ts (after prettier):
   WATCHED-FAIL OK B8b:b8b-g2-specs-attempts, -light-default, -local, -heavy, -side-effect, -run-twice-helper, b8b-c2s-run-twice-each-row, b8b-c2s-run-twice-reporter
- `bun run check` → exit 0 (layout, typecheck, lint, knip, jscpd, stubs, format:check, then `vitest run --project unit --project component`: green)
- `bun run build` → quiet: ok
- The `--changed origin/main` replay of the whole branch was started once and not used as proof: it replays every entry of every changed file (over 1100 lines of output); the entries above were replayed one by one.
Bank: P-1613 added, P-1612 and P-094 and P-713 extended.

## c2s · follow-ups recorded
The c2s review found no blocking defect and four follow-ups; no code changed. One concerned GOTCHAS.md and is banked as P-1614 (a backgrounded `bun run check` read before its completion notice gave an untrustworthy exit code). The other three (plan Files-list line for step-specs.test.ts still says "under tests/"; spawnSync failure drops child.error in testTitles(); no `.vitest/` line in app/.gitignore) are in `workspace/05-plans/logs/B8b-followups.md` under "## c2s · steps 2" for the orchestrator to fold or assign.

## c3r · steps 4
Started from main at fbfd3dd (git merge-base origin/main HEAD; origin/main is an ancestor, no merge needed); proofs run on the tree at 1b27cca, handed in with the log commit that follows it. No code changed: every proof below passed. 2026-10-04 23:39 +0300.
Scope: the first half of step 4 (fan-out, scheduler, cron, seed and schedules migrations). The plan's proof also names `bump-catalog-version.test.ts`, `purge-cache.test.ts` and `tests/unit/scheduled.test.ts`; those files do not exist yet (second half of step 4), so they were not run here: NOT DONE in this group.
- `bunx vitest run tests/unit/automation/cron.test.ts tests/unit/automation/scheduler.test.ts tests/unit/automation/fanout.test.ts`
   Test Files  3 passed (3) /      Tests  34 passed (34)
  (fanout.test.ts includes "a first event whose RPC throws does not stop the second" and "a failure record_fanout_failure cannot store is logged and the sweep goes on")
- `bunx vitest run tests/unit/readpath.test.ts -t "table writes"`
   Test Files  1 passed (1) /      Tests  1 passed | 4 skipped (5)
- `deno check --frozen --config supabase/functions/job-runner/deno.json supabase/functions/job-runner/index.ts` (from `app/`) → deno exit=0
- dev profile, `node ../workspace/05-plans/quiet.mjs -- env -u CLOUDFLARE_API_TOKEN -u SUPABASE_ACCESS_TOKEN bunx vitest run --project db tests/db/automation.db.test.ts`
   Test Files  1 passed (1) /      Tests  28 passed (28) / quiet: ok (5 lines, showing the last 5)
  (local run against mop-dev inside rolled-back transactions, the seed and schedules migration text run in the test; `ci.yml` has jobs run, check, build, merge-gate and no `db` job, so the CI `db` line of the plan is UNPROVEN)
- `bun run scripts/stubs.ts` → `stubs: 10 markers, 0 on closed slices`; lines with `STUB(B8b step 4)`: 0
- `grep -rn "reconcile_uploads\|reconcile-uploads\|has_markets\|build_issue" src supabase` → nothing, exit 1
- `grep -rn "—" supabase/migrations/*automation_seed.sql` → nothing, exit 1
- `node scripts/check-migrations.mjs` → migration-order: OK (27 on main, 2 added)
- dev profile, `env -u CLOUDFLARE_API_TOKEN -u SUPABASE_ACCESS_TOKEN node scripts/watchfail.mjs --registry tests/mutations --changed origin/main`
   watchfail: replayed 208: ok 208, bad 0, stale 0; manual 2 not replayed; 1892 not selected
  (42 of them are `b8b-g3-*`, among them the brief items g, t, y, ac, a, ah, an, aj, aj-deno, seed-twice, fan-unrecorded, sch-cron-invalid; `git status` clean afterwards)
- `node ../workspace/05-plans/quiet.mjs -- bun run check` (foreground, P-1614) → layout, typecheck, lint, knip, jscpd, stubs, format:check, unit and component tests; `quiet: ok (49 lines, showing the last 12)`, check exit=0
- `node ../workspace/05-plans/quiet.mjs -- bun run build` → `quiet: ok (235 lines, showing the last 12)`, build exit=0
UNPROVEN until after the merge and the `dev` job: the post-merge selects on mop-dev (18 recipes, eight schedule rows, no `prune` or `reconcile_uploads` in cron.job, a `tz` per channel), the `job-runner` deploy as the runtime import proof of `npm:cron-parser@5.10.1`, its 200 with `"claimed"`, and the scheduler's `reconcile:<UTC date>T<HH:MM>` job `done`.
Bank: nothing cost a second attempt in this group; no entry added.

## c3r · steps 4 · fix round after review (2026-10-05)
Started from main at 48837ed (git merge-base origin/main HEAD, after `git fetch -q origin`; three merges of main in this round: 9529d0a, 1edb558, 48837ed); rename commit 195de10, proofs run on the tree at 4ec8525 plus the GOTCHAS.md line, handed in with the log commit that follows. 2026-10-05 00:25 +0300.
Correction to the c3r block above: its "origin/main is an ancestor, no merge needed" and `OK (27 on main, 2 added)` were read from a stale local ref (fbfd3dd, never fetched); GitHub's main was already c4fc709, whose `20261004193550_inquiry_attribution.sql` sorts after both lane migrations. Both statements were false.
Defect fixed: `20261004190700_automation_seed.sql` → `20261005000100_automation_seed.sql`, `20261004190701_automation_schedules.sql` → `20261005000101_automation_schedules.sql` (git mv, content unchanged); `tests/mutations/B8b.json` `file` paths of `b8b-g3-seed-twice` and `b8b-g3-schedules-prune` follow. The db tests find both files by suffix (`migration("_automation_seed.sql")`).
- `git fetch -q origin && bun run migrations:check` (from `app/`) → `migration-order: OK (28 on main, 2 added)`; `git ls-tree --name-only origin/main supabase/migrations/ | grep -c '\.sql$'` → `28`; main's newest is `20261004193550_inquiry_attribution.sql`
- `bunx vitest run tests/unit/automation/cron.test.ts tests/unit/automation/scheduler.test.ts tests/unit/automation/fanout.test.ts`
   Test Files  3 passed (3) /      Tests  34 passed (34)
- `bunx vitest run tests/unit/readpath.test.ts -t "table writes"`
   Test Files  1 passed (1) /      Tests  2 passed | 3 skipped (5)   (the block above read 1 passed | 4 skipped; the cause of the change is not checked: UNPROVEN)
- `deno check --frozen --config supabase/functions/job-runner/deno.json supabase/functions/job-runner/index.ts` → deno exit=0
- dev profile (`eval "$(node scripts/load-env.mjs --profile dev)"`), `env -u CLOUDFLARE_API_TOKEN -u SUPABASE_ACCESS_TOKEN bunx vitest run --project db tests/db/automation.db.test.ts`
   Test Files  1 passed (1) /      Tests  28 passed (28)
  (local run against mop-dev inside rolled-back transactions, the renamed migration text run by the test; `ci.yml` has jobs run, check, build, merge-gate and no `db` job, so the CI `db` line of the plan is UNPROVEN)
- `bun run scripts/stubs.ts` → `stubs: 8 markers, 0 on closed slices`; lines with `STUB(B8b step 4)`: 0
- `grep -rn "reconcile_uploads\|reconcile-uploads\|has_markets\|build_issue" src supabase` → nothing, exit 1
- `grep -rn "—" supabase/migrations/*automation_seed.sql supabase/migrations/*automation_schedules.sql` → nothing, exit 1
- dev profile, `env -u CLOUDFLARE_API_TOKEN -u SUPABASE_ACCESS_TOKEN node scripts/watchfail.mjs --registry tests/mutations --changed origin/main` (at 73a3193, origin/main 1edb558)
   WATCHED-FAIL OK B8b:b8b-g3-schedules-prune   (mutated supabase/migrations/20261005000101_automation_schedules.sql:7)
   watchfail: replayed 208: ok 208, bad 0, stale 0; manual 2 not replayed; 2014 not selected
- `node ../workspace/05-plans/quiet.mjs -- bun run check` (foreground) → `quiet: ok (47 lines, showing the last 12)`, check exit=0 (at 73a3193; re-run after the last merge below)
- `node ../workspace/05-plans/quiet.mjs -- bun run build` → `quiet: ok (251 lines, showing the last 12)`, build exit=0
Not run, NOT DONE in this group: `bump-catalog-version.test.ts`, `purge-cache.test.ts`, `tests/unit/scheduled.test.ts` and `tests/db/bump-catalog-version.db.test.ts` do not exist yet (second half of step 4).
Follow-ups left as the review marked them (not this group's files): `docs/runbooks/jobs.md:96` still names a pg_cron `prune` at 03:30 UTC; `src/server/jobs/README.md:18` still calls `scheduler.ts` a stub.
UNPROVEN until after the merge and the `dev` job: the post-merge selects on mop-dev, the `job-runner` deploy as the runtime import proof of `npm:cron-parser`, its 200 with `"claimed"`, and the scheduler's `reconcile:<UTC date>T<HH:MM>` job `done`.
Bank: P-318 hit again (stale `origin/main`, the fetch-first rule added).
