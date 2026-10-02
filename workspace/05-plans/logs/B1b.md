
## g1 · steps 1-2
Step 1 (`.env` loaded without printing, E10):
- `bunx wrangler whoami` -> wrangler 4.146.0, Account API Token, account `Admin@matterofplace.com's Account`, id 5f55b1e09db48961c4366b73b188c7f9
- `gh auth status` -> logged in as AbdulrahmanAmer, scopes gist, read:org, repo, workflow
- `gh api user --jq .plan.name` -> empty (login lacks the `user` scope, P-048)
- `gh api repos/AbdulrahmanAmer/matter-of-place --jq .private` -> true
- workers subdomain API -> `{"result":{"subdomain":"holy-meadow-4327"},"success":true}`
- `gh api repos/.../branches/main/protection` -> HTTP 403 "Upgrade to GitHub Pro or make this repository public to enable this feature"
- toolchain matches E11 except wrangler: bunx resolved 4.146.0 (E11: 4.145.0). Step 9 decision: BLOCKED (P-028), recorded in app/docs/runbooks/delivery.md.
Step 2:
- `bun run build` -> built in 570ms; `node -e "...wrangler.json..."` -> `matter-of-place {"MOP_ENV":"production","MEDIA_PUBLIC_BASE":"https://matterofplace.com/media"} {"enabled":true}`
- `grep -n "queues\|browser\|images\|durable\|kv_namespaces" wrangler.toml` -> nothing (exit 1); the wider G-011 grep with secret|token|key also nothing
- The merge kept vars; vite.config.ts unchanged.
Gate: `bun run check` exit 0 (prettier fixed on the runbook), `bun run build` ok.
Note: runbook is at app/docs/runbooks/delivery.md (STANDARDS folder map: docs/ lives under the app); the brief said docs/runbooks/delivery.md.

Rework after review (wrangler.toml omitted plan line 117 content): added `compatibility_date = "2026-09-30"`, `compatibility_flags = ["nodejs_compat"]`, a commented `routes` block for Stage 5, and a marker comment for B8b's `[triggers] crons`. Step 1 proofs re-run, same results (private repo true, plan name empty for lack of the `user` scope, subdomain holy-meadow-4327 in the runbook).
- `bun run build` then `node -e "...c.name,c.compatibility_date,..."` ->
  `matter-of-place 2026-09-30 ["nodejs_compat"] {"MOP_ENV":"production","MEDIA_PUBLIC_BASE":"https://matterofplace.com/media"} {"enabled":true} undefined undefined`
  (before the fix the date printed 2026-10-02, the build day)
- `grep -n "queues\|browser\|images\|durable\|kv_namespaces" wrangler.toml` -> no output, exit 1
- `bun run check` -> exit 0 (4 tests passed)

