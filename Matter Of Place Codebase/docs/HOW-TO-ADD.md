# How to add anything

Every kind of change has one path. Follow it or stop and add a path; never bolt on. This table is copied from the
approved spec, `../../workspace/02-tech-stack/tech-stack.md` §5 (decision S35); the spec wins if the two ever differ.

| To add…                   | Touch, in this order                                                                                                                                                                                          | Proof                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| a public page             | `src/routes/<name>.tsx` with `head()` via `pageHead()`; a query in `src/lib/queries.ts` if it reads data; `src/styles/pages/<name>.css` imported from `styles.css`; nav in `nav-links.ts` if it belongs there | Playwright route test added; `bun run check` green                                   |
| an API route              | `src/routes/api/<name>.ts` handler → `src/server/<feature>/service.ts`; Zod input schema in `src/domain/<feature>.ts`; rate limit entry; log line with request ID                                             | Vitest for the schema and the service; Playwright hits the route                     |
| an admin action (button)  | `src/admin/<feature>/` component + server function; permission check by role in the server function, never in the UI; audit row (`who, what, when`)                                                           | Vitest: forbidden role gets 403; allowed role changes state                          |
| a table or column         | `supabase/migrations/<ts>_<name>.sql` (up only; a second migration undoes); `supabase gen types` → `src/db/types.ts`; RLS policy in the same migration                                                        | `supabase db push` to mop-dev (or `bun run db:reset`) clean; generated types compile |
| a job type                | `src/server/jobs/steps/<name>.ts` implementing `{ run(payload, ctx) }`; register in the step catalog; add to the recipe editor's choices with its parameter schema                                            | Vitest runs the step against a fixture; dry-run lists it                             |
| an email                  | `src/templates/email/<name>.tsx` (React Email); row in `email_templates` seed with subject and variables; preview in `/admin › Automation`                                                                    | Vitest renders it; a test send lands                                                 |
| an analytics event        | name added to `AnalyticsEvent`; `track()` call at the action; the API's allow-list                                                                                                                            | TypeScript refuses free strings; event row appears                                   |
| a role or permission      | `app_role` enum migration; RLS policies; server-function guard; role matrix in `../../workspace/07-admin-platform/`                                                                                           | Authorization matrix test (slice B7)                                                 |
| a social or email channel | `src/server/channels/<name>.ts` implementing `{ publish(asset, settings) }`; `channel_settings` row; Media Ops toggle                                                                                         | Vitest with the API mocked; one real test post                                       |

Rules behind the table: feature folders (`src/server/<feature>`, `src/admin/<feature>`) own their code; shared code is
imported from `src/lib` or `src/server/lib`, never copied; no component reads the database; no server function trusts
the client for identity or role; every PR's checklist ticks the path it used. `mop-builder` refuses a slice that has
no path.

Where the folders are: `src/server`, `src/db`, `src/admin`, `src/templates`, `supabase/migrations`,
`supabase/functions`, `scripts` and `tests` each carry a README that says what belongs there. GitHub Actions
workflows live at the repository root (`../../.github/workflows/`), not in this folder, because GitHub reads them
only from there.
