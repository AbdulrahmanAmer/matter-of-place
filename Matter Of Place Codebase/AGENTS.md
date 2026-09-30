Architecture lives in `docs/` (start at `docs/README.md`). Rules to keep while editing:

- Pages and components read and write only through `services` (`src/services/index.ts`, catalog via `src/lib/queries.ts`); never import `src/data/*` from routes, except pricing and FAQ copy. One variable (`VITE_API_BASE_URL`) switches the site to the API.
- Form fields and enumerations come from the Zod schemas in `src/domain/contracts.ts`; the API validates with the same file.
- `src/domain/*.ts` field names equal the API JSON and, in snake_case, `docs/database/schema.sql`; change all three together.
- Loaders use `ensureQueryData`, components `Route.useLoaderData()`; dynamic routes throw `notFound()`. Every route sets `head()` via `pageHead()` in `src/lib/seo.ts`.
- Forms use `useAsyncAction`, `FormError`, `SentNotice`, `DeliveryNotice`; confirmation copy from `src/lib/form-copy.ts`. Every user action calls `track()`; add names to `AnalyticsEvent`, never free strings.
- Styling is plain CSS under `src/styles/` (tokens only, no hex in components, no utility classes). `--muted` is a surface token; text uses `--muted-foreground`. Sections set vertical padding only; `.section-wrap` owns width and side padding.
- Components: one per file; layout in `components/layout`, shared display in `components/site`, dossier-only in `components/property`.
- Content: illustrative and labelled; markets are California, Florida, New York only; prices and terms in `src/data/exposure.ts` feed both Pricing and Exposure. Business details render only when set in `src/config/site.ts` or `VITE_*`.
- Copy is calm and brief, no em dashes; titles join with " | Matter of Place".
- Never edit `src/routeTree.gen.ts`. `npm run check` must pass.
