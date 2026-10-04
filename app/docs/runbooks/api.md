# Public API runbook

How the public API and its cache run, how to read one request, and how to prove the edge layer on this laptop. Slice B3 writes this page. Rulings cited are in `workspace/05-plans/ASSUMED.md` section H. The wire contract is `docs/architecture/services.md`; the caching contract is architecture section 13 and `docs/architecture/caching.md`.

## Worker environment

Names only. A value is never written here. Locally `node scripts/dev-vars.mjs` writes `app/.dev.vars` (git-ignored) from `.env`; deployed, the deploy jobs set plain variables and the secret bundle (`docs/runbooks/delivery.md`).

| Name                        | Kind           | Needed                            | Notes                                                                                 |
| --------------------------- | -------------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| `MOP_ENV`                   | variable       | always (defaults to `production`) | `local`, `preview` or `production`: decides indexing and which content shows          |
| `SENTRY_RELEASE`            | variable       | optional (reads `dev` when unset) | the commit SHA; it is part of every cache key                                         |
| `SUPABASE_URL`              | secret         | `MOP_ENV = production`            | the one project (H35); after the launch switch no preview holds it                    |
| `SUPABASE_SERVICE_ROLE_KEY` | secret         | `MOP_ENV = production`            | server side only, never a `VITE_*` name                                               |
| `TURNSTILE_SECRET`          | secret         | every `MOP_ENV` but `local`       | previews hold Cloudflare's always-pass test secret, production the real one           |
| `RATE_LIMIT_SALT`           | secret         | always                            | salts the IP hash; the raw address is never stored                                    |
| `SENTRY_DSN`                | secret         | every `MOP_ENV` but `local`       | leave empty locally to send nothing                                                   |
| `MEDIA_PUBLIC_BASE`         | variable       | optional, a warning is logged     | absolute `<origin>/media`; pages address media as the relative `/media/<key>`         |
| `RESEND_WEBHOOK_SECRET`     | secret         | optional, a warning is logged     | the Svix signing secret of the Resend webhook; the orchestrator adds it to the bundle |
| `CATALOG_VERSION_TTL_MS`    | variable       | optional                          | how long a worker isolate trusts its catalog version, 15000 by default, `0` in tests  |
| `VITE_API_BASE_URL`         | build variable | live builds                       | `/api/public`; unset gives the local adapter and `data-services="local"`              |
| `VITE_TURNSTILE_SITE_KEY`   | build variable | live builds                       | public by design                                                                      |

A build that sets `VITE_API_BASE_URL` renders `<body data-services="live">`; one that does not renders `local`. In Git Bash a value that starts with a slash is rewritten to a Windows path before the build reads it, so run `MSYS_NO_PATHCONV=1 VITE_API_BASE_URL=/api/public bun run build` on this laptop (GOTCHAS P-015). Continuous integration runs on Linux and needs no prefix.

## Turnstile

Cloudflare publishes test keys. The always-pass pair is the site key `1x00000000000000000000AA` and the secret `1x0000000000000000000000000000000AA`; the `2x` variants always fail and the `3x` secret answers "token already spent". A preview builds with the always-pass site key and holds the always-pass secret, so a form posts with the dummy token `XXXX.DUMMY.TOKEN.XXXX`. Production holds the real secret from `.env.ops` (`PROD_TURNSTILE_SECRET`), never the test value.

`verifyTurnstile` has three outcomes (GD-05):

- `pass`: the write goes on.
- `fail`: a wrong, missing or replayed token, a hostname the environment does not serve, or a wrong action. The write answers 403 and nothing is stored.
- `unreachable`: Cloudflare timed out (2 seconds), answered 5xx, or no secret is set. The write is accepted and the stored row carries `turnstile_ok = false`. The rate limits, the honeypot and that flag are the defences during a Turnstile outage. The admin badge that shows the flag in the queue belongs to B7 and is UNPROVEN until that screen exists; until then read it with `select id, created_at from inquiries where turnstile_ok = false`.

## The honeypot

Every public form carries one hidden text field named `website` (`honeypotFieldName` in `src/domain/contracts.ts`). The pipeline removes it before the schema runs. When it is filled the answer is a normal `201` with a fresh random id, nothing is written, no event is emitted, and one `honeypot` line is logged. Never reveal the field in an error.

## Rate limits

