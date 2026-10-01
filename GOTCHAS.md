# GOTCHAS — the bank of things that already cost us time

Purpose: never re-discover a fix, never re-break a thing that works. Every entry names the paths it protects, what
went wrong, why, the rule, and how to prove the rule still holds. `.claude/hooks/gotcha-guard.mjs` reads this file
before every Edit or Write and pushes the matching entries into the session (severity `block` refuses the edit;
`warn` injects the entry as context). Entries without a `paths:` line are process gotchas and are never injected;
they are read by `mop-work` at session start.

Rules for the bank itself
- Numbers are unique and never reused: before adding, `grep -c "^## P-" GOTCHAS.md` and take the next free number (P-030 is next as of 2026-09-30). Duplicates from parallel workers get renumbered by the orchestrator, never silently merged.
- Add an entry the same day something wastes more than 30 minutes or breaks after a push. Do not wait for a retro.
- Keep it under 40 live entries. When one is covered by a test or a hook, mark it `enforced-by:` and it stops being
  injected (the mechanism enforces it, the prose just documents it).
- One `paths:` line, comma separated, project-relative globs (`**` and `*`). Severity is `block` only when an edit
  is never legitimate; otherwise `warn`.
- `proof:` is a command and the output that shows the rule holds. No proof, no entry.

Entry template
```
## G-0NN · <one-line title>
- paths: <glob>[, <glob>]
- severity: warn | block
- symptom: <what you saw>
- cause: <why>
- rule: <never X / always Y>
- proof: <command> → <expected output>
- added: YYYY-MM-DD
```

---

## G-001 · Generated route tree must never be edited by hand
- paths: Matter Of Place Codebase/src/routeTree.gen.ts
- severity: block
- symptom: hand edits vanish on the next `vite dev` or build, and routing silently diverges from the files on disk.
- cause: `@tanstack/router-plugin` regenerates this file from `src/routes/*`.
- rule: add or rename a route by adding or renaming the file under `src/routes/`; never touch the generated file.
- proof: `bun run build` regenerates it; `git diff --stat src/routeTree.gen.ts` after a build is the only legitimate diff.
- added: 2026-09-30

## G-002 · Vite config is plain and explicit; Start's plugin already generates the route tree
- paths: Matter Of Place Codebase/vite.config.ts
- severity: warn
- symptom: duplicate-plugin crash ("plugin already registered"), two route generators fighting, or a build that silently targets Node instead of Cloudflare.
- cause: `@tanstack/react-start/plugin/vite` bundles the router generator; the Cloudflare target exists only because `nitro({ preset: "cloudflare-module" })` is added on build; nitro invents a worker name from the git remote when none is pinned.
- rule: every plugin is listed once in `vite.config.ts` (tsConfigPaths, tanstackStart, nitro on build, viteReact); never add `@tanstack/router-plugin` yourself; keep `cloudflare.wrangler.name` pinned to `matter-of-place`. The file is the whole config; there is no preset behind it any more (2026-09-30).
- proof: `bun run build` → "built in"; `.output/nitro.json` preset `cloudflare-module`; `.output/server/wrangler.json` name `matter-of-place`.
- added: 2026-09-30 (rewritten the same day when the preset was removed)

## G-003 · Page titles: pass the bare title, `pageHead` adds the suffix
- paths: Matter Of Place Codebase/src/lib/seo.ts, Matter Of Place Codebase/src/routes/index.tsx
- severity: warn
- symptom: home `<title>` renders "Matter of Place | Exceptional property. Properly considered. | Matter of Place".
- cause: `pageHead` only skips the " | Matter of Place" suffix when the title already ends with it; the home route passes a title that starts with the brand instead.
- rule: routes pass titles without the brand; `pageHead` skips the suffix when the title is the brand, starts with "Matter of Place | " or already ends with the suffix (fixed 2026-09-30, slice B1a).
- proof: `curl -s http://localhost:8080/ | grep -o "<title>[^<]*"` → exactly one "Matter of Place".
- enforced-by: tests/unit/seo.test.ts (`bun run test`, part of `bun run check`)
- added: 2026-09-30

