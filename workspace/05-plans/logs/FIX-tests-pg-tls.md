# FIX tests pg TLS (branch fix/tests-pg-tls, from origin/main 8ebb4ce6)

Date 2026-10-11. Bank: P-3130. Follows P-3120 / `FIX-security-f4-ci.md`: the scripts got the helper, the tests did not.

## Operator item (not done, not mine to do)

"Enforce SSL on incoming connections" in the Supabase dashboard for `mop-dev` stays untouched; turning it on is the
operator's call. With this change every pg client under `app/scripts` and `app/tests` already speaks verified TLS to the
pooler, so turning it on would not break a script, a db test, a fixture or an e2e spec. Loopback (CI's `supabase start`
stack on 127.0.0.1:54322) stays plain, so CI keeps working.

## Route taken: the `.mjs` import, no TypeScript twin

`app/scripts/lib/pg-connect.mjs` is imported directly from the tests as `../../scripts/lib/pg-connect.mjs`. Why no twin:
`tsconfig.json` has `allowJs`; the helper has a JSDoc return type (`import("pg").ClientConfig`), so `tsc` types the call;
the tests already import `assert-not-production.mjs` from the same folder the same way (`tests/db/global-setup.ts`, the
e2e specs, `tests/fixtures/db.ts`), and vitest and Playwright both load it. `bun run typecheck` and eslint on the changed
files were clean. One helper, one CA module (`scripts/lib/supabase-ca.mjs`), no second copy of the certificate.

## What changed

