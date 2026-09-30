# .github/workflows

GitHub Actions for the repository: `ci.yml` (check, test, build on every pull request), `deploy.yml` (`wrangler deploy` on main, a preview Worker per pull request) and `render.yml` (heavy renders started by `repository_dispatch`). This folder sits at the repository root because GitHub reads workflows only from there; the app lives in `Matter Of Place Codebase/`, so every job sets `working-directory` to that folder. Secrets come from the repository's Actions secrets (tech-stack §4), never from files.
