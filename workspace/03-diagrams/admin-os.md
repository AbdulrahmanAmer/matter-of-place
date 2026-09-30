# The admin operating system, as diagrams

Pictures: [img/admin-os-1.png](img/admin-os-1.png) (a submission's life, one click per step),
[img/admin-os-2.png](img/admin-os-2.png) (how automations are stored and changed from the console),
[img/admin-os-3.png](img/admin-os-3.png) (what each role can do).

## 1. A submission's life in /admin

```mermaid
stateDiagram-v2
  [*] --> Submitted: agent submits, Turnstile ok
  Submitted --> Submitted: auto email "received, we will review"
  Submitted --> UnderReview: editor opens the request
  UnderReview --> Declined: Decline + reason (auto email with the why)
  UnderReview --> Accepted: Accept (auto email, next steps, products)
  Accepted --> AwaitingAssets: photos or rights missing (auto email)
  AwaitingAssets --> Accepted: assets arrive
  Accepted --> InvoiceIssued: Issue invoice from template
  InvoiceIssued --> Scheduled: Mark paid + activate agent
  Scheduled --> Published: editor writes dossier, Publish
  Published --> AssetsPending: recipe runs: variants, cover, carousel, story, newsletter block, captions
  AssetsPending --> DistributionActive: Media Ops approves
  DistributionActive --> Completed: posts live, digest sent, metrics pulled
  Declined --> [*]
  Completed --> [*]
```

## 2. Automations as settings

```mermaid
flowchart LR
  subgraph ADMIN["/admin › Automation"]
    R[Recipes: one per trigger<br/>ordered steps, on/off,<br/>requires approval, conditions by tier or market]
    T[Email templates<br/>with preview]
    D[Decline reasons]
    C[Channel settings:<br/>on/off, posting window,<br/>approval mode per tier]
    S[Schedule settings:<br/>digest every 14 days,<br/>audit Saturday morning]
    DRY[Dry run: what would<br/>this trigger do now?]
  end
  subgraph DB[Postgres]
    AR[(automation_recipes)]
    ET[(email_templates)]
    DR[(decline_reasons)]
    CS[(channel_settings)]
    SS[(schedule_settings)]
    REV[(automation_revisions:<br/>who changed what, when)]
  end
  subgraph CODE[Code: fixed step catalog, grows only by PR]
    CAT[send_email · render_variants · render_cover · render_carousel · render_story · render_reel ·<br/>write_captions · build_newsletter_block · post_meta · queue_digest · notify_admin · webhook_omnikom]
  end
  EV[Event: submission received, declined, accepted,<br/>invoice issued, payment marked, property published,<br/>asset approved, digest due]
  RUN[[Job runner: reads the recipe at trigger time]]
  JOBS[(jobs + assets)]

  R --> AR
  T --> ET
  D --> DR
  C --> CS
  S --> SS
  AR & ET & DR & CS & SS --> REV
  EV --> RUN
  AR --> RUN
  CAT --> RUN
  RUN --> JOBS
  DRY -.-> RUN
```

## 3. Roles

```mermaid
flowchart TB
  CE[chief_editor] --> a1[accept / decline] & a2[publish] & a3[edit automations] & a4[manage roles]
  ME[managing_editor] --> a1 & a2 & a5[write dossiers] & a6[issue invoices]
  VE[visual_editor] --> a5 & a7[media, sequences, variants]
  MO[media_ops] --> a8[approve generated assets] & a9[channel status, retries] & a3
  CO[commercial] --> a10[read queue, invoices, reports]
```
