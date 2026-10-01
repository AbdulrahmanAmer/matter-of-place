# STANDARDS: how the builders of Matter of Place write code

Binding on every builder and every fresh reviewer of the 48-hour build (S54). Sources: the twelve-lens engineering
review (`review/standards-raw.json`, `review/<slice>.md`), ASSUMED section H, `app/AGENTS.md`, `app/eslint.config.js`,
`app/tsconfig.json` and the Files sections of B1b to B17, H1 and L1. Order of authority when two texts disagree:
ASSUMED section H, then this file, then the slice plan, then AGENTS.md. A rule here that names a gate a later slice
creates binds by review until that step lands, and by the machine after it.

Rule ids (R01 to R60) and checklist ids (C01 to C25) are stable. A reviewer cites them: "R27 broken at
`src/server/jobs/steps/post-x.ts:41`".

---

## 1. Folder map

One row per kind of file. A file that fits no row stops the builder: it asks the orchestrator, it does not create a
new folder, a new top-level file or a new naming pattern. `scripts/check-layout.mjs` (gate G07) holds the same table
as code and fails on any tracked or new file outside it.

### 1.1 Repository top level (`E:/Matter Of Place`, the git root)

| Path | What belongs | Never here |
|---|---|---|
| `app/` | The product: site, `/api/*`, `/admin`, job runner, migrations, tests, scripts (section 1.3). | Planning documents, launch media. |
| `workspace/` | Maps and plans: `00-MAP-OF-WHAT-WE-HAVE.md`, `README.md`, `01-site-index/`, `02-tech-stack/`, `03-diagrams/` (Mermaid source, `render.mjs`, rendered `img/*.png` and `img/*.svg`), `04-completion-map/`, `05-plans/` (plans, `ASSUMED.md`, `PLAN.md`, `RUNBOOK.md`, this file, `check-plans.mjs`, `ready.mjs`, `readiness-table.mjs`, `merge-gate.mjs`, `trace.json`, `review/`, `logs/`), `06-architecture/`, `07-admin-platform/`, `08-visual-pass/` (scripts, reports, `pairs/*.png`), `08-creative/` (B9: `BRIEF.md`, `DIRECTION.md`, `options/<template>/*.png`), `audits/` (B14: routine, report template, `tools/*.mjs`, `tools/limits.json`, `tools/fixtures/`, `monitoring/`, dated reports). | App code, raw screenshots outside the image folders named here. |
| `launch/` | Launch film, partner presentation and deck, `engine/`, `shared/`, `tools/` (motion gate), `reel/` (B12), briefs and `MOTION-BIBLE.md`. | Frame sequences (`frames/`, P-016), worktree snapshots (`.site-main/`, P-023). |
| `.github/` | `workflows/*.yml` and `workflows/README.md` (G-012: only here, never under `app/`), `dependabot.yml`, `pull_request_template.md`, `CODEOWNERS` (B14). | Anything else. |
| `.claude/` | `POSITION.md`, `settings.json`, `agents/`, `hooks/`, `skills/`, `workflows/`. | `settings.local.json`. |
| Root files | `CLAUDE.md`, `GOTCHAS.md`, `PROJECT-STATE.md`, `README.md`, `.gitattributes`, `.gitignore`, `.mcp.json`. | Any other file. |
| `creds/` | Private keys (`backup-recipient.key`), git-ignored, escrowed offline. | Never committed. |

### 1.2 Never committed, anywhere in the repository

| Kind | Patterns (gate G07 fails on a tracked or new unignored match) |
|---|---|
| Build output and caches | `node_modules/`, `.output/`, `dist/`, `.vinxi/`, `.nitro/`, `.tanstack/`, `.wrangler/`, `*.tsbuildinfo`, `supabase/.temp/`, `supabase/.branches/` |
| Logs | `*.log`, `npm-debug.log*` |
| Test and tool output | `test-results/`, `playwright-report/`, `coverage/`, `.lighthouseci/`, `out/` (B5 shots), `.tmp/` (B12) |
| Screenshots, renders, media | `*.png`, `*.jpg`, `*.jpeg`, `*.webp`, `*.gif`, `*.heic`, `*.mp4`, `*.mov`, `*.wav`, `*.mp3` outside `app/src/assets/`, `app/public/`, `app/tests/fixtures/`, `workspace/03-diagrams/img/`, `workspace/08-visual-pass/pairs/`, `workspace/08-creative/options/` and `launch/` (and never under any `frames/`) |
| Scratch | `scratch/`, `*.tmp`, `*.bak`, `*.orig`, `*.rej`, `launch/.site-main/` |
| Secrets | `.env`, `.env.*` except `app/.env.example`, `.dev.vars`, `creds/`, `*.key`, `*.p12`, `*.pfx`, `*secrets*.txt`, any `*.pem` except `app/backup-recipient.pem` (public certificate, B1b step 8) |
| Database dumps | `*.dump`, `*.p7m`, `*.sql.gz` |
| OS and editor | `.DS_Store`, `Thumbs.db`, `desktop.ini`, `.idea/`, `.vscode/` except `.vscode/extensions.json` |

### 1.3 Inside `app/`

Paths below are relative to `app/`. Naming: `kebab` is lower-case words joined by `-`; `Pascal` is a React component
name. Tests next to code are allowed only where a row says so. A `README.md` that describes its own folder is allowed
in any folder of the map.

