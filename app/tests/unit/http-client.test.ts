import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { receiptSchema } from "../../src/domain/contracts";
import { marketSchema } from "../../src/domain/market";
import { propertySchema } from "../../src/domain/property";
import { storySchema } from "../../src/domain/story";
import { markets } from "../../src/data/markets";
import { properties } from "../../src/data/properties";
import { stories } from "../../src/data/stories";
import { createApiClient } from "../../src/services/http/client";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("response schemas", () => {
  it("keep every field of the bundled catalog", () => {
    for (const property of properties) expect(propertySchema.parse(property)).toEqual(property);
    for (const market of markets) expect(marketSchema.parse(market)).toEqual(market);
    for (const story of stories) expect(storySchema.parse(story)).toEqual(story);
  });

  it("refuse a body of the wrong shape", () => {
    const [property] = properties;
    expect(() => propertySchema.parse({ ...property, price: "free" })).toThrow(ZodError);
    expect(() => receiptSchema.parse({ id: "r1" })).toThrow(ZodError);
  });
});

describe("api client", () => {
  const stubFetch = (response: Response) =>
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

  it("returns the parsed body when it matches the schema", async () => {
    stubFetch(Response.json({ id: "r1", receivedAt: "2026-10-02T00:00:00Z", extra: true }));
    const receipt = await createApiClient("/api").post("/inquiries", {}, receiptSchema);
    expect(receipt).toEqual({ id: "r1", receivedAt: "2026-10-02T00:00:00Z" });
  });

  it("rejects a body that does not match the schema", async () => {
    stubFetch(Response.json({ id: 7 }));
    await expect(createApiClient("/api").get("/inquiries", receiptSchema)).rejects.toThrow(
      ZodError,
    );
  });

  it("maps a missing record to a not-found service error", async () => {
    stubFetch(new Response(null, { status: 404, statusText: "Not Found" }));
    await expect(
      createApiClient("/api").get("/properties/x", propertySchema),
    ).rejects.toMatchObject({
      kind: "not-found",
      status: 404,
    });
  });
});
