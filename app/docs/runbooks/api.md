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

A public GET also carries `x-catalog-version`. The Cache API stores and serves on `workers.dev` hostnames (on `pr-100` two requests in a row of `/api/public/properties` printed `x-mop-cache: hit`), so a preview answers `miss` for a page or JSON address that its data center does not hold: the first request after a deploy and the first after a catalog change (the key holds the release and the catalog version), the first in a data center that has not stored it (the Cache API is per data center), and the first after a stored 404 expires (a cacheable 404 is kept 60 seconds). A `/media` address is not keyed by release or version, only by origin and path. There is no Worker in `vite dev`, so no edge layer there. With no last good copy and no database the answer is 503 `unavailable`.

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

## Site identity

`settings.site` holds the legal entity, the registered address, the contact email and phone and the social links. The pages, the route below and the identity lines of the emails read it through the shared public state (`getSiteSettings`), not from the table; the one reader of the row itself is the reply address of `send_email`.

| Route                  | Answers                                                                              | Cache                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `GET /api/public/site` | `PublicSite`: the `settings.site` leaves (null when unset) and `illustrativeContent` | json kind: `Cache-Control: public, max-age=60, s-maxage=31536000`, `Cache-Tag: catalog` |

The headers are read from the route row and the json cache kind (`browserCacheControl`, `toStored`), not measured with curl on a deployed Worker: UNPROVEN until a preview answers. `illustrativeContent` is forced to false when `MOP_ENV` is `production`. A write bumps `catalog_version` in the same transaction (B2's trigger on `settings`), so each isolate sees the new value within its 15 second memo and the cached answer is keyed to the new version.

Until screen 24 is used, `scripts/set-site.ts` is how the row is written. Run it from `app/` in a Git Bash shell with the dev profile loaded:

```
eval "$(node scripts/load-env.mjs --profile dev)"
bun run scripts/set-site.ts --file scripts/fixtures/site.example.json
```

- `site.example.json` sets a fake entity, a fake address and a phone, and the Instagram link, leaving `social.x` and `social.linkedin` null; it is for tests only. `site.empty.json` restores the shared `mop-dev` row to the seeded default: `contact.email` `hello@matterofplace.com`, `contact.privacy_email` `privacy@matterofplace.com`, every other leaf null. The database is shared, so run the empty fixture when you are done.
- It prints `missing: <the required keys still unset, space separated>`, or `missing: none`. A schema error prints the failing field paths and an RPC error prints its code; both exit 1 and change nothing, so run the same command again.
- It refuses with `refusing: production database` and exits 1 once L1's launch switch has made the one database production (ruling H35 (5)). After that, screen 24 is the only writer and enters the real values.
- It takes the `mop-dev-tests` advisory lock first and waits while another writer holds it, so the write does not land beside a test run or a seed. When `MOP_DEV_LOCK_HELD=1` is set the parent already holds the lock and the script does not take it.

The daily `health` job has a `site_identity` check. With every required field set it passes. With fields missing it warns when the function's `MOP_ENV` is `development` or `preview` and fails otherwise, an unset value included; a failure reaches the operator as a `health.failed` event. It also fails with `public_state_stale` when the database did not answer and only a last good copy was left, because that copy proves nothing about the present row.

## Search

`POST /search` and `POST /concierge` run in the Worker over the memoised snapshot (a token index built on the first call of a catalog version). pgvector is revisited only above 500 published properties; check with `select count(*) from properties where editorial_state = 'published'`. The single-snapshot design is revisited at the same size (architecture 13).

## The smoke test and the bundle check

`node scripts/smoke.mjs <baseUrl>` also checks the catalog read and a beacon when the home page says `data-services="live"`: `/api/public/properties` must answer 200 with `x-catalog-version` and `x-mop-cache` of `hit` or `miss` (a `stale` answer fails), and `POST /api/public/events` must answer `x-mop-cache: bypass`. On a local-adapter build it prints `api checks skipped (local adapter)` and goes on (H35 (7)).

`node scripts/bundle-check.mjs` runs in the `build` job of CI on the live artifact. Every public route stays under 153600 gzip bytes of first-load script, no chunk a public route can reach is the entry of `src/data/` (except the pricing and FAQ copy), `src/admin/` or `src/domain/admin-*`, and no title of the bundled seed properties is in any built file. It exits 1 on a local-adapter build, which carries the seed.

## CPU and egress of the routes

Free Workers allow 10 ms of CPU a request (G-011, P-009). Page CPU was measured on a deployed Worker in 2026-10 (E3: `/` 6 to 52 ms, `/properties` 10 to 24 ms, no error 1102 in 36 requests). API route CPU comes from `cpuTime` in `wrangler tail`, which `wrangler dev` does not report: it is measured on a deployed preview (section "CPU on a preview" below), where `POST /api/public/submissions` and a cold isolate pass 8 ms.

Measured here, 2026-10-04, on the live build under `wrangler dev` (port 8828) against `mop-dev`, five requests per route. These are wall times through curl on this laptop, not CPU, and they carry no network. They bound nothing on the edge:

| Route                              | Response bytes | `x-mop-cache` | Wall, ms                               |
| ---------------------------------- | -------------- | ------------- | -------------------------------------- |
| `GET /api/public/properties`       | 9,510          | hit           | 11 to 27                               |
| `GET /api/public/properties/:slug` | 1,781          | miss then hit | 18 to 21 on a miss, 16 to 20 on a hit  |
| `GET /api/public/markets`          | 10,919         | hit           | 11 to 19                               |
| `GET /api/public/markets/:slug`    | 3,848          | miss then hit | 21 on a miss, 11 to 16 on a hit        |
| `GET /api/public/stories`          | 4,046          | hit           | 11 to 14                               |
| `GET /api/public/stories/:slug`    | 826            | miss then hit | 21 on a miss, 11 to 13 on a hit        |
| `/` (page)                         | 41,997         | miss then hit | 92 to 112 on a miss, 10 to 12 on a hit |
| `/properties` (page)               | 40,123         | miss then hit | 41 to 57 on a miss, 10 to 16 on a hit  |
| `/sitemap.xml`                     | 4,279          | not cached    | 20 to 23                               |

`node scripts/api-smoke.mjs http://127.0.0.1:8828 --cleanup` ran three times against it: `api-smoke: 20 ok, 0 failed` each time. The seed catalog is small, so the byte counts grow with the published set.

Supabase egress is what the Worker reads from Supabase, not what it sends to a visitor (Cloudflare serves those bytes). The free 5 GB a month (P-009) is drawn by three consumers, and only the first is measured here.

1. Catalog reads. The Worker reads two RPCs (`src/server/public/state.ts`): `public_state` at most every 15 seconds per isolate, and `public_catalog_snapshot` once per catalog version per isolate. Measured 2026-10-04 on `mop-dev` with the 16 seeded properties (service role, read only): `public_state` 420 bytes (244 gzip); `public_catalog_snapshot` 70,380 bytes (20,258 gzip). STANDARDS R60 allows the snapshot up to 1.5 MB at 100 properties. A miss costs the snapshot, not the 10 KB list a visitor receives, and it multiplies by the isolates that load it each time the version moves: a deploy or a catalog edit makes every live isolate fetch it again. A warm read costs the database nothing.
2. Storage reads on `/media/<key>` (H33 (3), tech-stack section on files). Every edge cache miss of a media address reads the public `media` bucket, and ASSUMED H33 names 5 GB of Storage egress a month as the wall (only cache misses reach Storage). The Cache API is per data center, so each data center misses once per variant (thumb, card, hero, og, carousel, up to 2560 px WebP) before it serves from cache; published photographs at launch are the first real load. UNPROVEN: the bytes per variant and the count of data centers are not measurable here (no photograph is stored yet), and `limits.json` of B14 measures the wall at 70 and 90 percent.
3. Write paths. The Worker makes 24 more `.rpc()` calls across the write routes, the hooks, the reconcile and the job runner, and signs upload URLs through the Storage API. Their bytes are UNPROVEN: they are not measured here, and they draw on the same 5 GB.

The 5 GB is shared by the three. At 70 KB (raw) the snapshot alone would use it up in about 71,000 loads and at 1.5 MB in about 3,300, so those figures describe the catalog share only: every photograph miss and every write comes out of the same budget. The count of isolate loads is not measurable here (UNPROVEN, H1 reads it from Supabase usage).

### CPU on a preview

Measured 2026-10-04 on the deployed preview `pr-100` (commit `bbe712c`, the live adapter, `mop-dev` behind it), from a tail window that held three runs of `api-smoke` and the extra requests below: 50 events, every one `outcome: ok`, no error 1102. `cpuTime` is whole milliseconds. This is the maximum per route in that window, with the count of requests behind it. The isolate was already warm, so the figures are warm figures.

| Route                                           | Requests | Max `cpuTime`, ms |
| ----------------------------------------------- | -------- | ----------------- |
| `GET /api/public/properties`                    | 3        | 4                 |
| `GET /api/public/properties/:slug`              | 3        | 3                 |
| `GET /api/public/markets`                       | 3        | 3                 |
| `GET /api/public/markets/:slug`                 | 3        | 4                 |
| `GET /api/public/stories`                       | 3        | 2                 |
| `GET /api/public/stories/:slug`                 | 3        | 2                 |
| `/` (page, edge hit)                            | 2        | 3                 |
| `/properties` (page, edge hit)                  | 2        | 2                 |
| `/sitemap.xml`                                  | 2        | 7                 |
| `GET /media/<key>` (not stored, 404)            | 2        | 4                 |
| `GET /api/public/subscribers/confirm` (unknown) | 5        | 5                 |
| `POST /api/public/submissions`                  | 3        | 11                |
| `POST /api/public/submissions/:id/uploads`      | 3        | 7                 |
| `POST /api/public/inquiries`                    | 3        | 6                 |
| `POST /api/public/subscribers`                  | 3        | 5                 |
| `POST /api/public/subjects/request`             | 2        | 4                 |
| `POST /api/public/search`                       | 2        | 7                 |
| `POST /api/public/concierge`                    | 1        | 2                 |
| `POST /api/public/events`                       | 2        | 4                 |

Decision items under G-011 (8 ms or more; H1 decides, nothing is worked around here):

1. `POST /api/public/submissions` reached 11 ms warm (11, 10 and 6 across the three smoke runs). It parses the form, checks Turnstile and signs up to 20 upload URLs, and it is the route the plan expected to be the heaviest. The 10 ms free limit is already passed on a warm isolate, and no 1102 was logged.
2. Cold isolates are higher than the window above. The review of this group tailed a window that caught cold isolates and recorded `GET /api/public/properties` at 21 ms and `GET /api/public/stories` at 15 ms, `/` at 21, `/properties` at 58 and `/sitemap.xml` at 34 (the review's figures, not re-measured here: the isolate was warm in the window above and nothing here can make one cold). A second review window caught cold isolates again and recorded `POST /api/public/client-error` at 17 ms on its first request, `/sitemap.xml` at 43 and `/properties` at 59: a second sample, not a reproduction of the first, and the spread (34 against 43 for the sitemap) says a cold figure is a range. A deploy, a catalog edit and an idle isolate each start one, and what the first request pays (module load, snapshot fetch) is not separated here. All of these are above 8 ms.
3. `POST /api/public/search` and `/sitemap.xml` reached 7 ms: under the line, close to it.

The two page rows are cache-hit figures, not render figures: on `pr-100` the Cache API serves on `workers.dev`, so the first request of `/` and of `/properties` was already an edge hit. They say what a visitor's request costs once the page is stored, not what a render costs. No render figure is recorded (UNPROVEN), and so the cost of `resolveRedirect` (GD-02) is not separated either: the cold page figures of item 2 are not explained by it until a page is measured on a request the cache cannot serve.

UNPROVEN, no row in the table: `POST /api/public/client-error` and `POST /api/hooks/resend`. The smoke does request `/client-error` on every run (`POST /client-error`, 204), but its event is missing from this window: `wrangler tail --format json` drops events under a burst, so the tail window is lossy and a route can have fewer tail lines than requests sent. `/api/hooks/resend` needs a Svix signature, which no request here carries. Also UNPROVEN is the cost of `GET /media/<key>` on a stored photograph (no photograph is stored yet). The 404 row above is a valid key that is not stored, so it includes one Storage read, which answered 404; a 404 is never cached, so every request for such a key reads Storage again. Only a key that fails the pattern stops before Storage.

To repeat the measurement. The token that reads a tail is the local admin token `mop-admin` (the deploy token has no Workers Tail Read), and the account id travels with it: `eval "$(node scripts/load-env.mjs --profile ops)"` loads the token from `.env.ops` but does not export `CLOUDFLARE_ACCOUNT_ID`, and a shell that inherits another account's token without an account id answers `This Worker does not exist on your account. [code: 10007]` (P-840). Run it from the owner's shell, never from CI. The lane window above used the same token and account id from the lane's `.env` (F19), set for the one `wrangler` command and never exported to the dev shell; the owner's `.env.ops` is where SEC-08 keeps them.

```
eval "$(node scripts/load-env.mjs --profile ops)"
export CLOUDFLARE_ACCOUNT_ID=<the account that holds holy-meadow-4327>
mkdir -p ../.tmp
bunx wrangler tail pr-<n> --format json > ../.tmp/tail.json
```

In a second shell prepared by the dev loader (run `unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID` first: a shell that inherits `CLOUDFLARE_API_TOKEN` makes the smoke refuse with `refusing: ops variables`, P-837; the account id causes no refusal, and the unset only keeps it out of the dev shell), run three times (each run uses a fresh email and its cleanup clears the smoke's own rate-limit buckets, so none meets a 429):

```
node scripts/api-smoke.mjs https://pr-<n>.holy-meadow-4327.workers.dev --cleanup
```

The smoke requests only `/api/public/*`, and `resolveRedirect` runs only for page requests, so in the same window request the pages and the other two paths:

```
B=https://pr-<n>.holy-meadow-4327.workers.dev
for p in / /properties; do curl -s -o /dev/null $B$p; curl -s -o /dev/null $B$p; done
curl -s -o /dev/null $B/sitemap.xml; curl -s -o /dev/null $B/media/none.webp
```

On a preview the Cache API stores and serves, so these page requests are edge hits and measure the stored answer, never a render: label each page row `hit`. A render figure needs a request the cache cannot serve: the first request of an address after a deploy (the release is in the key), the first after a catalog change (the catalog version is in the key), an address whose stored 404 has expired, a data center that has not stored it, or a page nothing has requested under both (on `pr-100` the first request of `/markets` answered `x-mop-cache: miss`, so check the header with `curl -sI` before reading the figure). A query string does not help: the key drops it and pages ignore `q`. Label that row `render`. `/sitemap.xml` is not a page: it is never cached and never runs the lookup, so it measures the sitemap alone. The tail file is not one object per line: `wrangler` pretty-prints each event. Take the maximum per path with:

```
node -e 'const t=require("fs").readFileSync("../.tmp/tail.json","utf8");for(const s of t.split(/^\}\s*$/m)){if(!s.trim())continue;const e=JSON.parse(s+"}");if(e.event?.request)console.log(e.cpuTime,e.event.request.method,new URL(e.event.request.url).pathname)}' | sort -k3,3 -k1,1nr | awk '!seen[$3]++'
```

The tail window is lossy: `wrangler tail --format json` drops events under a burst. Before trusting a maximum, count the requests sent against the events kept (`grep -c cpuTime ../.tmp/tail.json` for the whole window, and the per-path lines the command above prints before `awk`). A route with fewer tail lines than requests sent has no trustworthy maximum: re-run that route alone, a few requests a second, and count again.

Anything at 8 ms or more is a decision item under G-011, not a silent workaround. The tail file holds IP hashes and request ids: delete it when the numbers are written here.

## Not yet proved

- The `cpuTime` of `POST /api/public/client-error` (requested by every smoke run, but its tail events were lost in the burst: re-run it alone and count) and of `POST /api/hooks/resend` (it needs a Svix signature), of `GET /media/<key>` on a stored photograph, of a page render (the page rows are edge hits) and of a cold isolate measured by us (the figures in the section above are the review's), the Storage egress of `/media` misses, and the cost of `resolveRedirect` on its own. UNPROVEN: each needs a lossless window, a request the cache cannot serve, a stored photograph or a cold isolate on demand.
- The decision items of the CPU section (`POST /api/public/submissions` at 11 ms warm, the cold reads) are H1's under G-011.
- The production Worker's secrets are put by the owner (`docs/runbooks/delivery.md`). UNPROVEN while the repository variable `PRODUCTION_DEPLOY` is off.
- The edge layer on the custom domain and the 95 percent ratio are L1's and H1's.
