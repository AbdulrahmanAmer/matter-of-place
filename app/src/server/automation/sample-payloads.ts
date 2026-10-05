import type { Enums } from "../../db/index.ts";
import { eventTypes, type EventType, type Tier } from "../../domain/events.ts";
import type { MarketSlug } from "../../domain/market.ts";
import type { JsonObject } from "../jobs/types.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { subscriberIdQuery } from "../subscribers/lookup.ts";

// The payload a real event would carry, built from a real row, so a dry-run shows what the planner would do with it
// (B8b step 5). A field the row cannot give is left out: a condition on it does not match (invariant 9) and the
// dry-run warns that the payload fails its schema, as the real fan-out would log it.

type Builder = (db: Db, id: string, now: Date) => Promise<JsonObject>;

const packageTiers: Record<Enums<"exposure_package">, Tier | undefined> = {
  "The Feature": "Feature",
  "Five Features": "Feature",
  "The Reach": "Reach",
  "The Campaign": "Campaign",
  "Not sure yet": undefined,
};

const stateMarkets: Record<Enums<"accepted_state">, MarketSlug> = {
  California: "california",
  "New York": "new-york",
  Florida: "florida",
};

// Fields no row holds: the Request assets dialog text, and the sealed confirmation token of a subscriber.
const SAMPLE_NOTE = "Please add the exterior photographs.";
const SAMPLE_SEALED_TOKEN = "sample-sealed-token";

type Answer<T> = { data: T[]; error: null } | { data: null; error: { message: string } };

/** The first row of a read by id; a missing row is a 404, a failed read a 503. */
async function firstRow<T>(read: PromiseLike<Answer<T>>, what: string): Promise<T> {
  const { data, error } = await read;
  if (error !== null) {
    throw new AppError("unavailable", undefined, `The ${what} could not be read.`);
  }
  const row = data[0];
  if (row === undefined) throw new AppError("not_found", undefined, `The ${what} does not exist.`);
  return row;
}

const submissionRow = (db: Db, id: string) =>
  firstRow(
    db
      .from("submissions")
      .select("id, package, state, decline_reason_id, decline_note, property_id")
      .eq("id", id),
    "submission",
  );

const paymentRow = (db: Db, id: string) =>
  firstRow(
    db
      .from("payments")
      .select("id, submission_id, invoice_number, status, amount, product, notes")
      .eq("id", id),
    "payment",
  );

const propertyRow = (db: Db, id: string) =>
  firstRow(
    db
      .from("properties")
      .select(
        "id, slug, campaign_tier, market_slug, submission_id, unpublish_reason, taken_down_at",
      )
      .eq("id", id),
    "property",
  );

async function assetEvent(
  db: Db,
  id: string,
): Promise<{ payload: JsonObject; rejectionNote: string | null }> {
  const asset = await firstRow(
    db.from("assets").select("id, property_id, kind, rejection_note").eq("id", id),
    "asset",
  );
  const property = await firstRow(
    db.from("properties").select("campaign_tier, market_slug").eq("id", asset.property_id),
    "property",
  );
  return {
    payload: {
      asset_id: asset.id,
      property_id: asset.property_id,
      kind: asset.kind,
      tier: property.campaign_tier,
      market: property.market_slug,
    },
    rejectionNote: asset.rejection_note,
  };
}

const subscriberRow = (db: Db, id: string) => firstRow(subscriberIdQuery(db, id), "subscriber");

