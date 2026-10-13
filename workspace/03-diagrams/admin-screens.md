# Admin platform diagrams

Pictures: [img/admin-screens-1.png](img/admin-screens-1.png) navigation map, [img/admin-screens-2.png](img/admin-screens-2.png)
decide-and-invoice flow, [img/admin-screens-3.png](img/admin-screens-3.png) publish-to-channels flow.
Words: `../07-admin-platform/admin-screens.md`.

## 1. Navigation map (30 screens, as in `app/src/admin/nav.ts`, 2026-10-13)

```mermaid
flowchart LR
  SI[Sign in: the only screen without a session; the Worker checks the session before any other] --> OV[Overview]
  OV --- SR[Search everything, in the top bar]
  subgraph TEAM[The AI company]
    OF[Office: Matter and the colleagues, side chat]
    AP[Approvals: a person decides]
  end
  subgraph WORK[Work]
    RQ[Requests] --> RD[Request]
    PP[People] --> PD[Person]
    PR[Properties] --> PE[Property]
    PE --- PH[Photographs tab] & VI[Visuals tab]
    IN[Inquiries]
  end
  subgraph DIST[Distribution]
    SP[Social posts]
    NL[Place Notes]
  end
  subgraph MONEY[Money]
    IV[Invoices] --> ID[Invoice]
    IV --> NI[New invoice]
    RP[Reports]
  end
  subgraph EDIT[Editorial]
    ST[Stories]
    MK[Markets]
  end
  subgraph AUTO[Automation]
    FL[Flows + dry run + Ask Matter]
    EM[Emails]
    DR[Decline reasons]
    HI[History]
  end
  subgraph SYS[System]
    BU[Business]
    CS[Channels and schedules]
    TM[Team and access]
    JB[Jobs]
    AL[Activity log]
  end
  OV --> TEAM & WORK & DIST & MONEY & EDIT & AUTO & SYS
  RD -->|accept| ID
  RD -->|open person| PD
  ID -->|activate| PE
  PE -->|publish| SP & NL
  FL -->|Ask Matter| AP
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
  Note over E,M: Accept is the same shape, then Issue invoice → invoice_pdf job (PDF to the private Storage bucket documents, H33) and send_email invoice → Mark paid → Activate → Scheduled
```

## 3. Publish to channels (screens 8, 10, 12, 13)

```mermaid
flowchart TB
  PUB[Publish button: checklist green] --> TX[tx: editorial_state=published, catalog_version+1, audit, event property.published]
  TX --> REC[Recipe property.published]
  REC --> J1[bump_catalog_version, opens a coming-soon market, + purge_cache: light]
  REC --> J2[render_variants: heavy → Actions]
  REC --> J3[render_cover, carousel, story: heavy]
  REC --> J4[write_captions: class local, Haiku through the laptop caption runner, H34]
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
