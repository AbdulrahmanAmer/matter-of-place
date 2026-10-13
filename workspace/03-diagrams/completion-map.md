# Where Matter of Place stands, as diagrams

Pictures: [img/completion-map-1.png](img/completion-map-1.png) (the road, and where we are),
[img/completion-map-2.png](img/completion-map-2.png) (everything built), [img/completion-map-3.png](img/completion-map-3.png)
(what is left, and what does not count).

Updated 2026-10-13 by the operator's definition: completion is the setup as code and software. Accounts on outside
services (the social apps) are set up by the operator and the orchestrator whenever they choose and do not
count toward it. The build plans of 2026-10-02 (waves, slices B1b to L1) are history; their files stay in `05-plans/`.

## 1. The road, and where we are

```mermaid
flowchart LR
  S0[Shape: decisions<br/>DONE 2026-09-30] --> S1[Design direction<br/>DONE]
  S1 --> S2[System design: plans<br/>DONE]
  S2 --> S3[Build: site, admin,<br/>database, automation<br/>DONE]
  S3 --> S4[Harden: security, backups,<br/>restore drill, rollback<br/>DONE]
  S4 --> S5[Live on matterofplace.com<br/>DONE]
  S5 --> S6[AI company: Matter and<br/>the colleagues run it<br/>DONE]
  S6 --> NOW([We are here: one gap left,<br/>staff cannot read email replies])
  NOW --> LOOP[Run and improve: Saturday audit,<br/>Matter's proposals, approvals]

  classDef done fill:#EEEAE1,stroke:#575751;
  classDef here fill:#C9C0B2,stroke:#11110F,stroke-width:2px;
  class S0,S1,S2,S3,S4,S5,S6 done;
  class NOW here;
```

## 2. Everything built

```mermaid
flowchart TB
  subgraph SITE["The website"]
    P1[Pages: home, markets, properties,<br/>stories, submit, newsletter, legal]
    P2[Finder, search, concierge,<br/>per-market interest signup]
    P3[SEO, AEO, GEO: JSON-LD, sitemap,<br/>llms.txt, OG images]
    P4[Essentials: consent, CSP,<br/>icons, security.txt]
  end
  subgraph ADMIN["The admin, front and back"]
    A1[Queue, decide, dossier,<br/>media, publish, approvals]
    A2[Invoices: issue, mark paid,<br/>activate, PDFs]
    A3[Automation: flows as data,<br/>emails, schedules, history]
    A4[Jobs, activity log, team and keys,<br/>search everything]
  end
  subgraph DATA["Database and jobs"]
    D1[One Supabase project, live:<br/>migrations, row security]
    D2[Job runner: pgmq + pg_cron,<br/>heavy renders in Actions]
    D3[Storage: uploads, media,<br/>documents; old uploads cleared]
    D4[Backups nightly,<br/>restore drill 2.1 minutes]
  end
  subgraph CONTENT["Content and distribution"]
    C1[Covers, carousels, stories,<br/>reels, newsletter blocks]
    C2[Place Notes newsletter:<br/>double opt-in, digest]
    C3[Instagram, X, LinkedIn<br/>adapters; Facebook, YouTube off]
    C4[Audit robot,<br/>Saturday mornings]
  end
  subgraph AI["The AI company"]
    M1[Matter: full power when a person<br/>or colleague wakes it]
    M2[Colleagues: hiring, daily meeting,<br/>decisions with a metric]
    M3[Ask Matter on any flow;<br/>admin calls through Approvals]
    M4[Laptop runner on the<br/>operator's Claude account]
  end
  subgraph EDGE["Edge and safety"]
    E1[Cloudflare Worker,<br/>cache with an outage copy]
    E2[DNSSEC, API burst guard,<br/>Turnstile]
    E3[Sentry, health checks,<br/>GA4 and Search Console]
  end

  classDef done fill:#EEEAE1,stroke:#575751;
  class P1,P2,P3,P4,A1,A2,A3,A4,D1,D2,D3,D4,C1,C2,C3,C4,M1,M2,M3,M4,E1,E2,E3 done;
```

## 3. What is left, and what does not count

```mermaid
flowchart LR
  subgraph LEFT["Left in the software: one item"]
    R1[Staff read email replies:<br/>a reply to our mail lands in the<br/>Zoho mailbox hello@ and admin@,<br/>which the AI staff cannot see] --> R2[Owner: Matter sets it up<br/>through Ask Matter / a proposal]
  end
  subgraph OUTSIDE["Outside accounts: do not count, done when chosen"]
    O1[Meta, X and LinkedIn accounts:<br/>connect the built adapters]
    O2[The Instagram handle<br/>for the site's link]
  end
  subgraph LATER["Later by decision"]
    L1[Stripe: invoices are<br/>manual until then]
    L2[Programmatic media:<br/>managed separately]
  end

  classDef open fill:#C9C0B2,stroke:#11110F,stroke-width:2px;
  classDef outside fill:#F5F2EB,stroke:#8B877F,stroke-dasharray: 5 5;
  class R1,R2 open;
  class O1,O2,L1,L2 outside;
```