| Folder | What belongs | Not here | Naming |
|---|---|---|---|
| app root | `package.json`, `bun.lock`, `bunfig.toml`, `tsconfig.json`, `tsconfig.scripts.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `eslint.config.js`, `knip.json`, `.jscpd.json`, `lighthouserc.json`, `lighthouserc.local.json`, `budget.json`, `wrangler.toml`, `backup-recipient.pem`, `.env.example`, `.gitignore`, `.prettierignore`, `.prettierrc`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `roadmap.md` | Any other root file; `.github/` (G-012); `.dev.vars` (ignored) | as listed |
| `src/` (files) | `router.tsx`, `start.ts`, `env.d.ts`, `styles.css`, `routeTree.gen.ts` (generated, never edited, G-001) | Anything else at this level | as listed |
| `src/routes/` | TanStack file routes only. `__root.tsx` (bare document); `_site.tsx` (public layout, B3) and every public page as `_site.<path>.tsx` (B3 step 1b; a plan that still names a page without `_site.` means the `_site.` file, B3); `admin.tsx` and admin screens `admin/<screen>.tsx`; resource routes `<name>[.]<ext>.ts` (`sitemap[.]xml.ts`, `robots[.]txt.ts`, `feed[.]xml.ts`, `[.]well-known.security[.]txt.ts`); API route files `api/public/<name>.ts`, `api/admin/<name>.ts`, `api/hooks/<name>.ts`, `api/consent.ts` (B17) | Logic: a route file holds the route definition, `head()`, the loader call and the component wiring; an API route file holds one wrapper line (R11) | TanStack dot names, `$param`, `[.]` for a literal dot |
| `src/components/<area>/` | Public-site React components. Areas: `brand`, `filters`, `forms` (with `forms/submit/`), `layout`, `property`, `search`, `site`. Component tests `*.test.tsx` beside the component (component project, B4) | Admin UI; data fetching; hex colours | kebab `.tsx`; one exported component per file (AGENTS.md) |
| `src/admin/<feature>/` | Admin interface by feature: `assets`, `audit`, `automation`, `channels`, `dashboard`, `inquiries`, `invoices`, `jobs`, `markets`, `media`, `newsletter`, `properties`, `reports`, `requests`, `settings`, `stories`, `team`, and `ui/` (shared `Dialog.tsx`, `AdminRouteError.tsx`, `admin-fetch.ts`). Top-level files `nav.ts`, `query.ts`, `query.test.ts`, `README.md`. Tests beside the code (`*.test.ts`, `*.test.tsx`) | Server code; a second Dialog; anything a public route imports | Pascal `.tsx` for components; kebab `.ts` for modules: `<feature>-queries.ts`, `<feature>-api.ts`, `use-<name>.ts` |
| `src/server/<domain>/` | Backend code by domain, server only: `assets`, `audit`, `automation`, `catalog`, `channels`, `client-errors`, `concierge`, `dashboard`, `email`, `events`, `hooks`, `inquiries`, `jobs` (with `jobs/steps/` one file per step type, `jobs/system/` and `jobs/system/health/`), `kpi`, `markets`, `media`, `newsletter`, `nitro`, `omnikom`, `payments` (with `payments/adapters/`), `previews`, `properties`, `public`, `reports`, `search`, `seo`, `settings`, `stories`, `subjects`, `submissions`, `subscribers`, `team`. One file `src/server/scheduled.ts` (B8b) | Browser code; a helper used by two domains (it goes to `src/server/lib/`) | kebab `.ts`; the domain entry is `service.ts`; a step file is the step type in kebab (`send_email` is `steps/send-email.ts`) |
| `src/server/lib/` | Cross-domain server modules: `db.ts`, `env.ts`, `runtime-env.ts`, `log.ts`, `log-events.ts`, `crypto.ts`, `sentry.ts`, `pipeline.ts`, `admin-route.ts`, `headers.ts`, `errors.ts`, `error-codes.ts`, `admin-errors.ts`, `authz.ts`, `permissions/<group>.ts`, `actor.ts`, `session.ts` and the other files the plans name | Feature logic | kebab `.ts` |
| `src/domain/` | Shared contracts used by browser and server: Zod schemas (`contracts.ts`), camelCase types, transition tables (`workflow.ts`), enums, `market-time.ts`. Admin-only contracts are `admin-<feature>.ts` | Database access; React; anything that reads the environment | kebab `.ts` |
| `src/services/` | The browser-side data boundary: `index.ts`, `types.ts`, `http/` (live adapter), `local/` (illustrative adapter, local and preview only) | Server code | kebab `.ts` |
| `src/lib/` | Browser-safe shared helpers: `seo.ts`, `queries.ts`, `format.ts`, `strings.ts`, `form-copy.ts`, `analytics.ts`, `consent.ts` and the others the plans name; TanStack server functions as `<name>.functions.ts` | Server-only code (it goes to `src/server/lib/`) | kebab `.ts` |
| `src/hooks/` | React hooks shared by public components | Admin hooks (they live in their feature folder) | `use-<name>.ts` |
| `src/config/` | `site.ts`, `cookies.ts` | Secrets | kebab `.ts` |
| `src/data/` | Illustrative content for local and preview (`properties.ts`, `stories.ts`, `markets.ts`) and static marketing copy (`exposure.ts`, `faq.ts`) | Anything production reads except `exposure.ts` and `faq.ts` (G-005) | kebab `.ts` |
| `src/db/` | `types.ts` (generated by `bun run gen:types`, never edited), `index.ts`, `README.md` | Hand-written queries | as listed |
| `src/styles/` | Plain CSS: `tokens.css` (the only home of colour values), `base.css`, `motion.css`, `print.css`, `layout/`, `components/`, `pages/`, `admin/` (`index.css` and one file per admin feature) | Hex outside `tokens.css`; utility classes | kebab `.css` |
| `src/templates/` | Render-job templates, not pages: `email/` (React Email, with `email/blocks/`), `social/` (with `social/fixtures/`), `theme.gen.ts` (generated by `scripts/gen-theme.ts`, B5), `README.md` | Page components | `email/`: kebab `.tsx`; `social/`: Pascal `.tsx` (B9 names) |
| `src/assets/` | Images imported by the site (also read by `launch/`, P-039) | Screenshots; anything not imported | kebab, existing names kept |
| `supabase/migrations/` | `<14-digit version>_<snake_name>.sql`, `README.md` | Edits to a file already on `origin/main` (R16) | `20261001090000_extensions_enums.sql` |
| `supabase/sql/functions/` | One file per SQL function, the single source of its body (R19) | Anything else | `<function_name>.sql` |
| `supabase/functions/job-runner/` | `index.ts`, `deno.json`, `deno.lock` | A second function without a plan | as listed |
| `supabase/templates/` | Auth email HTML (`magic-link.html`, `invite.html`) | | kebab `.html` |
| `supabase/` (files) | `config.toml`, `seed.sql`, `seed.prod.sql` | | as listed |
| `tests/unit/` | Vitest unit tests (Node), at the top of the folder or in sub-folders by area as the plans name them: `assets`, `audit`, `automation` (with `automation/fixtures/`), `channels`, `email`, `jobs`, `kpi`, `lib`, `newsletter`, `omnikom`, `payments`, `reel`, `reports`, `scripts`, `security` | Tests that touch a database or the network | `<subject>.test.ts`, `.test.tsx` |
| `tests/db/` | Database tests (`db` project), `global-setup.ts`, `rls-matrix.ts`, `schema-manifest.ts` | Unit tests | `<subject>.db.test.ts` |
| `tests/api/` | HTTP tests of the Worker against a database, `env.ts` | | `<subject>.api.test.ts` |
| `tests/e2e/` | Playwright specs, `global-setup.ts`, `axe-baseline.json`, `fixtures/`, `helpers/` | Screenshots and reports (ignored output) | `<subject>.spec.ts` |
| `tests/deno/` | Deno smoke of the job runner (`steps.smoke.ts`) | | `<subject>.smoke.ts` |
| `tests/fixtures/` | Shared builders, fakes and small media: `fake-db.ts`, `db.ts`, `db-counter.ts`, `factories.ts`, `dataset.ts`, `clock.ts`, `builders.ts`, `service.ts`, `dev-lock.ts`, `tiny.jpg`, `photo*.jpg`, provider responses under `<provider>/` (`graph/`, `x/`, `linkedin/`) | Large media (over 1 MB) | kebab |
| `tests/setup/` | Vitest setup files (`dom.ts`, `hermetic.ts`) | | kebab `.ts` |
| `tests/mutations/` | Watched-fail registry, one file per slice (R49) | | `<slice>.json` |
| `tests/` (files) | `README.md`, `WATCHED-FAIL.md` | | as listed |
| `scripts/` | Deterministic command-line work: one script per job, plus `lib/` (shared script helpers), `fixtures/`, `audit/` (B14), `harden/` (H1, with `fixtures/`), `launch/` (L1, with `fixtures/`). `omnikom-mock.wrangler.toml` (B15) | Code the Worker imports; scratch scripts | kebab; `.ts` run with bun, `.mjs` only where R02 allows; `.sh` only where a plan names it |
| `docs/` | `runbooks/<name>.md` (every runbook, one folder), `README.md`, `HOW-TO-ADD.md`, the Lovable sketch folders kept for intent (`architecture/`, `brief/`, `database/`, `decisions/`, `deploy/`), and the plan-named files `coming-soon.md`, `omnikom-webhook.md`, `security.md`, `verify-example.mjs` | Specs (they live in `workspace/`) | kebab `.md` |
| `public/` | Static files served as-is: `_headers`, `robots.txt`, favicons, `sw.js`, `offline.html`, `fonts/*.woff2`, `media/`, `og/static/<key>.png`, the IndexNow key file | Source images (they go to `src/assets/`) | kebab |

---

## 2. Rules

Each rule: the rule, why, and how it is enforced. "Gate Gnn" points to section 3. "HANDOFF" means no plan step
creates the check yet; the orchestrator adds the step named in section 3.

### 2.1 TypeScript and lint

**R01.** Lint is type-aware and zero-warning: `eslint . --max-warnings 0` with `strictTypeChecked` and `projectService`, `only-throw-error` allowing only TanStack's `Redirect` and `NotFoundError`, `switch-exhaustiveness-check` (`considerDefaultExhaustiveForUnions: false`), `consistent-type-imports`, `no-unsafe-type-assertion`, and `reportUnusedDisableDirectives: 'error'`.
Why: un-awaited promises, unvalidated `any` and missed union members are the Worker bug classes; a new union value must fail the build until every consumer handles it.
Enforced by: G02 (B1b step 2b); G10 asserts the rule names (B1b step 5).

**R02.** The tsconfig strict flags (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedSideEffectImports`, and `verbatimModuleSyntax` from B1b) are never turned off; scripts are type-checked through `tsconfig.scripts.json`; new scripts are `.ts` run with `bun run`, and `.mjs` is used only where a plan froze the name or the runner has no bun, with JSDoc types.
Why: scripts sign callbacks, seed production and gate launch; an untyped path fails in Actions instead of in `check`.
Enforced by: G01 (B1b step 2b); flag assertions in G10 are HANDOFF HO-3.

**R03.** Every `eslint-disable` carries a reason after `--`; `@ts-expect-error` carries a description of at least 10 characters; `@ts-ignore` is never used.
Why: a silent disable is how a gate is defeated.
Enforced by: G02, `@eslint-community/eslint-comments/require-description` and `ban-ts-comment` (B1b step 2b).

**R04.** No unused file, export or dependency, and no copied block of 70 tokens or more across `src`, `scripts` and `supabase/functions`; an export kept for a later slice carries `/** @public */` and a STUB marker.
Why: three lanes cannot see each other's helpers until merge; duplicates and orphans appear there.
Enforced by: G03 `knip`, G04 `jscpd` (B1b step 2b).

**R05.** Every production stub carries `// STUB(<slice>[ step n]|post-v1): <what replaces it>` on the line above it; a stub whose slice is closed fails.
Why: a stub that ships compiles and passes tests while silently sending nothing.
Enforced by: G05 `scripts/stubs.ts` (B1b step 2b); L1 preflight allows only `post-v1` (G30).

