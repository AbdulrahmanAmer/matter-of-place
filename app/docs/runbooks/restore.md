# Restore

How to get the one database back from a backup (H1 step 6 and 6b, DB-11, DO-06). There is one Supabase project: the
build database until L1's launch switch and production after it (ruling H35 (1)). Every command runs from `app/` in Git
Bash, with the dev profile loaded (`eval "$(node scripts/load-env.mjs --profile dev)"`, G-901) unless a step says
otherwise. Recovery targets (plan H1; they are not written in architecture section 7): RPO 24 hours, RTO 4 hours for the
public site and 8 hours for admin and jobs.

## 1. Where the dumps are

`.github/workflows/backup.yml` dumps `public` and `auth` of the one database with
`pg_dump --format=custom --no-owner --no-acl --schema=public --schema=auth --exclude-table-data='public.analytics_events*'`,
encrypts the file to the committed certificate `app/backup-recipient.pem` and uploads `mop-dev-YYYY-MM-DD.dump.p7m` as
the workflow artifact `mop-dev-dump`, kept 30 days (14 if the Actions storage quota runs short, DB-11). That artifact is
the only copy (ruling H33 (7)); there is no second target (ruling H35 (1)). The workflow only reads, so it is the same
before and after the launch switch. Details of the job: `docs/runbooks/delivery.md`, section "Backup".

On 2026-10-10 `backup.yml` has only a `workflow_dispatch` trigger: the nightly `schedule:` line arrives with B1b step 8
part B1. Until it does, a dump exists only when someone runs `gh workflow run backup.yml -f target=dev`, and the RPO is
the age of the newest green run, not 24 hours.

Find and fetch the newest dump:

```
gh run list --workflow backup.yml --limit 5 --json databaseId,conclusion,createdAt
gh run download <run id> -n mop-dev-dump -D <folder>
```

Measured on 2026-10-10: run 38039559280 was green in 37 seconds and its artifact is 2,877,083 bytes.

## 2. Decrypt

```
openssl cms -decrypt -binary -inform DER -inkey <escrowed private key> -in <folder>/mop-dev-YYYY-MM-DD.dump.p7m -out x.dump
```

The private key is the pair of `app/backup-recipient.pem`. It was made into `creds/backup-recipient.key` (git-ignored) on
the laptop, and it is never in `.env`, `.env.ops` or GitHub (DO-06 (5)). Who holds it: the operator (the CEO), in his
password manager and on a sealed paper copy; until he has made both, the laptop copy is the only one and nobody deletes
it (ruling H55 (3)). The state of the escrow is kept in the key pair table of `docs/runbooks/delivery.md`. The name of
the password manager entry is not recorded here yet (2026-10-10): the operator writes it on this line when he stores
the key. A lost private key makes every dump encrypted to its certificate unreadable. A key that is not the pair fails
with `Error decrypting CMS structure`. `x.dump` holds subscriber emails: keep it in a temporary folder and delete it
after use.

## 3. Restore into a throwaway cluster

This proves a dump is whole and lets you read old rows; it does not bring the site back (section 4 does). No Docker
(S50): the cluster is the native PostgreSQL 18 (`initdb`, `pg_ctl`, `psql`, `pg_restore` on the PATH; on the laptop
from scoop, ASSUMED E7), plus `gh` signed in and `openssl`.

The rehearsal, H1-21:

```
bash scripts/harden/restore-rehearsal.sh <key path>
```

Without an argument it asks for the key path. In order, it:

0. refuses with `refusing: production database` when `settings.environment` is `production` (ruling H35 (5)), because
   step 1 writes a test row;
1. writes the marker row `insert into audit_log (action, entity, note) values ('restore.marker', 'restore', 'h1-restore-<time>')`
   through `bun run db:psql`; `audit_log` is append-only, so the row stays;
2. runs `gh workflow run backup.yml -f target=dev`, waits up to 2 minutes for the new run id, then
   `gh run watch <id> --exit-status`; a red run exits 1 with `restore: backup run failed <id>`;
