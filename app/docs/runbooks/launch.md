# Launch

The live sequence of plan L1 (`workspace/05-plans/L1.md`, section Steps), with the commands as run and the time each one ran. The plan holds the steps; this file holds what happened. A red step pauses the launch at that step; nothing here is skipped.

## Before the launch

Step 0a built the tools below. Step 0b is the operator-input gate: from the repository root, `node workspace/05-plans/ready.mjs --launch --full` prints no `WAIT` and no `FAIL` line and ends `READY TO LAUNCH: yes`. Step 2 does not start while it exits 1.

| Tool                                      | Step       | What it proves                                                                                   |
| ----------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| `scripts/launch/preflight.mjs`            | 1h         | Secret names, digests, GitHub names and the one database after the switch, one line per check    |
| `scripts/rehearsal.ts`                    | 2          | The whole path on the one database before the switch, row by row                                 |
| `scripts/launch/verify-production.mjs`    | 5          | Coming-soon from outside: no listing, empty markets with the signup, robots, redirects, policy   |
| `scripts/launch/registrar-check.mjs`      | 4a, 4g, 10 | Expiry, transfer lock, Cloudflare nameservers, and with flags DNSSEC and the HSTS preload        |
| `scripts/launch/verify-cache.mjs`         | 4h         | The edge cache on the domain: hits, the key, no cookie, the stored policy, `no-store`, hit ratio |
| Pull request 288 (`slice/l1-auth`, draft) | 1c         | The launch values of `[auth]` in `supabase/config.toml`, merged inside the switch and not before |

Each launch script prints one line per check, `ok` or `red`, and exits 1 on any red line. `verify-cache.mjs` also prints `skip` lines, and `preflight.mjs` prints one `BLOCKED linkedin application pending` line while LinkedIn's tokens are absent, which does not change its exit code.

### Preflight

From `app/`, in the owner's shell: `eval "$(node scripts/load-env.mjs --profile dev)"` for `DEV_DB_URL`, then the admin tokens `CLOUDFLARE_API_TOKEN` and `SUPABASE_ACCESS_TOKEN` (the ops profile), then `node scripts/launch/preflight.mjs`. Check 7 reads `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET` from the root `.env` and the two `PROD_RESEND_` names from the root `.env.ops`, and compares SHA-256 digests in memory. Before the switch the function, variable and database lines are red with `database not production yet`; that is expected. `--fixture-dir scripts/launch/fixtures/preflight-bad` reads recorded name lists instead of asking `wrangler`, `supabase secrets list` and `gh` (watched-fails k and o); the H1, database and stub lines still run live.

Measured on 2026-10-11 against the build stage: check 6 is red with five markers other than `post-v1` (`src/server/jobs/steps/render-specs.ts`, `src/server/jobs/steps/render-variants.ts`, `src/server/lib/crypto.ts`, `scripts/lib/oauth-consent.ts`, `scripts/meta-check.ts`). Each must be resolved by its owning slice before step 1h can pass.

### Rehearsal

`bun run scripts/rehearsal.ts --env dev --base http://localhost:8080 --property scripts/fixtures/first-property.json`, with the dev profile loaded and `REHEARSAL_AGENT_KEY` in `.env`. It refuses with `refusing: production database` once the switch has run. Run it in a shell without ops names: right after the production check it calls `guardEnv()` (SEC-08), which refuses a shell holding a `PROD_` or `BACKUP_` name, `SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_API_TOKEN` or `CF_EDGE_TOKEN`, before any row is written. The function secret list it reads needs `SUPABASE_ACCESS_TOKEN`, so the script reads it from the root `.env` and passes it to that one command only, and it never reaches the test sender of row 9. Two places where the script follows the code rather than the plan text: the rank call is `PUT /api/admin/properties/<id>/rank`, and the photo order is `POST /api/admin/media/reorder` (the property `PATCH` carries no order). Row 7 polls the assets through `DEV_DB_URL`, because the property detail answer holds no assets.

### Edge cache on this machine (step 4h, local part)

From `app/`: `bun run build`, then `bun run cf:preview -- --persist-to <a new empty folder>` in the background, wait with `until curl -s -o /dev/null http://127.0.0.1:8788/robots.txt; do sleep 1; done` (a probe on `/` would store the home page, and the first measured answer would be a hit), then `node scripts/launch/verify-cache.mjs http://127.0.0.1:8788 --local`. Under `--local` three lines print `skip`: HSTS and the HTTPS redirect (plain http), and `robots.txt` (B13 stores it only for the indexable host, so a local Worker answers it uncached on purpose). One line runs only under `--local`: `policy miss and hit` is red when no page answered `miss` first, because then the policy comparison compared two hits. Stop the server by its parent process (GOTCHAS P-042) and confirm the port has no listener.

Measured on 2026-10-11 on a lane preview of the build: every other line `ok` except `missing page cached 60 s`, which is red. A missing page answered 404 with `public, max-age=0, must-revalidate` and `x-mop-cache: bypass` on two requests in a row, so it is not stored at the edge, while architecture 13 says a 404 is stored for 60 seconds (only the JSON 404 of `/api/public/*` is). The slice that owns the cache hook (`src/server/public/cache.ts`) decides the fix, and this line stays red until then (GOTCHAS P-3400).

## Launch log

Times are written as `date "+%Y-%m-%d %H:%M %z"` prints them (GOTCHAS P-130).

| Step | Started | Ended | Result | Proof |
| ---- | ------- | ----- | ------ | ----- |

## DNS records

The table before the change is written in step 4a, the table after in step 4d.

| When | Name | Type | Value | TTL |
| ---- | ---- | ---- | ----- | --- |

## Domain

Registrar Namecheap, nameservers Cloudflare (`abdullah.ns.cloudflare.com`, `laila.ns.cloudflare.com`). The registry's RDAP record read on 2026-10-11 gives the expiry `2028-09-27T02:48:38Z` and the status `client transfer prohibited`. Whether auto-renew is on and its payment method outlives the first renewal is a signed manual check, because RDAP does not show it.

## Rollback triggers

Agreed in advance: 5xx rate above 2 percent for 10 minutes on the Workers dashboard, or a render-gate failure on a key page, or the coming-soon check failing after cut-over. Action: `bunx wrangler rollback`, as `docs/runbooks/rollback.md` section 2 gives it, then investigate. DNS is not rolled back unless the certificate or the delegation itself is the fault. For a job-runner fault after a merge the plan names B8's `rollback-runner.sh`, which is not in the repository on 2026-10-11: that path is UNPROVEN until it exists.
