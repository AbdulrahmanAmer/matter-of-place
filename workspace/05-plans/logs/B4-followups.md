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

## g6 · steps 7,8

1. `.github/workflows/ci.yml` (not blocking)
   - What: Two plan proofs are NOT DONE: step 7 wants a green e2e run and step 8 wants a green db run. Merging this file to main makes db and e2e required checks for every pull request (merge-gate requires a name from the commit whose workflow first defines it). From then on, every pull request is refused until two things are fixed elsewhere. e2e fails on every seeded database: the seed's image upload is STUB(B9 step 6), so 711 /media 404s (P-422). db fails on two B8 cases that expect schedule_settings to be absent (P-427), unless CI_HEAVY=off. Also NOT DONE: the broken-form drill's 'revert, green', the hydration drill (s), and pasting the run ids into tests/README.md. Nothing in this group's files can fix the two causes, and the group's own job steps are green, so this is not marked blocking. The orchestrator must hold slice/b4's merge or set CI_HEAVY=off.
   - Evidence: Confirmed by running: gh api .../jobs/111472753607/logs shows 711 '404 .../media/o/' lines and '88 failed / 52 passed (13.0m)'. gh api .../jobs/111476176372/logs shows 'Tests 2 failed | 436 passed (438)', both in tests/db/jobs.db.test.ts and tests/db/ops-health.db.test.ts. scripts/merge-gate.mjs:12 REQUIRED_PR_CHECKS includes db and e2e, filtered by definedJobs.

2. `app/tests/mutations/B4.json` (not blocking)
   - What: The registry entry aa-factories is missing. Watched-fail (aa) of the plan names tests/fixtures/factories.ts. workspace/05-plans/logs/B4.md:130 says 'The group that writes factories.ts (step 8) adds the entry the plan words (aa-factories) over it'. This group's 24 entries do not include it, so the CI replay never re-checks the time-model guard over factories.ts. The guard itself works: I made the mutation and saw it red.
   - Evidence: node -e filter of B4.json for time-model shows only 'aa' over tests/db/harness.db.test.ts. My scratch entry aa-factories (import FIXED_NOW into factories.ts) gave WATCHED-FAIL OK.

3. `.github/workflows/ci.yml` (not blocking)
   - What: C22: the two new heavy jobs state no unit cost, and the header's cost line ('check ... build ... so 2 to 3 Actions minutes a run', lines 5 to 8) is now wrong for a ready pull request run. Measured: e2e ran about 16 min (13 min of specs with retries on failures), db about 2.5 min, and about 8 min with the mutation replay. The plan estimated 12 min per ready push and set a 10 min threshold for the e2e path filter. A green e2e duration is UNPROVEN.
   - Evidence: gh run view 37214655312: e2e 15:53:35 to 16:09:30. gh run view 37217107769: db 16:31:59 to 16:40:03. Header comment at ci.yml lines 5 to 8.

4. `.github/workflows/ci.yml` (not blocking)
   - What: Suspected by reading, not run. The coming-soon step (written by the author, P-408) and the admin step (written by the plan) run their specs only when 'playwright test --list --project=...' exits 0, and otherwise print 'absent' and pass. Once B3b's coming-soon.spec.ts exists, a load or compile error in it also makes --list exit 1. The step would then print 'coming-soon spec absent (B3b not landed)' and stay green. A file-existence test (test -f tests/e2e/coming-soon.spec.ts) would not hide that.
   - Evidence: ci.yml coming-soon step: 'if bunx playwright test --list --project=coming-soon-desktop > /dev/null; then ... else echo "coming-soon spec absent (B3b not landed)"'

5. `workspace/05-plans/B8.md` (not blocking)
   - What: B8 step 1's fixture work has no owner. That is createJob, the seven dataset jobs ('jobs 7') and the createJob case of factories.db.test.ts. B8 landed before B4, recorded it NOT DONE (logs/B8.md:17, :175), and this group did not add it either (it is not in its step). The orchestrator must assign it. B8b.md:203 says '10 dataset submissions', while the dataset prints 11.
   - Evidence: grep -rn createJob app/tests app/scripts finds nothing. logs/B8.md:17: 'NOT DONE ... createJob, the seven dataset jobs and the createJob case belong to B4's ... factories.ts'

6. `workspace/05-plans/B4.md` (not blocking)
   - What: Plan lines are out of date (the orchestrator folds them). 'submissions 10' should be 11 (P-414). The GQ-03 grep 'prints nothing' finds B2's tests/fixtures/db.ts. The draft run lists db and e2e as skipped jobs, not absent ones. Watched-fail (dd)'s table line cannot fail (P-428). 'the sweep reads bundled images' is false in live mode (P-422). The jobs predicate is now unconditional because jobs is on main.
   - Evidence: Re-run outputs above. gh run view 37214595255 lists 'db skipped', 'e2e skipped'.

