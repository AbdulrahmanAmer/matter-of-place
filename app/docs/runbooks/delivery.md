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
- Until B3 lands, the cache hook is a pass-through, the flags are empty, and error reports are not sent (the stub
  markers in `src/start.ts` name each replacement; the Sentry client arrives in step 4).

### Where `waitUntil` and the environment come from

`import { waitUntil } from "cloudflare:workers"` does not build: `vite build` fails in the `ssr` service because
Nitro lists the module as external only for its own final bundle (GOTCHAS G-018). `src/start.ts` takes `waitUntil` from
the request instead: Nitro's `augmentReq` puts the Worker's bound `waitUntil` on it. Measured in step 3 under
`wrangler dev`: the parse succeeded on every request. `process.env.MOP_ENV` is populated from the Worker variables and
secrets by `nodejs_compat`, so `start.ts` reads it there. Under `bun run dev` there is no Worker and no `waitUntil`;
the fallback starts the promise and leaves it. A Sentry event reaching Sentry (step 4) is the proof that `waitUntil` ran.

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
