# B7 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 1

None blocks. Each entry is the reviewer's text, with its file and evidence.

### 1. app/scripts/automation-smoke.ts (B8b; breaks because of app/supabase/sql/functions/write_audit.sql)

what: Confirmed by running, so it is no longer UNPROVEN: once main pushes the B7 migration, B8b's smoke stops with 42501 forbidden. Line 23 sets NO_ACTOR to the zero UUID and lines 61-62 pass it as p_actor with kind human. write_audit now refuses an actor with no enabled user_roles row, which is DB-04 working as the plan says. The smoke is the command of B8b Verification line 214 and of H1-31 (H1.md:74, 'bun run scripts/automation-smoke.ts &&'), so the H1-31 launch gate turns red. Marked follow-up only because the file is outside this group's write set and the refusal is contract behaviour. It must be fixed with a real staff actor before or in the same merge that pushes 20261005050700_admin_audit.sql. The author's own P-2000 rule says the same.

evidence: In a rolled-back transaction on mop-dev I applied both B7 migrations, then ran select public.automation_put_recipe('submission.received', '{"steps": ...}', '00000000-0000-0000-0000-000000000000', 'human', 'smoke:probe', 'probe'). It printed: with B7: 42501 forbidden

blocking: false

### 2. app/tests/unit/admin-routes-parity.test.ts (case 'holds only handlers built by defineAdminRoute ...') and app/tests/fixtures/admin-routes.ts

what: Confirmed by running: the registry case cannot fail today. src/routes/api/admin/ does not exist, so loadAdminRoutes() returns []. Removing the ADMIN_ROUTE tag from defineAdminRoute leaves every unit test green. No control fixture proves the loader reads Route.options.server.handlers and the symbol off a real TanStack route, and no registry entry covers this case (R49, C08). Not blocking: as far as I can tell by reading, any wrong path or missing tag would turn the case red as soon as the first route file lands in step 2. Add a control (a fixture route file with one untagged handler) or a registry entry 'drop the tag' when the first admin route exists.

evidence: ls src/routes/api/admin -> No such file or directory. node scripts/watchfail.mjs --file src/server/lib/admin-route.ts --find 'return Object.assign(handle, { [ADMIN_ROUTE]: tag });' --replace '...{ tagless: tag }) as unknown as AdminHandler;' --run 'bunx vitest run --project unit tests/unit/admin-routes-parity.test.ts tests/unit/admin-authz-sweep.test.ts' --expect '×' -> WATCHED-FAIL BAD: stayed green

blocking: false

### 3. app/src/server/lib/admin-errors.ts:97 (FAILED_FETCH)

what: Confirmed by running. The second review's fix (a bug TypeError is a 500 that gets reported) covers only a thrown TypeError. postgrest-js catches anything its fetch throws and returns {message: '<name>: <message>', code: ''} (node_modules/@supabase/postgrest-js/dist/index.cjs:418-455). FAILED_FETCH matches any 'TypeError:' prefix, so a programming TypeError inside db.ts's wrapped fetch answers 503 unavailable with Retry-After and is never sent to Sentry. The plan's wording ('a fetch TypeError') allows this, so it is a follow-up: apply FETCH_TYPE_ERROR to the text after 'TypeError: ' as well.

evidence: bun -e fromRpcError({message:"TypeError: Cannot read properties of undefined (reading 'count')", code:''}) -> unavailable 503; fromRpcError(new TypeError(same message)) -> server 500

blocking: false

### 4. .claude/workflows/build-slice.js

what: The step's proof 'grep -c "Style opinions are not defects" prints 0' is unfalsifiable as proof of CS-10. It is also 0 when the replacement sentence, the knip/jscpd/CS-02 reviewer check and the g.files --stat guard are all missing, and the replacement sentence is in fact absent. The brief rules this part already met, so this is for the orchestrator to fold. The author disclosed it.

evidence: grep -c 'Style opinions are not defects' .claude/workflows/build-slice.js -> 0; grep -c 'Formatting is not a defect' .claude/workflows/build-slice.js -> 0

blocking: false

