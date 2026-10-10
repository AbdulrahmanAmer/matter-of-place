create or replace function public.audit_usage()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  -- B14 invariant 4: the numbers of the free-tier gauge table our own database can measure, one call per run.
  select jsonb_build_object(
    'db_bytes', pg_catalog.pg_database_size(pg_catalog.current_database()),
    -- Ruling H33 (8): the three buckets share the 1 GB of the free plan.
    'storage_bytes', (
      select coalesce(sum((o.metadata ->> 'size')::bigint), 0)
      from storage.objects o
      where o.bucket_id in ('submissions', 'media', 'documents')
    ),
    'queues', (
      select coalesce(jsonb_object_agg(m.queue_name, m.queue_length), '{}'::jsonb)
      from pgmq.metrics_all() m
    ),
    'cron_failed_7d', public.health_cron_failures(now() - interval '7 days'),
    'jobs_failed_7d', (
      select count(*)
      from public.jobs j
      where j.status in ('failed', 'dead') and j.updated_at >= now() - interval '7 days'
    ),
    'email_sent_today', public.email_sent_today(),
    -- The sum B11's quota check compares with 2,700: rows Resend accepted plus broadcast recipients, dry runs skipped.
    'email_sent_month', public.email_sent_month(),
    'subscribers_confirmed', (
      select count(*)
      from public.subscribers s
      where s.confirmed_at is not null and s.unsubscribed_at is null and s.archived_at is null
    ),
    -- G2, ruling H34: tokens only, the captions run through the operator's own account and carry no price.
    'model_usage_month', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'model', u.model,
        'input_tokens', u.input_tokens,
        'output_tokens', u.output_tokens,
        'jobs', u.jobs
      ) order by u.model), '[]'::jsonb)
      from (
        select
          j.result -> 'usage' ->> 'model' as model,
          coalesce(sum((j.result -> 'usage' ->> 'input_tokens')::bigint), 0) as input_tokens,
          coalesce(sum((j.result -> 'usage' ->> 'output_tokens')::bigint), 0) as output_tokens,
          count(*) as jobs
        from public.jobs j
        where j.type = 'write_captions' and j.status = 'done'
          and j.finished_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
          and j.result -> 'usage' ->> 'model' is not null
        group by 1
      ) u
    ),
    -- G30: a guideline, never a cap.
    'reels_month', (
      select count(*)
      from public.jobs j
      where j.type = 'render_reel' and j.status = 'done'
        and j.finished_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
    )
  );
$$;

revoke execute on function public.audit_usage() from public, anon, authenticated;
grant execute on function public.audit_usage() to service_role;
