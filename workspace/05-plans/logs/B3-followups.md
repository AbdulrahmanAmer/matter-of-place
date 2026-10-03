# B3 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 1,1b

1. `app/src/server/lib/db.ts` (not blocking; ranked first, for step 3b)
   - what: db.ts imports `../../db` (a folder) and `./env` with no `.ts` extension, so Deno cannot type-check any file that does `import type { Db }` from db.ts. The plan's Files line for state.ts requires exactly that import, and step 3b's G15 gate (`deno check ... scripts/deno-portable.ts`, which imports state.ts) must exit 0. As written, G15 will go red the moment state.ts lands. Invariant 19 and the eslint Deno block do not list db.ts, so no check in g1 can see it. Smallest fix: `../../db/index.ts` and `./env.ts`, or list db.ts among the Deno-checked files. Confirmed by running, not suspected.
   - evidence: A scratch probe holding only `import type { Db } from 'file:///E:/mop-build/api-review/app/src/server/lib/db.ts'`, run through deno 2.8.1 `deno check`, printed: TS2307 Cannot find module 'file:///E:/mop-build/api-review/app/src/db' (Maybe specify path to 'index.ts') at db.ts:2:31; TS2307 Cannot find module '.../src/server/lib/env' (Maybe add a '.ts' extension) at db.ts:3:21; Type checking failed, exit 1. The same probe over media-store.ts and runtime-env.ts exits 0.

2. `workspace/05-plans/trace.json` (not blocking)
   - what: Stale references in files that belong to the orchestrator, not this group. trace.json is the S53 traceability index and names 22 code files by their old route paths (src/routes/index.tsx, about.tsx, legal.tsx, $market.index.tsx, property.$slug.tsx and others). workspace/01-site-index/pages-and-wording.md still has 47 old paths (the author already flagged this one), and app/docs/architecture/frontend.md has 11. check-plans.mjs still prints OK because it does not check that the files exist, so nothing will catch this.
   - evidence: The Grep tool for `routes/(about|index|contact|...|$market)[^/ ]*.tsx` counts: trace.json 22, pages-and-wording.md 47, frontend.md 11; `node workspace/05-plans/check-plans.mjs` → OK. (Banked as P-804, which says a rename greps the whole repository.)

