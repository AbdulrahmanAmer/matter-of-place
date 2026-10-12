# Secret rotation (gap audit item 28)

Every secret the business runs on: where it lives, who reads it, and how to change it. Names only; no value is ever
written here. Measured 2026-10-12 with `bunx wrangler secret list --name matter-of-place`, `supabase secrets list
--project-ref hbokkmpgpqhrnemgsqra`, `gh secret list` and the names in the workspace `.env`.

## Where secrets live

| Place | How to list the names | How to set one |
|---|---|---|
| Worker `matter-of-place` (the site, `/api`, `/admin`) | `bunx wrangler secret list --name matter-of-place` (with the project's `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from `.env`, P-530) | `bunx wrangler secret put <NAME> --name matter-of-place` |
| Job runner Edge Function (Supabase project `hbokkmpgpqhrnemgsqra`) | `supabase secrets list --project-ref hbokkmpgpqhrnemgsqra` | `supabase secrets set <NAME>=... --project-ref hbokkmpgpqhrnemgsqra` |
| GitHub Actions (repository secrets) | `gh secret list` | `gh secret set <NAME>` |
| This laptop (`E:\Matter Of Place\.env`; the runner reads only the names in `app/scripts/workforce/env.ts`) | `grep -o '^[A-Z_]*' .env` | edit the file |

## The secrets

A secret held in more than one place must change in all of them in the same few minutes. None of our code accepts two
values at once, so the order below keeps the gap to the shortest and on the side that retries: jobs retry with backoff,
and a webhook the provider cannot deliver is sent again.

| Secret | Lives in | Read by | Rotate |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Worker; runner (Supabase sets it); GitHub `DEV_SUPABASE_SERVICE_ROLE_KEY`; laptop `DEV_SUPABASE_SERVICE_ROLE_KEY` | every server read and write | In Supabase, create a new secret key, set it in the Worker, GitHub and the laptop, deploy, then revoke the old key. Ruling H93 keeps the cookie client on this key until the publishable key switch. |
| `JOB_RUNNER_SECRET` | Worker; runner; laptop | the Worker's call to the runner, and the runner's check of it | Runner first, then the Worker within a minute. Calls in that minute fail and the jobs retry. |
| `RENDER_CALLBACK_SECRET` | Worker; GitHub; laptop | GitHub render jobs calling back to the Worker | Set it in the Worker and GitHub together, between renders (Jobs screen shows none running). |
| `CONFIRM_TOKEN_SECRET` | Worker; runner; laptop | sealing and opening confirm links | Rotating it invalidates every confirm link not yet clicked (they live 7 days, gap item 24). Set it in all three, then readers who did not confirm sign up again. |
| `RESEND_API_KEY` | runner; laptop | sending email | Create a new key in Resend, set it in the runner and laptop, send a test from Automation, Emails, then delete the old key. |
| `RESEND_WEBHOOK_SECRET` | Worker; laptop | checking Resend's delivery and unsubscribe webhooks | Roll it in Resend's webhook page, set it in the Worker at once; Resend sends any refused event again. |
| `TURNSTILE_SECRET` | Worker (laptop `PROD_TURNSTILE_SECRET`) | the spam check on public forms | Rotate in Cloudflare Turnstile, set it in the Worker. Forms fail closed without it (gap item 7), so do it in one step. |
| `CSRF_SECRET` | Worker; laptop | admin form protection | Set a new value in the Worker; open admin pages must reload once. |
| `PREVIEW_TOKEN_SECRET` | Worker; laptop | signed preview links | Set a new value; old preview links stop working. |
| `RATE_LIMIT_SALT` | Worker (laptop `PREVIEW_RATE_LIMIT_SALT` for previews) | hashing addresses for rate limits | Set a new value; limits start fresh. |
| `OPS_HEALTH_TOKEN` | Worker; laptop | the outside uptime check of the health route | Set it in the Worker and in the uptime monitor together. |
| `SENTRY_DSN` | Worker; runner (`SENTRY_DSN_JOB_RUNNER` on the laptop) | error reports | Not a secret in strength (a DSN is public by design); rotate only if abused, in Sentry's project keys. |
| `GITHUB_DISPATCH_TOKEN` | runner; laptop | starting render workflows | Fine-grained token with Actions write on this repository only; make the new one, set it in the runner, delete the old. |
| `CF_PURGE_TOKEN`, `CF_ZONE_ID` | runner | purging the edge cache after a publish | New token with Cache Purge on the zone only; set, then delete the old. |
| `INDEXNOW_KEY` | runner | telling search engines a page changed | Change only together with the key file the site serves. |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub; laptop | deploys | New token with the same scopes, set in GitHub and the laptop, run one deploy, delete the old. |
| `SUPABASE_ACCESS_TOKEN`, `DEV_SUPABASE_DB_PASSWORD` | GitHub; laptop | migrations at deploy, `db push` | New access token in Supabase account settings; the database password changes in Supabase and in both places together. |
| `PREVIEW_WORKER_SECRETS_JSON` | GitHub | the preview Worker's secrets | Rebuild the JSON from the preview values and set it. |
| `MATTER_AGENT_KEY` | laptop | Matter's admin calls (H86) | Revoke in Settings, Team and access, make a new agent key there, put it in `.env`. |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` | laptop | reading the company mailbox | Re-authorise in Zoho's API console. |
| `SENTRY_AUTH_TOKEN`, `UPTIME_API_KEY`, `PSI_API_KEY`, `CF_ANALYTICS_TOKEN` | laptop | the audit robot and the operator's tools | Make a new one in each service, replace in `.env`, delete the old. |

## The backup key

The nightly backup is encrypted to the public certificate `app/backup-recipient.pem` (ruling H5). The job can encrypt
and never decrypt. The private key is the operator's alone and is not on any machine the business runs on; losing it
loses every backup, so a new pair means committing the new certificate and keeping the old private key until the last
backup made with it has expired.

## After any rotation

Run the health check from System, Jobs (or wait for the daily run) and confirm every check is green; send a test email
from Automation, Emails; open the admin and one public page.
