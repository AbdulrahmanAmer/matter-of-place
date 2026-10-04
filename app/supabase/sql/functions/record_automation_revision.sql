create or replace function public.record_automation_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Invariant 7: the clock columns the runner, keep-warm and backup.yml move with no actor.
  v_clock constant text[] := array['last_run_at', 'next_run_at', 'updated_at'];
  v_actor uuid := nullif(current_setting('mop.actor_id', true), '')::uuid;
  v_before jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_after jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and tg_table_name = 'schedule_settings' and v_actor is null
    and v_before - v_clock = v_after - v_clock then
    return null;
  end if;
  insert into public.automation_revisions (table_name, row_id, before, after, actor_id, actor_kind, note)
  values (
    tg_table_name,
    (coalesce(v_after, v_before) ->> 'id')::uuid,
    v_before,
    v_after,
    v_actor,
    nullif(current_setting('mop.actor_kind', true), '')::public.actor_kind,
    coalesce(nullif(current_setting('mop.note', true), ''), case when v_actor is null then 'direct' end)
  );
  return null;
end;
$$;

revoke execute on function public.record_automation_revision() from public, anon, authenticated;
