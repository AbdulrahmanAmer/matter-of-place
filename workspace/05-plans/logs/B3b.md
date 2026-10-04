# B3b log

## g1 · steps 1

Step 1 (mop-designer, no code): `app/docs/coming-soon.md` holds the runbook (how the mode works, flags and how to add one, consent record and `CONSENT_VERSION`, who flips what, seeing the empty state, launch checklist), the layout decisions, the copy table (31 rows), and the accessible-name and focus notes. Main merged first: `Already up to date`.

Proof 1, the table scan (run in `app/`):

```
$ node -e "const rows=...filter(l=>/^\| \x60/.test(l));const bad=rows.filter(l=>/—|\x21|exclusive|guarantee|stunning|luxury|buyers|leads|unlock/i.test(l));console.log(rows.length+' rows, '+bad.length+' bad');process.exit(bad.length?1:0)"
31 rows, 0 bad
exit 0
```

Watched-fail of the scan: a scratch copy with the `badge` row set to `Opening soon!` printed `31 rows, 1 bad`, exit 1. Restored (the real file is unchanged).

Proof 2, gates in `app/`:

```
bunx prettier --config .prettierrc --check docs/coming-soon.md -> All matched files use Prettier code style!
bun run check (foreground, first run) -> layout, typecheck, lint, knip, jscpd, stubs, format:check passed; vitest stage failed:
  Error: [vitest-pool]: Failed to start forks worker for test files E:/mop-build/coming/app/tests/unit/owner-presented.test.tsx.
  Caused by: Error: [vitest-pool-runner]: Timeout waiting for worker to respond
  quiet: exit 1
bun run test (alone, background, second run) -> Test Files  99 passed (99) / Tests  1269 passed (1269) / quiet: ok
bun run build -> quiet: ok (249 lines)
```

The first red is the worker-start timeout of P-712 (hit again, banked), not an assertion.

Two bends for the review, both in the doc: (1) on desktop the form button sits on the field's row, so the tab order (field, chooser, button) differs from the visual order in one place; the consent notice keeps one DOM for both widths, so desktop Tab runs Allow, No thank you, then the link; (2) `what` shows on the home hero only.

## g2 · steps 2

Main merged first (`git merge origin/main`, clean). Files: `src/lib/strings.ts` (`comingSoon`, `consent`, `fill`), `src/lib/coming-soon.ts`, `src/lib/consent.ts`, `src/domain/flags.ts`, `src/lib/analytics.ts` (three names, `setUtmConsent(consentGranted)`), `src/server/lib/flags.ts` (`mergeFlags` only: the step 2 test needs it, step 4 adds `getFlags` to the same file, P-074), `tests/unit/{coming-soon,copy-voice,flags,consent}.test.ts`, the `utm consent` case of `tests/unit/analytics-batch.test.ts`, `tests/unit/analytics.test.ts` (`everyEvent` lists the three new names, else typecheck fails), `tests/mutations/B3b.json` (34 entries, ids `b3b-<letter>` because every plan letter is taken in another registry, P-066). The 31 rows of the g1 table are in `strings.ts` word for word (one-off compare: `31 rows, 0 missing`).

Proof 1:

```
$ bunx vitest run --project unit tests/unit/coming-soon.test.ts tests/unit/copy-voice.test.ts tests/unit/flags.test.ts tests/unit/consent.test.ts
 Test Files  4 passed (4)
      Tests  33 passed (33)
```

Proof 2 (run directly: `quiet.mjs` drops the quotes of `-t "utm consent"` and splits it into `-t utm` plus a file filter `consent`, which ran four cases instead of one):

```
$ bunx vitest run --project unit tests/unit/analytics-batch.test.ts -t "utm consent" --reporter=verbose
 ✓ |unit| tests/unit/analytics-batch.test.ts > track() campaign attribution (G45) > utm consent follows the stored record and Global Privacy Control 1191ms
      Tests  1 passed | 11 skipped (12)
```

