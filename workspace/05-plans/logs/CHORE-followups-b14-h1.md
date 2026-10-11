# CHORE follow-ups: the B14 step 5 and H1 code follow-ups

Lane: worktree `D:/mop-build/fix6`, branch `chore/followups-b14-h1`, started from origin/main 8ebb4ce6, merged with origin/main 7a283e81 before the hand-in (GOTCHAS.md through `bank-merge.mjs`: 895 entries, 0 lost). Date 2026-10-11 (+0300). Builder: Sonnet 5.5, high effort.

## Sources

- (a) B14: `workspace/05-plans/logs/B14-followups.md` (g1 steps 2,3; g4 step 6; g2 step 4; g2 step 5), with the step 5 reviewer's items named in the brief.
- (b) H1: `workspace/05-plans/H1-followups.md` does not exist. The six follow-ups P-3019 refers to are the six that `logs/H1.md` (line 1248) records "word for word in `workspace/05-plans/logs/H1-followups.md` under '## g7 · steps 4, 10'". That section was used. The other sections of `logs/H1-followups.md` (g1 to g9, the merge note) were not part of the brief and were not worked.

## Closed

Each line: the item, the change, the test that covers it, the registry ids (all in `app/tests/mutations/chore-followups.json` unless named), the red reason, and the replay. Replay of any id: `cd app && node scripts/watchfail.mjs --registry tests/mutations --only <id>` prints `WATCHED-FAIL OK chore-followups:<id>`. All 53 ids were replayed one at a time on the working tree before the commit with the dev profile loaded and `env -u CLOUDFLARE_API_TOKEN`: 53 `WATCHED-FAIL OK` (one id, `chore-fu-schedule-contract-enabled`, was first `BAD: wrong reason`, see P-3150, and is OK after the test was made strict). The 58 older entries that mutate a file this change touched (`b14-scope-*`, `b14g2-*`, the compare, cache, usage and uptime entries, `h1g7-guard-fail-drill`, `h1g7-guard-health-drill`, `h1g9-oo-h107-list`) were replayed too: 58 `WATCHED-FAIL OK`.

B14 g1
1. `uptime.mjs`, no test guarded the `keyword_type` check. Test `uptime.test.ts` "gives a red row for a monitor that alerts when the keyword exists" (only `keyword_type` changed to 1). Entry `chore-fu-uptime-keyword-type`; red: with the check replaced by `true` the ops-health row stays ok.
3. `cache.mjs` run alone with no `--url` and no SITE_URL crashed with `TypeError: Invalid URL`. New `commandLines(ctx)` prints `Not measured: cache (SITE_URL unset, pass --url)`, sends no request, exits 0. Tests `cache.test.ts` "prints Not measured and sends no request without --url or SITE_URL" and "exits 0 with that line and no stderr when run alone" (a child process with only PATH in its environment). Entries `chore-fu-cache-nourl-guard` (red: the probe runs with no base) and `chore-fu-cache-cli-wiring` (red: the command line calls the probe directly, exit 1).
7. `run-all.mjs` `readSchedule` expects a bare `enabled` from the schedule route. Contract tests in `run-all.test.ts` call the real `getScheduleSetting` of `src/server/automation/service.ts` on a fake database and feed its JSON to the routine: "reads a disabled row of the service as disabled and skips the run" and "reads an enabled row of the service as enabled and records scheduled". Entries `chore-fu-schedule-contract-disabled`, `chore-fu-schedule-contract-enabled`; red: the service body wrapped in `{ data: ... }` makes the routine run on a disabled schedule and record `not_measured.schedule`.

