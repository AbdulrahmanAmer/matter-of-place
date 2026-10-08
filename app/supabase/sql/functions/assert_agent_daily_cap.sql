create or replace function public.assert_agent_daily_cap(
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_group text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actions text[];
  v_limit integer;
  v_count integer;
begin
  -- B7 invariant 3 (SEC-11): an agent makes at most `<group>_per_day` of the group's actions per UTC day. The kind is
  -- the stored one (DB-04): `p_actor_kind` is the caller's claim and is never read.
  v_actions := case p_group
    when 'decisions' then array['submissions.decline', 'submissions.accept']
    when 'publish' then array['properties.publish', 'stories.publish']
  end;
  if v_actions is null then
    raise exception 'invalid_key';
  end if;
  if not exists (
    select 1 from public.user_roles r where r.user_id = p_actor and r.actor_kind = 'agent'
  ) then
    return;
  end if;
  -- Two parallel calls of one agent count one after the other, so both cannot pass on the last free slot.
  perform pg_advisory_xact_lock(hashtext(p_actor::text));
  select (s.value ->> (p_group || '_per_day'))::integer
  into v_limit
  from public.settings s
  where s.key = 'agent_daily_limits';
  select count(*)
  into v_count
  from public.audit_log a
  where a.actor_id = p_actor
    and a.at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
    and a.action = any (v_actions);
  if v_count >= v_limit then
    raise exception 'agent_daily_limit';
  end if;
end;
$$;

revoke execute on function public.assert_agent_daily_cap(uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.assert_agent_daily_cap(uuid, public.actor_kind, text) to service_role;
