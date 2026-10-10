#!/usr/bin/env bash
# `bash scripts/harden/migration-rollback-drill.sh` from app/ (H1-37, GD-07). No Docker (S50): `initdb` makes a throwaway
# cluster in a temp folder from the native PostgreSQL 18 (tools on PATH, or in the folder named by PG_BIN), the shims of
# scripts/harden/pg-shims.sql stand in for Supabase, and every migration applies in order with its `create extension`
# lines left out. `pg_dump --schema-only` records the schema when the chain stands at the newest migration whose
# `-- down:` block is SQL; that block runs and the schema must differ; the file applies again and the schema must
# equal the first dump; the newer migrations then apply on top. Prints each irreversible migration with its reason,
# then `migration rollback ok` and `elapsed <n>s`. The cluster never touches mop-dev. A migration that cannot apply
# on the shims stops the drill naming the file (exit 1).
# PG_DRILL_PORT (default 55477) moves the cluster when that port is taken.
set -euo pipefail

cd "$(dirname "$0")/../.."
PORT="${PG_DRILL_PORT:-55477}"
DIR="supabase/migrations"
SHIMS="scripts/harden/pg-shims.sql"
HEADER_LINES=30
SQL_VERB='^(drop|alter|delete|revoke|grant|update|truncate|select|insert|create|comment)[[:space:]]'

pg() {
  local tool="$1"
  shift
  "${PG_BIN:+$PG_BIN/}$tool" "$@"
}
fail() {
  echo "migration rollback drill: $*" >&2
  exit 1
}

for tool in initdb pg_ctl psql pg_dump pg_isready; do
  if [ -n "${PG_BIN:-}" ]; then
    [ -x "$PG_BIN/$tool" ] || [ -x "$PG_BIN/$tool.exe" ] || fail "$tool not found in PG_BIN"
  else
    command -v "$tool" > /dev/null || fail "$tool not on PATH (native PostgreSQL 18, or set PG_BIN)"
  fi
done

WORK="$(mktemp -d)"
cleanup() {
  pg pg_ctl -D "$WORK/data" -m immediate stop > /dev/null 2>&1 || true
  for _ in 1 2 3 4 5; do
    rm -rf "$WORK" 2> /dev/null && return
    sleep 1
  done
}
trap cleanup EXIT

pg initdb -D "$WORK/data" -U postgres -A trust -E UTF8 > /dev/null
pg pg_ctl -D "$WORK/data" -l "$WORK/pg.log" -o "-p $PORT -c listen_addresses=127.0.0.1 -c fsync=off" start > /dev/null 2>&1 &
for _ in $(seq 1 60); do
  pg pg_isready -h 127.0.0.1 -p "$PORT" -q && break
  sleep 1
done
pg pg_isready -h 127.0.0.1 -p "$PORT" -q || fail "the cluster did not start on port $PORT (see $WORK/pg.log)"

run() {
  PGOPTIONS='-c client_min_messages=warning' pg psql -h 127.0.0.1 -p "$PORT" -U postgres -d mop -X -q -v ON_ERROR_STOP=1 "$@"
}
# pg_dump 18 opens and closes a dump with `\restrict <random key>`, a different key on every run: drop those two lines.
dump() {
  pg pg_dump -h 127.0.0.1 -p "$PORT" -U postgres -d mop --schema-only --no-owner | grep -v '^\\\(un\)\?restrict '
}
# The file without its `create extension` lines: the shims stand in for the extensions.
upfile() {
  grep -vi '^create extension' "$1" > "$WORK/up.sql"
  echo "$WORK/up.sql"
}
# The down block of a migration as SQL: the comment lines from `-- down:` to the first line that is not a comment.
downsql() {
  awk '
    /^-- down:/ { on = 1; sub(/^-- down:[ ]?/, ""); print; next }
    on && /^--/ { sub(/^-- ?/, ""); print; next }
    on { exit }
  ' "$1"
}

pg psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -X -q -c 'create database mop' > /dev/null
run -f "$SHIMS"

# The newest migration whose `-- down:` block is SQL. A newer migration whose down block is a procedure ("re-run ...")
# cannot be run by a script, so the drill goes back to the one before it.
FILES=("$DIR"/*.sql)
drilled=""
for ((i = ${#FILES[@]} - 1; i >= 0; i--)); do
  if downsql "${FILES[$i]}" | tr -d '\r' | sed 's/^[[:space:]]*//' | grep -m 1 . | grep -qiE "$SQL_VERB"; then
    drilled="${FILES[$i]}"
    break
  fi
  echo "down is a procedure, not run: $(basename "${FILES[$i]}")"
done
[ -n "$drilled" ] || fail "no migration has a down block that is SQL"

# A down block undoes its migration on the schema that migration left, so the chain applies up to the drilled file,
# the drill runs there, and the newer files apply on top of the re-applied one.
apply() {
  run -f "$(upfile "$1")" > /dev/null 2> "$WORK/err.txt" || {
    cat "$WORK/err.txt" >&2
    fail "cannot apply $(basename "$1") on the shims"
  }
}
rest=()
for file in "${FILES[@]}"; do
  if [[ "$file" > "$drilled" ]]; then
    rest+=("$file")
  else
    apply "$file"
  fi
done
echo "applied ${#FILES[@]} migrations in order, up to $(basename "$drilled") first"

dump > "$WORK/before.sql"
downsql "$drilled" | run -1 -f - || fail "the down block of $(basename "$drilled") failed"
dump > "$WORK/down.sql"
if cmp -s "$WORK/before.sql" "$WORK/down.sql"; then
  fail "the down block of $(basename "$drilled") changed nothing"
fi
echo "down block of $(basename "$drilled") applied, schema differs"

apply "$drilled"
dump > "$WORK/after.sql"
if ! cmp -s "$WORK/before.sql" "$WORK/after.sql"; then
  diff "$WORK/before.sql" "$WORK/after.sql" | head -n 40 >&2 || true
  fail "the schema after the up block differs from the first dump"
fi
echo "up block applied again, schema equals the first dump"

for file in "${rest[@]}"; do
  apply "$file"
done
echo "newer migrations applied after it: ${#rest[@]}"

echo "irreversible migrations:"
count=0
for file in "${FILES[@]}"; do
  reason="$(head -n "$HEADER_LINES" "$file" | sed -n 's/^-- irreversible: //p' | head -n 1)"
  if [ -n "$reason" ]; then
    echo "  $(basename "$file"): $reason"
    count=$((count + 1))
  fi
done
echo "  ($count in total)"

echo "migration rollback ok"
echo "elapsed ${SECONDS}s"
