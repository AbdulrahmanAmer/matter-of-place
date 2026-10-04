-- down:
--   select cron.unschedule('retention'); select cron.unschedule('meta_token_refresh');
--   delete from public.retention_policies where key in ('jobs_dead', 'events_processed', 'analytics_daily',
--     'cron_history', 'job_wait_events', 'accepted_submission_media');
--   drop function public.meta_token_record(timestamptz, text, text[], timestamptz, timestamptz, text),
--     public.set_vault_secret(text, text), public.get_vault_secret(text), public.retention_log_run(jsonb),
--     public.retention_anonymise_contacts(interval, boolean), public.retention_drop_analytics(boolean),
--     public.retention_anonymise_email(boolean), public.retention_anonymise_inquiries(interval, boolean),
--     public.retention_delete_media(uuid[]), public.retention_accepted_media(interval),
--     public.retention_declined_media(interval), public.rollup_analytics_daily(date, date);
--   re-apply the retention_delete_rows text of 20261004060603_system_jobs.sql;
--   drop table public.analytics_daily;
--   drop trigger submissions_set_updated_at on public.submissions;
--   alter table public.submissions drop column updated_at; alter table public.inquiries drop column anonymised_at;
--   Storage objects and rows the job removed stay removed.
set lock_timeout = '5s';

-- B8 step 8a: retention (GD-03), the analytics aggregates (ruling H16) and the Meta token check (GS-01, INT-06).
-- retention.ts is the only code that hard-deletes; every period is a policy row's keep_for.

-- G-004: the domain, the API and the column change together; B7's screen 11 shows the "anonymised" label.
alter table public.inquiries add column if not exists anonymised_at timestamptz;

-- The mutable-table rule of architecture 3: a withdrawn request's media go 90 days after its last change (DL-04),
-- and a person's last request is the newest change of their requests (S55). Existing rows start at this migration.
alter table public.submissions add column if not exists updated_at timestamptz not null default now();
create trigger submissions_set_updated_at
before update on public.submissions
for each row execute function public.set_updated_at();

-- Ruling H16: the daily aggregates, kept 13 months. B8 owns the table because its retention job is the only writer;
-- B14's reports read it. dim is the web vital's name, the CSP directive, or '' for every other event.
create table public.analytics_daily (
  day date not null,
  event text not null,
  path text not null,
  dim text not null default '',
  events int not null,
  p75 numeric,
  primary key (day, event, path, dim)
);
create index analytics_daily_event_day_idx on public.analytics_daily (event, day desc);

alter table public.analytics_daily enable row level security;
revoke all on table public.analytics_daily from anon, authenticated;
grant select on table public.analytics_daily to authenticated;
grant all on table public.analytics_daily to service_role;
create policy analytics_daily_select_staff on public.analytics_daily for select to authenticated
using (app.is_staff());

-- The function texts below are copied verbatim from supabase/sql/functions/<name>.sql (DB-13).
create or replace function public.rollup_analytics_daily(p_from date, p_to date)
returns int
language sql
security definer
set search_path = ''
as $$
  -- Ruling H16: the daily aggregates of the raw events from p_from to p_to, UTC days. A rerun recomputes the same
  -- numbers from the raw rows and never counts them twice; a day whose raw rows are gone writes nothing and keeps its
  -- aggregate. p75 is the 75th percentile of a web vital's value, null for every other event.
  with written as (
    insert into public.analytics_daily (day, event, path, dim, events, p75)
    select (occurred_at at time zone 'utc')::date,
      event,
      path,
      case event
        when 'web_vitals' then coalesce(data ->> 'name', '')
        when 'csp_report' then coalesce(data ->> 'directive', '')
        else ''
      end,
      count(*),
      (percentile_cont(0.75) within group (
        order by case when data ->> 'value' ~ '^-?[0-9]+(\.[0-9]+)?$' then (data ->> 'value')::numeric end
      ) filter (where event = 'web_vitals'))::numeric
    from public.analytics_events
    where occurred_at >= p_from::timestamp at time zone 'utc'
      and occurred_at < (p_to + 1)::timestamp at time zone 'utc'
    group by 1, 2, 3, 4
    on conflict (day, event, path, dim) do update set events = excluded.events, p75 = excluded.p75
    returning 1
  )
  select count(*)::int from written;
$$;

revoke execute on function public.rollup_analytics_daily(date, date) from public, anon, authenticated;
grant execute on function public.rollup_analytics_daily(date, date) to service_role;

