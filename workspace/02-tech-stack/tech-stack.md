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
| Video | ffmpeg Ken Burns template in GitHub Actions; poster + MP4 to R2 | free | |
| Bots / abuse | Turnstile on all forms; one Cloudflare rate-limit rule; per-endpoint sliding window in the API (KV-free, DB-backed); headers from `cspFor(env, flags)` (CSP report-only from B1b, enforced by H1 through `flags.csp_enforce`; HSTS `max-age=31536000` until preload day 30, then `63072000` with `preload`) | free | |
| Errors / logs | Sentry free tier on the Worker; Workers Logs; daily health ping from the audit robot | 5k errors/month | |
| Analytics | GA4 via the typed `dataLayer`, Search Console, Bing, Cloudflare Web Analytics, first-party `analytics_events` | free | |
| Admin | `/admin` route group inside the site from day one: request queue, decide with templated emails, invoice, dossier editor, media, publish, asset approvals, channel status, subscriber and interest lists, **Automation section** (recipes, templates, reasons, channel and schedule settings, dry-run) | free | docs deferred to Studio; Studio has no publish button |
| Tests | Vitest (contracts, forms, state machine), Playwright (every route, desktop + phone, a11y), run on every PR | free | docs had none |
| Delivery | private GitHub repo `AbdulrahmanAmer/matter-of-place`; Actions: check → test → build → `wrangler deploy` on main; preview Worker per PR; `main` is guarded by a CI rule, not branch protection (P-028), and human merge review is the production gate (GitHub Environments are not available on this plan) | free | |
| Domain | `matterofplace.com` on Cloudflare (Registrar at cost, or DNS only) | ~$10/yr | |
| Audit robot | `mop-auditor` on a schedule; reads PSI, Search Console, GA4, Graph API, Resend; writes `workspace/audits/`; opens PRs | Claude usage only | |
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
- **Generated assets wait for a human.** Job output lands in `assets` with `status = pending`; media ops approves in `/admin`;
  approval enqueues the publish-to-channel job. Nothing posts on its own until the operator relaxes this per tier.
- **Money is a box with two doors.** `payments` holds one record per accepted submission: method (`invoice_manual` now,
  `stripe` later), amount, invoice number, status (`due`, `paid`, `waived`), who marked it paid and when. Acceptance
  never depends on it; activation (Scheduled) does. Swapping in Stripe means adding a webhook that writes the same row.
- **The site is honest about emptiness.** Every collection reads `published` rows only; when a market has none it renders
  the coming-soon block: what Matter of Place is, that no property is listed in this market yet, and a one-field signup
  with the market pre-selected (`subscribers.markets[]`). Illustrative data is seeded only into dev and preview.
- **Legal identity is Omnikom's.** `siteConfig.legal` carries the Omnikom entity and address; footer, legal, terms and
  privacy read from it. "Matter of Place is a product of Omnikom" replaces "An Omnikom company" where the lawyer prefers.
