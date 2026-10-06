# B5 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 1

1. File: `app/tests/unit/email/render.test.ts`. Not blocking.
   - Follow-up: "The 'refuses an unknown type, empty text and an unsafe link' case cannot detect a lost anchor in isLink (app/src/domain/email.ts:37). Its only negative controls are 'javascript:alert(1)' and 'http://'. If either anchor is removed, the schema accepts 'javascript:alert(\"https://x\")' or '{{confirm_url}}javascript:...' as a button url and the test stays green. The code is correct today. The later lintEmail ('no javascript:') is a planned second layer but is not built yet. Add the controls 'javascript:void(\"https://x\")' and '{{confirm_url}}x' to the refusal case."
   - Evidence: "Confirmed by running a scratch watchfail registry against the snapshot: probe-link-anchor (find '/^(https:' replace '/(https:') and probe-var-anchor (find '}$`).test(value)' replace '}`).test(value)') both printed 'WATCHED-FAIL BAD: stayed green'."

2. File: `workspace/05-plans/logs/B5.md`. Not blocking.
   - Follow-up: "The log is append-only for lanes, but rework commit a6dd049 rewrote earlier lines in place: it deleted the knip ignoreDependencies bullet and the 'bun add installed @react-email/render 2.1.0' bullet and replaced them mid-list. The opening 'Files:' line still lists app/package.json (with app/bun.lock) and app/knip.json (H46) as touched. The final branch diff leaves all three equal to main. The rework paragraph at the end corrects this, so a full read is accurate, but the first paragraph alone is not."
   - Evidence: "git diff 9125109 a6dd049 -- workspace/05-plans/logs/B5.md shows '-' lines in the Deviations list. git diff origin/main...HEAD -- app/knip.json app/package.json app/bun.lock | wc -l -> 0"

3. File: `workspace/05-plans/B9.md`. Not blocking.
   - Follow-up: "Follow-up for the orchestrator to fold. B9's Depends line (line 3) says 'B5 step 1 (`@react-email/render`, `src/templates/theme.gen.ts`)'. Under H46 (2) B5 step 1 no longer installs @react-email/render. B9 will either wait for something step 1 will never provide, or install the package itself in its own lane. In that case the major is not pinned by anything B9 reads: P-1200's rule binds only 'the group that writes deno.json' to E5's @1, so B9 could add render@2 and conflict with B5's later bun add on package.json and bun.lock."
   - Evidence: "grep -n 'B5 step 1' workspace/05-plans/B9.md -> line 3: 'B5 step 1 (`@react-email/render`, `src/templates/theme.gen.ts`)'. ASSUMED E5 measured npm:@react-email/render@1."

4. File: `app/src/domain/email.ts`. Not blocking.
   - Follow-up: "Follow-up, a note for the migration group (B5 step 2). The plan's Files line requires EmailTemplateRow to be re-exported from the generated types, and that is NOT DONE here because email_templates is not in src/db/types.ts yet. The deferral is right under R04. When the column lands, G-004's rule also requires an enums.check.ts pair for emailClasses against email_templates.class if that column is an enum. Step 2's brief must name app/src/domain/email.ts, or no single writer owns the re-export."
   - Evidence: "grep -n EmailTemplateRow app/src/domain/email.ts -> no hit. The author's own unproven list says the same. The G-004 entry printed by check-gotchas --for app/src/domain/email.ts requires the enum pair."

## g1 · steps 2

1. File: `app/tests/db/email.db.test.ts`. Not blocking.
   - Follow-up: "Lines 843-868. The half of the RLS case 'and a staff role reads them' cannot fail. It runs `select 1 ... limit 1` and expects 'ok', which only proves the select grant: with a policy refusing the read, RLS returns zero rows, not an error. The plan only asks for the insert half, and the rls matrix test covers the read. The fix is to drop that phrase from the title, or to insert a row and assert the admin sees it."
   - Evidence: "Confirmed by running: with all three *_select_staff policies dropped in the prelude, the case stays green (1 passed). rls.db.test.ts goes red under the same mutation (7 failed)."

2. File: `app/tests/db/email.db.test.ts`. Not blocking.
   - Follow-up: "Lines 37-41 and 179-186. Each seeded row's class is compared with the test's own `classes` table (default 'transactional'), not with each definition's `class` as the step requires. The definitions land in g2. Until g2 switches this case to `definitions`, the contract line 'each seeded row's class equals its definition's class' is UNPROVEN."
   - Evidence: "Read: the expected value comes from `classes[key] ?? \"transactional\"` in the test file itself."

