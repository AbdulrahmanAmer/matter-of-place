# 0005 Illustrative content and pricing live in code for now

> Sketch from the MVP phase. The approved spec is ../../../workspace/02-tech-stack/tech-stack.md and ../../../workspace/06-architecture/architecture.md: read this for intent, build from the spec.

Status: accepted

## Context

Sixteen illustrative properties, three markets with regions and guides, six stories, the pricing schedule and FAQ copy currently ship with the site. There is no editor yet.

## Decision

Catalog content stays in `src/data/*.ts`, typed by `src/domain/*`, and is served by the `local` catalog adapter. It doubles as the seed for the database. The pricing schedule and terms (`src/data/exposure.ts`) stay in code permanently unless editors need to change prices without a deploy; Pricing and Exposure both read from it so they cannot disagree.

## Consequences

- Content edits are pull requests until the API is live; after that, the same types are returned by `GET /api/*` and the data files become the seed.
- Every record is marked illustrative; no real listing, agent, brokerage or price is implied.