## G-004 · Field names live in three files and must change together
- paths: Matter Of Place Codebase/src/domain/**, Matter Of Place Codebase/supabase/migrations/**
- severity: warn
- symptom: a field renamed in one place returns `undefined` in the UI or fails the Zod parse on the server with no type error.
- cause: `src/domain/*.ts` (camelCase) = API JSON = `schema.sql` columns (snake_case); the HTTP adapter has no mapping layer by design (ADR 0002).
- rule: change the domain type, the Zod contract and the SQL column in the same commit; grep the old name across all three before finishing.
- proof: `grep -rn "<oldName>" src/domain docs/database` → no hits.
- added: 2026-09-30

## G-005 · Routes never import bundled data directly
- paths: Matter Of Place Codebase/src/routes/**
- severity: warn
- symptom: a page keeps showing illustrative content after the API goes live because it bypassed the service boundary.
- cause: importing `src/data/*` in a route hard-wires local mode.
- rule: read through `src/lib/queries.ts` and `services`; the only allowed direct imports are `data/exposure.ts` and `data/faq.ts` (static marketing copy).
- proof: `grep -rln "from \"../data/" src/routes` → only files that import exposure or faq.
- added: 2026-09-30

## G-006 · `VITE_*` variables ship to the browser
- paths: Matter Of Place Codebase/.env.example, Matter Of Place Codebase/src/env.d.ts, Matter Of Place Codebase/src/config/site.ts
- severity: warn
- symptom: a key committed as `VITE_SOMETHING_SECRET` is visible in the built JS.
- cause: Vite inlines every `VITE_*` value at build time.
- rule: secrets go in `wrangler secret put` (server side) only; `VITE_*` is for public URLs and flags. The global `secret-scan` hook also checks writes.
- proof: `grep -rn "VITE_" .env.example` → only SITE_URL, API_BASE_URL, INSTAGRAM_URL, TURNSTILE_SITE_KEY, GA4_MEASUREMENT_ID (all public by nature; every secret stays server side).
- added: 2026-09-30

## G-007 · Styling is tokens only: no hex, no utility classes
- paths: Matter Of Place Codebase/src/styles/**, Matter Of Place Codebase/src/components/**
- severity: warn
- symptom: a colour drifts from the palette or a utility class does nothing (Tailwind was removed on 2026-09-30; it was never imported).
- cause: ADR 0003; the palette lives in `src/styles/tokens.css` and `--muted` is a surface, `--muted-foreground` is text.
- rule: new colour or spacing goes into `tokens.css` first, then is referenced by `var(--...)`; sections set vertical padding only, `.section-wrap` owns width.
- proof: `grep -rn "#[0-9a-fA-F]\{6\}" src/components src/styles --include=*.tsx --include=*.css | grep -v tokens.css` → no hits.
- added: 2026-09-30

## G-008 · Line endings: this repo is LF, Windows wants CRLF
- paths: .gitattributes
- severity: warn
- symptom: whole-file diffs, or the global `postwrite-sanity` hook rejecting a file for CRLF.
- cause: Windows git defaults to `core.autocrlf true`.
- rule: `.gitattributes` forces `eol=lf` and the repo sets `core.autocrlf false`; never change either. Editors must save LF.
- proof: `git config core.autocrlf` → false; `git ls-files --eol | grep -c crlf` → 0.
- added: 2026-09-30

## G-009 · Lovable history is append-only
- paths: .git/**
- severity: warn
- symptom: Lovable loses the project history after a force push, rebase or squash of pushed commits.
- cause: Lovable mirrors the connected branch (AGENTS.md). Not connected today, but the rule stands so it never has to be re-learned.
- rule: never rewrite pushed history on `main`; fix forward.
- proof: `git log --oneline origin/main` is a strict prefix of `git log --oneline main`.
- added: 2026-09-30

## G-010 · The codebase `docs/` folder is the Lovable sketch, not the spec
- paths: Matter Of Place Codebase/docs/**
- severity: warn
- symptom: an agent implements `schema.sql`, Cloudflare Queues or request-time image resizing "because the docs say so".
- cause: those docs were written for an MVP; the CEO-approved spec (2026-09-30) is `workspace/02-tech-stack/tech-stack.md`.
- rule: read `docs/` for intent only. Schema comes from `supabase/migrations`, jobs from pgmq + GitHub Actions, images from variants made at publish. Update or delete a docs page when the built thing diverges; never the other way round.
- proof: `grep -rn "Cloudflare Queues\|cdn-cgi/image" src supabase` → no hits in built code.
- added: 2026-09-30

## G-011 · No paid platform feature without a settled decision
- paths: Matter Of Place Codebase/wrangler.toml, Matter Of Place Codebase/src/server/**, Matter Of Place Codebase/supabase/**
- severity: warn
- symptom: a binding for Queues, Browser Rendering, Images, Durable Objects, or a Supabase Pro-only feature appears in config.
- cause: each of those is a monthly bill; the approved stack is free tier first.
- rule: free-tier limits are in GOTCHAS P-009; if a limit is hit, record the measurement and add a decision to PROJECT-STATE.md before adding the binding.
- proof: `grep -n "queues\|browser\|images\|durable" wrangler.toml` → no hits.
- added: 2026-09-30

## G-012 · GitHub Actions reads workflows only at the repository root, which is the workspace folder
- paths: Matter Of Place Codebase/.github/**
- severity: block
- symptom: a workflow written under `Matter Of Place Codebase/.github/workflows/` never runs; tech-stack §3 draws the folder under the app, which is where a builder would put it.
- cause: the git root is `E:\Matter Of Place` (workspace + app in one repo); GitHub ignores nested `.github` folders.
- rule: workflows live in `.github/workflows/` at the repo root and set `working-directory: Matter Of Place Codebase` per job; never create `.github` under the app. Correct tech-stack §3 when it is next edited.
- proof: `git rev-parse --show-toplevel` → `E:/Matter Of Place`; `ls .github/workflows` at the root → README.md (workflows arrive with B1b).
- added: 2026-09-30

---

# Process and tooling gotchas (no paths; loaded by `mop-work`, not injected)

## P-009 · Free-tier limits we are designing inside (measured 2026-09; re-check quarterly)
- Cloudflare Workers free: 100k requests/day, 10 ms CPU per request; R2 10 GB, zero egress; Turnstile and one rate-limit rule free; Image transformations free only to 5k/month (we do not use them).
- Supabase free: 500 MB database, 1 GB storage, 5 GB egress/month, 50k monthly auth users, 500k Edge Function calls; project pauses after 7 idle days (keep-warm cron on Cloudflare).
- Resend free: 3,000 emails/month, 100/day, audience up to 1,000 contacts.
- GitHub Actions on a private repo: 2,000 minutes/month (a reel render is ~3 minutes).
- Sentry free: 5k errors/month. GA4, Search Console, Bing, Cloudflare Web Analytics: free.
- rule: the audit robot reports usage against each line monthly; the first line to cross 70% triggers a decision, not a surprise invoice.
- added: 2026-09-30

## P-001 · agent-os stage 0 refuses `src/**` even though the app is one folder down
- symptom: an Edit under `Matter Of Place Codebase/src/` is denied with "STAGE 0 (SHAPE) does not allow writing".
- rule: it is a sequencing gate. Put the finding in POSITION.md or GOTCHAS.md, and ask the operator to advance the STAGE line in PROJECT-STATE.md when the stage gate is met. Do not work around it in `workspace/`.
- proof: `python ~/.agent-os/scripts/agent_os.py check "Matter Of Place Codebase/src/routes/index.tsx"` → denied.
- added: 2026-09-30

## P-002 · `npx` on this machine can fail with `ECOMPROMISED Lock compromised`
- symptom: `npx -y <pkg>` dies after minutes with the npm cache lock error (seen while plugin installs ran concurrently).
- rule: use `bunx <pkg>` for one-off CLIs; bun has its own cache. Use `bun install` in the codebase.
- proof: `bunx @mermaid-js/mermaid-cli --version` → 12.0.0.
- added: 2026-09-30

## P-003 · mermaid-cli 12 flags: `--size` and `--scale`, not `-w`
- symptom: `error: unknown option '-w'`.
- rule: `bunx @mermaid-js/mermaid-cli -i file.md -o out.png -b white --size 2400 --scale 2`; `workspace/03-diagrams/render.mjs` already does this.
- proof: `node workspace/03-diagrams/render.mjs` → "done → …/img".
- added: 2026-09-30

## P-004 · Mermaid rejects `:::class` on a subgraph line
- symptom: "Expecting 'SEMI', 'NEWLINE', 'EOF', got 'STYLE_SEPARATOR'".
- rule: style subgraphs with `style <id> stroke-dasharray: 5 5`; `:::class` is for nodes only.
- proof: all four blocks in `big-diagram.md` parse (`render.mjs` exit 0).
- added: 2026-09-30

## P-005 · The in-app browser renders `file://` pages as static snapshots
- symptom: a local HTML page with a script never runs it; page tools refuse to act on the tab.
- rule: serve the folder over `http://127.0.0.1:<port>` (`python -m http.server`) and open that URL in a new tab; stop the server afterwards.
- proof: the Mermaid parse check only reported results once served from localhost.
- added: 2026-09-30

## P-006 · The operator reads pictures, not Mermaid
- rule: every diagram ships as PNG + SVG under `workspace/03-diagrams/img/` and is sent with SendUserFile. Mermaid source alone is not a deliverable.
- proof: `ls workspace/03-diagrams/img` → one PNG and one SVG per diagram.
- added: 2026-09-30

## P-008 · The Bash tool on this Windows machine collapses `\\` inside single quotes
- symptom: a JSON payload typed inline as `'{"file_path":"E:\\Matter..."}'` reaches the process with single backslashes, so `JSON.parse` fails (or `\r` becomes a carriage return) and the test looks like a silent failure of the thing under test.
- rule: never build Windows paths inline in Bash; write the payload with the Write tool (or use forward slashes) and pipe the file in. A hook that fails open will hide this from you.
- proof: `node .claude/hooks/gotcha-guard.mjs < scratchpad/payload.json` (file written by the Write tool) → deny JSON.
- added: 2026-09-30

## P-010 · New agent definitions and `fork` are not available mid-session
- symptom: `Agent type 'mop-producer' not found` right after writing `.claude/agents/mop-producer.md`; `Agent type 'fork' not found` in this build.
- cause: agent definitions are read at session start; the context-inheriting `fork` type is not in this Claude Code build.
- rule: a specific model + effort for a worker in the same session = headless `claude -p --model <id> --effort <level> --dangerously-skip-permissions --output-format json` with the brief piped on stdin (`cat brief.md | claude -p …`), run in the background with `CLAUDE_SYNC_SKIP=1 CLAUDE_LEARN_SKIP=1`. "All my context" for a worker = the brief lists the files to read (CLAUDE.md, PROJECT-STATE, POSITION, GOTCHAS, tech-stack); it cannot inherit the transcript.
- proof: `ls launch/producer-run.json` exists after the headless producer starts; in-session `Agent` with the new type fails until restart.
- added: 2026-09-30

## P-011 · Two workers, one working tree: a branching agent moves the whole tree
- symptom: `git branch --show-current` → `chore/remove-lovable` while the orchestrator still has uncommitted doc changes on "main"; anything committed now lands on the worker's branch, and `git add -A` by the worker sweeps the orchestrator's files into its PR.
- rule: commit and push main work BEFORE spawning any agent that branches; while a branching worker runs, check the branch before every commit and never commit off `main`; never `git stash` or checkout under a running worker. Two branching workers at once need `git worktree` each.
- proof: `git branch --show-current` → `main` before a commit on main.
- added: 2026-09-30

## P-012 · Mermaid quirks that broke renders this session (extends P-004)
- enforced-by: `workspace/03-diagrams/render.mjs` lint (fails before rendering and prints file, block and line).
- `;` inside a sequence-diagram message **or a `Note` line** ends the statement ("Expecting … got 'NEWLINE'"): use a comma. Happened three times on 2026-09-30 (big-diagram, admin-screens ×2).
- `[/` at the start of a node or subgraph label opens a trapezoid shape ("got 'TRAPSTART'"): quote the label, `subgraph ADMIN["/admin › Automation"]`.
- `:::class` on a `subgraph` line is invalid: use `style <id> …`.
- rule: run `node workspace/03-diagrams/render.mjs` before claiming a diagram is done; a failure prints the parser's line number, which counts from the block's first line.
- proof: `render.mjs` → "done → …/img" with no "failure".
- added: 2026-09-30

## P-013 · The shell's working directory drifts between calls
- symptom: the harness reported "Primary working directory" changing five times in one session after `cd` inside Bash commands; a later relative path pointed at the wrong folder.
- rule: use absolute paths in every Bash command; never rely on the cwd from a previous call; `cd` only inside a single `cd … && …` chain.
- proof: no command in the session log depends on an inherited cwd.
- added: 2026-09-30

## P-014 · A background Bash call "completes" at its 10-minute ceiling while the headless child keeps running
- symptom: the task notification said the producer command completed with exit 0 and its JSON output file was empty; `Get-CimInstance Win32_Process` showed `claude.exe -p …` and six Chrome renderers still alive.
- cause: the Bash tool's max timeout is 600000 ms; the wrapper shell is reaped, the detached child is not; `--output-format json` writes only at the very end.
- rule: for any headless `claude -p` run, treat the tool notification as meaningless; watch the output file with an `until [ -s file ]` loop (re-armed every 10 minutes) or use `--output-format stream-json` and tail progress. Before relaunching anything, check the process list.
- proof: `Get-CimInstance Win32_Process | ? { $_.CommandLine -like '*claude*-p*' }` → the producer PID while the notification claims completion.
- added: 2026-09-30

## P-018 · Pressing stop (interrupt) in the desktop app kills every in-session subagent
- symptom: four Sonnet workers vanished from the Background tasks pane after the CEO interrupted a reply; their transcript files stayed at 0 bytes and their last output was timestamped at the interrupt. Only detached processes (the dev server, headless `claude -p`) survived. The tree was left on the branch one worker had created.
- rule: after any interrupt, check the tasks pane and the workers' output folders before assuming they run; relaunch with "resume: skip files that already exist"; then `git branch --show-current` and return to main before committing. Long, expensive fan-outs go headless (P-014/P-017 pattern) when the operator is likely to type mid-run.
- proof: `find workspace/05-plans -newermt "<interrupt time>"` → empty; tasks pane shows only the dev server.
- added: 2026-09-30

## P-017 · A headless `claude -p` worker that ends its turn kills its own background renders
- symptom: the v2 producer replied "Round-2 render and gate are running, I'll continue when it reports" and exited; `launch/film/frames` was empty, no Chrome workers, no round-2 MP4, no REPORT.md. Its JSON said 10 turns / 3 minutes for an 80-minute job.
- cause: in `-p` mode the process exits when the model stops; child processes it started in the background die with it. Nothing "reports back" to a process that no longer exists.
- rule: a headless worker's brief must say "never end a turn while a render/encode/gate runs; run them in the foreground with a long timeout or poll with an until-loop; reply only when the report file exists". Resume with `--resume <session_id>` from the JSON result, never `--continue` (it may pick the orchestrator's own session in the same cwd).
- proof: `launch/producer-run-v2.json` → `num_turns: 10`, `result` ends with "I'll continue when it reports"; frames dir count 0.
- added: 2026-09-30

## P-016 · Frame sequences eat disk: 1080p PNG frames cost about 1.1 MB each
- symptom: the rejected v0 renders left 3.0 GB (2,250 frames) and 6.8 GB (6,300 frames) of PNGs under `launch/`, and a git worktree snapshot added a 275 MB second copy of the repo; the file pane looked "duplicated everywhere".
- rule: capture and encode per window, delete `frames/` as soon as the MP4 for that window is verified, keep only the MP4 and the contact sheet; snapshots (`git worktree`) are removed the moment the job that needed them ends; never leave a rejected version's render output on disk.
- proof: `du -sh launch/*/frames` → no such directory after a finished job.
- added: 2026-09-30

## P-007 · Plugins are installed at project scope on purpose
- rule: `claude plugin install <name>@claude-plugins-official --scope project`; global installs load into every other project's context and burn tokens there.
- proof: `.claude/settings.json` → `enabledPlugins` lists them; `~/.claude/settings.json` does not.
- added: 2026-09-30

## P-015 · The Bash tool's Git Bash rewrites `/route` arguments into `C:/Program Files/Git/route`
- symptom: `render-gate.mjs http://localhost:8080 / /properties` reported routes `C:/Program` and `Files/Git/properties`; every route failed with "Cannot navigate to invalid URL" although the site was fine.
- cause: MSYS path conversion turns any argument that starts with `/` into a Windows path before Node sees it.
- rule: prefix the command with `MSYS_NO_PATHCONV=1` and pass the script by its drive path (`D:/...`; `/d/...` is then no longer converted either), or run the gate from PowerShell.
- proof: `MSYS_NO_PATHCONV=1 node "D:/Omincom/website work and agents output/V2 Pipeline/tools/render-gate.mjs" http://localhost:8080 / /properties` → `"pass": true`, exit 0.
- added: 2026-09-30

