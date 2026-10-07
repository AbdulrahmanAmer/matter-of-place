create or replace function public.mark_social_post_posted(
  p_id uuid,
  p_remote_id text,
  p_permalink text,
  p_targets text[]
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.social_posts;
  v_asset public.assets;
  v_submission public.submissions;
  v_posted_at timestamptz;
begin
  -- The stored posted_at, or null when the row was no longer scheduled (another run posted or failed it).
  select * into v_post from public.social_posts p where p.id = p_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- The asset row is the lock: two channels finishing at once cannot both miss the last one.
  select * into v_asset from public.assets a where a.id = v_post.asset_id for update;
  update public.social_posts
  set status = 'posted', posted_at = now(), remote_id = p_remote_id, permalink = p_permalink, error = null
  where id = p_id and status = 'scheduled'
  returning posted_at into v_posted_at;
  if not found then
    return null;
  end if;

  -- Published once every enabled target channel the caller names has a posted row for this asset.
  if v_asset.status = 'approved' and not exists (
    select 1
    from unnest(p_targets) t (channel)
    where not exists (
      select 1 from public.social_posts p
      where p.asset_id = v_asset.id and p.channel = t.channel and p.status = 'posted'
    )
  ) then
    update public.assets set status = 'published' where id = v_asset.id;
  end if;

  -- G60: the first posted row of a published property moves its submission to Distribution Active; B2's
  -- enforce_editorial_gate checks the move again.
  select s.* into v_submission
  from public.properties pr
  join public.submissions s on s.id = pr.submission_id
  where pr.id = v_asset.property_id
  for update of s;
  if found and v_submission.workflow_state = 'Published'
    and public.submission_transition_allowed('Published', 'Distribution Active') then
    update public.submissions set workflow_state = 'Distribution Active' where id = v_submission.id;
  end if;
  return v_posted_at;
end;
$$;

revoke execute on function public.mark_social_post_posted(uuid, text, text, text[]) from public, anon, authenticated;
grant execute on function public.mark_social_post_posted(uuid, text, text, text[]) to service_role;
