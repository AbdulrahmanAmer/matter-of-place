-- down:
--   drop function public.rate_limit_check(jsonb), public.create_inquiry(jsonb), public.create_submission(jsonb),
--     public.upsert_subscriber(jsonb), public.confirm_subscriber(text), public.create_subject_request(jsonb),
--     public.record_analytics_events(jsonb), public.record_webhook_receipt(text, text),
--     public.forget_webhook_receipt(text, text), public.unsubscribe_email(text),
--     public.mark_media_uploaded(uuid, text, text), public.submission_upload_paths(uuid, uuid[]);
--   delete from public.retention_policies where key in ('rate_limits', 'webhook_receipts', 'subject_requests');
--   delete from public.pii_columns where table_name = 'subject_requests';
--   drop table public.rate_limits, public.webhook_receipts, public.subject_requests;
--   alter table public.submission_media drop column sort_order;
--   alter table public.subscribers drop column pending_source;
--   alter table public.submissions drop column duplicate_of;
set lock_timeout = '5s';

-- B3 (G43, G49): public writes reach the tables only through the functions below, called by the service role. Their
-- text is copied verbatim from supabase/sql/functions/<name>.sql (DB-13); a later change edits that file and runs
-- bun run db:fn.

-- Hits of rate_limit_check; B8's prune keeps 25 hours, the longest window being one day.
create table public.rate_limits (
  id bigint generated always as identity primary key,
  bucket text not null,
  key_hash text not null,
  at timestamptz not null default now()
);
create index rate_limits_bucket_key_at_idx on public.rate_limits (bucket, key_hash, at);

-- One row per applied webhook delivery, so a replay is applied once.
create table public.webhook_receipts (
  provider text not null,
  id text not null,
  received_at timestamptz not null default now(),
  primary key (provider, id)
);

-- GP-01 (G29): privacy requests, answered within 45 days. due_at goes through UTC because timestamptz + interval is
-- only stable, and a generated column needs an immutable expression.
create table public.subject_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  kind text not null check (kind in ('access', 'deletion', 'opt_out', 'correction')),
  note text,
  status text not null default 'received' check (status in ('received', 'verifying', 'fulfilled', 'rejected')),
  received_at timestamptz not null default now(),
  due_at timestamptz generated always as (((received_at at time zone 'UTC') + interval '45 days') at time zone 'UTC')
    stored,
  verified_at timestamptz,
  fulfilled_at timestamptz,
  handled_by uuid references auth.users (id) on delete set null,
  ip_hash text,
  turnstile_ok boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subject_requests_handled_by_idx on public.subject_requests (handled_by);
create index subject_requests_received_idx on public.subject_requests (received_at desc);

create trigger subject_requests_set_updated_at
before update on public.subject_requests
for each row execute function public.set_updated_at();

-- GD-05: a request for an address the same person sent within 30 days points at the first one.
alter table public.submissions add column duplicate_of uuid references public.submissions (id) on delete set null;
create index submissions_duplicate_of_idx on public.submissions (duplicate_of);

-- DL-06 (a): a Place Notes source waiting for its confirmation click on a row confirmed for market interest only.
alter table public.subscribers add column pending_source text;

-- FE-04: the 0-based position of the file in the posted media array; uploads are matched and signed in this order.
alter table public.submission_media add column sort_order int not null default 0;

alter table public.rate_limits enable row level security;
alter table public.webhook_receipts enable row level security;
alter table public.subject_requests enable row level security;
-- G-100: every grant is explicit. rate_limits and webhook_receipts have no policy: only the service role reaches them.
revoke all on table public.rate_limits, public.webhook_receipts, public.subject_requests from anon, authenticated;
grant all on table public.rate_limits, public.webhook_receipts, public.subject_requests to service_role;

-- Admin screens 25: admin and chief_editor read and handle privacy requests; no role inserts or deletes one.
grant select, update on public.subject_requests to authenticated;
create policy subject_requests_select_privacy on public.subject_requests for select to authenticated
using (app.role_in('admin', 'chief_editor'));
create policy subject_requests_update_privacy on public.subject_requests for update to authenticated
using (app.role_in('admin', 'chief_editor'))
with check (app.role_in('admin', 'chief_editor'));

