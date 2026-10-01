# Tech stack — APPROVED 2026-09-30 (CEO sign-off in session)

This file is the spec we build from. It supersedes `Matter Of Place Codebase/docs/**`, which is the Lovable MVP sketch:
read those docs for intent, never build from them (GOTCHAS G-010). Rule: free tier first; pay only when a measured
limit is hit; fewest accounts possible; nothing deterministic goes through a model.

## 1. The stack, one line per layer

| Layer | Choice | Free until | Why this and not the docs' choice |
|---|---|---|---|
| Site | React 19 + TanStack Start SSR, plain CSS tokens, plain Vite config (Lovable preset removed) | n/a | keep the built frontend; the preset is lock-in and hides the config |
| Hosting | Cloudflare Workers + Static Assets, one zone `matterofplace.com` | 100k requests/day | edge cache, Turnstile, rate limits, R2, cron on one free account |
| API | server routes in the same Worker under `/api/*`; request IDs, structured logs, idempotency keys on webhooks | same | one deploy; docs left out idempotency and logging |
| Database | Supabase Postgres, versioned migrations via Supabase CLI, TypeScript types generated from the schema, Zod for input only | 500 MB, pauses after 7 idle days (keep-warm cron) | docs had one `schema.sql` and hand-synced field names |
| Permissions | RLS per role: `chief_editor`, `managing_editor` may accept/decline/publish; `visual_editor` edits media; `media_ops` approves assets; `commercial` reads only | n/a | docs gave every editor everything |
| Editor auth | Supabase Auth magic links; roles in `user_roles` | 50k MAU | |
| Photography | R2 originals; variants (thumb, card, hero, og, carousel) generated once at publish by a script; served from R2 with immutable cache headers. R2 is designed in and switched off until the operator enables it (S50); no bucket exists yet | 10 GB, zero egress | docs resized on every request (paid past 5k/month) |
| Submission uploads | private Supabase Storage bucket, signed PUT, 25 MB, images only, virus-scan-free but MIME-sniffed server side | 1 GB | |
| Jobs | `jobs` table + Supabase Queues (pgmq) + pg_cron for light work; GitHub Actions (`repository_dispatch`) for heavy renders (images, PNG covers, ffmpeg reels) | 2,000 Actions minutes/month | docs wanted Cloudflare Queues ($5/mo) and Browser Rendering (paid) |
| Cache | Rendered HTML and catalog JSON in the Worker's Cache API (`caches.default`) under a key of release and `catalog_version`; an isolate-memory snapshot of the catalog per version; one state RPC (`getPublicState`, checked every 15 seconds) and one snapshot RPC (`getCatalog`, once per version) are the only public database reads; the last good copy is served when the database is down; TanStack Query 5 min in the browser; no KV (architecture §13, S52) | free | docs queried per request, no Worker KV needed |
| Email | Resend: transactional (React Email) + Audiences/Broadcasts for Place Notes; double opt-in; SPF/DKIM/DMARC on our domain | 3,000/month, 100/day | |
| Payments | **Manual at launch** (S32): templated invoice from `/admin`, preferred payment method recorded, admin marks paid and activates the agent. Same state machine later accepts Stripe (links + signed idempotent webhooks) without changing the flow | $0 | the first clients are closed by phone; Stripe is a later slice |
| Launch mode | **Coming soon** (S30): no listings on production until real ones are accepted; every collection has an empty state with a per-market interest signup; illustrative content is dev/preview only; `settings.coming_soon_global` defaults to `false` and `markets.coming_soon` to `true` (the fail-safe); interest counts come from the view `market_interest_counts`; consent is read only through `readConsent()` in `src/lib/consent.ts` | n/a | honesty with viewers; build the interest list first |
| Social | Launch channels (S48): Instagram (Meta Graph API), X (X API), LinkedIn company page (LinkedIn API). One adapter per channel behind the same `{ publish, metrics }` interface. Facebook and YouTube adapters exist as disabled blocks (`channel_settings.enabled = false`), switched on later without new architecture | free tiers; X and LinkedIn limits UNPROVEN until the apps are approved | no scheduler subscription |
| Video | Campaign tier only (S24): the GSAP + Three.js scene `launch/reel/scene.html` captured frame by frame in headless Chrome and encoded with ffmpeg by `scripts/render-reel.mjs` in `render.yml`'s `reel` job (B12, S37); synthesized sound only, no music (S36); gated by `launch/tools/motion-gate.mjs`; poster + MP4 to R2 (BLOCKED while R2 is off, E8) | free | |
| Bots / abuse | Turnstile on all forms; one Cloudflare rate-limit rule; per-endpoint sliding window in the API (KV-free, DB-backed); headers from `cspFor(env, flags)` (CSP report-only from B1b, enforced through `flags.csp_enforce`: H1 switches it on `mop-dev`, and on `mop-prod` an admin switches it in Settings at L1 step 8 after seven days with no `csp_report` row, G32; HSTS `max-age=31536000` until preload day 30, then `63072000` with `preload`) | free | |
| Errors / logs | Sentry free tier on the Worker and on the job-runner Edge Function (`SENTRY_DSN` in both); Workers Logs; a daily `health` system job (B8: pg_cron row `health` at 13:00 UTC enqueues it, `src/server/jobs/system/health.ts` runs the checks, writes `jobs.result`, emits `health.failed` once when a check fails, and B8b's seeded recipe for that event emails the admin through `notify_admin`; proof `bunx vitest run tests/unit/jobs/health.test.ts`). The weekly audit robot (B14) reads health, it does not ping | 5k errors/month | |
| Analytics | GA4 via the typed `dataLayer` (gtag.js after consent, G31), Search Console, Bing, Cloudflare zone HTTP analytics (read through the API, no Web Analytics beacon script, G31), first-party `analytics_events` | free | |
| Admin | `/admin` route group inside the site from day one: request queue, decide with templated emails, invoice, dossier editor, media, publish, asset approvals, channel status, subscriber and interest lists, **Automation section** (recipes, templates, reasons, channel and schedule settings, dry-run) | free | docs deferred to Studio; Studio has no publish button |
| Tests | Vitest (contracts, forms, state machine), Playwright (every route, desktop + phone, a11y), run on every PR | free | docs had none |
| Delivery | private GitHub repo `AbdulrahmanAmer/matter-of-place`; Actions: check → test → build → `wrangler deploy` on main; preview Worker per PR; `main` is guarded by a CI rule, not branch protection (P-028), and human merge review is the production gate (GitHub Environments are not available on this plan) | free | |
| Domain | `matterofplace.com` registered at Namecheap (S29, S47; the registrar stays Namecheap, L1), DNS on Cloudflare (zone active, Free, E9) | ~$10/yr | |
| Audit robot | `mop-auditor` (B14) on the `audit` schedule row; reads PSI, Search Console, GA4, Cloudflare zone analytics, Sentry stats (optional, G11), the uptime monitor, Bing (optional) and our `/api/admin/audit.*` actions with its agent key; it holds no Meta, Resend, service role or deploy credential (B14 invariant 3); writes `workspace/audits/`; opens PRs | Claude usage only | |
| AI usage | Sonnet designs templates once; Haiku writes captions and alt text; concierge and search rule-based at launch | small | |

Cost at launch: $0/month plus the domain. Paid steps, in order of likelihood: Resend $20 (list > 3,000 sends), Supabase Pro $25
(> 500 MB or no-pause), Cloudflare Workers Paid $5 (> 100k requests/day).

## 2. Architecture in words

- **One repo, one Worker.** `src/routes/*` are pages; `src/routes/api/*` are server routes; `src/server/*` holds handlers,
  the Supabase service-role client, rate limiting, logging and the job enqueuer. Nothing in `src/server` is imported by the browser.
- **Database is the source of truth for shapes.** `supabase/migrations/*.sql` → `supabase gen types` → `src/db/types.ts`.
  `src/domain/*` becomes thin aliases over generated types. Zod schemas validate input at the edge and nowhere else.
- **Publish is a state machine, not a button.** `submissions.state` and `properties.editorial_state` change only through
  functions that check the caller's role and record who did it. The database trigger refuses commercial states before acceptance.
- **Every side effect is a job.** Publish, accept, decline, payment received, subscriber confirmed → a row in `jobs`
  (type, payload, idempotency key, attempts, run_after). Light jobs run in an Edge Function on pg_cron; heavy jobs are
  dispatched to a GitHub Actions workflow that writes results back through a signed endpoint.
- **Generated assets wait for a human.** The output of the asset steps (cover, carousel, story, reel, newsletter block,
  standalone email) lands in `assets` with `status = pending`; media ops approves in `/admin`;
  approval enqueues the publish-to-channel job. Nothing posts on its own until the operator relaxes this per tier.
  `render_variants` creates no `assets` row: photo variants are stored on `property_media` and need no approval (G61).
- **Money is a box with two doors.** `payments` holds one record per accepted submission: method (`invoice_manual` now,
  `stripe` later), amount, invoice number, status (`due`, `paid`, `waived`), who marked it paid and when. Acceptance
  never depends on it; activation (Scheduled) does. Swapping in Stripe means adding a webhook that writes the same row.
- **The site is honest about emptiness.** Every collection reads `published` rows only; when a market has none it renders
  the coming-soon block: what Matter of Place is, that no property is listed in this market yet, and a one-field signup
  with the market pre-selected (`subscribers.markets[]`). Illustrative data is seeded only into dev and preview.
- **Legal identity is Omnikom's.** `siteConfig.legal` carries the Omnikom entity and address; footer, legal, terms and
  privacy read from it. "Matter of Place is a product of Omnikom" replaces "An Omnikom company" where the lawyer prefers.
- **Automations are data the admins own (S34).** `automation_recipes` holds one recipe per trigger, an event of the
  architecture's catalog (section 3.6; for example `submission.received`, `submission.declined`, `submission.accepted`,
  `invoice.issued`, `payment.marked`, `property.published`, `asset.approved`, `digest.due`, `inquiry.received`,
  `health.failed`). A recipe is an ordered list of steps; each step names a job type from the fixed catalog of
  seventeen in code (architecture section 5: `send_email`, `render_variants`, `render_cover`, `render_carousel`,
  `render_story`, `render_reel`, `write_captions`, `build_newsletter_block`, `post_meta`, `post_x`, `post_linkedin`,
  `queue_digest`, `notify_admin`, `webhook_omnikom`, `bump_catalog_version`, `purge_cache`, `render_og_static`) with
  parameters, `enabled`, `requires_approval` and optional conditions (tier, market). `email_templates`,
  `decline_reasons`, `channel_settings` (on/off, posting window, approval mode per tier) and `schedule_settings`
  (digest every 14 days, audit Saturday) are tables too. Every table is Zod-validated on save, versioned
  (`automation_revisions`), and shown in `/admin › Automation` with a dry-run button that lists what a trigger would do.
  The job runner reads the recipe at trigger time, so a change takes effect on the next event, no deploy.
  New step types are code (a PR), never admin input: that is what keeps this from becoming a workflow engine.
