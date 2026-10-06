# src/admin/ui

The shared parts of the admin console (B7 step 3). A screen is built from these and adds none of its own chrome.

## Add a screen

1. **Route.** `src/routes/admin/<screen>.tsx`, flat dotted names (`requests.$id.tsx`). Spread `...adminRouteOptions()` from `src/admin/query.ts` into `createFileRoute`: it gives the route `AdminRouteError` (drawn inside the shell, with the request id) and a skeleton after 300 ms. Set `head()` through `pageHead()` with `noindex: true`. A dynamic route throws `notFound()`.
2. **Navigation.** Nothing to edit. `src/admin/nav.ts` already lists all 27 screens by route id; the link appears when the route file exists and, for entries with `requiresAction`, when `me.actions` holds that action.
3. **Data.** `src/admin/<feature>/<feature>-api.ts` calls `adminFetch(path, schema, init)` and no other file under `src/admin` calls the network: the schema is a Zod schema and the answer is parsed with it. `<feature>-queries.ts` holds the queries under keys from `adminKeys` and one `useMutation` per write whose `onSettled` calls `invalidateAfterWrite(queryClient, adminKeys.<feature>.all(), adminKeys.<feature>.timeline(id))`. Components import the queries file, never the api file.
4. **Layout.** `DataTable` for a list (filters and cursor in the address through `useUrlFilters`), `Drawer` for details beside it, `ConfirmDialog` for every outward or destructive action, `JobWatcher` for the jobs an action started, `Timeline` and `DiffView` for history, `Field` and `Tabs` for editors, `RoleGate` to hide a control the actor may not use (the server is still the check), `useToast` for a result. Time goes through `LocalTime`.
5. **Styles.** One file `src/styles/admin/<screen>.css`, added to `src/styles/admin/index.css`. Tokens only, selectors start with `admin-`, every `transition` and `animation` inside the `prefers-reduced-motion: no-preference` block of `ui.css` or the screen's own copy of it (`tests/unit/admin-motion.test.ts` fails otherwise).
6. **Tests.** Beside the code, and a registry entry for each in `tests/mutations/B7.json`.

## What each part does

- `AdminShell` returns the chrome (`.admin-shell`: top bar and navigation) and the main column side by side, so a print rule that hides `[data-print="hide"]` drops the chrome and keeps the page (B6's plan puts that rule in `invoices.css`; nothing in `src/styles/admin` has it yet). `src/routes/admin.tsx` puts both in `.admin-frame`. The shell shows "Service unavailable, retrying" after a 503 from `adminFetch`.
- `TopBar` shows the wordmark, the environment (named on `preview` and `local`, nothing on `production`), a search that opens `/admin/requests?search=<text>`, and the signed-in roles with an Agent pill for an agent key. `GET /api/admin/me` carries no display name, so the roles stand where the name would.
- `adminFetch(path, schema, init)` sends `X-MOP-CSRF` from the `mop_csrf` cookie on `POST`, `PUT`, `PATCH` and `DELETE`. A 401 `session_expired` or `reauth_required` empties the `["admin"]` queries and goes to `/admin/sign-in?next=<path>`; a 403 `csrf` calls `me` once and repeats the request once; a 503 raises the banner. An error answer throws `AdminApiError` (`status`, `code`, `requestId`); a lost connection throws the browser's `TypeError` and an answer that does not match the schema throws `ZodError`. `uploadSigned(url, file)` is the browser's `PUT` to a Storage signed upload URL.
- `Dialog` is the one modal, on the native `<dialog>`: `Drawer` and `ConfirmDialog` are its two placements. No component sets `role="dialog"` (lint refuses it).
- `use-hotkeys.ts`: `j` and `k` move, `Enter` opens, `a`, `d` and `p` are bound by the screen. Off while a field has focus, inside a dialog, and for Enter on a button or link.
- `data-print="hide"` is on the shell, the top bar, the navigation, the toolbar and pager of `DataTable`, the toast area and the banner.
