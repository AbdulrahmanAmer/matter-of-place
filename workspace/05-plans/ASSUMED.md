# ASSUMED and open decisions from the plan pass (2026-09-30)

Three Sonnet workers wrote the 20 plans from the architecture. Where the spec was silent they chose and marked
"ASSUMED". This file is the consolidated list. Section A: settled by the CTO now (recorded here, plans stand as
written). Section B: needs the CEO. Section C: unproven until built (each plan has a step that measures it).

## A. Settled by the CTO (build as the plans say)
| # | Decision | Where |
|---|---|---|
| A1 | `user_roles` is unique on `(user_id, role)`: a person can hold several roles (the CEO is `admin` and `chief_editor`) | B2, B7 step 14 |
| A2 | B2 creates every table in architecture §3.1–3.4 plus `decline_reasons`, `payments`, `campaigns` and the editorial gate; §3.5 and §3.6 tables belong to B8, B8b, B9–B11. B6/B7/B8b alter, never create | B2, B6, B7, B8b |
| A3 | `payments` gains `void` status (invoice issued in error), plus `due_at`, `paid_method`, `paid_reference`, `waived_by`, `invoice_snapshot`; numbers are gapless per UTC year (`MOP-YYYY-NNNN`) | B6 |
| A4 | Invoice issue is blocked until entity, address, contact email and one payment method are set in `settings.site` | B6, B16 |
| A5 | Agents get 403 `human_only` on mark-paid, waive, activate, team, settings, and cannot set any `approval_mode` to `auto`; daily decision cap default 25 | B7, B8b (S38 guardrails) |
| A6 | Resend webhook route is `/api/hooks/resend` (B3 owns it; architecture §4.3 corrected) | B3, B5 |
| A7 | Double opt-in: `subscriber.created` is added to the event catalog (15 events); B5 sends the confirm mail from it; B11 creates the Resend contact on `subscriber.confirmed` | B3, B5, B11 |
| A8 | Coming-soon market opens by the `property.published` recipe step (per §10), not a database trigger; the trigger in B3b is dropped | B3b |
| A9 | Empty market and region pages are `noindex` and out of the sitemap; `/properties` is `noindex` while empty | B3b, B13 |
| A10 | Admin pages are client-rendered (`ssr: false`); admin CSS lives in `src/styles/admin/index.css` imported by `admin.tsx` only; admin actions go to `audit_log`, never `track()` | B7, B8, B8b |
| A11 | Preview URL shape follows the account subdomain (`pr-<n>.<account>.workers.dev`); DEV_/PROD_ prefixed secrets; production secrets set by hand; CSP report-only first; Actions pinned by major | B1b |
| A12 | Branch protection is a CI rule until GitHub Pro (P-028) | B1b |
| A13 | Media columns hold R2 keys; variants JPEG for carousel/og, AVIF+JPEG for hero/card; coordinates stored `point(lon, lat)` | B2 |
| A14 | Schedules: digest every 14 days (`interval_days`), audit `0 12 * * 6` UTC, timezones UTC by default; audit/reconcile/backup are external clocks | B8b, B11, B14 |
| A15 | Reach-tier approval manual by default; `auto_after` set at launch + 60 days (S23) | B10, L1 |
| A16 | Asset-to-channel map (S48): carousel, story, reel → Instagram; cover (X crop 1200×675 or the 1200×630 cover, short caption plus property link) → X; cover or the first 3 to 4 carousel images (longer editorial caption for agents and brokerages) → LinkedIn; cover, story → Facebook only when enabled; daily cap 2 posts/channel; no hashtags at launch; B9 `write_captions` writes three variants (Instagram, X short, LinkedIn editorial) | B10, B9 |
| A17 | Reel 18 s, 1080×1920, 30 fps, single-plane camera moves, sound bed by property type and market (no music, S36) | B12 |
| A18 | Archive URLs `/archive/<kind>/<slug>`; `llms-full.txt` capped at 500 KB; city-level location only; `public/robots.txt` replaced by a route | B13 |
| A19 | Terms and privacy split to `/terms` and `/privacy` with redirects from the old `/legal#terms` and `/legal#privacy` anchors (the plan's "no redirect" is overruled) | B16 |
| A20 | Backups are encrypted with `openssl enc -aes-256-cbc -pbkdf2` and `BACKUP_PASSPHRASE` (age is not installed, E11); the restore rehearsal runs on a throwaway cluster of the native PostgreSQL 18, never a local Supabase stack (S50); DMARC starts at `p=none` | H1, B1b |
| A21 | Omnikom endpoint contract v1 as drafted; step 7 BLOCKED until Omnikom supplies URL and secret | B15 |

## B. Answered by the CEO (2026-09-30; recorded as S43–S46)
| # | Question | Answer |
|---|---|---|
| Q13 | Coming-soon pages with or without illustrative photographs? | **Without.** Type only; no illustrative imagery on production. B3b's viewer statement becomes the coming-soon statement; market/region photos are hidden while `coming_soon` is true. |
| Q14 | AI crawler policy? | **Allow everything.** B13 drops the AI-specific disallow rules. |
| Q15 | Review email copy now or after build? | After the first build, in the admin editor. |
| Q16 | Agent cap and no auto-switching of channels? | Keep both for 60 days. |

## C. Unproven until built (each plan measures it in a named step)
Worker 10 ms CPU limit for SSR and admin (B1b, B3, H1) · `pg_dump` via session pooler and restore (B1b, H1) · Actions
minutes per render (B9, B12) · Supabase signed PUT behaviour and 2-hour URL lifetime (B3) · Bun importing `.jpg` in the
seed (B2) · Deno `npm:` support for `pdf-lib`, React Email, `cron-parser` in the Edge Function (B6, B8) · Resend
`Idempotency-Key` and whether auth mail shares the daily quota (B5) · `@supabase/ssr` in the Worker (B7) · cloud
routine egress for the auditor (B14) · Meta development-mode publishing without App Review (B10) · X free-tier write limits, media upload on the free tier and scope names (B10 step 3a) · LinkedIn product approval and timing, rate limits, multi-image posts, image sizes (1200×627 single, 1080×1080 set) and scope names (B10 step 3b, B9) · caption limits X 280 with the link counted at 23 and LinkedIn 3,000 (B9, B10 steps 3a and 3b).

## D. Spec corrections to apply to architecture.md (done by the CTO in the next docs commit)
Event catalog: add `subscriber.created`, `submission.awaiting_assets`, `property.unpublished` recipes (17 events).
§4.2: add `auth`, `me`, `dashboard`, `issues PUT`, `subscribers GET`, `audit.usage`, `audit.health`, `schedules.$key`,
`caption` edit. §4.3: `/api/hooks/resend`. §3.4: `payments` columns and `invoice_counters`. §3.5:
`schedule_settings.interval_days`. §3.6: `jobs.cancelled`, `assets.revision/meta/render_error`, `email_messages`,
`email_suppressions`, `email_events`. tech-stack §4: Supabase function secrets for Meta, R2, Omnikom, Anthropic.

## E. Measured on 2026-10-01 (facts, not assumptions; they overrule any older line in a plan)
| # | Fact | How it was measured |
|---|---|---|
| E1 | The GitHub deploy token `mop-github-actions` is an account token with exactly three permissions: Workers Scripts Write, Workers R2 Storage Write, Workers KV Storage Read. `wrangler whoami`, `wrangler deploy` and `wrangler delete --force` all exit 0 with that set. Without KV read, `wrangler delete` removes the Worker and then exits non-zero on `GET /storage/kv/namespaces` (code 10000). `wrangler tail` needs Workers Tail Read, which the deploy token does not have: tail runs from the owner's shell with the local admin token. | temporary token with the same set, hello Worker deployed, fetched (200) and deleted |
| E2 | The account's workers.dev subdomain is `holy-meadow-4327`. Preview: `https://pr-<n>.holy-meadow-4327.workers.dev`. Production before the custom domain: `https://matter-of-place.holy-meadow-4327.workers.dev`. Renaming is a dashboard action (GOTCHAS P-035). | `GET /accounts/:id/workers/subdomain` |
| E3 | Server CPU on the free plan, current build (1,275 KiB upload, startup 2 ms), five requests per route, milliseconds: `/` 6 14 17 34 52 · `/properties` 10 10 13 20 24 · `/california` 6 10 12 13 · `/markets` 3 to 7 · `/stories` 4 to 7 · `/exposure` 2 to 15 · `/contact` 2 to 7 · `/submit` 4 to 5 · `/sitemap.xml` 0 to 1. Every outcome was `ok` (no error 1102) across 36 requests, but the home page and the collection are above the documented 10 ms. The risk stays open: B1b step 7 measures again on the real Worker and H1 decides (edge-cache HTML first, Workers Paid second). | `wrangler tail --format json` on a throwaway Worker, since deleted |
| E4 | `pg_dump --format=custom --schema=public --schema=auth` works through the session pooler: host `aws-0-us-east-1.pooler.supabase.com`, port 5432, user `postgres.<project-ref>`, exit 0, 70 table entries. Client 18.4 against server 17.11. | run from the laptop against `mop-dev` |
| E5 | Edge Functions deploy without Docker using `supabase functions deploy <name> --use-api`. `npm:pdf-lib@1.17.1`, `npm:cron-parser@5` (`CronExpressionParser`), `npm:@react-email/render@1` and `npm:react@19` import and run. Runtime: supabase-edge-runtime 1.77.0 (Deno 2.1.4 compatible). | throwaway function deployed, called (200) and deleted |
| E6 | `supabase gen types typescript --project-id <ref> --schema public` works without Docker. `supabase db push` and `supabase config push` talk to the cloud project directly. | run against `mop-dev` |
| E7 | **No Docker on the operator's machine (S50, GOTCHAS P-038).** `supabase start`, `supabase db reset`, `supabase db diff` and the local stack are not available. The development database is the cloud project `mop-dev`. A native PostgreSQL 18.4 (scoop: `initdb`, `pg_ctl`, `psql`, `pg_dump`) exists for throwaway clusters; it has no pg_cron, pgmq or pg_net. GitHub's hosted runners are not the operator's machine. | operator instruction; `command -v pg_ctl` |
| E8 | **R2 is off until the operator turns it on (S50).** No bucket exists. Any step that creates or writes a bucket is BLOCKED on that switch and must not fail the steps around it. `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` in GitHub are derived from the deploy token and are UNPROVEN. | `GET /accounts/:id/r2/buckets` answers "Please enable R2 through the Cloudflare Dashboard" |
| E9 | Accounts that exist: Cloudflare (zone active, Free), Supabase organisation with `mop-dev` (ref `hbokkmpgpqhrnemgsqra`, us-east-1, Postgres 17.11, sign-ups closed), Sentry (org `matter-of-place`, project `javascript-tanstackstart-react`, errors only), GitHub (private, Actions enabled, no branch protection and no Environments on this plan), Zoho Mail, Turnstile widget "matterofplace.com forms". Accounts that do not exist yet: Resend, X developer app, LinkedIn company page and app, Meta (through the partner), Google (GA4, Search Console, Tag Manager), Bing Webmaster, an Anthropic API key, the Omnikom endpoint, `mop-prod` (created at launch). Deferred owner inputs: legal entity and address, invoice payment methods, Instagram handle. | completion map rows A1 to A11 |
| E10 | GitHub Actions secrets present: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `SUPABASE_ACCESS_TOKEN`, `DEV_SUPABASE_PROJECT_REF`, `DEV_SUPABASE_DB_PASSWORD`, `PREVIEW_WORKER_SECRETS_JSON` (keys: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET` test value, `SENTRY_DSN`, `RATE_LIMIT_SALT`, `SENTRY_TEST_TOKEN`). Variables: `VITE_SITE_URL`, `VITE_TURNSTILE_SITE_KEY` (the real key, for main). The same values, plus the admin token `mop-admin`, the production Turnstile secret and the dev service role key, are in the git-ignored `E:\Matter Of Place\.env`. Load them without printing: `set -a; . <(tr -d '\r' < "/e/Matter Of Place/.env" \| grep -E '^[A-Z0-9_]+='); set +a`. | `gh secret list`, `gh variable list` |
| E11 | Toolchain on the laptop: node 24.13.0, bun 1.3.13, git 2.55, gh 2.92, Supabase CLI 2.98.2, psql and pg_dump 18.4, ffmpeg 8.1, python 3.14, openssl 3.5.7, wrangler 4.145.0 through `bunx wrangler` (not yet a devDependency). Not installed: aws CLI, age. The `engines.node` pin follows the local major, so it is `24.x`. | `--version` of each |
| E12 | The Sentry DSN accepts a hand-built envelope: `POST https://<host>/api/<project>/envelope/` returned 200 and the event appeared in the issue feed. | curl from the laptop |
| E13 | Lovable is disconnected (no webhook, no deploy key, favicon replaced). The app's `docs/**` remains a sketch to read for intent only. | `gh api repos/.../hooks` → `[]` |

## F. Cross-slice rulings from the readiness pass (CTO, 2026-10-01; plans follow these)
| # | Ruling | Plans that carry it |
|---|---|---|
| F1 | `src/domain/contracts.ts` exists today. No plan creates it: B2 changes it first, B3 extends it, both list it under Change. | B2, B3 |
| F2 | The interest view is `market_interest_counts`, created by B3b. B7 reads it and creates no `market_interest` view. | B3b, B7 |
| F3 | B3b proves that a market opens with a direct database test (`update markets set coming_soon = false`, then the public payload shows it open). The proof through the `bump_catalog_version` recipe step belongs to B8b. B3b does not depend on B8b. | B3b, B8b |
| F4 | `user_roles` is unique on `(user_id, role)` everywhere (A1). | B2 |
| F5 | Depends lines gain: B6 on B4; B11 on B5; B12 on B8 and B9; B14 on B8; B13 lands after B4; L1 on B7 and B9 to B12. | B6, B11, B12, B13, B14, L1 |
| F6 | `DEV_DB_URL` is the session pooler URL of `mop-dev` (`postgresql://postgres.<ref>:<password>@aws-0-us-east-1.pooler.supabase.com:5432/postgres`, password percent-encoded). It is in the local `.env`; B2 names it in `.env.example`; CI builds it from `DEV_SUPABASE_PROJECT_REF` and `DEV_SUPABASE_DB_PASSWORD`. Every plan that writes `$DEV_DB_URL` means this. | B2, B14, B16, H1, L1 |
| F7 | One dry-run flag for every social channel: `SOCIAL_DRY_RUN`. `META_DRY_RUN` is retired. | B10 |
| F8 | The subscriber confirm link redirects to `/stories?confirmed=` in B3. B5 moves the route and its tests to `/place-notes?confirmed=1|0`. | B3, B5 |
| F9 | B2 defines and exports `currentRightsVersion` in `contracts.ts`. B16 later makes it read `legalVersions.terms` from `src/config/site.ts`; importers keep the same exported name. | B2, B3, B16 |
| F10 | `cspFor(env, flags)` takes the flags argument from B1b on and ships `Content-Security-Policy-Report-Only`; B17 removes the Google Fonts hosts from its table and adds the test; H1 flips to enforcing through `flags.csp_enforce`. HSTS is `max-age=31536000; includeSubDomains` from launch; on preload day 30 L1 raises it to `max-age=63072000; includeSubDomains; preload`. | B1b, B17, H1, L1 |
| F11 | `readConsent()` in `src/lib/consent.ts` is created by B3b only and is the single reader; B13 imports it; B17 keeps the cookie form and the client record readable through it. B3b's flag tests use `toMatchObject` so later slices can add keys (`csp_enforce`, `maintenance`). B13 treats `archive_pages` as an off switch on top of its threshold. B17 items on robots, sitemap, llms and structured data are tests against B13's output, not new files. | B3b, B13, B17 |
| F12 | `deploy.yml` passes the whole `PREVIEW_WORKER_SECRETS_JSON` object to `wrangler secret bulk`, so a later slice adds a preview secret by adding a key to that GitHub secret (the orchestrator updates it from `.env`), never by editing the workflow: `RESEND_WEBHOOK_SECRET` (B3), `PREVIEW_TOKEN_SECRET` (B7), `RENDER_CALLBACK_SECRET` and `JOB_RUNNER_SECRET` (B8). The GitHub variable `VITE_API_BASE_URL` (`/api/public`) and the secret `DEV_SUPABASE_SERVICE_ROLE_KEY` exist as of today. | B1b, B3, B4, B7, B8 |
| F13 | Keep-warm: B8b owns the Worker `scheduled()` handler and the cron trigger line in `wrangler.toml`; B1b leaves a marker comment for it. | B1b, B8b, H1 |
| F14 | `usage.mjs` (B14) accepts `--env dev|prod`. The health drill script is H1's; B14 proves its check with a unit test and leaves the drill to H1. | B14, H1 |
| F15 | `settings.coming_soon_global` stays `false` by default: the fail-safe is `markets.coming_soon` defaulting to `true`. L1 verifies the state on `mop-prod`, it does not need a second migration. | B2, B3b, L1 |
| F16 | `bun run db:reset` (B2) empties `public`, drops the pgmq queues and unschedules the cron jobs that migrations created, then pushes; migrations are written to re-apply. `submission_transition_allowed` permits `Invoice Issued` to `Invoice Issued` (reissue after void, B6). | B2, B6, B8 |
| F17 | Shared names are frozen and owned: B2 `db:push`, `db:reset`, `db:psql`, `db:lint`, `gen:types`, `seed` (`--target dev|prod`, no `local`; `prod` is BLOCKED until launch and runs only as `--target prod --mode reference --confirm-production`); B4 `playwright.config.ts`, the e2e projects, the CI `db` and `e2e` jobs and `test:e2e:coming-soon` (a `coming_soon_global` toggle); the database test harness itself is F22; B8 `render.yml`, `render-job.mjs`, `post-callback.mjs`, `src/server/lib/hmac.ts`, `src/server/jobs/system/health.ts`; B9 `scripts/lib/png-size.mjs`, `scripts/lib/r2.mjs`; B12 the `findChrome()` `CHROME_PATH` change (B9 keeps a fallback); B13 `scripts/check-seo.ts`, `lhci`; B14 `usage.mjs`, `limits.json`. `public/fonts/*.woff2` are created by whichever of B9 and B17 lands first and reused under the same names by the other. | all |
| F18 | R2 is one switch held by the operator. B3 creates `src/server/lib/r2.ts`, tolerant of missing `R2_*` secrets, with one shared `r2_unavailable` error that B7 and B8 reuse. B10 gates real posts on R2. | B3, B6, B7, B8, B10 |
| F19 | No new operator token for Cloudflare zone work: `scripts/cf-edge.mjs` reads `CF_EDGE_TOKEN` and falls back to `CLOUDFLARE_API_TOKEN` from the local `.env` (the admin token `mop-admin`). The cache purge secret for B8b is a narrow token the orchestrator mints with `mop-admin` (Cache Purge on the one zone). B1b step 11 is BLOCKED on L1's domain attach only. `GITHUB_DISPATCH_TOKEN` (B8) is a fine-grained GitHub token and stays an operator step. | B1b, B8, B8b, L1 |
| F20 | `supabase config push` has no `--dry-run` in CLI 2.98.2. Proof that sign-ups are closed is a read-back: `GET https://api.supabase.com/v1/projects/<ref>/config/auth` with the access token shows `"disable_signup": true`. `supabase db lint --linked` and `supabase db push --dry-run` exist. | B2 |
| F21 | Wave order inside shared files: B3, B3b, B5, B16 for `src/lib/strings.ts`, `src/routes/__root.tsx` and `src/services/types.ts`. Database tests of slices that run side by side share one concurrency group on `mop-dev`. | B3, B3b, B5, B16 |
| F22 | The database test harness has frozen names and B2 creates it, because B2's own tests are its first users: `tests/fixtures/db.ts` exports `withRollback(fn)` (one `pg` connection to `DEV_DB_URL`: begin, run, roll back), `committed(fn, cleanup)` (for the few tests that need committed rows across connections; cleanup is mandatory), `createAuthUser()`, `createStaffUser()` and `asRole()`; `tests/db/global-setup.ts`; the `db` vitest project in `vitest.config.ts` and the `test:db` script; `pg` as a devDependency. B4 extends these (factories, the CI `db` job) and does not recreate them. Committed mode is allowed for: tests that go through HTTP (`tests/api` of any slice, today B3 and B3b: committed rows with teardown), B6's parallel invoice-number test, B8's claim, queue and cron tests. Everything else rolls back. `MOP_DB_URL` and `MOP_TEST_DB_URL` are retired: the one name is `DEV_DB_URL`. | B2, B3, B4, B6, B8 |
| F23 | `workspace/03-diagrams/plans-b.md` diagram 1 shows the `Invoice Issued` to `Invoice Issued` self-transition (reissue after void, F16). | diagrams |
