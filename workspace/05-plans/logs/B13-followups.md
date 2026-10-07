# B13 follow-ups: the orchestrator folds or assigns each before the slice closes

## c1 · steps 1,2

Source: the fresh reviewer of group c1, none blocking. Two reviewer items (the GOTCHAS.md cost lines and the reviewer's own hit of P-1800/P-008) went into the bank as hit-again lines of P-076, P-090, P-008 and P-1800 and are not repeated here.

1. File `app/src/lib/seo-copy.ts` (not blocking).
   What: storyDescription and regionDescription pass the whole deck or intro to compose as one 'sentence'. A multi-sentence deck longer than 155 characters goes to cutAtWord and ends inside its second sentence with an added full stop. That is the same visible symptom as the defect that got g1 rejected, but here it comes from the input text, not from the padding. The plan allows 'cut at a word', so this is not a contract break. Still, the module comment says 'whole sentences are added while they fit', and the test called 'never ends mid-sentence' checks only bundled data, where every deck is 70 characters or shorter. P-1803's own rule says to sweep every input length, but the sweep stops at 69.
   Evidence: Confirmed by running: storyDescription({deck:'The house sits above the canyon and has been in one family since 1952. Its owners kept the original redwood panelling, the clerestory windows and the long kitchen, and added a studio for the garden and the light.'}) returns '... Its owners kept the original redwood panelling, the clerestory windows and the long.' The database column is `deck text not null` with no length check (20261001090300_catalog.sql:220).

2. File `app/src/lib/seo-copy.ts` (not blocking).
   What: compose returns an empty string for an empty deck (cutAtWord('') returns ''). A whitespace-only deck returns a description with leading spaces. Both break the stated 70 to 155 contract. Nothing upstream stops it: the story publish gate (fn_enforce_publish_gate_stories) checks no story fields, and the deck column allows ''. A published story with an empty deck would ship <meta name="description" content="">. This is a follow-up and not blocking because an editor would rarely publish an empty deck.
   Evidence: Confirmed by running: storyDescription({deck:''}) returns "". Read: 20261003082557_fn_enforce_publish_gate_stories.sql only checks properties columns.

3. File `app/tests/unit/csp-inline.test.ts` (not blocking).
   What: Still UNPROVEN (carried over, the author reports it): the plan's hash-set equality assertion (hostile render gives the same B17 inlineHashes set as the clean render) is not there, because B17's inlineHashes does not exist in the repo (grep finds it only in plans). In its place the test compares script-element counts. The story page has no JSON-LD case in this group. Its structured data comes from g2's unfinished WIP commit 5464d28, which is in this branch but outside this group.
   Evidence: Grep 'inlineHashes' over the snapshot: matches only in workspace/05-plans/*.md, trace.json and the comment at csp-inline.test.ts:3.

4. File `workspace/05-plans/logs/B13.md` (not blocking).
   What: Wording: the c1 block's Proof 4 heading says check and build ran 'after the last edit', and the next paragraph says the build ran before the last test-only edit. The fact holds (I re-ran the build on d42c09f and it exits 0), but the heading overstates it.
   Evidence: logs/B13.md c1 block, Proof 4 heading compared with the paragraph after it.

## c3 · steps 3

Source: the fresh reviewer of group c3, none blocking. The GOTCHAS.md items of the review (the false rule line of P-1804, the missing hit-again of P-015, the reviewer's own hit of P-712) went into the bank and are not repeated here.

1. File `app/tests/e2e/fixtures/routes.ts` (not blocking).
   What: jsonLdExpectations.archive is ["CollectionPage", "ItemList"], but collectionLd (app/src/lib/jsonld.ts) puts the ItemList inside CollectionPage.mainEntity. typesOf in tests/e2e/fixtures/jsonld.ts reads only top-level @graph nodes, so no page built with collectionLd can ever show "ItemList". When step 4's archive route uses collectionLd and the archive_pages flag is on, the sweep goes red on `ld+json types of a archive page`. The log says this expectation is done; it cannot be met by the group's own builder. Follow-up for step 4: either flatten the ItemList into its own graph node or expect only CollectionPage.
   Evidence: Confirmed by reading and by the group's own test: tests/unit/jsonld.test.ts lines 169-171 assert validateHtml(pageHtml([collectionLd(...)])) toEqual ["CollectionPage"]. On the built Worker, /markets and /stories validate as `CollectionPage, BreadcrumbList` with no ItemList node.

2. File `app/scripts/validate-jsonld.ts` (not blocking).
   What: The validator checks the required fields of each node it finds, but not that a page carries the types its page type expects. A property page that lost its RealEstateListing node and kept only BreadcrumbList would still print `ok` and exit 0. This script is the CI seo step for structured data (invariant 12). Today the e2e sweep is the only gate on per-page types. Follow-up: in bare-base mode, check each picked page against the expected types.
   Evidence: Suspected by reading: validateHtml (lines 75-102) returns whatever types are present, and main() (line 150) prints ok without comparing them to anything. Nothing in jsonld.test.ts covers a page that is missing an expected type.

3. File `app/src/lib/seo.ts` (not blocking).
   What: Step 3 is still NOT DONE / UNPROVEN on two counts. First, the organizationJsonLd extension (logo, contactPoint) and organization-jsonld.test.ts wait on B16, which I confirmed is absent from origin/main a74a75f. Second, the four routeFileCoverage entries wait on steps 4, 6 and 7. Until then the home route keeps an inline Organization node. pageHead's jsonLd type is loosened to `object`, so that inline node is not typed with schema-dts. These are to be recorded, not dropped. The step-3 proof command also exits 0 while the second test file is missing, so it cannot show the Organization cases.
   Evidence: `git grep -l organizationJsonLd origin/main -- app` prints nothing. `bunx vitest run tests/unit/jsonld.test.ts tests/unit/organization-jsonld.test.ts` prints Test Files 1 passed, exit 0.

4. File `workspace/05-plans/logs/B13.md` (not blocking).
   What: The plan names localhost:8080 for the validator proof. The author ran it on the built Worker instead, saying the dev server answered 503 (P-331). The same session's watched-fail ran the dev server successfully with `env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY`, the fix P-331 already gives. So the plan's own proof could have run as written. My built-Worker rerun gave the same result, so the substitution hid nothing.
   Evidence: Log c3, Proof 2 ("answered 503 in this shell, P-331") compared with Proof 4 ("run with env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY" on E2E_TARGET=dev, which worked).

## c3 · steps 3

Source: the second fresh reviewer of group c3 (the first review's items are in the section above; entries that repeat one of them are kept as the reviewer wrote them). None blocking. The three GOTCHAS.md items went into the bank (P-1812 new, hit-again lines on P-1805 and P-712) and are not repeated here.

1. File `app/tests/e2e/fixtures/routes.ts` (not blocking).
   What: Confirmed by running: `jsonLdExpectations.archive` is ["CollectionPage", "ItemList"], and no archive page can currently satisfy it. `collectionLd` puts the ItemList inside `mainEntity` as a nested object, but both the sweep's `typesOf` (tests/e2e/fixtures/jsonld.ts) and `validateHtml` read only the top-level `@type` of each graph member. Once step 4 builds the archive route with `collectionLd` and the archive_pages flag is on, every archive URL in the sweep will fail with 'ld+json types of a archive page ... ItemList'. Nothing is broken today because no archive route exists. The fix belongs in step 4: either the archive head emits a separate top-level ItemList node, or the expectation or fixture is changed to accept the nested one. The plan text prescribes both halves, so the orchestrator should settle which.
   Evidence: A scratch bun script ran collectionLd("city",...) through pageHead and then validateHtml. It printed `top-level types: [ "CollectionPage" ] archive expects: [ "CollectionPage", "ItemList" ] missing: [ "ItemList" ]`.

2. File `workspace/01-site-index/pages-and-wording.md` (not blocking).
   What: Stale prose that this group did not touch. Row 20 still says the property page emits 'JSON-LD SingleFamilyResidence'; it now emits RealEstateListing, BreadcrumbList and, when there is a film, VideoObject. Row 18 says home emits Organization only; it now also emits WebSite. None of the market, region, stories, markets, properties, about, contact, submit, legal or editorial-standard rows mention their new CollectionPage or BreadcrumbList blocks.
   Evidence: `git grep -n SingleFamilyResidence` matches only workspace/01-site-index/pages-and-wording.md:20. `grep -o 'JSON-LD[^|]*'` on that file gives lines 18, 20, 31 and 35 only.

3. File `app/scripts/validate-jsonld.ts` (not blocking).
   What: In bare-base mode the script reads only `<base>/sitemap.xml` and hard-codes `/` and `/faq`. The plan says it also reads `staticSitemapPaths`, but that constant does not exist until step 5's sitemap.ts. The result is the same today. Step 5 should switch the validator to read the constant, or the plan line should be folded. The B13 c3 log does not list this deviation.
   Evidence: Reading `pagesOf` and `pageTypes` in app/scripts/validate-jsonld.ts. `git grep staticSitemapPaths` finds only plan text.

4. File `workspace/05-plans/B13.md` (not blocking).
   What: The code departs from the plan's Files line in two documented ways that the plan does not reflect. `propertyListingLd(property)` takes no `assets` argument, because the variants are on the property. `faqJsonLd` is not re-exported from jsonld.ts, because a re-export nothing imports would fail knip and R04. Both choices are sound. The orchestrator should fold them into the plan so that step 13 and B17 line 36 do not look for those names.
   Evidence: app/src/lib/jsonld.ts signatures. B13 c3 log, NOT DONE bullet 3.

5. File `app/src/routes/_site.index.tsx` (not blocking).
   What: Still to do when B16 lands (the author recorded this as NOT DONE, P-1804). Home keeps an inline Organization node built from siteConfig (name, url, parentOrganization), with no logo, sameAs or contactPoint. Step 3's organizationJsonLd extension, organization-jsonld.test.ts and plan watched-fail (q) are UNPROVEN until B16's organizationJsonLd is on main. After that, the inline node must be replaced by the re-exported builder.
   Evidence: `git grep -c organizationJsonLd origin/main -- app` exits 1, with origin/main = remote main 446ff04.

6. File `app/tests/e2e/fixtures/routes.ts` (not blocking).
   What: Still to do in steps 4, 6 and 7 (NOT DONE, P-1804). The routeFileCoverage entries for robots[.]txt.ts, llms[.]txt.ts, llms-full[.]txt.ts and _site.archive.$kind.$slug.tsx are missing, because routes-covered.test.ts fails on an entry whose file is absent. Step 3's proof 'routes-covered passes with the four new route files' is NOT DONE until those steps land.
   Evidence: `ls app/src/routes | grep -E 'robots|llms|archive'` printed nothing. Only sitemap[.]xml.ts exists.

## g1 · steps 4

Source: the fresh reviewer of group g1 (second run), none blocking. The two GOTCHAS.md items (the GitHub Actions billing refusal that leaves the CI db proof BLOCKED, and the missing hit-again of P-310) went into the bank as hit-again lines of P-524 and P-310 and are not repeated here. The U+0300 to U+036F range is written in words below, because the tools turn the escape into the raw characters (P-008).

1. File `app/src/server/seo/archive.ts` (not blocking).
   What: archiveHref is exported, but only tests/unit/archive.test.ts calls it. The property page links through facetMap and ArchiveLink instead. The plan names archiveHref, so building it was asked for, but no production consumer is planned (listFacets at least feeds the later sitemap step). R04/C04: either give it a consumer or drop it from the plan.
   Evidence: grep -rn "archiveHref\|listFacets" src --include=*.ts --include=*.tsx | grep -v src/server/seo/archive.ts prints nothing

2. File `app/supabase/migrations/20261005034629_archive_facets.sql` (not blocking).
   What: Suspected by reading, not run: the view's slug only mirrors slugify for ordinary labels. The SQL strips only U+0300-U+036F and splits on locale-dependent [:alnum:]. slugify strips every \p{M} and splits on \p{L}\p{N}. A label with a combining mark outside that block, or a letter that the database locale's [:alnum:] does not class as a letter, would give a different slug in the view than in memory. archive.db.test.ts would then report a mismatch that the Worker never shows. The Worker reads only the in-memory side, so pages are not affected.
   Evidence: src/lib/slug.ts: .replace(/\p{M}/gu, "") and /[^\p{L}\p{N}]+/gu; migration: regexp_replace(normalize(f.source, nfkd), '[<U+0300>-<U+036F>]', '', 'g') and '[^[:alnum:]]+'

3. File `workspace/05-plans/logs/B13.md` (not blocking).
   What: C22 is not answered. The new public archive route, and the extra getArchiveFacetsFn server-function call that every property-page load now makes, state no unit cost. On client navigation that call goes to /_serverfn/, which the pipeline never stores at the edge (NOT_PAGE_PREFIXES), so every client navigation to a property page, once its 5-minute staleTime has run out, is one more Worker request answered from memory. The cost is likely small, but it is not recorded.
   Evidence: src/server/lib/pipeline.ts:35 NOT_PAGE_PREFIXES includes "/_serverfn/"; src/routes/_site.property.$slug.tsx loader adds queryClient.ensureQueryData(archiveFacetsQuery()); grep -n 'P-009\|unit cost' workspace/05-plans/logs/B13.md finds nothing for step 4

4. File `workspace/05-plans/B13.md` (not blocking).
   What: The plan's Files list should be folded to match the tree: src/domain/archive.ts (new; it fits the src/domain folder-map row) and the edits to tests/e2e/fixtures/routes.ts, tests/unit/analytics.test.ts and tests/mutations/B3.json fall outside the group's file list. They are logged as deviations, as are the loader-fed ArchiveLink (no useQuery, no slugify), getArchiveFacetsFn returning { catalog_version, facets }, jsonLdExpectations.archive = ["CollectionPage"], the beacon flushed by visibilitychange instead of page.close, and watched-fail (t) done on style instead of year_built.
   Evidence: git show --stat 01b336d lists app/src/domain/archive.ts, app/tests/unit/analytics.test.ts and app/tests/e2e/fixtures/routes.ts; 2d1b81c changes app/tests/mutations/B3.json; log lines 180-189 and 266-268

5. File `app/tests/mutations/B3.json` (not blocking).
   What: b3-g4-an-unique is re-anchored on "archive_view" being the last name in analyticsEvents. The next lane that appends an event will make it STALE again, the same way B3b and this group already broke it.
   Evidence: git show 2d1b81c: find changed from '"home_finder",\n] as const;' to '"archive_view",\n] as const;'; the log's Proof 7 records the earlier 'STALE B3:b3-g4-an-unique: find occurs 0 times'

## c5 · steps 5

Source: the fresh reviewer of group c5, none blocking. Three reviewer items about GOTCHAS.md (the proof of P-1814 that cannot fail, the sed cost with no entry, the P-712 hit) and the unreadable bank diff went into the bank (P-1814 proof fixed, P-1817 new, hit-again lines on P-064, P-072 and P-712) and are not repeated here.

1. File `app/src/server/seo/sitemap.ts` (not blocking).
   What: UNPROVEN, not a defect of this group's code. The step 5 live proof 'every sitemap URL answers 200 without a redirect' fails on this tree, and I reproduced the author's result exactly. /privacy, /terms, /accessibility and /cookies return 404 because B16 and B17 are not merged. /place-notes returns a 301 to /stories. The plan dictates this staticSitemapPaths list, and P-1814 rightly forbids dropping paths to turn the check green. One correction: the author's report says 'B5 merged' and suggests the orchestrator 'drop /place-notes'. B5 is not finished. B5.md lines 119 and 168 give step 7 the job of replacing the 301 with the page, and POSITION shows B5 steps 5 to 9 still to run. B13 has to land after B16, B17 and B5 step 7, or step 9's check-seo stays red. The orchestrator owns that ordering.
   Evidence: curl loop on the live build at port 8929 over the 24 <loc>: 'ok 19 bad 5' (404 /privacy, 404 /terms, 404 /accessibility, 404 /cookies, 301 /place-notes); app/src/routes/_site.place-notes.tsx throws redirect({ to: "/stories", statusCode: 301 }); workspace/05-plans/B5.md:119 'src/routes/place-notes.tsx — replaces the 301 to /stories with a page'

2. File `app/src/server/seo/sitemap.ts` (not blocking).
   What: Taken-down properties still count toward archive facets. buildSitemap removes gone slugs from its own property list but passes the unfiltered `source` to listFacets(source, state). A property that is still editorial_state='published' with taken_down_at set appears in both the snapshot's properties and its gone list, because no constraint forbids that state (catalog_version.sql:274 and :321). Such a property still counts toward the 3-property threshold, so the archive page is listed with only 2 live properties. Contract 10 says taken-down properties are absent from archive counts, and the archive page itself (step 4's archive.ts) counts the same way. The plan gives that exclusion to step 11's gone.ts, so this is a follow-up for step 11. By reading only: the head() of the three list pages also counts the pool without removing gone slugs, so a head and the sitemap could disagree in the same case.
   Evidence: Confirmed by running: a bun probe of buildSitemap over three Modernist properties with gone: ["c"] and archive_pages on printed /archive/style/modernist next to /property/a and /property/b only

3. File `app/tests/unit/sitemap.test.ts` (not blocking).
   What: Known follow-up, still open. The test 'keeps a path whose redirect row is archived, because the snapshot never carries it' only runs with redirects: [], so it cannot show an archived row. Its mutation b13-s5-sm-redirect-archived adds a special case for /about to make it fail. The real behaviour lives in SQL (where rd.enabled) and is covered by tests/db/public-reads.db.test.ts.
   Evidence: tests/mutations/B13.json b13-s5-sm-redirect-archived replaces `!redirected.has(path)` with `!redirected.has(path) && path !== "/about"`

4. File `app/src/server/seo/sitemap.ts` (not blocking).
   What: Known follow-up. The hero's image:caption is the property title, not alt text as the plan says, because Property exposes no hero alt.
   Evidence: imagesOf: { address: property.heroImage, caption: property.title }

## c6 · steps 6

Source: the fresh reviewer of group c6, none blocking. Two reviewer items about GOTCHAS.md are banked (P-1818, and a hit-again line on P-140), not listed here.

1. File `app/tests/mutations/B13.json` (not blocking).
   What: The single-file proof and all 16 b13-s6 registry 'run' lines use a bare 'bunx vitest run'. That runs with vitest's 5000 ms default timeout, not the 60 s that 'bun run test' sets. On a cold transform cache the route test, which dynamically imports robots[.]txt.ts inside the test body, times out. The 'expect' of b13-s6-robots-route-kind ('FAIL .*the robots route > stores the indexable body as a doc') also matches that timeout. So a cold replay of that entry can print WATCHED-FAIL OK for the wrong reason. The bank already holds this rule (P-140: run a single-file proof as 'bun run test <file>' or add --testTimeout=60000). This group's proof line and registry did not follow it. Confirmed by running.
   Evidence: First run of 'bunx vitest run --project unit tests/unit/robots.test.ts' in the fresh snapshot: 'x stores the indexable body as a doc ... 5916ms', 'Error: Test timed out in 5000ms', 'Tests 1 failed | 22 passed (23)', exit 1. The next two runs: 23 passed. bun run check (60 s timeout) was green.

2. File `workspace/05-plans/STANDARDS.md` (not blocking).
   What: Stale prose after the deletion. The folder-map row for public/ (line 87) still lists 'robots.txt' among the static files served as-is. app/docs/README.md line 34 says 'public/ static files served as-is (favicon, robots, ...)'. app/scripts/check-layout.mjs line 152 still allows 'public/{_headers,robots.txt,sw.js,offline.html}'. These are not this group's files: the orchestrator should fold them. robots.test.ts 'the static file > is gone' is what actually stops a re-added file in CI. Found by reading.
   Evidence: grep -rn robots workspace/05-plans/STANDARDS.md app/docs/README.md app/scripts/check-layout.mjs → STANDARDS.md:87, README.md:34, check-layout.mjs:152

3. File `app/tests/unit/audit/scope-check.test.ts` (not blocking).
   What: The audit robot's scope check still lists 'app/public/robots.txt' as a path the robot may write (line 60). That is the exact file whose existence silently shadows the dynamic route and turns off the preview-host Disallow. robots.test.ts would turn such a PR red, so this is not a live hole. Still, the audit slice's allow-list should name the route file or nothing. Not this group's file. Found by reading.
   Evidence: sed -n 50,62p app/tests/unit/audit/scope-check.test.ts shows "app/public/robots.txt" in the allowed list

4. File `app/src/routes/robots[.]txt.ts` (not blocking).
   What: Suspected by reading, not measured. UNPROVEN. The indexable branch goes through cachedResponse, which calls readState(db) before it looks in the cache. On a fresh isolate with the database unreachable and no last-good doc copy, serveLastGood rethrows and the apex robots.txt answers 503, even though its body is a constant. Crawlers read a 5xx robots.txt as a temporary full disallow. The plan's Contract prescribes cachedResponse for this route, so this is a plan-level weakness, not a builder defect.
   Evidence: cache.ts lines 173-179: readState failure → serveLastGood → 'if (kept === undefined) throw failure'

## g1 · steps 7

Source: the fresh reviewer of group g1, none blocking. No follow-up named GOTCHAS.md as its file, so none went into the bank.

1. File `app/src/routes/__root.tsx` (not blocking).
   What: Nothing tests the root loader that carries ogStatic. og.test.ts gives the route heads their matches directly, so deleting the `loader` from __root.tsx (line 25, ensureQueryData(ogStaticQuery())) would leave every unit test and every registry entry green. Through the whole chain, the newer-card path (settings.og_static row, then getOgStaticFn, then root loader, then head) is UNPROVEN until a row exists and MEDIA_PUBLIC_BASE is set on a deployed Worker. The author's unproven list does not name this path.
   Evidence: Suspected from reading, not run: og.test.ts lines 153-157 build `matches` themselves; none of the 42 b13-g1 registry entries mutates __root.tsx. Live curls on 8929 all printed the committed /og/static/*.png fallback, which is the same output with or without the loader.

2. File `app/src/routes/llms[.]txt.ts` (not blocking).
   What: No unit test or registry entry covers the two llms route handlers (content-type text/plain, cachedResponse 'doc' with sMaxAge 3600 and tags ['seo']). They are proved only by the live-build curl, so a later edit that drops the tag or the content-type would not fail CI until step 13's validate-llms or check-seo exists.
   Evidence: git diff 183b6ba..c9a4662 -- tests/mutations/B13.json has no entry whose file is src/routes/llms[.]txt.ts or llms-full[.]txt.ts. My live curl confirmed both headers are correct today.

3. File `workspace/05-plans/logs/B13.md` (not blocking).
   What: STANDARDS C22: the new public routes /llms.txt and /llms-full.txt and the new browser-callable server function getOgStaticFn (fired by the root loader on client navigation) state no unit cost (Worker requests, Supabase calls) and no P-009 line in the g1 log block.
   Evidence: The g1 block in logs/B13.md has no unit-cost or P-009 line. By reading: each is one memoised public_state RPC per interval per isolate, so the cost is small, but C22 asks for it to be written down.

4. File `app/src/server/automation/step-specs.ts` (not blocking).
   What: purge_cache keeps `sideEffect: "none"`, but with indexnow true it now makes an outside GET to api.indexnow.org. A second run after a crash pings again. That is harmless because IndexNow is idempotent, but R28 and C12 ask the step to say so and to have a 'runs twice' answer. This is a note for whoever owns the spec, since the spec line belongs to B8b.
   Evidence: step-specs.ts purge_cache entry: `sideEffect: "none"`; purge-cache.ts pingIndexNow does fetch(INDEXNOW_URL...).

5. File `workspace/05-plans/logs/B13-followups.md` (not blocking).
   What: The author says the 8 BAD B3/B4 api-test registry entries ('No test files found' under --project db) and the STALE B4:seo-robots entry are follow-ups, but they appear only in the prose of the g1 log block. They are not in B13-followups.md, where the other follow-ups of the slice are listed for folding. Recorded here by this step; the entries themselves (the 8 BAD B3/B4 api-test entries and the STALE B4:seo-robots entry) still need an owner.
   Evidence: grep -n 'seo-robots\|parity.api\|payload-budget' workspace/05-plans/logs/B13-followups.md printed nothing.

## c7b · steps 7

1. File `app/src/routes/_site.property.$slug.tsx` (not blocking).
   What: Line 34 uses plain React `lazy`. It has no reload when the import fails, and the rework makes this worse: the chunk is now fetched on every property page view right after hydration, not only on a click. If the chunk fails to load (a deploy between the HTML and the chunk fetch, or a flaky mobile network), React.lazy throws to the root `errorComponent: PublicRouteError` (__root.tsx:49). A visitor who never touched the dialog then sees the whole page replaced by the error. `lazyRouteComponent` from @tanstack/react-router is already installed and does a one-time `window.location.reload()` on `isModuleNotFoundError`. This is the only `lazy(` in src/. The previous reviewer raised it and it is not in workspace/05-plans/logs/B13-followups.md (grep -i lazy finds nothing). Found by reading; I did not reproduce a failure.
   Evidence: grep -rn "lazy(" app/src → only _site.property.$slug.tsx:34; grep -n reload node_modules/@tanstack/react-router/dist/esm/lazyRouteComponent.js → lines 25-39; grep -n errorComponent src/routes/__root.tsx → 49

2. File `workspace/05-plans/logs/B13.md` (not blocking).
   What: The test counts in Proof 1 and Proof 3 do not come from the command written next to them. Proof 3 says `5 passed` for `-g "inquiry dialog"`, and Proof 1 says 3 passed and 2 failed, one of them `contact: ...`. That filter matches 4 tests and can never match the contact test. The output most likely came from a broader filter. The substance still holds: every inquiry test passes on the live build. P-1822's proof line has the same `5 passed` and also expects `151177`, while the shipped tree prints 151188.
   Evidence: bunx playwright test --project=desktop tests/e2e/forms.spec.ts -g "inquiry dialog" → `Running 4 tests ... 4 passed`; grep -n "inquiry dialog" tests/e2e/forms.spec.ts → lines 100 and 141 only; bundle-check → 151188

3. File `app/tests/e2e/forms.spec.ts` (not blocking).
   What: The guard the author names, `inquiry dialog: focus moves in on open and returns to the opener on close`, only fails under vite dev with StrictMode. P-1822 itself says it passes on the built Worker with the earlier broken variant. CI runs e2e only with E2E_TARGET: built (ci.yml:314, 321, 332). So no CI job would catch a return to mounting the dialog on click. The budget keeps the dialog out of the static graph, but nothing in CI checks that it mounts closed.
   Evidence: grep -n E2E_TARGET .github/workflows/ci.yml → built only; GOTCHAS.md P-1822 cause line

## g1 · steps 8-9

Source: the fresh reviewer of group g1, none blocking. No follow-up named GOTCHAS.md as its file, so none went into the bank (the first one is already banked in P-1814).

1. File `app/scripts/check-seo.ts (CI e2e job, PR 163)` (not blocking).
   What: The live proof of step 9 ('one ok per check, exit 0', and the seo steps of e2e green on a PR) is UNPROVEN and red. The causes are outside this group: B16 and B17 legal pages give 404, B17 step 2 fonts.googleapis is still in __root.tsx, and /place-notes gives no image to pageHead. Consequence: e2e is a REQUIRED_PR_CHECK, so PR 163 cannot merge, and the accepted steps 1 to 7 on it cannot merge either, until those land or the orchestrator changes the merge order. P-1814 already banks this. The orchestrator also has to name who wires og:image on /place-notes: that page became a page after B13 step 7 was built.
   Evidence: gh run view 37554841638 --log: 'seo check | fail status: /privacy answered 404' ... 'Process completed with exit code 1'; app/scripts/merge-gate.mjs:12 REQUIRED_PR_CHECKS = ["check","build","db","e2e","preview"]

2. File `app/scripts/perf-targets.mjs` (not blocking).
   What: Lines 7-8 of the comment say 'the hard limits stay `error` assertions in `lighthouserc.json`'. That is false today: largest-contentful-paint and resource-summary:script:size are 'warn' in B4's lighthouserc.json. The plan's step 8 proof ('preview lhci exits 0 with the hard limits of invariant 12 met') did not hold: LCP was 2604 to 4388 ms on every URL in both PR 163 runs, and script size was 161876 bytes. The job passed only because of the warn level. Invariant 12 ('enforced per PR') is not enforced. The fix is B4's file, not this group's. The comment and the log line 'Step 8 PROVEN in CI' should say that the hard-limit half is NOT met.
   Evidence: app/lighthouserc.json: "largest-contentful-paint": ["warn", {"maxNumericValue": 2500 ...}], "resource-summary:script:size": ["warn", ...]; gh run view 37554841564 --log shows 'largest-contentful-paint warning' for all 6 URLs and step exit 0

3. File `app/scripts/perf-targets.mjs` (not blocking).
   What: The hero-weight target is UNPROVEN against a real report. HERO_VARIANT (line 15) matches only /media/v/.../hero.webp, but on PR 163's preview the property page shows its hero through the mapper fallback (mappers.ts:283, mediaUrl(row.hero_image)) as the master /media/o/.../0-49087d38.webp, so no real run has ever weighed a hero. The plan's watched-fail (g), a 300 KB image on the home route, would stay silent unless the image is a hero variant. Only the synthetic unit fixture exercises this line. In production the variants are made when a photograph is attached (G66), so the gap is limited to the time before they render.
   Evidence: curl -s https://pr-163.holy-meadow-4327.workers.dev/property/west-village-townhouse | grep -a -o '/media/[^"]*' gives only /media/o/... addresses; curl of /media/o/west-village-townhouse/0-49087d38.webp gives 404 application/json

4. File `app/tests/unit/check-seo.test.ts` (not blocking).
   What: (Suspected by reading, not mutated.) Some branches of check-seo.ts have no test that would go red if they were removed: the robots 'x-mop-cache: bypass' requirement on a non-indexable host (check-seo.ts:264-265; the only workers.dev case supplies the header and asserts a pass), the llms content-type check (268-274), the og:title/og:description/og:url/og:type/twitter:card loop (94-103), and the --production non-200 throw (285-286). The 'seo preview host' CI step has also never run, because it is skipped after seo check fails.
   Evidence: tests/mutations/B13.json b13-g4-* entries: none mutates lines 94-103, 264-265, 268-274 or 285-286; the 'sends the Host header ...' case passes x-mop-cache: bypass in its own stub

5. File `app/scripts/check-seo.ts` (not blocking).
   What: (Suspected by reading.) Line 174 calls AbortSignal.timeout(15000) once in runChecks, and every request shares that signal. The 15 s limit therefore covers the whole crawl (the Promise.all over every sitemap URL, then robots, llms and the API), not each request. After L1, the runbook's 'check-seo.ts https://matterofplace.com --production' against a sitemap that grows with properties and facets can stop with a single 'aborted' failure.
   Evidence: check-seo.ts:172-177: const init = { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), ... }; get = (path) => fetcher(`${root}${path}`, init)

6. File `workspace/05-plans/logs/B13.md` (not blocking).
   What: STANDARDS C22: the new seo steps of the e2e job do not state their unit cost (Actions minutes). Measured, it is small: in run 37554841638, seo serve started 01:05:30 and seo check 01:05:33.
   Evidence: git diff 83c9855..daed675 -- workspace/05-plans/logs/B13.md | grep -i -E 'actions minute|unit cost|P-009' gives no line

7. File `workspace/05-plans/sizing/B13.json` (not blocking).
   What: The sizing entry for g4 names app/docs/runbooks/seo.md and app/lighthouserc.json. The plan and the brief name docs/runbooks/search.md, and B13 never edits lighthouserc.json. The orchestrator owns this file and should correct it.
   Evidence: workspace/05-plans/sizing/B13.json:9 "files": [..., "app/docs/runbooks/seo.md", ..., "app/lighthouserc.json"]

## g1 · steps 10

Source: the fresh reviewer of group g1, none blocking. The one item that names GOTCHAS.md (the third costTime item, the first e2e mutation of ga4.ts that never applied) went into the bank as a hit-again line of P-008 with a pointer in P-1827 and is not repeated here.

1. File `app/src/lib/ga4.ts` (not blocking).
   What: Follow-up. In a real browser, nothing tests that the script waits for idle. jsdom has no requestIdleCallback, so the unit test 'waits for idle' (and its mutation b13-g1-ga4-idle) only covers the setTimeout fallback on line 19. The e2e Allow test checks the request count, not the timing. If line 18 were replaced with run(), every test would stay green (found by reading, not by running a mutation). The plan's 'loads the script once after idle' is UNPROVEN in a browser. This affects performance only, not consent.
   Evidence: grep -rn requestIdleCallback tests/setup src finds only src/lib/ga4.ts:17-18. The registry entry b13-g1-ga4-idle mutates only 'else setTimeout(run, 1);'

2. File `.github/workflows/ci.yml` (not blocking).
   What: Follow-up for the orchestrator. CI never runs ga4.spec.ts. The e2e job runs desktop, phone, live-desktop, edge, coming-soon and admin projects plus the check-seo scripts, but no --project=seo, and its build has no GA4 id. So in CI the consent gate is guarded only by the unit tests. The same applies to B7's admin-signin googletagmanager check: on a build with no id the loader does nothing, so that check passes without testing anything, and FE-02 has no CI proof that can fail.
   Evidence: grep -n 'seo\|ga4' .github/workflows/ci.yml: line 316 runs desktop/phone/live-desktop/edge; the seo steps at 344-372 run scripts/check-seo.ts only

3. File `app/src/components/site/ga4-loader.tsx` (not blocking).
   What: Follow-up (C06/C07). In trackGpcOverride, `catch { return; }` (lines 20-22) silently drops the GPC consent_set when sessionStorage throws (storage blocked), and no comment says this is deliberate. Not tracking is the safe result, but the reason should be written down, as consent.ts does for its own catch.
   Evidence: lines 17-23 of ga4-loader.tsx

4. File `app/src/lib/ga4.ts` (not blocking).
   What: Follow-up. Clicking Decline (from the footer settings) after Allow in the same page view leaves gtag.js running until the next full load. Nothing sets window['ga-disable-<id>']. The author lists this as UNPROVEN. The plan does not ask this step to handle it, but B16's privacy wording or B17 should.
   Evidence: Ga4Loader's onConsentChange only calls loadGa4, which returns early once consent is not granted. Nothing undoes a loaded script

5. File `workspace/05-plans/B13.md` (not blocking).
   What: Follow-up. The step 10 proof `curl -s http://localhost:8080/ | grep -c googletagmanager` cannot be reproduced as written. bun run dev answers 500 on / when the public reads have no database env (already banked). The author replaced it with the built-Worker HTML test, which does run and can fail (mutation b13-g1-e2e-html). The plan line should name the built-Worker check.
   Evidence: vite dev --port 8949: curl / returned 500, and the dev log showed 118 public reads with status 503

## g1 · steps 11

Source: the fresh reviewer of group g1, none blocking. The two items that name GOTCHAS.md (the wrong failure text in the proof of P-2022, the missing hit-again line of P-027) went into the bank and are not repeated here.

1. File `app/tests/api/gone.api.test.ts` (not blocking).
   What: After the fix, no CI job runs the only end-to-end proof of invariant 10's page 410. The db job of ci.yml sets no E2E_BASE_URL, and deploy.yml sets it only for Playwright (essentials, overflow), never for the vitest db project. So the 410 on a real server is proven only by hand on a laptop and by the manual registry entry b13-g1-gone-api-start. If start.ts stopped calling withGoneStatus, CI would catch it only through the stand-in render in gone.test.ts and seo-cache.test.ts. This is not a regression: before the fix the file would have turned the db job red. It is a coverage gap for a later step (for example a check-seo --gone-slug run or an e2e case against the preview).
   Evidence: grep -rn E2E_BASE_URL .github/workflows/*.yml app/vitest.config.ts finds only deploy.yml:168 and :195, both Playwright steps. Running the file with no E2E_BASE_URL prints 'Tests 1 skipped (1)'.

2. File `workspace/05-plans/B13.md` (not blocking).
   What: The plan and trace are stale for the orchestrator to fold (not this group's files). Step 11 (line 115) still says the test's E2E_BASE_URL has the default http://localhost:8080, so the proof command as written now prints '1 skipped', which reads like a pass. Files lines 72-73 and trace.json (ids around 9762, 10638, 13389) still name markGone in src/lib/gone.ts and a fallback inside src/server/lib/pipeline.ts. The code has withGoneStatus in src/server/seo/gone.ts, called from src/start.ts. The author named this deviation in the log (B13.md log lines 747 and 830).
   Evidence: grep -rn "markGone\|src/lib/gone" workspace/05-plans/B13.md workspace/05-plans/trace.json returns B13.md:72, 73, 115 and trace.json:9762, 10638, 10641, 13389.

3. File `app/tests/api/gone.api.test.ts` (not blocking).
   What: STANDARDS R48 says a conditional skip uses `it.skipIf` with a printed reason. This file uses `describe.skipIf` and puts the reason in the describe title, which the default reporter does not print when the file is skipped. The repo already does the same in tests/unit/hygiene.test.ts:450 and :845, and in observatory.test.ts:215, and lint passes. So this is a wording gap between R48 and practice, not a broken gate.
   Evidence: app/tests/api/gone.api.test.ts:63 `describe.skipIf(BASE === "")(`; STANDARDS.md:298 (R48). The non-verbose run printed only 'Tests 1 skipped (1)', with no reason.
