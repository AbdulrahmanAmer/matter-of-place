# supabase/functions

Edge Functions for light work on the free tier: the pg_cron job runner that drains the `jobs` queue (pgmq), the keep-warm ping that stops the project pausing after seven idle days, and digest assembly for Place Notes. Heavy renders (image variants, PNG covers, ffmpeg reels) do not run here; they are dispatched to GitHub Actions and write back through a signed endpoint.