### 5. app/supabase/sql/functions/write_audit.sql:51 (jsonb_typeof object guard)

what: NOT DONE, as the author says: an array or scalar p_before/p_after skips both the changed-keys filter and the pii redaction. R21 says write_audit 'never stores a value of a column listed in pii_columns'. The only current non-object caller is automation_reorder_reasons, which passes arrays of {id, sort} with no PII, so no data is exposed today. This is for a later step, or a ruling that array payloads are banned.

evidence: Read lines 51-76: the whole redaction block sits inside `if jsonb_typeof(coalesce(p_before,'{}')) = 'object' and jsonb_typeof(coalesce(p_after,'{}')) = 'object'`. Per P-2000, automation_reorder_reasons audits jsonb arrays.

blocking: false

### 6. app/tests/db/actor.db.test.ts:42 (notThroughWriteAudit)

what: The plan's case 'every function with a p_actor argument calls write_audit(' is weakened by an exception list. approve_asset, reject_asset, rerender_asset and set_asset_caption (B9) and settings_put_site (B16) still insert into audit_log directly, so the DB-04 stored-kind, role and human_only checks do not apply to them (R21). For the orchestrator to route to B9 and B16. The list keeps it visible and red when it changes, so it is a follow-up.

evidence: grep -rln 'insert into public.audit_log' supabase/sql/functions lists approve_asset.sql, reject_asset.sql, rerender_asset.sql, set_asset_caption.sql and settings_put_site.sql (plus system writers). actor.db.test.ts passes 5 of 5 with the list.

blocking: false

### 7. workspace/05-plans/B7.md, B8b.md and GOTCHAS.md P-310 (orchestrator folds)

what: Places where the plan text and the code differ. None is a defect in behaviour: (a) loadAdminRoutes() records are {file, path, method, tag}, not the plan's {path, method, action, auth}, which H1-15 and the CSRF probe will read; (b) a 503 carries Retry-After 30 (errors.ts OUTAGE_RETRY_AFTER, B3), while the admin-errors Files line says 5; (c) submissions.withdraw (plan table line 58, ME AD humanOnly) is deferred to step 11a, but the plan says only submissions.activate is left out; (d) only the B7 error codes in use were added (agent_daily_limit, last_admin, invalid_redirect, invalid_key, wrong_kind, not_verified, enqueue_failed, invalid_image, auth_unavailable, csrf_secret_missing and account_disabled are still missing; error-codes.test makes each raise add its key, so this is safe); (e) B8b.md line 138 and step 6 still say B8b creates permissions/automation.ts, which B7 g1 now ships; (f) P-310's rule still says mop-builder.md 'still prints the inline loader' as open, and this group added the dev-profile line.

evidence: Read: tests/fixtures/admin-routes.ts:49-58; grep -n OUTAGE_RETRY_AFTER app/src/server/lib/errors.ts -> 7: = "30"; sed -n 58p workspace/05-plans/B7.md; app/src/server/lib/error-codes.ts:51-58; grep -n 'permissions/automation.ts' workspace/05-plans/B8b.md -> 138

blocking: false

## g2 · steps 2

None blocks. Each entry is the reviewer's text, with its file and evidence. Two more follow-ups of this review name GOTCHAS.md and are banked there (hit-again lines under P-2006 and P-712).

### 1. app/src/server/lib/csrf.ts (safeNext lets a dot-segment path leave /admin)

what: safeNext lets a dot-segment path leave /admin. '/admin/../stories' and '/admin/%2e%2e/stories' come back unchanged, and the browser resolves them to the public page /stories. The redirect stays on our own origin, matches the plan's literal definition (starts with /admin, no //, no backslash, no scheme), and next is not carried in the mailed link, so I see no off-site redirect. It still misses the step proof's 'paths outside /admin are refused'.

evidence: Confirmed by running: bun -e 'import { safeNext } from "./src/server/lib/csrf.ts"; ...' printed '/admin/../stories => /admin/../stories => resolves /stories' and '/admin/%2e%2e/stories => ... => resolves /stories' (lines 277-283: UNSAFE has no '..' rule).

blocking: false

### 2. workspace/05-plans/logs/B7.md (the step 2 unit proof carries no --testTimeout=60000)

what: The step 2 unit proof runs without --testTimeout=60000, so it gets the unit project's 5 s default (vitest.config.ts sets no testTimeout for unit). The bank says every B7 proof carries the flag (hit-again line under the entry at GOTCHAS.md:1431). On a loaded laptop the proof can go red with no code fault. CI's bun run test passes 60 s, so CI is not affected.

evidence: Confirmed by running: my first run of the nine-file proof, with bun run check running at the same time, printed 'Test Files 4 failed | 5 passed (9), Tests 4 failed | 37 passed (41)'. The rerun alone was 41 passed. That the failures were 5 s timeouts is suspected, not captured.

blocking: false

### 3. app/src/server/team/service.ts (sign-out goes through assertSessionFresh)

what: The author already lists this as a follow-up. Sign-out goes through defineAdminRoute's assertSessionFresh, so a session older than 12 h gets 401 from sign-out, and its cookies are never expired. The session cookie is written with Max-Age=34560000 and carries a live Supabase refresh token. The plan's wrapper order requires that check, so this needs a plan decision (exempt sign-out, or expire the cookies on session_expired).

evidence: Suspected by reading: team/service.ts signOut plus admin-route.ts, where assertSessionFresh runs for every session route; the log says @supabase/ssr writes Max-Age=34560000.

blocking: false

### 4. app/src/routes/admin.tsx (ensureQueryData ignores staleTime; note for step 3)

what: The guard reads me through ensureQueryData with staleTime 60_000. Without revalidateIfStale, ensureQueryData returns any cached value however stale, so the staleTime does nothing. Within one page load, me (and its mop_csrf re-set) runs only once, and a cached null is reused. This is the plan's wording, and the full-page sign-in flow is unaffected, so it is a note for step 3 (adminFetch and the 401 handling).

evidence: Suspected by reading: admin.tsx lines 16-20; TanStack Query v5 ensureQueryData semantics.

blocking: false

### 5. app/src/server/team/service.ts (files outside the group's named list carry this step's work; the orchestrator folds them into B7.md)

what: Files outside the group's named list carry this step's work: src/server/team/service.ts and src/domain/admin-team.ts (step 14's files), src/admin/team/ConfirmForm.tsx and team-api.ts, ratelimit.ts (memoryExhausted), error-codes.ts, and tests/fixtures/supabase-auth.ts. Sign-out also rides on the matrix action 'me', and the email limit key is the salted hashKey(RATE_LIMIT_SALT, email) instead of the plan's sha256Hex(lower(email)). Every one of these is stated in the log as a deviation. The orchestrator should fold them into B7.md (Files, invariant 19, matrix).

evidence: git log origin/main..HEAD shows f27d9af and 559b685 touching these paths; the log's deviations list names each.

blocking: false

### 6. app/scripts/seed-admin-users.ts (seed keys pile up)

what: The author already lists this as a follow-up. Every run inserts a new valid agent key and never revokes earlier ones, so seed keys pile up on mop-dev until the launch switch's db:reset.

evidence: Suspected by reading: seed() at lines 84-88 inserts with no revoke. I revoked the key my own run made (UPDATE 1).

blocking: false

### 7. app/src/routes/admin/sign-in.tsx (UNPROVEN: the real browser sign-in path is never run against reality)

what: UNPROVEN, not covered by any proof. The real browser path (Turnstile in execute mode, then POST send-link, then staff_can_sign_in, then signInWithOtp, then mail) is never run against reality. The unit tests use fake Auth and fake Turnstile, and the e2e signs in through auth.admin.generateLink. Separately, until the orchestrator puts CSRF_SECRET on both Workers, every admin session write on a deployed Worker answers 503 csrf_secret_missing (as the plan intends).

evidence: tests/e2e/helpers/session.ts tokenHashFor uses generateLink; wrangler secret list on both Workers shows no CSRF_SECRET or PREVIEW_TOKEN_SECRET.

blocking: false

### 8. app/src/routes/admin.tsx (the Contract's Vary line against the built Worker)

what: The Contract's transport line asks for Vary: Cookie, Authorization on every /admin document, but the built Worker serves /admin with Cache-Control: no-store and no Vary. With no-store nothing is cached, so there is no practical effect. It is a stale Contract line or a B1b pipeline note, for the orchestrator.

evidence: Confirmed by running: curl -s -D - -o /dev/null http://localhost:8949/admin twice on the built Worker printed only 'HTTP/1.1 200 OK Cache-Control: no-store'.

blocking: false

## c2b · steps 2

None blocks. Each entry is the reviewer's text, with its file and evidence. No follow-up of this review names GOTCHAS.md, so none is banked there. The fourth is a routing note for the orchestrator and also carries the operator's relayed request about Jay.

### 1. app/tests/e2e/helpers/session.ts (PR 158 cannot merge as it stands: the helper's variable names are false in CI)

what: Not this group's file (it came from g2 at f27d9af). PR 158 cannot merge as it stands. Lines 3-4 say 'in CI the job's ephemeral stack supplies its own values under the same names', but that is false. Lines 18-19 build the client from `https://${DEV_SUPABASE_PROJECT_REF}.supabase.co` and DEV_SUPABASE_SERVICE_ROLE_KEY, while ci.yml (lines 175-179 and 268-272) exports only SUPABASE_URL=http://127.0.0.1:54321 and SUPABASE_SERVICE_ROLE_KEY from its local stack. Renaming the variables alone would not fix it either: in CI the helper has to read SUPABASE_URL, because a `.supabase.co` host is wrong for the local stack. The author reported this as NOT DONE and banked it (P-2010). It is outside c2b's one-line scope, so it is a follow-up, not a blocker for this group.

evidence: gh run view 37401095820 --job 112068339794 --log-failed | grep -c "DEV_SUPABASE_PROJECT_REF is not set" -> 4; grep -n DEV_SUPABASE app/tests/e2e/helpers/session.ts -> lines 3, 18, 19; grep -n SUPABASE_URL .github/workflows/ci.yml -> 178, 271, 294

blocking: false

### 2. workspace/05-plans/logs/B7.md (the c2b block names the wrong run for the preview job)

what: Small inaccuracy in the c2b block. It says 'CI on pull request 158, run 37401095820 at 9e5a731: build pass, check pass, db pass, preview pass'. The preview job belongs to the deploy run 37401095805, not to ci run 37401095820. Preview did pass, so the substance is true and only the run id is wrong.

evidence: gh run view 37401095820 --json jobs -> build, db, check, merge-gate, e2e (no preview); gh run view 37401095805 --json jobs -> preview success

blocking: false

### 3. app/vite.config.ts (UNPROVEN: server cold start and CPU after the chunk grouping)

what: UNPROVEN, as the author and ruling H62 state. The group sits in the top-level build.rolldownOptions.output, so it also regroups the SSR/Nitro server chunks (the author measured 91 vs 97 files). The worker boots, client navigation works, admin-signin passes and CI preview passed. Cold-start and CPU effect on the deployed worker were not measured. This is a note for the orchestrator, not a defect of the group, because the ruling places the line exactly there.

evidence: Reading line 37-45 of app/vite.config.ts (top-level build, inherited by the ssr environment); the author's P-2008 'also measured' line; I did not measure server cold start

blocking: false

### 4. .claude/POSITION.md (routing note: the operator's request about Jay was not handled)

what: Routing note, not a c2b defect. The operator's relayed request ('your note about why Jay broke didn't reach him, so figure that out too') is addressed to the orchestrator and was not handled by this review or by the author. The author's unverified lead: the note was stored as ops_memory lesson 1792 (reaches Jay only by recall, not as a message), and owner messages #1078/#1079 were pending behind auto task #1077. Recorded here so it is not dropped.

evidence: Author's unproven list, last item; POSITION.md lines 1183-1188 as cited by the author (I did not read them: they are outside the snapshot scope)

blocking: false

## g3 · steps 3

None blocks. Each entry is the reviewer's text, with its file and evidence. Two more follow-ups of this review name GOTCHAS.md and are banked there (P-2017 for the watched-fail replay that hung, P-2018 for check beside a replay, with hit-again lines under P-066 and P-027).

### 1. app/src/routes/admin.tsx (lines 1-8, beforeLoad imports) with app/scripts/bundle-check.mjs

what: STANDARDS R39 is broken and the gate cannot see it. The admin guard's static imports (team-api, and since g3 also admin-fetch, query and domain/admin-team) are inlined into the client entry chunk, which every public route loads. bundle-check only walks manifest keys, and inlined modules have no key, so it prints OK. P-2013's rule 'keep the guard's imports static' banks the form that hides the violation, after the dynamic form was correctly flagged ('a chunk a public route can reach holds src/admin/query.ts'). The violation predates g3 (g2 already imported team-api statically) and g3 makes it bigger. The plan puts the guard in admin.tsx, and bundle-check treats dynamic imports from the entry as reachable, so no compliant shape exists inside this group's files. The orchestrator needs to rule, and bundle-check needs to scan the entry chunk's contents or its module ids.

evidence: Confirmed by running: grep -l 'X-MOP-CSRF\|mop_csrf' .output/public/assets/*.js prints BBxYnFxD.js. The manifest lists it as file of node_modules/@tanstack/react-start/dist/plugin/default-entry/client.tsx with isEntry true, and src/routes/_site.tsx?tsr-split=component imports it. bundle-check still prints 'OK 21 routes'.

blocking: false

### 2. app/src/routes/admin.tsx (beforeLoad installAdminQueryDefaults/bindAdminFetch; AdminLayout useEffect installClientErrorListeners)

what: Invariant 20 / FE-09 wiring in the layout has no test (R53, C10). query.test.ts and admin-fetch.test.ts call installAdminQueryDefaults and bindAdminFetch themselves. Nothing checks that the real layout calls them or installs the error listeners. If someone removes the layout calls, admin queries go back to TanStack's default retry (4xx retried 3 times, refetch on focus) and uncaught admin errors stop being reported, with every test still green.

evidence: Confirmed by running: with those two calls removed by sed, 'bunx vitest run src/admin tests/unit/admin-*.test.ts tests/unit/report-error.test.ts' gives Test Files 12 passed, Tests 94 passed. Restored with git checkout.

blocking: false

### 3. app/src/admin/ui/test-router.tsx

what: A shared test helper that imports @testing-library/react sits in src/admin/ui. The folder map row for src/admin allows only components, modules and tests beside the code (*.test.ts/tsx). Shared test builders belong in tests/fixtures/ (STANDARDS section 1.3, C03).

evidence: Confirmed by reading: grep -rln test-router src tests lists only AdminRouteError.test.tsx, shell.test.tsx and use-url-filters.test.tsx as importers.

blocking: false

### 4. app/src/styles/admin/*.css, app/src/admin/ui/*.tsx

what: Selectors use admin-*, but STANDARDS R42 says admin selectors use the a- prefix. The step's own proof greps 'admin-shell', so the plan and the standard contradict each other. The author raised it. The orchestrator must rule which one changes.

evidence: grep -c admin-shell .output/public/assets/*.css (the step proof) against STANDARDS.md R42 text

blocking: false

### 5. app/src/admin/ui/TopBar.tsx

what: The plan asks for 'actor name and kind'. The bar shows the role labels joined (ActorBadge name = roles.map(roleLabels)) because GET me returns no display name. Disclosed in the log. Needs a later change to getMe and meSchema, which are outside this group's files.

evidence: Read TopBar.tsx: <ActorBadge name={me.roles.map((role) => roleLabels[role]).join(", ")} .../>

blocking: false

### 6. app/src/routes/admin.tsx (no errorComponent; session_expired redirect from a client navigation)

what: Suspected by reading, not run. (a) The /admin layout has no errorComponent. If GET me answers 503 auth_unavailable, the guard throws before the shell mounts, so the 'Service unavailable, retrying' banner (API-03) never shows and the root error screen appears instead. (b) On a client-side navigation that hits 401 session_expired, adminFetch's host.navigate builds next= from window.location, which is still the previous page, and races the router redirect that uses the target href.

evidence: Read admin.tsx: createFileRoute('/admin')({ ssr:false, beforeLoad, head, component }), no errorComponent. bindAdminFetch currentPath: () => window.location.pathname + search.

blocking: false

### 7. workspace/05-plans/logs/B7.md (g3 block, Cleanup)

what: The author stopped processes by image name with 'taskkill //IM python3.exe', which ended two python3 processes not proven to be its own. The standing rule allows stopping only processes you started, by their own PID. Disclosed. P-094's rule should say kill by PID only.

evidence: Log line: 'taskkill //IM python3.exe ended two python3 processes after a hung probe (P-094); whether both were this call's own could not be confirmed.'

blocking: false

### 8. app/src/admin/ui/admin-fetch.ts / B6 invoices.css (print rule)

what: Nothing in the admin sheet hides [data-print="hide"] in print. The rule is B6's invoices.css, and B7.md line 132's dossier print rules go into src/styles.css, which /admin never links. Printing an admin screen is therefore UNPROVEN until B6 lands. This is a cross-plan note for the orchestrator.

evidence: grep -n 'print' src/styles/admin/*.css finds no @media print. B7.md:132 says the print rules are imported by src/styles.css.

blocking: false

### 9. C:/Users/DELL/.claude/projects/D--Omincom-OmniSkipX-remix-of-data-club-pro/memory/jay-full-review-2026-09.md (the operator's request about Jay)

what: The operator's relayed request ('your note about why Jay broke didn't reach him, so figure that out too') is NOT DONE and BLOCKED for this reviewer. The author's 'unproven' line on it states a stale fact. It says the memory records Jay as OFF since 2026-09-29. The same file later records '2026-09-29 17:00 - Jay v3 BUILD COMPLETE. The real bot runs via the Cloudflare hub (jay-hub.abdoamer683.workers.dev) + jay-link bridge'. Separately, D--Omincom-OmniSkipX/memory/no-subagents-for-jay-work.md records the owner's rule that Jay work is done in the main session, never by subagents or workflow scripts. So the request must go to the main session (an OmniSkipX session), not to a lane worker. Workflow workers are also told to ignore relayed operator messages (P-504), which is a plausible reason relayed notes never land. I did not touch Jay's machinery.

evidence: grep -n 'BUILD COMPLETE' jay-full-review-2026-09.md; cat D--Omincom-OmniSkipX/memory/no-subagents-for-jay-work.md ('no subagents, no Workflow fan-out')

blocking: false

## g4 · steps 4

None blocks. Each entry is the reviewer's text, with its file and evidence. One more follow-up of this review names GOTCHAS.md and is banked there (P-2126 for the cloud-generated types layout, hit-again lines under P-508 and G-031).

### 1. app/src/admin/ui/README.md (step 1) and app/src/admin/query.ts:79 adminRouteOptions() (g3's files)

what: These two files still tell every admin route to spread ...adminRouteOptions(). The author measured that doing so fails the live bundle-check (AdminRouteError and AdminPending show up as dynamic imports of the client entry). requests.index.tsx works around it by naming errorComponent and dropping pendingComponent. The next admin route built from the README will fail G16 the same way. This is for the orchestrator to fold. I confirmed the shipped route passes bundle-check. I did not rebuild with the spread myself; that failure is the author's measurement.

evidence: grep -rn adminRouteOptions src -> src/admin/ui/README.md:7 'Spread ...adminRouteOptions() ... into createFileRoute'; GOTCHAS P-2013 hit-again line (B7 g4)

blocking: false

### 2. app/scripts/bundle-check.mjs budget / _site.property.$slug

what: 485 gzip bytes of headroom are left on the tightest public route: 153115 of 153600, up from 152569 at g3. I did not measure how much of the 546-byte growth comes from this group's route-tree entries and how much from the origin/main merge 71329d0. If each admin route costs a few hundred bytes on every public first load, one of the next admin screens will fail G16. P-2013 already says this needs an orchestrator ruling rather than a quiet trim.

evidence: bun run build && node scripts/bundle-check.mjs -> 'ok   _site.property.$slug 153115 gzip bytes', 'bundle-check: OK 21 routes under 153600 gzip bytes' (confirmed by running)

blocking: false

### 3. workspace/05-plans/B7.md (Files list and step 4)

what: The plan text is stale against the code, which is the orchestrator's to fold. (1) The code has allowedActions(state, ctx), but the plan says allowedActions(state). (2) listSubmissions now calls a new SQL function, list_submissions, which no plan names, because R44 refused the .or() filter strings. check-plans.mjs does not catch this.

evidence: grep -rn list_submissions workspace/05-plans/*.md workspace/05-plans/trace.json -> nothing; node workspace/05-plans/check-plans.mjs -> OK

blocking: false

### 4. app/supabase/sql/functions/list_submissions.sql

what: Invariant 17c says every list view filters and sorts on an index created by the same migration. Not every path does. The search filter (ilike over address, submitter_name and brokerage) uses no index, and neither do the market and package filters. The unfiltered default page sorts by received_at through B2's submissions_received_idx, not through this migration's submissions_list_idx, whose leading column is workflow_state. At the volume of request intake this costs nothing measurable. It is a plan question, which the author also listed as UNPROVEN.

evidence: grep -n 'create index.*on public.submissions' supabase/migrations/*.sql -> submissions_received_idx (received_at desc) in 20261001090400_intake.sql; submissions_list_idx (workflow_state, received_at desc, id) in 20261006054716 (read, not timed with EXPLAIN)

blocking: false

### 5. app/supabase/sql/functions/start_review.sql

what: C11 is not fully met. The comment names the race partner (two overlapping selections lock rows in id order), but no test runs two start_review calls at the same time to prove they wait on each other and the second one raises wrong_state.

evidence: tests/db/admin.db.test.ts start_review cases are all single-session (read)

blocking: false

### 6. app/supabase/migrations (B7 step 1 write_audit), seen through b7-g4-db-sr-audit

what: A side observation, outside this group's files. The sr-audit mutation calls write_audit(null, null, 'submissions.start_review', ...). write_audit accepted it, and the request moved to Under Review with no role check at all. So write_audit's null-actor path skips the role gate that R21 describes. That may be the intended path for system writes, and only service_role can call these functions, so I found no outside input that reaches it. It is still worth confirming that the null-actor path is meant to bypass action_roles.

evidence: MOP_MUTATION_SQL=<migration + sr-audit sql> node node_modules/vitest/vitest.mjs run --project db tests/db/admin.db.test.ts -t 'refuses a visual editor through write_audit with 42501 and moves nothing' -> Received { outcome: 'ok', state: 'Under Review' } (confirmed by running)

blocking: false

### 7. tests/e2e/admin-signin.spec.ts:29 (g2's), PR 158

what: The admin e2e magic-link case fails on CI with no mop_csrf cookie. It was already failing at the g3 head 68551ff (run 37414096360), so g4 did not cause it. PR 158 cannot go green until someone fixes it, and its cause is still UNPROVEN.

evidence: gh api .../actions/jobs/<e2e of 37414096360>/logs -> 'x 1 [admin] tests/e2e/admin-signin.spec.ts:16:1 a magic link ...' and retry, at admin-signin.spec.ts:29:74 (confirmed by running)

blocking: false

### 8. .claude/POSITION.md (orchestrator routing; operator's relayed request about Jay)

what: I think this is why the operator's note about why Jay broke never reached him. His request has now been relayed into three B7 runs: c2b, g3 and g4. Each run wrote it into a lane log as 'for the orchestrator': B7-followups.md items c2b#4 and g3#9, and B7.md line 560 in g4. The notes stop there. Lane logs are not a channel to the operator, and the lead it records (ops_memory lesson 1792, found only by recall and never sent as a message) is the same failure mode. A main session with access to OmniSkipX has to send the explanation to him directly. This reviewer could not: the problem is outside this repository, and the brief forbids touching E:/Matter Of Place.

evidence: grep -rn -i jay workspace/05-plans/logs/ -> B7-followups.md:159, :235-239; B7.md:560 'Not handled: the operator's remark ... addressed to the orchestrator'

blocking: false
