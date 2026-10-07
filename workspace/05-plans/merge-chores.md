# Merge chores

Non-blocking defects and follow-ups that reviewers handed the orchestrator while a lane was live. Each is folded by
the orchestrator when that lane's branch reaches `main`, never pushed onto a running lane (P-2124 shape). A line is
struck through, with the PR number, when it lands. The lane runner never works this list.

## B10 (slice/b10, Dell)
- STANDARDS R34 still says "exported error table" while knip refuses the unused export (P-2204). (g3 review ac85eb06)
- `classifyGraphError` returns class `retry_at` with no time: codes 9/2207042 and 4/17/32/613 retry on B8's backoff and the next window, not Meta's reset time (steps 5-6).
- enable-guard reads `new_channels` through the public-state memo with no reset: facebook answers `channel_locked` up to 15 s after the flag flips.
- `mayApprove` in `assets/service.ts` waits for B9's `service.ts` on main; META_METRICS and the Graph classifications are from docs, not a live answer (step 7).
- Bank rule to write: a scratch registry for a replay lives in its own folder per group and run (a shared scratchpad held another reviewer's B10.json; watchfail replayed 69 entries instead of 45).
- GOTCHAS.md P-2200 symptom sentence: `get_vault_secret` is not a missing generated type (in `src/db/types.ts` since B8); only `store_channel_token`, `put_channel_ids`, `record_channel_check`, `social_posts` are. (g1 review a860dafb)
- `src/domain/channels.ts` still carries the plan placeholder Graph version `v23.0`. (g2 review ad17643a)
- `tests/unit/reels-limits.test.ts` copies the REEL constants instead of reading `render-reel.mjs` exports; a B12 reel change would not turn it red. (g2)

## B7 (slice/b7, Dell)
- Public bundle: the largest public route is 137 gzip bytes under 153,600 after step 5 and every admin route file adds to the entry; see ruling H66 before step 6. (g1 review2 a0757fcf)
- `RequestDetail.tsx` errors and toasts show the message without the request id (C17).
- `originalUrl` turns every `createSignedUrl` error into 503 `storage_unavailable`; a never-uploaded object should be a 404-class answer.
- `window.open` in a mutation's `onSuccess` is outside the click's user activation; Safari may block the tab.
- No test of the notFound path or the history panel's loading, empty and error states; `getSubmission` against a real row unproven.
- Bank bookkeeping: costTime item 3 cites P-2131 where P-801 fits; the standing rule's loader makes every db vitest refuse on ops variables unless the dev profile is loaded; G-902 takes the bank to 43 G headings against the cap of 40 and `check-gotchas` does not enforce the cap.
- G-902 rule rewritten: a db test that uses `serviceClient()` keeps `SUPABASE_URL` under `E2E_STACK=1`; `fixtures/worker-env` is for Worker-side tests only (it deletes `SUPABASE_URL`). (g1 review ad972fe0)
- `src/server/headers.ts` CSP `img-src` is `'self' data:` only; signed Supabase thumbnails on screen 4 are blocked once the policy is enforced (add the Supabase origin as `connect-src` does).
- Timeline rows show "Team member/Agent/System" instead of actor names; the Part 2 exit after step 16 wants names.
- Registry `b7-g5-db-payments-read` breaks a column name; nothing checks the void status filter.
- Sizing puts the timeline reader at `src/server/submissions/timeline.ts`; plan (B7.md:94) and build say `src/server/lib/timeline.ts`. Plan says mop-designer owns screen 4 once; sizing has `designer:false`, no designer approval logged.

## B6 (slice/b6, Dell)
- Plan watched-fail (u) (parallel numbering cleanup must fail loudly) not done and not in `B6.json`. (g1 review a68926a9)
- `payment_tier` parity case checks a hand-typed table; `src/domain/payments.ts` comes with step 2, re-point then.
- `b6-g1-ag-fixed-now` does not do what the plan's (ag) describes; the change is unlogged.
- Invoicing migration adds `payments_product_chosen` check and one insert the plan did not ask for (C01): rule or remove.
- On the native cluster `b6-g1-documents-private` reports WATCHED-FAIL OK while red for the wrong reason (`storage.buckets` missing).
- `gotchasAdded` undercounts the branch's entries.

## B11 (slice/b11, Dell)
- `variables.ts` ~525 `digestAlert`: removing `.eq("event_id", job.eventId)` turns nothing red; the digest-notify fixture holds one queue_digest job, so the filter is never exercised (registry entry BAD as a follow-up). (g2 review a313c3a1)
- `assemble.ts` 286 and `readIssues` 155 apply the 300-character deck/title caps on read as well as write (suspected from reading).
- A digest.due recipe using send_email with the admin_notify template fails `NonRetryableError event_id_missing`: `send-email.ts:342` calls `resolveVariables` without the seventh job argument (author-disclosed).
- `mergeDraft` human-edit detection (lines 138-145) needs care when step 4's `queue_digest_add` replaces blocks.
- tech-stack.md 324 and B11.md 63 channel pattern: ~~named exports, not a `{ publish, metrics }` adapter~~ (PR 187).

## B17 (slice/b17, this laptop)
- Review brief says "No CI run exists for this commit" when a descendant commit's preview run on the lane's PR exists; `build-slice.js` should point the reviewer at `gh run list --workflow deploy.yml --branch <slice>` for descendants whose diff leaves `app/` and `.github` untouched. (g10 review a63987521141769f5)
- `deploy.yml` `E2E_MODE: live` on the essentials and B4 overflow steps fails every preview once `HAS_DB` is false after the launch switch; `${{ env.HAS_DB == 'true' && 'live' || 'local' }}` on both.
- `app/scripts/observatory.mjs` policy check fails open on a non-OK HEAD; the `!scan.ok` guard branch has no test of its own; C22 cost line for the two new preview steps.

## B13 (slice/b13, Dell)
- Step 7 rework: the lazy chunk is fetched on every property view after hydration rather than on a click, so a deploy between HTML and chunk shows; the log's Proof 1 and 3 test counts do not match their commands; the focus guard goes red only under vite dev with StrictMode (CI's e2e target would not catch the earlier variant); P-1822's title still says "code only a click needs". (c7b review2 a7c4b10f)
- `perf-targets.mjs` comments claim the hard limits are error assertions in `lighthouserc.json`; they are warn in B4's file (12 warn lines, exit 0; lhci LCP 2,604 to 4,388 ms on six preview URLs), so step 8's "lhci exits 0 with invariant 12 met" did not hold as written. (g1 review aa5d0423)
- `HERO_VARIANT` matches only `/media/v/.../hero.webp`; the preview property page serves the master `/media/o/...` through the mapper fallback (`mappers.ts:283`), so no real run has weighed a hero.
- Untested branches of `check-seo.ts`: robots bypass header on non-indexable hosts, llms content type, og:title; one `AbortSignal.timeout(15000)` at line 174 is shared by the whole crawl, not per request.
- The seo steps' Actions cost is unstated (C22; measured about 3 s); `sizing/B13.json` names `seo.md` and `lighthouserc.json` where the plan says `search.md` and never touches lighthouserc.
- Step 7 (c7b fix): plain `lazy` has no reload on a chunk import failure after a deploy (reviewer's note).
- Flip `check-seo` from the H64 allowlist to hard once B16 and B17 are on main (privacy, terms, accessibility, cookies pages; fonts.googleapis gone from `__root.tsx`; og:image on /place-notes). (g1 build a9266883)
- `lhci:local` waits for B17 step 8.
- Review brief's vitest shorthand is not reproducible in a plain shell (db global-setup refuses without `DEV_DB_URL`); brief should give the dev-profile form. (c7b review a188e66b)

## Registry (main)
- `B2:p` and `B8:p` replay BAD (wrong reason) on main today; CI replays them only when their test files change. Re-anchor when those files are next touched (seen 2026-10-07 while adding B4 shells entries).
