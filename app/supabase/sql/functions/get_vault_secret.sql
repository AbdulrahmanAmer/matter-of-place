create or replace function public.get_vault_secret(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- GS-01: the tokens a job refreshes live in Vault; only these names can be read, any other raises.
  if p_name not in ('meta_page_token', 'x_oauth_token', 'linkedin_oauth_token') then
    raise exception 'forbidden';
  end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = p_name);
end;
$$;

revoke execute on function public.get_vault_secret(text) from public, anon, authenticated;
grant execute on function public.get_vault_secret(text) to service_role;
