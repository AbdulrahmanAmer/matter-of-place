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