**R06.** Imports follow the layers (value imports; `import type` is exempt): `src/server`, `src/domain` and `supabase/functions` never import `src/data`, `src/components`, `src/admin`, `src/routes` or `src/services`; browser code (`src/components`, `src/admin`, `src/routes/**/*.tsx`, `src/hooks`, `src/lib` except TanStack server functions `*.functions.ts`, `src/services`) never imports `src/server` or `src/db`; only `src/services/local/` imports the illustrative files of `src/data`, and routes import `src/data` only for `exposure.ts` and `faq.ts`; a shared helper lives in `src/lib` or `src/server/lib` and is imported, never copied.
Why: server code in a client chunk leaks secrets; data in a route hard-wires local mode (G-005).
Enforced by: G09 import resolution (HANDOFF HO-6), G16 bundle check (B3 step 12); review for `src/server/lib` importing a feature folder.

**R07.** Every file loaded by the Deno job runner imports and re-exports with an explicit `.ts` extension, only by relative path, `@/server/` or `@/domain/`, and never imports `cloudflare:workers`, `node:*`, `env.ts`, `wait-until.ts` or browser globals.
Why: Deno 2 refuses extensionless imports; the job runner fails at deploy, not at check (CS-01).
Enforced by: G02 block (h) (B1b step 2b); G15 `deno check` (B3 step 3b, B8 step 5).

### 2.2 Server and API

**R08.** Server code logs only through `logLine(level, event, fields)` from `src/server/lib/log.ts`, with `event` a member of `LogEvent` (`src/server/lib/log-events.ts`) and ids in `fields`, never in the event string; no `console` call outside `log.ts` and `scripts/`.
Why: one JSON shape is filterable in Workers Logs, and `log.ts` is where email-shaped strings are scrubbed (CS-08).
Enforced by: G02 `no-console` (B1b step 2b); `tests/unit/log.test.ts` (B1b step 3).

**R09.** Throw only `AppError` with a key of `errorCodes` (`src/server/lib/error-codes.ts`); SQL raises the code as its exact message; `fromRpcError` is the only translator from SQL or PostgREST errors to HTTP; a dependency outage answers 503 with `Retry-After`; every non-2xx body is `{ error: { code, message, issues?, requestId } }` and every response carries `x-request-id`.
Why: matching on message text turned real codes into 500s (API-03); a caller needs the request id to report a fault.
Enforced by: `only-throw-error` (G02); `tests/unit/error-codes.test.ts` (B3 steps 1 and 2, B7 step 1); `pipeline.test.ts` and `smoke.mjs` (B1b steps 3 and 6); `scripts/api-smoke.mjs` (B3).

**R10.** No swallowed error: every `catch` rethrows, returns a typed outcome, or calls `logLine` or `captureException`; no empty catch and no `.catch(() => {})`.
Why: a swallowed failure in a job or webhook is a lost email or post with no alert.
Enforced by: `no-empty` in `js.configs.recommended` (G02, B1b step 2b) and review (C06).

**R11.** Route files are thin. A public API file calls only `handlePublic`. An admin API file exports only handlers built by `defineAdminRoute({ method, action, input, output, auth, bodyLimitBytes, handler })` from `src/server/lib/admin-route.ts` (B7, API-02), each with exactly one action (a plan line that still says "an `adminRoutes` row run by `handleAdmin` in `src/server/admin/`" means this wrapper; there is no `src/server/admin/` folder). Route files never import `actor`, `authz`, `csrf`, `src/db/**` or `@supabase/supabase-js`.
Why: a hand-wired admin route that forgets one line ships a write with no authorization or CSRF check (API-02).
Enforced by: `tests/unit/routes-parity.test.ts` (B3 steps 1 and 3), `tests/unit/admin-routes-parity.test.ts` and `tests/unit/admin-authz-sweep.test.ts` (B7 step 1); the import ban for every route file in G09 (HANDOFF HO-6).

**R12.** Each authorization flag (`roles`, `humanOnly`, `recentAuth`) lives only in its matrix entry in `src/server/lib/permissions/<group>.ts`; services never call `requireRecentAuth` or check roles; an action an agent can reach that changes outbound content, public visibility or a system clock is `humanOnly` or counted by `assert_agent_daily_cap` and announced through `notify_admin` (SEC-11, ruling H23).
Why: one matrix is the only thing a test can prove complete.
Enforced by: `tests/unit/authz.matrix.test.ts` (B7 step 1), `tests/db/actor.db.test.ts` (B7 step 1), the agent cap tests (B7 step 6); review (C14).

**R13.** Every anonymous or bearer-key route declares its limits (at least one memory and one database limit); every form-backed anonymous write verifies Turnstile, the staff sign-in link included; session-authenticated writes check `X-MOP-CSRF` and refuse a foreign `Origin`, bearer requests skip both.
Why: free-tier quotas and the 100-a-day Resend allowance are exhausted by one unthrottled route (API-04, SEC-12).
Enforced by: `routes-parity.test.ts` (B3), `admin-routes-parity.test.ts` (B7 step 1), `tests/unit/csrf.test.ts` (B7 step 2), `tests/unit/security/turnstile-coverage.test.ts` (H1 step 2).

