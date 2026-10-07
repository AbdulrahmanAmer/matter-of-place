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
