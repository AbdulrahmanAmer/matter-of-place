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
