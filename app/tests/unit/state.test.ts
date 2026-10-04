import "../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Json } from "../../src/db";
import { fakeDb } from "../fixtures/fake-db";
import { propertyJson } from "../fixtures/snapshot";

vi.mock("../../src/server/catalog/visibility", { spy: true });

const T0 = new Date("2026-10-01T12:00:00Z");

function stateJson(version: number, extra: Record<string, Json> = {}): Json {
  return {
    catalog_version: version,
    flags: { archive_pages: true },
    coming_soon_global: false,
    coming_soon_markets: { california: false },
    site: { contact: { email: "hello@example.com" } },
    illustrative_content: true,
    ...extra,
  };
}

function snapshotJson(version: number, extra: Record<string, Json> = {}): Json {
  return {
    catalog_version: version,
    markets: [],
    regions: [],
    market_notes: [],
    market_guide_entries: [],
    representatives: [],
    properties: [],
    stories: [],
    redirects: [],
    slug_history: [],
    gone: [],
    ...extra,
  };
}

/** A fresh module per test: the memos and the report throttle live in module state. */
async function load() {
  vi.resetModules();
  return {
    state: await import("../../src/server/public/state"),
    visibility: await import("../../src/server/catalog/visibility"),
  };
}

function served(version: number) {
  const answers = { state: stateJson(version), snapshot: snapshotJson(version) };
  const db = fakeDb({
    rpc: {
      public_state: () => answers.state,
      public_catalog_snapshot: () => answers.snapshot,
    },
  });
  return { db, answers };
}

const rpcCalls = (db: ReturnType<typeof fakeDb>, name: string) =>
  db.calls.filter((call) => call.name === name).length;

