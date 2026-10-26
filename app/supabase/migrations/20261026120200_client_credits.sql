-- down:
--   drop trigger payments_grant_credits on public.payments;
--   drop table public.client_credits;
--   drop function public.payments_grant_credits(), public.client_credits_immutable(),
--     public.credits_in_package(public.exposure_package);
set lock_timeout = '5s';

-- W6 item 8 (ruling H142): the credit ledger. Five Features buys five credits for one contact; each property that is
-- accepted under a credit uses one. The balance is the sum of `quantity`, never a stored number, so it cannot drift
-- from the rows that explain it. Rows are appended (a credit used is never edited back) and written only by
-- `payments_grant_credits` (a paid pack) and `spend_client_credit` (a credit used), both under the service role.
create table public.client_credits (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts (id) on delete restrict,
  kind text not null check (kind in ('purchased', 'used')),
  quantity integer not null,
  -- The payment that bought the pack, or the waiver that spent the credit.
  payment_id uuid not null references public.payments (id) on delete restrict,
  -- The request a credit was used for; null on a purchase.
  submission_id uuid references public.submissions (id) on delete restrict,
  note text,
  created_at timestamptz not null default now(),
  constraint client_credits_sign check (
    (kind = 'purchased' and quantity > 0 and submission_id is null)
    or (kind = 'used' and quantity = -1 and submission_id is not null)
  )
);
-- A payment buys its pack once and a request uses one credit once, so a rerun of a trigger or a double click adds no row.
create unique index client_credits_purchase_idx on public.client_credits (payment_id) where kind = 'purchased';
create unique index client_credits_use_idx on public.client_credits (submission_id) where kind = 'used';
create index client_credits_contact_idx on public.client_credits (contact_id, created_at);
create index client_credits_payment_idx on public.client_credits (payment_id);

-- The three functions below are the text of supabase/sql/functions/<name>.sql; later changes come through bun run db:fn.
create or replace function public.credits_in_package(p_product public.exposure_package)
returns integer
language sql
immutable
set search_path = ''
as $$
  -- W6 item 8 (ruling H142): how many properties a package pays for in advance; mirrored by `creditsInPackage` in
  -- `src/domain/payments.ts`. Only Five Features is a pack: the other products are one property each and buy no credit.
  select case p_product::text when 'Five Features' then 5 end;
$$;

revoke execute on function public.credits_in_package(public.exposure_package) from public, anon, authenticated;
grant execute on function public.credits_in_package(public.exposure_package) to service_role;

create or replace function public.client_credits_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- W6 item 8 (ruling H142): the ledger is never edited, deleted or emptied, by any role. The one delete allowed is a
  -- cleanup of test fixtures that asks for it (`mop.fixture_cleanup`), and never on the production database (ruling H35):
  -- only a known non-production environment allows it, as `public_state` reads it, so a missing row refuses.
  if tg_op = 'DELETE' and current_setting('mop.fixture_cleanup', true) = 'on'
    and (select s.value #>> '{}' in ('development', 'preview') from public.settings s where s.key = 'environment') then
    return old;
  end if;
  raise exception 'append_only';
end;
$$;

revoke execute on function public.client_credits_immutable() from public, anon, authenticated;

create or replace function public.payments_grant_credits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credits integer := public.credits_in_package(new.product);
  v_contact uuid;
begin
  -- W6 item 8 (ruling H142): a pack's credits are bought when its payment is paid, once. The property the pack was
  -- paid with is the first of the five, so it uses a credit in the same moment. A request with no contact (a fixture
  -- row; create_submission links every real one) has no ledger.
  if new.status <> 'paid' or v_credits is null or (tg_op = 'UPDATE' and old.status = 'paid') then
    return new;
  end if;
  select s.contact_id into v_contact from public.submissions s where s.id = new.submission_id;
  if v_contact is null then
    return new;
  end if;
  insert into public.client_credits (contact_id, kind, quantity, payment_id, note)
  values (v_contact, 'purchased', v_credits, new.id, new.product::text || ' paid')
  on conflict do nothing;
  insert into public.client_credits (contact_id, kind, quantity, payment_id, submission_id, note)
  values (v_contact, 'used', -1, new.id, new.submission_id, 'The first property of the pack')
  on conflict do nothing;
  return new;
end;
$$;

revoke execute on function public.payments_grant_credits() from public, anon, authenticated;

-- Binds the service role too, which RLS does not. A row trigger never sees a truncate, so a statement trigger refuses it.
create trigger client_credits_immutable
before update or delete on public.client_credits
for each row execute function public.client_credits_immutable();

create trigger client_credits_no_truncate
before truncate on public.client_credits
for each statement execute function public.client_credits_immutable();

create trigger payments_grant_credits
after insert or update of status on public.payments
for each row execute function public.payments_grant_credits();

alter table public.client_credits enable row level security;
-- G-100: every grant is explicit. Staff read the ledger; a client reaches their own rows only through `account_credits`.
revoke all on table public.client_credits from anon, authenticated;
grant select on table public.client_credits to authenticated;
grant all on table public.client_credits to service_role;
revoke truncate on table public.client_credits from service_role;
create policy client_credits_select_staff on public.client_credits for select to authenticated
using (app.is_staff());
