# Database runbook

How the one database is read, changed, reset, seeded and switched to production. Facts about the account are from ASSUMED E9 and the rulings H1, H33 and H35 of `workspace/05-plans/ASSUMED.md`. Slice B2 wrote this page; later slices add to it.

## What the database is

There is one Supabase project: dashboard name `mop-dev`, ref in `DEV_SUPABASE_PROJECT_REF`, region `us-east-1`, Postgres 17. It is the build database today and production after the launch switch. No second project exists and none is created at launch (ruling H35); the names `DEV_SUPABASE_*` and `DEV_DB_URL` keep their spelling after it.

Its stage is data, not a project name: `settings.environment`.

| Value         | Meaning                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `development` | What migration 12 inserts. `public_state().illustrative_content` is true.                                                                        |
| `preview`     | The build stage B3b sets. `illustrative_content` is still true.                                                                                  |
| `production`  | Set once by the launch switch. `illustrative_content` is false, and every destructive or test command refuses (`refusing: production database`). |

Nothing reads a project ref to decide the stage.

## No Docker, and where each job runs

- The laptop never starts Docker: no `supabase start`, no `supabase db reset`, no `supabase db diff` (S50, GOTCHAS P-038). Every cloud command below goes to `mop-dev`.
- CI's `db` job runs an ephemeral stack on the GitHub-hosted runner and builds the database from the branch's own migrations (H1). That is where a branch proves its schema; `bun run db:reset -- --local` and `bun run gen:types -- --local` exist for that stack only and refuse any host but `127.0.0.1`.
- Only `main` changes `mop-dev` (R18). A lane never pushes an unmerged migration.

## Load the keys without printing them

From `app/`, in a fresh shell:

```
eval "$(node scripts/load-env.mjs --profile dev)"
```

`scripts/load-env.mjs` exports the allow-listed names of one profile and refuses when its output is a terminal. Profile `dev` reads `.env` (`DEV_DB_URL`, `DEV_SUPABASE_PROJECT_REF`, `DEV_SUPABASE_DB_PASSWORD`, `DEV_SUPABASE_SERVICE_ROLE_KEY`); profile `ops` reads `.env.ops` (`CLOUDFLARE_API_TOKEN`, `CF_EDGE_TOKEN`, `SUPABASE_ACCESS_TOKEN`). Database scripts call `guardEnv()` and refuse while an ops name is in the shell, so run them as `env -u CLOUDFLARE_API_TOKEN bun run <script>` after loading `dev` (GOTCHAS P-310). `bun run gen:types` reads `mop-dev` by project id and needs `SUPABASE_ACCESS_TOKEN`, which only the `ops` profile holds.

## The commands

| Command                                                        | What it does                                                                                                                                  |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `bunx supabase link --project-ref "$DEV_SUPABASE_PROJECT_REF"` | Links the `app/supabase` folder to the project. The link is per folder and lives in the ignored `supabase/.temp/`; a new worktree repeats it. |
| `bun run db:push`                                              | The one path for migrations. Never a bare `supabase db push`.                                                                                 |
| `bun run db:reset`                                             | The no-Docker reset of the build database. Build stage only.                                                                                  |
| `bun run db:fn <name>`                                         | Writes a migration from `supabase/sql/functions/<name>.sql` after a function changed (R19).                                                   |
| `bun run gen:types`                                            | Writes `src/db/types.ts` from the `public` schema of `mop-dev`; `--local` reads the CI stack.                                                 |
| `bun run db:psql -- <psql arguments>`                          | psql against `DEV_DB_URL`. The password goes in `PG*` variables, never on a command line.                                                     |
| `bun run seed -- --target dev --mode full --images skip`       | See Seeding.                                                                                                                                  |

### db:push and its refusals

It runs the checks below before the Supabase CLI, then records the sha256 of every applied file in `public.migration_checksums`. Each refusal names the items and has one fix.

| Refusal                                       | Cause                                                         | Fix                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `refusing: branch migrations <files>`         | A local file name is not on `origin/main`.                    | Let the pull request merge; `main` pushes. Phase 0 and phase 2 only: see MOP_SINGLE_LANE. |
| `refusing: remote-only migrations <versions>` | The database holds a version with no local file.              | `git fetch` and merge `origin/main`.                                                      |
| `refusing: out-of-order migration <file>`     | An unapplied local file is older than the newest applied one. | Make the file again with `bunx supabase migration new <name>` and move the text over.     |
| `refusing: edited migration <version>`        | An applied file's sha256 differs from the recorded one.       | Restore the file; the change is a new migration.                                          |

`MOP_SINGLE_LANE=1` lets exactly one open lane push its branch migrations under the `mop-dev-tests` advisory lock. It is for phase 0 and phase 2 only, while one lane is open, and the exception is closed once `settings.environment` is `production`. `--include-all` and `supabase migration repair` are never used on `mop-dev` without the orchestrator.

`db:push` is a forward migration from `main`, so it is the one schema write that stays allowed after the launch switch.

### db:reset and its modes

