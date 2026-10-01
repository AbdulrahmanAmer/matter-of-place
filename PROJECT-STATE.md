# PROJECT STATE

> agent-os reads this file at session start and loads only the current stage's contract.
> Append to the log, never rewrite it. Only the operator advances the STAGE line.

STAGE: 3
enforcement: deny

## OPEN DECISIONS

None. Q1–Q16 answered by the CEO on 2026-09-30 (S22–S33, S43–S46). Owner inputs status in S47.
Stage 0 gate met; stage 2 gate met (PLAN.md read and sliced); STAGE stays 3 (BUILD). Production starts next session with B1b.

Owner inputs (not decisions): Omnikom legal entity name + registered address, contact email + phone, Instagram handle,
first editors' emails and roles, Meta Business access, Namecheap purchase of matterofplace.com, invoice template details
(bank/payment methods to list).

## SETTLED DECISIONS

| # | decision | date | why |
|---|---|---|---|
| S1 | Frontend stays as built: TanStack Start + plain CSS tokens; no redesign | 2026-09-30 | recalibration brief and ADR 0003; build verified green |
| S2 | ~~Database is Supabase Postgres with `docs/database/schema.sql`~~ → superseded by S8 | 2026-09-30 | the schema.sql is a sketch; migrations are the source |
| S3 | Markets CA/NY/FL, existing residential only, four products at $295/$695/$1,495/$1,250 | 2026-09-30 | recalibration brief; already in `src/data/exposure.ts` |
| S4 | Workers are Sonnet at medium or lower, Haiku for extraction; Fable orchestrates only | 2026-09-30 | operator requirement: least tokens |
| S5 | Version control: private GitHub repo `AbdulrahmanAmer/matter-of-place`, root = workspace folder, `main` protected later | 2026-09-30 | operator asked for a private repo; one repo keeps maps, agents and code together |
| S6 | Every diagram ships as PNG + SVG in `workspace/03-diagrams/img/` via `render.mjs`, never Mermaid source alone | 2026-09-30 | operator reads pictures, not code |
| S7 | Hosting: one Cloudflare Worker (site + `/api/*` + `/admin`), free tier; Lovable Vite preset removed for plain Vite | 2026-09-30 | CEO approved the free-first stack |
| S8 | Database: Supabase free tier, versioned migrations via CLI, TypeScript types generated from the schema, Zod for input only | 2026-09-30 | replaces hand-synced field names and the single schema.sql |
| S9 | Permissions: RLS per role (chief_editor, managing_editor, visual_editor, media_ops, commercial); only editorial roles accept/decline/publish | 2026-09-30 | the docs let every editor do everything |
| S10 | Editor auth: Supabase Auth magic links | 2026-09-30 | free, no passwords to manage |
| S11 | Photography: R2 originals + variants generated once at publish; no request-time resizing | 2026-09-30 | zero egress, no transformation bill |
| S12 | Jobs: `jobs` table + pgmq + pg_cron for light work; GitHub Actions for heavy renders (images, PNG covers, ffmpeg reels) | 2026-09-30 | free; replaces Cloudflare Queues and Browser Rendering |
| S13 | Email: Resend for transactional and Place Notes, double opt-in, own domain | 2026-09-30 | one provider, free to 3,000/month |
| S14 | Payments: Stripe, links after editorial acceptance, signed idempotent webhooks | 2026-09-30 | acceptance before payment is a brand rule |
| S15 | Social: Meta Graph API direct, one Business account; no scheduler subscription | 2026-09-30 | fewest accounts |
| S16 | Bots and abuse: Turnstile on every form, one edge rate-limit rule, per-endpoint limits in the API | 2026-09-30 | free |
| S17 | Observability: Sentry free tier, Workers logs, request IDs, daily health job; analytics GA4 + Search Console + Cloudflare + first-party events | 2026-09-30 | a requirement, not a phase |
| S18 | Admin: `/admin` inside the site from day one (queue, dossier editor, media, publish, approvals); Studio for emergencies only | 2026-09-30 | the business cannot run from Studio |
| S19 | Tests: Vitest contracts + state machine, Playwright every route desktop/phone/a11y, on every PR | 2026-09-30 | "set once, never touch" needs a test, not a promise |
| S20 | AI usage: Sonnet designs templates once; Haiku writes captions and alt text; nothing else uses a model at launch | 2026-09-30 | least tokens |
| S21 | Cost rule: free tier first; a paid feature needs a measured limit and a settled decision (GOTCHAS G-011, P-009) | 2026-09-30 | CEO: keep it free where we can |
| S22 | ~~Q1 Social at launch: Instagram + Facebook Page only; Pinterest and LinkedIn in month two~~ superseded by S48 | 2026-09-30 | one Meta account, one API |
| S23 | Q2 Generated posts need Media Ops approval for the first 60 days; then Feature-tier posts go automatically, Campaign posts keep a human | 2026-09-30 | trust the templates before trusting the robot |
| S24 | Q3 Per published property: cover, carousel, story, newsletter block; reel and standalone email only for Campaign tier | 2026-09-30 | video effort only where paid for |
| S25 | Q4 Place Notes goes out every two weeks | 2026-09-30 | curated issues, free email tier lasts |
| S26 | Q5 Admin roles from day one: chief_editor, managing_editor, visual_editor, media_ops, commercial (read-only) | 2026-09-30 | permission rules never reworked |
| S27 | Q6 Audit robot: weekly, **Saturday morning**, cloud schedule, fixes as PRs, never deploys itself | 2026-09-30 | CEO reads it over the weekend |
| S28 | Q7 Lovable disconnected for good; GitHub is the only source | 2026-09-30 | no sync risk, no preset lock-in |
| S29 | Q8 Domain bought at Namecheap, DNS moved to Cloudflare; hosting set up from there | 2026-09-30 | CEO's choice of registrar |
| S30 | Q9 **Launch is coming-soon**: no listings on the live site until real ones are accepted. Every collection (home edit, market pages, properties) has a graceful empty state that says what is real, says "coming soon", and offers a signup for the market the visitor cares about. Illustrative content never shows on production | 2026-09-30 | honesty with viewers; build the interest list before the inventory |
| S31 | Q10 Concierge is rule-based over dossier data at launch; no model | 2026-09-30 | zero cost, zero hallucination |
| S32 | Q11 **Payments are manual for now**: agent submits → automatic email "we will review and be in touch" → admin workspace shows the request → decline sends a templated email with a reason chosen/typed by the admin → accept → invoice from a template (CEO + CTO design it), preferred payment method collected, admin marks paid and activates the agent in the ecosystem. Stripe stays a later slice behind the same state machine | 2026-09-30 | phone-and-invoice is how the first clients will be closed |
| S33 | Q12 Legal entity is Omnikom's: Matter of Place is a product of Omnikom. Legal page, footer line, terms and privacy are rewritten to say so; entity name and address are owner inputs | 2026-09-30 | CEO: "a product by Omnikom at the end of the day" |
| S35 | **Built to be extended.** Every kind of change has one documented path (tech-stack §6): a page, an API route, an admin action, a table or column, a job type, an email template, an analytics event, a role. Each path names the files touched in order and the test that proves it. Feature code lives in feature folders; shared code is imported, never copied; migrations and generated types are the only way shapes change; a PR checklist enforces the path | 2026-09-30 | CEO: adding a button, a page or a behaviour must integrate the right way every time |
| S36 | **No music, ever.** Films and reels carry sound design only: synthesized environmental and transitional sound (room tone, wind, water, stone, wood, paper, whoosh on cuts, a single non-pitched impact), no pitched sustained tones, no chords, no melody, no rhythmic loops, no vocals. Silence is a beat. Rendered in code (Web Audio offline), never from a library of recordings | 2026-09-30 | CEO: music is haram; sound effects instead |
| S37 | **Motion engine for all video**: GSAP (choreography, split text, SVG draw) + Three.js (layered photographs, camera moves, light) + Web Audio/Tone.js for sound synthesis only, captured frame by frame in headless Chrome, encoded with ffmpeg. Launch-grade work runs Opus at high effort through a render → gate → fresh-eyes review loop (three rounds minimum). Restraint applies to palette, type and copy, not to motion | 2026-09-30 | CEO: v0 film looked like a slideshow; Anthropic-launch level wanted, all native code |
| S38 | **Agents as staff.** The admin platform is operable by AI agents until humans are hired: every admin action exists as an authenticated server function with the same role checks, so an agent account (role + `actor_kind = agent`) can review, decide, write dossiers, approve assets and adjust automations through the same paths humans use; every action is audited with the actor; automations are adjustable by the CTO session on request at any time. Planning, specs and architecture for this are written by the orchestrator itself, no worker agents (CEO 2026-09-30) | 2026-09-30 | CEO: end-to-end automations adjustable freely; hire AI agents to work the portal until humans exist |
| S42 | Usage split: Fable keeps judgment (decisions, architecture, review, verification) at medium effort; Sonnet 5.5 workers at medium write the bulk (slice plans, diagrams, visual fixes) from the written architecture and screen specs; every worker result is re-verified by the orchestrator. Supersedes the "no worker agents" clause of S38 | 2026-09-30 | CEO: weekly usage; Sonnet is about a third of the cost per token |
| S43 | Q13 Coming-soon pages show **no illustrative photographs**: type only on Bone/Ivory, the market name, the coming-soon statement and the interest signup. Illustrative imagery never reaches production (overrides ASSUMED A9's photo note; B3b updated) | 2026-09-30 | CEO: "coming soon is more trustworthy" |
| S44 | Q14 AI crawlers: **allow everything** in robots (retrieval and training bots); B13's AI-policy step becomes "no AI-specific disallow rules" | 2026-09-30 | CEO choice |
| S45 | Q15 Decline reasons and email templates are reviewed after the first build, in the admin editor with previews | 2026-09-30 | CEO |
| S46 | Q16 Agent guardrails kept for the first 60 days: 25 decisions/day per agent, agents cannot switch a channel to automatic | 2026-09-30 | CEO |
| S47 | Owner inputs status: Cloudflare account exists; matterofplace.com bought at Namecheap; Meta Business is the partner's (access on request); Supabase, Resend, Sentry, Google accounts do not exist yet and the CTO drives the browser to create the dev ones with the CEO typing credentials; owner email will be admin@matterofplace.com via Cloudflare Email Routing; legal entity DEFERRED (placeholder until the lawyer confirms; invoicing blocked until set, A4); no public phone, email only; Instagram handle DEFERRED (partner creates); first admin user = the CEO as admin + chief_editor, agents fill other roles; invoice payment methods DEFERRED to admin Settings | 2026-09-30 | CEO answers, round 2–4 |
| S48 | **Social channels (supersedes S22):** launch on Instagram, X and LinkedIn. Facebook and YouTube are built as blocks (rows in `channel_settings`, adapter interfaces, admin toggles) but stay disabled until further notice. Pinterest is dropped from the plan. Step catalog gains `post_x` and `post_linkedin`; human approval for the first 60 days still applies (S23) | 2026-10-01 | Dave: "we are going to exist on X, Instagram and LinkedIn; leave room for Facebook and YouTube" |
| S49 | Supabase `mop-dev` checked through the connector 2026-10-01: Postgres 17, empty public schema, no migrations, pgmq / pg_cron / pg_net available. Public sign-ups switched off. Advisor warning to clear in the first B2 migration: revoke EXECUTE on `public.rls_auto_enable()` from anon and authenticated | 2026-10-01 | connector read |
| S50 | No Docker on the operator's machine, ever (operator, 2026-10-01: "never use docker use my laptop"). Database work runs against the cloud project `mop-dev` through the paths that need no container (`supabase db push`, `gen types --project-id`, `functions deploy --use-api`, `config push`, the connector) and a native PostgreSQL 18 (scoop) for throwaway tests. `supabase start`, `supabase db diff` and `db reset` on a local stack are not used. R2 stays off until further notice (same day). |
| S51 | Ruling on the visual guardrail (CTO, 2026-10-01, from the readiness audit; the operator may overrule): "no gradients, no glow" means decoration. The legibility scrim over a photograph (hero, cards) and the map hairline pattern are functional and stay, exactly as approved in the visual pass (PR #2). No builder or audit robot removes them. The typeface Epilogue (footer and overlays, `--font-ui-alt`) stays as shipped and is self-hosted with the other three in B17. Two shadow rules that read as glow are listed for the operator, not changed. |
| S39 | Video production paused (CEO). Round-1 launch film kept; resume id in POSITION.md | 2026-09-30 | back to architecture and the site |
| S40 | Visual pass on the site: fix and polish inside the current identity (misalignments, spacing, type scale, component consistency, weak sections), desktop and phone; no redesign | 2026-09-30 | CEO answer Q-visual |
| S41 | Plan depth: every slice to file level (contract, files, data changes, verification); every admin screen as a written spec (purpose, elements, actions, states, permissions) plus flow diagrams; no HTML wireframes for now | 2026-09-30 | CEO answer Q-plan |
| S34 | **The admin portal is the operating system, and automations are settings, not code.** Every pipeline (what happens on submit, decline, accept, invoice, publish, approve, fortnightly digest) is a recipe stored in the database: ordered steps drawn from a fixed catalog of job types, each with parameters, an on/off switch and an approval gate. Admins edit recipes, email templates, decline reasons, per-tier asset lists, posting windows and channel toggles from an Automation section in `/admin`, with validation, versioning and a "who changed what" trail. No general workflow engine; a fixed step catalog that grows only through code | 2026-09-30 | CEO: one-click, headache-free operations; pipelines adjustable from the console |

## LOG - newest at the bottom, append only

- 2026-09-30 Step zero complete: workspace, plugins, agents, graph index, site index, content inventory, map of what we
  have, tech-stack draft, big diagram draft, completion map draft. Build/typecheck/lint verified green. See .claude/POSITION.md.
- 2026-09-30 Private repo created; diagrams rendered to PNG; GOTCHAS bank + hook; mop-work skill.
- 2026-09-30 CEO approved the free-first stack (S7–S21). tech-stack.md, completion-map.md, big-diagram.md rewritten to it.
  Remaining questions Q1–Q12 asked in session.
- 2026-09-30 Q1–Q12 answered (S22–S33); admin-as-operating-system and automations-as-settings recorded (S34).
- 2026-10-01 Owner setup progress: Zoho Mail organisation + admin@matterofplace.com live; matterofplace.com zone on Cloudflare (Free) with
  nameservers switched at Namecheap and the zone hardened (Full strict, HTTPS forced, TLS 1.2 minimum, Bot Fight Mode, speed
  recommendations). Cloudflare API token, R2, Turnstile deferred to their slices. Passwords for the next accounts generated into
  creds/ (git-ignored). Next: Supabase sign-up, then B1b.
- 2026-09-30 STAGE 0 → 3 on the CEO's instruction to start the Lovable cleanup (slice B1) now. Stage 1 and 2 gates are
  carried as work inside B9 (creative direction from rendered options) and P1 (plan file); they are not skipped, they are
  sequenced behind B1 because B1 touches only tooling and the removal of the preset.
