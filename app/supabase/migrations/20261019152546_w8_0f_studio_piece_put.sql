-- down: drop function public.studio_piece_put(uuid, text, text, text, text, text, text, uuid);
set lock_timeout = '5s';

create or replace function public.studio_piece_put(
  p_id uuid,
  p_title text,
  p_owner text,
  p_state text,
  p_folder text,
  p_note text,
  p_preview_key text default null,
  p_asset_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before text;
begin
  -- W8 0f: the laptop runner keeps one row per studio piece in step with the piece's folder (scripts/workforce/reel.ts).
  -- It is an upsert by the brief's id, so it can run again for a piece whose last write failed; a change of state is
  -- audited once. Nothing here reads the piece's files or words: the row holds a title, a handle, a state, a folder name.
  if p_id is null
    or coalesce(btrim(p_title), '') = ''
    or coalesce(btrim(p_owner), '') = ''
    or coalesce(btrim(p_folder), '') = ''
    or p_state is null
    or p_state not in ('queued', 'working', 'draft', 'waiting_operator', 'approved', 'done', 'failed')
  then
    raise exception 'bad_request';
  end if;
  select s.state into v_before from public.studio_pieces s where s.id = p_id for update;
  insert into public.studio_pieces (id, title, owner_slug, state, folder, preview_key, asset_id, note)
  values (p_id, p_title, p_owner, p_state, p_folder, p_preview_key, p_asset_id, coalesce(p_note, ''))
  on conflict (id) do update
  set title = excluded.title,
      owner_slug = excluded.owner_slug,
      state = excluded.state,
      folder = excluded.folder,
      preview_key = excluded.preview_key,
      asset_id = excluded.asset_id,
      note = excluded.note,
      updated_at = now();
  if v_before is distinct from p_state then
    insert into public.audit_log (actor_id, actor_kind, action, entity, entity_id, before, after, note)
    values (
      null, null, 'studio.state', 'studio_pieces', p_id,
      case when v_before is null then null else jsonb_build_object('state', v_before) end,
      jsonb_build_object('state', p_state), null
    );
  end if;
end;
$$;

revoke execute on function public.studio_piece_put(uuid, text, text, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.studio_piece_put(uuid, text, text, text, text, text, text, uuid)
  to service_role;
