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
