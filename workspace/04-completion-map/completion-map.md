# Completion map — from Lovable MVP to production (DRAFT, phases only)

Stages follow agent-os. Each BUILD slice fits one session, has one owner agent, and ends with something observed.
Slices become a real plan file once decisions D1–D13 are answered. Order matters: nothing generates content until a
property can be published from a database.

## Stage 0 — SHAPE (now)
Exit: D1–D13 answered in PROJECT-STATE.md; owner inputs collected (contact, legal entity, Instagram, domain, Meta access, repo).

## Stage 1 — DESIGN DIRECTION (mostly done by the Lovable build)
Remaining: the creative system that does not exist yet, designed once by `mop-designer` as rendered options:
carousel and story templates, OG image, reel storyboard, Place Notes email layout, standalone property email.
Exit: winners chosen from renders, written as tokens next to `src/styles/tokens.css`.

## Stage 2 — SYSTEM DESIGN
Write the plan: API routes and handlers, admin surface, queue jobs and generators, integrations and failure modes,
environments (preview, production), secrets list, out of scope for v1. Exit: plan read by operator, sliced.

## Stage 3 — BUILD (candidate slices, owner in brackets)
| # | Slice | Observed exit |
|---|---|---|
| B1 | Repo + CI: clone the Lovable repo, branch protection, Actions running `check` + build, wrangler deploy to a preview hostname in local mode [builder] | preview URL renders every route |
| B2 | Supabase project, run schema.sql, first admin role, seed script from `src/data/*` with images moved to R2 [builder] | `GET /api/properties` equivalent SQL returns 16 rows |
| B3 | API server routes: catalog reads with cache + catalog_version, inquiries, submissions + signed uploads, subscribers, events, search, concierge; switch `VITE_API_BASE_URL` on preview [builder] | forms persist rows; `services.mode === "live"` |
| B4 | Email: Resend domain, transactional (receipt, decision, payment link), Place Notes double opt-in [builder] | test subscriber confirms; inquiry receipt arrives |
| B5 | Stripe: four products, Checkout after acceptance, webhook → state machine [builder] | test payment moves a submission to Scheduled |
| B6 | Admin phase 1: `/admin` review queue + dossier editor + publish button behind Supabase Auth [builder + designer] | editor publishes a seeded property from the UI |
| B7 | Creative templates: OG, carousel, story, newsletter block rendered by Browser Rendering from HTML [designer → builder] | PNGs for one property match the design |
| B8 | Publish pipeline: trigger → Queue → generators → approval rows → R2 [builder] | publishing creates assets pending approval |
| B9 | Social publishing: Meta app, IG Business + FB Page, publish on approval, metrics pull [builder] | a test post appears on the account |
| B10 | Newsletter automation: weekly digest assembly + standalone property email for Campaign tier [builder] | broadcast sent to a test audience |
| B11 | Reel generator: ffmpeg template in Actions/Container, Campaign tier only [designer → builder] | MP4 renders with wordmark and captions |
| B12 | SEO/AEO/GEO foundation: JSON-LD per type, sitemap from DB, llms.txt, archive pages for cities/architects/styles when the catalog justifies them [builder] | rich-result test passes; llms.txt served |
| B13 | Audit agent: `mop-auditor` routine, API credentials, first report, first patch PR [auditor] | report file exists; PR opened |
| B14 | Omnikom handoff webhook for inquiries and attribution [builder] | payload received by Omnikom endpoint |

## Stage 4 — HARDEN
Turnstile on every form; CSP/HSTS; rate-limit rules; secrets audit (`claude-security` scan); RLS per table; empty,
loading, 404, 500 states; Playwright sweep desktop + phone; Lighthouse ≥ 95 mobile on the six key pages; real legal
pages with the registered entity; illustrative content replaced or clearly labelled; rollback path documented.

## Stage 5 — LAUNCH AND ITERATE
DNS to Cloudflare, production deploy, verify against production, watch Sentry + GA4 + Search Console for a week,
then the weekly audit loop drives the next slices (keywords, AEO, social cadence, newsletter growth).

## Not in v1 (from the brief)
Developments, international markets, memberships, language switcher, AI-written editorial, client reporting dashboard
(a simple emailed report first), TikTok/YouTube.