- **The admin portal is one place for the whole day.** Queue → review → decide → invoice → dossier → publish →
  approve assets → watch channels → adjust automations. Every action is one click with a confirmation, every email is
  a template with a preview, every failure shows up as a red row with a retry button.
- **Observability is a requirement, not a phase.** Request ID on every log line, Sentry on every unhandled error,
  job failures visible in `/admin`, a daily health job that fails loudly.

## 3. Repo layout target

```
Matter Of Place Codebase/
  src/routes/            pages + api/ server routes
  src/server/            handlers; lib/ (db client, log, rate-limit, env, r2, the job enqueuer); jobs/ (steps/ and system/); email/ (B5); payments/ with adapters/ (manual.ts and stripe.ts, B6); channels/ (meta.ts, x.ts, linkedin.ts, youtube.ts by B10, resend.ts by B11)
  src/db/                generated types, query helpers
  src/domain/            aliases + Zod input schemas
  src/admin/             admin components (behind auth)
  src/templates/         social/ (cover, carousel, story, newsletter block and the static OG card `OgCard.tsx`, all B9; there is no og/ folder) and email/ (React Email, B5, later slices append), consumed by the render jobs and the mail sender
  supabase/migrations/   versioned SQL (source of truth)
  supabase/functions/    job-runner/ only (B8): runs every light step, digest assembly included (`queue_digest`, B11), and dispatches the heavy ones; no other function exists (keep-warm is the Worker's scheduled() handler, owned by B8b)
  scripts/               seed.ts and variants.ts (B2); render-job.mjs and post-callback.mjs (B8); render-variants, render-cover, render-carousel, render-story and render-og-static .mjs (B9) and render-reel.mjs (B12), all run by render.yml; harden/ (H1); launch/ (L1). App folder; posting runs in job-runner steps, not scripts (G21); the film engine stays in repo-root launch/ and the audit robot's scripts/audit/ sits at the repository root (B14)
  tests/                 vitest + playwright
  wrangler.toml
E:\Matter Of Place\.github\workflows\   ci.yml, deploy.yml, render.yml, backup.yml, audit-scope.yml, audit-deps.yml (audit-collect.yml only as B14's fallback) — at the REPO root, not under the app (GitHub only reads it there; GOTCHAS G-012)
E:\Matter Of Place\.github\dependabot.yml   B1b, repo root as well
```

