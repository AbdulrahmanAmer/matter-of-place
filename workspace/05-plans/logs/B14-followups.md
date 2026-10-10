# B14 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 2,3

Source: the fresh review of group g1 found no blocking defect. Each item below is the reviewer's text, word for word, with its evidence. None is blocking.

1. File: `workspace/audits/tools/uptime.mjs`
   - What: No test guards the keyword_type check (line 98, `found.keyword_type === ALERT_WHEN_MISSING`). The non-keyword case in uptime.test.ts:103-107 changes type and keyword_value too. So if the check is removed, an ops-health monitor set to 'alert when ok exists' (keyword_type 1, the inverted alert DO-03 forbids) passes and the test stays green. Add a case that changes only keyword_type to 1, plus its registry entry.
   - Evidence: Suspected by reading, not watched by me (no Edit tool): uptime.test.ts line 104 sets `{ ...monitor, type: 1, keyword_value: null }`, so the type check alone already makes that row red.

2. File: `workspace/audits/tools/crawl.mjs`
   - What: A checker that is not installed counts as a failed SEO check, not as not_measured. Until B13's scripts/check-seo.ts, validate-jsonld.ts and validate-llms.ts land, every run reports Technical SEO failures that are really missing tooling. The author records this as UNPROVEN under P-1101. It follows the plan's 'non-zero exit is a finding source', but the report will mislead until B13 is on main.
   - Evidence: Confirmed by running: the stub run's sidecar has seo = {"checks":1,"failed":["error: Module not found \"scripts/check-seo.ts\""]}. ls app/scripts shows no check-seo.ts, validate-jsonld.ts or validate-llms.ts.

3. File: `workspace/audits/tools/cache.mjs`
   - What: Run alone with no --url and no SITE_URL, the probe sends 30 relative requests and then crashes with an uncaught TypeError at line 204 (`new URL(base)`). Inside run-all, collect() guards the empty siteUrl, so the routine is not affected. The README line 'exits 0 whatever it finds' does not cover this usage error.
   - Evidence: Confirmed by running: `env -i PATH=$PATH node workspace/audits/tools/cache.mjs` prints 'TypeError: Invalid URL at probe (cache.mjs:204:33)' and exits 1.

4. File: `workspace/audits/tools/gsc.mjs`
   - What: The plan's Files entry for gsc.mjs asks for 'top queries, impressions, AI-overview queries when present'. No AI-overview or searchAppearance read exists, and the omission is not in the author's unproven list.
   - Evidence: Suspected by reading: gsc.mjs sends only `dimensions: ["query"]`, and no line mentions overview or searchAppearance.

