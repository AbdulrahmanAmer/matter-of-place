# Meta runbook

Instagram posting, and the Facebook Page behind it (slice B10). This page is written by B10 step 0 from the plan; step 3
adds what Meta's documentation says, and step 2 will add the token route that works, the confirmed scopes and the call
that returns the app mode.
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

`graph_version` is `v26.0`, the newest version Meta's documentation names on 2026-10-07 (step 3); the owner enters it
in the form once the app exists.

## What Meta's documentation says (step 3, read on 2026-10-07)

Read from the pages on developers.facebook.com, not from a live call: the Content Publishing guide and the references
for IG User Media, IG Container, IG User Content Publishing Limit, IG Media Insights, Error Codes and the Facebook
Stories API. Every line below is the documentation's, and UNPROVEN against the real app until step 2 and step 7 run. The
fixtures in `tests/fixtures/graph/` are written by hand from these pages and carry `"source": "docs"`; nothing in them
is a recorded answer.

- Graph version: the pages name `v26.0` as the latest. Enter it in the Account ids form; whether the app can call it is
  step 2's check.
- Calls the plan lists that the pages confirm: `POST /{ig-user-id}/media` with `image_url`; with `is_carousel_item` for
  carousel children and `media_type=CAROUSEL` with `children` for the parent; with `media_type=STORIES`; with
  `media_type=REELS`, `video_url`, `cover_url` and `share_to_feed`. `POST /{ig-user-id}/media_publish` takes
  `creation_id`. `GET /{container-id}?fields=status_code` answers `EXPIRED`, `ERROR`, `FINISHED`, `IN_PROGRESS` or
  `PUBLISHED`. `GET /{ig-user-id}/media` is documented with ids only, so `caption`, `timestamp` and `permalink` are
  requested fields whose answer is UNPROVEN. The Facebook Stories API page confirms the Page photo story path: upload the
  photo to `/{page-id}/photos` with `published` set to `false`, then publish it to `photo_stories` with its `photo_id`.
- Not confirmed: the Graph reference pages for Page photos and Page posts came back without reference text when fetched
  as plain HTML, so `GET /{post-id}?fields=permalink_url` and `GET /{page-id}/posts?fields=message,created_time,permalink_url`
  are still the plan's. They matter only once the Facebook block is switched on.
- Permissions the pages name, among others, for the Facebook Login route: `instagram_basic`, `instagram_content_publish` and
  `pages_read_engagement` for publishing; `instagram_basic`, `instagram_manage_insights` and `pages_read_engagement` for
  insights; `pages_show_list` on the IG User Media page; `pages_show_list`, `pages_read_engagement` and
  `pages_manage_posts` for Facebook Page stories. That agrees with `META_REQUIRED_SCOPES` and setup item 5; step 2
  still confirms the constant.

Where the pages differ from the plan, or say more than it does:

1. Publishing limit. The guide says 100 API-published posts in a moving 24 hours, with a carousel counting as one; its
   carousel section says 50; the Content Publishing Limit reference shows `quota_total` 50 in its example. The number
   stays read live from `content_publishing_limit` (`quota_usage`, and `config.quota_total` over `config.quota_duration`
   seconds). Our own cap of 2 a day is under all three.
2. Containers. An account may create 400 containers in a rolling 24 hours and a container expires after 24 hours, which
   is the `EXPIRED` status. The Error Codes table's remedy for an expired or missing media builder is a new container.
3. Polling. The guide recommends asking for a container's status once a minute for at most 5 minutes. The plan's
   `waitForContainer` asks every 5 seconds for 20 seconds, then the retry asks again after 2 minutes. Whether the faster
   polling is throttled is UNPROVEN, and step 7's real post is where to watch for it.
4. Alt text. `alt_text` (up to 1000 characters) exists for image posts, on a single image or an image inside a carousel.
   Reels and stories do not take it. It was added on 2025-03-24. B9's captions already produce `alt_text` and
   `slide_alts`, but the plan's call list for `meta.ts` does not pass them to Meta, so sending them is a small decision
   for step 6 (not wired, UNPROVEN as to effect).
5. Stories. `media_type=STORIES` takes an image or a video. A story video is 3 to 60 seconds and at most 100 MB, with a
   9:16 aspect recommended. Stories expire after 24 hours, publishing stickers is not supported and mentioning users
   without a sticker is.
6. Images. JPEG is the only format Instagram accepts (MPO and JPS are refused), at most 8 MB, aspect between 4:5 and
   1.91:1, width 320 to 1440 pixels, sRGB. A 1080 by 1350 slide is exactly 4:5, the edge of that range, and whether the
   edge itself is accepted is UNPROVEN until step 7. `scripts/lib/shoot.mjs` writes JPEG for every owned render except
   the static Open Graph cards, which are PNG.
7. Reels. A reel cannot be placed in a carousel. A cover is a JPEG of at most 8 MB, 9:16 recommended, and `thumb_offset`
   (milliseconds) picks a frame instead. The limits are in `tests/fixtures/graph/reels-limits.json`: MP4 or MOV with no
   edit lists and the `moov` atom first; H.264 or HEVC, progressive, closed GOP, 4:2:0; AAC at 48 kHz at most, one or
   two channels; 23 to 60 frames per second; at most 1920 pixels wide, any aspect between 0.01:1 and 10:1 (9:16
   recommended); video bitrate at most 25 Mbps (VBR); duration 3 seconds to 15 minutes; at most 300 MB.
   `tests/unit/channels/reels-limits.test.ts` fails if what `scripts/render-reel.mjs` probes for (1080 by 1920, 30 fps,
   h264, aac, 15 to 25 seconds, at most 12 MB) leaves those limits.
8. Insights. The metric names on the IG Media Insights page include `views`, `reach`, `likes`, `comments`, `shares`,
   `saved`, `total_interactions`, `reposts`, `follows`, `profile_visits`, `profile_activity`, `navigation`, `replies`,
   `ig_reels_avg_watch_time`, `ig_reels_video_view_total_time`, `reels_skip_rate`, `facebook_views`, `crossposted_views`,
   and the `total_*` forms for the Facebook Login route. `impressions` is on the page, and one row carries the note
   "for media created after July 2, 2024, this metric is deprecated"; the table does not make clear whether that row is
   `impressions`, so treat it as deprecated (UNPROVEN). `plays` is not on the page. `meta-metrics.ts` (step 4) keeps
   every name provisional until a live test post returns it. Data can lag up to 48 hours. Story metrics last 24 hours,
   and story values under 5 answer "(#10) Not enough viewers for the media to show insights".
9. Errors worth a row in `meta-errors.ts` (step 4). `media_publish` answers HTTP 400 with code 9, subcode 2207042 when the
   publishing limit is reached, and code 9007, subcode 2207027 when the container is not `FINISHED` yet. Both are in the
   fixtures.

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
