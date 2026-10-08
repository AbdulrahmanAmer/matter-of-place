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

## g1 · steps 5

None blocks. Each entry is the reviewer's text, with its file and evidence. Three more follow-ups of this review name GOTCHAS.md and are banked there (hit-again lines under P-801, P-310 and P-1602, and the new P-2132 for the cap of 40 path entries, G-902 included; the reviewer's counts of 43 and 42 included the template heading, the real counts are 42 and 41).

### 1. app/src/routes/admin/requests.$id.tsx (public bundle budget, scripts/bundle-check.mjs)

what: Follow-up. After this group the largest public route is 137 gzip bytes under the 153600 budget. Every admin route file adds bytes to the route tree that the public entry loads, so the next admin route (step 6 onward) will most likely fail bundle-check in CI. This group's own budget holds.

evidence: Confirmed by running: live build then node scripts/bundle-check.mjs printed 'ok _site.property.$slug 153463 gzip bytes' and 'bundle-check: OK 22 routes under 153600 gzip bytes'.

blocking: false

### 2. app/src/admin/requests/RequestDetail.tsx:134 (also :127, and the toasts at :56 and :117)

what: Follow-up, STANDARDS C17. The history panel's error shows only history.error.message, the note form shows only note.error.message, and the toasts for start review and open original show only the message. None of them shows the request id, although AdminApiError carries it and DataTable shows it. The screen-level read does show it through AdminRouteError, and screen 3's toasts set the same precedent.

evidence: Found by reading: grep -n 'history.error.message\|error={note.error' app/src/admin/requests/RequestDetail.tsx. Compare src/admin/ui/DataTable.tsx:99, which renders ' Request ${error.requestId}.'

blocking: false

### 3. app/src/server/submissions/service.ts:358-365

what: Follow-up, suspected from reading. originalUrl turns every createSignedUrl error into 503 storage_unavailable with 'try again in a moment'. That includes a submission_media row whose object was never uploaded (uploaded_at null). Such a missing object would answer as an outage, not as not_found. The UI hides the button for uploaded_at null, so only a direct API call reaches this today.

evidence: Found by reading: sed -n '340,366p' app/src/server/submissions/service.ts. No unit case covers a Storage error on the original.

blocking: false

### 4. app/src/admin/requests/RequestDetail.tsx:53

what: Follow-up, suspected from reading, not run in a browser. window.open is called in the mutation's onSuccess, after an awaited fetch, so it is outside the click's user activation. Safari, and other browsers after the activation window, may block the new tab. With 'noopener' the return value is always null, so a blocked tab is invisible to the editor.

evidence: Found by reading the openOriginal handler. The component test stubs window.open, so this is UNPROVEN in a real browser, as the author already says for screen 4 in a browser.

blocking: false

### 5. app/src/admin/requests/RequestDetail.test.tsx

what: Follow-up. Nothing tests that a 404 from getSubmission throws notFound() and renders the route's notFoundComponent, and nothing tests the history panel's loading, empty or error states. getSubmission against a real row is UNPROVEN: the only database contact is newestPaymentId. That covers the route's output schema parse of a real submissions row with jsonb[] notes, and real Storage signing.

evidence: grep -n "it(\|404\|notFound" app/src/admin/requests/RequestDetail.test.tsx shows no 404 or timeline-state case. The db file's only step 5 case calls newestPaymentId.

blocking: false

### 6. app/src/server/lib/headers.ts:22 (not this group's file)

what: Follow-up, already listed by the author. The CSP img-src is 'self' data:, without the Supabase origin. The policy is report-only today, so thumbnails load. Once it is enforced, every signed thumbnail on screen 4 will be blocked.

evidence: Found by reading: grep -n 'img-src\|Report-Only' app/src/server/lib/headers.ts shows img-src at line 22 and Content-Security-Policy-Report-Only at line 72.

blocking: false

## g2 · steps 5a

None blocks. Each entry is the reviewer's text, with its file and evidence. Two more follow-ups of this review name GOTCHAS.md and are banked there (hit-again lines on P-712 and P-708).

