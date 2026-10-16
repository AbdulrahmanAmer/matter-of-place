create or replace function public.proposed_post_follow_social()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- W8 item 10 (H116, H117): a scheduled proposed post settles once no channel row of its approved revision is left to
  -- go out, each one posted or closed as cancelled (a format or channel the post steps skip): `posted` when at least
  -- one row posted, else back to `approved`, a yes with nothing posted. A row that failed otherwise keeps the post
  -- `scheduled`, since a person may retry it. The posting path writes social_posts only; this keeps the post in step.
  update public.proposed_posts p
  set status = case
    when exists (
      select 1
      from public.proposed_post_channels c
      join public.social_posts s on s.id = c.social_post_id
      where c.post_id = p.id and c.revision = p.revision and s.status = 'posted'
    ) then 'posted'
    else 'approved'
  end::public.proposed_post_status
  where p.status = 'scheduled'
    and exists (
      select 1 from public.proposed_post_channels c
      where c.post_id = p.id and c.revision = p.revision and c.social_post_id = new.id
    )
    and not exists (
      select 1
      from public.proposed_post_channels c
      left join public.social_posts s on s.id = c.social_post_id
      where c.post_id = p.id and c.revision = p.revision
        and not (s.status = 'posted' or (s.status = 'failed' and s.error = 'cancelled'))
    );
  return null;
end;
$$;

revoke execute on function public.proposed_post_follow_social() from public, anon, authenticated;

create or replace trigger social_posts_follow_proposed
after update of status on public.social_posts
for each row when (
  (new.status = 'posted' and old.status is distinct from 'posted')
  or (new.status = 'failed' and new.error = 'cancelled' and old.status is distinct from 'failed')
)
execute function public.proposed_post_follow_social();
