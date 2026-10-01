# tests

`tests/unit/` holds Vitest tests (`bun run test`, part of `bun run check`): contracts, forms, the state machine, and pure helpers such as `pageHead`. `tests/e2e/` will hold Playwright sweeps of every route on desktop and phone with accessibility checks, run on every pull request. A change is finished when the test its extension path names is green (`docs/HOW-TO-ADD.md`).
