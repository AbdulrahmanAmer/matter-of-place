# B3 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 1,1b

1. `app/src/server/lib/db.ts` (not blocking; ranked first, for step 3b)
   - what: db.ts imports `../../db` (a folder) and `./env` with no `.ts` extension, so Deno cannot type-check any file that does `import type { Db }` from db.ts. The plan's Files line for state.ts requires exactly that import, and step 3b's G15 gate (`deno check ... scripts/deno-portable.ts`, which imports state.ts) must exit 0. As written, G15 will go red the moment state.ts lands. Invariant 19 and the eslint Deno block do not list db.ts, so no check in g1 can see it. Smallest fix: `../../db/index.ts` and `./env.ts`, or list db.ts among the Deno-checked files. Confirmed by running, not suspected.
   - evidence: A scratch probe holding only `import type { Db } from 'file:///E:/mop-build/api-review/app/src/server/lib/db.ts'`, run through deno 2.8.1 `deno check`, printed: TS2307 Cannot find module 'file:///E:/mop-build/api-review/app/src/db' (Maybe specify path to 'index.ts') at db.ts:2:31; TS2307 Cannot find module '.../src/server/lib/env' (Maybe add a '.ts' extension) at db.ts:3:21; Type checking failed, exit 1. The same probe over media-store.ts and runtime-env.ts exits 0.

2. `workspace/05-plans/trace.json` (not blocking)
   - what: Stale references in files that belong to the orchestrator, not this group. trace.json is the S53 traceability index and names 22 code files by their old route paths (src/routes/index.tsx, about.tsx, legal.tsx, $market.index.tsx, property.$slug.tsx and others). workspace/01-site-index/pages-and-wording.md still has 47 old paths (the author already flagged this one), and app/docs/architecture/frontend.md has 11. check-plans.mjs still prints OK because it does not check that the files exist, so nothing will catch this.
   - evidence: The Grep tool for `routes/(about|index|contact|...|$market)[^/ ]*.tsx` counts: trace.json 22, pages-and-wording.md 47, frontend.md 11; `node workspace/05-plans/check-plans.mjs` → OK. (Banked as P-804, which says a rename greps the whole repository.)

