# PLAN — Matter of Place, the sliced road to production

agent-os plan file (Stage 2 gate: exists, read, sliced). Each slice is one file in this folder with contract, files,
data changes, steps and verification. Decisions in `../../PROJECT-STATE.md`; open items in `ASSUMED.md`.
Owner agent is `mop-builder` unless noted. A slice is closed only when its verification output is pasted into
`.claude/POSITION.md` and re-run by the orchestrator.

## Order (dependencies from `03-diagrams/completion-map.md` §2)
| Wave | Slices | Why together |
|---|---|---|
| 0 | V1 visual pass | merged as PR #2 on 2026-09-30 |
| 1 | B1b repo and delivery | everything deploys through it; every prerequisite is met as of 2026-10-01 (setup A1 Cloudflare and tokens, setup A6 Sentry, setup A8 GitHub secrets, setup A11 email) |
| 2 | B2 database → B3 API → B3b coming-soon → B4 tests | the spine; nothing else persists without it |
| 3 | B8 job system · B8b automation console steps 1 to 5 · B5 email · B7 admin workspace (screens 1–4, 7–9, 11, 14, 15, 23–25) · B17 website essentials | the day-to-day operating system, and the public surface made compliant |
| 4 | B6 money box · B8b steps 6 to 10 · B16 legal identity | close the loop from accept to invoice to activate; automations become settings |

Waves 3 and 4 interleave. The landing order is line 5 of B5, B6, B7, B8, B8b and B16: B8 steps 1 to 8, B8b steps 1 to 5, B5, B16 steps 1 and 2 (any time after B2), the rest of B16 after B5, B7 steps 1 to 10, B6, B7 steps 11 to 16, B8 steps 9 and 10, B8b steps 6 to 10. Inside the shared files the order is B3, B3b, B5, B17, B16 (ASSUMED G33).
| 5 | B9 creative system (designer first) → B10 social · B11 newsletter · B12 reel | listings become content |
| 6 | B13 SEO/AEO/GEO → B14 audit robot (needs B13 checks) · B15 Omnikom handoff | be found, be measured, hand off |
| 7 | H1 HARDEN | gate before launch |
| 8 | L1 LAUNCH | DNS, production, first real property, watch week |

## 48-hour full build (S54, deadline 2026-10-04 00:00 EDT)
The operator set the date on 2026-10-02 00:00 EDT and the scope a few minutes later: "we are not cutting anything we
are getting it all built in 48 hours you will be orchestrating this". Every slice of this plan is in scope: B1b to B17,
H1 and L1, 237 steps. Nothing is deferred to "after launch". A launch cut the CTO wrote first was withdrawn the same
hour (GOTCHAS P-047).

237 steps do not fit in 48 hours one after another, so the build runs in lanes. Steps inside a slice stay in order;
slices that do not depend on each other run side by side, each lane in its own git worktree and branch, each landing on
`main` through CI. What already makes this safe: one writer at a time on `mop-dev` (G34, the advisory lock), the
shared-file order B3, B3b, B5, B17, B16 (G33, applied when lanes merge), and the landing order of line 5 of the wave 3
and 4 plans.

| Phase | Lanes (each is one builder session at a time, reviewed by a fresh context) |
|---|---|
| 0 Spine, one lane | B1b, then B2, then B3 |
| 1 Three lanes | Public: B3b, B4, B17, B16, B13, B15 · Operations: B8 steps 1 to 8, B8b steps 1 to 5, B5, B7 steps 1 to 10, B6, B7 steps 11 to 16, B8 steps 9 and 10, B8b steps 6 to 10 · Content: B9 (designer first, its wiring after B8 step 8), then B10, B11, B12, then B14 after B13 |
| 2 One lane | H1 on everything, then L1: `mop-prod`, production secrets, deploy, matterofplace.com routed to the Worker |

The orchestrator (this session) dispatches, re-runs each slice's proof itself, merges, and keeps the table at the end of
this file. A lane that fails the same step twice is recorded BLOCKED with what would unblock it and the lane moves to
its next slice that does not depend on it.