3. `app/src/server/lib/env.ts` (not blocking)
   - what: Suspected by reading, not run. env.ts requires RATE_LIMIT_SALT for every MOP_ENV, including local, and it parses at import, so a failure makes the whole Worker answer 500 (the log's own MOP_ENV=production proof shows this). Nothing in CI supplies the salt: `git grep RATE_LIMIT_SALT -- .github` prints nothing, and playwright's webServer reads a .dev.vars that CI never writes. Once step 3 imports env.ts into the request path, the CI e2e Worker (MOP_ENV local, which the plan says holds no GitHub secret) would likely 500 on every page. The plan makes only TURNSTILE_SECRET and SENTRY_DSN optional when local. This is a plan gap for the orchestrator or step 3, not a g1 code error.
   - evidence: env.ts:17 `RATE_LIMIT_SALT: text` (required); `git grep -n 'RATE_LIMIT_SALT|dev.vars' -- .github` prints nothing; playwright.config.ts:26 uses `--env-file "${resolve('.dev.vars')}" --var MOP_ENV:local`.

4. `workspace/05-plans/B3.md` (not blocking)
   - what: Plan text, confirmed by running: step 1b's proof `curl -s .../about | grep -c 'styles'` cannot fail, because every page already contains `rel="stylesheet"` (the fonts link, which comes from the root). The check that actually catches a missing stylesheet is `grep -ao 'assets/styles-[^"]*'`. The author reported this too, and it is the orchestrator's to fold in.
   - evidence: On the built Worker at 8829, /no-such-page and / each carry one `<link rel="stylesheet" href="/assets/styles-D8hM3mxd.css" data-precedence="default"/>` and also the fonts `rel="stylesheet"` link, so the word 'styles' matches even without the app stylesheet.

5. `workspace/05-plans/B3.md` (not blocking; the plan half of a GOTCHAS.md follow-up)
   - what: The plan's and brief's step 1 proof `node scripts/dev-vars.mjs` refuses in this machine's default shell ('refusing: ops variables in this shell CLOUDFLARE_API_TOKEN'). P-310 and bank-map line 10 name only the db tests. The rule should also cover dev-vars.mjs (`env -u CLOUDFLARE_API_TOKEN node scripts/dev-vars.mjs`), and the plan's step 1 proof line should say so. (The bank half is done: P-310 and the map now name dev-vars.mjs; the plan line is the orchestrator's.)
   - evidence: `node scripts/dev-vars.mjs` → 'Error: refusing: ops variables in this shell CLOUDFLARE_API_TOKEN', exit 1; with `env -u CLOUDFLARE_API_TOKEN -u SUPABASE_ACCESS_TOKEN` → 'wrote .dev.vars (8 keys)'.

## g2 · steps 2

1. `app/supabase/sql/functions/create_submission.sql` (migration 20261003184651_public_write_functions.sql lines 182-237) (not blocking)
   - what: Suspected by reading, not run. The 10-minute double-post check and the 30-day duplicate_of lookup both read before they insert, and no lock serialises them (STANDARDS R22 last clause, checklist C11). Two concurrent POST /submissions with the same email, address and zip, each with its own valid Turnstile token (two tabs, or a client retry while the first request is still running), both run the select before either commits. The second then blocks on the contacts upsert (unique on lower(email)), resumes once the first commits, and inserts a second submission with duplicate_of null. Not blocking: the plan itself specified the read-then-return design, and Turnstile's single-use token makes a literal double click answer 403 before the database. Fix: take pg_advisory_xact_lock(hashtext(lower(email)||':'||normalised address||':'||zip)) before the select, and add a two-connection test.
   - evidence: Lines 183-190 and 206-212 are plain selects that run before the insert at line 215. Under READ COMMITTED an earlier statement is not re-run after a lock wait. A proof would need committed writes on mop-dev, which a reviewer should not make.

2. `app/supabase/migrations/20261003184651_public_write_functions.sql` lines 80-85 (not blocking)
   - what: 'grant select, update on subject_requests to authenticated' plus the update policy lets admin and chief_editor change any column through PostgREST (email, kind, ip_hash, received_at), and status changes there without an owning function or write_audit (R21, R22). The plan prescribes exactly this, so it is a follow-up for B7 and the orchestrator: a column-level update grant or an owning function.
   - evidence: Plan Files line: 'grant select, update to authenticated for those two policies'. R22: a state column changes only through its owning function.

3. `workspace/05-plans/B3.md, B2.md, B7.md, B14.md, B16.md, trace.json (30 lines), workspace/06-architecture/architecture.md` (not blocking)
   - what: These still name supabase/migrations/20261001100000_public_write_functions.sql, but the shipped file is 20261003184651. B3's later contracts-live.test.ts line parses the old path. The P-324 'hit again' line says this went to '(B3-followups)', but B3-followups.md holds no such entry. check-plans passes because it does not check that the file exists.
   - evidence: Grep for 20261001100000 finds it in those files. Grep for 'contracts-live|20261003184651' in workspace/05-plans/logs/B3-followups.md finds nothing.

4. `app/tests/mutations/B3.json` (not blocking)
   - what: The one-hit-per-key behaviour that P-806 introduced (select distinct) has no replayable watched-fail. Its only assertion is in tests/api/ratelimit.api.test.ts, which runs over supabase-js on its own connection, so a sql mutation cannot reach it. A sql entry with a matching case in public-write.db.test.ts would make it replayable. I reproduced the claim by hand: distinct gives 3 hits, plain gives 4.
   - evidence: Rolled-back psql run of the P-806 scenario: 3 with distinct, 4 without. No registry entry mutates 'select distinct c'.

5. `app/tests/db` (rate_limit_check index use) (not blocking)
   - what: UNPROVEN, and the author says so: the explain check that rate_limit_check uses rate_limits_bucket_key_at_idx was not written. The Files list names it as a withRollback example; step 2's proof does not.
   - evidence: No explain assertion anywhere in tests/db.

6. `app/supabase/migrations/20261003184651_public_write_functions.sql` (not blocking)
   - what: UNPROVEN: the migration has never been applied from zero on CI's ephemeral stack (the db job). It is proven on mop-dev only.
   - evidence: No CI run exists for b9258e0. Proof came from migration list, function-source and the whole tests/db run against mop-dev.