Workflow owners: `ci.yml`, `deploy.yml`, `backup.yml` and `dependabot.yml` are B1b's (later slices add jobs or steps as their plans say); `render.yml` is B8's (B9 and B12 add to it); `audit-scope.yml` is B14's; `audit-deps.yml` is H1's; `audit-collect.yml` exists only if B14 step 8 records the routine's network egress as BLOCKED (B14 step 9). Proof once the owning slices land: `ls "E:/Matter Of Place/.github/workflows"` lists those files and `git ls-files "Matter Of Place Codebase/.github"` prints nothing.

CI and fonts. Jobs set `working-directory: Matter Of Place Codebase`. No job needs Docker (S50). The `db` job runs tests
against `mop-dev` with secrets from `PREVIEW_WORKER_SECRETS_JSON` and one shared concurrency group; tests roll back.
Font files (`public/fonts/*.woff2`) belong to one slice: whichever of B9 and B17 runs first creates them and the other reuses them.

## 4. Environments and secrets

| Env | URL | DB | Deploy |
|---|---|---|---|
| local | localhost:8080 | `mop-dev` (cloud dev project) plus native PostgreSQL 18 for throwaway tests; no Docker, no local Supabase stack (S50, E7) | `bun run dev` |
| preview | `pr-<n>.holy-meadow-4327.workers.dev` | `mop-dev` | Actions on PR |
| dev (stable) | `matter-of-place-dev.holy-meadow-4327.workers.dev` | `mop-dev` | Actions on every push to `main` (`deploy.yml`, B1b, G19), with the preview secret bundle and `MOP_ENV=preview`; it is the callback target of heavy jobs on `mop-dev` (`RENDER_CALLBACK_URL`) and the `SITE_URL` of `mop-dev`'s job runner (B5) |
| production | matterofplace.com (before the domain is attached: `matter-of-place.holy-meadow-4327.workers.dev`) | `mop-prod`, created at launch; until then the Worker holds the `mop-dev` pair and L1 swaps it (G19) | Actions on merge to main, after human merge review |

