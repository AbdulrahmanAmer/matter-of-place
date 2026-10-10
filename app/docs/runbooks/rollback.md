# Rollback runbook

How to put the previous Worker back, what that does not undo, and the migration rule that keeps a Worker rollback safe. Written in H1 step 7 (GD-07). A line marked UNPROVEN or BLOCKED has not been observed and says what would settle it.

## 1. When to roll back

A deploy made the site wrong and the version before it was right: a page that errors, a public read that returns `x-mop-cache: stale`, a form that no longer submits. If the previous version was also wrong, a rollback does not help; fix forward with a new commit.

The deploy workflow already rolls the Worker back by itself when its smoke check fails (section 2c). Roll back by hand only when the smoke passed and the site is still wrong.

## 2. Roll back the Worker

From the owner's shell, with the local `mop-admin` token loaded without printing it (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, from `.env`):

```
bunx wrangler versions list --name matter-of-place
bunx wrangler rollback --name matter-of-place --message "<reason>"
```

`rollback` without a version id returns to the previous deployment. When a deployment of the same code sits between the good one and now (a secrets step makes one, noted in `.github/workflows/deploy.yml`), take the good version's id from `versions list` and pass it:

```
bunx wrangler rollback <version-id> --name matter-of-place --message "<reason>"
```

Add `--yes` to skip the confirmation prompt. Afterwards read the page that was wrong. Cloudflare's own warning, printed by the command: rolling back to a previous deployment does not roll back the bound resources.

How long it takes, measured on the throwaway Worker `mop-drill` (section 6): 6 and 7 seconds in two runs on 2026-10-10 from this laptop, counted from the start of `wrangler rollback` until the address that served the new version stopped serving it. The live Worker was not touched, so its own figure is UNPROVEN.

The drill that produced that figure is `bash scripts/harden/rollback-drill.sh` from `app/`. It builds, deploys `mop-drill` twice (the second with a static file `__drill.txt` holding `v2`, so no database or secret is read), rolls back, waits for the file to stop answering, and deletes the Worker. The Worker name is fixed in the script, and none of its commands names `matter-of-place`.

## 3. What a rollback does not undo

A Worker version is the code and configuration uploaded by one deploy. It does not hold:

- Migrations. The database stays on the newer schema (sections 4 and 5).
- Supabase secrets: the Vault rows and the secrets of the Edge Function.
- Storage objects in the buckets `submissions`, `media` and `documents`.
- Rows of `settings` and every other table, including the catalog version.

All four live in Supabase, outside the Worker. UNPROVEN: whether a Worker secret changed between two versions follows a rollback. The drill changes no secret, so it cannot say; a drill that sets a different secret on version 2 and reads it back after the rollback would settle it.

## 2b. Roll back the job runner

BLOCKED. The runner is the Supabase Edge Function `job-runner`. Its rollback script, scripts/rollback-runner.sh of slice B8, is not in this tree, so nothing below has run and no minutes were measured. The path is written without code quotes on purpose: `runbook-lint.mjs` fails a quoted path that does not exist. Quote it when the file lands.

