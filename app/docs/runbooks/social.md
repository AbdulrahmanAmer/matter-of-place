# Social runbook: X and LinkedIn

Posting to X and to the LinkedIn company page (slice B10). This page is written by B10 step 0 from the plan; steps 3a
and 3b add the measured facts. Instagram is `docs/runbooks/meta.md`. Until the X developer app and the LinkedIn app exist
(S59, E9) nothing here has run against either platform: every line about their side is the plan's, and UNPROVEN. Values
are never written on this page.

## Setup of X (the owner does this)

1. Create or confirm the brand handle and log in as its owner. Turn on two-factor authentication.
2. At developer.x.com sign up for the free tier and create a project and an app. Set the app permissions to Read and
   write, the type to Web App or Automated App (a confidential client), and the callback URL to
   `http://127.0.0.1:8765/callback`, the one-shot listener of `scripts/x-authorize.ts`. If the portal refuses a loopback
   URL (UNPROVEN), the plan's fallback is to register `https://matter-of-place.holy-meadow-4327.workers.dev/oauth/x` and
   paste the `code` from the browser address bar; the script has no paste prompt yet, so add one before relying on it.
3. The script uses OAuth 2.0 with PKCE in user context, asking for the scopes
   `tweet.read tweet.write users.read media.write offline.access`. The scope names and the authorize and token addresses
   in the script are ASSUMED until step 3a checks them against the current docs.
4. Put `X_CLIENT_ID` and `X_CLIENT_SECRET` in the git-ignored `.env`, then run the consent (below). It adds
   `X_ACCESS_TOKEN` and `X_REFRESH_TOKEN` to `.env`. Store all four as Supabase function secrets:

   ```
   bunx supabase secrets set X_CLIENT_ID=<id> X_CLIENT_SECRET=<secret> X_ACCESS_TOKEN=<token> X_REFRESH_TOKEN=<token> --project-ref $DEV_SUPABASE_PROJECT_REF
   ```

   Take the values from `.env` and never paste them into a chat, a log or this page. They are function secrets because
   the post steps run in the job-runner Edge Function, not Worker secrets or GitHub secrets (G21). Nothing goes in a
   `VITE_*` name.

5. Use a second private test handle for dev and preview; production uses the brand handle. Whether the free tier allows
   a media upload plus a post at 2 a day, and its monthly write limit, are UNPROVEN until step 3a measures them.

## Setup of LinkedIn (the owner does this)

1. Confirm a LinkedIn company page for Matter of Place exists and the owner is Super admin on it.
2. At developer.linkedin.com create an app tied to that page. Request the Community Management API (or the current
   posting product for organisation posts; read the product list on the day) and submit the verification form at once.
   Approval takes days, and whether a new media company is approved the first time is UNPROVEN. Start this first.
3. The script asks for the scopes `w_organization_social r_organization_social rw_organization_admin` (names ASSUMED).
   Register the redirect URL `http://127.0.0.1:8765/callback`. After the consent, enter the organisation URN
   (`urn:li:organization:<id>`) and the `api_version` (`YYYYMM`) in the Account ids form on `/admin/channels` (screen 12,
   built in step 8; its action `channels.ids_put` in step 6).
4. Put `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` in `.env`, run the consent (below), then store the four
   `LINKEDIN_` names as function secrets with the same command shape as X, `--project-ref $DEV_SUPABASE_PROJECT_REF`.
5. Until approval arrives LinkedIn stays `enabled = false` and its card says "not connected". Launch does not wait for
   it if the owner accepts two live channels for the first days (decision for L1).

## Run the consent

From `app/`, with the dev profile loaded (`eval "$(node scripts/load-env.mjs --profile dev)"`):

```
bun run scripts/x-authorize.ts
bun run scripts/linkedin-authorize.ts
```

Each starts a listener on `http://127.0.0.1:8765/callback` that waits five minutes, prints the consent address, and you
open it in a browser signed in as the brand handle or a page admin. The script then trades the code, stores the token
set in Vault (`x_oauth_token`, `linkedin_oauth_token`) through `store_channel_token`, adds the access and refresh tokens
to `.env`, and prints `stored`, never a token. `x-authorize.ts` also stores the user id and handle in `settings.x`.
`--target dev` is the only target (one database, H35); any other value exits 1 with `refusing: one database (H35)`.

