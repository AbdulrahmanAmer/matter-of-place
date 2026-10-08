create or replace function public.request_assets(
  p_submission_id uuid,
  p_note text,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.submissions;
  v_after public.submissions;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  -- B7 invariants 1 and 5: Under Review or Accepted to Awaiting Assets. The note says what is needed; the event carries
  -- it, and B5's `awaiting_assets` letter reads it as `assets_note`.
  if v_note is null then
    raise exception 'invalid_key';
  end if;
  select * into v_before from public.submissions s where s.id = p_submission_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_before.workflow_state not in ('Under Review', 'Accepted') then
    raise exception 'wrong_state';
  end if;
  update public.submissions s
  set workflow_state = 'Awaiting Assets'
  where s.id = p_submission_id
  returning * into v_after;
  perform public.write_audit(
    p_actor, p_actor_kind, 'submissions.request_assets', 'submission', p_submission_id, to_jsonb(v_before),
    to_jsonb(v_after), p_request_id, v_note
  );
  return public.emit_event(
    'submission.awaiting_assets', 'submission', p_submission_id,
    public.submission_event_payload(v_after) || jsonb_build_object('note', v_note),
    p_actor
  );
end;
$$;

revoke execute on function public.request_assets(uuid, text, uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.request_assets(uuid, text, uuid, public.actor_kind, text) to service_role;
