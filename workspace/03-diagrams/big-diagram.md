# The big diagram — Matter of Place end to end (approved stack, 2026-09-30)

**Pictures (open these, not the code):**
- [img/big-diagram-1.png](img/big-diagram-1.png) — the whole system map
- [img/big-diagram-2.png](img/big-diagram-2.png) — how an admin deploys a listing, step by step
- [img/big-diagram-3.png](img/big-diagram-3.png) — the weekly audit and upgrade loop
- [img/big-diagram-4.png](img/big-diagram-4.png) — the notebook page as a tree

SVG versions sit next to each PNG. After editing any diagram below, run `node render.mjs` in this folder to refresh the pictures.

Solid boxes exist today; dashed boxes are not built. Free tier everywhere unless a box says otherwise.

## 1. System map

```mermaid
flowchart TB
  visitor([Visitor: web, Instagram, X, LinkedIn, email, search, AI answer engines])
  agent([Agent / brokerage / owner])
  editor([Editorial team: Chief Editor, Managing Editor, Visual Editor, Media Ops])

  subgraph CF[Cloudflare, free tier: zone matterofplace.com]
    edge[Edge cache + WAF + Turnstile + rate-limit rule]
    site[One Worker: SSR pages, /api/* server routes, /admin behind auth, Cache API, keep-warm cron every 10 minutes. Also pr-N previews and the stable dev Worker matter-of-place-dev]
    r2[(R2, designed in and off until the operator enables it: stripped originals + variants made once when a photograph is attached, reels, copy of the nightly DB dump)]:::todo
  end

  subgraph SB[Supabase, free tier]
    db[(Postgres: catalog, submissions, inquiries, subscribers, events, campaigns, jobs, assets)]
    auth[Auth: magic links, roles chief_editor, managing_editor, visual_editor, media_ops, commercial, admin]
    store[(Storage, private buckets: submissions for signed uploads and staged originals, invoices for invoice PDFs)]
    q[[pgmq queues jobs_light, jobs_heavy + pg_cron: runner every minute, health, retention, token refresh]]:::todo
    fn[[Edge Function: job runner reads the recipe at trigger time]]:::todo
    rules[(Automation settings: recipes, email templates, decline reasons, channel + schedule settings, revisions)]:::todo
  end

  subgraph GH[GitHub, free tier]
    repo[Private repo: no branch protection on this plan, deploy runs only after CI passes on the same commit]
    ci[[Actions: check, test, build, wrangler deploy, nightly encrypted backup]]:::todo
    render[[Actions render workflow: image variants, carousel + story + OG PNGs, ffmpeg reels]]:::todo
  end

  subgraph GEN[Generated per publish, then waits for approval]
    og[OG cover]:::todo
    car[IG carousel 1080x1350]:::todo
    story[IG story 1080x1920]:::todo
    reel[Reel, Campaign tier]:::todo
    nl[Newsletter block + standalone email]:::todo
    cap[Captions + alt text: Haiku]:::todo
    approve{Media Ops approves in /admin}:::todo
  end

  subgraph OUT[Distribution]
    ig[Instagram: Meta Graph API]:::todo
    xch[X: X API, OAuth 2.0 user context]:::todo
    li[LinkedIn company page: LinkedIn API]:::todo
    offch[Facebook and YouTube: built as blocks, disabled until further notice]:::todo
    resend[Resend: Place Notes broadcasts + transactional]:::todo
    prog[Programmatic media, Campaign tier, managed separately]:::todo
  end

  subgraph MONEY[Commercial: manual now, Stripe later behind the same table]
    pay[payments table: invoice from template, PDF in the private invoices bucket, preferred method, mark paid, activate agent]:::todo
    stripe[Stripe adapter, later]:::todo
    omni[Omnikom handoff webhook: inquiries, attribution]:::todo
  end
  subgraph SOON[Coming-soon mode at launch]
    empty[Every empty collection: what is real, coming soon, signup for this market]:::todo
  end

  subgraph OBS[Observe and improve]
    sentry[Sentry free]:::todo
    ga[GA4 through gtag.js after consent + Search Console + Cloudflare zone analytics + first-party events]
    auditor[[mop-auditor on a schedule: perf, SEO, AEO, GEO, keywords, channels → report + patch PR]]:::todo
  end

  visitor --> edge --> site
  site -->|service role, server only| db
  site -->|signed PUT urls| store
  agent -->|PUT photograph| store
  agent -->|/submit| site
  editor -->|magic link| auth --> site
  editor -->|/admin › Automation: edit recipes, templates, toggles, dry-run| rules
  rules --> fn
  site -->|enqueue| q --> fn
  fn -->|heavy work: workflow_dispatch of render.yml| render
  render -->|signed callback| site
  render --> r2
  render --> og & car & story & reel & nl
  fn --> cap
  og & car & story & reel & nl & cap --> approve
  approve --> ig & xch & li & resend
  approve -.->|only when switched on| offch
  site --> pay
  stripe -.-> pay
  site --> empty
  site --> omni
  site --> sentry
  site --> ga
  auditor --> ga
  auditor -->|agent key: audit API with channel and newsletter numbers| site
  auditor -->|PR| repo --> ci -->|deploy| site
  prog -.-> OUT

  classDef todo stroke-dasharray: 5 5;
  style GEN stroke-dasharray: 5 5
  style OUT stroke-dasharray: 5 5
  style MONEY stroke-dasharray: 5 5
```

