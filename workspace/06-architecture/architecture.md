# Engineering architecture — Matter of Place v1 (build from this)

Companion to `02-tech-stack/tech-stack.md` (choices) and `05-plans/` (slices). Diagrams: `03-diagrams/architecture.md`.
Written 2026-09-30 by the CTO session, no worker agents (S38). Every table, route and screen here has a slice in `05-plans/`.

## 1. Shape
One repository, one Cloudflare Worker, one Supabase project per environment.

```
browser ── edge cache ── Worker ──┬── pages (SSR, TanStack Start)
                                  ├── /api/public/*   anonymous, rate-limited, Turnstile on writes
                                  ├── /api/admin/*    Supabase Auth session or agent API key; role-checked server functions
                                  └── /api/hooks/*    signed callbacks: render workflow, Stripe (later), Resend events, Meta
Worker ── service role ── Postgres (migrations = source of truth) ── pgmq + pg_cron ── Edge Function job runner
                                                                      └── repository_dispatch ── GitHub Actions render workflow ── R2
```

Rules that hold everywhere:
- The browser never holds a Supabase key. Public reads come from the Worker with edge cache; writes are validated with Zod at the Worker and again by database constraints.
- Shapes come from the database: `supabase/migrations/*.sql` → `supabase gen types` → `src/db/types.ts`. `src/domain/*` re-exports row types and holds Zod input schemas only.
- Every state change goes through a server function in `src/server/<feature>/` that (1) resolves the actor, (2) checks the role, (3) performs the change in a transaction, (4) writes `audit_log`, (5) emits an event that the recipe engine turns into jobs. UI never calls the database.
- Every side effect is a job with an idempotency key. Nothing external (email, post, render) happens inside a request.