const logged: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("CATALOG_VERSION_TTL_MS", "15000");
  vi.stubEnv("MOP_ENV", "preview");
  logged.length = 0;
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getPublicState", () => {
  it("calls the RPC once and answers from memory inside the interval", async () => {
    const { state } = await load();
    const { db } = served(5);
    expect((await state.getPublicState(db)).catalogVersion).toBe(5);
    await state.getPublicState(db);
    expect(rpcCalls(db, "public_state")).toBe(1);
    vi.setSystemTime(new Date(T0.getTime() + 15_000));
    await state.getPublicState(db);
    expect(rpcCalls(db, "public_state")).toBe(2);
  });

  it("asks every time when the interval is 0", async () => {
    vi.stubEnv("CATALOG_VERSION_TTL_MS", "0");
    const { state } = await load();
    const { db } = served(5);
    await state.getPublicState(db);
    await state.getPublicState(db);
    expect(rpcCalls(db, "public_state")).toBe(2);
  });

  it("holds exactly the seven keys and reads the injected client", async () => {
    const { state } = await load();
    const { db } = served(5);
    const current = await state.getPublicState(db);
    expect(Object.keys(current).sort()).toEqual([
      "catalogVersion",
      "comingSoonGlobal",
      "comingSoonMarkets",
      "flags",
      "illustrativeContent",
      "ogStatic",
      "site",
    ]);
    expect(db.calls.map((call) => call.name)).toEqual(["public_state"]);
  });

  it("passes og_static through unchanged, and reads an absent one as empty", async () => {
    const withStatic = served(5);
    withStatic.answers.state = stateJson(5, {
      og_static: { home: { media_key: "og/static/home.png" } },
    });
    const first = await (await load()).state.getPublicState(withStatic.db);
    const home = z.object({ home: z.object({ media_key: z.string() }) }).parse(first.ogStatic);
    expect(home.home.media_key).toBe("og/static/home.png");
    const without = await (await load()).state.getPublicState(served(5).db);
    expect(without.ogStatic).toEqual({});
  });

  it("serves the last good state when the RPC fails, and says so", async () => {
    vi.stubEnv("CATALOG_VERSION_TTL_MS", "0");
    const { state } = await load();
    const answers = { state: stateJson(5) as Json | Error };
    const db = fakeDb({ rpc: { public_state: () => answers.state } });
    await state.readState(db);
    answers.state = new Error("down");
    const read = await state.readState(db);
    expect(read.stale).toBe(true);
    expect(read.state.catalogVersion).toBe(5);
    expect(state.servingStale()).toBe(true);
    answers.state = stateJson(6);
    expect((await state.readState(db)).stale).toBe(false);
    expect(state.servingStale()).toBe(false);
  });

  it("gives up on an RPC that does not answer in 2 seconds and serves the last good state", async () => {
    vi.stubEnv("CATALOG_VERSION_TTL_MS", "0");
    const { state } = await load();
    let hang = false;
    const db = fakeDb({
      rpc: {
        public_state: () => (hang ? new Promise<Json>(() => undefined) : stateJson(5)),
      },
    });
    await state.readState(db);
    hang = true;
    const pending = state.readState(db);
    await vi.advanceTimersByTimeAsync(1999);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).stale).toBe(true);
  });

  it("answers 503 unavailable when there is no last good state", async () => {
    const { state } = await load();
    const db = fakeDb({ rpc: { public_state: () => new Error("down") } });
    await expect(state.getPublicState(db)).rejects.toMatchObject({
      code: "unavailable",
      status: 503,
    });
  });

  it("makes one failed attempt per interval, not one per request", async () => {
    const { state } = await load();
    const answers = { state: stateJson(5) as Json | Error };
    const db = fakeDb({ rpc: { public_state: () => answers.state } });
    await state.getPublicState(db);
    vi.setSystemTime(new Date(T0.getTime() + 15_000));
    answers.state = new Error("down");
    await state.getPublicState(db);
    await state.getPublicState(db);
    await state.getPublicState(db);
    expect(rpcCalls(db, "public_state")).toBe(2);
  });

  it("logs and queues one report a minute while the RPC keeps failing", async () => {
    vi.stubEnv("CATALOG_VERSION_TTL_MS", "0");
    const { state } = await load();
    const answers = { state: stateJson(5) as Json | Error };
    const db = fakeDb({ rpc: { public_state: () => answers.state } });
    await state.getPublicState(db);
    answers.state = new Error("down");
    await state.getPublicState(db);
    vi.setSystemTime(new Date(T0.getTime() + 10_000));
    await state.getPublicState(db);
    expect(logged.filter((line) => line.includes("public_read_stale"))).toHaveLength(1);
    expect(state.drainStaleReports()).toHaveLength(1);
    expect(state.drainStaleReports()).toHaveLength(0);
    vi.setSystemTime(new Date(T0.getTime() + 61_000));
    await state.getPublicState(db);
    expect(logged.filter((line) => line.includes("public_read_stale"))).toHaveLength(2);
    expect(state.drainStaleReports()).toHaveLength(1);
  });

  it("asks again inside the interval after resetPublicStateMemo, and keeps the last good state", async () => {
    const { state } = await load();
    const { db } = served(5);
    await state.getPublicState(db);
    state.resetPublicStateMemo();
    await state.getPublicState(db);
    expect(rpcCalls(db, "public_state")).toBe(2);
  });
});

