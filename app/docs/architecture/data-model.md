# Data model

The frontend types in `src/domain/` are the shapes the API returns, in camelCase. The database stores the same fields in snake_case, and the migrations in `supabase/migrations/` are the only definition of it (GOTCHAS G-010).

- Tables, enums, ownership and the rules between them: `workspace/06-architecture/architecture.md` section 3.
- Generated database types: `src/db/types.ts`.
- Operating the database: [../runbooks/database.md](../runbooks/database.md).

A field changes in the domain type, the API JSON and the migration together, then the types are regenerated.
