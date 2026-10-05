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