3. `app/src/server/lib/env.ts` (not blocking)
   - what: Suspected by reading, not run. env.ts requires RATE_LIMIT_SALT for every MOP_ENV, including local, and it parses at import, so a failure makes the whole Worker answer 500 (the log's own MOP_ENV=production proof shows this). Nothing in CI supplies the salt: `git grep RATE_LIMIT_SALT -- .github` prints nothing, and playwright's webServer reads a .dev.vars that CI never writes. Once step 3 imports env.ts into the request path, the CI e2e Worker (MOP_ENV local, which the plan says holds no GitHub secret) would likely 500 on every page. The plan makes only TURNSTILE_SECRET and SENTRY_DSN optional when local. This is a plan gap for the orchestrator or step 3, not a g1 code error.
   - evidence: env.ts:17 `RATE_LIMIT_SALT: text` (required); `git grep -n 'RATE_LIMIT_SALT|dev.vars' -- .github` prints nothing; playwright.config.ts:26 uses `--env-file "${resolve('.dev.vars')}" --var MOP_ENV:local`.

4. `workspace/05-plans/B3.md` (not blocking)
   - what: Plan text, confirmed by running: step 1b's proof `curl -s .../about | grep -c 'styles'` cannot fail, because every page already contains `rel="stylesheet"` (the fonts link, which comes from the root). The check that actually catches a missing stylesheet is `grep -ao 'assets/styles-[^"]*'`. The author reported this too, and it is the orchestrator's to fold in.
   - evidence: On the built Worker at 8829, /no-such-page and / each carry one `<link rel="stylesheet" href="/assets/styles-D8hM3mxd.css" data-precedence="default"/>` and also the fonts `rel="stylesheet"` link, so the word 'styles' matches even without the app stylesheet.

5. `workspace/05-plans/B3.md` (not blocking; the plan half of a GOTCHAS.md follow-up)
   - what: The plan's and brief's step 1 proof `node scripts/dev-vars.mjs` refuses in this machine's default shell ('refusing: ops variables in this shell CLOUDFLARE_API_TOKEN'). P-310 and bank-map line 10 name only the db tests. The rule should also cover dev-vars.mjs (`env -u CLOUDFLARE_API_TOKEN node scripts/dev-vars.mjs`), and the plan's step 1 proof line should say so. (The bank half is done: P-310 and the map now name dev-vars.mjs; the plan line is the orchestrator's.)
   - evidence: `node scripts/dev-vars.mjs` → 'Error: refusing: ops variables in this shell CLOUDFLARE_API_TOKEN', exit 1; with `env -u CLOUDFLARE_API_TOKEN -u SUPABASE_ACCESS_TOKEN` → 'wrote .dev.vars (8 keys)'.

## g2 · steps 2

1. `app/supabase/sql/functions/create_submission.sql` (migration 20261003184651_public_write_functions.sql lines 182-237) (not blocking)
   - what: Suspected by reading, not run. The 10-minute double-post check and the 30-day duplicate_of lookup both read before they insert, and no lock serialises them (STANDARDS R22 last clause, checklist C11). Two concurrent POST /submissions with the same email, address and zip, each with its own valid Turnstile token (two tabs, or a client retry while the first request is still running), both run the select before either commits. The second then blocks on the contacts upsert (unique on lower(email)), resumes once the first commits, and inserts a second submission with duplicate_of null. Not blocking: the plan itself specified the read-then-return design, and Turnstile's single-use token makes a literal double click answer 403 before the database. Fix: take pg_advisory_xact_lock(hashtext(lower(email)||':'||normalised address||':'||zip)) before the select, and add a two-connection test.
   - evidence: Lines 183-190 and 206-212 are plain selects that run before the insert at line 215. Under READ COMMITTED an earlier statement is not re-run after a lock wait. A proof would need committed writes on mop-dev, which a reviewer should not make.

2. `app/supabase/migrations/20261003184651_public_write_functions.sql` lines 80-85 (not blocking)
   - what: 'grant select, update on subject_requests to authenticated' plus the update policy lets admin and chief_editor change any column through PostgREST (email, kind, ip_hash, received_at), and status changes there without an owning function or write_audit (R21, R22). The plan prescribes exactly this, so it is a follow-up for B7 and the orchestrator: a column-level update grant or an owning function.
   - evidence: Plan Files line: 'grant select, update to authenticated for those two policies'. R22: a state column changes only through its owning function.

3. `workspace/05-plans/B3.md, B2.md, B7.md, B14.md, B16.md, trace.json (30 lines), workspace/06-architecture/architecture.md` (not blocking)
   - what: These still name supabase/migrations/20261001100000_public_write_functions.sql, but the shipped file is 20261003184651. B3's later contracts-live.test.ts line parses the old path. The P-324 'hit again' line says this went to '(B3-followups)', but B3-followups.md holds no such entry. check-plans passes because it does not check that the file exists.
   - evidence: Grep for 20261001100000 finds it in those files. Grep for 'contracts-live|20261003184651' in workspace/05-plans/logs/B3-followups.md finds nothing.

4. `app/tests/mutations/B3.json` (not blocking)
   - what: The one-hit-per-key behaviour that P-806 introduced (select distinct) has no replayable watched-fail. Its only assertion is in tests/api/ratelimit.api.test.ts, which runs over supabase-js on its own connection, so a sql mutation cannot reach it. A sql entry with a matching case in public-write.db.test.ts would make it replayable. I reproduced the claim by hand: distinct gives 3 hits, plain gives 4.
   - evidence: Rolled-back psql run of the P-806 scenario: 3 with distinct, 4 without. No registry entry mutates 'select distinct c'.

5. `app/tests/db` (rate_limit_check index use) (not blocking)
   - what: UNPROVEN, and the author says so: the explain check that rate_limit_check uses rate_limits_bucket_key_at_idx was not written. The Files list names it as a withRollback example; step 2's proof does not.
   - evidence: No explain assertion anywhere in tests/db.

6. `app/supabase/migrations/20261003184651_public_write_functions.sql` (not blocking)
   - what: UNPROVEN: the migration has never been applied from zero on CI's ephemeral stack (the db job). It is proven on mop-dev only.
   - evidence: No CI run exists for b9258e0. Proof came from migration list, function-source and the whole tests/db run against mop-dev.

## g4 · steps 4,5

1. `app/src/lib/analytics.ts` (not blocking)
   - what: New doc comment says 'The server's allow-list is this same list.' At 4eac852 no server allow-list exists. The author's own unproven list says step 10 creates it. analytics-allowlist.test.ts only compares the list with track() literals, and tsc already enforces that through the AnalyticsEvent union. So the test adds no guarantee beyond the type check until step 10 wires the server list.
   - evidence: git grep -n analyticsEvents -- src finds only src/lib/analytics.ts (the definition and the type). No importer under src/server.

2. `app/src/domain/contracts.ts` (not blocking)
   - what: The propertyCardSchema comment (line ~345) calls it 'the Zod twin of `PropertyCard` in `property.ts`', but property.ts has no PropertyCard type. Plan step 5b creates it. The schema's field set (market/region rather than the plan's marketSlug/regionSlug, plus neighborhood and status, no features or related) is not yet checked against any type, so 5b must reconcile it.
   - evidence: grep -rn "PropertyCard\b" src finds only the component in src/components/site/property-card.tsx and this comment; plan B3.md line 130 and step 5b create the type.

3. `app/src/domain/contracts.ts` (not blocking)
   - what: submissionMediaSchema.type is now z.enum(uploadLimits.types), and the wizard sends file.type unchanged with no size or type pre-filter. A .heic picked in Chrome (File.type is often '') or a photograph over 25 MB is refused only at Send, with the generic t.forms.invalid. Before this change any type and any size passed. The plan prescribes the enum, so this is not a contract break. It is a regression in user experience that step 8b (image-prep, upload queue) or the picker should close. Suspected by reading, not run in a browser.
   - evidence: src/components/forms/submit/state.ts:208 media: draft.files.map((file) => ({ name, size, type: file.type })); src/services/http/index.ts:64 already expects an empty type ('file.type || "application/octet-stream"').

4. `app/src/routes/_site.legal.tsx` (not blocking)
   - what: The legal copy still says 'Live listings show the listing agent, brokerage and licence clearly on each property page, and inquiries are routed to that representation.' That is no longer true for an owner-presented home (invariant 22, H30 (7)), which shows 'Presented by the owner' and no agent. Not this group's file; the orchestrator should fold it.
   - evidence: sed -n 32,38p app/src/routes/_site.legal.tsx

5. `workspace/01-site-index/pages-and-wording.md` (not blocking)
   - what: The site index still describes the submit wizard step 3 as 'Representation' with fields 'Listing agent; Brokerage; Agent email; Agent phone' under 'Today:' (lines 357, 371-372). It shows the eyebrow as planned (line 176) and the Representation block without its owner variant (line 118). The code changed all of these in this group. Not this group's file.
   - evidence: git grep -n -i "representation\|FOR AGENTS" -- workspace/01-site-index

6. `app/tests/api/parity.api.test.ts` (not blocking)
   - what: The parity proof depends on mop-dev holding exactly the bundled seed, published, with nothing else published. A property another lane publishes on mop-dev turns it red. R52 also says CI database tests run against a database built from the branch's migrations, and ci.yml has no db job yet. When B4 step 8 adds one, that database needs the bundled seed or this test fails there. UNPROVEN outside the laptop.
   - evidence: grep -n 'run:' .github/workflows/ci.yml shows only check, build and merge-gate jobs; the vitest db project includes tests/api/**/*.api.test.ts.

7. `app/tests/mutations/B3.json` (not blocking)
   - what: The plan names watched-fail letters (g), (h), (l), (ee) and (jjj) for this group. They are registered as b3-g4-parity-*, b3-g4-an-listed, b3-g4-cl-41, b3-g4-cl-kinds and b3-g4-ss-owner-brokerage, not as b3-g, b3-h, b3-l, b3-ee and b3-jjj, while earlier groups used the letter ids (b3-kkk, b3-dd). The mapping is only in the log. Also, (ee) mutates the Zod list instead of the SQL check the plan names. It is equivalent for this equality test, but different from the plan.
   - evidence: node -e listing of ids: no b3-g, b3-h, b3-l, b3-ee or b3-jjj; log B3.md g4 paragraph 'Plan letters covered'.

8. `workspace/05-plans/logs/B3.md` (not blocking)
   - what: Small inconsistency. The log says 'the last full pass printed WATCHED-FAIL OK for 32', but the author's report says '32 ... on the first full pass' and then two were fixed. The final state reproduces 34 of 34 OK, so the count claim is harmless, but the log sentence is muddled.
   - evidence: My replay: 34 of 34 WATCHED-FAIL OK.

## c3 · steps 3,3b

1. `workspace/05-plans/logs/B3.md` (not blocking)
   - what: The g5 block (line 371) still says '`--only zz-none` reports `stale 0` over 1158 entries'. That is the same false proof P-819 withdraws, and it was also false when it was written: g5's edits had made b3-g3-state-visibility, b3-u and b3-g3-readpath-write stale, which this round repaired. Round 2 withdrew only its own c3 line (337). A reader of the log still finds an unwithdrawn 'stale 0' claim. This is g5's block, not c3's, so it is a follow-up for the g5 review or the orchestrator.
   - evidence: grep -n 'stale 0' workspace/05-plans/logs/B3.md -> 371: '... `--only zz-none` reports `stale 0` over 1158 entries.'; `watchfail --only zz-none` exits 64 having counted no find

2. `app/tests/mutations/B1b.json, app/tests/mutations/B2.json, workspace/05-plans/logs/B3-followups.md` (not blocking)
   - what: Edits made by this slice left three entries in other slices' registries guarding nothing. B1b aa-nonpage (find x0) and x-redirect (find x2) broke when step 3 edited src/server/lib/pipeline.ts. B2 g11-rows-editorial-state (x0) broke when g4 edited scripts/lib/rows.ts. B3's own b3-g3-redirect-final-header mutates the line aa-nonpage used to mutate, but it checks the redirect case. B1b's 'leaves the Cache-Control of /sitemap.xml alone' guarantee now has no replayable watched-fail. The author named these in the log but says they are 'not yet in B3-followups.md'. They belong to other writers, so this is a follow-up: record them in B3-followups.md and have the owning registries re-point them.
   - evidence: My find-count: 909 file entries, 9 stale, including B1b.json:aa-nonpage x0, B1b.json:x-redirect x2, B2.json:g11-rows-editorial-state x0. `grep -n 'return response;' src/server/lib/pipeline.ts` -> lines 142 and 237

3. `app/src/server/public/state.ts` (not blocking)
   - what: Suspected by reading, not run. The new guard (line 156) stores a load only when its version is not lower than catalogFor. If settings.catalog_version ever drops (a manual reset or restore of the settings row on mop-dev), a warm isolate never memoises the lower version. Every request whose state names it then pays a public_catalog_snapshot call until the isolate is recycled. Normal operation is safe: bump_catalog_version only adds 1. A follow-up note, not a defect of the step.
   - evidence: state.ts:156 `if (!(state.catalogVersion < catalogFor))` together with readCatalog:166 `catalogFor === state.catalogVersion`; supabase/sql/functions/bump_catalog_version.sql only increments

## g5 · steps 5b,6

1. `app/src/styles/components/turnstile.css` (not blocking)
   - what: STANDARDS R42 (and C18) says spacing and z-index come from var(--token), and the plan says 'the container, tokens only'. The file uses the literals `inset-block-end: 20px; inset-inline-end: 20px; z-index: 110;`. app/src/styles/tokens.css defines no spacing or z-index token, and every other component stylesheet uses literal z-index values (dialogs.css 100, header.css 50, overlays.css 90). So the group cannot meet the rule as written, and the gap is between R42 and tokens.css. The orchestrator should either add layer and spacing tokens or narrow R42 to colour. No product input breaks because of it.
   - evidence: In the snapshot: `grep -n 'z-\|--space' src/styles/tokens.css` prints nothing. `grep -rn 'z-index' src/styles` shows literals in base.css, cards.css, dialogs.css, hero.css, header.css, overlays.css and turnstile.css.

2. `workspace/05-plans/logs/B3-followups.md` (not blocking)
   - what: The card byte budget is still open and is not yet in B3-followups.md, which has no g5 section. The real bundled cards measure 527 to 638 bytes and 7 of 16 are over the 600 that PERF-06 sets. The mappers.test.ts card case passes because its fixture (rich()) is under 600, so the plan's '-t card' proof is green while real data breaks the budget. B4's tests/api/payload-budget.api.test.ts does not exist yet and will hit this when it lands. The author logged it as a plan ruling for the orchestrator (log line 508, P-818). It needs to reach the follow-ups file so it is not lost.
   - evidence: In the snapshot, the bun -e P-818 proof extended with a count prints `527 638 7`. ls app/tests/api shows no payload-budget.api.test.ts. grep -n '^## ' workspace/05-plans/logs/B3-followups.md lists g1, g2, g4 and c3 only.

3. `app/src/server/lib/headers.ts` (not blocking)
   - what: UNPROVEN on a deployed Worker (suspected fine, judged by reading only). supabaseOrigin() reads SUPABASE_URL through readVar, which reads globalThis.process.env. This relies on nodejs_compat filling process.env (compatibility_date 2026-09-30), the same mechanism env.ts relies on. headers.test.ts proves connect-src only in-process. No curl of a built or previewed Worker shows connect-src holding the Supabase origin. If it is missing, browser uploads to signed Storage URLs are blocked by CSP. The real Turnstile widget has also never run in a browser, as the log admits.
   - evidence: The test is unit-only (tests/unit/headers.test.ts). `grep -n compat .output/server/wrangler.json` gives nodejs_compat with compatibility_date 2026-09-30. No preview curl appears in the g5 log blocks.

## g6 · steps 7,8

1. `app/tests/unit/subrequest-budget.test.ts` (not blocking)
   - what: The test counts fakeDb call-log entries plus a siteverify spy. The plan's Files line asks for a real supabase-js client on a counting fetch, and it says why: 'here fakeDb would hide the fetches being counted'. The slice log does not record this deviation. If supabase-js ever made a hidden extra fetch (a retry, an auth call), this gate would not see it.
   - evidence: Test lines 46-63 and 99-108 build fakeDb({...}) and assert siteverify.mock.calls.length + db.calls.length <= 35. I measured with a real client on a counting fetch: 23 outbound calls for POST /submissions (40 media) and 22 for /uploads. That equals the plan's arithmetic, so the shipped behaviour is right today. The test still measures a proxy.

2. `app/src/server/public/pipeline.ts` (not blocking)
   - what: Invariant 11 says a bot that fills the honeypot 'learns nothing from the response'. For POST /submissions the trap answers {id, receivedAt} only. A real answer always carries upload_token and uploads, so a bot can tell it was caught by comparing shapes. On /submissions/:id/uploads the trap answers 201 where a real call answers 200.
   - evidence: pipeline.ts write(): `if (filled) { ... return Response.json({ id: crypto.randomUUID(), receivedAt: ... }, { status: 201 ... }) }` runs before the route's own status and shape are known. SubmissionReceipt in submissions/service.ts adds upload_token and uploads (read, not run).

3. `app/docs/architecture/services.md` (not blocking)
   - what: Line 59 still says a signed upload URL is 'valid 15 minutes' and the path is '<submission id>/<sanitised name>'. The plan's Risks asked step 8 to check the lifetime and correct this doc. The author measured 7200 s (P-820) and left the doc as it was, calling it the superseded sketch. This file is the orchestrator's to fold.
   - evidence: grep -n '15 minutes' app/docs/architecture/services.md -> 59: '... path `<submission id>/<sanitised name>`, valid 15 minutes ...'

4. `app/tests/mutations/B3.json` (not blocking)
   - what: Four API-level watched-fails are UNPROVEN: (hhh) the plain-insert contacts upsert going red on 23505 in submissions.api.test.ts, (iii) the kept kind, the 10-minute double post, and the 11-day duplicate_of. They are registered as manual entries (b3-hhh, b3-g6-sub-double, b3-g6-sub-duplicate). Their SQL mutations replay only in the rolled-back public-write.db.test.ts. The author declared this; it should close when CI's db job can replay SQL mutations against the API tests.
   - evidence: Registry entries with kind 'manual' and procedure text citing P-901 and R18; watchfail reports 'manual 0 not replayed' for the selected ids.

5. `app/src/server/submissions/reconcile.ts` (not blocking)
   - what: Two filters have no test: the staging/ skip and the since-minus-2-hours window. The fakeDb table answers all rows whatever the filter, and no reconcile.test row sits under staging/. A mutation that drops `.filter((row) => !row.storage_path.startsWith(STAGING))` or the `.gt(...)` would stay green.
   - evidence: tests/fixtures/fake-db.ts: 'a registered table answers the rows the query is meant to return' (is/gt/eq ignore their arguments). reconcile.test.ts rows are s1/*.jpg only (read, not mutated by me).

6. `app/src/server/submissions/reconcile.ts` (not blocking)
   - what: R04 and C04: three exports have no importer and no /** @public */ tag. They are `ImageType` and `ReconcileCounts` in reconcile.ts, and `SubmissionReceipt` in submissions/service.ts. I suspect knip misses SubmissionReceipt because routes.ts namespace-imports the service (`import * as submissions`); this is suspected from reading, not run.
   - evidence: grep -rn 'ImageType|ReconcileCounts|SubmissionReceipt' src tests scripts outside src/server/submissions/ prints nothing.

7. `workspace/05-plans/STANDARDS.md` (not blocking)
   - what: R13 asks every anonymous route for at least one memory limit and one database limit. The plan gives POST /submissions/:id/uploads only its DB limit of 12 per hour per IP ('take only the limit of their own row'). The route follows the plan, so the conflict is between the two documents and is the orchestrator's to settle.
   - evidence: routes.ts uploads row: limits: [{ scope: 'ip', store: 'db', limit: 12, windowSeconds: HOUR }]; R13 text at STANDARDS.md line 148.

Two further g6 follow-ups concerned `GOTCHAS.md` and are banked there, not here: the missing hit-again line in P-1001 (added) and the reviewer's P-809 cost (hit-again line in P-809 and the new entry P-825).

## g7 · steps 8b,9

1. `app/src/components/forms/submit/wizard.tsx` (not blocking)
   - what: STANDARDS R45 says every public user action calls track() with an AnalyticsEvent name. The new Retry button in UploadStatus calls no track(). The author lists this as UNPROVEN and a follow-up. The fix is the analytics-event path (a new analyticsEvents name), which is the orchestrator's to schedule. It is not blocking: the existing Next, Back and Start again buttons do not track either, and a Retry click going uncounted in GA4 breaks no contract line.
   - evidence: grep -n track src/components/forms/submit/wizard.tsx shows only line 76, track("submit_property"). UploadStatus's onClick={() => void retry()} has none.

2. `app/src/server/public/routes.ts` (not blocking)
   - what: Plan and STANDARDS disagree. R13 says every anonymous route declares at least one memory and one database limit. The new GET /subscribers/confirm row has only a database limit (20 per hour per IP), and /api/hooks/resend has none. Both match the plan's route table ('20 per hour per IP (DB)'; 'none (signature)'), and the existing submissions/:id/uploads row has the same shape. The orchestrator should reconcile R13 with the plan. The group followed the plan.
   - evidence: routes.ts confirm row: limits: [{ scope: "ip", store: "db", limit: 20, windowSeconds: HOUR }], form unset; hook row: limits: []

3. `workspace/05-plans/B3.md` (not blocking)
   - what: A plan line is now stale (orchestrator's file). The Files line for upload-queue.ts gives runUploadQueue({ submissionId, uploadToken, entries, files, fetchMore, onProgress }). The built queue takes { entries, files, fetchMore, onProgress }, with the id and token bound inside fetchMore by submissions.send. The B3 log records this decision, but the plan line still names the old signature.
   - evidence: app/src/services/http/upload-queue.ts QueueOptions has no submissionId/uploadToken; log B3.md g7 'runUploadQueue takes { entries, files, fetchMore, onProgress }'

4. `app/src/services/http/index.ts` (not blocking)
   - what: Suspected from reading, not run. The queue is started with `void runUploadQueue(...)` and nothing catches its rejection. putOnce resolves false on onerror, but a synchronous throw from XMLHttpRequest.open or send (for example a malformed signed URL) rejects the Promise executor. That rejection reaches run(), and the queue ends as an unhandled rejection with no final report(). The wizard would then show 'Uploading n of m' indefinitely and never offer Retry. Low likelihood, because the URLs come from our own signing call. Worth a .catch that marks the entry failed.
   - evidence: upload-queue.ts putOnce: new Promise((resolve) => { request.open("PUT", url); ... }) has no reject path; worker loop has no try; index.ts: void runUploadQueue({...})

5. `workspace/05-plans/logs/B3.md` (not blocking)
   - what: One proof cannot be re-run (P-088). The signed, replayed and forged delivery against the local Worker came from a scratch probe that was never committed. I reproduced it with my own probe (200 / 200 / 401, plus a stale 401). A follow-up could make it repeatable by adding a signed /api/hooks/resend call to scripts/api-smoke.mjs, signed with the .dev.vars secret.
   - evidence: log g7: '(local Worker) a delivery signed with the .dev.vars secret, its replay, and a forged one (scratch probe, receipt removed)'

A sixth g7 follow-up concerned `GOTCHAS.md` and is banked there, not here: the worker-start timeout of `bun run check` under a parallel db suite (hit-again line in P-712, with P-329 and the G-031 hit-again line folded into it).
