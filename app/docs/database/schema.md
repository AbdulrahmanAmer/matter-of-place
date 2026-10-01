# Database notes

> Sketch from the MVP phase. The approved spec is ../../../workspace/02-tech-stack/tech-stack.md and ../../../workspace/06-architecture/architecture.md: read this for intent, build from the spec. Slice B2 replaces this page.

`schema.sql` creates everything in one pass on a fresh Supabase project. This page explains the choices and how each table maps to the frontend.

## Access model

- The public site never connects to Supabase. The API Worker uses the service role key (server-side secret) and applies its own validation and rate limits.
- Editors sign in with Supabase Auth. Roles live in `user_roles` (never on a profile table); `is_editor()` is a `security definer` function so RLS policies do not recurse.
- Every table has RLS enabled with a single policy: editors may do everything, anonymous users nothing. Tighten per table once an admin UI exists (for example, editors may not delete `inquiries`).

## Catalog tables → frontend types

| Table                                                                                       | Type                                      | Notes                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `markets`, `regions`, `market_notes`, `market_guide_entries`                                | `Market`, `Region`, `Note`, `MarketGuide` | The API assembles `regions[]`, `notes[]` and `guide.{neighborhoods,needs,service}` from the child tables ordered by `sort_order`. `guide_entries.section` decides which array.                         |
| `properties` + `property_media`, `property_features`, `property_related`, `representatives` | `Property`                                | `published_properties` view returns the nested shape. `video_*` columns become the optional `video` object. `coordinates` (Postgres `point`, x=longitude, y=latitude) becomes `[latitude, longitude]`. |
| `stories`                                                                                   | `Story`                                   | Published rows only.                                                                                                                                                                                   |
| `settings.catalog_version`                                                                  | n/a                                       | Cache key ingredient; bumped by triggers.                                                                                                                                                              |

Money is stored as whole currency units in `bigint` with an ISO currency code, exactly what `formatPrice` expects.

## Editorial workflow

`editorial_state` moves `draft → review → published → archived`. The check constraint keeps `published_at` in step with `published`. Only `published` rows leave the API. Home page placement uses `hero_rank` (1 to 6) and `featured_rank` (1 to 9), unique among non-null values so two dossiers can never claim the same slot.

## Write tables

| Table                             | Source                               | Lifecycle                                                                                                                                  |
| --------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `inquiries`                       | `POST /inquiries`                    | `new → in_progress → forwarded (Omnikom) → closed`. `subject_slug` is text on purpose; the record outlives the dossier.                    |
| `submissions`, `submission_media` | `POST /submissions` + signed uploads | `received → in_review → accepted/declined → published` (sets `property_id`). `uploaded_at` set by a Storage webhook or reconciliation job. |
| `subscribers`                     | `POST /subscribers`                  | Upsert on email. Add double opt-in (`confirmed_at`) before sending Place Notes.                                                            |
| `analytics_events`                | `POST /events` beacon                | Append-only. Partition or prune monthly if volume grows. `ip_hash` is deliberately absent here; keep events anonymous.                     |

`ip_hash` on inquiries and submissions is a salted hash used only for rate limiting and abuse review; store no raw IPs.

## Seeding

The illustrative content in `src/data/*.ts` is the seed. A small script (`tsx scripts/seed.ts`, to be written with the API) can import those modules and insert rows through the service role; image fields should be rewritten to Storage or R2 URLs at that point. Keep the seed clearly marked `status = 'Illustrative'`.

## Free-tier hygiene

- Keep photography out of Postgres; store URLs.
- Let the edge cache absorb reads (see `docs/architecture/caching.md`).
- Prune `analytics_events` older than 13 months with a scheduled function.
- Supabase pauses free projects after a week of inactivity; a scheduled `GET /api/markets` from a Cloudflare Cron Trigger every few days keeps it warm.
