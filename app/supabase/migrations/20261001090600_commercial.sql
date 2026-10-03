-- down:
--   drop table public.campaign_reports, public.campaigns, public.payments;
set lock_timeout = '5s';

-- Architecture 3.4 (S32). B6 adds the `void` status, due_at, paid_method, paid_reference, waived_by,
-- invoice_snapshot, invoice_counters and next_invoice_number; B2 creates no sequence.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete restrict,
  property_id uuid references public.properties (id) on delete set null,
  product public.exposure_package not null,
  amount numeric(12, 2) not null,
  currency char(3) not null default 'USD' check (currency = 'USD'),
  method public.payment_method not null default 'invoice_manual',
  -- Filled by B6's issue_invoice through next_invoice_number, gapless per UTC year.
  invoice_number text unique,
  -- Ruling H33: `<year>/<invoice_number>.pdf` in the private bucket `documents`, written by B6's set_invoice_key (G26).
  invoice_file_key text,
  preferred_method text,
  status public.payment_status not null default 'due',
  issued_by uuid references auth.users (id) on delete set null,
  issued_at timestamptz,
  paid_marked_by uuid references auth.users (id) on delete set null,
  paid_at timestamptz,
  stripe_payment_intent text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_submission_idx on public.payments (submission_id, status);
create index payments_property_idx on public.payments (property_id);
create index payments_issued_by_idx on public.payments (issued_by);
create index payments_paid_marked_by_idx on public.payments (paid_marked_by);

-- G22: rows are created only by B6's activate_submission, one per paid or waived payment.
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  submission_id uuid references public.submissions (id) on delete set null,
  payment_id uuid not null references public.payments (id) on delete restrict,
  package public.exposure_package not null,
  media_budget numeric(12, 2) not null default 0,
  management_fee numeric(12, 2) generated always as (
    case when media_budget > 0 then greatest(media_budget * 0.15, 100) else 0 end
  ) stored,
  starts_on date,
  ends_on date,
  homepage_status public.channel_status not null default 'none',
  featured_status public.channel_status not null default 'none',
  newsletter_status public.channel_status not null default 'none',
  social_status public.channel_status not null default 'none',
  programmatic_status public.channel_status not null default 'none',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- DL-02: a double Activate leaves one row.
alter table public.campaigns add constraint campaigns_payment_id_key unique (payment_id);
create index campaigns_property_idx on public.campaigns (property_id);
create index campaigns_submission_idx on public.campaigns (submission_id);

-- Rows are written by B10's report job under the service role.
create table public.campaign_reports (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  media_spend numeric(12, 2) not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  video_views bigint,
  ctr numeric(6, 4),
  geography jsonb not null default '{}',
  channel_mix jsonb not null default '{}',
  owned_distribution jsonb not null default '{}',
  top_creative text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaign_reports_idx on public.campaign_reports (campaign_id, period_start);

create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();
create trigger campaigns_set_updated_at
before update on public.campaigns
for each row execute function public.set_updated_at();
create trigger campaign_reports_set_updated_at
before update on public.campaign_reports
for each row execute function public.set_updated_at();

alter table public.payments enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_reports enable row level security;
-- G-100: every grant is explicit; the `authenticated` grants of the RLS matrix come with migration 10.
revoke all on table public.payments, public.campaigns, public.campaign_reports from anon, authenticated;
grant all on table public.payments, public.campaigns, public.campaign_reports to service_role;
