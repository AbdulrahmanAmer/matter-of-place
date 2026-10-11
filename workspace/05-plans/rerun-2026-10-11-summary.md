# Rerun of accepted steps, 2026-10-11 (two passes)

Pass 1: steps: 83 | pass 62 | fail 14 | skipped 7
Pass 2 (13 corrected entries): steps: 13 | pass 2 | fail 9 | skipped 2

| Slice | Step | Result | Pass | Failing command | Last error line |
| --- | --- | --- | --- | --- | --- |
| B6 | 1 | PASS | 1 | | |
| B6 | 2 | PASS | 1 | | |
| B6 | 3 | PASS | 1 | | |
| B6 | 4 | PASS | 1 | | |
| B6 | 5 | PASS | 1 | | |
| B6 | 6 | FAIL | 2 | `grep -n "B6 invoice approved" .claude/POSITION.md` | |
| B6 | 7 | PASS | 1 | | |
| B6 | 8 | PASS | 1 | | |
| B6 | 9 | PASS | 2 | | |
| B7 | 5 | PASS | 1 | | |
| B7 | 5a | PASS | 1 | | |
| B7 | 6 | PASS | 1 | | |
| B7 | 7 | PASS | 1 | | |
| B7 | 7a | PASS | 1 | | |
| B7 | 8 | PASS | 1 | | |
| B7 | 9 | PASS | 1 | | |
| B7 | 10 | PASS | 1 | | |
| B7 | 11 | FAIL | 2 | `E2E_TARGET=built E2E_DATASET=1 bunx playwright test --project=admin tests/e2e/admin-full-path.spec.ts` | `  1 passed (2.0m)` |
| B7 | 11a | FAIL | 2 | `E2E_TARGET=built E2E_DATASET=1 bunx playwright test --project=admin tests/e2e/admin-full-path.spec.ts` | `  1 passed (1.9m)` |
| B7 | 12 | FAIL | 2 | `E2E_TARGET=built E2E_DATASET=1 bunx playwright test --project=admin tests/e2e/admin-full-path.spec.ts` | `  1 passed (2.0m)` |
| B7 | 13 | FAIL | 2 | `E2E_TARGET=built E2E_DATASET=1 bunx playwright test --project=admin tests/e2e/admin-full-path.spec.ts` | `  1 passed (2.0m)` |
| B7 | 14 | FAIL | 2 | `E2E_TARGET=built E2E_DATASET=1 bunx playwright test --project=admin tests/e2e/admin-full-path.spec.ts` | `  1 passed (1.8m)` |
| B7 | 15 | FAIL | 2 | `E2E_TARGET=built E2E_DATASET=1 bunx playwright test --project=admin tests/e2e/admin-full-path.spec.ts` | `  1 passed (1.8m)` |
| B7 | 15a | FAIL | 2 | `E2E_TARGET=built E2E_DATASET=1 bunx playwright test --project=admin tests/e2e/admin-full-path.spec.ts` | `  1 passed (2.3m)` |
| B7 | 16 | FAIL | 2 | `E2E_TARGET=built E2E_DATASET=1 bunx playwright test --project=admin tests/e2e/admin-full-path.spec.ts` | `  1 passed (2.5m)` |
| B8 | 9 | PASS | 1 | | |
| B8 | 10 | PASS | 1 | | |
| B8 | 10a | PASS | 1 | | |
| B8b | 6 | PASS | 1 | | |
| B8b | 7 | PASS | 1 | | |
| B8b | 8 | PASS | 1 | | |
| B8b | 9 | PASS | 1 | | |
| B8b | 10 | PASS | 1 | | |
| B9 | 10 | PASS | 1 | | |
| B9 | 11 | PASS | 1 | | |
| B10 | 0 | PASS | 1 | | |
| B10 | 3 | PASS | 2 | | |
| B10 | 4 | PASS | 1 | | |
| B10 | 5 | PASS | 1 | | |
| B10 | 5a | PASS | 1 | | |
| B10 | 6 | PASS | 1 | | |
| B10 | 8 | PASS | 1 | | |
| B10 | 9 | PASS | 1 | | |
| B10 | 10 | PASS | 1 | | |
| B11 | 1 | SKIPPED | 2 | | needs psql: no psql is installed on this laptop (the only psql.exe on disk, D:/mop-build/h1g7/app/.tmp/bin, is H1 step 9's stand-in, not a client) |
| B11 | 2 | PASS | 1 | | |
| B11 | 3 | PASS | 1 | | |
| B11 | 4 | PASS | 1 | | |
| B11 | 5 | PASS | 1 | | |
| B11 | 6 | PASS | 1 | | |
| B11 | 7 | PASS | 1 | | |
| B11 | 8 | SKIPPED | 1 | | needs quiet (fence rollback-drill\|restore-rehearsal\|(retention\|rotation\|inciden) |
| B11 | 9 | PASS | 1 | | |
| B11 | 10 | SKIPPED | 2 | | needs quiet: the plan's step 10 proof enables the digest schedule on mop-dev, waits for the queue_digest job and restores the schedule (writes) |
| B11 | 11 | PASS | 1 | | |
| B11 | 12 | PASS | 1 | | |
| B11 | 13 | PASS | 1 | | |
| B13 | 8 | PASS | 1 | | |
| B13 | 9 | PASS | 1 | | |
| B13 | 10 | PASS | 1 | | |
| B13 | 11 | PASS | 1 | | |
| B13 | 12 | PASS | 1 | | |
| B13 | 13 | PASS | 1 | | |
| B14 | 4 | PASS | 1 | | |
| B14 | 5 | PASS | 1 | | |
| B16 | 3 | PASS | 1 | | |
| B16 | 4 | PASS | 1 | | |
| B16 | 5 | PASS | 1 | | |
| B16 | 6 | PASS | 1 | | |
| B16 | 7 | PASS | 1 | | |
| B16 | 8 | PASS | 1 | | |
| B17 | 8 | PASS | 1 | | |
| B17 | 9 | PASS | 1 | | |
| B17 | 10 | SKIPPED | 1 | | needs quiet (fence <[^>\s]+>\|^workflow_dispatch$) |
| B17 | 12 | SKIPPED | 1 | | (no command found) |
| H1 | 4 | SKIPPED | 1 | | needs quiet (fence <[^>\s]+>\|^workflow_dispatch$) |
| H1 | 5 | FAIL | 1 | `bunx playwright test --project=harden tests/e2e/states.spec.ts` | `  2 passed (55.9s)` |
| H1 | 6 | SKIPPED | 1 | | needs quiet (fence rollback-drill\|restore-rehearsal\|(retention\|rotation\|inciden) |
| H1 | 6b | PASS | 1 | | |
| H1 | 7 | SKIPPED | 1 | | needs quiet (fence rollback-drill\|restore-rehearsal\|(retention\|rotation\|inciden) |
| H1 | 8 | PASS | 1 | | |
| H1 | 9 | PASS | 1 | | |
| H1 | 10 | SKIPPED | 1 | | needs quiet (fence \brun-all\.mjs\b(?![^\n]*--only)) |

## H1 step 5 isolation
H1 step 5 isolation lane-1: E2E_TARGET=built E2E_MODE=live E2E_PORT=8898 bunx playwright test --project=harden tests/e2e/states.spec.ts -> 5 passed (10.3s), exit 0; first failing assertion: none (no test failed)
H1 step 5 isolation lane-2: E2E_TARGET=built E2E_MODE=live E2E_PORT=8898 bunx playwright test --project=harden tests/e2e/states.spec.ts -> 5 passed (9.9s), exit 0; first failing assertion: none (no test failed)
H1 step 5 isolation dev: E2E_TARGET=url E2E_MODE=live E2E_BASE_URL=https://matter-of-place-dev.holy-meadow-4327.workers.dev bunx playwright test --project=harden tests/e2e/states.spec.ts -> 5 passed (10.7s), exit 0; first failing assertion: none (no test failed)

Counts after pass 2: PASS 64, FAIL 10, SKIPPED 9
