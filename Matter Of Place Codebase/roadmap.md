# Roadmap

## Done: production-grade frontend handoff

- [x] Service boundary with typed contracts and `local` / `http` adapters (catalog, inquiries, submissions, newsletter, search, concierge, analytics)
- [x] Route loaders read through TanStack Query; every page rewritten on the new component set
- [x] Read-only `/admin` prototype, placeholders and unused UI kit removed; dependencies trimmed to what is imported
- [x] Stylesheet split into tokens, base, layout, components, pages, motion; dead rules removed
- [x] Docs: architecture with Mermaid diagrams, API contract, data model, caching, Postgres schema, Cloudflare deployment, decision records
- [x] README, `.env.example`, `AGENTS.md`; typecheck, lint and formatting clean; every page checked on desktop and phone

## Ready

- [ ] Backend: implement the API in `docs/architecture/services.md` as a Cloudflare Worker; run `docs/database/schema.sql` on Supabase
- [ ] Seed script (`scripts/seed.ts`) that inserts `src/data/*` through the service role and rewrites image URLs
- [ ] Add `?market=&region=` filters to the list endpoints when the catalog passes a few hundred records
- [ ] Per-property photography once real listings arrive (galleries share fourteen illustrative images today)
- [ ] Films for further properties (`video` field on each property; poster and hosted MP4)
- [ ] Second language table (RTL already supported by `localeDirection`)
- [ ] Editorial admin surface behind Supabase Auth once Studio is no longer enough

## Waiting on the owner

- Instagram URL (`VITE_INSTAGRAM_URL`; the footer link renders once set)
- Public contact email and telephone (`siteConfig.contact`)
- Registered company details for the Legal page (`siteConfig.legal`)
