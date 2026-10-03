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

## g3 · steps 3

None of these blocks the group. No reviewer follow-up of this group concerns `GOTCHAS.md`, so none became a bank entry.

1. File `app/supabase/migrations/20261001090100_people_audit.sql`. audit_log can be emptied with TRUNCATE by the service role. audit_log_immutable is a row-level 'before update or delete' trigger, and TRUNCATE fires no row triggers. Line 'grant all on table public.user_roles, public.agent_keys, public.audit_log, public.pii_columns to service_role' includes TRUNCATE. Invariant 3 says 'append-only and kept forever'. The plan only spells out update and delete, and PostgREST cannot issue TRUNCATE, so this is a follow-up: add a 'before truncate' statement trigger or grant service_role only select and insert (in migration 10 or a later migration) and add a matching integrity case.
   Evidence: Confirmed by running: `bun run db:psql -- -Atc "begin; set local role service_role; truncate public.audit_log; select 'truncated as ' || current_user; rollback;"` printed 'TRUNCATE TABLE / truncated as service_role / ROLLBACK'. role_table_grants lists service_role|TRUNCATE on audit_log.

2. File `app/tests/db/migration-headers.test.ts`. The header check accepts '-- down:' or '-- irreversible:' anywhere in the first 30 lines (HEADER_LINES = 30, .slice(0, HEADER_LINES).some(...)). The lock check only looks at the first line that is not a comment. So a file whose line 1 is "set lock_timeout = '5s';" and whose line 2 is '-- down: ...' passes both tests, although R16 and invariant 14 say a file opens with the header and that set lock_timeout comes after it. The header is still present in that case, so nothing breaks; this is a weaker check than the rule.
   Evidence: Suspected from reading the test, not run (I had no file I could mutate). The check passes on a file that has a header somewhere and a lock_timeout statement first.

3. File `app/tests/db/migration-headers.test.ts`. Note for B4. G12 runs only inside the db project, whose global setup needs a live DEV_DB_URL and calls assertNotProduction. bun run check (unit project only) never runs it, and CI runs it nowhere until B4's db job exists. When it does run, the file calls 'git ls-tree origin/main' at import, so a CI checkout without origin/main (a shallow checkout or one with only the PR ref) fails the whole file at import.
   Evidence: package.json "test": "vitest run --project unit"; vitest.config.ts puts tests/db/**/*.test.ts in the db project with globalSetup tests/db/global-setup.ts; test line 'execFileSync("git", ["ls-tree", "--name-only", "origin/main", ...])' runs at module scope.

4. File `workspace/05-plans/B2.md`. The plan text no longer matches the code. Data changes items 1 and 2 and invariant 1 say RLS and the anon, authenticated and service_role grants for migration_checksums, user_roles, agent_keys, audit_log and pii_columns come from migration 10. Migrations 1 and 2 now enable RLS and set these grants themselves, and G-100 makes that the rule. The author gives the reason in the log: db:reset drops the default privileges. The orchestrator should fold this into B2.md and the migration 10 description, so step 9 does not treat the grants as missing or duplicated.
   Evidence: 20261001090000_extensions_enums.sql: 'revoke all on table public.migration_checksums from anon, authenticated; grant all ... to service_role'. The log of g3 says 'The plan places both in migration 10.'

## g4 · steps 4

None of these blocks the group. The sixth reviewer follow-up concerns `GOTCHAS.md` and became bank entry P-313, not an item here.

1. File `app/tests/db/integrity.db.test.ts`. The hero_image case (line 145) never puts a staged photograph ahead of a rendered one. So a trigger that skips staged rows, and makes a later rendered photograph the hero while the first is still staged, passes. G66's central rule, 'null while that photograph is still staged', is proven only for a property whose only row is staged. The plan's case that would catch it (a published property plus a staged-first update raising publish_incomplete) is the one the author honestly reported NOT DONE because it needs migration 8. A draft-level case is possible today: a rendered row at sort_order 1 and a staged row at sort_order 0 should give hero_image null. Not blocking: the shipped trigger is correct, and step 7's group is due to add the covering case. Make sure it does.
   Evidence: Confirmed by running: MOP_MUTATION_SQL = migration 4 + sync_property_hero_image.sql with 'where m.property_id = v_property_id and m.media_key is not null' -> bunx vitest run --project db tests/db/integrity.db.test.ts -t hero_image -> exit=0, 'Tests  1 passed | 17 skipped (18)'.