## P-023 · `git worktree add <path> main` fails while `main` is checked out in the workspace
- symptom: `fatal: 'main' is already used by worktree at 'E:/Matter Of Place'` when making the read-only site snapshot for product shots.
- rule: snapshot `main` with `git worktree add --detach "E:/Matter Of Place/launch/.site-main" main`; remove it with `git worktree remove` when done.
- proof: `git worktree list` → `.../launch/.site-main  <sha> (detached HEAD)`.
- added: 2026-09-30

## P-024 · The motion gate's "no sustained pitch" check fails on the allowed noise beds unless the mix has broadband content
- symptom: room tone (brown LP 120) measured flatness 0.04, wind (pink BP 300-1200) 0.13, digital silence 0; the gate needs >= 0.15 over every 1.5 s. A mix that passed at render level (0.158) failed after normalisation (0.130): at low level AAC's own noise was filling the empty bins.
- rule: always measure flatness on the loudness-normalised, AAC-encoded mix (`node launch/engine/encode.mjs <dir> --audio-only` then `node launch/engine/probe.mjs flat <dir>/audio-norm.wav`). Give every narrow bed a broadband layer (leaf rustle on wind, foam on water, haze on city), keep the LF rumble low (it adds loudness nobody hears and kills flatness), and keep an air floor under the silence beats (15 dB lower, never digital zero).
- proof: `node launch/engine/probe.mjs flat launch/film/audio-norm.wav` → `min flatness 0.152 (gate >= 0.15); windows under: 0`.
- added: 2026-09-30