### 1. app/src/routes/admin/people.$id.lazy.tsx

what: Suspected by reading, not run. A non-uuid id in the address (for example /admin/people/abc) fails personIdInputSchema on the API with a 400 validation error, not a 404. PersonPage throws notFound() only on a 404, so the editor sees the route error page and not 'Person not found'. This is cosmetic for a hand-typed address.

evidence: people.$id.lazy.tsx: `if (person.error instanceof AdminApiError && person.error.status === 404) throw notFound(); throw person.error;` with personIdInputSchema = z.object({ id: z.string().uuid() }) in src/domain/admin-people.ts

blocking: false

### 2. app/supabase/sql/functions/person_detail.sql

what: The emails list matches `lower(e.to_email) = lower(v_contact.email)`, and B5's index is on to_email itself, so no index serves this read (STANDARDS C11: every new list names the index that serves it). The author already logged it as UNPROVEN and as a follow-up for a lower(to_email) index. I record it here so it is not dropped.

evidence: person_detail.sql emails subquery; B7.md log g2 'Choices to check': 'this read does not use it (UNPROVEN cost, a follow-up for a lower(to_email) index)'

blocking: false

## g3 · steps 6

None blocks. Each entry is the reviewer's text, with its file and evidence. The eighth follow-up of the review (a scratch registry in a reused folder) is a GOTCHAS.md cost and is banked as P-2133.

### 1. app/src/routes/admin.tsx (plus admin/auth.confirm.tsx, admin/sign-in.tsx, admin/requests.index.tsx, admin/requests.$id.tsx, tests/unit/admin-route-shells.test.ts)

what: The first half of step 6 (ruling H66, the shell conversion with LEGACY emptied) is NOT DONE. The author built it, saw bundle-check FAILED 9, and reverted it, so these files are as on main and nothing regressed. By reading app/scripts/bundle-check.mjs I confirmed the author's cause. Lines 59 and 94 walk every public route chunk with reach(manifest, key, true). Each route chunk imports the client entry, so the walk follows every dynamicImports target of the entry, and any await import() of src/admin/** lands in a forbidden chunk. H66 and gate G16 contradict each other, and the orchestrator has to choose between them. I did not rebuild the conversion myself, because I have no edit tool.

evidence: scripts/bundle-check.mjs:54-60 and :94; log block 'NOT DONE, BLOCKED' in workspace/05-plans/logs/B7.md; GOTCHAS P-2021

blocking: false

### 2. app/supabase/migrations/20261007223745_admin_submissions_decisions.sql

what: The step's CI db proof is UNPROVEN. PR 213 is a draft, so its db job is skipped (P-2001). There is also a likely type-drift failure. submission_event_payload(public.submissions) is a new function whose argument is a row type, and src/db/types.ts has no entry for it. No function in types.ts has this shape, so I cannot predict what the generator emits. When the PR is marked ready, the db job's type-drift step may go red. In that case bun run types:from-ci -- 213 takes the generated types.

evidence: grep 'submission_event_payload' src/db/types.ts finds nothing; no other function in types.ts takes a table row as its argument

blocking: false

### 3. app/src/server/lib/permissions/submissions.ts / app/supabase/sql/functions/request_assets.sql

what: This is a gap in the plan, not in this group's code. An agent with an editor role and the submissions scope can loop request_assets and assets_received (Accepted, then Awaiting Assets, then Accepted again) without limit. Every request_assets sends the awaiting_assets letter to the submitter, which spends the 100-a-day Resend quota. request_assets is neither humanOnly nor counted by assert_agent_daily_cap. STANDARDS R12 says an agent-reachable action that changes outbound content must be one or the other. The plan's Contract caps only decline and accept, so the orchestrator should rule on this.

evidence: assert_agent_daily_cap's v_actions covers only submissions.decline/accept and properties/stories.publish; request_assets.sql never calls it; the permissions entry for submissions.request_assets has no humanOnly

blocking: false

### 4. app/supabase/sql/functions/assert_agent_daily_cap.sql

