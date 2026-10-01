# Plans C diagrams (batch C, content, growth, hardening, launch)

Words: `../05-plans/B9.md`, `B10.md`, `B11.md`, `B12.md`, `B13.md`, `B14.md`, `B15.md`, `H1.md`, `L1.md`. Pictures: `img/plans-c-1.png`, `-2.png`, `-3.png`.

## 1. From publish to render, approval, post and digest

Exact step names come from the catalog in architecture 5. Heavy steps run in GitHub Actions and return through the signed callback,
light steps run in the Edge Function job runner. Approval is a human (S23) until the automatic path opens for Feature tier after
`auto_after`. `queue_digest` has two modes (G18, B11): `add` on `asset.approved`, `assemble` on `digest.due`. R2 is off until the
operator turns it on (E8): heavy renders and real posts wait for it (`r2_unavailable`).

```mermaid
flowchart TD
  PUB["Editor publishes property, screen 8"] --> EV1["event property.published"]
  EV1 --> REC1{"Recipe property.published"}

  subgraph LIGHT["Light steps, Edge Function"]
    BCV["bump_catalog_version"]
    PC["purge_cache"]
    WC["write_captions, Haiku plus voice lint"]
    NB["build_newsletter_block"]
    SE["send_email standalone, requires_approval, Campaign only"]
  end

  subgraph HEAVY["Heavy steps, GitHub Actions render.yml"]
    RV["render_variants"]
    RCO["render_cover 1200x630"]
    RCA["render_carousel 1080x1350, 6 to 8 slides"]
    RST["render_story 1080x1920"]
    RRE["render_reel 1080x1920, Campaign only"]
  end

  REC1 --> BCV
  REC1 --> PC
  REC1 --> RV
  REC1 --> RCO
  REC1 --> RCA
  REC1 --> RST
  REC1 --> WC
  REC1 --> NB
  REC1 --> RRE
  REC1 --> SE
  style LIGHT stroke-dasharray: 5 5
  style HEAVY stroke-dasharray: 5 5

  BCV -.->|"market opened"| MON["market_open_notice system job, one mail to interest-only signups"]
  RV --> CB["Signed callback hooks render callback"]
  RCO --> CB
  RCA --> CB
  RST --> CB
  RRE --> CB
  CB --> PMV["property_media: stripped original and variants in R2"]
  CB --> AS["assets rows, status pending, files in R2"]
  WC --> AS
  NB --> AS

  AS --> MODE{"approval_mode for the tier"}
  MODE -->|"manual"| SCR["Assets screen 10, media_ops or chief_editor reviews"]
  MODE -->|"auto and now after auto_after"| AUTO["auto_approve_asset, null actor, audited as system"]
  SCR -->|"reject with note"| RJ["event asset.rejected, no default step"]
  RJ -.->|"Re-render button, revision plus 1"| RCO
  SCR -->|"approve"| EV2["event asset.approved"]
  AUTO --> EV2
  EV2 --> REC2{"Recipe asset.approved"}

  REC2 --> PM["post_meta per channel_settings: Instagram, Facebook when enabled"]
  REC2 --> PX["post_x per channel_settings"]
  REC2 --> PL["post_linkedin per channel_settings"]
  REC2 --> QD1["queue_digest mode add, newsletter_block only"]

  PM --> WIN{"Inside posting window and daily cap?"}
  WIN -->|"no"| RA["retry_at next window slot"]
  RA -.-> PM
  PX --> WIN
  PL --> WIN
  WIN -->|"yes, Instagram"| GRAPH["Graph API container then publish"]
  WIN -->|"yes, X"| XAPI["X API media upload, then post with cover, short caption, link"]
  WIN -->|"yes, LinkedIn"| LAPI["LinkedIn API image upload, then organisation post with editorial caption"]
  WIN -->|"channel disabled"| SKD["skipped_disabled, nothing written"]
  WIN -->|"R2 off"| R2W["retry_at plus 24 hours, r2_unavailable, no attempt used"]
  GRAPH --> SP["social_posts posted, permalink, remote_id"]
  XAPI --> SP
  LAPI --> SP
  SP --> CH["Channels screen 12 and reconcile metrics pull"]

  QD1 --> DRAFT["newsletter_issues draft, one open draft only"]
  CLK["schedule_settings digest, every 14 days"] --> EV3["event digest.due"]
  EV3 --> QD2["queue_digest mode assemble"]
  QD2 --> NA["notify_admin"]
  DRAFT --> QD2
  NA --> NL["Newsletter screen 13, human approves the issue"]
  NL --> SND["newsletter_send system job, footer and quota gates"]
  SND --> BC["Resend Broadcast to confirmed subscribers"]
  BC --> MET["Resend webhook events into newsletter_issues.metrics"]
  SE -.->|"standalone asset approval releases the job"| BCM["Broadcast to confirmed Place Notes subscribers of that market"]
```

