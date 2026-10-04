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

## g3 · follow-ups recorded

The reviewer of g3 found no blocking defect and eight follow-ups; no code changed. Five follow-ups are listed word for word in `workspace/05-plans/logs/B3b-followups.md` under "## g3 · steps 3" (types.ts regeneration, the re-encoded em dash in B3b.md mutations, the untested lock race, with-coming-soon.ts signal and quoting paths, the stale plan lines). The three whose file is `GOTCHAS.md` went into the bank: P-1305 added (scratch registry folders are shared in the session scratchpad); hit-again lines on P-136, P-156, P-322 and P-1602; the P-008 hit-again line separated from P-010 by a blank line.

## g4 · steps 4,5

Start: `git fetch && git checkout slice/b3b && git merge origin/main` fast-forwarded to 4693942 (no conflict). Files: `src/server/lib/flags.ts` (`getFlags`), `src/start.ts`, `src/server/catalog/visibility.ts`, `src/components/forms/interest-form.tsx`, `src/components/site/coming-soon.tsx`, `src/components/layout/consent-notice.tsx`, `src/components/layout/footer.tsx`, `src/styles/components/coming-soon.css`, `src/styles/components/consent.css`, `src/styles.css` (two imports), seven test files, `tests/mutations/B3b.json` (37 entries, P-079).

Deviations from the plan text (each banked):
- `start.ts` wires `getFlags: () => (hasDatabase ? getFlags(getDb()) : Promise.resolve({}))`, the guard `redirect` and `cache` already carry; the plan line has none and a Worker with no key would answer 503 on every page (P-1310).
- The `flags` case asserts the spy reaches `securityHeaders`; the `cspFor` half cannot be observed through a module spy because `securityHeaders` calls it inside the module (P-1308). UNPROVEN until B17 makes `cspFor` read a flag.
- `coming-soon.api.test.ts` reads the shell's `MOP_ENV` before `./env` overwrites it with `local` (P-1306); otherwise the plan's production run never runs its case.
- The follow-up of step 1's review: `consent.css` sets `outline-color: var(--foreground)` on `.consent-allow:focus-visible`; the same ring on `.interest-submit`, the other filled button on an Ivory page.

Proof 1, step 4 wiring and stubs:

```
$ bunx vitest run tests/unit/pipeline.test.ts -t flags
 Test Files  1 passed (1)
      Tests  2 passed | 83 skipped (85)
$ grep -n "getFlags" src/start.ts
5:import { getFlags } from "./server/lib/flags";
40:        getFlags: () => (hasDatabase ? getFlags(getDb()) : Promise.resolve({})),
$ grep -c "STUB(" src/server/catalog/visibility.ts
0
$ bun scripts/stubs.ts; echo exit=$?
stubs: 9 markers, 0 on closed slices
exit=0
```

Proof 2, `bunx vitest run tests/unit/flags.test.ts tests/unit/visibility.test.ts`:

```
 Test Files  2 passed (2)
      Tests  18 passed (18)
```

The counter cases: 100 `getFlags(fake)` calls move `public_state` by 1 and make no `from()` call; 100 `getCatalog(fake)` calls move `public_state` and `public_catalog_snapshot` by 1 each and make no `from()` call; a fake that fails after one good call is served stale by both.

Proof 3, database project, dev profile, `CATALOG_VERSION_TTL_MS=0`:

```
$ bunx vitest run --project db tests/api/coming-soon.api.test.ts tests/db/market-opening.db.test.ts
 Test Files  2 passed (2)
      Tests  4 passed | 1 skipped (5)
$ MOP_ENV=production bunx vitest run --project db tests/api/coming-soon.api.test.ts
 Test Files  1 passed (1)
      Tests  3 passed | 1 skipped (4)
$ MOP_ENV=local bunx vitest run --project db tests/api/coming-soon.api.test.ts
 Test Files  1 passed (1)
      Tests  3 passed | 1 skipped (4)
$ bun run db:psql -- -c "select (select value from settings where key='coming_soon_global') g, (select value from settings where key='flags') f, (select count(*) from properties where slug like 'test-b3b-%') p"
 false | {"new_channels": false, "archive_pages": false} | 0
```

