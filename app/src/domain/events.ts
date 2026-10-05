import { z } from "zod";
import { marketSlugSchema } from "./market.ts";

/** The event catalog of architecture 3.6: the same 18 types as the check constraint on `events.type`. */
export const eventTypes = [
  "submission.received",
  "submission.declined",
  "submission.accepted",
  "submission.awaiting_assets",
  "invoice.issued",
  "payment.marked",
  "submission.activated",
  "property.published",
  "property.unpublished",
  "asset.approved",
  "asset.rejected",
  "digest.due",
  "inquiry.received",
  "subscriber.created",
  "subscriber.confirmed",
  "invoice.voided",
  "health.failed",
  "subject_request.received",
] as const;

export type EventType = (typeof eventTypes)[number];

/** The tiers a recipe condition or a channel's approval mode can name (S23). */
export const tiers = ["Feature", "Reach", "Campaign"] as const;
export type Tier = (typeof tiers)[number];

export const marketSlugs = marketSlugSchema.options;

/**
 * The asset kinds of architecture 3.6. `variants` is listed for parity but no payload carries it: the variants of
 * a photograph live on `property_media` and have no `assets` row (G61).
 */
export const assetKinds = [
  "variants",
  "cover",
  "carousel",
  "story",
  "reel",
  "newsletter_block",
  "standalone_email",
] as const;

const id = z.string().uuid();
// The tier of a property: Editorial has no channel tier, so no condition can name it.
const payloadTier = z.enum(["Editorial", ...tiers]);
const market = marketSlugSchema;
const kind = z.enum(assetKinds);

// One object per event type; `.passthrough()` lets a producer add fields. The planner reads only `tier`, `market`
// and `kind`.
export const eventPayloadSchemas = {
  "submission.received": z.object({ submission_id: id }).passthrough(),
  "submission.declined": z
    .object({
      submission_id: id,
      decline_reason_id: id.optional(),
      note: z.string().optional(),
      tier: payloadTier,
      market,
    })
    .passthrough(),
  "submission.accepted": z.object({ submission_id: id, tier: payloadTier, market }).passthrough(),
  "submission.awaiting_assets": z
    .object({ submission_id: id, note: z.string().min(1), tier: payloadTier, market })
    .passthrough(),
  "invoice.issued": z
    .object({
      submission_id: id,
      payment_id: id,
      invoice_number: z.string().min(1),
      tier: payloadTier,
    })
    .passthrough(),
  "payment.marked": z
    .object({
      submission_id: id,
      payment_id: id,
      status: z.enum(["paid", "waived"]),
      amount: z.number(),
      tier: payloadTier,
    })
    .passthrough(),
  "submission.activated": z
    .object({ submission_id: id, property_id: id, tier: payloadTier, market })
    .passthrough(),
  "invoice.voided": z
    .object({
      submission_id: id,
      payment_id: id,
      invoice_number: z.string().min(1),
      reason: z.string(),
    })
    .passthrough(),
  "property.published": z
    .object({
      property_id: id,
      slug: z.string().min(1),
      tier: payloadTier,
      market,
      submission_id: id.optional(),
    })
    .passthrough(),
  "property.unpublished": z
    .object({
      property_id: id,
      slug: z.string().min(1),
      market,
      reason: z.string(),
      takedown: z.boolean(),
    })
    .passthrough(),
  "asset.approved": z
    .object({ asset_id: id, property_id: id, kind, tier: payloadTier, market })
    .passthrough(),
  "asset.rejected": z
    .object({ asset_id: id, property_id: id, kind, tier: payloadTier, market, note: z.string() })
    .passthrough(),
  "digest.due": z.object({ scheduled_for: z.string().datetime() }).passthrough(),
  "inquiry.received": z.object({ inquiry_id: id }).passthrough(),
  "subscriber.created": z
    .object({ subscriber_id: id, sealed_token: z.string().min(1) })
    .passthrough(),
  "subscriber.confirmed": z.object({ subscriber_id: id }).passthrough(),
  "health.failed": z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      failed: z.array(z.object({ check: z.string(), message: z.string() })),
      summary: z.string(),
      link_path: z.string(),
    })
    .passthrough(),
  "subject_request.received": z.object({ request_id: id, kind: z.string().min(1) }).passthrough(),
} satisfies Record<EventType, z.ZodTypeAny>;
