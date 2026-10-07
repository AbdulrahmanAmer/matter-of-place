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
