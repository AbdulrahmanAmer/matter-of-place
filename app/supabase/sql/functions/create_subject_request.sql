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