create or replace function public.retention_declined_media(p_keep interval)
returns table (media_id uuid, storage_path text)
language sql
stable
security definer
set search_path = ''
as $$
  -- GD-03, DL-04: the uploads of a declined request after p_keep from its review, and of a withdrawn one after p_keep
  -- from its last change (a terminal row is not edited again). It lists only; retention.ts removes the files and then
  -- the rows whose files are gone.
  select m.id, m.storage_path
  from public.submission_media m
  join public.submissions s on s.id = m.submission_id
  where (s.workflow_state = 'Declined' and s.reviewed_at < now() - p_keep)
    or (s.workflow_state = 'Withdrawn' and s.updated_at < now() - p_keep)
  order by m.id;
$$;

revoke execute on function public.retention_declined_media(interval) from public, anon, authenticated;
grant execute on function public.retention_declined_media(interval) to service_role;

create or replace function public.retention_accepted_media(p_keep interval)
returns table (media_id uuid, storage_path text)
language sql
stable
security definer
set search_path = ''
as $$
  -- PERF-08 (c), ruling H33 (8): a request's originals never leave the submissions bucket, so they go once its
  -- property has photographs and every one has its variants in the media bucket (media_key set, nothing staged), and
  -- no copy of the request's photographs is still to finish. It lists only, like retention_declined_media.
  select m.id, m.storage_path
  from public.submission_media m
  join public.submissions s on s.id = m.submission_id
  join public.properties p on p.submission_id = s.id
  where s.reviewed_at < now() - p_keep
    and exists (select 1 from public.property_media pm where pm.property_id = p.id)
    and not exists (
      select 1 from public.property_media pm
      where pm.property_id = p.id and (pm.media_key is null or pm.staging_path is not null)
    )
    and not exists (
      select 1 from public.jobs j
      where j.type = 'copy_submission_media'
        and j.payload -> 'data' ->> 'property_id' = p.id::text
        and j.status not in ('done', 'cancelled')
    )
  order by m.id;
$$;

revoke execute on function public.retention_accepted_media(interval) from public, anon, authenticated;
grant execute on function public.retention_accepted_media(interval) to service_role;

create or replace function public.retention_delete_media(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  -- GD-03: retention.ts passes only the ids whose Storage objects are already removed.
  perform set_config('mop.retention', 'on', true);
  with gone as (
    delete from public.submission_media where id = any(p_ids) returning 1
  )
  select count(*)::int into v_count from gone;
  perform set_config('mop.retention', 'off', true);
  return v_count;
end;
$$;

revoke execute on function public.retention_delete_media(uuid[]) from public, anon, authenticated;
grant execute on function public.retention_delete_media(uuid[]) to service_role;

create or replace function public.retention_anonymise_inquiries(p_keep interval, p_dry_run boolean default false)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  -- G23: an inquiry older than p_keep keeps its row for the counts and loses what names a person. name and message are
  -- not null, so they become ''; the address becomes a hash no one can write to.
  select coalesce(array_agg(id), '{}') into v_ids
  from public.inquiries
  where received_at < now() - p_keep and anonymised_at is null;
  if p_dry_run then
    return cardinality(v_ids);
  end if;
  update public.inquiries
  set name = '',
    message = '',
    phone = null,
    location = null,
    details = '{}'::jsonb,
    forwarded_payload = null,
    email = encode(sha256(convert_to(email, 'UTF8')), 'hex') || '@anonymised.invalid',
    anonymised_at = now()
  where id = any(v_ids);
  -- B15 adds attribution; until then the column does not exist.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inquiries' and column_name = 'attribution'
  ) then
    execute 'update public.inquiries set attribution = ''{}''::jsonb where id = any($1)' using v_ids;
  end if;
  -- G16: a webhook job of the inquiry keeps no copy of its body.
  update public.jobs
  set result = result - 'body'
  where type = 'webhook_omnikom'
    and payload -> 'data' ->> 'inquiry_id' = any(v_ids::text[])
    and result ? 'body';
  return cardinality(v_ids);
end;
$$;

revoke execute on function public.retention_anonymise_inquiries(interval, boolean) from public, anon, authenticated;
grant execute on function public.retention_anonymise_inquiries(interval, boolean) to service_role;

-- retention_delete_rows gains six keys: jobs_dead, events_processed, unconfirmed_subscribers, cron_history,
-- analytics_daily and job_wait_events (G16, rulings H15 and H16, JOB-10).
create or replace function public.retention_delete_rows(p_key text, p_dry_run boolean default false)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows text;
  v_keep interval;
  v_count int;
