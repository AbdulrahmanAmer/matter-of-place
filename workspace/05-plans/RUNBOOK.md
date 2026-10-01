# Build runbook: how the slices get built without the operator in the loop

This is the operating procedure for Stage 3 (BUILD). The orchestrator (the main Claude session) runs it; Sonnet workers
do the building and the reviewing. Plans are in this folder, order and status are in `PLAN.md`, measured facts are in
`ASSUMED.md` section E.

## Before any slice
```
node workspace/05-plans/ready.mjs --full
```
Every line must be PASS or WAIT. A FAIL stops the build until it is fixed. WAIT lines name the slices they block; the
other slices go ahead.

## One slice, start to finish
1. See the groups first (cheap, changes nothing):
   `Workflow({ name: "build-slice", args: { slice: "B1b", dryRun: true } })`
2. Run it: `Workflow({ name: "build-slice", args: { slice: "B1b" } })`.
   The workflow sizes the plan into groups, and for each group: a `mop-builder` (Sonnet, medium) builds on the branch
   `slice/<id>`, pushes, and pastes its proofs into `logs/<id>.md`; a fresh `unit-reviewer` (Sonnet, high) re-runs the
   proofs and tries to refute "done"; a rejected group gets at most two fix rounds. It stops at the first group that is
   rejected, blocked, or that needs the orchestrator.
3. The orchestrator then re-runs the slice's Verification section itself (RULE 2: a worker's green is a claim), reads the
   diff, and only then merges the pull request into `main`, only with `node workspace/05-plans/merge-gate.mjs <pr>` and never
   with `gh pr merge` directly (T-03, DO-05, B1b invariant 6b). The script refuses a draft, prints `rebase first` and exits 1
   unless `origin/main` is an ancestor of the head, requires `gh pr checks <pr>` to exit 0, posts the `merge-gate` commit
   status on the head and merges with `--match-head-commit`. Workers never merge.
4. Resume with the value the workflow returned in `resumeWith`, for example `{ slice: "B1b", startAt: "g4" }`.
5. Close the slice: status line in `PLAN.md`, a block in `.claude/POSITION.md` with the proof output, new gotchas in
   `GOTCHAS.md`, `PROJECT-STATE.md` if a decision was made.

## Rules that hold for every slice
- Sonnet workers only; the orchestrator judges and verifies. Never a Fable child.
- No Docker on this machine (S50). The database is the cloud project `mop-dev`; schema changes go through
  `supabase db push` only. R2 is off until the operator enables it; steps that need a bucket are BLOCKED, not replaced.
- Secrets stay in `E:\Matter Of Place\.env` and in GitHub and Cloudflare. No worker prints, pastes or commits a value.
- One writer per file. Slices that run side by side must not share a file; `check-plans.mjs` prints the candidates.
- A plan that turns out wrong is changed first (`check-plans.mjs` must print OK), then built. Nothing is built quietly
  beside the plan.
- Two failed approaches to the same obstacle end the attempt: record BLOCKED with what would unblock it, move on.
- Builders open pull requests as drafts and run `gh pr ready <pr>` when the group is done (drafts skip the heavy CI jobs,
  T-12). Before opening or updating a pull request a builder rebases on `origin/main` and runs `bun run migrations:check`
  (`scripts/check-migrations.mjs`, B1b); only `main` reaches `mop-dev` (ASSUMED H1), and nobody runs `--include-all` or
  `migration repair` without the orchestrator.
- Production shows no illustrative property, ever (S30). `MOP_ENV` defaults to `production`.
- Caching is a contract (S52, architecture section 13): no public read queries a table directly; the reviewer rejects one that does.

## Documented means traceable (S53)
`trace.json` lists every table, route, screen, event, step, schedule, email, page, script and decision with its owning slice,
its files and whether it has a proof. `check-plans.mjs --require-trace` (run by `ready.mjs`) fails when a plan stops naming a
traced file, when a catalog step has no code file, or when a slice is missing from the completion map. A builder who finds
that a plan leaves an owner, a file, a table or a mechanism to be invented stops, fixes the plan and the trace, and only then
builds. Completeness audits of plans run on Opus at high effort; rulings go in `ASSUMED.md` section G.

## Every task ends the same way
Slice or not: a block in `.claude/POSITION.md` with the proof output, new entries in `GOTCHAS.md` for anything that went wrong,
commit, push, and `git log origin/main -1` showing the commit. Then `node workspace/05-plans/ready.mjs` still ends with yes.

## What only the orchestrator does
Merges to `main`, the first production deploy, production secrets (`wrangler secret put`), any change to a decision,
closing a slice, and anything the workflow returns under `needsOrchestrator`.

## What only the operator does
Creating accounts and full-access tokens (GOTCHAS P-037), entering a payment method, legal and business facts, turning R2
on, and approving anything that changes how the site looks or reads beyond the plan.
