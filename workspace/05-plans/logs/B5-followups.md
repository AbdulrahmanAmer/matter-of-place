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
