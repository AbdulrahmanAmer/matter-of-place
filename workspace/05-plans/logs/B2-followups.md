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

## g1 · steps 1b

None of these blocks the group. No reviewer follow-up of this group concerns `GOTCHAS.md`, so none became a bank entry.

1. File `app/scripts/db-reset-dev.mjs`. Several of the script's own refusals have no test, so deleting them stays green: the phase-1 branch check (lines 110-113), the --accept-foreign gate (lines 129-132), and the rule that --local skips the ref/branch/foreign checks and the lock. Only isLocalDbUrl, checkResetTarget, findForeignMigrations and the presence of assertNotProduction are tested. The plan's step 1b proof does not ask for these, so this is a follow-up. It should be closed when B4's db job exercises reset, or by exporting a testable resetLinked/main the way db-push.mjs exports pushMigrations.
   Evidence: Read: no file in tests/unit imports db-reset-dev.mjs except the textual guardedScripts check (grep the registry: no entry mutates the branch or accept-foreign lines). Suspected by reading, not run as a mutation.

2. File `app/scripts/db-reset-dev.mjs`. --local empties whatever database DEV_DB_URL names on 127.0.0.1 (lines 75-83). It then runs 'supabase db push --local', which targets the stack port in supabase/config.toml (54322). If DEV_DB_URL points at another 127.0.0.1 database, such as the laptop's native PostgreSQL 18 used for throwaway tests, the wrong database is emptied and the push goes elsewhere or fails. This follows the plan's literal 'bunx supabase db push --local'. A follow-up for the plan or B4: check the DEV_DB_URL port against config.toml, or push with --db-url "$DEV_DB_URL".
   Evidence: Suspected by reading lines 75-83 and 149-153; not run (no local stack on this laptop, S50).

3. File `workspace/05-plans/B2.md`. Stale plan fact: the header line 7 and ASSUMED E11 still say Supabase CLI 2.98.2, but package.json pins ^2.119.0 and bunx supabase --version prints 2.119.0. The author logged the difference (log line 22). The orchestrator should fold it into the plan and ASSUMED.
   Evidence: bunx supabase --version -> 2.119.0; grep -n '2.98.2' workspace/05-plans/B2.md -> line 7

4. File `app/scripts/load-env.mjs`. Gap in what the helper covers: the terminal refusal depends only on process.stdout.isTTY. In a terminal that hands node a pipe instead of a console (for example standalone mintty without winpty or ConPTY), a bare 'node scripts/load-env.mjs --profile dev' would print the four values. The contract holds in a real console, which I proved; this note only records the edge it does not cover.
   Evidence: Suspected by reading line 46; not reproduced (the proof console reported isTTY=true).

## g2 · steps 2

None of these blocks the group. Two reviewer follow-ups concern `GOTCHAS.md` and became bank entries P-308 and P-309, not items here.

1. File `workspace/05-plans/B4.md` (a note for B4, not this group's file). B4's CI stack now starts with the hosted auth and storage values from `config.toml`. If an e2e test asks for a magic link twice for the same address within 60 s, it can fail with a rate-limit error. Also, whether `supabase start` accepts `[storage.analytics] enabled = true` on the runner (or starts something extra) is UNPROVEN. B4 should know this before its first db/e2e run.
   Evidence: Found by reading, not run: `git show 59df9f6 -- app/supabase/config.toml` changes max_frequency from "1s" to "1m0s" and [storage.analytics] enabled from false to true. B4.md line 103 has e2e running the same `supabase start`.

2. File `workspace/05-plans/B2.md`. Plan text is now stale, and folding it is the orchestrator's job. Step 2 (line 162) and the operator note (line 6) still say CLI 2.98.2 and 'no --dry-run for config push' (F20); `config diff` in 2.119.0 does that job. Step 2 also says to load the token through `load-env.mjs --profile ops`, but .env.ops does not exist. The Files line for config.toml (line 86) lists only the pinned keys. It does not record the deviation this group logged: the non-pinned keys now take the live mop-dev values (OTP 8, max_frequency 1m0s, confirmations on, TOTP on, pooler 15/200, storage.analytics on).
   Evidence: Confirmed by running: `bunx supabase --version` prints 2.119.0. `sed -n '162p;86p' workspace/05-plans/B2.md` shows the old text.

3. File `workspace/05-plans/logs/B2.md`. The answer to step 2's UNPROVEN question was measured with no pending migrations. 'After link, db push --linked needs only the database password' is therefore an inference for a push that actually applies something. That case is first exercised at step 3 or by the deploy job. The sentence for docs/runbooks/database.md also exists only in the log and P-306 until step 14 writes the runbook. The author disclosed both.
   Evidence: Confirmed by running: with a bogus token, `bun run db:push` exits 0 with migrations [] and the control fails with 401. No local migration file exists yet (`ls app/supabase/migrations` shows only README.md).
