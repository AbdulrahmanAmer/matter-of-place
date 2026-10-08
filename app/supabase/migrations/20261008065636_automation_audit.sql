-- down: re-run bun run db:fn automation_put_recipe automation_put_template automation_put_channel automation_put_schedule automation_put_reason automation_reorder_reasons automation_restore_revision settings_put_flags from the previous commit of supabase/sql/functions/automation_put_recipe.sql, supabase/sql/functions/automation_put_template.sql, supabase/sql/functions/automation_put_channel.sql, supabase/sql/functions/automation_put_schedule.sql, supabase/sql/functions/automation_put_reason.sql, supabase/sql/functions/automation_reorder_reasons.sql, supabase/sql/functions/automation_restore_revision.sql, supabase/sql/functions/settings_put_flags.sql
set lock_timeout = '5s';

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

create or replace function public.automation_put_template(
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
  v_old public.email_templates;
  v_new public.email_templates;
begin
  -- Rows come from B5's seed; admins edit and never create them.
  select * into v_old from public.email_templates where key = p_key for update;
  if not found then
    raise exception 'unknown_template' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_patch) k where k <> all (array['subject', 'preheader', 'body', 'enabled'])
  ) then
    raise exception 'invalid_patch_key' using errcode = '22023';
  end if;
  v_new := jsonb_populate_record(v_old, p_patch);
  -- Invariant 7: the revision trigger reads the actor of this transaction.
  perform set_config('mop.actor_id', coalesce(p_actor::text, ''), true);
  perform set_config('mop.actor_kind', coalesce(p_actor_kind::text, ''), true);
  perform set_config('mop.note', coalesce(p_note, ''), true);
  update public.email_templates
  set subject = v_new.subject, preheader = v_new.preheader, body = v_new.body, enabled = v_new.enabled
  where id = v_old.id
  returning * into v_new;
  -- SEC-11, ruling H23: an agent's change reaches a human in the same transaction.
  if p_actor_kind = 'agent' then
    perform public.enqueue_job(
      'notify_admin',
      jsonb_build_object(
        'params', jsonb_build_object('headline', 'Agent changed automation'),
        'data', jsonb_build_object('summary', 'template ' || p_key, 'link_path', '/admin/automation/revisions')
      ),
      'agent_automation:' || p_request_id,
      p_max_attempts => 12
    );
  end if;
  perform public.write_audit(
    p_actor, p_actor_kind, 'automation.templates_put', 'email_templates', v_old.id, to_jsonb(v_old),
    to_jsonb(v_new), p_request_id, p_note
  );
  return to_jsonb(v_new);
end;
$$;

revoke execute on function public.automation_put_template(text, jsonb, uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.automation_put_template(text, jsonb, uuid, public.actor_kind, text, text)
  to service_role;

create or replace function public.automation_put_channel(
  p_channel text,
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
  v_old public.channel_settings;
  v_new public.channel_settings;
begin
  select * into v_old from public.channel_settings where channel = p_channel for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_patch) k
    where k <> all (array['enabled', 'posting_window', 'approval_mode', 'auto_after', 'credentials_ref'])
  ) then
    raise exception 'invalid_patch_key' using errcode = '22023';
  end if;
  v_new := jsonb_populate_record(v_old, p_patch);
  -- Invariant 7: the revision trigger reads the actor of this transaction.
  perform set_config('mop.actor_id', coalesce(p_actor::text, ''), true);
  perform set_config('mop.actor_kind', coalesce(p_actor_kind::text, ''), true);
  perform set_config('mop.note', coalesce(p_note, ''), true);
  update public.channel_settings
  set enabled = v_new.enabled, posting_window = v_new.posting_window, approval_mode = v_new.approval_mode,
    auto_after = v_new.auto_after, credentials_ref = v_new.credentials_ref
  where id = v_old.id
  returning * into v_new;
  perform public.write_audit(
    p_actor, p_actor_kind, 'automation.channels_put', 'channel_settings', v_old.id, to_jsonb(v_old),
    to_jsonb(v_new), p_request_id, p_note
  );
  return to_jsonb(v_new);
end;
$$;

