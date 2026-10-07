# Merge chores

Non-blocking defects and follow-ups that reviewers handed the orchestrator while a lane was live. Each is folded by
the orchestrator when that lane's branch reaches `main`, never pushed onto a running lane (P-2124 shape). A line is
struck through, with the PR number, when it lands. The lane runner never works this list.

## B10 (slice/b10, Dell)
- GOTCHAS.md P-2200 symptom sentence: `get_vault_secret` is not a missing generated type (in `src/db/types.ts` since B8); only `store_channel_token`, `put_channel_ids`, `record_channel_check`, `social_posts` are. (g1 review a860dafb)
- `src/domain/channels.ts` still carries the plan placeholder Graph version `v23.0`. (g2 review ad17643a)
- `tests/unit/reels-limits.test.ts` copies the REEL constants instead of reading `render-reel.mjs` exports; a B12 reel change would not turn it red. (g2)

## B7 (slice/b7, Dell)
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
- tech-stack.md 324 and B11.md 63 channel pattern: ~~named exports, not a `{ publish, metrics }` adapter~~ (PR 187).

## B17 (slice/b17, this laptop)
- Review brief says "No CI run exists for this commit" when a descendant commit's preview run on the lane's PR exists; `build-slice.js` should point the reviewer at `gh run list --workflow deploy.yml --branch <slice>` for descendants whose diff leaves `app/` and `.github` untouched. (g10 review a63987521141769f5)
- `deploy.yml` `E2E_MODE: live` on the essentials and B4 overflow steps fails every preview once `HAS_DB` is false after the launch switch; `${{ env.HAS_DB == 'true' && 'live' || 'local' }}` on both.
- `app/scripts/observatory.mjs` policy check fails open on a non-OK HEAD; the `!scan.ok` guard branch has no test of its own; C22 cost line for the two new preview steps.

## B13 (slice/b13, Dell)
- Review brief's vitest shorthand is not reproducible in a plain shell (db global-setup refuses without `DEV_DB_URL`); brief should give the dev-profile form. (c7b review a188e66b)
