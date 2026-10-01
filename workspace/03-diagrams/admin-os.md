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
  InvoiceIssued --> InvoiceIssued: void, then issue corrected invoice
  InvoiceIssued --> Scheduled: Mark paid or waive + activate agent
  Scheduled --> AgentReview: optional signed preview link to the agent (property state agent_review)
  AgentReview --> Scheduled: agent approves or edits requested
  Scheduled --> Published: editor writes dossier, Publish
  Published --> TakenDown: takedown with reason, 410 Gone, queued post jobs cancelled, live posts withdrawn by hand
  Published --> AssetsPending: recipe runs: variants, cover, carousel, story, newsletter block, captions
  AssetsPending --> DistributionActive: Media Ops approves (no plan sets this state yet)
  DistributionActive --> Completed: posts live, digest sent, metrics pulled (no plan sets this state yet)
  Declined --> [*]
  Completed --> [*]
```

## 2. Automations as settings

```mermaid
flowchart LR
  subgraph ADMIN["/admin › Automation"]
    R[Recipes: one per trigger<br/>ordered steps, on/off,<br/>requires approval, conditions by tier, market or kind]
    T[Email templates<br/>with preview]
    D[Decline reasons]
    C[Channel settings:<br/>on/off, posting window,<br/>approval mode per tier]
    S[Schedule settings, eight clocks:<br/>digest, audit, keepwarm, prune, reconcile,<br/>backup, kpi_weekly, newsletter_hygiene]
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
    CAT[17 step types: send_email · render_variants · render_cover · render_carousel · render_story · render_reel ·<br/>write_captions · build_newsletter_block · post_meta · post_x · post_linkedin · queue_digest · notify_admin ·<br/>webhook_omnikom · bump_catalog_version · purge_cache · render_og_static, manual only]
  end
  EV[Event: one of 18 types, from submission.received<br/>to health.failed and subject_request.received]
  RUN[[Fan-out and job runner: read the recipe at trigger time]]
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
  CE[chief_editor] --> a1[accept / decline] & a2[publish] & a3[edit automations] & a5 & a8
  ME[managing_editor] --> a1 & a2 & a5[write dossiers] & a6[issue invoices, mark paid, activate]
  VE[visual_editor] --> a5 & a7[media, sequences, variants]
  MO[media_ops] --> a8[approve generated assets] & a9[channel status, retries] & a3
  CO[commercial] --> a10[read queue, invoices, reports]
  AD[admin, the CEO with chief_editor] --> a4[manage team, roles, agent keys, settings] & a6 & a11[void invoices] & a3
```
