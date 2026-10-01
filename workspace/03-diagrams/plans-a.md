# Plans A diagrams (batch A, foundation and intake)

Words: `../05-plans/B1b.md`, `B2.md`, `B3.md`, `B3b.md`, `B4.md`. Pictures: `img/plans-a-1.png` to `-6.png`.
Diagrams 1 to 5 show step order per plan (solid arrows are the plan's own order, dashed arrows are dependencies on another plan). Diagram 6 is the public submission write path from B3.

## 1. B1b Repo and delivery, step order

```mermaid
flowchart TD
  s1["1. Account facts and plan check<br/>wrangler whoami, gh plan"]
  s2["2. wrangler.toml and Nitro merge<br/>inspect .output/server/wrangler.json"]
  s3["3. pipeline.ts, headers.ts, start.ts, robots.ts, _headers<br/>request id and security headers"]
  s4["4. Sentry envelope client and test route"]
  s5["5. ci.yml, PR template, pinned toolchain, Dependabot<br/>watched-fail: type error goes red"]
  s6["6. smoke.mjs, deploy.yml preview-db and preview<br/>pr-N worker and cleanup on close"]
  s7["7. deploy.yml production and dev jobs<br/>first deploy on workers.dev, matter-of-place-dev, rollback, CPU measure"]
  s8["8. backup.yml<br/>Part A: dev dump as encrypted workflow artifact today"]
  s9["9. Branch protection<br/>BLOCKED on free private repo, CI rule instead"]
  s10["10. Close-out<br/>README, .env.example, greps"]
  s11["11. Edge rules with cf-edge.mjs<br/>script and unit test today, live run BLOCKED on L1 domain attach"]
  s1 --> s2 --> s3 --> s4 --> s5 --> s6 --> s7 --> s8 --> s9 --> s10 --> s11
  a6["A6 Sentry project"] -.-> s4
  b2p["mop-prod exists, created at L1 step 1: prod db push and prod backup"] -.-> s7 & s8
  r2s["R2 switched on by the operator: backup copy to mop-backups"] -.-> s8
  a1["A1 Cloudflare account and token"] -.-> s6
  l1d["L1 domain attach"] -.-> s11
```

## 2. B2 Database, step order

```mermaid
flowchart TD
  t1["1. Supabase CLI, config.toml, scripts"]
  t2["2. Link mop-dev, config push, mop-prod BLOCKED until launch"]
  subgraph SCHEMA["Migrations, in file order"]
    t3["3. Extensions, enums, people, audit, role helpers, database test harness"]
    t4["4. Catalog tables and schema manifest test"]
    t5["5. Intake tables and decline_reasons"]
    t6["6. Analytics monthly partitions"]
    t7["7. Commercial tables, editorial gate, workflow.ts"]
    t8["8. Catalog version triggers and the two public reads"]
    t9["9. RLS, grants, storage bucket, role matrix test"]
  end
  t10["10. Settings defaults, gen types, domain rows, enum equality"]
  t11["11. Watched-fail of drift guard and G-004 sweep"]
  t12["12. Image library, then seed.ts reference and full, images skipped"]
  t13["13. variants CLI, fixtures and tests, R2 part BLOCKED until R2 is on"]
  t14["14. Close-out: db push check, dev seed, delete schema.sql, runbook"]
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
  b8["B8 step 2a adds the event row inside the write functions"] -.-> a7
  b5["B5 confirmation template, sent by the subscriber.created recipe"] -.-> a9
```

## 4. B3b Coming-soon mode, step order

```mermaid
flowchart TD
  c1["1. Design decisions and copy accepted"]
  c2["2. Strings, helpers, analytics names, flags.ts, consent.ts"]
  c3["3. Migration: production guard, set_environment, flags row, interest counts"]
  c4["4. Server flags.ts, pipeline wiring, visibility.ts"]
  c5["5. InterestForm, ComingSoon and consent notice with CSS"]
  c6["6. Route changes and market card badge"]
  c7["7. IllustrativeNotice and the preview path"]
  c8["8. Playwright coming-soon and consent specs"]
  c9["9. assert-coming-soon script and runbook"]
  c10["10. Close-out and deploy step"]
  c1 --> c2 --> c3 --> c4 --> c5 --> c6 --> c7 --> c8 --> c9 --> c10
  b3["B3 live catalog, contracts, env.ts, dev-vars.mjs"] -.-> c2
  b2["B2 settings, markets.coming_soon, test harness"] -.-> c3
  b4["B4 steps 1, 2 and 5: component project, watchfail, Playwright config"] -.-> c5 & c8
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
  b1b["B1b step 5: ci.yml exists"] -.-> d1 & d5 & d7
  b2a["B2 step 1: vitest projects, pg"] -.-> d1 & d5
  b2b["B2 step 9 and B3 steps 7 and 9"] -.-> d3
  b2["B2 step 7: workflow.ts"] -.-> d4
  b3["B3 and B3b landed"] -.-> d9
```

## 6. Public submission write path (POST /api/public/submissions)

Source: B3 invariant 17 (pipeline order), steps 2, 6 and 8, and rulings G20 and G49. The memory limit, Turnstile and Zod run before any database call; the database rate limit is the first database call; the event is written by the SQL function in the same transaction as the row (once B8 step 2a re-bodies it). The photographs never pass through the Worker.

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
  WK->>WK: request id, 64 KB cap, content type, honeypot, in-memory limit
  alt over the memory limit
    WK-->>BR: 429 rate_limited with Retry-After, no database call
  end
  WK->>TS: siteverify(token, ip)
  TS-->>WK: success true
  alt token missing or failed
    WK-->>BR: 403 forbidden, no database call
  end
  WK->>WK: Zod parse submissionSchema
  alt schema failure
    WK-->>BR: 422 validation with issues and requestId
  end
  WK->>PG: rpc rate_limit_check (ip and agent email buckets)
  PG-->>WK: allowed
  alt over the limit
    WK-->>BR: 429 rate_limited with Retry-After
  end
  WK->>PG: rpc create_submission (submissions, submission_media and, after B8 step 2a, the submission.received event in one transaction)
  PG-->>WK: id, received_at, media storage paths
  WK->>ST: createSignedUploadUrl per photograph
  ST-->>WK: signed URLs
  WK-->>BR: 201 Receipt and uploads[]
  BR->>ST: PUT each photograph to its signed URL
  Note over BR,ST: the Worker never proxies the binaries
  PG-)RN: event fan-out (after B8 and B8b) send_email received, notify_admin
  RN->>ST: reconcile system job every 15 minutes, reconcileUploads sniffs first bytes and hashes
  RN->>PG: mark_media_uploaded sets uploaded_at, mime, sha256 on submission_media
```
