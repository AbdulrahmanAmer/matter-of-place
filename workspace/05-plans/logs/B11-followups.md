# B11 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 1-2

1. File: `workspace/02-tech-stack/tech-stack.md`. Blocking: no.
   - What: Stale document outside the group's files. Line 324 (the extension path for "an email channel") says that B11's `src/server/channels/resend.ts` is the pattern for `{ publish(asset, settings), metrics }`. That shape is not built, deliberately: no B11 step calls it and B10's Channel interface is not on main. The plan's Files line has the same shape (`workspace/05-plans/B11.md:63`). Anyone who follows tech-stack section 5 to add a channel will find a pattern that does not exist. This is for the orchestrator to fold into the docs.
   - Evidence: `grep -n 'publish(asset' workspace/02-tech-stack/tech-stack.md workspace/05-plans/B11.md` finds `tech-stack.md:324` and `B11.md:63`. `grep -n 'publish' app/src/server/channels/resend.ts` finds nothing.

2. File: `workspace/05-plans/B11.md`. Blocking: no.
   - What: Plan lines that later steps will build from no longer match the adapter. (a) Invariant 13 (line 44) calls `updateContact(audienceId, id, { unsubscribed: false })` and has syncAudience call `deleteContact` itself; the adapter has `updateContact(id, { unsubscribed })`, and removeContact already deletes a contact that is left in no segment. (b) The Files line 63 and step 2's proof list `/audiences` paths; the adapter uses `/segments` and `/contacts`. (c) Line 89 says the tracking script targets `matterofplace.com`; it targets `notes.matterofplace.com` (BULK_DOMAIN). The runbook records all three, which is what step 2 asks for, but the step 4 (syncAudience) builder reads the plan, not the runbook. The orchestrator should fold these in before step 4.
   - Evidence: Compare `B11.md:44` and `B11.md:63` with `app/src/server/channels/resend.ts:252-258` and `:227-240`, and with `app/docs/runbooks/newsletter.md:46-64`.

3. File: `app/docs/runbooks/newsletter.md`. Blocking: no.
   - What: Needs tracking: B5's webhook filter may silently drop every unsubscribe. The runbook (lines 99-103) correctly marks it UNPROVEN that `apply_email_event` keeps `contact.updated` only when its `audience_id` is in `settings.resend.audiences`, while global contacts carry `segment_ids`. The consequence is wider than the runbook says. If the ids do not match, `subscribers.unsubscribed_at` stays null. Resend broadcasts still respect the global flag, but B5's per-recipient bulk sends do not: market-open notices and previews through `sendOne` with kind `'bulk'` never read the Resend contact flag, so they would keep mailing a person who unsubscribed. That is a CAN-SPAM exposure. This is B5's SQL, not this group's file, and step 8 is already named to read a real payload. It must not be dropped; it should become a pre-step-8 check on B5. (Suspected by reading; not run.)
   - Evidence: Runbook lines 99-103. The plan's Contract line on `sendOne` with kind `'bulk'` for market-open notices and previews (plan-brief output, "Sender of every bulk send").

4. File: `workspace/05-plans/B11.md`. Blocking: no.
   - What: Step 8 now has a new prerequisite that no plan line or ASSUMED ruling holds. Resend applies `click_tracking` only when a `tracking_subdomain` is configured and verified (confirmed in the update-domain doc). That means a CNAME at Cloudflare for `notes.matterofplace.com` plus a verify step. Without it, step 8's `click_tracking on` and its `last_engaged_at` proof can print "on" while no click is ever tracked. Today it lives only in the runbook (lines 116-119).
   - Evidence: `curl -sL https://resend.com/docs/api-reference/domains/update-domain.md | grep -n tracking_subdomain` prints "This setting is only applied if a `tracking_subdomain` is configured and verified."

