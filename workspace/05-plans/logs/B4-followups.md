# B4 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 1,2

1. `app/tests/unit/mutation-registry.test.ts` (not blocking)
   - What: Lines 15-18 only scan tests/ for test files. In the same step, vitest.config.ts added src/**/*.test.ts (unit) and src/**/*.test.tsx (component) to the includes, and the STANDARDS folder map allows tests beside code in src/admin (query.test.ts, *.test.ts(x)) and src/components. Any such src test runs in bun run test but no registry entry is ever required for it. That leaves STANDARDS R49 ('every test file has at least one entry', enforced by this file) and gate G18 unenforced for that location. This matches the plan's Files line, which names only tests/**, so it is a plan and STANDARDS mismatch for the orchestrator to settle.
   - Evidence: Read: TEST_FILE = /^tests\/(?:.+\.test\.tsx?|e2e\/[^/]+\.spec\.ts)$/ over readdirSync(join(APP, 'tests')). vitest.config.ts includes 'src/**/*.test.ts' and 'src/**/*.test.tsx'. STANDARDS.md line 58 (src/admin 'Tests beside the code') and line 57. git ls-files 'app/src/**/*.test.ts*' is empty today, so nothing escapes yet.

2. `app/scripts/watchfail.mjs` (not blocking)
   - What: `--only <id>` matches the id in every registry file (line 295), and ids are plan letters shared across slices. Today B1b and B4 both hold `n` and `z`, and B4's later `a` and `d` will collide too. `--only z` replays two entries, so the plan's 'replays it' and P-402's proof ('prints WATCHED-FAIL OK B4:z') are only partly accurate. The log documents this. No `<registry>:<id>` form exists to pick exactly one entry.
   - Evidence: node scripts/watchfail.mjs --registry tests/mutations --only z printed WATCHED-FAIL OK B1b:z and WATCHED-FAIL OK B4:z, replayed 2. An id-collision scan printed n [B1b.json, B4.json] and z [B1b.json, B4.json].

3. `app/vitest.config.ts` (not blocking)
   - What: The new comment on line 4 is false: 'Both setup files run in every unit and component test'. The unit project's setupFiles is only tests/setup/hermetic.ts. dom.ts runs only in component. That breaks STANDARDS C07, because a comment must state why and be true.
   - Evidence: Read: unit setupFiles: ['tests/setup/hermetic.ts']; component setupFiles: ['tests/setup/dom.ts', 'tests/setup/hermetic.ts'].

4. `app/tests/mutations/B2.json` (not blocking)
   - What: The group edited a file outside its named list. The brief's rule is one writer per file. The change is a single-value fix of ss-contract-not-on-main after the replay found it stayed green, and the log discloses it. B2 still has steps 8 to 14 to build in another lane, which will append to this file. The orchestrator should confirm no lane is mid-edit on that entry before merge.
   - Evidence: git diff origin/main...slice/b4 -- app/tests/mutations/B2.json: one line, 20261001090100 -> 20261001090199. Log line 10 states it. The replay of the fixed entry printed WATCHED-FAIL OK.

5. `app/scripts/watchfail.mjs` (not blocking)
   - What: Restore on SIGINT (lines 362-364: the exit handler calls restoreAll, and SIGINT/SIGTERM call process.exit(130)) is UNPROVEN. No test covers it, and on this Windows machine a child.kill('SIGINT') terminates the process without running handlers, so it can only be shown on Linux or with a real console Ctrl-C. The finally path is covered (wf-restore).
   - Evidence: Read: watchfail.test.ts has no signal case. B4.json has no entry mutating the signal or exit wiring.

## g2 · steps 3

1. `app/tests/unit/time-model.test.ts` (not blocking)
   - What: The T-08 detector only sees named imports and re-exports (`import|export {...} from ".../clock"`). If a db, api or e2e file, factories.ts or dataset.ts uses a namespace import (`import * as clock` then `clock.FIXED_NOW` or `clock.at`) or a dynamic `import("../fixtures/clock")`, it gets FIXED_NOW or at past R51 and G19, and the gate stays green. The plan's watched-fail (aa) uses a named import, so it passes. Nothing in the repo uses these forms today, so this is a follow-up: G19 does not cover namespace or dynamic imports.
   - Evidence: Confirmed by running: node scripts/watchfail.mjs --file tests/db/harness.db.test.ts --find 'import setup from "./global-setup";' --replace '...\nimport * as clock from "../fixtures/clock";\nexport const t = clock.FIXED_NOW;' --run "bunx vitest run --project unit tests/unit/time-model.test.ts" --expect harness.db.test.ts gave `WATCHED-FAIL BAD: stayed green`, exit 1.

2. `app/tests/fixtures/builders.ts` (not blocking)
   - What: Line 8 `export type SubscriberInput = z.input<typeof subscriberSchema>` repeats a type that src/domain/contracts.ts:170 already exports under the same name (STANDARDS C05, a second copy). The three exported types InquiryInput, SubmissionInput and SubscriberInput are not imported anywhere outside builders.ts (C04). knip cannot see this because knip.json makes tests/**/*.{ts,tsx} entry files, and knip does not report exports from entry files. Nothing breaks, so this is a follow-up: import SubscriberInput from contracts.ts, and keep the other exports only when an api or e2e test needs them.
   - Evidence: Confirmed by reading: grep -rn "InquiryInput\|SubmissionInput\|SubscriberInput" src tests scripts finds uses only inside builders.ts and the contracts.ts/services/types.ts SubscriberInput; knip.json has "tests/**/*.{ts,tsx}" under entry.

3. `workspace/05-plans/B4.md` (not blocking; this file is not g2's)
   - What: The plan's GQ-03 proof line, `git grep -n "Date.now\|Math.random\|randomUUID" tests/fixtures` prints nothing, can no longer pass, because B2's tests/fixtures/db.ts calls randomUUID (lines 3 and 90). P-404 records this and clock.test.ts skips db.ts, but the plan text still states the impossible condition. The orchestrator should fold P-404 into the plan line.
   - Evidence: Confirmed by running: grep -n "randomUUID\|Date.now\|Math.random" tests/fixtures/*.ts gave tests/fixtures/db.ts:3 and tests/fixtures/db.ts:90.