## 2. The Meta publish call for an approved carousel

One `post_meta` job, one Instagram carousel. Facebook runs the same job with its own calls (photo post for the cover, photo story) once its channel row is enabled; at launch it is a disabled block. X and LinkedIn have their own steps, `post_x` and `post_linkedin`, shown in the first diagram.
Every call carries `appsecret_proof`. Meta downloads the images itself from the public R2 host, so while R2 is off the step
returns `retry_at` 24 hours later with `r2_unavailable` before any platform call.

```mermaid
sequenceDiagram
  autonumber
  participant ME as Media ops on screen 10
  participant WK as Worker admin route
  participant PG as Postgres
  participant RN as Job runner Edge Function
  participant R2 as R2 public media host
  participant GR as Meta Graph API
  participant IG as Instagram
  ME->>WK: approve asset
  WK->>PG: mayApprove check, approve_asset, emit asset.approved, one transaction
  PG-->>RN: fan-out creates post_meta job queued
  RN->>PG: claim_job sets running
  RN->>PG: read channel_settings and social_posts for asset and channel
  alt row already posted
    RN->>PG: finish job done, nothing sent
  else R2 not configured or MEDIA_BASE_URL unset
    RN->>PG: social_posts error r2_unavailable, retry_at plus 24 hours, attempts unchanged
  else not yet posted
    RN->>RN: nextWindowSlot with timezone and daily cap
    alt outside window or cap reached
      RN->>PG: retry_at next slot, attempts unchanged, row stays scheduled
    else inside window
      RN->>GR: GET ig-user-id content_publishing_limit
      GR-->>RN: quota usage
      loop each slide, 6 to 8 times
        RN->>GR: POST ig-user-id media with image_url and is_carousel_item
        GR->>R2: fetch image by public HTTPS URL
        R2-->>GR: PNG bytes
        GR-->>RN: child container id
      end
      RN->>GR: POST ig-user-id media with media_type CAROUSEL, children ids, caption
      GR-->>RN: parent container id
      RN->>PG: store container id in social_posts, so a retry resumes
      loop until status_code is FINISHED
        RN->>GR: GET container id fields status_code
        GR-->>RN: IN_PROGRESS or FINISHED
      end
      RN->>GR: POST ig-user-id media_publish with creation_id
      GR->>IG: publish carousel
      GR-->>RN: media id
      RN->>GR: GET media id fields permalink
      GR-->>RN: permalink
      RN->>PG: social_posts posted with remote_id and permalink, asset published, job done
    end
  end
  Note over RN,GR: error code 190 means token dead, job dead and channel health red
  Note over RN,GR: codes 4, 17, 32, 613 and 80002 mean throttled, retry_at and no failure
  Note over RN,PG: daily reconcile pulls insights at 1, 3, 7, 14 and 28 days into social_posts.metrics
```

## 3. HARDEN checklist by lane