5. File: `.github/workflows/ci.yml`
   - What: ci.yml has `paths-ignore: ["workspace/**", "launch/**", "**/*.md"]`, and the plan puts the collectors and their fixtures under workspace/audits/tools. A later pull request that changes only a collector or a fixture starts no ci run, so the tests and lint wired for these files never run on it. ci.yml is not this group's file, so this goes to the orchestrator.
   - Evidence: Suspected by reading: .github/workflows/ci.yml lines 13 and 16. The tests are app/tests/unit/audit/*.test.ts and the code under test is workspace/audits/tools/*.mjs.

6. File: `scripts/audit/lint-report.mjs`
   - What: The plan's Files 'Roots' line places scripts/audit/** at the repository root. STANDARDS 1.1 has no root scripts/ row, and 1.3 lists audit/ under app/scripts/. The author recorded the conflict for the orchestrator. It is a stale STANDARDS row to fold, not something this group should move: audit-scope.yml and the PR flow already name the root path.
   - Evidence: Confirmed by reading: STANDARDS.md line 85 (app/scripts row with `audit/` (B14)) against line 30 (root files). ASSUMED.md and STANDARDS.md hold no ruling that names scripts/audit.

7. File: `workspace/audits/tools/run-all.mjs`
   - What: readSchedule (line 143) expects a bare top-level boolean `enabled` from B8b's GET schedule-settings/audit. If B8b wraps the body, a disabled schedule still runs, recorded only as not_measured.schedule. The author flagged this as UNPROVEN. It needs a contract test once B8b's route exists.
   - Evidence: Suspected by reading: app/src has no schedule-settings route at cbfaffb (grep finds no files).

Follow-up 8 of the review (GOTCHAS.md: P-329 hit again) is not listed here: it went into the bank as a "hit again: 2026-10-04, B14 g1 review" line in P-329.

## g4 · steps 6

Source: the fresh review of group g4 found no blocking defect. Each item below is the reviewer's text, word for word, with its evidence. None is blocking.

1. File: `scripts/audit/scope-check.mjs`
   - What: The new file is in a repository-root folder `scripts/` that has no row in STANDARDS section 1.1 (R56, C03). The plan's Files list, ROUTINE-PROMPT.md and trace.json name this path, and g1's lint-report.mjs created the folder first. The builder followed the plan and recorded P-1103, but STANDARDS 1.1 needs a `scripts/` row (or the plan should move both tools to workspace/audits/tools/). The orchestrator should fold this in.
   - Evidence: git ls-tree --name-only origin/main lists no `scripts` at the root; STANDARDS.md lines 22-31 list app/, workspace/, launch/, brand/, .github/, .claude/, root files and creds/ only; trace.json:7266 names 'scripts/audit/lint-report.mjs, scripts/audit/scope-check.mjs (repo root)'. I found no runtime failure.

2. File: `scripts/audit/scope-check.mjs`
   - What: Coverage limit of the allow-list, for one follow-up (this was not a contract breach: the contract says routes/** except routes/api/**). TanStack names that serve /api/* without the `api/` folder or the `api.` prefix are allowed. Examples are `app/src/routes/api_.contact.ts` (the trailing underscore un-nests the route) and a route group such as `app/src/routes/(x)/api.contact.ts`. Any route file outside api/ can also carry `server.handlers`, which `src/routes/sitemap[.]xml.ts` already does. An audit PR could therefore add server-side behaviour that audit-scope reports green. The human merge stays the enforcement.
   - Evidence: Read, not run: isAllowed refuses only path === 'app/src/routes/api', startsWith('app/src/routes/api/') and startsWith('app/src/routes/api.'). Running `grep -rln 'server:\s*{' src/routes | grep -v routes/api` returns src/routes/sitemap[.]xml.ts.

3. File: `.github/workflows/audit-scope.yml`
   - What: C22 is not met: the new workflow does not state its unit cost in Actions minutes or the P-009 line it draws on, in the workflow comment or in the g4 log.
   - Evidence: Running `sed -n '/^## g4/,$p' workspace/05-plans/logs/B14.md | grep -i -E 'minute|P-009|cost'` gives no match. In the workflow the only hit is `timeout-minutes: 5`.

4. File: `app/tests/mutations/B14.json`
   - What: Plan watched-fail (al) is not recorded by the author, either as a registry entry or in the log. (al) removes persist-credentials: false from audit-scope.yml, and B1b's hygiene.test.ts must then go red naming the file. I ran it as a one-off and it does go red, so the behaviour holds. Only the record is missing.
   - Evidence: `grep -n audit-scope app/tests/mutations/*.json` gives no match. The one-off watchfail on ../.github/workflows/audit-scope.yml printed WATCHED-FAIL OK.

5. File: `.github/workflows/README.md`
   - What: Stale prose outside this group's files. The README says 'These three exist' and lists `audit-scope.yml` as a later file described as 'the weekly audit robot'. There are now four workflows, and audit-scope.yml is the scope guard on audit/ pull requests, not the robot. The author recorded the missing row; the wrong description is an extra point.
   - Evidence: .github/workflows/README.md:11 'These three exist. Later slices add ... `audit-scope.yml` (B14, the weekly audit robot)'; `ls .github/workflows` shows audit-scope.yml backup.yml ci.yml deploy.yml.

6. File: `E:/tmp_unused`
   - What: A scratch file left outside the worktree by the builder (P-1104). It still exists and was not committed. The operator needs to delete it.
   - Evidence: `ls -la /e/tmp_unused` gives `-rw-r--r-- 1 DELL 197121 0 Oct  4 00:57 /e/tmp_unused`

7. File: `.github/CODEOWNERS`
   - What: Still UNPROVEN, as the author says: no plan records whether @AbdulrahmanAmer is the CEO's handle. If the routine pushes as the same account, GitHub cannot request a review from the PR author. CODEOWNERS is documentation until branch protection exists (P-028).
   - Evidence: codeowners/errors returns {"errors":[]}. The handle only shows that the syntax is valid, not that it is the right owner.

## g2 · steps 4

Source: the fresh review of group g2 found no blocking defect. Each item below is the reviewer's text, word for word, with its evidence. None is blocking.

1. File: `app/supabase/sql/functions/audit_health.sql`
   - What: STANDARDS C13: line 103 casts a timestamptz to date without 'at time zone' (`x.day < r.cutoff::date`, where cutoff is `now() - (keep_for + interval '30 days')`). The result depends on the session TimeZone. On Supabase that is UTC, so today it changes nothing, and at worst the analytics_daily overdue count would be off by one day inside a 30-day grace. Fix: `(r.cutoff at time zone 'utc')::date` in the function file and the migration.
   - Evidence: Found by reading: audit_health.sql lines 102-108 (the cutoff is defined on line 108).

2. File: `workspace/audits/tools/usage.mjs`
   - What: R04/C04: names are exported that nothing imports. usage.mjs exports gaugeStatus, gaugeRows and describeRows; collectors/cloudflare.mjs exports sumRequests; collectors/sentry.mjs exports parseSentryStats; collectors/ours.mjs exports agentGet. knip does not scan workspace/, so no gate catches them. Only minutesThisMonth is a plan-sanctioned test export.
   - Evidence: A grep loop over every exported name of the g2 workspace files found 0 importers outside the defining file for those six names (workspace/audits/tools, app/tests, scripts).

3. File: `workspace/05-plans/B14.md`
   - What: Stale plan lines the orchestrator must fold (not this group's file). The Files list of NOT_FOUND_SKIP lacks the `/api/` prefix and the routePath comparison the code now uses (P-2703). The audit_record_run line still says 'raises schedule_row_missing' (the code raises not_found P0002). recordAuditRun is still written with a requestId argument. The github.mjs line still describes per-run /timing calls and `minutesThisMonth(runs, timings)`.
   - Evidence: plan-brief B14 --steps 4, Files list, compared with not-found-log.ts NOT_FOUND_SKIP, audit_record_run.sql, service.ts recordAuditRun(actor, db) and collectors/github.mjs.

4. File: mop-dev analytics_events (shared rows)
   - What: Shared-data note for the orchestrator. My built-Worker reproduction left two page-path rows: '/no-such-page' and '/no-such-page-rv1791654644'. Neither holds a secret, so they do not trip lint-report. The author's earlier row '/api/hooks/ops-health/probe-b14rev1791651173' is still there and would fail lint-report.mjs if a weekly report runs before 2026-10-17. The orchestrator decides whether to delete it.
   - Evidence: Node pg count with the dev profile: '/no-such-page' 1 and the stamped page 1 within 10 minutes of my probe.

The three follow-ups of the review whose file is GOTCHAS.md are not listed here: they went into the bank (P-2700 rule and proof corrected to point at P-2702; a "hit again: 2026-10-10, B14 g2" line in P-015 and in P-310; the new entry P-2704 for the reviewer's cost).