Proof 3, watched-fail replay of all 34 entries (`node scripts/watchfail.mjs --registry tests/mutations --only b3b-<id>`), every one `WATCHED-FAIL OK B3b:<id>`: d, cv-count, cv-hype, cv-brief, cv-places, cv-fill, h, i, k, co-none, co-yes, co-no, co-corrupt, co-write-throw, co-stores, co-once, co-refused, co-event, l, fl-defaults, fl-unknown, fl-refuse, fl-snake, fl-archive, fl-ignore, fl-malformed, cs-open, cs-listings, cs-source, cs-fill, cs-own, cs-empty, cs-scopes, z. Each file was back to its tracked text after the loop (`git status` showed only the group's own files).

Proof 4, `bun run check` (quiet): layout, typecheck, lint, knip, jscpd, stubs and format:check passed; the vitest stage printed `Test Files  1 failed | 110 passed (111)` with `× lint gives prettier/prettier the options of .prettierrc for it 29880ms` (`Test timed out in 20000ms`, its own limit, with two other lanes running). `bunx vitest run --project unit tests/unit/hygiene.test.ts tests/unit/mutation-registry.test.ts tests/unit/analytics-allowlist.test.ts` right after: `Test Files  3 passed (3)`, `Tests  61 passed (61)`. Load, banked as a hit on G-031.

Proof 5: `bun run build` -> `quiet: ok (243 lines)`.

## g1 · steps 1

Repair after review. Fixed in `app/docs/coming-soon.md`, each from the plan line it states: launch checklist now follows L1 step 1 letters 1b to 1g, adds `gh variable set MOP_DB_PRODUCTION --body true` (B3b.md:136, L1.md:24), names `MOP_LAUNCHED` (L1 step 4e) and the rollback remedy; the illustrative section follows B3b.md:22, 105, 122 to 128 (one `IllustrativeNotice` block wherever an illustrative property shows, a separate `ILLUSTRATIVE PROPERTY` tag on cards and heroes); both who-flips lines name the chief and managing editor (B7.md:70 `markets.edit`); the flag recipe names `defaultFlags` as a literal (it is one in `src/domain/flags.ts`); the desktop flip leads with `with-coming-soon.ts` (G34); the seed line says `--images upload` waits for B9; the pointer-close focus line says where focus goes and that step 5 records it. Bank: P-008 and P-712 hit again, P-1300 added.

Proof 1 (in `app/`):

```
$ node -e "const rows=...filter(l=>/^\| \x60/.test(l));...console.log(rows.length+' rows, '+bad.length+' bad')..."
31 rows, 0 bad
```

Proof 2: `bun run check` (quiet, background) -> `exit=0`, stages layout, typecheck, lint, knip, jscpd, stubs, format:check and vitest ran; `quiet: ok (50 lines, showing the last 12)`.

Proof 3: `bun run build` -> `quiet: ok (242 lines, showing the last 12)`.

Proof 4: `node workspace/05-plans/check-gotchas.mjs` -> `check-gotchas: OK (38 path entries, 263 process entries)`.

## g1 · steps 1 (second repair)

Fixed in `app/docs/coming-soon.md`, from the review: the focus note (blocking) now reads the cascade, `outline: 1px solid currentColor` in `src/styles/base.css`, and says the filled `Allow` button sets `outline-color: var(--foreground)` in `consent.css` (step 5 asserts it; the same invisible ring on other filled `.button` styles is named and left to the owner of `base.css`); card tag is `ILLUSTRATIVE` (default `ContentTag`), hero tag `ILLUSTRATIVE PROPERTY` (B3b.md:122, 128); permission is `markets.coming_soon` (B3b.md:47); launch checklist adds the `/california` sentence check (B3b.md:109) and L1 step 6's move of the URL to `https://matterofplace.com`; the section is named by its own `h2`, never an `h1` (step 5 proof). Not mine, left: `app/docs/runbooks/database.md` still lacks `MOP_DB_PRODUCTION` (orchestrator folds). Bank: P-1301 added, P-712 hit again.

Proof 1 (in `app/`):

```
31 rows, 0 bad
```

Proof 2: `bunx prettier --check docs/coming-soon.md` -> `All matched files use Prettier code style!`

Proof 3: `node workspace/05-plans/check-gotchas.mjs` -> `check-gotchas: OK (38 path entries, 264 process entries)`

Proof 4: `bun run check` (background, `echo exit=$?` into the same log) -> `exit=0`; `Test Files  111 passed (111)`, `Tests  1396 passed (1396)`.

Proof 5: `bun run build` -> `quiet: ok (248 lines, showing the last 12)`.

## g2 · follow-ups recorded

The g2 review found no blocking defect and five follow-ups; no code changed. One is a cost with no bank entry and is now P-1302 (scratch output file names collide across sessions). The other four are in `workspace/05-plans/logs/B3b-followups.md` under "## g2 · steps 2" for the orchestrator to fold or assign: `quiet.mjs` drops the quotes of an argument with a space, a stale case title in `analytics-batch.test.ts`, the event count in `pages-and-wording.md` section 6, and the `analytics.test.ts` edit outside the named list (H46).

## g1 · follow-ups recorded

The g1 review found no blocking defect and five follow-ups; no code changed. One is a cost with no bank entry and is now P-1303 (Git Bash `/tmp` and node's `/tmp` are different folders). The other four are in `workspace/05-plans/logs/B3b-followups.md` under "## g1 · steps 1" for the orchestrator to fold or assign: the unowned consent outline and focus assertions (step 5 or 8 in the plan and the doc), the launch switch section of `database.md`, the missing `coming-soon.md` row in the docs index, and the invisible focus ring on filled `.button` in `base.css`.

## g3 · steps 3

Main merged first (`git merge origin/main`, fast-forward to 00f1d80). 2026-10-04 19:22 +0300.

Files: `supabase/migrations/20261004155556_coming_soon.sql` (made by `bun run db:fn --name coming_soon set_environment refuse_illustrative_in_production`, then the `-- down:` header, the trigger, the view and the `flags` row added; the plan's name `20261001110000_coming_soon.sql` is older than main's newest migration, so R16 and P-324 give it today's version), `supabase/sql/functions/{set_environment,refuse_illustrative_in_production}.sql` (R19), `scripts/set-environment.ts`, `scripts/with-coming-soon.ts`, `package.json` (`set-env`), `tests/db/{illustrative-guard,interest-counts,flags}.db.test.ts`, `tests/unit/assert-not-production.test.ts` (`guardedScripts` lists both scripts), `src/server/lib/error-codes.ts` (`illustrative_in_production` 409, `invalid_environment` 422: `error-codes.test.ts` went red on the two raised messages), `tests/mutations/B3b.json` (16 entries). The brief named `app/scripts/set-env.mjs`; the plan's file is `scripts/set-environment.ts` (P-320 hit again). `with-coming-soon.ts` is in no step's Files line, but the step 3 proof greps it and lists it in the guard test, so this group wrote it from its Files entry; it sets `MOP_DEV_LOCK_HELD=1` for its child, as B4's `e2e-coming-soon.ts` does, so a committed test under it does not wait on its parent's lock (G34).

Choices beyond the plan text, for the review: `set_environment` takes the `environment` row `for update` before it checks for an Illustrative property, and the trigger reads that row `for share`, so an illustrative insert racing a switch to production either commits first (and the check sees it) or waits and then reads `production` (R22). The view is `security_invoker = true`, not `= on` as the plan words it: `schema.db.test.ts` matches the stored option literally (P-1304). The view revokes all from `public, anon, authenticated` and grants `select` to `authenticated, service_role` (G-100). `illustrative-guard.db.test.ts` deletes every Illustrative row inside its transaction before the switch, because mop-dev holds the 16 seeded ones. The interest counts are asserted as deltas over what the view held at the start, so a database that already has signups reads the same.

NOT DONE: `src/db/types.ts` is unchanged. Main has no CI `db` job and no `db-types` artifact, and `gen:types` reads mop-dev, which lacks this migration (P-327 hit again). It is regenerated after main's dev job pushes the migration.

Proof 1, the three db files of step 3 plus `function-source`, on mop-dev inside rolled-back transactions with the migration as prelude (P-312; ruling H57: the CI `db` job does not exist on main and the post-push run is UNPROVEN):

```
$ eval "$(node scripts/load-env.mjs --profile dev)"; export MOP_MUTATION_SQL="$(cat supabase/migrations/20261004155556_coming_soon.sql)"
$ env -u CLOUDFLARE_API_TOKEN node node_modules/vitest/vitest.mjs run --project db tests/db/illustrative-guard.db.test.ts tests/db/interest-counts.db.test.ts tests/db/flags.db.test.ts tests/db/function-source.db.test.ts --reporter=verbose
 ✓ |db| tests/db/illustrative-guard.db.test.ts > illustrative guard > allows an illustrative insert in development and refuses production while one exists 2758ms
 ✓ |db| tests/db/illustrative-guard.db.test.ts > illustrative guard > set_environment('production') succeeds once none is left and writes one system audit row 3009ms
 ✓ |db| tests/db/illustrative-guard.db.test.ts > illustrative guard > in production an illustrative insert and an update to Illustrative both raise 3124ms
 ✓ |db| tests/db/illustrative-guard.db.test.ts > illustrative guard > both functions run with an empty search_path 1561ms
 ✓ |db| tests/db/illustrative-guard.db.test.ts > illustrative guard > refuses an environment outside development, preview and production 1826ms
 ✓ |db| tests/db/illustrative-guard.db.test.ts > illustrative guard > anon and authenticated get permission denied on set_environment 3056ms
 ✓ |db| tests/db/interest-counts.db.test.ts > market_interest_counts > counts one signup for california and one for california and florida as 2 and 1 2198ms
 ✓ |db| tests/db/interest-counts.db.test.ts > market_interest_counts > moves a confirmed signup from pending to confirmed 1886ms
 ✓ |db| tests/db/interest-counts.db.test.ts > market_interest_counts > does not count an unsubscribed or an archived signup 2324ms
 ✓ |db| tests/db/interest-counts.db.test.ts > market_interest_counts > refuses anon, shows a staff user the counts and a signed-in non-staff user none 4150ms
 ✓ |db| tests/db/flags.db.test.ts > settings.flags > exists with new_channels and archive_pages false 1919ms
 ✓ |db| tests/db/flags.db.test.ts > settings.flags > an update of the row bumps catalog_version once 2825ms
 ✓ |db| tests/db/function-source.db.test.ts > function source > every function file's body equals pg_proc.prosrc, and every public or app function has a file 2344ms
 Test Files  4 passed (4)
      Tests  13 passed (13)
```

The `search_path` case reads `proconfig` = `{search_path=""}` for both functions (a psql probe of the same prelude printed `set_environment | {"search_path=\"\""}`). With the same prelude, file by file: `rls.db.test.ts` 14 passed, `catalog-version.db.test.ts` 18 passed, `schema.db.test.ts` first `1 failed | 50 passed (51)` (`× every view is security_invoker (R20)`, the `= on` spelling, P-1304), after the fix `51 passed (51)`.

Proof 2, watched-fail replay of the 16 new entries (a fresh scratch registry, each `sql` entry with the migration first and `run` in the node form, P-312; the file entries as committed):

```
$ env -u CLOUDFLARE_API_TOKEN node scripts/watchfail.mjs --registry <scratchpad>/reg-g3-1791129979
WATCHED-FAIL OK B3b:b3b-ig-exists
WATCHED-FAIL OK B3b:b3b-ig-audit
WATCHED-FAIL OK B3b:b3b-b
WATCHED-FAIL OK B3b:b3b-ig-update
WATCHED-FAIL OK B3b:b3b-ig-path
WATCHED-FAIL OK B3b:b3b-ig-staging
WATCHED-FAIL OK B3b:b3b-u
WATCHED-FAIL OK B3b:b3b-ic-count
WATCHED-FAIL OK B3b:b3b-ic-confirmed
WATCHED-FAIL OK B3b:b3b-ic-live
WATCHED-FAIL OK B3b:b3b-ic-invoker
WATCHED-FAIL OK B3b:b3b-ic-anon
WATCHED-FAIL OK B3b:b3b-m
WATCHED-FAIL OK B3b:b3b-fl-bump
WATCHED-FAIL OK B3b:b3b-t
WATCHED-FAIL OK B3b:b3b-w
watchfail: replayed 16: ok 16, bad 0, stale 0; manual 0 not replayed; 0 not selected
```

Plan letters: (b) `b3b-b`, (m) `b3b-m`, (t) `b3b-t`, (u) `b3b-u`, (w) `b3b-w`. (t) and (w) delete the import only, which is enough for the guard test to name the file (`expect` is the `+ "scripts/<file>"` line of its diff). `git status` after the replay showed only this group's files.

Proof 3, the scripts (dev profile loaded):

```
$ env -u CLOUDFLARE_API_TOKEN bun run set-env -- --target prod --value production
unknown target prod
exit=2
$ env -u CLOUDFLARE_API_TOKEN -u DEV_DB_URL -u DEV_SUPABASE_PROJECT_REF -u DEV_SUPABASE_SERVICE_ROLE_KEY HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 bun scripts/set-environment.ts --target prod --value production
unknown target prod
exit=2
$ git add -N scripts/set-environment.ts scripts/with-coming-soon.ts; git grep -n "assert-not-production" -- scripts/set-environment.ts scripts/with-coming-soon.ts
scripts/set-environment.ts:8:import { assertNotProduction } from "./lib/assert-not-production.mjs";
scripts/with-coming-soon.ts:7:import { assertNotProduction } from "./lib/assert-not-production.mjs";
$ bunx vitest run --project unit tests/unit/assert-not-production.test.ts
 Test Files  1 passed (1)
      Tests  9 passed (9)
$ env -u CLOUDFLARE_API_TOKEN bun scripts/with-coming-soon.ts --value false -- node -e process.exitCode=3
coming_soon_global restored to false
exit=3
$ env -u CLOUDFLARE_API_TOKEN bun scripts/with-coming-soon.ts --value maybe -- node --version
usage: bun scripts/with-coming-soon.ts --value true|false -- <command...>
exit=2
```

UNPROVEN until main's dev job pushes the migration (H57): `bunx supabase migration list --linked` showing `20261004155556`; `bun run set-env -- --target dev --value preview` exit 0 and `bun run db:psql -- -c "select value from settings where key = 'environment'"` printing `"preview"`; the three db files without the prelude; the CI `db` job and its type drift check (no such job on main).

Proof 4, gates in `app/`: first `bun run check` red in lint (prettier on `flags.db.test.ts`, fixed with `prettier --write`); second red in `error-codes.test.ts` (`× holds every message a migration raises`: `invalid_environment` and `illustrative_in_production` of `20261004155556_coming_soon.sql`); third `quiet: ok (50 lines, showing the last 12)`, exit 0. `bun run build` -> `quiet: ok (235 lines, showing the last 12)`.

Bank: P-1304 added; P-320, P-327 and P-008 hit again. `node workspace/05-plans/check-gotchas.mjs` -> `check-gotchas: OK (39 path entries, 270 process entries)`.

Merge after the push: PR 122 showed `CONFLICTING` (P-136), so `git merge origin/main` ran again; the bank driver kept ours for P-008 ("compare by hand"). `GOTCHAS.md` was rebuilt as main's text plus this group's P-008, P-320 and P-327 lines and P-1304 (an entry-by-entry compare with main: `missing [], added [P-1304], changed [P-008, P-320, P-327], lostLines []`; `git diff --stat origin/main -- GOTCHAS.md` -> `11 insertions(+)`). After the merge: `migration-order: OK (24 on main, 1 added)`; `error-codes`, `assert-not-production` and `mutation-registry` unit tests `15 passed (15)`.
