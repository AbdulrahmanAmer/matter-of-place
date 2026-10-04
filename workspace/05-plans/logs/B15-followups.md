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
