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
