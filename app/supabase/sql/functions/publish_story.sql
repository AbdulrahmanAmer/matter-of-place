create or replace function public.publish_story(
  p_id uuid,
  p_expected_updated_at timestamptz,
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
  v_old public.stories;
  v_new public.stories;
begin
  -- B7 step 12: counted against an agent's daily publishes, then the lock and the copy the editor read. A story that
  -- was unpublished (archived) may be published again; one that is live may not (R22).
  perform public.assert_agent_daily_cap(p_actor, p_actor_kind, 'publish');
  select * into v_old from public.stories s where s.id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale';
  end if;
  if v_old.editorial_state = 'published' then
    raise exception 'wrong_state';
  end if;
  -- G55: the public pages show the image, so a story without one is not published.
  if v_old.image is null then
    raise exception 'publish_incomplete' using errcode = '23514', detail = 'Missing: image';
  end if;

  -- One update, so B2's trigger raises catalog_version once (F25 a).
  update public.stories s
  set editorial_state = 'published', published_at = now(), archived_at = null
  where s.id = p_id
  returning * into v_new;

  perform public.write_audit(
    p_actor, p_actor_kind, 'stories.publish', 'story', p_id, to_jsonb(v_old), to_jsonb(v_new), p_request_id
  );
  return jsonb_build_object('id', v_new.id, 'updated_at', v_new.updated_at);
end;
$$;

revoke execute on function public.publish_story(uuid, timestamptz, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.publish_story(uuid, timestamptz, uuid, public.actor_kind, text) to service_role;
