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

## g3 · steps 5

1. `app/tests/e2e/fixtures/routes.ts` (not blocking; cross-slice, for the orchestrator)
   - What: Cross-slice follow-up for the orchestrator. routeFileCoverage maps today's route names (index.tsx, about.tsx, ...). B4's own Files line expects the `_site.` names of B3 step 1b, but B3.md never names tests/e2e/fixtures/routes.ts or routes-covered.test.ts. Whichever of B3 and B4 merges second will turn routes-covered red, in a file the B3 lane does not own. The author declared this UNPROVEN. The orchestrator should add routes.ts to B3 step 1b's Change list or sequence the merges.
   - Evidence: `grep -n 'fixtures/routes.ts|routes-covered' workspace/05-plans/B3.md` prints nothing. `ls app/src/routes` shows no `_site.` files.

2. `app/scripts/e2e-coming-soon.ts` (not blocking)
   - What: Suspected by reading, not run. Line 31 is `playwright?.kill(signal)` and the spawn uses `shell: true`. On Windows that signals the cmd.exe wrapper, not the Playwright process tree, so a SIGTERM delivered to this script alone could leave Playwright running while the flag is restored underneath it. The restore in finally still runs. The author already lists the signal path as UNPROVEN. Exercise it once B3b's spec exists.
   - Evidence: Code reading of lines 27-46 (spawn with shell: true, kill(signal) on the child handle). Not reproduced.

3. `app/tests/mutations/B4.json` (not blocking)
   - What: Watched-fail (v) cannot show the plan's 'exits 1' half, because with no coming-soon spec Playwright already exits 1 ('No tests found'). Only the 'restored to true' text separates red from green, and it was proved against a stand-in PostgREST the author wrote. Rerun (v) and the db:psql read-back on the real settings table once B2's migration and B3b's spec land. It is UNPROVEN against mop-dev until then.
   - Evidence: Entry v: run 'E2E_TARGET=built E2E_MODE=live bun run test:e2e:coming-soon', expect 'coming_soon_global restored to true', kind manual. The rerun against mop-dev shows the settings table count is 0.

## g4 · steps 4

1. `app/tests/unit/analytics.test.ts` (not blocking)
   - What: The line 2 comment says 'The beacon half (queue, flush, batch size) is analytics-batch.test.ts', but that file does not exist on main or on this branch. B3 creates it later. For now the comment points at nothing, and the current beacon path (sendBeacon in track) has no test.
   - Evidence: `ls app/tests/unit/analytics-batch.test.ts` -> No such file or directory.

