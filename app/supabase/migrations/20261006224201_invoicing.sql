-- down:
--   drop view public.invoice_list;
--   drop function public.settings_put_invoice(jsonb, uuid, public.actor_kind, text, text),
--     public.activate_submission(uuid, uuid, public.actor_kind, text),
--     public.void_payment(uuid, text, uuid, public.actor_kind, text),
--     public.record_waiver(uuid, public.exposure_package, numeric, text, uuid, public.actor_kind, text),
--     public.waive_payment(uuid, text, uuid, public.actor_kind, text),
--     public.mark_payment_paid(uuid, timestamptz, text, text, uuid, public.actor_kind, text),
--     public.issue_invoice(uuid, public.exposure_package, numeric, text, jsonb, uuid, public.actor_kind, text),
--     public.set_invoice_key(uuid, text), public.next_invoice_number(text),
--     public.package_duration_days(public.exposure_package), public.payment_tier(public.exposure_package);
--   delete from public.settings where key = 'invoice';
--   delete from public.pii_columns where table_name = 'payments' and column_name = 'invoice_snapshot';
--   drop table public.invoice_counters;
--   drop index public.payments_one_live_idx;
--   alter table public.payments drop constraint payments_number_unless_waived,
--     drop constraint payments_product_chosen, drop constraint payments_amount_positive,
--     drop column invoice_snapshot, drop column waived_by, drop column paid_reference, drop column paid_method,
--     drop column due_at;
set lock_timeout = '5s';

-- B6 (architecture 3.4): the columns B2 left to this slice. `due_at` is stored at issue so a later change of
-- `settings.invoice.due_days` never moves an old invoice; `invoice_snapshot` is frozen at issue (invariant 5).
alter table public.payments
  add column due_at timestamptz,
  add column paid_method text,
  add column paid_reference text,
  add column waived_by uuid references auth.users (id) on delete set null,
  add column invoice_snapshot jsonb,
  add constraint payments_amount_positive check (amount > 0),
  add constraint payments_product_chosen check (product <> 'Not sure yet'),
  -- Invariant 12: only a waiver recorded without an invoice has no number.
  add constraint payments_number_unless_waived check (invoice_number is not null or status = 'waived');
create index payments_waived_by_idx on public.payments (waived_by);
-- Invariant 2: one live payment per submission; a void row is outside it, so a corrected invoice can follow.
create unique index payments_one_live_idx on public.payments (submission_id)
where status in ('due', 'paid', 'waived');

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

-- Invariant 4: one row per UTC year, written only by next_invoice_number.
create table public.invoice_counters (
  year integer primary key,
  last integer not null check (last >= 0)
);
alter table public.invoice_counters enable row level security;
-- G-100: every grant is explicit; no policy, so only the functions reach it.
revoke all on table public.invoice_counters from anon, authenticated;
grant all on table public.invoice_counters to service_role;

-- The current year starts above any number already stored.
insert into public.invoice_counters (year, last)
select extract(year from now() at time zone 'utc')::integer,
  coalesce(max(split_part(invoice_number, '-', 3)::integer), 0)
from public.payments
where invoice_number is not null
  and split_part(invoice_number, '-', 2) = extract(year from now() at time zone 'utc')::integer::text
  and split_part(invoice_number, '-', 3) ~ '^[0-9]+$'
on conflict (year) do nothing;

-- DB-03: write_audit stores {"pii": "changed"} for the billing snapshot, never its text.
insert into public.pii_columns (table_name, column_name)
values ('payments', 'invoice_snapshot')
on conflict do nothing;

-- A configuration seed, present in production (invariant 13 for campaign_days). The payment instructions stay empty
-- until the operator supplies them (setup A4), so issuing is refused as not ready until then (invariant 7).
insert into public.settings (key, value)
values (
  'invoice',
  '{"prefix":"MOP","due_days":14,"terms":"Payable within 14 days of the invoice date.","late_terms":"Payment is due by the date shown. Overdue amounts may be subject to a late charge.","tax_line":"No sales tax is charged on this invoice.","payment_methods":[{"id":"bank_transfer","label":"Bank transfer","instructions":""},{"id":"wire","label":"Wire transfer","instructions":""},{"id":"card_by_phone","label":"Card by phone","instructions":""}],"campaign_days":{"The Feature":null,"The Reach":null,"The Campaign":14,"Five Features":null},"billing_email":"billing@matterofplace.com"}'::jsonb
)
on conflict (key) do nothing;

