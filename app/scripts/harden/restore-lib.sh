# Sourced by restore-rehearsal.sh and restore-supabase-drill.sh (H1 steps 6 and 6b): the escrowed key's path, a fresh
# backup.yml dump of the one database, decrypted, and the row-count comparison. The caller runs under `set -euo pipefail`.

# psql on Windows ends its lines with CRLF, so every captured answer drops the CR.
# restore_psql <psql arguments>: a local cluster. restore_dev_psql <psql arguments>: the one database, DEV_DB_URL.
restore_psql() {
  psql -v ON_ERROR_STOP=1 -qAt "$@" | tr -d '\r'
}
restore_dev_psql() {
  bun run db:psql -- -v ON_ERROR_STOP=1 -qAt "$@" | tr -d '\r'
}

# restore_compare <restored> <source>: `<table> <count>` lines of rowcounts.sql. audit_log and jobs keep growing on
# mop-dev while the backup runs, so for them the restored count must not exceed the source count read after the
# restore; every other table must be equal. A mismatch, a missing count or an empty side exits 1; a match prints
# `counts restored/source: <table> <n>/<m> ...` for the drill record.
restore_compare() {
  local restored=$1 source=$2 table n m line=""
  if [ -z "$restored" ] || [ "$(wc -l <<< "$restored")" != "$(wc -l <<< "$source")" ]; then
    echo "restore: row counts differ in shape: restored [$restored] source [$source]"
    exit 1
  fi
  while read -r table n; do
    m=$(awk -v t="$table" '$1 == t { print $2 }' <<< "$source")
    line="$line $table $n/${m:-missing}"
    case "$table" in
      audit_log | jobs) [ "$n" -le "$m" ] 2> /dev/null && continue ;;
      *) [ "$n" -eq "$m" ] 2> /dev/null && continue ;;
    esac
    echo "restore: count $table $n ${m:-missing}"
    exit 1
  done <<< "$restored"
  echo "counts restored/source:$line"
}

# restore_key <argument>: the path of the escrowed private key, from the argument or else a prompt; never from .env
# (DO-06 (5)). Prints the path.
restore_key() {
  local key=$1
  if [ -z "$key" ]; then
    read -r -p "path of the escrowed private key (creds/backup-recipient.key): " key
  fi
  if [ ! -f "$key" ]; then
    echo "restore: no key file at '$key'" >&2
    exit 1
  fi
  printf '%s\n' "$key"
}

# restore_fetch <key> <folder>: runs backup.yml on target dev, waits for that run, downloads its artifact mop-dev-dump
# and decrypts it to <folder>/x.dump.
restore_fetch() {
  local key=$1 dir=$2 before id p7m
  before=$(gh run list --workflow backup.yml --limit 1 --json databaseId --jq '.[0].databaseId // 0')
  gh workflow run backup.yml -f target=dev > /dev/null
  # The dispatch returns before its run exists, so the newest id is read again until it changes.
  id=$before
  for _ in $(seq 1 40); do
    sleep 3
    id=$(gh run list --workflow backup.yml --limit 1 --json databaseId --jq '.[0].databaseId // 0')
    [ "$id" != "$before" ] && break
  done
  if [ "$id" = "$before" ]; then
    echo "restore: backup run did not start within 2 minutes"
    exit 1
  fi
  if ! gh run watch "$id" --exit-status > /dev/null; then
    echo "restore: backup run failed $id"
    exit 1
  fi
  gh run download "$id" -n mop-dev-dump -D "$dir/download"
  p7m=$(ls "$dir"/download/*.dump.p7m)
  # A key that is not the pair of app/backup-recipient.pem fails here (`Error decrypting CMS structure`).
  if ! openssl cms -decrypt -binary -inform DER -inkey "$key" -in "$p7m" -out "$dir/x.dump" 2> "$dir/decrypt.log"; then
    echo "restore: decrypt failed with $key: $(head -n 1 "$dir/decrypt.log")"
    exit 1
  fi
}
