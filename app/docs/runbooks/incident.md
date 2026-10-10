# Incident runbook

For whoever is awake when something is wrong. Roles, not people (GS-05): the CEO decides and holds the vendor logins,
mop-builder fixes in a fresh session. Names and numbers are read from `settings.site` and PROJECT-STATE, not copied here. A runbook nobody has walked is fiction: section 11 records the game day, and the drill
`bun run scripts/harden/incident-drill.ts --env dev --base <dev>` flips the switches of sections 5 and 6 on `mop-dev`
and back, and revokes a throwaway agent key as section 7 does.

## 1. Read this first

An incident is any of these: the site is down or wrong, illustrative content shows on production, something leaked, a
channel misbehaves, forms fail.

| Severity | Meaning                                            |
| -------- | -------------------------------------------------- |
| SEV1     | the site is down, wrong or leaking                 |
| SEV2     | one channel, one form or one job family is failing |
| SEV3     | the site works but is degraded                     |

The first move is to stop harm, then diagnose. Stopping harm is one of the switches below: roll back the Worker
(section 4), put the site in coming-soon (section 5), disable a channel (section 6), revoke an agent key (section 7) or
take a page down (section 8). Diagnosing starts at section 3.

## 2. Who is paged

Alerts are emails to the admin mailbox. There is no paging service (out of scope). They come from:

- the three uptime monitors of B14; the third is the keyword monitor on the `ops-health` hook of B8, which fires when the
  job runner, keep-warm or the backup stops, and needs neither the runner nor Resend (DO-03);
- the Sentry alert rule, which emails the owner from Sentry's own infrastructure for every new issue, including each
  failed health check reported as `HealthCheckFailed` and each `notify_admin` alert mirrored to Sentry, so alerts still
  arrive while Resend cannot deliver (INT-04);
- the daily `health` job, and Resend and Cloudflare notices.

BLOCKED: the alert path does not work end to end until two things exist. The uptime monitor needs the operator to sign up
for the vendor account, and the orchestrator configures it after that (decision S59). Live mail waits on B5 step 5
(Resend exists, E17). This section says so until the CEO confirms both (manual item M-06).

Decisions and vendor logins: the CEO. Fixes: mop-builder, in a fresh session.

## 3. The first five checks

In order. Before L1 the production host is `https://matter-of-place.holy-meadow-4327.workers.dev` (E2); after the domain
is attached it is `https://matterofplace.com`. Use the host that exists.

1. Is it us or a vendor?
   `curl -sI https://matterofplace.com/` and
   `curl -sI https://matterofplace.com/api/public/markets | grep -i "^x-request-id"`. The public API sets that header on
   its responses (B3); a `200` body is an array and carries no request id, so read the header. Then read the
   Cloudflare and Supabase status pages.
2. What changed? `gh run list --workflow deploy.yml --limit 5` and `bunx wrangler versions list` (owner's shell, local
   `mop-admin` token).
3. Errors now: Sentry unresolved issues, and `bunx wrangler tail matter-of-place --format json --status error` (owner's
   shell only; the deploy token in GitHub cannot tail, E1).
