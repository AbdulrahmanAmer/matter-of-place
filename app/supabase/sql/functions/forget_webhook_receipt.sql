create or replace function public.forget_webhook_receipt(p_provider text, p_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  -- A failed effect forgets its receipt, so the provider's retry is applied and not taken for a replay.
  delete from public.webhook_receipts where provider = p_provider and id = p_id;
$$;

revoke execute on function public.forget_webhook_receipt(text, text) from public, anon, authenticated;
grant execute on function public.forget_webhook_receipt(text, text) to service_role;
