create or replace function public.assets_reject_note()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(btrim(new.rejection_note), '') = '' then
    raise exception 'rejection_note_required' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.assets_reject_note() from public, anon, authenticated;

create or replace trigger assets_reject_note
before update on public.assets
for each row when (new.status = 'rejected' and old.status is distinct from 'rejected')
execute function public.assets_reject_note();
