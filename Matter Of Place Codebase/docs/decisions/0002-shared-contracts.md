# 0002 Zod contracts shared by frontend and API

> Sketch from the MVP phase. The approved spec is ../../../workspace/02-tech-stack/tech-stack.md and ../../../workspace/06-architecture/architecture.md: read this for intent, build from the spec.

Status: accepted

Superseded in part: the database shape now comes from `supabase/migrations`, and the server maps between database rows and the camelCase API JSON.

## Context

Forms must validate in the browser for a calm experience and again on the server for safety. Two hand-written validators drift.

## Decision

Write-side schemas live in `src/domain/contracts.ts` and depend only on `zod`. The frontend parses input before sending; the API imports the same module and parses the body. Read-side shapes are plain TypeScript types in `src/domain/*.ts`, mirrored by `docs/database/schema.sql` in snake_case.

## Consequences

- A field added to a form is added once, in the schema, and the API rejects anything else.
- The Worker bundles `zod` (small, edge-compatible).
- Enumerations shown in the UI (submission types, requested services, concierge questions) come from the same file, so the UI cannot offer a value the API refuses.
