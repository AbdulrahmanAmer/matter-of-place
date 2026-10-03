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
