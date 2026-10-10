#!/usr/bin/env bash
# `bash scripts/harden/restore-rehearsal.sh [<key path>]` with the dev profile loaded (H1-21, plan H1 step 6). Restores
# a fresh backup.yml dump of the one database into a throwaway native PostgreSQL 18 cluster (no Docker, S50) and proves
# it: a marker row written just before the dump is in it, and the row counts match the source. Prints
# `restore ok <minutes> minutes`. Exit 1: refused, no key file, a failed backup run or decrypt, a count or marker
# mismatch. Exit 2: pg_restore stopped (`restore blocked: <object>`); the fix goes into pg-shims.sql. Any other failing
# command stops it with its own exit code (set -e). docs/runbooks/restore.md section 3.
set -euo pipefail

START=$(date +%s)
APP=$(cd "$(dirname "$0")/../.." && (pwd -W 2> /dev/null || pwd))
cd "$APP"
# (0) The marker below is a test row, so a production database is refused first (ruling H35 (5)).
bun -e "await (await import('./scripts/lib/assert-not-production.mjs')).assertNotProduction({ dbUrl: process.env.DEV_DB_URL })"
# shellcheck source=scripts/harden/restore-lib.sh
. "$APP/scripts/harden/restore-lib.sh"
KEY=$(restore_key "${1:-}")

TMP=$(mktemp -d)
# Native tools (initdb, pg_ctl, psql, openssl) get the Windows form of the folder (P-013).
DIR=$(cygpath -m "$TMP" 2> /dev/null || printf '%s' "$TMP")
PGDATA_DIR="$DIR/pgdata"
cleanup() {
  if [ -f "$PGDATA_DIR/postmaster.pid" ]; then
    pg_ctl -D "$PGDATA_DIR" -m fast -w stop > /dev/null || echo "restore: pg_ctl stop failed for $PGDATA_DIR" >&2
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

# (1) The marker: audit_log is append-only, so the row stays on mop-dev (actor null, as scripts/audit-note.ts writes).
MARK="h1-restore-$(date -u +%Y%m%dT%H%M%SZ)"
restore_dev_psql -c "insert into audit_log (action, entity, note) values ('restore.marker', 'restore', '$MARK') returning id" > /dev/null

# (2) to (4) A fresh backup run, its artifact, decrypted with the escrowed key.
restore_fetch "$KEY" "$DIR"

# (5) A throwaway cluster on a free port, with the stand-ins for what Supabase provides outside the dump.
PORT=$(node -e "const s = require('node:net').createServer().listen(0, '127.0.0.1', () => { process.stdout.write(String(s.address().port)); s.close(); })")
initdb -D "$PGDATA_DIR" -U postgres --auth=trust -E UTF8 --locale=C --no-sync > "$DIR/initdb.log"
pg_ctl -D "$PGDATA_DIR" -o "-p $PORT -c listen_addresses=127.0.0.1" -l "$DIR/pg.log" -w start > /dev/null 2>&1 < /dev/null
LOCAL=(-h 127.0.0.1 -p "$PORT" -U postgres)
restore_psql "${LOCAL[@]}" -c "create database restore" > /dev/null
restore_psql "${LOCAL[@]}" -d restore -f "$APP/scripts/harden/pg-shims.sql" > /dev/null

# (6) The first pg_restore error stops the rehearsal and names the object it was creating or loading.
if ! pg_restore --no-owner --clean --if-exists --exit-on-error --verbose "${LOCAL[@]}" -d restore "$DIR/x.dump" 2> "$DIR/restore.log"; then
  object=$(awk '/^pg_restore: error:/ { print (last == "" ? substr($0, 20) : last); exit } /^pg_restore: (creating|processing data for table) / { last = substr($0, 13) }' "$DIR/restore.log")
  echo "restore blocked: $object"
  exit 2
fi

# (7) The restored counts against the source counts read now.
RESTORED=$(restore_psql "${LOCAL[@]}" -d restore -F ' ' -f "$APP/scripts/harden/rowcounts.sql")
SOURCE=$(restore_dev_psql -F ' ' -f "$APP/scripts/harden/rowcounts.sql")
restore_compare "$RESTORED" "$SOURCE"

# (8) The marker proves the dump is the one just taken.
found=$(restore_psql "${LOCAL[@]}" -d restore -c "select count(*) from audit_log where note = '$MARK'")
if [ "$found" != 1 ]; then
  echo "restore: marker $MARK found $found times"
  exit 1
fi

echo "restore ok $(awk -v s="$START" -v e="$(date +%s)" 'BEGIN { printf "%.1f", (e - s) / 60 }') minutes"
