# GOTCHAS — the bank of things that already cost us time

Never re-discover a fix, never re-break a thing that works. This map is the part everyone reads; the entries below it are read by file.

How the bank is organised
- `G-NNN` are path entries: `- paths:` names the files they protect, `- severity:` what the guard does. `.claude/hooks/gotcha-guard.mjs` pushes every matching live G entry before each Edit or Write (`block` refuses the edit, `warn` injects the entry). `P-NNN` are process and tooling lessons, never injected.
- Every entry has symptom, cause, rule, proof (a command and its output) and added. `- merged:` lists ids folded into an entry: an id with no heading of its own lives there (`grep -n "merged:.*P-070" GOTCHAS.md`). An entry a test, hook or script now enforces ends as one line under "Retired, enforced" at the end of the file. Merged and retired ids stay taken.

How to read it (ruling H51)
- Read this map, then from the tree root run `node workspace/05-plans/check-gotchas.mjs --for <every file you will touch>`: it prints the path entries that name your files in full and every process entry by title. Open a title that concerns your work with `grep -n "^## P-NNN" GOTCHAS.md`.

The ten lessons that bite most often
1. Shell escaping: the Bash tool drops backslashes and mangles quotes in inline text; anything with a backslash goes in with Write or Edit (P-008).
2. Path conversion: Git Bash turns an argument that starts with `/` into `C:/Program Files/Git/...`; use `MSYS_NO_PATHCONV=1`, drop the slash, or double it (P-015).
3. Heredocs: a heredoc or `node -e` that ends in `unexpected EOF` wrote nothing, so use Write (P-008); `python3 -` spins forever (P-094); a patch script validates before it writes (P-064).
4. Timeouts under load: a busy laptop turns a slow test red at 5000 ms (G-031); a long Bash call moves to the background, so wait with a bounded loop, never a leading `sleep` (P-027).
5. The registry: a `find` occurs exactly once in the file as it stands, an `expect` comes from the real red output, `--check` runs after every edit of a mutated file (P-066); every test title has an entry (P-079).
6. The quiet runner: run long commands as `node workspace/05-plans/quiet.mjs -- <command>` so their output does not sit in your context (ruling H52 (3); no entry).
7. Times: write them with the numeric offset, `date "+%Y-%m-%d %H:%M %z"`; "EDT" on this laptop is Egypt, UTC+3 (P-130).
8. Lane ports and bank bases: each lane has its own preview port (spine 8788, db 8798, tests 8808, design 8818, api 8828) and its own number series here (P-503); the bank merges by entry (P-072).
9. No Docker on this laptop, ever: schema reaches the cloud with `db push`, throwaway clusters come from native PostgreSQL 18 (P-038).
10. One database: only `main` changes `mop-dev` (P-050); db tests load the dev profile and run under `env -u CLOUDFLARE_API_TOKEN` (P-310); an unmerged migration is proved inside rolled-back transactions (P-312).

Also often needed: a lane is a worktree outside this folder (P-051) and two workers never share one tree (P-011); secrets never printed or in `VITE_*` (G-006, P-055, P-037); Chrome with the GPU off for anything compared (P-052); workflows only at the repository root (G-012); before saying done, re-run every proof yourself (P-059) and look at the real state after an interrupted call (P-056). Where a file goes and what a machine checks: `workspace/05-plans/STANDARDS.md`; rulings: `workspace/05-plans/ASSUMED.md` section H; measured machine facts: section E.

Rules for the bank itself
- Add an entry in the same turn something costs more than a few minutes or breaks after a push (CLAUDE.md), numbered in your lane's series (P-503). A lesson the bank already holds gets a "Hit again" sentence in that entry, not a new entry.
- Run `node workspace/05-plans/check-gotchas.mjs` after every change: it fails on a number used twice, an entry without rule, proof or added, and a G entry without paths or severity.
- One `paths:` line, comma separated, project-relative globs (`**` and `*`); severity `block` only when an edit is never legitimate. Keep under 40 live G entries.
- A proof is a command someone else can run, never a path under `scratch/` (P-088).

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
- paths: app/src/routeTree.gen.ts
- severity: block
- symptom: hand edits vanish on the next `vite dev` or build, and routing silently diverges from the files on disk.
- cause: `@tanstack/router-plugin` regenerates this file from `src/routes/*`.
- rule: add or rename a route by adding or renaming the file under `src/routes/`; never touch the generated file.
- proof: `bun run build` regenerates it; `git diff --stat src/routeTree.gen.ts` after a build is the only legitimate diff.
- added: 2026-09-30

## G-002 · Vite config is plain and explicit; Start's plugin already generates the route tree
- paths: app/vite.config.ts
- severity: warn
- symptom: duplicate-plugin crash ("plugin already registered"), two route generators fighting, or a build that silently targets Node instead of Cloudflare.
- cause: `@tanstack/react-start/plugin/vite` bundles the router generator; the Cloudflare target exists only because `nitro({ preset: "cloudflare-module" })` is added on build; nitro invents a worker name from the git remote when none is pinned.
- rule: every plugin is listed once in `vite.config.ts` (tsConfigPaths, tanstackStart, nitro on build, viteReact); never add `@tanstack/router-plugin` yourself; keep `cloudflare.wrangler.name` pinned to `matter-of-place`. The file is the whole config; there is no preset behind it any more (2026-09-30).
- proof: `bun run build` → "built in"; `.output/nitro.json` preset `cloudflare-module`; `.output/server/wrangler.json` name `matter-of-place`.
- added: 2026-09-30 (rewritten the same day when the preset was removed)