4. Database and jobs:
   `bun run db:psql -- -Atc "select status, count(*) from jobs where created_at > now() - interval '1 hour' group by 1"`
   (the one database, production after L1's launch switch, ruling H35). Then the failed-jobs count on the dashboard, and
   whether Supabase paused (the keep-warm cron rows).
5. Limits: B14's usage tool, `node usage.mjs --env prod` from `workspace/audits/tools`, and look for `DECISION` or
   `LIMIT`. UNPROVEN at writing (2026-10-10): `usage.mjs` is not in that folder yet; B14 adds it.

## 4. Roll back the Worker

From the owner's shell with the local `mop-admin` token: `bunx wrangler rollback --name matter-of-place --message <reason>`.
The full procedure, with the job runner rollback, is in `rollback.md` of this folder.

A rollback does not undo migrations, Supabase secrets or Storage objects.

## 5. Put the whole site in coming-soon

1. Admin, Settings, Coming soon, turn on the global switch. It writes `settings.coming_soon_global` through
   `PUT /api/admin/settings/coming-soon`, which needs a person signed in as admin within the last 15 minutes; an agent
   key cannot use it.
2. The public catalog changes within about 15 seconds: the public state is checked at most every 15 seconds per isolate, and
   the new version changes every cache key. No purge is needed. The incident drill measured 1.1 to 14.9 seconds to see a
   flip, in two runs against a local Worker on `mop-dev`.
3. Verify with the catalog JSON: `curl -s https://matterofplace.com/api/public/markets` shows `"comingSoon":true` for all
   three markets. The page text is a second check, `curl -s https://matterofplace.com/properties | grep -c "No property is listed"`
   (the sentence is in `src/lib/strings.ts`), but trust the JSON first: on the local preview of 2026-10-10 the page
   HTML still showed a property card with the switch on while the JSON followed it, and why is UNPROVEN.
4. To turn it off again, set the same switch off and run the same check; the markets show `"comingSoon":false` unless a
   market has its own switch on.

## 6. Disable a channel

1. Admin, Automation, Channel settings (screen 20): set the channel `enabled` off.
2. Cancel the queued posts from Jobs (screen 16).
3. When a token is the cause, go on to `docs/runbooks/rotation.md`.

A `post_meta` job for a disabled channel ends `done` as `skipped_disabled` and creates no `social_posts` row; the drill
checks this for Instagram.

## 7. Revoke an agent key

1. Admin, Team, the agent, Revoke (screen 23). Like the coming-soon switch, it needs an admin signed in within the last
   15 minutes.
2. When a key may have leaked, use "Revoke all agent keys": `POST /api/admin/team/agents/revoke-all`, audit action
   `team.revoke_all_keys` (B7, G27).
3. Keys start with `mopk_`: search the logs and the repository for that prefix.
4. Verify that the old key gets `401`: `curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer <old key>" <base>/api/admin/me`.

## 8. Take a page down

1. Admin, Properties, Unpublish, with the reason `rights_takedown` or `owner_request` and the takedown box ticked
   (`unpublish_property(..., p_takedown => true)`, B7).
2. The takedown sets `taken_down_at`, so the slug answers `410 Gone` within one 15 second state check (B13). It also
   cancels the `queued` and `waiting_approval` `post_meta`, `post_x` and `post_linkedin` jobs of that property. An
   ordinary unpublish without the box answers 404 and cancels nothing.
3. The takedown enqueues the system job `takedown_media` (key `takedown_media:<property_id>`, E2E-01). It deletes every
   stored object of the property in the public bucket `media` (variants, cover, carousel, story, reel, poster, OG image;
   the originals were already deleted once their variants existed, ruling H33 (8)), purges the matching `/media/<key>`
   addresses at the zone with `CF_PURGE_TOKEN` (H33 (6)), and sets `withdraw_required_at` on every `posted`
   `social_posts` row of the property.
4. Check it: `bun run db:psql -- -Atc "select status from jobs where idempotency_key = 'takedown_media:<property id>'"`
   prints `done`. A `retry_at` with `storage_unavailable` appears only during a Storage outage (H33 (2)).
5. Posts already live on Instagram, X or LinkedIn are deleted by hand on each platform from screen 12's "Withdraw by
   hand" list, which shows the permalink. Close each with its "Done" action (`mark_social_post_withdrawn`, audited, sets
   `withdrawn_at`). Screen 2 shows the count and the oldest age against the 24 hour rule for takedown requests (GP-03)
   until the list is empty.
6. Logins for those platforms: the CEO holds them (vendor logins, section 2). UNPROVEN: which password manager entry
   holds each; the CEO names it here when the game day is walked.

## 9. What to say

There is no public status page. Tell affected agents and subscribers by one plain email from the admin address, saying
what happened, what is affected and when we will write again. Nothing is promised that is not known.

## 10. Afterwards

- One file `workspace/audits/incidents/YYYY-MM-DD-slug.md` with five lines: what, when, how detected, fix, what
  prevents it.
- A GOTCHAS entry the same day if more than 30 minutes were lost.
- A decision row in PROJECT-STATE if a limit or a paid feature is involved (G-011).

## 11. Game day record

Manual item M-05, done by a person other than the author of this runbook: read this file cold, put `mop-dev` in
coming-soon and back, disable a channel, roll the Worker back, and time each step. Until a second person has done it,
every line below is NOT DONE and this runbook is unwalked.

| Step                              | Seconds  | Walked by | Date     |
| --------------------------------- | -------- | --------- | -------- |
| Section 5, coming-soon on and off | NOT DONE | NOT DONE  | NOT DONE |
| Section 6, disable a channel      | NOT DONE | NOT DONE  | NOT DONE |
| Section 4, roll the Worker back   | NOT DONE | NOT DONE  | NOT DONE |
