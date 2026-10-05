-- down: re-run bun run db:fn email_message_begin email_message_finish from the previous commit of supabase/sql/functions/email_message_begin.sql, supabase/sql/functions/email_message_finish.sql
set lock_timeout = '5s';

drop function if exists public.email_message_begin(p_job_id uuid, p_to_email text, p_template_key text, p_kind text, p_subject text, p_entity text, p_entity_id uuid, p_content_hash text);

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

create or replace function public.email_message_finish(p_id uuid, p_status text, p_resend_id text default null, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status is null or p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'invalid_status';
  end if;
  -- A row that is sent, or moved further by a provider event, stays where it is; only `sent` counts against the caps.
  update public.email_messages
  set status = p_status,
    resend_id = p_resend_id,
    error = p_error,
    sent_at = case when p_status = 'sent' then now() else sent_at end
  where id = p_id and status not in ('sent', 'delivered', 'bounced', 'complained');
end;
$$;

revoke execute on function public.email_message_finish(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.email_message_finish(uuid, text, text, text) to service_role;
