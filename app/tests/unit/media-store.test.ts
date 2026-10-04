import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Bucket } from "../../src/server/lib/media-store";

// A fresh module per test: the once-per-isolate warning lives in module state.
async function load() {
  vi.resetModules();
  return import("../../src/server/lib/media-store");
}

interface Sent {
  url: string;
  init: RequestInit & { cf?: unknown };
}

function stubFetch(answer: (sent: Sent) => Response | Promise<Response>) {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    const request = { url, init };
    sent.push(request);
    return Promise.resolve(answer(request));
  });
  return sent;
}

const keys = (count: number) =>
  Array.from({ length: count }, (_value, index) => `k/${String(index)}`);
const only = (sent: Sent[]): Sent => {
  const [first] = sent;
  if (first === undefined) throw new Error("no request was sent");
  return first;
};
const bodyOf = (sent: Sent): { prefixes: string[] } => {
  const body = sent.init.body;
  if (typeof body !== "string") throw new Error("the request has no JSON body");
  return z.object({ prefixes: z.array(z.string()) }).parse(JSON.parse(body));
};

beforeEach(() => {
  vi.stubEnv("MEDIA_PUBLIC_BASE", undefined);
  vi.stubEnv("SUPABASE_URL", "https://proj.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mediaUrl", () => {
  it("answers the relative /media address without absolute, whatever MEDIA_PUBLIC_BASE says", async () => {
    vi.stubEnv("MEDIA_PUBLIC_BASE", "https://matterofplace.com/media");
    const { mediaUrl } = await load();
    expect(mediaUrl("p/a/hero.webp")).toBe("/media/p/a/hero.webp");
  });

  it("prefixes MEDIA_PUBLIC_BASE when absolute is asked for", async () => {
    vi.stubEnv("MEDIA_PUBLIC_BASE", "https://matterofplace.com/media/");
    const { mediaUrl } = await load();
    expect(mediaUrl("og/a.jpg", { absolute: true })).toBe(
      "https://matterofplace.com/media/og/a.jpg",
    );
  });

  it("falls back to the relative address and warns once when MEDIA_PUBLIC_BASE is unset", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { mediaUrl } = await load();
    expect(mediaUrl("og/a.jpg", { absolute: true })).toBe("/media/og/a.jpg");
    expect(mediaUrl("og/b.jpg", { absolute: true })).toBe("/media/og/b.jpg");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("media_public_base_unset");
  });
});

describe("storageUnavailable", () => {
  it("is the 503 storage_unavailable AppError", async () => {
    const { storageUnavailable } = await load();
    expect(storageUnavailable()).toMatchObject({ code: "storage_unavailable", status: 503 });
  });
});

describe("readPublicObject", () => {
  it("fetches the public object of the media bucket with edge caching on", async () => {
    const sent = stubFetch(() => new Response("bytes"));
    const { readPublicObject } = await load();
    const response = await readPublicObject("p/a/hero.webp");
    expect(await response.text()).toBe("bytes");
    expect(only(sent).url).toBe(
      "https://proj.supabase.co/storage/v1/object/public/media/p/a/hero.webp",
    );
    expect(only(sent).init.cf).toEqual({ cacheEverything: true });
  });

  it("sets no abort signal, so a slow stream of a large file is never cut off", async () => {
    const sent = stubFetch(() => new Response("bytes"));
    const { readPublicObject } = await load();
    await readPublicObject("p/a/clip.mp4");
    expect(only(sent).init.signal).toBeUndefined();
  });

  it("hands a Storage 404 back to the caller untouched", async () => {
    stubFetch(() => new Response("missing", { status: 404 }));
    const { readPublicObject } = await load();
    expect((await readPublicObject("p/none.webp")).status).toBe(404);
  });

  it("throws storage_unavailable when the network fails", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    const { readPublicObject } = await load();
    await expect(readPublicObject("p/a.webp")).rejects.toMatchObject({
      code: "storage_unavailable",
    });
  });
});

describe("deleteObjects", () => {
  const answerWithLength = (sent: Sent) => Response.json(bodyOf(sent).prefixes.map(String));
  const media: Bucket = "media";

  it("splits 2,500 keys into three requests of at most 1,000 and sums what was deleted", async () => {
    const sent = stubFetch(answerWithLength);
    const { deleteObjects } = await load();
    expect(await deleteObjects(media, keys(2500))).toEqual({ deleted: 2500 });
    expect(sent.map((request) => bodyOf(request).prefixes.length)).toEqual([1000, 1000, 500]);
  });

  it("sends a DELETE to the bucket with the service key", async () => {
    const sent = stubFetch(answerWithLength);
    const { deleteObjects } = await load();
    await deleteObjects("documents", ["a.pdf"]);
    expect(only(sent).url).toBe("https://proj.supabase.co/storage/v1/object/documents");
    expect(only(sent).init.method).toBe("DELETE");
    expect(only(sent).init.headers).toMatchObject({
      authorization: "Bearer service-key",
      apikey: "service-key",
    });
    expect(bodyOf(only(sent))).toEqual({ prefixes: ["a.pdf"] });
  });

  it("sends nothing for no keys", async () => {
    const sent = stubFetch(answerWithLength);
    const { deleteObjects } = await load();
    expect(await deleteObjects(media, [])).toEqual({ deleted: 0 });
    expect(sent).toHaveLength(0);
  });

  it("counts what Storage answers, not what was asked", async () => {
    stubFetch(() => Response.json([{ name: "k/0" }]));
    const { deleteObjects } = await load();
    expect(await deleteObjects(media, keys(3))).toEqual({ deleted: 1 });
  });

  it("throws storage_unavailable on a 500 answer", async () => {
    stubFetch(() => Response.json([{ name: "k/0" }], { status: 500 }));
    const { deleteObjects } = await load();
    await expect(deleteObjects(media, keys(2))).rejects.toMatchObject({
      code: "storage_unavailable",
      status: 503,
    });
  });

  it("throws storage_unavailable on a network error", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    const { deleteObjects } = await load();
    await expect(deleteObjects(media, keys(2))).rejects.toMatchObject({
      code: "storage_unavailable",
    });
  });
});
