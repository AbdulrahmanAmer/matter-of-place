The spec is one level up, not in this folder: `../workspace/02-tech-stack/tech-stack.md` (approved stack and the path for every kind of change), `../workspace/06-architecture/architecture.md` (modules, data model, API, recipe engine) and `../workspace/05-plans/` (one plan per build slice; measured facts in `ASSUMED.md` section E). `docs/` here is the earlier sketch: read it for intent, never build from it. Rules to keep while editing:

- Pages and components read and write only through `services` (`src/services/index.ts`, catalog via `src/lib/queries.ts`); never import `src/data/*` from routes, except `data/exposure.ts` and `data/faq.ts` (static marketing copy). One variable (`VITE_API_BASE_URL`) switches the site to the API, which is served by the same Worker under `/api/*`.
- Form fields and enumerations come from the Zod schemas in `src/domain/contracts.ts`; the API validates with the same file.
- `src/domain/*.ts` field names are the camelCase API JSON. The database shape comes only from `supabase/migrations/` (and the generated types once B2 lands); the server maps between the two. Change the domain type, the contract and the migration together. `docs/database/schema.sql` is the superseded sketch.
- Loaders use `ensureQueryData`, components `Route.useLoaderData()`; dynamic routes throw `notFound()`. Every page route sets `head()` via `pageHead()` in `src/lib/seo.ts`; redirect routes and pure `Outlet` layouts need no `head()`, and the root sets only site-wide meta.
- Forms that send data use `useAsyncAction`, `FormError`, `SentNotice`, `DeliveryNotice`; confirmation copy from `src/lib/form-copy.ts`. Navigation-only forms (site search) are exempt. Every public user action calls `track()`; add names to `AnalyticsEvent`, never free strings. Admin actions do not: they are recorded in `audit_log` (see the server section below).
- Styling is plain CSS under `src/styles/` (tokens only, no hex in components, no utility classes). The `theme-color` meta in the root route is the only hex outside `tokens.css` and must equal `--ivory`. `--muted` is a surface token; text uses `--muted-foreground`. Sections set vertical padding only; `.section-wrap` owns width and side padding.
- Components: one exported component per file. A small private helper used only by that file, or a card with its grid, may share a file. Layout in `components/layout`, shared display in `components/site`, dossier-only in `components/property`.
- Content: illustrative and labelled, for local and preview only. Production shows no illustrative property, ever; an empty collection becomes the coming-soon signup (B3b). Markets are California, Florida, New York only. Prices and terms live in `src/data/exposure.ts` and nowhere else (`/pricing` redirects to `/exposure`). Business details render only when set in `src/config/site.ts` or `VITE_*`.
- Copy is calm and brief, no em dashes; titles join with " | Matter of Place".
- Secrets never go in `VITE_*` and never in the repo. No Docker on this machine: the database is the cloud project `mop-dev`, changed only by `supabase db push` (see `../GOTCHAS.md` P-038).
- Never edit `src/routeTree.gen.ts`. `bun run check` must pass.

## Server and tests

- Route files are thin: a public API file calls only `handlePublic`; an admin API file exports only handlers built by `defineAdminRoute` (`src/server/lib/admin-route.ts`), one matrix action each, and never imports `actor`, `authz`, `csrf`, `src/db/**` or supabase-js.
- Authorization lives in the matrix (`src/server/lib/permissions/<group>.ts`, assembled by `authz.ts`); every admin service starts with `authorize(actor, "<action>")`. A matrix change regenerates `action_roles` with `bun run scripts/gen-action-roles.mjs` and edits the fixture of `tests/unit/authz.matrix.test.ts` in the same commit.
- Services take `db` as an argument and never call `getDb()` themselves. Writes go only through one SQL function (RPC) that changes the rows, audits through `write_audit` and emits its event in one transaction.
- Admin actions write `audit_log` (through `write_audit`), never `track()`.
- Throw only `AppError` with a key of `errorCodes` (`src/server/lib/error-codes.ts`); SQL raises the code as its exact message, and `fromRpcError` (`admin-errors.ts`) is the one translator of SQL and PostgREST errors.
- Log only through `logLine(level, event, fields)` with an event of `LogEvent` (`log-events.ts`); ids go in `fields`.
- Read the environment only in `src/server/lib/env.ts` or through `readVar`.
- Parse every outside response with Zod in its adapter, reading only the fields used.
- Files the Deno job runner loads import with an explicit `.ts` extension, by relative path.
- Hashes, HMACs and constant-time compares come only from `src/server/lib/crypto.ts`.
- Unit tests reach a database only through `tests/fixtures/fake-db.ts`; database tests run in `withRollback` (`tests/fixtures/db.ts`).
- A stand-in for something a later step builds carries `// STUB(<slice> step <n>): <what replaces it>` on the line above it.
