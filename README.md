# Matter of Place

A selective real-estate media platform for exceptional residential property in California, New York and Florida.
We curate it, frame it, publish it, distribute it. A product of Omnikom. Site: matterofplace.com (not live yet).

**Where we are (1 Oct 2026):** the website exists and looks right (visual pass merged). Every decision is made and the
whole build is planned to the file level (21 slices). Company email is live (admin@matterofplace.com on Zoho Mail) and
the domain runs on Cloudflare with the zone hardened (Full strict TLS, HTTPS forced, bot protection, speed settings).
Nothing behind the site is built yet: no database, no admin, no invoices, no social posting, no newsletter. Production
starts with slice B1b (repo and delivery). This page is the map; the folders hold the detail.

## The whole system in one picture
Solid boxes exist today; dashed boxes are what we build.

![System map](workspace/03-diagrams/img/big-diagram-1.png)

## What an agent's submission goes through (one click per step for us)

![A submission's life](workspace/03-diagrams/img/admin-os-1.png)

## The road to live
Eight waves, in order. Each wave is a folder of plans a builder can execute without asking questions.

![Stages and gates](workspace/03-diagrams/img/completion-map-1.png)

| Wave | What gets built | Result you can see |
|---|---|---|
| 1 | Repo and delivery: deploy pipeline, previews per change, error monitoring | the site deploys itself on every merge |
| 2 | Database, API, coming-soon mode, tests | forms save real records; empty markets say "coming soon" with a signup |
| 3 | Email, admin workspace, job system, website essentials | we review submissions with one click, emails go out by themselves; headers, consent, accessibility, feeds, icons and error pages meet a professional bar |
| 4 | Money box, automation console, legal identity | invoices from a template; automations adjustable from the admin without a developer |
| 5 | Creative system, social posting, newsletter, reel | a published property becomes a carousel, story, newsletter block and, for Campaign, a reel |
| 6 | SEO / AEO / GEO, weekly audit robot, Omnikom handoff | found by search and AI answer engines; a Saturday report with fixes |
| 7 | Harden | security, backups, rollback, performance |
| 8 | Launch | DNS cut-over, first real property end to end, watch week |

![Build slices and what depends on what](workspace/03-diagrams/img/completion-map-2.png)

## What the admin portal will be
25 screens in six groups. Automations are settings in the database, changed from the console, not code.

![Admin navigation](workspace/03-diagrams/img/admin-screens-1.png)
![Automations as settings](workspace/03-diagrams/img/admin-os-2.png)

## The automations
Every trigger and what it fires. Recipes are settings we edit in the admin, not code; a human approves generated
assets before anything posts (first 60 days), and every change is versioned.

![Every trigger and its steps](workspace/03-diagrams/img/automations-1.png)
![The clocks](workspace/03-diagrams/img/automations-2.png)

More: [job lifecycle](workspace/03-diagrams/img/architecture-3.png) · [publish pipeline](workspace/03-diagrams/img/plans-c-1.png) ·
[recipe engine](workspace/03-diagrams/img/plans-b-3.png) · [weekly audit loop](workspace/03-diagrams/img/big-diagram-3.png) ·
[who can change what](workspace/03-diagrams/img/automations-3.png)

## Website essentials
What every professional site must serve, and how consent and headers work here (plan B17).

![Headers by route class](workspace/03-diagrams/img/essentials-1.png)
![Consent flow](workspace/03-diagrams/img/essentials-2.png)
![The files every site serves](workspace/03-diagrams/img/essentials-3.png)

## The database (designed, not yet created)
Every table, column, permission and trigger is specified in [workspace/06-architecture/architecture.md](workspace/06-architecture/architecture.md) §3,
and the migration files are listed in order in [workspace/05-plans/B2.md](workspace/05-plans/B2.md). Groups: catalog
(markets, regions, properties, media, stories) · people and audit (roles, agent keys, audit log) · intake (submissions,
inquiries, subscribers with market interest, analytics) · commercial (payments, campaigns, reports) · automation as data
(recipes, email templates, decline reasons, channel and schedule settings, revisions) · jobs and generated assets
(events, jobs, assets, social posts, newsletter issues).

![Data model](workspace/03-diagrams/img/architecture-2.png)

## Accounts and inputs we still need (owner side)
| Need | Status | Used by |
|---|---|---|
| matterofplace.com | done: registered at Namecheap, DNS on Cloudflare nameservers | everything |
| Cloudflare | done: account under admin@matterofplace.com, zone active on Free, mail records imported, TLS and security hardened. Left for wave 1: API token, R2 bucket (needs a card on file) | wave 1 |
| Company email | done: Zoho Mail free plan, admin@matterofplace.com sends and receives; SPF, DKIM, DMARC set | everything |
| Supabase (database) | done: organisation "Matter Of Place" (Free) under admin@matterofplace.com, dev project `mop-dev` running in East US. Production project is created at launch | wave 2 |
| Resend (email) | sign up with admin@matterofplace.com when wave 3 starts | wave 3 |
| Sentry (errors) | sign up with admin@matterofplace.com when wave 1 starts | wave 1 |
| Google: GA4, Search Console | sign up with admin@matterofplace.com when wave 6 starts | wave 6 |
| Meta Business + Instagram Business | Dave's; access when we reach wave 5 | wave 5 |
| Legal entity name and address | deferred until the lawyer confirms; invoices are blocked until set | wave 4 |
| Instagram handle | when Dave creates it | wave 5 |
| Payment methods for invoices | set later in admin Settings | wave 4 |

## Decisions that shape everything
Free tier first, pay only when a measured limit is hit · no music ever in films, sound design only · launch is coming-soon
until the first real property · payments are manual invoices now, Stripe later behind the same table · agents (AI) can
work the admin portal until humans are hired · Instagram, X and LinkedIn at launch (Facebook and YouTube built as switched-off blocks), human approval on posts for 60 days ·
newsletter every two weeks · audit robot every Saturday morning.
Full ledger: [PROJECT-STATE.md](PROJECT-STATE.md). Things that already bit us: [GOTCHAS.md](GOTCHAS.md).

## Folder map
| Folder | What |
|---|---|
| `Matter Of Place Codebase/` | the site (React, TanStack Start, plain CSS, Cloudflare Worker) |
| `workspace/00-MAP-OF-WHAT-WE-HAVE.md` | the company and what exists today |
| `workspace/02-tech-stack/` | the approved stack and the rule for adding anything |
| `workspace/03-diagrams/img/` | every diagram as a picture |
| `workspace/04-completion-map/` | the road, in words |
| `workspace/05-plans/` | 21 build slices to file level, PLAN.md order, ASSUMED.md decisions, check-plans.mjs consistency check |
| `workspace/06-architecture/` | the engineering architecture |
| `workspace/07-admin-platform/` | the 25 admin screens |
| `workspace/08-visual-pass/` | the site visual audit and fixes (merged) |
| `launch/` | the launch film work (paused), motion bible, gate |
