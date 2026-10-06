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
