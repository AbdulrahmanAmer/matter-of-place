# Rerun of accepted steps, 2026-10-11

steps: 83 | pass 62 | fail 14 | skipped 7

| Slice | Step | Result | Failing command | Last error line |
| --- | --- | --- | --- | --- |
| B6 | 1 | PASS | | |
| B6 | 2 | PASS | | |
| B6 | 3 | PASS | | |
| B6 | 4 | PASS | | |
| B6 | 5 | PASS | | |
| B6 | 6 | FAIL | `grep -n "B6 invoice approved" .claude/POSITION.md` | `grep: .claude/POSITION.md: No such file or directory` |
| B6 | 7 | PASS | | |
| B6 | 8 | PASS | | |
| B6 | 9 | FAIL | `E2E_TARGET=dev bunx playwright test --project admin tests/e2e/admin-invoice.spec.ts` | `    at _Command.<anonymous> (D:\mop-build\rerun\app\node_modules\playwright\lib\program.js:55:7)` |
| B7 | 5 | PASS | | |
| B7 | 5a | PASS | | |
| B7 | 6 | PASS | | |
| B7 | 7 | PASS | | |
| B7 | 7a | PASS | | |
| B7 | 8 | PASS | | |
| B7 | 9 | PASS | | |
| B7 | 10 | PASS | | |
| B7 | 11 | FAIL | `E2E_TARGET=built E2E_DATASET=1 bunx playwright test --project admin tests/e2e/admin-full-path.spec.ts` | `    at _Command.<anonymous> (D:\mop-build\rerun\app\node_modules\playwright\lib\program.js:55:7)` |
| B7 | 11a | FAIL | `E2E_TARGET=built E2E_DATASET=1 bunx playwright test --project admin tests/e2e/admin-full-path.spec.ts` | `    at _Command.<anonymous> (D:\mop-build\rerun\app\node_modules\playwright\lib\program.js:55:7)` |
| B7 | 12 | FAIL | `E2E_TARGET=built E2E_DATASET=1 bunx playwright test --project admin tests/e2e/admin-full-path.spec.ts` | `    at _Command.<anonymous> (D:\mop-build\rerun\app\node_modules\playwright\lib\program.js:55:7)` |
| B7 | 13 | FAIL | `E2E_TARGET=built E2E_DATASET=1 bunx playwright test --project admin tests/e2e/admin-full-path.spec.ts` | `    at _Command.<anonymous> (D:\mop-build\rerun\app\node_modules\playwright\lib\program.js:55:7)` |
| B7 | 14 | FAIL | `E2E_TARGET=built E2E_DATASET=1 bunx playwright test --project admin tests/e2e/admin-full-path.spec.ts` | `    at _Command.<anonymous> (D:\mop-build\rerun\app\node_modules\playwright\lib\program.js:55:7)` |
| B7 | 15 | FAIL | `E2E_TARGET=built E2E_DATASET=1 bunx playwright test --project admin tests/e2e/admin-full-path.spec.ts` | `    at _Command.<anonymous> (D:\mop-build\rerun\app\node_modules\playwright\lib\program.js:55:7)` |
| B7 | 15a | FAIL | `E2E_TARGET=built E2E_DATASET=1 bunx playwright test --project admin tests/e2e/admin-full-path.spec.ts` | `    at _Command.<anonymous> (D:\mop-build\rerun\app\node_modules\playwright\lib\program.js:55:7)` |
| B7 | 16 | FAIL | `E2E_TARGET=built E2E_DATASET=1 bunx playwright test --project admin tests/e2e/admin-full-path.spec.ts` | `    at _Command.<anonymous> (D:\mop-build\rerun\app\node_modules\playwright\lib\program.js:55:7)` |
| B8 | 9 | PASS | | |
| B8 | 10 | PASS | | |
| B8 | 10a | PASS | | |
| B8b | 6 | PASS | | |
| B8b | 7 | PASS | | |
| B8b | 8 | PASS | | |
| B8b | 9 | PASS | | |
| B8b | 10 | PASS | | |
| B9 | 10 | PASS | | |
| B9 | 11 | PASS | | |
| B10 | 0 | PASS | | |
| B10 | 3 | FAIL | `tests/fixtures/graph/` | `/usr/bin/bash: line 2: tests/fixtures/graph/: Is a directory` |
| B10 | 4 | PASS | | |
| B10 | 5 | PASS | | |
| B10 | 5a | PASS | | |
| B10 | 6 | PASS | | |
| B10 | 8 | PASS | | |
| B10 | 9 | PASS | | |
| B10 | 10 | PASS | | |
| B11 | 1 | FAIL | `bun run db:psql -- -c "select count(*) from subscribers where confirmed_at is not null;"` | `error: script "db:psql" exited with code 1` |
| B11 | 2 | PASS | | |
| B11 | 3 | PASS | | |
| B11 | 4 | PASS | | |
| B11 | 5 | PASS | | |
| B11 | 6 | PASS | | |
| B11 | 7 | PASS | | |
| B11 | 8 | SKIPPED | | needs quiet (fence rollback-drill\|restore-rehearsal\|(retention\|rotation\|inciden) |
| B11 | 9 | PASS | | |
| B11 | 10 | FAIL | `select type from events where type = 'digest.due' order by at desc limit 1;` | `` /usr/bin/bash: -c: line 2: `select type from events where type = 'digest.due' order by at desc limit 1;' `` |
| B11 | 11 | PASS | | |
| B11 | 12 | PASS | | |
| B11 | 13 | PASS | | |
| B13 | 8 | PASS | | |
| B13 | 9 | PASS | | |
| B13 | 10 | PASS | | |
| B13 | 11 | PASS | | |
| B13 | 12 | PASS | | |
| B13 | 13 | PASS | | |
| B14 | 4 | PASS | | |
| B14 | 5 | PASS | | |
| B16 | 3 | PASS | | |
| B16 | 4 | PASS | | |
| B16 | 5 | PASS | | |
| B16 | 6 | PASS | | |
| B16 | 7 | PASS | | |
| B16 | 8 | PASS | | |
| B17 | 8 | PASS | | |
| B17 | 9 | PASS | | |
| B17 | 10 | SKIPPED | | needs quiet (fence <[^>\s]+>\|^workflow_dispatch$) |
| B17 | 12 | SKIPPED | | (no command found) |
| H1 | 4 | SKIPPED | | needs quiet (fence <[^>\s]+>\|^workflow_dispatch$) |
| H1 | 5 | FAIL | `bunx playwright test --project=harden tests/e2e/states.spec.ts` | `  2 passed (55.9s)` |
| H1 | 6 | SKIPPED | | needs quiet (fence rollback-drill\|restore-rehearsal\|(retention\|rotation\|inciden) |
| H1 | 6b | PASS | | |
| H1 | 7 | SKIPPED | | needs quiet (fence rollback-drill\|restore-rehearsal\|(retention\|rotation\|inciden) |
| H1 | 8 | PASS | | |
| H1 | 9 | PASS | | |
| H1 | 10 | SKIPPED | | needs quiet (fence \brun-all\.mjs\b(?![^\n]*--only)) |

Counts: PASS 62, FAIL 14, SKIPPED 7