It empties `public` and `app`, drops the pgmq queues, unschedules the cron jobs the migrations created, truncates the migration history, then runs `db:push`, which applies every file from zero. `auth` and `storage` are never touched, so users and stored files survive a reset. It holds the `mop-dev-tests` lock for the whole run.

Before the first write it checks that the linked project, `DEV_SUPABASE_PROJECT_REF` and the user of `DEV_DB_URL` name the same project (`refusing: ref mismatch`), that `DEV_SUPABASE_DB_PASSWORD` is set, and that the stage is not `production` (`refusing: production database`, from `scripts/lib/assert-not-production.mjs`).

- `bun run db:reset -- --accept-foreign`: continue when the database holds a version this branch has no file for (`refusing: foreign migrations <versions>` otherwise). The version is abandoned history, and the reset removes it.
- `bun run db:reset -- --local`: the CI stack only. It needs `DEV_DB_URL` on `127.0.0.1`.
- Without `MOP_SINGLE_LANE=1` it also refuses `branch migrations`: in phase 1 only the orchestrator resets, from `main`.

## Two public reads, nothing else

A public page or catalog JSON never queries a table (architecture 13, S52). Two functions are the only public database reads, both `security definer` with an empty `search_path`, executable by the service role only:

- `public.public_state()`: the seven keys of the public state (catalog version, flags, coming-soon flags, site settings, `og_static`, `illustrative_content`). The Worker memoises it for 15 seconds per isolate.
- `public.public_catalog_snapshot()`: the whole published catalog in one JSON value, asked at most once per catalog version per isolate. Its size is measured by `tests/db/snapshot-budget.db.test.ts`; the budget is 1,500,000 bytes.

A warm read costs zero queries. A new public read is a new function in `supabase/sql/functions/`, never a table grant to `anon`. Both functions' text is in `supabase/sql/functions/<name>.sql`; the version of the catalog is `settings.catalog_version`, bumped by trigger on every catalog write.

## Row level security and the security advisor

Every table in `public` has RLS on and exactly the grants of `tests/db/rls-matrix.ts`. The two policy helpers, `app.role_in(...)` and `app.is_staff()`, are `security definer` and live in schema `app`, which PostgREST does not expose (`config.toml` `api.schemas = ["public"]`): `/rest/v1/rpc/is_staff` answers 404, and the advisor's lint 0029 has nothing to report. A new policy helper goes in `app`, never in `public`.

Lint 0008 (RLS enabled, no policy) on the analytics partitions, `migration_checksums` and `pii_columns` is deny-all by design: only the service role and `postgres` read or write them.

## Auth URLs

`supabase/config.toml` is the source of the auth URLs, applied with `bunx supabase config push` (never typed into the dashboard). Today it holds the build values: `site_url = "http://localhost:8080"` and the localhost, preview, dev and production Worker addresses in `additional_redirect_urls`, with `enable_signup = false` (invite only; staff sign in by magic link, S10).

The launch values that L1's launch switch writes into `[auth]` of this file on `main` before it runs `config push`:

```
site_url = "https://matterofplace.com"
additional_redirect_urls = [
  "https://matterofplace.com/**",
  "https://www.matterofplace.com/**",
  "https://matter-of-place.holy-meadow-4327.workers.dev/**",
]
enable_signup = false
```

The workers.dev address is the production Worker before the domain is attached. No preview or dev Worker address stays, because after the switch no preview holds a key to the database (H35 (7)). Magic links pointing at localhost or a preview after launch are the failure this prevents. UNPROVEN until that run; the fallback is `PATCH https://api.supabase.com/v1/projects/$DEV_SUPABASE_PROJECT_REF/config/auth` with `SUPABASE_ACCESS_TOKEN`.

## The launch switch

L1 owns it and runs it once, from `main`. B2 supplies the scripts, the guard and this section. In order:

1. `bun run db:reset`, the last one.
2. `bun run seed -- --mode reference`: markets, regions, notes and guide entries only, no illustrative row.
3. The first admin user (B7).
4. The launch values of `[auth]` above, then `bunx supabase config push`.
5. `settings.environment = 'production'` through B3b's `set-env` script, never a raw `select public.set_environment(...)`.

Everything written during the build is gone after step 1, by design.

After it, the cloud database is production. Only three things write to it outside the product: forward migrations with `bun run db:push` from `main`, the idempotent reference seed, and the nightly backup's read. `db:reset`, the illustrative seed and every script that inserts test rows stop with `refusing: production database`. Database tests then run only on the CI stack, or on the laptop's native PostgreSQL when they need no Supabase extension (H35 (6)). There is no cloud database left to rehearse a change on; adding a second free project later plugs in through the scripts' `--target` argument.

## Storage

Files live in Supabase Storage of the same project, in three buckets that migration 11 creates and updates in place (ruling H33). `db:reset` does not touch `storage`.

