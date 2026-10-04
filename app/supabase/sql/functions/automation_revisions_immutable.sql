create or replace function public.automation_revisions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'append_only';
end;
$$;

revoke execute on function public.automation_revisions_immutable() from public, anon, authenticated;
