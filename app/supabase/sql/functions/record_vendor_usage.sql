create or replace function public.record_vendor_usage(
  p_line text,
  p_used numeric,
  p_limit numeric default null,
  p_note text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := now();
begin
  -- The free-tier lines only a vendor's own API can count (Cloudflare Workers requests, Sentry errors, GitHub Actions
  -- minutes, Supabase egress). The operator's laptop measures them with the weekly audit's collectors and records
  -- them here; the dashboard shows each with the time it was measured (operator, 2026-10-12).
  if p_used is null or p_used < 0 then
    raise exception 'validation';
  end if;
  insert into public.vendor_usage (line, used, limit_value, note, measured_at)
  values (p_line, p_used, p_limit, p_note, v_at)
  on conflict (line) do update
  set used = excluded.used, limit_value = excluded.limit_value, note = excluded.note, measured_at = excluded.measured_at;
  return v_at;
end;
$$;

revoke execute on function public.record_vendor_usage(text, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.record_vendor_usage(text, numeric, numeric, text) to service_role;
