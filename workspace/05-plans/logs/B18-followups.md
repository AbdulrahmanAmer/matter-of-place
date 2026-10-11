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
