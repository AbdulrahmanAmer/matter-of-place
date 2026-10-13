-- down: re-run bun run db:fn apply_email_event health_counts from the previous commit of supabase/sql/functions/apply_email_event.sql, supabase/sql/functions/health_counts.sql
set lock_timeout = '5s';

create or replace function public.apply_email_event(p jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text := p ->> 'type';
  v_email text := lower(p ->> 'to_email');
  v_at timestamptz := coalesce((p ->> 'at')::timestamptz, now());
  v_data jsonb := coalesce(p -> 'data', '{}'::jsonb);
  v_rank int;
  v_suppress text;
begin
  -- Invariant 9: Resend sends every event of the account to every endpoint. A contact or broadcast event belongs here
  -- only when its audience is one of settings.resend.audiences (B11's key; without it every such event is dropped).
  if (v_type = 'contact.updated' or p ->> 'broadcast_id' is not null) and not exists (
    select 1
    from public.settings s
    cross join lateral jsonb_each_text(
      case when jsonb_typeof(s.value -> 'audiences') = 'object' then s.value -> 'audiences' else '{}'::jsonb end
    ) a
    where s.key = 'resend' and a.value = p ->> 'audience_id'
  ) then
    -- Gap audit item 22: a contact event about one of our own readers, dropped because its audience is not mapped,
    -- would leave an unsubscribe unrecorded. It is kept (without the address) and the health check counts it.
    if v_type = 'contact.updated' and v_email is not null and exists (
      select 1 from public.subscribers s where lower(s.email) = v_email
    ) then
      insert into public.audit_log (action, entity, after)
      values (
        'email.contact_event_dropped',
        'subscribers',
        jsonb_build_object(
          'audience_id', p ->> 'audience_id',
          'provider_event_id', p ->> 'provider_event_id',
          'unsubscribed', v_data -> 'unsubscribed'
        )
      );
    end if;
    return false;
  end if;

  insert into public.email_events (provider_event_id, type, resend_email_id, broadcast_id, to_email, at, data)
  values (p ->> 'provider_event_id', v_type, p ->> 'resend_email_id', p ->> 'broadcast_id', v_email, v_at, v_data)
  on conflict (provider_event_id) do nothing;
  if not found then
    return false;
  end if;

  -- Forward only: sent 1, delivered 2, bounced and complained 3. A queued, failed or skipped row never moves here.
  v_rank := case v_type
    when 'email.sent' then 1
    when 'email.delivered' then 2
    when 'email.bounced' then 3
    when 'email.complained' then 3
  end;
  if v_rank is not null then
    update public.email_messages m
    set status = substr(v_type, length('email.') + 1),
      delivered_at = case when v_type = 'email.delivered' then v_at else m.delivered_at end
    where m.resend_id = p ->> 'resend_email_id'
      and case m.status
        when 'sent' then 1
        when 'delivered' then 2
        when 'bounced' then 3
        when 'complained' then 3
      end < v_rank;
  end if;

  -- GG-05: a complaint, a permanent bounce, or the third transient bounce for one address within 30 days.
  v_suppress := case
    when v_type = 'email.complained' then 'complaint'
    when v_type = 'email.bounced' and v_data ->> 'bounce_type' = 'Permanent' then 'bounce'
    when v_type = 'email.bounced' and v_data ->> 'bounce_type' = 'Transient' and (
      select count(*)
      from public.email_events e
      where e.to_email = v_email
        and e.type = 'email.bounced'
        and e.data ->> 'bounce_type' = 'Transient'
        and e.at between v_at - interval '30 days' and v_at
    ) >= 3 then 'bounce'
  end;
  if v_suppress is not null and v_email is not null then
    insert into public.email_suppressions (email, reason, at)
    values (v_email, v_suppress, now())
    on conflict (email) do nothing;
  end if;

  -- Opens are not engagement (mail privacy features fire them); a click is.
  if v_type = 'email.clicked' and v_email is not null then
    update public.subscribers set last_engaged_at = now() where lower(email) = v_email;
  end if;

  -- An unsubscribe from a Place Notes issue; the cleared hash makes an older confirm link answer confirmed=0 (DL-06).
  if v_type = 'contact.updated' and v_data -> 'unsubscribed' = 'true'::jsonb and v_email is not null then
    update public.subscribers
    set unsubscribed_at = now(), confirm_token_hash = null, pending_source = null
    where lower(email) = v_email and unsubscribed_at is null;
  end if;

  return true;
end;
$$;

revoke execute on function public.apply_email_event(jsonb) from public, anon, authenticated;
grant execute on function public.apply_email_event(jsonb) to service_role;

create or replace function public.health_counts(p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_backup jsonb;
  v_last_run jsonb;
begin
  -- B8b's schedule_settings: the backup row is read once the table exists, and is null before (PERF-09, SEC-11).
  if to_regclass('public.schedule_settings') is not null then
    execute $q$
      select jsonb_build_object('enabled', enabled, 'last_run_at', last_run_at)
      from public.schedule_settings
      where key = 'backup'
    $q$ into v_backup;
  end if;
  select a.after into v_last_run
  from public.audit_log a
  where a.action = 'retention.run' and a.entity = 'retention'
  order by a.at desc, a.id desc
  limit 1;
  -- A local job waits for the laptop by design (ruling H34 (2)): it is kept out of stale_queue and long_waits and
  -- reported as local_oldest_age_s instead.
  return jsonb_build_object(
    'dead_jobs_24h', (
      select count(*) from public.jobs where status = 'dead' and finished_at > p_now - interval '24 hours'
    ),
    'stale_queue', (
      select count(*) from public.jobs
      where status = 'queued' and not run_local and run_after < p_now - interval '15 minutes'
    ),
    'retention_stalled', coalesce((
      select jsonb_agg(p.key order by p.key)
      from public.retention_policies p
      where p.enabled and p.action <> 'keep'
        and (
          -- A policy that never ran counts as stalled two days after it was written, not on its first day (gap 17).
          (p.last_run_at is null and p.updated_at < p_now - interval '2 days')
          or p.last_run_at < p_now - interval '2 days'
          or coalesce((v_last_run -> p.key ->> 'remaining')::int, 0) > 0
        )
    ), '[]'::jsonb),
    'long_waits', (
      select count(*) from public.jobs
      where status in ('queued', 'failed') and not run_local and created_at < p_now - interval '7 days'
    ),
    'local_oldest_age_s', (
      select floor(extract(epoch from p_now - min(created_at)))::bigint
      from public.jobs
      where run_local and status in ('queued', 'failed')
    ),
    'backup', v_backup,
    -- Gap audit item 7: public writes let in without a passed Turnstile check (Cloudflare unreachable) in 24 hours.
    'unverified_24h', (
      (select count(*) from public.submissions where not turnstile_ok and received_at > p_now - interval '24 hours')
      + (select count(*) from public.inquiries where not turnstile_ok and received_at > p_now - interval '24 hours')
      + (select count(*) from public.subject_requests where not turnstile_ok and received_at > p_now - interval '24 hours')
    ),
    -- Gap audit item 22: contact events about our own readers dropped for an unmapped audience, in 24 hours.
    'dropped_contact_events_24h', (
      select count(*) from public.audit_log
      where action = 'email.contact_event_dropped' and at > p_now - interval '24 hours'
    ),
    -- Gap audit item 29: open privacy requests due within 7 days, or past due.
    'privacy_due_7d', (
      select count(*) from public.subject_requests
      where status in ('received', 'verifying') and due_at < p_now + interval '7 days'
    )
  );
end;
$$;

revoke execute on function public.health_counts(timestamptz) from public, anon, authenticated;
grant execute on function public.health_counts(timestamptz) to service_role;