Forty-three items, H1-01 to H1-43 in `H1.md`, run by `scripts/harden/run-all.mjs`. Four rehearsals are done for real: restore,
Worker rollback, migration rollback and the incident runbook. Green report with no `blocked` row except the `blocked-on-L1` rows
(H1-03, H1-20, H1-25, H1-30, H1-35, H1-41, re-run at L1 step 5), then the CEO signs, then the operator moves the STAGE line to 5 and L1 starts.

```mermaid
flowchart LR
  subgraph SEC["Security"]
    S1["H1-01 Turnstile coverage"]
    S2["H1-02 and 03 rate limits, API and Cloudflare rule"]
    S3["H1-04 and 05 headers and CSP"]
    S4["H1-06 to 08 service role, VITE, gitleaks"]
    S5["H1-09 claude-security scan"]
    S6["H1-10 bun audit"]
    S7["H1-11 to 15 uploads, HMAC, agent keys, request id, admin authz"]
    S8["H1-35 WAF, Bot Fight Mode, no country block"]
  end
  subgraph DATA["Backend and data"]
    D1["H1-16 RLS review script and role matrix"]
    D2["H1-17 Supabase security advisors"]
    D3["H1-18 and 19 migrations, editorial and money gates"]
    D4["H1-20 nightly encrypted backup, workflow artifact today, R2 copy once R2 is on"]
    D5["H1-21 restore rehearsal on a native PostgreSQL 18 throwaway cluster"]
    D6["H1-22 rollback drill on the throwaway Worker mop-drill"]
  end
  subgraph SITE["Website and honesty"]
    W1["H1-23 empty, loading, 404, 500"]
    W2["H1-24 legal entity, no null contact"]
    W3["H1-25 and 26 no illustrative, coming-soon signup"]
    W4["H1-27 and 28 Lighthouse 95 mobile, axe"]
    W5["H1-29 check-seo production mode"]
    W6["H1-30 Worker CPU probe, p95 under 8 ms on cache hits"]
  end
  subgraph OPS["Automations, admin, money, growth"]
    O1["H1-31 recipe dry-run parity"]
    O2["H1-32 failure drill, red rows and retry"]
    O3["H1-33 free-tier gauges under 70 percent"]
    O4["H1-34 Sentry, health drill, keep-warm tick"]
  end
  subgraph RECO["Recovery, retention, operations"]
    R1["H1-36 retention drill"]
    R2["H1-37 migration rollback drill"]
    R3["H1-38 secret rotation and ages"]
    R4["H1-39 incident runbook walked"]
  end
  subgraph CACHE["Caching contract and platform"]
    C1["H1-40 memory, edge and database call count"]
    C2["H1-41 edge hit ratio on the custom domain"]
    C3["H1-42 check-plans with trace.json"]
    C4["H1-43 no paid binding"]
  end
  MAN["Manual, signed: deliverability, main guarded by a CI rule, Turnstile visible, three tests, game day"]
  RUN["run-all.mjs writes harden report"]
  SIGN["CEO sign-off line"]
  ST5["Operator sets STAGE 5"]
  LAUNCH["L1 launch"]
  SEC --> RUN
  DATA --> RUN
  SITE --> RUN
  OPS --> RUN
  RECO --> RUN
  CACHE --> RUN
  MAN --> RUN
  RUN -->|"no red row, no blocked row except blocked-on-L1"| SIGN
  RUN -->|"any red row"| FIX["Fix in the owning slice, rerun the item"]
  FIX -.-> RUN
  SIGN --> ST5
  ST5 --> LAUNCH
  style SEC stroke-dasharray: 5 5
  style DATA stroke-dasharray: 5 5
  style SITE stroke-dasharray: 5 5
  style OPS stroke-dasharray: 5 5
  style RECO stroke-dasharray: 5 5
  style CACHE stroke-dasharray: 5 5
```
