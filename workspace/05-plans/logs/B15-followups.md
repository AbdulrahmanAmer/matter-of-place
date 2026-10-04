# B15 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 1-2

All seven are non-blocking. None names GOTCHAS.md, so none became a bank entry.

1. File: `app/src/server/omnikom/payload.ts`
   - Follow-up: Follow-up for step 5 (the attribution capture), and possibly for this builder. buildInquiryPayload passes inquiry.attribution through attributionSchema.parse without compacting it. data.inquiry is compacted, so an empty string there is dropped, but an empty-string utm value, a landing_path over 200 characters, or a null column throws a ZodError instead. That makes the whole inquiry permanently unforwardable, while the Contract says absent values are simply omitted. No writer of inquiries.attribution exists yet, so nothing breaks today. Step 5 must store only values that satisfy src/domain/omnikom.ts attributionSchema (min 1, max 200), or the builder should drop bad attribution fields rather than refuse the inquiry.
   - Evidence: Confirmed by running: bun -e buildInquiryPayload({...row, attribution:{first_touch:{utm_source:''}}}, null) throws at first_touch.utm_source; landing_path '/'+'a'*250 throws at first_touch.landing_path; attribution null throws (src/domain/omnikom.ts lines 10-21, payload.ts attribution line).

2. File: `app/src/server/omnikom/client.ts`
   - Follow-up: Follow-up, a design call for step 3. deliver()'s bare catch wraps outcomeOf as well as fetch. Two things follow. A refused 4xx whose body stream errors (or times out while the detail is read) becomes {kind:'retry'} rather than refused. A malformed OMNIKOM_WEBHOOK_URL also walks the full roughly 33-hour ladder. In both cases the cause is dropped. It is a typed outcome, so R10/C06 is not broken. The author flagged the URL case.
   - Evidence: Confirmed by running: a 422 Response with a ReadableStream that errors gives {"kind":"retry"}; fetch throwing TypeError('Invalid URL') gives {"kind":"retry"} (client.ts lines 83-87).

3. File: `app/src/server/lib/crypto.ts`
   - Follow-up: Follow-up, not this group's file. The marker at line 47 reads '// STUB(B15): first used by src/server/omnikom/payload.ts' and is now stale, because payload.ts imports sha1Bytes. The stubs gate (G05) will fail once B15 is marked closed unless a later B15 group or the orchestrator removes it.
   - Evidence: grep -n STUB app/src/server/lib/crypto.ts gives 47:// STUB(B15): first used by src/server/omnikom/payload.ts (UUID v5 delivery id), its only user

4. File: `workspace/05-plans/B15.md`
   - Follow-up: Follow-up for the orchestrator (stale plan line). The Files list's imports rule says the omnikom files import '@/domain/omnikom.ts', '@/server/lib/hmac.ts' and so on, and that these resolve under vitest. They do not: vitest.config.ts has no alias. The code correctly uses relative .ts paths, which R07 allows, and P-1700 banks this. The plan text still tells later groups (step 3 webhook-omnikom.ts, step 4 deno check) to use '@/'.
   - Evidence: cd app && grep -c alias vitest.config.ts gives 0; tsconfig.json has paths '@/*' but vitest.config.ts has no tsconfig-paths plugin

5. File: `app/docs/omnikom-webhook.md`
   - Follow-up: NOT DONE (declared honestly by the author). Step 1 says 'send the note to Omnikom for confirmation', and that has not happened because the plan names no recipient or channel. The whole endpoint contract stays ASSUMED. Whoever sends the note must attach tests/unit/omnikom/vector.json and docs/verify-example.mjs, since the note points at repo paths Omnikom cannot see.
   - Evidence: Author's unproven list and logs/B15.md 'NOT DONE: send the note to Omnikom'

6. File: `app/src/domain/omnikom.ts`
   - Follow-up: Follow-up, low likelihood. The representation schema requires name and brokerage to be non-empty, but representatives.brokerage is only 'not null' in 20261001090300_catalog.sql (no blank check). A representative saved with brokerage '' would make every inquiry about their properties throw a ZodError in the builder. Either compact the representation (omitting the empty brokerage) or add a non-blank check to the table.
   - Evidence: Confirmed by running: buildInquiryPayload(row, {...property, representative:{name:'N', brokerage:''}}) throws at data.subject.representation.brokerage; catalog.sql line 76 'brokerage text not null'