## G-004 · Field names live in three files and must change together
- paths: app/src/domain/**, app/supabase/migrations/**
- severity: warn
- symptom: a field renamed in one place returns `undefined` in the UI or fails the Zod parse on the server with no type error.
- cause: `src/domain/*.ts` (camelCase) = API JSON = `schema.sql` columns (snake_case); the HTTP adapter has no mapping layer by design (ADR 0002).
- rule: change the domain type, the Zod contract and the SQL column in the same commit; grep the old name across all three before finishing.
- proof: `grep -rn "<oldName>" src/domain docs/database` → no hits.
- added: 2026-09-30

## G-006 · `VITE_*` variables ship to the browser
- paths: app/.env.example, app/src/env.d.ts, app/src/config/site.ts
- severity: warn
- symptom: a key committed as `VITE_SOMETHING_SECRET` is visible in the built JS.
- cause: Vite inlines every `VITE_*` value at build time.
- rule: secrets go in `wrangler secret put` (server side) only; `VITE_*` is for public URLs and flags. The global `secret-scan` hook also checks writes.
- proof: `grep -rn "VITE_" .env.example` → only SITE_URL, API_BASE_URL, TURNSTILE_SITE_KEY, GA4_MEASUREMENT_ID (all public by nature; every secret stays server side; the Instagram address is no longer a build variable, it lives in `settings.site.social`, ASSUMED G23).
- added: 2026-09-30

## G-007 · Styling is tokens only: no hex, no utility classes
- paths: app/src/styles/**, app/src/components/**
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

## G-009 · Pushed history is never rewritten
- paths: .git/**
- severity: warn
- symptom: a force push, a rebase or a squash of pushed commits breaks every lane and every open pull request that started from the old commits, and removes the evidence the position file cites by commit id.
- cause: three lanes and the orchestrator build from `origin/main` at the same time; the rule began as a Lovable requirement (the repository is no longer connected to Lovable, CLAUDE.md) and stays for this reason.
- rule: never rewrite pushed history on any branch; fix forward. Merge with a merge commit (P-060).
- proof: `git log --oneline origin/main` is a strict prefix of `git log --oneline main`.
- added: 2026-09-30

## G-010 · The codebase `docs/` folder is the Lovable sketch, not the spec
- paths: app/docs/**
- severity: warn
- symptom: an agent implements `schema.sql`, Cloudflare Queues or request-time image resizing "because the docs say so".
- cause: those docs were written for an MVP; the CEO-approved spec (2026-09-30) is `workspace/02-tech-stack/tech-stack.md`.
- rule: read `docs/` for intent only (the sketch folders `architecture/`, `brief/`, `database/`, `decisions/`, `deploy/`). Schema comes from `supabase/migrations`, jobs from pgmq and GitHub Actions, image variants are made once when a photograph is attached (ASSUMED G66). Runbooks are the one part of `docs/` that is ours: `docs/runbooks/<name>.md`. Update or delete a sketch page when the built thing diverges, as the plans say; never build from it.
- proof: `grep -rn "Cloudflare Queues\|cdn-cgi/image" src supabase` → no hits in built code.
- added: 2026-09-30

## G-011 · No paid platform feature without a settled decision
- paths: app/wrangler.toml, app/src/server/**, app/supabase/**
- severity: warn
- symptom: a binding for Queues, Browser Rendering, Images, Durable Objects, or a Supabase Pro-only feature appears in config.
- cause: each of those is a monthly bill; the approved stack is free tier first.
- rule: free-tier limits are in GOTCHAS P-009; if a limit is hit, record the measurement and add a decision to PROJECT-STATE.md before adding the binding.
- proof: `grep -n "queues\|browser\|images\|durable" wrangler.toml` → no hits.
- added: 2026-09-30

## G-012 · GitHub Actions reads workflows only at the repository root, which is the workspace folder
- paths: app/.github/**
- severity: block
- symptom: a workflow written under `app/.github/workflows/` never runs; tech-stack §3 draws the folder under the app, which is where a builder would put it.
- cause: the git root is `E:\Matter Of Place` (workspace + app in one repo); GitHub ignores nested `.github` folders.
- rule: workflows live in `.github/workflows/` at the repo root and set `working-directory: app` per job; never create `.github` under the app. Correct tech-stack §3 when it is next edited.
- proof: `git rev-parse --show-toplevel` → `E:/Matter Of Place`; `ls .github/workflows` at the root → README.md (workflows arrive with B1b).
- added: 2026-09-30

---

# Process and tooling gotchas (no paths; loaded by `mop-work`, not injected)

## P-009 · Free-tier limits we are designing inside (measured 2026-09; re-check quarterly)
- Cloudflare Workers free: 100k requests/day, 10 ms CPU per request; Turnstile and one rate-limit rule free; Image transformations free only to 5k/month (we do not use them).
- Workers free: at most 50 outbound subrequests per invocation (vendor documentation, UNPROVEN here); every Supabase RPC, Storage call and Turnstile call counts (JOB-03, E2E-02, PERF-07). A per-photograph loop inside an admin request breaks at about 22 photographs, so such loops run as jobs (B7's `copy_submission_media`); B3 signs at most 20 upload URLs per request; a render callback's `onResult` makes a fixed number of calls whatever the photo count (B9 `render_variants`: `apply_media_variants`, one Storage remove, `clear_media_staging`). Proof once built: `bunx vitest run tests/unit/subrequest-budget.test.ts`.
- Supabase free: 500 MB database, 1 GB storage, 5 GB egress/month (since S57 every photograph, asset and reel lives in that 1 GB and every cache miss of `/media/<key>` spends that egress; one Worker request is spent per image view; ASSUMED H33), 50k monthly auth users, 500k Edge Function calls; project pauses after 7 idle days (keep-warm cron on Cloudflare).
- Storage, measured later: once B9 step 10 runs, the bytes one 40-photograph property stores in the bucket `media` are written beside the 1 GB line; until then UNPROVEN (the CTO's estimate is about twenty properties).
- Resend free: 3,000 emails/month, 100/day, 1,000 marketing contacts, 3 domains (all three used: root, `notify`, `notes`), 30-day data retention (pricing page read 2026-10-02, ASSUMED E20).
- GitHub Actions on a private repo: 2,000 minutes/month (a reel render is ~3 minutes). Once B9 step 10 runs, the billed minutes of one 40-photograph `render_variants` run are written here (JOB-08); until then UNPROVEN.
- Sentry free: 5k errors/month. GA4, Search Console, Bing, Cloudflare zone HTTP analytics (no beacon, ASSUMED G31): free.
- rule: the audit robot reports usage against each line monthly; the first line to cross 70% triggers a decision, not a surprise invoice.
- proof: the vendors' pricing pages on the dates named; for the measured ones, ASSUMED section E (E1 to E20) holds the command and its output. `node workspace/05-plans/ready.mjs` prints the lines that are switched on.
- added: 2026-09-30

## P-001 · (retired 2026-10-02) agent-os stage 0 refused `src/**`
- rule: nothing to do. The project is at STAGE 3 (BUILD) and writes under `app/src/` are allowed. If a stage gate ever refuses a write again, it is a sequencing gate: record the finding and ask the operator to advance the stage, do not work around it.
- proof: `node workspace/05-plans/ready.mjs` prints `PASS  PROJECT-STATE stage 3 (BUILD)`.
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

## P-005 · The in-app browser renders `file://` pages as static snapshots
- symptom: a local HTML page with a script never runs it; page tools refuse to act on the tab.
- rule: serve the folder over `http://127.0.0.1:<port>` (`python -m http.server`) and open that URL in a new tab; stop the server afterwards.
- proof: the Mermaid parse check only reported results once served from localhost.
- added: 2026-09-30

## P-006 · The operator reads pictures, not Mermaid
- rule: every diagram ships as PNG + SVG under `workspace/03-diagrams/img/` and is sent with SendUserFile. Mermaid source alone is not a deliverable.
- proof: `ls workspace/03-diagrams/img` → one PNG and one SVG per diagram.
- added: 2026-09-30

## P-008 · The Bash tool on this machine drops backslashes and mangles quotes in inline text: single quotes, heredocs, `node -e`
- symptom: an inline JSON payload `'{"file_path":"E:\\Matter..."}'` reached the process with single backslashes, so `JSON.parse` failed (or `\r` became a carriage return) and the test looked like a silent failure of the thing under test. A quoted heredoc (`<<'EOF'`) turned the Markdown table escape `\\|` into `|` in six table cells; a `node -e` append wrote `].join("` and a real line break instead of `].join("\n")` (prettier: `Unterminated string literal`); a `node -e` rewrite of registry `expect` values holding `\\.` found its anchor 0 times. A probe input `E'a\\\\'` written through a heredoc arrived as `E'a\\'` and read as a lexer defect (B1b c6). A hand mutation through `node -e` wrote `/drops+column/i`, the suite went red for an unrelated reason and was counted as a watched-fail (B1b g6). A long heredoc stopped with `unexpected EOF while looking for matching ''` and wrote no file (B2 g2; again in B2 g6 with a 300-line script). One call that wrote several files through heredocs, with an apostrophe in the prose, failed to parse and wrote none of them (B4 g2).
- cause: the Bash tool rewrites backslashes, and in a long command quotes, before the shell sees the command, so a quoted delimiter does not protect the text; when the delimiter or a quote no longer matches (an apostrophe pairs with another quote), the shell reads to the end of input or stops with a parse error and writes nothing. A `replace` whose search text does not occur changes nothing and reports nothing.
- rule: any text that holds a backslash or an apostrophe (Markdown table escapes, regular expressions, Windows paths, JSON `\\n`, test inputs, prose) goes in with the Write or Edit tool, or is built in code (`String.fromCharCode(92)`); never through an inline argument, a heredoc or `node -e`. Write a payload to a file and pipe the file in. After a scripted rewrite, read back the changed lines (`git diff`). `unexpected EOF` or a parse error means nothing was written: do not retry with other quoting, use Write or Edit, then read `git status --short`. A mutation applied by hand prints its mutated line and refuses when the search text occurs other than exactly once or the file is unchanged, before any red or green is read; prefer a registry entry replayed by the runner (P-066). When a parser "misses" an input with a backslash, print its bytes (`od -c`) before blaming the code. A hook that fails open will hide all of this.
- proof: `node .claude/hooks/gotcha-guard.mjs < scratchpad/payload.json` (file written by the Write tool) → deny JSON; a quoted heredoc writing `E'a\\\\'` into a file, then `od -c` → `E ' a \ \ '` (two backslashes where four were typed, 2026-10-02); `git grep -n -F '\|' -- workspace/01-site-index/content-inventory.md | grep -c 'Estate'` → 1 (the row written with the Edit tool keeps its escapes).
- merged: P-070, P-111, P-115, P-309, P-406
- added: 2026-09-30

## P-010 · New agent definitions and `fork` are not available mid-session
- symptom: `Agent type 'mop-producer' not found` right after writing `.claude/agents/mop-producer.md`; `Agent type 'fork' not found` in this build.
- cause: agent definitions are read at session start; the context-inheriting `fork` type is not in this Claude Code build.
- rule: agent definitions are read at session start, so a new `.claude/agents/*.md` works from the next session. Inside a session, give a worker its model with the Agent tool's `model` field or a Workflow agent's `model` and `effort` options (both exist in this build, used all through 2026-10-02); the headless `claude -p` route with the brief piped on stdin is the fallback. A worker inherits nothing from the transcript: its brief names the files to read (GOTCHAS, the slice plan, STANDARDS, the spec sections).
- proof: `ls launch/producer-run.json` exists after the headless producer starts; in-session `Agent` with the new type fails until restart.
- added: 2026-09-30

## P-011 · Two workers, one working tree: a branching agent moves the whole tree
- symptom: `git branch --show-current` → `chore/remove-lovable` while the orchestrator still has uncommitted doc changes on "main"; anything committed now lands on the worker's branch, and `git add -A` by the worker sweeps the orchestrator's files into its PR.
- rule: commit and push main work BEFORE spawning any agent that branches; while a branching worker runs in this tree, check the branch before every commit and never `git stash` or checkout under it. Workers that run side by side each get their own git worktree outside this folder (P-051); the build's lanes are exactly that.
- proof: `git branch --show-current` → `main` before a commit on main.
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

## P-015 · Git Bash rewrites any argument that starts with `/` into a Windows path (`C:/Program Files/Git/...`)
- symptom: `render-gate.mjs http://localhost:8080 / /properties` reported routes `C:/Program` and `Files/Git/properties` and failed every one with "Cannot navigate to invalid URL"; `gh api /users/<login>/settings/billing/usage` answered `invalid API endpoint: "C:/Program Files/Git/users/..."`; `openssl req ... -subj "/CN=mop-backup"` failed with `This name is not in that format: 'C:/Program Files/Git/CN=mop-backup'`.
- cause: MSYS path conversion turns any argument that looks like an absolute POSIX path (a route, an API endpoint, a certificate subject) into a Windows path before the program sees it.
- rule: prefix the command with `MSYS_NO_PATHCONV=1` and pass a script by its drive path (`D:/...`), or write the argument without the leading slash (`gh api repos/...`) or with a doubled one (`//CN=...`), or run it from PowerShell. A failed first run can leave a half-written file: check its outputs before trusting them. The `gh` billing endpoints also need the `user` scope this login lacks (`gh auth refresh -s user` is interactive, the operator's): measure Actions minutes from `gh api repos/AbdulrahmanAmer/matter-of-place/actions/runs --paginate` and sum the run durations (ruling DO-08).
- proof: `MSYS_NO_PATHCONV=1 node "D:/Omincom/website work and agents output/V2 Pipeline/tools/render-gate.mjs" http://localhost:8080 / /properties` → `"pass": true`, exit 0; `MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/k -out /tmp/c -subj "/CN=x" -days 1` exits 0 and `openssl x509 -in /tmp/c -noout -subject` prints `subject=CN=x`; without the slash the billing call answered HTTP 404 "This API operation needs the user scope" (2026-10-02).
- merged: P-048, P-502
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

## P-027 · A long Bash call is moved to the background and a leading `sleep` is refused: wait with a bounded loop
- symptom: `node overflow.mjs | tail` and a later `node states.mjs; python sheet.py` returned "moved to the background"; the sheets read next did not exist yet. A command that began with `sleep 90` was refused ("To wait for a condition, use Monitor"); loops that ran past the ten-minute limit were moved to the background and reported later, out of order; a `mermaid` render took over three minutes while seventeen agents were running and was moved too.
- cause: the Bash tool moves a foreground call over 120 s to the background with its whole `&&` chain, blocks a bare leading `sleep`, and caps a call at ten minutes.
- rule: pass `timeout: 600000` for browser sweeps, or wait with a bounded loop on a condition (`for i in $(seq 1 50); do <check> && break; sleep 10; done`, or `until [ -f <output> ]; do sleep 3; done`) kept under nine minutes, before reading anything the chain produces (Monitor is disabled in subagents). Read a workflow's progress from its `journal.jsonl` (count `started` and `result` lines by label). Render diagrams when no fan-out is running. The post-write hook reports "Illegal return statement" on a workflow script because its body is not a module: verify it by wrapping it in an async function, not with `node --check`.
- proof: `until [ -f scratchpad/am1.png ]; do sleep 3; done; echo ready` → ready; `new Function(... 'return (async()=>{' + script + '})')` parses the workflow script that `node --check` rejects.
- merged: P-046
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
- rule: protection of `main` is our own rule, not a GitHub setting: the operator declined GitHub Pro on 2026-10-02 (ASSUMED H5), so B1b step 9 stays BLOCKED. The orchestrator merges only through `node workspace/05-plans/merge-gate.mjs <pr>` once B1b step 5b has written it (it refuses a head that does not contain `origin/main` and any failing check), `deploy.yml` runs only after `ci.yml` passes on the same commit, and nobody force-pushes (G-009).
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
- paths: app/src/styles/tokens.css, app/src/styles/base.css
- severity: warn
- symptom: `--muted-foreground` (#8B877F) on `--ivory` (#F5F2EB) is about 3.6:1; WCAG 2.2 AA needs 4.5:1 for normal text.
- rule: Warm Grey is for large text (≥ 24 px or 19 px bold) and metadata only; body copy on Ivory uses Mineral Grey (#575751, about 7:1) or an adjusted token. `scripts/contrast.mjs` (B17 step 5) checks every token pair.
- proof: `node scripts/contrast.mjs` → all pairs ≥ 4.5 once B17 lands.
- added: 2026-10-01

## G-014 · No third-party request before consent: the Google Fonts link in the root route must go
- paths: app/src/routes/__root.tsx
- severity: warn
- symptom: `fonts.googleapis.com` is requested on first paint for every visitor, which sends EU visitors' IPs to Google before any consent (GDPR) and adds a render-blocking third party.
- rule: fonts are self-hosted WOFF2 subsets (B17 step 2); the only third parties are Turnstile (necessary) and GA4 after consent. `grep -c fonts.googleapis` on the rendered home page must be 0.
- proof: `curl -s http://127.0.0.1:8080/ | grep -c fonts.googleapis` → 0 after B17.
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
- rule: for an account-wide token (Cloudflare, Supabase, GitHub) the agent prepares everything around it (the `.env` marker, the page open, the name to type) and the operator presses the create button and pastes the value into `.env`. Narrow tokens derived from one the operator already issued went through. Where the operator delegated the whole setup of one service in words (Resend, 2026-10-02), the agent may create that service's key, and only by the unseen route of P-055. Do not look for another route to a denied action.
- proof: `.env` holds the marker `SUPABASE_ACCESS_TOKEN=PASTE_SUPABASE_ACCESS_TOKEN_HERE` until the operator fills it; `grep -c PASTE_SUPABASE .env`.
- added: 2026-10-01

## P-038 · Never Docker on this machine: no `supabase start`, no Docker Desktop (S50)
- symptom: a readiness command that launched Docker Desktop was stopped by the operator: "never use docker use my laptop".
- cause: the plans assumed the Supabase local stack (B2 named Docker Desktop as a dependency). The operator's laptop is his working machine and Docker is not allowed on it.
- rule: nothing starts Docker on the operator's laptop: no `supabase start`, no Docker Desktop, in the main folder or in a lane. GitHub's hosted runners are not this machine and may run containers: the per-pull-request database proof is the CI `db` job on an ephemeral Supabase stack (ASSUMED H1). On the laptop, schema reaches `mop-dev` with `bun run db:push` from `main` only once lanes are open (P-050; while one lane is open it may push under the G34 lock with `MOP_SINGLE_LANE=1`); types come from `supabase gen types typescript --project-id`; Edge Functions deploy with `--use-api`; config with `supabase config push`. A local test that needs no Supabase extension may use a throwaway cluster of the native PostgreSQL 18 (`initdb` in a temp folder). A plan step that needs Docker on this machine is a plan defect: stop and say so.
- proof: `grep -n -i "docker\|supabase start\|db reset" workspace/05-plans/*.md` shows only lines that say Docker is not used.
- added: 2026-10-01

## P-039 · "Unused" is a claim about the whole repository, not the app folder: `launch/` reads images from `src/assets`
- symptom: a cleanup deleted four images that no file under the app imported. A fresh reviewer found that `launch/03-partner-deck/build.mjs` and `launch/02-partner-presentation/scene.html` read `gallery/desert-colonnade.jpg` straight from `app/src/assets/`, and the film storyboard names two more. A finder and a verifier had both grepped the app folder only.
- cause: the app's asset folder is also the asset source for the launch deck, presentation and film. A search scoped to the app cannot see those users.
- rule: before deleting any asset, run `git grep -l -I "<basename>" -- .` from the repo root. A hit under `launch/` or `workspace/` is a user. Only `tribeca.jpg` was unused everywhere.
- proof: `git grep -l -I "desert-colonnade" -- . ':!workspace/01-site-index'` lists three files under `launch/`.
- added: 2026-10-01

## P-040 · Two hook registrations in the global settings failed on every tool call, silently, for the whole project
- symptom: the terminal showed `PreToolUse:Bash hook error ... At line:1 char:28` on every Bash call and `PreToolUse:Write hook error ... .agent-os/hooks/pre-tool-use.sh: No such file or directory` on every Write. Both were non-blocking, so nothing stopped and nobody looked until the operator asked.
- cause: (1) the RAGA guard in `~/.claude/settings.json` was an inline PowerShell command; hooks run under Git Bash, which expanded its dollar variables to nothing, so PowerShell received a broken script. The guard against a forced push, a recursive delete from the root and skipping commit hooks had never worked. (2) three agent-os entries pointed at a `.agent-os` folder inside the project; the enabled agent-os plugin already registers the same hooks through its own root, so the entries were stale duplicates.
- rule: a hook command is a file under `~/.claude/hooks/` called with `node`, never an inline script with dollar signs. A hook that "fails non-blocking" is a broken control, not noise: read the error the first time it appears. After any settings change, pipe a sample payload through the hook and see both outcomes. The guard is now live and matches the command text, so a heredoc that merely quotes a dangerous pattern is blocked too: put such text in a file with the Write tool.
- proof: `node ~/.claude/hooks/raga-guard.mjs` fed a tool payload whose command is a forced push prints a deny decision; the same with the with-lease form prints nothing. Eight sample commands were checked on 2026-10-01 (3 denied, 5 allowed). Backup of the old settings: `~/.claude/settings.json.bak-2026-10-01`.
- added: 2026-10-01

## P-041 · A cache keyed by content version alone goes stale when something else changes the page
- symptom: the first draft of the caching contract bumped `catalog_version` only for published content. A fresh reviewer showed that flipping a feature flag or a coming-soon switch would leave cached pages wrong for up to five minutes, and that keep-warm on a cache hit would never touch the database, so it could not keep the free project awake.
- cause: the invalidation rule was written from the editor's point of view (publish, unpublish, edit) and not from the page's point of view (everything the render reads).
- rule: list every input a public render reads, then make each one move the version: content, `settings` (flags, coming-soon, site, environment), `markets.coming_soon`, `redirects`, `slug_history`. The version moves only through B2's function (its triggers and the `bump_catalog_version` step). A new input to a public render is not done until a test shows that changing it changes `x-catalog-version`. No public read queries a table per request (architecture section 13).
- proof: `grep -n "bumps .catalog_version" workspace/06-architecture/architecture.md` shows rule 4 with the full list; ASSUMED F25 a.
- added: 2026-10-01

## P-042 · Stopping a background dev server: `wrangler dev` respawns `workerd` from its parent, and Git Bash's `$!` is not a Windows process id
- symptom: after a local cache test, port 8799 kept a listener; killing the `workerd.exe` that held the port printed SUCCESS three times and a new `workerd` appeared each time. After `(bun run dev -- --port 8808 > log 2>&1 &)`, `taskkill //PID $(cat pidfile) //T //F` printed `The process "95890" not found`; the next try printed `Type "TASKKILL /?" for usage.` twice, and the server kept the port, so the next Playwright run (whose `webServer` has `reuseExistingServer: false`) printed no result at all (B4 g3).
- cause: `bunx wrangler dev` runs as a `node.exe` parent that restarts its `workerd` child, and a background `wrangler dev` started with `&` from the Bash tool leaves that parent behind. `$!` in Git Bash is an MSYS process id. With `MSYS_NO_PATHCONV=1` exported (P-015) `//PID` is passed through literally and taskkill rejects it, while without it `//PID` is the right spelling. `netstat -ano | awk '{print $NF}'` ends each line with a carriage return.
- rule: start a server through Playwright's own `webServer` when a test run needs one, so it stops with the run. One started by hand is stopped by the process that owns the port: find it with `netstat -ano | grep ":<port>.*LISTENING" | awk '{print $NF}' | tr -d '\r'` and stop it with its children (`taskkill /PID <id> /T /F` under `MSYS_NO_PATHCONV=1`, `//PID` without it); for `wrangler dev`, in PowerShell stop the `node.exe` or `bun.exe` whose command line contains `wrangler` and the port, then any `workerd`, filtering by process name so the command does not match and kill its own shell. Confirm the port is free (`Get-NetTCPConnection -LocalPort <port> -State Listen`, or `netstat -ano | grep -c ":<port>.*LISTENING"` → 0) before the next run. Never stop every node process: another lane may be serving (ruling H45).
- proof: after stopping two `node.exe` parents, `listeners on 8799: 0` and `workerd left: 0` (2026-10-01); `MSYS_NO_PATHCONV=1 bash -c 'P=$(netstat -ano | grep ":8808.*LISTENING" | head -1 | awk "{print \$NF}" | tr -d "\r"); echo pid=[$P]'` prints the bare id while a dev server runs, and `netstat -ano | grep -c ":8808.*LISTENING"` prints `0` after `taskkill /PID <id> /T /F` (2026-10-03, B4 g3).
- merged: P-407
- added: 2026-10-01

## P-043 · "Is it documented" and "are we ready" were answered from memory and from a gate that measured the wrong things
- symptom: asked whether the plans say in code terms what makes each automation work, an audit of the 17 step types found no plan naming the step module of `render_variants` or `render_og_static`, and two more owners ambiguous, after the project had been declared ready. On 2026-10-01 the readiness gate printed `READY TO BUILD: yes`; the operator did not believe it, and a full audit found 1,152 gaps in its first round: 299 contradictions between documents, 219 mechanisms described without the code that performs them, 104 things used and created by nobody, 96 with two owners, 88 with no proof, 67 with no code file.
- cause: the gate measured what was easy (tokens, tools, secrets, catalog names, section headings), not whether a builder holding only a plan would have to invent an owner, a file, a table or a mechanism; ownership stated in two plans was never cross-checked. Two earlier passes with Sonnet workers at medium effort made the plans longer and more confident without closing that.
- rule (S53): a capability is documented only when a plan names what starts it, one owning slice, the code file (for a step, `src/server/jobs/steps/<name>.ts`), the data, the outside call, the failure path and a proof command. `workspace/05-plans/trace.json` lists every such item and `check-plans.mjs` fails when an item's plan stops naming its files, when a catalog step has no file, or when a slice is missing from the completion map. "Is it covered" and "are we ready" are answered by running `node workspace/05-plans/ready.mjs --full`, never from memory. Completeness audits run on Opus at high effort; a cheaper pass that returns "all consistent" is a claim, not a result.
- proof: `node workspace/05-plans/check-plans.mjs` prints OK; deleting the `render-variants.ts` line from B9.md makes it print `no plan names the code file of step render_variants`; the six audit rounds found 1,152, 1,191, 306, 150, 99 and 42 gaps.
- merged: P-044
- added: 2026-10-01

## P-045 · An audit that fixes as it goes does not converge by itself: it needs rulings between rounds and a tighter bar each round
- symptom: round two of the traceability audit found more gaps (1,191) than round one (1,152). The writers, one per document, could not decide anything that touched another document, so they passed 149 questions up and each fixed its side of a contradiction differently.
- cause: with one writer per file, a disagreement between two files has no owner. Left alone, every round re-reports it and every fix adds text that can disagree somewhere else.
- rule: stop the workflow when a fix round ends; read what the writers passed up; write rulings in `ASSUMED.md` section G that name every document they bind; resume from the cached run so finished work is not repeated (add new prompt text only for later rounds, and prove the earlier prompts are byte-identical before resuming). Tighten the bar every round: by round three report only what would make a builder guess or contradict; in the last round only blockers. Give later auditors the earlier writers' notes about other documents as unverified claims. Expect several hours and about two hundred agent runs for twenty-five documents; say so before starting.
- proof: after 65 rulings the rounds went 1,191, 306, 150, 99, 42; `rounds` in the workflow result lists them.
- added: 2026-10-01

## P-047 · A deadline was answered with a smaller scope, recorded as decided
- symptom: the operator set a 48-hour go-live; the orchestrator wrote a "launch cut" into PROJECT-STATE S54 and PLAN.md that deferred social, newsletter, reels, the money box and the audit robot. The operator: "we are not cutting anything we are getting it all built in 48 hours". The records had to be rewritten and pushed again.
- cause: time pressure was treated as a reason to shrink the work instead of changing how it runs; a CTO recommendation was written down as a decision.
- rule: scope belongs to the operator. Under a deadline the first move is orchestration (parallel lanes, worktrees, more workers), never a cut. A cut may be recommended in one sentence; it is recorded only after the operator says yes. State what is UNPROVEN about fitting the time.
- proof: `grep -c "48-hour full build" workspace/05-plans/PLAN.md` prints 1 and `grep -c "launch cut" workspace/05-plans/PLAN.md` prints 1 (the line that says it was withdrawn).
- added: 2026-10-02

## P-049 · Search tracked files with `git grep`, never `grep -r` from the root, and remember `git grep` cannot see a file that is not in the index
- symptom: a `grep -rl ... .` at the root did not finish inside the two-minute tool limit and was moved to the background. B4 step 5's guard-import proof, a `git grep` for the import in the new `app/scripts/e2e-coming-soon.ts`, printed nothing and exit 1 while the import was there: the file was not staged or committed yet.
- cause: `app/node_modules` and `launch/node_modules` hold tens of thousands of files and `--include` does not stop the directory walk. `git grep` searches tracked files only; a new file is invisible to it until `git add` or `git add -N`.
- rule: search tracked files with `git grep -I` (or the Grep tool); never `grep -r` from the root (a small named folder is fine). A proof that searches a file the same step created uses `git grep --untracked` or runs after `git add` (or `git add -N`); never read an empty `git grep` as "the line is not there" until `git ls-files --error-unmatch <file>` says the file is tracked.
- proof: `git grep -c "08-visual-pass"` returns at once; from `app/`, `echo 'export const zzProbe = 1;' > scratch-probe-zz.ts; git grep -n zzProbe; echo $?; git grep -n --untracked zzProbe; rm scratch-probe-zz.ts` prints `1`, then `scratch-probe-zz.ts:1:export const zzProbe = 1;` (2026-10-03, B4 follow-up record).
- merged: P-410
- added: 2026-10-02

## P-050 · Parallel lanes and one shared mop-dev: an unmerged migration from one lane breaks every other lane's push
- symptom (E2E-06, measured in the review, not yet hit): the Supabase CLI refuses a `db push` when the remote holds a version the branch lacks ("Remote migration versions not found in local migrations directory") or when a local file sorts before the newest remote one ("Found local migration files to be inserted before the last migration on remote database"), and an edited migration that is already applied is skipped silently, so the schema drifts.
- cause: three S54 lanes pushing migrations and job-runner builds from their own branches into the one shared `mop-dev`.
- rule: only `main` reaches `mop-dev` (ASSUMED ruling H1): the post-merge `dev` job of `deploy.yml` runs `bun run db:push` and deploys the job runner; the per-PR proof is the CI `db` job on an ephemeral stack. Rebase on `origin/main` before any push. Never run `--include-all` or `migration repair` without the orchestrator. B2's `scripts/db-push.mjs` and B1b's `scripts/check-migrations.mjs` enforce it once built.
- proof: `grep -c "group: mop-dev" .github/workflows/ci.yml` prints 0 (B1b); `bunx vitest run tests/unit/db-push-guard.test.ts` passes (B2).
- added: 2026-10-02

## G-015 · The wordmark's "A" is a Greek lambda that Jost does not contain, and the emblem's two planes abut
- paths: app/src/components/brand/wordmark.tsx, app/src/components/brand/emblem.tsx, app/public/favicon.svg
- severity: warn
- symptom: the site's wordmark text is "MΛTTER OF PLΛCE" in Jost Light, but Jost has no glyph for Λ (U+039B), so the browser draws those two letters in a fallback font (measured in headless Chrome on Windows: Arial Regular, visibly heavier than the other letters; a Mac or a phone picks another font). The emblem's two paths share one diagonal edge, so a hairline of background shows between them at large sizes.
- cause: a letter outside the font's character set; two shapes that meet on an antialiased edge.
- rule: never set the wordmark as live text. Use the outlined SVG from `brand/logo/wordmark/` (its Λ is Jost Light's "A" without the crossbar). When a slice touches the wordmark or the emblem component, replace the text with the outlined paths and take the emblem geometry from `brand/logo/emblem/`. Regenerate brand assets only with `node launch/tools/brand-build.mjs`.
- proof: `grep -rl "<text" brand/logo | wc -l` prints 0; the generator's check tool `node launch/tools/brand-wordmark-check.mjs` renders the site's text beside the outline.
- added: 2026-10-02

## P-051 · Build lanes are git worktrees outside the repository folder, and half the tooling assumed one folder
- symptom: the gotcha guard said nothing for a file under `E:/mop-build/spine/` (it measured every path against the workspace folder); a lane has no `.env`, no `node_modules` and no Supabase link; `git worktree add <path> main` is refused while `main` is checked out (P-023).
- cause: a worktree is a second copy of the tracked files only. Everything git ignores stays behind, and anything that computes paths from the workspace root sees the lane as "outside".
- rule: a lane is made with `git worktree add --detach E:/mop-build/<lane> origin/main`, then `cp .env` into it (it is ignored there too), `bun install --frozen-lockfile` in its `app/`, and `supabase link --project-ref "$DEV_SUPABASE_PROJECT_REF"` in its `app/` before any CLI command that needs the link. Before a slice starts in a lane, move it to the newest main: `git -C E:/mop-build/<lane> fetch -q origin && git -C E:/mop-build/<lane> checkout --detach origin/main`. A builder in a lane never reads, edits or runs git in `E:/Matter Of Place`. The guard now finds the tree a file belongs to by walking up to the folder that holds `GOTCHAS.md` and `.git`.
- proof: `node .claude/hooks/gotcha-guard.test.mjs` → `gotcha-guard: OK (6 cases)`; with the old hook the two lane cases print `FAIL ... silent`.
- added: 2026-10-02

## P-052 · Headless Chrome with the GPU on does not render the same pixels twice
- symptom: three runs of the brand generator rewrote 2 to 5 PNG files each time with no input changed; one 256 px image rendered 40 times in one Chrome session gave 19 different hashes. A sub-agent had reported "second run changes nothing"; that run was luck.
- cause: Chrome's default GPU rasteriser is not deterministic. With software rendering all 40 renders were identical.
- rule: every script that screenshots or captures frames for a file we commit, compare or hash (brand assets, B9 social templates and OG images, B12 reel frames, email shots, visual baselines) launches Chrome with `--disable-gpu --disable-gpu-rasterization --disable-accelerated-2d-canvas --use-gl=disabled`. A generator counts as deterministic only after three runs in a row change nothing.
- proof: `node launch/tools/brand-build.mjs` three times → `brand-build: 98 files, 0 written or changed` each time.
- added: 2026-10-02

## P-053 · A gap between two shapes can be real geometry, not antialiasing
- symptom: a light hairline inside the emblem where its two planes meet, in every large render.
- cause: the two paths were assumed to share an edge. They do not: one edge runs to (34,16) at slope 0.423, the other to (48,21) at slope 0.4, which leaves a wedge up to 0.6 units wide.
- rule: before calling a gap "antialiasing", measure the two edges. Shapes that must meet either share the exact same points or the lower one runs under the upper one. Take the emblem from `brand/logo/emblem/`, never retype its paths (G-015).
- proof: pixel column of `brand/logo/emblem/emblem-on-bone-2048.png` at x=741 → grey (150,147,141) then dark (39,39,36), no Bone stripe between them.
- added: 2026-10-02

## P-054 · Resend: what the account really does (measured 2026-10-02)
- symptom: a key made with "Sending access" answered 401 `restricted_api_key` for `/domains`, `/audiences`, `/broadcasts`, `/contacts` and `/webhooks`; the DNS records Resend issues differ by domain (CNAME `send` and `rsend` for the root; MX and TXT on `send.<sub>` plus CNAME `rsend.<sub>` for a subdomain); the free plan holds 3 domains and all are used; one API call in a script failed with `connect ETIMEDOUT` and worked on the next try.
- cause: Resend has two key scopes only; its DNS scheme changed; outbound calls from this laptop time out now and then.
- rule: the runner's key is full access, one per environment (ASSUMED H28). Read the records to write from the API answer of the domain, never from memory or an older plan. No fourth domain exists to add. Every script that calls an outside API from this laptop retries a failed connection three times with a short pause before it reports failure. Sender addresses are ruling H29.
- proof: with the key loaded from `.env`, `curl -s -H "Authorization: Bearer $RESEND_API_KEY" https://api.resend.com/domains` lists `notes.matterofplace.com`, `notify.matterofplace.com` and `matterofplace.com`, each `verified` (ASSUMED E17, E18, E20).
- added: 2026-10-02

## P-055 · A secret shown once in a dashboard can reach `.env` without ever being displayed
- symptom: the Resend dashboard shows a new key in a masked field with a "Copy to clipboard" button; reading the page or taking a screenshot after "Show value" would put the secret in the transcript.
- cause: secrets must never be printed, pasted in chat or read by the model (project rule), yet the key has to land in `.env`.
- rule: read the page with the interactive filter only (password fields stay masked), click the copy button, then run a script that takes the clipboard, checks its shape with a pattern, writes it under its name in `.env`, clears the clipboard and prints only the name and the length. Where the provider's API returns the secret (a webhook signing secret), let a script write it to `.env` straight from the answer. Check a stored secret by length and by a harmless API call, never by printing it. This is done only when the operator delegated the setup of that account in words; an account-wide token of another service is still the operator's step (P-037).
- proof: `tr -d '\r' < .env | awk -F= '/^RESEND_(API_KEY|WEBHOOK_SECRET)=/{print $1, "length", length($0)-length($1)-1}'` → `RESEND_API_KEY length 36`, `RESEND_WEBHOOK_SECRET length 38`.
- added: 2026-10-02

## P-056 · A tool call the operator interrupts may already have run
- symptom: a command that created the lane worktree, copied `.env` and installed dependencies was reported as rejected; minutes later `git worktree list` showed the lane, complete.
- cause: the rejection arrived after the command had started. The report describes the approval, not the state of the disk.
- rule: after any rejected, interrupted or timed-out call, look at the real state (the file, `git status`, `git worktree list`, the remote) before repeating or reporting. Say plainly what exists.
- proof: `git worktree list` → `E:/mop-build/spine ... (detached HEAD)` after the rejected call.
- added: 2026-10-02

## P-057 · Git Bash `grep -c $'\r'` counts every line; it does not detect CRLF
- symptom: a line-ending check reported hundreds of carriage returns in every changed file, and in files nobody had touched.
- cause: in this shell that pattern matches each line. The files were LF.
- rule: check line endings with `git ls-files --eol <files>` (`w/lf` is the working tree) or with `node -e` reading the bytes. Never with `grep $'\r'`.
- proof: `git ls-files --eol GOTCHAS.md` → `i/lf    w/lf    attr/text=auto eol=lf`.
- added: 2026-10-02

## P-058 · One writer per file is fast and leaves disagreements between files
- symptom: seven writers folded one review into 21 plans in parallel. Each passed the checker alone. The pass that came after them still had 93 edits to apply that writers could not make in files they did not own, and 25 names or values that two writers had chosen differently (a route helper under two names, one job created by two slices, a CI job that one plan made a step).
- cause: a finding that touches several files is applied by several writers who cannot see each other's choice.
- rule: a parallel write over shared facts always ends with one agent that owns every file: it applies the handoffs, greps each name the change introduced across all documents and makes every occurrence identical, then runs the checker. Files the writers must not touch (PLAN.md, ASSUMED.md, scripts) come back as refused handoffs: the orchestrator applies those itself in the same hour. A workflow with more agents than slots starts the last ones only when a slot frees: plan for it.
- proof: journal of workflow `wf_38d40906-2cd`: `handoffsApplied 93`, `mismatchesFixed 25`, `handoffsRefused 6`.
- added: 2026-10-02

## P-059 · A sub-agent's "it passes" is one sample; re-run the gate yourself, more than once when the claim is "nothing changes"
- symptom: the brand generator was reported idempotent (second run, 0 files changed). The orchestrator's three runs changed 5, 2 and 5 files. Earlier, "ready to build" had been declared from a gate that did not check what mattered (P-044).
- cause: a claim about absence (nothing changes, nothing left, no mismatch) needs more than one observation, and the author of a change shares its blind spot.
- rule: the orchestrator re-runs every proof before accepting a unit. For determinism, three runs. For "no leftover", a search across the whole repository with `git grep`, not the folder the worker looked at (P-039). A red re-run goes back to the same worker with the real output, and the fix must remove the cause, not hide it (no skip-if-exists, no tolerance).
- proof: `node launch/tools/brand-build.mjs` → `5 written or changed`, `2 written or changed`, `5 written or changed` before the fix; `0`, `0`, `0` after.
- added: 2026-10-02

## P-060 · Merging and cleaning branches from this machine
- symptom: `git push origin --delete <branch>` printed `error: failed to push some refs` for branches GitHub had already removed; a stale local list of remote branches made merged branches look alive.
- cause: remote-tracking refs are a local cache.
- rule: merge with `gh pr merge <n> --merge` (never squash or rebase a pushed branch: history is not rewritten), then `git checkout main && git pull origin main`, delete the branch, and `git fetch --prune`. The truth about remote branches is `git ls-remote --heads origin`. From B1b step 5b on, merges go only through `node workspace/05-plans/merge-gate.mjs <pr>`.
- proof: `git ls-remote --heads origin` → `refs/heads/main` only.
- added: 2026-10-02

## P-061 · The build workflow stopped before building: partial waits were counted as unmet dependencies
- symptom: the first run of `build-slice` for B1b ended in three minutes with `stopped: unmet dependencies`. The list held B1a (closed, but missing from the status table of PLAN.md), three parts of later steps that wait on other slices or on the domain, and two stale lines of ASSUMED E10 (the R2 secrets, already deleted, and a secret said to be missing that exists).
- cause: the sizing prompt said "list every dependency that is not met" without saying what a dependency is, and the documents it reads had not been brought up to date after the day's decisions.
- rule: the stop is mechanical, not a model's judgement. A sharper prompt did not fix it: the second run listed five partial waits as unmet again. The workflow now stops before building only when not one group can run; the list of unmet dependencies is information the orchestrator reads (pass `strictDependencies: true` to stop on it). Before a slice starts, the status table at the end of PLAN.md shows every closed slice, and ASSUMED section E matches `gh secret list` and `gh variable list`.
- proof: `gh secret list` shows no R2 name and shows `DEV_SUPABASE_SERVICE_ROLE_KEY`; the status table has the row `B1a | closed`.
- added: 2026-10-02

## P-062 · Driving an account dashboard through the browser tool: what cost time on 2026-10-02
- symptom: on Sentry, Resend, Zoho and GitHub: (a) "Couldn't determine which page this action targets" after a page changed its address by itself; (b) "Script injection timed out" on a heavy single-page app that was still loading; (c) a click by coordinate landed on the neighbouring menu item because the menu had moved (GitHub's expiration menu took "No expiration" instead of "90 days"); (d) "Unable to create new key. Please try again." on Sentry's first try; (e) GitHub asked for the password again ("Confirm access") before the token form.
- cause: coordinates come from the last screenshot and pages move; heavy dashboards need seconds before the tool can read them; a password prompt is the operator's step by rule.
- rule: after any redirect call `tabs_context_mcp` again before the next action. Wait a few seconds and re-read instead of repeating a failed read. Click by element reference (`find`, `read_page`) when there is one. Before pressing a button that submits, zoom on the form and read every value back. One retry of a failed create is fine; after two, stop and report. A password or login prompt: leave the page open, tell the operator, continue with other work. Read a page that shows a secret only with the interactive filter and move the secret by the unseen route (P-055).
- proof: `node <scratchpad>/sentry-env.mjs` printed both client keys with their limits after the retry; ASSUMED E21 and E22 record the results.
- added: 2026-10-02

## P-063 · The session's stop gate rejects a final message that is not in its format, and a claim with no command behind it
- symptom: more than ten final messages were sent back in one day with "Completion format missing: N bullets (max 3)" or "You state 'done' but there is no evidence in this session".
- cause: the harness gate counts every bullet in the message (lists under Blockers included) and wants a command run in the same turn whose output the Verification line quotes; the last command of the turn must not show a failure.
- rule: a final message is exactly: one sentence with the outcome; at most three bullets in the whole message; a line starting `Verification:` that names a command run in this turn and its real output; a line starting `Blockers:` written as prose, never as a list. Extra points go into the three bullets or into sentences. When the honest state includes a failing check, say so in Blockers and make the last command of the turn one that passes for a true reason. Run at least one real check (`check-plans`, `check-gotchas`, `git status`) in every turn that ends with a claim.
- proof: the gate's own messages in this session; a message in the format passes.
- added: 2026-10-02

## P-064 · A patch script wrote the file first and checked it second; patching it again by text failed on its escaped backticks
- symptom: a script that edits `.claude/workflows/build-slice.js` inserted text with backticks into a template literal, wrote the file, and only then ran the parse check, which threw `SyntaxError: Unexpected identifier 'node'`. The broken file was already in the working tree, and the commands after the `;` still ran (a pull request with no commit, a branch delete). A second script meant to correct two lines inside a first script stopped with `anchor not found`, and the commands after a `;` ran against a branch that was never created.
- cause: write before validate; a backtick inside a template literal is written with a backslash in front, so an anchor typed as the text reads is not the text the file holds; an `&&` chain followed by `;` keeps going after the failure.
- rule: a patch script builds the new text in memory, validates it (parse, anchors found, checker), and writes last. Text that lands inside a template literal escapes its backticks and every `${` it does not mean. Change a scratch script with the Edit tool, which shows the file as it is. One shell line is one `&&` chain from start to end; nothing follows a `;`, and no cleanup or merge command sits behind a chain that may fail. After a patch fails, read `git status` first and restore with `git checkout -- <file>` (only a file that had no uncommitted work, P-068).
- proof: `git status --short` showed ` M .claude/workflows/build-slice.js` after the failure; after `git checkout -- .claude/workflows/build-slice.js` the parse check passed; `grep -c 'proof: a test file with \`it.each' <scratchpad>/trace/ruling-h43.mjs` prints 1 only when the backslash is part of the pattern.
- merged: P-119
- added: 2026-10-02

## P-130 · The shell on this laptop prints "EDT" for Egypt Daylight Time, not US Eastern
- symptom: every time written with `date "+%H:%M %Z"` reads "EDT". The progress board took the label as US Eastern, stored the build's start with the offset -04:00, and reported 6.1 hours of work where 13.2 had passed, so its pace line was wrong by a factor of two.
- cause: the laptop's zone is Egypt Standard Time (UTC+3) and Git Bash abbreviates its summer time as EDT. The abbreviation is shared with US Eastern Daylight Time, seven hours away.
- rule: write a time with its numeric offset, `date "+%Y-%m-%d %H:%M %z"`, never with `%Z`. Every "EDT" already in POSITION.md, PLAN.md, PROJECT-STATE.md and the logs is laptop time, UTC+3. Code that needs a start instant takes an ISO time with `+03:00`.
- proof: `date "+%Z %z"` prints `EDT +0300`; `node -e "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"` prints `Africa/Cairo`.
- added: 2026-10-02

## G-016 · The lint block for `scripts/**` cannot use the project service: it needs `project: ["./tsconfig.scripts.json"]`
- paths: app/eslint.config.js, app/tsconfig.scripts.json
- severity: warn
- symptom: B1b plan block (g) and STANDARDS R01 say every type-aware block uses `projectService`. With it on the `scripts/**` block every script fails with "Parsing error: scripts/stubs.ts was not found by the project service. Consider either including it in the tsconfig.json or including it in allowDefaultProject".
- cause: the project service resolves each file to the nearest `tsconfig.json`; `app/tsconfig.json` includes `src`, `tests` and the root configs, not `scripts/`. `tsconfig.scripts.json` is not "nearest" for any file.
- rule: the `scripts/**/*.{ts,mjs}` block sets `projectService: false` and `project: ["./tsconfig.scripts.json"]`; the `src` and `tests` block keeps `projectService: true`. A new folder of linted code that no `tsconfig.json` includes needs its own `project` block the same way.
- proof: `cd app && bunx eslint scripts/stubs.ts; echo $?` prints `0`; setting that block to `projectService: true` prints the parsing error above and exits 1.
- added: 2026-10-02

## P-065 · A plan's counts and a tool's config are estimates until the tool has run on the real tree
- symptom: B1b step 2b was sized from numbers the plan had written before the gates existed. Measured on the new configuration: 78 lint problems (plan: about 56), 21 unused exports and 20 unused types (plan: 12 and 11). `knip.json` copied as the plan wrote it prints 5 configuration hints (`src/routeTree.gen.ts` and `src/db/types.ts` in `ignore` that need no ignoring, entries `src/start.ts` and `supabase/functions/*/index.ts` that match no file yet, `src/router.tsx` redundant). The first watched-fail pass had the wrong `expect` for the missing-assertion test ("at least one assertion"; vitest prints "expected any number of assertion, but got none"), so one run was wasted.
- cause: estimates and expected texts were written from memory, not from output.
- rule: before sizing a gate step, run each new tool with its new config on the real tree and count by rule; take every watched-fail `expect` from the tool's printed text, never from memory; treat knip's configuration hints as defects to remove when the files they name exist (B1b step 3 creates `src/start.ts`, step 8 the job runner).
- proof: `cd app && bun run knip | grep -c "Configuration hints"` prints `1` before step 3 (the line counts the header, one block however many hints it lists); after step 4b the block lists 2 hints (`src/db/types.ts`, cleared by B2, and `supabase/functions/*/index.ts`, cleared by B8) and `bun run knip | grep -c "routeTree.gen.ts\|router.tsx"` prints `0`.
- added: 2026-10-02

## P-066 · A watched-fail registry entry must replay: its `find` occurs exactly once in the file as it stands, its `expect` matches only what the failure prints
- symptom: 16 of the 20 entries first written for `tests/mutations/B1b.json` used an invented `kind: "create"` with `"find": ""`, so none could be replayed. In B1b g4 one `find` held a log line that prettier had split over two lines (it occurred zero times); one `expect` said "not to have property" where vitest prints `to not have property "request"`; a test title went red for the right reason and still failed the replay because vitest cut it at about 80 characters (`... header whose lo…`), and an `it.each` `$name` value is cut at 40 characters whatever the terminal width. Code changes moved the `find` of older entries (`h`, `u-message`, `sentry-non-string`, then `u`, `pipe-guard-off`, `pipe-guard-path`, `pipe-guard-html`; in c7 `hy-lint-warnings`), each found late. The first `expect` of `mg-gate-format` matched the path bun echoes on every run, so any non-zero exit would have counted as the right red. Step 4b's watched-fail letters `bm` and `bn` were already ids of other mutations. An Edit anchored on the tail of an entry matched two entries. After B2 merged, the replay of all registries (439 entries) printed `WATCHED-FAIL BAD: stayed green (B2:ss-contract-not-on-main)`: its mutation named a migration version that was absent from main when the red was recorded and is on main now. B4's watched-fail (z), which removes a test file's entry from its registry, stays green when several entries name that file, and a `find` of plain words inside a registry also occurs in the entry that carries it (two occurrences, exit 2).
- cause: `find` and `expect` were copied from code as typed, from titles or from memory, not from the file after `prettier --write` and the red run's real output; any edit of a mutated file can move a `find`, and `bun run check` does not replay the registry; `bun run <script>` echoes the command (to stderr, so a baseline must read stderr on exit 0 too); letters were handed out over several steps; entries of one test share their `expect` line; an entry that stands for a repository state goes stale when `origin/main` moves; a registry entry's `find` is stored inside the file it mutates when that file is a registry.
- rule: every entry is a `file` entry on a tracked file whose `find` occurs exactly once (a mutation that needs a new file edits an existing file inside the same lint scope), a `sql` entry, or `kind: "manual"` (recorded, not replayed; also for a rule whose scope has no tracked file yet, and for a watched-fail that needs a browser). Run `bunx prettier --write` before writing a `find` and take it from disk. Take `expect` from the red run's output; it is a regular expression (escape `.`, `*`, `?`, `(` or end before them) that matches only text the failure prints (the `×` line, the error line, prettier's `[warn]` line) and nothing in the unmutated run's stdout and stderr. Keep a test title under about 75 characters and an `it.each` row name at 40 or fewer, or match only their first words. The runner is `node scripts/watchfail.mjs` (B4): `--registry tests/mutations --only <ids>` replays entries and exits 2 with `STALE` on a `find` that does not occur once; after every edit of a file the registry mutates, replay its entries before the commit, rewrite a moved entry and replay it red; keep a mutated line's text stable when the change need not touch it; after each slice lands, replay every registry and fix the entry, not the test. A mutation that needs "absent from main" names a value that can never be present (`20261001090199`). A `find` inside a registry holds double quotes (stored escaped in the entry, so it does not match itself), and a watched-fail that removes a file's entry picks a file only one entry names. List the ids before adding one; a taken plan letter becomes a prefix (`bm-page-refusal`); never reuse or rename an id. Anchor an Edit of an entry on its `"id"` or `replace` line, never on its `expect`. `tests/unit/mutation-registry.test.ts` (in `bun run check`) holds the entry shape, one id per registry and every test file named by an entry.
- proof: `cd app && bunx vitest run tests/unit/mutation-registry.test.ts` passes; `node scripts/watchfail.mjs --registry tests/mutations --only z` prints `WATCHED-FAIL OK B4:z`, and with the `test` of `y-lint` changed to `tests/unit/seo.test.ts` it prints `STALE B4:z: find occurs 2 times in tests/mutations/B4.json` and exits 2 (2026-10-03, restored); `bun run format:check 2>&1 | grep -c "05-plans/merge-gate\.mjs"` → `1` on a green tree (the echo line); a scratch test `it.each([{ name: "0123456789012345678901234567890123456789X" }])("$name ends here", ({ name }) => { expect(name).toBe(""); })` prints `× 012345678901234567890123456789012345678… ends here` (2026-10-02).
- merged: P-081, P-090, P-093, P-116, P-121, P-133, P-401, P-402
- added: 2026-10-02

## P-067 · Clearing a baseline "by fixing" is not making the tool quiet: a validator that validates nothing, and exports a later plan changes
- symptom: `no-unsafe-type-assertion` on `(await response.json()) as T` was cleared with `z.custom<T>()`, which accepts any value (`z.custom().parse(42)` returns 42). Knip's unused exports were cleared by deleting `submissionStates` and `editorialRoles` (and their types) from `contracts.ts`, but B2.md lines 52, 53 and 132 and four review files tell B2 to change exactly those constants. A fresh reviewer found both; each cost a rework.
- cause: the goal was read as "the gate prints nothing" instead of "the code is true".
- rule: a cast becomes a real parse with a response schema, or the item is recorded BLOCKED; never a stand-in that checks nothing. Before deleting an export, `git grep -w <name> -- workspace/05-plans` (P-039): a name a later plan changes stays, tagged `/** @public */` with a `// STUB(<slice>): <what replaces it>` line above it (STANDARDS R04, C04). Prove a validator by feeding it a wrong value and seeing it throw.
- proof: `bun -e 'import { z } from "zod"; console.log(z.custom().parse(42))'` prints `42` (validates nothing); `cd app && bunx vitest run tests/unit/http-client.test.ts` passes, including "rejects a body that does not match the schema".
- added: 2026-10-02

## P-068 · `git checkout -- <file>` as the undo of a manual watched-fail wiped the file's uncommitted work
- symptom: after a hand mutation of `src/domain/property.ts`, `git checkout -- src/domain/property.ts` put the file back to HEAD and the uncommitted Zod rewrite of it was gone; it had to be written again from the transcript.
- cause: the file held uncommitted work and the undo was written for a clean file. The replay runner restores saved bytes; the hand step did not.
- rule: restore a mutated file by writing back the bytes saved before the edit (`cp` to a scratch folder first, or the replay runner). Use `git checkout --` only on a file that `git status --short` shows clean.
- proof: `git status --short app/src/domain/property.ts` before a mutation prints ` M ...`: copy the file aside first.
- added: 2026-10-02

## P-069 · `useEffectEvent` is in React 19.2 and in its types, but `eslint-plugin-react-hooks` 5.2.0 does not know it
- symptom: to fire a view event once per key without a lint disable, `use-track-view.ts` first used `useEffectEvent`. It type-checks (`@types/react` 19.2 has it) and the build passes, but `react-hooks/exhaustive-deps` reports `React Hook useEffect has a missing dependency: 'fire'`; adding `fire` to the dependency array restarts the effect on every render, because the plugin treats an event function as an ordinary one. The first approach was dropped and the hook rewritten.
- cause: `app/package.json` pins `eslint-plugin-react-hooks` `^5.2.0`, whose effect-event recognition is compiled out: `isUseEffectEventIdentifier` returns `false` in `node_modules/eslint-plugin-react-hooks/cjs/eslint-plugin-react-hooks.development.js` (line 159). The latest on npm is 7.1.1; whether it handles the hook was not tried here (UNPROVEN).
- rule: until the plugin is raised on purpose (a dependency change with its own proof), do not use `useEffectEvent`. Keep the latest value in a ref, assign it in an effect without a dependency array, and read the ref inside the effect that must fire once (`src/hooks/use-track-view.ts`). Never answer the warning with an `eslint-disable` (a disable with no finding behind it is itself an error).
- proof: put `const fire = useEffectEvent(() => { track(event, data); }); useEffect(() => { fire(); }, [key]);` in a scratch file under `app/src/hooks/` and run `cd app && bunx eslint --max-warnings 0 <file>; echo $?` → the `exhaustive-deps` warning on `'fire'` and exit 1; `bunx eslint --max-warnings 0 src/hooks/use-track-view.ts; echo $?` → exit 0.
- added: 2026-10-02

## P-071 · A relative redirect from `app/` wrote a scratch file outside the worktree
- symptom: a builder in the lane redirected a check's output to `../../scratch-check.txt` from `E:/mop-build/spine/app`; the file landed in `E:/mop-build/`, outside the repository, and the builder's `rm` was refused there. The reviewer found it on disk.
- cause: `../..` from `app/` is the lane's parent folder, not the lane. Nothing under git sees a file there, so no gate catches it.
- rule: a scratch file goes to the session scratchpad or under a path the lane's `.gitignore` covers, never to a relative path that climbs out of the lane. A lane writes nothing outside its own folder. The orchestrator checks `ls E:/mop-build/` after every group: it holds lane folders only.
- proof: `ls /e/mop-build/` prints `spine` and nothing else.
- added: 2026-10-02

## P-072 · Merging the bank: a text merge of two appends drops an entry's last line, GitHub ignores the merge driver, and the driver brings back entries the merging side removed
- symptom: `git merge origin/main` on `slice/b1b` conflicted in `GOTCHAS.md`; keeping both sides left P-064 without its `- added:` line. Later the `merge=union` driver gave a clean `git merge-tree` and still dropped P-500's `added` line and the blank line after it, and `check-gotchas` printed `ERROR P-137: no added` after a hand resolver (earlier P-064, P-130, P-132). `git merge-tree --write-tree origin/main slice/b2` exited 0 while `gh pr view 49 --json mergeable` said `CONFLICTING` and no workflow started (P-301). Merging main into the gardening branch (2026-10-03) went through the driver with no conflict and `check-gotchas: OK (37 path entries, 163 process entries)`, where 26 and 121 were due: all 53 entries the branch had folded or retired were back, appended at the end.
- cause: every entry ends with the same `- added: <date>` line; two sides that each append entries share it, a text merge writes it once, and the entry in the middle loses it. GitHub's merge machinery ignores merge drivers, so it reports such a pull request as conflicting. `merge-gotchas.mjs` drops an entry only when it is gone from "theirs" and unchanged on "ours"; an entry gone from "ours" and present in "theirs" is appended as new. So a lane that brings in a main which retired entries loses them (right), and a branch that retired entries and brings in main gets them back (wrong).
- rule: the bank merges by entry: `workspace/05-plans/merge-gotchas.mjs` is the merge driver (clone config `merge.gotchas.driver`, `.git/info/attributes` and `.gitattributes`). After any merge that touches the bank, clean or not, run `node workspace/05-plans/check-gotchas.mjs` before committing and compare its counts with both sides (entries of ours plus the ones only theirs added); restore a lost line by hand, main's entries first, and delete again what the merging branch had removed. Trust `gh pr view <n> --json mergeable,mergeStateStatus`, not a local merge test, for whether CI will run; when it says CONFLICTING the lane brings main in itself (ruling H48 (3)) with a merge commit, never a rebase of pushed commits. Lanes number in their own series (P-503).
- proof: `git check-attr merge GOTCHAS.md` prints `GOTCHAS.md: merge: gotchas` in every worktree and `git config merge.gotchas.driver` prints the driver line; after the B1b merge `check-gotchas.mjs` printed `ERROR P-064: no added`, and after restoring the line `check-gotchas: OK (16 path entries, 69 process entries)`; on `chore/bank-garden`, `git show 5bd5291:GOTCHAS.md | grep -c "^## P-070 "` → `1` (the merge commit that brought main in, before the clean-up; the branch tip prints `0`).
- merged: P-302, P-303, P-501
- added: 2026-10-02

## G-018 · `cloudflare:workers` cannot be imported from a file Vite bundles
- paths: app/src/start.ts
- severity: warn
- symptom: B1b step 3 imports `waitUntil` from `cloudflare:workers` ("left external by the Nitro build"). `bun run build` fails with `Rolldown failed to resolve import "cloudflare:workers" from src/start.ts` in the TanStack `ssr` service build, and `tsc` has no types for the module (no `@cloudflare/workers-types` here). `bun run dev` would fail the same way. B3's `src/server/lib/wait-until.ts` (plan B3 line 108, `export { waitUntil } from "cloudflare:workers"`) has the same defect.
- cause: Nitro lists `cloudflare:workers` as external for its own final bundle only; the Vite `ssr` environment is built first and does not know it. Nitro's dev shim for the module applies to Nitro's dev server, not to Start's.
- rule: take `waitUntil` from the request. Nitro's `augmentReq` puts the Worker's bound `waitUntil` on the request object, and `start.ts` reads it through a zod schema; the Start dev server has none, so the fallback starts the promise and leaves it. Never import `cloudflare:workers` in anything Vite bundles; B3 must take the same route or add `build.rolldownOptions.external` on purpose.
- proof: `git grep -n "cloudflare:workers" -- app/src` → no import; `bun run build` exits 0; under `bun run cf:preview` a temporary log of the schema parse printed `true`.
- added: 2026-10-02

## P-073 · `wrangler dev --env-file` does not load `.dev.vars` the way B1b step 3 assumed
- symptom: `cf:preview` as the plan wrote it (`wrangler dev --config .output/server/wrangler.json --env-file .dev.vars --port 8788`) left `MOP_ENV` at `production` with `MOP_ENV=local` in `app/.dev.vars`; the log had no "Using secrets" line. `--env-file ../../.dev.vars` (relative to the config folder) died with `node: ../../.dev.vars: not found`.
- cause: with `--env-file`, wrangler 4.145.0 skips its `.dev.vars` lookup and resolves each file against the folder of `--config` (`.output/server/`), while the file is also opened from the current folder; one relative path cannot satisfy both. A build replaces `.output/`, so the file cannot live there.
- rule: `cf:preview` copies the file next to the built config and lets wrangler read it by default: `cp .dev.vars .output/server/.dev.vars && wrangler dev --config .output/server/wrangler.json --port 8788`. B3's `scripts/dev-vars.mjs` keeps writing `app/.dev.vars`. Stop wrangler by its parent process (P-042).
- proof: with `MOP_ENV=local` in `app/.dev.vars`, `bun run cf:preview` logs `Using secrets defined in .output\server\.dev.vars` and `curl -sI http://127.0.0.1:8788/ | grep -i x-robots-tag` → `x-robots-tag: noindex, nofollow`; with an empty file the same request has no such header.
- added: 2026-10-02

## G-019 · Creating `src/start.ts` turns off TanStack's default CSRF check for server functions
- paths: app/src/start.ts
- severity: warn
- symptom: nothing visible. B1b step 3 created `src/start.ts` for the request pipeline; from that moment TanStack stops applying its own CSRF middleware to server functions, and no test, type or lint rule notices.
- cause: `createStartHandler` sets `requestMiddleware: hasStartInstance ? startOptions.requestMiddleware : [defaultCsrfMiddleware]`: the default applies only to a project with no start file (`node_modules/@tanstack/start-server-core/dist/esm/createStartHandler.js`, line 238).
- rule: `start.ts` registers `createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" })` in `requestMiddleware` after the pipeline middleware. A later slice that edits that list (B3, B7, B17) keeps `csrf` in it; dropping it silently removes CSRF protection from every server function.
- proof: `git grep -n "createCsrfMiddleware" -- app/src/start.ts` → the import and the `csrf` constant; `grep -c "defaultCsrfMiddleware" app/node_modules/@tanstack/start-server-core/dist/esm/createStartHandler.js` → `2`.
- added: 2026-10-02

## P-074 · A plan step called a module that a later step creates
- symptom: B1b step 3 has `pipeline.ts` call `captureException` from `sentry.ts`, which step 4 creates (`ls app/src/server/lib/` has no `sentry.ts` at step 3), so the step could not build or be tested as written.
- cause: the plan listed the file contents of one step and the order of steps separately, and nobody ran the imports against the order.
- rule: when a step needs something a later step creates, give the dependency to the caller as a member of the injected `deps` (here `report`), carry a STUB marker with the replacing step on the line above the stand-in (STANDARDS R04, C04), and say so in the slice log. Never create the later file early with a guess of its contents.
- proof: `git grep -n "STUB(B1b" -- app/src/start.ts` → the marker above `report`; `git grep -c "captureException" -- app/src` → `1` (that marker line only) until step 4 replaces the stand-in.
- added: 2026-10-02

## P-075 · A test case from a plan cannot always be built: `Headers` rejects a newline in a value
- symptom: the plan's inbound request id case `abc\nSet-Cookie: x` throws before the test runs: `TypeError: Headers.append: "abc` newline `Set-Cookie: x" is an invalid header value.`
- cause: the platform refuses control characters in a header value, so the case describes a request no client can send through `fetch` or `Request`.
- rule: write the closest attack the platform accepts (`abc; Set-Cookie: x`, a 65 character id, a non-ASCII id) and say in the log that the plan's literal case cannot be built. Prove an input rule on values that survive the `Headers` constructor.
- proof: `node -e "try{new Headers({'x-request-id':'abc'+String.fromCharCode(10)+'x'})}catch(e){console.log(e.name)}"` → `TypeError`; `bunx vitest run tests/unit/pipeline.test.ts` passes `replaces an inbound id that does not match: abc; Set-Cookie: x`.
- added: 2026-10-02

## P-076 · The strict type-aware lint and `noUncheckedIndexedAccess` refuse common test idioms: write the typed form first, never cast or disable
- symptom: each of these failed `bun run lint` or `tsc` on its first version and was rewritten (B1b): `vi.spyOn(console, method).mockImplementation((line) => ...)` over a union of methods gave `no-unsafe-argument`; values read from `JSON.parse` gave `no-unsafe-assignment` and `no-unsafe-member-access`, and `Promise.reject("text")` gave `prefer-promise-reject-errors`; `String(error.name)` gave `no-unnecessary-type-conversion`; `expect` calls inside a helper gave `Test has no assertions  vitest/expect-expect`; a field of the router's `getMatchedRoutes` result gave `no-unsafe-call` and `no-unsafe-member-access`; `expect.stringMatching` and `expect.arrayContaining` inside `toEqual` gave `no-unsafe-assignment`, and `String()` of a `z.unknown()` field gave `no-base-to-string`; a `range` guard on a yaml node reached from `contents` gave `no-unnecessary-condition`; destructuring `[name, text]` pairs built by `map` gave `TS18048: 'name' is possibly 'undefined'`; `DROP.exec(text)?.[1].replace(...)` gave `TS2532: Object is possibly 'undefined'`; a `describe` that used a sibling `describe`'s helper and an unimported `readFileSync` failed only at run time with `ReferenceError`.
- cause: `strictTypeChecked` (R01) judges declared types: `JSON.parse`, router values and asymmetric matchers are `any`; `Error["name"]` is `string` though JavaScript can put any value there; `Scalar.Parsed` from `contents` has a non-null `range` (yaml 2.9.1) while a node from `get(key, true)` has `range?: Range | null`; spying on a union of keys picks no overload. `noUncheckedIndexedAccess` (R02) makes every index read `T | undefined`, regex groups and `map`-built arrays included; the `?.` before `[1]` covers only a `null` from `exec`. `vitest/expect-expect` looks for `expect` in the test's own body. Vitest strips types without checking them. The `.mjs` scripts are type-checked too (`checkJs` through `tsconfig.scripts.json`).
- rule: type a spy's parameter `(line: unknown)` and convert with `String(line)`; type a `vi.fn` by its signature (`vi.fn<PipelineContext["waitUntil"]>()`); parse JSON into `unknown` and read it through a Zod schema; reject only with an `Error`; widen runtime-unsafe fields on purpose (`const { name, message }: { name: unknown; message: unknown } = error;`); a helper returns what it read and the test asserts it with one `expect(...).toEqual(...)` (never add helper names to the rule's config); read an `any` into a variable typed `unknown` and narrow it with `typeof`; compute plain values (`/re/.test(value)`, `list.includes(item)`) instead of asymmetric matchers, and give a zod record a value union instead of `z.unknown()` when the test converts its values; walk a yaml document from `contents` and read `range` without a guard; a `map` that carries several values returns an object; read a capture group as `regex.exec(text)?.[n]?.<member>`; a helper two `describe` blocks need lives at module scope. Never a cast, a `!` or an `eslint-disable`, and never turn a flag off. Run `bunx tsc --noEmit -p tsconfig.json` and `bunx eslint --max-warnings 0 <file>` on a new test file or block before its first vitest run or full check. Narrowing `Object.keys` is G-103.
- proof: in scratch files under `app/tests/unit/` (measured 2026-10-02, deleted after): a `vi.spyOn(console, method)` loop over `["log", "warn", "error"] as const` → `bunx eslint --max-warnings 0 <file>; echo $?` prints `no-unsafe-argument` and `1`; `const parsed = JSON.parse('{"a":1}'); expect(parsed.a).toBe(1);` and `await expect(Promise.reject("plain text")).rejects.toBe("plain text");` → `no-unsafe-assignment`, `no-unsafe-member-access`, `prefer-promise-reject-errors`; `expect({ a: "1" }).toEqual({ a: expect.stringMatching(/1/) });` → `Unsafe assignment of an \`any\` value`; `function check(value: number) { expect(value).toBe(1); }` called from an `it` → `Test has no assertions  vitest/expect-expect`; `["a", "b"].map((name) => [name, name.toUpperCase()])` destructured → `bunx tsc -p tsconfig.json --noEmit` prints `error TS18048: 'name' is possibly 'undefined'.` and `2`; `export const width = /a(b)/.exec("ab")?.[1].length;` → `error TS2532`, and with `?.[1]?.length` → `0`; a helper declared in one `describe` and called in another → tsc `error TS2304: Cannot find name 'helper'.`, vitest `ReferenceError: helper is not defined`.
- merged: P-082, P-085, P-086, P-091, P-097, P-102, P-103, P-117, P-122
- added: 2026-10-02

