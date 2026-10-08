import "../fixtures/worker-env";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadUrlInputSchema } from "../../src/domain/admin-media";
import { uploadLimits } from "../../src/domain/contracts";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { AppError } from "../../src/server/lib/errors";
import {
  attachMedia,
  createUploadUrl,
  deleteMedia,
  listMedia,
  variantsStatus,
} from "../../src/server/media/service";
import { createStagingUpload, sniffStaged } from "../../src/server/media/staging";
import { fakeDb, type FakeDb } from "../fixtures/fake-db";
import { withTables, type Row } from "../fixtures/table-stub";

// Screen 9 (B7 step 8) over a stubbed Storage client and `fetch`: where an upload is staged, what refuses a file before
// the database, and what the grid and the render states answer. The SQL behind each RPC is in tests/db/admin.db.test.ts.

const PROPERTY = "00000000-0000-4000-8000-0000000000b1";
const MEDIA = "00000000-0000-4000-8000-0000000000a1";
const JOB = "00000000-0000-4000-8000-0000000000d1";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

const actor = (roles: AdminActor["roles"]): AdminActor => ({
  userId: "00000000-0000-4000-8000-000000000001",
  kind: "human",
  roles,
  scopes: [],
  requestId: "req-media",
});

const editor = actor(["managing_editor"]);

async function outcome(call: Promise<unknown>): Promise<unknown> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof AppError) return { status: error.status, code: error.code };
    throw error;
  }
}

const calls = (db: FakeDb) => db.calls.map((call) => `${call.kind}:${call.name}`);

/** A Storage client that signs every upload and read, and records each removal. */
function storage(removed: string[] = []) {
  return {
    submissions: {
      createSignedUploadUrl: (path: unknown) => ({
        data: { signedUrl: `https://storage.test/upload/${String(path)}`, path, token: "t" },
        error: null,
      }),
      createSignedUrl: (path: unknown) => ({
        data: { signedUrl: `https://storage.test/read/${String(path)}` },
        error: null,
      }),
      remove: (paths: unknown) => {
        if (Array.isArray(paths)) removed.push(...paths.map(String));
        return { data: [], error: null };
      },
    },
  };
}

/** Storage answers the ranged read with these bytes. */
const serveBytes = (bytes: Uint8Array<ArrayBuffer>) => {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(bytes, { status: 206 })));
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createStagingUpload", () => {
  it("stages a property's first upload as staging/<property>/<new media id>.jpg in the bucket submissions", async () => {
    const db = fakeDb({ storage: storage() });
    const staged = await createStagingUpload(
      db,
      { scope: "property", target: PROPERTY },
      "image/jpeg",
    );
    expect({
      calls: db.calls.map((call) => [call.name, ...call.args]),
      matches: new RegExp(`^staging/${PROPERTY}/${UUID}\\.jpg$`).test(staged.path),
      path: staged.path,
    }).toEqual({
      calls: [
        ["submissions.createSignedUploadUrl", `staging/${PROPERTY}/${staged.media_id ?? ""}.jpg`],
      ],
      matches: true,
      path: `staging/${PROPERTY}/${staged.media_id ?? ""}.jpg`,
    });
  });

  it("gives a replace the same media id and a fresh 8 hex suffix each time (G54)", async () => {
    const db = fakeDb({ storage: storage() });
    const first = await createStagingUpload(
      db,
      { scope: "property", target: PROPERTY, mediaId: MEDIA },
      "image/jpeg",
    );
    const second = await createStagingUpload(
      db,
      { scope: "property", target: PROPERTY, mediaId: MEDIA },
      "image/jpeg",
    );
    const shape = new RegExp(`^staging/${PROPERTY}/${MEDIA}\\.[0-9a-f]{8}\\.jpg$`);
    expect({
      ids: [first.media_id, second.media_id],
      shaped: [shape.test(first.path), shape.test(second.path)],
      differ: first.path !== second.path,
    }).toEqual({ ids: [MEDIA, MEDIA], shaped: [true, true], differ: true });
  });

  it("stages a story image under staging/story/<slug>/ and a region image under staging/region/<slug>/ (G51)", async () => {
    const db = fakeDb({ storage: storage() });
    const story = await createStagingUpload(
      db,
      { scope: "story", target: "a-quiet-street" },
      "image/png",
    );
    const region = await createStagingUpload(
      db,
      { scope: "region", target: "bay-area" },
      "image/webp",
    );
    expect({
      story: new RegExp(`^staging/story/a-quiet-street/${UUID}\\.png$`).test(story.path),
      region: new RegExp(`^staging/region/bay-area/${UUID}\\.webp$`).test(region.path),
      ids: [story.media_id, region.media_id],
    }).toEqual({ story: true, region: true, ids: [undefined, undefined] });
  });

  it("answers 503 storage_unavailable when Storage refuses to sign", async () => {
    const db = fakeDb({
      storage: {
        submissions: { createSignedUploadUrl: () => ({ data: null, error: { message: "down" } }) },
      },
    });
    expect(
      await outcome(createStagingUpload(db, { scope: "property", target: PROPERTY }, "image/jpeg")),
    ).toEqual({ status: 503, code: "storage_unavailable" });
  });
});