`store_channel_token` and `put_channel_ids` arrive with the migration of step 6, so the storing part is UNPROVEN until it
is merged and pushed. What was run: the listener and the PKCE challenge against a stand-in, not X or LinkedIn.

`--check` is not built yet. It needs `oauth-tokens.ts` (step 5a); until then both scripts print that and exit 1. It will
read the token with one read-only call, store the result with `record_channel_check`, and print `x token ok <handle>` or
`linkedin token ok <organization_urn>`.

## Measured facts

Nothing is measured yet.

- X free tier: step 3a runs `bun run scripts/x-limits-check.ts --i-mean-it` from the test handle, which uploads one test
  image, posts once, reads the post back and reads the handle's recent posts (after one read of `users/me` for the user
  id), and prints the headers of each answer whose names mention limit, remaining, reset, usage or cap. It leaves a real
  post on the handle, to delete by hand. The output goes here as "X free tier, measured
  <date>". `--record <monthly post reads>` then stores `read_allowance` and `metrics_days` (`[7, 28]`, or `[]` for 0).
- LinkedIn: step 3b records the post endpoint and version header, whether a multi-image post exists, the upload flow,
  the statistics fields and the daily limit, and sets `settings.linkedin.multi_image` through the Account ids form.

## Test posts

Before the launch switch, with an approved asset on `mop-dev`:

```
bun run scripts/social-test-post.ts --channel x --asset <id> --i-mean-it
bun run scripts/social-test-post.ts --channel linkedin --asset <id> --i-mean-it
```

Without `--i-mean-it` the script prints `refused: --i-mean-it required` and exits 1. It never calls a platform: it
enqueues the channel's step job with `respect_window: false`, polls the `social_posts` row every 5 seconds for 180
seconds, and prints `posted <channel> <permalink>` or `failed <channel> <error>` (exit 1). The step it enqueues is built
in step 6, so a real run is UNPROVEN until then. After the launch switch the shared test-post guard exits 1 with
`refusing: production database` (not exercised here: `mop-dev` is not in production).

## Token refresh

Plan, built in step 5a, UNPROVEN: the access tokens expire (X about two hours, LinkedIn about 60 days, both to be read
from the token response). `getChannelToken` refreshes on demand before a post and stores the new pair in Vault through
`store_channel_token`, whose lock and refresh-hash compare stop two runs from overwriting each other. A refresh token
that X has rotated and that is used twice is refused, so a lost refresh token means a new consent with
`scripts/x-authorize.ts`. A daily check stores `token_expires_at` and `token_checked_at` in `settings.x` and
`settings.linkedin`; the channel card shows the days left, amber at 14 or fewer and red at 7 or fewer.

## invalid_grant

`invalid_grant` is the OAuth answer to a refresh token that is expired, revoked or already used. The plan treats it as a
dead token (step 5a, UNPROVEN until built): the post's row gets `error = 'token_dead'`, the channel turns red on screens
2 and 12, and the owner gets a `notify_admin` alert that says to run the authorize script again.

1. Run `bun run scripts/x-authorize.ts` (or `linkedin-authorize.ts`) as the owner of the handle or page. It prints
   `stored` and writes the new tokens to `.env`.
2. Store the new `X_ACCESS_TOKEN` and `X_REFRESH_TOKEN` (or the `LINKEDIN_` pair) as function secrets, from `.env`.
3. Once `--check` is built, run it and expect `x token ok <handle>` or `linkedin token ok <organization_urn>`.
4. Use Retry on the failed post on screen 12 (built in steps 6 and 8).

## version_expired

LinkedIn only (plan, UNPROVEN). Posting versions are dated headers that LinkedIn retires after about a year. The daily
check stores `token_state = 'version_expired'` when LinkedIn answers 426, `VERSION_MISSING` or `NONEXISTENT_VERSION`,
and the card turns amber with "API version expired". Read LinkedIn's changelog, choose the newest `YYYYMM` version, and
enter it as `api_version` in the Account ids form. Before that happens, the `linkedin_version` health check
(`src/server/jobs/system/health/providers.ts`) warns once `settings.linkedin.api_version` is 10 months old.
