create or replace function public.job_event_entity_id(j public.jobs)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- G64: a PostgREST computed field, so one `or` filter finds an entity's jobs through their event.
  select e.entity_id from public.events e where e.id = j.event_id
$$;

revoke execute on function public.job_event_entity_id(public.jobs) from public, anon, authenticated;
grant execute on function public.job_event_entity_id(public.jobs) to service_role;
