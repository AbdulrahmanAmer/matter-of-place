create or replace function public.auto_approve_asset(p_asset_id uuid, p_evidence jsonb, p_request_id text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
begin
  -- B10 invariant 4: the system approves with evidence through B9's function, the only writer of the approval and the
  -- only emitter of asset.approved (G20); this row says the system did it (G43).
  v_event := public.approve_asset(
    p_asset => p_asset_id, p_actor => null, p_actor_kind => null, p_request_id => p_request_id, p_evidence => p_evidence
  );
  perform public.write_audit(
    null, null, 'assets.auto_approve', 'assets', p_asset_id, null, p_evidence, p_request_id, 'system'
  );
  return v_event;
end;
$$;

revoke execute on function public.auto_approve_asset(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.auto_approve_asset(uuid, jsonb, text) to service_role;