## 2. Module map (`Matter Of Place Codebase/`)
| Path | Owns | Imports from |
|---|---|---|
| `src/routes/*.tsx` | public pages, `head()`, loaders through `src/lib/queries.ts` | `src/services`, `src/components` |
| `src/routes/admin/*.tsx` | admin pages (layout `admin.tsx` guards auth) | `src/admin/*` |
| `src/routes/api/public/*.ts` | public handlers | `src/server/public/*` |
| `src/routes/api/admin/*.ts` | admin handlers (thin: parse → server function → JSON) | `src/server/*` |
| `src/routes/api/hooks/*.ts` | signed callbacks | `src/server/hooks/*` |
| `src/server/lib/` | `db.ts` (service-role client), `actor.ts`, `authz.ts`, `audit.ts`, `events.ts`, `jobs.ts`, `log.ts`, `ratelimit.ts`, `turnstile.ts`, `r2.ts`, `errors.ts`, `ids.ts` | nothing above |
| `src/server/<feature>/service.ts` | submissions, properties, media, payments, inquiries, subscribers, newsletter, assets, channels, automation, team, settings, reports, search, concierge | `src/server/lib`, `src/db` |
| `src/server/jobs/steps/*.ts` | the fixed step catalog; each exports `{ type, paramsSchema, run(ctx, params, payload) }` | feature services |
| `src/server/channels/*.ts` | `meta.ts`, `resend.ts`; `{ publish, metrics }` | lib |
| `src/templates/email/*.tsx` | React Email templates keyed by `email_templates.key` | tokens |
| `src/templates/social/*.tsx` | carousel, story, cover, newsletter block as React → HTML for the render workflow | tokens |
| `src/admin/<screen>/` | admin components and their server-function callers | `src/admin/ui` (shared table, form, drawer, status pill) |
| `src/db/` | generated `types.ts`, `queries/*.ts` typed helpers | supabase-js |
| `supabase/migrations/` | schema | |
| `supabase/functions/job-runner/` | Edge Function: pop jobs, run light steps, dispatch heavy | shares `src/server/jobs` by import |
| `scripts/` | `seed.ts`, `variants.ts`, `render-*.mjs`, `dump-db.mjs`, `export-report.mjs` | |
| `tests/unit`, `tests/e2e` | Vitest, Playwright | |
| `E:\Matter Of Place\.github\workflows\` | `ci.yml`, `deploy.yml`, `render.yml`, `backup.yml` | |

## 3. Data model v2 (migrations; the sketch schema is superseded)
Conventions: `uuid` ids (`gen_random_uuid()`), `timestamptz` for time, money as `numeric(12,2)` + `char(3)` currency (USD only at launch, check constraint), soft state via enums, every mutable table has `created_at`, `updated_at` (trigger), and RLS enabled with policies per role. Enum values keep the sketch's names where the frontend already uses them.

### 3.1 Catalog (public reads)
- `markets`, `regions`, `market_notes`, `market_guide_entries` — as sketch. Add `markets.coming_soon boolean default true` (S30) and `markets.interest_copy text`.
- `representatives` — as sketch.
- `properties` — as sketch plus `architect`, `designer`, `editorial_state` (`draft|review|published|archived`), `published_at`, `hero_rank`, `featured_rank` (unique among non-null), `campaign_tier`, `source`, `submission_id fk`, `search_text tsvector` (generated), `created_by`, `updated_by`.
- `property_media` (`sort_order`, `orientation`, `alt`, `r2_key`, `variants jsonb` = {thumb,card,hero,og,carousel}), `property_features`, `property_related`.
- `stories` — as sketch plus `editorial_state`, `author_id`.
- `settings` — `key text pk, value jsonb` (`catalog_version`, `site` = contact/legal/instagram, `coming_soon_global`).

### 3.2 People and audit
- `user_roles` (`user_id fk auth.users`, `role app_role`, `actor_kind` `human|agent`, `display_name`, `disabled_at`). Roles: `chief_editor, managing_editor, visual_editor, media_ops, commercial, admin` (admin = manages team and settings; the CEO).
- `agent_keys` (`id`, `user_id`, `key_hash`, `label`, `scopes text[]`, `last_used_at`, `revoked_at`) — API keys for agent accounts (S38).
- `audit_log` (`id`, `at`, `actor_id`, `actor_kind`, `action text`, `entity text`, `entity_id uuid`, `before jsonb`, `after jsonb`, `request_id`, `note`). Append-only; no update/delete policy for anyone.

### 3.3 Intake
- `submissions` — sketch columns plus `workflow_state` enum `Submitted|Under Review|Accepted|Declined|Awaiting Assets|Invoice Issued|Scheduled|Published|Distribution Active|Completed`, `reviewed_by`, `reviewed_at`, `decline_reason_id fk`, `decline_note`, `accepted_by`, `accepted_at`, `activated_by`, `activated_at`, `property_id`, `notes jsonb[]` (internal), `turnstile_ok boolean`.
- `submission_media` — as sketch (`storage_path`, `uploaded_at`, `bytes`, `mime`, `sha256`).
- `inquiries` — as sketch plus `assigned_to`, `forwarded_payload jsonb`, `turnstile_ok`.
- `subscribers` — sketch plus `markets text[]` (interest, S30), `confirmed_at`, `confirm_token_hash`, `unsubscribed_at`, `source`, `resend_contact_id`.
- `analytics_events` — as sketch; monthly partition by `occurred_at` from day one (cheap now, painful later).

### 3.4 Commercial (S32)
- `payments` (`id`, `submission_id`, `property_id`, `product exposure_package`, `amount`, `currency`, `method` `invoice_manual|stripe`, `invoice_number text unique` (`MOP-YYYY-NNNN` from a sequence), `invoice_r2_key`, `preferred_method text`, `status` `due|paid|waived|refunded`, `issued_by`, `issued_at`, `paid_marked_by`, `paid_at`, `stripe_payment_intent`, `notes`).
- `campaigns`, `campaign_reports` — as sketch; `campaigns.payment_id fk`.
- Trigger `enforce_editorial_gate`: `Invoice Issued` and later states require `accepted_at`; `Scheduled` requires a `payments` row with `status in (paid, waived)`.

### 3.5 Automation as data (S34)
- `automation_recipes` (`id`, `trigger text unique` from the event catalog, `name`, `enabled`, `version int`, `steps jsonb`): `steps = [{ id, step_type, params, enabled, requires_approval, conditions: { tiers?: [], markets?: [] } }]`. Validated by the Zod schema of each `step_type`.
- `email_templates` (`key text unique`, `subject`, `preheader`, `body jsonb` (blocks: heading, paragraph, button, facts, signature), `variables text[]`, `enabled`, `version`).
- `decline_reasons` (`id`, `code`, `label`, `email_paragraph`, `sort`, `enabled`).
- `channel_settings` (`channel text unique` `instagram|x|linkedin|facebook|youtube|newsletter` (S48: instagram, x, linkedin and newsletter enabled at launch; facebook and youtube seeded disabled), `enabled`, `posting_window jsonb` {days, from, to, tz}, `approval_mode jsonb` {Feature: manual|auto, Reach, Campaign}, `auto_after date` (S23: 60 days), `credentials_ref text`).
- `schedule_settings` (`key text unique` `digest|audit|keepwarm|prune|reconcile|backup`, `cron`, `enabled`, `last_run_at`, `next_run_at`).
- `automation_revisions` (`id`, `table_name`, `row_id`, `before`, `after`, `actor_id`, `actor_kind`, `at`, `note`) written by trigger on the five tables above.

### 3.6 Jobs and generated assets (S12)
- `jobs` (`id`, `type`, `payload jsonb`, `idempotency_key text unique`, `status` `queued|running|done|failed|dead|waiting_approval`, `attempts`, `max_attempts default 5`, `run_after`, `locked_at`, `locked_by`, `heavy boolean` (dispatch to Actions), `recipe_id`, `step_id`, `event_id`, `result jsonb`, `error text`, `created_at`, `finished_at`). pgmq queue `jobs_light`, `jobs_heavy`.
- `events` (`id`, `type`, `entity`, `entity_id`, `payload`, `actor_id`, `at`, `processed_at`) — the event catalog (17): `submission.received`, `submission.declined`, `submission.accepted`, `submission.awaiting_assets`, `invoice.issued`, `payment.marked`, `submission.activated`, `property.published`, `property.unpublished`, `asset.approved`, `asset.rejected`, `digest.due`, `inquiry.received`, `subscriber.created`, `subscriber.confirmed`, `invoice.voided`, `health.failed`.
- Plan-pass additions (ASSUMED.md §A/§D, 2026-09-30): `jobs.status` gains `cancelled`; `assets` gains `revision`, `meta`, `render_error`; `email_messages`, `email_suppressions`, `email_events` (B5); `payments` gains `void` status, `due_at`, `paid_method`, `paid_reference`, `waived_by`, `invoice_snapshot`, and `invoice_counters` gives gapless per-year numbers; `schedule_settings.interval_days`; `user_roles` unique on `(user_id, role)`.
- `assets` (`id`, `property_id`, `kind` `variants|cover|carousel|story|reel|newsletter_block|standalone_email`, `files jsonb` [{r2_key, w, h, bytes}], `caption`, `alt_text`, `status` `pending|approved|rejected|published`, `approved_by`, `approved_at`, `rejection_note`, `job_id`).
- `social_posts` (`id`, `asset_id`, `channel`, `status` `scheduled|posted|failed`, `scheduled_at`, `posted_at`, `remote_id`, `permalink`, `metrics jsonb`, `error`).
- `newsletter_issues` (`id`, `number`, `scheduled_for`, `status` `draft|approved|sending|sent`, `blocks jsonb`, `subject`, `resend_broadcast_id`, `metrics jsonb`, `approved_by`).

### 3.7 RLS in one sentence per table
Public tables: anonymous select of `published` rows only through the Worker (service role), never direct. Admin tables: `select` for every role; `insert/update` per feature (submissions decide: chief_editor, managing_editor; properties write: chief_editor, managing_editor, visual_editor; assets approve: media_ops, chief_editor; payments: managing_editor, admin; automation tables: chief_editor, media_ops, admin; team: admin); `delete` nowhere except `admin` on `agent_keys`. `audit_log`, `events`, `automation_revisions`: insert-only.

## 4. API surface
### 4.1 Public (`/api/public/*`), JSON, edge-cached where marked
`GET properties`, `GET properties/:slug`, `GET markets`, `GET markets/:slug`, `GET stories`, `GET stories/:slug` (cached, `Cache-Tag: catalog`, keyed by `catalog_version`); `POST inquiries`, `POST submissions` (returns signed upload URLs), `POST subscribers` (with `markets[]`), `GET subscribers/confirm?token`, `POST events` (204), `POST search`, `POST concierge` (rule-based). Writes: Turnstile token required, sliding-window rate limits stored in a small `rate_limits` table (no KV), request id in every log line and error body.

### 4.2 Admin (`/api/admin/*`), session cookie (Supabase Auth) or `Authorization: Bearer <agent key>`
Every route maps 1:1 to a server function; the handler only parses and returns. Groups: `submissions` (list, get, start-review, decline, accept, request-assets, activate, note), `payments` (issue-invoice, mark-paid, waive, list, get, pdf), `properties` (list, get, create-from-submission, update, publish, unpublish, rank, related), `media` (upload-url, attach, reorder, alt, delete, variants-status), `assets` (list, approve, reject, re-render), `channels` (posts list, retry, metrics-refresh), `newsletter` (issues list, build, preview, approve, send-test), `inquiries` (list, get, assign, forward, close), `stories`, `markets`, `jobs` (list, get, retry, cancel), `automation` (recipes get/put, templates get/put/preview, reasons, channel-settings, schedule-settings, dry-run, revisions, restore), `team` (users, roles, agent keys), `settings` (site config, coming-soon), `reports` (campaign report, export), `audit` (list). Agents use exactly these (S38).

### 4.3 Hooks (`/api/hooks/*`), signed
`render/callback` (Actions → assets rows; HMAC with `RENDER_CALLBACK_SECRET`), `resend` (delivery, bounce, complaint; Svix signature), `meta/webhook` (optional), `stripe` (later).
Admin additions from the plan pass: `auth` (sign-in link), `me`, `dashboard`, `newsletter/issues PUT`, `subscribers GET`, `audit.usage`, `audit.health`, `schedules.$key`, `assets/:id/caption`. Supabase Edge Function secrets (in addition to tech-stack §4): `META_PAGE_TOKEN`, `R2_*`, `OMNIKOM_WEBHOOK_*`, `ANTHROPIC_API_KEY`.

## 5. The recipe engine
1. A server function commits and inserts an `events` row in the same transaction.
2. A trigger (or the same function) loads the enabled recipe for `events.type`, filters steps by `conditions` against the payload (tier, market), and inserts one `jobs` row per enabled step with `idempotency_key = event_id:step_id`, `heavy` from the step type, `status = waiting_approval` if `requires_approval`, else `queued`; enqueues on pgmq.
3. Edge Function `job-runner` (pg_cron every minute, and pgmq `read` with visibility timeout) pops light jobs and runs the step; for heavy jobs it calls GitHub `repository_dispatch` with the job id and payload, marks `running`, and the Actions workflow posts results to `hooks/render/callback`.
4. Failures: `attempts++`, exponential `run_after`, `dead` after `max_attempts`; dead jobs appear red in `/admin › Jobs` with a retry button. Every transition is a `job_events` row (or `jobs.result` history) for the timeline in the UI.
5. Dry-run: given a trigger and a sample payload, returns the list of jobs the engine would create, without inserting.

Step catalog (code; grows only by PR; `workspace/05-plans/check-plans.mjs` enforces it): `send_email`, `render_variants`, `render_cover`, `render_carousel`, `render_story`, `render_reel`, `write_captions`, `build_newsletter_block`, `post_meta`, `queue_digest`, `notify_admin`, `webhook_omnikom`, `bump_catalog_version`, `purge_cache`, `render_og_static` (manual-only: OG covers for non-property pages, B9), `post_x`, `post_linkedin` (S48; `post_meta` covers Instagram now and Facebook when enabled; a `post_youtube` step is added by PR when YouTube is switched on). Seventeen step types.

Default recipes (seeded, editable): `submission.received` → send_email(received), notify_admin; `submission.declined` → send_email(declined, reason); `submission.accepted` → send_email(accepted); `invoice.issued` → send_email(invoice); `payment.marked` → notify_admin; `property.published` → bump_catalog_version, purge_cache, render_variants, render_cover, render_carousel, render_story, write_captions, build_newsletter_block, [tier Campaign] render_reel, [tier Campaign] send_email(standalone, requires_approval); `asset.approved` → post_meta, post_x, post_linkedin (each only if its channel is enabled in channel_settings), queue_digest; `digest.due` → build issue draft, notify_admin; `inquiry.received` → send_email(ack), notify_admin, webhook_omnikom.

## 6. Agents as staff (S38)
- An agent is a Supabase Auth user with `user_roles.actor_kind = 'agent'` and a role; it authenticates with an `agent_keys` bearer key (hashed at rest, scoped to route groups).
- Everything an agent can do is an `/api/admin/*` route, so a Claude session, a scheduled routine or a headless worker can run the queue: list submissions → read one → decline with reason or accept → write dossier → publish → approve assets. The same audit trail shows `actor_kind = agent`.
- Guardrails: agents cannot change roles, agent keys, or `settings`; `approval_mode` can require a human for a channel regardless of who approved the asset; an `agent_daily_limits` setting caps decisions per day.
- The CTO session adjusts automations through the same API (`automation.*`), so "adjust freely using you" needs no deploy.

## 7. Environments, secrets, delivery
| | local | preview | production |
|---|---|---|---|
| URL | localhost:8080 | `pr-<n>.matter-of-place.workers.dev` | matterofplace.com |
| DB | Supabase local (CLI) | `mop-dev` | `mop-prod` |
| Seed | full illustrative | full illustrative | none (coming soon) |
| Deploy | `bun run dev` | Actions on PR | Actions on merge to main |
Secrets: tech-stack §4. Backups: nightly `pg_dump` from Actions to R2 (`backup.yml`), 30 days retained; restore rehearsal in HARDEN.

## 8. Observability
Request id (`crypto.randomUUID()`) per request, in logs, error bodies and `audit_log`. Sentry on the Worker and the Edge Function. Workers Logs for request lines. `/admin › Dashboard` shows: queue counts by state, jobs failed in 24 h, next digest, channel health (last post, last error), Resend bounce rate, free-tier usage gauges (P-009). A daily `health` job fails loudly (email to admin) if any check fails.

## 9. Security (HARDEN checklist source)
Turnstile on every public write; rate limits per IP and per email; CSP, HSTS, `X-Frame-Options`, `Referrer-Policy`; service role only in the Worker; RLS per §3.7; signed upload URLs with MIME sniffing and size caps; HMAC on hooks; agent keys hashed, scoped, revocable; no secrets in `VITE_*`; `claude-security` scan before launch; dependency audit in CI.

## 10. Rules added by the engineering sweep of 2026-09-30
- **Legal and privacy.** CCPA applies: privacy policy lists categories, a "Do Not Sell or Share" link, a data access and deletion path (`POST /api/public/subjects/request`, tracked in `subject_requests` with a 45-day clock, fulfilled from Admin › Audit log via export/delete). Analytics (GA4, Tag Manager) load only after consent from a footer-anchored notice; first-party events are anonymous and exempt. Terms for Professionals and an accessibility statement are pages. Invoices carry entity, address, number, dates, description, amount, currency, a tax line placeholder, payment instructions and late terms.
- **Rights and takedown.** `submissions.rights_version`, `rights_confirmed_at`, `rights_ip_hash` record the licence text the agent accepted. Takedown: unpublish with reason, page returns `410 Gone`, scheduled posts withdrawn, done within 24 h.
- **Photographs.** EXIF (including GPS) is stripped from every upload before variants; accepted types JPEG, PNG, HEIC (converted), WebP; 25 MB and 40 files per submission.
- **Integrity.** `properties.version` gives optimistic locking (save with a stale version → 409, UI asks to reload). Slugs are immutable after publish; `slug_history` serves 301s and keeps sitemaps clean. Nothing hard-deletes except the retention job: declined submission photos after 90 days, inquiries anonymised after 24 months, done jobs after 30 days, analytics after 13 months; `archived_at` everywhere else. Every migration documents its down path or is marked irreversible. Duplicate submissions (same address and email within 30 days) are flagged, never rejected; a honeypot field and a Turnstile-down fallback (`turnstile_ok = false`, badge in the queue).
- **Time.** UTC in the database; displayed in the market's zone (Pacific for California, Eastern for New York and Florida); posting windows carry their timezone.
- **Security and operations.** Secrets rotation: Meta tokens refreshed by a job with an alert seven days before expiry, agent keys every 90 days, service keys per the runbook; admin sessions 12 h with re-auth for team and settings, CSRF double-submit on mutations, admin responses `private, no-store`; Sentry scrubs PII in `beforeSend`; an external uptime check every 5 minutes on `/` and `/api/public/markets`; cost alerts at 70 % of every free-tier line; Dependabot weekly; Bun and Node pinned; Cloudflare managed WAF and bot fight mode; agent keys prefixed `mopk_` with a revoke-all action; incident runbook in HARDEN.
- **Delivery.** Lighthouse CI budget on six pages per PR (LCP 2.5 s, CLS 0.1, JS 150 KB), JSON-LD and llms.txt validated in CI, email templates render-tested, test factories for submissions, invoices and jobs, `settings.flags` read by the Worker for feature flags, reduced motion respected, print styles for invoices and dossiers.
- **Growth.** `redirects` table editable in admin and served before routing; unknown paths logged for the audit report; a weekly KPI email to the CEO (submissions, acceptance rate, time to decision, invoices issued and paid, properties published, posts, newsletter growth, inquiries per property); newsletter list hygiene (bounces and complaints suppress, 12-month re-permission); optional `Agent Review` state with signed, 7-day, `noindex` preview links so an agent approves the narrative before publish.

Tables added by this section: `subject_requests`, `slug_history`, `redirects`, `retention_policies`; columns: `properties.version`, `submissions.rights_*`, `*.archived_at`, `settings.flags`.

## 11. Coming-soon mode (S30)
`markets.coming_soon` and `settings.coming_soon_global`. When true for a market, its pages and cards render the empty state: what Matter of Place is, "No property is listed in <market> yet", a one-field signup with the market preselected (`subscribers.markets`). The home edit shows the three market cards only. `properties` list hides that market. Editors flip the flag per market in `/admin › Markets` when the first property is published there; the recipe `property.published` does it automatically if `markets.coming_soon` is true.

## 12. Website essentials and compliance
Headers, consent, accessibility, identity files, feeds, error pages, fonts, delivery and mail hygiene are specified as invariants in `workspace/05-plans/B17.md` (26 invariants, each a test). CSP ships report-only first and is enforced after a clean week; consent is opt-in for analytics for everyone with Global Privacy Control honoured; fonts are self-hosted; the only third parties are Turnstile and, after consent, GA4.
