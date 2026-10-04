create or replace function public.retention_log_run(p_after jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  -- G43: the one audit row of a retention run, written by the system (no actor), with { <policy key>: { affected,
  -- remaining } }; each named policy row records the run, which the health check's retention_stalled reads.
  insert into public.audit_log (action, entity, entity_id, actor_id, actor_kind, after)
  values ('retention.run', 'retention', null, null, null, p_after)
  returning id into v_id;
  update public.retention_policies p
  set last_run_at = now(), last_count = (p_after -> p.key ->> 'affected')::int
  where p_after ? p.key;
  return v_id;
end;
$$;

revoke execute on function public.retention_log_run(jsonb) from public, anon, authenticated;
grant execute on function public.retention_log_run(jsonb) to service_role;