## P-077 · A plan pins one tool version while `bunx` resolves another, depending on the folder
- symptom: B1b step 3 pins wrangler 4.145.0 (E11), yet `bunx wrangler --version` printed 4.146.0 in an earlier session, and the group's gate was written for 4.145.0.
- cause: `bunx` uses the dependency of the folder it runs in; outside `app/` there is none and it fetches the newest release. The runbook was the only place that said which one is pinned.
- rule: an exact version goes into `devDependencies` and the runbook table names it; every plan command that runs the tool starts in `app/`. A mismatch between the plan's number and what a clean resolve gives is recorded in the runbook and in this bank, and the pin moves only through Dependabot with the proofs re-run.
- proof: `cd app && bunx wrangler --version` → `4.145.0`; the same command in an empty scratch folder → `4.146.0` (2026-10-02).
- added: 2026-10-02

## P-078 · A plan line can contradict STANDARDS (a body shape, where a file's logic goes, the clauses a gate asserts): STANDARDS binds, and the plan line gets named
- symptom: B1b steps 3 and 4 give the calm 500 as `{"error":{"code":"server","requestId":"..."}}`; STANDARDS R09 and B3 line 42 require `{ error: { code, message, issues?, requestId } }`; the first build followed the plan and a reviewer rejected it. B1b line 131 put the bearer check of `sentry-test` in the route file; R11 and the folder map say an API route file is one wrapper line, so the logic moved to `src/server/hooks/sentry-test.ts` and the route, its test imports and six registry entries were rewritten. R54 names `hygiene.test.ts` as its enforcer, and two clauses (no attacker-controllable context such as `github.event.pull_request.title` or `github.head_ref` in a `run:` line; installs are `bun install --frozen-lockfile`) had no assertion, the checklist line C22 was missed, and in the next round invariant 15's clause "a step that calls `gh` reads `GH_TOKEN` from its `env`" had none either: three rejected rounds.
- cause: plan lines were written before STANDARDS and not brought into line; a builder reads a plan's file line as the file's content and builds a gate from the plan's test list.
- rule: before writing a file a plan names, check its line against the folder map (STANDARDS section 1), R11 and R09: an API route file holds one wrapper line, its logic goes to `src/server/<domain>/<name>.ts` (`hooks/` for `api/hooks/*`). Before closing a gate, open each STANDARDS rule whose `Enforced by:` names it and each plan invariant that says the gate "asserts all of this", and tick every clause against an assertion and a registry entry; walk the C-lines of section 3 for the artifact type (workflow: C22). A clause about something that does not exist yet still gets its assertion now, watched red by a mutation that adds the thing. Where the plan says less, STANDARDS binds; name the stale plan line to the orchestrator in the slice log.
- proof: `git grep -n "code: \"server\"" -- app/src/server/lib/pipeline.ts` → the object with `message`; `git grep -n "timingSafeEqual" -- app/src/routes` → nothing; `cd app && bunx vitest run tests/unit/hygiene.test.ts -t "R54"` runs `no run: line holds attacker-controllable context (R54)` and `every bun install in a workflow is --frozen-lockfile (R54)`; `grep -c "Cost (C22)" .github/workflows/ci.yml` → `1`.
- merged: P-083, P-101
- added: 2026-10-02

