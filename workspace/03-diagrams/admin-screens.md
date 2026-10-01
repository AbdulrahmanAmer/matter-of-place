# Admin platform diagrams

Pictures: [img/admin-screens-1.png](img/admin-screens-1.png) navigation map, [img/admin-screens-2.png](img/admin-screens-2.png)
decide-and-invoice flow, [img/admin-screens-3.png](img/admin-screens-3.png) publish-to-channels flow.
Words: `../07-admin-platform/admin-screens.md`.

## 1. Navigation map (25 screens)

```mermaid
flowchart LR
  SI[1 Sign in] --> DB[2 Dashboard]
  subgraph WORK[Work]
    RQ[3 Requests] --> RD[4 Request detail]
    PR[7 Properties] --> PE[8 Property editor]
    ME[9 Media]
    AS[10 Assets]
    IN[11 Inquiries]
  end
  subgraph DIST[Distribution]
    CH[12 Channels]
    NL[13 Newsletter]
  end
  subgraph MONEY[Money]
    IV[5 Invoices] --> ID[6 Invoice detail]
    RP[22 Reports]
  end
  subgraph EDIT[Editorial]
    ST[14 Stories]
    MK[15 Markets: coming-soon toggles]
  end
  subgraph AUTO[Automation]
    RC[17 Recipes + dry run]
    ET[18 Email templates]
    DR[19 Decline reasons]
    CS[20 Channels and schedules]
    RV[21 Revisions]
  end
  subgraph SYS[System]
    JB[16 Jobs]
    TM[23 Team: humans and agents]
    SE[24 Settings]
    AU[25 Audit log]
  end
  DB --> WORK & DIST & MONEY & EDIT & AUTO & SYS
  RD -->|accept| ID
  ID -->|activate| PE
  PE -->|publish| AS
  AS -->|approve| CH & NL
```

## 2. Decide and invoice (screens 4 and 6)

```mermaid
sequenceDiagram
  participant E as Editor or agent
  participant U as /admin screen
  participant F as Server function
  participant D as Postgres
  participant R as Recipe engine
  participant M as Email job

  E->>U: open request, click Decline, pick reason
  U->>U: preview email from template + reason paragraph
  E->>U: Send
  U->>F: submissions.decline(id, reason_id, note)
  F->>F: actor + role check (chief_editor, managing_editor)
  F->>D: tx: state=Declined, reviewed_by, audit_log, events(submission.declined)
  D->>R: event
  R->>D: jobs(send_email declined)
  D-->>U: job id, JobWatcher shows queued → done
  M-->>E: email delivered event via Resend webhook → timeline
  Note over E,M: Accept is the same shape, then Issue invoice → invoice_pdf job (PDF to the private invoices bucket, not R2) and send_email invoice → Mark paid → Activate → Scheduled
```

## 3. Publish to channels (screens 8, 10, 12, 13)

```mermaid
flowchart TB
  PUB[Publish button: checklist green] --> TX[tx: editorial_state=published, catalog_version+1, audit, event property.published]
  TX --> REC[Recipe property.published]
  REC --> J1[bump_catalog_version, opens a coming-soon market, + purge_cache: light]
  REC --> J2[render_variants: heavy → Actions]
  REC --> J3[render_cover, carousel, story: heavy]
  REC --> J4[write_captions: light, Haiku]
  REC --> J5[build_newsletter_block: light]
  REC --> J6[render_reel: heavy, Campaign tier only]
  REC --> J7[send_email standalone: Campaign tier only, waits for approval]
  J2 & J3 & J4 & J5 & J6 --> AS[Assets screen: pending cards]
  AS -->|approve| EV2[event asset.approved]
  EV2 --> PM[post_meta, post_x, post_linkedin for cover, carousel, story, reel: each per enabled channel, inside posting window, approval mode per tier]
  EV2 --> QD[queue_digest mode add for a newsletter block → next Place Notes issue draft]
  PM --> CH[Channels screen: scheduled → posted, metrics]
  QD --> NL[Newsletter screen: issue draft → approve → send]
```
