# The road to the finish line, as diagrams

Pictures: [img/completion-map-1.png](img/completion-map-1.png) (stages and gates), [img/completion-map-2.png](img/completion-map-2.png)
(build slices and what depends on what), [img/completion-map-3.png](img/completion-map-3.png) (what you set up before each slice).
Source of truth for the words: `../04-completion-map/completion-map.md`.

## 1. Stages and gates

```mermaid
flowchart LR
  S0[Stage 0 SHAPE<br/>decisions D1-D13, Q1-Q12<br/>DONE 2026-09-30] --> S1[Stage 1 DESIGN DIRECTION<br/>site done by MVP,<br/>social, email, reel templates<br/>chosen from rendered options]
  S1 --> S2[Stage 2 SYSTEM DESIGN<br/>plan file sliced<br/>with verifiable exits]
  S2 --> S3[Stage 3 BUILD<br/>B1b to B17 in waves 1 to 6,<br/>each verified when it lands]
  S3 --> S4[Stage 4 HARDEN, H1<br/>security, empty states,<br/>a11y, Lighthouse 95,<br/>backups, rollback]
  S4 --> S5[Stage 5 LAUNCH, L1<br/>coming-soon live,<br/>first real property<br/>through the whole path]
  S5 --> LOOP[Iterate: Saturday audit<br/>→ PR → merge → deploy]
  LOOP --> S3
```

## 2. Build slices, waves and dependencies

Waves are `05-plans/PLAN.md`. Waves 3 and 4 interleave; the landing order is B8 steps 1 to 8, B8b steps 1 to 5, B5,
B16 steps 1 and 2 (any time after B2), the rest of B16 after B5, B7 steps 1 to 10, B6, B7 steps 11 to 16, B8 steps 9 and 10,
B8b steps 6 to 10. An arrow means "needs"; the full list is the Depends line of each plan.

```mermaid
flowchart TB
  subgraph W1["Wave 1"]
    B1[B1b Repo and delivery: wrangler, CI,<br/>preview per PR, dev Worker, Sentry, headers, backups]
  end
  subgraph W2["Wave 2: the spine"]
    B2[B2 Database on mop-dev: migrations, generated types,<br/>seed to dev only, R2 variants BLOCKED until R2 is on]
    B3[B3 API: catalog + writes + search +<br/>rule-based concierge + rate limits + Turnstile]
    B3b[B3b Coming-soon mode: empty states +<br/>per-market interest signup]
    B4[B4 Tests: Vitest + Playwright on every PR]
  end
  subgraph W3["Wave 3"]
    B8[B8 Job system: jobs, pgmq, pg_cron,<br/>Actions dispatch + callback]
    B8b1[B8b steps 1 to 5: automation tables, seed,<br/>planner, fan-out, scheduler, keep-warm]
    B5[B5 Email: Resend, transactional templates,<br/>Place Notes double opt-in]
    B7[B7 Admin workspace: queue, decide,<br/>dossier, media, publish, approvals]
    B17[B17 Website essentials: fonts, consent,<br/>CSP by hashes, icons, .well-known]
  end
  subgraph W4["Wave 4"]
    B6[B6 Money box: invoices, mark paid,<br/>activate agent, Stripe later]
    B8b2[B8b steps 6 to 10: automation API<br/>and screens 17 to 21]
    B16[B16 Legal identity: product of Omnikom]
  end
  subgraph W5["Wave 5"]
    B9[B9 Creative system: carousel, story,<br/>cover, newsletter, reel templates]
    B10[B10 Social publishing: Instagram, X, LinkedIn,<br/>Facebook and YouTube as disabled blocks]
    B11[B11 Newsletter automation: digest every 14 days,<br/>standalone email for Campaign]
    B12[B12 Reel: ffmpeg in Actions]
  end
  subgraph W6["Wave 6"]
    B13[B13 SEO / AEO / GEO: JSON-LD, sitemap,<br/>llms.txt, OG, archive pages]
    B14[B14 Audit robot: Saturday morning]
    B15[B15 Omnikom handoff webhook]
  end
  H1[H1 HARDEN, wave 7]
  L1[L1 LAUNCH, wave 8]

  B1 --> B2 --> B3 --> B3b --> B4
  B3 --> B8 --> B8b1
  B4 --> B8b1
  B3 --> B5
  B3 --> B7
  B3b --> B17
  B5 --> B17
  B2 --> B16
  B5 --> B16
  B7 --> B6
  B5 --> B6
  B7 --> B8b2
  B5 --> B8b2
  B8b1 --> B8b2
  B8 --> B9
  B8b1 --> B9
  B9 --> B10
  B8b1 --> B10
  B5 --> B11
  B8b1 --> B11
  B9 --> B12
  B17 --> B13
  B8b1 --> B13
  B13 --> B14
  B10 --> B14
  B11 --> B14
  B7 --> B15
  B8b1 --> B15
  W6 --> H1 --> L1

  classDef found fill:#F5F2EB,stroke:#575751;
  classDef ops fill:#EEEAE1,stroke:#575751;
  classDef content fill:#C9C0B2,stroke:#575751;
  class B1,B2,B3,B3b,B4 found;
  class B5,B6,B7,B8,B8b1,B8b2,B16,B17 ops;
  class B9,B10,B11,B12 content;
```

## 3. What the owner sets up, and which slice waits for it

```mermaid
flowchart LR
  A1[A1 DONE: Cloudflare zone,<br/>mop-admin and deploy tokens] --> B1
  A8[A8 DONE: GitHub Actions secrets<br/>and variables, no branch protection] --> B1
  A6[A6 DONE: Sentry account] --> B1
  A10[A10 DONE: Lovable disconnected] --> B1
  A2[A2 Supabase org: mop-dev DONE,<br/>mop-prod at launch] --> B2
  A3[A3 Resend + domain records] --> B5
  A4[A4 Invoice template inputs:<br/>entity, methods, numbering] --> B6
  A9[A9 Business facts: contact,<br/>entity, handle, editors] --> B4 & B7
  A5[A5 X app, LinkedIn page and app,<br/>Meta through the partner] --> B10
  A7[A7 GA4 with gtag.js, Search Console,<br/>Bing, no Tag Manager] --> B13 & B14
  A12[A12 Anthropic API key] --> B9
  A13[A13 GitHub dispatch token] --> B8 & B9
  A14[A14 Omnikom endpoint and secret] --> B15
  A15[A15 Uptime monitor key,<br/>optional Sentry token] --> B14

  B1[B1b Repo + deploy]
  B2[B2 Database]
  B4[B4 Tests]
  B5[B5 Email]
  B6[B6 Money box]
  B7[B7 Admin]
  B8[B8 Job system]
  B9[B9 Creative system]
  B10[B10 Social]
  B13[B13 SEO]
  B14[B14 Audit robot]
  B15[B15 Omnikom handoff]
```
