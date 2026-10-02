# Delivery runbook

How the site, the database and the Worker reach the world, and what this account allows. Facts here were measured on
2026-10-02 from the laptop with `.env` loaded without printing it (ASSUMED E10). Slice B1b adds to this file as its
steps land.

## Accounts

| Item                  | Observed                                                                                                                                            | Command                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Cloudflare account    | `Admin@matterofplace.com's Account`, id `5f55b1e09db48961c4366b73b188c7f9`, Account API Token                                                       | `bunx wrangler whoami`                                       |
| workers.dev subdomain | `holy-meadow-4327` (ASSUMED E2)                                                                                                                     | `GET /accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain`     |
| GitHub login          | `AbdulrahmanAmer`, scopes `gist`, `read:org`, `repo`, `workflow`                                                                                    | `gh auth status`                                             |
| GitHub plan           | Free. `gh api user --jq .plan.name` prints nothing because the login lacks the `user` scope (GOTCHAS P-048); the 403 below is the proof of the plan | `gh api user --jq .plan.name`                                |
| Repository            | `AbdulrahmanAmer/matter-of-place`, private (`true`), owned by a User account                                                                        | `gh api repos/AbdulrahmanAmer/matter-of-place --jq .private` |

Worker addresses: preview `https://pr-<n>.holy-meadow-4327.workers.dev`, dev
`https://matter-of-place-dev.holy-meadow-4327.workers.dev`, production
`https://matter-of-place.holy-meadow-4327.workers.dev` until the domain is attached.

## Toolchain

| Tool          | Version | ASSUMED E11                                                                                                                                                                                                              |
| ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| node          | 24.13.0 | same                                                                                                                                                                                                                     |
| bun           | 1.3.13  | same                                                                                                                                                                                                                     |
| git           | 2.55.0  | same                                                                                                                                                                                                                     |
| gh            | 2.92.0  | same                                                                                                                                                                                                                     |
| Supabase CLI  | 2.98.2  | same                                                                                                                                                                                                                     |
| psql, pg_dump | 18.4    | same                                                                                                                                                                                                                     |
| ffmpeg        | 8.1     | same                                                                                                                                                                                                                     |
| python        | 3.14.2  | 3.14                                                                                                                                                                                                                     |
| openssl       | 3.5.7   | same                                                                                                                                                                                                                     |
| deno          | 2.8.1   | same                                                                                                                                                                                                                     |
| wrangler      | 4.145.0 | pinned exactly as a devDependency in step 3, so `bun run cf:preview` and `bunx wrangler` in `app/` use it; E11 says 4.145.0; `bunx wrangler` outside the folder resolved 4.146.0 on 2026-10-02. Dependabot moves the pin |

## Free plan consequences

- Branch protection of `main` is not available: `gh api repos/AbdulrahmanAmer/matter-of-place/branches/main/protection`
  answers HTTP 403 `Upgrade to GitHub Pro or make this repository public to enable this feature` (GOTCHAS P-028).
- Environments with required reviewers are not available on a private repository of this plan (ASSUMED E9).

## Decision for step 9: branch protection

BLOCKED. Free private repositories have no branch protection and the operator declined GitHub Pro (ASSUMED H5, about
4 USD a month, which would also need a decision under G-011). What stands in its place:

- the merge gate: the orchestrator merges only through `node workspace/05-plans/merge-gate.mjs <pr>` (written in step
  5b), which refuses a head that does not contain `origin/main` and any failing check;
- `deploy.yml` deploys only a commit whose `ci` run on `main` succeeded (invariant 6a);
- nobody force-pushes (G-009).

What would unblock it: GitHub Pro, or a public repository, then `bash scripts/protect-main.sh`.

## Worker configuration

`app/wrangler.toml` holds the production defaults: the name `matter-of-place`, `MOP_ENV = "production"`,
`MEDIA_PUBLIC_BASE`, and `observability`. Nitro merges it into `.output/server/wrangler.json` at build, so
`vite.config.ts` pins only the name (`cloudflare.wrangler.name`, G-002). Preview and dev deploys override the variables
with `--var`. The file holds no secret and no binding for Queues, Browser Rendering, Images, Durable Objects or KV
(G-011).

## Request pipeline and headers

Every response that passes through the Worker carries `x-request-id`, the static security headers and, when the host is
not indexable, `X-Robots-Tag: noindex, nofollow`. `src/start.ts` registers one request middleware that calls `handle`
in `src/server/lib/pipeline.ts`; the order is: request id, never-cached rule, cache hook, render, then the headers
(architecture 13). Server routes such as `/sitemap.xml` and `/api/hooks/*` go through the same middleware (measured in
step 3 on the built Worker).

