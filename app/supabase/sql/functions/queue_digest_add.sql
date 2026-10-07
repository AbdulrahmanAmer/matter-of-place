create or replace function public.queue_digest_add(p_property uuid, p_asset uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.assets;
  v_issue public.newsletter_issues;
  v_block jsonb;
  v_at int;
  v_held_revision int;
begin
  -- Invariant 1, mode `add`: the block of an approved newsletter_block asset joins the open draft, one block per
  -- property. The same asset again changes nothing; a newer revision replaces the older block in place, keeping the
  -- line a human wrote above it; an older revision is ignored. No audit row: the job's job_events trace it (G43).
  select * into v_asset
  from public.assets a
  where a.id = p_asset and a.property_id = p_property and a.kind = 'newsletter_block';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_asset.status not in ('approved', 'published') then
    raise exception 'wrong_state' using errcode = '55000';
  end if;
  if coalesce(v_asset.meta -> 'block' ->> 'title', '') = '' then
    raise exception 'asset_incomplete' using errcode = '22023';
  end if;
  -- The caps of the block schema in src/domain/newsletter.ts, so a long deck never makes the draft unreadable.
  v_block := jsonb_build_object(
    'id', 'property:' || p_property,
    'type', 'property',
    'property_id', p_property,
    'asset_id', p_asset,
    'title', left(v_asset.meta -> 'block' ->> 'title', 300),
    'deck', left(coalesce(v_asset.meta -> 'block' ->> 'deck', ''), 300)
  );

  v_issue := public.newsletter_open_draft();
  select b.ordinality - 1, a.revision into v_at, v_held_revision
  from jsonb_array_elements(v_issue.blocks) with ordinality b (value, ordinality)
  left join public.assets a on a.id = (b.value ->> 'asset_id')::uuid
  where b.value ->> 'type' = 'property' and b.value ->> 'property_id' = p_property::text;
  if v_at is null then
    update public.newsletter_issues set blocks = blocks || jsonb_build_array(v_block) where id = v_issue.id;
  elsif coalesce(v_held_revision, 0) < v_asset.revision then
    update public.newsletter_issues
    set blocks = jsonb_set(blocks, array[v_at::text], (blocks -> v_at) || (v_block - 'id'))
    where id = v_issue.id;
  end if;
  return v_issue.id;
end;
$$;

revoke execute on function public.queue_digest_add(uuid, uuid) from public, anon, authenticated;
grant execute on function public.queue_digest_add(uuid, uuid) to service_role;
