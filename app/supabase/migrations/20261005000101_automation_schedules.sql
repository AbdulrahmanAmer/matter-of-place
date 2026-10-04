-- down:
--   re-run the cron.schedule('prune', '30 3 * * *', ...) statement of 20261004060603_system_jobs.sql.
set lock_timeout = '5s';

-- B8b step 4: the job runner now drives prune from schedule_settings (invariant 11), so B8's fixed pg_cron entry goes
-- in the same migration set; two drivers would run it twice. job-runner, health, retention and meta_token_refresh stay.
select cron.unschedule('prune') where exists (select 1 from cron.job where jobname = 'prune');
