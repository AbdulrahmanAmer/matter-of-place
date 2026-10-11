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

  // Panel finding 3: the fields a 422 names reach the form instead of being dropped with the body.
  it("carries the refused fields of a 422 and the request id", async () => {
    const issues = [
      { code: "invalid_string", path: ["submitterEmail"], message: "Invalid email" },
      { code: "invalid_literal", path: ["rightsConfirmed"], message: "Invalid", received: false },
    ];
    stubFetch(
      Response.json(
        { error: { code: "validation", message: "Some", issues, requestId: "req-1" } },
        { status: 422, statusText: "Unprocessable Entity" },
      ),
    );
    await expect(
      createApiClient("/api").post("/submissions", {}, receiptSchema),
    ).rejects.toMatchObject({
      kind: "validation",
      status: 422,
      requestId: "req-1",
      issues,
    });
  });

  it("keeps the issues it can read and drops one of an unexpected shape", async () => {
    const good = { code: "custom", path: ["brokerage"], message: "Name your brokerage" };
    stubFetch(
      Response.json(
        { error: { issues: [good, { path: "brokerage" }, "text"] } },
        { status: 422, statusText: "Unprocessable Entity" },
      ),
    );
    await expect(
      createApiClient("/api").post("/submissions", {}, receiptSchema),
    ).rejects.toMatchObject({
      issues: [good],
    });
  });

  it("gives no issues for an answer that is not JSON", async () => {
    stubFetch(new Response("<html>", { status: 400, statusText: "Bad Request" }));
    await expect(
      createApiClient("/api").post("/submissions", {}, receiptSchema),
    ).rejects.toMatchObject({
      kind: "validation",
      issues: [],
    });
  });
});