Every `.workers.dev` host answers `X-Robots-Tag: noindex` whatever `MOP_ENV` says (`isIndexableHost(host, MOP_ENV)` in `src/server/seo/robots.ts`, B1b creates, B13 extends, G19).

R2 media is off in every environment until the operator enables R2 (S50); steps that need a bucket are blocked, not failed.

Worker secrets (`wrangler secret`, never in the repo): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET`,
`SENTRY_DSN`, `SENTRY_TEST_TOKEN` (B1b's `POST /api/hooks/sentry-test`; set on preview always, on production only while a test runs,
the route answers 404 when it is unset), `RENDER_CALLBACK_SECRET`, `JOB_RUNNER_SECRET`, `RATE_LIMIT_SALT`, `CONFIRM_TOKEN_SECRET`
(B5; the Worker seals the subscriber confirm token at signup and the job runner opens it, so the same value is also a Supabase
function secret; read through B3's `src/server/lib/env.ts`, G12), `PREVIEW_TOKEN_SECRET`,
`RESEND_WEBHOOK_SECRET` (Svix, B3), and later `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. `RESEND_API_KEY` is not a Worker secret: the
Worker never calls Resend (B5 invariant 10, B11), every send runs in the job runner. No Meta, X or LinkedIn
secret is a Worker secret: every platform call runs in a job-runner step or the reconcile job (B10 invariant 1), so those names
live only in Supabase function secrets (G21); none is a GitHub Actions secret and none is set with `wrangler secret put`. R2 access
is tolerant of missing `R2_*` secrets and fails with the one shared `r2_unavailable` error (B3 creates `src/server/lib/r2.ts`).