## 2. How an admin deploys a listing

```mermaid
sequenceDiagram
  participant A as Agent
  participant S as Site /submit
  participant D as Postgres
  participant E as Editor in /admin
  participant J as Jobs (pgmq + Actions)
  participant M as Media Ops in /admin
  participant O as Channels

  A->>S: submission + photo metadata (Turnstile checked)
  S->>D: insert submission (Submitted), signed upload URLs
  D-->>A: email: received, we will review and be in touch
  A->>D: photographs → private bucket
  E->>D: Under Review → Declined (reason picked, email sent automatically) or Accepted
  D-->>A: email: accepted, next steps and product choice
  E->>D: invoice from template, preferred payment method recorded
  D-->>A: email: invoice
  E->>D: mark paid, activate agent → Scheduled (Stripe webhook can do this later)
  E->>D: write dossier (narrative, sequence, facts, representation) → editorial_state published
  D->>J: jobs: catalog version bump, cache purge, variants, OG cover, carousel, story, newsletter block, captions (+ reel, email for Campaign)
  J->>D: assets rows, status pending
  M->>D: approve
  D->>J: publish jobs
  J->>O: Instagram, X and LinkedIn posts, queued into next Place Notes
  O-->>D: post ids, metrics → campaign_reports
```

## 3. The audit and upgrade loop

```mermaid
flowchart LR
  t[Saturday 12:00 UTC routine, audit row of schedule_settings] --> m[Measure: PSI, Search Console, GA4, Cloudflare zone analytics, uptime monitor, our audit API for channel and newsletter numbers, crawl, JSON-LD, llms.txt]
  m --> r[Rank findings: impact ÷ effort, brand guard]
  r --> w[Write workspace/audits/date.md]
  r --> p[Patch on a branch: code, copy, schema, keywords]
  p --> pr[PR: CI checks and review]
  pr --> h{Operator merges?}
  h -->|yes| d[Actions deploy] --> v[Verify in production] --> t
  h -->|no| t
```

## 4. The notebook page, as a tree

```mermaid
flowchart TB
  MOP[Matter of Place] --> W[Website pages: home, properties, markets, stories, exposure, submit, about, contact, faq, legal, newsletter]
  MOP --> L[Lookup / search: finder, filters, concierge]
  L --> L1[listings] & L2[light info] & L3[buying intent → inquiry] & L4[newsletter signup]
  MOP --> C[Listings turned into content]
  C --> S[Social: posts, videos]
  C --> N[Newsletters: emails, story drafts]
  MOP --> B[Backend + DB + admin publish flow + automation]
  MOP --> AU[Audit agent: performance, SEO, AEO, GEO, keywords, channels]
```