3. File: `app/tests/db/retention.db.test.ts`. Not blocking.
   - Follow-up: "Line 653. The case covers `email_messages` only. B8.md step 8a also names an `email_events` row 91 days old losing `to_email` while an 89-day one keeps it. No test inserts an `email_events` row, so the events half of `retention_anonymise_email` can regress unnoticed. B5's step text names only email_messages, so this is B8's gap made reachable now."
   - Evidence: "Read: the case inserts only into public.email_messages. workspace/05-plans/B8.md:169 says 'an email_messages row 91 days old and an email_events row 91 days old lose to_email'."

4. File: `workspace/05-plans/logs/B5.md`. Not blocking.
   - Follow-up: "The proof as claimed is `node scratchpad/dbrun.mjs ...`. That scratch runner is not committed and cannot be rerun as written. The log does describe the equivalent (vitest db project, both migrations as MOP_MUTATION_SQL), and I reproduced every result with my own runner."
   - Evidence: "ls scratchpad and app/scratchpad in the snapshot: No such file or directory"

5. File: `app/src/server/lib/crypto.ts`. Not blocking.
   - Follow-up: "`bun run check` is red at the stubs gate on main's own `STUB(B15)` marker at line 47, because B15 is marked closed in PLAN.md. This file is not in the branch's diff. The orchestrator needs to re-label it before any lane can show a green check (P-507)."
   - Evidence: "bun run stubs: 'src/server/lib/crypto.ts:47 STUB(B15) slice is closed'; git diff origin/main slice/b5 -- src/server/lib/crypto.ts is empty"

6. File: `workspace/03-diagrams/architecture.md`. Not blocking.
   - Follow-up: "The plan's G-004 risk line says the diagram and the architecture text change in the same commit for email_messages and email_suppressions. The ER block (around lines 40-68) still has email_templates but no email_messages, email_suppressions or email_events, and no jobs-to-email_messages edge. This file is not in the group's list."
   - Evidence: "grep -rln email_messages workspace/03-diagrams: no match"

7. File: `workspace/06-architecture/architecture.md`. Not blocking.
   - Follow-up: "Line 184 still says `subscribers.last_engaged_at`, `repermission_sent_at` come from B5 `<ts>_email.sql`. Section 3.8 in the same diff now names `20261005013003_email.sql`."
   - Evidence: "Read: sed -n 184p workspace/06-architecture/architecture.md"

8. File: `app/supabase/migrations/20261005013003_email.sql`. Not blocking.
   - Follow-up: "R22 and C11 notes, all disclosed or outside the plan. (1) `email_messages.status` has no transition list in src/domain/email.ts and no wrong_state raise. This is disclosed in the log, and the Contract's silent forward-only behaviour conflicts with a literal R22, so it needs a ruling. (2) `lapse_subscribers` writes no audit row when the count is 0, while the plan says it 'writes one audit_log row with the count'. Also disclosed. (3) The transient-bounce count (lines 271-278) scans email_events by to_email with no index. email_events grows with every provider event and has no row-deleting retention (R25). Two concurrent third bounces can each count 2 and suppress nothing. (4) `settings_email_share` rewrites settings.email on every update of the environment row, including a no-op one, so caps an admin edited are lost. This follows the plan text."
   - Evidence: "Read: migration lines 196-207, 267-279 and 359-370, and the seed's settings_email_share; indexes exist only on resend_email_id and broadcast_id"

9. File: `app/supabase/migrations/20261005013009_email_templates_seed.sql`. Not blocking.
   - Follow-up: "The `inquiry_forward` row follows the plan's seed copy, which has no `{{submitter_name}}` greeting, while the S55 kind check says every submitter template greets it. `submitter_name` is listed in its variables but unused. Disclosed in the log; for g2 or the orchestrator to settle."
   - Evidence: "Read: seed lines 86-97"

## g1 · steps 3

1. File: `app/tests/unit/assert-not-production.test.ts`. Not blocking.
   - Follow-up: "scripts/email-test.ts was created by this group and its send mode writes to mop-dev, but it is not in the guardedScripts list. Plan watched-fail (ao) says that deleting the assertNotProduction call from email-test.ts must turn this test red naming the script. As things stand that deletion stays green, so the production guard of ruling H35 (5) on this script is untested. The test file is not this group's, so this is for step 4a (where the send mode is proved) or the orchestrator."
   - Evidence: "Found by reading, not by mutation: sed -n 13,28p tests/unit/assert-not-production.test.ts lists 14 scripts and no email-test.ts. git grep -n email-test -- tests scripts/lib prints nothing."

2. File: `workspace/05-plans/logs/B5.md`. Not blocking.
   - Follow-up: "Log line 165, from the first g1 round, reads 'mop-designer approval of the shell: ... Approved as the shell'. The author's own unproven list and log line 282 say no independent mop-designer review happened, only the builder's own look. The appended block corrects it and the log is append-only, but step 3's 'mop-designer approves the shell once' is NOT DONE. The orchestrator must not count line 165 as that approval."
   - Evidence: "grep -n -i 'mop-designer' workspace/05-plans/logs/B5.md: line 165 says 'Approved as the shell'; line 282 says 'an independent mop-designer review is UNPROVEN'."

