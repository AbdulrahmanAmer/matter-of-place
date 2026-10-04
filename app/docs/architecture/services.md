# Service boundary and API contract

> Sketch from the MVP phase. The approved spec is ../../../workspace/02-tech-stack/tech-stack.md and ../../../workspace/06-architecture/architecture.md: read this for intent, build from the spec. Slice B3 revised it: the base path, the error shape and the upload notes below are the built behaviour; the tables of rows and limits are `src/server/public/routes.ts` and `docs/runbooks/api.md`.

`src/services/index.ts` exports one `services` object. Its shape is fixed by `src/services/types.ts`; two implementations exist.

| Mode    | Trigger                   | Catalog        | Writes                         | Search and concierge                      |
| ------- | ------------------------- | -------------- | ------------------------------ | ----------------------------------------- |
| `local` | `VITE_API_BASE_URL` unset | `src/data/*`   | in-memory outbox, session only | keyword matcher, dossier-based answers    |
| `live`  | `VITE_API_BASE_URL` set   | `GET /api/...` | `POST /api/...`                | `POST /api/search`, `POST /api/concierge` |

The API below is what the `http` adapters already call. Implement it as a Cloudflare Worker (Hono, or TanStack server routes under `/api/public/*` if the API lives with the site) and the frontend needs no change.

## Conventions

- Base path: `VITE_API_BASE_URL`, which is `/api/public` in every deployed build. The site and the API are one origin, so the path is relative; during a server render the loaders call the API in-process and never open a connection to the Worker's own address.
- JSON in and out, `content-type: application/json`.
- Errors: `400`/`422` validation, `404` not found, `429` rate limited, `5xx` server. Body: `{ "error": { "code": string, "message": string, "issues"?: ZodIssue[], "requestId": string } }`, and the same id in the `x-request-id` header (the cacheable catalog 404 omits both, because it is stored once for every visitor). The client maps status to a `ServiceError.kind`; the message shown to visitors is always the calm copy in `lib/strings.ts`, never the raw error.
- Every write validates with the schema in `src/domain/contracts.ts` and returns a `Receipt`: `{ "id": uuid, "receivedAt": ISO-8601 }`.
- Rate limits on writes: the table is in `docs/runbooks/api.md`. Exceeding one returns `429` with `Retry-After`.

## Catalog (read, cacheable)

| Method and path         | Returns                                                      | Cache                                |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------ |
| `GET /properties`       | `Property[]` (published only, ordered by `publishedAt` desc) | versioned edge key, see `caching.md` |
| `GET /properties/:slug` | `Property`                                                   | same                                 |
| `GET /markets`          | `Market[]` with regions, notes and guide                     | same                                 |
| `GET /markets/:slug`    | `Market`                                                     | same                                 |
| `GET /stories`          | `Story[]`                                                    | same                                 |
| `GET /stories/:slug`    | `Story`                                                      | same                                 |

Response shapes are exactly the TypeScript types in `src/domain/`. Image fields (`heroImage`, `gallery[].src`, `image`, `video.src`, `video.poster`) are absolute URLs served through the image pipeline described in `caching.md`.

Filtering, sorting and the natural-language finder run in the browser over the full list (16 to a few hundred records is fine). When the catalog grows beyond that, add `?market=&region=` to the list endpoints and move `applyFilters` server side; the components already take a `pool`.

## Writes

### `POST /inquiries`

Body: `Inquiry` (`inquirySchema`). Intents: `showing | ask | similar | sell | invest | agent | general`. `subject` carries the property the visitor was looking at; `details` carries intent-specific answers (`timing`, `budget`, `location`, `current`, `horizon`); `sourcePath` is the page path for attribution.

Response `201 Receipt`. Side effects: insert `inquiries`; notify the editorial inbox; when Omnikom routing is connected, forward the record.

### `POST /submissions`

Body: `Submission` (`submissionSchema`). `media` is metadata only (`name`, `size`, `type`, at most 40, listed in the order they were posted).

Response `201`:

```json
{
  "id": "…",
  "receivedAt": "…",
  "upload_token": "…",
  "uploads": [
    { "media_id": "…", "index": 0, "url": "https://…signed…", "thumb_url": "https://…signed…" }
  ]
}
```

One signed `PUT` URL per media entry, for at most the first ten (a full-size and a thumbnail address each, Supabase Storage `createSignedUploadUrl`, private bucket `submissions`, path `<submission id>/<media id>.<ext>`, valid for 7200 seconds, image types only); the response also carries an `upload_token`, and `POST /submissions/:id/uploads` with it signs the rest, at most 20 at a time. The browser uploads each file directly; the API never proxies binaries. Mark `submission_media.uploaded_at` from a Storage webhook or a scheduled reconciliation.

### `POST /subscribers`

Body: `{ email, source }`. Response `201 Receipt`. Upsert on email; keep the first `source`. Double opt-in is recommended before any mailing.

### `POST /events`

Body: `AnalyticsEnvelope` from `lib/analytics.ts`: `{ event, path, at, data }`. Sent with `navigator.sendBeacon`, so respond `204` quickly and never require a response body. Store in `analytics_events`; drop unknown event names.

## Search and concierge

### `POST /search`

Body: `{ text, limit? }` (`searchQuerySchema`). Response: `SearchMatch[]` = `{ property, score, reasons[] }`, best first. The local implementation is a keyword matcher over type, style, features, place, budget and bedrooms (`src/services/local/search.ts`). A model-backed implementation returns the same shape; keep `reasons` short and factual because they render beneath the results.

### `POST /concierge`

Body: `{ propertySlug, question }` where `question` is one of the four fixed strings in `conciergeQuestions`. Response: `{ text, link?: { slug, title }, action?: "showing" }`. Answers must come from the dossier and availability data; the UI presents this as a concierge, never as a live person.

## Error shape

```json
{ "error": { "code": "validation", "message": "email: Invalid email", "issues": [] } }
```

## Shared code

Import `src/domain/contracts.ts` into the Worker as-is (it depends only on `zod`). `src/domain/*.ts` types can be used for the response builders. Nothing in `src/services/` is needed on the server.
