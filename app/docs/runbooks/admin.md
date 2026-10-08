# Admin runbook

How people and agents get into `/admin`, where uploaded photographs wait, how agent keys are handled, how a takedown runs from the dialog to the 410, and how a data request is answered within 45 days. Slice B7 writes this page (step 10). Screen numbers are those of `workspace/07-admin-platform/admin-screens.md`; rulings cited are in `workspace/05-plans/ASSUMED.md` section H. A line marked UNPROVEN names a part that is not built or not run yet.

## First admin user

- On `mop-dev`, before the launch switch, the staff test accounts come from `bun run scripts/seed-admin-users.ts` (dev profile): one user per role, the CEO account with `admin` and `chief_editor`, and one agent whose key is printed once. It refuses a production database through `assertNotProduction` (ruling H35 (5)).
- The first real admin is made at the launch switch by `bun run scripts/bootstrap-admin.ts --email <address>` (L1 step 1f). That script is a later step of B7 and is not on main yet: UNPROVEN.
- Sign-in is a magic link. It opens `/admin/auth/confirm`, which only shows "Continue to Matter of Place"; the session starts when that button posts, so a mail scanner that follows the link spends nothing.
- `admin` alone does not decide requests (architecture 3.7). The CEO holds `admin` and `chief_editor`.

## Staged uploads

- An editor's upload and an accepted request's photographs are stored in the private bucket `submissions` under `staging/<property id>/`, and the row records the object in `property_media.staging_path` (G25). No admin request writes the public bucket `media`.
- B9's `render_variants` job (`scripts/render-variants.mjs`, run in GitHub Actions) writes the variants to `media`, removes the staged object and clears `staging_path`. Until then the staged file counts against the 1 GB Storage of the free plan; screen 2's Storage gauge adds the three buckets `submissions`, `media` and `documents` and turns to the warning state at 70 percent (ruling H33 (8)).
- A dead `render_variants` job leaves its staged files where they are. Retry on screen 9 (the photograph's variant status) or on screen 16 runs it again. The button shows only to an actor holding `jobs.retry`, which B8 registers (media_ops and admin in B8's plan); until B8 step 9 registers that action and builds screen 16, nobody sees Retry: UNPROVEN.

## Agent keys

- A key reads `mopk_<environment>_<random>`. The `mopk_` prefix makes a leaked key easy to recognise in a log or a paste.
- Only the sha256 of a key is stored (`hashAgentKey` in `src/server/lib/agent-keys.ts`), so a key is shown once, when it is made, and can never be read back.
- An agent sends `Authorization: Bearer mopk_...` and acts only inside its scopes and its roles. The `team` and `settings` groups are never open to an agent, and the daily caps of `settings.agent_daily_limits` apply (seeded at 25 decisions, 5 publications and 2,000 requests a day).
- Every bearer request looks the key up again (`agent_key_by_hash`), so a revoked key or a disabled agent is refused on its next request.
- On `mop-dev` the seed agent's key comes from `scripts/seed-admin-users.ts`; a second run issues a new one.
- Revoking one key or every key at once is screen 23 (`DELETE /api/admin/team/agents/:id/keys/:keyId`, `POST /api/admin/team/agents/revoke-all`). Those routes are B7 step 14 and are not on main yet: UNPROVEN. For a leaked key, revoke all, then issue a new key to each agent that still needs one.

## Takedown checklist

A takedown removes a page for good: an owner's request or a rights claim. The working rule is to finish within 24 hours of the request.

1. On screen 8, press Unpublish (on an archived property, Take down), choose the reason and tick Takedown. `unpublish_property` then sets `taken_down_at`, cancels the property's post jobs that are queued or waiting for approval and enqueues the `takedown_media` job, all in one transaction.
2. Watch the `takedown_media` job until it ends `done`, on screen 16 once B8 builds it. Until then read it from the database: `select status, attempts, error from jobs where idempotency_key = 'takedown_media:<property id>'`. The job deletes the property's objects from `media` and purges each `/media/<key>` address from Cloudflare's cache. Its job file is B8 step 10a and is not on main yet: UNPROVEN.
3. On screen 12, under "Withdraw by hand", delete each live post on its platform, then press Done on its row. Screen 2's "Withdraw by hand" tile counts the posts still open and shows how old the oldest is against the 24 hour rule.
4. Confirm the page answers 410: `curl -s -o /dev/null -w "%{http_code}\n" https://<host>/property/<slug>` prints `410`. B13 serves the 410 for a slug whose `taken_down_at` is set and is not on main yet: UNPROVEN. An unpublish without Takedown answers 404 instead.
5. Confirm that each `/media/<key>` address of the property answers 404 after the purge, with the same `curl` line for each key.

## Answering a data request within 45 days

- A request arrives through `/privacy-request` (`POST /api/public/subjects/request`) as a `subject_requests` row whose `due_at` is 45 days after `received_at`. Its kind is `access`, `deletion`, `opt_out` or `correction`. The `subject_request.received` recipe mails the requester an acknowledgement and notifies the admins.
- Screen 25 lists the open requests with the days left, and its actions follow the order identity first: start verification, confirm identity (or reject with a note), then fulfil by kind: export for `access`, anonymise for `deletion` (nothing is hard deleted), opt out for `opt_out`, and for `correction` edit the row on the screen that owns it and record what changed. Each action needs the `admin` role and a sign-in within the last 15 minutes. Screen 25 and its routes are B7 steps 15 and 15a and are not on main yet: UNPROVEN.
- Until screen 25 exists, list what is due from the database: `select id, kind, status, due_at from subject_requests where status not in ('fulfilled', 'rejected') order by due_at`.
