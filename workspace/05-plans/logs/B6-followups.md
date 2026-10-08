# B6 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 1

Review of group g1: no blocking defect. Four follow-ups below, word for word with their evidence; the two that concern GOTCHAS.md are banked as P-2304 and as a hit-again line in G-031.

1. File: `app/tests/db/payments.db.test.ts`. Blocking: no.
   What: Plan watched-fail (u) was not done and is not in tests/mutations/B6.json or the report. Case (u): the parallel numbering test's cleanup rewinds the counter unconditionally after another issue, and the cleanup must then fail loudly. The fail-loudly branch (lines 329-333, the throw when last !== highest) is never reached in the test, because nothing else issues during it. A mutation that rewinds unconditionally would stay green. The guard reads correctly, and it only matters for a human issuing on mop-dev while the test runs. That would end as a duplicate-number unique violation, not silent damage.
   Evidence: Suspected by reading: B6.json has b6-g1-parallel (max-based numbering) but no entry for (u). Plan Verification line 126 lists (u).

2. File: `app/tests/db/payments.db.test.ts`. Blocking: no.
   What: The plan's parity case is not built: payment_tier(p) should equal tierOf(p) for every value. The test 'payment_tier gives the tier of every product' (line 1033) checks a hand-typed table, because src/domain/payments.ts comes with step 2. The bank records this as NOT DONE (hit-again under the P-0xx entry for step order), but the claim's unproven list leaves it out. The slice log calls this case 'payment_tier parity'. Step 2 must turn it into the real tierOf comparison. The same applies to createInvoice, which takes its price from exposure.ts instead of priceFor.
   Evidence: git diff origin/main...31f98e0 -- GOTCHAS.md: 'the tierOf parity is NOT DONE in g1'. The log line: 'campaign_days, payment_tier parity, invoice_list ...'.

3. File: `app/tests/mutations/B6.json`. Blocking: no.
   What: Watched-fail (ag) does not do what the plan describes, and the change is not logged. The plan expects the days_open = 15 case and time-model.test.ts to go red. b6-g1-ag-fixed-now replaces dbNow with a literal Date in factories.ts and runs only the factories case. The invoice_list case cannot go red under (ag), because it passes issued_at and due_at itself (lines 1056-1062). time-model.test.ts is not touched, because the mutation imports no FIXED_NOW. Plan line (ag) is stale; the orchestrator should fold that.
   Evidence: Registry entry b6-g1-ag-fixed-now: run '-t "writes a payment the constraints accept"'. The overrides are at payments.db.test.ts:1060-1061.

4. File: `app/supabase/migrations/20261006224201_invoicing.sql`. Blocking: no.
   What: Two additions the plan did not ask for and the log does not mention (C01). First, the constraint payments_product_chosen check (product <> 'Not sure yet'); the plan says ALTER payments adds 'exactly' its listed columns and checks. Second, the insert that starts invoice_counters from existing payment numbers (lines ~57-65). Both are harmless today: mop-dev has 0 payments, so the counter starts at 0, and no caller pays for 'Not sure yet'. They should be logged as deviations or removed in a later group.
   Evidence: psql on mop-dev printed '0|0' for 'select count(*), count(invoice_number) from public.payments'. grep for product_chosen in B6.md, ASSUMED.md and review/B6.md finds nothing.

## g2 · steps 2

Review of group g2: no blocking defect. Five follow-ups below, word for word with their evidence; the two that concern GOTCHAS.md are banked as hit-again lines on P-713 and P-803 and as P-2309.

1. File: `workspace/05-plans/STANDARDS.md`. Blocking: no.
   What: R06 (line 118) still says src/server never imports src/data. src/server/payments/pricing.ts now does, under a one-file exception in tests/unit/boundaries.test.ts. The plan requires this import, and the folder map's src/data row allows production to read exposure.ts. The R06 prose needs the matching exception so the next reviewer does not flag it. This file belongs to the orchestrator.
   Evidence: grep -n 'R06' workspace/05-plans/STANDARDS.md; git diff origin/main...slice/b6 -- app/tests/unit/boundaries.test.ts

