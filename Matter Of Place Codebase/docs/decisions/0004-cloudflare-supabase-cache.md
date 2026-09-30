# 0004 Cloudflare in front, Supabase behind, cache between

Status: accepted (target architecture)

## Context

The owner wants to run on the free Supabase tier indefinitely. Public traffic is read-heavy; writes are a handful of inquiries and submissions a day.

## Decision

- The site and the API run as Cloudflare Workers on one zone.
- The browser never talks to Supabase. The API holds the service role key, validates with the shared contracts and rate limits writes.
- Catalog reads are cached at three levels (TanStack Query, edge cache, Worker cache) with a `catalog_version` bumped by database triggers on publish. Stale content is served when the database is unavailable.
- Photography is served through edge image resizing so Storage egress stays near zero.

## Consequences

- Publishing a dossier can take up to the cache TTL (five minutes) to appear unless the workflow purges by tag.
- Editorial tooling is Supabase Studio at first; an admin surface can come later behind Supabase Auth with the `user_roles` table.
- Free-tier quotas are not guaranteed forever; the design keeps database reads near zero so an upgrade, if ever needed, is driven by writes and storage, not traffic.