3. File: `app/tests/unit/email/preview.test.ts`. Not blocking.
   - Follow-up: "The case 'is unavailable, not not_found, when the read of the row fails' builds its own mock query chain ({ from, select, eq, limit } cast to Db). The plan's Files list says email unit tests use fakeDb and never a hand-rolled chain mock (CS-12). fakeDb can answer an error only for an rpc, not for a table read (tests/fixtures/fake-db.ts:54). The case does go red under its mutation, so it measures something. Follow-up: give fakeDb a per-table error answer, then replace the stand-in."
   - Evidence: "preview.test.ts lines 97-105; grep -n error tests/fixtures/fake-db.ts shows only the rpc branch returning { data: null, error }"

4. File: `app/package.json`. Not blocking.
   - Follow-up: "There are two React Email renderers in the dependency tree. @react-email/render 1.4.0 is the direct dependency; @react-email/components 1.0.12 pulls in render 2.0.6, and both depend on prettier and html-to-text. Bundle size in the Worker and the job runner is still unmeasured. The author already noted this, and step 4a's bundle measurement decides it."
   - Evidence: "bun.lock lines 448, 470 and 1862"

5. File: `app/docs/runbooks/email.md`. Not blocking.
   - Follow-up: "Two follow-ups for later steps or the orchestrator. (1) The plan's Files list says the runbook records the three Resend domains and their records, which identity sends what, and the key scope. Lines 5-6 instead send the reader to ASSUMED.md ('not repeated here'). (2) Several single keys measure above the Worker's 10 ms CPU limit on a loaded laptop (awaiting_assets 15.33, repermission 14.86, admin_notify 11.87 in the runbook's own run), while the 8 ms gate looks only at the overall p95. B8b's preview endpoint should re-measure per key on a quiet machine, as the runbook already says."
   - Evidence: "docs/runbooks/email.md lines 3-6 and 94-102; my email-cpu run printed the per-key figures above, with p95 6.51 overall"

6. File: `app/src/templates/email/declined.tsx`. Not blocking.
   - Follow-up: "The S55 Kind check (a submitter template greets {{submitter_name}} and talks about 'your property') is not met by declined, accepted, awaiting_assets and invoice. Example: declined opens 'Thank you for submitting {{property_address}}.' The definitions must equal the seed migration on main, and the seed-parity test enforces that. So the fix belongs in a new seed migration plus the definitions, which is the orchestrator's to fold. The author named it. The 'owner wording' test checks only the banned words, which pass."
   - Evidence: "render.test.ts 'equals the row the seed migration inserts, key by key' passes; declined.tsx heading text quoted above"

7. File: `app/src/server/email/variables.ts`. Not blocking.
   - Follow-up: "When previewTemplate is called with an entity, a failed read in a resolver (rowsOf throws plain Error 'email_read_failed:<table>') or in settings (readSettings throws Error 'settings_read_failed') escapes as a bare Error, not AppError 'unavailable'. A Worker route would answer that with 500, not the 503 that R09 asks for on a dependency outage. The runbook says the calling route translates render and variable errors, but it names only the NonRetryableError codes. B8b's preview route should map these too. Suspected by reading only."
   - Evidence: "variables.ts line 76 and context.ts line 23; docs/runbooks/email.md lines 32-36"

## g2 · steps 4

1. File: `app/src/server/jobs/steps/send-email.ts`. Not blocking.
   - Follow-up: "The `alert_report_failed` branch of reportAlert (lines 78-82) cannot be reached with the runner's real reporter. captureException in src/server/lib/sentry.ts catches its own fetch failures and logs `sentry_send_failed` instead of rejecting. The notify-admin case 'logs a failed Sentry report and still sends' proves the branch only with a stub reporter that rejects. A Sentry failure is still logged, but under a different event name than invariant 14 says. Suspected by reading, not run against a failing DSN."
   - Evidence: "sentry.ts captureException ends in try { await fetch(...) } catch { ... } and never rethrows; supabase/functions/job-runner/index.ts wires report to captureException"

2. File: `app/tests/unit/lib/live-side-effects.test.ts`. Not blocking.
   - Follow-up: "No case covers MOP_ENV unset together with EMAIL_LIVE=1. Today the allow-list holds because the check is `!== \"production\"`. But a mutation to `=== \"preview\" || === \"development\"` would let an unconfigured runner with EMAIL_LIVE=1 mail any address, and no test would go red. The reserved-domain case also has no near-miss address such as owner@house.testing.com, so dropping the `$` anchor would stay green. The code is correct by reading."
   - Evidence: "send-email.ts:134 `readVar(\"MOP_ENV\") !== \"production\"`; every allow-list test sets MOP_ENV to preview or development"

