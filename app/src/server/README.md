# src/server

Server-only code for the one Cloudflare Worker: request handlers behind `src/routes/api/*`, the Supabase service-role client, rate limiting, request-ID logging, the job enqueuer, email, and later the Stripe and Meta adapters, each in its own feature folder (`src/server/<feature>/service.ts`). Nothing here may be imported by the browser: `vite.config.ts` turns on TanStack Start import protection for `**/server/**`, so a client import fails the build. Shared server helpers live in `src/server/lib`. Extension paths: `docs/HOW-TO-ADD.md`.
