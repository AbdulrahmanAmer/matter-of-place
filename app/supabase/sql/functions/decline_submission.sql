create or replace function public.decline_submission(
  p_submission_id uuid,
  p_reason_id uuid,
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
  -- B7 invariants 1, 3 and 5: Under Review to Declined, decided under the row lock, counted against an agent's daily
  -- decisions, audited and announced in one transaction. The event's recipe sends the decline letter.
  select * into v_before from public.submissions s where s.id = p_submission_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_before.workflow_state <> 'Under Review' then
    raise exception 'wrong_state';
  end if;
  if not exists (select 1 from public.decline_reasons r where r.id = p_reason_id and r.enabled) then
    raise exception 'validation';
  end if;
  perform public.assert_agent_daily_cap(p_actor, p_actor_kind, 'decisions');
  update public.submissions s
  set workflow_state = 'Declined',
    decline_reason_id = p_reason_id,
    decline_note = v_note,
    reviewed_by = p_actor,
    reviewed_at = now()
  where s.id = p_submission_id
  returning * into v_after;
  perform public.write_audit(
    p_actor, p_actor_kind, 'submissions.decline', 'submission', p_submission_id, to_jsonb(v_before),
    to_jsonb(v_after), p_request_id
  );
  return public.emit_event(
    'submission.declined', 'submission', p_submission_id,
    public.submission_event_payload(v_after)
      || jsonb_strip_nulls(jsonb_build_object('decline_reason_id', p_reason_id, 'note', v_note)),
    p_actor
  );
end;
$$;

revoke execute on function public.decline_submission(uuid, uuid, text, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.decline_submission(uuid, uuid, text, uuid, public.actor_kind, text) to service_role;
