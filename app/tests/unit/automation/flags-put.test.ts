// B8b step 6, invariant 14: the write side of feature flags. `putFlags` refuses an unknown name and an agent, makes one
// `settings_put_flags` call, and drops this isolate's state memo; `getFlags` still reads only the public state.
import "../../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../../src/db";
import { featureFlags, flagLabels } from "../../../src/domain/flags";
import type { AdminActor } from "../../../src/server/lib/admin-route";
import { fakeDb, type FakeDb } from "../../fixtures/fake-db";
import { stateJson } from "../../fixtures/snapshot";

const actor = (kind: AdminActor["kind"], roles: AdminActor["roles"] = ["admin"]): AdminActor => ({
  userId: "00000000-0000-4000-8000-000000000001",
  kind,
  roles,
  scopes: ["automation"],
  requestId: "req-flags",
});

/** A fresh module per test: the state memo lives in module state. */
async function load() {
  vi.resetModules();
  return import("../../../src/server/lib/flags");
}

type JsonRecord = { [key: string]: Json | undefined };

const isRecord = (value: Json): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A database whose `settings.flags` row is `stored`, written only through `settings_put_flags`. */
function database(stored: JsonRecord | null): FakeDb {
  let row = stored;
  return fakeDb({
    rpc: {
      public_state: () => stateJson(7, row === null ? {} : { flags: row }),
      settings_put_flags: ({ p_value }) => {
        row = { ...row, ...(isRecord(p_value) ? p_value : {}) };
        return row;
      },
    },
  });
}

const callsOf = (db: FakeDb, name: string) => db.calls.filter((call) => call.name === name);

beforeEach(() => {
  vi.stubEnv("MOP_ENV", "preview");
  vi.stubEnv("CATALOG_VERSION_TTL_MS", "15000");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("flagLabels", () => {
  it("describes every flag in one line with no em dash", () => {
    expect(Object.keys(flagLabels).sort()).toEqual([...featureFlags].sort());
    expect(Object.values(flagLabels).filter((label) => label.includes("—"))).toEqual([]);
  });
});

describe("getFlags", () => {
  it("returns the defaults when the row is absent", async () => {
    const { getFlags } = await load();
    expect(await getFlags(database(null))).toEqual({
      coming_soon: false,
      new_channels: false,
      archive_pages: false,
      csp_enforce: false,
      maintenance: false,
    });
  });

  it("issues no query of its own: 1,000 calls inside 15 seconds cost at most one state read", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-08T09:00:00Z") });
    const { getFlags } = await load();
    const db = database({ archive_pages: true });
    for (let call = 0; call < 1000; call += 1) {
      await getFlags(db);
      vi.advanceTimersByTime(14);
    }
    expect(db.calls.map((call) => call.name)).toEqual(["public_state"]);
  });
});

describe("putFlags", () => {
  it("refuses an unknown flag name with 422 and no call", async () => {
    const { putFlags } = await load();
    const db = database({});
    await expect(putFlags(actor("human"), db, { dark_mode: true })).rejects.toMatchObject({
      code: "validation",
      status: 422,
    });
    expect(db.calls).toEqual([]);
  });

  it("refuses an agent with 403 human_only and no call", async () => {
    const { putFlags } = await load();
    const db = database({});
    await expect(putFlags(actor("agent"), db, { archive_pages: true })).rejects.toMatchObject({
      code: "human_only",
      status: 403,
    });
    expect(db.calls).toEqual([]);
  });

  it("refuses a person who is not an admin with 403", async () => {
    const { putFlags } = await load();
    const db = database({});
    await expect(
      putFlags(actor("human", ["chief_editor"]), db, { archive_pages: true }),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(db.calls).toEqual([]);
  });

  it("an admin makes exactly one settings_put_flags call with its actor and no other call", async () => {
    const { putFlags } = await load();
    const db = database({ archive_pages: false, csp_enforce: true });
    expect(await putFlags(actor("human"), db, { archive_pages: true })).toEqual({
      new_channels: false,
      archive_pages: true,
      csp_enforce: true,
      maintenance: false,
    });
    expect(db.calls).toEqual([
      {
        kind: "rpc",
        name: "settings_put_flags",
        args: [
          {
            p_value: { archive_pages: true },
            p_actor: "00000000-0000-4000-8000-000000000001",
            p_actor_kind: "human",
            p_request_id: "req-flags",
          },
        ],
      },
    ]);
  });

  it("drops the writing isolate's memo, so its next getFlags shows the new value", async () => {
    const { getFlags, putFlags } = await load();
    const db = database({ archive_pages: false });
    expect(await getFlags(db)).toMatchObject({ archive_pages: false });
    await putFlags(actor("human"), db, { archive_pages: true });
    expect(await getFlags(db)).toMatchObject({ archive_pages: true });
    expect(callsOf(db, "public_state")).toHaveLength(2);
  });
});
