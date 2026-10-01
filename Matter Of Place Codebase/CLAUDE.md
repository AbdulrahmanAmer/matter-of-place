# Matter of Place — app folder

The project instructions live one level up in `../CLAUDE.md` (workspace root: maps, stage file, position file,
gotcha bank, worker agents). Claude Code loads that file automatically when a session opens here; this file exists
so nobody thinks the app has no instructions.

Rules that apply to every edit in this folder:

- `AGENTS.md` (same folder) holds the code conventions. Read it before touching `src/`.
- `../GOTCHAS.md` holds the things that already broke or cost time; a hook pushes the relevant entries when you edit a protected file.
- `../PROJECT-STATE.md` holds the agent-os stage (currently Stage 3, BUILD, where writes under `src/` are allowed); check it there, the operator advances it.
- The approved spec is in `../workspace` (`02-tech-stack/tech-stack.md`, `06-architecture/architecture.md`, `05-plans/`). `docs/` here is the earlier sketch, read for intent only.
- `bun run check` must pass before any commit. Never edit `src/routeTree.gen.ts`.
