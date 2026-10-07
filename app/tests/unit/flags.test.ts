// The feature flags (GQ-05, G18): `settings.flags` plus `coming_soon_global` read as one snake_case record. The
// assertions use toMatchObject so a later slice can add a key (`csp_enforce`, `maintenance`) without editing them.
import "../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultFlags, featureFlags, flagsSchema } from "../../src/domain/flags";
import { mergeFlags } from "../../src/server/lib/flags";
import { fakeDb, type FakeDb } from "../fixtures/fake-db";
import { snapshotJson, stateJson } from "../fixtures/snapshot";

describe("flagsSchema and defaultFlags", () => {
  it("defaults every feature flag to false", () => {
    expect(featureFlags).toEqual(expect.arrayContaining(["new_channels", "archive_pages"]));
    expect(defaultFlags).toMatchObject({ new_channels: false, archive_pages: false });
    expect(Object.values(defaultFlags).every((value) => !value)).toBe(true);
  });

  it("keeps a stored key and drops an unknown one", () => {
    expect(flagsSchema.parse({ new_channels: true, nonsense: true })).toEqual({
      new_channels: true,
    });
  });

  it("refuses a row that is not a record of booleans", () => {
    expect(flagsSchema.safeParse({ new_channels: "yes" }).success).toBe(false);
    expect(flagsSchema.safeParse(null).success).toBe(false);
    expect(flagsSchema.safeParse("true").success).toBe(false);
  });
});

describe("mergeFlags", () => {
  it("turns coming_soon_global into the flag coming_soon", () => {
    expect(mergeFlags({}, true)).toMatchObject({ coming_soon: true });
    expect(mergeFlags({}, false)).toMatchObject({ coming_soon: false });
    expect(mergeFlags({}, null)).toMatchObject({ coming_soon: false });
  });

  it("returns coming_soon, new_channels and archive_pages in snake_case", () => {
    const merged = mergeFlags({ new_channels: true }, true);
    expect(merged).toMatchObject({ coming_soon: true, new_channels: true, archive_pages: false });
    expect(Object.keys(merged).filter((key) => !/^[a-z]+(_[a-z]+)*$/.test(key))).toEqual([]);
  });

  it("reads archive_pages as false when the row lacks it and as stored when it has it", () => {
    expect(mergeFlags({ new_channels: true }, false)).toMatchObject({ archive_pages: false });
    expect(mergeFlags({ archive_pages: true }, false)).toMatchObject({ archive_pages: true });
  });

  it("ignores an unknown key of the row", () => {
    expect(Object.keys(mergeFlags({ nonsense: true }, false))).not.toContain("nonsense");
  });

  it("gives the defaults for a malformed row and still reads the coming-soon switch", () => {
    for (const row of [null, undefined, "true", 7, { new_channels: "yes" }]) {
      expect(mergeFlags(row, true)).toMatchObject({
        coming_soon: true,
        new_channels: false,
        archive_pages: false,
      });
    }
  });
});

// GQ-05, architecture 13 rule 1: a flag or a coming-soon decision costs the one state check the Worker already
// shares, and nothing here reads a table. A fresh module per test, because the memos live in module state.
describe("getFlags and getCatalog read the public state only", () => {
  const rpcCalls = (db: FakeDb, name: string) =>
    db.calls.filter((call) => call.name === name).length;
  const tableCalls = (db: FakeDb) => db.calls.filter((call) => call.kind === "from");

  async function load() {
    vi.resetModules();
    return {
      flags: await import("../../src/server/lib/flags"),
      state: await import("../../src/server/public/state"),
    };
  }

  function served() {
    const health = { up: true };
    const db = fakeDb({
      rpc: {
        public_state: () =>
          health.up
            ? stateJson(7, {
                flags: { new_channels: true, nonsense: true },
                coming_soon_global: true,
              })
            : new Error("down"),
        public_catalog_snapshot: () => (health.up ? snapshotJson(7) : new Error("down")),
      },
    });
    return { db, health };
  }

  beforeEach(() => {
    vi.stubEnv("MOP_ENV", "preview");
    vi.stubEnv("CATALOG_VERSION_TTL_MS", "15000");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reads the flags and the global switch from the state, unknown keys dropped", async () => {
    const { flags } = await load();
    expect(await flags.getFlags(served().db)).toEqual({
      coming_soon: true,
      new_channels: true,
      archive_pages: false,
      csp_enforce: false,
      maintenance: false,
    });
  });

  it("moves the counter by one public_state call in 100 calls and makes no table query", async () => {
    const { flags } = await load();
    const { db } = served();
    for (let call = 0; call < 100; call += 1) await flags.getFlags(db);
    expect(rpcCalls(db, "public_state")).toBe(1);
    expect(db.calls).toHaveLength(1);
    expect(tableCalls(db)).toEqual([]);
  });

  it("moves the counter by one state call and one snapshot call in 100 getCatalog calls", async () => {
    const { state } = await load();
    const { db } = served();
    for (let call = 0; call < 100; call += 1) await state.getCatalog(db);
    expect(rpcCalls(db, "public_state")).toBe(1);
    expect(rpcCalls(db, "public_catalog_snapshot")).toBe(1);
    expect(tableCalls(db)).toEqual([]);
  });

  it("serves the last good flags and the last good catalog when the reads fail", async () => {
    vi.stubEnv("CATALOG_VERSION_TTL_MS", "0");
    const { flags, state } = await load();
    const { db, health } = served();
    const good = await flags.getFlags(db);
    const goodCatalog = await state.getCatalog(db);
    health.up = false;
    expect(await flags.getFlags(db)).toEqual(good);
    expect(await state.getCatalog(db)).toEqual(goodCatalog);
  });
});
