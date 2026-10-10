#!/usr/bin/env bash
# `bash scripts/harden/rollback-drill.sh` from app/ (H1-22, GD-07). Rolls a throwaway Worker back and measures how long
# the old answer takes to return. Run it from the owner's shell with CLOUDFLARE_API_TOKEN (the local `mop-admin` token)
# and CLOUDFLARE_ACCOUNT_ID exported; it never touches `matter-of-place`, the Worker name is fixed below.
#   1. build, then deploy v1 as `mop-drill` from the built config with its cron trigger removed
#      (scripts/preview-no-cron.mjs), so the drill adds no trigger to the account;
#   2. write `.output/public/__drill.txt` containing `v2` and deploy again: a static asset needs no database and no
#      secret, so the drill Worker never reads `public_state()`; wait until the live address prints `v2`;
#   3. `wrangler rollback` (to the previous version, or to ROLLBACK_VERSION when it is set) and poll until the same
#      address answers 404 or 500 instead of `v2`, counting the seconds from the start of the rollback command. Version
#      1 has no database or secret and answered 500 for the unknown path (measured 2026-10-10, cause not
#      investigated); 404 is accepted too, in case a build answers with its own 404 page (not observed);
#   4. delete the Worker. Any failure still deletes it and exits non-zero.
# Prints `deployed v2 marker ok`, `rollback ok` and `elapsed <n>s`.
set -euo pipefail

cd "$(dirname "$0")/../.."
readonly NAME="mop-drill"
readonly URL="https://mop-drill.holy-meadow-4327.workers.dev/__drill.txt"
readonly CONFIG=".output/server/wrangler.drill.json"
readonly MARKER=".output/public/__drill.txt"
readonly WAIT_SECONDS=180

[ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] ||
  {
    echo "rollback drill: export CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID first (the local mop-admin token)" >&2
    exit 1
  }

deployed=0
cleanup() {
  rm -f "$MARKER"
  if [ "$deployed" -eq 1 ]; then
    bunx wrangler delete --name "$NAME" --force || echo "rollback drill: delete $NAME by hand: bunx wrangler delete --name $NAME --force" >&2
  fi
}
trap cleanup EXIT

# Polls $URL until its body or its status code matches the pattern $2, for at most WAIT_SECONDS, and prints it.
wait_for() {
  local what="$1" want="$2" got="" start
  start="$(date +%s)"
  while [ $(($(date +%s) - start)) -lt "$WAIT_SECONDS" ]; do
    if [ "$what" = "body" ]; then
      got="$(curl -s "$URL" || true)"
    else
      got="$(curl -s -o /dev/null -w '%{http_code}' "$URL" || true)"
    fi
    if [[ "$got" =~ $want ]]; then
      echo "$got"
      return 0
    fi
    sleep 1
  done
  echo "rollback drill: $URL did not give $what matching $want in ${WAIT_SECONDS}s (last: $got)" >&2
  return 1
}

bun run build
node scripts/preview-no-cron.mjs .output/server/wrangler.json "$CONFIG"

deployed=1
bunx wrangler deploy --config "$CONFIG" --name "$NAME"
printf 'v2\n' > "$MARKER"
bunx wrangler deploy --config "$CONFIG" --name "$NAME"
wait_for body "^v2$" > /dev/null
echo "deployed v2 marker ok"

started="$(date +%s)"
bunx wrangler rollback ${ROLLBACK_VERSION:+"$ROLLBACK_VERSION"} --name "$NAME" --message h1-drill --yes
status_after="$(wait_for status "^(404|500)$")"
echo "answer after rollback: $status_after"
echo "rollback ok"
echo "elapsed $(($(date +%s) - started))s"

bunx wrangler delete --name "$NAME" --force
deployed=0
