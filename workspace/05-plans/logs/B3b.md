# B3b log

## g1 · steps 1

Step 1 (mop-designer, no code): `app/docs/coming-soon.md` holds the runbook (how the mode works, flags and how to add one, consent record and `CONSENT_VERSION`, who flips what, seeing the empty state, launch checklist), the layout decisions, the copy table (31 rows), and the accessible-name and focus notes. Main merged first: `Already up to date`.

Proof 1, the table scan (run in `app/`):

```
$ node -e "const rows=...filter(l=>/^\| \x60/.test(l));const bad=rows.filter(l=>/—|\x21|exclusive|guarantee|stunning|luxury|buyers|leads|unlock/i.test(l));console.log(rows.length+' rows, '+bad.length+' bad');process.exit(bad.length?1:0)"
31 rows, 0 bad
exit 0
```

Watched-fail of the scan: a scratch copy with the `badge` row set to `Opening soon!` printed `31 rows, 1 bad`, exit 1. Restored (the real file is unchanged).

Proof 2, gates in `app/`:

```
bunx prettier --config .prettierrc --check docs/coming-soon.md -> All matched files use Prettier code style!
bun run check (foreground, first run) -> layout, typecheck, lint, knip, jscpd, stubs, format:check passed; vitest stage failed:
  Error: [vitest-pool]: Failed to start forks worker for test files E:/mop-build/coming/app/tests/unit/owner-presented.test.tsx.
  Caused by: Error: [vitest-pool-runner]: Timeout waiting for worker to respond
  quiet: exit 1
bun run test (alone, background, second run) -> Test Files  99 passed (99) / Tests  1269 passed (1269) / quiet: ok
bun run build -> quiet: ok (249 lines)
```

The first red is the worker-start timeout of P-712 (hit again, banked), not an assertion.

Two bends for the review, both in the doc: (1) on desktop the form button sits on the field's row, so the tab order (field, chooser, button) differs from the visual order in one place; the consent notice keeps one DOM for both widths, so desktop Tab runs Allow, No thank you, then the link; (2) `what` shows on the home hero only.