5. File: `app/src/server/channels/resend.ts`. Blocking: no.
   - What: C11 (race partner not named), suspected by reading. `ensureAudience` (lines 167-183) is list-then-create with no lock. Two first-time callers for the same key (for example two standalone sends for one market) can both see no segment, both POST `/segments`, and the second `newsletter_set_audience` overwrites the first id, which leaves an orphan segment. Hygiene iterates only stored keys, so the window is small. The fix belongs with step 4's `newsletter_set_audience` (insert-if-absent and return the winner).
   - Evidence: Read `app/src/server/channels/resend.ts:172-182`. No test runs two `ensureAudience` calls together.

## g2 · steps 3

1. File: `app/src/server/email/variables.ts`. Blocking: no.
   - What: Confirmed by running: no test protects the `.eq("event_id", job.eventId)` filter in digestAlert (line ~525). The digest-notify fixture holds exactly one queue_digest job, so the filter is never exercised. If someone drops it, the second digest.due cycle could read an older cycle's done queue_digest job (the query has `limit(1)` and no order). The notice would then name the wrong issue, or skip the wait. The code is correct today; what is missing is proof. P-2402's own rule says 'a filter without a mutation that turns its test red is not proved'.
   - Evidence: `node scripts/watchfail.mjs --file src/server/email/variables.ts --find '      .eq("event_id", job.eventId)\n' --replace '' --run 'bunx vitest run --project unit tests/unit/newsletter/digest-notify.test.ts' --expect FAIL` -> 'WATCHED-FAIL BAD: stayed green'. Fix: add a second queue_digest job of another event_id (status done, another issue) to the fixture, plus a registry entry that drops the filter.

2. File: `app/src/server/newsletter/assemble.ts`. Blocking: no.
   - What: Suspected from reading the code, not run. Line 286 runs `newsletterBlocksSchema.parse(merged.blocks)`, and readIssues runs `z.array(issueRow).parse` at line 155. Both cap `deck` at 300 characters and `title` at 1 to 300 (src/domain/newsletter.ts lines 21 to 34). The data that feeds them has no such cap: build-newsletter-block.ts sets deck = firstSentence(place), which returns the whole paragraph when it has no sentence end, and domain/story.ts has `deck: z.string()`. One property or story over the cap would throw a retryable ZodError on every attempt. Every digest would then die with 'Place Notes draft could not be built' until someone edits the row. If step 4's queue_digest_add copies such a block into a draft, readIssues fails for every later assembly. buildPreheader already cuts to 110, so the cap guards nothing the output needs.
   - Evidence: Read: app/src/server/jobs/steps/build-newsletter-block.ts (deck: firstSentence(place)), app/src/templates/social/slides.ts:40-43 (no match returns text.trim()), app/src/domain/story.ts:13 (deck: z.string()), app/src/domain/newsletter.ts deck max(300). Repro to write: a vitest case with a 301-character deck in assetRow meta, expecting assemble to save rather than throw.

3. File: `app/src/server/email/variables.ts`. Blocking: no.
   - What: The author disclosed this. A digest.due recipe that uses a send_email step with the admin_notify template now fails with NonRetryableError event_id_missing. send-email.ts:342 calls resolveVariables without the seventh `job` argument, and it would not catch a WaitFor either. Before this change that path sent a notice. The seed recipe uses notify_admin, so nothing breaks unless an operator edits the recipe in /admin > Automation. No test covers the path.
   - Evidence: Read: app/src/server/jobs/steps/send-email.ts:338-343 `return resolveVariables(ctx.db, key, data, eventType, site);` (no job). The digestAlert first line throws event_id_missing when job is undefined.

4. File: `app/src/server/newsletter/assemble.ts`. Blocking: no.
   - What: A note for step 4, from reading. mergeDraft decides a subject or preheader was edited by a human when it differs from buildSubject or buildPreheader of the draft's current blocks (lines 138-145). Step 4's plan has queue_digest_add replace a property's older-revision block in place. If that block is first, a rule-built subject becomes 'edited' and a stale title is kept on every later assembly. Two conditions are needed for the merge to behave: queue_digest_add must write a subject of null or exactly buildSubject's output, and its blocks must match newsletterBlockSchema (id 'property:<uuid>', title, deck from meta.block). If the block shape does not match, readIssues throws.
   - Evidence: Read: B11.md line 115 (queue_digest_add replaces the older block in place), assemble.ts lines 132-148 and 150-156.