3. downloads the artifact `mop-dev-dump` of that run into a temporary folder;
4. decrypts it with the key (section 2);
5. makes a cluster there with `initdb`, starts it with `pg_ctl` on a free port and loads `scripts/harden/restore-shims.sql`
   (the roles `anon`, `authenticated`, `service_role`, `supabase_auth_admin`, `supabase_admin` and stubs of
   `app.is_staff()` and `app.role_in(...)`: schema `app` is not in the dump and the policies of `public` call both);
6. runs `pg_restore --no-owner --clean --if-exists --exit-on-error`; the first error exits 2 with
   `restore blocked: <object>`, and the fix goes into `scripts/harden/restore-shims.sql`;
7. compares `scripts/harden/rowcounts.sql` (`properties`, `submissions`, `subscribers`, `audit_log`, `payments`, `jobs`)
   on both sides: `properties`, `submissions`, `subscribers` and `payments` must be equal; `audit_log` and `jobs` keep growing on the one database
   while the backup runs, so there the restored count must not exceed the source count read after the restore; a
   mismatch exits 1 with `restore: count <table> <restored> <source>`;
8. checks that the marker row of step 1 is in the restored cluster exactly once, which proves the dump is the one just
   taken (exit 1 with `restore: marker <note> found <n> times` otherwise);
9. stops the cluster and deletes the folder, on success and on failure.

It prints `restore ok <minutes> minutes`. Shared steps live in `scripts/harden/restore-lib.sh`.

To read rows from an older dump instead, decrypt it (section 2) and follow steps 5 and 6 by hand:

```
initdb -D <folder>/pgdata -U postgres --auth=trust -E UTF8 --locale=C --no-sync
pg_ctl -D <folder>/pgdata -o "-p 55432 -c listen_addresses=127.0.0.1" -l <folder>/pg.log -w start
psql -h 127.0.0.1 -p 55432 -U postgres -c "create database restore"
psql -h 127.0.0.1 -p 55432 -U postgres -d restore -f scripts/harden/restore-shims.sql
pg_restore --no-owner --clean --if-exists -h 127.0.0.1 -p 55432 -U postgres -d restore x.dump
pg_ctl -D <folder>/pgdata -m fast stop
```

## 4. Restore into a Supabase project (existing or new)

The real recovery (DB-11, DO-06). Before L1's launch switch it is rehearsed on the one project by H1-21b. After the
switch that project is production: this section then runs only in an incident, by the owner, `bun run db:reset` refuses
there with `refusing: production database` (ruling H35 (5)), and a fresh project is the path for a destroyed database.

(a) Take a fresh dump of the damaged state first (`gh workflow run backup.yml -f target=dev`). For a new project,
create it in region us-east-1 and run `bunx supabase db push --db-url <new>`, which builds the schema, the migration
history, the pgmq queues and the cron rows from the migrations (F16). For the existing project use `bun run db:reset`
or a fresh project, never `pg_restore --clean`, which cannot drop the `auth` objects `supabase_auth_admin` owns
(DB-11).

(b) Write the data as SQL and load it in one `psql` session that first runs `set session_replication_role = replica`
(no superuser needed, unlike `--disable-triggers`; UNPROVEN on Supabase until H1-21b runs):

```
pg_restore --data-only --schema=public -f public.sql x.dump
pg_restore --data-only -n auth -t users -t identities -f auth.sql x.dump
```

Inside the session, before the load: empty every table of `public` (the migrations seed rows such as `settings`,
which the dump carries too) and, on the existing project, `delete from auth.users` before replica mode, so its
cascades still reach `auth.identities` and the sessions.

(c) Enter the Vault rows again from the inventory below. Vault is not in the dump, and `bun run db:reset` does not
touch it. A secret goes in through standard input or `\getenv`, never on a command line (`docs/runbooks/jobs.md`,
setup 1).

(d) When the project is new: deploy the job runner
(`bunx supabase functions deploy job-runner --use-api --project-ref <new>`, then its function secrets,
`docs/runbooks/jobs.md` setup 2) and swap the Worker's `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` with
`bunx wrangler secret put`. Queued jobs whose pgmq message is missing are picked up by B8's reaper.

(e) Smoke: `select public.public_state()` returns a row, and a light job goes through the deployed runner on its cron
tick (`bun run scripts/job-selftest.ts --light-only`, an `enqueue_job` and `claim_job` round trip).

Vault inventory (the two rows the `job-runner` cron migration reads, and the three names the allow-list of
`get_vault_secret` holds):

