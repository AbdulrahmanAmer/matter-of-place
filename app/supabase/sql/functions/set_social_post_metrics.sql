create or replace function public.set_social_post_metrics(p_id uuid, p_metrics jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.social_posts set metrics = p_metrics where id = p_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.set_social_post_metrics(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_social_post_metrics(uuid, jsonb) to service_role;