2. File: `app/src/domain/workflow.ts`. Blocking: no.
   What: Line 24 widens a hand-written local union `type PaymentStatus = ... | "void"` that duplicates the generated enum PaymentStatus in src/domain/rows.ts (Enums<"payment_status">). The banked rule P-2306 ('widen PaymentStatus in workflow.ts when the enum gains a value') keeps the manual step instead of deriving the type from rows.ts, so the next enum value will diverge again. workflow.ts is also outside the group's named files, but the step could not type without it. Suspected by reading.
   Evidence: grep -n 'PaymentStatus' app/src/domain/workflow.ts app/src/domain/rows.ts

3. File: `app/tests/unit/payments/domain.test.ts`. Blocking: no.
   What: The test titled 'accepts the seeded invoice settings' parses a hand-typed copy, not the jsonb seeded by 20261006224201_invoicing.sql, so a drift between the seed and invoiceSettingsSchema would stay green. I parsed the real seed by hand and it passes today.
   Evidence: Scratch script running invoiceSettingsSchema.safeParse on the seed extracted from the migration printed true. The test's `settings` constant is a literal.

4. File: `app/src/server/payments/adapters/manual.ts`. Blocking: no.
   What: PaymentAdapter.prepare is typed to return a Promise, but invoiceManual.prepare throws synchronously when there is no snapshot (and a ZodError, not an AppError, on a malformed snapshot). StripeAdapter.parseWebhook has no watched-fail entry; only prepare is mutated in b6-g2-stripe-stub. A caller that uses .catch() instead of await inside try would miss the throw. Suspected by reading; no caller exists yet.
   Evidence: app/src/server/payments/adapters/manual.ts lines 14-23; app/tests/mutations/B6.json entry b6-g2-stripe-stub mutates only 'Stripe prepare'.

5. File: `workspace/05-plans/B6.md`. Blocking: no.
   What: The plan text says markPaidInput refuses a future paid_at with 422. The code puts that refusal in paidAtIsFuture(paidAt, now) because of R29. The plan line needs folding. The in-progress g3 service.ts (uncommitted, line 250) already calls paidAtIsFuture(input.paidAt, new Date()), but that is UNPROVEN until g3 is reviewed.
   Evidence: grep -n paidAtIsFuture app/src/server/payments/service.ts (uncommitted g3 work)

## g3 · steps 3

Review of group g3: no blocking defect. Five follow-ups below, word for word with their evidence; the two that concern GOTCHAS.md are banked as P-2315 and P-2316 (the prettier cost was mapped to P-066, which holds no such lesson).

1. File: `app/tests/mutations/B6.json`. Blocking: no.
   What: Follow-up. The entry b6-g3-ac-copy-loop runs tests/unit/subrequest-budget.test.ts, which resets modules and imports route files. It still gets vitest's 5000 ms default. This is the same flaw this fix round fixed for the four pdf-route entries, and it breaks the rule the round just banked under G-031.
   Evidence: First replay: 'WATCHED-FAIL BAD: wrong reason (B6:b6-g3-ac-copy-loop)' with 'Error: Test timed out in 5000ms' on all 3 tests. The rerun alone gave WATCHED-FAIL OK. Fix: add --testTimeout=60000 to its run line. The G-031 hit-again's own proof (grep -c ... pdf-route ... prints 4) cannot see this entry.

2. File: `app/src/server/payments/service.ts`. Blocking: no.
   What: Follow-up (UNPROVEN, already declared by the author). No test proves the order of the payments list. The round-trip stand-in's order() is a no-op, so changing nullsFirst: false to true at line 173 (or reversing ascending) stays green. Postgres DESC puts NULLs first by default. If the option is lost, the waivers recorded without an invoice lead page 1 and the keyset sequence breaks. Needs a db or e2e case over invoice_list.
   Evidence: node scripts/watchfail.mjs --file src/server/payments/service.ts --find 'nullsFirst: false' --replace 'nullsFirst: true' --run 'bunx vitest run --project unit tests/unit/payments/service.test.ts' --expect 'FAIL .*listPayments' printed 'WATCHED-FAIL BAD: stayed green'

3. File: `app/supabase/migrations/20261006224201_invoicing.sql`. Blocking: no.
   What: Follow-up (C11, suspected by reading). The keyset list on invoice_list orders by (issued_at desc, id desc) and filters by issued_at, but no index on payments(issued_at, id) serves it. Only payments_waived_by_idx and payments_one_live_idx exist. Harmless at launch volume, but C11 asks every new list query to name its index.
   Evidence: grep -n 'create index\|create unique index' supabase/migrations/20261006224201_invoicing.sql shows only payments_waived_by_idx and payments_one_live_idx