what: The daily cap fails open. If settings.agent_daily_limits is missing, or lacks the <group>_per_day key, v_limit is null, 'v_count >= null' is null, and no limit is enforced. Separately, the tests only count accepts, so removing 'submissions.decline' from the decisions array would stay green. I found both by reading; neither was run.

evidence: lines: select (s.value ->> (p_group || '_per_day'))::integer into v_limit ...; if v_count >= v_limit then raise; the cap db cases call accept_submission only

blocking: false

### 5. app/src/server/submissions/service.ts

what: emailPreview has no not-found path (found by reading). For an unknown submission id or an unknown decline_reason_id, the resolver throws NonRetryableError('submission_missing' or 'decline_reason_missing'). defineAdminRoute maps that to 500 and sends it to Sentry instead of answering 404 or 422. The UI only offers listed reasons, so the main trigger is an API caller or a stale id.

evidence: variables.ts:94-96 found() throws NonRetryableError; admin-route.ts:213-219 logs unhandled_error and captures for code 'server'

blocking: false

### 6. app/scripts/admin-smoke.ts

what: The script checks ADMIN_SMOKE_KEY only after it has committed a test submission to mop-dev, inside post(). The cleanup deletes the row (I confirmed 0 rows remain), but a run without the key still writes and deletes on the shared database. Checking requiredEnv('ADMIN_SMOKE_KEY') before the write would avoid that. The leg that prints 'declined skipped dry_' is UNPROVEN: it needs the key, bun run dev and the migration pushed by main.

evidence: re-run printed 'admin-smoke: ADMIN_SMOKE_KEY is not set', exit 1, after createSubmission had run inside committed()

blocking: false

### 7. app/src/admin/requests/EmailPreview.tsx

what: The decision dialogs and the sandbox='' srcDoc letter preview have only been tested in jsdom (UNPROVEN, as the author says). A srcdoc frame inherits the admin page's CSP, so once csp_enforce is on, the letter's inline styles may not render. Axe has not been run on screen 4 with a dialog open (R47).

evidence: author's unproven list; component tests only

blocking: false

## c6m · steps 6

None blocks. Each entry is the reviewer's text, with its file and evidence. The two follow-ups whose file is GOTCHAS.md are banked in the gotcha bank (P-831 hit again, P-2134), not listed here.

### 1. workspace/05-plans/B7.md

what: Step 6's proof line says 'bun run build && node scripts/bundle-check.mjs .output' without the live-mode VITE variables. Run exactly as written, it makes a demo build that fails bundle-check, which is the cost the author paid. This is a stale plan line, so it is the orchestrator's to fold.

evidence: The plan-brief output for step 6 quotes the build proof without VITE_API_BASE_URL or VITE_TURNSTILE_SITE_KEY. The c6m log, Proof 3, records that the first build without them failed bundle-check.

blocking: false

### 2. app/tests/unit/admin-route-shells.test.ts

what: The H66 half of step 6 is still NOT DONE. LEGACY lines 15-21 still list 5 route files. The step's proof is 'green with the list empty', and c6m reports the shells test as a passing step 6 proof without restating that condition or the NOT DONE. Ruling H66b (08:55) unblocked the conversion and gives it to 'B7's next group'. c6m's brief limited it to the two integration edits, so this is not this group's regression, but the orchestrator must schedule it or it stays hidden behind a green test.

evidence: sed -n 14,21p app/tests/unit/admin-route-shells.test.ts in the snapshot shows the 5 LEGACY entries. ASSUMED.md H66b: 'The builder's revert of the shells is undone in B7's next group'.

blocking: false

### 3. workspace/05-plans/logs/B7.md

what: The c6m Proof 4 numbers ('replayed 119: ok 93, bad 26') come from the tree before the commit, not from the commit handed in. Run from 1c59021 against the same base, the replay gives 'replayed 123: ok 93, bad 30'. The 4 extra entries are the registry entries whose test is the edited tests/db/actor.db.test.ts, and the author's run did not select them. I replayed them with the dev profile and all four print WATCHED-FAIL OK, so nothing is hidden, but the log line is draft output.

