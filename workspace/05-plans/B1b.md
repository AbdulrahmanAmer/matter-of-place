# B1b — Repo and delivery

Lane: Foundation · Stage: 3 BUILD · Owner agent: mop-builder · Depends on: B1a (Lovable removal, merged), A1 (Cloudflare account, zone, API token), A6 (Sentry project), A8 (GitHub settings). Step 8 also needs B2 step 2 (the `mop-prod` project exists) · Unblocks: B2 (db push from Actions), B3 (server env, request id, headers), B4 (CI jobs), B8 (secrets, `render.yml` shares the same conventions), and every later slice (deploy path)

Landing order for batch A: B1b steps 1 to 7, then B2 steps 1 to 4 and B3 steps 1 to 2 in parallel, then B1b steps 8 and 9, then the rest of B2, B3, then B3b, then B4 (B4 step 1 may start after B1b step 5).

## Goal and observed exit
One path from a commit to a running Worker, with errors and headers wired from the first deploy (S7, S17, S21; tech-stack 1 "Delivery", 3, 4; architecture 7, 8, 9).
Observed exit (completion map B1, narrowed): a pull request opens a `pr-<n>` Worker whose URL answers the smoke list in `scripts/smoke.mjs` with the security headers present, a merge to `main` deploys `matter-of-place`, a deliberate test error appears in Sentry with its request id, and `backup.yml` has written one decrypted-and-listable dump to R2. "Preview renders every route" is proved by B4's sweep, not here; B1b proves the smoke list only.

## Contract (inputs, outputs, invariants, events emitted, permissions)
Inputs
- Repo `AbdulrahmanAmer/matter-of-place` (git root `E:\Matter Of Place`, S5). The app is `Matter Of Place Codebase/`; every job sets `defaults.run.working-directory` to it (G-012).
- Build output of `vite build`: `.output/server/index.mjs`, `.output/server/wrangler.json` (Nitro writes it and merges any `wrangler.toml` found from the app root; observed in `node_modules/nitro/dist/_presets.mjs`, `readWranglerConfig`), `.output/public`.
- Secrets and variables from A1, A6, A8 (tables below).

Outputs
- `Matter Of Place Codebase/wrangler.toml` (production defaults; preview overrides come from `--var` flags).
- `.github/workflows/ci.yml`, `deploy.yml`, `backup.yml` at the repo root (G-012). `render.yml` belongs to B8.
- Runtime behaviour: every response carries `x-request-id` and the security headers; unhandled server errors go to Sentry with the request id; non-production responses carry `X-Robots-Tag: noindex, nofollow`.

Environments (architecture 7)
| | local | preview | production |
|---|---|---|---|
| Worker | `bun run dev` | `pr-<n>` | `matter-of-place` |
| URL | localhost:8080 | `https://pr-<n>.<account-subdomain>.workers.dev` | `https://matter-of-place.<account-subdomain>.workers.dev` until Stage 5, then matterofplace.com |
| `MOP_ENV` (runtime var) | `local` | `preview` | `production` (the default in `wrangler.toml`) |
| Supabase | local stack or `mop-dev` | `mop-dev` | `mop-prod` |
| R2 media | `mop-media-dev` | `mop-media-dev` | `mop-media` |

ASSUMED: architecture 7 writes `pr-<n>.matter-of-place.workers.dev`. Cloudflare serves a Worker named `pr-<n>` at `pr-<n>.<account-subdomain>.workers.dev`, so the account subdomain replaces `matter-of-place`. The smoke script and the PR comment print the real URL.

