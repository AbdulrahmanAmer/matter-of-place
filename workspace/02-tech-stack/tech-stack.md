# Tech stack — APPROVED 2026-09-30 (CEO sign-off in session)

This file is the spec we build from. It supersedes `app/docs/**`, which is the Lovable MVP sketch:
read those docs for intent, never build from them (GOTCHAS G-010). Rule: free tier first; pay only when a measured
limit is hit; fewest accounts possible; nothing deterministic goes through a model.

## 1. The stack, one line per layer

| Layer | Choice | Free until | Why this and not the docs' choice |
|---|---|---|---|
| Site | React 19 + TanStack Start SSR, plain CSS tokens, plain Vite config (Lovable preset removed) | n/a | keep the built frontend; the preset is lock-in and hides the config |
| Hosting | Cloudflare Workers + Static Assets, one zone `matterofplace.com` | 100k requests/day | edge cache, Turnstile, rate limits, cron on one free account |
| API | server routes in the same Worker under `/api/*`; request IDs, structured logs, idempotency keys on webhooks | same | one deploy; docs left out idempotency and logging |
| Database | Supabase Postgres, one project for the whole life of the system (`mop-dev`, the build database until L1's launch switch and the production database after it; no second project, S60, ASSUMED H35), versioned migrations via Supabase CLI, TypeScript types generated from the schema, Zod for input only | 500 MB, pauses after 7 idle days (keep-warm cron) | docs had one `schema.sql` and hand-synced field names |
| Permissions | RLS per role: `chief_editor`, `managing_editor` may accept/decline/publish; `visual_editor` edits media; `media_ops` approves assets; `commercial` reads only | n/a | docs gave every editor everything |
| Editor auth | Supabase Auth magic links; roles in `user_roles` | 50k MAU | |
| Photography | Supabase Storage of the one project (S57, ASSUMED H33). The uploaded original stays in the private bucket `submissions` and is deleted once its variants exist; variants (thumb, card, hero, og, carousel) are generated once per photograph when it is attached or replaced (B7's `attach_media` and `replace_media` enqueue `render_variants`, run in Actions by `scripts/render-variants.mjs`) and stored in the public bucket `media`, WebP except where a channel needs JPEG or PNG, at most 2560 px on the long edge; the `property.published` recipe re-runs it only for photographs that still have no sizes; `properties.hero_image` follows the first rendered photograph (G66); keys carry a content hash and every upload sets `cache-control: public, max-age=31536000, immutable`; the public address is `/media/<key>` on our own domain, a Worker resource route (B3) that streams the object and caches it at the edge, never a `supabase.co` address | 1 GB of Storage in total, 5 GB egress a month (cache misses only), one Worker request per image view; about twenty properties, UNPROVEN until the first real one is stored | docs resized on every request (paid past 5k/month); R2 was dropped by the operator and removed from every plan (S57, ASSUMED H33) |
| Submission uploads | private Supabase Storage bucket `submissions` (uploads and staging), signed PUT, 25 MB, images only, virus-scan-free but MIME-sniffed server side | the same 1 GB as Photography | |
| Jobs | `jobs` table + Supabase Queues (pgmq) + pg_cron for light work; GitHub Actions (`workflow_dispatch` of `render.yml`, JOB-01, with `GITHUB_DISPATCH_TOKEN` fine-grained to this repository only, Actions: Read and write plus Metadata: Read, no Contents, no expiration by the operator's word, SEC-02; made by the orchestrator on 2026-10-02, S59, ASSUMED E22) for heavy renders (images, PNG covers, ffmpeg reels) | 2,000 Actions minutes/month | docs wanted Cloudflare Queues ($5/mo) and Browser Rendering (paid) |
| Cache | Rendered HTML and catalog JSON in the Worker's Cache API (`caches.default`) under a key of release and `catalog_version`; an isolate-memory snapshot of the catalog per version; one state RPC (`getPublicState`, checked every 15 seconds) and one snapshot RPC (`getCatalog`, once per version) are the only public database reads; the last good copy is served when the database is down; TanStack Query 5 min in the browser; no KV (architecture §13, S52) | free | docs queried per request, no Worker KV needed |
| Email | Resend: transactional (React Email) + Audiences/Broadcasts for Place Notes; double opt-in; SPF/DKIM/DMARC on our domain | 3,000/month, 100/day | |
| Payments | **Manual at launch** (S32): templated invoice from `/admin`, preferred payment method recorded, admin marks paid and activates the agent. Same state machine later accepts Stripe (links + signed idempotent webhooks) without changing the flow. The operator supplies the legal entity, its address and the payment methods in the last phase (S59) | $0 | the first clients are closed by phone; Stripe is a later slice |
| Launch mode | **Coming soon** (S30): no listings on production until real ones are accepted; every collection has an empty state with a per-market interest signup; illustrative content is dev/preview only; `settings.coming_soon_global` defaults to `false` and `markets.coming_soon` to `true` (the fail-safe); interest counts come from the view `market_interest_counts`; consent is read only through `readConsent()` in `src/lib/consent.ts` | n/a | honesty with viewers; build the interest list first |
| Social | Launch channels (S48): Instagram (Meta Graph API), X (X API), LinkedIn company page (LinkedIn API). One adapter per channel behind the same `{ publish, metrics }` interface. Facebook and YouTube adapters exist as disabled blocks (`channel_settings.enabled = false`), switched on later without new architecture. The operator supplies the X, LinkedIn and Meta apps at the end, when everything else is done (S59); until then every channel row stays disabled and the adapters are proved against recorded fixtures | free tiers; X and LinkedIn limits UNPROVEN until the apps are approved | no scheduler subscription |
| Video | Campaign tier only (S24): the GSAP + Three.js scene `launch/reel/scene.html` captured frame by frame in headless Chrome and encoded with ffmpeg by `scripts/render-reel.mjs` in `render.yml`'s `reel` job (B12, S37); synthesized sound only, no music (S36); gated by `launch/tools/motion-gate.mjs`; one MP4 of at most 12 MB and one poster in the bucket `media`, served at `/media/<key>` (H33 (8)) | free | |
| Bots / abuse | Turnstile on all forms; one Cloudflare rate-limit rule, on `/api/public/*` and `/api/admin/auth/*` (B1b's `scripts/cf-edge.mjs`, API-04); per-endpoint sliding window in the API (KV-free, DB-backed); headers from `cspFor(env, flags)` (CSP report-only from B1b, enforced through `flags.csp_enforce`: H1 switches it on before the launch switch, and after the switch (whose reset clears it, H35 (4)) an admin switches it in Settings at L1 step 8 after seven days with no `csp_report` row, G32; HSTS `max-age=31536000` until preload day 30, then `63072000` with `preload`) | free | |
| Errors / logs | Sentry free tier (org `matter-of-place`, created by the operator and the orchestrator on 2026-10-01 and signed in on the laptop; the orchestrator makes the user token `SENTRY_AUTH_TOKEN`, S59, S60) on the Worker and on the job-runner Edge Function, through B1b's hand-written `src/server/lib/sentry.ts`, with two client keys (the Worker's and the runner's, each with a per-key rate limit) and one event per fingerprint per 60 seconds per isolate, so one bad deploy cannot spend the month (INT-12); browser errors reach it through `POST /api/public/client-error` (FE-09), bounded by the client's caps before any parse (message 2,000 characters, stack 50 lines of 500 characters, ASSUMED H39 (3)); the client reads no environment and takes `dsn`, `env` and `release` from its caller (`sentryOptions()` of B3's `env.ts` in the Worker, ASSUMED H39 (4)); Workers Logs with one JSON line per `logLine(level, event, fields)` call, `event` from `LogEvent` in `src/server/lib/log-events.ts`, and `console` banned elsewhere by lint (CS-08); a dead-man's switch that depends on neither the runner nor Resend: the runner, keep-warm and `backup.yml` write `ops_heartbeats` through `beat(p_name, p_detail)`, `GET /api/hooks/ops-health/<token>` answers 200 `ok` or 503 `fail: <names>`, and a third UptimeRobot keyword monitor polls it every 5 minutes (B8, DO-03, ASSUMED H9 and H10; the operator signs up for the uptime account and the orchestrator configures the monitors and the read-only key, S59); a daily `health` system job (B8: pg_cron row `health` at 13:00 UTC enqueues it, `src/server/jobs/system/health.ts` runs the checks, writes `jobs.result`, emits `health.failed` once when a check fails, and B8b's seeded recipe for that event emails the admin through `notify_admin`; proof `bunx vitest run tests/unit/jobs/health.test.ts`). The weekly audit robot (B14) reads health, it does not ping | 5k errors/month | |
| Analytics | GA4 via the typed `dataLayer` (gtag.js after consent, G31), Search Console (both set up by the orchestrator when the build needs them, S59), Bing, Cloudflare zone HTTP analytics (read through the API, no Web Analytics beacon script, G31), first-party `analytics_events` | free | |
| Admin | `/admin` route group inside the site from day one: request queue, decide with templated emails, invoice, dossier editor, media, publish, asset approvals, channel status, subscriber and interest lists, **Automation section** (recipes, templates, reasons, channel and schedule settings, dry-run) | free | docs deferred to Studio; Studio has no publish button |
| Tests | Vitest (contracts, forms, state machine), Playwright (every route, desktop + phone, a11y), run on every pull request into `main`; draft PRs skip the database, Playwright and Lighthouse jobs, and a test with no assertion fails (ASSUMED H7, CS-12) | free | docs had none |
| Delivery | private GitHub repo `AbdulrahmanAmer/matter-of-place`; Actions: check → test → build → `wrangler deploy` on main; preview Worker per PR; `main` is guarded by CI rules, not branch protection (P-028): the orchestrator merges only through `workspace/05-plans/merge-gate.mjs`, the `ci.yml` job `merge-gate` verifies every merge after the fact, and `deploy.yml` deploys only a SHA whose `ci` run passed and that no newer code commit supersedes (B1b invariants 6a and 6b). Pull request jobs never hold the Supabase management token or a `DEV_SUPABASE_`, `PROD_` or `BACKUP_` secret (the `DEV_SUPABASE_*` names are the production database's credentials after the launch switch, H35); the `preview` job holds the account-wide deploy token, an open risk recorded in PROJECT-STATE (ASSUMED H4). GitHub Environments need GitHub Pro, an operator decision (ASSUMED H5) | free | |
| Domain | `matterofplace.com` registered at Namecheap (S29, S47; the registrar stays Namecheap, L1), DNS on Cloudflare (zone active, Free, E9) | ~$10/yr | |
| Audit robot | `mop-auditor` (B14) on the `audit` schedule row; reads PSI, Search Console, GA4, Cloudflare zone analytics, Sentry stats (optional, G11), the uptime monitor, Bing (optional) and our `/api/admin/audit.*` actions with its agent key; it holds no Meta, Resend, service role or deploy credential (B14 invariant 3); writes `workspace/audits/`; opens PRs | Claude usage only | |
| AI usage | Sonnet designs templates once; Haiku writes captions and alt text through the operator's Claude account on his laptop, never through an API key (S58, ASSUMED H34): `write_captions` is a step of the execution class `local`, which the job runner never executes; `scripts/captions-runner.ts` (`bun run captions`, by hand and from a Windows scheduled task every 15 minutes registered by `scripts/install-captions-task.ps1`) claims one job at a time with `claim_job`, pipes the prompt on stdin to `claude -p --model claude-haiku-4-5-20251001 --output-format json` (the CLI named by `CAPTIONS_CLI`, default `claude`), validates the answer with the caption schema and calls `finish_job` or `fail_job`, at most 25 jobs a run; an editor can always type the captions by hand, which completes the waiting job with `{ manual: true }`; B8's health reports the oldest waiting `write_captions` job and notifies an admin after 24 hours; tests set `CAPTIONS_CLI` to a stub; concierge and search rule-based at launch | the operator's Claude plan | no Anthropic key exists anywhere (H34 (1)) |

Cost at launch: $0/month plus the domain. Paid steps, in order of likelihood: Resend $20 (list > 3,000 sends), Supabase Pro $25
(> 500 MB or no-pause), Cloudflare Workers Paid $5 (> 100k requests/day).

## 2. Architecture in words

- **One repo, one Worker.** `src/routes/*` are pages; `src/routes/api/*` are server routes; `src/server/*` holds handlers,
  the Supabase service-role client, rate limiting, logging and the job enqueuer. Nothing in `src/server` is imported by the browser.
  The files the job runner also loads under Deno (B1b invariant 16: `src/server/lib/{errors,log,log-events,runtime-env,sentry,media-store,events,jobs,crypto}.ts`,
  `src/server/jobs/**`, `src/server/automation/**`, `src/domain/**` and the other files listed there) write every relative, `@/server/` and
  `@/domain/` import with the `.ts` extension, because Deno 2 refuses extensionless specifiers; lint enforces it from B1b on (CS-01).
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
  with the market pre-selected (`subscribers.markets[]`). Illustrative data exists only before L1's launch switch (the illustrative
  seed refuses once `settings.environment` is `production`, ASSUMED H35 (5)) and in the bundled `local` services adapter that local
  runs and, after the switch, every preview use.
- **Legal identity is Omnikom's.** `siteConfig.legal` carries the Omnikom entity and address; footer, legal, terms and
  privacy read from it. "Matter of Place is a product of Omnikom" replaces "An Omnikom company" where the lawyer prefers.
  The operator supplies the entity facts in the last phase (S59). The Omnikom inquiry webhook (B15) is built and stays switched
  off: the operator has no Omnikom endpoint (S59).
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
  job failures visible in `/admin`, a daily health job that fails loudly, and a heartbeat checked from outside
  (`ops_heartbeats`, the `ops-health` hook, the third uptime monitor), so a stopped runner or a missed backup alerts even when
  the runner and Resend are the things that broke (DO-03).

## 3. Repo layout target

```
app/
  src/routes/            pages + api/ server routes
  src/server/            handlers; lib/ (db client, log and log-events, sentry, crypto, rate-limit, env, media-store (Supabase Storage, H33), the job enqueuer); jobs/ (steps/ and system/); email/ (B5); payments/ with adapters/ (manual.ts and stripe.ts, B6); channels/ (meta.ts, x.ts, linkedin.ts, youtube.ts by B10, resend.ts by B11)
  src/db/                generated types, query helpers
  src/domain/            aliases + Zod input schemas
  src/admin/             admin components (behind auth)
  src/templates/         social/ (cover, carousel, story, newsletter block and the static OG card `OgCard.tsx`, all B9; there is no og/ folder) and email/ (React Email, B5, later slices append), consumed by the render jobs and the mail sender
  supabase/migrations/   versioned SQL (source of truth)
  supabase/functions/    job-runner/ only (B8): runs every light step, digest assembly included (`queue_digest`, B11), and dispatches the heavy ones; no other function exists (keep-warm is the Worker's scheduled() handler, owned by B8b)
  scripts/               smoke.mjs, cf-edge.mjs, check-migrations.mjs, merge-gate.mjs, deploy-guard.mjs and stubs.ts (B1b); seed.ts, variants.ts and lib/assert-not-production.mjs (B2; the one guard every destructive or test script calls first, H35 (5)); render-job.mjs and post-callback.mjs (B8); render-variants, render-cover, render-carousel, render-story and render-og-static .mjs and lib/media-store.mjs (B9; Storage uploads, H33 (2), (5)) and render-reel.mjs (B12), all run by render.yml; captions-runner.ts and install-captions-task.ps1 (B9, the owner of `write_captions`; the laptop runner of H34); harden/ (H1); launch/ (L1). App folder; posting runs in job-runner steps, not scripts (G21); the film engine stays in repo-root launch/ and the audit robot's scripts/audit/ sits at the repository root (B14)
  tests/                 vitest + playwright
  wrangler.toml
E:\Matter Of Place\.github\workflows\   ci.yml, deploy.yml, render.yml, backup.yml, audit-scope.yml, audit-deps.yml (audit-collect.yml only as B14's fallback) — at the REPO root, not under the app (GitHub only reads it there; GOTCHAS G-012)
E:\Matter Of Place\.github\dependabot.yml   B1b, repo root as well
```

Workflow owners: `ci.yml`, `deploy.yml`, `backup.yml` and `dependabot.yml` are B1b's (later slices add jobs or steps as their plans say); `render.yml` is B8's (B9 and B12 add to it); `audit-scope.yml` is B14's; `audit-deps.yml` is H1's; `audit-collect.yml` exists only if B14 step 8 records the routine's network egress as BLOCKED (B14 step 9). Proof once the owning slices land: `ls "E:/Matter Of Place/.github/workflows"` lists those files and `git ls-files "app/.github"` prints nothing.

CI and fonts. Jobs set `working-directory: app`. S50 bans Docker on the operator's laptop only (ASSUMED E7, H1 c); GitHub-hosted
runners may run containers. The per-PR database proof is B4's `ci.yml` job `db`: it starts an ephemeral Supabase stack on the runner with
`bunx supabase start -x studio,imgproxy,realtime,logflare,vector,supavisor,mailpit,edge-runtime`, applies every migration from zero, runs
the re-apply check, the type drift check and the `db` vitest project, and needs no secret. Only `main` reaches `mop-dev` (ASSUMED H1 a):
the post-merge `dev` job of `deploy.yml` runs `bun run db:push` and B8's job-runner deploy; `preview-db` pushes nothing and deploys
nothing; no `ci.yml` job reads or writes `mop-dev` (exception H1 d: while one lane is open, that lane may push its branch migrations
under the G34 lock). Every workflow sets `permissions: {}` with per-job grants, pins every action by commit SHA, sets
`timeout-minutes` on every job, and keeps the Supabase management token and every `DEV_SUPABASE_`, `PROD_` and `BACKUP_` secret out of any
job a pull request can reach (B1b invariants 14 and 15). There is one Supabase project (ASSUMED H35): the `dev` job is the only job that
pushes migrations, before and after L1's launch switch, and the `production` job waits on it (`needs: dev`) and touches no database. Lint is type-aware with warnings failing, and `bun run check` also runs knip, jscpd and
the stub ledger `scripts/stubs.ts` (B1b invariant 16).
Font files (`public/fonts/*.woff2`) belong to one slice: whichever of B9 and B17 runs first creates them and the other reuses them.

## 4. Environments and secrets

| Env | URL | DB | Deploy |
|---|---|---|---|
| local | localhost:8080 | the one cloud project `mop-dev` until L1's launch switch, plus native PostgreSQL 18 for throwaway tests; no Docker, no local Supabase stack (S50, E7); after the switch database tests run only on the CI `db` stack or the native PostgreSQL (H35 (6)) | `bun run dev` |
| preview | `pr-<n>.holy-meadow-4327.workers.dev` | `mop-dev` until the launch switch; after it none: the `local` services adapter and no Supabase secret (H35 (7), B1b invariant 13a) | Actions on PR |
| dev (stable) | `matter-of-place-dev.holy-meadow-4327.workers.dev` | `mop-dev` until the launch switch, then none, like preview (H35 (7)) | Actions on every push to `main` (`deploy.yml`, B1b, G19), with the preview secret bundle and `MOP_ENV=preview` (`local` after the switch); until the switch it is the callback target of heavy jobs (`RENDER_CALLBACK_URL`) and the `SITE_URL` of the job runner (B5); the same `dev` job pushes `main`'s migrations to the one project before and after the switch |
| production | matterofplace.com (before the domain is attached: `matter-of-place.holy-meadow-4327.workers.dev`) | the one project, the one whose ref is `DEV_SUPABASE_PROJECT_REF` (dashboard name `mop-dev`, ASSUMED H35): the Worker holds its pair from B3 step 8 on and keeps it, no second project and no swap; the database stage `settings.environment` is `preview` until L1's launch switch and `production` after it | Actions on merge to main, through the merge gate (B1b invariant 6b), after the `dev` job (`needs: dev`) |

The launch switch (H35 (4)) is one step of L1, run once from `main`: the last `bun run db:reset`, the production seed (no illustrative row), the first admin user, then `settings.environment = 'production'`. From then on only three things write to the project outside the product: `bun run db:push` from `main`, the idempotent production seed and the nightly backup's read; every destructive or test command first calls `scripts/lib/assert-not-production.mjs` (B2) and refuses with `refusing: production database`. No guard decides by project ref.

Every `.workers.dev` host answers `X-Robots-Tag: noindex` whatever `MOP_ENV` says (`isIndexableHost(host, MOP_ENV)` in `src/server/seo/robots.ts`, B1b creates, B13 extends, G19).

Files live in Supabase Storage of the one project, in three buckets that B2's migrations create with their policies (ASSUMED H33): `submissions` (private: uploads and staging), `media` (public: variants of published photographs, rendered social assets, Open Graph images, reels and their posters) and `documents` (private: invoice PDFs and report files). Every published file's public address is `/media/<key>` on our own domain, a resource route of the Worker (B3) that streams `<SUPABASE_URL>/storage/v1/object/public/media/<key>` with `cache-control: public, max-age=31536000, immutable`, stores it with the Cache API, answers 404 when Storage does and makes no database query. No page, email or post links to a `supabase.co` address. B14's `limits.json` measures the walls at 70 and 90 percent: 1 GB of Storage, 5 GB of Storage egress a month, one Worker request per image view.

Worker secrets (`wrangler secret`, never in the repo): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET`,
`SENTRY_DSN`, `SENTRY_TEST_TOKEN` (B1b's `POST /api/hooks/sentry-test`; set on preview always, on production only while a test runs,
the route answers 404 when it is unset), `OPS_HEALTH_TOKEN` (the path token of `GET /api/hooks/ops-health/<token>`, compared in constant time with `timingSafeEqual`;
set by hand on `matter-of-place` by B8 step 6a and replaced at L1 step 1a from `PROD_OPS_HEALTH_TOKEN`; on previews and `matter-of-place-dev`
a key of `PREVIEW_WORKER_SECRETS_JSON`, DO-03), `CSRF_SECRET` (B7's signed double-submit key, API-05; a preview bundle key, and
`PROD_CSRF_SECRET` at L1 step 1a), `RENDER_CALLBACK_SECRET`, `JOB_RUNNER_SECRET`, `RATE_LIMIT_SALT`, `CONFIRM_TOKEN_SECRET`
(B5; the Worker seals the subscriber confirm token at signup and the job runner opens it, so the same value is also a Supabase
function secret; read through B3's `src/server/lib/env.ts`, G12), `PREVIEW_TOKEN_SECRET`,
`RESEND_WEBHOOK_SECRET` (Svix, B3), and later `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. `RESEND_API_KEY` is not a Worker secret: the
Worker never calls Resend (B5 invariant 10, B11), every send runs in the job runner. No Meta, X or LinkedIn
secret is a Worker secret: every platform call runs in a job-runner step or the reconcile job (B10 invariant 1), so those names
live only in Supabase function secrets (G21); none is a GitHub Actions secret and none is set with `wrangler secret put`. Storage is
reached through `src/server/lib/media-store.ts` (B3 creates it, H33 (2)): it calls the Storage REST API with `fetch`, `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`, takes the bucket as the first argument of each function, and fails only on an outage at run time with the one
error `storage_unavailable` (503, retried by the job system). The plain Worker var `MEDIA_PUBLIC_BASE` is the absolute media base (the
Worker's own origin plus `/media`; B1b's deploy jobs pass it), used where an absolute address is needed; pages link `/media/<key>`.

Supabase function secrets (`supabase secrets set`): `RESEND_API_KEY`, `RESEND_FROM` (`Matter of Place <hello@notify.matterofplace.com>`), `RESEND_FROM_BULK` (`Place Notes <hello@notes.matterofplace.com>`, ruling H29), `CONFIRM_TOKEN_SECRET` (the Worker's value, B5),
`ADMIN_NOTIFY_EMAIL`, `SITE_URL` (B5: the https origin `confirm_url` and `link_url` are built on; the stable dev Worker's URL until
L1's launch switch, then the production Worker's origin, `https://matterofplace.com` once the domain is attached, set by L1 on the same
project, ASSUMED H35 (8)), `EMAIL_DRY_RUN` (B5: a forcing override, `1` makes every send a dry run, G14; rows are
`skipped` with a `dry_` id), `EMAIL_LIVE` (B5, E2E-04: `1` only while `MOP_ENV` is `preview`; the build stage fails closed, so without it
`liveSideEffects("email")` sends nothing, and with it mail reaches only `settings.email.dev_recipients`; L1 unsets it at the launch switch,
where the recipient allow-list of INT-02 ends, H35 (8)), one Resend API key per stage on the one project (`RESEND_API_KEY` holds the dev
key until the launch switch, then L1 replaces it with production's own key from `PROD_RESEND_API_KEY`, never the same value; each with
full access, ruling H28, INT-02 (4), H35 (8)),
`JOB_RUNNER_SECRET`, `GITHUB_DISPATCH_TOKEN` (a fine-grained GitHub token for this repository only with Actions: Read and write plus Metadata: Read, no Contents permission, so a leaked runner secret cannot push to `main`, SEC-02, JOB-01; no expiration by the operator's word and rotated by hand once a year; made by the orchestrator on 2026-10-02, delegated in words, ASSUMED E22, and written by the unseen route of GOTCHAS P-055, S59; never a Worker secret, G33), `GITHUB_REPO`, `SOCIAL_DRY_RUN` (the single dry-run flag for every social channel; `META_DRY_RUN` is retired),
`MEDIA_PUBLIC_BASE` (the absolute public media base of ASSUMED H33 (4), the Worker's own origin plus `/media`; it replaces the name
`MEDIA_BASE_URL`, H33 (2); `mediaUrl(key, { absolute: true })` of B3's `src/server/lib/media-store.ts` prefixes it in the steps, and Meta,
X, LinkedIn and mail clients fetch what it builds, so `post_meta`, `post_x`, `post_linkedin`, `build_newsletter_block` and the render
dispatch need it in the function too; B9 step 10 sets it to `https://matter-of-place-dev.holy-meadow-4327.workers.dev/media`, L1's
launch switch (step 1d) moves it on the same project to the production Worker's origin plus `/media`, and L1 step 4e to
`https://matterofplace.com/media` once the domain is attached, because from the switch on the dev Worker holds no `SUPABASE_URL` and its `/media/<key>` route cannot reach
Storage, H35 (1), (7)), `MOP_ENV` (`preview` until L1's launch switch,
`production` after it, H35 (8)), `SENTRY_DSN` (the job runner's own Sentry client key,
not the Worker's; its source copy in `.env` is `SENTRY_DSN_JOB_RUNNER`, INT-12), `RENDER_CALLBACK_URL` (B8; the dev Worker until the launch
switch, the production Worker after it, H35 (7)),
`CF_PURGE_TOKEN`, `CF_ZONE_ID` (B8b, `purge_cache`), `INDEXNOW_KEY` (B13, optional: read by `purge_cache` only when `params.indexnow`
is true; unset means the ping is skipped and logged `indexnow_skipped`), `META_*`, `X_*`, `LINKEDIN_*` (set at the end, when the operator
supplies the apps, S59), `OMNIKOM_WEBHOOK_URL`, `OMNIKOM_WEBHOOK_SECRET` (unset: the operator has no Omnikom endpoint, so B15 is built and
stays switched off, S59).
Storage needs no secret of its own (ASSUMED H33): `src/server/lib/media-store.ts` (B3, loaded by the Worker and the Deno job runner) and
its twin `scripts/lib/media-store.mjs` (B9, Node scripts and `render.yml`) call the Storage REST API with `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`, and the bucket is the first argument of each function, never derived from `MOP_ENV` and never a variable.
H33 (2) deleted `R2_BUCKET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_S3_ENDPOINT` from every list, and
H34 (1) deleted the Anthropic key: no function secret, GitHub secret or `.env` line holds one, because captions run through the
operator's Claude account on his laptop (`scripts/captions-runner.ts`, section 1 "AI usage"). Proof: `bunx supabase secrets list
--project-ref $DEV_SUPABASE_PROJECT_REF` lists the names (values are never printed) and `bunx supabase secrets list --project-ref
$DEV_SUPABASE_PROJECT_REF | grep -c "R2_\|ANTHROPIC"` prints 0.

GitHub Actions (measured 2026-10-01, E10). Secrets present: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_ACCESS_TOKEN`,
`DEV_SUPABASE_PROJECT_REF`, `DEV_SUPABASE_DB_PASSWORD` (the one project's names, kept as spelled, ASSUMED H35 (1); after L1's launch
switch they are the production database's credentials),
`PREVIEW_WORKER_SECRETS_JSON` (a bundle: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET`, `SENTRY_DSN`,
`RATE_LIMIT_SALT`, `SENTRY_TEST_TOKEN`; L1's launch switch removes `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from it, which turns
the `preview` and `dev` jobs to the `local` services adapter, B1b invariant 13a, H35 (7)). `deploy.yml` passes the whole bundle to `wrangler secret bulk`, so a later slice adds a preview
secret by adding a key to that GitHub secret (the orchestrator updates it from `.env`), never by editing the workflow:
`RESEND_WEBHOOK_SECRET` (B3), `CONFIRM_TOKEN_SECRET` (B5), `PREVIEW_TOKEN_SECRET` and `CSRF_SECRET` (B7), `RENDER_CALLBACK_SECRET`, `JOB_RUNNER_SECRET` and `OPS_HEALTH_TOKEN` (B8). The secret
`DEV_SUPABASE_SERVICE_ROLE_KEY` exists as well, for jobs that need the service key outside the bundle (`render.yml`'s Storage uploads,
ASSUMED H33 (5)). Added by later slices:
`RENDER_CALLBACK_SECRET` as a GitHub secret of its own (B8 step 7, `gh secret set`; the same value as the Worker secret, read by
`render.yml`'s `post-callback.mjs`); `CF_ANALYTICS_TOKEN` (Account Analytics Read, minted by the orchestrator from `mop-admin`, read by B4's
`scripts/cpu-gate.mjs` in the `preview` job, T-11, ruling H27). There is one Supabase project (ASSUMED H35 (1)): no `PROD_SUPABASE_*`
secret and no second database URL is ever created, the `production` job of `deploy.yml` has no database step (the `dev` job's
`bun run db:push` is the one database step, B1b invariant 13), and B3b's coming-soon assertion runs only while the repository variable `MOP_DB_PRODUCTION` is `true` (set by L1 step 1g). H33 (2)
removed `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`: the orchestrator deletes both GitHub secrets and no workflow reads them. There is
no backup passphrase secret: `backup.yml` encrypts
to the committed public certificate `app/backup-recipient.pem` with `openssl cms`, and the private key is escrowed offline by the operator
(password manager plus a sealed paper copy), never in GitHub or `.env` (B1b, DO-02, DO-06, ASSUMED H5). Which jobs may read which secret:
`SUPABASE_ACCESS_TOKEN` and the `DEV_SUPABASE_*` secrets are read only by the main-only `dev` job of `deploy.yml`, by `backup.yml` and by
`render.yml` (`DEV_SUPABASE_PROJECT_REF` and `DEV_SUPABASE_SERVICE_ROLE_KEY`, which it passes to the scripts as `SUPABASE_URL`
`https://<ref>.supabase.co` and `SUPABASE_SERVICE_ROLE_KEY`, H33 (5)); a job a pull request can reach never references them, a `PROD_`
secret or a `BACKUP_` secret, and `hygiene.test.ts` fails if one does (B1b invariant 15, SEC-01). Variables: `VITE_SITE_URL`,
`VITE_TURNSTILE_SITE_KEY`, `VITE_API_BASE_URL` (`/api/public`);
`CI_HEAVY` (absent means on; the orchestrator sets `off` when the month's Actions minutes cross 70 percent, which skips the heavy pull
request jobs; `backup.yml`, `production` and `dev` never read it, DO-08);
to add when B13 needs it: `VITE_GA4_MEASUREMENT_ID` (B13; public, G-006; the orchestrator creates the GA4 property and the Search Console
property when the build needs them, S59; passed by `deploy.yml` to the production build only, so previews never load GA4);
to add at launch: `MOP_DB_PRODUCTION` (`true` from L1 step 1g, right after `set-env --value production`; B3b's production step runs
`assert-coming-soon.mjs` only while it is `true`, H35 (4)) and `MOP_LAUNCHED` (`true` makes B3b's production step run `assert-coming-soon.mjs --after-launch` and switches the
production deploy's `MEDIA_PUBLIC_BASE` to `https://matterofplace.com/media`; absent means coming-soon mode is asserted and the base is the
production Worker's `workers.dev` origin; set by L1 step 4e at the domain cut-over with `gh variable set MOP_LAUNCHED --body true`, G47).
No GitHub variable holds a media base: `DEV_MEDIA_BASE_URL` and `PROD_MEDIA_BASE_URL` are never created (H33 (4)). Plain Worker vars
`MOP_ENV`, `MEDIA_PUBLIC_BASE` and `SENTRY_RELEASE` (set per deploy with `--var`, B1b) are not secrets; each deploy job passes
`--var MEDIA_PUBLIC_BASE:` with the Worker's own origin plus `/media` (B1b's Variables table holds the three exact values).

Local files only (git-ignored, values never printed; never a GitHub or Worker secret; SEC-08). The repository-root `.env` holds the dev
names and is loaded with `eval "$(node scripts/load-env.mjs --profile dev)"` (B2), which prints only its allow-list; the repository-root
`.env.ops` holds the ops names, `CLOUDFLARE_API_TOKEN` (the owner's `mop-admin`), `CF_EDGE_TOKEN` (optional, `scripts/cf-edge.mjs`),
`SUPABASE_ACCESS_TOKEN`, every `PROD_*` name below, and the source copies of `OMNIKOM_WEBHOOK_URL` and `OMNIKOM_WEBHOOK_SECRET`
(production partner values, B15; empty, because the operator has no Omnikom endpoint and B15 stays switched off, S59), loaded only with `--profile ops` in a shell that runs no test (B2's `guard-env.mjs` makes a test
process refuse them). `.env`: `CLOUDFLARE_ACCOUNT_ID`, `DEV_SUPABASE_PROJECT_REF`,
`DEV_SUPABASE_DB_PASSWORD`, `DEV_SUPABASE_SERVICE_ROLE_KEY`, `DEV_DB_URL`, `DEV_SUPABASE_POOLER_HOST` and
`DEV_SUPABASE_POOLER_USER` (the session pooler host and the `postgres.<ref>` user that `ready.mjs` checks with `psql`), `SENTRY_DSN` (the
Worker's client key) and `SENTRY_DSN_JOB_RUNNER` (the job runner's client key, the source copy of its function secret `SENTRY_DSN`, INT-12);
in `.env.ops` at launch (L1 step 1, ASSUMED A11; there is no `PROD_SUPABASE_*` name and no `PROD_DB_URL`, because the one project keeps
its `DEV_SUPABASE_*` names and `DEV_DB_URL` after the launch switch, H35 (1)) the fresh production values of the production Worker and the
job runner: `PROD_RATE_LIMIT_SALT`, `PROD_CONFIRM_TOKEN_SECRET`, `PROD_PREVIEW_TOKEN_SECRET`, `PROD_CSRF_SECRET`, `PROD_JOB_RUNNER_SECRET` and
`PROD_OPS_HEALTH_TOKEN` (the source of the production Worker secret `OPS_HEALTH_TOKEN`; L1 step 1a writes each once, never reused from
the build-stage values), `PROD_RESEND_API_KEY` (production's own full-access Resend key, never equal to the dev `RESEND_API_KEY`; L1's
launch switch puts it into the function secret `RESEND_API_KEY` of the one project, INT-02 (4), ruling H28, H35 (8); an operator input of L1 step 0b) and `PROD_RESEND_WEBHOOK_SECRET` (L1 step 4e); the production Turnstile pair `PROD_TURNSTILE_SECRET` (the
value of the Worker secret `TURNSTILE_SECRET` on `matter-of-place`, B3, L1 step 1a) and `VITE_TURNSTILE_SITE_KEY_PROD` (the source copy
of the GitHub variable `VITE_TURNSTILE_SITE_KEY`); `PREVIEW_RATE_LIMIT_SALT` and `PREVIEW_SENTRY_TEST_TOKEN` (the source copies of the
bundle keys `RATE_LIMIT_SALT` and `SENTRY_TEST_TOKEN`, read by B3's dev loader; `RATE_LIMIT_SALT` on `matter-of-place` takes
`PREVIEW_RATE_LIMIT_SALT` until L1 step 1a); the source copies of values the
orchestrator pushes elsewhere (`CONFIRM_TOKEN_SECRET`, `JOB_RUNNER_SECRET`, `RENDER_CALLBACK_SECRET`, `OPS_HEALTH_TOKEN` (B8 step 6a, the dev
value, also in the `dev` profile of `load-env.mjs`), `PREVIEW_TOKEN_SECRET` and `CSRF_SECRET` (B7 step 2),
`RESEND_WEBHOOK_SECRET` (the `mop-dev` webhook's value, B3), `CF_ANALYTICS_TOKEN` (also the GitHub secret of the same name, T-11), and the function secrets
`RESEND_API_KEY` (B5 step 5), `CF_PURGE_TOKEN` and `CF_ZONE_ID` (B8b), `GITHUB_DISPATCH_TOKEN` (made by the orchestrator, S59),
`X_ACCESS_TOKEN`, `X_REFRESH_TOKEN`, `LINKEDIN_ACCESS_TOKEN` and `LINKEDIN_REFRESH_TOKEN` (B10's authorize scripts, once the operator
supplies the apps at the end, S59), each written when its account or token exists; no Anthropic key, H34 (1));
`CAPTIONS_CLI` (optional, B9's `scripts/captions-runner.ts`: the headless Claude CLI it runs, default `claude`; tests set it to the stub
`tests/fixtures/claude-stub.ts`, H34 (3), (7); not a secret);
`ADMIN_SMOKE_KEY` (B7, the dev agent key the seed prints, read by `scripts/admin-smoke.ts`); `OMNIKOM_MOCK_SECRET` (B15, the signing
secret of the local mock receiver); `LEGAL_ENTITY_NAME` (the operator input `ready.mjs --launch` checks before L1 step 1, G32; the
operator supplies it in the last phase, S59); `SENTRY_AUTH_TOKEN` (`org:read`, `project:read`, `event:read`, G11; the orchestrator
makes it in the Sentry account that the operator and the orchestrator created on 2026-10-01 and that is signed in on this laptop, and
writes it to `.env` by the unseen route of GOTCHAS P-055, S59, S60;
not needed to build, needed for the stored-event checks of B1b step 4, H1's `sentry-probe.ts` and L1, so it gates launch only: `ready.mjs`
lists it as `WAIT` and `ready.mjs --launch` fails while it is missing, G65); `UPTIME_API_KEY` (setup A15, the uptime vendor's
read-only key; the operator signs up for the uptime account, a step only he can take, and the orchestrator does everything after it:
the monitors and this key, S59; the source copy for `ready.mjs --launch` and for the laptop runs of `uptime.mjs` in B14 step 1 and L1 step 6, copied
into the routine environment at B14 step 7); `REHEARSAL_AGENT_KEY` (L1's `scripts/rehearsal.ts`, a dev agent key revoked after sign-off). In the
operator's shell only, never in a file: `AUDIT_AGENT_KEY_DEV` (B14, the `mop-auditor-dev` key on `mop-dev`). Proof of the names
(values never printed): `node workspace/05-plans/ready.mjs` prints its `.env names` row as `PASS` with the count of the names it requires.

Audit routine environment (B14; the cloud routine's settings, never the repository or GitHub unless B14 step 9 moves them to
Actions secrets of the same names; `CF_ANALYTICS_TOKEN`, `SENTRY_AUTH_TOKEN` and `UPTIME_API_KEY` also keep a source copy in the
local `.env`): `AUDIT_AGENT_KEY`, `SITE_URL` (the stable dev Worker before L1, `https://matterofplace.com` after),
`PSI_API_KEY`, `GOOGLE_SA_JSON_B64`, `GA4_PROPERTY_ID` (the Google names: the orchestrator sets up GA4, Search Console and the service
account when the build needs them, S59), `CF_ANALYTICS_TOKEN`, `CF_ACCOUNT_ID`, `CF_ZONE_ID`, `UPTIME_API_KEY`, and the
optional `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` (G11) and `BING_WEBMASTER_API_KEY`. No other credential is created for the audit (G11).

Inventory proof (names only, values never printed): `bunx wrangler secret list --name matter-of-place` (with the local `mop-admin`
token) lists the Worker secrets that exist so far, and the same with `--name matter-of-place-dev` once B1b's `deploy.yml` has deployed
the dev Worker (BLOCKED until then); `bunx supabase secrets list --project-ref $DEV_SUPABASE_PROJECT_REF` lists the function secrets;
`gh secret list` and `gh variable list` list the GitHub names. A name a plan uses that is missing from this section is a defect in this
section, not a new secret.

`render.yml` (B8 creates it; B9 and B12 add to it) gets everything per run from its one `workflow_dispatch` input `job` (the JSON the
runner dispatches, read as `fromJSON(inputs.job)`; no `repository_dispatch` trigger and no `client_payload` expression, JOB-01, SEC-02) and
fixed names, never from a variable that holds one environment: `fromJSON(inputs.job).env` is the dispatching job runner's `MOP_ENV`
(`preview` until L1's launch switch, `production` after it, ASSUMED H35 (8); any other value fails the run before any script starts) and
becomes the scripts' `MOP_ENV`. The workflow holds no media base and reads no GitHub variable (B8): every image a render script
fetches arrives in the job JSON as an absolute URL that the job runner built with `mediaUrl(key, { absolute: true })` from its own
function secret `MEDIA_PUBLIC_BASE`, and the reel job reads its shots with `getObject("media", key)` (B12; H33 (4)). `fromJSON(inputs.job).callback_url` is where `post-callback.mjs` reports (so no
callback variable exists in GitHub). Storage is reached with `SUPABASE_URL: https://${{ secrets.DEV_SUPABASE_PROJECT_REF }}.supabase.co`
and `SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.DEV_SUPABASE_SERVICE_ROLE_KEY }}` in the job env (H33 (5), H35 (1)); `scripts/lib/media-store.mjs`
(B9) writes every published file to the bucket `media` of the one project, with `cache-control: public, max-age=31536000, immutable`
(H33 (3)), and throws `storage_unavailable` only on an outage at run time (H33 (2)). Nothing waits on a storage switch any more (H33 (9)):
no render step is BLOCKED on storage, and the `--out` mode of the render scripts is a local preview only. Proof: a
`bun run scripts/job-selftest.ts --event property.published --fixture` run before the launch switch ends with `gh run watch` green and
`media_key` values in `assets.files`, and `curl -sI https://matter-of-place-dev.holy-meadow-4327.workers.dev/media/<one of those keys>` answers 200 with
`cache-control: public, max-age=31536000, immutable`.

`DEV_DB_URL` is the session pooler URL of `mop-dev`, the one project (`postgresql://postgres.<ref>:<password>@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
password percent-encoded). It is in the local `.env` and named in `.env.example` (B2). No `ci.yml` job reads it: the CI `db` and `e2e` jobs set
`DEV_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres` for their own ephemeral stack (ruling H1 b). Every plan that writes
`$DEV_DB_URL` on the laptop means the `mop-dev` URL, which after L1's launch switch is the production database: from then on every
destructive or test script reads `settings.environment` over its own connection through `scripts/lib/assert-not-production.mjs` (B2)
and refuses with `refusing: production database` (ASSUMED H35 (5)); database tests run on the CI `db` stack or the native PostgreSQL 18
(H35 (6)).

Deploy token `mop-github-actions` holds exactly Workers Scripts Write, Workers KV Storage Read and Workers R2 Storage Write (E1); nothing
uses the R2 permission since ruling H33 removed R2, and it stays until a narrower token is measured. It has
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
| an API route | public (B3): `src/routes/api/public/<name>.ts` whose handler only calls `handlePublic(request, context.requestId)` (the id B1b's `start.ts` puts in the router's request context, ASSUMED H39 (1)), plus one row in `src/server/public/routes.ts` (`path`, `method`, `schema`, `limits`, `turnstile`, `form`, `raw`, `cache`, `service`; `routes-parity.test.ts` fails on a file without a row), its Zod input schema in `src/domain/contracts.ts` (the forms import the same file), the service in `src/server/<feature>/service.ts`; `handlePublic` writes the one log line with the request ID. Admin (B7, API-02, CS-03): `src/routes/api/admin/<name>.ts` whose exported handlers are each built by `defineAdminRoute({ method, action, input, output, auth, bodyLimitBytes, handler })` from `src/server/lib/admin-route.ts`, which runs the actor (`src/server/lib/actor.ts`), the CSRF check on every session write, the session and recent-auth checks, `authorize(actor, action)`, the Zod parse of `input` (its schema in `src/domain/admin-<feature>.ts`), then the service in `src/server/<feature>/service.ts` (which still starts with `authorize`); the answer goes through `adminJson` (`src/server/lib/admin-response.ts`) and SQL errors through `fromRpcError` (`src/server/lib/admin-errors.ts`, over the one code list `errorCodes` of `src/server/lib/error-codes.ts`, API-03) | Vitest for the schema and the service; `bunx vitest run tests/unit/routes-parity.test.ts` for a public route; for an admin one `tests/unit/authz.matrix.test.ts` and `tests/unit/admin-routes-parity.test.ts` (every exported admin handler is built by `defineAdminRoute` with an action in the matrix); Playwright hits the route |
| an admin action (button) | `src/admin/<feature>/` component + server function; permission check by role in the server function, never in the UI; audit row (`who, what, when`) | Vitest: forbidden role gets 403; allowed role changes state |
| a table or column | `supabase/migrations/<ts>_<name>.sql` (up only; a second migration undoes); `supabase gen types` → `src/db/types.ts`; RLS policy in the same migration. `<ts>` (written `<timestamp>` in some plans, same thing) is the UTC creation time `YYYYMMDDHHMMSS` that `bunx supabase migration new <name>` prints, run (no Docker needed) in the step that adds the file, so file order equals landing order; a branch rebased on `origin/main` whose new file sorts before a migration already on `main` renames it with a fresh `supabase migration new` timestamp; a migration that references another slice's table is created only after that slice's migration is on `main`. A migration lands on `main` in its own small PR (the migration plus the regenerated `src/db/types.ts`) before the code that needs it, because a PR preview runs against `main`'s schema (ASSUMED H1, E2E-06). An applied file is never edited, renamed or deleted, and a file that drops or narrows an object carries `-- contract-of: <14-digit version>` naming the expand migration already on `main` (DO-05, DB-08; checked by B1b's `scripts/check-migrations.mjs` and B2's `tests/db/migration-headers.test.ts`). `--include-all` and `migration repair` are never run on `mop-dev`, the one project (ASSUMED H35), without the orchestrator. B2's foundation set (12 fixed names from `20261001090000_extensions_enums.sql` to `20261001091100_settings_defaults.sql`) is the one place RLS sits in its own migration (`20261001090900_rls.sql`) | the PR's CI `db` job is green (ephemeral stack, every migration from zero, the re-apply check, the type drift check) and its `migration-order` step (`scripts/check-migrations.mjs`) passes; after the merge the `dev` job of `deploy.yml` pushes it to `mop-dev` with `bun run db:push`, and `bunx supabase migration list --linked` shows the local and remote columns equal and ascending. While one lane is open (ASSUMED H1 d) the lane may push its branch migration to `mop-dev` under the G34 lock, and `bun run db:reset` (B2's no-Docker reset of `mop-dev`: empties `public`, drops the pgmq queues, unschedules the cron jobs migrations created, then pushes; P-038) runs only from `main` and only before L1's launch switch: after it `scripts/lib/assert-not-production.mjs` makes it refuse with `refusing: production database`, and forward migrations reach the project only through the `dev` job's `bun run db:push` (ASSUMED H35 (4), (5)) |
| a job type | the name goes into the architecture's step catalog first (P-031); `src/server/jobs/steps/<name>.ts` exporting `{ type, heavy, paramsSchema, run(ctx, params, payload), onResult? }` (B8 contract: `onResult(ctx, job, result)` for heavy steps only, `run` returns `{ status: "done" }` or `{ status: "retry_at", at, reason }` and never updates `jobs` itself); one import line in `src/server/jobs/steps/index.ts`; the recipe editor's choices come from that catalog and its `paramsSchema`; the step file and everything it imports write `.ts` import extensions (Deno-loaded set, CS-01); no deploy step of its own: B8's steps in the main-only `dev` and `production` jobs of `deploy.yml` redeploy `job-runner` with `bunx supabase functions deploy job-runner --use-api` after a merge whose change touches `supabase/functions` or `src/server`, and no pull request job ever deploys it (ASSUMED H1 a, DO-07) | Vitest runs the step against a fixture; the `deno` step of the CI `check` job passes; dry-run lists it; `node workspace/05-plans/check-plans.mjs` prints OK (it fails when a catalog step has no code file in any plan, P-043) |
| an email | `src/templates/email/<name>.tsx` (React Email); its key appended to `emailTemplateKeys` in `src/domain/email.ts` and its entry appended to `definitions` in `src/templates/email/index.ts` (G46, G53); its `email_templates` row (subject, preheader, blocks, variables) seeded by the slice's migration with `on conflict (key) do nothing`; preview in `/admin › Automation` | Vitest renders it and B5's seed test finds `select key from email_templates` equal to `emailTemplateKeys` as sets; `bun run scripts/email-test.ts render <key>` writes the HTML today; a test send lands (`bun run scripts/email-test.ts <key> <address>`, once B5 step 5 has set `EMAIL_LIVE=1` on `mop-dev` and only before L1's launch switch, after which email tests with test recipients refuse through `scripts/lib/assert-not-production.mjs`, ASSUMED H35 (5); the Resend account, key and domains exist, ASSUMED E17, E18) |
| an analytics event | name added to `AnalyticsEvent`; `track()` call at the action; the API's allow-list | TypeScript refuses free strings; event row appears |
| a role or permission | `app_role` enum migration; RLS policies in the same migration (architecture 3.7); the action in `src/server/lib/permissions/<group>.ts` with its import line in `src/server/lib/permissions/index.ts`, checked by `authorize(actor, actionId)` from `src/server/lib/authz.ts` in the server function (B7); its row in the hand-typed fixture of `tests/unit/authz.matrix.test.ts` in the same commit | `bunx vitest run tests/unit/authz.matrix.test.ts` (fails on an action without a fixture row and on a fixture row without an action) |
| a social channel | the channel name into architecture 3.5's `channel_settings` list and its step type `post_<name>` into the architecture step catalog first (P-031); `src/server/channels/<name>.ts` implementing B10's `Channel` interface from `src/server/channels/types.ts` (`{ id, supports(kind), publish(asset, ctx), metrics(post), health() }`; YouTube's disabled block `youtube.ts` is the starting file); its entries in `getChannel`, `targetsFor`, `filesFor` and `captionFor` (`src/server/channels/index.ts`); its spec in `src/server/automation/step-specs.ts` and its mapping in `stepForChannel` (`src/server/automation/catalog.ts`); `src/server/jobs/steps/post-<name>.ts` calling `postToChannel` (`src/server/channels/post-to-channel.ts`) with one import line in `src/server/jobs/steps/index.ts`; its credentials rule in `assertMayEnable` (`src/server/channels/enable-guard.ts`; YouTube answers 422 `no_adapter` until then); the slice's migration widens the `channel_settings.channel` check and inserts the row disabled with `on conflict (channel) do nothing` when the channel is new (YouTube's row is already seeded by B8b), and replaces `unpublish_property` (`create or replace`) so a takedown also cancels `post_<name>` jobs; the step joins the `asset.approved` recipe from `/admin › Automation`; the row is enabled on screen 20 once `assertMayEnable` passes | `bunx vitest run tests/unit/channels/<name>.test.ts tests/unit/channels/post-<name>.test.ts tests/unit/channels/targets.test.ts tests/unit/channels/enable-guard.test.ts tests/unit/automation/catalog.test.ts` with the API mocked; `node workspace/05-plans/check-plans.mjs` → OK; one real test post BLOCKED until the channel's account and credentials exist (operator) |
| an email channel | `src/server/channels/<name>.ts` with `{ publish(asset, settings), metrics }` (B11's `src/server/channels/resend.ts` is the pattern); its `channel_settings` row (`newsletter` is the existing one) | `bunx vitest run tests/unit/channels/<name>.test.ts` with the API mocked |
| a new public read | add it to the snapshot shape in `getCatalog` (or to `getPublicState` if it is a flag or a setting), never a table query per request; the endpoint and the loader read the memoised result | Vitest: the database call counter does not move on a warm request (architecture §13) |

Rules behind the table: feature folders (`src/server/<feature>`, `src/admin/<feature>`) own their code; shared code is
imported from `src/lib` or `src/server/lib`, never copied (jscpd in `bun run check` fails on a copy of 70 tokens, knip on an unused
export, CS-05); signatures, hashes and constant-time compares come only from `src/server/lib/crypto.ts` (CS-04); no component reads the database; no server function trusts
the client for identity or role; every PR's checklist ticks the path it used. `mop-builder` refuses a slice that has no path.

## 6. Decisions recorded from this approval
See `PROJECT-STATE.md` S7–S20. Remaining questions (Q1–Q12) are listed there and answered in session.
