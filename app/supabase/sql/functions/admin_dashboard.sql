create or replace function public.admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Screen 2 (B7 step 9, invariant 17d): every tile in one call. A table a later slice creates is read through
  -- `execute` only once it exists, so this function needs no change when that slice lands.
  v_day constant timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_assets_pending int := 0;
  v_withdraw jsonb := jsonb_build_object('open', 0, 'oldest_at', null);
begin
  if to_regclass('public.assets') is not null then
    execute 'select count(*)::int from public.assets where status = ''pending'''
    into v_assets_pending;
  end if;

  -- E2E-01: live posts a takedown left to withdraw by hand (B10's columns). No row of pg_attribute matches while
  -- the table is absent, because to_regclass is then null.
  if exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = to_regclass('public.social_posts')
      and a.attname in ('withdraw_required_at', 'withdrawn_at')
      and not a.attisdropped
    having count(*) = 2
  ) then
    execute 'select jsonb_build_object(''open'', count(*)::int, ''oldest_at'', min(withdraw_required_at))
      from public.social_posts where withdraw_required_at is not null and withdrawn_at is null'
    into v_withdraw;
  end if;

  return jsonb_build_object(
    'counts', (
      select coalesce(jsonb_object_agg(c.workflow_state, c.count), '{}'::jsonb)
      from public.dashboard_counts c
    ),
    'jobs', (
      select jsonb_build_object(
        'failed_24h', count(*) filter (where j.status = 'failed' and j.updated_at >= now() - interval '24 hours'),
        'dead', count(*) filter (where j.status = 'dead')
      )
      from public.jobs j
      where j.status in ('failed', 'dead')
    ),
    'assets_pending', v_assets_pending,
    'digest_next_at', (
      select s.next_run_at from public.schedule_settings s where s.key = 'digest' and s.enabled
    ),
    -- The last health run that finished: failed when the job itself failed or any of its checks did.
    'health', (
      select jsonb_build_object(
        'at', coalesce(j.finished_at, j.updated_at),
        'failed_checks', coalesce((
          select jsonb_agg(c.value ->> 'name')
          from jsonb_array_elements(coalesce(j.result -> 'checks', '[]'::jsonb)) c
          where c.value ->> 'status' = 'fail'
        ), '[]'::jsonb),
        'failed', j.status <> 'done' or exists (
          select 1
          from jsonb_array_elements(coalesce(j.result -> 'checks', '[]'::jsonb)) c
          where c.value ->> 'status' = 'fail'
        )
      )
      from public.jobs j
      where j.type = 'health' and j.status in ('done', 'failed', 'dead')
      order by j.created_at desc
      limit 1
    ),
    -- Architecture 8: the bounce rate is bounced or complained over sent, both over the last seven days.
    'email', (
      select jsonb_build_object(
        'sent_today', public.email_sent_today(),
        'sent_month', public.email_sent_month(),
        'sent_7d', count(*),
        'bounced_7d', count(*) filter (where m.status in ('bounced', 'complained'))
      )
      from public.email_messages m
      where m.sent_at >= now() - interval '7 days'
    ),
    'database_bytes', pg_catalog.pg_database_size(pg_catalog.current_database()),
    -- Ruling H33 (8): the three buckets share the 1 GB of the free plan.
    'storage', (
      select jsonb_build_object('bytes', coalesce(sum((o.metadata ->> 'size')::bigint), 0))
      from storage.objects o
      where o.bucket_id in ('submissions', 'media', 'documents')
    ),
    'withdraw', v_withdraw,
    -- What happened today: the newest twenty audit rows, kept when they are from the current UTC day.
    'today', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id,
        'at', a.at,
        'action', a.action,
        'entity', a.entity,
        'entity_id', a.entity_id,
        'actor_id', a.actor_id,
        'actor_kind', a.actor_kind,
        'actor_name', (
          select max(r.display_name) from public.user_roles r where r.user_id = a.actor_id
        )
      ) order by a.id desc), '[]'::jsonb)
      from (select * from public.audit_log l order by l.id desc limit 20) a
      where a.at >= v_day
    )
  );
end;
$$;

revoke execute on function public.admin_dashboard() from public, anon, authenticated;
grant execute on function public.admin_dashboard() to service_role;
