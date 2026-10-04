create or replace function public.clear_media_staging(p_items jsonb)
returns integer
language sql
security definer
set search_path = ''
as $$
  -- JOB-03: after apply_media_variants and the removal of the staged objects. The path match leaves a row whose
  -- staging_path changed meanwhile alone.
  with items as (
    select (e.item ->> 'media_id')::uuid as media_id, e.item ->> 'staging_path' as staging_path
    from jsonb_array_elements(p_items) as e(item)
  ),
  cleared as (
    update public.property_media m
    set staging_path = null, render_job_id = null
    from items i
    where m.id = i.media_id and m.staging_path = i.staging_path
    returning m.id
  )
  select count(*)::int from cleared
$$;

revoke execute on function public.clear_media_staging(jsonb) from public, anon, authenticated;
grant execute on function public.clear_media_staging(jsonb) to service_role;