3. File: `app/src/server/jobs/steps/send-email.ts`. Not blocking.
   - Follow-up: "The ceiling check (line 245) runs before email_message_begin's already-sent check (line 249). This is the plan's order. Suppose a job is retried after its message went out, and that send was the one that filled the cap. The retry then answers retry_at until the next day instead of done. No second email goes out, only the job finishes late."
   - Evidence: "sendOne: ceiling() at line 245 before begin()/OUT.has at lines 248-249"

4. File: `workspace/05-plans/B5.md`. Not blocking.
   - Follow-up: "Stale plan text for the orchestrator to fold in. Line 153 still gives the old email_message_begin argument order (p_entity, p_entity_id, p_content_hash); migration 20261005161634 changed it. The Files lines say a disabled template writes a skipped row (the code writes none) and that the Sentry requestId is the job id (the runner's reporter uses its own request id). The author logged all of these under P-1209."
   - Evidence: "grep -n 'email_message_begin(' workspace/05-plans/B5.md -> line 153 with the old order"

5. File: `app/src/server/jobs/steps/notify-admin.ts`. Not blocking.
   - Follow-up: "The Sentry message is the rendered headline, as invariant 14 asks. Default headlines are static. But an admin who edits a recipe headline to include {{summary}} for inquiry.received would send the inquirer's name to Sentry. scrubText masks emails, not names (R37). Suspected by reading."
   - Evidence: "notify-admin.ts:59 `new AlertRaised(variables[\"headline\"] ?? ...)`; sentry.ts scrubText = maskEmails only"

6. File: `app/src/db/types.ts`. Not blocking.
   - Follow-up: "UNPROVEN. The hand-entered optional Args (P-910) may not match the CI db job's gen:types byte for byte, and the type-drift step runs git diff --exit-code. A live Resend idempotency answer, the deno.json import map under functions deploy, and the CI db job are also proven only against the author's own fake fetch, deno check, and a rolled-back mop-dev prelude."
   - Evidence: "author's unproven list; the fake Resend in tests/fixtures/email-send.ts models the 409/replay behaviour that the tests assert"

## g3 · steps 4a

1. File: `app/scripts/email-chain.ts`. Not blocking.
   - Follow-up: "Follow-up. Cleanup deletes only the submission. create_submission (supabase/sql/functions/create_submission.sql:61-67) also upserts a contacts row 'Email Chain Test' <delivered@resend.dev>, and the event, jobs and email_messages rows also stay. Under H35 this database becomes production at the launch switch, so every pre-switch chain run leaves a test contact in production data. This is a gap in the plan (it says to delete the submission only), not a broken contract."
   - Evidence: "Found by reading, not by running: create_submission.sql lines 61-67 insert into public.contacts on conflict (lower(email)), and removeSubmission in email-chain.ts deletes only from public.submissions."

2. File: `app/scripts/email-chain.ts`. Not blocking.
   - Follow-up: "Follow-up. judge() fails fast only on a dead job or a bad 'received' row. An admin_notify message that ends 'failed', or 'skipped' with a reason other than dry_run (for example not_allow_listed when settings.site.contact.email is outside dev_recipients), is never judged. The script polls the full 180 s and then exits 1 with the job list instead of the message error. The exit code is still correct, but the diagnosis is slow and indirect."
   - Evidence: "Found by reading: judge() only throws on `received` rows in FINAL that are not reached; admin_notify rows are only tested with reached()."

3. File: `app/docs/runbooks/email.md`. Not blocking.
   - Follow-up: "Follow-up. The digest command says to run it 'with .env loaded', but it needs both CONFIRM_TOKEN_SECRET and SUPABASE_ACCESS_TOKEN in the environment. The project's loader `load-env.mjs --profile dev` exports neither, so the command fails: secrets list returns 403 under the stored CLI login, and createHash().update(undefined) throws. It only works with the raw `set -a; . <(tr -d '\\r' < .env ...)` load. The runbook should name that loader."
   - Evidence: "Confirmed by running: with only the dev profile loaded, `bunx supabase secrets list` exit=1 'unexpected list secrets status 403'; with SUPABASE_ACCESS_TOKEN and CONFIRM_TOKEN_SECRET sourced from .env it exits 0 and prints 'same'. scripts/load-env.mjs dev profile names: DEV_DB_URL, DEV_SUPABASE_PROJECT_REF, DEV_SUPABASE_DB_PASSWORD, DEV_SUPABASE_SERVICE_ROLE_KEY, PREVIEW_RATE_LIMIT_SALT, OPS_HEALTH_TOKEN, OMNIKOM_MOCK_SECRET."

