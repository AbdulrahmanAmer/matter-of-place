> These docs are the MVP sketch. The approved spec is `../../workspace/02-tech-stack/tech-stack.md`: read the sketch for intent, build from the spec.

# Matter of Place documentation

What a developer needs to run the frontend, and the earlier sketch of the backend it expects. The approved backend, database and deployment are specified in `../../workspace`.

| Document                                                 | What it answers                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [architecture/overview.md](architecture/overview.md)     | System context, runtime topology, request and write flows (Mermaid)                                                      |
| [architecture/frontend.md](architecture/frontend.md)     | Folder map, module boundaries, route inventory, conventions                                                              |
| [architecture/services.md](architecture/services.md)     | The API contract the frontend already speaks: endpoints, payloads, errors                                                |
| [architecture/data-model.md](architecture/data-model.md) | Domain entities and the entity-relationship diagram                                                                      |
| [architecture/caching.md](architecture/caching.md)       | Cache layers, TTLs and invalidation so the free Supabase tier is enough                                                  |
| [database/schema.sql](database/schema.sql)               | Postgres schema for Supabase: tables, enums, indexes, RLS                                                                |
| [database/schema.md](database/schema.md)                 | Table-by-table notes and how each maps to the frontend types                                                             |
| [deploy/cloudflare.md](deploy/cloudflare.md)             | Superseded stub: pointer to the approved stack, environment variable table                                               |
| [decisions/](decisions/)                                 | Architecture decision records                                                                                            |
| [brief/master-plan.md](brief/master-plan.md)             | Original brief (scope since narrowed: California, New York and Florida only, no developments, no global, no memberships) |

## Where things live

```text
src/
  config/      site settings read from VITE_* variables
  domain/      TypeScript types and Zod contracts shared with the API
  data/        illustrative content (properties, markets, stories, exposure)
  services/    the service boundary: local adapters now, HTTP adapters when VITE_API_BASE_URL is set
  lib/         formatting, catalog helpers, SEO head builders, analytics, query definitions
  hooks/       small React hooks (filters, modal, async action, view tracking)
  components/  brand, layout, site primitives, forms, filters, property pieces, search
  routes/      one file per URL; loaders read through TanStack Query
  styles/      tokens, base, layout, component and page stylesheets
docs/          this folder
public/        static files served as-is (favicon, robots, the illustrative film)
```

## Commands

```bash
bun install
bun run dev          # http://localhost:8080
bun run check        # typecheck, lint, formatting, tests
bun run build        # production build (Cloudflare target via Nitro)
```

Copy `.env.example` to `.env` to point the frontend at an API. Without `VITE_API_BASE_URL` the site runs entirely from bundled content and every form keeps its entries on the device.
