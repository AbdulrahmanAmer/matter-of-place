import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AdminApiError,
  adminFetch,
  bindAdminFetch,
  isUnavailable,
  uploadSigned,
} from "./admin-fetch";

const fetchMock = vi.fn<typeof fetch>();
const navigate = vi.fn<(to: string) => void>();
let queryClient: QueryClient;

const ok = (body: unknown = { ok: true }) => Response.json(body);
const failed = (status: number, code: string, requestId = "req-1") =>
  Response.json({ error: { code, message: `${code} message`, requestId } }, { status });
const headersOf = (call: number) => new Headers(fetchMock.mock.calls[call]?.[1]?.headers);
const urlOf = (call: number) => {
  const input = fetchMock.mock.calls[call]?.[0];
  return typeof input === "string" ? input : "";
};
const anything = z.unknown();

beforeEach(() => {
  fetchMock.mockReset();
  navigate.mockReset();
  queryClient = new QueryClient();
  bindAdminFetch({ queryClient, currentPath: () => "/admin/requests?state=new", navigate });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("document", { cookie: "theme=dark; mop_csrf=token-123" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("adminFetch", () => {
  it("a POST carries X-MOP-CSRF equal to the mop_csrf cookie", async () => {
    fetchMock.mockResolvedValueOnce(ok());
    await adminFetch("/api/admin/x", anything, { method: "POST", body: "{}" });
    expect(headersOf(0).get("X-MOP-CSRF")).toBe("token-123");
  });

  it("every write method carries the header and a GET carries none", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ok()));
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      await adminFetch("/api/admin/x", anything, { method });
    }
    await adminFetch("/api/admin/x", anything);
    expect([0, 1, 2].map((call) => headersOf(call).get("X-MOP-CSRF"))).toEqual([
      "token-123",
      "token-123",
      "token-123",
    ]);
    expect(headersOf(3).has("X-MOP-CSRF")).toBe(false);
  });

  it("a 401 that ends the session empties the admin queries and goes to sign-in", async () => {
    for (const code of ["reauth_required", "session_expired"]) {
      navigate.mockClear();
      queryClient.setQueryData(["admin", "requests"], [1]);
      queryClient.setQueryData(["public", "catalog"], [2]);
      fetchMock.mockResolvedValueOnce(failed(401, code));
      await expect(adminFetch("/api/admin/x", anything)).rejects.toMatchObject({ code });
      expect(queryClient.getQueryData(["admin", "requests"])).toBeUndefined();
      expect(queryClient.getQueryData(["public", "catalog"])).toEqual([2]);
      expect(navigate).toHaveBeenCalledExactlyOnceWith(
        "/admin/sign-in?next=%2Fadmin%2Frequests%3Fstate%3Dnew",
      );
    }
  });

  it("a plain 401 is thrown and leaves the page where it is", async () => {
    fetchMock.mockResolvedValueOnce(failed(401, "unauthorized"));
    await expect(adminFetch("/api/admin/me", anything)).rejects.toMatchObject({ status: 401 });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("a 403 csrf makes one me call and one retry", async () => {
    fetchMock
      .mockResolvedValueOnce(failed(403, "csrf"))
      .mockResolvedValueOnce(ok({ actor: {} }))
      .mockResolvedValueOnce(ok({ saved: true }));
    const result = await adminFetch("/api/admin/x", anything, { method: "POST" });
    expect(result).toEqual({ saved: true });
    expect([0, 1, 2].map(urlOf)).toEqual(["/api/admin/x", "/api/admin/me", "/api/admin/x"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("a second 403 csrf is thrown, not retried again", async () => {
    fetchMock
      .mockResolvedValueOnce(failed(403, "csrf"))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(failed(403, "csrf"));
    await expect(adminFetch("/api/admin/x", anything, { method: "POST" })).rejects.toMatchObject({
      code: "csrf",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("a 403 for another reason is thrown at once", async () => {
    fetchMock.mockResolvedValueOnce(failed(403, "out_of_scope"));
    await expect(adminFetch("/api/admin/x", anything)).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a 503 raises the banner flag without leaving the page, and an answer clears it", async () => {
    fetchMock.mockResolvedValueOnce(failed(503, "auth_unavailable"));
    await expect(adminFetch("/api/admin/x", anything)).rejects.toMatchObject({ status: 503 });
    expect(isUnavailable()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(ok());
    await adminFetch("/api/admin/x", anything);
    expect(isUnavailable()).toBe(false);
  });

  it("an error body becomes an AdminApiError with its code and request id", async () => {
    fetchMock.mockResolvedValueOnce(failed(422, "invalid", "req-77"));
    const error = await adminFetch("/api/admin/x", anything).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AdminApiError);
    expect(error).toMatchObject({ status: 422, code: "invalid", requestId: "req-77" });
  });

  it("an answer that is not an error body still fails with the header's request id", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>", { status: 502, headers: { "x-request-id": "req-edge" } }),
    );
    await expect(adminFetch("/api/admin/x", anything)).rejects.toMatchObject({
      status: 502,
      requestId: "req-edge",
    });
  });

  it("the answer is parsed with the schema the caller gave", async () => {
    fetchMock.mockResolvedValueOnce(ok({ count: "three" }));
    await expect(adminFetch("/api/admin/x", z.object({ count: z.number() }))).rejects.toThrow(
      z.ZodError,
    );
  });

  it("an empty 204 answer parses as undefined", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(
      adminFetch("/api/admin/x", z.undefined(), { method: "DELETE" }),
    ).resolves.toBeUndefined();
  });
});

describe("uploadSigned", () => {
  it("puts the file with no cookie and no CSRF header", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await uploadSigned(
      "https://storage.example/upload?token=t",
      new Blob(["x"], { type: "image/jpeg" }),
    );
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("PUT");
    expect(init?.credentials).toBeUndefined();
    expect(new Headers(init?.headers).has("X-MOP-CSRF")).toBe(false);
  });

  it("a refused upload throws", async () => {
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 403 }));
    await expect(uploadSigned("https://storage.example/u", new Blob(["x"]))).rejects.toMatchObject({
      code: "upload_failed",
    });
  });
});