**R14.** Environment values are read only in `src/server/lib/env.ts` or through `readVar` (`src/server/lib/runtime-env.ts`); no other module under `src/server` reads `process.env` or `Deno.env`; secrets never go in `VITE_*` or the repository.
Why: `VITE_*` ships to the browser (G-006); one reader is one place to audit.
Enforced by: G02 `no-restricted-properties` (HANDOFF HO-2); G-006 grep (B1b step 10); `secret-scan` hook.

**R15.** A warm public read costs zero database queries: public routes read through `state.ts` and the cache only, never a table directly, and a public server render depends only on the path and the catalog version (no search params, cookies, request headers, `Date.now()` or browser locale; search params apply after hydration).
Why: the caching contract (S52, architecture 13); a render that reads a cookie is stored for every visitor.
Enforced by: `tests/unit/readpath.test.ts` (B3 step 3), `tests/api/cache-calls.api.test.ts` (B4), the byte-identical HTML case (B17 step 4).

### 2.3 Database and migrations

**R16.** Every migration starts with `-- down: <how>` or `-- irreversible: <reason>`, then `set lock_timeout = '5s';`; a file on `origin/main` is never edited, renamed or deleted; a new file's 14-digit version is greater than the highest on `origin/main`; a migration lands in its own small PR before the code that needs it.
Why: three lanes create out-of-order timestamps, and an edited applied file drifts silently (DO-05, E2E-06).
Enforced by: `tests/db/migration-headers.test.ts` (B2 step 3); G11 `migration-order` (B1b step 5); `scripts/db-push.mjs` checksum guard (B2 step 1b).

**R17.** Destructive DDL (drop table or column, rename, column type change, a new NOT NULL column without a default) appears only in a contract migration whose header carries `-- contract-of: <14-digit version>` of the expand migration already on `origin/main`; dropping a function or trigger stays allowed.
Why: production migrates before the Worker deploys and a failed smoke rolls back only the Worker (DB-08).
Enforced by: `tests/db/migration-headers.test.ts` (B2 step 3); G11 must accept the same header (HANDOFF HO-4: B1b names it `-- contract:`).

**R18.** Only `main` reaches `mop-dev`: migrations go there only through `bun run db:push` from `main` (in phase 1 no lane pushes an unmerged migration); a branch proves its schema in the CI `db` job on an ephemeral stack; nothing starts Docker on the laptop (S50, ruling H1).
Why: a shared mutable schema breaks unrelated PRs and lanes (DB-01, T-01).
Enforced by: `scripts/db-push.mjs` (B2 step 1b); G10 (no `group: mop-dev` or `DEV_SUPABASE_PROJECT_REF` in `ci.yml`, B1b step 5); G13 (B4 step 8).

**R19.** Every SQL function body lives in exactly one file, `supabase/sql/functions/<name>.sql`; a migration that changes a function is generated from that file with `bun run db:fn <name>`, never copied by hand from an earlier migration.
Why: function bodies re-copied across lanes revert each other's fixes (DB-13).
Enforced by: `tests/db/function-source.db.test.ts` (B2 step 3).

**R20.** Every `public` table has RLS enabled; every function sets `search_path = ''` and grants execute only to `service_role` apart from the `authenticatedFunctions` allow-list; `anon` holds no privilege; `authenticated` holds exactly the grants in `tests/db/rls-matrix.ts`; every view is created with `security_invoker = true`.
Why: one missing grant check exposes a table through PostgREST.
Enforced by: `tests/db/rls.db.test.ts` (B2 step 9, H1 step 3); the view case is HANDOFF HO-5.

**R21.** Every admin write function audits through `write_audit`; `write_audit` refuses an actor whose stored `actor_kind` differs, who is disabled, who lacks a role for the action, or who is an agent on a human-only action; it never stores a value of a column listed in `pii_columns`, and every personal-data column has a `pii_columns` row.
Why: the database must enforce the human-only gate and CCPA deletion (DB-03, DB-04).
Enforced by: `tests/db/actor.db.test.ts` (B7 step 1), `tests/db/audit-pii.db.test.ts` (B3 step 2, B7 step 1), `schema.db.test.ts -t pii_columns` (B2 step 4).

