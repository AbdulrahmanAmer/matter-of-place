# src/admin

Components and browser-side calls for the `/admin` route group: request queue, decide with templated emails, invoice, dossier editor, media, publish, asset approvals, channel status, subscriber and interest lists, and the Automation section (recipes, templates, reasons, channel and schedule settings, dry-run). Permission checks happen on the server, in the matrix of `src/server/lib/authz.ts`; the UI only hides controls (`RoleGate`). Every state change writes an audit row.

## Layout

- `ui/` the shared console: shell, navigation, `DataTable`, `Drawer`, `ConfirmDialog`, `StatusPill`, `Timeline`, `JobWatcher`, `LocalTime`, `Toast`, `adminFetch`, `AdminRouteError`. How to add a screen: `ui/README.md`.
- `nav.ts` the 27 screens and which links to draw. Written once; a later slice adds a route file, not a line here.
- `query.ts` the data contract: `adminKeys` (every key starts with `"admin"`), the defaults of those queries, `invalidateAfterWrite` and `adminRouteOptions()`.
- `<feature>/` one folder per area: `<feature>-api.ts` (typed calls through `adminFetch`), `<feature>-queries.ts` (what components import), the components, and their tests beside them.

## Rules

- Nothing here imports `src/server`, `src/db` or `src/data`, and `fetch` is called in `ui/admin-fetch.ts` only (`tests/unit/admin-boundaries.test.ts`).
- Admin actions are recorded in `audit_log`, not by `track()`.
- Styles live in `src/styles/admin/`, linked by `src/routes/admin.tsx` alone.
