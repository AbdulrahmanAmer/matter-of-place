import {
  attributionSchema,
  omnikomPayloadSchema,
  type OmnikomPayload,
} from "../../domain/omnikom.ts";
import type { InquiryRow, PropertyRow, RepresentativeRow } from "../../domain/rows.ts";
import { sha1Bytes, toHex } from "../lib/crypto.ts";

/** The UUID v5 namespace of delivery ids. Fixed forever: changing it changes the id of every inquiry. */
export const OMNIKOM_NS = "4a70994d-6b0f-498c-b6c6-ed12a02d60b6";
const NS_BYTES = Uint8Array.from(OMNIKOM_NS.replaceAll("-", "").match(/../g) ?? [], (pair) =>
  Number.parseInt(pair, 16),
);
const encoder = new TextEncoder();

/** The columns read into `data.inquiry`, and nothing else (B15 invariant 1). */
type InquiryColumns = Pick<
  InquiryRow,
  | "id"
  | "intent"
  | "topic"
  | "name"
  | "email"
  | "phone"
  | "location"
  | "message"
  | "details"
  | "source_path"
  | "received_at"
>;

export type PayloadInquiry = InquiryColumns &
  Pick<InquiryRow, "subject_kind" | "subject_slug" | "subject_title"> & { attribution: unknown };

export type PayloadProperty = Pick<
  PropertyRow,
  "slug" | "title" | "market_slug" | "city" | "campaign_tier" | "presented_by_owner"
> & { representative: Pick<RepresentativeRow, "name" | "brokerage"> | null };

/** UUID v5 (RFC 9562) of the inquiry id: every attempt and every job of one inquiry sends the same id. */
export async function deliveryId(inquiryId: string): Promise<string> {
  const name = encoder.encode(inquiryId);
  const input = new Uint8Array(NS_BYTES.length + name.length);
  input.set(NS_BYTES);
  input.set(name, NS_BYTES.length);
  const bytes = (await sha1Bytes(input)).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = toHex(bytes);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

const compact = (fields: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(fields).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  );

function subjectOf(inquiry: PayloadInquiry, property: PayloadProperty | null) {
  if (inquiry.subject_kind !== "property" || inquiry.subject_slug === null) return undefined;
  if (property === null) {
    return compact({ kind: "property", slug: inquiry.subject_slug, title: inquiry.subject_title });
  }
  const representation =
    property.presented_by_owner || property.representative === null
      ? undefined
      : { name: property.representative.name, brokerage: property.representative.brokerage };
  return compact({
    kind: "property",
    slug: property.slug,
    title: property.title,
    market: property.market_slug,
    city: property.city,
    tier: property.campaign_tier,
    presented_by: property.presented_by_owner ? "owner" : "agent",
    representation,
  });
}

/** The v1 body (B15 Contract). Pure: the same row and property always give the same body. */
export async function buildInquiryPayload(
  inquiry: PayloadInquiry,
  property: PayloadProperty | null,
  opts: { test?: true } = {},
): Promise<OmnikomPayload> {
  return omnikomPayloadSchema.parse(
    compact({
      id: await deliveryId(inquiry.id),
      version: 1,
      type: "inquiry.received",
      occurred_at: inquiry.received_at,
      source: "matterofplace.com",
      test: opts.test,
      data: compact({
        inquiry: compact({
          id: inquiry.id,
          intent: inquiry.intent,
          topic: inquiry.topic,
          name: inquiry.name,
          email: inquiry.email,
          phone: inquiry.phone,
          location: inquiry.location,
          message: inquiry.message,
          details: inquiry.details,
          source_path: inquiry.source_path,
          received_at: inquiry.received_at,
        }),
        subject: subjectOf(inquiry, property),
        attribution: attributionSchema.parse(inquiry.attribution),
      }),
    }),
  );
}
