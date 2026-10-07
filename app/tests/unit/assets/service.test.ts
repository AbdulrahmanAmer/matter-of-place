import "../../fixtures/worker-env";
import { describe, expect, it, vi } from "vitest";
import type { Tables } from "../../../src/db";
import { Route as getRoute } from "../../../src/routes/api/admin/assets.$id";
import { Route as approveRoute } from "../../../src/routes/api/admin/assets.$id.approve";
import { Route as captionRoute } from "../../../src/routes/api/admin/assets.$id.caption";
import { Route as rejectRoute } from "../../../src/routes/api/admin/assets.$id.reject";
import { Route as rerenderRoute } from "../../../src/routes/api/admin/assets.$id.rerender";
import { Route as listRoute } from "../../../src/routes/api/admin/assets.index";
import {
  editCaption,
  getAsset,
  listAssets,
  rerenderAsset,
} from "../../../src/server/assets/service";
import type * as ActorModule from "../../../src/server/lib/actor";
import type { Actor } from "../../../src/server/lib/actor";
import type { AdminActor, AdminHandler } from "../../../src/server/lib/admin-route";
import type * as CsrfModule from "../../../src/server/lib/csrf";
import type * as DbModule from "../../../src/server/lib/db";
import { AppError } from "../../../src/server/lib/errors";
import { mediaUrl } from "../../../src/server/lib/media-store";
import { loadAdminRoutes } from "../../fixtures/admin-routes";
import { ASSET_ID, JOB_ID, PROPERTY_ID, assetRow, propertyRow } from "../../fixtures/asset-rows";
import { fakeDb, type FakeDb } from "../../fixtures/fake-db";
import { withTables } from "../../fixtures/table-stub";

// B9 step 10, screen 10: the six `/api/admin/assets*` handlers through B7's wrapper with the actor, CSRF and client
// replaced, and the service functions against the fake client (R50). Idempotency and the event rows are SQL's: the
// database half is tests/db/assets-service.db.test.ts.

const live = vi.hoisted<{ actor: Actor | undefined; db: FakeDb | undefined }>(() => ({
  actor: undefined,
  db: undefined,
}));

vi.mock("../../../src/server/lib/actor", async (original) => ({
  ...(await original<typeof ActorModule>()),
  requireActor: () =>
    live.actor === undefined
      ? Promise.reject(new AppError("unauthorized", undefined, "Please sign in."))
      : Promise.resolve(live.actor),
}));
vi.mock("../../../src/server/lib/csrf", async (original) => ({
  ...(await original<typeof CsrfModule>()),
  verifyCsrf: () => Promise.resolve(),
}));
vi.mock("../../../src/server/lib/db", async (original) => ({
  ...(await original<typeof DbModule>()),
  getDb: () => live.db ?? fakeDb(),
}));

const USER = "00000000-0000-4000-8000-000000000001";
const OTHER_PROPERTY = "3f2a9c1d-0000-4000-8000-000000000002";
const KEY = `assets/${PROPERTY_ID}/cover/r1/cover.0a1b2c3d.jpg`;

const human = (roles: Actor["roles"]): Actor => ({
  userId: USER,
  kind: "human",
  roles,
  scopes: [],
});
const asActor = (actor: Actor): AdminActor => ({ ...actor, requestId: "req-assets" });
const mediaOps = asActor(human(["media_ops"]));

const COVER_FILES = [
  { media_key: KEY, w: 1200, h: 630, bytes: 182_044, role: "main" },
  { media_key: KEY.replace("cover.", "x."), w: 1200, h: 675, bytes: 160_220, role: "x" },
];

const isHandler = (value: unknown): value is AdminHandler => typeof value === "function";

function handlerOf(route: { options: unknown }, method: string): AdminHandler {
  const handlers: unknown = Reflect.get(
    Reflect.get(Object(route.options), "server") ?? {},
    "handlers",
  );
  const handler: unknown = Reflect.get(Object(handlers), method);
  if (!isHandler(handler)) throw new Error(`no ${method} handler`);
  return handler;
}