2. File `app/supabase/sql/functions/sync_property_hero_image.sql`. hero_image is a value derived from several rows (the first property_media row of a property). The trigger reads property_media without first locking the properties row (line 23 select, then update). Two concurrent transactions that change media of one property can each compute the hero from a stale snapshot, and the last committer can write a key that is not the first photograph. Example: T1 deletes A while T2 moves B behind C. STANDARDS C11 asks every multi-row invariant to name the lock that serialises it. The plan's own single-statement form has the same exposure, and R22 makes B7 and B9 take the property row 'for update' first. So this is a note for B7's attach_media/replace_media/reorder and B9's apply_media_variants to take that lock, not a defect of this step. Suspected by reading, not run: a two-connection race cannot be staged until the migration is committed somewhere.
   Evidence: Reading: sync_property_hero_image.sql lines 19-28 select first, then 'update public.properties ... where ... hero_image is distinct from v_key', with no 'select ... for update' on public.properties first.

3. File `app/supabase/migrations/20261001090300_catalog.sql`. The comment at lines 10-11 says 'Every table has created_at and updated_at with its <table>_set_updated_at trigger, except slug_history'. settings and retention_policies have no created_at (lines for both tables, and the manifest agrees). The author's log states this correctly, so only the comment is wrong (C07). It cannot be edited after merge (R16), so fix it before merge or leave it.
   Evidence: grep -n 'except slug_history' supabase/migrations/20261001090300_catalog.sql -> 11; schema-manifest.ts settings and retention_policies entries have updated_at and no created_at.

4. File `app/tests/db/schema-manifest.ts`. Line 239 documents moneyColumns as 'each numeric(12,2) with a currency check (STANDARDS R24)', but the shape case 'every money column is numeric(12,2)' checks only the type. Nothing asserts the currency check. properties does carry check (currency = 'USD'), so nothing is wrong today. The doc claims more than the test proves.
   Evidence: schema.db.test.ts 'every money column is numeric(12,2) (R24)' compares only format('%s(%s,%s)', data_type, numeric_precision, numeric_scale).

5. File `app/tests/mutations/B2.json`. Entry ccc deletes representatives.email, where the plan's Verification (ccc) says inquiries.email. The swap is sensible because inquiries arrives in migration 5, and it is disclosed. The plan's text and the registry now disagree until step 5's group switches it or the orchestrator folds the plan line.
   Evidence: B2.json entry id 'ccc' sql: delete from public.pii_columns where table_name = 'representatives' and column_name = 'email'. Replayed: red, naming '"representatives.email"'.

## g5 · steps 5-6

None of these blocks the group. The seventh reviewer follow-up concerns `GOTCHAS.md`: it is the cost banked as P-313, which now carries a "hit again" line, and the template fix it asks for (the reviewer brief must print `eval "$(node scripts/load-env.mjs --profile dev)"` plus `env -u CLOUDFLARE_API_TOKEN`) stays the orchestrator's.

