# Matter of Place

A selective real-estate media platform for exceptional residential property in California, New York and Florida.
We curate it, frame it, publish it, distribute it. A product of Omnikom. Site: [matterofplace.com](https://matterofplace.com) (live, coming-soon mode).

**Where we are (2026-10-13):** live since 2026-10-11 (stage 5, LAUNCH). matterofplace.com serves the public site in
coming-soon mode (no illustrative property, per-market interest signups), with the admin portal at `/admin`, the
database, the job system, email, the automation console, invoices, the newsletter and the AI staff (Matter and his
colleagues, run from the operator's laptop) all running on their own. Every merge to `main` deploys itself and is
smoke-tested; a failed smoke rolls back.

- Merged today: the accessibility panel and privacy wording (370), the sign-in key fix (367, gap audit item 8), the
  office window (369), laptop CI and backups (366), live Matter (365), the W6 plan (373). All on the live site.
- In progress: Matter teaching the AI staff to read email replies (W4); the router upgrade (PR 357, NOT DONE); the
  GitHub Actions bump (PR 356); Matter's live session moving to new code without a restart (W5 item 5, UNPROVEN).
- Next: W6 (staff that watch their own usage, a system map, Matter building the rest and learning from it, a client
  room), after the weekly Claude allowance resets on Saturday.
- Waiting on the operator: the social accounts (Instagram, X, LinkedIn) and the first real listing, which proves the
  submission-to-publish path end to end.
- On the operator's own measure (21 items, social accounts left out): 13 merged, 8 of them observed working live,
  3 in progress, 5 waiting on Saturday's reset or the first real listing.

The numbers below come from the build board. They count plan steps accepted through the lane reviews, which ended on
2026-10-13; work built after that (invoices B6, the newsletter B11, Matter's own work) exists in the code but is not
counted there.

<!-- progress:start -->
**Progress (updated 2026-10-13, from the build board):** 205 of 262 planned steps accepted (78.2%), 13 of 23 slices closed, 1 steps in work.

| Arm | To launch | What it covers |
|---|---|---|
| Website | 84.4% | pages, forms, the public API they call, SEO, legal pages |
| Admin portal | 82.5% | screens, actions, roles and permissions |
| Backend logic and automation | 82.7% | jobs, recipes, cross-wiring, content pipelines, email |
| Database | 82.5% | tables, functions, triggers, policies, migrations |
| Deployment and operations | 83% | CI, deploys, backups, monitoring, the launch switch |

| Slice | What | Accepted | |
|---|---|---|---|
| B2 | Database | 15 of 15 | 100% |
| B3 | API | 18 of 18 | 100% |
| B3b | Coming-soon mode | 10 of 10 | 100% |
| B4 | Tests | 10 of 10 | 100% |
| B5 | Email | 10 of 10 | 100% |
| B7 | Admin workspace | 20 of 20 | 100% |
| B8 | Job system | 14 of 14 | 100% |
| B8b | Automation console | 11 of 11 | 100% |
| B9 | Creative system | 11 of 11 | 100% |
| B12 | Reel | 9 of 9 | 100% |
| B13 | SEO, AEO, GEO | 13 of 13 | 100% |
| B15 | Omnikom handoff | 7 of 7 | 100% |
| B16 | Legal identity | 8 of 8 | 100% |
| B1b | Repo and delivery | 15 of 16 | 93.8% |
| B10 | Social publishing | 9 of 16 | 56.3% |
| B14 | Audit robot | 6 of 9 | 66.7% |
| B17 | Website essentials and compliance (the must-haves of any professional site) | 9 of 12 | 75% |
| H1 | HARDEN checklist | 7 of 11 | 63.6% |
| L1 | LAUNCH | 3 of 11 | 27.3% |

Not started yet: B6 (Money box), B11 (Newsletter), B18 (Exposure products as a database setting), H2 (Acceptance panel: the whole site walked through by three senior agents).
<!-- progress:end -->

How the build works: plans in `workspace/05-plans/` broken into steps, each with a proof. The parallel lanes were retired on 2026-10-13; work now lands as single pull requests (the orchestrator's, and Matter's from his desk), each merged only through a gate that refuses anything without green checks and a replayed watched-fail for every new test. Decisions: [PROJECT-STATE.md](PROJECT-STATE.md). Things that already bit us: [GOTCHAS.md](GOTCHAS.md). Position of the work: [.claude/POSITION.md](.claude/POSITION.md).

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

Public pages are served from cache and do not query the database when warm: [what a visitor's request touches](workspace/03-diagrams/img/architecture-5.png).

## Website essentials
What every professional site must serve, and how consent and headers work here (plan B17).

![Headers by route class](workspace/03-diagrams/img/essentials-1.png)
![Consent flow](workspace/03-diagrams/img/essentials-2.png)
![The files every site serves](workspace/03-diagrams/img/essentials-3.png)

## The database
Built and seeded on `mop-dev` (slice B2 closed 2026-10-03). Every table, column, permission and trigger is specified in [workspace/06-architecture/architecture.md](workspace/06-architecture/architecture.md) §3,
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
| Cloudflare | done: account under admin@matterofplace.com, zone active on Free, mail records imported, TLS and security hardened, deploy token and owner token issued. Previews use holy-meadow-4327.workers.dev | wave 1 |
| Storage (photos, uploads, documents) | done: Supabase Storage buckets, no R2 (decision S57) | waves 2, 5, 7 |
| GitHub | done: repository public for now (Actions minutes; the operator switches it back to private when building is done), Actions enabled and secrets set. No branch protection and no Environments on this plan, so merge review is the gate | wave 1 |
| Turnstile | done: widget "matterofplace.com forms" | wave 2 |
| Company email | done: Zoho Mail free plan, admin@matterofplace.com sends and receives; SPF, DKIM, DMARC set | everything |
| Supabase (database) | done: one project `mop-dev`, the build database now and production after the launch switch (decision S60); 33 tables, policies, functions, cron and the job runner deployed | everything |
| Resend (email) | done: team, three verified sending domains, dev key and webhook; real sends come with slice B5 | wave 3 |
| Sentry (errors) | done: organisation and project created, errors only | wave 1 |
| Google: GA4, Search Console | accounts exist (decision S64); wired in slices B13 and B14 | wave 6 |
| X developer app, LinkedIn page and app | after launch (decision S64): the channels ship as switched-off blocks | after launch |
| Anthropic API key | none, by decision S58: captions are written through the operator's Claude account by a runner on the laptop | wave 5 |
| Meta Business + Instagram Business | after launch, through the partner (decision S64) | after launch |
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
| `app/` | the site (React, TanStack Start, plain CSS, Cloudflare Worker) |
| `workspace/00-MAP-OF-WHAT-WE-HAVE.md` | the company and what exists today |
| `workspace/02-tech-stack/` | the approved stack and the rule for adding anything |
| `workspace/03-diagrams/img/` | every diagram as a picture |
| `workspace/04-completion-map/` | the road, in words |
| `workspace/05-plans/` | 22 plans to file level, PLAN.md order, ASSUMED.md rulings, the build board (`board.mjs`), the sizing per slice, check-plans.mjs consistency check |
| `workspace/06-architecture/` | the engineering architecture |
| `workspace/07-admin-platform/` | the 25 admin screens |
| `workspace/08-visual-pass/` | the site visual audit and fixes (merged) |
| `launch/` | the launch film work (paused), motion bible, gate |
| `brand/` | the brand assets: logo (emblem, wordmark, lockups) as SVG and PNG, icons, palette, the four typefaces; `brand/README.md` describes every file; regenerate with `node launch/tools/brand-build.mjs` |
