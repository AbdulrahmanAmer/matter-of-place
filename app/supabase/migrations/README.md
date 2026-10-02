# supabase/migrations

Versioned SQL is the only way the database shape changes. Each file is `<14-digit version>_<snake_name>.sql`, made with `bunx supabase migration new <name>`, and runs up only: a later migration undoes an earlier one. Row-level-security policies ship in the same migration as the table they protect. `docs/database/schema.sql` is the earlier sketch, read for intent only (GOTCHAS G-010).

## Every file

- Opens with a `-- down:` block (the SQL that undoes it, applied in production only as a new forward migration) or `-- irreversible: <reason>` (for example `alter type ... add value`).
- Its first statement after that header is `set lock_timeout = '5s';`.
- Re-applies on a freshly emptied `public` schema: `bun run db:reset` empties `public` and pushes every file from zero.
- Is never edited, renamed or deleted once it is on `origin/main`. A change is a new file. `bun run db:push` refuses an applied file whose sha256 differs from the one it recorded (`refusing: edited migration <version>`).
- Has a version greater than the largest on `origin/main`. The `migration-order` step of CI (`node scripts/check-migrations.mjs`) fails a pull request that breaks this; the lane that lands second makes its file again with a fresh `supabase migration new` timestamp.

## Expand, then contract

Production migrates before the Worker deploys, and a failed smoke rolls back only the Worker, so a migration must leave the previous Worker working. A destructive change (a drop or rename of an object, a `truncate`, a column type change, a new NOT NULL column without a default, as `scripts/check-migrations.mjs` defines it) spans two releases:

1. The expand migration adds the new shape, and the code stops reading the old one.
2. Once that has shipped, a contract migration drops the old shape. Its header carries `-- contract-of: <14-digit version of the expand migration>`, a version already on `origin/main`.

`drop trigger` and `drop policy` need no header, and neither does `drop function if exists public.<name>(<old types>)` without `cascade` when a later statement of the same file creates `public.<name>` again (what `bun run db:fn` writes for a signature change).

## How a migration reaches the database

- Only `main` reaches `mop-dev` (ruling H1). The post-merge `dev` job of `deploy.yml` runs `bun run db:push`. A branch proves its schema in the `db` job of CI, on an ephemeral stack built from its own migrations. Nothing on the laptop starts Docker (GOTCHAS P-038).
- A migration lands on `main` in its own small pull request (the migration and the regenerated `src/db/types.ts`) before the code that needs it.
- Rebase on `origin/main` before any `bun run db:push`.
- `bun run db:push` (`scripts/db-push.mjs`) is the one push command, never a bare `supabase db push`. Before the CLI runs it refuses, naming each item:
  - `refusing: branch migrations <files>`: the local file names differ from those on `origin/main`. While exactly one lane is open, that lane sets `MOP_SINGLE_LANE=1` and may push its branch migrations under the `mop-dev-tests` lock; after the launch switch (`settings.environment = 'production'`) the exception is closed.
  - `refusing: remote-only migrations <versions> (rebase onto origin/main first)`: the database holds a version with no local file.
  - `refusing: out-of-order migration <file> (regenerate the timestamp with supabase migration new)`: a local file not yet applied is older than the newest applied one.
  - `refusing: edited migration <version> (an applied migration is never edited; add a new one)`.
- After a push it records the sha256 of every applied file in `public.migration_checksums`.
- `--include-all` and `supabase migration repair` are never used on `mop-dev` without the orchestrator.

## Functions

The one current text of every function in `public` lives in `supabase/sql/functions/<name>.sql`. A function changes only by editing that file and running `bun run db:fn <name>`, which writes a new migration holding the text. Never copy a function body by hand from an earlier migration.
