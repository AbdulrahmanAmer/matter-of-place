create or replace function public.create_proposed_post(
  p_title text,
  p_channels jsonb,
  p_proposer_kind public.actor_kind,
  p_proposer_agent text default null,
  p_actor uuid default null,
  p_request_id text default null,
  p_property uuid default null,
  p_submission uuid default null,
  p_test boolean default false,
  p_run uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_agent uuid;
begin
  -- W8 item 10 (H116, H135): a post proposed by a colleague (through the laptop runner, no actor) or through the admin
  -- route by a person or Matter's key (the actor, audited against action_roles by write_audit).
  if btrim(coalesce(p_title, '')) = '' or char_length(p_title) > 200 then
    raise exception 'validation' using errcode = '22023', detail = 'A proposed post needs a title of up to 200 characters.';
  end if;
  if p_proposer_kind = 'agent' then
    select a.id into v_agent from public.agents a where a.slug = p_proposer_agent;
    if v_agent is null then
      raise exception 'validation' using errcode = '22023', detail = 'The proposer is not on the team.';
    end if;
  elsif p_actor is null or p_proposer_agent is not null then
    raise exception 'validation' using errcode = '22023', detail = 'A person proposes under their own account.';
  end if;

  insert into public.proposed_posts (
    title, property_id, submission_id, proposer_kind, proposer_agent, proposer_user, run_id, test
  )
  values (
    btrim(p_title), p_property, p_submission, p_proposer_kind, p_proposer_agent, p_actor, p_run, coalesce(p_test, false)
  )
  returning id into v_id;
  perform public.proposed_post_put_channels(v_id, 1, p_channels);

  if p_actor is null then
    -- A colleague's proposal has no account: the runner files it, and the audit row's actor is the colleague's own
    -- `agents` row, as an agent, with its slug in the note. `write_audit` checks an account's roles, so this row is
    -- written here, as `reject_proposed_post` writes Matter's.
    insert into public.audit_log (actor_id, actor_kind, action, entity, entity_id, before, after, request_id, note)
    values (
      v_agent, 'agent', 'channels.proposed_create', 'proposed_posts', v_id, null,
      jsonb_build_object('status', 'proposed', 'revision', 1, 'test', coalesce(p_test, false)), p_request_id,
      'agent:' || p_proposer_agent
    );
  else
    perform public.write_audit(
      p_actor, p_proposer_kind, 'channels.proposed_create', 'proposed_posts',
      v_id, null, jsonb_build_object('status', 'proposed', 'revision', 1, 'test', coalesce(p_test, false)), p_request_id,
      case when p_proposer_kind = 'agent' then 'agent:' || p_proposer_agent end
    );
  end if;
  return v_id;
end;
$$;

revoke execute on function public.create_proposed_post(
  text, jsonb, public.actor_kind, text, uuid, text, uuid, uuid, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.create_proposed_post(
  text, jsonb, public.actor_kind, text, uuid, text, uuid, uuid, boolean, uuid
) to service_role;
