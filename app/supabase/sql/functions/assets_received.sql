create or replace function public.assets_received(
  p_submission_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns public.submission_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.submissions;
  v_after public.submissions;
begin
  -- B7 invariant 5 (ASSUMED): the material arrived. Back to Accepted when the request was accepted before, else to
  -- Under Review. Audit only: no catalog event and no letter.
  select * into v_before from public.submissions s where s.id = p_submission_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_before.workflow_state <> 'Awaiting Assets' then
    raise exception 'wrong_state';
  end if;
  update public.submissions s
  set workflow_state = case when v_before.accepted_at is null then 'Under Review' else 'Accepted' end::public.submission_state
  where s.id = p_submission_id
  returning * into v_after;
  perform public.write_audit(
    p_actor, p_actor_kind, 'submissions.assets_received', 'submission', p_submission_id, to_jsonb(v_before),
    to_jsonb(v_after), p_request_id
  );
  return v_after.workflow_state;
end;
$$;

revoke execute on function public.assets_received(uuid, uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.assets_received(uuid, uuid, public.actor_kind, text) to service_role;