- The request id is kept only when it matches `^[A-Za-z0-9-]{8,64}$`; otherwise a UUID is minted.
- `X-Robots-Tag` follows `isIndexableHost(host, MOP_ENV)` in `src/server/seo/robots.ts`: every `.workers.dev` host is
  `noindex` whatever `MOP_ENV` says, and any host is `noindex` unless `MOP_ENV` is `production`. `wrangler dev` passes
  the `Host` header through, so `curl -H "Host: matterofplace.com"` is a real test of the rule.
- `Cache-Control: no-store` is set, never merged, on every write, `/api/admin/*`, `/api/hooks/*`, `/admin`, preview-token
  URLs, responses with `Set-Cookie` and every 5xx. HTML pages answer `public, max-age=0, must-revalidate`.
- An unhandled error answers the calm 500: the HTML page for a GET or HEAD outside `/api/` that accepts HTML, otherwise
  `{ "error": { "code": "server", "message": "...", "requestId": "..." } }` (STANDARDS R09; the plan's shorter shape
  had no `message`, GOTCHAS P-078). Both carry `x-request-id` and `no-store`.
- The Content-Security-Policy ships as `Content-Security-Policy-Report-Only`; a policy already on the response (a hit
  stored by B3) is never overwritten.
- Until B3 lands, the cache hook is a pass-through and the flags are empty (the stub markers in `src/start.ts` name
  each replacement). Unhandled errors go to Sentry through `captureException` (section Sentry below).

### Where `waitUntil` and the environment come from

`import { waitUntil } from "cloudflare:workers"` does not build: `vite build` fails in the `ssr` service because
Nitro lists the module as external only for its own final bundle (GOTCHAS G-018). `src/start.ts` takes `waitUntil` from
the request instead: Nitro's `augmentReq` puts the Worker's bound `waitUntil` on it. Measured in step 3 under
`wrangler dev`: the parse succeeded on every request. `process.env.MOP_ENV` is populated from the Worker variables and
secrets by `nodejs_compat`, so `start.ts` reads it there. Under `bun run dev` there is no Worker and no `waitUntil`;
the fallback starts the promise and leaves it. Step 4's test event reached Sentry from `wrangler dev`, so `waitUntil`
ran the report to completion there; on a deployed Worker that stays UNPROVEN until step 7's production test.

### Static asset headers

`public/_headers` holds two blocks: `/*` (the security headers, once) and `/media/*` (`Cache-Control: public,
max-age=604800`). Nitro appends the `/assets/*` rule itself (`Cache-Control: public, max-age=31536000, immutable`), so a
full `cmp` fails; the proof is a prefix compare:

```
bun run build
cmp -n "$(wc -c < public/_headers)" public/_headers .output/public/_headers
```

A second block for the same path replaces the first. Measured on 2026-10-02 with our own `/assets/*` block set to
`max-age=3600` in the built file: the served asset still answered Nitro's `max-age=31536000, immutable`. So there is no
`/assets/*` block in our file (it would be dead text) and no security header sits in a path Nitro also writes
(GOTCHAS G-017). The immutable lifetime of fingerprinted assets is Nitro's rule; `scripts/smoke.mjs` (step 6) checks it
on a preview, and `headers.test.ts` fails if a block for `/assets/*` is added.

## Preview the built Worker on this machine

```
bun run build
echo "MOP_ENV=local" > .dev.vars      # git-ignored; an empty file keeps MOP_ENV at the wrangler.toml default, production
bun run cf:preview                    # http://127.0.0.1:8788
```

`cf:preview` copies `.dev.vars` next to the built config and starts `wrangler dev` (GOTCHAS P-073: `--env-file` does not
read it). Stop it by its parent process, not by `workerd` alone (GOTCHAS P-042); in PowerShell stop the `node.exe` or
`bun.exe` whose command line holds `wrangler`, then check `Get-NetTCPConnection -LocalPort 8788 -State Listen`.

Checks measured in step 3 with an empty `.dev.vars`: no `X-Robots-Tag` on `127.0.0.1:8788` or with
`Host: matterofplace.com`, `noindex, nofollow` with `Host: pr-1.holy-meadow-4327.workers.dev`; with
`MOP_ENV=local` the first request is `noindex, nofollow` as well.

## Sentry

Organisation `matter-of-place`, project `javascript-tanstackstart-react` (ASSUMED E9, E21). The Worker and the job
runner send through two client keys, so Worker noise cannot starve the runner's reports (INT-12):

