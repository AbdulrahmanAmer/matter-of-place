-- down: re-run bun run db:fn proposed_post_put_channels create_proposed_post revise_proposed_post reject_proposed_post approve_proposed_post proposed_post_follow_social from the previous commit of supabase/sql/functions/proposed_post_put_channels.sql, supabase/sql/functions/create_proposed_post.sql, supabase/sql/functions/revise_proposed_post.sql, supabase/sql/functions/reject_proposed_post.sql, supabase/sql/functions/approve_proposed_post.sql, supabase/sql/functions/proposed_post_follow_social.sql
set lock_timeout = '5s';

create or replace function public.proposed_post_put_channels(p_post uuid, p_revision integer, p_channels jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_channel text;
  v_label text;
  v_format text;
  v_caption text;
  v_images jsonb;
  v_reel jsonb;
  v_limit integer;
  v_count integer;
  v_min integer;
  v_max integer;
  v_file jsonb;
  v_files jsonb;
  v_seen text[] := '{}';
begin
  -- W8 item 10 (H116, H117): the channel rules of src/domain/proposed-posts.ts, enforced again here because the
  -- laptop runner files a colleague's post through create_proposed_post without the admin service. Each refusal names
  -- its reason in the detail, which fromRpcError hands to the person.
  if jsonb_typeof(p_channels) is distinct from 'array' or jsonb_array_length(p_channels) = 0 then
    raise exception 'validation' using errcode = '22023', detail = 'A proposed post needs at least one channel.';
  end if;
  for v_item in select value from jsonb_array_elements(p_channels) loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'validation' using errcode = '22023', detail = 'Each channel is an object.';
    end if;
    v_channel := v_item ->> 'channel';
    if v_channel in ('facebook', 'youtube') then
      raise exception 'channel_disabled' using errcode = '22023',
        detail = (case v_channel when 'facebook' then 'Facebook' else 'YouTube' end) || ' is a disabled channel block.';
    end if;
    if v_channel is null or v_channel not in ('instagram', 'x', 'linkedin') then
      raise exception 'validation' using errcode = '22023', detail = 'Each channel is Instagram, X or LinkedIn.';
    end if;
    v_label := case v_channel when 'instagram' then 'Instagram' when 'x' then 'X' else 'LinkedIn' end;
    if v_channel = any (v_seen) then
      raise exception 'validation' using errcode = '22023', detail = v_label || ' is named twice.';
    end if;
    v_seen := array_append(v_seen, v_channel);

    v_format := v_item ->> 'format';
    if v_format is null or v_format not in ('carousel', 'single', 'reel') then
      raise exception 'invalid_format' using errcode = '22023',
        detail = v_label || ' takes a carousel, a single image or a reel.';
    end if;

    v_caption := btrim(coalesce(v_item ->> 'caption', ''));
    v_limit := case v_channel when 'x' then 280 when 'instagram' then 2200 else 3000 end;
    if v_caption = '' then
      raise exception 'validation' using errcode = '22023', detail = v_label || ' needs a caption.';
    end if;
    if char_length(v_caption) > v_limit then
      raise exception 'caption_too_long' using errcode = '22023',
        detail = format(
          '%s captions are at most %s characters; this one has %s.', v_label, v_limit, char_length(v_caption)
        );
    end if;

    v_images := coalesce(v_item -> 'images', '[]'::jsonb);
    v_reel := v_item -> 'reel';
    if v_reel = 'null'::jsonb then
      v_reel := null;
    end if;
    if jsonb_typeof(v_images) is distinct from 'array' then
      raise exception 'validation' using errcode = '22023', detail = v_label || ': images is a list.';
    end if;
    if v_format = 'reel' then
      if jsonb_typeof(v_reel) is distinct from 'object' or jsonb_typeof(v_reel -> 'video') is distinct from 'object' then
        raise exception 'invalid_format' using errcode = '22023', detail = 'A reel on ' || v_label || ' needs its video.';
      end if;
      if jsonb_array_length(v_images) > 0 then
        raise exception 'invalid_format' using errcode = '22023', detail = 'A reel on ' || v_label || ' carries no images.';
      end if;
      if v_reel -> 'poster' = 'null'::jsonb then
        v_reel := v_reel - 'poster';
      end if;
      if v_channel = 'linkedin' and jsonb_typeof(v_reel -> 'poster') is distinct from 'object' then
        raise exception 'reel_poster_required' using errcode = '22023', detail = 'A reel on LinkedIn needs its poster.';
      end if;
      v_files := jsonb_build_array(v_reel -> 'video')
        || case when v_reel ? 'poster' then jsonb_build_array(v_reel -> 'poster') else '[]'::jsonb end;
    else
      if v_reel is not null then
        raise exception 'invalid_format' using errcode = '22023', detail = 'Only a reel carries a video.';
      end if;
      v_count := jsonb_array_length(v_images);
      v_min := case v_format when 'single' then 1 else 2 end;
      v_max := case
        when v_format = 'single' then 1
        when v_channel = 'instagram' then 10
        when v_channel = 'x' then 4
        else 20
      end;
      if v_count < v_min or v_count > v_max then
        raise exception 'invalid_format' using errcode = '22023',
          detail = format(
            'A %s on %s takes %s; this one has %s.',
            case v_format when 'single' then 'single post' else 'carousel' end, v_label,
            case when v_min = v_max then v_min || ' image' else v_min || ' to ' || v_max || ' images' end, v_count
          );
      end if;
      v_files := v_images;
    end if;

    -- Every file is a key in the public media bucket (the runner uploads a studio or Drive file before it proposes),
    -- with its alt text and its size.
    for v_file in select value from jsonb_array_elements(v_files) loop
      if jsonb_typeof(v_file) is distinct from 'object' or btrim(coalesce(v_file ->> 'key', '')) = '' then
        raise exception 'validation' using errcode = '22023', detail = v_label || ': each file names its storage key.';
      end if;
      if btrim(coalesce(v_file ->> 'alt', '')) = '' then
        raise exception 'validation' using errcode = '22023', detail = v_label || ': each file needs its alt text.';
      end if;
      if jsonb_typeof(v_file -> 'w') is distinct from 'number' or jsonb_typeof(v_file -> 'h') is distinct from 'number'
        or jsonb_typeof(v_file -> 'bytes') is distinct from 'number'
        or (v_file ->> 'w')::numeric <= 0 or (v_file ->> 'h')::numeric <= 0 or (v_file ->> 'bytes')::numeric < 0 then
        raise exception 'validation' using errcode = '22023', detail = v_label || ': each file gives its size.';
      end if;
      if not exists (
        select 1 from storage.objects o where o.bucket_id = 'media' and o.name = v_file ->> 'key'
      ) then
        raise exception 'media_not_found' using errcode = '22023',
          detail = format('%s is not in storage: the studio or Drive file is uploaded before it is proposed.', v_file ->> 'key');
      end if;
    end loop;

    insert into public.proposed_post_channels (post_id, revision, channel, format, caption, media)
    values (
      p_post, p_revision, v_channel, v_format, v_caption,
      jsonb_build_object('images', case when v_format = 'reel' then '[]'::jsonb else v_images end, 'reel', v_reel)
    );
  end loop;
end;
$$;

revoke execute on function public.proposed_post_put_channels(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.proposed_post_put_channels(uuid, integer, jsonb) to service_role;

create or replace function public.create_proposed_post(
  p_title text,
  p_channels jsonb,
  p_proposer_kind public.actor_kind,
  p_proposer_agent text default null,
  p_actor uuid default null,
  p_request_id text default null,
  p_property uuid default null,
  p_submission uuid default null,
  p_test boolean default false,
  p_run uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- W8 item 10 (H116, H117): a post proposed by a colleague (through the laptop runner, no actor) or through the admin
  -- route by a person or Matter's key (the actor, audited against action_roles by write_audit).
  if btrim(coalesce(p_title, '')) = '' or char_length(p_title) > 200 then
    raise exception 'validation' using errcode = '22023', detail = 'A proposed post needs a title of up to 200 characters.';
  end if;
  if p_proposer_kind = 'agent' then
    if not exists (select 1 from public.agents a where a.slug = p_proposer_agent) then
      raise exception 'validation' using errcode = '22023', detail = 'The proposer is not on the team.';
    end if;
  elsif p_actor is null or p_proposer_agent is not null then
    raise exception 'validation' using errcode = '22023', detail = 'A person proposes under their own account.';
  end if;

  insert into public.proposed_posts (
    title, property_id, submission_id, proposer_kind, proposer_agent, proposer_user, run_id, test
  )
  values (
    btrim(p_title), p_property, p_submission, p_proposer_kind, p_proposer_agent, p_actor, p_run, coalesce(p_test, false)
  )
  returning id into v_id;
  perform public.proposed_post_put_channels(v_id, 1, p_channels);

  -- A colleague's proposal has no account: the audit row is the system's and names the colleague in its note.
  perform public.write_audit(
    p_actor, case when p_actor is null then null else p_proposer_kind end, 'channels.proposed_create', 'proposed_posts',
    v_id, null, jsonb_build_object('status', 'proposed', 'revision', 1, 'test', coalesce(p_test, false)), p_request_id,
    case when p_proposer_kind = 'agent' then 'agent:' || p_proposer_agent end
  );
  return v_id;
end;
$$;

revoke execute on function public.create_proposed_post(
  text, jsonb, public.actor_kind, text, uuid, text, uuid, uuid, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.create_proposed_post(
  text, jsonb, public.actor_kind, text, uuid, text, uuid, uuid, boolean, uuid
) to service_role;

create or replace function public.revise_proposed_post(
  p_id uuid,
  p_channels jsonb,
  p_actor uuid default null,
  p_actor_kind public.actor_kind default null,
  p_request_id text default null,
  p_title text default null,
  p_proposer_agent text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.proposed_posts;
  v_revision integer;
begin
  -- W8 item 10 (H116): a rejected post comes back as its next revision with new channels; the revision sent back keeps
  -- its own rows and its snapshot in proposed_post_revisions. The runner revises for its colleague (no actor, the
  -- colleague's slug); a person or Matter's key through the admin route.
  select * into v_post from public.proposed_posts p where p.id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_post.status <> 'rejected' then
    raise exception 'wrong_state' using errcode = '55000', detail = 'Only a post that was sent back can be revised.';
  end if;
  if p_title is not null and (btrim(p_title) = '' or char_length(p_title) > 200) then
    raise exception 'validation' using errcode = '22023', detail = 'A proposed post needs a title of up to 200 characters.';
  end if;
  v_revision := v_post.revision + 1;
  update public.proposed_posts
  set status = 'proposed',
      revision = v_revision,
      rejection_note = null,
      title = coalesce(btrim(p_title), title)
  where id = p_id;
  perform public.proposed_post_put_channels(p_id, v_revision, p_channels);
  perform public.write_audit(
    p_actor, p_actor_kind, 'channels.proposed_revise', 'proposed_posts', p_id,
    jsonb_build_object('status', v_post.status, 'revision', v_post.revision),
    jsonb_build_object('status', 'proposed', 'revision', v_revision), p_request_id,
    case when p_proposer_agent is not null then 'agent:' || p_proposer_agent end
  );
  return v_revision;
end;
$$;

revoke execute on function public.revise_proposed_post(uuid, jsonb, uuid, public.actor_kind, text, text, text)
  from public, anon, authenticated;
grant execute on function public.revise_proposed_post(uuid, jsonb, uuid, public.actor_kind, text, text, text)
  to service_role;

create or replace function public.reject_proposed_post(
  p_id uuid,
  p_note text,
  p_rerender boolean,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.proposed_posts;
  v_note text := btrim(coalesce(p_note, ''));
  v_snapshot jsonb;
begin
  -- W8 item 10 (H116): a person, or Matter's key in the operator's place, sends a proposed post back with a note, or
  -- asks for its visuals to be made again. The revision keeps its snapshot, who asked and why; the proposer reads the
  -- note in its own thread. Matter's rejections name `agent:matter` in the audit trail.
  if v_note = '' then
    raise exception 'rejection_note_required' using errcode = '22023', detail = 'Say what should change.';
  end if;
  select * into v_post from public.proposed_posts p where p.id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_post.status <> 'proposed' then
    raise exception 'wrong_state' using errcode = '55000', detail = 'This post was already decided.';
  end if;
  select jsonb_build_object(
    'title', v_post.title,
    'revision', v_post.revision,
    'channels', coalesce(
      jsonb_agg(
        jsonb_build_object('channel', c.channel, 'format', c.format, 'caption', c.caption, 'media', c.media)
        order by c.channel
      ),
      '[]'::jsonb
    )
  )
  into v_snapshot
  from public.proposed_post_channels c
  where c.post_id = p_id and c.revision = v_post.revision;

  insert into public.proposed_post_revisions (post_id, revision, reason, note, asked_by, asked_by_kind, snapshot)
  values (
    p_id, v_post.revision, case when p_rerender then 'rerender' else 'rejected' end, left(v_note, 1000), p_actor,
    p_actor_kind, v_snapshot
  );
  update public.proposed_posts set status = 'rejected', rejection_note = left(v_note, 1000) where id = p_id;

  if v_post.proposer_kind = 'agent' then
    insert into public.agent_messages (thread, author_kind, author_id, author_name, body)
    values (
      v_post.proposer_agent, 'system', 'system', 'Matter of Place',
      format(
        '%s "%s" (revision %s): %s',
        case when p_rerender then 'Make the visuals again for' else 'Sent back:' end,
        left(v_post.title, 200), v_post.revision, left(v_note, 1000)
      )
    );
  end if;
  perform public.write_audit(
    p_actor, p_actor_kind,
    case when p_rerender then 'channels.proposed_rerender' else 'channels.proposed_reject' end,
    'proposed_posts', p_id,
    jsonb_build_object('status', v_post.status), jsonb_build_object('status', 'rejected'), p_request_id,
    case when p_actor_kind = 'agent' then 'agent:matter' end
  );
  return v_post.revision;
end;
$$;

revoke execute on function public.reject_proposed_post(uuid, text, boolean, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.reject_proposed_post(uuid, text, boolean, uuid, public.actor_kind, text)
  to service_role;

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
    update public.proposed_post_channels set asset_id = v_asset, social_post_id = v_social.id where id = v_channel.id;
    v_events := array_append(v_events, v_event);
    v_socials := array_append(v_socials, v_social.id);
  end loop;

  update public.proposed_posts
  set status = 'scheduled', approved_by = p_actor, approved_at = now()
  where id = p_id;
  perform public.write_audit(
    p_actor, p_actor_kind, 'channels.proposed_approve', 'proposed_posts', p_id,
    jsonb_build_object('status', v_post.status),
    jsonb_build_object('status', 'scheduled', 'revision', v_post.revision), p_request_id
  );
  return jsonb_build_object('post_id', p_id, 'event_ids', to_jsonb(v_events), 'social_post_ids', to_jsonb(v_socials));
end;
$$;

revoke execute on function public.approve_proposed_post(uuid, integer, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.approve_proposed_post(uuid, integer, uuid, public.actor_kind, text) to service_role;

create or replace function public.proposed_post_follow_social()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- W8 item 10 (H116): a scheduled proposed post is posted once every channel row of its approved revision is posted.
  -- The posting path writes social_posts only; this keeps the proposed post's status in step without touching it.
  update public.proposed_posts p
  set status = 'posted'
  where p.status = 'scheduled'
    and exists (
      select 1 from public.proposed_post_channels c
      where c.post_id = p.id and c.revision = p.revision and c.social_post_id = new.id
    )
    and not exists (
      select 1
      from public.proposed_post_channels c
      left join public.social_posts s on s.id = c.social_post_id
      where c.post_id = p.id and c.revision = p.revision and s.status is distinct from 'posted'
    );
  return null;
end;
$$;

revoke execute on function public.proposed_post_follow_social() from public, anon, authenticated;

create or replace trigger social_posts_follow_proposed
after update of status on public.social_posts
for each row when (new.status = 'posted' and old.status is distinct from 'posted')
execute function public.proposed_post_follow_social();