Writes only. A read costs no database write. Database limits count in `rate_limits`; memory limits are best effort per isolate and are backed by the Cloudflare rate-limit rule. The four form writes also take a first memory check of 30 per minute per IP before Turnstile and before any database call.

| Route                           | Limit                                    |
| ------------------------------- | ---------------------------------------- |
| `POST /inquiries`               | 10 per hour per IP, 5 per hour per email |
| `POST /submissions`             | 3 per hour per IP, 5 per day per email   |
| `POST /submissions/:id/uploads` | 12 per hour per IP                       |
| `POST /subscribers`             | 5 per hour per IP, 3 per hour per email  |
| `GET /subscribers/confirm`      | 20 per hour per IP                       |
| `POST /subjects/request`        | 3 per day per IP, 2 per day per email    |
| `POST /events`                  | 120 per minute per IP (memory)           |
| `POST /search`                  | 60 per minute per IP (memory)            |
| `POST /concierge`               | 30 per minute per IP (memory)            |
| `POST /client-error`            | 30 per minute per IP (memory)            |

A refused write answers 429 with `Retry-After`. The per-email numbers and the search, concierge and subject-request numbers are ASSUMED (architecture 9 asks for "per IP and per email" without values).

## Read one request by its id

Every response carries `x-request-id`, and an error body carries the same id as `error.requestId`. The Worker writes one JSON `request` line per request with that id, the route, the status, the hashed address and the milliseconds. To follow one request:

1. Take the id from the response header, or from the visitor's error page.
2. Find the line: `bunx wrangler tail matter-of-place --format json` and filter on the id (the tail needs the local admin token, not the deploy token), or search the Worker logs in the Cloudflare dashboard.
3. An unhandled error also reaches Sentry with the id as the tag `request_id`.

A stored (cached) response never holds an id: the pipeline adds one after the lookup, so two requests for the same page carry two ids.

## Cache layers and `x-mop-cache`

A warm public read costs zero database queries (S52). Three layers answer before the database:

1. The browser's TanStack Query cache. The server render dehydrates what the loaders fetched and the browser hydrates it, so a page load makes no second catalog request; `staleTime` is 5 minutes.
2. A memory layer per isolate: the state (`catalogVersion`, flags, coming-soon, site settings) is checked at most every 15 seconds, the catalog snapshot is read only when the version changes.
3. The Worker's Cache API under the key `https://cache.mop.internal/<release>/v<catalogVersion>/<kind>/<pathname>`, where `kind` is `html`, `json` or `doc`. The query string is dropped and no cookie or request header changes the key. A publish changes `catalog_version`, so every key changes within 15 seconds and nothing is purged.

Every public response carries `x-mop-cache`:

| Value    | Meaning                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------- |
| `hit`    | answered from the edge cache                                                                       |
| `miss`   | built and stored; the next request is a `hit`                                                      |
| `stale`  | the database could not be read and the last good copy answered: the smoke test fails on it (DO-09) |
| `bypass` | never stored: writes, errors answered before the service, `no-store` responses                     |

A public GET also carries `x-catalog-version`. The Cache API does nothing on `workers.dev` hostnames and in `vite dev`, so a preview answers `miss` every time and runs on the memory layer alone. With no last good copy and no database the answer is 503 `unavailable`.

### Purging

Catalog entries never need a purge: the key holds the catalog version. One address is purged by URL, for example a photograph after a takedown, through the zone's purge API with the narrow Cache Purge token (B8b's `purge_cache` job, tags `catalog` and `seo`). `workers.dev` has no zone, so there is nothing to purge there. This is UNPROVEN until L1 attaches the custom domain.

### Prove the edge layer here

The Cache API works under local `wrangler dev` (E16). Stop any dev Worker first (GOTCHAS P-042), then:

```
MSYS_NO_PATHCONV=1 VITE_API_BASE_URL=/api/public VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA bun run build
rm -rf ../.tmp/wrangler-cache-proof
cp .dev.vars .output/server/.dev.vars
bunx wrangler dev --config .output/server/wrangler.json --port 8788 --persist-to ../.tmp/wrangler-cache-proof
node scripts/cache-proof.mjs http://127.0.0.1:8788
```

A fresh `--persist-to` folder makes the first request a miss; delete the folder afterwards. The script exits 0 after printing: `miss` then `hit` for `/api/public/properties` with the same `x-catalog-version`, `hit` for `?x=1` and `?x=2`, 304 for `If-None-Match` with the returned ETag, `miss` then `hit` for the cached 404, `bypass` for `POST /api/public/events`, `miss` then `hit` for `/` with equal policy headers, and `hit` for `/properties` after `/properties?q=zzz` with every property slug present (the server render ignores `q`).