**R22.** Every state column is an enum or a check constraint and changes only through its owning function, which takes the aggregate root row `for update` before any read it decides on and raises `wrong_state`; the allowed transitions are declared once in `src/domain/workflow.ts` (or the slice's domain file) and compared with the SQL guard; a create-once rule is backed by a unique constraint or partial unique index, never by read-then-insert.
Why: activation and create-property double up under concurrency without a lock or unique index (DL-02).
Enforced by: `tests/unit/state-machine.test.ts` (B4 step 4), the workflow parity case (B2 step 7), `tests/db/integrity.db.test.ts` (B2 step 3); review (C13).

**R23.** Every table in `versionedTables` has `version int not null default 1` bumped by trigger; every save function on those tables takes `p_expected_version` and raises SQLSTATE 40001 `version_conflict`; columns only the system writes do not bump the version.
Why: two editors (or an editor and a render) must never overwrite each other silently, and renders must not cause false 409s (DB-16).
Enforced by: the `version_conflict` cases (B2 step 7), `use-autosave.test.ts` and the editor cases (B7 step 7).

**R24.** Column types are fixed: time is `timestamptz`; money is `numeric(12,2)` with a currency check; ids are `uuid default gen_random_uuid()` or `bigint generated always as identity`; no `timestamp`, `real`, `double precision`, `money` or `serial`; every foreign key states `on delete cascade`, `set null` or `restrict` and has an index whose leading column is the key column.
Why: float money, zone-less time and unindexed keys are the defects nobody notices until a report or a delete is wrong.
Enforced by: HANDOFF HO-5 (catalog cases in `tests/db/schema.db.test.ts`, B2 step 4).

**R25.** Every table that grows (per tick, job, wait, event or visit, extension tables included) has a `retention_policies` row or is listed as kept in `tests/db/schema-manifest.ts`; the runner deletes pgmq messages and never archives them; raw `analytics_events` keep 90 days and aggregates 13 months (ruling H16).
Why: the free database is 500 MB (P-009); cron history alone grows 200 to 350 MB a year (PERF-02).
Enforced by: `tests/db/retention.db.test.ts` (B8 step 8), `schema-manifest.ts` (B2 step 4).

### 2.4 Jobs and automation

**R26.** Only `src/server/jobs/claim.ts` calls `claim_job`, `finish_job`, `fail_job` and `requeue_job`; every state change after a claim is an SQL function fenced by the claim token in `jobs.locked_by`; callbacks are matched on `(job_id, claim)`.
Why: a stale worker or a replayed callback must change nothing (JOB-02).
Enforced by: the wrong-claim cases of `tests/db/jobs.db.test.ts` (B8 step 2), the `stale_claim` case of `tests/unit/jobs/render-hook.test.ts` (B8 step 7); the call-site rule is HANDOFF HO-6.

**R27.** Every entry in `src/server/automation/step-specs.ts` declares `timeoutMs` and `maxAttempts`; every type that calls an outside provider has `maxAttempts >= 10` and stays retryable through a 60-minute outage; the runner bounds each step with `AbortSignal.timeout(spec.timeoutMs)` and every outside `fetch` of a step passes `signal: ctx.signal`.
Why: jobs went dead about 8 minutes into an ordinary provider incident (DL-10, E2E-03).
Enforced by: `tests/unit/automation/step-specs.test.ts` (B8b step 2), `tests/unit/jobs/backoff.test.ts` (B8 step 3) and `tests/unit/jobs/runner.test.ts` (B8 step 4); the `signal` selector in G02 (HANDOFF HO-2).

**R28.** Every outside side effect (send, post, broadcast, webhook, dispatch) records a provider-side dedupe handle before the call (Idempotency-Key, delivery id, container id, media id or URN, broadcast id); recovery after a crash matches on that handle, never on text; when the handle cannot be resolved the outcome is `outcome_unknown` and a human decides, never an automatic resend; each such step has a test titled `<type> runs twice without a second outside effect`.
Why: X rewrites captions, so text matching double-posts (INT-01); a crash between the call and `finish_job` is normal.
Enforced by: `Idempotency-Key` cases (B5 step 4), `outcome_unknown` cases (B10 steps 6 and 9); the per-step title check is HANDOFF HO-7; review (C12).

**R29.** Steps and the planner read time only from `ctx.now` or a `now` argument: no argument-less `new Date()` and no `Date.now()` in `src/server/jobs/steps/**`, `src/server/automation/plan.ts`, `src/server/automation/cron.ts` or `src/domain/**`; business dates use an explicit IANA zone.
Why: a step that reads the wall clock cannot be tested at a boundary and drifts from SQL `now()` (T-08).
Enforced by: G02 `no-restricted-syntax` (HANDOFF HO-2).

**R30.** A pipeline is data: recipes are rows built from the fixed step catalog and edited in `/admin › Automation`; code never hard-codes a pipeline (the one exception is market opening inside `publish_property`, ruling H24); event, step and table names come from architecture 3.6 and 5; step params schemas change only by adding optional fields with defaults, and every spec's defaults parse.
Why: the admin portal is the operating system (CLAUDE.md); a renamed param breaks every stored recipe.
Enforced by: `step-specs.test.ts` (B8b step 2, "every spec's defaults parse"); `check-plans.mjs` (P-031); review (C15).

**R31.** A step with an outside effect re-checks its domain preconditions when it runs (property still public, subscriber still consenting, payment still in the expected state) and never relies on a cancel issued at the moment of change; content a human approved is never rewritten by a job (a change to approved creative is revision n+1).
Why: a job queued before an unpublish or an unsubscribe would otherwise act on stale state.
Enforced by: review (C12); the approved-content guard by B9's asset tests.

### 2.5 Integrations

**R32.** Server code calls `fetch` only from its provider's adapter file (`src/server/lib/db.ts`, `sentry.ts`, `turnstile.ts`, `r2.ts`; `src/server/email/resend-client.ts`; `src/server/channels/meta.ts`, `meta-token.ts`, `meta-metrics.ts`, `x.ts`, `linkedin.ts`, `youtube.ts`, `oauth-tokens.ts`, `resend.ts`; `src/server/assets/captions.ts`; `src/server/omnikom/client.ts`; `src/server/jobs/dispatch.ts`; `src/server/jobs/system/health/providers.ts`; a new adapter is added to the list by the step that creates it), and every such call passes an init object with a `signal`; database calls go only through `getDb()`'s wrapped fetch in `db.ts`, which counts every request and aborts a read RPC after 2 seconds (B3 invariant 16).
Why: one client per provider is one place for timeouts, error tables and dedupe; a call with no timeout hangs a request until the platform kills it.
Enforced by: G02 `no-restricted-globals` and the `fetch` argument selector (HANDOFF HO-2); the 2 second timeout case of `tests/unit/state.test.ts` (B3 step 3).

**R33.** Every provider response an adapter reads is parsed with a Zod schema in that adapter (passthrough, only the fields read); no cast from `any`; recorded fixtures live in `tests/fixtures/<provider>/` and carry `source` and `recorded_at`.
Why: an unvalidated `res.json()` becomes a wrong row when the provider changes shape.
Enforced by: `no-unsafe-*` and `no-unsafe-type-assertion` (G02, B1b step 2b); review (C05).

**R34.** Each adapter classifies errors through an exported error table (Resend by error name, Graph codes 4, 17, 32 and 613, `Retry-After`, `x-rate-limit-reset`); a quota or plan-limit answer maps to `retry_at` at the provider's own reset time, never a fixed guess.
Why: one HTTP status covers several errors with different remedies (INT-11).
Enforced by: `tests/unit/email/resend-errors.test.ts` (B5 step 4), the `meta-errors.ts` and `x-errors.ts` cases (B10 step 4).

**R35.** Real outside side effects (email to non-staff, social posts) happen only when `liveSideEffects(channel)` is true.
Why: dev and production share one Resend account and its quota (INT-02, E2E-04).
Enforced by: the `liveSideEffects` tests (B3 step 1, B5 step 4, B10 step 5).

**R36.** Inbound webhooks verify the signature over the raw bytes with `timingSafeEqual` from `src/server/lib/crypto.ts`, refuse timestamps more than 300 s old, apply a replay once, and leave a failed effect re-appliable on the provider's retry; Web Crypto is called only in `crypto.ts`.
Why: eight hand-rolled signature sites meant eight chances to compare with `===` (CS-04).
Enforced by: `tests/unit/crypto.test.ts` (B1b step 3b), `crypto.subtle` assertion in G10 (B1b step 5), the hook tests (B3 `hooks/resend`, B8 step 7 `render-hook.test.ts`).

**R37.** Personal data never leaves its table: catalog event payloads carry only ids, enums, slugs and sealed tokens (a step fetches personal data by id); Sentry events and log lines carry no email, name, phone, message, IP, cookie or query string.
Why: events, logs and Sentry are kept longer and seen by more people than the rows.
Enforced by: `tests/unit/sentry.test.ts` scrub cases (B1b step 4), `tests/unit/log.test.ts` (B1b step 3); review for payloads (C16).

**R38.** Mail recipients are selected only through the consent-aware functions (`newsletter_audience_members`, the market-open selection, `resolveRecipient`), never by an ad hoc query on `subscribers`; every email template has a quota class (`transactional`, `confirm` or `bulk`) and bulk and confirm sends stop below their reserve of the daily cap.
Why: a bulk send must never starve invoices, confirmations and alerts (INT-03, PERF-11).
Enforced by: `tests/unit/email/cap-classes.test.ts` (B5 step 4); the `subscribers` call-site rule is HANDOFF HO-6.

### 2.6 Admin and site UI

**R39.** Pages and components read and write only through `src/services/index.ts` and `src/lib/queries.ts`; a live build carries no module from `src/data`, `src/admin` or `src/domain/admin-*` in any chunk a public route can reach; production never shows an illustrative property (an empty collection is the coming-soon signup).
Why: the service boundary is what switches the site to the API (AGENTS.md); seed data in the live bundle is both weight and a leak (FE-03).
Enforced by: G16 `scripts/bundle-check.mjs` (B3 step 12), `scripts/assert-coming-soon.mjs` and `illustrative-labels.test.tsx` (B3b), G-005 grep.

**R40.** Public-only side effects (Header, Footer, ConsentNotice, Ga4Loader, web vitals, service-worker registration, the public stylesheet) mount only in `src/routes/_site.tsx`, never in `__root.tsx`.
Why: `/admin` must not load GA4, the cookie notice or the site chrome (FE-02).
Enforced by: `tests/e2e/admin-signin.spec.ts` (B7 step 2).

**R41.** Admin data goes through `<feature>-queries.ts` with keys from `adminKeys`; every write is a `useMutation` that invalidates its feature, the dashboard and the entity timeline; components never import `*-api.ts`; every modal and drawer is the shared `Dialog` on native `<dialog>`, never a hand-set `role="dialog"`; editor actions that send `expected_version` first await the autosave `flush()`.
Why: an unspecified data layer gave stale screens and autosave conflicts that publish without the last edits (FE-01, FE-06).
Enforced by: `src/admin/query.test.ts` (B7 step 3), `src/admin/properties/use-autosave.test.ts` (B7 step 7); the `*-api` import ban in G09 (HANDOFF HO-6) and the `role="dialog"` selector in G02 (HANDOFF HO-2).

**R42.** Styling is tokens only: colour, spacing and z-index values come from `var(--token)` defined in `src/styles/tokens.css`; no hex outside `tokens.css`, the generated `src/templates/theme.gen.ts` and the `theme-color` meta in `__root.tsx` (which equals `--ivory`); no utility classes; sections set vertical padding only and `.section-wrap` owns width; admin selectors use the `a-` prefix.
Why: ADR 0003 and the brand palette; a hex in a component drifts from the palette (G-007).
Enforced by: the hex scan of HANDOFF HO-6; review (C18).

**R43.** Code that renders in the browser formats numbers, money and dates only through `src/lib/format.ts` and `src/domain/market-time.ts`, always with an explicit `timeZone`.
Why: a server render in UTC and a hydration in the visitor's zone disagree, which breaks hydration and the cache.
Enforced by: G02 selectors on `toLocale*String` and `new Intl.*` outside those files and `src/server/**` (HANDOFF HO-2).

**R44.** No injection sink: no raw HTML outside `src/lib/seo.ts` (`dangerouslySetInnerHTML`, `.innerHTML =` and head-script `children` built from data go only through the script serializer SEC-03 names, `serializeJsonForScript`; everything else reaches the DOM as React text), and no template literal or string concatenation passed to supabase-js `.or(`, `.filter(` or `.textSearch(` (free text goes through an RPC parameter).
Why: JSON-LD serialized with plain `JSON.stringify` into a script sink is an injection, and the CSP hash list would allow it (SEC-03); a string-built PostgREST filter is the same mistake on the server.
Enforced by: G02 selectors (HANDOFF HO-2); SEC-03's hostile-fixture test (B13, B17, H1).

**R45.** Every page route sets `head()` through `pageHead()` with a bare title; forms that send data use `useAsyncAction`, `FormError`, `SentNotice` and `DeliveryNotice` with copy from `src/lib/form-copy.ts`; every public user action calls `track()` with an `AnalyticsEvent` name; admin actions write `audit_log` and never call `track()`.
Why: the conventions of AGENTS.md; free-string analytics names are unqueryable.
Enforced by: `tests/unit/routes-covered.test.ts` and `seo.test.ts` (B4 step 4), `tsc` on the `AnalyticsEvent` union; review.

**R46.** Copy is calm, brief and specific: no em dash anywhere under `src/`, no hyperbole, no guarantee of leads, buyers or sales, markets California, New York and Florida only, price never equals merit; business details render only when set in `src/config/site.ts` or settings.
Why: the brand guardrails gate every deliverable (CLAUDE.md, the three tests).
Enforced by: the em dash scan of HANDOFF HO-6; review (C19).

**R47.** axe (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`) reports zero serious or critical violations on every public route outside the baseline and on every admin screen; Warm Grey on Ivory is for large text only (G-013).
Why: WCAG 2.2 AA is the bar for a public publication.
Enforced by: `tests/e2e/sweep.spec.ts` (B4 step 5), the admin a11y fixture (B7), `scripts/contrast.mjs` (B17 step 5).

### 2.7 Tests

**R48.** Every test asserts (`requireAssertions`); no `.only` or `.skip` reaches `main`; a conditional skip uses `it.skipIf` with a printed reason; `vitest/expect-expect`, `no-disabled-tests`, `no-focused-tests`, `no-conditional-expect`, `valid-expect` and `no-identical-title` are errors.
Why: a test with no assertion satisfies "vitest run passes" and proves nothing.
Enforced by: `vitest.config.ts` and G02 (B1b step 2b).

**R49.** Every new or changed test is watched failing for the right reason, and every test file has at least one entry in `tests/mutations/<slice>.json`; a SQL mutation is a `kind: "sql"` entry run inside `withRollback`, never an edit of a migration.
Why: a green test that cannot go red measures nothing (global rule 2).
Enforced by: `tests/unit/mutation-registry.test.ts` and `scripts/watchfail.mjs` (B4 step 2).

**R50.** Unit tests reach a database only through `tests/fixtures/fake-db.ts` (which throws on any unregistered RPC or table), make no network call and see no credentials; test and dev-script processes never see production or account-wide credentials.
Why: a hand-rolled loose mock asserts its own shape; a leaked production token in a test shell is one typo from damage (SEC-08).
Enforced by: `fake-db.ts` (B3 step 1); `scripts/lib/guard-env.mjs` (B2 step 1b); the throwing `fetch` and env scrub of HANDOFF HO-8.

**R51.** Database, API and e2e tests, `factories.ts` and `dataset.ts` take time from the database (`dbNow`) or an explicit `p_now`; `FIXED_NOW` and `at()` are for pure unit tests only.
Why: a fixed date compared with SQL `now()` passes today and fails next month (T-08).
Enforced by: `tests/unit/time-model.test.ts` (B4 step 3).

**R52.** In CI, database and live e2e tests run against a database built for that job from the branch's own migrations, never `mop-dev`; every test creates the rows it changes and depends on no row another test changed.
Why: shared mutable rows make tests order-dependent across lanes (T-01).
Enforced by: G10 (B1b step 5); G13 `db` job (B4 step 8).

**R53.** Tests assert observable behaviour (HTTP status, row state, rendered DOM, outside calls on a fake provider), not internal call shapes, except the sanctioned database call counter; every invariant in the plan's Contract section is named by a test title.
Why: implementation-shaped tests pass while the behaviour is wrong and break on every refactor.
Enforced by: review (C10).

### 2.8 Security

**R54.** Every workflow declares top-level `permissions: {}` (or minimal) and grants per job; every non-local `uses:` is pinned to a 40-character SHA with a version comment; every `actions/checkout` sets `persist-credentials: false`; no job a pull request can reach references `SUPABASE_ACCESS_TOKEN`, `secrets.PROD_*` or `secrets.BACKUP_*`; no attacker-controllable context (`github.event.pull_request.title`, `body`, `head.ref`, `github.head_ref`, `inputs.`) appears inside a `run:` line; installs are `bun install --frozen-lockfile`, `bunfig.toml` keeps `minimumReleaseAge` of at least 86400, and the job runner commits `deno.lock`.
Why: there is no branch protection on this plan (ruling H5), so the workflows are the protection (SEC-01, SEC-13, DO-02).
Enforced by: G10 `tests/unit/hygiene.test.ts` (B1b step 5; `deno.lock` once B8 step 5 lands).

### 2.9 Delivery and CI

**R55.** `bun run check` and `bun run build` pass in `app/` before every commit; a PR merges only through `node workspace/05-plans/merge-gate.mjs <pr>`; production deploys only a SHA whose `ci` run on `main` passed, ends with `smoke.mjs` and rolls the Worker back automatically when it fails.
Why: a merge that bypassed a red check must not deploy (DO-04, T-03, DO-09).
Enforced by: G23 merge gate (B1b step 5b), G24 deploy guard (B1b step 7), G22 smoke and rollback (B1b steps 6, 7 and 7b).

**R56.** Every file sits in its row of the folder map (section 1) and nothing of section 1.2 is tracked; workflows live only in the root `.github/workflows/` with `working-directory: app`; files are LF without BOM.
Why: the operator's instruction: everything in its own folder, nothing unnecessary on GitHub; nested `.github` never runs (G-012); CRLF makes whole-file diffs (G-008).
Enforced by: G07 `scripts/check-layout.mjs` (HANDOFF HO-1); G10 (B1b step 5); `.gitattributes` and the `postwrite-sanity` hook.

**R57.** Every change follows its extension path of tech-stack section 5 (public page, API route, admin action, table or column, job type, email, analytics event, role or permission, social or email channel, new public read); the PR ticks the row and pastes its proof command; the migration and the generated types travel in the same PR.
Why: one path per kind of change, never a bolt-on (S35).
Enforced by: the PR template labels asserted by G10 (B1b step 5); review (C21).

**R58.** Every job of every workflow sets `timeout-minutes`; every workflow sets a `concurrency` group; the heavy pull request jobs (`db`, `e2e`, `preview`; T-04 merged `e2e-live` into `e2e`) skip drafts and obey `vars.CI_HEAVY != 'off'`; `bun run build` runs in exactly one `ci.yml` job.
Why: 2,000 Actions minutes a month are shared by CI, deploys, renders and backups (DO-08, T-12, ruling H6).
Enforced by: G10 (B1b step 5, B4 step 8).

### 2.10 Cost limits

**R59.** Free tier first: no binding for Queues, Browser Rendering, Images, Durable Objects or KV, no paid plan feature and no paid API tier without a settled decision in PROJECT-STATE (G-011, P-009); every free-tier resource a change consumes has a line in `workspace/audits/tools/limits.json` with a `source`.
Why: each of those is a monthly bill the operator did not approve.
Enforced by: G10 `wrangler.toml` assertion (B1b step 5); `tests/unit/audit/gauges.test.ts` (B14 step 5); review (C22).

**R60.** Budgets hold at maximum input: first-load JavaScript of each public route at most 150 KB gzip; each public HTML document at most 60 KB; the catalog snapshot at most 1.5 MB on the 100-property fixture; no Worker request makes more than 35 outbound subrequests (Supabase RPC, Storage signing and every other `fetch` counted together, B3's ceiling), and a render callback makes at most 5 database and Storage calls whatever the payload (B8 invariant, JOB-03); any loop over a collection whose size a user controls runs in a job.
Why: the free Workers plan stops at 50 subrequests and 10 ms CPU per request (P-009, PERF-07, JOB-03).
Enforced by: G16 bundle check (B3 step 12), `lighthouserc.json` and `perf-budget.test.ts` (B4 step 10), `tests/db/snapshot-budget.db.test.ts` (B2 step 12), `tests/unit/subrequest-budget.test.ts` (B3 step 8, B6 step 3, B7 step 7), the 40-item callback case of `tests/unit/jobs/render-hook.test.ts` (B8 step 7) and of B9's `steps.test.ts` with `countingDb`.

---

## 3. Mechanical gates

Every check a machine runs. Commands run in `app/` unless they start with `workspace/`. "Owner" is the slice and step
that creates the gate; HANDOFF rows are not in any plan yet and are proposed to the step named.

| Id | Gate | Command | Fails when | Owner |
|---|---|---|---|---|
| G01 | Typecheck | `bun run typecheck` (`tsc -p tsconfig.json && tsc -p tsconfig.scripts.json`) | Any type error in `src`, `tests` or `scripts` | B1b step 2b |
| G02 | Lint | `bun run lint` (`eslint . --max-warnings 0`) | Any error or warning: type-aware rules (R01), disable reasons (R03), `no-console` (R08), Deno import rule (R07), vitest rules (R48), jsx-a11y; and the boundary blocks of HO-2 (R14, R27, R29, R32, R41, R43, R44) | B1b step 2b; boundary blocks HANDOFF HO-2 to B1b step 2b |
| G03 | Dead code | `bun run knip` | An unused file, export or dependency | B1b step 2b |
| G04 | Copy detection | `bun run jscpd` | A copied block of 70 tokens or more | B1b step 2b |
| G05 | Stub ledger | `bun run stubs` (`bun run scripts/stubs.ts`) | A `STUB(<slice>)` marker whose slice is `closed` in PLAN.md | B1b step 2b |
| G06 | Format | `bun run format:check` | A file prettier would change | exists |
| G07 | Layout | `bun run layout` (`node scripts/check-layout.mjs`), first step of `bun run check` | A tracked or new unignored file under `app/` outside the folder map, or a file of section 1.2 anywhere in the repository; prints `layout: <path>: <reason>` | HANDOFF HO-1 to B1b step 2b |
| G08 | Unit and component tests | `bun run test` | Any failing test, or a test with no assertion | B2 step 1, B4 step 1 |
| G09 | Boundaries | `bunx vitest run tests/unit/boundaries.test.ts` (inside G08) | A value import across the layers of R06, a route file importing `actor`, `authz`, `csrf`, `src/db` or `@supabase/supabase-js` (R11), an admin `.tsx` importing a `*-api.ts` (R41); a hex colour outside the allowed files (R42); an em dash under `src/` (R46); a lifecycle RPC outside `claim.ts` (R26); `from("subscribers")` outside the allowed files (R38); `exchangeCodeForSession` anywhere in `src` | HANDOFF HO-6 to B1b step 2b |
| G10 | Repository hygiene | `bunx vitest run tests/unit/hygiene.test.ts` (inside G08) | Workflow, toolchain, Dependabot, `wrangler.toml`, PR-template, lint-config and database-rule assertions of B1b invariants 1 to 16; heavy-job `if:` lines | B1b step 5 (B4 step 8 adds a case); tsconfig flags HANDOFF HO-3 |
| G11 | Migration order | `bun run migrations:check` (`node scripts/check-migrations.mjs`), step `migration-order` of the CI `check` job | An applied migration edited, renamed or deleted; a new version not above `origin/main`; destructive DDL without the contract header | B1b step 5; header name HANDOFF HO-4 |
| G12 | Migration headers | `bunx vitest run --project db tests/db/migration-headers.test.ts` | Missing `-- down:` or `-- irreversible:`, missing `set lock_timeout`, destructive DDL without `-- contract-of:` | B2 step 3 |
| G13 | Database tests | `bun run test:db`; CI job `db` on the ephemeral stack (apply from zero, re-apply check, type drift `git diff --exit-code src/db/types.ts`) | Any `tests/db/*.db.test.ts` failure, including `function-source`, `rls`, `schema`, `integrity`, `retention`, `actor`, `audit-pii`, `jobs`, `snapshot-budget` | B2 steps 1 to 12; CI job B4 step 8 (ruling H1) |
| G14 | Database push guard | `bun run db:push` (`scripts/db-push.mjs`) | A branch migration pushed to `mop-dev`, a remote-only or out-of-order version, a changed checksum | B2 step 1b |
| G15 | Deno check | The `deno` step of the CI `check` job (`deno check` of `scripts/deno-portable.ts`, then the job runner; a step, not a job, T-12) | A Deno-loaded file that Deno refuses | B3 step 3b; B8 step 5 |
| G16 | Bundle check | `node scripts/bundle-check.mjs`, step `bundle-check` of the CI `build` job | A public route over 150 KB gzip, or a public chunk holding `src/admin`, `src/domain/admin-` or `src/data` | B3 step 12 |
| G17 | Route contracts | `bunx vitest run tests/unit/routes-parity.test.ts tests/unit/admin-routes-parity.test.ts tests/unit/admin-authz-sweep.test.ts tests/unit/authz.matrix.test.ts` (inside G08) | A route file without its registry row, a row without a file, an action outside the matrix, a route importing the db | B3 steps 1 and 3; B7 step 1 |
| G18 | Watched-fail registry | `bunx vitest run tests/unit/mutation-registry.test.ts` (inside G08); replay `node scripts/watchfail.mjs --registry tests/mutations --changed origin/main` | A test file with no mutation entry; a mutation that stays green | B4 step 2 |
| G19 | Time model | `bunx vitest run tests/unit/time-model.test.ts` (inside G08) | A db, api or e2e file importing `FIXED_NOW` or `at` | B4 step 3 |
| G20 | Read path and cost | `bunx vitest run tests/unit/readpath.test.ts tests/unit/subrequest-budget.test.ts` (inside G08) | A public module reading a table outside `state.ts`; a request over 35 subrequests at maximum input | B3 steps 3 and 8 |
| G21 | E2E and accessibility | CI job `e2e` (live mode, T-04: the sweep, forms, live-forms, hydration, edge and admin specs, then B13's `seo` steps) | A route sweep, form, redirect or axe failure | B4 steps 5, 7 and 9 |
| G22 | Smoke and rollback | `node scripts/smoke.mjs <url>` at the end of every deploy job | A missing header, `x-mop-cache: stale`, a non-200 on the smoke list; the job then rolls the Worker back | B1b steps 6, 7 and 7b |
| G23 | Merge gate | `node workspace/05-plans/merge-gate.mjs <pr>`; CI job `merge-gate` (`node scripts/merge-gate.mjs`) | A PR head without current `origin/main`, a failed or pending check, a merge without the `merge-gate` status | B1b step 5b |
| G24 | Deploy guard | `node scripts/deploy-guard.mjs <sha>`, first step of `production` and `dev` | A newer code commit already on `main` (prints `superseded`) | B1b step 7 |
| G25 | Performance budgets | `bun run lhci` with `lighthouserc.json`; `bunx vitest run tests/unit/perf-budget.test.ts` | A document over 60 KB, a score or resource budget missed | B4 step 10 |
| G26 | Plans traceability | `node workspace/05-plans/check-plans.mjs` | A plan item without its files, a catalog step without a code file, an invented name | exists (P-031, P-043) |
| G27 | Turnstile coverage | `bunx vitest run tests/unit/security/turnstile-coverage.test.ts` | A form-backed anonymous write without Turnstile | H1 step 2 |
| G28 | Runbook lint | `node scripts/harden/runbook-lint.mjs` (in `audit-deps.yml`) | A runbook without its required headings or naming a missing command | H1 step 4 |
| G29 | Site essentials | `node scripts/contrast.mjs`, `node scripts/csp-proof.mjs`, the byte-identical HTML case | A token pair under 4.5:1; an inline script outside the CSP hashes; a public render that changes with cookies, headers or query | B17 steps 1, 4 and 5 |
| G30 | Launch preflight | `node scripts/launch/preflight.mjs` | A non-`post-v1` STUB marker, dev and production secrets with equal digests | L1 |
| G31 | Write hooks | `postwrite-sanity` (global) and `.claude/hooks/gotcha-guard.mjs` on every Edit and Write | NUL, CRLF, BOM, a `node --check` or `JSON.parse` failure; a `block` gotcha path | exists |

### 3.1 Handoffs (checks no plan step creates yet)

- **HO-1** `scripts/check-layout.mjs` and `tests/unit/check-layout.test.ts`, the `layout` script first in `check`, and the `.gitignore` lines of section 1.2: B1b step 2b.
- **HO-2** The boundary blocks of `eslint.config.js` (environment, `fetch`, time, formatting, injection sinks, `role="dialog"`): B1b step 2b.
- **HO-3** `hygiene.test.ts` asserts every tsconfig strict flag of R02: B1b step 5.
- **HO-4** `scripts/check-migrations.mjs` accepts `-- contract-of: <14-digit version>` (R17), the header B2's test requires: B1b Files and step 5.
- **HO-5** Catalog cases for R24 and the view case of R20 in `tests/db/schema.db.test.ts`: B2 step 4.
- **HO-6** `tests/unit/boundaries.test.ts` (R06, R11, R26, R38, R41, R42, R46, and `exchangeCodeForSession`): B1b step 2b.
- **HO-7** `sideEffect` on every step spec and the `runs twice without a second outside effect` title check (R28): B8b step 2.
- **HO-8** `tests/setup/hermetic.ts` in the `unit` and `component` projects (R50): B4 step 1.
- **HO-9** B13's two public components are named `ArchiveLink.tsx` and `PropertyGone.tsx`; the folder map row for `src/components/` is kebab: rename them `archive-link.tsx` and `property-gone.tsx` in B13.

---

## 4. Reviewer checklist

Run for every group of work, against the diff, after the proofs reproduce. A "no" is a defect: cite the line id.

- C01 The diff does only what the plan's steps for this group say: no extra feature, option, flag, endpoint or refactor.
- C02 Every file the steps name exists, with the plan's exact path and name; every name (function, table, event, step, error code, log event) matches the plan and the catalogs.
- C03 Every new or moved file sits in its folder-map row and follows that row's naming (section 1); nothing generated, scratch, logged or screenshotted is committed.
- C04 No dead code, commented-out code, leftover TODO, debug output or unused parameter kept "for later" (a later-slice export has `@public` and a STUB marker).
- C05 No speculative abstraction: no interface, option, layer or generic with one implementation the plan does not require; no second copy of a helper that already exists in `src/lib`, `src/server/lib`, `scripts/lib` or `tests/fixtures` (grep the verb).
- C06 No swallowed error: every catch rethrows, returns a typed outcome, or logs through `logLine` or Sentry; no catch-all that turns a failure into success.
- C07 Comments state why (an invariant, a ruling id, a platform limit), never what the next line does.
- C08 Every new test was watched failing for the right reason, is in `tests/mutations/<slice>.json`, and would fail if the feature were removed.
- C09 Every proof command in the builder's log was re-run here and printed what the plan says.
- C10 Tests assert behaviour (status, row, DOM, outside call), not internal call shapes; each Contract invariant touched is named by a test title.
- C11 Every new state-changing function names its race partner and the test that runs both; every invariant over several rows names the lock or unique index that serialises it; every new list or job query names the index that serves it.
- C12 Every new outside effect answers: if the process dies after the call and before `finish_job`, what does the second run do, and which test proves it; it re-checks its preconditions when it runs.
- C13 Every SQL `::date` on a `timestamptz` has `at time zone`; every new migration is expand-then-contract safe for the Worker that is still live.
- C14 Every new admin action has its matrix entry with the right roles, `humanOnly` or the agent cap, and `recentAuth` where the plan says.
- C15 No pipeline is hard-coded: a new automation behaviour is a recipe row and a catalog step, with a dry-run output pasted for one sample payload when the seed or `criticalSteps` change.
- C16 No personal data in an event payload, log line, Sentry event, error message, URL or audit row.
- C17 Every screen that loads or sends data renders loading, empty, error (with the request id) and success; every destructive or external action goes through the confirm `Dialog` with its button disabled while pending; drag has Move up and Move down buttons; single-key shortcuts only open a dialog.
- C18 Styling uses tokens only, no hex, no utility classes, no gradient, glow, gold or SaaS card; fixed UI judged from a viewport shot, not a full-page one (P-021).
- C19 Copy is calm, brief and specific: no em dash, no hyperbole, no guarantee, markets CA, NY and FL only, no illustrative property in production.
- C20 No secret, token or production value in the diff, a `VITE_*` name, a fixture or a log line; no Docker; no assumption that R2 is on.
- C21 The PR ticks its extension path (tech-stack section 5) and pastes the proof; the migration and the generated types are in the same PR.
- C22 A new public route, beacon, job type, heavy step or workflow states its unit cost (Worker requests, Supabase calls, egress, Actions minutes, emails) and the P-009 line it draws on.
- C23 A change to a deploy, migration or clock path updates `incident.md`, `rollback.md` or `restore.md` and ran the changed command once on `mop-dev` with its output pasted.
- C24 Every cross-slice call names who retries it, where a failure becomes visible to a person, and within what time; no alert path depends on the component it watches.
- C25 Something that cost more than a few minutes was added to `GOTCHAS.md` in the same turn, with its proof command.
