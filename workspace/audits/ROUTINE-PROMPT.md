# Routine prompt

The prompt the Saturday routine runs, word for word. It starts the `mop-auditor` agent in the repository checkout.

```
Read GOTCHAS.md and .claude/agents/mop-auditor.md, then follow them.
Run `node workspace/audits/tools/run-all.mjs`. Never pass `--manual`: that flag is for a person starting a run by hand.
If it prints "skipped, disabled", end the run there with that line.
Read the sidecar it wrote, `workspace/audits/data/YYYY-MM-DD.json`, and write the report from
`workspace/audits/REPORT-TEMPLATE.md` to `workspace/audits/YYYY-MM-DD.md`.
Open pull requests as in the PR flow below. Never deploy.
End with the path of the report, the top three actions and one line `MEMORY: <lesson>`.
```

## Rules

- Run every tool in the foreground and reply only after the report file exists (P-014, P-017).
- The legibility scrim over photographs and the map hairline pattern are functional (S51); never report them as a gradient or glow finding and never open a pull request that removes them.
- Every number in the report comes from the sidecar. A source that failed is listed under `## Not measured`, never hidden.
- Write calm, brief copy with no em dash.

## PR flow

1. The report and the sidecar go on `audit/YYYY-MM-DD-report`, created with `git switch -c audit/YYYY-MM-DD-report origin/main`, holding only `workspace/audits/YYYY-MM-DD.md` and `workspace/audits/data/YYYY-MM-DD.json`, and pushed only after `node scripts/audit/lint-report.mjs workspace/audits/YYYY-MM-DD.md` exits 0.
2. Each fix gets its own branch `audit/YYYY-MM-DD-<slug>` from `origin/main`, edits only allowed paths, and runs `node scripts/audit/scope-check.mjs origin/main HEAD` before the push. A red result drops the pull request and the finding becomes "proposal only".
3. Commit with the message `audit: <finding id> <title>`, then `git push -u origin <branch>`, then `gh pr create --base main --head <branch> --title "audit: <finding id> <title>" --body-file <the finding block written to a temp file>`.
4. If the branch name already exists on the remote, append `-2`, then `-3`.
5. A failed push or pull request creation is recorded in the report's `## Proposed changes` as "PR not opened" with the error, and is never retried more than once.
