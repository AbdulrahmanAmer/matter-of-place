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
