# tests

A change is finished when the test its extension path names is green (`docs/HOW-TO-ADD.md`), and a broken form turns CI red.

## Layers

| Layer               | Folder                                          | Command                                                                                   | Runs                              |
| ------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------- |
| unit, component     | `tests/unit/`, `src/**/*.test.ts(x)`            | `bun run test` (vitest projects `unit`, `component`)                                      | `bun run check`, CI `check`       |
| db                  | `tests/db/`                                     | `bun run test:db` (project `db`, every case in a rolled-back transaction)                 | CI `db`, laptop against `mop-dev` |
| api                 | `tests/api/*.api.test.ts`                       | `bun run test:db` (same project; `handlePublic` in process, first line `import "./env";`) | CI `db`, laptop                   |
| e2e sweep and forms | `tests/e2e/`                                    | `bun run test:e2e` (projects `desktop`, `phone`)                                          | CI `e2e`                          |
| e2e live            | `live-forms`, `hydration`, `client-error` specs | `E2E_TARGET=built E2E_MODE=live bun run test:e2e:live` (project `live-desktop`)           | CI `e2e`, laptop                  |
| e2e edge            | `edge-cache.spec.ts`                            | `E2E_TARGET=built E2E_MODE=live bun run test:e2e:edge`                                    | CI `e2e`, laptop                  |
| e2e coming-soon     | B3b's spec                                      | `E2E_TARGET=built E2E_MODE=live bun run test:e2e:coming-soon`                             | CI `e2e` once B3b ships the spec  |

`E2E_TARGET` is `dev` (default, `bun run dev`), `built` (`wrangler dev` on `.output/`, which every caller builds first) or `url` (a deployed preview, with `E2E_BASE_URL`). `E2E_PORT` moves the server off 8080 or 8788 so lanes run side by side.

## Live mode on the laptop

1. `eval "$(node scripts/load-env.mjs --profile dev)"`, then `env -u CLOUDFLARE_API_TOKEN node scripts/dev-vars.mjs`, and add `CATALOG_VERSION_TTL_MS=0` to the `.dev.vars` it wrote (the public state is otherwise memoised for 15 seconds).
2. `VITE_API_BASE_URL=/api/public VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA bun run build` (prefix `MSYS_NO_PATHCONV=1` in Git Bash).
3. `E2E_TARGET=built E2E_MODE=live bun run test:e2e:live`. The specs that write rows call `assert-not-production` first and hold the `mop-dev-tests` lock; their rows carry `e2e+...@fixtures.invalid` and are removed in `afterAll`.

A Worker keeps the pages it stored under the same release and catalog version across builds, so a spec that reads a rendered page first moves the version (`tests/fixtures/catalog-version.ts`).

## Watched-fail

A new test is not finished until it has failed for the right reason. `node scripts/watchfail.mjs --file <path> --find "<text>" --replace "<text>" --run "<command>" --expect "<regex>" [--after "<command>"] [--record "<ledger title>"]` breaks the code, runs the test, checks the output against `--expect`, restores the file and appends a row to `tests/WATCHED-FAIL.md`. Every mutation is also an entry of `tests/mutations/<slice>.json`, replayed by `node scripts/watchfail.mjs --registry tests/mutations`; `kind: "manual"` entries (a rebuild and a browser) are recorded and never replayed. `tests/unit/mutation-registry.test.ts` fails when a test file has no entry.

## Fixtures

`tests/fixtures/`: `db.ts` (rollback and committed harness), `service.ts` (service-role client), `factories.ts` and `dataset.ts` (the deterministic data set, `bun run fixtures:load`), `builders.ts` (valid payloads), `fake-db.ts` and `db-counter.ts` (unit doubles and the one call counter), `snapshot.ts` and `catalog-fixture.ts` (RPC payloads, any catalog size), `clock.ts`, `dev-lock.ts`, `catalog-version.ts`, and the images `tiny.jpg` and `large.jpg`.

## CI job map

| Job                      | Runs on                                                                           | Holds                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `check`                  | every push                                                                        | typecheck, lint, format, unit and component tests, deno, audit, migration order       |
| `build`                  | every push                                                                        | the live build, shared as `build-output`                                              |
| `db`                     | ready pull requests                                                               | its own Supabase stack, re-apply, type drift, seed, `test:db`, mutation replay        |
| `e2e`                    | ready pull requests that change `src/`, `supabase/`, `package.json` or `bun.lock` | its own stack, the built artifact, all Playwright projects                            |
| `preview` (`deploy.yml`) | ready pull requests                                                               | deploy, smoke, and for a front-end change the `@overflow` run and the Lighthouse gate |