describe("upload-url", () => {
  const input = (scope: "property" | "market", target: string) =>
    uploadUrlInputSchema.parse({ scope, target, mime: "image/jpeg", size: 1000 });

  it("refuses a visual editor a market image with 403 and asks Storage nothing", async () => {
    const db = fakeDb({ storage: storage() });
    const answer = await outcome(
      createUploadUrl(actor(["visual_editor"]), db, input("market", "california")),
    );
    expect({ answer, calls: calls(db) }).toEqual({
      answer: { status: 403, code: "forbidden" },
      calls: [],
    });
  });

  it("takes its size cap and types from uploadLimits", () => {
    const sized = (size: number, mime = "image/jpeg") =>
      uploadUrlInputSchema.safeParse({ scope: "property", target: PROPERTY, mime, size }).success;
    expect({
      atCap: sized(uploadLimits.maxBytes),
      overCap: sized(uploadLimits.maxBytes + 1),
      gif: sized(1000, "image/gif"),
    }).toEqual({ atCap: true, overCap: false, gif: false });
  });
});

describe("attachMedia", () => {
  it("refuses a path outside staging/<property>/<media id>. with 422 invalid_image and makes no RPC", async () => {
    const db = fakeDb({ storage: storage() });
    const answer = await outcome(
      attachMedia(editor, db, {
        property_id: PROPERTY,
        media_id: MEDIA,
        staging_path: `staging/${PROPERTY}/00000000-0000-4000-8000-0000000000ff.jpg`,
      }),
    );
    expect({ answer, calls: calls(db) }).toEqual({
      answer: { status: 422, code: "invalid_image" },
      calls: [],
    });
  });

  it("attaches a staged JPEG with one attach_media call after reading its first bytes", async () => {
    serveBytes(JPEG);
    const path = `staging/${PROPERTY}/${MEDIA}.jpg`;
    const db = fakeDb({
      storage: storage(),
      rpc: { attach_media: () => ({ media_id: MEDIA, sort_order: 0, render_job_id: JOB }) },
    });
    const answer = await attachMedia(editor, db, {
      property_id: PROPERTY,
      media_id: MEDIA,
      staging_path: path,
    });
    expect({ answer, calls: calls(db), args: db.calls.at(-1)?.args[0] }).toEqual({
      answer: { media_id: MEDIA, sort_order: 0, render_job_id: JOB },
      calls: ["storage:submissions.createSignedUrl", "rpc:attach_media"],
      args: {
        p_media_id: MEDIA,
        p_property_id: PROPERTY,
        p_staging_path: path,
        p_actor: editor.userId,
        p_actor_kind: "human",
        p_request_id: "req-media",
      },
    });
  });

  it("answers 503 storage_unavailable when Storage cannot sign the read, and leaves no row", async () => {
    const db = fakeDb({
      storage: {
        submissions: { createSignedUrl: () => ({ data: null, error: { message: "down" } }) },
      },
    });
    const answer = await outcome(
      attachMedia(editor, db, {
        property_id: PROPERTY,
        media_id: MEDIA,
        staging_path: `staging/${PROPERTY}/${MEDIA}.jpg`,
      }),
    );
    expect({ answer, calls: calls(db) }).toEqual({
      answer: { status: 503, code: "storage_unavailable" },
      calls: ["storage:submissions.createSignedUrl"],
    });
  });
});

describe("sniffStaged", () => {
  it("refuses a text file renamed .jpg, removes it and throws invalid_image", async () => {
    serveBytes(new TextEncoder().encode("this is not a photograph at all"));
    const removed: string[] = [];
    const db = fakeDb({ storage: storage(removed) });
    const path = `staging/${PROPERTY}/${MEDIA}.jpg`;
    expect({ answer: await outcome(sniffStaged(db, path)), removed }).toEqual({
      answer: { status: 422, code: "invalid_image" },
      removed: [path],
    });
  });
});

