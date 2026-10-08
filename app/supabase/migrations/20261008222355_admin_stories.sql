-- down:
--   drop function public.unpublish_story(uuid, uuid, public.actor_kind, text),
--     public.publish_story(uuid, timestamptz, uuid, public.actor_kind, text),
--     public.save_story(uuid, timestamptz, jsonb, uuid, public.actor_kind, text, text),
--     public.list_stories(integer, public.editorial_state, timestamptz, uuid);
--   drop index public.stories_list_idx;
set lock_timeout = '5s';

-- B7 step 12, screen 14: the story list, save, publish and unpublish. No column is added (B2 created them all, G23).

-- Invariant 17c: the list filters on the state and pages by (updated_at desc, id) on this index.
create index stories_list_idx on public.stories (editorial_state, updated_at desc, id);

create or replace function public.list_stories(
  p_limit integer,
  p_state public.editorial_state default null,
  p_after_updated_at timestamptz default null,
  p_after_id uuid default null
)
returns table (
  id uuid,
  slug text,
  title text,
  category public.story_category,
  market_slug text,
  editorial_state public.editorial_state,
  image text,
  published_at timestamptz,
  updated_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  -- Screen 14 (invariant 17c): one keyset page, last edited first, ordered as the list index `stories_list_idx` is.
  select s.id, s.slug, s.title, s.category, s.market_slug, s.editorial_state, s.image, s.published_at, s.updated_at
  from public.stories s
  where (p_state is null or s.editorial_state = p_state)
    and (
      p_after_updated_at is null
      or s.updated_at < p_after_updated_at
      or (s.updated_at = p_after_updated_at and s.id > p_after_id)
    )
  order by s.updated_at desc, s.id
  limit least(greatest(p_limit, 1), 51);
$$;

revoke execute on function public.list_stories(integer, public.editorial_state, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.list_stories(integer, public.editorial_state, timestamptz, uuid) to service_role;

create or replace function public.save_story(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_image_staging_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The columns an editor writes. `image` and `image_variants` are written by B9's render and B2's seed alone (G55),
  -- the state and its dates by publish_story and unpublish_story.
  v_allowed constant text[] := array['slug', 'title', 'deck', 'category', 'market_slug', 'body', 'properties'];
  v_required constant text[] := array['slug', 'title', 'deck', 'category', 'market_slug'];
  v_old public.stories;
  v_new public.stories;
begin
  -- B7 step 12, screen 14: with p_id null a draft is inserted (B2 keeps `not null` on deck, category and market_slug, so
  -- a missing one is refused before the insert); otherwise the row is locked and the editor's copy must be the stored one.
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
    or exists (select 1 from jsonb_object_keys(p_patch) k where k <> all (v_allowed)) then
    raise exception 'invalid_key';
  end if;

  if p_id is null then
    if exists (select 1 from unnest(v_required) k where btrim(coalesce(p_patch ->> k, '')) = '') then
      raise exception 'invalid_key';
    end if;
    v_new := jsonb_populate_record(null::public.stories, p_patch);
    insert into public.stories (slug, title, deck, category, market_slug, body, properties, author_id)
    values (
      v_new.slug, v_new.title, v_new.deck, v_new.category, v_new.market_slug, coalesce(v_new.body, '{}'),
      coalesce(v_new.properties, '{}'), p_actor
    )
    returning * into v_new;
  else
    select * into v_old from public.stories s where s.id = p_id for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    if v_old.updated_at is distinct from p_expected_updated_at then
      raise exception 'stale';
    end if;
    v_new := jsonb_populate_record(v_old, p_patch);
    -- A story that has been public keeps its address; the properties table has a trigger for this, stories have none.
    if v_new.slug <> v_old.slug and v_old.editorial_state <> 'draft' then
      raise exception 'slug_immutable';
    end if;
    update public.stories s
    set slug = v_new.slug,
      title = v_new.title,
      deck = v_new.deck,
      category = v_new.category,
      market_slug = v_new.market_slug,
      body = v_new.body,
      properties = v_new.properties
    where s.id = p_id
    returning * into v_new;
  end if;

  -- G51: the staged image of this story, queued in the same transaction, whatever the story's state; the row keeps its
  -- current image until the job's onResult writes the new one. The same path twice queues once.
  if p_image_staging_path is not null then
    if left(p_image_staging_path, length('staging/story/' || v_new.slug || '/')) <> 'staging/story/' || v_new.slug || '/' then
      raise exception 'invalid_key';
    end if;
    perform public.enqueue_job(
      'render_variants',
      jsonb_build_object(
        'params', '{}'::jsonb,
        'data', jsonb_build_object('target', 'story', 'slug', v_new.slug, 'staging_path', p_image_staging_path)
      ),
      'render_variants:story:' || v_new.slug || ':' || p_image_staging_path,
      p_heavy => true
    );
  end if;

  perform public.write_audit(
    p_actor, p_actor_kind, 'stories.write', 'story', v_new.id,
    case when p_id is null then null else to_jsonb(v_old) end, to_jsonb(v_new), p_request_id
  );
  return jsonb_build_object('id', v_new.id, 'updated_at', v_new.updated_at);
end;
$$;

revoke execute on function public.save_story(uuid, timestamptz, jsonb, uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.save_story(uuid, timestamptz, jsonb, uuid, public.actor_kind, text, text)
  to service_role;

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