create or replace function public.payment_tier(p_product public.exposure_package)
returns text
language sql
immutable
set search_path = ''
as $$
  -- B6 invariant 3: the `tier` of the payment events and `properties.campaign_tier`, mirrored by `tierOf` in
  -- `src/domain/payments.ts`. ASSUMED: a Five Features credit buys one Feature per property.
  select case p_product::text
    when 'The Feature' then 'Feature'
    when 'Five Features' then 'Feature'
    when 'The Reach' then 'Reach'
    when 'The Campaign' then 'Campaign'
  end;
$$;

revoke execute on function public.payment_tier(public.exposure_package) from public, anon, authenticated;
grant execute on function public.payment_tier(public.exposure_package) to service_role;

create or replace function public.package_duration_days(p_product public.exposure_package)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  -- B6 invariant 13 (DL-09): the one reader of `settings.invoice.campaign_days`; null means the campaign completes
  -- 30 days after publication.
  select (s.value -> 'campaign_days' ->> p_product::text)::integer
  from public.settings s
  where s.key = 'invoice';
$$;

revoke execute on function public.package_duration_days(public.exposure_package) from public, anon, authenticated;
grant execute on function public.package_duration_days(public.exposure_package) to service_role;

create or replace function public.next_invoice_number(p_prefix text default 'MOP')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer := extract(year from now() at time zone 'utc')::integer;
  v_last integer;
begin
  -- B6 invariant 4: a counter row per UTC year, taken inside the issuing transaction, so a rolled-back issue gives
  -- its number back and two issues wait on the row instead of sharing a number (a sequence would leave gaps).
  insert into public.invoice_counters as c (year, last)
  values (v_year, 1)
  on conflict (year) do update set last = c.last + 1
  returning c.last into v_last;
  return p_prefix || '-' || v_year::text || '-' || lpad(v_last::text, 4, '0');
end;
$$;

revoke execute on function public.next_invoice_number(text) from public, anon, authenticated;
grant execute on function public.next_invoice_number(text) to service_role;