describe("getCatalog", () => {
  it("reads the snapshot once per catalog version", async () => {
    const { state } = await load();
    const { db, answers } = served(5);
    await state.getCatalog(db);
    await state.getCatalog(db);
    expect(rpcCalls(db, "public_catalog_snapshot")).toBe(1);
    vi.setSystemTime(new Date(T0.getTime() + 15_000));
    answers.state = stateJson(6);
    answers.snapshot = snapshotJson(6);
    expect((await state.getCatalog(db)).version).toBe(6);
    expect(rpcCalls(db, "public_catalog_snapshot")).toBe(2);
  });

  it("reads the snapshot again when the version goes down, as after a restored database", async () => {
    const { state } = await load();
    const { db, answers } = served(9);
    await state.getCatalog(db);
    vi.setSystemTime(new Date(T0.getTime() + 15_000));
    answers.state = stateJson(4);
    answers.snapshot = snapshotJson(4);
    expect((await state.getCatalog(db)).version).toBe(4);
    expect(rpcCalls(db, "public_catalog_snapshot")).toBe(2);
  });

  it("builds the cards of the visible properties once per version, after the visibility pass", async () => {
    const { state, visibility } = await load();
    vi.mocked(visibility.applyVisibility).mockImplementation((rows) => ({
      ...rows,
      properties: rows.properties.filter((property) => property.slug === "p1"),
    }));
    const read = fakeDb({
      rpc: {
        public_state: () => stateJson(5),
        public_catalog_snapshot: () =>
          snapshotJson(5, { properties: [propertyJson("p1"), propertyJson("p2")] }),
      },
    });
    const first = await state.getCatalog(read);
    expect(first.properties.map((property) => property.slug)).toEqual(["p1"]);
    expect(first.cards.map((card) => card.slug)).toEqual(["p1"]);
    expect(first.cards[0]).not.toHaveProperty("gallery");
    expect((await state.getCatalog(read)).cards).toBe(first.cards);
    expect(rpcCalls(read, "public_catalog_snapshot")).toBe(1);
  });

  it("runs applyVisibility once per version with the state and MOP_ENV", async () => {
    const { state, visibility } = await load();
    const { db } = served(5);
    await state.getCatalog(db);
    await state.getCatalog(db);
    expect(visibility.applyVisibility).toHaveBeenCalledTimes(1);
    const [rows, ctx] = vi.mocked(visibility.applyVisibility).mock.calls[0] ?? [];
    expect(rows).toMatchObject({ properties: [], markets: [], stories: [] });
    expect(ctx).toEqual({
      state: await state.getPublicState(db),
      env: { MOP_ENV: "preview" },
    });
  });

  it("reads an unset MOP_ENV as production, so illustrative rows stay hidden", async () => {
    vi.stubEnv("MOP_ENV", undefined);
    const { state, visibility } = await load();
    await state.getCatalog(served(5).db);
    expect(vi.mocked(visibility.applyVisibility).mock.calls[0]?.[1].env).toEqual({
      MOP_ENV: "production",
    });
  });

  it("serves the last good catalog when the snapshot fails, and does not store what it builds", async () => {
    const { state } = await load();
    const { db, answers } = served(5);
    await state.getCatalog(db);
    vi.setSystemTime(new Date(T0.getTime() + 15_000));
    answers.state = stateJson(6);
    const failing = fakeDb({
      rpc: {
        public_state: () => stateJson(6),
        public_catalog_snapshot: () => new Error("down"),
      },
    });
    const read = await state.readCatalog(failing);
    expect(read.stale).toBe(true);
    expect(read.catalog.version).toBe(5);
    expect(state.servingStale()).toBe(true);
  });

  it("answers 503 unavailable when the snapshot fails and nothing was ever read", async () => {
    const { state } = await load();
    const db = fakeDb({
      rpc: { public_state: () => stateJson(5), public_catalog_snapshot: () => new Error("down") },
    });
    await expect(state.getCatalog(db)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("does not give a request for a newer version the load that is still reading an older one", async () => {
    const { state } = await load();
    const slow = Promise.withResolvers<Json>();
    const answers = { state: stateJson(5), version: 5 };
    const db = fakeDb({
      rpc: {
        public_state: () => answers.state,
        public_catalog_snapshot: () => (answers.version === 5 ? slow.promise : snapshotJson(6)),
      },
    });
    const first = state.getCatalog(db);
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(new Date(T0.getTime() + 15_000));
    answers.state = stateJson(6);
    answers.version = 6;
    const second = state.getCatalog(db);
    await vi.advanceTimersByTimeAsync(0);
    slow.resolve(snapshotJson(5));
    expect((await second).version).toBe(6);
    expect((await first).version).toBe(5);
    expect((await state.getCatalog(db)).version).toBe(6);
    expect(rpcCalls(db, "public_catalog_snapshot")).toBe(2);
  });

  it("makes one snapshot call for requests that arrive together", async () => {
    const { state } = await load();
    const { db } = served(5);
    await Promise.all([state.getCatalog(db), state.getCatalog(db), state.getCatalog(db)]);
    expect(rpcCalls(db, "public_catalog_snapshot")).toBe(1);
    expect(rpcCalls(db, "public_state")).toBe(1);
  });
});