## P-025 · The motion gate counts type holds on flat fields and eased-out camera moves as static
- symptom: first full render 65 % coverage, 4.7 s static run; a single 100 px word on Ivory drifting 38 px/s measured 0.12 mean luma diff per frame against the 0.35 threshold (two words 0.31).
- rule: camera moves on photographs run at constant speed (`ease: "none"`) and are still moving on the cut; type holds sit over moving photography or drift; no one-word hold on a flat field longer than ~0.8 s; an end card needs a moving photograph under it. `node launch/engine/probe.mjs motion <mp4>` lists every static run >= 0.5 s with timecodes.
- proof: `node launch/tools/motion-gate.mjs launch/film/matter-of-place-launch.mp4` → `GATE PASSED`, longest static run 0.90 s.
- added: 2026-09-30

## P-026 · This ffmpeg build has no glob input; Node ESM needs file:// URLs for absolute Windows paths
- symptom: `-pattern_type glob` → "globbing is not supported by this libavformat build"; `import "E:/..."` → `ERR_UNSUPPORTED_ESM_URL_SCHEME`.
- rule: tile stills with `node launch/engine/sheet.mjs <out.jpg> <cols> <width> <img...>`; import by bare package name from inside `launch/` or via `pathToFileURL(path).href`.
- proof: `node launch/engine/sheet.mjs out.jpg 3 640 a.png b.png` → prints `out.jpg`.
- added: 2026-09-30

