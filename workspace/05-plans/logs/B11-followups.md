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
   - What: UNPROVEN, as the brief allows. Tests 1 to 5 and 7 have never run green against the real Worker and database, and the leaveDraft path in afterAll has never run. Neither has a watched-fail. The only browser evidence for the UI flow is a page.route-stubbed scratch spec that was not committed, and the service and SQL shapes rest on a rolled-back transaction. The send-test route was never called on mop-dev. These items close only once main pushes 20261008102213 and 20261008102214, or on CI's e2e admin step for the PR.
   - Evidence: The mop-dev probe printed newsletter.% action_roles n=0 and newest migration 20261007043633; logs/B11.md:430.

(Follow-ups 1 and 2 of the reviewer's list, two costs with no gotcha entry, are P-2420 and a hit-again line in P-1302 in GOTCHAS.md, not follow-ups.)

## g8 · steps 9

1. File: `workspace/05-plans/logs/B11.md`. Blocking: no.
   - What: The pasted output for Proof 2 (line 409) does not reproduce. The log says 'Test Files 1 passed | 43 skipped (44), Tests 2 passed | 532 skipped (534)'. The same command at b2e5da8 prints 'Test Files 1 passed (1), Tests 1 passed | 20 skipped (21)'. Only one test title in the repository matches 'approving a standalone' (tests/db/newsletter.db.test.ts:595). So the pasted counts come from some other run or tree, not this commit. The point the proof makes, that the approval-link case passes on mop-dev, does hold, so I am not counting this as a failed proof. The log line should be corrected so it does not suggest two cases cover the link.
   - Evidence: cd app && eval "$(node scripts/load-env.mjs --profile dev)" && env -u CLOUDFLARE_API_TOKEN bunx vitest run --project db tests/db/newsletter.db.test.ts -t "approving a standalone" -> Tests 1 passed | 20 skipped (21); grep -rn 'approving a standalone' tests/ -> one test.

2. File: `app/tests/unit/newsletter/standalone.test.ts`. Blocking: no.
   - What: Invariant 4 says every broadcast must carry List-Unsubscribe and List-Unsubscribe-Post (one-click unsubscribe, a CAN-SPAM and bulk-sender requirement). No test checks those headers on the standalone broadcast, and none checks the plain-text unsubscribe line. Today's code is correct, but deleting either one leaves all 18 tests green. The plan's step 9 proof list does not ask for these, so this is a follow-up: assert the POST /broadcasts body on the fake provider (headers, and a text part holding the unsubscribe variable and the footer lines).
   - Evidence: node scripts/watchfail.mjs --file src/server/newsletter/standalone.ts --find '"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",' --replace '' --run 'bunx vitest run --project unit tests/unit/newsletter/standalone.test.ts' --expect FAIL -> WATCHED-FAIL BAD: stayed green. The same happens when '`Unsubscribe: ${UNSUBSCRIBE_URL}`' is replaced with '`x`'.

3. File: `app/tests/unit/newsletter/standalone.test.ts`. Blocking: no.
   - What: Lines 331-344: the utm test reads renderTemplate's mocked call arguments, which is an internal call shape (R53 / C10). The same link can be seen from outside, in the text field of the POST /broadcasts body on the fake provider. Once PR 211 lands and the render is real, move the assertion there.
   - Evidence: Read: vi.mocked(renderTemplate).mock.calls[0]?.[1] at line 335. standaloneText puts block.link into the broadcast's text (standalone.ts:250).

4. File: `app/src/server/newsletter/standalone.ts`. Blocking: no.
   - What: Suspected from reading, not confirmed. Nothing stops two standalone send_email jobs for the same property from running at the same time. The 'create at most once' rule is read-then-create on assets.meta.broadcast.id, and createBroadcast sends no Idempotency-Key. One way to get two jobs: the property is published, unpublished and published again before the asset is approved. That leaves two jobs in waiting_approval, and standalone_approve_job approves every one that matches. If two runner ticks overlap, each job reads no id, creates its own broadcast and sends it, so subscribers get the email twice. Inside one tick the runner works through a batch one job at a time, which makes this unlikely. The plan prescribes this design, and newsletter_send has an extra markSending compare-and-set that the standalone lacks. Follow-up for a plan note (C11 race partner, R22 / R28).
   - Evidence: Read: supabase/sql/functions/standalone_approve_job.sql uses 'perform approve_job(j.id, ...) from jobs j where ... waiting_approval', with no limit. src/server/automation/plan.ts:109 builds the key as `${event.id}:${step.id}`, so each publish event plans its own job. standalone.ts:200-213 reads the stored id, then creates.

5. File: `app/src/server/newsletter/standalone.ts`. Blocking: no.
   - What: channelEnabled, recipientCount, notifyAdmin, accepted, broadcast and deliver are near copies of the same helpers in src/server/jobs/system/newsletter-send.ts. That is below jscpd's 70-token threshold, and C05 only names helpers in lib or fixture folders, so it is not a rule breach. Two copies of the INT-10 adoption logic can drift apart. Consider a shared broadcast helper in src/server/newsletter/ when PR 211's follow-up touches this file.
   - Evidence: grep -rn 'function channelEnabled\|function recipientCount\|const accepted' src -> newsletter-send.ts:66, :76, :104 and standalone.ts.

6. File: `workspace/05-plans/B11.md`. Blocking: no.
   - What: Stale plan line (the orchestrator's to fold). The step 9 Files list does not name tests/unit/email/send-email.test.ts, but the delegation makes changing it necessary: B5's priority test used 'standalone' as its stand-in bulk template. The author changed it, logged it and banked it as P-2416. The changed test still fails when its bulk branch is removed (b5-aa-priority WATCHED-FAIL OK).
   - Evidence: git show b2e5da8 -- app/tests/unit/email/send-email.test.ts; node scripts/watchfail.mjs --registry tests/mutations --only b5-aa-priority -> WATCHED-FAIL OK.

7. File: `app/src/templates/email/standalone.tsx`. Blocking: no.
   - What: NOT DONE, honestly declared and the blocker is real. The commercial footer is not in the file yet, and nothing proves the real rendered standalone HTML contains {{{RESEND_UNSUBSCRIBE_URL}}} and the legal address. The steps are blocked on B9 PR 211, which is still OPEN and rewrites this file. Until then every real standalone send ends footer_incomplete. That is safe: it fails closed. The step-4 row update and the variablesByKey sample block wait on the same PR (P-2403). The mop-dev proof waits on S59 and B9's og variant. The group must be reopened when PR 211 merges.
   - Evidence: gh pr view 211 --json state,files -> state OPEN, files include app/src/templates/email/standalone.tsx, app/src/server/email/render.ts and app/src/templates/email/layout.tsx.

## g9 · steps 10-12

1. File: `app/src/server/newsletter/hygiene.ts`. Blocking: no.
   - What: The cap of 20 asks applies to each run, not to each day. Invariant 10 says 'at most 20 re-permission emails a day' and also says '(a) and (b) are safe to repeat on that retry'. But repermission_candidates leaves out anyone already asked, so every rerun asks 20 new subscribers. Reruns come from a RateLimited retry_at from syncAudience, which consumes no attempt, and from a manual enqueue under another key, which is exactly what the step 11 proof does. A 429 during the sync, with more than 20 idle subscribers, therefore sends 40, 60 or more asks that day. bulk_cap still protects the free quota. The code does what the plan literally says, so this is a plan contradiction for the orchestrator to settle: either count today's repermission_sent_at against the cap, or skip (a) and (b) on a retry. Found by reading. Nothing can trigger it before subscribers are 12 months idle.
   - Evidence: hygiene.ts lines 49-58: runHygiene always starts with candidateIds(db), i.e. repermission_candidates(p_limit 20). newsletter-hygiene.ts lines 16-18 return retry_at on RateLimited. Mutation entry b11-g9-db-cap shows the candidate SQL filters 'repermission_sent_at is null'. No test makes two runs on the same day with more than 20 idle subscribers.

2. File: `app/tests/unit/newsletter/hygiene.test.ts`. Blocking: no.
   - What: The case titled 'removes a complaint-suppressed contact from each audience it is listed in and clears its stored id' has no suppression in its fixture. It never sets `suppressed`, and members is stubbed empty. It proves that a Resend contact who is not a member gets removed and cleared, not that a complaint suppression causes the removal. The suppression filter lives in SQL (newsletter_audience_members). An existing db case covers it with a 'bounce' row (newsletter.db.test.ts:481), and so does plan watched-fail (h). The title over-claims what the plan's step 11 proof wording asks for. Rename the case, or add a 'complaint' row to the db case.
   - Evidence: hygiene.test.ts: world({ members: { 'place-notes': [], 'market-ca': [] } }) with no suppressed option. Removing the suppression clause from newsletter_audience_members would leave this case green, because the fake RPC returns [] either way (found by reading).

3. File: `app/src/server/newsletter/hygiene.ts`. Blocking: no.
   - What: C05 (second copy of a helper): `const resendSettings = z.object({ audiences: z.record(z.string(), z.string()) }).passthrough()` repeats src/server/channels/resend.ts:67 exactly. The two copies also treat a malformed row differently: resend.ts lets it pass through safeParse().data?, while hygiene ends the job dead. If the settings shape changes, both copies must be edited.
   - Evidence: grep -rn 'audiences: z.record' app/src/server shows channels/resend.ts:67 and newsletter/hygiene.ts:17

4. File: `workspace/05-plans/B11.md`. Blocking: no.
   - What: Stale plan text that the orchestrator should fold in. Lines 71 and 72 and step 11 still say runHygiene(db, now, sealKey) and 'the sealKey it was given as its third argument'. The code has runHygiene(db, sealKey), a deviation the log records with a reason: nothing reads a clock argument, because SQL uses now(). Step 12 also names `scripts/newsletter-test-send.ts --make-draft --i-mean-it`, which does not exist until the blocked step 8 lands.
   - Evidence: hygiene.ts:49 `export async function runHygiene(db: Db, sealKey: string)`; the log's g9 block contains 'Plan deviation'; scripts/newsletter-test-send.ts offers only --dry.

5. File: `workspace/05-plans/logs/B11.md`. Blocking: no.
   - What: Still UNPROVEN, and correctly labelled so by the author: (1) the manual newsletter_hygiene job ending done on mop-dev needs the runner deployed from main with the handler; (2) runHygiene in TypeScript against a real database, because the db cases mimic its first two steps in SQL (hygieneRun) and the unit cases use fakes; (3) screen 13 showing the draft, and approval from screen 13 (blocked by the 403 until the action_roles migrations are pushed); (4) preview mail delivery. These are UNPROVEN, not done. Re-run the step 11 enqueue and the step 12 approval after main deploys.
   - Evidence: mop-dev probe: job 9ece612b is cancelled with attempts 0; the newsletter_hygiene schedule row has next_run_at 2026-10-08T16:00Z and last_run_at null

## g10 · steps 13

1. File: `app/src/server/jobs/scheduler.ts`. Blocking: no.
   - What: The Saturday kpi_weekly job row gets max_attempts 5, not the 12 its definition declares. The scheduler calls enqueueJob(db, { type: "kpi_weekly", idempotencyKey: `kpi_weekly:${utcDate(now)}` }) at line 48 with no maxAttempts. scripts/kpi-send.ts:35 (this group's own file) does the same. Nothing reads SystemJobDefinition.maxAttempts. The runner decides from the row (runner.ts:133, job.attempts + 1 < job.max_attempts). So `maxAttempts: 12` in kpi-weekly.ts:39, and the test 'is registered with twelve attempts' that asserts it, do not change behaviour. What goes wrong: sendOne rethrows a Resend error that is neither retry_at nor fatal (send-email.ts:223), and collect throws kpi_weekly_failed when a Supabase call fails. Either one at Saturday 15:00 UTC kills the job after about 7.5 minutes of backoff (30+60+120+240 s, fail_job.sql:41). The CEO gets no weekly email, and only a Sentry job_dead report shows it. That is the DL-10 failure that src/server/lib/jobs.ts:6 says outside-provider types avoid by passing 12. newsletter_hygiene (scheduler.ts:50) has the same gap. The author disclosed it. Marked follow-up only because B8b's plan line 55 and B11 Files line 87 give exactly this call shape without maxAttempts. The fix is one argument: maxAttempts from getSystemJob(key) or the literal 12.
   - Evidence: Confirmed by grep in the snapshot. `grep -rn "\.maxAttempts" src` shows only plan.ts:110 and post-to-channel.ts:34, never a system-job reader. scheduler.ts:48 and kpi-send.ts:35 pass no maxAttempts. lib/jobs.ts:6 says 'maxAttempts absent keeps the SQL default of 5, and a type that calls an outside provider passes the 12 its registry entry declares (invariant 4, DL-10)'. Sibling enqueuers do pass it: service.ts:137 passes maxAttempts 12, standalone.ts:137 and newsletter-send.ts:57 pass NOTIFY_ATTEMPTS.

2. File: `app/src/server/channels/resend.ts`. Blocking: no.
   - What: The step 13 proof line '`bun run scripts/stubs.ts` then lists no `STUB(B11)` marker' fails. Two STUB(B11 step 4) markers from other groups remain (resend.ts:177 and newsletter/assemble.ts:71), and the ledger prints both as STUB(B11). Once B11 is marked closed, G05 (bun run stubs inside bun run check) will fail for every lane. This group cannot touch those files (one writer per file). P-2423 says the resend.ts cast can go now, and that assemble.ts needs newsletter_save_draft to take nullable, trailing actor arguments first. The orchestrator has to schedule both before B11 closes.
   - Evidence: Confirmed by running `bun run scripts/stubs.ts`: 'src/server/channels/resend.ts:177 STUB(B11): ...' and 'src/server/newsletter/assemble.ts:71 STUB(B11): ...'. The scheduler marker is absent.

3. File: `app/supabase/sql/functions/kpi_weekly.sql`. Blocking: no.
   - What: Suspected by reading, not run. Past weeks are counted from today's state, not as they were. published_properties uses `editorial_state = 'published' and published_at < v_end`, and properties_published uses published_at. The properties_published_pairing check clears published_at when a property stops being published. So a property archived after a week ends drops out of that week's figures. The 'prior week' change in the next email and B14's later reads then differ from what was mailed. The definition text in definitions.ts ('divided by the properties published at the end of the week') claims more than the SQL measures. The top-five CTE also joins any property by slug, not only published ones. Neither breaks a proof line. Record it as a known limit or reword the definition text.
   - Evidence: Read in the snapshot: kpi_weekly.sql (published_properties and top_properties CTEs) and supabase/migrations/20261001090300_catalog.sql:162 `constraint properties_published_pairing check ((editorial_state = 'published') = (published_at is not null))`.

4. File: `workspace/05-plans/logs/B11.md`. Blocking: no.
   - What: Checklist C22 is not met. The g10 log adds a new job type (kpi_weekly, weekly, with two kpi_weekly RPCs, loadSiteContext, resolveAdminRecipients, then one Resend call and one email_messages row per admin address) but never states its unit cost or the P-009 line it draws on.
   - Evidence: Read in the snapshot: the '## g10 · steps 13' block has no cost line.

5. File: `workspace/05-plans/B8b.md`. Blocking: no.
   - What: Stale plan prose that the orchestrator needs to update. B8b.md line 55 still describes the scheduler branch that 'advances only next_run_at ... and logs schedule_not_implemented' and the STUB(B11) marker. Line 141 still lists schedule_not_implemented among the LogEvent names. This group deleted both, as it was meant to.
   - Evidence: Confirmed by running `git grep -n schedule_not_implemented -- . ':!GOTCHAS.md'`: B8b.md:55, B8b.md:141 and B11.md:94,144. No code, runbook or test still references it.

## c11s · steps 7

1. File: `workspace/05-plans/B11.md`. Blocking: no.
- What: Step 7's proof text (line 138) still says the spec runs "signed in as the seeded `managing_editor`". The spec now signs in as the chief editor, as the c11s brief asked. This plan line is now stale and belongs to the orchestrator to fold.
- Evidence: `grep -n "signed in as the seeded" workspace/05-plans/B11.md` shows line 138 naming managing_editor; `tests/e2e/admin-newsletter.spec.ts:16` is `CHIEF_EDITOR = "staff+chief@matterofplace.com"`.

2. File: `app/tests/unit/e2e-staff-isolation.test.ts`. Blocking: no.
- What: The guard protects only the newsletter spec's literal address. Three cases get past it. (1) `admin-signin.spec.ts` and `admin-invoice.spec.ts` still share `staff+managing@`, so they would hit the same token-voiding race if invoice ran beside signin (E2E_FULL_STACK). (2) Several fullyParallel tests in `admin-invoice.spec.ts` sign in as `managing@` themselves (lines 301, 366, 388, 442, 510). (3) An address built with a template string (`staff+${role}@`) would not match the STAFF regex. The P-2426 rule says "one seeded staff user per e2e spec file that signs in", but no test enforces that across all spec files.
- Evidence: `grep -rn "signInAs(browser" app/tests/e2e` shows `admin-invoice.spec.ts` lines 301, 366, 388, 442, 510 on MANAGING_EDITOR and `admin-signin.spec.ts:19` on MANAGING_EDITOR. CI (`ci.yml:337`) does not set E2E_FULL_STACK, so these do not run side by side today.

3. File: `GOTCHAS.md`. Blocking: no. Recorded as a bank edit, not a follow-up left open.
- What: costTime listed P-2409 as "already banked, hit again", but the diff added no "Hit again" sentence to P-2409; the bank's rule says a lesson it already holds gets one. Only P-2426 changed.
- Evidence: `git diff d6095e8~1 d6095e8 -- GOTCHAS.md` changes only the P-2426 cause and rule lines. Now added to P-2409 as a "Hit again 2026-10-08, B11 c11s" line.

4. File: `app/tests/e2e/admin-newsletter.spec.ts`. Blocking: no.
- What: UNPROVEN: the admin project's exit 0, and the fix's effect in CI's e2e job on PR 227. The local evidence is 2 clean runs after the fix (2 more clean in this review, 4 in total) against 1 flaky run in 2 before. That shows the race is gone in these runs but gives no rate. The `:102` failure and the 5 serial tests after it can only pass on mop-dev once main pushes the `action_roles` migration (H57). The branch is also not merged with origin/main, so the PR may show as conflicting and start no CI run (P-136).
- Evidence: Reviewer re-run: two runs exit 1, "1 failed, 7 skipped, 5 did not run, 5 passed", no flaky line; mop-dev newsletter `action_roles` count 0.

## g1 · steps 2-3,13

1. File: `app/src/server/newsletter/assemble.ts`. Blocking: no.
   - What: Follow-up. The brief asked for the cast and its eslint-disable to be removed. The cast and its STUB marker are gone, but the commit adds a new `as unknown as` cast with an eslint-disable at lines 61-65 (SYSTEM_ACTOR) to pass null actors to newsletter_save_draft. The reason is real: the generated Args type in src/db/types.ts:1443 lists p_actor and p_actor_kind as non-null. The repo already uses the same pattern in src/server/payments/invoice-settings.ts:63, the cast carries an R03 reason, and the log states it openly. So this is not a hidden stub, but there is now a second copy of the null-system-actor cast. A shared typed SYSTEM_ACTOR in src/server/lib/audit.ts would hold both (C05: no second copy of a helper).
   - Evidence: Read: git show abb69884 -- app/src/server/newsletter/assemble.ts shows the new eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion line. grep -rn 'no-unsafe-type-assertion' src/server shows the same reason in payments/invoice-settings.ts:63.

2. File: `app/src/server/jobs/system/reconcile.ts`. Blocking: no.
   - What: Follow-up. The header comment written during the merge (lines 10-12) lists the parts as 'uploads first, then the social part of B10' and leaves out B11's newsletter part, which the job now runs third. The comment no longer describes all three parts.
   - Evidence: Read: sed -n 10,12p app/src/server/jobs/system/reconcile.ts against line 79 `reconcileJob(settleUploads, settleSocial, aggregateRecentIssues)`.

3. File: `app/tests/mutations/B11.json`. Blocking: no.
   - What: Follow-up. No registry entry covers the changed call arguments. The author's watched-fails on `...SYSTEM_ACTOR` and `p_audience_id: id` were run ad hoc and never registered, so CI's registry replay will not catch a regression in which arguments these typed calls pass. The existing tests do catch it: I reproduced both watched-fails.
   - Evidence: Ran: a node scan of tests/mutations for finds that name SYSTEM_ACTOR or newsletter_set_audience on resend.ts or assemble.ts found only b11-assemble-swallow-save-error and b11-queue-swallow-add-error, both on the error lines.

4. File: `workspace/05-plans/B11.md`. Blocking: no.
   - What: Follow-up for the orchestrator. The plan text is stale, as the author recorded: step 2 names /audiences while resend.ts calls /segments, and the brief says collectCandidates(db, since) while the code has collectCandidates(db, all).
   - Evidence: Read: the g1 block of the log, workspace/05-plans/logs/B11.md, last lines.

5. File: `tests/db/newsletter.db.test.ts`. Blocking: no.
   - What: Follow-up. UNPROVEN against the database. The typed calls are checked only against unit-test fakes and the generated types. The newsletter db tests and the CI db job were not run for this commit, and none exists for it.
   - Evidence: The author's unproven list; this review was told no CI run exists for abb6988.

## g2 · steps 8

1. File: `D:/mop-build/b11-review/app/scripts/newsletter-test-send.ts`. Blocking: no.
   - What: Lines 135-150 (confirmTestSubscribers): running --to again re-subscribes any listed address that has unsubscribed, because confirm_subscriber sets unsubscribed_at = null. The on-conflict branch also overwrites the source of any existing row with 'test'. The plan's step 8 proof says 'one test address unsubscribes through the link ... a second issue excludes it (recipients = 2)'. If the operator sends the second issue with the same `--to <a>,<b>,<c>` command, the unsubscribe is silently undone and recipients is 3. Neither the script header nor the plan says that the second send must name only the two remaining addresses, or that the script should skip unsubscribed rows. This is not blocking because the plan's file contract requires the confirm_subscriber call, and the addresses are the operator's own test mailboxes on a pre-launch database.
   - Evidence: Confirmed by running: a scratch transaction on mop-dev, rolled back, ran the script's exact upsert and confirm, set unsubscribed_at, then ran them again. Result: {"source":"test","confirmed":true,"resubscribed":true,"confirm_token_hash":null}. See also supabase/sql/functions/confirm_subscriber.sql (`unsubscribed_at = null`).

2. File: `D:/mop-build/b11-review/app/scripts/newsletter-test-send.ts`. Blocking: no.
   - What: Line 232 and lines 184-195: the G34 lock comes from holdDevLock on a second pg connection, but the plan says 'one pg connection holding the G34 lock'. This is the project-wide pattern, so it does not matter much. The lock is then held for the whole 5-minute poll, which blocks every other lane's mop-dev tests for that time, although the poll writes nothing. The poll also keeps going after a terminal send error, and it sleeps once more after the final read (61 sleeps for 61 reads, and the test pins 61).
   - Evidence: I found this by reading the code; the unit test 'prints the status and exits 1 when the issue is not sent within five minutes' asserts toHaveBeenCalledTimes(61) for sleep and release last.

3. File: `D:/mop-build/b11-review/app/scripts/newsletter-test-send.ts`. Blocking: no.
   - What: UNPROVEN live path, which the author disclosed: on mop-dev today --to would confirm and commit the test subscribers and then fail at approve with 'forbidden', because the newsletter.approve row of action_roles is only in this branch's unpushed migration 20261008102216_action_roles.sql. The confirmed test rows would stay behind. The whole --to path (approve, poll, sent <id>) is UNPROVEN until main pushes the migration, B5 step 5 sets the secrets and B16 stores the legal entity and address.
   - Evidence: Confirmed by running: a read-only query `select count(*) from action_roles where action='newsletter.approve'` returned 0 on mop-dev; in the rolled-back scratch transaction the approve raised 'forbidden' until the row was inserted.

4. File: `D:/mop-build/b11-review/workspace/05-plans/logs/B11-followups.md`. Blocking: no.
   - What: Line 155 still says that step 12's `scripts/newsletter-test-send.ts --make-draft --i-mean-it` 'does not exist until the blocked step 8 lands', and line 156 says the script offers only --dry. This group made both lines stale. The orchestrator should fold them.
   - Evidence: grep -n newsletter-test-send workspace/05-plans/logs/B11-followups.md

## c459 · steps 9

1. File: `app/src/domain/email.ts`. Blocking: no.
   - What: Follow-up. emailTemplateSchema.body lost min(1) for every key, not just standalone. Screen 18's templatePutInput (service.ts:94 picks body from this schema) now accepts an empty body for a transactional key. Example: an admin removes every block of 'received' and saves. Before, the save was refused. Now it is stored, the preview fails, and every later send_email for that key dies NonRetryable with template_body_invalid, so submitters get no acknowledgement and nothing tells them. The comment on line 77 is accurate: every other key's Email is Message, so renderTemplate refuses the body. The author disclosed this as a follow-up. A per-key refine would restore the check at save time, which means a change to B8b's service.ts.
   - Evidence: Confirmed by running a bun probe in the snapshot: templatePutInput.safeParse({key:'received', body:[]}).success prints true, and renderTemplate on that row throws template_body_invalid.

2. File: `app/src/domain/email.ts`. Blocking: no.
   - What: Follow-up. Since sampleVariables('standalone') now includes the block, a standalone test send (screen 18 sendTestEmail, scripts/email-test.ts) is built through the per-recipient transactional path. That email carries href="{{{RESEND_UNSUBSCRIBE_URL}}}", a merge tag only Broadcasts fill, so the admin receives a dead Unsubscribe link. It also points the image at ${siteUrl}/media/sample/alder-court/og.jpg, which no bucket holds. This affects staff test mail only.
   - Evidence: Suspected by reading and partly confirmed by tests. render.test.ts 'draws a standalone email's property block and unsubscribe link only when it is given a block' asserts the placeholder in the HTML rendered from sampleVariables('standalone'). send-email.ts testVariables returns sampleVariables for a test job with no entity, and standalone.test.ts 'a standalone test job' sends that HTML through sendOne.

3. File: `app/supabase/migrations/20261008102217_standalone_template.sql`. Blocking: no.
   - What: Follow-up (UNPROVEN, not a defect of the code). The row update is proven only as a MOP_MUTATION_SQL prelude in rolled-back transactions on mop-dev, plus the CI db job that has not run yet. The real mop-dev standalone send (step 9's mop-dev proof) is BLOCKED on the S59 legal entity and address and on main pushing this migration. When the merge to main pushes it, re-run tests/db/email.db.test.ts without the prelude.
   - Evidence: Without the prelude, the email.db.test.ts cases 'the standalone row is B11's' and 'the seeded keys equal' are red on mop-dev today, as the author reports. My prelude run gave 30/30.