2. `workspace/05-plans/B4.md` (not blocking)
   - What: Stale plan lines (the orchestrator's to fix; the author already banked them as P-414). The Files list says '10x10 expected matrix' and 'each name in B3's analyticsEvents'. Main has 11 states (Withdrawn, DL-04) and no analyticsEvents yet. The 11x11 matrix agrees with diagram 1 plus F16, DL-09 and DL-04, and with B2 invariant 5. The plan text does not.
   - Evidence: plan-brief output for step 4 quotes '10x10'. src/domain/workflow.ts lists 11 keys in submissionTransitions. git grep analyticsEvents -- app finds nothing.

3. `app/tests/mutations/B4.json` (not blocking)
   - What: UNPROVEN, as the author says: the CI db job has not replayed the new unit entries because no pull request is open yet. Everything was replayed locally only.
   - Evidence: Author's unproven list. No PR run exists to check.

Follow-ups whose file is GOTCHAS.md are banked, not listed here: P-416 (a recurrence went into a new entry), P-417 (P-414 claims B3 updates `analytics.test.ts`, which B3.md never names), P-418 (`watchfail.mjs --only d` replays three registries). For P-417 the orchestrator decides: add the file to B3's Files list or drop the claim from P-414. For P-418 the orchestrator decides whether the runner accepts a slice-qualified id.

## g5 · steps 6

1. `app/src/hooks/use-modal.ts` (not blocking)
   - What: This file is outside the group's file list, which breaks the one-writer rule. The change was needed: without it the H38 (7) focus cases cannot pass. It is logged and banked as P-420. The plan has not caught up: the B4.md Files list does not name use-modal.ts, and watched-fail (hh) still says to drop a key handler in search-overlay.tsx, which has none (Escape is the useModal call in header.tsx:36). The orchestrator should fold both lines into the plan. Suspected by reading: the hook reads and writes opener.current during render (lines 16-18). React allows that only for initialization. If a render is thrown away after open turns true, opener.current keeps a stale element and no later open replaces it. Nothing in this app opens an overlay in a transition today, so no concrete input triggers this now.
   - Evidence: git diff origin/main...HEAD --stat lists app/src/hooks/use-modal.ts, and the brief's --files list does not. The watched-fail hh-focus replay went red as it should (WATCHED-FAIL OK R:hh-focus), so the fix works in the built artifact.

2. `app/tests/mutations/B4.json` (not blocking)
   - What: The seven new entries (i, j, cc, hh, hh-focus, cc-post, rd) are all kind manual. scripts/watchfail.mjs:297 counts manual entries but never replays them, so `node scripts/watchfail.mjs --registry tests/mutations --only i` replays nothing. Plan Verification says the entry exists so that this exact command replays it. The run strings also carry machine-specific values (E2E_PORT=8808, MSYS_NO_PATHCONV=1). The author disclosed this as UNPROVEN. Today these watched-fails can only be replayed by hand.
   - Evidence: watchfail.mjs lines 295-299: `else if (kindOf(entry) === "manual") { counts.manual += 1; }`. My replay only worked after I copied the entries to a scratch registry with kind removed.

3. `app/tests/e2e/forms.spec.ts` (not blocking)
   - What: Not every new test was watched failing, as STANDARDS R49 and checklist C08 require. No mutation was run for these six cases: the inquiry dialog form case (property_inquiry), the inquiry dialog Escape case, both backdrop-click cases, the wizard happy path, and the PERF-08 6000x4000 case. Reading them, each looks able to fail: a 6000 px edge fails the 2560 check, a removed track() fails toContain, and a dropped backdrop handler leaves the overlay at count 1. That is UNPROVEN, because none was watched red.
   - Evidence: tests/mutations/B4.json has entries only for i, j, cc, cc-post, hh, hh-focus and rd. app/tests/WATCHED-FAIL.md has seven g5 rows and none for backdrop, the inquiry dialog or PERF-08.

4. `app/tests/e2e/forms.spec.ts` (not blocking)
   - What: The FE-04 case (line 277) does not check the 'answered 500 three times' contract. failPuts.on makes every PUT fail, both the original and the thumbnail, and the test never counts PUT attempts. A queue that gave up after one attempt, or retried without limit until the 45 s timeout, would still pass.
   - Evidence: forms.spec.ts:282-287 sets failPuts.on = true, then asserts only uploadFailed(1) visible and posts length 1. There is no assertion on stubbed.puts.length while failing.

5. `app/tests/e2e/forms.spec.ts` (not blocking)
   - What: This breaks once H1 enforces the CSP. The stubbed signed upload host is https://storage.fixtures.invalid (line 19). connect-src allows only 'self', challenges.cloudflare.com and the SUPABASE_URL origin (src/server/lib/headers.ts:24-27 and :38-41). Today the policy is Content-Security-Policy-Report-Only (headers.ts:72), so the PUTs go through. Once enforced, Chromium blocks them before page.route sees them, and all four wizard cases go red. Fix: build the stub URLs on the SUPABASE_URL origin from .dev.vars. This is a note for H1/B17.
   - Evidence: headers.ts:72 has "Content-Security-Policy-Report-Only": cspFor(env, flags), and the connect-src list holds no fixtures.invalid host. (Suspected by reading; I did not run an enforced-CSP build.)

6. `app/tests/e2e/forms.spec.ts` (not blocking)
   - What: Stale comment (C07). Line 180 says the Put type holds 'the URL, the bytes and the answer the route gave', but the type at line 181 is `{ url: string; body: Buffer }`. It has no answer field.
   - Evidence: forms.spec.ts:180-181

Follow-ups whose file is GOTCHAS.md are banked, not listed here: the g5 log cited P-419 for the `heic-convert` install and P-421 for a strict-mode locator and a wrong `expect` text, and none covered them. Now: hit-again lines in P-904 (the install), P-066 (the `expect` of `cc-post` and `rd`) and P-154 (the shared scratchpad: a registry folder holding other agents' B14, B8 and B8b entries, a shared check.log), and the new entry P-429 (two header search buttons break strict mode).