1. File `app/tests/db/analytics.db.test.ts`. Three cases only pass on a database where migration 6 ran during the current calendar month. 'lists the current month, the next two and the default partition' compares for exact equality, the idempotency case expects count: 5, and the drop case runs `create table` for the -1 month partition without checking whether it exists. On mop-dev after main pushes migration 6, all three go red from the first day of the next month, with no code change. Partitions from earlier months stay (they are kept 3 months), and the -1 partition already exists. CI's fresh stack is not affected, so this is a false red on the laptop path. It becomes moot once the H35 launch switch makes database tests refuse on mop-dev. Fix: assert that the list includes current, +1, +2 and the default partition, and create test partitions only when missing (or use months older than any real one). This also falls under T-08 (timestamps relative to now).
   Evidence: Confirmed by running. Prelude plus a pre-created previous-month partition: `node node_modules/vitest/vitest.mjs run --project db tests/db/analytics.db.test.ts` gave Tests 3 failed | 4 passed (7), error: relation "analytics_events_y2026m09" already exists

2. File `app/supabase/migrations/20261001090500_analytics_partitions.sql`. Retention leak, a plan gap for B8 and not this step's contract. A row whose occurred_at falls in a month earlier than the current one, with no partition for that month, waits in analytics_events_default forever. Example: an event stamped 2026-09-30 23:59 UTC received after migration 6 created only Oct to Dec, or a late event for a month B8 already dropped. ensure_analytics_partitions (lines 38-69) only creates the current month and later ones, and drop_old_analytics_partitions (lines 85-96) only drops monthly partitions, so nothing ever removes such rows. That breaks invariant 9's 'at most about 120 days' for those rows. B8's retention job should also delete default-partition rows older than its cutoff, or ensure should handle past months.
   Evidence: Suspected by reading: the loop is `for i in 0..months_ahead` from date_trunc('month', now()), and the drop filter is `c.relname ~ '^analytics_events_y[0-9]{4}m[0-9]{2}$'`, which excludes analytics_events_default

3. File `app/src/components/forms/submit/state.ts`. Known, disclosed regression that the plan mandates. submissionSchema now requires submitterKind and submitterName, while toSubmission (state.ts:133-152) still sends agentName, agentEmail and agentPhone. So every submit through the wizard now throws ZodError until B3 step 5 renames the fields. The file is B3's and there is no deploy workflow on main (only .github/workflows/ci.yml), so this is not blocking here. The orchestrator must make sure B2 does not reach a deployed build ahead of B3 step 5.
   Evidence: Confirmed by reading: `grep -n agentName src/components/forms/submit/state.ts` gives lines 34, 75, 118 and 152, and wizard.tsx:35 calls toSubmission inside useAsyncAction

4. File `workspace/05-plans/logs/B2.md`. The g5 proof transcript (lines 1446-1473) shows each db command as `$ bunx vitest run ...`. Per P-314 and line 1422 of the same log, those runs used `node node_modules/vitest/vitest.mjs`, because bunx crashes or prints nothing with this prelude. Line 1422 discloses this, but the pasted command lines are not what ran. Anyone who replays them literally gets a segfault or empty output.
   Evidence: Confirmed by reading: log lines 1422 and 1446-1473, and the P-314 symptom text

5. File `workspace/05-plans/B2.md`. Step 5's proof `grep -rn "...agent_name\|agent_email\|agent_phone" src/domain supabase/migrations` cannot pass on a correct tree. It matches listing_agent_name, a column that the same step and invariant 22 require. This is the orchestrator's to fold: replace it with the anchored grep banked in P-315.
   Evidence: Confirmed by running: the plan's literal grep prints 3 listing_agent_name lines (exit 0); the anchored form prints nothing (exit 1)

6. File `app/src/domain/contracts.ts`. submitterKindLabels (lines 84-87) is exported with @public and has no consumer in the tree yet (B3 and B7 will use it), but it carries no STUB marker. STANDARDS C04 says a later-slice export has @public and a STUB marker. Same pattern as slugPattern from g4.
   Evidence: Confirmed by running: `grep -n STUB src/domain/contracts.ts` gives only lines 100 and 120 (both older); bun run check lists 15 STUB markers, none for submitterKindLabels

## g6 · steps 7

None of these blocks the group. Two reviewer follow-ups concern `GOTCHAS.md` and became bank entries P-318 and P-319, not items here. Six remain.