7. File: `app/tests/unit/omnikom/client.test.ts`
   - Follow-up: UNPROVEN against reality, and not fixable in this group. Every client behaviour (headers, timeout, classification, Retry-After) is proven only against a fake fetch the author wrote. No Omnikom endpoint exists (PLAN.md: B15 is built and stays switched off). The signature is anchored to an independent openssl vector; the transport behaviour is not. Later B15 steps (the mock receiver and step 7's send-test) are where this gets closed.
   - Evidence: client.test.ts fakeOmnikom stubs globalThis.fetch; PLAN.md line 57 'The Omnikom endpoint does not exist, so B15 is built and stays switched off.'

## g2 · steps 3

Seven follow-ups, all non-blocking. Two more named GOTCHAS.md and became bank entries (P-1703 new, P-310 hit again), so they are not repeated here.

1. File: `app/supabase/migrations/20261004193550_inquiry_attribution.sql`
   - Follow-up: Lines 1-3: the `-- down:` block says to re-apply `git show origin/main:app/supabase/sql/functions/create_inquiry.sql`. This is the plan's text word for word. After this merges, origin/main holds the new body that inserts `attribution`. Anyone who follows the block after the merge re-applies the attribution body and then drops the column. create_inquiry then fails at call time and every POST /inquiries returns an error. The earlier migrations say 'from the previous commit of supabase/sql/functions/<name>.sql', which stays true after a merge. The fix is to pin the commit (fbfd3dd) or use that 'previous commit' wording, in both the plan's Data changes line and the file. Not blocking because the plan dictates the text; the orchestrator folds it.
   - Evidence: grep -n -A2 '^-- down:' app/supabase/migrations/*.sql: 20261004135327_public_write_events.sql and others say 'from the previous commit of ...'; only 20261004193550 says 'origin/main' (found by reading, not run as a rollback)

2. File: `app/tests/unit/omnikom/attribution.test.ts`
   - Follow-up: I saw one red run in five (Tests 1 failed | 6 passed (7)) while `bun run check` ran alongside. I did not capture which case failed. The unit project uses vitest's default 5 s timeout (vitest.config.ts sets testTimeout only for db; `bun run check` passes --testTimeout=60000). Each case calls vi.resetModules() plus dynamic imports under jsdom, and the 'sends nothing' case also imports src/services/http. A timeout under load is the likely cause, but that is a suspicion and the cause is UNPROVEN. It never failed when run alone.
   - Evidence: bunx vitest run tests/unit/omnikom/attribution.test.ts, run concurrently with bun run check: exit 1, 'Tests 1 failed | 6 passed (7)', 'Duration 54.48s (environment 86%...)'; the next four runs gave 7 passed

3. File: `app/src/lib/attribution.ts`
   - Follow-up: Line 183: UTM_NAMES lists only utm_source, utm_medium, utm_campaign and utm_content. Invariant 4 says last_touch is replaced when the URL carries 'any utm_* parameter'. A client navigation that carries only utm_term or utm_id does not count as an arrival. That is consistent with the v1 key set but narrower than the invariant's wording. Fix either the wording or the code.
   - Evidence: Read: `const arrival = referrerHost !== undefined || UTM_NAMES.some((name) => params.has(name));`

4. File: `app/src/components/forms/contact-form.tsx`
   - Follow-up: No test covers the form wiring. The 'sends nothing until submitted' case passes `attribution: readAttribution()` into services.inquiries.send itself. Removing `attribution: readAttribution()` from contact-form.tsx:36 or inquiry-dialog.tsx:167 turns nothing red. The plan does not ask this step to close it; B16's legal-pages test and the e2e step 5 may.
   - Evidence: grep -rn readAttribution src tests: the only test use is attribution.test.ts, which calls it directly

5. File: `app/src/domain/contracts.ts`
   - Follow-up: C05: the attribution Zod schema now exists twice. contracts.ts:137-156 (g2) and src/domain/omnikom.ts touchSchema/attributionSchema (g1) are copies. G-004 already relies on the names staying identical. omnikom.ts imports contracts.ts, so omnikom.ts could reuse `attributionSchema` from contracts and add `.strict()`. That edit belongs to the owner of omnikom.ts (g1), not to this group.
   - Evidence: Read: both files declare landing_path, referrer_host, utm_source, utm_medium, utm_campaign, utm_content, at, first_touch, last_touch, pages_viewed with the same bounds

6. File: `app/scripts/lib/guard-env.mjs`
   - Follow-up: SEC-08 gap (not this group's file): load-env now places OMNIKOM_WEBHOOK_URL and OMNIKOM_WEBHOOK_SECRET in the ops profile as production partner values. guard-env's OPS_NAME regex does not match them, so a test or dev-script shell that holds the production webhook secret is not refused. There is no value today (S59); a later slice should extend the regex.
   - Evidence: Read: const OPS_NAME = /^PROD_|^SUPABASE_ACCESS_TOKEN$|^CLOUDFLARE_API_TOKEN$|^CF_EDGE_TOKEN$|^BACKUP_/;

7. File: `app/docs/runbooks/database.md`
   - Follow-up: Line 33 lists the load-env profile names. It was already missing PREVIEW_RATE_LIMIT_SALT and OPS_HEALTH_TOKEN, and now also misses OMNIKOM_MOCK_SECRET (dev), OMNIKOM_WEBHOOK_URL and OMNIKOM_WEBHOOK_SECRET (ops). It is a stale doc line in a file outside this group, for the orchestrator to fold.
   - Evidence: grep -n OPS_HEALTH_TOKEN docs/runbooks/database.md: line 33 lists dev = DEV_DB_URL, DEV_SUPABASE_PROJECT_REF, DEV_SUPABASE_DB_PASSWORD, DEV_SUPABASE_SERVICE_ROLE_KEY only

## g3 · steps 4

Four follow-ups, all non-blocking. None names GOTCHAS.md, so none became a bank entry.

1. File: `app/tests/unit/omnikom/webhook-step.test.ts`
   - Follow-up: Lines 83-100: dbOf() replaces fakeDb's `from` with its own hand-written table layer. It still throws `unexpected table` and records calls, but it is a second copy of the fixture's query chain, which R50 and C05 rule out ('Unit tests reach a database only through tests/fixtures/fake-db.ts'; no second copy of a helper in tests/fixtures). It also drops every filter. So `.eq("id", inquiryId)` in loadInquiry, `.eq("slug", slug)` in loadSubject and `.eq("id", representativeId)` could each name the wrong column and every test would stay green. By reading, the three filters are correct. The likely cause is that FakeDbOptions.tables wants full Row types; the clean fix is to widen that fixture. Not blocking: I cannot name an input that makes the shipped step go wrong.
   - Evidence: Read lines 83-100 of the test and lines 58-74 of tests/fixtures/fake-db.ts: the same Object.assign(Promise.resolve(...), { eq: query }) pattern. The author's own UNPROVEN list says the same about 'archived included'.

2. File: `app/src/server/jobs/steps/webhook-omnikom.ts`
   - Follow-up: Line 109: the step does not pass ctx.signal to deliver(). R27 and the StepContext comment in types.ts ('Every outside fetch passes it (JOB-02)') require it. client.ts (g1's file) has no signal parameter and uses only AbortSignal.timeout(10_000). This is benign today: the runner's 20 s light-step timeout bounds the step, and a fetch that lands after the job has failed is answered 409 on the next run, which then marks the inquiry. The author already logged it as a follow-up for g1's client.ts. Fixing it needs a signal option on deliver() threaded from the step.
   - Evidence: grep -n signal app/src/server/omnikom/client.ts: only `signal: AbortSignal.timeout(TIMEOUT_MS)`; app/src/server/jobs/runner.ts:158 is `AbortSignal.timeout(timeoutFor(def))` with DEFAULT_TIMEOUT_MS = 20_000

3. File: `workspace/05-plans/B15.md`
   - Follow-up: A stale plan line, for the orchestrator to fix. Risks say jobs.attempts 'stays 1 for the whole ladder'. The author measured that claim_job leaves attempts alone and only fail_job moves it, so a laddered new job keeps 0. The step's comment states the measured behaviour and the slice log records the mismatch. The plan text still says 1.
   - Evidence: workspace/05-plans/logs/B15.md, g3 block: 'Plan Risks say `jobs.attempts` "stays 1 for the whole ladder". `claim_job.sql` says attempts change only in `fail_job`'

4. File: `app/tests/unit/omnikom/webhook-step.test.ts`
   - Follow-up: Invariant 7 has no control over ctx.log. The step never logs, so the check runs over an empty list. It will fail only once someone adds a log line that contains the secret. The author labels this as a stand-in in UNPROVEN; I record it so it is not lost.
   - Evidence: grep -n 'ctx.log' app/src/server/jobs/steps/webhook-omnikom.ts finds no matches; the test's `logs` array stays empty
