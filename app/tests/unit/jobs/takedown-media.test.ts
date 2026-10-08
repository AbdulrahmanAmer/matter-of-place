// B8 step 10a (E2E-01, ruling H33 (6)): the takedown_media system job. A fake media store takes the delete, a stand-in
// for Cloudflare's API answers the purge, and a fake client answers the two RPCs.
import "../../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Json } from "../../../src/db";
import { getSystemJob } from "../../../src/server/jobs/system/index";
import { takedownMedia } from "../../../src/server/jobs/system/takedown-media";
import { NonRetryableError } from "../../../src/server/jobs/types";
import { storageUnavailable } from "../../../src/server/lib/media-store";
import { context, MEDIA_BASE, NOW, PROPERTY_ID } from "../../fixtures/asset-rows";
import { fakeDb } from "../../fixtures/fake-db";

const store = vi.hoisted(() => ({
  deleteObjects: vi.fn((_bucket: string, keys: string[]) =>
    Promise.resolve({ deleted: keys.length }),
  ),
}));

vi.mock(import("../../../src/server/lib/media-store"), async (importOriginal) => ({
  ...(await importOriginal()),
  deleteObjects: store.deleteObjects,
}));

const filesBody = z.object({ files: z.array(z.string()) });

/** Cloudflare's purge API: records the files of each call and answers success. */
function cloudflare(): string[][] {
  const calls: string[][] = [];
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    calls.push(filesBody.parse(JSON.parse(typeof init.body === "string" ? init.body : "")).files);
    return Promise.resolve(Response.json({ success: true, errors: [] }));
  });
  return calls;
}

function jobDb(keys: string[]) {
  return fakeDb({
    rpc: {
      takedown_media_keys: () => keys,
      takedown_mark_posts: () => 2,
    },
  });
}

const data = { property_id: PROPERTY_ID };
const KEYS = ["o/oak-hill/0-aaaaaaaa.webp", "v/oak-hill/0-aaaaaaaa/og.jpg", "og/oak-hill.jpg"];
const DELETED: Json = { deleted_at: NOW.toISOString(), deleted: 3 };
const marks = (calls: { name: string }[]) =>
  calls.filter((call) => call.name === "takedown_mark_posts").length;

beforeEach(() => {
  store.deleteObjects.mockClear();
  vi.stubEnv("MEDIA_PUBLIC_BASE", MEDIA_BASE);
  vi.stubEnv("CF_PURGE_TOKEN", "token-abc");
  vi.stubEnv("CF_ZONE_ID", "zone-123");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("takedown_media", () => {
  it("is registered as a system job with 12 attempts", () => {
    expect({
      registered: getSystemJob("takedown_media") === takedownMedia,
      attempts: takedownMedia.maxAttempts,
    }).toEqual({ registered: true, attempts: 12 });
  });

  it("removes every key once from the bucket media, then comes back at once to purge", async () => {
    const purges = cloudflare();
    const db = jobDb(KEYS);
    const outcome = await takedownMedia.run(context(db, "takedown_media"), {}, data);
    expect({
      outcome,
      deletes: store.deleteObjects.mock.calls,
      purges,
      marks: marks(db.calls),
    }).toEqual({
      outcome: { status: "retry_at", at: NOW, reason: "takedown_purge", result: DELETED },
      deletes: [["media", KEYS]],
      purges: [],
      marks: 0,
    });
  });

  it("takedown_media runs twice without a second outside effect", async () => {
    const purges = cloudflare();
    const db = jobDb(KEYS);
    await takedownMedia.run(context(db, "takedown_media"), {}, data);
    const second = await takedownMedia.run(
      context(db, "takedown_media", { result: DELETED }),
      {},
      data,
    );
    expect({
      second,
      deletes: store.deleteObjects.mock.calls.length,
      purges,
      marks: marks(db.calls),
    }).toEqual({
      second: {
        status: "done",
        result: { ...DELETED, purged: 3, posts_marked: 2 },
      },
      deletes: 1,
      purges: [KEYS.map((key) => `${MEDIA_BASE}/${key}`)],
      marks: 1,
    });
  });

  it("throws storage_unavailable from the media store unchanged, so the runner waits an hour", async () => {
    const error = storageUnavailable();
    store.deleteObjects.mockRejectedValueOnce(error);
    await expect(takedownMedia.run(context(jobDb(KEYS), "takedown_media"), {}, data)).rejects.toBe(
      error,
    );
  });

  it("purges nothing without MEDIA_PUBLIC_BASE and records why", async () => {
    vi.stubEnv("MEDIA_PUBLIC_BASE", undefined);
    const purges = cloudflare();
    const outcome = await takedownMedia.run(
      context(jobDb(KEYS), "takedown_media", { result: DELETED }),
      {},
      data,
    );
    expect({ outcome, purges }).toEqual({
      outcome: {
        status: "done",
        result: { ...DELETED, purged: 0, purge_skipped: "no_media_public_base", posts_marked: 2 },
      },
      purges: [],
    });
  });

  it("purges 31 addresses in two calls of at most 30", async () => {
    const purges = cloudflare();
    const keys = Array.from({ length: 31 }, (_, n) => `og/p-${String(n)}.jpg`);
    const outcome = await takedownMedia.run(
      context(jobDb(keys), "takedown_media", { result: DELETED }),
      {},
      data,
    );
    expect({ outcome, sizes: purges.map((files) => files.length) }).toEqual({
      outcome: { status: "done", result: { ...DELETED, purged: 31, posts_marked: 2 } },
      sizes: [30, 1],
    });
  });

  it("refuses a payload without a property id for good", async () => {
    await expect(
      takedownMedia.run(context(jobDb(KEYS), "takedown_media"), {}, {}),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});