begin
  -- GD-03: the allow-list of plain row deletes, each with its table and filter; any other key raises, so a kept table
  -- such as audit_log can never be named here. $1 is the policy row's keep_for.
  v_rows := case p_key
    when 'rate_limits' then 'public.rate_limits where at < now() - $1'
    when 'webhook_receipts' then 'public.webhook_receipts where received_at < now() - $1'
    when 'subject_requests' then
      $r$public.subject_requests where status in ('fulfilled', 'rejected') and received_at < now() - $1$r$
    -- G16: a dead job goes with its job_events by the foreign key's cascade.
    when 'jobs_dead' then $r$public.jobs where status = 'dead' and finished_at < now() - $1$r$
    -- G16: an event goes only once no job points at it, so jobs_dead runs first.
    when 'events_processed' then
      $r$public.events e where e.processed_at is not null and e.processed_at < now() - $1
        and not exists (select 1 from public.jobs j where j.event_id = e.id)$r$
    when 'unconfirmed_subscribers' then
      'public.subscribers where confirmed_at is null and created_at < now() - $1'
    -- Ruling H15, PERF-02: pg_cron's run history.
    when 'cron_history' then 'cron.job_run_details where end_time < now() - $1'
    -- Ruling H16: the daily aggregates, by UTC day.
    when 'analytics_daily' then
      $r$public.analytics_daily where day < ((now() at time zone 'utc') - $1)::date$r$
    -- JOB-10: the claimed and requeued rows of a job still waiting, keeping its newest row of each kind.
    when 'job_wait_events' then
      $r$public.job_events je where je.kind in ('claimed', 'requeued') and je.at < now() - $1
        and exists (select 1 from public.jobs j where j.id = je.job_id and j.status in ('queued', 'failed'))
        and je.id < (select max(n.id) from public.job_events n where n.job_id = je.job_id and n.kind = je.kind)$r$
  end;
  if v_rows is null then
    raise exception 'bad_request';
  end if;
  select keep_for into v_keep
  from public.retention_policies
  where key = p_key and enabled and keep_for is not null;
  if not found then
    return 0;
  end if;
  if p_dry_run then
    execute 'select count(*)::int from ' || v_rows into v_count using v_keep;
    return v_count;
  end if;
  perform set_config('mop.retention', 'on', true);
  execute 'with gone as (delete from ' || v_rows || ' returning 1) select count(*)::int from gone'
    into v_count using v_keep;
  perform set_config('mop.retention', 'off', true);
  update public.retention_policies set last_run_at = now(), last_count = v_count where key = p_key;
  return v_count;
end;
$$;

revoke execute on function public.retention_delete_rows(text, boolean) from public, anon, authenticated;
grant execute on function public.retention_delete_rows(text, boolean) to service_role;

create or replace function public.retention_anonymise_email(p_dry_run boolean default false)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keep interval;
  v_count int;
begin
  -- G16, G43: the recipient address of a sent email goes after the email_pii period. B5 creates the two tables and the
  -- row, so this answers 0 until both exist; execute lets the function compile before them.
  select keep_for into v_keep
  from public.retention_policies
  where key = 'email_pii' and enabled and keep_for is not null;
  if not found or to_regclass('public.email_messages') is null then
    return 0;
  end if;
  if p_dry_run then
    execute $q$
      select (select count(*) from public.email_messages where to_email is not null and created_at < now() - $1)
        + (select count(*) from public.email_events where to_email is not null and at < now() - $1)
    $q$ into v_count using v_keep;
    return v_count;
  end if;
  execute $q$
    with messages as (
      update public.email_messages set to_email = null
      where to_email is not null and created_at < now() - $1
      returning 1
    ),
    events as (
      update public.email_events set to_email = null
      where to_email is not null and at < now() - $1
      returning 1
    )
    select (select count(*) from messages) + (select count(*) from events)
  $q$ into v_count using v_keep;
  update public.retention_policies set last_run_at = now(), last_count = v_count where key = 'email_pii';
  return v_count;
end;
$$;

revoke execute on function public.retention_anonymise_email(boolean) from public, anon, authenticated;
grant execute on function public.retention_anonymise_email(boolean) to service_role;

create or replace function public.retention_drop_analytics(p_dry_run boolean default false)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keep interval;
  v_months int;
  v_cutoff timestamptz;
  v_part record;
  v_count int := 0;