What B8 specifies: the script takes two arguments, the previous good main SHA and `$DEV_SUPABASE_PROJECT_REF` (the one project's ref, ruling H35 (1)). It checks the SHA out in a temporary worktree and runs `bunx supabase functions deploy job-runner --use-api --project-ref <ref>` from it. The SHA is the second entry of:

```
gh run list --workflow deploy.yml --event workflow_run --status success --limit 2 --json headSha
```

It is never chained to the Worker smoke: `scripts/smoke.mjs` does not touch the runner or the jobs table.

No job is lost by it. A step type the older runner does not know is retried every 15 minutes and dies as `unknown_step` only 24 hours after the job was created (`src/server/jobs/runner.ts`).

To close this section once B8 has landed: run the script with the previous main SHA, call the runner and read `{"claimed":...}` back, run the script with the current main SHA, and write the minutes into section 6.

## 2c. The in-job rollback

The `dev` and `production` jobs of `.github/workflows/deploy.yml` roll the Worker back when `scripts/smoke.mjs` fails. The smoke fails, among other things, when the properties answer carries an `x-mop-cache` other than `hit` or `miss`, which includes `stale`.

Record of the rehearsal of the `dev` job (B1b step 7b, DO-09): run 37119653705 of `deploy.yml`, started with `workflow_dispatch` and `rehearse_rollback` on 2026-10-03 at commit `da52ad3b`. Its `dev` job log shows `smoke forced to fail (SMOKE_FORCE_FAIL)`, then the step `rollback` ran `wrangler rollback "$PREVIOUS" --name matter-of-place-dev --message "smoke failed $SHA" --yes` and ended `rolled back to 832ce8d2-9fd8-47ed-be4c-5772626bf2bf`. Read it again with `gh run view 37119653705 --log`. The job `dev` ended red and the step `rollback` ended green, as intended.

That run is older than the current workflow file (`git diff --stat da52ad3b HEAD -- .github/workflows/deploy.yml` shows 110 insertions and 3 deletions), so it proves the step as it was then. Repeat it after the next change to the `dev` job: `gh workflow run deploy.yml --ref main -f rehearse_rollback=true`, then `gh run watch`. The `production` job's rollback has not been rehearsed: it would roll back the live Worker.

## 4. Migrations: expand then contract

A Worker rollback does not touch the database, and production migrates before the Worker deploys, so the previous Worker has to keep working against the newer schema. The rule is in `supabase/migrations/README.md` and `tests/db/migration-headers.test.ts` enforces it:

- A destructive change (a drop or rename of an object, a truncate, a column type change, a new NOT NULL column without a default) spans two releases. The expand migration adds the new shape and the code stops reading the old one. A later contract migration drops the old shape, and its header carries `-- contract-of: <version>` naming a version already on `main`.
- Every migration starts with `-- down:` or `-- irreversible: <reason>`, then `set lock_timeout = '5s';`.

So a Worker rollback is safe after an expand migration, which only adds. It is not safe after a contract migration, because the previous Worker may still read the shape that was dropped: restore the old shape with a new forward migration first.

Prove the headers with `bunx vitest run tests/db/migration-headers.test.ts`. Prove one down block really undoes its migration with `bash scripts/harden/migration-rollback-drill.sh` from `app/`. It needs a native PostgreSQL 18 (`initdb`, `pg_ctl`, `psql`, `pg_dump` on the path, or the folder in `PG_BIN`) and no Docker. It starts a throwaway cluster, creates stand-ins for the Supabase roles and schemas (`scripts/harden/pg-shims.sql`) and applies the migrations in order with their `create extension` lines left out. At the newest migration whose `-- down:` block is SQL it dumps the schema, runs the block, checks the schema differs, applies the file again, checks the schema equals the first dump, then applies the newer migrations. It prints `migration rollback ok` and the seconds.

A down block that says "re-run ..." is a procedure, not SQL, and the drill goes back to the migration before it, printing which files it passed over. If a migration cannot apply on the stand-ins, the drill stops naming the file and exits 1. Its fallback in the plan, running on `mop-dev`, is not automatic: `mop-dev` is the one shared database, so decide it by hand with the orchestrator, and only before the launch switch.

## 5. Irreversible migrations

Listed by the drill from the `-- irreversible:` headers. The initials column is the CEO's acceptance and is empty until he gives it.

| File                                | Reason                       | CEO initials |
| ----------------------------------- | ---------------------------- | ------------ |
| `20261006224200_invoicing_enum.sql` | enum value cannot be dropped | pending      |

## 6. Drill record

| Drill                                 | Date       | Result                                                                                                                |
| ------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| Worker rollback, `mop-drill`          | 2026-10-10 | `deployed v2 marker ok`, `rollback ok`, `elapsed 7s` (an earlier run: 6s); the address answered 500 after (see below) |
| Migration rollback, throwaway cluster | 2026-10-10 | `migration rollback ok`, `elapsed 25s` (earlier runs: 30s, 35s); drilled `20261009004133_admin_team.sql`              |
| Job runner rollback                   | not run    | BLOCKED: scripts/rollback-runner.sh (B8) is not in the tree; minutes not measured                                     |
| In-job rollback                       | 2026-10-03 | run 37119653705, `dev` job: `smoke` red, `rollback` green                                                             |

Run by the builder of H1 group g7 (an AI agent) from the owner's laptop with the local `mop-admin` token.

After the rollback the throwaway address answered 500 with the body `{"status":500,"unhandled":true,"message":"HTTPError"}`, not the 404 the plan expected. Version 1 has no database or secret; the cause of the 500 was not investigated. The drill accepts 404 or 500 as "the marker is gone". What the live Worker answers for an unknown path is UNPROVEN here.
