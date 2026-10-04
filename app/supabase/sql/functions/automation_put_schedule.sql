create or replace function public.automation_put_schedule(
  p_key text,
  p_patch jsonb,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.schedule_settings;
  v_new public.schedule_settings;
begin
  select * into v_old from public.schedule_settings where key = p_key for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- G9: the four keys of the PUT; next_run_at belongs to the scheduler.
  if exists (
    select 1 from jsonb_object_keys(p_patch) k where k <> all (array['cron', 'interval_days', 'enabled', 'last_run_at'])
  ) then
    raise exception 'unknown_field' using errcode = '22023';
  end if;
  v_new := jsonb_populate_record(v_old, p_patch);
  -- Keep-warm, the audit routine and backup.yml run on clocks outside the database.
  if p_key in ('keepwarm', 'audit', 'backup') and v_new.cron is distinct from v_old.cron then
    raise exception 'external_clock' using errcode = '22023';
  end if;
  -- Invariant 12: a changed clock input clears the stored next run, which dueAt then recomputes.
  if (v_new.cron, v_new.interval_days, v_new.last_run_at)
    is distinct from (v_old.cron, v_old.interval_days, v_old.last_run_at) then
    v_new.next_run_at := null;
  end if;
  -- Invariant 7: the revision trigger reads the actor of this transaction.
  perform set_config('mop.actor_id', coalesce(p_actor::text, ''), true);
  perform set_config('mop.actor_kind', coalesce(p_actor_kind::text, ''), true);
  perform set_config('mop.note', coalesce(p_note, ''), true);
  update public.schedule_settings
  set cron = v_new.cron, interval_days = v_new.interval_days, enabled = v_new.enabled,
    last_run_at = v_new.last_run_at, next_run_at = v_new.next_run_at
  where id = v_old.id
  returning * into v_new;
  -- STUB(B8b step 6): unconditional write_audit
  if to_regproc('public.write_audit') is not null then
    perform public.write_audit(
      p_actor, p_actor_kind, 'automation.schedules_put', 'schedule_settings', v_old.id, to_jsonb(v_old),
      to_jsonb(v_new), p_request_id, p_note
    );
  end if;
  return to_jsonb(v_new);
end;
$$;

revoke execute on function public.automation_put_schedule(text, jsonb, uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.automation_put_schedule(text, jsonb, uuid, public.actor_kind, text, text)
  to service_role;