1. File `app/tests/db/integrity.db.test.ts`. No test checks that save_property writes what it accepts. The allowed-key case ("on a draft a patch of each allowed key with a valid value passes") and the conflict case only check that the call returns ok or the new version. If a column's `x = v_new.x` line is missing from the UPDATE in save_property (for example, a key added to v_allowed but not to the SET list), the editor's change is silently dropped while the version still goes up, and every test stays green. The plan only asks for 'passes', so this is a follow-up. Today's code is correct: the reviewer checked by reading that the 30 SET columns equal v_allowed and savePropertyAllowedKeys.
   Evidence: Confirmed by running. save_property re-created without `title = v_new.title,` (patch-applied check passed), then `node node_modules/vitest/vitest.mjs run --project db tests/db/integrity.db.test.ts -t save_property` with the committed prelude gave `Tests  4 passed | 47 skipped (51)`, exit=0. Suggested fix: in the allowed-key loop, read the column back and compare it with the value sent.

2. File `workspace/05-plans/logs/B2.md`. The g6 log says `node scripts/check-migrations.mjs` gave `migration-order: OK (3 on main, 3 added)`. The script reads `git diff origin/main...HEAD`, so commits only, which means that run was taken before migrations 7 and 8 were committed and did not check them. On the shipped tree it passes and covers all five.
   Evidence: `cd app && node scripts/check-migrations.mjs` gives `migration-order: OK (3 on main, 5 added)`, exit=0. See scripts/check-migrations.mjs lines 389-392 (diff origin/main...HEAD with --diff-filter=A).

3. File `workspace/03-diagrams/plans-b.md`. workflow.ts and the B2 Files line say the submission graph is diagram 1. Diagram 1 has no Withdrawn state and no Published to Completed edge (DL-04, DL-09). The code follows the plan text, so the diagram is stale. It is the orchestrator's file, and the PNG and SVG need re-rendering.
   Evidence: `grep -n -- '-->' workspace/03-diagrams/plans-b.md` lines 14-32: no Withdrawn and no 'Published --> Completed'.

4. File `workspace/05-plans/B2.md`. The plan contradicts itself (plan text only). Step 4's hero_image proof asks for publish_incomplete 'naming hero_image', but invariant 20 says a raised message is exactly the errorCodes key. The g6 test asserts the message `publish_incomplete` and that the error context names enforce_publish_gate, not hero_image. One of the two lines should change, for example to put the column in a DETAIL.
   Evidence: Plan step 4 (Data changes, `-t hero_image` sentence) against invariant 20. Test 'a staged photograph put first on a published property raises publish_incomplete' in integrity.db.test.ts expects {message: 'publish_incomplete', fromGate: true}.

5. File `app/tests/mutations/B2.json`. Registry entry `tt` mutates refuse_hard_delete, but Verification (tt) names bump_catalog_version. The author disclosed this: that function arrives with step 8. Step 8's group should switch the entry back to the plan's text.
   Evidence: In the registry, the `tt` sql re-creates public.refuse_hard_delete. The reviewer did not replay it; the author's replay shows `RED tt | +     "refuse_hard_delete",`.

6. File `app/tests/db/function-source.db.test.ts`. Not this group's file. The test compares only the $$ body with pg_proc.prosrc. A migration whose header differs from the function file (security definer, search_path, signature, language) would pass, although invariant 19 says the 'same text'. For g6 the reviewer closed this gap by hand: the nine files equal the migration statements byte for byte.
   Evidence: DOLLAR_BODY regex in function-source.db.test.ts line 7; the reviewer's fncmp.mjs gives SAME for all nine files.

## g8 · steps 8

None of these blocks the group. Two reviewer follow-ups concern `GOTCHAS.md` and became bank entries P-324 and P-325, not items here. Five remain.