7. `app/tests/mutations/B4.json` (not blocking)
   - What: Replaying fd-harness on the laptop commits one fixture submission and its contact to mop-dev every time (P-426), and the cleanup is manual. Anyone who replays the B4 registry with the dev profile leaves the dataset at 12 until someone runs fixtures:load -- --reset. The db project's global-setup guard covers this after launch. Before launch it is shared-DB litter, and it changes the hash other lanes check.
   - Evidence: Confirmed by running: after my replay, db:psql printed 12|dd46a4d5410cb1f396d16ce0b06990c0. After fixtures:load -- --reset it printed 11|7b93049a6b185143f23e2db7c29fb982.

8. `app/tests/e2e/global-setup.ts` (not blocking)
   - What: The E2E_DATASET=1 branch is UNPROVEN under Playwright and in CI until B7's admin project exists. I proved it only by calling the function directly on mop-dev: it printed 'fixtures: submissions 11' and the hash was unchanged.
   - Evidence: E2E_DATASET=1 bun -e "(await import('./tests/e2e/global-setup.ts')).default()" printed 'lock mop-dev-tests held' / 'fixtures: submissions 11'

Follow-ups whose file is GOTCHAS.md are banked, not listed here: hit-again lines in P-154 (the reviewer's scratch registry folder `g6reg` still held `B4.json` and `B8.json`, so a 24-entry replay ran 61) and in P-015 (with `MSYS_NO_PATHCONV=1` set, `"$(pwd)/.dev.vars"` reaches Windows node as `/e/...` and wrangler fails; use `"$(pwd -W)/.dev.vars"`).

## g7 · steps 9,10

1. `app/tests/README.md` (not blocking)
   - What: The measured minutes count ci.yml jobs only, but the doc presents them as the cost of a push. It also says 'Drafts run `check` and `build` only', which is false: deploy.yml's preview-db job runs on every pull request event, drafts included. So a draft push bills 5 minutes, not 4 (400 a month, not 500). A ready push also bills preview-db (1) plus the preview job (2 measured before step 10's overflow and Lighthouse steps; the plan estimates about 4 more), and none of that is in the 23. The plan's own method (`gh run list --workflow ci.yml`) and its Risks line ('A draft push runs only check and build') carry the same omission, which is why this is not marked blocking. The README still needs a deploy.yml row, or a sentence saying the deploy.yml jobs are not counted.
   - Evidence: gh run view 37231990076 --json jobs: 'preview-db success 2026-10-04T20:24:51Z 2026-10-04T20:25:05Z' on draft PR 119; deploy run for ready head 556099d: 'preview-db success 15:52:44-15:52:55', 'preview success 15:52:59-15:54:05'; deploy.yml:39 preview-db `if:` has no draft condition.

2. `.github/workflows/ci.yml` (not blocking)
   - What: The e2e change test (lines 221-230) fails open. If `git diff base...head` errors (for example the checkout loses `fetch-depth: 0`, so neither SHA is present), grep sees nothing, the step writes changed=false, and every later step skips. The required `e2e` check then goes green with no spec run. No hygiene case asserts `fetch-depth: 0` on the e2e checkout. This step has also never run on GitHub: PR 119 is a draft and the test/b4 runs predate it, so it is UNPROVEN.
   - Evidence: By reading: `if git diff --name-only <base>...<head> -- ... | grep -q .; then ... else echo changed=false` with no exit-status check on git. hygiene.test.ts's new case checks only that later steps carry the `steps.fe` if (`first: 1`). PR 119 checks: e2e SKIPPED.

3. `.github/workflows/ci.yml` (not blocking)
   - What: The T-04 filter `src/** supabase/** package.json bun.lock` skips e2e on a PR that changes only `tests/e2e/**`, `playwright.config.ts`, `wrangler.toml` or ci.yml itself. A PR that edits only a spec never runs that spec before merge. The plan sanctions this filter ('nothing narrower'), so it is a note for the orchestrator, not this group's defect. It combines with the author's listed UNPROVEN that the cut is needed at all, since both measured ready runs were inflated by red retries.
   - Evidence: By reading ci.yml change test pathspecs; plan B4 step 10 and Files line for ci.yml.

4. `app/tests/fixtures/catalog-fixture.ts` (not blocking)
   - What: C04/C05: `syntheticCatalogSnapshot` is exported but used only inside its own file. The `version = 7` default parameter of both exports is never passed by any caller. knip cannot see either because `tests/**` are knip entry files.
   - Evidence: grep -rn syntheticCatalog --include=*.ts app: the only external use is `syntheticCatalogDb(COUNT)` in tests/api/payload-budget.api.test.ts; knip.json entry includes `tests/**/*.{ts,tsx}`.

5. `app/tests/fixtures/catalog-version.ts` (not blocking)
   - What: The P-434 guard is enforced by a hand-kept list. A new test helper that commits over DEV_DB_URL and is not added to `guardedScripts` passes every gate. The text check (`assertNotProduction(` present) would also stay green if `await checked;` were removed: the bump would then run before the refusal arrives. `bumpCatalogVersion` also takes no G34 `holdDevLock()`, unlike the other committed writers of invariant 4 (invariant 4 does not list it).
   - Evidence: tests/unit/assert-not-production.test.ts:75-81 checks only the listed paths for the import and the call text; catalog-version.ts calls no holdDevLock.

