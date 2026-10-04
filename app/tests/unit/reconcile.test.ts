// The upload reconcile of E2E-02 over a fake database and a fake Storage bucket: what the first bytes announce decides
// whether a photograph is kept and marked, removed, or still awaited.
import { describe, expect, it } from "vitest";
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
  submissions: { received_at: new Date(NOW - minutesAgo * MINUTE).toISOString() },
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
    expect(counts).toEqual({ checked: 4, uploaded: 1, deleted: 1, missing: 1 });
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
