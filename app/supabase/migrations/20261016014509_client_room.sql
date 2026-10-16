-- down:
--   drop function app.contact_of(uuid);
set lock_timeout = '5s';

-- W6 item 7, ruling H114: a client is the signed-in person whose confirmed auth email is a contact's email. This is
-- the one mapping; it sits in `app`, outside the API (security advisor lint 0029), and only the service role and the
-- functions that own it call it. A client holds no table privilege and no policy: the base tables carry staff-only
-- columns (notes, decline notes, address hashes, reviewer ids), so a client's own rows reach the room only through
-- public.account_room, which returns a fixed list of fields.

create or replace function app.contact_of(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- Ruling H114 (1): a client is the auth user whose confirmed email is a contact's email, ignoring case (one contact
  -- per lower(email), invariant 22). An archived contact has no client.
  select c.id
  from auth.users u
  join public.contacts c on lower(c.email) = lower(u.email)
  where u.id = p_user
    and u.email_confirmed_at is not null
    and c.archived_at is null;
$$;

-- It takes any user id, so it is never callable by a signed-in user.
revoke execute on function app.contact_of(uuid) from public, anon, authenticated;
grant execute on function app.contact_of(uuid) to service_role;
