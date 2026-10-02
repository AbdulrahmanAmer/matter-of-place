
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

## g4 close-out · steps 3b-4

Rulings ASSUMED H39 (1), (2), (3) and (5) applied; (4) marked. Files: `src/server/lib/pipeline.ts`, `src/start.ts`, `src/routes/api/hooks/sentry-test.ts`, `src/server/hooks/sentry-test.ts`, `src/server/lib/sentry.ts`, `tests/unit/{pipeline,sentry-test-route,sentry}.test.ts`, `tests/mutations/B1b.json`, `docs/runbooks/delivery.md`, `GOTCHAS.md`.

What changed:
- H39 (1): `PipelineDeps.render(request, requestId)`; `start.ts` calls `next({ context: { requestId } })` and types the middleware `.server<{ requestId: string }>`, so the route file reads `context.requestId` (tsc checks it through the generated `Register`). `handleSentryTest(request, requestId, token)` answers every refusal with the R09 404 `{ "error": { "code": "not_found", "message": "There is nothing at this address.", "requestId" } }`. The body helper is `errorJson(status, code, requestId)` in `pipeline.ts` (always `no-store`); the calm 500 JSON uses it too, same body as before. B3's `toErrorResponse` in `errors.ts` takes it over (the file is B3's, so it was not created early, P-074).
- H39 (2): `apiShellGuard` in `handle()`, after render and before the headers: a pathname under `/api/` with a `text/html` answer (content type compared lower-cased) becomes R09 JSON with `no-store`, 405 `method_not_allowed` when it rendered 200, otherwise its own status with `not_found`.
- H39 (3): `sentry.ts` cuts the message (and a thrown non-Error) to 2,000 characters, the error name to 500, the stack to its first 50 lines and each line to 500 characters before `maskEmails` or the frame reader runs. The frame pattern `^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$` (two lazy groups) is replaced by `frameOf`, string operations plus `^\d+$` on the two numbers. The name cap is one step beyond the ruling's words (message and stack): the name is browser text too and `maskEmails` runs over it.
- H39 (4): `start.ts` reads `MOP_ENV`, `SENTRY_DSN` and `SENTRY_RELEASE` in one `workerEnv()` with `// STUB(B3): MOP_ENV and sentryOptions() from src/server/lib/env.ts (R14, ASSUMED H39 (4))` above it; the route file keeps its `STUB(B3)` line. `bun run stubs` counts 15 markers.
- H39 (5): unchanged layout (bearer check in `src/server/hooks/sentry-test.ts`, the route file one handler call, 12 lines after prettier wrapped it).
- Bank: P-085 (`no-unnecessary-type-conversion` on `String(error.name)`, the cost item D names), P-086 (`vitest/expect-expect` refuses assertions in a helper; cost one rewrite here), P-070 extended (hit again: a `node -e` append wrote a real line break for `\n`), P-081 extended (`expect` is a regular expression; a plain-text runner reported 15 false "not red"), G-022 now `enforced-by` the guard test with the new curl answer, P-083's proof count 11 -> 12.
- Runbook: the "Test that an error reaches Sentry" paragraph now states the R09 404 and the 405 on `GET`, not the two open points.

Proofs, in `app/` (real output):
- parse time of the crafted line `'at ' + 'a:1:1 ('.repeat(4000) + 'x'` (28,004 characters), `node scratch/measure-frame.mjs` (scratch folder is git-ignored): `old pattern, full 28004-char line ms per run: 200.31, 187.40, 176.42`; `new reader, full 28004-char line ms per run: 0.13, 0.01, 0.00`; `new reader, line cut to 500 ms per run: 0.02, 0.00, 0.00`. Whole `captureException` with that line as the stack, `node scratch/measure.mjs <folder>`: before (HEAD copy of `sentry.ts`) `captureException ms per run: 205.8, 181.5, 183.6` (first measurement `187.0, 169.7, 177.8`), after `captureException ms per run: 28.4, 0.2, 0.2` (the first run is warm-up of the module).
- `bunx vitest run tests/unit/sentry.test.ts tests/unit/sentry-test-route.test.ts tests/unit/pipeline.test.ts` -> `Test Files  3 passed (3)`, `Tests  92 passed (92)` (before the bounded-input case took a thrown string too; sentry alone now `Tests  24 passed (24)`, route `Tests  10 passed (10)`)
- `bun run build` exit 0, then `bun run cf:preview` -> `wrangler 4.145.0`, `Using secrets defined in .output\server\.dev.vars`, `Ready on http://127.0.0.1:8788`
- `curl -s -D - -X POST http://127.0.0.1:8788/api/hooks/sentry-test` (no authorization) -> `HTTP/1.1 404 Not Found`, `Content-Type: application/json`, `Cache-Control: no-store`, `x-request-id: 3acda463-fd47-4b1d-b9c6-e945fa8d0d7b`, body `{"error":{"code":"not_found","message":"There is nothing at this address.","requestId":"3acda463-fd47-4b1d-b9c6-e945fa8d0d7b"}}`, `id in body equals x-request-id: yes`
- the same with `-H "authorization: Bearer wrong-token-value"` -> `404`, `x-request-id: 1feeb49e-ab2a-465c-b478-e59ed915fb6e`, body requestId `1feeb49e-ab2a-465c-b478-e59ed915fb6e`, `yes`; with `-H "authorization: $PREVIEW_SENTRY_TEST_TOKEN"` (no scheme) -> `404`, `x-request-id: 2e6c2839-b21b-4f71-bde1-db96bfb347dd`, body requestId the same, `yes`
- an inbound id: `-X POST -H "x-request-id: abcdef12-inbound-id"` -> `x-request-id: abcdef12-inbound-id`, body `{"error":{"code":"not_found",...,"requestId":"abcdef12-inbound-id"}}`
- `curl -s -o /dev/null -w "%{http_code} %{content_type}" http://127.0.0.1:8788/api/hooks/sentry-test` -> `405 application/json`; `/api/hooks/nothing-here` -> `404 application/json`; `/` -> `200 text/html; charset=utf-8`; `curl -s -I ... /api/hooks/sentry-test` -> `405 application/json`
- bodies: GET `/api/hooks/sentry-test` -> `Cache-Control: no-store`, `x-request-id: 6d9a9d7e-1602-4d77-8405-5d5f31c9601d`, `{"error":{"code":"method_not_allowed","message":"This address does not accept that method.","requestId":"6d9a9d7e-1602-4d77-8405-5d5f31c9601d"}}`; GET `/api/hooks/nothing-here` -> `Cache-Control: no-store`, `x-request-id: 2847635f-0303-4bc5-83be-57343e8ae8e4`, `{"error":{"code":"not_found","message":"There is nothing at this address.","requestId":"2847635f-0303-4bc5-83be-57343e8ae8e4"}}`; GET `/` -> `HTTP/1.1 200 OK`, `Content-Type: text/html; charset=utf-8`, `Cache-Control: public, max-age=0, must-revalidate`, `page bytes 43837`
- Sentry round trip after the `start.ts` change: `curl -s -X POST -H "authorization: Bearer $PREVIEW_SENTRY_TEST_TOKEN" .../api/hooks/sentry-test` -> `HTTP/1.1 500 Internal Server Error`, `Cache-Control: no-store`, `x-request-id: c9971774-2ee1-47b4-8de2-d6e4459eaef3`, body `{"error":{"code":"server","message":"Something went wrong. Please try again in a moment.","requestId":"c9971774-2ee1-47b4-8de2-d6e4459eaef3"}}`; `node scratch/sentry-read.mjs <id>` -> `poll 1: issues 0`, `poll 2: issues 0`, `poll 3: issues 1`, `issue 7767612319 | SentryTestError: Sentry test error for [email]`, `events 1`, `tags {"request_id":"c9971774-2ee1-47b4-8de2-d6e4459eaef3","env":"local","release":"dev","side":"worker","route":"/api/hooks/sentry-test"}`, `user null`, `request entry false`, `ip/cookie/authorization count 0`, `test@example.com count 0`
- token unset on the Worker (`.dev.vars` saved to the scratch folder, rewritten without `SENTRY_TEST_TOKEN`, restarted, restored after): right bearer -> `HTTP/1.1 404 Not Found`, `Content-Type: application/json`, `Cache-Control: no-store`, `x-request-id: f8f354bd-3384-4ee9-904f-41e62ee4891c`, body requestId `f8f354bd-3384-4ee9-904f-41e62ee4891c`; `.dev.vars` back to `MOP_ENV length 5`, `SENTRY_DSN length 95`, `SENTRY_TEST_TOKEN length 64`
- stop (P-042, `scratch/stop-wrangler.ps1`, parents first): `stopped node.exe 31016`, `stopped node.exe 25192`, then for the second run `stopped node.exe 14036`, `stopped node.exe 17876`, `listeners on 8788: 0`, `workerd left: 0`; final `Get-NetTCPConnection -LocalPort 8788 -State Listen` -> `listeners on 8788: 0`, `workerd left: 0`
- registry: `node scratch/replay.mjs --check` -> `checked 94, bad 0` (three old entries whose `find` this change moved were rewritten first: `h`, `u-message`, `sentry-non-string`; `route-compare` and `route-scheme` got the new titles). Replay of every vitest entry (80; find asserted once, `expect` read as a regular expression, saved bytes restored, `git status` identical before and after): `replayed 80` all red once `expect` was matched as a regex (the first pass matched plain text and printed 15 false `NOT RED`; those 15 replayed red: `replayed 15, not red 0`). New entries, each red for its reason: `pipe-render-id` (`× gives the handler the id of the x-request-id header (H39 (1))`), `pipe-guard-off` and `pipe-guard-405` (`× answers GET /api/hooks/sentry-test rendered as a text/html; charset=utf-8 page with the R09 405`), `pipe-guard-404` (`× answers a page shell of 404 under /api/ with the R09 404`), `pipe-guard-path` and `pipe-guard-html` (`× leaves a page and an API answer that is not HTML untouched`), `pipe-guard-case` and `pipe-error-no-store` (`× answers GET /api/public/markets rendered as a Text/HTML page with the R09 405`), `route-404-body` (`× answers the R09 404 with the request id when the token is unset`), `route-404-id` (`× through handle, refuses no token with the id of x-request-id`), `sentry-cap-lines`, `sentry-cap-line`, `sentry-cap-message`, `sentry-cap-type`, `sentry-cap-thrown` (each `× caps the message, the stack and each line before any pattern runs`; the cap removed is the mutation)
- lint facts for the bank: scratch `String(error.name) + String(error.message)` -> `@typescript-eslint/no-unnecessary-type-conversion` twice, exit 1; scratch test asserting in a helper -> `Test has no assertions  vitest/expect-expect`, exit 1; both scratch files removed
- `node workspace/05-plans/check-gotchas.mjs` -> `check-gotchas: OK (23 path entries, 84 process entries)`
- `bun run check` -> exit 0: `layout: OK (577 files)`, eslint silent, knip `Configuration hints (4)` (g3's), `Found 0 clones.`, `stubs: 15 markers, 0 on closed slices`, `All matched files use Prettier code style!`, `Test Files  11 passed (11)`, `Tests  163 passed (163)`
- `bun run build` -> exit 0, `built in 1.18s`, `built in 689ms`, `built in 514ms`

Plan lines now stale, for the orchestrator (H39 already overrules them): B1b.md line 131 (`sentry-test` "Returns 404", now the R09 404 body, and the bearer check in the route file, H39 (5)); B1b.md line 126 (`deps.render` runs the request: it now takes `(request, requestId)`); B1b.md line 130 names no input caps for `sentry.ts` (H39 (3)).

UNPROVEN: `waitUntil` finishing the report on a deployed Worker (step 7); `crypto.ts` under Deno (B3 step 3b); that the router's unread HTML stream, dropped by the `/api/` guard, is released without cost on a deployed Worker (nothing measured it). `.dev.vars` is left with `MOP_ENV=local`, `SENTRY_DSN` and `SENTRY_TEST_TOKEN` (git-ignored).

## g4 close-out · steps 3b-4

Fix round after the review of `b6ebc7c` (three defects).

What changed:
1. `pipeline.ts` reads every path the way the router matches it. The router decodes the path (`decodePath` in `@tanstack/router-core`: `decodeURI`, each escape alone when the whole is malformed, `%25` and `%5C` kept, leading slashes made one) and ignores case (`caseSensitive: options.caseSensitive ?? false`, `router.js` line 808), so `/API/...`, `/Api/...`, `/%61pi/...`, `//api/...` and `/api/hoo%E2%84%AAs/...` (the Kelvin sign lower-cases to `k`) all reach `/api/hooks/...`. New file-local `routePath(pathname)` does the same, and the `/api/` guard, `calmServerError`, `isPageRequest` and `neverCached` read it, so B3's callers get the same answer from a raw pathname (`isPageRequest("/API/admin/x")` is now `false`). `/_serverFn/` became `/_serverfn/` in the prefix list, because the path is compared in lower case. Tests: four guard cases, six rule-6 cases and "reads a path as the router matches it" in `pipeline.test.ts`.
2. `crypto.test.ts` tests the constant-time property: "reads every byte of both arrays when the first byte differs" wraps both arrays in a Proxy that records the indexes read and expects 32 of 32 for each. The reviewer's mutation (the short-circuit compare) is registry entry `crypto-every-byte`, and `crypto-no-early-exit` stops the loop at the first difference; both are red.
3. Proofs replay from this block: the five scratch scripts this round used are printed below in full (they live in the lane-root `scratch/`, git-ignored, run from `app/`). The earlier close-out block's `scratch/measure-frame.mjs`, `scratch/measure.mjs`, `scratch/replay.mjs`, `scratch/sentry-read.mjs` and `scratch/stop-wrangler.ps1` are gone; the scripts below replace them, and their numbers are re-measured here.
4. Registry: four entries whose `find` this change moved were rewritten (`u`, `pipe-guard-off`, `pipe-guard-path`, `pipe-guard-html`); ten new entries (`pipe-path-case`, `pipe-path-decode`, `pipe-path-slashes`, `pipe-path-split`, `pipe-path-fallback`, `pipe-path-ascii`, `pipe-path-never-cached`, `pipe-path-page`, `crypto-every-byte`, `crypto-no-early-exit`).
5. Bank: G-024 (the router matches decoded and without case; prefix rules on the raw pathname miss it), P-087 (ESLint lints `app/scratch/` although git ignores it: this round's first `bun run check` failed with 8 errors from the scratch scripts, which moved to the lane root), P-088 (a log proof that names a deleted scratch script cannot be replayed), P-089 (a security property that does not change the answer needs its own test).

Files: `src/server/lib/pipeline.ts`, `tests/unit/pipeline.test.ts`, `tests/unit/crypto.test.ts`, `tests/mutations/B1b.json`, `GOTCHAS.md`, this log.

Proofs, in `app/` (real output):
- `bunx vitest run tests/unit/pipeline.test.ts tests/unit/crypto.test.ts` -> `Test Files  2 passed (2)`, `Tests  87 passed (87)`
- `node ../scratch/replay.mjs --check` -> `checked 103, bad 0`
- new and moved entries, `node ../scratch/replay.mjs pipe-path-case pipe-path-decode pipe-path-slashes pipe-path-split pipe-path-fallback pipe-path-ascii pipe-path-never-cached pipe-path-page crypto-every-byte crypto-no-early-exit u pipe-guard-off pipe-guard-path pipe-guard-html` -> `replayed 14, not red 0`, among them `RED pipe-path-case: exit=1 expect=true | × answers GET /API/hooks/sentry-test, which the router matches as /api/, with the R09 405`, `RED pipe-path-decode: ... × answers GET /%61pi/hooks/sentry-test, ...`, `RED pipe-path-slashes: ... × answers GET //api/hooks/sentry-test, ...`, `RED pipe-path-split: ... × forces no-store on GET /api/hoo%E2%84%AAs/x%25%E0 (the same beside a malformed escape)`, `RED pipe-path-fallback: ... × reads a path as the router matches it`, `RED pipe-path-ascii: ... URIError: URI malformed`, `RED pipe-path-never-cached: ... × forces no-store on GET /%61pi/hooks/resend (a hook with an escaped letter)`, `RED pipe-path-page: ... × reads a path as the router matches it`, `RED crypto-every-byte: ... × reads every byte of both arrays when the first byte differs`, `RED crypto-no-early-exit: ...` the same
- every vitest entry, `node ../scratch/replay.mjs --all` -> `replayed 90, not red 0`; `git status --short` the same before and after
- parse time of the crafted line, `node ../scratch/measure.ts` (Node v24.13.0) -> `line length 28004`, `old pattern ms per run: 170.52, 175.38, 169.13` (a second run `178.09, 168.58, 169.88`; under bun `170.95, 165.38, 164.26`), `captureException ms per run: 25.86, 0.38, 0.22` (the first run loads the module; a second run `26.49, 0.23, 0.13`)
- `bun run build` exit 0, then `bun run cf:preview` -> `wrangler 4.145.0`, `Using secrets defined in .output\server\.dev.vars`, `Ready on http://127.0.0.1:8788`
- `MSYS_NO_PATHCONV=1 bash ../scratch/live.sh` (curl `--path-as-is`):
```
/api/hooks/sentry-test               GET  405 application/json | cache-control: no-store
/API/hooks/sentry-test               GET  405 application/json | cache-control: no-store
/Api/hooks/sentry-test               GET  405 application/json | cache-control: no-store
/%61pi/hooks/sentry-test             GET  405 application/json | cache-control: no-store
//api/hooks/sentry-test              GET  308  | cache-control: 
/api/hoo%E2%84%AAs/sentry-test       GET  405 application/json | cache-control: no-store
/api/hooks/nothing-here              GET  404 application/json | cache-control: no-store
/API/hooks/nothing-here              GET  404 application/json | cache-control: no-store
/ADMIN                               GET  404 text/html; charset=utf-8 | cache-control: no-store
/Api/Admin/x                         GET  404 application/json | cache-control: no-store
/                                    GET  200 text/html; charset=utf-8 | cache-control: public, max-age=0, must-revalidate
/California                          GET  404 text/html; charset=utf-8 | cache-control: public, max-age=0, must-revalidate
/api/hooks/sentry-test               POST no token: HTTP/1.1 404 Not Found | x-request-id fd9f1c13-10d6-4d8a-a403-1eb117cb5090 | body {"error":{"code":"not_found","message":"There is nothing at this address.","requestId":"fd9f1c13-10d6-4d8a-a403-1eb117cb5090"}}
/API/hooks/sentry-test               POST no token: HTTP/1.1 404 Not Found | x-request-id f6296f26-bc11-4edd-b619-974884e69cfb | body {"error":{"code":"not_found","message":"There is nothing at this address.","requestId":"f6296f26-bc11-4edd-b619-974884e69cfb"}}
/%61pi/hooks/sentry-test             POST no token: HTTP/1.1 404 Not Found | x-request-id 403eb143-e6fc-45a7-85cd-238d62338f2e | body {"error":{"code":"not_found","message":"There is nothing at this address.","requestId":"403eb143-e6fc-45a7-85cd-238d62338f2e"}}
wrong bearer: HTTP/1.1 404 Not Found | x-request-id d4e3d470-279f-48fa-adee-93813c16fe71 | id in body equals header: 1
no scheme: HTTP/1.1 404 Not Found | x-request-id cfd9fd08-4197-473f-b21d-cdffa494c071 | id in body equals header: 1
HTTP/1.1 500 Internal Server Error
Content-Type: application/json
Cache-Control: no-store
x-request-id: 35affba0-9e21-451f-ac12-8e9affd82021
body {"error":{"code":"server","message":"Something went wrong. Please try again in a moment.","requestId":"35affba0-9e21-451f-ac12-8e9affd82021"}}
```
  The reviewer measured, before this fix, `200 text/html; charset=utf-8` and `Cache-Control: public, max-age=0, must-revalidate` for `/API/...`, `/Api/...` and `/%61pi/...`. `//api/...` answers a bare `308` to `/api/hooks/sentry-test` with no `x-request-id` (corrected in the next block: TanStack Start's `createStartHandler` answers it before any request middleware, and the code is in the built bundle, so a deployed Worker answers the same; it was wrongly blamed on the runtime here), and following it (`curl -L`) gives `405 application/json`. `/ADMIN` is a 404 page because `/admin` does not exist until B7; its answer is `no-store` all the same. `/California` is not a route (case is ignored, the page does not exist).
- Sentry round trip, `node ../scratch/sentry-read.mjs 35affba0-9e21-451f-ac12-8e9affd82021` -> `poll 1: issues 0`, `poll 2: issues 0`, `poll 3: issues 1`, `issue 7767612319 | SentryTestError: Sentry test error for [email]`, `events 1`, `tags {"env":"local","release":"dev","request_id":"35affba0-9e21-451f-ac12-8e9affd82021","route":"/API/hooks/sentry-test","side":"worker"}`, `user null`, `request entry false`, `ip/cookie/authorization count 0`, `test@example.com count 0`. The same through the lower-case path in the first preview run: request id `199c780e-0277-44f4-a625-598bf64cdfad`, `poll 3: issues 1`, tags `route":"/api/hooks/sentry-test"`, `user null`, counts `0` and `0`.
- stop (P-042), `powershell -NoProfile -ExecutionPolicy Bypass -File ../scratch/stop-wrangler.ps1` -> first run `stopped node.exe 27448`, `stopped node.exe 17632`, `listeners on 8788: 0`, `workerd left: 0`; second run `stopped node.exe 21788`, `stopped node.exe 12168`, `listeners on 8788: 0`, `workerd left: 0`
- P-087, measured: `bun run check` with the scripts in `app/scratch/` -> exit 1, `Parsing error: E:\mop-build\spine\app\scratch\measure.ts was not found by the project service` and seven `prettier/prettier` errors on the `.mjs` files; `bunx eslint --max-warnings 0 scratch/zz-scratch.mjs` -> `1:25  error  Insert ';'  prettier/prettier`, exit 1; `app/scratch` removed after
- `node workspace/05-plans/check-gotchas.mjs` -> `check-gotchas: OK (24 path entries, 87 process entries)`
- `bun run check` -> exit 0: `layout: OK (577 files)`, eslint silent, knip `Configuration hints (4)` (g3's), `Found 0 clones.`, `stubs: 15 markers, 0 on closed slices`, `All matched files use Prettier code style!`, `Test Files  11 passed (11)`, `Tests  175 passed (175)`
- `bun run build` -> exit 0, `built in 1.21s`, `built in 710ms`, `built in 532ms`

Replay tools (save each under the lane-root `scratch/`, git-ignored; run from `app/`; the `.env` names are loaded without printing):

`scratch/replay.mjs`
```js
// Replays watched-fail entries of tests/mutations/B1b.json from app/.
// node ../scratch/replay.mjs --check          every file entry's find occurs exactly once
// node ../scratch/replay.mjs <id> [<id> ...]  apply, run, expect red matching `expect`, restore
// node ../scratch/replay.mjs --all            the same for every file entry run by vitest
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const entries = JSON.parse(readFileSync("tests/mutations/B1b.json", "utf8"));
const args = process.argv.slice(2);
const files = entries.filter((e) => e.kind === undefined);
const count = (text, find) => text.split(find).length - 1;

if (args[0] === "--check") {
  const bad = files.filter((e) => count(readFileSync(e.file, "utf8"), e.find) !== 1);
  for (const e of bad) console.log(`BAD ${e.id}: find occurs ${count(readFileSync(e.file, "utf8"), e.find)} times`);
  console.log(`checked ${files.length}, bad ${bad.length}`);
  process.exit(bad.length === 0 ? 0 : 1);
}

const chosen =
  args[0] === "--all"
    ? files.filter((e) => e.run.startsWith("bunx vitest"))
    : files.filter((e) => args.includes(e.id));
let notRed = 0;
for (const e of chosen) {
  const saved = readFileSync(e.file);
  const text = saved.toString("utf8");
  if (count(text, e.find) !== 1) {
    console.log(`BAD ${e.id}: find occurs ${count(text, e.find)} times`);
    notRed += 1;
    continue;
  }
  writeFileSync(e.file, text.replace(e.find, () => e.replace));
  let exit = 0;
  let out = "";
  try {
    out = execSync(e.run, { encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    exit = error.status ?? 1;
    out = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  } finally {
    writeFileSync(e.file, saved);
  }
  const matched = new RegExp(e.expect).test(out);
  const red = exit !== 0 && matched;
  if (!red) notRed += 1;
  const line = out.split("\n").find((l) => new RegExp(e.expect).test(l)) ?? "";
  console.log(`${red ? "RED" : "NOT RED"} ${e.id}: exit=${exit} expect=${matched} | ${line.trim().slice(0, 140)}`);
}
console.log(`replayed ${chosen.length}, not red ${notRed}`);
process.exit(notRed === 0 ? 0 : 1);
```

`scratch/measure.ts`
```ts
// node ../scratch/measure.ts   (Node 24 strips the types; from app/; ASSUMED H39 (3) parse time of the crafted 28 KB line)
// Old: the two-lazy-group frame pattern sentry.ts used before the close-out, on the full line.
// New: the whole captureException with that line as the stack; fetch is stubbed, nothing is sent.
import { captureException } from "../app/src/server/lib/sentry.ts";

const line = "at " + "a:1:1 (".repeat(4000) + "x";
const OLD_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;
const time = (run: () => unknown) => {
  const start = performance.now();
  run();
  return (performance.now() - start).toFixed(2);
};
console.log(`line length ${line.length}`);
console.log(`old pattern ms per run: ${[1, 2, 3].map(() => time(() => OLD_FRAME.exec(line))).join(", ")}`);

globalThis.fetch = () => Promise.resolve(new Response(null, { status: 200 }));
const error = Object.assign(new Error("crafted"), { stack: `Error: crafted\n${line}` });
const runs: string[] = [];
for (let index = 0; index < 3; index += 1) {
  const start = performance.now();
  await captureException(error, {
    dsn: "https://key@o1.ingest.sentry.io/1",
    requestId: `measure-${index}-request`,
    route: `/measure/${index}`,
    env: "local",
    release: "dev",
  });
  runs.push((performance.now() - start).toFixed(2));
}
console.log(`captureException ms per run: ${runs.join(", ")}`);
```

`scratch/sentry-read.mjs`
```js
// node ../scratch/sentry-read.mjs <request id>   (SENTRY_AUTH_TOKEN loaded from .env, never printed)
// Polls the issues query for the id, then reads the stored event and prints what it carries.
const id = process.argv[2];
const headers = { Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` };
const api = "https://sentry.io/api/0";
const get = async (url) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      return await response.json();
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
};
let issues = [];
for (let poll = 1; poll <= 20 && issues.length === 0; poll += 1) {
  if (poll > 1) await new Promise((resolve) => setTimeout(resolve, 6000));
  issues = await get(`${api}/projects/matter-of-place/javascript-tanstackstart-react/issues/?query=request_id:${id}`);
  console.log(`poll ${poll}: issues ${issues.length}`);
}
if (issues.length === 0) process.exit(1);
console.log(`issue ${issues[0].id} | ${issues[0].title}`);
const events = await get(`${api}/organizations/matter-of-place/issues/${issues[0].id}/events/?query=request_id:${id}&full=true`);
console.log(`events ${events.length}`);
const event = events[0];
const text = JSON.stringify(event);
console.log(`tags ${JSON.stringify(Object.fromEntries(event.tags.map((t) => [t.key, t.value]).filter(([k]) => ["request_id", "env", "release", "side", "route"].includes(k))))}`);
console.log(`user ${JSON.stringify(event.user)}`);
console.log(`request entry ${event.entries.some((e) => e.type === "request")}`);
console.log(`ip/cookie/authorization count ${(text.match(/ip_address|cookie|authorization/gi) ?? []).length}`);
console.log(`test@example.com count ${text.split("test@example.com").length - 1}`);
```

`scratch/live.sh`
```bash
#!/usr/bin/env bash
# Live proofs of the /api/ guard and rule 6 under `bun run cf:preview` (port 8788). Run from app/.
set -a; . <(tr -d '\r' < "/e/mop-build/spine/.env" | grep -E '^[A-Z0-9_]+='); set +a
B=http://127.0.0.1:8788
for p in /api/hooks/sentry-test /API/hooks/sentry-test /Api/hooks/sentry-test /%61pi/hooks/sentry-test //api/hooks/sentry-test /api/hoo%E2%84%AAs/sentry-test /api/hooks/nothing-here /API/hooks/nothing-here /ADMIN /Api/Admin/x / /California; do
  cc=$(curl -s --path-as-is -D - -o /dev/null "$B$p" | tr -d '\r' | grep -i '^cache-control:' | cut -d' ' -f2-)
  printf '%-36s GET  %s | cache-control: %s\n' "$p" "$(curl -s --path-as-is -o /dev/null -w '%{http_code} %{content_type}' "$B$p")" "$cc"
done
for p in /api/hooks/sentry-test /API/hooks/sentry-test /%61pi/hooks/sentry-test; do
  h=$(curl -s --path-as-is -D - -o ../scratch/body.json -X POST "$B$p" | tr -d '\r')
  id=$(printf '%s\n' "$h" | grep -i '^x-request-id:' | cut -d' ' -f2)
  printf '%-36s POST no token: %s | x-request-id %s | body %s\n' "$p" "$(printf '%s\n' "$h" | head -1)" "$id" "$(cat ../scratch/body.json)"
done
for auth in "authorization: Bearer wrong-token-value" "authorization: $PREVIEW_SENTRY_TEST_TOKEN"; do
  h=$(curl -s -D - -o ../scratch/body.json -X POST -H "$auth" "$B/api/hooks/sentry-test" | tr -d '\r')
  id=$(printf '%s\n' "$h" | grep -i '^x-request-id:' | cut -d' ' -f2)
  case "$auth" in *wrong*) n="wrong bearer" ;; *) n="no scheme" ;; esac
  echo "$n: $(printf '%s\n' "$h" | head -1) | x-request-id $id | id in body equals header: $(grep -c "\"requestId\":\"$id\"" ../scratch/body.json)"
