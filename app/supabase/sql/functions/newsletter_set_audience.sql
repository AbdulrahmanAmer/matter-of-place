create or replace function public.newsletter_set_audience(p_key text, p_audience_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- `ensureAudience` stores the Resend id of an audience here once it exists. No screen edits settings.resend.
  update public.settings
  set value = jsonb_set(
    value || jsonb_build_object('audiences', coalesce(value -> 'audiences', '{}'::jsonb)),
    array['audiences', p_key],
    to_jsonb(p_audience_id)
  )
  where key = 'resend';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.newsletter_set_audience(text, text) from public, anon, authenticated;
grant execute on function public.newsletter_set_audience(text, text) to service_role;