22 `new pg.Client({ connectionString: X })` sites in 15 files became `new pg.Client(pgClientConfig(X))` with the import
added (P-3120's "25 sites in 17 files" counted `import pg` lines as well):

- fixtures: `tests/fixtures/db.ts` (the one all 20 other db test files go through), `dev-lock.ts`, `catalog-version.ts`,
  `dataset.ts`
- db tests: `jobs.db.test.ts` (1), `payments.db.test.ts` (2), `render-claim.db.test.ts` (2)
- e2e: `admin-assets` (2), `admin-channels` (1), `admin-editorial` (1), `admin-full-path` (1), `admin-invoice` (4),
  `automation-exit` (1), `coming-soon` (2), `live-forms` (1)
- `tests/unit/pg-connect.test.ts`: a second block reads every `.ts`/`.tsx`/`.mjs`/`.js` file under `tests/` (except
  itself; the `.json` mutation registries are not source) and fails on a file that mentions `pg.Client`/`pg.Pool`/`new Client(`
  and lacks the import, or builds one from a bare object. Three cases: finder, import, construction.
- `tests/mutations/fix-tests-pg-tls.json`: five entries.
- `GOTCHAS.md`: P-3130; P-3120's "not yet covered" sentence now points at it.

## Proof 1: the harness connection is verified TLS

`tests/fixtures/db.ts` `withRollback`, from a scratch script under the dev profile (file removed afterwards):

```
harness withRollback (tests/fixtures/db.ts) {"encrypted":true,"authorized":true,"protocol":"TLSv1.3"}
```

The bare client it replaced read `encrypted false authorized undefined` (P-3120, measured 2026-10-11).

## Proof 2: unit test and watched-fails

`bunx vitest run --project unit tests/unit/pg-connect.test.ts` -> `Tests  14 passed (14)` (11 before).

Requested watched-fail with a temporary file `tests/fixtures/zz-temp-bare-client.ts`
(`new pg.Client({ connectionString: process.env["DEV_DB_URL"] })`):

```
× imports the helper in each test and fixture
× builds every test client from pgClientConfig, never from a bare options object
AssertionError: expected [ 'fixtures/zz-temp-bare-client.ts' ] to deeply equal []
Tests  2 failed | 12 passed (14)
```

File removed; next run `Tests  14 passed (14)`.

Registry `app/tests/mutations/fix-tests-pg-tls.json`, replay `node scripts/watchfail.mjs --registry tests/mutations --only <id>`;
each printed `WATCHED-FAIL OK fix-tests-pg-tls:<id>` and `replayed 1: ok 1, bad 0, stale 0`.

| id | mutation | red because (expect) |
| -- | -------- | -------------------- |
| tls-a-bare-fixture | `fixtures/db.ts` builds `{ connectionString }` again | `× .*builds every test client from pgClientConfig` |
| tls-b-bare-dev-lock | the same in `fixtures/dev-lock.ts` | `× .*builds every test client from pgClientConfig` |
| tls-c-no-import-spec | import removed from `e2e/live-forms.spec.ts` | `× .*imports the helper in each test and fixture` |
| tls-d-no-import-db-test | import removed from `db/render-claim.db.test.ts` | `× .*imports the helper in each test and fixture` |
| tls-e-finder-blind | the finder's skip list names `fixtures/db.ts` | `× .*finds the tests and fixtures that open a client` |

## Proof 3: the db suite against mop-dev with the dev profile

Command from `app/`: `eval "$(node scripts/load-env.mjs --profile dev)"; env -u CLOUDFLARE_API_TOKEN bun run test:db`
(`SUPABASE_URL` read `hbokkmpgpqhrnemgsqra` after the profile, G-901). It took 2592 s.

```
Test Files  8 failed | 50 passed | 1 skipped (59)
     Tests  30 failed | 833 passed | 2 skipped (865)
```

NOT green, and not because of TLS. Triage, with the same files run on the baseline tree (my changes stashed, origin/main
8ebb4ce6) under the same profile: `Test Files 6 failed | 2 passed (8)`, `Tests 28 failed | 94 passed | 1 skipped (123)`.

- 28 failures are identical by test name on the baseline and on this branch: `api/inquiries` (9 of 9, "current
  transaction is aborted" in the cleanup), `api/submissions` (13 of 13), `db/assets` `set_asset_caption` approved case
  (needs the F3 migration `20261010212354_fn_set_asset_caption.sql`, which only `main` pushes: P-3110, H57),
  `db/function-source` (function files against `pg_proc.prosrc`, the same unpushed migration), `db/factories`
  "leaves no fixture row behind", `db/newsletter` (3). A comparison of the two `FAIL` lists with `comm` prints nothing
  for "only in base".
- 2 failures appear only in the full run: `api/coming-soon` "changes getFlags at once and leaves the catalog untouched" and
  `db/archive` "lists a facet of three published properties". Both read shared mop-dev state that another lane's suite
  was writing at the time (other worktrees were running tests on this laptop). The two files rerun alone on this branch:
  `Test Files 2 passed (2)`, `Tests 7 passed | 1 skipped (8)`.
- So on this branch the suite stands at 835 passed, 28 failed (all 28 reproduced on the untouched baseline), 2 skipped.
  A first, aborted full run (killed after 11 files to diagnose) showed the same files red, plus two subscribers/subjects cases
  that passed in the second run: shared-state flakes.

UNPROVEN: a fully green db suite. It needs the F3 migration pushed by `main` and a look at `api/inquiries`,
`api/submissions`, `db/factories`, `db/newsletter`, which fail on the baseline too and are outside this change.

## Gate

From `app/`: `NODE_OPTIONS=--max-old-space-size=4096 node ../workspace/05-plans/quiet.mjs -- bun run check; echo exit=$?` -> `quiet: ok (207 lines, showing the last 12)` and `exit=0`.
`bun run build` -> green, `build-exit=0`. `tsc --noEmit -p tsconfig.json` and `eslint` on the 16 changed .ts files ran clean before the gate.
`node workspace/05-plans/check-gotchas.mjs` -> OK.

## Costs (all in P-3130)

- A stray `cat > file` in a Bash call waited on stdin for the 120 s tool timeout (P-3121 again).
- The db suite takes 43 minutes against mop-dev and prints nothing for passing files; one aborted run and the baseline comparison cost about an hour.
