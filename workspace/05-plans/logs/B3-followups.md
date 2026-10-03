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
