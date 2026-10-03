# Database

The migrations in `supabase/migrations/` are the truth about the database. Nothing else describes a table, column, enum, policy, function or bucket, and nothing in this folder builds one.

- The data model, table by table with its owner slice: `workspace/06-architecture/architecture.md` section 3.
- The generated types the code compiles against: `src/db/types.ts` (`bun run gen:types`).
- How the database is operated, reset, seeded and switched to production: [runbooks/database.md](../runbooks/database.md).
- How to change it: [supabase/migrations/README.md](../../supabase/migrations/README.md). A table or column changes through a migration first, then a regeneration (GOTCHAS G-010).

The first sketch of the schema (`docs/database/schema.sql`) was deleted when slice B2 landed. Its table blocks were the one sanctioned source of the column lists that the first migrations copy; `git show 8dd6f26:"Matter Of Place Codebase/docs/database/schema.sql"` reads it (GOTCHAS P-311).
