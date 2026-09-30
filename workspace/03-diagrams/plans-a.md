# Plans A diagrams (batch A, foundation and intake)

Words: `../05-plans/B1b.md`, `B2.md`, `B3.md`, `B3b.md`, `B4.md`. Pictures: `img/plans-a-1.png` to `-6.png`.
Diagrams 1 to 5 show step order per plan (solid arrows are the plan's own order, dashed arrows are dependencies on another plan). Diagram 6 is the public submission write path from B3.

## 1. B1b Repo and delivery, step order

```mermaid
flowchart TD
  s1["1. Account facts and plan check<br/>wrangler whoami, gh plan"]
  s2["2. wrangler.toml and Nitro merge<br/>inspect .output/server/wrangler.json"]
  s3["3. headers.ts, start.ts, _headers<br/>request id and security headers"]
  s4["4. Sentry envelope client and test route"]
  s5["5. ci.yml and PR template<br/>watched-fail: type error goes red"]
  s6["6. deploy.yml preview job<br/>pr-N worker and cleanup on close"]
  s7["7. deploy.yml production job<br/>first deploy, rollback rehearsal, CPU measure"]
  s8["8. backup.yml and R2 bucket<br/>pg_dump to R2, restore listing"]
  s9["9. Branch protection<br/>BLOCKED on free private repo unless plan changes"]
  s10["10. Close-out<br/>README, .env.example, greps"]
  s1 --> s2 --> s3 --> s4 --> s5 --> s6 --> s7 --> s8 --> s9 --> s10
  a6["A6 Sentry project"] -.-> s4
  b2p["B2 step 2: mop-prod exists"] -.-> s8
  a1["A1 Cloudflare account and token"] -.-> s6
```

## 2. B2 Database, step order

```mermaid
flowchart TD
  t1["1. Supabase CLI, config.toml, scripts"]
  t2["2. Cloud projects mop-dev and mop-prod, link"]
  subgraph SCHEMA["Migrations, in file order"]
    t3["3. Extensions, enums, people, audit, role helpers"]
    t4["4. Catalog tables and schema manifest test"]
    t5["5. Intake tables and decline_reasons"]
    t6["6. Analytics monthly partitions"]
    t7["7. Commercial tables, editorial gate, workflow.ts"]
    t8["8. Catalog version triggers"]
    t9["9. RLS, grants, storage bucket, role matrix test"]
  end
  t10["10. Settings defaults, gen types, domain rows, enum equality"]
  t11["11. Watched-fail of drift guard and G-004 sweep"]
  t12["12. seed.ts reference and full"]
  t13["13. variants.ts, R2 buckets, seed with images"]
  t14["14. Remote apply, mark environment, delete schema.sql"]
  t1 --> t2 --> t3 --> t4 --> t5 --> t6 --> t7 --> t8 --> t9 --> t10 --> t11 --> t12 --> t13 --> t14
  b1b["B1b steps 1 to 3"] -.-> t1
  b8["B8, B8b, B9 to B11 create their own tables later"] -.-> t14
  style SCHEMA stroke-dasharray: 5 5
```

## 3. B3 API, step order

```mermaid
flowchart TD
  a1["1. Foundation libs and in-process fetch spike"]
  a2["2. public_write_functions migration and rate limits"]
  a3["3. Mappers, catalog service, cache, pipeline, six GET routes"]
  a4["4. Parity with bundled data"]
  a5["5. Contract edits, analytics allow-list"]
  a6["6. Turnstile server and client"]
  a7["7. POST inquiries"]
  a8["8. POST submissions, signed uploads, reconcile"]
  a9["9. POST subscribers, confirm, Resend hook"]
  a10["10. POST events"]
  a11["11. Search and concierge, shared pure logic"]
  a12["12. Flip VITE_API_BASE_URL on preview, api-smoke"]
  a13["13. Measure CPU and egress"]
  a1 --> a2 --> a3 --> a4 --> a5 --> a6 --> a7 --> a8 --> a9 --> a10 --> a11 --> a12 --> a13
  b1b["B1b start.ts and headers"] -.-> a1
  b2["B2 seed and types"] -.-> a3
  b8["B8 replaces emitEvent stub"] -.-> a7
  b5["B5 wires confirmation email"] -.-> a9
```

## 4. B3b Coming-soon mode, step order

```mermaid
flowchart TD
  c1["1. Design decisions and copy accepted"]
  c2["2. Strings, helpers, analytics names"]
  c3["3. Migration: production guard, open market, interest counts"]
  c4["4. visibility.ts and API tests"]
  c5["5. InterestForm and ComingSoon with CSS"]
  c6["6. Route changes and market card badge"]
  c7["7. IllustrativeNotice viewer statement"]
  c8["8. Playwright coming-soon project"]
  c9["9. assert-coming-soon script and runbook"]
  c10["10. Close-out and deploy step"]
  c1 --> c2 --> c3 --> c4 --> c5 --> c6 --> c7 --> c8 --> c9 --> c10
  b3["B3 steps 1 to 5"] -.-> c2
  b3b["B3 step 12"] -.-> c8
  b4["B4 Playwright config"] -.-> c8
  b1["B1b deploy.yml"] -.-> c10
```

## 5. B4 Tests, step order

```mermaid
flowchart TD
  d1["1. Vitest projects, scripts, setup"]
  d2["2. watchfail.mjs and ledger"]
  d3["3. builders and contracts tests"]
  d4["4. State machine, routes-covered, seo, analytics tests"]
  d5["5. Playwright config, route sweep, axe baseline"]
  d6["6. Forms and redirects specs"]
  d7["7. CI e2e job on built artifact, broken-form drill"]
  d8["8. CI db job with types drift guard"]
  d9["9. Live forms spec and e2e-live job"]
  d10["10. Measure minutes, preview overflow run, README"]
  d1 --> d2 --> d3 --> d4 --> d5 --> d6 --> d7 --> d8 --> d9 --> d10
  b1b["B1b step 5: ci.yml exists"] -.-> d7
  b2["B2 steps 7 and 10"] -.-> d4
  b3["B3 step 12 and B3b step 8"] -.-> d9
```

## 6. Public submission write path (POST /api/public/submissions)

Source: B3 route table, steps 2, 6 and 8. Rate limit and Turnstile run before validation, validation before the database, and the event is emitted after the row exists. The photographs never pass through the Worker.

```mermaid
sequenceDiagram
  autonumber
  participant BR as Browser
  participant TS as Cloudflare Turnstile
  participant WK as Worker public pipeline
  participant PG as Supabase Postgres
  participant ST as Supabase Storage
  participant RN as Job runner (B8)
  BR->>TS: execute widget for a token
  TS-->>BR: token
  BR->>WK: POST /api/public/submissions with x-turnstile-token
  WK->>WK: request id, 64 KB cap, content type check
  WK->>PG: rpc rate_limit_check (ip and agent email buckets)
  PG-->>WK: allowed
  alt over the limit
    WK-->>BR: 429 rate_limited with Retry-After
  end
  WK->>TS: siteverify(token, ip)
  TS-->>WK: success true
  alt token missing or failed
    WK-->>BR: 403 forbidden
  end
  WK->>WK: Zod parse submissionSchema
  alt schema failure
    WK-->>BR: 422 validation with issues and requestId
  end
  WK->>PG: rpc create_submission (submissions and submission_media in one transaction)
  PG-->>WK: id, received_at, media storage paths
  WK->>ST: createSignedUploadUrl per photograph
  ST-->>WK: signed URLs
  WK->>PG: emitEvent submission.received (stub logs now, events row after B8)
  WK-->>BR: 201 Receipt and uploads[]
  BR->>ST: PUT each photograph to its signed URL
  Note over BR,ST: the Worker never proxies the binaries
  PG-)RN: event fan-out (after B8 and B8b) send_email received, notify_admin
  RN->>ST: reconcile uploads, sniff first bytes, hash
  RN->>PG: set uploaded_at, mime, sha256 on submission_media
```
