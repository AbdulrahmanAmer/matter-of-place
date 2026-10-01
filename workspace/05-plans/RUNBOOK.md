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
   diff, and only then merges the pull request into `main`. Workers never merge.
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
- Production shows no illustrative property, ever (S30). `MOP_ENV` defaults to `production`.

## What only the orchestrator does
Merges to `main`, the first production deploy, production secrets (`wrangler secret put`), any change to a decision,
closing a slice, and anything the workflow returns under `needsOrchestrator`.

## What only the operator does
Creating accounts and full-access tokens (GOTCHAS P-037), entering a payment method, legal and business facts, turning R2
on, and approving anything that changes how the site looks or reads beyond the plan.