## P-079 · A group that adds tests owns `tests/mutations/<slice>.json`, and every `it` title maps to an entry before it reports
- symptom: the first step 3 report said "done" while its three test files had no entry in `tests/mutations/B1b.json` (R49, C08); the 17 mutations lived in a scratch spec outside the repository. The same report left knip's `src/start.ts` configuration hint (P-065) because `knip.json` was not in its file list. The g7 fix round added eight cases to `merge-gate.test.ts` and registered the seven it remembered; a reviewer's title-to-registry map printed `NONE` for the happy-path case and three older ones.
- cause: the group's file list was copied from the plan's file lines, which name neither the registry nor `knip.json`; entries were written for the mutations the author thought of, not by walking the test file.
- rule: a group's file list for a step that adds a test includes `tests/mutations/<slice>.json`, and one that creates a file knip reported as "no matches" includes `knip.json`. After any change to a test file, list every `it` title with the entries whose `expect` it contains and write the missing ones; every title ends with at least one entry replayed red for the right reason, and an order or a "does not" property needs its own mutation (swap the two calls, remove the guard). `tests/unit/mutation-registry.test.ts` now fails a test file that no entry names, but not a title without one. A watched-fail that is not yet a registry entry makes the status `partial`, never `done`.
- proof: `git grep -c "tests/unit/pipeline.test.ts" -- app/tests/mutations/B1b.json` → at least `1`; `cd app && bun run knip | grep -c "src/start.ts"` → `0`; `bunx vitest run tests/unit/mutation-registry.test.ts -t "name every test file"` passes.
- merged: P-109
- added: 2026-10-02

