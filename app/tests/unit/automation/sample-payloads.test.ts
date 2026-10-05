import { describe, expect, it } from "vitest";
import { eventPayloadSchemas, eventTypes } from "../../../src/domain/events";
import { samplePayloadFor } from "../../../src/server/automation/sample-payloads";
import { assetRow, propertyRow } from "../../fixtures/asset-rows";
import { fakeDb, type FakeDbOptions } from "../../fixtures/fake-db";
import {
  inquiryRow,
  paymentRow,
  subjectRequestRow,
  submissionRow,
  subscriberRow,
  PROPERTY_ID,
  SUBMISSION_ID,
} from "./fixtures/entity-rows";

const NOW = new Date("2026-10-13T14:00:00.000Z");
const ID = "5c1e0a00-0000-4000-8000-0000000000ff";

function tables(overrides: NonNullable<FakeDbOptions["tables"]> = {}): FakeDbOptions {
  return {
    tables: {
      submissions: [submissionRow({ property_id: PROPERTY_ID })],
      payments: [paymentRow()],
      properties: [propertyRow({ campaign_tier: "Feature", market_slug: "california" })],
      assets: [assetRow()],
      inquiries: [inquiryRow()],
      subscribers: [subscriberRow()],
      subject_requests: [subjectRequestRow()],
      ...overrides,
    },
  };
}

const sample = (trigger: string, options: FakeDbOptions = tables()) =>
  samplePayloadFor(fakeDb(options), trigger, ID, NOW);

describe("samplePayloadFor", () => {
  it("builds a payload for each of the 18 triggers that its event schema accepts", async () => {
    const refused: string[] = [];
    for (const type of eventTypes) {
      const payload = await sample(type);
      if (!eventPayloadSchemas[type].safeParse(payload).success) refused.push(type);
    }
    expect(eventTypes).toHaveLength(18);
    expect(refused).toEqual([]);
  });

  it("takes tier from the package and market from the state of a submission", async () => {
    const campaign = submissionRow({ package: "The Campaign", state: "Florida" });
    const credits = submissionRow({ package: "Five Features", state: "California" });
    expect(await sample("submission.accepted", tables({ submissions: [campaign] }))).toEqual({
      submission_id: SUBMISSION_ID,
      tier: "Campaign",
      market: "florida",
    });
    expect(await sample("submission.accepted", tables({ submissions: [credits] }))).toEqual({
      submission_id: SUBMISSION_ID,
      tier: "Feature",
      market: "california",
    });
  });

  it("leaves tier out for a package with none, so the schema refuses it", async () => {
    const undecided = submissionRow({ package: "Not sure yet" });
    const payload = await sample("submission.accepted", tables({ submissions: [undecided] }));
    expect(payload["tier"]).toBeUndefined();
    expect(eventPayloadSchemas["submission.accepted"].safeParse(payload).success).toBe(false);
  });

  it("leaves property_id out for a submission that has no property yet", async () => {
    const payload = await sample(
      "submission.activated",
      tables({ submissions: [submissionRow()] }),
    );
    expect(payload["property_id"]).toBeUndefined();
    expect(eventPayloadSchemas["submission.activated"].safeParse(payload).success).toBe(false);
  });

  it("carries the decline reason and note a declined submission holds", async () => {
    const declined = submissionRow({
      decline_reason_id: "5c1e0a00-0000-4000-8000-0000000000aa",
      decline_note: "Outside the editorial standard.",
    });
    expect(await sample("submission.declined", tables({ submissions: [declined] }))).toEqual({
      submission_id: SUBMISSION_ID,
      decline_reason_id: "5c1e0a00-0000-4000-8000-0000000000aa",
      note: "Outside the editorial standard.",
      tier: "Reach",
      market: "new-york",
    });
  });

  it("marks a waived payment waived and any other paid", async () => {
    const waived = paymentRow({ status: "waived" });
    expect(await sample("payment.marked", tables({ payments: [waived] }))).toMatchObject({
      status: "waived",
      amount: 695,
      tier: "Reach",
    });
    expect(await sample("payment.marked")).toMatchObject({ status: "paid" });
  });

  it("gives an unpublished property its reason and whether it was taken down", async () => {
    const down = propertyRow({
      unpublish_reason: "Owner request.",
      taken_down_at: "2026-10-04T12:00:00.000Z",
    });
    expect(await sample("property.unpublished", tables({ properties: [down] }))).toMatchObject({
      reason: "Owner request.",
      takedown: true,
    });
    expect(await sample("property.unpublished")).toMatchObject({ reason: "", takedown: false });
  });

  it("gives a rejected asset its note, and an approved one none", async () => {
    const rejected = assetRow({ rejection_note: "The second slide crops the facade." });
    const options = tables({ assets: [rejected] });
    expect(await sample("asset.rejected", options)).toMatchObject({
      kind: "cover",
      tier: "Feature",
      market: "california",
      note: "The second slide crops the facade.",
    });
    expect(await sample("asset.approved", options)).not.toHaveProperty("note");
  });

  it("builds the two system events without a row", async () => {
    const db = fakeDb();
    expect(await samplePayloadFor(db, "digest.due", undefined, NOW)).toEqual({
      scheduled_for: "2026-10-13T14:00:00.000Z",
    });
    expect(await samplePayloadFor(db, "health.failed", undefined, NOW)).toMatchObject({
      date: "2026-10-13",
      failed: [{ check: "sample_check" }],
    });
    expect(db.calls).toEqual([]);
  });

  it("refuses an unknown trigger, a missing record and a row that does not exist", async () => {
    await expect(sample("nope.event")).rejects.toMatchObject({ code: "unknown_trigger" });
    await expect(
      samplePayloadFor(fakeDb(tables()), "submission.received", undefined, NOW),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(sample("submission.received", tables({ submissions: [] }))).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
