create or replace function public.workforce_decide(
  p_id uuid,
  p_decision text,
  p_content_hash text,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.agent_approvals%rowtype;
begin
  -- W1 invariant 3: a person's decision on one proposal; an approval holds only for the exact content the person saw.
  if p_decision not in ('approved', 'rejected') then
    raise exception 'validation';
  end if;
  select * into v_row from public.agent_approvals where id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_row.state <> 'pending' then
    raise exception 'wrong_state';
  end if;
  if p_decision = 'approved' and p_content_hash is distinct from v_row.content_hash then
    raise exception 'version_conflict';
  end if;
  update public.agent_approvals
  set state = p_decision,
      decided_by = case when p_actor_kind = 'human' then p_actor end,
      decided_at = now()
  where id = p_id;
  insert into public.agent_messages (thread, author_kind, author_id, author_name, body)
  values (
    'team', 'system', 'system', 'Matter of Place',
    format('%s: %s', case when p_decision = 'approved' then 'Approved' else 'Declined' end, v_row.summary)
  );
  perform public.write_audit(
    p_actor, p_actor_kind, 'workforce.decide', 'agents', v_row.agent_id,
    null,
    jsonb_build_object('approval', p_id, 'decision', p_decision),
    p_request_id
  );
  return p_decision;
end;
$$;

revoke execute on function public.workforce_decide(uuid, text, text, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.workforce_decide(uuid, text, text, uuid, public.actor_kind, text) to service_role;
