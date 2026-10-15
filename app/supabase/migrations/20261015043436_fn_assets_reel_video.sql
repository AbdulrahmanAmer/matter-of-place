-- down: re-run bun run db:fn assets_reel_video from the previous commit of supabase/sql/functions/assets_reel_video.sql
set lock_timeout = '5s';

create or replace function public.assets_reel_video()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- B12: approving a reel puts it on the dossier, so a newer approved revision replaces the film; rejecting the
  -- approved one takes it down. A revision superseded by rerender_asset keeps the film until the next approval.
  -- W7 item 19 (H107): a reel about a market, a story or the brand has no dossier to go on.
  if new.property_id is null then
    return null;
  end if;
  if new.status = 'approved' and old.status <> 'approved' then
    perform public.attach_reel(new.property_id, new.id);
  elsif new.status = 'rejected' and old.status in ('approved', 'published')
    and new.rejection_note is distinct from 'superseded' then
    perform public.attach_reel(new.property_id, new.id, p_detach => true);
  end if;
  return null;
end;
$$;

revoke execute on function public.assets_reel_video() from public, anon, authenticated;

create or replace trigger assets_reel_video
after update of status on public.assets
for each row when (new.kind = 'reel')
execute function public.assets_reel_video();
