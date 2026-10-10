create or replace function public.set_subject_request_status(
  p_subject_request_id uuid,
  p_action text,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.subject_requests;
  v_after public.subject_requests;
  v_note text := nullif(btrim(p_note), '');
begin
  -- Invariant 15 (GP-01, B3 invariant 13): identity first. start_verification moves received to verifying,
  -- confirm_identity stamps verified_at, reject closes the request with a note, and fulfil_correction closes a
  -- correction once the row was corrected by hand on the screen that owns it.
  select * into v_row from public.subject_requests r where r.id = p_subject_request_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_action not in ('start_verification', 'confirm_identity', 'reject', 'fulfil_correction') then
    raise exception 'invalid_key';
  end if;
  if p_action = 'fulfil_correction' and v_row.kind <> 'correction' then
    raise exception 'wrong_kind';
  end if;
  if v_row.status in ('fulfilled', 'rejected')
    or (p_action = 'start_verification' and v_row.status <> 'received')
    or (p_action = 'confirm_identity' and (v_row.status <> 'verifying' or v_row.verified_at is not null)) then
    raise exception 'wrong_state';
  end if;
  if p_action = 'fulfil_correction' and v_row.verified_at is null then
    raise exception 'not_verified';
  end if;
  if p_action in ('reject', 'fulfil_correction') and v_note is null then
    raise exception 'note_required';
  end if;

  update public.subject_requests r
  set status = case p_action
      when 'start_verification' then 'verifying'
      when 'reject' then 'rejected'
      when 'fulfil_correction' then 'fulfilled'
      else r.status
    end,
    verified_at = case when p_action = 'confirm_identity' then now() else r.verified_at end,
    fulfilled_at = case when p_action = 'fulfil_correction' then now() else r.fulfilled_at end,
    handled_by = p_actor
  where r.id = p_subject_request_id
  returning * into v_after;
  -- Ids and states only: the address stays in its own table (invariant 18).
  perform public.write_audit(
    p_actor, p_actor_kind, 'audit.subject_status', 'subject_request', p_subject_request_id,
    jsonb_build_object('id', v_row.id, 'status', v_row.status, 'verified', v_row.verified_at is not null),
    jsonb_build_object('id', v_after.id, 'status', v_after.status, 'verified', v_after.verified_at is not null),
    p_request_id, v_note
  );
  return jsonb_build_object(
    'id', v_after.id, 'status', v_after.status, 'verified_at', v_after.verified_at,
    'fulfilled_at', v_after.fulfilled_at, 'handled_by', v_after.handled_by
  );
end;
$$;

revoke execute on function public.set_subject_request_status(uuid, text, uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.set_subject_request_status(uuid, text, uuid, public.actor_kind, text, text)
  to service_role;