4. File: `app/docs/runbooks/email.md`. Not blocking.
   - Follow-up: "Follow-up, UNPROVEN (stated honestly by the author, recorded here so it is not dropped). The job-runner deploy with the email steps, its bundle size and cold start, `email-chain.ts` on mop-dev, `email-test.ts all <address>`, and CONFIRM_TOKEN_SECRET on matter-of-place-dev and matter-of-place (BLOCKED: the production Worker's latest version is not deployed after the 'smoke failed f2b24b0' rollback) all remain open until B5 steps 3 and 4 are on main. JOB_RUNNER_SECRET is missing from the lane .env, and the orchestrator must copy CONFIRM_TOKEN_SECRET from the lane .env to the root .env and to PREVIEW_WORKER_SECRETS_JSON."
   - Evidence: "Confirmed by running: wrangler secret list shows 0 CONFIRM_TOKEN_SECRET on both Workers; deployments status shows 'smoke failed f2b24b0...'. email-chain was reproduced only against a throwaway PG18 cluster, where it fails at the missing create_submission."

## g1 · steps 5

1. File: `app/docs/runbooks/email.md`. Not blocking.
   - Follow-up: "The new section says 'A dropped connection is retried three times'. The code makes three attempts in total, which is two retries: ATTEMPTS = 3 and 'if (attempt === ATTEMPTS) throw error' in app/scripts/resend-domain.ts lines 21 and 63. The unit test title agrees with the code ('the answer of the third try is used'). This is a small factual error in a runbook. Nothing in the product goes wrong because of it, so I rate it a follow-up: change the text to 'tried three times'."
   - Evidence: "Read: app/scripts/resend-domain.ts:21 'const ATTEMPTS = 3;' and :59-66; runbook line 'A dropped connection is retried three times'."

2. File: `workspace/05-plans/B5.md`. Not blocking.
   - Follow-up: "The plan text for step 5 and the Files row of resend-check.ts say it reads the three domains 'with one GET /domains'. That cannot be built: the list has no records (P-1212, re-measured: 0 occurrences of "records"). The script makes one list call plus one GET /domains/<id> per verified domain, read only. The plan line is now stale and is the orchestrator's to fold."
   - Evidence: "Confirmed by running: curl .../domains | grep -c '"records"' -> 0. app/scripts/resend-check.ts:36 calls readDomain per verified domain."

3. File: `app/scripts/resend-domain.ts`. Not blocking.
   - Follow-up: "UNPROVEN against real services: the write path (POST /domains, the Cloudflare upsert, POST /domains/<id>/verify) is only exercised against a stubbed fetch that the author also wrote. I ran a read-only check: the record names Resend returns today ('send.notes', 'resend._domainkey.notify', root 'send'/'rsend') are relative to the zone, so the '<name>.matterofplace.com' construction matches. Still unexercised: PUT overwriting the first of several TXT records at one name, and a partial write when the apex guard throws partway through the loop. The free plan has no spare slot to test this before the launch switch."
   - Evidence: "Live read of the three domains' records via listDomains/readDomain (names only); the unit tests are the only evidence for the write calls."

4. File: `workspace/05-plans/logs/B5.md`. Not blocking.
   - Follow-up: "NOT DONE (the brief anticipated this): the live half of step 5. It needs RESEND_API_KEY and EMAIL_LIVE=1 set on mop-dev, then 'bun run scripts/email-test.ts all <address>' printing a 'sent <key> <resend_id>' line per enabled key, the email_messages query, and a check of the From/Reply-To headers of 'received' and 'repermission' in the Zoho inbox. It needs JOB_RUNNER_SECRET (not in the lane .env; confirmed 0 matches) and the runner deployed from main. The orchestrator must run it before step 5 counts as closed."
   - Evidence: "Confirmed by running: grep -cE '^JOB_RUNNER_SECRET=.+' .env -> 0; supabase secrets list names show no RESEND_API_KEY or EMAIL_LIVE."

## g2 · steps 6

1. File: `workspace/05-plans/logs/B5.md`. Not blocking.
   - Follow-up: "The g2 block pastes the output of `bunx vitest run tests/unit/readpath.test.ts -t \"table writes\"` as `Tests  2 passed | 3 skipped (5)`. The command prints `Tests  1 passed | 4 skipped (5)`, because the file has exactly one it() under describe(\"table writes\") (line 60). The conclusion (green) is correct; the pasted count is not real output. That breaks C09 and the rule against paraphrasing output. I marked it follow-up because no product behaviour depends on it: the log line should be corrected to the real output."
   - Evidence: "Re-run in snapshot 5b1156a: ' Test Files  1 passed (1) /  Tests  1 passed | 4 skipped (5)'; grep of the file shows the only matching it() at line 60."

