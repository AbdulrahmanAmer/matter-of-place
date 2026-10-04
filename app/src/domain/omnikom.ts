import { z } from "zod";
import { inquirySchema } from "./contracts.ts";
import { marketSlugSchema } from "./market.ts";
import { propertySchema } from "./property.ts";

// Version 1 of the Omnikom inquiry webhook body (B15 Contract, docs/omnikom-webhook.md). The sender, the mock receiver
// and the tests parse with these schemas. The attribution names are the `inquiries.attribution` column's and the form
// contract's (G-004): a rename touches all three. Absent values are omitted, never null and never empty strings.

const present = z.string().min(1);
const isoTime = z.string().datetime({ offset: true });
const attributionText = present.max(200);

const touchSchema = z.object({
  landing_path: attributionText.optional(),
  referrer_host: attributionText.optional(),
  utm_source: attributionText.optional(),
  utm_medium: attributionText.optional(),
  utm_campaign: attributionText.optional(),
  utm_content: attributionText.optional(),
  at: isoTime.optional(),
});

/** What the browser captured for the session (B15 invariant 4); unknown keys are dropped, never forwarded. */
export const attributionSchema = z.object({
  first_touch: touchSchema.optional(),
  last_touch: touchSchema.optional(),
  pages_viewed: z.number().int().min(0).optional(),
});

const inquiryBlockSchema = z
  .object({
    id: z.string().uuid(),
    intent: inquirySchema.shape.intent,
    topic: present.optional(),
    name: present,
    email: present,
    phone: present.optional(),
    location: present.optional(),
    message: present,
    details: z.record(z.string(), z.unknown()),
    source_path: present.optional(),
    received_at: isoTime,
  })
  .strict();

const subjectSchema = z
  .object({
    kind: z.literal("property"),
    slug: present,
    title: present.optional(),
    market: marketSlugSchema.optional(),
    city: present.optional(),
    tier: propertySchema.shape.campaignTier,
    presented_by: z.enum(["agent", "owner"]).optional(),
    representation: z.object({ name: present, brokerage: present }).strict().optional(),
  })
  .strict();

export const omnikomPayloadSchema = z
  .object({
    id: z.string().uuid(),
    version: z.literal(1),
    type: z.literal("inquiry.received"),
    occurred_at: isoTime,
    source: z.literal("matterofplace.com"),
    test: z.literal(true).optional(),
    data: z
      .object({
        inquiry: inquiryBlockSchema,
        subject: subjectSchema.optional(),
        attribution: attributionSchema.strict(),
      })
      .strict(),
  })
  .strict();
export type OmnikomPayload = z.infer<typeof omnikomPayloadSchema>;
