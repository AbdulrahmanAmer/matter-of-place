# Security: what is protected and how

One section per control of architecture section 9, plus caching rule 6 and retention. Each names the code that holds
the control and the H1 row of `scripts/harden/checklist.json` that proves it. Run a row with
`node scripts/harden/run-all.mjs --env dev --only <id>`. This file is linted by
`node scripts/harden/runbook-lint.mjs docs/security.md`: every file it quotes must exist and every row id must be in the
checklist.

## Turnstile on every public write

Each POST row of `src/server/public/routes.ts` sets `turnstile: true` unless `TURNSTILE_EXEMPT` in
`tests/unit/security/turnstile-coverage.test.ts` names it with a reason. For a write, `src/server/public/pipeline.ts`
checks the token through `src/server/lib/turnstile.ts` after the size cap and the memory limit and before the schema and
the database limits. Proved by H1-01.

## Rate limits

Every anonymous route declares a memory limit and a database limit (R13); both are checked by
`src/server/lib/ratelimit.ts`. At the edge, one Cloudflare rate-limit rule covers `/api/public/` and `/api/admin/auth/`,
and the managed ruleset and Bot Fight Mode are on; `scripts/harden/waf-check.ts` reads them. Proved by H1-02 (the API
limits), H1-03 and H1-35 (the edge rules: offline from the zone fixtures now, live after L1 routes the domain).

## Headers and CSP

`src/server/lib/headers.ts` sets `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Frame-Options`,
`Referrer-Policy: strict-origin-when-cross-origin` and the Content Security Policy built by `cspFor` from the hosts of
`src/server/lib/csp-allowlist.ts`. The policy ships as `Content-Security-Policy-Report-Only` until the `csp_enforce` flag
is on. Proved by H1-04 (headers) and H1-05 (the site works under the enforced policy).

## Service role only on the server

The service-role client is built in `src/server/lib/db.ts`; the key is named only under `src/server` and in the request
middleware `src/start.ts`, and no file of the public bundle names `service_role`. Proved by H1-06.

## Row level security

Every `public` table has RLS enabled (R20), and the policies follow the matrix in `tests/db/rls-matrix.ts`.
`scripts/harden/rls-review.ts` reviews every relation and security definer function on the database, and the Supabase
security advisors are read through the Management API. Proved by H1-16 and H1-17.

## Uploads

Browsers upload photographs straight to the private `submissions` bucket through a signed upload URL made in
`src/server/submissions/service.ts`. The `reconcile` system job runs `src/server/submissions/reconcile.ts`, which reads
the first bytes of each upload (`sniffImageType`) instead of trusting the declared type and deletes what does not match.
H1-11 proves the signed URLs, the sniffing and the size cap.

## Hooks

Inbound hooks verify a signature over the raw body before they act: the render callback through
`src/server/lib/hmac.ts` in `src/server/hooks/render.ts`, Resend events through the Svix signature in
`src/server/hooks/resend.ts` (a five-minute timestamp window and one receipt per message id). Constant-time compares come
from `src/server/lib/crypto.ts`. Proved by H1-12.

## Agent keys

Only the sha256 of an agent key is stored (`src/server/lib/agent-keys.ts`); the key is shown once and starts `mopk_`.
A key carries its agent's roles and scopes, and every request looks it up again, so a revoked key fails at once. Proved
by H1-13.

## Admin authorization and CSRF

Every admin service authorizes through the matrix of `src/server/lib/authz.ts` before it touches the database, and
`src/server/lib/admin-route.ts` verifies the CSRF token of every admin write through `src/server/lib/csrf.ts`. Proved by
H1-15 and H1-45.

## No secrets in VITE\_\*

`.env.example` names only public `VITE_*` values (the site URL, the API base URL and the Turnstile site key), and the
built bundle names no secret. Proved by H1-07.

## Scans

`.github/workflows/audit-deps.yml` runs `gitleaks` over the whole git history and over the files of the checkout, with
the configuration `scripts/harden/gitleaks.toml` (the default rules, plus an allow list of test fixtures and variable
names, each described in the file). The `claude-security:scan` report is saved under `workspace/audits/` as
`security-scan-YYYY-MM-DD.md`; `scripts/harden/read-scan.mjs` fails it when it is missing, older than 7 days, or holds a
Critical or High finding with neither a `- closed:` nor an `- accepted:` line. Proved by H1-08 (gitleaks, read from the
last run of the workflow) and H1-09 (the report).

## Dependency audit

