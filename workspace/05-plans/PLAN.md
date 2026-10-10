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
| 0 Spine, two lanes while they do not depend on each other (ruling H45 (4), 2026-10-02) | Delivery: the rest of B1b (steps 6 to 11) · Database: B2, which depends only on B1b steps 1 to 3 · then one lane: B3, then B4 steps 1 to 8 and the live-forms and caching parts of step 9 (ASSUMED H, T-02: the CI gates exist before the phase 1 lanes open) |
| 1 Three lanes, opened when a PR shows the `db` and e2e jobs running | Public: B3b, the rest of B4, B17, B16, B13, B15 · Operations: B8 steps 1 to 8, B8b steps 1 to 5, B5, B7 steps 1 to 10, B6, B7 steps 11 to 16, B8 steps 9 and 10, B8b steps 6 to 10 · Content: B9 (designer first, its wiring after B8 step 8), then B10, B11, B12, then B14 after B13 |
| 2 One lane | H1 on everything, then H2 (the acceptance panel: three senior agents walk the finished site, fixes through the ordinary workflow, two clean passes), then L1: the launch switch of the one database (ASSUMED H35), production secrets, deploy, matterofplace.com routed to the Worker |

The orchestrator (this session) dispatches, re-runs each slice's proof itself, merges, and keeps the table at the end of
this file. A lane that fails the same step twice is recorded BLOCKED with what would unblock it and the lane moves to
its next slice that does not depend on it.

Actions minutes (ruling H6, B1b invariant 14): before each phase the orchestrator sums the month's run durations from
`gh api repos/AbdulrahmanAmer/matter-of-place/actions/runs --paginate` and records the minutes in `.claude/POSITION.md`;
at 70 percent of 2,000 it runs `gh variable set CI_HEAVY --body off`. Merges go only through
`node workspace/05-plans/merge-gate.mjs <pr>` once B1b step 5b has written it (RUNBOOK step 3).

Built is not the same as switched on. Every step that calls an outside account is built and tested against its stub,
and goes live the hour the operator supplies the account; the table under "Start readiness" names each one. In order of
how much they hold back, as the operator set them on 2026-10-02 (S59): the uptime monitor account (he signs up, the
orchestrator sets it up), the legal entity and payment facts (last phase), the X app, the LinkedIn page and app and Meta
access through the partner (at the end), Google Analytics and Search Console (set up by the orchestrator when the build
needs them). Done: Resend (E17 to E20), Sentry with its token (E21), the GitHub token for render dispatch (E22). Gone:
R2 (S57, files live in Supabase Storage), the Anthropic key (S58, captions through the laptop runner), a second database
(S60). The Omnikom endpoint does not exist, so B15 is built and stays switched off. GitHub Pro was declined (H5).

Facts measured on 2026-10-02: the zone `matterofplace.com` is active on Cloudflare and public DNS answers with
Cloudflare's nameservers, so the domain needs no waiting time; Supabase holds one project (`mop-dev`), which is the
one database of S60. UNPROVEN: that 237 steps fit in the time, and that three lanes merge cleanly. The first measured
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
| B1b | 4 of 16 | GitHub Pro (branch protection), custom domain (L1) |
| B2 | 2 of 15 | see the plan |
| B3 | 3 of 18 | Resend live step (deployed endpoint or the production key at L1; the account exists, E17) |
| B3b | none of 10 | none |
| B4 | 1 of 10 | see the plan |
| B5 | 2 of 10 | Resend live step (deployed endpoint or the production key at L1; the account exists, E17) |
| B6 | 2 of 9 | legal entity and payment facts |
| B7 | none of 20 | none |
| B8 | 1 of 14 | see the plan |
| B8b | none of 11 | none |
| B9 | 2 of 11 | CEO creative pick |
| B10 | 9 of 16 | X developer app, LinkedIn page and app, Meta app (partner) |
| B11 | 3 of 13 | Resend live step (deployed endpoint or the production key at L1; the account exists, E17), legal entity and payment facts, Meta app (partner) |
| B12 | none of 9 | none |
| B13 | 2 of 13 | see the plan |
| B14 | 7 of 9 | custom domain (L1) |
| B15 | 3 of 7 | Omnikom endpoint |
| B16 | none of 8 | none |
| B17 | 4 of 12 | custom domain (L1), Resend live step (deployed endpoint or the production key at L1; the account exists, E17) |
| H1 | 3 of 11 | see the plan |
| L1 | 2 of 11 | Google accounts |
| H2 | none of 6 | none (the panelists run on Opus 5.5 at high effort: S66 amended by S67, operator 2026-10-10 13:35) |

