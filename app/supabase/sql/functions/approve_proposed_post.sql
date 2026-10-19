create or replace function public.approve_proposed_post(
  p_id uuid,
  p_revision integer,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.proposed_posts;
  v_channel public.proposed_post_channels;
  v_subject text;
  v_kind public.asset_kind;
  v_role text;
  v_files jsonb;
  v_alt text;
  v_asset_revision integer;
  v_asset uuid;
  v_event uuid;
  v_social public.social_posts;
  v_events uuid[] := '{}';
  v_socials uuid[] := '{}';
begin
  -- W8 item 10 (H116, H117): a person's yes, for the exact revision they saw. Each channel becomes an approved asset
  -- of the post's subject (approve_asset audits it and emits asset.approved, whose recipe runs the post steps) and the
  -- social_posts row the channel posting reads (schedule_social_post). Nothing posts without a person for the first
  -- 60 days: an agent or the system is refused here as approve_asset would refuse it without evidence.
  if p_actor is null or p_actor_kind is distinct from 'human' then
    raise exception 'manual_approval' using errcode = '42501', detail = 'A person approves a post.';
  end if;
  select * into v_post from public.proposed_posts p where p.id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_post.status <> 'proposed' then
    raise exception 'wrong_state' using errcode = '55000', detail = 'Only a proposed post can be approved.';
  end if;
  if v_post.revision is distinct from p_revision then
    raise exception 'version_conflict' using detail = 'This post changed since it was opened.';
  end if;
  v_subject := case when v_post.property_id is null then 'brand' else 'property' end;

  for v_channel in
    select * from public.proposed_post_channels c
    where c.post_id = p_id and c.revision = v_post.revision
    order by c.channel
  loop
    -- The asset model of B9: a carousel's slides (LinkedIn's set), a cover's one file per channel, a reel's video and
    -- poster. An Instagram single image is a cover's one slide, never its `main` file: approve_asset makes a cover's
    -- main file the property's Open Graph image, and a post must not change the dossier's share card.
    v_kind := case v_channel.format when 'reel' then 'reel' when 'carousel' then 'carousel' else 'cover' end;
    v_role := case
      when v_channel.format = 'carousel' and v_channel.channel = 'linkedin' then 'linkedin_set'
      when v_channel.format = 'carousel' or v_channel.channel = 'instagram' then 'slide'
      else v_channel.channel
    end;
    if v_channel.format = 'reel' then
      select jsonb_agg(
        jsonb_build_object(
          'media_key', f.file ->> 'key', 'w', (f.file ->> 'w')::int, 'h', (f.file ->> 'h')::int,
          'bytes', (f.file ->> 'bytes')::bigint, 'role', f.role
        )
        order by f.ord
      )
      into v_files
      from (
        select v_channel.media #> '{reel,video}' as file, 'video' as role, 1 as ord
        union all
        select v_channel.media #> '{reel,poster}', 'poster', 2
        where jsonb_typeof(v_channel.media #> '{reel,poster}') = 'object'
      ) f;
      v_alt := coalesce(v_channel.media #>> '{reel,poster,alt}', v_channel.media #>> '{reel,video,alt}');
    else
      select jsonb_agg(
        jsonb_build_object(
          'media_key', i.value ->> 'key', 'w', (i.value ->> 'w')::int, 'h', (i.value ->> 'h')::int,
          'bytes', (i.value ->> 'bytes')::bigint, 'role', v_role
        ) || case when v_role in ('slide', 'linkedin_set') then jsonb_build_object('index', i.ord - 1) else '{}'::jsonb end
        order by i.ord
      )
      into v_files
      from jsonb_array_elements(v_channel.media -> 'images') with ordinality as i (value, ord);
      v_alt := v_channel.media #>> '{images,0,alt}';
    end if;

    perform pg_advisory_xact_lock(hashtext('assets:proposed:' || coalesce(v_post.property_id::text, 'brand') || ':' || v_kind));
    select coalesce(max(a.revision), 0) + 1 into v_asset_revision
    from public.assets a
    where a.subject = v_subject and a.property_id is not distinct from v_post.property_id and a.kind = v_kind;
    insert into public.assets (subject, property_id, kind, revision, files, caption, alt_text, meta)
    values (
      v_subject, v_post.property_id, v_kind, v_asset_revision, v_files, v_channel.caption, v_alt,
      jsonb_build_object(
        'proposed_post', jsonb_build_object(
          'id', p_id, 'revision', v_post.revision, 'channel', v_channel.channel, 'test', v_post.test,
          'submission_id', v_post.submission_id
        ),
        'captions', jsonb_build_object(v_channel.channel, v_channel.caption)
      )
    )
    returning id into v_asset;
    v_event := public.approve_asset(v_asset, p_actor, p_actor_kind, p_request_id, null);
    v_social := public.schedule_social_post(v_asset, v_channel.channel, now());
    -- A test post never goes out (H117): its rows are closed as cancelled here, never left for the reconcile's overdue.
    if v_post.test then
      perform public.fail_social_post(v_social.id, 'cancelled');
    end if;
    update public.proposed_post_channels set asset_id = v_asset, social_post_id = v_social.id where id = v_channel.id;
    v_events := array_append(v_events, v_event);
    v_socials := array_append(v_socials, v_social.id);
  end loop;

  -- An approved test post has nothing scheduled, so it stays `approved`.
  update public.proposed_posts
  set status = case when v_post.test then 'approved' else 'scheduled' end::public.proposed_post_status,
    approved_by = p_actor, approved_at = now()
  where id = p_id;
  perform public.write_audit(
    p_actor, p_actor_kind, 'channels.proposed_approve', 'proposed_posts', p_id,
    jsonb_build_object('status', v_post.status),
    jsonb_build_object(
      'status', case when v_post.test then 'approved' else 'scheduled' end, 'revision', v_post.revision
    ),
    p_request_id
  );
  return jsonb_build_object('post_id', p_id, 'event_ids', to_jsonb(v_events), 'social_post_ids', to_jsonb(v_socials));
end;
$$;

revoke execute on function public.approve_proposed_post(uuid, integer, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.approve_proposed_post(uuid, integer, uuid, public.actor_kind, text) to service_role;