Built is not the same as switched on. Every step that calls an outside account is built and tested against its stub,
and goes live the hour the operator supplies the account; the table under "Start readiness" names each one. In order of
how much they hold back: the Resend account and key, R2 switched on (needs a payment method), the legal entity and
payment facts, the Anthropic API key, the X app, the LinkedIn page and app, Meta access through the partner, the Google
accounts, a fine-grained GitHub token for render dispatch, the Sentry auth token, the Omnikom endpoint.

Facts measured on 2026-10-02: the zone `matterofplace.com` is active on Cloudflare and public DNS answers with
Cloudflare's nameservers, so the domain needs no waiting time; Supabase holds one project (`mop-dev`), so `mop-prod`
fits the free plan. UNPROVEN: that 237 steps fit in the time, and that three lanes merge cleanly. The first measured
pace is B1b; the orchestrator reports it when B1b closes.

## Start readiness (2026-10-01)
Gate: `node workspace/05-plans/ready.mjs --full` must end with `READY TO BUILD: yes`. Procedure: `RUNBOOK.md`. One slice
is run with `Workflow({ name: "build-slice", args: { slice: "<id>" } })`.

No slice is blocked as a whole. Each one starts when the slices it depends on are closed. The table is rebuilt from the
plans by `node workspace/05-plans/readiness-table.mjs --write`: it counts the numbered steps that carry a BLOCKED part and
names what they wait on; every other step runs. The plans were audited in both directions on 2026-10-01 (six rounds, Opus
5.5 at high effort, 1,152 gaps in the first round, 42 blockers in the last, all fixed; rulings in ASSUMED section G), and
`trace.json` lists the 1,136 items that now trace to one owning slice, its files and a proof (S53).

| Slice | Steps with a waiting part | On what |
|---|---|---|
| B1b | 7 of 11 | mop-prod (created at launch), R2 switched on, GitHub Pro (branch protection), custom domain (L1) |
| B2 | 3 of 14 | mop-prod (created at launch), R2 switched on |
| B3 | 4 of 13 | Resend account |
| B3b | 2 of 10 | mop-prod (created at launch) |
| B4 | 1 of 10 | see the plan |
| B5 | 6 of 10 | Resend account, mop-prod (created at launch) |
| B6 | 4 of 9 | legal entity and payment facts, Resend account |
| B7 | 8 of 18 | Resend account, R2 switched on |
| B8 | 1 of 12 | GitHub dispatch token |
| B8b | none of 11 | none |
| B9 | 5 of 11 | CEO creative pick, R2 switched on, GitHub dispatch token, Anthropic API key, LinkedIn page and app, Meta app (partner) |
| B10 | 10 of 16 | X developer app, LinkedIn page and app, Meta app (partner), R2 switched on, Resend account, Anthropic API key, GitHub dispatch token |
| B11 | 5 of 13 | Resend account, R2 switched on, Meta app (partner) |
| B12 | 2 of 9 | R2 switched on, GitHub dispatch token |
| B13 | 4 of 13 | R2 switched on, Google accounts |
| B14 | 8 of 9 | Google accounts, Resend account, custom domain (L1) |
| B15 | 3 of 7 | Omnikom endpoint, mop-prod (created at launch) |
| B16 | none of 8 | none |
| B17 | 4 of 12 | R2 switched on, custom domain (L1), Resend account |
| H1 | 4 of 10 | R2 switched on |
| L1 | 2 of 11 | Google accounts |

What the operator can do at any time to shorten that list, in order of how much it unblocks: switch R2 on (10 slices have a waiting step), create the Resend account (9), supply the legal entity and payment facts, create the X, LinkedIn and Google
accounts and ask the partner for Meta access, create an Anthropic API key and a fine-grained GitHub token for render
dispatch. `mop-prod`, the custom domain and the creative pick come up inside their own slices.

## Slice files
B1b.md · B2.md · B3.md · B3b.md · B4.md · B5.md · B6.md · B7.md · B8.md · B8b.md · B9.md · B10.md · B11.md · B12.md ·
B13.md · B14.md · B15.md · B16.md · B17.md · H1.md · L1.md · ASSUMED.md · RUNBOOK.md · check-plans.mjs · ready.mjs · readiness-table.mjs · trace.json · logs/ (one evidence log per slice)

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