## P-027 · A foreground Bash call over 120 s is moved to the background with its whole `&&` chain
- symptom: `node overflow.mjs | tail` and a later `node states.mjs; python sheet.py` returned "moved to the background"; the sheets I read next did not exist yet.
- rule: pass `timeout: 600000` for browser sweeps, or wait with `until [ -f <output> ]; do sleep 3; done` (Monitor is disabled in subagents) before reading anything the chain produces.
- proof: `until [ -f scratchpad/am1.png ]; do sleep 3; done; echo ready` → ready.
- added: 2026-09-30

## P-021 · Full-page screenshots misplace `position: fixed` UI and hide real defects
- symptom: the phone sticky action bar and the desktop Ask button appeared mid-page over the fact row and Save/Share in `before/*.png`, and a footer line covered by the bar at page end was invisible.
- rule: judge fixed UI (header, sticky bar, concierge, overlays, dialogs) only from viewport shots (`workspace/08-visual-pass/states.mjs`); measure overlap with `getBoundingClientRect` (`sticky.mjs`).
- proof: `node workspace/08-visual-pass/sticky.mjs` → `before {"footerBottomLineBottom":804,"barTop":788}`, `after {...748...}`.
- added: 2026-09-30

## P-022 · A branch left by a killed run can be stale
- symptom: `fix/visual-pass` pointed two commits behind `main`; `git checkout` refused because the orchestrator's uncommitted GOTCHAS.md differed between the two.
- rule: `git branch -f <branch> main` when the branch has no commits of its own, then checkout carries the dirty files across.
- proof: `git log --oneline -1 fix/visual-pass` equals `git log --oneline -1 main`.
- added: 2026-09-30


