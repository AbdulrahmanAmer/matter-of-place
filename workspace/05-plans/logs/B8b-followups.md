# B8b follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 1

Recorded from the g1 review (no blocking defect). None is blocking.

### 1. app/supabase/migrations/20261004115859_automation.sql

- what: The channel_settings.approval_mode CHECK (lines 62-66) does not enforce the plan's shape {Feature, Reach, Campaign}. A missing key makes `->> 'Reach' in (...)` evaluate to NULL, and a CHECK accepts NULL, so a value like {"Feature": "manual"} is stored. Today only the TS Zod schema guards it, so a direct Studio edit or a later put that skips Zod can store an incomplete mode. Found by reading, not run. Follow-up: add `approval_mode ?& array['Feature','Reach','Campaign']` to the check in a later migration.
- evidence: Lines 62-66: check (approval_mode ->> 'Feature' in ('manual','auto') and approval_mode ->> 'Reach' in (...) and approval_mode ->> 'Campaign' in (...)). Postgres treats a NULL CHECK result as satisfied.
- blocking: false

### 2. workspace/05-plans/logs/B8b.md

- what: The log title has an em dash ('# B8b — Automation console: build log'). The standing rule is no em dashes, and the other slice logs use none. Internal document, no product copy affected.
- evidence: git diff origin/main...slice/b8b | grep -n '^+.*—' finds only line 2819: '+# B8b — Automation console: build log'.
- blocking: false

### 3. app/supabase/sql/functions/automation_put_reason.sql

- what: Note for a later slice, already raised in the author's log. automation_put_reason keeps the plan's signature (p_id uuid first, no default), so the generated Args type p_id as string, and the TS putReason cannot pass null for an insert without a cast (P-915). claim_schedule took the opposite route: it gained `default null` on its three time arguments, which the plan's signature does not have. Both need an orchestrator ruling and a plan fold before the TS service group.
- evidence: src/db/types.ts diff: automation_put_reason Args "p_id": string; claim_schedule Args "p_old_last_run_at"?: string. Migration lines 797-803 add the defaults; the plan's Data changes line shows claim_schedule(p_key text, p_guard boolean, p_old_last_run_at timestamptz, p_last_run_at timestamptz, p_next_run_at timestamptz) with no defaults.
- blocking: false

### 4. app/supabase/sql/functions (7 put and restore files)

- what: UNPROVEN, outside this group. The seven `-- STUB(B8b step 6)` markers are invisible to scripts/stubs.ts (banked as P-1600), so the stubs gate cannot stop B8b from closing with the write_audit guard still in place. Separately, the plan's CI db job does not exist and src/db/types.ts is hand-written. Both are disclosed by the author and stay UNPROVEN until B4 lands the db job and main pushes the migration and runs gen:types --db with git diff --exit-code. B1b owns the stubs regex.
- evidence: P-1600 proof: git grep -c 'STUB(B8b step 6)' -- supabase/sql/functions | wc -l gives 7 while bun run stubs | grep -c automation_ gives 0. ci.yml jobs: run, check, build, merge-gate (no db).
- blocking: false