describe("deleteMedia", () => {
  it("is refused on a published property with 409 and removes nothing", async () => {
    const db = fakeDb({
      storage: storage(),
      rpc: { delete_media: () => Object.assign(new Error("wrong_state"), { code: "P0001" }) },
    });
    expect({
      answer: await outcome(deleteMedia(editor, db, { id: MEDIA })),
      calls: calls(db),
    }).toEqual({
      answer: { status: 409, code: "wrong_state" },
      calls: ["rpc:delete_media"],
    });
  });

  it("removes the staged file delete_media hands back", async () => {
    const removed: string[] = [];
    const path = `staging/${PROPERTY}/${MEDIA}.jpg`;
    const db = fakeDb({ storage: storage(removed), rpc: { delete_media: () => path } });
    expect({ answer: await deleteMedia(editor, db, { id: MEDIA }), removed }).toEqual({
      answer: { id: MEDIA },
      removed: [path],
    });
  });
});

describe("listMedia", () => {
  it("answers /media/<media_key> for a stored row and no supabase.co address anywhere (media address, H33 (4))", async () => {
    const stored: Row = {
      id: MEDIA,
      property_id: PROPERTY,
      sort_order: 0,
      alt: "The hall",
      orientation: "landscape",
      media_key: "o/sea-cliff/1-0a1b2c3d.webp",
      staging_path: null,
    };
    const db = withTables(fakeDb(), { property_media: [stored] });
    const body = await listMedia(editor, db, { property_id: PROPERTY });
    expect({
      url: body.items[0]?.url,
      supabase: JSON.stringify(body).includes("supabase.co"),
    }).toEqual({
      url: "/media/o/sea-cliff/1-0a1b2c3d.webp",
      supabase: false,
    });
  });

  it("signs a staged row's file for the grid, and answers null for one not copied yet", async () => {
    const staged = (n: number): Row => ({
      id: `00000000-0000-4000-8000-00000000000${String(n)}`,
      property_id: PROPERTY,
      sort_order: n,
      alt: null,
      orientation: null,
      media_key: null,
      staging_path: `staging/${PROPERTY}/${String(n)}.jpg`,
    });
    const db = withTables(
      fakeDb({
        storage: {
          submissions: {
            createSignedUrls: (paths: unknown) => ({
              data: (Array.isArray(paths) ? paths : []).map((path: unknown) => ({
                path,
                signedUrl: path === `staging/${PROPERTY}/1.jpg` ? "https://storage.test/one" : null,
              })),
              error: null,
            }),
          },
        },
      }),
      { property_media: [staged(1), staged(2)] },
    );
    const body = await listMedia(editor, db, { property_id: PROPERTY });
    expect(body.items.map((item) => item.url)).toEqual(["https://storage.test/one", null]);
  });
});

describe("variantsStatus", () => {
  const row = (n: number, staged: boolean): Row => ({
    id: `00000000-0000-4000-8000-00000000000${String(n)}`,
    property_id: PROPERTY,
    staging_path: staged ? `staging/${PROPERTY}/${String(n)}.jpg` : null,
    media_key: staged ? null : `o/sea-cliff/${String(n)}-0a1b2c3d.webp`,
    render_job_id: null,
  });
  const job = (status: string): Row => ({
    id: JOB,
    type: "render_variants",
    status,
    created_at: "2026-10-08T10:00:00Z",
    payload: { params: {}, data: { property_id: PROPERTY } },
  });
  const states = (jobs: Row[]) =>
    variantsStatus(
      editor,
      withTables(fakeDb(), { property_media: [row(1, false), row(2, true)], jobs }),
      PROPERTY,
    ).then((answer) => answer.items.map((item) => [item.state, item.job_id]));

  it("answers ready for a stored row, and for a staged row processing, failed with the job id, or staged", async () => {
    expect({
      queued: await states([job("queued")]),
      dead: await states([job("dead")]),
      none: await states([]),
    }).toEqual({
      queued: [
        ["ready", null],
        ["processing", null],
      ],
      dead: [
        ["ready", null],
        ["failed", JOB],
      ],
      none: [
        ["ready", null],
        ["staged", null],
      ],
    });
  });
});
