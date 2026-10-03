import { describe, expect, it } from "vitest";
import { z } from "zod";
import { errorCodes } from "../../src/server/lib/error-codes";
import { AppError, fromZod, toErrorResponse } from "../../src/server/lib/errors";

describe("AppError", () => {
  it("takes its status from the code when none is given", () => {
    expect(new AppError("rate_limited", undefined, "Slow down.").status).toBe(
      errorCodes.rate_limited,
    );
  });

  it("keeps a status that is given", () => {
    expect(new AppError("unavailable", 502, "Away.").status).toBe(502);
  });
});

describe("fromZod", () => {
  it("makes a 422 validation error that carries the issues", () => {
    const parsed = z.object({ email: z.string().email() }).safeParse({ email: "no" });
    if (parsed.success) throw new Error("the schema should have refused the value");
    const error = fromZod(parsed.error);
    expect(error.code).toBe("validation");
    expect(error.status).toBe(422);
    expect(error.issues?.[0]?.path).toEqual(["email"]);
  });
});

describe("toErrorResponse", () => {
  it("answers an AppError with its status, the R09 body and the request id", async () => {
    const response = toErrorResponse(new AppError("not_found", undefined, "Nothing here."), "r-1");
    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe("r-1");
    expect(await response.json()).toEqual({
      error: { code: "not_found", message: "Nothing here.", requestId: "r-1" },
    });
  });

  it("is never stored", () => {
    const response = toErrorResponse(new AppError("server", undefined, "No."), "r-2");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("tells the client when to retry a 503 and no other status", () => {
    const outage = toErrorResponse(new AppError("storage_unavailable", undefined, "Away."), "r-5");
    const missing = toErrorResponse(new AppError("not_found", undefined, "None."), "r-6");
    expect(outage.status).toBe(503);
    expect(outage.headers.get("retry-after")).toBe("30");
    expect(missing.headers.get("retry-after")).toBeNull();
  });

  it("includes the issues of a validation error", async () => {
    const parsed = z.object({ name: z.string() }).safeParse({});
    if (parsed.success) throw new Error("the schema should have refused the value");
    const body: unknown = await toErrorResponse(fromZod(parsed.error), "r-3").json();
    expect(body).toMatchObject({ error: { code: "validation", issues: [{ path: ["name"] }] } });
  });

  it("keeps the message of any other error inside the Worker", async () => {
    const response = toErrorResponse(new Error("password=hunter2"), "r-4");
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("hunter2");
  });
});
