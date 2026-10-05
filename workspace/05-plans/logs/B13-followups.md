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
