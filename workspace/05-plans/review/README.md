# Engineering review, 2026-10-02 (ASSUMED section H)

Twelve lenses (database, api, frontend, jobs, integrations, security, delivery-ops, testing, code-standards, performance-cost, domain-logic, end-to-end), each challenged by a second reviewer. 155 findings: 14 critical, 82 major, 59 minor. Critical and major findings are accepted and bind the slices below; minor findings are not applied (they are kept in the session journal). One file per slice holds the full text.

| Id | Severity | Finding | Slices |
|---|---|---|---|
| INT-01 | major | Recovering a social post after a crash matches on caption text, which X rewrites, and the in-flight marker is not compare-and-set | B10 |
| INT-02 | major | mop-dev and production share one Resend account: dev mail spends the production daily quota, the public dev Worker can mail arbitrary addresses, and webhook events cross environments | B3, B5, B11, L1 |
| INT-03 | major | One undivided daily email budget lets bulk mail starve invoices, confirmations and admin alerts | B5, B11 |
| INT-04 | major | Health and token alerts travel only through Resend, so a broken mail path hides itself and other failures | B5, B8, B10, H1 |
| INT-06 | major | The Meta token check reads only the expiry, so a revoked or under-scoped token shows healthy, contradicting B10 | B8, B10 |
| INT-07 | major | Credentials and versions with a known end date get no early warning; an Anthropic 404 is unmapped | B8, B9, B10, B14, B16 |
| INT-08 | major | X read usage is not measured or budgeted, but metrics, token checks and the crash lookup all depend on it | B10 |
| INT-10 | major | A crash after the broadcast send leaves the issue stuck in 'sending' or calls send again | B11 |
| INT-11 | major | Resend errors are classified by HTTP status only, but each status covers several different errors | B5, B11 |
| INT-12 | major | The hand-written Sentry client has no rate limit, so one bad deploy can spend the month's 5k events and blind the alert path | B1b, B8, H1 |
| API-01 | critical | Invites fail as written, and magic links fail across devices and when mail scanners open them | B5, B7, H1 |
| API-02 | major | Admin routes have no declarative contract, so each of about 75 handler files assembles authorization, CSRF and recent-auth by hand | B6, B7, B8, B8b, B9, B10, B11, B14, H1 |
| API-03 | major | Errors are mapped by message text, real codes become 500, and outages are reported as 500 instead of 503 | B2, B3, B7 |
| API-04 | major | The sign-in link and agent-key traffic have no rate limit, so free-tier quotas can be exhausted | B1b, B3, B5, B7, H1 |
| API-05 | major | The CSRF cookie is issued only at sign-in, so writes stay broken once it is lost | B7 |
| JOB-03 | critical | The render_variants callback makes three Worker subrequests per photograph, so a normal 40-photo property goes over the Workers free limit of 50 | B4, B8, B9 |
| JOB-04 | critical | Nothing outside the job runner notices when the runner stops, so every email and webhook stops without an alert | B1b, B8, B8b, H1, L1 |
| JOB-01 | major | The heavy-dispatch token needs Contents write, which can push to an unprotected main that auto-deploys; PR code on mop-dev holds it | B8, B12, H1 |
| JOB-02 | major | The plans disagree on who counts attempts, a reclaimed job never uses one, nothing limits how long a step runs, and callbacks are matched on an attempt number that a manual retry resets | B8, B9, B12 |
| JOB-08 | major | Each per-photo render_variants job dispatches its own Actions run over every staged photo, multiplying billed minutes | B7, B8, B9, B14 |
| JOB-10 | major | cron history, queue archives and the rows written by waiting jobs grow without limit against the 500 MB database | B8 |
| JOB-07 | major | Events that always fail planning are retried every tick and can fill the sweep window, so newer events are never planned | B8, B8b |
| FE-01 | critical | Dossier autosave can conflict with its own saves and publish without the last edits; the prescribed recovery throws away typed text | B7 |
| FE-02 | major | The admin renders inside the public root layout: site header and footer, consent notice, GA4, web vitals, service worker and the public stylesheet all reach /admin | B3, B3b, B7, B13, B16, B17 |
| FE-03 | major | The live client bundle ships the local adapters and all illustrative seed data, sits near the 150 KB budget, and the budget is only checked by Lighthouse after deploy | B1b, B3, B4, B17 |
| FE-04 | major | Submission photo upload: unbounded parallel PUTs, files matched by name, and a partial failure is shown as a failed submission | B3, B4 |
| FE-06 | major | The admin client data layer is unspecified: no query-key contract, mutation and invalidation rule, retry policy, or per-screen error boundary | B6, B7, B8, B8b |
| FE-09 | major | No browser error reporting: a JavaScript error in the client-rendered admin or a hydration failure on the site is invisible to the team | B1b, B3, B7, B17 |
| DB-01 | critical | Branch migrations are pushed to the one shared mop-dev, and the documented recovery is refused by B2's own reset guard. Three parallel lanes will deadlock on this in phase 1. | B1b, B2, B4, B7, B8b |
| DB-03 | major | audit_log can never be changed and keeps whole before/after rows that contain personal data, so delete_subject cannot complete a CCPA deletion | B2, B3, B6, B7 |
| DB-04 | major | SQL write functions trust the actor kind the Worker passes, so the human-only gate (S23) and the agent cap have no database check | B7, B8b, B10, B11 |
| DB-08 | major | Production migrates before the Worker deploy and rolls back only the Worker, but expand-then-contract is only runbook prose that arrives at H1 | B2, H1 |
| DB-09 | major | Manual job keys count existing rows, so after done jobs are pruned the next key collides and retry, forward or metrics refresh silently does nothing | B7, B8, B10, B15 |
| DB-11 | major | The restore rehearsal proves only that the dump parses; restoring into a new Supabase project is unplanned, and 7-day artifacts are the only copy while R2 is off | B1b, H1, L1 |
| DB-13 | major | Function bodies are re-copied by hand from one slice's migration into another's, across parallel lanes | B2, B3, B8, B9, B10, B15 |
| DB-16 | major | System-maintained property columns bump properties.version, so editors get false 409s while photographs render | B2, B7, B12 |
| SEC-03 | critical | JSON-LD is serialized with plain JSON.stringify into a raw script sink, and inlineHashes would allow-list whatever script that produces | B13, B17, H1 |
| SEC-01 | major | Pull-request jobs hold credentials that can replace the production Worker and run the Management API on every Supabase project | B1b, B8, H1 |
| SEC-02 | major | GITHUB_DISPATCH_TOKEN is planned with Contents write: one leaked job-runner secret can push to main and deploy | B8, B9, B12, H1 |
| SEC-08 | major | The dev loader exports every .env value into every builder shell, including production credentials and the account-admin Cloudflare token | B2, B3, B3b, B14, B16, H1, L1 |
| SEC-04 | major | Authorization has one layer, and nothing proves that every admin route reaches it | B7, H1 |
| SEC-11 | major | An agent with automation scope can silently stop backups and the audit clock, and can publish without a cap | B5, B7, B8, B8b |
| SEC-12 | major | The staff magic-link endpoint has no rate limit, and its mails consume the shared 100-per-day Resend quota invisibly | B3, B5, B7, H1, L1 |
| SEC-13 | major | The job runner's npm: imports float on every deploy, Actions are pinned by mutable tag, and workflows set no default token permissions | B1b, B8, B12, B14, H1 |
| DO-03 | critical | Monitoring depends on the things it monitors: a dead job runner, cron or database sends no alert | B1b, B8, B8b, B14, H1, L1 |
| DO-08 | critical | GitHub Actions minutes are unmeasured and the 48-hour three-lane build can use up the month's 2,000, stopping deploys and backups | B1b, B4, B14 |
| DO-02 | major | Every same-repo pull-request workflow can read production credentials and the backup key | B1b, B8, H1 |
| DO-04 | major | The production gate is check + build only: a PR with red db or e2e checks, or a re-run of an older ci run, still deploys | B1b, B4 |
| DO-05 | major | Parallel lanes will create out-of-order migration timestamps, and nothing checks for them or for destructive changes before a Worker rollback | B1b, B2, H1 |
| DO-07 | major | The shared `mop-dev` database serializes all PR CI, cancels pending checks, and lets PR branches leave migrations and job-runner code behind | B1b, B2, B4, B8 |
| DO-06 | major | The production restore path has never been run on Supabase, the dump leaves out Vault rows, backup age raises no alarm, and the only decryption key is on the laptop | B1b, B8, H1, L1 |
| DO-09 | major | The post-deploy smoke accepts stale content, last-good HTML breaks the release-key rule, and the in-job rollback has never run | B1b, B3, H1 |
| DO-10 | major | The job runner has no rollback path, and a step type the deployed runner does not know sends jobs straight to `dead` | B8, H1, L1 |
| T-01 | critical | Every branch and every lane shares one mutable cloud schema (mop-dev): unmerged migrations break unrelated PRs and lanes, and the tests check a schema the branch does not have | B1b, B2, B4, B6, B10, B11, B13, H1 |
| T-02 | major | The CI test gates land after the Operations and Content lanes open, so their first slices merge with no CI db or e2e job | B1b, B2, B3, B3b, B4 |
| T-03 | major | Merge is a human judgment with no mechanical check that the PR was tested against current main and that every job passed | B1b, B4 |
| T-04 | major | The CI route sweep and form tests run a build mode that is never deployed, and the live-mode run is path-gated past the files that break hydration and the browser-to-Worker contract | B3, B4, B13 |
| T-05 | major | The admin portal's end-to-end specs (decisions, invoices, publish, jobs) never run in CI | B2, B4, B6, B7, B8 |
| T-07 | major | Watched-fails are a free-text ledger with no enforcement and no replay, and B2's migration mutations need two shared-database resets each | B2, B3, B4 |
| T-08 | major | Split time model: the only offset helper is anchored to a fixed date while SQL compares against now(), so database tests start failing on a calendar date | B2, B4, B6, B8 |
| T-10 | major | The lint config is the untyped recommended preset and no plan hardens it; no rule catches un-awaited promises, non-exhaustive switches, focused tests or dead code | B1b, B4 |
| T-11 | major | The 10 ms CPU limit has no automated regression gate; it is measured once by hand in H1 | B4, B8, B14, B16, H1 |
| T-12 | major | Ten jobs and four separate builds of the same SHA per push will exhaust the 2,000 private-repo Actions minutes during the three-lane build, and then CI and deploys stop | B1b, B4, B8, B13 |
| CS-01 | critical | Code shared with the Deno job runner is written with extensionless imports, which Deno 2 refuses, and the gate that would catch it arrives eight slices late | B1b, B3, B5, B8, B8b, B12, B15, B16 |
| CS-02 | major | Lint is not type-aware, warnings never fail, and no slice hardens it before three lanes write about 200 files | B1b |
| CS-03 | major | Admin routes are wired by hand in every file across nine slices, and nothing checks that each write verifies CSRF | B6, B7, B8, B8b, B9, B10, B11, B14, B16, H1 |
| CS-04 | major | HMAC, constant-time compare and hashing are specified in eight places; one names an API that does not exist outside Workers, and two functions share the name hashKey | B1b, B3, B5, B7, B8, B10, B15, H1 |
| CS-05 | major | Nothing mechanical detects unused exports, dead files, unused dependencies or copied code | B1b |
| CS-07 | major | 127 planned scripts, including the ones that sign render callbacks and seed production, get no type checking and almost no lint | B1b |
| CS-08 | major | Logging has three shapes, the logger arrives after the first server code, and console is not banned, so the email scrubber can be bypassed | B1b, B3, B5, B8, B8b, B11, B14 |
| CS-10 | major | The builder's standing rules and the reviewer's brief cover only the frontend, and the reviewer is told code quality is out of scope | B7 |
| CS-11 | major | Production stubs are designed in on purpose, but nothing marks them or proves they are gone at launch | B1b, B3, B3b, B5, B8, B8b, L1 |
| CS-12 | major | Unit tests have no shared typed fake database, and nothing refuses a test with no assertion | B1b, B2, B3, B4, B7, B8 |
| DL-01 | major | A waived listing (Five Features credit, comp) can only be recorded by issuing a real invoice, and that invoice is emailed to the agent | B6 |
| DL-02 | major | Activation and Create property are idempotent only by read-then-insert: no submission lock and no unique constraint | B2, B6, B7 |
| DL-03 | major | A paid property cannot be republished after an unpublish, and B2's editorial graph refuses moves that B7 itself prescribes | B2, B7 |
| DL-04 | major | Once accepted, a submission has no exit: withdrawn, unpaid or abandoned requests stay in Accepted, Awaiting Assets or Invoice Issued for ever | B2, B6, B7, B8 |
| DL-06 | major | One confirmation per address breaks double opt-in: newsletter consent can be added without a confirm, and a re-subscribe is silently dropped | B3, B5, B8b, B11 |
| DL-07 | major | The market-open notice can use the whole daily email cap and push invoices, decisions and alerts back by days | B5, B11 |
| DL-09 | major | No plan writes campaign dates, so the sold Campaign window does not exist, and a published submission with no post never completes | B2, B6, B7, B10 |
| DL-10 | major | Every job type goes dead after about 8 minutes of retries, so an ordinary provider incident dead-letters invoices, posts and lead forwards | B8, B8b |
| PERF-01 | critical | Every per-photo render_variants job dispatches every staged photo of the property, so renders and Storage egress grow with the square of the upload count | B2, B7, B9 |
| PERF-07 | critical | copySubmissionPhotos runs inside a Worker request and exceeds the free plan's 50 subrequests at about 23 photographs, and its retry never gets further | B6, B7, B8 |
| PERF-02 | major | cron.job_run_details is never purged and grows by roughly 200 to 350 MB a year against the 500 MB database line | B8, L1 |
| PERF-05 | major | Version-keyed edge entries expire after 300 s, stale-while-revalidate does nothing in the Cache API, and the last-good copy expires with them or outlives its release | B3 |
| PERF-03 | major | The catalog snapshot has no byte budget, and the 500-property revisit trigger is far beyond where the cold path breaks | B1b, B2, B3, H1 |
| PERF-06 | major | Every public page dehydrates the full Property[] (galleries and variants included) into its HTML; there is no list shape and no document budget | B3, B4, B13 |
| PERF-08 | major | Full-size originals are stored twice and re-downloaded at full size on every review-screen opening, against 1 GB Storage and 5 GB egress | B2, B3, B7, B8 |
| PERF-09 | major | The 2,000 Actions minutes are shared by CI, deploys, renders and backups, the two plans disagree on CI cost, nothing measures it, and a backup that never starts raises no alarm | B1b, B4, B8 |
| PERF-11 | major | The shared 90-a-day email cap has no priority: a market-open notice or bulk send can push inquiry acknowledgements and signup confirmations back by days | B5, B11 |
| E2E-06 | critical | The three S54 lanes push migrations and job-runner builds from their own branches into the one shared mop-dev, which the Supabase CLI refuses, and an edited migration drifts silently | B1b, B2, B4, B8, B17 |
| E2E-02 | critical | Copying a request's photographs inside one Worker request exceeds the free plan's 50-subrequest cap at about 22 photographs | B3, B6, B7, B8 |
| E2E-01 | major | A rights takedown deletes no media and purges no cache, and live posts are withdrawn by hand with no list or record | B3, B7, B8, B8b, B9, B10, H1 |
| E2E-08 | major | Every per-photograph render job signs and renders all of the property's staged photographs, so Actions runs and minutes multiply | B7, B8, B9 |
| E2E-04 | major | mop-dev and production each cap mail at 90 a day against one shared 100-a-day Resend account that magic links also use, and real sends on dev are fail-open flags | B3, B5, B8, B10, B11, L1 |
| E2E-03 | major | Email, post, caption and render jobs go dead about 8 minutes after a provider fails, and dead jobs can only be retried one by one | B8, B8b, B10 |
