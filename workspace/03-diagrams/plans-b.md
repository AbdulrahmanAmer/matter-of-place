# Plans B diagrams (batch B, operate the business)

Words: `../05-plans/B5.md`, `B6.md`, `B7.md`, `B8.md`, `B8b.md`, `B16.md`. Pictures: `img/plans-b-1.png`, `-2.png`, `-3.png`.

## 1. Submission workflow with invoice states

Source of truth: `submissions.workflow_state` (architecture 3.3) and `payments.status` (3.4). The states Paid and Waived
are the invoice states shown in the path. The trigger `enforce_editorial_gate` refuses Invoice Issued and later states
without `accepted_at`, and refuses Scheduled without a payment that is paid or waived (S32, B6).

```mermaid
stateDiagram-v2
  direction LR
  [*] --> Submitted
  Submitted --> UnderReview: start review
  UnderReview --> Declined: decline with reason
  UnderReview --> AwaitingAssets: request assets
  AwaitingAssets --> UnderReview: assets received
  UnderReview --> Accepted: accept
  Accepted --> AwaitingAssets: request assets
  AwaitingAssets --> Accepted: assets received
  Accepted --> InvoiceIssued: issue invoice, payment due
  InvoiceIssued --> Paid: mark paid
  InvoiceIssued --> Waived: waive
  InvoiceIssued --> InvoiceIssued: reissue after void
  Paid --> Scheduled: activate agent
  Waived --> Scheduled: activate agent
  Scheduled --> Published: publish property
  Published --> DistributionActive: first post is posted (B10)
  DistributionActive --> Completed: campaign end date passed, or 30 days after publication (B10)
  Declined --> [*]
  Completed --> [*]
  state "Under Review" as UnderReview
  state "Awaiting Assets" as AwaitingAssets
  state "Invoice Issued" as InvoiceIssued
  state "Distribution Active" as DistributionActive
  note right of InvoiceIssued
    payments.status is due here
    overdue after 14 days
  end note
  note right of Paid
    payments.status is paid
  end note
  note right of Waived
    payments.status is waived
  end note
```

## 2. Job runner, from pop to done, failed or dead

Light jobs run inside the Edge Function. Heavy jobs are dispatched to GitHub Actions and finish through the signed
callback (B8). One transition per row in `job_events`.

```mermaid
sequenceDiagram
  autonumber
  participant CR as pg_cron
  participant PG as Postgres and pgmq
  participant RN as Job runner Edge Function
  participant ST as Step code
  participant GH as GitHub Actions render workflow
  participant WK as Worker hook render callback
  CR->>RN: every minute via pg_net with runner secret
  RN->>PG: sweep events without processed_at and fan out
  RN->>PG: runDueSchedules claims due schedule_settings rows, emits digest.due or enqueues prune, reconcile, kpi_weekly, newsletter_hygiene
  RN->>PG: pgmq read jobs_light with visibility timeout
  PG-->>RN: message with job id
  RN->>PG: claim_job sets running and a fresh locked_by claim, attempts unchanged (fail_job increments)
  alt claim lost or job not queued
    PG-->>RN: no row returned
    RN->>PG: pgmq delete message
  else claimed and light
    RN->>ST: run with ctx, params, payload
    alt step succeeds
      ST-->>RN: result
      RN->>PG: status done, result, finished_at, job_events row
    else step throws and attempts below max
      ST-->>RN: error
      RN->>PG: status failed, run_after with backoff, requeue message
    else step throws and attempts at max
      ST-->>RN: error
      RN->>PG: status dead, error, job_events row
    end
  end
  RN->>PG: pgmq read jobs_heavy with capacity limit
  RN->>GH: workflow_dispatch of render.yml with job id, claim, type, payload
  RN->>PG: status running, job_events dispatched
  GH->>GH: run script for the job type
  GH->>WK: POST result with HMAC signature and timestamp
  WK->>WK: verify signature, age, job status running, claim matches
  alt result ok
    WK->>PG: step onResult writes assets, status done
  else result failed
    WK->>PG: same backoff or dead rules as light jobs
  end
  RN->>PG: reaper resets stale running jobs and fails heavy jobs with no callback
```

## 3. Recipe engine, from event to jobs and the approval gate

Same planner runs for the real event and for the dry-run. Dry-run never inserts (B8b).

```mermaid
flowchart TD
  A["Server function commits state change"] --> B["events row inserted in the same transaction"]
  B --> C["fanoutEvent runs after commit, sweep re-runs it every minute"]
  C --> D{"Enabled recipe for events.type?"}
  D -- "no" --> Z1["Every step skipped, reason recipe_disabled, event marked processed, no jobs"]
  D -- "yes" --> E["For each step in recipe order"]
  E --> F{"Step enabled?"}
  F -- "no" --> S1["Skipped, reason step_disabled"]
  F -- "yes" --> G{"Conditions match payload tier, market and kind?"}
  G -- "no" --> S2["Skipped, reason condition"]
  G -- "yes" --> G2{"Step type implemented and params valid?"}
  G2 -- "no" --> S3["Skipped, reason not_implemented or invalid_params"]
  G2 -- "yes" --> H{"requires_approval true?"}
  H -- "yes" --> J1["Planned job waiting_approval, no queue message"]
  H -- "no" --> J2["Planned job queued with pgmq send"]
  J1 --> L["fanout_insert_jobs: one transaction inserts the planned jobs and sets events.processed_at last"]
  J2 --> L
  S1 --> L
  S2 --> L
  S3 --> L
  L --> K["Job runner runs light step or dispatches heavy step"]
  L --> AP["waiting_approval job: approved on the Jobs or Assets screen, then queued"]
  AP --> K
  DR["Dry-run with sample entity"] -.-> E
  DR -.-> R["Returns planned jobs and skips, inserts nothing"]
  subgraph GUARD["Idempotency"]
    I1["idempotency_key is event id plus step id, insert on conflict do nothing"]
  end
  J1 --- I1
  J2 --- I1
  style GUARD stroke-dasharray: 5 5
```
