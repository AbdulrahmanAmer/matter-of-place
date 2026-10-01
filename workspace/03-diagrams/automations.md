# Automation maps

Pictures: [img/automations-1.png](img/automations-1.png) every trigger and the steps it fires by default,
[img/automations-2.png](img/automations-2.png) the clocks, [img/automations-3.png](img/automations-3.png) who can change what.
Related: admin-os-2 (automations as settings), architecture-3 (job lifecycle), plans-b-3 (recipe engine), plans-c-1 (publish pipeline), big-diagram-3 (audit loop).
All of this is data in the database, editable from Admin › Automation; a step type is code, a recipe is a setting.

## 1. Every trigger and its default recipe (18 events, 17 step types)

Source: the seed list of `05-plans/B8b.md` (Data changes, `<ts>_automation_seed.sql`) and architecture 5. One recipe row per event;
an event with no default step still has its row (enabled, empty, editable). `render_og_static` is the seventeenth step type and is
in no recipe: it runs only on a manual trigger.

```mermaid
flowchart LR
  subgraph INTAKE[Intake and privacy events]
    E1[submission.received] --> S1[send_email received] & S2[notify_admin]
    E2[submission.declined] --> S3[send_email declined + reason]
    E3[submission.accepted] --> S4[send_email accepted]
    E4[submission.awaiting_assets] --> S5[send_email awaiting_assets + note]
    E13[inquiry.received] --> S6[send_email inquiry_ack] & S7[notify_admin] & S8[webhook_omnikom]
    E14[subscriber.created] --> S9[send_email interest_confirm, one step, swapped to newsletter_confirm when no market was chosen]
    E15[subscriber.confirmed] --> S10[no default step]
    E18[subject_request.received] --> S15[send_email subject_ack to the requester] & S16[notify_admin]
  end
  subgraph MONEY[Money events]
    E5[invoice.issued] --> S11[send_email invoice, attach invoice PDF]
    E6[payment.marked] --> S12[notify_admin]
    E7[submission.activated] --> S13[no default step]
    E16[invoice.voided] --> S14[notify_admin]
  end
  subgraph PUBLISH[Publishing events]
    E8[property.published] --> P1[bump_catalog_version, also opens a coming-soon market] & P0[purge_cache] & P2[render_variants] & P3[render_cover] & P4[render_carousel] & P5[render_story] & P6[write_captions Haiku] & P7[build_newsletter_block, light] & P8[render_reel, Campaign only] & P9[send_email standalone, Campaign only, needs approval]
    E9[property.unpublished] --> P11[bump_catalog_version] & P12[purge_cache]
    TD[On a takedown, B7's unpublish_property cancels queued post jobs itself, not a recipe step] -.-> E9
    E10[asset.approved] --> C1[post_meta: Instagram now, Facebook when enabled] & CX[post_x] & CL[post_linkedin] & C2[queue_digest mode add, newsletter_block only]
    C1 & CX & CL -.-> CN[kinds cover, carousel, story, reel, each posts only if its channel is enabled, in its posting window, approval mode per tier]
    E11[asset.rejected] --> C3[no default step]
  end
  subgraph CLOCKS[Clock and system events]
    E12[digest.due every 14 days] --> D1[queue_digest mode assemble: Place Notes issue draft] & D2[notify_admin approve]
    E17[health.failed from the daily health job] --> H1[notify_admin]
  end
  MAN[render_og_static: manual trigger only, in no recipe]
  APPR{Media Ops or agent approves} -.-> E10
  P2 & P3 & P4 & P5 & P6 & P7 & P8 -.-> APPR
```

## 2. The clocks

Fixed pg_cron jobs are architecture 5 item 8. Every other clock is one of the eight `schedule_settings` rows of ruling G9, each
pausable on screen 20; cron values are UTC. `prune`, `reconcile`, `digest`, `kpi_weekly` and `newsletter_hygiene` are run by
`runDueSchedules` on each runner tick; `keepwarm`, `audit` and `backup` are external clocks whose row must equal the clock that fires.

```mermaid
flowchart TB
  subgraph PGC[Fixed pg_cron jobs, created by migrations]
    M[job-runner every minute] --> R[job runner: fan out pending events, run due schedule rows, pop light jobs, dispatch heavy to GitHub Actions]
    AP[analytics-partitions monthly] --> APJ[B2 partition function]
    HE[health daily 13:00] --> HEJ[health job: queues, channels, quotas, bounces, uptime, emits health.failed]
    RT[retention daily] --> RTJ[retention job: every row of retention_policies]
    TK[meta_token_refresh daily] --> TKJ[Meta token refresh, alert 7 days before expiry]
  end
  subgraph SSR[schedule_settings: the eight keys of G9]
    DG[digest: every 14 days, Tuesday 14:00, seeded off]
    PRU[prune: daily 03:30]
    RC[reconcile: every 15 minutes]
    KPI[kpi_weekly: Saturday 15:00]
    NH[newsletter_hygiene: daily 16:00]
    KW[keepwarm: every 10 minutes]
    AU[audit: Saturday 12:00, seeded off]
    BK[backup: daily 03:17, seeded off]
  end
  R --> DG & PRU & RC & KPI & NH
  DG --> DGE[digest.due → Place Notes draft → approve → send]
  PRU --> PRJ[prune: done jobs after 30 days, rate_limits, webhook_receipts]
  RC --> RCJ[one reconcile job: uploads, social metrics once a day, newsletter metrics]
  KPI --> KPJ[weekly KPI email]
  NH --> NHJ[newsletter hygiene: bounces, complaints, re-permission]
  WCT[Worker cron trigger in wrangler.toml] --> KW --> KWJ[keep-warm: one state RPC, so the free Supabase project never pauses]
  RTN[Saturday cloud routine, B14] --> AU --> AUJ[mop-auditor: measure, report, patch PR]
  BY[backup.yml schedule in GitHub Actions] --> BK --> BKJ[pg_dump encrypted, workflow artifact, R2 copy once R2 is on]
  WIN[posting windows per channel] --> PM[post_meta, post_x and post_linkedin wait for the window before publishing]
```

## 3. Who can change what

```mermaid
flowchart LR
  CEO[admin + chief_editor: the CEO] --> A[recipes, templates, reasons, channel and schedule settings, team, site settings]
  MO[media_ops] --> B[recipes, templates, channel and schedule settings, asset approvals]
  ME[managing_editor] --> C[decline reasons, invoices, decisions, publishing]
  AG[AI agent with a key] --> D[everything in its role except team, keys, settings and flags, mark paid, waive, void, activate, and switching a channel to automatic]
  CTO[CTO session on request] --> E[any automation via the same admin API, no deploy]
  A & B & C & D & E --> REV[(automation_revisions: who, what, when, restore)]
```