2. File: `app/src/server/hooks/resend.ts`. Not blocking.
   - Follow-up: "For `email.complained`, the hook's applyEffect runs B3's `unsubscribe_email` loop before `applyEmailEvent`, so the INT-02 env filter does not cover it. A complaint tagged env=preview that reaches the production handler after the launch switch still calls unsubscribe_email. The comment in events.ts says 'a late event of mail sent in preview must not touch production', and for complaints the hook contradicts that. The author states the decision openly in the log. The real effect is small: preview mail goes only to dev_recipients (admin@, admin+*@, *@resend.dev), so the most that happens is an admin or test address being unsubscribed. The plan's -t \"foreign env\" case targets applyEmailEvent, and that part holds. The hook-level test 'drops an event of another stage' uses email.delivered only, so no test pins the complaint path. Follow-up: either move the env check ahead of the complaint loop, or rule that a complaint is honoured whatever its stage, and add a hook test for whichever is chosen."
   - Evidence: "Reading events.ts and resend.ts at 5b1156a: applyEffect does `if (event.type === \"email.complained\") { ... db.rpc(\"unsubscribe_email\") ... }` and only then `await applyEmailEvent(...)`. Log g2: 'it also runs for a complaint tagged for another stage; the foreign-env filter covers applyEmailEvent only.'"

3. File: `app/tests/unit/email/events.test.ts`. Not blocking.
   - Follow-up: "The `delivery()` Svix-signing helper (lines 211-227) is a second copy of `sign()`/`delivery()` in B3's tests/api/resend.api.test.ts (lines 28-46). C05 asks for one shared helper; a fixture under tests/fixtures would serve both. jscpd does not scan tests, so no gate catches this. Follow-up only."
   - Evidence: "grep -rln 'svix-signature' tests/ returns both files; both build the HMAC from `${id}.${timestamp}.${body}` the same way."

4. File: `workspace/05-plans/B5.md`. Not blocking.
   - Follow-up: "Stale plan text, for the orchestrator to fold in. Step 6 says the orchestrator still has to add RESEND_WEBHOOK_SECRET to PREVIEW_WORKER_SECRETS_JSON before `wrangler secret list` shows it. That is done: the dev Worker lists RESEND_WEBHOOK_SECRET today. The live bounce proof is still UNPROVEN until this step is deployed and EMAIL_LIVE=1 is set; mop-dev's function secrets have MOP_ENV (= preview) but no EMAIL_LIVE and no RESEND_API_KEY."
   - Evidence: "wrangler secret list (with .env token) includes RESEND_WEBHOOK_SECRET; `supabase secrets list` names matching MOP|EMAIL|RESEND: ADMIN_NOTIFY_EMAIL,MOP_ENV,RESEND_FROM,RESEND_FROM_BULK."

## g3 · steps 7

1. File: `app/docs/architecture/frontend.md:65, workspace/01-site-index/pages-and-wording.md:28,39,50,299, workspace/00-MAP-OF-WHAT-WE-HAVE.md:33, workspace/05-plans/B3.md:32, workspace/05-plans/trace.json:9166,13346`. Not blocking.
   - Follow-up: "These docs still describe /place-notes as a 301 to /stories, or the confirm landing as /stories?confirmed=. trace.json names the code file as src/routes/place-notes.tsx, but the shipped file is src/routes/_site.place-notes.tsx. The author lists this as UNPROVEN. None of these files belong to g3, so the orchestrator should fold them in."
   - Evidence: "git grep -n \"place-notes\" -- . (snapshot) shows frontend.md:65 '| `/pricing`, `/place-notes`, `/markets/*` | redirects ... To `/exposure`, `/stories`'; pages-and-wording.md:50 '| `/place-notes` | `/stories` | src/routes/place-notes.tsx'; B3.md:32 '303 to `/stories?confirmed=1`'"

2. File: `app/src/routes/sitemap[.]xml.ts:5-17`. Not blocking.
   - Follow-up: "/place-notes is now a real, indexable page with a canonical pageHead and a seo-copy description, but it is not in the sitemap's staticPaths. Step 7 does not ask for this, so it is a follow-up for SEO or B4, not a defect of g3. (Suspected by reading; no test covers it.)"
   - Evidence: "sed -n 1,30p src/routes/sitemap[.]xml.ts: staticPaths lists /, /properties, /markets, /stories, /editorial-standard, /submit, /exposure, /about, /contact, /faq, /legal, and no /place-notes"

