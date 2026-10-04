create or replace function public.upsert_asset_stub(
  p_property uuid,
  p_kind public.asset_kind,
  p_revision int default null,
  p_job_id uuid default null
)
returns public.assets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision int := p_revision;
  v_row public.assets;
begin
  if v_revision is null then
    -- The current revision is the highest one not rejected. When every revision was rejected a new one starts, so a
    -- second publish after a rejection gets fresh creative instead of writing into a rejected row.
    select coalesce(max(a.revision) filter (where a.status <> 'rejected'), max(a.revision) + 1, 1)
    into v_revision
    from public.assets a
    where a.property_id = p_property and a.kind = p_kind;
  end if;

  -- The render steps and write_captions run at once; whichever comes first creates the row and the other finds it.
  insert into public.assets (property_id, kind, revision, job_id)
  values (p_property, p_kind, v_revision, p_job_id)
  on conflict (property_id, kind, revision) do nothing;

  select * into v_row
  from public.assets a
  where a.property_id = p_property and a.kind = p_kind and a.revision = v_revision;

  -- Only a pending row follows a new job: an approved asset keeps the job that made it (invariant 12).
  if p_job_id is not null and v_row.status = 'pending' and v_row.job_id is distinct from p_job_id then
    update public.assets set job_id = p_job_id where id = v_row.id returning * into v_row;
  end if;
  return v_row;
end;
$$;

revoke execute on function public.upsert_asset_stub(uuid, public.asset_kind, int, uuid)
  from public, anon, authenticated;
grant execute on function public.upsert_asset_stub(uuid, public.asset_kind, int, uuid) to service_role;