| Key name     | Used by                                                                       | Source copy in `.env`   | Per-key limit                        |
| ------------ | ----------------------------------------------------------------------------- | ----------------------- | ------------------------------------ |
| `Default`    | the Worker (Worker secret `SENTRY_DSN`, key of `PREVIEW_WORKER_SECRETS_JSON`) | `SENTRY_DSN`            | 50 errors per 3600 s (ASSUMED value) |
| `job-runner` | the job runner (function secret `SENTRY_DSN`, set by B8 step 5)               | `SENTRY_DSN_JOB_RUNNER` | 20 errors per 3600 s (ASSUMED value) |

Spike protection is on for the project. Read all of it back with the read-only token `SENTRY_AUTH_TOKEN` (`.env`,
loaded without printing):

```
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" "https://sentry.io/api/0/projects/matter-of-place/javascript-tanstackstart-react/keys/"
#   2026-10-02: job-runner active, rateLimit {"window":3600,"count":20}; Default active, rateLimit {"window":3600,"count":50}
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" "https://sentry.io/api/0/projects/matter-of-place/javascript-tanstackstart-react/"
#   options "quotas:spike-protection-disabled": false
```

The client is `src/server/lib/sentry.ts`, a hand-written envelope sender (no SDK). Each event carries the tags
`request_id`, `route`, `env`, `release` (`SENTRY_RELEASE`, `dev` when unset) and `side`; one event per
fingerprint per 60 seconds leaves an isolate, and a `429` or `X-Sentry-Rate-Limits` answer pauses every send for the
window it names. A failed send is one `sentry_send_failed` log line, never a retry.

Personal data stays out (GS-03). `scrubEvent` keeps an allow-list of fields and masks email-shaped text as `[email]`.
Two lines exist because Sentry adds data on its side, measured on 2026-10-02 with the test route:

- without `sdk.settings.infer_ip: "never"` the stored event held `user.ip_address` (the sender's IP) for a
  `javascript` event;
- with that setting the IP was gone, but `user.geo` (city and country) was still looked up from the connection IP.
  Relay skips the lookup when the event already holds a geo object, so the event carries `user: { geo: {} }`; with
  both, Sentry stored `user: null`.

The project setting "Prevent Storing of IP Addresses" (`scrubIPAddresses`) is off; it covers the IP only, not geo.

### Test that an error reaches Sentry

`POST /api/hooks/sentry-test` throws a marked error (its message holds `test@example.com`, which must arrive as
`[email]`) when the bearer equals `SENTRY_TEST_TOKEN`, compared in constant time; otherwise, and whenever the secret is
unset, it answers the R09 404 `{"error":{"code":"not_found","message":"...","requestId":"<id>"}}`, whose id equals the
`x-request-id` header: the pipeline hands its id to the handler as `context.requestId` (ASSUMED H39 (1)). The route
file is one wrapper line; the check lives in `src/server/hooks/sentry-test.ts`. A `GET` or `HEAD` on the same path
answers 405 `method_not_allowed` JSON, because the pipeline turns any page shell under `/api/` into R09 JSON (ASSUMED
H39 (2), GOTCHAS G-022), and so does any other method with any `Accept`: Start's bare 500 to a non-HTML `Accept`
becomes the same R09 405, or 404 on a path no API route file matches (GOTCHAS G-025). Neither reaches Sentry or
reveals the token. Locally:

```
# app/.dev.vars (git-ignored, values from .env, never printed): MOP_ENV=local, SENTRY_DSN, SENTRY_TEST_TOKEN (= PREVIEW_SENTRY_TEST_TOKEN)
bun run build && bun run cf:preview
curl -s -X POST -H "authorization: Bearer $PREVIEW_SENTRY_TEST_TOKEN" http://127.0.0.1:8788/api/hooks/sentry-test
#   HTTP 500 {"error":{"code":"server","message":"...","requestId":"<id>"}}
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" "https://sentry.io/api/0/projects/matter-of-place/javascript-tanstackstart-react/issues/?query=request_id:<id>"
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" "https://sentry.io/api/0/organizations/matter-of-place/issues/<issue id>/events/?query=request_id:<id>&full=true"
```

The issue appears within about 20 seconds. On production, set the secret only for the test and delete it right after:
`bunx wrangler secret put SENTRY_TEST_TOKEN --name matter-of-place`, then `bunx wrangler secret delete SENTRY_TEST_TOKEN
--name matter-of-place`.
