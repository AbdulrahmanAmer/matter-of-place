import type { EventType } from "../../../../src/domain/events";
import type { JsonObject } from "../../../../src/server/jobs/types";

const SUBMISSION = "6f0a7a5e-1c1f-4b0e-9d0b-3c3b1a1f0a01";
const PROPERTY = "6f0a7a5e-1c1f-4b0e-9d0b-3c3b1a1f0a02";
const PAYMENT = "6f0a7a5e-1c1f-4b0e-9d0b-3c3b1a1f0a03";
const ASSET = "6f0a7a5e-1c1f-4b0e-9d0b-3c3b1a1f0a04";
const SUBSCRIBER = "6f0a7a5e-1c1f-4b0e-9d0b-3c3b1a1f0a05";

/** One example payload per event type, copied from the Event payloads table of B8b. */
export const eventPayloadExamples: Record<EventType, JsonObject> = {
  "submission.received": { submission_id: SUBMISSION },
  "submission.declined": {
    submission_id: SUBMISSION,
    note: "Outside the editorial standard.",
    tier: "Feature",
    market: "california",
  },
  "submission.accepted": { submission_id: SUBMISSION, tier: "Feature", market: "florida" },
  "submission.awaiting_assets": {
    submission_id: SUBMISSION,
    note: "Please add the exterior photographs.",
    tier: "Reach",
    market: "new-york",
  },
  "invoice.issued": {
    submission_id: SUBMISSION,
    payment_id: PAYMENT,
    invoice_number: "MOP-0001",
    tier: "Campaign",
  },
  "payment.marked": {
    submission_id: SUBMISSION,
    payment_id: PAYMENT,
    status: "paid",
    amount: 2400,
    tier: "Campaign",
  },
  "submission.activated": {
    submission_id: SUBMISSION,
    property_id: PROPERTY,
    tier: "Feature",
    market: "california",
  },
  "invoice.voided": {
    submission_id: SUBMISSION,
    payment_id: PAYMENT,
    invoice_number: "MOP-0001",
    reason: "Issued in error.",
  },
  "property.published": {
    property_id: PROPERTY,
    slug: "casa-mirador",
    tier: "Campaign",
    market: "california",
    submission_id: SUBMISSION,
  },
  "property.unpublished": {
    property_id: PROPERTY,
    slug: "casa-mirador",
    market: "california",
    reason: "Owner request.",
    takedown: false,
  },
  "asset.approved": {
    asset_id: ASSET,
    property_id: PROPERTY,
    kind: "cover",
    tier: "Feature",
    market: "california",
  },
  "asset.rejected": {
    asset_id: ASSET,
    property_id: PROPERTY,
    kind: "carousel",
    tier: "Feature",
    market: "california",
    note: "The second slide crops the facade.",
  },
  "digest.due": { scheduled_for: "2026-10-13T14:00:00.000Z" },
  "inquiry.received": { inquiry_id: "6f0a7a5e-1c1f-4b0e-9d0b-3c3b1a1f0a06" },
  "subscriber.created": { subscriber_id: SUBSCRIBER, sealed_token: "sealed.token.value" },
  "subscriber.confirmed": { subscriber_id: SUBSCRIBER },
  "health.failed": {
    date: "2026-10-04",
    failed: [{ check: "jobs_liveness", message: "No heartbeat for 20 minutes." }],
    summary: "1 checks failed: jobs_liveness",
    link_path: "/admin/jobs",
  },
  "subject_request.received": {
    request_id: "6f0a7a5e-1c1f-4b0e-9d0b-3c3b1a1f0a07",
    kind: "access",
  },
};
