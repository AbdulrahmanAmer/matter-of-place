// B9 step 6: the content-hashed media key and the Storage client that stores each key once (F24, H33).
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hash8, mediaKey } from "../../../scripts/lib/media-key.mjs";
import { getObject, putIfMissing } from "../../../scripts/lib/media-store.mjs";

const BASE = "https://project.supabase.co";
const IMMUTABLE = "public, max-age=31536000, immutable";
const bytes = new TextEncoder().encode("a rendered file");
const file = { propertyId: "p1", kind: "cover", revision: 2, name: "cover", bytes };

interface Call {
  url: string;
  init: RequestInit;
}

/** Replaces `fetch` with a fake that answers in order (the last answer repeats) and records every call. */
function stubFetch(...answers: (Response | Error)[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const answer = answers[Math.min(calls.length, answers.length) - 1];
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer ?? new Response("{}"));
  });
  return calls;
}

function headersOf(call: Call | undefined): Headers {
  return new Headers(call?.init.headers);
}

const duplicate = () =>
  new Response('{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}', {
    status: 400,
  });

beforeEach(() => {
  // One database (G-901): the helper reads the stubbed generic names only behind E2E_STACK and without a dev profile.
  vi.stubEnv("E2E_STACK", "1");
  vi.stubEnv("DEV_SUPABASE_PROJECT_REF", "");
  vi.stubEnv("DEV_SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("SUPABASE_URL", BASE);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("mediaKey", () => {
  it("builds assets/<property>/<kind>/r<revision>/<name>.<hash8>.<ext>", () => {
    expect(mediaKey(file)).toMatch(/^assets\/p1\/cover\/r2\/cover\.[0-9a-f]{8}\.png$/);
  });

  it("takes hash8 from the first 8 hex digits of the SHA-256 of the bytes", () => {
    const expected = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
    expect(hash8(bytes)).toBe(expected);
    expect(mediaKey(file)).toContain(`.${expected}.`);
  });

  it("gives the same key for the same bytes and another key for other bytes", () => {
    const other = new TextEncoder().encode("a rendered file, changed");
    expect(mediaKey({ ...file, bytes: new Uint8Array(bytes) })).toBe(mediaKey(file));
    expect(mediaKey({ ...file, bytes: other })).not.toBe(mediaKey(file));
  });

  it('with ext "jpg" gives cover.<hash8>.jpg', () => {
    expect(mediaKey({ ...file, ext: "jpg" })).toMatch(/\/cover\.[0-9a-f]{8}\.jpg$/);
  });

  it('with ext "mp4" gives reel.<hash8>.mp4', () => {
    expect(mediaKey({ ...file, kind: "reel", name: "reel", ext: "mp4" })).toMatch(
      /^assets\/p1\/reel\/r2\/reel\.[0-9a-f]{8}\.mp4$/,
    );
  });
});

describe("putIfMissing", () => {
  it("makes one POST with the bearer, x-upsert false and the immutable header", async () => {
    const calls = stubFetch(new Response("{}"));
    await putIfMissing("media", "assets/p1/cover/r2/cover.0a1b2c3d.jpg", bytes, "image/jpeg");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      `${BASE}/storage/v1/object/media/assets/p1/cover/r2/cover.0a1b2c3d.jpg`,
    );
    expect(calls[0]?.init.method).toBe("POST");
    const headers = headersOf(calls[0]);
    expect(headers.get("authorization")).toBe("Bearer service-key");
    expect(headers.get("x-upsert")).toBe("false");
    expect(headers.get("cache-control")).toBe(IMMUTABLE);
    expect(headers.get("content-type")).toBe("image/jpeg");
  });

  it("sets the immutable header for the media bucket only", async () => {
    const calls = stubFetch(new Response("{}"));
    await putIfMissing("documents", "d/one.pdf", bytes, "application/pdf");
    expect(headersOf(calls[0]).get("cache-control")).toBeNull();
  });

  it("counts a 409 Duplicate answer as done, with no second call", async () => {
    const calls = stubFetch(duplicate());
    await expect(putIfMissing("media", "k/a.jpg", bytes, "image/jpeg")).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("counts an HTTP 409 as done, with no second call", async () => {
    const calls = stubFetch(new Response("Duplicate", { status: 409 }));
    await expect(putIfMissing("media", "k/a.jpg", bytes, "image/jpeg")).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("throws storage_unavailable on a 503 and on a network error", async () => {
    stubFetch(new Response("down", { status: 503 }));
    await expect(putIfMissing("media", "k/a.jpg", bytes, "image/jpeg")).rejects.toThrow(
      "storage_unavailable",
    );
    stubFetch(new TypeError("fetch failed"));
    await expect(putIfMissing("media", "k/a.jpg", bytes, "image/jpeg")).rejects.toThrow(
      "storage_unavailable",
    );
  });

  it("throws naming the status and the key on any other refusal", async () => {
    stubFetch(new Response('{"statusCode":"403"}', { status: 403 }));
    await expect(putIfMissing("media", "k/a.jpg", bytes, "image/jpeg")).rejects.toThrow(
      "media/k/a.jpg answered 403",
    );
  });

  it("throws naming SUPABASE_URL when it is missing", async () => {
    stubFetch(new Response("{}"));
    vi.stubEnv("SUPABASE_URL", "");
    await expect(putIfMissing("media", "k/a.jpg", bytes, "image/jpeg")).rejects.toThrow(
      "SUPABASE_URL",
    );
  });

  it("sends no request to a host other than SUPABASE_URL", async () => {
    const calls = stubFetch(new Response("{}"));
    await putIfMissing("media", "k/a.jpg", bytes, "image/jpeg");
    await putIfMissing("documents", "d/one.pdf", bytes, "application/pdf");
    await getObject("media", "k/a.jpg");
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((call) => new URL(call.url).host))).toEqual(
      new Set(["project.supabase.co"]),
    );
  });
});

describe("getObject", () => {
  it("reads the bytes with the bearer", async () => {
    const calls = stubFetch(new Response(bytes));
    expect(await getObject("media", "k/a.jpg")).toEqual(bytes);
    expect(calls[0]?.url).toBe(`${BASE}/storage/v1/object/media/k/a.jpg`);
    expect(headersOf(calls[0]).get("authorization")).toBe("Bearer service-key");
  });

  it("throws naming the status and the key when the object is missing", async () => {
    stubFetch(new Response("{}", { status: 404 }));
    await expect(getObject("media", "k/a.jpg")).rejects.toThrow("media/k/a.jpg answered 404");
  });
});