`bun run audit:deps` audits the app at level high and is the `audit` step of the `check` job of
`.github/workflows/ci.yml`; the script of the same name in `launch/package.json` audits `launch/` in the step after it.
`audit-deps.yml` runs both every Monday, by hand, and on a pull request that changes `scripts/harden/`,
`docs/runbooks/` or this file. The patched versions come from the `overrides` of `package.json` and
`launch/package.json`, and for js-yaml 4 and brace-expansion, which the tree holds in two major versions each, from
their entries in `bun.lock`. Four waivers, each an `--ignore` flag of the `audit:deps` script, lifted when its
condition holds; `tests/unit/audit-waivers.test.ts` fails when a flag has no entry here. Recorded on 2026-10-09:
`extract-zip` 2.0.1 (GHSA-jmr9-qjv8-65gv, GHSA-7pqw-9j4j-h8q3; no fixed release exists), pulled in by
`puppeteer-core` through `@puppeteer/browsers`, which unpacks the browser archives it downloads; lifted when a fixed
release exists. Recorded on 2026-10-25: `undici` 7.29.1 and 8.11.2 (GHSA-xjj6-f33q-929c, an HTTP client's denial of
service on a response with too many content encodings; fixed in 7.30.1 and 8.12.2), pulled in by `miniflare` (pinned
exactly by `wrangler`, local Worker tooling) and by `jsdom` (unit tests); neither reaches the deployed Worker, which
uses the runtime's own `fetch`. No `miniflare` release pins a fixed `undici` yet (newest checked: 5.20261019.2-beta);
lifted when `wrangler` ships one that is at least seven days old. Recorded on 2026-10-25: `body-parser` 1.20.8
(GHSA-27r3-jxmh-p828, a denial of service from trailing bytes after a compressed request body; fixed in 1.20.9,
released 2026-10-22), pulled in by `@lhci/cli` through `express`, the local Lighthouse server; lifted on 2026-10-29,
when 1.20.9 is seven days old, by an `overrides` entry. Recorded on 2026-10-25: `zod` 3.25.76, our own dependency
(GHSA-mrhx-c7xc-m3w5, memory exhaustion while validating an oversized constrained collection; every 3.x release is
affected, fixed only in 4.6.6), which validates every request in the deployed Worker; the exposure is bounded because
both pipelines refuse a body over 64 KB before it is parsed (`MAX_BODY_BYTES` in `src/server/public/pipeline.ts` and
`src/server/lib/admin-route.ts`); lifted when the app moves to zod 4. The same zod advisory is the one waiver of
`launch/package.json`'s script: `zod` 3.25.76 reaches `launch/` only through `puppeteer`'s `chromium-bidi`, which
drives the browser that renders the films on the laptop and is never deployed; lifted when `chromium-bidi` moves to zod 4. Proved by H1-10.

## Never cached (caching rule 6)

Every POST, every write under `/api/public/`, all of `/api/admin/*`, `/api/hooks/*` and `/admin`, the errors the pipeline
writes itself and every 5xx answer with `Cache-Control: no-store`, set by `src/server/lib/pipeline.ts` and
`src/server/public/pipeline.ts`. Proved by H1-40.

## Retention

The row trigger `refuse_hard_delete` (`supabase/sql/functions/refuse_hard_delete.sql`, added by migration
`20261001090700_editorial_gate.sql`) is on `properties`, `stories`, `subscribers`, `submissions`, `contacts`,
`inquiries`, `payments` and `campaigns`. It raises `hard_delete_refused` on every delete, the service role included,
unless the transaction set `mop.retention` to `on`. In `supabase/sql` the functions that set it are
`retention_delete_rows`, `retention_delete_media` and `prune_jobs`; some API and database tests set it inside their own
transactions. Tables without the trigger are deleted from by other functions too, for example `property_media` by
`delete_media` and `jobs` by `prune_jobs`. The daily retention job `src/server/jobs/system/retention.ts` runs policy by
policy from the `retention_policies` table and writes one audit row per run. Proved by H1-36.

## Open risks (rulings H4 and H5, SEC-04)

- Pull request preview jobs hold the narrow `mop-github-actions` deploy token, which can also replace the production
  Worker. A second Cloudflare account is the operator's later choice.
- Without GitHub Pro there is no required review, so the hygiene test of H1-46 catches an accidental workflow change, not
  a malicious one.
- The Worker reaches the database with the service role, so RLS is not exercised on that path; the guard is the
  authorization sweep `tests/unit/admin-authz-sweep.test.ts` (H1-15): every admin service authorizes before it touches
  the database.
