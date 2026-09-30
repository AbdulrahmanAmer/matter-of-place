# POSITION — Matter of Place

Newest block at the bottom. One block per closed unit of work. Record BLOCKED / UNPROVEN / PARTIAL explicitly.

## 2026-09-30 — Step zero: workspace set up, everything indexed

DONE
- Read: README, AGENTS.md, roadmap, docs/** (architecture, services, data model, caching, schema, deploy, 5 ADRs),
  brief/master-plan + brief/recalibration, .lovable/plan/*, key src files (site.ts, exposure.ts, analytics.ts,
  nav-links.ts, services/types.ts, server.ts, vite.config.ts, tokens.css, strings.ts).
- Verified the MVP: `bun install` ok; `bun run typecheck` exit 0; `bun run lint` clean; `bun run build` exit 0
  (nitro cloudflare_module, emits .output/server/wrangler.json).
- Installed at project scope (E:\Matter Of Place\.claude\settings.json): claude-security, security-guidance,
  code-review, pr-review-toolkit, feature-dev, claude-md-management, commit-commands, hookify, cloudflare, resend,
  playwright, typescript-lsp, session-report, context7, skill-creator. agent-os was already installed globally.
- agent-os: `PROJECT-STATE.md` at STAGE 0, enforcement deny. Verified the gate denies
  `Matter Of Place Codebase/src/**` and `package.json`, allows `workspace/**`.
- codebase-memory: `.mcp.json` registered (loads next session); CLI index done: 2322 nodes / 8418 edges,
  project name `E-Matter Of Place-Matter Of Place Codebase`.
- workspace/01-site-index: pages-and-wording.md (20 URLs + chrome + forms + strings + 21 events),
  content-inventory.md (16 properties, 3 markets/12 regions, 6 stories, 4 products, FAQ, types, 31 images, 1 video),
  appendix-data-copy.md.
- workspace/00-MAP-OF-WHAT-WE-HAVE.md, 02-tech-stack/tech-stack.md (DRAFT, decisions D1–D13),
  03-diagrams/big-diagram.md (DRAFT), 04-completion-map/completion-map.md (DRAFT).
- Worker agents: .claude/agents/mop-designer, mop-builder, mop-scout, mop-auditor (Sonnet med / Haiku low).

FOUND (not fixed — stage 0 forbids src edits)
- Home `<title>` duplicates the suffix: "Matter of Place | Exceptional property. Properly considered. | Matter of Place"
  (`pageHead` in src/lib/seo.ts only skips the suffix when the title already ends with it).
- contact.email/phone, legal.entity/address, VITE_INSTAGRAM_URL all unset → contact lines, legal lines, Instagram link
  do not render. Owner input.
- README says Vite 7; package.json pins vite 8.1.5.

DONE (later in the same session)
- Git: repo root is `E:\Matter Of Place` (workspace + codebase). `.gitattributes` forces LF; `core.autocrlf false`.
  Initial commit 8dd6f26. Private GitHub repo https://github.com/AbdulrahmanAmer/matter-of-place, branch main, pushed.
  D13 is therefore answered: this is the repo. Lovable is NOT connected to it; if Lovable's GitHub sync is wanted later,
  Lovable needs the app at a repo root, which this layout does not give it (decide then).
- Diagrams: all 4 Mermaid blocks parse (checked in the browser with mermaid@11). Diagram 1 had `:::todo` on subgraphs,
  which Mermaid rejects; replaced with `style <id> stroke-dasharray`. `workspace/03-diagrams/render.mjs` renders every
  block to PNG + SVG in `workspace/03-diagrams/img/` (operator needs pictures, not Mermaid source).

DONE (operator asked "what did you skip": gotcha bank + app-folder CLAUDE.md)
- `GOTCHAS.md` at root: 9 path entries (G-001…G-009) + 7 process entries (P-001…P-007), template and rules.
- `.claude/hooks/gotcha-guard.mjs` registered as PreToolUse (Edit|Write|MultiEdit|NotebookEdit) in `.claude/settings.json`.
  Watched-fail tested: routeTree.gen.ts → deny; src/lib/seo.ts → additionalContext; workspace/README.md → silent;
  path outside root → silent; garbage stdin → silent, exit 0.
- `Matter Of Place Codebase/CLAUDE.md` pointer (the real one is at the workspace root, which Claude Code loads anyway).
- `.claude/skills/mop-work` (project context loader) + copies of `design-from-references`, `motion`,
  `parallel-execution`, `codebase-index` from the agent-os skills pack.

BLOCKED / WAITING ON OPERATOR
- Decisions D1–D12 in PROJECT-STATE.md (deploy target, API placement, email, payments, social platforms, audit cadence).
- Scheduling `mop-auditor` needs a live URL and API credentials (Search Console, GA4, Meta, Resend); not before slice B1.

NEXT
- Operator reads workspace/02-tech-stack/tech-stack.md and answers the decisions; then STAGE → 2 (system design) and
  we write the sliced plan from the completion map.
