# Automation maps

Pictures: [img/automations-1.png](img/automations-1.png) every trigger and the steps it fires by default,
[img/automations-2.png](img/automations-2.png) the clocks, [img/automations-3.png](img/automations-3.png) who can change what.
Related: admin-os-2 (automations as settings), architecture-3 (job lifecycle), plans-b-3 (recipe engine), plans-c-1 (publish pipeline), big-diagram-3 (audit loop).
All of this is data in the database, editable from Admin › Automation; a step type is code, a recipe is a setting.

## 1. Every trigger and its default recipe (17 events, 14 step types)

```mermaid
flowchart LR
  subgraph INTAKE[Intake events]
    E1[submission.received] --> S1[send_email received] & S2[notify_admin]
    E2[submission.declined] --> S3[send_email declined + reason]
    E3[submission.accepted] --> S4[send_email accepted + products]
    E4[submission.awaiting_assets] --> S5[send_email awaiting assets]
    E13[inquiry.received] --> S6[send_email acknowledgement] & S7[notify_admin] & S8[webhook_omnikom]
    E14[subscriber.created] --> S9[send_email confirm, double opt-in]
    E15[subscriber.confirmed] --> S10[create Resend contact, market audiences]
  end
  subgraph MONEY[Money events]
    E5[invoice.issued] --> S11[send_email invoice PDF]
    E6[payment.marked] --> S12[notify_admin]
    E7[submission.activated] --> S13[create property draft if missing]
    E16[invoice.voided] --> S14[notify_admin]
  end
  subgraph PUBLISH[Publishing events]
    E8[property.published] --> P1[bump_catalog_version + purge_cache] & P2[render_variants] & P3[render_cover] & P4[render_carousel] & P5[render_story] & P6[write_captions Haiku] & P7[build_newsletter_block] & P8[render_reel, Campaign only] & P9[send_email standalone, Campaign only, needs approval] & P10[open market if coming_soon]
    E9[property.unpublished] --> P11[bump_catalog_version + purge_cache] & P12[withdraw scheduled posts]
    E10[asset.approved] --> C1[post_meta per enabled channel, in posting window, approval mode per tier] & C2[queue_digest]
    E11[asset.rejected] --> C3[notify_admin]
  end
  subgraph CLOCKS[Clock events]
    E12[digest.due every 14 days] --> D1[assemble Place Notes issue draft] & D2[notify_admin approve]
    E17[health.failed daily] --> H1[send_email admin alert]
  end
  APPR{Media Ops or agent approves} -.-> E10
  P2 & P3 & P4 & P5 & P6 & P7 & P8 -.-> APPR
```

## 2. The clocks

```mermaid
flowchart TB
  M[pg_cron every minute] --> R[job runner: pop light jobs, dispatch heavy to GitHub Actions]
  D14[every 14 days] --> DG[digest.due → Place Notes draft → approve → send]
  SAT[Saturday morning, cloud routine] --> AU[mop-auditor: measure, report, patch PR]
  DAY[daily] --> HE[health job: queues, channels, quotas, Resend bounces, uptime] & PR[retention: analytics 13 months, declined photos 90 days, inquiries anonymised 24 months, done jobs 30 days] & BK[backup: pg_dump to R2, 30 days kept] & TK[meta token refresh, alert 7 days before expiry]
  H6[every 6 hours] --> RC[reconcile: uploads marked, post metrics pulled, tokens checked]
  D3[every 3 days] --> KW[keep-warm read so the free Supabase project never pauses]
  WIN[posting windows per channel] --> PM[post_meta waits for the window before publishing]
```

## 3. Who can change what

```mermaid
flowchart LR
  CEO[admin + chief_editor: the CEO] --> A[recipes, templates, reasons, channel and schedule settings, team, site settings]
  MO[media_ops] --> B[recipes, templates, channel and schedule settings, asset approvals]
  ME[managing_editor] --> C[decline reasons, invoices, decisions, publishing]
  AG[AI agent with a key] --> D[everything in its role except team, site settings, marking paid, and switching a channel to automatic]
  CTO[CTO session on request] --> E[any automation via the same admin API, no deploy]
  A & B & C & D & E --> REV[(automation_revisions: who, what, when, restore)]
```