1. File `app/supabase/migrations/20261003082557_fn_enforce_publish_gate_stories.sql`. The db:fn timestamp, 2026-10-03, is later than every migration the plan still has to add under fixed names: B2's own migrations 10 to 12 (20261001090900_rls.sql, 20261001091000_storage.sql, 20261001091100_settings_defaults.sql), B3's 20261001100000_public_write_functions.sql and 20261001110000_coming_soon.sql. Once this group merges, migration-order refuses each of those names and db-push refuses them as out-of-order, so B2 g9 cannot land 20261001090900_rls.sql under the name in its Files list. Invariant 17 does allow renaming, so nothing is broken yet. But the plan's Files list, the 'numbered 1 to 12' text and the '12 migrations' exit line all go stale. The log and the bank do not mention it. The other option was to put the fix inside migration 9, which is unmerged, but that conflicts with R19's db:fn path. The orchestrator should decide which and update the plan before g9 starts. (The bank side is P-324.)
   Evidence: I simulated the post-merge state with checkMigrations({mainPrefixes: [..., '20261003082557'], added: ['supabase/migrations/20261001090900_rls.sql', ...]}). It returned 'rename supabase/migrations/20261001090900_rls.sql to a timestamp after 20261003082557' and the same for 091100_settings_defaults. `grep -rhoE "2026100[0-9]{7}_[a-z_]+\.sql" workspace/05-plans/*.md` lists the five planned names that are older than 20261003082557.

2. File `workspace/05-plans/logs/B2.md`. Proof 4 cannot be re-run from the repository. `MOP_PRELUDE=... node ../scratch/g8-replay.mjs` names a scratch script that is not in the tree, and the MOP_PRELUDE variable appears nowhere in the repo. P-321's proof (`node <replay> g8-slug-rename`) depends on the same missing script. I reproduced the replay with my own script (prelude plus entry sql in MOP_MUTATION_SQL, 49 entries, all red), so the claim holds, but the command as written cannot be run. scripts/watchfail.mjs has no prelude option, so this will keep happening for every unmerged migration until CI's db job exists.
   Evidence: `ls E:/mop-build/db-review/scratch` gave 'No such file or directory'. `grep -rn MOP_PRELUDE scripts tests/fixtures` found nothing.

