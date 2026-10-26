// The upload reconcile of E2E-02 over a fake database and a fake Storage bucket: what the first bytes announce decides
// whether a photograph is kept and marked, removed, or still awaited.
import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../../src/server/lib/crypto";
import { reconcileUploads, sniffImageType } from "../../src/server/submissions/reconcile";
import { fakeDb } from "../fixtures/fake-db";

const NOW = Date.parse("2026-10-04T12:00:00Z");
const MINUTE = 60_000;
const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));
const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((part) => (typeof part === "string" ? ascii(part) : part)));

const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10], "JFIF", [0, 1]);
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBP = bytes("RIFF", [0x24, 0, 0, 0], "WEBP");
const heic = (brand: string) => bytes([0, 0, 0, 0x18], "ftyp", brand);
// What Storage answers for a path with no object (measured on mop-dev in B3 step 8).
const NOT_FOUND = {
  name: "StorageApiError",
  message: "Object not found",
  status: 400,
  statusCode: "404",
  code: "NoSuchKey",
};

describe("sniffImageType", () => {
  it("names each of the four types by its signature", () => {
    expect([JPEG, PNG, WEBP, heic("heic")].map(sniffImageType)).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
    ]);
  });

  it("reads every HEIC brand of GQ-07 as image/heic", () => {
    expect(
      ["heic", "heix", "mif1", "heim", "msf1"].map((brand) => sniffImageType(heic(brand))),
    ).toEqual(Array.from({ length: 5 }, () => "image/heic"));
  });

  it("answers null for any other bytes", () => {
    expect(
      [bytes("GIF89a"), bytes(), heic("avif"), bytes("RIFF", [0, 0, 0, 0], "WAVE")].map(
        sniffImageType,
      ),
    ).toEqual([null, null, null, null]);
  });
});

const row = (id: string, path: string, minutesAgo: number) => ({
  id,
  submission_id: "s1",
  name: path,
  bytes: 10,
  storage_path: path,
  sort_order: 0,
  uploaded_at: null,
  mime: null,
  sha256: null,
  source_url: null,
  declared_at: new Date(NOW - minutesAgo * MINUTE).toISOString(),
});

function setup(download: (path: string) => unknown) {
  const marked: unknown[] = [];
  const removed: unknown[] = [];
  const rows = [
    row("png-as-jpg", "s1/png-as-jpg.jpg", 30),
    row("good", "s1/good.jpg", 30),
    row("waiting", "s1/waiting.jpg", 30),
    row("late", "s1/late.jpg", 180),
  ];
  const db = fakeDb({
    tables: { submission_media: rows },
    rpc: {
      mark_media_uploaded: (args) => {
        marked.push(args);
        return true;
      },
    },
    storage: {
      submissions: {
        download: (path: unknown) => Promise.resolve(download(String(path))),
        remove: (paths: unknown) => {
          removed.push(paths);
          return Promise.resolve({ data: [], error: null });
        },
      },
    },
  });
  return { db, marked, removed };
}

const objects: Record<string, Uint8Array<ArrayBuffer>> = {
  "s1/png-as-jpg.jpg": PNG,
  "s1/good.jpg": JPEG,
};
const fromBucket = (path: string) => {
  const found = objects[path];
  return found === undefined
    ? { data: null, error: NOT_FOUND }
    : { data: new Blob([found]), error: null };
};

describe("reconcileUploads", () => {
  it("marks a good JPEG, removes PNG bytes under a .jpg name, waits for a fresh row and counts a late one missing", async () => {
    const { db, marked, removed } = setup(fromBucket);
    const counts = await reconcileUploads(db, new Date(NOW), NOW);
    expect(counts).toEqual({ checked: 4, uploaded: 1, deleted: 1, missing: 1, deferred: 0 });
    expect(marked).toEqual([
      { p_media_id: "good", p_mime: "image/jpeg", p_sha256: await sha256Hex(JPEG) },
    ]);
    expect(removed).toEqual([["s1/png-as-jpg.jpg"]]);
  });

  it("throws on a download error other than not-found", async () => {
    const { db } = setup(() => ({
      data: null,
      error: { message: "Bad gateway", status: 502, code: "InternalError" },
    }));
    await expect(reconcileUploads(db, new Date(NOW), NOW)).rejects.toMatchObject({
      code: "storage_unavailable",
    });
  });
});

