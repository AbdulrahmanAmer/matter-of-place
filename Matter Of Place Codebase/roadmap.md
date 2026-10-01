# Roadmap

The plan lives in `../workspace/05-plans/PLAN.md`; the current stage and decisions are in `../PROJECT-STATE.md`.

## Done: frontend handoff

- [x] Service boundary with typed contracts and `local` / `http` adapters (catalog, inquiries, submissions, newsletter, search, concierge, analytics)
- [x] Route loaders read through TanStack Query; every page rewritten on the new component set
- [x] Placeholders and unused UI kit removed; dependencies trimmed to what is imported
- [x] Stylesheet split into tokens, base, layout, components, pages, motion; dead rules removed
- [x] Docs: architecture with Mermaid diagrams, API contract, data model, caching, Postgres schema, Cloudflare deployment, decision records (now the earlier sketch)
- [x] README, `.env.example`, `AGENTS.md`; typecheck, lint and formatting clean; every page checked on desktop and phone
