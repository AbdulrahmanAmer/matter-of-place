# Meta runbook

Instagram posting, and the Facebook Page behind it (slice B10). This page is written by B10 step 0 from the plan; step 2
adds the token route that works, the pinned Graph version, the confirmed scopes and the call that returns the app mode.
Until the Meta app exists (S59, E9) nothing here has run against Meta: every line about Meta's side is the plan's, and
UNPROVEN. Values are never written on this page.

## Setup (the owner does this, an agent cannot)

1. Convert the Instagram account to a Professional (Business) account, and make sure a Facebook Page exists, owned by the
   Business.
2. In Meta Business Suite, connect that Instagram account to the Page (Page settings, linked accounts).
3. In Meta Business Manager, register the business. At developers.facebook.com create an app of type Business and add
   the products Instagram (Instagram API with Facebook Login) and Facebook Login for Business (or plain Facebook Login).
4. Give the owner's account the Administrator role on the app. While the app stays in Development mode and every account
   posted to belongs to a person with a role on the app, Standard access is enough and no App Review is needed
   (UNPROVEN, step 2 confirms it). If Meta insists on Advanced access, the fallback is App Review with a screencast and
   Business Verification, which takes days: start it at once.
5. Request these permissions: `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`,
   `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `read_insights`.
6. In Graph API Explorer get a user token with those permissions, exchange it for a long-lived token, then read the
   Page's access token from `GET /me/accounts`. A Page token made from a long-lived user token does not expire
   (UNPROVEN). Record the Page id and the Instagram user id with
   `GET /{page-id}?fields=instagram_business_account`.
7. Record the app id from the app dashboard and store the three values as Supabase function secrets:

   ```
   bunx supabase secrets set META_APP_ID=<id> META_APP_SECRET=<secret> META_PAGE_TOKEN=<token> --project-ref $DEV_SUPABASE_PROJECT_REF
   ```

   There is one project (H35) and no second set of names: the launch switch replaces the test values with the real ones
   under the same names. Add the same three names to the git-ignored `.env` for `scripts/meta-check.ts`. Nothing goes in
   a `VITE_*` name or in the repository.

8. Use a private test Page and a test Instagram professional account until the launch switch.

The post steps run in the job-runner Edge Function, so the three names are Supabase function secrets and not Worker
secrets or GitHub secrets (G21). At this commit the only file under `src/` that reads them is
`src/server/jobs/system/meta-token-refresh.ts`, which runs in the job runner; no Worker route and no workflow reads them.

A System User token from Business Manager is the alternative if the Page-token route proves fragile; step 2 decides.

The Facebook Page is needed now only because the Instagram API with Facebook Login runs through it. Nothing is posted to
the Page until `channel_settings.facebook.enabled` is switched on.

## The Account ids form

The non-secret ids go to `settings.meta` through the Account ids form on `/admin/channels` (screen 12): `page_id`,
`ig_user_id` and `graph_version`. The form is built in B10 step 8 and the action behind it, `channels.ids_put`, in
step 6, so both are UNPROVEN here. The plan has it open to `media_ops` and `admin`, humans only (an agent key gets
403 `human_only`), audit-logged, and strict: a body with any field other than the three is refused, so a token cannot
reach `settings`.

`graph_version` is a placeholder `v23.0` until step 3 replaces it with the newest version in Meta's changelog that day and
records it here.

## Check the setup

From `app/`, with the dev profile loaded (`eval "$(node scripts/load-env.mjs --profile dev)"`):

```
bun run scripts/meta-check.ts
```

It reads `settings.meta` and the token, asks the Graph API, prints one line per check and writes nothing:

- `meta not_configured` and exit 0 while `settings.meta` lacks a `page_id` or an `ig_user_id`.
- Otherwise `app_id ok`, `token ok`, `expires never` (or a date), `page_id ok`, `ig_user_id ok`, one
  `permission <name> granted` line for each of the five permissions in `META_REQUIRED_SCOPES`, and `app_mode unknown`.
  Exit 1 if any check failed, and on `graph_version missing` or `token missing`. The `pages_manage_posts` and `read_insights` permissions of setup item 5 are not checked.
- `app_mode unknown` stays until step 2 names the call that returns Development or Live. Until then read the mode in the
  app dashboard.

The script reads the token the same way the daily `meta_token_refresh` job does: Vault's `meta_page_token` first, the
`META_PAGE_TOKEN` secret second. A token in Vault therefore wins over a new `META_PAGE_TOKEN`.

## Token rotation

`meta_token_refresh` asks Meta about the token once a day and stores `token_expires_at`, `token_state` and
`data_access_expires_at` in `settings.meta`; `docs/runbooks/jobs.md` (The Meta token alert) says what each alert means.
To replace a token by hand:

1. Make a new long-lived Page token as in setup item 6.
2. Store it: `bunx supabase secrets set META_PAGE_TOKEN=<token> --project-ref $DEV_SUPABASE_PROJECT_REF`, and put it in
   `.env`. If Vault already holds a `meta_page_token`, that entry is read first, so store the new token from the
   channels screen too (jobs.md).
3. A token stored from the channels screen writes its own audit row (jobs.md). One changed only as a function secret is
   recorded by hand: `bun run scripts/audit-note.ts --secret META_PAGE_TOKEN --note "<why>" --i-mean-it`.
4. Run `bun run scripts/meta-check.ts` and expect `token ok`.

## Error 190

Graph code 190 is Meta's answer for a token it no longer accepts (expired, revoked, or the password or permissions
changed; that is Meta's documented meaning, UNPROVEN from this app). It is the dead-token case, not a retry case.

- What the plan builds for it (step 6, UNPROVEN until it merges): the post's row gets `error = 'token_dead'`, the
  channel's health turns red on screens 2 and 12, and the owner gets a `notify_admin` alert. The next good post or check
  clears the row error.
- What to do: run `bun run scripts/meta-check.ts` to see which line fails, rotate the token as above, run the check
  again, then use Retry on the failed post on screen 12 (Retry is built in step 6, the screen in step 8).
- Reading the check: `token invalid` is a dead token. A `permission` line ending in `missing` means the permission was
  removed from the app and has to be granted again before a new token is made.
