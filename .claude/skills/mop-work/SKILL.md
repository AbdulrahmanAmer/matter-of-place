---
name: mop-work
description: Operational context for Matter of Place — the Omnikom real-estate media platform (TanStack Start MVP from Lovable at E:\Matter Of Place\Matter Of Place Codebase, workspace maps one level up). Use whenever the user mentions Matter of Place, matterofplace.com, the listings-to-content pipeline, Place Notes, Property Exposure, the mop-* agents, or says "where are we", "what's pending", "load context", or opens a session in E:\Matter Of Place. Loads the stage file, position file, gotcha bank, maps and the code graph so the session starts on the real state instead of re-deriving it.
allowed-tools: Bash, Read, Glob, Grep, Agent
---

# Matter of Place — load the state, then work

Read these in order; they are short and they outrank memory of any earlier conversation.

1. `PROJECT-STATE.md` — the agent-os stage and the decision ledger. Stage 0 refuses `src/**`. Open decisions lead the session.
2. `.claude/POSITION.md` — last closed block, what is BLOCKED / UNPROVEN, and NEXT.
3. `GOTCHAS.md` — the process section at the bottom (P-0NN) every session; path entries are pushed by the hook when relevant.
4. `workspace/00-MAP-OF-WHAT-WE-HAVE.md` — company, built site, what docs specify but nothing implements.
5. Only when the task needs it: `workspace/02-tech-stack/tech-stack.md` (decisions D1–D12), `workspace/04-completion-map/completion-map.md` (slices), `workspace/01-site-index/*` (every page, string and record; read these instead of re-reading `src/`).

Code questions go to the graph, not to whole-file reads:
```
"C:/Users/DELL/AppData/Local/Programs/codebase-memory-mcp/codebase-memory-mcp.exe" cli search_graph '{"project":"E-Matter Of Place-Matter Of Place Codebase","name_pattern":"<symbol>"}'
```
(the MCP tools `mcp__codebase-memory__*` do the same when loaded). Re-index after structural changes.

Workers: `mop-designer` (Sonnet, creative director), `mop-builder` (Sonnet, one slice with a verification command),
`mop-scout` (Haiku, extraction), `mop-auditor` (Sonnet, site and channel audit). Never spawn Fable children.

Before saying done: run the gate yourself (`bun run check` and `bun run build` in the codebase for code; `node
workspace/03-diagrams/render.mjs` for diagrams, then send the PNGs), append a block to `.claude/POSITION.md`, and add a
GOTCHAS entry for anything that cost time it should not have. The bank is maintained without being asked: if a turn
contained a failed tool call, a wrong assumption or a rework, the entry is written in that turn and the reply says so.
