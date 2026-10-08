import { describe, expect, it } from "vitest";
import { channelIdsSchema } from "../../../src/domain/channels.ts";

describe("channelIdsSchema", () => {
  it("accepts the fields of each key and any part of them", () => {
    expect(
      channelIdsSchema.meta.parse({ page_id: "1", ig_user_id: "2", graph_version: "v23.0" }),
    ).toEqual({ page_id: "1", ig_user_id: "2", graph_version: "v23.0" });
    expect(channelIdsSchema.x.parse({ read_allowance: 0, metrics_days: [] })).toEqual({
      read_allowance: 0,
      metrics_days: [],
    });
    expect(channelIdsSchema.linkedin.parse({ multi_image: false })).toEqual({ multi_image: false });
  });

  it("refuses a field it does not name, a token above all", () => {
    expect(channelIdsSchema.meta.safeParse({ page_id: "1", page_token: "secret" }).success).toBe(
      false,
    );
    expect(channelIdsSchema.x.safeParse({ access_token: "secret" }).success).toBe(false);
    expect(channelIdsSchema.linkedin.safeParse({ refresh_token: "secret" }).success).toBe(false);
  });

  it("refuses an id that is not in the shape the platform uses", () => {
    expect(channelIdsSchema.meta.safeParse({ graph_version: "23" }).success).toBe(false);
    expect(channelIdsSchema.x.safeParse({ handle: "@brand" }).success).toBe(false);
    expect(channelIdsSchema.linkedin.safeParse({ organization_urn: "12345" }).success).toBe(false);
  });
});