## G-020 · Sentry adds the sender's IP and city to a hand-built event unless the event forbids it
- paths: app/src/server/lib/sentry.ts
- severity: warn
- symptom: B1b step 4's first stored test event, sent with `user` dropped by `scrubEvent`, came back from the Sentry API with `user.ip_address` set to the laptop's IP and `user.geo` (city, country). With `sdk.settings.infer_ip: "never"` the IP was gone but the geo stayed. Two rebuild-and-read cycles before the event was clean.
- cause: Relay infers `user.ip_address` from the connection for a `javascript` event (legacy inference), and `normalize_user_geoinfo` (relay-event-normalization `event.rs`) looks up geo from the connection IP whatever `infer_ip` says, unless the event already holds a geo object. The project setting "Prevent Storing of IP Addresses" only stops the IP inference, not the geo lookup.
- rule: every event `scrubEvent` returns carries `sdk.settings.infer_ip: "never"` and `user: { geo: {} }`; a unit test is never the proof of what Sentry stores, the stored event read back through the API is (`user` must be `null`).
- proof: `cd app && bunx vitest run tests/unit/sentry.test.ts` passes, and registry entry `sentry-infer-ip` turns it red; the step 4 event read with `.../issues/<id>/events/?query=request_id:<id>&full=true` prints `user null` and `grep -c "ip_address\|cookie\|authorization"` → `0`.
- added: 2026-10-02

## P-080 · Vitest fake timers do not drive Node's `AbortSignal.timeout`
- symptom: a probe test with `vi.useFakeTimers()`, `AbortSignal.timeout(2000)` and `vi.advanceTimersByTimeAsync(2500)` printed `expected false to be true` for `signal.aborted`: the signal never fires, so a "fetch that never answers" case built on it hangs until the test's own 5 s timeout.
- cause: Node creates the timeout signal on its internal timers, which `@sinonjs/fake-timers` does not replace.
- rule: in a test that needs the timeout under fake timers, `vi.spyOn(AbortSignal, "timeout")` with an `AbortController` aborted from a (faked) `setTimeout`, and let the fake `fetch` take the signal as optional so a mutation that drops the signal hangs instead of failing a parse (`tests/unit/sentry.test.ts`).
- proof: `cd app && bunx vitest run tests/unit/sentry.test.ts -t "never answers"` passes in milliseconds; registry entry `r` (no `AbortSignal.timeout`) turns it red with `Test timed out in 5000ms`.
- added: 2026-10-02

## G-021 · A new route file fails the typecheck until a build regenerates the route tree
- paths: app/src/routes/**
- severity: warn
- symptom: `bun run check` failed on a new `src/routes/api/hooks/sentry-test.ts` with `Argument of type '"/api/hooks/sentry-test"' is not assignable to parameter of type 'keyof FileRoutesByPath | undefined'`, although the file was right. A `bun run build` made it pass.
- cause: `createFileRoute(path)` is typed by `src/routeTree.gen.ts`, which only the router plugin writes, during `vite build` or `vite dev` (G-001). `bun run check` runs `tsc` first and never runs the plugin.
- rule: after adding, renaming or deleting a route file, run `bun run build` (or have `bun run dev` running) before `bun run check`, and commit the regenerated `src/routeTree.gen.ts` with the route. Never edit the generated file to make tsc pass.
- proof: a scratch `src/routes/api/hooks/zz-scratch.ts` with `createFileRoute("/api/hooks/zz-scratch")` → `cd app && bunx tsc -p tsconfig.json --noEmit` prints that TS2345 error and exits 2 (measured 2026-10-02); deleting the file restores exit 0.
- added: 2026-10-02

## P-084 · Five plans call `captureException` without the options it really takes
- symptom: `captureException(error, options)` needs `dsn`, `requestId`, `route`, `env` and `release` (`sentry.ts` reads no environment, R14). B3.md:89 and :95, B17.md:16, B8b.md:127 and B8.md:124 give shorter shapes or call `dsn` optional and new. Recorded only in the B1b log until a reviewer asked for it here.
- cause: the plans were written against the plan's signature, which had no `dsn`; the built signature added it.
- rule: a slice that reports to Sentry passes all five keys; read the signature from `app/src/server/lib/sentry.ts` (`CaptureOptions`), never from a plan line. `tsc` refuses a missing key, which is the safe failure; do not make a key optional to fit a plan line.
- proof: `git grep -n "dsn: string | undefined;" -- app/src/server/lib/sentry.ts` → one line in `CaptureOptions`; a scratch `tests/unit/zz-scratch.ts` calling it without `dsn` → `cd app && bunx tsc -p tsconfig.json --noEmit` prints `TS2345 ... Property 'dsn' is missing in type ... but required in type 'CaptureOptions'` and exits 2 (measured 2026-10-02).
- added: 2026-10-02

## G-024 · The router matches a path decoded and without regard to case; a prefix rule on the raw pathname does not
- paths: app/src/server/lib/pipeline.ts, app/src/server/public/**, app/src/server/lib/admin-route.ts
- severity: warn
- symptom: the `/api/` guard (H39 (2)) and the rule-6 prefix lists compared `new URL(request.url).pathname` with `startsWith`. A reviewer sent `GET /API/hooks/sentry-test`, `/Api/...` and `/%61pi/...` (curl `--path-as-is`) under `cf:preview`: each answered the page shell, `200 text/html`, with `Cache-Control: public, max-age=0, must-revalidate` instead of `no-store`, and a POST with the right bearer to `/API/...` still reached the handler. `isPageRequest("/API/admin/x")` was `true`, so B3's cache hook would have seen an admin API read.
- cause: `@tanstack/router-core` matches with `caseSensitive: false` by default (`router.js` line 808) and decodes the path first (`decodePath` in `utils.js`: `decodeURI`, each escape alone when the whole is malformed, `%25` and `%5C` kept, leading slashes made one). `toLowerCase` also turns the Kelvin sign (`%E2%84%AA`) into `k`. WHATWG `URL` decodes none of this.
- rule: every rule that classifies a request by its path reads it through `routePath` in `pipeline.ts` (via `isPageRequest`, `neverCached` or `handle`); B3's cache module and B7's admin wrapper call those functions and never write their own `startsWith` on a pathname. A new prefix constant is written lower case.
- proof: `cd app && bunx vitest run tests/unit/pipeline.test.ts` passes, and registry entries `pipe-path-case`, `pipe-path-decode`, `pipe-path-slashes`, `pipe-path-split`, `pipe-path-never-cached` and `pipe-path-page` turn it red; under `cf:preview` `curl -s --path-as-is -o /dev/null -w "%{http_code} %{content_type}" http://127.0.0.1:8788/%61pi/hooks/sentry-test` → `405 application/json` (before: `200 text/html; charset=utf-8`).
- added: 2026-10-02

## P-087 · Scratch scripts and configs live outside `app/` and must resolve app packages from `app/`
- symptom: in the B1b g4 close-out the replay and measurement scripts lived in `app/scratch/`; `bun run check` failed with 8 errors (`Parsing error: ...scratch/measure.ts was not found by the project service` and `prettier/prettier` on the `.mjs` files). Moved to the lane root, a probe died with `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'eslint' imported from E:\mop-build\spine\scratch\...`, although it was run from `app/`. A scratch vitest config that named `app/tests/setup/dom.ts` by absolute path printed `Error: Cannot find module '/@fs/E:/mop-build/tests/app/tests/setup/dom.ts'` and `Tests  no tests`, and a scratch Playwright probe started with `bunx playwright test` printed `Cannot find module '@playwright/test'` (B4 g1 and follow-up).
- cause: flat-config ESLint does not read `.gitignore`, and `app/eslint.config.js` ignores only build folders and generated files. Node resolves a bare import from the folder of the importing file, and `bunx` from the folder it runs in; no `node_modules` lies above a scratch folder. Vite serves a file outside its root only when `server.fs.strict` allows it.
- rule: scratch files go to the lane root `E:/mop-build/<lane>/scratch/` or the session scratchpad and run from `app/`. A script resolves an app package with `const fromApp = createRequire(join(process.cwd(), "package.json"));` then `await import(pathToFileURL(fromApp.resolve("eslint")).href)`; a scratch vitest config that loads an app setup file sets `server: { fs: { strict: false } }` and runs as `bunx vitest run --root <scratch> --config <scratch>/<name>.mjs` with one test file per scratch folder (`--root` collects every test under it); a scratch Playwright config runs as `NODE_PATH=<app>/node_modules node node_modules/@playwright/test/cli.js test --config <scratch config>`. `scripts/watchfail.mjs` prints a run's output only when it is red, so a probe that measures writes its numbers to a file. Never add `scratch` to the lint config, never move the script into `app/`, never install packages at the lane root. A proof never depends on a scratch file (P-088).
- proof: `cd app && mkdir -p scratch && printf 'export const value = "x"\n' > scratch/zz-scratch.mjs && bunx eslint --max-warnings 0 scratch/zz-scratch.mjs; echo $?` prints `Insert ';'  prettier/prettier` and `1` (then `rm -rf scratch`); from `app/`, a `../scratch/zz-bare.mjs` holding `import { ESLint } from "eslint"` exits 1 with `ERR_MODULE_NOT_FOUND` and the `createRequire` form prints `function` (2026-10-02); a scratch config naming the setup file without `server.fs.strict: false` prints the `/@fs/` error and with it `Tests  1 passed (1)`; the one-test Playwright probe prints `Cannot find module '@playwright/test'` through `bunx` and `1 passed` through `NODE_PATH="$PWD/node_modules" node node_modules/@playwright/test/cli.js` (2026-10-03).
- merged: P-100, P-403, P-411
- added: 2026-10-02

## P-088 · A proof someone else cannot re-run is not a proof: scratch scripts are git-ignored and get deleted
- symptom: the first g4 close-out block of `workspace/05-plans/logs/B1b.md` cited `node scratch/sentry-read.mjs` and four more scratch scripts; the folder was gone when the reviewer came, who had to rebuild each one. Later the rule and proofs of three bank entries read `scratch/g6-replay.mjs`, `../scratch/g6-envsize.mjs` and `../scratch/g6-prelude.sql`, which no other lane, the orchestrator or CI has.
- cause: scratch files are never committed (STANDARDS 1.2; `.gitignore` line 37 ignores `scratch/`), and the log and the entries treated them as if they were.
- rule: a proof in a slice log or a bank entry is a command someone else can run: a committed script under its folder-map row (B4's `scripts/watchfail.mjs` replays the registry once it lands), or a self-contained inline command; in a slice log only, a scratch script whose full text is fenced beside its output (written with the Edit tool, P-008).
- proof: `git check-ignore -v scratch/g6-prelude.sql` → `.gitignore:37:scratch/` followed by the path; `git grep -c "^// node ../scratch/replay.mjs --check" -- workspace/05-plans/logs/B1b.md` → `1` (the replay runner's text is in the log).
- merged: P-319
- added: 2026-10-02

## P-089 · A security property needs a test that breaks when the property goes and the answer stays
- symptom: `timingSafeEqual` in `crypto.ts` (CS-04) had tests for equal, unequal and different-length arrays. A reviewer replaced the XOR loop with `if (a[index] !== b[index]) return false;` and all 27 crypto and route tests stayed green: the function still returned the right booleans, it just leaked where the first difference was.
- cause: the tests checked the result, and the property (every byte is read whatever the first difference) does not change the result.
- rule: for a property that does not change the output (constant time, no early exit, a signal passed, a header never stored), test the behaviour that carries it: here a Proxy over each array counts the indexes read when the first byte differs, and both must be all 32. Write the mutation that keeps the answer and drops the property, and see it red.
- proof: `cd app && bunx vitest run tests/unit/crypto.test.ts` passes; registry entries `crypto-every-byte` (the reviewer's mutation) and `crypto-no-early-exit` turn it red with `× reads every byte of both arrays when the first byte differs`.
- added: 2026-10-02

## G-025 · TanStack Start answers some requests itself: a bare 500 to a non-HTML Accept, a bare 308 to `//`
- paths: app/src/server/lib/pipeline.ts, app/src/start.ts, app/src/routes/api/**
- severity: warn
- symptom: under `cf:preview`, `curl -s -D - -H "Accept: application/json" http://127.0.0.1:8788/api/hooks/sentry-test` (a GET to a POST-only hook) answered `500` with `{"error":"Only HTML requests are supported here"}`, no code, no message, no request id, and the same for an unknown API path and for `-X DELETE`; the H39 (2) guard only knew the `text/html` shell. `//api/hooks/sentry-test` answers a bare `308` with only `Location`, no `x-request-id` and no security header. B1b's log first blamed the 308 on the runtime and listed the deployed Worker as UNPROVEN; both claims were wrong.
- cause: `createStartHandler.js` (`@tanstack/start-server-core`): `executeRouter`, which runs once no server handler took the request, returns `Response.json({ error }, { status: 500 })` when no Accept part starts with `*/*` or `text/html`; `if (handledProtocolRelativeURL) return Response.redirect(url, 308)` runs before any request middleware. Both are in the built bundle (`.output/server/_ssr/ssr.mjs`), so a deployed Worker answers the same. Also measured: `router.getMatchedRoutes(path)` does not decode escapes (`/%61pi/...` matched nothing until the pipeline passed the decoded path).
- rule: `handle()` turns that refusal under `/api/` into R09 JSON, `no-store` (405 when `deps.isApiRoute` finds an API route file for the decoded path, else 404), recognised by a 500 whose body has a string `error`, for an Accept the router refuses; never widen it to other bodies. A page with a non-HTML Accept got the bare 500 until step 4b (ASSUMED H41 (1)): the same refusal on a page now answers 406 `not_acceptable` with the R09 body and `no-store` (`neverCached` lists status 406, otherwise the page branch would stamp the html lifetime on it). The `//` 308 has no request id and no security header, accepted in H41 (2) and written in the runbook. Before recording why a response looks the way it does, grep the framework source and the built bundle for it.
- proof: `cd app && grep -c "Only HTML requests are supported here" node_modules/@tanstack/start-server-core/dist/esm/createStartHandler.js` → `1`; `grep -rl handledProtocolRelativeURL .output/server` lists `.output/server/_ssr/ssr.mjs`; `bunx vitest run tests/unit/pipeline.test.ts` passes and registry entries `pipe-refusal-off`, `pipe-refusal-405`, `pipe-refusal-route-path`, `bm-page-refusal`, `bn-page-406-all` and `pipe-406-no-store` turn it red; under `cf:preview` the GET above → `405 application/json` with the R09 body, `/api/hooks/nothing-here` → `404 application/json`, and `curl -s -o /dev/null -w "%{http_code} %{content_type}" -H "Accept: application/json" http://127.0.0.1:8788/` → `406 application/json`.
- added: 2026-10-02

## P-092 · A new required member of a shared dependency type breaks every test that builds that type
- symptom: adding the required `isApiRoute` to `PipelineDeps` made `tsc` fail in `tests/unit/sentry-test-route.test.ts`, a test of another file, because it builds its own `PipelineDeps`.
- cause: tests construct the shared type by hand, so each one is a caller the change must update.
- rule: before adding a required member to a type that tests build (`PipelineDeps`, later `PublicCtx` and the admin route context), `git grep` the type's name under `app/tests` and update every builder in the same commit; run `bun run typecheck` before the tests. A slice that adds a member names it in its plan's Files lines for the tests it touches.
- proof: `git grep -n "isApiRoute" -- app/tests` lists every test that builds the dependency.
- added: 2026-10-02

## P-094 · `python3 -` (a script on stdin, or an empty heredoc) opens the interactive prompt and spins; in a `;` chain it lets the rest run late
- symptom: in B1b g5 a `python3 - <<EOF` with an empty body hung the shell for 120 seconds and wrote nothing; the edit was redone with the Edit tool. The first diagnosis, "the Windows Store stub waits on stdin", was wrong: `python3` resolves to `.../WindowsApps/python3` but runs Python 3.14.2. In B4 g1 a patch chain `python - 2>/dev/null; node -e '<edits to package.json, tsconfig.json, eslint.config.js>'` was moved to the background at 120 s; the same edits were then made with the Edit tool (two failed with `String to replace not found`), and after `taskkill` of python the chain went on and applied the node patch a second time: a duplicated `"watchfail"` script, duplicated tsconfig includes, a half-reformatted `ignores` list. About 6 minutes.
- cause: with no script text on stdin, `python3 -` starts the interactive prompt; the Bash tool has no console, so the prompt fails with `OSError: [WinError 6] The handle is invalid` and restarts in a loop (measured: 10 MB of the same traceback in 8 seconds). A `;` runs the next command whenever the hung one ends, even much later.
- rule: do not run python in this project (P-008 sends anything with a backslash through Edit or Write). A script goes in a file run with `node`, or an edit goes through the Edit tool; never start an interpreter that can wait for stdin inside a chain. If python is unavoidable, use `python3 -c "..."` or a file, wrapped in `timeout 8`. When a call is moved to the background, run `git diff <files it can touch>` before the next edit, and when an Edit says `String to replace not found` for text just seen, read `git diff` of that file first.
- proof: `timeout 8 python3 -c "print('ok')"` → `ok`; `timeout 8 python3 - </dev/null 2>&1 | head -c 400` → the version banner, then `Traceback ...` and, further down, `OSError: [WinError 6] The handle is invalid` (2026-10-02); `grep -c '"watchfail"' app/package.json` prints `1` (it printed `2` before the clean-up, B4 g1).
- merged: P-400
- added: 2026-10-02

## P-095 · A ruling that says "accepted" was copied into the runbook as a fact about headers nobody had measured
- symptom: the step 4b runbook text said two answers "carry no x-request-id and no security header": the `//` 308 and the trailing-slash 307 under `/api/`. H41 (3) only says the 307 is accepted. Measured under `cf:preview`, the 307 goes through `handle()` and carries `x-request-id`, `Cache-Control: no-store`, `Strict-Transport-Security`, a Content-Security-Policy and `X-Frame-Options`; only the `//` 308 is bare. A reviewer found it; the same claim sat in the slice log and would have exempted `/api/` paths with a trailing slash from H1's header sweep.
- cause: a ruling about one answer was read as a ruling about both, and the properties of a response were written from the ruling, not from a `curl -D -`.
- rule: a sentence in a runbook or a log that says what a response carries is written from a `curl -s -D -` of that response on the built Worker, one line per header named. "Accepted" in a ruling is a decision, not a measurement. A rule that lists the classes it covers (architecture 13 rule 6, B1b invariant 10) is checked against the code's list when the code adds a class (here the 406 of `neverCached`); the line to fold is named to the orchestrator in the same block.
- proof: under `bun run cf:preview`, `curl -s -D - -o /dev/null http://127.0.0.1:8788/api/hooks/sentry-test/ | grep -ic "x-request-id\|x-frame-options"` → `2`; `curl -s --path-as-is -D - -o /dev/null http://127.0.0.1:8788//california | grep -ic "x-request-id\|x-frame-options"` → `0` (measured 2026-10-02).
- added: 2026-10-02

