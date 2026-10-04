import { describe, expect, it } from "vitest";
import { checkDb, checkMemory } from "../../src/server/lib/ratelimit";
import { fakeDb } from "../fixtures/fake-db";

const MINUTE = 60_000;

describe("checkMemory", () => {
  it("refuses the limit plus one with retryAfter, and a new window passes", () => {
    const start = 1_000_000;
    const results = [1, 2, 3].map((step) => checkMemory("unit-a", "ip", 2, MINUTE, start + step));
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: false, retryAfter: 60 }]);
    expect(checkMemory("unit-a", "ip", 2, MINUTE, start + 1 + MINUTE)).toEqual({ ok: true });
  });

  it("counts each key on its own", () => {
    expect(checkMemory("unit-b", "one", 1, MINUTE, 0)).toEqual({ ok: true });
    expect(checkMemory("unit-b", "two", 1, MINUTE, 0)).toEqual({ ok: true });
    expect(checkMemory("unit-b", "one", 1, MINUTE, 30_500)).toEqual({ ok: false, retryAfter: 30 });
  });

  it("keeps a longer window through the sweep of many expired short ones", () => {
    const hour = 60 * MINUTE;
    expect(checkMemory("unit-c", "long", 1, hour, 0)).toEqual({ ok: true });
    for (let index = 0; index < 10_000; index += 1)
      checkMemory("unit-c-short", String(index), 1, 1000, 0);
    expect(checkMemory("unit-c-short", "next", 1, 1000, 5000)).toEqual({ ok: true });
    expect(checkMemory("unit-c", "long", 1, hour, 5000)).toEqual({ ok: false, retryAfter: 3595 });
  });
});

describe("checkDb", () => {
  it("sends every check in one rate_limit_check call, in snake_case", async () => {
    const db = fakeDb({ rpc: { rate_limit_check: () => [{ allowed: true, retry_after: 0 }] } });
    const result = await checkDb(db, [
      { bucket: "inquiries:ip", keyHash: "a", limit: 10, windowSeconds: 3600 },
      { bucket: "inquiries:email", keyHash: "b", limit: 3, windowSeconds: 86_400 },
    ]);
    expect(result).toEqual({ ok: true });
    expect(db.calls).toEqual([
      {
        kind: "rpc",
        name: "rate_limit_check",
        args: [
          {
            p_checks: [
              { bucket: "inquiries:ip", key_hash: "a", limit: 10, window_seconds: 3600 },
              { bucket: "inquiries:email", key_hash: "b", limit: 3, window_seconds: 86_400 },
            ],
          },
        ],
      },
    ]);
  });

  it("answers a refusal with the database's retry_after", async () => {
    const db = fakeDb({ rpc: { rate_limit_check: () => [{ allowed: false, retry_after: 42 }] } });
    const check = { bucket: "inquiries:ip", keyHash: "a", limit: 10, windowSeconds: 3600 };
    expect(await checkDb(db, [check])).toEqual({ ok: false, retryAfter: 42 });
  });

  it("throws 503 unavailable when the call fails", async () => {
    const db = fakeDb({ rpc: { rate_limit_check: () => new Error("connection refused") } });
    const check = { bucket: "inquiries:ip", keyHash: "a", limit: 10, windowSeconds: 3600 };
    await expect(checkDb(db, [check])).rejects.toMatchObject({ code: "unavailable", status: 503 });
  });
});