- **Automations are data the admins own (S34).** `automation_recipes` holds one recipe per trigger (`submission.received`,
  `submission.declined`, `submission.accepted`, `invoice.issued`, `payment.marked`, `property.published`,
  `asset.approved`, `digest.due`). A recipe is an ordered list of steps; each step names a job type from a fixed
  catalog in code (`send_email`, `render_variants`, `render_cover`, `render_carousel`, `render_story`, `render_reel`,
  `write_captions`, `build_newsletter_block`, `post_meta`, `queue_digest`, `notify_admin`, `webhook_omnikom`) with
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
  src/server/            handlers, db client, jobs, rate-limit, log, email, stripe, meta
  src/db/                generated types, query helpers
  src/domain/            aliases + Zod input schemas
  src/admin/             admin components (behind auth)
  src/templates/         social, og, email templates (React) consumed by render jobs
  supabase/migrations/   versioned SQL (source of truth)
  supabase/functions/    light job runner, digest assembly (keep-warm is the Worker's scheduled() handler, owned by B8b)
  scripts/               seed, image variants, render-social, render-reel, publish-meta (app folder; the film engine stays in repo-root launch/)
  tests/                 vitest + playwright
  wrangler.toml
E:\Matter Of Place\.github\workflows\   ci.yml, deploy.yml, render.yml, backup.yml — at the REPO root, not under the app (GitHub only reads it there; GOTCHAS G-012)
```

CI and fonts. Jobs set `working-directory: Matter Of Place Codebase`. No job needs Docker (S50). The `db` job runs tests
against `mop-dev` with secrets from `PREVIEW_WORKER_SECRETS_JSON` and one shared concurrency group; tests roll back.
Font files (`public/fonts/*.woff2`) belong to one slice: whichever of B9 and B17 runs first creates them and the other reuses them.

## 4. Environments and secrets

| Env | URL | DB | Deploy |
|---|---|---|---|
| local | localhost:8080 | `mop-dev` (cloud dev project) plus native PostgreSQL 18 for throwaway tests; no Docker, no local Supabase stack (S50, E7) | `bun run dev` |
| preview | `pr-<n>.holy-meadow-4327.workers.dev` | `mop-dev` | Actions on PR |
| production | matterofplace.com (before the domain is attached: `matter-of-place.holy-meadow-4327.workers.dev`) | `mop-prod`, created at launch | Actions on merge to main, after human merge review |

R2 media is off in every environment until the operator enables R2 (S50); steps that need a bucket are blocked, not failed.

Worker secrets (`wrangler secret`, never in the repo): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET`,
`SENTRY_DSN`, `RENDER_CALLBACK_SECRET`, `JOB_RUNNER_SECRET`, `RATE_LIMIT_SALT`, `PREVIEW_TOKEN_SECRET`, `RESEND_WEBHOOK_SECRET`
(Svix, B3), `RESEND_API_KEY`, and later `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `META_APP_SECRET`, `META_PAGE_TOKEN`. R2 access
is tolerant of missing `R2_*` secrets and fails with the one shared `r2_unavailable` error (B3 creates `src/server/lib/r2.ts`).

Supabase function secrets (`supabase secrets set`): `RESEND_API_KEY`, `RESEND_FROM`, `CONFIRM_TOKEN_SECRET`, `ADMIN_NOTIFY_EMAIL`,
`JOB_RUNNER_SECRET`, `GITHUB_DISPATCH_TOKEN` (a fine-grained GitHub token; an operator step), `GITHUB_REPO`, `SOCIAL_DRY_RUN` (the single dry-run flag for every social channel; `META_DRY_RUN` is retired), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
(R2 off, S50), `META_*`, `X_*`, `LINKEDIN_*`, `OMNIKOM_WEBHOOK_URL`, `OMNIKOM_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`.

GitHub Actions (measured 2026-10-01, E10). Secrets present: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY` (UNPROVEN while R2 is off), `SUPABASE_ACCESS_TOKEN`, `DEV_SUPABASE_PROJECT_REF`, `DEV_SUPABASE_DB_PASSWORD`,
`PREVIEW_WORKER_SECRETS_JSON` (a bundle: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET`, `SENTRY_DSN`,
`RATE_LIMIT_SALT`, `SENTRY_TEST_TOKEN`). `deploy.yml` passes the whole bundle to `wrangler secret bulk`, so a later slice adds a preview
secret by adding a key to that GitHub secret (the orchestrator updates it from `.env`), never by editing the workflow:
`RESEND_WEBHOOK_SECRET` (B3), `PREVIEW_TOKEN_SECRET` (B7), `RENDER_CALLBACK_SECRET` and `JOB_RUNNER_SECRET` (B8). The secret
`DEV_SUPABASE_SERVICE_ROLE_KEY` exists as well, for jobs that need the dev key outside the bundle. Absent until backup and launch:
`BACKUP_PASSPHRASE` and the `PROD_*` secrets. Variables: `VITE_SITE_URL`, `VITE_TURNSTILE_SITE_KEY`, `VITE_API_BASE_URL` (`/api/public`);
to add: `RENDER_CALLBACK_URL` (B8). Plain Worker vars `MOP_ENV` and `MEDIA_BASE_URL` are not secrets.

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
| an API route | `src/routes/api/<name>.ts` handler → `src/server/<feature>/service.ts`; Zod input schema in `src/domain/<feature>.ts`; rate limit entry; log line with request ID | Vitest for the schema and the service; Playwright hits the route |
| an admin action (button) | `src/admin/<feature>/` component + server function; permission check by role in the server function, never in the UI; audit row (`who, what, when`) | Vitest: forbidden role gets 403; allowed role changes state |
| a table or column | `supabase/migrations/<ts>_<name>.sql` (up only; a second migration undoes); `supabase gen types` → `src/db/types.ts`; RLS policy in the same migration | `bun run db:reset` (B2's no-Docker reset of `mop-dev`: empties `public`, drops the pgmq queues, unschedules the cron jobs migrations created, then pushes; P-038) or `supabase db push` clean; generated types compile |
| a job type | `src/server/jobs/steps/<name>.ts` implementing `{ run(payload, ctx) }`; register in the step catalog; add to the recipe editor's choices with its parameter schema | Vitest runs the step against a fixture; dry-run lists it |
| an email | `src/templates/email/<name>.tsx` (React Email); row in `email_templates` seed with subject and variables; preview in `/admin › Automation` | Vitest renders it; a test send lands |
| an analytics event | name added to `AnalyticsEvent`; `track()` call at the action; the API's allow-list | TypeScript refuses free strings; event row appears |
| a role or permission | `app_role` enum migration; RLS policies; server-function guard; role matrix in `docs/admin-os` diagram | Vitest permission matrix |
| a social or email channel | `src/server/channels/<name>.ts` implementing `{ publish(asset, settings) }`; `channel_settings` row; Media Ops toggle | Vitest with the API mocked; one real test post |
| a new public read | add it to the snapshot shape in `getCatalog` (or to `getPublicState` if it is a flag or a setting), never a table query per request; the endpoint and the loader read the memoised result | Vitest: the database call counter does not move on a warm request (architecture §13) |

Rules behind the table: feature folders (`src/server/<feature>`, `src/admin/<feature>`) own their code; shared code is
imported from `src/lib` or `src/server/lib`, never copied; no component reads the database; no server function trusts
the client for identity or role; every PR's checklist ticks the path it used. `mop-builder` refuses a slice that has no path.

## 6. Decisions recorded from this approval
See `PROJECT-STATE.md` S7–S20. Remaining questions (Q1–Q12) are listed there and answered in session.
