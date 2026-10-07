create or replace function public.standalone_approve_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Invariant 9: approving the standalone_email asset on screen 10 also approves the waiting standalone send of its
  -- property, in the same transaction as approve_asset. When there is no such job (Feature tier, or approved on
  -- screen 16) nothing changes.
  perform public.approve_job(j.id, new.approved_by)
  from public.jobs j
  where j.type = 'send_email'
    and j.status = 'waiting_approval'
    and j.payload -> 'params' ->> 'template' = 'standalone'
    and j.payload -> 'data' ->> 'property_id' = new.property_id::text;
  return null;
end;
$$;

revoke execute on function public.standalone_approve_job() from public, anon, authenticated;

create or replace trigger assets_standalone_approve_job
after update of status on public.assets
for each row
when (new.kind = 'standalone_email' and new.status = 'approved' and old.status <> 'approved')
execute function public.standalone_approve_job();
