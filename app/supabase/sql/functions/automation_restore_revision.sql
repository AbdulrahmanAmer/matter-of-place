create or replace function public.automation_restore_revision(
  p_revision_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision public.automation_revisions;
  v_before jsonb;
  v_after jsonb;
  v_recipe public.automation_recipes;
  v_template public.email_templates;
  v_reason public.decline_reasons;
  v_channel public.channel_settings;
  v_schedule public.schedule_settings;
begin
  select * into v_revision from public.automation_revisions where id = p_revision_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_revision.before is null then
    raise exception 'nothing_to_restore' using errcode = '22023';
  end if;
  -- Invariant 7: the trigger records the restore as one new revision with this note.
  perform set_config('mop.actor_id', coalesce(p_actor::text, ''), true);
  perform set_config('mop.actor_kind', coalesce(p_actor_kind::text, ''), true);
  perform set_config('mop.note', 'restore:' || p_revision_id, true);
  -- Only the editable columns are written back: never id, trigger, key, channel, version or a timestamp.
  case v_revision.table_name
    when 'automation_recipes' then
      select * into v_recipe from public.automation_recipes where id = v_revision.row_id for update;
      if not found then
        raise exception 'not_found' using errcode = 'P0002';
      end if;
      v_before := to_jsonb(v_recipe);
      v_recipe := jsonb_populate_record(v_recipe, v_revision.before);
      update public.automation_recipes
      set name = v_recipe.name, enabled = v_recipe.enabled, steps = v_recipe.steps
      where id = v_revision.row_id
      returning * into v_recipe;
      v_after := to_jsonb(v_recipe);
    when 'email_templates' then
      select * into v_template from public.email_templates where id = v_revision.row_id for update;
      if not found then
        raise exception 'not_found' using errcode = 'P0002';
      end if;
      v_before := to_jsonb(v_template);
      v_template := jsonb_populate_record(v_template, v_revision.before);
      update public.email_templates
      set subject = v_template.subject, preheader = v_template.preheader, body = v_template.body,
        enabled = v_template.enabled
      where id = v_revision.row_id
      returning * into v_template;
      v_after := to_jsonb(v_template);
    when 'decline_reasons' then
      select * into v_reason from public.decline_reasons where id = v_revision.row_id for update;
      if not found then
        raise exception 'not_found' using errcode = 'P0002';
      end if;
      v_before := to_jsonb(v_reason);
      v_reason := jsonb_populate_record(v_reason, v_revision.before);
      update public.decline_reasons
      set code = v_reason.code, label = v_reason.label, email_paragraph = v_reason.email_paragraph,
        sort = v_reason.sort, enabled = v_reason.enabled
      where id = v_revision.row_id
      returning * into v_reason;
      v_after := to_jsonb(v_reason);
    when 'channel_settings' then
      select * into v_channel from public.channel_settings where id = v_revision.row_id for update;
      if not found then
        raise exception 'not_found' using errcode = 'P0002';
      end if;
      v_before := to_jsonb(v_channel);
      v_channel := jsonb_populate_record(v_channel, v_revision.before);
      -- The database copy of the agent guardrail (SEC-11): automatic posting is a human decision.
      if p_actor_kind = 'agent' and (
        v_channel.auto_after is distinct from (v_before ->> 'auto_after')::date
        or exists (
          select 1 from jsonb_each_text(v_channel.approval_mode) m
          where m.value = 'auto' and (v_before -> 'approval_mode' ->> m.key) is distinct from 'auto'
        )
      ) then
        raise exception 'human_only' using errcode = '42501';
      end if;
      update public.channel_settings
      set enabled = v_channel.enabled, posting_window = v_channel.posting_window,
        approval_mode = v_channel.approval_mode, auto_after = v_channel.auto_after,
        credentials_ref = v_channel.credentials_ref
      where id = v_revision.row_id
      returning * into v_channel;
      v_after := to_jsonb(v_channel);
    when 'schedule_settings' then
      select * into v_schedule from public.schedule_settings where id = v_revision.row_id for update;
      if not found then
        raise exception 'not_found' using errcode = 'P0002';
      end if;
      v_before := to_jsonb(v_schedule);
      v_schedule := jsonb_populate_record(v_schedule, v_revision.before);
      if v_schedule.key in ('keepwarm', 'audit', 'backup') and v_schedule.cron is distinct from v_before ->> 'cron' then
        raise exception 'external_clock' using errcode = '22023';
      end if;
      update public.schedule_settings
      set cron = v_schedule.cron, interval_days = v_schedule.interval_days, enabled = v_schedule.enabled,
        last_run_at = v_schedule.last_run_at,
        next_run_at = case
          when (v_schedule.cron, v_schedule.interval_days, v_schedule.last_run_at)
            is distinct from (cron, interval_days, last_run_at) then null
          else next_run_at
        end
      where id = v_revision.row_id
      returning * into v_schedule;
      v_after := to_jsonb(v_schedule);
  end case;
  perform public.write_audit(
    p_actor, p_actor_kind, 'automation.revisions_restore', v_revision.table_name, v_revision.row_id, v_before,
    v_after, p_request_id, null
  );
  return v_after;
end;
$$;

revoke execute on function public.automation_restore_revision(uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.automation_restore_revision(uuid, uuid, public.actor_kind, text) to service_role;