3. File: `app/src/server/email/repermission.ts:28-45`. Not blocking.
   - Follow-up: "issue_repermission and enqueue_job are two separate calls. An enqueue_job failure after the ask has committed leaves a subscriber marked as asked with no email, and lapse_subscribers will later archive them. A retry mints a new token and overwrites the hash. The author records this as UNPROVEN and it needs a plan or B11 decision. The seal-before-ask ordering for a bad key is closed and watched-fail (b5-rp-seal-first)."
   - Evidence: "read: `const issued = await db.rpc(\"issue_repermission\", ...)` followed by a separate `await enqueueJob(db, {...})`; there is no transaction or compensation"

4. File: `app/tests/unit/email/confirm.test.ts:53, app/tests/unit/email/repermission.test.ts:47`. Not blocking.
   - Follow-up: "The group added two identical captureTokens() helpers, and a third copy already exists in tests/api/subscribers.api.test.ts:105. It belongs in tests/fixtures (STANDARDS C05 spirit). jscpd does not scan tests, so no gate catches it."
   - Evidence: "grep -rn \"function captureTokens\" tests prints three hits: subscribers.api.test.ts:105, confirm.test.ts:53 and repermission.test.ts:47"

5. File: `(slice/b5 branch)`. Not blocking.
   - Follow-up: "slice/b5 is 48 commits behind origin/main. A read-only merge-tree shows conflicts in GOTCHAS.md, which bank-merge.mjs resolves, and in app/.prettierignore, which is g4's file and not g3's. No g3 source file conflicts; main changed only tests/e2e/fixtures/page.ts in g3's area. Whoever merges main next has to resolve .prettierignore."
   - Evidence: "git merge-tree --write-tree --name-only HEAD origin/main prints 'CONFLICT (content): Merge conflict in GOTCHAS.md' and 'CONFLICT (content): Merge conflict in app/.prettierignore'"

6. File: `(live proof)`. Not blocking.
   - Follow-up: "UNPROVEN: the end-to-end double opt-in against a deployed Worker with EMAIL_LIVE=1 and CONFIRM_TOKEN_SECRET (POST, click the real email, confirmed_at set). The chain from the sealed token to the confirm_url is proven only with a stubbed fetch and fakeDb. The real upsert_subscriber writing sealed_token into subscriber.created is confirmed on mop-dev, but no email was sent and no link was clicked."
   - Evidence: "author's unproven list; my read-only query shows the job dead with subscriber_missing after the smoke's cleanup, so no send happened"

## g4 · steps 8

1. File: `app/supabase/config.toml`. Not blocking.
   - Follow-up: "SMTP is now live on mop-dev, but only magic_link and invite carry the token-hash link. The confirmation, recovery and email_change templates are still Supabase's unbranded defaults with {{ .ConfirmationURL }}, and they now leave through Resend from notify. Reading GoTrue (not run): a staff sign-in request for an invited user who never accepted the invite goes through the unconfirmed or signup path, not the magic_link template. That user would get a ConfirmationURL link (the API-01 cross-device failure), or a signup_disabled error. The step names only two templates, so this is a follow-up for B7 (send-link path)."
   - Evidence: "GET /v1/projects/hbokkmpgpqhrnemgsqra/config/auth: mailer_templates_confirmation_content len 184 ConfirmationURL 1, mailer_templates_recovery_content len 254 ConfirmationURL 1, mailer_templates_email_change_content len 270 ConfirmationURL 1, mailer_autoconfirm false"

2. File: `app/scripts/build-auth-templates.ts`. Not blocking.
   - Follow-up: "Nothing in bun run check ties the committed supabase/templates/*.html to the generator. If someone edits the script or blocks.tsx and does not re-run it, the pushed HTML drifts without anyone noticing. Also, registry entry b5-aj runs the generator itself: a mutation that gets past the lint would overwrite the committed templates in the tree. The CONFIRM prefix is the only ConfirmationURL guard, and it holds today. I confirmed by running that regeneration is byte-identical and the live copy on mop-dev is byte-identical."
   - Evidence: "bun run scripts/build-auth-templates.ts followed by git status --short printed nothing (identical today). No test under tests/ reads supabase/templates (git grep finds none)."

3. File: `app/supabase/config.toml`. Not blocking.
   - Follow-up: "CI's supabase start reads [auth.email.smtp] enabled = true with env(RESEND_API_KEY) unset. Config loading tolerates this (config diff with the key unset exits 0). But once B7's admin-signin e2e asks the CI stack for a magic link, local GoTrue will try smtp.resend.com with no valid password (mailpit is already excluded with -x). UNPROVEN until B7's spec runs in CI. Record it for B7/B4."
   - Evidence: "env -u RESEND_API_KEY bunx supabase config diff --project-ref $DEV_SUPABASE_PROJECT_REF -> exit 0, same counts. .github/workflows/ci.yml:169 and :262 run supabase start -x ...,mailpit,..."

