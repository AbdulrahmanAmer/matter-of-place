create or replace function public.audit_record_run(p_actor uuid, p_actor_kind public.actor_kind, p_request_id text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old timestamptz;
  v_new timestamptz;
begin
  -- B14 G9, invariant 3: the auditor's one write. It moves only last_run_at of the audit row and sets no mop.actor_id,
  -- so B8b's revision trigger treats it as a clock tick; audit_log keeps the record.
  select s.last_run_at into v_old from public.schedule_settings s where s.key = 'audit' for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.schedule_settings set last_run_at = now() where key = 'audit' returning last_run_at into v_new;
  perform public.write_audit(
    p_actor, p_actor_kind, 'audit.record_run', 'schedule_settings.audit', null,
    jsonb_build_object('last_run_at', v_old), jsonb_build_object('last_run_at', v_new), p_request_id
  );
  return v_new;
end;
$$;

revoke execute on function public.audit_record_run(uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.audit_record_run(uuid, public.actor_kind, text) to service_role;
