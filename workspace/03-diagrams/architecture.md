# Architecture diagrams

Pictures: [img/architecture-1.png](img/architecture-1.png) request paths, [img/architecture-2.png](img/architecture-2.png) data model v2,
[img/architecture-3.png](img/architecture-3.png) job lifecycle, [img/architecture-4.png](img/architecture-4.png) agents as staff, [img/architecture-5.png](img/architecture-5.png) caching.
Words: `../06-architecture/architecture.md`.

## 1. Request paths

```mermaid
flowchart LR
  V([Visitor]) --> E[Cloudflare zone: WAF + rate-limit rule]
  E --> W[Cloudflare Worker: Cache API lookup first, Turnstile verified on form writes]
  CR[Worker cron trigger every 10 minutes] -->|keep-warm| W
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
  SF --> ST[(Supabase Storage, H33: private submissions and documents, public media served at /media/key)]
  DB --> EV[(events, written in the same transaction)] --> RE[Recipe engine: fanoutEvent after commit, runner sweep] --> J[(jobs)] --> Q[[pgmq]] --> RUN[[Edge Function job runner, pg_cron every minute]]
  RUN -->|"heavy: render_variants, render_cover, render_carousel, render_story, render_reel, render_og_static"| GH
  RUN -->|light| STEPS[light steps: send_email, notify_admin, build_newsletter_block, post_meta, post_x, post_linkedin, queue_digest, webhook_omnikom, bump_catalog_version, purge_cache]
  J -->|local, H34| CAPR[[Caption runner on the operator's laptop: write_captions through the Claude CLI]]
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
  decline_reasons ||--o{ automation_revisions : history
  jobs ||--o{ job_events : timeline
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
    text invoice_file_key "PDF path in the private bucket documents, H33"
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
    uuid user_id FK "unique with role"
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
  waiting_approval --> cancelled: cancel
  queued --> cancelled: cancel, or a takedown cancels queued posts
  failed --> cancelled: cancel
  queued --> running: runner pops (light) or dispatches (heavy)
  running --> done: step returns result
  running --> queued: retry_at, waits for a prerequisite, no attempt used
  running --> failed: error, attempts < max
  failed --> queued: run_after backoff
  running --> dead: attempts = max
  dead --> queued: retry button in /admin › Jobs
  failed --> queued: retry button
  done --> [*]
  cancelled --> [*]
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
  R -->|admin| T[Team, agent keys, settings, invoices, void]
  D & M & AP & RO & T --> AU[(audit_log: actor_id, actor_kind)]
  G[Guardrails: agents cannot touch roles, keys or settings, 403 human_only on mark paid, waive, void, activate and on switching a channel to automatic, per-channel human approval, daily decision cap] -.-> K
```

## 5. Caching: what a visitor's request touches

```mermaid
flowchart LR
  V([Visitor]) --> B[Browser: fingerprinted files a year, immutable, HTML max-age=0 must-revalidate, catalog JSON 60 seconds, TanStack Query 5 minutes]
  B -->|not found| EC[Edge cache, Cache API in the Worker: finished pages and catalog JSON, s-maxage=300, stale-while-revalidate=86400, key release, catalog version, kind, path]
  EC -->|not found| M[Memory in the Worker: public state and one catalog snapshot per version]
  M -->|new version or first visit| DB[(Database)]
  DB --> D1[State check: one RPC, at most every 15 seconds per isolate]
  DB --> D2[Catalog snapshot: one RPC, once per version]
  D1 --> M
  D2 --> M
  M --> EC
  EC --> V
  ED([Publish, unpublish, edit, or a write to public settings, markets.coming_soon, redirects, slug_history]) --> BUMP[Catalog version goes up, by trigger]
  BUMP --> DB
  BUMP --> NEW[Every cache key changes within 15 seconds, no purge needed]
  NEW --> EC
  DOWN{{Database down or slower than 2 seconds}} -.-> STALE[The last good copy is served, x-mop-cache stale]
  STALE -.-> V
  WARM[Warm page view: zero database calls] -.-> EC
  KW[Keep-warm every 10 minutes: one state RPC, keeps the free database awake] -.-> D1
  MEDIA[Photographs: Storage bucket media at /media/key, content-hashed keys, immutable, H33] -.-> B
```