## g3 · steps 4

1. File: `app/supabase/migrations/20261007011456_newsletter_functions.sql`. Blocking: no.
   - What: The migrations' down path cannot be followed. Line 1 says to re-run db:fn from the previous commit, but 19 of the 21 functions and the trigger assets_standalone_approve_job are new, so that brings back nothing and drops nothing. The plan says 'Down path: drop the trigger and the function'. The table migration's down (20261007011000_newsletter.sql lines 1-6) defers to this header, and its own 'drop table public.newsletter_issues' is refused while newsletter_open_draft returns that row type. Anyone rolling back by these headers gets an error and has no list of what to drop. It fails loudly, not silently.
   - Evidence: Confirmed by running a rolled-back probe on mop-dev with both migrations applied: 'drop table public.newsletter_issues' gave '2BP01 cannot drop table newsletter_issues because other objects depend on it | function newsletter_open_draft() depends on type newsletter_issues'. For comparison, 20261006001909_reel.sql spells out its drops. Fix: in the fn migration header, drop the trigger and every new function, and keep the db:fn re-run only for email_sent_today and email_sent_month.

2. File: `workspace/05-plans/B11.md`. Blocking: no.
   - What: Step 4 is partial: the standalone row update (body '[]', variables {subject,preheader,block}, enabled true) and the standalone variablesByKey entry with its sample block are NOT DONE. The author reports this as BLOCKED, and I confirmed the cause. The plan's step 4 proof includes the standalone row assertion, so that part of the Contract stays open. The orchestrator has to re-home it after B9 step 5's render work lands.
   - Evidence: Confirmed by reading: src/templates/email/standalone.tsx is still B5's placeholder paragraph, no NewsletterBlock exists under src/templates/email, src/server/email/render.ts:21 has 'const body = z.array(emailBlockSchema).min(1)', and src/domain/email.ts:76 has 'body: z.array(emailBlockSchema).min(1).max(40)'. Banked as P-2403.

3. File: `app/supabase/sql/functions/standalone_approve_job.sql`. Blocking: no.
   - What: Suspected by reading, not run. While the standalone row stays disabled (the item above), approving a standalone_email asset on screen 10 now queues the waiting send_email(standalone) job at once. That job ends done with skipped template_disabled (send-email.ts:352), so it is used up. When the row is enabled later, that property's Campaign email is never sent unless someone makes a new job. Before this group the job stayed in waiting_approval. The launch reset (H35) wipes pre-launch rows, so today's risk is limited to properties published between this merge and the row being enabled.
   - Evidence: send-email.ts:352 'if (!row.enabled) return skipped("template_disabled");'. Together with the trigger body (fn migration lines 680-685) and the row left enabled = false (P-2403).

4. File: `app/tests/db/newsletter.db.test.ts`. Blocking: no.
   - What: Several cases assume mop-dev holds no open draft: 'holds one draft' (blocks: 2), 'queue_digest_add keeps one block per property' (exact blocks array), and the unapprove and approve cases, which reuse the open draft. CI's fresh stack is fine. Once the migration is on mop-dev and step 8's --make-draft or any real draft exists there, the lane-side P-312 proofs of this file will go red for reasons that have nothing to do with the code (R52: depend on no row another test changed).
   - Evidence: Read: draft() calls newsletter_save_draft, which reuses newsletter_open_draft(), and queue_digest_add appends to whatever draft exists. The enqueue case already guards against mop-dev state ('A market no seed opens'), but the draft cases do not.

