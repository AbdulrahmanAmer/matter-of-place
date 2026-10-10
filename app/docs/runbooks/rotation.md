# Secrets rotation runbook

For the person who rotates a secret, on schedule or after a leak. Roles, not people (GS-05): the CEO holds the vendor
logins and decides; mop-builder works in a fresh session and makes the changes. Two scripts back this runbook:
`bun run scripts/harden/rotation-drill.ts --env dev --base <dev>` rehearses an agent key rotation, and
`bun run scripts/harden/secret-ages.ts --env prod-config` lists what is old. `node scripts/harden/runbook-lint.mjs
docs/runbooks` fails when the inventory below differs from the secret names of tech-stack section 4, of `.env.example`
or of the H1-07 list.

## 1. Rules

- The local copies live in two git-ignored files at the repository root. `.env` holds the dev names. `.env.ops` holds
  `CLOUDFLARE_API_TOKEN` (the owner's `mop-admin`), `CF_EDGE_TOKEN`, `SUPABASE_ACCESS_TOKEN` and every `PROD_*` name.
  They are loaded only by `scripts/load-env.mjs --profile dev` or `--profile ops`, and never in the same shell as a
  test (SEC-08).
- Where two values can live at once (vendor tokens, agent keys), add the new secret and verify it before revoking the
  old one.
- The HMAC keys have no overlap: no second value is accepted (G46). They are swapped in a maintenance window, see the
  inventory.
- Never paste a secret into a chat or the repository (G-006). Set secrets only through `bunx wrangler secret put`,
  `bunx supabase secrets set` and `gh secret set`.
- Every manual rotation ends with `bun run scripts/audit-note.ts --secret <NAME> --note "<text>" --i-mean-it`. It writes
  one `audit_log` row with action `secret.rotated` and `entity` set to `<NAME>`, the name as written in the inventory
  below and in tech-stack section 4 (G33). The value is never stored.
- A suspected compromise means rotate now, not at the cadence.

## 2. Cadence and inventory

Cadences marked ASSUMED are a decision of this runbook, not a vendor rule. The owner is the role that acts: `CEO` when
a vendor login is needed, `mop-builder` otherwise. "Verify" is what proves the new value works; section 3 lists the
commands that show a secret is set (`list`).

| Name                            | Lives in                                                                                                                          | Cadence                               | Owner       | Verify                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY`     | Worker, Edge Functions                                                                                                            | 12 months, ASSUMED                    | CEO         | service-role procedure of section 3                                                                             |
| `DEV_SUPABASE_SERVICE_ROLE_KEY` | GitHub Actions, local `.env`                                                                                                      | 12 months, ASSUMED                    | CEO         | service-role procedure of section 3                                                                             |
| `RESEND_API_KEY`                | Edge Function                                                                                                                     | 12 months, ASSUMED                    | CEO         | `bun run scripts/resend-check.ts`                                                                               |
| `META_PAGE_TOKEN`               | Vault                                                                                                                             | 60 days                               | mop-builder | refreshed by the `meta_token_refresh` job, alert 7 days before expiry (GS-01); fallback in section 3            |
| `AUDIT_AGENT_KEY`               | agent_keys row, operator's shell                                                                                                  | 90 days                               | CEO         | section 4                                                                                                       |
| `AUDIT_AGENT_KEY_DEV`           | agent_keys row, operator's shell only                                                                                             | 90 days                               | CEO         | section 4                                                                                                       |
| `REHEARSAL_AGENT_KEY`           | agent_keys row, local `.env`; revoked after L1 sign-off                                                                           | 90 days                               | mop-builder | section 4                                                                                                       |
| `CLOUDFLARE_API_TOKEN`          | GitHub Actions (deploy token `mop-github-actions`), local `.env.ops` (owner's `mop-admin`, SEC-08)                                | 12 months, ASSUMED                    | CEO         | `gh run list --workflow deploy.yml --limit 1` after a push to `main`                                            |
| `CF_EDGE_TOKEN`                 | local `.env.ops`                                                                                                                  | 12 months, ASSUMED                    | CEO         | the cf-edge script of B1b, when it exists                                                                       |
| `RENDER_CALLBACK_SECRET`        | Worker, GitHub Actions                                                                                                            | 12 months, ASSUMED                    | mop-builder | `bun run scripts/job-selftest.ts`                                                                               |
| `OMNIKOM_WEBHOOK_SECRET`        | Edge Function, local `.env.ops`                                                                                                   | 12 months, ASSUMED                    | CEO         | changed on both sides at a time agreed with Omnikom                                                             |
| `PREVIEW_TOKEN_SECRET`          | Worker, preview bundle                                                                                                            | 12 months, ASSUMED                    | mop-builder | make a new preview link of a property                                                                           |
| `CSRF_SECRET`                   | Worker, preview bundle                                                                                                            | 12 months, ASSUMED                    | mop-builder | sign in to `/admin` and save a setting                                                                          |
| `CONFIRM_TOKEN_SECRET`          | Worker, Edge Function, preview bundle                                                                                             | 12 months, ASSUMED                    | mop-builder | sign up a test address on the public form and open its confirm link                                             |
| `PREVIEW_WORKER_SECRETS_JSON`   | GitHub Actions                                                                                                                    | with its keys                         | mop-builder | `gh secret list`                                                                                                |
| `TURNSTILE_SECRET`              | Worker, preview bundle                                                                                                            | 12 months, ASSUMED                    | CEO         | submit the public form once                                                                                     |
| `JOB_RUNNER_SECRET`             | Worker, Edge Function, preview bundle                                                                                             | 12 months, ASSUMED                    | mop-builder | a POST to `<project>/functions/v1/job-runner` with the new bearer does not answer `401`                         |
| `RESEND_WEBHOOK_SECRET`         | Worker, preview bundle; exists once Resend does                                                                                   | 12 months, ASSUMED                    | CEO         | send a test event from the Resend dashboard                                                                     |
| `SENTRY_TEST_TOKEN`             | Worker, preview bundle                                                                                                            | 12 months, ASSUMED                    | mop-builder | `POST /api/hooks/sentry-test` with the new token (the route answers 404 while the secret is unset)              |
| `CF_PURGE_TOKEN`                | Edge Function, local `.env`                                                                                                       | 12 months, ASSUMED                    | CEO         | `node scripts/cf-purge-token.mjs --check`                                                                       |
| `META_APP_SECRET`               | Edge Function                                                                                                                     | 12 months, ASSUMED                    | CEO         | `bun run scripts/meta-check.ts --target dev`                                                                    |
| `X_CLIENT_SECRET`               | Edge Function                                                                                                                     | 12 months, ASSUMED                    | CEO         | the channel check of screen 20                                                                                  |
| `LINKEDIN_CLIENT_SECRET`        | Edge Function                                                                                                                     | 12 months, ASSUMED                    | CEO         | the channel check of screen 20                                                                                  |
| `GITHUB_DISPATCH_TOKEN`         | Edge Function                                                                                                                     | 12 months, ASSUMED                    | CEO         | `bun run scripts/job-selftest.ts`                                                                               |
| `OPS_HEALTH_TOKEN`              | Worker, preview bundle                                                                                                            | 12 months, ASSUMED                    | mop-builder | the ops-health URL with the new token, and the third uptime monitor                                             |
| `X_ACCESS_TOKEN`                | Vault                                                                                                                             | refreshed by the job                  | mop-builder | the channel check of screen 20                                                                                  |
| `X_REFRESH_TOKEN`               | Vault                                                                                                                             | refreshed by the job                  | mop-builder | the channel check of screen 20                                                                                  |
| `LINKEDIN_ACCESS_TOKEN`         | Vault                                                                                                                             | refreshed by the job                  | mop-builder | the channel check of screen 20                                                                                  |
| `LINKEDIN_REFRESH_TOKEN`        | Vault                                                                                                                             | refreshed by the job                  | mop-builder | the channel check of screen 20                                                                                  |
| `RATE_LIMIT_SALT`               | Worker, preview bundle                                                                                                            | on a suspected leak                   | mop-builder | a public form post is still accepted                                                                            |
| `SENTRY_AUTH_TOKEN`             | local `.env`                                                                                                                      | 12 months, ASSUMED                    | CEO         | UNPROVEN: no script reads it yet; open Sentry, User Settings, Auth Tokens                                       |
| `PSI_API_KEY`                   | routine environment, local `.env`                                                                                                 | 12 months, ASSUMED                    | CEO         | the next audit run (`node ../workspace/audits/tools/run-all.mjs`) measures the source instead of `not_measured` |
| `GOOGLE_SA_JSON_B64`            | routine environment, local `.env`                                                                                                 | 12 months, ASSUMED                    | CEO         | as `PSI_API_KEY`                                                                                                |
| `CF_ANALYTICS_TOKEN`            | GitHub Actions, local `.env`                                                                                                      | 12 months, ASSUMED                    | CEO         | `gh secret list`                                                                                                |
| `UPTIME_API_KEY`                | routine environment, local `.env`                                                                                                 | 12 months, ASSUMED                    | CEO         | the uptime vendor's read call                                                                                   |
| `BING_WEBMASTER_API_KEY`        | routine environment                                                                                                               | 12 months, ASSUMED                    | CEO         | as `PSI_API_KEY`                                                                                                |
| `INDEXNOW_KEY`                  | Edge Function, optional                                                                                                           | 12 months, ASSUMED                    | mop-builder | the `purge_cache` job result                                                                                    |
| `SUPABASE_ACCESS_TOKEN`         | GitHub Actions (main-only `dev` and `production` jobs, SEC-01), local `.env.ops`                                                  | 12 months, ASSUMED                    | CEO         | `bunx supabase projects list`                                                                                   |
| `DEV_SUPABASE_DB_PASSWORD`      | GitHub Actions, local `.env`                                                                                                      | 12 months, ASSUMED                    | CEO         | `bun run db:psql -- -Atc "select 1"`                                                                            |
| `DEV_DB_URL`                    | GitHub Actions, local `.env`                                                                                                      | 12 months, ASSUMED                    | CEO         | carries the database password and changes with it                                                               |
| `PREVIEW_RATE_LIMIT_SALT`       | local `.env`, source copy of a bundle key                                                                                         | with `RATE_LIMIT_SALT`, ASSUMED       | mop-builder | as `RATE_LIMIT_SALT`                                                                                            |
| `PREVIEW_SENTRY_TEST_TOKEN`     | local `.env`, source copy of a bundle key                                                                                         | with `SENTRY_TEST_TOKEN`, ASSUMED     | mop-builder | as `SENTRY_TEST_TOKEN`                                                                                          |
| `PROD_RATE_LIMIT_SALT`          | local `.env.ops`                                                                                                                  | with `RATE_LIMIT_SALT`, ASSUMED       | mop-builder | as `RATE_LIMIT_SALT`                                                                                            |
| `PROD_CONFIRM_TOKEN_SECRET`     | local `.env.ops`                                                                                                                  | with `CONFIRM_TOKEN_SECRET`, ASSUMED  | mop-builder | as `CONFIRM_TOKEN_SECRET`                                                                                       |
| `PROD_PREVIEW_TOKEN_SECRET`     | local `.env.ops`                                                                                                                  | with `PREVIEW_TOKEN_SECRET`, ASSUMED  | mop-builder | as `PREVIEW_TOKEN_SECRET`                                                                                       |
| `PROD_CSRF_SECRET`              | local `.env.ops`                                                                                                                  | with `CSRF_SECRET`, ASSUMED           | mop-builder | as `CSRF_SECRET`                                                                                                |
| `PROD_JOB_RUNNER_SECRET`        | local `.env.ops`                                                                                                                  | with `JOB_RUNNER_SECRET`, ASSUMED     | mop-builder | as `JOB_RUNNER_SECRET`                                                                                          |
| `PROD_OPS_HEALTH_TOKEN`         | local `.env.ops`                                                                                                                  | with `OPS_HEALTH_TOKEN`, ASSUMED      | mop-builder | as `OPS_HEALTH_TOKEN`                                                                                           |
| `PROD_RESEND_WEBHOOK_SECRET`    | local `.env.ops`                                                                                                                  | with `RESEND_WEBHOOK_SECRET`, ASSUMED | CEO         | as `RESEND_WEBHOOK_SECRET`                                                                                      |
| `PROD_RESEND_API_KEY`           | local `.env.ops`; production's own full-access Resend key (ruling H28), never equal to `RESEND_API_KEY` of `mop-dev` (INT-02 (4)) | with `RESEND_API_KEY`, ASSUMED        | CEO         | as `RESEND_API_KEY`                                                                                             |
| `PROD_TURNSTILE_SECRET`         | local `.env.ops`                                                                                                                  | with `TURNSTILE_SECRET`, ASSUMED      | CEO         | as `TURNSTILE_SECRET`                                                                                           |

Rules that belong to single rows:

- The HMAC keys `RENDER_CALLBACK_SECRET`, `OMNIKOM_WEBHOOK_SECRET`, `PREVIEW_TOKEN_SECRET` and `CSRF_SECRET` accept one
  value only (G46). Rotate each in a short maintenance window: set the new value everywhere it lives, then deploy. A
  render callback signed with the old value during the swap gets `401`, its heavy job is failed by the reaper after 30
  minutes and retried by the backoff. A preview link made with the old value stops working and is made again.
  `OMNIKOM_WEBHOOK_SECRET` is changed on both sides at a time agreed with Omnikom; a `webhook_omnikom` job refused during
  the swap is retried by its backoff.
- `CONFIRM_TOKEN_SECRET` is a Worker secret, a Supabase function secret and a key of the preview bundle (G12). Change
  the Worker and the function secret in the same sitting: the Worker seals the confirm token and the job runner opens it.
- `PREVIEW_WORKER_SECRETS_JSON` is rewritten from `.env` whenever one of its keys rotates (F12). L1's launch switch
  removes its two database keys (ruling H35 (7)).
- `DEV_SUPABASE_SERVICE_ROLE_KEY` is the one project's key, production's after L1's launch switch (ruling H35 (1)).
  `DEV_SUPABASE_DB_PASSWORD` and `DEV_DB_URL` keep their spelling after the switch for the same reason.
- `AUDIT_AGENT_KEY_DEV` lives in the operator's shell only, never in a file. `REHEARSAL_AGENT_KEY` is revoked after L1
  sign-off.
- `CLOUDFLARE_API_TOKEN` is two tokens under one name: the deploy token `mop-github-actions` in GitHub and the owner's
  `mop-admin` in `.env.ops`.
- `GITHUB_DISPATCH_TOKEN` is fine-grained for this repository only, with Actions read and write and Metadata read and no
  Contents permission, so it can dispatch `render.yml` through `workflow_dispatch` and can never push to `main`
  (JOB-01, SEC-02). It was made on 2026-10-02 with no expiration by the operator's word (ASSUMED E22), so its cadence is
  12 months by hand. A later token that carries an expiry is warned about 14 days ahead by the `github_dispatch` health
  check, which fails on a `401` (INT-07).
- `OPS_HEALTH_TOKEN` is rotated together with the URL of the third uptime monitor, which holds it.
- `META_PAGE_TOKEN`, `X_ACCESS_TOKEN`, `X_REFRESH_TOKEN`, `LINKEDIN_ACCESS_TOKEN` and `LINKEDIN_REFRESH_TOKEN` are
  refreshed by the jobs of the channel slices, which write their own `secret.rotated` rows. Rotate them by hand only
  when the refresh alerts.
- `RATE_LIMIT_SALT` is rotated only on a suspected leak, because a new salt breaks the continuity of `ip_hash` for rate
  limits and duplicate checks.
- `SENTRY_AUTH_TOKEN` is the read-only Sentry user token `mop-readonly` (G11), also in the local `.env` for
  `sentry-probe.ts`. No other audit credential exists (G11).
- The backup key pair is not an environment name (DO-02, ruling H5). The certificate `app/backup-recipient.pem` is
  committed and `backup.yml` encrypts to it. The private key `creds/backup-recipient.key` is escrowed offline by the
  operator in the password manager and on a sealed paper copy, and is never in `.env`, `.env.ops` or GitHub (DO-06 (5)).
  Make a new pair every 12 months, ASSUMED, with the `openssl req -x509` command of the Variables table in `workspace/05-plans/B1b.md`. The old
  private key stays in escrow until the last dump encrypted to its certificate is past its retention. A lost private key
  makes every dump encrypted to it unreadable; `restore.md` names who holds the escrow.

## 3. Procedure per secret

For any secret: create the new value, set it in every place the inventory names, deploy, verify, revoke the old one,
record it (section 6).

Commands that set and list, by place. Values are never printed by any of them.

- Worker: `bunx wrangler secret put <NAME> --name matter-of-place`, list with `bunx wrangler secret list --name matter-of-place`.
- Edge Function: `bunx supabase secrets set <NAME>=<value> --project-ref "$DEV_SUPABASE_PROJECT_REF"`, list with
  `bunx supabase secrets list --project-ref "$DEV_SUPABASE_PROJECT_REF"`.
- GitHub Actions: `gh secret set <NAME>`, list with `gh secret list`.

The Supabase service-role key is used in three places (Worker, Edge Functions, GitHub Actions), so it has its own steps.
First find out which key system the project uses (dashboard, Project Settings, API Keys). That fact is UNPROVEN here:
if the project is on legacy JWT keys, rotating the service role means rotating the JWT secret and every token derived
from it at once (GS-01), so do not start without a maintenance window. If it offers new secret keys, they are created
and revoked separately.

1. Create the new service-role key in the dashboard. Do not revoke the old one.
2. Put it in `.env` as `DEV_SUPABASE_SERVICE_ROLE_KEY` (never print it).
3. Set it on the Worker: `bunx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --name matter-of-place`.
4. Update the `SUPABASE_SERVICE_ROLE_KEY` key of the `PREVIEW_WORKER_SECRETS_JSON` bundle. UNPROVEN: whether the Edge
   Functions pick up a rotated key without a redeploy. Redeploy the runner with
   `bunx supabase functions deploy job-runner --use-api` and verify in step 6.
5. Set it in GitHub: `gh secret set DEV_SUPABASE_SERVICE_ROLE_KEY`.
6. Deploy, then verify: `bun run scripts/job-selftest.ts --light-only` and a read of the public site.
7. Revoke the old key in the dashboard.
8. Record both names (section 6).

The Meta token has a manual fallback for when its refresh job alerts: run `bun run scripts/meta-check.ts --target dev`
(the one project is the only target, ruling H35), then get a fresh long-lived token from Meta, set it as the Vault
secret, and record `META_PAGE_TOKEN`.

## 4. Agent keys

1. Create the replacement on screen 23 (Admin, Team, the agent).
2. Hand the new key over. Keys start with `mopk_` and are shown once.
3. Confirm `last_used_at` of the agent moves to the new key.
4. Revoke the old key on the same screen.
5. Check the old key gets `401` from `GET /api/admin/me`.

Keys older than 90 days appear in `bun run scripts/harden/secret-ages.ts --env prod-config` and in the weekly audit
report. `bun run scripts/harden/rotation-drill.ts --env dev --base <dev>` rehearses the sequence for the dev agent: two new
keys both answer `200`, the first is revoked, it then answers `401` while the second answers `200`, both rows are
deleted, and the rehearsal is recorded as `secret.rotated` with `entity` `AGENT_KEY`.

## 5. If a secret leaks

1. Say which secret and where it showed (a chat, a log, the repository, a screenshot). The CEO decides; mop-builder
   acts.
2. Revoke it at its source first (the vendor dashboard, or screen 23 for an agent key; `POST /api/admin/team/agents/revoke-all`
   when no one knows which key it was).
3. Rotate: create the new value, set it everywhere the inventory names, deploy, verify (sections 3 and 4).
4. Read the logs from the time of the leak: Sentry, `bunx wrangler tail matter-of-place --format json --status error`
   from the owner's shell, the `audit_log` and the vendor's own access log.
5. Note it in the incident file of `docs/runbooks/incident.md` section 10.
6. Check the history for the value: the `gitleaks` scan of `.github/workflows/audit-deps.yml` runs over the whole
   history (H1-08). A secret found in history is rotated even when the repository is private.

## 6. Record and check

- Record: `bun run scripts/audit-note.ts --secret <NAME> --note "<text>" --i-mean-it`, with `<NAME>` as in the
  inventory. The refresh jobs of the Meta, X and LinkedIn tokens write their own `secret.rotated` rows.
- Check: `bun run scripts/harden/secret-ages.ts --env prod-config` prints one line per inventory name, per live agent key
  and per channel token, red lines first, and exits 1 when any line is red. A name whose cadence is "with `PARENT`" is
  aged by its parent's cadence when that has days. A name with no days in its cadence (a token the job refreshes, a salt rotated on a suspected
  leak, `PREVIEW_WORKER_SECRETS_JSON`) prints `no cadence in days, not aged` and cannot go red.
- A red line means one of three things. An agent key is older than 90 days: rotate it (section 4). A Meta, X or
  LinkedIn token expires within 7 days or is past: refresh it (section 3) and read the channel check on screen 20. A
  secret's newest `secret.rotated` row is older than its cadence in section 2: rotate it.
- A line starting `unrecorded` is not red: no `secret.rotated` row exists for that name yet, so its age is unknown.
  Record the first rotation, or the day the value was last known good, to start the clock.
