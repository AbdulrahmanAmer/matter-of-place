create or replace function public.schedule_social_post(p_asset_id uuid, p_channel text, p_scheduled_at timestamptz)
returns public.social_posts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.social_posts;
begin
  -- B10 invariant 2: one row per asset and channel; a second run reads the row the first one made.
  insert into public.social_posts (asset_id, property_id, channel, scheduled_at)
  select a.id, a.property_id, p_channel, p_scheduled_at
  from public.assets a
  where a.id = p_asset_id
  on conflict (asset_id, channel) do nothing
  returning * into v_post;
  if v_post.id is null then
    select * into v_post from public.social_posts p where p.asset_id = p_asset_id and p.channel = p_channel;
  end if;
  if v_post.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return v_post;
end;
$$;

revoke execute on function public.schedule_social_post(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.schedule_social_post(uuid, text, timestamptz) to service_role;
