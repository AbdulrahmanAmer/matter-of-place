create or replace function public.claim_media_for_render(
  p_property_id uuid,
  p_job_id uuid,
  p_limit int default 40
)
returns setof public.property_media
language sql
security definer
set search_path = ''
as $$
  -- PERF-01: each staged row goes to exactly one render_variants job. A claim of a job that is no longer running lapses
  -- by itself, a retry reclaims its own rows, and skip locked keeps two concurrent claims disjoint.
  with claimed as (
    update public.property_media pm
    set render_job_id = p_job_id
    where pm.id in (
      select m.id
      from public.property_media m
      where m.property_id = p_property_id
        and m.staging_path is not null
        and (
          m.render_job_id is null
          or m.render_job_id = p_job_id
          or not exists (select 1 from public.jobs j where j.id = m.render_job_id and j.status = 'running')
        )
      order by m.sort_order
      limit p_limit
      for update skip locked
    )
    returning pm.*
  )
  select c.* from claimed c order by c.sort_order, c.id
$$;

revoke execute on function public.claim_media_for_render(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.claim_media_for_render(uuid, uuid, int) to service_role;