done
curl -s --path-as-is -D - -o ../scratch/body.json -X POST -H "authorization: Bearer $PREVIEW_SENTRY_TEST_TOKEN" "$B/API/hooks/sentry-test" | tr -d '\r' | grep -i '^HTTP\|^cache-control\|^x-request-id\|^content-type'
echo "body $(cat ../scratch/body.json)"
```

`scratch/stop-wrangler.ps1`
```powershell
# Stops `wrangler dev` on port 8788 by its parents first (GOTCHAS P-042), then any workerd.
$parents = Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'bun.exe'" |
  Where-Object { $_.CommandLine -like '*wrangler*' -and $_.CommandLine -like '*8788*' }
foreach ($p in $parents) { Stop-Process -Id $p.ProcessId -Force; "stopped $($p.Name) $($p.ProcessId)" }
Start-Sleep -Seconds 2
Get-Process workerd -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force; "stopped workerd $($_.Id)" }
Start-Sleep -Seconds 1
"listeners on 8788: $(@(Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction SilentlyContinue).Count)"
"workerd left: $(@(Get-Process workerd -ErrorAction SilentlyContinue).Count)"
```

Plan lines for the orchestrator: none new. B3's cache module and B7's admin wrapper classify paths through `isPageRequest` and `neverCached` (G-024), not their own `startsWith`.

UNPROVEN: (withdrawn in the next block, settled by reading the source) that a deployed Worker (not `wrangler dev`) answers `//api/...` with the same bare 308 before the pipeline; `waitUntil` finishing the report on a deployed Worker (step 7); `crypto.ts` under Deno (B3 step 3b); that the router's unread HTML stream dropped by the `/api/` guard is released without cost on a deployed Worker. `.dev.vars` is left with `MOP_ENV=local`, `SENTRY_DSN` and `SENTRY_TEST_TOKEN` (git-ignored).

## g4 close-out · steps 3b-4

Fix round after the review of `f85bec5` (four defects).

