# Second laptop: setup and how it is run from here

Written 2026-10-06 (revised 10:45 after the operator's decision to pause the runs and bring the Dell Precision in as a
fully managed second machine). The orchestrator stays in this session on the first laptop and keeps the records
(position, ledger, board, bank merges of main). The second laptop runs a Claude Code session with Remote Control on, so
this session can see it, brief it and read its answers; it runs lanes and nothing else. The two machines meet only
through GitHub (branches, pull requests, the merge gate) and the shared mop-dev writer lock (`pg_advisory_lock`
`mop-dev-tests`, which already serialises writers across machines).

## Setup checklist for the operator (about an hour, mostly downloads; you type every password yourself)

1. Windows: make sure NO other project's keys live in the user-level environment. In PowerShell:
   `[Environment]::GetEnvironmentVariable('SUPABASE_URL','User')` must print nothing (G-901: on the first laptop this
   name belongs to OmniSkipX and a test wrote there). Same for `SUPABASE_SERVICE_ROLE_KEY` and `CLOUDFLARE_API_TOKEN`.
2. Install, in this order: Git for Windows; Node 24 (`node -v` → v24); bun 1.3.13 exactly
   (`powershell -c "irm bun.sh/install.ps1 | iex"` then `bun upgrade --version 1.3.13` if it installed another;
   `bun -v` → 1.3.13); GitHub CLI (`gh auth login`, the repository's owner account); Deno 2.8 (`irm https://deno.land/install.ps1 | iex`;
   the job-runner checks use it); PostgreSQL 18 client tools (only `psql` is needed; the installer's "Command Line
   Tools" component); ffmpeg (winget `Gyan.FFmpeg`; the motion gate and reel lanes use it); Claude Code, signed in
   with the account that has usage left (two machines on one account share its weekly limit; the 92 percent pause rule
   applies to the sum).
3. Clone: `git clone https://github.com/AbdulrahmanAmer/matter-of-place.git "E:\Matter Of Place"` (any drive; the lane
   folders below assume `E:\mop-build`). Then `cd "E:\Matter Of Place\app"`, `bun install --frozen-lockfile`,
   `bunx playwright install chromium`.
4. Secrets: copy `.env` from the first laptop into the clone's root yourself (a USB stick or your own transfer; never
   through chat, never into a message). It carries the dev profile (`DEV_SUPABASE_PROJECT_REF`,
   `DEV_SUPABASE_SERVICE_ROLE_KEY`, `DEV_DB_URL`) and the Cloudflare pair every wrangler call needs (P-530).
   Check: `node app/scripts/load-env.mjs --profile dev > $null` prints no "has no" line.
5. GPU: if the machine has two graphics chips, pin Chromium and Node to the fast one (per-executable
   `GpuPreference=2;` under `HKCU\Software\Microsoft\DirectX\UserGpuPreferences`, as P-522's neighbour entry describes).
6. No status line, no prompt hooks on a build machine (P-522, P-527).
7. Open a terminal in `E:\Matter Of Place` and start: `claude --remote-control dell` . When it is connected, say in it:
   "You are the lane runner on the second laptop. Read workspace/05-plans/lane-runner.md and wait for the
   orchestrator's brief." Leave that window open; the orchestrator on the first laptop takes it from there.

## What the lane runner does (the session on the second laptop)

- Reads `.claude/POSITION.md` (the last block) and `GOTCHAS.md` (its first line first). Waits for the orchestrator's
  brief, which names the slices, the lane folders, the ports and the bank number ranges for this machine.
- For each assigned slice: creates the worktree (`git worktree add E:/mop-build/<lane> -b slice/<x> origin/main`, or
  from `origin/slice/<x>` when the branch exists), copies `.env` into it, runs `bun install --frozen-lockfile` in its
  `app/`, copies any ignored media the slice's proofs need (P-523), then launches
  `Workflow({ scriptPath: ".claude/workflows/build-slice.js", args: <the args of workspace/05-plans/lanes/<slice>.json> })`.
- Keeps as many lanes as the processor allows (start with four; add one while the CPU stays under about 80 percent
  and the reviewers' `bun run check` runs finish under six minutes); runs `node workspace/05-plans/stall-watch.mjs
  --minutes 20 --runs <ids>` every five minutes; when a run ends with its slice merged, picks the next assigned slice.
- Handles a blocked merge the way the orchestrator does: the three merge chores are scripts (P-526:
  `node workspace/05-plans/bank-merge.mjs`, `bun run migrations:restamp`, `bun run types:from-ci -- <pr>`); a merge
  that fails for any other reason is reported to the orchestrator, not fixed by hand.
- Never edits `progress.json`, `PLAN.md` rows, `README.md` or the position file's orchestrator blocks; appends one
  line per event under a heading `## Lane runner (Dell)` at the end of `.claude/POSITION.md` on its own records
  branch and merges it through the gate (documents-only merges need no CI).
- Uses only the bank numbers of its slices' ranges (each `lanes/<slice>.json` carries `bankBase`).
- Answers the orchestrator's messages with facts: run ids, group states, PR numbers, the exact failing line.

## How the orchestrator drives it

- `ListAgents` shows the Dell session once Remote Control is connected; `SendMessage` carries the brief and later
  instructions; the Dell's replies come back the same way. Everything that must survive a compaction goes into the
  repository (the lane files, the position file), not into messages.
- Assignment at pause time (2026-10-06 10:45; the orchestrator edits this list):

| slice | where | lane folder | port | opens when |
|---|---|---|---|---|
| B5 (steps 7 to 9, finishing) | first laptop | E:/mop-build/email | 8868 | running, merges on its own |
| B17 (steps 7 to 12) | first laptop or Dell | E:/mop-build/site | 8938 | paused after step 6; relaunch from `lanes/B17.json` |
| B7 (steps 5 to 16) | Dell (long slice) | E:/mop-build/admin | 8948 | paused after step 4; relaunch from `lanes/B7.json` |
| B13 (steps 8 to 13) | Dell | E:/mop-build/seo | 8928 | after PR 158 lands (H62 line), from `lanes/B13.json` |
| B10 (steps 0, 3, 4, 5, 5a) | Dell | E:/mop-build/social | 8968 | after B7 steps 2 and 3 are on main (PR 158) |
| B14 (steps 1, 4, 5, 7, 8, 9) | first laptop | E:/mop-build/audit | 8858 | after B13 and B7 steps 1 to 3 are on main |
| B16 (steps 3 to 8) | first laptop | E:/mop-build/legal | 8848 | after B17 step 1 (PR 142) is on main |

The remaining slices open as their dependencies land; `node workspace/05-plans/check-plans.mjs` and the plans' "Depends
on" lines decide, never memory.