B14 g4
2. `scripts/audit/scope-check.mjs` allowed route names that serve /api/* without the `api/` folder. One rule now: any segment under `app/src/routes/` that is `api` or starts `api.`, `api_` or `api[` is refused (`api_.contact.ts`, `(site)/api.contact.ts`, `api[.]json.ts`); `apiary.tsx` and `api-docs.tsx` stay allowed. Test `scope-check.test.ts` "refuses an api_ file, a group folder and an escaped dot under routes". Entries `chore-fu-scope-api-underscore`, `chore-fu-scope-api-bracket`, `chore-fu-scope-api-group`, `chore-fu-scope-api-prefix`; the older `b14-scope-api-dir` and `b14-scope-api-flat` in `B14.json` were re-pointed at the new regex and replay OK. Still open by design (not code of this file): a route file outside `api` that carries `server.handlers`; the human merge stays the enforcement.
3. `audit-scope.yml` states its cost (C22) and the P-009 budget. The cost is an estimate, UNPROVEN: every run so far was skipped (`gh run list --workflow audit-scope.yml`), none timed the job. Test `workflows-docs.test.ts` "states its cost in Actions minutes and the P-009 budget it draws on (C22)". Entry `chore-fu-wd-cost`.
4. Watched-fail (al) is a registry entry: `chore-fu-al-audit-scope-persist` (`persist-credentials: true` in `audit-scope.yml`, `hygiene.test.ts` "every actions/checkout sets persist-credentials: false" goes red naming the file).
5. `.github/workflows/README.md` said "These three exist" and called `audit-scope.yml` the weekly audit robot. It now has a row for every workflow file. Tests `workflows-docs.test.ts` "has a table row for every workflow file in the folder" and "does not describe audit-scope.yml as the weekly audit robot". Entries `chore-fu-wd-readme-row`, `chore-fu-wd-readme-stale`.

B14 g2
step 4 item 2: exports nothing imports. `gaugeRows`, `describeRows` (usage.mjs), `sumRequests` (cloudflare.mjs), `DEV_BASE_URL`, `agentGet` (ours.mjs), `parseSentryStats` (sentry.mjs) and `changedPaths` (scope-check.mjs) are no longer exported. Test `tests/unit/audit/exports.test.ts` fails on any export of `workspace/audits/tools/**` or `scripts/audit/*.mjs` that no other file mentions (knip does not scan those folders). Entries `chore-fu-exports-sumrequests`, `chore-fu-exports-changedpaths` (red: the diff lists `.../cloudflare.mjs sumRequests`), `chore-fu-exports-scan` (red: the scan finds no export to judge).
step 5 item 2: `compare.mjs`. `newestSidecars(dir)` returns none only for a folder that does not exist, and throws any other error; `chooseSidecars` takes two paths or none and throws on one or three, the command exits 2 with a `compare:` line on stderr. Five tests in `compare.test.ts` under "choosing the two sidecars". Entries `chore-fu-compare-newest-order`, `chore-fu-compare-none`, `chore-fu-compare-enotdir`, `chore-fu-compare-usage`, `chore-fu-compare-exit2`.

H1 g7 steps 4 and 10 (the six)
1. `fail-drill.ts` left a `send_email` job and an `email_messages` row. `scripts/harden/drill-rows.ts` `emailDrillRows` finds the message and the job (by message, or by the address in the job's payload) and the job's events, only rows created at or after the run's start; `removeFailDrillRows` hands them to `cleanup`.
2. `fail-drill.ts` left a revoked key and an enabled `media_ops` role. `retireDrillAgent` deletes the key row and disables that user's role (the next run enables it again).
3. `health-drill.ts` took "the newest `health.failed` event". `healthEventOf(db, jobId, check)` takes the event written inside the health job's own run window (creation to `finished_at`, or now) that lists the check, answers none for none and throws for two, so it never deletes an alert it did not make.
Tests for 1 to 3: `tests/unit/harden-drill-rows.test.ts` (9, the statements and wiring through a recording stand-in) and `tests/db/harden-drill-rows.db.test.ts` (8, the SQL on mop-dev inside rolled-back transactions). Entries `chore-fu-dr-*` (9, unit) and `chore-fu-db-*` (13, db); `h1g7-ee-no-health-event` (manual) now points at `drill-rows.ts`. Red reasons: the window start or end removed makes the old or later event count (two matches throw); the check filter removed claims an event for another check; the ambiguity guard removed; the job's address clause removed (the job without a message is missed); `delete` replaced by `revoked_at` (the key row stays); the role filter removed (another user's role is disabled).
4. Watched-fails (pp) and (gg) of the step 10 rows: entries `chore-fu-pp-trace-missing` (H1-42: `check-plans.mjs --require-trace` with trace.json renamed prints `trace.json is missing (S53)`, exit 1) and `chore-fu-gg-paid-binding` (H1-43: a `[[queues.producers]]` table in `wrangler.toml` is found by the row's pattern and exits 1; the replay line is a `node -e` form of the row's grep because a registry `run` line must run under cmd.exe and sh alike and the row's `\s` does not).
5. `checklist.json` H1-26 built in its own command. It now says `"build": true` and the runner builds (P-3016). Tests `harden-checklist.test.ts` "say build: true and never run bun run build in their own command" and "include H1-26 among the rows the runner builds for". Entries `chore-fu-cl-h126-own-build`, `chore-fu-cl-h126-flag`.
6. H1-08 and H1-10 printed `no output` or `No vulnerabilities found` when the last audit-deps run was not success. They now print `last audit-deps.yml run on main: <conclusion or none>` before the exit. Tests (a stub `gh` and `bun` first on the PATH, the row's own command run through bash) `harden-checklist.test.ts` "ends on the conclusion it read when that was not success", "says none when the run list is empty", "passes on success" for both rows. Entries `chore-fu-cl-h108-silent`, `chore-fu-cl-h110-silent`, `chore-fu-cl-h108-none`, `chore-fu-cl-h110-none`, `chore-fu-cl-h108-success`, `chore-fu-cl-h110-success`.

## Resolved without a code change

- B14 g1 item 2 (`crawl.mjs` counts a missing checker as a failed SEO check): B13 is on main, `ls app/scripts/check-seo.ts app/scripts/validate-jsonld.ts app/scripts/validate-llms.ts` lists all three, so the report no longer mislabels missing tooling. The branch for a checker that is not installed is unchanged.
- B14 g2 step 5 item 4 (`health.ts` reaches `admin-route.ts` through `audit/service.ts`): P-3111 moved the type to `src/server/lib/actor-types.ts` (`audit/service.ts:5` imports it). `cd app && deno check --frozen --config supabase/functions/job-runner/deno.json supabase/functions/job-runner/index.ts; echo $?` printed `Check supabase/functions/job-runner/index.ts` and `0` on 2026-10-11.

## Operator or orchestrator items (not worked)

- B14 g1 item 4, `gsc.mjs` AI-overview or `searchAppearance` read: the shape of the answer can only be known with the Search Console account, and "AI-overview queries when present" is a reading of the plan, not a code fault.
- B14 g1 item 5, `ci.yml` `paths-ignore` for `workspace/audits/tools`: `workspace/05-plans/merge-gate.mjs:54` reads that exact shape with one regular expression, and a `paths` list with `!` patterns would make the gate answer "the paths-ignore of ci.yml is unread". The fix is a separate workflow like `audit-deps.yml` (Actions minutes, `REQUIRED_PR_CHECKS`) or a `merge-gate.mjs` change: the orchestrator's decision. Banked as P-3152.
- B14 g1 item 6 and g4 item 1, a STANDARDS 1.1 row for the repository-root `scripts/` folder: STANDARDS.md is a plan file.
- B14 g4 item 6, `E:/tmp_unused`: `ls -la /e/tmp_unused` finds no such file on this machine today (2026-10-11); nothing to do here.
- B14 g4 item 7, `.github/CODEOWNERS` owner handle: only the CEO can say whose handle it is.
- B14 g2 step 4 item 1, `audit_health.sql` casts a timestamptz to date without `at time zone 'utc'` (C13): the change is a function file plus a new migration. A migration is not pushed from this lane (H57), and the function-source db test goes red on the shared mop-dev between the function file and the push (P-050). Orchestrator, at the merge that pushes: `(r.cutoff at time zone 'utc')::date`, with a db test that runs the function under three session time zones and compares the `analytics_daily` count.
- B14 g2 step 4 item 3 and step 5 item 3, the stale lines of `workspace/05-plans/B14.md` (the NOT_FOUND_SKIP list, `audit_record_run`, `recordAuditRun`, github.mjs, and "gauges.ts is used by audit/service.ts" when only `health.ts` imports it and `gaugeStatus` takes `(line, used)`; the port 8788; the tests line): plan file.
- B14 g2 step 4 item 4, three rows of `analytics_events` on mop-dev (`/no-such-page`, `/no-such-page-rv1791654644`, `/api/hooks/ops-health/probe-b14rev1791651173`): shared data, the orchestrator decides whether to delete them.
- B14 g2 step 5 item 1, `security.mjs` `forms_turnstile` only shows that the build contains Turnstile, not each form: a per-form check needs a design (which component renders which form); the per-form gate is `tests/unit/security/turnstile-coverage.test.ts` (H1 G27). Its row text already says what it checks.

## Proofs on mop-dev, beyond the unit and db tests

With the dev profile loaded and `env -u CLOUDFLARE_API_TOKEN`, `JOB_RUNNER_SECRET` is present in `.env` now (the g7 reviewer found it absent), so both drills could run for real:
- `bun run scripts/harden/health-drill.ts` printed `health drill ok (dead_jobs_24h failed, event b4745082-..., one notify_admin job, Sentry issue seen)`, exit 0, 26 s. Afterwards that event, its `notify_admin` job and every `health:h1-drill-%` job count 0.
- `bun run scripts/harden/fail-drill.ts --base http://localhost:8888` (the built Worker under `wrangler dev`, P-3154) printed `BLOCKED until EMAIL_LIVE=1 on mop-dev (B5 step 5)` (so the test email's message row existed: that branch needs one), `part 1: retry answered 200 ...`, `part 2: 4 passed`, `part 3: 4 passed`, `fail drill ok (parts 1 to 3)`, exit 0. Afterwards: `email_messages` to bounced@resend.dev 0, `send_email` jobs for that address 0, `agent_keys` labelled `fail-drill %` 9 before and 9 after (the run's new key was deleted; the 9 are older revoked rows from before this change), enabled `media_ops` roles of `fail-drill-agent@mop.invalid` 1 before and 0 after, the retried dead job 0.
Not removed by the drill and not in scope: the 9 old revoked keys, the older `test.selftest_light` rows (4), and `email_events` or `email_suppressions` rows a real bounce would write (kept for good, invariant 9; the dry-run path writes none).

## Gates

- `cd app && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` and `-p tsconfig.scripts.json`: no output, exit 0. `eslint` on the 14 changed `.ts` files and `./app/node_modules/.bin/eslint --config app/eslint.config.js workspace/audits/tools scripts/audit` from the root: no output.
- `NODE_OPTIONS=--max-old-space-size=4096 node ../workspace/05-plans/quiet.mjs -- bun run check; echo exit=$?` from `app/` (after the merge of origin/main, 02:36 to 02:42 +0300): `quiet: ok (207 lines, showing the last 12)`, `exit=0`.
- `node ../workspace/05-plans/quiet.mjs -- bun run build; echo exit=$?` from `app/` after the merge: `quiet: ok (718 lines, showing the last 12)`, `exit=0` (02:42 +0300).
- `node workspace/05-plans/check-plans.mjs`: `check-plans: OK (22 plans, 18 events, 17 steps)`.
- `node workspace/05-plans/check-gotchas.mjs`: `check-gotchas: OK (56 path entries, 838 process entries)`.

## Bank (numbers P-3150 to P-3154, all in GOTCHAS.md)

P-3150 (an empty object in `toMatchObject` cannot go red), P-3151 (a drill script runs `main()` on import: its SQL lives in `drill-rows.ts`), P-3152 (`ci.yml`'s `paths-ignore` is parsed by `merge-gate.mjs`), P-3153 (read an entry's rule and proof lines, not the whole of P-066), P-3154 (H1-32 needs a built Worker as its base). Hit-again lines: P-008 (a heredoc turned `\b` into backspace bytes), P-066 (prettier re-aligned a Markdown table after its entry was written), P-042 (`workerd` respawns until the `bunx wrangler dev` parent is stopped).

## UNPROVEN

- The cost line of `audit-scope.yml` (no real run of the job exists).
- `chore-fu-gg-paid-binding` replays a `node -e` equivalent of the row's `grep`, not the grep itself.
- The CI `db` job: this lane proves the db test on mop-dev inside rolled-back transactions only (P-312).
- A drill run with `EMAIL_LIVE=1` (the bounce path, status `bounced`, and the `email_events` it writes) was not run; only the dry-run path was.
- `healthEventOf` throws when a real `health.failed` event for the same check falls inside the drill's window: the drill then ends red and leaves its own event, notify_admin job and email row behind (the safe direction). Not exercised.
