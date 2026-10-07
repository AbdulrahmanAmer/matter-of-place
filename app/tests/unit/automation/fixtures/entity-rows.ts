import type { Tables } from "../../../../src/db";

// One complete row per table an event is about, for `fakeDb`: the samples of B8b step 5 read these.
export const STAMP = "2026-10-04T12:00:00.000Z";

export const SUBMISSION_ID = "5c1e0a00-0000-4000-8000-000000000001";
export const PAYMENT_ID = "5c1e0a00-0000-4000-8000-000000000002";
export const PROPERTY_ID = "5c1e0a00-0000-4000-8000-000000000003";
export const REASON_ID = "5c1e0a00-0000-4000-8000-000000000004";
export const INQUIRY_ID = "5c1e0a00-0000-4000-8000-000000000005";
export const SUBSCRIBER_ID = "5c1e0a00-0000-4000-8000-000000000006";
export const REQUEST_ID = "5c1e0a00-0000-4000-8000-000000000007";

export function submissionRow(overrides: Partial<Tables<"submissions">> = {}) {
  const row: Tables<"submissions"> = {
    accepted_at: null,
    accepted_by: null,
    activated_at: null,
    activated_by: null,
    address: "1 Test Way",
    architect: null,
    baths: 3,
    beds: 4,
    brokerage: null,
    city: "Malibu",
    contact_id: null,
    currency: "USD",
    decline_note: null,
    decline_reason_id: null,
    designer: null,
    duplicate_of: null,
    id: SUBMISSION_ID,
    interior_sq_ft: 3200,
    ip_hash: null,
    listed_with_agent: null,
    listing_agent_brokerage: null,
    listing_agent_name: null,
    listing_url: null,
    media_budget: null,
    notes: [],
    package: "The Reach",
    photography_url: null,
    price: null,
    property_id: null,
    property_type: "Residence",
    received_at: STAMP,
    reviewed_at: null,
    reviewed_by: null,
    rights_confirmed_at: STAMP,
    rights_ip_hash: "hash",
    rights_version: "1",
    significance: "A house worth the attention.",
    source_path: "/submit",
    source_url: null,
    state: "New York",
    story: "A short story.",
    submitter_email: "owner@fixtures.invalid",
    submitter_kind: "owner",
    submitter_name: "An Owner",
    submitter_phone: null,
    turnstile_ok: true,
    updated_at: STAMP,
    video_url: null,
    workflow_state: "Submitted",
    year_built: 1998,
    year_renovated: null,
    zip: "11963",
    ...overrides,
  };
  return row;
}

export function paymentRow(overrides: Partial<Tables<"payments">> = {}) {
  const row: Tables<"payments"> = {
    amount: 695,
    created_at: STAMP,
    currency: "USD",
    due_at: null,
    id: PAYMENT_ID,
    invoice_file_key: null,
    invoice_number: "MOP-0001",
    invoice_snapshot: null,
    issued_at: STAMP,
    issued_by: null,
    method: "invoice_manual",
    notes: null,
    paid_at: null,
    paid_marked_by: null,
    paid_method: null,
    paid_reference: null,
    preferred_method: null,
    product: "The Reach",
    property_id: null,
    status: "due",
    stripe_payment_intent: null,
    submission_id: SUBMISSION_ID,
    updated_at: STAMP,
    waived_by: null,
    ...overrides,
  };
  return row;
}

export function inquiryRow(overrides: Partial<Tables<"inquiries">> = {}) {
  const row: Tables<"inquiries"> = {
    anonymised_at: null,
    assigned_to: null,
    attribution: {},
    details: {},
    email: "reader@fixtures.invalid",
    forwarded_at: null,
    forwarded_payload: null,
    id: INQUIRY_ID,
    intent: "general",
    ip_hash: null,
    location: null,
    message: "A question.",
    name: "A Reader",
    phone: null,
    received_at: STAMP,
    source_path: "/contact",
    state: "new",
    subject_kind: null,
    subject_slug: null,
    subject_title: null,
    topic: null,
    turnstile_ok: true,
    ...overrides,
  };
  return row;
}

export function subscriberRow(overrides: Partial<Tables<"subscribers">> = {}) {
  const row: Tables<"subscribers"> = {
    archived_at: null,
    confirm_token_hash: null,
    confirmed_at: null,
    created_at: STAMP,
    email: "reader@fixtures.invalid",
    id: SUBSCRIBER_ID,
    last_engaged_at: null,
    markets: ["california"],
    pending_source: null,
    repermission_sent_at: null,
    resend_contact_id: null,
    source: "footer",
    unsubscribed_at: null,
    updated_at: STAMP,
    ...overrides,
  };
  return row;
}

export function subjectRequestRow(overrides: Partial<Tables<"subject_requests">> = {}) {
  const row: Tables<"subject_requests"> = {
    created_at: STAMP,
    due_at: null,
    email: "reader@fixtures.invalid",
    fulfilled_at: null,
    handled_by: null,
    id: REQUEST_ID,
    ip_hash: null,
    kind: "access",
    note: null,
    received_at: STAMP,
    status: "open",
    turnstile_ok: true,
    updated_at: STAMP,
    verified_at: null,
    ...overrides,
  };
  return row;
}