5. File: `app/tests/db/newsletter.db.test.ts`. Blocking: no.
   - What: Line 154 runs 'Promise.all' with two queue_digest_add calls on one pg client. pg runs them one after the other, so nothing here is concurrent. The only part that measures the index is the second insert ('extra: 23505'). The author lists real two-connection concurrency as UNPROVEN, and I agree. By reading, newsletter_open_draft's 'on conflict do nothing' plus re-select is correct under READ COMMITTED. Separately, suspected by reading (C11): an assemble that read the draft before a concurrent 'add' then saves its merged blocks over it (newsletter_save_draft sets blocks = p_blocks). The added block drops out of this draft and returns at the next cycle. No test names that race partner.
   - Evidence: newsletter.db.test.ts:154-163 (one db client). newsletter_save_draft in the fn migration, lines 117-121.

6. File: `workspace/05-plans/logs/B11.md`. Blocking: no.
   - What: Some UNPROVEN claims are out of date, and one gate is still pending. The PR has left draft and CI ran on db076e6: 're-apply' and the check job's 'deno' step passed, so those two are now proven. The db job stopped at the expected type drift, which skipped test:db, so newsletter.db, email.db and actor.db -t newsletter_approve_issue are still UNPROVEN on CI's stack. Next: run 'bun run types:from-ci -- 200', commit src/db/types.ts, and see the db job green before merge (R57/C21: migration and types in the same PR).
   - Evidence: gh run view 37563337565: db steps 'supabase start' success, 're-apply' success, 'type drift' failure, 'Run bun run test:db' skipped. The check job's 'deno' step succeeded. The drift diff lists only newsletter_issues and the new functions.

## g2 · steps 3

1. File: `app/src/server/newsletter/assemble.ts`. Blocking: no.
   - What: Follow-up (test gap). The cut on the property title (`title: clipWords(title)` in propertyCandidates, about line 207) has no test and no registry entry. If it were removed, a newsletter_block asset whose meta.block.title is longer than 300 characters would bring back the retryable ZodError loop this fix round was meant to close. The current code is correct. The new test uses the title "Oak Hill", which is 8 characters.
   - Evidence: Confirmed by running: with `title: clipWords(title),` replaced by `title,`, `bunx vitest run --project unit tests/unit/newsletter/assemble.test.ts` gave Tests 16 passed. Restored afterwards.

2. File: `app/src/server/email/variables.ts`. Blocking: no.
   - What: Follow-up (test gap). The guard `sibling.status !== "done"` on the new one-hour give-up branch (about line 546) has no test. Every "draft ready" and "nothing to send" case uses a sibling made 1 minute earlier. If the guard were dropped, admins would get "Place Notes draft is not ready" for a finished draft whenever notify_admin runs more than an hour after queue_digest was made (for example after a Resend backoff or a runner outage). The current code is correct. Add a case with a done sibling aged 61 minutes plus a registry entry.
   - Evidence: Confirmed by running: with `sibling.status !== "done" &&
    job.now` replaced by `job.now`, `bunx vitest run --project unit tests/unit/newsletter/digest-notify.test.ts` gave Tests 6 passed. Restored afterwards.

3. File: `app/src/server/email/variables.ts`. Blocking: no.
   - What: Follow-up (plan fold, orchestrator). The one-hour give-up is behaviour the plan's Files line does not describe: it says "not yet done or dead → WaitFor", which means waiting with no end. It also gives a false alarm in two cases, judged by reading. First, a queue_digest in normal B8 backoff that finishes after the hour: admins get "not ready" and then no "draft ready" notice. Second, after a runner outage of an hour or more, notify_admin may be claimed before the queued queue_digest. The author lists this deviation under unproven. It gives a notice to a person rather than leaving one silent forever, so it is not a contract break with a data or security consequence. B11.md step 3 and the Files line for variables.ts should be updated to match.
   - Evidence: `git show 9298384 -- app/src/server/email/variables.ts` adds DIGEST_GIVE_UP_MS = 60 * 60 * 1000 and the "Place Notes draft is not ready" notice. The plan brief quotes: "not yet done or dead → throws new WaitFor(now plus 1 minute, \"waiting_queue_digest\")".