begin
  -- Ruling H16, PERF-02: whole monthly partitions go once older than the analytics_events period, each rolled up into
  -- analytics_daily first. 90 days gives 3 months, so a raw row lives at least 90 days and at most about 120.
  select keep_for into v_keep
  from public.retention_policies
  where key = 'analytics_events' and enabled and keep_for is not null;
  if not found then
    return 0;
  end if;
  v_months := ceil(extract(epoch from v_keep) / 2592000)::int;
  v_cutoff := (date_trunc('month', now() at time zone 'UTC') - make_interval(months => v_months)) at time zone 'UTC';
  for v_part in
    select substring(pg_get_expr(c.relpartbound, c.oid) from 'FROM \(''([^'']+)''\)')::timestamptz as lower_bound,
      substring(pg_get_expr(c.relpartbound, c.oid) from 'TO \(''([^'']+)''\)')::timestamptz as upper_bound
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    where i.inhparent = 'public.analytics_events'::regclass
      and c.relname ~ '^analytics_events_y[0-9]{4}m[0-9]{2}$'
  loop
    if v_part.upper_bound <= v_cutoff then
      v_count := v_count + 1;
      if not p_dry_run then
        perform public.rollup_analytics_daily(
          (v_part.lower_bound at time zone 'UTC')::date, (v_part.upper_bound at time zone 'UTC')::date - 1
        );
      end if;
    end if;
  end loop;
  if p_dry_run then
    return v_count;
  end if;
  return public.drop_old_analytics_partitions(v_months);
end;
$$;

revoke execute on function public.retention_drop_analytics(boolean) from public, anon, authenticated;
grant execute on function public.retention_drop_analytics(boolean) to service_role;

create or replace function public.retention_anonymise_contacts(p_keep interval, p_dry_run boolean default false)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  -- S55: a person with no open request and no published property, whose last request (or the contact itself, with
  -- none) is older than p_keep, loses what names them; the same columns as B7's delete_subject.
  select coalesce(array_agg(c.id), '{}') into v_ids
  from public.contacts c
  where c.archived_at is null
    and coalesce(
      (select max(s.updated_at) from public.submissions s where s.contact_id = c.id), c.updated_at
    ) < now() - p_keep
    and not exists (
      select 1 from public.submissions s
      where s.contact_id = c.id and s.workflow_state not in ('Declined', 'Withdrawn', 'Completed')
    )
    and not exists (
      select 1 from public.submissions s
      join public.properties p on p.submission_id = s.id
      where s.contact_id = c.id and p.editorial_state = 'published'
    );
  if p_dry_run then
    return cardinality(v_ids);
  end if;
  update public.submissions s
  set submitter_name = '',
    submitter_email = encode(sha256(convert_to(c.email, 'UTF8')), 'hex') || '@anonymised.invalid',
    submitter_phone = null,
    listing_agent_name = null
  from public.contacts c
  where c.id = s.contact_id and c.id = any(v_ids);
  update public.contacts
  set name = '',
    email = encode(sha256(convert_to(email, 'UTF8')), 'hex') || '@anonymised.invalid',
    phone = null,
    brokerage = null,
    notes = null,
    archived_at = now()
  where id = any(v_ids);
  update public.retention_policies
  set last_run_at = now(), last_count = cardinality(v_ids)
  where key = 'contacts_anonymise';
  return cardinality(v_ids);
end;
$$;

revoke execute on function public.retention_anonymise_contacts(interval, boolean) from public, anon, authenticated;
grant execute on function public.retention_anonymise_contacts(interval, boolean) to service_role;

