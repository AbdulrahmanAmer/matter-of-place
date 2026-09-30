# The road to the finish line — Matter of Place, approved stack (2026-09-30)

Everything between today and a live, self-running publication. Three parts: what you set up (accounts and access),
what we build (slices in order, each verified when it lands), and what "finished" means per lane. Stages follow
agent-os; the STAGE line in `PROJECT-STATE.md` moves only when a gate is met.

## Part A — Setup the CEO or owner does once (nothing builds without these)

| # | Setup | Where | Needed by |
|---|---|---|---|
| A1 | DONE: domain bought at Namecheap, Cloudflare account exists. NEXT SESSION: add the zone, point nameservers, API token; add the zone and point Namecheap nameservers at it; API token scoped to Workers + R2 | namecheap.com, dash.cloudflare.com | B1 |
| A2 | Supabase organisation; two projects: `mop-dev`, `mop-prod` (free) | supabase.com | B2 |
| A3 | Resend account; verify sending domain (SPF, DKIM, DMARC records in Cloudflare) | resend.com | B5 |
| A4 | Invoice template inputs: Omnikom entity, address, payment methods to list (bank, wire, card by phone), invoice numbering. Stripe account only when S32 is revisited | you | B6 |
| A5 | Via the CEO's partner (access on request): Meta Business Manager; Instagram Business account linked to a Facebook Page; developer app with `instagram_content_publish`, `pages_manage_posts` | business.facebook.com, developers.facebook.com | B10 |
| A6 | Sentry account (free) | sentry.io | B1 |
| A7 | Google: GA4 property, Search Console for the domain, Tag Manager container; Bing Webmaster | | B13 |
| A8 | GitHub: branch protection on `main`, Actions secrets from tech-stack §4 | github.com | B1 |
| A9 | DEFERRED (S47): legal entity placeholder, email only (no phone), Instagram after the partner creates it, CEO is admin + chief_editor. Business facts: contact email and phone, legal entity and address, Instagram handle, first editors' emails and roles | you | B4, B7 |
| A10 | Lovable: disconnect, or accept it never syncs this repo | lovable.dev | B1 |

## Part B — Build slices, in order (owner agent in brackets; each ends with something observed)

### Stage 2 — SYSTEM DESIGN (this document plus the plan file)
| # | Slice | Exit |
|---|---|---|
| P1 | Turn this map into the agent-os plan file with one section per slice: contract, files, verification command | operator reads it; STAGE → 3 |

### Stage 3 — BUILD

**Foundation**
| # | Slice | Exit |
|---|---|---|
| B1 | Repo hygiene: remove Lovable preset (plain Vite + TanStack Start config), `wrangler.toml`, CI (`check`, build), deploy workflow, preview per PR, Sentry wired, security headers [builder] | preview URL renders every route; Sentry receives a test error |
| B2 | Database: Supabase CLI init, migrations from a corrected schema (roles, jobs, assets, campaigns, audit columns), generated types, seed script from `src/data/*` with images to R2 variants [builder] | `supabase db reset` clean; 16 properties readable from dev DB |
| B3 | API: catalog reads with edge cache + `catalog_version`; writes for inquiries, submissions (signed uploads), subscribers with market interest, events; search; rule-based concierge; rate limits; request logging; Turnstile verification. Flip `VITE_API_BASE_URL` on preview [builder] | every form persists a row; `services.mode === "live"` |
| B3b | Coming-soon mode (S30): empty states for home edit, properties, each market and region with the per-market interest signup; illustrative seed excluded from production; "what is real" viewer statement on any illustrative preview [designer → builder] | production shows zero listings and a signup; preview shows seed |
| B4 | Tests as the safety net: Vitest contracts + state machine, Playwright sweep of every route desktop/phone/a11y, on every PR [builder] | CI red on a broken form, green on main |

