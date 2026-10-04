create or replace function public.set_vault_secret(p_name text, p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- GS-01: the writer of get_vault_secret's names; any other name raises.
  if p_name not in ('meta_page_token', 'x_oauth_token', 'linkedin_oauth_token') then
    raise exception 'forbidden';
  end if;
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    perform vault.create_secret(p_value, p_name);
  else
    perform vault.update_secret(v_id, p_value);
  end if;
end;
$$;

revoke execute on function public.set_vault_secret(text, text) from public, anon, authenticated;
grant execute on function public.set_vault_secret(text, text) to service_role;
