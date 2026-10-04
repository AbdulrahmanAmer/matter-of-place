create or replace function public.create_subject_request(p jsonb)
returns table (id uuid, received_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_received_at timestamptz;
begin
  insert into public.subject_requests as r (email, kind, note, status, ip_hash, turnstile_ok)
  values (
    lower(p ->> 'email'), p ->> 'kind', p ->> 'note', 'received', p ->> 'ip_hash',
    coalesce((p ->> 'turnstile_ok')::boolean, false)
  )
  returning r.id, r.received_at into v_id, v_received_at;
  -- G29: the event carries the id and the kind, never the address (R37).
  perform public.emit_event(
    'subject_request.received', 'subject_request', v_id,
    jsonb_build_object('request_id', v_id, 'kind', p ->> 'kind'), null
  );
  return query select v_id, v_received_at;
end;
$$;

revoke execute on function public.create_subject_request(jsonb) from public, anon, authenticated;
grant execute on function public.create_subject_request(jsonb) to service_role;
