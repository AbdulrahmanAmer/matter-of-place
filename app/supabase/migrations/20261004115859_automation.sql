-- down:
--   drop function public.claim_schedule(text, boolean, timestamptz, timestamptz, timestamptz),
--     public.open_market_on_publish(uuid, boolean), public.fanout_pending_events(int),
--     public.record_fanout_failure(uuid, text), public.fanout_insert_jobs(uuid, jsonb),
--     public.automation_restore_revision(uuid, uuid, public.actor_kind, text),
--     public.automation_put_schedule(text, jsonb, uuid, public.actor_kind, text, text),
--     public.automation_put_channel(text, jsonb, uuid, public.actor_kind, text, text),
--     public.automation_reorder_reasons(uuid[], uuid, public.actor_kind, text, text),
--     public.automation_put_reason(uuid, jsonb, uuid, public.actor_kind, text, text),
--     public.automation_put_template(text, jsonb, uuid, public.actor_kind, text, text),
--     public.automation_put_recipe(text, jsonb, uuid, public.actor_kind, text, text);
--   alter table public.jobs drop constraint jobs_recipe_id_fkey; drop index public.jobs_recipe_idx;
--   drop trigger decline_reasons_set_updated_at on public.decline_reasons;
--   drop trigger decline_reasons_revision on public.decline_reasons;
--   alter table public.decline_reasons drop column created_at, drop column updated_at;
--   drop table public.event_fanout_failures, public.automation_revisions, public.schedule_settings,
--     public.channel_settings, public.email_templates, public.automation_recipes;
--   drop function public.record_automation_revision(), public.automation_revisions_immutable(),
--     public.automation_recipes_trigger_locked();
set lock_timeout = '5s';

-- B8b step 1: the automation tables of architecture 3.5, their revisions, the put functions of screens 17 to 21, and
-- the fan-out, market-open and schedule-claim functions. Seeds are in <ts>_automation_seed.sql.