const builders: Record<EventType, Builder> = {
  "submission.received": async (db, id) => ({ submission_id: (await submissionRow(db, id)).id }),
  "submission.declined": async (db, id) => {
    const row = await submissionRow(db, id);
    return {
      submission_id: row.id,
      decline_reason_id: row.decline_reason_id ?? undefined,
      note: row.decline_note ?? undefined,
      tier: packageTiers[row.package],
      market: stateMarkets[row.state],
    };
  },
  "submission.accepted": async (db, id) => {
    const row = await submissionRow(db, id);
    return {
      submission_id: row.id,
      tier: packageTiers[row.package],
      market: stateMarkets[row.state],
    };
  },
  "submission.awaiting_assets": async (db, id) => {
    const row = await submissionRow(db, id);
    return {
      submission_id: row.id,
      note: SAMPLE_NOTE,
      tier: packageTiers[row.package],
      market: stateMarkets[row.state],
    };
  },
  "invoice.issued": async (db, id) => {
    const row = await paymentRow(db, id);
    return {
      submission_id: row.submission_id,
      payment_id: row.id,
      invoice_number: row.invoice_number ?? undefined,
      tier: packageTiers[row.product],
    };
  },
  "payment.marked": async (db, id) => {
    const row = await paymentRow(db, id);
    return {
      submission_id: row.submission_id,
      payment_id: row.id,
      status: row.status === "waived" ? "waived" : "paid",
      amount: row.amount,
      tier: packageTiers[row.product],
    };
  },
  "submission.activated": async (db, id) => {
    const row = await submissionRow(db, id);
    return {
      submission_id: row.id,
      property_id: row.property_id ?? undefined,
      tier: packageTiers[row.package],
      market: stateMarkets[row.state],
    };
  },
  "invoice.voided": async (db, id) => {
    const row = await paymentRow(db, id);
    return {
      submission_id: row.submission_id,
      payment_id: row.id,
      invoice_number: row.invoice_number ?? undefined,
      reason: row.notes ?? "",
    };
  },
  "property.published": async (db, id) => {
    const row = await propertyRow(db, id);
    return {
      property_id: row.id,
      slug: row.slug,
      tier: row.campaign_tier,
      market: row.market_slug,
      submission_id: row.submission_id ?? undefined,
    };
  },
  "property.unpublished": async (db, id) => {
    const row = await propertyRow(db, id);
    return {
      property_id: row.id,
      slug: row.slug,
      market: row.market_slug,
      reason: row.unpublish_reason ?? "",
      takedown: row.taken_down_at !== null,
    };
  },
  "asset.approved": async (db, id) => (await assetEvent(db, id)).payload,
  "asset.rejected": async (db, id) => {
    const { payload, rejectionNote } = await assetEvent(db, id);
    return { ...payload, note: rejectionNote ?? "" };
  },
  "digest.due": (_db, _id, now) => Promise.resolve({ scheduled_for: now.toISOString() }),
  "inquiry.received": async (db, id) => ({
    inquiry_id: (await firstRow(db.from("inquiries").select("id").eq("id", id), "inquiry")).id,
  }),
  "subscriber.created": async (db, id) => ({
    subscriber_id: (await subscriberRow(db, id)).id,
    sealed_token: SAMPLE_SEALED_TOKEN,
  }),
  "subscriber.confirmed": async (db, id) => ({ subscriber_id: (await subscriberRow(db, id)).id }),
  "health.failed": (_db, _id, now) =>
    Promise.resolve({
      date: now.toISOString().slice(0, 10),
      failed: [{ check: "sample_check", message: "A sample check failed." }],
      summary: "1 checks failed: sample_check",
      link_path: "/admin/jobs",
    }),
  "subject_request.received": async (db, id) => {
    const row = await firstRow(
      db.from("subject_requests").select("id, kind").eq("id", id),
      "subject request",
    );
    return { request_id: row.id, kind: row.kind };
  },
};

// `digest.due` and `health.failed` are written by the system, about no row.
const systemEvents: readonly EventType[] = ["digest.due", "health.failed"];

/** Builds the payload of `trigger` from the row `entityId` names; a system event needs no row. */
export async function samplePayloadFor(
  db: Db,
  trigger: string,
  entityId: string | undefined,
  now: Date,
): Promise<JsonObject> {
  const type = eventTypes.find((known) => known === trigger);
  if (type === undefined) {
    throw new AppError("unknown_trigger", undefined, `No event is called ${trigger}.`);
  }
  if (entityId === undefined && !systemEvents.includes(type)) {
    throw new AppError("validation", undefined, "Name the record the event is about.");
  }
  return builders[type](db, entityId ?? "", now);
}
