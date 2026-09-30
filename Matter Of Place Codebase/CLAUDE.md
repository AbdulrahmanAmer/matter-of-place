# Matter of Place — app folder

The project instructions live one level up in `../CLAUDE.md` (workspace root: maps, stage file, position file,
gotcha bank, worker agents). Claude Code loads that file automatically when a session opens here; this file exists
so nobody thinks the app has no instructions.

Rules that apply to every edit in this folder:
- `AGENTS.md` (same folder) holds the code conventions. Read it before touching `src/`.
- `../GOTCHAS.md` holds the things that already broke or cost time; a hook pushes the relevant entries when you edit a protected file.
- `../PROJECT-STATE.md` holds the agent-os stage. Stage 0 refuses writes under `src/`; the operator advances it.
- `bun run check` must pass before any commit. Never edit `src/routeTree.gen.ts`.
