# Jobs runbook

How the job runner is set up on the one database, how to tell it is alive, and how to read and rotate what it depends on. Slice B8 writes this page (steps 6 and 6a here; step 8a adds retention and the Meta token alert). Rulings cited are in `workspace/05-plans/ASSUMED.md` section H.

## How a tick reaches the runner

Every minute pg_cron runs the `job-runner` row of migration `20261004023709_job_cron.sql`: one `net.http_post` to the Edge Function `job-runner`, with the URL and the bearer read from Vault when the row runs and a 55 second timeout (pg_net's 5 second default would cut the tick, JOB-02). No secret is in a migration. The runner claims and runs jobs, then writes one heartbeat (`beat('runner', { claimed })`) at the end of every tick, also a tick that throws.

## First-time setup of an environment

Run from `app/`, with the keys loaded and never printed:

```
set -a; . <(tr -d '\r' < ../.env | grep -E '^[A-Z0-9_]+='); set +a
```

1. Vault rows, before the cron migration reaches the database. The URL is not a secret:

   ```
   echo "select vault.create_secret('https://<ref>.supabase.co/functions/v1/job-runner', 'job_runner_url') where not exists (select 1 from vault.secrets where name = 'job_runner_url');" | psql "$DEV_DB_URL"
   ```

   The bearer goes through standard input, so its value never enters a command line or a transcript (psql interpolates `:'s'` only in a statement it reads from stdin; `-c` would not):

   ```
   echo "select vault.create_secret(:'s', 'job_runner_secret') where not exists (select 1 from vault.secrets where name = 'job_runner_secret');" | psql "$DEV_DB_URL" -v s="$JOB_RUNNER_SECRET"
   ```

   Proof: `select name from vault.secrets where name in ('job_runner_url', 'job_runner_secret');` returns two rows.

2. Function secrets, set with `bunx supabase secrets set NAME="$NAME" ... --project-ref "$DEV_SUPABASE_PROJECT_REF"`: `JOB_RUNNER_SECRET` (the same value as the Vault row), `MOP_ENV=preview`, `SENTRY_DSN` (the runner's own client key, `SENTRY_DSN_JOB_RUNNER` in `.env`), `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPO`, `RENDER_CALLBACK_URL`, `MEDIA_PUBLIC_BASE`, and the Meta names once the Meta app exists (B10). Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` itself.

3. Deploy: `bunx supabase functions deploy job-runner --use-api --project-ref "$DEV_SUPABASE_PROJECT_REF"`, then `curl` the function with the bearer: `{"claimed":0,"jobs":[]}` and 200; no bearer or a wrong one answers 401. `verify_jwt = false` travels with the deploy, not with `config push` (GOTCHAS P-908). The deploy does not honour a stale `deno.lock`: the exact versions in `deno.json` are the guard (ASSUMED E5).

4. The cron row arrives with `main`'s `bun run db:push`. Proof: `select jobname, schedule from cron.job where jobname = 'job-runner';` returns one row, and the Supabase logs of service `edge-function` show `job-runner` answering 200 a minute apart. A `succeeded` row in `cron.job_run_details` proves only that `net.http_post` queued the request, never that the runner answered (DO-03); the heartbeat below is the proof that it did.

5. Worker secrets: `JOB_RUNNER_SECRET`, `RENDER_CALLBACK_SECRET` and `OPS_HEALTH_TOKEN` go into `.env` and, by the orchestrator, into the GitHub secret `PREVIEW_WORKER_SECRETS_JSON` (F12), so `matter-of-place-dev` and the previews hold them. The production Worker gets each from the owner's shell, for example `printf %s "$OPS_HEALTH_TOKEN" | bunx wrangler secret put OPS_HEALTH_TOKEN --name matter-of-place`.

## The launch switch

L1's launch switch changes three function secrets on the one project (ruling H35 (8)): `MOP_ENV` from `preview` to `production`, and `RENDER_CALLBACK_URL` and `MEDIA_PUBLIC_BASE` to the production Worker's `workers.dev` origin at L1 step 1d, then to `matterofplace.com` at L1 step 4e. From the switch on, the dev Worker and the previews hold no database key.

## Liveness: heartbeats and the ops-health hook

Table `ops_heartbeats` holds one row per process that beats, written only by `beat(name, detail)`: the runner every tick, B8b's keep-warm tick, and B1b's `backup.yml` after a backup. `ops_health(now)` turns their ages into `{ ok, failing }`. A name is failing when:

- `runner`: its beat is older than 3 minutes, or absent. A runner the cron cannot reach (a 401 after a rotation, a 500, a boot error, a paused project) never beats, so this covers all of them.
- `keepwarm`: absent or older than 25 minutes, only while the `keepwarm` row of `schedule_settings` is enabled.
- `backup`: absent or older than 26 hours, only while the `backup` row of `schedule_settings` is enabled.
- `stale_queue`: a `queued` job, not `run_local`, due more than 15 minutes ago.
- `dead_jobs`: a job went `dead` in the last 24 hours.

`GET /api/hooks/ops-health/<OPS_HEALTH_TOKEN>` answers `ok` with 200 or `fail: <names>` with 503, as plain text and never cached. A wrong token or an unset secret answers 404 and reads nothing. A Worker without a database key answers 503 `fail: ops_health_rpc` to the right token.

Check it:

```
curl -s -o /dev/null -w "%{http_code}" https://matter-of-place-dev.holy-meadow-4327.workers.dev/api/hooks/ops-health/$OPS_HEALTH_TOKEN
```

200, or 503 with `dead_jobs` when a job died in the last day (the hook working). After the launch switch, call the production URL instead.

On the database: `select now() - at < interval '3 minutes' from ops_heartbeats where name = 'runner';` prints `t` while the runner ticks.

### The uptime monitor

A third UptimeRobot keyword monitor polls the production URL every 5 minutes for the keyword `ok` and alerts the admin mailbox, so a stopped runner reaches a person without the runner or Resend. The operator signs up for the account; the orchestrator configures the monitor (decision S59); B14 records it.

### Proving the alarm once

Before the launch switch, on `mop-dev`: replace the Vault `job_runner_secret` with a wrong value from the owner's shell (the right value stays in `.env`):

```
echo "select vault.update_secret(id, :'s') from vault.secrets where name = 'job_runner_secret';" | psql "$DEV_DB_URL" -v s="wrong-$(openssl rand -hex 8)"
```

Within 5 minutes the hook answers 503 with a body naming `runner`. Put the right value back with the same statement and `-v s="$JOB_RUNNER_SECRET"`; within 5 minutes `runner` leaves the body.

## Rotations

- `OPS_HEALTH_TOKEN`: `openssl rand -hex 32` into `.env`; the orchestrator updates `PREVIEW_WORKER_SECRETS_JSON`; set the production Worker with the `wrangler secret put` line above; change the monitor's URL; the old token then answers 404.
- `JOB_RUNNER_SECRET`: a new value in `.env`, then the function secret (`supabase secrets set`) and the Vault row (`vault.update_secret` through stdin, as above) one right after the other. Between the two, ticks answer 401 and the `runner` beat goes stale, which is expected for a minute.
- `GITHUB_DISPATCH_TOKEN`: fine-grained, this repository only, Actions read and write plus Metadata read, no Contents, no expiration (ASSUMED E22). The orchestrator makes it and rotates it by hand once a year (decision S59); it is a function secret, not a Worker secret (JOB-01, SEC-02).
- The service-role key and the Resend key: by hand in their dashboards, then into `.env` and every secret store that holds them.

Every rotation by hand ends with its one audit row, written from `app/` with the dev profile loaded:

```
bun run scripts/audit-note.ts --secret <NAME> --note "<why>" --i-mean-it
```

`<NAME>` is the name as tech-stack section 4 writes it (G33). Without `--i-mean-it` or `--secret` the script exits 1 and writes nothing.

## The daily jobs

pg_cron enqueues four system jobs, each keyed `<type>:<UTC date>`, so a second tick the same day adds nothing: `prune` at 03:30 UTC, `retention` at 03:45, `meta_token_refresh` at 04:15 and `health` at 13:00. The runner takes them on its next tick.

- `prune` deletes done and cancelled jobs after the `jobs_done` period, with their timeline, and the rate-limit hits and webhook receipts after theirs. `jobs.result` holds the three counts.
- `health` runs every check and stores what each said in `jobs.result.checks`. A failed check sends one Sentry event and one `health.failed` event, which B8b's `notify_admin_health` recipe mails to the admins. `params.force_fail` names a check to fail on purpose, for H1's drill.

## The retention job

`retention` is the only code that deletes rows for good, and files it removes from Storage cannot come back. Each policy row of `retention_policies` gives its period (`keep_for`); a disabled row or one with no period is skipped. In order: the photographs of declined requests and of withdrawn ones 90 days after their last change, with their thumbnails; the originals of an accepted request once every photograph of its property has its variants; inquiries and people anonymised after 24 months; yesterday and the day before rolled up into `analytics_daily`, then the monthly `analytics_events` partitions past their period dropped after their own roll-up; old aggregates, closed privacy requests, dead jobs, processed events no job points at, sent-email addresses, unconfirmed subscribers, pg_cron history and the wait rows of long-waiting jobs. `audit_log` and `automation_revisions` are never touched.

Each run writes one `retention.run` audit row with `{ <policy>: { affected, remaining } }` and stamps `last_run_at` and `last_count` on each policy row it ran. The health check `retention_stalled` fails when an enabled policy has not run for 2 days or its last run left rows behind.

Before the first production run, and whenever a period changes, run it as a dry run: it counts and changes nothing.

```
bun run db:psql -- -Atc "select enqueue_job('retention', '{\"params\": {\"dry_run\": true}, \"data\": {}}', 'retention-dry:' || now())"
bun run db:psql -- -Atc "select status, result from jobs where idempotency_key like 'retention-dry:%' order by created_at desc limit 1"
bun run db:psql -- -Atc "select key, last_run_at, last_count from retention_policies order by key"
```

A Storage error leaves the rows of the files it could not remove, and the job waits an hour and runs again.

## The Meta token alert

`meta_token_refresh` does nothing until the account ids are stored on the channels screen. Then each day it asks Meta about the token (Vault's `meta_page_token` first, the `META_PAGE_TOKEN` function secret second) and stores what it learned in `settings.meta`: `token_expires_at` (null means never), `token_state` (`ok`, `dead` or `scopes_missing`, with `missing_scopes`) and `data_access_expires_at`.

- "Instagram token is no longer valid": reconnect the account on `/admin/channels`; publishing waits until then.
- "Meta token expires in n days": the job could not renew it (a page token has no renewal route). Make a new long-lived token and store it from the channels screen; it goes to Vault with its `secret.rotated` audit row.
- `scopes_missing`: grant the named permissions to the Meta app and reconnect.

A token that a renewal route can extend is renewed in place within 7 days of its expiry, with no alert.

## Sentry for the runner

The runner reports with its own client key (`SENTRY_DSN_JOB_RUNNER`), kept apart from the Worker's key so a burst of job failures cannot use up the Worker's quota. Set on that key, in Sentry's client key settings: a rate limit of 20 events an hour, and spike protection on (INT-12).

## Local caption jobs

A job with `run_local` true waits for the caption runner on the laptop (ruling H34 (2)): the Edge Function deletes its message and leaves the job `queued`, and `ops_health` does not count it as a stale queue. When an editor types the captions on the asset's screen instead (ruling H34 (5)), the waiting job is completed with `claim_job` and then `finish_job` with `p_result => '{"manual": true}'`.

## Reading a dead job

```
select id, type, attempts, error, finished_at from jobs where status = 'dead' order by finished_at desc limit 20;
select at, kind, from_status, to_status, attempt, message from job_events where job_id = '<id>' order by id;
```

`error` is the reason the last attempt stored (`step_timeout`, `unknown_step`, `invalid_params`, `payload_too_large`, or the step's own text). Fix the cause first; a retry from `/admin` comes with step 9.

## What a restore must recreate

The Vault rows are not in a migration: `job_runner_url`, `job_runner_secret`, `meta_page_token`, `x_oauth_token` and `linkedin_oauth_token` (DO-06). Recreate the first two with the setup lines above before the cron runs.
