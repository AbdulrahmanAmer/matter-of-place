# 0001 One service boundary with two adapter sets

Status: accepted

## Context

The frontend was built before any backend exists. It must be fully usable on its own, and later switch to a real API without touching pages or components.

## Decision

`src/services/index.ts` exports a single `services` object typed by `src/services/types.ts`. Two implementations exist: `local` (bundled content, in-memory outbox, keyword search, dossier-based concierge) and `http` (JSON client for the documented API). The choice is made once, from `VITE_API_BASE_URL`.

Routes read through TanStack Query definitions in `src/lib/queries.ts`; components call the write services through `useAsyncAction`.

## Consequences

- No component knows which mode it runs in, except the `DeliveryNotice` and confirmation copy, which read `isLive` to stay honest with visitors.
- The API contract is the `http` adapter; the backend team implements it (`docs/architecture/services.md`).
- Local mode must never persist or transmit visitor data; it is a preview, not a store.
