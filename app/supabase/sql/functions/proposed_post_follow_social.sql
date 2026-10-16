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
