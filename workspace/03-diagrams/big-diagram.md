# The big diagram — Matter of Place end to end (DRAFT)

Mermaid; renders on GitHub and in most markdown viewers. Solid boxes exist today; dashed boxes are not built.
Sub-diagrams follow for the three flows the notebook page asks about: publish a listing, generate everything, audit and upgrade.

## 1. System map

```mermaid
flowchart TB
  visitor([Visitor: web, Instagram, email, search, AI answer engines])
  agent([Agent / brokerage / owner])
  editor([Editorial team: CEO, Managing Editor, Visual Editor])

  subgraph CF[Cloudflare zone matterofplace.com]
    edge[Edge cache + WAF + Turnstile + rate limits]
    site[Site Worker: SSR pages, /api/* server routes]
    cache[(Cache API / KV: catalog by catalog_version)]
    r2[(R2: published photography)]
    img[Image Resizing /cdn-cgi/image]
    queue[[Queue: publish jobs]]:::todo
    cron[[Cron: prune events, keep-warm, reconcile uploads, weekly digest]]:::todo
    render[Browser Rendering: HTML → PNG]:::todo
  end

  subgraph SB[Supabase]
    db[(Postgres: catalog, submissions, inquiries, subscribers, events, campaigns)]
    auth[Auth: editors, user_roles]
    store[(Storage: submissions bucket, signed uploads)]
  end

  subgraph GEN[Content generation: scripts first, AI only for words]:::todo
    og[OG image]
    car[IG carousel 1080x1350]
    story[IG story 1080x1920]
    reel[Reel: ffmpeg Ken Burns]
    nl[Newsletter block + standalone email]
    cap[Captions + alt text: Haiku]
    approve{Editor approval}
  end

  subgraph OUT[Distribution]:::todo
    ig[Instagram + Facebook: Meta Graph API]
    pin[Pinterest / LinkedIn: month two]
    resend[Resend: Place Notes broadcast + transactional]
    prog[Programmatic media: display, native, OLV, CTV, DOOH]
  end

  subgraph MONEY[Commercial]:::todo
    stripe[Stripe Checkout after acceptance + webhook]
    omni[Omnikom handoff webhook: inquiries, attribution]
  end

  subgraph OBS[Observe and improve]
    ga[GTM + GA4 + first-party analytics_events]
    sc[Search Console + Bing]:::todo
    sentry[Sentry]:::todo
    auditor[[mop-auditor weekly: perf, SEO, AEO, GEO, keywords, channels]]:::todo
    gh[GitHub: PRs, Actions: check, build, wrangler deploy]:::todo
  end

  visitor --> edge --> site
  site <--> cache
  site -->|service role, server only| db
  site -->|signed PUT urls| store
  visitor -->|PUT photograph| store
  site --> img --> r2
  agent -->|/submit| site
  editor -->|review, accept, publish| auth --> db
  db -->|publish trigger| queue --> GEN
  render --> og & car & story
  cap --> approve
  og & car & story & reel & nl --> approve
  approve --> ig & pin & resend
  approve --> r2
  db --> stripe --> db
  site --> omni
  site --> ga
  auditor --> ga & sc & ig & resend
  auditor -->|report + patch PR| gh -->|deploy| site
  prog -.->|campaign tier only| OUT

  classDef todo stroke-dasharray: 5 5;
```

## 2. How an admin deploys a listing (the question on the notebook page)

```mermaid
sequenceDiagram
  participant A as Agent
  participant S as Site /submit
  participant D as Postgres
  participant E as Editor (admin)
  participant P as Stripe
  participant Q as Queue
  participant G as Generators
  participant O as Channels

  A->>S: submission + photo metadata
  S->>D: insert submissions (Submitted), signed upload URLs
  A->>D: photographs → Storage
  E->>D: Under Review → Accepted or Declined (gate trigger)
  D-->>A: email: accepted, choose exposure (Resend)
  A->>P: Checkout (Feature / Reach / Campaign / Five Features)
  P->>D: webhook → Awaiting Payment → Scheduled
  E->>D: write dossier (narrative, sequence, facts) → editorial_state published
  D->>Q: publish job {property, tier}
  Q->>G: OG, carousel, story, newsletter block, captions (+ reel, email for Campaign)
  G->>D: assets rows, status pending approval
  E->>D: approve
  D->>O: publish to Instagram/Facebook, queue for next Place Notes
  O-->>D: post ids, metrics for campaign_reports
```

## 3. The audit and upgrade loop

```mermaid
flowchart LR
  t[Weekly trigger] --> m[Measure: PSI, Search Console, GA4, Graph API, Resend, crawl, JSON-LD, llms.txt]
  m --> r[Rank findings: impact ÷ effort, brand guard]
  r --> w[Write workspace/audits/date.md]
  r --> p[Patch on a branch: code, copy, schema, keywords]
  p --> pr[PR: security-guidance + code-review plugins]
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
