import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fromRpcError } from "../../src/server/lib/admin-errors";
import { AppError } from "../../src/server/lib/errors";

// API-03: one case per branch of `fromRpcError`, in its order.
const answer = (error: unknown) => {
  const mapped = fromRpcError(error);
  return { code: mapped.code, status: mapped.status };
};

const pg = (code: string, message = "some database text") => ({
  code,
  message,
  details: null,
  hint: null,
});

describe("fromRpcError", () => {
  it("answers a raised code with that code and its own status", () => {
    expect(answer(pg("P0001", "wrong_state"))).toEqual({ code: "wrong_state", status: 409 });
    expect(answer(pg("42501", "human_only"))).toEqual({ code: "human_only", status: 403 });
  });

  it("carries the raise's detail as the message, for publish_incomplete's empty fields", () => {
    const mapped = fromRpcError({
      code: "23514",
      message: "publish_incomplete",
      details: "hero_image, place",
    });
    expect({ code: mapped.code, message: mapped.message }).toEqual({
      code: "publish_incomplete",
      message: "hero_image, place",
    });
  });

  it("answers B2's version_conflict as 409 stale and slug_immutable as 422 slug_locked", () => {
    expect(answer(pg("40001", "version_conflict"))).toEqual({ code: "stale", status: 409 });
    expect(answer(pg("P0001", "slug_immutable"))).toEqual({ code: "slug_locked", status: 422 });
  });

  it.each([
    ["P0002", "not_found", 404],
    ["23505", "already_exists", 409],
    ["23503", "validation", 422],
    ["23514", "validation", 422],
    ["23502", "validation", 422],
    ["22P02", "validation", 422],
    ["22023", "validation", 422],
    ["42501", "forbidden", 403],
    ["55P03", "unavailable", 503],
    ["57014", "unavailable", 503],
  ])("maps SQLSTATE %s to %s %i", (sqlstate, code, status) => {
    expect(answer(pg(sqlstate))).toEqual({ code, status });
  });

  it.each(["PGRST000", "PGRST001", "PGRST002", "PGRST003"])(
    "answers PostgREST %s with 503",
    (code) => {
      expect(answer(pg(code, "Could not connect"))).toEqual({ code: "unavailable", status: 503 });
    },
  );

  it("answers a thrown fetch TypeError and an AbortError with 503", () => {
    expect(answer(new TypeError("fetch failed"))).toEqual({ code: "unavailable", status: 503 });
    expect(answer(new DOMException("The operation was aborted.", "AbortError"))).toEqual({
      code: "unavailable",
      status: 503,
    });
  });

  it("answers a supabase-js rpc whose fetch rejected with 503 unavailable", async () => {
    const rejected: typeof fetch = Object.assign(
      () => Promise.reject(new TypeError("fetch failed")),
      {
        preconnect: () => undefined,
      },
    );
    const db = createClient("http://127.0.0.1:9", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: rejected },
    });
    const { error } = await db.rpc("public_state");
    expect(answer(error)).toEqual({ code: "unavailable", status: 503 });
  });

  it("answers anything else with 500 server", () => {
    expect(answer(pg("XX000", "internal error"))).toEqual({ code: "server", status: 500 });
    expect(answer(new Error("boom"))).toEqual({ code: "server", status: 500 });
    expect(answer("a string")).toEqual({ code: "server", status: 500 });
  });

  it("passes an AppError through and makes a ZodError 500 server", () => {
    const own = new AppError("csrf", undefined, "x");
    expect(fromRpcError(own)).toBe(own);
    const zod = z.object({ id: z.string().uuid() }).safeParse({ id: "x" });
    expect(zod.success ? null : answer(zod.error)).toEqual({ code: "server", status: 500 });
  });
});
