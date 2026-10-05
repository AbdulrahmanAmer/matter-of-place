-- down:
--   drop function public.lapse_subscribers(interval), public.issue_repermission(uuid, text),
--     public.repermission_candidates(int), public.apply_email_event(jsonb),
--     public.email_message_finish(uuid, text, text, text),
--     public.email_message_begin(uuid, text, text, text, text, text, uuid, text), public.email_sent_month(),
--     public.email_sent_today();
--   drop trigger subscribers_engagement on public.subscribers; drop function public.subscribers_engagement();
--   alter table public.subscribers drop column last_engaged_at, drop column repermission_sent_at;
--   alter table public.email_templates drop column class;
--   delete from public.retention_policies where key = 'email_pii';
--   delete from public.pii_columns where table_name in ('email_messages', 'email_events', 'email_suppressions');
--   drop table public.email_events, public.email_suppressions, public.email_messages;
-- contract-of: 20261004115859
set lock_timeout = '5s';

-- B5 step 2: the tables of the send path, the send class of every template, the engagement columns of GG-05 and the
-- functions the application writes these tables through (G43). Seeds are in <ts>_email_templates_seed.sql.

-- INT-03: one send class per template, no default. The table is still empty when this runs (B5's seed is the first
-- row), and no code inserts into it (B8b's put and restore functions only update), so the Worker before this release
-- keeps working; the contract-of header names the migration that created the table (R17).
alter table public.email_templates
  add column class text not null check (class in ('transactional', 'alert', 'bulk'));

-- Invariant 4: one row per job and recipient, updated in place across attempts. job_id survives B8's prune of done
-- jobs as null; to_email is cleared by B8's retention after the email_pii period.
create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  kind text not null check (kind in ('transactional', 'alert', 'bulk', 'test')),
  to_email text,
  subject text,
  content_hash text,
  resend_id text unique,
  status text not null default 'queued' check (
    status in ('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'skipped')
  ),
  job_id uuid references public.jobs (id) on delete set null,
  entity text,
  entity_id uuid,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz
);
create unique index email_messages_job_to_key on public.email_messages (job_id, to_email);
create index email_messages_sent_at_idx on public.email_messages (sent_at);
create index email_messages_to_email_idx on public.email_messages (to_email);

-- Invariant 9: kept for good, so a suppression outlives the message that caused it.
create table public.email_suppressions (
  email text primary key check (email = lower(email)),
  reason text not null check (reason in ('bounce', 'complaint', 'manual')),
  at timestamptz not null default now()
);

-- Invariant 9: one row per verified Resend event; provider_event_id is the svix id, so a replay writes nothing.
create table public.email_events (
  id bigint generated always as identity primary key,
  provider_event_id text not null unique,
  type text not null,
  resend_email_id text,
  broadcast_id text,
  to_email text,
  at timestamptz not null,
  data jsonb not null default '{}'
);
create index email_events_resend_email_id_idx on public.email_events (resend_email_id);
create index email_events_broadcast_id_idx on public.email_events (broadcast_id);

-- GG-05: engagement is a confirm or a click; repermission_sent_at marks an open ask.
alter table public.subscribers add column last_engaged_at timestamptz, add column repermission_sent_at timestamptz;

-- Architecture 3.7: every staff role reads; only the service role writes, through the functions below.
alter table public.email_messages enable row level security;
alter table public.email_suppressions enable row level security;
alter table public.email_events enable row level security;
revoke all on table public.email_messages, public.email_suppressions, public.email_events from anon, authenticated;
grant all on table public.email_messages, public.email_suppressions, public.email_events to service_role;
grant select on table public.email_messages, public.email_suppressions, public.email_events to authenticated;
create policy email_messages_select_staff on public.email_messages for select to authenticated
using (app.is_staff());
create policy email_suppressions_select_staff on public.email_suppressions for select to authenticated
using (app.is_staff());
create policy email_events_select_staff on public.email_events for select to authenticated
using (app.is_staff());

-- Invariant 18: the columns that hold an address.
insert into public.pii_columns (table_name, column_name)
values ('email_messages', 'to_email'), ('email_events', 'to_email'), ('email_suppressions', 'email')
on conflict do nothing;

-- GD-03, G48: the email rule; B8's retention_anonymise_email applies it. A structural row, so production carries it.
insert into public.retention_policies (key, table_name, keep_for, action, enabled, note)
values (
  'email_pii', 'email_messages', interval '90 days', 'anonymise', true,
  'clears to_email on email_messages and email_events'
)
on conflict (key) do nothing;

create or replace function public.subscribers_engagement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- GG-05: a confirm or a re-confirm is engagement, and it answers an open re-permission ask.
  new.last_engaged_at := now();
  new.repermission_sent_at := null;
  return new;
end;
$$;

revoke execute on function public.subscribers_engagement() from public, anon, authenticated;

create or replace trigger subscribers_engagement
before update of confirmed_at on public.subscribers
for each row when (new.confirmed_at is not null and new.confirmed_at is distinct from old.confirmed_at)
execute function public.subscribers_engagement();

create or replace function public.email_sent_today()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  -- Invariant 5: every row Resend accepted in the current UTC day, whatever happened to it since. B11 replaces this
  -- body with the same signature to add broadcast recipients.
  select count(*)::int
  from public.email_messages
  where sent_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
$$;

revoke execute on function public.email_sent_today() from public, anon, authenticated;
grant execute on function public.email_sent_today() to service_role;

create or replace function public.email_sent_month()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  -- Invariant 5: every row Resend accepted in the current UTC month. B11 replaces this body with the same signature
  -- to add broadcast recipients.
  select count(*)::int
  from public.email_messages
  where sent_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
$$;

revoke execute on function public.email_sent_month() from public, anon, authenticated;
grant execute on function public.email_sent_month() to service_role;

create or replace function public.email_message_begin(
  p_job_id uuid,
  p_to_email text,
  p_template_key text,
  p_kind text,
  p_subject text,
  p_entity text,
  p_entity_id uuid,
  p_content_hash text
)
returns table (id uuid, status text, content_hash text)
language sql
security definer
set search_path = ''
as $$
  -- G43, invariant 4: one row per job and recipient. A retry finds the row of its first attempt, with that attempt's
  -- content_hash and its status, so a message already sent is never sent again.
  insert into public.email_messages (
    job_id, to_email, template_key, kind, subject, entity, entity_id, content_hash, status
  )
  values (
    p_job_id, p_to_email, p_template_key, p_kind, p_subject, p_entity, p_entity_id, p_content_hash, 'queued'
  )
  on conflict (job_id, to_email) do nothing;

  select m.id, m.status, m.content_hash
  from public.email_messages m
  where m.job_id = p_job_id and m.to_email = p_to_email;
$$;

revoke execute on function public.email_message_begin(uuid, text, text, text, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.email_message_begin(uuid, text, text, text, text, text, uuid, text) to service_role;

create or replace function public.email_message_finish(p_id uuid, p_status text, p_resend_id text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status is null or p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'invalid_status';
  end if;
  -- A row that is sent, or moved further by a provider event, stays where it is; only `sent` counts against the caps.
  update public.email_messages
  set status = p_status,
    resend_id = p_resend_id,
    error = p_error,
    sent_at = case when p_status = 'sent' then now() else sent_at end
  where id = p_id and status not in ('sent', 'delivered', 'bounced', 'complained');
end;
$$;

revoke execute on function public.email_message_finish(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.email_message_finish(uuid, text, text, text) to service_role;

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

create or replace function public.repermission_candidates(p_limit int default 200)
returns table (id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  -- GG-05: a consenting subscriber with no confirm or click for 12 months, not suppressed and not asked yet. Oldest
  -- first, so a capped run reaches the longest idle first.
  select s.id
  from public.subscribers s
  where s.confirmed_at is not null
    and s.unsubscribed_at is null
    and s.archived_at is null
    and s.repermission_sent_at is null
    and coalesce(s.last_engaged_at, s.confirmed_at) < now() - interval '12 months'
    and not exists (select 1 from public.email_suppressions x where x.email = lower(s.email))
  order by coalesce(s.last_engaged_at, s.confirmed_at)
  limit p_limit;
$$;

revoke execute on function public.repermission_candidates(int) from public, anon, authenticated;
grant execute on function public.repermission_candidates(int) to service_role;

create or replace function public.issue_repermission(p_subscriber_id uuid, p_token_hash text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  -- GG-05: the ask stores a fresh confirm hash; false means the subscriber no longer consents and nothing is sent.
  with changed as (
    update public.subscribers
    set confirm_token_hash = p_token_hash, repermission_sent_at = now()
    where id = p_subscriber_id and confirmed_at is not null and unsubscribed_at is null and archived_at is null
    returning 1
  )
  select exists (select 1 from changed);
$$;

revoke execute on function public.issue_repermission(uuid, text) from public, anon, authenticated;
grant execute on function public.issue_repermission(uuid, text) to service_role;

create or replace function public.lapse_subscribers(p_grace interval default '30 days')
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  -- GG-05: asked more than p_grace ago and no click or confirm since the ask. Soft (B2 invariant 4): the row stays,
  -- archived and unsubscribed, and its hash goes, so a late click on the ask answers confirmed=0 (DL-06).
  update public.subscribers
  set archived_at = now(), unsubscribed_at = now(), confirm_token_hash = null, pending_source = null
  where repermission_sent_at < now() - p_grace
    and archived_at is null
    and unsubscribed_at is null
    and (last_engaged_at is null or last_engaged_at < repermission_sent_at);
  get diagnostics v_count = row_count;
  -- A system row (G43): no actor, no actor kind. A run that lapses nobody writes nothing.
  if v_count > 0 then
    insert into public.audit_log (actor_id, actor_kind, action, entity, entity_id, after)
    values (null, null, 'subscribers.lapse', 'subscribers', null, jsonb_build_object('count', v_count));
  end if;
  return v_count;
end;
$$;

revoke execute on function public.lapse_subscribers(interval) from public, anon, authenticated;
grant execute on function public.lapse_subscribers(interval) to service_role;