revoke execute on function public.automation_put_channel(text, jsonb, uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.automation_put_channel(text, jsonb, uuid, public.actor_kind, text, text)
  to service_role;

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
  perform public.write_audit(
    p_actor, p_actor_kind, 'automation.schedules_put', 'schedule_settings', v_old.id, to_jsonb(v_old),
    to_jsonb(v_new), p_request_id, p_note
  );
  return to_jsonb(v_new);
end;
$$;

revoke execute on function public.automation_put_schedule(text, jsonb, uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.automation_put_schedule(text, jsonb, uuid, public.actor_kind, text, text)
  to service_role;

drop function if exists public.automation_put_reason(p_id uuid, p_patch jsonb, p_actor uuid, p_actor_kind public.actor_kind, p_request_id text, p_note text);

create or replace function public.automation_put_reason(
  p_patch jsonb,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_note text default null,
  p_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.decline_reasons;
  v_new public.decline_reasons;
begin
  if exists (
    select 1 from jsonb_object_keys(p_patch) k
    where k <> all (array['code', 'label', 'email_paragraph', 'sort', 'enabled'])
  ) then
    raise exception 'invalid_patch_key' using errcode = '22023';
  end if;
  -- A null p_id inserts a new reason; it is the last argument with a default, so a typed client leaves it out (P-721).
  if p_id is not null then
    select * into v_old from public.decline_reasons where id = p_id for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;
  -- Invariant 7: the revision trigger reads the actor of this transaction.
  perform set_config('mop.actor_id', coalesce(p_actor::text, ''), true);
  perform set_config('mop.actor_kind', coalesce(p_actor_kind::text, ''), true);
  perform set_config('mop.note', coalesce(p_note, ''), true);
  if p_id is null then
    v_new := jsonb_populate_record(null::public.decline_reasons, p_patch);
    -- A new reason goes last in the list of screen 19.
    insert into public.decline_reasons (code, label, email_paragraph, sort, enabled)
    values (
      v_new.code, v_new.label, v_new.email_paragraph,
      coalesce(v_new.sort, (select coalesce(max(r.sort), 0) + 1 from public.decline_reasons r)),
      coalesce(v_new.enabled, true)
    )
    returning * into v_new;
  else
    v_new := jsonb_populate_record(v_old, p_patch);
    update public.decline_reasons
    set code = v_new.code, label = v_new.label, email_paragraph = v_new.email_paragraph, sort = v_new.sort,
      enabled = v_new.enabled
    where id = p_id
    returning * into v_new;
  end if;
  perform public.write_audit(
    p_actor, p_actor_kind, 'automation.reasons_put', 'decline_reasons', v_new.id,
    case when p_id is null then null else to_jsonb(v_old) end, to_jsonb(v_new), p_request_id, p_note
  );
  return to_jsonb(v_new);
end;
$$;

revoke execute on function public.automation_put_reason(jsonb, uuid, public.actor_kind, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.automation_put_reason(jsonb, uuid, public.actor_kind, text, text, uuid)
  to service_role;

create or replace function public.automation_reorder_reasons(
  p_ids uuid[],
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  -- The list names every reason exactly once.
  if (select array_agg(r.id order by r.id) from public.decline_reasons r)
    is distinct from (select array_agg(u.id order by u.id) from unnest(p_ids) as u (id)) then
    raise exception 'reorder_mismatch' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object('id', r.id, 'sort', r.sort) order by r.sort, r.id) into v_before
  from public.decline_reasons r;
  -- Invariant 7: the revision trigger reads the actor of this transaction.
  perform set_config('mop.actor_id', coalesce(p_actor::text, ''), true);
  perform set_config('mop.actor_kind', coalesce(p_actor_kind::text, ''), true);
  perform set_config('mop.note', coalesce(p_note, ''), true);
  -- One statement; a row whose position is unchanged is not written, so it records no revision.
  update public.decline_reasons r
  set sort = o.position::int
  from unnest(p_ids) with ordinality as o (id, position)
  where r.id = o.id and r.sort is distinct from o.position::int;
  select jsonb_agg(jsonb_build_object('id', r.id, 'sort', r.sort) order by r.sort, r.id) into v_after
  from public.decline_reasons r;
  perform public.write_audit(
    p_actor, p_actor_kind, 'automation.reasons_put', 'decline_reasons', null, v_before, v_after, p_request_id,
    p_note
  );
end;
$$;

revoke execute on function public.automation_reorder_reasons(uuid[], uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.automation_reorder_reasons(uuid[], uuid, public.actor_kind, text, text)
  to service_role;

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

create or replace function public.settings_put_flags(
  p_value jsonb,
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
  v_before jsonb;
  v_after jsonb;
begin
  -- Invariant 14: the closed set of names is checked in TS (`flagsPutSchema`); here every value is a boolean.
  if jsonb_typeof(p_value) is distinct from 'object'
    or exists (select 1 from jsonb_each(p_value) e where jsonb_typeof(e.value) <> 'boolean') then
    raise exception 'validation' using errcode = '22023';
  end if;
  select s.value into v_before from public.settings s where s.key = 'flags' for update;
  -- A flag the request leaves out keeps its stored value.
  v_after := coalesce(v_before, '{}'::jsonb) || p_value;
  -- B2's trigger on settings bumps catalog_version in this same transaction (F25 a).
  insert into public.settings (key, value) values ('flags', v_after)
  on conflict (key) do update set value = excluded.value;
  perform public.write_audit(
    p_actor, p_actor_kind, 'automation.flags_put', 'settings.flags', null, v_before, v_after, p_request_id
  );
  return v_after;
end;
$$;

revoke execute on function public.settings_put_flags(jsonb, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.settings_put_flags(jsonb, uuid, public.actor_kind, text) to service_role;
