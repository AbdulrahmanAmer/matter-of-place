create or replace function public.assets_job_error()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- B9 invariant 11: a failed or dead job shows its error on the card of the asset it renders; a later set_asset_files
  -- clears it. Nothing here changes the jobs row.
  update public.assets set render_error = new.error where job_id = new.id;
  return null;
end;
$$;

revoke execute on function public.assets_job_error() from public, anon, authenticated;

create or replace trigger assets_job_error
after update of status on public.jobs
for each row when (new.status in ('failed', 'dead'))
execute function public.assets_job_error();
