-- down: drop function public.mark_inquiry_forwarded(uuid, jsonb); re-apply the text of
--   `git show origin/main:app/supabase/sql/functions/create_inquiry.sql` (the body before this file);
--   then alter table public.inquiries drop column attribution.
set lock_timeout = '5s';

-- B15: what the browser captured for the session (first touch, last touch, pages viewed). create_inquiry sets it,
-- retention_anonymise_inquiries resets it to '{}'; RLS is unchanged.
alter table public.inquiries
  add column attribution jsonb not null default '{}'
  constraint inquiries_attribution_object check (jsonb_typeof(attribution) = 'object');

create or replace function public.create_inquiry(p jsonb)
returns table (id uuid, received_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.inquiries := jsonb_populate_record(null::public.inquiries, p);
  v_id uuid;
  v_received_at timestamptz;
begin
  -- `state` and `received_at` keep their defaults; the payload names only what the visitor and the request gave.
  insert into public.inquiries as i (
    intent, topic, subject_kind, subject_slug, subject_title, name, email, phone, location, message, details,
    source_path, ip_hash, turnstile_ok, attribution
  ) values (
    v.intent, v.topic, v.subject_kind, v.subject_slug, v.subject_title, v.name, v.email, v.phone, v.location,
    v.message, coalesce(v.details, '{}'::jsonb), v.source_path, v.ip_hash, coalesce(v.turnstile_ok, false),
    coalesce(p->'attribution', '{}'::jsonb)
  )
  returning i.id, i.received_at into v_id, v_received_at;
  -- G49: the event commits or rolls back with the row.
  perform public.emit_event('inquiry.received', 'inquiry', v_id, jsonb_build_object('inquiry_id', v_id), null);
  return query select v_id, v_received_at;
end;
$$;

revoke execute on function public.create_inquiry(jsonb) from public, anon, authenticated;
grant execute on function public.create_inquiry(jsonb) to service_role;

create or replace function public.mark_inquiry_forwarded(p_inquiry_id uuid, p_payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The job-step write of webhook_omnikom (B15, G43): a closed inquiry is never reopened, an anonymised one never refilled.
  update public.inquiries
  set forwarded_at = now(),
    forwarded_payload = p_payload,
    state = case when state in ('new', 'in_progress') then 'forwarded'::public.inquiry_state else state end
  where id = p_inquiry_id and anonymised_at is null;
  return found;
end;
$$;

revoke execute on function public.mark_inquiry_forwarded(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.mark_inquiry_forwarded(uuid, jsonb) to service_role;
