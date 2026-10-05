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
