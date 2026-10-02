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

| Tool                    | Version | ASSUMED E11                                                                                       |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| node                    | 24.13.0 | same                                                                                              |
| bun                     | 1.3.13  | same                                                                                              |
| git                     | 2.55.0  | same                                                                                              |
| gh                      | 2.92.0  | same                                                                                              |
| Supabase CLI            | 2.98.2  | same                                                                                              |
| psql, pg_dump           | 18.4    | same                                                                                              |
| ffmpeg                  | 8.1     | same                                                                                              |
| python                  | 3.14.2  | 3.14                                                                                              |
| openssl                 | 3.5.7   | same                                                                                              |
| deno                    | 2.8.1   | same                                                                                              |
| wrangler through `bunx` | 4.146.0 | E11 says 4.145.0; `bunx` resolved the newer release today. Step 3 pins 4.145.0 as a devDependency |

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
