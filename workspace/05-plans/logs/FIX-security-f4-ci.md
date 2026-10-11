# FIX security F4, CI deno gate, render.yml DEV_ env (branch fix/security-f4-ci, from origin/main 21a7f3c4)

Date 2026-10-11. Bank: P-3120 (F4), P-3121 (CI deno line), P-3122 (render.yml).

## Operator item (not done, not mine to do)

"Enforce SSL on incoming connections" in the Supabase dashboard for `mop-dev` is NOT enabled. The scan's fix names it
as a third layer. Whether to turn it on is the operator's decision; this branch does not touch the dashboard. With the
helper in place every script already speaks verified TLS, so turning it on would not break a script in `app/scripts`.
The 25 `new pg.Client({ connectionString })` sites under `app/tests/**` (17 files) still connect in plaintext and
would break when Enforce SSL is on until they use the helper too (follow-up, outside this brief).

## Item 1, F4: one helper

Helper: `app/scripts/lib/pg-connect.mjs` (`pgClientConfig(url)`), with the vendored root in
`app/scripts/lib/supabase-ca.mjs`. Why `lib/`: `assert-not-production.mjs`, `one-database.mjs` and `guard-env.mjs`
already live there and the `.ts` scripts already import `.mjs` from it; `load-env.mjs` only exports variables into a
shell and holds no connection options. Why a module for the CA: `check-layout.mjs` bans a `.pem` as a secret and allows
only `.ts` and `.mjs` under `scripts/lib` (the first gate run failed on a `.pem`).

No Supabase CA was in the repo. A bare `ssl: { rejectUnauthorized: true }` fails against the pooler:
`ERR SELF_SIGNED_CERT_IN_CHAIN self-signed certificate in certificate chain`. The chain the pooler presents:
`*.pooler.supabase.com` <- `Supabase Intermediate 2021 CA` <- `Supabase Root 2021 CA`
(SHA-256 `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`, valid to
2031-04-26). The file Supabase publishes as prod-ca-2021.crt (downloaded from
supabase-downloads.s3-ap-southeast-1.amazonaws.com) has the same fingerprint; it is the vendored root. Refresh before
2031-04-26.

Behaviour: any non-loopback host gets `ssl: { rejectUnauthorized: true, ca: <root> }`; TLS parameters in the URL
(`sslmode` and kin) are removed, because pg lets the URL override `ssl`; loopback (`127.0.0.1`, `localhost`, `[::1]`)
is left as it is, because CI's `supabase start` stack (`127.0.0.1:54322`) and a throwaway cluster speak no TLS; an empty
URL throws.

Scripts using it (13, every file under `app/scripts` that built a client): `db-push.mjs`, `db-reset-dev.mjs` (2 sites),
`lib/assert-not-production.mjs`, `with-coming-soon.ts`, `with-maintenance.ts`, `seed-admin-users.ts`, `api-smoke.mjs`,
`email-chain.ts`, `invoice-smoke.ts`, `newsletter-test-send.ts`, `harden/probe-db.ts`, `harden/rls-review.ts`,
`harden/secret-ages.ts`.

### Real connection to mop-dev (dev profile), through the helper

The brief asked for `SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()` to return true. It returns false, also
over a verified TLS connection, because the pooler (Supavisor) ends the client's TLS and `pg_stat_ssl` describes the
pooler-to-Postgres leg. The client leg is read from the socket:

```
bare client      | encrypted false | authorized undefined | protocol undefined | pg_stat_ssl.ssl false
helper (pooler)  | encrypted true  | authorized true      | protocol TLSv1.3   | pg_stat_ssl.ssl false
```

The direct host `db.<ref>.supabase.co` did not resolve from this laptop (`ENOENT`; IPv6 only), so `pg_stat_ssl` true
could not be shown there. UNPROVEN: that statement for the direct host. Also run through the helper:
`assertNotProduction()` against mop-dev resolved ("not production") over the verified connection.

### Test and watched-fails

`app/tests/unit/pg-connect.test.ts` (11 cases): grep-based over `app/scripts` (13 files found, each imports the helper,
each builds its client from `pgClientConfig(` and never from a bare object) plus behaviour of the helper (CA
fingerprint, URL parameter stripping, loopback, empty URL, not-a-URL without echoing the value).

Requested watched-fail with a temporary file: `app/scripts/zz-temp-bare-client.ts` holding
`new pg.Client({ connectionString: process.env["DEV_DB_URL"] })`:

```
× imports the helper in each of them
× builds every client from pgClientConfig, never from a bare options object
AssertionError: expected [ 'zz-temp-bare-client.ts' ] to deeply equal []
Tests  2 failed | 9 passed (11)
```

File removed; next run `Tests  11 passed (11)`.

## Item 2, CI deno gate

`.github/workflows/ci.yml`, step `deno` (same setup-deno step before it, run from `app/` through the job's
`working-directory`) now runs a block scalar with two lines: the old `deno-portable.ts` check and
`deno check --frozen --config supabase/functions/job-runner/deno.json supabase/functions/job-runner/index.ts`.

Local run of the exact command from `app/` on THIS tree (PR 272 is not on main): exit 1, nine errors
(`TS2307 Import "@supabase/ssr" not a dependency and not in import map from .../src/server/lib/session.ts`, the same for
`jose`, `Cannot find module .../src/server/lib/crypto` and `.../db`, five implicit-any in `session.ts`),
`Found 9 errors.`, `exit=1`. This is P-2713, the defect PR 272 fixes.

The same command on PR 272's head (57c93cf6, fetched read-only and unpacked with `git archive` into a scratch folder;
no branch or worktree touched):

```
Check supabase/functions/job-runner/index.ts
exit=0
```