`market-opening.db.test.ts` runs on the one `pg` client of `withRollback` through `pgRpc(client)`. The environment of `mop-dev` reads `development` (not `preview`), which `public_state()` also treats as illustrative-on; the test sets it with `set_environment('development')` inside its transaction.

Proof 4, step 5 components, `bunx vitest run --project component tests/unit/interest-form.test.tsx tests/unit/coming-soon-block.test.tsx tests/unit/consent-notice.test.tsx`:

```
 Test Files  3 passed (3)
      Tests  17 passed (17)
```

Proof 5, watched-fail replay of the 37 new entries (fresh folder holding only this group's entries, P-1305; `b3b-dd` is `manual`, replayed by hand below):

```
$ node scripts/watchfail.mjs --registry <scratchpad>/reg-g4
WATCHED-FAIL OK B3b:b3b-a ... b3b-q, b3b-vis-market, b3b-vis-global, b3b-vis-local, b3b-vis-rows
WATCHED-FAIL OK B3b:b3b-api-prod, b3b-api-local, b3b-l-vis, b3b-api-flags, b3b-c, b3b-mo-bump, b3b-y
WATCHED-FAIL OK B3b:b3b-fl-getflags, b3b-o, b3b-p, b3b-fl-stale, b3b-x, b3b-x-handle
WATCHED-FAIL OK B3b:b3b-e, b3b-if-chooser, b3b-if-track, b3b-if-hp, b3b-if-sent
WATCHED-FAIL OK B3b:b3b-s, b3b-cs-h2, b3b-cs-title, b3b-cs-market
WATCHED-FAIL OK B3b:b3b-k-notice, b3b-cn-track, b3b-cn-collapse, b3b-cn-focus, b3b-cn-version, b3b-cn-open, b3b-cn-dialog
first replay: WATCHED-FAIL BAD: stayed green (B3b:b3b-j)   (the `?raw` CSS import was empty, P-1307)
after the fix: WATCHED-FAIL OK B3b:b3b-j
```

Plan letters: (a) `b3b-a`, (c) `b3b-c` and `b3b-mo-bump`, (e) `b3b-e`, (j) `b3b-j`, (k) `b3b-k-notice`, (l) second half `b3b-l-vis`, (o) `b3b-o`, (p) `b3b-p`, (q) `b3b-q`, (s) `b3b-s`, (x) `b3b-x` and `b3b-x-handle`, (y) `b3b-y`. (dd) by hand with a scratch PLAN whose B3b row says closed and the STUB line put back:

```
$ bun scripts/stubs.ts --plan <scratch>/PLAN-b3b-closed.md
src/server/catalog/visibility.ts:13 STUB(B3b) slice is closed: coming-soon and illustrative filtering
stubs: 10 markers, 1 on closed slices
exit=1
```

Review evidence, not the gate: a temporary route `_site.zzpreview.tsx` (deleted, `routeTree.gen.ts` restored with `git checkout`) rendered `ComingSoon` in the `home` and `market` scopes under the real footer at 1440 and 390 under `vite dev --port 8878` without a database; both read as the layout section describes (eyebrow left, one hairline, field and button on one row with the chooser beneath on desktop; stacked with 44 px rows on the phone; the notice a single row above the footer links). The screenshots of `/` with the live flag (`with-coming-soon.ts`) are NOT DONE: `ComingSoon` is wired into the routes by step 6, so `/` shows nothing of it yet.

Proof 6, gates in `app/`: `bun run check` exit 0 (layout, typecheck, lint, knip, jscpd, stubs, format, 1426 tests of the unit and component projects) and `bun run build` exit 0. The first `check` was red twice: tsc (`exactOptionalPropertyTypes` on `market={market}` of `InterestForm`, and a spread of a possibly undefined array element in `visibility.test.ts`) and `mutation-registry.test.ts` (the six new test files had no entry); both fixed.

Bank: P-1306 to P-1310 added; P-008, P-094 and P-331 hit again. `node workspace/05-plans/check-gotchas.mjs` -> `check-gotchas: OK (39 path entries, 278 process entries)`.

UNPROVEN: the e2e rows of watched-fails (e), (f), (k), (n) and `tests/e2e/consent.spec.ts` (steps 6 to 8, other groups); the overlap with the sticky action bar; `bun run db` of CI on this pull request (the db project was run here against `mop-dev`, which holds g3's migration through main).

## g5 · steps 6,7

Branch slice/b3b, main merged at the start (clean). Step text owns the files beyond the sizing list (P-513): `_site.stories.$slug.tsx`, `_site.property.$slug.tsx`, `property-card.tsx`, `image-hero.tsx`, `story-card.tsx`, `gallery.tsx`, `representation.tsx`, `strings.ts` (the unused `illustrativeImagery` string removed), the two test files and `tests/mutations/B3b.json`. Style files touched: `cards.css` (`.market-card` background, so a card without a photograph keeps its type), `coming-soon.css` (`.illustrative-notice`), `hero.css` (`.hero-text`, P-1314). Not touched: `vite.config.ts`, `trace.json`.

Proof 1, empty-image and label tests (`bunx vitest run tests/unit/no-image.test.tsx tests/unit/illustrative-labels.test.tsx`):
```
 Test Files  2 passed (2)
      Tests  15 passed (15)
```

Proof 2, watched-fail replay of the 16 new entries (`node scripts/watchfail.mjs --registry tests/mutations --only <id>`, one call each): `WATCHED-FAIL OK B3b:` for b3b-bb, b3b-ni-story-img, b3b-ni-market, b3b-ni-market-alt, b3b-ni-market-soon, b3b-ni-badge, b3b-cc, b3b-il-card-tag, b3b-il-home-active, b3b-il-home-notice, b3b-il-prop-active, b3b-il-prop-tag, b3b-il-story, b3b-il-market, b3b-il-hero-tag, b3b-g. First replay: all 16 `BAD: wrong reason` (the `expect` began `× ` and vitest prints no suite on that line, P-066 hit again); rewritten as `FAIL .*<Suite> > <title>`. Plan letters: (bb) `b3b-bb`, (cc) `b3b-cc`, (g) `b3b-g` (the unit half; its production grep is Proof 4).

Proof 3, step 6 live build (`MSYS_NO_PATHCONV=1 VITE_API_BASE_URL=/api/public VITE_TURNSTILE_SITE_KEY=... bun run build` exit 0; the first build without the prefix baked `C:/Program Files/Git/api/public`, P-1311), preview on port 8878 after `env -u CLOUDFLARE_API_TOKEN node scripts/dev-vars.mjs` and `CATALOG_VERSION_TTL_MS=0`:
```
$ curl -s http://127.0.0.1:8878/ | grep -ao 'data-services="live"'
data-services="live"
$ bun scripts/with-coming-soon.ts --value true -- bash step6.sh   (the two greps of the plan, port 8878)
1
1
coming_soon_global restored to false
```

Proof 4, step 7 on the same build, full seed on mop-dev (16 properties, 3 markets, `coming_soon_global` false, environment `development`):
```
MOP_ENV=local:
  /            grep -c "What is real here"                          1
  /california  grep -c "No property is listed in California yet."   0
  /properties  grep -c "ILLUSTRATIVE PREVIEW"                       1
  /california/guide  img tags inside <main>                         0
MOP_ENV=production (wrangler restarted, page cache removed, P-1312):
  /            grep -c "What is real here"                          0
  /california  grep -c "No property is listed in California yet."   1
  /properties  grep -c "No property is listed yet."                 1
  /properties  grep -ci illustrative                                1   <- NOT the plan's 0
```
The one match is a chunk name, `<link rel="modulepreload" href="/assets/illustrative-notice-B7cqm258.js"/>` (P-1313). It is a plan defect: the file name is fixed by the plan and `trace.json`, and the same name will fail g7's `no-illustrative` check on every production page. NOT DONE until a ruling picks a chunk-name or assertion fix.

Review evidence: headless Chrome 1440 screenshots under the global flag, `/` (text hero on Obsidian with the signup, nav legible; the first version on Bone left the nav unreadable, P-1314) and `/california` (type-only hero, intro, regions, signup). Phone width and the dark market cards below the fold were not looked at (NOT DONE).

Proof 5, gates in `app/`: `bun run check` exit 0 twice (second run after the `.hero-text` change); the live build exits 0. A separate non-live `bun run build` was not run: the live build is the same command with two variables.

UNPROVEN: the e2e rows (f), (r) (g6); the production `grep -ci illustrative` of step 7 (P-1313); a published open market with a photograph (no seed row has one under `--images skip`); `Gallery` and `Representation` status wording has no test of its own (the plan lists none).

Bank: P-1311 to P-1314 added; P-066, P-094, P-008 hit again. `node workspace/05-plans/check-gotchas.mjs` -> `check-gotchas: OK (39 path entries, 282 process entries)`.

## g4 · follow-ups recorded

The review of g4 (steps 4,5) found no blocking defect. One follow-up was a cost with no bank entry and is banked as hit-again lines on P-818 and P-079 (no new number: the lessons were already held). The other 7 follow-ups are in `logs/B3b-followups.md` under "## g4 · steps 4,5" for the orchestrator to fold or assign. No code changed. `node workspace/05-plans/check-gotchas.mjs` -> `check-gotchas: OK (39 path entries, 295 process entries)`.

## g6 · steps 8
Started 2026-10-04 22:36 +0300. Main merged first: Already up to date. Files: `app/tests/e2e/coming-soon.spec.ts`, `app/tests/e2e/consent.spec.ts`, `app/tests/mutations/B3b.json` (20 manual entries, ids ending `-e2e`, the registry wiring of P-079; B4's e2e entries are manual too). Live build: `MSYS_NO_PATHCONV=1 VITE_API_BASE_URL=/api/public VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA bun run build`, `grep -rl "Program Files/Git" .output/server .output/public | wc -l` printed 0. Lane port 8878 (`E2E_PORT=8878`); `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` unset for every run (P-331).

Plan defect, built as the plan's intent (P-1315): step 8 says no `img` inside `main` on `/california`; the market page lists story cards and rule 5 keeps their photographs, so the spec asserts `main img:not(.story-card img)`. Two other differences from the step text: the overlap case is skipped in `desktop` by design (the plan says the `phone` project), and `consentGranted()` is not reachable from the page, so the Global Privacy Control case observes it through `data.utm` of the `consent_set` envelope, with a control case (`an allowed choice sends the campaign attribution`).

Proof 1: E2E_TARGET=built E2E_MODE=live E2E_PORT=8878 bun run test:e2e:coming-soon (run twice in a row, same output)
  28 passed (45.1s)
  coming_soon_global restored to false
Proof 2: bun run db:psql -- -c "select value from settings where key = 'coming_soon_global'"
   false
Proof 3: select count(*) from subscribers where email like 'test+%@fixtures.invalid' -> 0
Proof 4: E2E_TARGET=built E2E_MODE=live E2E_PORT=8878 bunx playwright test tests/e2e/consent.spec.ts --project=desktop --project=phone (twice)
  1 skipped
  15 passed (34.7s)
Proof 5: bun run check exits 0 (48 lines, ok), bun run build exits 0.

Watched-fail (a build per batch, all restored, git status clean afterwards; scratch runner outside the repository). Batch A, 15 source edits at once, red for the named reason: market card badge removed (home: Expected substring "Opening soon"), `properties.length === -1` (filter-bar count 1), market, guide and region images rendered whatever comingSoon says (<img src= printed), stories branch (story-card count 0, expected 6), `markets` dropped from interest-form (row markets differ), source changed (row source differs, batch B), property route throws (Expected 404, Received 500), Google img in Footer (www.google-analytics.com), consent.css fixed bottom 0 (notice sits in the footer: Expected value not "fixed"; phone overlap: bar 788 to 844 against notice 571 to 804), `writeConsent` always true (analytics false case), `decided` against version + 1 (reload case), `setUtmConsent` line deleted (utm Received undefined), outline-color rule deleted (Expected not rgb(245, 242, 235)). The Global Privacy Control case stayed green in batch A because the same batch had deleted the utm line (a confound); alone in batch B it went red (Received + 13). Batch C: ComingSoon branch off the market page (california case red on the h2), `min-width: 2000px` (document scroll width 2000 against 1440 and 1560). Batch D: aria-label and placeholder off the email input (axe: new violations on /, /properties, /california/bay-area). A colour mutation (`.coming-soon { color: var(--background) }`) stayed green and was dropped.
Not replayed by the tool: every entry is kind manual (a replay needs a rebuild), as B4's e2e entries are.
Costs banked: P-1315, P-1316, P-1317; hit again P-1311, P-331, P-071, P-042.

## g5 · steps 6,7 (repair after review)

Branch slice/b3b, main merged first (clean merge, brings H59). Blocking defect (step 7 production `grep -ci illustrative` prints 1, chunk name `illustrative-notice-<hash>.js`): ruled by H59, which puts hash-only chunk names in `vite.config.ts` under step 9 (g7); g5 does not touch `vite.config.ts` or `trace.json`. No g5 file changes. `coming_soon_global` read before the live proofs: `false` (P-1318).

Proof 1, `bunx vitest run tests/unit/no-image.test.tsx tests/unit/illustrative-labels.test.tsx`: `Test Files 2 passed (2)`, `Tests 15 passed (15)`. `bun run check` exit 0 (eslint, knip, jscpd, stubs, prettier, unit and component projects).

Proof 2, step 6 on a fresh live build (`MSYS_NO_PATHCONV=1 VITE_API_BASE_URL=/api/public ... bun run build` exit 0; `data-services="live"` printed; preview port 8878):
```
1
1
coming_soon_global restored to false
```

Proof 3, step 7, `MOP_ENV=local`: `/` "What is real here" 1; `/california` "No property is listed in California yet." 0.
`MOP_ENV=production` (wrangler stopped by parent id, page cache removed, P-1312): `/` "What is real here" 0; `/california` empty state 1; `/properties` "No property is listed yet." 1; `/properties | grep -ci illustrative` 1 <- plan says 0.
`grep -aoi '[a-z0-9./-]*illustrative[a-z0-9./-]*'` on `/properties` finds only `/assets/illustrative-notice-CdH1IBQU.js`. With `/assets/<name>` removed (`sed 's#/assets/[A-Za-z0-9_.-]*##g'`), `/` and `/properties` both print 0.

UNPROVEN until step 9 lands (H59): the literal `grep -ci illustrative` printing 0 on `/properties` under production. Also UNPROVEN: e2e rows (f), (r) (g6); an open market with a photograph; `Gallery` and `Representation` status wording has no test of its own. Reviewer note, not changed (plan-literal): the home text hero with `ComingSoon scope="home"` shows whenever no property has a `heroRank`, even when one has a `featuredRank`; a ranking rule for B7.

Bank: P-1318 added (shared flag), P-1313 carries the ruling, P-094 hit again. Preview stopped by its parent process id; `.dev.vars` back to `MOP_ENV=local`.

## g7 · steps 9,10
Start commit c9d0e98 (slice/b3b after merging main), started 2026-10-04 22:50 +0300. Main merged first (clean: GOTCHAS, PROJECT-STATE, ASSUMED, build-slice). Files: `app/scripts/assert-coming-soon.mjs`, `app/tests/unit/assert-coming-soon.test.ts`, `app/docs/coming-soon.md`, `.github/workflows/deploy.yml`; by step text (P-513): `app/vite.config.ts` (H59). Beyond the step text, because the deploy step breaks B1b's pins (P-1320): `app/tests/unit/hygiene.test.ts` (`smokeAt === steps.length - 2` became `SMOKE_FROM_END`, production 3), `app/tests/mutations/B1b.json` (`hy-guard-rollback` find moved to start at the new step's tail), `app/tests/mutations/B3b.json` (7 entries). H59 is written as `build.rolldownOptions`, not `rollupOptions`: Vite 8.1.5's types mark `rollupOptions` `@deprecated Use rolldownOptions instead`. The output names apply to the SSR build too (`.output/server/_ssr/<hash>.mjs`); preset and worker name unchanged.

Proof 1, `bunx vitest run tests/unit/assert-coming-soon.test.ts`:
```
 Test Files  1 passed (1)
      Tests  5 passed (5)
```
Proof 2, H59 after the live build (`MSYS_NO_PATHCONV=1 VITE_API_BASE_URL=/api/public VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA bun run build`, exit 0; `grep -rl "Program Files/Git" .output/server .output/public | wc -l` 0):
```
$ grep -ci illustrative .output/public/index.html
grep: .output/public/index.html: No such file or directory      <- the SSR build writes no index.html (P-1319)
$ ls .output/public/assets | grep -c illustrative
0
$ node scripts/bundle-check.mjs
bundle-check: OK 20 routes under 153600 gzip bytes                (exit 0)
```
The served HTML stands in for `index.html`, under `MOP_ENV=production` on port 8878: `/` 0, `/properties` 0 (`curl -s ... | grep -ci illustrative`; g5 measured 1 on `/properties` before H59). Watched-fail: with `rolldownOptions` renamed away, `ls .output/public/assets | grep -c illustrative` printed 1; restored, 0. The `inlineDynamicImports option is ignored` warning prints with and without the change.

Proof 3, step 9 live (`settings` read first: `environment` "development", `coming_soon_global` false, 16 properties, 3 markets). `.dev.vars` `MOP_ENV=production`, copied, `wrangler dev ... --port 8878`:
```
$ bun scripts/with-coming-soon.ts --value true -- node scripts/assert-coming-soon.mjs http://127.0.0.1:8878
ok   coming-soon checks on http://127.0.0.1:8878
coming_soon_global restored to false
exit=0
$ node scripts/assert-coming-soon.mjs http://127.0.0.1:8878 --after-launch
ok   coming-soon checks on http://127.0.0.1:8878                  (exit 0)
$ node scripts/assert-coming-soon.mjs                            -> usage, exit 2; with --bogus -> usage, exit 2
```
Stopped by parent id (P-042), page cache removed (P-1312), `MOP_ENV=local`, restarted:
```
$ bun scripts/with-coming-soon.ts --value false -- node scripts/assert-coming-soon.mjs http://127.0.0.1:8878
FAIL no-illustrative
FAIL properties
FAIL markets
FAIL property-card
FAIL california
coming_soon_global restored to false
exit=1
```
Preview stopped by parent id; `netstat -ano | grep -c ":8878.*LISTENING"` 0; `.dev.vars` back to `MOP_ENV=local`.

Proof 4, watched-fail (`node scripts/watchfail.mjs --registry tests/mutations --only <id>`, one call each, after the last edit of the script): `WATCHED-FAIL OK B3b:` b3b-aa (plan (aa): `--after-launch` keeps property-card), b3b-acs-markets, b3b-acs-properties, b3b-acs-case, b3b-acs-status, b3b-acs-error, b3b-deploy-assert (the deploy step deleted; hygiene red on `dev and production wait, smoke their own address`); `WATCHED-FAIL OK B1b:` hy-guard-rollback (moved find), bf, hy-rollback-name, hy-smoke-order, hy-wait-fails, hy-smoke-wait-dev, hy-rollback-no-id. `--only bf` also replays `B8:bf`, a db entry, `BAD: wrong reason` without the dev profile (P-418), not this group's.

Proof 5, step 10 (from `app/`):
```
$ grep -n -B2 -A4 "assert-coming-soon" ../.github/workflows/deploy.yml
437-      # (H35 (4)); after the domain cut-over MOP_LAUNCHED keeps only the illustrative check. A failure is
438-      # rolled back below, never retried.
439:      - name: assert-coming-soon
440-        if: steps.guard.outputs.superseded != 'true' && vars.MOP_DB_PRODUCTION == 'true'
441:        run: node scripts/assert-coming-soon.mjs "$URL" ${{ vars.MOP_LAUNCHED == 'true' && '--after-launch' || '' }}
442-      - name: rollback
443-        if: failure() && steps.deploy.outcome == 'success'
444-        env:
445-          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
$ grep -rn "#[0-9a-fA-F]\{6\}" src/styles/components/coming-soon.css src/styles/components/consent.css   -> nothing
$ node -e "...matchAll(/.../g)..."      (the plan's line)
roots 0, bad 0                                                    (exit 1)  <- plan defect, P-1319
$ the same with /gm
roots 3, bad 0                                                    (exit 0)
$ GQ-05 flag-reader grep                                          -> nothing
$ grep -rn "googletagmanager\|google-analytics" src ... | grep -v "src/lib/ga4.ts\|src/server/lib/headers.ts"   -> nothing
$ scratch/actionlint/actionlint.exe -shellcheck= .github/workflows/deploy.yml   -> exit 0, no output (P-139)
```
No temporary flag found (`grep -rn "STUB(B3b\|TODO\|FIXME" src scripts tests` prints nothing). Docs: the two "Step 5's consent spec" lines now say step 8 and what it asserts (keyboard close lands on `#consent-change`; the pointer case is not asserted); launch checklist item 5 matches the script (check names, any-case illustrative, auto rollback, H59); new section on the `interest:` audience rule for B5 and B11.

Proof 6, gates in `app/`: `bun run check` exit 0 (`quiet: ok (48 lines)`); `bun run build` exit 0, `ls .output/public/assets | grep -c illustrative` 0, preset `cloudflare-module`, worker `matter-of-place`.

UNPROVEN: the deploy step itself runs only on a production deploy after L1's launch switch sets `MOP_DB_PRODUCTION` (H35 (4)); nothing pins its `if:` or the `MOP_LAUNCHED` switch except the grep above (the hygiene pin covers its place and its guard).
Bank: P-1319 (two proofs that cannot pass as written), P-1320 (deploy step vs B1b pins); P-1102, P-042, P-1312, P-1318 followed.

Handed-in commit: 7c26d75 (the work); this line is the commit after it.

## g5 · follow-ups recorded
The g5 review (steps 6,7) found no blocking defect. Gotcha entries added: P-1321 (`with-coming-soon.ts` spawns with `shell: true`, so a `bash -c` proof is split). Other follow-ups: 4, listed in `workspace/05-plans/logs/B3b-followups.md` under "g5 · steps 6,7". No code changed.

## g6 · follow-ups recorded
The g6 review (step 8) found no blocking defect. Gotcha entries added: P-1322 (batched watched-fail builds confound mutations on one observable), P-1323 (the implicit region role: the plan selector matches nothing). Other follow-ups: 5, listed in `workspace/05-plans/logs/B3b-followups.md` under "g6 · steps 8". The last one is for the operator: delete `E:/tmp-wr.log` by hand. No code changed.

## g7 · follow-ups recorded
The g7 review (steps 9,10) found no blocking defect. Gotcha entries added: P-1324 (H59's hash-only chunk names rename the SSR bundle, so G-025's proof named a file that no longer exists; G-025's proof line corrected to a count). Other follow-ups: 7, listed in `workspace/05-plans/logs/B3b-followups.md` under "g7 · steps 9,10". No code changed.
