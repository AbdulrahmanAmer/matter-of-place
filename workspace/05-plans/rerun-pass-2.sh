#!/usr/bin/env bash
# Second rerun pass (orchestrator, 2026-10-11): rebuild the Worker in live mode, rerun the 13 corrected entries,
# then run H1 step 5's states.spec.ts alone twice on this lane's own preview (port 8898) and once on the dev site.
# Logs: workspace/05-plans/logs/rerun-2026-10-11.log (appended) and logs/rerun-2026-10-11-h1-5-{lane-1,lane-2,dev}.log.
set -u
ROOT="D:/mop-build/rerun"
LOGS="$ROOT/workspace/05-plans/logs"
cd "$ROOT/app" || exit 1
eval "$(node scripts/load-env.mjs --profile dev 2>/dev/null)"

echo "pass 2 build start $(date -Is)" > "$LOGS/rerun-2026-10-11-pass2-build.log"
MSYS_NO_PATHCONV=1 VITE_API_BASE_URL=/api/public VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA bun run build >> "$LOGS/rerun-2026-10-11-pass2-build.log" 2>&1
echo "build exit $?" >> "$LOGS/rerun-2026-10-11-pass2-build.log"

cd "$ROOT" || exit 1
node workspace/05-plans/rerun.mjs --only=B6:6,B6:9,B7:11,B7:11a,B7:12,B7:13,B7:14,B7:15,B7:15a,B7:16,B10:3,B11:1,B11:10

cd "$ROOT/app" || exit 1
for run in lane-1 lane-2; do
  out="$LOGS/rerun-2026-10-11-h1-5-$run.log"
  echo "H1 step 5 isolation $run: E2E_TARGET=built E2E_MODE=live E2E_PORT=8898 bunx playwright test --project=harden tests/e2e/states.spec.ts ($(date -Is))" > "$out"
  E2E_TARGET=built E2E_MODE=live E2E_PORT=8898 timeout 900 bunx playwright test --project=harden --reporter=line tests/e2e/states.spec.ts >> "$out" 2>&1
  echo "exit $?" >> "$out"
done
out="$LOGS/rerun-2026-10-11-h1-5-dev.log"
echo "H1 step 5 isolation dev: E2E_TARGET=url E2E_MODE=live E2E_BASE_URL=https://matter-of-place-dev.holy-meadow-4327.workers.dev bunx playwright test --project=harden tests/e2e/states.spec.ts ($(date -Is))" > "$out"
E2E_TARGET=url E2E_MODE=live E2E_BASE_URL=https://matter-of-place-dev.holy-meadow-4327.workers.dev timeout 900 bunx playwright test --project=harden --reporter=line tests/e2e/states.spec.ts >> "$out" 2>&1
echo "exit $?" >> "$out"
echo "PASS 2 DONE $(date -Is)" >> "$LOGS/rerun-2026-10-11-h1-5-dev.log"