For the media route put one object into the public `media` bucket first with the service role key, then pass its key:

```
node scripts/cache-proof.mjs http://127.0.0.1:8788 --media-key proof/photo.00000000.jpg
```

It checks 200 `miss` with `public, max-age=31536000, immutable`, then `hit` with the same length, and a 404 with `no-store` for a missing key. The key must start with a letter or a digit; the route refuses any other first character before it reads Storage. Remove the object afterwards with `deleteObjects("media", [key])` from `src/server/lib/media-store.ts`.

### Read a warm-read call count

`src/server/lib/db.ts` counts every request to Supabase (`dbCallCount()`, `resetDbCallCount()`). No route, header or log line exposes it. The cases of `tests/api/cache.api.test.ts` call a page or a route twice and assert that the counter moves only by state checks. H1 counts the real queries with `pg_stat_statements` and measures the 95 percent hit ratio on the custom domain; neither is proved by this slice.

## Redirects

`resolveRedirect` runs before routing for GET and HEAD requests outside `/api`, `/admin`, `/media` and static files. It reads the catalog snapshot, never a table, and merges two sources into one map per catalog version: the enabled rows of `redirects`, and `/property/<old>` to `/property/<current>` (301) for every old slug of a property that is still published. A row of `redirects` wins. The map is rebuilt when the catalog version changes, which a change of `redirects` or `slug_history` bumps, so an edit reaches a visitor within the 15 second memo. A redirect chain is not followed: one hop only.

## Media route

`GET /media/<key>` serves a published file from the public `media` bucket on our own domain (H33 (3), (4)). There are three buckets in the one project: `submissions` (private uploads), `media` (public published files) and `documents` (private invoices and reports). The route makes no database call. The key must match `^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$` with no `..` segment, otherwise 404 with no Storage read. A Storage 200 is stored under its own URL and answered with `public, max-age=31536000, immutable` (a key carries a content hash, so a stored file never changes); a missing object is 404, any other Storage answer 503 `storage_unavailable`, both `no-store`. To purge one address after a takedown, see Purging above.

## Subject requests

`POST /subjects/request` stores a `subject_requests` row with `due_at = received_at + 45 days` and answers a `Receipt` that never says whether a record exists for the email. Nothing is fulfilled inside the request. A person on the team checks identity by replying to the requester's own address, then exports or deletes by hand from B7 screen 25 (UNPROVEN until that screen exists: until then use `bun run db:psql`). The clock of 45 days runs from `received_at` and the email is never logged.

## Search

`POST /search` and `POST /concierge` run in the Worker over the memoised snapshot (a token index built on the first call of a catalog version). pgvector is revisited only above 500 published properties; check with `select count(*) from properties where editorial_state = 'published'`. The single-snapshot design is revisited at the same size (architecture 13).

## The smoke test and the bundle check

`node scripts/smoke.mjs <baseUrl>` also checks the catalog read and a beacon when the home page says `data-services="live"`: `/api/public/properties` must answer 200 with `x-catalog-version` and `x-mop-cache` of `hit` or `miss` (a `stale` answer fails), and `POST /api/public/events` must answer `x-mop-cache: bypass`. On a local-adapter build it prints `api checks skipped (local adapter)` and goes on (H35 (7)).

`node scripts/bundle-check.mjs` runs in the `build` job of CI on the live artifact. Every public route stays under 153600 gzip bytes of first-load script, no chunk a public route can reach is the entry of `src/data/` (except the pricing and FAQ copy), `src/admin/` or `src/domain/admin-*`, and no title of the bundled seed properties is in any built file. It exits 1 on a local-adapter build, which carries the seed.

## Not yet proved

- The preview lines (`data-services="live"` on a pull request, `api-smoke.mjs` against it, `x-mop-cache: miss` on workers.dev) wait for the repository variable `VITE_API_BASE_URL`, which the orchestrator sets after this slice is accepted. UNPROVEN until then.
- The production Worker's secrets are put by the owner (`docs/runbooks/delivery.md`). UNPROVEN while the repository variable `PRODUCTION_DEPLOY` is off.
- The edge layer on the custom domain and the 95 percent ratio are L1's and H1's.