Status: PROVEN on 272's head, UNPROVEN on main. This branch's `checks` job in CI is red until PR 272 merges, then green.
Merge 272 first. `app/tests/unit/ci-deno-gate.test.ts` pins the two lines and the single step.

## Item 3, render.yml

What the guard reads: `scripts/lib/one-database.mjs` (`oneDatabaseValue`, used by `media-store.mjs`) takes
`DEV_SUPABASE_PROJECT_REF` and `DEV_SUPABASE_SERVICE_ROLE_KEY`; the generic names count only with `E2E_STACK=1`.
`deploy.yml` passes `DEV_SUPABASE_PROJECT_REF` from `secrets.DEV_SUPABASE_PROJECT_REF` (and `DEV_SUPABASE_DB_PASSWORD`
from `secrets.DEV_SUPABASE_DB_PASSWORD`); it passes no service-role secret, `render.yml` already used
`secrets.DEV_SUPABASE_SERVICE_ROLE_KEY` for the generic key. Added to the `&job-env` anchor (read by the `render` and the
`reel` job): `DEV_SUPABASE_PROJECT_REF` and `DEV_SUPABASE_SERVICE_ROLE_KEY`, from those two secrets. Generic lines kept.
`gh secret list` (names only) holds both: `DEV_SUPABASE_PROJECT_REF`, `DEV_SUPABASE_SERVICE_ROLE_KEY`.

Yaml parse (`yaml` package in `app/node_modules`):

```
ci.yml parses; jobs: 5 | render.yml parses; jobs: render,reel | deploy.yml parses
ci.yml deno step run:
deno check --config supabase/functions/job-runner/deno.json scripts/deno-portable.ts
deno check --frozen --config supabase/functions/job-runner/deno.json supabase/functions/job-runner/index.ts
render.yml DEV_SUPABASE_PROJECT_REF: render job <- secrets.DEV_SUPABASE_PROJECT_REF ; reel job <- secrets.DEV_SUPABASE_PROJECT_REF
render.yml DEV_SUPABASE_SERVICE_ROLE_KEY: render job <- secrets.DEV_SUPABASE_SERVICE_ROLE_KEY ; reel job <- secrets.DEV_SUPABASE_SERVICE_ROLE_KEY
deploy.yml: DEV_SUPABASE_PROJECT_REF <- secrets.DEV_SUPABASE_PROJECT_REF ; DEV_SUPABASE_DB_PASSWORD <- secrets.DEV_SUPABASE_DB_PASSWORD
```

Existing test `tests/unit/jobs/render-job.test.ts` counted the generic lines as substrings, which the DEV_ lines now
doubled; the first full gate went red on it. It counts whole lines now and has a case for the DEV_ pair.
UNPROVEN: the render job itself on GitHub (needs the B7 `E2E_RENDER=1` run after merge).

## Watched-fail registry: `app/tests/mutations/fix-security-f4.json`, replay `node scripts/watchfail.mjs --registry tests/mutations --only <id>`

All printed `WATCHED-FAIL OK fix-security-f4:<id>` and `replayed 1: ok 1, bad 0, stale 0`.

| id | mutation | red because (expect regex) |
| -- | -------- | -------------------------- |
| f4-a-no-verify | `rejectUnauthorized: true` -> `false` | `× .*verifies the certificate of a remote host` |
| f4-b-sslmode-kept | `TLS_PARAMS = []` | `× .*removes a TLS parameter of the URL` |
| f4-c-loopback-tls | loopback early return removed | `× .*leaves a loopback URL without TLS` |
| f4-d-empty-url | empty-URL guard disabled | `× .*refuses a missing URL` |
| f4-e-ca-swapped | one base64 group of the vendored root changed | `× .*verifies the certificate of a remote host` |
| f4-f-bare-client | `db-push.mjs` builds `{ connectionString }` again | `× .*builds every client from pgClientConfig` |
| f4-g-no-import | import removed from `with-maintenance.ts` | `× .*imports the helper in each of them` |
| f4-h-render-dev-ref | `DEV_SUPABASE_PROJECT_REF` line removed from `render.yml` | `× .*gives the one-database guard the DEV_ pair` |
| f4-i-render-dev-key | `DEV_SUPABASE_SERVICE_ROLE_KEY` bound to another secret | `× .*gives the one-database guard the DEV_ pair` |
| f4-j-ci-no-frozen | `--frozen` removed from the runner check in `ci.yml` | `× .*checks the portable entry and the job runner entry` |
| f4-k-ci-split-step | `run: \|` -> `run: >` in the deno step | `× .*runs both commands in the one step named deno` |

## Gate

From `app/`: `NODE_OPTIONS=--max-old-space-size=4096 node ../workspace/05-plans/quiet.mjs -- bun run check; echo exit=$?`
-> `quiet: ok (207 lines, showing the last 12)` and `exit=0` (after fixing two reds it found: layout banned the `.pem`,
and the substring count in `render-job.test.ts`). `bun run build` -> green, `build-exit=0`. `tsc` (`bun run typecheck`) and
eslint on the changed files ran clean before the gate. `node workspace/05-plans/check-gotchas.mjs` -> `OK`.

## Costs (all in the bank)

- P-3120: bare `ssl: true` fails on the pooler chain (SELF_SIGNED_CERT_IN_CHAIN); `pg_stat_ssl` through the pooler is false
  and cannot prove the client leg; URL `sslmode` overrides `ssl`; layout bans `.pem`.
- P-3121: the runner check is red on main until 272; `python3 - <<EOF` hangs on this laptop (Store alias stub); a stray
  `cat > file` waited on stdin until the tool timeout (about 4 minutes between the two).
- P-3122: substring count in `render-job.test.ts` broke on the new DEV_ lines (one full-gate round, about 5 minutes).
