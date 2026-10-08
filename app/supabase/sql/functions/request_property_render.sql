create or replace function public.request_property_render(p_property_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job uuid;
  v_slug text;
begin
  -- B7 invariant 21 (b), ruling H3: one pending render_variants job per property per upload burst. The lock makes two
  -- transactions that attach at once meet one job; B9's claim_media_for_render gives it every staged row.
  perform pg_advisory_xact_lock(hashtext('render_variants:' || p_property_id::text));
  select j.id into v_job
  from public.jobs j
  where j.type = 'render_variants'
    and j.status = 'queued'
    and j.payload -> 'data' ->> 'property_id' = p_property_id::text
  order by j.created_at, j.id
  limit 1;
  if v_job is not null then
    return v_job;
  end if;
  select p.slug into v_slug from public.properties p where p.id = p_property_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return public.enqueue_job(
    'render_variants',
    jsonb_build_object(
      'params', '{}'::jsonb,
      'data', jsonb_build_object('property_id', p_property_id, 'slug', v_slug)
    ),
    'render_variants:' || p_property_id::text || ':' || gen_random_uuid()::text,
    p_heavy => true,
    p_run_after => now() + interval '90 seconds',
    p_max_attempts => 12
  );
end;
$$;

revoke execute on function public.request_property_render(uuid) from public, anon, authenticated;
grant execute on function public.request_property_render(uuid) to service_role;
