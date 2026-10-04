import { describe, expect, it } from "vitest";
import { fakeDb } from "../fixtures/fake-db";

describe("fakeDb", () => {
  it("answers a registered RPC with its value and records the call once", async () => {
    const db = fakeDb({ rpc: { public_state: () => true } });
    const answer = await db.rpc("public_state");
    expect(answer).toEqual({ data: true, error: null });
    expect(db.calls).toEqual([{ kind: "rpc", name: "public_state", args: [undefined] }]);
  });

  it("turns a returned Error into { data: null, error }", async () => {
    const failure = new Error("boom");
    const db = fakeDb({ rpc: { public_state: () => failure } });
    expect(await db.rpc("public_state")).toEqual({ data: null, error: failure });
  });

  it("throws unexpected rpc zz for an unregistered RPC", () => {
    const db = fakeDb({ rpc: { public_state: () => true } });
    // @ts-expect-error -- zz is not a function of the schema, which is the case under test
    expect(() => db.rpc("zz")).toThrow("unexpected rpc zz");
    expect(db.calls).toHaveLength(1);
  });

  it("serves registered table rows and throws for any other table", async () => {
    const db = fakeDb({ tables: { markets: [] } });
    expect(await db.from("markets").select()).toEqual({ data: [], error: null });
    expect(() => db.from("properties")).toThrow("unexpected table properties");
  });

  it("answers a registered storage method and throws for any other", () => {
    const db = fakeDb({ storage: { media: { remove: () => "removed" } } });
    expect(db.storage.from("media").remove(["a"])).toBe("removed");
    expect(() => db.storage.from("media").upload("a", "b")).toThrow(
      "unexpected storage media.upload",
    );
    expect(db.calls.map((call) => call.name)).toEqual(["media.remove", "media.upload"]);
  });
});
