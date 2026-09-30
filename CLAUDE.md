# Matter of Place — project instructions

Selective real-estate media platform (editorial + distribution) for existing residential property in
California, New York and Florida. An Omnikom company. Domain: matterofplace.com. Frontend MVP built on
Lovable; backend, automations, social, newsletter and the audit agent are not built yet.

## Layout (this folder is the workspace root; the app is one level down)
- `Matter Of Place Codebase/` — the app (React 19, TanStack Start SSR, Vite 8, Nitro → Cloudflare Worker). Its own
  `AGENTS.md` holds the code conventions; read it before any edit under `src/`. `docs/` there is the architecture
  (API contract, data model, schema.sql, caching, deploy). `npm run check` must pass.
- `workspace/` — our maps: `01-site-index` (pages, wording, content), `02-tech-stack`, `03-diagrams`, `04-completion-map`.
  The operator reads pictures, not Mermaid: every diagram ships as PNG + SVG in `03-diagrams/img/` via `node render.mjs`
  (run it after any diagram edit; send the PNGs with SendUserFile).
- `PROJECT-STATE.md` — agent-os stage + decisions. Stage 0 denies writes under `src/`; the operator advances the line.
- `.claude/POSITION.md` — position file, injected on compact/resume. Append a block when a unit of work closes.
- `.mcp.json` — codebase-memory graph (project `E-Matter Of Place-Matter Of Place Codebase`). Use it for code questions;
  grep for copy/config.

## Commands (run inside `Matter Of Place Codebase/`, bun is installed)
```
bun run check     # typecheck + lint + prettier
bun run build     # .output/ for Cloudflare (nitro cloudflare_module)
bun run dev       # http://localhost:8080
```

## Model routing (token discipline is a project requirement)
- Orchestrator: this session (Fable). Judgment, synthesis, RULE 2 verification only.
- Workers: `.claude/agents/mop-*.md` — Sonnet at medium or lower, Haiku for extraction. Never spawn Fable children.
- Anything deterministic (image resize, carousel render, sitemap, reports) becomes a script, not a prompt.
- Design, video and social creative go through `mop-designer` (Sonnet as creative director with the brand DNA).

## Brand guardrails that gate every deliverable
- Copy: calm, brief, specific, no em dashes, no hyperbole, no guarantees of leads/buyers/sales. Markets: CA, NY, FL only.
  No developments, no global, no memberships. Price never equals merit.
- Visual: palette Obsidian #11110F, Bone #EEEAE1, Warm Ivory #F5F2EB, Sandstone #C9C0B2, Mineral Grey #575751,
  Warm Grey #8B877F. Jost / Urbanist (utility) + Cormorant Garamond (editorial). No gradients, glow, gold, SaaS cards.
- The three tests: a $15M owner is comfortable here; a non-buyer would still follow; a top agent says "we got you in".

## Lovable
The repo syncs to Lovable. Never rewrite pushed history. There is no `.git` locally yet (see completion map, slice B1).