## P-096 · A plan's text check can name a rule the config never spells: `no-floating-promises` comes from the preset
- symptom: B1b's `hygiene.test.ts` line asks that `eslint.config.js` "names" `no-floating-promises`; the file does not contain the word, because `tseslint.configs.strictTypeChecked` switches the rule on. A text check would be red on a correct config, and writing the name into the config to please it would be dead text.
- cause: the plan line was written from what the lint does, not from what the file says.
- rule: assert lint rules on the resolved config (`new ESLint({ cwd }).calculateConfigForFile(<file>)`, severity `2`), and keep text checks for names that are literal config keys (`strictTypeChecked`). Name the stale plan line to the orchestrator in the slice log.
- proof: `cd app && grep -c no-floating-promises eslint.config.js` → `0`; `bunx vitest run tests/unit/hygiene.test.ts -t "lint is type-aware"` passes, and registry entry `hy-lint-floating` (the rule set `off`) turns it red.
- added: 2026-10-02

## P-098 · Watched-fail commits on a lane: the guard refuses `--no-verify`, and `git revert` has no `-q`
- symptom: B1b step 5 pushes a deliberately red commit and reverts it. A `git commit --no-verify` was refused by the RAGA guard before it ran; then `git revert --no-edit HEAD -q` printed only `usage: git revert ...` and did nothing, and the chain after it ran on the unreverted tree (the watch reported the red run again).
- cause: the global guard treats skipping commit hooks as dangerous; `git revert` has no quiet switch.
- rule: commit a deliberate red commit like any other (nothing is skipped); undo it with `git revert --no-commit HEAD && git commit -F <message file>`, a new commit, never an amend of a pushed one (G-009). Gate every later command of the chain on the revert with `&&`, and after a refused or failed call read `git status --short` and `git log --oneline -1` before retrying (P-056).
- proof: `git revert -q HEAD 2>&1 | head -1` → `usage: git revert [--[no-]edit] ...` (measured 2026-10-02); `git log --oneline -6` on `slice/b1b` shows each red commit followed by its revert.
- added: 2026-10-02

## P-099 · `actions/upload-artifact` uploads nothing from `.output` unless hidden files are included
- symptom: none hit (read before the first run): the build artifact of `ci.yml` is the Nitro output folder `app/.output/`, a name that starts with a dot.
- cause: upload-artifact (v4.4 and later, v7.0.1 here) searches with `@actions/glob` and `excludeHiddenFiles: true` by default; the globber skips any item whose basename starts with a dot, the search root itself included (`internal-globber.ts`, line 132).
- rule: every upload of a dot-named folder (`.output`, `.lighthouseci`) sets `include-hidden-files: true`, and the proof is a download: `gh run download <id> -n <artifact>` lists the files. B4's `e2e` and B8's `render.yml` follow the same rule.
- proof: `gh api "repos/actions/toolkit/contents/packages/glob/src/internal-globber.ts" --jq .content | base64 -d | grep -n "excludeHiddenFiles &&"` → `132:      if (options.excludeHiddenFiles && path.basename(item.path).match(/^\./)) {`; `gh run download 36996622633 -n build-output` holds `server/wrangler.json`.
- added: 2026-10-02

## P-105 · The step 5b probe branch is cut from an older main that has no merge-gate script, and its tree is the lane tree
- symptom: the plan's probe is `git switch -c gate-probe origin/main~1`, one commit, `gh pr create --draft`, `gh pr ready`, then `node workspace/05-plans/merge-gate.mjs <pr>`. On the probe branch that file does not exist (`origin/main` has none until the B1b merge), and the switch moves the whole lane tree: `git status` then showed the lane's ignored `scratch/` as untracked, because the older commit has no ignore line for it.
- cause: the script is an orchestrator file that lives on the lane branch, and the probe branch predates it; a worktree has one checked-out branch at a time (P-011).
- rule: commit and push the lane's work first, cut and push the probe, then `git switch slice/b1b` and run the script from there (it only needs the PR number; it fetches `origin main` and `pull/<n>/head` itself). Stage the probe's one commit by path, never `git add -A` (the lane `scratch/` is untracked there). Close it with `gh pr close <n> --delete-branch` and check `git ls-remote --heads origin`.
- proof: `git ls-tree -r origin/main --name-only | grep -c "05-plans/merge-gate.mjs"` → `0` until the B1b merge; on `slice/b1b` after the probe `node workspace/05-plans/merge-gate.mjs 24` → `rebase first`, exit 1 (PR #24, closed, branch deleted).
- added: 2026-10-02

## P-106 · `gh pr checks --json` exits 0 whatever the checks are; only the plain form exits 1 (failed) or 8 (pending)
- symptom: B1b step 5b's `workspace/05-plans/merge-gate.mjs` refused only when `gh pr checks <pr> --json bucket,workflow,name --jq ...` exited non-zero. It printed `fail:` and `pending:` lines, then posted `merge-gate=success` on a red head and ran `gh pr merge`. A fresh reviewer replayed it with a shim against cli/cli PR 13788 (three failed builds): the old script printed the three `fail:` lines and then the `statuses` POST and the `pr merge`, exit 0. The slice log had claimed the opposite, and no test ran the checks stage.
- cause: the author assumed the `--json` form keeps the exit-code contract of the plain command. It does not: with `--json` the exit code reports whether the call worked, not what the checks say. A pull request with no checks at all still exits 1 in both forms (`no checks reported`).
- rule: read the verdict from the `bucket` of every row (`pass` and `skipping` let a merge through, `fail`, `pending`, `cancel` and any other do not) and treat an empty list or a non-zero exit as a refusal; never lean on the exit code of `gh ... --json`. A script that decides a merge takes its commands as a parameter (`mergeGate(pr, run)`) so a test can watch that no write call follows a red bucket.
- proof: `gh pr checks 14148 -R cli/cli --json bucket >/dev/null; echo $?` → `0`, and the same without `--json` → `1` (measured 2026-10-02, gh 2.92.0); `cd app && bunx vitest run tests/unit/merge-gate.test.ts -t "refuses a fail check although"` passes, and the registry entries `mg-bucket` and `mg-bucket-pending` turn it red.
- added: 2026-10-02

## P-107 · The check-runs API of one commit holds one run per workflow run, so a name can appear several times
- symptom: `app/scripts/merge-gate.mjs` refused on every run of a required name on the PR head. A pull request opened as a draft and then marked ready on the same SHA, or one whose earlier run was cancelled by `cancel-in-progress`, leaves a skipped or cancelled run beside the one that counts: the post-merge gate would print `unverified merge <sha>: preview skipped` and turn `main` red for a merge that was fine. The unit tests used one run per name, so the case never appeared.
- cause: `GET /repos/{repo}/commits/{sha}/check-runs` (default `filter=latest`) deduplicates within one check suite, not across the workflow runs of a SHA. Draft, ready, re-run and cancelled runs each add their own rows.
- rule: judge the latest run of a name (highest `id`, a re-run gets a new one), never every run; the fixtures of any code that reads check runs carry two runs of one name. A required check whose latest run is skipped or cancelled still refuses (apart from the `CI_HEAVY=off` exception).
- proof: `gh api "repos/vitest-dev/vitest/commits/89d191ec4e630af0351b4e77fc7e7aa89679ae22/check-runs?per_page=100" --jq '.check_runs[] | select(.name | startswith("Lint: node-latest")) | [.name,.conclusion] | @tsv'` → two rows, `skipped` and `success`, for one SHA (measured 2026-10-02); `cd app && bunx vitest run tests/unit/merge-gate.test.ts -t "latest run"` passes, and the entries `mg-latest-run` and `mg-latest-order` turn it red.
- added: 2026-10-02

## P-108 · "The data cannot tell" was written into a log without asking the API that holds it: Actions exposes every step's conclusion
- symptom: B1b step 5b's `workspace/05-plans/merge-gate.mjs` printed only jobs whose bucket is `skipping`, and the g7 log said a job whose steps were all skipped "cannot be told from a normal one". A reviewer rejected it (plan line 112, DO-04: the script prints every job whose steps were all skipped): a job that ran with every real step skipped stayed a silent `pass` and the gate posted `merge-gate=success`. The limit was recorded as a fact and the gap was left out of the NOT DONE list.
- cause: `gh pr checks` rows carry a bucket, not steps; the author stopped there. The job behind a row has a `link` (`.../actions/runs/<run>/job/<id>`), and `GET repos/{repo}/actions/jobs/{id}` lists each step with its `conclusion` (`skipped` for a step an `if:` turned off).
- rule: before a log says a thing cannot be measured, name the API that would hold it and read one real answer. The gate reads the steps of every passed job that has an Actions link and prints `all steps skipped: <workflow> <job>` when every step other than `Set up job`, `Complete job` and `Post ...` was skipped; it prints and does not block (plan line 112), and a failed read of the steps refuses. A job whose setup steps ran while only its work steps were skipped is not "all skipped" by this measure: say so wherever the gate is described.
- proof: `gh api repos/AbdulrahmanAmer/matter-of-place/actions/jobs/110835524574 --jq '.steps[] | [.name, .conclusion] | @tsv' | head -2` → `Set up job	success` and `Run actions/checkout@...	success`; `cd app && bunx vitest run tests/unit/merge-gate.test.ts -t "all skipped"` passes, and registry entries `mg-steps-bookkeeping` and `mg-steps-every` turn it red.
- added: 2026-10-02

## P-110 · A run of a saved workflow used a copy without the change made a minute earlier
- symptom: `build-slice` was given `closeOut` to close a rejected group first. The run ignored it: it sized the remaining steps and built the next group on top of four open defects. The run's own script copy (under the session's `workflows/scripts` folder) held no `closeOut` at all, although the saved file did.
- cause: the saved workflow had been edited on a branch, merged, and the tree switched back to main seconds before the start; the tool resolved the name to the version it had read before the pull finished. Nothing reports which version a named workflow resolves to.
- rule: after editing a saved workflow, start it with `scriptPath` pointing at the file, not by name, and before waiting on it run `grep -c <new word> <the run's script copy>`; a count of 0 means stop the run. An argument a workflow does not know is ignored silently, so a wrong copy looks like a normal run.
- proof: `grep -c closeOut` printed 3 for `.claude/workflows/build-slice.js` and 0 for `workflows/scripts/build-slice-wf_f5c085e7-212.js`.
- added: 2026-10-02

## P-112 · A test row that two separate code paths both protect cannot be watched red by one mutation
- symptom: in the B1b c6 fix round the rows `rename in a string` and `a drop column after a block comment` stayed green under every single registry mutation: the string was blanked by the lexer and also missed by the narrowed rename rule; the comment was stripped and also passed over by the unanchored `alter table` search. The title-to-registry map could not be closed for them, and one replay round was spent finding out.
- cause: a mutation removes one mechanism; a row whose expected answer survives the loss of either mechanism alone has no single point to break.
- rule: pick each row's input so that exactly one mechanism decides it (a block comment before a `do` block, because `^do` needs the comment gone; `drop table` inside a string, because `drop table` is matched anywhere). When the input the review named is guarded twice, keep it in the probe output of the log and write the row for the input one mechanism carries. Never write a mutation that changes two places to force a red.
- proof: from `app/`, `node ../scratch/replay.mjs cm-string-drop cm-block-comment` → both `RED`; before the fix round's row change, the run of all `cm-` entries printed `NOT RED cm-rename-string: exit=1 expect=false` (2026-10-02).
- added: 2026-10-02

## P-113 · A ruling that changes a gate's rule can break a mechanism another plan built on the old rule: grep every plan for the rule's words
- symptom: H42 (3) made `check-migrations.mjs` refuse `drop function`. B2.md invariant 14 (line 71) says `drop function` stays allowed, and B2's `scripts/db-fn.mjs` (line 93) prepends `drop function if exists public.<name>(<old types>);` whenever a signature changes; B10 line 166 relies on it for `approve_asset`. The c6 log named only the stale STANDARDS and B1b lines, and a reviewer rejected the round for not surfacing the conflict.
- cause: the stale lines were searched in the files the ruling names, not in every plan that uses the same words.
- rule: after building a ruling that changes what a gate accepts, run `git grep -n -i "<each pattern word>" -- workspace/05-plans` and list every line that depends on the old behaviour in the slice log as a conflict for the orchestrator, with the file and line. A conflict between a ruling and another slice's mechanism is not resolved by the builder: build the ruling, report the conflict, mark it in `blockedOn`.
- proof: `git grep -n "drop function" -- workspace/05-plans/B2.md workspace/05-plans/B10.md` → `B2.md:71`, `B2.md:93`, `B10.md:166` (2026-10-02).
- added: 2026-10-02

## P-114 · `gh run list --commit` matches only the full 40-character SHA
- symptom: after a push, `gh run list --commit e10236b --json databaseId --jq length` printed `0` although the run existed, and the watch looked like a run that never started.
- cause: the flag compares the run's `head_sha` with the text as given; a short SHA matches nothing and gh prints no warning.
- rule: pass `--commit "$(git rev-parse HEAD)"` (or the full SHA), never the short form from `git log --oneline`. An empty answer from `gh run list` is not evidence that no run exists until the SHA is the full one.
- proof: `gh run list --commit e10236b --json databaseId --jq length` → `0`; `gh run list --commit e10236bf7dfdb9ccd13fc6959ddb7d76cf457ed0 --json databaseId --jq length` → `1` (gh 2.92.0, measured 2026-10-02).
- added: 2026-10-02

## P-118 · Reading why vitest went red: count `×` and `FAIL` lines, not diff blocks, and check a reason filter on every failure shape
- symptom: four table rows went red and the output showed three diff blocks; a filter written to read the reason of each red row missed lines, and a first log draft guessed why the counts differed. In B1b c7 round 2 the first `c7r-why.mjs` kept the `×`, `Tests` and diff lines; for `hy-gate-include` (a bare `expected false to be true`) and `hy-gate-prettier` (a zod error) it printed no cause at all, and every run was repeated with a wider filter.
- cause: vitest groups failures that carry an identical error from the same line (rows of one `it.each`) under one diff block, while two separate `it` cases with the same message keep a block each. A red prints its cause in at least three shapes: a diff under `- Expected`/`+ Received`, a single `AssertionError:` line with no diff, and a thrown error's own text (a zod issue list, a `TypeError`).
- rule: count red tests by the lines that start with `×` or `FAIL`, and read each row's reason from its own `×` line or by running it alone (`-t "<title>"`). Before trusting a reason filter, run it on a known red of each shape and see a cause line for every one; the filter reports a red run whose lines are only `×` and `Tests` as `NO CAUSE` and exits 1, and then the raw output is read, never a guess. Write a count in a log only after counting those lines.
- proof: a test file with `it.each([{ name: "a" }, { name: "b" }, { name: "c" }])("row $name", () => { expect(["x"]).toEqual([]); })` run with `bunx vitest run <file>` prints three `×` lines, three `FAIL` lines and one `- Expected` block.
- merged: P-131
- added: 2026-10-02

## G-031 · The type-aware lint test has the default 5000 ms limit and goes red on a loaded laptop with no lint fault
- paths: app/tests/unit/hygiene.test.ts
- severity: warn
- symptom: during the B1b c6 round 6 review `cd app && bun run check` exited 1 with `Error: Test timed out in 5000ms.` at `tests/unit/hygiene.test.ts:543:3` and `Tests  1 failed | 333 passed | 8 skipped (342)`; the next two runs exited 0 on the same bytes. The test is `lint is type-aware, zero-warning and refuses the named rules`. Hit again in B1b step 7 with two lanes building: `tests/unit/deploy-guard.test.ts` timed out twice at 5 s in the orchestrator's `bun run check` and passed alone (ruling H49 (3)).
- cause: the test builds an `ESLint` with `projectService` (a type-aware program) and sets no timeout of its own, so vitest's 5000 ms default applied. Alone it takes about 1.5 s; with other lanes running on this shared laptop it took 5056 ms once.
- rule: since rulings H49 (3) and H51 (2) the `test` script runs `vitest run --project unit --maxWorkers=2 --testTimeout=60000 --hookTimeout=60000` (`app/package.json`), so `bun run check` gives every test 60 s and lanes testing at once share the cores; never remove those flags. A direct `bunx vitest run <file>` still has the 5000 ms default: a red `Test timed out in 5000ms` there with every other test green is load, so run it again with `--testTimeout=60000` (or through `bun run test`) before reading it as a fault, and never edit lint rules or `eslint.config.js` for it. A red at 60 s on a quiet machine is a real fault.
- proof: `grep -c -- "--testTimeout=60000" app/package.json` → `1`; `cd app && bunx vitest run tests/unit/hygiene.test.ts -t "lint is type-aware" --reporter=verbose` → `✓ ... lint is type-aware, zero-warning and refuses the named rules 1489ms` and `Tests  1 passed | 37 skipped (38)` (measured 2026-10-02).
- added: 2026-10-02

## P-120 · Ruling H42 (1)'s measurement was confounded: PRs 21 and 23 had no check because main holds no workflow, and PR 23 changed a file that is not a document
- symptom: H42 (1) says a documents-only pull request has no check, "measured on PRs 21 and 23", because every changed path is under `paths-ignore`. `gh pr view 23 --json files` lists `.claude/workflows/build-slice.js`, which matches none of `workspace/**`, `launch/**`, `**/*.md`, and `origin/main` holds no workflow at all, so neither PR could have had a check whatever it changed.
- cause: `no checks reported` has two causes (every changed path ignored, or no workflow on the branches), and the measurement was taken while the second held. The ruling's mechanism is still right for the state after B1b merges.
- rule: before a measurement explains an absence, rule out every other cause of the same absence (here: does the workflow exist on the base and the head). The gate reads `ci.yml` from `origin/main`, so until B1b merges it refuses every pull request with no check (`ci.yml cannot be read`); after it, a pull request that touches `.claude/**` gets a `ci` run and is judged by its checks.
- proof: `gh pr view 23 --json files --jq '.files[].path' | grep -c build-slice.js` → `1`; `git ls-tree -r --name-only origin/main .github/` → `.github/workflows/README.md` only (both 2026-10-02, before the B1b merge).
- added: 2026-10-02

## P-123 · Output retyped or condensed into a slice log is no longer evidence: one mistyped path and the reviewer cannot trust any of it
- symptom: in B1b c7 the first draft of the log's "why red" section was a condensed version of the diff that `c7-why.mjs` printed, and it carried a mistyped path. It was replaced with the raw output. A condensed block reads like evidence and is not: nothing ties it to a run.
- cause: output was copied by reading and rewriting it, not by moving the bytes the command wrote.
- rule: a command's output goes into a slice log as the bytes it wrote: redirect it to a file (`> <scratchpad>/<name>.txt 2>&1`), paste that file into a fenced block with the Edit tool (P-070), trim only whole lines at the ends, never inside the failing part, and check the paste with `node ../scratch/in-log.mjs workspace/05-plans/logs/B1b.md <file> ...` (text in the c7 round 2 block) before the commit. A summary sentence is allowed beside the block, never instead of it.
- proof: `cd app && node ../scratch/in-log.mjs ../workspace/05-plans/logs/B1b.md <the c7 round 2 output files>` prints one `verbatim` line per file and exits 0; the same with one character of a file changed prints `NOT IN LOG <file>` and exits 1 (measured 2026-10-02).
- added: 2026-10-02

## P-132 · A text check with `includes` goes blind when a change puts its needle into the text twice
- symptom: `hygiene.test.ts` guarded the zero-warning lint (invariant 16, CS-02) with `scripts.lint.includes("--max-warnings 0")`. B1b c7 added a second ESLint run to the same script, with its own `--max-warnings 0`, so dropping the flag from `eslint .` (the run over all of `app/`) left the test green while `react-hooks/exhaustive-deps` stays a warning. The registry entry `hy-lint-warnings` was rewritten to strip both flags, so its replay stayed red and hid the gap. A reviewer rejected the round. Writing the fix, a new `find` (`--max-warnings 0 workspace/05-plans/merge-gate.mjs"`) also occurred twice, because `lint:fix` repeats the same tail; `replay.mjs` printed `BAD hy-lint-warnings-gate: find occurs 2 times` and the entry was rewritten.
- cause: `includes` asks "is it anywhere", which stays true while one copy survives. A mutation that removes every copy tests the stronger claim and says nothing about the weaker one; a script line copied into a sibling script (`lint`, `lint:fix`) doubles any short `find`.
- rule: when a change adds a second copy of a text a test looks for, the test pins the copy it means (`startsWith`, the exact command, or a count) and the registry gets one entry per copy that removes that copy alone. A `find` in `package.json` carries the script's own key or enough of its line to occur once; run `replay.mjs --check` before replaying.
- proof: with `maxWarnings` read as `includes("--max-warnings 0")` in `app/tests/unit/hygiene.test.ts`, `cd app && node ../scratch/replay.mjs hy-lint-warnings-app` → `NOT RED hy-lint-warnings-app: exit=0 expect=false`; with the committed `startsWith("eslint . --max-warnings 0 && ")` → `RED hy-lint-warnings-app: exit=1 expect=true | × lint is type-aware, zero-warning and refuses the named rules` (measured 2026-10-02, B1b c7 round 3).
- added: 2026-10-02

