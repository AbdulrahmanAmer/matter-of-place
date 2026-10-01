# Architecture diagrams

Pictures: [img/architecture-1.png](img/architecture-1.png) request paths, [img/architecture-2.png](img/architecture-2.png) data model v2,
[img/architecture-3.png](img/architecture-3.png) job lifecycle, [img/architecture-4.png](img/architecture-4.png) agents as staff, [img/architecture-5.png](img/architecture-5.png) caching.
Words: `../06-architecture/architecture.md`.

## 1. Request paths

```mermaid
flowchart LR
  V([Visitor]) --> E[Edge cache + Turnstile + rate-limit rule]
  E --> W[Cloudflare Worker]
  W --> P[Pages SSR]
  W --> PUB["/api/public/*"]
  W --> ADM["/api/admin/*"]
  W --> HK["/api/hooks/*"]
  ED([Editor or agent]) -->|session cookie or agent key| ADM
  GH[[GitHub Actions render workflow]] -->|HMAC callback| HK
  RS[Resend events] --> HK
  PUB --> SF[Server functions: parse → actor → role → transaction → audit → event]
  ADM --> SF
  HK --> SF
  SF --> DB[(Postgres)]
  SF --> R2[(R2)]
  DB --> EV[(events)] --> RE[Recipe engine] --> J[(jobs)] --> Q[[pgmq]] --> RUN[[Edge Function job runner]]
  RUN -->|heavy| GH
  RUN -->|light| STEPS[step catalog: send_email, write_captions, post_meta, post_x, post_linkedin, queue_digest, notify_admin, webhook_omnikom, bump_catalog_version, purge_cache]
```

## 2. Data model v2

```mermaid
erDiagram
  markets ||--o{ regions : has
  markets ||--o{ properties : desk
  regions ||--o{ properties : in
  representatives ||--o{ properties : represents
  properties ||--o{ property_media : gallery
  properties ||--o{ property_features : features
  properties ||--o{ property_related : related
  properties ||--o{ assets : generated
  properties ||--o{ campaigns : exposure
  properties ||--o{ inquiries : about
  submissions ||--o| properties : becomes
  submissions ||--o{ submission_media : photos
  submissions ||--o{ payments : invoiced
  submissions }o--|| decline_reasons : declined_with
  payments ||--o| campaigns : funds
  campaigns ||--o{ campaign_reports : reports
  assets ||--o{ social_posts : posted_as
  newsletter_issues ||--o{ assets : includes
  events ||--o{ jobs : creates
  automation_recipes ||--o{ jobs : via_step
  jobs ||--o| assets : produces
  user_roles ||--o{ agent_keys : keys
  user_roles ||--o{ audit_log : acted
  automation_recipes ||--o{ automation_revisions : history
  email_templates ||--o{ automation_revisions : history
  channel_settings ||--o{ automation_revisions : history
  schedule_settings ||--o{ automation_revisions : history
  subscribers }o--o{ markets : interested_in
  properties ||--o{ slug_history : renamed
  redirects
  subject_requests
  retention_policies

  submissions {
    uuid id PK
    text workflow_state
    uuid reviewed_by
    uuid decline_reason_id FK
    uuid accepted_by
    uuid activated_by
    uuid property_id FK
  }
  payments {
    uuid id PK
    uuid submission_id FK
    text product
    numeric amount
    text method
    text invoice_number
    text status
    uuid paid_marked_by
  }
  jobs {
    uuid id PK
    text type
    text idempotency_key
    text status
    int attempts
    bool heavy
    uuid recipe_id FK
    uuid event_id FK
  }
  assets {
    uuid id PK
    uuid property_id FK
    text kind
    jsonb files
    text status
    uuid approved_by
  }
  automation_recipes {
    uuid id PK
    text trigger
    bool enabled
    int version
    jsonb steps
  }
  user_roles {
    uuid user_id PK
    text role
    text actor_kind
  }
```

## 3. Job lifecycle

```mermaid
stateDiagram-v2
  [*] --> queued: recipe step enabled
  [*] --> waiting_approval: step requires approval
  waiting_approval --> queued: Media Ops or agent approves
  waiting_approval --> [*]: rejected
  queued --> running: runner pops (light) or dispatches (heavy)
  running --> done: step returns result
  running --> failed: error, attempts < max
  failed --> queued: run_after backoff
  running --> dead: attempts = max
  dead --> queued: retry button in /admin › Jobs
  done --> [*]
```

## 4. Agents as staff

```mermaid
flowchart LR
  H([Human editor: magic link]) --> S[Session cookie]
  A([AI agent: Claude session, routine, or headless worker]) --> K[Agent key: hashed, scoped, revocable]
  S --> R{Role check in the server function}
  K --> R
  R -->|chief_editor, managing_editor| D[Decide, accept, decline, publish]
  R -->|visual_editor| M[Dossier, media, sequences]
  R -->|media_ops| AP[Approve assets, channels, automations]
  R -->|commercial| RO[Read queue, invoices, reports]
  R -->|admin| T[Team, agent keys, settings]
  D & M & AP & RO & T --> AU[(audit_log: actor_id, actor_kind)]
  G[Guardrails: agents cannot touch roles, keys or settings; per-channel human approval; daily decision cap] -.-> K
```

## 5. Caching: what a visitor's request touches

```mermaid
flowchart LR
  V([Visitor]) --> B[Browser cache: files kept for a year, data kept 5 minutes]
  B -->|not found| EC[Edge cache in the Worker: finished pages and catalog data]
  EC -->|not found| M[Memory in the Worker: one snapshot per catalog version]
  M -->|new version or first visit| DB[(Database)]
  DB --> D1[State check: every 15 seconds]
  DB --> D2[Catalog snapshot: once per version]
  D1 --> M
  D2 --> M
  M --> EC
  EC --> V
  ED([Editor publishes]) --> BUMP[Catalog version goes up]
  BUMP --> DB
  BUMP --> NEW[Every cache key changes within 15 seconds, no purge needed]
  NEW --> EC
  DOWN{{Database down}} -.-> STALE[The last good copy is served]
  STALE -.-> V
  WARM[Warm page view: zero database calls] -.-> EC
```
