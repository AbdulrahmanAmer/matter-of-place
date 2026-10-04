create or replace function public.claim_schedule(
  p_key text,
  p_guard boolean,
  p_old_last_run_at timestamptz default null,
  p_last_run_at timestamptz default null,
  p_next_run_at timestamptz default null
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  -- G43: the one write of the schedule clocks. It sets no actor, so the revision trigger records nothing
  -- (invariant 7). The defaults let a caller leave a null time out (P-915).
  with claimed as (
    update public.schedule_settings
    set last_run_at = p_last_run_at, next_run_at = p_next_run_at
    where key = p_key and enabled and (not p_guard or last_run_at is not distinct from p_old_last_run_at)
    returning key
  )
  select exists (select 1 from claimed);
$$;

revoke execute on function public.claim_schedule(text, boolean, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_schedule(text, boolean, timestamptz, timestamptz, timestamptz)
  to service_role;
