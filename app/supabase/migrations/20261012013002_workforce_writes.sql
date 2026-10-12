-- down: re-run bun run db:fn workforce_post_message workforce_hire workforce_update_agent workforce_decide from the previous commit of supabase/sql/functions/workforce_post_message.sql, supabase/sql/functions/workforce_hire.sql, supabase/sql/functions/workforce_update_agent.sql, supabase/sql/functions/workforce_decide.sql
set lock_timeout = '5s';

create or replace function public.workforce_post_message(
  p_thread text,
  p_body text,
  p_author_id text,
  p_author_name text,
  p_wake text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- W1: a person's line in the team chat or a direct thread, and the runs it wakes. Who wakes is decided by the caller
  -- (`wakeTargets` in src/domain/workforce.ts); a colleague who is off is skipped here as well.
  if p_thread <> 'team' and not exists (select 1 from public.agents where slug = p_thread) then
    raise exception 'not_found';
  end if;
  insert into public.agent_messages (thread, author_kind, author_id, author_name, body)
  values (p_thread, 'human', p_author_id, p_author_name, p_body)
  returning id into v_id;
  insert into public.agent_runs (agent_id, cause, message_id)
  select a.id, 'message', v_id
  from public.agents a
  where a.slug = any (coalesce(p_wake, '{}')) and a.state <> 'off';
  return v_id;
end;
$$;

revoke execute on function public.workforce_post_message(text, text, text, text, text[])
  from public, anon, authenticated;
grant execute on function public.workforce_post_message(text, text, text, text, text[]) to service_role;

create or replace function public.workforce_hire(
  p_slug text,
  p_name text,
  p_role text,
  p_instructions text,
  p_model text,
  p_wake_on text[],
  p_tools text[],
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
  v_id uuid;
begin
  -- W1: a new colleague, announced in the team chat. A taken handle raises 23505, which the admin answers as
  -- `already_exists`.
  insert into public.agents (slug, name, role, instructions, model, wake_on, tools, created_by)
  values (
    p_slug, p_name, p_role, coalesce(p_instructions, ''), coalesce(p_model, 'sonnet'),
    coalesce(p_wake_on, '{}'), coalesce(p_tools, '{}'),
    case when p_actor_kind = 'human' then p_actor end
  )
  returning id into v_id;
  insert into public.agent_messages (thread, author_kind, author_id, author_name, body)
  values ('team', 'system', 'system', 'Matter of Place', format('%s joined the team as %s.', p_name, p_role));
  perform public.write_audit(
    p_actor, p_actor_kind, 'workforce.hire', 'agents', v_id,
    null,
    jsonb_build_object('slug', p_slug, 'role', p_role),
    p_request_id
  );
  return v_id;
end;
$$;

revoke execute on function public.workforce_hire(
  text, text, text, text, text, text[], text[], uuid, public.actor_kind, text
) from public, anon, authenticated;
grant execute on function public.workforce_hire(
  text, text, text, text, text, text[], text[], uuid, public.actor_kind, text
) to service_role;

create or replace function public.workforce_update_agent(
  p_slug text,
  p_change jsonb,
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
  v_id uuid;
begin
  -- W1: only the fields the person changed; a key absent from `p_change` keeps its value. The audit row names the
  -- fields, never the instructions' words.
  if jsonb_typeof(p_change) <> 'object' then
    raise exception 'validation';
  end if;
  update public.agents
  set
    name = coalesce(p_change ->> 'name', name),
    role = coalesce(p_change ->> 'role', role),
    instructions = coalesce(p_change ->> 'instructions', instructions),
    model = coalesce(p_change ->> 'model', model),
    wake_on = case when p_change ? 'wake_on'
      then array(select jsonb_array_elements_text(p_change -> 'wake_on')) else wake_on end,
    tools = case when p_change ? 'tools'
      then array(select jsonb_array_elements_text(p_change -> 'tools')) else tools end,
    state = coalesce(p_change ->> 'state', state)
  where slug = p_slug
  returning id into v_id;
  if v_id is null then
    raise exception 'not_found';
  end if;
  perform public.write_audit(
    p_actor, p_actor_kind, 'workforce.update', 'agents', v_id,
    null,
    jsonb_build_object('fields', (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(p_change) k)),
    p_request_id
  );
  return v_id;
end;
$$;

revoke execute on function public.workforce_update_agent(text, jsonb, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.workforce_update_agent(text, jsonb, uuid, public.actor_kind, text) to service_role;

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
