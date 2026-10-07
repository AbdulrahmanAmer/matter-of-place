create or replace function public.next_invoice_number(p_prefix text default 'MOP')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer := extract(year from now() at time zone 'utc')::integer;
  v_last integer;
begin
  -- B6 invariant 4: a counter row per UTC year, taken inside the issuing transaction, so a rolled-back issue gives
  -- its number back and two issues wait on the row instead of sharing a number (a sequence would leave gaps).
  insert into public.invoice_counters as c (year, last)
  values (v_year, 1)
  on conflict (year) do update set last = c.last + 1
  returning c.last into v_last;
  return p_prefix || '-' || v_year::text || '-' || lpad(v_last::text, 4, '0');
end;
$$;

revoke execute on function public.next_invoice_number(text) from public, anon, authenticated;
grant execute on function public.next_invoice_number(text) to service_role;