create or replace function public.rate_limit_check(p_checks jsonb)
returns table (allowed boolean, retry_after int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check jsonb;
  v_window interval;
  v_count int;
  v_oldest timestamptz;
  v_failed boolean := false;
  v_wait int := 0;
begin
  for v_check in select value from jsonb_array_elements(p_checks) loop
    -- Two concurrent calls on one key cannot both take its last slot.
    perform pg_advisory_xact_lock(hashtext((v_check ->> 'bucket') || ':' || (v_check ->> 'key_hash')));
    v_window := make_interval(secs => (v_check ->> 'window_seconds')::int);
    select count(*), min(r.at) into v_count, v_oldest
    from public.rate_limits r
    where r.bucket = v_check ->> 'bucket'
      and r.key_hash = v_check ->> 'key_hash'
      and r.at > now() - v_window;
    if v_count >= (v_check ->> 'limit')::int then
      v_failed := true;
      v_wait := greatest(v_wait, 1, ceil(extract(epoch from v_oldest + v_window - now()))::int);
    end if;
  end loop;
  if v_failed then
    return query select false, v_wait;
    return;
  end if;
  -- One hit per key, so two checks on one bucket with different windows each count the call once.
  insert into public.rate_limits (bucket, key_hash, at)
  select distinct c ->> 'bucket', c ->> 'key_hash', now()
  from jsonb_array_elements(p_checks) c;
  return query select true, 0;
end;
$$;

revoke execute on function public.rate_limit_check(jsonb) from public, anon, authenticated;
grant execute on function public.rate_limit_check(jsonb) to service_role;

create or replace function public.create_inquiry(p jsonb)
returns table (id uuid, received_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.inquiries := jsonb_populate_record(null::public.inquiries, p);
begin
  -- `state` and `received_at` keep their defaults; the payload names only what the visitor and the request gave.
  return query
  insert into public.inquiries as i (
    intent, topic, subject_kind, subject_slug, subject_title, name, email, phone, location, message, details,
    source_path, ip_hash, turnstile_ok
  ) values (
    v.intent, v.topic, v.subject_kind, v.subject_slug, v.subject_title, v.name, v.email, v.phone, v.location,
    v.message, coalesce(v.details, '{}'::jsonb), v.source_path, v.ip_hash, coalesce(v.turnstile_ok, false)
  )
  returning i.id, i.received_at;
end;
$$;

revoke execute on function public.create_inquiry(jsonb) from public, anon, authenticated;
grant execute on function public.create_inquiry(jsonb) to service_role;

create or replace function public.create_submission(p jsonb)
returns table (id uuid, received_at timestamptz, media jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.submissions := jsonb_populate_record(null::public.submissions, p);
  v_entries jsonb := coalesce(p -> 'media', '[]'::jsonb);
  v_address text := lower(regexp_replace(btrim(v.address), '\s+', ' ', 'g'));
  v_existing public.submissions;
  v_duplicate_of uuid;
  v_contact_id uuid;
  v_submission_id uuid;
  v_received_at timestamptz;
begin
  -- GQ-07: the same number as uploadLimits.maxFiles and the submission_media trigger.
  if jsonb_array_length(v_entries) > 40 then
    raise exception 'validation' using errcode = '22023', detail = 'more than 40 media entries';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_entries) e
    where e ->> 'type' not in ('image/jpeg', 'image/png', 'image/heic', 'image/webp') or e ->> 'type' is null
  ) then
    raise exception 'validation' using errcode = '22023', detail = 'unsupported media type';
  end if;

  -- A double click (ASSUMED: the same submitter, address and zip within 10 minutes) answers with the first request.
  select * into v_existing
  from public.submissions s
  where lower(s.submitter_email) = lower(v.submitter_email)
    and lower(regexp_replace(btrim(s.address), '\s+', ' ', 'g')) = v_address
    and s.zip = v.zip
    and s.received_at > now() - interval '10 minutes'
  order by s.received_at
  limit 1;
  if found then
    return query
    select v_existing.id, v_existing.received_at, coalesce(
      (select jsonb_agg(
          jsonb_build_object('id', m.id, 'index', m.sort_order, 'name', m.name, 'storage_path', m.storage_path)
          order by m.sort_order
        )
        from public.submission_media m
        where m.submission_id = v_existing.id),
      '[]'::jsonb
    );
    return;
  end if;

  -- Invariant 12 (GD-05): a request for the same address by the same email within 30 days points at the first one.
  select s.id into v_duplicate_of
  from public.submissions s
  where lower(s.submitter_email) = lower(v.submitter_email)
    and lower(regexp_replace(btrim(s.address), '\s+', ' ', 'g')) = v_address
    and s.received_at > now() - interval '30 days'
  order by s.received_at
  limit 1;

  -- Invariant 22 (S55): one person is one row. The kind first recorded stays; the request keeps what was typed.
  insert into public.contacts as c (kind, name, email, phone, brokerage)
  values (v.submitter_kind, v.submitter_name, lower(v.submitter_email), v.submitter_phone, v.brokerage)
  on conflict ((lower(email))) do update
  set name = excluded.name,
    phone = coalesce(excluded.phone, c.phone),
    brokerage = coalesce(excluded.brokerage, c.brokerage)
  returning c.id into v_contact_id;

  insert into public.submissions as s (
    address, city, state, zip, listing_url, source_url, price, currency, property_type, beds, baths, interior_sq_ft,
    architect, designer, year_built, year_renovated, brokerage, submitter_kind, submitter_name, submitter_email,
    submitter_phone, listed_with_agent, listing_agent_name, listing_agent_brokerage, contact_id, photography_url,
    video_url, story, significance, package, media_budget, source_path, turnstile_ok, ip_hash, rights_version,
    rights_confirmed_at, rights_ip_hash, duplicate_of
  ) values (
    v.address, v.city, v.state, v.zip, v.listing_url, v.source_url, v.price, coalesce(v.currency, 'USD'),
    v.property_type, v.beds, v.baths, v.interior_sq_ft, v.architect, v.designer, v.year_built, v.year_renovated,
    v.brokerage, v.submitter_kind, v.submitter_name, v.submitter_email, v.submitter_phone, v.listed_with_agent,
    v.listing_agent_name, v.listing_agent_brokerage, v_contact_id, v.photography_url, v.video_url, v.story,
    v.significance, v.package, v.media_budget, v.source_path, coalesce(v.turnstile_ok, false), v.ip_hash,
    v.rights_version, v.rights_confirmed_at, v.rights_ip_hash, v_duplicate_of
  )
  returning s.id, s.received_at into v_submission_id, v_received_at;

  -- FE-04: the browser matches each file by its position in the payload, never by its name.
  return query
  with entries as (
    select e.value as entry, (e.ordinality - 1)::int as position, gen_random_uuid() as media_id
    from jsonb_array_elements(v_entries) with ordinality e
  ),
  stored as (
    insert into public.submission_media as m (id, submission_id, name, bytes, storage_path, sort_order)
    select x.media_id, v_submission_id, x.entry ->> 'name', (x.entry ->> 'size')::bigint,
      v_submission_id || '/' || x.media_id || '.' || case x.entry ->> 'type'
        when 'image/jpeg' then 'jpg'
        when 'image/png' then 'png'
        when 'image/heic' then 'heic'
        else 'webp'
      end,
      x.position
    from entries x
    returning m.id, m.sort_order, m.name, m.storage_path
  )
  select v_submission_id, v_received_at, coalesce(
    (select jsonb_agg(
        jsonb_build_object('id', st.id, 'index', st.sort_order, 'name', st.name, 'storage_path', st.storage_path)
        order by st.sort_order
      )
      from stored st),
    '[]'::jsonb
  );
end;
$$;

revoke execute on function public.create_submission(jsonb) from public, anon, authenticated;
grant execute on function public.create_submission(jsonb) to service_role;

create or replace function public.upsert_subscriber(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(p ->> 'email');
  v_source text := p ->> 'source';
  v_markets text[] := array(select jsonb_array_elements_text(coalesce(p -> 'markets', '[]'::jsonb)));
  v_hash text := p ->> 'confirm_token_hash';
  v_row public.subscribers;
  v_id uuid;
  v_lapsed boolean;
  v_unconfirmed boolean;
  v_newsletter_for_interest boolean;
begin
  insert into public.subscribers (email, source, markets, confirm_token_hash)
  values (v_email, v_source, v_markets, v_hash)
  on conflict ((lower(email))) do nothing
  returning id into v_id;
  if v_id is not null then
    return v_id;
  end if;

  select * into v_row from public.subscribers s where lower(s.email) = v_email for update;
  -- DL-06, in order. An unsubscribed or archived address confirms again; until then it is unconfirmed.
  v_lapsed := v_row.unsubscribed_at is not null or v_row.archived_at is not null;
  v_unconfirmed := v_lapsed or v_row.confirmed_at is null;
  -- A Place Notes signup for an address confirmed for market interest only waits for its own click.
  v_newsletter_for_interest := not v_unconfirmed
    and v_row.source like 'interest:%'
    and v_source not like 'interest:%';
  update public.subscribers s
  set markets = array(select distinct m from unnest(v_row.markets || v_markets) m order by m),
    confirmed_at = case when v_lapsed then null else s.confirmed_at end,
    resend_contact_id = case when v_lapsed then null else s.resend_contact_id end,
    source = case
      when v_unconfirmed and v_row.source like 'interest:%' and v_source not like 'interest:%' then v_source
      else s.source
    end,
    pending_source = case when v_newsletter_for_interest then v_source else s.pending_source end,
    confirm_token_hash = case
      when v_unconfirmed or v_newsletter_for_interest then v_hash
      else s.confirm_token_hash
    end
  where s.id = v_row.id;
  return v_row.id;
end;
$$;

revoke execute on function public.upsert_subscriber(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_subscriber(jsonb) to service_role;

create or replace function public.confirm_subscriber(p_token_hash text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  -- The hash alone matches (G12): a re-permission hash on a confirmed row confirms it again, and a used link matches
  -- nothing once the hash is cleared. A Place Notes source waiting on this click becomes the row's source (DL-06).
  update public.subscribers
  set confirmed_at = now(),
    confirm_token_hash = null,
    source = coalesce(pending_source, source),
    pending_source = null,
    unsubscribed_at = null,
    archived_at = null
  where confirm_token_hash = p_token_hash
  returning id;
$$;

revoke execute on function public.confirm_subscriber(text) from public, anon, authenticated;
grant execute on function public.confirm_subscriber(text) to service_role;

create or replace function public.create_subject_request(p jsonb)
returns table (id uuid, received_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  insert into public.subject_requests as r (email, kind, note, status, ip_hash, turnstile_ok)
  values (
    lower(p ->> 'email'), p ->> 'kind', p ->> 'note', 'received', p ->> 'ip_hash',
    coalesce((p ->> 'turnstile_ok')::boolean, false)
  )
  returning r.id, r.received_at;
$$;

revoke execute on function public.create_subject_request(jsonb) from public, anon, authenticated;
grant execute on function public.create_subject_request(jsonb) to service_role;

create or replace function public.record_analytics_events(p_rows jsonb)
returns int
language sql
security definer
set search_path = ''
as $$
  with stored as (
    insert into public.analytics_events (event, path, data, occurred_at)
    select r ->> 'event', r ->> 'path', coalesce(r -> 'data', '{}'::jsonb), (r ->> 'occurred_at')::timestamptz
    from jsonb_array_elements(p_rows) r
    returning 1
  )
  select count(*)::int from stored;
$$;

revoke execute on function public.record_analytics_events(jsonb) from public, anon, authenticated;
grant execute on function public.record_analytics_events(jsonb) to service_role;

create or replace function public.record_webhook_receipt(p_provider text, p_id text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  -- False on a replay: the delivery was already applied.
  with stored as (
    insert into public.webhook_receipts (provider, id)
    values (p_provider, p_id)
    on conflict (provider, id) do nothing
    returning 1
  )
  select exists (select 1 from stored);
$$;

revoke execute on function public.record_webhook_receipt(text, text) from public, anon, authenticated;
grant execute on function public.record_webhook_receipt(text, text) to service_role;

create or replace function public.forget_webhook_receipt(p_provider text, p_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  -- A failed effect forgets its receipt, so the provider's retry is applied and not taken for a replay.
  delete from public.webhook_receipts where provider = p_provider and id = p_id;
$$;

revoke execute on function public.forget_webhook_receipt(text, text) from public, anon, authenticated;
grant execute on function public.forget_webhook_receipt(text, text) to service_role;

create or replace function public.unsubscribe_email(p_email text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  -- Clearing the hash makes a confirm link sent before this answer `confirmed=0` (DL-06 (c)).
  with changed as (
    update public.subscribers
    set unsubscribed_at = now(), confirm_token_hash = null, pending_source = null
    where lower(email) = lower(p_email) and unsubscribed_at is null
    returning 1
  )
  select exists (select 1 from changed);
$$;

revoke execute on function public.unsubscribe_email(text) from public, anon, authenticated;
grant execute on function public.unsubscribe_email(text) to service_role;

create or replace function public.mark_media_uploaded(p_media_id uuid, p_mime text, p_sha256 text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with changed as (
    update public.submission_media
    set uploaded_at = now(), mime = p_mime, sha256 = p_sha256
    where id = p_media_id and uploaded_at is null
    returning 1
  )
  select exists (select 1 from changed);
$$;

revoke execute on function public.mark_media_uploaded(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_media_uploaded(uuid, text, text) to service_role;

create or replace function public.submission_upload_paths(p_submission_id uuid, p_media_ids uuid[])
returns table (media_id uuid, storage_path text)
language sql
stable
security definer
set search_path = ''
as $$
  -- The rows of one submission still waiting for their object, at most one signing batch (E2E-02).
  select m.id, m.storage_path
  from public.submission_media m
  where m.submission_id = p_submission_id
    and m.id = any (p_media_ids)
    and m.uploaded_at is null
  order by m.sort_order
  limit 10;
$$;

revoke execute on function public.submission_upload_paths(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.submission_upload_paths(uuid, uuid[]) to service_role;

-- G16, G43: the slice that creates a table seeds its retention row; B8's prune and retention jobs read them.
insert into public.retention_policies (key, table_name, keep_for, action, enabled)
values
  ('rate_limits', 'rate_limits', interval '25 hours', 'delete', true),
  ('webhook_receipts', 'webhook_receipts', interval '30 days', 'delete', true),
  ('subject_requests', 'subject_requests', interval '24 months', 'delete', true)
on conflict (key) do nothing;

-- Invariant 18 (DB-03): personal data never enters audit_log.
insert into public.pii_columns (table_name, column_name) values ('subject_requests', 'email') on conflict do nothing;