What the operator can do at any time to shorten that list: sign up for the uptime monitor, supply the legal entity and
payment facts, and at the end create the X and LinkedIn apps and ask the partner for Meta access (S59). The custom
domain and the creative pick come up inside their own slices.

## Slice files
B1b.md · B2.md · B3.md · B3b.md · B4.md · B5.md · B6.md · B7.md · B8.md · B8b.md · B9.md · B10.md · B11.md · B12.md ·
B13.md · B14.md · B15.md · B16.md · B17.md · H1.md · L1.md · ASSUMED.md · RUNBOOK.md · check-plans.mjs · ready.mjs · readiness-table.mjs · trace.json · logs/ (one evidence log per slice)

## Rules for working the plan
- One slice per builder session; a builder reads GOTCHAS.md, CLAUDE.md, the slice file and the two spec documents, nothing else first.
- Every new test is watched-fail before it counts. Every slice ends with `bun run check`, `bun run build` and its own proof.
- `node workspace/05-plans/check-plans.mjs` must print OK before any plan change is committed (P-031).
- Cross-slice conflicts are settled in ASSUMED.md §A; a builder who finds a new one stops and writes it there.
- `progress.json` is the ledger of accepted steps. The orchestrator writes a step into it in the same change as the status
  row below, only after the fresh review accepted it and its proofs were re-run, and `node workspace/05-plans/board.mjs --check`
  must print `board: OK`. The operator reads it as a page: `node workspace/05-plans/board.mjs` serves http://127.0.0.1:8790.
- Every time in these files is the laptop's clock, UTC+3. "EDT" in older lines is the shell's label for Egypt Daylight Time,
  not US Eastern (GOTCHAS P-130); new lines carry the numeric offset.
- The orchestrator re-runs the slice's verification before marking it closed here:

| Slice | Status | Closed on | Proof |
|---|---|---|---|
| V1 | closed | 2026-09-30 | PR #2 merged; check, build, render gate green; 22 of 26 defects fixed |
| B1a | closed | 2026-10-01 | PR #1 and PR #3 merged: Lovable removed, plain Vite, first test, brand favicon; the repository is not connected to Lovable (ASSUMED E13) |
| B1b | in progress | | lane `E:/mop-build/spine`; steps 1 to 10 accepted and on `main` (PRs #22, #43, `e6f05e9`); step 7b (rollback rehearsal) running; step 9 BLOCKED on GitHub Pro (H5), the merge gate stands in; step 11 waits on L1. |
| B2 | closed | 2026-10-03 | lane `E:/mop-build/db`; steps 1 to 14 accepted and on `main` (PRs #49, #67, #93, `afe750c`); close-out c9 for advisor lint 0029; the upload half of step 13 waits on B9 step 6. |
| B3 | closed | 2026-10-04 | lane `E:/mop-build/api` (branch `slice/b3`); 18 steps accepted, merged in PRs #102 and #100 (2ab9d52); the dev Worker runs live. Item 8 of step 12 is L1's (production Worker secrets); step 13's render CPU is UNPROVEN in the runbook. |
| B3b | closed | 2026-10-05 | lane `E:/mop-build/coming`; 10 steps accepted, merged in PRs #118, #122, #128 (9529d0a). The production switch (H49 (1)) waits on the production Worker's secrets and the production Turnstile pair. |
| B4 | closed | 2026-10-05 | lane `E:/mop-build/tests`; 10 steps accepted, merged in PRs #97, #105, #119 (50e14b8). LCP and script size at `warn` until H1 (H61); the CPU gate wiring is a recorded follow-up. |
| B5 | closed | 2026-10-06 | lane `E:/mop-build/email` (branch `slice/b5`); 10 steps accepted and on `main` (PRs #108, #137, #155, #171, merged 2026-10-06 11:43). Live send of step 5 waits on RESEND_API_KEY and EMAIL_LIVE=1 on mop-dev and the runner deploy (orchestrator, from the shell that holds the secret). |
| B6 | not started | | |
| B7 | in progress | | started 2026-10-05 04:00 in the lane `E:/mop-build/admin` (branch `slice/b7`, port 8948, bank numbers from P-2000 and G-900). |
| B8 | in progress | | lane `E:/mop-build/ops` (branch `slice/b8`, port 8838, bank numbers from P-900 and G-350); steps 1 to 8a on `main` (PRs #101, #109, #113); 2a open, 9 to 10a wait on B7 and B8b. |
| B8b | in progress | | started 2026-10-04 14:40 in the lane `E:/mop-build/auto` (branch `slice/b8b`, port 8908, bank numbers from P-1600 and G-700); step 1 on `main` (PR #115). |
| B9 | in progress | | lane `E:/mop-build/design`; steps 1 to 6 on `main` (PRs #92, #99); direction S65; 7 to 11 wait on B8 and B7. |
| B10 | in progress | | started 2026-10-07 01:30 on the Dell (worktree `D:/mop-build/social`, branch `slice/b10`, run wf_023873a9-fb0); groups 0 and 1 to 3b accepted by the reviewer; steps 1, 2, 3a and 3b wait on the operator's Meta, X and LinkedIn apps (S59, E9), the rest of the slice builds without them. |
| B11 | not started | | |
| B12 | closed | 2026-10-06 | lane `E:/mop-build/video` (branch `slice/b12`); 9 steps accepted and on `main` (PR #161, merged 2026-10-06 07:46; step 7 under ruling H63, the attach audit row is a system row). |
| B13 | in progress | | started 2026-10-05 00:30 in the lane `E:/mop-build/seo` (branch `slice/b13`, port 8928, bank numbers from P-1800 and G-800). |
| B14 | in progress | | started 2026-10-04 in the lane `E:/mop-build/audit` (branch `slice/b14`, port 8858, bank numbers from P-1100 and G-450); steps 2, 3 and 6 on `main` (PR #103). |
| B15 | closed | 2026-10-05 | lane `E:/mop-build/handoff`; 7 steps accepted, merged in PRs #127, #132, #135 (0f5d678). Step 6 admin half waits on B7 steps 2 and 11 (recorded in B15-followups.md); the real Omnikom endpoint and the contract note are the operator's (S59). |
| B16 | in progress | | started 2026-10-04 in the lane `E:/mop-build/legal` (branch `slice/b16`, port 8848, bank numbers from P-1000 and G-400); steps 1 and 2 (part) on `main` (PR #98). |
| B17 | in progress | | started 2026-10-05 00:30 in the lane `E:/mop-build/site` (branch `slice/b17`, port 8938, bank numbers from P-1900 and G-850). |
| H1 | in progress | | started 2026-10-08 in the lane `E:/mop-build/harden` (branch `slice/h1`, port 8878, bank numbers from P-2800 and G-1300); steps 1 to 3 accepted, step 4 in review (2026-10-10); H1-09 (security scan) and H1-18 (reset and reseed) are the orchestrator's, rulings H75 and the PAUSED block of `.claude/POSITION.md`. |
| H2 | not started | | added 2026-10-04 (S66): the acceptance panel, after every B slice and H1 steps 1 to 5, before L1. |
| L1 | not started | | |
