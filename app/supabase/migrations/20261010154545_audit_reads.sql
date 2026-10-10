-- down: drop function public.audit_usage(), public.audit_health(), public.audit_not_found(int, int), public.audit_record_run(uuid, public.actor_kind, text);
set lock_timeout = '5s';

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

create or replace function public.audit_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month constant date := date_trunc('month', now() at time zone 'utc')::date;
  v_sources jsonb;
begin
  -- B14 invariant 4 and G11: the inquiry sources once B15's attribution column exists, null before.
  if exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'inquiries' and c.column_name = 'attribution'
  ) then
    execute $q$
      select coalesce(jsonb_agg(to_jsonb(s) order by s.source), '[]'::jsonb)
      from (
        select
          coalesce(nullif(i.attribution -> 'first_touch' ->> 'utm_source', ''), '(none)') as source,
          count(*) filter (where i.received_at >= now() - interval '7 days') as count_7d,
          count(*) filter (where i.received_at < now() - interval '7 days') as count_prev_7d
        from public.inquiries i
        where i.received_at >= now() - interval '14 days'
        group by 1
      ) s
    $q$ into v_sources;
  end if;

  return jsonb_build_object(
    'assets_pending', (select count(*) from public.assets a where a.status = 'pending'),
    'channels', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'channel', c.channel,
        'enabled', c.enabled,
        'last_posted_at', (select max(p.posted_at) from public.social_posts p where p.channel = c.channel),
        'failed_7d', (
          select count(*) from public.social_posts p
          where p.channel = c.channel and p.status = 'failed' and p.updated_at >= now() - interval '7 days'
        )
      ) order by c.channel), '[]'::jsonb)
      from public.channel_settings c
    ),
    'posts_7d', (
      select count(*) from public.social_posts p where p.posted_at >= now() - interval '7 days'
    ),
    'newsletter', (
      select jsonb_build_object(
        'sent_30d', (
          select count(*) from public.newsletter_issues i
          where i.status = 'sent' and i.sent_at >= now() - interval '30 days'
        ),
        'last', (
          select jsonb_build_object(
            'number', i.number,
            'sent_at', i.sent_at,
            'recipients', (i.metrics ->> 'recipients')::int,
            'opened', (i.metrics ->> 'opened')::int
          )
          from public.newsletter_issues i
          where i.status = 'sent'
          order by i.sent_at desc nulls last
          limit 1
        )
      )
    ),
    -- B8 GD-03: a non-zero overdue means 30 days of runs removed nothing while rows of that age exist. A key with no
    -- age column here is judged by last_run_at alone (overdue null).
    'retention', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', r.key,
        'last_run_at', r.last_run_at,
        'last_count', r.last_count,
        'overdue', case r.key
          when 'rate_limits' then (select count(*) from public.rate_limits x where x.at < r.cutoff)
          when 'webhook_receipts' then (
            select count(*) from public.webhook_receipts x where x.received_at < r.cutoff
          )
          when 'subject_requests' then (
            select count(*) from public.subject_requests x
            where x.received_at < r.cutoff and x.status in ('fulfilled', 'rejected')
          )
          when 'jobs_done' then (
            select count(*) from public.jobs x where x.finished_at < r.cutoff and x.status in ('done', 'cancelled')
          )
          when 'jobs_dead' then (
            select count(*) from public.jobs x where x.finished_at < r.cutoff and x.status = 'dead'
          )
          when 'events_processed' then (
            select count(*) from public.events x where x.processed_at < r.cutoff
          )
          when 'inquiries_anonymise' then (
            select count(*) from public.inquiries x where x.received_at < r.cutoff and x.anonymised_at is null
          )
          when 'declined_submission_media' then (
            select count(*)
            from public.submission_media m
            join public.submissions s on s.id = m.submission_id
            where s.workflow_state = 'Declined' and s.reviewed_at < r.cutoff
          )
          when 'analytics_daily' then (
            select count(*) from public.analytics_daily x where x.day < r.cutoff::date
          )
        end
      ) order by r.key), '[]'::jsonb)
      from (
        select p.*, now() - (p.keep_for + interval '30 days') as cutoff
        from public.retention_policies p
        where p.enabled and p.action <> 'keep' and p.keep_for is not null and p.key <> 'analytics_events'
      ) r
    ),
    -- G11: p75 per path and metric over 7 days.
    'web_vitals', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'path', v.path, 'name', v.name, 'p75', v.p75, 'samples', v.samples
      ) order by v.path, v.name), '[]'::jsonb)
      from (
        select
          e.path,
          e.data ->> 'name' as name,
          percentile_cont(0.75) within group (order by (e.data ->> 'value')::float8) as p75,
          count(*) as samples
        from public.analytics_events e
        where e.event = 'web_vitals' and e.occurred_at >= now() - interval '7 days'
          and e.data ->> 'name' in ('LCP', 'CLS', 'INP')
          and jsonb_typeof(e.data -> 'value') = 'number'
        group by 1, 2
      ) v
    ),
    -- Ruling H16: 13 whole months from the daily aggregates, served by analytics_daily_event_day_idx.
    'analytics_trend', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'month', t.month, 'event', t.event, 'events', t.events
      ) order by t.month, t.event), '[]'::jsonb)
      from (
        select to_char(date_trunc('month', d.day), 'YYYY-MM') as month, d.event, sum(d.events)::int as events
        from public.analytics_daily d
        where d.day >= (v_month - interval '13 months')::date and d.day < v_month
        group by 1, 2
      ) t
    ),
    'inquiries_by_source', v_sources
  );
