#!/usr/bin/env bash
# `bash scripts/harden/restore-supabase-drill.sh [<key path>]` with the dev profile loaded (H1-21b, plan H1 step 6b).
# Rehearses docs/runbooks/restore.md section 4 on the one project, before L1's launch switch only (ruling H35 (9)): a
# fresh backup.yml dump, the row counts, `bun run db:reset`, the data-only restore of public and of auth.users and
# auth.identities in one psql session under `session_replication_role = replica`, the job runner's Vault rows emptied
# and entered again as a new project needs them, the counts compared, then the smoke (`public_state()` and
# job-selftest.ts --light-only). Prints `restore into project ok <minutes> minutes`; a statement Supabase refuses
# prints `restore into project blocked: <statement>`. A refusal or a blocked step exits 1; any other failing command
# stops the drill with its own exit code (set -e).
set -euo pipefail

START=$(date +%s)
# The Windows form of the folder under Git Bash (P-013): psql reads it inside the session file, where nothing converts it.
APP=$(cd "$(dirname "$0")/../.." && (pwd -W 2> /dev/null || pwd))
cd "$APP"
# After the launch switch this refuses before any write (ruling H35 (5), (9)).
bun -e "await (await import('./scripts/lib/assert-not-production.mjs')).assertNotProduction({ dbUrl: process.env.DEV_DB_URL })"
# shellcheck source=scripts/harden/restore-lib.sh
. "$APP/scripts/harden/restore-lib.sh"
KEY=$(restore_key "${1:-}")

TMP=$(mktemp -d)
DIR=$(cygpath -m "$TMP" 2> /dev/null || printf '%s' "$TMP")
trap 'rm -rf "$TMP"' EXIT

blocked() {
  echo "restore into project blocked: $1"
  exit 1
}

restore_fetch "$KEY" "$DIR"
pg_restore --data-only --schema=public -f "$DIR/public.sql" "$DIR/x.dump"
pg_restore --data-only -n auth -t users -t identities -f "$DIR/auth.sql" "$DIR/x.dump"

# Read before anything is emptied: the counts, and the runner's bearer, which section 4 (c) takes from .env.ops on a
# new project and which this drill holds in memory only.
SOURCE=$(restore_dev_psql -F ' ' -f "$APP/scripts/harden/rowcounts.sql")
JOB_RUNNER_SECRET=$(restore_dev_psql -c "select decrypted_secret from vault.decrypted_secrets where name = 'job_runner_secret'")
[ -n "$JOB_RUNNER_SECRET" ] || blocked "no job_runner_secret in Vault to enter again"
export JOB_RUNNER_SECRET

bun run db:reset || blocked "bun run db:reset"

# One session under the G34 lock. db:reset leaves Vault as it was, so the two rows the job runner's cron reads are
# removed here, as a new project lacks them, and section 4 (c) below enters them again. The migrations' seed rows are
# emptied with the rest of public; auth.users is emptied before replica mode, so its cascades still reach identities
# and sessions.
cat > "$DIR/restore.sql" << SQL
\set VERBOSITY terse
select pg_advisory_lock(hashtext('mop-dev-tests'));
begin;
delete from vault.secrets where name in ('job_runner_url', 'job_runner_secret');
select format('truncate table %s', string_agg(format('%I.%I', schemaname, tablename), ', ')) from pg_tables where schemaname = 'public'
\gexec
delete from auth.users;
set session_replication_role = replica;
\i '$DIR/public.sql'
\i '$DIR/auth.sql'
\o '$DIR/restored.txt'
\i '$APP/scripts/harden/rowcounts.sql'
\o
commit;
SQL
if ! restore_dev_psql -F ' ' --echo-errors -f "$DIR/restore.sql" > /dev/null 2> "$DIR/restore.log"; then
  # The statement --echo-errors printed after the first error, with the error; a psql error has no statement.
  blocked "$(tr -d '\r' < "$DIR/restore.log" | awk '
    e == "" && /^psql:.*:[0-9]+: (ERROR|error): / { e = $0; sub(/^psql:.*:[0-9]+: (ERROR|error): +/, "", e); next }
    e != "" { if (/STATEMENT: /) { sub(/^.*STATEMENT: +/, ""); e = $0 " (" e ")" } exit }
    END { print e }')"
fi
restore_compare "$(tr -d '\r' < "$DIR/restored.txt")" "$SOURCE"

# Section 4 (c): the runner's Vault rows entered again; the bearer reaches psql through \getenv, never on a command
# line.
restore_dev_psql > /dev/null << SQL || blocked "the Vault rows job_runner_url and job_runner_secret"
\getenv secret JOB_RUNNER_SECRET
select pg_advisory_lock(hashtext('mop-dev-tests'));
select vault.create_secret('https://$DEV_SUPABASE_PROJECT_REF.supabase.co/functions/v1/job-runner', 'job_runner_url');
select vault.create_secret(:'secret', 'job_runner_secret');
SQL

# Section 4 (e): the public read, then a light job taken by the deployed runner on its cron tick.
[ "$(restore_dev_psql -c "select public.public_state() is not null")" = t ] || blocked "select public.public_state()"
bun run scripts/job-selftest.ts --light-only || blocked "job-selftest.ts --light-only"

echo "restore into project ok $(awk -v s="$START" -v e="$(date +%s)" 'BEGIN { printf "%.1f", (e - s) / 60 }') minutes"
