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
