create or replace function public.assets_reel_video()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- B12: approving a reel puts it on the dossier, so a newer approved revision replaces the film; rejecting the
  -- approved one takes it down. A revision superseded by rerender_asset keeps the film until the next approval.
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