evidence: env -u DEV_DB_URL node scripts/watchfail.mjs --registry tests/mutations --changed 9c462f5 gives replayed 123, bad 30. grep -c '"test": "tests/db/actor.db.test.ts"' tests/mutations/*.json totals 4.

blocking: false

## g1 · steps 6

None blocks. Each entry is the reviewer's text, with its file and evidence. The fourth follow-up of the review (a hit-again of P-1218) is a GOTCHAS.md cost and is banked as a hit-again line under P-1218.

### 1. workspace/05-plans/B7.md

what: Stale plan lines (the orchestrator's to fold). Step 6 says 'the component stays in the file, the router splits it already'. That is impossible under the H66 allowlist, because the pages need react hooks and project modules. The group moved each page to src/admin/<feature>/<Name>Page.tsx and loads it with lazyRouteComponent, which fits H66a's intent (no .lazy.tsx sibling, and the bundle got about 936 bytes smaller). Contract item 20 (line 44) still says 'The admin layout src/routes/admin.tsx calls installClientErrorListeners()'. That call is now in src/admin/ui/AdminLayout.tsx. The step's proof 'within 300 bytes of main's' should read 'not larger than main's'.

evidence: grep -n 'installClientErrorListeners' app/src/routes/admin.tsx finds nothing; app/src/admin/ui/AdminLayout.tsx:274 has useEffect(() => installClientErrorListeners(), []). The plan-brief step 6 text says 'the component stays in the file'.

blocking: false

### 2. app/tests/unit/admin-route-shells.test.ts

what: Existing weakness, not introduced here (suspected from reading, not run). STATIC_IMPORT = /^import\s[^;]*?from\s+"([^"]+)";?$/gm only matches imports that have a 'from' clause. A bare side-effect import such as `import "../admin/ui/AdminShell";` and a re-export such as `export { x } from "../admin/query";` would both put admin code back into the route tree that the public entry loads, and the shell test would stay green. bundle-check would still refuse admin modules in a public chunk, but not the size cost of the extra code.

evidence: Read app/tests/unit/admin-route-shells.test.ts line 14: the regex requires 'from'. Not mutated because this review is read-only.

blocking: false

### 3. app/src/routes/admin/requests.index.tsx

what: The comment's reason no longer matches the file. Line 4 says the route is not spread from adminRouteOptions() because 'its lazyRouteComponent imports would sit in the route tree', but this same file now puts lazyRouteComponent imports in the route tree. The real reason is that spreading would need a static import of src/admin/query, which the shell allowlist forbids. The README wording ('its imports would join the route tree') is accurate. Taste-level, comment only.

evidence: app/src/routes/admin/requests.index.tsx lines 4-6 against lines 7-10 and 19 of the same file

blocking: false

### 4. workspace/05-plans/logs/B7.md

what: Note for the log. The author's UNPROVEN item 'signed-in admin layout, the requests table and a not-found request were not opened in a browser' is now covered by this review (signed-in probe on mop-dev through the 8949 preview, results above). The orchestrator can fold that into the record. The two stray scratch files the author left outside the repo (D:/mop-build/build.log and D:/mop-build/sign-in.bak.tmp) still need deleting by someone with permission.

evidence: See the reran entry 'node scratchpad/b7rev-signed.mjs': frame 1 on /admin, 'Requests' h1, 'Request not found', AdminRouteError with request id, pageerrors []

blocking: false

## g2 · steps 7

None blocks. Each entry is the reviewer's text, with its file and evidence. The reviewer listed no follow-up whose file is GOTCHAS.md, so this group banks no gotcha entry.

### 1. app/src/server/previews/service.ts

what: Undocumented design choice. A draft that is missing any field the published-row mapper requires (region_slug, neighborhood, style, place, hero_image and others) does not parse in getDraftProperty and answers 404. A fresh draft made from a request therefore cannot be previewed until its facts and hero are complete. PreviewTab hides the frame until then and says why. The plan says preview_property serves 'any editorial_state', which says nothing about completeness. This choice is written down only in a code comment, not in ASSUMED.md or the log.

evidence: Found by reading. previews/service.ts line 29 has the comment 'An incomplete draft does not parse'. tests/unit/previews.service.test.ts:122 is titled 'a property that is gone, or a draft the public page cannot show yet, is 404'. PreviewTab.tsx returns 'The preview opens once the facts and the hero are complete.' grep in logs/B7.md and B7-followups.md finds no record of it.

blocking: false

### 2. app/supabase/migrations/20261007223746_admin_properties.sql

what: In update_property (lines 161-177), a PATCH that carries editorial_state runs a second UPDATE after save_property. B2's properties_version_bump trigger then fires again, so that one PATCH raises version by 2, not 1. This is not a correctness fault: the function returns the final version and the client adopts it. But it departs from invariant 7's 'exactly one' bump, and the editorial_state key that bypasses save_property's allow-list is an ASSUMED extension recorded only in a SQL comment.

evidence: Found by reading lines 172-177: save_property(...) is followed by 'update public.properties p set editorial_state = v_state, archived_at = null ... returning * into v_after'. No db test covers the version after a PATCH that changes state. The admin.db 'version + 1' case patches plain fields only.

blocking: false

### 3. app/src/admin/properties/PropertyEditor.tsx

what: reload() (lines 123-133) has try/finally with no catch and is called as `void reload()` from StaleBanner. If the re-read fails (network, 5xx), the rejection goes unhandled and the editor sees no message: the Reload button just stops spinning. That is a C06/C17 gap: the error state is not rendered and has no request id.

evidence: Found by reading. Line 186 is `onReload={() => void reload()}`. reload() has `try { const fresh = await onReload(); ... } finally { setReloading(false); }`. properties.$id.lazy.tsx throws 'The property could not be reloaded.' and refetch uses throwOnError: true.

blocking: false

### 4. app/src/admin/properties/use-autosave.ts

what: Lines 111 and 125 use `.catch(() => undefined)`, the literal shape R10 names. Behaviour is fine: the failure was already published to state.error and blocked by sendPending, so nothing is lost. The comment explaining that is missing, so the next reader or lint selector will take it for a swallow.

evidence: Found by reading. `await inFlight.current.done.catch(() => undefined);` and `drain().catch(() => undefined);`

blocking: false

### 5. app/src/server/jobs/system/copy-submission-media.ts

what: Merge-order window. The job ends by calling request_property_render, which no migration on this branch or on main defines; it arrives with step 8's admin_media migration. The STUB(B7 step 8) marker is present, so R05 holds. But once this accepted migration group merges to main ahead of step 8, every 'Create property' on mop-dev queues a copy job that copies the photographs and then throws 'unavailable' at the last call, retrying until step 8 lands or the job goes dead. Worth stating in the step 8 brief or the runbook. Separately, Storage copy and the duplicate answer ({statusCode: '409'}) are proven only against the unit fake, so they are UNPROVEN against real Supabase Storage.

evidence: grep -rln request_property_render app/supabase app/src matched only src/server/jobs/steps/render-variants.ts and copy-submission-media.ts (both STUB comments), with no SQL definition. tests/unit/jobs/copy-submission-media.test.ts uses a fake storage.

blocking: false

### 6. .github/workflows/ci.yml

what: Note for step 10, not this group's file. The e2e job's 'dev vars' step writes CSRF_SECRET and CONFIRM_TOKEN_SECRET but not PREVIEW_TOKEN_SECRET. When step 10's admin-editorial Preview-tab leg runs in CI, POST properties/:id/preview-token will answer 503 preview_secret_missing. The existing follow-up 7 in B7-followups.md covers the deployed Workers' secrets, not CI's .dev.vars.

evidence: Lines 295-308 of ci.yml list the echoed names, and PREVIEW_TOKEN_SECRET is not among them. signPreview in src/server/lib/preview-token.ts throws preview_secret_missing when the key is undefined.

blocking: false

## g3 · steps 7a

None blocks. Each entry is the reviewer's text, with its file and evidence. The two follow-ups whose file is GOTCHAS.md are banked as P-2137 (new) and a hit-again line under P-2133, not listed here.

### 1. app/supabase/migrations/20261008092407_admin_takedown.sql (a takedown audits both preview nonces)

what: A takedown stores both preview nonces, the old one and the new one, in audit_log. rotate_preview_nonce in the same migration strips the nonce on purpose, with the comment 'staff read it, and a nonce is half of a link'. The two functions contradict each other. A leak would still need PREVIEW_TOKEN_SECRET before anyone could forge a link, so this is not exploitable alone.

evidence: unpublish_property sets preview_nonce = gen_random_uuid() when p_takedown, then calls write_audit(..., to_jsonb(v_before), to_jsonb(v_after), ...) without '- preview_nonce'. write_audit keeps every changed key (write_audit.sql line 63, 'is distinct from'), so both nonces land in before/after. Found by reading, not run.

blocking: false

### 2. app/src/server/lib/permissions/properties.ts (properties.unpublish is neither humanOnly nor capped)

what: properties.unpublish (which includes a takedown) is neither humanOnly nor counted by assert_agent_daily_cap. An agent key with an editor role can therefore take down any number of properties. A takedown is irreversible: the slug answers 410 forever and the takedown_media job deletes the media. R12 asks for humanOnly or a cap on an action that changes public visibility. The matrix is step 1's and the plan does not ask step 7a to add a cap, so this is a follow-up for the orchestrator (decide humanOnly on takedown, or count it under the cap).

evidence: Matrix line 20: { action: "properties.unpublish", group: "properties", roles: editors } with no humanOnly. action_roles rows: ('properties.unpublish', array['chief_editor','managing_editor'], false). unpublish_property calls no assert_agent_daily_cap, while publish_property does. Found by reading.

blocking: false

### 3. workspace/05-plans/B7.md (plan line 17 f is stale; the orchestrator folds it)

what: Plan line 17 f says cachedResponse in cache.ts writes the bypass label for both preview params. A ?preview= page never reaches the cache hook; pipeline.ts now sets the label in the neverCached branch. The author already named this stale line as the orchestrator's to fold; it is recorded here so it is not dropped.

evidence: src/server/lib/pipeline.ts:296 `if (framing === "self" && !headers.has("x-mop-cache")) headers.set("x-mop-cache", "bypass");`. Unit case 'labels a preview-token answer x-mop-cache bypass' and watched-fail b7-g3a-pipe-bypass OK.

blocking: false

### 4. app/src/admin/properties/UnpublishDialog.tsx (UNPROVEN: no component test, never run in a browser; the dialog keeps its state across cancel)

what: UNPROVEN: UnpublishDialog, AgentPreviewButton and the PublishBar/PropertyEditor wiring have no component test and were never run in a browser (the author says so). Separately, by reading: the dialog keeps its reason, note and takedown state across cancel and reopen, so a cancelled takedown reopens with Takedown still ticked. The confirm label then says 'Take down', so the editor can see it.

evidence: git diff origin/main...slice/b7 adds no *.test.tsx case for either component. The useState hooks in UnpublishDialog are never reset in onCancel.

blocking: false

### 5. app/tests/mutations/B7.json (nine of the ten g3a sql entries match only the test title)

what: Nine of the ten g3a sql entries match only the test title (for example '× .*after rotate_preview_nonce...'), so a red for any reason counts as OK. Today the registry sql holds only the mutated function. Before main pushes the migration, a plain replay of an entry whose test also calls another 7a function goes red on assertStep7a, not on the mutation. The author replayed with the migration prepended, and so did I, so the current proofs hold. After the push the entries are correct as written.

evidence: Without MOP_MUTATION_SQL, admin-cache.db.test.ts goes red on 'expected false to be true' (assertStep7a). That is the same red that would satisfy a title-only expect.

blocking: false

## g1 · steps 8

None blocks. Each entry is the reviewer's text, with its file and evidence. None has GOTCHAS.md as its file, so none is banked there.

### 1. app/src/server/media/service.ts (attachMedia and attach_media check only a prefix; dot segments pass)

what: SUSPECTED BY READING (Supabase Storage server side not exercised). attachMedia (line 96) and attach_media (migration line 82) check only a prefix: the path must start with staging/<property_id>/<media_id>. and nothing else is checked. A path with dot segments such as staging/<pid>/<mid>./../../../<other key>.jpg passes both checks. storage-js puts the path into the URL of /object/sign/<bucket>/<path> unencoded, and URL parsing collapses the dot segments. So sniffStaged signs and reads a different object, which can be another submission's private original or a key in another bucket, and attach_media stores that path for B9's render to publish. The concrete input is a POST to media/attach carrying that path from any actor holding media.attach (CE, ME, VE or an agent key). replaceMedia already uses a whole-name regex (replacePathOf). Attach should use the same anchored pattern, and so should the SQL guard. Staff can already open originals, so this is not an escalation, which is why it is a follow-up and not blocking.

evidence: node -e "console.log(new URL('https://x.supabase.co/storage/v1/object/sign/submissions/staging/p/m./../../../../documents/inv.pdf').pathname)" prints /storage/v1/object/sign/documents/inv.pdf. storage-js createSignedUrl builds `${url}/object/sign/${bucketId}/${path}` with no encoding. A read-only probe on mop-dev found no object to sign, so the server side is unproven.

blocking: false

### 2. app/src/server/media/service.ts (stagedState maps job status 'failed' to the state 'failed')

what: stagedState (line 231) maps job status 'failed' to the state 'failed'. In B8 'failed' is a runnable backoff state: the job is re-queued, and claim and resend select status in ('queued','failed'). The plan names only 'dead' as failed. A render that fails once (for example a Storage hiccup) shows 'Render failed' and the Retry or 'media ops can retry it' note while it is still retrying by itself. useVariantsStatus polls only while some row is 'processing', so the screen stays on 'Render failed' after the automatic retry succeeds, until something else refetches.

evidence: grep -n "status in ('queued', 'failed')" app/supabase/migrations/20261003185349_jobs.sql (lines 81, 323, 589); service.ts line 231 `if (job.status === "failed" || job.status === "dead") return "failed"`; media-queries.ts refetchInterval polls only while an item is "processing"

blocking: false

### 3. app/tests/db/admin.db.test.ts (the reorder_media case trips only the cardinality condition)

what: BY READING, not replayed. The reorder_media guard has three conditions: cardinality, distinct count, and p_order <@ v_before. The only db case trips the cardinality condition (it names one of two photographs). The rewritten mutation b7-g8-db-reorder ('if false then') proves the guard as a whole. It does not prove the other two conditions: an order such as [first, first], or one carrying another property's id, is not tested. A mutation that drops either condition would stay green. [first, first] would leave duplicate sort_order values.

evidence: tests/db/admin.db.test.ts, case 'reorder_media puts the named order in place and refuses an order that leaves a photograph out': partial = REORDER [second] only

blocking: false

### 4. app/tests/unit/media.service.test.ts (replaceMedia, reorderMedia and setMediaAlt have no unit case)

what: replaceMedia, reorderMedia and setMediaAlt have no unit case. Nothing tests replace's whole-name regex or its removal of the previous staged file when the paths differ, and no watched-fail covers them. The SQL side of replace is covered by db cases. The brief's listed unit cases do not require these, so this is a follow-up.

evidence: grep -n "replaceMedia\|reorderMedia\|setMediaAlt" app/tests/unit/media.service.test.ts finds nothing (the imports are attachMedia, createUploadUrl, deleteMedia, listMedia and variantsStatus only)

blocking: false

### 5. app/src/admin/media/VariantStatus.tsx (the failed note shows to every role and links to a screen that does not exist)

what: Until B8 step 9 adds jobs.retry to the matrix, every role sees the note 'Render failed, media ops can retry it in Jobs', media_ops and admin included. The note links to /admin/jobs?entity=<id>, and that screen does not exist yet (no src/routes/admin/jobs*). The author disclosed that no actor sees Retry. The note's dead link and its wrong audience were not disclosed.

evidence: grep -rn "jobs.retry" app/src/server/lib/permissions/ finds nothing; ls app/src/routes/admin | grep -i job finds nothing; RoleGate takes a plain string, so tsc cannot catch it

blocking: false

### 6. app/src/server/jobs/steps/render-variants.ts (STUB(B7 step 8) at line 139, B9's file)

what: B9's file still carries `STUB(B7 step 8)` at line 139: at 40 claimed rows, one request_property_render call should queue the next job for the rows beyond 40. B7 step 8 now provides that function but cannot edit B9's file (one writer per file). Until B9 replaces the stub, a property with more than 40 staged photographs leaves the extra rows staged with no job. The author recorded this. It is routed here so the orchestrator assigns it to B9.

evidence: grep -rn "STUB(B7" app/src prints render-variants.ts:139

blocking: false

### 7. app/tests/fixtures/service.ts (stale docstring, file outside the group)

what: Stale comment in a file outside the group. serviceClient's docstring says 'It never deletes; deletes go through removeFixtureRows over pg'. admin-smoke.ts's upload cleanup now removes Storage objects through serviceClient(): removeStaged(storage, ...) and storage.from("media").remove(...).

evidence: app/tests/fixtures/service.ts docstring; git diff origin/main...slice/b7 -- app/scripts/admin-smoke.ts (cleanup block)

blocking: false

## g2 · steps 9-10

None blocks. Each entry is the reviewer's text, with its file and evidence. The fourth follow-up of the review (GOTCHAS.md) is banked as P-2609 and is not repeated here.

### 1. app/tests/db/admin-cache.db.test.ts

what: The sent_month case cannot tell the month from the day on the first UTC day of a month, and the author says so. The consequence goes further than that note: CI's db job runs `watchfail.mjs --changed origin/main --kinds unit,sql`. On the 1st of a month, any PR that touches this test file (later B7 steps add cases here) will replay b7-g9-db-sent-month as WATCHED-FAIL BAD: stayed green, and the db job goes red for no product reason. A fix: date the extra row a day before today but inside the month when today is not the 1st, or give the case a fixed clock.

evidence: Suspected by reading, not run on a 1st. On day 1, date_trunc('month') equals date_trunc('day'), so email_sent_today() also counts the three in-month rows (2 at now(), 1 at the month's first instant) and the delta stays 3. ci.yml line 213 runs the mutation replay with --changed origin/main. On 2026-10-08 the mutation goes red as expected: I reproduced 'expected 2 to be 3'.

blocking: false

### 2. app/tests/e2e/admin-editorial.spec.ts

what: No one has seen the new test 'the dashboard counts the requests waiting' fail (STANDARDS C08). Its manual entry b7-g10-e2e-dashboard-count has never been replayed. The test skips on mop-dev until main pushes 20261008150152_admin_dashboard.sql, and CI does not replay manual entries. Reading the toPass loop, a shifted tile value would fail after 90 s, so it can probably fail, but that is UNPROVEN.

evidence: The built and url runs both print '1 skipped' for this test. tests/mutations/B7.json entry b7-g10-e2e-dashboard-count has kind manual. The author's watchedFail list marks it UNPROVEN.

blocking: false

### 3. workspace/05-plans/B7.md

what: Some plan lines for step 9 no longer match the tree. The step names a `bounce_rate_7d` output, but the function returns email.sent_7d and bounced_7d and the client divides them. The 'absent' cases (assets, social_posts, broadcast_recipients_since with to_regprocedure null) describe a stack that main no longer has, since B9, B10 and B11 have landed. The log records both deviations. The orchestrator should fold these plan lines.

evidence: grep bounce_rate_7d in the migration gives 0 matches. The test renames assets and social_posts and stubs broadcast_recipients_since inside the rolled-back transaction (P-916). email_sent_month.sql already includes broadcast_recipients_since.

blocking: false
