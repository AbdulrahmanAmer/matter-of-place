-- down: re-run bun run db:fn record_requested_asset record_requested_reel retention_requested_visuals retention_delete_assets from the previous commit of supabase/sql/functions/record_requested_asset.sql, supabase/sql/functions/record_requested_reel.sql, supabase/sql/functions/retention_requested_visuals.sql, supabase/sql/functions/retention_delete_assets.sql
set lock_timeout = '5s';

create or replace function public.record_requested_asset(
  p_subject text,
  p_kind public.asset_kind,
  p_files jsonb,
  p_caption text,
  p_alt_text text,
  p_meta jsonb,
  p_property uuid default null,
  p_market text default null,
  p_story uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := p_subject || ':' || coalesce(p_property::text, p_market, p_story::text, 'brand');
  v_revision int;
  v_id uuid;
begin
  -- W7 item 19 and W8 item 1 (H107): a visual a colleague or Matter asked for, made and gated on the operator's laptop,
  -- waits in Visuals as a pending asset of its subject: a reel, or a still post (a carousel, a story, a cover). The
  -- table's check refuses a subject without its column; approval works as for any asset of the kind.
  if p_kind not in ('cover', 'carousel', 'story', 'reel') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) = 0 then
    raise exception 'requested_asset_files' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('assets:requested:' || p_kind::text || ':' || v_key));
  select coalesce(max(a.revision), 0) + 1 into v_revision
  from public.assets a
  where a.kind = p_kind
    and a.subject = p_subject
    and a.property_id is not distinct from p_property
    and a.market_slug is not distinct from p_market
    and a.story_id is not distinct from p_story;
  insert into public.assets (subject, property_id, market_slug, story_id, kind, revision, files, caption, alt_text, meta)
  values (
    p_subject, p_property, p_market, p_story, p_kind, v_revision, p_files, p_caption, p_alt_text,
    coalesce(p_meta, '{}'::jsonb)
  )
  returning id into v_id;
  insert into public.audit_log (actor_id, actor_kind, action, entity, entity_id, before, after, note)
  values (
    null, null, case when p_kind = 'reel' then 'assets.request_reel' else 'assets.request_post' end, 'assets', v_id,
    null, jsonb_build_object('subject', p_subject, 'kind', p_kind, 'revision', v_revision, 'status', 'pending'), null
  );
  return v_id;
end;
$$;

revoke execute on function public.record_requested_asset(
  text, public.asset_kind, jsonb, text, text, jsonb, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.record_requested_asset(
  text, public.asset_kind, jsonb, text, text, jsonb, uuid, text, uuid
) to service_role;

create or replace function public.record_requested_reel(
  p_subject text,
  p_files jsonb,
  p_caption text,
  p_alt_text text,
  p_meta jsonb,
  p_property uuid default null,
  p_market text default null,
  p_story uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- W7 item 19 (H107): a reel a colleague or Matter asked for. W8 item 1: written by record_requested_asset, the one
  -- writer of every requested visual; this name stays for the reel pass, with its own refusal of a reel without files.
  if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) = 0 then
    raise exception 'requested_reel_files' using errcode = '22023';
  end if;
  return public.record_requested_asset(
    p_subject, 'reel', p_files, p_caption, p_alt_text, p_meta, p_property, p_market, p_story
  );
end;
$$;

revoke execute on function public.record_requested_reel(text, jsonb, text, text, jsonb, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_requested_reel(text, jsonb, text, text, jsonb, uuid, text, uuid)
  to service_role;

create or replace function public.retention_requested_visuals(p_keep interval)
returns table (asset_id uuid, media_keys text[])
language sql
stable
security definer
set search_path = ''
as $$
  -- W8 item 1, GD-03: a visual made on request (a reel or a still post about a market, a story or the brand, H107) that
  -- a person rejected and nobody touched for p_keep, with the keys of its files under `requested/` in bucket `media`.
  -- A property's asset goes with its property, and an asset any post points at stays with that post. It lists only;
  -- retention.ts removes the files and then the rows whose files are gone.
  select a.id,
    coalesce(
      array_agg(f.file ->> 'media_key') filter (where f.file ->> 'media_key' like 'requested/%'),
      '{}'
    )
  from public.assets a
  left join lateral jsonb_array_elements(a.files) as f (file) on true
  where a.subject <> 'property'
    and a.status = 'rejected'
    and a.meta ? 'request_id'
    and a.updated_at < now() - p_keep
    and not exists (select 1 from public.social_posts s where s.asset_id = a.id)
    and not exists (select 1 from public.proposed_post_channels c where c.asset_id = a.id)
  group by a.id
  order by a.id;
$$;

revoke execute on function public.retention_requested_visuals(interval) from public, anon, authenticated;
grant execute on function public.retention_requested_visuals(interval) to service_role;

create or replace function public.retention_delete_assets(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keep interval;
  v_count int;
begin
  -- W8 item 1, GD-03: retention.ts passes only the ids whose files are already removed. The rule of
  -- retention_requested_visuals is checked again here, with the policy row's own period, so no other asset can be
  -- named: a disabled policy deletes nothing.
  select keep_for into v_keep
  from public.retention_policies
  where key = 'rejected_requested_visuals' and enabled and keep_for is not null;
  if not found then
    return 0;
  end if;
  perform set_config('mop.retention', 'on', true);
  with gone as (
    delete from public.assets a
    where a.id = any(p_ids)
      and a.subject <> 'property'
      and a.status = 'rejected'
      and a.meta ? 'request_id'
      and a.updated_at < now() - v_keep
      and not exists (select 1 from public.social_posts s where s.asset_id = a.id)
      and not exists (select 1 from public.proposed_post_channels c where c.asset_id = a.id)
    returning 1
  )
  select count(*)::int into v_count from gone;
  perform set_config('mop.retention', 'off', true);
  return v_count;
end;
$$;

revoke execute on function public.retention_delete_assets(uuid[]) from public, anon, authenticated;
grant execute on function public.retention_delete_assets(uuid[]) to service_role;