## g5 · steps 9

1. File: `app/scripts/email-chain.ts (proof of plan step 9) / mop-dev settings`. Not blocking.
   - Follow-up: "The chain proof, as the plan writes it, exits 1 on mop-dev. admin_notify resolves to settings.site.contact.email (hello@matterofplace.com), and the dev allow-list refuses that address (send-email.ts:134, only when MOP_ENV is not production). The author got exit 0 only by inserting a temporary settings.notifications row into the shared database and deleting it afterwards, and the runbook now makes that manual data change part of every chain proof. The runbook and the log say this truthfully, so nothing false is written. But the plan's pass state cannot be reached on mop-dev without a manual edit of the shared database, and the same red will hit step 5's EMAIL_LIVE=1 proof. The fix belongs to whoever owns the settings seed or the chain script: a standing dev notifications row, or the script setting and restoring the row under its own lock. Production is not affected, because the allow-list is skipped when MOP_ENV is production."
   - Evidence: "Confirmed by running: env -u CLOUDFLARE_API_TOKEN bun run scripts/email-chain.ts gave chain-exit=1 after 191 s with 'no complete chain within 180 s; jobs: send_received done ; notify_admin_received done'. The email_messages row from 05:56 is admin_notify skipped not_allow_listed."

2. File: `app/scripts/automation-smoke.ts (B8b) / supabase/sql/functions/write_audit.sql (B7)`. Not blocking.
   - Follow-up: "The step 9 proof 'automation-smoke.ts still exits 0' is NOT MET. B5 did not cause it: the smoke script's all-zero actor has no user_roles row, and write_audit raises forbidden. B5 changes neither file. This was banked as P-1220 and reported honestly. B8b's owner needs to fix it."
   - Evidence: "Confirmed by running: smoke-exit=1, 'automation-smoke: automation_put_recipe (smoke) failed: forbidden'. git diff origin/main...HEAD touches no file under supabase/sql or this script."

3. File: `app/tests/mutations/B5.json`. Not blocking.
   - Follow-up: "No registry entry covers the 375 px assertion in email-shots-page.mjs. Both new mutations fail at 600 px or at lint, so deleting the narrow-width check would leave every replay green (R49/C08: every new assertion watched failing). My scratch control shows the check works. It still needs an entry, for example a layout mutation with minWidth 500px, expecting 'received: scrollWidth 5[0-9]{2} at 375 px'."
   - Evidence: "Confirmed by running: a scratch out/email-w500.html (500 px fixed div) through email-shots-page.mjs printed 'w500: scrollWidth 500 at 375 px', exit=1. The two registry entries expect '... at 600 px' and 'container-width ...' only."

4. File: `app/scripts/email-shots.ts:41-43`. Not blocking.
   - Follow-up: "process.exit(run.status ?? 1) ignores run.error. If node is missing from PATH or the spawn fails, the script exits 1 and prints nothing, so a person sees a red gate with no cause (close to C06). Printing run.error.message when it is set would close it."
   - Evidence: "Suspected by reading: spawnSync sets error and leaves status null on ENOENT. Not run."

5. File: `app/scripts/email-shots.ts:16-21`. Not blocking.
   - Follow-up: "The literal site context {siteUrl, entity: null, address: null, contact: {email: null}} is now in four scripts (email-test.ts, email-cpu.ts, build-auth-templates.ts, email-shots.ts). It is below the jscpd threshold, but C05 asks for no second copy of a helper. One shared preview site in scripts/lib would remove the copies."
   - Evidence: "Grep 'siteUrl|entity: null|contact: {' in app/scripts finds the same 4-line object in 4 files."

6. File: `.github/workflows/ci.yml:336-347`. Not blocking.
   - Follow-up: "(1) C22: the new heavy CI step does not state its unit cost in Actions minutes. It took 130 s locally under load. (2) The step only runs when the e2e change test (T-04) sees changes under src/, supabase/, package.json or bun.lock. A PR that changes only scripts/email-shots.ts, scripts/lib/email-shots-page.mjs or scripts/lib/email-lint.ts skips the rendering gate. (3) UNPROVEN: the step and its email-shots artifact have never run in CI."
   - Evidence: "Read ci.yml lines 231-239 and 338-347. No CI run exists for 1b49b1b."

7. File: `workspace/05-plans/trace.json`. Not blocking.
   - Follow-up: "The trace entries for email:shots (around lines 7823 and 11032) name only scripts/email-shots.ts as the code file. The browser half now lives in scripts/lib/email-shots-page.mjs (a deviation the author logged), and the trace does not name it. This is the orchestrator's to fold."
   - Evidence: "Grep 'email-shots' in workspace/05-plans/trace.json shows no email-shots-page.mjs."
