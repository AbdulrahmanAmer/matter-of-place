-- down:
--   drop function if exists public.record_vendor_usage(text, numeric, numeric, text);
--   drop table if exists public.vendor_usage;
set lock_timeout = '5s';

-- The vendor lines of the dashboard's free-tier gauges (operator, 2026-10-12: "fix this issue with things being not
-- measured"). One row per line, written only by record_vendor_usage under the service role; staff read it.
create table public.vendor_usage (
  line text primary key check (line in ('workers_requests_day', 'storage_egress', 'sentry_errors', 'actions_minutes')),
  used bigint not null check (used >= 0),
  limit_value bigint check (limit_value is null or limit_value > 0),
  note text check (note is null or char_length(note) <= 200),
  measured_at timestamptz not null
);
alter table public.vendor_usage enable row level security;
revoke all on table public.vendor_usage from anon, authenticated;
grant all on table public.vendor_usage to service_role;
grant select on table public.vendor_usage to authenticated;
create policy vendor_usage_select_staff on public.vendor_usage for select to authenticated using (app.is_staff());

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