4. File: `app/supabase/migrations/20261007021713_action_roles.sql`. Blocking: no.
   What: Follow-up for the next merge of origin/main. main now carries 20261007035723_action_roles.sql, so migration-order refuses this file until it is restamped (P-511, bun run migrations:restamp). Both files are upsert-only, so the order loses no rows.
   Evidence: bun run migrations:check printed 'rename supabase/migrations/20261007021713_action_roles.sql to a timestamp after 20261007035723', exit 1

5. File: `app/src/server/payments/service.ts`. Blocking: no.
   What: Follow-up. Plan Files says issueInvoiceCore(db, input, actor) is exported for scripts/invoice-smoke.ts. Here it is file-local, with the signature (db, raw, audit: AuditArgs). Under R04 the export waits for the step that first imports it, but whoever writes the smoke issue path must edit service.ts and reconcile the signature with the plan line. Also markPaid still sends p_reference: '' for an absent reference (the author's own recorded follow-up).
   Evidence: service.ts line 109: 'async function issueInvoiceCore(db: Db, raw: unknown, audit: AuditArgs)'; line 255: 'p_reference: input.reference ?? ""'

## g4 · steps 4

Review of group g4: no blocking defect. Four follow-ups below, word for word with their evidence; the three that concern GOTCHAS.md are banked as P-2317 (`npx tsc`), P-2318 (replacing a STUB touches the earlier group's tests and registry) and as hit-again lines on P-094 and P-008.

1. File: `app/tests/unit/assert-not-production.test.ts`. Blocking: no.
   What: Nothing fails if the production guard is removed from either new script. The test's guardedScripts list (lines 13-32) does not contain scripts/set-invoice.ts or scripts/invoice-smoke.ts, although the test's own comment says later slices append the files they create. The plan's watched-fail (aj) says that deleting assertNotProduction from invoice-smoke.ts, then from set-invoice.ts, must turn this test red naming the script. Today it cannot go red. The guard is present in both scripts now (confirmed by reading). But if it is lost in a refactor, every gate stays green, and after the launch switch set-invoice.ts could write the 'Test only (dev)' payment instructions into the production settings.invoice. This test file is not in g4's file list (one writer per file), so this is a follow-up. It must be closed before slice B6 closes, because the (aj) watched-fail cannot be replayed until then.
   Evidence: Read lines 13-32 of tests/unit/assert-not-production.test.ts: the list has 18 paths and neither invoice script. The author's watchedFail list has no (aj) entry. (Suspected by reading; I did not mutate the scripts because this review is read-only.)

2. File: `app/scripts/set-invoice.ts`. Blocking: no.
   What: Against STANDARDS C05/R04: set-invoice.ts:19 and invoice-smoke.ts:12 each declare their own requiredEnv and build the 'https://<DEV_SUPABASE_PROJECT_REF>.supabase.co' URL and key by hand. scripts/lib/storage-env.ts already exports requiredEnv and devProject(), which return exactly that url and key from the dev-profile names. jscpd passes because each copy is under 70 tokens.
   Evidence: grep -rn 'function requiredEnv' scripts shows scripts/lib/storage-env.ts:10 (exported) and new copies at scripts/set-invoice.ts and scripts/invoice-smoke.ts:12.

3. File: `app/src/server/payments/invoice-settings.ts`. Blocking: no.
   What: Against R04: the exported types InvoiceSettings, InvoiceInputs and InvoiceSettingsActor are not imported anywhere outside this file. knip does not flag exported types under the current config. InvoiceSettingsActor will probably be needed by B7's settings service; the other two could be file-local.
   Evidence: A grep over src, scripts and tests for these names, excluding this file, finds only a local type alias in service.test.ts:90 that does not import them.

4. File: `app/scripts/set-invoice.ts`. Blocking: no.
   What: UNPROVEN (the author already said so): the two 'ready' outputs of step 4 and the exact line 'missing: payment_methods.instructions' on mop-dev. They wait on B16's set-site.ts and site.example.json/site.empty.json. The only evidence that the example fixture is ready and the seed lacks only payment_methods.instructions is the fake-db unit test, against a site object the test builds itself.
   Evidence: On mop-dev, set-invoice.ts --file invoice.example.json printed 'missing: legal.entity, legal.address' (the site row has legal.entity and legal.address null).

## g5 · steps 5

Review of group g5: no blocking defect. Seven follow-ups below, word for word with their evidence; none concerns GOTCHAS.md, so no entry is added to the bank.

1. File: `app/src/server/payments/invoice-layout.ts`. Blocking: no.
   What: Follow-up. Failures that will happen the same way every time are thrown as retryable errors. layoutInvoice throws AppError("server", ..., "<field>_missing") at line 184 and "invoice_overflow" at line 237, and neither is a NonRetryableError. So the invoice_pdf job (maxAttempts 12) and the send_email attachment resolver (which calls ensureInvoicePdf) retry a failure that cannot change until they go dead. By contrast, payment_missing, snapshot_missing and snapshot_invalid are final. This is also how the author's overflow follow-up shows up in the product: settings.invoice has no length bound, so long payment instructions make every later invoice's PDF job and invoice email go dead after the full backoff, and nobody sees it until screen 16. The plan does not ask this step for either the bound or the classification.
   Evidence: Read: invoice-layout.ts:184 and :237 throw AppError; invoice-pdf.ts:70-74 use NonRetryableError for the other final cases; system/invoice-pdf.ts:10 maxAttempts 12. Not run against a runner (suspected by reading).

2. File: `workspace/05-plans/B6.md`. Blocking: no.
   What: Follow-up for the orchestrator to fold into the plan. Three plan lines no longer match the code: (1) the plan has localInvoiceStore(dir) exported from invoice-pdf.ts, but it does not exist and --out writes the file in the script (R07, P-2312); (2) the plan puts sanitizeWinAnsi in invoice-pdf.ts, but it lives in invoice-layout.ts; (3) the plan says assertNotProduction is the first call of invoice-smoke.ts, but guardEnv() runs first (line 107). Each deviation is recorded in the g5 log.
   Evidence: grep -n localInvoiceStore app/src -r gives no hits; scripts/invoice-smoke.ts:107-108

3. File: `app/scripts/invoice-smoke.ts`. Blocking: no.
   What: Follow-up. When the wait times out, waitForUpload ignores the error from its jobs query (lines 97-102: job.data ?? []) and prints 'invoice_pdf job: none'. A failed read then looks like a job that was never enqueued. The exit code is still 1, so nothing passes that should fail.
   Evidence: Read: scripts/invoice-smoke.ts:97-102 never checks job.error

4. File: `app/supabase/migrations/20261007051516_action_roles.sql`. Blocking: no.
   What: Follow-up and UNPROVEN. The g5 work commit bc65f84 also carries a regenerated action_roles migration and a restamp of g3's migration, which is merge fallout outside the group's file list (P-2314). It is proven only by bun run check's sync test here. Its database proof is the CI db job on the pull request, which has not run for this commit.
   Evidence: git show --stat bc65f84 -- app/supabase/migrations: one rename plus one new 101-line file

5. File: `app/tests/mutations/B6.json`. Blocking: no.
   What: Follow-up, noted by the author too. The registry entry b6-g5-g-live-settings hardcodes an entity instead of reading settings.site, so watchfail does not replay the realistic mutation (g). The test itself would still go red if ensureInvoicePdf read the fake settings row, which holds 'Another Entity Inc.'.
   Evidence: tests/unit/payments/invoice-pdf.test.ts 'renders from the stored snapshot, not from settings changed after the issue'; watchfail --only b6-g5-g-live-settings is OK

6. File: `workspace/05-plans/logs/B6.md`. Blocking: no.
   What: Follow-up. The fix-round log calls the BAD replay of B2:f-matrix 'an entry of main'. When replayed, that entry fails for an environmental reason: the db test refuses without DEV_DB_URL, so the mutation never ran. Also, the file it mutates (src/domain/workflow.ts) was changed by this lane in g2 (dba3118, adds 'void' to PaymentStatus). So this lane's own change has never been checked by f-matrix in a valid replay.
   Evidence: node scripts/watchfail.mjs --registry tests/mutations --only f-matrix prints 'WATCHED-FAIL BAD: wrong reason' and 'refusing: DEV_DB_URL is not set'; git log origin/main..HEAD -- app/src/domain/workflow.ts shows dba3118

7. File: `app/src/server/payments/invoice-pdf.ts`. Blocking: no.
   What: UNPROVEN, not a defect. Nothing has been checked against a real Storage, database or Edge runtime. The 409 'already exists' handling, the set_invoice_key race, the attachment resolver and the job all ran only against the author's own fake-db fixture (tests/fixtures/invoice-snapshot.ts). The Edge-runtime render of the dynamic import("pdf-lib") and the mop-dev smoke (--print-text, --out, --upload) have not run. My read-only query confirms that mop-dev settings.site has no legal.entity or legal.address, so readiness fails today.
   Evidence: read-only transaction on mop-dev: [{"key":"site","entity":false,"address":false},{"key":"invoice","methods":3}]

## g6 · steps 6

Review of group g6: no blocking defect. Five follow-ups below, word for word with their evidence. Two concern GOTCHAS.md (P-2319 and P-2320, both corrected in place in the bank, not listed again here as open work); the other three are below.

1. File: `workspace/05-plans/logs/B6.md`. Blocking: no.
   What: The g6 log says the one bad entry in the --changed replay is 'an entry of another group's file that main brought'. That is wrong. `watchfail.mjs --changed origin/main` diffs from merge-base(origin/main, HEAD), which is 35dfdc5, the main the lane merged. So every selected file is one that slice B6 itself changed, not one main brought. I identified the entry. It is B2:f-matrix, a B2 entry on src/domain/workflow.ts (B6 g2 added 'void' to PaymentStatus there). It runs `--project db`, and that project refuses at global-setup without DEV_DB_URL. So it fails because of the environment and is not a regression. The log's conclusion holds (not this group's, harmless), but its stated cause is false. Not blocking: no product behaviour, data or proof depends on it.
   Evidence: Confirmed by running. `git merge-base origin/main HEAD` gives 35dfdc56. Filtering the registry on `git diff --name-only 35dfdc5...98e045f` selects 135 entries, all on files B6 changed. `node scripts/watchfail.mjs --registry tests/mutations --only f-matrix` prints 'Error: refusing: DEV_DB_URL is not set' and then 'ok 0, bad 1'.
   Handling: the g6 log block is append-only, so the correct cause is stated in the "## g6 · follow-ups recorded" block of B6.md and in P-2319.

2. File: `workspace/05-plans/logs/B6.md`. Blocking: no.
   What: UNPROVEN: the design review covered only a stand-in, the layout runs drawn in Chromium with Times New Roman and Arial. The real out/invoice.pdf was not rendered or viewed, and invoice-smoke.ts was not run. The log says 'mop-designer, run now', but nothing in the commit shows a mop-designer review took place (no transcript, no reference). The author says all of this openly. It stays open until the smoke PDF exists on mop-dev and someone looks at it.
   Evidence: Read in the g6 log block. Commit 98e045f touches only invoice-layout.ts, its test, B6.json, GOTCHAS.md and the log.

3. File: `workspace/05-plans/logs/B6.md`. Blocking: no.
   What: Some of the adjustments have no test: 'Preferred method' changed from strong to body, the closing note moved 8 pt lower, and the invoice number moved 4 pt lower. Reverting any of them leaves every test green. These are design choices and the plan asks for no test of them, so this is a note, not a defect.
   Evidence: Read in the git show 98e045f diff. The new test checks only baseline alignment, label font and the set of inks.

The two GOTCHAS.md follow-ups, kept here word for word for the record:

- P-2319 gives the wrong cause, so its rule is wrong too. It says a lane that merged main 'differs from the ref in files other lanes changed after the merge base'. In fact --changed selects the whole slice's diff since the merge base: 92 B6 entries plus 43 other-slice entries on files B6 edited. Merging main does not grow that set. The rule ('use --changed only when the lane has not merged main') therefore steers lanes away from the one replay that catches cross-slice regressions on shared files, for a reason that is not true. The entry should also say that db-project entries (for example B2:f-matrix) go BAD in a unit shell without the dev profile, so that 'bad 1' does not look like a regression. Evidence: Confirmed by running (see follow-up 1). Banked: P-2319 rewritten.
- P-2320's proof is `import('file:///D:/mop-build/b6/app/node_modules/playwright/index.mjs')`. That only shows node can import playwright, from a lane path that disappears when the lane is removed. It does not show the claimed symptom (bun plus Playwright hangs, no PDF rasteriser). A proof should be runnable from any tree, and it should show the thing the rule depends on. Evidence: Suspected by reading the entry text in the diff; not run by the reviewer. Banked: P-2320 proof replaced by one that runs from any tree (no rasteriser on the PATH; Playwright loads under node).

## c3h · steps 8-9

Review of group c3h: no blocking defect. Seven follow-ups: two concern GOTCHAS.md (hit-again lines added to P-1930, P-310 and P-2321, not listed again here as open work); the other five are below, word for word with their evidence.

1. File: `app/src/admin/invoices/InvoiceDetail.test.tsx`. Blocking: no.
   What: The jscpd clone between this file's serve() helper and B7's src/admin/properties/properties.test.tsx was cleared by renaming the local variable key to route (merge 25afac5e). That breaks the token match without removing the duplicate. The same fetch-stub helper now exists three times: InvoiceDetail.test.tsx:141, properties.test.tsx:88 and RequestDetail.test.tsx:255. This gets around G04/R04 (the copy-detection rule) rather than meeting it (C05 also asks for one shared copy). It is test-only and no product behaviour changes. It belongs in a shared tests/fixtures helper, or as an accepted exception recorded in the bank.
   Evidence: git diff 25afac5e^1 25afac5e -- app/src/admin/invoices/InvoiceDetail.test.tsx (three lines key->route); grep -rn 'function serve' app/src

2. File: `workspace/07-admin-platform/admin-screens.md`. Blocking: no.
   What: Line 50 still gives B6 step 9's proof as `E2E_TARGET=dev bunx playwright test --project admin tests/e2e/admin-invoice.spec.ts` on mop-dev. Under H70 that command exits 0 with 7 skipped, so anyone who follows it sees a green that tested nothing (it also carries the `--project admin` form that P-1218/GOTCHAS:3628 says fails). The log's orchestrator note names B6.md only. It leaves out this file and workspace/05-plans/sizing/B6.json g6 ('which also runs in CI's admin project'). This is the orchestrator's file to update.
   Evidence: sed -n 50p workspace/07-admin-platform/admin-screens.md; my run without E2E_FULL_STACK printed '7 skipped', exit 0

3. File: `app/tests/mutations/B6.json`. Blocking: no.
   What: b6-g3-e2e-mail-status cannot reliably fail. expect.poll stops at the first match, so the mutant .toBe("sent") stays green whenever the email_messages row reads sent at the first poll, which is the normal order (sent before the delivered webhook). The `what` says so and the entry is manual, but no replay of it can show that accepting 'delivered' is load-bearing. It needs a deterministic form (for example, poll until delivered or until a fixed wait has passed, then assert the set) or an explicit UNPROVEN that stays open.
   Evidence: git show 0583b773 -- app/tests/mutations/B6.json (what text); spec .poll(...).toMatch(/^(sent|delivered)$/)

4. File: `workspace/05-plans/logs/B6.md`. Blocking: no.
   What: The round-3 block says 'two lines of g1's InvoiceDetail.test.tsx' changed. Its own Merge line and the diff show three. The hand-in's gotchasAdded is [] even though this round added hit-again lines to P-1908, P-537 and P-094 and edited P-2329 and P-2323. These are small bookkeeping inconsistencies.
   Evidence: workspace/05-plans/logs/B6.md:424 vs :426; git diff 25afac5e^1 25afac5e -- app/src/admin/invoices/InvoiceDetail.test.tsx
   Handling: the log block is append-only, so the count is stated in the "## c3h · follow-ups recorded" block of B6.md.

5. File: `app/tests/e2e/admin-invoice.spec.ts`. Blocking: no.
   What: UNPROVEN, as the author says and as I reproduced: all seven rehearsal tests beyond the issue confirmation. The by-hand E2E_FULL_STACK=1 run on mop-dev still gets a 403 forbidden at spec:230, because B6's three action_roles migrations are not on main (0 payments.* rows on mop-dev). Also UNPROVEN: the picker and unaccepted manual entries since the kind change, and CI's real result for this PR. The proof of the slice's observed exit is still open until B6 is merged, main pushes the migrations, and the Proof 4 command is run once.
   Evidence: my run: 1 failed, 6 did not run, with the trace resource holding {"error":{"code":"forbidden"...}}; mop-dev query: payments action_roles 0, B6 migrations applied 0
