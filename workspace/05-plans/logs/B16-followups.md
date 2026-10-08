# B16 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 1,2

1. File `app/src/db/types.ts` (not blocking).
   What: The new RPC settings_put_site is missing from the generated types. STANDARDS C21 and the PR template ask for the migration and its regenerated types in the same PR. The author did not list this as UNPROVEN. From this lane it cannot be generated: gen:types reads either mop-dev, where the lane may not push, or the --local CI stack, which does not exist. It will bite step 2's service.ts, whose typed db.rpc("settings_put_site") will not typecheck until the types include it.
   Evidence: grep -n settings_put_site app/src/db/types.ts finds nothing, while public_state and save_property sit at lines 1647-1648. .github/pull_request_template.md:27 says 'a migration travels with its regenerated src/db/types.ts'.

2. File `workspace/05-plans/logs/B16.md` (not blocking).
   What: The UNPROVEN item 'CI db job on PR #98' cannot be cleared by that PR: ci.yml on this commit has no db job. Its jobs are check, build and merge-gate, and line 128 says 'Jobs appended here (B4 db and e2e...)'. The function's only proofs are the rolled-back mop-dev runs, mine included. Step 2's plan proof (CI db job green, settings-site.db.test.ts) stays UNPROVEN until B4 adds the job, not until this PR runs CI.
   Evidence: grep -n '^  [a-z-]*:$' .github/workflows/ci.yml lists check, build and merge-gate only.

3. File `app/supabase/migrations/20261003212641_fn_settings_put_site.sql` (not blocking).
   What: The '-- down:' header (line 1) says to re-run db:fn from the previous commit of settings_put_site.sql. This function is new, so no previous commit exists and an operator following the header has nothing to run. The real down step is: drop function public.settings_put_site(jsonb, uuid, public.actor_kind, text, text). The author disclosed this. The text comes from B2's scripts/db-fn.mjs template, which should write a drop-function line when the function is new. Since the file is on no main yet, it can be regenerated once the template is fixed. Not blocking: leaving the function in place on rollback does no harm.
   Evidence: head -1 app/supabase/migrations/20261003212641_fn_settings_put_site.sql; git log origin/main -- app/supabase/sql/functions/settings_put_site.sql prints nothing.

4. File `app/supabase/sql/functions/settings_put_site.sql` (not blocking).
   What: Suspected by reading, not a plan breach: the function updates value but never sets settings.updated_by (uuid, defined in catalog.sql:245), so the column keeps its old value after every audited write. The actor does land in audit_log. Also, p_actor_kind accepts 'agent', so 'human only' (Contract 4) rests entirely on B7's matrix (humanOnly) until write_audit exists (R21). Both are worth folding when B7's write_audit lands.
   Evidence: sed -n 241,246p app/supabase/migrations/20261001090300_catalog.sql; the function's update statement sets only value.

5. File `app/src/domain/retention.ts` (not blocking).
   What: The unit test checks only the five keys B2 seeds. The other four (subject_requests, email_pii, rate_limits, analytics_daily) have no seeded row on main yet: B3, B5 and B8 seed them. Until step 5's db test (-t retention) runs, a wrong number for any of those four would pass. The author lists this as UNPROVEN, which is correct.
   Evidence: ls app/supabase/migrations shows no 20261001100000_public_write_functions.sql and no B5 or B8 retention migration on this commit.

## g2 · steps 2

1. File `app/scripts/set-site.ts` (not blocking).
   What: Follow-up (plan text, not this group's file): the plan's Files line for set-site.ts says to set process.env.CATALOG_VERSION_TTL_MS ??= "0" and load service.ts and readiness.ts with a dynamic import(). The script imports them statically and never sets the variable. By reading the code I think the deviation is harmless: state.ts reads the TTL at call time through readVar, and the script reads no state before its write, so the memo is empty when siteReadiness runs. Running the script confirms it: example then empty printed 'missing: none' and then 'missing: legal.entity legal.address'. The B16.md plan line is now stale and the orchestrator should fold it.
   Evidence: set-site.ts lines 11-12 import readiness.ts and service.ts statically, and nothing in the file sets CATALOG_VERSION_TTL_MS. The g2 block of workspace/05-plans/logs/B16.md states the deviation and the reason.

2. File `app/docs/runbooks/api.md` (not blocking).
   What: Follow-up: the plan's Files line asks for runbook lines on running scripts/set-site.ts (both fixtures, that the empty fixture restores the shared mop-dev row, and that the script refuses after L1's switch). They are not written. Step 2's own text does not name the file, and the author lists this as NOT DONE. It needs to land with step 3's route row, or the orchestrator should assign it.
   Evidence: git diff origin/main...slice/b16 --stat lists no docs/runbooks/api.md. The plan-brief Files list names it next to the GET /api/public/site row.

