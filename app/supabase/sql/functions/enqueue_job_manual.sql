create or replace function public.enqueue_job_manual(
  p_type text,
  p_entity_id uuid,
  p_payload jsonb,
  p_max_attempts int default 5
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text := p_type || ':' || p_entity_id::text || ':';
  v_n int;
begin
  perform pg_advisory_xact_lock(hashtext(p_type || p_entity_id::text));
  -- DB-09: the largest number plus one, never a count, so a pruned key is never handed out again. Only a numeric
  -- third part counts, so a free-form key with the same prefix cannot break the cast.
  select 1 + coalesce(
    max(split_part(j.idempotency_key, ':', 3)::int) filter (where split_part(j.idempotency_key, ':', 3) ~ '^[0-9]+$'),
    0
  )
  into v_n
  from public.jobs j
  where starts_with(j.idempotency_key, v_prefix);
  return public.enqueue_job(p_type, p_payload, v_prefix || v_n::text, p_max_attempts => p_max_attempts);
end;
$$;

revoke execute on function public.enqueue_job_manual(text, uuid, jsonb, int) from public, anon, authenticated;
grant execute on function public.enqueue_job_manual(text, uuid, jsonb, int) to service_role;