create or replace function public.set_invoice_key(p_payment_id uuid, p_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  -- B6 invariant 5: the first render to finish records its object path; a second render at the same moment finds
  -- the key set and gets the stored one back, so a payment ends with one key and one object.
  update public.payments p
  set invoice_file_key = p_key
  where p.id = p_payment_id and p.invoice_file_key is null;
  select p.invoice_file_key into v_key from public.payments p where p.id = p_payment_id;
  if not found then
    raise exception 'not_found';
  end if;
  return v_key;
end;
$$;

revoke execute on function public.set_invoice_key(uuid, text) from public, anon, authenticated;
grant execute on function public.set_invoice_key(uuid, text) to service_role;

create or replace function public.issue_invoice(
  p_submission_id uuid,
  p_product public.exposure_package,
  p_amount numeric,
  p_preferred_method text,
  p_snapshot jsonb,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns table (payment_id uuid, event_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.submission_state;
  v_settings jsonb;
  v_issued_at timestamptz := now();
  v_due_at timestamptz;
  v_number text;
  v_payment public.payments;
  v_event uuid;
begin
  -- B6 invariant 8: from Accepted, or from Invoice Issued once the earlier invoice is void.
  select s.workflow_state into v_state from public.submissions s where s.id = p_submission_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_state = 'Invoice Issued' and exists (
    select 1 from public.payments p
    where p.submission_id = p_submission_id and p.status in ('due', 'paid', 'waived')
  ) then
    raise exception 'wrong_state';
  end if;
  -- Invariant 1: B2's enforce_editorial_gate refuses every other starting state and an unaccepted request.
  update public.submissions s set workflow_state = 'Invoice Issued' where s.id = p_submission_id;

  select s.value into v_settings from public.settings s where s.key = 'invoice';
  -- Stored, so a later change of due_days never moves an issued invoice.
  v_due_at := v_issued_at + make_interval(days => (v_settings ->> 'due_days')::integer);
  v_number := public.next_invoice_number(v_settings ->> 'prefix');
  insert into public.payments (
    submission_id, product, amount, method, invoice_number, preferred_method, status, issued_by, issued_at, due_at,
    invoice_snapshot
  ) values (
    p_submission_id, p_product, p_amount, 'invoice_manual', v_number, p_preferred_method, 'due', p_actor,
    v_issued_at, v_due_at,
    -- Invariant 5: the frozen snapshot is complete once SQL adds the three fields it assigns.
    p_snapshot || jsonb_build_object(
      'invoice_number', v_number,
      'issue_date', to_char(v_issued_at at time zone 'utc', 'YYYY-MM-DD'),
      'due_date', to_char(v_due_at at time zone 'utc', 'YYYY-MM-DD')
    )
  )
  returning * into v_payment;

  perform public.write_audit(
    p_actor, p_actor_kind, 'payments.issue', 'payments', v_payment.id, null, to_jsonb(v_payment), p_request_id
  );
  v_event := public.emit_event(
    'invoice.issued', 'payment', v_payment.id,
    jsonb_build_object(
      'submission_id', p_submission_id, 'payment_id', v_payment.id, 'invoice_number', v_number,
      'tier', public.payment_tier(p_product)
    ),
    p_actor
  );
  -- Invariant 6: the PDF job commits or rolls back with the invoice.
  perform public.enqueue_job(
    'invoice_pdf',
    jsonb_build_object('params', '{}'::jsonb, 'data', jsonb_build_object('payment_id', v_payment.id)),
    'invoice_pdf:' || v_payment.id::text,
    p_max_attempts => 12
  );
  return query select v_payment.id, v_event;
end;
$$;

revoke execute on function public.issue_invoice(
  uuid, public.exposure_package, numeric, text, jsonb, uuid, public.actor_kind, text
) from public, anon, authenticated;
grant execute on function public.issue_invoice(
  uuid, public.exposure_package, numeric, text, jsonb, uuid, public.actor_kind, text
) to service_role;

create or replace function public.mark_payment_paid(
  p_payment_id uuid,
  p_paid_at timestamptz,
  p_method text,
  p_reference text,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns table (payment_id uuid, event_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.payments;
  v_after public.payments;
  v_event uuid;
begin
  -- B6 invariant 3: due to paid only. A null actor is the future Stripe webhook (invariant 9).
  select * into v_before from public.payments p where p.id = p_payment_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_before.status <> 'due' then
    raise exception 'wrong_state';
  end if;
  if p_paid_at is null then
    raise exception 'validation';
  end if;
  if p_paid_at > now() then
    raise exception 'paid_at_future';
  end if;
  update public.payments p
  set status = 'paid', paid_at = p_paid_at, paid_method = p_method, paid_reference = p_reference,
    paid_marked_by = p_actor
  where p.id = p_payment_id
  returning * into v_after;

  perform public.write_audit(
    p_actor, p_actor_kind, 'payments.mark_paid', 'payments', p_payment_id, to_jsonb(v_before), to_jsonb(v_after),
    p_request_id
  );
  v_event := public.emit_event(
    'payment.marked', 'payment', p_payment_id,
    jsonb_build_object(
      'submission_id', v_after.submission_id, 'payment_id', p_payment_id, 'status', 'paid', 'amount', v_after.amount,
      'tier', public.payment_tier(v_after.product), 'invoiced', v_after.invoice_number is not null
    ),
    p_actor
  );
  return query select p_payment_id, v_event;
end;
$$;

revoke execute on function public.mark_payment_paid(
  uuid, timestamptz, text, text, uuid, public.actor_kind, text
) from public, anon, authenticated;
grant execute on function public.mark_payment_paid(
  uuid, timestamptz, text, text, uuid, public.actor_kind, text
) to service_role;

create or replace function public.waive_payment(
  p_payment_id uuid,
  p_reason text,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns table (payment_id uuid, event_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.payments;
  v_after public.payments;
  v_event uuid;
begin
  -- B6 invariant 3: due to waived only; the reason is stored in notes.
  if char_length(coalesce(btrim(p_reason), '')) not between 3 and 500 then
    raise exception 'validation';
  end if;
  select * into v_before from public.payments p where p.id = p_payment_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_before.status <> 'due' then
    raise exception 'wrong_state';
  end if;
  update public.payments p
  set status = 'waived', waived_by = p_actor, notes = p_reason
  where p.id = p_payment_id
  returning * into v_after;

  perform public.write_audit(
    p_actor, p_actor_kind, 'payments.waive', 'payments', p_payment_id, to_jsonb(v_before), to_jsonb(v_after),
    p_request_id
  );
  v_event := public.emit_event(
    'payment.marked', 'payment', p_payment_id,
    jsonb_build_object(
      'submission_id', v_after.submission_id, 'payment_id', p_payment_id, 'status', 'waived',
      'amount', v_after.amount, 'tier', public.payment_tier(v_after.product),
      'invoiced', v_after.invoice_number is not null
    ),
    p_actor
  );
  return query select p_payment_id, v_event;
end;
$$;

revoke execute on function public.waive_payment(uuid, text, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.waive_payment(uuid, text, uuid, public.actor_kind, text) to service_role;

create or replace function public.record_waiver(
  p_submission_id uuid,
  p_product public.exposure_package,
  p_amount numeric,
  p_reason text,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns table (payment_id uuid, event_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.submission_state;
  v_payment public.payments;
  v_event uuid;
begin
  -- B6 invariant 12 (DL-01): a credit or a comp is waived without an invoice, so nobody is mailed a bill they do not
  -- owe: no number, no snapshot, no invoice_pdf job and no invoice.issued event.
  if char_length(coalesce(btrim(p_reason), '')) not between 3 and 500 then
    raise exception 'validation';
  end if;
  select s.workflow_state into v_state from public.submissions s where s.id = p_submission_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_state not in ('Accepted', 'Invoice Issued') or exists (
    select 1 from public.payments p
    where p.submission_id = p_submission_id and p.status in ('due', 'paid', 'waived')
  ) then
    raise exception 'wrong_state';
  end if;
  insert into public.payments (submission_id, product, amount, method, status, waived_by, notes)
  values (p_submission_id, p_product, p_amount, 'invoice_manual', 'waived', p_actor, p_reason)
  returning * into v_payment;
  -- Invoice Issued, so activate_submission works unchanged.
  update public.submissions s set workflow_state = 'Invoice Issued' where s.id = p_submission_id;

  perform public.write_audit(
    p_actor, p_actor_kind, 'payments.waive', 'payments', v_payment.id, null, to_jsonb(v_payment), p_request_id
  );
  v_event := public.emit_event(
    'payment.marked', 'payment', v_payment.id,
    jsonb_build_object(
      'submission_id', p_submission_id, 'payment_id', v_payment.id, 'status', 'waived', 'amount', v_payment.amount,
      'tier', public.payment_tier(p_product), 'invoiced', false
    ),
    p_actor
  );
  return query select v_payment.id, v_event;
end;
$$;

revoke execute on function public.record_waiver(
  uuid, public.exposure_package, numeric, text, uuid, public.actor_kind, text
) from public, anon, authenticated;
grant execute on function public.record_waiver(
  uuid, public.exposure_package, numeric, text, uuid, public.actor_kind, text
) to service_role;

create or replace function public.void_payment(
  p_payment_id uuid,
  p_reason text,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns table (payment_id uuid, event_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.payments;
  v_after public.payments;
  v_event uuid;
begin
  -- ASSUMED A3: an invoice issued in error is voided with a reason; its number is never reused, and the request stays
  -- in Invoice Issued until a corrected invoice is issued. A paid or waived payment is never voided.
  if char_length(coalesce(btrim(p_reason), '')) not between 3 and 500 then
    raise exception 'validation';
  end if;
  select * into v_before from public.payments p where p.id = p_payment_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_before.status <> 'due' then
    raise exception 'wrong_state';
  end if;
  update public.payments p
  set status = 'void', notes = p_reason
  where p.id = p_payment_id
  returning * into v_after;

  perform public.write_audit(
    p_actor, p_actor_kind, 'payments.void', 'payments', p_payment_id, to_jsonb(v_before), to_jsonb(v_after),
    p_request_id
  );
  v_event := public.emit_event(
    'invoice.voided', 'payment', p_payment_id,
    jsonb_build_object(
      'submission_id', v_after.submission_id, 'payment_id', p_payment_id,
      'invoice_number', v_after.invoice_number, 'reason', p_reason
    ),
    p_actor
  );
  return query select p_payment_id, v_event;
end;
$$;

revoke execute on function public.void_payment(uuid, text, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.void_payment(uuid, text, uuid, public.actor_kind, text) to service_role;

create or replace function public.activate_submission(
  p_submission_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns table (property_id uuid, event_id uuid, copy_job_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.submissions;
  v_after public.submissions;
  v_payment public.payments;
  v_property uuid;
  v_copy uuid;
  v_created jsonb;
  v_tier text;
  v_event uuid;
begin
  -- B6 invariant 8 (DL-02): a double click, a retry or Create property on screen 4 waits here and then sees the
  -- committed row.
  perform 1 from public.submissions s where s.id = p_submission_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  select * into v_before from public.submissions s where s.id = p_submission_id;
  select * into v_payment from public.payments p
  where p.submission_id = p_submission_id and p.status in ('paid', 'waived');

  -- Idempotent: once the payment has its campaign, a second call returns the same property and writes nothing.
  select c.property_id into v_property from public.campaigns c where c.payment_id = v_payment.id;
  if found then
    return query select v_property, null::uuid, (
      select j.id from public.jobs j where j.idempotency_key = 'copy_submission_media:' || v_property::text
    );
    return;
  end if;
  if v_before.workflow_state <> 'Invoice Issued' or v_payment.id is null then
    raise exception 'wrong_state';
  end if;

  v_property := v_before.property_id;
  if v_property is null then
    -- B7 enqueues the copy_submission_media job in this transaction; the photographs are copied by the runner.
    v_created := public.create_property_from_submission(p_submission_id, p_actor, p_actor_kind, p_request_id);
    v_property := (v_created ->> 'property_id')::uuid;
    v_copy := (v_created ->> 'copy_job_id')::uuid;
  else
    -- Null once B8's prune has removed the finished job.
    select j.id into v_copy from public.jobs j where j.idempotency_key = 'copy_submission_media:' || v_property::text;
  end if;

  update public.submissions s
  set workflow_state = 'Scheduled', property_id = v_property, activated_by = p_actor, activated_at = now()
  where s.id = p_submission_id
  returning * into v_after;
  update public.payments p set property_id = v_property where p.id = v_payment.id;
  -- Dates stay null until B7's publish_property sets them from package_duration_days (invariant 13).
  insert into public.campaigns (property_id, submission_id, payment_id, package, media_budget)
  values (v_property, p_submission_id, v_payment.id, v_payment.product, coalesce(v_before.media_budget, 0));
  v_tier := public.payment_tier(v_payment.product);
  if v_tier is not null then
    update public.properties pr set campaign_tier = v_tier::public.campaign_tier where pr.id = v_property;
  end if;

  perform public.write_audit(
    p_actor, p_actor_kind, 'submissions.activate', 'submissions', p_submission_id, to_jsonb(v_before),
    to_jsonb(v_after), p_request_id
  );
  v_event := public.emit_event(
    'submission.activated', 'submission', p_submission_id,
    jsonb_build_object(
      'submission_id', p_submission_id, 'property_id', v_property, 'tier', v_tier,
      'market', lower(replace(v_before.state::text, ' ', '-'))
    ),
    p_actor
  );
  return query select v_property, v_event, v_copy;
end;
$$;

revoke execute on function public.activate_submission(uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.activate_submission(uuid, uuid, public.actor_kind, text) to service_role;

create or replace function public.settings_put_invoice(
  p_value jsonb,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
begin
  -- G21: `invoice` is not a public key, so B2's trigger leaves catalog_version alone.
  select s.value into v_before from public.settings s where s.key = 'invoice' for update;
  insert into public.settings (key, value, updated_by)
  values ('invoice', p_value, p_actor)
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;

  perform public.write_audit(
    p_actor, p_actor_kind, 'settings.invoice_put', 'settings.invoice', null, v_before, p_value, p_request_id, p_note
  );
end;
$$;

revoke execute on function public.settings_put_invoice(jsonb, uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.settings_put_invoice(jsonb, uuid, public.actor_kind, text, text) to service_role;

-- Screen 5. It runs with the caller's rights (R20): staff read through B2's policies on payments and submissions,
-- anon reads nothing. A waiver recorded without an invoice has a null number.
create view public.invoice_list
with (security_invoker = true) as
select
  p.id,
  p.invoice_number,
  p.submission_id,
  s.submitter_name,
  s.submitter_email,
  p.product,
  p.amount,
  p.status,
  p.issued_at,
  p.due_at,
  p.paid_at,
  p.status = 'due' and p.due_at < now() as overdue,
  extract(day from coalesce(p.paid_at, now()) - p.issued_at)::integer as days_open
from public.payments p
join public.submissions s on s.id = p.submission_id;

revoke all on public.invoice_list from public, anon, authenticated;
grant select on public.invoice_list to authenticated, service_role;
