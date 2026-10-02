
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

## g3 · steps 3
Files: `src/server/lib/{log-events,log,pipeline,headers,error-page}.ts`, `src/server/seo/robots.ts`, `src/start.ts`, `public/_headers`, `tests/unit/{log,headers,pipeline}.test.ts`, `package.json` (devDependency `wrangler` pinned exactly 4.145.0, script `cf:preview`), `bun.lock`, `docs/runbooks/delivery.md`, git-ignored `.dev.vars`; `src/routeTree.gen.ts` regenerated by the build (it now registers `startInstance`). Gotchas G-017, G-018, P-073 added (`check-gotchas: OK (18 path entries, 71 process entries)`).
Plan lines that did not match reality, and what was done (none was built quietly):
1. `import { waitUntil } from "cloudflare:workers"` does not build (`Rolldown failed to resolve import "cloudflare:workers" from src/start.ts`, ssr service). Plan's own fallback used: `start.ts` takes the bound `waitUntil` that Nitro's `augmentReq` puts on the request, parsed with a zod schema; Start's dev server has none, so the fallback starts the promise. Measured under `wrangler dev`: the parse succeeded. B3 plan line 108 (`wait-until.ts` re-exporting `cloudflare:workers`) has the same defect.
2. `pipeline.ts` calls `captureException` from `sentry.ts`, which step 4 creates. Not built: `PipelineDeps` has a fourth member `report(error, { requestId, route })` that `handle` passes to `ctx.waitUntil`; `start.ts` supplies a stub marked `// STUB(B1b step 4): captureException from src/server/lib/sentry.ts`. Step 4 replaces the stub with a one-line closure over `captureException`.
3. `cf:preview` with `--env-file .dev.vars` does not load the file (P-073). Script is `cp .dev.vars .output/server/.dev.vars && wrangler dev --config .output/server/wrangler.json --port 8788`.
4. Nitro does not copy `public/_headers` unchanged: it appends its own `/assets/*` rule (G-017). A full `cmp` exits 1; the prefix compare `cmp -n "$(wc -c < public/_headers)" ...` exits 0. The security headers moved to a `/*` block; `/assets/*` and `/media/*` carry `Cache-Control` only.
5. A TanStack project with a start file loses the default CSRF middleware for server functions; `start.ts` registers `createCsrfMiddleware({ filter: ctx.handlerType === "serverFn" })` after the pipeline middleware, the same one TanStack applies when no start file exists.
6. The plan's inbound id test (`abc\nSet-Cookie: x`) cannot be built: `Headers` rejects a newline in a value. The test uses `abc; Set-Cookie: x`, a 65-character id, `abc` and a non-ASCII id.
7. `start.ts` reads only `MOP_ENV` (the others the plan lists, `SENTRY_DSN`, `SENTRY_RELEASE`, `SENTRY_TEST_TOKEN`, have no reader until step 4).
Proofs, in `app/` (real output):
- `bunx vitest run tests/unit/headers.test.ts tests/unit/pipeline.test.ts tests/unit/log.test.ts` -> `Test Files  3 passed (3)  Tests  68 passed (68)` (headers 13, pipeline 49, log 6; includes the stored-policy case and the replaced `Cache-Control` of G65; no network)
- `bun run build && cmp -n "$(wc -c < public/_headers)" public/_headers .output/public/_headers` -> build 0, `[nitro] Adding Nitro fallback to _headers to handle all unmatched routes.`, prefix cmp exit 0; the full `cmp public/_headers .output/public/_headers` -> `EOF on 'public/_headers' after byte 394, line 12`, exit 1 (Nitro's appended rule)
- `bun run cf:preview` in the background (wrangler 4.145.0), empty `.dev.vars`, bindings list `env.MOP_ENV ("production")`:
  - `curl -s -o /dev/null -D - -X POST http://127.0.0.1:8788/api/hooks/sentry-test | grep -i "cache-control\|HTTP/"` -> `HTTP/1.1 404 Not Found`, `Cache-Control: no-store`
  - two `curl -sI http://127.0.0.1:8788/ | grep -i x-request-id` -> `242dffa9-1062-49bb-9edf-45c81d0ec90b` and `882a7862-f6d9-477a-9a7d-65068ec816e9`
  - `curl -sI http://127.0.0.1:8788/ | grep -i "x-request-id\|x-frame-options\|content-security-policy-report-only"` -> all three present; the same on `/sitemap.xml` (`HTTP/1.1 200 OK`, a server route) -> all three present
  - `curl -sI http://127.0.0.1:8788/ | grep -ci x-robots-tag` -> 0; `curl -sI -H "Host: matterofplace.com" http://127.0.0.1:8788/ | grep -ci x-robots-tag` -> 0; `curl -sI -H "Host: pr-1.holy-meadow-4327.workers.dev" http://127.0.0.1:8788/ | grep -i x-robots-tag` -> `x-robots-tag: noindex, nofollow` (wrangler dev passes the `Host` header through)
  - `curl -sI http://127.0.0.1:8788/ | grep -i cache-control` -> `Cache-Control: public, max-age=0, must-revalidate`
  - assets: `/assets/index-*.js` -> `Cache-Control: public, max-age=31536000, immutable`, `x-content-type-options: nosniff`, `x-frame-options: DENY` (once each); `/media/tiburon-waterline.mp4` -> `Cache-Control: public, max-age=604800`, `x-content-type-options: nosniff`
- `MOP_ENV=local` in `.dev.vars`, stop, restart: log `Using secrets defined in .output\server\.dev.vars`; `curl -sI http://127.0.0.1:8788/ | grep -i x-robots-tag` -> `x-robots-tag: noindex, nofollow`; with `Host: matterofplace.com` -> 1 (follows `MOP_ENV`)
- `waitUntil`: a temporary probe log (removed) printed `PROBE waitUntil bound: true local` on every request under `wrangler dev`; Sentry's stored event (step 4) is the end-to-end proof that the promise ran
- stop: `stop-wrangler.ps1` (parent `node.exe` first, then `workerd`, P-042) printed `listeners on 8788: 0`; `Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction SilentlyContinue` -> `Get-NetTCPConnection rows: 0`
- `bun run dev`: `/` -> `HTTP/1.1 200`, `cache-control: public, max-age=0, must-revalidate`, `x-frame-options: DENY`, `x-request-id`; `/sitemap.xml` -> 200 with `x-request-id`; `/properties` -> 200; dev server stopped (port 8080 has no listener). No `X-Robots-Tag` there because `MOP_ENV` is unset and so counts as `production`.
- `bun run check` -> exit 0: `layout: OK (570 files)`, typecheck, `eslint . --max-warnings 0` silent, knip exit 0 with `Configuration hints (5)` (`src/start.ts` is now reported as a redundant entry pattern: TanStack's knip plugin finds it; `knip.json` is not in this group's files), `No duplicates found.`, `stubs: 5 markers, 0 on closed slices` (the two B2 markers and the three in `start.ts`), `All matched files use Prettier code style!`, `Test Files  8 passed (8)  Tests  104 passed (104)`
- `bun run build` -> exit 0, `built in 1.24s`, `built in 665ms`, `built in 566ms`, `Generated .output/server/wrangler.json`
Watched-fails, run by a scratch runner outside the repository (asserts `find` occurs exactly once, applies, runs, matches the text, restores the saved bytes; `git status` after shows only the intended files). Each exit 1 and red for the stated reason:
- (a) delete `frame-ancestors 'none'` -> `expected 'default-src \'self\'; script-src \'se…' to contain 'frame-ancestors \'none\''`
- (an) `maskEmails` returns its input -> `expected '/contact/x@y.com' to be '/contact/[email]'`
- (h) set `x-request-id` inside the render closure (before the cache stores it) -> `never stores the request id or a security header, and returns both`
- (i) drop `/api/admin/` from the never-cached prefixes -> `forces no-store on GET /api/admin/properties (an admin read)`
- (j) put `'nonce-abc'` in `script-src` -> `never uses a nonce, because HTML is cached`
- (k) `/assets/*` to `max-age=3600` in `public/_headers` -> `makes fingerprinted assets immutable for a year`
- (l) `hasPolicy = false` (always overwrite) -> `keeps the policy a hit carries and does not add the default beside it`
- (m) HSTS without `includeSubDomains` -> `sets HSTS to one year with subdomains and no preload`
- (n) drop the `preview` search parameter from `neverCached` -> `skips the cache hook and answers no-store for a preview token: /property/x?preview=t`
- (q) `isIndexableHost` returns true for every host -> `marks matter-of-place.holy-meadow-4327.workers.dev noindex under MOP_ENV production`; (q, workers.dev row only) drop the `.workers.dev` test -> `marks pr-1.holy-meadow-4327.workers.dev noindex under MOP_ENV production`
- (u) the calm 500 never answers HTML -> `answers a page request that accepts HTML with the HTML page and the id`
- (z) `isPageRequest` true for every pathname -> `keeps /robots.txt away from the cache hook and still adds the headers`
- (aa) `headers.append` instead of `headers.set` for `no-store` -> `replaces the handler's Cache-Control on POST /api/public/inquiries with exactly no-store (G65)`
- extra: `serverErrorHtml` without the escape -> `escapes the id in the HTML page`; `X-Frame-Options: SAMEORIGIN` in `_headers` -> `carries the same security headers as the Worker on every static file`; the pipeline returning a copy of the response -> `is the one the render produced, so a router redirect keeps its options`
NOT DONE: `tests/mutations/B1b.json` has no entry for these tests (the file is not in this group's list); the scratch spec holds them all (ids a, an, h, i, j, k, l, m, n, q, q-workers, u, z, aa, x-escape, x-static-security, x-redirect) and the orchestrator can add them in the registry's format.
UNPROVEN: `waitUntil` running a promise to completion in a deployed Worker (step 4's Sentry event); that Cloudflare's production asset worker keys `_headers` rules by path as `wrangler dev` does (step 6's smoke on a preview checks `/assets/*` headers); `.dev.vars` left as `MOP_ENV=local` at the end, as step 6 expects.

## g3 · steps 3 (fix round after the reviewer's rejection)
Six defects fixed; every proof re-run. Files touched: `app/tests/mutations/B1b.json`, `GOTCHAS.md`, `app/src/server/lib/pipeline.ts`, `app/tests/unit/pipeline.test.ts`, `app/tests/unit/headers.test.ts`, `app/knip.json`, `app/public/_headers`, `app/docs/runbooks/delivery.md`.
1. Registry (R49, C08): 24 entries added to `tests/mutations/B1b.json` (ids a, j, k, k-assets, x-static-security, m, an, log-mask-field, log-level, h, i, l, n, q, q-workers, q-lowercase, q-port, u, u-message, z, aa, aa-nonpage, x-escape, x-redirect). A throwaway runner (outside the repository) asserts `find` occurs exactly once, applies, runs, matches `expect`, restores the saved bytes: `replayed 24, all red for the stated reason`, tree unchanged afterwards (`git status --short` identical before and after).
2. Bank: G-019 (TanStack drops its server-function CSRF check once `src/start.ts` exists), P-074 (plan step called a module a later step creates), P-075 (`Headers` rejects a newline), P-076 (`vi.spyOn` over a union gives an `any` parameter; reproduced: `no-unsafe-argument`), P-077 (wrangler pin vs `bunx` outside `app/`: 4.145.0 in `app/`, 4.146.0 outside; the runbook table already names 4.145.0 as the pin), P-078 (plan body shape vs R09), P-079 (a group that adds tests owns the registry). G-017 rewritten with the measurement below. `node workspace/05-plans/check-gotchas.mjs` -> `check-gotchas: OK (19 path entries, 77 process entries)`.
3. R09: the calm 500 JSON is now `{ error: { code: "server", message: "Something went wrong. Please try again in a moment.", requestId } }`. PLAN LINES NOW STALE, for the orchestrator (not my files): B1b.md line 126 (the pipeline file line) and line 176 (step 4 curl proof) give the shape without `message`; B1b.md step 4 proof still matches by `code` and `requestId`. Registry entry `u-message` turns the JSON case red.
4. Tests that could not fail: `pipeline.test.ts` gained noindex rows `Pr-1.HOLY-MEADOW-4327.WORKERS.DEV` (production) and `pr-1.holy-meadow-4327.workers.dev:443` (production), and a case that `/api/public/markets` and `/sitemap.xml` keep their own `Cache-Control`. Watched-fail, each red for the stated reason: `q-lowercase` (`marks Pr-1.HOLY-MEADOW-4327.WORKERS.DEV noindex under MOP_ENV production`), `q-port` (`marks pr-1.holy-meadow-4327.workers.dev:443 noindex under MOP_ENV production`), `aa-nonpage` (`leaves the Cache-Control of /sitemap.xml alone, because it is not a page`).
5. `knip.json`: `src/start.ts` removed from `entry`; `bun run knip` now prints `Configuration hints (4)` and none names `src/start.ts` (the four left belong to `routeTree.gen.ts`, `db/types.ts`, `supabase/functions` and `router.tsx`, outside this step).
6. `public/_headers`: MEASURED, not inferred. In the built `.output/public/_headers` our `/assets/*` block set to `max-age=3600` (Nitro's appended block left at `max-age=31536000, immutable`), `wrangler dev` restarted: `curl -sI /assets/index-CjMsGoTQ.js | grep -i cache-control` -> `Cache-Control: public, max-age=31536000, immutable`. Our block is dead text, so it is removed; the file now holds `/*` and `/media/*`. `headers.test.ts` asserts there is no `/assets/*` block (entry `k-assets`), and `k` now mutates `/media/*`. The immutable lifetime of assets is Nitro's rule and stays UNPROVEN on Cloudflare's production asset worker until step 6's smoke on a preview.
Deviation from the step 3 proof: `cmp public/_headers .output/public/_headers` exits 1 (`EOF on 'public/_headers' after byte 330, line 9`) because Nitro appends its `/assets/*` rule (G-017); the prefix compare exits 0.
Proofs, in `app/` (real output):
- `bunx vitest run tests/unit/headers.test.ts tests/unit/pipeline.test.ts` -> `Test Files  2 passed (2)  Tests  65 passed (65)`; `bunx vitest run tests/unit/log.test.ts` -> `Tests  6 passed (6)`
- `bun run build` -> exit 0, `Adding Nitro fallback to _headers to handle all unmatched routes.`; `cmp -n "$(wc -c < public/_headers)" public/_headers .output/public/_headers` -> exit 0
- `bun run cf:preview` (wrangler 4.145.0), empty `.dev.vars`: POST `/api/hooks/sentry-test` -> `HTTP/1.1 404 Not Found`, `Cache-Control: no-store`; two `x-request-id` -> `21e94560-2030-4f17-a3bc-ec27fb1e139e`, `f0c209ec-4937-4324-8162-516be89a6fd0`; `/` and `/sitemap.xml` each carry `x-request-id`, `X-Frame-Options: DENY`, `Content-Security-Policy-Report-Only`; `grep -ci x-robots-tag` on `/` -> `0`, with `Host: matterofplace.com` -> `0`, with `Host: pr-1.holy-meadow-4327.workers.dev` -> `x-robots-tag: noindex, nofollow`; `/assets/index-*.js` -> `Cache-Control: public, max-age=31536000, immutable` once, `x-content-type-options: nosniff`, `x-frame-options: DENY`; `/media/tiburon-waterline.mp4` -> `Cache-Control: public, max-age=604800`; `/` -> `Cache-Control: public, max-age=0, must-revalidate`
- `.dev.vars` = `MOP_ENV=local`, restart: `Using secrets defined in .output\server\.dev.vars`; `curl -sI http://127.0.0.1:8788/ | grep -i x-robots-tag` -> `x-robots-tag: noindex, nofollow`
- stop: `listeners on 8788: 0`; `Get-NetTCPConnection rows: 0`
- registry replay of the 24 new entries -> `replayed 24, all red for the stated reason`
- `bun run check` -> exit 0: `layout: OK (570 files)`, eslint silent, `Configuration hints (4)`, `Found 0 clones.`, `stubs: 5 markers, 0 on closed slices`, `All matched files use Prettier code style!`, `Test Files  8 passed (8)  Tests  107 passed (107)`
- `bun run build` -> exit 0, `built in 1.16s`, `built in 628ms`, `built in 502ms`, `Generated .output/server/wrangler.json`
UNPROVEN: `waitUntil` running a promise to completion in a deployed Worker (step 4's Sentry event); `/assets/*` immutable header on Cloudflare's production asset worker (step 6 smoke). `.dev.vars` is left as `MOP_ENV=local` (git-ignored), which step 6 expects.

## g4 · steps 3b-4

Built: `src/server/lib/crypto.ts` (step 3b, CS-04), `src/server/lib/sentry.ts`, `src/routes/api/hooks/sentry-test.ts` (step 4), their three unit tests, the Sentry section of `docs/runbooks/delivery.md`. `log-events.ts` already held `sentry_send_failed` (g3), so it is unchanged.

Files touched outside the group's list, and why (the same defect as GOTCHAS P-079: the list was copied from the plan's file lines):
- `src/start.ts`: the `STUB(B1b step 4)` above `report` is replaced by `captureException` (P-074 said this step replaces it); without it the step's live proof cannot pass.
- `tests/mutations/B1b.json`: 20 entries for the three new test files (R49, C08).
- `src/routeTree.gen.ts`: regenerated by `bun run build` for the new route (G-001, not edited by hand).
- `GOTCHAS.md`: G-020 and P-080.

Deviations from the plan text:
- `captureException` takes the DSN in its options (`dsn: string | undefined`): the plan's signature has none and R14 forbids `sentry.ts` reading the environment; `start.ts` passes `process.env.SENTRY_DSN`.
- `hmacSha256(key, message: string | Uint8Array)`: RFC 4231 cases 3 and 4 hash binary data, which a `string` message cannot carry; webhooks also sign raw bytes (R36).
- `scrubEvent` is an allow-list, and always adds `sdk.settings.infer_ip: "never"` and `user: { geo: {} }`: the first two stored events carried the laptop's IP, then city and country (GOTCHAS G-020).
- The route answers 404 with an empty body: R09's error body needs a request id the route does not receive from the pipeline. The 500 body has `message` (P-078); the plan's step 4 line still shows the shorter shape.

Proofs, in `app/` (real output):
- `bunx vitest run tests/unit/log.test.ts tests/unit/crypto.test.ts` -> `Test Files  2 passed (2)  Tests  21 passed (21)`
- `grep -rn "crypto.subtle" src | grep -v "src/server/lib/crypto.ts"` -> nothing (`grep-exit=1`)
- `bunx eslint --print-config <file> | grep -c 'Deno-loaded file: import with the .ts extension'` -> `log.ts: 3`, `log-events.ts: 3`, `crypto.ts: 3`, `sentry.ts: 3`
- `bunx vitest run tests/unit/sentry.test.ts tests/unit/sentry-test-route.test.ts` -> `Test Files  2 passed (2)  Tests  19 passed (19)`
- `app/.dev.vars` written from `.env` without printing: `MOP_ENV length 5`, `SENTRY_DSN length 95`, `SENTRY_TEST_TOKEN length 64`; `bun run build` exit 0; `bun run cf:preview` -> `Using secrets defined in .output\server\.dev.vars`, `Ready on http://127.0.0.1:8788`
- `curl -s -X POST -H "authorization: Bearer $PREVIEW_SENTRY_TEST_TOKEN" http://127.0.0.1:8788/api/hooks/sentry-test` -> `HTTP/1.1 500 Internal Server Error`, `Cache-Control: no-store`, `x-request-id: 6148718c-c5ed-40ec-86e5-280b9ffdfb1c`, body `{"error":{"code":"server","message":"Something went wrong. Please try again in a moment.","requestId":"6148718c-c5ed-40ec-86e5-280b9ffdfb1c"}}`; a wrong bearer -> `404`
- issues query `request_id:6148718c-...` -> `poll 1: issues 0`, `poll 2: issues 0`, `poll 3: issues 1` (issue `7767612319`, `SentryTestError: Sentry test error for [email]`)
- events query `&full=true` -> `events 1`; tags `{"request_id":"6148718c-c5ed-40ec-86e5-280b9ffdfb1c","env":"local","release":"dev","side":"worker","route":"/api/hooks/sentry-test"}`; `user null`; `request entry false`; `grep -c "ip_address\|cookie\|authorization"` -> `0`; `test@example.com` occurrences `0`, `[email]` occurrences `3`; `Cairo` 0, `country_code` 0, `"headers"` 0
- The same reads before the fix (stored, not hidden): request `dae6c4fc-...` -> `user {"ip_address":"<laptop IP>","geo":{"country_code":"EG","city":"Cairo",...}}`, grep count `1`; request `0ce0a23d-...` (with `infer_ip: "never"`) -> `ip_address":null` but geo still `Cairo`, grep count `1`.
- stop (P-042): `parents stopped: 2`, `listeners on 8788: 0`, `workerd left: 0`; `Get-NetTCPConnection -LocalPort 8788 -State Listen` count `0`
- watched-fail, replayed from `tests/mutations/B1b.json` with saved bytes restored (`cmp` equal after): (am) `TypeError: crypto.subtle.timingSafeEqual is not a function`; `crypto-length`, `crypto-hmac`, `crypto-sha256`, `crypto-base64url`, `crypto-open-null` red; (b) `to not have property "request"`; (e) `expected { name: 'Jane Example', …(2) } to deeply equal { geo: {} }`; (r) `Error: Test timed out in 5000ms.`; (au) `expected "vi.fn()" to be called 1 times, but got 100 times`; `sentry-pause`, `sentry-mask`, `sentry-truncate` (`got 419`), `sentry-infer-ip`, `sentry-side`, `sentry-no-dsn`, `sentry-failed-log`, `route-compare`, `route-scheme`, `route-throw` red -> `replayed, 0 not red`
- runbook: `curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" ".../keys/" | node -e "...map(k=>k.name).join(',')"` -> `job-runner,Default`; `job-runner active true rateLimit {"window":3600,"count":20}`, `Default active true rateLimit {"window":3600,"count":50}`; project `quotas:spike-protection-disabled false`, `scrubIPAddresses false`
- `node workspace/05-plans/check-gotchas.mjs` -> `check-gotchas: OK (20 path entries, 78 process entries)`
- `bun run check` -> exit 0: `layout: OK (576 files)`, eslint silent, knip `Configuration hints (4)` (the four from g3), `Found 0 clones.`, `stubs: 4 markers, 0 on closed slices`, `All matched files use Prettier code style!`, `Test Files  11 passed (11)  Tests  141 passed (141)`
- `bun run build` -> exit 0, `built in 1.18s`, `built in 637ms`, `built in 472ms`, `Generated .output/server/wrangler.json`

UNPROVEN: `waitUntil` finishing the report on a deployed Worker (proved under `wrangler dev` only; step 7's production test); `crypto.ts` under Deno (B3 step 3b's `deno check`). `.dev.vars` is left with `MOP_ENV=local`, `SENTRY_DSN` and `SENTRY_TEST_TOKEN` (git-ignored).

## g4 · steps 3b-4

Fix round after the review of `0e39bc9` (seven defects).

What changed:
- `crypto.ts`: each of the nine `/** @public */` exports now has its `// STUB(<slice>): first used by ...` line above it (invariant 16, R04, C04): `hmacSha256`, `sha256Hex`, `fromBase64`, `toBase64Url`, `randomToken` B3; `aesGcmSeal`, `aesGcmOpen` B5; `toHex` B8; `sha1Bytes` B15. When that slice closes without using the export, `bun run stubs` fails.
- `crypto.test.ts`: `sha1Bytes` has the FIPS 180-2 vector for `abc`; two seals of one message with one key differ in IV and ciphertext and are 12 + n + 16 bytes long (nonce reuse is red now).
- `sentry.test.ts`: the default fingerprint is tested term by term (same message from another route, another error class at the same frame, another first frame: two sends each); the pause window is tested at 60 and 120 seconds for both `Retry-After` and `X-Sentry-Rate-Limits` (`30:transaction:key, 120:error:key` takes the longest); a tag value with an address arrives as `[email]`; frames arrive oldest first.
- STANDARDS over the plan (R11, folder map row `src/routes/`): B1b line 131 puts the bearer check in the route file, STANDARDS says an API route file is one wrapper line, and STANDARDS binds. The logic moved to `src/server/hooks/sentry-test.ts` (`handleSentryTest(request, token)`, folder map domain `hooks`, as B3's `hooks/resend.ts` and B8's `hooks/ops-health.ts`); the route file is `POST: ({ request }) => handleSentryTest(request, process.env["SENTRY_TEST_TOKEN"])`. Orchestrator: B1b line 131 is stale.
- `GOTCHAS.md`: P-081 (registry `find` from the formatted file, `expect` from real output, vitest truncates titles at about 80 characters, measured in this round), P-082 (`JSON.parse` and string rejections in tests), G-021 (a new route file fails tsc until a build regenerates the route tree).

Files touched outside the group's list, and why: `src/server/hooks/sentry-test.ts` (new, the R11 move above); `tests/mutations/B1b.json` (route entries now point at the moved file, nine new entries for the new tests, R49, P-079); `GOTCHAS.md` (standing order, C25).

Handoff to the orchestrator (plans this group may not edit):
- `captureException` takes `dsn: string | undefined` as a required key (R14: `sentry.ts` reads no environment). Stale plan lines: B8.md:124 ("gains the optional `dsn`": it exists; B8 passes `dsn: Deno.env.get("SENTRY_DSN")`, which already type-checks, B8.md:66); B3.md:89 (`{ requestId, route }`: also needs `env`, `release`, `dsn`), B3.md:95 (needs `dsn`), B17.md:16 (`{ route }`: needs `requestId`, `env`, `release`, `dsn`), B8b.md:127 (`{ ...opts, route: "keepwarm" }`: `opts` must carry `requestId`, `env`, `release`, `dsn`), B5.md:59 already passes `dsn` from `ctx.env.SENTRY_DSN`. Each will fail `tsc` when built as written, which is the safe failure; the plan text should say the real shape.
- Ruling needed (R09): the 404 of `sentry-test` has an empty body because `handle` (g3's `pipeline.ts`) passes the original request to `deps.render` and the handler never sees the minted request id. Either the pipeline hands the id to render (g3's file), or R09 exempts this inert 404. The response does carry `x-request-id`.

Proofs, in `app/` (real output):
- `bunx vitest run tests/unit/log.test.ts tests/unit/crypto.test.ts` -> `Test Files  2 passed (2)  Tests  23 passed (23)`
- `grep -rn "crypto.subtle" src | grep -v "src/server/lib/crypto.ts"` -> nothing (`lines: 0`)
- `bunx vitest run tests/unit/sentry.test.ts tests/unit/sentry-test-route.test.ts` -> `Tests  26 passed (26)`
- `.dev.vars` compared with `.env` without printing: `dsn matches .env`, `token matches .env`, `MOP_ENV=local`; `bun run build` exit 0; `bun run cf:preview` -> `Using secrets defined in .output\server\.dev.vars`, `Ready on http://127.0.0.1:8788`
- `curl -s -X POST -H "authorization: Bearer $PREVIEW_SENTRY_TEST_TOKEN" http://127.0.0.1:8788/api/hooks/sentry-test` -> `HTTP 500`, `{"error":{"code":"server","message":"Something went wrong. Please try again in a moment.","requestId":"ce9420b9-0ce3-4a00-9dd1-6eb44a411e6e"}}`, `Cache-Control: no-store`, `x-request-id: ce9420b9-0ce3-4a00-9dd1-6eb44a411e6e`; wrong bearer -> `HTTP 404`
- issues query `request_id:ce9420b9-...` -> `issues: 1 (after 1 polls)`, `issue id: 7767612319`; events query `&full=true` -> `events: 1`, tags `request_id/env/release/side: ce9420b9-0ce3-4a00-9dd1-6eb44a411e6e local dev worker`, `user: null`, `request entry: none`, `exception value: SentryTestError | Sentry test error for [email]`, `ip/cookie/authorization count: 0`, `email count: 0`
- stop (P-042): `stopped node.exe 23000`, `stopped node.exe 8956`, two `workerd` stopped, `listeners on 8788: 0`, `workerd left: 0`
- keys: `curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" ".../keys/" | node -e "...map(k=>k.name).join(',')"` -> `job-runner,Default`; `job-runner {"window":3600,"count":20} active true`, `Default {"window":3600,"count":50} active true`; the runbook table lists both with these limits
- watched-fail, every g4 entry of `tests/mutations/B1b.json` replayed (find asserted once, saved bytes restored): `replayed 29, failures 0`, among them (am), (b), (e), (r), (au) and the new `crypto-iv`, `crypto-sha1`, `sentry-fp-route`, `sentry-fp-class`, `sentry-fp-frame`, `sentry-retry-after`, `sentry-rate-limits`, `sentry-tag-mask`, `sentry-frame-order`; the reviewer's five mutations of `sentry.ts` and two of `crypto.ts` are among them and are red
- `node workspace/05-plans/check-gotchas.mjs` -> `check-gotchas: OK (21 path entries, 80 process entries)`
- `bun run check` -> exit 0: `layout: OK (577 files)`, eslint silent, knip `Configuration hints (4)` (g3's), `Found 0 clones.`, `stubs: 13 markers, 0 on closed slices`, `All matched files use Prettier code style!`, `Test Files  11 passed (11)  Tests  150 passed (150)`
- `bun run build` -> exit 0, `built in 2.22s`, `built in 1.60s`, `built in 1.08s`, `Generated .output/server/wrangler.json`

UNPROVEN: `waitUntil` finishing the report on a deployed Worker (proved under `wrangler dev` only; step 7); `crypto.ts` under Deno (B3 step 3b's `deno check`). `.dev.vars` is left with `MOP_ENV=local`, `SENTRY_DSN` and `SENTRY_TEST_TOKEN` (git-ignored).

## g4 · steps 3b-4

Second fix round, after the review of `00b78f2` (four defects).

What changed:
1. `sentry.ts` never throws on the thrown value. `String()` of a null-prototype object, a throwing `message` getter and a proxy whose `getPrototypeOf` throws (so `instanceof` throws) each made `captureException` reject. New `describeThrown(error)` reads type, message and stack inside its own try, before the fingerprint is recorded; a value it cannot read becomes type `typeof value` and the text `unprintable value`; an Error whose `name` or `message` is not a string is converted with `String()` (typed `unknown` on purpose, so lint accepts the conversion). Four new cases in `sentry.test.ts`; registry entries `sentry-unprintable` and `sentry-non-string`.
2. R09 on the `sentry-test` 404: NOT FIXED, ruling still needed. The body stays empty because `handle` (g3's `pipeline.ts`) calls `deps.render(request)` and no handler can know the id the pipeline mints; the fix needs a file outside this group (for example `render: (request, requestId)` in `PipelineDeps`, with `start.ts` passing the id to the route through TanStack's request context), or R09 exempts this inert 404. The status of this group is therefore `partial` (P-079), not `done`.
3. Bank: P-083 (a plan's "route file does X" line checked against R11 and the folder map, the move of the bearer check), P-084 (five plans call `captureException` without `dsn`, `env` or `release`), G-022 (an API route file with no `GET` handler answers `GET` with 200 and the page shell), G-023 (the "never throws" defect above).
4. `routes/api/hooks/sentry-test.ts` carries `// STUB(B3): SENTRY_TEST_TOKEN read through src/server/lib/env.ts (R14), as start.ts reads MOP_ENV`. Handoff to B3: `start.ts` reads `MOP_ENV`, `SENTRY_DSN` and `SENTRY_RELEASE` from `process.env` the same way, and has no marker for it (not this group's file). The `GET` answer of 200 with the page shell is measured below and recorded in the runbook and G-022; which owner turns unhandled methods on API routes into an R09 404 or 405 is for the orchestrator.

Files touched outside the group's list: `tests/mutations/B1b.json` (two entries, P-079), `GOTCHAS.md` (standing order).

Proofs, in `app/` (real output):
- red before the fix: `bunx vitest run tests/unit/sentry.test.ts` -> `× resolves and sends one event for a null-prototype object`, `AssertionError: promise rejected "TypeError: Cannot convert object to primi…" instead of resolving`; the same for `an Error whose message getter throws` (`promise rejected "Error: no message"`) and `a proxy that refuses instanceof` (`promise rejected "Error: no prototype"`); `Tests  3 failed | 19 passed (22)`
- `bunx vitest run tests/unit/log.test.ts tests/unit/crypto.test.ts` -> `Test Files  2 passed (2)`, `Tests  23 passed (23)`
- `grep -rn "crypto.subtle" src | grep -v "src/server/lib/crypto.ts"` -> nothing (`lines: 0`)
- `bunx eslint --print-config <file> | grep -c 'Deno-loaded file: import with the .ts extension'` -> `log.ts: 3`, `log-events.ts: 3`, `crypto.ts: 3`, `sentry.ts: 3`
- `bunx vitest run tests/unit/sentry.test.ts tests/unit/sentry-test-route.test.ts` -> `Test Files  2 passed (2)`, `Tests  30 passed (30)`
- `.dev.vars` compared with `.env` without printing: `dsn matches .env`, `token matches .env`, `MOP_ENV=local`, git-ignored; `bun run build` exit 0; `bun run cf:preview` -> wrangler 4.145.0, `Using secrets defined in .output\server\.dev.vars`, `Ready on http://127.0.0.1:8788`
- `curl -s -X POST -H "authorization: Bearer $PREVIEW_SENTRY_TEST_TOKEN" http://127.0.0.1:8788/api/hooks/sentry-test` -> `HTTP/1.1 500 Internal Server Error`, `Cache-Control: no-store`, `x-request-id: 7c65fe41-cf31-4548-a90f-a49737b59d29`, body `{"error":{"code":"server","message":"Something went wrong. Please try again in a moment.","requestId":"7c65fe41-cf31-4548-a90f-a49737b59d29"}}`
- wrong bearer -> `HTTP/1.1 404 Not Found`, `Content-Length: 0`, `x-request-id: ae98fe08-...`, body bytes 0 (the open R09 point)
- `GET` on the same path -> `HTTP/1.1 200 OK`, `Content-Type: text/html; charset=utf-8`, `Cache-Control: no-store`, `x-robots-tag: noindex, nofollow`, body bytes 6807; `/api/hooks/nothing-here` -> `404 text/html; charset=utf-8`
- issues query `request_id:7c65fe41-...` -> `poll 1: issues 1`, issue `7767612319 | SentryTestError: Sentry test error for [email]`; events query `&full=true` -> `events 1`, tags `{"request_id":"7c65fe41-cf31-4548-a90f-a49737b59d29","env":"local","release":"dev","side":"worker"}`, `user null`, `request entry false`, `exception SentryTestError | Sentry test error for [email]`, `ip/cookie/authorization count: 0`, `test@example.com count: 0`, `[email] count: 3`
- stop (P-042): `stopped node.exe 10560`, `stopped node.exe 22104`, `listeners on 8788: 0`, `workerd left: 0`
- keys: `curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" ".../keys/" | node -e "...map(k=>k.name).join(',')"` -> `job-runner,Default`; `job-runner {"window":3600,"count":20} active true`, `Default {"window":3600,"count":50} active true`; the runbook table lists both with these limits
- watched-fail, every g4 entry of `tests/mutations/B1b.json` replayed by a scratch runner outside the repository (find asserted once, saved bytes restored, `git status` unchanged): `replayed 31, failures 0`, among them (am) `TypeError: crypto.subtle.timingSafeEqual is not a function`, (b) `to not have property "request"`, (e) `× lets no personal data through and keeps the request id`, (r) `× gives up on a fetch that never answers after 2 seconds 5003ms`, (au) `× sends 100 identical throws within a minute once, and again after 61 seconds`, and the new `sentry-unprintable` (`× resolves and sends one event for a null-prototype object`) and `sentry-non-string` (`× sends an Error whose name and message are not strings`)
- `cd app && bunx tsc -p tsconfig.json --noEmit` with a scratch call without `dsn` -> `TS2345 ... Property 'dsn' is missing ... but required in type 'CaptureOptions'`, exit 2; scratch file removed
- `node workspace/05-plans/check-gotchas.mjs` -> `check-gotchas: OK (23 path entries, 82 process entries)`
- `bun run check` -> exit 0: `layout: OK (577 files)`, eslint silent, knip `Configuration hints (4)` (g3's), `Found 0 clones.`, `stubs: 14 markers, 0 on closed slices`, `All matched files use Prettier code style!`, `Test Files  11 passed (11)`, `Tests  154 passed (154)`
- `bun run build` -> exit 0, `built in 1.42s`, `built in 699ms`, `built in 464ms`, `Generated .output/server/wrangler.json`

NOT DONE: the R09 body of the 404 (ruling needed, item 2). UNPROVEN: `waitUntil` finishing the report on a deployed Worker (proved under `wrangler dev` only; step 7); `crypto.ts` under Deno (B3 step 3b's `deno check`). `.dev.vars` is left with `MOP_ENV=local`, `SENTRY_DSN` and `SENTRY_TEST_TOKEN` (git-ignored).