4. File: `workspace/05-plans/B11.md`. Blocking: no.
   - What: Follow-up (plan fold, orchestrator). The group touched files that are not in the plan's Files list: tests/fixtures/email-send.ts, tests/fixtures/newsletter-world.ts and B5's tests/unit/email/variables.test.ts. The author reported this.
   - Evidence: Author's unproven list and the slice log block "g2 · steps 3 (fix round after the second review)".

(Follow-up 4 of the reviewer's list, a cost with no gotcha entry, is a hit-again line in P-076 in GOTCHAS.md, not a follow-up.)

## g6 · steps 7

1. File: `app/src/routes/admin/newsletter.index.lazy.tsx`. Blocking: no.
   - What: C17 asks for an error with the request id, and the Build button misses it. Line 84 shows `toast({ message: error.message, tone: "danger" })`, so a 500 or 403 on POST /issues/build shows no request id. This is the one place on screen 13 that the review fix's failureText did not reach; the subscribers tab, the preview and the editor all quote the id now. The same pattern exists in requests.index.tsx:60, so it is a consistency gap, not a regression.
   - Evidence: Read: newsletter.index.lazy.tsx:83-85, compared with newsletter.$id.lazy.tsx:96 and newsletter.index.lazy.tsx:105, which use failureText.

2. File: `app/tests/e2e/admin-newsletter.spec.ts`. Blocking: no.
   - What: Suspected by reading, not run. Suppose beforeAll fails after holdDevLock() but before signInAs() assigns `context` (for example a sign-in failure). Then afterAll's finally block calls `context.close()` on undefined and throws a TypeError. That hides the real error and skips `delete process.env.MOP_DEV_LOCK_HELD` and `release()`. Because the lock is a session advisory lock, it is held until the Playwright worker process exits rather than released at once. Guarding the close (`await context?.close()` with context typed as optional) fixes it.
   - Evidence: Read: admin-newsletter.spec.ts:21 (`let context: BrowserContext;`), :48-54 (release assigned before signInAs), :73-81 (finally block). tests/fixtures/dev-lock.ts:16 takes pg_advisory_lock on its own client.

3. File: `workspace/05-plans/B11.md`. Blocking: no.
   - What: Plan drift that the author disclosed and that belongs to the orchestrator to fold in. Line 81 still describes `GET ?format=csv` on newsletter.subscribers.ts, but the build has its own route newsletter.subscribers.export.ts (P-2410). trace.json:512-519 does not list newsletter.subscribers.export.ts or the two .lazy.tsx route files. The doc comment on sendTest in src/server/newsletter/service.ts:126-129 says 'the route reads it', but the route calls sendTestToActor.
   - Evidence: `grep -n 'format=csv' workspace/05-plans/B11.md` prints line 81; `grep -n 'newsletter' workspace/05-plans/trace.json` lists the 8 original route files only; service.ts:127 comment vs newsletter.issues.$id.send-test.ts:14.

4. File: `app/tests/e2e/admin-newsletter.spec.ts`. Blocking: no.
   - What: UNPROVEN, as the brief allows. Tests 1 to 5 and 7 have never run green against the real Worker and database, and the leaveDraft path in afterAll has never run. Neither has a watched-fail. The only browser evidence for the UI flow is a page.route-stubbed scratch spec that was not committed, and the service and SQL shapes rest on a rolled-back transaction. The send-test route was never called on mop-dev. These items close only once main pushes 20261007045428 and 20261007082148, or on CI's e2e admin step for the PR.
   - Evidence: The mop-dev probe printed newsletter.% action_roles n=0 and newest migration 20261007043633; logs/B11.md:430.

(Follow-ups 1 and 2 of the reviewer's list, two costs with no gotcha entry, are P-2420 and a hit-again line in P-1302 in GOTCHAS.md, not follow-ups.)
