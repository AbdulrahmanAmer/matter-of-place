import { describe, expect, it } from "vitest";
import { entityJobsFilter, jobEntityKeys } from "../../../src/server/lib/jobs";

const ID = "3f2a9c1d-0000-4000-8000-000000000001";

describe("entityJobsFilter", () => {
  it("names the event path first, then every payload key and the manual key (G64)", () => {
    expect(entityJobsFilter(ID)).toBe(
      [
        `job_event_entity_id.eq.${ID}`,
        `payload->data->>submission_id.eq.${ID}`,
        `payload->data->>property_id.eq.${ID}`,
        `payload->data->>payment_id.eq.${ID}`,
        `payload->data->>asset_id.eq.${ID}`,
        `payload->data->>inquiry_id.eq.${ID}`,
        `payload->data->>subscriber_id.eq.${ID}`,
        `payload->data->>request_id.eq.${ID}`,
        `idempotency_key.like.*:${ID}:*`,
      ].join(","),
    );
  });

  it("throws on a value that is not a uuid", () => {
    expect(() => entityJobsFilter("abc")).toThrow("The entity id is not a uuid.");
    expect(() => entityJobsFilter(`${ID},status.eq.dead`)).toThrow("The entity id is not a uuid.");
  });

  it("lists the seven entity keys of a job's data", () => {
    expect(jobEntityKeys).toEqual([
      "submission_id",
      "property_id",
      "payment_id",
      "asset_id",
      "inquiry_id",
      "subscriber_id",
      "request_id",
    ]);
  });
});
