create or replace function public.start_review(
  p_submission_ids uuid[],
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  -- B7 invariant 5: Submitted to Under Review, one request or a selection, all or none. The rows are locked in id
  -- order, so two overlapping selections wait on each other instead of deadlocking.
  if coalesce(cardinality(p_submission_ids), 0) not between 1 and 50 then
    raise exception 'validation';
  end if;
  for v_row in
    select s.id, s.workflow_state
    from public.submissions s
    where s.id = any (p_submission_ids)
    order by s.id
    for update
  loop
    if v_row.workflow_state <> 'Submitted' then
      raise exception 'wrong_state';
    end if;
    update public.submissions
    set workflow_state = 'Under Review', reviewed_by = p_actor, reviewed_at = now()
    where id = v_row.id;
    perform public.write_audit(
      p_actor, p_actor_kind, 'submissions.start_review', 'submission', v_row.id,
      jsonb_build_object('id', v_row.id, 'workflow_state', 'Submitted'),
      jsonb_build_object('id', v_row.id, 'workflow_state', 'Under Review'),
      p_request_id
    );
    v_count := v_count + 1;
  end loop;
  if v_count <> (select count(distinct x) from unnest(p_submission_ids) x) then
    raise exception 'not_found';
  end if;
  return v_count;
end;
$$;

revoke execute on function public.start_review(uuid[], uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.start_review(uuid[], uuid, public.actor_kind, text) to service_role;