3. File `app/tests/unit/settings-service.test.ts` (not blocking).
   What: Follow-up: plan watched-fail (k) names site-read-path.test.ts (step 3's file). This group proved the same property (getSiteSettings never queries the settings table, one public_state call in 200 reads) in a new file that is not on the group's list. The author explains why (knip needs an importer for getPublicSite). Step 3 still has to create site-read-path.test.ts so that (k) holds as the plan words it. Its contract is covered for now.
   Evidence: watchfail --only b16-g2-read-table prints WATCHED-FAIL OK B16:b16-g2-read-table against tests/unit/settings-service.test.ts. No tests/unit/site-read-path.test.ts exists at 5bab4e7.

4. File `workspace/05-plans/logs/B16.md` (not blocking).
   What: Follow-up: the log's g2 UNPROVEN line ('the CI db job on the pull request ... skipped while the PR is a draft') is now outdated. PR 209 is not a draft and the db job passed on head 5bab4e7, running settings-site.db.test.ts (5 tests) on the ephemeral stack. Separately, the preview job on the same run failed: 7 flaky @overflow phone-sweep page.goto net::ERR_ABORTED timeouts and 48 passed. This group touches no UI or route, so the failure is not its own. It will still hold the merge gate until it is re-run.
   Evidence: gh pr checks 209: 'db pass 3m1s', 'preview fail 7m32s'. gh run view 37573151075 --job 112636074297 --log: 'db tests/db/settings-site.db.test.ts (5 tests)'. gh run view 37573151038 --log-failed: '7 flaky ... 48 passed', then '##[error]Process completed with exit code 1'.

(The fifth g2 follow-up, a GOTCHAS.md cost, went to the bank as a hit-again line in P-508.)

## g3 · steps 3

1. File `app/src/services/http/index.ts` (not blocking).
   What: UNPROVEN in live mode. Every proof (mine and the author's) ran a build with no VITE_API_BASE_URL, so services resolve to localSite, and the root loader and /legal never call the http adapter's site.get() (api.get("/site", publicSiteSchema)) against the route. No test covers site.get: tests/unit/http-adapter.test.ts has no site case. Under that local build, /legal on the MOP_ENV=production Worker still carries the 'fictional' paragraph, because localSite answers illustrativeContent true. This is harmless only because deploy.yml's production job always sets VITE_API_BASE_URL. The author's log already admits that the root loader and siteQuery have no test of their own.
   Evidence: In my production-mode Worker run, curl /legal | grep -ac fictional printed 1, while /api/public/site printed illustrativeContent:false. src/services/index.ts selects localServices when VITE_API_BASE_URL is unset. grep -n site tests/unit/http-adapter.test.ts finds no site.get case.

2. File `app/src/routes/__root.tsx` (not blocking).
   What: The root loader makes every page depend on GET /api/public/site. In a live build, a failed site fetch on a cache miss throws in the root loader and the whole page renders the root error page, not just the footer. ensureQueryData also never refetches stale data, so client navigations keep the first site value for the session. The plan asks for this loader, so this is a note for a later slice, not a defect of this step.
   Evidence: Read only, not run: loader: ({ context }) => context.queryClient.ensureQueryData(siteQuery()) at __root.tsx:22

3. File `workspace/05-plans/B16.md` (not blocking).
   What: Stale plan text for step 3. It says path /site, handler GET, and 'drop the /site row' in watched-fail (o). The tree uses the full path /api/public/site, handler ANY, and catalogRead. The author banked this as P-1941; the orchestrator should fold the fix into the plan.
   Evidence: plan-brief Files list: 'createFileRoute(...)({ server: { handlers: { GET: ...' versus app/src/routes/api/public/site.ts 'handlers: { ANY: ...'

## g4 · steps 4

1. File `GOTCHAS.md` (not blocking). Banked as a "resolved" line on P-2101, not here: P-2101 (B12 copy.test.ts skips while footer.line is the old string) is stale. This group deleted the skip and turned b12g2-p-credit into a file entry; the entry's rule still described the skip and its proof ('6 passed | 1 skipped') no longer reproduced. Evidence: sed -n '/^## P-2101/,/^## /p' GOTCHAS.md showed only the skip rule and the skipped-test proof; git diff origin/main...HEAD -- app/tests/unit/reel/copy.test.ts shows the skip removed.

2. File `workspace/01-site-index/pages-and-wording.md` (not blocking).
   What: The site index (the operator's map) still describes the pre-step-4 site: Instagram from env VITE_INSTAGRAM_URL (line 7, line 293), footer line 'An Omnikom company.' (lines 294, 312, 434), the About H2 'An Omnikom company' (205), the /legal company paragraph 'is an Omnikom company' (243), and Privacy/Terms as /legal#privacy and /legal#terms (293). Also app/README.md:3 still ends 'An Omnikom company.', and .claude/POSITION.md:30 names VITE_INSTAGRAM_URL. None of these is this group's file, so the orchestrator should fold them.
   Evidence: git grep -n -i 'social.instagram\|An Omnikom company\|legal#privacy\|legal#terms' -- app/README.md workspace/01-site-index (confirmed by running). Re-run at recording on slice/b16 (2026-10-08): the same grep still lists app/README.md:3 and pages-and-wording.md lines 7, 33, 205, 243, 293, 294, 312, 434.

3. File `app/src/services/local/site.ts` (not blocking).
   What: Step 4 adds siteConfig.social.x and siteConfig.social.linkedin as the local defaults, but nothing reads them. The local adapter hardcodes x: null and linkedin: null and reads only siteConfig.social.instagram, so the config comment's claim that 'the nulls here are the local-mode default' holds only for instagram. Both values are null today, so nothing renders differently. The fix is in g3's file.
   Evidence: Grep 'siteConfig\.social|social\.(x|linkedin)' in app/src finds only local/site.ts:14 (instagram via siteConfig, x and linkedin literal null) and the footer's reads of the query (confirmed by running). Re-run at recording: app/src/services/local/site.ts:14 reads `social: { instagram: siteConfig.social.instagram, x: null, linkedin: null }`.

4. File `GOTCHAS.md` (not blocking). Banked as a hit-again line on G-031, not here: the re-run's first cold vitest run of the two proof files ended with Errors 1 and a 60 s timeout, and the author re-ran it. The log cites G-031 but adds no hit-again line and says 'cause not examined'. That is a second attempt with no banked line. The reviewer's cold run of the same command passed in 33 s, so the cause is still unknown. Evidence: workspace/05-plans/logs/B16.md g4 re-run block: 'The first vitest run ... ended Test Files 1 passed (1) with Errors 1 and a 60 s duration ... cause not examined'; git diff origin/main...HEAD -- GOTCHAS.md | grep 'B16 g4' showed no G-031 line.

5. File `app/src/routes/_site.legal.tsx` (not blocking).
   What: Between step 4 and step 5 the slice branch has no privacy or terms text anywhere. The footer links (/legal hash privacy and terms) and the consent-notice and noscript links still point at anchors this step removed. The plan orders it this way and P-1008 banks it. It is UNPROVEN that the branch can never reach main in this state: nothing mechanical stops a merge of slice/b16 before g5 lands.
   Evidence: cd app && git grep -n 'hash="privacy"\|hash="terms"' -- src lists footer.tsx (three links) and consent-notice.tsx, while _site.legal.tsx no longer has id="privacy" or id="terms" (read in the diff). Status at recording (2026-10-08): g5 has landed on slice/b16 (commit 141b4e70, privacy, terms and accessibility pages and the repointed links), and the same git grep over app/src now prints nothing; the branch no longer lacks the text. The open part is only that no gate would have stopped an earlier merge.

## g5 · steps 5

1. File `app/src/routes/_site.privacy.tsx` (not blocking).
   What: Line 60, Identifiers 'What' cell: 'an IP address held only as a hash for rate limits and rights records'. inquiries.ip_hash also holds the hash (20261004193550_inquiry_attribution.sql line 29), and the fixed 'Kept' cell on line 63 now says so. The two cells in the same row disagree. Also, retention_anonymise_inquiries never clears ip_hash, so an 'anonymised' inquiry keeps a pseudonymous identifier. Both are for the legal read (invariant 5), not this step's to close.
   Evidence: grep -n ip_hash app/supabase/migrations/20261004193550_inquiry_attribution.sql shows ip_hash inserted with every inquiry; sed -n 178,198p app/supabase/migrations/20261004065712_retention.sql shows the anonymise update without ip_hash (found by reading)

2. File `app/src/routes/_site.privacy.tsx` (not blocking).
   What: Lines 216 and 229 are still plain <a href="/privacy-request"> and <a href="/privacy-request?kind=opt_out">. g6's route (with validateSearch on kind) is already in this tree (7890bc2d), so typed <Link to="/privacy-request" search={{ kind: "opt_out" }}> is possible now. No test asserts the opt_out link the plan's section 9 requires, so a renamed route or param would go unnoticed. The log's 'Left for others' line says they wait on g6, which has landed.
   Evidence: grep -rn 'kind=opt_out' app/tests/unit finds nothing for /privacy; grep -rn '<a href="/' app/src/routes shows only these two in public routes

3. File `app/src/lib/seo-copy.ts` (not blocking).
   What: Line 105: the /legal meta description still says 'Illustrative-content notice, ... privacy and terms'. In production /legal shows no illustrative paragraph, and privacy and terms are now separate pages. Also stale: workspace/01-site-index/pages-and-wording.md line 293 (footer links /legal#privacy, /legal#terms, VITE_INSTAGRAM_URL) and app/docs/coming-soon.md line 148 (consent.link to /legal hash privacy). The author listed all three. They are not this group's files, so the orchestrator should fold them.
   Evidence: grep -rn 'legal#privacy\|hash="privacy"' app/docs workspace/01-site-index; sed -n 104,105p app/src/lib/seo-copy.ts

4. File `slice/b16 (branch)` (not blocking).
   What: The branch conflicts with origin/main fe3a990a in GOTCHAS.md (P-008, P-094) and app/tests/unit/assert-not-production.test.ts (main added scripts/admin-smoke.ts). A conflicting PR starts no CI run (P-136), so the db job proof stays UNPROVEN until the next merge (bank-merge.mjs for GOTCHAS.md). footer.tsx and contracts.ts auto-merge.
   Evidence: git merge-tree --write-tree --name-only HEAD origin/main -> CONFLICT (content): Merge conflict in GOTCHAS.md; app/tests/unit/assert-not-production.test.ts

5. File `workspace/05-plans/logs/B16.md` (not blocking).
   What: UNPROVEN carried forward, not a defect of the code: 24 db-project registry entries of other groups were not replayed with the dev profile (the author's --changed run was 272 ok, 25 bad for the wrong reason). Pages were checked only on vite dev, not the built Worker. No axe sweep on the three routes. No lawyer has read the copy. The python pid 64240 was stopped without confirming its parent, which could have belonged to another lane.
   Evidence: author's own proofs list; I replayed only the 24 b16-g5 entries (all OK), as the brief directs

(The sixth follow-up, a GOTCHAS.md cost, went to the bank as P-1946: lesson 5 of the map names `watchfail --check`, which does not exist; the reviewer's note on P-094 and confirming a process command line before stopping it is in the same entry.)

## g6 · steps 6

1. File `workspace/05-plans/logs/B16.md` (not blocking).
   What: The g6 rework block gives the wrong cause for the UNPROVEN item. It says the Playwright submit 'never reached the network (the Turnstile token is not available to a headless page here)'. The real cause: the build had no VITE_API_BASE_URL, so services resolved to localServices and the form wrote to the in-memory outbox. getTurnstileToken returns null when no site key is set, and the request is still sent. A later prover (HARDEN's end-to-end submit) would chase Turnstile instead of building in live mode. Reviewer evidence closes the item itself: a live build sends the right kind in a real browser.
   Evidence: In the local build, grep -rlo '/subjects/request' .output/public/assets found nothing, and Playwright showed sent=[] with the confirmation displayed. After MSYS_NO_PATHCONV=1 VITE_API_BASE_URL=/api/public bun run build, Playwright sent kind opt_out (no click) and kind access (after clicking access), each through the intercepted POST.

2. File `src/components/forms/privacy-request-form.tsx` (not blocking).
   What: The plan says 'A 422 shows forms.invalid beside the fields'. The form shows it once, as the FormError alert under the fields, with no field marked. That is the shared useAsyncAction behaviour. The author recorded it as left, but the log puts it under use-async-action and it does not appear in B16-followups.md.
   Evidence: tests/unit/privacy-request.test.tsx line 194 asserts the single role=alert text 'Please check the highlighted details.' and no per-field error. use-async-action.ts messageFor maps validation to t.forms.invalid in state.message only.

## g7 · steps 7

1. File `workspace/05-plans/B16.md (step 7 proof)` (not blocking).
   What: The plan's own curl proof for step 7, `grep -c '"@type":"Organization"'` prints 1, cannot fail on this page. grep -c counts lines and the SSR HTML is one line. It printed 1 for the old inline literal before this change. It would also print 1 if the home head emitted two Organization nodes, or if the head were reverted to the old literal. No unit test or registry entry covers the head() wiring of _site.index.tsx: if the head goes back to the old literal, every unit test stays green. The author said this (UNPROVEN: head wiring). What actually shows the change is their second grep -o, which carries @id and description.
   Evidence: Confirmed by running: on the 8849 Worker, `grep -c` gives 1 and `grep -a -o '"@type":"Organization"' | wc -l` gives 2 on the same file. Suggested fix: change the proof to `grep -o '"@id":"https://matterofplace.com/#organization"' | wc -l` equal to 1, or add a head() unit case for the home route.

2. File `app/tests/unit/submissions.service.test.ts, app/tests/unit/illustrative-labels.test.tsx` (not blocking).
   What: Two files outside the group's file list were edited. The first belongs to B7, edited as a merge fix (a public_state stub in decisionDb). The second changed because the home loader now returns `site`. Neither is a gate configuration under H46. Both edits are necessary, minimal and named in the log. The orchestrator should know that slice/b16 now writes a B7 test file, in case the B7 lane is editing it too.
   Evidence: git show --stat c27cf521 lists both files. Their diffs are one stub line plus an import, and one mock line plus an import.

3. File `workspace/05-plans/logs/B16.md (costTime of the return)` (not blocking).
   What: The third costTime item (tsc refused head({ matches }) loaderData, so the author switched to the home loader's `site`) lists entry P-1945. P-1945 is about the submissions.service merge stub, and the item itself says 'No entry: under a few minutes'. The entry field does not match the cost. Either bank it (the matches union has no typed loaderData, so return what head needs from the route's own loader) or drop the entry name.
   Evidence: git diff 54312682 c27cf521 -- GOTCHAS.md shows only P-1945 (the merge stub) and a P-094 hit-again line. Nothing covers the matches/loaderData approach.

4. File `app/src/lib/seo.ts:152` (not blocking).
   What: organizationJsonLd returns an untyped object literal, not a schema-dts Organization, unlike the jsonld.ts builders. A misspelled or undefined Schema.org key would not be caught by tsc. B13's watched-fail (h) assumes builders are typed, and B13-followups line 36 already records that pageHead's jsonLd is loosened to `object`. This belongs to B13's extension (logo, contactPoint, re-export from jsonld.ts), which is now unblocked once B16 is on main (B13-followups lines 36 and 64).
   Evidence: Read: src/lib/seo.ts 152-171, no type annotation. src/lib/jsonld.ts imports `Organization` from schema-dts and uses it only for `publisher`.

5. File `workspace/05-plans/logs/B16.md (g7 block)` (not blocking).
   What: Small imprecision: the log says head builds `[organizationJsonLd(loaderData.site), websiteLd()]`. The code is `organizationJsonLd(loaderData?.site ?? emptySiteSettings)`, which falls back to the empty site when the loader did not resolve. The behaviour is sound (it matches useSite's noSite). The log line just leaves out the fallback.
   Evidence: Read: app/src/routes/_site.index.tsx line 45.

## g8 · steps 8

1. File `app/tests/unit/health-site.test.ts` (not blocking).
   What: siteDb() (lines 35-63) replaces fakeDb's `from` with a hand-rolled stub that answers any table with { data: null } through select().eq().maybeSingle(). That bypasses fakeDb's 'unexpected table' throw that STANDARDS R50 relies on. The stub is needed because fakeDb (B3's tests/fixtures/fake-db.ts) has no maybeSingle for the provider check's settings.linkedin read. The 'one state read' case asserts from: {} for site_identity itself, which offsets the risk. No concrete product failure, so this is a follow-up: extend fakeDb (B3) and drop the override.
   Evidence: tests/fixtures/fake-db.ts:61-77: `from` throws `unexpected table ${name}` for unregistered tables and its query builder has is/gt/eq/in/lte/lt/order/limit but no maybeSingle. providers.ts:101-104 calls .from("settings").select("value").eq("key","linkedin").maybeSingle().

2. File `app/src/server/jobs/system/health.ts` (not blocking).
   What: In site_identity (line 156), `error instanceof AppError ? error.code : "unavailable"` has an unreachable non-AppError arm. readState only rejects with unavailable(), an AppError whose code is 'unavailable', so the fallback literal equals the only reachable code. The cold-isolate test cannot tell the code from the literal. A mutation that replaces the whole expression with fail("unavailable") stays green. The author recorded this as a follow-up. C04-adjacent, no product impact.
   Evidence: state.ts:72-73 `const unavailable = (): AppError => new AppError("unavailable", ...)` and state.ts:125 `if (stateMemo === undefined) throw unavailable();` are the only throws reaching readState's caller. health-site.test.ts:129-132 expects message 'unavailable'.

3. File `app/tests/deno/site-context.smoke.ts` (not blocking).
   What: UNPROVEN in CI. The plan's Verification line says the smoke runs on every pull request in B8's deno step. No such step exists: ci.yml's deno step still runs `deno check ... scripts/deno-portable.ts`, which imports state.ts, media-store.ts, events.ts and reconcile.ts but not settings/service.ts, readiness.ts or job-runner/index.ts. So neither the un-mutated smoke nor `deno check` of index.ts runs in CI. CI only runs the two b16-g8-deno-* mutations through the mutation replay step. The smoke's header comment now states this honestly. ci.yml is B8 step 5's file and the orchestrator's to wire.
   Evidence: grep -n deno .github/workflows/ci.yml shows line 74 `run: deno check --config supabase/functions/job-runner/deno.json scripts/deno-portable.ts` and lines 207-213 (setup-deno before `watchfail --changed origin/main --kinds unit,sql`). There is no `deno test ... tests/deno/*.smoke.ts` line.

4. File `app/tests/unit/site-read-path.test.ts` (not blocking).
   What: B16 g3's file, not this group's. Its first case carries its own 30_000 ms timeout, which overrides the --testTimeout=60000 of bun run test and of the Verification command. It goes red under lane load: reproduced here once at 30043 ms while a check ran. The author saw it three times standalone. The file is already banked in G-031's hit-again line and the entry at GOTCHAS line 4881, but the flaky limit stays in the file. Either raise or remove the per-test timeout in a group that owns the file.
   Evidence: My first run of the ten files gave 'FAIL |unit| tests/unit/site-read-path.test.ts > the site read path > makes one public_state call and no table read in 200 reads of the service and of the route  Error: Test timed out in 30000ms.' The rerun after load dropped gave 11 passed (11).