end;
$$;

revoke execute on function public.audit_health() from public, anon, authenticated;
grant execute on function public.audit_health() to service_role;

create or replace function public.audit_not_found(p_days int default 7, p_limit int default 20)
returns table (path text, count int, top_referrer_host text, redirected boolean)
language sql
stable
security definer
set search_path = ''
as $$
  -- B14 GG-02: the paths that answered 404, most asked first, read through analytics_events_event_occurred_idx.
  -- At most 90 days (the table's retention) and 50 paths (rule 9).
  with hits as (
    select e.path, e.data ->> 'referrer_host' as host
    from public.analytics_events e
    where e.event = 'not_found'
      and e.occurred_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90))
  ),
  top as (
    select h.path, count(*)::int as hits
    from hits h
    group by h.path
    order by count(*) desc, h.path
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  )
  select
    t.path,
    t.hits,
    (
      select h.host
      from hits h
      where h.path = t.path and h.host is not null
      group by h.host
      order by count(*) desc, h.host
      limit 1
    ),
    exists (select 1 from public.redirects r where r.from_path = t.path and r.archived_at is null)
      or exists (
        select 1 from public.slug_history s where s.slug = substring(t.path from '^/property/([^/]+)/?$')
      )
  from top t
  order by t.hits desc, t.path;
$$;

revoke execute on function public.audit_not_found(int, int) from public, anon, authenticated;
grant execute on function public.audit_not_found(int, int) to service_role;

create or replace function public.audit_record_run(p_actor uuid, p_actor_kind public.actor_kind, p_request_id text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old timestamptz;
  v_new timestamptz;
begin
  -- B14 G9, invariant 3: the auditor's one write. It moves only last_run_at of the audit row and sets no mop.actor_id,
  -- so B8b's revision trigger treats it as a clock tick; audit_log keeps the record.
  select s.last_run_at into v_old from public.schedule_settings s where s.key = 'audit' for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.schedule_settings set last_run_at = now() where key = 'audit' returning last_run_at into v_new;
  perform public.write_audit(
    p_actor, p_actor_kind, 'audit.record_run', 'schedule_settings.audit', null,
    jsonb_build_object('last_run_at', v_old), jsonb_build_object('last_run_at', v_new), p_request_id
  );
  return v_new;
end;
$$;

revoke execute on function public.audit_record_run(uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.audit_record_run(uuid, public.actor_kind, text) to service_role;
