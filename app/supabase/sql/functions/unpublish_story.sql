create or replace function public.unpublish_story(
  p_id uuid,
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
  -- B7 step 12: a live story is archived. B2's `stories_archived_pairing` wants `archived_at` set with the state and
  -- `stories_published_pairing` wants `published_at` cleared.
  select * into v_old from public.stories s where s.id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_old.editorial_state <> 'published' then
    raise exception 'wrong_state';
  end if;

  update public.stories s
  set editorial_state = 'archived', published_at = null, archived_at = now()
  where s.id = p_id
  returning * into v_new;

  perform public.write_audit(
    p_actor, p_actor_kind, 'stories.unpublish', 'story', p_id, to_jsonb(v_old), to_jsonb(v_new), p_request_id
  );
  return jsonb_build_object('id', v_new.id, 'updated_at', v_new.updated_at);
end;
$$;

revoke execute on function public.unpublish_story(uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.unpublish_story(uuid, uuid, public.actor_kind, text) to service_role;
