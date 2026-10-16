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
