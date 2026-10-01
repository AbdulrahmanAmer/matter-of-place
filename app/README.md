# Matter of Place

A selective property publication for remarkable places across California, Florida and New York. An Omnikom company.

This repository is the complete frontend: every screen, the content model, the write contracts and the service boundary the backend will implement. It runs on its own from bundled illustrative content, and switches to a live API with one environment variable.

The approved spec lives one level up in `../workspace/`: `02-tech-stack/tech-stack.md`, `06-architecture/architecture.md` and the build slices in `05-plans/`. Build from those; the `docs/` folder here is the earlier sketch.

## Stack

- React 19, TanStack Start (SSR) and TanStack Router, TanStack Query for reads
- TypeScript in strict mode, Zod for the write contracts shared with the API
- Plain CSS with design tokens (no utility framework)
- Vite 8 (plain config), built for Cloudflare Workers through Nitro
- Vitest for unit tests

## Getting started

```bash
bun install
bun run dev            # http://localhost:8080
```

Optional: point the site at an API.

```bash
cp .env.example .env  # set VITE_API_BASE_URL
```

Without `VITE_API_BASE_URL` the site serves the content in `src/data/`, and every form keeps its entries on the device with a visible notice. With it, catalog reads, forms, search, concierge and analytics go to the API described in `docs/architecture/services.md`.

## Scripts

| Command                                   | Purpose                                 |
| ----------------------------------------- | --------------------------------------- |
| `bun run dev`                             | development server                      |
| `bun run build`                           | production build into `.output/`        |
| `bun run preview`                         | serve the production build              |
| `bun run typecheck`                       | TypeScript, no emit                     |
| `bun run lint` / `bun run lint:fix`       | ESLint (with Prettier as a rule)        |
| `bun run format` / `bun run format:check` | Prettier                                |
| `bun run test`                            | Vitest unit tests (`tests/unit`)        |
| `bun run check`                           | typecheck, lint, format check and tests |

## Project layout

```text
src/config      site settings from VITE_* variables
src/domain      types and Zod contracts shared with the API
src/data        illustrative content (also the database seed)
src/services    service boundary: local adapters, HTTP adapters
src/lib         formatting, catalog helpers, SEO, analytics, queries
src/hooks       filters, modal, async action, view tracking, scroll
src/components  brand, layout, site, forms, filters, property, search
src/routes      one file per URL
src/styles      tokens, base, layout, components, pages, motion
tests           vitest unit tests (playwright later)
docs            architecture, API contract, database schema, deployment, decisions
```

Full map and conventions: [docs/architecture/frontend.md](docs/architecture/frontend.md). How every kind of change is added: [docs/HOW-TO-ADD.md](docs/HOW-TO-ADD.md).

## Sketch documentation (intent only)

Start at [docs/README.md](docs/README.md). These pages are the MVP sketch; the approved spec is in `../workspace/`. Diagrams are Mermaid and render on GitHub.

- System, read and write flows: `docs/architecture/overview.md`
- API contract the frontend already speaks: `docs/architecture/services.md`
- Data model and ER diagram: `docs/architecture/data-model.md`
- Cache layers for the free Supabase tier: `docs/architecture/caching.md`

## Content

Every property, story, photograph and price on the site is illustrative and labelled as such. Contact details, registered entity and social links render only when set in `src/config/site.ts` or the environment; nothing is invented.

## Licence

Proprietary. All rights reserved by Matter of Place and Omnikom.
