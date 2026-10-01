# PLAN — Matter of Place, the sliced road to production

agent-os plan file (Stage 2 gate: exists, read, sliced). Each slice is one file in this folder with contract, files,
data changes, steps and verification. Decisions in `../../PROJECT-STATE.md`; open items in `ASSUMED.md`.
Owner agent is `mop-builder` unless noted. A slice is closed only when its verification output is pasted into
`.claude/POSITION.md` and re-run by the orchestrator.

## Order (dependencies from `03-diagrams/completion-map.md` §2)
| Wave | Slices | Why together |
|---|---|---|
| 0 | V1 visual pass | merged as PR #2 on 2026-09-30 |
| 1 | B1b repo and delivery | everything deploys through it; every prerequisite is met as of 2026-10-01 (A1 Cloudflare and tokens, A6 Sentry, A8 GitHub secrets, A11 email) |
| 2 | B2 database → B3 API → B3b coming-soon → B4 tests | the spine; nothing else persists without it |
| 3 | B5 email · B7 admin workspace (screens 1–4, 7–9, 11, 14, 15, 23–25) · B8 job system · B17 website essentials | the day-to-day operating system, and the public surface made compliant |
| 4 | B6 money box · B8b automation console · B16 legal identity | close the loop from accept to invoice to activate; automations become settings |
| 5 | B9 creative system (designer first) → B10 social · B11 newsletter · B12 reel | listings become content |
| 6 | B13 SEO/AEO/GEO → B14 audit robot (needs B13 checks) · B15 Omnikom handoff | be found, be measured, hand off |
| 7 | H1 HARDEN | gate before launch |
| 8 | L1 LAUNCH | DNS, production, first real property, watch week |

## Start readiness (2026-10-01)
Gate: `node workspace/05-plans/ready.mjs --full` must end with `READY TO BUILD: yes`. Procedure: `RUNBOOK.md`. One slice
is run with `Workflow({ name: "build-slice", args: { slice: "<id>" } })`.

No slice is blocked as a whole. Each one starts when the slices it depends on are closed. The table lists the steps that
wait on something only the operator can supply; every other step runs, and each waiting step is marked BLOCKED in its
plan with the exact thing that unblocks it. All 21 plans were re-read against the measured facts (ASSUMED section E) and
the cross-slice rulings (section F) by one worker each and a second worker in a fresh context.

| Slice | Steps that wait | On what |
|---|---|---|
| B1b | 5 step(s) | R2 switched on, mop-prod (created at launch), custom domain attach (L1), GitHub Pro (branch protection) |
| B2 | 4 step(s) | R2 switched on, mop-prod (created at launch) |
| B3 | 3 step(s) | R2 switched on, Resend account |
| B3b | 1 step(s) | mop-prod (created at launch) |
| B4 | 1 step(s) | none |
| B5 | 5 step(s) | Resend account |
| B6 | 4 step(s) | R2 switched on, Resend account, legal entity and payment facts |
| B7 | 5 step(s) | R2 switched on, Resend account, legal entity and payment facts |
| B8 | 2 step(s) | GitHub dispatch token |
| B8b | 1 step(s) | none |
| B9 | 4 step(s) | R2 switched on, Anthropic API key, GitHub dispatch token, CEO creative pick |
| B10 | 9 step(s) | R2 switched on, X developer app, LinkedIn page and app, Meta app (partner) |
| B11 | 6 step(s) | Resend account |
| B12 | 2 step(s) | R2 switched on |
| B13 | 5 step(s) | R2 switched on, Google accounts, custom domain attach (L1) |
| B14 | 6 step(s) | R2 switched on, Resend account, Google accounts |
| B15 | 3 step(s) | mop-prod (created at launch), Omnikom endpoint |
| B16 | 1 step(s) | none |
| B17 | 3 step(s) | R2 switched on, Resend account, custom domain attach (L1) |
| H1 | 9 step(s) | R2 switched on, Resend account, mop-prod (created at launch), legal entity and payment facts |
| L1 | 12 step(s) | R2 switched on, Resend account, mop-prod (created at launch), X developer app, LinkedIn page and app, Meta app (partner), Google accounts, CEO creative pick |

What the operator can do at any time to shorten that list, in order of how much it unblocks: switch R2 on (13 slices have a
waiting step), create the Resend account (9), supply the legal entity and payment facts, create the X, LinkedIn and Google
accounts and ask the partner for Meta access, create an Anthropic API key and a fine-grained GitHub token for render
dispatch. `mop-prod`, the custom domain and the creative pick come up inside their own slices.

## Slice files
B1b.md · B2.md · B3.md · B3b.md · B4.md · B5.md · B6.md · B7.md · B8.md · B8b.md · B9.md · B10.md · B11.md · B12.md ·
B13.md · B14.md · B15.md · B16.md · B17.md · H1.md · L1.md · ASSUMED.md · RUNBOOK.md · check-plans.mjs · ready.mjs · logs/ (one evidence log per slice)

## Rules for working the plan
- One slice per builder session; a builder reads GOTCHAS.md, CLAUDE.md, the slice file and the two spec documents, nothing else first.
- Every new test is watched-fail before it counts. Every slice ends with `bun run check`, `bun run build` and its own proof.
- `node workspace/05-plans/check-plans.mjs` must print OK before any plan change is committed (P-031).
- Cross-slice conflicts are settled in ASSUMED.md §A; a builder who finds a new one stops and writes it there.
- The orchestrator re-runs the slice's verification before marking it closed here:

| Slice | Status | Closed on | Proof |
|---|---|---|---|
| V1 | closed | 2026-09-30 | PR #2 merged; check, build, render gate green; 22 of 26 defects fixed |
| B1b | not started | | |
| B2 | not started | | |
| B3 | not started | | |
| B3b | not started | | |
| B4 | not started | | |
| B5 | not started | | |
| B6 | not started | | |
| B7 | not started | | |
| B8 | not started | | |
| B8b | not started | | |
| B9 | not started | | |
| B10 | not started | | |
| B11 | not started | | |
| B12 | not started | | |
| B13 | not started | | |
| B14 | not started | | |
| B15 | not started | | |
| B16 | not started | | |
| B17 | not started | | |
| H1 | not started | | |
| L1 | not started | | |
