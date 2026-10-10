# FIX security F1 and F2 (scan 2026-10-10): log

Branch `fix/security-f1-f2`, from `origin/main` 9fa756e3. Bank: P-3100 (F1), P-3101 (F2).

## F1: `/markets/*` redirect

- Code: `app/src/lib/legacy-markets.ts` (`legacyMarketTarget`), used by `app/src/routes/_site.markets.$.tsx`. The splat is split on slashes and backslashes, empty segments are dropped, a dot segment or a control character sends the visitor to `/`. The target always starts with one `/` and a non-empty segment.
- Observed before the fix, dev server (`bun run dev`, curl): `/markets//evil.example` answers `307 location: /markets/evil.example` (the router collapses the double slash first), `/markets/%5Cevil.example` the same, `/markets/california` answers `301 location: /california`. So the scan's `Location: //evil.example` was not reproduced over HTTP on the dev server (UNPROVEN on the deployed Worker). In a router test with the old code, the splat `\evil.example` produced the redirect href `/\evil.example` (red output below), which is the hazard.
- Tests: `app/tests/unit/legacy-markets.test.ts`, 11 tests. `/markets//evil.example` is green under the old code too (the router normalizes it), so no mutant turns that case red; `%5C` and `%5C%5C` do.

## F2: search matcher regex

- Code: `app/src/lib/search-match.ts`. `budgetFrom` starts at the digits (the word prefix and `$` never changed the captured amount). `readQuery` collapses whitespace, trims, and reads budget and bedrooms once; `scoreProperty` takes the reading.
- Measured before the fix (node): the old pattern on `"x" + 498 spaces + "x"` took 34.0 ms per call (31.1 ms at 250 spaces, 39.1 ms for 500 spaces); the new pattern 0.078 ms. At 40 cards the old matcher costs about 1.4 s a request.
- Tests: `app/tests/unit/search-match.test.ts` gained three (budget formats, whitespace runs, bounded time over 40 cards, equal to the trimmed query).
- Not tested directly: that the reading happens once, not per card. The bounded-time test shows the cost, and its mutant (old regex run 40 times) is the per-card behaviour.

## Registry: `app/tests/mutations/fix-security.json` (8 entries, one per new test group)

Red reasons observed (mutant applied, `bunx vitest run --project unit <file>`):

| id | mutant | red output |
| --- | --- | --- |
| fix-sec-f1-target-desk | return only the first segment | `expected '/california' to be '/california/la-jolla'` |
| fix-sec-f1-target-origin | keep empty segments | `expected '//evil.example' to match /^\/(?![/\\])/` (7 tests) |
| fix-sec-f1-target-dots | dot and control check off | `expected '/a/../b' to be '/'` |
| fix-sec-f1-route-status | `statusCode: 302` | `expected { Object (href, statusCode) } to deeply equal { Object (href, statusCode) }` |
| fix-sec-f1-route-origin | old href `/${splat}` | `expected '/\evil.example' to match /^\/(?![/\\])/` |
| fix-sec-f2-budget | millions as 1e5 | `expected 'under 6m: false' to be 'under 6m: true'` |
| fix-sec-f2-collapse | no whitespace collapse | `expected [] to deeply equal [ { slug: 'place', score: 3, ... } ]` |
| fix-sec-f2-bounded | no collapse, old regex run 40 times | `expected 1479.4506 to be less than 50` |

Replay (from `app/`, `node scripts/watchfail.mjs --registry tests/mutations --only <id>`): every id printed `WATCHED-FAIL OK fix-security:<id>`, exit 0.

## Gate

- `NODE_OPTIONS=--max-old-space-size=4096 node ../workspace/05-plans/quiet.mjs -- bun run check; echo exit=$?` printed `quiet: ok`, `exit=0`.
- `bun run build` exit 0.
- `node workspace/05-plans/check-gotchas.mjs` printed `check-gotchas: OK`.
