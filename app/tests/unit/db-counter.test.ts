import { describe, expect, it } from "vitest";
import { countingDb } from "../fixtures/db-counter";
import { fakeDb } from "../fixtures/fake-db";

function counted() {
  const remove = () => ({ data: ["a.jpg"], error: null });
  const db = fakeDb({
    rpc: { public_state: () => true },
    tables: { markets: [] },
    storage: { submissions: { remove } },
  });
  return { db, wrapped: countingDb(db) };
}

describe("countingDb", () => {
  it("counts two rpc calls and one storage call as three", async () => {
    const { wrapped } = counted();
    await wrapped.rpc("public_state");
    await wrapped.rpc("public_state");
    await wrapped.storage.from("submissions").remove(["a.jpg"]);
    expect(wrapped.counts.rpc["public_state"]).toBe(2);
    expect(wrapped.counts.storage["submissions.remove"]).toBe(1);
    expect(wrapped.counts.total).toBe(3);
  });

  it("counts a table read under its name and leaves the answers alone", async () => {
    const { db, wrapped } = counted();
    expect(await wrapped.from("markets").select()).toEqual({ data: [], error: null });
    expect(await wrapped.rpc("public_state")).toEqual({ data: true, error: null });
    expect(wrapped.counts.from["markets"]).toBe(1);
    expect(wrapped.counts.total).toBe(2);
    expect(db.calls.map((call) => call.name)).toEqual(["markets", "public_state"]);
  });

  it("starts again from zero after reset", async () => {
    const { wrapped } = counted();
    await wrapped.rpc("public_state");
    wrapped.reset();
    expect(wrapped.counts).toEqual({ rpc: {}, from: {}, storage: {}, total: 0 });
    await wrapped.rpc("public_state");
    expect(wrapped.counts.total).toBe(1);
  });
});
