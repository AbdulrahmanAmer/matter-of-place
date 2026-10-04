create or replace function public.record_webhook_receipt(p_provider text, p_id text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  -- False on a replay: the delivery was already applied.
  with stored as (
    insert into public.webhook_receipts (provider, id)
    values (p_provider, p_id)
    on conflict (provider, id) do nothing
    returning 1
  )
  select exists (select 1 from stored);
$$;

revoke execute on function public.record_webhook_receipt(text, text) from public, anon, authenticated;
grant execute on function public.record_webhook_receipt(text, text) to service_role;