## P-028 · Free private GitHub repos have no branch protection
- symptom: `gh api -X PUT repos/.../branches/main/protection` → HTTP 403 "Upgrade to GitHub Pro or make this repository public".
- rule: protection of `main` is a CI rule, not a GitHub setting, until the plan changes: `deploy.yml` runs only after `ci.yml` passes on the same SHA, and nobody force-pushes (G-009). Plan B1b step 9 records this as BLOCKED.
- proof: the 403 above, observed 2026-09-30.
- added: 2026-09-30

## P-029 · Concurrent diagram renders collide
- symptom: two workers running `render.mjs` at once → puppeteer launch errors and `EBUSY` on the bunx cache; "5 failures" that had nothing to do with the diagrams.
- rule: `render.mjs <file.md>` renders one file (added 2026-09-30); a worker renders only its own file and confirms the `img/` files exist; the orchestrator runs the full render once, alone, at the end.
- proof: `node workspace/03-diagrams/render.mjs plans-a.md` → "done" with 0 failures while nothing else renders.
- added: 2026-09-30

## P-030 · A first planning pass misses the boring lanes: legal, privacy, rights, retention, rotation, concurrency
- symptom: 20 plans and an architecture written in one day covered product and pipeline but not CCPA, consent, EXIF GPS in uploaded photos, optimistic locking, slug immutability, retention, secret rotation, incident runbook, cost alerts, dependency updates, performance budgets. 47 gaps found in a one-hour sweep (24 launch-blocking).
- rule: before the first build of every wave, sweep the plans against this checklist: legal and privacy, rights and takedown, data integrity and retention, security and rotation, operations and incidents, delivery quality gates, growth plumbing. Fold findings into the documents themselves (architecture §10 now holds them); no side registers.
- proof: `grep -c "Gap additions" workspace/05-plans/*.md` → 0 once integrated; architecture.md has §10.
- added: 2026-09-30

