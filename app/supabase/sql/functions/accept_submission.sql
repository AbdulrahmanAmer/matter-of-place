create or replace function public.accept_submission(
  p_submission_id uuid,
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
begin
  -- B7 invariants 1, 3 and 5: Under Review to Accepted, decided under the row lock, counted against an agent's daily
  -- decisions, audited and announced in one transaction. B6 issues the invoice from here.
  select * into v_before from public.submissions s where s.id = p_submission_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_before.workflow_state <> 'Under Review' then
    raise exception 'wrong_state';
  end if;
  perform public.assert_agent_daily_cap(p_actor, p_actor_kind, 'decisions');
  update public.submissions s
  set workflow_state = 'Accepted', accepted_by = p_actor, accepted_at = now()
  where s.id = p_submission_id
  returning * into v_after;
  perform public.write_audit(
    p_actor, p_actor_kind, 'submissions.accept', 'submission', p_submission_id, to_jsonb(v_before),
    to_jsonb(v_after), p_request_id
  );
  return public.emit_event(
    'submission.accepted', 'submission', p_submission_id, public.submission_event_payload(v_after), p_actor
  );
end;
$$;

revoke execute on function public.accept_submission(uuid, uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.accept_submission(uuid, uuid, public.actor_kind, text) to service_role;
