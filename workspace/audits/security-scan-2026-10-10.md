# Security scan for H1-09

date: 2026-10-10

- report directory: E:/mop-build/scan/CLAUDE-SECURITY-20261010-080635/ (CLAUDE-SECURITY-RESULTS.md, .jsonl, .sarif, CLAUDE-SECURITY-REVISION-791f6e754644.json)
- revision scanned: 791f6e754644d7090239435afae5e656d78614c9 (791f6e75), branch recorded as scan/h1, not main; H1 steps 5 to 10 branches not yet merged
- scope: app, 1965 files, medium effort, focus attack-surface; Mozilla Observatory and the deployed edge outside this scan
- verification status printed by render_report.py: verified
- totals: 20 findings, 0 Critical, 0 High, 4 Medium, 16 Low

### F1 · Open redirect: /markets/* splat is put into a redirect href unnormalized, so /markets//evil.example gives 301 Location: //evil.example
- severity: Medium
- where: app/src/routes/_site.markets.$.tsx:6
- fix: Strip leading slashes and backslashes from the splat before building the redirect href (or let redirect() build a same-origin path) and add a test for /markets//evil.example and /markets/%5Cevil.example.

### F2 · Polynomial ReDoS in the budget regex of the public search matcher, run once per catalog card
- severity: Medium
- where: app/src/lib/search-match.ts:37
- fix: Bound the budget regex in app/src/lib/search-match.ts (cap the input length and remove the nested or overlapping quantifier) so cost stays linear per catalog card.

### F3 · Agent key can rewrite the caption of an already human-approved asset, bypassing the human-approval gate
- severity: Medium
- where: app/src/server/assets/service.ts:258
- fix: Make editCaption in app/src/server/assets/service.ts refuse an agent key once the asset is human-approved, or reset the approval when the caption changes.

### F4 · Operator and CI database clients connect to the Supabase pooler without TLS
- severity: Medium
- where: app/scripts/db-push.mjs:142
- fix: Make app/scripts/db-push.mjs require TLS (sslmode=require or verify-full with the Supabase CA) for the pooler connection instead of connecting in the clear.

### F5 · Channel enable guard (assertMayEnable) is never called: channels.channels_put can switch on Facebook and unverified channels, bypassing the admin-only new_channels flag
- severity: Low
- where: app/src/server/automation/service.ts:365

### F6 · Agent guardrail on protected schedules ignores interval_days and last_run_at, so an agent key can still re-time or stall prune and reconcile
- severity: Low
- where: app/src/server/automation/service.ts:199

### F7 · Repeat POST /submissions within 10 minutes hands any caller an upload grant and re-signed overwrite URLs for someone else's submission
- severity: Low
- where: app/src/server/submissions/service.ts:161

### F8 · Staff-address enumeration through response time on the unauthenticated sign-in link endpoint
- severity: Low
- where: app/src/server/team/service.ts:146

### F9 · State-changing GET /api/consent?set= sets the consent cookie with no same-origin check
- severity: Low
- where: app/src/server/public/consent.ts:30

### F10 · Sign-in link endpoint leaks which emails are staff through response timing
- severity: Low
- where: app/src/server/team/service.ts:144

### F11 · Media edge-cache key is the raw request origin+pathname, so the takedown purge of the canonical URL leaves other cached copies of a taken-down file serving for a year
- severity: Low
- where: app/src/server/public/cache.ts:226

### F12 · Retention job 'anonymises' email addresses with an unsalted, unkeyed SHA-256, so they stay re-identifiable
- severity: Low
- where: app/supabase/sql/functions/retention_anonymise_inquiries.sql:25

### F13 · Admin notification for agent automation changes is deduplicated on a client-chosen X-Request-ID, letting an agent silence repeat alerts
- severity: Low
- where: app/supabase/sql/functions/automation_put_recipe.sql:43

### F14 · Duplicate-submission shortcut hands another submitter's id and media paths to anyone who knows their email, address and zip; the Worker then mints an upload token and overwrite-capable signed upload URLs for it
- severity: Low
- where: app/supabase/sql/functions/create_submission.sql:39

### F15 · Unauthenticated submission overwrites an existing contact's name, phone and brokerage, keyed on an unverified email
- severity: Low
- where: app/supabase/sql/functions/create_submission.sql:64

### F16 · Retention 'anonymisation' replaces contact email with an unsalted SHA-256 of the address, which is dictionary-reversible
- severity: Low
- where: app/supabase/sql/functions/retention_anonymise_contacts.sql:39

### F17 · create_submission 10-minute dedupe hands the first submitter's id and media rows to anyone who repeats email, address and zip
- severity: Low
- where: app/supabase/migrations/20261004135327_public_write_events.sql:42

### F18 · payments UPDATE policy lets managing_editor void or alter issued invoices directly, bypassing admin-only void and frozen invoice data
- severity: Low
- where: app/supabase/migrations/20261001090900_rls.sql:171

### F19 · Retention 'anonymisation' replaces email addresses with an unsalted SHA-256 of the address (re-identifiable, linkable)
- severity: Low
- where: app/supabase/migrations/20261004065712_retention.sql:188

### F20 · Submitter-controlled property text goes into a headless Claude CLI that is started with no tool restrictions
- severity: Low
- where: app/scripts/captions-runner.ts:96