## g2 · steps 2b
Code gates in place before any server code: eslint (strictTypeChecked, projectService, boundary blocks), tsconfig (`verbatimModuleSyntax`, `allowJs`), `tsconfig.scripts.json`, `vitest.config.ts` (`requireAssertions`), knip, jscpd, `scripts/stubs.ts`, `scripts/check-layout.mjs`, `tests/unit/{stubs,check-layout,boundaries}.test.ts`, `tests/mutations/B1b.json`, root `.gitignore` lines. `bd` (hygiene.test.ts) is recorded in step 5.
Baselines measured on the new config and cleared by fixing, deleting or using (no allow-list; the one disable is `route-error.tsx`, the described disable first kept in `use-track-view.ts` was removed in the g2 fix): lint 78 problems (19 `restrict-template-expressions`, 11 `no-unsafe-type-assertion`, 9 `require-await`, 5 `no-deprecated` (`FormEvent`), 7 `no-restricted-syntax` (Deno `.ts` extension in `src/domain`), 8 jsx-a11y, 4 `no-misused-promises`, 4 `no-base-to-string`, 2 `no-unsafe-assignment`, 2 `no-misused-spread`, 2 `no-unnecessary-condition`, 1 `consistent-type-imports`, 1 `no-console`, 1 undescribed disable); knip 1 unused file (`src/domain/index.ts`, deleted), 21 unused exports and 20 unused types (un-exported, or deleted when then unused); jscpd 1 clone of 80 tokens (`filter-bar.tsx` and `quick-filters.tsx`, now `FilterSelect`); layout baseline empty (558 files).
Proofs, in `app/`:
- `bun run check` -> exit 0: `layout: OK (558 files)`, typecheck, `eslint . --max-warnings 0`, knip (exit 0, 5 configuration hints only), `No duplicates found`, `stubs: 0 markers, 0 on closed slices`, `All matched files use Prettier code style!`, `Tests 30 passed (30)`
- `bun run build` -> `built in 793ms`, `.output/server/wrangler.json` generated
- `bunx vitest run tests/unit/stubs.test.ts tests/unit/check-layout.test.ts tests/unit/boundaries.test.ts` -> `Test Files 3 passed (3)  Tests 26 passed (26)`
- `bun run layout` -> `layout: OK (558 files)`
- `bun run lint` -> exit 0
- `bunx eslint --print-config src/server/jobs/steps/send-email.ts` -> `no-restricted-syntax` holds the three Deno selectors (message `Deno-loaded file: import with the .ts extension`), FETCH_SIGNAL (`CallExpression[callee.name='fetch'][arguments.length<2]`), FILTER_STRING, both WALL_CLOCK selectors and both HTML_SINK selectors in one array; `no-restricted-globals` holds `fetch`, `no-restricted-properties` holds `process.env`
- `node -p "require('./package.json').scripts.check"` -> `bun run layout && bun run typecheck && bun run lint && bun run knip && bun run jscpd && bun run stubs && bun run format:check && bun run test` (no `npm`)
- `/`, `/properties`, `/contact`, `/submit`, `/markets`, `/california` answer 200 under `bun run dev` after the component edits (dev server stopped, port 8080 free)
Watched-fails: every entry of `tests/mutations/B1b.json` applied, run, seen red for the stated reason, reverted, by a scratch runner (not committed; `scripts/watchfail.mjs` is B4's). Output of the last full pass:
- ab exit=1 `@typescript-eslint/no-floating-promises` (2:3 Promises must be awaited ...)
- ac exit=1 `@typescript-eslint/no-unsafe-member-access` (3:12 Unsafe member access .id on an `any` value)
- ad exit=1 `@typescript-eslint/switch-exhaustiveness-check` (Switch is not exhaustive. Cases not matched: "b")
- ae exit=1 `Unused eslint-disable directive (no problems were reported from 'no-console')`
- af exit=1 `no-console` (Unexpected console statement)
- ag exit=1 `Deno-loaded file: import with the .ts extension  no-restricted-syntax`
- ah exit=1 knip `unusedScratch  src/lib/cx.ts:5:14`
- ai exit=1 jscpd `Clone found (typescript)`
- aj exit=2 `scripts/scratch.mjs(10,1): error TS2554: Expected 2 arguments, but got 1.`
- ak exit=1 `Error: expected any number of assertion, but got none` (vitest requireAssertions); ak-lint exit=1 `Test has no assertions  vitest/expect-expect`
- al exit=1 `src/lib/scratch.ts:1 STUB(V1) slice is closed: scratch`
- ay exit=1 `layout: app/src/helpers/scratch.ts: outside the folder map`
- az exit=1 `R29: read time from ctx.now or a now argument, never Date.now()  no-restricted-syntax`
- ba exit=1 `'process.env' is restricted from being used. R14: read the environment in env.ts only`
- bb exit=1 `x holds no hex colour outside tokens.css, theme.gen.ts and the theme-color line (R42)`
- bc exit=1 `x holds no em dash anywhere under src (R46)`; bc-r06 exit=1 `x keeps browser code away from src/server and src/db`
- bi (stubs.test.ts) exit=1 `x fails naming file and line when the slice is closed`; bj (check-layout.test.ts) exit=1 `- "reason": "banned: secret", + "reason": "banned: secrets"`
- A first pass had `ak` wrong (my expected text said "at least one assertion"; vitest prints "expected any number of assertion, but got none"): fixed the registry, rerun red.
Plan notes: knip prints 5 configuration hints (`src/routeTree.gen.ts` and `src/db/types.ts` in `ignore`, `src/start.ts` and `supabase/functions/*/index.ts` entries with no match yet, `src/router.tsx` redundant) and exits 0; knip.json is kept as the plan wrote it. The measured baseline was larger than the plan's estimate (78 lint problems against about 56, 21 and 20 knip items against 12 and 11). `restrict-template-expressions` stays at the strict preset (numbers wrapped in `String()`). `@types/bun` resolved to 1.4.2 and knip to 6.39.0, jscpd 5.4.0. Eslint block (a) ignores `scripts/**` and the scripts block uses `project: ["./tsconfig.scripts.json"]` with `projectService: false`, because the project service resolves each file to the nearest `tsconfig.json`, which does not include `scripts/`.
Behaviour touched while clearing the baseline: the two overlays (`inquiry-dialog.tsx`, `search-overlay.tsx`) close on a click on the backdrop (`event.target === event.currentTarget`) instead of `stopPropagation` on the panel, and the `role="dialog"` of the search overlay moved to the panel; `autoFocus` became a ref callback `focusOnMount`; `services/http/client.ts` takes a response schema, parsed for real since the g2 fix (the first pass used an unchecked `trusted<T>()` stand-in), and merges headers through `Headers`; local services return `Promise.resolve`. B3 rewrites `client.ts`.

## g2 fix · step 2b
A fresh reviewer rejected g2 on six defects. All six were right. Fixes, each with the command that shows it:

1. `services/http/client.ts` hid the lint finding behind `trusted = <T>() => z.custom<T>()`, which validates nothing (`z.custom().parse(42)` returns 42). Now real response schemas: `propertySchema`, `marketSchema`, `storySchema` (their types are `z.infer`, same field names, in `src/domain/{property,market,story}.ts`) and `receiptSchema`, `submissionReceiptSchema`, `searchMatchSchema`, `conciergeAnswerSchema` in `contracts.ts`; the adapters in `services/http/index.ts` pass them, `trusted` is gone. This overrides the "plain TypeScript read-side types" line of the sketch ADR 0002 (already marked superseded in part). The schemas are inferred, so under `exactOptionalPropertyTypes` the types now read `field?: T | undefined`; `bun run typecheck` passes unchanged. B3 rewrites `client.ts` (`createApiClient(baseUrl, fetchImpl)`, `HttpServiceError`): it keeps the `shape` argument or says why not. `tests/unit/http-client.test.ts` is new: every bundled property, market and story parses back equal, a wrong body is refused, a valid body returns parsed, a 404 becomes a not-found `ServiceError`.
2. `contracts.ts` again exports `submissionStates`, `SubmissionState`, `editorialRoles` and `EditorialRole` (restored verbatim from `HEAD~1`), each with `@public` and a `// STUB(B2): ...` line above it. The slice log above did not mention the deletion; B2.md lines 52, 53 and 132 and review/B2, B6, B7, B8 name these constants. The other un-exported names (`inquiryIntents`, `supportedCurrencies`, `submissionMediaSchema`, `searchQuerySchema`, `conciergeQuestionSchema`) still exist in the file; B3 and B4 name `submissionMediaSchema` and `searchQuerySchema` and export them when they import them.
3. Gotcha bank: G-016, P-065, P-066, P-067, P-068 added to `GOTCHAS.md` (the plan's `projectService` for scripts; the 5 knip hints and the baselines that were larger than the plan said; the registry entries the runner could not replay; the stand-in validator and the deleted exports; `git checkout --` wiping uncommitted work). `node workspace/05-plans/check-gotchas.mjs` prints `check-gotchas: OK (16 path entries, 63 process entries)`.
4. `scripts/stubs.ts`: the `try { walk } catch { return [] }` is gone, so a missing or unreadable root fails the gate. The unit test's fixture now creates all three roots, and a new case runs the script in a folder with no `supabase` and `scripts` and expects a non-zero exit with `ENOENT`.
5. The log claimed one disable; the tree had two. `use-track-view.ts` no longer disables anything (`data` is held in a ref and read when the effect fires, the effect still runs once per `event` and `key`; `useEffectEvent` was tried first, `eslint-plugin-react-hooks` 5.2.0 does not know it). The first sentence of this log is corrected above.
6. `workspace/01-site-index/content-inventory.md` (note under the Contracts heading, the response schemas) and `pages-and-wording.md` (`getStrings()` is file-local) now match the code.

Registry (P-066): the 16 `kind: "create"` entries with an empty `find` are rewritten as `file` entries on tracked files with a `find` that occurs exactly once (ab to af on `src/lib/cx.ts`, ag on `src/domain/property.ts`, ai on `src/lib/catalog.ts`, aj and ay on `scripts/check-layout.mjs`, ak and ak-lint on `tests/unit/check-layout.test.ts`, al on `src/lib/cx.ts`); (ay) now breaks the folder map instead of adding an untracked file, which is the same gate seen from the other side. (ba) has no tracked file in its scope yet (`src/server/**` holds only a README), so it is `kind: "manual"` and not replayed. New entries bk, bl, bm (`http-client.test.ts`) and bn (`stubs.test.ts`). (bb) and (bc) now expect the assertion text, not the group title.

Proofs, in `app/` (real output):
- `bun run check` -> exit 0: `layout: OK (559 files)`, `eslint . --max-warnings 0` silent, knip exit 0 with the 5 configuration hints, `No duplicates found.`, `stubs: 2 markers, 0 on closed slices` (the two B2 markers), `All matched files use Prettier code style!`, `Test Files  5 passed (5)  Tests  36 passed (36)`
- `bun run build` -> exit 0, `built in 1.22s`, `built in 686ms`, `built in 522ms`, `.output/server/wrangler.json` present
- `bunx vitest run tests/unit/stubs.test.ts tests/unit/check-layout.test.ts tests/unit/boundaries.test.ts tests/unit/http-client.test.ts` -> `Test Files  4 passed (4)  Tests  32 passed (32)`
- `bun run layout` -> `layout: OK (559 files)`; `bun run lint` -> exit 0
- `bunx eslint --print-config src/server/jobs/steps/send-email.ts` -> 9 `no-restricted-syntax` selectors (three Deno, FETCH_SIGNAL, FILTER_STRING, two WALL_CLOCK, two HTML_SINK), `no-restricted-globals` holds `fetch`, `no-restricted-properties` is set
- `node -p "require('./package.json').scripts.check"` -> `bun run layout && bun run typecheck && bun run lint && bun run knip && bun run jscpd && bun run stubs && bun run format:check && bun run test`
- `git grep -n eslint-disable -- app/src ':!app/src/routeTree.gen.ts'` -> only `app/src/components/layout/route-error.tsx:9`
- `git grep -n -E "trusted|z\.custom" -- app/src` -> no hits
- `bun run dev`: `/`, `/properties`, `/markets`, `/california`, `/contact`, `/submit`, `/stories` and `/property/oak-hill-residence` answer 200 after the domain and hook edits; dev server stopped (port 8080 has no listener)
- `bunx eslint scripts/stubs.ts` -> exit 0; with `projectService: true` on that block -> `Parsing error: ... was not found by the project service` (G-016)

Watched-fails, every non-manual entry of `tests/mutations/B1b.json` replayed by a scratch runner outside the repository (reads the file, asserts `find` occurs exactly once, applies, runs, matches `expect`, restores the saved bytes):
- ab `Promises must be awaited` (no-floating-promises); ac `Unsafe member access .id on an `any` value`; ad `Switch is not exhaustive. Cases not matched: "b"`; ae `Unused eslint-disable directive (no problems were reported from 'no-console')`; af `Unexpected console statement`; ag `Deno-loaded file: import with the .ts extension`; ah `unusedScratch  src/lib/cx.ts:5:14`; ai `Clone found (typescript)`; aj exit 2 `scripts/check-layout.mjs(33,1): error TS2554: Expected 1 arguments, but got 0.`; ak `Error: expected any number of assertion, but got none`; ak-lint `Test has no assertions  vitest/expect-expect`; al `src/lib/cx.ts:5 STUB(V1) slice is closed: scratch`; ay `layout: app/src/hooks/use-async-action.ts: outside the folder map`; az `R29: read time from ctx.now or a now argument, never Date.now()`
- bb `holds no hex colour outside tokens.css, theme.gen.ts and the theme-color line (R42)`; bc `holds no em dash anywhere under src (R46)`; bc-r06 `keeps browser code away from src/server and src/db`; bi `fails naming file and line when the slice is closed`; bj `-     "reason": "banned: secret",`
- bk `AssertionError: promise resolved "{ id: 7 }" instead of rejecting` (client returns the body unparsed); bl `-   "featuredRank": 1,` (schema without a field the data has); bm `AssertionError: expected function to throw an error, but it didn't` (`price: z.any()`); bn `AssertionError: expected +0 not to be +0` (the catch put back)
- every entry exits non-zero before the restore; `git status --short` after the last run lists only the intended edits.
UNPROVEN: (ba) is recorded, not replayed (no tracked file in `src/server/**`); the schemas are checked against the bundled catalog only, not against a live API (none exists before B3); B4's `mutation-registry.test.ts` and `watchfail.mjs` do not exist yet, so replay by them is untested.

## g2 fix · step 2b
Second review round: two defects, both right.

1. The site index still documented domain names that g2 deleted. `content-inventory.md` section 6: the `CampaignTier`, `ListingStatus`, `PropertyType`, `SubmissionSource` and `StoryCategory` lists are replaced by a line naming `propertySchema` and `storySchema` (the enumerations are inline `z.enum` values), and the table rows carry the literal values (pipes escaped); `MarketGuide` and `Neighborhood` become the file-local `marketGuideSchema` and `neighborhoodSchema` headings, and `Region[]` the file-local `regionSchema` (`regions[]`), since none is an exported type. `appendix-data-copy.md`: the `regionSlugs` export, which `src/data/markets.ts` no longer has, is removed from the verbatim copy. `app/docs/database/schema.md` also names the old types; it is the superseded sketch (G-010) and was left alone.
2. Gotcha bank: P-069 (`useEffectEvent` type-checks and builds but `eslint-plugin-react-hooks` 5.2.0 has effect-event recognition compiled out, so the dependency warning stays) and P-070 (a Bash heredoc drops backslashes; the variant of P-008 that also cost the registry rework and, in this fix, six table cells) added to `GOTCHAS.md`.

Proofs (real output):
- `git grep -n -w -E 'CampaignTier|ListingStatus|PropertyType|SubmissionSource|StoryCategory|MarketGuide|regionSlugs' HEAD -- workspace/01-site-index | wc -l` -> `13` (before the fix); the same on the worktree over `workspace/01-site-index` -> `0`; over `app/src` -> `0`
- `git grep -n -F '\|' -- workspace/01-site-index/content-inventory.md | grep -c 'Estate'` -> `1` (the type row keeps its escapes; the first scripted edit had lost them)
- `node workspace/05-plans/check-gotchas.mjs` -> `check-gotchas: OK (16 path entries, 65 process entries)`
- P-069 watched: a scratch `useEffectEvent` hook under `app/src/hooks/` -> `10:6  warning  React Hook useEffect has a missing dependency: 'fire' ... react-hooks/exhaustive-deps`, `ESLint found too many warnings (maximum: 0).`, exit 1; `bunx eslint --max-warnings 0 src/hooks/use-track-view.ts` -> exit 0; scratch file deleted
- `bun run check` -> exit 0: `layout: OK (559 files)`, eslint silent, knip exit 0 with `Configuration hints (5)` only, `No duplicates found.`, `stubs: 2 markers, 0 on closed slices`, `All matched files use Prettier code style!`, `Test Files  5 passed (5)  Tests  36 passed (36)`
- `bun run build` -> exit 0, `built in 1.14s`, `built in 641ms`, `built in 459ms`, `Generated .output/server/wrangler.json`
Not touched: no code under `app/src`; the check and build are re-run as the proof that nothing moved.