## P-300 · Knip refuses a dependency no file imports yet and a system binary a script spawns; the builder adds the one-line gate entry itself
- symptom: B2 step 1 adds `supabase`, `sharp`, `heic-convert`, `@supabase/supabase-js`, `pg` and `@types/pg` and writes `scripts/psql-dev.mjs`. `bun run knip` then printed `Unused devDependencies (4)` and `Unlisted binaries (1)  psql  scripts/psql-dev.mjs`, exit 1. The group's file list did not hold `app/knip.json`, so it reported BLOCKED and committed nothing, and the lane stood still until the orchestrator read the result.
- cause: the plan was written before the knip gate (B1b step 2b, R04): knip counts a dependency as used only when a file imports it or a `package.json` script names its binary, and `psql` is a scoop binary, not an npm package. "One writer per file" was read as forbidding any file outside the list, a gate's own configuration included.
- rule: add a dependency in the step whose code first imports it (sharp and heic-convert with step 12's image library, `@supabase/supabase-js` with its first importer), with `trustedDependencies` in the same commit; a CLI used only from inside a script gets its plan-named `package.json` script (`db:lint` names `supabase`). A builder adds the smallest entry for its own files to a gate's configuration (`ignoreBinaries` in `knip.json` for psql, pg_dump, ffmpeg) and says so in the slice log (ruling H46 (1), in the build workflow's standing rules). A plan step that adds a script spawning a system binary names `knip.json` in its files.
- proof: `cd app && git show fe027f4:app/knip.json > knip.nokey.tmp.json && bunx knip --config knip.nokey.tmp.json; rm knip.nokey.tmp.json` → `Unlisted binaries (1)  psql  scripts/psql-dev.mjs`, exit 1, and with `"ignoreBinaries": ["psql"]` → exit 0 (B2 c1); `grep -c "ruling H46" .claude/workflows/build-slice.js` prints 1.
- merged: P-500
- added: 2026-10-02

## P-301 · A pull request that conflicts with main gets no CI run at all, and `gh pr checks` only says "no checks reported"
- symptom: B2 c1 opened draft PR 49 from `slice/b2` (cut at fe027f4) and waited nine minutes for `ci`; `gh run list --commit <full sha>` printed `[]` and `gh pr checks 49` printed `no checks reported on the 'slice/b2' branch`, although `ci.yml` triggers on `opened` and the commit touches `app/`. `gh pr view 49 --json mergeable,mergeStateStatus` → `"mergeable":"CONFLICTING"`, `"mergeStateStatus":"DIRTY"`: the lane and main had both appended to `GOTCHAS.md` (P-300 here, P-500 there).
- cause: a `pull_request` workflow runs on the PR's test merge commit; when GitHub cannot build it (a conflict), no run starts and nothing says why. Every lane appends to the bank, so a lane whose base is older than main's last bank entry is born conflicting (P-072).
- rule: right after opening or pushing a pull request, read `gh pr view <n> --json mergeable,mergeStateStatus` before waiting on any check; `CONFLICTING` means no CI will come, so report it to the orchestrator (who merges main into the lane, P-072) instead of polling. An empty `gh run list` is not "CI is slow".
- proof: `gh pr view 49 --json mergeable,mergeStateStatus` → `{"mergeStateStatus":"DIRTY","mergeable":"CONFLICTING"}` and `gh pr checks 49` → `no checks reported on the 'slice/b2' branch` (measured 2026-10-02, B2 c1).
- added: 2026-10-02

## P-304 · A proof that says "run in a terminal" cannot run in the Bash tool: it has no console, and the first two ways to make one failed
- symptom: B2 step 1b's proof is "`node scripts/load-env.mjs --profile dev` run in a terminal exits 1 printing no value". Every Bash tool call has its standard output on a pipe (`process.stdout.isTTY` is undefined), so the refusal path never runs there. The first console run, a `.cmd` started with `Start-Process`, wrote `ECHO is off.` instead of the exit code (`echo %errorlevel%> file` turns `1>` into a redirection of handle 1), and its screen capture died with `Missing ']' after array index expression` on `$cells[$y, $x].Character` in Windows PowerShell 5. A `sed` that was to write the control script dropped its backslashes (P-070) and silently ran the real script again.
- cause: the harness gives commands no console; cmd reads a digit right before `>` as a handle number; PowerShell 5 does not parse a two-index array access inside a method call's argument list.
- rule: prove terminal behaviour in a new console: a PowerShell file runs `Start-Process -FilePath cmd.exe -ArgumentList '/c', '<file>.cmd' -Wait -WindowStyle Minimized`; the `.cmd` (written with the Write tool) records `isTTY`, sends stderr to a file, writes the exit code as `> <file> echo exit=%errorlevel%`, then a PowerShell file copies the screen with `$Host.UI.RawUI.GetBufferContents(...)` read through `$cells.GetValue($y, $x)`. Check the copy for secret values with a script that prints counts only, and run a control `.cmd` that echoes a known line, so a blind capture shows up. The scripts' text is in `workspace/05-plans/logs/B2.md`, block "g1 · steps 1b".
- proof: `node -e "console.log(process.stdout.isTTY)" | cat` in the Bash tool prints `undefined`; the console run of the log block prints `stdout isTTY=true`, `exit=1`, `values on screen: 0 of 4`, and its control prints `"export " on screen: true` (measured 2026-10-02, B2 g1 step 1b).
- added: 2026-10-02

## P-305 · Removing a generator's output by its folder took a tracked file with it
- symptom: in B2 g1 step 1b a trial `bun run gen:types` wrote `app/src/db/types.ts`, and `rm -r src/db` to remove it also deleted the tracked `app/src/db/README.md` (`git status` printed ` D src/db/README.md`). An earlier `ls` of the folder had been misread as empty.
- cause: a generator writes into a folder that already holds tracked files; deleting the folder deletes them too.
- rule: remove only the file a trial run created, by name (`rm src/db/types.ts`), then read `git status --short` before going on; restore a deleted clean file with `git checkout -- <file>` (P-068: only when the file had no uncommitted work).
- proof: `git ls-files app/src/db` → `app/src/db/README.md` (the folder is not the generator's alone).
- added: 2026-10-02

## P-306 · A stored Supabase CLI login on this laptop hides whether a command needs `SUPABASE_ACCESS_TOKEN`
- symptom: the B2 step 2 proof says to run `bun run db:push` in a dev-profile shell "with no access token" to learn whether `supabase db push --linked` needs one after `link`. In that shell `process.env.SUPABASE_ACCESS_TOKEN` was undefined and the push still worked, but `bunx supabase projects list` printed four projects of other Omnikom accounts: the CLI had found a login of its own, so the pass proved nothing.
- cause: the CLI takes a token from `SUPABASE_ACCESS_TOKEN`, else from the Windows Credential Manager entry `Supabase CLI:supabase` (`cmdkey /list`), which belongs to the operator and is not ours to delete or log out.
- rule: to learn whether a CLI command needs the Management API token, give it a token that cannot work (`SUPABASE_ACCESS_TOKEN=sbp_` plus 40 zeros overrides the stored login) and run a control that must fail. Measured with CLI 2.119.0: `supabase migration list --linked` without `SUPABASE_DB_PASSWORD` prints `Initialising login role...` and fails 401; `bun run db:push` (it passes the database password) prints no such line and exits 0. So after `link`, `db push --linked` needs only the database password, and `link`, `config diff`, `config push` and a listing without the password need the token.
- proof: `cd app && eval "$(node scripts/load-env.mjs --profile dev)"; export SUPABASE_ACCESS_TOKEN=sbp_0000000000000000000000000000000000000000; bunx supabase migration list --linked | head -2; bun run db:push | tail -1` → `DbConfigLoginRoleStatusError ... 401` for the first, `"message":"Remote database is up to date."` for the second (measured 2026-10-02, B2 g2).
- added: 2026-10-02

## P-307 · `supabase init` defaults differ from the live project, and `config.toml` has two readers: `config push` and CI's `supabase start`
- symptom: B2 step 2 says "`supabase config push` (auth URLs, sign-ups closed, storage limit)" and F20 says it has no dry-run. The file `supabase init` wrote declared 14 differences from `mop-dev`; pushing it unchanged would have set the email OTP length 8 to 6, `max_frequency` 1m to 1s, email confirmations on to off, TOTP MFA on to off, the pooler 15 and 200 to 20 and 100, and Iceberg analytics on to off. The live values copied in to avoid that also apply to the ephemeral stack that B4's CI jobs `db` and `e2e` start from the same file (B4.md lines 15, 103, 117 and 118; ASSUMED H1 (b)): `max_frequency` 1m0s, `otp_length` 8, confirmations on, TOTP on, `[storage.analytics] enabled = true` (marked hosted only in the template).
- cause: the template is written for a local stack. CLI 2.119.0 has `supabase config diff` (no Docker; the changes as JSON on the last line), so F20 is stale for this CLI; `config push` asks per service, honours piped `y` or `--yes`, and leaves keys the file does not declare alone. What `max_frequency` and `storage.analytics` do under `supabase start` is UNPROVEN: no Docker here (S50).
- rule: run `bunx supabase config diff` before and after every `config push` (it must list only what the plan means to change). A key the plan does not pin takes the live value in `config.toml`; a changed value is a decision, and also a change to the CI stack: B4 reads the list above before its first `db` or `e2e` run, and a test that asks for a magic link twice for one address within 60 s expects a rate-limit error. The diff lists `storage.image_transformation` (remote true, undeclared) as `remote_only` on every run: left unchanged, free tier.
- proof: `cd app && bunx supabase config diff | tail -1 | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(j.counts)'` (token loaded in that shell) → `{ update: 0, remote_only: 1, local_only: 0, total: 1 }` after the push, `update: 12` before the alignment; `grep -n -A1 "max_frequency\|^\[storage.analytics\]" app/supabase/config.toml` → `max_frequency = "1m0s"` and `enabled = true` (measured 2026-10-02, B2 g2).
- merged: P-308
- added: 2026-10-02

## P-310 · Database tests refuse to start in this shell: load the dev profile, then `env -u CLOUDFLARE_API_TOKEN`
- symptom: the first `bunx vitest run --project db tests/db/migration-headers.test.ts` in B2 g3 printed `No test files found, exiting with code 1` and `Error: refusing: ops variables in this shell CLOUDFLARE_API_TOKEN (load the dev profile in a fresh shell)`. In the review of B2 g4, after the standing-rule loader `set -a; . <(tr -d '\r' < .env | grep ...); set +a`, the refusal also named `PROD_TURNSTILE_SECRET SUPABASE_ACCESS_TOKEN`; in the g5 review, loading only `DEV_DB_URL` still gave `CLOUDFLARE_API_TOKEN`.
- cause: the shell the harness starts inherits `CLOUDFLARE_API_TOKEN` from the user environment (a fresh shell is not a clean shell on this laptop), and the inline loader loads every name of the single `.env`, ops names included. `tests/db/global-setup.ts` calls `guardEnv()` first (SEC-08), as it must. Ruling H30 (3) replaced the inline loader with `eval "$(node scripts/load-env.mjs --profile dev)"` from B2 on. `No test files found` is vitest's wording for a global setup that threw.
- rule: a db test, `bun run test:db` or any script that calls `guardEnv()` runs from `app/` as `eval "$(node scripts/load-env.mjs --profile dev)"`, then `env -u CLOUDFLARE_API_TOKEN <command>`, in that order. The inline loader is for commands that are not db tests. Never weaken the guard or unset the name in a config file; unsetting `.env` values never helps. When vitest prints `No test files found` for a path that exists, read the `Error:` line first. Still open for the orchestrator (checked 2026-10-03): `.claude/workflows/build-slice.js` line 90 and `.claude/agents/mop-builder.md` line 41 still print the inline loader.
- proof: `env | grep -c '^CLOUDFLARE_API_TOKEN='` in a new Bash tool call prints `1`; from `app/` with the dev profile loaded, `bunx vitest run --project db tests/db/migration-headers.test.ts 2>&1 | grep "^Error"` prints the refusal above, and the same with `env -u CLOUDFLARE_API_TOKEN` prints `Tests  3 passed (3)` (measured 2026-10-03, B2 g3).
- merged: P-313
- added: 2026-10-03

## P-311 · The sketch commit 8dd6f26 has no `app/` folder, so the plan's `git show 8dd6f26:app/docs/database/schema.sql` fails
- symptom: B2 g4 ran the read the plan names for the sketch columns (B2 Contract > Inputs: `git show 8dd6f26:"app/docs/database/schema.sql"`) and got `fatal: path 'app/docs/database/schema.sql' exists on disk, but not in '8dd6f26'`.
- cause: commit ddc0b4d renamed the app folder to `app/` after 8dd6f26; at 8dd6f26 the file is `Matter Of Place Codebase/docs/database/schema.sql`. The plan wrote today's path against an older commit.
- rule: read the sketch at 8dd6f26 by its path at that commit, `git show "8dd6f26:Matter Of Place Codebase/docs/database/schema.sql"` (lines 94 to 439 are the tables), and after a folder rename check a historical path with `git ls-tree -r --name-only <commit> | grep <file>` before trusting a plan line.
- proof: `git show "8dd6f26:Matter Of Place Codebase/docs/database/schema.sql" | sed -n 94p` → `create table markets (` (measured 2026-10-03, B2 g4).
- added: 2026-10-03

## P-312 · Prove an unmerged migration inside each db test's rolled-back transaction, and pass a large prelude through node, not bun
- symptom: B2 g4 could not run its database proofs the ordinary way: phase 1 forbids pushing an unmerged migration (DB-01, H1) and B4's CI `db` job does not exist yet. In B2 g5, with migrations 4 to 6 as one 35,678-character prelude, `bunx vitest run --project db ...` printed nothing and exited 0; stripped of comment lines (27,968 characters) it printed `panic: Segmentation fault at address 0xFFFFFFFFFFFFFFFF`, and `function-source.db.test.ts` then reported `differs: [enforce_submission_media_limit, ensure_analytics_partitions]`. In B2 g6 migrations 4 to 8 made a 43,805-character prelude, which the earlier "32 KB limit" said could not be passed.
- cause: the harness runs `MOP_MUTATION_SQL` first inside the rolled-back transaction of `withRollback` (T-07), and Postgres DDL is transactional, so a migration's whole text can be that SQL. bun on Windows crashes on a very large environment variable; node does not: 32,767 characters is the limit of `SetEnvironmentVariable`, not of the block `CreateProcess` passes, and Git Bash `export` and `spawnSync(process.execPath, ..., { env })` hand the whole value on. Stripping with `grep -v '^\s*--'` also deleted the comment lines inside `$$` function bodies, so `pg_proc.prosrc` no longer equalled the function file.
- rule: until the `db` job runs, prove an unmerged migration with `MOP_MUTATION_SQL="$(cat supabase/migrations/<file>.sql)"` on the command (dev profile and `env -u CLOUDFLARE_API_TOKEN`, P-310), replay `sql` watched-fails with that file prepended, and say in the log that the proof is mop-dev inside rolled-back transactions and the CI job is still UNPROVEN. Run a prelude over about 15 KB through `node node_modules/vitest/vitest.mjs run --project db ...`, spawn replays with `spawnSync(process.execPath, args, { env })` (never `shell: true`), build the prelude with a script that drops comment and blank lines only outside `$$` bodies, and keep every migration the tests read in it. Without the prelude, `function-source.db.test.ts` fails on mop-dev for the new function files until the migration is pushed from `main`. Two test files that create the same tables wait on each other's catalog rows: keep the files few, or pass `--no-file-parallelism` when a run times out on `lock_timeout`.
- proof: from `app/` on slice/b2 at B2 g4, `MOP_MUTATION_SQL="$(cat supabase/migrations/20261001090300_catalog.sql)" env -u CLOUDFLARE_API_TOKEN bunx vitest run --project db` → `Tests  60 passed (60)`, and afterwards `bun run db:psql -- -Atc "select to_regclass('public.properties') is null"` → `t`; at B2 g6, with the 43,805-character prelude exported, `node -e "console.log(process.env.MOP_MUTATION_SQL.length)"` → `43805` and the db project run through node gave `Tests  2 failed | 144 passed (146)`, the two reds being P-316's stray function (measured 2026-10-03).
- merged: P-314, P-317
- added: 2026-10-03

## P-315 · A plan's proof grep for the old `agent_*` names matches the `listing_agent_name` column the same step creates, and `git grep` cannot see the new migration
- symptom: B2 step 5's proof `grep -rn "agentName\|...\|agent_name\|agent_email\|agent_phone" src/domain supabase/migrations` printed three lines of `20261001090400_intake.sql`, all `listing_agent_name`, although no `agent_name` column exists; `git grep` of the same pattern printed nothing because the new migration was still untracked.
- cause: `agent_name` is a substring of `listing_agent_name`, a column invariant 22 itself requires; and `git grep` searches tracked files only.
- rule: prove the rename with the name anchored, `grep -rnE "agentName|agentEmail|agentPhone|(^|[^_a-z])agent_(name|email|phone)" src/domain supabase/migrations`, which prints nothing; run it with `grep -r` on those two small folders (P-049 forbids it only from the repository root) or after `git add`. The header comment of a migration must not spell the old names either.
- proof: `cd app && grep -rnE "agentName|agentEmail|agentPhone|(^|[^_a-z])agent_(name|email|phone)" src/domain supabase/migrations; echo $?` → no line, then `1` (measured 2026-10-03, B2 g5).
- added: 2026-10-03

## P-316 · mop-dev holds a stray committed function `__wf_probe`, which turns two db tests red whatever a lane does
- symptom: B2 g5's full db run on `mop-dev` failed `function-source.db.test.ts` (`withoutFile: [__wf_probe]`) and the T-07 case of `harness.db.test.ts` (`error: function "__wf_probe" already exists with same argument types`), neither related to migrations 5 and 6. B2 g4 ran the same two files green a day earlier.
- cause: some workflow probe created `public.__wf_probe()` (`select 1`) on `mop-dev` and committed it. A lane may not drop it: `mop-dev` is shared and DB-01 allows only `main` to change it.
- rule: before reading a `function-source` or `withMutation` red as the lane's own, run `bun run db:psql -- -Atc "select proname from pg_proc where proname like '\_\_wf%'"`; a row is the stray probe, to be dropped by the orchestrator. The lane reports the two cases as red for that reason and does not drop it.
- proof: `cd app && eval "$(node scripts/load-env.mjs --profile dev)" && env -u CLOUDFLARE_API_TOKEN bun run db:psql -- -Atc "select proname from pg_proc where proname like '\_\_wf%'"` → `__wf_probe` (measured 2026-10-03, B2 g5).
- resolved: dropped by the orchestrator on 2026-10-03 12:10 laptop time (`drop function if exists public.__wf_probe()` → `DROP FUNCTION`, count 0); the rule stays, a new stray goes the same way
- added: 2026-10-03

## G-100 · `db:reset` removes Supabase's automatic RLS: a table whose migration does not enable RLS stays open
- paths: app/supabase/migrations/**
- severity: warn
- symptom: none hit; seen in B2 g3. Before the first `bun run db:reset` on `mop-dev`, `pg_event_trigger` listed `ensure_rls` calling `public.rls_auto_enable`; after it the function and the event trigger are both gone (`drop schema public cascade` takes the event trigger with the function it calls).
- cause: Supabase's automatic RLS lives in `public`, and the reset empties `public` (S49 revokes the helper's execute grant; nothing puts the trigger back). The same reset drops the schema's default privileges, so a new table also gets no grant at all until migration 10.
- rule: every migration that creates a table enables RLS on it in the same file and states its grants (`revoke all ... from anon, authenticated`, `grant all ... to service_role`), as migrations 1 and 2 do; never rely on Supabase defaults that `db:reset` removes. Migration 10's grants and RLS list stay the full statement of the matrix.
- proof: `cd app && bun run db:psql -- -Atc "select count(*) from pg_event_trigger where evtname = 'ensure_rls'"` prints `0` after a reset; `bun run db:psql -- -Atc "select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity"` prints nothing (measured 2026-10-03, B2 g3).
- added: 2026-10-03

## G-101 · A catalog column of type `"char"` cannot be concatenated with a string literal
- paths: app/tests/db/**, app/scripts/**
- severity: warn
- symptom: B2 g4's foreign-key shape case of `schema.db.test.ts` failed with `error: operator is not unique: unknown || "char"` on `'on delete ' || c.confdeltype`.
- cause: `pg_constraint.confdeltype`, `contype`, `pg_class.relkind` and the other one-letter catalog codes are the type `"char"`, and `||` has no single candidate for an untyped literal on one side and `"char"` on the other.
- rule: cast a `"char"` catalog column to `text` before `||` or `format`: `c.confdeltype::text`. Comparing it with a literal (`confdeltype in ('c', 'n', 'r')`) needs no cast.
- proof: `cd app && bun run db:psql -- -Atc "select 'on delete ' || c.confdeltype from pg_constraint c where contype = 'f' limit 1"` → `ERROR:  operator is not unique: unknown || "char"`; with `c.confdeltype::text` → `on delete c` (measured 2026-10-03, B2 g4).
- added: 2026-10-03

## P-503 · A lane without a bank number base takes the next number after everyone else's entries
- symptom: merging main into the delivery lane left `GOTCHAS.md` unmerged: `merge-gotchas: both sides changed P-502`. The lane's builder had numbered its new entries P-502 to P-505, right after the orchestrator's P-500 and P-501 that an earlier merge had brought in, while the orchestrator wrote its own P-502 on main.
- cause: the lane was started before bank bases existed (H45 (5)), so its builders followed the old rule, "the next free number above the highest in the file", and the highest was now an orchestrator number.
- rule: every lane runs with a `bankBase` and its own `previewPort` (`workspace/05-plans/restart.json`; ruling H45 (5)): spine P-150/G-40 on port 8788, db P-300/G-100 on 8798, tests P-400/G-150 on 8808, design P-700/G-250 on 8818, a fifth lane api P-800/G-300 on 8828; the orchestrator writes from P-500/G-200. Wherever a plan, a script or an entry says 8788, a lane uses its own port, and it stops only the processes it started. When the driver reports the same id on both sides, renumber the lane's entry into the lane's series, fix the references in the lane's logs, and append the other side's entry back.
- proof: `grep -c '"bankBase"' workspace/05-plans/restart.json` prints 4; `grep -o '"previewPort": [0-9]*' workspace/05-plans/restart.json` prints 8798, 8808 and 8818 (spine takes the default 8788 of `build-slice.js`).
- added: 2026-10-03

## G-102 · A statement that fails inside `withRollback` aborts the whole test transaction unless a savepoint wraps it
- paths: app/tests/db/**
- severity: warn
- symptom: B2 g6's eight `hard_delete` cases all failed with `error: current transaction is aborted, commands ignored until end of transaction block` on the `set_config('mop.retention', ...)` line, after the refused delete had raised exactly as intended.
- cause: `withRollback` runs the whole test in one transaction, and `failureOf` only catches the error: Postgres marks the transaction aborted, so every later statement in that test fails.
- rule: a test that goes on after an expected error runs the failing statement under a savepoint (`savepoint x` before, `rollback to savepoint x` after), as `outcome` and `attempt` do; use bare `failureOf` only for a test's last statement.
- proof: from `app/` with the g6 prelude, `node node_modules/vitest/vitest.mjs run --project db tests/db/integrity.db.test.ts -t hard_delete` → `Tests  8 passed | 43 skipped (51)`; without the two savepoint lines around `failureOf` in that case → `8 failed` with the message above (measured 2026-10-03, B2 g6).
- added: 2026-10-03

## G-103 · `Object.keys(obj) as K[]` fails the lint: `no-unsafe-type-assertion` refuses the narrowing
- paths: app/tests/**, app/src/**
- severity: warn
- symptom: B2 g6's first `bun run check` failed lint on `Object.keys(submissionTransitions) as WorkflowState[]` in two test files: `Unsafe type assertion: type '(...)[]' is more narrow than the original type  @typescript-eslint/no-unsafe-type-assertion`.
- cause: `Object.keys` returns `string[]`, and the strict type-aware preset (R01) refuses any cast to a narrower type.
- rule: narrow the keys with a type guard instead of a cast: `Object.keys(obj).filter((key): key is K => key in obj)`.
- proof: `cd app && bun run lint` exits 0 on slice/b2 at B2 g6; with the cast put back in `tests/unit/workflow.test.ts` it prints the error above (measured 2026-10-03).
- added: 2026-10-03

## P-318 · `scripts/check-migrations.mjs` reads only committed migrations: run before the commit it prints OK without seeing a new file
- symptom: the B2 g6 log recorded `migration-order: OK (3 on main, 3 added)` while migrations 7 and 8 were new and uncommitted. On the shipped tree the same command says `(3 on main, 5 added)`. The reviewer had to re-run it to learn that the first run had not checked the two new files.
- cause: the script lists added files with `git diff --relative --name-only origin/main...HEAD --diff-filter=A -- supabase/migrations`, a diff of commits. A file that is untracked or only staged is not in it, so it is neither ordered nor checksummed.
- rule: run `check-migrations.mjs` after committing the migration, and compare the `added` count with the number of new files under `supabase/migrations`; a count that is lower means the run proved nothing about the new file.
- proof: from `app/`, `printf -- '-- probe\n' > supabase/migrations/20261001099999_probe.sql && node scripts/check-migrations.mjs; rm supabase/migrations/20261001099999_probe.sql` → `migration-order: OK (3 on main, 5 added)`, the probe not counted (measured 2026-10-03, B2 g6 follow-up).
- added: 2026-10-03

## P-404 · The plan's grep over `tests/fixtures/*.ts` for `randomUUID` also finds B2's harness, `db.ts`
- symptom: B4 invariant 8 and the GQ-03 proof say `git grep -n "Date.now\|Math.random\|randomUUID" tests/fixtures` prints nothing and `clock.test.ts` greps `tests/fixtures/*.ts`. On main, `tests/fixtures/db.ts` (B2's harness, F22) has `import { randomUUID } from "node:crypto"` and `const id = randomUUID()` in `createAuthUser`, so the first form of the test was red before any factory existed (found in the B4 g2 plan reading, not in a run).
- cause: the plan wrote the grep for the factories and the dataset but placed it over the whole folder, which already held B2's file; B4 invariant 4 says its tests never call `createAuthUser`.
- rule: the grep covers every `tests/fixtures/*.ts` except `db.ts`, and `clock.test.ts` says so in a comment. The plan's proof line is read the same way: `git grep` over `tests/fixtures` prints only the `db.ts` lines. If `createAuthUser` ever moves to `deterministicUuid`, drop the exception.
- proof: from `app/`, `git grep -n "randomUUID" -- tests/fixtures` prints only `tests/fixtures/db.ts:3` and `tests/fixtures/db.ts:90`, and `bunx vitest run --project unit tests/unit/clock.test.ts` prints `Tests  11 passed (11)`.
- added: 2026-10-03

## P-405 · `optionalShort` in `contracts.ts` never turns an empty string into absent: its union takes the first branch
- symptom: a test written from the plan wording ("trimming, empty optional fields") expected `inquirySchema.parse({ ..., phone: "" }).phone` to be `undefined` and got `""`.
- cause: `shortText.optional().or(z.literal("").transform(() => undefined))` is a union and `""` already passes `shortText.optional()`, so the transform branch is never reached (`optionalUrl` does turn `""` into absent because `""` fails `.url()` first).
- rule: assert that an empty `phone`, `location`, `architect` and the like are accepted, never that they become absent; a change to that behaviour belongs to the slice that owns `contracts.ts` (B3), with a test of its own.
- proof: from `app/`, `bunx vitest run --project unit tests/unit/contracts.test.ts -t "accepts an empty optional field"` prints `Tests  1 passed`, and `-t "empty optional url into absent"` also passes (measured 2026-10-03).
- added: 2026-10-03

## G-150 · A scroll-width check alone cannot see an overflowing element on this site: the page clips it, so `expectNoOverflow` also lists the elements wider than the viewport
- paths: app/tests/e2e/fixtures/page.ts, app/tests/e2e/sweep.spec.ts
- severity: warn
- symptom: B4 g3 watched-fail (f) put `<div style={{ width: 2000 }} />` into `src/routes/about.tsx`. The first replay was BAD (wrong reason): the assertion `document.documentElement.scrollWidth <= window.innerWidth` still passed on `/about` in both projects, and only the second assertion, the list of elements wider than the viewport, went red (`div.`). Read this as a fact about a div with no height, not as proof that the scroll-width clause is dead.
- cause: a div with no height adds no scrollable overflow in Chromium, so `scrollWidth` stays at the viewport width while the element is 2000 px wide. Nothing in `src` clips horizontal overflow at `html`, `body` or `main` (`git grep -n overflow -- 'app/src/**/*.css' 'app/src/**/*.tsx'` finds only component-level `overflow: hidden` and the modal's body lock), and the same div given a height of 10 px widens `scrollWidth` from 390 to 2000 on the phone. The plan words the overflow rule as two clauses (scroll width, and no element wider than the viewport outside an `overflow-x: auto` ancestor); the second sees an element of any height, the first only one that has height.
- rule: never reduce `expectNoOverflow` to either clause: the element list catches a flat element, the scroll width catches one with height. Word the `expect` of each watched-fail from the clause that goes red: (f) with the zero-height div goes red on `elements wider than the viewport`, and the scroll-width clause has its own mutation with a div that has height. The `@overflow` subset runs only with `E2E_TARGET=url` (the desktop and phone projects invert it otherwise), so (f) on a local run is proved by the main `/about` test, and the subset by `E2E_TARGET=url E2E_BASE_URL=<dev server> --grep @overflow`.
- proof: from `app/`, `MSYS_NO_PATHCONV=1 node scripts/watchfail.mjs --file src/routes/about.tsx --find '<main>' --replace '<main><div style={{ width: 2000 }} />' --run 'E2E_PORT=8808 bunx playwright test sweep.spec.ts --project=desktop --project=phone --grep " /about$"' --expect 'elements wider than the viewport'` prints `WATCHED-FAIL OK`; with `--expect 'document scroll width against the viewport'` it prints `WATCHED-FAIL BAD: wrong reason`; with `--replace '<main><div style={{ width: 2000, height: 10 }} />'` and `--expect 'document scroll width against the viewport'` it prints `WATCHED-FAIL OK src/routes/about.tsx` (measured 2026-10-03, B4 g3; the height form re-run in the follow-up record).
- added: 2026-10-03

## P-408 · B4 step 5's toggle proof and `serviceClient()` assume names and a table that `mop-dev` does not have on main yet
- symptom: `E2E_TARGET=built E2E_MODE=live bun run test:e2e:coming-soon` with the dev profile loaded printed `lock mop-dev-tests held` and then `error: reading coming_soon_global: Could not find the table 'public.settings' in the schema cache`. Before that, `serviceClient()` as the plan words it (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) throws on the laptop, because `scripts/load-env.mjs --profile dev` exports only `DEV_DB_URL`, `DEV_SUPABASE_PROJECT_REF`, `DEV_SUPABASE_DB_PASSWORD` and `DEV_SUPABASE_SERVICE_ROLE_KEY`.
- cause: the plan was written for a database with B2's `settings` table (a later B2 step, not on main) and for CI, which sets the plain names for its own stack. Other plans (B16, B9, B6) build the URL from `DEV_SUPABASE_PROJECT_REF` and read `DEV_SUPABASE_SERVICE_ROLE_KEY`.
- rule: `serviceClient()` reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` and falls back to `https://<DEV_SUPABASE_PROJECT_REF>.supabase.co` and `DEV_SUPABASE_SERVICE_ROLE_KEY`; it holds no host or project-ref guard (H35 (5)). A proof that needs a table another slice has not landed is reported UNPROVEN against `mop-dev` and run against a stand-in meanwhile: a throwaway HTTP server that answers PostgREST for `settings` (lane scratch, never committed) with `SUPABASE_URL` pointed at it and the real `DEV_DB_URL` for the lock. The real run is repeated when the table exists.
- proof: `cd app && eval "$(node scripts/load-env.mjs --profile dev)" && bun run db:psql -- -c "select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'settings'"` prints `0` (measured 2026-10-03, B4 g3); against the stand-in the run prints `lock mop-dev-tests held`, `coming_soon_global restored to false` and exits 1 (`No tests found`).
- added: 2026-10-03

## P-409 · Two sweep lines of the plan did not match what the site does: the first axe run is clean, and the image check above axe hides `image-alt`
- symptom: the plan assumes the first sweep run is not clean and that watched-fail (k) deletes a baseline entry that still occurs. The first full run of 106 tests had zero axe violations, so the baseline is `[]` and there is no entry to delete. Watched-fail (g) says the removed `alt` goes red as axe `image-alt`, but the explicit `img:not([alt])` assertion in the same test fails first and stops it, so axe never ran.
- cause: warm grey contrast was already fixed (G-013), and an assertion that throws ends a Playwright test. Also, axe reports a low-contrast paragraph only when its own background is set; with the page background it lands in `incomplete`, so a synthetic violation needs `color` and `background` both.
- rule: the structural checks of a route are `expect.soft`, so one run reports every problem and the scans after them still run. (k) is proved in three states by hand, with a synthetic `color-contrast` violation: no baseline entry (red, new violation), the entry present (green), the violation fixed with the entry left (red, stale entry); the registry entry `k` holds the last state. A watched-fail that needs a browser is `kind: "manual"` in `tests/mutations/B4.json`, because the CI `db` job replays every `file` entry a diff touches and has no browser; it is run by hand through `scripts/watchfail.mjs` with `--record`.
- proof: `cd app && bunx playwright test sweep.spec.ts --project=desktop --grep " /about$"` prints `1 passed` on a clean tree; with `<main><p style={{ color: "#f5f2eb", background: "#eeeae1" }}>x</p>` in `src/routes/about.tsx` it prints `axe: new violations on /about` and `"/about | color-contrast | main > p"` (measured 2026-10-03, B4 g3).
- added: 2026-10-03

## P-412 · A fixture that mirrors a contract breaks when main changes the contract under a lane
- severity: warn
- symptom: B4 c2 was proven green, then B2 step 5 reached main and replaced `agentName`, `agentEmail` with `submitterKind`, `submitterName`, `submitterEmail` (S55); after merging main, `bun run typecheck` failed with `tests/fixtures/builders.ts(31,5): error TS2353: 'agentName' does not exist in type 'SubmissionInput'`, and `contracts.test.ts` named `agentEmail` in a rejection case; the schema now strips that key and accepts the payload, so the row would have gone red with `[] expected ["agentEmail"]`.
- cause: `builders.ts` types its payload from `z.input<typeof submissionSchema>` and a string-keyed rejection table names fields by text; the type check catches the first, only the test run catches the second.
- rule: after every `git merge origin/main` in a lane that owns a fixture, run `bun run typecheck` and grep the tests for the renamed field names before `bun run check`. A rejection row that asserts `toEqual([field])` goes red on a stripped key; an acceptance check (`success === true`) is the kind that passes silently on one.
- proof: `cd app && git grep -n "agentName\|agentEmail" -- tests/fixtures tests/unit/contracts.test.ts` prints nothing (measured 2026-10-03, B4 c2).
- added: 2026-10-03

## P-413 · A cause written into the bank without running it was wrong, and the bank pushes it to later workers
- severity: warn
- symptom: P-412 said the stale `agentEmail` rejection row "would have gone green for the wrong reason" and that a rejection table naming a removed field "passes silently". The review of B4 c2 ran the case: the schema strips the unknown key, the payload parses, `issuePaths` returns `[]`, and the row asserting `toEqual([field])` goes red.
- cause: the cause line of P-412 was reasoned from how a schema treats an acceptance check and never run against the rejection table it describes; the rename and the proof were right, so the entry looked verified.
- rule: before a cause or rule line goes into the bank, run the smallest probe that shows it (a one-line `safeParse`, a failing test) and put that probe in the proof; a gotcha's cause is a claim and gets the same watched-fail as a test.
- proof: from `app/`, `printf 'import { submissionSchema } from "./src/domain/contracts";\nimport { validSubmission } from "./tests/fixtures/builders";\nconsole.log(submissionSchema.safeParse({ ...validSubmission(), agentEmail: "bad" }).success);\n' > zz-probe.ts && bun zz-probe.ts; rm zz-probe.ts` prints `true`: the stale field is stripped and accepted, so the row `toEqual(["agentEmail"])` sees `[]` and fails (measured 2026-10-03, B4 c2 review).
- added: 2026-10-03

## Retired, enforced

A test, hook or script now holds each of these rules; the full entry was deleted (its text is in git history before the gardening commit). The ids stay taken.

- G-003 · Page titles: pass the bare title, `pageHead` adds the suffix · enforced-by app/tests/unit/seo.test.ts
- G-005 · Routes never import bundled data directly · enforced-by app/tests/unit/boundaries.test.ts
- G-017 · Nitro appends its own rule to `public/_headers`, and a second block for one path replaces ours · enforced-by app/tests/unit/headers.test.ts
- G-022 · An API route file with no `GET` handler answers a `GET` with 200 and the empty page shell · enforced-by app/tests/unit/pipeline.test.ts
- G-023 · "Never throws" broke on the value, not the send: `String()` of a null-prototype object throws · enforced-by app/tests/unit/sentry.test.ts
- G-026 · The migration scan reads statements, not comments: every `-- down:` header names a drop · enforced-by app/tests/unit/check-migrations.test.ts
- G-027 · A workflow check that reads only job slices misses the workflow-level `env:` and `concurrency:` · enforced-by app/tests/unit/hygiene.test.ts
- G-028 · The migration scan is a small SQL lexer: a regex over raw text both misses DDL and flags words · enforced-by app/tests/unit/check-migrations.test.ts
- G-029 · A destructive-change scan that lists the kinds it refuses lets every other kind through · enforced-by app/tests/unit/check-migrations.test.ts
- G-030 · An exception to the destructive-change scan passes more than the statement the ruling meant · enforced-by app/tests/unit/check-migrations.test.ts
- G-032 · A file outside `app/` gets none of the app's gates: prettier finds no config, ESLint calls it outside its base path, tsc never sees it · enforced-by app/tests/unit/hygiene.test.ts
- P-004 · Mermaid syntax that breaks a render: `:::class` on a subgraph line, `;` in a sequence message or Note, a label that starts with `[/` · enforced-by workspace/03-diagrams/render.mjs · merged P-012
- P-031 · Plans invent names: every event, step and table in a plan must be a catalog name · enforced-by workspace/05-plans/check-plans.mjs
- P-104 · The merge gate refused every pull request with no check (ruling H42 (1)) · enforced-by app/tests/unit/merge-gate.test.ts

## P-504 · A build agent answers the operator's last chat message instead of doing its task
- symptom: a builder launched right after the operator asked a question in chat returned status blocked with "The user did not ask for a build. They asked a question", built nothing, and the whole run ended after 13 seconds.
- cause: the harness relays the session's latest user message into every subagent's context as "the user's request"; when that message is a question or a remark, the agent takes it as its instruction and the computed task as secondary.
- rule: the workflow's standing rules tell agents that a relayed chat message is addressed to the orchestrator and that the task text is the operator's standing order (his go). Launch runs right after an instruction when you can, and read a run's first result when it ends in seconds.
- proof: run `wf_6e66a398-a29`: `agent_count 1`, `duration_ms 12711`, builder result `blockedOn: "The user did not ask for a build..."`.
- added: 2026-10-03
