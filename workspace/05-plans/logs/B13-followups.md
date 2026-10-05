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
