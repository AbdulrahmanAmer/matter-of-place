
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
Baselines measured on the new config and cleared by fixing, deleting or using (no allow-list, one disable only: `route-error.tsx`): lint 78 problems (19 `restrict-template-expressions`, 11 `no-unsafe-type-assertion`, 9 `require-await`, 5 `no-deprecated` (`FormEvent`), 7 `no-restricted-syntax` (Deno `.ts` extension in `src/domain`), 8 jsx-a11y, 4 `no-misused-promises`, 4 `no-base-to-string`, 2 `no-unsafe-assignment`, 2 `no-misused-spread`, 2 `no-unnecessary-condition`, 1 `consistent-type-imports`, 1 `no-console`, 1 undescribed disable); knip 1 unused file (`src/domain/index.ts`, deleted), 21 unused exports and 20 unused types (un-exported, or deleted when then unused); jscpd 1 clone of 80 tokens (`filter-bar.tsx` and `quick-filters.tsx`, now `FilterSelect`); layout baseline empty (558 files).
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
Behaviour touched while clearing the baseline: the two overlays (`inquiry-dialog.tsx`, `search-overlay.tsx`) close on a click on the backdrop (`event.target === event.currentTarget`) instead of `stopPropagation` on the panel, and the `role="dialog"` of the search overlay moved to the panel; `autoFocus` became a ref callback `focusOnMount`; `services/http/client.ts` takes a response shape (`trusted<T>()` for the contract, ADR 0002) and merges headers through `Headers`; local services return `Promise.resolve`. B3 rewrites `client.ts`.
