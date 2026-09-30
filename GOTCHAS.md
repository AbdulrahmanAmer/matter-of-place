# GOTCHAS — the bank of things that already cost us time

Purpose: never re-discover a fix, never re-break a thing that works. Every entry names the paths it protects, what
went wrong, why, the rule, and how to prove the rule still holds. `.claude/hooks/gotcha-guard.mjs` reads this file
before every Edit or Write and pushes the matching entries into the session (severity `block` refuses the edit;
`warn` injects the entry as context). Entries without a `paths:` line are process gotchas and are never injected;
they are read by `mop-work` at session start.

Rules for the bank itself
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

## G-002 · Vite config must not add plugins the Lovable preset already includes
- paths: Matter Of Place Codebase/vite.config.ts
- severity: warn
- symptom: duplicate-plugin crash ("plugin already registered") or a broken dev server.
- cause: `@lovable.dev/vite-tanstack-config` already registers tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro, env injection and the `@` alias.
- rule: pass extra config through `defineConfig({ vite: { ... } })`; never import those plugins yourself. When we leave the Lovable preset, replace the whole file in one move and re-run `bun run build`.
- proof: `bun run build` → "built in" with no plugin warnings.
- added: 2026-09-30

## G-003 · Page titles: pass the bare title, `pageHead` adds the suffix
- paths: Matter Of Place Codebase/src/lib/seo.ts, Matter Of Place Codebase/src/routes/index.tsx
- severity: warn
- symptom: home `<title>` renders "Matter of Place | Exceptional property. Properly considered. | Matter of Place".
- cause: `pageHead` only skips the " | Matter of Place" suffix when the title already ends with it; the home route passes a title that starts with the brand instead.
- rule: routes pass titles without the brand; the home route is the one exception and must be handled inside `pageHead` (fix pending, stage 0 forbids src edits).
- proof: `curl -s http://localhost:8080/ | grep -o "<title>[^<]*"` → exactly one "Matter of Place".
- added: 2026-09-30

## G-004 · Field names live in three files and must change together
- paths: Matter Of Place Codebase/src/domain/**, Matter Of Place Codebase/docs/database/schema.sql
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
- proof: `grep -rn "VITE_" .env.example` → only SITE_URL, API_BASE_URL, INSTAGRAM_URL.
- added: 2026-09-30

## G-007 · Styling is tokens only: no hex, no utility classes
- paths: Matter Of Place Codebase/src/styles/**, Matter Of Place Codebase/src/components/**
- severity: warn
- symptom: a colour drifts from the palette or a Tailwind class does nothing (Tailwind is installed but no stylesheet imports it).
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

## P-007 · Plugins are installed at project scope on purpose
- rule: `claude plugin install <name>@claude-plugins-official --scope project`; global installs load into every other project's context and burn tokens there.
- proof: `.claude/settings.json` → `enabledPlugins` lists them; `~/.claude/settings.json` does not.
- added: 2026-09-30
