create or replace function public.automation_put_recipe(
  p_trigger text,
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
  v_old public.automation_recipes;
  v_new public.automation_recipes;
begin
  -- Invariant 8: one row per event type comes from the seed; this function never inserts.
  select * into v_old from public.automation_recipes where trigger = p_trigger for update;
  if not found then
    raise exception 'unknown_trigger' using errcode = 'P0002';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k <> all (array['name', 'enabled', 'steps'])) then
    raise exception 'invalid_patch_key' using errcode = '22023';
  end if;
  v_new := jsonb_populate_record(v_old, p_patch);
  -- Invariant 7: the revision trigger reads the actor of this transaction.
  perform set_config('mop.actor_id', coalesce(p_actor::text, ''), true);
  perform set_config('mop.actor_kind', coalesce(p_actor_kind::text, ''), true);
  perform set_config('mop.note', coalesce(p_note, ''), true);
  update public.automation_recipes
  set name = v_new.name, enabled = v_new.enabled, steps = v_new.steps
  where id = v_old.id
  returning * into v_new;
  -- SEC-11, ruling H23: an agent's change reaches a human in the same transaction.
  if p_actor_kind = 'agent' then
    perform public.enqueue_job(
      'notify_admin',
      jsonb_build_object(
        'params', jsonb_build_object('headline', 'Agent changed automation'),
        'data', jsonb_build_object('summary', 'recipe ' || p_trigger, 'link_path', '/admin/automation/revisions')
      ),
      'agent_automation:' || p_request_id,
      p_max_attempts => 12
    );
  end if;
  perform public.write_audit(
    p_actor, p_actor_kind, 'automation.recipes_put', 'automation_recipes', v_old.id, to_jsonb(v_old),
    to_jsonb(v_new), p_request_id, p_note
  );
  return to_jsonb(v_new);
end;
$$;

revoke execute on function public.automation_put_recipe(text, jsonb, uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.automation_put_recipe(text, jsonb, uuid, public.actor_kind, text, text)
  to service_role;
