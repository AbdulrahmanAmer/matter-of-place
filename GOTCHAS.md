# GOTCHAS — the bank of things that already cost us time

Purpose: never re-discover a fix, never re-break a thing that works. Every entry names the paths it protects, what
went wrong, why, the rule, and how to prove the rule still holds. `.claude/hooks/gotcha-guard.mjs` reads this file
before every Edit or Write and pushes the matching entries into the session (severity `block` refuses the edit;
`warn` injects the entry as context). Entries without a `paths:` line are process gotchas and are never injected;
they are read by `mop-work` at session start.

Rules for the bank itself
- Numbers are unique and never reused: before adding, `grep -c "^## P-" GOTCHAS.md` and take the next free number (the highest number in the file plus one; P-019 and P-020 were never used and stay unused). `node workspace/05-plans/check-gotchas.mjs` fails on a number used twice, on an entry without rule, proof or added, and on a path entry without paths or severity: run it after every change to this file. Duplicates from parallel workers get renumbered by the orchestrator, never silently merged.
- Add an entry in the same turn something costs more than a few minutes or breaks after a push (CLAUDE.md). Do not wait for a retro.
- Keep it under 40 live path entries (G entries without `enforced-by:`; there are 15 today). Process entries (P) are not injected, every worker reads them once, so each one must still be true: when the thing it describes is gone, shrink it to a retired line and keep the number. When one is covered by a test or a hook, mark it `enforced-by:` and it stops being
  injected (the mechanism enforces it, the prose just documents it).
- One `paths:` line, comma separated, project-relative globs (`**` and `*`). Severity is `block` only when an edit
  is never legitimate; otherwise `warn`.
- `proof:` is a command and the output that shows the rule holds. No proof, no entry.

Read this first if you are about to build (2026-10-02)
- Where a file goes, the 60 rules and what a machine checks: `workspace/05-plans/STANDARDS.md`. Rulings that overrule plan text: `workspace/05-plans/ASSUMED.md` section H. Measured facts about this machine: section E.
- Your tree: a lane is a git worktree outside this folder (P-051); two workers never share one tree (P-011); a stale branch is checked before use (P-022).
- The database: never Docker here (P-038); only `main` reaches `mop-dev` once lanes are open (P-050); migrations are the only schema (G-010); names change in three files together (G-004).
- Secrets: never printed, never in a `VITE_*` name (G-006); how one gets into `.env` unseen (P-055); account-wide tokens are the operator's (P-037).
- The shell on this machine: absolute paths (P-013); no leading `sleep`, bounded waits (P-046, P-027, P-014); Git Bash rewrites arguments that start with `/` (P-015, P-048) and mangles quotes in inline scripts (P-008: write the script to a file); search with `git grep`, never `grep -r` (P-049); line endings are LF and are checked with `git ls-files --eol` (G-008, P-057); `npx` can fail, use `bunx` (P-002).
- Rendering and images: Chrome with the GPU off for anything we commit or compare (P-052); frames eat disk (P-016); fixed UI is judged from viewport shots (P-021); the logo comes from `brand/`, never retyped (G-015, P-053).
- The site code: generated route tree never edited (G-001); routes read through `services` (G-005); tokens only, no hex (G-007); titles (G-003); contrast (G-013); no third-party request before consent (G-014).
- Delivery: workflows only at the repository root (G-012); no branch protection, so the merge gate is the rule (P-028, P-060); free-tier limits are hard walls (P-009, G-011); a cache key carries everything that changes the page (P-041).
- Outside services: Resend (P-054); Cloudflare and Zoho first-run quirks (P-034, P-035); a push can fail for a few seconds (P-033).
- Before you say done: run every proof again, three times when the claim is "nothing changes" (P-059); a rejected or timed-out call may have run (P-056); "unused" is a claim about the whole repository (P-039); a plan names real catalog names (P-031) and every capability traces to a file and a proof (P-043, P-044).

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

## G-003 · Page titles: pass the bare title, `pageHead` adds the suffix
- paths: app/src/lib/seo.ts, app/src/routes/index.tsx, app/src/routes/_site.index.tsx
- severity: warn
- symptom: home `<title>` renders "Matter of Place | Exceptional property. Properly considered. | Matter of Place".
- cause: `pageHead` only skips the " | Matter of Place" suffix when the title already ends with it; the home route passes a title that starts with the brand instead.
- rule: routes pass titles without the brand; `pageHead` skips the suffix when the title is the brand, starts with "Matter of Place | " or already ends with the suffix (fixed 2026-09-30, slice B1a).
- proof: `curl -s http://localhost:8080/ | grep -o "<title>[^<]*"` → exactly one "Matter of Place".
- enforced-by: tests/unit/seo.test.ts (`bun run test`, part of `bun run check`)
- added: 2026-09-30