const HANDLERS = {
  list: { handler: handlerOf(listRoute, "GET"), method: "GET", path: "" },
  get: { handler: handlerOf(getRoute, "GET"), method: "GET", path: `/${ASSET_ID}` },
  approve: {
    handler: handlerOf(approveRoute, "POST"),
    method: "POST",
    path: `/${ASSET_ID}/approve`,
  },
  reject: { handler: handlerOf(rejectRoute, "POST"), method: "POST", path: `/${ASSET_ID}/reject` },
  rerender: {
    handler: handlerOf(rerenderRoute, "POST"),
    method: "POST",
    path: `/${ASSET_ID}/rerender`,
  },
  caption: { handler: handlerOf(captionRoute, "PUT"), method: "PUT", path: `/${ASSET_ID}/caption` },
} as const;
const NAMES = ["list", "get", "approve", "reject", "rerender", "caption"] as const;

async function send(
  name: keyof typeof HANDLERS,
  body?: unknown,
): Promise<{ status: number; cacheControl: string | null; body: unknown }> {
  const { handler, method, path } = HANDLERS[name];
  const response = await handler({
    request: new Request(`https://example.test/api/admin/assets${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    }),
    context: { requestId: "req-assets" },
    params: path === "" ? {} : { id: ASSET_ID },
  });
  const json: unknown = await response.json();
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control"),
    body: json,
  };
}

const errorCode = (body: unknown): unknown =>
  Reflect.get(Object(Reflect.get(Object(body), "error")), "code");

const rpcCalls = (db: FakeDb) => db.calls.filter((call) => call.kind === "rpc");

/** What a call answered: its result, or the status and code it was refused with. */
async function outcome(call: Promise<unknown>): Promise<unknown> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof AppError) return { status: error.status, code: error.code };
    throw error;
  }
}

type Row = Tables<"assets">;

function queuedCaptionJob(propertyId: string, status: Tables<"jobs">["status"] = "queued") {
  return {
    type: "write_captions",
    status,
    payload: { params: {}, data: { property_id: propertyId } },
  };
}

function assetsDb(assets: Row[], jobs: Record<string, unknown>[] = []): FakeDb {
  return withTables(fakeDb(), { assets, jobs, properties: [propertyRow()] });
}

describe("the six /api/admin/assets* handlers", () => {
  it("are the only assets route files, and every one answers Cache-Control no-store", async () => {
    live.actor = undefined;
    const files = (await loadAdminRoutes())
      .filter((route) => route.file.startsWith("assets."))
      .map((route) => route.file);
    const answers = await Promise.all(
      NAMES.map(async (name) => {
        const { status, cacheControl } = await send(
          name,
          HANDLERS[name].method === "GET" ? undefined : {},
        );
        return { status, cacheControl };
      }),
    );
    expect(files).toHaveLength(NAMES.length);
    expect(answers).toEqual(NAMES.map(() => ({ status: 401, cacheControl: "private, no-store" })));
  });

  it("answers 403 forbidden to commercial on approve before any database call", async () => {
    live.actor = human(["commercial"]);
    live.db = fakeDb();
    const answer = await send("approve", {});
    expect({ status: answer.status, code: errorCode(answer.body), calls: live.db.calls }).toEqual({
      status: 403,
      code: "forbidden",
      calls: [],
    });
  });

  it("refuses an agent bearer approve with 403 manual_approval and calls no SQL function", async () => {
    live.actor = { userId: USER, kind: "agent", roles: ["media_ops"], scopes: ["assets"] };
    live.db = fakeDb();
    const answer = await send("approve", {});
    expect({ status: answer.status, code: errorCode(answer.body), calls: live.db.calls }).toEqual({
      status: 403,
      code: "manual_approval",
      calls: [],
    });
  });

  it("answers 422 to rejectAsset without a note and writes no event", async () => {
    live.actor = human(["chief_editor"]);
    live.db = fakeDb();
    const answer = await send("reject", {});
    expect({ status: answer.status, code: errorCode(answer.body), calls: live.db.calls }).toEqual({
      status: 422,
      code: "validation",
      calls: [],
    });
  });

  it("answers a media_ops list with no-store JSON of the page", async () => {
    live.actor = human(["media_ops"]);
    live.db = assetsDb([assetRow({ caption: "A caption.", files: COVER_FILES })]);
    const answer = await send("list");
    expect({ status: answer.status, cacheControl: answer.cacheControl }).toEqual({
      status: 200,
      cacheControl: "private, no-store",
    });
    expect(Reflect.get(Object(answer.body), "total")).toBe(1);
  });
});

describe("listAssets and getAsset", () => {
  it("return files[0].url equal to the relative mediaUrl of files[0].media_key", async () => {
    const db = assetsDb([assetRow({ caption: "A caption.", files: COVER_FILES })]);
    const listed = await listAssets(mediaOps, db, { page: 1 });
    const got = await getAsset(mediaOps, db, { id: ASSET_ID });
    expect([listed.items[0]?.files[0]?.url, got.files[0]?.url]).toEqual([
      mediaUrl(KEY),
      mediaUrl(KEY),
    ]);
    expect(mediaUrl(KEY)).toBe(`/media/${KEY}`);
    expect(got.files.map((file) => file.role)).toEqual(["main", "x"]);
  });

  it("marks a null caption whose property has a queued write_captions job captions_waiting: true", async () => {
    const db = assetsDb(
      [
        assetRow({ id: "3f2a9c1d-0000-4000-8000-0000000000b1", caption: null }),
        assetRow({ id: "3f2a9c1d-0000-4000-8000-0000000000b2", caption: "Written." }),
        assetRow({
          id: "3f2a9c1d-0000-4000-8000-0000000000b3",
          caption: null,
          property_id: OTHER_PROPERTY,
        }),
      ],
      [queuedCaptionJob(PROPERTY_ID), queuedCaptionJob(OTHER_PROPERTY, "running")],
    );
    const { items } = await listAssets(mediaOps, db, { page: 1 });
    expect(items.map((item) => [item.id.slice(-2), item.captions_waiting])).toEqual([
      ["b1", true],
      ["b2", false],
      ["b3", false],
    ]);
  });

  it("pages 60 rows at 50 a page with the total of every match", async () => {
    const rows = Array.from({ length: 60 }, (_, n) =>
      assetRow({
        id: `3f2a9c1d-0000-4000-8000-${String(n).padStart(12, "0")}`,
        caption: "Written.",
        created_at: new Date(Date.UTC(2026, 9, 4, 12, n)).toISOString(),
      }),
    );
    const db = assetsDb(rows);
    const first = await listAssets(mediaOps, db, { page: 1 });
    const second = await listAssets(mediaOps, db, { page: 2 });
    expect([first.items.length, first.total, second.items.length, second.total]).toEqual([
      50, 60, 10, 60,
    ]);
    expect(first.items[0]?.created_at).toBe(rows[59]?.created_at);
  });

  it("answers 404 not_found for an id with no row", async () => {
    expect(await outcome(getAsset(mediaOps, assetsDb([]), { id: ASSET_ID }))).toEqual({
      status: 404,
      code: "not_found",
    });
  });
});

describe("editCaption", () => {
  it("answers 422 caption_lint_failed to a banned word and calls no SQL function", async () => {
    const db = assetsDb([assetRow()]);
    const answer = await outcome(
      editCaption(mediaOps, db, {
        id: ASSET_ID,
        captions: { instagram: "A stunning house in Los Altos Hills." },
      }),
    );
    expect({ answer, rpc: rpcCalls(db) }).toEqual({
      answer: { status: 422, code: "caption_lint_failed" },
      rpc: [],
    });
  });

  it("stores passing text through set_asset_caption once", async () => {
    const db = withTables(fakeDb({ rpc: { set_asset_caption: () => undefined } }), {
      assets: [assetRow()],
      properties: [propertyRow()],
    });
    const captions = { instagram: "Five bedrooms on a quiet street in Los Altos Hills." };
    const answer = await editCaption(mediaOps, db, { id: ASSET_ID, captions });
    expect({ answer, rpc: rpcCalls(db).map((call) => call.name) }).toEqual({
      answer: { asset_id: ASSET_ID },
      rpc: ["set_asset_caption"],
    });
  });
});

describe("rerenderAsset", () => {
  it("returns the same pending revision and job on a second call", async () => {
    // rerender_asset answers the newest revision while it is pending (the db test runs the SQL itself).
    const pending = { asset_id: "3f2a9c1d-0000-4000-8000-0000000000b9", job_id: JOB_ID };
    const db = fakeDb({ rpc: { rerender_asset: () => pending } });
    const first = await rerenderAsset(mediaOps, db, { id: ASSET_ID });
    const second = await rerenderAsset(mediaOps, db, { id: ASSET_ID });
    expect([first, second]).toEqual([pending, pending]);
  });
});