3. File `app/tests/mutations/B2.json`. Entry e-meta (the plan's (e), second half: 'the meta case bumps') goes red from recursion ('stack depth limit exceeded'), not because meta bumps. With the WHEN clause removed, every bump recurses, so the meta exclusion is not the thing that fails here. The exclusion is still covered in effect: g8-admin-invoice and g8-admin-caption_model add a key to the list and go red with insert:1, update:1 in the same parametrised case. Separately, the plan's (tt) names bump_catalog_version, but the registered tt still mutates refuse_hard_delete from an earlier group.
   Evidence: Replay line: 'RED e-meta exit=1 | error: stack depth limit exceeded'. The e-meta sql is the same trigger recreation as e, without a WHEN clause.

4. File `app/tests/db/catalog-version.db.test.ts`. No test fails if these migration 9 triggers are removed: the stories triggers (insert, update and delete of a published story), the regions, market_notes, market_guide_entries, property_media, property_features, property_related and representatives statement triggers, and the properties insert and delete triggers. Step 8's proof list does not ask for these cases, so this is a coverage gap, not a contract break. A dropped stories trigger would leave a story publish uncached until the next unrelated bump.
   Evidence: Reading only: no case in catalog-version.db.test.ts or public-reads.db.test.ts measures catalog_version across a stories, regions, market_notes, market_guide_entries, property_features, property_related or representatives write.

5. File `app/supabase/migrations/20261001090800_catalog_version.sql`. The slug_history trigger is `for each row`, which the log explains (P-321). A statement that touches several slug_history rows, for example the cascade when a property is deleted under retention, bumps once per row. The plan's Data changes item 9 says 'one bump per statement'. The only effect is extra cache invalidations, but that plan line is now stale.
   Evidence: Reading only: 'create trigger slug_history_bump_catalog_version after insert or update or delete on public.slug_history for each row'.

## g9 · steps 9

None of these blocks the group. The two reviewer items that belong in the gotcha bank are "Hit again" sentences in P-312 and P-325 in `GOTCHAS.md`, not here.

1. File `workspace/05-plans/STANDARDS.md`. R20 names tests/db/rls.db.test.ts as the enforcer of 'every function sets search_path = ''', but no test asserts it. Step 9's proof list does not ask for it, so this is a coverage gap for H1 step 3 or the orchestrator, not a g9 break.
   Evidence: Grep of app/tests for search_path or proconfig finds only registry sql text, no assertion. Today all 22 files in app/supabase/sql/functions contain search_path = '' (a loop over the files printed no offender).

2. File `app/tests/db/rls.db.test.ts`. The anon and authenticated privilege assertions cover relkind 'r' and 'p' only. Views, materialized views and sequences are not checked, while R20 says 'anon holds no privilege'. A later `grant select on <view> to anon` (B3b adds market_interest_counts) would pass.
   Evidence: Read lines 214-244: `where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')`. There is no has_sequence_privilege check. The plan's step 9 text says 'every table', so this is not a contract break.

3. File `app/supabase/migrations/README.md`. The README says 'Row-level-security policies ship in the same migration as the table they protect'. Migration 10 ships every policy for the tables of migrations 1 to 8, as B2's plan designs. The doc needs a carve-out for B2's migration 10.
   Evidence: README.md line 3. 20261001090900_rls.sql lines 74-172 create policies on tables created in 20261001090100..090700.

4. File `workspace/05-plans/B2.md`. Data changes 10 prescribes `alter default privileges for role postgres in schema public revoke all on tables, sequences, functions from anon, authenticated`, which is not valid SQL (one object type per statement). The author split it correctly and noted it in the log, but the plan line is stale and not banked as a plan-vs-reality mismatch.
   Evidence: Brief line for Data changes 10, compared with 20261001090900_rls.sql lines 18-20 and 26-28. Log B2.md g9: 'The plan's comma lists ... are not valid SQL'.

5. File `app/tests/db/uploads.db.test.ts`. The `// STUB(B2 step 10)` copy of uploadLimits sits under tests/, which the stubs gate does not scan. Only the slice log and P-074 remind step 10 to swap in the import from src/domain/contracts.ts. If step 10 forgets, invariant 13's four-place comparison silently compares against a local copy.
   Evidence: `git grep 'STUB(B2 step 10'` finds uploads.db.test.ts:8 and log/GOTCHAS text only. src/domain/contracts.ts has no uploadLimits yet. B2.md line 132 assigns it to step 10.

6. File `app/supabase/migrations/20261001090900_rls.sql`. g8 follow-up 1 (P-324) is still undecided. 20261001090900 and 20261001091000 sort before the unmerged 20261003082557 fn migration. migration-order passes only because the whole slice lands as one PR against a main whose tip is 20261001090700. The decision still owed before migration 12 and B3's fixed names is the orchestrator's.
   Evidence: `node scripts/check-migrations.mjs` -> 'migration-order: OK (8 on main, 4 added)'. workspace/05-plans/logs/B2-followups.md g8 item 1.

7. File `app/tests/db/rls.db.test.ts`. UNPROVEN, as the author says: the policies under PostgREST with a real JWT, and migrations 10 and 11 on B4's fresh CI stack. My simulation reduces the risk but does not replace CI: Supabase-like default privileges re-added before the prelude gave 14/14 green, and new objects failed closed. Next check: once merged and pushed from main, call PostgREST on mop-dev with the anon key (GET /rest/v1/markets, POST /rest/v1/rpc/save_property) and with a non-staff user JWT, and confirm 401/42501 or empty arrays.
   Evidence: x-fresh-stack replay: 'exit=0 | Tests 14 passed (14)'. control-pre-applies: '2 failed' (x_pre detected). The probe uses set local role plus request.jwt.claims (rls.db.test.ts lines 110-113), not HTTP.