## G-004 · Field names live in three files and must change together
- paths: app/src/domain/**, app/supabase/migrations/**
- severity: warn
- symptom: a field renamed in one place returns `undefined` in the UI or fails the Zod parse on the server with no type error.
- cause: `src/domain/*.ts` (camelCase) = API JSON = `schema.sql` columns (snake_case); the HTTP adapter has no mapping layer by design (ADR 0002).
- rule: change the domain type, the Zod contract and the SQL column in the same commit; grep the old name across all three before finishing.
- proof: `grep -rn "<oldName>" src/domain docs/database` → no hits.
- added: 2026-09-30

## G-005 · Routes never import bundled data directly
- paths: app/src/routes/**
- severity: warn
- symptom: a page keeps showing illustrative content after the API goes live because it bypassed the service boundary.
- cause: importing `src/data/*` in a route hard-wires local mode.
- rule: read through `src/lib/queries.ts` and `services`; the only allowed direct imports are `data/exposure.ts` and `data/faq.ts` (static marketing copy).
- proof: `grep -rln "from \"../data/" src/routes` → only files that import exposure or faq.
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
- rule: agent definitions are read at session start, so a new `.claude/agents/*.md` works from the next session. Inside a session, give a worker its model with the Agent tool's `model` field or a Workflow agent's `model` and `effort` options (both exist in this build, used all through 2026-10-02); the headless `claude -p` route with the brief piped on stdin is the fallback. A worker inherits nothing from the transcript: its brief names the files to read (GOTCHAS, the slice plan, STANDARDS, the spec sections).
- proof: `ls launch/producer-run.json` exists after the headless producer starts; in-session `Agent` with the new type fails until restart.
- added: 2026-09-30

## P-011 · Two workers, one working tree: a branching agent moves the whole tree
- symptom: `git branch --show-current` → `chore/remove-lovable` while the orchestrator still has uncommitted doc changes on "main"; anything committed now lands on the worker's branch, and `git add -A` by the worker sweeps the orchestrator's files into its PR.
- rule: commit and push main work BEFORE spawning any agent that branches; while a branching worker runs in this tree, check the branch before every commit and never `git stash` or checkout under it. Workers that run side by side each get their own git worktree outside this folder (P-051); the build's lanes are exactly that.
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

## P-042 · Stopping `wrangler dev` means stopping its parent `node` process: killing `workerd` only makes it respawn
- symptom: after a local cache test, port 8799 kept a listener. Killing the `workerd.exe` that held the port printed SUCCESS three times and a new `workerd` appeared each time.
- cause: `bunx wrangler dev` runs as a `node.exe` parent that restarts its `workerd` child. A background `wrangler dev` started with `&` from the Bash tool leaves that parent behind.
- rule: stop a background `wrangler dev` by its parent. In PowerShell: find `node.exe` or `bun.exe` whose command line contains `wrangler` and the port, stop those, then stop any `workerd`. Filter by process name so the command does not match and kill its own shell (that happened once in this project with a pattern match on the command line). Confirm with `Get-NetTCPConnection -LocalPort <port> -State Listen`.
- proof: after stopping two `node.exe` parents, `listeners on 8799: 0` and `workerd left: 0`.
- added: 2026-10-01

## P-043 · "Is the how documented for every automation" was answered from memory; the check found two steps with no code file
- symptom: the operator asked whether the plans say, in code terms, what makes each automation work. An audit of the 17 step types against the plans found that no plan named the step module for `render_variants` (B8b said B9 owns it, B9 said B2 owns it, B2 only had the image library) or for `render_og_static` (script named, step module not). Two more owners were ambiguous (`purge_cache` "B3 or B13", `build_newsletter_block` B11 in the table but B9 in the files). The project had been declared ready to build.
- cause: `check-plans.mjs` verified that step names were in the catalog, not that each catalog step had an implementing file in some plan. Ownership stated in two plans was never cross-checked.
- rule: an automation is documented when four things are named in a plan: the event that starts it, the recipe row (B8b seed), the step's code file `src/server/jobs/steps/<name>.ts`, and a proof command. `check-plans.mjs` now fails when a catalog step has no file named in any plan. Answer "is X covered" questions by running a check, not by describing the design.
- proof: `node workspace/05-plans/check-plans.mjs` prints OK; deleting the `render-variants.ts` line from B9.md makes it print `no plan names the code file of step render_variants`.
- added: 2026-10-01

## P-044 · "Ready to build" was declared from a gate that checked accounts and syntax, not whether the documents could be built from
- symptom: on 2026-10-01 the readiness gate printed `READY TO BUILD: yes` and the CTO session reported it. The operator did not believe it ("I felt that we were not ready to write the code for production") and asked how an automation would actually work in code. A full audit then found 1,152 gaps in the plans and spec in its first round: 299 contradictions between documents, 219 mechanisms described without the code that performs them, 104 things used and created by nobody, 96 with two owners, 88 with no proof, 67 with no code file.
- cause: the gate measured what was easy to measure (tokens, tools, secrets, a checker for catalog names and section headings). Nothing measured whether a builder holding only a plan would have to invent an owner, a file, a table or a mechanism, or whether two plans disagreed. Two earlier passes with Sonnet workers at medium effort had made the plans longer and more confident without closing that.
- rule (S53): a capability is documented only when a plan names what starts it, one owning slice, the code file, the data, the outside call, the failure path and a proof command. `workspace/05-plans/trace.json` lists every such item (1,100 and more) and `check-plans.mjs` fails when an item's plan stops naming its files, when a catalog step has no file, or when a slice is missing from the completion map. "Is it covered" and "are we ready" are answered by running `node workspace/05-plans/ready.mjs --full`, never from memory. Completeness audits run on Opus at high effort (operator's instruction); a cheaper pass that returns "all consistent" is a claim, not a result.
- proof: `node workspace/05-plans/check-plans.mjs` prints OK with the trace enforced; the six audit rounds found 1,152, 1,191, 306, 150, 99 and 42 gaps.
- added: 2026-10-01

## P-045 · An audit that fixes as it goes does not converge by itself: it needs rulings between rounds and a tighter bar each round
- symptom: round two of the traceability audit found more gaps (1,191) than round one (1,152). The writers, one per document, could not decide anything that touched another document, so they passed 149 questions up and each fixed its side of a contradiction differently.
- cause: with one writer per file, a disagreement between two files has no owner. Left alone, every round re-reports it and every fix adds text that can disagree somewhere else.
- rule: stop the workflow when a fix round ends; read what the writers passed up; write rulings in `ASSUMED.md` section G that name every document they bind; resume from the cached run so finished work is not repeated (add new prompt text only for later rounds, and prove the earlier prompts are byte-identical before resuming). Tighten the bar every round: by round three report only what would make a builder guess or contradict; in the last round only blockers. Give later auditors the earlier writers' notes about other documents as unverified claims. Expect several hours and about two hundred agent runs for twenty-five documents; say so before starting.
- proof: after 65 rulings the rounds went 1,191, 306, 150, 99, 42; `rounds` in the workflow result lists them.
- added: 2026-10-01

## P-046 · Waiting on long background work from the Bash tool
- symptom: a command that began with `sleep 90` was refused ("To wait for a condition, use Monitor"); loops that ran past the tool's ten-minute limit were moved to the background and reported later, out of order; a `mermaid` render took over three minutes while seventeen agents were running and was moved to the background too.
- cause: the Bash tool blocks a bare leading `sleep` and caps a foreground call at ten minutes.
- rule: wait with a bounded loop that checks a condition (`for i in $(seq 1 50); do <check> && break; sleep 10; done`) and keep it under nine minutes; read progress from the workflow's `journal.jsonl` (count `started` and `result` lines by label). Render diagrams when no fan-out is running. The post-write hook reports "Illegal return statement" on a workflow script because the script body is not a module: verify such a script by wrapping it in an async function, not with `node --check`.
- proof: this session's polls; `new Function(... 'return (async()=>{' + script + '})')` parses the workflow script that `node --check` rejects.
- added: 2026-10-01

## P-047 · A deadline was answered with a smaller scope, recorded as decided
- symptom: the operator set a 48-hour go-live; the orchestrator wrote a "launch cut" into PROJECT-STATE S54 and PLAN.md that deferred social, newsletter, reels, the money box and the audit robot. The operator: "we are not cutting anything we are getting it all built in 48 hours". The records had to be rewritten and pushed again.
- cause: time pressure was treated as a reason to shrink the work instead of changing how it runs; a CTO recommendation was written down as a decision.
- rule: scope belongs to the operator. Under a deadline the first move is orchestration (parallel lanes, worktrees, more workers), never a cut. A cut may be recommended in one sentence; it is recorded only after the operator says yes. State what is UNPROVEN about fitting the time.
- proof: `grep -c "48-hour full build" workspace/05-plans/PLAN.md` prints 1 and `grep -c "launch cut" workspace/05-plans/PLAN.md` prints 1 (the line that says it was withdrawn).
- added: 2026-10-02

## P-048 · `gh api` with a leading slash under Git Bash, and the billing API
- symptom: `gh api /users/<login>/settings/billing/usage` answered `invalid API endpoint: "C:/Program Files/Git/users/..."`; without the slash it answered HTTP 404 "This API operation needs the user scope".
- cause: Git Bash rewrites an argument that starts with `/` into a Windows path; the billing endpoints need the `user` scope, which this `gh` login does not have and only the operator can add (`gh auth refresh -s user` is interactive).
- rule: write `gh api` endpoints without the leading slash. Measure Actions minutes from the repository API instead: `gh api repos/AbdulrahmanAmer/matter-of-place/actions/runs --paginate` and sum the run durations (ASSUMED section H, ruling DO-08).
- proof: both outputs above, 2026-10-02.
- added: 2026-10-02

## P-049 · `grep -r` from the repository root runs into node_modules and times out
- symptom: a `grep -rl ... .` at the root did not finish inside the two-minute tool limit and was moved to the background.
- cause: `app/node_modules` and `launch/node_modules` hold tens of thousands of files; `--include` does not stop the directory walk.
- rule: search tracked files with `git grep -I` (or the Grep tool). Never `grep -r` from the root.
- proof: `git grep -c "08-visual-pass"` returns at once.
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

## P-064 · A patch script wrote the file first and checked it second, and left the build workflow broken on disk
- symptom: a script that edits `.claude/workflows/build-slice.js` inserted text with backticks into a template literal, wrote the file, and only then ran the parse check, which threw `SyntaxError: Unexpected identifier 'node'`. The chain stopped, but the broken file was already in the working tree, and the commands after the `;` still ran (a pull request with no commit, a branch delete).
- cause: write before validate; a backtick inside a template literal must be written `\``; an `&&` chain followed by `;` keeps going after the failure.
- rule: a patch script builds the new text in memory, validates it (parse, anchors found, checker), and writes last. Text that lands inside a template literal escapes its backticks and every `${` it does not mean. After a patch fails, look at `git status` before anything else and restore with `git checkout -- <file>`. Never put cleanup or merge commands after a `;` behind a chain that may fail.
- proof: `git status --short` showed ` M .claude/workflows/build-slice.js` after the failure; after `git checkout -- .claude/workflows/build-slice.js` the parse check passed.
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
- proof: `cd app && bun run knip | grep -c "Configuration hints"` prints `1` today and `0` once `start.ts` and `supabase/functions/job-runner/index.ts` exist and the `ignore` and `router.tsx` lines are trimmed.
- added: 2026-10-02

## P-066 · A watched-fail registry entry must be one the owning runner can replay: no invented kind, no empty `find`
- symptom: 16 of the 20 entries first written for `tests/mutations/B1b.json` used an invented `kind: "create"` with `"find": ""`. B4's `scripts/watchfail.mjs` (B4.md line 86) reads the file and asserts `find` occurs exactly once, and `mutation-registry.test.ts` rejects a file entry without a usable `find`, so none of them could be replayed.
- cause: the plan's mutations say "a scratch file", and the author recorded them literally instead of expressing them in the runner's two kinds.
- rule: every entry is a `file` entry on a tracked file with a `find` that occurs exactly once (a mutation that needs "a new file" edits an existing file inside the same lint scope), a `sql` entry, or `kind: "manual"` (recorded, not replayed). A rule whose scope has no tracked file yet (R14 in `src/server/**`) is `manual` until the first file of that scope lands. Replay the whole registry with a runner that checks the single occurrence before it trusts a result.
- proof: `cd app && node -e "const a=require('./tests/mutations/B1b.json');console.log(a.filter(e=>e.kind==='create'||e.find==='').length)"` prints `0`.
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

## P-070 · A Bash heredoc that carries a script or an edit drops its backslashes: `\|` becomes `|`, and the file is written wrong without an error
- symptom: a Node fix script written inline with a quoted heredoc (`<<'EOF'`) turned the Markdown table escape `\\|` into `|` in six table cells, which split each cell in two. The registry rework of B1b g2 (regex and path text with backslashes) was lost the same way. P-008 names single-quoted arguments; this is the same collapse inside a heredoc, where it is easier to believe the quoting protects the text.
- cause: the Bash tool on this machine rewrites backslashes before the shell sees the command, so a quoted delimiter does not preserve them.
- rule: any text that contains a backslash (Markdown table escapes, regular expressions, Windows paths, JSON `\\n`) goes in with the Write or Edit tool, never through a heredoc or an inline script. After a scripted rewrite of such a file, read back the changed lines (`git diff`) before trusting it.
- proof: `git grep -n -F '\|' -- workspace/01-site-index/content-inventory.md | grep -c 'Estate'` → 1 (the `type` row keeps its escapes); the same row written through a heredoc printed `"Estate" | "Residence"` with no backslash.
- added: 2026-10-02

## P-071 · A relative redirect from `app/` wrote a scratch file outside the worktree
- symptom: a builder in the lane redirected a check's output to `../../scratch-check.txt` from `E:/mop-build/spine/app`; the file landed in `E:/mop-build/`, outside the repository, and the builder's `rm` was refused there. The reviewer found it on disk.
- cause: `../..` from `app/` is the lane's parent folder, not the lane. Nothing under git sees a file there, so no gate catches it.
- rule: a scratch file goes to the session scratchpad or under a path the lane's `.gitignore` covers, never to a relative path that climbs out of the lane. A lane writes nothing outside its own folder. The orchestrator checks `ls E:/mop-build/` after every group: it holds lane folders only.
- proof: `ls /e/mop-build/` prints `spine` and nothing else.
- added: 2026-10-02

## P-072 · Merging main into a lane: both sides append to the bank, the merge conflicts, and a shared last line goes missing
- symptom: `git merge origin/main` on `slice/b1b` stopped with a conflict in `GOTCHAS.md` only. Keeping both sides left entry P-064 without its `- added:` line: git had treated the identical last line of both sides as common text and placed it after the conflict block, so it stayed with the lane's last entry.
- cause: main and the lane each append entries at the end of the same file, and every entry ends with the same `- added: <date>` line.
- rule: while one lane is open, the orchestrator adds its own bank entries on the lane's branch, not on main. When a merge does conflict in the bank, keep both sides (main's entries first), then run `node workspace/05-plans/check-gotchas.mjs` before committing: it names the entry that lost a line or a number used twice. Lanes take the next free number above the highest in both copies. History is never rewritten: bring main into a lane with a merge commit, never a rebase of pushed commits.
- proof: after the merge `node workspace/05-plans/check-gotchas.mjs` printed `ERROR P-064: no added`; after restoring the line it printed `check-gotchas: OK (16 path entries, 69 process entries)`.
- added: 2026-10-02

## G-017 · Nitro appends its own rule to `public/_headers`, and a second block for one path replaces ours
- paths: app/public/_headers
- severity: warn
- symptom: B1b step 3 said "Nitro copies the file unchanged" and proved it with `cmp public/_headers .output/public/_headers`. The build prints "Adding Nitro fallback to _headers" and appends `/assets/*` with `cache-control: public, max-age=31536000, immutable`, so the compare exits 1. With our own `/assets/*` block holding the security headers, `curl -I` on `/assets/<file>.js` under `wrangler dev` showed only Nitro's Cache-Control and none of the security headers.
- cause: the Cloudflare preset's `writeCFHeaders` appends the route-rule headers after the file unless a line matches `^/\* ` (a slash, a star and a space; the Write tool and editors strip that trailing space, so the bypass cannot be kept). A second block for the same path won as a whole (observed under wrangler 4.145.0; the mechanism is inferred, not read).
- rule: the security headers live in a `/*` block, a path Nitro does not use; `/media/*` carries `Cache-Control` only, so no header repeats. `public/_headers` holds no `/assets/*` block at all: Nitro appends one (`public, max-age=31536000, immutable`) and, measured 2026-10-02, a block of ours for the same path is dead text (our value set to `max-age=3600` in the built file, the served asset still answered `max-age=31536000, immutable`). Prove the copy with a prefix compare, never a full one.
- proof: after `bun run build`, `cmp -n "$(wc -c < public/_headers)" public/_headers .output/public/_headers; echo $?` → 0; `bunx vitest run tests/unit/headers.test.ts` goes red when a block for `/assets/*` is put back (registry entry `k-assets`) or a security header is moved out of `/*`.
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

## P-076 · `vi.spyOn(console, method)` over a union of methods gives the implementation an `any` parameter and the lint refuses it
- symptom: `vi.spyOn(console, method).mockImplementation((line) => { lines.push(line); })` inside `for (const method of METHODS)` fails `bun run lint` with `Unsafe argument of type any assigned to a parameter of type string  @typescript-eslint/no-unsafe-argument`; the first version of `log.test.ts` and `pipeline.test.ts` were written that way and both had to be rewritten.
- cause: spying on a union of keys picks no single overload, so the callback's parameters are `any`.
- rule: annotate the parameter `(line: unknown)` and convert with `String(line)`; type a `vi.fn` by its signature (`vi.fn<PipelineContext["waitUntil"]>()`), never with a bare `vi.fn()` assigned to a typed member. Run `bun run lint` on a new test file before the first full check.
- proof: a scratch `tests/unit/` file with `vi.spyOn(console, method).mockImplementation((line) => { lines.push(line); })` in a loop over `["log", "warn", "error"] as const` → `bunx eslint --max-warnings 0 <file>; echo $?` prints the `no-unsafe-argument` error and `1`; `bunx eslint --max-warnings 0 tests/unit/log.test.ts` → exit `0`.
- added: 2026-10-02

## P-077 · A plan pins one tool version while `bunx` resolves another, depending on the folder
- symptom: B1b step 3 pins wrangler 4.145.0 (E11), yet `bunx wrangler --version` printed 4.146.0 in an earlier session, and the group's gate was written for 4.145.0.
- cause: `bunx` uses the dependency of the folder it runs in; outside `app/` there is none and it fetches the newest release. The runbook was the only place that said which one is pinned.
- rule: an exact version goes into `devDependencies` and the runbook table names it; every plan command that runs the tool starts in `app/`. A mismatch between the plan's number and what a clean resolve gives is recorded in the runbook and in this bank, and the pin moves only through Dependabot with the proofs re-run.
- proof: `cd app && bunx wrangler --version` → `4.145.0`; the same command in an empty scratch folder → `4.146.0` (2026-10-02).
- added: 2026-10-02

## P-078 · A plan's response shape can contradict STANDARDS: STANDARDS binds, and the plan line gets fixed
- symptom: B1b step 3 and step 4 give the calm 500 as `{"error":{"code":"server","requestId":"..."}}`; STANDARDS R09 and B3 line 42 require `{ error: { code, message, issues?, requestId } }`. The first build followed the plan and a reviewer rejected it.
- cause: the plan line was written before R09 and was not brought into line with it.
- rule: a body shape is checked against R09 before it is written; where the plan is shorter than the standard, build the standard (here `message` was added: `Something went wrong. Please try again in a moment.`), and tell the orchestrator which plan lines are stale (B1b lines 126 and 176).
- proof: `git grep -n "code: \"server\"" -- app/src/server/lib/pipeline.ts` → the object with `message`; `bunx vitest run tests/unit/pipeline.test.ts` passes `answers JSON for an API path, a write, or a client that does not accept HTML`, and registry entry `u-message` turns it red.
- added: 2026-10-02

## P-079 · A group that adds tests must own `tests/mutations/<slice>.json`, and a missing registry entry is not "done"
- symptom: the first step 3 report said "done" while its three test files had no entry in `tests/mutations/B1b.json` (R49, C08); the 17 mutations lived in a scratch spec outside the repository and could not be replayed. The same report left knip's `src/start.ts` configuration hint (P-065) because `knip.json` was not in its file list.
- cause: the group's file list was copied from the plan's file lines, which do not name the registry or `knip.json`.
- rule: a group's file list for a step that adds a test includes `tests/mutations/<slice>.json`, and one that creates a file knip reported as "no matches" includes `knip.json`. A watched-fail that is not yet a registry entry makes the status `partial`, never `done`. Entries are written in the registry's format and replayed by a runner that asserts `find` occurs once.
- proof: `git grep -c "tests/unit/pipeline.test.ts" -- app/tests/mutations/B1b.json` → at least `1`; `cd app && bun run knip | grep -c "src/start.ts"` → `0`.
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

## P-081 · A registry entry written from memory does not match: prettier rewrites the `find`, vitest words and truncates the `expect`
- symptom: in B1b g4 three entries of `tests/mutations/B1b.json` failed their replay although the mutation was right. One `find` held the non-2xx log line of `sentry.ts` on one line, but prettier had split it over two, so it occurred zero times. One `expect` said "not to have property"; vitest prints `to not have property "request"`. In the fix round a case named `... X-Sentry-Rate-Limits header whose longest window is 120 seconds` went red for the right reason and still failed the replay: vitest printed `... header whose lo…`, cut at about 80 characters, in both the `×` line and the `FAIL` line.
- cause: `find` was copied from the code as typed, not from the file after `prettier --write`; `expect` was copied from the test title or from memory, not from the runner's output, and vitest shortens long test names when the output is not a wide terminal.
- rule: run `bunx prettier --write` on the changed files before writing any `find`, and take `find` from the file on disk. Take `expect` from the red run's real output. Keep a test title under about 75 characters, or match only its first words. Replay every new entry with a runner that asserts `find` occurs once and the output matches `expect` before you call it watched-fail.
- proof: `cd app && bunx vitest run tests/unit/sentry.test.ts` with the rate-limits parse replaced by `return 60;` prints `× pauses every send for the window named by an X-Sentry-Rate-Limits header whose lo…` with the old title; with the title `X-Sentry-Rate-Limits 30 and 120` the replay of entry `sentry-rate-limits` prints `RED sentry-rate-limits: exit=1 expect=true`.
- added: 2026-10-02

## P-082 · Lint refuses `JSON.parse` results and string rejections in tests, not only console spies
- symptom: the first lint run of `tests/unit/sentry.test.ts` failed on values read from `JSON.parse` and on a fake fetch that rejected with a string. P-076 names only `vi.spyOn(console, method)` over a union, so it did not warn about either.
- cause: `JSON.parse` returns `any`, so any use of it trips `no-unsafe-assignment` and `no-unsafe-member-access` (strictTypeChecked); `Promise.reject("text")` trips `prefer-promise-reject-errors`. Tests are linted with the same type-aware rules as `src`.
- rule: in a test, parse JSON into `unknown` (`const parseJson = (text: string): unknown => JSON.parse(text)`) and read it through a Zod schema; reject only with an `Error` (`Promise.reject(new TypeError("network down"))`). Run `bunx eslint --max-warnings 0 <new test file>` before the first full check.
- proof: a scratch `tests/unit/zz-scratch.test.ts` holding `const parsed = JSON.parse('{"a":1}'); expect(parsed.a).toBe(1);` and `await expect(Promise.reject("plain text")).rejects.toBe("plain text");` → `bunx eslint --max-warnings 0` prints `no-unsafe-assignment`, `no-unsafe-member-access` and `prefer-promise-reject-errors`, exit 1 (measured 2026-10-02); `bunx eslint --max-warnings 0 tests/unit/sentry.test.ts` → exit 0.
- added: 2026-10-02

## G-021 · A new route file fails the typecheck until a build regenerates the route tree
- paths: app/src/routes/**
- severity: warn
- symptom: `bun run check` failed on a new `src/routes/api/hooks/sentry-test.ts` with `Argument of type '"/api/hooks/sentry-test"' is not assignable to parameter of type 'keyof FileRoutesByPath | undefined'`, although the file was right. A `bun run build` made it pass.
- cause: `createFileRoute(path)` is typed by `src/routeTree.gen.ts`, which only the router plugin writes, during `vite build` or `vite dev` (G-001). `bun run check` runs `tsc` first and never runs the plugin.
- rule: after adding, renaming or deleting a route file, run `bun run build` (or have `bun run dev` running) before `bun run check`, and commit the regenerated `src/routeTree.gen.ts` with the route. Never edit the generated file to make tsc pass.
- proof: a scratch `src/routes/api/hooks/zz-scratch.ts` with `createFileRoute("/api/hooks/zz-scratch")` → `cd app && bunx tsc -p tsconfig.json --noEmit` prints that TS2345 error and exits 2 (measured 2026-10-02); deleting the file restores exit 0.
- added: 2026-10-02

## P-083 · A plan's "the route file does X" line can contradict R11 and the folder map: check where a file's logic goes before writing it
- symptom: B1b line 131 puts the bearer check of `sentry-test` in the route file; the first g4 build followed it. STANDARDS R11 and the folder-map row `src/routes/` say an API route file is one wrapper line. The fix round moved the logic to `src/server/hooks/sentry-test.ts` and rewrote the route, its test imports and six registry entries. P-078 covered body shapes only, so it gave no warning.
- cause: plan file lines were written before STANDARDS; a builder reads the plan's file line as the file's content.
- rule: before writing any file a plan names, check its line against the folder map (STANDARDS section 1) and R11 as well as R09 (P-078): an API route file holds one wrapper line, its logic goes to `src/server/<domain>/<name>.ts` (`hooks/` for `api/hooks/*`, as B3's `hooks/resend.ts` and B8's `hooks/ops-health.ts`). STANDARDS binds; name the stale plan line to the orchestrator in the slice log.
- proof: `git grep -c "" -- app/src/routes/api/hooks/sentry-test.ts` → `11` (definition, one STUB line, one handler line, no logic); `git grep -n "timingSafeEqual" -- app/src/routes` → nothing.
- added: 2026-10-02

## P-084 · Five plans call `captureException` without the options it really takes
- symptom: `captureException(error, options)` needs `dsn`, `requestId`, `route`, `env` and `release` (`sentry.ts` reads no environment, R14). B3.md:89 and :95, B17.md:16, B8b.md:127 and B8.md:124 give shorter shapes or call `dsn` optional and new. Recorded only in the B1b log until a reviewer asked for it here.
- cause: the plans were written against the plan's signature, which had no `dsn`; the built signature added it.
- rule: a slice that reports to Sentry passes all five keys; read the signature from `app/src/server/lib/sentry.ts` (`CaptureOptions`), never from a plan line. `tsc` refuses a missing key, which is the safe failure; do not make a key optional to fit a plan line.
- proof: `git grep -n "dsn: string | undefined;" -- app/src/server/lib/sentry.ts` → one line in `CaptureOptions`; a scratch `tests/unit/zz-scratch.ts` calling it without `dsn` → `cd app && bunx tsc -p tsconfig.json --noEmit` prints `TS2345 ... Property 'dsn' is missing in type ... but required in type 'CaptureOptions'` and exits 2 (measured 2026-10-02).
- added: 2026-10-02

## G-022 · An API route file with no `GET` handler answers a `GET` with 200 and the empty page shell
- paths: app/src/routes/api/**
- severity: warn
- symptom: under `cf:preview`, `curl -s -D - http://127.0.0.1:8788/api/hooks/sentry-test` (a POST-only route) → `HTTP/1.1 200 OK`, `Content-Type: text/html; charset=utf-8`, 6807 bytes of app shell; `/api/hooks/nothing-here` → 404. A route meant to be inert is not.
- cause: the file is also a router route; a method with no server handler falls through to the SSR render, which finds the route and renders it with no component (TanStack behaviour, inferred from the answers, not read in the source).
- rule: every API route file is reachable by `GET`; a POST-only hook must not depend on `GET` being a 404. Which owner makes non-handled methods answer an R09 405 or 404 (the pipeline or one wrapper every API route uses) is a ruling for the orchestrator; until then each new API route's smoke or test states its `GET` answer.
- proof: `bun run build && bun run cf:preview`, then `curl -s -o /dev/null -w "%{http_code} %{content_type}" http://127.0.0.1:8788/api/hooks/sentry-test` → `200 text/html; charset=utf-8` (2026-10-02).
- added: 2026-10-02

## G-023 · "Never throws" broke on the value, not the send: `String()` of a null-prototype object throws
- paths: app/src/server/lib/sentry.ts
- severity: warn
- symptom: `captureException(Object.create(null), opts)` rejected with `TypeError: Cannot convert object to primitive value`; a throwing `message` getter and a proxy whose `getPrototypeOf` throws (so `instanceof` throws) rejected too. In the Worker the rejection lands in `waitUntil` and the event is lost; the fingerprint was already recorded, so the next 60 s of the same failure were dropped. Every test threw an `Error`, so none saw it.
- cause: `String(value)`, `error.message` and `value instanceof Error` all run user code; the try around the fetch did not cover building the event.
- rule: a function promised never to throw reads the thrown value inside its own try (`describeThrown` in `sentry.ts`, fixed text `unprintable value`) before it records anything, and its tests throw a null-prototype object, a throwing getter, a proxy and an Error whose `name` is not a string.
- proof: `cd app && bunx vitest run tests/unit/sentry.test.ts` passes; registry entries `sentry-unprintable` and `sentry-non-string` turn it red (`promise rejected "TypeError: Cannot convert object to primi…" instead of resolving` before the fix).
- added: 2026-10-02