Drafts run `check` and `build` only; `CI_HEAVY=off` stops the heavy jobs at 70 percent of the month.

## Measured minutes (B4 step 10, 2026-10-04)

Billed minutes are the sum of job durations, each rounded up to the minute; a skipped job bills nothing.

| Push                    | Jobs                                   | Billed | Wall |
| ----------------------- | -------------------------------------- | ------ | ---- |
| draft                   | `check` 3, `build` 1                   | 4      | 2.5  |
| push to `main`          | `check` 3, `build` 1, `merge-gate` 1   | 5      | 2.4  |
| ready (run 37214655312) | `check` 3, `build` 1, `db` 3, `e2e` 16 | 23     | 16.8 |
| ready (run 37215885141) | `check` 3, `build` 1, `db` 3, `e2e` 15 | 22     | 15.3 |

Both ready runs had a red `db` as well: run 37214655312 stopped at type drift, so seed, `test:db` and the mutation replay did not run, and 37215885141 stopped at `test:db`, so the replay did not run. The `db` figure of 3 is a lower bound.

The month so far: 562 runs and 591 minutes of run time by 2026-10-04 (`gh api repos/AbdulrahmanAmer/matter-of-place/actions/runs --paginate`, the H6 command), 30 percent of 2,000 in four days, while nine lanes push at once. That is wall time; a ready push bills about 35 percent more than its wall time (23 against 16.8), so the billed month is nearer 800 minutes and the 70 percent line of `CI_HEAVY` is reached sooner than the 591 suggests. At 23 minutes a ready push, 2,000 minutes are 87 ready pushes; at 4 a draft push, 500.

The ready pushes exceed 10 minutes, so the one cut of T-04 is applied: `e2e` does its work only when the push changes `src/`, `supabase/`, `package.json` or `bun.lock`. UNPROVEN that this is needed: both ready runs had a red `e2e` (88 sweep failures, each run twice, because the seed does not upload photographs until B9 step 6, GOTCHAS P-422), so its specs step took 13 of the 16 minutes running those tests twice. Measure again on the first green ready push and remove the filter if it is under 10.

## Gates on a preview

- Lighthouse (GQ-01): `budget.json` holds the limits (LCP 2,500 ms, CLS 0.1, 150 KB of script, 60 KB of document); `lighthouserc.json` asserts them over three runs, median. Ruling H61 (CTO, 2026-10-05): until H1 tunes the pages, the LCP and script-size assertions are at `warn` and the layout-shift and document-size assertions stay at `error`; H1 flips the two to `error` with its measured budgets, and empties `WARN_UNTIL_H1` in `tests/unit/perf-budget.test.ts` in the same change. The first preview run failed on those two for three pages, which is what the ruling answers. The config runs end to end: `bun run lhci -- --collect.url=http://127.0.0.1:8808/ --collect.numberOfRuns=1` against the built Worker on this laptop (one run, loaded machine, not a preview, LCP then asserted at `error`) measured `/` at LCP 3,720 ms (over the limit, so it exited 1), CLS 0.0006, script 152,152 bytes and document 13,037 bytes. The numbers per page on a preview are NOT DONE, and so is the drill with a 300 KB script: both need a ready pull request with a front-end change, and the builder never marks one ready.
- CPU (T-11): `scripts/cpu-gate.mjs` and its test exist; `cpuMs.p50` in `budget.json` is 52, the top of the 6 to 52 ms E3 measured, UNPROVEN until a first green run. BLOCKED on `CF_ANALYTICS_TOKEN`: it is not a repository secret, so the `preview` step is not added and the script prints `BLOCKED CF_ANALYTICS_TOKEN`. Unblocked by a read-only Account Analytics token from `mop-admin` stored as that secret, then one step in `deploy.yml`.

## Broken-form drill (S19)

Throwaway PR 120, branch `test/b4` (closed). Run 37215885141 renamed `name="email"` to `name="mail"` in `contact-form.tsx` and `e2e` failed at `forms.spec.ts:61 contact: a missing field keeps the form, a sent form tracks contact_inquiry` on both projects. The revert going green is NOT DONE: `e2e` cannot be green before B9 step 6 (P-422).