**Operate the business**
| # | Slice | Exit |
|---|---|---|
| B5 | Email: Resend domain; transactional set: submission received ("we will review and be in touch"), declined with reason, accepted with next steps, invoice, inquiry acknowledgement, market-interest confirmation; Place Notes double opt-in, every two weeks [builder + designer for the layout] | test subscriber confirms; each template renders and sends |
| B6 | Money box (S32): `payments` table, invoice template (CEO + CTO), invoice PDF from `/admin`, preferred payment method field, "mark paid" + "activate agent" actions, audit trail; Stripe adapter later behind the same table [builder + designer] | an admin issues an invoice and activates a test agent |
| B7 | Admin workspace: auth + five roles, request queue with every submitted detail and photos, decline button with reason list + free text that sends the email without writing it, accept, dossier editor (narrative, facts, sequence, representation), media manager, publish, job and asset approvals, subscriber and interest lists [builder + designer] | an editor reviews, declines one, accepts one, publishes one, all from the UI |
| B8 | Job system: `jobs` table, pgmq, pg_cron runner, GitHub Actions dispatch + signed callback, retries, dead-letter view in admin [builder] | a publish creates jobs that complete and report |
| B8b | Automation console (S34): `automation_recipes`, `email_templates`, `decline_reasons`, `channel_settings`, `schedule_settings`, revisions; `/admin › Automation` with recipe editor, template editor with preview, toggles, approval modes, dry-run; runner reads recipes at trigger time [builder + designer] | an admin switches a step off, publishes, and the dry-run and the real run both skip it |

**Turn listings into content**
| # | Slice | Exit |
|---|---|---|
| B9 | Creative system: `mop-designer` produces rendered options for carousel, story, OG cover, newsletter block, standalone email, reel storyboard; winners become React templates in `src/templates` [designer → builder] | PNGs for one property match the chosen design |
| B10 | Social publishing: Meta app, publish carousel/story on approval, pull metrics into `campaign_reports` [builder] | a test post appears on the Instagram account |
| B11 | Newsletter automation: digest every 14 days (S25) assembled from published properties and stories, standalone property email for Campaign tier, sent through Broadcasts on approval [builder] | broadcast delivered to a test audience |
| B12 | Reel: ffmpeg template in Actions, poster + MP4 to R2, attached to the dossier and to the Instagram job for Campaign tier [designer → builder] | MP4 renders with wordmark and captions |

**Be found**
| # | Slice | Exit |
|---|---|---|
| B13 | SEO/AEO/GEO: JSON-LD per type, sitemap from DB, `llms.txt`, OG images from templates, archive pages (city, architect, style) generated only when the catalog justifies them, fix the title bug [builder] | rich-result test passes; llms.txt served; one brand in every title |
| B14 | Audit robot: `mop-auditor` on a Saturday-morning cloud schedule with API credentials, first report, first patch PR [auditor] | report in `workspace/audits/`; PR opened |
| B16 | Legal identity (S33): `siteConfig.legal` = Omnikom entity; footer line, legal, terms and privacy rewritten as "a product of Omnikom"; contact details rendered [builder] | legal page shows the entity; no null contact lines |
| B15 | Omnikom handoff: signed webhook for inquiries and attribution [builder] | payload received by the Omnikom endpoint |

### Stage 4 — HARDEN
Turnstile everywhere; CSP and HSTS; rate-limit rule live; secrets audit with `claude-security`; RLS reviewed per table;
empty, loading, 404 and 500 states; real legal pages with the entity; illustrative content labelled or replaced;
Lighthouse ≥ 95 mobile on the six key pages; rollback documented (`wrangler rollback`); backups verified (Supabase PITR
is paid, so a nightly `pg_dump` to R2 from Actions).

### Stage 5 — LAUNCH AND ITERATE
DNS cut-over, production deploy, verify against production, watch Sentry, GA4 and Search Console for a week, first
real property through the whole path (submit → review → accept → pay → publish → post → newsletter), then the weekly
audit loop drives the next slices.

## Part C — What "finished" means, per lane

| Lane | Finished when |
|---|---|
| Website | every route live-mode, cached at the edge, Lighthouse ≥ 95 mobile, no illustrative label on a real property |
| Backend | migrations are the only way the schema changes; types generated; every write validated, rate-limited, logged |
| Admin | an editor can run a week of the business without a developer, and can change what the automations do without a deploy |
| Automations | publish → assets → approval → post and mail, with failures visible and retryable |
| Money | acceptance before invoice enforced in the database; every invoice numbered, every payment marked by a named admin; Stripe can be added without touching the flow |
| Launch honesty | production never shows an illustrative property; every empty collection converts to a market-interest signup |
| Growth | the audit robot has run four weeks in a row and its PRs have shipped |
| Security | claude-security scan clean of highs; secrets only in Cloudflare and GitHub; forms bot-proof |

## Not in v1
Developments, international markets, memberships, language switcher, AI-written editorial, client dashboard (an emailed
report first), TikTok and YouTube, real-time anything.
