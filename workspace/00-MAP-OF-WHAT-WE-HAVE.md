# Map of what we have — Matter of Place, 2026-09-30

Everything below was read or measured this session. Nothing is assumed.

## 1. The company (from docs/brief/master-plan.md and recalibration.md)
- A selective real-estate media and distribution platform. Not a brokerage, portal, lead-gen shop, ad agency or SaaS.
- Sells attention, presentation, editorial context, distribution: **we curate it, we frame it, we publish it, we distribute it.**
- Markets: California, New York, Florida only. Existing residential inventory only. Editorial gate before any payment.
- Products: The Feature $295 · The Reach $695 (recommended) · The Campaign $1,495 · Five Features $1,250.
  Programmatic media separate, from $250, 15% management, $100 minimum.
- Internal growth target: 60+ properties/month; illustrative mix 25 Features + 20 Reach + 15 Campaign ≈ $43.7k/month.
- Editorial roles: Chief Editorial Officer, Managing Editor, Visual Editor, contributors, media ops, commercial.
- Omnikom sits underneath (tech, MARY concierge, CRM, attribution, routing, paid infrastructure) and stays discreet.
- Flywheel: exceptional property → selected → edited → published → agent amplifies → we distribute → new audience →
  more submissions → editorial pool improves → more selective → audience quality grows → distribution more valuable.

## 2. The website as built (Lovable MVP, verified locally)
| Fact | Value |
|---|---|
| Stack | React 19, TanStack Start 1.168 (SSR) + Router 1.170, TanStack Query 5, Zod 3, plain CSS tokens, Vite 8.1.5, Nitro → Cloudflare Worker |
| Template | `@lovable.dev/vite-tanstack-config` (bundles Tailwind as a peer; no stylesheet uses it, per ADR 0003) |
| Checks | `bun run typecheck` exit 0 · `bun run lint` clean · `bun run build` exit 0, emits `.output/server/wrangler.json` |
| Routes | 20 URLs incl. 3 redirects and `/sitemap.xml` (see 01-site-index/pages-and-wording.md) |
| Content | 16 illustrative properties (8 CA, 4 NY, 4 FL), 3 markets / 12 regions, 6 stories, 4 products, FAQ; 31 images, 1 video |
| Forms | newsletter, contact, inquiry dialog (7 intents), 5-step submit wizard with photo metadata |
| Services | one boundary (`services/`), `local` adapter live today; `http` adapter written against the documented API |
| Analytics | 21 typed events → `window.dataLayer` always, `/api/events` beacon when live |
| SEO | `pageHead()` per route, JSON-LD helpers, sitemap route, robots.txt |
| Git | **no `.git` locally**; repo is Lovable-connected somewhere we have not seen |

Pages: `/`, `/properties`, `/property/$slug`, `/markets`, `/$market`, `/$market/$region`, `/$market/guide`,
`/stories`, `/stories/$slug`, `/editorial-standard`, `/submit`, `/exposure`, `/about`, `/contact`, `/faq`, `/legal`,
redirects `/pricing`→`/exposure`, `/place-notes`→`/stories`, `/markets/*`→`/$market`.

### Defects found while indexing (not fixed: stage 0 forbids src edits)
1. Home `<title>` = "Matter of Place | Exceptional property. Properly considered. | Matter of Place" (`src/lib/seo.ts`, `pageHead`).
2. Contact email/phone, legal entity/address, Instagram URL unset → those lines do not render. Owner input, not code.
3. README says Vite 7; package.json pins 8.1.5. Cosmetic.
4. Two images in `src/assets` unreferenced, one gallery image unused (content-inventory.md §7).

## 3. What the docs already specify but nothing implements
| Piece | Spec location | Status |
|---|---|---|
| API (6 catalog reads, 4 writes, search, concierge, error shape, rate limits) | docs/architecture/services.md | NOT BUILT |
| Postgres schema: 20 tables, enums, RLS, editorial-gate trigger, catalog_version bump, 2 buckets | docs/database/schema.sql | NOT RUN anywhere |
| Cache layers (Query 5 min → edge → Worker cache → DB), image resizing | docs/architecture/caching.md | NOT BUILT |
| Cloudflare deploy (wrangler.toml, secrets, cron triggers) | docs/deploy/cloudflare.md | NOT DEPLOYED |
| Seed script `scripts/seed.ts` | roadmap.md | NOT WRITTEN |
| Admin surface behind Supabase Auth | roadmap.md, master-plan §38 | NOT BUILT (Studio suggested first) |
| Omnikom handoff webhook | overview.md | NOT BUILT |

## 4. The notebook page mapped onto reality
| Notebook block | Exists today | Missing |
|---|---|---|
| Website "pages": home, pricing, about, markets, listings, terms, privacy, newsletter signups | all present (pricing lives at /exposure; terms+privacy share /legal) | real contact/legal details; separate privacy/terms if legal requires |
| Lookup / searching → listings, light info, buying, newsletters | keyword matcher + filters + concierge (rule-based) | server search, real availability data |
| Listings → turned into content | property dossier page only | the whole generation pipeline |
| → Social: posts, videos | design language described in brief §33 | templates, renderer, accounts, publisher, scheduler |
| → Newsletters: emails, blog posts | subscribe form (local outbox); stories index | provider, double opt-in, digest assembly, standalone property email, story drafts |
| "What we need to figure out": automation, DB, backend, how admins deploy a listing, generating everything automatically | DB schema + API contract written | decisions D1–D13, then build |

## 5. Tooling now in place for the work
- agent-os stage gate (STAGE 0), position file, project CLAUDE.md, codebase-memory graph, 15 official plugins at project
  scope, four worker agents (`mop-designer`, `mop-builder`, `mop-scout`, `mop-auditor`).
- Global skills already on this machine that this project will use: seo-* family, ai-seo, seo-geo, schema-markup,
  programmatic-seo, site-architecture, social-content, content-strategy, email-sequence, copywriting, launch-strategy,
  analytics-tracking, design-tournament, dna-website, scroll-craft, supabase, cloudflare (plugin), resend (plugin).
