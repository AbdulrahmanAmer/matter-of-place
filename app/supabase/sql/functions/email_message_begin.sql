create or replace function public.email_message_begin(
  p_job_id uuid,
  p_to_email text,
  p_template_key text,
  p_kind text,
  p_subject text,
  p_content_hash text,
  p_entity text default null,
  p_entity_id uuid default null
)
returns table (id uuid, status text, content_hash text)
language sql
security definer
set search_path = ''
as $$
  -- G43, invariant 4: one row per job and recipient. A retry finds the row of its first attempt, with that attempt's
  -- content_hash and its status, so a message already sent is never sent again.
  insert into public.email_messages (
    job_id, to_email, template_key, kind, subject, entity, entity_id, content_hash, status
  )
  values (
    p_job_id, p_to_email, p_template_key, p_kind, p_subject, p_entity, p_entity_id, p_content_hash, 'queued'
  )
  on conflict (job_id, to_email) do nothing;

  select m.id, m.status, m.content_hash
  from public.email_messages m
  where m.job_id = p_job_id and m.to_email = p_to_email;
$$;

revoke execute on function public.email_message_begin(uuid, text, text, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.email_message_begin(uuid, text, text, text, text, text, text, uuid) to service_role;
