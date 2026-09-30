# The road to the finish line, as diagrams

Pictures: [img/completion-map-1.png](img/completion-map-1.png) (stages and gates), [img/completion-map-2.png](img/completion-map-2.png)
(build slices and what depends on what), [img/completion-map-3.png](img/completion-map-3.png) (what you set up before each slice).
Source of truth for the words: `../04-completion-map/completion-map.md`.

## 1. Stages and gates

```mermaid
flowchart LR
  S0[Stage 0 SHAPE<br/>decisions D1-D13, Q1-Q12<br/>DONE 2026-09-30] --> S1[Stage 1 DESIGN DIRECTION<br/>site done by MVP;<br/>social, email, reel templates<br/>chosen from rendered options]
  S1 --> S2[Stage 2 SYSTEM DESIGN<br/>plan file sliced<br/>with verifiable exits]
  S2 --> S3[Stage 3 BUILD<br/>B1-B16, each verified<br/>when it lands]
  S3 --> S4[Stage 4 HARDEN<br/>security, empty states,<br/>a11y, Lighthouse 95,<br/>backups, rollback]
  S4 --> S5[Stage 5 LAUNCH<br/>coming-soon live,<br/>first real property<br/>through the whole path]
  S5 --> LOOP[Iterate: Saturday audit<br/>→ PR → merge → deploy]
  LOOP --> S3
```

## 2. Build slices and dependencies

```mermaid
flowchart TB
  B1[B1 Repo hygiene: remove Lovable preset,<br/>wrangler, CI, preview per PR, Sentry, headers]
  B2[B2 Database: migrations, generated types,<br/>seed to dev only, R2 variants]
  B3[B3 API: catalog + writes + search +<br/>rule-based concierge + rate limits + Turnstile]
  B3b[B3b Coming-soon mode: empty states +<br/>per-market interest signup]
  B4[B4 Tests: Vitest + Playwright on every PR]
  B5[B5 Email: Resend, six transactional templates,<br/>Place Notes double opt-in]
  B6[B6 Money box: invoices, mark paid,<br/>activate agent; Stripe later]
  B7[B7 Admin workspace: queue, decide,<br/>dossier, media, publish, approvals]
  B8[B8 Job system: jobs, pgmq, pg_cron,<br/>Actions dispatch + callback]
  B8b[B8b Automation console: recipes,<br/>templates, reasons, toggles, dry-run]
  B9[B9 Creative system: carousel, story,<br/>cover, newsletter, reel templates]
  B10[B10 Social publishing: Meta Graph API]
  B11[B11 Newsletter automation: digest every 14 days,<br/>standalone email for Campaign]
  B12[B12 Reel: ffmpeg in Actions]
  B13[B13 SEO / AEO / GEO: JSON-LD, sitemap,<br/>llms.txt, OG, archive pages, title fix]
  B14[B14 Audit robot: Saturday morning]
  B15[B15 Omnikom handoff webhook]
  B16[B16 Legal identity: product of Omnikom]

  B1 --> B2 --> B3 --> B4
  B3 --> B3b
  B3 --> B5
  B3 --> B7
  B2 --> B8 --> B8b
  B7 --> B6
  B7 --> B8b
  B9 --> B10
  B8 --> B10
  B8b --> B10
  B5 --> B11
  B8b --> B11
  B9 --> B12
  B8 --> B12
  B3 --> B13
  B1 --> B14
  B3 --> B15
  B1 --> B16

  classDef found fill:#F5F2EB,stroke:#575751;
  classDef ops fill:#EEEAE1,stroke:#575751;
  classDef content fill:#C9C0B2,stroke:#575751;
  classDef found_ fill:#F5F2EB;
  class B1,B2,B3,B3b,B4 found;
  class B5,B6,B7,B8,B8b ops;
  class B9,B10,B11,B12 content;
```

## 3. What the owner sets up, and which slice waits for it

```mermaid
flowchart LR
  A1[A1 Namecheap domain →<br/>Cloudflare zone + API token] --> B1
  A8[A8 GitHub branch protection<br/>+ Actions secrets] --> B1
  A6[A6 Sentry account] --> B1
  A10[A10 Lovable disconnected] --> B1
  A2[A2 Supabase org:<br/>mop-dev, mop-prod] --> B2
  A3[A3 Resend + domain records] --> B5
  A4[A4 Invoice template inputs:<br/>entity, methods, numbering] --> B6
  A9[A9 Business facts: contact,<br/>entity, handle, editors] --> B7 & B16
  A5[A5 Meta Business, IG Business,<br/>developer app] --> B10
  A7[A7 GA4, Search Console,<br/>Tag Manager, Bing] --> B13 & B14

  B1[B1 Repo + deploy]
  B2[B2 Database]
  B5[B5 Email]
  B6[B6 Money box]
  B7[B7 Admin]
  B10[B10 Social]
  B13[B13 SEO]
  B14[B14 Audit robot]
  B16[B16 Legal identity]
```
