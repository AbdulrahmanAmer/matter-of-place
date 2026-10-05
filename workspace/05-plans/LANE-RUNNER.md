# Lane runner: a second machine that builds slices

Written 2026-10-06 for the Dell Precision (i5 8th generation H, 4 cores, 8 threads). The orchestrator stays on the
first laptop and keeps the records (position, ledger, board, bank merges of main); the second machine runs lanes
and nothing else. The two meet only through GitHub: branches, pull requests and the merge gate.

## Why this works without special wiring

A lane is a branch, a folder, a port and a bank number range. Everything a lane needs is in the repository (the
plans, the workflow script, the bank, the merge gate, the saved launch calls in `workspace/05-plans/lanes/`) or in
`.env`. The database is the cloud project `mop-dev`; CI runs on GitHub. No lane state lives on either laptop that
the other needs, except the worktree it is working in.

## Set-up (about an hour, mostly downloads)

1. Install: Git for Windows, Node 24, bun (`powershell -c "irm bun.sh/install.ps1 | iex"`), GitHub CLI (`gh auth login`
   as the repository's owner account, the same one as the first laptop), Claude Code (sign in with the account that
   has usage left: two machines on one account share its weekly limit).
2. Clone: `git clone https://github.com/AbdulrahmanAmer/matter-of-place.git "E:\Matter Of Place"` (any drive; the lane
   folders below assume `E:\mop-build`). Then `cd app && bun install && bunx playwright install chromium`.
3. Secrets: the operator copies `.env` from the first laptop into the clone's root himself (never through chat, never
   into a message). Then `node app/scripts/dev-vars.mjs` is run by each lane as it needs it; nothing else to do.
4. GPU: if the machine has two graphics chips, pin Playwright's and puppeteer's browsers to the fast one as P-522's
   neighbour entry describes (per-executable `GpuPreference=2` under `HKCU\Software\Microsoft\DirectX\UserGpuPreferences`).
5. Status line and prompt hooks: none on a build machine (P-522, P-527).
6. Open a terminal in the clone and start Claude Code. Say: "You are the lane runner. Read workspace/05-plans/LANE-RUNNER.md
   and run the lanes it assigns to this machine."

## What the lane runner does

- Reads `.claude/POSITION.md` (the last block) and `workspace/05-plans/lanes/<slice>.json` for each slice assigned
  below. For each: create the worktree (`git worktree add E:/mop-build/<lane> -b slice/<x> origin/main`, or `origin/slice/<x>`
  when the branch exists), copy `.env` into it, `bun install` in its `app/`, copy any ignored media the slice's proofs
  need (P-523), then launch `Workflow({ scriptPath: ".claude/workflows/build-slice.js", args: <the saved args> })`.
- Keeps two lanes running on this machine (three only if the processor stays under about 80 percent); re-arms a
  Monitor on the runs' journals; when a run ends with the slice merged, picks the next assigned slice.
- Handles a blocked merge the way the orchestrator does: the three merge chores are scripts (P-526:
  `node workspace/05-plans/bank-merge.mjs`, `bun run migrations:restamp`, `bun run types:from-ci -- <pr>`); a merge
  that fails for any other reason is reported in the position file's lane line, not fixed by hand.
- Never edits `progress.json`, `PLAN.md` rows, `README.md` or the position file's orchestrator blocks; appends one
  line per event under a heading `## Lane runner (Dell)` at the end of `.claude/POSITION.md` on its own records
  branch and merges it through the gate (documents-only merges need no CI).
- Uses the bank numbers of its slices' ranges only (each `lanes/<slice>.json` carries `bankBase`).

## Assignment (edit this list; the orchestrator owns it)

| slice | lane folder | port | status |
|---|---|---|---|
| B16 (steps 3 to 8) | E:/mop-build/legal | 8848 | opens when B5 step 4 and B17 step 1 are on main |
| B10 (steps 0, 3, 4, 5, 5a) | E:/mop-build/social | 8968 | opens when B8b steps 1 to 5 are on main (they are) and B7 steps 1 to 3 are on main |
| B14 (steps 1, 4, 5, 7, 8, 9) | E:/mop-build/audit | 8858 | opens when B13 and B7 steps 1 to 3 are on main |

The first laptop keeps B13, B12, B17, B5 and B7 until they close.
