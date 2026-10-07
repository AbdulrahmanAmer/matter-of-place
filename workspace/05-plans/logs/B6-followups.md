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
