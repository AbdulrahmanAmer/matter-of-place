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
| A16 | Asset-to-channel map: carousel, story, reel → Instagram; cover, story → Facebook; daily cap 2 posts/channel; no hashtags at launch | B10 |
| A17 | Reel 18 s, 1080×1920, 30 fps, single-plane camera moves, sound bed by property type and market (no music, S36) | B12 |
| A18 | Archive URLs `/archive/<kind>/<slug>`; `llms-full.txt` capped at 500 KB; city-level location only; `public/robots.txt` replaced by a route | B13 |
| A19 | Terms and privacy split to `/terms` and `/privacy` with redirects from the old `/legal#terms` and `/legal#privacy` anchors (the plan's "no redirect" is overruled) | B16 |
| A20 | Backups encrypted with `age`; restore rehearsal on local Postgres; DMARC starts at `p=none` | H1 |
| A21 | Omnikom endpoint contract v1 as drafted; step 7 BLOCKED until Omnikom supplies URL and secret | B15 |

## B. Needs the CEO (answer in chat; I record them in PROJECT-STATE)
| # | Question | Recommendation |
|---|---|---|
| Q13 | Coming-soon pages: keep the illustrative market and region photographs on production with the "illustrative imagery" tag, or show only type on Bone until real photography exists? | Keep photographs, tagged: the pages must still feel like the publication |
| Q14 | AI crawlers: allow retrieval bots (search and answer engines) and refuse training bots in robots.txt? | Yes; it protects the archive while staying citable |
| Q15 | Decline-reason list and the email/template copy drafted in B5 and B8b: review now or after the first build? | After the first build, in the admin editor, so you review rendered emails not markdown |
| Q16 | Daily agent decision cap 25 and agents never auto-approve channels: keep? | Keep for the first 60 days |

## C. Unproven until built (each plan measures it in a named step)
Worker 10 ms CPU limit for SSR and admin (B1b, B3, H1) · `pg_dump` via session pooler and restore (B1b, H1) · Actions
minutes per render (B9, B12) · Supabase signed PUT behaviour and 2-hour URL lifetime (B3) · Bun importing `.jpg` in the
seed (B2) · Deno `npm:` support for `pdf-lib`, React Email, `cron-parser` in the Edge Function (B6, B8) · Resend
`Idempotency-Key` and whether auth mail shares the daily quota (B5) · `@supabase/ssr` in the Worker (B7) · cloud
routine egress for the auditor (B14) · Meta development-mode publishing without App Review (B10).

## D. Spec corrections to apply to architecture.md (done by the CTO in the next docs commit)
Event catalog: add `subscriber.created`, `submission.awaiting_assets`, `property.unpublished` recipes (17 events).
§4.2: add `auth`, `me`, `dashboard`, `issues PUT`, `subscribers GET`, `audit.usage`, `audit.health`, `schedules.$key`,
`caption` edit. §4.3: `/api/hooks/resend`. §3.4: `payments` columns and `invoice_counters`. §3.5:
`schedule_settings.interval_days`. §3.6: `jobs.cancelled`, `assets.revision/meta/render_error`, `email_messages`,
`email_suppressions`, `email_events`. tech-stack §4: Supabase function secrets for Meta, R2, Omnikom, Anthropic.