// The 15-minute job died with step_timeout on mop-dev from 2026-10-06 (113 dead rows): it read each waiting row's
// object one after the other, about 0.17 s apiece, so 222 waiting rows took longer than the job's 40 seconds.
describe("reconcileUploads under load", () => {
  /** `count` waiting rows, row 0 the newest, all inside the upload window, each answered by `download`. */
  function crowded(count: number, download: (path: string) => unknown) {
    const rows = Array.from({ length: count }, (_unused, index) =>
      row(`r${String(index)}`, `s1/r${String(index)}.jpg`, 10 + index),
    );
    const db = fakeDb({
      tables: { submission_media: rows },
      storage: {
        submissions: { download: (path: unknown) => Promise.resolve(download(String(path))) },
      },
    });
    return db;
  }

  it("reads waiting objects eight at a time, not one after the other", async () => {
    let inFlight = 0;
    let peak = 0;
    const db = crowded(40, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      return { data: null, error: NOT_FOUND };
    });
    const counts = await reconcileUploads(db, new Date(NOW), NOW);
    expect(peak).toBe(8);
    expect(counts).toEqual({ checked: 40, uploaded: 0, deleted: 0, missing: 0, deferred: 0 });
  });

  it("starts with the newest row, so a live upload is settled before an old empty one", async () => {
    const order: string[] = [];
    const rows = [
      row("old", "s1/old.jpg", 90),
      row("new", "s1/new.jpg", 5),
      row("mid", "s1/mid.jpg", 30),
    ];
    const db = fakeDb({
      tables: { submission_media: rows },
      storage: {
        submissions: {
          download: (path: unknown) => {
            order.push(String(path));
            return Promise.resolve({ data: null, error: NOT_FOUND });
          },
        },
      },
    });
    await reconcileUploads(db, new Date(NOW), NOW);
    expect(order).toEqual(["s1/new.jpg", "s1/mid.jpg", "s1/old.jpg"]);
  });

  it("reads nothing once the deadline has passed and leaves every row for the next run", async () => {
    const download = vi.fn(() => ({ data: null, error: NOT_FOUND }));
    const db = crowded(5, download);
    const counts = await reconcileUploads(db, new Date(NOW), NOW, 0);
    expect(download).not.toHaveBeenCalled();
    expect(counts).toEqual({ checked: 0, uploaded: 0, deleted: 0, missing: 0, deferred: 5 });
  });

  it("stops taking rows when the deadline arrives during the run", async () => {
    let clock = 1_000;
    const tick = vi.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      const db = crowded(30, () => {
        clock += 1_000;
        return { data: null, error: NOT_FOUND };
      });
      const counts = await reconcileUploads(db, new Date(NOW), NOW, 6_500);
      expect(counts.checked + counts.deferred).toBe(30);
      expect(counts.checked).toBeGreaterThan(0);
      expect(counts.deferred).toBeGreaterThan(0);
    } finally {
      tick.mockRestore();
    }
  });

  it("takes no further row once one read has failed", async () => {
    // The first read fails at once; the other seven are still waiting and would go on to the next rows.
    const download = vi.fn((): unknown =>
      download.mock.calls.length === 1
        ? { data: null, error: { message: "Bad gateway", status: 502, code: "InternalError" } }
        : new Promise((resolve) => setTimeout(resolve, 5, { data: null, error: NOT_FOUND })),
    );
    const db = crowded(40, download);
    await expect(reconcileUploads(db, new Date(NOW), NOW)).rejects.toMatchObject({
      code: "storage_unavailable",
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(download.mock.calls.length).toBe(8);
  });
});
