-- down:
--   alter table public.properties drop constraint properties_submission_fk;
--   drop table public.subscribers, public.inquiries, public.submission_media, public.submissions, public.contacts,
--     public.decline_reasons;
--   drop function public.enforce_submission_media_limit();
--   delete from public.pii_columns where table_name in ('submissions', 'contacts', 'inquiries', 'subscribers');
set lock_timeout = '5s';

-- Sketch columns (docs/database/schema.sql at 8dd6f26) changed as B2 Data changes item 5 lists. `rights_confirmed` of
-- the sketch is replaced by the three rights_* columns (invariant 12), the sketch's three agent columns are created
-- as submitter_name, submitter_email and submitter_phone (invariant 22), and `size` and `type` of submission_media
-- are created as `bytes` and `mime`.

-- Invariant 22 (S55, operator decision): one person is one row, whatever they submit. Rows store lower(email); a
-- request keeps its own copy of the fields as typed that day.
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  kind public.submitter_kind not null,
  name text not null,
  email text not null,
  phone text,
  brokerage text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set by B7's delete_subject and B8's retention_anonymise_contacts when they anonymise the row.
  archived_at timestamptz
);
create unique index contacts_email_key on public.contacts (lower(email));
-- B7's People list.
create index contacts_name_idx on public.contacts (lower(name), id);

-- B8b alters this table (created_at, updated_at, revisions) and seeds its rows; B2's migration 9 holds its policies.
create table public.decline_reasons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  email_paragraph text not null,
  sort int not null default 0,
  enabled boolean not null default true
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  address text not null,
  city text not null,
  state public.accepted_state not null,
  zip char(5) not null,
  listing_url text,
  source_url text,
  price numeric(12, 2),
  currency char(3) not null default 'USD' check (currency = 'USD'),
  property_type public.property_type not null,
  beds int,
  baths numeric(3, 1),
  interior_sq_ft int,
  architect text,
  designer text,
  year_built int,
  year_renovated int,
  -- Required only of an agent (submissions_brokerage_for_agent).
  brokerage text,
  submitter_kind public.submitter_kind not null,
  submitter_name text not null,
  submitter_email text not null,
  submitter_phone text,
  -- An owner only (submissions_listing_for_owner).
  listed_with_agent boolean,
  listing_agent_name text,
  listing_agent_brokerage text,
  -- Null only for a row a test fixture inserts directly: B3's create_submission links every row it writes.
  contact_id uuid references public.contacts (id) on delete restrict,
  photography_url text,
  video_url text,
  story text not null,
  significance text not null,
  package public.exposure_package not null,
  media_budget numeric(12, 2),
  source_path text not null,
  workflow_state public.submission_state not null default 'Submitted',
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  decline_reason_id uuid references public.decline_reasons (id) on delete set null,
  decline_note text,
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  activated_by uuid references auth.users (id) on delete set null,
  activated_at timestamptz,
  property_id uuid references public.properties (id) on delete set null,
  -- Internal staff notes.
  notes jsonb[] not null default '{}',
  turnstile_ok boolean not null default false,
  ip_hash text,
  received_at timestamptz not null default now(),
  -- Invariant 12 (GP-03): what the submitter accepted, when, and from where (sha256(RATE_LIMIT_SALT:ip), never the IP).
  rights_version text not null check (rights_version <> ''),
  rights_confirmed_at timestamptz not null,
  rights_ip_hash text not null,
  constraint submissions_brokerage_for_agent check (
    submitter_kind <> 'agent' or nullif(btrim(brokerage), '') is not null
  ),
  constraint submissions_listing_for_owner check (
    submitter_kind = 'owner'
    or (listed_with_agent is null and listing_agent_name is null and listing_agent_brokerage is null)
  )
);
create index submissions_received_idx on public.submissions (received_at desc);
create index submissions_contact_id_idx on public.submissions (contact_id);
create index submissions_reviewed_by_idx on public.submissions (reviewed_by);
create index submissions_decline_reason_idx on public.submissions (decline_reason_id);
create index submissions_accepted_by_idx on public.submissions (accepted_by);
create index submissions_activated_by_idx on public.submissions (activated_by);
create index submissions_property_idx on public.submissions (property_id);

