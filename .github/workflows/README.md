# .github/workflows

GitHub Actions for the repository. This folder sits at the repository root because GitHub reads workflows only from there (GOTCHAS G-012); the app lives in `app/`, so every job sets `defaults.run.working-directory: app`. Secrets come from the repository's Actions secrets (tech-stack section 4), never from files.

| Workflow | Owner | What it does |
|---|---|---|
| `ci.yml` | B1b (B3, B4, B13 add steps or jobs) | on pull requests into `main` and pushes to `main`: `check` (engines, `migration-order`, `bun run check`, `audit`, and the `deno` step from B3), `build` (the one live-mode build, uploaded as `build-output`), `merge-gate` (push to `main` only); B4 adds `db` and `e2e`, with B13's SEO checks as steps of `e2e` |
| `deploy.yml` | B1b (later slices add steps, never jobs) | `preview-db` and `preview` (a `pr-<n>` Worker) on pull requests, `preview-cleanup` on close, `dev` after a green `ci` run on `main` (the one database step: `bun run db:push` and the job-runner deploy), then `production` (`needs: dev`, no database step), `workflow_dispatch` for the rollback rehearsal |
| `backup.yml` | B1b | nightly dump of the one Supabase project (ASSUMED H35; by hand with `-f target=dev`), encrypted to `app/backup-recipient.pem`; the artifact `mop-dev-dump` is the only copy (H33 (7)) |

These three exist. Later slices add `render.yml` (B8, heavy renders; B9 and B12 add to it), `audit-scope.yml` (B14, the weekly audit robot) and `audit-deps.yml` (H1, dependency audit); each lands with its owner and gets its row here.

Rules every workflow follows (B1b invariants 13 to 15; `tests/unit/hygiene.test.ts` checks them on every file here):

- Top-level `permissions: {}`; each job grants only what it uses.
- Every `uses:` is pinned to a 40-character commit SHA with a `# vX.Y.Z` comment; Dependabot keeps the pins current.
- Every `actions/checkout` sets `persist-credentials: false`; a step that calls `gh` reads `GH_TOKEN` from its `env`.
- Every job sets `timeout-minutes`; every workflow has a workflow-level `concurrency` or one on every job.
- A job a pull request can reach never references `SUPABASE_ACCESS_TOKEN`, a `DEV_SUPABASE_` secret, a `PROD_` secret or a `BACKUP_` secret (the `DEV_SUPABASE_*` secrets become the production database's credentials at the launch switch, ASSUMED H35). This catches accidents only: a pull request can edit the test too.
- Only `main` reaches `mop-dev`, the one Supabase project: no pull request job pushes a migration or deploys an Edge Function, no `ci.yml` job reads or writes `mop-dev`, and only the `dev` job of `deploy.yml` pushes migrations (H35).
- After the launch switch no preview holds a database key: the `preview` and `dev` jobs read `HAS_DB` from `PREVIEW_WORKER_SECRETS_JSON` and build with the `local` services adapter once L1 removes the pair (B1b invariant 13a).
- No workflow names R2 or a media base variable: files live in Supabase Storage and the deploy jobs pass `MEDIA_PUBLIC_BASE` as the Worker's own origin plus `/media` (H33).
- No workflow writes captions and no workflow holds an Anthropic key: `write_captions` runs only on the operator's laptop through `scripts/captions-runner.ts` (ASSUMED H34).
- Drafts skip the heavy jobs (`db`, `e2e`, `preview`), which also skip while the repo variable `CI_HEAVY` is `off`; `backup.yml`, `production` and `dev` never read it.
- Every new pull request job name goes into `REQUIRED_PR_CHECKS` in `app/scripts/merge-gate.mjs` in the same commit.
