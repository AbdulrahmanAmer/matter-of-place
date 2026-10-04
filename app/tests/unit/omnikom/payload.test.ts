import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { omnikomPayloadSchema } from "../../../src/domain/omnikom";
import type { InquiryRow } from "../../../src/domain/rows";
import {
  OMNIKOM_NS,
  buildInquiryPayload,
  deliveryId,
  type PayloadProperty,
} from "../../../src/server/omnikom/payload";

const ALLOW_LIST = [
  "id",
  "intent",
  "topic",
  "name",
  "email",
  "phone",
  "location",
  "message",
  "details",
  "source_path",
  "received_at",
];
const RECEIVED_AT = "2026-10-04T09:30:00.000+00:00";
const ATTRIBUTION = {
  first_touch: {
    landing_path: "/",
    referrer_host: "www.google.com",
    at: "2026-10-04T09:12:00.000Z",
  },
  last_touch: {
    landing_path: "/california",
    utm_source: "newsletter",
    at: "2026-10-04T09:20:00.000Z",
  },
  pages_viewed: 4,
};

const row = (fields: Partial<InquiryRow> = {}): InquiryRow & { attribution: unknown } => ({
  id: "2aad04a4-3848-43fc-b90e-1db79b89f5ac",
  intent: "showing",
  topic: "About a property",
  subject_kind: null,
  subject_slug: null,
  subject_title: null,
  name: "Ada Reyes",
  email: "ada@example.com",
  phone: "+1 415 555 0100",
  location: "San Francisco",
  message: "Could we see the house on Saturday?",
  details: { timing: "This month" },
  source_path: "/property/sea-ranch-house",
  state: "new",
  forwarded_at: null,
  received_at: RECEIVED_AT,
  ip_hash: "ip-hash-value-7f3a",
  assigned_to: "9a1d6c55-6f5e-4c84-9d2b-6d1f1f0e2a10",
  forwarded_payload: null,
  turnstile_ok: true,
  anonymised_at: null,
  attribution: ATTRIBUTION,
  ...fields,
});

const onProperty = {
  subject_kind: "property",
  subject_slug: "sea-ranch-house",
  subject_title: "Sea Ranch House",
};
const property = (fields: Partial<PayloadProperty> = {}): PayloadProperty => ({
  slug: "sea-ranch-house",
  title: "Sea Ranch House",
  market_slug: "california",
  city: "The Sea Ranch",
  campaign_tier: "Feature",
  presented_by_owner: false,
  representative: { name: "Maya Lin", brokerage: "Coastal Partners" },
  ...fields,
});

const wire = async (...args: Parameters<typeof buildInquiryPayload>): Promise<unknown> =>
  JSON.parse(JSON.stringify(await buildInquiryPayload(...args)));
const Vector = z.object({ body: z.string() });

describe("buildInquiryPayload", () => {
  it("invariant 1: data.inquiry holds exactly the allow-list, and ip_hash, turnstile_ok and assigned_to never reach the body", async () => {
    const payload = await buildInquiryPayload(row(), null);
    expect(Object.keys(payload.data.inquiry).sort()).toEqual([...ALLOW_LIST].sort());
    const body = JSON.stringify(payload);
    for (const leaked of [
      "ip_hash",
      "ip-hash-value-7f3a",
      "turnstile_ok",
      "assigned_to",
      "9a1d6c55",
      "state",
    ]) {
      expect(body).not.toContain(leaked);
    }
    expect(payload.data.attribution).toEqual(ATTRIBUTION);
  });

  it("omits absent values instead of sending null or empty strings", async () => {
    const body = JSON.stringify(
      await buildInquiryPayload(row({ phone: null, location: "", topic: null }), null),
    );
    expect(body).not.toContain("null");
    expect(body).not.toContain('""');
    expect(body).not.toMatch(/"(phone|location|topic)"/);
  });

  it("leaves subject out of a general message", async () => {
    const payload = await buildInquiryPayload(row({ intent: "general" }), null);
    expect(payload.data).not.toHaveProperty("subject");
  });

  it("gives a subject of kind, slug and title only when the property row is missing", async () => {
    const payload = await buildInquiryPayload(row(onProperty), null);
    expect(payload.data.subject).toEqual({
      kind: "property",
      slug: "sea-ranch-house",
      title: "Sea Ranch House",
    });
  });

  it("presents an owner's home as presented_by owner with no representation (S55)", async () => {
    const payload = await buildInquiryPayload(
      row(onProperty),
      property({ presented_by_owner: true }),
    );
    expect(payload.data.subject?.presented_by).toBe("owner");
    expect(payload.data.subject).not.toHaveProperty("representation");
  });

  it("presents a represented home as presented_by agent with its representation (S55)", async () => {
    expect(await wire(row(onProperty), property())).toMatchObject({
      data: {
        subject: {
          kind: "property",
          slug: "sea-ranch-house",
          title: "Sea Ranch House",
          market: "california",
          city: "The Sea Ranch",
          tier: "Feature",
          presented_by: "agent",
          representation: { name: "Maya Lin", brokerage: "Coastal Partners" },
        },
      },
    });
  });

  it("invariant 2: the delivery id is the UUID v5 of the inquiry id, the same on every call and different for another inquiry", async () => {
    const id = "2aad04a4-3848-43fc-b90e-1db79b89f5ac";
    const name = Buffer.concat([
      Buffer.from(OMNIKOM_NS.replaceAll("-", ""), "hex"),
      Buffer.from(id),
    ]);
    const hash = createHash("sha1").update(name).digest();
    hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
    hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
    const hex = hash.subarray(0, 16).toString("hex");
    const expected = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

    expect(await deliveryId(id)).toBe(expected);
    expect(await deliveryId(id)).toBe(await deliveryId(id));
    expect(await deliveryId("0f8f4a0e-1d0b-4f7e-9a51-6f0f3c9b2d11")).not.toBe(expected);
    expect((await buildInquiryPayload(row(), null)).id).toBe(expected);
  });

  it("sets occurred_at to received_at, so it does not move between attempts", async () => {
    const payload = await buildInquiryPayload(row(), null);
    expect(payload.occurred_at).toBe(RECEIVED_AT);
  });

  it('sends "test" only when { test: true } is passed', async () => {
    expect(await buildInquiryPayload(row(), null)).not.toHaveProperty("test");
    expect(await buildInquiryPayload(row(), null, { test: true })).toHaveProperty("test", true);
  });

  it("keeps a body with a 5,000-character message under 64 KB", async () => {
    const payload = await buildInquiryPayload(row({ message: "é".repeat(5000) }), null);
    expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeLessThan(64 * 1024);
  });

  it("accepts the shared vector body as a v1 body", () => {
    const vector = Vector.parse(
      JSON.parse(readFileSync(new URL("vector.json", import.meta.url), "utf8")),
    );
    expect(omnikomPayloadSchema.safeParse(JSON.parse(vector.body)).success).toBe(true);
  });
});