## G-013 · Warm Grey on Ivory fails AA contrast for body text
- paths: Matter Of Place Codebase/src/styles/tokens.css, Matter Of Place Codebase/src/styles/base.css
- severity: warn
- symptom: `--muted-foreground` (#8B877F) on `--ivory` (#F5F2EB) is about 3.6:1; WCAG 2.2 AA needs 4.5:1 for normal text.
- rule: Warm Grey is for large text (≥ 24 px or 19 px bold) and metadata only; body copy on Ivory uses Mineral Grey (#575751, about 7:1) or an adjusted token. `scripts/contrast.mjs` (B17 step 5) checks every token pair.
- proof: `node scripts/contrast.mjs` → all pairs ≥ 4.5 once B17 lands.
- added: 2026-10-01

## G-014 · No third-party request before consent: the Google Fonts link in the root route must go
- paths: Matter Of Place Codebase/src/routes/__root.tsx
- severity: warn
- symptom: `fonts.googleapis.com` is requested on first paint for every visitor, which sends EU visitors' IPs to Google before any consent (GDPR) and adds a render-blocking third party.
- rule: fonts are self-hosted WOFF2 subsets (B17 step 2); the only third parties are Turnstile (necessary) and GA4 after consent. `grep -c fonts.googleapis` on the rendered home page must be 0.
- proof: `curl -s http://127.0.0.1:8080/ | grep -c fonts.googleapis` → 0 after B17.
- added: 2026-10-01

## P-031 · Plans invent names: every event, step and table in a plan must be a catalog name
- enforced-by: `node workspace/05-plans/check-plans.mjs` (run before committing any plan; add it to the H1 checklist).
- symptom: the plan review found `subscriber.confirmation_pending` (no recipe would ever fire the confirm email), a confirm email sent outside the recipe engine, a 14-row recipe seed against a 17-event catalog, and a wave listing a slice beside the one it depends on.
- rule: architecture 3.6 is the only event list; the 14 step types are the only steps; the seed covers every event; new names go into the architecture first, then into plans. The script fails the check on any of these.
- proof: `node workspace/05-plans/check-plans.mjs` → "check-plans: OK".
- added: 2026-10-01

## P-032 · Windows console is cp1252: a Python print with `→` or `›` raises UnicodeEncodeError after the file was already written
- rule: set `PYTHONIOENCODING=utf-8` in the command or print ASCII only; when a script prints after writing, a crash in the print does not undo the write, so re-check the file rather than re-running the edit.
- proof: the B5 edit landed although the confirmation print crashed (2026-10-01).
- added: 2026-10-01

## P-033 · `git push` can fail with "Could not resolve host: github.com" for a few seconds
- rule: the commit is already local; retry the push once before diagnosing the network; never re-run the commit.
- proof: push failed then succeeded 20 s later with the same commit (05222b0).
- added: 2026-10-01

## P-034 · Cloudflare "Please verify your email": the message was in Zoho's Notification folder, and the resend button is on the Authentication page
- symptom: creating an API token ends with "An unknown error occurred. Please try again. Please verify your email." The Zoho inbox and spam for admin@matterofplace.com showed no Cloudflare message, and Profile › Settings, Account home and /email-verification show no resend control.
- cause: Zoho Mail's smart filter files Cloudflare mail (sender noreply@notify.cloudflare.com) under the folder "Notification", not Inbox. The original 1:43 AM message was there all along. (First diagnosis, "the mail bounced before MX existed", was wrong.)
- rule: when a service mail is "missing" in Zoho, read the Notification folder before anything else. Cloudflare's resend lives at My Profile › Access Management › Authentication (`/profile/access-management/authentication`): "Send verification email". Verify with `GET /api/v4/user` → `email_verified`.
- proof: after the operator opened the link, `/api/v4/user` returned `email_verified: true` and token creation went through.
- added: 2026-10-01

## P-035 · A new Cloudflare account has no workers.dev subdomain until the Workers & Pages page is opened once
- symptom: `GET /accounts/:id/workers/subdomain` returns code 10007 "You do not have a workers.dev subdomain"; the first `wrangler deploy` to workers.dev would fail the same way.
- cause: the subdomain is created by the dashboard the first time Workers & Pages is opened, with a random name (ours: `holy-meadow-4327`). `PUT /workers/subdomain` then answers 10036 "Account already has an associated subdomain", so the API cannot rename it.
- rule: before the first deploy on a new account, open `dash.cloudflare.com/<account>/workers-and-pages` once and read the name back from the API. Renaming is a dashboard action (Workers & Pages › Subdomain › Change) and must happen before any preview URL is shared.
- proof: `curl -s https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"` → `{"result":{"subdomain":"holy-meadow-4327"},"success":true}`
- added: 2026-10-01

## P-036 · A text search cannot find a leftover that is a picture: the Lovable favicon survived the cleanup
- symptom: after the Lovable removal (PR #1) `git grep -i lovable` was clean, yet the site still shipped Lovable's heart logo as `public/favicon.ico`. The operator found it, not the cleanup.
- cause: the cleanup was verified with a word search only. A binary asset carries no searchable name.
- rule: a "remove vendor X" pass ends by opening every file under `public/` and every image the head links to (favicon, touch icon, OG image), not by grepping. Icons are regenerated from `public/favicon.svg` (the brand emblem), never hand-drawn.
- proof: `curl -s http://localhost:8080/ | grep -a -o '<link[^>]*rel="[a-z-]*icon"[^>]*>'` → three links (svg, ico, apple-touch); viewing the PNG inside `favicon.ico` shows the doorway emblem.
- added: 2026-10-01

## P-037 · The agent may not create account-wide access tokens in a dashboard; the operator does that step
- symptom: opening Supabase's "Create legacy token" form from the browser tool was refused by the permission classifier ("Credential Materialization"). Cloudflare's account token was also created by the operator's own press.
- cause: creating a full-access credential is an operator action by policy, whatever tool is used.
- rule: for any full-access token the agent prepares everything around it (the `.env` marker, the page open, the name to type) and the operator presses the create button and pastes the value into `.env`. Narrow tokens derived from one the operator already issued (for example `mop-github-actions` minted with `mop-admin`) went through. Do not look for another route to the denied action.
- proof: `.env` holds the marker `SUPABASE_ACCESS_TOKEN=PASTE_SUPABASE_ACCESS_TOKEN_HERE` until the operator fills it; `grep -c PASTE_SUPABASE .env`.
- added: 2026-10-01

## P-038 · Never Docker on this machine: no `supabase start`, no Docker Desktop (S50)
- symptom: a readiness command that launched Docker Desktop was stopped by the operator: "never use docker use my laptop".
- cause: the plans assumed the Supabase local stack (B2 named Docker Desktop as a dependency). The operator's laptop is his working machine and Docker is not allowed on it.
- rule: nothing starts Docker here. Schema goes to `mop-dev` with `supabase db push`; types come from `supabase gen types typescript --project-id`; Edge Functions deploy with `--use-api`; config with `supabase config push`; ad hoc SQL through the Supabase connector. Tests that need a clean database use a throwaway cluster from the native PostgreSQL 18 (`initdb` in a temp folder) or a scratch schema on `mop-dev`; tests that need pg_cron, pgmq or pg_net run on `mop-dev` only. A plan step that says Docker is a plan defect: fix the plan first.
- proof: `grep -n -i "docker\|supabase start\|db reset" workspace/05-plans/*.md` shows only lines that say Docker is not used.
- added: 2026-10-01
