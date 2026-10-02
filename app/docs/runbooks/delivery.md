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

`bun run test` passes `--testTimeout=60000 --hookTimeout=60000` (ruling H49 (3)): with two lanes building on this laptop, tests that spawn processes ran past vitest's 5 s default and read as failures (GOTCHAS G-031); CI runners are not loaded and keep their speed.

## Free plan consequences

- Branch protection of `main` is not available: `gh api repos/AbdulrahmanAmer/matter-of-place/branches/main/protection`
  answers HTTP 403 `Upgrade to GitHub Pro or make this repository public to enable this feature` (GOTCHAS P-028).
- Environments with required reviewers are not available on a private repository of this plan (ASSUMED E9).

## Dependabot

`.github/dependabot.yml` asks for grouped minor and patch pull requests every Monday at 06:00 America/New_York, for the
app (`bun`, directory `/app`) and for the workflow pins (`github-actions`, directory `/`). GitHub reads the file only
from the default branch: on 2026-10-02
`gh api 'repos/AbdulrahmanAmer/matter-of-place/contents/.github/dependabot.yml?ref=main'` answers HTTP 404, because
the file is still on `slice/b1b` only.

UNPROVEN until the file is on `main` and the first Monday after that (ruling ASSUMED H42 (4)). Then
`gh pr list --author "app/dependabot" --state all` lists at least one pull request, and that run shows whether the
`bun` ecosystem name is accepted (ASSUMED; the plan's fallback is `npm` on the same directory, recorded here if used).
A Dependabot pull request gets no Actions secrets, so `scripts/merge-gate.mjs` does not require `preview` on it
(invariant 8).

## Migration order check

`node scripts/check-migrations.mjs` is the `migration-order` step of the CI `check` job (`bun run migrations:check`
on the laptop). It refuses a migration already on `main` that the branch edits, renames or deletes, a new file whose
version is not after the newest on `main`, and a new file with a destructive change that has no
`-- contract-of: <version>` line in its first 30 lines, or whose line names a version that is not on `main` (ASSUMED
H44 (1)).

Destructive means: every drop and every rename of an object, a column type change, `set not null`, a new NOT NULL
column without a default, and `truncate` (H44 (2)). These pass: dropping a trigger or a policy; renaming a policy,
trigger, index or constraint; dropping a function or procedure when a later statement of the same file creates one of
every schema and name it drops, which is how `bun run db:fn` changes a signature (H43 (1)); `alter publication ... drop
table` and `alter extension ... drop`, because they take an object out of a list and lose nothing (H43 (2)).

The function drop passes only in the form `db:fn` writes. A drop with `cascade` always needs the header: it also
removes every view, policy, column default and stored generated column that uses the function, and the file does not
create those again. Without `cascade` Postgres refuses the drop while anything depends on the function. A create that
comes before the drop does not count, because the drop could remove it.

What the scan does not read (H43 (4), H44 (2)). A reviewer reads every migration that uses any of these:

- SQL built at run time, with `format()` or by joining strings;
- a function named in quotes;
- a trigger created by an earlier migration, whose function this file changes;
- a table whose name equals a function's name, which reads as a call of that function;
- `delete from`: a change to data, not to the schema;
- the argument types of a dropped and a created function: a drop of `f(int)` passes when the file creates any `f`
  after it;
- `set search_path`: a function name without a schema is read as `public`;
- a function created inside a DO block or by `execute`: it never counts as created, so the drop before it is refused.

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
- A request the router refuses because its `Accept` holds neither `text/html` nor `*/*` (Start answers a bare 500
  `{"error":"Only HTML requests are supported here"}`, GOTCHAS G-025) gets R09 JSON with `no-store`: under `/api/` 405
  `method_not_allowed` when an API route file matches the path, else 404 `not_found`; on a page 406 `not_acceptable`
  (ASSUMED H41 (1)). A page asked for with `Accept: text/html` is untouched.
- One answer comes from Start before any of our code runs and carries no `x-request-id` and no security header,
  accepted as it is (ASSUMED H41 (2)): a path that starts with `//` gets a bare 308 to the single-slash path. H1's
  header sweep leaves `//` paths out. A trailing slash under `/api/` gets the router's 307 to the path without it
  (H41 (3)); that answer goes through `handle()`, so it carries `x-request-id`, `no-store` and every security header
  (measured under `cf:preview`), and the sweep covers it.
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
ran the report to completion there, and the preview `pr-44` did the same on a deployed Worker (section Previews).

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

### Knip configuration hints that stay

`bun run knip` exits 0 and prints two hints, each about a file a later slice creates (ASSUMED H41 (6), GOTCHAS P-065).
A hint that names a file that exists today is a defect and was cleared in step 4b (`src/routeTree.gen.ts`,
`src/router.tsx`).

| Hint                                        | Cleared by                                                     |
| ------------------------------------------- | -------------------------------------------------------------- |
| `src/db/types.ts`: remove from `ignore`     | B2, when `bun run gen:types` writes the file and knip finds it |
| `supabase/functions/*/index.ts`: no matches | B8, when `supabase/functions/job-runner/index.ts` exists       |

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

## Smoke

`node scripts/smoke.mjs <baseUrl> [--expect-noindex|--expect-indexable]` (`bun run smoke <baseUrl>`) is the last step of
every deploy job (gate G22). It prints one line per URL and exits 1 naming each failing one:

- `/`, `/properties`, `/markets`, `/california`, `/stories`, `/submit`, `/contact`, `/sitemap.xml` answer 200 with
  `x-request-id`, `nosniff` and `X-Frame-Options: DENY`;
- `X-Robots-Tag: noindex, nofollow` on every `.workers.dev` host, none on `matterofplace.com`, and the flag on any
  other host (default noindex); a flag that contradicts the host exits 2 before any request;
- `/` answers `max-age=0, must-revalidate`, and a second request of `/` carries another request id;
- the first `/assets/*.js` of the home page answers `immutable, max-age=31536000` with `nosniff` (Nitro's rule), and
  `/media/tiburon-waterline.mp4` answers `max-age=604800` (our `public/_headers`);
- `POST /api/hooks/sentry-test` answers `Cache-Control` exactly `no-store`, whatever its status.

Requests do not follow redirects, so a redirect is a failure. A refused connection is retried twice, one second
apart (GOTCHAS P-054). `SMOKE_FORCE_FAIL=1` prints `smoke forced to fail (SMOKE_FORCE_FAIL)` and exits 1 before any
request; the `dev` job uses it to rehearse its rollback (DO-09).

## Previews

`.github/workflows/deploy.yml` runs three jobs on a pull request into `main`. Each refuses a fork and Dependabot, and
none links, migrates or reads the database (invariant 13).

- `preview-db` runs on every push, drafts included. When the pull request changes a `supabase/migrations/*.sql` file
  since it left `main` (`git diff base...head`, three dots, so a migration that only `main` gained does not count), it
  posts one comment starting `preview-db:` and never a second. The preview runs against `main`'s schema until the
  migration merges (DB-01).
- `preview` runs once the pull request is ready for review and `CI_HEAVY` is not `off`. It builds with the HAS_DB
  switch (invariant 13a), deploys the Worker `pr-<n>` with `MOP_ENV`, `SENTRY_RELEASE` (the merge commit) and
  `MEDIA_PUBLIC_BASE`, then pushes the whole `PREVIEW_WORKER_SECRETS_JSON` with `wrangler secret bulk`, waits until
  the Worker answers ten times in a row, runs the smoke against `https://pr-<n>.holy-meadow-4327.workers.dev` and
  comments that address once (`preview: <url>`).
- `preview-cleanup` runs when the pull request closes and deletes `pr-<n>`. It shares the preview's concurrency group
  and waits, so a preview still deploying cannot bring the Worker back after the delete. A pull request closed before
  any preview has no Worker; Cloudflare answers `This Worker does not exist on this account. [code: 10090]` (measured
  2026-10-02 with `bunx wrangler delete --name pr-990001 --force`, exit 1), and only that answer is forgiven.

Previews run on the local services adapter until B3's last step sets the repository variable `VITE_API_BASE_URL` again.
A Worker name deployed for the first time is polled until it answers ten times in a row before the smoke runs.

Until B3 serves `/api/public/*`, a preview built while the bundle holds a database pair is in live mode and its catalog
pages answer 500. Measured 2026-10-02 under `bun run cf:preview` on a build with `VITE_API_BASE_URL=/api/public`: `/`,
`/properties`, `/markets`, `/california` and `/stories` answered `500 text/html`, `/sitemap.xml` `500 application/json`,
`/submit` and `/contact` 200. The server render calls the API with a relative address, which a Worker cannot fetch
(GOTCHAS P-134). The deployed preview of probe PR #51 answered the same: 500 on those six, every other check of the
smoke green. So the orchestrator removed `VITE_API_BASE_URL` (ruling H48): the build line then gives an empty value
whatever `HAS_DB` says, and the build takes the local adapter.

A Worker name deployed for the first time answers Cloudflare's own 404 (`cache-control: private, max-age=0, no-store,
...`, no header of ours) now and then for about 20 seconds (GOTCHAS P-137). Probe PR #44 smoked two seconds after the
deploy and every URL got that 404; PR #50 waited for one answer of ours and most URLs still got it. The `wait` step
therefore asks for ten answers with `x-request-id` in a row, at most 180 s; on PR #51 it took 13 requests. A redeploy of
an existing name does not show it, but the first deploy of `matter-of-place` and `matter-of-place-dev` (step 7) will.

The preview reports to Sentry with its own release. Measured on `pr-44`: `POST /api/hooks/sentry-test` with the bundle's
`SENTRY_TEST_TOKEN` answered 500 with request id `b19bd10d-e8cb-4e3e-9731-4b167a98b66d`, and the stored event carried
`env` `preview`, `release` `af010c0169b1c1fe3c5060f6122076055aca98ab` (the merge commit the deploy line printed) and
`user` null. So `waitUntil` runs the report to completion on a deployed Worker too.

Cost, measured on 2026-10-02 (PRs #43, #44, #50, #51): `preview-db` 11 to 19 s, `preview` 38 to 60 s, `preview-cleanup`
19 s, each billed as one whole minute. A push to a draft costs 1 Actions minute in `deploy.yml`, a push to a ready pull
request 2, closing it 1, on top of `ci.yml`.

`wrangler secret bulk` (4.145.0) deletes a key whose value is `null` in the JSON it reads (`bunx wrangler secret bulk
--help`); a key that is simply absent stays on the Worker.

## Deploys from main

`.github/workflows/deploy.yml` deploys from `main` only after `ci` passed on a push to `main` (`workflow_run` of `ci`,
invariant 6a). Both jobs check out the commit that `ci` tested (`github.event.workflow_run.head_sha`; on this event
`github.sha` is the newest `main`, not necessarily the tested one).

- `dev` deploys `matter-of-place-dev`. When `main` holds a migration it first links the one project and runs
  `bun run db:push` (the one database step of the workflow, invariant 13); a failed push ends the job before the
  Worker deploy. It builds like a preview (the Turnstile test key, `VITE_API_BASE_URL` from `HAS_DB`), deploys with
  `MOP_ENV` from `HAS_DB`, pushes the whole `PREVIEW_WORKER_SECRETS_JSON` with `wrangler secret bulk`, waits for ten
  answers in a row, smokes `https://matter-of-place-dev.holy-meadow-4327.workers.dev` and rolls back on a red smoke.
  It also runs on `workflow_dispatch` from `main`, for the rollback rehearsal.
- `production` runs only while the repository variable `PRODUCTION_DEPLOY` is `on` (ruling H49 (1)). Production never
  shows an illustrative property, and until B3b's coming-soon mode is on `main` a production build would show the
  illustrative catalogue, so the orchestrator keeps the variable `off` (`gh variable list`) and sets it to `on` with
  `gh variable set PRODUCTION_DEPLOY --body on` once B3b has merged; until then a merge deploys `dev` only. It waits for
  `dev` (`needs: dev`), so the database is migrated before the production Worker deploys and a red `dev` skips it. It links no project and pushes no migration. It builds with the repository variables
  (`VITE_SITE_URL`, `VITE_API_BASE_URL`, `VITE_TURNSTILE_SITE_KEY`), deploys `matter-of-place` with `MOP_ENV` left at
  the `wrangler.toml` default `production`, waits, smokes `https://matter-of-place.holy-meadow-4327.workers.dev` and
  rolls back on a red smoke. Its only secrets are `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

Both pass `SENTRY_RELEASE` (the tested commit) and `MEDIA_PUBLIC_BASE`: the dev Worker's own origin plus `/media`, and
for production its `workers.dev` origin plus `/media` until L1 sets the repository variable `MOP_LAUNCHED` to `true`
at the domain cut-over, then `https://matterofplace.com/media` (H33 (4)). No workflow line changes for the cut-over.

While the repository variable `VITE_API_BASE_URL` is absent (ruling H48, until B3's last step sets it), a production
build takes the local services adapter like every preview, which is the illustrative content; that is why `production`
waits for `PRODUCTION_DEPLOY`.

### The deploy guard

The first step after the checkout of both jobs is `node scripts/deploy-guard.mjs <sha>` (gate G24). It runs
`git rev-list <sha>..origin/main -- . ':!workspace' ':!launch' ':!*.md'` from the repository root: a commit listed
there is a newer code commit already on `main`, whose own run deploys it. Then the guard prints `superseded <sha>`,
writes `superseded=true` to `$GITHUB_OUTPUT` and every later step is skipped; the job ends green and deploys nothing.
Otherwise it prints `deploying <sha>`. A commit that only changes `workspace/`, `launch/` or Markdown files runs no CI
(`paths-ignore` of `ci.yml`) and supersedes nothing. So a re-run of an older green `ci` run never deploys old code
over new. A `superseded` line in a run's log is expected after such a re-run, not a fault.

### Smoke, rollback and the alert

A first deploy of a Worker name answers Cloudflare's own 404 now and then for about 20 seconds (GOTCHAS P-137), so
both jobs wait for ten answers with `x-request-id` in a row, at most 180 s, before the smoke. When any step after the
deploy fails (the secrets push of `dev`, the wait or the smoke), the step `rollback` runs with the deploy token
(Workers Scripts Write is enough, ASSUMED E1) and the job ends red. GitHub's failed-run email to the owner is the
alert; there is no automatic retry, and the fix is a new commit.

The rollback of `dev` names its target (ruling H49 (2)). Before the deploy, the step `current` reads the version
serving 100 percent from `bunx wrangler deployments list --name matter-of-place-dev --json` and prints `serving: <id>`;
the rollback runs `bunx wrangler rollback <id> --name matter-of-place-dev --message "smoke failed <sha>" --yes` and
prints `rolled back to <id>`. Without an id, wrangler 4.145 takes the newest deployment but one
(`fetchDefaultRollbackVersionId`), and in `dev` that is the deploy of the failing code, because the secrets push made
the newest deployment. When the Worker does not exist yet Cloudflare answers code 10007, the step prints
`serving: none`, and a red smoke then ends with `first deploy: nothing to roll back to`. Any other answer of the list
fails the step before the deploy. `production` pushes no secret after its deploy, so its rollback without an id
returns to the version that served before it.

Rehearsal of the rollback step (DO-09, step 7b): `gh workflow run deploy.yml --ref main -f rehearse_rollback=true`
runs `dev` alone with `SMOKE_FORCE_FAIL=1`, so its smoke prints `smoke forced to fail (SMOKE_FORCE_FAIL)`, the rollback
step runs, and `bunx wrangler deployments list --name matter-of-place-dev` shows the previous version active. A second
run with `rehearse_rollback=false` deploys the current commit again. `production` never runs on `workflow_dispatch`.

### By hand, from the owner's shell

With `.env` loaded without printing it (ASSUMED E10), from `app/`:

- A production secret, once the Worker exists (secrets persist across deploys): `printf %s "$SENTRY_DSN" | bunx
wrangler secret put SENTRY_DSN --name matter-of-place`. The other production secrets are B3 step 8's.
- Roll back to a chosen version: `bunx wrangler versions list --name matter-of-place`, then `bunx wrangler rollback
<version-id> --name matter-of-place --message "<reason>"`. The deploy token can do this (Workers Scripts Write).
- Deploy without Actions (out of minutes): `bun run build && bun run deploy:prod --var
MEDIA_PUBLIC_BASE:https://matter-of-place.holy-meadow-4327.workers.dev/media`. `deploy:prod` passes
  `SENTRY_RELEASE` as the checked-out commit; without the extra `--var` the Worker keeps the `wrangler.toml` default
  `https://matterofplace.com/media`, right only after the domain cut-over.

### CPU time per request

The free Workers plan allows 10 ms of CPU per request (P-009). Measure from the owner's shell with the local admin
token (the deploy token cannot tail, ASSUMED E1): start `bunx wrangler tail matter-of-place --format json`, request
`/`, `/properties`, `/california`, `/markets` and `/submit` five times each, and read the `cpuTime` of each event.
Compare with ASSUMED E3 (home 6 to 52 ms, collection 10 to 24 ms on the throwaway Worker). A first request above the
limit after a catalog version bump on the 100-property fixture is the revisit trigger of architecture section 13;
that case waits for B2's snapshot-budget fixture and B3's `getCatalog`.

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