| Name                   | Where its value comes from                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `job_runner_url`       | the project ref: `https://<ref>.supabase.co/functions/v1/job-runner`                                                                                       |
| `job_runner_secret`    | `PROD_JOB_RUNNER_SECRET` in `.env.ops` after the launch switch; before it, the job runner's current `JOB_RUNNER_SECRET`; it must equal the function secret |
| `meta_page_token`      | Meta: a new long-lived page token stored from the channels screen (`docs/runbooks/meta.md`)                                                                |
| `x_oauth_token`        | X: connect the channel again on the channels screen (`docs/runbooks/social.md`)                                                                            |
| `linkedin_oauth_token` | LinkedIn: connect the channel again on the channels screen (`docs/runbooks/social.md`)                                                                     |

The drill, H1-21b, before the launch switch only, after the build lanes have closed, by the orchestrator:

```
bash scripts/harden/restore-supabase-drill.sh <key path>
```

It refuses after the switch before any write, takes a fresh dump as in section 3, reads the row counts and the current
`job_runner_secret` (held in memory only), runs `bun run db:reset`, then in one session under the G34 lock removes the
two runner rows from Vault (a new project has none), empties `public` and `auth.users`, sets replica mode, loads both
files and counts; then it enters the two runner rows again, compares the counts by the rule of section 3 step 7 and runs
the smoke of (e). It prints `restore into project ok <minutes> minutes`, or `restore into project blocked: <statement>`
when Supabase refuses a statement; that statement is fixed in this section before launch, never skipped. The three
token rows are left in place: their values come from the vendors, and the drill would cost a reconnect. Afterwards the
orchestrator seeds the project again from `main` (`bun run seed -- --target dev`), as after any reset.

## 5. What is not in the dump

- Every Supabase Storage object, in all three buckets: nothing backs them up (ruling H33 (7)).
  - `media` (public): the published photographs' WebP variants, covers, carousels, stories, reels, posters and Open
    Graph images. A lost object is made again from its source only while the source exists; the uploaded original is
    deleted once its variants exist (H33 (8)), so a lost variant set means asking the submitter for the photographs
    again.
  - `documents` (private): invoice PDFs, made again from their `payments` rows by B6's system job `invoice_pdf` with a
    fresh idempotency key, because `invoice_pdf:<id>` already exists:
    `select enqueue_job('invoice_pdf', '{"params":{},"data":{"payment_id":"<id>"}}', 'invoice_pdf:<id>:restore-<date>')`.
  - `submissions` (private): photographs still staged (prefix `staging/`, G25) or attached to a submission cannot be
    recovered; the submitter is asked again.
- The raw `analytics_events` rows, left out with `--exclude-table-data='public.analytics_events*'` (DB-11); the daily
  aggregates in `analytics_daily` are in the dump.
- The Vault rows, entered again by section 4 (c).
- Schema `app` (its two functions) and the pgmq and cron schemas: section 4 builds them from the migrations.

Gap accepted by the CEO (initials and date): not given yet on 2026-10-10.

## 6. Drill record

| Date       | Drill                                                                                                                                                                         | Minutes | Row counts, restored/source                                                                               | Who           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- | ------------- |
| 2026-10-10 | `scripts/harden/restore-rehearsal.sh` against stand-ins: `gh` replaced by a laptop `pg_dump` of the one database, encrypted to a key pair made for the run; marker found once | 2.2     | properties 17/17, submissions 1158/1158, subscribers 0/0, audit_log 559/559, payments 3/3, jobs 5471/5471 | H1 g6 builder |
| 2026-10-10 | `scripts/harden/restore-supabase-drill.sh` against stand-ins on a native PostgreSQL 18 copy of the dump (stand-in `db:reset`, Vault and selftest)                             | 0.6     | properties 17/17, submissions 1158/1158, subscribers 0/0, audit_log 383/383, payments 3/3, jobs 5382/5382 | H1 g6 builder |

NOT DONE: H1-21 with the escrowed key (the minutes of the real run go here) and H1-21b on the one project (its minutes
go here, against the RTO of 4 hours for the public site and 8 hours for admin and jobs). Both wait on the escrowed key,
and H1-21b on the orchestrator after the build lanes close.