-- Invariant 8: one row per event type of architecture 3.6 (the list of B8's events.type check, G29).
create table public.automation_recipes (
  id uuid primary key default gen_random_uuid(),
  trigger text not null unique check (trigger in (
    'submission.received', 'submission.declined', 'submission.accepted', 'submission.awaiting_assets',
    'invoice.issued', 'payment.marked', 'submission.activated', 'property.published', 'property.unpublished',
    'asset.approved', 'asset.rejected', 'digest.due', 'inquiry.received', 'subscriber.created',
    'subscriber.confirmed', 'invoice.voided', 'health.failed', 'subject_request.received'
  )),
  name text not null,
  enabled boolean not null default true,
  version int not null default 1,
  steps jsonb not null default '[]' check (jsonb_typeof(steps) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Rows and content are B5's seed; B5 adds `class` (INT-03).
create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  subject text not null,
  preheader text not null default '',
  body jsonb not null,
  variables text[] not null default '{}',
  enabled boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Invariant 13: wall-time windows carry their zone. credentials_ref is the name of a secret, never a value.
create table public.channel_settings (
  id uuid primary key default gen_random_uuid(),
  channel text not null unique check (channel in ('instagram', 'x', 'linkedin', 'facebook', 'youtube', 'newsletter')),
  enabled boolean not null default false,
  posting_window jsonb not null check (posting_window ? 'tz'),
  approval_mode jsonb not null default '{"Feature": "manual", "Reach": "manual", "Campaign": "manual"}' check (
    approval_mode ->> 'Feature' in ('manual', 'auto')
    and approval_mode ->> 'Reach' in ('manual', 'auto')
    and approval_mode ->> 'Campaign' in ('manual', 'auto')
  ),
  auto_after date,
  credentials_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- G9, invariants 11 and 12: cron and next_run_at are UTC; interval_days carries the fortnightly digest.
create table public.schedule_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key in (
    'digest', 'audit', 'keepwarm', 'prune', 'reconcile', 'backup', 'kpi_weekly', 'newsletter_hygiene'
  )),
  cron text not null,
  interval_days int check (interval_days between 1 and 90),
  enabled boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- B2 created decline_reasons for submissions.decline_reason_id; this file only alters it, and its policies stay B2's.
alter table public.decline_reasons add column if not exists created_at timestamptz not null default now();
alter table public.decline_reasons add column if not exists updated_at timestamptz not null default now();

-- Invariant 7: written only by record_automation_revision, append-only like audit_log (B2 invariant 3).
create table public.automation_revisions (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  row_id uuid not null,
  before jsonb,
  after jsonb,
  actor_id uuid,
  actor_kind public.actor_kind,
  at timestamptz not null default now(),
  note text
);
-- Screen 21 and GET revisions page by `at` (caching contract rule 9).
create index automation_revisions_row_idx on public.automation_revisions (table_name, row_id, at desc);
create index automation_revisions_at_idx on public.automation_revisions (at desc);

-- JOB-07: an event whose fan-out failed waits for next_at; fanout_insert_jobs deletes the row.
create table public.event_fanout_failures (
  event_id uuid primary key references public.events (id) on delete cascade,
  attempts int not null,
  next_at timestamptz not null,
  last_error text
);

-- B8 left jobs.recipe_id open until this table existed.
alter table public.jobs
  add constraint jobs_recipe_id_fkey foreign key (recipe_id) references public.automation_recipes (id)
  on delete set null;
create index jobs_recipe_idx on public.jobs (recipe_id);

-- Function source (DB-13): each text below is its file in supabase/sql/functions.

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

create or replace function public.automation_revisions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'append_only';
end;
$$;

revoke execute on function public.automation_revisions_immutable() from public, anon, authenticated;

create or replace function public.automation_recipes_trigger_locked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.trigger <> old.trigger then
    raise exception 'trigger_locked';
  end if;
  return new;
end;
$$;

revoke execute on function public.automation_recipes_trigger_locked() from public, anon, authenticated;

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
  -- STUB(B8b step 6): unconditional write_audit
  if to_regproc('public.write_audit') is not null then
    perform public.write_audit(
      p_actor, p_actor_kind, 'automation.recipes_put', 'automation_recipes', v_old.id, to_jsonb(v_old),
      to_jsonb(v_new), p_request_id, p_note
    );
  end if;
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
  -- STUB(B8b step 6): unconditional write_audit
  if to_regproc('public.write_audit') is not null then
    perform public.write_audit(
      p_actor, p_actor_kind, 'automation.templates_put', 'email_templates', v_old.id, to_jsonb(v_old),
      to_jsonb(v_new), p_request_id, p_note
    );
  end if;
  return to_jsonb(v_new);
end;
$$;

revoke execute on function public.automation_put_template(text, jsonb, uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.automation_put_template(text, jsonb, uuid, public.actor_kind, text, text)
  to service_role;

create or replace function public.automation_put_reason(
  p_id uuid,
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
  v_old public.decline_reasons;
  v_new public.decline_reasons;
begin
  if exists (
    select 1 from jsonb_object_keys(p_patch) k
    where k <> all (array['code', 'label', 'email_paragraph', 'sort', 'enabled'])
  ) then
    raise exception 'invalid_patch_key' using errcode = '22023';
  end if;
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
  -- STUB(B8b step 6): unconditional write_audit
  if to_regproc('public.write_audit') is not null then
    perform public.write_audit(
      p_actor, p_actor_kind, 'automation.reasons_put', 'decline_reasons', v_new.id,
      case when p_id is null then null else to_jsonb(v_old) end, to_jsonb(v_new), p_request_id, p_note
    );
  end if;
  return to_jsonb(v_new);
end;
$$;

revoke execute on function public.automation_put_reason(uuid, jsonb, uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.automation_put_reason(uuid, jsonb, uuid, public.actor_kind, text, text)
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
  -- STUB(B8b step 6): unconditional write_audit
  if to_regproc('public.write_audit') is not null then
    perform public.write_audit(
      p_actor, p_actor_kind, 'automation.reasons_put', 'decline_reasons', null, v_before, v_after, p_request_id,
      p_note
    );
  end if;
end;
$$;

revoke execute on function public.automation_reorder_reasons(uuid[], uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.automation_reorder_reasons(uuid[], uuid, public.actor_kind, text, text)
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
  -- STUB(B8b step 6): unconditional write_audit
  if to_regproc('public.write_audit') is not null then
    perform public.write_audit(
      p_actor, p_actor_kind, 'automation.channels_put', 'channel_settings', v_old.id, to_jsonb(v_old),
      to_jsonb(v_new), p_request_id, p_note
    );
  end if;
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
  -- STUB(B8b step 6): unconditional write_audit
  if to_regproc('public.write_audit') is not null then
    perform public.write_audit(
      p_actor, p_actor_kind, 'automation.revisions_restore', v_revision.table_name, v_revision.row_id, v_before,
      v_after, p_request_id, null
    );
  end if;
  return v_after;
end;
$$;

revoke execute on function public.automation_restore_revision(uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.automation_restore_revision(uuid, uuid, public.actor_kind, text) to service_role;

create or replace function public.fanout_insert_jobs(p_event_id uuid, p_jobs jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_processed_at timestamptz;
  v_job jsonb;
  v_count int := 0;
begin
  -- JOB-07: the event row is the lock, so two sweeps of one event insert its jobs once.
  select e.processed_at into v_processed_at from public.events e where e.id = p_event_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_processed_at is not null then
    return 0;
  end if;
  -- B8's enqueue_job is the only writer of jobs and job_events (architecture 3.6); a key that exists returns null.
  for v_job in select j.value from jsonb_array_elements(p_jobs) as j loop
    if public.enqueue_job(
      v_job ->> 'type',
      v_job -> 'payload',
      v_job ->> 'idempotency_key',
      coalesce((v_job ->> 'heavy')::boolean, false),
      (v_job ->> 'status')::public.job_status,
      now(),
      p_event_id,
      (v_job ->> 'recipe_id')::uuid,
      v_job ->> 'step_id',
      p_max_attempts => coalesce((v_job ->> 'max_attempts')::int, 5),
      p_local => coalesce((v_job ->> 'run_local')::boolean, false)
    ) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  update public.events set processed_at = now() where id = p_event_id;
  delete from public.event_fanout_failures where event_id = p_event_id;
  return v_count;
end;
$$;

revoke execute on function public.fanout_insert_jobs(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fanout_insert_jobs(uuid, jsonb) to service_role;

create or replace function public.record_fanout_failure(p_event_id uuid, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  -- JOB-07: the sweep waits 2, 4, 8 ... minutes before it plans the event again, at most an hour.
  insert into public.event_fanout_failures as f (event_id, attempts, next_at, last_error)
  values (p_event_id, 1, now() + least(interval '60 seconds' * 2 ^ 1, interval '1 hour'), p_error)
  on conflict (event_id) do update
  set attempts = f.attempts + 1,
    next_at = now() + least(interval '60 seconds' * 2 ^ (f.attempts + 1), interval '1 hour'),
    last_error = excluded.last_error;
$$;

revoke execute on function public.record_fanout_failure(uuid, text) from public, anon, authenticated;
grant execute on function public.record_fanout_failure(uuid, text) to service_role;

create or replace function public.fanout_pending_events(p_limit int)
returns setof public.events
language sql
stable
security definer
set search_path = ''
as $$
  -- JOB-07: the one read of the sweep; an event that failed waits for its next_at.
  select e.*
  from public.events e
  where e.processed_at is null
    and not exists (
      select 1 from public.event_fanout_failures f where f.event_id = e.id and f.next_at > now()
    )
  order by e.at
  limit p_limit;
$$;

revoke execute on function public.fanout_pending_events(int) from public, anon, authenticated;
grant execute on function public.fanout_pending_events(int) to service_role;

create or replace function public.open_market_on_publish(p_property_id uuid, p_notify boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
begin
  -- B2's trigger on markets bumps catalog_version; this function never touches settings.
  update public.markets
  set coming_soon = false
  where slug = (
      select p.market_slug from public.properties p where p.id = p_property_id and p.editorial_state = 'published'
    )
    and coming_soon
  returning slug into v_slug;
  if v_slug is null then
    return null;
  end if;
  -- G43, B3b invariant 4: a system change, so no actor.
  insert into public.audit_log (actor_id, actor_kind, action, entity, note)
  values (null, null, 'market.opened', 'markets', 'system');
  -- G15, G58: the same type, payload and key as B7's set_market_coming_soon, in the transaction that opens it.
  if p_notify then
    perform public.enqueue_job(
      'market_open_notice',
      jsonb_build_object('params', '{}'::jsonb, 'data', jsonb_build_object('market', v_slug)),
      'market_open:' || v_slug
    );
  end if;
  return v_slug;
end;
$$;

revoke execute on function public.open_market_on_publish(uuid, boolean) from public, anon, authenticated;
grant execute on function public.open_market_on_publish(uuid, boolean) to service_role;

create or replace function public.claim_schedule(
  p_key text,
  p_guard boolean,
  p_old_last_run_at timestamptz default null,
  p_last_run_at timestamptz default null,
  p_next_run_at timestamptz default null
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  -- G43: the one write of the schedule clocks. It sets no actor, so the revision trigger records nothing
  -- (invariant 7). The defaults let a caller leave a null time out (P-915).
  with claimed as (
    update public.schedule_settings
    set last_run_at = p_last_run_at, next_run_at = p_next_run_at
    where key = p_key and enabled and (not p_guard or last_run_at is not distinct from p_old_last_run_at)
    returning key
  )
  select exists (select 1 from claimed);
$$;

revoke execute on function public.claim_schedule(text, boolean, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_schedule(text, boolean, timestamptz, timestamptz, timestamptz)
  to service_role;

create trigger automation_recipes_set_updated_at
before update on public.automation_recipes
for each row execute function public.set_updated_at();
create trigger email_templates_set_updated_at
before update on public.email_templates
for each row execute function public.set_updated_at();
create trigger decline_reasons_set_updated_at
before update on public.decline_reasons
for each row execute function public.set_updated_at();
create trigger channel_settings_set_updated_at
before update on public.channel_settings
for each row execute function public.set_updated_at();
create trigger schedule_settings_set_updated_at
before update on public.schedule_settings
for each row execute function public.set_updated_at();

-- B2's function: version rises by one when anything but updated_at and version changes.
create trigger automation_recipes_version_bump
before update on public.automation_recipes
for each row execute function public.properties_version_bump();
create trigger email_templates_version_bump
before update on public.email_templates
for each row execute function public.properties_version_bump();

create trigger automation_recipes_trigger_locked
before update on public.automation_recipes
for each row execute function public.automation_recipes_trigger_locked();

create trigger automation_recipes_revision
after insert or update or delete on public.automation_recipes
for each row execute function public.record_automation_revision();
create trigger email_templates_revision
after insert or update or delete on public.email_templates
for each row execute function public.record_automation_revision();
create trigger decline_reasons_revision
after insert or update or delete on public.decline_reasons
for each row execute function public.record_automation_revision();
create trigger channel_settings_revision
after insert or update or delete on public.channel_settings
for each row execute function public.record_automation_revision();
create trigger schedule_settings_revision
after insert or update or delete on public.schedule_settings
for each row execute function public.record_automation_revision();

create trigger automation_revisions_immutable
before update or delete on public.automation_revisions
for each row execute function public.automation_revisions_immutable();

-- Architecture 3.7: every staff role reads; chief_editor, media_ops and admin write. Recipes have an update policy
-- only (invariant 8), revisions a select policy only, and no table has a delete policy. decline_reasons keeps B2's.
alter table public.automation_recipes enable row level security;
alter table public.email_templates enable row level security;
alter table public.channel_settings enable row level security;
alter table public.schedule_settings enable row level security;
alter table public.automation_revisions enable row level security;
alter table public.event_fanout_failures enable row level security;
revoke all on table public.automation_recipes, public.email_templates, public.channel_settings,
  public.schedule_settings, public.automation_revisions, public.event_fanout_failures from anon, authenticated;
grant all on table public.automation_recipes, public.email_templates, public.channel_settings,
  public.schedule_settings, public.automation_revisions, public.event_fanout_failures to service_role;
grant select on table public.automation_recipes, public.email_templates, public.channel_settings,
  public.schedule_settings, public.automation_revisions to authenticated;
grant update on table public.automation_recipes to authenticated;
grant insert, update on table public.email_templates, public.channel_settings, public.schedule_settings
  to authenticated;

create policy automation_recipes_select_staff on public.automation_recipes for select to authenticated
using (app.is_staff());
create policy automation_recipes_update_automation on public.automation_recipes for update to authenticated
using (app.role_in('chief_editor', 'media_ops', 'admin'));

create policy email_templates_select_staff on public.email_templates for select to authenticated
using (app.is_staff());
create policy email_templates_insert_automation on public.email_templates for insert to authenticated
with check (app.role_in('chief_editor', 'media_ops', 'admin'));
create policy email_templates_update_automation on public.email_templates for update to authenticated
using (app.role_in('chief_editor', 'media_ops', 'admin'));

create policy channel_settings_select_staff on public.channel_settings for select to authenticated
using (app.is_staff());
create policy channel_settings_insert_automation on public.channel_settings for insert to authenticated
with check (app.role_in('chief_editor', 'media_ops', 'admin'));
create policy channel_settings_update_automation on public.channel_settings for update to authenticated
using (app.role_in('chief_editor', 'media_ops', 'admin'));

create policy schedule_settings_select_staff on public.schedule_settings for select to authenticated
using (app.is_staff());
create policy schedule_settings_insert_automation on public.schedule_settings for insert to authenticated
with check (app.role_in('chief_editor', 'media_ops', 'admin'));
create policy schedule_settings_update_automation on public.schedule_settings for update to authenticated
using (app.role_in('chief_editor', 'media_ops', 'admin'));

create policy automation_revisions_select_staff on public.automation_revisions for select to authenticated
using (app.is_staff());
