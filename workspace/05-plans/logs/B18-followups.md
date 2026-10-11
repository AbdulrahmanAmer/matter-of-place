# B18 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 1

1. `app/tests/mutations/B18.json` (not blocking)
   - what: STANDARDS R49 says a SQL mutation is a `kind: sql` entry and is never an edit of a migration. Four entries edit the migration file: b18-g1-seed-drift, b18-g1-seed-once, b18-g1-db-seed-price and b18-g1-db-replay. Plan item (g) orders seed-drift this way, B2, B8, B8b and H1 already have the same kind of entry, and P-3302 explains why the db ones must be file entries. The orchestrator needs to rule on whether R49 or the plan wins. The author raised this himself.
   - evidence: grep -c '"file": "supabase/migrations' app/tests/mutations/*.json gives B18:4, B2:5, B8:1, B8b:2, H1:1

2. `workspace/06-architecture/architecture.md` (not blocking)
   - what: Prose outside this group still says seven keys. architecture.md lines 201 and 206 (section 13, which F25 makes the reference) list the seven keys with no `products`. trace.json still has the item 'public_state (seven keys, G39)' pointing at the B2 migration. ASSUMED G39 has no note pointing to H80. These are the orchestrator's files to fold.
   - evidence: grep -n "seven keys" workspace/06-architecture/architecture.md workspace/05-plans/trace.json workspace/05-plans/ASSUMED.md

3. `workspace/05-plans/B18.md` (not blocking)
   - what: Three gaps between the plan text and the code. (1) The Files line for state.ts says `products: looseObject.nullish()`, but the code uses `z.unknown().nullish()`. The code is the better fit for the plan's own Failure line: with looseObject, a stored [] fails the whole state parse instead of costing one products_invalid line. (2) `productsReadSchema` was added, which the Files list does not name. (3) The `ProductsSetting` type the Files list names was not created. The plan should be folded to match the code.
   - evidence: git diff origin/main...slice/b18 -- app/src/server/public/state.ts app/src/domain/exposure.ts

4. `workspace/05-plans/B18.md` (not blocking)
   - what: Two step 1 proof commands are weak as written. `git diff --stat src/db/types.ts` compares the working tree with the index, so it is empty in any clean checkout and cannot fail; `git diff --stat origin/main...HEAD -- src/db/types.ts` is the real check. Separately, while the migration is unpushed, the db command with the default file parallelism can deadlock in the MOP_MUTATION_SQL prelude, which the author banked as P-3303. Also `--only a,b,c` takes one id (P-3301).
   - evidence: the three-dot form was empty here; the author's log records the 'deadlock detected' run; I ran with --no-file-parallelism, 40/40

5. `app/supabase/migrations/20261011011430_settings_products.sql` (not blocking)
   - what: UNPROVEN against the pushed schema. Every db proof, mine included, ran the migration as a rolled-back prelude on mop-dev (H57). The seed row, the six-key triggers and the eight-key public_state() on the real database are proven only once main pushes the migration and the CI db job runs.
   - evidence: migration not on mop-dev; the db run used MOP_MUTATION_SQL

## g2 · steps 2

1. `app/tests/mutations/B18.json` (not blocking)
   - what: Five g2 SQL watched-fail entries (b18-g2-no-audit, -sql-count, -before, -grant, -sql-plan-set) are file entries that temporarily edit the migration 20261011042604_fn_settings_put_products.sql. STANDARDS R49 (STANDARDS.md line 303) says a SQL mutation is a kind:"sql" entry run inside withRollback, never an edit of a migration. The deviation is deliberate and correct for this test: every db case re-creates the function from the migration file, so a sql prelude would stay green (P-3302, banked in g1, with B2 and B8b precedent). The rule text is stale, not the code. The orchestrator should amend R49 to admit P-3302's case.
   - evidence: node -e listing of B18.json shows those five ids with file supabase/migrations/20261011042604_fn_settings_put_products.sql; GOTCHAS.md P-3302 rule; all three I replayed print WATCHED-FAIL OK

2. `workspace/05-plans/B18.md` (not blocking)
   - what: The brief says step 2 depends on step 1 being on main. It is not: origin/main holds neither *_settings_products.sql nor src/server/settings/products.ts. As a result, slice/b18 will carry three migrations together with the code that needs them. That goes against R16 (STANDARDS.md line 163: a migration lands in its own small PR before the code) and the plan's Data changes line. The author declared this. It is a workflow and orchestrator matter, not a defect in the group's files.
   - evidence: git diff origin/main...slice/b18 --stat lists 20261011011430_settings_products.sql, 20261011042604_fn_settings_put_products.sql and 20261011042619_action_roles.sql; log g2 block paragraph 2

3. `app/src/db/types.ts` (not blocking)
   - what: The settings_put_products entry is hand-written. The plan's proof (bun run gen:types, then typecheck) cannot reproduce until main pushes the migration. Confirmed by running: the --db output differs only by the stray __wf_probe and the missing entry. UNPROVEN until CI's db job type-drift check (git diff --exit-code src/db/types.ts) runs on the ephemeral stack, or until a regeneration after the push. C21 requires the types to travel with the migration.
   - evidence: bun run gen:types -- --db; git diff src/db/types.ts shows + __wf_probe and - settings_put_products only

4. `app/supabase/sql/functions/settings_put_products.sql` (not blocking)
   - what: Invariant 11 (two admins saving at once keep both before values) is shown only as two sequential saves in one transaction: UNPROVEN for concurrent transactions. Suspected by reading, not run: line 55's select ... for update locks nothing when the products row is absent. Two concurrent first saves would then both audit before = null, because the second does its on-conflict update without having read the first value. The seed row from step 1 makes this reachable only if the row is deleted.
   - evidence: tests/db/settings-products.db.test.ts case 'keeps the before value of each of two saves in a row' runs both saves in one withRollback; the SQL source reads 'select s.value into v_before ... for update' followed by 'insert ... on conflict do update'

5. `app/src/admin/settings/ProductsSection.tsx` (not blocking)
   - what: C05 duplication. ProductsSection.tsx:61 adds a third copy of the one-line `failure` helper (the others are RedirectsSection.tsx:17 and SettingsPage.tsx:22). `labelOf` (the enum label of a plan id from boundPlanIds) is defined twice, in src/server/settings/products.ts and in ProductsSection.tsx. It is a pure function of a domain constant and could live once in src/domain/exposure.ts.
   - evidence: grep -rn "failure =" src/admin/settings; grep -n "const labelOf" src/server/settings/products.ts src/admin/settings/ProductsSection.tsx

6. `app/src/admin/settings/ProductsSection.tsx` (not blocking)
   - what: C17: a server refusal (422, 503) reaches the admin only as a toast with error.message. It does not show the request id, and server issues are not mapped to fields. Fields are mapped only for the client-side parse with the same schema. This matches the sibling sections, so it is not a regression, but C17 asks for the error with the request id.
   - evidence: runPreview/runSave onError call toast({ message: failure(error) }); AdminApiError carries requestId (src/admin/ui/admin-fetch.ts:25)

7. `workspace/05-plans/logs/B18.md` (not blocking)
   - what: The group touched files outside its named list beyond the H46 gate-config exception: tests/unit/settings.service.test.ts (getSettings shape), src/data/exposure.ts (a step 3 file, .ts import for Deno), src/domain/exposure.ts (toOffering, invoiceLine and costAnswer, which the Contract names) and src/styles/admin/index.css. Each is needed and is disclosed in the log. The orchestrator should fold them into the plan's step 2 Files line.
   - evidence: git show --stat a8a34ff9; log g2 block 'Files beyond the brief's list'
