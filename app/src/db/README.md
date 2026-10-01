# src/db

Generated database types and query helpers. `supabase/migrations/*.sql` is the source of truth for every shape; `supabase gen types` writes `src/db/types.ts` here and nothing edits that file by hand. `src/domain/*` becomes thin aliases over these types, with Zod schemas for input validation only. A table or column changes through a migration first, then a regeneration (`docs/HOW-TO-ADD.md`).
