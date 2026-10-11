## fix/deno-imports · job runner imports explicit, deno check follow-ups closed

Branch fix/deno-imports from origin/main 8ebb4ce6, worked 2026-10-11 01:50 to 02:30 +0300. Bank: P-3140 (and a `fixed:` line on P-3111).

### Items of `FIX-security-f3-deno.md` and what became of each

1. `ids.ts` and `ratelimit.ts` extensionless imports (left alone by F3 because no runner path reached them). Fixed: `src/server/lib/ids.ts` line 1 imports `./crypto.ts`, `src/server/lib/ratelimit.ts` line 1 imports `./db.ts`. Before, from `app/`: `deno check --config supabase/functions/job-runner/deno.json src/server/lib/ids.ts` printed `TS2307 [ERROR]: Cannot find module '.../src/server/lib/crypto'. Maybe add a '.ts' extension`, and the same for `ratelimit.ts` and `lib/db`. After: both check clean. No behaviour change (a type import and a value import, same modules).
2. "Any other module the runner reaches". `deno info --json` of the entry lists 197 modules; none has an extensionless import (the full check is green). The sweep of `src/server/{lib,jobs,email,settings,audit}` and `src/domain` with `deno check` shows errors only in `headers.ts`, `pipeline.ts`, `maintenance-html.ts` (extensionless) and `session.ts` (`@supabase/ssr`, `jose`): all four are Worker-only and the runner does not reach them, so they are left alone.
3. The lint list. `DENO_FILES` in `app/eslint.config.js` (the files whose imports must end in `.ts`) did not cover 38 modules of the runner's graph. It now does (`lib/{actor-types,admin-errors,audit,authz,db,env,error-codes,hmac,ids,ratelimit}.ts`, `lib/permissions/**`, `audit/**`, `payments/**`, `assets/render-run.ts`, `db/{index,types}.ts`, `lib/property-card.ts`); `bunx eslint --max-warnings 0 src/server/lib src/server/audit src/server/payments src/server/assets src/db src/lib/property-card.ts` is clean, so no file needed a new extension.
4. "No gate was added to CI". Already on main: PR 274 added the full runner check to the `deno` step of `ci.yml`, pinned by `tests/unit/ci-deno-gate.test.ts`. Nothing to do.
5. No `package.json` script or deno task. Left: a script would be a new surface the brief does not ask for, and CI plus the registry run the commands directly.

### Proofs (from `app/`)

```
deno check --frozen --config supabase/functions/job-runner/deno.json supabase/functions/job-runner/index.ts; echo exit=$?
Check supabase/functions/job-runner/index.ts
exit=0
deno check --frozen --config supabase/functions/job-runner/deno.json supabase/functions/job-runner/index.ts src/server/lib/ids.ts src/server/lib/ratelimit.ts; echo $?
Check supabase/functions/job-runner/index.ts
Check src/server/lib/ids.ts
Check src/server/lib/ratelimit.ts
0
bunx vitest run tests/unit/ci-deno-gate.test.ts   → Test Files  1 passed (1), Tests  2 passed (2)
bunx vitest run --project unit tests/unit/ids.test.ts tests/unit/ratelimit.test.ts → Tests  11 passed (11)
bunx tsc --noEmit -p tsconfig.json → exit 0; bunx eslint --max-warnings 0 eslint.config.js src/server/lib/ids.ts src/server/lib/ratelimit.ts → exit 0
```
(A second run of a passing `deno check` prints nothing: Deno caches a pass, P-3140.)

### Watched-fail

No new test file. The proof is five registry entries in `app/tests/mutations/fix-deno-imports.json`, each replayed by id:

| id | mutant | red reason |
|---|---|---|
| `fdi-a-ids-deno` | `ids.ts` imports `./crypto` | `deno check` of ids.ts and ratelimit.ts: `TS2307 [ERROR]: Cannot find module 'file:///D:/mop-build/fix5/app/src/server/lib/crypto'. Maybe add a '.ts' extension or run with --sloppy-imports` |
| `fdi-b-ratelimit-deno` | `ratelimit.ts` imports `./db` | same check: `TS2307 ... lib/db' ... Maybe add a '.ts' extension` |
| `fdi-c-ids-lint` | `ids.ts` imports `./crypto` | `bunx eslint`: `1:1  error  Deno-loaded file: import with the .ts extension  no-restricted-syntax` |
| `fdi-d-ratelimit-lint` | `ratelimit.ts` imports `./db` | same lint message |
| `fdi-e-lint-list-audit` | `audit/service.ts` imports `../lib/actor-types` | same lint message (the file was outside the old list) |

Replays, `node scripts/watchfail.mjs --registry tests/mutations --only <id>`, each run alone (P-2984):
```
WATCHED-FAIL OK fix-deno-imports:fdi-a-ids-deno
WATCHED-FAIL OK fix-deno-imports:fdi-b-ratelimit-deno
WATCHED-FAIL OK fix-deno-imports:fdi-c-ids-lint
WATCHED-FAIL OK fix-deno-imports:fdi-d-ratelimit-lint
WATCHED-FAIL OK fix-deno-imports:fdi-e-lint-list-audit
```
Existing entries that run the runner check, replayed on this tree: `b12g5-t-deno` (B12), `b15-r-deno` (B15), `b8b-g3-aj-deno` (B8b), `b16-g8-deno-ext` (B16), `b3-qq-deno` (B3), `b16-g8-deno-workers` (B16), `b16-g2-deno-ext` (B16): each printed `WATCHED-FAIL OK <registry>:<id>`.

### Gates

`cd app && NODE_OPTIONS=--max-old-space-size=4096 node ../workspace/05-plans/quiet.mjs -- bun run check; echo exit=$?` → `quiet: ok (207 lines, showing the last 12)`, `exit=0`.
`cd app && bun run build` → exit 0 (`You can deploy this build using npx nitro deploy --prebuilt`).
`node workspace/05-plans/check-gotchas.mjs` → `check-gotchas: OK (56 path entries, 833 process entries)`.

UNPROVEN: the CI `checks` job on this branch (it runs after the push; see the PR).

Costs, banked in P-3140: a `grep` on `deno check` output missed its error lines (ANSI colour codes) and a cached pass printed nothing; a redirect with a relative path wrote a scratch file one folder above `app/` (moved to the scratchpad, nothing left in the tree).