Variables and secrets (names only; values live in Cloudflare and GitHub, never the repo; G-006)
| Name | Kind | Where set | Used by |
|---|---|---|---|
| `VITE_SITE_URL` | build var, public | GitHub repo variable, per workflow (`https://matterofplace.com` on main, the preview URL on PRs) | canonical URLs |
| `VITE_API_BASE_URL` | build var, public | `/api/public` in every deployed environment (ASSUMED, see B3) | http adapter, `track()` |
| `VITE_TURNSTILE_SITE_KEY` | build var, public | Cloudflare test key on preview and local, real key on main | B3 widget |
| `VITE_INSTAGRAM_URL` | build var, public | repo variable, optional | footer |
| `MOP_ENV`, `MEDIA_BASE_URL`, `SENTRY_RELEASE` | Worker plain var | `wrangler.toml` default plus `--var` on preview | server code |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET`, `SENTRY_DSN`, `RATE_LIMIT_SALT`, `SENTRY_TEST_TOKEN` | Worker secret | production: `wrangler secret put` by hand once, they persist across deploys; preview: pushed by the workflow from `PREVIEW_WORKER_SECRETS_JSON` | server code |
| `RESEND_API_KEY`, `RENDER_CALLBACK_SECRET`, `JOB_RUNNER_SECRET`, `GITHUB_DISPATCH_TOKEN`, Meta and Stripe names | Worker secret | added by B5, B8, B10 in the same way | later slices |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub secret | Actions only (tech-stack 4) | deploy, R2 |
| `SUPABASE_ACCESS_TOKEN`, `DEV_SUPABASE_PROJECT_REF`, `PROD_SUPABASE_PROJECT_REF`, `DEV_SUPABASE_DB_PASSWORD`, `PROD_SUPABASE_DB_PASSWORD` | GitHub secret | Actions only | `supabase db push` |
| `PROD_SUPABASE_DB_URL` (session pooler string), `BACKUP_PASSPHRASE`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | GitHub secret | Actions only | `backup.yml` |
| `PREVIEW_WORKER_SECRETS_JSON` | GitHub secret | one JSON object of the preview Worker secrets (dev project keys, Turnstile test secret, dev DSN) | `deploy.yml` preview job |

ASSUMED: prefixed secrets (`DEV_`, `PROD_`) instead of GitHub Environments, because Environments are not available on private repositories of the free plan. Production Worker secrets are never copied into GitHub; only the deploy token is.

Invariants
1. Nothing under the app folder is named `.github` (G-012). Every workflow job sets `working-directory: Matter Of Place Codebase` through `defaults.run`.
2. `wrangler.toml` contains no secret and no binding for Queues, Browser Rendering, Images, Durable Objects or KV (G-011). Proof grep in Verification.
3. `MOP_ENV` defaults to `production` in the file, so a deploy that forgets its override fails safe (hides illustrative content, see B3b).
4. The Worker name in `wrangler.toml` and in `vite.config.ts` (`cloudflare.wrangler.name`) is `matter-of-place` (G-002). Previews override the name at deploy time only.
5. Free tier only. The only paid item is the domain (P-009, S21). Preview Workers are deleted when their PR closes so the account stays under the free Worker count (ASSUMED limit of 100 Workers per account; re-check in HARDEN).
6. `deploy.yml` never runs on a fork PR (`github.event.pull_request.head.repo.full_name == github.repository`).

Events emitted: none (`AnalyticsEvent` unchanged). Permissions: only the repo owner can push `main` and read Actions secrets; the Cloudflare token is scoped to Workers Scripts edit and R2 edit on this account, nothing else.

## Files (create / change; one line each: path — what it contains)
Create (repo root `E:\Matter Of Place`)
- `.github/workflows/ci.yml` — `pull_request` only (main is checked inside `deploy.yml` to avoid paying twice). Job `check`: setup-bun 1.3.13, `bun install --frozen-lockfile`, `bun run check`. Job `build`: `bun run build`, asserts `.output/server/wrangler.json` has name `matter-of-place`. Job `audit`: `bun audit` with `continue-on-error: true` (ASSUMED, becomes blocking in HARDEN). `concurrency` cancels superseded runs. `paths-ignore: workspace/**, launch/**, **/*.md`. B4 appends the `db` and `e2e` jobs; a marker comment shows where.
- `.github/workflows/deploy.yml` — three jobs. `preview` (PR opened, synchronize, reopened): install, `bun run build` with preview vars, `supabase db push` to `mop-dev` when `supabase/migrations/**` changed, `wrangler deploy --config .output/server/wrangler.json --name pr-<n> --var MOP_ENV:preview ...`, `wrangler secret bulk` from `PREVIEW_WORKER_SECRETS_JSON`, `scripts/smoke.mjs <url>`, comment the URL on the PR with `gh pr comment`. `production` (push to `main`): install, `bun run check`, build with production vars, `supabase db push` to `mop-prod`, `wrangler deploy --config .output/server/wrangler.json`, smoke against the production URL. `preview-cleanup` (PR closed): `wrangler delete --name pr-<n>`. `permissions: contents: read, pull-requests: write`. `concurrency: preview-<n>` and `production` (never cancel a production run).
- `.github/workflows/backup.yml` — `schedule: 17 3 * * *` UTC plus `workflow_dispatch`. Installs `postgresql-client-17` from the PGDG apt repo (the runner ships 16, the dump client must not be older than the server), `pg_dump --format=custom --no-owner --no-acl --schema=public --schema=auth "$PROD_SUPABASE_DB_URL"`, encrypts with `openssl enc -aes-256-cbc -pbkdf2`, uploads to `s3://mop-backups/db/YYYY/MM/mop-prod-YYYY-MM-DD.dump.enc` through the R2 S3 endpoint with the AWS CLI. Retention is an R2 lifecycle rule (30 days), not a script.
- `.github/pull_request_template.md` — the extension-path checklist from tech-stack 5: which path was used (page, API route, admin action, table, job type, email, event, role, channel), the proof command, `bun run check` green, migration and generated types in the same PR, no `.github` under the app.
Change
- `.github/workflows/README.md` — replace with the real list: ci, deploy, backup, and "render.yml arrives with B8".
Create (app `Matter Of Place Codebase/`)
- `wrangler.toml` — `name`, `compatibility_date = "2026-09-30"`, `compatibility_flags = ["nodejs_compat"]` (Nitro's output already sets both; the file repeats them so a hand deploy matches), `[observability] enabled = true`, `[vars]` for `MOP_ENV = "production"` and `MEDIA_BASE_URL`, and a commented `routes` block for the Stage 5 custom domain (`matterofplace.com` and `www` redirect). No `main` or `assets` keys: Nitro sets both.
- `src/start.ts` — TanStack Start `createStart` with one global request middleware: mint or accept `x-request-id`, run the request, add security headers and (outside production) `X-Robots-Tag`, catch unhandled errors, report to Sentry through `waitUntil`, return the calm 500 with the request id. ASSUMED that request middleware in `src/start.ts` also wraps server routes under `src/routes/api/**`; proved in step 3.
- `src/server/lib/headers.ts` — pure `securityHeaders(env)` returning the header map, `cspFor(env)` building the Content-Security-Policy from a table of sources (each row names the slice that needs it: Turnstile now, GA4 in B12, Meta none).
- `src/server/lib/sentry.ts` — hand-written envelope client: `captureException(error, { requestId, route, env, release })` builds a Sentry envelope, scrubs request bodies, cookies, `authorization` and any value that looks like an email, and POSTs it to the DSN's envelope URL. ASSUMED over `@sentry/cloudflare` because the free Worker limit is 10 ms CPU and the SDK adds init cost and bundle weight; the fallback if this proves inadequate is `@sentry/cloudflare` inside a Nitro plugin, tried once, then recorded (two-attempt bound).
- `src/routes/api/hooks/sentry-test.ts` — `POST /api/hooks/sentry-test`, requires `Authorization: Bearer $SENTRY_TEST_TOKEN`, throws a marked error. Returns 404 when the token secret is unset, so production is inert until the owner sets it for a test.
- `public/_headers` — Workers static-asset headers: `/assets/*` immutable one year, `/media/*` one week, the same security header set for asset responses (SSR responses get theirs from `start.ts`).
- `scripts/smoke.mjs` — `node scripts/smoke.mjs <baseUrl>`: for `/`, `/properties`, `/markets`, `/california`, `/stories`, `/submit`, `/contact`, `/sitemap.xml` expects 200, `x-request-id`, `x-content-type-options: nosniff`, `x-frame-options: DENY`; expects `x-robots-tag` absent on production and present elsewhere; exits non-zero with the failing URL.
- `scripts/protect-main.sh` — one `gh api -X PUT repos/AbdulrahmanAmer/matter-of-place/branches/main/protection` call with required status checks `check` and `build`, no force pushes, no deletions, linear history off (G-009 is about pushed history, merges are fine).
- `docs/runbook-delivery.md` — first-time setup in order (A1, A6, A8), the secrets table above, how to set a production secret, rollback (`bunx wrangler rollback`, `versions list`), how to read Workers Logs and find a request by id, the CPU-time measurement recipe (step 7).
- `tests/unit/headers.test.ts` — header map per `MOP_ENV`, CSP contains Turnstile hosts and `frame-ancestors 'none'`, no header contains a newline.
- `tests/unit/sentry.test.ts` — envelope shape, scrubbing of `authorization`, cookies and email-like strings, DSN parsing, no throw when DSN is missing.
Change
- `.env.example` — add names only: `VITE_TURNSTILE_SITE_KEY` (public), and a server block with comments for `MOP_ENV`, `MEDIA_BASE_URL`, `SENTRY_DSN`, `SENTRY_TEST_TOKEN`, `SENTRY_RELEASE` (no values). Update the leading comment: server names are read by Wrangler and Nitro, never by Vite.
- `package.json` — scripts `cf:preview` (`wrangler dev --config .output/server/wrangler.json --port 8788`), `deploy:prod` (`wrangler deploy --config .output/server/wrangler.json`), `smoke`; devDependency `wrangler`. `check` switches to `bun run` for its four parts so the runner needs no npm. No runtime dependency is added (Sentry is hand-written).
- `src/env.d.ts` — add `VITE_TURNSTILE_SITE_KEY` to `ImportMetaEnv`. Server env typing is B3's `src/server/lib/env.ts`.

## Data changes (migrations, enums, RLS, seeds)
None. This slice runs `supabase db push` from Actions but owns no migration. Backup reads `public` and `auth` schemas only.

## Steps (ordered; each fits half a day; each ends with the command that proves it)
1. Account facts and decisions, no code. Run `bunx wrangler whoami`, `gh auth status`, `gh api user --jq .plan.name`, `gh api repos/AbdulrahmanAmer/matter-of-place --jq .private`. Record the outputs and the free-plan consequences (branch protection, Environments) in `docs/runbook-delivery.md`. Proof: the runbook shows the account subdomain, the plan name, and the decision for step 9.
2. `wrangler.toml` and the Nitro merge. Proof: `bun run build` then `node -e "const c=require('./.output/server/wrangler.json');console.log(c.name,JSON.stringify(c.vars),JSON.stringify(c.observability))"` prints `matter-of-place {"MOP_ENV":"production",...} {"enabled":true}`; `grep -n "queues\|browser\|images\|durable\|kv_namespaces" wrangler.toml` prints nothing (G-011). If the merge drops `vars`, move the two vars into `vite.config.ts` `cloudflare.wrangler` (the second documented route in the Nitro Cloudflare page) and record it.
3. `headers.ts`, `start.ts`, `public/_headers`, unit tests. Proof: `bunx vitest run tests/unit/headers.test.ts`; `bun run build && bunx wrangler dev --config .output/server/wrangler.json --port 8788` then `curl -sI http://127.0.0.1:8788/ | grep -i "x-request-id\|x-frame-options\|content-security-policy-report-only"` prints all three, and the same on `curl -sI http://127.0.0.1:8788/sitemap.xml` (a server route, proving the middleware covers `/api` style routes). If the middleware does not wrap server routes, wrap them inside `headers.ts` helpers used by B3's pipeline and say so.
4. Sentry envelope client and the test route. Proof: `bunx vitest run tests/unit/sentry.test.ts`; with `SENTRY_DSN` and `SENTRY_TEST_TOKEN` in a local `.dev.vars`, `curl -s -X POST -H "authorization: Bearer $SENTRY_TEST_TOKEN" http://127.0.0.1:8788/api/hooks/sentry-test` returns HTTP 500 with `{"error":{"code":"server","requestId":"..."}}` and the Sentry issue list shows one event tagged with that request id. UNPROVEN until the DSN exists (A6).
5. `ci.yml` and the PR template. Proof: push branch `ci/b1b`, open a draft PR, `gh run watch` ends green. Then watched-fail: push a commit that adds `const x: number = "a";` to any `src` file, `gh run watch` ends red at `check` with the TypeScript error, revert, green again.
6. `deploy.yml` preview job and cleanup. Proof: the PR comment holds a `https://pr-<n>...workers.dev` URL; `node scripts/smoke.mjs <url>` exits 0; open a second PR, it gets its own Worker; close it, `bunx wrangler deployments list --name pr-<n>` reports the Worker is gone.
7. `deploy.yml` production job and the first production deploy on the workers.dev URL (no custom domain yet). Proof: `node scripts/smoke.mjs https://matter-of-place.<subdomain>.workers.dev` exits 0 and `curl -sI` shows no `x-robots-tag`. Then the rollback rehearsal: `bunx wrangler versions list` and `bunx wrangler rollback <previous-id>` succeed, recorded in the runbook. Then measure CPU: `bunx wrangler tail matter-of-place --format json` while requesting `/` five times, note the `cpuTime` of each (see Risks).
8. `backup.yml`, the `mop-backups` bucket and its 30-day lifecycle rule (`bunx wrangler r2 bucket create mop-backups`, `bunx wrangler r2 bucket lifecycle add mop-backups --name expire-30d --prefix db/ --expire-days 30`). Needs `mop-prod` from B2 step 2. Proof: `gh workflow run backup.yml && gh run watch` green; `aws s3 ls s3://mop-backups/db/ --recursive --endpoint-url https://<account>.r2.cloudflarestorage.com` lists one object larger than 0 bytes; decrypt locally with `openssl enc -d -aes-256-cbc -pbkdf2 -in x.dump.enc -out x.dump` and `pg_restore --list x.dump | head` shows the `public` tables.
9. Branch protection. OBSERVED 2026-09-30 while planning: `gh api repos/AbdulrahmanAmer/matter-of-place/branches/main/protection` returns HTTP 403 `Upgrade to GitHub Pro or make this repository public to enable this feature`, so on today's plan this step ends BLOCKED. If step 1 finds the plan has changed: `bash scripts/protect-main.sh`, proof `gh api repos/AbdulrahmanAmer/matter-of-place/branches/main/protection --jq .required_status_checks.contexts` prints `["check","build"]`. If not: record `BLOCKED` with the option list (GitHub Pro at about 4 USD per month, which needs a decision under G-011, or owner discipline plus the fact that `deploy.yml` only deploys after its own `bun run check`). Proof either way: the decision line is in `PROJECT-STATE.md`.
10. Close-out: update `.github/workflows/README.md`, the `.env.example` names, add the Sentry follow-ups noted in POSITION (router `defaultErrorComponent` is not this slice, note only). Proof: `bun run check` and `bun run build` green; `git ls-files "Matter Of Place Codebase/.github"` prints nothing; `grep -rn "VITE_" .env.example` lists only `VITE_SITE_URL`, `VITE_API_BASE_URL`, `VITE_INSTAGRAM_URL`, `VITE_TURNSTILE_SITE_KEY`.

## Verification (commands and expected output; watched-fail for every new test)
- In `Matter Of Place Codebase`: `bun run check` then `bun run build`, both exit 0.
- `bunx vitest run tests/unit/headers.test.ts tests/unit/sentry.test.ts` passes.
- `node scripts/smoke.mjs <preview-url>` exits 0 and prints one line per URL.
- `gh run list --workflow ci.yml --limit 3` shows the last run `completed success`.
- Watched-fail, each done once and reverted (use `scripts/watchfail.mjs` from B4 once it exists, by hand before): (a) delete `frame-ancestors 'none'` from `cspFor`, `headers.test.ts` must go red on the CSP assertion; (b) stop scrubbing `authorization` in `sentry.ts`, the scrub test must go red; (c) make `smoke.mjs` skip the `x-request-id` check, then remove the header in `start.ts`, the smoke must stay green (proving the check was skipped, so restore the check) and then go red once the check is back; (d) in `ci.yml` step 5, the type-error commit turns the run red at `check`.
- G-012 proof: `git rev-parse --show-toplevel` prints `E:/Matter Of Place`; `ls .github/workflows` lists `ci.yml deploy.yml backup.yml README.md`.
- G-011 proof: `grep -n "queues\|browser\|images\|durable" "Matter Of Place Codebase/wrangler.toml"` prints nothing.

## Risks and gotchas (link GOTCHAS ids)
- G-012: workflows only work at the repo root. `defaults.run.working-directory` is set per job, and `paths-ignore` uses root-relative paths (`workspace/**`).
- G-002: `vite.config.ts` stays the single build config; this slice edits it only if step 2 proves Nitro drops `vars`. The worker name stays pinned.
- G-006: `VITE_TURNSTILE_SITE_KEY` is public by design. The G-006 proof line names three variables; update that entry to four when this lands.
- G-011 and P-009: Actions minutes. CI on a PR is about 2 minutes for `check` and 1.5 for `build`; production deploy about 4; backup about 2 per night, so roughly 60 of 2,000 minutes a month. UNPROVEN until measured on the first ten runs.
- CPU limit: free Workers allow 10 ms CPU per request. Server-rendering React on the home page may exceed it (error 1102). UNPROVEN; step 7 measures. If it fails, record the number and add a decision to `PROJECT-STATE.md` (edge-cache the HTML on the custom domain first, Workers Paid at 5 USD second). Do not add a paid binding silently.
- Cache API does not work on `workers.dev` hostnames. Preview shows no edge caching; cache headers are asserted, caching itself is proved after the custom domain exists (Stage 5).
- Branch protection is unavailable on this private repository (observed 403 above); Environments are documented as unavailable on the same plan (not tested). Step 9 ends as BLOCKED with the reason recorded if the plan does not allow it.
- Direct Supabase connections are IPv6 only on the free plan and GitHub runners have no IPv6, so `backup.yml` must use the pooler string. The dump is UNPROVEN until step 8's restore listing succeeds; a full restore rehearsal is HARDEN (architecture 7).
- `wrangler secret bulk` needs the Worker to exist, so preview deploys first and sets secrets second; a first request in that gap sees missing secrets and returns the calm 500. Acceptable for previews.
- CSP ships as Report-Only. TanStack Start injects inline scripts, so an enforcing policy needs nonces or hashes; that is HARDEN. Fonts load from Google (`fonts.googleapis.com`, `fonts.gstatic.com`), so both are in the table now.
- `bun install` skips lifecycle scripts of untrusted packages (bun 1.3). Add `wrangler` and `sharp`/`supabase` to `trustedDependencies` in B2 if their postinstall is needed; here only `wrangler` (no postinstall required, verify in step 2).
- Sentry source maps are not uploaded (stack traces reference the Nitro bundle). Workers Logs plus the request id are the debugging path at launch; revisit in HARDEN.

## Out of scope
Custom domain routes and DNS (Stage 5), the Cloudflare rate-limit rule (HARDEN), keep-warm cron (B8b `schedule_settings.keepwarm`), `render.yml` (B8), browser-side Sentry, source map upload, enforced CSP, HSTS preload, Dependabot, Lighthouse CI (B13), restore rehearsal (HARDEN), a staging environment beyond `pr-<n>`.
