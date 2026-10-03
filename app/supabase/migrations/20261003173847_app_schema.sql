-- down:
--   alter function app.role_in(variadic public.app_role[]) set schema public;
--   alter function app.is_staff() set schema public;
--   drop schema app;
set lock_timeout = '5s';

-- Security advisor lint 0029: a security definer function in an API schema can be called through /rest/v1/rpc.
-- PostgREST exposes only `public` (config.toml api.schemas), so the policy helpers move to `app`. Every policy keeps
-- working: it stores the function's oid, not its name.
create schema if not exists app;
grant usage on schema app to authenticated, service_role;

alter function public.role_in(variadic public.app_role[]) set schema app;
alter function public.is_staff() set schema app;

revoke execute on function app.role_in(variadic public.app_role[]), app.is_staff() from public, anon;
grant execute on function app.role_in(variadic public.app_role[]), app.is_staff() to authenticated, service_role;
