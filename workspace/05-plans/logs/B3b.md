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

## g2 · steps 2

Main merged first (`git merge origin/main`, clean). Files: `src/lib/strings.ts` (`comingSoon`, `consent`, `fill`), `src/lib/coming-soon.ts`, `src/lib/consent.ts`, `src/domain/flags.ts`, `src/lib/analytics.ts` (three names, `setUtmConsent(consentGranted)`), `src/server/lib/flags.ts` (`mergeFlags` only: the step 2 test needs it, step 4 adds `getFlags` to the same file, P-074), `tests/unit/{coming-soon,copy-voice,flags,consent}.test.ts`, the `utm consent` case of `tests/unit/analytics-batch.test.ts`, `tests/unit/analytics.test.ts` (`everyEvent` lists the three new names, else typecheck fails), `tests/mutations/B3b.json` (34 entries, ids `b3b-<letter>` because every plan letter is taken in another registry, P-066). The 31 rows of the g1 table are in `strings.ts` word for word (one-off compare: `31 rows, 0 missing`).

Proof 1:

```
$ bunx vitest run --project unit tests/unit/coming-soon.test.ts tests/unit/copy-voice.test.ts tests/unit/flags.test.ts tests/unit/consent.test.ts
 Test Files  4 passed (4)
      Tests  33 passed (33)
```

Proof 2 (run directly: `quiet.mjs` drops the quotes of `-t "utm consent"` and splits it into `-t utm` plus a file filter `consent`, which ran four cases instead of one):

```
$ bunx vitest run --project unit tests/unit/analytics-batch.test.ts -t "utm consent" --reporter=verbose
 ✓ |unit| tests/unit/analytics-batch.test.ts > track() campaign attribution (G45) > utm consent follows the stored record and Global Privacy Control 1191ms
      Tests  1 passed | 11 skipped (12)
```

Proof 3, watched-fail replay of all 34 entries (`node scripts/watchfail.mjs --registry tests/mutations --only b3b-<id>`), every one `WATCHED-FAIL OK B3b:<id>`: d, cv-count, cv-hype, cv-brief, cv-places, cv-fill, h, i, k, co-none, co-yes, co-no, co-corrupt, co-write-throw, co-stores, co-once, co-refused, co-event, l, fl-defaults, fl-unknown, fl-refuse, fl-snake, fl-archive, fl-ignore, fl-malformed, cs-open, cs-listings, cs-source, cs-fill, cs-own, cs-empty, cs-scopes, z. Each file was back to its tracked text after the loop (`git status` showed only the group's own files).

Proof 4, `bun run check` (quiet): layout, typecheck, lint, knip, jscpd, stubs and format:check passed; the vitest stage printed `Test Files  1 failed | 110 passed (111)` with `× lint gives prettier/prettier the options of .prettierrc for it 29880ms` (`Test timed out in 20000ms`, its own limit, with two other lanes running). `bunx vitest run --project unit tests/unit/hygiene.test.ts tests/unit/mutation-registry.test.ts tests/unit/analytics-allowlist.test.ts` right after: `Test Files  3 passed (3)`, `Tests  61 passed (61)`. Load, banked as a hit on G-031.

Proof 5: `bun run build` -> `quiet: ok (243 lines)`.

## g1 · steps 1

Repair after review. Fixed in `app/docs/coming-soon.md`, each from the plan line it states: launch checklist now follows L1 step 1 letters 1b to 1g, adds `gh variable set MOP_DB_PRODUCTION --body true` (B3b.md:136, L1.md:24), names `MOP_LAUNCHED` (L1 step 4e) and the rollback remedy; the illustrative section follows B3b.md:22, 105, 122 to 128 (one `IllustrativeNotice` block wherever an illustrative property shows, a separate `ILLUSTRATIVE PROPERTY` tag on cards and heroes); both who-flips lines name the chief and managing editor (B7.md:70 `markets.edit`); the flag recipe names `defaultFlags` as a literal (it is one in `src/domain/flags.ts`); the desktop flip leads with `with-coming-soon.ts` (G34); the seed line says `--images upload` waits for B9; the pointer-close focus line says where focus goes and that step 5 records it. Bank: P-008 and P-712 hit again, P-1300 added.

Proof 1 (in `app/`):

```
$ node -e "const rows=...filter(l=>/^\| \x60/.test(l));...console.log(rows.length+' rows, '+bad.length+' bad')..."
31 rows, 0 bad
```

Proof 2: `bun run check` (quiet, background) -> `exit=0`, stages layout, typecheck, lint, knip, jscpd, stubs, format:check and vitest ran; `quiet: ok (50 lines, showing the last 12)`.

Proof 3: `bun run build` -> `quiet: ok (242 lines, showing the last 12)`.

Proof 4: `node workspace/05-plans/check-gotchas.mjs` -> `check-gotchas: OK (38 path entries, 263 process entries)`.