6. `.github/workflows/deploy.yml` (not blocking)
   - What: The Lighthouse step is likely red on the first ready front-end PR. The only measurement is LCP 3,720 ms for `/` on the laptop against a 2,500 limit, and the plan expects the workers.dev preview to be pessimistic (no Cache API). `preview` is in REQUIRED_PR_CHECKS. The plan names this risk and its handling (a PROJECT-STATE decision), so it is a note, not a defect of this group. The per-page preview numbers and the 300 KB drill are NOT DONE, as the README says.
   - Evidence: tests/README.md 'Gates on a preview' line; log g7 step 10: 'largest-contentful-paint ... expected: <=2500 found: 3719.86', exit 1.

7. `app/tests/WATCHED-FAIL.md` (not blocking)
   - What: The new entry u-catalog-version and the six rewritten entries (e, rc-gone, rc-redirect, rc-pattern, B1b hy-checkout, B1b as) have no ledger row. Registry replays do not append to the ledger, and the plan's step 10 proof asks for a row for every test added. The test file itself (assert-not-production.test.ts) already has rows, so this is bookkeeping only.
   - Evidence: grep -n catalog-version app/tests/WATCHED-FAIL.md prints nothing; commit 4ee2560 does not touch WATCHED-FAIL.md.

## c7l · steps 7

1. `workspace/05-plans/ASSUMED.md` (not blocking)
   - What: Ruling H61, which the README, the perf-budget.test.ts comment and WATCHED-FAIL.md cite as 'CTO, 2026-10-05', is not recorded anywhere (ASSUMED.md ends at H60). lighthouserc.json now explicitly breaks plan invariant 11 ('fails ... when an assertion level is warn for a hard limit') and plan GQ-01's 'a decision recorded in PROJECT-STATE.md, not a silent loosening'. Until H61 is written down, the loosening of LCP and script size to warn rests on an unrecorded ruling. The script-size limit is still enforced at build time by bundle-check (G16), so the gap is LCP only. This is the orchestrator's file to fix; the author flagged it.
   - Evidence: grep -n H61 workspace/05-plans/ASSUMED.md returns nothing (latest H60 at line 255). The plan-brief quotes invariant 11 and Files line 42 still saying 'assertions at error'.

2. `workspace/05-plans/B4.md` (not blocking)
   - What: Three plan lines are now stale: invariant 11 (warn forbidden for a hard limit), the Files line for lighthouserc.json ('assertions at error' for all four), and the Contract line saying the e2e seed uses '--images skip', no Storage bucket written. The orchestrator should fold them.
   - Evidence: plan-brief.mjs B4 --steps 7 output, lines 15 and 42; ci.yml line 283 now reads --images upload

3. `app/tests/README.md` (not blocking)
   - What: The Lighthouse paragraph calls run 37236145703 'the first preview run', while the earlier failing run 37234045561 'read the same'. That run's LCP reached 3,998 ms (/properties), outside the quoted 3,538 to 3,902 range. The wording is loose, not false: both runs failed exactly the same two assertions on all six pages.
   - Evidence: gh run view 37234045561 --log-failed | grep found: -> LCP 3657.6, 3997.97, 3677.8, 3866.5, 3646.4, 3646.5

4. `app/tests/README.md` (not blocking)
   - What: Line 62 still explains the red e2e in the present tense ('because the seed does not upload photographs until B9 step 6'). The sentence appended after it corrects this, but the first clause now reads as current fact.
   - Evidence: grep -n 'does not upload photographs' app/tests/README.md -> line 62

5. `.github/workflows/ci.yml` (not blocking)
   - What: UNPROVEN, and the author says so: the new 'media bucket' curl (Authorization header only, no apikey header) and `bun run seed -- --target local --mode full --images upload` have never run against a stack. The 404 count falling from 682 to 0 and the e2e minutes after the change depend on the next ready run of PR 119. Likewise, the preview printing LCP and script size as warnings (exit 0) is not yet observed.
   - Evidence: No CI run exists for 7776db8. Last e2e (job 111535650995) shows 682 media 404s, '88 failed, 80 passed (14.3m)'.

6. `workspace/05-plans/logs/B4.md` (not blocking)
   - What: The author's report lists gotchasAdded as [], but this group (commit f1aed38) added a new entry, P-435, plus hit-again lines on P-066 and P-094 and a resolved line on P-422. The bank is correct; the report field is wrong.
   - Evidence: git diff 4a65bcc..7776db8 -- GOTCHAS.md shows '## P-435 · A workflow `run:` written as a one-line plain scalar...' added 2026-10-05

(The seventh follow-up, the P-422 proof that no longer reproduces, is a GOTCHAS.md item and is banked as P-436, not listed here.)