create or replace function public.retention_log_run(p_after jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  -- G43: the one audit row of a retention run, written by the system (no actor), with { <policy key>: { affected,
  -- remaining } }; each named policy row records the run, which the health check's retention_stalled reads.
  insert into public.audit_log (action, entity, entity_id, actor_id, actor_kind, after)
  values ('retention.run', 'retention', null, null, null, p_after)
  returning id into v_id;
  update public.retention_policies p
  set last_run_at = now(), last_count = (p_after -> p.key ->> 'affected')::int
  where p_after ? p.key;
  return v_id;
end;
$$;

revoke execute on function public.retention_log_run(jsonb) from public, anon, authenticated;
grant execute on function public.retention_log_run(jsonb) to service_role;

create or replace function public.get_vault_secret(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- GS-01: the tokens a job refreshes live in Vault; only these names can be read, any other raises.
  if p_name not in ('meta_page_token', 'x_oauth_token', 'linkedin_oauth_token') then
    raise exception 'forbidden';
  end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = p_name);
end;
$$;

revoke execute on function public.get_vault_secret(text) from public, anon, authenticated;
grant execute on function public.get_vault_secret(text) to service_role;

create or replace function public.set_vault_secret(p_name text, p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- GS-01: the writer of get_vault_secret's names; any other name raises.
  if p_name not in ('meta_page_token', 'x_oauth_token', 'linkedin_oauth_token') then
    raise exception 'forbidden';
  end if;
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    perform vault.create_secret(p_value, p_name);
  else
    perform vault.update_secret(v_id, p_value);
  end if;
end;
$$;

revoke execute on function public.set_vault_secret(text, text) from public, anon, authenticated;
grant execute on function public.set_vault_secret(text, text) to service_role;

create or replace function public.meta_token_record(
  p_checked_at timestamptz,
  p_token_state text,
  p_missing_scopes text[],
  p_expires_at timestamptz default null,
  p_data_access_expires_at timestamptz default null,
  p_new_token text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- INT-06: what the daily check read about the Meta token, merged into settings.meta (an admin key, so no catalog
  -- bump, G21). A null expiry means never; the two dates come last with defaults, so a caller leaves a null one out.
  -- A refreshed token goes to Vault with its one secret.rotated row in the same transaction. Two runs never write at
  -- once: the second answers locked (G21).
  if p_token_state not in ('ok', 'dead', 'scopes_missing') then
    raise exception 'invalid_token_state';
  end if;
  if not pg_try_advisory_xact_lock(hashtext('meta_page_token')) then
    return 'locked';
  end if;
  update public.settings
  set value = value || jsonb_build_object(
    'token_expires_at', p_expires_at,
    'token_checked_at', p_checked_at,
    'token_state', p_token_state,
    'missing_scopes', to_jsonb(p_missing_scopes),
    'data_access_expires_at', p_data_access_expires_at
  )
  where key = 'meta';
  if p_new_token is not null then
    perform public.set_vault_secret('meta_page_token', p_new_token);
    insert into public.audit_log (action, entity, actor_id, actor_kind)
    values ('secret.rotated', 'META_PAGE_TOKEN', null, null);
  end if;
  return 'ok';
end;
$$;

revoke execute on function public.meta_token_record(timestamptz, text, text[], timestamptz, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.meta_token_record(timestamptz, text, text[], timestamptz, timestamptz, text)
  to service_role;

-- G16, G43: the rows of the tables B8 creates, and of the three rules it runs on tables it does not own (rulings H15,
-- H16 and H33 (8), JOB-10, PERF-02, PERF-08). on conflict keeps an edited row.
insert into public.retention_policies (key, table_name, keep_for, action, note)
values
  ('jobs_dead', 'jobs', interval '90 days', 'delete', 'Dead jobs after finished_at, with their job_events.'),
  (
    'events_processed', 'events', interval '180 days', 'delete',
    'Processed events after processed_at, once no job points at them.'
  ),
  ('analytics_daily', 'analytics_daily', interval '13 months', 'delete', 'Daily aggregates, by UTC day.'),
  ('cron_history', 'cron.job_run_details', interval '7 days', 'delete', 'pg_cron run history, after end_time.'),
  (
    'job_wait_events', 'job_events', interval '14 days', 'delete',
    'Claimed and requeued rows of a job still waiting; its newest row of each kind stays.'
  ),
  (
    'accepted_submission_media', 'submission_media', interval '0 days', 'delete',
    'Originals of an accepted request once every photograph of its property has its variants.'
  )
on conflict (key) do nothing;

-- Daily system jobs keyed `<type>:<UTC date>` (invariant 1). Fixed pg_cron rows, not schedule_settings rows: that
-- table's key check has no retention or meta_token_refresh value, and B8b leaves both scheduled.
select cron.unschedule('retention') where exists (select 1 from cron.job where jobname = 'retention');
select cron.schedule(
  'retention',
  '45 3 * * *',
  $$select public.enqueue_job('retention', '{"params": {}, "data": {}}'::jsonb,
    'retention:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'))$$
);

select cron.unschedule('meta_token_refresh') where exists (select 1 from cron.job where jobname = 'meta_token_refresh');
select cron.schedule(
  'meta_token_refresh',
  '15 4 * * *',
  $$select public.enqueue_job('meta_token_refresh', '{"params": {}, "data": {}}'::jsonb,
    'meta_token_refresh:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), p_max_attempts => 12)$$
);