| Bucket        | Access  | Size limit | Holds                                                                                                   |
| ------------- | ------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| `submissions` | private | 25 MiB     | Uploaded originals, and admin uploads under `staging/` until the variants exist. JPEG, PNG, HEIC, WebP. |
| `media`       | public  | 12 MiB     | Variants of published photographs, rendered social assets, Open Graph images, reels and posters.        |
| `documents`   | private | 10 MiB     | Invoice PDFs and report files, behind short-lived signed URLs. PDF, CSV, Markdown, JSON.                |

`[storage] file_size_limit = "25MiB"` in `supabase/config.toml` is the project ceiling. No policy exists on `storage.objects`: every write and every signed URL comes from the service role.

Published media is served on our own domain at `/media/<key>`. The Worker streams `<SUPABASE_URL>/storage/v1/object/public/media/<key>`, caches it, and makes no database query. Keys carry a content hash, so every upload to `media` sets `cache-control: public, max-age=31536000, immutable`. No page, email or post links to a `supabase.co` address.

The walls of the free plan (H33 (8)), measured by `limits.json` at 70 and 90 percent: 1 GB of Storage in total, 5 GB of Storage egress a month (only cache misses reach Storage), one Worker request per image view against 100,000 a day. The size rules that keep the project inside them:

- The uploaded original is deleted once its variants exist; it never leaves `submissions`.
- The largest stored variant is 2560 px on the long edge. Variants are WebP unless a channel needs JPEG or PNG.
- A reel is one MP4 of at most 12 MB with one poster.

Storage objects are not backed up; that risk is listed in H1. UNPROVEN until the first real property is stored: how many properties fit (the estimate is about twenty).

## Seeding

`bun run seed -- [--target dev|local] [--mode full|reference] [--images upload|skip]`. It prints `lock mop-dev-tests held` first, then the row counts. There is no `prod` target.

- `--mode full`: the illustrative catalog (3 markets, 12 regions, 16 `Illustrative` properties, 6 stories). It refuses once the stage is `production`. It is not part of the first-time setup of production and never runs there.
- `--mode reference`: markets, regions, notes and guide entries only. It is idempotent and never changes `coming_soon` of an existing market. This is the seed the launch switch runs.
- `--images skip`: the image keys are written exactly as an upload would write them, and nothing is stored. `--images upload` stores the variants in `media` and works once B9's `scripts/lib/media-store.mjs` exists; until then it stops with `seed: --images upload needs the media-store of B9`.
- `--target local` writes to the CI stack through `API_URL` and `SERVICE_ROLE_KEY`.

To confirm a full seed: `select count(*) from properties where status = 'Illustrative'` returns 16.

## Reading a migration's down block

Every migration starts with `-- down:` (the SQL that undoes it, as comment lines) or `-- irreversible: <reason>` (for example `alter type ... add value`), then `set lock_timeout = '5s';`. A file on `main` is never edited, so a rollback is a new forward migration:

1. `bunx supabase migration new undo_<name>` makes the file with a fresh timestamp.
2. Copy the down block into it with the leading `--   ` removed, and give the new file its own `-- down:` or `-- irreversible:` header and `lock_timeout`.
3. A drop of a table, column or type belongs to a contract migration that names the expand migration it follows (`-- contract-of: <version>`); `scripts/check-migrations.mjs` enforces it. Production migrates before the Worker deploys, so the previous Worker must keep working with the new shape.
4. A migration whose header says `irreversible` has no down block; the fix is a forward migration written for that case.

The rollback drill itself belongs to H1.

## Retention

`public.retention_policies` holds one row per table that grows: `keep_for` (null keeps forever), `action` (`delete`, `anonymise` or `keep`), `enabled`. The deletes are B8's `retention` job; the rows are edited from `/admin`. Migration 12 seeds six rows, and the slice that creates a growing table seeds its own (R25).

| Key                         | Table              | Keeps     | What it does                                                                                     |
| --------------------------- | ------------------ | --------- | ------------------------------------------------------------------------------------------------ |
| `declined_submission_media` | `submission_media` | 90 days   | Deletes the photographs of a declined request, counted from `submissions.reviewed_at`.           |
| `inquiries_anonymise`       | `inquiries`        | 24 months | Removes the personal fields of an inquiry, counted from `created_at`; the row stays.             |
| `analytics_events`          | `analytics_events` | 90 days   | Drops whole monthly partitions, only after their days are rolled into `analytics_daily` (H16).   |
| `unconfirmed_subscribers`   | `subscribers`      | 30 days   | Deletes a subscriber who never confirmed, counted from `created_at`.                             |
| `contacts_anonymise`        | `contacts`         | 24 months | Removes the personal fields of a contact after their last request; the same period as inquiries. |
| `audit_log`                 | `audit_log`        | forever   | Nothing. The log is immutable.                                                                   |

## The monthly partition job

`analytics_events` is partitioned by month. The `analytics-partitions` cron job (`0 2 20 * *`) runs `public.ensure_analytics_partitions()`, which creates the next two months and moves any rows that waited in the default partition into their month. When the job failed or a month is missing, run it by hand:

```
bun run db:psql -- -c "select public.ensure_analytics_partitions()"
```

It is safe to run twice.