What changed:
1. A non-HTML `Accept` under `/api/` (R09, H39 (1) and (2)). Start's `executeRouter` (`node_modules/@tanstack/start-server-core/dist/esm/createStartHandler.js` line 290) answers a request that no handler took, and whose `Accept` has no part starting `*/*` or `text/html`, with `Response.json({ error: "Only HTML requests are supported here" }, { status: 500 })`. `handle()` in `pipeline.ts` now recognises it (`refusedByRouter`: a 500, an `Accept` the router refuses, read the same way Start reads it including `""` as `*/*`, and a body whose `error` is a string, which an R09 body never is) and answers the R09 JSON with `no-store`: 405 `method_not_allowed` when an API route file matches the path, else 404 `not_found`, with the id of `x-request-id`. Whether a route file matches is the new dep `isApiRoute(path)`; `start.ts` answers it with the router's own `getMatchedRoutes` on one router made on the first refusal (only API route files count, no splat). The pipeline passes the decoded, lower-case path (`routePath`): measured live, `getMatchedRoutes("/%61pi/hooks/sentry-test")` matched nothing and gave 404, because Start decodes the URL (`getNormalizedURL`) before it matches and `getMatchedRoutes` does not. Tests: five refusal cases and five "keeps ... as it is" cases (a handler's R09 500, a 500 that is not JSON, a 200 with an `error` field, a 500 to a client that accepts HTML, a 500 to an empty `Accept`) in `pipeline.test.ts`; `sentry-test-route.test.ts` gives its `handle` the new dep.
2. The 308 on `//...`. The previous block's cause was wrong and is corrected there: `createStartHandler` line 223 to 226 (`if (handledProtocolRelativeURL) return Response.redirect(url, 308)`) runs before the request middleware, and `grep -rl handledProtocolRelativeURL .output/server` lists `.output/server/_ssr/ssr.mjs`, so a deployed Worker answers the same bare 308 with no `x-request-id` and no security header. The UNPROVEN line about it is withdrawn. Not fixed: see "For the orchestrator".
3. Bank: P-090 (a code change moves the `find` of older registry entries; run the runner's `--check` after every edit of a mutated file), G-025 (Start's own answers: the non-HTML refusal, the `//` 308, `getMatchedRoutes` not decoding; grep the source before recording a cause), G-022 now points to G-025.
4. `sentry.ts`: the comment claimed every input was cut before a pattern; route, env, release, tag values and fingerprint parts were not, and the route was the dedupe key uncut. Now `captureException(error, given)` starts with `cutOptions(given)`: `requestId`, `route`, `env`, `release` and each fingerprint part cut to `MAX_LINE` (500), at most `MAX_FINGERPRINT_PARTS` (10, ASSUMED) parts, before the key, `scrubEvent` and `maskEmails` read them. The comment names exactly what is cut. Test: "cuts the options' texts and the fingerprint before a pattern runs" (5,000-character texts and 30 parts: the longest text `maskEmails` sees is at most 500, the event has 10 parts).

Files: `src/server/lib/pipeline.ts`, `src/start.ts`, `src/server/lib/sentry.ts`, `tests/unit/{pipeline,sentry,sentry-test-route}.test.ts`, `tests/mutations/B1b.json`, `docs/runbooks/delivery.md` (the Sentry test paragraph names the 405 or 404 for any `Accept`), `GOTCHAS.md`, this log.

Proofs, in `app/` (real output):
- before the fix, `MSYS_NO_PATHCONV=1 bash ../scratch/accept.sh` on the `f85bec5` build: `application/json GET /api/hooks/sentry-test 500 | application/json | no-store | id in body: 0 | {"error":"Only HTML requests are supported here"}`, the same `500` for `DELETE /api/hooks/sentry-test`, `GET` and `POST /api/hooks/nothing-here`, `GET /API/hooks/nothing-here`, and for all five with `Accept: text/plain`; with `*/*` and `text/html` already `405` and `404` R09
- `bunx vitest run tests/unit/sentry.test.ts tests/unit/sentry-test-route.test.ts tests/unit/pipeline.test.ts` -> `Test Files  3 passed (3)`, `Tests  114 passed (114)`; `pipeline.test.ts` alone `Tests  79 passed (79)`
- `node ../scratch/replay.mjs --check` -> `checked 118, bad 0`
- new entries, `node ../scratch/replay.mjs pipe-refusal-off pipe-refusal-405 pipe-refusal-accept pipe-refusal-empty-accept pipe-refusal-status pipe-refusal-shape pipe-refusal-catch sentry-cut-off sentry-cut-route sentry-cut-request-id sentry-cut-env sentry-cut-release sentry-cut-fp-part sentry-cut-fp-count` -> `replayed 14, not red 0`: `RED pipe-refusal-off: exit=1 expect=true | × answers the router's refusal of GET with Accept application/json with the R09 405`, `RED pipe-refusal-405` the same, `RED pipe-refusal-accept: ... × keeps a 500 to a client that accepts HTML as it is`, `RED pipe-refusal-empty-accept: ... × keeps a 500 to an empty Accept, which Start reads as */* as it is`, `RED pipe-refusal-status: ... × keeps a 200 with an error field as it is`, `RED pipe-refusal-shape: ... × keeps a handler's R09 500 as it is`, `RED pipe-refusal-catch: ... × keeps a 500 that is not JSON as it is`, and each `sentry-cut-*`: `× cuts the options' texts and the fingerprint before a pattern runs`; after the path change, `node ../scratch/replay.mjs pipe-refusal-route-path pipe-refusal-405 pipe-refusal-off pipe-guard-off` -> `replayed 4, not red 0` (`RED pipe-refusal-route-path: ... × answers the router's refusal of GET with Accept application/json with the R09 405`)
- every vitest entry on the final code, `node ../scratch/replay.mjs --all` -> `replayed 105, not red 0`; `git status --short` the same before and after
- watched-fail of `start.ts`'s `isApiRoute` (registry entry `start-api-route`, kind `manual`): source saved, `fullPath.startsWith("/api/")` replaced by `fullPath.startsWith("/nothing/")`, `bun run build` exit 0 (`grep -rl 'startsWith("/nothing/")' .output/server` -> `.output/server/_ssr/start-D6M1fX4H.mjs`), `cf:preview`, `accept.sh` -> `application/json GET /api/hooks/sentry-test 404 | application/json | no-store | id in body: 1`, the `DELETE` the same `404`; source restored (`cmp` equal), rebuilt (no `/nothing/` in `.output/server`)
- parse time of the crafted line, `node ../scratch/measure.ts` (Node v24.13.0) -> `line length 28004`, `old pattern ms per run: 216.60, 216.62, 229.51`, `captureException ms per run: 32.40, 0.29, 0.18` (the first run loads the module)
- `bun run build` exit 0, then `bun run cf:preview` -> `wrangler 4.145.0`, `Using secrets defined in .output\server\.dev.vars`, `Ready on http://127.0.0.1:8788`
- `MSYS_NO_PATHCONV=1 bash ../scratch/accept.sh` (bodies cut at 140 characters by the script):
```
application/json   GET    /api/hooks/sentry-test       405 | application/json | no-store | id in body: 1 | {"error":{"code":"method_not_allowed","message":"This address does not accept that method.","requestId":"4a72c5bb-606a-4238-918f-bddf6d4c8d5
application/json   DELETE /api/hooks/sentry-test       405 | application/json | no-store | id in body: 1 | {"error":{"code":"method_not_allowed",...
application/json   GET    /api/hooks/nothing-here      404 | application/json | no-store | id in body: 1 | {"error":{"code":"not_found","message":"There is nothing at this address.","requestId":"ae9653bb-b503-48cb-b597-f9778f661657"}}
application/json   GET    /API/hooks/nothing-here      404 | application/json | no-store | id in body: 1 | {"error":{"code":"not_found",...
application/json   POST   /api/hooks/nothing-here      404 | application/json | no-store | id in body: 1 | {"error":{"code":"not_found",...
text/plain         GET    /api/hooks/sentry-test       405 | application/json | no-store | id in body: 1 | {"error":{"code":"method_not_allowed",...
text/plain         DELETE /api/hooks/sentry-test       405 | application/json | no-store | id in body: 1 | {"error":{"code":"method_not_allowed",...
text/plain         GET    /api/hooks/nothing-here      404 | application/json | no-store | id in body: 1 | {"error":{"code":"not_found",...
text/plain         GET    /API/hooks/nothing-here      404 | application/json | no-store | id in body: 1 | {"error":{"code":"not_found",...
text/plain         POST   /api/hooks/nothing-here      404 | application/json | no-store | id in body: 1 | {"error":{"code":"not_found",...
*/*                GET    /api/hooks/sentry-test       405 | application/json | no-store | id in body: 1 | (the same for DELETE; 404 for the three nothing-here lines)
text/html          GET    /api/hooks/sentry-test       405 | application/json | no-store | id in body: 1 | (the same for DELETE; 404 for the three nothing-here lines)
--- a page and a document with Accept: application/json
/              500 application/json
/sitemap.xml   200 application/xml; charset=utf-8
--- //api/ (protocol-relative, answered by createStartHandler before the middleware)
HTTP/1.1 308 Permanent Redirect
Content-Length: 0
Location: http://127.0.0.1:8788/api/hooks/sentry-test
```
  The id in every body equals the `x-request-id` header (`id in body: 1` on all 20 API lines). With `Accept: application/json`: `/API/hooks/sentry-test` -> `405 application/json`, `/%61pi/hooks/sentry-test` -> `405 application/json` (`404` before the pipeline passed the decoded path), `/api/hoo%E2%84%AAs/sentry-test` -> `405 application/json`, `/Api/Admin/x` -> `404 application/json`.
- `MSYS_NO_PATHCONV=1 bash ../scratch/live.sh` (the previous block's script, unchanged): the same 12 GET lines as the previous block (`405`, `405`, `405`, `405`, `308`, `405`, `404`, `404`, `404 text/html` for `/ADMIN`, `404`, `200 text/html` for `/`, `404 text/html` for `/California`, each `no-store` under `/api/`); `POST` with no token on `/api/...`, `/API/...` and `/%61pi/...` -> `HTTP/1.1 404 Not Found` with the id of `x-request-id` in the body; `wrong bearer: ... id in body equals header: 1`; `no scheme: ... id in body equals header: 1`; the right bearer -> `HTTP/1.1 500 Internal Server Error`, `Content-Type: application/json`, `Cache-Control: no-store`, `x-request-id: e111a80f-6098-4c34-9d59-0b63493c5650`, body `{"error":{"code":"server","message":"Something went wrong. Please try again in a moment.","requestId":"e111a80f-6098-4c34-9d59-0b63493c5650"}}`
- Sentry round trip, `node ../scratch/sentry-read.mjs e111a80f-6098-4c34-9d59-0b63493c5650` -> `poll 1: issues 0`, `poll 2: issues 1`, `issue 7767612319 | SentryTestError: Sentry test error for [email]`, `events 1`, `tags {"env":"local","release":"dev","request_id":"e111a80f-6098-4c34-9d59-0b63493c5650","route":"/API/hooks/sentry-test","side":"worker"}`, `user null`, `request entry false`, `ip/cookie/authorization count 0`, `test@example.com count 0`
- stop (P-042), `powershell -NoProfile -ExecutionPolicy Bypass -File ../scratch/stop-wrangler.ps1` after each of the four preview runs (before the fix, first fix, mutant, final) -> final run `stopped node.exe 8988`, `stopped node.exe 16340`, `listeners on 8788: 0`, `workerd left: 0`; then `Get-NetTCPConnection -LocalPort 8788 -State Listen` -> `listeners on 8788: 0`
- P-090, measured: a space put before the `;` of `const options = cutOptions(given);` -> `node ../scratch/replay.mjs --check` prints `BAD sentry-cut-off: find occurs 0 times`, `checked 118, bad 1`; bytes restored -> `checked 118, bad 0`
- G-025 facts: `grep -c "Only HTML requests are supported here" node_modules/@tanstack/start-server-core/dist/esm/createStartHandler.js` -> `1`, the same in `.output/server/_ssr/ssr.mjs` -> `1`; `grep -rl handledProtocolRelativeURL .output/server` -> `.output/server/_libs/@tanstack/react-router+[...].mjs`, `.output/server/_libs/@tanstack/router-core+[...].mjs`, `.output/server/_ssr/ssr.mjs`
- `node workspace/05-plans/check-gotchas.mjs` -> `check-gotchas: OK (25 path entries, 88 process entries)`
- `bun run check` -> exit 0: `layout: OK (577 files)`, eslint silent, knip `Configuration hints (4)` (g3's), `Found 0 clones.`, `stubs: 15 markers, 0 on closed slices`, `All matched files use Prettier code style!`, `Test Files  11 passed (11)`, `Tests  186 passed (186)`
- `bun run build` -> exit 0, `built in 1.24s`, `built in 847ms`, `built in 709ms`

`scratch/accept.sh` (lane-root `scratch/`, git-ignored; run from `app/`; `replay.mjs`, `measure.ts`, `sentry-read.mjs`, `live.sh` and `stop-wrangler.ps1` are the texts in the previous block):
```bash
#!/usr/bin/env bash
# Live proofs of the /api/ guard for every Accept header, under `bun run cf:preview` (port 8788). Run from app/.
B=http://127.0.0.1:8788
for accept in "application/json" "text/plain" "*/*" "text/html"; do
  for spec in "GET /api/hooks/sentry-test" "DELETE /api/hooks/sentry-test" "GET /api/hooks/nothing-here" "GET /API/hooks/nothing-here" "POST /api/hooks/nothing-here"; do
    m=${spec%% *}; p=${spec#* }
    h=$(curl -s --path-as-is -D - -o ../scratch/body.json -X "$m" -H "Accept: $accept" "$B$p" | tr -d '\r')
    id=$(printf '%s\n' "$h" | grep -i '^x-request-id:' | cut -d' ' -f2)
    printf '%-18s %-6s %-28s %s | %s | %s | id in body: %s | %s\n' "$accept" "$m" "$p" \
      "$(printf '%s\n' "$h" | head -1 | cut -d' ' -f2)" \
      "$(printf '%s\n' "$h" | grep -i '^content-type:' | cut -d' ' -f2-)" \
      "$(printf '%s\n' "$h" | grep -i '^cache-control:' | cut -d' ' -f2-)" \
      "$(grep -c "\"requestId\":\"$id\"" ../scratch/body.json)" "$(head -c 140 ../scratch/body.json)"
  done
done
printf '%s\n' "--- a page and a document with Accept: application/json"
for p in / /sitemap.xml; do
  printf '%-14s %s\n' "$p" "$(curl -s -o /dev/null -H 'Accept: application/json' -w '%{http_code} %{content_type}' "$B$p")"
done
printf '%s\n' "--- //api/ (protocol-relative, answered by createStartHandler before the middleware)"
curl -s --path-as-is -D - -o /dev/null "$B//api/hooks/sentry-test" | tr -d '\r'
```

For the orchestrator (rulings needed; not built, so nothing was changed quietly):
- A page with a non-HTML `Accept` gets Start's bare 500: `curl -s -o /dev/null -H "Accept: application/json" -w "%{http_code} %{content_type}" http://127.0.0.1:8788/` -> `500 application/json`, body `{"error":"Only HTML requests are supported here"}`, no `requestId`. It breaks R09 for pages and counts as a 5xx with no Sentry event. H39 (2) rules only `/api/`; the status for a page (406 `not_acceptable` with the R09 body, or render the HTML whatever the `Accept`) is a decision.
- `//<path>` gets Start's bare 308 before any middleware, with no `x-request-id` and no security header (R09, invariant 10). Fixing it means a server entry (`src/server.ts` wrapping Start's handler) that the folder map and the plan do not name. The consequence is low (an empty same-origin redirect).
- `lastSent` in `sentry.ts` now holds keys of at most about 5,000 characters (10 parts of 500), but its count is bounded only by distinct errors within 60 s in one isolate (B3's edge rate limit on `/api/public/*` bounds the browser's share). Not measured.

UNPROVEN: `waitUntil` finishing the report on a deployed Worker (step 7); `crypto.ts` under Deno (B3 step 3b); that the router's unread HTML stream dropped by the `/api/` guard is released without cost on a deployed Worker. `.dev.vars` is left with `MOP_ENV=local`, `SENTRY_DSN` and `SENTRY_TEST_TOKEN` (git-ignored).

## g5 · steps 4b

Built: a page whose request the router refuses (Accept holds neither `text/html` nor `*/*`, Start's bare 500) now answers 406 `not_acceptable` with the R09 body and `no-store` (ASSUMED H41 (1)). knip hints for `src/routeTree.gen.ts` and `src/router.tsx` cleared. Files: `app/src/server/lib/pipeline.ts`, `app/tests/unit/pipeline.test.ts`, `app/tests/mutations/B1b.json`, `app/knip.json`, `app/docs/runbooks/delivery.md`, plus `GOTCHAS.md` (G-025 rewritten for the 406, P-093 added).

Findings:
- The first run of the new 406 test failed on `cache-control`: the 406 is not a 5xx, so the page branch stamped `public, max-age=0, must-revalidate` over the `no-store` that `errorJson` sets. Fix: `neverCached` lists status 406 (its docstring says so); registry entry `pipe-406-no-store` turns the test red without it.
- The plan's letters (bm) and (bn) were already registry ids from step 2b (`http-client.test.ts` `price`, `stubs.ts` walk). The new entries are `bm-page-refusal` and `bn-page-406-all` (GOTCHAS P-093). Entry `pipe-refusal-off` had a `find` that no longer parsed once the condition became `const refused = await refusedByRouter(request, response);`; rewritten (P-090).
- `knip` exits 0 with two hints that stay: `src/db/types.ts` (B2 creates it) and `supabase/functions/*/index.ts` (B8); listed in the runbook with the slice that clears each.
- The runbook now says what H41 (2) and (3) accept: `//` gets Start's bare 308 and a trailing slash under `/api/` the router's 307, neither with `x-request-id` or security headers.
- A stray `python3 - <<EOF` with an empty heredoc hung the shell for 120 seconds; nothing was written by it. Edits went through the Edit tool. Banked as P-094 in the fix round below (the cause is the interactive prompt looping, not the Store stub).

Proof 1: `cd app && bunx vitest run tests/unit/pipeline.test.ts`
```
 Test Files  1 passed (1)
      Tests  81 passed (81)
```

Proof 2: `bun run build`, `bun run cf:preview` (MOP_ENV=local in `.dev.vars`), then
`curl -s -D h.txt -o b.json -w "%{http_code} %{content_type}" -H "Accept: application/json" http://127.0.0.1:8788/`
```
406 application/json
Cache-Control: no-store
X-Frame-Options: DENY
x-request-id: f5b9faa6-0900-44ad-8f23-c70ef4e9d579
{"error":{"code":"not_acceptable","message":"This address answers with a web page only.","requestId":"f5b9faa6-0900-44ad-8f23-c70ef4e9d579"}}
```
The body `requestId` equals the `x-request-id` header. Same address, other Accept values (same run):
```
Accept: text/html                          200 text/html; charset=utf-8
no Accept header                           200 text/html; charset=utf-8
/sitemap.xml with Accept: application/json 200 application/xml; charset=utf-8
GET /api/hooks/sentry-test, Accept json    405 application/json
```
Stopped by the parent `node.exe`/`bun.exe` (P-042): `listeners on 8788: 0`, `workerd left: 0`.

Proof 3: `cd app && bun run knip; echo exit=$?`
```
$ knip
Configuration hints (2)
src/db/types.ts                  knip.json  Remove from ignore
supabase/functions/*/index.ts    knip.json  Refine entry pattern (no matches)
exit 0
```
`grep -c "routeTree.gen.ts\|router.tsx"` on that output prints `0`.

Proof 4: `bun run check` exit 0 (layout, typecheck, lint, knip, jscpd, stubs 15 markers 0 on closed slices, prettier, vitest 11 files 188 tests passed); `bun run build` exit 0; `node workspace/05-plans/check-gotchas.mjs` prints `check-gotchas: OK (25 path entries, 91 process entries)`.

Watched-fails (replayed with the runner whose text is in the g4 close-out block of this log, `node ../scratch/replay.mjs <id>`; `--check` prints `checked 121, bad 0`; all 37 entries on `pipeline.ts` replayed `RED`, `not red 0`):
- (bm) `bm-page-refusal`: `} else if (refused) {` becomes `} else if (false) {`. Red: `FAIL ... answers a page asked for with Accept application/json with the R09 406`, `AssertionError: expected 500 to be 406`. Restored.
- (bn) `bn-page-406-all`: the same line becomes `} else if (!underApi) {`. Red: `FAIL ... leaves a page asked for with Accept text/html as it is`, `AssertionError: expected 406 to be 200` (the page-and-API case fails too). Restored.
- `pipe-406-no-store`: `response.status >= 500 || response.status === 406` becomes `response.status >= 500`. Red on the 406 test. Restored.
- `pipe-refusal-off`: `const refused = false;`. Red on `answers the router's refusal of GET with Accept application/json with the R09 405`. Restored.

UNPROVEN: the 406 on a deployed Worker (only `cf:preview` was run); whether B3's cache module stores a response that `neverCached` marks 406 (the pipeline never passes it to the store, since the status is decided after the hook returns).

### g5 · steps 4b, fix round (reviewer defects)

- GOTCHAS: P-094 added for the `python3 -` hang (measured: `python3` is Python 3.14.2 behind the WindowsApps path; fed `-` with an empty stdin it opens the interactive prompt, fails with `OSError: [WinError 6] The handle is invalid` and loops, 10.5 MB of traceback in 8 seconds). P-065's proof updated: knip prints 2 hints after step 4b, none naming `routeTree.gen.ts` or `router.tsx`. `node workspace/05-plans/check-gotchas.mjs` prints `check-gotchas: OK (25 path entries, 92 process entries)`.
- For the orchestrator's within-slice fold (H41 (7)); files owned by others, not touched here: `workspace/05-plans/B1b.md` line 120 still lists `src/router.tsx` in the `knip.json` entries and `src/routeTree.gen.ts` in its ignores (step 4b removed both); `workspace/05-plans/B3.md` line 80 lists `errorCodes` without `not_acceptable: 406` (H41 (1)); `pipeline.ts` says B3's `toErrorResponse` takes the code over.
- Re-run, same tree, same build: `bunx vitest run tests/unit/pipeline.test.ts` 81 passed. `bun run cf:preview`: `curl -s -D h.txt -o b.json -w "%{http_code} %{content_type}" -H "Accept: application/json" http://127.0.0.1:8788/` printed `406 application/json`, `Cache-Control: no-store`, header `x-request-id: 59cee20c-9d71-40d4-ad59-8fb57fa510cd` and body `requestId` the same; `Accept: text/html` printed `200 text/html; charset=utf-8`. Wrangler stopped by its parent: `listeners on 8788: 0`, `workerd left: 0`. `bun run knip` exit 0, two hints (`src/db/types.ts`, `supabase/functions/*/index.ts`). `bun run check` exit 0 (11 files, 188 tests); `bun run build` exit 0. Replay: `--check` `checked 121, bad 0`; `bm-page-refusal` RED (`× answers a page asked for with Accept application/json with the R09 406`); `bn-page-406-all` RED (`× leaves a page asked for with Accept text/html as it is`); both restored (`git status` shows no change under `app/`).

### g5 · steps 4b, second fix round (reviewer defects: runbook claim, rule 6 drift)

- Correction of a claim made twice above (the Findings bullet that begins "The runbook now says what H41 (2) and (3) accept", and the runbook text it describes): the trailing-slash 307 under `/api/` does NOT come bare. Measured under `bun run cf:preview`:
  `curl -s -D - -o /dev/null http://127.0.0.1:8788/api/hooks/sentry-test/`
  ```
  HTTP/1.1 307 Temporary Redirect
  Location: /api/hooks/sentry-test
  Cache-Control: no-store
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Content-Security-Policy-Report-Only: default-src 'self'; ...
  X-Frame-Options: DENY
  x-request-id: 6b1c850b-4395-448a-8973-70addb0f9f6f
  x-robots-tag: noindex, nofollow
  ```
  `curl -s --path-as-is -D - -o /dev/null http://127.0.0.1:8788//california`
  ```
  HTTP/1.1 308 Permanent Redirect
  Content-Length: 0
  Location: http://127.0.0.1:8788/california
  ```
  Only the `//` 308 is bare. `app/docs/runbooks/delivery.md` now says so (H41 (2) names the 308 as headerless; H41 (3) only accepts the 307), and says H1's header sweep covers the 307.
- `pipeline.ts`: the docstring of `neverCached` now says the 406 is on the list by ASSUMED H41 (1) and that architecture 13 rule 6 does not name it yet. Behaviour unchanged.
- For the orchestrator's within-slice fold (H41 (7)); files owned by others, not touched here, added to the list in the block above: `workspace/06-architecture/architecture.md` line 210 (rule 6: "any response with `Set-Cookie`, and every 5xx") and `workspace/05-plans/B1b.md` line 79 (invariant 10: "any response carrying `Set-Cookie`, and every 5xx (including the calm 500)") both need the 406 `not_acceptable` of a page whose `Accept` the router refuses added to the never-cached classes, or B3's `cache.ts`, built from rule 6, has no written reason to treat a 406 as never stored. Neither file names `not_acceptable` or 406 today (`git grep -n "not_acceptable" -- workspace/06-architecture/architecture.md` prints nothing). The earlier list stands: `B1b.md` line 120 (`knip.json` entries and ignores) and `B3.md` line 80 (`errorCodes` gets `not_acceptable: 406`).
- Bank: P-095 (a ruling's "accepted" copied into a runbook as a measured fact about headers). `node workspace/05-plans/check-gotchas.mjs` prints `check-gotchas: OK (25 path entries, 93 process entries)`.

Proofs, same tree after the edits (`bun run build` first):
- `cd app && bunx vitest run tests/unit/pipeline.test.ts` -> `Test Files  1 passed (1)`, `Tests  81 passed (81)`.
- `bun run cf:preview`, `curl -s -D h.txt -o b.json -w "%{http_code} %{content_type}\n" -H "Accept: application/json" http://127.0.0.1:8788/` -> `406 application/json`, `Cache-Control: no-store`, `X-Frame-Options: DENY`, `x-request-id: f303c963-d95e-4b8a-885d-d7c23c86e8e1`, body `{"error":{"code":"not_acceptable","message":"This address answers with a web page only.","requestId":"f303c963-d95e-4b8a-885d-d7c23c86e8e1"}}` (the `requestId` equals the header); `-H "Accept: text/html"` -> `200 text/html; charset=utf-8`.
- Wrangler stopped by its parents (P-042): `listeners on 8788: 0`, `workerd left: 0`.
- `bun run knip; echo exit=$?` -> `Configuration hints (2)`, `src/db/types.ts  knip.json  Remove from ignore`, `supabase/functions/*/index.ts  knip.json  Refine entry pattern (no matches)`, exit 0; `grep -c "routeTree.gen.ts\|router.tsx"` on it -> `0`.
- `bun run check` exit 0 (11 files, 188 tests passed); `bun run build` exit 0.
- Replay (runner text in the g4 close-out block): `--check` -> `checked 121, bad 0`; `RED bm-page-refusal: exit=1 expect=true | × answers a page asked for with Accept application/json with the R09 406`; `RED bn-page-406-all: exit=1 expect=true | × leaves a page asked for with Accept text/html as it is`; `RED pipe-406-no-store: ... × answers a page asked for with Accept application/json with the R09 406`; each restored, `git status` shows only the runbook, `pipeline.ts`, GOTCHAS and this log changed.

UNPROVEN: the 406 and the 307 headers on a deployed Worker (only `cf:preview` was run).

## g6 · steps 5

Built: `.github/workflows/ci.yml` (jobs `check` and `build`), `.github/dependabot.yml`, `.github/pull_request_template.md`, `app/package.json` (`engines` `{"bun": "1.3.13", "node": "24.x"}`, devDependency `yaml` ^2.9.1, script `migrations:check`), `app/bun.lock`, `app/scripts/check-migrations.mjs`, `app/tests/unit/check-migrations.test.ts`, `app/tests/unit/hygiene.test.ts`, 28 entries in `app/tests/mutations/B1b.json` (26 replayed, 2 `manual` for the two CI watched-fails). Draft PR #22 (`slice/b1b` into `main`): https://github.com/AbdulrahmanAmer/matter-of-place/pull/22. Commits `2904f2d` (step 5), `34efddc` and `2fd7643` (the two deliberate red commits), `5774a23` and `b5bf959` (their reverts).

Pins, resolved with `gh release view -R <repo> --json tagName` then `gh api repos/<repo>/commits/<tag> --jq .sha`: `actions/checkout` v7.0.1 `3d3c42e5aac5ba805825da76410c181273ba90b1`, `oven-sh/setup-bun` v2.2.0 `0c5077e51419868618aeaa5fe8019c62421857d6`, `actions/setup-node` v7.0.0 `820762786026740c76f36085b0efc47a31fe5020`, `actions/cache` v6.1.0 `55cc8345863c7cc4c66a329aec7e433d2d1c52a9`, `actions/upload-artifact` v7.0.1 `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`.

Where the build differs from the plan text (for the orchestrator's fold; B1b.md is not this group's file):
- Branch: the plan says push `ci/b1b`; the lane branch `slice/b1b` carries the draft PR.
- `hygiene.test.ts` line of Files: "`eslint.config.js` names ... `no-floating-promises`" cannot hold, the word is not in the file (`grep -c no-floating-promises eslint.config.js` -> `0`): `strictTypeChecked` switches the rule on. The test reads the resolved config with `ESLint.calculateConfigForFile` and asserts severity 2 for `no-floating-promises`, `switch-exhaustiveness-check`, `only-throw-error`, `no-console`, `vitest/no-focused-tests`, `projectService` true and `reportUnusedDisableDirectives` 2; the text check stays for `strictTypeChecked` (GOTCHAS P-096).
- The step `migration-order` runs `bun run migrations:check`, the gate command of STANDARDS G11 (`node scripts/check-migrations.mjs` behind it). The header is `-- contract-of:` (HO-4 done); STANDARDS R17's note "B1b names it `-- contract:`" is stale.
- `check-migrations.mjs` scans statements with `--` comments removed: the first version refused a plain expand migration because its R16 `-- down: drop table notes` header matched `drop table` (GOTCHAS G-026).
- `build` also runs `actions/setup-node` 24 (the build and the `worker-name` step run node; the pin then matches `engines.node`), and its upload sets `include-hidden-files: true`: upload-artifact's globber skips any item whose basename starts with a dot, the search root `.output` included (GOTCHAS P-099, read in `actions/toolkit` `internal-globber.ts` line 132; not measured with the flag off).
- In `check` the `engines` step runs after setup-node and before the cache step (the plan lists the cache first; `engines` is the first step that runs project code).
- `hygiene.test.ts` checks node and `BUN_PIN` pins as well as setup-bun against `engines`, and that no `.github` folder exists under `app/`.

Proof 1: `cd app && bunx vitest run tests/unit/hygiene.test.ts tests/unit/check-migrations.test.ts`
```
 Test Files  2 passed (2)
      Tests  29 passed | 9 skipped (38)
```
The 9 skipped, with their reasons printed (`--reporter=verbose`): `deploy.yml (skipped until step 6 writes it)` 5 cases, `backup.yml (skipped until step 8 writes it)` 2, `merge gate (invariant 6b; skipped until step 5b writes scripts/merge-gate.mjs)` 1, `job runner (skipped until B8 writes it)` 1. The R02 compiler case runs (not skipped).

Proof 2: `cd app && node scripts/check-migrations.mjs; echo exit=$?`
```
no migrations
exit=0
```

Proof 3: `git ls-files "app/bun.lock"` -> `app/bun.lock`; `node -p "require('./package.json').engines"` -> `{ bun: '1.3.13', node: '24.x' }`.

Proof 4, CI on the draft PR, run 36996622633 (event `pull_request`, head `2904f2d`): `gh run view 36996622633 --json jobs --jq '.jobs[] | [.name,.conclusion] | @tsv'`
```
check	success
build	success
```
No job named `audit` or `deno`. From the run log: step `migration-order` printed `no migrations`; `bun run check` printed `layout: OK (583 files)`, `stubs: 15 markers, 0 on closed slices`, `Test Files 13 passed (13)`; step `audit` (advisory, `continue-on-error`) printed `12 vulnerabilities (10 high, 2 moderate)`, the first `brace-expansion <1.1.17` through `eslint › @eslint/eslintrc › minimatch`. `gh run download 36996622633 -n build-output -D scratch/dl` -> `nitro.json package-lock.json package.json public server`, `scratch/dl/server/wrangler.json` present, `node -p "require('./scratch/dl/server/wrangler.json').name"` -> `matter-of-place`.

Proof 5, watched-fail (d) in CI: commit `34efddc` appends `const x: number = "a";` to `app/src/lib/cx.ts`. Run 36996821935, `gh run watch --exit-status` exit 1; jobs `build success`, `check failure`; check steps `engines success`, `migration-order success`, `Run bun run check failure`, `audit skipped`; `gh run view 36996821935 --log-failed`:
```
##[error]src/lib/cx.ts(5,7): error TS2322: Type 'string' is not assignable to type 'number'.
##[error]src/lib/cx.ts(5,7): error TS6133: 'x' is declared but its value is never read.
##[error]Process completed with exit code 2.
```
Reverted by `5774a23`; run 36997093930: `gh run watch` exit 0, `build success`, `check success`.

Proof 6, watched-fail engines in CI: commit `2fd7643` sets `engines.bun` to `1.3.14`. Run 36997237735: `check failure`, `build success`; check steps `engines failure`, then `Run actions/cache skipped`, `Run bun install --frozen-lockfile skipped`, `migration-order skipped`; the failed log:
```
engines {"bun":"1.3.14","node":"24.x"} runner 1.3.13 24
##[error]Process completed with exit code 1.
```
Reverted by `b5bf959`; run 36997322467: `gh run watch` exit 0, `build success`, `check success`.

Proof 7, local watched-fails, replayed with the runner whose text is in the g4 close-out block (`node ../scratch/replay.mjs <ids>` from `app/`; `--check` -> `checked 147, bad 0`; `git status --short` identical before and after): `replayed 26, not red 0`, among them
```
RED bd: exit=1 expect=true | +   "noUncheckedIndexedAccess",
RED f: exit=1 expect=true | +     "ci.yml check setup-bun 1.3.13, engines.bun 1.3.14",
RED g: exit=1 expect=true | AssertionError: expected [ 'bun /app daily', …(1) ] to deeply equal [ 'bun /app weekly', …(1) ]
RED ao: exit=1 expect=true | +     "ci.yml: - uses: actions/upload-artifact@v4",
RED ap: exit=1 expect=true | × refuses an added file with an older timestamp than main 7ms
RED cm-comments: exit=1 expect=true | × passes a clean tree and a new file after the newest on main 15ms
RED hy-pr-secret: exit=1 expect=true | +   "ci.yml check: secrets.DEV_SUPABASE_",
RED hy-lint-floating: exit=1 expect=true | × lint is type-aware, zero-warning and refuses the named rules 1439ms
RED hy-subtle: exit=1 expect=true | × only src/server/lib/crypto.ts calls crypto.subtle (CS-04) 31ms
```
(f) names both versions, (bd) names the flag. The others (`cm-applied`, `cm-destructive`, `cm-header-lines`, `hy-checkout`, `hy-permissions`, `hy-timeout`, `hy-concurrency`, `hy-working-directory`, `hy-one-build`, `hy-mop-dev`, `hy-r2`, `hy-ready`, `hy-template`, `hy-wrangler`, `hy-lint-warnings`, `hy-check-js`, `hy-release-age`) each printed `RED` with its own test title.

Proof 8, the skipped suites against stand-in files (not committed): temporary `.github/workflows/deploy.yml` and `backup.yml` holding the plan's strings, and `app/scripts/merge-gate.mjs` exporting `REQUIRED_PR_CHECKS = ["check", "build", "db", "e2e", "preview"]`. `bunx vitest run tests/unit/hygiene.test.ts` -> `Tests 1 failed | 30 passed | 1 skipped (32)`, the one red being `mergeGateJob: false` (step 5b adds the job). With the preview job given `${{ secrets.DEV_SUPABASE_DB_PASSWORD }}`, `needs: dev` changed, the Dependabot guard removed, `options: [dev, prod]` and `retention-days: 7`: 5 red (`no job a pull request can reach ...`, `preview refuses forks and Dependabot`, `production needs dev, ...`, `offers only the dev target ...`, the merge gate case). The stand-ins were deleted; `git status --short` showed only this group's files.

Proof 9: `cd app && bun run check` exit 0 (`layout: OK (583 files)`, `stubs: 15 markers, 0 on closed slices`, `Test Files 13 passed (13)`, `Tests 217 passed | 9 skipped (226)`); `bun run build` exit 0 (three `built in` lines); `node workspace/05-plans/check-gotchas.mjs` -> `check-gotchas: OK (26 path entries, 97 process entries)`.

GOTCHAS: G-026 (comments in the destructive scan), P-096 (a plan's text check of a preset rule), P-097 (asymmetric matchers are `any` to the lint), P-098 (the guard refuses `--no-verify`; `git revert` has no `-q`, and a `;` chain then watched the old red run), P-099 (upload-artifact skips `.output`).

UNPROVEN:
- Dependabot: `gh pr list --author "app/dependabot"` lists nothing until the first Monday run (2026-10-05, 06:00 America/New_York); the `bun` ecosystem is ASSUMED available (fallback `npm` per the plan's risk line, after two Mondays).
- The skipped `deploy.yml`, `backup.yml`, merge gate and `deno.lock` cases: proved only against stand-ins (Proof 8), watched-fail on the real files when steps 5b, 6, 8 and B8 land.
- The heavy-job `if:` case passes with no `db`, `e2e` or `preview` job in any workflow (nothing to check yet); watched-fail when step 6 (`preview`) or B4 (`db`, `e2e`) lands.
- `bun audit`: 12 advisories (10 high, 2 moderate) in the dependency tree, advisory until HARDEN; not triaged here.

## g6 · steps 5

Fix round after the reviewer's rejection (five defects). Commits `1cd0b53` (the fix), `d2357d6` and `4bd66a2` (the two deliberate red commits), `593448c` and `c5631a6` (their reverts), on `slice/b1b`, draft PR #22.

What changed:
- `hygiene.test.ts`: `splitWorkflow` returns each job's slice and the workflow's own text outside the `jobs:` map (`head`). The secret case scans `head` whenever any job of the workflow is reachable from a pull request; the invariant 13 case scans the whole `ci.yml` text for `group: mop-dev`, `DEV_SUPABASE_` and `SUPABASE_ACCESS_TOKEN` (defect 1, GOTCHAS G-027).
- Two R54 cases the plan's Files line (line 147) does not list: `no run: line holds attacker-controllable context (R54)` (a `${{ }}` holding `github.event.*.title` or `.body`, `head.ref`, `github.head_ref` or `inputs.` inside any `run:` line) and `every bun install in a workflow is --frozen-lockfile (R54)` (defect 2). Stale plan line for the fold: B1b.md line 147 should name both clauses of STANDARDS R54 (GOTCHAS P-101).
- `the check job compares the runner with engines before installing (8)`: finds the `engines` step of `check`, requires it before `bun install`, and runs its own `node -e` script twice: with `BUN_PIN` equal to `engines.bun` it exits 0, with `0.0.1` it exits 1 and prints `engines` (defect 5).
- `ci.yml` header states its cost (C22): check 58 to 66 s, build 22 to 36 s, each billed rounded up to a minute, so 2 to 3 Actions minutes a run against the 2,000 a month of P-009 (defect 4). This round's runs agree: 36999309251 check 60 s, build 30 s; 36999788326 check 63 s, build 30 s.
- 8 registry entries: `hy-workflow-env`, `hy-workflow-ref`, `hy-workflow-group`, `hy-untrusted-title`, `hy-untrusted-head-ref`, `hy-frozen`, `hy-engines-gone`, `hy-engines-exit`.
- GOTCHAS: G-027 (job slices miss workflow-level env), P-100 (a lane-root scratch script cannot import an app package by bare name, the unbanked cost of the first round, defect 3), P-101 (a gate STANDARDS names must assert every clause; walk the C-lines).

Proof 1: `cd app && bunx vitest run tests/unit/hygiene.test.ts tests/unit/check-migrations.test.ts`
```
 Test Files  2 passed (2)
      Tests  32 passed | 9 skipped (41)
```
The 9 skipped are the same suites as before (deploy.yml 5, backup.yml 2, merge gate 1, job runner 1); the R02 compiler case runs.

Proof 2: `cd app && node scripts/check-migrations.mjs; echo migrations=$?`
```
no migrations
migrations=0
```

Proof 3: `git ls-files "app/bun.lock"` -> `app/bun.lock`.

Proof 4, CI on the fix commit `1cd0b53`, run 36999309251: `gh run watch` exit 0; `gh run view 36999309251 --json jobs --jq '.jobs[] | [.name,.conclusion] | @tsv'`
```
check	success
build	success
```
No job named `audit` or `deno`; check steps `engines`, `Run bun install --frozen-lockfile`, `migration-order`, `Run bun run check`, `audit` all `success` (the new engines case of `hygiene.test.ts` ran on the Linux runner under node 24 and passed). `gh run download 36999309251 -n build-output -D scratch/dl2` -> `nitro.json package-lock.json package.json public server`; `node -p "require('./scratch/dl2/server/wrangler.json').name"` -> `matter-of-place`.

Proof 5, watched-fail (d) in CI: `d2357d6` appends `const x: number = "a";` to `app/src/lib/cx.ts`. Run 36999473817: `gh run watch --exit-status` exit 1, `build success`, `check failure`; `gh run view 36999473817 --log-failed`:
```
##[error]src/lib/cx.ts(5,7): error TS2322: Type 'string' is not assignable to type 'number'.
##[error]src/lib/cx.ts(5,7): error TS6133: 'x' is declared but its value is never read.
##[error]Process completed with exit code 2.
```
Reverted by `593448c`; run 36999566872: exit 0, `check success`, `build success`.

Proof 6, watched-fail engines in CI: `4bd66a2` sets `engines.bun` to `1.3.14`. Run 36999703429: exit 1, `build success`, `check failure`; check steps `engines failure`, then cache, `bun install --frozen-lockfile` and `migration-order` `skipped`; the failed log:
```
engines {"bun":"1.3.14","node":"24.x"} runner 1.3.13 24
##[error]Process completed with exit code 1.
```
Reverted by `c5631a6`; run 36999788326: exit 0, `check success`, `build success`.

Proof 7, local watched-fails with the replay runner of the g4 close-out block (`node ../scratch/replay.mjs`, from `app/`): `--check` -> `checked 155, bad 0`. The 8 new entries:
```
RED hy-workflow-env: exit=1 expect=true | +   "ci.yml (workflow): secrets.DEV_SUPABASE_",
RED hy-workflow-ref: exit=1 expect=true | × no ci.yml job reads or writes mop-dev, workflow env included (13) 9ms
RED hy-workflow-group: exit=1 expect=true | × no ci.yml job reads or writes mop-dev, workflow env included (13) 9ms
RED hy-untrusted-title: exit=1 expect=true | × no run: line holds attacker-controllable context (R54) 9ms
RED hy-untrusted-head-ref: exit=1 expect=true | × no run: line holds attacker-controllable context (R54) 9ms
RED hy-frozen: exit=1 expect=true | × every bun install in a workflow is --frozen-lockfile (R54) 12ms
RED hy-engines-gone: exit=1 expect=true | × the check job compares the runner with engines before installing (8) 115ms
RED hy-engines-exit: exit=1 expect=true | × the check job compares the runner with engines before installing (8) 119ms
replayed 8, not red 0
```
They are the reviewer's M1 (`hy-workflow-env`, `hy-workflow-ref`), M2 (`hy-untrusted-title`), M3 (`hy-frozen`) and M4 (`hy-engines-gone`), plus the concurrency group case the reviewer suspected. The 26 entries of the first round, replayed again: `replayed 26, not red 0`, among them
```
RED bd: exit=1 expect=true | +   "noUncheckedIndexedAccess",
RED f: exit=1 expect=true | +     "ci.yml check setup-bun 1.3.13, engines.bun 1.3.14",
RED g: exit=1 expect=true | AssertionError: expected [ 'bun /app daily', …(1) ] to deeply equal [ 'bun /app weekly', …(1) ]
RED ao: exit=1 expect=true | +     "ci.yml: - uses: actions/upload-artifact@v4",
RED ap: exit=1 expect=true | × refuses an added file with an older timestamp than main 14ms
RED hy-mop-dev: exit=1 expect=true | × no ci.yml job reads or writes mop-dev, workflow env included (13) 9ms
```
`git status --short` was identical before and after both replays.

Proof 8: `cd app && bun run check` exit 0 (`layout: OK (583 files)`, `stubs: 15 markers, 0 on closed slices`, `Test Files 13 passed (13)`, `Tests 220 passed | 9 skipped (229)`); `bun run build` exit 0 (three `built in` lines); `node workspace/05-plans/check-gotchas.mjs` -> `check-gotchas: OK (27 path entries, 99 process entries)`.

UNPROVEN:
- Dependabot: `gh pr list --author "app/dependabot" --state all --json number --jq length` -> `0` today; proved after the first Monday run (2026-10-05).
- The skipped `deploy.yml`, `backup.yml`, merge gate and `deno.lock` cases, and the heavy-job `if:` case, as in the first round's list.
- The engines step compares `BUN_PIN` (a literal kept equal to `engines.bun` and to setup-bun's `bun-version` by the pins case), not the output of `bun --version`; a setup-bun that installed another version than asked would pass it. Not a reviewer defect; named for the orchestrator.

## g6 · steps 5

Fix round 2 after the reviewer's rejection (three defects). Commits `f175423` (the fix), `42e2ade` and `22925fe` (the two deliberate red commits), `a0d1a6d` and `8e93a5d` (their reverts), on `slice/b1b`, draft PR #22.

What changed:
- `hygiene.test.ts`, defect 1: new case `a step that calls gh reads GH_TOKEN from its env and nowhere else (15)`, the clause of invariant 15 that had no assertion. A step calls `gh` when a line of its `run:` does, or when it runs `node <script>` and that script spawns `gh` (step 5b's `merge-gate` job runs `node scripts/merge-gate.mjs`, which calls `gh api`). Such a step must have `GH_TOKEN` in its `env`, and its `run:` must not hand a token another way (`GH_TOKEN=`, `GITHUB_TOKEN=`, `gh auth login`, an inline `${{ secrets.* }}` or `${{ github.token }}`). No step calls `gh` today, so the case passes on an empty list; the three registry entries add one and watch it red. Stale plan line for the fold: B1b.md line 147 should name this clause of invariant 15 (GOTCHAS P-101, extended).
- `splitWorkflow` walks the parsed tree only (`contents`, the `jobs` pair, its value), so every `range` it reads is typed non-null and no range guard is left; the reviewer's "half done" line 61 is gone (GOTCHAS P-102).
- 3 registry entries: `hy-gh-direct` (`gh api user` in the audit step), `hy-gh-script` (`node ../workspace/05-plans/ready.mjs`, a tracked script that spawns `gh`), `hy-gh-token-elsewhere` (`GH_TOKEN` in `env` and a second token piped into `gh auth login`).
- GOTCHAS, defects 2 and 3: P-102 (yaml types `range` non-null from the parsed tree and nullable from `get()`, so `no-unnecessary-condition` fires on one guard and not the other), P-103 (destructuring a `map`-built array under `noUncheckedIndexedAccess` gives `T | undefined`); P-101 records the repeat.

Proof 1: `cd app && bunx vitest run tests/unit/hygiene.test.ts tests/unit/check-migrations.test.ts`
```
 Test Files  2 passed (2)
      Tests  33 passed | 9 skipped (42)
```

Proof 2: `cd app && node scripts/check-migrations.mjs; echo "exit $?"`
```
no migrations
exit 0
```

Proof 3: `git ls-files "app/bun.lock"` -> `app/bun.lock`.

Proof 4, CI on the fix commit `f175423`, run 37001450768: `gh run watch --exit-status` exit 0; `gh run view 37001450768 --json jobs --jq '.jobs[] | [.name,.conclusion] | @tsv'`
```
build	success
check	success
```
No job named `audit` or `deno`; check steps `engines`, `Run bun install --frozen-lockfile`, `migration-order`, `Run bun run check`, `audit`. `gh run download 37001450768 -n build-output -D scratch/dl3` -> `nitro.json package-lock.json package.json public server`; `node -p "require('./scratch/dl3/server/wrangler.json').name"` -> `matter-of-place`.

Proof 5, watched-fail (d) in CI: `42e2ade` appends `const x: number = "a";` to `app/src/lib/cx.ts`. Run 37001631430: `gh run watch --exit-status` exit 1, `check failure`, `build success`; `gh run view 37001631430 --log-failed`:
```
##[error]src/lib/cx.ts(5,7): error TS2322: Type 'string' is not assignable to type 'number'.
##[error]src/lib/cx.ts(5,7): error TS6133: 'x' is declared but its value is never read.
```
Reverted by `a0d1a6d`; run 37001725655: exit 0, `build success`, `check success`.

Proof 6, watched-fail engines in CI: `22925fe` sets `engines.bun` to `1.3.14`. Run 37001853318: exit 1, `build success`, `check failure`, failed step `engines`; the failed log:
```
engines {"bun":"1.3.14","node":"24.x"} runner 1.3.13 24
```
Reverted by `8e93a5d`; run 37001929305: exit 0, `check success`, `build success`.

Durations this round (C22): check 63, 54 and 53 s, build 21, 23 and 23 s, each billed as one minute: 2 Actions minutes a run, inside the `ci.yml` header's 2 to 3.

Proof 7, local watched-fails, replay runner of the g4 close-out block (`node ../scratch/replay.mjs`, from `app/`): `--check` -> `checked 158, bad 0`. All 37 entries of step 5 (`bd f g ao ap`, the 4 `cm-*`, the 28 `hy-*`): `replayed 37, not red 0`, among them
```
RED bd: exit=1 expect=true | +   "noUncheckedIndexedAccess",
RED f: exit=1 expect=true | +     "ci.yml check setup-bun 1.3.13, engines.bun 1.3.14",
RED g: exit=1 expect=true | AssertionError: expected [ 'bun /app daily', …(1) ] to deeply equal [ 'bun /app weekly', …(1) ]
RED ao: exit=1 expect=true | +     "ci.yml: - uses: actions/upload-artifact@v4",
RED ap: exit=1 expect=true | × refuses an added file with an older timestamp than main 7ms
RED hy-gh-direct: exit=1 expect=true | AssertionError: expected [ 'ci.yml check: audit' ] to deeply equal []
RED hy-gh-script: exit=1 expect=true | AssertionError: expected [ 'ci.yml check: audit' ] to deeply equal []
RED hy-gh-token-elsewhere: exit=1 expect=true | AssertionError: expected [ 'ci.yml check: audit' ] to deeply equal []
replayed 37, not red 0
```
With `hy-gh-direct` applied by hand the red case is the new one: `× a step that calls gh reads GH_TOKEN from its env and nowhere else (15)`, `Tests 1 failed | 26 passed | 9 skipped (36)`. Control: the same audit step with `env: GH_TOKEN: ${{ github.token }}` and `run: gh api user && bun audit` stays green (`Tests 27 passed | 9 skipped (36)`), so the case does not refuse a correct step. `git status --short` was identical before and after.

Proof 8: `cd app && bun run check` exit 0 (`Test Files 13 passed (13)`, `Tests 221 passed | 9 skipped (230)`); `bun run build` exit 0 (three `built in` lines); `node workspace/05-plans/check-gotchas.mjs` -> `check-gotchas: OK (27 path entries, 101 process entries)`.

UNPROVEN:
- Dependabot: `gh pr list --author "app/dependabot" --state all` prints nothing today; proved after the first Monday run (2026-10-05).
- The `gh` case has never seen a real `gh` step: it is proved by mutations only until step 5b adds the `merge-gate` job. It detects `gh` called from a `run:` line or from a `node <script>` the step runs; a `gh` call reached through `bun run <name>` (a package script) is not followed.
- The skipped `deploy.yml`, `backup.yml`, merge gate and `deno.lock` cases, and the heavy-job `if:` case, as in the earlier rounds.

## g7 · steps 5b

Group g7, the merge gate (invariant 6b, DO-04, T-03). Commit `f9954c0` on `slice/b1b` (draft PR #22), plus the commit that carries this block and GOTCHAS P-104 and P-105. Probe PR #24 was opened and closed, its branch `gate-probe` deleted.

What changed:
- `app/scripts/merge-gate.mjs` (new): exports `REQUIRED_PR_CHECKS` (`check build db e2e preview`), `evaluateMergeGate`, `jobKeys` and `gatherInput`; run directly it is the post-merge check. It uses only node and `gh` (no zod, no yaml: the CI job installs nothing), and reads `gh` output through `--jq` filters that emit tab-separated rows, so no `JSON.parse` result is ever typed `any`. A commit counts as a merged PR only when a PR's `merge_commit_sha` equals `GITHUB_SHA`. A required check that has no run is `<job> missing`; an unfinished one prints its status (`build in_progress`).
- `workspace/05-plans/merge-gate.mjs` (new): refuses a draft (`mark ready first`), fetches `origin main` and `pull/<n>/head`, prints `rebase first` when `origin/main` is not an ancestor of the head, requires `gh pr checks` to exit 0 (it prints every failed, pending and skipped check first), posts the `merge-gate` status and runs `gh pr merge --merge --match-head-commit <sha>`.
- `.github/workflows/ci.yml`: job `merge-gate` (`if: github.event_name == 'push'`, `timeout-minutes: 5`, permissions `contents`, `pull-requests`, `checks`, `statuses` all `read`, checkout, setup-node 24, `node scripts/merge-gate.mjs` with `GH_TOKEN` and `CI_HEAVY` in its env); the header comment states its cost (C22).
- `app/tests/unit/merge-gate.test.ts` (new, 15 cases) and `app/tests/unit/hygiene.test.ts`: the merge gate describe is no longer skipped; the file imports `REQUIRED_PR_CHECKS` and `jobKeys` statically, keeps the case "every pull request job of ci.yml, and deploy.yml's preview, is a required check", and adds two: the `merge-gate` job runs on push only with exactly the four read permissions and runs the script, and `jobKeys` returns the same names as the YAML parser for every workflow. The step 5 `gh` case now sees a real `gh` step (see Proof 6).
- `app/tests/mutations/B1b.json`: 21 entries, all `file` entries: `aq`, `aq-hygiene` (the two halves of Verification (aq)), `mg-required`, `mg-status`, `mg-missing`, `mg-defined`, `mg-dependabot`, `mg-dependabot-scope`, `mg-heavy`, `mg-heavy-scope`, `mg-nopr`, `mg-gather-merge-commit`, `mg-gather-head`, `mg-gather-conclusion`, `mg-jobkeys-margin`, `mg-jobkeys-stop`, `hy-mg-if`, `hy-mg-permissions`, `hy-mg-script`, `hy-mg-gh-token`, `hy-mg-jobkeys`.

Proof 1: `cd app && bunx vitest run tests/unit/merge-gate.test.ts tests/unit/hygiene.test.ts`
```
 Test Files  2 passed (2)
      Tests  45 passed | 8 skipped (53)
```
(the 8 skipped are the `deploy.yml`, `backup.yml` and `deno.lock` cases of steps 6 to 8 and B8; the merge gate case moved out of them.)

Proof 2, watched-fail (aq) and the rest, replayed with the runner of the g4 close-out block (`node ../scratch/replay.mjs <ids>` from `app/`; `--check` -> `checked 179, bad 0`; `git status --short` identical before and after):
```
RED aq: exit=1 expect=true | × refuses a failed e2e and names it 9ms
RED aq-hygiene: exit=1 expect=true | × every pull request job of ci.yml, and deploy.yml's preview, is a required check 10ms
RED mg-required: exit=1 expect=true | × names the pull request jobs, not the steps merged into them 9ms
RED mg-status: exit=1 expect=true | × refuses a head without the merge-gate status, or with one that is not success 8ms
RED mg-missing: exit=1 expect=true | × refuses a required check that has no run on the head 8ms
RED mg-defined: exit=1 expect=true | × does not require a check that no workflow at the commit defines 9ms
RED mg-dependabot: exit=1 expect=true | × does not require preview from Dependabot, and says so 8ms
RED mg-dependabot-scope: exit=1 expect=true | × does not require preview from Dependabot, and says so 8ms
RED mg-heavy: exit=1 expect=true | × refuses a skipped e2e unless CI_HEAVY is off, and never a skipped check or build 8ms
RED mg-heavy-scope: exit=1 expect=true | × refuses a skipped e2e unless CI_HEAVY is off, and never a skipped check or build 8ms
RED mg-nopr: exit=1 expect=true | × refuses a commit that is no merged pull request 8ms
RED mg-gather-merge-commit: exit=1 expect=true | × ignores a pull request that only contains the commit and reads no head 9ms
RED mg-gather-head: exit=1 expect=true | × finds the pull request merged as this commit and reads its head 10ms
RED mg-gather-conclusion: exit=1 expect=true | × finds the pull request merged as this commit and reads its head 11ms
RED mg-jobkeys-margin: exit=1 expect=true | × reads the job keys of the jobs map and nothing else 8ms
RED mg-jobkeys-stop: exit=1 expect=true | × stops at the next top-level key 1ms
RED hy-mg-if: exit=1 expect=true | × the merge-gate job runs on push only, with read access to pull requests, checks and statuses 2ms
RED hy-mg-permissions: exit=1 expect=true | × the merge-gate job runs on push only, with read access to pull requests, checks and statuses 8ms
RED hy-mg-script: exit=1 expect=true | × the merge-gate job runs on push only, with read access to pull requests, checks and statuses 9ms
RED hy-mg-gh-token: exit=1 expect=true | × a step that calls gh reads GH_TOKEN from its env and nowhere else (15) 10ms
RED hy-mg-jobkeys: exit=1 expect=true | × the gate reads the same job names as the YAML parser, in every workflow 9ms
replayed 21, not red 0
```
`aq` makes `evaluateMergeGate` ignore conclusions (`const conclusion = "success";`) and the red-e2e fixture goes red; `aq-hygiene` adds a job `scratch` to `ci.yml` without listing it in `REQUIRED_PR_CHECKS` and `hygiene.test.ts` goes red. The appender that wrote the 21 entries was `scratch/g7-merge.mjs` (a one-off; the registry is the record, no proof replays it).

Proof 3, the probe PR (cut from an older main), on `slice/b1b` after the probe was pushed:
```
$ git switch -c gate-probe origin/main~1 ; git merge-base --is-ancestor origin/main HEAD ; echo $?
1                                  (HEAD ae1d7dc, origin/main abaa02d)
$ gh pr create --draft --base main --head gate-probe ...   -> https://github.com/AbdulrahmanAmer/matter-of-place/pull/24
$ gh pr ready 24                   -> ✓ Pull request AbdulrahmanAmer/matter-of-place#24 is marked as "ready for review"
$ git switch slice/b1b ; node workspace/05-plans/merge-gate.mjs 24 ; echo "exit $?"
rebase first
exit 1
$ gh api repos/AbdulrahmanAmer/matter-of-place/commits/<probe head>/status --jq '.statuses | length'
0                                  (no merge-gate status was posted)
$ gh pr close 24 --delete-branch   -> ✓ Closed pull request #24 ... ✓ Deleted branch gate-probe
$ git ls-remote --heads origin
abaa02de74944bfc2f0a39825849da50628bb840	refs/heads/main
f9954c0c5fa0efc4f5f9996a4d8ceca60b257db2	refs/heads/slice/b1b
```
The probe commit appended one comment line to `app/src/lib/cx.ts` (no CI ran on it: `main` has no `ci.yml` yet). The script was run from `slice/b1b` because the probe branch predates it (GOTCHAS P-105).

Proof 4, the other refusals of the orchestrator script, on the real draft PR #22 and with no argument:
```
$ node workspace/05-plans/merge-gate.mjs 22 ; echo "exit $?"
mark ready first
exit 1
$ node workspace/05-plans/merge-gate.mjs ; echo "exit $?"
usage: node workspace/05-plans/merge-gate.mjs <pr>
exit 2
```

Proof 5, the post-merge script against the real API (`gh` login of the laptop; run from `app/`; these commits are not gate merges, so refusals are the expected answer, and they show that the three `gh api` calls and their `--jq` rows parse):
```
$ GITHUB_SHA=abaa02de74944bfc2f0a39825849da50628bb840 node scripts/merge-gate.mjs ; echo "exit $?"      (the merge of PR #23, no CI ran on it)
unverified merge abaa02de74944bfc2f0a39825849da50628bb840: merge-gate missing
unverified merge abaa02de74944bfc2f0a39825849da50628bb840: check missing
unverified merge abaa02de74944bfc2f0a39825849da50628bb840: build missing
exit 1
$ GITHUB_SHA=94387e074ea36fa7179b2e58f7f9443e228e57d0 node scripts/merge-gate.mjs ; echo "exit $?"      (the lane head, not a merge commit)
unverified merge 94387e074ea36fa7179b2e58f7f9443e228e57d0: no pull request
exit 1
$ env -u GITHUB_SHA node scripts/merge-gate.mjs ; echo "exit $?"
merge-gate: GITHUB_SHA is not set
exit 2
```
The fixtures of `merge-gate.test.ts` follow the real answers of `gh api repos/AbdulrahmanAmer/matter-of-place/commits/abaa02d.../pulls` (`<merge sha> TAB 23 TAB 0a59cc2... TAB AbdulrahmanAmer`, the first row is verbatim) and of `.../commits/94387e0.../check-runs` (`check TAB completed TAB success`), taken 2026-10-02; the `build TAB in_progress TAB (empty)` row is made up to cover a null conclusion, and the status row is the shape of the combined-status answer (the real one is empty today).

Proof 6, CI on `f9954c0` (run 37004591303, event `pull_request`), `gh run view 37004591303 --json headSha,conclusion,jobs --jq '.headSha, .conclusion, (.jobs[] | [.name,.conclusion] | @tsv)'`:
```
f9954c0c5fa0efc4f5f9996a4d8ceca60b257db2
success
check	success
build	success
merge-gate	skipped
```
The workflow parses and the job is skipped on a pull request, as invariant 6b says (push to `main` only). The step 5 `gh` case, which had only mutations to stand on, now runs against the real `merge-gate` step (its `run` is `node scripts/merge-gate.mjs`, the script spawns `gh`) and goes red when `GH_TOKEN` leaves its env (`hy-mg-gh-token`).

Proof 7: `cd app && bun run check` exit 0 (`layout: OK (586 files)`, knip `Configuration hints (2)` unchanged, `Found 0 clones.`, `stubs: 15 markers, 0 on closed slices`, `Test Files 14 passed (14)`, `Tests 239 passed | 8 skipped (247)`); `bun run build` exit 0 (three `built in` lines); `node workspace/05-plans/check-gotchas.mjs` -> `check-gotchas: OK (27 path entries, 103 process entries)`.

NOT DONE:
- The merge of the B1b pull request with `node workspace/05-plans/merge-gate.mjs 22` and the `merge-gate` job on that merge's `ci` run. The brief's standing rules forbid a worker to merge, and #22 holds a partial slice (steps 6 to 9 are not built). The orchestrator runs it when the slice is done: mark #22 ready, `git merge origin/main` into the lane if the script prints `rebase first`, `node workspace/05-plans/merge-gate.mjs 22`, then `gh run list --workflow ci.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId'` and `gh run view <id> --json jobs --jq '.jobs[] | [.name,.conclusion] | @tsv'` must list `merge-gate success`. UNPROVEN until then: the job's `GITHUB_TOKEN` permissions on `commits/<sha>/pulls`, `status` and `check-runs` (proved here only with the laptop login), its cost (about 10 s, one billed minute, a guess in the `ci.yml` header), and that `CI_HEAVY` reaches it (`${{ vars.CI_HEAVY }}` is empty when the variable is absent, which the script reads as on).
- A `job whose steps were all skipped` is printed as a `skipped:` line for every check of the `skipping` bucket of `gh pr checks`: a job skipped by its `if:`. A job that ran with every step skipped concludes `success` and the check data cannot tell it from a normal one.

For the fold (stale plan lines, ASSUMED H and STANDARDS bind; no plan file was touched):
- B1b.md line 138: `evaluateMergeGate` takes `sha` (it prints `unverified merge <sha>` and the no-pull-request case has no PR to carry it), its `pr` is `{ number, author }`, and `gatherInput({ sha, gh, workflows, ciHeavy })` and `jobKeys(text)` are exported beside it; when the verdict is ok the last line is `merge-gate: OK <sha> (pull request #<n>)`. A check of `REQUIRED_PR_CHECKS` with no run on the head is `<job> missing`.
- B1b.md line 147 (`hygiene.test.ts`): name the two added cases (the job's trigger, permissions and script; `jobKeys` equals the YAML job names) and say the module is imported statically now that it exists.
- B1b.md line 112 and invariant 6b: a PR with no checks at all (a docs-only or chore PR; `ci.yml` has `paths-ignore`) is refused by `gh pr checks`, GOTCHAS P-104; the orchestrator decides the exception.
- `docs/runbooks/delivery.md` (not in this group's files): when it is written it needs the merge gate paragraph of its Files line (how to read an `unverified merge` line).

GOTCHAS: P-104 (no checks on a docs-only PR make the gate refuse it) and P-105 (the probe branch and the lane tree) added.

## g7 · steps 5b (fix round: three defects of the review)

Commit `95c3495` on `slice/b1b` (draft PR #22), plus the commit that carries this block. Files: `app/scripts/merge-gate.mjs`, `app/tests/unit/merge-gate.test.ts`, `app/tests/mutations/B1b.json`, `workspace/05-plans/merge-gate.mjs`, `GOTCHAS.md` (the brief named it as a defect), this log. `hygiene.test.ts` and `ci.yml` needed no change.

What changed:
- `workspace/05-plans/merge-gate.mjs` (defect 1): `gh pr checks --json` exits 0 whatever the checks are, so the old script posted `merge-gate=success` and merged a red head. The gate is now the exported `mergeGate(pr, run)` (commands injected, the file still runs as a script): it reads the `bucket` of every row, lets only `pass` and `skipping` through (`fail`, `pending`, `cancel` and any other bucket refuse with `merge-gate: checks are not all green`), and refuses an empty list or a non-zero exit (a PR with no checks, P-104). Nothing is written before the last refusal.
- `app/scripts/merge-gate.mjs` (defect 2): the check-runs of one SHA hold one run per workflow run (draft, ready, cancelled, re-run). The jq row now carries the run `id` and `latestRun` judges the highest id of each required name, so an older skipped or cancelled run no longer turns `main` red. A latest run that is skipped or cancelled still refuses (apart from the `CI_HEAVY=off` exception).
- `app/tests/unit/merge-gate.test.ts`: 23 cases (8 new): the latest run wins whatever the list order, an older success never saves a latest failure; the orchestrator script through `mergeGate` with a fake `run`: pass and skipping merge, `fail`, `pending` and `cancel` refuse with no `gh api -X` and no `gh pr merge` call, no checks refuse, draft and `rebase first` refuse before checks are read.
- `GOTCHAS.md` (defect 3): P-106 (`gh pr checks --json` exit code), P-107 (check-runs hold one run per workflow run); P-104's first lines no longer say the script requires exit 0.
- `app/tests/mutations/B1b.json`: `mg-missing` re-pointed (its `find` moved with the code); new `mg-latest-run`, `mg-latest-order`, `mg-bucket`, `mg-bucket-pending`, `mg-nochecks`, `mg-draft`, `mg-rebase`. 186 entries, `--check` bad 0.

Proof 1: `cd app && bunx vitest run tests/unit/merge-gate.test.ts tests/unit/hygiene.test.ts`
```
 Test Files  2 passed (2)
      Tests  53 passed | 8 skipped (61)
```

Proof 2, watched-fail (aq) and every other g7 entry replayed (`node ../scratch/replay.mjs <ids>` from `app/`; `git status --short` unchanged after): 28 entries (the 21 of the first round and the 7 new), `replayed 28, not red 0`. The new and the re-pointed ones:
```
RED aq: exit=1 expect=true | × refuses a failed e2e and names it 9ms
RED mg-missing: exit=1 expect=true | × refuses a required check that has no run on the head 8ms
RED mg-latest-run: exit=1 expect=true | × judges the latest run of a name, wherever the list puts it 9ms
RED mg-latest-order: exit=1 expect=true | × refuses when the latest run failed, whatever an older run of the name did 1ms
RED mg-bucket: exit=1 expect=true | × refuses a fail check although gh pr checks --json exits 0, and writes nothing 9ms
RED mg-bucket-pending: exit=1 expect=true | × refuses a pending check although gh pr checks --json exits 0, and writes nothing 10ms
RED mg-nochecks: exit=1 expect=true | × refuses a pull request that has no checks, and writes nothing 9ms
RED mg-draft: exit=1 expect=true | × refuses a draft and a head that does not contain origin/main before it reads a check 9ms
RED mg-rebase: exit=1 expect=true | × refuses a draft and a head that does not contain origin/main before it reads a check 9ms
```
`mg-bucket` puts back the old behaviour (`if (checks.status !== 0) blocked = true;`): the three bucket cases go red because the script then posts and merges.

Proof 3, the reviewer's own evidence, run again against the real `gh` (a `--require` shim in `scratch/` runs `gh pr view` and `gh pr checks` on cli/cli, stubs git and prints the two write calls instead of running them; PR 13788 has three failed builds). The script of HEAD before this round, then the new one:
```
--- OLD (HEAD)
fail: Unit and Integration Tests build (ubuntu-latest)
fail: Unit and Integration Tests build (macos-latest)
fail: Unit and Integration Tests build (windows-latest)
SHIM would run: gh api -X POST repos/AbdulrahmanAmer/matter-of-place/statuses/2537a3b6931a787d6b4b0ab686cd4cf7eda0dfda -f state=success -f context=merge-gate
SHIM would run: gh pr merge 13788 --merge --match-head-commit 2537a3b6931a787d6b4b0ab686cd4cf7eda0dfda
exit 0
--- NEW
fail: Unit and Integration Tests build (ubuntu-latest)
fail: Unit and Integration Tests build (macos-latest)
fail: Unit and Integration Tests build (windows-latest)
merge-gate: checks are not all green
exit 1
```
`gh pr checks 14148 -R cli/cli --json bucket >/dev/null; echo $?` → `0`; the same without `--json` → `1`; `gh pr checks 23 --json bucket` (no checks) → `no checks reported on the 'chore/b1b-g5-records' branch`, exit 1. `gh api "repos/vitest-dev/vitest/commits/89d191ec.../check-runs?per_page=100"` returns two `Lint: node-latest, ubuntu-latest` rows, `skipped` and `success`. The post-merge script's new jq column was run against the real API (`id: 110826041371, name: 'check', status: 'completed', conclusion: 'success'` for the lane head `94387e0`).

Proof 4, the probe PR #25 (draft, cut from `origin/main~1`, one commit `821c3fc`, then `gh pr ready 25`), the script run from `slice/b1b` (P-105):
```
$ git merge-base --is-ancestor origin/main HEAD ; echo $?          (HEAD 821c3fc, origin/main abaa02d)
1
$ node workspace/05-plans/merge-gate.mjs 25 ; echo "exit $?"
rebase first
exit 1
$ gh api .../commits/<probe head>/status --jq '.statuses | length'
0
$ node workspace/05-plans/merge-gate.mjs 22 ; echo "exit $?"      (the lane PR, still a draft)
mark ready first
exit 1
$ gh pr close 25 --delete-branch   -> ✓ Closed pull request #25 ... ✓ Deleted branch gate-probe
$ git ls-remote --heads origin
abaa02de74944bfc2f0a39825849da50628bb840	refs/heads/main
95c349561e11606abd9deb60232b66d6ec927596	refs/heads/slice/b1b
```

Proof 5: `cd app && bun run check` exit 0 (`Test Files 14 passed (14)`, `Tests 247 passed | 8 skipped (255)`); `bun run build` exit 0 (three `built in` lines); `node workspace/05-plans/check-gotchas.mjs` → `check-gotchas: OK (27 path entries, 105 process entries)`. CI on `95c3495` (run 37006220710, `pull_request`): `check success`, `build success`, `merge-gate skipped`.

NOT DONE (unchanged, a worker never merges):
- The merge of the B1b pull request with `node workspace/05-plans/merge-gate.mjs 22` and the `merge-gate success` of that merge's `ci` run on `main`. UNPROVEN until the orchestrator runs it: the job's `GITHUB_TOKEN` rights on `commits/<sha>/pulls`, `status` and `check-runs`, its cost, that `CI_HEAVY` reaches it, and that the first merge really leaves one run per name or a latest run that is `success`.
- The new refusal path was proved by unit tests, mutations and the shim against another repository's PR; it has not run against a red PR of this repository (no red PR exists, and a deliberately red one costs Actions minutes).

GOTCHAS: P-106 and P-107 added; P-104 reworded to the new rule.

## g7 · steps 5b (fix round 2: two defects of the review)

Commit `b698925` on `slice/b1b` (draft PR #22), plus the commit that carries this block. Files: `workspace/05-plans/merge-gate.mjs`, `app/tests/unit/merge-gate.test.ts`, `app/tests/mutations/B1b.json`, `GOTCHAS.md` (P-108, P-109), this log. `app/scripts/merge-gate.mjs`, `hygiene.test.ts` and `ci.yml` needed no change.

What changed:
- Defect 1, `workspace/05-plans/merge-gate.mjs`: the claim "the check data cannot tell it from a normal one" was wrong. `gh pr checks --json` has a `link` per row (`.../actions/runs/<run>/job/<id>`), and `gh api repos/AbdulrahmanAmer/matter-of-place/actions/jobs/<id>` lists every step with its `conclusion`. `mergeGate` now reads `bucket,workflow,name,link`; for each `pass` row with an Actions link it reads the steps, drops the runner's own (`Set up job`, `Complete job`, `Post ...`) and prints `all steps skipped: <workflow> <job>` when at least one step remains and every one is `skipped`. As the plan says (line 112, DO-04) it prints and does not block; a failed read of the steps refuses (`merge-gate: cannot read the steps of <workflow> <job>: <error>`), nothing is written before the last refusal. A row without a job link (a status from another app) reads nothing.
- Defect 2, `app/tests/mutations/B1b.json`: 10 entries (200 now, `--check` bad 0). The four tests the review named: `mg-skipping` and `mg-order` (the happy path: `skipping` must not block, and the status must be posted before the merge), `mg-ok`, `mg-inprogress`, `mg-nopr-gather`. The five for the four new cases of this round: `mg-steps-every`, `mg-steps-bookkeeping`, `mg-steps-empty`, `mg-steps-fail`, `mg-steps-link`.
- `app/tests/unit/merge-gate.test.ts`: 27 cases (4 new): a passed job with every real step skipped is printed and the merge still runs; a job that ran one step, or that has only the runner's steps, is not printed; unreadable steps refuse with no write call; a check with no job link reads nothing. The fake `run` answers the jobs API by job id and 404s an unknown one.

Limit, not hidden: a job whose setup steps ran (checkout, setup-bun, install) while only its work steps were skipped is not "all skipped" by this measure, because the data has no notion of a setup step. B4's `e2e` and step 6's `preview` have `HAS_DB`-gated steps; whether those jobs skip their steps or the whole job is for their groups to prove. If the plan wants those printed too, line 112 must say "every job with a skipped step" and the output becomes `skipped steps: <job>: <names>`; I did not build that without the plan.

Proof 1: `cd app && bunx vitest run tests/unit/merge-gate.test.ts tests/unit/hygiene.test.ts`
```
 Test Files  2 passed (2)
      Tests  57 passed | 8 skipped (65)
```

Proof 2, watched-fail (aq) and the ten new entries replayed (`node ../scratch/replay.mjs <ids>` from `app/`, the runner of the g4 close-out block; `git status --short` identical before and after):
```
RED aq: exit=1 expect=true | × refuses a failed e2e and names it 9ms
RED mg-skipping: exit=1 expect=true | × posts the status and merges when every check passes or is skipped 10ms
RED mg-order: exit=1 expect=true | × posts the status and merges when every check passes or is skipped 9ms
RED mg-ok: exit=1 expect=true | × passes when the merge-gate status and every required check are success 9ms
RED mg-inprogress: exit=1 expect=true | × refuses a check that has not finished 8ms
RED mg-nopr-gather: exit=1 expect=true | × says no pull request when the commit has none 1ms
RED mg-steps-every: exit=1 expect=true | × prints no job that ran a step, or that has no step but the runner's 8ms
RED mg-steps-bookkeeping: exit=1 expect=true | × prints a passed job whose steps were all skipped, and still merges 9ms
RED mg-steps-empty: exit=1 expect=true | × prints no job that ran a step, or that has no step but the runner's 7ms
RED mg-steps-fail: exit=1 expect=true | × refuses when the steps of a passed job cannot be read, and writes nothing 9ms
RED mg-steps-link: exit=1 expect=true | × reads no steps for a check that is not a job of ours 1ms
replayed 11, not red 0
```
The mutations: `mg-skipping` makes `skipping` block (`blocked = true;`); `mg-order` runs `gh pr merge` before the status POST; `mg-ok` returns `ok: false`; `mg-inprogress` reads an unfinished run as `success`; `mg-nopr-gather` returns a pull request when none was merged; `mg-steps-every` uses `some` for `every`; `mg-steps-bookkeeping` stops dropping the runner's steps; `mg-steps-empty` drops `work.length > 0`; `mg-steps-fail` ignores a failed steps read; `mg-steps-link` reads steps for a row with no job link (it asks for job `undefined`, the fake answers 404, the gate refuses).

Proof 3, the review's own check, every test title mapped to the registry (script text below; `NONE` is the `it.each` template, which `mg-bucket` and `mg-bucket-pending` cover):
```
// node ../scratch/g7r2-map.mjs   (from app/)
import { readFileSync } from "node:fs";
const entries = JSON.parse(readFileSync("tests/mutations/B1b.json", "utf8"));
const source = readFileSync("tests/unit/merge-gate.test.ts", "utf8");
const titles = [...source.matchAll(/\bit(?:\.each\([^)]*\))?\(\s*"([^"]+)"/g)].map((m) => m[1]);
let none = 0;
for (const title of titles) {
  const ids = entries
    .filter((e) => e.test === "tests/unit/merge-gate.test.ts" && title.includes(e.expect.replace(/\\/g, "")))
    .map((e) => e.id);
  if (ids.length === 0) none += 1;
  console.log(`${ids.length === 0 ? "NONE" : ids.join(",")}  <-  ${title}`);
}
console.log(`titles ${titles.length}, without an entry ${none}`);
```
```
mg-ok  <-  passes when the merge-gate status and every required check are success
mg-inprogress  <-  refuses a check that has not finished
mg-nopr-gather  <-  says no pull request when the commit has none
mg-skipping,mg-order  <-  posts the status and merges when every check passes or is skipped
NONE  <-  refuses a %s check although gh pr checks --json exits 0, and writes nothing
titles 25, without an entry 1
```
(the four titles the review named, and the one `NONE`; the other 20 lines are in the run output).

Proof 4, the new read path against the real `gh` (a shim that reads through real `gh pr view`, `gh pr checks` and the jobs API, treats the draft as ready and prints, instead of running, the git calls and the two writes; script text below; PR #22 at `b698925`):
```
// node scratch/g7r2-shim.mjs 22   (from the lane root)
import { spawnSync } from "node:child_process";
import { mergeGate } from "../workspace/05-plans/merge-gate.mjs";
const pr = process.argv[2];
const run = (command, args) => {
  const write = args[0] === "api" && args[1] === "-X";
  if (command === "git" || write || (args[0] === "pr" && args[1] === "merge")) {
    console.log(`SHIM would run: ${command} ${args.join(" ")}`);
    return { status: 0, out: "", err: "" };
  }
  const result = spawnSync(command, args, { encoding: "utf8" });
  const out = result.stdout.trim();
  const shown = args[0] === "pr" && args[1] === "view" ? out.replace("\ttrue", "\tfalse") : out;
  console.log(`SHIM read: ${command} ${args.slice(0, 3).join(" ")} -> exit ${result.status}, ${out.split("\n").length} row(s)`);
  return { status: result.status, out: shown, err: result.stderr.trim() };
};
const { code, lines } = mergeGate(pr, run);
for (const line of lines) console.log(line);
console.log(`exit ${code}`);
```
```
SHIM read: gh pr view 22 -> exit 0, 1 row(s)
SHIM would run: git fetch --quiet origin main pull/22/head
SHIM would run: git merge-base --is-ancestor origin/main b698925d481de018b5bbc38059a2a2135cf2a937
SHIM read: gh pr checks 22 -> exit 0, 3 row(s)
SHIM read: gh api repos/AbdulrahmanAmer/matter-of-place/actions/jobs/110839873886 --jq -> exit 0, 15 row(s)
SHIM read: gh api repos/AbdulrahmanAmer/matter-of-place/actions/jobs/110839873709 --jq -> exit 0, 14 row(s)
SHIM would run: gh api -X POST repos/AbdulrahmanAmer/matter-of-place/statuses/b698925d481de018b5bbc38059a2a2135cf2a937 -f state=success -f context=merge-gate
SHIM would run: gh pr merge 22 --merge --match-head-commit b698925d481de018b5bbc38059a2a2135cf2a937
skipped: ci merge-gate

exit 0
```
The two real jobs (`check`, `build`) each ran real steps, so nothing is printed as all skipped, which is right. No job of this repository has skipped every step yet, so the printed line is proved by the unit fixtures (the TSV shape is the real one: `gh api repos/AbdulrahmanAmer/matter-of-place/actions/jobs/110835524574 --jq '.steps[] | [.name, .conclusion] | @tsv'` prints `Set up job	success` ... `Complete job	success`) and by `skipped` being the real step conclusion (a vitest-dev/vitest run lists steps `Test Examples`, `Unit Test UI` with conclusion `skipped`).

Proof 5, the probe PR #26 (draft, cut from `origin/main~1` = `ae1d7dc`, one code commit `d2f1724`), the script run from `slice/b1b` (P-105):
```
$ node workspace/05-plans/merge-gate.mjs 26 ; echo "exit $?"      (still a draft)
mark ready first
exit 1
$ gh pr ready 26 ; node workspace/05-plans/merge-gate.mjs 26 ; echo "exit $?"
✓ Pull request AbdulrahmanAmer/matter-of-place#26 is marked as "ready for review"
rebase first
exit 1
$ git merge-base --is-ancestor origin/main origin/gate-probe ; echo $?      (origin/main abaa02d, probe d2f1724)
1
$ gh api repos/.../commits/d2f1724.../status --jq '.statuses | length'
0
$ gh pr close 26 --delete-branch   -> ✓ Closed pull request #26 ... ✓ Deleted branch gate-probe
$ git ls-remote --heads origin
abaa02de74944bfc2f0a39825849da50628bb840	refs/heads/main
b698925d481de018b5bbc38059a2a2135cf2a937	refs/heads/slice/b1b
```

Proof 6: `cd app && bun run check` exit 0 (`Test Files 14 passed (14)`, `Tests 251 passed | 8 skipped (259)`); `bun run build` exit 0 (three `built in` lines, `routeTree.gen.ts` unchanged); `node workspace/05-plans/check-gotchas.mjs` → `check-gotchas: OK (27 path entries, 107 process entries)`. CI on `b698925` (run 37007735766, `pull_request`): `build success`, `check success`, `merge-gate skipped`.

NOT DONE (a worker never merges, standing rule of this lane; PR #22 is also still a draft, so the script would answer `mark ready first`):
- The merge of the B1b pull request with `node workspace/05-plans/merge-gate.mjs 22` and the `merge-gate success` of that merge's `ci` run on `main` (`gh run view <id> --json jobs --jq '.jobs[] | [.name,.conclusion] | @tsv'`). UNPROVEN until the orchestrator runs it: the job's `GITHUB_TOKEN` rights on `commits/<sha>/pulls`, `status` and `check-runs`, that `CI_HEAVY` reaches it, and that the first merge leaves one run per name or a latest run that is `success`.
- `all steps skipped` against a real job that skipped every step: no such job exists in this repository yet (it becomes testable with B4's `e2e` and step 6's `preview`).
- The new refusal paths have not run against a red PR of this repository.

GOTCHAS: P-108 (a limit written into a log without asking the API) and P-109 (map every test title to a registry entry before reporting) added.

## c6 · steps 5

Close-out of group g6 under ruling ASSUMED H42 (3) and (4): four defects of the review. Commits on `slice/b1b`: `036ed52` (the work), `1692c2c` and `95e69c5` (type-error watched-fail and its revert), `05690d9` and `6691ee6` (engines watched-fail and its revert); the tree at `6691ee6` equals `036ed52` (`git diff --quiet 036ed52 HEAD` exit 0).

1. `scripts/check-migrations.mjs` follows STANDARDS R17 and H42 (3). Statement rules: `drop table`, `drop view` (and `drop materialized view`), `drop type`, `drop function`, `drop index`, any `rename` (column, table, and the form without `COLUMN`), `set not null`. Clause rules, read per top-level clause of an `alter table` statement because Postgres makes `COLUMN` optional: a dropped column (with or without `COLUMN`, not `drop constraint`), a column type change (with or without `COLUMN`), and a new NOT NULL column without `default` or `generated` (not `add constraint`, not `add check`). The clause split respects parentheses and quotes (`numeric(10, 2)`, `default ')'`). The failure now names the kinds: `destructive change (drop view) without "-- contract-of: <14-digit version>" in its first 30 lines: <file>`. Found beyond the review's list while probing: `alter table t drop body`, `alter table t alter body type x` and `alter table t add y int not null` (all without `COLUMN`) passed too; all three are flagged now and have their own cases.
2. `tests/unit/check-migrations.test.ts`: one `it.each` row per destructive kind (16) and per allowed change (6: NOT NULL with a default, drop trigger, drop constraint, a dropped column default, `add check (... is not null)`, a new table with NOT NULL columns), plus a header without a 14-digit version. `tests/mutations/B1b.json`: 27 new `cm-` entries and `cm-destructive` rewritten to the moved line (P-090); every title of the file maps to at least one entry.
3. GOTCHAS P-111 (a hand-applied mutation prints its mutated line and refuses an unchanged file).
4. Dependabot: `docs/runbooks/delivery.md` has a section that says UNPROVEN until the file is on `main` and the first Monday after that (correction below).

Stale lines for the orchestrator: STANDARDS R17 says "dropping a function or trigger stays allowed"; H42 (3) flags `drop function`, which was built (H42 binds; R17 needs the word "function" removed). R17's `Enforced by:` still says "HANDOFF HO-4: B1b names it `-- contract:`"; the script reads `-- contract-of:`. B1b.md line 137 (c) and line 155 list the shorter set of patterns and a single `drop column` case.

### Correction to the g6 Dependabot lines (H42 (4))

The g6 blocks above (lines 782, 862 and 929 of this file) say Dependabot is proved after "the first Monday run (2026-10-05)". That is wrong: GitHub reads `dependabot.yml` only from the default branch, and the file is not on `main`:
```
$ gh api 'repos/AbdulrahmanAmer/matter-of-place/contents/.github/dependabot.yml?ref=main'
{"message":"Not Found","documentation_url":"https://docs.github.com/rest/repos/contents#get-repository-content","status":"404"}gh: Not Found (HTTP 404)
$ gh api 'repos/AbdulrahmanAmer/matter-of-place/contents/.github/dependabot.yml?ref=slice/b1b' --jq .path
.github/dependabot.yml
$ gh pr list --author "app/dependabot" --state all --json number --jq length
0
```
Corrected: Dependabot is UNPROVEN until its file is on `main` and the first Monday after that; the `bun` ecosystem name is checked then (ASSUMED, fallback `npm`).

### Proofs (run 2026-10-02, from `app/` unless noted)

Before the change, the review's evidence reproduced and three more misses (`node ../scratch/c6-probe.mjs`, text below): `0  drop column, no COLUMN keyword`, `0  rename, no COLUMN keyword`, `0  column type, no COLUMN keyword`, `0  not null column, no default`, `0  not null column, no COLUMN keyword`, `0  drop view`, `0  drop materialized view`, `0  drop type`, `0  drop function`, `0  drop index`. After:
```
1  drop table  | destructive change (drop table)
1  drop column  | destructive change (drop column)
1  drop column, no COLUMN keyword  | destructive change (drop column)
1  rename column  | destructive change (rename)
1  rename, no COLUMN keyword  | destructive change (rename)
1  rename to  | destructive change (rename)
1  column type  | destructive change (column type)
1  column type, no COLUMN keyword  | destructive change (column type)
1  set not null  | destructive change (set not null)
1  not null column, no default  | destructive change (not null column
1  not null column, no COLUMN keyword  | destructive change (not null column
1  drop view  | destructive change (drop view)
1  drop materialized view  | destructive change (drop view)
1  drop type  | destructive change (drop type)
1  drop function  | destructive change (drop function)
1  drop index  | destructive change (drop index)
0  ALLOWED not null column with a default
0  ALLOWED drop trigger
0  ALLOWED drop constraint
0  ALLOWED drop default
0  ALLOWED add check not null
0  ALLOWED create table
0  ALLOWED expand header
```
Plan step 5 proofs:
```
$ bunx vitest run tests/unit/hygiene.test.ts tests/unit/check-migrations.test.ts
 Test Files  2 passed (2)
      Tests  58 passed | 8 skipped (66)
$ node scripts/check-migrations.mjs ; echo "exit $?"
no migrations
exit 0
$ git -C .. ls-files "app/bun.lock"
app/bun.lock
$ node -p "require('./package.json').engines" ; ls ../.github/dependabot.yml
{ bun: '1.3.13', node: '24.x' }
../.github/dependabot.yml
```
CI on `036ed52` (run 37010774950, `pull_request`, success): `check success`, `build success`, `merge-gate skipped`; the steps of `check` are `engines`, `migration-order` (log: `$ node scripts/check-migrations.mjs` / `no migrations`), `Run bun run check`, `audit`, all `success`, and no job named `audit` or `deno`. `gh run download 37010774950 -n build-output -D scratch/c6-art` holds `server/wrangler.json`, name `matter-of-place`.
Watched-fail (d), type error: `1692c2c` adds `const x: number = "a";` to `src/lib/strings.ts` (diff line printed before the commit: `+const x: number = "a";`). Run 37011031661: `check failure`, `build success`, log `##[error]src/lib/strings.ts(103,7): error TS2322: Type 'string' is not assignable to type 'number'.` Revert `95e69c5`: run 37011160255 `success`.
Watched-fail, engines: `05690d9` sets `engines.bun` to `1.3.12` (`+    "bun": "1.3.12",`). Run 37011313878: `check failure` at step `engines` (`engines {"bun":"1.3.12","node":"24.x"} runner 1.3.13 24`, `Process completed with exit code 1.`; cache, install and `migration-order` `skipped`). Revert `6691ee6`: run 37011425524 `success`.
Registry (runner `scratch/replay.mjs`, text in the g4 close-out block):
```
$ node ../scratch/replay.mjs --check
checked 223, bad 0
$ node ../scratch/replay.mjs ap cm-applied cm-destructive cm-header-lines cm-comments cm-drop-table cm-drop-column cm-drop-bare cm-alter-head cm-rename-column cm-rename-bare cm-rename-table cm-type-column cm-type-bare cm-set-not-null cm-not-null cm-not-null-bare cm-split-parens cm-split-quotes cm-drop-view cm-drop-mview cm-drop-type cm-drop-function cm-drop-index cm-allow-default cm-allow-trigger cm-allow-constraint cm-allow-drop-default cm-allow-check cm-allow-create
RED ap: exit=1 expect=true | × refuses an added file with an older timestamp than main 8ms
RED cm-applied: exit=1 expect=true | × refuses an edited applied migration 8ms
RED cm-destructive: exit=1 expect=true | × a drop column needs the contract-of header 2ms
RED cm-header-lines: exit=1 expect=true | × refuses a contract-of header below line 30 8ms
RED cm-comments: exit=1 expect=true | × passes a clean tree and a new file after the newest on main 10ms
RED cm-drop-table: exit=1 expect=true | × a drop table needs the contract-of header 8ms
RED cm-drop-column: exit=1 expect=true | × a drop column needs the contract-of header 8ms
RED cm-drop-bare: exit=1 expect=true | × a drop written without COLUMN needs the contract-of header 8ms
RED cm-alter-head: exit=1 expect=true | × a drop written without COLUMN needs the contract-of header 7ms
RED cm-rename-column: exit=1 expect=true | × a rename column needs the contract-of header 7ms
RED cm-rename-bare: exit=1 expect=true | × a rename written without COLUMN needs the contract-of header 8ms
RED cm-rename-table: exit=1 expect=true | × a table rename needs the contract-of header 9ms
RED cm-type-column: exit=1 expect=true | × a column type change needs the contract-of header 8ms
RED cm-type-bare: exit=1 expect=true | × a type change written without COLUMN needs the contract-of header 7ms
RED cm-set-not-null: exit=1 expect=true | × a set not null needs the contract-of header 7ms
RED cm-not-null: exit=1 expect=true | × a new NOT NULL column with no default needs the contract-of header 8ms
RED cm-not-null-bare: exit=1 expect=true | × a new NOT NULL column without COLUMN needs the contract-of header 8ms
RED cm-split-parens: exit=1 expect=true | × a new NOT NULL column without COLUMN needs the contract-of header 7ms
RED cm-split-quotes: exit=1 expect=true | × a new NOT NULL column without COLUMN needs the contract-of header 7ms
RED cm-drop-view: exit=1 expect=true | × a drop view needs the contract-of header 8ms
RED cm-drop-mview: exit=1 expect=true | × a drop materialized view needs the contract-of header 8ms
RED cm-drop-type: exit=1 expect=true | × a drop type needs the contract-of header 7ms
RED cm-drop-function: exit=1 expect=true | × a drop function needs the contract-of header 7ms
RED cm-drop-index: exit=1 expect=true | × a drop index needs the contract-of header 7ms
RED cm-allow-default: exit=1 expect=true | × a new NOT NULL column with a default needs no contract-of header 7ms
RED cm-allow-trigger: exit=1 expect=true | × a drop trigger needs no contract-of header 7ms
RED cm-allow-constraint: exit=1 expect=true | × a drop constraint needs no contract-of header 7ms
RED cm-allow-drop-default: exit=1 expect=true | × a dropped column default needs no contract-of header 7ms
RED cm-allow-check: exit=1 expect=true | × an added check on not null needs no contract-of header 8ms
RED cm-allow-create: exit=1 expect=true | × a new table with NOT NULL columns needs no contract-of header 1ms
replayed 30, not red 0
$ node ../scratch/replay.mjs cm-contract-header cm-contract-digits
RED cm-contract-header: exit=1 expect=true | × accepts a drop column with the contract-of header in its first 30 lines 7ms
RED cm-contract-digits: exit=1 expect=true | × refuses a contract-of header without a 14-digit version 8ms
replayed 2, not red 0
$ node ../scratch/replay.mjs ao bd f g hy-engines-gone
RED bd: exit=1 expect=true | +   "noUncheckedIndexedAccess",
RED f: exit=1 expect=true | +     "ci.yml check setup-bun 1.3.13, engines.bun 1.3.14",
RED g: exit=1 expect=true | AssertionError: expected [ 'bun /app daily', …(1) ] to deeply equal [ 'bun /app weekly', …(1) ]
RED ao: exit=1 expect=true | +     "ci.yml: - uses: actions/upload-artifact@v4",
RED hy-engines-gone: exit=1 expect=true | × the check job compares the runner with engines before installing (8) 117ms
replayed 5, not red 0
$ node ../scratch/c6-map.mjs | tail -1
titles 28, without an entry 0
$ node ../scratch/c6-badfind.mjs        (the P-111 proof)
BAD cm-drop-view: find occurs 0 times
checked 223, bad 1
exit 1
restored: true
```
Gates: `bun run check` exit 0 (`layout: OK (586 files)`, knip's two known hints `src/db/types.ts` and `supabase/functions/*/index.ts` of P-065, `No duplicates found.`, `stubs: 15 markers, 0 on closed slices`, `Test Files 14 passed (14)`, `Tests 273 passed | 8 skipped (281)`); `bun run build` exit 0 (three `built in` lines, `src/routeTree.gen.ts` unchanged); from the lane root `node workspace/05-plans/check-gotchas.mjs` → `check-gotchas: OK (27 path entries, 109 process entries)`.

Scratch scripts (lane-root `scratch/`, git-ignored, run from `app/`; P-088):

`scratch/c6-probe.mjs`
```js
// node ../scratch/c6-probe.mjs   (from app/) feeds each R17 / H42 (3) case to checkMigrations and prints the count.
import { checkMigrations } from "../app/scripts/check-migrations.mjs";

const cases = {
  "drop table": "drop table public.notes;",
  "drop column": "alter table notes drop column body;",
  "drop column, no COLUMN keyword": "alter table notes drop body;",
  "rename column": "alter table notes rename column body to text;",
  "rename, no COLUMN keyword": "alter table notes rename body to text;",
  "rename to": "alter table notes rename to memos;",
  "column type": "alter table notes alter column body type varchar(80);",
  "column type, no COLUMN keyword": "alter table notes alter body type varchar(80);",
  "set not null": "alter table notes alter column body set not null;",
  "not null column, no default": "alter table notes add column y text not null;",
  "not null column, no COLUMN keyword": "alter table notes add y text not null;",
  "drop view": "drop view public.v_notes;",
  "drop materialized view": "drop materialized view public.mv_notes;",
  "drop type": "drop type public.note_kind;",
  "drop function": "drop function public.f(int);",
  "drop index": "drop index public.notes_body_idx;",
  "ALLOWED not null column with a default": "alter table notes add column y text not null default '';",
  "ALLOWED drop trigger": "drop trigger notes_touch on notes;",
  "ALLOWED drop constraint": "alter table notes drop constraint notes_body_check;",
  "ALLOWED drop default": "alter table notes alter column body drop default;",
  "ALLOWED add check not null": "alter table notes add check (body is not null);",
  "ALLOWED create table": "create table notes (id uuid not null, body text not null);",
  "ALLOWED expand header": "-- down: drop table notes\nset lock_timeout = '5s';\ncreate table notes (id uuid);",
};
for (const [name, sql] of Object.entries(cases)) {
  const file = "supabase/migrations/20261002110000_x.sql";
  const failures = checkMigrations({ changed: [], added: [file], mainPrefixes: ["20261002100000"], readFile: () => sql });
  console.log(`${String(failures.length)}  ${name}${failures.length > 0 ? `  | ${failures[0].split(" without")[0]}` : ""}`);
}
```
`scratch/c6-map.mjs`
```js
// node ../scratch/c6-map.mjs   (from app/) maps every test title of check-migrations.test.ts, it.each rows
// expanded through their `name`, to the registry entries whose `expect` matches it.
import { readFileSync } from "node:fs";

const TEST = "tests/unit/check-migrations.test.ts";
const entries = JSON.parse(readFileSync("tests/mutations/B1b.json", "utf8")).filter((e) => e.test === TEST);
const source = readFileSync(TEST, "utf8");
const rows = (table) => {
  const body = source.split(`const ${table} = [`)[1].split("\n];")[0];
  return [...body.matchAll(/name: "([^"]+)"/g)].map((m) => m[1]);
};
const titles = [];
for (const m of source.matchAll(/\bit(?:\.each\((\w+)\))?\(\s*"([^"]+)"/g)) {
  if (m[1] === undefined) titles.push(m[2]);
  else for (const name of rows(m[1])) titles.push(m[2].replace("$name", name));
}
let none = 0;
for (const title of titles) {
  const ids = entries.filter((e) => new RegExp(e.expect).test(title)).map((e) => e.id);
  if (ids.length === 0) none += 1;
  console.log(`${ids.length === 0 ? "NONE" : ids.join(",")}  <-  ${title}`);
}
console.log(`titles ${titles.length}, without an entry ${none}`);
```
`scratch/c6-badfind.mjs`
```js
// node ../scratch/c6-badfind.mjs   (from app/) breaks the find of cm-drop-view, runs replay --check, restores the bytes.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const path = "tests/mutations/B1b.json";
const saved = readFileSync(path);
const entries = JSON.parse(saved.toString("utf8"));
const entry = entries.find((e) => e.id === "cm-drop-view");
entry.find = "/drops+view/i";
writeFileSync(path, `${JSON.stringify(entries, null, 2)}\n`);
try {
  console.log(execSync("node ../scratch/replay.mjs --check", { encoding: "utf8" }));
} catch (error) {
  console.log(`${error.stdout}exit ${String(error.status)}`);
} finally {
  writeFileSync(path, saved);
}
console.log(`restored: ${String(readFileSync(path).equals(saved))}`);
```

UNPROVEN: Dependabot (above). The new rules have not met a real migration yet (B2 writes the first); B2's `tests/db/migration-headers.test.ts` checks the header's version against `origin/main`, this script checks only its shape.

GOTCHAS: P-111 added.

## c6 · steps 5

Review round 2 of the c6 close-out: three defects. Commits on `slice/b1b`: `e10236b` (the work), `06839f7` and `f1fce32` (type-error watched-fail and its revert), `65bf95e` and `ccd935f` (engines watched-fail and its revert); the tree at `ccd935f` equals `e10236b` (`git diff --quiet e10236b HEAD` exit 0, checked after each revert).

1. Regression fixed. `scripts/check-migrations.mjs` no longer reads raw text with regular expressions: `statementsOf` lexes each file once. Line comments and nested block comments go; every string (with `E'...'` backslash escapes), quoted name and dollar-quoted body (any `$tag$`) is blanked in the statement text and kept as a literal. A DO block's literals are scanned as SQL, its strings too (`execute '...'` is how a DO block runs conditional DDL); a function body is not scanned, because it runs later. `alter table` is found anywhere in a statement, so a DO body's `if ... then alter table ... drop column` is read. The three inputs of the review are refused again (probe below).
2. False positives removed. A word inside a string, a comment or a function body is never matched. `rename` is destructive only as a clause of `alter table` (column, table, the form without `COLUMN`; `rename constraint` is allowed) and in `alter view`, `alter materialized view`, `alter type` (enum value) and `alter function`. Renames of policies, triggers, indexes and constraints are allowed. A new `serial`, `smallserial`, `bigserial` (or `serial2/4/8`) NOT NULL column counts as having a default. Function rename stays destructive on purpose: the previous Worker calls RPCs by name, the same reason H42 (3) gives `drop function`; it follows whatever ruling settles item 3 below.
3. The `drop function` conflict, surfaced (ruling needed, nothing in c6 is built around it): H42 (3) makes `drop function` destructive and the script refuses it without `-- contract-of:`. Lines that depend on the old rule:
   - `workspace/05-plans/B2.md:71` (invariant 14): "`drop function` and `drop trigger` stay allowed (F16 re-apply and signature changes need them)".
   - `workspace/05-plans/B2.md:93`: `scripts/db-fn.mjs` prepends `drop function if exists public.<name>(<old argument types>);` whenever a signature changes.
   - `workspace/05-plans/B10.md:166`: `approve_asset`'s signature change relies on exactly that prepend.
   - `workspace/05-plans/B2.md:74`: B2's migrations must pass this `migration-order` step.
   - `workspace/05-plans/review/B2.md:173` and `review/B10.md:127` say the same as B2.md 71 and 93.
   Effect if nothing changes: the first signature-changing `db:fn` migration (B10 at the latest; B8 and B8b also run `db:fn`) goes red at `migration-order`, or its builder writes a `-- contract-of:` header that means nothing for a function re-apply. Options for the orchestrator: (a) amend H42 (3) to allow `drop function` again (R17's own text) and delete the rule (one line plus the `cm-drop-function`, `cm-allow-trigger` and `cm-rename-function` entries and two rows); (b) keep it and give `db:fn` migrations a header that names the function re-apply, which both this script and B2's test accept.
   More stale lines: STANDARDS R17 ("dropping a function or trigger stays allowed"; its `Enforced by:` note says B1b names the header `-- contract:`, the script reads `-- contract-of:`); B1b.md line 137 (c) and line 155 (shorter pattern list, one `drop column` case); B2.md lines 71 and 116: B2's `migration-headers.test.ts` strips every dollar-quoted body, DO blocks included, so it would pass the DO-block case this script refuses, and its pattern `rename\s+to` refuses a policy or trigger rename this script allows. The two checks disagree until B2 follows this scan or a ruling picks one.

### Proofs (run 2026-10-02, from `app/` unless noted)

Probe (`node ../scratch/c6r-probe.mjs [<script>]`, text below; `ok` means the count is the one the case needs, `MUST 1` refused, `MUST 0` allowed). On the c6 version (`git show 8fe1df0:app/scripts/check-migrations.mjs`), 4 of 19 `ok`:
```
BAD 0  block comment then drop column
BAD 0  string with -- then drop column
BAD 0  do block drop column
BAD 0  do block execute drop column
BAD 1  rename in comment-on string  | destructive change (rename)
BAD 1  alter policy rename  | destructive change (rename)
BAD 1  alter trigger rename  | destructive change (rename)
BAD 1  alter index rename  | destructive change (rename)
BAD 1  constraint rename  | destructive change (rename)
BAD 1  serial not null  | destructive change (not null column
BAD 1  bigserial not null  | destructive change (not null column
BAD 1  create function body drop table temp  | destructive change (drop table)
BAD 1  function body drop index/type/view/rename  | destructive change (drop view, drop type, drop index, rename)
BAD 1  nested block comment  | destructive change (drop table)
BAD 1  escape string  | destructive change (drop table)
```
On the version before c6 (`33d3d4e`), 11 of 19 `ok` (it refused the first four cases; it missed `enum value rename` and flagged the policy, trigger and index renames, function bodies, the nested comment and the escape string). On `e10236b`, 19 of 19:
```
ok  1  block comment then drop column  | destructive change (drop column)
ok  1  string with -- then drop column  | destructive change (drop column)
ok  1  do block drop column  | destructive change (drop column)
ok  1  do block execute drop column  | destructive change (drop column)
ok  1  view rename  | destructive change (rename)
ok  1  materialized view rename  | destructive change (rename)
ok  1  enum value rename  | destructive change (rename)
ok  1  function rename  | destructive change (rename)
ok  0  rename in comment-on string
ok  0  alter policy rename
ok  0  alter trigger rename
ok  0  alter index rename
ok  0  constraint rename
ok  0  serial not null
ok  0  bigserial not null
ok  0  create function body drop table temp
ok  0  function body drop index/type/view/rename
ok  0  nested block comment
ok  0  escape string
```
`node ../scratch/c6-probe.mjs` (the c6 cases, text in the block above) prints the same 16 refusals and 7 allowed as before.

`tests/unit/check-migrations.test.ts`: 18 new rows. Refused: view, materialized view, enum value and function renames, a drop column inside a DO block, a drop column run by EXECUTE, a DO block after a block comment, a drop after a string holding two dashes. Allowed: serial and bigserial NOT NULL columns, a drop table named in a string, policy, trigger, index and constraint renames, a function body that drops a table, a drop inside a nested block comment, a drop inside an escape string. The review's `rename in a string` case is in the probe, not in the test: the lexer and the narrowed rename rule both protect it, so no single mutation turns it red (GOTCHAS P-112); `a drop table named in a string` carries the string rule instead, and `a DO block after a block comment` carries the comment rule (`^do` needs the comment gone). `tests/mutations/B1b.json`: 20 new `cm-` entries; 7 entries whose `find` moved were rewritten (`cm-comments`, `cm-rename-column`, `cm-rename-bare`, `cm-rename-table`, `cm-split-parens`, `cm-split-quotes`, `cm-allow-default`; P-090). The first replay printed `NOT RED cm-do-execute: exit=1 expect=false`: the mutation was red for the right reason, but vitest cut the 73-character title to `... EXECUTE in a DO bl…` (P-081); the row is now `a drop column run by EXECUTE`.

```
$ node ../scratch/replay.mjs --check
checked 243, bad 0
$ node ../scratch/replay.mjs ap cm-applied ... cm-allow-bigserial      (all 52 ap and cm- entries)
RED ap: exit=1 expect=true | × refuses an added file with an older timestamp than main 8ms
RED cm-applied: exit=1 expect=true | × refuses an edited applied migration 7ms
  (30 earlier cm- entries, each RED with its own title, as in the c6 block above)
RED cm-block-comment: exit=1 expect=true | × a DO block after a block comment needs the contract-of header 7ms
RED cm-comment-nesting: exit=1 expect=true | × a drop inside a nested block comment needs no contract-of header 7ms
RED cm-string-dashes: exit=1 expect=true | × a drop after a string holding two dashes needs the contract-of header 1ms
RED cm-string-drop: exit=1 expect=true | × a drop table named in a string needs no contract-of header 1ms
RED cm-escape-string: exit=1 expect=true | × a drop inside an escape string needs no contract-of header 8ms
RED cm-do-block: exit=1 expect=true | × a drop column inside a DO block needs the contract-of header 7ms
RED cm-do-execute: exit=1 expect=true | × a drop column run by EXECUTE needs the contract-of header 7ms
RED cm-function-body: exit=1 expect=true | × a function body that drops a table needs no contract-of header 1ms
RED cm-dollar-tag: exit=1 expect=true | × a function body that drops a table needs no contract-of header 7ms
RED cm-alter-anywhere: exit=1 expect=true | × a drop column inside a DO block needs the contract-of header 7ms
RED cm-rename-view: exit=1 expect=true | × a view rename needs the contract-of header 10ms
RED cm-rename-mview: exit=1 expect=true | × a materialized view rename needs the contract-of header 7ms
RED cm-rename-type: exit=1 expect=true | × an enum value rename needs the contract-of header 7ms
RED cm-rename-function: exit=1 expect=true | × a function rename needs the contract-of header 7ms
RED cm-allow-policy-rename: exit=1 expect=true | × a policy rename needs no contract-of header 10ms
RED cm-allow-trigger-rename: exit=1 expect=true | × a trigger rename needs no contract-of header 1ms
RED cm-allow-index-rename: exit=1 expect=true | × an index rename needs no contract-of header 2ms
RED cm-allow-constraint-rename: exit=1 expect=true | × a constraint rename needs no contract-of header 7ms
RED cm-allow-serial: exit=1 expect=true | × a new serial NOT NULL column needs no contract-of header 7ms
RED cm-allow-bigserial: exit=1 expect=true | × a new bigserial NOT NULL column needs no contract-of header 7ms
replayed 52, not red 0
$ node ../scratch/c6-map.mjs | tail -1
titles 46, without an entry 0
$ cmp scripts/check-migrations.mjs ../scratch/cm-saved.mjs && echo same-bytes      (no mutation left behind)
same-bytes
```
Plan step 5 proofs:
```
$ bunx vitest run tests/unit/hygiene.test.ts tests/unit/check-migrations.test.ts
 Test Files  2 passed (2)
      Tests  76 passed | 8 skipped (84)
$ node scripts/check-migrations.mjs ; echo "exit $?"
no migrations
exit 0
$ git -C .. ls-files "app/bun.lock"
app/bun.lock
$ node -p "require('./package.json').engines" ; ls ../.github/dependabot.yml
{ bun: '1.3.13', node: '24.x' }
../.github/dependabot.yml
$ node ../scratch/replay.mjs ao bd f g hy-engines-gone
RED bd: exit=1 expect=true | +   "noUncheckedIndexedAccess",
RED f: exit=1 expect=true | +     "ci.yml check setup-bun 1.3.13, engines.bun 1.3.14",
RED g: exit=1 expect=true | AssertionError: expected [ 'bun /app daily', …(1) ] to deeply equal [ 'bun /app weekly', …(1) ]
RED ao: exit=1 expect=true | +     "ci.yml: - uses: actions/upload-artifact@v4",
RED hy-engines-gone: exit=1 expect=true | × the check job compares the runner with engines before installing (8) 111ms
replayed 5, not red 0
```
CI on `e10236b` (run 37013961513, `pull_request`, success): `build success`, `check success`, `merge-gate skipped`; steps of `check`: `engines`, `Run actions/cache`, `Run bun install --frozen-lockfile`, `migration-order` (log `$ node scripts/check-migrations.mjs` / `no migrations`), `Run bun run check`, `audit`, all `success`; no job named `audit` or `deno`. `gh run download 37013961513 -n build-output -D scratch/c6r-art` → `nitro.json package-lock.json package.json public server`, `server/wrangler.json` name `matter-of-place`.
Watched-fail (d), type error: `06839f7` appends `const x: number = "a";` to `src/lib/strings.ts` (diff printed before the commit: `+const x: number = "a";`). Run 37014323477: `check failure`, `build success`; `##[error]src/lib/strings.ts(103,7): error TS2322: Type 'string' is not assignable to type 'number'.`, `Process completed with exit code 2.` Revert `f1fce32`: run 37014438315 `check success`, `build success`.
Watched-fail, engines: `65bf95e` sets `engines.bun` to `1.3.12` (`+    "bun": "1.3.12",`). Run 37014595290: `check failure` at step `engines` (`engines {"bun":"1.3.12","node":"24.x"} runner 1.3.13 24`, `Process completed with exit code 1.`); cache, install and `migration-order` `skipped`. Revert `ccd935f`: run 37014708495 `check success`, `build success`.
Gates on `e10236b`: `bun run check` exit 0 (`layout: OK (586 files)`, knip's two known hints of P-065, `No duplicates found.`, `stubs: 15 markers, 0 on closed slices`, `Test Files 14 passed (14)`, `Tests 291 passed | 8 skipped (299)`); `bun run build` exit 0 (three `built in` lines, `src/routeTree.gen.ts` unchanged); from the lane root `node workspace/05-plans/check-gotchas.mjs` → `check-gotchas: OK (28 path entries, 111 process entries)`.

`scratch/c6r-probe.mjs` (lane-root `scratch/`, git-ignored, run from `app/`; P-088)
```js
// node ../scratch/c6r-probe.mjs [<path to check-migrations.mjs>]   (from app/)
// Feeds the review's cases and the new ones to checkMigrations and prints the failure count of each.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const target = resolve(process.argv[2] ?? "scripts/check-migrations.mjs");
const { checkMigrations } = await import(pathToFileURL(target).href);

const cases = {
  "MUST 1  block comment then drop column": "/* note */ alter table notes drop column body;",
  "MUST 1  string with -- then drop column":
    "alter table notes add column mark text default 'a--b';\nalter table notes drop column body;",
  "MUST 1  do block drop column":
    "do $$ begin if exists (select 1) then alter table notes drop column body; end if; end $$;",
  "MUST 1  do block execute drop column":
    "do $$ begin execute 'alter table notes drop column body'; end $$;",
  "MUST 1  view rename": "alter view v_notes rename to v_memos;",
  "MUST 1  materialized view rename": "alter materialized view mv_notes rename to mv_memos;",
  "MUST 1  enum value rename": "alter type note_kind rename value 'a' to 'b';",
  "MUST 1  function rename": "alter function public.f(int) rename to g;",
  "MUST 0  rename in comment-on string": "comment on table notes is 'rename later';",
  "MUST 0  alter policy rename": "alter policy p on notes rename to q;",
  "MUST 0  alter trigger rename": "alter trigger t on notes rename to u;",
  "MUST 0  alter index rename": "alter index notes_body_idx rename to notes_text_idx;",
  "MUST 0  constraint rename": "alter table notes rename constraint a to b;",
  "MUST 0  serial not null": "alter table notes add column y serial not null;",
  "MUST 0  bigserial not null": "alter table notes add column y bigserial not null;",
  "MUST 0  create function body drop table temp":
    "create function f() returns void language plpgsql as $body$ begin drop table if exists notes_old; end $body$;",
  "MUST 0  function body drop index/type/view/rename":
    "create function f() returns void language plpgsql as $$ begin drop index i; drop type t; drop view v; alter table x rename to y; end $$;",
  "MUST 0  nested block comment": "/* a /* b */ drop table notes; */ create table memos (id uuid);",
  "MUST 0  escape string": "comment on table notes is E'it\\'s; drop table notes';",
};
for (const [name, sql] of Object.entries(cases)) {
  const file = "supabase/migrations/20261002110000_x.sql";
  const failures = checkMigrations({
    changed: [],
    added: [file],
    mainPrefixes: ["20261002100000"],
    readFile: () => `-- irreversible: x\nset lock_timeout = '5s';\n${sql}\n`,
  });
  const want = Number(name.slice(5, 6));
  const verdict = failures.length === want ? "ok " : "BAD";
  console.log(`${verdict} ${String(failures.length)}  ${name.slice(8)}${failures.length > 0 ? `  | ${failures[0].split(" without")[0]}` : ""}`);
}
```

UNPROVEN: Dependabot (`gh pr list --author "app/dependabot" --state all --json number --jq length` → `0`; `dependabot.yml` is still not on `main`, HTTP 404). The scan has met no real migration yet (B2 writes the first). Not handled, by choice: SQL inside a string that a DO block builds with `format()` and `||` is read piece by piece, so a statement split across two literals is missed; a DO block's `raise notice 'drop table ...'` is refused (it errs on the refusing side).

GOTCHAS: G-028 (the scan is a lexer; compare a rewritten gate with the old one on the same inputs), P-112 (a row two mechanisms protect cannot be watched red by one mutation), P-113 (a ruling that changes a gate's rule: grep every plan for the rule's words) added.

## c6 · steps 5

Review round 3 of the c6 close-out: four defects. Commits on `slice/b1b`: `7fd8359` (the work), `73b0b80` and `3628418` (type-error watched-fail and its revert), `f210345` and `bf2d457` (engines watched-fail and its revert); `git diff --quiet 7fd8359 HEAD` exit 0 after each revert.

1. Uneven coverage fixed by refusing by default. `scripts/check-migrations.mjs` now treats every `drop <object>` and every `alter <object> ... rename` at the start of a statement as destructive (`START`: the text start, or after `begin`, `then`, `else`, `loop` inside a DO or function body), with named exceptions only: `drop trigger` (R17) and `drop policy`; renames of a policy, trigger, index or constraint. So `drop schema ... cascade`, `drop sequence`, `drop extension`, `drop domain`, `drop procedure`, `drop foreign table` and `alter schema|sequence|... rename` need the header. `alter foreign table` is read like `alter table`; a composite type's `drop attribute` and `alter attribute ... type` count. A NOT NULL add counts a `default` only when it is not `set default` (`on delete set default`). A function or procedure body created in the file is read when another statement calls it (`select f()`, `perform f()` in a DO block, `create trigger ... execute function f()`), not when the statement only creates, alters, drops, grants, revokes or comments on it.
2. Column named `type` fixed: the column type rule reads `alter column <name>` or, without the keyword, a first word that is not `column`, so `alter column type set default 'x'` and `alter column type drop not null` pass, and `alter column type type text` is still refused.
3. GOTCHAS: P-114 (`gh run list --commit` needs the full SHA) and P-115 (the reviewer's cost: a backslash typed through the shell into probe SQL; build it with `String.fromCharCode(92)`) added; also G-029 (refuse by default, optional keywords) and P-116 (vitest cuts an `it.each` `$name` at 40 characters, found in this round's replay) added; G-026's proof moved to the new row that carries `cm-comments`.

Behaviour that changed on purpose, for the orchestrator to see: `alter publication <p> drop table <t>` (and `alter extension ... drop ...`) passed no longer get refused: the round-2 scan matched `drop table` anywhere in a statement; the anchored rule reads only a statement that is itself a drop. They take a member out of a set and drop no object or data. A ruling can reverse it (one rule plus the row `a table taken out of a publication`). `drop policy` stays allowed as before (round 2 did not list it). Open from round 2, unchanged: the `drop function` conflict with B2.md:71, B2.md:93 and B10.md:166 (P-113) still needs a ruling. Plan lines touched by the new kinds: `git grep -n -i -E "drop (schema|sequence|extension|domain|procedure|owned|role)|alter publication|drop attribute|on delete set default" -- workspace/05-plans ':!workspace/05-plans/logs'` → only B2.md:96, the `db:reset` script's own SQL (`drop schema public cascade`), which runs outside migrations and is not scanned.

### Proofs (run 2026-10-02, from `app/` unless noted)

Probe `node ../scratch/c6r3-probe.mjs [<script>]` (text below). On this round's script, `cases 39, bad 0`. On the round-2 script (`git show ee06839:app/scripts/check-migrations.mjs`, saved as `../scratch/check-migrations-ee06839.mjs`), `cases 39, bad 17`:
```
BAD 0  drop schema cascade
BAD 0  drop sequence
BAD 0  alter schema rename
BAD 0  alter sequence rename
BAD 0  not null add with on delete set default
BAD 0  create function then select
BAD 0  create function then call in DO
BAD 0  alter foreign table drop column
BAD 0  drop foreign table
BAD 0  drop extension
BAD 0  drop domain
BAD 0  drop procedure
BAD 0  composite drop attribute
BAD 0  composite attribute type
BAD 1  default on column named type  | destructive change (column type)
BAD 1  drop not null on column named type  | destructive change (column type)
BAD 1  publication drop table  | destructive change (drop table)
cases 39, bad 17
```
The only input the round-2 script refused and this one passes is `publication drop table` (on purpose, above). `node ../scratch/c6r-probe.mjs` (round 2) → 19 of 19 `ok`; `node ../scratch/c6-probe.mjs` (c6) → the same 16 refusals and 7 allowed.

`tests/unit/check-migrations.test.ts`: 20 new rows, one replaced. Refused: drop schema, drop sequence, a drop of any other object (`drop extension`), drop foreign table, schema and sequence renames, a drop column of a foreign table, a type change of a column named type, a NOT NULL column whose key sets default, a drop table after THEN in a DO block, a function body called in the same file, a composite type attribute drop and type change. Allowed: drop policy, a default and a drop not null on a column named type, a table taken out of a publication, a grant on a function that drops a table, a set not null named in a string, a down header that drops the new column. `a drop table named in a string` became `a set not null named in a string`: with drops anchored, the string blanking and the anchor both protect the old input (P-112), and `set not null` is matched anywhere, so only the blanking decides. For the same reason `cm-comments` now carries `a down header that drops the new column` and `cm-prefix-order` carries the clean-tree row. `tests/mutations/B1b.json`: 21 new `cm-` entries, 19 rewritten (17 whose `find` moved, P-090, and the `expect` of `cm-comments` and `cm-string-drop`). The first replay printed `NOT RED` for `cm-comments`, `cm-string-drop` (both protected twice, fixed as above), `cm-type-named-type-drop` and `cm-declares-grant`: red for the right reason, but vitest printed `a dropped NOT NULL on a column named ty…` and `a grant on a function whose body drops …` (P-116); both names are now 40 characters or fewer.

```
$ bunx vitest run tests/unit/hygiene.test.ts tests/unit/check-migrations.test.ts
 Test Files  2 passed (2)
      Tests  95 passed | 8 skipped (103)
$ node ../scratch/replay.mjs --check
checked 264, bad 0
$ node ../scratch/replay.mjs <all 73 entries whose file is scripts/check-migrations.mjs>
RED cm-comments: exit=1 expect=true | × a down header that drops the new column needs no contract-of header 7ms
RED cm-prefix-order: exit=1 expect=true | × passes a clean tree and a new file after the newest on main 12ms
RED cm-drop-table: exit=1 expect=true | × a drop table needs the contract-of header 7ms
RED cm-string-drop: exit=1 expect=true | × a set not null named in a string needs no contract-of header 1ms
RED cm-drop-schema: exit=1 expect=true | × a drop schema needs the contract-of header 14ms
RED cm-drop-sequence: exit=1 expect=true | × a drop sequence needs the contract-of header 14ms
RED cm-drop-any: exit=1 expect=true | × a drop of any other object needs the contract-of header 14ms
RED cm-drop-foreign: exit=1 expect=true | × a drop foreign table needs the contract-of header 14ms
RED cm-allow-policy-drop: exit=1 expect=true | × a drop policy needs no contract-of header 17ms
RED cm-statement-start: exit=1 expect=true | × a drop table after THEN in a DO block needs the contract-of header 17ms
RED cm-start-anchor: exit=1 expect=true | × a table taken out of a publication needs no contract-of header 1ms
RED cm-rename-schema: exit=1 expect=true | × a schema rename needs the contract-of header 15ms
RED cm-rename-sequence: exit=1 expect=true | × a sequence rename needs the contract-of header 15ms
RED cm-rename-skip-table: exit=1 expect=true | × a constraint rename needs no contract-of header 12ms
RED cm-alter-foreign: exit=1 expect=true | × a drop column of a foreign table needs the contract-of header 14ms
RED cm-type-named-type: exit=1 expect=true | × a default on a column named type needs no contract-of header 14ms
RED cm-type-named-type-drop: exit=1 expect=true | × a drop not null on a column named type needs no contract-of header 2ms
RED cm-type-of-type: exit=1 expect=true | × a type change of a column named type needs the contract-of header 15ms
RED cm-not-null-set-default: exit=1 expect=true | × a NOT NULL column whose key sets default needs the contract-of header 16ms
RED cm-called-body: exit=1 expect=true | × a function body called in the same file needs the contract-of header 13ms
RED cm-declares-grant: exit=1 expect=true | × a grant on a function that drops a table needs no contract-of header 13ms
RED cm-declares-create: exit=1 expect=true | × a function body that drops a table needs no contract-of header 13ms
RED cm-drop-attribute: exit=1 expect=true | × a composite type attribute drop needs the contract-of header 13ms
RED cm-attribute-type: exit=1 expect=true | × a composite type attribute type change needs the contract-of header 12ms
  (the other 49 entries, ap and cm-, each RED with its own title, rewritten ones included: cm-drop-view, cm-drop-mview,
   cm-drop-type, cm-drop-function, cm-drop-index, cm-allow-trigger, cm-alter-anywhere, cm-type-column, cm-type-bare,
   cm-rename-view, cm-rename-mview, cm-rename-type, cm-rename-function, cm-allow-policy-rename, cm-allow-trigger-rename,
   cm-allow-index-rename)
replayed 73, not red 0
$ node ../scratch/c6-map.mjs | tail -1
titles 65, without an entry 0
$ cmp scripts/check-migrations.mjs ../scratch/cm-saved-r3.mjs && echo same-bytes
same-bytes
$ node scripts/check-migrations.mjs ; echo "exit $?"
no migrations
exit 0
$ git -C .. ls-files "app/bun.lock"
app/bun.lock
$ node -p "require('./package.json').engines" ; ls ../.github/dependabot.yml
{ bun: '1.3.13', node: '24.x' }
../.github/dependabot.yml
$ node ../scratch/replay.mjs ao bd f g hy-engines-gone
RED bd: exit=1 expect=true | +   "noUncheckedIndexedAccess",
RED f: exit=1 expect=true | +     "ci.yml check setup-bun 1.3.13, engines.bun 1.3.14",
RED g: exit=1 expect=true | AssertionError: expected [ 'bun /app daily', …(1) ] to deeply equal [ 'bun /app weekly', …(1) ]
RED ao: exit=1 expect=true | +     "ci.yml: - uses: actions/upload-artifact@v4",
RED hy-engines-gone: exit=1 expect=true | × the check job compares the runner with engines before installing (8) 114ms
replayed 5, not red 0
```
CI on `7fd8359` (run 37017992017, `pull_request`, success): `check success`, `build success`, `merge-gate skipped`; steps of `check`: `engines`, `Run actions/cache@...`, `Run bun install --frozen-lockfile`, `migration-order` (`$ node scripts/check-migrations.mjs` / `no migrations`), `Run bun run check`, `audit`, all `success`; no job named `audit` or `deno`. `gh run download 37017992017 -n build-output -D scratch/c6r3-art` → `nitro.json package-lock.json package.json public server`, `server/wrangler.json` name `matter-of-place`.
Watched-fail (d), type error: `73b0b80` appends `const x: number = "a";` to `src/lib/strings.ts` (diff before the commit: `+const x: number = "a";`). Run 37018258702: `failure`, `check failure`, `build success`; `##[error]src/lib/strings.ts(103,7): error TS2322: Type 'string' is not assignable to type 'number'.`, `##[error]Process completed with exit code 2.` Revert `3628418`: run 37018393064 `success` (`check success`, `build success`).
Watched-fail, engines: `f210345` sets `engines.bun` to `1.3.12` (`+    "bun": "1.3.12",`). Run 37018573640: `check failure` at step `engines` (`engines {"bun":"1.3.12","node":"24.x"} runner 1.3.13 24`, `##[error]Process completed with exit code 1.`); cache, install, `migration-order` and `bun run check` `skipped`. Revert `bf2d457`: run 37018683658 `success` (`check success`, `build success`).
Gates on the work tree of `7fd8359`: `bun run check` exit 0 (`layout: OK (586 files)`, knip's two known hints of P-065, `No duplicates found.`, `stubs: 15 markers, 0 on closed slices`, `Test Files 14 passed (14)`, `Tests 310 passed | 8 skipped (318)`); `bun run build` exit 0 (three `built in` lines, `src/routeTree.gen.ts` unchanged); from the lane root `node workspace/05-plans/check-gotchas.mjs` → `check-gotchas: OK (29 path entries, 114 process entries)`. The first `bun run check` failed `scripts/check-migrations.mjs(235,21): error TS2532: Object is possibly 'undefined'.` on `DROP.exec(text)?.[1].replace` (R02's `noUncheckedIndexedAccess`); fixed with `?.[1]?.replace`, then the registry check and the full replay above were run again on the fixed bytes.

`scratch/c6r3-probe.mjs` (lane-root `scratch/`, git-ignored, run from `app/`; P-088)
```js
// node ../scratch/c6r3-probe.mjs [<path to check-migrations.mjs>]   (from app/)
// The review's round-3 cases and the earlier probe cases; prints the failure count of each.
// A backslash is built with String.fromCharCode(92), never typed (GOTCHAS P-115).
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const target = resolve(process.argv[2] ?? "scripts/check-migrations.mjs");
const { checkMigrations } = await import(pathToFileURL(target).href);
const bs = String.fromCharCode(92);
const fn = "create function f() returns void language plpgsql as $$ begin drop table notes; end $$;";

const cases = {
  "MUST 1  drop schema cascade": "drop schema old cascade;",
  "MUST 1  drop sequence": "drop sequence notes_seq;",
  "MUST 1  alter schema rename": "alter schema old rename to archive;",
  "MUST 1  alter sequence rename": "alter sequence notes_seq rename to memos_seq;",
  "MUST 1  not null add with on delete set default":
    "alter table notes add owner uuid not null references people (id) on delete set default;",
  "MUST 1  create function then select": `${fn}\nselect f();`,
  "MUST 1  create function then call in DO": `${fn}\ndo $$ begin perform f(); end $$;`,
  "MUST 1  alter foreign table drop column": "alter foreign table remote_notes drop column body;",
  "MUST 1  drop foreign table": "drop foreign table remote_notes;",
  "MUST 1  drop extension": "drop extension pg_trgm;",
  "MUST 1  drop domain": "drop domain email_address;",
  "MUST 1  drop procedure": "drop procedure p();",
  "MUST 1  then drop table in DO": "do $$ begin if true then drop table notes; end if; end $$;",
  "MUST 1  composite drop attribute": "alter type address drop attribute zip;",
  "MUST 1  composite attribute type": "alter type address alter attribute zip type text;",
  "MUST 1  type change of column named type": "alter table notes alter column type type text;",
  "MUST 1  block comment then drop column": "/* note */ alter table notes drop column body;",
  "MUST 1  string with -- then drop column":
    "alter table notes add column mark text default 'a--b';\nalter table notes drop column body;",
  "MUST 1  do block drop column":
    "do $$ begin if exists (select 1) then alter table notes drop column body; end if; end $$;",
  "MUST 1  do block execute drop column":
    "do $$ begin execute 'alter table notes drop column body'; end $$;",
  "MUST 1  view rename": "alter view v_notes rename to v_memos;",
  "MUST 1  enum value rename": "alter type note_kind rename value 'a' to 'b';",
  "MUST 1  function rename": "alter function public.f(int) rename to g;",
  "MUST 0  default on column named type": "alter table notes alter column type set default 'x';",
  "MUST 0  drop not null on column named type": "alter table notes alter column type drop not null;",
  "MUST 0  drop policy": "drop policy if exists notes_read on notes;",
  "MUST 0  drop trigger": "drop trigger notes_touch on notes;",
  "MUST 0  publication drop table": "alter publication supabase_realtime drop table notes;",
  "MUST 0  create function then grant": `${fn}\ngrant execute on function f() to service_role;`,
  "MUST 0  create function only": fn,
  "MUST 0  not null add with a real default":
    "alter table notes add owner uuid not null default gen_random_uuid() references people (id) on delete set default;",
  "MUST 0  rename in comment-on string": "comment on table notes is 'rename later';",
  "MUST 0  alter policy rename": "alter policy p on notes rename to q;",
  "MUST 0  alter index rename": "alter index notes_body_idx rename to notes_text_idx;",
  "MUST 0  constraint rename": "alter table notes rename constraint a to b;",
  "MUST 0  serial not null": "alter table notes add column y serial not null;",
  "MUST 0  nested block comment": "/* a /* b */ drop table notes; */ create table memos (id uuid);",
  "MUST 0  escape string": `comment on table notes is E'it${bs}'s; drop table notes';`,
  "MUST 1  escape string ending in two backslashes": `comment on table notes is E'a${bs}${bs}';\ndrop table notes;`,
};
let bad = 0;
for (const [name, sql] of Object.entries(cases)) {
  const file = "supabase/migrations/20261002110000_x.sql";
  const failures = checkMigrations({
    changed: [],
    added: [file],
    mainPrefixes: ["20261002100000"],
    readFile: () => `-- irreversible: x\nset lock_timeout = '5s';\n${sql}\n`,
  });
  const want = Number(name.slice(5, 6));
  const ok = failures.length === want;
  bad += ok ? 0 : 1;
  console.log(`${ok ? "ok " : "BAD"} ${String(failures.length)}  ${name.slice(8)}${failures.length > 0 ? `  | ${failures[0].split(" without")[0]}` : ""}`);
}
console.log(`cases ${String(Object.keys(cases).length)}, bad ${String(bad)}`);
```

UNPROVEN: Dependabot (`gh pr list --author "app/dependabot" --state all --json number --jq length` → `0`; `dependabot.yml` is not on `main` yet). The scan has met no real migration yet (B2 writes the first). Not handled, by choice, each on the side named: SQL a DO block or a called body builds with `format()` and `||` is read piece by piece, so a statement split across two literals is missed; a function whose name is quoted (`"F"()`) or whose body is called only through dynamic SQL is not tracked; a DML statement that fires a trigger created in an earlier migration does not read that trigger's body; a `raise notice 'drop table ...'` inside a DO block is refused; a table created with the same name as a function of the file (`create table f (...)`) counts as a call.

GOTCHAS: G-029, P-114, P-115, P-116 added; G-026's proof updated.

## c6 · steps 5

Review round 4 of the c6 close-out: four defects. Commits on `slice/b1b`: `850b0d8` (the work), `e2a0320` and `ba13e17` (type-error watched-fail and its revert), `c5b498f` and `e998d48` (engines watched-fail and its revert); `git diff --quiet 850b0d8 HEAD` exit 0 after each revert. The log block and a P-111 line are committed after them.

1. Backtracking into a run of blanks fixed in one place: `statementsOf` now collapses every run of blanks in a statement's text to one space (strings, quoted names and bodies are already blanked, so no literal changes). With one space, `\s+` has nothing to give back, so the negative lookaheads of the rename rule (`alter\s+(?!policy\b|...)`) and of the clause rules (`^drop\s+(?!constraint\b)`, `^rename\s+(?!constraint\b)`, `^add\s+(?!constraint\b|check\b)`) see the next word. It also covers a block comment between two words (`alter /* c */ trigger ...`, refused in round 3 because the comment's space and the blanks made a run). No regex changed, so no registry `find` moved (P-090).
2. `bodiesOf` keeps every body of a name created twice (`create or replace function f()` dropping a table, `select f();`, a harmless second `create or replace`): refused now. Union, not order: a file that creates a harmless `f`, then a dropping one, then calls it was already refused; a file that creates a dropping body and replaces it before any call is refused too (conservative side).
3. GOTCHAS: P-117 added (a capture group read through `?.[1]` is `string | undefined` under `noUncheckedIndexedAccess`; the round-3 cost). G-029's proof now names the real output, `Tests  70 passed (70)` (64 rows: 38 refused, 26 allowed; plus 6 single tests), the five new entries and this round's probe; its rule names the backtracking case and the twice-created body. P-111 gained a line: this round's own hand mutation through `node -e` lost its backslashes and was stopped by the once-only guard (`Error: find count 0`) before any write.

### Proofs (run 2026-10-02, from `app/` unless noted)

Probe `node ../scratch/c6r4-probe.mjs [<script>]` (text below). Round-3 script (`git show HEAD:app/scripts/check-migrations.mjs` at `b0522a0`, saved as `../scratch/check-migrations-b0522a0.mjs`) → `cases 16, bad 10`; round-2 script (`../scratch/check-migrations-ee06839.mjs`) → `cases 16, bad 6`; this round → `cases 16, bad 0`:
```
== round3 (b0522a0)
BAD 1  alter  trigger rename  | destructive change (rename)
BAD 1  alter newline index rename  | destructive change (rename)
BAD 1  alter  policy rename  | destructive change (rename)
BAD 1  alter  table rename constraint  | destructive change (rename)
BAD 1  alter table rename  constraint  | destructive change (rename)
BAD 1  drop  constraint  | destructive change (drop column)
BAD 1  add newline constraint check not null  | destructive change (not null column
BAD 1  add  check not null  | destructive change (not null column
ok  0  drop  trigger
BAD 1  alter /* c */ trigger rename  | destructive change (rename)
ok  1  alter  view rename  | destructive change (rename)
ok  1  drop  column  | destructive change (drop column)
ok  1  add newline not null  | destructive change (not null column
BAD 0  create or replace twice
ok  1  create twice, called last  | destructive change (drop table)
ok  0  create twice, never called
cases 16, bad 10
== round2 (ee06839): the clause cases (rename  constraint, drop  constraint, both add cases) and both twice-created cases BAD
cases 16, bad 6
== this round: every line ok
cases 16, bad 0
```
No input either earlier version passed is refused now. The round-3 probe on this round's script: `node ../scratch/c6r3-probe.mjs` → `cases 39, bad 0`; `node ../scratch/c6r-probe.mjs` → 19 of 19 `ok`.

`tests/unit/check-migrations.test.ts`: five new rows. Allowed: `a trigger rename after two spaces` (the rename rule decides), `a constraint rename after two spaces` (the `rename` clause rule), `a drop constraint after two spaces` (the `drop column` clause rule), `an added constraint after a line break` (the NOT NULL add rule); each input is decided by one rule and protected only by the one-space step (P-112). Refused: `a function created twice and called` (`drop table`). Every name is 40 characters or fewer (P-116). `tests/mutations/B1b.json`: five new entries; `cm-one-space-rename`, `cm-one-space-clause-rename`, `cm-one-space-drop` and `cm-one-space-add` share the mutation (`text: statement.text.replace(/\s+/g, " ")` becomes `text: statement.text`) and each expects its own row; `cm-bodies-twice` puts back `bodies.set(name, literals);`.

```
$ bunx vitest run tests/unit/check-migrations.test.ts
      Tests  70 passed (70)
$ bunx vitest run tests/unit/hygiene.test.ts tests/unit/check-migrations.test.ts
      Tests  100 passed | 8 skipped (108)
$ node ../scratch/replay.mjs --check
checked 269, bad 0
$ node ../scratch/replay.mjs <all 78 entries whose file is scripts/check-migrations.mjs>
RED cm-one-space-rename: exit=1 expect=true | × a trigger rename after two spaces needs no contract-of header 7ms
RED cm-one-space-clause-rename: exit=1 expect=true | × a constraint rename after two spaces needs no contract-of header 1ms
RED cm-one-space-drop: exit=1 expect=true | × a drop constraint after two spaces needs no contract-of header 1ms
RED cm-one-space-add: exit=1 expect=true | × an added constraint after a line break needs no contract-of header 1ms
RED cm-bodies-twice: exit=1 expect=true | × a function created twice and called needs the contract-of header 8ms
  (the other 73 entries, ap and cm-, each RED with its own title)
replayed 78, not red 0
$ node ../scratch/c6r4-one.mjs cm-one-space-rename
mutated: .map((statement) => ({ ...statement, text: statement.text }))
× a trigger rename after two spaces needs no contract-of header 7ms
× a constraint rename after two spaces needs no contract-of header 1ms
× a drop constraint after two spaces needs no contract-of header 1ms
× an added constraint after a line break needs no contract-of header 1ms
+   "destructive change (rename) without \"-- contract-of: <14-digit version>\" in its first 30 lines: supabase/migrations/20261002110000_change.sql",
+   "destructive change (drop column) without \"-- contract-of: <14-digit version>\" in its first 30 lines: supabase/migrations/20261002110000_change.
+   "destructive change (not null column without a default) without \"-- contract-of: <14-digit version>\" in its first 30 lines: supabase/migrations/
Tests  4 failed | 66 passed (70)
$ node ../scratch/c6r4-one.mjs cm-bodies-twice
mutated: bodies.set(name, literals);
× a function created twice and called needs the contract-of header 8ms
-   "destructive change (drop table) without \"-- contract-of: <14-digit version>\" in its first 30 lines: supabase/migrations/20261002110000_change.s
Tests  1 failed | 69 passed (70)
$ cmp scripts/check-migrations.mjs ../scratch/cm-saved-r4.mjs && echo same-bytes
same-bytes
$ node ../scratch/c6-map.mjs | tail -1
titles 70, without an entry 0
$ node ../scratch/replay.mjs ao ap bd f g hy-engines-gone
RED bd: exit=1 expect=true | +   "noUncheckedIndexedAccess",
RED f: exit=1 expect=true | +     "ci.yml check setup-bun 1.3.13, engines.bun 1.3.14",
RED g: exit=1 expect=true | AssertionError: expected [ 'bun /app daily', …(1) ] to deeply equal [ 'bun /app weekly', …(1) ]
RED ao: exit=1 expect=true | +     "ci.yml: - uses: actions/upload-artifact@v4",
RED ap: exit=1 expect=true | × refuses an added file with an older timestamp than main 8ms
RED hy-engines-gone: exit=1 expect=true | × the check job compares the runner with engines before installing (8) 122ms
replayed 6, not red 0
$ node scripts/check-migrations.mjs ; echo "exit $?"
no migrations
exit 0
$ git -C .. ls-files "app/bun.lock"
app/bun.lock
$ node -p "require('./package.json').engines" ; ls ../.github/dependabot.yml
{ bun: '1.3.13', node: '24.x' }
../.github/dependabot.yml
$ cd .. && node workspace/05-plans/check-gotchas.mjs
check-gotchas: OK (29 path entries, 115 process entries)
```
The `c6r4-one` output shows three `+` lines for four red rows because vitest groups failures with the same error: the full output (dumped to a file) lists `FAIL ... a trigger rename after two spaces ...` and `FAIL ... a constraint rename after two spaces ...` on two lines above one shared diff, `+   "destructive change (rename) without ...`.

CI on `850b0d8` (run 37021011790, `pull_request`, success): `check success`, `build success`, `merge-gate skipped`; steps of `check`: `engines`, `Run actions/cache@...`, `Run bun install --frozen-lockfile`, `migration-order` (`$ node scripts/check-migrations.mjs` / `no migrations`), `Run bun run check` (`tests/unit/check-migrations.test.ts (70 tests)`), `audit`, all `success`; no job named `audit` or `deno`. `gh run download 37021011790 -n build-output -D scratch/c6r4-art` → `nitro.json package-lock.json package.json public server`, `server/wrangler.json` name `matter-of-place`.
Watched-fail (d), type error: `e2a0320` appends `const x: number = "a";` to `src/lib/strings.ts` (`+const x: number = "a";`). Run 37021230696: `failure`, `check failure`, `build success`; `##[error]src/lib/strings.ts(103,7): error TS2322: Type 'string' is not assignable to type 'number'.`, `##[error]Process completed with exit code 2.` Revert `ba13e17`: run 37021357512 `success` (`check success`, `build success`).
Watched-fail, engines: `c5b498f` sets `engines.bun` to `1.3.12` (`-    "bun": "1.3.13",` / `+    "bun": "1.3.12",`). Run 37021556434: `check failure` at step `engines` (`engines {"bun":"1.3.12","node":"24.x"} runner 1.3.13 24`, `##[error]Process completed with exit code 1.`); cache, install, `migration-order`, `bun run check` and `audit` `skipped`. Revert `e998d48`: run 37021661983 `success` (`check success`, `build success`).
Gates on the work tree of `850b0d8`: `bun run check` exit 0 (`layout: OK (586 files)`, knip's two known hints of P-065, `No duplicates found.`, `stubs: 15 markers, 0 on closed slices`, `Test Files 14 passed (14)`, `Tests 315 passed | 8 skipped (323)`); `bun run build` exit 0 (three `built in` lines, `src/routeTree.gen.ts` unchanged).

`scratch/c6r4-probe.mjs` (lane-root `scratch/`, git-ignored, run from `app/`; P-088)
```js
// node ../scratch/c6r4-probe.mjs [<path to check-migrations.mjs>]   (from app/)
// The review's round-4 cases: runs of whitespace before an excepted object, and a function
// created twice. Prints the failure count of each against what it must be.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const target = resolve(process.argv[2] ?? "scripts/check-migrations.mjs");
const { checkMigrations } = await import(pathToFileURL(target).href);
const dropping = "create or replace function f() returns void language plpgsql as $$ begin drop table notes; end $$;";
const harmless = "create or replace function f() returns void language sql as $$ select 1 $$;";

const cases = {
  "MUST 0  alter  trigger rename": "alter  trigger notes_touch on notes rename to notes_stamp;",
  "MUST 0  alter newline index rename": "alter\n  index notes_body_idx rename to notes_text_idx;",
  "MUST 0  alter  policy rename": "alter  policy notes_read on notes rename to notes_select;",
  "MUST 0  alter  table rename constraint": "alter  table notes rename constraint a to b;",
  "MUST 0  alter table rename  constraint": "alter table notes rename  constraint a to b;",
  "MUST 0  drop  constraint": "alter table notes drop  constraint c;",
  "MUST 0  add newline constraint check not null":
    "alter table notes add\n  constraint c check (body is not null);",
  "MUST 0  add  check not null": "alter table notes add  check (body is not null);",
  "MUST 0  drop  trigger": "drop  trigger notes_touch on notes;",
  "MUST 0  alter /* c */ trigger rename": "alter /* c */ trigger t on notes rename to u;",
  "MUST 1  alter  view rename": "alter  view v_notes rename to v_memos;",
  "MUST 1  drop  column": "alter table notes drop  column body;",
  "MUST 1  add newline not null": "alter table notes add\n  y text not null;",
  "MUST 1  create or replace twice": `${dropping}\nselect f();\n${harmless}`,
  "MUST 1  create twice, called last": `${harmless}\n${dropping}\nselect f();`,
  "MUST 0  create twice, never called": `${dropping}\n${harmless}`,
};
let bad = 0;
for (const [name, sql] of Object.entries(cases)) {
  const file = "supabase/migrations/20261002110000_x.sql";
  const failures = checkMigrations({
    changed: [],
    added: [file],
    mainPrefixes: ["20261002100000"],
    readFile: () => `-- irreversible: x\nset lock_timeout = '5s';\n${sql}\n`,
  });
  const want = Number(name.slice(5, 6));
  const ok = failures.length === want;
  bad += ok ? 0 : 1;
  console.log(`${ok ? "ok " : "BAD"} ${String(failures.length)}  ${name.slice(8)}${failures.length > 0 ? `  | ${failures[0].split(" without")[0]}` : ""}`);
}
console.log(`cases ${String(Object.keys(cases).length)}, bad ${String(bad)}`);
```

`scratch/c6r4-one.mjs` (same folder; applies one registry entry, prints the mutated line and the red reason, restores the bytes)
```js
// node ../scratch/c6r4-one.mjs <id>   (from app/)
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const entry = JSON.parse(readFileSync("tests/mutations/B1b.json", "utf8")).find((e) => e.id === process.argv[2]);
const saved = readFileSync(entry.file);
const text = saved.toString("utf8");
if (text.split(entry.find).length !== 2) throw new Error("find does not occur exactly once");
const mutated = text.replace(entry.find, () => entry.replace);
if (mutated === text) throw new Error("mutation changed nothing");
writeFileSync(entry.file, mutated);
try {
  console.log("mutated:", mutated.split("\n").find((l) => l.includes(entry.replace)).trim());
  let out = "";
  try {
    out = execSync(`${entry.run} 2>&1`, { encoding: "utf8" });
  } catch (error) {
    out = String(error.stdout);
  }
  console.log(out.split("\n").filter((l) => /×|Tests |destructive change/.test(l)).map((l) => l.trim().slice(0, 150)).join("\n"));
} finally {
  writeFileSync(entry.file, saved);
}
```

UNPROVEN: Dependabot (`gh pr list --author "app/dependabot" --state all --json number --jq length` → `0`; `dependabot.yml` is not on `main` yet). The scan has met no real migration yet (B2 writes the first). Open from round 2, unchanged: the `drop function` conflict with B2.md:71, B2.md:93 and B10.md:166 (P-113) still needs a ruling. Not handled, by choice, as in round 3 (`format()` and `||` pieces, quoted function names, triggers from earlier migrations, `raise notice 'drop table ...'` refused, a table named like a function counts as a call).

GOTCHAS: P-117 added; G-029 rule and proof corrected; P-111 extended.

## c6 · steps 5

Round 5 of the c6 close-out: the three additions of rulings ASSUMED H43 and H44 and the runbook limits. Commits on `slice/b1b`: `d937e39` (the work), `250d94f` and `304d820` (type-error watched-fail and its revert), `c6b578d` and `6bd1b3d` (engines watched-fail and its revert); `git diff --quiet d937e39 HEAD` exit 0 after each revert. This log block is committed after them.

1. H43 (1): `recreates(text, created)` in `scripts/check-migrations.mjs`. A `drop function`, `drop procedure` or `drop routine` (with or without `if exists`, at a statement start as every other drop) adds no kind when every name it drops, split on the commas outside parentheses and read without a schema prefix, is a name some `create [or replace] function|procedure` of the same file creates (the names `bodiesOf` already collects, passed down as `created`). A name in quotes is blanked by the lexer and never counts as created, so it is refused. Order inside the file is not read: the ruling says "creates", and both orders are a signature change. `drop trigger` and `drop policy` unchanged.
2. H44 (1): `CONTRACT_HEADER` captures the version; a destructive file whose version is not in `mainPrefixes` gets `contract-of names a version that is not on main: <file>`. Only a destructive file is checked, as the ruling says.
3. H44 (2): `truncate` at a statement start is the kind `truncate`; the lexer keeps the word in a comment or a string out of the statement text, and a DO block or `execute '...'` reads it.
4. Runbook: `app/docs/runbooks/delivery.md` section `Migration order check`: what is refused, what passes (trigger and policy drops, the excepted renames, the H43 (1) drop, `alter publication ... drop table` and `alter extension ... drop`), and what the scan does not read (`format()` and joined strings, a function named in quotes, a trigger from an earlier migration, a table named like a function, `delete from`).
5. Tests: `tests/unit/check-migrations.test.ts` has 11 new rows and one new test. Refused: `a drop of two functions, one created`, `a function dropped, another created`, `a drop table named like a new function`, `a truncate`. Allowed: `a drop then create of one function`, `a drop then create with a schema`, `a drop if exists then create`, `the db:fn form of a signature change` (the orchestrator's probe input), `a drop then create of one procedure`, `a truncate inside a comment`, `a truncate inside a string`. New test: `refuses a contract-of version that is not on main`. `refuses a contract-of header without a 14-digit version` now asserts the exact message: with `toHaveLength(1)` the `cm-contract-digits` mutation would have stayed green, because the 6-digit version now gives the not-on-main failure instead. The refused row for the drop alone, `a drop function`, was already there; `cm-routine-alone` now guards it too. Every row name is 40 characters or fewer (P-116); the comment and string rows each hold a `;` so that one mechanism decides them (P-112).
6. Registry `tests/mutations/B1b.json`: 14 new entries (`cm-routine-recreated`, `cm-routine-dbfn`, `cm-routine-schema`, `cm-routine-if-exists`, `cm-routine-procedure`, `cm-routine-every`, `cm-routine-name`, `cm-routine-table`, `cm-routine-alone`, `cm-truncate`, `cm-truncate-comment`, `cm-truncate-string`, `cm-contract-on-main`, `cm-contract-on-main-accept`). Three entries moved with the code (P-090), found by `--check` (`BAD cm-destructive`, `BAD cm-contract-header`, `BAD cm-contract-digits: find occurs 0 times`, `checked 269, bad 3`) and rewritten: `cm-destructive` now `if (kinds.length > 0) {` to `if (false) {`, `cm-contract-header` `if (version === undefined) {` to `if (true) {`, `cm-contract-digits` `/^-- contract-of: (\d{14})\b/m` to `/^-- contract-of: (\d+)/m`.
7. GOTCHAS: G-029's proof count brought to `Tests  82 passed (82)`. No new entry: nothing in this round cost a second attempt beyond a constant renamed before the first run.

### Proofs (run 2026-10-02, from `app/` unless noted)

The orchestrator's probe, `node ../scratch/orch-cm-probe.mjs` (27 cases). Before, on `850b0d8`:
```
BAD  refused  drop function then create same name (H43: allowed)  -> destructive change (drop function) without "-- contract-of: <14-digit version>" in its fir
INFO allowed  truncate
INFO allowed  contract header names a version not on main
cases 27, bad 1
```
After:
```
INFO refused  truncate  -> destructive change (truncate) without "-- contract-of: <14-digit version>" in its first 30
INFO allowed  delete without where
INFO refused  contract header names a version not on main  -> contract-of names a version that is not on main: supabase/migrations/20261003000000_probe.
cases 27, bad 0
```
(every other line `ok`).

This round's probe `node ../scratch/c6r5-probe.mjs [<script>]` (text below), on this script and on the round-4 script saved from `850b0d8` as `../scratch/check-migrations-850b0d8.mjs`:
```
== this round
ok  0  drop function then create, schema and if exists
ok  0  drop public.f, create f
ok  0  drop routine, create function
ok  0  create first, then drop the old signature
ok  1  drop function alone  | destructive change (drop function)
ok  1  drop procedure alone  | destructive change (drop procedure)
ok  1  drop two, create one  | destructive change (drop function)
ok  1  drop function inside a DO block, not created  | destructive change (drop function)
ok  1  drop aggregate  | destructive change (drop aggregate)
ok  1  truncate  | destructive change (truncate)
ok  1  truncate, two tables  | destructive change (truncate)
ok  1  truncate inside a DO block  | destructive change (truncate)
ok  1  truncate run by EXECUTE  | destructive change (truncate)
ok  0  truncate in a comment
ok  0  truncate in a string
ok  0  alter publication drop table
ok  0  alter extension drop function
ok  0  delete from (not read)
ok  0  format() in a DO block (not read)
ok  0  quoted function called (not read)
ok  1  table named like a function reads as a call  | destructive change (drop table)
ok  0  contract-of 20261001090000
ok  1  contract-of 20269999000000  | contract-of names a version that is not on main: supabase/migrations/20261002110000_x.sql
cases 23, bad 0
== round 4 (850b0d8)
BAD 1  drop function then create, schema and if exists  | destructive change (drop function)
BAD 1  drop public.f, create f  | destructive change (drop function)
BAD 1  drop routine, create function  | destructive change (drop routine)
BAD 1  create first, then drop the old signature  | destructive change (drop function)
BAD 0  truncate
BAD 0  truncate, two tables
BAD 0  truncate inside a DO block
BAD 0  truncate run by EXECUTE
BAD 0  contract-of 20269999000000
cases 23, bad 9
```
G-028 check: the only inputs round 4 refused and this round passes are the four drop-then-create cases, which ruling H43 (1) allows. The earlier probes on this script: `node ../scratch/c6r4-probe.mjs` → `cases 16, bad 0`; `node ../scratch/c6r3-probe.mjs` → `cases 39, bad 0`; `node ../scratch/c6r-probe.mjs | grep -vc "^ok"` → `0`.

```
$ bunx vitest run tests/unit/check-migrations.test.ts
      Tests  82 passed (82)
$ bunx vitest run tests/unit/hygiene.test.ts tests/unit/check-migrations.test.ts
 Test Files  2 passed (2)
      Tests  112 passed | 8 skipped (120)
$ node ../scratch/replay.mjs --check
checked 283, bad 0
$ node ../scratch/replay.mjs cm-destructive cm-contract-header cm-contract-digits cm-routine-recreated cm-routine-dbfn cm-routine-schema cm-routine-if-exists cm-routine-procedure cm-routine-every cm-routine-name cm-routine-table cm-routine-alone cm-truncate cm-truncate-comment cm-truncate-string cm-contract-on-main cm-contract-on-main-accept
RED cm-destructive: exit=1 expect=true | × a drop column needs the contract-of header 2ms
RED cm-contract-header: exit=1 expect=true | × accepts a drop column with the contract-of header in its first 30 lines 8ms
RED cm-contract-digits: exit=1 expect=true | × refuses a contract-of header without a 14-digit version 8ms
RED cm-routine-recreated: exit=1 expect=true | × a drop then create of one function needs no contract-of header 7ms
RED cm-routine-dbfn: exit=1 expect=true | × the db:fn form of a signature change needs no contract-of header 1ms
RED cm-routine-schema: exit=1 expect=true | × a drop then create with a schema needs no contract-of header 8ms
RED cm-routine-if-exists: exit=1 expect=true | × a drop if exists then create needs no contract-of header 8ms
RED cm-routine-procedure: exit=1 expect=true | × a drop then create of one procedure needs no contract-of header 10ms
RED cm-routine-every: exit=1 expect=true | × a drop of two functions, one created needs the contract-of header 8ms
RED cm-routine-name: exit=1 expect=true | × a function dropped, another created needs the contract-of header 1ms
RED cm-routine-table: exit=1 expect=true | × a drop table named like a new function needs the contract-of header 7ms
RED cm-routine-alone: exit=1 expect=true | × a drop function needs the contract-of header 7ms
RED cm-truncate: exit=1 expect=true | × a truncate needs the contract-of header 7ms
RED cm-truncate-comment: exit=1 expect=true | × a truncate inside a comment needs no contract-of header 1ms
RED cm-truncate-string: exit=1 expect=true | × a truncate inside a string needs no contract-of header 1ms
RED cm-contract-on-main: exit=1 expect=true | × refuses a contract-of version that is not on main 8ms
RED cm-contract-on-main-accept: exit=1 expect=true | × accepts a drop column with the contract-of header in its first 30 lines 8ms
replayed 17, not red 0
$ node ../scratch/replay.mjs <all 92 entries whose file is scripts/check-migrations.mjs>
  (92 lines RED, each with its own title)
replayed 92, not red 0
$ cmp scripts/check-migrations.mjs ../scratch/cm-saved-r5.mjs && echo same-bytes
same-bytes
$ node ../scratch/c6-map.mjs | tail -1
titles 82, without an entry 0
$ node ../scratch/c6r4-one.mjs cm-routine-schema
mutated: const ROUTINE_NAME = /^([A-Za-z_][\w$]*)/;
× a drop then create with a schema needs no contract-of header 8ms
× the db:fn form of a signature change needs no contract-of header 1ms
+   "destructive change (drop function) without \"-- contract-of: <14-digit version>\" in its first 30 lines: supabase/migrations/20261002110000_chang
Tests  2 failed | 80 passed (82)
$ node ../scratch/c6r4-one.mjs cm-routine-if-exists
mutated: String.raw`${START}drop\s+(?:function|procedure|routine)\s+`,
× a drop if exists then create needs no contract-of header 8ms
× the db:fn form of a signature change needs no contract-of header 1ms
Tests  2 failed | 80 passed (82)
$ node ../scratch/c6r4-one.mjs cm-truncate-comment
mutated: if (false) {
× a down header that drops the new column needs no contract-of header 8ms
× a truncate inside a comment needs no contract-of header 1ms
+   "destructive change (truncate) without \"-- contract-of: <14-digit version>\" in its first 30 lines: supabase/migrations/20261002110000_change.sql
Tests  2 failed | 80 passed (82)
$ node ../scratch/c6r4-one.mjs cm-contract-digits
mutated: const CONTRACT_HEADER = /^-- contract-of: (\d+)/m;
× refuses a contract-of header without a 14-digit version 7ms
-   "destructive change (drop column) without \"-- contract-of: <14-digit version>\" in its first 30 lines: supabase/migrations/20261002110000_drop_bo
Tests  1 failed | 81 passed (82)
$ node ../scratch/replay.mjs ao ap bd f g hy-engines-gone
RED bd: exit=1 expect=true | +   "noUncheckedIndexedAccess",
RED f: exit=1 expect=true | +     "ci.yml check setup-bun 1.3.13, engines.bun 1.3.14",
RED g: exit=1 expect=true | AssertionError: expected [ 'bun /app daily', …(1) ] to deeply equal [ 'bun /app weekly', …(1) ]
RED ao: exit=1 expect=true | +     "ci.yml: - uses: actions/upload-artifact@v4",
RED ap: exit=1 expect=true | × refuses an added file with an older timestamp than main 8ms
RED hy-engines-gone: exit=1 expect=true | × the check job compares the runner with engines before installing (8) 113ms
replayed 6, not red 0
$ node scripts/check-migrations.mjs ; echo "exit $?"
no migrations
exit 0
$ git -C .. ls-files "app/bun.lock"
app/bun.lock
$ node -p "require('./package.json').engines"
{ bun: '1.3.13', node: '24.x' }
$ cd .. && node workspace/05-plans/check-gotchas.mjs
check-gotchas: OK (29 path entries, 117 process entries)
```

CI on `d937e39` (run 37025909287, `pull_request`, success): `build success`, `check success`, `merge-gate skipped`; steps of `check`: `engines`, `Run actions/cache@...`, `Run bun install --frozen-lockfile`, `migration-order` (log `no migrations`), `Run bun run check` (log `tests/unit/check-migrations.test.ts (82 tests)`), `audit`, all `success`; no job named `audit` or `deno`. `gh run download 37025909287 -n build-output -D scratch/c6r5-art` → `nitro.json package-lock.json package.json public server`, `server/wrangler.json` name `matter-of-place`.
Watched-fail (d), type error: `250d94f` appends `const x: number = "a";` to `src/lib/strings.ts`. Run 37026152606: `failure`, `check failure`, `build success`; `##[error]src/lib/strings.ts(103,7): error TS2322: Type 'string' is not assignable to type 'number'.`, `##[error]Process completed with exit code 2.` Revert `304d820`: run 37026288809 `success` (`check success`, `build success`).
Watched-fail, engines: `c6b578d` sets `engines.bun` to `1.3.12` (`-    "bun": "1.3.13",` / `+    "bun": "1.3.12",`). Run 37026490972: `check failure` at step `engines` (`engines {"bun":"1.3.12","node":"24.x"} runner 1.3.13 24`, `##[error]Process completed with exit code 1.`); cache, install, `migration-order`, `bun run check` and `audit` `skipped`. Revert `6bd1b3d`: run 37026611262 `success` (`check success`, `build success`).
Gates on the work tree of `d937e39`: `bun run check` exit 0 (`layout: OK (586 files)`, knip's two known hints of P-065, `No duplicates found.`, `stubs: 15 markers, 0 on closed slices`, `Test Files  14 passed (14)`, `Tests  327 passed | 8 skipped (335)`); `bun run build` exit 0 (three `built in` lines, `src/routeTree.gen.ts` unchanged).

`scratch/c6r5-probe.mjs` (lane-root `scratch/`, git-ignored, run from `app/`; P-088)
```js
// node ../scratch/c6r5-probe.mjs [<path to check-migrations.mjs>]   (from app/)
// The claims of the runbook section "Migration order check" and the round-5 rulings (H43 (1),
// H44): each case prints its failure count against what the runbook says.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const target = resolve(process.argv[2] ?? "scripts/check-migrations.mjs");
const { checkMigrations } = await import(pathToFileURL(target).href);
const dropping = "create function notes() returns void language plpgsql as $$ begin drop table memos; end $$;";

const cases = {
  "MUST 0  drop function then create, schema and if exists":
    "drop function if exists public.f(int);\ncreate function public.f(a int, b int) returns int language sql as $$ select 1 $$;",
  "MUST 0  drop public.f, create f": "drop function public.f(int);\ncreate function f(a text) returns int language sql as $$ select 1 $$;",
  "MUST 0  drop routine, create function": "drop routine f(int);\ncreate function f(a text) returns int language sql as $$ select 1 $$;",
  "MUST 0  create first, then drop the old signature":
    "create function f(a text) returns int language sql as $$ select 1 $$;\ndrop function f(int);",
  "MUST 1  drop function alone": "drop function f(int);",
  "MUST 1  drop procedure alone": "drop procedure p(int);",
  "MUST 1  drop two, create one": "drop function f(int), g(int);\ncreate function f(a text) returns int language sql as $$ select 1 $$;",
  "MUST 1  drop function inside a DO block, not created": "do $$ begin drop function f(int); end $$;",
  "MUST 1  drop aggregate": "drop aggregate agg(int);",
  "MUST 1  truncate": "truncate table notes;",
  "MUST 1  truncate, two tables": "truncate notes, memos restart identity;",
  "MUST 1  truncate inside a DO block": "do $$ begin if true then truncate notes; end if; end $$;",
  "MUST 1  truncate run by EXECUTE": "do $$ begin execute 'truncate notes'; end $$;",
  "MUST 0  truncate in a comment": "create table memos (id uuid); -- truncate notes",
  "MUST 0  truncate in a string": "comment on table notes is 'truncate later';",
  "MUST 0  alter publication drop table": "alter publication supabase_realtime drop table notes;",
  "MUST 0  alter extension drop function": "alter extension pg_trgm drop function similarity(text, text);",
  "MUST 0  delete from (not read)": "delete from notes;",
  "MUST 0  format() in a DO block (not read)": "do $$ begin execute format('drop %s notes', 'table'); end $$;",
  "MUST 0  quoted function called (not read)":
    'create function "Wipe"() returns void language plpgsql as $$ begin drop table notes; end $$;\nselect "Wipe"();',
  "MUST 1  table named like a function reads as a call": `${dropping}\ninsert into notes (id) values (1);`,
};
let bad = 0;
for (const [name, sql] of Object.entries(cases)) {
  const file = "supabase/migrations/20261002110000_x.sql";
  const failures = checkMigrations({
    changed: [],
    added: [file],
    mainPrefixes: ["20261002100000"],
    readFile: () => `-- irreversible: x\nset lock_timeout = '5s';\n${sql}\n`,
  });
  const want = Number(name.slice(5, 6));
  const ok = failures.length === want;
  bad += ok ? 0 : 1;
  console.log(`${ok ? "ok " : "BAD"} ${String(failures.length)}  ${name.slice(8)}${failures.length > 0 ? `  | ${failures[0].split(" without")[0]}` : ""}`);
}
const header = (version) =>
  checkMigrations({
    changed: [],
    added: ["supabase/migrations/20261002110000_x.sql"],
    mainPrefixes: ["20261001090000", "20261002100000"],
    readFile: () => `-- contract-of: ${version}\n-- irreversible: x\nalter table notes drop column body;\n`,
  });
for (const [version, want] of [["20261001090000", 0], ["20269999000000", 1]]) {
  const failures = header(version);
  const ok = failures.length === want;
  bad += ok ? 0 : 1;
  console.log(`${ok ? "ok " : "BAD"} ${String(failures.length)}  contract-of ${version}${failures.length > 0 ? `  | ${failures[0]}` : ""}`);
}
console.log(`cases ${String(Object.keys(cases).length + 2)}, bad ${String(bad)}`);
```
`orch-cm-probe.mjs` is the orchestrator's file in the same folder; `replay.mjs` is in the g4 close-out block, `c6r4-one.mjs` in the round-4 block above.

UNPROVEN: Dependabot (`gh pr list --author "app/dependabot" --state all --json number --jq length` → `0`; `dependabot.yml` is not on `main` yet). The scan has met no real migration yet (B2 writes the first). The P-113 conflict is settled by H43 (1) in this script; the B2 lines that still describe the old pattern list (B2.md:71 invariant 14, replaced by reference in H43 (3)) are the orchestrator's to fold.

GOTCHAS: G-029 proof count updated; no new entry.

## c6 · steps 5

Round 6 of the c6 close-out: the two defects of the round-5 review of `scripts/check-migrations.mjs` (ruling H43 (1)). Commits on `slice/b1b`: `53556e8` (the work), `ce3b669` and `5b69ed0` (type-error watched-fail and its revert), `ab34d32` and `b061160` (engines watched-fail and its revert); `git diff --quiet 53556e8 HEAD` exit 0 after each revert. This log block is committed after them.

1. Cascade. `recreates()` now also needs `!CASCADE.test(text)` (`CASCADE = /\bcascade$/i`, on the statement text with blanks collapsed, so the word is the last of the statement as the `DROP FUNCTION ... [CASCADE | RESTRICT]` grammar puts it). A routine drop with `cascade` is refused without the header whatever the file creates. `restrict` and a name that starts with `cascade` still pass.
2. Schema and order. `ROUTINE_NAME` and `CREATE_FUNCTION` capture the schema; `qualified(schema, name)` gives `<schema>.<name>` in lower case, with `public` for a name written without one. `createdAfter(statements)` gives each top-level statement the names that the statements after it create; `destructiveKinds` takes `createdLater(index)` instead of one set, and a DO block or a called body read inside a statement keeps that statement's set. So a drop passes only when a later statement creates the same schema and name: `drop function other.f(int)` with `create function public.f` is refused, and so is `create or replace function f(text) ...; drop function f(text);`.
3. Behaviour that changed on purpose: round 5's probe case `create first, then drop the old signature` (create `f(text)`, then drop `f(int)`) passed and is now refused. The scan does not compare argument types, so it cannot tell that case from the reviewer's `create f(text); drop f(text)`, which removes the new function. `bun run db:fn` writes the drop before the create (B2.md:93, B10.md:166, review files B2, B3, B8, B9, B10, B15 line "prepends `drop function if exists`"), so the refused order costs the legitimate path nothing. `git grep -n -i "cascade" -- workspace/05-plans/B2.md workspace/05-plans/B10.md` shows no routine drop with `cascade` in any plan (only foreign keys `on delete cascade` and the delete paths of B2 invariant 4). No plan line conflicts (P-113).
4. Runbook `app/docs/runbooks/delivery.md`, section `Migration order check`: the exception now says "a later statement ... of every schema and name it drops"; a new paragraph says that a drop with `cascade` always needs the header and why, that without `cascade` Postgres refuses a drop something depends on, and that a create before the drop does not count. The "does not read" list gained: argument types, `set search_path` (no schema reads as `public`), and a function created inside a DO block or by `execute` (never counts as created, so the drop is refused).
5. Tests `tests/unit/check-migrations.test.ts`: 7 new rows. Refused: `a drop function cascade, then create`, `a drop in another schema, then create`, `a create, then a drop of the same name`. Allowed: `a bare drop, then a public create`, `a drop in capitals, then create`, `a drop restrict, then create`, `a function whose name starts cascade`. Every row name is 40 characters or fewer (P-116). 89 tests: 82 rows (45 refused, 37 allowed) and 7 single tests.
6. Registry `tests/mutations/B1b.json`: 7 new entries (`cm-routine-cascade`, `cm-routine-restrict`, `cm-routine-cascade-word`, `cm-routine-other-schema`, `cm-routine-public`, `cm-routine-case`, `cm-routine-order`). Three moved with the code (P-090), found by `--check` (`BAD cm-routine-schema`, `BAD cm-routine-name`, `BAD cm-routine-alone: find occurs 0 times`, `checked 283, bad 3`) and rewritten to the new text; `cm-routine-schema` now makes the schema group lazy (`)?` to `)??`), so `public.f` reads as the name `public`.
7. GOTCHAS: G-030 (an exception to the scan passes more than the statement the ruling meant), and G-029's proof count brought to `Tests  89 passed (89)`.

### Proofs (run 2026-10-02, from `app/` unless noted)

The review's defect reproduced first, on the round-5 script saved from `cfe521a` as `../scratch/cm-saved-r5.mjs` (`cmp` with the committed file: `same-bytes`), with `node ../scratch/c6r6-probe.mjs ../scratch/cm-saved-r5.mjs` (text below):
```
BAD 0  drop function cascade, then create
BAD 0  drop if exists cascade, then create
BAD 0  drop procedure cascade, then create
BAD 0  drop two cascade, both created
BAD 0  drop cascade over two lines, then create
BAD 0  drop other.f, create public.f
BAD 0  drop public.f, create other.f
BAD 0  create or replace f(text), then drop f(text)
BAD 0  drop, create, drop again
BAD 0  drop in a DO block, cascade
ok  0  drop f, create public.f
(7 more ok 0 lines)
cases 18, bad 10
```
After, `node ../scratch/c6r6-probe.mjs`:
```
ok  1  drop function cascade, then create  | destructive change (drop function)
ok  1  drop if exists cascade, then create  | destructive change (drop function)
ok  1  drop procedure cascade, then create  | destructive change (drop procedure)
ok  1  drop two cascade, both created  | destructive change (drop function)
ok  1  drop cascade over two lines, then create  | destructive change (drop function)
ok  1  drop other.f, create public.f  | destructive change (drop function)
ok  1  drop public.f, create other.f  | destructive change (drop function)
ok  1  create or replace f(text), then drop f(text)  | destructive change (drop function)
ok  1  drop, create, drop again  | destructive change (drop function)
ok  1  drop in a DO block, cascade  | destructive change (drop function)
ok  0  drop f, create public.f
ok  0  drop public.f, create f
ok  0  the db:fn form
ok  0  drop restrict, then create
ok  0  drop in capitals, then create
ok  0  drop routine, then create function
ok  0  drop two, both created after
ok  0  a function named like cascade
cases 18, bad 0
```
G-028 check, the earlier probes on the new script: `node ../scratch/c6r5-probe.mjs` → `cases 23, bad 1`, the one being `BAD 1  create first, then drop the old signature  | destructive change (drop function)` (item 3, refused on purpose); `node ../scratch/c6r4-probe.mjs` → `cases 16, bad 0`; `node ../scratch/c6r3-probe.mjs` → `cases 39, bad 0`; `node ../scratch/c6r-probe.mjs | grep -vc "^ok"` → `0`; `node ../scratch/orch-cm-probe.mjs` → `cases 27, bad 0`. No input that round 5 refused passes now.

Why `cascade` is refused and the `db:fn` form is safe, on a throwaway native PostgreSQL 18 cluster (`initdb` in the session scratchpad, port 55439, stopped and deleted after), `psql -v ON_ERROR_STOP=0 -f cascade.sql`:
```sql
create function f(a int) returns int language sql immutable as $$ select a * 2 $$;
create table notes (n int, doubled int generated always as (f(n)) stored, d2 int default f(1));
create view v as select f(n) from notes;
\echo == the db:fn form, no cascade
drop function if exists public.f(int);
\echo == the same drop with cascade
drop function if exists public.f(int) cascade;
\d notes
select count(*) as views_named_v from pg_views where viewname = 'v';
```
```
== the db:fn form, no cascade
psql:.../cascade.sql:5: ERROR:  cannot drop function f(integer) because other objects depend on it
DETAIL:  column doubled of table notes depends on function f(integer)
default value for column d2 of table notes depends on function f(integer)
view v depends on function f(integer)
HINT:  Use DROP ... CASCADE to drop the dependent objects too.
== the same drop with cascade
psql:.../cascade.sql:7: NOTICE:  drop cascades to 3 other objects
DETAIL:  drop cascades to column doubled of table notes
drop cascades to default value for column d2 of table notes
drop cascades to view v
DROP FUNCTION
 Column |  Type   | Collation | Nullable | Default
 n      | integer |           |          |
 d2     | integer |           |          |
 views_named_v
             0
```

Watched-fail of the new rows against the round-5 script (`cp ../scratch/cm-saved-r5.mjs scripts/check-migrations.mjs`, run, `cp ../scratch/cm-saved-r6.mjs scripts/check-migrations.mjs`, `cmp` → `restored`):
```
     × a drop function cascade, then create needs the contract-of header 7ms
     × a drop in another schema, then create needs the contract-of header 1ms
     × a create, then a drop of the same name needs the contract-of header 1ms
      Tests  3 failed | 86 passed (89)
```

```
$ bunx vitest run tests/unit/check-migrations.test.ts
      Tests  89 passed (89)
$ bunx vitest run tests/unit/hygiene.test.ts tests/unit/check-migrations.test.ts
 Test Files  2 passed (2)
      Tests  119 passed | 8 skipped (127)
$ node ../scratch/replay.mjs --check
checked 290, bad 0
$ node ../scratch/replay.mjs cm-routine-schema cm-routine-name cm-routine-alone cm-routine-cascade cm-routine-restrict cm-routine-cascade-word cm-routine-other-schema cm-routine-public cm-routine-case cm-routine-order
RED cm-routine-schema: exit=1 expect=true | × a drop then create with a schema needs no contract-of header 7ms
RED cm-routine-name: exit=1 expect=true | × a function dropped, another created needs the contract-of header 1ms
RED cm-routine-alone: exit=1 expect=true | × a drop function needs the contract-of header 8ms
RED cm-routine-cascade: exit=1 expect=true | × a drop function cascade, then create needs the contract-of header 8ms
RED cm-routine-restrict: exit=1 expect=true | × a drop restrict, then create needs no contract-of header 8ms
RED cm-routine-cascade-word: exit=1 expect=true | × a function whose name starts cascade needs no contract-of header 8ms
RED cm-routine-other-schema: exit=1 expect=true | × a drop in another schema, then create needs the contract-of header 7ms
RED cm-routine-public: exit=1 expect=true | × a bare drop, then a public create needs no contract-of header 8ms
RED cm-routine-case: exit=1 expect=true | × a drop in capitals, then create needs no contract-of header 8ms
RED cm-routine-order: exit=1 expect=true | × a create, then a drop of the same name needs the contract-of header 7ms
replayed 10, not red 0
$ node ../scratch/replay.mjs <all 99 entries whose file is scripts/check-migrations.mjs>
  (99 lines RED)
replayed 99, not red 0
$ cmp scripts/check-migrations.mjs ../scratch/cm-saved-r6.mjs && echo same-bytes
same-bytes
$ node ../scratch/c6-map.mjs | tail -1
titles 89, without an entry 0
$ node ../scratch/replay.mjs ao ap bd f g hy-engines-gone
RED bd: exit=1 expect=true | +   "noUncheckedIndexedAccess",
RED f: exit=1 expect=true | +     "ci.yml check setup-bun 1.3.13, engines.bun 1.3.14",
RED g: exit=1 expect=true | AssertionError: expected [ 'bun /app daily', …(1) ] to deeply equal [ 'bun /app weekly', …(1) ]
RED ao: exit=1 expect=true | +     "ci.yml: - uses: actions/upload-artifact@v4",
RED ap: exit=1 expect=true | × refuses an added file with an older timestamp than main 7ms
RED hy-engines-gone: exit=1 expect=true | × the check job compares the runner with engines before installing (8) 118ms
replayed 6, not red 0
$ node scripts/check-migrations.mjs ; echo "exit $?"
no migrations
exit 0
$ git -C .. ls-files "app/bun.lock"
app/bun.lock
$ node -p "require('./package.json').engines"
{ bun: '1.3.13', node: '24.x' }
$ cd .. && node workspace/05-plans/check-gotchas.mjs
check-gotchas: OK (30 path entries, 117 process entries)
```

CI on `53556e8` (run 37029241962, `pull_request`, success): `check success`, `build success`, `merge-gate skipped`; steps of `check`: `engines`, `Run actions/cache@...`, `Run bun install --frozen-lockfile`, `migration-order` (log `no migrations`), `Run bun run check` (log `tests/unit/check-migrations.test.ts (89 tests)`), `audit`, all `success`; no job named `audit` or `deno`. `gh run download 37029241962 -n build-output -D scratch/c6r6-art` → `nitro.json package-lock.json package.json public server`, `server/wrangler.json` name `matter-of-place`.
Watched-fail (d), type error: `ce3b669` appends `const x: number = "a";` to `src/lib/strings.ts`. Run 37029489695: `failure`, `check failure`, `build success`; `##[error]src/lib/strings.ts(103,7): error TS2322: Type 'string' is not assignable to type 'number'.`, `##[error]Process completed with exit code 2.` Revert `5b69ed0`: run 37029602095 `success` (`check success`, `build success`).
Watched-fail, engines: `ab34d32` sets `engines.bun` to `1.3.12` (`-    "bun": "1.3.13",` / `+    "bun": "1.3.12",`). Run 37029756417: `check failure` at step `engines` (`engines {"bun":"1.3.12","node":"24.x"} runner 1.3.13 24`, `##[error]Process completed with exit code 1.`); cache, install, `migration-order`, `bun run check` and `audit` `skipped`. Revert `b061160`: run 37029889566 `success` (`check success`, `build success`).
Gates on the work tree of `53556e8`: `bun run check` exit 0 (`layout: OK (586 files)`, knip's two known hints of P-065, `No duplicates found.`, `stubs: 15 markers, 0 on closed slices`, `Test Files  14 passed (14)`, `Tests  334 passed | 8 skipped (342)`); `bun run build` exit 0 (three `built in` lines).

`scratch/c6r6-probe.mjs` (lane-root `scratch/`, git-ignored, run from `app/`; P-088)
```js
// node ../scratch/c6r6-probe.mjs [<path to check-migrations.mjs>]   (from app/)
// The two defects of the round-5 review (H43 (1)): a drop that cascades, and a name matched
// without its schema or its place in the file. Each case prints its failure count.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const target = resolve(process.argv[2] ?? "scripts/check-migrations.mjs");
const { checkMigrations } = await import(pathToFileURL(target).href);
const NEW_F = "create function public.f(a text) returns int language sql as $$ select 1 $$;";

const cases = {
  "MUST 1  drop function cascade, then create": `drop function f(int) cascade;\n${NEW_F}`,
  "MUST 1  drop if exists cascade, then create": `drop function if exists public.f(int) cascade;\n${NEW_F}`,
  "MUST 1  drop procedure cascade, then create":
    "drop procedure p(int) cascade;\ncreate procedure p(a text) language sql as $$ select 1 $$;",
  "MUST 1  drop two cascade, both created":
    "drop function f(int), g(int) cascade;\ncreate function f(a text) returns int language sql as $$ select 1 $$;\ncreate function g(a text) returns int language sql as $$ select 1 $$;",
  "MUST 1  drop cascade over two lines, then create": `drop function f(int)\n  CASCADE;\n${NEW_F}`,
  "MUST 1  drop other.f, create public.f": `drop function other.f(int);\n${NEW_F}`,
  "MUST 1  drop public.f, create other.f":
    "drop function public.f(int);\ncreate function other.f(a text) returns int language sql as $$ select 1 $$;",
  "MUST 1  create or replace f(text), then drop f(text)":
    "create or replace function f(a text) returns int language sql as $$ select 1 $$;\ndrop function f(text);",
  "MUST 1  drop, create, drop again":
    `drop function f(int);\n${NEW_F}\ndrop function f(text);`,
  "MUST 1  drop in a DO block, cascade": `do $$ begin drop function f(int) cascade; end $$;\n${NEW_F}`,
  "MUST 0  drop f, create public.f": `drop function f(int);\n${NEW_F}`,
  "MUST 0  drop public.f, create f":
    "drop function public.f(int);\ncreate function f(a text) returns int language sql as $$ select 1 $$;",
  "MUST 0  the db:fn form":
    "drop function if exists public.f(int);\ncreate function public.f(a int, b int) returns int language sql as $$ select 1 $$;",
  "MUST 0  drop restrict, then create": `drop function f(int) restrict;\n${NEW_F}`,
  "MUST 0  drop in capitals, then create": `DROP FUNCTION Public.F(int);\n${NEW_F}`,
  "MUST 0  drop routine, then create function": `drop routine f(int);\n${NEW_F}`,
  "MUST 0  drop two, both created after":
    "drop function f(int), g(int);\ncreate function f(a text) returns int language sql as $$ select 1 $$;\ncreate function g(a text) returns int language sql as $$ select 1 $$;",
  "MUST 0  a function named like cascade":
    "drop function cascade_notes(int);\ncreate function cascade_notes(a text) returns int language sql as $$ select 1 $$;",
};
let bad = 0;
for (const [name, sql] of Object.entries(cases)) {
  const file = "supabase/migrations/20261002110000_x.sql";
  const failures = checkMigrations({
    changed: [],
    added: [file],
    mainPrefixes: ["20261002100000"],
    readFile: () => `-- irreversible: x\nset lock_timeout = '5s';\n${sql}\n`,
  });
  const want = Number(name.slice(5, 6));
  const ok = failures.length === want;
  bad += ok ? 0 : 1;
  console.log(`${ok ? "ok " : "BAD"} ${String(failures.length)}  ${name.slice(8)}${failures.length > 0 ? `  | ${failures[0].split(" without")[0]}` : ""}`);
}
console.log(`cases ${String(Object.keys(cases).length)}, bad ${String(bad)}`);
```
`replay.mjs` is in the g4 close-out block, `c6-map.mjs`, `c6r-probe.mjs`, `c6r3-probe.mjs`, `c6r4-probe.mjs` and `c6r5-probe.mjs` in the c6 blocks above; `orch-cm-probe.mjs` is the orchestrator's file in the same folder.

UNPROVEN: Dependabot (`dependabot.yml` is not on `main` yet). The scan has met no real migration yet (B2 writes the first). Argument types of a dropped and a created function are not compared (now in the runbook's "does not read" list).

GOTCHAS: G-030 added; G-029 proof count updated.

## c6 · bank close-out
The review of c6 round 6 found no defect in the code, only a cost with no entry: `bun run check` once failed with `Test timed out in 5000ms.` at `tests/unit/hygiene.test.ts:543` (the type-aware lint test, default vitest limit, loaded laptop) and passed on the next two runs. Under H43 (5) this is a bank-only rejection.

GOTCHAS: G-031 added.

## c7 · steps 5b
Close-out of group g7 under ruling H42 (1) and (2), fixing the three defects of the rejected round. Commit `7dcd402` on `slice/b1b`.

What changed
- `workspace/05-plans/merge-gate.mjs` (H42 (1)): when `gh pr checks` exits non-zero with `no checks reported` on stderr, it reads `ci.yml` from `origin/main` (`git show origin/main:.github/workflows/ci.yml`, so a pull request cannot widen the list itself), takes the `paths-ignore` of the `pull_request` trigger (written there as one flow list of double-quoted strings; any other form is refused), reads `gh pr view <pr> --json changedFiles,files --jq '.changedFiles, .files[].path'` and merges only if every path matches a pattern; it prints `documents only: no check expected`. Refused: any other pull request with no check, an unreadable `ci.yml`, a pattern with a wildcard other than `**` and `*`, a file list shorter than `changedFiles` (`files` holds at most 100 paths), an empty list, an unreadable file list. Any other non-zero exit of `gh pr checks` is refused as before.
- H42 (2): `tsconfig.scripts.json` includes the script; `package.json` `lint` (and `lint:fix`) run a second ESLint pass from the repository root, `cd .. && eslint --config app/eslint.config.js --max-warnings 0 workspace/05-plans/merge-gate.mjs` (ESLint calls any file above its base path external and only warns); `format` and `format:check` pass `--config .prettierrc` and name the file; `eslint.config.js` adds the root-relative path to the `scripts/**` block and gives `prettier/prettier` the options read from `.prettierrc` for it. The first lint found 8 `restrict-template-expressions` errors in the script (numbers and `string | undefined` in template literals), fixed with `String()` and destructuring defaults.
- `tests/unit/merge-gate.test.ts`: the stub takes an options object and can fail each call; new cases for the status POST failing (nothing merged), `gh pr merge` failing (exit 1), and nine no-check cases that read the real `.github/workflows/ci.yml`. The case "refuses a pull request that has no checks" is now "refuses when the checks cannot be read" (`HTTP 502`, not the no-checks text); entry `mg-nochecks` follows it.
- `tests/mutations/B1b.json`: 18 new entries (`mg-post-fail`, `mg-merge-fail`, `mg-docs-*`, `mg-gate-*`); `hy-lint-warnings` rewritten to the new `lint` line (P-090).

Proofs (run in `app/` unless noted)

`bunx vitest run tests/unit/merge-gate.test.ts tests/unit/hygiene.test.ts`
```
 Test Files  2 passed (2)
      Tests  69 passed | 8 skipped (77)
```

`node ../scratch/replay.mjs --check` → `checked 308, bad 0` (first run: `BAD hy-lint-warnings: find occurs 0 times`, rewritten).

`node ../scratch/replay.mjs hy-lint-warnings mg-nochecks mg-post-fail mg-merge-fail mg-docs-nochecks mg-docs-every mg-docs-anchor mg-docs-root mg-docs-main mg-docs-ci-read mg-docs-wildcard mg-docs-unread mg-docs-count mg-docs-empty mg-docs-files-read`
```
RED hy-lint-warnings: exit=1 expect=true | × lint is type-aware, zero-warning and refuses the named rules 1505ms
RED mg-nochecks: exit=1 expect=true | × refuses when the checks cannot be read, and writes nothing 9ms
RED mg-post-fail: exit=1 expect=true | × refuses and merges nothing when posting the status fails 10ms
RED mg-merge-fail: exit=1 expect=true | × exits 1 when gh pr merge fails 10ms
RED mg-docs-nochecks: exit=1 expect=true | × merges a documents-only pull request, read against ci.yml on origin/main 10ms
RED mg-docs-every: exit=1 expect=true | × refuses a pull request with no check that changes app/src/start.ts 9ms
RED mg-docs-anchor: exit=1 expect=true | × refuses a pull request with no check that changes app/a.mdx 10ms
RED mg-docs-root: exit=1 expect=true | × merges a documents-only pull request, read against ci.yml on origin/main 11ms
RED mg-docs-main: exit=1 expect=true | × merges a documents-only pull request, read against ci.yml on origin/main 14ms
RED mg-docs-ci-read: exit=1 expect=true | × refuses when ci.yml cannot be read on origin/main 10ms
RED mg-docs-wildcard: exit=1 expect=true | × refuses when paths-ignore holds a wildcard the gate does not read 10ms
RED mg-docs-unread: exit=1 expect=true | × refuses when paths-ignore holds a wildcard the gate does not read 11ms
RED mg-docs-count: exit=1 expect=true | × refuses when gh lists fewer files than the pull request changes 11ms
RED mg-docs-empty: exit=1 expect=true | × refuses a pull request with no check and no changed file 11ms
RED mg-docs-files-read: exit=1 expect=true | × refuses when the changed files cannot be read 11ms
replayed 15, not red 0
```

`node ../scratch/replay.mjs mg-gate-type mg-gate-lint mg-gate-format mg-gate-format-config mg-gate-lint-prettier` (the two format entries first ran with an `expect` that also matched the echoed command line; tightened to prettier's `[warn]` line and replayed again)
```
RED mg-gate-type: exit=2 expect=true | ../workspace/05-plans/merge-gate.mjs(17,7): error TS2322: Type 'string' is not assignable to type 'number'.
RED mg-gate-lint: exit=1 expect=true | 17:1  error  Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked
RED mg-gate-lint-prettier: exit=1 expect=true | 226:26  error  Replace `"usage:·node·workspace/05-plans/merge-gate.mjs·<pr>\n"` with `⏎······"usage:·node·workspace/05-plans/merge-gate.mjs·
RED mg-gate-format: exit=1 expect=true | [warn] ../workspace/05-plans/merge-gate.mjs
RED mg-gate-format-config: exit=1 expect=true | [warn] ../workspace/05-plans/merge-gate.mjs
```

Why they are red (the diff of the red run, `node <scratchpad>/c7-why.mjs <ids>`, text below):
```
== mg-post-fail
      Tests  1 failed | 38 passed (39)
-   "code": 1,
+   "code": 0,
-     "merge-gate: posting the status failed: HTTP 403",
+     "",
+     "gh pr merge",
== mg-merge-fail
      Tests  1 failed | 38 passed (39)
-   "code": 1,
+   "code": 0,
== mg-docs-anchor
      Tests  1 failed | 38 passed (39)
-   "code": 1,
+   "code": 0,
-     "merge-gate: no checks reported and app/a.mdx is not a document",
+     "documents only: no check expected",
+     "",
+   ],
+   "writes": [
+     "gh api -X",
+     "gh pr merge",
== mg-docs-wildcard
      Tests  1 failed | 38 passed (39)
-     "merge-gate: no checks, and the paths-ignore of ci.yml is unread",
+     "merge-gate: no checks reported and launch/film/notes.txt is not a document",
```

The gate was blind before: with the rejected round's `include` and the `mg-gate-type` type error, `bun run typecheck` exits 0 (`node <scratchpad>/c7-before.mjs`):
```
mutated tsconfig.scripts.json
mutated ../workspace/05-plans/merge-gate.mjs
typecheck exit 0 with the old include and a type error in the gate
restored
```
Before the change, from `app/`: `bunx prettier --find-config-path ../workspace/05-plans/merge-gate.mjs` → `[error] Can not find configure file for "../workspace/05-plans/merge-gate.mjs".`, `bunx prettier --check ../workspace/05-plans/merge-gate.mjs` → `Code style issues found`, exit 1 (with `--config .prettierrc`: `All matched files use Prettier code style!`), `bunx eslint --max-warnings 0 ../workspace/05-plans/merge-gate.mjs` → `0:0  warning  File ignored because outside of base path`, exit 1.

Title map, `node ../scratch/g7r2-map.mjs | tail -1` → `titles 34, without an entry 2`: the two `it.each` templates (`refuses a %s check ...`, covered by `mg-bucket` and `mg-bucket-pending`; `refuses a pull request with no check that changes %s`, covered by `mg-docs-every` and `mg-docs-anchor`).

`bun run check` → exit 0; the gate lines of its output:
```
$ tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.scripts.json
$ eslint . --max-warnings 0 && cd .. && eslint --config app/eslint.config.js --max-warnings 0 workspace/05-plans/merge-gate.mjs
$ prettier --config .prettierrc --check . ../workspace/05-plans/merge-gate.mjs
All matched files use Prettier code style!
 Test Files  14 passed (14)
      Tests  346 passed | 8 skipped (354)
```
`bun run build` → exit 0 (`You can deploy this build using npx nitro deploy --prebuilt`).

CI on the pushed head, run `37033505757` (`gh run view 37033505757 --json conclusion,jobs --jq '.conclusion, (.jobs[] | [.name,.conclusion] | @tsv)'`):
```
success
check	success
build	success
merge-gate	skipped
```
and its `check` log holds the same three gate lines, so the second lint pass runs on the Linux runner too.

Probes (from the repository root, script run on `slice/b1b`, P-105)
- Code probe, PR #30: `git switch -c gate-probe origin/main~1` (`f57c9b2`), one commit to `app/src/lib/cx.ts`, `gh pr create --draft`. `node workspace/05-plans/merge-gate.mjs 30` → `mark ready first`, exit 1; after `gh pr ready 30` → `rebase first`, exit 1; `gh pr close 30 --delete-branch`.
- Documents probe, PR #31: `git switch -c gate-probe-docs origin/main`, one line added to `workspace/README.md`, not a draft. `gh pr checks 31` → `no checks reported on the 'gate-probe-docs' branch`, exit 1. `node workspace/05-plans/merge-gate.mjs 31` → `merge-gate: no checks, and ci.yml cannot be read: fatal: path '.github/workflows/ci.yml' exists on disk, but not in 'origin/main'`, exit 1; the head carries `0` statuses and the PR stayed `OPEN`, unmerged; `gh pr close 31 --delete-branch`. This proves the real stderr of gh matches `NO_CHECKS` and the gate refuses while `main` has no `ci.yml`.
- `git ls-remote --heads origin` → `refs/heads/main` and `refs/heads/slice/b1b` only.

Scratch scripts (session scratchpad, not committed; P-088)
```js
// c7-before.mjs, run from app/
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const edits = [
  { file: "tsconfig.scripts.json", find: ', "../workspace/05-plans/merge-gate.mjs"', replace: "" },
  {
    file: "../workspace/05-plans/merge-gate.mjs",
    find: 'const CI_YML = ".github/workflows/ci.yml";',
    replace: '/** @type {number} */\nconst CI_YML = ".github/workflows/ci.yml";',
  },
];
const saved = edits.map((e) => readFileSync(e.file));
try {
  for (const e of edits) {
    const text = readFileSync(e.file, "utf8");
    if (text.split(e.find).length !== 2) throw new Error(`find not once in ${e.file}`);
    writeFileSync(e.file, text.replace(e.find, () => e.replace));
    console.log(`mutated ${e.file}`);
  }
  let exit = 0;
  try { execSync("bun run typecheck", { stdio: "pipe" }); } catch (error) { exit = error.status ?? 1; }
  console.log(`typecheck exit ${exit} with the old include and a type error in the gate`);
} finally {
  edits.forEach((e, i) => writeFileSync(e.file, saved[i]));
  console.log("restored");
}
```
```js
// c7-why.mjs <id> ..., run from app/: apply a registry entry, run it, print the diff lines, restore
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const entries = JSON.parse(readFileSync("tests/mutations/B1b.json", "utf8"));
for (const id of process.argv.slice(2)) {
  const e = entries.find((entry) => entry.id === id);
  const saved = readFileSync(e.file);
  const text = saved.toString("utf8");
  if (text.split(e.find).length !== 2) throw new Error(`${id}: find not once`);
  writeFileSync(e.file, text.replace(e.find, () => e.replace));
  let out = "";
  try { out = execSync(e.run, { encoding: "utf8", stdio: "pipe" }); }
  catch (error) { out = `${error.stdout ?? ""}${error.stderr ?? ""}`; }
  finally { writeFileSync(e.file, saved); }
  const why = out.replace(/\u001b\[[0-9;]*m/g, "").split("\n")
    .filter((line) => /^\s*[-+] {2,}\S|Tests {2}/.test(line)).slice(0, 10);
  console.log(`== ${id}\n${why.join("\n")}`);
}
```

For the orchestrator
- H42 (1)'s evidence was confounded (P-120): PRs 21 and 23 had no check because `origin/main` holds no workflow; PR 23 changed `.claude/workflows/build-slice.js`, which is not a document, so under the built rule it would be refused. Until B1b merges, the gate refuses every pull request with no check (`ci.yml cannot be read`), the orchestrator's chore PRs included; after the merge, a `.claude/**` change gets a `ci` run.
- Conflict between H42 (1) and H42 (2): `ci.yml` ignores `workspace/**`, so a pull request that changes only `workspace/05-plans/merge-gate.mjs` starts no `ci` run, and the gate itself calls it documents only. Its format, lint and type gates then run only in the author's local `bun run check`, never in CI. A decision is needed (for example a `paths-ignore` that keeps this one file, which GitHub's filter allows only through `paths` with `!`, and which this reader refuses today).
- Stale plan line: B1b line 112 says "`gh pr checks <pr>` must exit 0"; P-106 (the `--json` form exits 0 whatever the buckets) and H42 (1) (no checks: exit 1 and a documents-only merge) replace it.
- The `*` to `[^/]*` mapping is not observable with `ci.yml`'s patterns (`**/*.md` reads the same with `.*`), so no test can watch it fail; it is kept because GitHub's `*` does not cross a slash.

NOT DONE (the orchestrator's): the B1b pull request merged with `node workspace/05-plans/merge-gate.mjs 22`, and the `ci` run of that merge on `main` showing `merge-gate` `success`. UNPROVEN: the documents-only merge on the real repository (it needs `ci.yml` on `main`); the post-merge `merge-gate` job's first run.

GOTCHAS: G-032 and P-120 added; P-070 and P-090 hit again (noted in the entries).
