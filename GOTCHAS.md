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
10. One database: only `main` changes `mop-dev` (P-050); db tests and `scripts/dev-vars.mjs` load the dev profile and run under `env -u CLOUDFLARE_API_TOKEN` (P-310); an unmerged migration is proved inside rolled-back transactions (P-312).

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
- paths: app/src/domain/**, app/supabase/migrations/**, app/src/db/types.ts
- severity: warn
- symptom: a field renamed in one place returns `undefined` in the UI or fails the Zod parse on the server with no type error; an enum value added in a migration is missing from `contracts.ts` (the sketch's `Awaiting Payment` and `editorialRoles` outlived the schema).
- cause: `src/domain/*.ts` (camelCase) = API JSON = the columns of `supabase/migrations` (snake_case) = the generated `src/db/types.ts`; the HTTP adapter has no mapping layer by design (ADR 0002).
- rule: change the migration, the regenerated types, the domain type and the Zod contract in the same commit. Every enum a domain list mirrors is a pair in `src/domain/enums.check.ts`; a new enum or list adds its pair there.
- proof: `cd app && bun run gen:types && bun run typecheck` exits 0, and after a value is added to `submission_state` in `src/db/types.ts` it fails in `src/domain/enums.check.ts` (`Type 'false' does not satisfy the constraint 'true'`); `grep -rn "<oldName>" src` → no hits.
- enforced-by: src/domain/enums.check.ts
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
- hit again: 2026-10-03, B9 g4: backslashes were dropped from text written through a heredoc, so the file had to be rewritten with the Write tool; the author listed it as a cost but the entry was not extended (recorded by the g4 review follow-up).
- hit again: 2026-10-03, B2 g11: registry `expect` regexes with `\[` written through a Bash heredoc lost their backslashes, so `["--target","prod"]` became a character class and three entries replayed `BAD: wrong reason`; fixed by writing `.` for the bracket in the `expect` (no backslash needed). Proof: `grep -c 'refuses .\\"--target' app/tests/mutations/B2.json` prints 1.
- hit again: 2026-10-03, B2 g11 (second attempt cost): a heredoc whose text held an apostrophe ended in `unexpected EOF` and wrote nothing, and a patch script that ran a `rm` of a path it had just made was refused by the safety check; the file went in with the Write tool instead.
- hit again: 2026-10-04, B5 g1: a heredoc turned a backslash-s in a regex template literal into a plain s, so `tokenOf` returned undefined and four theme cases went red for the wrong reason; fixed with the Edit tool. The same call style failed again on the P-1200 rewrite (`eval: syntax error near unexpected token`).
- hit again: 2026-10-04, B5 g1 review: quoting the heredoc delimiter (`<<'EOF'`) does not protect backslashes in this harness. A scratch watchfail registry written that way lost the backslashes on some lines (a find holding two backslashes before a brace arrived with one) while another line of the same heredoc kept its doubles, and watchfail died with `Bad escaped character in JSON at position 463`. Choose find and replace strings with no backslash, or write the registry with the Write tool. Proof: the entry's own proof reproduces it, a quoted heredoc writing a run of backslashes into a file, then `od -c` on that file shows fewer backslashes than were typed.
- merged: P-070, P-111, P-115, P-309, P-406
- hit again: 2026-10-03, B3 g1: a `node -e` patch of the mutation-registry generator lost its backslashes (`
` became a real newline inside a string literal) and the script died with `SyntaxError: Invalid or unexpected token`; the two lines were fixed with the Edit tool.
- hit again: 2026-10-03, B3 g2: a `node -e` that patched two registry entries of a scratch generator searched for text with `\n` escapes, which arrived as real newlines, so its count check threw `x sql("b3-zz", ...` and nothing was written; the two lines were changed with the Edit tool.
- hit again: 2026-10-04, B3 g3: three times in one group (a `sed` with `\n` in the replacement, a `node -` patch with a regular expression, a heredoc with an apostrophe in a test title) the text lost its backslashes or ended in `unexpected EOF`; each was redone with the Write or Edit tool, and a `sed` that had written a literal line break into a string broke the file's parse.
- hit again: 2026-10-04, B3 g4: a registry entry's `expect` written through `node` in a Bash heredoc lost its backslashes (`track\(\) call` became `track() call`, a regex that matches nothing), so the replay printed `BAD: wrong reason`; the fix went in with the Edit tool.
- hit again: 2026-10-04, B3 g5: a heredoc holding a test file with backticks and apostrophes ended in `unexpected EOF` and wrote nothing; the file went in with the Write tool.
- hit again: 2026-10-04, B3 g5 repair: a `node -e` that was meant to write `\r` into the bank wrote a real carriage return byte, so P-310's hit-again line read `tr -d ''` in the rendered text and was found by a reviewer, and the second attempt failed the same way through the shell. A bank edit that holds a backslash goes in with the Edit tool; check afterwards. Proof: `node -e "console.log(require('fs').readFileSync('GOTCHAS.md','utf8').includes(String.fromCharCode(13)))"` from the tree root → `false`.
- hit again: 2026-10-04, B16 g1: a registry generator written through a Bash heredoc lost the backslash of `/\d/`, so the entry replayed `STALE: find occurs 0 times`; fixed with the Edit tool.
- hit again: 2026-10-04, B14 g1: a `node -` patch fed from a heredoc wrote a code line whose escaped newline became a real line break, so `cache.mjs` stopped parsing and vitest printed `Failed to parse source for import analysis`; a second patch of the same kind failed on a `rep` anchor that held a `\n`. Edit code with the Edit tool or a Write-made script file. Proof: `grep -n 'join("' workspace/audits/tools/cache.mjs` shows the newline escape inside its string literal.
- hit again: 2026-10-04, B3 g6: a quoted heredoc (`cat >> logs/B3.md <<'EOF'`) holding a log block with apostrophes and backticks ended in `unexpected EOF while looking for matching` and wrote nothing; the block went in through a Write-made file and `cat`, and a `sed` over a Write-made script missed its target because the file held escaped backticks.
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
- hit again: 2026-10-03, B3 g1: stopping the built Worker on port 8828 took four `taskkill` calls because killing the listener's process id left the respawning `node.exe` parent; the group's log banked the cost under P-094 (python), which is the wrong entry. The review found it.
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
- hit again: 2026-10-03, B3 g1 review: a recursive `grep -rnE` over `app/` without `--exclude-dir` for `node_modules` and `.output` ran past the 120 s limit; the Grep tool with a glob answered in seconds.
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
- rule: every entry is a `file` entry on a tracked file whose `find` occurs exactly once (a mutation that needs a new file edits an existing file inside the same lint scope), a `sql` entry, or `kind: "manual"` (recorded, not replayed; also for a rule whose scope has no tracked file yet, and for a watched-fail that needs a browser). Run `bunx prettier --write` before writing a `find` and take it from disk. Take `expect` from the red run's output; it is a regular expression (escape `.`, `*`, `?`, `(` or end before them) that matches only text the failure prints (the `×` line, the error line, prettier's `[warn]` line) and nothing in the unmutated run's stdout and stderr. Keep a test title under about 75 characters and an `it.each` row name at 40 or fewer, or match only their first words. The runner is `node scripts/watchfail.mjs` (B4): `--registry tests/mutations --only <id>` (exactly one id per call; a comma list matches nothing and prints `no entry with id ...`, so loop over the ids in one shell call) replays entries and exits 2 with `STALE` on a `find` that does not occur once; after every edit of a file the registry mutates, replay its entries before the commit, rewrite a moved entry and replay it red; keep a mutated line's text stable when the change need not touch it; after each slice lands, replay every registry and fix the entry, not the test. A mutation that needs "absent from main" names a value that can never be present (`20261001090199`). A `find` inside a registry holds double quotes (stored escaped in the entry, so it does not match itself), and a watched-fail that removes a file's entry picks a file only one entry names. List the ids before adding one; a taken plan letter becomes a prefix (`bm-page-refusal`); never reuse or rename an id. Anchor an Edit of an entry on its `"id"` or `replace` line, never on its `expect`. `tests/unit/mutation-registry.test.ts` (in `bun run check`) holds the entry shape, one id per registry and every test file named by an entry.
- proof: `cd app && bunx vitest run tests/unit/mutation-registry.test.ts` passes; `node scripts/watchfail.mjs --registry tests/mutations --only z` prints `WATCHED-FAIL OK B4:z`, and with the `test` of `y-lint` changed to `tests/unit/seo.test.ts` it prints `STALE B4:z: find occurs 2 times in tests/mutations/B4.json` and exits 2 (2026-10-03, restored); `bun run format:check 2>&1 | grep -c "05-plans/merge-gate\.mjs"` → `1` on a green tree (the echo line); a scratch test `it.each([{ name: "0123456789012345678901234567890123456789X" }])("$name ends here", ({ name }) => { expect(name).toBe(""); })` prints `× 012345678901234567890123456789012345678… ends here` (2026-10-02).
- merged: P-081, P-090, P-093, P-116, P-121, P-133, P-401, P-402
- hit again: 2026-10-03, B4 g4: prettier changed the padding of an aligned `/* */` comment after the entry `sm-rows` was written, and its replay printed `STALE ... find occurs 0 times`; the `find` was rewritten from the formatted file.
- hit again: 2026-10-03, B1b g9: a second replay of the registry, run only to capture the red output for the log, added nothing: on a replay that is red for the right reason `watchfail.mjs` prints the mutated line and `WATCHED-FAIL OK <id>`, never the failure text, and prints that text only for a BAD one. Take the red text from the first run of the mutation (the `--file/--find/--replace/--run/--expect` form), and keep it then. Proof: `cd app && node scripts/watchfail.mjs --registry tests/mutations --only z 2>&1 | head -2` → `  mutated src/server/lib/pipeline.ts:69  export function isPageRequest(pathname: string): boolean {` and `WATCHED-FAIL OK B1b:z` (an id shared by several registries replays them all; later lines are the other registries' entries).
- hit again: 2026-10-03, B8 g1: five of 37 `sql` entries of `tests/mutations/B8.json` had an `expect` guessed before the red run and missed although the test went red for the right reason. Vitest's wording differs by matcher: `toBe` on strings prints `Expected: "x"` and `Received: "ok"` lines, `toBe` on booleans prints only `expected true to be false`, `toMatch` prints `expected 'ok' to match /.../`, and a deep-equal diff of an array prints a removed last item as `-     "dead",` with no matching `+` line next to it. Proof: from `app/` with the dev profile and the B8 migration plus the `requeue-kind` entry's `sql` as `MOP_MUTATION_SQL`, `env -u CLOUDFLARE_API_TOKEN node node_modules/vitest/vitest.mjs run --project db tests/db/jobs.db.test.ts -t "raises invalid_kind"` prints `Received: "ok"`; the `af` entry's run prints `expected true to be false // Object.is equality`.
- hit again: 2026-10-04, B3 g3: the entry `b3-g3-media-503` went stale in the commit that rewrote its `find` line and was reported as replayed; see P-816.
- hit again: 2026-10-04, B3 g7: moving the database-limit lines of `write()` into a shared `dbLimited()` in `src/server/public/pipeline.ts` left `b3-c` and `b3-g5-pl-order-db` at 0 occurrences and `b3-g3-pipe-memory` at 2 (the new uncached GET path repeats the memory line); a read-only count of every `file` entry's `find` over the files `git diff --name-only` lists caught all three before the commit, and each was re-pointed and replayed `WATCHED-FAIL OK`. Also, the first replay call passed 20 ids to `--only` as a comma list and replayed nothing (`no entry with id b3-eee,...`). Proof: `cd app && node scripts/watchfail.mjs --registry tests/mutations --only b3-c` → `WATCHED-FAIL OK B3:b3-c`; `node scripts/watchfail.mjs --registry tests/mutations --only b3-c,b3-e` → `no entry with id b3-c,b3-e`.
- hit again: 2026-10-04, B3 g5 repair: a replay with `--only <id1>,<id2>` matched no entry and ended `no entry with id <list>` (exit 64): `scripts/watchfail.mjs` compares `entry.id !== only` for one string. The rule above already says one id per call; it was typed from habit and its cost was listed in the repair round with the wrong entry (P-094). Loop over the ids: `for id in b3-a b3-b; do node scripts/watchfail.mjs --registry tests/mutations --only "$id"; done`.
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
- hit again: 2026-10-04, B3 g6: `git merge origin/main` printed `merge-gotchas: both sides changed P-008, P-094, P-320; ours kept, compare by hand` and left GOTCHAS.md conflicted with no markers; the main side's `hit again` lines were copied in by a script and each entry's `- added:` moved back to the last line, then `check-gotchas.mjs` printed OK.
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
- symptom: B1b step 3 has `pipeline.ts` call `captureException` from `sentry.ts`, which step 4 creates (`ls app/src/server/lib/` has no `sentry.ts` at step 3), so the step could not build or be tested as written. Hit again in B2 g9: step 9's proof compares the buckets and `config.toml` with `uploadLimits.maxBytes` and `uploadLimits.types` of `contracts.ts`, which step 10 creates; `uploads.db.test.ts` carries a local copy under `// STUB(B2 step 10)` (the `stubs` gate scans only `src`, `supabase` and `scripts`, so the log names it for step 10).
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
- hit again: 2026-10-03, B9 g3: `const meta = JSON.parse(...)` with a JSDoc `@type` in `scripts/fonts.mjs` gave `no-unsafe-assignment`, and a number inside a template literal gave `restrict-template-expressions`; the fix is `/** @type {unknown} */`, a `typeof` narrowing and `String(n)`.
- hit again: 2026-10-04, B3 g6: an `if (index < 10) expect(...) else expect(...)` loop failed `vitest/no-conditional-expect` four times; the case now maps every entry to `[signed, thumbSigned]` and compares the array once.
- added: 2026-10-02

## P-077 · A plan pins one tool version while `bunx` resolves another, depending on the folder
- symptom: B1b step 3 pins wrangler 4.145.0 (E11), yet `bunx wrangler --version` printed 4.146.0 in an earlier session, and the group's gate was written for 4.145.0.
- cause: `bunx` uses the dependency of the folder it runs in; outside `app/` there is none and it fetches the newest release. The runbook was the only place that said which one is pinned.
- rule: an exact version goes into `devDependencies` and the runbook table names it; every plan command that runs the tool starts in `app/`. A mismatch between the plan's number and what a clean resolve gives is recorded in the runbook and in this bank, and the pin moves only through Dependabot with the proofs re-run.
- proof: `cd app && bunx wrangler --version` → `4.145.0`; the same command in an empty scratch folder → `4.146.0` (2026-10-02).
- hit again: 2026-10-04, B8 g4 (P-908): a scratch worktree has no `node_modules`, so `bunx supabase functions deploy` fetched a CLI that rejects `config.toml` (`'db' has invalid keys: orioledb_version`); the installed `app/node_modules/.bin/supabase` of a tree that ran `bun install` has the pinned version.
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
- hit again: 2026-10-04, B3 g7: a scratchpad probe with `import pg from "pg"`, run from `app/`, died with `ERR_MODULE_NOT_FOUND`; `createRequire` from the working folder fixed it (`const pg = createRequire(process.cwd() + "/")("pg")`). The cwd does not decide where a bare import resolves; the script's own folder does.
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
- hit again: 2026-10-04, B3 g4: `contracts-live.test.ts` first checked that `propertyCardSchema` refuses `{ title: 'No slug' }`; the record lacks every other required field too, so removing `slug` from the schema left that case green and the registry replay named another case (`BAD: wrong reason`). The case now removes only `slug` from a valid card.
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
- hit again: 2026-10-03, B4 g4: a `python -` heredoc hung 120 seconds in the same turn as the analytics test work; the edit was redone with the Edit tool.
- hit again: 2026-10-03, B2 g10 rework: a `python - <<'EOF' ... || echo nopython` guard hung 120 seconds with the `node` edit chained after it; the node edit had run, so the two Edit calls that followed said `String to replace not found` for text the file already held. `git diff` showed it, as the rule says. A `\r` typed inside a Bash heredoc also reached the file as a real CR byte (P-008): use Write for any script with a backslash.
- hit again: 2026-10-03, B3 g1 (review fix): a `python - <<EOF || echo nopython` line ahead of a `node` patch hung 120 seconds in the background; the process id was found with `tasklist`, stopped with `taskkill //PID`, and the `node` half had run once the interpreter ended. An earlier B3 g1 run of the same kind is listed in the review; neither was banked until now.
- hit again: 2026-10-03, B3 g1: `python - <<EOF || node -e ...` in a conflict resolution hung 120 seconds in the background, the `node` half still ran, and the shell had to be freed with `taskkill //F //IM python.exe`; the bank map names this rule and the command was typed anyway.
- hit again: 2026-10-04, B3 g3: `python3 - <<EOF` for a four-line edit hung the shell for 120 seconds before anything ran; the edit was redone with `node` and the Edit tool.
- hit again: 2026-10-04, B3 g5: `python - 2>/dev/null; sed ...` in a chain spun in the background; two `python.exe` processes were ended with `taskkill //IM python.exe`, which ends every python of every lane. Find the id with `tasklist` and end that one with `taskkill //PID <id>`, never by image name (lane rule: stop only what you started).
- hit again: 2026-10-04, B3 c3: `python - 2>/dev/null; node -e ...` typed from habit hung for 200 seconds in the background; the process (`python.exe -`, found with Get-CimInstance Win32_Process) was stopped by its id and the `node` half had already run. The tenth hit: prose has not stopped it, so a PreToolUse hook on Bash that refuses a command matching `(^|[;&|] *)python3? +-( |$)` is the mechanism (the orchestrator owns `.claude/hooks`).
- hit again: 2026-10-04, B16 g1 retry: a stray `python3 - <<EOF` with an empty body hung 120 seconds and moved to the background; nothing it was meant to do needed python.
- hit again: 2026-10-04, B14 g1 fix: a leading `python - <<'EOF'` before a `node -e` hung 120 seconds; the node edit ran only after the python process was killed by its process id, and the Edit calls made meanwhile duplicated an import. After a hung call read `git diff` before editing again.
- hit again: 2026-10-04, B3 g5 repair round (second hit of the same group): a stray interactive `python -` ran again in the repair commit's session; the first round's hit is above. The repair commit `a2f4cb3` changed this entry not at all, so the review counted the cost as unbanked. The hook that refuses `(^|[;&|] *)python3? +-( |$)` is still the open mechanism (see the B3 c3 line).
- added: 2026-10-02
- hit again: 2026-10-04, B8 g4 follow-ups: a stray `python3 -` after a heredoc hung the shell for 120 seconds; the entry had already been appended, and the leftover `python3.exe` was killed by its own process id.

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
- enforced-by: the `test` script of `app/package.json` passes `--testTimeout=60000 --hookTimeout=60000` to every test of `bun run check` (ruling H49 (3)), pinned by `tests/unit/hygiene.test.ts` (`the test script gives every test and hook 60 s`); a bare `bunx vitest run` still has the 5000 ms default (P-140); one case, `lint gives prettier/prettier the options of .prettierrc for it`, carries its own `}, 20_000);` that overrides the 60 s (P-152)
- added: 2026-10-02
- hit again: 2026-10-03, B9 g5: four `render-variants.test.ts` cases (sharp on a 2400x1600 photograph, five sizes each) timed out at 5000 ms when four test files ran at once and passed alone and with `--testTimeout=60000`; the plan's own proof command (no flag) went red the same way under load, so `render-variants.test.ts` now carries `{ timeout: 60_000 }` on its `describe`.
- hit again: 2026-10-04, B3 g4 review: `bun run check` run while another vitest process was going exited 1 with `Failed to start forks worker for test files .../owner-presented.test.tsx` and `Timeout waiting for worker to respond`, and no test failed; run alone it exited 0. Never run two vitest processes side by side before reading a check result; a red with a worker timeout and no failing test is load, so rerun alone.

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
- Hit again in B1b g1 step 7: the new `dev` and `production` jobs repeat the preview's build, wait and smoke lines, and `replay.mjs --check` printed 12 `BAD` entries whose `find` now occurred 2 or 3 times; each was anchored on a neighbouring line that only the preview holds (its `$PREVIEW_URL`, its comment text) and replayed red again. Hit again in B1b c7 (H49 (2)): the dev job's new `current` and `rollback` steps each hold an `exit 1` at the same indent, so `hy-cleanup-exit` (`find` `            exit 1\n`) occurred 3 times; it is now anchored on the cleanup's own `printf` line.
- rule: when a change adds a second copy of a text a test looks for, the test pins the copy it means (`startsWith`, the exact command, or a count) and the registry gets one entry per copy that removes that copy alone. A `find` in `package.json` carries the script's own key or enough of its line to occur once; run `replay.mjs --check` before replaying.
- proof: with `maxWarnings` read as `includes("--max-warnings 0")` in `app/tests/unit/hygiene.test.ts`, `cd app && node ../scratch/replay.mjs hy-lint-warnings-app` → `NOT RED hy-lint-warnings-app: exit=0 expect=false`; with the committed `startsWith("eslint . --max-warnings 0 && ")` → `RED hy-lint-warnings-app: exit=1 expect=true | × lint is type-aware, zero-warning and refuses the named rules` (measured 2026-10-02, B1b c7 round 3).
- added: 2026-10-02

## P-300 · Knip refuses a dependency no file imports yet and a system binary a script spawns; the builder adds the one-line gate entry itself
- symptom: B2 step 1 adds `supabase`, `sharp`, `heic-convert`, `@supabase/supabase-js`, `pg` and `@types/pg` and writes `scripts/psql-dev.mjs`. `bun run knip` then printed `Unused devDependencies (4)` and `Unlisted binaries (1)  psql  scripts/psql-dev.mjs`, exit 1. The group's file list did not hold `app/knip.json`, so it reported BLOCKED and committed nothing, and the lane stood still until the orchestrator read the result.
- cause: the plan was written before the knip gate (B1b step 2b, R04): knip counts a dependency as used only when a file imports it or a `package.json` script names its binary, and `psql` is a scoop binary, not an npm package. "One writer per file" was read as forbidding any file outside the list, a gate's own configuration included.
- rule: add a dependency in the step whose code first imports it (sharp and heic-convert with step 12's image library, `@supabase/supabase-js` with its first importer), with `trustedDependencies` in the same commit; a CLI used only from inside a script gets its plan-named `package.json` script (`db:lint` names `supabase`). A builder adds the smallest entry for its own files to a gate's configuration (`ignoreBinaries` in `knip.json` for psql, pg_dump, ffmpeg) and says so in the slice log (ruling H46 (1), in the build workflow's standing rules). A plan step that adds a script spawning a system binary names `knip.json` in its files.
- proof: `cd app && git show fe027f4:app/knip.json > knip.nokey.tmp.json && bunx knip --config knip.nokey.tmp.json; rm knip.nokey.tmp.json` → `Unlisted binaries (1)  psql  scripts/psql-dev.mjs`, exit 1, and with `"ignoreBinaries": ["psql"]` → exit 0 (B2 c1); `grep -c "ruling H46" .claude/workflows/build-slice.js` prints 1.
- merged: P-500
- hit again: 2026-10-03, B9 g3: `bun add -d @fontsource-variable/*` (copied by `scripts/fonts.mjs` through a path, never imported) and a template component no script imports yet gave `Unused devDependencies (4)` and `Unused files (1)`; the entries are `ignoreDependencies: ["@fontsource-variable/*"]` and `src/templates/social/SocialFrame.tsx` in `entry`.
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
- Hit again in the third B2 g11 re-review (the seed refusal): the plan's step 12 proof `API_URL=https://x.supabase.co SERVICE_ROLE_KEY=x bun run seed -- --target local` cannot print its planned message in a harness shell, because `guardEnv` refuses first with `refusing: ops variables in this shell CLOUDFLARE_API_TOKEN (load the dev profile in a fresh shell)`, exit 1. With `env -u CLOUDFLARE_API_TOKEN` in front it prints `seed: invalid arguments local target must be 127.0.0.1`, exit 1. A proof line that runs a script calling `guardEnv()` carries the `env -u` prefix too; it cost the reviewer one rerun.
- merged: P-313
- rule: a db test, `bun run test:db` or any script that calls `guardEnv()` (`scripts/dev-vars.mjs` too: B3's step 1 proof `node scripts/dev-vars.mjs` refuses in the default shell with `refusing: ops variables in this shell CLOUDFLARE_API_TOKEN`, and `env -u CLOUDFLARE_API_TOKEN -u SUPABASE_ACCESS_TOKEN node scripts/dev-vars.mjs` prints `wrote .dev.vars (8 keys)`, measured 2026-10-03, B3 g1 review) runs from `app/` as `eval "$(node scripts/load-env.mjs --profile dev)"`, then `env -u CLOUDFLARE_API_TOKEN <command>`, in that order. The inline loader is for commands that are not db tests. Never weaken the guard or unset the name in a config file; unsetting `.env` values never helps. When vitest prints `No test files found` for a path that exists, read the `Error:` line first. Still open for the orchestrator (checked 2026-10-03): `.claude/workflows/build-slice.js` line 90 and `.claude/agents/mop-builder.md` line 41 still print the inline loader.
- hit again: 2026-10-04, B3 g5: the task preamble's inline loader (`set -a; . <(tr -d '\r' < .env | grep ...)`) exports `PROD_*` and `SUPABASE_ACCESS_TOKEN`, so the first `bunx vitest run --project db tests/api/parity.api.test.ts` printed `refusing: ops variables in this shell`; `eval "$(node scripts/load-env.mjs --profile dev)"` then `env -u CLOUDFLARE_API_TOKEN` ran it green. The preamble line is for commands that are not db tests; a db proof names the profile loader.
- added: 2026-10-03
- Hit again 2026-10-04, B8 g5 review: the review brief's standing rule sourced the whole `.env`, so the first db run printed `Error: refusing: ops variables in this shell PROD_TURNSTILE_SECRET SUPABASE_ACCESS_TOKEN (load the dev profile in a fresh shell)` at `scripts/lib/guard-env.mjs:16`; the db proofs ran only after `eval "$(node scripts/load-env.mjs --profile dev)"` in a fresh shell. The same brief says to run `plan-brief.mjs` from `E:/mop-build/ops` and forbids any command there (the reviewer ran it from the snapshot, the same commit; B8-followups.md, g4 item 6). The loader line of the standing rules in `.claude/workflows/build-slice.js` is still the inline one.

## P-311 · The sketch commit 8dd6f26 has no `app/` folder, so the plan's `git show 8dd6f26:app/docs/database/schema.sql` fails
- symptom: B2 g4 ran the read the plan names for the sketch columns (B2 Contract > Inputs: `git show 8dd6f26:"app/docs/database/schema.sql"`) and got `fatal: path 'app/docs/database/schema.sql' exists on disk, but not in '8dd6f26'`.
- cause: commit ddc0b4d renamed the app folder to `app/` after 8dd6f26; at 8dd6f26 the file is `Matter Of Place Codebase/docs/database/schema.sql`. The plan wrote today's path against an older commit.
- rule: read the sketch at 8dd6f26 by its path at that commit, `git show "8dd6f26:Matter Of Place Codebase/docs/database/schema.sql"` (lines 94 to 439 are the tables), and after a folder rename check a historical path with `git ls-tree -r --name-only <commit> | grep <file>` before trusting a plan line.
- proof: `git show "8dd6f26:Matter Of Place Codebase/docs/database/schema.sql" | sed -n 94p` → `create table markets (` (measured 2026-10-03, B2 g4).
- added: 2026-10-03

## P-312 · Prove an unmerged migration inside each db test's rolled-back transaction, and pass a large prelude through node, not bun
- symptom: B2 g4 could not run its database proofs the ordinary way: phase 1 forbids pushing an unmerged migration (DB-01, H1) and B4's CI `db` job does not exist yet. In B2 g5, with migrations 4 to 6 as one 35,678-character prelude, `bunx vitest run --project db ...` printed nothing and exited 0; stripped of comment lines (27,968 characters) it printed `panic: Segmentation fault at address 0xFFFFFFFFFFFFFFFF`, and `function-source.db.test.ts` then reported `differs: [enforce_submission_media_limit, ensure_analytics_partitions]`. In B2 g6 migrations 4 to 8 made a 43,805-character prelude, which the earlier "32 KB limit" said could not be passed. Hit again in B2 g9: the plan's own proof `bunx vitest run --project db tests/db/rls.db.test.ts` with the 28,765-character prelude of migrations 9, 10, 11 and the fn migration printed `panic: Segmentation fault at address 0xFFFFFFFFFFFFFFFF`; the same through node passed.
- cause: the harness runs `MOP_MUTATION_SQL` first inside the rolled-back transaction of `withRollback` (T-07), and Postgres DDL is transactional, so a migration's whole text can be that SQL. bun on Windows crashes on a very large environment variable; node does not: 32,767 characters is the limit of `SetEnvironmentVariable`, not of the block `CreateProcess` passes, and Git Bash `export` and `spawnSync(process.execPath, ..., { env })` hand the whole value on. Stripping with `grep -v '^\s*--'` also deleted the comment lines inside `$$` function bodies, so `pg_proc.prosrc` no longer equalled the function file.
- rule: until the `db` job runs, prove an unmerged migration with `MOP_MUTATION_SQL="$(cat supabase/migrations/<file>.sql)"` on the command (dev profile and `env -u CLOUDFLARE_API_TOKEN`, P-310), replay `sql` watched-fails with that file prepended, and say in the log that the proof is mop-dev inside rolled-back transactions and the CI job is still UNPROVEN. Run a prelude over about 15 KB through `node node_modules/vitest/vitest.mjs run --project db ...`, spawn replays with `spawnSync(process.execPath, args, { env })` (never `shell: true`), build the prelude with a script that drops comment and blank lines only outside `$$` bodies, and keep every migration the tests read in it. Without the prelude, `function-source.db.test.ts` fails on mop-dev for the new function files until the migration is pushed from `main`. Two test files that create the same tables wait on each other's catalog rows: keep the files few, or pass `--no-file-parallelism` when a run times out on `lock_timeout`.
- proof: from `app/` on slice/b2 at B2 g4, `MOP_MUTATION_SQL="$(cat supabase/migrations/20261001090300_catalog.sql)" env -u CLOUDFLARE_API_TOKEN bunx vitest run --project db` → `Tests  60 passed (60)`, and afterwards `bun run db:psql -- -Atc "select to_regclass('public.properties') is null"` → `t`; at B2 g6, with the 43,805-character prelude exported, `node -e "console.log(process.env.MOP_MUTATION_SQL.length)"` → `43805` and the db project run through node gave `Tests  2 failed | 144 passed (146)`, the two reds being P-316's stray function (measured 2026-10-03).
- merged: P-314, P-317
- Hit again in B2 g9 review, and the remedy above is not enough: with the 28,765-character prelude the whole db project timed out at random 30 s cases (`Tests  4 failed | 196 passed (200)`, all `Test timed out in 30000ms`: gate.db.test.ts Invoice Issued without acceptance, G60, draft to archived; public-reads carries only the published property). `--no-file-parallelism` still timed out, on other cases (`publish_incomplete without place 30006ms`, `publish_incomplete without hero_image 30001ms`), while `gate.db.test.ts` alone gave `Tests  30 passed (30)`. The builder's `200 passed (200)` was a lucky run, not a stable proof. Rule added: with a prelude over about 15 KB, prove a group file by file, one `vitest run --project db <file>` per file, and quote each file's own count; a whole-project green is reported with its rerun history (P-322), never as the proof alone. The review cost about 15 minutes.
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
- proof: from `app/`, `MSYS_NO_PATHCONV=1 node scripts/watchfail.mjs --file src/routes/_site.about.tsx --find '<main>' --replace '<main><div style={{ width: 2000 }} />' --run 'E2E_PORT=8808 bunx playwright test sweep.spec.ts --project=desktop --project=phone --grep " /about$"' --expect 'elements wider than the viewport'` prints `WATCHED-FAIL OK`; with `--expect 'document scroll width against the viewport'` it prints `WATCHED-FAIL BAD: wrong reason`; with `--replace '<main><div style={{ width: 2000, height: 10 }} />'` and `--expect 'document scroll width against the viewport'` it prints `WATCHED-FAIL OK src/routes/_site.about.tsx` (measured 2026-10-03, B4 g3; the height form re-run in the follow-up record; the file had no `_site.` prefix until B3 step 1b, P-804).
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
- proof: `cd app && bunx playwright test sweep.spec.ts --project=desktop --grep " /about$"` prints `1 passed` on a clean tree; with `<main><p style={{ color: "#f5f2eb", background: "#eeeae1" }}>x</p>` in `src/routes/_site.about.tsx` it prints `axe: new violations on /about` and `"/about | color-contrast | main > p"` (measured 2026-10-03, B4 g3).
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
- hit again: 2026-10-04 03:45, B8 g3 builder (run `wf_8d8a5571-f75`) answered the relayed question "what else can run at the same time as B3 and B8?" and built nothing; the rule sat near the end of the brief. Moved to the first line of every brief in capitals.
- added: 2026-10-03

## P-700 · `launch/engine/sheet.mjs` forces every tile to 16:9: contact sheets of portrait or tall options come out squashed
- symptom: `node launch/engine/sheet.mjs sheet.jpg 3 640 A.png B.png C.png` on the story (1080×1920), carousel (1080×1350) and email (600×1280) options produced sheets with the images squeezed to 640×360, so a reviewer would pick on distorted layouts.
- cause: the script computes one tile height as `w * 9 / 16` and `scale=w:h` every input with no aspect handling; it was written for 16:9 film stills (P-026).
- rule: a contact sheet of non-16:9 stills is tiled at one height and each image's own proportions with ffmpeg directly (`scale=-2:H`, `hstack=inputs=3`); the owner of `sheet.mjs` should add the aspect-preserving mode before any lane relies on it for other shapes. B9 g1 did not edit it (one writer per file).
- proof: `ffprobe -v error -show_entries stream=width,height -of csv=p=0 workspace/08-creative/options/story/sheet.jpg` → `1518,900` (three 506×900 tiles), where sheet.mjs makes `1920,360`.
- added: 2026-10-03

## P-701 · A bone wordmark over sky or branches in a photograph is unreadable: place it on a solid field
- symptom: the first render of cover A and C, carousel A and C and story C put the small wordmark in the top-left of a full-bleed photograph; against bright sky and foliage it vanished, and the whole set had to be re-laid out.
- cause: the wordmark is a thin geometric outline at 14 to 20 px tall; a 30% veil does not give it contrast on a bright sky.
- rule: in the creative templates the wordmark sits on a solid obsidian or ivory field (a band, the foot of the page) or on a flat dark part of the photograph that was checked by eye, never on sky or branches. Look at the rendered PNG before the set is called done.
- proof: `grep -o 'height:150px;background:var(--obsidian)"></div>' workspace/08-creative/options/cover/A.html` → one match (the band), and `grep -o 'right:64px;top:508px"><img src="[^"]*wordmark[^"]*' workspace/08-creative/options/cover/A.html` → the bone wordmark at y 508, inside the band that starts at y 480
- added: 2026-10-03

## P-414 · Plan lines for B4 step 4 named a 10x10 matrix and B3's `analyticsEvents`; main has eleven states and no such constant
- symptom: the brief for `state-machine.test.ts` says "exhaustive 10x10 expected matrix from diagram 1" and `analytics.test.ts` says "for each name in B3's `analyticsEvents`". `workflow.ts` on main has eleven states (`Withdrawn`, DL-04, which diagram 1 does not draw) and `git grep analyticsEvents -- app` finds nothing, because B3 has not landed.
- cause: diagram 1 predates DL-04, and the step 4 line is ordered after B2 step 7 only, while its analytics line leans on a B3 step.
- rule: write the matrix 11x11 with the `Withdrawn` column and row taken from B2 invariant 5; in `analytics.test.ts` type the name list as `Record<AnalyticsEvent, true>`, which fails the typecheck when the union gains or loses a name, and replace it with `analyticsEvents` when B3 step 5 lands (B3 changes `analytics.ts` and updates this test).
- proof: `cd app && node -e "const s=require('fs').readFileSync('tests/unit/state-machine.test.ts','utf8');console.log(s.match(/^ {2}(\"[A-Za-z ]+\"|[A-Za-z]+): .*\"[01 ]+\",$/gm).length)"` → `11`; `git grep -c "Record<AnalyticsEvent, true>" -- tests/unit/analytics.test.ts` → `2` (the comment and the declaration).
- added: 2026-10-03

## P-415 · `expect.objectContaining` and `expect.stringMatching` return `any`: the lint refuses them inside an object or a return, and prettier realigns comment padding a registry `find` copied before formatting
- symptom: `bun run lint` printed `no-unsafe-return` and `no-unsafe-assignment` on `analytics.test.ts` for an asymmetric matcher inside `names.map(...)` and as an object property; the registry entry `sm-rows` replayed `STALE ... find occurs 0 times` because prettier changed the padding of an aligned `/* */` comment after the entry was written.- cause: vitest types the asymmetric matchers as `any`, which the strict type-aware preset (R01) refuses wherever it flows into a typed position; the entry was written from the file as typed, before `prettier --write`.
- rule: build the observed values with `typeof x === "object" && x !== null && "key" in x ? x.key : null` (it narrows to `unknown`) and compare plain values; run `bunx prettier --write` on the test file before writing any registry `find` that quotes it, and replay the entry at once.
- hit again: 2026-10-03, B3 g2: the registry entries for `src/server/lib/ratelimit.ts` were written and replayed green before the first `bun run check`; prettier then split `if (error !== null || row === undefined) throw new AppError(...)` over two lines, so the entry `b3-g2-db-error` went stale and the five `tests/api` cases needed a second replay. Run `bunx prettier --write` on a source file before copying any `find` out of it.
- proof: `cd app && bunx eslint --max-warnings 0 tests/unit/analytics.test.ts` → no output, exit 0; `node scripts/watchfail.mjs --registry tests/mutations --only sm-rows` → `WATCHED-FAIL OK B4:sm-rows`.
- added: 2026-10-03

## P-416 · A recurrence went into a new entry instead of the entry that already holds the lesson
- severity: warn
- symptom: P-415 ended its symptom with "Hit again: P-094 ... and P-066" and carried both lessons (the python heredoc, the prettier padding) beside its own; P-094 and P-066 were not touched, so a search for either id missed the recurrence. The review of B4 g4 found it.
- cause: the entry was written from the list of what went wrong in the turn, one heading for the turn, not from a search of the bank for each item.
- rule: before a new entry, run `grep -n "<keyword>" GOTCHAS.md` for each cost; a cost the bank holds gets a "hit again" line inside that entry (date, lane, what repeated), and a new entry carries one lesson, never the whole turn.
- proof: `git grep -c "^- hit again: 2026-10-03, B4 g4" -- GOTCHAS.md` → `2` (P-094 and P-066), and `grep -n "^## P-415" -A3 GOTCHAS.md | grep -c "Hit again"` → `0` (measured 2026-10-03, B4 g4 follow-ups).
- added: 2026-10-03

## P-417 · A rule line that hands work to another slice's step names a file that slice's plan never lists
- severity: warn
- symptom: P-414 says "B3 changes `analytics.ts` and updates this test", but `workspace/05-plans/B3.md` never names `tests/unit/analytics.test.ts`, so the swap from `Record<AnalyticsEvent, true>` to `analyticsEvents` has no owner. Nothing breaks today: B3 derives `AnalyticsEvent` from `analyticsEvents`, so the typecheck keeps checking the full list.
- cause: the sentence was written as an expectation about B3, not read from B3's Files list.
- rule: a gotcha or log line that says another step will change a file is checked against that step's Files list before it is written, and names the step or follow-up that carries it; a line that cannot be checked says UNPROVEN. The orchestrator either adds the test to B3's Files list or drops the claim from P-414.
- proof: `grep -c "analytics\.test\.ts" workspace/05-plans/B3.md` → `0`; `grep -n "analyticsEvents" workspace/05-plans/B3.md | head -3` shows the derived union near line 140 (measured 2026-10-03, B4 g4 follow-ups).
- added: 2026-10-03

## P-418 · `watchfail.mjs --only <letter>` replays that id in every registry, so a bare letter goes red in a shell that holds `CLOUDFLARE_API_TOKEN`
- severity: warn
- symptom: `node scripts/watchfail.mjs --registry tests/mutations --only d` prints `WATCHED-FAIL BAD: wrong reason (B2:d)` with `refusing: ops variables in this shell CLOUDFLARE_API_TOKEN`, then `WATCHED-FAIL OK B4:d`, then `replayed 2: ok 1, bad 1` and exits 1, although B4:d is fine.
- cause: B1b, B2 and B4 each have an entry `d`; `--only` matches the id in every registry, and the B2 entry is a db entry that the guard-env refuses in a shell with ops variables (P-310).
- rule: read the `B4:<id>` line, not the exit code, when the id is a bare letter; or run under `env -u CLOUDFLARE_API_TOKEN` with the dev profile loaded; a proof that quotes a bare letter names the slice-qualified line it expects. Whether the runner should accept `B4:d` is the orchestrator's follow-up.
- proof: `cd app && node scripts/watchfail.mjs --registry tests/mutations --only d 2>&1 | grep -c "^WATCHED-FAIL"` → `2` in a shell with `CLOUDFLARE_API_TOKEN` (one BAD B2:d, one OK B4:d); `grep -n '"id": "d"' tests/mutations/*.json` lists B1b.json, B2.json and B4.json (measured 2026-10-03, B4 g4 follow-ups).
- added: 2026-10-03

## P-702 · The reviewer brief passes the snapshot folder to `review-snapshot.mjs` as the lane root: `design-review` does not exist before `create`, and the argument would target `design-review-review`
- symptom: the brief said to run `review-snapshot.mjs create E:/mop-build/design-review 8c8ac2a` from `E:/mop-build/design-review`; `cd /e/mop-build/design-review` gave "No such file or directory" (exit 1). The brief also called `E:/mop-build/design-review` the builder's working tree.
- cause: the script derives the snapshot path as `${laneRoot}-review`, so `design-review` is its output, never its input; the template that writes the brief substitutes the snapshot path where the lane root belongs.
- rule: run it from the lane root with the lane root as the argument: `cd E:/mop-build/design && node workspace/05-plans/review-snapshot.mjs create E:/mop-build/design <sha>`; `remove` takes the lane root the same way. The builder's tree is the lane root, the snapshot is the reviewer's copy. The brief template is the owner of the fix.
- proof: `sed -n 21p workspace/05-plans/review-snapshot.mjs` → ``const snap = `${laneRoot}-review`;``; `ls /e/mop-build/design-review` fails before `create` has run (exit 2).
- added: 2026-10-03

## P-703 · `review-snapshot.mjs` installs `app/node_modules` only: a review of `launch/` scripts fails in the snapshot until `bun install` runs in `launch`
- symptom: in a fresh snapshot `ls launch/node_modules` gives "No such file or directory", so `launch/engine/still.mjs` and its siblings cannot run for the reviewer. The B9 g1 builder hit the same wall and listed it under P-027, which is about timeouts, so the cost was never banked under its own name.
- cause: the script runs `bun install --frozen-lockfile` with `cwd: join(snap, "app")` and nowhere else.
- rule: before reviewing anything under `launch/`, run `bun install --frozen-lockfile` in the snapshot's `launch` folder (64 packages, 18 s); the script should install there too, and until it does the reviewer brief says so.
- proof: `grep -n "bun install" workspace/05-plans/review-snapshot.mjs` → one line, `execSync("bun install --frozen-lockfile", { cwd: join(snap, "app"), ...`.
- added: 2026-10-03

## P-704 · `public/fonts/LICENSES.md` is required by two plans and refused by three gates: layout, prettier and the folder map
- symptom: B9 g3 ran `bun run fonts`, which writes the five `.woff2` files and `public/fonts/LICENSES.md` as B17 and B9 specify, then `bun run check` printed `layout: app/public/fonts/LICENSES.md: outside the folder map`; after that, `prettier --write` turned the licence's "1)" items into "1." and rewrote its rule line, so a second `bun run fonts` made `format:check` fail on a file the script had just written.
- cause: STANDARDS section 1 row `public/` and `scripts/check-layout.mjs` list `fonts/*.woff2` only, while the plans commit the licences beside the fonts (OFL asks for the notice to travel with the files); the licence text is third-party legal text, so no formatter may rewrite it.
- rule: `check-layout.mjs` allows `public/fonts/{*.woff2,LICENSES.md}` and `app/.prettierignore` names `public/fonts/LICENSES.md`; STANDARDS row `public/` should read `fonts/*.woff2` and `fonts/LICENSES.md` (the orchestrator edits STANDARDS, a builder does not). Never run prettier `--write` on the generated licence file.
- proof: `cd app && bun run fonts && bun run layout && bunx prettier --config .prettierrc --check public/fonts/LICENSES.md` → `layout: OK` and `All matched files use Prettier code style!`; with the `LICENSES.md` entry removed from `check-layout.mjs` the first gate prints the symptom (measured 2026-10-03, B9 g3).
- added: 2026-10-03

## P-705 · Two writers wrote the same decision row: the orchestrator put an S65 row on main while step 2, which owns PROJECT-STATE.md, wrote its own
- symptom: commit 179ed81 (B9 g2 step 2) conflicted with `origin/main` in `PROJECT-STATE.md`, and a conflicting pull request starts no CI run (P-136). The merge 6f373f9 resolved it ("kept the DIRECTION.md version") and banked nothing.
- cause: the orchestrator committed an S65 decision row on main (PR #87, 96042cc, 13:39:33 +0300) while the plan gave the same row to step 2 of the lane, so both edited the same line of the file.
- rule: a decision row has one writer. When a lane step names `PROJECT-STATE.md` and a decision number, the orchestrator does not write that row on main, or the step reuses the row already on main and adds nothing at that line; the one who finds two rows keeps one and says which in the merge message.
- proof: `git merge-tree --write-tree origin/main 179ed81 >/dev/null; echo $?` → `1` (conflict in `PROJECT-STATE.md`); `git log -1 --format=%s 6f373f9` → `Merge origin/main into slice/b9 (PROJECT-STATE S65 row: kept the DIRECTION.md version)` (measured 2026-10-03, B9 g2 follow-ups).
- added: 2026-10-03

## P-706 · The reviewer brief says to run `plan-brief.mjs` from the builder's tree and also never to run anything there
- symptom: the review brief reads "run `node workspace/05-plans/plan-brief.mjs B9 ...` from E:/mop-build/design" beside "never read, run or write anything there", so the B9 g2 reviewer ran `plan-brief` inside the snapshot to obey the second line.
- cause: the brief template names the lane root for the one command and forbids the lane root for everything else; it is the same template defect as P-702, in a different command.
- rule: the template tells the reviewer to run `plan-brief.mjs` from the snapshot folder (the plan files are identical there); until it does, a reviewer runs every command in the snapshot and treats the lane root as read-only for the builder alone. The brief template's owner makes the fix.
- proof: `ls workspace/05-plans/plan-brief.mjs` inside `E:/mop-build/design-review` lists the file after `review-snapshot.mjs create`; `sed -n 1,5p workspace/05-plans/plan-brief.mjs` shows the usage line takes a slice and `--steps`, with no tree argument (measured 2026-10-03, B9 g2 follow-ups).
- merged: P-824
- hit again: 2026-10-04, B3 g5: the review brief again named `E:/mop-build/api` for `node workspace/05-plans/plan-brief.mjs B3 ...` and forbade running anything there except snapshot create and remove; the reviewer ran the tool from the snapshot (same commit) instead. The reviewer of that group found the second entry (P-824) a duplicate of this one and the bank map says a repeat is a line here: P-824 was folded in on 2026-10-04. Same fix: the brief names the snapshot folder for `plan-brief.mjs`, `standards-index.mjs` and `check-gotchas.mjs`, and the lane folder only for snapshot create and remove. Extra proof: `grep -n "import.meta.url" workspace/05-plans/plan-brief.mjs` → line 19, the plan is read next to the script, so the snapshot's copy reads the snapshot's plan.
- added: 2026-10-03
- hit again: 2026-10-04, B8 g3 review: the brief says to run `node workspace/05-plans/plan-brief.mjs ...` from E:/mop-build/ops and, in the same brief, never to read, run or write anything there while the next builder works; the reviewer ran it in the snapshot E:/mop-build/ops-review (plan at 130e073) and it printed `plan-brief: 102482 characters`, exit 0. The template in `.claude/workflows/build-slice.js` is still not fixed; that is the orchestrator follow-up of P-320 and P-706.

## P-090 · A code change moves the `find` of older registry entries, and nothing says so until a replay
- symptom: in the B1b g4 close-out, three older entries of `tests/mutations/B1b.json` (`h`, `u-message`, `sentry-non-string`) stopped matching once `deps.render` took the request id; in the next fix round four more (`u`, `pipe-guard-off`, `pipe-guard-path`, `pipe-guard-html`) stopped once the guard took a boolean. Each was found late and rewritten, a cost listed in the round's report with no bank entry; a reviewer counted that as a defect.
- cause: an entry's `find` is a copy of code; any edit of the mutated file can change that code. `bun run check` does not replay the registry, and P-081 only covers new entries. Hit again in B1b c7: putting the merge script into `package.json`'s `lint` moved `hy-lint-warnings`; `replay.mjs --check` printed `BAD hy-lint-warnings: find occurs 0 times` before the commit. Hit again in B1b c7 (H49): the new end of the production `if:` and the new `current` step moved `hy-main-event` and `hy-dev-db-order` (`find occurs 0 times`); both were rebuilt from the file by a script and replayed red.
- rule: after every edit of a file the registry mutates (`node -e "console.log([...new Set(require('./tests/mutations/B1b.json').map(e=>e.file))].join('\n'))"` lists them), run the replay runner's `--check` (every `find` occurs exactly once) before the commit, and rewrite a moved entry to the new code, then replay it red. Keep a mutated line's text stable when the change does not need to touch it (bind a new value under the old name rather than renaming what an entry finds).
- proof: `cd app && node ../scratch/replay.mjs --check` (the runner's text is in `workspace/05-plans/logs/B1b.md`, g4 close-out) → `checked 118, bad 0`; with a space put before the `;` of `const options = cutOptions(given);` in `src/server/lib/sentry.ts` it prints `BAD sentry-cut-off: find occurs 0 times` and `checked 118, bad 1` (measured 2026-10-02, bytes restored after).
- hit again: 2026-10-04, B14 g1: eight B1b entries went stale at once, see P-1100.
- hit again: 2026-10-04, B3 g6: passing path parameters into the write parse rewrote the `safeParse` line of `pipeline.ts`, and `b3-b` and `b3-g5-pl-order-db` would have replayed STALE; an occurrence count of every entry whose `file` the diff touched found both before any replay, and the registry script rewrote their `find` and `replace`.
- added: 2026-10-02

## P-134 · A build with `VITE_API_BASE_URL` set answers 500 on every catalog page until B3 serves `/api/public/*`
- symptom: B1b step 6 builds the `pr-<n>` preview in live mode whenever `PREVIEW_WORKER_SECRETS_JSON` holds `SUPABASE_URL` (invariant 13a, true today), and expects its smoke to pass. Under `bun run cf:preview` a build with `VITE_API_BASE_URL=/api/public` answered `500 text/html` on `/`, `/properties`, `/markets`, `/california` and `/stories`, and `500 application/json` on `/sitemap.xml`; `/submit` and `/contact` answered 200.
- cause: the http services adapter fetches `${baseUrl}${path}` with the relative base `/api/public`; inside the Worker's server render a relative address cannot be fetched, and the routes it would reach are B3's and do not exist yet. The plan's landing order puts B1b steps 6 and 7 before B3, so it assumed a deploy before B3 smokes green.
- rule: before a plan step deploys and smokes a build, build it with the same `VITE_*` values the workflow passes and smoke it locally under `cf:preview`; a preview, dev or production smoke of a live-mode build is red until B3 lands. A smoke that names those URLs is that gap, not a smoke defect: report it, do not weaken the smoke or change the build mode without a ruling. Ruling H48 removed the repository variable `VITE_API_BASE_URL` until B3's last step sets it back, so previews build on the local adapter and smoke green (probe PRs #53 and #54, 2026-10-02).
- proof: `cd app && VITE_API_BASE_URL=/api/public VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA bun run build && bun run cf:preview`, then `curl -s -o /dev/null -w "%{http_code} %{content_type}" http://127.0.0.1:8788/properties` → `500 text/html; charset=utf-8` (measured 2026-10-02); the same after a plain `bun run build` → `200 text/html; charset=utf-8`.
- added: 2026-10-02

## P-135 · `git grep` does not search a file git does not track: a new file's "prints nothing" proves nothing
- symptom: the B1b step 6 proof `git grep -n -I "R2_\|wrangler r2\|PROD_SUPABASE\|MEDIA_BASE_URL" -- .github/workflows` was first run while the new `deploy.yml` was still untracked; it printed nothing because it never read the file.
- cause: `git grep` searches the tracked files of the work tree only, unless `--untracked` is given.
- rule: a `git grep` proof over files the change creates runs after `git add` (or with `--untracked`); P-049's advice to search with `git grep` assumes the files are tracked.
- proof: in a scratch repository, `printf 'R2_X\n' > new.yml && git grep -c R2_; echo $?` → `1`, and `git grep --untracked -c R2_` → `new.yml:1` (git 2.55.0).
- added: 2026-10-02

## P-136 · GitHub ignores `GOTCHAS.md merge=union`: a lane that appends to the bank while main does gets a "dirty" pull request and no pull_request run at all
- symptom: after B1b g1 pushed a commit to `slice/b1b` and opened probe PR #47 from it, no `ci` or `deploy` run started in ten minutes, on either pull request. `gh api repos/AbdulrahmanAmer/matter-of-place/pulls/47 --jq '[.mergeable, .mergeable_state]'` printed `false dirty`, while `git merge-tree --write-tree origin/main slice/b1b` on the laptop exited 0. Main had appended P-500 to the end of the bank and the lane had appended P-134 and P-135.
- cause: `.gitattributes` holds `GOTCHAS.md merge=union`, a custom merge driver that only local git applies; GitHub's test merge uses no driver, so two appends at the end of the file conflict there. With no test merge commit, GitHub starts no `pull_request` workflow.
- rule: when a pull request shows no run a minute after a push, read `mergeable_state` before anything else; `dirty` means bring main into the lane with a merge commit (P-072; the orchestrator does it when the builder's brief forbids merges). A probe branch that must run now is cut from `origin/main` with only the files under test checked out from the lane.
- proof: `gh api repos/AbdulrahmanAmer/matter-of-place/pulls/47 --jq '[.mergeable, .mergeable_state] | @tsv'` → `false	dirty`; `git merge-tree --write-tree origin/main slice/b1b >/dev/null; echo $?` → `0` (both 2026-10-02); probe PR #50, cut from `origin/main`, answered `true` and ran.
- added: 2026-10-02

## P-137 · A Worker name deployed for the first time answers Cloudflare's own 404 now and then for about 20 seconds
- symptom: probe PR #44's preview smoked `pr-44` two seconds after its first deploy: every URL answered 404 with `cache-control: private, max-age=0, no-store, no-cache, must-revalidate, post-check=0, pre-check=0` and no header of ours. With a wait for one answer of ours (PR #50), the next twelve requests still mixed that 404 with our answers.
- cause: the new `workers.dev` route reaches the edge gradually. Measured from the laptop with a throwaway Worker (`pr-990003`, deployed 19:15:33 UTC, one request a second): 404 at 2 s, ours at 6 s, 404 at 11, 13 and 17 s, then ours on all 145 requests from 21 s. A redeploy of an existing name does not show it.
- rule: before smoking a Worker name's first deploy, wait for ten answers of ours in a row (every answer of ours carries `x-request-id`), at most 180 s; the `wait` step of `deploy.yml`'s `preview` does this, and step 7's first deploy of `matter-of-place` and `matter-of-place-dev` needs the same. Never let the smoke itself retry a wrong answer.
- proof: `bash ../scratch/g1s6-propagation2.sh pr-990003` from `app/` with `.env` loaded (text in `workspace/05-plans/logs/B1b.md`, g1 block) → the trace above; `cd app && bunx vitest run tests/unit/hygiene.test.ts -t "ten answers"` passes, and registry entries `hy-wait-reset`, `hy-wait-ten` and `hy-wait-fails` turn it red.
- added: 2026-10-02

## P-138 · A replay of every registry entry outlasts the 10-minute tool ceiling, and `scratch/replay.mjs` reads `tests/mutations` from the cwd
- symptom: the 51-entry replay of group c1 ran past the Bash tool's 600000 ms ceiling and was moved to the background; P-027 covers a chain over 120 s but not a single call longer than the ceiling itself. A reviewer who ran `node scratch/replay.mjs --check` from the repository root got `ENOENT 'E:\mop-build\spine\tests\mutations\B1b.json'`.
- cause: the whole replay takes longer than 600 s, so `timeout: 600000` alone does not save it. The script is a git-ignored scratch file (`.gitignore` line 37, `scratch/`) that resolves `tests/mutations` relative to the working directory, and the registry lives under `app/`. The pasted command `cd app && bun run build && bun run cf:preview & ; node ...` is not valid shell (`& ;`). Nobody can re-run the evidence from a fresh clone; B4's `scripts/watchfail.mjs` is the planned home.
- rule: start a replay of the whole registry in the background from the first call and wait on its output file with a bounded `until [ -f <output> ]` loop (P-027), or split it into batches that each stay under 600 s. Run it from `app/`. Write a proof command that starts the preview and the replay as two commands, never `& ;`. Until `scripts/watchfail.mjs` exists, a proof that rests on a scratch script says so in the log.
- proof: `git check-ignore -v scratch/replay.mjs` prints `.gitignore:37:scratch/	scratch/replay.mjs`; `cd app && node ../scratch/replay.mjs --check` prints `checked 367, bad 0`; the same command from the repository root ends in `ENOENT`.
- added: 2026-10-02

## P-139 · actionlint is not on this laptop, and `bunx actionlint` runs nothing: lint a workflow with the release binary
- symptom: B1b g1 step 7 wrote the `dev` and `production` jobs of `deploy.yml`, which run only after a merge (`workflow_run`, `workflow_dispatch`), so no pull request run could check them first. `bunx actionlint@2.0.6 --version` downloaded a package and stopped with `error: could not determine executable to run for package actionlint`; no `actionlint` is on the PATH.
- cause: the npm package of that name has no executable for bunx; actionlint is a Go binary published on its GitHub releases. `hygiene.test.ts` parses the YAML and asserts our rules, but it does not check expressions, contexts or `needs:` names.
- rule: before pushing a workflow change whose jobs run only after a merge, lint it from the repository root with the release binary in the lane's ignored scratch folder: `gh release download -R rhysd/actionlint -p '*windows_amd64.zip' -D scratch/actionlint && unzip -o -q scratch/actionlint/*.zip -d scratch/actionlint`, then `scratch/actionlint/actionlint.exe -shellcheck= .github/workflows/<file>` (no shellcheck on this laptop). Exit 0 is the gate; paste its output in the slice log.
- proof: `bunx actionlint@2.0.6 --version` → `error: could not determine executable to run for package actionlint`; `scratch/actionlint/actionlint.exe -version` → `1.7.12`; on `deploy.yml` → exit `0`; on a copy whose `needs: dev` reads `needs: devv` → `job "production" needs job "devv" which does not exist in this workflow [job-needs]`, exit `1` (measured 2026-10-02).
- added: 2026-10-02

## P-140 · A proof written as `bunx vitest run <file>` skips the test script's 60 s timeout and times out on a loaded laptop
- symptom: in B1b c7 (ruling H49 (3)) `bun run test` gained `--testTimeout=60000 --hookTimeout=60000`, then the plan's own step 7 proof `bunx vitest run tests/unit/deploy-guard.test.ts` went red: `Tests  1 failed | 5 passed (6)`, and on a repeat `× deploys when main gained only workspace, launch and Markdown commits 5943ms` with `Error: Test timed out in 5000ms.` (1 of 4 runs). Through the script, 3 of 3 runs passed.
- cause: the flags live in the `test` script of `app/package.json`, not in `vitest.config.ts`; a bare `bunx vitest run` reads the config only and keeps vitest's 5000 ms default. The guard's cases spawn git in a temporary repository and take 2 to 4.4 s each alone.
- rule: run a single-file proof as `bun run test <file>` (bun passes the path on and the script's flags apply) or add `--testTimeout=60000 --hookTimeout=60000` to a bare `bunx vitest run`. A `Test timed out in 5000ms` from a bare run is the default limit, not a fault: re-run it through the script before reading it as red. Whether the limit should move into `vitest.config.ts`, where every runner reads it, is the orchestrator's call (logged as a follow-up).
- proof: `cd app && for i in 1 2 3 4; do bunx vitest run tests/unit/deploy-guard.test.ts 2>&1 | grep -E "Tests |timed out"; done` → at least one `Test timed out in 5000ms` while two lanes build (measured 2026-10-03); `for i in 1 2 3; do bun run test tests/unit/deploy-guard.test.ts 2>&1 | grep "Tests "; done` → three `Tests  6 passed (6)`.
- added: 2026-10-03

## P-141 · A job's text slice in `hygiene.test.ts` holds the comment above the next job, so a "not in this job" check reads another job's words
- symptom: B1b c7's first case for H49 (1) asserted `has("dev", "PRODUCTION_DEPLOY")` is false (dev is not gated); it went red on a correct workflow, because the comment written above `production:` names `PRODUCTION_DEPLOY`. The same case first read `deployJob("production")?.if?.split(...)` and `tsc` refused it: `Property 'split' does not exist on type 'string | boolean'`. Two reworks before the case was right.
- cause: `splitWorkflow` cuts a job's text from its key to the next job key, so the comment lines that introduce the next job belong to the one before. `JobDef.if` is typed `string | boolean` because YAML lets `if: true` through.
- rule: when the claim is about one field (`if:`, `needs:`, a step's `run`), assert on the parsed field, read as `String(deployJob(job)?.if)`; keep `textOf` and `has` for claims about the whole job, and never for "this word is absent" when a neighbouring comment may carry it.
- proof: in `app/tests/unit/hygiene.test.ts` replace `dev: String(deployJob("dev")?.if).includes("PRODUCTION_DEPLOY"),` with `dev: has("dev", "PRODUCTION_DEPLOY"),` → `cd app && bunx vitest run tests/unit/hygiene.test.ts -t "PRODUCTION_DEPLOY"` prints `× production runs only while PRODUCTION_DEPLOY is on, dev always (H49 (1))` on the committed workflow (measured 2026-10-03, bytes restored after).
- added: 2026-10-03

## G-040 · A query inside `[ "$(psql ...)" = t ]` in a workflow step reads a failed query as the answer "no" and the step stays green
- paths: .github/workflows/**
- severity: warn
- symptom: the first draft of `backup.yml`'s `record` step tested `to_regprocedure(...) is null` and `claim_schedule(...)` inside `[ "$(psql ...)" = t ]`; the plan wants a query error to fail the run red, and that form would have printed `backup last_run_at not recorded` and ended green.
- cause: GitHub runs `run:` with `bash -e`, but `-e` ignores the status of a command substitution used as an argument (of `[`, `echo`, `if`); only a plain assignment `x=$(...)` carries the substitution's status.
- rule: read every query answer in a workflow step into a variable first (`absent=$(psql "$DB_URL" -Atc "...")`), then test the variable; never put `$(psql ...)` inside a test or an echo where its failure matters.
- proof: `bash -ec 'x=$(false); echo after'` prints nothing and exits 1; `bash -ec 'if [ "$(false)" = t ]; then echo t; else echo "read as f"; fi'` prints `read as f` and exits 0 (2026-10-03).
- added: 2026-10-03

## P-150 · Live `build-output` artifacts of the parallel lanes hold more than a Free account's 500 MB of Actions storage
- symptom: sizing `backup.yml`'s retention (B1b step 8, DB-11), the repository's live artifacts were 137 `build-output` uploads, 1,284,006,728 bytes, all kept 1 day; the backup dump is 234,481 bytes.
- cause: `ci.yml` uploads `.output/` (about 9.4 MB) on every pull request push, and four lanes push all day; a 1-day retention does not keep the sum under the quota while that rate lasts. The quota itself is UNPROVEN (the billing API needs the `user` scope; GitHub documents 500 MB for Free).
- rule: before choosing an artifact's retention, sum the live artifacts, not only the new one; when the live sum nears the quota, the orchestrator reads the billing page and decides (fewer pushes or a smaller artifact), because an account over its storage quota with a zero spending limit may refuse new uploads, the backup's included (UNPROVEN until seen).
- proof: `gh api --paginate "repos/AbdulrahmanAmer/matter-of-place/actions/artifacts?per_page=100" --jq '.artifacts[] | select(.expired == false) | .size_in_bytes'` summed → 1284006728 over 137 artifacts, all named `build-output` (2026-10-03 10:03 UTC).
- added: 2026-10-03

## P-151 · A bank entry that cites another entry by number points at the wrong entry once a merge renumbers the cited one
- symptom: G-031's `enforced-by` line, added in B1b c7's WIP commit 88994da, ended `a bare bunx vitest run still has the 5000 ms default (P-504)`. The entry meant is P-140; P-504 on this branch is "A build agent answers the operator's last chat message", so a reader following the reference landed on the wrong entry. Found by the c7 reviewer; no check flagged it.
- cause: the lane wrote the lesson under one number and the merge gave it another (P-140); the sentence that cites it by number in a different entry was not rewritten, and `check-gotchas.mjs` checks headings, duplicates and required lines, not that a cited `P-NNN` or `G-NNN` is the entry the sentence means.
- rule: after a merge that renumbers a bank entry, run `grep -n "<old number>" GOTCHAS.md` and read each hit for the new meaning; write a cross-reference as the number plus a few words of the title, so a wrong number reads as wrong.
- proof: `git show 88994da:GOTCHAS.md | grep -c "5000 ms default (P-504)"` → `1`; `grep -c "^- enforced-by:.*5000 ms default (P-140)" GOTCHAS.md` → `1` (corrected in the c7 follow-up commit); `grep -n "^## P-140" GOTCHAS.md` → `941:## P-140 · A proof written as bunx vitest run <file> skips the test script's 60 s timeout and times out on a loaded laptop`.
- added: 2026-10-03

## P-152 · A per-test timeout overrides `--testTimeout=60000`: one hygiene case still times out at 20 s on a loaded laptop
- symptom: the c7 reviewer's first run of `bunx vitest run tests/unit/hygiene.test.ts tests/unit/deploy-guard.test.ts tests/unit/mutation-registry.test.ts --testTimeout=60000` printed `× lint gives prettier/prettier the options of .prettierrc for it 30299ms ... Error: Test timed out in 20000ms`; alone and inside `bun run check` the case passes. It is the flake ruling H49 (3) set out to end.
- cause: a timeout written in the test itself beats the command-line `--testTimeout`. `app/tests/unit/hygiene.test.ts:849` ends `}, 20_000);` (from commit 3afa483), the only explicit timeout in `app/tests/unit/`. The `hy-test-timeout` mutation cannot see it because it only edits `app/package.json`, so the claim "every test and hook gets 60 s" (H49 (3), the hygiene case `the test script gives every test and hook 60 s`, G-031) is false for this case.
- rule: when a test is slow under load, raise or remove its own timeout rather than rely on the script flag; a hygiene check that claims every test gets 60 s must also refuse a numeric timeout argument in `app/tests/unit/**` (follow-up recorded in `workspace/05-plans/logs/B1b-followups.md`, c7).
- proof: `grep -n "}, [0-9_]*);" app/tests/unit/*.ts` → `app/tests/unit/hygiene.test.ts:849:  }, 20_000);` and no other hit (2026-10-03).
- added: 2026-10-03

## P-153 · The review brief's snapshot command names the snapshot folder, which does not exist yet, as the lane root
- symptom: the c7 reviewer ran the brief's line `cd /e/mop-build/spine-review && node workspace/05-plans/review-snapshot.mjs create E:/mop-build/spine-review cbaeed1` and got `cd: /e/mop-build/spine-review: No such file or directory`, exit 1. The working call is `cd /e/mop-build/spine && node workspace/05-plans/review-snapshot.mjs create E:/mop-build/spine cbaeed1`, which prints `E:/mop-build/spine-review`, exit 0.
- cause: `.claude/workflows/build-slice.js` line 153 builds the first instruction from `where.root`, and `snapshotWhere` (line 193) sets `root` to `${ROOT}-review` for a snapshot review. The script's usage is `create <laneRoot> <sha>` and it adds `-review` itself (`workspace/05-plans/review-snapshot.mjs` line 17), so the create line must carry the lane's own root, not the snapshot's.
- rule: a brief that creates the snapshot names the lane root (`ROOT`) in the `cd` and in the `create` argument, and the snapshot root only for the steps that run inside it; fix it in `build-slice.js` (not this group's file), and a reviewer who sees the `cd` error runs the call from the lane root at once.
- proof: `grep -n "review-snapshot.mjs create" .claude/workflows/build-slice.js | cut -c1-90` → line 153 with `create ${where.root}`; `grep -n "usage" workspace/05-plans/review-snapshot.mjs` → `usage: review-snapshot.mjs create <laneRoot> <sha> | remove <laneRoot> | sweep <laneRoot>`.
- hit again: 2026-10-03, B1b g9 review: the same brief failed the same way (`cd: E:/mop-build/spine-review: No such file or directory`, exit 1; the call from `/e/mop-build/spine` with `E:/mop-build/spine 6edd7ac` printed `E:/mop-build/spine-review`, exit 0). The same brief also names spine-review as the builder's tree; the builder's tree is spine, and `remove E:/mop-build/spine-review` would address a non-existent spine-review-review and leave the real snapshot behind (the script adds `-review` to every verb's argument, line 17 and `snap`). The brief template passes `E:/mop-build/spine` to `create` and `remove`. Proof: `grep -n 'const snap' workspace/05-plans/review-snapshot.mjs` → `const snap = \`${laneRoot}-review\`;`.
- hit again: 2026-10-03, B1b g10 review: the brief still said `cd /e/mop-build/spine-review && node workspace/05-plans/review-snapshot.mjs create E:/mop-build/spine-review e957a35` and failed with `cd: /e/mop-build/spine-review: No such file or directory`, exit 1; the call from `/e/mop-build/spine` with `E:/mop-build/spine` printed `E:/mop-build/spine-review`, exit 0. The fix is not missing from the script: commit 3bba6ce (2026-10-03 13:35 +0300) is an ancestor of slice/b1b and line 153 of `.claude/workflows/build-slice.js` now uses `where.snapshot.lane`. The brief therefore came from a workflow run that loaded the script before that commit (a running workflow keeps the script text it started with; inferred, not observed). Rule added: a fix to `build-slice.js` reaches only workflow runs started after it, so after such a fix the orchestrator re-issues the pending review briefs from the new script, and a reviewer who sees the `cd` error runs the call from the lane root at once. Proof: `git merge-base --is-ancestor 3bba6ce HEAD && echo ancestor` → `ancestor`; `grep -c 'where.snapshot.lane' .claude/workflows/build-slice.js` → `1`.
- added: 2026-10-03

## P-154 · A scratch registry folder inside the shared session scratchpad holds the registries of earlier runs, and `watchfail.mjs --registry` replays them all
- symptom: the g9 reviewer ran `watchfail.mjs --registry <scratchpad>/reg` to replay its own scratch entries and the output began `WATCHED-FAIL OK B4:y`: the folder already held `B4.json` (dated 07:54) beside `g9.json`, so 44 B4 entries were replayed against the snapshot, about 10 extra minutes (files restored).
- cause: the session scratchpad is shared by every workflow agent of the session and keeps files from earlier runs; a fixed folder name like `reg` is reused, and `--registry` replays every `*.json` in the folder it is given.
- rule: make the scratch registry folder fresh with `mktemp -d` inside the scratchpad, `ls` it before the replay, and pass `--only <ids>` so only the entries meant are replayed.
- proof: `d=$(mktemp -d) && ls "$d" | wc -l` → `0`; `cd app && grep -n "readdirSync" scripts/watchfail.mjs | cut -c1-120` shows the registry folder is read whole (every `*.json` in it).
- hit again: 2026-10-03, B9 g4: the folder `<scratchpad>/reg` already held `B4.json` from an earlier agent, and the replay of my own entries started with B4 entries. See P-707 for what that did to the tree.
- hit again, wider form: 2026-10-04, B8 g1 review: not only the registry folder collides. The reviewer wrote its watchfail output to `<scratchpad>/wf.txt` while a B9 lane ran its own watchfail into the same name; `grep` then printed `Binary file ... wf.txt matches` (NUL bytes) and lines 37-73 were `WATCHED-FAIL OK B9:b9g5-*` under the reviewer's `replayed 37: ok 37`. The reviewer's `rm -rf pg`, `> stubs.sql`, `> brief.txt` and `> run1.txt` may have destroyed another agent's files: the B8 author's log used the names `pg` and `stubs.sql` too. Rule widened: every scratch file and folder (output files, `pg` clusters, sql dumps), not only the registry folder, goes inside a fresh `d=$(mktemp -d)` under the scratchpad, never a bare fixed name; check `ps` for another `watchfail` before reading a shared output.
- added: 2026-10-03

## P-707 · A replay killed at the tool ceiling leaves the mutation in the file, and the entry `wf-restore` switches the restore off for every entry after it
- symptom: B9 g4 ran `node scripts/watchfail.mjs --registry <scratchpad>/reg` in the foreground with `timeout 115`; the folder held B4 entries (P-154), the call hit the ceiling mid-replay and `git status` showed `app/src/lib/cx.ts` (B4's mutation) and later `app/scripts/watchfail.mjs` with its `restoreAll` loop deleted. The next replay of the group's own 21 entries printed `WATCHED-FAIL BAD: wrong reason` for five of them, because `restoreAll` no longer wrote anything and each mutation stayed in `slides.ts`, `Cover.tsx`, `Story.tsx` and `OgCard.tsx`; the six untracked files had to be rewritten by hand (they have no git copy to check out).
- cause: a registry replay runs 4 to 8 s per entry on a loaded laptop, so 21 entries cannot finish inside 115 s; a killed `watchfail.mjs` cannot restore, and the B4 entry `wf-restore` mutates `restoreAll` itself, so a kill during or after it breaks the tool for everything that follows.
- rule: replay a registry only in the background (`run_in_background`, output to a log, poll with a bounded loop) from a fresh `mktemp -d` folder that holds only your own file (P-154), never under `timeout`; before the replay commit or stage the files it mutates (an untracked file cannot be restored from git), and afterwards run `git status --short | grep -v "^??"` and the unmutated tests; to find one entry's red text use the single-mutation form (`--file/--find/--replace/--run/--expect`) or a scratch loop that restores from the bytes it read.
- proof: `cd app && git status --short | grep -v "^??"` → no output after a finished replay; `node -e 'for(const e of require("./tests/mutations/B4.json")) if(e.id==="wf-restore") console.log(e.file)'` → `scripts/watchfail.mjs` (2026-10-03).
- added: 2026-10-03

## P-708 · `quiet.mjs` runs its command with `shell: true` and no quoting: `bash -c "cd app && ..."` runs the part after `&&` in the wrong folder
- symptom: B9 g3 review ran `node workspace/05-plans/quiet.mjs -- bash -c "cd app && bun run layout"` and got `error: Script not found "layout"` and `quiet: exit 1`, although the script exists in `app/package.json`.
- cause: `quiet.mjs` calls `spawnSync(argv[0], argv.slice(1), { shell: true })`; on Windows Node joins the arguments with spaces and no quotes, so cmd.exe sees `bash -c cd app && bun run layout`: `bash -c cd` ends at `&&` and `bun run layout` runs in the folder quiet.mjs was started from (the repository root).
- rule: never pass a compound command (`&&`, `;`, pipes, quotes) through `quiet.mjs`; change into the folder first and run it from there: `cd app && node ../workspace/05-plans/quiet.mjs -- bun run <script>`.
- proof: `node workspace/05-plans/quiet.mjs -- bash -c "cd app && bun run layout"` → `error: Script not found "layout"`, `quiet: exit 1`; `cd app && node ../workspace/05-plans/quiet.mjs -- bun run layout` → `layout: OK (772 files)`, `quiet: ok` (measured 2026-10-03).
- added: 2026-10-03

## G-250 · The social templates inline only three CSS files, so a browser default such as `h1 { font-weight: bold }` is never reset: set the weight on the slot
- paths: app/src/templates/social/**, app/src/styles/tokens.css
- severity: warn
- symptom: every carousel and story headline rendered at weight 700 against DIRECTION.md's "nothing bold"; the by-eye check passed because it compared offsets, not weight (B9 g3 review).
- cause: `SocialFrame` draws the headline as an `<h1>`; the reset in `social.css` clears margin and padding only, and the render scripts inline `tokens.css`, `fonts.css` and `social.css` alone, so the browser's own `h1` weight wins over the inherited `font-weight: 400` of `.social-frame`.
- rule: every text slot of a social template sets its own `font-weight` from a token (`--social-weight-text` 400, `--social-weight-numeral` 500); never rely on inheritance through a heading element.
- proof: render `SocialFrame` with react-dom/server, inline the three CSS files and read `getComputedStyle(h1).fontWeight` in puppeteer-core → `400` (with the `font-weight` line of `.social-frame__headline` removed → `700`) (measured 2026-10-03).
- added: 2026-10-03

## P-505 · The merge of PR 43 never deployed the dev Worker: the `closed` run of `deploy.yml` reports every job skipped on the head, and the post-merge gate judged that latest run (the spine lane banked the same finding as P-155; this is the orchestrator entry with the fix)
- symptom: `ci.yml` on main at e6f05e9 ended `merge-gate: failure` with `unverified merge e6f05e9...: preview skipped`; the `workflow_run` job of `deploy.yml` therefore never deployed dev, and `wrangler deployments list --name matter-of-place-dev` answered `This Worker does not exist on your account. [code: 10007]` (found by the B1b step 7b builder).
- cause: closing a pull request runs `deploy.yml` once more (`types: [..., closed]`); the jobs of that run all report `skipped` on the same head SHA with higher check-run ids than the run that did the work, and `scripts/merge-gate.mjs` took the highest id of a name as the verdict.
- rule: a skipped run counts only when every run of that name on the head was skipped (`latestRun` prefers the latest concluded run). Before a rollback rehearsal, read `deployments list` for the dev Worker; on code 10007 dispatch `rehearse_rollback=false` once so there is a version to return to.
- proof: `cd app && bunx vitest run --project unit tests/unit/merge-gate.test.ts -t "closed event"` passes; with the old chooser (the highest id of the name) the case is red (watched 2026-10-03).
- enforced-by: app/tests/unit/merge-gate.test.ts (the closed-event case)
- added: 2026-10-03

## P-155 · The merge of PR 43 never deployed `matter-of-place-dev`: the `closed` run of `deploy.yml` leaves a skipped `preview` as the latest run, so the post-merge gate turns `main` red
- symptom: step 7b says "with step 7 merged, run the rehearsal"; `bunx wrangler deployments list --name matter-of-place-dev` answered `This Worker does not exist on your account. [code: 10007]`. A rehearsal then would only print `first deploy: nothing to roll back to`. The `ci` run of the merge commit `e6f05e98` (run 37118924301) ended red at `merge-gate` with `unverified merge e6f05e98399c9341e9aec3e181002d0418ac6634: preview skipped`, so the `workflow_run` deploy (37119002435) skipped `dev`.
- cause: closing a pull request runs `deploy.yml` once more (`types: [..., closed]`) and every job of that run reports on the head SHA, `preview` as skipped. That run's `preview` row has the highest id of the head, and `scripts/merge-gate.mjs` judges the latest run of a name (P-107), so every merged pull request fails the gate. Not this group's file: an open defect for the owner of `scripts/merge-gate.mjs`.
- rule: before a rollback rehearsal, read `deployments list` for the dev Worker; on code 10007 dispatch `rehearse_rollback=false` once so there is a version to return to. A gate that judges the latest check run of a name ignores runs started by the `closed` event (or judges only runs that concluded `success` or `failure`).
- proof: `gh api "repos/AbdulrahmanAmer/matter-of-place/commits/b4888a0362db9fb0a33f571f5d502c5dd4330489/check-runs?per_page=100" --jq '.check_runs[] | select(.name=="preview") | [.id,.conclusion] | @tsv'` → `111190448027 skipped`, `111190510682 success`, `111191059304 skipped` (the last from the `closed` run at 11:12:37Z); `gh run view 37118924301 --log-failed | grep unverified` → `unverified merge e6f05e98...: preview skipped`.
- added: 2026-10-03

## P-156 · `bun run check` runs prettier over the app's markdown too, so a hand-written runbook table fails `format:check`
- symptom: B1b g8's first `bun run check` after adding a table to `app/docs/runbooks/delivery.md` ended `[warn] docs/runbooks/delivery.md` and `error: script "format:check" exited with code 1`, a second full run of the check.
- cause: `format:check` is `prettier --check .` from the app folder, which includes `docs/**/*.md`; prettier pads every markdown table column to one width, which a hand-typed table never has.
- rule: after editing markdown under `app/`, run `bunx prettier --config .prettierrc --write <file>` on it before `bun run check`.
- proof: `cd app && bunx prettier --config .prettierrc --check docs/runbooks/delivery.md` → `All matched files use Prettier code style!`.
- added: 2026-10-03

## P-157 · A proof that shows only the passing state does not show the rule: P-156 had no control that a hand-padded markdown table goes red
- symptom: the reviewer of B1b g8 ran P-156's proof, `prettier --check docs/runbooks/delivery.md`, and got `All matched files use Prettier code style!`, exit 0. That output is the same whether or not prettier would refuse a misaligned table, so the entry's failure mode was told, never shown.
- cause: P-156 was written from the one red run of `format:check` and proved with the file after the fix; it had no case that fails.
- rule: a proof for a "this goes red" lesson carries a control: write the bad input to a temporary file, see the check exit 1, delete the file. Keep the passing run beside it.
- proof: `cd app && printf '# t\n\n| a | b |\n|---|---|\n| longer cell | x |\n' > docs/zz-control.md; bunx prettier --config .prettierrc --check docs/zz-control.md; echo "exit $?"; rm docs/zz-control.md` → `Code style issues found in the above file` and `exit 1` (run by the recorder on 2026-10-03); `bunx prettier --config .prettierrc --check docs/runbooks/delivery.md` → exit 0.
- added: 2026-10-03

## P-709 · A render probe written outside `app/` cannot resolve `react/jsx-dev-runtime`, and the quick workaround is an untracked file inside `app/`
- symptom: B9 g3 measured the headline weight of `SocialFrame` with a probe kept in the scratchpad: the import of `SocialFrame.tsx` failed to resolve `react/jsx-dev-runtime`, and the author ran the probe as a temporary untracked file inside `app/` (a file the folder map has no row for, written into a tree a reviewer treats as the diff).
- cause: a `.tsx` file takes its JSX runtime from the `node_modules` nearest to the file that holds the JSX; the probe sat outside `app/`, but `SocialFrame.tsx` is inside it, and a probe that itself contains JSX is resolved from the probe's own folder, where there is no `react`.
- rule: write the probe without JSX (`React.createElement`) and import `react`, `react-dom/server.node.js` and the component by absolute path; the component's own JSX then resolves from `app/node_modules`. Never write a probe file into `app/` to get a resolution.
- proof: `bun -e 'const R=await import("E:/mop-build/design/app/node_modules/react/index.js");const S=await import("E:/mop-build/design/app/node_modules/react-dom/server.node.js");const {SocialFrame}=await import("E:/mop-build/design/app/src/templates/social/SocialFrame.tsx");console.log(S.renderToStaticMarkup(R.createElement(SocialFrame,{format:"story",image:null,headline:"A"})))'` run from the tree root → prints `<div class="social-frame social-frame--story">` with an `<h1 class="social-frame__headline">A</h1>` and no resolution error (measured 2026-10-03).
- added: 2026-10-03

## P-710 · The proof line of G-250 is a description of a probe that was never committed, and the library it names is not installed
- symptom: G-250 says to render `SocialFrame` and read `getComputedStyle(h1).fontWeight` in puppeteer-core; the B9 g3 review could not replay it: `ls app/node_modules/puppeteer-core` and the same in `launch/node_modules` found nothing, so the reviewer rebuilt the probe from scratch with Chrome `--dump-dom`. No test pins the weight either, so dropping the `font-weight` line from `.social-frame__headline` keeps `bun run check` green.
- cause: the author measured with a scratch probe and wrote the finding down as prose; the bank's own rule is "a proof is a command someone else can run" (map, rules for the bank itself).
- rule: a proof names a command that runs in the tree as committed; a measurement that needs a browser gets a committed script or test before it is cited as proof (step 6's shoot path or a browser test of g4 is where the computed weights belong); until then cite the static check.
- proof: `grep -c "font-weight: var(--social-weight-text)" app/src/templates/social/social.css` → `2` (the `.social-frame` rule and the headline slot; with the headline line removed → `1`); `ls app/node_modules/puppeteer-core` → `No such file or directory` (measured 2026-10-03).
- added: 2026-10-03

## P-711 · A clamp that no input can reach passes every test with and without it: the watched-fail stays green, and the answer is to delete the clamp
- symptom: B9 g4 wrote `planCarousel` with a clamp that forced the slide count into 6 to 8. Every test passed. The watched-fail of the clamp (remove it, expect red) stayed green, so the registry entry was a lie and the line looked like protection.
- cause: the count is already inside 6 to 8 by construction (a cover, three or four photographs, the facts, an optional place slide and the close, with the photo and place counts decided from `maxSlides`), so the clamp could never change a result. A defence added "to be safe" against a state the code cannot produce is dead code, and no assertion can pin it. The same group then left a real branch unpinned: nothing tests `planCarousel(spec, 7)`, and mutating the place adjustment in the photo count also stayed green (see the follow-up under "## g4 · steps 4,5" in `workspace/05-plans/logs/B9-followups.md`).
- rule: when a watched-fail of a guard stays green, first ask whether any input reaches the guard. If none does, delete it (do not add a test that calls the guard directly); if one does, the test is missing: add the input that reaches it. A range promised to a caller ("6 to 8") is pinned by a test per boundary and per branch that decides it (here 6, 7 and 8), not by a clamp.
- proof: `grep -n "Math[.]" app/src/templates/social/slides.ts` → only the LinkedIn photo count (`Math.min(LINKEDIN_PHOTOS, ...)`), no clamp in `planCarousel` (2026-10-03).
- added: 2026-10-03

## P-712 · `bun run check` under load runs past the 600 s tool ceiling, and its vitest stage can then fail with `Failed to start forks worker ... Timeout waiting for worker to respond`: that is not a red test
- symptom: the B9 g4 review ran `bun run check` in the foreground with other lanes running. The call passed the 600 s Bash ceiling and the vitest stage failed on `tests/unit/analytics.test.ts` with `Failed to start forks worker ... Timeout waiting for worker to respond`, which reads as a red gate. `bun run test` alone, re-run afterwards, passed 32 of 32 files.
- cause: vitest starts one forks worker per test file; with several lanes building and the laptop saturated, a worker did not answer in time. The failure comes from starting the worker, not from an assertion in the file it names.
- rule: run `bun run check` in the background (`run_in_background`, output to a log, a bounded poll loop; P-027), never in the foreground. When the only failure is the worker-start error, re-run the test stage alone (`bun run test`) before calling the gate red; a failure that names an assertion is a real red and is never re-run until green. Report both runs.
- proof: `grep -c "Failed to start forks worker" GOTCHAS.md` → at least `1` (this entry); `cd app && node ../workspace/05-plans/quiet.mjs -- bun run test` → `quiet: ok` on a quiet laptop (2026-10-03).
- hit again: 2026-10-03, B3 g1 review: `bun run check` failed in its vitest stage (`Test Files  39 passed ... Errors  1 error ... Failed to start forks worker for test files .../tests/unit/analytics.test.ts`, exit 1) while other lanes ran; `bun run test` alone then passed 40 of 40, exit 0.
- added: 2026-10-03
- hit again: 2026-10-03, B9 g5: `bun run typecheck` plus `eslint` plus three render runs in one call passed the 120 s foreground limit and moved to the background; split them into calls under 100 s.
- hit again: 2026-10-04, B8 g3 review: `bun run check` failed only in its vitest stage (`Error: [vitest-pool]: Failed to start forks worker for test files .../tests/unit/analytics.test.ts ... Timeout waiting for worker to respond`, exit 1) while other lanes ran; `bun run test` alone then gave `Test Files  65 passed (65)`, exit 0.

## G-104 · A trigger function shared by two tables cannot name a column of one table in a condition that runs for the other
- paths: app/supabase/sql/functions/**, app/supabase/migrations/**
- severity: warn
- symptom: B2 g8's snapshot fixture could not publish a story: `error: record "new" has no field "region_slug"` from `enforce_publish_gate() line 15 at IF`. On main since migration 8, no story could be published by anyone; `gate.db.test.ts` only checked that the trigger exists on `stories`.
- cause: the completeness check was one condition, `tg_table_name = 'properties' and (new.region_slug is null or ...)`. PL/pgSQL resolves every `new.<field>` the expression names before SQL evaluates it, so the `and` never short-circuits the missing field on a `stories` row.
- rule: in a trigger function attached to more than one table, put a table's own columns inside a nested `if tg_table_name = '<table>' then ... end if;`, and give every table that uses the function a test that runs the branch on it (publish a story, not only list the trigger).
- proof: from `app/` with the dev profile, `env -u CLOUDFLARE_API_TOKEN bun run db:psql -- -f <file>` on a file holding `begin; insert into public.markets (slug, name, country, intro) values ('california', 'California', 'United States', 'x') on conflict (slug) do nothing; insert into public.stories (slug, title, deck, category, market_slug, image, editorial_state, published_at) values ('test-story-probe', 'x', 'x', 'Places', 'california', 'test/a.webp', 'published', now()); rollback;` prints `record "new" has no field "region_slug"` on main before migration `20261003082557_fn_enforce_publish_gate_stories.sql`; the watched-fail `g8-story-publish` of `tests/mutations/B2.json` replays it (measured 2026-10-03, B2 g8).
- added: 2026-10-03

## P-320 · A group's file list from `plan-brief.mjs` can omit files its own step requires: the function files of new functions and the manifest exports its proof reads
- symptom: B2 g8's brief named six files. Step 8's proof compares key sets with `publicPropertyKeys`, `publicStoryKeys` and `publicMediaKeys` of `tests/db/schema-manifest.ts`, which did not export them, and migration 9 creates `bump_catalog_version` and `tg_bump_catalog_version`, whose `supabase/sql/functions/<name>.sql` files (invariant 19, and the plan's own watched-fail (tt)) were not in the list; `function-source.db.test.ts` would have gone red on them. The plan's index list also named six indexes migration 4 already holds (`properties_market_idx`, `property_media_idx`, `regions_market_idx`, `market_notes_market_idx`, `market_guide_entries_market_idx`, `slug_history_property_idx`) and two that a primary key serves.
- cause: the group file list is copied from the step's Files lines, which name the migration and its two read functions only; the manifest line and invariant 19 live in other sections.
- rule: before writing, list every function the migration creates and every symbol the proof imports, and check each has a file in the list; a missing one that no later group of the slice names is added by the group that needs it and named in the log and the report, never silently. An index the plan names that an earlier migration already created is listed in a comment and asserted by name, not created twice.
- proof: `cd app && git grep -c "publicPropertyKeys" -- tests/db/schema-manifest.ts` → `1` after B2 g8, `0` before; `ls supabase/sql/functions | grep -c bump_catalog_version` → `2` (measured 2026-10-03, B2 g8).
- hit again: 2026-10-03, B3 g1: the brief for steps 1 and 1b omitted the tests of the libs, `tests/mutations/B3.json`, the keys of `tests/e2e/fixtures/routes.ts` and three `file` values of `tests/mutations/B4.json` that the route renames break; all were added by the group and named in the log.
- hit again: 2026-10-04, B3 g3: the brief for steps 3 and 3b listed `src/server/lib/cache.ts` and `src/server/lib/pipeline.ts`, where the plan and the folder map put `src/server/public/cache.ts` and `src/server/public/pipeline.ts` (B1b's `lib/pipeline.ts` is the other file); the group built the plan's names and also needed `src/start.ts`, `src/server/lib/{db,log-events,wait-until}.ts`, the domain files the mapper fills, `scripts/load-env.mjs`, `tests/e2e/fixtures/routes.ts` (the key for `media.$.ts`), `tests/fixtures/{fake-db,snapshot,worker-env}.ts` and 90 entries of `tests/mutations/B3.json`; all are named in the log.
- hit again: 2026-10-04, B3 g4: the brief for steps 4 and 5 named four files; the steps also needed `src/lib/analytics.ts`, `wizard.tsx`, `_site.submit.tsx`, `representation.tsx`, `inquiry-dialog.tsx`, `_site.property.$slug.tsx`, the registry `tests/mutations/B3.json` and the new test files `contracts-live`, `submit-state`, `analytics-allowlist` and `owner-presented`; all are named in the log.
- hit again: 2026-10-04, B14 g1: the sized list named four paths; steps 2 and 3 also need `scripts/audit/lint-report.mjs`, `REPORT-TEMPLATE.md`, `ROUTINE-PROMPT.md`, `keywords.json`, `cost-alerts.md`, the nine unit tests, `tests/mutations/B14.json`, the `mop-auditor.md` line, and the lint, typecheck and format entries for the two root folders (`app/eslint.config.js`, `app/tsconfig.scripts.json`, `app/package.json`). Proof: `git diff --stat origin/main...slice/b14 | tail -1`.
- hit again: 2026-10-04, B3 g7: the brief for steps 8b and 9 named seven paths; the steps also needed `src/services/types.ts`, `src/services/index.ts` (re-export of `UploadProgress`), `wizard.tsx`, `strings.ts`, `contracts.ts` (receipt shape, `confirmQuerySchema`, `subjectRequestSchema`), `routes.ts`, `pipeline.ts` (an uncached GET path for the confirm link), four route files, `src/server/subjects/service.ts` (no later group of B3 names `POST /subjects/request`), `error-codes.ts` (`unauthorized`), `log-events.ts`, `crypto.ts` (its `STUB(B3)` retired), `scripts/api-smoke.mjs`, `tests/mutations/B3.json`, three existing tests whose shapes changed and five new test files; all are named in the log. Proof: `git diff --stat origin/main...slice/b3 -- app/src/server/subjects app/src/server/public/pipeline.ts | tail -1`.
- hit again: 2026-10-04, B3 g6: the brief named `app/src/server/lib/upload-token.ts` where the plan's Files list and the folder map put `src/server/submissions/upload-token.ts` (built there), and steps 7 and 8 also needed the three route files, `routes.ts`, `pipeline.ts`, `contracts.ts` (`honeypotFieldName`), `crypto.ts` (two STUB markers retired), `src/lib/form-data.ts`, the four forms, `forms.css`, `scripts/deno-portable.ts`, `tests/fixtures/fake-db.ts`, `tests/mutations/B3.json` and the tests `inquiries.api`, `honeypot`, `reconcile` and `subrequest-budget`; all are named in the log.
- added: 2026-10-03

## P-321 · A statement-level catalog trigger bumps twice for one slug rename: `enforce_slug_immutable` deletes before it inserts
- symptom: B2 g8's first run of `renaming a draft's slug bumps it once` received `2`.
- cause: the rename runs `delete from public.slug_history where slug = new.slug` (usually no row) and then the insert of the old slug; a `for each statement` trigger fires for both statements whether or not they touch a row.
- rule: a catalog-version trigger on a table that a function writes with a guard statement before the real one is `for each row`, so a statement that matches nothing does not bump; `slug_history` is the one row-level plain trigger of migration 9, and the watched-fail `g8-slug-rename` puts the statement form back and goes red.
- proof: from `app/`, `MOP_PRELUDE=<migration 9 and the fn migration> node <replay> g8-slug-rename` prints `× renaming a draft's slug bumps it once` with `expected 2 to be 1` (measured 2026-10-03, B2 g8).
- added: 2026-10-03

## P-322 · Database tests on mop-dev time out at 30 s or hit `lock timeout` in bursts, and pass on the next run unchanged
- symptom: in B2 g8, four runs of the same unchanged files gave `Test timed out in 30000ms` on one to five cases and `canceling statement due to lock timeout` on another, then `17 passed (17)` and `18 passed (18)` on rerun; a single case that took 30 s took 3 s alone a minute later. Once one case times out, the next ones often time out too.
- cause: not proven. Observed: every connection goes through Supavisor (`application_name` `Supavisor` in `pg_stat_activity`), vitest does not cancel a timed-out case, so its transaction keeps its locks while the next case starts, and other lanes run db tests on the same project.
- rule: read a burst of 30 s timeouts as the shared database, not the code: look at `pg_stat_activity` for other sessions, rerun once, and report the rerun with the first output. A case that fails the same way twice is a real failure. Never raise `testTimeout` to hide it.
- proof: from `app/` with the dev profile, `env -u CLOUDFLARE_API_TOKEN node scripts/psql-dev.mjs -Atc "select pid, application_name, state, wait_event_type, pg_blocking_pids(pid) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and state <> 'idle'"` while a db run is going shows the test's own `Supavisor` session; the timed-out outputs are pasted in `workspace/05-plans/logs/B2.md` under `## g8 · steps 8` (measured 2026-10-03).
- added: 2026-10-03

## P-323 · Two small traps writing db test fixtures: a parameter used as two types, and jsonb's own key order
- symptom: B2 g8's story fixture failed with `error: inconsistent types deduced for parameter $3` (`$3` was both the `editorial_state` value and compared with a text literal), and an equality of `JSON.stringify` of a jsonb value with the literal written in the test failed although the objects were equal.
- cause: Postgres infers one type per parameter and refuses two; jsonb stores keys sorted by length then bytes, so `{"w":..,"h":..}` comes back as `{"h":..,"w":..}`.
- rule: cast a parameter once per use (`$3::public.editorial_state`, `$3::text`), and compare jsonb values as parsed objects (`toEqual(JSON.parse(...))`), never as strings.
- proof: from `app/` with the dev profile, `env -u CLOUDFLARE_API_TOKEN node scripts/psql-dev.mjs -Atc "select jsonb_build_object('w', 1, 'h', 2)"` → `{"h": 2, "w": 1}` (measured 2026-10-03, B2 g8).
- added: 2026-10-03

## P-324 · A db:fn fix made mid-slice gets today's migration timestamp, which is later than every migration the plan still has to add under a fixed name
- symptom: B2 g8's fn migration `20261003082557_fn_enforce_publish_gate_stories.sql` sorts after the five names the plan still lists for B2 g9 and B3 (`20261001090900_rls.sql`, `20261001091000_storage.sql`, `20261001091100_settings_defaults.sql`, `20261001100000_public_write_functions.sql`, `20261001110000_coming_soon.sql`). After the merge `checkMigrations` answers `rename supabase/migrations/20261001090900_rls.sql to a timestamp after 20261003082557` for each, and db-push refuses them as out-of-order. The plan's Files list, its "numbered 1 to 12" text and the "12 migrations" exit line go stale.
- cause: `db:fn` stamps the migration with the clock, while the plan fixed the later names in advance. Invariant 17 allows renaming, so nothing broke, but nobody had listed the renames.
- rule: before running `db:fn` mid-slice, `git grep` the plan for planned migration names newer than the main tip and older than today; if any exist, say in the log which names will have to be renamed after the fix merges and ask the orchestrator to update the plan before the next group starts. The other way, putting the fix inside an unmerged migration, conflicts with R19's db:fn path.
- proof: from the tree root, `grep -rhoE "2026100[0-9]{7}_[a-z_]+\.sql" workspace/05-plans/*.md | sort -u` lists the planned names, and `ls app/supabase/migrations | tail -3` shows the fn migration stamped `20261003082557`, later than every one of them (measured 2026-10-03, B2 g8 review).
- hit again: 2026-10-03, B3 g2: the plan still names `20261001100000_public_write_functions.sql`, older than main's `20261003173858`; R16 and `db:push` (`refusing: out-of-order migration`) refuse it, so the file was made with `bunx supabase migration new public_write_functions` as `20261003184651_public_write_functions.sql`. The plan's proof `migration list shows 20261001100000` reads `20261003184651`, and B3's later `contracts-live.test.ts` line that parses `supabase/migrations/20261001100000_public_write_functions.sql` must name the new file (B3-followups).
- added: 2026-10-03

## P-325 · The review brief's snapshot command and builder path use the snapshot folder where the script wants the lane root
- symptom: the brief said to run `review-snapshot.mjs create E:/mop-build/db-review 2223e63` from `E:/mop-build/db-review`, which gave `cd: /e/mop-build/db-review: No such file or directory`; it also called `E:/mop-build/db-review` the builder's working folder.
- cause: the script's argument is the lane root and it creates `<laneRoot>-review` itself (`const snap = ${laneRoot}-review`), so the folder does not exist before the first run. The brief generator substituted the snapshot path where the lane path belongs, in both places.
- rule: a reviewer runs the script from the lane root with the lane root as argument: `node E:/mop-build/db/workspace/05-plans/review-snapshot.mjs create E:/mop-build/db <sha>`; it prints the snapshot folder. The brief generator names the lane root as the builder's folder and the snapshot only as the reviewer's. Fix the generator, not each brief.
- proof: `sed -n '5p;21p' workspace/05-plans/review-snapshot.mjs` prints the usage line `create <laneRoot> <sha>` and `const snap = ${laneRoot}-review;` (measured 2026-10-03, B2 g8 review).
- Hit again in B2 g9 review: the brief still passed the snapshot folder as the lane root and still said to run create and remove from that folder, which does not exist until create has run (`cd /e/mop-build/db-review && node workspace/05-plans/review-snapshot.mjs create E:/mop-build/db-review 45db5a3` gave `cd: /e/mop-build/db-review: No such file or directory`). The working form was `cd /e/mop-build/db && node workspace/05-plans/review-snapshot.mjs create E:/mop-build/db 45db5a3`, and remove with `E:/mop-build/db`. The generator is still unfixed: fix the review brief in `.claude/workflows/build-slice.js` (it names review-snapshot.mjs), not each brief.
- Hit again in B2 g10 review: the brief again passed `E:/mop-build/db-review` as the lane root and said to run it from that folder (`cd /e/mop-build/db-review && node workspace/05-plans/review-snapshot.mjs create E:/mop-build/db-review 4378d02` gave `cd: /e/mop-build/db-review: No such file or directory`); the lane-root form worked first time.
- Hit again in the B2 g10 re-review (third hit): the brief again named `E:/mop-build/db-review` as the lane root (`cd /e/mop-build/db-review` gave `No such file or directory`; from the lane, `create E:/mop-build/db-review bf2d74f` failed with `fatal: cannot change to 'E:/mop-build/db-review'`; `create E:/mop-build/db bf2d74f` worked first time). Three briefs in a row: the generator fix is overdue.
- Hit again in the B2 g11 review (fourth hit): the brief again passed `E:/mop-build/db-review` as the lane root and said to run create from that folder (`No such file or directory`).
- Hit again in the B2 g12 review (fifth hit): `cd /e/mop-build/db-review` failed with `No such file or directory`; `review-snapshot.mjs` line 21 reads ``const snap = `${laneRoot}-review` ``. Five hits in one slice: the generator in `.claude/workflows/build-slice.js` is the fix, and it is still open.
- Hit again in the B2 g11 re-review (sixth hit): the brief again passed `E:/mop-build/db-review` as the lane root and called it the builder's folder (`cd /e/mop-build/db-review` gave `No such file or directory`); `create E:/mop-build/db 3fe3560` run from `E:/mop-build/db` worked first time. The generator is still not fixed.
- Hit again in the second B2 g11 re-review (seventh hit): the brief again named `E:/mop-build/db-review` as the lane root and the builder's folder; `cd /e/mop-build/db-review` gave `No such file or directory`, `create E:/mop-build/db c7b7c92` from `E:/mop-build/db` worked first time.
- Hit again in the third B2 g11 re-review (eighth hit): the brief again named `E:/mop-build/db-review` as the lane root, as the folder to run create from and as the builder's folder (`cd /e/mop-build/db-review` gave `No such file or directory`); `cd E:/mop-build/db && node workspace/05-plans/review-snapshot.mjs create E:/mop-build/db a7b23b1` printed `E:/mop-build/db-review` and exited 0. The generator in `.claude/workflows/build-slice.js` is still not fixed.
- Hit again in the B2 g13 review (ninth hit): the brief ran `review-snapshot.mjs create E:/mop-build/db-review dbf641f` from `E:/mop-build/db-review`; `cd /e/mop-build/db-review` gave `No such file or directory`, exit 1, while `cd E:/mop-build/db && node workspace/05-plans/review-snapshot.mjs create E:/mop-build/db dbf641f` printed `E:/mop-build/db-review`, exit 0. The brief also told the reviewer to run `plan-brief` from `E:/mop-build/db` and never read `db-review` there, which swaps the two folders the same way. The fix is in the brief generator `.claude/workflows/build-slice.js` (an orchestrator follow-up), not in the reviewer.
- added: 2026-10-03

## P-326 · `quiet.mjs` splits a quoted argument at its spaces, so `-t "as admin plus"` filters on `as`
- symptom: B2 g9 ran `node workspace/05-plans/quiet.mjs -- node node_modules/vitest/vitest.mjs run --project db tests/db/rls.db.test.ts -t "as admin plus"` to run one case and got `Tests  9 failed | 1 passed | 4 skipped (14)`: every case whose name holds `as` ran, about 30 s instead of 3.
- cause: `quiet.mjs` calls `spawnSync(argv[0], argv.slice(1), { shell: true })`, and with `shell: true` Node joins the arguments with spaces without quoting them, so the shell sees `-t as admin plus`.
- rule: through `quiet.mjs`, write a test-name filter without spaces (`-t "as.admin.plus"`, a regex dot matches the space), or run the command without `quiet.mjs` when an argument must keep a space.
- proof: from the tree root, `node workspace/05-plans/quiet.mjs -- node -p process.argv.length "a b"` prints `3`, and with `"a.b"` prints `2` (measured 2026-10-03, B2 g9).
- added: 2026-10-03

## G-105 · In `format()`, a bare `%s` or `%L` after a numbered `%2$s` takes the argument after that one, not the next unused one
- paths: app/tests/db/**, app/supabase/sql/functions/**
- severity: warn
- symptom: B2 g9's RLS probe built its insert as `format('insert into %s (%s) select %2$s from jsonb_populate_record(null::%1$s, %L)', p_table, v_columns, v_row)`, and every insert of every role answered `22P02` (invalid input syntax): the `%L` received the column list, not the row.
- cause: Postgres `format` continues an unnumbered specifier from the position after the last argument used, numbered or not; after `%1$s` the next bare specifier is argument 2.
- rule: once a format string uses a numbered specifier, number every specifier after it (`%3$L`).
- proof: `cd app && bun run db:psql -- -Atc "select format('%s %2\$s %1\$s %L', 'a', 'b', 'c')"` prints `a b a 'b'`, and with `%3\$L` prints `a b a 'c'` (Postgres format docs; measured 2026-10-03, B2 g9).
- added: 2026-10-03

## P-327 · `gen:types` is an ops command, its determinism proof can pass on an unchanged file, and mop-dev only holds main's migrations
- symptom: B2 g10 ran `bun run gen:types` in the shell that the db tests need (`eval "$(node scripts/load-env.mjs --profile dev)"`, `env -u CLOUDFLARE_API_TOKEN`) and got `supabase gen types exited 1`; the step's determinism proof (`cp src/db/types.ts supabase/.temp/types.prev.ts && bun run gen:types && git diff --no-index --exit-code ...`) still exited 0, because nothing had been rewritten. After the copy, `bun run check` failed in `eslint .` with `supabase/.temp/types.prev.ts was not found by the project service`. The file also lacks every function of migrations 9 to 12 (`public_state` is absent), because `mop-dev` holds only the migrations on `main`.
- cause: `SUPABASE_ACCESS_TOKEN` is an ops name (`scripts/load-env.mjs` loads it only from `.env.ops` and `guardEnv()` refuses it in a db-test shell, P-310), and the dev profile has `DEV_SUPABASE_PROJECT_REF` only; the CLI reads the Management API with the token. ESLint's type-aware config lints every tracked-or-not `.ts` under `app/`, and `supabase/.temp/` was not ignored. The generator reads the cloud project, which an unmerged lane never pushes to (DB-01), so the committed file is what `main`'s schema produces until `main` pushes the rest.
- rule: run `gen:types` in a shell loaded with the inline loader (`set -a; . <(tr -d '\r' < .env | grep -E '^[A-Z0-9_]+='); set +a`), never in the db-test shell, and read its `wrote src/db/types.ts` line before the diff: an exit 0 of the diff alone proves nothing. `supabase/.temp` is in the ESLint ignores. A lane's `src/db/types.ts` lacks the functions of its own unmerged migrations: regenerate it in the first pull request after `main` has pushed them (B4's `gen:types -- --local` diff is red until then), and say so in the log.
- proof: `cd app && bun run gen:types` in the db-test shell prints `supabase gen types exited 1`, in the inline-loader shell `wrote src/db/types.ts`; `grep -c public_state src/db/types.ts` prints `0` on slice/b2 at B2 g10 while `grep -c "create or replace function public.public_state" supabase/migrations/20261001090800_catalog_version.sql` prints `1` (measured 2026-10-03).
- added: 2026-10-03

## P-800 · A route file named with a leading double underscore is a pathless layout, not the path `/__name`: B3's `src/routes/__spike.tsx` stops the build
- symptom: B3 step 1's temporary page `src/routes/__spike.tsx` with `createFileRoute("/__spike")` made `bun run build` fail: `Conflicting configuration paths were found for the following routes: "/", "/". Conflicting files: src/routes/index.tsx, src/routes/__spike.tsx`.
- cause: TanStack's file router reads a leading underscore as a pathless layout and `__root.tsx` is the only double-underscore name it knows, so `__spike` has no path of its own and its children resolve to `/`.
- rule: a temporary or real route file never starts with an underscore unless it is meant as a pathless layout (`_site.tsx`); the spike page is `src/routes/spike.tsx` (URL `/spike`). A plan line that names `__spike` is a plan defect; the removal proof `test ! -e src/routes/spike.tsx` replaces the one for `__spike.tsx`.
- proof: `cd app && bun run build` with `src/routes/__spike.tsx` present prints the error above and exits 1; renamed to `src/routes/spike.tsx` with `createFileRoute("/spike")` it exits 0 and `curl -s http://127.0.0.1:8828/spike | grep -c ok` prints 2 under `wrangler dev` (measured 2026-10-03, B3 g1).
- added: 2026-10-03

## P-801 · The safety check on `rm` resolves a relative path against the session's start folder, not the folder a `cd` in the same command moved to
- symptom: `cd /e/mop-build/api/app && ... rm ../spike-page.txt` was refused as "Dangerous rm operation detected: E:\spike-page.txt" and the refusal says it will not be shown again, so the scratch files stayed until a command with absolute paths removed them.
- cause: the check reads the path before the `cd` takes effect, so `../x` resolves from the session folder (`E:\Matter Of Place`) to the drive root.
- rule: give `rm` absolute paths only (`rm /e/mop-build/api/app/src/routes/spike.tsx`), and write scratch output (curl bodies, wrangler logs) into the session scratchpad, never into the lane folder.
- proof: `rm /e/mop-build/api/spike-page.txt` removed the file that `rm ../spike-page.txt` was refused for (2026-10-03, B3 g1).
- hit again: 2026-10-04, B8 g5: `cd app && ... > ../../ops-scratch-head.sql; ...; rm ../../ops-scratch-head.sql` was refused as `E:ops-scratch-head.sql` and the whole command did not run; the head went into the session scratchpad with Write instead.
- added: 2026-10-03

## P-802 · B3 step 1 says B2's generated types "exist by now", but `src/db/types.ts` is only on `origin/slice/b2` until B2 merges
- symptom: `git ls-files app/src/db` on `main` lists only `README.md`; `db.ts` (`createClient<Database>`) and `fake-db.ts` (`Database['public']['Functions']`) cannot typecheck without the file, and B3's own brief said the rest of B3 waits for B2 step 12 on `main`.
- cause: the plan reads B2 as finished; the file lands in B2 g10 (`origin/slice/b2`), and `main` holds only B2's early groups.
- rule: a B3 group that needs `src/db/types.ts` before B2 is on `main` merges `origin/slice/b2` into its branch (a merge commit, never a rebase or a copy of one file, so the later merge of B2 sees the same commits), resolves `.prettierignore` and `knip.json` by keeping both sides, and says so in the log. The types predate migration 9 (P-327): a test that names `public_state` casts the name once with a reason.
- proof: `git ls-tree -r --name-only origin/main -- app/src/db/types.ts` prints nothing and the same on `origin/slice/b2` prints `app/src/db/types.ts` (measured 2026-10-03, B3 g1); `bun run typecheck` exits 0 after the merge.
- added: 2026-10-03

## P-803 · `watchfail.mjs --only <id>` is global across registries: a plan letter that another registry already uses replays both
- symptom: the first replay of B3's entries `oo` and `pp` printed `replayed 2: ok 1, bad 1` (`WATCHED-FAIL OK B3:oo` and a bad result from the other registry's entry of the same id), so a green slice looked red.
- cause: `tests/mutations/*.json` are searched together and the plans hand out the same letters (`oo`, `pp`) to several slices; the uniqueness test of `mutation-registry.test.ts` checks one file at a time.
- rule: give every registry entry the slice prefix (`b3-oo`, `b3-g1-env-prod`), whatever letter the plan uses; replay a slice in one call with `for id in $(node -e '...ids...'); do node scripts/watchfail.mjs --registry tests/mutations --only "$id"; done` and read only the summary line.
- proof: `cd app && node scripts/watchfail.mjs --registry tests/mutations --only b3-oo | tail -1` → `replayed 1: ok 1, bad 0, stale 0; ...` (measured 2026-10-03, B3 g1).
- added: 2026-10-03

## P-804 · Moving a route file leaves the banked proof commands that name the old file unrunnable, and nothing checks them
- symptom: B3 step 1b moved `src/routes/about.tsx` to `_site.about.tsx` and updated the three `tests/mutations/B4.json` entries, but the proofs of G-150 and P-409 still named `src/routes/about.tsx`, a file that no longer exists; the same move left `trace.json` (22 code paths), `pages-and-wording.md` (47) and `app/docs/architecture/frontend.md` (11) on the old names, and `check-plans.mjs` still printed OK.
- cause: a registry test replays `file` entries and so caught B4.json, but a proof written as prose in the bank, an S53 trace item or a site-index line is not read by any test, and `check-plans.mjs` checks that a plan names its files, not that the files exist.
- rule: a step that renames or moves a file greps the whole repository for the old path (`git grep -n '<old path>' -- . ':!app/src/routeTree.gen.ts'`) and fixes every hit in a file it owns; a hit in a file it does not own goes to the follow-ups for the orchestrator. The two bank proofs are corrected by this entry; the trace, site-index and architecture hits are open (B3-followups).
- proof: `git grep -c '^- proof:.*src/routes/about[.]tsx' -- GOTCHAS.md` → no output (the proofs of G-150 and P-409 name `_site.about.tsx`); `ls app/src/routes | grep -c '^about[.]tsx'` → `0`; `git grep -l 'routes/about[.]tsx' -- workspace/05-plans/trace.json` → `workspace/05-plans/trace.json` while the hit is open (measured 2026-10-03, B3 g1 review).
- added: 2026-10-03

## P-805 · Two plans order `submission_media` by `sort_order`, a column no migration and no plan creates
- symptom: B3 step 2's `submission_upload_paths` returns its rows "in `sort_order`" and B7 reads uploaded media "in `sort_order`", but `submission_media` (B2 migration 5, `tests/db/schema-manifest.ts`) has id, submission_id, name, storage_path, uploaded_at, bytes, mime and sha256 only. `create_submission` also has to answer a double click with the first request's media in payload order, which needs the position stored.
- cause: the plans wrote the read before anyone owned the column; the Data changes list of B3 names `duplicate_of` and `pending_source` and not this one.
- rule: before writing a function body from a plan line, check every column it names against `tests/db/schema-manifest.ts`; a missing column is added by the migration of the function that first writes it, named in the log and the report, never left to a later slice. B3's migration `20261003184651_public_write_functions.sql` adds `submission_media.sort_order int not null default 0`, written by `create_submission` as the 0-based payload index.
- proof: `cd app && git grep -c "sort_order" -- supabase/migrations/20261001090400_intake.sql` → no output; `git grep -c "add column sort_order" -- supabase/migrations/20261003184651_public_write_functions.sql` → `1` (measured 2026-10-03, B3 g2).
- added: 2026-10-03

## P-806 · `rate_limit_check` as the plan words it ("one row per check") counts a call twice when two checks share a bucket and key
- symptom: B3's Files line says `rate_limit_check` "inserts one row per check" and also that `checkDb` "accepts two checks on one bucket with different windows" (B7's `agent:<key_id>` at 60 per minute beside a daily limit). With one row per check each call writes two hits under the same bucket and key, and both windows count both, so the minute limit of 60 would refuse at the 31st call.
- cause: the two sentences were written for different callers; a check is a window on a key, while a hit belongs to the key.
- rule: `rate_limit_check` inserts one hit per distinct (bucket, key_hash) of the call (`select distinct`). `tests/api/ratelimit.api.test.ts` "counts two checks on one bucket against their own windows and records one hit per call" asserts 3 hits after two calls on a key that held 2.
- proof: `cd app` in the dev loader shell, `bunx vitest run --project db tests/api/ratelimit.api.test.ts -t "own windows"` passes; `env -u CLOUDFLARE_API_TOKEN bun run db:psql -- -f <file>` on a file holding `begin;`, the text of `supabase/sql/functions/rate_limit_check.sql` up to `$$;` with `select distinct c` changed to `select c`, two hits for one key dated 2 minutes ago, two calls of `rate_limit_check` with the checks `{limit 2, window_seconds 60}` and `{limit 3, window_seconds 86400}` on that key, a count of its hits and `rollback;` prints `t | 0`, then `f | 86280` and `4`; with `distinct` the count is `3` (measured 2026-10-03, B3 g2).
- added: 2026-10-03

## G-300 · `env.ts` parses `process.env` when it is first imported, so a unit test sets the environment before it imports `env.ts`, `db.ts` or anything that imports them
- paths: app/src/server/lib/env.ts, app/src/server/lib/db.ts
- severity: warn
- symptom: B3 g1's first `env.test.ts` failed at load with `Invalid environment: RATE_LIMIT_SALT Required` before any test ran, because `import { parseEnv } from ".../env"` evaluated `export const env = parseEnv(process.env)` under the hermetic setup, which holds no secrets.
- cause: the plan makes `env` a module-level constant read once (`tests/api/env.ts` relies on the same order), and `tests/setup/hermetic.ts` strips credentials.
- rule: a unit test that needs `env.ts` (directly, or through `db.ts`) stubs the variables first and loads the module with a dynamic import after `vi.resetModules()` (`vi.stubEnv("MOP_ENV", "local")`, `vi.stubEnv("RATE_LIMIT_SALT", "salt")`, then `await import(...)`); a test that only needs the type `Db` imports it with `import type`, which loads nothing. Code the job runner shares reads variables with `readVar`, never `env.ts` (G39).
- proof: `cd app && bunx vitest run --project unit tests/unit/env.test.ts tests/unit/db.test.ts` passes; with the stubs removed from the head of `env.test.ts` it fails at load with the error above (measured 2026-10-03, B3 g1).
- added: 2026-10-03

## G-301 · `AbortSignal.timeout` on a Storage `fetch` also cuts the response body, so `readPublicObject` and the delete batches carry no timeout
- paths: app/src/server/lib/media-store.ts
- severity: warn
- symptom: B3 g1 wrapped every Storage call in `AbortSignal.timeout(10_000)`; the review showed a response whose stream lasts longer than the limit prints `headers status 200` and then `body error after headers: TimeoutError` (Node/undici), so a property video on a slow phone would be cut off mid-body and the edge could not fill its cache; the same cap turned a slow but working 1,000-key delete into `storage_unavailable` and a retry loop.
- cause: a fetch signal covers the whole exchange including the body; `readPublicObject` hands the answer to `src/server/public/media.ts` to stream, and the plan names no timeout.
- rule: `storageFetch` passes the init untouched, with no signal. A bound on a Storage call is a decision of its own, taken where the body is not streamed to a client.
- proof: `cd app && bunx vitest run --project unit tests/unit/media-store.test.ts` passes; with `signal: AbortSignal.timeout(10_000)` put back in `storageFetch` it fails `sets no abort signal, so a slow stream of a large file is never cut off` (measured 2026-10-03, B3 g1 review fix).
- added: 2026-10-03

## G-106 · Moving a function to another schema: policies follow it, but function bodies, test SQL, the registry and `db:reset` do not
- paths: app/supabase/migrations/**, app/supabase/sql/functions/**, app/scripts/db-reset-dev.mjs, app/tests/mutations/**
- severity: warn
- symptom: B2 c9 moved `is_staff()` and `role_in(...)` from `public` to `app` (security advisor lint 0029). The review's remedy named only the move and two test files. Measured on mop-dev after `alter function ... set schema app`: the 44 policies read `app.role_in(...)` at once, but `enforce_publish_gate` (plpgsql, text body) still said `public.role_in`, `harness.db.test.ts` selected `public.role_in(...)`, 17 `sql` entries of `tests/mutations/B2.json` created or called `public.role_in`/`public.is_staff`, and `pg_depend` showed `app.is_staff()` depending only on schema `app` (`pg_namespace|n`), so `db:reset`'s `drop schema public cascade` would leave it behind and the replayed move would fail with "function is_staff() already exists in schema app".
- cause: a policy stores the function's oid, a `language sql`/`plpgsql` body stores text resolved at call time, and a body that only names tables records no dependency on them. `alter function ... set schema` is not flagged by `check-migrations.mjs` and drops nothing, so no gate catches the stale names.
- rule: before moving a function, `git grep -n "public\.<name>"` across `supabase/sql/functions`, `tests`, `scripts` and the plans; regenerate every function that names it with `bun run db:fn`, repoint test SQL and registry `sql` entries, and make `db:reset` drop the new schema too. Replay every registry entry whose `sql` names the function.
- proof: from `app/` with the dev profile, `env -u CLOUDFLARE_API_TOKEN bun run db:psql -- -Atc "select d.refclassid::regclass, d.deptype from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = 'app.is_staff()'::regprocedure"` → `pg_namespace|n` only (measured 2026-10-03, B2 c9).
- hit again: 2026-10-03, B3 g2: the move did not regenerate `src/db/types.ts`, so main's file still listed `is_staff` and `role_in` under `public`; the next `bun run gen:types` dropped them, and `bun run check` failed typecheck in `tests/unit/db.test.ts` and `tests/unit/fake-db.test.ts`, which used `is_staff` as a sample RPC (`Argument of type '"is_staff"' is not assignable`). Moving a function regenerates the types in the same commit; the two tests now call `public_state` and `record_webhook_receipt`.
- added: 2026-10-03

## P-328 · A proof of a migration that runs on mop-dev can pass because mop-dev lacks the object the proof is about
- symptom: B2 g10 proved migration 12 with `catalog_version 1` read from `mop-dev`, and the review found the real stack gives `4`: all four settings keys went in one `insert`, Postgres queues the AFTER ROW triggers of a statement and fires them at its end, so `settings_bump_catalog_version` (migration 9) raised the freshly inserted `catalog_version` row once for each of `coming_soon_global`, `site` and `environment`. The file's own comment said the opposite.
- cause: `mop-dev` holds only the migrations on `main`, so the trigger did not exist there and the insert could not bump anything; no test read the starting value, and `catalogVersion()` in `catalog-version.db.test.ts` inserts the row when it is missing, which hides a missing seed too.
- rule: a migration whose behaviour depends on an earlier unmerged migration is proved with that migration in the prelude (P-312), never on bare `mop-dev`; the case asserts its precondition (the trigger exists) so it cannot pass on a database without it. Rows that a trigger watches go in a statement before the row the trigger raises, never in the same `insert`.
- proof: `cd app && eval "$(node scripts/load-env.mjs --profile dev)"; export MOP_MUTATION_SQL="$(cat supabase/migrations/20261001090800_catalog_version.sql)"; env -u CLOUDFLARE_API_TOKEN node node_modules/vitest/vitest.mjs run --project db tests/db/catalog-version.db.test.ts -t although` → `1 passed`; with the registry entry `g10-catalog-version-start` applied (one `insert` again) the received value is `"4"` (measured 2026-10-03, B2 g10 rework).
- added: 2026-10-03

## P-329 · `bun run check` can exit 1 on `Failed to start forks worker` while other lanes run: rerun the test step before looking at code
- symptom: a reviewer's first `bun run check` of B2 g10 exited 1 on `[vitest-pool]: Failed to start forks worker for test files .../tests/unit/analytics.test.ts. Caused by: Error: [vitest-pool-runner]: Timeout waiting for worker to respond` and `error: script "check" exited with code 1`; `bun run test` alone then printed `Tests  576 passed | 1 skipped (577)`.
- cause: a busy laptop (several lanes build and test at once) starts a vitest worker slower than the pool's wait; no test ran, so no case failed.
- rule: one red `check` whose only message is a worker-start timeout is not a code failure: rerun the test step once and quote both runs (P-322 says the same of the database project); a case that fails the same way twice is real.
- proof: `grep -n "Timeout waiting for worker to respond" workspace/05-plans/logs/B2.md` finds the g10 review's first run (measured 2026-10-03).
- added: 2026-10-03
- hit again: 2026-10-04, B14 g1 review: `bun run check` exited 1 on `[vitest-pool]: Failed to start forks worker for test files .../tests/unit/analytics.test.ts ... Timeout waiting for worker to respond` while another lane ran; `bun run test` alone then passed 49 files. The same review's combined audit-tests plus registry-replay call passed the 600 s tool ceiling (P-712). Proof: `grep -c "hit again: 2026-10-04, B14 g1 review" GOTCHAS.md` prints 1.

## P-331 · An agent shell can hold `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` of another project, and `serviceClient()` prefers them to the dev profile
- symptom: B2 g11's first `bun run seed -- --target dev --mode full --images skip` printed `lock mop-dev-tests held` and then `seed: markets upsert failed: Could not find the table 'public.markets' in the schema cache`, three times, although `curl` with `DEV_SUPABASE_SERVICE_ROLE_KEY` read `markets` on mop-dev with 200 (`[]`). A `NOTIFY pgrst, 'reload schema'` changed nothing.
- cause: the shell the builder ran in already exported `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for a different Supabase project (the host is not `$DEV_SUPABASE_PROJECT_REF`); `tests/fixtures/service.ts` reads those two names first and the dev names only as a fallback, so supabase-js talked to the other project while the guard and the advisory lock were on `DEV_DB_URL`. It failed only because that project has no `markets` table; with one, the seed would have written there.
- rule: a script that writes through supabase-js builds its client from the dev profile's own names (`DEV_SUPABASE_PROJECT_REF`, `DEV_SUPABASE_SERVICE_ROLE_KEY`) and never through `serviceClient()`, so the project written to is the one guarded and locked; `scripts/seed.ts` does. Before reading a PGRST205 as a stale cache, compare the host of `SUPABASE_URL` with `https://$DEV_SUPABASE_PROJECT_REF.supabase.co`. `serviceClient()` and `guardEnv()` still do not catch this: logged as a follow-up for B3's `tests/api`, which uses the same helper.
- proof: `cd app && eval "$(node scripts/load-env.mjs --profile dev)" && node -e 'console.log(process.env.SUPABASE_URL === "https://" + process.env.DEV_SUPABASE_PROJECT_REF + ".supabase.co")'` → `false` in that shell (measured 2026-10-03, B2 g11); `env -u CLOUDFLARE_API_TOKEN bun run seed -- --target dev --mode full --images skip` → `markets 3, regions 12, properties 16, stories 6`.
- hit again: 2026-10-04, B3 g7: the first local `node scripts/api-smoke.mjs http://127.0.0.1:8828 --cleanup` passed every call and printed `FAIL row in inquiries: null row` for all four tables, because its `readRows` builds its client from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, which this shell held for another project, while the Worker wrote to mop-dev. The plan's Inputs line exports both from the dev names after the loader; with that export the same run printed `api-smoke: 16 ok, 0 failed`. The smoke's own read should take the dev names as `seed.ts` does (follow-up, not this group's file to redesign). Proof: from `app/`, `eval "$(node scripts/load-env.mjs --profile dev)"; export SUPABASE_URL="https://$DEV_SUPABASE_PROJECT_REF.supabase.co" SUPABASE_SERVICE_ROLE_KEY="$DEV_SUPABASE_SERVICE_ROLE_KEY"` before the smoke.
- added: 2026-10-03

## P-332 · The seed's two small gate costs: `guardedScripts` needs the literal call `assertNotProduction(`, and an untyped supabase-js client cannot be named as a type
- symptom: `bunx vitest run --project unit tests/unit/assert-not-production.test.ts` failed with `expected [ 'scripts/seed.ts' ] to deeply equal []` although `seed.ts` imported the guard and defaulted its `guard` parameter to it; then `bun run lint` printed `no-unsafe-return` on a function typed `SupabaseClient`, and `ReturnType<typeof createClient>` made `.upsert` take `never[]`.
- cause: the `guardedScripts` case tests the file text for `assertNotProduction(` with the open parenthesis, which `guard = assertNotProduction` does not contain; `createClient` without a `Database` type returns `SupabaseClient<any, any, "public", any, any>`, which no named type reproduces under the strict preset.
- rule: a guarded script holds the literal call (`guard = (options) => assertNotProduction(options)`); an adapter over an untyped supabase-js client is built in the function that creates the client, so the type is inferred and never written.
- proof: `cd app && bunx vitest run --project unit tests/unit/assert-not-production.test.ts` → `Tests  9 passed (9)`; with `guard = (options) => assertNotProduction(options)` replaced by `guard = () => Promise.resolve()` in `scripts/seed.ts` the registry entry `mmm-seed-text` replays `WATCHED-FAIL OK B2:mmm-seed-text` (2026-10-03, B2 g11).
- added: 2026-10-03

## P-330 · A db project run can fail with `getaddrinfo ENOTFOUND aws-0-us-east-1.pooler.supabase.com` before any test runs, and pass on the next run unchanged
- symptom: a reviewer's `vitest run --project db tests/db/catalog-version.db.test.ts` of B2 g10 failed in global setup with `Error: getaddrinfo ENOTFOUND aws-0-us-east-1.pooler.supabase.com`, exit 1, no test run; the run with migrations 9 and 12 as prelude failed the same way. `nslookup` resolved the host straight after (44.216.29.125 and others) and each rerun gave `18 passed`. Two reruns of cost.
- cause: a transient DNS failure on the laptop's resolver, not the code: global setup opens the pooler connection first, so a lookup failure reports as a red project with no case named.
- rule: one `ENOTFOUND` on the pooler host is not a code failure: rerun once and quote both runs (P-322 and P-329 say the same of timeouts and worker starts); a lookup that fails twice with `nslookup aws-0-us-east-1.pooler.supabase.com` also failing is a network fault, so report BLOCKED with that output, not a test result.
- proof: `grep -n "ENOTFOUND" GOTCHAS.md` finds this entry; `nslookup aws-0-us-east-1.pooler.supabase.com` prints the pooler's addresses when the resolver is healthy (measured 2026-10-03, B2 g10 review).
- added: 2026-10-03

## P-333 · A watched-fail of a budget or a "nothing leaks" assertion stays green until the mutation makes something exceed the budget or leak
- symptom: B2 g12's registry entry `g12-variants-hero-weight` (hero encoded lossless) stayed green: the 2400x1600 gradient fixture encodes to 296,510 bytes even lossless, under the 400 KB bound. A mutation that feeds the upload to the variants (`sharp(buffer)` instead of `sharp(master)`) also stays green for EXIF, because sharp drops metadata on every output by default.
- cause: the fixture is a smooth gradient under a grid and compresses to a fraction of a photograph; sharp only keeps EXIF when asked (`keepExif()`).
- rule: before registering a mutation for a size bound, measure what the mutated encoder produces on the fixture (`sharp(...).webp(opts).toBuffer()` length) and pick one that crosses the bound (a sharpened lossless encode gave 1,252,584 bytes); for a leak assertion the mutation must both read the leaking source and ask for the metadata (`sharp(buffer).keepExif()`). Replay it and read `WATCHED-FAIL BAD: stayed green` as a mutation too weak, not a test that is fine.
- proof: `cd app && node scripts/watchfail.mjs --registry tests/mutations --only g12-variants-hero-weight` and `--only g12-strip-variants` → `WATCHED-FAIL OK` for both (measured 2026-10-03, B2 g12).
- added: 2026-10-03

## P-334 · A db test that reads rows a CLI wrote makes the whole db project order-dependent: seed.db.test.ts and public-reads.db.test.ts could not both pass
- symptom: B2 g11's `seed.db.test.ts` read the 16 rows `bun run seed` had written and passed only on a seeded mop-dev; `public-reads.db.test.ts` (g8) asserts an exact catalog of its own `test-pr-*` rows and went red (4 cases, `properties: [ …(17) ]`) as soon as the seed had run. On an unseeded reset the seed test failed 3 cases. No database state made `bun run test:db` green, and B4's `db` job seeds before the project.
- cause: the plan wrote the seed test as a read of committed seed state, and a read-only test of someone else's writes shares the one mop-dev with every other file (R52). A test of a seed that starts from the rows a real seed left also stays green when the seed is broken (a mutation that skips a publish stayed `WATCHED-FAIL BAD: stayed green`).
- rule: a db test owns its rows. `seed.db.test.ts` clears properties and stories and closes the markets inside its rolled-back transaction, then runs the seed's own `runSeed` as the service role through a `SeedDb` made of SQL (`jsonb_populate_recordset`, same triggers and grants as supabase-js). A test that asserts an exact catalog (`public-reads`) deletes the seeded rows first inside its transaction (`set_config('mop.retention', 'on', true)`).
- proof: `cd app && eval "$(node scripts/load-env.mjs --profile dev)" && env -u CLOUDFLARE_API_TOKEN bunx vitest run --project db tests/db/seed.db.test.ts tests/db/public-reads.db.test.ts` → `Tests 22 passed (22)` on a seeded mop-dev and on a freshly reset one; `node scripts/watchfail.mjs --registry tests/mutations --only g11-seed-db-snapshot` → `WATCHED-FAIL OK` (measured 2026-10-03, B2 g11 rework).
- Hit again in the B2 g11 re-review: the rework fixed two files and ran the whole project only on an unseeded mop-dev, so `rls.db.test.ts` stayed order-dependent. Its probe copied `select ... from <table> t limit 1`, and on a seeded database `limit 1` could return a published seeded property, whose copy failed in `enforce_publish_gate` (`properties insert: P0001`) before RLS was reached (3 of 4 seeded runs red, by heap order). The whole project has to be run on a seeded mop-dev as well as a reset one, and a probe takes its row from the test's own rows: `order by t.xmin::text = pg_current_xact_id()::xid::text desc limit 1` (rows the fixtures wrote in this transaction first, any row only when a conflict skipped the fixture). Proof: `cd app && eval "$(node scripts/load-env.mjs --profile dev)" && env -u CLOUDFLARE_API_TOKEN node scripts/watchfail.mjs --registry tests/mutations --only g11-rls-own-row` → `WATCHED-FAIL OK B2:g11-rls-own-row` (it seeds, flips `desc` to `asc`, and sees `+ "properties insert: P0001"`).
- added: 2026-10-03

## P-335 · PERF-03: 100 properties of 30 photographs with full URLs in `variants` is 2,086,950 bytes, over the 1,500,000 budget; the stored shape is now sizes only
- symptom: the first `snapshot-budget.db.test.ts` printed `snapshot 2086950 bytes` for the five G59 sizes stored as `{ w, h, webp|jpg: "v/<owner>/<n>-<sha8>/<size>.<ext>" }`.
- cause: each of 3,000 media objects carried about 450 bytes of variant keys, all derivable from the `media_key` next to them (`o/<owner>/<n>-<sha8>.webp`); the review's own sum (20 to 30 KB per property) predicted it.
- rule: `MediaVariants` is `{ thumb, card, hero, og, carousel }` each `{ w, h }` and nothing else; B3's `toImageVariants` derives every address from the master key with `variantKeys`' pattern, B9's render job stores sizes only. The budget is never raised.
- proof: `cd app && eval "$(node scripts/load-env.mjs --profile dev)" && env -u CLOUDFLARE_API_TOKEN bunx vitest run --project db tests/db/snapshot-budget.db.test.ts` → `snapshot 1239950 bytes for 100 properties`, `Tests 1 passed`; `node scripts/watchfail.mjs --registry tests/mutations --only bbb` → `WATCHED-FAIL OK` (measured 2026-10-03, B2 g11 rework).
- hit again: 2026-10-04, B3 g3: the brief for steps 3 and 3b still quoted full-key variants (`{ card: { webp: "v/c.webp", w: 720, h: 480 } }`) and a test built on them; `toImageVariants` in `mappers.ts` derives each key from the master key and `tests/unit/mappers.test.ts` compares the result with `variantKeys` of `scripts/variants.ts`, so the two patterns cannot drift apart.
- added: 2026-10-03

## P-336 · `git merge origin/main` conflicts in `app/knip.json` and `app/.prettierignore` every time both sides touched them: keep both sides
- symptom: B2 g11's first merge stopped on `app/knip.json` (`ignore` of this lane, `ignoreDependencies` of main) and `app/.prettierignore`; `GOTCHAS.md` merged by entry without help.
- cause: both files are one-line-per-entry lists that every lane extends under the same marker (ruling H46 lets a group add its entry), so two lanes always touch the same lines.
- rule: resolve by hand keeping every line of both sides, run `bun run check` before committing the merge, and never take one side whole.
- proof: `git diff 19a5062^1 19a5062 --stat -- app/knip.json app/.prettierignore | tail -1` → `2 files changed, 3 insertions(+), 1 deletion(-)` (the merge commit that kept both sides, B2 g11).
- hit again: 2026-10-04, B3 g4: `git merge origin/main` conflicted in `tests/db/schema-manifest.ts`, `rls-matrix.ts` and `rls.db.test.ts` (B8's `events`, `jobs`, `job_events` against B3's three tables, both appended at the same place): keep both sides. The bank driver also exited 1 on GOTCHAS.md with `both sides changed P-712; ours kept` and left the file unmerged without markers; running `node workspace/05-plans/merge-gotchas.mjs <base> <ours> <theirs>` by hand on the three stages from `git show :1:`, `:2:`, `:3:` gave the same message, and the fix was to copy theirs' one `hit again` line into ours.
- added: 2026-10-03

## P-337 · A review snapshot cannot re-run `db:reset`: it has the env files but no `supabase link`, and `.env.ops` is not copied
- symptom: in `E:/mop-build/db-review/app`, `bun run db:reset` refused with `ref mismatch (linked none, DEV_SUPABASE_PROJECT_REF ..., DEV_DB_URL user ...)`; `supabase link` with the dev profile failed with `LinkProjectStatusError ... does not have the necessary privileges`; `load-env --profile ops` failed with ENOENT.
- cause: `review-snapshot.mjs` copies only `.env` and `app/.dev.vars`; the link lives in the ignored `supabase/.temp/` of the lane and linking needs `SUPABASE_ACCESS_TOKEN`, an ops name.
- rule: a reviewer never re-runs `db:reset` in a snapshot with `project-ref` alone. That one file passes the script's ref check, then `db-reset-dev.mjs` drops the `public` schema of the shared mop-dev, and only afterwards does `supabase db push --dry-run` fail (`DbConfigIpv6Error`, no pooler link in the snapshot): mop-dev is left with no tables while other lanes and the dev deploy read it. Never skip the re-run on trust (P-059, RULE 2): copy the whole link state first, which is the only form: `mkdir -p app/supabase/.temp && cp -r /e/mop-build/db/app/supabase/.temp/. app/supabase/.temp/` (project-ref, pooler-url, linked-project.json, cli-latest and the five version files together). `supabase link` in the snapshot does not work: CLI 2.98.2 refuses `app/supabase/config.toml` first (`'db' has invalid keys: orioledb_version; 'config.config' has invalid keys: local_smtp`). If a wipe has happened, restore it by copying the folder, `bun run db:reset`, then `bun run seed -- --target dev --mode full --images skip`. The guard belongs in `db-reset-dev.mjs` (check the pooler link before `emptyDatabase`): a follow-up for the orchestrator.
- Hit again in the B2 g11 re-review: the previous rule said to copy only `project-ref`; following it, `MOP_SINGLE_LANE=1 bun run db:reset` in the snapshot dropped `public` on mop-dev and then failed, and `seed` answered `Could not find the table 'public.markets' in the schema cache`.
- Corrected in the third B2 g11 re-review: the rule offered "skip the re-run and trust the builder's logged output", which contradicts P-059 and the review brief's step 1. The whole-`.temp` form ran `db:reset` from the snapshot with exit 0 twice in that review, so the skip option is dropped and the copy form is the only rule.
- proof: in a snapshot (`node workspace/05-plans/review-snapshot.mjs create E:/mop-build/db <sha>`, run from E:/mop-build/db) that has the whole `.temp` copied, `cd app && eval "$(node scripts/load-env.mjs --profile dev)" && MOP_SINGLE_LANE=1 env -u CLOUDFLARE_API_TOKEN bun run db:reset` exits 0 after the 13 migrations; with only `project-ref` copied the same command exits 1 on `supabase db push --dry-run failed` after the schema was dropped (measured 2026-10-03, B2 g11 re-review; run the second form only on a mop-dev you can reseed).
- Hit again in the B2 g13 review: the reviewer ran `supabase link --project-ref $DEV_SUPABASE_PROJECT_REF` in the snapshot before reading this entry and got `LinkProjectStatusError` ... `necessary privileges`; after `cp -r /e/mop-build/db/app/supabase/.temp/. app/supabase/.temp/`, `migration list --linked` exited 0. The review brief does not name the copy as a prerequisite of any `--linked` proof (not only `db:reset`): an orchestrator follow-up for the brief template. A `--linked` proof in a snapshot starts with the copy, never with `supabase link`.
- Hit again in the B8 g1 review (2026-10-04): `bun run db:lint` (it passes `--linked`) in the snapshot answered `{"code":"ProjectRefNotLinkedError"}` exit 1, and `supabase link --project-ref` exit 1 with `LinkProjectStatusError`; no `supabase/.temp` existed. A lint needs no link: `bunx supabase db lint --db-url "$DEV_DB_URL" --level warning` printed `No schema errors found`, exit 0, with the dev profile loaded. Use that form for every lint proof in a snapshot; it also lints a native cluster that holds an unmerged migration (`--db-url` pointed at it), which the linked form never can.
- added: 2026-10-03

## P-338 · A plan proof that copies into `supabase/.temp` fails in a fresh checkout: the folder exists only after `supabase link`
- symptom: B2 step 13's determinism proof (`cp tests/fixtures/photo.jpg supabase/.temp/photo.prev.jpg && node scripts/make-fixtures.mjs && git diff --no-index --exit-code ...`) printed `No such file or directory` in a review snapshot; after `mkdir -p supabase/.temp` it exited 0.
- cause: `app/supabase/.temp/` is git-ignored (`app/.gitignore` line 40) and is created by `supabase link` and by the CLI, so a fresh worktree or snapshot has no such folder. The same plan style appears in the `gen:types` proof (P-327).
- rule: a proof that writes a scratch copy under `supabase/.temp` starts with `mkdir -p supabase/.temp`, or uses a folder the checkout always has; never assume the folder from your own linked lane.
- proof: `git ls-files app/supabase | grep -c "\.temp"` → `0` and `git check-ignore -v app/supabase/.temp/photo.prev.jpg` → `app/.gitignore:40:supabase/.temp/	supabase/.temp/photo.prev.jpg` (measured 2026-10-03, B2 g12 review).
- added: 2026-10-03

## P-339 · Clearing a seeded catalog from mop-dev without `db:reset` has one working order: properties first, in one transaction
- symptom: deleting `property_media` of a seeded mop-dev to empty the catalog failed with `ERROR: ... PL/pgSQL function public.sync_property_hero_image() line 20 at SQL statement`; the second try, properties first, gave `COMMIT` and every catalog count 0 (B2 g11 re-review).
- cause: `property_media` rows drive `sync_property_hero_image`, which updates the parent property, and a published property refuses that update outside the publish path; deleting the property first removes its media by cascade and the trigger has nothing to update.
- rule: to unseed without `db:reset`, run one transaction: `set_config('mop.retention', 'on', true)`, `pg_advisory_xact_lock(hashtext('mop-dev-tests'))`, then `delete from public.properties`, then `stories`, then the rest of the catalog tables (markets, regions). Never delete `property_media` of a published property first.
- proof: `cd app && eval "$(node scripts/load-env.mjs --profile dev)" && env -u CLOUDFLARE_API_TOKEN bun run db:psql -- -At -c begin -c "select set_config('mop.retention','on',true)" -c "delete from public.property_media" -c rollback` on a seeded mop-dev → `PL/pgSQL function public.sync_property_hero_image() line 20 at SQL statement`, then `ROLLBACK`; with `delete from public.properties` in place of the `property_media` delete → `DELETE 16` then `ROLLBACK`. Keep `begin` and `rollback` in the proof: without them the properties form commits and empties mop-dev (measured 2026-10-03, B2 g11 re-review).
- added: 2026-10-03

## P-341 · `curl -o /dev/null` spawned from node on Windows exits 23: native curl has no `/dev/null`
- symptom: B2 c9's REST probe ran `execFileSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", ...])` and threw `status: 23` with `stdout: '401'`; the same flags typed in Git Bash work, because MSYS converts `/dev/null` for its own programs only.
- cause: `execFileSync` hands the argument to `curl.exe` unchanged, and Windows has no such path, so curl fails to write the body (exit 23, write error) after printing the status.
- rule: in a node script, pass `devNull` from `node:os` (`NUL` on Windows) as the output file; in Bash, `-o /dev/null` is fine.
- proof: `node -e "const {execFileSync}=require('child_process');const {devNull}=require('os');console.log(execFileSync('curl',['-s','-o',devNull,'-w','%{http_code}','https://example.com'],{encoding:'utf8'}))"` → `200`; with `'/dev/null'` in place of `devNull` it throws with `status: 23` (measured 2026-10-03, B2 c9).
- added: 2026-10-03

## P-340 · Step 14 of B2 says run `bun run db:push` to confirm nothing is pending, but on the lane it refuses, and the plan counts 12 migrations where 13 exist
- symptom: B2 g13 ran `bun run db:push` from `slice/b2` and got `refusing: branch migrations 20261001090800_catalog_version.sql 20261001090900_rls.sql 20261001091000_storage.sql 20261001091100_settings_defaults.sql 20261003082557_fn_enforce_publish_gate_stories.sql`, exit 1; the proof sentence also expects "the same 12 versions", and the lane holds 13.
- cause: `db:push` refuses every local file that is not on `origin/main` (ruling H1, DB-01), and the lane's migrations had reached mop-dev earlier through the single-lane exception, so a plain push cannot confirm "nothing pending" before the merge. The 13th migration (`fn_enforce_publish_gate_stories`) came after the plan's count was written.
- rule: from a lane, confirm "no pending migration" with commands that write nothing: `bunx supabase migration list --linked` (every row has the same local and remote version) and `bunx supabase db push --linked --dry-run` (`"upToDate":true`), with `SUPABASE_DB_PASSWORD="$DEV_SUPABASE_DB_PASSWORD"` after the dev profile is loaded. Count the versions from `ls supabase/migrations/*.sql`, never from the plan; `bun run db:push` itself runs from `main`.
- proof: `cd app && eval "$(node scripts/load-env.mjs --profile dev)" && SUPABASE_DB_PASSWORD="$DEV_SUPABASE_DB_PASSWORD" env -u CLOUDFLARE_API_TOKEN bunx supabase db push --linked --dry-run 2>&1 | tail -1` → `{"upToDate":true,"dryRun":true,"migrations":[],"seeds":[],"roles":[],"message":"Remote database is up to date."}` (measured 2026-10-03, B2 g13).
- added: 2026-10-03

## P-506 · `startAt` in build-slice.js dropped the close-out groups, so a run meant to fix and continue skipped the fix
- symptom: B3 relaunch with `closeOut: [c1]` and `startAt: "g2"` started `build:B3:g2:2` straight away; `close:B3:c1:1` never ran and the lane began step 2 with a red typecheck (run `wf_ea63edc9-5b1`, 2026-10-03 22:10).
- cause: the script prepended the close-outs to the sized groups and then sliced from `startAt`; the close-out ids (c1) sit before g2, so the slice cut them off.
- rule: `startAt` applies to the sized groups only; close-outs are prepended after the slice. When a close-out is owed, launch it alone or with `startAt` and check the journal's first label is `close:`.
- proof: `node <scratchpad>/trace/simulate-workflow.mjs` → `simulation: 6 scenarios passed`; the journal of `wf_ea63edc9-5b1` shows `build:B3:g2:2` as its first label.
- added: 2026-10-03

## P-507 · Marking a slice `closed` in PLAN.md turns its remaining STUB markers into a red `stubs` gate, and a docs-only merge never runs that gate
- symptom: the ledger pull request (PR 94) set B2 to `closed`; the gate called it documents-only and merged it without CI; the next code pull request (PR 95) failed `bun run stubs` with `scripts/seed.ts:89 STUB(B2) slice is closed` (2026-10-03 22:20).
- cause: `scripts/stubs.ts` reads the slice status table of PLAN.md and refuses a marker whose slice is closed; the status change and the marker live in different files, so the docs-only shortcut let main go red without a check.
- rule: before writing `closed` in a plan row, run `cd app && bun run stubs` with that row edited locally; re-label any remaining marker to the slice that owns the work (here STUB(B9 step 6)) in the same pull request.
- proof: `cd app && bun run stubs` → `stubs: 15 markers, 0 on closed slices` on main at 60f3886; at 21872ef it printed `1 on closed slices` and exit 1.
- added: 2026-10-03

## G-302 · Supabase Storage answers a missing object with HTTP 400 and the status in the body, so a route that waits for a 404 reports an outage
- paths: app/src/server/public/media.ts, app/src/server/lib/media-store.ts
- severity: warn
- symptom: under the built Worker (port 8828) `GET /media/v/none/0-aaaaaaaa/hero.webp` answered 503 `storage_unavailable` instead of 404, although the plan (H33 (4)) and the first `serveMedia` map a Storage 404 to `not_found`; the unit test passed because its fake Storage said 404.
- cause: Storage's REST API answers a missing object, and a missing bucket, with `400 Bad Request` and `{"statusCode":"404","error":"not_found","message":"Object not found"}` (measured on mop-dev, 2026-10-04).
- rule: classify a Storage answer by status 404, or by status 400 whose body has `statusCode` 404 (`isMissing` in `media.ts`); every later Storage reader (B6 signing, B8 delete, B9) does the same, and a fake of Storage models the real 400.
- proof: `curl -s -o /dev/null -w "%{http_code}" "https://$DEV_SUPABASE_PROJECT_REF.supabase.co/storage/v1/object/public/media/v/none/0-aaaaaaaa/hero.webp"` (dev profile loaded) prints `400`; `cd app && bunx vitest run --project unit tests/unit/media-route.test.ts` passes and registry entries `b3-g3-media-400` and `b3-g3-media-400-body` turn its "reads Storage's 400" case red.
- added: 2026-10-04

## G-303 · The public snapshot carries neither `campaign_tier` nor `source`, so `Property.campaignTier` and `source` are optional
- paths: app/src/domain/property.ts, app/src/server/public/mappers.ts, app/tests/api/parity.api.test.ts
- severity: warn
- symptom: B3 step 3's mapper builds `Property` from `public_catalog_snapshot()`, whose property object lists neither column (`publicPropertyKeys` of B2, closed), while the schema required both; the live API could not satisfy its own type and the browser's `propertySchema.parse` would have refused every property.
- cause: the plan's mapper line lists the mapped fields, the snapshot lists its public keys, and nobody compared them with the domain type. The two columns are commercial and internal, so leaving them out of the public snapshot is right.
- rule: both fields are `.optional()` in `src/domain/property.ts` and the mapper never sets them; step 4's parity test compares every field but these two; `enums.check.ts` compares `NonNullable<...>` with the database enum; the seed writes `?? "Editorial"`, the column default.
- proof: `cd app && grep -c "campaign_tier" supabase/sql/functions/public_catalog_snapshot.sql` → `0`; `grep -c "optional()" src/domain/property.ts` counts both fields among the optional ones; `bun run typecheck` exits 0 (2026-10-04, B3 g3).
- added: 2026-10-04

## P-807 · A hoisted `vi.mock` factory runs once and survives `vi.resetModules()`: rows pushed into its array pile up and its `AppError` is another class than the one a fresh import sees
- symptom: B3 g3's `public-pipeline.test.ts` replaced `routes.ts` through a hoisted `vi.mock(path, factory)` that kept the table in `vi.hoisted` and called `vi.resetModules()` before each import of `pipeline.ts`: from the second test on every write answered 500, and the 404 test logged `AppError: There is nothing at this address.` as an unhandled error. The same case passed alone.
- cause: vitest keeps the result of a `vi.mock` factory across `resetModules`: the extra rows of all earlier tests stayed in one array (the first test's `/api/public/echo` row won), and the factory's `importOriginal` had loaded `routes.ts` and `errors.ts` in the first graph, so `error instanceof AppError` was false in the fresh `pipeline.ts`.
- rule: for a fresh module graph per case with one module replaced, call `vi.resetModules()`, then `vi.doMock(path, factory)` with an array made inside the same helper, then import the module under test. `vi.mock(path, { spy: true })` without a factory is fine with `resetModules`.
- proof: `cd app && bunx vitest run --project unit tests/unit/public-pipeline.test.ts tests/unit/log.test.ts` → both pass; `grep -c "vi.doMock" tests/unit/public-pipeline.test.ts` → `1` (2026-10-04, B3 g3).
- added: 2026-10-04

## P-808 · A script that imports server files is type-checked under `tsconfig.scripts.json`, which has no DOM library: `RequestInfo` in `db.ts` failed `bun run check`
- symptom: once `scripts/deno-portable.ts` existed, `bun run check` failed in `tsc -p tsconfig.scripts.json` with `src/server/lib/db.ts(26,11): error TS2552: Cannot find name 'RequestInfo'`, while `tsconfig.json` was clean.
- cause: `scripts/**/*.ts` is checked with `lib: ["ES2022"]`; the script's import chain (`state.ts` then `db.ts`) brings server files into that project, and `RequestInfo` is a DOM name.
- rule: write `Parameters<typeof fetch>[0]` for a fetch input in any file a script can reach; every line added to `deno-portable.ts` (steps 7 and 8) is followed by `bun run typecheck`, not only by `deno check`.
- proof: `cd app && bun run typecheck` exits 0; with `input: RequestInfo | URL` back in `src/server/lib/db.ts` it prints TS2552 (2026-10-04, B3 g3).
- added: 2026-10-04

## P-809 · The plan's `tests/api/env.ts` line promises exports the dev loader does not make, and an agent shell's own `SUPABASE_URL` would win
- symptom: the plan says `tests/api/env.ts` sets `RATE_LIMIT_SALT` from `PREVIEW_RATE_LIMIT_SALT` and throws when neither exists, and that `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` "come from the dev loader shell"; the dev profile of `scripts/load-env.mjs` exported only the four `DEV_*` names, so every API test would have thrown on the salt, and the two Supabase names were never set (P-331).
- cause: the plan was written before B2's loader fixed its allow-list.
- rule: the dev profile exports `PREVIEW_RATE_LIMIT_SALT` too; `tests/api/env.ts` builds `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `DEV_SUPABASE_PROJECT_REF` and `DEV_SUPABASE_SERVICE_ROLE_KEY` when they exist, over any value a shell already holds, so the project written to is the guarded one. `SENTRY_DSN` is not exported: no API test sends to Sentry.
- proof: `cd app && env -u CLOUDFLARE_API_TOKEN bash -c 'eval "$(node scripts/load-env.mjs --profile dev)"; bunx vitest run --project db tests/api/catalog.api.test.ts'` → `Tests 5 passed`; with the name removed from `load-env.mjs` it throws `PREVIEW_RATE_LIMIT_SALT is not set` (2026-10-04, B3 g3).
- hit again: 2026-10-04, B3 g6 review: the reviewer's first live spike run failed `Invalid environment: RATE_LIMIT_SALT Required at parseEnv (src/server/lib/env.ts:55)`, because `getDb` imports `env.ts` and the dev profile exports the salt only as `PREVIEW_RATE_LIMIT_SALT`; the log's live proofs were prose, so nothing told the reviewer to import `tests/api/env.ts` first (P-825).
- added: 2026-10-04

## P-810 · A test client made with `createClient(url, key)` and no `Database` type is untyped, and the lint refuses every rpc argument passed to it
- symptom: B3 g2's second red `bun run check` failed `bun run lint` with `@typescript-eslint/no-unsafe-argument` on the `.rpc(...)` calls in `tests/api/ratelimit.api.test.ts`; the prettier failure of the same run (P-415) hid it until the first was fixed.
- cause: `serviceClient()` in `tests/fixtures/service.ts` called `createClient(url, key, ...)` without the generated `Database` type, so `rpc` took and returned `any` and the strict type-aware preset (R01) refused the arguments.
- rule: every Supabase client in app or test code is `createClient<Database>(...)` with `Database` from `src/db`; run `bun run lint` on a new fixture before the first full `bun run check`.
- proof: `grep -n "createClient<Database>" app/tests/fixtures/service.ts` → one line; with `<Database>` removed, `cd app && bunx eslint --max-warnings 0 tests/api/ratelimit.api.test.ts` prints `no-unsafe-argument` (recorded from the g2 review, not re-run).
- added: 2026-10-04

## P-811 · `bunx supabase migration list --linked` can fail once with `DbConnectError` "Connection terminated unexpectedly" and pass on the immediate rerun
- symptom: the first run exited 1 with `{"code":"DbConnectError",...,"Connection terminated unexpectedly"}` (session pooler, `cli_login_postgres`); the same command run again at once exited 0 and listed the migrations. A reader can take the first red for a schema or link problem.
- cause: the session pooler drops a cold connection; it is a transport error, not a state of the schema.
- rule: on `DbConnectError` from a read-only `supabase` command, rerun it once before opening the migration or the link; two failures in a row is a real obstacle (record BLOCKED), and never repeat a write (`db push`) as a blind retry.
- proof: `cd app && env -u CLOUDFLARE_API_TOKEN bunx supabase migration list --linked` → exit 0 and the migration table (after `supabase link --project-ref "$DEV_SUPABASE_PROJECT_REF"` in the dev loader shell); the failure is intermittent and was seen once (2026-10-04, B3 g2 review).
- added: 2026-10-04

## P-900 · While the api lane is mop-dev's schema writer, B2's schema, rls and function-source tests are red on mop-dev for every other lane
- symptom: B8 g1 proved its unmerged jobs migration with the prelude (P-312) and got `Tests  4 failed | 36 passed (40)` from `schema.db.test.ts`, `2 failed | 12 passed (14)` from `rls.db.test.ts` and `withoutFile: [confirm_subscriber, create_inquiry, ... upsert_subscriber]` from `function-source.db.test.ts`. Without the prelude the same files were red too (7, 11 and 1 failures). Every diff named B3's objects (`rate_limits`, `webhook_receipts`, `subject_requests`, `submissions.duplicate_of`, `subscribers.pending_source`), none named `events`, `jobs` or `job_events`.
- cause: ruling H1 (a) makes the api lane (B3) the one writer of `mop-dev` until it merges, so `mop-dev` holds B3's migration `20261003184651` while `origin/main`'s newest is `20261003173858`, and the manifest, the RLS matrix and the function files on `main` do not know B3's objects yet.
- rule: before reading a red B2 schema test as your own, check `supabase_migrations.schema_migrations` against `ls supabase/migrations` on `origin/main`; when mop-dev is ahead, judge your change by the diff lines alone (`grep -E "^\s+[-+] " | grep -ciE "<your tables>"` prints 0 when none of the red is yours) and say in the log which reds are the other lane's. Never edit the manifest or matrix for another lane's tables.
- proof: from `app/` with the dev profile, `env -u CLOUDFLARE_API_TOKEN bun run db:psql -- -Atc "select version from supabase_migrations.schema_migrations order by version desc limit 1"` → `20261003184651` while `git ls-tree --name-only origin/main supabase/migrations/ | tail -1` ends `20261003173858_fn_enforce_publish_gate.sql`; `env -u CLOUDFLARE_API_TOKEN node node_modules/vitest/vitest.mjs run --project db tests/db/schema.db.test.ts 2>&1 | grep "Tests "` → `7 failed | 33 passed (40)` on slice/b8 without the prelude (measured 2026-10-03, B8 g1).
- added: 2026-10-03

## P-901 · A `sql` registry entry for a test that runs under `committed()` never replays: it stays green whatever the mutation does
- symptom: the B8 g1 review replayed entry `e` (`claim_job` accepting `running`) of `tests/mutations/B8.json` on a native PostgreSQL 18 cluster holding the jobs migration: `WATCHED-FAIL BAD: stayed green (B8:e)`. The same mutation applied by hand and committed turned the parallel-claim case red (`+   "second": 1`). The author's log had called the entry "replayable after the merge".
- cause: watchfail hands a `sql` entry to the test as `MOP_MUTATION_SQL`, and only `withRollback` in `tests/fixtures/db.ts` runs it; `committed()` cannot (it would commit the mutation to the shared database), so a committed case never sees it.
- rule: a committed case that a `sql` entry covers applies `MOP_MUTATION_SQL` itself, in a connection whose transaction rolls back (the parallel claim applies it in the second claim's transaction and ends that one with `rollback`). Otherwise its entry is `manual` with a procedure someone can re-run. Replay every entry on a database that holds the migration before calling it replayable; a red for the wrong reason (`relation ... does not exist`) proves nothing about the replay.
- proof: from `app/`, with a native cluster holding the B8 migration (`DEV_DB_URL=postgresql://postgres@127.0.0.1:<port>/postgres`), `node scripts/watchfail.mjs --registry <folder with B8.json> --only e` → `WATCHED-FAIL OK B8:e`; with the line that runs `MOP_MUTATION_SQL` in the parallel-claim case removed → `BAD: stayed green` (measured 2026-10-03, B8 g1 fix).
- added: 2026-10-03

## P-713 · `watchfail.mjs --registry tests/mutations` replays every registry of the repository, and `--changed` sees only committed work
- symptom: B9 g5 ran `node scripts/watchfail.mjs --registry tests/mutations --kinds unit` to replay its 35 new entries; it started on B1b and went on through B2 and B4 (873 entries in all, the B4 ones mutate `scripts/watchfail.mjs` itself). Killing it left `src/lib/cx.ts` mutated and later `scripts/watchfail.mjs` (`git status --short` showed both). With `--changed origin/main` and the work still uncommitted it printed `replayed 0 ... 873 not selected`. Five minutes went on the two kills and the restores.
- cause: `loadRegistries` reads every `*.json` of the folder, `--only` takes one id, and `--changed <ref>` diffs `<ref>...HEAD`, so uncommitted files are never selected; the runner starts each `run` through the Windows shell, where `!`, `rm -rf` and globs do not exist.
- rule: commit locally first (no push), then run `node scripts/watchfail.mjs --registry tests/mutations --changed origin/main --kinds unit` in the background and poll with loops under 100 s; never kill it, and if it must die, restore only the files `git status --short` shows modified and that were clean before (P-068). A `run` is a plain command line with no shell syntax; a mutation whose proof needs a pipe or a browser is a `manual` entry run by hand once.
- proof: `cd app && node scripts/watchfail.mjs --registry tests/mutations --changed origin/main --kinds unit 2>&1 | tail -1` on slice/b9 after the group's commit → `watchfail: replayed 47: ok 47, bad 0, stale 0; manual 5 not replayed; 821 not selected` (measured 2026-10-03, B9 g5; before the registry fix of P-714 the line read `ok 45, ... stale 1`).
- added: 2026-10-03

## P-714 · A `.mjs` script that imports a `.tsx` template pulls `src/config/site.ts` into `tsconfig.scripts.json`, and the line it needs changes a registry `find`
- symptom: `bun run typecheck` failed with four `TS4111: Property 'VITE_SITE_URL' comes from an index signature` in `src/config/site.ts` the moment `render-cover.mjs` imported `Cover.tsx` (which imports `src/lib/format.ts`, which imports `site.ts`). After the fix prettier wrapped the one-line `include` array, and the registry entry `hy-gate-include` of B1b went STALE (`find occurs 0 times in tsconfig.scripts.json`).
- cause: `tsconfig.scripts.json` includes only `scripts/**`, so `src/env.d.ts`, which types `import.meta.env`, is outside that program; a script that reaches `site.ts` through a template sees the generic `ImportMetaEnv`. The registry entry quoted the include line's old text.
- rule: add `"src/env.d.ts"` to the `include` of `tsconfig.scripts.json` (ruling H46) before the first script that imports a template, run `bunx prettier --write` on it, and then take the `find` of every registry entry on that file from the formatted text (P-066): `grep -rn "tsconfig.scripts.json" app/tests/mutations`.
- proof: `cd app && grep -c "src/env.d.ts" tsconfig.scripts.json && bunx tsc --noEmit -p tsconfig.scripts.json; echo $?` → `1` then `0`; `node scripts/watchfail.mjs --registry tests/mutations --only hy-gate-include 2>&1 | tail -2 | head -1` → `WATCHED-FAIL OK B1b:hy-gate-include` (measured 2026-10-03, B9 g5).
- added: 2026-10-03

## P-715 · A size check that compares a screenshot with the viewport it was taken at measures nothing: declare the size apart and compare the frame's own box
- symptom: B9 g5's first `shoot.mjs` checked the JPEG's header against `frame.viewport` (or the clip). Plan watched-fail (a), a cover viewport of 1200x628, would have stayed green: the page was shot at 628 and the file said 628.
- cause: the expected value and the measured value came from the same number (global RULE 2: a check that shares its answer with the thing it checks proves nothing).
- rule: each frame declares the size its file promises (`size`) as its own literal; the browser window is `size` unless the frame is clipped, and `shoot.mjs` measures the template's own box (`.social-frame` `getBoundingClientRect`) against the window and the file against `size`. A change of the window, of a template's tokens or of a clip then fails with both numbers named.
- proof: with `size: { width: 1200, height: 628 }` on the `cover` frame of `scripts/render-cover.mjs`, `cd app && bun scripts/render-cover.mjs --fixture --out .tmp/wf 2>&1 | tail -1` → `shoot: cover frame is 1200x630, the viewport 1200x628` (registry entry `b9g5-cover-viewport`, measured 2026-10-03).
- added: 2026-10-03

## P-716 · A file named `.jpg` proves nothing about its bytes: assert the signature where the file is made
- symptom: B9 g5's review: changing the screenshot `type` in `shoot.mjs` to png left every proof green. Three PNG files were written as `<name>.<hash>.jpg`, `png-size` accepts both formats, and the upload content-type is a literal; the author's watched-fail (t) changed only the extension literal, which tests naming.
- cause: the extension, the screenshot type and the content-type were three separate literals, and nothing read the bytes back (global RULE 2: a mutation must be of the thing the contract names, not a neighbour of it).
- rule: `capture()` in `scripts/lib/shoot.mjs` refuses a screenshot that does not start with the JPEG signature (`ff d8`) before anything is named or stored. The mutation is the screenshot `type`, not the extension.
- proof: `cd app && node scripts/watchfail.mjs --file scripts/lib/shoot.mjs --find $'type: "jpeg",\n      quality: JPEG_QUALITY,' --replace 'type: "png",' --run 'bun scripts/render-cover.mjs --fixture --out .tmp/wfp' --expect 'not a JPEG'` → `WATCHED-FAIL OK scripts/lib/shoot.mjs` (registry entry `b9g5-cover-not-jpeg`, measured 2026-10-03).
- added: 2026-10-03

## P-717 · A watchfail replay written to a file holds NUL bytes and a nested replay: grep it with `-a` and read the last `watchfail: replayed` line
- symptom: B9 g5's reviewer ran the full `watchfail.mjs --registry tests/mutations --changed origin/main` with stdout redirected to a file. `grep` answered `Binary file matches`, and the first summary found (`replayed 37 ... B8`) was not the result of the slice (a few minutes).
- cause: the runner's child output carries NUL bytes, which makes grep treat the file as binary; the replay also runs the B8 registry as a nested replay with its own `watchfail: replayed 37` line ahead of the real summary (P-713: it replays every registry).
- rule: read a redirected replay with `grep -a`, and take the last `watchfail: replayed` line as the result; the earlier ones belong to nested registries.
- proof: `cd app && node scripts/watchfail.mjs --registry tests/mutations --changed origin/main --kinds unit > .tmp/wf.txt 2>&1; grep -a 'watchfail: replayed' .tmp/wf.txt | tail -1` → the B9 line, `watchfail: replayed 47: ok 47, bad 0, stale 0; ...` (reviewer's run: `replayed 37` on line 38, `replayed 47` on line 102).
- added: 2026-10-04

## P-812 · Step 4's "zero differences" is not literal, step 5's contract test names a migration file that does not exist, and the allow-list test has nothing to compare with
- symptom: the first run of the parity proof printed 49 differences on `/properties` and 6 on `/stories`: `id` (`mop-001` against a uuid), `campaignTier` and `source` (G-303) and the list order (live newest first, bundled in authoring order); `/markets` had none. Step 5 has `contracts-live.test.ts` parse `supabase/migrations/20261001100000_public_write_functions.sql`, but the file is `20261003184651_public_write_functions.sql` (a pushed migration takes its push timestamp). Step 5 also asks `analytics-allowlist.test.ts` to assert equality with the server allow-list, which step 10 creates.
- cause: the plan was written before the seed derived uuids (`stableId`), before the snapshot ordered by `published_at desc, id`, and before migrations were renamed to their push timestamps; a test that compares two lists needs both lists to exist.
- rule: the parity test omits `id` (and `campaignTier`, `source` on properties) from the comparison and asserts them apart (uuid shape, newest first), so every other field is compared and a difference names its path; a test reads a migration by its suffix `_<name>.sql`, never by timestamp; `analytics-allowlist.test.ts` checks the one `analyticsEvents` list against the `track("<name>"` calls of `src` until step 10 adds the server allow-list that imports it.
- proof: `cd app && bunx vitest run --project db tests/api/parity.api.test.ts` → 3 passed; `git grep -c "endsWith" -- tests/unit/contracts-live.test.ts` → 1 (measured 2026-10-04, B3 g4).
- added: 2026-10-04

## P-813 · A merge that brings a dependency leaves `node_modules` behind: `bun run typecheck` fails with TS2307 on code another lane wrote
- symptom: after `git merge origin/main`, `bun run typecheck` printed `scripts/lib/shoot.mjs(8,23): error TS2307: Cannot find module 'puppeteer-core'` and exited 2, in a group that never touched `scripts/`.
- cause: the merge brought the design lane's `package.json` and `bun.lock`; the lane's `node_modules` still held the old set.
- rule: after a merge that changes `app/package.json`, run `bun install` in `app/` before reading a typecheck or lint failure as your own.
- proof: `cd app && bun install` printed `+ puppeteer-core@25.12.0`, then `bun run typecheck` exited 0 (measured 2026-10-04, B3 g4).
- added: 2026-10-04

## P-814 · A route file that declares only `GET` (and `HEAD`) lets every other method render the page shell: the handler's own 405 never runs
- symptom: B3 g3's review sent `curl -X POST /media/x.webp` to the built Worker: `200 text/html`, 2915 bytes of `<!DOCTYPE html>`; `PUT` and `DELETE` the same. On `/api/public/*` a `POST` got B1b's backstop, 405 with no `Allow` header. `media-route.test.ts` and the `b3-g3-media-allow`, `b3-ppp` and `b3-g3-pipe-allow-head` entries called `serveMedia` and `handlePublic` directly, so they passed on a path the Worker never takes.
- cause: TanStack Start picks `handlers[METHOD] ?? handlers.ANY` (`createStartHandler.js`) and renders the route as a page when neither exists. G-022 is enforced by `pipeline.test.ts` only under `/api/`, so `/media/$` (outside `/api/`) had no backstop.
- rule: a server route file whose handler owns the method rule declares `ANY`, not `GET` and `HEAD`, and a test reads the route file for `ANY` (a unit test of the handler alone cannot see the file). Proof against the built Worker, not the handler.
- proof: `cd app && bunx vitest run --project unit tests/unit/media-route.test.ts tests/unit/routes-parity.test.ts` passes; registry entries `b3-g3-media-any` and `b3-g3-parity-method` turn it red; under `wrangler dev --config .output/server/wrangler.json --port 8828` `curl -s -D - -o /dev/null -X POST http://127.0.0.1:8828/media/x.webp` → `405`, `Content-Type: application/json`, `Allow: GET, HEAD` (before: `200 text/html`), and the same POST to `/api/public/properties` → `405` with `Allow: GET, HEAD` and `x-mop-cache: bypass` (measured 2026-10-04, B3 g3).
- added: 2026-10-04

## P-815 · One in-flight load shared by every version hands a request for a newer version the older load's result
- symptom: found by reading in B3 g3's review: `catalogFlight` in `state.ts` was one promise for all versions, so a request whose state had moved to v6 while a v5 snapshot load was in flight awaited the v5 load, and `cachedResponse` then stored the v5 body under the v6 key with a one-year `s-maxage`.
- cause: `catalogFlight ??= load(...)` ignores `state.catalogVersion`; the test "makes one snapshot call for requests that arrive together" only races equal versions.
- rule: a shared in-flight promise is keyed by what it answers for (`{ version, load }`), and a test holds the old load open while the state moves on.
- proof: `cd app && bunx vitest run --project unit tests/unit/state.test.ts -t "newer version"` passes; registry entry `b3-g3-state-flight-version` turns it red (`expected 5 to be 6`).
- added: 2026-10-04

## P-816 · Rework not banked in the first B3 g3 attempt: the stale `b3-g3-media-503` entry, `bun run dev` answering 500, two BAD watched-fails
- symptom: (1) the entry `b3-g3-media-503` was added in the commit that rewrote its `find` line, and the log said all 94 entries replayed "ok 1, bad 0, stale 0": `--only b3-g3-media-503` printed `STALE ... find occurs 0 times` and exited 2; `tests/unit/mutation-registry.test.ts` passed over it. (2) `start.ts` importing `env.ts` made `bun run dev` answer 500 for every page (no `RATE_LIMIT_SALT`); `vite.config.ts` now sets `MOP_ENV` and a local salt for `serve` only. (3) `b3-g3-map-master` and `b3-g3-media-log` were first BAD: a Zod object drops an extra key, so a test that parses the line cannot go red when a key is added; compare the key list.
- cause: the claim in the log was written from the intent, not from a replay after the last edit (P-066, P-059); a module that throws on a missing variable breaks the dev server before any test runs.
- rule: after the last edit of a mutated file run `node scripts/watchfail.mjs --registry tests/mutations --only <id>` for each of its entries and paste the real count; a plain count of `find` occurrences over every registry is a cheap stale check, and `--only <id that matches nothing>` is not one: it validates entry fields, never counts `find`, and exits 64 (hit again 2026-10-04, B3 c3: the log claimed "stale 0" from it while a real count over 909 file entries found 12, three of them B3's own after g5 edited `state.ts` and `service.ts`). A new env read that throws needs its dev value in `vite.config.ts` in the same commit, and `bun run dev` answers `/` once.
- proof: `cd app && node scripts/watchfail.mjs --registry tests/mutations --only b3-g3-media-503` → `WATCHED-FAIL OK B3:b3-g3-media-503` (2026-10-04, after the `find` was rewritten).
- added: 2026-10-04

## P-817 · A preview left running by a dead agent holds `.output`: `bun run build` fails with EBUSY on `rmdir .output/public`, and a `db`-project registry entry replays BAD in a shell without the dev profile
- symptom: B3 c3's first `bun run build` printed `EBUSY: resource busy or locked, rmdir 'E:\mop-build\api\app\.output\public'`. The fix agent that died in the network outage had left `wrangler dev` (node, workerd, esbuild) serving the lane port 8828 from `.output`. Separately, `node scripts/watchfail.mjs --registry tests/mutations --only b3-g3-catalog-404` printed `WATCHED-FAIL BAD: wrong reason` because `tests/api/*.api.test.ts` runs in the `db` vitest project, whose global setup refuses a shell that holds `CLOUDFLARE_API_TOKEN`; the red text was `refusing: ops variables in this shell`, not a failing assertion. The entry was first reported "UNPROVEN, the CI `db` job replays it"; ci.yml has no `db` job (check, build and merge-gate only) and no CI job runs watchfail, so nobody would ever have replayed it. Under the dev profile both `b3-g3-catalog-404` and `b3-g3-catalog-etag` replay `WATCHED-FAIL OK` in about a minute.
- cause: an agent that dies does not stop the processes it started; the next agent in the lane inherits them. The `db` project reads and writes `mop-dev` through the pooler (`tests/db/global-setup.ts` accepts `DEV_DB_URL`), so it needs the dev profile, not a local cluster (P-310).
- rule: before the first build of a resumed lane list the processes whose command line names the lane tree (`Get-CimInstance Win32_Process | Where-Object CommandLine -match 'mop-build.api'`) and stop the ones that hold the lane port, by process id; replay a `db`-project entry from `app/` with `eval "$(node scripts/load-env.mjs --profile dev)"` then `env -u CLOUDFLARE_API_TOKEN node scripts/watchfail.mjs --registry tests/mutations --only <id>` (P-310; the shell does not keep the profile between Bash calls, so it goes in the same call). Never write "left to CI" for a watched-fail: no CI job replays the registry (P-819).
- proof: `powershell -NoProfile -Command "Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq 8828"` prints nothing before `cd app && bun run build` exits 0 (measured 2026-10-04, B3 c3; before: EBUSY); `cd app && eval "$(node scripts/load-env.mjs --profile dev)" && env -u CLOUDFLARE_API_TOKEN node scripts/watchfail.mjs --registry tests/mutations --only b3-g3-catalog-404` → `WATCHED-FAIL OK B3:b3-g3-catalog-404`, exit 0 (2026-10-04).
- hit again: 2026-10-04, B3 g5: the three `db`-project parity entries replayed `WATCHED-FAIL OK` on the laptop once the shell held the dev profile (`eval "$(node scripts/load-env.mjs --profile dev)"`, `env -u CLOUDFLARE_API_TOKEN`): a parity test only reads `mop-dev` through `handlePublic`, so no db entry is left to CI. A mutation inside a function that both sides of a parity test call (`pickCard`) stays green there (`BAD: stayed green`); mutate the mapper only the live side calls.
- added: 2026-10-04

## P-818 · A plan's field list for a list-card type is not exhaustive: the readers decide it, `Pick<...> & { x?: Y }` is not a supertype of the full type under `exactOptionalPropertyTypes`, and the byte budget disagrees with the fields
- symptom: B3 g5 (step 5b). `PropertyCard` with the plan's fields (slug, title, place fields, price, beds, baths, interiorSqFt, ranks, heroImage) left `tsc` red in `_site.$market.index.tsx` and `sitemap[.]xml.ts` (`publishedAt`), and the feature filter, `featuresOf` and the matcher read `features` through `designFeatures`, which only a narrowed parameter type shows. Then `Property` was not assignable to `PropertyCard` (`Type 'undefined' is not assignable to type 'Pick<...>'`) because `heroVariants?: Pick<ImageVariants, "card">` refuses the `undefined` that Zod's optional carries. With `features` and `publishedAt` in, the cards measure 527 to 638 bytes with a `/media` hero address (7 of 16 over 600; 618 to 739 with one card rendition, all 16 over), above the 600 bytes per item that PERF-06, `mappers.test.ts` and B4's `payload-budget.api.test.ts` state; the plan's own field list gives 371 to 428.
- cause: the plan wrote the list from the card component and said "at least"; the filters, the sitemap and the matcher were read by name, not by field. The 600 bytes was set from the list without `features`.
- rule: build a list-card type by compiling: start from the plan's list, run `bunx tsc --noEmit`, add what each reader reports, then read the helpers whose parameter is still the full type (`designFeatures`, `applyFilters`) for fields tsc cannot see; declare optional card fields `?: T | undefined` so the full type stays assignable; measure `JSON.stringify(pickCard(p)).length` over the real data before trusting a byte budget. A budget the fields cannot meet is a plan defect to rule on (derive `designFeatures` names, or raise the budget), not a reason to drop a field a reader needs.
- proof: `cd app && bun -e 'import { properties } from "./src/data/properties"; import { pickCard } from "./src/lib/property-card"; const n = properties.map((p) => JSON.stringify({ ...pickCard(p), heroImage: "/media/o/" + p.slug + "/hero-0badc0de.webp" }).length); console.log(Math.min(...n), Math.max(...n))'` → `527 638` (2026-10-04; the address is replaced because under bun `heroImage` is an absolute file path, so the bytes change with the folder name: the first proof printed `541 643` here and `548 650` in the reviewer's folder); with `publishedAt` taken out of the `Pick` in `src/domain/property.ts`, `bunx tsc --noEmit -p .` prints `Property 'publishedAt' does not exist on type 'PropertyCard'` in `_site.$market.index.tsx`.
- added: 2026-10-04

## P-819 · A proof line that hands the work to something that does not exist, or that never measured the thing, is a false proof
- symptom: B3 c3's log said two registry entries were "UNPROVEN, the CI `db` job replays them" (no such job: ci.yml lists check, build and merge-gate), and "stale 0 over all 1099 entries" from `--only zz-none` (a command that exits 64 before it counts a single `find`). A reviewer replayed both entries in a minute and found stale `find` entries; the real count, taken by script in the next round, was 12 of 909 file entries stale before the repair and 9 after (logs/B3.md, c3 round 2). The same slice also hit `python -` (P-094) again, a stray habit that ran before the real command in the same chain.
- cause: the line was written from what should be true, not from running the check on the case it claims to cover. A check that cannot go red on the defect it names is not a check (RULE 2), and a handoff to a job nobody wrote is a skipped proof.
- rule: (1) before writing "left to CI" or "the X job covers it", `grep -n "^  [a-z-]*:$" .github/workflows/ci.yml` and read that the job exists and runs that command; otherwise the proof is yours to run now. (2) Before pasting a count as proof, make it go non-zero once on a known case (one stale `find` put in on purpose) and read its exit code. (3) A `BAD` from a replay is read for its red text first (`refusing:` is the shell, P-310; `find occurs 0 times` is the registry): fix the cause, never hand it on. (4) Every lane starts a Bash call that needs the dev profile with the profile in that same call.
- proof: `grep -c "^  db:" .github/workflows/ci.yml` → `0` (2026-10-04); `node scripts/watchfail.mjs --registry tests/mutations --only zz-none; echo $?` from `app/` → `64`.
- added: 2026-10-04

## P-508 · `supabase gen types --project-id` and `migration repair --linked` answer 403 for this account; the pooler route works
- symptom: `bun run gen:types` exited 1 with `GenTypesUnexpectedStatusError ... Your account does not have the necessary privileges to access this endpoint`; `supabase migration repair --linked` failed the same way (`DbConfigLoginRoleStatusError 403`) (2026-10-04 01:00, main folder, stored CLI login and the `.env` token both present).
- cause: the management endpoints the CLI uses for those two commands need an organisation privilege the account no longer has; the database itself is reachable through the pooler with the dev profile.
- rule: regenerate types with `bun run gen:types -- --db` (reads mop-dev over the pooler, formats with prettier so `--local` in CI compares equal); repair migration history with SQL on `supabase_migrations.schema_migrations` and `public.migration_checksums` through `bun run db:psql`, never by hand-editing files.
- proof: `cd app && eval "$(node scripts/load-env.mjs --profile dev)" && env -u CLOUDFLARE_API_TOKEN bun run gen:types -- --db` → `wrote src/db/types.ts`; the project-id mode in the same shell → exit 1 with the 403 text.
- added: 2026-10-04

## P-509 · An agent that dies mid-group (network outage) ended the whole run; the harness now retries it once
- symptom: `fix1:B3:g3:3,3b` died with `API Error: Can't reach the API server (ENOTFOUND)` when the laptop lost internet; `build-slice.js` took the null result as the fix's answer, the run ended with step 3 unfixed, 15 files of partial work sat uncommitted in the lane, and the groups after it never ran (run `wf_ea63edc9-5b1`, 2026-10-04 02:3x).
- cause: the Workflow tool returns null for an agent that dies after its own retries; the script had no retry of its own.
- rule: every agent call in `build-slice.js` goes through `callAgent`, which retries once after a pause (`retryPauseMs`, default two minutes) with a `:retry` label. After an outage, commit a dead agent's partial work as a WIP commit (so the next agent sees it in history and starts from a clean tree) before relaunching.
- proof: `node <scratchpad>/trace/simulate-workflow.mjs` → `simulation: 6 scenarios passed` with the wrapper; the journal of `wf_ea63edc9-5b1` shows `fix1:B3:g3:3,3b` with no result and `types: ... failed`.
- added: 2026-10-04

## P-510 · `resumeFromRunId` on a run with concurrent agents re-runs accepted groups, because the cache is a prefix of the call order
- symptom: resuming `wf_ea63edc9-5b1` after the dead fix restarted `build:B3:g4:4,5` (already built and accepted) and a second `review:B3:g3:3,3b`, both live (2026-10-04 02:45); stopped after four minutes.
- cause: the Workflow tool replays only the longest unchanged prefix of agent calls; the overlap (H54) issues calls as promises settle, so the order after the first live call differs from the recorded one and every later call is treated as new.
- rule: do not resume an overlapped run. Relaunch with `closeOut` carrying the rejected group's blocking defects (read them from the journal) and `sizing` holding only the groups not yet accepted; keep `startAt` for sized groups only (P-506).
- proof: journal of `wf_ea63edc9-5b1` after the resume: `build:B3:g4:4,5` and `review:B3:g3:3,3b` started a second time with no cached result; the relaunch `wf_d557c78a-825` started `close:B3:c3:3,3b` first.
- added: 2026-10-04

## P-511 · Two lanes writing migrations to mop-dev at once: main's push refuses the second lane's file as remote-only, then as out of order
- symptom: the api lane pushed B3's `20261003184651` to mop-dev from its branch (allowed as the schema writer); when B8's `20261003185349` merged first, main's dev job refused `remote-only migrations 20261003184651`, and after the rename to `20261003222954` it refused `out-of-order migration 20261003185349_jobs.sql` (runs 37156729391 and 37159340230, 2026-10-04).
- cause: `db-push.mjs` compares main's files with the remote history; a lane's unmerged push creates a remote-only version, and a later-merged older file is out of order against it. R16 (new file after main's newest) only protects the branch, not the remote.
- rule: while one lane pushes migrations, no other lane's migration merges to main before that lane's; if it must, apply the older file from main by hand in one transaction (`psql -1 -f`), record its version in `supabase_migrations.schema_migrations` and `public.migration_checksums`, and run `bun run db:push` from main until it prints `Remote database is up to date`. Merge a schema writer's accepted migration early (its own small PR) rather than letting it sit on the branch.
- proof: `bun run db:push` from main at b3e90d1 → `refusing: remote-only migrations 20261003184651`; after the rename and the manual apply → `{"upToDate":true,...,"message":"Remote database is up to date."}`.
- added: 2026-10-04

## P-1100 · Adding a path to `lint`, `format:check` or the root-scripts block stales eight B1b registry entries and a hygiene pin
- symptom: B14 g1 put `workspace/audits/tools` and `scripts/audit` under the root lint, the format check and `tsconfig.scripts.json`. `bun run check` went red on `hygiene.test.ts` (it pins the `format:check` string), and a find-count pass over the registries printed STALE for hy-lint-warnings, hy-lint-warnings-gate, mg-gate-format-config, mg-gate-lint-prettier, hy-gate-include, hy-gate-lint, hy-gate-format-path and hy-gate-prettier.
- cause: those entries quote exact lines of `package.json`, `eslint.config.js` and `tsconfig.scripts.json`; `bun run check` does not replay the registry (P-066) and the tsconfig include array grew past one line.
- rule: after any edit of those three files run the find-count one-liner of the proof before the check, repair the finds and the hygiene pin in the same commit, and replay the repaired ids one by one (`node scripts/watchfail.mjs --registry tests/mutations --only <id>`).
- proof: `cd app && node -e "const fs=require('fs');for(const f of fs.readdirSync('tests/mutations'))for(const e of JSON.parse(fs.readFileSync('tests/mutations/'+f,'utf8'))){if(e.kind==='sql'||e.kind==='manual'||!e.file)continue;const n=fs.readFileSync(e.file,'utf8').split(e.find).length-1;if(n!==1)console.log('STALE',f,e.id,n)}"` → prints `STALE B4.json z 7` only (older than this entry) on slice/b14 at B14 g1; before the repair it listed the eight ids above too.
- added: 2026-10-04

## P-1101 · A slice sized with no unmet dependency can still need slices that are not on main: B14's live cache and crawl proofs found no cache layer, no catalog routes and no B13 checkers
- symptom: `node workspace/audits/tools/cache.mjs --url http://127.0.0.1:8858` against the build of main printed `x-mop-cache -` and `x-catalog-version -` on every row, 404 on `/api/public/markets`, `/properties` and `/stories`, and `edge_hit_ratio: null`; `crawl.mjs` printed `error: Module not found "scripts/check-seo.ts"`; `scripts/dev-vars.mjs` and `scripts/cpu-gate.mjs` do not exist.
- cause: B14 step 3 needs B3 (the pipeline cache layer, the catalog routes, `dev-vars.mjs`) and B13 (`check-seo.ts`, `validate-jsonld.ts`, `validate-llms.ts`); `sizing/B14.json` lists `unmetDependencies: []` while `app/scripts` and `app/src` hold none of them.
- rule: before the live half of a proof, check that what it measures exists on the tree (the proof below); when it does not, prove the collector against fixtures, write the live row as UNPROVEN with the slice that unblocks it, and run it again when that slice lands.
- proof: `cd app && grep -rl x-mop-cache src | wc -l` → `0`, and `ls scripts/check-seo.ts scripts/dev-vars.mjs` → `No such file or directory` twice, on main at 4a05fdb (2026-10-04).
- added: 2026-10-04

## P-1102 · New `.mjs` under the root tool folders is checked strict: a recursive JSDoc typedef, `typeof fetch`, template literals and a literal em dash each cost a round
- symptom: `tsc -p tsconfig.scripts.json` printed TS2456 `Type alias 'Json' circularly references itself`; eslint printed `restrict-template-expressions` for `${new URLSearchParams(...)}` and `no-base-to-string` for `String(unknown)`; a test stub `(url) => Promise<Response>` did not fit `typeof fetch` (bun's types add `preconnect`); prettier rewrote the escape `"\u2014"` in a source file into a literal em dash.
- cause: `checkJs` runs with `strict` and the `strictTypeChecked` rules on every `.mjs` of `tsconfig.scripts.json`, which now includes `workspace/audits/tools` and `scripts/audit`.
- rule: type an injected fetch as `(url: string, init?: RequestInit) => Promise<Response>` (`Fetch` in `workspace/audits/tools/common.mjs`); write the open JSON type as `null | boolean | number | string | unknown[] | Record<string, unknown>`; call `.toString()` on a `URLSearchParams` before a template; build an em dash as `String.fromCodePoint(0x2014)`. Run each new command-line tool once by hand with every flag it documents: `util.parseArgs` is strict by default, and the shared `contextFromArgs` threw `Unknown option '--check-config'` on `uptime.mjs` while every unit test was green, because no test went through the command line.
- proof: `cd app && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.scripts.json` → no output, exit 0; `grep -c -P "\x{2014}" ../scripts/audit/lint-report.mjs` → `0`; `env -u UPTIME_API_KEY node ../workspace/audits/tools/uptime.mjs --check-config; echo $?` → `Not measured: uptime (UPTIME_API_KEY unset)` and `1` (2026-10-04).
- added: 2026-10-04

## P-1103 · A group's file list named `workspace/audits/tools/scope-check.mjs`; the plan, the routine prompt and trace.json say `scripts/audit/scope-check.mjs`
- symptom: the g4 task listed `workspace/audits/tools/scope-check.mjs`, while B14.md invariant 2 and the Files list, `ROUTINE-PROMPT.md` (`node scripts/audit/scope-check.mjs origin/main HEAD`) and `trace.json` all name `scripts/audit/scope-check.mjs`, next to `lint-report.mjs`.
- cause: the sized file list was typed from the folder of the other tools, not from the Files list of the plan.
- rule: when a group's file list and the plan's Files list disagree on a path, the plan wins if two other artifacts (prompt, trace) already name its path; build there and say so in the log. The same lint, format and tsconfig entries cover both folders.
- proof: `grep -n "scope-check" workspace/audits/ROUTINE-PROMPT.md | cut -c1-120` → the line names `scripts/audit/scope-check.mjs`; `git ls-files scripts/audit` → `scope-check.mjs` and `lint-report.mjs`.
- added: 2026-10-04

## P-1104 · A bare `cat > file; node - <<EOF` waited on stdin for the whole 120 s and left an empty file outside the worktree
- symptom: a Bash call timed out at 120 s with no output and the heredoc script after it never ran; `E:/tmp_unused` (an empty file, one folder above the drive's project folders) appeared. Removing it was refused by the permission check, so it stays for the operator.
- cause: a mistyped `cat > ../../../x 2>/dev/null` before the heredoc read the terminal instead of a file; the relative path went three folders up from `app/`.
- rule: never write a scratch file with a bare redirect; use Write into the scratchpad. A call that prints nothing and times out has not run its later commands: check `git status` before trusting the state (P-056).
- proof: `ls E:/tmp_unused` → exists, size 0 (the operator may delete it).
- added: 2026-10-04

## P-1105 · Tests that build a throwaway git repository on this laptop: `core.autocrlf` prints a warning on stderr, and `git mv` needs the target folder
- symptom: a helper that asserted `stderr` empty after `git add -A` failed with `warning: in the working copy of 'app/wrangler.toml', LF will be replaced by CRLF`; `git mv` into a folder that did not exist exited 128.
- cause: the machine's global `core.autocrlf` is on; `git mv` does not create directories.
- rule: assert the exit status of setup commands, never an empty stderr; `mkdirSync` the target folder before `git mv`.
- proof: `cd app && bunx vitest run --project unit tests/unit/audit/scope-check.test.ts` → `Tests  9 passed (9)`.
- added: 2026-10-04

## P-1106 · A guard line whose watched-fail stays green is dead code: the backslash refusal in `scope-check.mjs` was removed
- symptom: the registry entry that removed `if (path.includes("\\")) return false;` replayed `WATCHED-FAIL BAD: stayed green`.
- cause: a path with a backslash and no slash never starts with an allowed folder, and a backslash inside a slash path is a literal file-name character on Linux, so the allow-list refused every such path already.
- rule: when a watched-fail of a guard stays green, first ask whether another line already refuses the case; delete the dead line and its entry instead of bending the test (R04, no dead code).
- proof: `cd app && node scripts/watchfail.mjs --registry tests/mutations --only b14-scope-dotdot` → `WATCHED-FAIL OK B14:b14-scope-dotdot`; `grep -c 'includes(' scripts/audit/scope-check.mjs` → `1` (only the allow-list lookup).
- added: 2026-10-04

## P-1107 · A collector's own sidecar was never run through the report lint: the cache probe wrote an ops-health path the lint refuses, so no real report could pass
- symptom: `run-all.mjs` against a stub wrote `data/<date>.json` holding `"check": "never_cached /api/hooks/ops-health/probe"`, and `lintReport` answered `secret: the sidecar holds an ops-health path segment other than <redacted> (DO-03)`; every unit test was green because the sidecar fixture has no `cache.checks`.
- cause: the lint (a secret check) and the cache probe (a list of paths) were built and tested apart; each was right alone, and the DO-03 rule "a path segment after `ops-health/` is `<redacted>`" was only applied in `uptime.mjs`.
- rule: a tool that writes into the sidecar redacts through `redactUrl` of `uptime.mjs` at the moment it records a path, and its test passes the collected sidecar to `lintReport` instead of asserting on the probe alone.
- proof: `cd app && bunx vitest run --project unit tests/unit/audit/cache.test.ts` → the case "writes a sidecar the report lint accepts" passes; `node scripts/watchfail.mjs --registry tests/mutations --only b14-cache-redacted-path` → `WATCHED-FAIL OK B14:b14-cache-redacted-path`.
- added: 2026-10-04

## P-1108 · Replaying one slice's registry out of a shared scratch folder ran another slice's entry and printed BAD
- symptom: a reviewer's `node scripts/watchfail.mjs --registry <folder>` ran `B8:a` (a `db`-project entry) and printed `WATCHED-FAIL BAD: wrong reason`; the folder held `B14.json` and `B8.json` from an earlier run.
- cause: `--registry` replays every `*.json` in the folder; a reused scratch folder keeps the last slice's file.
- rule: build the single-slice registry folder fresh each time (`R=$(mktemp -d); cp tests/mutations/B14.json $R/; ls $R`) and look at the listing before replaying.
- proof: `R=$(mktemp -d); cp app/tests/mutations/B14.json $R/; ls $R` → `B14.json` only.
- added: 2026-10-04

## P-1109 · `npx prettier --write` on a root tool file from `app/` ignores the app's config and reflows the whole file at 80 columns
- symptom: `npx prettier --write ../workspace/audits/tools/common.mjs` run in `app/` rewrote 15 untouched lines; `bun run lint` then reported seven prettier errors in the file it had just formatted.
- cause: prettier finds its config from the file's folder upward; `workspace/audits/tools` has none, and the repository's settings live in `app/eslint.config.js` (the `prettier/prettier` rule), which only the lint command applies.
- rule: format a file outside `app/` with the lint's own command from the repository root, `./app/node_modules/.bin/eslint --config app/eslint.config.js --fix <file>`, and read `git diff --stat` before going on; if a file was reflowed, `git checkout` it and redo the edit.
- proof: `./app/node_modules/.bin/eslint --config app/eslint.config.js workspace/audits/tools scripts/audit` → no output, exit 0.
- added: 2026-10-04

## P-1000 · B16 steps 1 and 2 are not buildable "any time after B2": `service.ts`, `readiness.ts` and `set-site.ts` import B3 files that are not on main
- severity: warn
- symptom: B16 g1 found `src/server/public/state.ts` (`getPublicState`), `src/server/lib/db.ts` (the client type) and `src/server/lib/errors.ts` (`AppError`) absent from main; `git log --all -- app/src/server/public/state.ts` prints nothing, and `slice/b3` holds the lib files but not `public/`.
- cause: the plan's landing order says "B16 steps 1 and 2 any time after B2", while its Depends line and the Files list make `getSiteSettings` read `getPublicState(db).site` (B3) and throw `AppError` (R09); step 2's list was sized as if only the migration were needed.
- rule: before a group that imports another slice's file, `git ls-tree -r --name-only origin/main | grep <file>`; if it is missing, build the parts that do not import it (domain, migration) and report the rest BLOCKED on the named B3 group, never stub the import.
- proof: `git ls-tree -r --name-only origin/main app/src/server | grep -c "public/state.ts"` → `0` at 4a05fdb (measured 2026-10-04, B16 g1).
- added: 2026-10-04

## P-1001 · A plan Files line that names an export before its first importer lands fails knip; a zod 3 `.default(x)` mutation on a preprocessed leaf stays green
- severity: warn
- symptom: `settings.ts` exported `PublicSite` and `SiteFieldKey` as the Files list says, and `bun run knip` printed `Unused exported types (2)` and exited 1 (the configuration hint alone exits 0 on main). Separately the registry entry that changed `.default(null)` to `.default("")` on a leaf stayed `BAD: stayed green`.
- cause: R04 (ruling H38 (1)) makes a name nothing imports file-local and expects the step that first imports it to add `export`; the plan's Files line does not say so. Zod 3 feeds a `.default(x)` value through the inner schema, and the inner `preprocess` turned `""` back into null, so the mutation changed nothing observable.
- rule: export only what a file in this group imports; a type with no importer yet is left out and its step adds it (here `PublicSite` arrives with `getPublicSite`, step 3). A mutation must change an observable value: remove the `.default` (the parse then throws `Required`) instead of changing it to a value the inner schema normalises.
- proof: `cd app && bunx knip | grep -c "Unused exported"` → `0` on slice/b16 at B16 g1; `node scripts/watchfail.mjs --registry tests/mutations --only partial-null` → `WATCHED-FAIL OK B16:partial-null` (measured 2026-10-04).
- hit again: 2026-10-04, B3 g6: the first `bun run knip` printed unused exported types in `events.ts`, and the group's log listed it as covered by this entry, but this entry carried no hit-again line (found by the g6 reviewer). Every other cost the g6 log names got one; a cost a log cites is banked only when the cited entry names the hit.
- added: 2026-10-04
- hit again: 2026-10-04, B8 g3: `runner.ts` exported the interface `JobOutcome`, used only inside the file as a member of the exported `RunSummary`; `bun run check` stopped at knip with `Unused exported types (1)  JobOutcome  interface  src/server/jobs/runner.ts:45:18`. A type that an exported type uses needs no `export` of its own; run `bun run knip` before the full check.

## P-1002 · A literal in a plan's Files list is older than the rulings: build a constant that mirrors rows from the rows, not from the list
- severity: warn
- symptom: B16 g1's `retentionPeriods` copied the Files-list literal (`analytics_events: { months: 13 }`, no `contacts_anonymise`) and the fresh reviewer rejected it: B2 seeds `analytics_events` at 90 days (ruling H16) and `contacts_anonymise` at 24 months; the 13 months belong to the separate key `analytics_daily` (B8 step 8a). The only unit test checked units, not values, so it passed.
- cause: the Files line predates H16 and H32; Contract 8 and STANDARDS R25 state the later numbers. The same constant is read by the privacy page and by a db test, so a wrong number would have printed a false retention period.
- rule: a constant that mirrors seeded rows is written from the seed migration, and a unit test reads that migration and compares key by key (`retentionPeriods > equal the periods B2 seeds`); when a plan literal and a ruling disagree, the ruling and the rows win. A migration that is on no main yet is changed by deleting it and re-running `bun run db:fn <name>` (a new timestamp); `check-migrations.mjs` throws ENOENT on the deleted file until the deletion is committed.
- proof: `cd app && node scripts/watchfail.mjs --registry tests/mutations --only retention-seed` → `WATCHED-FAIL OK B16:retention-seed` (measured 2026-10-04, B16 g1 retry).
- added: 2026-10-04

## P-1003 · A merge of origin/main that brings a new dependency leaves `node_modules` behind: run `bun install` before the first typecheck
- severity: warn
- symptom: after `git merge origin/main` into slice/b16 (the B9 g5 merge, 9fcf7f5), `tsc` failed on `puppeteer-core` in B16 g1 and the group's cost line named P-1002, which says nothing about it; the fresh reviewer found the cost unbanked.
- cause: the merge brought `"puppeteer-core"` into `app/package.json` and `bun.lock`, but a lane's `node_modules` is installed once and a merge never runs the install, so the typecheck saw a package that was declared and absent.
- rule: after any merge of origin/main, if `git diff --name-only HEAD~1 HEAD -- app/package.json app/bun.lock` names a file, run `cd app && bun install` before `bun run check`; a typecheck error that names an import of a package present in `package.json` is a stale `node_modules`, not a code defect. The other half of that cost, a registry entry going STALE after an edit to a mutated file, is banked in the registry rule (P-066).
- proof: `cd app && grep -c '"puppeteer-core"' package.json` → `1` on slice/b16 at bec47c2 (line 98, merged from main with 500d04b); `cd app && bun install --frozen-lockfile 2>&1 | tail -1` then `bunx tsc --noEmit` exits 0 (the red output of the missed install was not kept: UNPROVEN as text, reported by the g1 cost line and the reviewer).
- added: 2026-10-04

## P-512 · An accepted migration sat on a lane branch while another slice's migration merged first; the lane's own push and main's push then disagreed
- symptom: see P-511 for the two refusals; the deeper cause was the order: B3's migration reached mop-dev from the branch on 2026-10-03 18:46 and reached main only on 2026-10-04 00:20, after B8's.
- cause: the single-writer exception let a lane push before merging, and the slice merged only at its end (H50), so main lagged the database by hours.
- rule: ruling H57: no lane pushes; `build-slice.js` merges an accepted schema group at once (`mergeNow`), then main pushes. Rename a migration only while unpushed.
- proof: `node <scratchpad>/trace/simulate-workflow.mjs` → the schema scenario's agents end `review:B2:g2:2* | merge:B2:g2:2` (the merge follows the schema group's review); `simulation: 6 scenarios passed`.
- enforced-by: .claude/workflows/build-slice.js (the schema merge hook and the H57 rule in the builder brief)
- added: 2026-10-04

## P-820 · Supabase Storage on mop-dev, measured: a missing object is status 400 with code `NoSuchKey`, a signed upload URL lives 7200 s, and a raw PUT works twice
- symptom: B3 step 8's reconcile had to tell "no object yet" from an outage, and the plan only said "a not-found answer"; the plan's Risks marked the signed URL lifetime UNPROVEN and asked whether Storage takes a raw PUT.
- cause: supabase-js turns the Storage answer into a `StorageApiError` whose `status` is the HTTP status (400), not 404; the 404 is only in `statusCode` and the stable key is `code`.
- rule: test a missing object with `error.code === "NoSuchKey"` (parse it with Zod), never `status === 404`; a signed upload URL is good for two hours (`exp - iat` of its token is 7200), and the browser may PUT the raw file with its `content-type`; a URL signed with `upsert: true` takes a second PUT of the same file.
- proof: from `app/` in the dev loader shell with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exported, `bun -e 'import { createClient } from "@supabase/supabase-js"; const c = createClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""); const r = await c.storage.from("submissions").download("__spike/none.jpg"); console.log(JSON.stringify({ status: r.error?.status, statusCode: r.error?.statusCode, code: r.error?.code }))'` → `{"status":400,"statusCode":"404","code":"NoSuchKey"}`; two `curl -X PUT --data-binary @tests/fixtures/photo.jpg -H "content-type: image/jpeg" <signed url>` printed `200` and `200`; the token's claims were `url,upsert,scope,iat,exp` with `exp - iat` = 7200 (2026-10-04, B3 g6; the PUT and token lines are in `workspace/05-plans/logs/B3.md`, g6).
- added: 2026-10-04

## P-821 · A POST route with a path parameter had no way to hand it to its service: the pipeline now parses `:name` segments with the body
- symptom: `POST /submissions/:id/uploads` needs the submission id, but `PublicService` is `(db, input, ctx)` with `input` the parsed body, and `write()` in `src/server/public/pipeline.ts` passed the path values nowhere; no plan line says how the id arrives.
- cause: the route table was written for GET detail rows (the slug is the whole input) and body-only POST rows.
- rule: a POST row whose path has `:name` segments gets them inside its parsed input under their own names (`withParams` in `pipeline.ts`; a body field of the same name is overwritten), so its schema declares them, as `signMoreSchema` declares `id: z.string().uuid()`. B7, B13 and any later POST row with a path parameter follow it; never add the params to `PublicCtx`. The table now imports the services, and `upload-token.ts` imports `env.ts`, which parses at import: a test that imports `routes.ts` imports `tests/fixtures/worker-env` first (B3 g6's first `bun run check` failed `routes-parity.test.ts` with `Invalid environment: RATE_LIMIT_SALT Required`).
- proof: `cd app && grep -n "withParams" src/server/public/pipeline.ts` prints the helper and its one call; registry entry `b3-g6-params` (drop the params from the parse) turns the uploads case of `tests/api/submissions.api.test.ts` red with a 422.
- added: 2026-10-04

## P-822 · A number written into a bank entry from memory drifted from the log it cites: P-819 said "counted 8 stale" where the log says 12 before the repair and 9 after
- symptom: the review of B3 c3 found P-819's symptom ("a reviewer ... counted 8 stale") disagreeing with the author's own before-count and the log (12 of 909 file entries stale before the repair, 9 after). The entry was the one written to teach that a count is measured, not recalled.
- cause: the figure was typed from a conversation, not copied from the log line or the command output the entry cites; nothing checks a number inside an entry against its source.
- rule: copy every count, exit code and id into an entry from the output or log line it names, and name that source in the same sentence; when two sources give different numbers, write both and say which one is the measurement. A reviewer's recount of a bank entry is a Hit again on this entry, not a new one.
- proof: `grep -c "minute and counted [8] stale" GOTCHAS.md` → `0`; `grep -n "12 of 909 file entries" GOTCHAS.md workspace/05-plans/logs/B3.md` prints the P-819 and P-822 symptoms and the log's c3 round 2 line (2026-10-04).
- added: 2026-10-04

## P-823 · A list route that starts answering a smaller shape silently takes the full-shape coverage of a parity test with it, and re-pointing the registry entry hides the loss
- symptom: B3 g5 (step 5b) made `/properties` answer cards, so `parity.api.test.ts` compared `properties.map(pickCard)`; no test compared the detail answer (`/properties/:slug`, the full `Property` every detail page reads in live mode) with the bundled data, and the entry `b3-g4-parity-properties` was re-pointed from `lotAcres` to `baths` so the mutation still went red. With `lotAcres: row.baths` in `src/server/public/mappers.ts`, `tsc` exited 0 and the db project printed `Tests 8 passed (8)`: a detail-only field could ship wrong in live mode with every gate green. The reviewer found it.
- cause: the test was edited to follow the route's new shape and the registry entry was edited to follow the test; both moves kept things green, neither asked what stopped being compared.
- rule: when a route's answer shrinks, keep a case that reads the full shape from the route that still answers it (here `/properties/<slug>` for every bundled slug, omitting `id`, `campaignTier` and `source`), and never change a registry entry's `find` to a field that the remaining test still sees: add the new entry beside it and restore the old one. Before re-pointing, say in the log which field stopped being covered.
- proof: `cd app && eval "$(node scripts/load-env.mjs --profile dev)" && env -u CLOUDFLARE_API_TOKEN node scripts/watchfail.mjs --registry tests/mutations --only b3-g4-parity-properties 2>&1 | tail -2` → `mutated src/server/public/mappers.ts:272  lotAcres: row.baths,` and `WATCHED-FAIL OK B3:b3-g4-parity-properties` (2026-10-04, B3 g5 repair).
- added: 2026-10-04

## P-825 · A log's live proof written as prose cannot be re-run, and `reconcileUploads(getDb(), new Date())` on the shared mop-dev sweeps other lanes' rows
- symptom: B3 g6's log gave its spike and its live reconcile as sentences (`(spike) one submission through handlePublic ...`, `(live) reconcileUploads(getDb(), new Date())`). The reviewer's first run of them failed with `error: Invalid environment: RATE_LIMIT_SALT Required at parseEnv (src/server/lib/env.ts:55)`; the second run, with `await import("tests/api/env.ts")` first and `since` set to now plus 2 hours minus 2 minutes, reproduced every observation. A live call as written would also have swept every pending `submission_media` row of the last 2 hours on the one shared database, the rows of other lanes' tests included.
- cause: the proof was written from what the author did by hand in a session that had the environment set, not as a command. `getDb` imports `env.ts`, `env.ts` parses `process.env` once and needs `RATE_LIMIT_SALT`, and the dev profile exports only `PREVIEW_RATE_LIMIT_SALT` (P-809). `reconcileUploads(db, since)` reads every pending row newer than `since` minus 2 hours, so its blast radius is set by `since`.
- rule: a live proof in a log is a command with its environment in the same call: the dev profile, then `tests/api/env.ts` imported before any file that imports `env.ts`, then the call. A live run of `reconcileUploads` passes a `since` that reaches back only to its own row (its own insert time plus 2 hours, minus a minute or two), never `new Date()` on the shared database. A proof that lists a line a reader cannot paste is a claim (P-819).
- proof: `cd app && env -u CLOUDFLARE_API_TOKEN bash -c 'eval "$(node scripts/load-env.mjs --profile dev)"; bun -e "await import(\"./src/server/lib/db.ts\")" 2>&1 | grep -c "RATE_LIMIT_SALT"'` → `2` (the import throws when `tests/api/env.ts` was not imported first); the same call with `await import("./tests/api/env.ts")` before it prints `loaded` (measured 2026-10-04, B3 g6 follow-up).
- added: 2026-10-04

## P-1200 · B5 g1's file list disagreed with the plan and the folder map, and the step 1 proof needs files the list does not name
- symptom: the group's file list named `app/src/templates/email/theme.gen.ts`, but the folder map (STANDARDS section 1), B5's Files line, B6, B9 and B11 all say `src/templates/theme.gen.ts`; the proof runs `tests/unit/theme.test.ts` and `tests/unit/email/render.test.ts`, which no list names; `bun add` of the two react-email packages failed `bun run knip` with "Unused dependencies (2)", and the first attempt hid that with `ignoreDependencies` entries, which a reviewer rejected (H46 (2), R04); a first export of `EmailTemplate` and `EmailSettings` types failed knip as "unused exported types"; an `expect(value, "name")` message argument failed `vitest/valid-expect` in lint.
- cause: the file list is derived from the step text, not from the folder map or the proof; step 1 says `bun add @react-email/components @react-email/render`, but R04 and H46 (2) install a dependency in the step whose code first imports it, and an `ignoreDependencies` entry would also hide a duplicate nested copy (`@react-email/components` 1.x carries its own `@react-email/render`).
- rule: take the path from the folder map when a list differs, and say so in the log; a group that proves with a test creates it and its `tests/mutations/<slice>.json` entries (P-079); never install a dependency ahead of its importer and never add it to `ignoreDependencies`: the group that writes the first import adds it (H46 (2)); a domain type is exported only once something imports it; `expect` takes no message argument here. The group that writes `supabase/functions/job-runner/deno.json` maps `@react-email/render` to the major ASSUMED E5 measured on the edge runtime (`@1`) and installs the same major in `package.json`.
- proof: `cd app && bun run knip | grep -c "Unused"` → `0`; `grep -c react-email app/knip.json` → `0` at any time, because `ignoreDependencies` must never name the packages (the proof does not expire when the first template imports them and `package.json` gains them); `git ls-files app/src/templates/theme.gen.ts` lists the file.
- added: 2026-10-04

## P-1201 · B5 g2 was launched before the tables its migration alters exist on any branch
- symptom: B5 g2 (migration `email.sql`) cannot start: its first statement is `alter table email_templates add column class ...` and its seed inserts into `email_templates`, but `git grep email_templates origin/main origin/slice/b8 origin/slice/b3 -- app/supabase` finds nothing and `app/src/db/types.ts` has no `email_templates` (2026-10-04 04:30).
- cause: `email_templates` is created by B8b's `automation.sql` (steps 1 to 5), which the landing order puts before B5 (B5.md, line 5 of the wave 3 landing order); B8 is still at step 1 in review and B8b has not started. The brief of g2 was computed from "what can run beside B3 and B8" and did not check the Depends-on line. Creating the table in B5's file would give two writers one table and a duplicate `create table` when B8b lands (H46, one writer per file).
- rule: a schema group starts only after every table it alters or seeds is on `origin/main`; check with `git grep -n "create table public.<name>" origin/main -- app/supabase/migrations` before building, and report BLOCKED with the missing slice named instead of creating the table.
- proof: `git grep -c "email_templates" origin/main -- app/supabase app/src/db/types.ts` → no output (exit 1) until B8b step 1 lands.
- added: 2026-10-04

## P-902 · B8's TypeScript groups (steps 3 and 4 on) cannot start before B3 merges, and their RPC calls cannot typecheck before B8's own migration is in `src/db/types.ts`
- symptom: B8 g3 (steps 3 and 4) was dispatched on slice/b8 while B3 was still building. `origin/main` has none of the B3 files the steps import: `src/server/lib/db.ts` (`Db`), `errors.ts` (`AppError`, R09), `media-store.ts` (the shared `storage_unavailable` error), `tests/fixtures/fake-db.ts` (`fakeDb`, R50), and `src/server/lib/events.ts`, whose stub step 3 replaces (not even on `origin/slice/b3` yet). B3's `fakeDb` types its `rpc` option by `keyof Database["public"]["Functions"]`, and `src/db/types.ts` holds none of `claim_job`, `finish_job`, `fail_job`, `requeue_job`, `enqueue_job`, `emit_event`, because B8's migration reaches mop-dev only after B8 merges (H1 (a)). So `claim.ts`, `jobs.ts`, `events.ts`, the runner and their tests cannot pass `bun run check` without a cast the strict lint refuses or a hand edit of a generated file.
- cause: the plan's "Depends on: B3" line is honoured per slice, not per group: the workflow started B8 because g1 (SQL only) needed B2 alone. And a lane's generated types lag its own migrations (P-327), which for a slice whose TypeScript calls its own new functions is a circle that only the writer rule can break.
- rule: before a B8 group that writes TypeScript starts, check `git ls-tree --name-only origin/main app/src/server/lib/ app/tests/fixtures/` lists `db.ts`, `errors.ts`, `media-store.ts`, `events.ts` and `fake-db.ts`, and that `git grep -c claim_job -- app/src/db/types.ts` is not 0; if either fails, build only the pure files with no import from them (here `backoff.ts`, `hmac.ts`, `.env.example`) and report BLOCKED naming the missing pieces. The types gap closes when B8 becomes mop-dev's schema writer (after B3 merges) and pushes its migration, or when the orchestrator rules another way; never hand-edit `src/db/types.ts` and never type an RPC client loosely to get past it.
- proof: `cd app && git ls-tree --name-only origin/main src/server/lib/ | tr '\n' ' '` → `crypto.ts error-page.ts headers.ts log-events.ts log.ts pipeline.ts sentry.ts` and `git grep -c "claim_job\|enqueue_job" -- src/db/types.ts` → no output (0 matches) on slice/b8 at 2026-10-04 00:37 +0300; `git ls-tree --name-only origin/slice/b3 app/tests/fixtures/ | grep -c fake-db` → `1`.
- added: 2026-10-04

## P-903 · A refuse case checked against a fixed signature cannot catch a signer that drops one input: the mutation changes the fixed signature too
- symptom: B8 g3's first replay of `hmac.test.ts` gave `WATCHED-FAIL BAD: wrong reason (B8:hmac-timestamp)` and `(B8:hmac-body)`: with the timestamp (or the body) left out of the signed message, "refuses another timestamp" stayed green, because the mutated `verifyBody` computed a signature that differed from the hard-coded vector whatever the timestamp.
- cause: the refuse cases compared against the contract vector's fixed `sha256=` value, which a signer that ignores an input no longer produces, so every input "fails" for the wrong reason.
- rule: keep one case that signs and one that accepts the fixed vector (the contract with the other side); write every refuse case on a signature made by the module under test in the same case, changing exactly one input, so a signer that ignores that input accepts it and the case goes red.
- proof: `cd app && bunx vitest run --project unit tests/unit/jobs/hmac.test.ts` → `Tests  8 passed (8)`; the registry entries `hmac-timestamp` and `hmac-body` of `tests/mutations/B8.json` replay `WATCHED-FAIL OK` (measured 2026-10-04, B8 g3).
- added: 2026-10-04

## P-904 · After `git merge origin/main` a lane's `node_modules` lacks what main added: `bun run check` fails typecheck on a module that is in `package.json`
- symptom: B8 g3's first `bun run check` exited 2 in `tsc -p tsconfig.scripts.json` with `scripts/lib/shoot.mjs(8,23): error TS2307: Cannot find module 'puppeteer-core'`; `package.json` on the merged branch lists `"puppeteer-core": "^25.12.0"`.
- cause: B9 added the dependency on `main`; the merge brought `package.json` and `bun.lock`, not the installed package.
- rule: after every merge of `origin/main` into a lane, run `bun install --frozen-lockfile` in `app/` before the first `bun run check` whenever `git diff --name-only HEAD@{1} HEAD -- app/package.json app/bun.lock` prints a name.
- proof: `cd app && bun install --frozen-lockfile` → `+ puppeteer-core@25.12.0 ... 23 packages installed`, then `bun run typecheck` exits 0 (measured 2026-10-04, B8 g3).
- added: 2026-10-04

## P-905 · B3's `fakeDb` answers `from(name).select()` with every registered row and has no filter method: a service that reads with `.eq`, `.in`, `.or` or `.order` throws `is not a function` in its unit test
- symptom: B8 g3's runner reads `run_local` for one batch with `db.from("jobs").select("id, run_local").in("id", ids)` (ruling H34 (2): a local job's message is dropped before any claim). `fakeDb`'s `from` returns `{ select: () => Promise }`, so `.in` on that promise is `undefined` and the call throws `TypeError`.
- cause: `tests/fixtures/fake-db.ts` (B3 step 1) models RPCs fully and tables as one unfiltered `select`; no service on main read a table with a filter before B8. `fake-db.ts` is B3's file, so a lane may not extend it (one writer per file).
- rule: prefer an RPC for a server read a unit test must fake. When a filtered table read is the right call, the test file wraps its own `fakeDb` with `Object.assign(db, { from })`, records the call in `db.calls`, and answers only the chain the code uses (`tests/unit/jobs/runner.test.ts`, `setup`); no cast is needed because the result is an intersection. B8 step 9's `listJobs` (`.or(entityJobsFilter(...)).order(...).limit(...)`) meets the same wall: a filter chain in `fake-db.ts` itself is B3's or the orchestrator's change.
- proof: `cd app && grep -c "select: () => Promise.resolve" tests/fixtures/fake-db.ts` → `1`; `bunx vitest run --project unit --testTimeout=60000 tests/unit/jobs/runner.test.ts -t "run_local job"` → `1 passed` with the wrapper, and the registry entry `bj` replays `WATCHED-FAIL OK` (2026-10-04, B8 g3).
- added: 2026-10-04

## P-906 · B8 step 4's proof list carries the `beat` case of step 6a, whose function is not in `src/db/types.ts` yet
- symptom: the brief of B8 g3 (steps 3 and 4) asks `runner.test.ts` to prove "`beat('runner', { claimed })` is called once per `runOnce` ... and a failing `beat` RPC is logged once" (DO-03). `git grep -c "beat" -- app/src/db/types.ts` finds no `beat` function: the `ops_heartbeat.sql` migration that creates it is step 6a, so `db.rpc("beat", ...)` cannot typecheck (the RPC name is typed by the generated `Functions`, P-902), and `runner_beat_failed` is not in `LogEvent` (B1b's `log-events.ts`, not a g3 file).
- cause: the plan's step 4 proof line lists every case `runner.test.ts` ends with, while step 6a's own text says it adds "the `beat('runner', ...)` call in the `finally` of `runOnce`".
- rule: a proof list that names a case whose function, migration or log name another step creates belongs to that step: build the rest, leave the case and its watched-fail (aj) to the owning step, and say so in the log. Before writing a call to a new RPC, `git grep -n '"<name>":' -- app/src/db/types.ts`.
- proof: `cd app && git grep -c '"beat":' -- src/db/types.ts` → no output (exit 1) on slice/b8 at B8 g3; `grep -n "^6a\." ../workspace/05-plans/B8.md | grep -c "beat('runner'"` → `1` (2026-10-04).
- added: 2026-10-04

## P-907 · B8 step 5's `deno check` is red on main until B3 step 3b lands: `deno.json`, `deno.lock` and `deno-portable.ts` live on slice/b3, and `db.ts` still has extensionless imports
- symptom: `deno check --frozen --config supabase/functions/job-runner/deno.json supabase/functions/job-runner/index.ts` prints `TS2307 Cannot find module .../src/db` and `.../src/server/lib/env` at `src/server/lib/db.ts:2:31` and `:3:21`, then `TS7006 Parameter 'message' implicitly has an 'any' type` at `runner.ts:227` (the any comes from the unresolved `Database`). `supabase/functions/job-runner/deno.json` is not on main; the plan says B3 creates it.
- cause: the runner's `import type { Db } from "../lib/db.ts"` pulls `db.ts` into Deno's graph, and B3's fix (`../../db/index.ts`, `./env.ts`) is only on `origin/slice/b3`. The sizing marks g4 `blocked: false`; the dependency is B3 step 3b merged, not B2.
- rule: a group that points a check at a Deno entry needs B3 step 3b on main first (its `deno.json`, `deno.lock`, the `.ts` fix of `db.ts`). Until then g4 carries a byte-identical copy of B3's `deno.json` and `deno.lock` (an identical add merges clean) and the check is UNPROVEN on main. `src/server/lib/env.ts` is loaded by the graph and is fine: only `db.ts` is the blocker. The deploy itself works, because Deno erases a type-only import at run time.
- proof: `cd app && git show origin/slice/b3:app/src/server/lib/db.ts > src/server/lib/db.ts && deno check --frozen --config supabase/functions/job-runner/deno.json supabase/functions/job-runner/index.ts; echo $?; git checkout -- src/server/lib/db.ts` → `0` (and `3 errors` without the first line).
- added: 2026-10-04

## P-908 · `supabase config push` does not compare `[functions.*]`, an Edge Function's `verify_jwt` travels with the deploy, and `bunx supabase` in a scratch worktree fetches another CLI version
- symptom: step 5 says `bunx supabase config push` applies `[functions.job-runner] verify_jwt = false`; it printed `Nothing to push: the project already matches the declared properties` (scope api, auth, database, pooler, realtime, storage). From a scratch worktree `bunx supabase functions deploy` failed with `'db' has invalid keys: orioledb_version`.
- cause: config push has no function scope; `functions deploy` reads the key from `config.toml`. The scratch worktree has no `node_modules`, so `bunx` fetched a different CLI that rejects this `config.toml` (P-077 again).
- rule: prove `verify_jwt` with the deploy and a bearer-less `curl` (`401 unauthorized` from the function's own check, not Supabase's JWT `401`); run the CLI from a scratch worktree as `app/node_modules/.bin/supabase` of a tree where `bun install` has run (a lane's path is only the example: `/e/mop-build/ops/app/node_modules/.bin/supabase` exists on this laptop while the lane lives). The Supabase Edge deploy with `--use-api` did not reject a `deno.lock` whose zod integrity was altered (measured 2026-10-04), so the exact pins are the guard (ASSUMED E5).
- proof: `curl -s -o /dev/null -w "%{http_code}" -X POST https://$DEV_SUPABASE_PROJECT_REF.supabase.co/functions/v1/job-runner` → `401` and with `-H "Authorization: Bearer $JOB_RUNNER_SECRET"` the body `{"claimed":0,"jobs":[]}`.
- added: 2026-10-04

## P-909 · `eslint .` cannot parse a new Deno entry under `supabase/functions/`: the app tsconfig does not include it
- symptom: `eslint supabase/functions/job-runner/index.ts` prints `Parsing error: ... index.ts was not found by the project service. Consider either including it in the tsconfig.json or including it in allowDefaultProject` and `bun run check` is red on lint (B8 g4, 2026-10-04).
- cause: lint is type-aware (R01, projectService) and `app/tsconfig.json` includes no `supabase/functions/**`, because Deno code has no Deno globals in the app's type environment. The fix in `eslint.config.js` (a block that extends `tseslint.configs.disableTypeChecked`, declares `Deno` and sets `projectService: false`) also switches off every type-checked rule for these files: `no-floating-promises` no longer runs there, and `deno check` does not catch a floating promise either.
- rule: a new Deno entry needs that block and its `DENO_FILES` entry (H46) the moment it exists; a dropped `await` in a Deno file is caught only by review until a project block with Deno types replaces the disabled one (open follow-up of B8 g4).
- proof: `cd app && node_modules/.bin/eslint supabase/functions/job-runner/index.ts; echo $?` → `0`; with `eslint.config.js` taken from the commit before 82600a5 (`git show 82600a5~1:app/eslint.config.js`) the same command prints `was not found by the project service` (watched, 2026-10-04).
- added: 2026-10-04

## P-910 · A lane's code that calls an RPC of its own unmerged migration cannot typecheck: `gen:types` reads mop-dev, which lacks the function
- symptom: B8 g5 (step 6a) had to call `db.rpc("beat", ...)` in `runner.ts` and `db.rpc("ops_health", ...)` in the hook, and register both in `fakeDb`; `src/db/types.ts` had neither (`git grep -c '"beat":' -- app/src/db/types.ts` → no output), so the calls and the fakes are type errors. Ruling H57 forbids pushing the migration from the lane, `gen:types -- --db` reads mop-dev (P-508), and `--local` needs CI's stack, which does not exist yet.
- cause: the generator only reads a live schema; the only live schema is the one `main` pushed. P-906 moved the `beat` case to step 6a, but step 6a meets the same wall.
- rule: add the new table and function entries to `src/db/types.ts` in the generator's own shape (alphabetical place, its quoting and spacing, `Returns: undefined` for `void`, `Returns: Json` for `jsonb`, an argument with a default as optional), say so in the log, and list the regeneration as UNPROVEN: after `main` pushes the migration, `bun run gen:types -- --db` must print `wrote src/db/types.ts` and `git diff --exit-code src/db/types.ts` must exit 0. A diff there means the hand entries were wrong and the regenerated file wins.
- proof: `cd app && git grep -c '"ops_heartbeats": {\|"beat":\|"ops_health":\|"jobs_liveness":' -- src/db/types.ts` → `4` on slice/b8 at B8 g5 and `bun run typecheck` exits 0; after main's push, the regenerate-and-diff above (UNPROVEN on 2026-10-04).
- added: 2026-10-04

## P-911 · pg_cron 1.6.4 replaces a job of the same name, so "unschedule by name first" (F16) has no observable effect and its watched-fail stays green
- symptom: B8 g5 removed `select cron.unschedule('job-runner') where exists (...)` from `20261004023709_job_cron.sql` and replayed the re-apply case of `tests/db/ops-health.db.test.ts` (the migration run twice in one transaction): `WATCHED-FAIL BAD: stayed green`. The case still found exactly one `job-runner` row.
- cause: since pg_cron 1.3, `cron.schedule(job_name, schedule, command)` updates the existing job of that name instead of adding a second one; mop-dev runs `pg_cron` 1.6.4 (`select extversion from pg_extension where extname = 'pg_cron'`).
- rule: keep the unschedule line where a plan requires it (B2's `analytics-partitions` and B8's cron migrations do), but do not register a watched-fail for it and do not claim a test proves it; the re-apply property (one row after two applies) is what the test asserts. A plan that wants a guard against an older pg_cron says so.
- proof: from `app/` with the dev profile, `env -u CLOUDFLARE_API_TOKEN node scripts/watchfail.mjs --file supabase/migrations/20261004023709_job_cron.sql --find "<the two unschedule lines>" --replace "" --run "bunx vitest run --project db tests/db/ops-health.db.test.ts -t \"re-applies to one row\"" --expect "× .*re-applies"` → `WATCHED-FAIL BAD: stayed green` (measured 2026-10-04, B8 g5).
- added: 2026-10-04

## G-350 · In PL/pgSQL, `text[] || 'literal'` reads the literal as an array and raises `malformed array literal`
- paths: app/supabase/sql/functions/**
- severity: warn
- symptom: B8 g5's first `ops_health` built its list with `v_failing := v_failing || 'runner'` and the probe on mop-dev raised `ERROR:  malformed array literal: "runner"` with `DETAIL:  Array value must start with "{" or dimension information.`
- cause: `||` has both `anyarray || anyelement` and `anyarray || anyarray`; an untyped string literal resolves to the array form, so Postgres parses `'runner'` as an array literal.
- rule: append to an array with `array_append(v_list, 'name')` (or cast the literal, `'name'::text`); never `v_list || 'name'`.
- proof: `cd app && bun run db:psql -- -Atc "select array['a'] || 'b'"` → `ERROR:  malformed array literal: "b"`; `select array_append(array['a'], 'b')` → `{a,b}` (measured 2026-10-04, B8 g5).
- added: 2026-10-04
