
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
