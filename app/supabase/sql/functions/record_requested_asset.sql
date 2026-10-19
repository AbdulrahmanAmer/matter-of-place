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