-- B3's create_submission writes name, bytes and storage_path from each declared entry; mime and sha256 stay null until
-- mark_media_uploaded writes the stored object's values. Invariant 13: the same numbers live in uploadLimits of
-- contracts.ts and in the bucket.
create table public.submission_media (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  name text not null,
  storage_path text not null,
  uploaded_at timestamptz,
  bytes bigint,
  mime text,
  sha256 text,
  constraint submission_media_mime_allowed check (mime in ('image/jpeg', 'image/png', 'image/heic', 'image/webp')),
  constraint submission_media_bytes_range check (bytes between 1 and 26214400)
);
create index submission_media_idx on public.submission_media (submission_id);

create or replace function public.enforce_submission_media_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- GQ-07: the row lock makes concurrent inserts for one submission run one after another, so the count is exact.
  perform 1 from public.submissions where id = new.submission_id for update;
  if (select count(*) from public.submission_media where submission_id = new.submission_id) >= 40 then
    raise exception 'upload_limit';
  end if;
  return new;
end;
$$;

create trigger enforce_submission_media_limit
before insert on public.submission_media
for each row execute function public.enforce_submission_media_limit();

create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  intent public.inquiry_intent not null,
  topic text,
  subject_kind text check (subject_kind in ('property')),
  subject_slug text,
  subject_title text,
  name text not null,
  email text not null,
  phone text,
  location text,
  message text not null,
  details jsonb not null default '{}',
  source_path text not null,
  state public.inquiry_state not null default 'new',
  forwarded_at timestamptz,
  received_at timestamptz not null default now(),
  ip_hash text,
  assigned_to uuid references auth.users (id) on delete set null,
  forwarded_payload jsonb,
  turnstile_ok boolean not null default false
);
create index inquiries_received_idx on public.inquiries (received_at desc);
create index inquiries_subject_idx on public.inquiries (subject_kind, subject_slug);
create index inquiries_assigned_to_idx on public.inquiries (assigned_to);

-- Rows store lower(email). `markets` is the interest of S30: only the three markets.
create table public.subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text not null,
  markets text[] not null default '{}',
  confirmed_at timestamptz,
  confirm_token_hash text,
  unsubscribed_at timestamptz,
  resend_contact_id text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscribers_markets_subset check (markets <@ array['california', 'new-york', 'florida'])
);
create unique index subscribers_email_key on public.subscribers (lower(email));

create trigger contacts_set_updated_at
before update on public.contacts
for each row execute function public.set_updated_at();
create trigger subscribers_set_updated_at
before update on public.subscribers
for each row execute function public.set_updated_at();

-- DL-02 and invariant 22: a property made from a request points back at it; deleting the request leaves the property.
alter table public.properties
  add constraint properties_submission_fk foreign key (submission_id) references public.submissions (id)
  on delete set null;

revoke execute on function public.enforce_submission_media_limit() from public, anon, authenticated;

alter table public.contacts enable row level security;
alter table public.decline_reasons enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_media enable row level security;
alter table public.inquiries enable row level security;
alter table public.subscribers enable row level security;
-- G-100: every grant is explicit; the `authenticated` grants of the RLS matrix come with migration 10.
revoke all on table public.contacts, public.decline_reasons, public.submissions, public.submission_media,
  public.inquiries, public.subscribers
from anon, authenticated;
grant all on table public.contacts, public.decline_reasons, public.submissions, public.submission_media,
  public.inquiries, public.subscribers
to service_role;

-- Invariant 18: personal data never enters audit_log.
insert into public.pii_columns (table_name, column_name)
values
  ('submissions', 'submitter_name'), ('submissions', 'submitter_email'), ('submissions', 'submitter_phone'),
  ('submissions', 'address'), ('submissions', 'listing_agent_name'),
  ('contacts', 'name'), ('contacts', 'email'), ('contacts', 'phone'), ('contacts', 'notes'),
  ('inquiries', 'name'), ('inquiries', 'email'), ('inquiries', 'phone'), ('inquiries', 'message'),
  ('inquiries', 'location'),
  ('subscribers', 'email')
on conflict do nothing;
