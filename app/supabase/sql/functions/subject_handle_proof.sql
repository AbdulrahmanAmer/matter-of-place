create or replace function public.subject_handle_proof(
  p_subject_request_id uuid,
  p_received_at timestamptz,
  p_handle text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reference text := left(p_subject_request_id::text, 8);
  v_proof uuid;
begin
  -- W8 item 4 round 4: an Instagram handle named on a data request is the person's only when a message from it,
  -- received after the request, holds the request's short reference (the first 8 characters of its id, as the request
  -- desk and the admin screens write it). Anyone can type a handle, and its messages are private, so without that
  -- message export_subject and delete_subject refuse with 'handle_unverified'. Answers the proving message's id.
  select s.id into v_proof
  from public.social_inbox s
  where s.kind = 'message'
    and lower(s.author_handle) = p_handle
    and s.received_at >= p_received_at
    and strpos(lower(s.body), v_reference) > 0
  order by s.received_at, s.id
  limit 1;
  if v_proof is null then
    raise exception 'handle_unverified'
      using detail = 'No Instagram message from that handle, sent after the request, holds its reference. Ask the person to send the reference from that account.';
  end if;
  return v_proof;
end;
$$;

revoke execute on function public.subject_handle_proof(uuid, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.subject_handle_proof(uuid, timestamptz, text) to service_role;
