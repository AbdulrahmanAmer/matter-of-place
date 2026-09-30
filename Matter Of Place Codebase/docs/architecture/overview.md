# Architecture overview

Matter of Place is a server-rendered React site (TanStack Start on Vite) with a thin, typed service boundary. Today every service is implemented locally from bundled content; setting one environment variable switches the same interfaces to an HTTP API. The intended production shape is a Cloudflare Worker for the site and API, an edge cache in front of all catalog reads, and Supabase Postgres as the system of record.

## System context

```mermaid
flowchart LR
  visitor([Visitor browser]) -->|HTML, assets, JSON| edge

  subgraph cloudflare [Cloudflare]
    edge[Edge cache and static assets]
    site[Site Worker: SSR and routes]
    api[API Worker: /api/*]
    kv[(Cache: Cache API or KV)]
    edge --> site
    edge --> api
    api <--> kv
  end

  subgraph supabase [Supabase, free tier]
    db[(Postgres)]
    storage[(Storage bucket: submissions)]
    auth[Auth: editors only]
  end

  api -->|service role, server side only| db
  api -->|signed upload URLs| storage
  visitor -->|PUT photograph| storage
  editor([Editor]) -->|Supabase Studio or a small admin app| auth --> db
  api -.->|handoff webhook, later| omnikom[Omnikom]
```

The browser never talks to Supabase directly. Publishable keys are therefore not shipped in the frontend, RLS can stay strict, and the API is free to cache aggressively.

## Frontend layers

```mermaid
flowchart TB
  routes[routes/*  one file per URL] --> queries[lib/queries.ts  TanStack Query options]
  routes --> components[components/*]
  components --> hooks[hooks/*]
  components --> services
  queries --> services[services/index.ts  the boundary]
  services -->|VITE_API_BASE_URL unset| local[services/local  bundled data, in-memory outbox]
  services -->|VITE_API_BASE_URL set| http[services/http  JSON client]
  local --> data[data/*  illustrative content]
  http --> api[(Matter of Place API)]
  data --> domain[domain/*  types and Zod contracts]
  http --> domain
  api -. implements .-> domain
```

Rules that keep the layers honest:

- Routes and components import `services`, never `data/*` directly. The only exceptions are the pricing schedule and FAQ copy, which are static marketing content.
- `domain/contracts.ts` is the single source of write-side validation. The frontend validates before sending; the API imports the same file and validates again.
- Field names in `domain/property.ts`, `domain/market.ts` and `domain/story.ts` equal the JSON the API returns and the columns in `docs/database/schema.sql`, so the HTTP adapter has no mapping layer.

## Read path

```mermaid
sequenceDiagram
  participant B as Browser
  participant E as Edge cache
  participant S as Site Worker (SSR)
  participant A as API Worker
  participant D as Postgres

  B->>E: GET /property/tiburon-waterline
  alt HTML cached (s-maxage 300, stale-while-revalidate 86400)
    E-->>B: HTML
  else miss
    E->>S: render
    S->>A: GET /api/properties/tiburon-waterline
    alt JSON cached
      A-->>S: JSON from Cache API
    else miss
      A->>D: select dossier
      D-->>A: row
      A-->>S: JSON (cached with a tag)
    end
    S-->>E: HTML
    E-->>B: HTML
  end
  B->>B: hydrate; TanStack Query reuses loader data (staleTime 5 min)
```

## Write path (inquiry, subscriber)

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API Worker
  participant D as Postgres

  B->>B: inquirySchema.parse(form)
  B->>A: POST /api/inquiries
  A->>A: inquirySchema.parse(body), rate limit by IP
  A->>D: insert inquiries
  D-->>A: id, received_at
  A-->>B: 201 Receipt
  B->>B: SentNotice, track("showing_request")
```

## Write path (submission with photography)

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API Worker
  participant D as Postgres
  participant S as Supabase Storage

  B->>A: POST /api/submissions (fields plus media metadata)
  A->>D: insert submissions, submission_media (status pending)
  A->>S: create signed upload URL per media row
  A-->>B: 201 { id, receivedAt, uploads[] }
  loop each selected file
    B->>S: PUT signed URL (binary)
  end
  Note over S,D: Storage webhook or a scheduled check marks media rows uploaded
```

## Analytics

`lib/analytics.ts` pushes every event to `window.dataLayer` (tag manager) and, when an API base URL is configured, beacons the same envelope to `POST /api/events`. Events are typed; the API stores them in `analytics_events` for attribution reports.

## What is deliberately not here

- No client-side global state library. Server state is TanStack Query; UI state is local component state.
- No CSS framework. Plain CSS with design tokens (`src/styles/`).
- No authentication in the public site. Editorial work happens in Supabase Studio or a separate admin surface protected by Supabase Auth; see `docs/database/schema.md`.
