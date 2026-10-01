# .github/workflows

GitHub Actions for the repository. This folder sits at the repository root because GitHub reads workflows only from there (GOTCHAS G-012); the app lives in `app/`, so every job sets `defaults.run.working-directory: app`. Secrets come from the repository's Actions secrets (tech-stack section 4), never from files.

| Workflow | Owner | What it does |
|---|---|---|
| `ci.yml` | B1b (B3, B4, B13 add steps or jobs) | on pull requests into `main` and pushes to `main`: `check` (engines, `migration-order`, `bun run check`, `audit`, and the `deno` step from B3), `build` (the one live-mode build, uploaded as `build-output`), `merge-gate` (push to `main` only), and B4's `db`, `e2e` and B13's `seo` |
| `deploy.yml` | B1b (later slices add steps, never jobs) | `preview-db` and `preview` (a `pr-<n>` Worker) on pull requests, `preview-cleanup` on close, `production` and `dev` after a green `ci` run on `main`, `workflow_dispatch` for the rollback rehearsal |
| `backup.yml` | B1b | nightly dump of `mop-prod` (and `mop-dev` by hand), encrypted to `app/backup-recipient.pem` |
| `render.yml` | B8 (B9, B12 add to it) | heavy renders started by `repository_dispatch` |
| `audit-scope.yml` | B14 | the weekly audit robot |
| `audit-deps.yml` | H1 | dependency audit |

Rules every workflow follows (B1b invariants 13 to 15; `tests/unit/hygiene.test.ts` checks them on every file here):

- Top-level `permissions: {}`; each job grants only what it uses.
- Every `uses:` is pinned to a 40-character commit SHA with a `# vX.Y.Z` comment; Dependabot keeps the pins current.
- Every `actions/checkout` sets `persist-credentials: false`; a step that calls `gh` reads `GH_TOKEN` from its `env`.
- Every job sets `timeout-minutes`; every workflow has a workflow-level `concurrency` or one on every job.
- A job a pull request can reach never references `SUPABASE_ACCESS_TOKEN`, a `PROD_` secret or a `BACKUP_` secret. This catches accidents only: a pull request can edit the test too.
- Only `main` reaches `mop-dev`: no pull request job pushes a migration or deploys an Edge Function, and no `ci.yml` job reads or writes `mop-dev`.
- Drafts skip the heavy jobs (`db`, `e2e`, `e2e-live`, `preview`), which also skip while the repo variable `CI_HEAVY` is `off`; `backup.yml`, `production` and `dev` never read it.
- Every new pull request job name goes into `REQUIRED_PR_CHECKS` in `app/scripts/merge-gate.mjs` in the same commit.
