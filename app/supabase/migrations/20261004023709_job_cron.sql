-- down: select cron.unschedule('job-runner'); the Vault rows job_runner_url and job_runner_secret stay (docs/runbooks/jobs.md).
set lock_timeout = '5s';

-- The job runner tick (architecture 5). Every minute pg_cron posts to the Edge Function with the URL and bearer read
-- from Vault when the job runs, so no secret is in a migration; docs/runbooks/jobs.md creates the two rows once per
-- environment. pg_net's 5 second default would cut the tick, hence 55 s (JOB-02). Unscheduling by name first lets the
-- file re-apply after db:reset (F16).
select cron.unschedule('job-runner')
where exists (select 1 from cron.job where jobname = 'job-runner');

select cron.schedule(
  'job-runner',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'job_runner_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'job_runner_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
