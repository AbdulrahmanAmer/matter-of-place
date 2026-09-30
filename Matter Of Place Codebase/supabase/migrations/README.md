# supabase/migrations

Versioned SQL, the only way the database shape changes. Each file is `<timestamp>_<name>.sql`, up only; a second migration undoes an earlier one. Row-level-security policies ship in the same migration as the table they protect. After a migration: `supabase db reset` must run clean and `supabase gen types` regenerates `src/db/types.ts`. `docs/database/schema.sql` is the earlier sketch, read for intent only (GOTCHAS G-010).
