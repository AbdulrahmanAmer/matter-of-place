# B2 follow-ups: the orchestrator folds or assigns each before the slice closes

## c1 · steps 1

None of these blocks the group. The two reviewer items that belong in the gotcha bank are P-302 and P-303 in `GOTCHAS.md`, not here.

1. File `workspace/05-plans/logs/B2.md`. The g1 block says assert-not-production.mjs refuses (fails closed) on "every other error, a missing schema included". That is false. Postgres returns 42P01 for a qualified name in a missing schema, so a missing schema reads as not production. The code is right and matches invariant 23 ("a missing schema, table or row reads as not production"). Only the log sentence is wrong. Not blocking: no input makes the product go wrong, because the code follows the plan. Fix by appending a correction line to the log.
   Evidence: `bun run db:psql -- -c "\set VERBOSITY verbose" -c "select 1 from nosuchschema_x.settings"` -> `ERROR:  42P01: relation "nosuchschema_x.settings" does not exist`. `UNDEFINED_TABLE = "42P01"` in `app/scripts/lib/assert-not-production.mjs`.

2. File `app/scripts/db-reset-dev.mjs`. Suspected from reading, not run. The bare `bun x supabase db push --linked` (STUB B2 step 1b) does not pass `--yes`, and its stdio is inherited. In an interactive terminal the CLI can ask for confirmation after the schema has already been dropped and committed. Answering no leaves mop-dev empty until someone reruns. Step 1b's `db-push.mjs` replaces this line, so it is a note for 1b.
   Evidence: `bunx supabase db push --help` lists `--yes  answer yes to all prompts`. `db-reset-dev.mjs` line 80: `spawnSync(process.execPath, ["x", "supabase", "db", "push", "--linked"], { stdio: "inherit" })`, after `client.query("commit")` of the drop schema.

3. File `app/tests/unit/assert-not-production.test.ts`. STANDARDS R53/C10 asks that a test title name each Contract invariant it touches. No title here names invariant 23; only a code comment does (other tests such as `boundaries.test.ts` put the rule id in the describe). Separately, the `guardedScripts` check is textual: it passes when `assertNotProduction(` appears anywhere, including in a comment or after the destructive statements. The plan defines the check this way, so this is a known limit and not a contract break.
   Evidence: titles `throws when settings.environment is production` and `every listed file exists, imports the guard and calls assertNotProduction(`. `git grep` shows R-ids in titles in `tests/unit/boundaries.test.ts`.

4. File `.github/workflows/ci.yml` (PR 49). UNPROVEN: CI has not run on PR 49. The PR is CONFLICTING on GitHub (bank appends on both sides), so no `pull_request` workflow starts. All local CI-equivalent steps pass (frozen install, migrations:check, check, build). The fix is the orchestrator's merge of main into the lane; the group's brief forbids merging.
   Evidence: `gh pr checks 49` -> `no checks reported on the slice/b2 branch`; `gh pr view 49` -> `{"isDraft":true,"mergeStateStatus":"DIRTY","mergeable":"CONFLICTING"}`.

5. File `app/supabase/config.toml`. The diff carries two em dashes. Both are in the comments that `supabase init` wrote (the edge_runtime policy lines), not in our copy. Recorded so the orchestrator can decide; this is vendor text, not brand copy.
   Evidence: `git diff origin/main...slice/b2 | grep '^+' | grep '—'` -> `# `per_worker` (default) — enables hot reload...` and `# `oneshot` — fallback mode...`.

6. File `app/scripts/README.md`. Stale prose from before this group, not this group's file. It still says variants are made "for R2" (ruling H33: no R2) and that every script runs as `bun run scripts/<name>.ts`, while this group adds plan-frozen .mjs scripts (db-reset-dev, psql-dev). The orchestrator should fold it, or B2 step 12 when the variants script lands.
   Evidence: `cat app/scripts/README.md` -> `image variants for R2 (thumb, card, hero, og, carousel...)`; `Each script runs with `bun run scripts/<name>.ts``.
