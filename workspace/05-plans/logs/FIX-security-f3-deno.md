## fix/security-f3-deno · F3 caption edits after approval, and the job runner's deno check

Branch fix/security-f3-deno from origin/main 9fa756e3, worked 2026-10-11 00:00 to 00:40 +0300. Bank: P-3110 (F3) and P-3111 (deno), a fixed line on P-2713, a hit-again line on P-008.

### Task 1 · F3 (security scan 2026-10-10, finding F3)

Change. `supabase/sql/functions/set_asset_caption.sql` raises `wrong_state` with errcode `55000` (the convention of `cancel_social_post` and `approve_asset`) when the asset's status is not `pending`, after the `not_found` check and before any write. It ships as `app/supabase/migrations/20261010212354_fn_set_asset_caption.sql`, made with `bun run db:fn set_asset_caption`. The service needed no code: `fromRpcError` maps a message that is an `errorCodes` key, so `wrong_state` answers 409 (a JSDoc line on `editCaption` says so). The function signature is unchanged, so `src/db/types.ts` is unchanged.

Tests.
- db: `tests/db/assets.db.test.ts` > `set_asset_caption` > "accepts an edit while the asset is pending and refuses it once a person approved it" (edit while pending returns no error; after `approve_asset` the next edit is refused with `55000` / `wrong_state`; the row keeps the first caption and alt text; one `assets.caption` audit row).
- unit: `tests/unit/assets/service.test.ts` > `editCaption` > "answers 409 wrong_state when set_asset_caption refuses an asset that is no longer pending".

Proof 1 (db, the migration as prelude, mop-dev inside rolled-back transactions; CI's `db` job is still UNPROVEN, P-312), from `app/` with the dev profile:
```
MOP_MUTATION_SQL="$(cat supabase/migrations/20261010212354_fn_set_asset_caption.sql)" env -u CLOUDFLARE_API_TOKEN node node_modules/vitest/vitest.mjs run --project db tests/db/assets.db.test.ts -t "set_asset_caption"
 Test Files  1 passed (1)
      Tests  4 passed | 51 skipped (55)
```
(the three `set_asset_caption` cases and the "authenticated is refused: select public.set_asset_caption" case).

Proof 2 (unit): `node node_modules/vitest/vitest.mjs run --project unit tests/unit/assets/service.test.ts -t "editCaption"` → `Tests  3 passed | 12 skipped (15)`.

Watched-fail, registry `app/tests/mutations/FIX-f3.json` (two entries, one per new test).
- `f3-db-caption-pending-only` (kind sql): the mutant is the function with `if v_asset.status <> 'pending' then` turned into `if false then`. Red run (scratch form, migration then mutant, node form of vitest):
```
 FAIL  |db| tests/db/assets.db.test.ts > set_asset_caption > accepts an edit while the asset is pending and refuses it once a person approved it
- Expected
+ Received
-   "approved": { "code": "55000", "detail": "", "message": "wrong_state" },
-   "audited": 1,
+   "approved": null,
+   "audited": 2,
-   "row": { "alt_text": "A house.", "caption": "first" }
+   "row": { "alt_text": "Other alt.", "caption": "second" }
```
(layout condensed; the real output prints one key per line.)
- `f3-unit-caption-wrong-state` (file entry): `src/server/assets/service.ts` loses `if (error !== null) throw fromRpcError(error);` in `editCaption`. Red run:
```
 FAIL  |unit| tests/unit/assets/service.test.ts > editCaption > answers 409 wrong_state when set_asset_caption refuses an asset that is no longer pending
-     "code": "wrong_state",
-     "status": 409,
+     "asset_id": "3f2a9c1d-0000-4000-8000-0000000000bb",
```
Replays by id, from `app/`, dev profile loaded, `env -u CLOUDFLARE_API_TOKEN`:
```
node scripts/watchfail.mjs --registry tests/mutations --only f3-unit-caption-wrong-state
WATCHED-FAIL OK FIX-f3:f3-unit-caption-wrong-state
node scripts/watchfail.mjs --registry tests/mutations --only f3-db-caption-pending-only
WATCHED-FAIL OK FIX-f3:f3-db-caption-pending-only
scratch registry (migration + mutant, both entries), exit 0:
WATCHED-FAIL OK FIX-f3:f3-db-caption-pending-only
WATCHED-FAIL OK FIX-f3:f3-unit-caption-wrong-state
watchfail: replayed 2: ok 2, bad 0, stale 0; manual 0 not replayed; 0 not selected
```
Caveat (P-2704): until main pushes the migration, mop-dev still holds the old function, which is the same text as the mutant, so the committed `sql` entry is red on mop-dev even without the mutant. The scratch replay (migration first, then the mutant) is the evidence that the check is what turns the case green. After the push the committed entry is a real mutation.

### Task 2 · deno check of the job runner

Before: `deno check --frozen --config supabase/functions/job-runner/deno.json supabase/functions/job-runner/index.ts` printed `Found 9 errors.` (2 unresolved packages, 2 extensionless imports, 5 implicit any), reproduced on this tree before any change.

Fix, no behaviour change and no new package or version. Four runner-reachable modules (`src/server/audit/service.ts`, `src/server/audit/subject-requests.ts`, `src/server/lib/audit.ts`, `src/server/settings/service.ts`) imported the type `AdminActor` from `admin-route.ts`, which reaches `session.ts` (`@supabase/ssr`, `jose`). The new `src/server/lib/actor-types.ts` holds `Actor` and `AdminActor`; those four modules import from it; `actor.ts` and `admin-route.ts` re-export the names (`export type { Actor }`, `export type { AdminActor }`), so no other file changed. The import map is untouched. The extensionless imports in `ids.ts` and `ratelimit.ts` were only reached through `admin-route.ts`, so they no longer sit in the runner's graph and were left alone.

After:
```
deno check --frozen --config supabase/functions/job-runner/deno.json supabase/functions/job-runner/index.ts; echo exit=$?
Check supabase/functions/job-runner/index.ts
exit=0
deno check --config supabase/functions/job-runner/deno.json scripts/deno-portable.ts (the CI step) → Check scripts/deno-portable.ts, exit 0
node scripts/watchfail.mjs --registry tests/mutations --only b15-r-deno → WATCHED-FAIL OK B15:b15-r-deno
```
Where the command runs: `app/package.json` has no deno script and no deno test task; `.github/workflows/ci.yml`'s `deno` step checks only `scripts/deno-portable.ts`. No gate was added (not asked for; the orchestrator may add the runner check to that CI step). The registry entries `B12:b12g5-t-deno`, `B15:b15-r-deno`, `B8b:b8b-g3-aj-deno` and the B16 deno entries run the full command.

No new test came with task 2, so it has no watched-fail pair of its own; the proof is the command above and the mutation-style replay of `b15-r-deno`.

### Gates

`cd app && NODE_OPTIONS=--max-old-space-size=4096 node ../workspace/05-plans/quiet.mjs -- bun run check; echo exit=$?` → `quiet: ok (201 lines, showing the last 12)`, `exit=0`.
`cd app && bun run build` → exit 0 (`You can deploy this build using npx nitro deploy --prebuilt`).
After the commit (P-318: `migrations:check` reads committed files only): `cd app && bun run migrations:check` → `migration-order: OK (80 on main, 1 added)`; `node workspace/05-plans/check-gotchas.mjs` → `check-gotchas: OK (55 path entries, 758 process entries)`. The check was run twice (before and after the commit), both `quiet: ok`, `exit=0`.

UNPROVEN: the CI `db` job on the new migration (it does not exist for branches yet, P-312); the migration was never pushed to mop-dev (ruling H57).