Supabase function secrets (`supabase secrets set`): `RESEND_API_KEY`, `RESEND_FROM`, `CONFIRM_TOKEN_SECRET` (the Worker's value, B5),
`ADMIN_NOTIFY_EMAIL`, `SITE_URL` (B5: the https origin `confirm_url` and `link_url` are built on; on `mop-dev` the stable dev Worker's URL,
on `mop-prod` `https://matterofplace.com`, set by L1), `EMAIL_DRY_RUN` (B5: `1` on `mop-dev` until the Resend account exists, G14; rows are
`skipped` with a `dry_` id),
`JOB_RUNNER_SECRET`, `GITHUB_DISPATCH_TOKEN` (a fine-grained GitHub token; an operator step; never a Worker secret, G33), `GITHUB_REPO`, `SOCIAL_DRY_RUN` (the single dry-run flag for every social channel; `META_DRY_RUN` is retired), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
(R2 off, S50), `MEDIA_BASE_URL` (the same public media base as the Worker var; `mediaUrl(key)` in the steps prefixes it and Meta
fetches what it builds, so `post_meta`, `post_x`, `post_linkedin` and the render dispatch need it in the function too; while it is unset
those steps return `retry_at` with reason `r2_unavailable`, B10 invariant 5), `MOP_ENV`, `SENTRY_DSN`, `RENDER_CALLBACK_URL` (B8),
`CF_PURGE_TOKEN`, `CF_ZONE_ID` (B8b, `purge_cache`), `INDEXNOW_KEY` (B13, optional: read by `purge_cache` only when `params.indexnow`
is true; unset means the ping is skipped and logged `indexnow_skipped`), `META_*`, `X_*`, `LINKEDIN_*`, `OMNIKOM_WEBHOOK_URL`, `OMNIKOM_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`.
There is no `R2_BUCKET` in a file, a secret, a variable, a workflow env or on a command line (G3, G52): the bucket always follows `MOP_ENV`
(`production` gives `mop-media`, anything else `mop-media-dev`), in a function through B3's `src/server/lib/r2.ts` and in scripts through
B9's `scripts/lib/r2.mjs`; `render.yml` sets only `MOP_ENV` from `client_payload.env`. `MEDIA_BASE_URL` is that bucket's public base; it is
set with `bunx supabase secrets set MEDIA_BASE_URL=... --project-ref <ref>` (with the three `R2_*` names) in the step that switches R2 on,
BLOCKED until the operator enables R2 and the bucket exists (E8). Proof: `bunx supabase secrets list --project-ref $DEV_SUPABASE_PROJECT_REF`
lists the names (values are never printed).

GitHub Actions (measured 2026-10-01, E10). Secrets present: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY` (UNPROVEN while R2 is off), `SUPABASE_ACCESS_TOKEN`, `DEV_SUPABASE_PROJECT_REF`, `DEV_SUPABASE_DB_PASSWORD`,
`PREVIEW_WORKER_SECRETS_JSON` (a bundle: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET`, `SENTRY_DSN`,
`RATE_LIMIT_SALT`, `SENTRY_TEST_TOKEN`). `deploy.yml` passes the whole bundle to `wrangler secret bulk`, so a later slice adds a preview
secret by adding a key to that GitHub secret (the orchestrator updates it from `.env`), never by editing the workflow:
`RESEND_WEBHOOK_SECRET` (B3), `CONFIRM_TOKEN_SECRET` (B5), `PREVIEW_TOKEN_SECRET` (B7), `RENDER_CALLBACK_SECRET` and `JOB_RUNNER_SECRET` (B8). The secret
`DEV_SUPABASE_SERVICE_ROLE_KEY` exists as well, for jobs that need the dev key outside the bundle. Added by later slices:
`RENDER_CALLBACK_SECRET` as a GitHub secret of its own (B8 step 7, `gh secret set`; the same value as the Worker secret, read by
`render.yml`'s `post-callback.mjs`); `BACKUP_PASSPHRASE` (B1b, `backup.yml`); `PROD_SUPABASE_PROJECT_REF`, `PROD_SUPABASE_DB_PASSWORD` and
`PROD_SUPABASE_DB_URL` (the session pooler string), set with `gh secret set` in L1 step 1 once `mop-prod` exists (until then the
production job's `supabase db push` and B3b's coming-soon assertion are skipped). Variables: `VITE_SITE_URL`, `VITE_TURNSTILE_SITE_KEY`, `VITE_API_BASE_URL` (`/api/public`);
to add when R2 is on: `DEV_MEDIA_BASE_URL` and `PROD_MEDIA_BASE_URL` (the public base of each bucket; `PROD_MEDIA_BASE_URL` is `https://media.matterofplace.com`, set by L1, G47); to add when the GA4 property exists
(E9): `VITE_GA4_MEASUREMENT_ID` (B13; public, G-006; passed by `deploy.yml` to the production build only, so previews never load GA4);
to add at launch: `MOP_LAUNCHED` (`true` makes B3b's production step run `assert-coming-soon.mjs --after-launch`; absent means coming-soon
mode is asserted; set by L1 step 4e at the domain cut-over with `gh variable set MOP_LAUNCHED --body true`, G47). Plain Worker vars `MOP_ENV`, `MEDIA_BASE_URL` and
`SENTRY_RELEASE` (set per deploy with `--var`, B1b) are not secrets; the production deploy passes `--var MEDIA_BASE_URL:${{ vars.PROD_MEDIA_BASE_URL }}`
from the start, empty until the variable exists (G47).

Local `.env` only (git-ignored, loaded without printing as E10 describes; never a GitHub or Worker secret): `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` (the owner's `mop-admin`), `CF_EDGE_TOKEN` (optional, `scripts/cf-edge.mjs`), `DEV_SUPABASE_PROJECT_REF`,
`DEV_SUPABASE_DB_PASSWORD`, `DEV_SUPABASE_SERVICE_ROLE_KEY`, `DEV_DB_URL`, `SUPABASE_ACCESS_TOKEN`, `DEV_SUPABASE_POOLER_HOST` and
`DEV_SUPABASE_POOLER_USER` (the session pooler host and the `postgres.<ref>` user that `ready.mjs` checks with `psql`), `SENTRY_DSN`;
at launch (L1 step 1, ASSUMED A11)
`PROD_SUPABASE_PROJECT_REF`, `PROD_SUPABASE_DB_PASSWORD`, `PROD_SUPABASE_SERVICE_ROLE_KEY` (G32; read by B2's `seed.ts` and B3b's
`set-environment.ts`) and `PROD_DB_URL` (the pooler string L1 and H1 pass to `psql` and `--db-url`), then the fresh production values
`PROD_RATE_LIMIT_SALT`, `PROD_CONFIRM_TOKEN_SECRET`, `PROD_PREVIEW_TOKEN_SECRET`, `PROD_JOB_RUNNER_SECRET` (L1 step 1a writes each once,
never reused from `mop-dev`) and `PROD_RESEND_WEBHOOK_SECRET` (L1 step 4e); the production Turnstile pair `PROD_TURNSTILE_SECRET` (the
value of the Worker secret `TURNSTILE_SECRET` on `matter-of-place`, B3, L1 step 1a) and `VITE_TURNSTILE_SITE_KEY_PROD` (the source copy
of the GitHub variable `VITE_TURNSTILE_SITE_KEY`); `PREVIEW_RATE_LIMIT_SALT` and `PREVIEW_SENTRY_TEST_TOKEN` (the source copies of the
bundle keys `RATE_LIMIT_SALT` and `SENTRY_TEST_TOKEN`, read by B3's dev loader; `RATE_LIMIT_SALT` on `matter-of-place` takes
`PREVIEW_RATE_LIMIT_SALT` until L1 step 1a); the source copies of values the
orchestrator pushes elsewhere (`CONFIRM_TOKEN_SECRET`, `JOB_RUNNER_SECRET`, `RENDER_CALLBACK_SECRET`, `PREVIEW_TOKEN_SECRET` (B7 step 2),
`RESEND_WEBHOOK_SECRET` (the `mop-dev` webhook's value, B3), `CF_ANALYTICS_TOKEN`, `BACKUP_PASSPHRASE`, and the function secrets
`RESEND_API_KEY` (B5 step 5), `ANTHROPIC_API_KEY` (B9), `CF_PURGE_TOKEN` and `CF_ZONE_ID` (B8b), `X_ACCESS_TOKEN`, `X_REFRESH_TOKEN`,
`LINKEDIN_ACCESS_TOKEN` and `LINKEDIN_REFRESH_TOKEN` (B10's authorize scripts), each written when its account or token exists);
`ADMIN_SMOKE_KEY` (B7, the dev agent key the seed prints, read by `scripts/admin-smoke.ts`); `OMNIKOM_MOCK_SECRET` (B15, the signing
secret of the local mock receiver); `LEGAL_ENTITY_NAME` (the operator input `ready.mjs --launch` checks before L1 step 1, G32); `SENTRY_AUTH_TOKEN` (`org:read`, `project:read`, `event:read`, G11;
not needed to build, needed for the stored-event checks of H1's `sentry-probe.ts` and of L1, so it gates launch only: `ready.mjs`
lists it as `WAIT` and `ready.mjs --launch` fails while it is missing, G65); `REHEARSAL_AGENT_KEY` (L1's `scripts/rehearsal.ts`, a dev agent key revoked after sign-off). In the
operator's shell only, never in a file: `AUDIT_AGENT_KEY_DEV` (B14, the `mop-auditor-dev` key on `mop-dev`). Proof of the names
(values never printed): `node workspace/05-plans/ready.mjs` prints its `.env names` row as `PASS` with the count of the names it requires.

Audit routine environment (B14; the cloud routine's settings, never the repository, `.env` or GitHub unless B14 step 9 moves them to
Actions secrets of the same names): `AUDIT_AGENT_KEY`, `SITE_URL` (the stable dev Worker before L1, `https://matterofplace.com` after),
`PSI_API_KEY`, `GOOGLE_SA_JSON_B64`, `GA4_PROPERTY_ID`, `CF_ANALYTICS_TOKEN`, `CF_ACCOUNT_ID`, `CF_ZONE_ID`, `UPTIME_API_KEY`, and the
optional `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` (G11) and `BING_WEBMASTER_API_KEY`. No other credential is created for the audit (G11).

Inventory proof (names only, values never printed): `bunx wrangler secret list --name matter-of-place` (with the local `mop-admin`
token) lists the Worker secrets that exist so far, and the same with `--name matter-of-place-dev` once B1b's `deploy.yml` has deployed
the dev Worker (BLOCKED until then); `bunx supabase secrets list --project-ref $DEV_SUPABASE_PROJECT_REF` lists the function secrets;
`gh secret list` and `gh variable list` list the GitHub names. A name a plan uses that is missing from this section is a defect in this
section, not a new secret.

`render.yml` (B8 creates it; B9 and B12 add to it) gets everything per run from `client_payload` and fixed names, never from a
variable that holds one environment: `client_payload.env` picks the target (`development` gives `MOP_ENV=development` and
`MEDIA_BASE_URL=${{ vars.DEV_MEDIA_BASE_URL }}`, `production` gives `MOP_ENV=production` and `MEDIA_BASE_URL=${{ vars.PROD_MEDIA_BASE_URL }}`;
`scripts/lib/r2.mjs` derives the bucket from `MOP_ENV`, G52; any other value fails the run before any script starts), `client_payload.callback_url` is where `post-callback.mjs` reports (so no
callback variable exists in GitHub), and `R2_ACCOUNT_ID` is `CLOUDFLARE_ACCOUNT_ID` with the secret pair `R2_ACCESS_KEY_ID` and
`R2_SECRET_ACCESS_KEY`. `scripts/lib/r2.mjs` (B9) throws `r2_unavailable` when any of these is unset; until R2 is on the render
scripts run only in their `--out` mode (B9) and a step that needs R2 returns `r2_unavailable` and waits (B8). Setting the two variables is `gh variable set DEV_MEDIA_BASE_URL --body <url>`,
BLOCKED until the operator enables R2 and the bucket exists (E8). Proof: `gh variable list` shows both names, and a
`bun run scripts/job-selftest.ts --event property.published --fixture` run on `mop-dev` ends with `gh run watch` green and R2 keys in `assets.files`.

`DEV_DB_URL` is the session pooler URL of `mop-dev` (`postgresql://postgres.<ref>:<password>@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
password percent-encoded). It is in the local `.env` and named in `.env.example` (B2); CI builds it from `DEV_SUPABASE_PROJECT_REF` and
`DEV_SUPABASE_DB_PASSWORD`. Every plan that writes `$DEV_DB_URL` means this.

Deploy token `mop-github-actions` holds exactly Workers Scripts Write, Workers R2 Storage Write and Workers KV Storage Read (E1). It has
no zone permissions, no Cache Purge and no Workers Tail Read: custom-domain attach, zone edge rules, cache purge and `wrangler tail`
run with the owner's `mop-admin` token from his shell, unless the operator widens the deploy token. No new operator token is needed for
zone work: `scripts/cf-edge.mjs` reads `CF_EDGE_TOKEN` and falls back to `CLOUDFLARE_API_TOKEN` from the local `.env` (`mop-admin`). The cache
purge secret for B8b is a narrow token (Cache Purge on the one zone) that the orchestrator mints with `mop-admin`. Sign-ups closed on
`mop-dev` are proved by a read-back, not by `supabase config push --dry-run` (the CLI has none): `GET https://api.supabase.com/v1/projects/<ref>/config/auth`
with the access token shows `"disable_signup": true`.

## 5. Extension paths (S35): how every kind of change is made, so nothing is bolted on

| To add… | Touch, in this order | Proof |
|---|---|---|
| a public page | `src/routes/<name>.tsx` with `head()` via `pageHead()`; a query in `src/lib/queries.ts` if it reads data; `src/styles/pages/<name>.css` imported from `styles.css`; nav in `nav-links.ts` if it belongs there | Playwright route test added; `bun run check` green |
| an API route | public (B3): `src/routes/api/public/<name>.ts` whose handler only calls `handlePublic(request)`, plus one row in `src/server/public/routes.ts` (`path`, `method`, `schema`, `limits`, `turnstile`, `form`, `raw`, `cache`, `service`; `routes-parity.test.ts` fails on a file without a row), its Zod input schema in `src/domain/contracts.ts` (the forms import the same file), the service in `src/server/<feature>/service.ts`; `handlePublic` writes the one log line with the request ID. Admin (B7): `src/routes/api/admin/<name>.ts` calling `requireActor(request, db)` (`src/server/lib/actor.ts`), `verifyCsrf` on writes, then the service in `src/server/<feature>/service.ts`, which calls `authorize(actor, actionId)`; its Zod input schema in `src/domain/admin-<feature>.ts`; the answer through `adminJson` (`src/server/lib/admin-response.ts`), SQL errors through `fromRpcError` (`src/server/lib/admin-errors.ts`) | Vitest for the schema and the service; `bunx vitest run tests/unit/routes-parity.test.ts` for a public route, `tests/unit/authz.matrix.test.ts` for an admin one; Playwright hits the route |
| an admin action (button) | `src/admin/<feature>/` component + server function; permission check by role in the server function, never in the UI; audit row (`who, what, when`) | Vitest: forbidden role gets 403; allowed role changes state |
| a table or column | `supabase/migrations/<ts>_<name>.sql` (up only; a second migration undoes); `supabase gen types` → `src/db/types.ts`; RLS policy in the same migration. `<ts>` (written `<timestamp>` in some plans, same thing) is the UTC creation time `YYYYMMDDHHMMSS` that `bunx supabase migration new <name>` prints, run (no Docker needed) in the step that adds the file, so file order equals landing order; a migration that references another slice's table is created only after that slice's migration is on `mop-dev`. B2's foundation set (12 fixed names from `20261001090000_extensions_enums.sql` to `20261001091100_settings_defaults.sql`) is the one place RLS sits in its own migration (`20261001090900_rls.sql`) | `bun run db:reset` (B2's no-Docker reset of `mop-dev`: empties `public`, drops the pgmq queues, unschedules the cron jobs migrations created, then pushes; P-038) or `supabase db push` clean; `bunx supabase migration list --linked` shows the local and remote columns equal and ascending; generated types compile |
| a job type | the name goes into the architecture's step catalog first (P-031); `src/server/jobs/steps/<name>.ts` exporting `{ type, heavy, paramsSchema, run(ctx, params, payload), onResult? }` (B8 contract: `onResult(ctx, job, result)` for heavy steps only, `run` returns `{ status: "done" }` or `{ status: "retry_at", at, reason }` and never updates `jobs` itself); one import line in `src/server/jobs/steps/index.ts`; the recipe editor's choices come from that catalog and its `paramsSchema`; no deploy step of its own: `deploy.yml` (B8's steps) redeploys `job-runner` with `bunx supabase functions deploy job-runner --use-api` whenever a change touches `supabase/functions` or `src/server` | Vitest runs the step against a fixture; dry-run lists it; `node workspace/05-plans/check-plans.mjs` prints OK (it fails when a catalog step has no code file in any plan, P-043) |
| an email | `src/templates/email/<name>.tsx` (React Email); its key appended to `emailTemplateKeys` in `src/domain/email.ts` and its entry appended to `definitions` in `src/templates/email/index.ts` (G46, G53); its `email_templates` row (subject, preheader, blocks, variables) seeded by the slice's migration with `on conflict (key) do nothing`; preview in `/admin › Automation` | Vitest renders it and B5's seed test finds `select key from email_templates` equal to `emailTemplateKeys` as sets; `bun run scripts/email-test.ts render <key>` writes the HTML today; a test send lands (`bun run scripts/email-test.ts <key> <address>`, BLOCKED until the Resend account, key and verified domain exist) |
| an analytics event | name added to `AnalyticsEvent`; `track()` call at the action; the API's allow-list | TypeScript refuses free strings; event row appears |
| a role or permission | `app_role` enum migration; RLS policies in the same migration (architecture 3.7); the action in `src/server/lib/permissions/<group>.ts` with its import line in `src/server/lib/permissions/index.ts`, checked by `authorize(actor, actionId)` from `src/server/lib/authz.ts` in the server function (B7); its row in the hand-typed fixture of `tests/unit/authz.matrix.test.ts` in the same commit | `bunx vitest run tests/unit/authz.matrix.test.ts` (fails on an action without a fixture row and on a fixture row without an action) |
| a social channel | the channel name into architecture 3.5's `channel_settings` list and its step type `post_<name>` into the architecture step catalog first (P-031); `src/server/channels/<name>.ts` implementing B10's `Channel` interface from `src/server/channels/types.ts` (`{ id, supports(kind), publish(asset, ctx), metrics(post), health() }`; YouTube's disabled block `youtube.ts` is the starting file); its entries in `getChannel`, `targetsFor`, `filesFor` and `captionFor` (`src/server/channels/index.ts`); its spec in `src/server/automation/step-specs.ts` and its mapping in `stepForChannel` (`src/server/automation/catalog.ts`); `src/server/jobs/steps/post-<name>.ts` calling `postToChannel` (`src/server/channels/post-to-channel.ts`) with one import line in `src/server/jobs/steps/index.ts`; its credentials rule in `assertMayEnable` (`src/server/channels/enable-guard.ts`; YouTube answers 422 `no_adapter` until then); the slice's migration widens the `channel_settings.channel` check and inserts the row disabled with `on conflict (channel) do nothing` when the channel is new (YouTube's row is already seeded by B8b), and replaces `unpublish_property` (`create or replace`) so a takedown also cancels `post_<name>` jobs; the step joins the `asset.approved` recipe from `/admin › Automation`; the row is enabled on screen 20 once `assertMayEnable` passes | `bunx vitest run tests/unit/channels/<name>.test.ts tests/unit/channels/post-<name>.test.ts tests/unit/channels/targets.test.ts tests/unit/channels/enable-guard.test.ts tests/unit/automation/catalog.test.ts` with the API mocked; `node workspace/05-plans/check-plans.mjs` → OK; one real test post BLOCKED until the channel's account and credentials exist (operator) |
| an email channel | `src/server/channels/<name>.ts` with `{ publish(asset, settings), metrics }` (B11's `src/server/channels/resend.ts` is the pattern); its `channel_settings` row (`newsletter` is the existing one) | `bunx vitest run tests/unit/channels/<name>.test.ts` with the API mocked |
| a new public read | add it to the snapshot shape in `getCatalog` (or to `getPublicState` if it is a flag or a setting), never a table query per request; the endpoint and the loader read the memoised result | Vitest: the database call counter does not move on a warm request (architecture §13) |

Rules behind the table: feature folders (`src/server/<feature>`, `src/admin/<feature>`) own their code; shared code is
imported from `src/lib` or `src/server/lib`, never copied; no component reads the database; no server function trusts
the client for identity or role; every PR's checklist ticks the path it used. `mop-builder` refuses a slice that has no path.

## 6. Decisions recorded from this approval
See `PROJECT-STATE.md` S7–S20. Remaining questions (Q1–Q12) are listed there and answered in session.
